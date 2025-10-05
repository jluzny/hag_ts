#!/usr/bin/env bun

/**
 * List Home Assistant Entities Script
 *
 * Lists available entities by type to discover what sensors are available
 */

import { createContainer } from "../src/core/container.ts";
import { TYPES } from "../src/core/types.ts";
import { HomeAssistantClient } from "../src/home-assistant/client.ts";

const container = await createContainer("config/hvac_config_dev.yaml");
const client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);

try {
  await client.connect();
  console.log("Connected successfully");

  // Try some common entity prefixes to see what's available
  const entityPrefixes = ["sensor", "climate", "weather", "sun"];

  for (const prefix of entityPrefixes) {
    try {
      const response = await fetch(`http://192.168.0.204:8123/api/states`, {
        headers: {
          Authorization: `Bearer ${process.env.HASS_HassOptions__Token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const states = await response.json();
        const filteredStates = states.filter(
          (state: { entity_id: string }) =>
            state.entity_id.startsWith(prefix) &&
            (state.entity_id.includes("temperature") ||
              state.entity_id.includes("temp") ||
              prefix === "climate"),
        );

        console.log(`\n${prefix.toUpperCase()} entities:`);
        filteredStates
          .slice(0, 5)
          .forEach(
            (state: {
              entity_id: string;
              state: string;
              attributes?: { unit_of_measurement?: string };
            }) => {
              console.log(
                `  ${state.entity_id}: ${state.state} ${
                  state.attributes?.unit_of_measurement || ""
                }`,
              );
            },
          );
        if (filteredStates.length > 5) {
          console.log(`  ... and ${filteredStates.length - 5} more`);
        }
      }
      break; // Only need to fetch once
    } catch (error) {
      console.log(
        `Error fetching entities: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await client.disconnect();
} catch (error) {
  console.error(
    "Failed:",
    error instanceof Error ? error.message : String(error),
  );
}
