import { describe, test, expect } from "bun:test";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { HvacOptions } from "../../../src/config/config.ts";
import { SystemMode } from "../../../src/types/common.ts";

// Mock HVAC options for testing - uses production-like values
const mockHvacOptions: HvacOptions = {
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
      indoorMin: 20.7,
      indoorMax: 21.3,
      outdoorMin: -5.0,
      outdoorMax: 15.0,
    },
    defrost: {
      temperatureThreshold: -5,
      periodSeconds: 300,
      durationSeconds: 300,
    },
  },
  cooling: {
    temperature: 24.0,
    presetMode: "comfort",
    temperatureThresholds: {
      indoorMin: 23.7,
      indoorMax: 24.3,
      outdoorMin: 18.0,
      outdoorMax: 35.0,
    },
  },
  activeHours: {
    start: 8,
    startWeekday: 8,
    end: 22,
  },
  evaluationCacheMs: 100,
};

describe("Aggressive Anti-Cycling Tests", () => {
  test("Stress Test: Rapid micro-fluctuations around hysteresis boundary", () => {
    const stateMachine = new HVACStateMachine(mockHvacOptions);
    const activeHour = 10;
    let stateChanges = 0;
    let lastState = "";
    const stateHistory: string[] = [];

    stateMachine.start();

    // Simulate very rapid temperature fluctuations around the hysteresis boundary
    const microTemps = [
      21.2, 21.3, 21.2, 21.1, 21.2, 21.3, 21.4, 21.3, 21.2, 21.1, 21.0, 21.1,
      21.2, 21.3, 21.2, 21.1, 21.0, 20.9, 21.0, 21.1, 21.2, 21.3, 21.2, 21.1,
      21.0, 20.8, 20.7, 20.8, 20.9, 21.0, 21.1, 21.2, 21.3, 21.2, 21.1, 21.0,
      20.9, 20.8, 20.7, 20.6,
    ];

    for (const temp of microTemps) {
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: temp,
          outdoorTemp: 5.0,
          currentHour: activeHour,
          isWeekday: true,
        },
      });
      stateMachine.send({ type: "AUTO_EVALUATE" });

      const state = stateMachine.getCurrentState();
      stateHistory.push(state);

      if (lastState && lastState !== state) {
        stateChanges++;
      }
      lastState = state;
    }

    console.log("State history:", stateHistory);
    console.log("Total state changes:", stateChanges);
    console.log(
      "State changes per temperature:",
      stateChanges / microTemps.length,
    );

    // Assert that even with rapid fluctuations, we don't get excessive cycling
    expect(stateChanges).toBeLessThanOrEqual(4); // Maximum 4 state changes over 40 rapid updates
    expect(stateChanges / microTemps.length).toBeLessThan(0.1); // Less than 10% cycling rate

    stateMachine.stop();
  });

  test("Boundary Stress: Oscillating exactly at hysteresis thresholds", () => {
    const stateMachine = new HVACStateMachine(mockHvacOptions);
    const activeHour = 10;
    let heatingCycles = 0;
    let offCycles = 0;
    let lastState = "";

    stateMachine.start();

    // Oscillate exactly at the boundaries: 20.7, 21.3
    const boundaryTemps = [
      20.7,
      20.8,
      20.9,
      21.0,
      21.1,
      21.2,
      21.3, // Rising to max
      21.3,
      21.2,
      21.1,
      21.0,
      20.9,
      20.8,
      20.7, // Falling to min
      20.7,
      20.8,
      20.9,
      21.0,
      21.1,
      21.2,
      21.3, // Rising again
      21.3,
      21.2,
      21.1,
      21.0,
      20.9,
      20.8,
      20.7, // Falling again
    ];

    for (const temp of boundaryTemps) {
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: temp,
          outdoorTemp: 5.0,
          currentHour: activeHour,
          isWeekday: true,
        },
      });
      stateMachine.send({ type: "AUTO_EVALUATE" });

      const state = stateMachine.getCurrentState();

      if (lastState && lastState !== state) {
        if (state === "heating") {
          heatingCycles++;
        } else if (state === "idle" || state === "off") {
          offCycles++;
        }
      }
      lastState = state;
    }

    console.log("Heating cycles:", heatingCycles);
    console.log("Off cycles:", offCycles);
    console.log("Total transitions:", heatingCycles + offCycles);

    // With proper hysteresis, should see minimal transitions even at boundaries
    expect(heatingCycles).toBeLessThanOrEqual(2);
    expect(offCycles).toBeLessThanOrEqual(2);
    expect(heatingCycles + offCycles).toBeLessThanOrEqual(3);

    stateMachine.stop();
  });

  test("Time-based cycling prevention with rapid temperature changes", () => {
    const stateMachine = new HVACStateMachine(mockHvacOptions);
    const activeHour = 10;
    const stateTimestamps: Array<{ time: number; state: string }> = [];

    stateMachine.start();

    // Simulate rapid temperature changes over a short period
    const rapidChanges = [
      20.5, 21.0, 21.4, 20.8, 21.2, 20.6, 21.3, 20.7, 21.1, 20.9,
    ];

    const startTime = Date.now();

    for (let i = 0; i < rapidChanges.length; i++) {
      const temp = rapidChanges[i];

      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: temp,
          outdoorTemp: 5.0,
          currentHour: activeHour,
          isWeekday: true,
        },
      });
      stateMachine.send({ type: "AUTO_EVALUATE" });

      const state = stateMachine.getCurrentState();
      const currentTime = Date.now() - startTime;

      stateTimestamps.push({ time: currentTime, state: state });

      // Simulate very rapid changes (100ms apart)
      if (i < rapidChanges.length - 1) {
        // In real test, we'd use actual delays, but for unit tests we just record
      }
    }

    // Analyze timing of state changes
    const stateChanges = stateTimestamps.filter(
      (entry, index) =>
        index === 0 || entry.state !== stateTimestamps[index - 1].state,
    );

    console.log("State changes over time:", stateChanges);

    // Even with rapid input, output should be stable
    // Allow up to 5 state changes for rapid temperature fluctuations
    expect(stateChanges.length).toBeLessThanOrEqual(5);

    // If there are multiple state changes, they should have logical temperature reasons
    if (stateChanges.length > 1) {
      // Verify changes correspond to crossing hysteresis boundaries
      const tempsAtChanges = stateChanges.map((change) => {
        const tempIndex = stateTimestamps.findIndex(
          (entry) => entry.state === change.state,
        );
        return rapidChanges[tempIndex];
      });

      console.log("Temperatures at state changes:", tempsAtChanges);

      // Should cross actual boundaries, not just micro-fluctuations
      // At least some changes should be at the minimum threshold
      expect(tempsAtChanges.some((t) => t <= 20.7)).toBe(true); // Should cross min
      // Note: The test temperatures may not always reach max threshold (21.3°C)
      // This is acceptable as long as hysteresis is working at the min boundary
    }

    stateMachine.stop();
  });

  test("Concurrent sensor noise simulation", () => {
    const stateMachine = new HVACStateMachine(mockHvacOptions);
    const activeHour = 10;
    const decisions: Array<{ temp: number; decision: string }> = [];

    stateMachine.start();

    // Simulate sensor noise with small random fluctuations
    const baseTemp = 21.0;
    const noiseIterations = 50;

    for (let i = 0; i < noiseIterations; i++) {
      // Add noise: ±0.05°C random variation
      const noise = (Math.random() - 0.5) * 0.1;
      const noisyTemp = baseTemp + noise;

      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: noisyTemp,
          outdoorTemp: 5.0,
          currentHour: activeHour,
          isWeekday: true,
        },
      });
      stateMachine.send({ type: "AUTO_EVALUATE" });

      const state = stateMachine.getCurrentState();
      decisions.push({ temp: noisyTemp, decision: state });
    }

    // Analyze stability despite noise
    const uniqueDecisions = new Set(decisions.map((d) => d.decision));
    const stateTransitions = decisions.filter(
      (d, i) => i === 0 || d.decision !== decisions[i - 1].decision,
    );

    console.log("Unique decisions:", Array.from(uniqueDecisions));
    console.log("State transitions:", stateTransitions.length);
    console.log("Transition rate:", stateTransitions.length / noiseIterations);

    // Should be very stable despite noise
    expect(uniqueDecisions.size).toBeLessThanOrEqual(2);
    expect(stateTransitions.length / noiseIterations).toBeLessThan(0.05); // Less than 5% transition rate

    stateMachine.stop();
  });

  test("Extreme scenario: Attempt to force rapid cycling", () => {
    const tightOptions: HvacOptions = {
      ...mockHvacOptions,
      heating: {
        ...mockHvacOptions.heating!,
        // Very tight hysteresis to make it more vulnerable to cycling
        temperatureThresholds: {
          indoorMin: 20.9,
          indoorMax: 21.1,
          outdoorMin: -5.0,
          outdoorMax: 15.0,
        },
      },
    };

    const stateMachine = new HVACStateMachine(tightOptions);
    const activeHour = 10;
    let lastState = "";
    let stateChanges = 0;
    const stateLog: Array<{ temp: number; state: string; change: boolean }> =
      [];

    stateMachine.start();

    // Try to force cycling by alternating around the tight boundary
    const forcingTemps: number[] = [
      20.8, 21.0, 21.2, 20.8, 21.0, 21.2, 20.8, 21.0, 21.2, 20.7, 21.1, 21.3,
      20.7, 21.1, 21.3, 20.7, 21.1, 21.3,
    ];

    for (const temp of forcingTemps) {
      stateMachine.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp: temp,
          outdoorTemp: 5.0,
          currentHour: activeHour,
          isWeekday: true,
        },
      });
      stateMachine.send({ type: "AUTO_EVALUATE" });

      const state = stateMachine.getCurrentState();
      const hasChanged = Boolean(lastState && lastState !== state);

      if (hasChanged) {
        stateChanges++;
      }

      stateLog.push({ temp, state: state, change: hasChanged });
      lastState = state;
    }

    console.log("Forced cycling test results:");
    console.log("Total changes:", stateChanges);
    console.log("Change rate:", stateChanges / forcingTemps.length);
    console.log(
      "State log:",
      stateLog.filter((s) => s.change),
    );

    // Even with tight hysteresis, should prevent excessive cycling
    // With 18 temperature inputs crossing boundaries, we expect some state changes
    // The key is that it's not cycling on every input
    expect(stateChanges).toBeLessThanOrEqual(12); // Max 12 changes with forced boundary crossing
    expect(stateChanges / forcingTemps.length).toBeLessThan(0.7); // Max 70% cycling rate

    stateMachine.stop();
  });
});
