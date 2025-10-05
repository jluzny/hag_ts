/**
 * E2E Test: Discover Temperature Sensors
 *
 * Tests temperature sensor discovery functionality to find available sensors
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { ConfigLoader } from "../../src/config/loader.ts";

const TEST_CONFIG = "config/hvac_config_test.yaml";

describe("Discover Sensors E2E Tests", () => {
  let container: ReturnType<typeof createContainer> extends Promise<infer T>
    ? T
    : never;
  let client: HomeAssistantClient;
  let config: any;
  let restUrl: string;
  let token: string;

  beforeAll(async () => {
    // Setup test container and dependencies
    container = await createContainer(TEST_CONFIG);
    client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

    // Load config for REST API details
    config = await ConfigLoader.loadSettings(TEST_CONFIG);
    restUrl = config.hassOptions.restUrl;
    token = config.hassOptions.token;

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

  test("should connect to Home Assistant API", () => {
    expect(restUrl).toBeDefined();
    expect(token).toBeDefined();
    expect(restUrl).toMatch(/^https?:\/\/.*/);
  });

  test("should retrieve all states from Home Assistant", async () => {
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

  test("should identify temperature sensors correctly", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Filter for temperature sensors using the same logic as the original script
    const tempSensors = states.filter(
      (state: any) =>
        state.entity_id.includes("temperature") ||
        state.attributes.unit_of_measurement === "°C" ||
        state.attributes.unit_of_measurement === "°F" ||
        state.attributes.device_class === "temperature",
    );

    expect(Array.isArray(tempSensors)).toBe(true);
    expect(tempSensors.length).toBeGreaterThan(0);

    // Verify that identified sensors have temperature-related properties
    tempSensors.forEach((sensor: any) => {
      expect(sensor.entity_id).toBeDefined();
      expect(sensor.state).toBeDefined();
      expect(sensor.attributes).toBeDefined();
      expect(sensor.attributes.friendly_name).toBeDefined();
    });
  });

  test("should categorize indoor and outdoor sensor candidates", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Filter for temperature sensors
    const tempSensors = states.filter(
      (state: any) =>
        state.entity_id.includes("temperature") ||
        state.attributes.unit_of_measurement === "°C" ||
        state.attributes.unit_of_measurement === "°F" ||
        state.attributes.device_class === "temperature",
    );

    // Categorize indoor candidates
    const indoorCandidates = tempSensors.filter(
      (s: any) =>
        s.entity_id.includes("indoor") ||
        s.entity_id.includes("inside") ||
        s.entity_id.includes("room") ||
        s.entity_id.includes("hall") ||
        s.entity_id.includes("living") ||
        s.entity_id.includes("bedroom") ||
        s.entity_id.includes("thermostat") ||
        s.entity_id.includes("floor"),
    );

    // Categorize outdoor candidates
    const outdoorCandidates = tempSensors.filter(
      (s: any) =>
        s.entity_id.includes("outdoor") ||
        s.entity_id.includes("outside") ||
        s.entity_id.includes("weather") ||
        s.entity_id.includes("external") ||
        s.entity_id.includes("openweather"),
    );

    expect(Array.isArray(indoorCandidates)).toBe(true);
    expect(Array.isArray(outdoorCandidates)).toBe(true);

    // Should find at least some candidates
    expect(indoorCandidates.length + outdoorCandidates.length).toBeGreaterThan(0);
  });

  test("should generate configuration suggestions", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Filter for temperature sensors
    const tempSensors = states.filter(
      (state: any) =>
        state.entity_id.includes("temperature") ||
        state.attributes.unit_of_measurement === "°C" ||
        state.attributes.unit_of_measurement === "°F" ||
        state.attributes.device_class === "temperature",
    );

    // Categorize candidates
    const indoorCandidates = tempSensors.filter(
      (s: any) =>
        s.entity_id.includes("indoor") ||
        s.entity_id.includes("inside") ||
        s.entity_id.includes("room") ||
        s.entity_id.includes("hall") ||
        s.entity_id.includes("living") ||
        s.entity_id.includes("bedroom") ||
        s.entity_id.includes("thermostat") ||
        s.entity_id.includes("floor"),
    );

    const outdoorCandidates = tempSensors.filter(
      (s: any) =>
        s.entity_id.includes("outdoor") ||
        s.entity_id.includes("outside") ||
        s.entity_id.includes("weather") ||
        s.entity_id.includes("external") ||
        s.entity_id.includes("openweather"),
    );

    // Generate configuration suggestions like the original script
    const suggestions: { tempSensor?: string; outdoorSensor?: string } = {};

    if (indoorCandidates.length > 0) {
      suggestions.tempSensor = indoorCandidates[0].entity_id;
    }

    if (outdoorCandidates.length > 0) {
      suggestions.outdoorSensor = outdoorCandidates[0].entity_id;
    }

    // Should have at least one suggestion
    expect(suggestions.tempSensor || suggestions.outdoorSensor).toBeDefined();
  });

  test("should display sensor information in tabular format", async () => {
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);
    const states = await response.json();

    // Filter for temperature sensors
    const tempSensors = states.filter(
      (state: any) =>
        state.entity_id.includes("temperature") ||
        state.attributes.unit_of_measurement === "°C" ||
        state.attributes.unit_of_measurement === "°F" ||
        state.attributes.device_class === "temperature",
    );

    // Test that we can extract tabular data
    const tableData = tempSensors.slice(0, 5).map((sensor: any) => ({
      entityId: sensor.entity_id,
      friendlyName: sensor.attributes.friendly_name || sensor.entity_id,
      value: sensor.state,
      unit: sensor.attributes.unit_of_measurement || "N/A",
    }));

    expect(tableData.length).toBeGreaterThan(0);

    // Verify table structure
    tableData.forEach((row: any) => {
      expect(row).toHaveProperty("entityId");
      expect(row).toHaveProperty("friendlyName");
      expect(row).toHaveProperty("value");
      expect(row).toHaveProperty("unit");
    });
  });

  test("should handle API errors gracefully", async () => {
    // Test with invalid endpoint
    const response = await fetch(`${restUrl}/invalid_endpoint`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});