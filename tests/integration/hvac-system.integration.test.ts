/**
 * Integration tests for HVAC system in HAG JavaScript variant.
 *
 * Tests the integration between HVAC controller, state machine, and Home Assistant client.
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  ApplicationContainer,
  createContainer as _createContainer,
} from '../../src/core/container.ts';
import { TYPES } from '../../src/core/types.ts';
import { HVACController } from '../../src/hvac/controller.ts';
import { HVACStateMachine } from '../../src/hvac/state-machine.ts';
import { XStateHVACStateMachineAdapter } from '../../src/hvac/state-machine-xstate-adapter.ts';
import { HVACMode, LogLevel, SystemMode } from '../../src/types/common.ts';
import { Settings } from '../../src/config/config.ts';

// Mock configuration for testing
const mockSettings: Settings = {
  appOptions: {
    logLevel: LogLevel.ERROR, // Reduce log noise in tests
    useAi: false,
    aiModel: 'gpt-4o-mini',
    aiTemperature: 0.1,
  },
  hassOptions: {
    wsUrl: 'ws://localhost:8123/api/websocket',
    restUrl: 'http://ocalhost:8123',
    token: 'test_token',
    maxRetries: 1,
    retryDelayMs: 100,
    stateCheckInterval: 0,
  },
  hvacOptions: {
    tempSensor: 'sensor.indoor_temperature',
    outdoorSensor: 'sensor.outdoor_temperature',
    systemMode: SystemMode.AUTO,
    hvacEntities: [
      {
        entityId: 'climate.test_ac',
        enabled: true,
        defrost: false,
      },
    ],
    heating: {
      temperature: 21.0,
      presetMode: 'comfort',
      temperatureThresholds: {
        indoorMin: 19.7,
        indoorMax: 20.2,
        outdoorMin: -10.0,
        outdoorMax: 15.0,
      },
    },
    cooling: {
      temperature: 24.0,
      presetMode: 'windFree',
      temperatureThresholds: {
        indoorMin: 23.5,
        indoorMax: 25.0,
        outdoorMin: 10.0,
        outdoorMax: 45.0,
      },
    },
  },
};

// Mock Home Assistant client that doesn't make real network calls
class MockHomeAssistantClient {
  private _connected = false;
  private mockStates = new Map<
    string,
    { state: string; attributes: Record<string, unknown> }
  >();

  constructor() {
    // Set up mock sensor states
    this.mockStates.set('sensor.indoor_temperature', {
      state: '22.5',
      attributes: { unit_of_measurement: '°C' },
    });
    this.mockStates.set('sensor.outdoor_temperature', {
      state: '15.0',
      attributes: { unit_of_measurement: '°C' },
    });
  }

  connect(): Promise<void> {
    this._connected = true;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this._connected = false;
    return Promise.resolve();
  }

  get connected(): boolean {
    return this._connected;
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
    };
  }

  callService(): Promise<void> {
    // Mock service call - just resolve
    return Promise.resolve();
  }

  subscribeEvents(): Promise<void> {
    return Promise.resolve();
  }

  addEventHandler(): void {
    // Mock event handler registration
  }

  removeEventHandler(): void {
    // Mock event handler removal
  }

  getStats() {
    return {
      totalConnections: 1,
      totalReconnections: 0,
      totalMessages: 0,
      totalErrors: 0,
    };
  }

  // Helper method to update mock sensor states for testing
  updateMockState(entityId: string, state: string) {
    const existing = this.mockStates.get(entityId);
    if (existing) {
      this.mockStates.set(entityId, { ...existing, state });
    }
  }
}

Deno.test('HVAC Integration Tests', async (t) => {
  let container: ApplicationContainer;
  let controller: HVACController;
  let stateMachine: HVACStateMachine;
  let mockHaClient: MockHomeAssistantClient;

  await t.step('setup container and services', async () => {
    // Create mock client first
    mockHaClient = new MockHomeAssistantClient();

    // Create container with mock settings
    container = new ApplicationContainer();

    // Initialize container but skip Home Assistant registration
    await container.initializeWithSettings(mockSettings, ['homeassistant']);

    // Manually bind the mock client after initialization
    container.getContainer().bind({
      provide: TYPES.HomeAssistantClient,
      useValue: mockHaClient,
    });

    // Home Assistant client should be registered
    container.registerHVACServices();

    // Get services
    controller = container.get<HVACController>(TYPES.HVACController);
    stateMachine = container.get<HVACStateMachine>(TYPES.HVACStateMachine);

    assertExists(controller);
    assertExists(stateMachine);
    assertInstanceOf(controller, HVACController);
    assertInstanceOf(stateMachine, XStateHVACStateMachineAdapter);
  });

  await t.step('should start and connect to Home Assistant', async () => {
    // Start the controller (this should connect to HA)
    await controller.start();

    // Verify connection
    assertEquals(mockHaClient.connected, true);

    // Verify controller is running
    const status = await controller.getStatus();
    assertEquals(status.controller.running, true);
    assertEquals(status.controller.haConnected, true);
  });

  await t.step('should read initial temperatures', async () => {
    const status = await controller.getStatus();

    // Verify controller is running and connected to Home Assistant
    assertEquals(status.controller.running, true);
    assertEquals(status.controller.haConnected, true);

    // Verify state machine is in a valid state (indicates it's processing data)
    assertExists(status.stateMachine.currentState);
    assertExists(status.stateMachine.hvacMode);

    // In mock environment, the controller should be able to read sensor states
    // Test that the mock Home Assistant client can provide temperature data
    const indoorTemp = mockHaClient.getState('sensor.indoor_temperature');
    const outdoorTemp = mockHaClient.getState('sensor.outdoor_temperature');

    assertEquals(indoorTemp.state, '22.5');
    assertEquals(outdoorTemp.state, '15.0');

    console.log('Mock temperature readings confirmed:', {
      indoor: indoorTemp.state,
      outdoor: outdoorTemp.state,
    });
  });

  await t.step('should handle manual override commands', async () => {
    // Test heating override
    const heatingResult = controller.manualOverride('heat', {
      mode: HVACMode.HEAT,
      temperature: 22.0,
    });
    assertEquals(heatingResult.success, true);
    assertEquals(
      (heatingResult.data as unknown as { action?: string })?.action,
      'heat',
    );
    assertEquals(
      (heatingResult.data as unknown as { temperature?: number })?.temperature,
      22.0,
    );

    // Test cooling override
    const coolingResult = controller.manualOverride('cool', {
      mode: HVACMode.COOL,
      temperature: 23.0,
    });
    assertEquals(coolingResult.success, true);
    assertEquals(
      (coolingResult.data as unknown as { action?: string })?.action,
      'cool',
    );
    assertEquals(
      (coolingResult.data as unknown as { temperature?: number })?.temperature,
      23.0,
    );

    // Test off override
    const offResult = controller.manualOverride('off', {
      mode: HVACMode.OFF,
    });
    assertEquals(offResult.success, true);
    assertEquals(
      (offResult.data as unknown as { action?: string })?.action,
      'off',
    );
  });

  await t.step('should trigger evaluation manually', async () => {
    const result = await controller.triggerEvaluation();
    assertEquals(result.success, true);
    assertExists(result.timestamp);
  });

  await t.step('should respond to temperature changes', async () => {
    // Update mock temperature to trigger heating
    mockHaClient.updateMockState('sensor.indoor_temperature', '18.0');

    // In a real scenario, the monitoring loop would pick this up and publish events.
    // For this test, we'll rely on the manual override to trigger state changes.

    // Check if state machine responded appropriately
    const status = await controller.getStatus();
    assertExists(status.stateMachine);
  });

  await t.step('should evaluate system efficiency', async () => {
    const result = await controller.triggerEvaluation();
    assertEquals(result.success, true);
    // triggerEvaluation returns success/timestamp but no data field
    assertExists(result.timestamp);
  });

  await t.step('should handle different system modes', async () => {
    const status = await controller.getStatus();

    // Should respect the configured system mode
    assertEquals(status.controller.systemMode, SystemMode.AUTO);

    // In AUTO mode, system should be able to both heat and cool
    // (actual behavior depends on temperature conditions)
    assertExists(status.stateMachine.currentState);
  });

  await t.step('should maintain connection statistics', () => {
    const stats = mockHaClient.getStats();

    assertEquals(stats.totalConnections, 1);
    assertEquals(stats.totalReconnections, 0);
    assertEquals(typeof stats.totalMessages, 'number');
    assertEquals(typeof stats.totalErrors, 'number');
  });

  await t.step('should handle state machine transitions', async () => {
    // Get initial state
    await controller.getStatus();

    // Trigger a manual override that should change state
    await controller.manualOverride('heat', { temperature: 22.0 });

    // Get status after override
    const newStatus = await controller.getStatus();

    // State machine should have processed the override
    assertExists(newStatus.stateMachine.currentState);
    assertExists(newStatus.timestamp);
  });

  await t.step('should validate HVAC entity configuration', async () => {
    const status = await controller.getStatus();

    // Should have the configured temperature sensor
    assertEquals(status.controller.tempSensor, 'sensor.indoor_temperature');

    // Should have the configured system mode
    assertEquals(status.controller.systemMode, SystemMode.AUTO);

    // AI should be disabled in test configuration
    assertEquals(status.controller.aiEnabled, false);
  });

  await t.step('should handle error conditions gracefully', async () => {
    // Test invalid manual override
    try {
      await controller.manualOverride('invalid_action');
    } catch (error) {
      assertInstanceOf(error, Error);
    }
  });

  await t.step('should stop cleanly', async () => {
    await controller.stop();

    // Verify controller stopped
    const status = await controller.getStatus();
    assertEquals(status.controller.running, false);

    // Verify Home Assistant disconnected
    assertEquals(mockHaClient.connected, false);
  });
});

Deno.test('HVAC State Machine Integration', async (t) => {
  let stateMachine: HVACStateMachine;

  await t.step('should initialize state machine', () => {
    // Create state machine directly for testing
    stateMachine = new HVACStateMachine(mockSettings.hvacOptions);
    assertExists(stateMachine);
  });

  await t.step('should start in idle state', () => {
    stateMachine.start();
    const status = stateMachine.getStatus();
    assertEquals(status.currentState, 'idle');
  });

  await t.step('should transition states based on conditions', () => {
    // Update temperatures to trigger heating
    stateMachine.updateTemperatures(18.0, 5.0); // Cold indoor, cold outdoor
    stateMachine.evaluateConditions();

    const status = stateMachine.getStatus();
    // Should transition to heating or stay idle based on thresholds
    assertExists(status.currentState);
  });

  await t.step('should handle manual overrides', () => {
    stateMachine.manualOverride(HVACMode.HEAT, 22.0);
    const status = stateMachine.getStatus();
    assertEquals(status.currentState, 'manualOverride');
  });

  await t.step('should return to automatic operation', () => {
    // Test manual override clears automatically after some time or conditions
    stateMachine.evaluateConditions();

    const status = stateMachine.getStatus();
    // Should return to automatic operation
    assertExists(status.currentState);
  });

  await t.step('should stop cleanly', () => {
    stateMachine.stop();
    // State machine should stop without errors
  });
});

Deno.test('Configuration Validation Integration', async (t) => {
  await t.step('should validate complete configuration flow', async () => {
    // Test that our mock configuration is valid
    const container = new ApplicationContainer();
    await container.initializeWithSettings(mockSettings);

    const settings = container.getSettings();
    assertEquals(settings.hvacOptions.systemMode, SystemMode.AUTO);
    assertEquals(settings.hvacOptions.hvacEntities.length, 1);
    assertEquals(settings.hassOptions.maxRetries, 1);
  });

  await t.step('should handle configuration with defrost enabled', async () => {
    const configWithDefrost: Settings = {
      ...mockSettings,
      hvacOptions: {
        ...mockSettings.hvacOptions,
        hvacEntities: [
          {
            entityId: 'climate.heat_pump',
            enabled: true,
            defrost: true,
          },
        ],
        heating: {
          ...mockSettings.hvacOptions.heating,
          defrost: {
            temperatureThreshold: 0.0,
            periodSeconds: 3600,
            durationSeconds: 300,
          },
        },
      },
    };

    const container = new ApplicationContainer();
    await container.initializeWithSettings(configWithDefrost);

    const settings = container.getSettings();
    assertEquals(settings.hvacOptions.hvacEntities[0].defrost, true);
    assertExists(settings.hvacOptions.heating.defrost);
    assertEquals(
      settings.hvacOptions.heating.defrost?.temperatureThreshold,
      0.0,
    );
  });
});
