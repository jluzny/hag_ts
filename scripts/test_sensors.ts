#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Test Sensor Availability Script
 * 
 * Tests if specific temperature sensors exist in Home Assistant
 */

import { createContainer } from '../src/core/container.ts';
import { TYPES } from '../src/core/types.ts';
import { HomeAssistantClient } from '../src/home-assistant/client.ts';

const container = await createContainer('config/hvac_config.yaml');
const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

try {
  await client.connect();
  console.log('Connected successfully');
  
  // Try different sensor names
  const sensors = [
    'sensor.1st_floor_hall_multisensor_temperature',
    'sensor.openweathermap_temperature',
    'sensor.temperature',
    'sensor.indoor_temperature',
    'sensor.outdoor_temperature'
  ];
  
  for (const sensor of sensors) {
    try {
      const state = await client.getState(sensor);
      console.log(`✅ Found sensor: ${sensor} = ${state.state}`);
    } catch (_error) {
      console.log(`❌ Sensor not found: ${sensor}`);
    }
  }
  
  await client.disconnect();
} catch (error) {
  console.error('Failed:', error.message);
}