/**
 * Unit tests for configuration schemas in HAG JavaScript variant.
 */

import { expect, test, describe } from "bun:test";
import { ZodError } from "zod";
import {
  HassOptionsSchema,
  type HvacOptions as _HvacOptions,
  HvacOptionsSchema,
  type Settings as _Settings,
  SystemMode,
} from "../../../src/config/config.ts";

describe("HassOptionsSchema", () => {
  test("should validate valid Home Assistant config", () => {
    const validConfig = {
      wsUrl: "ws://localhost:8123/api/websocket",
      restUrl: "http://localhost:8123",
      token: "long_lived_access_token",
      maxRetries: 3,
      retryDelayMs: 1000,
      stateCheckInterval: 300000,
    };

    const result = HassOptionsSchema.parse(validConfig);
    expect(result.wsUrl).toBe(validConfig.wsUrl);
    expect(result.restUrl).toBe(validConfig.restUrl);
    expect(result.token).toBe(validConfig.token);
    expect(result.maxRetries).toBe(validConfig.maxRetries);
    expect(result.retryDelayMs).toBe(validConfig.retryDelayMs);
  });

  test("should validate complete config with all fields", () => {
    const completeConfig = {
      wsUrl: "ws://localhost:8123/api/websocket",
      restUrl: "http://localhost:8123",
      token: "token",
      maxRetries: 5,
      retryDelayMs: 1000,
      stateCheckInterval: 300000,
    };

    const result = HassOptionsSchema.parse(completeConfig);
    expect(result.maxRetries).toBe(5);
    expect(result.retryDelayMs).toBe(1000);
    expect(result.stateCheckInterval).toBe(300000);
  });

  test("should reject invalid URLs", () => {
    const invalidConfig = {
      wsUrl: "not-a-url",
      restUrl: "http://localhost:8123",
      token: "token",
    };

    expect(() => HassOptionsSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  test("should reject invalid retry values", () => {
    const invalidConfig = {
      wsUrl: "ws://localhost:8123/api/websocket",
      restUrl: "http://localhost:8123",
      token: "token",
      maxRetries: -1,
    };

    expect(() => HassOptionsSchema.parse(invalidConfig)).toThrow(ZodError);
  });
});

describe("HvacOptionsSchema", () => {
  test("should validate valid HVAC config", () => {
    const validConfig = {
      tempSensor: "sensor.indoor_temperature",
      outdoorSensor: "sensor.outdoor_temperature",
      systemMode: SystemMode.AUTO,
      hvacEntities: [
        {
          entityId: "climate.living_room",
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
          outdoorMin: -10.0,
          outdoorMax: 15.0,
        },
      },
      cooling: {
        temperature: 24.0,
        presetMode: "eco",
        temperatureThresholds: {
          indoorMin: 23.0,
          indoorMax: 26.0,
          outdoorMin: 10.0,
          outdoorMax: 45.0,
        },
      },
    };

    const result = HvacOptionsSchema.parse(validConfig);
    expect(result.tempSensor).toBe(validConfig.tempSensor);
    expect(result.systemMode).toBe(SystemMode.AUTO);
    expect(result.hvacEntities.length).toBe(1);
    expect(result.heating.temperature).toBe(21.0);
    expect(result.cooling.temperature).toBe(24.0);
  });

  test("should reject invalid sensor entity IDs", () => {
    const invalidConfig = {
      tempSensor: "invalid_sensor_id",
      hvacEntities: [],
      heating: {},
      cooling: {},
    };

    expect(() => HvacOptionsSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  test("should validate defrost configuration", () => {
    const configWithDefrost = {
      tempSensor: "sensor.indoor_temperature",
      outdoorSensor: "sensor.outdoor_temperature",
      systemMode: SystemMode.AUTO,
      hvacEntities: [],
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
          indoorMin: 23.0,
          indoorMax: 26.0,
          outdoorMin: 10.0,
          outdoorMax: 45.0,
        },
      },
    };

    const result = HvacOptionsSchema.parse(configWithDefrost);
    expect(result.heating.defrost?.temperatureThreshold).toBe(0.0);
    expect(result.heating.defrost?.periodSeconds).toBe(3600);
    expect(result.heating.defrost?.durationSeconds).toBe(300);
  });

  test("should validate active hours configuration", () => {
    const configWithActiveHours = {
      tempSensor: "sensor.indoor_temperature",
      outdoorSensor: "sensor.outdoor_temperature",
      systemMode: SystemMode.AUTO,
      hvacEntities: [],
      heating: {
        temperature: 21.0,
        presetMode: "comfort",
        temperatureThresholds: {
          indoorMin: 19.0,
          indoorMax: 22.0,
          outdoorMin: -10.0,
          outdoorMax: 15.0,
        },
      },
      cooling: {
        temperature: 24.0,
        presetMode: "eco",
        temperatureThresholds: {
          indoorMin: 23.0,
          indoorMax: 26.0,
          outdoorMin: 10.0,
          outdoorMax: 45.0,
        },
      },
      activeHours: {
        start: 8,
        startWeekday: 7,
        end: 22,
      },
    };

    const result = HvacOptionsSchema.parse(configWithActiveHours);
    expect(result.activeHours?.start).toBe(8);
    expect(result.activeHours?.startWeekday).toBe(7);
    expect(result.activeHours?.end).toBe(22);
  });
});

describe("Temperature thresholds validation", () => {
  test("should enforce temperature ranges", () => {
    const invalidHeating = {
      tempSensor: "sensor.temp",
      hvacEntities: [],
      heating: {
        temperature: 50, // Above max of 35
      },
      cooling: {},
    };

    expect(() => HvacOptionsSchema.parse(invalidHeating)).toThrow(ZodError);
  });

  test("should enforce outdoor temperature ranges", () => {
    const invalidThresholds = {
      tempSensor: "sensor.temp",
      hvacEntities: [],
      heating: {
        temperatureThresholds: {
          indoorMin: 15.0,
          indoorMax: 25.0,
          outdoorMin: -60.0, // Below min of -50
          outdoorMax: 20.0,
        },
      },
      cooling: {},
    };

    expect(() => HvacOptionsSchema.parse(invalidThresholds)).toThrow(ZodError);
  });
});

describe("Entity validation", () => {
  test("should validate HVAC entity IDs", () => {
    const validEntity = {
      tempSensor: "sensor.temp",
      outdoorSensor: "sensor.outdoor_temp",
      systemMode: SystemMode.AUTO,
      hvacEntities: [
        {
          entityId: "climate.living_room_ac",
          enabled: true,
          defrost: true,
        },
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
      },
      cooling: {
        temperature: 24.0,
        presetMode: "eco",
        temperatureThresholds: {
          indoorMin: 23.0,
          indoorMax: 26.0,
          outdoorMin: 10.0,
          outdoorMax: 45.0,
        },
      },
    };

    const result = HvacOptionsSchema.parse(validEntity);
    expect(result.hvacEntities[0].entityId).toBe("climate.living_room_ac");
    expect(result.hvacEntities[0].enabled).toBe(true);
    expect(result.hvacEntities[0].defrost).toBe(true);
  });

  test("should reject invalid entity ID format", () => {
    const invalidEntity = {
      tempSensor: "sensor.temp",
      hvacEntities: [
        {
          entityId: "invalid_format",
        },
      ],
      heating: {},
      cooling: {},
    };

    expect(() => HvacOptionsSchema.parse(invalidEntity)).toThrow(ZodError);
  });
});
