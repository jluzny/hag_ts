/**
 * E2E Test: Check Climate Entity Details
 *
 * Tests climate entity detailed information retrieval including preset modes and capabilities
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { parse } from "yaml";

const TEST_CONFIG = "config/hvac_config_test.yaml";
const TEST_ENTITY = "climate.living_room_ac";

describe("Check Climate Details E2E Tests", () => {
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

  test("should get climate entity details successfully", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const state = await response.json();
    expect(state).toBeDefined();
    expect(state.entity_id).toBe(TEST_ENTITY);
    expect(state.state).toBeDefined();
    expect(state.attributes).toBeDefined();
  });

  test("should display basic climate entity information", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test basic information extraction
    expect(state.state).toBeDefined();
    expect(typeof state.state).toBe("string");

    expect(state.attributes).toBeDefined();
    expect(typeof state.attributes).toBe("object");
  });

  test("should extract preset modes correctly", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test preset modes extraction
    if (state.attributes?.preset_modes) {
      expect(Array.isArray(state.attributes.preset_modes)).toBe(true);

      // Should contain preset modes
      expect(state.attributes.preset_modes.length).toBeGreaterThan(0);

      // All preset modes should be strings
      state.attributes.preset_modes.forEach((mode: string) => {
        expect(typeof mode).toBe("string");
      });
    }
  });

  test("should extract HVAC modes correctly", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test HVAC modes extraction
    if (state.attributes?.hvac_modes) {
      expect(Array.isArray(state.attributes.hvac_modes)).toBe(true);

      // Should contain HVAC modes
      expect(state.attributes.hvac_modes.length).toBeGreaterThan(0);

      // All HVAC modes should be strings
      state.attributes.hvac_modes.forEach((mode: string) => {
        expect(typeof mode).toBe("string");
      });

      // Should contain common modes
      expect(state.attributes.hvac_modes).toContain("off");
      expect(state.attributes.hvac_modes).toContain("heat");
      expect(state.attributes.hvac_modes).toContain("cool");
    }
  });

  test("should extract fan modes correctly", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test fan modes extraction
    if (state.attributes?.fan_modes) {
      expect(Array.isArray(state.attributes.fan_modes)).toBe(true);

      // Should contain fan modes
      expect(state.attributes.fan_modes.length).toBeGreaterThan(0);

      // All fan modes should be strings
      state.attributes.fan_modes.forEach((mode: string) => {
        expect(typeof mode).toBe("string");
      });
    }
  });

  test("should extract preset and mode related attributes", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test extraction of preset/mode related attributes
    const modeRelatedAttributes: Record<string, any> = {};

    if (state.attributes) {
      for (const [key, value] of Object.entries(state.attributes)) {
        if (
          key === "preset_modes" ||
          key === "hvac_modes" ||
          key === "fan_modes"
        ) {
          modeRelatedAttributes[key] = value;
        } else if (key.includes("preset") || key.includes("mode")) {
          modeRelatedAttributes[key] = value;
        }
      }
    }

    // Should find some mode-related attributes
    expect(Object.keys(modeRelatedAttributes).length).toBeGreaterThan(0);

    // Verify structure of mode-related attributes
    for (const [key, value] of Object.entries(modeRelatedAttributes)) {
      expect(key).toBeDefined();
      expect(value).toBeDefined();
    }
  });

  test("should handle missing preset modes gracefully", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test handling of missing preset modes
    if (!state.attributes?.preset_modes) {
      // Should handle gracefully (not crash)
      expect(state.attributes?.preset_modes).toBeUndefined();
    }

    // The display logic should handle this case
    const presetModes = state.attributes?.preset_modes || [];
    expect(Array.isArray(presetModes)).toBe(true);
  });

  test("should handle invalid climate entity gracefully", async () => {
    const invalidEntity = "climate.nonexistent_entity";

    const response = await fetch(`${restUrl}/states/${invalidEntity}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    // Should handle invalid entity gracefully
    expect(response.status).toBeGreaterThanOrEqual(400);

    if (!response.ok) {
      // Should handle error without crashing
      const errorText = await response.text();
      expect(errorText).toBeDefined();
    }
  });

  test("should display climate information in expected format", async () => {
    const response = await fetch(`${restUrl}/states/${TEST_ENTITY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const state = await response.json();

    // Test the information display format from original script
    const entityInfo = {
      state: state.state,
      preset_modes: state.attributes?.preset_modes || [],
      hvac_modes: state.attributes?.hvac_modes || [],
      fan_modes: state.attributes?.fan_modes || [],
      preset_mode: state.attributes?.preset_mode,
      hvac_mode: state.attributes?.hvac_mode,
    };

    expect(entityInfo).toBeDefined();
    expect(entityInfo.state).toBeDefined();
    expect(Array.isArray(entityInfo.preset_modes)).toBe(true);
    expect(Array.isArray(entityInfo.hvac_modes)).toBe(true);
    expect(Array.isArray(entityInfo.fan_modes)).toBe(true);
  });

  test("should work with multiple climate entities", async () => {
    // Test with a list of entities like the original script
    const entities = [TEST_ENTITY];

    for (const entity of entities) {
      const response = await fetch(`${restUrl}/states/${entity}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      expect(response.ok).toBe(true);
      const state = await response.json();
      expect(state.entity_id).toBe(entity);
    }
  });
});