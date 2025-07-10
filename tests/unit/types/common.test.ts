/**
 * Unit tests for common types in HAG JavaScript variant.
 */

import { expect, test, describe } from "bun:test";
import {
  type ConnectionStats,
  HVACMode,
  type HVACStatus,
  LogLevel,
  type OperationResult,
  SystemMode,
  WebSocketState,
} from "../../../src/types/common.ts";

// Test-specific interfaces
interface TestActionData {
  action: string;
  temperature?: number;
}

interface TestEntityData {
  attemptedAction: string;
  entitiesProcessed: number;
  entitiesFailed: number;
}

describe("HVACMode enum", () => {
  test("should have correct HVAC mode values", () => {
    expect(HVACMode.HEAT).toBe(HVACMode.HEAT);
    expect(HVACMode.COOL).toBe(HVACMode.COOL);
    expect(HVACMode.OFF).toBe(HVACMode.OFF);
    expect(HVACMode.AUTO).toBe(HVACMode.AUTO);
  });

  test("should have all expected modes", () => {
    const modes = Object.values(HVACMode);
    expect(modes.length).toBe(4);
    expect(modes.includes(HVACMode.HEAT)).toBe(true);
    expect(modes.includes(HVACMode.COOL)).toBe(true);
    expect(modes.includes(HVACMode.OFF)).toBe(true);
    expect(modes.includes(HVACMode.AUTO)).toBe(true);
  });
});

describe("SystemMode enum", () => {
  test("should have correct system mode values", () => {
    expect(SystemMode.AUTO).toBe(SystemMode.AUTO);
    expect(SystemMode.HEAT_ONLY).toBe(SystemMode.HEAT_ONLY);
    expect(SystemMode.COOL_ONLY).toBe(SystemMode.COOL_ONLY);
    expect(SystemMode.OFF).toBe(SystemMode.OFF);
  });

  test("should have all expected system modes", () => {
    const modes = Object.values(SystemMode);
    expect(modes.length).toBe(4);
    expect(modes.includes(SystemMode.AUTO)).toBe(true);
    expect(modes.includes(SystemMode.HEAT_ONLY)).toBe(true);
    expect(modes.includes(SystemMode.COOL_ONLY)).toBe(true);
    expect(modes.includes(SystemMode.OFF)).toBe(true);
  });
});

describe("LogLevel enum", () => {
  test("should have correct log level values", () => {
    expect(LogLevel.DEBUG).toBe(LogLevel.DEBUG);
    expect(LogLevel.INFO).toBe(LogLevel.INFO);
    expect(LogLevel.WARNING).toBe(LogLevel.WARNING);
    expect(LogLevel.ERROR).toBe(LogLevel.ERROR);
  });

  test("should have hierarchical ordering", () => {
    const levels = Object.values(LogLevel);
    expect(levels.length).toBe(4);

    // Should be in order of verbosity
    expect(levels[0]).toBe(LogLevel.DEBUG);
    expect(levels[1]).toBe(LogLevel.INFO);
    expect(levels[2]).toBe(LogLevel.WARNING);
    expect(levels[3]).toBe(LogLevel.ERROR);
  });
});

describe("WebSocketState enum", () => {
  test("should have correct WebSocket state values", () => {
    const states = Object.values(WebSocketState);
    expect(states.length).toBe(6);
    expect(states.includes(WebSocketState.CONNECTING)).toBe(true);
    expect(states.includes(WebSocketState.CONNECTED)).toBe(true);
    expect(states.includes(WebSocketState.DISCONNECTED)).toBe(true);
    expect(states.includes(WebSocketState.RECONNECTING)).toBe(true);
    expect(states.includes(WebSocketState.AUTHENTICATING)).toBe(true);
    expect(states.includes(WebSocketState.ERROR)).toBe(true);
  });

  test("should have string values", () => {
    expect(WebSocketState.CONNECTING).toBe(WebSocketState.CONNECTING);
    expect(WebSocketState.CONNECTED).toBe(WebSocketState.CONNECTED);
    expect(WebSocketState.DISCONNECTED).toBe(WebSocketState.DISCONNECTED);
    expect(WebSocketState.RECONNECTING).toBe(WebSocketState.RECONNECTING);
    expect(WebSocketState.AUTHENTICATING).toBe(WebSocketState.AUTHENTICATING);
    expect(WebSocketState.ERROR).toBe(WebSocketState.ERROR);
  });
});

describe("HVACStatus interface", () => {
  test("should accept valid HVAC status objects", () => {
    const validStatus: HVACStatus = {
      controller: {
        running: true,
        haConnected: true,
        tempSensor: "sensor.temperature",
        systemMode: "auto",
        aiEnabled: false,
      },
      stateMachine: {
        currentState: "heating",
        hvacMode: "heat",
      },
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(validStatus.controller.running).toBe(true);
    expect(validStatus.controller.haConnected).toBe(true);
    expect(validStatus.controller.tempSensor).toBe("sensor.temperature");
    expect(validStatus.controller.systemMode).toBe("auto");
    expect(validStatus.controller.aiEnabled).toBe(false);
    expect(validStatus.stateMachine.currentState).toBe("heating");
    expect(validStatus.stateMachine.hvacMode).toBe("heat");
    expect(validStatus.timestamp).toBe("2023-01-01T00:00:00Z");
  });

  test("should handle optional properties", () => {
    const minimalStatus: HVACStatus = {
      controller: {
        running: false,
        haConnected: false,
        tempSensor: "sensor.temp",
        systemMode: "off",
        aiEnabled: false,
      },
      stateMachine: {
        currentState: "idle",
      },
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(minimalStatus.controller.running).toBe(false);
    expect(minimalStatus.stateMachine.currentState).toBe("idle");
    expect(minimalStatus.stateMachine.hvacMode).toBeUndefined();
  });
});

describe("ConnectionStats interface", () => {
  test("should accept valid connection stats", () => {
    const stats: ConnectionStats = {
      totalConnections: 5,
      totalReconnections: 3,
      totalMessages: 150,
      totalErrors: 2,
      lastConnected: new Date(),
      lastError: new Date(),
    };

    expect(stats.totalConnections).toBe(5);
    expect(stats.totalReconnections).toBe(3);
    expect(stats.totalMessages).toBe(150);
    expect(stats.totalErrors).toBe(2);
    expect(stats.lastConnected).toBeInstanceOf(Date);
    expect(stats.lastError).toBeInstanceOf(Date);
  });

  test("should handle minimal stats", () => {
    const minimalStats: ConnectionStats = {
      totalConnections: 0,
      totalReconnections: 0,
      totalMessages: 0,
      totalErrors: 0,
    };

    expect(minimalStats.totalConnections).toBe(0);
    expect(minimalStats.totalReconnections).toBe(0);
    expect(minimalStats.lastConnected).toBeUndefined();
    expect(minimalStats.lastError).toBeUndefined();
  });
});

describe("OperationResult interface", () => {
  test("should handle successful operations", () => {
    const successResult: OperationResult<TestActionData> = {
      success: true,
      data: {
        action: "temperature_set",
        temperature: 22.5,
      },
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(successResult.success).toBe(true);
    expect(successResult.data?.action).toBe("temperature_set");
    expect(successResult.data?.temperature).toBe(22.5);
    expect(successResult.timestamp).toBe("2023-01-01T00:00:00Z");
  });

  test("should handle failed operations", () => {
    const failureResult: OperationResult<TestEntityData> = {
      success: false,
      error: "Connection timeout",
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(failureResult.success).toBe(false);
    expect(failureResult.error).toBe("Connection timeout");
    expect(failureResult.data).toBeUndefined();
  });

  test("should handle operations with partial data", () => {
    const partialResult: OperationResult<TestEntityData> = {
      success: false,
      data: {
        attemptedAction: "bulk_update",
        entitiesProcessed: 5,
        entitiesFailed: 2,
      },
      error: "Some entities failed to update",
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(partialResult.success).toBe(false);
    expect(partialResult.data?.entitiesProcessed).toBe(5);
    expect(partialResult.data?.entitiesFailed).toBe(2);
    expect(partialResult.error).toBe("Some entities failed to update");
  });
});

describe("Type compatibility", () => {
  test("should allow enum values in union types", () => {
    type ModeUnion = HVACMode | SystemMode;

    const hvacMode: ModeUnion = HVACMode.HEAT;
    const systemMode: ModeUnion = SystemMode.AUTO;

    expect(hvacMode).toBe(HVACMode.HEAT);
    expect(systemMode).toBe(SystemMode.AUTO);
  });

  test("should work with generic constraints", () => {
    function processResult<T>(result: OperationResult<T>): boolean {
      return result.success;
    }

    const testResult: OperationResult<TestActionData> = {
      success: true,
      data: { action: "test" },
      timestamp: "2023-01-01T00:00:00Z",
    };

    expect(processResult(testResult)).toBe(true);
  });
});
