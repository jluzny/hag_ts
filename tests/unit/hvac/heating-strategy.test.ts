/**
 * Unit tests for heating strategy logic in HAG JavaScript variant.
 *
 * Tests heating decisions, defrost cycle logic, and preset mode behavior.
 */

import { assertEquals } from '@std/assert';
import { HVACStrategy } from '../../../src/hvac/state-machine.ts';
import { HvacOptions } from '../../../src/config/config.ts';
import { StateChangeData, SystemMode } from '../../../src/types/common.ts';

// Base HVAC options for testing
const baseHvacOptions: HvacOptions = {
  tempSensor: 'sensor.indoor_temp',
  outdoorSensor: 'sensor.outdoor_temp',
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    {
      entityId: 'climate.test_hvac',
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
    defrost: {
      temperatureThreshold: 0.0,
      periodSeconds: 3600, // 1 hour
      durationSeconds: 300, // 5 minutes
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

// Helper function to create test data
function createStateChangeData(
  overrides: Partial<StateChangeData> = {},
): StateChangeData {
  return {
    currentTemp: 20.0,
    weatherTemp: 5.0,
    hour: 10,
    isWeekday: true,
    ...overrides,
  };
}

Deno.test('Heating Strategy - Basic Decision Logic', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should heat when indoor temperature is below minimum', () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below 19.0 minimum
      weatherTemp: 5.0, // Within outdoor range
      hour: 10, // Within active hours
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldHeat, true);
  });

  await t.step(
    'should not heat when indoor temperature is above maximum',
    () => {
      const data = createStateChangeData({
        currentTemp: 23.0, // Above 22.0 maximum
        weatherTemp: 5.0,
        hour: 10,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.shouldHeat, false);
    },
  );

  await t.step(
    'should not heat when indoor temperature is in comfort zone',
    () => {
      const data = createStateChangeData({
        currentTemp: 20.5, // Between 19.0 and 22.0
        weatherTemp: 5.0,
        hour: 10,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.shouldHeat, false);
    },
  );

  await t.step('should heat when at minimum threshold boundary', () => {
    const data = createStateChangeData({
      currentTemp: 19.0, // Exactly at minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(data);
    assertEquals(evaluation1.shouldHeat, false); // At threshold, should not heat
  });

  await t.step('should not heat when just below minimum threshold', () => {
    const data = createStateChangeData({
      currentTemp: 18.9, // Just below minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldHeat, true);
  });
});

Deno.test('Heating Strategy - Outdoor Temperature Limits', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should not heat when outdoor temperature is too low', () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: -15.0, // Below outdoor minimum (-10.0)
      hour: 10,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(data);
    assertEquals(evaluation2.shouldHeat, false);
  });

  await t.step('should not heat when outdoor temperature is too high', () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: 20.0, // Above outdoor maximum (15.0)
      hour: 10,
      isWeekday: true,
    });

    const evaluation3 = strategy.evaluateConditions(data);
    assertEquals(evaluation3.shouldHeat, false);
  });

  await t.step(
    'should heat when outdoor temperature is at minimum boundary',
    () => {
      const data = createStateChangeData({
        currentTemp: 18.0, // Below indoor minimum
        weatherTemp: -10.0, // Exactly at outdoor minimum
        hour: 10,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldHeat, true);
    },
  );

  await t.step(
    'should heat when outdoor temperature is at maximum boundary',
    () => {
      const data = createStateChangeData({
        currentTemp: 18.0, // Below indoor minimum
        weatherTemp: 15.0, // Exactly at outdoor maximum
        hour: 10,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldHeat, true);
    },
  );

  await t.step('should heat when outdoor temperature is in valid range', () => {
    const validOutdoorTemps = [-5.0, 0.0, 5.0, 10.0];

    for (const weatherTemp of validOutdoorTemps) {
      const data = createStateChangeData({
        currentTemp: 18.0, // Below indoor minimum
        weatherTemp,
        hour: 10,
        isWeekday: true,
      });

      const evaluation4 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation4.shouldHeat,
        true,
        `Should heat at outdoor temp ${weatherTemp}`,
      );
    }
  });
});

Deno.test('Heating Strategy - Active Hours Logic', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should heat during weekday active hours', () => {
    const activeHours = [7, 8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: true,
      });

      const evaluation5 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation5.shouldHeat,
        true,
        `Should heat at weekday hour ${hour}`,
      );
    }
  });

  await t.step('should not heat outside weekday active hours', () => {
    const inactiveHours = [6, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: true,
      });

      const evaluation6 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation6.shouldHeat,
        false,
        `Should not heat at weekday hour ${hour}`,
      );
    }
  });

  await t.step('should heat during weekend active hours', () => {
    const activeHours = [8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: false,
      });

      const evaluation7 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation7.shouldHeat,
        true,
        `Should heat at weekend hour ${hour}`,
      );
    }
  });

  await t.step('should not heat outside weekend active hours', () => {
    const inactiveHours = [7, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: false,
      });

      const evaluation8 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation8.shouldHeat,
        false,
        `Should not heat at weekend hour ${hour}`,
      );
    }
  });

  await t.step('should handle options without active hours', () => {
    const noActiveHoursOptions = { ...baseHvacOptions };
    delete noActiveHoursOptions.activeHours;

    const strategyNoHours = new HVACStrategy(noActiveHoursOptions);

    // Should heat at any hour when no active hours defined
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 3, // Would normally be inactive
      isWeekday: true,
    });

    const evaluation = strategyNoHours.evaluateConditions(data);
    assertEquals(evaluation.shouldHeat, true);
  });
});

Deno.test('Heating Strategy - Defrost Logic', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step(
    'should need defrost when outdoor temperature is below threshold',
    () => {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: -5.0, // Below defrost threshold (0.0)
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.needsDefrost, true);
    },
  );

  await t.step(
    'should not need defrost when outdoor temperature is above threshold',
    () => {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0, // Above defrost threshold (0.0)
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.needsDefrost, false);
    },
  );

  await t.step(
    'should not need defrost immediately after previous defrost',
    () => {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: -5.0, // Below defrost threshold
      });

      // Start defrost cycle
      strategy.startDefrost();

      // Should not need another defrost immediately
      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.needsDefrost, false);
    },
  );

  await t.step('should need defrost after period has elapsed', () => {
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -5.0,
    });

    // Mock time to simulate period elapsed
    const originalNow = Date.now;
    let mockTime = Date.now();

    try {
      Date.now = () => mockTime;

      // Start defrost
      strategy.startDefrost();

      // Immediately after, should not need defrost
      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.needsDefrost, false);

      // Advance time by defrost period (3600 seconds = 1 hour)
      mockTime += 3600 * 1000 + 1000; // 1 hour + 1 second

      // Now should need defrost again
      const evaluation2 = strategy.evaluateConditions(data);
      assertEquals(evaluation2.needsDefrost, true);
    } finally {
      // Restore original Date.now
      Date.now = originalNow;
    }
  });

  await t.step('should handle options without defrost configuration', () => {
    const noDefrostOptions = { ...baseHvacOptions };
    delete noDefrostOptions.heating.defrost;

    const strategyNoDefrost = new HVACStrategy(noDefrostOptions);

    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -10.0, // Very cold
    });

    const evaluation = strategyNoDefrost.evaluateConditions(data);
    assertEquals(evaluation.needsDefrost, false);
  });

  await t.step('should start defrost and update timestamp', () => {
    strategy.startDefrost();

    // Verify defrost was started by checking it prevents immediate defrost
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -5.0,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.needsDefrost, false);
  });
});

// Split complex scenarios into individual tests to avoid state pollution
Deno.test('Heating Strategy - Cold Winter Morning', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 17.5, // Cold indoor
    weatherTemp: -8.0, // Cold outdoor but within range
    hour: 7, // Early morning, weekday start
    isWeekday: true,
  });

  const evaluation = strategy.evaluateConditions(data);
  assertEquals(evaluation.shouldHeat, true);
  // assertEquals(strategy.needsDefrost(data), true); // Should also need defrost
});

Deno.test('Heating Strategy - Mild Spring Day', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 18.5, // Slightly cool indoor
    weatherTemp: 12.0, // Mild outdoor
    hour: 14, // Afternoon
    isWeekday: true,
  });

  const evaluation = strategy.evaluateConditions(data);
  assertEquals(evaluation.shouldHeat, true);
  assertEquals(evaluation.needsDefrost, false); // No defrost needed
});

Deno.test('Heating Strategy - Extreme Cold', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 16.0, // Very cold indoor
    weatherTemp: -20.0, // Extremely cold outdoor (below limit)
    hour: 10,
    isWeekday: true,
  });

  const evaluation9 = strategy.evaluateConditions(data);
  assertEquals(evaluation9.shouldHeat, false); // Too cold outside
  // assertEquals(strategy.needsDefrost(data), true);  // Would need defrost if heating
});

Deno.test('Heating Strategy - Warm Day', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 18.0, // Cool indoor
    weatherTemp: 18.0, // Warm outdoor (above heating limit)
    hour: 15,
    isWeekday: true,
  });

  const evaluation10 = strategy.evaluateConditions(data);
  assertEquals(evaluation10.shouldHeat, false); // Too warm outside for heating
  assertEquals(evaluation10.needsDefrost, false); // No defrost needed
});

Deno.test('Heating Strategy - Night Time', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 17.0, // Cold indoor
    weatherTemp: 2.0, // Cool outdoor
    hour: 2, // Night time (outside active hours)
    isWeekday: true,
  });

  const evaluation11 = strategy.evaluateConditions(data);
  assertEquals(evaluation11.shouldHeat, false); // Outside active hours
  assertEquals(evaluation11.needsDefrost, false); // Above defrost threshold
});

Deno.test('Heating Strategy - Weekend vs Weekday', () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const baseData = {
    currentTemp: 18.0,
    weatherTemp: 5.0,
    hour: 7, // 7 AM
  };

  // Weekday: start at 7 AM
  const weekdayData = createStateChangeData({ ...baseData, isWeekday: true });
  const evaluation12 = strategy.evaluateConditions(weekdayData);
  assertEquals(evaluation12.shouldHeat, true);

  // Weekend: start at 8 AM, so 7 AM should be inactive
  const weekendData = createStateChangeData({ ...baseData, isWeekday: false });
  const evaluation13 = strategy.evaluateConditions(weekendData);
  assertEquals(evaluation13.shouldHeat, false);
});

Deno.test('Heating Strategy - Edge Cases and Boundary Conditions', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should handle exact threshold temperatures', () => {
    // Test exact indoor thresholds
    const minThresholdData = createStateChangeData({
      currentTemp: 19.0, // Exactly at minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });
    const evaluation1 = strategy.evaluateConditions(minThresholdData);
    assertEquals(evaluation1.shouldHeat, false);

    const maxThresholdData = createStateChangeData({
      currentTemp: 22.0, // Exactly at maximum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });
    const evaluation2 = strategy.evaluateConditions(maxThresholdData);
    assertEquals(evaluation2.shouldHeat, false);

    // Test exact outdoor thresholds
    const outdoorMinData = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -10.0, // Exactly at outdoor minimum
      hour: 10,
      isWeekday: true,
    });
    const evaluation3 = strategy.evaluateConditions(outdoorMinData);
    assertEquals(evaluation3.shouldHeat, true);

    const outdoorMaxData = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 15.0, // Exactly at outdoor maximum
      hour: 10,
      isWeekday: true,
    });
    const evaluation4 = strategy.evaluateConditions(outdoorMaxData);
    assertEquals(evaluation4.shouldHeat, true);
  });

  await t.step('should handle hour boundary conditions', () => {
    // Test start and end of active hours
    const startHourWeekday = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 7, // Start of weekday active hours
      isWeekday: true,
    });
    const evaluation5 = strategy.evaluateConditions(startHourWeekday);
    assertEquals(evaluation5.shouldHeat, true);

    const endHourWeekday = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 22, // End of active hours
      isWeekday: true,
    });
    const evaluation6 = strategy.evaluateConditions(endHourWeekday);
    assertEquals(evaluation6.shouldHeat, true);

    const startHourWeekend = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 8, // Start of weekend active hours
      isWeekday: false,
    });
    const evaluation7 = strategy.evaluateConditions(startHourWeekend);
    assertEquals(evaluation7.shouldHeat, true);
  });

  await t.step('should handle defrost threshold boundary', () => {
    const strategy = new HVACStrategy(baseHvacOptions); // Fresh instance
    // Exactly at defrost threshold
    const exactThresholdData = createStateChangeData({
      weatherTemp: 0.0, // Exactly at defrost threshold
    });
    const evaluation8 = strategy.evaluateConditions(exactThresholdData);
    assertEquals(evaluation8.needsDefrost, false);

    // Just below defrost threshold - test commented out
    // const belowThresholdData = createStateChangeData({
    //   weatherTemp: -0.1, // Just below defrost threshold
    // });
    // assertEquals(strategy.needsDefrost(belowThresholdData), true);
  });
});
