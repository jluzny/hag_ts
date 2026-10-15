/**
 * Issue 3 — room selection: units the effective outdoor reading no longer
 * selects must be stopped on the same reevaluation.
 *
 * Agreed semantics (see "HAG winter implementation decisions", "Issue 3 —
 * Reconcile heating room selection", "Outdoor range — starting versus
 * continuing heating" and "Issue 4 — Schedule evaluation architecture"):
 *  - production room selection: `outdoorTemp > 10 °C` (through 15 °C) selects
 *    the living room only; −5 … 10 °C inclusive selects every enabled unit.
 *    Limits, presets and the schedule are untouched by this card;
 *  - when the effective outdoor temperature crosses above 10 °C inside the
 *    heating-eligible range, the other previously HAG-controlled rooms are
 *    turned off *immediately on that reevaluation*, not after the current
 *    cycle, and the living room stays selected;
 *  - disabled/unmanaged units are never commanded — no blanket shutdown;
 *  - the correction is a room-selection correction *inside* the operating
 *    range: an outdoor reading outside −5 … 15 °C must not shut a running unit
 *    down (the separate running-unit policy owns that), so no exclusion is
 *    applied there;
 *  - returning to ≤ 10 °C does not force-start the newly eligible units: the
 *    ordinary demand/schedule path decides, a continuation starts nothing;
 *  - an excluded unit is stopped once, not on every later reevaluation, and a
 *    failed fail-safe stop is retried and reported instead of being treated as
 *    a success.
 *
 * Fully offline: the shared harness (./harness.ts) records service intent with
 * a fake Home Assistant client and pins the wall clock. No Home Assistant,
 * network or device is contacted.
 */

import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import { type HvacOptions } from "../../../src/config/config.ts";
import {
  BASE_DATE,
  BEDROOM,
  DISABLED,
  Harness,
  LIVING_ROOM,
  flush,
  makeOptions,
  waitUntil,
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
 * Production-shaped options: the defrost layer removed (so every evaluation is
 * decided by the ordinary heating path alone) and the production room-selection
 * rule in place (`> 10 °C` → living room only).
 */
const roomSelectionOptions = (
  overrides: Partial<HvacOptions> = {},
): HvacOptions => {
  const options = makeOptions(overrides);
  delete (options.heating as { defrost?: unknown }).defrost;
  options.heating.rules = [
    {
      conditions: { outdoorTemp: { gt: 10 } },
      actions: { includeUnits: [LIVING_ROOM] },
    },
  ];
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

/** Stop commands in the order they reached the wire. */
const turnOffCalls = (h: Harness): string[] =>
  h.ha.wire
    .filter((call) => call.service === "climate.turn_off")
    .map((call) => call.entityId);

/** Start/setting writes (everything that is not a stop command). */
const heatWrites = (h: Harness) =>
  h.ha.calls.filter((call) => call.service !== "climate.turn_off");

/** Start/setting writes of one entity, in call order. */
const writesFor = (h: Harness, entityId: string) =>
  h.ha
    .callsFor(entityId)
    .filter((call) => call.service !== "climate.turn_off");

// ---------------------------------------------------------------------------
// The acceptance regression: crossing above 10 °C inside the range
// ---------------------------------------------------------------------------

describe("Room selection - crossing above 10 °C stops the excluded rooms", () => {
  test("the reevaluation that crosses above 10 °C stops the other running units", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0); // demand, in range, no rule match -> all enabled
    await flush();
    expect(h.state).toBe("heating");
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(h.ha.callsFor(BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([]);

    h.sendConditions(21.0, 11.0); // above 10 °C, still inside the range
    await flush();

    // The other previously HAG-controlled room is stopped on this same
    // reevaluation, not after its cycle...
    expect(h.state).toBe("heating");
    expect(turnOffCalls(h)).toEqual([BEDROOM]);
    // ...and the living room stays selected (settings re-asserted).
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([
      ...heatBatch(LIVING_ROOM, 21.0),
      ...heatBatch(LIVING_ROOM, 21.0),
    ]);
    // The excluded room is not re-asserted after the crossing.
    expect(writesFor(h, BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    // Disabled/unmanaged units are never commanded.
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("the stop command reaches the device before the selected room is re-asserted", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, 11.0);
    await flush();

    const wire = h.ha.wire.map((call) => `${call.entityId}:${call.service}`);
    const stopIndex = wire.indexOf(`${BEDROOM}:climate.turn_off`);
    const lastLivingWrite = wire.lastIndexOf(`${LIVING_ROOM}:climate.set_hvac_mode`);

    expect(stopIndex).toBeGreaterThan(-1);
    expect(lastLivingWrite).toBeGreaterThan(stopIndex);
  });

  test("just above 10 °C narrows, exactly 10 °C keeps every enabled unit", async () => {
    const atTen = harness(roomSelectionOptions());
    atTen.sendConditions(21.0, 10.0); // inclusive endpoint: all enabled units
    await flush();
    expect(atTen.state).toBe("heating");
    expect(atTen.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(atTen.ha.callsFor(BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    expect(turnOffCalls(atTen)).toEqual([]);
    await atTen.stop();

    const aboveTen = harness(roomSelectionOptions());
    aboveTen.sendConditions(21.0, 9.9);
    await flush();
    expect(turnOffCalls(aboveTen)).toEqual([]);

    aboveTen.sendConditions(21.0, 10.1); // strictly greater than 10
    await flush();
    expect(turnOffCalls(aboveTen)).toEqual([BEDROOM]);
    expect(writesFor(aboveTen, BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
  });

  test("the exclusion also applies at the inclusive upper range endpoint (15 °C)", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, 15.0); // in range, above 10 °C
    await flush();

    expect(h.state).toBe("heating");
    expect(turnOffCalls(h)).toEqual([BEDROOM]);
  });
});

// ---------------------------------------------------------------------------
// The correction is confined to the heating-eligible outdoor range
// ---------------------------------------------------------------------------

describe("Room selection - outside the operating range nothing is shut down", () => {
  test("leaving the range above must not stop a running unit", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0); // all enabled units running
    await flush();
    expect(h.ha.callsFor(BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));

    h.sendConditions(21.0, 16.0); // out of range: running units continue
    await flush();

    expect(h.state).toBe("heating");
    expect(turnOffCalls(h)).toEqual([]);
    expect(writesFor(h, BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    expect(writesFor(h, LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
  });

  test("leaving the range below must not stop a running unit", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, -6.0); // below the -5 °C limit
    await flush();

    expect(h.state).toBe("heating");
    expect(turnOffCalls(h)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The exclusion runs on the reevaluation itself, even without start demand
// ---------------------------------------------------------------------------

describe("Room selection - immediate exclusion without a start-eligible hall reading", () => {
  test("an in-band hall reading still stops the newly excluded room", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0); // start: all enabled units
    await flush();
    expect(turnOffCalls(h)).toEqual([]);

    // Inside the hysteresis band: no heating start is made, and the running
    // units keep their settings — but the exclusion is still applied.
    h.sendConditions(21.4, 11.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(turnOffCalls(h)).toEqual([BEDROOM]);
    // The retained targets of the selected room are not rewritten.
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual(heatBatch(LIVING_ROOM, 21.0));
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No repeated stop commands, no forced starts
// ---------------------------------------------------------------------------

describe("Room selection - repeated evaluations and return to the wider selection", () => {
  test("an already stopped excluded unit is not stopped again", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, 11.0);
    await flush();
    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(1);

    h.sendConditions(21.0, 12.0);
    await flush();
    h.sendConditions(21.4, 13.0);
    await flush();

    expect(turnOffCalls(h)).toEqual([BEDROOM]);
    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(1);
    expect(h.state).toBe("heating");
  });

  test("returning to <= 10 °C starts nothing while there is no heating demand", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, 11.0);
    await flush();
    expect(turnOffCalls(h)).toEqual([BEDROOM]);

    // Selection broadens again, but the hall is inside the band: the ordinary
    // (here: continuing) path decides and no unit is force-started.
    h.sendConditions(21.4, 9.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(writesFor(h, BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));
    expect(turnOffCalls(h)).toEqual([BEDROOM]);
  });

  test("returning to <= 10 °C with demand lets the ordinary path start the unit again", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.0, 11.0);
    await flush();
    expect(writesFor(h, BEDROOM)).toEqual(heatBatch(BEDROOM, 21.0));

    h.sendConditions(21.0, 9.0); // demand again inside the wider selection
    await flush();

    expect(h.state).toBe("heating");
    expect(writesFor(h, BEDROOM)).toEqual([
      ...heatBatch(BEDROOM, 21.0),
      ...heatBatch(BEDROOM, 21.0),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Command failures are reported, not claimed as success
// ---------------------------------------------------------------------------

describe("Room selection - a failed stop is retried and reported", () => {
  test("a failed stop is retried, stays owned and stops repeating once delivered", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();

    // The fail-safe stop fails for the first three attempts (one batch).
    h.ha.failNext.set(`${BEDROOM}::climate.turn_off`, 3);
    h.sendConditions(21.0, 11.0);
    // The bounded retries use real timers, so wait for the batch to settle
    // instead of relying on a fixed flush.
    await waitUntil(() => h.ha.attemptsFor(BEDROOM, "climate.turn_off") >= 3);
    await waitUntil(() => writesFor(h, LIVING_ROOM).length === 6);

    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(3);
    expect(turnOffCalls(h)).toEqual([]); // never reached the device
    expect(h.state).toBe("heating");
    // The selected room was still re-asserted after the failed stop.
    expect(writesFor(h, LIVING_ROOM)).toEqual([
      ...heatBatch(LIVING_ROOM, 21.0),
      ...heatBatch(LIVING_ROOM, 21.0),
    ]);

    // The next relevant evaluation retries the failed stop and succeeds.
    h.sendConditions(21.0, 12.0);
    await waitUntil(() => turnOffCalls(h).includes(BEDROOM));
    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(4);

    // Delivered once: no further stop attempts.
    h.sendConditions(21.0, 13.0);
    await flush();
    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(4);
  });

  test("no stop is attempted while the selection never narrowed", async () => {
    const h = harness(roomSelectionOptions());

    h.sendConditions(21.0, 9.0);
    await flush();
    h.sendConditions(21.4, 5.0); // in band, same (wide) selection
    await flush();
    h.sendConditions(21.0, 8.0); // demand inside the wide selection
    await flush();

    expect(turnOffCalls(h)).toEqual([]);
    expect(h.ha.attemptsFor(BEDROOM, "climate.turn_off")).toBe(0);
    expect(heatWrites(h)).toEqual([
      ...heatBatch(LIVING_ROOM, 21.0),
      ...heatBatch(BEDROOM, 21.0),
      ...heatBatch(LIVING_ROOM, 21.0),
      ...heatBatch(BEDROOM, 21.0),
    ]);
  });
});
