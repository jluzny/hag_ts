/**
 * Unit tests for cooling strategy logic in HAG JavaScript variant.
 *
 * Tests cooling decisions, active hours logic, and seasonal scenarios.
 */

import { expect, test, describe } from "bun:test";
import { HVACStrategy } from "../../../src/hvac/state-machine.ts";
import { HvacOptions } from "../../../src/config/config.ts";
import { StateChangeData, SystemMode } from "../../../src/types/common.ts";

// Base HVAC options for testing
const baseHvacOptions: HvacOptions = {
  tempSensor: "sensor.indoor_temp",
  outdoorSensor: "sensor.outdoor_temp",
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    {
      entityId: "climate.test_hvac",
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

describe("Cooling Strategy - Basic Decision Logic", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should cool when indoor temperature is above maximum", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above 26.0 maximum
      weatherTemp: 30.0, // Within outdoor range
      hour: 14, // Within active hours
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should not cool when indoor temperature is below minimum", () => {
    const data = createStateChangeData({
      currentTemp: 22.0, // Below 23.0 minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(false);
  });

  test("should cool when indoor temperature is above minimum threshold", () => {
    const data = createStateChangeData({
      currentTemp: 24.5, // Above indoorMin 23.0
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should cool when at maximum threshold boundary", () => {
    const data = createStateChangeData({
      currentTemp: 26.0, // Above indoorMin 23.0
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true); // Above minimum, should cool
  });

  test("should cool when just above maximum threshold", () => {
    const data = createStateChangeData({
      currentTemp: 26.1, // Just above maximum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should not cool when at minimum threshold boundary", () => {
    const data = createStateChangeData({
      currentTemp: 23.0, // Exactly at minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(false);
  });
});

describe("Cooling Strategy - Outdoor Temperature Limits", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should not cool when outdoor temperature is too low", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 5.0, // Below outdoor minimum (10.0)
      hour: 14,
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(data);
    expect(evaluation1.shouldCool).toBe(false);
  });

  test("should not cool when outdoor temperature is too high", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 50.0, // Above outdoor maximum (45.0)
      hour: 14,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(data);
    expect(evaluation2.shouldCool).toBe(false);
  });

  test("should cool when outdoor temperature is at minimum boundary", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 10.0, // Exactly at outdoor minimum
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should cool when outdoor temperature is at maximum boundary", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Above indoor maximum
      weatherTemp: 45.0, // Exactly at outdoor maximum
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should cool when outdoor temperature is in valid range", () => {
    const validOutdoorTemps = [15.0, 20.0, 25.0, 30.0, 35.0, 40.0];

    for (const weatherTemp of validOutdoorTemps) {
      const data = createStateChangeData({
        currentTemp: 27.0, // Above indoor maximum
        weatherTemp,
        hour: 14,
        isWeekday: true,
      });

      const evaluation3 = strategy.evaluateConditions(data);
      expect(evaluation3.shouldCool).toBe(true);
    }
  });
});

describe("Cooling Strategy - Active Hours Logic", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should cool during weekday active hours", () => {
    const activeHours = [7, 8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      expect(evaluation.shouldCool).toBe(true);
    }
  });

  test("should not cool outside weekday active hours", () => {
    const inactiveHours = [6, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: true,
      });

      const evaluation = strategy.evaluateConditions(data);
      expect(evaluation.shouldCool).toBe(false);
    }
  });

  test("should cool during weekend active hours", () => {
    const activeHours = [8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: false,
      });

      const evaluation = strategy.evaluateConditions(data);
      expect(evaluation.shouldCool).toBe(true);
    }
  });

  test("should not cool outside weekend active hours", () => {
    const inactiveHours = [7, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 27.0,
        weatherTemp: 30.0,
        hour,
        isWeekday: false,
      });

      const evaluation = strategy.evaluateConditions(data);
      expect(evaluation.shouldCool).toBe(false);
    }
  });

  test("should handle options without active hours", () => {
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
    expect(evaluation.shouldCool).toBe(true);
  });
});

describe("Cooling Strategy - Seasonal Scenarios", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should handle hot summer day scenario", () => {
    const data = createStateChangeData({
      currentTemp: 28.0, // Hot indoor
      weatherTemp: 35.0, // Hot outdoor but within range
      hour: 15, // Afternoon
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle mild spring day scenario", () => {
    const data = createStateChangeData({
      currentTemp: 26.5, // Warm indoor
      weatherTemp: 18.0, // Mild outdoor
      hour: 12, // Midday
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle cool winter day scenario", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Warm indoor (maybe from heating/sun)
      weatherTemp: 8.0, // Cool outdoor (below cooling minimum)
      hour: 14,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(false); // Too cool outside for cooling
  });

  test("should handle extreme heat scenario", () => {
    const data = createStateChangeData({
      currentTemp: 30.0, // Very hot indoor
      weatherTemp: 48.0, // Extremely hot outdoor (above limit)
      hour: 16,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(false); // Too hot outside for efficient cooling
  });

  test("should handle autumn scenario", () => {
    const data = createStateChangeData({
      currentTemp: 26.2, // Slightly warm indoor
      weatherTemp: 22.0, // Pleasant outdoor
      hour: 13,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true); // Good conditions for cooling
  });
});

describe("Cooling Strategy - Complex Scenarios", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should handle air conditioning optimal conditions", () => {
    const data = createStateChangeData({
      currentTemp: 27.5, // Uncomfortably warm
      weatherTemp: 32.0, // Hot but not extreme
      hour: 14, // Peak heat time
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle shoulder season conditions", () => {
    // Spring/fall when outdoor temps are moderate
    const data = createStateChangeData({
      currentTemp: 26.8, // Warm indoor from solar gain
      weatherTemp: 20.0, // Moderate outdoor
      hour: 15, // Afternoon solar gain
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle night time scenario", () => {
    const data = createStateChangeData({
      currentTemp: 27.0, // Still warm from day
      weatherTemp: 25.0, // Cooler evening
      hour: 23, // Night time (outside active hours)
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(false); // Outside active hours
  });

  test("should handle weekend vs weekday differences", () => {
    const baseData = {
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 7, // 7 AM
    };

    // Weekday: start at 7 AM
    const weekdayData = createStateChangeData({ ...baseData, isWeekday: true });
    const evaluation1 = strategy.evaluateConditions(weekdayData);
    expect(evaluation1.shouldCool).toBe(true);

    // Weekend: start at 8 AM, so 7 AM should be inactive
    const weekendData = createStateChangeData({
      ...baseData,
      isWeekday: false,
    });
    const evaluation2 = strategy.evaluateConditions(weekendData);
    expect(evaluation2.shouldCool).toBe(false);
  });

  test("should handle energy-efficient scenarios", () => {
    // Scenario where cooling would be inefficient
    const inefficientData = createStateChangeData({
      currentTemp: 26.1, // Just above threshold
      weatherTemp: 44.0, // Very hot outside (near limit)
      hour: 16, // Peak heat
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(inefficientData);
    expect(evaluation1.shouldCool).toBe(true); // Still within limits

    // Scenario where cooling would be very inefficient
    const veryInefficientData = createStateChangeData({
      currentTemp: 26.1, // Just above threshold
      weatherTemp: 46.0, // Above outdoor limit
      hour: 16,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(veryInefficientData);
    expect(evaluation2.shouldCool).toBe(false); // Above outdoor limit
  });
});

describe("Cooling Strategy - Edge Cases and Boundary Conditions", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should handle exact threshold temperatures", () => {
    // Test exact indoor thresholds
    const minThresholdData = createStateChangeData({
      currentTemp: 23.0, // Exactly at minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation3 = strategy.evaluateConditions(minThresholdData);
    expect(evaluation3.shouldCool).toBe(false); // At minimum, should not cool

    const maxThresholdData = createStateChangeData({
      currentTemp: 26.0, // Above minimum threshold
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation4 = strategy.evaluateConditions(maxThresholdData);
    expect(evaluation4.shouldCool).toBe(true); // Above minimum, should cool

    // Test exact outdoor thresholds
    const outdoorMinData = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 10.0, // Exactly at outdoor minimum
      hour: 14,
      isWeekday: true,
    });
    const evaluation5 = strategy.evaluateConditions(outdoorMinData);
    expect(evaluation5.shouldCool).toBe(true);

    const outdoorMaxData = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 45.0, // Exactly at outdoor maximum
      hour: 14,
      isWeekday: true,
    });
    const evaluation6 = strategy.evaluateConditions(outdoorMaxData);
    expect(evaluation6.shouldCool).toBe(true);
  });

  test("should handle hour boundary conditions", () => {
    // Test start and end of active hours
    const startHourWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 7, // Start of weekday active hours
      isWeekday: true,
    });
    const evaluation7 = strategy.evaluateConditions(startHourWeekday);
    expect(evaluation7.shouldCool).toBe(true);

    const endHourWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 22, // End of active hours
      isWeekday: true,
    });
    const evaluation8 = strategy.evaluateConditions(endHourWeekday);
    expect(evaluation8.shouldCool).toBe(true);

    const startHourWeekend = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 8, // Start of weekend active hours
      isWeekday: false,
    });
    const evaluation9 = strategy.evaluateConditions(startHourWeekend);
    expect(evaluation9.shouldCool).toBe(true);

    // Just outside boundaries
    const beforeStartWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 6, // Before weekday start
      isWeekday: true,
    });
    const evaluation10 = strategy.evaluateConditions(beforeStartWeekday);
    expect(evaluation10.shouldCool).toBe(false);

    const afterEndWeekday = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 30.0,
      hour: 23, // After end
      isWeekday: true,
    });
    const evaluation11 = strategy.evaluateConditions(afterEndWeekday);
    expect(evaluation11.shouldCool).toBe(false);
  });

  test("should handle temperature precision edge cases", () => {
    // Very small differences around thresholds
    const justBelowMin = createStateChangeData({
      currentTemp: 22.99, // Just below minimum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation12 = strategy.evaluateConditions(justBelowMin);
    expect(evaluation12.shouldCool).toBe(false);

    const justAboveMax = createStateChangeData({
      currentTemp: 26.01, // Just above maximum
      weatherTemp: 30.0,
      hour: 14,
      isWeekday: true,
    });
    const evaluation13 = strategy.evaluateConditions(justAboveMax);
    expect(evaluation13.shouldCool).toBe(true);

    // Outdoor temperature precision
    const justBelowOutdoorMin = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 9.99, // Just below outdoor minimum
      hour: 14,
      isWeekday: true,
    });
    const evaluation14 = strategy.evaluateConditions(justBelowOutdoorMin);
    expect(evaluation14.shouldCool).toBe(false);

    const justAboveOutdoorMax = createStateChangeData({
      currentTemp: 27.0,
      weatherTemp: 45.01, // Just above outdoor maximum
      hour: 14,
      isWeekday: true,
    });
    const evaluation15 = strategy.evaluateConditions(justAboveOutdoorMax);
    expect(evaluation15.shouldCool).toBe(false);
  });

  test("should handle extreme temperature values", () => {
    // Very high indoor temperature
    const extremeHot = createStateChangeData({
      currentTemp: 35.0, // Extremely hot
      weatherTemp: 25.0, // Reasonable outdoor
      hour: 14,
      isWeekday: true,
    });
    const evaluation16 = strategy.evaluateConditions(extremeHot);
    expect(evaluation16.shouldCool).toBe(true);

    // Very low indoor temperature
    const extremeCold = createStateChangeData({
      currentTemp: 15.0, // Very cold
      weatherTemp: 25.0, // Reasonable outdoor
      hour: 14,
      isWeekday: true,
    });
    const evaluation17 = strategy.evaluateConditions(extremeCold);
    expect(evaluation17.shouldCool).toBe(false);
  });
});

describe("Cooling Strategy - Real World Scenarios", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should handle office building afternoon cooling", () => {
    const data = createStateChangeData({
      currentTemp: 26.5, // Warm from solar gain and occupancy
      weatherTemp: 28.0, // Warm day
      hour: 14, // Peak afternoon
      isWeekday: true, // Business day
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle residential evening scenario", () => {
    const data = createStateChangeData({
      currentTemp: 27.2, // Hot from day's heat
      weatherTemp: 30.0, // Still warm outside
      hour: 19, // Early evening
      isWeekday: false, // Weekend
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true);
  });

  test("should handle energy conservation late evening", () => {
    const data = createStateChangeData({
      currentTemp: 26.2, // Still slightly warm
      weatherTemp: 22.0, // Cooled down outside
      hour: 21, // Late evening
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true); // Still within active hours
  });

  test("should handle desert climate scenario", () => {
    const data = createStateChangeData({
      currentTemp: 29.0, // Very warm inside
      weatherTemp: 42.0, // Hot desert day (but within limits)
      hour: 12, // Midday
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true); // Within outdoor limits
  });

  test("should handle humid climate scenario", () => {
    const data = createStateChangeData({
      currentTemp: 26.3, // Moderately warm
      weatherTemp: 28.0, // Warm and humid outside
      hour: 16, // Afternoon
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldCool).toBe(true); // Good cooling conditions
  });
});
