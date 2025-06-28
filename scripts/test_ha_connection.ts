#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Home Assistant Connection Test Script
 * 
 * Tests both WebSocket and REST API connectivity to Home Assistant
 */

import { createContainer } from '../src/core/container.ts';
import { TYPES } from '../src/core/types.ts';
import { HomeAssistantClient } from '../src/home-assistant/client.ts';

const token = Deno.env.get('HASS_HassOptions__Token');
const restUrl = 'http://192.168.0.204:8123/api';

console.log('🏠 Home Assistant Connection Test\n');

// Test 1: Direct REST API
console.log('📡 Testing REST API directly...');
try {
  const response = await fetch(`${restUrl}/states`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (response.ok) {
    const states = await response.json();
    const temperatureSensors = states.filter((state: { entity_id: string }) => 
      state.entity_id.includes('temperature') || state.entity_id.includes('temp')
    );
    
    console.log(`✅ REST API working - Found ${temperatureSensors.length} temperature sensors`);
    temperatureSensors.slice(0, 5).forEach((sensor: { entity_id: string; state: string; attributes?: { unit_of_measurement?: string } }) => {
      console.log(`   ${sensor.entity_id}: ${sensor.state} ${sensor.attributes?.unit_of_measurement || ''}`);
    });
  } else {
    console.log(`❌ REST API failed: ${response.status}`);
  }
} catch (error) {
  console.log(`❌ REST API error: ${error.message}`);
}

console.log('\n🔌 Testing WebSocket connection...');

// Test 2: WebSocket via HAG client
try {
  const container = await createContainer('config/hvac_config.yaml');
  const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
  
  await client.connect();
  console.log('✅ WebSocket connected and authenticated');
  
  // Test specific sensors
  const sensors = [
    'sensor.1st_floor_hall_multisensor_temperature',
    'sensor.openweathermap_temperature'
  ];
  
  for (const sensor of sensors) {
    try {
      const state = await client.getState(sensor);
      console.log(`✅ ${sensor}: ${state.state} ${state.attributes?.unit_of_measurement || ''}`);
    } catch (error) {
      console.log(`❌ ${sensor}: ${error.message}`);
    }
  }
  
  await client.disconnect();
  console.log('✅ WebSocket disconnected cleanly');
  
} catch (error) {
  console.log(`❌ WebSocket test failed: ${error.message}`);
}

console.log('\n🎯 Connection test complete');