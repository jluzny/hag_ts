#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write

/**
 * WebSocket Debug Script
 *
 * Tests WebSocket connection and authentication flow step-by-step
 * Useful for debugging WebSocket timing and authentication issues
 */

import { createContainer } from '../src/core/container.ts';
import { TYPES } from '../src/core/types.ts';
import { HomeAssistantClient } from '../src/home-assistant/client.ts';

console.log('🔌 WebSocket Connection Debug\n');

const container = await createContainer('config/hvac_config.yaml');
const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

try {
  console.log('Step 1: Connecting to WebSocket...');
  await client.connect();
  console.log('✅ WebSocket connected and authenticated');

  console.log('\nStep 2: Testing connection status...');
  console.log(`Connected: ${client.connected}`);

  console.log('\nStep 3: Getting connection stats...');
  const stats = client.getStats();
  console.log('Connection stats:', stats);

  console.log('\nStep 4: Testing sensor access...');
  try {
    const tempState = await client.getState(
      'sensor.1st_floor_hall_multisensor_temperature',
    );
    console.log(`✅ Indoor temp: ${tempState.state}°C`);
  } catch (error) {
    console.log(`❌ Indoor temp error: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const outdoorState = await client.getState(
      'sensor.openweathermap_temperature',
    );
    console.log(`✅ Outdoor temp: ${outdoorState.state}°C`);
  } catch (error) {
    console.log(`❌ Outdoor temp error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log('\nStep 5: Disconnecting...');
  await client.disconnect();
  console.log('✅ Disconnected cleanly');
} catch (error) {
  console.error('❌ WebSocket debug failed:', error instanceof Error ? error.message : String(error));
  console.error('Stack trace:', error instanceof Error ? error.stack : String(error));
}
