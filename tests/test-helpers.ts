/**
 * Test helper utilities for HAG tests
 *
 * Provides common test setup and utilities to reduce test overhead
 */

import { setupLogging } from "../src/core/logging.ts";
import type {
  Settings,
  HassOptions,
  HvacOptions,
  ApplicationOptions,
} from "../src/config/config.ts";
import { LogLevel, SystemMode } from "../src/types/common.ts";

/**
 * Setup logging for tests - call this in test setup to reduce log noise
 */
export function setupTestLogging(): void {
  setupLogging("ERROR");
}

/**
 * Minimal test configuration to avoid full config loading overhead
 */
export function createTestConfig(): Settings {
  return {
    appOptions: {
      logLevel: LogLevel.ERROR,
      useAi: false,
      aiModel: "gpt-4o-mini",
      aiTemperature: 0.1,
    } as ApplicationOptions,
    hassOptions: {
      wsUrl: "ws://localhost:8123/api/websocket",
      restUrl: "http://localhost:8123",
      token: "test_token",
      maxRetries: 1,
      retryDelayMs: 100,
      stateCheckInterval: 1000,
    } as HassOptions,
    hvacOptions: {
      tempSensor: "sensor.indoor_temp",
      outdoorSensor: "sensor.outdoor_temp",
      systemMode: SystemMode.AUTO,
      hvacEntities: [
        {
          entityId: "climate.test",
          enabled: true,
          defrost: false,
        },
      ],
      heating: {
        temperature: 21.0,
        presetMode: "comfort",
        temperatureThresholds: {
          indoorMin: 19.0,
          indoorMax: 22.0,
          outdoorMin: -15.0,
          outdoorMax: 45.0,
        },
      },
      cooling: {
        temperature: 25.0,
        presetMode: "comfort",
        temperatureThresholds: {
          indoorMin: 23.0,
          indoorMax: 28.0,
          outdoorMin: -15.0,
          outdoorMax: 45.0,
        },
      },
    } as HvacOptions,
  };
}

/**
 * Mock WebSocket factory for testing - returns mock WebSocket that doesn't actually connect
 */
export function createMockWebSocketFactory(): (url: string) => WebSocket {
  return (_url: string) => {
    const mockWs = {
      readyState: WebSocket.CONNECTING,
      onopen: null as ((event: Event) => void) | null,
      onclose: null as ((event: CloseEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
      send: () => {
        /* mock send */
      },
      close: () => {
        /* mock close */
      },
      failConnection: () => {
        mockWs.readyState = WebSocket.CLOSED;
        if (mockWs.onerror) {
          mockWs.onerror(new Event("error"));
        }
      },
    } as any;

    // Simulate immediate connection failure for tests
    setTimeout(() => {
      if (mockWs.onerror) {
        mockWs.onerror(new Event("error"));
      }
    }, 0);

    return mockWs;
  };
}
