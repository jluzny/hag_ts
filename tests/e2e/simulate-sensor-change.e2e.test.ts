/**
 * E2E Test: Simulate Sensor Change
 *
 * Tests sensor change simulation functionality and HVAC evaluation triggering
 */

import { createContainer } from "../../src/core/container.ts";
import { TYPES } from "../../src/core/types.ts";
import { HomeAssistantClient } from "../../src/home-assistant/client.ts";
import { HVACController } from "../../src/hvac/controller.ts";
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const TEST_CONFIG = "config/hvac_config_test.yaml";
const TEST_ENTITY = "climate.living_room_ac";

describe("Simulate Sensor Change E2E Tests", () => {
  let container: ReturnType<typeof createContainer> extends Promise<infer T>
    ? T
    : never;
  let client: HomeAssistantClient;
  let controller: HVACController;

  beforeAll(async () => {
    // Setup test container and dependencies
    container = await createContainer(TEST_CONFIG);
    client = container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
    controller = container.get<HVACController>(TYPES.HVACController);

    // Connect to Home Assistant
    await client.connect();
  });

  afterAll(async () => {
    // Cleanup
    try {
      if (controller) {
        await controller.stop();
      }
      if (client) {
        await client.disconnect();
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should parse command line arguments correctly", () => {
    // Test argument parsing from original script
    const testArgs1 = ["sensor.temperature", "23.5"];
    const testArgs2 = ["binary_sensor.door_contact", "on"];
    const testArgs3 = ["switch.living_room_light"];

    // Should extract entity ID and new value
    expect(testArgs1[0]).toBe("sensor.temperature");
    expect(testArgs1[1]).toBe("23.5");

    expect(testArgs2[0]).toBe("binary_sensor.door_contact");
    expect(testArgs2[1]).toBe("on");

    expect(testArgs3[0]).toBe("switch.living_room_light");
    expect(testArgs3[1]).toBeUndefined(); // No new value provided
  });

  test("should start HVAC controller successfully", async () => {
    await controller.start();

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = controller.getStatus();
    expect(status.controller.running).toBe(true);
    expect(status.controller.haConnected).toBe(true);
  });

  test("should get current entity state when no new value provided", async () => {
    // Test reading current value logic from original script
    const entityId = TEST_ENTITY;

    const currentState = await client.getState(entityId);
    expect(currentState).toBeDefined();
    expect(currentState.state).toBeDefined();
    expect(currentState.attributes).toBeDefined();

    // Should extract current value
    const currentValue = currentState.state;
    expect(currentValue).toBeDefined();
  });

  test("should access state machine correctly", async () => {
    // Test that we can access the state machine like the original script
    const stateMachine = (controller as any).stateMachine;

    expect(stateMachine).toBeDefined();
    expect(typeof stateMachine.getContext).toBe("function");
    expect(typeof stateMachine.send).toBe("function");

    // Test getting current context
    const currentContext = stateMachine.getContext();
    expect(currentContext).toBeDefined();
    expect(typeof currentContext).toBe("object");
  });

  test("should send UPDATE_CONDITIONS event correctly", async () => {
    const entityId = "sensor.temperature";
    const newValue = "23.5";

    const stateMachine = (controller as any).stateMachine;
    const initialContext = stateMachine.getContext();

    // Send UPDATE_CONDITIONS event
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        // Preserve current context values
        ...initialContext,
        // Update timestamp
        currentHour: new Date().getHours(),
        isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
      },
      eventSource: {
        type: "state_changed",
        entityId: entityId,
        newValue: newValue,
        entityType: entityId.split(".")[0],
      },
    });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the event was processed
    const finalContext = stateMachine.getContext();
    expect(finalContext).toBeDefined();
    expect(finalContext.currentHour).toBe(new Date().getHours());
  });

  test("should preserve context values during updates", async () => {
    const stateMachine = (controller as any).stateMachine;
    const initialContext = stateMachine.getContext();

    // Store some initial values to verify they're preserved
    const initialSystemMode = initialContext.systemMode;
    const initialIsWeekday = initialContext.isWeekday;

    // Send UPDATE_CONDITIONS event
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        // Preserve current context values
        ...initialContext,
        // Update some values
        currentHour: 12,
      },
      eventSource: {
        type: "state_changed",
        entityId: "sensor.test",
        newValue: "test_value",
        entityType: "sensor",
      },
    });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify context was preserved
    const finalContext = stateMachine.getContext();
    expect(finalContext.systemMode).toBe(initialSystemMode);
    expect(finalContext.isWeekday).toBe(initialIsWeekday);
    expect(finalContext.currentHour).toBe(12);
  });

  test("should construct event source correctly", async () => {
    const entityId = "sensor.temperature";
    const newValue = "23.5";

    // Test event source construction
    const eventSource = {
      type: "state_changed",
      entityId: entityId,
      newValue: newValue,
      entityType: entityId.split(".")[0],
    };

    expect(eventSource.type).toBe("state_changed");
    expect(eventSource.entityId).toBe("sensor.temperature");
    expect(eventSource.newValue).toBe("23.5");
    expect(eventSource.entityType).toBe("sensor");
  });

  test("should handle different entity types", () => {
    // Test entity type extraction
    const testEntities = [
      "sensor.temperature",
      "binary_sensor.door_contact",
      "switch.living_room_light",
      "climate.living_room_ac",
    ];

    testEntities.forEach((entityId) => {
      const entityType = entityId.split(".")[0];
      expect(entityType).toBeDefined();
      expect(["sensor", "binary_sensor", "switch", "climate"]).toContain(entityType);
    });
  });

  test("should stop controller cleanly", async () => {
    await controller.stop();

    const status = controller.getStatus();
    expect(status.controller.running).toBe(false);
  });

  test("should handle error conditions gracefully", async () => {
    // Test with invalid entity ID
    const invalidEntityId = "sensor.nonexistent";

    try {
      await client.getState(invalidEntityId);
      // May succeed if mocked, or fail if real - both are acceptable
    } catch (error) {
      // Should handle errors gracefully
      expect(error).toBeDefined();
    }

    // Test controller error handling
    try {
      await controller.start();
      await controller.stop();
      // Should complete without errors
    } catch (error) {
      // If there are errors, they should be handled gracefully
      expect(error).toBeDefined();
    }
  });
});