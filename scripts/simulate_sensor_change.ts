/**
 * Simulate Entity Change Script
 * 
 * Generic script to simulate any Home Assistant entity change and trigger HVAC evaluation
 * Usage: bun run scripts/simulate_sensor_change.ts <entity_id> [new_value]
 */

import { createContainer } from '../src/core/container.ts';
import { TYPES } from '../src/core/types.ts';
import { HomeAssistantClient } from '../src/home-assistant/client.ts';
import { HVACController } from '../src/hvac/controller.ts';

// Parse command line arguments
const args = process.argv.slice(2);
const entityId = args[0];
const newValue = args[1];

if (!entityId) {
  console.log('❌ Usage: bun run scripts/simulate_sensor_change.ts <entity_id> [new_value]');
  console.log('📝 Examples:');
  console.log('   bun run scripts/simulate_sensor_change.ts sensor.temperature 23.5');
  console.log('   bun run scripts/simulate_sensor_change.ts binary_sensor.door_contact on');
  console.log('   bun run scripts/simulate_sensor_change.ts switch.living_room_light off');
  process.exit(1);
}

const container = await createContainer('config/hvac_config_dev.yaml');
const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
const controller = container.get<HVACController>(TYPES.HVACController);

console.log('🎯 Simulating Entity Change');
console.log('===========================');
console.log(`📡 Target entity: ${entityId}`);
console.log(`🔢 New value: ${newValue || 'current value'}`);

try {
  // Start the HVAC controller
  console.log('\n🚀 Starting HVAC controller...');
  await controller.start();
  
  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`📊 Initial state: ${controller.getCurrentState()}`);
  console.log(`⏰ Current time: ${new Date().getHours()}:00`);
  
  // Get current entity value if no new value provided
  let valueToUse = newValue;
  if (!valueToUse) {
    console.log(`\n📡 Reading current value for ${entityId}...`);
    const currentState = await client.getState(entityId);
    valueToUse = currentState.state;
    console.log(`📊 Current value: ${valueToUse}`);
  }
  
  console.log(`🎯 Simulating change for ${entityId}: ${valueToUse}`);
  
  // Wait 5 seconds before simulating sensor change
  console.log('\n⏱️  Waiting 5 seconds before simulating sensor change...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Send UPDATE_CONDITIONS event to trigger HVAC evaluation
  console.log('\n🔄 Sending UPDATE_CONDITIONS event to state machine...');
  const stateMachine = (controller as any).stateMachine;
  
  if (stateMachine) {
    // Get current context to preserve existing values
    const currentContext = stateMachine.getContext();
    
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        // Preserve current context values
        ...currentContext,
        // Update timestamp
        currentHour: new Date().getHours(),
        isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5
      },
      eventSource: {
        type: "state_changed",
        entityId: entityId,
        newValue: valueToUse,
        entityType: entityId.split('.')[0]
      }
    });
    
    console.log('✅ UPDATE_CONDITIONS event sent');
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`📊 Final state: ${controller.getCurrentState()}`);
    
    // Show final context
    const context = stateMachine.getContext();
    console.log('\n📋 Final HVAC context:');
    console.log(`   Current hour: ${context.currentHour}`);
    console.log(`   Is weekday: ${context.isWeekday}`);
    console.log(`   System mode: ${context.systemMode}`);
    if (context.indoorTemp) console.log(`   Indoor temp: ${context.indoorTemp}°C`);
    if (context.outdoorTemp) console.log(`   Outdoor temp: ${context.outdoorTemp}°C`);
    
  } else {
    console.log('❌ Could not access state machine');
  }
  
  // Stop the controller
  console.log('\n🛑 Stopping HVAC controller...');
  await controller.stop();
  
  console.log('✅ Simulation completed');
  
} catch (error) {
  console.error('❌ Simulation failed:', error instanceof Error ? error.message : String(error));
  try {
    await controller.stop();
  } catch (stopError) {
    // Ignore stop errors
  }
}