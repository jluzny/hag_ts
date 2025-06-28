#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Test REST API Directly Script
 *
 * Tests Home Assistant REST API calls directly without using the HAG client
 * Useful for debugging REST API URL construction and authentication issues
 */

// Test REST API directly
const token = Deno.env.get('HASS_HassOptions__Token');
const restUrl = 'http://192.168.0.204:8123/api';
const sensors = [
  'sensor.1st_floor_hall_multisensor_temperature',
  'sensor.openweathermap_temperature',
];

for (const sensor of sensors) {
  try {
    console.log(`Testing ${sensor}...`);
    const response = await fetch(`${restUrl}/states/${sensor}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`Response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log(
        `✅ Success: ${sensor} = ${data.state} ${
          data.attributes?.unit_of_measurement || ''
        }`,
      );
    } else {
      const errorText = await response.text();
      console.log(`❌ Failed: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
  }
  console.log('---');
}

