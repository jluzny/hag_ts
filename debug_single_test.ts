// Replicate the exact test that's failing
import { assertEquals } from '@std/assert';
import { HeatingStrategy } from './src/hvac/state-machine.ts';
import { HvacOptions } from './src/config/config.ts';
import { StateChangeData, SystemMode } from './src/types/common.ts';

// Base HVAC options for testing (exact copy from test)
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

// Helper function to create test data (exact copy from test)
function createStateChangeData(overrides: Partial<StateChangeData> = {}): StateChangeData {
  return {
    currentTemp: 20.0,
    weatherTemp: 5.0,
    hour: 10,
    isWeekday: true,
    ...overrides,
  };
}

// Test the exact failing scenario
console.log('=== Cold Winter Morning Test ===');
const strategy = new HeatingStrategy(baseHvacOptions);
const data = createStateChangeData({
  currentTemp: 17.5, // Cold indoor
  weatherTemp: -8.0, // Cold outdoor but within range
  hour: 7,           // Early morning, weekday start
  isWeekday: true,
});

console.log('Configuration:');
console.log('- indoorMin:', baseHvacOptions.heating.temperatureThresholds.indoorMin);
console.log('- indoorMax:', baseHvacOptions.heating.temperatureThresholds.indoorMax);
console.log('- outdoorMin:', baseHvacOptions.heating.temperatureThresholds.outdoorMin);
console.log('- outdoorMax:', baseHvacOptions.heating.temperatureThresholds.outdoorMax);
console.log('- startWeekday:', baseHvacOptions.activeHours?.startWeekday);
console.log('- start:', baseHvacOptions.activeHours?.start);
console.log('- end:', baseHvacOptions.activeHours?.end);

console.log('\nTest Data:', data);

const shouldHeatResult = strategy.shouldHeat(data);
console.log('shouldHeat result:', shouldHeatResult);

try {
  assertEquals(shouldHeatResult, true);
  console.log('✅ shouldHeat assertion PASSED');
} catch (error) {
  console.log('❌ shouldHeat assertion FAILED:', error.message);
}

const needsDefrostResult = strategy.needsDefrost(data);
console.log('needsDefrost result:', needsDefrostResult);

try {
  assertEquals(needsDefrostResult, true);
  console.log('✅ needsDefrost assertion PASSED');
} catch (error) {
  console.log('❌ needsDefrost assertion FAILED:', error.message);
}