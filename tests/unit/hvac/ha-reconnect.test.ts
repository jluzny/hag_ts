/**
 * Issue 2 — Home Assistant connection loss and post-reconnect reconciliation.
 *
 * Approved semantics: while Home Assistant is unreachable, no command may be
 * claimed to have succeeded and the schedule cutoff cannot be guaranteed; on
 * reconnect HAG must read what the device and the sensors actually report,
 * reconcile with the current schedule, command the managed units off outside
 * active hours *and verify the effect* instead of assuming the commands landed.
 *
 * Fully offline: a fake Home Assistant client stands in for the network, and
 * the HVAC command path is driven through the real controller + state machine.
 */

import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import { HVACController } from "../../../src/hvac/controller.ts";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { type SensorHealthMonitor } from "../../../src/hvac/sensor-health.ts";
import {
  type HvacOptions,
  type ApplicationOptions,
} from "../../../src/config/config.ts";
import { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { HassServiceCallImpl, HassStateImpl } from "../../../src/home-assistant/models.ts";
import { EventBus } from "../../../src/core/event-system.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import {
  BASE_DATE,
  BEDROOM,
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
  /** Entities whose commands are silently ignored (device behaves differently). */
  readonly ignoreCommandsFor = new Set<string>();
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
    this.reads.push(entityId);
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
    this.commands.push({ entityId, service: `${domain}.${service}`, value });
    if (this.ignoreCommandsFor.has(entityId)) return;
    if (service === "set_hvac_mode") this.states.set(entityId, String(value));
  }

  override async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    const entityId = String(serviceCall.serviceData?.entity_id ?? "unknown");
    const service = `${serviceCall.domain}.${serviceCall.service}`;
    this.commands.push({ entityId, service });
    if (this.ignoreCommandsFor.has(entityId)) return;
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
  openaiApiKey: "",
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
  options: Partial<HvacOptions> = {},
  wallClock: Date = BASE_DATE,
  prepare?: (client: FakeClient) => void,
): Promise<Fixture> => {
  setSystemTime(wallClock);
  const hvacOptions = makeOptions(options);
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
  // Let the startup evaluation's command batch settle, then start the command
  // log from a clean slate: the reconnect assertions describe the reconcile.
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

describe("Issue 2 - connection loss is reported and never claimed as success", () => {
  test("a lost connection raises exactly one alert", async () => {
    const { client, notifier, controller } = await start();

    client.emitConnection(false);
    expect(notifier.messages.length).toBe(1);
    expect(notifier.messages[0]).toContain("connection lost");

    // Repeated loss notifications do not spam; the status still reports degraded.
    client.emitConnection(false);
    expect(notifier.messages.length).toBe(1);
    expect(controller.getStatus().degraded?.degraded).toBe(true);
    expect(controller.getStatus().degraded?.sources.map((s) => s.source)).toEqual([
      "ha-connection",
    ]);
  });

  test("the startup connect is not mistaken for a reconnect", async () => {
    const { client, notifier, controller } = await start();

    expect(notifier.messages).toEqual([]);
    expect(controller.getStatus().lastReconcile).toBeUndefined();
    // No unit is claimed as running: the startup path only reads sensors.
    expect(client.commands).toEqual([]);
  });

  test("startup with no usable outdoor reading alerts and starts nothing", async () => {
    // The outdoor entity is missing on the device, while the hall reading would
    // otherwise demand heating (18 °C < indoorMin 21.2 °C).
    const { client, machine, notifier, controller } = await start({}, BASE_DATE, (fake) => {
      fake.states.delete("sensor.openweathermap_temperature");
    });

    expect(machine.getCurrentState()).toBe("idle");
    expect(client.commands).toEqual([]);
    expect(notifier.messages.length).toBe(1);
    expect(notifier.messages[0]).toContain("outdoor temperature sensor fault");
    expect(notifier.messages[0]).toContain("No valid outdoor reading yet");

    const sources = controller.getStatus().degraded!.sources;
    expect(sources.map((source) => source.source)).toEqual(["outdoor"]);
    expect(sources[0].reason).toBe("no-reading");
  });
});

describe("Issue 2 - reconnect reconciles the real device state with the schedule", () => {
  test("outside active hours the managed units are commanded off and read back", async () => {
    // Wall clock outside the production active-hours window (9..23).
    const { client, machine, monitor, notifier, controller } = await start(
      {},
      new Date(2026, 0, 15, 23, 30, 0),
    );
    // The startup evaluation itself runs outside active hours; clear the log so
    // the assertions below describe the reconnect reconcile alone.
    client.commands.length = 0;

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(() => controller.getStatus().lastReconcile !== undefined);

    // Both enabled units are read from the device, then commanded off ...
    expect(client.reads).toContain(LIVING_ROOM);
    expect(client.reads).toContain(BEDROOM);
    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off").length).toBe(1);
    expect(client.commandsFor(BEDROOM, "climate.turn_off").length).toBe(1);

    // ... the disabled unit is never touched ...
    expect(client.commandsFor(DISABLED)).toEqual([]);

    // ... and the effect is verified by reading the units back, not assumed.
    const reconcile = controller.getStatus().lastReconcile!;
    expect(reconcile.commandedOff).toEqual([LIVING_ROOM, BEDROOM]);
    expect(reconcile.stillNotOff).toEqual([]);
    expect(reconcile.unreadable).toEqual([]);

    // The machine is idle and reports no active degradation any more.
    expect(machine.getCurrentState()).toBe("idle");
    expect(monitor.isDegraded("hall")).toBe(false);
    expect(notifier.messages.map((m) => m.split(" ")[1])).toEqual([
      "Home",
      "Home",
    ]);
  });

  test("a unit that does not report off is reported as still not off, not as success", async () => {
    const { client, controller } = await start(
      {},
      new Date(2026, 0, 15, 23, 30, 0),
    );
    // The device ignores the off command while actually reporting `heat`: the
    // read-back must catch that instead of claiming success.
    client.ignoreCommandsFor.add(BEDROOM);
    client.states.set(BEDROOM, "heat");
    client.commands.length = 0;

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(() => controller.getStatus().lastReconcile !== undefined);

    const reconcile = controller.getStatus().lastReconcile!;
    expect(reconcile.stillNotOff).toEqual([BEDROOM]);
    expect(reconcile.commandedOff).toEqual([LIVING_ROOM, BEDROOM]);
  });

  test("a unit that cannot be read is reported as unreadable", async () => {
    const { client, controller } = await start(
      {},
      new Date(2026, 0, 15, 23, 30, 0),
    );
    client.states.delete(BEDROOM); // entity unavailable on the device

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(
      () => (controller.getStatus().lastReconcile?.unreadable.length ?? 0) > 0,
    );

    const reconcile = controller.getStatus().lastReconcile!;
    expect(reconcile.unreadable).toEqual([BEDROOM]);
    expect(reconcile.stillNotOff).toEqual([]);
  });

  test("inside active hours the schedule and normal rules decide, nothing is force-stopped", async () => {
    const { client, controller } = await start(); // Thursday 10:00, inside hours

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(() => controller.getStatus().lastReconcile !== undefined);

    expect(controller.getStatus().lastReconcile!.commandedOff).toEqual([]);
    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off")).toEqual([]);
    expect(client.commandsFor(BEDROOM, "climate.turn_off")).toEqual([]);
  });

  test("reconnect during a hall-sensor fault reconciles on the fallback rules", async () => {
    // Outside active hours: the reconciled state must end up idle even though
    // the hall sensor is failed (the schedule cutoff is unaffected).
    const { client, machine, monitor, controller } = await start(
      {},
      new Date(2026, 0, 15, 23, 30, 0),
    );
    // The hall sensor fails (Home Assistant reports `unavailable`). Freshness
    // evidence is the report timestamp, so the failure is reported with a
    // newer timestamp than the startup read.
    monitor.report("hall", {
      entityId: "sensor.1st_floor_hall_multisensor_temperature",
      rawState: "unavailable",
      reportedAt: new Date(Date.now() + 60_000),
    });
    expect(monitor.isDegraded("hall")).toBe(true);

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(() => controller.getStatus().lastReconcile !== undefined);

    expect(monitor.isDegraded("hall")).toBe(true);

    expect(machine.getCurrentState()).toBe("idle");
    // Sensor health is unchanged by the reconcile: the sensor is still failed.
    expect(monitor.isDegraded("hall")).toBe(true);
    expect(controller.getStatus().degraded?.sources.map((s) => s.source)).toContain(
      "hall",
    );
  });

  test("the reconnect reads the observed unit state before it decides", async () => {
    const { client, controller } = await start(
      {},
      new Date(2026, 0, 15, 23, 30, 0),
    );
    client.states.set(LIVING_ROOM, "cool");
    client.commands.length = 0;

    client.emitConnection(false);
    client.emitConnection(true);

    await waitUntil(() => controller.getStatus().lastReconcile !== undefined);

    // The observed (non-heat) mode is what HAG reconciles against: the unit is
    // still commanded off outside active hours, and the read-back confirms it.
    expect(controller.getStatus().lastReconcile!.stillNotOff).toEqual([]);
    expect(client.commandsFor(LIVING_ROOM, "climate.turn_off").length).toBe(1);
  });
});
