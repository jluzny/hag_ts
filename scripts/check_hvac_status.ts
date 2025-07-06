#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Check HVAC Status Script
 *
 * Checks the current status of all HVAC entities
 */

import { createContainer } from '../src/core/container.ts';
import { TYPES } from '../src/core/types.ts';
import { HomeAssistantClient } from '../src/home-assistant/client.ts';

const container = await createContainer('config/hvac_config_dev.yaml');
const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

const hvacEntities = [
  'climate.living_room_ac',
  'climate.bedroom_ac',
  'climate.matej_ac',
  'climate.anicka_ac',
  'climate.radek_ac',
];

try {
  await client.connect();
  console.log('🏠 HVAC Entity Status Check');
  console.log('============================');

  for (const entityId of hvacEntities) {
    try {
      const state = await client.getState(entityId);
      console.log(`${entityId}:`);
      console.log(`  State: ${state.state}`);
      console.log(`  Temperature: ${state.attributes?.temperature || 'N/A'}°C`);
      console.log(`  HVAC Mode: ${state.attributes?.hvac_mode || 'N/A'}`);
      console.log(`  Preset: ${state.attributes?.preset_mode || 'N/A'}`);
      console.log(
        `  Current Temp: ${state.attributes?.current_temperature || 'N/A'}°C`,
      );
      console.log('');
    } catch (error) {
      console.log(`❌ Error checking ${entityId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await client.disconnect();
} catch (error) {
  console.error('❌ Failed:', error instanceof Error ? error.message : String(error));
}
