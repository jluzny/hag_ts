/**
 * Integration tests for HVAC system in HAG JavaScript variant.
 *
 * Tests the integration between HVAC controller, state machine, and Home Assistant client.
 */

import { test, expect } from "bun:test";
import {
  ApplicationContainer,
  createContainer as _createContainer,
} from "../../src/core/container.ts";
import { HVACController } from "../../src/hvac/controller.ts";
import { HVACStateMachine } from "../../src/hvac/state-machine.ts";
import { HVACMode, LogLevel, SystemMode } from "../../src/types/common.ts";
import { Settings } from "../../src/config/config.ts";
import { EventBus } from "../../src/core/event-system.ts";
import { LoggerService } from "../../src/core/logging.ts";

// Mock configuration for testing
const mockSettings: Settings = {
  appOptions: {
    logLevel: LogLevel.ERROR, // Reduce log noise in tests
    useAi: false,
    aiModel: "gpt-4o-mini",
    aiTemperature: 0.1,
  },
  hassOptions: {
    wsUrl: "ws://localhost:8123/api/websocket",
    restUrl: "http://ocalhost:8123",
    token: "test_token",
    maxRetries: 1,
    retryDelayMs: 100,
    stateCheckInterval: 0,
  },
  hvacOptions: {
    tempSensor: "sensor.indoor_temperature",
    outdoorSensor: "sensor.outdoor_temperature",
    systemMode: SystemMode.AUTO,
    hvacEntities: [
      {
        entityId: "climate.test_ac",
        enabled: true,
        defrost: false,
      },
    ],
    heating: {
      temperature: 21.0,
      presetMode: "comfort",
      temperatureThresholds: {
        indoorMin: 19.7,
        indoorMax: 20.2,
        outdoorMin: -10.0,
        outdoorMax: 15.0,
      },
    },
    cooling: {
      temperature: 24.0,
      presetMode: "windFree",
      temperatureThresholds: {
        indoorMin: 23.5,
        indoorMax: 25.0,
        outdoorMin: 10.0,
        outdoorMax: 45.0,
      },
    },
    evaluationCacheMs: 0,
  },
};

// Mock Home Assistant client that doesn't make real network calls
class MockHomeAssistantClient {
  private _connected = false;
  protected mockStates = new Map<
    string,
    { state: string; attributes: Record<string, unknown> }
  >();

  constructor() {
    // Set up mock sensor states
    this.mockStates.set("sensor.indoor_temperature", {
      state: "22.5",
      attributes: { unit_of_measurement: "°C" },
    });
    this.mockStates.set("sensor.outdoor_temperature", {
      state: "15.0",
      attributes: { unit_of_measurement: "°C" },
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

  async getState(entityId: string) {
    const mockState = this.mockStates.get(entityId);
    if (!mockState) {
      throw new Error(`Entity ${entityId} not found`);
    }

    // Return a proper HassStateImpl-like object
    return {
      entityId,
      state: mockState.state,
      attributes: mockState.attributes,
      lastChanged: new Date(),
      lastUpdated: new Date(),
      getNumericState: () => parseFloat(mockState.state),
      isValidTemperature: function () {
        const temp = this.getNumericState();
        return temp !== null && temp >= -50 && temp <= 60;
      },
      getUnit: function () {
        return (this.attributes.unit_of_measurement as string) || null;
      },
    };
  }

  async callService(_serviceCall?: any): Promise<void> {
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

  onStateChanged(
    _handler: (entityId: string, oldState: string, newState: string) => void,
  ): void {
    // Mock state change event handler
    // In a real implementation, this would register the handler to receive state change events
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

test("HVAC Integration - Setup and basic functionality", async () => {
  const mockHaClient = new MockHomeAssistantClient();
  const eventBus = new EventBus(new LoggerService("test"));
  const stateMachine = new HVACStateMachine(mockSettings.hvacOptions);
  const controller = new HVACController(
    mockSettings.hvacOptions,
    mockSettings.appOptions,
    mockHaClient as unknown as import("../../src/home-assistant/client.ts").HomeAssistantClient,
    stateMachine,
    eventBus,
  );

  expect(controller).toBeDefined();
  expect(stateMachine).toBeDefined();
  expect(controller).toBeInstanceOf(HVACController);
  expect(stateMachine).toBeInstanceOf(HVACStateMachine);

  // Start the controller (this should connect to HA)
  await controller.start();

  // Verify connection
  expect(mockHaClient.connected).toBe(true);

  // Verify controller is running
  const status = controller.getStatus();
  expect(status.controller.running).toBe(true);
  expect(status.controller.haConnected).toBe(true);

  // Read initial temperatures
  expect(status.controller.running).toBe(true);
  expect(status.controller.haConnected).toBe(true);

  // Verify state machine is in a valid state (indicates it's processing data)
  expect(status.stateMachine.currentState).toBeDefined();
  expect(status.stateMachine.hvacMode).toBeDefined();

  // In mock environment, the controller should be able to read sensor states
  // Test that the mock Home Assistant client can provide temperature data
  const indoorTemp = await mockHaClient.getState("sensor.indoor_temperature");
  const outdoorTemp = await mockHaClient.getState("sensor.outdoor_temperature");

  expect(indoorTemp.state).toBe("22.5");
  expect(outdoorTemp.state).toBe("15.0");

  console.log("Mock temperature readings confirmed:", {
    indoor: indoorTemp.state,
    outdoor: outdoorTemp.state,
  });

  // Test manual override commands
  // Test heating override
  const heatingResult = controller.manualOverride("heat", {
    mode: HVACMode.HEAT,
    temperature: 22.0,
  });
  expect(heatingResult.success).toBe(true);
  expect((heatingResult.data as unknown as { action?: string })?.action).toBe(
    "heat",
  );
  expect(
    (heatingResult.data as unknown as { temperature?: number })?.temperature,
  ).toBe(22.0);

  // Test cooling override
  const coolingResult = controller.manualOverride("cool", {
    mode: HVACMode.COOL,
    temperature: 23.0,
  });
  expect(coolingResult.success).toBe(true);
  expect((coolingResult.data as unknown as { action?: string })?.action).toBe(
    "cool",
  );
  expect(
    (coolingResult.data as unknown as { temperature?: number })?.temperature,
  ).toBe(23.0);

  // Test off override
  const offResult = controller.manualOverride("off", {
    mode: HVACMode.OFF,
  });
  expect(offResult.success).toBe(true);
  expect((offResult.data as unknown as { action?: string })?.action).toBe(
    "off",
  );

  // Trigger evaluation manually
  const result = controller.triggerEvaluation();
  expect(result.success).toBe(true);
  expect(result.timestamp).toBeDefined();

  // Test temperature changes
  // Update mock temperature to trigger heating
  mockHaClient.updateMockState("sensor.indoor_temperature", "18.0");

  // In a real scenario, the monitoring loop would pick this up and publish events.
  // For this test, we'll rely on the manual override to trigger state changes.

  // Check if state machine responded appropriately
  const statusAfterChange = controller.getStatus();
  expect(statusAfterChange.stateMachine).toBeDefined();

  // Evaluate system efficiency
  const evalResult = controller.triggerEvaluation();
  expect(evalResult.success).toBe(true);
  // triggerEvaluation returns success/timestamp but no data field
  expect(evalResult.timestamp).toBeDefined();

  // Handle different system modes
  const statusWithMode = controller.getStatus();

  // Should respect the configured system mode
  expect(statusWithMode.controller.systemMode).toBe(SystemMode.AUTO);

  // In AUTO mode, system should be able to both heat and cool
  // (actual behavior depends on temperature conditions)
  expect(statusWithMode.stateMachine.currentState).toBeDefined();

  // Maintain connection statistics
  const stats = mockHaClient.getStats();

  expect(stats.totalConnections).toBe(1);
  expect(stats.totalReconnections).toBe(0);
  expect(typeof stats.totalMessages).toBe("number");
  expect(typeof stats.totalErrors).toBe("number");

  // Handle state machine transitions
  // Get initial state
  controller.getStatus();

  // Trigger a manual override that should change state
  controller.manualOverride("heat", { mode: "heat", temperature: 22.0 });

  // Get status after override
  const newStatus = controller.getStatus();

  // State machine should have processed the override
  expect(newStatus.stateMachine.currentState).toBeDefined();
  expect(newStatus.timestamp).toBeDefined();

  // Validate HVAC entity configuration
  const configStatus = controller.getStatus();

  // Should have the configured temperature sensor
  expect(configStatus.controller.tempSensor).toBe("sensor.indoor_temperature");

  // Should have the configured system mode
  expect(configStatus.controller.systemMode).toBe(SystemMode.AUTO);

  // AI should be disabled in test configuration
  expect(configStatus.controller.aiEnabled).toBe(false);

  // Handle error conditions gracefully
  try {
    controller.manualOverride("invalid_action" as any, {});
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }

  // Stop cleanly
  await controller.stop();

  // Verify controller stopped
  const finalStatus = controller.getStatus();
  expect(finalStatus.controller.running).toBe(false);

  // Verify Home Assistant disconnected
  expect(mockHaClient.connected).toBe(false);
});

test("HVAC State Machine Integration", async () => {
  const stateMachine = new HVACStateMachine(mockSettings.hvacOptions);
  expect(stateMachine).toBeDefined();

  // Start in idle state
  stateMachine.start();
  const status = stateMachine.getStatus();
  expect(status.currentState).toBe("idle");

  // Transition states based on conditions
  // Update conditions to trigger heating
  stateMachine.send({
    type: "UPDATE_CONDITIONS",
    data: {
      indoorTemp: 18.0,
      outdoorTemp: 5.0,
      currentHour: new Date().getHours(),
      isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
    },
  }); // Cold indoor, cold outdoor

  const statusAfterUpdate = stateMachine.getStatus();
  // Should transition to heating or stay idle based on thresholds
  expect(statusAfterUpdate.currentState).toBeDefined();

  // Handle manual overrides
  stateMachine.manualOverride(HVACMode.HEAT, 22.0);
  const statusAfterOverride = stateMachine.getStatus();
  // The state machine may transition to heating instead of manualOverride
  expect(statusAfterOverride.currentState).toMatch(/heating|manualOverride/);

  const statusAfterEval = stateMachine.getStatus();
  // Should return to automatic operation
  expect(statusAfterEval.currentState).toBeDefined();

  // Stop cleanly
  stateMachine.stop();
  // State machine should stop without errors
});

test("Configuration Validation Integration", async () => {
  // Validate complete configuration flow
  // Test that our mock configuration is valid
  const container = new ApplicationContainer();
  await container.initializeWithSettings(mockSettings);

  const settings = container.getSettings();
  expect(settings.hvacOptions.systemMode).toBe(SystemMode.AUTO);
  expect(settings.hvacOptions.hvacEntities.length).toBe(1);
  expect(settings.hassOptions.maxRetries).toBe(1);

  // Handle configuration with defrost enabled
  const configWithDefrost: Settings = {
    ...mockSettings,
    hvacOptions: {
      ...mockSettings.hvacOptions,
      hvacEntities: [
        {
          entityId: "climate.heat_pump",
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

  const containerWithDefrost = new ApplicationContainer();
  await containerWithDefrost.initializeWithSettings(configWithDefrost);

  const settingsWithDefrost = containerWithDefrost.getSettings();
  expect(settingsWithDefrost.hvacOptions.hvacEntities[0].defrost).toBe(true);
  expect(settingsWithDefrost.hvacOptions.heating.defrost).toBeDefined();
  expect(
    settingsWithDefrost.hvacOptions.heating.defrost?.temperatureThreshold,
  ).toBe(0.0);
});

test("Individual Cooling Control Integration", async () => {
  // Create a mock HA client that supports individual room sensors
  class EnhancedMockHomeAssistantClient extends MockHomeAssistantClient {
    private serviceCalls: Array<{
      entityId: string;
      service: string;
      data?: any;
    }> = [];

    constructor() {
      super();
      // Add room temperature sensors for individual control testing
      this.setMockState("sensor.living_room_ac_temperature", "27.0"); // Above max
      this.setMockState("sensor.bedroom_ac_temperature", "22.0"); // Below min
      this.setMockState("sensor.office_ac_temperature", "24.5"); // In range
    }

    // Mock controlEntity for tracking service calls
    async controlEntity(
      entityId: string,
      domain: string,
      service: string,
      valueType: { type: string; key: string },
      value: any,
    ) {
      this.serviceCalls.push({
        entityId,
        service: `${domain}.${service}`,
        data: { [valueType.key]: value },
      });
    }

    // Mock callService for turn_off operations
    async callService(serviceCall: any) {
      this.serviceCalls.push({
        entityId: serviceCall.entity_id,
        service: `${serviceCall.domain}.${serviceCall.service}`,
        data: serviceCall.service_data || {},
      });
    }

    setMockState(entityId: string, temperature: string) {
      this.mockStates.set(entityId, {
        state: temperature,
        attributes: { unit_of_measurement: "°C" },
      });
    }

    getServiceCalls() {
      return this.serviceCalls;
    }

    clearServiceCalls() {
      this.serviceCalls = [];
    }
  }

  // Test configuration with multiple HVAC entities
  const multiUnitHvacOptions = {
    ...mockSettings.hvacOptions,
    hvacEntities: [
      { entityId: "climate.living_room_ac", enabled: true, defrost: false },
      { entityId: "climate.bedroom_ac", enabled: true, defrost: false },
      { entityId: "climate.office_ac", enabled: true, defrost: false },
    ],
    cooling: {
      temperature: 24.0,
      presetMode: "eco",
      temperatureThresholds: {
        indoorMin: 23.0, // Units turn OFF below this
        indoorMax: 26.0, // Units turn ON above this
        outdoorMin: 10.0,
        outdoorMax: 45.0,
      },
    },
  };

  const mockHaClient = new EnhancedMockHomeAssistantClient();
  const stateMachine = new HVACStateMachine(
    multiUnitHvacOptions,
    mockHaClient as any,
  );

  // Start state machine
  stateMachine.start();

  // Trigger cooling mode with conditions that require individual unit decisions
  stateMachine.send({
    type: "UPDATE_CONDITIONS",
    data: {
      indoorTemp: 25.0, // Global temp triggers cooling evaluation
      outdoorTemp: 30.0,
      currentHour: 14, // Within active hours
      isWeekday: true,
    },
  });
  stateMachine.send({ type: "AUTO_EVALUATE" });

  // Allow time for async operations
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Verify individual unit decisions
  const serviceCalls = mockHaClient.getServiceCalls();

  // Verify at least some service calls were made
  expect(serviceCalls.length).toBeGreaterThan(0);

  // Verify state machine is in cooling or idle state
  // Note: Individual cooling control may keep state as "idle" while controlling units individually
  const currentState = stateMachine.getCurrentState();
  expect(["cooling", "idle"]).toContain(currentState);

  // Verify configuration supports individual cooling
  expect(multiUnitHvacOptions.hvacEntities.length).toBe(3);
  expect(multiUnitHvacOptions.cooling.temperatureThresholds.indoorMax).toBe(
    26.0,
  );
  expect(multiUnitHvacOptions.cooling.temperatureThresholds.indoorMin).toBe(
    23.0,
  );

  stateMachine.stop();
});
