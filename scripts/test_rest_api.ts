#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Test REST API Directly Script
 *
 * Tests Home Assistant REST API calls directly without using the HAG client
 * Useful for debugging REST API URL construction and authentication issues
 */

// Get entity ID from command line arguments
const entityId = Deno.args[0];

if (!entityId) {
  console.error("Usage: ./test_rest_api.ts <entity_id>");
  Deno.exit(1);
}

// Test REST API directly
const token = Deno.env.get('HASS_HassOptions__Token');
const restUrl = 'http://192.168.0.204:8123/api';

try {
  console.log(`Testing ${entityId}...`);
  const response = await fetch(`${restUrl}/states/${entityId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  console.log(`Response status: ${response.status}`);

  if (response.ok) {
    const data = await response.json();
    console.log(
      `✅ Success: ${entityId} = ${data.state} ${
        data.attributes?.unit_of_measurement || ''
      }`,
    );
    console.log('  Attributes:', data.attributes);
  } else {
    const errorText = await response.text();
    console.log(`❌ Failed: ${response.status} - ${errorText}`);
  }
} catch (error) {
  console.log(`❌ Error: ${(error as Error).message}`);
}

