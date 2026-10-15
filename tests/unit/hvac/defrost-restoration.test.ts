/**
 * Regression tests for the restored Kameo-style custom defrost layer (HAG issue 5).
 *
 * Reference behaviour: jluzny/hass-hvac-control-kameo @ 3e67bf17455419335c4ac6d0e31c9cf0df41b387
 *   src/agents/hvac_agent.rs lines 90-105 (state machine transitions) and 279-411
 *   (need_defrost_cycle, start_defrost, is_defrost_cycle_completed, stop_defrost).
 *
 * These tests are fully offline: a fake Home Assistant client records service
 * intent, a fake clock drives the defrost one-shot timers, and the wall clock is
 * pinned with bun:test setSystemTime(). No Home Assistant, network or device is
 * contacted, and no real timer is waited on.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { setSystemTime } from "bun:test";
import { createActor } from "xstate";
import { createHVACMachine, HVACStateMachine, HVACStrategy } from "../../../src/hvac/state-machine.ts";
import { type HassOptions, type HvacOptions } from "../../../src/config/config.ts";
import { SystemMode } from "../../../src/types/common.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { HassServiceCallImpl, HassStateImpl } from "../../../src/home-assistant/models.ts";

// ---------------------------------------------------------------------------
// Deterministic fake clock (xstate actor `clock` option)
// ---------------------------------------------------------------------------

class FakeClock {
  /** Virtual milliseconds since construction. */
  now = 0;
  private timers = new Map<number, { fn: () => void; due: number; delay: number }>();
  private nextId = 1;

  setTimeout(fn: (...args: never[]) => void, delay: number): number {
    const id = this.nextId++;
    this.timers.set(id, { fn: fn as () => void, due: this.now + delay, delay });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  /** Number of timers still scheduled (used to assert cleanup / no duplicates). */
  pending(): number {
    return this.timers.size;
  }

  /** Scheduled delays in ms, ascending. */
  pendingDelays(): number[] {
    return [...this.timers.values()].map((t) => t.delay).sort((a, b) => a - b);
  }

  /** Fire every timer due within `ms`, in due order, advancing the virtual clock. */
  advance(ms: number, onAdvance: (virtualNow: number) => void = () => {}): void {
    const target = this.now + ms;
    for (let guard = 0; guard < 100; guard++) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.due <= target)
        .sort((a, b) => a[1].due - b[1].due);
      if (due.length === 0) break;
      const [id, timer] = due[0];
      this.timers.delete(id);
      this.now = timer.due;
      // Keep the pinned wall clock in step with virtual time *before* a
      // callback runs, so actions that read new Date() see the right time.
      onAdvance(this.now);
      timer.fn();
    }
    this.now = target;
    onAdvance(this.now);
  }
}

// ---------------------------------------------------------------------------
// Recording fake Home Assistant client
// ---------------------------------------------------------------------------

interface RecordedCall {
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
}

/**
 * Test-side mirror of the production client's abandoned-batch handling: settle
 * with `promise`, but stop as soon as `signal` aborts (the production client
 * does this around its REST state read).
 */
const raceSignal = <T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error("batch abandoned"));
    if (signal.aborted) {
      promise.then(
        () => {},
        () => {},
      );
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

class FakeHomeAssistantClient extends HomeAssistantClient {
  /** Service calls that reached the client successfully, in call order. */
  calls: RecordedCall[] = [];
  /** Entity ids whose commands must fail, to exercise command-failure handling. */
  failFor = new Set<string>();
  /**
   * Transient failures keyed `${entityId}::${service}`: the stored number is how
   * many further attempts must fail before that command succeeds.
   */
  failNext = new Map<string, number>();
  /** Every command attempt (successful or failed) in attempt order. */
  attempts: { entityId: string; service: string }[] = [];
  /**
   * Service calls in the order they actually reached the wire (i.e. after the
   * client's own pre-checks) — this is what determines the device's final mode.
   */
  wire: { entityId: string; service: string }[] = [];

  /**
   * Mirrors the production client's ordering hazard: when true, `getState`
   * blocks until `releaseGetState()`, exactly like the REST round-trip that
   * `HomeAssistantClient.controlEntity` performs before it sends its service
   * call (while `climate.turn_off` goes straight to `callService`).
   */
  deferGetState = false;
  private gates = new Map<string, () => void>();

  override async connect(): Promise<void> {}
  override async disconnect(): Promise<void> {}
  override get connected(): boolean {
    return true;
  }
  override async subscribeEvents(): Promise<void> {}
  override addEventHandler(): void {}
  override removeEventHandler(): void {}
  override onStateChanged(): void {}

  override async getState(
    entityId: string,
    signal?: AbortSignal,
  ): Promise<HassStateImpl> {
    if (signal?.aborted) {
      throw new Error(`abandoned state read for ${entityId}`);
    }
    if (this.deferGetState) {
      await new Promise<void>((resolve, reject) => {
        this.gates.set(entityId, resolve);
        // Mirrors the production client: an abandoned batch ends its state read
        // (there the REST fetch is aborted) instead of holding the queue.
        signal?.addEventListener(
          "abort",
          () => reject(new Error(`abandoned state read for ${entityId}`)),
          { once: true },
        );
      });
    }
    return new HassStateImpl(entityId, "21.0", {}, new Date(), new Date());
  }

  /** Unblock every deferred `getState` call and stop deferring further ones. */
  releaseGetState(): void {
    this.deferGetState = false;
    const pending = [...this.gates.values()];
    this.gates.clear();
    for (const resolve of pending) resolve();
  }

  /** Number of `getState` calls currently blocked. */
  pendingGetState(): number {
    return this.gates.size;
  }

  private shouldFail(entityId: string, service: string): boolean {
    if (this.failFor.has(entityId)) return true;
    const key = `${entityId}::${service}`;
    const remaining = this.failNext.get(key) ?? 0;
    if (remaining <= 0) return false;
    this.failNext.set(key, remaining - 1);
    return true;
  }

  override async controlEntity(
    entityId: string,
    domain: string,
    service: string,
    valueType: { type: string; key: string },
    value: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const serviceName = `${domain}.${service}`;
    // Mirrors the production client: an abandoned batch sends nothing.
    if (signal?.aborted) return;
    // The real client reads the entity state (a network round-trip) before it
    // decides to send the service call: that pause is where command ordering
    // can invert, so the fake reproduces it.
    await raceSignal(this.getState(entityId, signal), signal);
    if (signal?.aborted) return;
    this.attempts.push({ entityId, service: serviceName });
    if (this.shouldFail(entityId, serviceName)) {
      throw new Error(`simulated HA failure for ${entityId}`);
    }
    this.calls.push({
      entityId,
      service: serviceName,
      data: { [valueType.key]: value },
    });
    this.wire.push({ entityId, service: serviceName });
  }

  override async callService(
    serviceCall: HassServiceCallImpl,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    // HassServiceCallImpl.climate() carries the entity id in serviceData.
    const entityId =
      (serviceCall.target?.entityId as string) ??
      (serviceCall.serviceData?.entity_id as string) ??
      "unknown";
    const serviceName = `${serviceCall.domain}.${serviceCall.service}`;
    this.attempts.push({ entityId, service: serviceName });
    if (this.shouldFail(entityId, serviceName)) {
      throw new Error(`simulated HA failure for ${entityId}`);
    }
    this.calls.push({
      entityId,
      service: serviceName,
      data: serviceCall.serviceData,
    });
    this.wire.push({ entityId, service: serviceName });
  }

  callsFor(entityId: string): RecordedCall[] {
    return this.calls.filter((call) => call.entityId === entityId);
  }

  servicesFor(entityId: string): string[] {
    return this.callsFor(entityId).map((call) => call.service);
  }

  /** Services in the order they reached the wire for one entity. */
  wireFor(entityId: string): string[] {
    return this.wire
      .filter((call) => call.entityId === entityId)
      .map((call) => call.service);
  }

  /** How many times a service was attempted for one entity (failures included). */
  attemptsFor(entityId: string, service: string): number {
    return this.attempts.filter(
      (attempt) => attempt.entityId === entityId && attempt.service === service,
    ).length;
  }

  reset(): void {
    this.calls = [];
    this.wire = [];
    this.attempts = [];
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const LIVING_ROOM = "climate.living_room_ac"; // enabled, defrost: true
const BEDROOM = "climate.bedroom_ac"; // enabled, defrost: false
const DISABLED = "climate.disabled_ac"; // disabled, defrost: true

const DURATION_MS = 300 * 1000; // production durationSeconds
const PERIOD_MS = 7200 * 1000; // production periodSeconds

/** Local wall clock start: Thursday 2026-01-15 10:00 (inside production active hours). */
const BASE_DATE = new Date(2026, 0, 15, 10, 0, 0);

const makeOptions = (overrides: Partial<HvacOptions> = {}): HvacOptions =>
  ({
    tempSensor: "sensor.1st_floor_hall_multisensor_temperature",
    outdoorSensor: "sensor.openweathermap_temperature",
    systemMode: SystemMode.AUTO,
    hvacEntities: [
      { entityId: LIVING_ROOM, enabled: true, defrost: true },
      { entityId: BEDROOM, enabled: true, defrost: false },
      { entityId: DISABLED, enabled: false, defrost: true },
    ],
    heating: {
      temperature: 21.0,
      presetMode: "wind_free_sleep",
      temperatureThresholds: {
        indoorMin: 21.2,
        indoorMax: 21.8,
        outdoorMin: -5.0,
        outdoorMax: 15.0,
      },
      // Production values: 0 °C, 7200 s period, 300 s duration.
      defrost: { temperatureThreshold: 0.0, periodSeconds: 7200, durationSeconds: 300 },
    },
    cooling: {
      temperature: 25.0,
      presetMode: "wind_free",
      temperatureThresholds: {
        indoorMin: 23.7,
        indoorMax: 24.5,
        outdoorMin: 15.0,
        outdoorMax: 55.0,
      },
    },
    activeHours: { start: 9, startWeekday: 9, end: 23 },
    evaluationCacheMs: 0,
    ...overrides,
  }) as HvacOptions;

class Harness {
  readonly clock = new FakeClock();
  readonly ha = new FakeHomeAssistantClient();
  // Deliberately loosely typed: these tests drive raw xstate actors directly.
  readonly actor: any;
  private readonly startMs: number;

  constructor(options: HvacOptions = makeOptions()) {
    this.startMs = Date.now(); // the caller pins the wall clock before construction
    const machine = createHVACMachine(options, new LoggerService("test.defrost"), this.ha);
    this.actor = createActor(machine as any, { clock: this.clock as any });
    this.actor.start();
  }

  get state(): string {
    return this.actor.getSnapshot().value as string;
  }

  /** Mirrors HVACController.handleSensorChange: fresh hour read from the wall clock. */
  sendConditions(indoorTemp: number, outdoorTemp: number): void {
    const now = new Date();
    this.actor.send({
      type: "UPDATE_CONDITIONS",
      data: {
        indoorTemp,
        outdoorTemp,
        currentHour: now.getHours(),
        isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
      },
    } as never);
  }

  /** Advance the virtual timer clock and the pinned wall clock together. */
  advance(ms: number): void {
    this.clock.advance(ms, (virtualNow: number) => {
      setSystemTime(new Date(this.startMs + virtualNow));
    });
  }

  async stop(): Promise<void> {
    await (this.actor as unknown as { stop: () => Promise<void> | void }).stop();
  }
}

/** Let queued promises / async xstate actions settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/**
 * Poll `predicate()` with real timers until it is true (bounded retries and
 * deferred client promises use real timers, so the pinned wall clock must not
 * be used for the deadline).
 */
const waitUntil = async (
  predicate: () => boolean,
  attempts = 200,
  intervalMs = 5,
): Promise<void> => {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitUntil: condition not reached in time");
};

let active: Harness | undefined;

const harness = (options?: HvacOptions): Harness => {
  setSystemTime(BASE_DATE);
  active = new Harness(options);
  return active;
};

afterEach(async () => {
  if (active) {
    await active.stop();
    active = undefined;
  }
  setSystemTime();
});

// ---------------------------------------------------------------------------
// Entry into defrost
// ---------------------------------------------------------------------------

describe("Custom defrost - entry from idle/off", () => {
  test("enters defrost, cools defrost units and turns other enabled units off", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0); // heating demand, outdoor at/below threshold
    await flush();

    expect(h.state).toBe("defrosting");
    // defrost=true unit -> climate.set_hvac_mode cool (mode only, no temperature/preset)
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([
      { entityId: LIVING_ROOM, service: "climate.set_hvac_mode", data: { hvac_mode: "cool" } },
    ]);
    // defrost=false enabled unit -> off
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    // disabled unit untouched
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("treats outdoor 0.0 C as a valid defrost boundary (inclusive threshold)", async () => {
    const h = harness();
    h.sendConditions(20.5, 0.0);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
  });

  test("does not enter defrost above the threshold", async () => {
    const h = harness();
    h.sendConditions(20.5, 0.1);
    await flush();

    // Ordinary heating, not defrost: no unit is switched into cool mode.
    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(LIVING_ROOM)).not.toContain("climate.turn_off");
    expect(
      h.ha.calls.filter((c) => c.data?.hvac_mode === "cool"),
    ).toEqual([]);
  });

  test("does not enter defrost from off without heating demand", async () => {
    const h = harness();
    h.sendConditions(21.5, -3.0); // inside hysteresis band: no heating demand
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.ha.calls).toEqual([]);
  });

  test("does not enter defrost outside active hours", async () => {
    setSystemTime(new Date(2026, 0, 15, 23, 30, 0)); // past the 23:00 cutoff
    active = new Harness();
    active.sendConditions(20.5, -3.0);
    await flush();

    expect(active.state).not.toBe("defrosting");
    expect(active.ha.servicesFor(LIVING_ROOM)).not.toContain("climate.set_hvac_mode");
  });

  test("does not enter defrost when the outdoor reading is missing/NaN", async () => {
    const h = harness();
    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.ha.calls).toEqual([]);
  });

  test("does not enter defrost in cool-only or off system modes", async () => {
    const coolOnly = harness(makeOptions({ systemMode: SystemMode.COOL_ONLY }));
    coolOnly.sendConditions(20.5, -3.0);
    await flush();
    expect(coolOnly.state).not.toBe("defrosting");
    expect(coolOnly.ha.calls).toEqual([]);

    const off = harness(makeOptions({ systemMode: SystemMode.OFF }));
    off.sendConditions(20.5, -3.0);
    await flush();
    expect(off.state).not.toBe("defrosting");
    expect(off.ha.calls).toEqual([]);
  });

  test("does not enter defrost from summer cooling operation", async () => {
    const h = harness();
    h.sendConditions(26.0, 25.0); // cooling eligible -> cooling state
    await flush();
    expect(h.state).toBe("cooling");
    h.ha.reset();

    // outdoor drops below the defrost threshold while cooling is active
    h.sendConditions(26.0, -3.0);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).not.toContain("climate.set_hvac_mode");
  });
});

// ---------------------------------------------------------------------------
// Entry from active heating (legacy: operating conditions only, no demand needed)
// ---------------------------------------------------------------------------

describe("Custom defrost - entry from active heating", () => {
  test("defrosts an actively heating system even without current heating demand", async () => {
    const h = harness();
    h.sendConditions(20.0, 5.0); // heating (above defrost threshold)
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    // Indoor temperature now inside the hysteresis band (no heating demand),
    // outdoor below the defrost threshold, no prior completion -> immediately eligible.
    h.sendConditions(21.5, -3.0);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });

  test("schedule cutoff wins over defrost entry from active heating", async () => {
    const h = harness();
    h.sendConditions(20.0, 5.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    setSystemTime(new Date(2026, 0, 15, 23, 30, 0)); // past cutoff
    h.sendConditions(21.5, -3.0);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.state).toBe("idle");
    // schedule enforcement: units driven off, never into forced cool
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });
});

// ---------------------------------------------------------------------------
// Behaviour during the cycle
// ---------------------------------------------------------------------------

describe("Custom defrost - during the cycle", () => {
  test("spontaneous sensor events neither restart nor duplicate the cycle", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    const afterEntry = h.ha.calls.length;
    const timersAfterEntry = h.clock.pending();

    h.sendConditions(20.4, -3.1);
    h.sendConditions(20.6, -3.2);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.calls.length).toBe(afterEntry); // no extra commands
    expect(h.clock.pending()).toBe(timersAfterEntry); // no duplicate completion timers
  });

  test("schedule cutoff during the cycle aborts defrost and leaves units off", async () => {
    setSystemTime(new Date(2026, 0, 15, 22, 55, 0));
    active = new Harness();
    active.sendConditions(20.5, -3.0);
    await flush();
    expect(active.state).toBe("defrosting");
    active.ha.reset();

    setSystemTime(new Date(2026, 0, 15, 23, 5, 0)); // cutoff reached
    active.sendConditions(20.5, -3.0);
    await flush();

    expect(active.state).toBe("idle");
    expect(active.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(active.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    // the cycle's own completion timer is gone (no stale callback can fire)
    expect(active.clock.pending()).toBe(0);
  });

  test("manual off during the cycle leaves no unit in forced cool", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "off" } as never);
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });

  test("OFF event during the cycle leaves units off", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.ha.reset();

    h.actor.send({ type: "OFF" } as never);
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
  });
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

describe("Custom defrost - completion", () => {
  test("completes after durationSeconds without sensor events, then ordinary evaluation resumes heating", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    h.advance(DURATION_MS);
    await flush();

    // cycle-controlled enabled units are commanded off...
    expect(h.ha.servicesFor(BEDROOM)[0]).toBe("climate.turn_off");
    const livingRoomServices = h.ha.servicesFor(LIVING_ROOM);
    expect(livingRoomServices[0]).toBe("climate.turn_off");
    // ...and only then does the ordinary evaluation decide whether heat resumes
    expect(livingRoomServices).toContain("climate.set_hvac_mode");
    expect(h.state).toBe("heating");
    const heatIdx = livingRoomServices.indexOf("climate.set_hvac_mode");
    expect(heatIdx).toBeGreaterThan(0);
    expect(h.ha.callsFor(LIVING_ROOM)[heatIdx].data).toEqual({ hvac_mode: "heat" });
  });

  test("does not resume heating after completion when there is no demand", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.ha.reset();

    // indoor temperature rises into the hysteresis band before completion
    h.advance(DURATION_MS);
    h.sendConditions(21.5, -3.0); // <- ignored while the cycle is running
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });

  test("does not resume heating after completion once the schedule cutoff has passed", async () => {
    setSystemTime(new Date(2026, 0, 15, 22, 58, 0));
    active = new Harness();
    active.sendConditions(20.5, -3.0);
    await flush();
    expect(active.state).toBe("defrosting");
    active.ha.reset();

    active.advance(DURATION_MS); // completes at ~23:03, past the 23:00 cutoff
    await flush();

    expect(active.state).toBe("idle");
    // completion commands the units off and the schedule evaluation enforces
    // off as well: only off commands, never heat and never a leftover cool mode
    const livingRoomServices = active.ha.servicesFor(LIVING_ROOM);
    expect(livingRoomServices.length).toBeGreaterThan(0);
    expect(livingRoomServices.every((s) => s === "climate.turn_off")).toBe(true);
    const bedroomServices = active.ha.servicesFor(BEDROOM);
    expect(bedroomServices.length).toBeGreaterThan(0);
    expect(bedroomServices.every((s) => s === "climate.turn_off")).toBe(true);
  });

  test("records the last-defrost timestamp at completion, not at start", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");

    h.advance(DURATION_MS); // completion at t = 300s
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    // 7210s after the cycle START, but only 6910s after COMPLETION:
    // the next cycle must not start yet.
    h.advance(6910 * 1000);
    h.sendConditions(20.0, -3.0);
    await flush();
    expect(h.state).not.toBe("defrosting");

    // 7210s after completion -> eligible again
    h.advance(300 * 1000);
    h.sendConditions(20.0, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
  });
});

// ---------------------------------------------------------------------------
// One-shot defrost timers
// ---------------------------------------------------------------------------

describe("Custom defrost - one-shot timers", () => {
  test("schedules a one-shot next-eligibility evaluation after periodSeconds", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.advance(DURATION_MS);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.clock.pendingDelays()).toContain(PERIOD_MS);

    // no sensor events at all: the one-shot evaluation restarts the cycle
    h.ha.reset();
    h.advance(PERIOD_MS);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
  });

  test("keeps at most one pending defrost timer", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.advance(DURATION_MS);
    await flush();
    h.advance(PERIOD_MS); // second cycle starts
    await flush();
    expect(h.state).toBe("defrosting");
    h.advance(DURATION_MS); // second completion re-schedules the period timer
    await flush();

    expect(h.clock.pendingDelays().filter((d) => d === PERIOD_MS).length).toBe(1);
  });

  test("stop() clears defrost timers (no stale completion callback fires)", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    await h.stop();
    expect(h.clock.pending()).toBe(0);

    // A stale callback would drive units back into cooling/heating after stop.
    const callsAfterStop = h.ha.calls.length;
    h.advance(DURATION_MS + PERIOD_MS);
    await flush();
    expect(h.ha.calls.length).toBe(callsAfterStop);
  });
});

// ---------------------------------------------------------------------------
// Device safety on controller/state-machine stop
// ---------------------------------------------------------------------------

describe("Custom defrost - state machine stop", () => {
  test("stop during a defrost cycle commands the enabled units off", async () => {
    setSystemTime(BASE_DATE);
    const ha = new FakeHomeAssistantClient();
    const stateMachine = new HVACStateMachine(makeOptions(), ha);
    stateMachine.start();
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: { indoorTemp: 20.5, outdoorTemp: -3.0, currentHour: 10, isWeekday: true },
    });
    await flush();

    expect(stateMachine.getCurrentState()).toBe("defrosting");
    ha.reset();

    await stateMachine.stop();

    expect(stateMachine.getCurrentState()).toBe("stopped");
    expect(ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(ha.callsFor(DISABLED)).toEqual([]);
  });

  test("stop outside a defrost cycle issues no HVAC commands", async () => {
    setSystemTime(BASE_DATE);
    const ha = new FakeHomeAssistantClient();
    const stateMachine = new HVACStateMachine(makeOptions(), ha);
    stateMachine.start();
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: { indoorTemp: 21.5, outdoorTemp: 5.0, currentHour: 10, isWeekday: true },
    });
    await flush();
    ha.reset();

    await stateMachine.stop();

    expect(ha.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Command failures
// ---------------------------------------------------------------------------

describe("Custom defrost - command failures", () => {
  test("a failing defrost unit command does not block the other units", async () => {
    const h = harness();
    h.ha.failFor.add(LIVING_ROOM);
    h.sendConditions(20.5, -3.0);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([]); // command failed, no fabricated success
  });

  test("a persistently failing unit does not block the cycle or the other units", async () => {
    const h = harness();
    h.ha.failFor.add(LIVING_ROOM);
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");

    h.advance(DURATION_MS);
    await waitUntil(() => h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off") >= 3);
    await flush();
    // the retry is bounded (no infinite loop, no crash): the machine still leaves
    // the defrost state and the remaining unit still receives its off command
    expect(h.state).not.toBe("defrosting");
    expect(h.ha.servicesFor(BEDROOM)).toContain("climate.turn_off");
    expect(h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Strategy-level eligibility rules
// ---------------------------------------------------------------------------

describe("Custom defrost - eligibility rules", () => {
  const options = makeOptions();

  const data = (over: Partial<{ currentTemp: number; weatherTemp: number; hour: number; isWeekday: boolean }> = {}) => ({
    currentTemp: 20.5,
    weatherTemp: -3.0,
    hour: 10,
    isWeekday: true,
    ...over,
  });

  test("from off requires heating demand, from active heating it does not", () => {
    const strategy = new HVACStrategy(options);
    expect(strategy.isDefrostEntryEligible(data(), false)).toBe(true);
    expect(strategy.isDefrostEntryEligible(data({ currentTemp: 21.5 }), false)).toBe(false);
    expect(strategy.isDefrostEntryEligible(data({ currentTemp: 21.5 }), true)).toBe(true);
  });

  test("rejects NaN outdoor readings, out-of-hours and out-of-range weather", () => {
    const strategy = new HVACStrategy(options);
    expect(strategy.isDefrostEntryEligible(data({ weatherTemp: NaN }), true)).toBe(false);
    expect(strategy.isDefrostEntryEligible(data({ hour: 23 }), true)).toBe(false);
    expect(strategy.isDefrostEntryEligible(data({ weatherTemp: -6.0 }), true)).toBe(false);
    expect(strategy.isDefrostEntryEligible(data({ weatherTemp: 0.1 }), true)).toBe(false);
    expect(strategy.isDefrostEntryEligible(data({ weatherTemp: 0.0 }), true)).toBe(true);
  });

  test("no defrost configuration means no defrost", () => {
    const noDefrost = makeOptions();
    delete noDefrost.heating.defrost;
    const strategy = new HVACStrategy(noDefrost);
    expect(strategy.isDefrostEntryEligible(data(), true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HA command ordering (review round 1, F1)
//
// The production HA client awaits a `getState` round-trip inside `controlEntity`
// before it sends the service call, while `turn_off` goes straight to
// `callService`. Without per-machine serialization an abort issued during an
// in-flight defrost-entry command can therefore reach the device *before* that
// command, leaving the unit in forced COOL.
// ---------------------------------------------------------------------------

describe("Custom defrost - HA command ordering", () => {
  test("an abort during an in-flight entry command never leaves the unit in forced cool", async () => {
    const h = harness();
    h.ha.deferGetState = true; // hold the entry command at the client's getState pre-check
    h.sendConditions(20.5, -3.0);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.pendingGetState()).toBe(1); // one command is in flight...
    expect(h.ha.wire).toEqual([]); // ...and nothing has reached the wire yet

    h.actor.send({ type: "OFF" } as never); // abort while it is still in flight
    await flush();
    expect(h.state).toBe("idle");

    // The abort's fail-safe batch supersedes the in-flight entry batch: its
    // command is dropped, so the entry cool never reaches the device at all and
    // the off is the last (here: only) command for these units.
    await waitUntil(() => h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off") === 1);
    expect(h.ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.wireFor(BEDROOM)).toEqual(["climate.turn_off"]);

    // A state read that answers late cannot resurrect the superseded command.
    h.ha.releaseGetState();
    await flush();
    expect(h.ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.calls.filter((c) => c.data?.hvac_mode === "cool")).toEqual([]);
  });

  test("stop() during an in-flight entry command leaves the unit off, never cool", async () => {
    setSystemTime(BASE_DATE);
    const ha = new FakeHomeAssistantClient();
    ha.deferGetState = true; // hold the entry cool at the client's getState pre-check
    const stateMachine = new HVACStateMachine(makeOptions(), ha);
    stateMachine.start();
    stateMachine.send({
      type: "UPDATE_CONDITIONS",
      data: { indoorTemp: 20.5, outdoorTemp: -3.0, currentHour: 10, isWeekday: true },
    });
    await flush();
    expect(stateMachine.getCurrentState()).toBe("defrosting");
    expect(ha.pendingGetState()).toBe(1);

    const stopping = stateMachine.stop(); // off commands supersede the in-flight cool
    await waitUntil(() => ha.wireFor(LIVING_ROOM).includes("climate.turn_off"));
    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);

    ha.releaseGetState();
    await stopping;

    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(stateMachine.getCurrentState()).toBe("stopped");
  });

  test("a failing off command does not overtake a later successful one", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();
    h.ha.failNext.set(`${LIVING_ROOM}::climate.turn_off`, 1);

    h.actor.send({ type: "OFF" } as never);
    await waitUntil(() => h.ha.wireFor(LIVING_ROOM).includes("climate.turn_off"));

    expect(h.ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
  });
});

// ---------------------------------------------------------------------------
// Aborted cycles end the cycle for the period gate (review round 1, F2)
// ---------------------------------------------------------------------------

describe("Custom defrost - aborted cycle period gate", () => {
  test("an aborted cycle still blocks re-entry until periodSeconds after the abort", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");

    // manual off aborts the cycle; legacy ends every cycle through stop_defrost,
    // so the last-defrost timestamp is recorded here too
    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "off" } as never);
    await flush();
    expect(h.state).toBe("idle");
    h.ha.reset();

    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "heat" } as never);
    await flush();
    expect(h.state).toBe("heating");

    // 10 s after the abort, one ordinary sensor event must not restart defrosting
    h.advance(10 * 1000);
    h.sendConditions(20.0, -3.0);
    await flush();
    expect(h.state).toBe("heating");
    // ordinary heating only: no unit is driven back into cool mode
    expect(h.ha.calls.filter((c) => c.data?.hvac_mode === "cool")).toEqual([]);

    // once the period measured from the abort has elapsed, defrost is eligible again
    h.advance(PERIOD_MS);
    h.sendConditions(20.0, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
  });

  test("an OFF-aborted cycle also records the cycle end", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");

    h.actor.send({ type: "OFF" } as never);
    await flush();
    expect(h.state).toBe("idle");
    h.ha.reset();

    // immediately back into heating and evaluated again: still inside the period
    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "heat" } as never);
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(20.0, -3.0);
    await flush();
    expect(h.state).toBe("heating");
  });

  test("stop() during a cycle closes the cycle, so a restart in the same process is gated", async () => {
    setSystemTime(BASE_DATE);
    const ha = new FakeHomeAssistantClient();
    const stateMachine = new HVACStateMachine(makeOptions(), ha);
    stateMachine.start();
    const conditions = {
      indoorTemp: 20.5,
      outdoorTemp: -3.0,
      currentHour: 10,
      isWeekday: true,
    };
    stateMachine.send({ type: "UPDATE_CONDITIONS", data: conditions });
    await flush();
    expect(stateMachine.getCurrentState()).toBe("defrosting");
    ha.reset();

    await stateMachine.stop();
    expect(ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    ha.reset();

    // controller restart in the same process: the aborted cycle still gates the
    // next one, so ordinary heating runs instead of an immediate new defrost
    stateMachine.start();
    stateMachine.send({ type: "UPDATE_CONDITIONS", data: conditions });
    await flush();

    expect(stateMachine.getCurrentState()).not.toBe("defrosting");
    expect(stateMachine.getCurrentState()).toBe("heating");
    expect(ha.calls.filter((c) => c.data?.hvac_mode === "cool")).toEqual([]);

    await stateMachine.stop();
  });
});

// ---------------------------------------------------------------------------
// Bounded retry for the fail-safe off commands (review round 1, F3)
// ---------------------------------------------------------------------------

describe("Custom defrost - safety off command retry", () => {
  test("a permanently failing off command is retried a bounded number of times", async () => {
    const h = harness();
    h.ha.failFor.add(LIVING_ROOM);
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    // only the fail-safe off direction is retried: the entry cool is tried once
    expect(h.ha.attemptsFor(LIVING_ROOM, "climate.set_hvac_mode")).toBe(1);
    h.ha.reset();

    h.actor.send({ type: "OFF" } as never); // abort -> off commands
    await waitUntil(() => h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off") >= 3);
    await flush();

    expect(h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off")).toBe(3); // bounded
    expect(h.state).toBe("idle");
    expect(h.ha.wireFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });

  test("a transient off failure is retried until it succeeds", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.ha.reset();
    h.ha.failNext.set(`${LIVING_ROOM}::climate.turn_off`, 2); // fail twice, then succeed

    h.actor.send({ type: "OFF" } as never);
    await waitUntil(() => h.ha.wireFor(LIVING_ROOM).includes("climate.turn_off"));

    expect(h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off")).toBe(3);
    expect(h.ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]); // recovered
  });

  test("completion retries the safety off before ordinary evaluation resumes heating", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    h.ha.reset();
    h.ha.failNext.set(`${LIVING_ROOM}::climate.turn_off`, 1);

    h.advance(DURATION_MS);
    await waitUntil(() => h.ha.wireFor(LIVING_ROOM).includes("climate.turn_off"));
    await waitUntil(() => h.state === "heating");

    expect(h.ha.attemptsFor(LIVING_ROOM, "climate.turn_off")).toBe(2);
    const wire = h.ha.wireFor(LIVING_ROOM);
    expect(wire[0]).toBe("climate.turn_off"); // off lands before the resumed heat
    expect(h.state).toBe("heating");
  });
});

// ---------------------------------------------------------------------------
// Manual overrides issued during the cycle (review round 1, N3)
// ---------------------------------------------------------------------------

describe("Custom defrost - manual overrides during the cycle", () => {
  test("manual heat during the cycle ends in heating, never in a forced cool", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "heat" } as never);
    await flush();

    expect(h.state).toBe("heating");
    const wire = h.ha.wireFor(LIVING_ROOM);
    expect(wire).toContain("climate.turn_off"); // the abort left the forced cool
    expect(wire.indexOf("climate.turn_off")).toBeLessThan(
      wire.lastIndexOf("climate.set_hvac_mode"),
    );
    const hvacModeCalls = h.ha
      .callsFor(LIVING_ROOM)
      .filter((call) => call.service === "climate.set_hvac_mode");
    expect(hvacModeCalls.at(-1)!.data).toEqual({ hvac_mode: "heat" });
    expect(wire.at(-1)).not.toBe("climate.turn_off");
    expect(h.clock.pending()).toBe(0); // no stale defrost timer survives the abort
  });

  test("manual cool during the cycle aborts the forced cool and issues no fresh cool", async () => {
    const h = harness();
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    h.actor.send({ type: "MANUAL_OVERRIDE", mode: "cool" } as never);
    await flush();

    expect(h.state).toBe("cooling");
    // the abort switches the unit off; ordinary (manual) cooling evaluation then
    // decides cooling is not needed at 20.5 °C (below the cooling threshold)
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual([
      "climate.turn_off",
      "climate.turn_off",
    ]);
    expect(h.ha.wireFor(LIVING_ROOM).at(-1)).toBe("climate.turn_off");
    expect(h.clock.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A hung REST state read must not block (or be overtaken by) the fail-safe off
// (review round 2, F4)
//
// Every command batch reads the entity state over REST before it sends its
// service call, and that read used to be unbounded. A round-trip that never
// answered therefore held the whole per-machine command queue, so an abort's
// fail-safe `off` never reached a unit that was already in forced cool (measured
// hazard, round-2 review T3).
//
// These regressions drive the REAL HomeAssistantClient: only the WebSocket sink
// (`sendMessage`) and the global `fetch` are replaced, so the real
// `controlEntity`/`callService`/`getState` code paths run — including the
// state-request bound and the abandoned-batch handling. Offline: no socket, no
// network, no device.
// ---------------------------------------------------------------------------

/** Healthy REST payload for one entity state read. */
const HA_STATE_PAYLOAD = {
  entity_id: "climate.living_room_ac",
  state: "heat",
  attributes: {},
  last_changed: new Date(0).toISOString(),
  last_updated: new Date(0).toISOString(),
};

const jsonResponse = (): Response =>
  new Response(JSON.stringify(HA_STATE_PAYLOAD), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let restoreFetch: (() => void) | undefined;

/** Init object of a fetch call (the DOM lib type is not an eslint global). */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

/**
 * Replace global fetch; `handler` receives the 1-based call number and the
 * requested URL. Returns a counter for asserting that a read is in flight.
 */
const installFetch = (
  handler: (call: number, url: string, init?: FetchInit) => Promise<Response>,
): { calls: () => number } => {
  const original = globalThis.fetch;
  let calls = 0;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
  globalThis.fetch = ((url: string, init?: FetchInit) =>
    handler(++calls, url, init)) as typeof fetch;
  return { calls: () => calls };
};

/**
 * Real client transport: `getState`/`controlEntity`/`callService` stay real, and
 * only the private WebSocket sink is replaced by a recorder.
 */
class RealTransportClient extends HomeAssistantClient {
  wire: { entityId: string; service: string }[] = [];
  attempts: { entityId: string; service: string }[] = [];

  constructor(options: Partial<HassOptions> = {}) {
    super(
      {
        wsUrl: "ws://127.0.0.1:9/api/websocket",
        restUrl: "http://127.0.0.1:9",
        token: "offline-test-token",
        maxRetries: 1,
        retryDelayMs: 1,
        stateCheckInterval: 1000,
        ...options,
      } as HassOptions,
      new LoggerService("test.defrost.real-client"),
    );

    (
      this as unknown as {
        sendMessage: (message: {
          domain: string;
          service: string;
          service_data?: Record<string, unknown>;
          target?: { entity_id?: string };
        }) => Promise<void>;
      }
    ).sendMessage = async (message) => {
      const entityId =
        (message.target?.entity_id as string) ??
        (message.service_data?.entity_id as string) ??
        "unknown";
      const service = `${message.domain}.${message.service}`;
      this.attempts.push({ entityId, service });
      this.wire.push({ entityId, service });
    };
  }

  override async connect(): Promise<void> {}
  override async disconnect(): Promise<void> {}
  override get connected(): boolean {
    return true;
  }
  override async subscribeEvents(): Promise<void> {}
  override addEventHandler(): void {}
  override removeEventHandler(): void {}
  override onStateChanged(): void {}

  wireFor(entityId: string): string[] {
    return this.wire
      .filter((call) => call.entityId === entityId)
      .map((call) => call.service);
  }

  servicesWithMode(mode: string): string[] {
    return this.wire
      .filter((call) => call.service === `climate.set_hvac_mode:${mode}`)
      .map((call) => call.entityId);
  }

  reset(): void {
    this.wire = [];
    this.attempts = [];
  }
}

describe("Custom defrost - hung REST state read (review round 2, F4)", () => {
  const realActors: { stop: () => void }[] = [];

  /** Start a machine on the real transport with the pinned wall clock. */
  const boot = (ha: RealTransportClient, options = makeOptions()) => {
    setSystemTime(BASE_DATE);
    const machine = createHVACMachine(
      options,
      new LoggerService("test.defrost.real-client"),
      ha,
    );
    const actor = createActor(machine as any, { clock: new FakeClock() as any });
    actor.start();
    realActors.push(actor as unknown as { stop: () => void });
    const conditions = (indoorTemp: number, outdoorTemp: number) => {
      const now = new Date();
      actor.send({
        type: "UPDATE_CONDITIONS",
        data: {
          indoorTemp,
          outdoorTemp,
          currentHour: now.getHours(),
          isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
        },
      } as never);
    };
    return {
      actor,
      conditions,
      state: () => (actor.getSnapshot() as { value: string }).value,
    };
  };

  afterEach(() => {
    for (const actor of realActors.splice(0)) actor.stop();
    restoreFetch?.();
    restoreFetch = undefined;
    setSystemTime();
  });

  test("a state read that never answers cannot delay the abort's off, and cannot land after it", async () => {
    const ha = new RealTransportClient();
    let releaseHang: (() => void) | undefined;
    installFetch((call, _url, init) => {
      // First read (the first defrost unit) answers...
      if (call === 1) return Promise.resolve(jsonResponse());
      // ...every later read hangs forever, ignoring even the abort signal: the
      // strongest form of a transport that never answers.
      void init;
      return new Promise<Response>((resolve) => {
        releaseHang = () => resolve(jsonResponse());
      });
    });

    // Two defrost units: the first one reaches forced cool, the second one is
    // still waiting for its state read when the cycle is aborted.
    const twoDefrostUnits = makeOptions({
      hvacEntities: [
        { entityId: LIVING_ROOM, enabled: true, defrost: true },
        { entityId: BEDROOM, enabled: true, defrost: true },
        { entityId: DISABLED, enabled: false, defrost: true },
      ],
    });
    const h = boot(ha, twoDefrostUnits);
    h.conditions(20.5, -3.0);
    await waitUntil(() =>
      ha.wireFor(LIVING_ROOM).includes("climate.set_hvac_mode"),
    );
    expect(h.state()).toBe("defrosting");
    expect(ha.wireFor(BEDROOM)).toEqual([]); // stuck in the hung state read
    ha.reset();

    h.actor.send({ type: "OFF" } as never); // abort

    // Bounded: the fail-safe off must not wait for the hung read (the old code
    // waited forever), and it must land on every cycle-controlled unit.
    await waitUntil(
      () =>
        ha.wireFor(LIVING_ROOM).includes("climate.turn_off") &&
        ha.wireFor(BEDROOM).includes("climate.turn_off"),
      100,
      10,
    );
    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(ha.wireFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(h.state()).toBe("idle");

    // The superseded cool cannot land after the off, even when the hung read
    // finally answers.
    releaseHang?.();
    await flush();
    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(ha.wireFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(ha.wire).not.toContainEqual({
      entityId: LIVING_ROOM,
      service: "climate.set_hvac_mode",
    });
  });

  test("an abandoned cooling batch held at a unit state read cannot hold the off", async () => {
    // Cooling path: the batch reads a per-unit sensor over REST and then the
    // unit state, so a hung read there could equally block an abort's off.
    const ha = new RealTransportClient();
    const fetchMock = installFetch((_call, url) => {
      if (typeof url === "string" && url.includes("/states/climate.")) {
        return new Promise<Response>(() => {}); // hung unit read, ignores abort
      }
      return Promise.resolve(jsonResponse()); // sensor reads answer
    });

    const h = boot(ha);
    h.conditions(25.0, 20.0); // indoor above the cooling minimum, outdoor in range
    await flush();
    h.actor.send({ type: "MODE_CHANGE", mode: "cool" } as never);

    // The cooling batch is in flight and held at the unit's state read.
    await waitUntil(() => fetchMock.calls() >= 2);
    expect(h.state()).toBe("cooling");
    ha.reset();

    // Ordinary evaluation decides the temperature is comfortable (22.5 °C) and
    // commands the units off: that fail-safe batch must not wait for the hung
    // cooling command, and the hung command must not land after it.
    h.conditions(22.5, 20.0);
    await waitUntil(
      () => ha.wireFor(LIVING_ROOM).includes("climate.turn_off"),
      100,
      10,
    );

    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.state()).toBe("idle");
  });

  test("an abandoned cooling batch held at a per-unit sensor read cannot hold the off", async () => {
    const ha = new RealTransportClient();
    const fetchMock = installFetch((_call, url) => {
      if (typeof url === "string" && url.includes("sensor.")) {
        return new Promise<Response>(() => {}); // hung sensor read, ignores abort
      }
      return Promise.resolve(jsonResponse());
    });

    const h = boot(ha);
    h.conditions(25.0, 20.0);
    await flush();
    h.actor.send({ type: "MODE_CHANGE", mode: "cool" } as never);

    await waitUntil(() => fetchMock.calls() >= 1);
    expect(h.state()).toBe("cooling");
    ha.reset();

    h.conditions(22.5, 20.0);
    await waitUntil(
      () => ha.wireFor(LIVING_ROOM).includes("climate.turn_off"),
      100,
      10,
    );

    expect(ha.wireFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.state()).toBe("idle");
  });

  test("the REST state read is bounded, and a command still reaches the device after the bound", async () => {
    // A read that does not answer is bounded (not the 5 s default here) and
    // `controlEntity` keeps its existing "could not get current state,
    // proceeding with service call" behaviour, so the entry cool still lands.
    const ha = new RealTransportClient({ stateRequestTimeoutMs: 50 });
    installFetch((_call, _url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    );

    const h = boot(ha);
    const started = Date.now();
    h.conditions(20.5, -3.0);
    await waitUntil(
      () => ha.wireFor(LIVING_ROOM).includes("climate.set_hvac_mode"),
      200,
      10,
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000); // bounded by the configured 50 ms, not an unbounded read
    expect(ha.wireFor(BEDROOM)).toEqual(["climate.turn_off"]); // defrost=false unit off
    expect(h.state()).toBe("defrosting");
  });
});
