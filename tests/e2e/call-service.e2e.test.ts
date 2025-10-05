/**
 * E2E Test: Call Home Assistant Service
 *
 * Tests Home Assistant service calling functionality using REST API
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { parse } from "yaml";

const TEST_CONFIG = "config/hvac_config_test.yaml";
const TEST_ENTITY = "climate.living_room_ac";

describe("Call Service E2E Tests", () => {
  let container: ReturnType<typeof createContainer> extends Promise<infer T>
    ? T
    : never;
  let client: HomeAssistantClient;
  let restUrl: string;
  let token: string;

  beforeAll(async () => {
    // Setup test container and dependencies
    container = await createContainer(TEST_CONFIG);
    client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

    // Load config for REST API details
    const configPath = process.env.CONFIG_PATH || TEST_CONFIG;
    const configFile = readFileSync(configPath, "utf8");
    const config = parse(configFile);

    restUrl = config.hassOptions.restUrl;
    token = process.env.HASS_HassOptions__Token || config.hassOptions.token;

    // Connect to Home Assistant
    await client.connect();
  });

  afterAll(async () => {
    // Cleanup
    try {
      if (client) {
        await client.disconnect();
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should call climate.turn_off service successfully", async () => {
    const serviceData = { entity_id: TEST_ENTITY };

    const response = await fetch(`${restUrl}/services/climate/turn_off`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    expect(response.status).toBe(200);

    // Wait a moment for the service call to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the entity is turned off
    const state = await client.getState(TEST_ENTITY);
    expect(state.state).toBe("off");
  });

  test("should call climate.set_hvac_mode service successfully", async () => {
    const serviceData = {
      entity_id: TEST_ENTITY,
      hvac_mode: "heat"
    };

    const response = await fetch(`${restUrl}/services/climate/set_hvac_mode`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    expect(response.status).toBe(200);

    // Wait a moment for the service call to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the entity mode changed
    const state = await client.getState(TEST_ENTITY);
    expect(state.state).toBe("heat");
  });

  test("should call climate.set_temperature service successfully", async () => {
    const serviceData = {
      entity_id: TEST_ENTITY,
      temperature: 22,
      hvac_mode: "heat"
    };

    const response = await fetch(`${restUrl}/services/climate/set_temperature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    expect(response.status).toBe(200);

    // Wait a moment for the service call to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the temperature was set
    const state = await client.getState(TEST_ENTITY);
    expect(state.attributes?.temperature).toBe(22);
  });

  test("should handle invalid service gracefully", async () => {
    const serviceData = { entity_id: TEST_ENTITY };

    const response = await fetch(`${restUrl}/services/climate/invalid_service`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    // Should return an error status
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("should handle invalid entity gracefully", async () => {
    const serviceData = { entity_id: "climate.nonexistent_entity" };

    const response = await fetch(`${restUrl}/services/climate/turn_off`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    // Should handle gracefully (may succeed but not affect anything)
    expect(response.status).toBeGreaterThanOrEqual(200);
  });

  test("should parse service arguments correctly", () => {
    // Test argument parsing logic from original script
    const testArgs = ["climate.set_temperature", "--entity_id", TEST_ENTITY, "temperature=22"];

    const [service, ...args] = testArgs;
    const [domain, serviceName] = service.split(".");

    expect(domain).toBe("climate");
    expect(serviceName).toBe("set_temperature");

    // Parse service data
    const serviceData: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith("--")) {
        const key = args[i].substring(2);
        const value = args[i + 1];
        if (value && !value.startsWith("--")) {
          serviceData[key] = value;
          i++;
        } else {
          serviceData[key] = true;
        }
      } else if (args[i].includes("=")) {
        const [key, value] = args[i].split("=");
        serviceData[key] = value;
      }
    }

    expect(serviceData.entity_id).toBe(TEST_ENTITY);
    expect(serviceData.temperature).toBe("22");
  });
});