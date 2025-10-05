/**
 * E2E Test: List Home Assistant Entities
 *
 * Tests entity listing functionality to discover available sensors and devices
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { parse } from "yaml";

const TEST_CONFIG = "config/hvac_config_test.yaml";

describe("List Entities E2E Tests", () => {
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

  test("should fetch all entities from Home Assistant", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const states = await response.json();
    expect(Array.isArray(states)).toBe(true);
    expect(states.length).toBeGreaterThan(0);
  });

  test("should filter entities by prefix correctly", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Test filtering for sensor entities
    const sensorEntities = states.filter(
      (state: { entity_id: string }) => state.entity_id.startsWith("sensor")
    );

    expect(Array.isArray(sensorEntities)).toBe(true);

    // Test filtering for climate entities
    const climateEntities = states.filter(
      (state: { entity_id: string }) => state.entity_id.startsWith("climate")
    );

    expect(Array.isArray(climateEntities)).toBe(true);

    // Should find at least one climate entity (living_room_ac)
    const foundLivingRoom = climateEntities.some(
      (state: { entity_id: string }) => state.entity_id === "climate.living_room_ac"
    );
    expect(foundLivingRoom).toBe(true);
  });

  test("should filter temperature-related entities", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Filter for temperature-related entities
    const tempRelatedEntities = states.filter(
      (state: { entity_id: string }) =>
        state.entity_id.includes("temperature") ||
        state.entity_id.includes("temp") ||
        state.entity_id.startsWith("climate")
    );

    expect(Array.isArray(tempRelatedEntities)).toBe(true);

    // Should find some temperature-related entities
    expect(tempRelatedEntities.length).toBeGreaterThan(0);
  });

  test("should display entity information correctly", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Test that entities have the expected structure
    const sampleEntity = states[0];
    expect(sampleEntity).toHaveProperty("entity_id");
    expect(sampleEntity).toHaveProperty("state");
    expect(sampleEntity).toHaveProperty("attributes");
    expect(sampleEntity.attributes).toHaveProperty("friendly_name");

    // Test that we can extract unit information
    const entitiesWithUnits = states.filter(
      (state: { attributes: any }) =>
        state.attributes?.unit_of_measurement !== undefined
    );

    expect(entitiesWithUnits.length).toBeGreaterThan(0);
  });

  test("should limit results as expected", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Test limiting to first 5 results like the original script
    const limitedResults = states.slice(0, 5);
    expect(limitedResults.length).toBeLessThanOrEqual(5);

    // If there are more than 5 entities, should know there are more
    if (states.length > 5) {
      const remaining = states.length - 5;
      expect(remaining).toBeGreaterThan(0);
    }
  });

  test("should handle different entity types", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Test different entity prefixes
    const prefixes = ["sensor", "climate", "weather", "sun"];
    const foundPrefixes = new Set();

    for (const prefix of prefixes) {
      const entities = states.filter(
        (state: { entity_id: string }) => state.entity_id.startsWith(prefix)
      );
      if (entities.length > 0) {
        foundPrefixes.add(prefix);
      }
    }

    // Should find at least some entities from these prefixes
    expect(foundPrefixes.size).toBeGreaterThan(0);

    // Verify climate entities exist
    const climateEntities = states.filter(
      (state: { entity_id: string }) => state.entity_id.startsWith("climate")
    );
    expect(climateEntities.length).toBeGreaterThan(0);
  });
});