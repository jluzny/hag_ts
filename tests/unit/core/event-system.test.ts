/**
 * Event System Unit Tests
 *
 * Tests for the event-driven pub/sub system used in the Rust HAG pattern.
 */

import { expect, test, describe } from "bun:test";
import { EventBus } from "../../../src/core/event-system.ts";
import { HassEventImpl } from "../../../src/home-assistant/models.ts";

describe("Event System - EventBus", () => {
  test("should create event bus instance", () => {
    const eventBus = new EventBus();
    expect(eventBus).toBeDefined();
  });

  test("should subscribe and publish events", async () => {
    const eventBus = new EventBus();
    let receivedEvent: HassEventImpl | null = null;

    // Subscribe to events
    eventBus.subscribe("state_changed", (event: HassEventImpl) => {
      receivedEvent = event;
    });

    // Create a test event
    const testEvent = new HassEventImpl(
      "state_changed",
      {
        entity_id: "sensor.test_temp",
        new_state: { entity_id: "sensor.test_temp", state: "21.5" },
        old_state: { entity_id: "sensor.test_temp", state: "21.0" },
      },
      "test",
      new Date(),
    );

    // Publish event
    eventBus.publish(testEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify event was received
    expect(receivedEvent).toBeDefined();
    const event: HassEventImpl = receivedEvent!;
    expect(event.eventType).toBe("state_changed");
    expect(event.origin).toBe("test");
  });

  test("should handle multiple subscribers", async () => {
    const eventBus = new EventBus();
    const receivedEvents: HassEventImpl[] = [];

    // Subscribe multiple handlers
    eventBus.subscribe("state_changed", (event: HassEventImpl) => {
      receivedEvents.push(event);
    });

    eventBus.subscribe("state_changed", (event) => {
      receivedEvents.push(event);
    });

    // Create and publish test event
    const testEvent = new HassEventImpl(
      "state_changed",
      { entity_id: "sensor.test" },
      "test",
      new Date(),
    );

    eventBus.publish(testEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify both handlers received the event
    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[0].eventType).toBe("state_changed");
    expect(receivedEvents[1].eventType).toBe("state_changed");
  });

  test("should handle errors in event handlers gracefully", async () => {
    const eventBus = new EventBus();
    let successfulHandlerCalled = false;

    // Subscribe handler that throws error
    eventBus.subscribe("state_changed", () => {
      throw new Error("Test error");
    });

    // Subscribe handler that should still work
    eventBus.subscribe("state_changed", () => {
      successfulHandlerCalled = true;
    });

    // Create and publish test event
    const testEvent = new HassEventImpl(
      "state_changed",
      { entity_id: "sensor.test" },
      "test",
      new Date(),
    );

    eventBus.publish(testEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify successful handler was still called despite error in other handler
    expect(successfulHandlerCalled).toBe(true);
  });

  test("should clear all subscriptions", async () => {
    const eventBus = new EventBus();
    let eventReceived = false;

    // Subscribe to events
    eventBus.subscribe("state_changed", () => {
      eventReceived = true;
    });

    // Clear all subscriptions
    eventBus.clear();

    // Create and publish test event
    const testEvent = new HassEventImpl(
      "state_changed",
      { entity_id: "sensor.test" },
      "test",
      new Date(),
    );

    eventBus.publish(testEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify no event was received after clearing
    expect(eventReceived).toBe(false);
  });
});

describe("Event System - HassEventImpl Integration", () => {
  test("should work with temperature sensor events", async () => {
    const eventBus = new EventBus();
    let processedTemp: number | null = null;

    // Subscribe to temperature events
    eventBus.subscribe("state_changed", (event) => {
      if (!event.isStateChanged()) return;

      const stateChange = event.getStateChangeData();
      if (!stateChange || !stateChange.entityId.includes("temperature")) return;

      if (stateChange.newState) {
        processedTemp = parseFloat(stateChange.newState.state);
      }
    });

    // Create temperature sensor event
    const tempEvent = new HassEventImpl(
      "state_changed",
      {
        entity_id: "sensor.indoor_temperature",
        new_state: {
          entity_id: "sensor.indoor_temperature",
          state: "22.5",
          attributes: { unit_of_measurement: "°C" },
        },
        old_state: {
          entity_id: "sensor.indoor_temperature",
          state: "22.0",
          attributes: { unit_of_measurement: "°C" },
        },
      },
      "home_assistant",
      new Date(),
    );

    // Publish event
    eventBus.publish(tempEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify temperature was processed
    expect(processedTemp).not.toBeNull();
    expect(processedTemp!).toBe(22.5);
  });

  test("should support filtering by entity ID", async () => {
    const eventBus = new EventBus();
    const processedEntities: string[] = [];

    // Subscribe with entity filtering
    eventBus.subscribe("state_changed", (event) => {
      if (!event.isStateChanged()) return;

      const stateChange = event.getStateChangeData();
      if (!stateChange) return;

      // Only process specific sensors
      if (stateChange.entityId === "sensor.target_temp") {
        processedEntities.push(stateChange.entityId);
      }
    });

    // Publish events for different entities
    const targetEvent = new HassEventImpl(
      "state_changed",
      {
        entity_id: "sensor.target_temp",
        new_state: { entity_id: "sensor.target_temp", state: "21.0" },
      },
      "test",
      new Date(),
    );

    const otherEvent = new HassEventImpl(
      "state_changed",
      {
        entity_id: "sensor.other_temp",
        new_state: { entity_id: "sensor.other_temp", state: "19.0" },
      },
      "test",
      new Date(),
    );

    eventBus.publish(targetEvent);
    eventBus.publish(otherEvent);

    // Give a moment for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify only target entity was processed
    expect(processedEntities.length).toBe(1);
    expect(processedEntities[0]).toBe("sensor.target_temp");
  });
});
