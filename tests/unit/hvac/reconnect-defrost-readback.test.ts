/**
 * Review round 1 F3/F4 (integration review t_6269b36c): the post-reconnect
 * read-back must be truthful when the machine commands nothing (an active
 * defrost cycle after the cutoff — D3 — or an active manual override outside
 * active hours, which the approved policy lets win). The reconcile record may
 * only claim units the machine actually commanded off.
 *
 * Fully offline: a fake Home Assistant client stands in for the network; the
 * HVAC command path is driven through the real controller + state machine.
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { HVACController } from "../../../src/hvac/controller.ts";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { type SensorHealthMonitor } from "../../../src/hvac/sensor-health.ts";
import {
  type ApplicationOptions,
} from "../../../src/config/config.ts";
import { HVACMode } from "../../../src/types/common.ts";
import { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { HassServiceCallImpl, HassStateImpl } from "../../../src/home-assistant/models.ts";
import { EventBus } from "../../../src/core/event-system.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import {
  BEDROOM,
  BASE_DATE,
  DISABLED,
  FakeClock,
  LIVING_ROOM,
  RecordingNotifier,
  makeOptions,
  makeSensorHealth,
  waitUntil,
} from "./harness.ts";

/** Minimal offline Home Assistant client: no socket is ever opened. */
class FakeClient extends HomeAssistantClient {
  private _connected = false;
  readonly states = new Map<string, string>();
  readonly reads: string[] = [];
  readonly commands: { entityId: string; service: string; value?: unknown }[] = [];
  private handlers = new Set<(connected: boolean) => void>();

  constructor() {
    super();
    this.states.set("sensor.1st_floor_hall_multisensor_temperature", "18.0");
    this.states.set("sensor.openweathermap_temperature", "7.0");
    this.states.set(LIVING_ROOM, "heat");
    this.states.set(BEDROOM, "heat");
    this.states.set(DISABLED, "off");
  }

  override async connect(): Promise<void> {
    this._connected = true;
  }

  override async disconnect(): Promise<void> {
    this._connected = false;
  }

  override get connected(): boolean {
    return this._connected;
  }

  override onStateChanged(): void {}

  override onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.handlers.add(handler);
  }

  override removeConnectionStateChangeHandler(
    handler: (connected: boolean) => void,
  ): void {
    this.handlers.delete(handler);
  }

  override async getState(entityId: string): Promise<HassStateImpl> {
    const state = this.states.get(entityId);
    if (state === undefined) throw new Error(`Entity ${entityId} not found`);
    const now = new Date();
    return new HassStateImpl(entityId, state, {}, now, now, now);
  }

  override async controlEntity(
    entityId: string,
    domain: string,
    service: string,
    _valueType: { type: string; key: string },
    value: unknown,
  ): Promise<void> {
    const serviceName = `${domain}.${service}`;
    this.commands.push({ entityId, service: serviceName, value });
    if (service === "set_hvac_mode") this.states.set(entityId, String(value));
  }

  override async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    const entityId = String(serviceCall.serviceData?.entity_id ?? "unknown");
    const service = `${serviceCall.domain}.${serviceCall.service}`;
    this.commands.push({ entityId, service });
    if (service === "climate.turn_off") this.states.set(entityId, "off");
  }

  /** Simulate the client's connection state machine reporting a transition. */
  emitConnection(connected: boolean): void {
    this._connected = connected;
    for (const handler of [...this.handlers]) handler(connected);
  }

  commandsFor(entityId: string, service?: string): typeof this.commands {
    return this.commands.filter(
      (command) =>
        command.entityId === entityId &&
        (service === undefined || command.service === service),
    );
  }
}

const appOptions = {
  logLevel: "info",
  useAi: false,
  aiModel: "test",
  aiTemperature: 0,
  openaiApiKey: "test-key-not-used",
} as unknown as ApplicationOptions;

interface Fixture {
  client: FakeClient;
  controller: HVACController;
  machine: HVACStateMachine;
  monitor: SensorHealthMonitor;
  notifier: RecordingNotifier;
}

const fixtures: Fixture[] = [];

const start = async (
  prepare?: (client: FakeClient) => void,
  wallClock: Date = BASE_DATE,
): Promise<Fixture> => {
  setSystemTime(wallClock);
  const hvacOptions = makeOptions();
  const client = new FakeClient();
  prepare?.(client);
  const notifier = new RecordingNotifier();
  const monitor = makeSensorHealth(hvacOptions, {
    clock: new FakeClock(),
    notifier,
  });
  const machine = new HVACStateMachine(hvacOptions, client, monitor);
  const controller = new HVACController(
    hvacOptions,
    appOptions,
    client as unknown as HomeAssistantClient,
    machine,
    new EventBus(new LoggerService("test.events")),
    monitor,
  );

  await controller.start();
  await machine.awaitPendingCommands();
  client.commands.length = 0;

  const fixture = { client, controller, machine, monitor, notifier };
  fixtures.push(fixture);
  return fixture;
};

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    await fixture.controller.stop();
  }
  setSystemTime();
});

// ---------------------------------------------------------------------------
// D3 at controller level: reconnect during a defrost cycle past the cutoff.
// ---------------------------------------------------------------------------

describe("Reconnect read-back during a defrost cycle (F3/D3 + F4)", () => {
  test("reconnect after the cutoff aborts the cycle; the record claims only the issued offs", async () => {
    // Startup inside active hours with the hall at 20.5 and the outdoor at
    // -3 °C: the custom defrost cycle starts and stays active.
    const { client, machine, controller } = await start((fake) => {
      fake.states.set("sensor.1st_floor_hall_multisensor_temperature", "20.5");
      fake.states.set("sensor.openweathermap_temperature", "-3.0");
    });
    expect(machine.getCurrentState()).toBe("defrosting");
    client.commands.length = 0;

    // HA goes away and comes back after the 23:00 cutoff.
    setSystemTime(new Date(2026, 0, 15, 23, 30, 0));
    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(
      () => controller.getStatus().lastReconcile !== undefined,
    );
    await machine.awaitPendingCommands();

    // The cycle is stopped at the reconnect, not left to its duration timer.
    expect(machine.getCurrentState()).toBe("idle");
    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off").length).toBe(1);
    expect(client.commandsFor(BEDROOM, "climate.turn_off").length).toBe(1);
    expect(client.commandsFor(DISABLED, "climate.turn_off")).toEqual([]);

    // The read-back record claims exactly what was commanded — the same units
    // that were actually switched off — and none of them still runs cool.
    const reconcile = controller.getStatus().lastReconcile!;
    expect([...reconcile.commandedOff].sort()).toEqual(
      [BEDROOM, LIVING_ROOM].sort(),
    );
    expect(reconcile.stillNotOff).toEqual([]);
    expect(reconcile.unreadable).toEqual([]);
  });

  test("an active manual override outside active hours commands nothing and claims nothing", async () => {
    // Startup outside active hours ends idle; the manual override activates
    // the approved manual path (it wins outside the schedule window).
    const { client, machine, controller } = await start(
      undefined,
      new Date(2026, 0, 15, 23, 30, 0),
    );
    expect(machine.getCurrentState()).toBe("idle");
    machine.manualOverride(HVACMode.HEAT, 22.0);
    await machine.awaitPendingCommands();
    client.commands.length = 0;
    expect(machine.getCurrentState()).toBe("heating");

    // Reconnect after the cutoff: the machine keeps the manual override and
    // never issues an off command, so the reconcile record must not claim any.
    setSystemTime(new Date(2026, 0, 15, 23, 40, 0));
    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(
      () => controller.getStatus().lastReconcile !== undefined,
    );
    await machine.awaitPendingCommands();

    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off")).toEqual([]);
    expect(client.commandsFor(BEDROOM, "climate.turn_off")).toEqual([]);

    const reconcile = controller.getStatus().lastReconcile!;
    expect(reconcile.commandedOff).toEqual([]);
    expect(reconcile.stillNotOff).toEqual([]);
  });

  test("the ordinary cutoff reconcile still commands and reads back every managed unit", async () => {
    // Regression guard for the F4 fix: without defrost or manual override the
    // reconcile behavior is unchanged.
    const { client, machine, controller } = await start(
      undefined,
      new Date(2026, 0, 15, 23, 30, 0),
    );
    client.commands.length = 0;

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(
      () => controller.getStatus().lastReconcile !== undefined,
    );

    expect(machine.getCurrentState()).toBe("idle");
    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off").length).toBe(1);
    expect(client.commandsFor(BEDROOM, "climate.turn_off").length).toBe(1);

    const reconcile = controller.getStatus().lastReconcile!;
    expect([...reconcile.commandedOff].sort()).toEqual(
      [BEDROOM, LIVING_ROOM].sort(),
    );
    expect(reconcile.stillNotOff).toEqual([]);
  });
});
