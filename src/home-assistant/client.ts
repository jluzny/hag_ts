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
  StateValue,
} from "xstate";
import type { HassOptions } from "../config/config.ts";
import { LoggerService } from "../core/logging.ts";
import {
  ConnectionError,
  StateError,
  getErrorMessage,
  toError,
} from "../core/exceptions.ts";
import {
  ConnectionStats,
  HagWebSocketMessage,
  HassCommandType,
  HassEventImpl,
  HassServiceCallImpl,
  HassStateImpl,
} from "./models.ts";

// Value type discriminator for generic entity operations
// Based on the Rust HAG implementation pattern
export interface ValueType {
  type: "state" | "attribute";
  key: string; // For state: the service parameter name, for attribute: the attribute name
}

// Define state values as const for type safety
const HAClientStates = {
  disconnected: "disconnected",
  connecting: "connecting",
  authenticating: "authenticating",
  connected: "connected",
  reconnecting: "reconnecting",
  disconnecting: "disconnecting",
  error: "error",
} as const;

// Strongly typed context interface
interface HAClientContext {
  ws?: WebSocket;
  messageId: number;
  stats: ConnectionStats;
  retryCount: number;
  error?: string;
}

// Discriminated union for events with proper typing
type HAClientEvent =
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "RETRY" }
  | { type: "CONNECTION_LOST" }
  | { type: "WS_CONNECTED"; ws: WebSocket }
  | { type: "WS_ERROR"; error: string }
  | { type: "AUTH_OK" }
  | { type: "AUTH_FAILED"; error: string }
  | { type: "UPDATE_STATS"; stats: ConnectionStats }
  | { type: "INCREMENT_MESSAGE_ID" };

// Create the machine with full type safety
function createHAClientMachine(
  config: HassOptions,
  logger: LoggerService,
  webSocketFactory?: (url: string) => WebSocket,
) {
  return createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QAoC2BDAxgCwJYDswBKAOlwGIAFAFQHkBRAYgG0AGAXUVAAOqsA9ixy9EIABKgANCAC0AZgAsATtIDsuydOkBOABxT5S+QF8tWtJlyCRYyTLhIoAJQAyAUWVsOXHgGFff0QwFTAWdhA2LgBhAEF+ThAAWmDNHVMtVQlpOU05HgA2SQAOGVJDAzMrLGw8fCJSchpaBmY2Zi5eAQkpZTltS2tIOwdnPCUe-wDg4K1dSJaY+ITk1PT0zOyCnP1tKR5dLWlq4rKaipq6xqbmttanJ1d3Ty9ff39g7Uj4SfGk-JSdKvT6JFKfLoXa5FDIqXaacrSMLaUrBa6PTJyKR3KQKIplCpFUoNUrtVQdDofOAfL56DFCKYyRZLLZ7ZYnBZI-a4w5SYnSO5XSrlaqKV7FJEyRTSfLo6TyGFM1TIjF0tktDltPqMjn8vnC4WiiWSiKRLCxZbrebPVJKKWyDJSCqSM3lZVq3L6g1G01m0i0-Gre1nFaXLFPGoPOJq6TGurGhqm1oW80M0DchRMw40-mO52e93e30+j1CkLhUCROIJhPxx7aJPfFOU+7fTWyLWyGqyVWu1UABSAAA=="" */
    id: "haClient",
    initial: HAClientStates.disconnected,
    types: {
      context: {} as HAClientContext,
      events: {} as HAClientEvent,
    },
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
    },
    states: {
      [HAClientStates.disconnected]: {
        on: {
          CONNECT: {
            target: HAClientStates.connecting,
          },
        },
      },
      [HAClientStates.connecting]: {
        invoke: {
          src: fromPromise(async () => {
            return new Promise<WebSocket>((resolve, reject) => {
              try {
                const ws = webSocketFactory
                  ? webSocketFactory(config.wsUrl)
                  : new WebSocket(config.wsUrl);

                ws.onopen = () => {
                  logger.info("WebSocket connection established");
                  resolve(ws);
                };

                ws.onerror = (event: Event | ErrorEvent) => {
                  const errorEvent = event as ErrorEvent;
                  const errorMessage =
                    errorEvent.error?.message ||
                    errorEvent.message ||
                    "Connection refused";

                  logger.error(
                    "WebSocket connection failed",
                    new Error(errorMessage),
                    { url: config.wsUrl },
                  );
                  reject(
                    new Error(`WebSocket connection error: ${errorMessage}`),
                  );
                };

                ws.onclose = (event) => {
                  if (event.code !== 1000) {
                    const reason = event.reason || "No reason provided";
                    logger.error(
                      "WebSocket closed unexpectedly",
                      new Error(reason),
                      { url: config.wsUrl, code: event.code },
                    );
                    reject(
                      new Error(
                        `WebSocket closed unexpectedly: ${event.code} - ${reason}`,
                      ),
                    );
                  }
                };
              } catch (error) {
                reject(
                  new Error(
                    `WebSocket connection failed: ${getErrorMessage(error)}`,
                  ),
                );
              }
            });
          }),
          onDone: {
            target: HAClientStates.authenticating,
            actions: assign({
              ws: ({ event }) => event.output,
            }),
          },
          onError: {
            target: HAClientStates.error,
            actions: assign({
              error: ({ event }) => getErrorMessage(event.error),
              stats: ({ context }) => ({
                ...context.stats,
                totalErrors: context.stats.totalErrors + 1,
              }),
            }),
          },
        },
      },
      [HAClientStates.authenticating]: {
        invoke: {
          src: fromPromise(async ({ input }: { input: HAClientContext }) => {
            const { ws } = input;

            return new Promise<void>((resolve, reject) => {
              if (!ws) {
                reject(new Error("WebSocket not available"));
                return;
              }

              const authTimeout = setTimeout(() => {
                reject(new Error("Authentication timeout"));
              }, 20000);

              const cleanup = () => {
                clearTimeout(authTimeout);
              };

              ws.onmessage = (event) => {
                if (typeof event.data === "string") {
                  const data = JSON.parse(event.data);

                  if (data.type === "auth_required") {
                    logger.debug("Auth required, sending token");
                    try {
                      ws.send(
                        JSON.stringify({
                          type: "auth",
                          access_token: config.token,
                        }),
                      );
                    } catch (err) {
                      cleanup();
                      reject(
                        new Error(
                          `Failed to send auth: ${getErrorMessage(err)}`,
                        ),
                      );
                    }
                  } else if (data.type === "auth_ok") {
                    logger.info("Authentication successful");
                    cleanup();
                    resolve();
                  } else if (data.type === "auth_invalid") {
                    cleanup();
                    reject(new Error("Authentication failed - invalid token"));
                  }
                }
              };
            });
          }),
          input: ({ context }) => context,
          onDone: {
            target: HAClientStates.connected,
            actions: assign({
              stats: ({ context }) => ({
                ...context.stats,
                totalConnections: context.stats.totalConnections + 1,
                lastConnected: new Date(),
              }),
              retryCount: 0,
              error: undefined,
            }),
          },
          onError: {
            target: HAClientStates.error,
            actions: assign({
              error: ({ event }) => getErrorMessage(event.error),
            }),
          },
        },
      },
      [HAClientStates.connected]: {
        // Remove entry action - will handle this in the client class
        on: {
          DISCONNECT: {
            target: HAClientStates.disconnecting,
          },
          CONNECTION_LOST: {
            target: HAClientStates.reconnecting,
          },
          UPDATE_STATS: {
            actions: assign({
              stats: ({ event, context }) => {
                return event.type === "UPDATE_STATS"
                  ? event.stats
                  : context.stats;
              },
            }),
          },
          INCREMENT_MESSAGE_ID: {
            actions: assign({
              messageId: ({ context }) => context.messageId + 1,
            }),
          },
        },
      },
      [HAClientStates.reconnecting]: {
        after: {
          5000: {
            target: HAClientStates.connecting,
            actions: assign({
              stats: ({ context }) => ({
                ...context.stats,
                totalReconnections: context.stats.totalReconnections + 1,
              }),
            }),
          },
        },
        on: {
          DISCONNECT: {
            target: HAClientStates.disconnecting,
          },
        },
      },
      [HAClientStates.disconnecting]: {
        entry: assign({
          ws: ({ context }) => {
            const { ws } = context;
            if (ws) {
              try {
                ws.close();
              } catch (err) {
                logger.error("Error closing WebSocket", err);
              }
            }
            return undefined;
          },
        }),
        always: {
          target: HAClientStates.disconnected,
        },
      },
      [HAClientStates.error]: {
        on: {
          RETRY: {
            target: HAClientStates.connecting,
            guard: ({ context }) => context.retryCount < config.maxRetries,
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
              error: undefined,
            }),
          },
          DISCONNECT: {
            target: HAClientStates.disconnecting,
          },
        },
        after: {
          5000: {
            target: HAClientStates.connecting,
            guard: ({ context }) => context.retryCount < config.maxRetries,
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
              error: undefined,
            }),
          },
        },
      },
    },
  });
}

// Type-safe machine and actor types
type HAClientMachine = ReturnType<typeof createHAClientMachine>;
type HAClientActor = ActorRefFrom<HAClientMachine>;

// Type guards for state checking
function isConnectedState(
  state: StateValue,
): state is typeof HAClientStates.connected {
  return state === HAClientStates.connected;
}

function isErrorState(state: StateValue): state is typeof HAClientStates.error {
  return state === HAClientStates.error;
}

/**
 * Derive sensor entity ID from source entity ID using generic pattern
 * climate.living_room_ac + sensor + temperature -> sensor.living_room_ac_temperature
 */
export function deriveSensorEntityId(
  sourceEntityId: string,
  sourceDomain: string,
  targetDomain: string,
  sensorName: string,
): string {
  const entityName = sourceEntityId.replace(`${sourceDomain}.`, "");
  return `${targetDomain}.${entityName}_${sensorName}`;
}

/**
 * Helper function to derive temperature sensor from HVAC entity
 * climate.living_room_ac -> sensor.living_room_ac_temperature
 */
export function deriveTemperatureSensor(hvacEntityId: string): string {
  return deriveSensorEntityId(hvacEntityId, "climate", "sensor", "temperature");
}

@injectable()
export class HomeAssistantClient {
  private machine: HAClientMachine;
  private actor?: HAClientActor;
  private eventHandlers = new Map<
    string,
    Set<(event: HassEventImpl) => void>
  >();
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
    this.machine = createHAClientMachine(
      this.config,
      this.logger,
      this.webSocketFactory,
    );
  }

  /**
   * Connect to Home Assistant WebSocket API
   */
  async connect(): Promise<void> {
    this.logger.debug("🚀 Starting Home Assistant connection process");

    if (this.connected) {
      this.logger.info("✅ Already connected to Home Assistant");
      return;
    }

    if (!this.actor) {
      this.actor = createActor(this.machine);
      this.actor.start();

      // Set up permanent subscription to handle reconnections
      this.actor.subscribe((state) => {
        if (isConnectedState(state.value) && this.connected) {
          // This will be called on both initial connection and reconnections
          this.setupConnectedState();
        }
      });
    }

    return new Promise((resolve, reject) => {
      const subscription = this.actor!.subscribe((state) => {
        if (isConnectedState(state.value)) {
          this.logger.info("✅ Connected to Home Assistant successfully");
          subscription.unsubscribe();
          resolve();
        } else if (
          isErrorState(state.value) &&
          state.context.retryCount >= this.config.maxRetries
        ) {
          this.logger.error("❌ All connection attempts exhausted");
          subscription.unsubscribe();
          reject(
            new ConnectionError(
              `Failed to connect after ${this.config.maxRetries} attempts: ${state.context.error}`,
            ),
          );
        }
      });

      this.actor!.send({ type: "CONNECT" });
    });
  }

  private connectedStateSetup = false;

  public setupConnectedState(): void {
    // Prevent duplicate setup
    if (this.connectedStateSetup) {
      return;
    }

    const ws = this.actor?.getSnapshot().context.ws;
    if (ws) {
      (ws as WebSocket).onmessage = async (event: MessageEvent) => {
        if (typeof event.data === "string") {
          await this.handleMessage(JSON.parse(event.data));
        }
      };

      (ws as WebSocket).onclose = () => {
        this.logger.warning("Connection lost");
        this.connectedStateSetup = false; // Reset flag on disconnect
        this.subscriptions.clear(); // Clear subscriptions on connection loss
        this.actor?.send({ type: "CONNECTION_LOST" });
      };

      (ws as WebSocket).onerror = (event: Event | ErrorEvent) => {
        const errorEvent = event as ErrorEvent;
        const errorMessage =
          errorEvent.error?.message || errorEvent.message || "WebSocket error";

        this.logger.error(
          "WebSocket error in connected state",
          new Error(errorMessage),
        );
        this.connectedStateSetup = false; // Reset flag on error
        this.subscriptions.clear(); // Clear subscriptions on error
        this.actor?.send({ type: "CONNECTION_LOST" });
      };

      this.startPingTimer();
      this.subscribeToInitialEvents();
      this.connectedStateSetup = true; // Mark as set up
    }
  }

  /**
   * Disconnect from Home Assistant
   */
  disconnect(): Promise<void> {
    this.logger.debug("🔌 Disconnecting from Home Assistant");

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    this.eventHandlers.clear();
    this.subscriptions.clear();

    if (this.actor) {
      this.actor.send({ type: "DISCONNECT" });
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
    const snapshot = this.actor?.getSnapshot();
    return snapshot
      ? isConnectedState(snapshot.value) && snapshot.context.ws !== undefined
      : false;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const context = this.actor?.getSnapshot().context;
    return context
      ? { ...context.stats }
      : {
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
      this.logger.error(
        "❌ Cannot get state: not connected to Home Assistant",
        undefined,
        { entityId },
      );
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
          throw new StateError(
            `Entity not found: ${entityId}`,
            undefined,
            entityId,
          );
        }
        throw new StateError(
          `HTTP ${response.status}: ${response.statusText}`,
          undefined,
          entityId,
        );
      }

      const data = await response.json();
      const state = HassStateImpl.fromApiResponse(data);

      this.logger.debug("✅ Entity state retrieved", {
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
        `Failed to get state for ${entityId}: ${getErrorMessage(error)}`,
        undefined,
        entityId,
      );
    }
  }

  /**
   * Call Home Assistant service
   */
  async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    this.logger.debug("🔧 Calling Home Assistant service", {
      domain: serviceCall.domain,
      service: serviceCall.service,
      serviceData: serviceCall.serviceData,
    });

    if (!this.connected) {
      throw new ConnectionError("Not connected to Home Assistant");
    }

    try {
      const messageId = this.getNextMessageId();
      const message = serviceCall.toWebSocketMessage(messageId);
      await this.sendMessage(message);
      this.logger.debug("✅ Service called successfully", {
        domain: serviceCall.domain,
        service: serviceCall.service,
        serviceData: serviceCall.serviceData,
      });
    } catch (error) {
      this.logger.error("❌ Failed to call service", error);
      throw new ConnectionError(
        `Failed to call service ${serviceCall.domain}.${serviceCall.service}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Generic entity control with state checking to prevent unnecessary calls
   * Based on the Rust HAG implementation pattern
   */
  async controlEntity(
    entityId: string,
    domain: string,
    service: string,
    valueType: ValueType,
    value: any,
  ): Promise<void> {
    if (!this.connected) {
      throw new ConnectionError("Not connected to Home Assistant");
    }

    // Get current entity state to check if changes are needed
    let currentState: HassStateImpl | undefined;
    try {
      currentState = await this.getState(entityId);
    } catch (error) {
      this.logger.warning(
        "⚠️ Could not get current state, proceeding with service call",
        {
          entityId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    // Get current value based on value type
    let currentValue: any;
    if (currentState) {
      currentValue =
        valueType.type === "state"
          ? currentState.state
          : currentState.attributes?.[valueType.key];
    }

    // Check if change is needed
    if (currentValue === value) {
      this.logger.debug("⏭️ Service call skipped - value unchanged", {
        entityId,
        valueType,
        currentValue,
        desiredValue: value,
        service: `${domain}.${service}`,
        reason: "Current value matches desired value",
      });
      return;
    }

    try {
      // Build service data payload dynamically
      const serviceData: Record<string, any> = {};

      // Add the value with appropriate key based on service conventions
      serviceData[valueType.key] = value;

      // Create service call using domain-specific factory methods
      let serviceCall: HassServiceCallImpl;

      if (domain === "climate") {
        serviceCall = HassServiceCallImpl.climate(
          service as
            | "set_hvac_mode"
            | "set_temperature"
            | "set_preset_mode"
            | "turn_off",
          entityId,
          serviceData,
        );
      } else if (domain === "homeassistant") {
        serviceCall = HassServiceCallImpl.homeassistant(
          service as "update_entity" | "reload_config_entry",
          entityId,
        );
      } else {
        // Fallback to direct construction for other domains
        serviceCall = new HassServiceCallImpl(domain, service, {
          entity_id: entityId,
          ...serviceData,
        });
      }

      await this.callService(serviceCall);

      this.logger.debug("🔄 Applied entity change", {
        entityId,
        operation: `${domain}.${service}`,
        valueType,
        from: currentValue,
        to: value,
      });
    } catch (error) {
      this.logger.error("❌ Failed to apply entity change", error, {
        entityId,
        operation: `${domain}.${service}`,
        valueType,
        value,
      });
      throw error;
    }
  }

  /**
   * Subscribe to events
   */
  async subscribeEvents(eventType: string): Promise<void> {
    this.logger.debug("📡 Subscribing to Home Assistant events", { eventType });

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
          totalMessages: snapshot.context.stats.totalMessages + 1,
        };
        // Update stats in machine context
        this.actor?.send({ type: "UPDATE_STATS", stats: newStats });
      }

      switch (data.type) {
        case "event":
          const event = HassEventImpl.fromWebSocketEvent(data);
          this.logger.debug("📨 Received Home Assistant event", {
            eventType: event.eventType,
            hasHandlers: this.eventHandlers.has(event.eventType),
            handlerCount: this.eventHandlers.get(event.eventType)?.size || 0,
            eventData: event.data,
          });

          const handlers = this.eventHandlers.get(event.eventType);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(event);
              } catch (error) {
                this.logger.error("Event handler failed", error);
              }
            }
          } else {
            this.logger.debug("No handlers registered for event type", {
              eventType: event.eventType,
            });
          }
          break;

        case "result":
          if (data.success) {
            this.logger.debug("Command result: success", {
              messageId: data.id,
            });
          } else {
            this.logger.error(
              "Command result: failed",
              toError(data.error, "Home Assistant command failed"),
              {
                messageId: data.id,
                errorData: data.error,
              },
            );
          }
          break;

        case "pong":
          this.logger.debug("Pong received - connection alive");
          break;

        default:
          this.logger.debug("Unhandled message type", { type: data.type });
      }
    } catch (error) {
      this.logger.error("Error handling WebSocket message", error);
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
        `Failed to send message: ${getErrorMessage(error)}`,
      );
    }
    return Promise.resolve();
  }

  private getNextMessageId(): number {
    const snapshot = this.actor?.getSnapshot();
    if (snapshot) {
      const nextId = snapshot.context.messageId + 1;
      // Update messageId in context by sending an event
      this.actor?.send({ type: "INCREMENT_MESSAGE_ID" });
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
          this.logger.error("Ping failed", error);
          this.actor?.send({ type: "CONNECTION_LOST" });
        }
      }
    }, 30000);
  }

  private async subscribeToInitialEvents(): Promise<void> {
    try {
      // Add small delay to ensure WebSocket is fully ready after authentication
      await new Promise((resolve) => setTimeout(resolve, 100));

      await this.subscribeEvents("state_changed");
    } catch (error) {
      this.logger.error("Failed to subscribe to initial events", error);

      // Retry once after a longer delay for reconnection scenarios
      try {
        this.logger.info("Retrying event subscription after delay...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.subscribeEvents("state_changed");
      } catch (retryError) {
        this.logger.error("Event subscription retry also failed", retryError);
        // Reset setup flag so we can try again on next reconnection
        this.connectedStateSetup = false;
      }
    }
  }
}
