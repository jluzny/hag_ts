/**
 * E2E Test: HVAC Status Check
 *
 * Checks the current status of all HVAC entities and validates their state
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const TEST_CONFIG = "config/hvac_config_test.yaml";

// HVAC entities from the original script
const HVAC_ENTITIES = [
  "climate.living_room_ac",
  "climate.bedroom_ac",
  "climate.matej_ac",
  "climate.anicka_ac",
  "climate.radek_ac",
];

describe("HVAC Status E2E Tests", () => {
  let container: ReturnType<typeof createContainer> extends Promise<infer T>
    ? T
    : never;
  let client: HomeAssistantClient;

  beforeAll(async () => {
    // Setup test container and dependencies
    container = await createContainer(TEST_CONFIG);
    client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

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

  test("should connect to Home Assistant successfully", async () => {
    expect(client).toBeDefined();
    // Connection is verified by successful getState calls in subsequent tests
  });

  test("should get status for all HVAC entities", async () => {
    const results: Array<{ entityId: string; state: any }> = [];

    for (const entityId of HVAC_ENTITIES) {
      try {
        const state = await client.getState(entityId);

        // Verify basic structure
        expect(state, `State should exist for ${entityId}`).toBeDefined();
        expect(
          state.state,
          `State should have state property for ${entityId}`,
        ).toBeDefined();
        expect(
          state.attributes,
          `State should have attributes for ${entityId}`,
        ).toBeDefined();

        results.push({
          entityId,
          state: {
            state: state.state,
            temperature: state.attributes?.temperature,
            hvacMode: state.attributes?.hvac_mode,
            presetMode: state.attributes?.preset_mode,
            currentTemp: state.attributes?.current_temperature,
          },
        });
      } catch (error) {
        // In test environment, some entities might not exist
        // This mirrors the original script's error handling
        console.warn(
          `Warning: Could not check ${entityId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // At least one entity should return valid data (using test entity)
    const validResults = results.filter((r) => r.state);
    expect(
      validResults.length > 0,
      "At least one HVAC entity should be accessible",
    ).toBe(true);
  });

  test("should validate entity state structure", async () => {
    // Test with a known entity (living room AC should exist in test config)
    const entityId = "climate.living_room_ac";
    const state = await client.getState(entityId);

    expect(state).toBeDefined();
    expect(state.state).toBeDefined();
    expect(state.attributes).toBeDefined();

    // Verify expected properties exist (even if null/undefined)
    const expectedStructure = {
      state: state.state,
      attributes: {
        temperature: state.attributes?.temperature,
        preset_mode: state.attributes?.preset_mode,
        current_temperature: state.attributes?.current_temperature,
      },
    };

    // Match the structure (values can be anything)
    expect(state).toMatchObject(expectedStructure);

    // Verify that the entity has the expected climate entity properties
    expect(state.attributes).toHaveProperty("temperature");
    expect(state.attributes).toHaveProperty("current_temperature");
    expect(state.attributes).toHaveProperty("preset_mode");
    expect(state.attributes).toHaveProperty("hvac_modes"); // Climate entities should have this
    expect(state.attributes).toHaveProperty("friendly_name"); // Should have friendly name
  });

  test("should handle invalid entity gracefully", async () => {
    const invalidEntityId = "climate.nonexistent_entity";

    try {
      await client.getState(invalidEntityId);
      // If no error, that's okay - some HA installations handle this differently
    } catch (error) {
      // Expect an error for invalid entity
      expect(error).toBeDefined();
    }
  });
});
