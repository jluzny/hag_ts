/**
 * Unit tests for HVAC Controller in HAG JavaScript variant.
 *
 * Tests controller functionality and service coordination.
 */

import { assertExists } from '@std/assert';
import { HVACController } from '../../../src/hvac/controller.ts';
import { HomeAssistantClient } from '../../../src/home-assistant/client.ts';
import { ApplicationOptions, HvacOptions } from '../../../src/config/config.ts';
import { LogLevel, SystemMode } from '../../../src/types/common.ts';
import { ActorBootstrap } from '../../../src/core/actor-bootstrap.ts';
import { EventBus } from '../../../src/core/event-system.ts';
import { ActorSystem } from '../../../src/core/actor-system.ts';


// Mock Home Assistant client
class MockHomeAssistantClient {
  serviceCalls: Array<{ domain: string; service: string; data: unknown }> = [];
  private mockStates = new Map<
    string,
    { state: string; attributes: Record<string, unknown> }
  >();
  private eventHandlers = new Map<string, Set<(event: unknown) => void>>();
  private subscribedEvents = new Set<string>();

  constructor() {
    // Set up default mock states
    this.mockStates.set('sensor.indoor_temp', {
      state: '21.5',
      attributes: { unit_of_measurement: '°C' },
    });
    this.mockStates.set('sensor.outdoor_temp', {
      state: '15.0',
      attributes: { unit_of_measurement: '°C' },
    });
  }

  async connect(): Promise<void> {
    // Mock implementation
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  get connected(): boolean {
    return true;
  }

  subscribeEvents(eventType: string): void {
    this.subscribedEvents.add(eventType);
    // Mock implementation - just track that we subscribed
  }

  getState(entityId: string) {
    const mockState = this.mockStates.get(entityId);
    if (!mockState) {
      throw new Error(`Entity ${entityId} not found`);
    }

    return {
      entityId,
      state: mockState.state,
      attributes: mockState.attributes,
      getNumericState: () => parseFloat(mockState.state),
      lastChanged: new Date(),
      lastUpdated: new Date(),
    };
  }

  callService(
    serviceCall: { domain: string; service: string; serviceData?: unknown },
  ): void {
    this.serviceCalls.push({
      domain: serviceCall.domain,
      service: serviceCall.service,
      data: serviceCall.serviceData,
    });
  }

  setMockState(
    entityId: string,
    state: string,
    attributes: Record<string, unknown> = {},
  ): void {
    this.mockStates.set(entityId, { state, attributes });
  }

  addEventHandler(eventType: string, handler: (event: unknown) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  triggerMockEvent(eventType: string, event: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  getStats() {
    return {
      totalConnections: 1,
      totalReconnections: 0,
      totalMessages: 0,
      totalErrors: 0,
    };
  }

  isSubscribedTo(eventType: string): boolean {
    return this.subscribedEvents.has(eventType);
  }
}

// Test configuration
const _mockHvacOptions: HvacOptions = {
  tempSensor: 'sensor.indoor_temp',
  outdoorSensor: 'sensor.outdoor_temp',
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    {
      entityId: 'climate.test_hvac',
      enabled: true,
      defrost: false,
    },
  ],
  heating: {
    temperature: 21.0,
    presetMode: 'comfort',
    temperatureThresholds: {
      indoorMin: 19.0,
      indoorMax: 22.0,
      outdoorMin: -10.0,
      outdoorMax: 15.0,
    },
  },
  cooling: {
    temperature: 24.0,
    presetMode: 'eco',
    temperatureThresholds: {
      indoorMin: 23.0,
      indoorMax: 26.0,
      outdoorMin: 10.0,
      outdoorMax: 45.0,
    },
  },
};

const mockAppOptions: ApplicationOptions = {
  logLevel: LogLevel.ERROR,
  useAi: false,
  aiModel: 'gpt-4o-mini',
  aiTemperature: 0.1,
};



Deno.test('HVAC Controller - Basic Functionality', async (t) => {
  await t.step('should create controller instance', () => {
    const mockHaClient = new MockHomeAssistantClient();

    const controller = new HVACController(
      _mockHvacOptions,
      mockAppOptions,
      mockHaClient as unknown as HomeAssistantClient,
      new ActorBootstrap(new EventBus(), new ActorSystem(new EventBus())),
      new EventBus(),
    );

    assertExists(controller);
  });
});


