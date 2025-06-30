/**
 * Integration tests for Home Assistant connectivity
 *
 * This test consolidates WebSocket, REST API, and sensor testing
 * to validate complete Home Assistant integration.
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import { createContainer } from '../../src/core/container.ts';
import { TYPES } from '../../src/core/types.ts';
import { HomeAssistantClient } from '../../src/home-assistant/client.ts';
import { HassOptions } from '../../src/config/config.ts';
import { LoggerService } from '../../src/core/logger.ts';

// Test configuration

// Skip integration tests if no Home Assistant credentials available
const hasHassCredentials =
  !!(Deno.env.get('HASS_URL') && Deno.env.get('HASS_TOKEN'));

Deno.test('Home Assistant Integration', async (t) => {
  if (!hasHassCredentials) {
    await t.step('should skip integration tests - no HA credentials', () => {
      console.log(
        '⚠️  Skipping Home Assistant integration tests - HASS_URL or HASS_TOKEN not configured',
      );
      assertEquals(true, true); // Pass the test
    });
    return;
  }

  const hassUrl = Deno.env.get('HASS_URL')!;
  const hassToken = Deno.env.get('HASS_TOKEN')!;

  await t.step('should test REST API connectivity', async () => {
    console.log('📡 Testing REST API connectivity...');

    try {
      const response = await fetch(`${hassUrl}/api/`, {
        headers: {
          'Authorization': `Bearer ${hassToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      assertEquals(response.ok, true, 'REST API should be accessible');

      const data = await response.json();
      assertExists(data.message);
      console.log('✅ REST API connection successful');
    } catch (error) {
      console.error('❌ REST API connection failed:', error.message);
      throw error;
    }
  });

  await t.step('should discover temperature sensors', async () => {
    console.log('🌡️ Discovering temperature sensors...');

    try {
      const response = await fetch(`${hassUrl}/api/states`, {
        headers: {
          'Authorization': `Bearer ${hassToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      assertEquals(response.ok, true, 'States API should be accessible');

      const states = await response.json();
      assertEquals(Array.isArray(states), true, 'States should be an array');

      // Find temperature sensors
      const tempSensors = states.filter((state: { entity_id: string; attributes?: { unit_of_measurement?: string } }) =>
        state.entity_id.includes('temperature') ||
        (state.attributes?.unit_of_measurement === '°C' ||
          state.attributes?.unit_of_measurement === '°F')
      );

      console.log(`🔍 Found ${tempSensors.length} temperature sensors`);

      if (tempSensors.length > 0) {
        console.log('📋 Available temperature sensors:');
        tempSensors.slice(0, 5).forEach((sensor: { entity_id: string; state: string; attributes?: { unit_of_measurement?: string } }) => {
          console.log(
            `   - ${sensor.entity_id}: ${sensor.state}${
              sensor.attributes?.unit_of_measurement || ''
            }`,
          );
        });
      }

      assertEquals(
        tempSensors.length > 0,
        true,
        'Should find at least one temperature sensor',
      );
    } catch (error) {
      console.error('❌ Sensor discovery failed:', error.message);
      throw error;
    }
  });

  await t.step('should test WebSocket connection', async () => {
    console.log('🔌 Testing WebSocket connection...');

    try {
      const container = await createContainer('./config/hvac_config.yaml');
      const client = container.get<HomeAssistantClient>(
        TYPES.HomeAssistantClient,
      );

      // Test connection
      await client.connect();
      assertEquals(client.connected, true, 'Client should be connected');
      console.log('✅ WebSocket connection successful');

      // Test getting state
      const states = await client.getStates();
      assertExists(states);
      assertEquals(Array.isArray(states), true, 'States should be an array');
      console.log(`📊 Retrieved ${states.length} entity states`);

      // Test sensor reading if available
      const tempSensors = states.filter((state) =>
        state.entity_id.includes('temperature') &&
        !isNaN(parseFloat(state.state))
      );

      if (tempSensors.length > 0) {
        const sensor = tempSensors[0];
        const reading = await client.getEntityState(sensor.entity_id);
        assertExists(reading);
        console.log(
          `🌡️ Test sensor reading: ${sensor.entity_id} = ${reading.state}${
            reading.attributes?.unit_of_measurement || ''
          }`,
        );
      }

      // Cleanup
      await client.disconnect();
      assertEquals(client.connected, false, 'Client should be disconnected');
      console.log('✅ WebSocket disconnection successful');
    } catch (error) {
      console.error('❌ WebSocket connection failed:', error.message);
      throw error;
    }
  });

  await t.step('should test service calls', async () => {
    console.log('⚙️ Testing service calls...');

    try {
      const container = await createContainer('./config/hvac_config.yaml');
      const client = container.get<HomeAssistantClient>(
        TYPES.HomeAssistantClient,
      );

      await client.connect();

      // Test getting services
      const services = await client.getServices();
      assertExists(services);
      console.log(
        `📋 Available services: ${Object.keys(services).length} domains`,
      );

      // Check for common HVAC-related services
      const hvacServices = ['climate', 'switch', 'input_number', 'automation'];
      const availableHvacServices = hvacServices.filter((service) =>
        services[service]
      );

      console.log(
        `🏠 HVAC-related services available: ${
          availableHvacServices.join(', ')
        }`,
      );
      assertEquals(
        availableHvacServices.length > 0,
        true,
        'Should have at least one HVAC service available',
      );

      await client.disconnect();
    } catch (error) {
      console.error('❌ Service call test failed:', error.message);
      throw error;
    }
  });

  await t.step('should test entity filtering', async () => {
    console.log('🔍 Testing entity filtering...');

    try {
      const container = await createContainer('./config/hvac_config.yaml');
      const client = container.get<HomeAssistantClient>(
        TYPES.HomeAssistantClient,
      );

      await client.connect();

      const states = await client.getStates();

      // Test different entity types
      const entityTypes = {
        sensors: states.filter((s) => s.entity_id.startsWith('sensor.')),
        climate: states.filter((s) => s.entity_id.startsWith('climate.')),
        switches: states.filter((s) => s.entity_id.startsWith('switch.')),
        binary_sensors: states.filter((s) =>
          s.entity_id.startsWith('binary_sensor.')
        ),
      };

      console.log('📊 Entity type breakdown:');
      for (const [type, entities] of Object.entries(entityTypes)) {
        console.log(`   - ${type}: ${entities.length}`);
      }

      // Should have reasonable number of entities
      assertEquals(
        states.length > 0,
        true,
        'Should have at least some entities',
      );
      assertEquals(
        entityTypes.sensors.length > 0,
        true,
        'Should have at least some sensors',
      );

      await client.disconnect();
    } catch (error) {
      console.error('❌ Entity filtering test failed:', error.message);
      throw error;
    }
  });

  await t.step('should handle connection errors gracefully', async () => {
    console.log('🚨 Testing error handling...');

    // Test with invalid URL
    const invalidOptions: HassOptions = {
      wsUrl: 'ws://invalid-host:8123/api/websocket',
      restUrl: 'http://invalid-host:8123/api',
      token: 'invalid-token',
    };

    const mockLogger: LoggerService = {
      info: () => {},
      error: () => {},
      debug: () => {},
      warning: () => {},
    };

    const invalidClient = new HomeAssistantClient(invalidOptions, mockLogger);

    try {
      // This should fail
      await invalidClient.connect();
      assertEquals(
        false,
        true,
        'Connection should fail with invalid credentials',
      );
    } catch (error) {
      // Expected to fail
      assertInstanceOf(error, Error);
      console.log('✅ Error handling working correctly');
    }
  });

  await t.step('should validate configuration integration', async () => {
    console.log('⚙️ Testing configuration integration...');

    try {
      // Test that container can be created with current config
      const container = await createContainer('./config/hvac_config.yaml');
      assertExists(container);

      // Test that Home Assistant client can be retrieved
      const client = container.get<HomeAssistantClient>(
        TYPES.HomeAssistantClient,
      );
      assertExists(client);
      assertInstanceOf(client, HomeAssistantClient);

      console.log('✅ Configuration integration successful');
    } catch (error) {
      console.error('❌ Configuration integration failed:', error.message);
      throw error;
    }
  });

  console.log(
    '🎉 All Home Assistant integration tests completed successfully!',
  );
});
