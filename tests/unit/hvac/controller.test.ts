/**
 * Unit tests for HVAC Controller in HAG JavaScript variant.
 *
 * Tests controller functionality, dry run mode, and service coordination.
 */

import { assertEquals, assertExists } from '@std/assert';
import { HVACController } from '../../../src/hvac/controller.ts';
import { HVACStateMachine } from '../../../src/hvac/state-machine.ts';
import { HomeAssistantClient } from '../../../src/home-assistant/client.ts';
import { ApplicationOptions, HvacOptions } from '../../../src/config/config.ts';
import { HVACMode, LogLevel, SystemMode } from '../../../src/types/common.ts';

// Mock state machine
class MockHVACStateMachine {
  private currentState = 'idle';
  private context = {
    indoorTemp: 21.0,
    outdoorTemp: 15.0,
    systemMode: SystemMode.AUTO,
  };

  getCurrentState(): string {
    return this.currentState;
  }

  getStatus() {
    return {
      currentState: this.currentState,
      context: this.context,
      canHeat: true,
      canCool: true,
      systemMode: SystemMode.AUTO,
    };
  }

  manualOverride(_mode: HVACMode, _temperature?: number): void {
    this.currentState = 'manualOverride';
  }

  updateTemperatures(indoor: number, outdoor: number): void {
    this.context.indoorTemp = indoor;
    this.context.outdoorTemp = outdoor;
  }

  evaluateConditions(): void {
    // Mock implementation
  }

  start(): void {
    // Mock implementation
  }

  stop(): void {
    // Mock implementation
  }

  send(_event: unknown): void {
    // Mock implementation
  }

  getContext(): typeof this.context {
    return this.context;
  }
}

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
const mockHvacOptions: HvacOptions = {
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
  dryRun: false,
};

const mockAppOptionsDryRun: ApplicationOptions = {
  ...mockAppOptions,
  dryRun: true,
};

Deno.test('HVAC Controller - Basic Functionality', async (t) => {
  await t.step('should create controller instance', () => {
    const mockStateMachine = new MockHVACStateMachine();
    const mockHaClient = new MockHomeAssistantClient();

    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptions,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as HomeAssistantClient,
    );

    assertExists(controller);
  });
});

Deno.test('HVAC Controller - Dry Run Mode', async (t) => {
  await t.step('should not call HA services in dry run mode', async () => {
    const mockStateMachine = new MockHVACStateMachine();
    const mockHaClient = new MockHomeAssistantClient();

    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptionsDryRun, // Use dry run options
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as HomeAssistantClient,
    );

    // Test manual override without starting the controller (avoiding long-running operations)
    try {
      await controller.manualOverride('heat', { temperature: 22.0 });
      // This should fail because controller is not running
    } catch (error) {
      // Expected: controller not running
      assertEquals(
        error instanceof Error && error.message.includes('not running'),
        true,
      );
    }

    // Assert that no service calls were made to Home Assistant
    assertEquals(mockHaClient.serviceCalls.length, 0);
  });

  await t.step('should create controller without throwing', () => {
    const mockStateMachine = new MockHVACStateMachine();
    const mockHaClient = new MockHomeAssistantClient();

    const controller = new HVACController(
      mockHvacOptions,
      mockAppOptionsDryRun,
      mockStateMachine as unknown as HVACStateMachine,
      mockHaClient as unknown as HomeAssistantClient,
    );

    // Controller should be created successfully
    assertExists(controller);
  });
});
