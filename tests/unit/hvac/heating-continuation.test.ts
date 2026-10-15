/**
 * Issue 4/winter-readiness — continuation semantics for an existing heating cycle.
 *
 * Agreed semantics (see "HAG winter implementation decisions", "Outdoor range —
 * starting versus continuing heating" and "Issue 4 — Schedule evaluation"):
 *  - the outdoor operating range (-5 °C .. 15 °C, inclusive) gates heating
 *    *starts*; it must not stop a cycle that is already running. Leaving the
 *    range alone must not shut a heating unit down;
 *  - an existing cycle keeps running inside the indoor hysteresis band until
 *    the indoor stop threshold (indoorMax) is reached — the machine must not
 *    fall back to idle while the units are physically still heating;
 *  - the indoor stop threshold always ends the cycle with explicit off
 *    commands, regardless of the current outdoor start eligibility, and no
 *    unit is restarted outside the range;
 *  - the schedule stays binding: the next existing relevant event at/after the
 *    cutoff sends off intent (a delay past the cutoff until such an event is
 *    accepted behaviour), with a freshly read local time. No periodic
 *    reevaluation and no dedicated schedule-boundary event;
 *  - no start-eligible evaluation changes: a reevaluation that still qualifies
 *    for heating keeps going through the ordinary heating path (which re-asserts
 *    the running settings and applies room selection);
 *  - continuation sends no commands at all: the running units keep their
 *    existing targets instead of being rewritten just to hold the cycle.
 *
 * Baseline defect (jluzny/hag_ts @ dcdbfb2 + issue 1/5 rounds): the machine's
 * `heating` state sent every reevaluation through `evaluating`, whose
 * start-eligibility fallback landed in `idle` (no off commands) for an
 * out-of-range outdoor reading or an indoor reading inside the hysteresis band,
 * so the internal state claimed OFF while the units kept heating.
 *
 * Fully offline: the shared harness (./harness.ts) records service intent with a
 * fake Home Assistant client and pins the wall clock. No Home Assistant,
 * network or device is contacted.
 */

import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import { HVACStrategy } from "../../../src/hvac/state-machine.ts";
import { type HvacOptions } from "../../../src/config/config.ts";
import { type StateChangeData } from "../../../src/types/common.ts";
import {
  BASE_DATE,
  BEDROOM,
  DISABLED,
  Harness,
  LIVING_ROOM,
  flush,
  makeOptions,
} from "./harness.ts";

let active: Harness | undefined;

const harness = (options?: HvacOptions): Harness => {
  setSystemTime(BASE_DATE); // Thursday 2026-01-15 10:00, inside active hours
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

/**
 * Production-like options with the defrost layer removed, so every evaluation
 * below can only be interpreted by the ordinary heating path (no defrost
 * one-shot timers either).
 */
const heatingOptions = (overrides: Partial<HvacOptions> = {}): HvacOptions => {
  const options = makeOptions(overrides);
  delete (options.heating as { defrost?: unknown }).defrost;
  return options;
};

/** The three commands a heating start writes per enabled unit. */
const heatBatch = (entityId: string, temperature: number) => [
  { entityId, service: "climate.set_hvac_mode", data: { hvac_mode: "heat" } },
  { entityId, service: "climate.set_temperature", data: { temperature } },
  {
    entityId,
    service: "climate.set_preset_mode",
    data: { preset_mode: "wind_free_sleep" },
  },
];

const turnOffCalls = (h: Harness): string[] =>
  h.ha.wire
    .filter((call) => call.service === "climate.turn_off")
    .map((call) => call.entityId);

/** Every command that is not a stop command (i.e. a start/setting write). */
const heatWrites = (h: Harness) =>
  h.ha.calls.filter((call) => call.service !== "climate.turn_off");

// ---------------------------------------------------------------------------
// An existing cycle survives an outdoor range exit
// ---------------------------------------------------------------------------

describe("Heating continuation - outdoor range gates starts, not running cycles", () => {
  test("a heating cycle keeps running when the outdoor reading drops out of the range", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, -4.0); // cold start: indoor demand, outdoor in range
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(h.ha.callsFor(BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));

    h.sendConditions(21.0, -6.0); // valid reading, now below the -5 °C limit
    await flush();

    // Outdoor range exit alone must not stop the cycle...
    expect(h.state).toBe("heating");
    // ...and must not rewrite the running units either: the batch is unchanged.
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(h.ha.callsFor(BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("a heating cycle keeps running when the outdoor reading rises out of the range", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, 14.0);
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(21.0, 16.0); // valid reading, now above the 15 °C limit
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([]);
  });

  test("the indoor stop threshold ends the cycle with off commands regardless of outdoor eligibility", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, 14.0);
    await flush();
    h.sendConditions(21.0, 16.0); // out of start range, still heating
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(21.8, 16.0); // calibrated hall reaches the configured indoorMax
    await flush();

    expect(h.state).toBe("idle");
    expect(turnOffCalls(h)).toEqual([LIVING_ROOM, BEDROOM]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("no unit is started outside the outdoor range after the cycle ended", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, 14.0);
    await flush();
    h.sendConditions(21.8, 16.0); // stop threshold, outdoor out of range
    await flush();
    expect(h.state).toBe("idle");

    const afterStop = h.ha.calls.length;
    h.sendConditions(21.0, 16.0); // heating demand again, but outdoors is 16 °C
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.calls.length).toBe(afterStop); // no start, no command
  });
});

// ---------------------------------------------------------------------------
// Indoor hysteresis band keeps the cycle alive
// ---------------------------------------------------------------------------

describe("Heating continuation - indoor hysteresis band", () => {
  test("an in-band hall reading maintains the running cycle until indoorMax", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, 5.0); // below indoorMin -> ordinary heating start
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(21.4, 5.0); // inside the band: no longer start-eligible
    await flush();

    // Not idle: the cycle is still running and its settings are untouched.
    expect(h.state).toBe("heating");
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([]);

    h.sendConditions(21.8, 5.0); // stop threshold
    await flush();

    expect(h.state).toBe("idle");
    expect(turnOffCalls(h)).toEqual([LIVING_ROOM, BEDROOM]);
  });

  test("an in-band hall reading does not start heating from idle", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.4, 5.0); // inside the band, machines off: no demand
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The schedule stays binding
// ---------------------------------------------------------------------------

describe("Heating continuation - schedule cutoff", () => {
  test("the next event at/after the cutoff sends off intent and needs no dedicated timer", async () => {
    // Server drift: the deployed configuration ends at 22:00 (preserved).
    const h = harness(
      heatingOptions({ activeHours: { start: 9, startWeekday: 9, end: 22 } }),
    );
    h.sendConditions(21.0, 14.0);
    await flush();
    h.sendConditions(21.0, 16.0); // continues outside the start range
    await flush();
    expect(h.state).toBe("heating");

    // No periodic reevaluation, no dedicated schedule-boundary event.
    expect(h.clock.pending()).toBe(0);
    const beforeCutoff = h.ha.calls.length;

    // Wall clock moves past the cutoff; nothing happens on its own.
    setSystemTime(new Date(2026, 0, 15, 22, 3, 0));
    await flush();
    expect(h.ha.calls.length).toBe(beforeCutoff);
    expect(h.state).toBe("heating"); // delay past the cutoff is accepted

    h.sendConditions(21.0, 16.0); // the next existing relevant event
    await flush();

    expect(h.state).toBe("idle");
    expect(turnOffCalls(h)).toEqual([LIVING_ROOM, BEDROOM]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("a failed hall reading does not postpone the cutoff: the units are still told to stop", async () => {
    const h = harness(
      heatingOptions({ activeHours: { start: 9, startWeekday: 9, end: 22 } }),
    );
    h.sendConditions(21.0, 14.0);
    await flush();
    h.sendConditions(21.0, 16.0); // continues outside the start range
    await flush();
    expect(h.state).toBe("heating");
    const writesBeforeCutoff = heatWrites(h).length;

    setSystemTime(new Date(2026, 0, 15, 22, 3, 0)); // past the cutoff
    h.sendConditions(NaN, 16.0); // the hall sensor fails at/after the cutoff
    await flush();

    // Enforcement is a time-only decision: a failed sensor must not keep the
    // units heating past the schedule window.
    expect(h.state).toBe("idle");
    expect(turnOffCalls(h)).toEqual([LIVING_ROOM, BEDROOM]);
    // Stop intent only: no unit is restarted and no setting is rewritten.
    expect(heatWrites(h).length).toBe(writesBeforeCutoff);
    expect(heatWrites(h)).toEqual([
      ...heatBatch(LIVING_ROOM, 21.0),
      ...heatBatch(BEDROOM, 21.0),
    ]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("a failed outdoor reading does not postpone the cutoff either", async () => {
    const h = harness(
      heatingOptions({ activeHours: { start: 9, startWeekday: 9, end: 22 } }),
    );
    h.sendConditions(21.0, 14.0);
    await flush();
    h.sendConditions(21.0, 16.0); // continues outside the start range
    await flush();
    expect(h.state).toBe("heating");
    const writesBeforeCutoff = heatWrites(h).length;

    setSystemTime(new Date(2026, 0, 15, 22, 3, 0)); // past the cutoff
    h.sendConditions(21.0, NaN); // the outdoor sensor fails at/after the cutoff
    await flush();

    expect(h.state).toBe("idle");
    expect(turnOffCalls(h)).toEqual([LIVING_ROOM, BEDROOM]);
    expect(heatWrites(h).length).toBe(writesBeforeCutoff);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Starts are unchanged: the inclusive range endpoints stay eligible
// ---------------------------------------------------------------------------

describe("Heating continuation - starts still require the inclusive outdoor range", () => {
  test("exactly -5.0 °C is an eligible start endpoint", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, -5.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
  });

  test("exactly 15.0 °C is an eligible start endpoint", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, 15.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
  });

  test("just outside the range no heating start is made", async () => {
    const cold = harness(heatingOptions());
    cold.sendConditions(20.0, -5.1);
    await flush();
    expect(cold.state).toBe("idle");
    expect(cold.ha.calls).toEqual([]);
    await cold.stop();

    const warm = harness(heatingOptions());
    warm.sendConditions(20.0, 15.1);
    await flush();
    expect(warm.state).toBe("idle");
    expect(warm.ha.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Strategy-level semantics (no actor, no client)
// ---------------------------------------------------------------------------

describe("Heating continuation - strategy semantics", () => {
  const strategy = new HVACStrategy(heatingOptions());
  const data = (overrides: Partial<StateChangeData> = {}): StateChangeData => ({
    currentTemp: 21.0,
    weatherTemp: 5.0,
    hour: 10,
    isWeekday: true,
    ...overrides,
  });

  test("continues when the outdoor reading left the range below", () => {
    expect(strategy.shouldContinueHeating(data({ weatherTemp: -6.0 }))).toBe(true);
  });

  test("continues when the outdoor reading left the range above", () => {
    expect(strategy.shouldContinueHeating(data({ weatherTemp: 16.0 }))).toBe(true);
  });

  test("continues inside the indoor hysteresis band", () => {
    expect(strategy.shouldContinueHeating(data({ currentTemp: 21.4 }))).toBe(true);
  });

  test("keeps an unreadable hall reading from ending the cycle", () => {
    // Issue 2 retention: a failed hall sensor must not shut a running unit down.
    expect(strategy.shouldContinueHeating(data({ currentTemp: NaN }))).toBe(true);
  });

  test("ends the cycle at the indoor stop threshold", () => {
    expect(strategy.shouldContinueHeating(data({ currentTemp: 21.8 }))).toBe(false);
  });

  test("ends the cycle when the schedule window has closed", () => {
    expect(strategy.shouldContinueHeating(data({ hour: 23 }))).toBe(false);
  });

  test("yields when cooling demand takes precedence", () => {
    // Under production thresholds this clause is unreachable (cooling indoorMin
    // 23.7 °C > heating indoorMax 21.8 °C), so exercise it with a test-local
    // cooling threshold below indoorMax: 21.6 °C is neither a heating start
    // (< indoorMin 21.2) nor the indoor stop threshold (< indoorMax) and the
    // hour is inside the window — the cooling clause is the only reason to yield.
    const coolingFirstOptions = heatingOptions();
    coolingFirstOptions.cooling.temperatureThresholds.indoorMin = 21.5;
    const coolingFirst = new HVACStrategy(coolingFirstOptions);
    const inBand = data({ currentTemp: 21.6, weatherTemp: 20.0 });

    expect(coolingFirst.shouldContinueHeating(inBand)).toBe(false);
    // Same evaluation with the production cooling threshold: no cooling demand,
    // so the cycle continues (this is why 24.0 °C used to pass for the wrong
    // reason: it tripped the indoorMax clause first).
    expect(strategy.shouldContinueHeating(inBand)).toBe(true);
    expect(strategy.shouldContinueHeating(data({ currentTemp: 21.6 }))).toBe(true);
  });

  test("defers a start-eligible evaluation to the ordinary heating path", () => {
    expect(
      strategy.shouldContinueHeating(data({ currentTemp: 21.0, weatherTemp: 5.0 })),
    ).toBe(false);
    expect(
      strategy.shouldContinueHeating(data({ currentTemp: 21.0, weatherTemp: -5.0 })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defrost precedence (review F3): a defrost-eligible evaluation wins over
// continuation — that is what the defrost branch's position in the heating
// state's AUTO_EVALUATE array buys, and the new suite strips the defrost layer.
// ---------------------------------------------------------------------------

describe("Heating continuation - defrost precedence", () => {
  test("a defrost-eligible evaluation preempts a continuing heating cycle", async () => {
    const h = harness(makeOptions()); // defrost layer present
    h.sendConditions(21.0, 5.0); // cold start inside the outdoor range
    await flush();
    expect(h.state).toBe("heating");

    // In-band hall reading (continuation would hold the cycle) plus an outdoor
    // reading at/below the defrost threshold: defrost takes precedence.
    h.sendConditions(21.4, -1.0);
    await flush();

    expect(h.state).toBe("defrosting");
  });
});

// ---------------------------------------------------------------------------
// Compatibility with the other approved issues
// ---------------------------------------------------------------------------

describe("Heating continuation - compatibility", () => {
  test("a start-eligible reevaluation still runs the ordinary heating path (room selection/issue 3)", async () => {
    const options = heatingOptions();
    options.heating.rules = [
      {
        conditions: { outdoorTemp: { gt: 10 } },
        actions: { includeUnits: [LIVING_ROOM] },
      },
    ];
    const h = harness(options);
    h.sendConditions(21.0, 9.0); // no rule match -> all enabled units
    await flush();
    expect(h.state).toBe("heating");
    const livingRoomBefore = h.ha.callsFor(LIVING_ROOM).length;

    h.sendConditions(21.0, 11.0); // in range and start-eligible: ordinary path
    await flush();

    expect(h.state).toBe("heating");
    // The heating action ran again: continuation must not swallow it, otherwise
    // issue 3's immediate room-selection exclusion could never run.
    expect(h.ha.callsFor(LIVING_ROOM).length).toBeGreaterThan(livingRoomBefore);
  });

  test("a manual heat override is not silently converted into a continuation", async () => {
    const h = harness(heatingOptions());
    h.actor.send({ type: "MODE_CHANGE", mode: "heat", temperature: 22.0 });
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(21.4, 5.0); // in-band sensor event while the override is active
    await flush();

    expect(h.state).toBe("heating");
    // The manual target is still re-asserted by the ordinary manual path.
    expect(
      h.ha
        .callsFor(LIVING_ROOM)
        .some(
          (call) =>
            call.service === "climate.set_temperature" &&
            call.data?.temperature === 22.0,
        ),
    ).toBe(true);
  });

  test("a lost hall reading keeps the running cycle from being reported off (issue 2 retention)", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(21.0, 5.0);
    await flush();
    expect(h.state).toBe("heating");

    h.sendConditions(NaN, 5.0); // explicit unavailable hall reading
    await flush();

    expect(h.state).toBe("heating"); // intent retained, no shutdown caused by the fault
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([]);
  });
});
