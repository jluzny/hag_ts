/**
 * Unit tests for heating rule-based unit selection.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { type HvacOptions } from "../../../src/config/config.ts";
import { HVACMode, SystemMode } from "../../../src/types/common.ts";
import { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { setupTestLogging } from "../../test-helpers.ts";

class MockHomeAssistantClient extends HomeAssistantClient {
  private serviceCalls: Array<{
    entityId: string;
    service: string;
    data?: Record<string, unknown>;
  }> = [];

  override async connect(): Promise<void> {
    return;
  }

  override async disconnect(): Promise<void> {
    return;
  }

  override get connected(): boolean {
    return true;
  }

  override async subscribeEvents(): Promise<void> {
    return;
  }

  override addEventHandler(): void {}
  override removeEventHandler(): void {}
  override onStateChanged(): void {}

  override async controlEntity(
    entityId: string,
    domain: string,
    service: string,
    valueType: { type: string; key: string },
    value: unknown,
  ): Promise<void> {
    this.serviceCalls.push({
      entityId,
      service: `${domain}.${service}`,
      data: { [valueType.key]: value },
    });
  }

  override async callService(serviceCall: {
    entity_id: string;
    domain: string;
    service: string;
    service_data?: Record<string, unknown>;
  }): Promise<void> {
    this.serviceCalls.push({
      entityId: serviceCall.entity_id,
      service: `${serviceCall.domain}.${serviceCall.service}`,
      data: serviceCall.service_data,
    });
  }

  getServiceCalls(): Array<{
    entityId: string;
    service: string;
    data?: Record<string, unknown>;
  }> {
    return this.serviceCalls;
  }

  clearServiceCalls(): void {
    this.serviceCalls = [];
  }
}

const makeOptions = (): HvacOptions => ({
  tempSensor: "sensor.indoor_temp",
  outdoorSensor: "sensor.outdoor_temp",
  systemMode: SystemMode.AUTO,
  hvacEntities: [
    {
      entityId: "climate.living_room_ac",
      enabled: true,
      defrost: true,
      temperatureCorrection: 1.0,
    },
    {
      entityId: "climate.bedroom_ac",
      enabled: false,
      defrost: false,
      temperatureCorrection: -1.0,
    },
    {
      entityId: "climate.radek_ac",
      enabled: true,
      defrost: false,
      temperatureCorrection: -1.0,
    },
  ],
  heating: {
    temperature: 21.0,
    presetMode: "comfort",
    temperatureThresholds: {
      indoorMin: 19.0,
      indoorMax: 22.0,
      outdoorMin: -10.0,
      outdoorMax: 15.0,
    },
    rules: [
      {
        conditions: {
          outdoorTemp: {
            gt: 10,
          },
        },
        actions: {
          includeUnits: [
            "climate.living_room_ac",
            "climate.bedroom_ac",
            "climate.radek_ac",
          ],
        },
      },
    ],
  },
  cooling: {
    temperature: 24.0,
    presetMode: "eco",
    temperatureThresholds: {
      indoorMin: 23.0,
      indoorMax: 26.0,
      outdoorMin: 10.0,
      outdoorMax: 45.0,
    },
  },
  activeHours: {
    start: 8,
    startWeekday: 7,
    end: 22,
  },
  evaluationCacheMs: 0,
});

const waitForAsyncActions = () => new Promise((resolve) => setTimeout(resolve, 50));

const getHeatingCalls = (calls: ReturnType<MockHomeAssistantClient["getServiceCalls"]>) =>
  calls.filter((call) => call.service.startsWith("climate."));

const getEntityCalls = (
  calls: ReturnType<MockHomeAssistantClient["getServiceCalls"]>,
  entityId: string,
) => calls.filter((call) => call.entityId === entityId);

describe("Heating rule-based unit selection", () => {
  setupTestLogging();

  let stateMachine: HVACStateMachine;
  let haClient: MockHomeAssistantClient;

  beforeEach(() => {
    haClient = new MockHomeAssistantClient();
    stateMachine = new HVACStateMachine(makeOptions(), haClient);
    haClient.clearServiceCalls();
  });

  test("weatherTemp > 10 starts only living room and radek", async () => {
    stateMachine.start();

    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        indoorTemp: 18.0,
        outdoorTemp: 11.0,
        currentHour: 10,
        isWeekday: true,
      },
    });

    await waitForAsyncActions();

    const calls = getHeatingCalls(haClient.getServiceCalls());
    const entityIds = [...new Set(calls.map((call) => call.entityId))].sort();

    expect(stateMachine.getCurrentState()).toBe("heating");
    expect(entityIds).toEqual([
      "climate.living_room_ac",
      "climate.radek_ac",
    ]);

    const livingRoomCalls = getEntityCalls(calls, "climate.living_room_ac");
    const radekCalls = getEntityCalls(calls, "climate.radek_ac");
    const bedroomCalls = getEntityCalls(calls, "climate.bedroom_ac");

    expect(livingRoomCalls.map((call) => call.service)).toEqual([
      "climate.set_hvac_mode",
      "climate.set_temperature",
      "climate.set_preset_mode",
    ]);
    expect(radekCalls.map((call) => call.service)).toEqual([
      "climate.set_hvac_mode",
      "climate.set_temperature",
      "climate.set_preset_mode",
    ]);
    expect(bedroomCalls).toEqual([]);

    expect(livingRoomCalls.find((call) => call.service === "climate.set_temperature")?.data).toEqual({
      temperature: 22,
    });
    expect(radekCalls.find((call) => call.service === "climate.set_temperature")?.data).toEqual({
      temperature: 20,
    });

    stateMachine.stop();
  });

  test("weatherTemp <= 10 falls back to all enabled units", async () => {
    stateMachine.start();

    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        indoorTemp: 18.0,
        outdoorTemp: 10.0,
        currentHour: 10,
        isWeekday: true,
      },
    });

    await waitForAsyncActions();

    const calls = getHeatingCalls(haClient.getServiceCalls());
    const entityIds = [...new Set(calls.map((call) => call.entityId))].sort();

    expect(entityIds).toEqual([
      "climate.living_room_ac",
      "climate.radek_ac",
    ]);
    expect(getEntityCalls(calls, "climate.bedroom_ac")).toEqual([]);

    stateMachine.stop();
  });

  test("missing rule match falls back to enabled entities", async () => {
    const optionsWithoutRules = makeOptions();
    optionsWithoutRules.heating.rules = [];
    stateMachine = new HVACStateMachine(optionsWithoutRules, haClient);

    stateMachine.start();

    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: {
        indoorTemp: 18.0,
        outdoorTemp: 11.0,
        currentHour: 10,
        isWeekday: true,
      },
    });

    await waitForAsyncActions();

    const calls = getHeatingCalls(haClient.getServiceCalls());
    const entityIds = [...new Set(calls.map((call) => call.entityId))].sort();

    expect(entityIds).toEqual([
      "climate.living_room_ac",
      "climate.radek_ac",
    ]);

    stateMachine.stop();
  });
});
