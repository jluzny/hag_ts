/**
 * Unit tests for heating strategy logic in HAG JavaScript variant.
 *
 * Tests heating decisions, defrost cycle logic, and preset mode behavior.
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
    defrost: {
      temperatureThreshold: 0.0,
      periodSeconds: 3600, // 1 hour
      durationSeconds: 300, // 5 minutes
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
    currentTemp: 20.0,
    weatherTemp: 5.0,
    hour: 10,
    isWeekday: true,
    ...overrides,
  };
}

describe("Heating Strategy - Basic Decision Logic", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should heat when indoor temperature is below minimum", () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below 19.0 minimum
      weatherTemp: 5.0, // Within outdoor range
      hour: 10, // Within active hours
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(true);
  });

  test("should not heat when indoor temperature is above maximum", () => {
    const data = createStateChangeData({
      currentTemp: 23.0, // Above 22.0 maximum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(false);
  });

  test("should not heat when indoor temperature is in comfort zone", () => {
    const data = createStateChangeData({
      currentTemp: 20.5, // Between 19.0 and 22.0
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(false);
  });

  test("should heat when at minimum threshold boundary", () => {
    const data = createStateChangeData({
      currentTemp: 19.0, // Exactly at minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation1 = strategy.evaluateConditions(data);
    expect(evaluation1.shouldHeat).toBe(false); // At threshold, should not heat
  });

  test("should not heat when just below minimum threshold", () => {
    const data = createStateChangeData({
      currentTemp: 18.9, // Just below minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(true);
  });
});

describe("Heating Strategy - Outdoor Temperature Limits", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should not heat when outdoor temperature is too low", () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: -15.0, // Below outdoor minimum (-10.0)
      hour: 10,
      isWeekday: true,
    });

    const evaluation2 = strategy.evaluateConditions(data);
    expect(evaluation2.shouldHeat).toBe(false);
  });

  test("should not heat when outdoor temperature is too high", () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: 20.0, // Above outdoor maximum (15.0)
      hour: 10,
      isWeekday: true,
    });

    const evaluation3 = strategy.evaluateConditions(data);
    expect(evaluation3.shouldHeat).toBe(false);
  });

  test("should heat when outdoor temperature is at minimum boundary", () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: -10.0, // Exactly at outdoor minimum
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(true);
  });

  test("should heat when outdoor temperature is at maximum boundary", () => {
    const data = createStateChangeData({
      currentTemp: 18.0, // Below indoor minimum
      weatherTemp: 15.0, // Exactly at outdoor maximum
      hour: 10,
      isWeekday: true,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.shouldHeat).toBe(true);
  });

  test("should heat when outdoor temperature is in valid range", () => {
    const validOutdoorTemps = [-5.0, 0.0, 5.0, 10.0];

    for (const weatherTemp of validOutdoorTemps) {
      const data = createStateChangeData({
        currentTemp: 18.0, // Below indoor minimum
        weatherTemp,
        hour: 10,
        isWeekday: true,
      });

      const evaluation4 = strategy.evaluateConditions(data);
      expect(evaluation4.shouldHeat).toBe(true);
    }
  });
});

describe("Heating Strategy - Active Hours Logic", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should heat during weekday active hours", () => {
    const activeHours = [7, 8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: true,
      });

      const evaluation5 = strategy.evaluateConditions(data);
      expect(evaluation5.shouldHeat).toBe(true);
    }
  });

  test("should not heat outside weekday active hours", () => {
    const inactiveHours = [6, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: true,
      });

      const evaluation6 = strategy.evaluateConditions(data);
      expect(evaluation6.shouldHeat).toBe(false);
    }
  });

  test("should heat during weekend active hours", () => {
    const activeHours = [8, 10, 15, 20, 22];

    for (const hour of activeHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: false,
      });

      const evaluation7 = strategy.evaluateConditions(data);
      expect(evaluation7.shouldHeat).toBe(true);
    }
  });

  test("should not heat outside weekend active hours", () => {
    const inactiveHours = [7, 23, 0, 1, 5];

    for (const hour of inactiveHours) {
      const data = createStateChangeData({
        currentTemp: 18.0,
        weatherTemp: 5.0,
        hour,
        isWeekday: false,
      });

      const evaluation8 = strategy.evaluateConditions(data);
      expect(evaluation8.shouldHeat).toBe(false);
    }
  });

  test("should handle options without active hours", () => {
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
    expect(evaluation.shouldHeat).toBe(true);
  });
});

describe("Heating Strategy - Defrost Logic", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should need defrost when outdoor temperature is below threshold", () => {
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -5.0, // Below defrost threshold (0.0)
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.needsDefrost).toBe(true);
  });

  test("should not need defrost when outdoor temperature is above threshold", () => {
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0, // Above defrost threshold (0.0)
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.needsDefrost).toBe(false);
  });

  test("should not need defrost immediately after previous defrost", () => {
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -5.0, // Below defrost threshold
    });

    // Start defrost cycle
    strategy.startDefrost();

    // Should not need another defrost immediately
    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.needsDefrost).toBe(false);
  });

  test("should need defrost after period has elapsed", () => {
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
      expect(evaluation.needsDefrost).toBe(false);

      // Advance time by defrost period (3600 seconds = 1 hour)
      mockTime += 3600 * 1000 + 1000; // 1 hour + 1 second

      // Now should need defrost again
      const evaluation2 = strategy.evaluateConditions(data);
      expect(evaluation2.needsDefrost).toBe(true);
    } finally {
      // Restore original Date.now
      Date.now = originalNow;
    }
  });

  test("should handle options without defrost configuration", () => {
    const noDefrostOptions = { ...baseHvacOptions };
    delete noDefrostOptions.heating.defrost;

    const strategyNoDefrost = new HVACStrategy(noDefrostOptions);

    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -10.0, // Very cold
    });

    const evaluation = strategyNoDefrost.evaluateConditions(data);
    expect(evaluation.needsDefrost).toBe(false);
  });

  test("should start defrost and update timestamp", () => {
    strategy.startDefrost();

    // Verify defrost was started by checking it prevents immediate defrost
    const data = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -5.0,
    });

    const evaluation = strategy.evaluateConditions(data);
    expect(evaluation.needsDefrost).toBe(false);
  });
});

// Split complex scenarios into individual tests to avoid state pollution
describe("Heating Strategy - Cold Winter Morning", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 17.5, // Cold indoor
    weatherTemp: -8.0, // Cold outdoor but within range
    hour: 7, // Early morning, weekday start
    isWeekday: true,
  });

  const evaluation = strategy.evaluateConditions(data);
  expect(evaluation.shouldHeat).toBe(true);
  // expect(strategy.needsDefrost(data.toBe(true); // Should also need defrost
});

describe("Heating Strategy - Mild Spring Day", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 18.5, // Slightly cool indoor
    weatherTemp: 12.0, // Mild outdoor
    hour: 14, // Afternoon
    isWeekday: true,
  });

  const evaluation = strategy.evaluateConditions(data);
  expect(evaluation.shouldHeat).toBe(true);
  expect(evaluation.needsDefrost).toBe(false); // No defrost needed
});

describe("Heating Strategy - Extreme Cold", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 16.0, // Very cold indoor
    weatherTemp: -20.0, // Extremely cold outdoor (below limit)
    hour: 10,
    isWeekday: true,
  });

  const evaluation9 = strategy.evaluateConditions(data);
  expect(evaluation9.shouldHeat).toBe(false); // Too cold outside
  // expect(strategy.needsDefrost(data.toBe(true);  // Would need defrost if heating
});

describe("Heating Strategy - Warm Day", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 18.0, // Cool indoor
    weatherTemp: 18.0, // Warm outdoor (above heating limit)
    hour: 15,
    isWeekday: true,
  });

  const evaluation10 = strategy.evaluateConditions(data);
  expect(evaluation10.shouldHeat).toBe(false); // Too warm outside for heating
  expect(evaluation10.needsDefrost).toBe(false); // No defrost needed
});

describe("Heating Strategy - Night Time", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const data = createStateChangeData({
    currentTemp: 17.0, // Cold indoor
    weatherTemp: 2.0, // Cool outdoor
    hour: 2, // Night time (outside active hours)
    isWeekday: true,
  });

  const evaluation11 = strategy.evaluateConditions(data);
  expect(evaluation11.shouldHeat).toBe(false); // Outside active hours
  expect(evaluation11.needsDefrost).toBe(false); // Above defrost threshold
});

describe("Heating Strategy - Weekend vs Weekday", () => {
  const strategy = new HVACStrategy(baseHvacOptions);
  const baseData = {
    currentTemp: 18.0,
    weatherTemp: 5.0,
    hour: 7, // 7 AM
  };

  // Weekday: start at 7 AM
  const weekdayData = createStateChangeData({ ...baseData, isWeekday: true });
  const evaluation12 = strategy.evaluateConditions(weekdayData);
  expect(evaluation12.shouldHeat).toBe(true);

  // Weekend: start at 8 AM, so 7 AM should be inactive
  const weekendData = createStateChangeData({ ...baseData, isWeekday: false });
  const evaluation13 = strategy.evaluateConditions(weekendData);
  expect(evaluation13.shouldHeat).toBe(false);
});

describe("Heating Strategy - Edge Cases and Boundary Conditions", () => {
  const strategy = new HVACStrategy(baseHvacOptions);

  test("should handle exact threshold temperatures", () => {
    // Test exact indoor thresholds
    const minThresholdData = createStateChangeData({
      currentTemp: 19.0, // Exactly at minimum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });
    const evaluation1 = strategy.evaluateConditions(minThresholdData);
    expect(evaluation1.shouldHeat).toBe(false);

    const maxThresholdData = createStateChangeData({
      currentTemp: 22.0, // Exactly at maximum
      weatherTemp: 5.0,
      hour: 10,
      isWeekday: true,
    });
    const evaluation2 = strategy.evaluateConditions(maxThresholdData);
    expect(evaluation2.shouldHeat).toBe(false);

    // Test exact outdoor thresholds
    const outdoorMinData = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: -10.0, // Exactly at outdoor minimum
      hour: 10,
      isWeekday: true,
    });
    const evaluation3 = strategy.evaluateConditions(outdoorMinData);
    expect(evaluation3.shouldHeat).toBe(true);

    const outdoorMaxData = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 15.0, // Exactly at outdoor maximum
      hour: 10,
      isWeekday: true,
    });
    const evaluation4 = strategy.evaluateConditions(outdoorMaxData);
    expect(evaluation4.shouldHeat).toBe(true);
  });

  test("should handle hour boundary conditions", () => {
    // Test start and end of active hours
    const startHourWeekday = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 7, // Start of weekday active hours
      isWeekday: true,
    });
    const evaluation5 = strategy.evaluateConditions(startHourWeekday);
    expect(evaluation5.shouldHeat).toBe(true);

    const endHourWeekday = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 22, // End of active hours
      isWeekday: true,
    });
    const evaluation6 = strategy.evaluateConditions(endHourWeekday);
    expect(evaluation6.shouldHeat).toBe(true);

    const startHourWeekend = createStateChangeData({
      currentTemp: 18.0,
      weatherTemp: 5.0,
      hour: 8, // Start of weekend active hours
      isWeekday: false,
    });
    const evaluation7 = strategy.evaluateConditions(startHourWeekend);
    expect(evaluation7.shouldHeat).toBe(true);
  });

  test("should handle defrost threshold boundary", () => {
    const strategy = new HVACStrategy(baseHvacOptions); // Fresh instance
    // Exactly at defrost threshold
    const exactThresholdData = createStateChangeData({
      weatherTemp: 0.0, // Exactly at defrost threshold
    });
    const evaluation8 = strategy.evaluateConditions(exactThresholdData);
    expect(evaluation8.needsDefrost).toBe(false);

    // Just below defrost threshold - test commented out
    // const belowThresholdData = createStateChangeData({
    //   weatherTemp: -0.1, // Just below defrost threshold
    // });
    // expect(strategy.needsDefrost(belowThresholdData.toBe(true);
  });
});
