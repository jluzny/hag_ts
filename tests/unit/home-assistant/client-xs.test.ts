/**
 * Unit tests for XState-based Home Assistant client in HAG JavaScript variant.
 */

import { expect, test, describe } from "bun:test";
import { HomeAssistantClient } from "../../../src/home-assistant/client-xs.ts";
import { HassOptions } from "../../../src/config/config.ts";
import { ConnectionError } from "../../../src/core/exceptions.ts";
import { HassServiceCallImpl } from "../../../src/home-assistant/models.ts";
import { LoggerService } from "../../../src/core/logging.ts";

// Mock logger service
class MockLoggerService extends LoggerService {
  constructor() {
    super("TEST");
  }

  override info(_message: string, _data?: Record<string, unknown>): void {}
  override error(
    _message: string,
    _error?: unknown,
    _data?: Record<string, unknown>,
  ): void {}
  override debug(_message: string, _data?: Record<string, unknown>): void {}
  override warning(_message: string, _data?: Record<string, unknown>): void {}
}

// Mock WebSocket implementation
class MockWebSocket extends EventTarget {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  private messageQueue: string[] = [];
  private failSend = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      // OPEN
      throw new Error("WebSocket not in OPEN state");
    }
    if (this.failSend) {
      throw new Error("Simulated send failure");
    }
    this.messageQueue.push(data);
  }

  close(): void {
    if (this.readyState !== 3) {
      // CLOSED
      this.readyState = 3; // CLOSED
      const event = new CloseEvent("close");
      this.onclose?.(event);
      this.dispatchEvent(event);
    }
  }

  // --- Test Helper Methods ---

  public connect() {
    if (this.readyState === 0) {
      // CONNECTING
      this.readyState = 1; // OPEN
      const event = new Event("open");
      this.onopen?.(event);
      this.dispatchEvent(event);
    }
  }

  public failConnection() {
    if (this.readyState === 0) {
      // CONNECTING
      this.readyState = 3; // CLOSED
      const event = new Event("error");
      this.onerror?.(event);
      this.dispatchEvent(event);
    }
  }

  public receiveMessage(data: Record<string, unknown> | string) {
    if (this.readyState === 1) {
      // OPEN
      const message = typeof data === "string" ? data : JSON.stringify(data);
      const event = new MessageEvent("message", { data: message });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }
  }

  public getLastSentMessage(): Record<string, unknown> | null {
    if (this.messageQueue.length === 0) return null;
    return JSON.parse(this.messageQueue[this.messageQueue.length - 1]);
  }

  public setFailSend(shouldFail: boolean) {
    this.failSend = shouldFail;
  }
}

const mockHassOptions: HassOptions = {
  wsUrl: "ws://localhost:8123/api/websocket",
  restUrl: "http://localhost:8123",
  token: "test_token",
  maxRetries: 3,
  retryDelayMs: 10,
  stateCheckInterval: 300000,
};

describe("XState Home Assistant Client - Connection Management", () => {
  let mockWs: MockWebSocket;
  const logger = new MockLoggerService();

  const clientFactory = (options: HassOptions) => {
    return new HomeAssistantClient(
      options,
      logger as unknown as LoggerService,
      (url: string) => {
        mockWs = new MockWebSocket(url);
        return mockWs as unknown as WebSocket;
      },
    );
  };

  test("should connect successfully with XState machine", async () => {
    const client = clientFactory({ ...mockHassOptions, maxRetries: 3 });
    try {
      // Start connection asynchronously
      const connectPromise = client.connect();

      // Wait a bit for WebSocket to be created
      await new Promise((resolve) => setTimeout(resolve, 50));

      if (mockWs) {
        // Simulate connection and authentication flow
        mockWs.connect();
        await new Promise((resolve) => setTimeout(resolve, 10));
        mockWs.receiveMessage({ type: "auth_required" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        mockWs.receiveMessage({ type: "auth_ok" });
      }

      // Wait for connection to complete
      await connectPromise;
      expect(client.connected).toBe(true);
    } finally {
      await client.disconnect();
    }
  });

  test("should handle connection failure with XState machine", async () => {
    const client = clientFactory({ ...mockHassOptions, maxRetries: 1 });
    const connectPromise = client.connect();

    // Wait for WebSocket to be created then fail it
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (mockWs) {
      mockWs.failConnection();
    }

    await expect(connectPromise).rejects.toThrow(ConnectionError);
  });

  test("should handle authentication failure", async () => {
    const client = clientFactory({ ...mockHassOptions, maxRetries: 1 });
    const connectPromise = client.connect();

    // Wait for WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (mockWs) {
      mockWs.connect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockWs.receiveMessage({ type: "auth_required" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Send auth failure
      mockWs.receiveMessage({ type: "auth_invalid" });
    }

    await expect(connectPromise).rejects.toThrow(ConnectionError);
  });

  test("should not connect when already connected", async () => {
    const client = clientFactory({ ...mockHassOptions });
    
    try {
      // First connection
      const connectPromise1 = client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (mockWs) {
        mockWs.connect();
        await new Promise((resolve) => setTimeout(resolve, 10));
        mockWs.receiveMessage({ type: "auth_required" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        mockWs.receiveMessage({ type: "auth_ok" });
      }
      await connectPromise1;
      
      expect(client.connected).toBe(true);
      
      // Second connection attempt should resolve immediately
      const startTime = Date.now();
      await client.connect();
      const endTime = Date.now();
      
      // Should resolve quickly since already connected
      expect(endTime - startTime).toBeLessThan(100);
      expect(client.connected).toBe(true);
    } finally {
      await client.disconnect();
    }
  });
});

describe("XState Home Assistant Client - Messaging", () => {
  let mockWs: MockWebSocket;
  const logger = new MockLoggerService();

  const clientFactory = () => {
    return new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
      (url: string) => {
        mockWs = new MockWebSocket(url);
        return mockWs as unknown as WebSocket;
      },
    );
  };

  async function setupConnectedClient() {
    const client = clientFactory();
    const connectPromise = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockWs.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_required" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_ok" });
    await connectPromise;
    return client;
  }

  test("should call service and handle response", async () => {
    const client = await setupConnectedClient();
    const serviceCall = HassServiceCallImpl.climate(
      "set_hvac_mode",
      "climate.test",
      { hvac_mode: "heat" },
    );

    const callPromise = client.callService(serviceCall);

    // Wait for message to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sentMessage = mockWs.getLastSentMessage();
    expect(sentMessage).toBeDefined();
    expect(sentMessage?.type).toBe("call_service");
    expect(sentMessage?.domain).toBe("climate");
    expect(sentMessage?.service).toBe("set_hvac_mode");

    // Send response
    if (sentMessage) {
      mockWs.receiveMessage({
        id: sentMessage.id,
        type: "result",
        success: true,
        result: { context: {} },
      });
    }

    await callPromise; // Should resolve
    await client.disconnect();
  });

  test("should handle event subscriptions and dispatch to handlers", async () => {
    const client = await setupConnectedClient();
    let eventHandled = false;
    let receivedEvent: any = null;

    client.addEventHandler("state_changed", (event) => {
      eventHandled = true;
      receivedEvent = event;
    });

    await client.subscribeEvents("state_changed");

    // Verify subscription message was sent
    const subscriptionMessage = mockWs.getLastSentMessage();
    expect(subscriptionMessage?.type).toBe("subscribe_events");
    expect(subscriptionMessage?.event_type).toBe("state_changed");

    // Send a state change event
    mockWs.receiveMessage({
      type: "event",
      id: 1,
      event: { 
        event_type: "state_changed", 
        data: { 
          entity_id: "sensor.test",
          new_state: { state: "on" },
          old_state: { state: "off" }
        } 
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(eventHandled).toBe(true);
    expect(receivedEvent).toBeDefined();
    expect(receivedEvent.eventType).toBe("state_changed");
    await client.disconnect();
  });

  test("should handle state change convenience method", async () => {
    const client = await setupConnectedClient();
    let stateChangeHandled = false;
    let entityId = "";
    let oldState = "";
    let newState = "";

    client.onStateChanged((id, old, current) => {
      stateChangeHandled = true;
      entityId = id;
      oldState = old;
      newState = current;
    });

    // Send a state change event
    mockWs.receiveMessage({
      type: "event",
      id: 1,
      event: { 
        event_type: "state_changed", 
        data: { 
          entity_id: "sensor.temperature",
          new_state: { 
            entity_id: "sensor.temperature",
            state: "25.5",
            attributes: {},
            last_changed: new Date().toISOString(),
            last_updated: new Date().toISOString()
          },
          old_state: { 
            entity_id: "sensor.temperature",
            state: "24.1",
            attributes: {},
            last_changed: new Date().toISOString(),
            last_updated: new Date().toISOString()
          }
        } 
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(stateChangeHandled).toBe(true);
    expect(entityId).toBe("sensor.temperature");
    expect(oldState).toBe("24.1");
    expect(newState).toBe("25.5");
    await client.disconnect();
  });

  test("should fail service call when not connected", async () => {
    const client = clientFactory();
    const serviceCall = HassServiceCallImpl.climate(
      "set_hvac_mode",
      "climate.test",
      { hvac_mode: "heat" },
    );

    await expect(client.callService(serviceCall)).rejects.toThrow(ConnectionError);
  });

  test("should fail event subscription when not connected", async () => {
    const client = clientFactory();
    
    await expect(client.subscribeEvents("state_changed")).rejects.toThrow(ConnectionError);
  });
});

describe("XState Home Assistant Client - State Management", () => {
  let mockWs: MockWebSocket;
  const logger = new MockLoggerService();

  const clientFactory = () => {
    return new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
      (url: string) => {
        mockWs = new MockWebSocket(url);
        return mockWs as unknown as WebSocket;
      },
    );
  };

  test("should track connection statistics", async () => {
    const client = clientFactory();
    
    // Initial stats
    const initialStats = client.getStats();
    expect(initialStats.totalConnections).toBe(0);
    expect(initialStats.totalMessages).toBe(0);
    expect(initialStats.totalErrors).toBe(0);
    
    // Connect
    const connectPromise = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockWs.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_required" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_ok" });
    await connectPromise;
    
    // Check stats after connection
    const connectedStats = client.getStats();
    expect(connectedStats.totalConnections).toBe(1);
    expect(connectedStats.lastConnected).toBeDefined();
    
    // Send some messages to increase message count
    mockWs.receiveMessage({ type: "pong", id: 1 });
    mockWs.receiveMessage({ type: "result", id: 2, success: true });
    
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    const finalStats = client.getStats();
    expect(finalStats.totalMessages).toBeGreaterThan(0);
    
    await client.disconnect();
  });

  test("should handle message without crashing on errors", async () => {
    const client = clientFactory();
    const connectPromise = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockWs.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_required" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockWs.receiveMessage({ type: "auth_ok" });
    await connectPromise;
    
    // Add an event handler that throws an error
    client.addEventHandler("state_changed", () => {
      throw new Error("Handler error");
    });
    
    // Send event that would trigger the error
    mockWs.receiveMessage({
      type: "event",
      id: 1,
      event: { event_type: "state_changed", data: {} },
    });
    
    await new Promise((r) => setTimeout(r, 10));
    
    // Client should still be connected despite handler error
    expect(client.connected).toBe(true);
    
    await client.disconnect();
  });
});