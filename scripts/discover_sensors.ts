#!/usr/bin/env bun

/**
 * Discover available temperature sensors in Home Assistant
 */

import { ConfigLoader } from "../src/config/loader.ts";

async function discoverSensors() {
  try {
    console.log("🔍 Discovering temperature sensors in Home Assistant...\n");

    // Load config
    const config = await ConfigLoader.loadSettings(
      "config/hvac_config_test.yaml",
    );
    const { restUrl, token } = config.hassOptions;

    console.log(`📡 Connecting to: ${restUrl}`);

    // Make REST API call to get all states
    const response = await fetch(`${restUrl}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const states = await response.json();
    console.log(`✅ Retrieved ${states.length} entities\n`);

    // Filter for temperature sensors
    const tempSensors = states.filter(
      (state: any) =>
        state.entity_id.includes("temperature") ||
        state.attributes.unit_of_measurement === "°C" ||
        state.attributes.unit_of_measurement === "°F" ||
        state.attributes.device_class === "temperature",
    );

    console.log(`🌡️ Found ${tempSensors.length} temperature sensors:\n`);

    // Display sensors in a nice format
    console.log("| Entity ID | Friendly Name | Current Value | Unit |");
    console.log("|-----------|---------------|---------------|------|");

    for (const sensor of tempSensors) {
      const entityId = sensor.entity_id;
      const name = sensor.attributes.friendly_name || entityId;
      const value = sensor.state;
      const unit = sensor.attributes.unit_of_measurement || "N/A";

      console.log(`| ${entityId} | ${name} | ${value} | ${unit} |`);
    }

    // Suggest sensors for configuration
    console.log("\n🎯 Configuration Suggestions:");

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

    console.log("\nFor your hvac_config_test.yaml, consider updating:");
    console.log("\nhvacOptions:");

    if (indoorCandidates.length > 0) {
      console.log(
        `  tempSensor: "${indoorCandidates[0].entity_id}"  # ${indoorCandidates[0].attributes.friendly_name}`,
      );
      if (indoorCandidates.length > 1) {
        console.log("  # Other indoor options:");
        indoorCandidates
          .slice(1)
          .forEach((s: any) =>
            console.log(
              `  # tempSensor: "${s.entity_id}"  # ${s.attributes.friendly_name}`,
            ),
          );
      }
    }

    if (outdoorCandidates.length > 0) {
      console.log(
        `  outdoorSensor: "${outdoorCandidates[0].entity_id}"  # ${outdoorCandidates[0].attributes.friendly_name}`,
      );
      if (outdoorCandidates.length > 1) {
        console.log("  # Other outdoor options:");
        outdoorCandidates
          .slice(1)
          .forEach((s: any) =>
            console.log(
              `  # outdoorSensor: "${s.entity_id}"  # ${s.attributes.friendly_name}`,
            ),
          );
      }
    }

    if (indoorCandidates.length === 0 && outdoorCandidates.length === 0) {
      console.log(
        "⚠️ No obvious indoor/outdoor candidates found. You may need to manually select from the list above.",
      );
    }

    console.log("\n✅ Discovery complete");
  } catch (error) {
    console.error("❌ Error discovering sensors:", error);
    process.exit(1);
  }
}

// Run the discovery
discoverSensors();
