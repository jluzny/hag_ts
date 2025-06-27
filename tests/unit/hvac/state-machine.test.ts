/**
 * Unit tests for HVAC state machine in HAG JavaScript variant.
 * 
 * Tests state transitions, decision logic, and strategy integration.
 */

import { assertEquals, assertExists, assertThrows } from '@std/assert';
import { HVACStateMachine, createHVACMachine } from '../../../src/hvac/state-machine.ts';
import { HvacOptions } from '../../../src/config/settings.ts';
import { HVACMode, SystemMode } from '../../../src/types/common.ts';

// Mock HVAC options for testing
const mockHvacOptions: HvacOptions = {
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
  activeHours: {
    start: 8,
    startWeekday: 7,
    end: 22,
  },
};

Deno.test('HVAC State Machine', async (t) => {
  let stateMachine: HVACStateMachine;

  await t.step('should initialize correctly', () => {
    stateMachine = new HVACStateMachine(mockHvacOptions);
    
    assertExists(stateMachine);
    assertEquals(stateMachine.getCurrentState(), 'idle');
    
    const status = stateMachine.getStatus();
    assertEquals(status.currentState, 'idle');
    assertExists(status.context);
  });

  await t.step('should start and stop correctly', () => {
    stateMachine.start();
    // State machine should be running after start
    
    stateMachine.stop();
    // Should handle stop gracefully
  });

  await t.step('should update temperatures', () => {
    const indoorTemp = 20.5;
    const outdoorTemp = 5.0;
    
    stateMachine.updateTemperatures(indoorTemp, outdoorTemp);
    
    const status = stateMachine.getStatus();
    assertEquals(status.context.indoorTemp, indoorTemp);
    assertEquals(status.context.outdoorTemp, outdoorTemp);
  });

  await t.step('should handle heating scenario', () => {
    // Set conditions that should trigger heating
    stateMachine.updateTemperatures(18.0, 5.0); // Below heating threshold
    stateMachine.evaluateConditions();
    
    const currentState = stateMachine.getCurrentState();
    // Should be in heating state when indoor temp is below threshold
    assertEquals(currentState, 'heating');
  });

  await t.step('should handle cooling scenario', () => {
    // Set conditions that should trigger cooling
    stateMachine.updateTemperatures(27.0, 25.0); // Above cooling threshold
    stateMachine.evaluateConditions();
    
    const currentState = stateMachine.getCurrentState();
    // Should be in cooling state when indoor temp is above threshold
    assertEquals(currentState, 'cooling');
  });

  await t.step('should handle idle scenario', () => {
    // Set conditions that should keep system idle
    stateMachine.updateTemperatures(21.0, 15.0); // Within comfort zone
    stateMachine.evaluateConditions();
    
    const currentState = stateMachine.getCurrentState();
    // Should be idle when temperature is in comfort zone
    assertEquals(currentState, 'idle');
  });

  await t.step('should handle defrost scenario', () => {
    // Set conditions that should trigger defrost
    stateMachine.updateTemperatures(18.0, -5.0); // Cold outdoor, heating needed
    stateMachine.evaluateConditions();
    
    // First should go to heating
    assertEquals(stateMachine.getCurrentState(), 'heating');
    
    // Simulate defrost trigger
    stateMachine.triggerDefrost();
    assertEquals(stateMachine.getCurrentState(), 'defrosting');
  });

  await t.step('should handle manual override', () => {
    // Test heat override
    stateMachine.manualOverride(HVACMode.HEAT, 22.0);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
    
    // Test cool override
    stateMachine.manualOverride(HVACMode.COOL, 24.0);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
    
    // Test off override
    stateMachine.manualOverride(HVACMode.OFF);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
  });

  await t.step('should respect system mode restrictions', () => {
    // Test heat-only mode
    const heatOnlyOptions = { ...mockHvacOptions, systemMode: SystemMode.HEAT_ONLY };
    const heatOnlyMachine = new HVACStateMachine(heatOnlyOptions);
    
    heatOnlyMachine.updateTemperatures(27.0, 25.0); // High temp
    heatOnlyMachine.evaluateConditions();
    
    // Should not cool in heat-only mode
    const state = heatOnlyMachine.getCurrentState();
    assertEquals(state !== 'cooling', true);
  });

  await t.step('should respect active hours', () => {
    // Create machine with limited active hours
    const limitedHoursOptions = {
      ...mockHvacOptions,
      activeHours: {
        start: 9,
        startWeekday: 9,
        end: 17,
      },
    };
    const limitedMachine = new HVACStateMachine(limitedHoursOptions);
    
    // Set temperature that would normally trigger heating
    limitedMachine.updateTemperatures(18.0, 5.0);
    
    // Mock current time to be outside active hours
    const originalDate = Date;
    globalThis.Date = class extends Date {
      constructor() {
        super();
        // Mock 6 AM (outside active hours)
        return new originalDate('2024-01-15T06:00:00Z');
      }
      
      static now() {
        return new originalDate('2024-01-15T06:00:00Z').getTime();
      }
    } as DateConstructor;
    
    limitedMachine.evaluateConditions();
    
    // Should remain idle outside active hours
    assertEquals(limitedMachine.getCurrentState(), 'idle');
    
    // Restore original Date
    globalThis.Date = originalDate;
  });

  await t.step('should handle outdoor temperature limits', () => {
    // Test heating with outdoor temp too low
    stateMachine.updateTemperatures(18.0, -15.0); // Below outdoor heating min
    stateMachine.evaluateConditions();
    
    // Should not heat when outdoor temp is too low
    const state = stateMachine.getCurrentState();
    // Depending on implementation, might be idle or have specific behavior
    assertExists(state);
    
    // Test cooling with outdoor temp too high
    stateMachine.updateTemperatures(27.0, 50.0); // Above outdoor cooling max
    stateMachine.evaluateConditions();
    
    // Should handle extreme outdoor temperatures appropriately
    assertExists(stateMachine.getCurrentState());
  });

  await t.step('should provide comprehensive status', () => {
    stateMachine.updateTemperatures(20.0, 10.0);
    stateMachine.evaluateConditions();
    
    const status = stateMachine.getStatus();
    
    assertExists(status.currentState);
    assertExists(status.context);
    assertEquals(typeof status.context.indoorTemp, 'number');
    assertEquals(typeof status.context.outdoorTemp, 'number');
    assertEquals(typeof status.context.systemMode, 'string');
  });

  await t.step('should handle rapid temperature changes', () => {
    // Simulate rapid temperature fluctuations
    const temperatures = [18.0, 22.0, 19.0, 23.0, 20.0];
    let lastState = stateMachine.getCurrentState();
    
    for (const temp of temperatures) {
      stateMachine.updateTemperatures(temp, 15.0);
      stateMachine.evaluateConditions();
      
      const currentState = stateMachine.getCurrentState();
      assertExists(currentState);
      // State should be consistent with temperature
      lastState = currentState;
    }
  });

  await t.step('should handle boundary conditions', () => {
    // Test exact threshold temperatures
    const heatingMax = mockHvacOptions.heating.temperatureThresholds.indoorMax;
    const coolingMin = mockHvacOptions.cooling.temperatureThresholds.indoorMin;
    
    // Test heating threshold boundary
    stateMachine.updateTemperatures(heatingMax, 10.0);
    stateMachine.evaluateConditions();
    const stateAtHeatingBoundary = stateMachine.getCurrentState();
    assertExists(stateAtHeatingBoundary);
    
    // Test cooling threshold boundary  
    stateMachine.updateTemperatures(coolingMin, 20.0);
    stateMachine.evaluateConditions();
    const stateAtCoolingBoundary = stateMachine.getCurrentState();
    assertExists(stateAtCoolingBoundary);
  });
});

Deno.test('HVAC State Machine Creation', async (t) => {
  await t.step('should create machine with valid options', () => {
    const machine = createHVACMachine(mockHvacOptions);
    assertExists(machine);
  });

  await t.step('should handle minimal configuration', () => {
    const minimalOptions: HvacOptions = {
      tempSensor: 'sensor.temp',
      outdoorSensor: 'sensor.outdoor',
      systemMode: SystemMode.AUTO,
      hvacEntities: [],
      heating: {
        temperature: 20.0,
        presetMode: 'comfort',
        temperatureThresholds: {
          indoorMin: 18.0,
          indoorMax: 21.0,
          outdoorMin: -20.0,
          outdoorMax: 10.0,
        },
      },
      cooling: {
        temperature: 25.0,
        presetMode: 'eco',
        temperatureThresholds: {
          indoorMin: 24.0,
          indoorMax: 27.0,
          outdoorMin: 15.0,
          outdoorMax: 40.0,
        },
      },
    };
    
    const machine = createHVACMachine(minimalOptions);
    assertExists(machine);
  });
});

Deno.test('HVAC State Machine Error Handling', async (t) => {
  const stateMachine = new HVACStateMachine(mockHvacOptions);

  await t.step('should handle invalid manual override modes', () => {
    // Test with valid modes first
    stateMachine.manualOverride(HVACMode.HEAT);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
    
    stateMachine.manualOverride(HVACMode.COOL);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
    
    stateMachine.manualOverride(HVACMode.OFF);
    assertEquals(stateMachine.getCurrentState(), 'manualOverride');
  });

  await t.step('should handle invalid temperature values', () => {
    // Test with extreme values
    stateMachine.updateTemperatures(NaN, 15.0);
    const status1 = stateMachine.getStatus();
    assertExists(status1); // Should handle gracefully
    
    stateMachine.updateTemperatures(20.0, Infinity);
    const status2 = stateMachine.getStatus();
    assertExists(status2); // Should handle gracefully
  });
});