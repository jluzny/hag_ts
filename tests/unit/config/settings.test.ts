/**
 * Unit tests for configuration schemas in HAG JavaScript variant.
 */

import { assertEquals, assertThrows } from '@std/assert';
import { ZodError } from 'zod';
import {
  HassOptionsSchema,
  type HvacOptions as _HvacOptions,
  HvacOptionsSchema,
  type Settings as _Settings,
  SystemMode,
} from '../../../src/config/config.ts';

Deno.test('HassOptionsSchema', async (t) => {
  await t.step('should validate valid Home Assistant config', () => {
    const validConfig = {
      wsUrl: 'ws://localhost:8123/api/websocket',
      restUrl: 'http://localhost:8123',
      token: 'long_lived_access_token',
      maxRetries: 3,
      retryDelayMs: 1000,
      stateCheckInterval: 300000,
    };

    const result = HassOptionsSchema.parse(validConfig);
    assertEquals(result.wsUrl, validConfig.wsUrl);
    assertEquals(result.restUrl, validConfig.restUrl);
    assertEquals(result.token, validConfig.token);
    assertEquals(result.maxRetries, validConfig.maxRetries);
    assertEquals(result.retryDelayMs, validConfig.retryDelayMs);
  });

  await t.step('should validate complete config with all fields', () => {
    const completeConfig = {
      wsUrl: 'ws://localhost:8123/api/websocket',
      restUrl: 'http://localhost:8123',
      token: 'token',
      maxRetries: 5,
      retryDelayMs: 1000,
      stateCheckInterval: 300000,
    };

    const result = HassOptionsSchema.parse(completeConfig);
    assertEquals(result.maxRetries, 5);
    assertEquals(result.retryDelayMs, 1000);
    assertEquals(result.stateCheckInterval, 300000);
  });

  await t.step('should reject invalid URLs', () => {
    const invalidConfig = {
      wsUrl: 'not-a-url',
      restUrl: 'http://localhost:8123',
      token: 'token',
    };

    assertThrows(() => HassOptionsSchema.parse(invalidConfig), ZodError);
  });

  await t.step('should reject invalid retry values', () => {
    const invalidConfig = {
      wsUrl: 'ws://localhost:8123/api/websocket',
      restUrl: 'http://localhost:8123',
      token: 'token',
      maxRetries: -1,
    };

    assertThrows(() => HassOptionsSchema.parse(invalidConfig), ZodError);
  });
});

Deno.test('HvacOptionsSchema', async (t) => {
  await t.step('should validate valid HVAC config', () => {
    const validConfig = {
      tempSensor: 'sensor.indoor_temperature',
      outdoorSensor: 'sensor.outdoor_temperature',
      systemMode: SystemMode.AUTO,
      hvacEntities: [
        {
          entityId: 'climate.living_room',
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

    const result = HvacOptionsSchema.parse(validConfig);
    assertEquals(result.tempSensor, validConfig.tempSensor);
    assertEquals(result.systemMode, SystemMode.AUTO);
    assertEquals(result.hvacEntities.length, 1);
    assertEquals(result.heating.temperature, 21.0);
    assertEquals(result.cooling.temperature, 24.0);
  });

  await t.step('should reject invalid sensor entity IDs', () => {
    const invalidConfig = {
      tempSensor: 'invalid_sensor_id',
      hvacEntities: [],
      heating: {},
      cooling: {},
    };

    assertThrows(() => HvacOptionsSchema.parse(invalidConfig), ZodError);
  });

  await t.step('should validate defrost configuration', () => {
    const configWithDefrost = {
      tempSensor: 'sensor.indoor_temperature',
      outdoorSensor: 'sensor.outdoor_temperature',
      systemMode: SystemMode.AUTO,
      hvacEntities: [],
      heating: {
        temperature: 21.0,
        presetMode: 'comfort',
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
        presetMode: 'eco',
        temperatureThresholds: {
          indoorMin: 23.0,
          indoorMax: 26.0,
          outdoorMin: 10.0,
          outdoorMax: 45.0,
        },
      },
    };

    const result = HvacOptionsSchema.parse(configWithDefrost);
    assertEquals(result.heating.defrost?.temperatureThreshold, 0.0);
    assertEquals(result.heating.defrost?.periodSeconds, 3600);
    assertEquals(result.heating.defrost?.durationSeconds, 300);
  });

  await t.step('should validate active hours configuration', () => {
    const configWithActiveHours = {
      tempSensor: 'sensor.indoor_temperature',
      outdoorSensor: 'sensor.outdoor_temperature',
      systemMode: SystemMode.AUTO,
      hvacEntities: [],
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
      activeHours: {
        start: 8,
        startWeekday: 7,
        end: 22,
      },
    };

    const result = HvacOptionsSchema.parse(configWithActiveHours);
    assertEquals(result.activeHours?.start, 8);
    assertEquals(result.activeHours?.startWeekday, 7);
    assertEquals(result.activeHours?.end, 22);
  });
});





Deno.test('Temperature thresholds validation', async (t) => {
  await t.step('should enforce temperature ranges', () => {
    const invalidHeating = {
      tempSensor: 'sensor.temp',
      hvacEntities: [],
      heating: {
        temperature: 50, // Above max of 35
      },
      cooling: {},
    };

    assertThrows(() => HvacOptionsSchema.parse(invalidHeating), ZodError);
  });

  await t.step('should enforce outdoor temperature ranges', () => {
    const invalidThresholds = {
      tempSensor: 'sensor.temp',
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

    assertThrows(() => HvacOptionsSchema.parse(invalidThresholds), ZodError);
  });
});

Deno.test('Entity validation', async (t) => {
  await t.step('should validate HVAC entity IDs', () => {
    const validEntity = {
      tempSensor: 'sensor.temp',
      outdoorSensor: 'sensor.outdoor_temp',
      systemMode: SystemMode.AUTO,
      hvacEntities: [
        {
          entityId: 'climate.living_room_ac',
          enabled: true,
          defrost: true,
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

    const result = HvacOptionsSchema.parse(validEntity);
    assertEquals(result.hvacEntities[0].entityId, 'climate.living_room_ac');
    assertEquals(result.hvacEntities[0].enabled, true);
    assertEquals(result.hvacEntities[0].defrost, true);
  });

  await t.step('should reject invalid entity ID format', () => {
    const invalidEntity = {
      tempSensor: 'sensor.temp',
      hvacEntities: [
        {
          entityId: 'invalid_format',
        },
      ],
      heating: {},
      cooling: {},
    };

    assertThrows(() => HvacOptionsSchema.parse(invalidEntity), ZodError);
  });
});
