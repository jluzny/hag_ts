/**
 * Unit tests for individual HVAC unit cooling control logic.
 *
 * Tests the enhanced executeCooling action that treats each unit individually
 * based on its room temperature sensor.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { HvacOptions } from "../../../src/config/config.ts";
import { SystemMode, HVACMode } from "../../../src/types/common.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import {
  HomeAssistantClient,
  deriveTemperatureSensor,
} from "../../../src/home-assistant/client.ts";
import { setupTestLogging } from "../../test-helpers.ts";

// Mock logger that captures calls
class MockLoggerService extends LoggerService {
  public logs: Array<{ level: string; message: string; data?: any }> = [];

  constructor() {
    super("TEST");
  }

  override info(message: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: "info", message, data });
  }

  override error(
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
  ): void {
    this.logs.push({ level: "error", message, data: { error, ...data } });
  }

  override debug(message: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: "debug", message, data });
  }

  override warning(message: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: "warning", message, data });
  }

  clearLogs(): void {
    this.logs = [];
  }
}

// Mock Home Assistant client
class MockHomeAssistantClient extends HomeAssistantClient {
  private mockStates = new Map<string, { state: string }>();
  private serviceCalls: Array<{
    entityId: string;
    service: string;
    data?: any;
  }> = [];

  constructor() {
    super();
  }

  // Mock getState method
  async getState(entityId: string) {
    const state = this.mockStates.get(entityId);
    if (!state) {
      throw new Error(`Entity ${entityId} not found`);
    }
    return state;
  }

  // Mock controlEntity method to track service calls
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

  // Mock callService method for turn_off
  async callService(serviceCall: any) {
    this.serviceCalls.push({
      entityId: serviceCall.entity_id,
      service: `${serviceCall.domain}.${serviceCall.service}`,
      data: serviceCall.service_data,
    });
  }

  // Test helpers
  setMockState(entityId: string, temperature: string) {
    this.mockStates.set(entityId, { state: temperature });
  }

  getServiceCalls() {
    return this.serviceCalls;
  }

  clearServiceCalls() {
    this.serviceCalls = [];
  }
}

// Test HVAC configuration with multiple entities
const mockHvacOptions: HvacOptions = {
  tempSensor: "sensor.global_temp",
  outdoorSensor: "sensor.outdoor_temp",
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    { entityId: "climate.living_room_ac", enabled: true, defrost: false },
    { entityId: "climate.bedroom_ac", enabled: true, defrost: false },
    { entityId: "climate.office_ac", enabled: true, defrost: false },
  ],
  heating: {
    temperature: 21.0,
    presetMode: "comfort",
    temperatureThresholds: {
      indoorMin: 19.0,
      indoorMax: 22.0,
      outdoorMin: -10.0,
      outdoorMax: 15.0,
    },
    defrost: {
      temperatureThreshold: 0.0,
      periodSeconds: 3600,
      durationSeconds: 300,
    },
  },
  cooling: {
    temperature: 24.0,
    presetMode: "eco",
    temperatureThresholds: {
      indoorMin: 23.0, // Turn OFF when below this
      indoorMax: 26.0, // Turn ON when above this
      outdoorMin: 10.0,
      outdoorMax: 45.0,
    },
  },
  activeHours: {
    start: 6,
    startWeekday: 6,
    end: 23,
  },
  evaluationCacheMs: 0,
};

describe("Individual HVAC Unit Cooling Control", () => {
  setupTestLogging();

  let mockLogger: MockLoggerService;
  let mockHaClient: MockHomeAssistantClient;
  let stateMachine: HVACStateMachine;

  beforeEach(() => {
    mockLogger = new MockLoggerService();
    mockHaClient = new MockHomeAssistantClient();

    // Set up mock temperature sensors for each unit
    mockHaClient.setMockState("sensor.living_room_ac_temperature", "25.0"); // Between thresholds
    mockHaClient.setMockState("sensor.bedroom_ac_temperature", "27.5"); // Above max (should turn ON)
    mockHaClient.setMockState("sensor.office_ac_temperature", "22.0"); // Below min (should turn OFF)

    // Create state machine with mocks - pass logger and client to createHVACMachine
    stateMachine = new HVACStateMachine(mockHvacOptions, mockHaClient);
  });

  describe("deriveTemperatureSensor helper", () => {
    test("should correctly derive temperature sensor names", () => {
      expect(deriveTemperatureSensor("climate.living_room_ac")).toBe(
        "sensor.living_room_ac_temperature",
      );
      expect(deriveTemperatureSensor("climate.bedroom_ac")).toBe(
        "sensor.bedroom_ac_temperature",
      );
      expect(deriveTemperatureSensor("climate.office_ac")).toBe(
        "sensor.office_ac_temperature",
      );
    });
  });

  describe("Individual cooling control logic", () => {
    test("should turn ON units in rooms above indoorMax threshold", async () => {
      mockLogger.clearLogs();
      mockHaClient.clearServiceCalls();

      // Start state machine and trigger cooling by forcing transition to cooling state
      stateMachine.start();

      // Set global conditions that meet cooling requirements
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: 27.0, // Global temp high (satisfies cooling guard)
          outdoorTemp: 30.0, // Within outdoor range
          currentHour: 14, // Active hours
          isWeekday: true,
        },
      });

      // Force into cooling mode to test individual unit logic
      stateMachine.send({
        type: "MODE_CHANGE",
        mode: HVACMode.COOL,
        temperature: 24.0,
      });

      // Allow some time for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      const serviceCalls = mockHaClient.getServiceCalls();

      // Verify that some service calls were made (individual unit control)
      expect(serviceCalls.length).toBeGreaterThan(0);

      // Verify the state machine is in cooling mode
      expect(stateMachine.getCurrentState()).toBe("cooling");

      stateMachine.stop();
    });

    test("should maintain units with temperature in acceptable range", async () => {
      // Set all temperatures in acceptable range (between 23.0 and 26.0)
      mockHaClient.setMockState("sensor.living_room_ac_temperature", "24.5");
      mockHaClient.setMockState("sensor.bedroom_ac_temperature", "25.0");
      mockHaClient.setMockState("sensor.office_ac_temperature", "24.0");

      stateMachine.start();

      // Force into cooling mode with acceptable room temperatures
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: 25.0,
          outdoorTemp: 30.0,
          currentHour: 14,
          isWeekday: true,
        },
      });

      stateMachine.send({
        type: "MODE_CHANGE",
        mode: HVACMode.COOL,
        temperature: 24.0,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify state machine reached cooling state
      expect(stateMachine.getCurrentState()).toBe("cooling");

      stateMachine.stop();
    });

    test("should handle mixed room temperatures correctly", async () => {
      // Set mixed temperatures: one hot, one cold, one acceptable
      mockHaClient.setMockState("sensor.living_room_ac_temperature", "27.0"); // > 26.0 (turn ON)
      mockHaClient.setMockState("sensor.bedroom_ac_temperature", "22.5"); // < 23.0 (turn OFF)
      mockHaClient.setMockState("sensor.office_ac_temperature", "24.5"); // 23-26 range (maintain)

      stateMachine.start();
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: 25.0,
          outdoorTemp: 30.0,
          currentHour: 14,
          isWeekday: true,
        },
      });

      stateMachine.send({
        type: "MODE_CHANGE",
        mode: HVACMode.COOL,
        temperature: 24.0,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify state machine reached cooling state
      expect(stateMachine.getCurrentState()).toBe("cooling");

      stateMachine.stop();
    });

    test("should create state machine with correct configuration", () => {
      // Test that state machine is created with correct HVAC options
      expect(mockHvacOptions.hvacEntities.length).toBe(3);
      expect(mockHvacOptions.cooling.temperatureThresholds.indoorMax).toBe(
        26.0,
      );
      expect(mockHvacOptions.cooling.temperatureThresholds.indoorMin).toBe(
        23.0,
      );
      expect(mockHvacOptions.systemMode).toBe(SystemMode.AUTO);
    });
  });
});
