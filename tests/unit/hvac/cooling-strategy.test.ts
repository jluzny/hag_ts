/**
 * Unit tests for cooling strategy logic in HAG JavaScript variant.
 *
 * Tests cooling decisions, active hours logic, and seasonal scenarios.
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
    currentTemp: 24.0,
    weatherTemp: 25.0,
    hour: 14,
    isWeekday: true,
    ...overrides,
  };
}

Deno.test('Cooling Strategy - Basic Decision Logic', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should cool when indoor temperature is above maximum', () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above 26.0 maximum
      weatherTemp: 30.0, // Within outdoor range
      hour: 14, // Within active hours
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step(
    'should not cool when indoor temperature is below minimum',
    () => {
      const data = createStateChangeData({
        currentTemp: 22.0, // Below 23.0 minimum
        weatherTemp: 30.0,
        hour: 14,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(evaluation.shouldCool, false);
    },
  );

  await t.step(
    'should cool when indoor temperature is above minimum threshold',
    () => {
      const data = createStateChangeData({
        currentTemp: 24.5, // Above indoorMin 23.0
        weatherTemp: 30.0,
        hour: 14,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
    },
  );

  await t.step('should cool when at maximum threshold boundary', () => {
    const data = createStateChangeData({
      currentTemp: 26.0, // Above indoorMin 23.0
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true); // Above minimum, should cool
  });

  await t.step('should cool when just above maximum threshold', () => {
    const data = createStateChangeData({
      currentTemp: 26.1, // Just above maximum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should not cool when at minimum threshold boundary', () => {
    const data = createStateChangeData({
      currentTemp: 23.0, // Exactly at minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, false);
  });
});

Deno.test('Cooling Strategy - Outdoor Temperature Limits', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should not cool when outdoor temperature is too low', () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 5.0, // Below outdoor minimum (10.0)
      hour: 14,
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(data);
    assertEquals(evaluation1.shouldCool, false);
  });

  await t.step('should not cool when outdoor temperature is too high', () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 50.0, // Above outdoor maximum (45.0)
      hour: 14,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(data);
    assertEquals(evaluation2.shouldCool, false);
  });

  await t.step(
    'should cool when outdoor temperature is at minimum boundary',
    () => {
      const data = createStateChangeData({
        currentTemp: 27.0, // Above indoor maximum
        weatherTemp: 10.0, // Exactly at outdoor minimum
        hour: 14,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
    },
  );

  await t.step(
    'should cool when outdoor temperature is at maximum boundary',
    () => {
      const data = createStateChangeData({
        currentTemp: 27.0, // Above indoor maximum
        weatherTemp: 45.0, // Exactly at outdoor maximum
        hour: 14,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
    },
  );

  await t.step('should cool when outdoor temperature is in valid range', () => {
    const validOutdoorTemps = [15.0, 20.0, 25.0, 30.0, 35.0, 40.0];

    for (const weatherTemp of validOutdoorTemps) {
      const data = createStateChangeData({
        currentTemp: 27.0, // Above indoor maximum
        weatherTemp,
        hour: 14,
        isWeekday: true,
      });

      const evaluation3 = strategy.evaluateConditions(data);
      assertEquals(
        evaluation3.shouldCool,
        true,
        `Should cool at outdoor temp ${weatherTemp}`,
      );
    }
  });
});

Deno.test('Cooling Strategy - Active Hours Logic', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should cool during weekday active hours', () => {
    const activeHours = [7, 8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(
        evaluation.shouldCool,
        true,
        `Should cool at weekday hour ${hour}`,
      );
    }
  });

  await t.step('should not cool outside weekday active hours', () => {
    const inactiveHours = [6, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(
        evaluation.shouldCool,
        false,
        `Should not cool at weekday hour ${hour}`,
      );
    }
  });

  await t.step('should cool during weekend active hours', () => {
    const activeHours = [8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: false,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(
        evaluation.shouldCool,
        true,
        `Should cool at weekend hour ${hour}`,
      );
    }
  });

  await t.step('should not cool outside weekend active hours', () => {
    const inactiveHours = [7, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: false,
      });

      const evaluation = strategy.evaluateConditions(data);
      assertEquals(
        evaluation.shouldCool,
        false,
        `Should not cool at weekend hour ${hour}`,
      );
    }
  });

  await t.step('should handle options without active hours', () => {
    const noActiveHoursOptions = { ...baseHvacOptions };
    delete noActiveHoursOptions.activeHours;

    const strategyNoHours = new HVACStrategy(noActiveHoursOptions);

    // Should cool at any hour when no active hours defined
    const data = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 3, // Would normally be inactive
      isWeekday: true,
    });

    const evaluation = strategyNoHours.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });
});

Deno.test('Cooling Strategy - Seasonal Scenarios', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should handle hot summer day scenario', () => {
    const data = createStateChangeData({
      currentTemp: 28.0, // Hot indoor
      weatherTemp: 35.0, // Hot outdoor but within range
      hour: 15, // Afternoon
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle mild spring day scenario', () => {
    const data = createStateChangeData({
      currentTemp: 26.5, // Warm indoor
      weatherTemp: 18.0, // Mild outdoor
      hour: 12, // Midday
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle cool winter day scenario', () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Warm indoor (maybe from heating/sun)
      weatherTemp: 8.0, // Cool outdoor (below cooling minimum)
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, false); // Too cool outside for cooling
  });

  await t.step('should handle extreme heat scenario', () => {
    const data = createStateChangeData({
      currentTemp: 30.0, // Very hot indoor
      weatherTemp: 48.0, // Extremely hot outdoor (above limit)
      hour: 16,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, false); // Too hot outside for efficient cooling
  });

  await t.step('should handle autumn scenario', () => {
    const data = createStateChangeData({
      currentTemp: 26.2, // Slightly warm indoor
      weatherTemp: 22.0, // Pleasant outdoor
      hour: 13,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true); // Good conditions for cooling
  });
});

Deno.test('Cooling Strategy - Complex Scenarios', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should handle air conditioning optimal conditions', () => {
    const data = createStateChangeData({
      currentTemp: 27.5, // Uncomfortably warm
      weatherTemp: 32.0, // Hot but not extreme
      hour: 14, // Peak heat time
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle shoulder season conditions', () => {
    // Spring/fall when outdoor temps are moderate
    const data = createStateChangeData({
      currentTemp: 26.8, // Warm indoor from solar gain
      weatherTemp: 20.0, // Moderate outdoor
      hour: 15, // Afternoon solar gain
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle night time scenario', () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Still warm from day
      weatherTemp: 25.0, // Cooler evening
      hour: 23, // Night time (outside active hours)
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, false); // Outside active hours
  });

  await t.step('should handle weekend vs weekday differences', () => {
    const baseData = {
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 7, // 7 AM
    };

    // Weekday: start at 7 AM
    const weekdayData = createStateChangeData({ ...baseData, isWeekday: true });
    const evaluation1 = strategy.evaluateConditions(weekdayData);
    assertEquals(evaluation1.shouldCool, true);

    // Weekend: start at 8 AM, so 7 AM should be inactive
    const weekendData = createStateChangeData({
      ...baseData,
      isWeekday: false,
    });
    const evaluation2 = strategy.evaluateConditions(weekendData);
    assertEquals(evaluation2.shouldCool, false);
  });

  await t.step('should handle energy-efficient scenarios', () => {
    // Scenario where cooling would be inefficient
    const inefficientData = createStateChangeData({
      currentTemp: 26.1, // Just above threshold
      weatherTemp: 44.0, // Very hot outside (near limit)
      hour: 16, // Peak heat
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(inefficientData);
    assertEquals(evaluation1.shouldCool, true); // Still within limits

    // Scenario where cooling would be very inefficient
    const veryInefficientData = createStateChangeData({
      currentTemp: 26.1, // Just above threshold
      weatherTemp: 46.0, // Above outdoor limit
      hour: 16,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(veryInefficientData);
    assertEquals(evaluation2.shouldCool, false); // Above outdoor limit
  });
});

Deno.test('Cooling Strategy - Edge Cases and Boundary Conditions', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should handle exact threshold temperatures', () => {
    // Test exact indoor thresholds
    const minThresholdData = createStateChangeData({
      currentTemp: 23.0, // Exactly at minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation3 = strategy.evaluateConditions(minThresholdData);
    assertEquals(evaluation3.shouldCool, false); // At minimum, should not cool

    const maxThresholdData = createStateChangeData({
      currentTemp: 26.0, // Above minimum threshold
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation4 = strategy.evaluateConditions(maxThresholdData);
    assertEquals(evaluation4.shouldCool, true); // Above minimum, should cool

    // Test exact outdoor thresholds
    const outdoorMinData = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 10.0, // Exactly at outdoor minimum
      hour: 14,
      isWeekday: true,
    });
    const evaluation5 = strategy.evaluateConditions(outdoorMinData);
    assertEquals(evaluation5.shouldCool, true);

    const outdoorMaxData = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 45.0, // Exactly at outdoor maximum
      hour: 14,
      isWeekday: true,
    });
    const evaluation6 = strategy.evaluateConditions(outdoorMaxData);
    assertEquals(evaluation6.shouldCool, true);
  });

  await t.step('should handle hour boundary conditions', () => {
    // Test start and end of active hours
    const startHourWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 7, // Start of weekday active hours
      isWeekday: true,
    });
    const evaluation7 = strategy.evaluateConditions(startHourWeekday);
    assertEquals(evaluation7.shouldCool, true);

    const endHourWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 22, // End of active hours
      isWeekday: true,
    });
    const evaluation8 = strategy.evaluateConditions(endHourWeekday);
    assertEquals(evaluation8.shouldCool, true);

    const startHourWeekend = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 8, // Start of weekend active hours
      isWeekday: false,
    });
    const evaluation9 = strategy.evaluateConditions(startHourWeekend);
    assertEquals(evaluation9.shouldCool, true);

    // Just outside boundaries
    const beforeStartWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 6, // Before weekday start
      isWeekday: true,
    });
    const evaluation10 = strategy.evaluateConditions(beforeStartWeekday);
    assertEquals(evaluation10.shouldCool, false);

    const afterEndWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 23, // After end
      isWeekday: true,
    });
    const evaluation11 = strategy.evaluateConditions(afterEndWeekday);
    assertEquals(evaluation11.shouldCool, false);
  });

  await t.step('should handle temperature precision edge cases', () => {
    // Very small differences around thresholds
    const justBelowMin = createStateChangeData({
      currentTemp: 22.99, // Just below minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation12 = strategy.evaluateConditions(justBelowMin);
    assertEquals(evaluation12.shouldCool, false);

    const justAboveMax = createStateChangeData({
      currentTemp: 26.01, // Just above maximum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation13 = strategy.evaluateConditions(justAboveMax);
    assertEquals(evaluation13.shouldCool, true);

    // Outdoor temperature precision
    const justBelowOutdoorMin = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 9.99, // Just below outdoor minimum
      hour: 14,
      isWeekday: true,
    });
    const evaluation14 = strategy.evaluateConditions(justBelowOutdoorMin);
    assertEquals(evaluation14.shouldCool, false);

    const justAboveOutdoorMax = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 45.01, // Just above outdoor maximum
      hour: 14,
      isWeekday: true,
    });
    const evaluation15 = strategy.evaluateConditions(justAboveOutdoorMax);
    assertEquals(evaluation15.shouldCool, false);
  });

  await t.step('should handle extreme temperature values', () => {
    // Very high indoor temperature
    const extremeHot = createStateChangeData({
      currentTemp: 35.0, // Extremely hot
      weatherTemp: 25.0, // Reasonable outdoor
      hour: 14,
      isWeekday: true,
    });
    const evaluation16 = strategy.evaluateConditions(extremeHot);
    assertEquals(evaluation16.shouldCool, true);

    // Very low indoor temperature
    const extremeCold = createStateChangeData({
      currentTemp: 15.0, // Very cold
      weatherTemp: 25.0, // Reasonable outdoor
      hour: 14,
      isWeekday: true,
    });
    const evaluation17 = strategy.evaluateConditions(extremeCold);
    assertEquals(evaluation17.shouldCool, false);
  });
});

Deno.test('Cooling Strategy - Real World Scenarios', async (t) => {
  const strategy = new HVACStrategy(baseHvacOptions);

  await t.step('should handle office building afternoon cooling', () => {
    const data = createStateChangeData({
      currentTemp: 26.5, // Warm from solar gain and occupancy
      weatherTemp: 28.0, // Warm day
      hour: 14, // Peak afternoon
      isWeekday: true, // Business day
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle residential evening scenario', () => {
    const data = createStateChangeData({
      currentTemp: 27.2, // Hot from day's heat
      weatherTemp: 30.0, // Still warm outside
      hour: 19, // Early evening
      isWeekday: false, // Weekend
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true);
  });

  await t.step('should handle energy conservation late evening', () => {
    const data = createStateChangeData({
      currentTemp: 26.2, // Still slightly warm
      weatherTemp: 22.0, // Cooled down outside
      hour: 21, // Late evening
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true); // Still within active hours
  });

  await t.step('should handle desert climate scenario', () => {
    const data = createStateChangeData({
      currentTemp: 29.0, // Very warm inside
      weatherTemp: 42.0, // Hot desert day (but within limits)
      hour: 12, // Midday
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true); // Within outdoor limits
  });

  await t.step('should handle humid climate scenario', () => {
    const data = createStateChangeData({
      currentTemp: 26.3, // Moderately warm
      weatherTemp: 28.0, // Warm and humid outside
      hour: 16, // Afternoon
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    assertEquals(evaluation.shouldCool, true); // Good cooling conditions
  });
});
