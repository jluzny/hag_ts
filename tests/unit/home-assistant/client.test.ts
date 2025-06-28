/**
 * Unit tests for Home Assistant client in HAG JavaScript variant.
 * 
 * Tests WebSocket connection, REST API calls, and event handling.
 */

import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { HomeAssistantClient } from '../../../src/home-assistant/client.ts';
import { HassOptions } from '../../../src/config/config.ts';
import { ConnectionError, StateError } from '../../../src/core/exceptions.ts';
import { HassStateImpl, HassServiceCallImpl } from '../../../src/home-assistant/models.ts';
import { HVACMode } from '../../../src/types/common.ts';
import type { LoggerService } from '../../../src/core/logger.ts';

// Mock logger service
class MockLoggerService {
  info(_message: string, _data?: Record<string, unknown>): void {
    // console.log(`INFO: ${message}`);
  }

  error(_message: string, _error?: unknown): void {
    // console.log(`ERROR: ${message}`);
  }

  debug(_message: string, _data?: Record<string, unknown>): void {
    // console.log(`DEBUG: ${message}`);
  }

  warning(_message: string, _data?: Record<string, unknown>): void {
    // console.log(`WARNING: ${message}`);
  }
}

// Mock WebSocket implementation
class MockWebSocket {
  public url: string;
  public readyState: number = WebSocket.CONNECTING;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  private shouldFailConnection = false;
  private shouldFailSend = false;
  private messageQueue: string[] = [];

  constructor(url: string) {
    this.url = url;
    
    // Simulate async connection
    setTimeout(() => {
      if (this.shouldFailConnection) {
        this.readyState = WebSocket.CLOSED;
        if (this.onerror) {
          this.onerror(new Event('error'));
        }
      } else {
        this.readyState = WebSocket.OPEN;
        if (this.onopen) {
          this.onopen(new Event('open'));
        }
      }
    }, 10);
  }

  send(data: string): void {
    if (this.shouldFailSend) {
      throw new Error('Send failed');
    }
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.messageQueue.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Test helpers
  setFailConnection(fail: boolean): void {
    this.shouldFailConnection = fail;
  }

  setFailSend(fail: boolean): void {
    this.shouldFailSend = fail;
  }

  simulateMessage(data: string): void {
    if (this.onmessage && this.readyState === WebSocket.OPEN) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  getLastMessage(): string | undefined {
    return this.messageQueue[this.messageQueue.length - 1];
  }

  clearMessages(): void {
    this.messageQueue = [];
  }
}

// Store original WebSocket and mock it
const originalWebSocket = globalThis.WebSocket;
let mockWebSocketInstance: MockWebSocket | null = null;

function setupWebSocketMock() {
  globalThis.WebSocket = class extends EventTarget {
    constructor(url: string) {
      super();
      mockWebSocketInstance = new MockWebSocket(url);
      return mockWebSocketInstance as unknown as WebSocket;
    }
    
    static get CONNECTING() { return 0; }
    static get OPEN() { return 1; }
    static get CLOSING() { return 2; }
    static get CLOSED() { return 3; }
  } as unknown as typeof WebSocket;
}

function teardownWebSocketMock() {
  globalThis.WebSocket = originalWebSocket;
  mockWebSocketInstance = null;
}

// Test configuration
const mockHassOptions: HassOptions = {
  wsUrl: 'ws://localhost:8123/api/websocket',
  restUrl: 'http://localhost:8123',
  token: 'test_token',
  maxRetries: 3,
  retryDelayMs: 100, // Short delay for tests
  stateCheckInterval: 300000, // Required property
};

Deno.test('Home Assistant Client - Initialization', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should initialize with configuration', () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    assertExists(client);
    assertEquals(client.connected, false);
  });

  await t.step('should provide connection stats', () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    const stats = client.getStats();
    assertExists(stats);
    assertEquals(stats.totalConnections, 0);
    assertEquals(stats.totalReconnections, 0);
    assertEquals(stats.totalMessages, 0);
    assertEquals(stats.totalErrors, 0);
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Connection Management', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should connect successfully', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    
    // Give time for async connection
    await new Promise(resolve => setTimeout(resolve, 20));
    
    assertEquals(client.connected, true);
    
    await client.disconnect();
  });

  await t.step('should handle connection failure', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    // Make WebSocket connection fail
    if (mockWebSocketInstance) {
      mockWebSocketInstance.setFailConnection(true);
    }

    await assertRejects(
      () => client.connect(),
      ConnectionError,
      'Connection failed'
    );
  });

  await t.step('should disconnect gracefully', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));
    
    assertEquals(client.connected, true);
    
    await client.disconnect();
    assertEquals(client.connected, false);
  });

  await t.step('should handle multiple connection attempts', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    // First connection
    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEquals(client.connected, true);

    // Second connection attempt should be handled gracefully
    await client.connect();
    assertEquals(client.connected, true);

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Message Handling', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should send messages', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Mock a service call
    const serviceCall = HassServiceCallImpl.climate('set_hvac_mode', 'climate.test', {
      hvac_mode: HVACMode.HEAT,
    });

    await client.callService(serviceCall);

    // Verify message was sent
    const lastMessage = mockWebSocketInstance?.getLastMessage();
    assertExists(lastMessage);
    
    const parsedMessage = JSON.parse(lastMessage);
    assertEquals(parsedMessage.type, 'call_service');
    assertEquals(parsedMessage.domain, 'climate');
    assertEquals(parsedMessage.service, 'set_hvac_mode');

    await client.disconnect();
  });

  await t.step('should handle send failures', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Make send fail
    if (mockWebSocketInstance) {
      mockWebSocketInstance.setFailSend(true);
    }

    const serviceCall = HassServiceCallImpl.climate('set_hvac_mode', 'climate.test', {
      hvac_mode: HVACMode.HEAT,
    });

    await assertRejects(
      () => client.callService(serviceCall),
      ConnectionError,
      'Failed to send message'
    );

    await client.disconnect();
  });

  await t.step('should handle incoming messages', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate incoming state change message
    const stateChangeMessage = {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'sensor.temperature',
          new_state: {
            entity_id: 'sensor.temperature',
            state: '21.5',
            attributes: {
              unit_of_measurement: '°C',
            },
          },
          old_state: {
            entity_id: 'sensor.temperature',
            state: '21.0',
            attributes: {
              unit_of_measurement: '°C',
            },
          },
        },
        time_fired: new Date().toISOString(),
      },
    };

    mockWebSocketInstance?.simulateMessage(JSON.stringify(stateChangeMessage));

    // Give time for message processing
    await new Promise(resolve => setTimeout(resolve, 10));

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Event Handling', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should subscribe to events', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    await client.subscribeEvents('state_changed');

    // Verify subscription message was sent
    const lastMessage = mockWebSocketInstance?.getLastMessage();
    assertExists(lastMessage);
    
    const parsedMessage = JSON.parse(lastMessage);
    assertEquals(parsedMessage.type, 'subscribe_events');
    assertEquals(parsedMessage.event_type, 'state_changed');

    await client.disconnect();
  });

  await t.step('should handle event handlers', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    let eventReceived = false;
    let receivedEvent: unknown = null;

    // Add event handler
    client.addEventHandler('state_changed', (event) => {
      eventReceived = true;
      receivedEvent = event;
    });

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate event
    const stateChangeMessage = {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: 'sensor.temperature',
          new_state: {
            entity_id: 'sensor.temperature',
            state: '22.0',
            attributes: {},
          },
        },
        time_fired: new Date().toISOString(),
      },
    };

    mockWebSocketInstance?.simulateMessage(JSON.stringify(stateChangeMessage));

    // Give time for event processing
    await new Promise(resolve => setTimeout(resolve, 10));

    assertEquals(eventReceived, true);
    assertExists(receivedEvent);

    await client.disconnect();
  });

  await t.step('should remove event handlers', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    let eventCount = 0;
    const handler = () => { eventCount++; };

    client.addEventHandler('state_changed', handler);
    client.removeEventHandler('state_changed', handler);

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate event
    const stateChangeMessage = {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: { entity_id: 'sensor.test' },
        time_fired: new Date().toISOString(),
      },
    };

    mockWebSocketInstance?.simulateMessage(JSON.stringify(stateChangeMessage));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Event should not be received since handler was removed
    assertEquals(eventCount, 0);

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - State Operations', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should get entity state', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Mock state response
    const stateRequest = client.getState('sensor.temperature');

    // Simulate state response
    setTimeout(() => {
      const stateResponse = {
        type: 'result',
        success: true,
        result: {
          entity_id: 'sensor.temperature',
          state: '21.5',
          attributes: {
            unit_of_measurement: '°C',
            friendly_name: 'Temperature',
          },
          last_changed: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
      };

      mockWebSocketInstance?.simulateMessage(JSON.stringify(stateResponse));
    }, 5);

    const state = await stateRequest;
    
    assertExists(state);
    assertEquals(state.entityId, 'sensor.temperature');
    assertEquals(state.state, '21.5');
    assertEquals(state.getNumericState(), 21.5);

    await client.disconnect();
  });

  await t.step('should handle state fetch errors', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    const stateRequest = client.getState('sensor.nonexistent');

    // Simulate error response
    setTimeout(() => {
      const errorResponse = {
        type: 'result',
        success: false,
        error: {
          code: 'not_found',
          message: 'Entity not found',
        },
      };

      mockWebSocketInstance?.simulateMessage(JSON.stringify(errorResponse));
    }, 5);

    await assertRejects(
      () => stateRequest,
      StateError,
    );

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Service Calls', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should call climate services', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Test different climate service calls
    const services = [
      HassServiceCallImpl.climate('set_hvac_mode', 'climate.test', { hvac_mode: 'heat' }),
      HassServiceCallImpl.climate('set_temperature', 'climate.test', { temperature: 21.0 }),
      HassServiceCallImpl.climate('set_preset_mode', 'climate.test', { preset_mode: 'comfort' }),
    ];

    for (const serviceCall of services) {
      mockWebSocketInstance?.clearMessages();
      
      const callPromise = client.callService(serviceCall);

      // Simulate success response
      setTimeout(() => {
        const response = {
          type: 'result',
          success: true,
          result: {},
        };
        mockWebSocketInstance?.simulateMessage(JSON.stringify(response));
      }, 5);

      await callPromise;

      // Verify correct message was sent
      const message = JSON.parse(mockWebSocketInstance?.getLastMessage() || '{}');
      assertEquals(message.type, 'call_service');
      assertEquals(message.domain, 'climate');
    }

    await client.disconnect();
  });

  await t.step('should handle service call failures', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    const serviceCall = HassServiceCallImpl.climate('set_hvac_mode', 'climate.nonexistent', {
      hvac_mode: 'heat',
    });

    const callPromise = client.callService(serviceCall);

    // Simulate error response
    setTimeout(() => {
      const errorResponse = {
        type: 'result',
        success: false,
        error: {
          code: 'entity_not_found',
          message: 'Entity not found',
        },
      };
      mockWebSocketInstance?.simulateMessage(JSON.stringify(errorResponse));
    }, 5);

    await assertRejects(
      () => callPromise,
      StateError,
    );

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Connection Recovery', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should handle connection drops', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEquals(client.connected, true);

    // Simulate connection drop
    mockWebSocketInstance?.close();
    await new Promise(resolve => setTimeout(resolve, 10));
    
    assertEquals(client.connected, false);

    await client.disconnect();
  });

  await t.step('should track connection statistics', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    const initialStats = client.getStats();
    assertEquals(initialStats.totalConnections, 0);

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    const connectedStats = client.getStats();
    assertEquals(connectedStats.totalConnections, 1);

    await client.disconnect();
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Error Scenarios', async (t) => {
  setupWebSocketMock();
  const logger = new MockLoggerService();

  await t.step('should handle malformed messages', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 20));

    // Send malformed JSON
    mockWebSocketInstance?.simulateMessage('invalid json');
    
    // Should handle gracefully without throwing
    await new Promise(resolve => setTimeout(resolve, 10));

    await client.disconnect();
  });

  await t.step('should handle operation when not connected', async () => {
    const client = new HomeAssistantClient(
      mockHassOptions,
      logger as unknown as LoggerService,
    );

    // Try to call service without connection
    const serviceCall = HassServiceCallImpl.climate('set_hvac_mode', 'climate.test', {
      hvac_mode: 'heat',
    });

    await assertRejects(
      () => client.callService(serviceCall),
      ConnectionError,
      'WebSocket not connected'
    );
  });

  await t.step('should handle invalid configuration', () => {
    const invalidOptions = {
      ...mockHassOptions,
      wsUrl: 'invalid-url',
    };

    // Should still create client but connection will fail
    const client = new HomeAssistantClient(
      invalidOptions,
      logger as unknown as LoggerService,
    );
    
    assertExists(client);
  });

  teardownWebSocketMock();
});

Deno.test('Home Assistant Client - Models Integration', async (t) => {
  await t.step('should create service calls correctly', () => {
    const serviceCall = HassServiceCallImpl.climate('set_hvac_mode', 'climate.test', {
      hvac_mode: HVACMode.HEAT,
    });

    assertEquals(serviceCall.domain, 'climate');
    assertEquals(serviceCall.service, 'set_hvac_mode');
    assertEquals(serviceCall.target?.entityId, 'climate.test');
    assertEquals(serviceCall.serviceData.hvac_mode, HVACMode.HEAT);
  });

  await t.step('should create state objects correctly', () => {
    const stateData = {
      entity_id: 'sensor.temperature',
      state: '21.5',
      attributes: {
        unit_of_measurement: '°C',
      },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };

    const state = HassStateImpl.fromApiResponse(stateData);

    assertEquals(state.entityId, 'sensor.temperature');
    assertEquals(state.state, '21.5');
    assertEquals(state.getNumericState(), 21.5);
    assertExists(state.attributes);
  });

  await t.step('should handle non-numeric states', () => {
    const stateData = {
      entity_id: 'switch.test',
      state: 'on',
      attributes: {},
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };

    const state = HassStateImpl.fromApiResponse(stateData);
    assertEquals(state.getNumericState(), null);
  });
});