import { HeatingStrategy } from './src/hvac/state-machine.ts';
import { SystemMode } from './src/types/common.ts';
import type { StateChangeData } from './src/types/common.ts';

// Test configuration (copy from test file)
const baseHvacOptions = {
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

// Helper function from test file
function createStateChangeData(overrides: Partial<StateChangeData> = {}): StateChangeData {
  return {
    currentTemp: 20.0,
    weatherTemp: 5.0,
    hour: 10,
    isWeekday: true,
    ...overrides,
  };
}

console.log('=== Testing Cold Winter Morning (using test helper) ===');
const strategy1 = new HeatingStrategy(baseHvacOptions);
const coldMorning = createStateChangeData({
  currentTemp: 17.5, // Cold indoor
  weatherTemp: -8.0, // Cold outdoor but within range
  hour: 7,           // Early morning, weekday start
  isWeekday: true,
});

console.log('Input:', coldMorning);
console.log('shouldHeat:', strategy1.shouldHeat(coldMorning));
console.log('needsDefrost:', strategy1.needsDefrost(coldMorning));

console.log('\n=== Testing Defrost Boundary (using test helper) ===');
const strategy2 = new HeatingStrategy(baseHvacOptions);
const defrostBoundary = createStateChangeData({
  weatherTemp: -0.1, // Just below defrost threshold
});

console.log('Input:', defrostBoundary);
console.log('needsDefrost:', strategy2.needsDefrost(defrostBoundary));

console.log('\n=== Testing Extreme Cold (using test helper) ===');
const strategy3 = new HeatingStrategy(baseHvacOptions);
const extremeCold = createStateChangeData({
  currentTemp: 16.0,  // Very cold indoor
  weatherTemp: -20.0, // Extremely cold outdoor (below limit)
  hour: 10,
  isWeekday: true,
});

console.log('Input:', extremeCold);
console.log('shouldHeat:', strategy3.shouldHeat(extremeCold));
console.log('needsDefrost:', strategy3.needsDefrost(extremeCold));