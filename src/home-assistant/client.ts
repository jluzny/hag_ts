/**
 * Home Assistant WebSocket and REST client for HAG JavaScript variant.
 * 
 * Traditional async/await implementation with retry logic and connection management.
 */

import { injectable } from '@needle-di/core';
// Using native WebSocket API instead of deprecated @std/ws
import { delay } from '@std/async';
import type { HassOptions } from '../config/config.ts';
import { LoggerService, ConnectionLogContext } from '../core/logger.ts';
import { ConnectionError, StateError, ValidationError as _ValidationError } from '../core/exceptions.ts';
import { 
  HassStateImpl, 
  HassEventImpl, 
  HassServiceCallImpl,
  HagWebSocketMessage,
  HassCommandType,
  WebSocketState,
  ConnectionStats
} from './models.ts';

@injectable()
export class HomeAssistantClient {
  private ws?: WebSocket;
  private messageId = 1;
  private connectionState = WebSocketState.DISCONNECTED;
  private eventHandlers = new Map<string, Set<(event: HassEventImpl) => void>>();
  private subscriptions = new Set<string>();
  private stats: ConnectionStats = {
    totalConnections: 0,
    totalReconnections: 0,
    totalMessages: 0,
    totalErrors: 0,
  };
  private reconnectTimer?: number;
  private pingTimer?: number;
  private config: HassOptions;
  private logger: LoggerService;

  constructor(
    config?: HassOptions,
    logger?: LoggerService,
  ) {
    this.config = config!;
    this.logger = LoggerService.createModuleLogger('home-assistant.client');
  }

  /**
   * Connect to Home Assistant WebSocket API
   */
  async connect(): Promise<void> {
    if (this.connectionState === WebSocketState.CONNECTED) {
      this.logger.info('Already connected to Home Assistant');
      return;
    }

    this.connectionState = WebSocketState.CONNECTING;
    let retryCount = 0;

    while (retryCount < this.config.maxRetries) {
      try {
        this.logger.connectionInfo('Connecting to Home Assistant', {
          wsUrl: this.config.wsUrl,
          attempt: retryCount + 1,
        });

        await this.establishConnection();
        await this.authenticate();
        await this.subscribeToEvents();
        
        // connectionState is set to CONNECTED in authenticate() method
        this.stats.totalConnections++;
        this.stats.lastConnected = new Date();
        
        this.startPingTimer();
        
        this.logger.connectionInfo('✅ Connected to Home Assistant successfully');
        return;

      } catch (error) {
        retryCount++;
        this.stats.totalErrors++;
        this.stats.lastError = new Date();
        
        this.logger.error(`Connection attempt ${retryCount} failed`, error);
        
        if (retryCount >= this.config.maxRetries) {
          this.connectionState = WebSocketState.ERROR;
          throw new ConnectionError(
            `Failed to connect after ${this.config.maxRetries} attempts`,
            this.config.wsUrl,
            retryCount,
          );
        }

        this.connectionState = WebSocketState.RECONNECTING;
        await delay(this.config.retryDelayMs);
      }
    }
  }

  /**
   * Disconnect from Home Assistant
   */
  disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Home Assistant');
    
    this.clearTimers();
    this.connectionState = WebSocketState.DISCONNECTED;
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        this.logger.error('Error closing WebSocket', error);
      }
      this.ws = undefined;
    }
    
    this.eventHandlers.clear();
    this.subscriptions.clear();
    return Promise.resolve();
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.connectionState === WebSocketState.CONNECTED && this.ws !== undefined;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    return { ...this.stats };
  }

  /**
   * Get entity state
   */
  async getState(entityId: string): Promise<HassStateImpl> {
    if (!this.connected) {
      throw new ConnectionError('Not connected to Home Assistant');
    }

    try {
      const url = `${this.config.restUrl}/states/${entityId}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new StateError(`Entity not found: ${entityId}`, undefined, entityId);
        }
        throw new StateError(`HTTP ${response.status}: ${response.statusText}`, undefined, entityId);
      }

      const data = await response.json();
      return HassStateImpl.fromApiResponse(data);

    } catch (error) {
      if (error instanceof StateError) {
        throw error;
      }
      throw new StateError(
        `Failed to get state for ${entityId}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        entityId,
      );
    }
  }

  /**
   * Call Home Assistant service
   */
  async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    if (!this.connected) {
      throw new ConnectionError('Not connected to Home Assistant');
    }

    try {
      const message = serviceCall.toWebSocketMessage(this.getNextMessageId());
      await this.sendMessage(message);
      
      this.logger.debug('Service called successfully', {
        domain: serviceCall.domain,
        service: serviceCall.service,
      });

    } catch (error) {
      throw new ConnectionError(
        `Failed to call service ${serviceCall.domain}.${serviceCall.service}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Subscribe to events
   */
  async subscribeEvents(eventType: string): Promise<void> {
    if (!this.connected) {
      throw new ConnectionError('Not connected to Home Assistant');
    }

    if (this.subscriptions.has(eventType)) {
      this.logger.debug('Already subscribed to event type', { eventType });
      return;
    }

    const message: HagWebSocketMessage = {
      id: this.getNextMessageId(),
      type: HassCommandType.SUBSCRIBE_EVENTS,
      event_type: eventType,
    };

    await this.sendMessage(message);
    this.subscriptions.add(eventType);
    
    this.logger.debug('Subscribed to events', { eventType });
  }

  /**
   * Add event handler
   */
  addEventHandler(eventType: string, handler: (event: HassEventImpl) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    
    this.eventHandlers.get(eventType)!.add(handler);
    this.logger.debug('Event handler added', { eventType });
  }

  /**
   * Remove event handler
   */
  removeEventHandler(eventType: string, handler: (event: HassEventImpl) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  /**
   * Establish WebSocket connection
   */
  private establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.logger.debug('Creating WebSocket connection...', {
          url: this.config.wsUrl,
          currentTime: new Date().toISOString(),
        });
        
        this.ws = new WebSocket(this.config.wsUrl);
        
        this.logger.debug('WebSocket object created', {
          readyState: this.ws.readyState,
          readyStateString: this.getReadyStateString(this.ws.readyState),
          url: this.ws.url,
        });
        
        this.ws.onopen = () => {
          this.logger.info('WebSocket connection established');
          this.logger.debug('WebSocket opened successfully', {
            readyState: this.ws?.readyState,
            readyStateString: this.ws ? this.getReadyStateString(this.ws.readyState) : 'undefined',
            protocol: this.ws?.protocol,
            extensions: this.ws?.extensions,
          });
          resolve();
        };
        
        this.ws.onmessage = async (event) => {
          this.logger.debug('WebSocket message received', {
            dataType: typeof event.data,
            dataLength: event.data?.length,
            timestamp: new Date().toISOString(),
          });
          
          if (typeof event.data === 'string') {
            await this.handleMessage(JSON.parse(event.data));
          }
        };
        
        this.ws.onerror = (error) => {
          this.logger.error('WebSocket error', {
            error,
            readyState: this.ws?.readyState,
            readyStateString: this.ws ? this.getReadyStateString(this.ws.readyState) : 'undefined',
            url: this.config.wsUrl,
            timestamp: new Date().toISOString(),
          });
          reject(new ConnectionError(
            `WebSocket connection error: ${error}`,
            this.config.wsUrl,
          ));
        };
        
        this.ws.onclose = (event) => {
          this.logger.info('WebSocket connection closed', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            timestamp: new Date().toISOString(),
          });
          
          if (event.code !== 1000 && this.connectionState === WebSocketState.CONNECTING) {
            reject(new ConnectionError(
              `WebSocket closed unexpectedly: ${event.code} - ${event.reason}`,
              this.config.wsUrl,
            ));
          }
        };
        
      } catch (error) {
        this.logger.error('Failed to create WebSocket', {
          error,
          url: this.config.wsUrl,
          timestamp: new Date().toISOString(),
        });
        reject(new ConnectionError(
          `WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`,
          this.config.wsUrl,
        ));
      }
    });
  }

  /**
   * Authenticate with Home Assistant
   */
  private async authenticate(): Promise<void> {
    this.connectionState = WebSocketState.AUTHENTICATING;
    this.logger.debug('Starting Home Assistant authentication');

    return new Promise((resolve, reject) => {
      let authTimeout: number | undefined;
      let authRequired = false;

      const cleanup = () => {
        if (authTimeout) {
          clearTimeout(authTimeout);
        }
      };

      // Set timeout for authentication
      authTimeout = setTimeout(() => {
        cleanup();
        reject(new ConnectionError('Authentication timeout - no auth_required message received'));
      }, 10000); // 10 second timeout

      // Handle auth_required and auth responses
      const originalHandleMessage = this.handleMessage.bind(this);
      this.handleMessage = async (data: HagWebSocketMessage) => {
        try {
          if (data.type === 'auth_required') {
            this.logger.debug('Received auth_required message');
            authRequired = true;
            
            // Send authentication
            const authMessage: HagWebSocketMessage = {
              type: HassCommandType.AUTH,
              access_token: this.config.token,
            };
            
            this.logger.debug('Sending authentication token');
            await this.sendMessage(authMessage);
            
          } else if (data.type === 'auth_ok') {
            this.logger.info('Authentication successful');
            this.connectionState = WebSocketState.CONNECTED;
            cleanup();
            this.handleMessage = originalHandleMessage;
            resolve();
            
          } else if (data.type === 'auth_invalid') {
            cleanup();
            this.handleMessage = originalHandleMessage;
            reject(new ConnectionError('Authentication failed - invalid token'));
            
          } else {
            // Pass other messages to original handler
            await originalHandleMessage(data);
          }
        } catch (error) {
          cleanup();
          this.handleMessage = originalHandleMessage;
          reject(error);
        }
      };
    });
  }

  /**
   * Subscribe to initial events
   */
  private async subscribeToEvents(): Promise<void> {
    // Subscribe to state_changed events by default
    await this.subscribeEvents('state_changed');
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(data: HagWebSocketMessage): Promise<void> {
    try {
      this.stats.totalMessages++;

      switch (data.type) {
        case 'event':
          await this.handleEvent(data);
          break;

        case 'result':
          if (!data.success && data.error) {
            this.logger.error('Command failed', data.error);
          }
          break;

        case 'pong':
          this.logger.debug('Pong received');
          break;

        default:
          this.logger.debug('Unhandled message type', { type: data.type });
      }

    } catch (error) {
      this.logger.error('Error handling message', error);
      this.stats.totalErrors++;
    }
  }

  /**
   * Handle event messages
   */
  private handleEvent(data: HagWebSocketMessage): Promise<void> {
    try {
      const event = HassEventImpl.fromWebSocketEvent(data);
      
      // Dispatch to event handlers
      const handlers = this.eventHandlers.get(event.eventType);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (error) {
            this.logger.error('Event handler failed', error);
          }
        }
      }

    } catch (error) {
      this.logger.error('Failed to process event', error);
    }
    return Promise.resolve();
  }

  /**
   * Send message to WebSocket
   */
  private sendMessage(message: HagWebSocketMessage): Promise<void> {
    this.logger.debug('Attempting to send WebSocket message', {
      messageType: message.type,
      messageId: message.id,
      hasWebSocket: !!this.ws,
      readyState: this.ws?.readyState,
      readyStateString: this.ws ? this.getReadyStateString(this.ws.readyState) : 'undefined',
      timestamp: new Date().toISOString(),
    });

    if (!this.ws) {
      this.logger.error('Cannot send message: WebSocket not initialized');
      throw new ConnectionError('WebSocket not connected');
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send message: WebSocket not in OPEN state', {
        currentState: this.ws.readyState,
        currentStateString: this.getReadyStateString(this.ws.readyState),
        expectedState: WebSocket.OPEN,
        expectedStateString: 'OPEN',
        url: this.config.wsUrl,
      });
      throw new ConnectionError(
        `Failed to send message: WebSocket readyState is ${this.getReadyStateString(this.ws.readyState)} (${this.ws.readyState}), expected OPEN (${WebSocket.OPEN})`,
      );
    }

    try {
      const messageString = JSON.stringify(message);
      this.logger.debug('Sending WebSocket message', {
        messageLength: messageString.length,
        messagePreview: messageString.substring(0, 100),
      });
      
      this.ws.send(messageString);
      
      this.logger.debug('WebSocket message sent successfully', {
        messageType: message.type,
        messageId: message.id,
      });
    } catch (error) {
      this.logger.error('Failed to send WebSocket message', {
        error,
        messageType: message.type,
        readyState: this.ws.readyState,
        readyStateString: this.getReadyStateString(this.ws.readyState),
      });
      throw new ConnectionError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return Promise.resolve();
  }

  /**
   * Get next message ID
   */
  private getNextMessageId(): number {
    return this.messageId++;
  }

  /**
   * Start ping timer to keep connection alive
   */
  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this.connected) {
        const pingMessage: HagWebSocketMessage = {
          id: this.getNextMessageId(),
          type: HassCommandType.PING,
        };
        
        this.sendMessage(pingMessage).catch(error => {
          this.logger.error('Ping failed', error);
          this.handleConnectionLoss();
        });
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /**
   * Handle connection loss and attempt reconnection
   */
  private handleConnectionLoss(): void {
    if (this.connectionState === WebSocketState.CONNECTED) {
      this.logger.warning('Connection lost, attempting to reconnect');
      this.connectionState = WebSocketState.RECONNECTING;
      this.stats.totalReconnections++;
      
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(error => {
          this.logger.error('Reconnection failed', error);
          this.connectionState = WebSocketState.ERROR;
        });
      }, this.config.retryDelayMs);
    }
  }

  /**
   * Convert WebSocket readyState number to human-readable string
   */
  private getReadyStateString(readyState: number): string {
    switch (readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING';
      case WebSocket.OPEN:
        return 'OPEN';
      case WebSocket.CLOSING:
        return 'CLOSING';
      case WebSocket.CLOSED:
        return 'CLOSED';
      default:
        return `UNKNOWN(${readyState})`;
    }
  }
}