/**
 * Home Assistant WebSocket and REST client for HAG JavaScript variant.
 *
 * XState-powered implementation with connection state management.
 */

import { injectable } from "@needle-di/core";
import {
  ActorRefFrom,
  assign,
  createActor,
  createMachine,
  fromPromise,
} from 'xstate';
import type { HassOptions } from "../config/config.ts";
import { LoggerService } from "../core/logging.ts";
import {
  ConnectionError,
  StateError,
  ValidationError as _ValidationError,
} from "../core/exceptions.ts";
import {
  ConnectionStats,
  HagWebSocketMessage,
  HassCommandType,
  HassEventImpl,
  HassServiceCallImpl,
  HassStateImpl,
  WebSocketState as _WebSocketState,
} from "./models.ts";

interface HAClientContext {
  ws?: WebSocket;
  messageId: number;
  stats: ConnectionStats;
  retryCount: number;
  error?: string;
}

type _HAClientEvent = 
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT' }
  | { type: 'RETRY' }
  | { type: 'CONNECTION_LOST' }
  | { type: 'WS_CONNECTED'; ws: WebSocket }
  | { type: 'WS_ERROR'; error: string }
  | { type: 'AUTH_OK' }
  | { type: 'AUTH_FAILED'; error: string };

function createHAClientMachine(
  config: HassOptions,
  logger: LoggerService,
  webSocketFactory?: (url: string) => WebSocket
) {
  return createMachine({
    id: 'haClient',
    initial: 'disconnected',
    context: {
      ws: undefined,
      messageId: 1,
      stats: {
        totalConnections: 0,
        totalReconnections: 0,
        totalMessages: 0,
        totalErrors: 0,
      },
      retryCount: 0,
      error: undefined,
    } satisfies HAClientContext,
    states: {
      disconnected: {
        on: {
          CONNECT: 'connecting'
        }
      },
      connecting: {
        invoke: {
          src: fromPromise(async () => {
            return new Promise<WebSocket>((resolve, reject) => {
              try {
                const ws = webSocketFactory ? webSocketFactory(config.wsUrl) : new WebSocket(config.wsUrl);
                
                ws.onopen = () => {
                  logger.info('WebSocket connection established');
                  resolve(ws);
                };
                
                ws.onerror = (event: Event | ErrorEvent) => {
                  const error = (event as ErrorEvent).error || event;
                  logger.error('WebSocket error', { error });
                  reject(new Error(`WebSocket connection error: ${error instanceof Error ? error.message : String(error)}`));
                };
                
                ws.onclose = (event) => {
                  if (event.code !== 1000) {
                    reject(new Error(`WebSocket closed unexpectedly: ${event.code} - ${event.reason}`));
                  }
                };
              } catch (error) {
                reject(new Error(`WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`));
              }
            });
          }),
          onDone: {
            target: 'authenticating',
            actions: assign(({ context, event }) => ({
              ...context,
              ws: event.output
            }))
          },
          onError: {
            target: 'error',
            actions: assign(({ context, event }) => ({
              ...context,
              stats: { ...context.stats, totalErrors: context.stats.totalErrors + 1 },
              error: (event as any).error instanceof Error ? (event as any).error.message : String((event as any).error)
            }))
          }
        }
      },
      authenticating: {
        invoke: {
          src: fromPromise(async ({ input }: { input: HAClientContext }) => {
            const { ws } = input;
            
            return new Promise<void>((resolve, reject) => {
              if (!ws) {
                reject(new Error('WebSocket not available'));
                return;
              }
              
              const authTimeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
              }, 20000);
              
              const cleanup = () => {
                clearTimeout(authTimeout);
              };
              
              ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                  const data = JSON.parse(event.data);
                  
                  if (data.type === 'auth_required') {
                    logger.info('Auth required, sending token');
                    try {
                      ws.send(JSON.stringify({
                        type: 'auth',
                        access_token: config.token
                      }));
                    } catch (err) {
                      cleanup();
                      reject(new Error(`Failed to send auth: ${err instanceof Error ? err.message : String(err)}`));
                    }
                  } else if (data.type === 'auth_ok') {
                    logger.info('Authentication successful');
                    cleanup();
                    resolve();
                  } else if (data.type === 'auth_invalid') {
                    cleanup();
                    reject(new Error('Authentication failed - invalid token'));
                  }
                }
              };
            });
          }),
          input: ({ context }) => context,
          onDone: {
            target: 'connected',
            actions: assign(({ context }) => ({
              ...context,
              stats: {
                ...context.stats,
                totalConnections: context.stats.totalConnections + 1,
                lastConnected: new Date()
              },
              retryCount: 0,
              error: undefined
            }))
          },
          onError: {
            target: 'error',
            actions: assign(({ context, event }) => ({
              ...context,
              error: (event as any).error instanceof Error ? (event as any).error.message : String((event as any).error)
            }))
          }
        }
      },
      connected: {
        on: {
          DISCONNECT: 'disconnecting',
          CONNECTION_LOST: 'reconnecting'
        }
      },
      reconnecting: {
        after: {
          5000: {
            target: 'connecting',
            actions: assign(({ context }) => ({
              ...context,
              stats: {
                ...context.stats,
                totalReconnections: context.stats.totalReconnections + 1
              }
            }))
          }
        },
        on: {
          DISCONNECT: 'disconnecting'
        }
      },
      disconnecting: {
        entry: assign(({ context }) => {
          const { ws } = context;
          
          if (ws) {
            try {
              (ws as WebSocket).close();
            } catch (err) {
              logger.error('Error closing WebSocket', err);
            }
          }
          
          return {
            ...context,
            ws: undefined
          };
        }),
        always: 'disconnected'
      },
      error: {
        on: {
          RETRY: {
            target: 'connecting',
            guard: ({ context }) => context.retryCount < config.maxRetries,
            actions: assign(({ context }) => ({
              ...context,
              retryCount: context.retryCount + 1,
              error: undefined
            }))
          },
          DISCONNECT: 'disconnecting'
        },
        after: {
          5000: {
            target: 'connecting',
            guard: ({ context }) => context.retryCount < config.maxRetries,
            actions: assign(({ context }) => ({
              ...context,
              retryCount: context.retryCount + 1,
              error: undefined
            }))
          }
        }
      }
    }
  });
}

@injectable()
export class HomeAssistantClient {
  private machine: ReturnType<typeof createHAClientMachine>;
  private actor?: ActorRefFrom<ReturnType<typeof createHAClientMachine>>;
  private eventHandlers = new Map<string, Set<(event: HassEventImpl) => void>>();
  private subscriptions = new Set<string>();
  private pingTimer?: NodeJS.Timeout;
  private config: HassOptions;
  private logger: LoggerService;

  constructor(
    config?: HassOptions,
    logger?: LoggerService,
    private webSocketFactory?: (url: string) => WebSocket,
  ) {
    this.config = config!;
    this.logger = logger!;
    this.machine = createHAClientMachine(this.config, this.logger, this.webSocketFactory);
  }

  /**
   * Connect to Home Assistant WebSocket API
   */
  async connect(): Promise<void> {
    this.logger.info("🚀 Starting Home Assistant connection process");

    if (this.connected) {
      this.logger.info("✅ Already connected to Home Assistant");
      return;
    }

    if (!this.actor) {
      this.actor = createActor(this.machine);
      this.actor.start();
    }

    return new Promise((resolve, reject) => {
      const subscription = this.actor!.subscribe((state) => {
        if (state.value === 'connected') {
          this.setupConnectedState();
          this.logger.info("✅ Connected to Home Assistant successfully");
          subscription.unsubscribe();
          resolve();
        } else if (state.value === 'error' && state.context.retryCount >= this.config.maxRetries) {
          this.logger.error("❌ All connection attempts exhausted");
          subscription.unsubscribe();
          reject(new ConnectionError(`Failed to connect after ${this.config.maxRetries} attempts: ${state.context.error}`));
        }
      });

      this.actor!.send({ type: 'CONNECT' });
    });
  }

  private setupConnectedState(): void {
    const ws = this.actor?.getSnapshot().context.ws;
    if (ws) {
      (ws as WebSocket).onmessage = async (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          await this.handleMessage(JSON.parse(event.data));
        }
      };
      
      (ws as WebSocket).onclose = () => {
        this.logger.warning('Connection lost');
        this.actor?.send({ type: 'CONNECTION_LOST' });
      };
      
      (ws as WebSocket).onerror = () => {
        this.logger.error('WebSocket error in connected state');
        this.actor?.send({ type: 'CONNECTION_LOST' });
      };
      
      this.startPingTimer();
      this.subscribeToInitialEvents();
    }
  }

  /**
   * Disconnect from Home Assistant
   */
  disconnect(): Promise<void> {
    this.logger.info("🔌 Disconnecting from Home Assistant");

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    this.eventHandlers.clear();
    this.subscriptions.clear();

    if (this.actor) {
      this.actor.send({ type: 'DISCONNECT' });
      this.actor.stop();
      this.actor = undefined;
    }

    this.logger.info("✅ Disconnected from Home Assistant");
    return Promise.resolve();
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.actor?.getSnapshot().value === 'connected' && 
           this.actor?.getSnapshot().context.ws !== undefined;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const context = this.actor?.getSnapshot().context;
    return context ? { ...context.stats } : {
      totalConnections: 0,
      totalReconnections: 0,
      totalMessages: 0,
      totalErrors: 0,
    };
  }

  /**
   * Get entity state
   */
  async getState(entityId: string): Promise<HassStateImpl> {
    this.logger.debug("🔍 Getting entity state", { entityId });

    if (!this.connected) {
      this.logger.error("❌ Cannot get state: not connected to Home Assistant", { entityId });
      throw new ConnectionError("Not connected to Home Assistant");
    }

    try {
      const url = `${this.config.restUrl}/states/${entityId}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new StateError(`Entity not found: ${entityId}`, undefined, entityId);
        }
        throw new StateError(`HTTP ${response.status}: ${response.statusText}`, undefined, entityId);
      }

      const data = await response.json();
      const state = HassStateImpl.fromApiResponse(data);

      this.logger.info("✅ Entity state retrieved", {
        entityId,
        state: state.state,
        friendlyName: state.attributes?.friendly_name,
      });

      return state;
    } catch (error) {
      if (error instanceof StateError) {
        throw error;
      }
      this.logger.error("❌ Failed to get entity state", error, { entityId });
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
    this.logger.info("🔧 Calling Home Assistant service", {
      domain: serviceCall.domain,
      service: serviceCall.service,
    });

    if (!this.connected) {
      throw new ConnectionError("Not connected to Home Assistant");
    }

    try {
      const messageId = this.getNextMessageId();
      const message = serviceCall.toWebSocketMessage(messageId);
      await this.sendMessage(message);
      this.logger.info("✅ Service called successfully", {
        domain: serviceCall.domain,
        service: serviceCall.service,
      });
    } catch (error) {
      this.logger.error("❌ Failed to call service", error);
      throw new ConnectionError(
        `Failed to call service ${serviceCall.domain}.${serviceCall.service}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Subscribe to events
   */
  async subscribeEvents(eventType: string): Promise<void> {
    this.logger.info("📡 Subscribing to Home Assistant events", { eventType });

    if (!this.connected) {
      throw new ConnectionError("Not connected to Home Assistant");
    }

    if (this.subscriptions.has(eventType)) {
      this.logger.debug("Already subscribed to event type", { eventType });
      return;
    }

    const message: HagWebSocketMessage = {
      id: this.getNextMessageId(),
      type: HassCommandType.SUBSCRIBE_EVENTS,
      event_type: eventType,
    };

    await this.sendMessage(message);
    this.subscriptions.add(eventType);

    this.logger.info("✅ Successfully subscribed to events", { eventType });
  }

  /**
   * Add event handler
   */
  addEventHandler(
    eventType: string,
    handler: (event: HassEventImpl) => void,
  ): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }

    this.eventHandlers.get(eventType)!.add(handler);
    this.logger.info("✅ Event handler registered", { eventType });
  }

  /**
   * Remove event handler
   */
  removeEventHandler(
    eventType: string,
    handler: (event: HassEventImpl) => void,
  ): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  /**
   * Add state change event handler (convenience method)
   */
  onStateChanged(
    handler: (entityId: string, oldState: string, newState: string) => void,
  ): void {
    this.addEventHandler("state_changed", (event: HassEventImpl) => {
      const stateChangeData = event.getStateChangeData();
      if (stateChangeData) {
        const entityId = stateChangeData.entityId;
        const oldState = stateChangeData.oldState?.state || "";
        const newState = stateChangeData.newState?.state || "";

        if (oldState !== newState) {
          handler(entityId, oldState, newState);
        }
      }
    });
  }

  private async handleMessage(data: HagWebSocketMessage): Promise<void> {
    try {
      const snapshot = this.actor?.getSnapshot();
      if (snapshot) {
        const newStats = {
          ...snapshot.context.stats,
          totalMessages: snapshot.context.stats.totalMessages + 1
        };
        // Update stats in machine context
        this.actor?.send({ type: 'UPDATE_STATS', stats: newStats } as any);
      }
      
      switch (data.type) {
        case 'event':
          const event = HassEventImpl.fromWebSocketEvent(data);
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
          break;
        
        case 'result':
          if (data.success) {
            this.logger.debug('Command result: success', { messageId: data.id });
          } else {
            this.logger.error('Command result: failed', { messageId: data.id, error: data.error });
          }
          break;
        
        case 'pong':
          this.logger.debug('Pong received - connection alive');
          break;
        
        default:
          this.logger.debug('Unhandled message type', { type: data.type });
      }
    } catch (error) {
      this.logger.error('Error handling WebSocket message', error);
    }
  }

  private sendMessage(message: HagWebSocketMessage): Promise<void> {
    const ws = this.actor?.getSnapshot().context.ws;
    if (!ws || (ws as WebSocket).readyState !== WebSocket.OPEN) {
      throw new ConnectionError("WebSocket not connected");
    }

    try {
      (ws as WebSocket).send(JSON.stringify(message));
      this.logger.debug("WebSocket message sent successfully", {
        messageType: message.type,
        messageId: message.id,
      });
    } catch (error) {
      throw new ConnectionError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return Promise.resolve();
  }

  private getNextMessageId(): number {
    const snapshot = this.actor?.getSnapshot();
    if (snapshot) {
      const nextId = snapshot.context.messageId + 1;
      // Update messageId in context
      return nextId;
    }
    return 1;
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this.connected) {
        const pingMessage: HagWebSocketMessage = {
          id: this.getNextMessageId(),
          type: HassCommandType.PING,
        };
        
        try {
          this.sendMessage(pingMessage);
        } catch (error) {
          this.logger.error('Ping failed', error);
          this.actor?.send({ type: 'CONNECTION_LOST' });
        }
      }
    }, 30000);
  }

  private async subscribeToInitialEvents(): Promise<void> {
    try {
      await this.subscribeEvents('state_changed');
    } catch (error) {
      this.logger.error('Failed to subscribe to initial events', error);
    }
  }
}