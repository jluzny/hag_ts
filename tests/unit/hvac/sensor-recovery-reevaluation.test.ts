/**
 * Issue 2 — probe-detected sensor recovery reevaluates the normal heating
 * rules through the real controller (review round 1, F1).
 *
 * Approved semantics (decisions doc, Issue 2): on the first confirmed fresh,
 * valid hall report, automatically leave degraded mode and reevaluate normal
 * heating rules, including schedule and heating stop threshold; one recovery
 * notification, one reevaluation.
 *
 * HA state_changed fires only on value changes, so a sensor that resumes
 * reporting the SAME value (state_reported with an advancing last_reported) is
 * invisible except through the freshness probe: the probe-detected recovery
 * must route into the same evaluation the ordinary sensor-change path gets.
 *
 * Fully offline: a fake Home Assistant client stands in for the network, and
 * the monitor's timers are driven by a fake clock.
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { HVACController } from "../../../src/hvac/controller.ts";
import { HVACStateMachine } from "../../../src/hvac/state-machine.ts";
import { type SensorHealthMonitor } from "../../../src/hvac/sensor-health.ts";
import {
  type ApplicationOptions,
  type HvacOptions,
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
  flush,
  LIVING_ROOM,
  RecordingNotifier,
  makeOptions,
  makeSensorHealth,
} from "./harness.ts";

const HALL = makeOptions().tempSensor;
const OUTDOOR = makeOptions().outdoorSensor;

/** Minimal offline Home Assistant client: no socket is ever opened. */
class FakeClient extends HomeAssistantClient {
  private _connected = false;
  readonly states = new Map<string, string>();
  readonly reads: string[] = [];
  readonly commands: { entityId: string; service: string }[] = [];
  private handlers = new Set<(connected: boolean) => void>();

  constructor() {
    super();
    this.states.set(HALL, "18.0");
    this.states.set(OUTDOOR, "7.0");
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
    this.commands.push({ entityId, service: `${domain}.${service}` });
    this.states.set(entityId, String(value));
  }

  override async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    const entityId = String(serviceCall.serviceData?.entity_id ?? "unknown");
    const service = `${serviceCall.domain}.${serviceCall.service}`;
    this.commands.push({ entityId, service });
    if (service === "climate.set_hvac_mode") {
      this.states.set(entityId, String(serviceCall.serviceData?.hvac_mode));
    }
  }

  /** Counts sensor (non-climate entity) reads since a mark. */
  sensorReadsSince(mark: number): string[] {
    return this.reads.slice(mark).filter((entityId) => !entityId.startsWith("climate."));
  }
}

const appOptions = {
  logLevel: "info",
  useAi: false,
  aiModel: "test",
  aiTemperature: 0,
  openaiApiKey: "***",
} as unknown as ApplicationOptions;

interface Fixture {
  client: FakeClient;
  controller: HVACController;
  machine: HVACStateMachine;
  monitor: SensorHealthMonitor;
  notifier: RecordingNotifier;
  clock: FakeClock;
  /** Advance the monitor's fake clock and the pinned wall clock together. */
  advance: (ms: number) => void;
  /** The value the hall sensor resumes reporting, once set. */
  hallResume: { value: string };
}

const fixtures: Fixture[] = [];

const TIMEOUT_MS = 30 * 60_000;

const start = async (): Promise<Fixture> => {
  const startMs = BASE_DATE.getTime();
  setSystemTime(BASE_DATE);
  const hvacOptions = makeOptions({
    sensorHealth: { reportTimeoutMs: TIMEOUT_MS } as never,
  }) as HvacOptions;
  const client = new FakeClient();
  const notifier = new RecordingNotifier();
  const clock = new FakeClock();
  // The probe: it always asks the live client. The hall sensor resumes
  // reporting (advancing last_reported) only once `hallResume` is set; until
  // then its last_reported never advances (the silent fault), while the
  // outdoor sensor keeps reporting fresh.
  const controllerOwnerRef: { controller?: HVACController } = {};
  const hallResume = { value: "" };
  const monitor = makeSensorHealth(hvacOptions, {
    clock,
    notifier,
    readReport: async (role, entityId) => {
      const state = await client.getState(entityId);
      if (role === "hall" && !hallResume.value) return { entityId, rawState: state.state, reportedAt: BASE_DATE };
      return {
        entityId,
        rawState: role === "hall" ? hallResume.value || state.state : state.state,
        reportedAt: new Date(Date.now() + 5 * 60_000),
      };
    },
    onRecovery: (role, value) =>
      void controllerOwnerRef.controller?.handleSensorRecovery(role, value),
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
  controllerOwnerRef.controller = controller;

  await controller.start();
  // The startup evaluation's command batch settles; assertions start clean.
  await machine.awaitPendingCommands();

  const fixture = {
    client,
    controller,
    machine,
    monitor,
    notifier,
    clock,
    advance: (ms: number) =>
      clock.advance(ms, (virtualNow) =>
        setSystemTime(new Date(startMs + virtualNow)),
      ),
    hallResume,
  };
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

describe("Issue 2 - a probe-detected same-value recovery reevaluates normal heating rules", () => {
  test("recovery with the SAME hall value keeps heating and clears degraded mode exactly once", async () => {
    const f = await start();
    expect(f.machine.getCurrentState()).toBe("heating");

    // Hall sensor goes silent (last_reported frozen): silent fault at timeout.
    f.advance(TIMEOUT_MS);
    await flush();
    expect(f.monitor.isDegraded("hall")).toBe(true);
    expect(f.monitor.sensorState("hall").reason).toBe("silent");
    expect(f.notifier.messages).toHaveLength(1);

    // The hall sensor resumes reporting the SAME value.
    f.hallResume.value = "18.0";
    f.advance(TIMEOUT_MS);
    await flush();
    await f.machine.awaitPendingCommands();

    // Degraded mode ended through the probe channel alone.
    expect(f.monitor.isDegraded("hall")).toBe(false);
    expect(f.notifier.messages).toHaveLength(2);
    expect(f.notifier.messages[1]).toContain("recovered");

    // The recovery drove exactly one reevaluation: normal heating rules again.
    expect(f.machine.getCurrentState()).toBe("heating");
    // No duplicate command batches from repeated reevaluations afterwards:
    // healthy probe cycles never re-run recovery and re-assert commands.
    const commandsAfterRecovery = f.client.commands.length;
    for (let i = 0; i < 2; i++) {
      f.advance(TIMEOUT_MS);
      await flush();
      await f.machine.awaitPendingCommands();
    }
    expect(f.client.commands.length).toBe(commandsAfterRecovery);
  });

  test("a recovering hall reading above the stop threshold commands the units off", async () => {
    const f = await start();
    expect(f.machine.getCurrentState()).toBe("heating");

    f.advance(TIMEOUT_MS);
    await flush();
    expect(f.monitor.isDegraded("hall")).toBe(true);

    // Recovery reports 22.0 °C above the hall stop threshold (21.8): the
    // reevaluation must immediately command every managed unit off.
    f.hallResume.value = "22.0";
    f.client.states.set(HALL, "22.0");
    f.advance(TIMEOUT_MS);
    await flush();
    await f.machine.awaitPendingCommands();

    expect(f.monitor.isDegraded("hall")).toBe(false);
    expect(f.machine.getCurrentState()).toBe("idle");
    const offs = f.client.commands.filter(
      (command) => command.service === "climate.set_hvac_mode",
    );
    expect(offs.length).toBeGreaterThan(0);
  });
});
