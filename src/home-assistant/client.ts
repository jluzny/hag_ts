/**
 * Home Assistant WebSocket and REST client for HAG JavaScript variant.
 * 
 * Traditional async/await implementation with retry logic and connection management.
 */

import { injectable, inject } from '@needle-di/core';
// Using native WebSocket API instead of deprecated @std/ws
import { delay } from '@std/async';
import type { HassOptions } from '../config/settings.ts';
import { TYPES, LoggerService } from '../core/container.ts';
import { ConnectionError, StateError, ValidationError } from '../core/exceptions.ts';
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

  constructor(
    @inject(TYPES.HassOptions) private config: HassOptions,
    @inject(TYPES.Logger) private logger: LoggerService,
  ) {}

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
        this.logger.info('Connecting to Home Assistant', {
          url: this.config.wsUrl,
          attempt: retryCount + 1,
        });

        await this.establishConnection();
        await this.authenticate();
        await this.subscribeToEvents();
        
        this.connectionState = WebSocketState.CONNECTED;
        this.stats.totalConnections++;
        this.stats.lastConnected = new Date();
        
        this.startPingTimer();
        
        this.logger.info('✅ Connected to Home Assistant successfully');
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
  async disconnect(): Promise<void> {
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
      const url = `${this.config.restUrl}/api/states/${entityId}`;
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
  private async establishConnection(): Promise<void> {
    try {
      this.ws = new WebSocket(this.config.wsUrl);
      
      this.ws.onopen = () => {
        this.logger.info('WebSocket connection established');
      };
      
      this.ws.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          await this.handleMessage(JSON.parse(event.data));
        }
      };
      
      this.ws.onerror = (error) => {
        this.logger.error('WebSocket error', { error });
      };
      
      this.ws.onclose = () => {
        this.logger.info('WebSocket connection closed');
      };
      
    } catch (error) {
      throw new ConnectionError(
        `WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`,
        this.config.wsUrl,
      );
    }
  }

  /**
   * Authenticate with Home Assistant
   */
  private async authenticate(): Promise<void> {
    this.connectionState = WebSocketState.AUTHENTICATING;

    // Wait for auth_required message
    // Send auth message
    const authMessage: HagWebSocketMessage = {
      type: HassCommandType.AUTH,
      access_token: this.config.token,
    };

    await this.sendMessage(authMessage);
    
    // Authentication success is handled in handleMessage
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
        case 'auth_required':
          // Authentication will be handled by authenticate method
          break;

        case 'auth_ok':
          this.logger.info('Authentication successful');
          break;

        case 'auth_invalid':
          throw new ConnectionError('Authentication failed - invalid token');

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
  private async handleEvent(data: HagWebSocketMessage): Promise<void> {
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
  }

  /**
   * Send message to WebSocket
   */
  private async sendMessage(message: HagWebSocketMessage): Promise<void> {
    if (!this.ws) {
      throw new ConnectionError('WebSocket not connected');
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      throw new ConnectionError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
}