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
import { type HvacOptions } from "../../../src/config/config.ts";
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

class FakeHomeAssistantClient extends HomeAssistantClient {
  calls: RecordedCall[] = [];
  /** Entity ids whose commands must fail, to exercise command-failure handling. */
  failFor = new Set<string>();

  override async connect(): Promise<void> {}
  override async disconnect(): Promise<void> {}
  override get connected(): boolean {
    return true;
  }
  override async subscribeEvents(): Promise<void> {}
  override addEventHandler(): void {}
  override removeEventHandler(): void {}
  override onStateChanged(): void {}

  override async getState(entityId: string): Promise<HassStateImpl> {
    return new HassStateImpl(entityId, "21.0", {}, new Date(), new Date());
  }

  override async controlEntity(
    entityId: string,
    domain: string,
    service: string,
    valueType: { type: string; key: string },
    value: unknown,
  ): Promise<void> {
    if (this.failFor.has(entityId)) {
      throw new Error(`simulated HA failure for ${entityId}`);
    }
    this.calls.push({
      entityId,
      service: `${domain}.${service}`,
      data: { [valueType.key]: value },
    });
  }

  override async callService(serviceCall: HassServiceCallImpl): Promise<void> {
    // HassServiceCallImpl.climate() carries the entity id in serviceData.
    const entityId =
      (serviceCall.target?.entityId as string) ??
      (serviceCall.serviceData?.entity_id as string) ??
      "unknown";
    if (this.failFor.has(entityId)) {
      throw new Error(`simulated HA failure for ${entityId}`);
    }
    this.calls.push({
      entityId,
      service: `${serviceCall.domain}.${serviceCall.service}`,
      data: serviceCall.serviceData,
    });
  }

  callsFor(entityId: string): RecordedCall[] {
    return this.calls.filter((call) => call.entityId === entityId);
  }

  servicesFor(entityId: string): string[] {
    return this.callsFor(entityId).map((call) => call.service);
  }

  reset(): void {
    this.calls = [];
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

  test("a failing unit is attempted once per event and the cycle still completes", async () => {
    const h = harness();
    h.ha.failFor.add(LIVING_ROOM);
    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");

    h.advance(DURATION_MS);
    await flush();

    // no infinite retry loop, no crash; the machine leaves the defrost state and
    // the remaining units still receive their off command
    expect(h.state).not.toBe("defrosting");
    expect(h.ha.servicesFor(BEDROOM)).toContain("climate.turn_off");
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
