/**
 * Issue 1 — zero and negative finite temperatures are valid readings.
 *
 * Production defect (jluzny/hag_ts @ dcdbfb2): the state machine's guards used
 * truthiness checks (`!context.indoorTemp || !context.outdoorTemp`), so a
 * finite 0 °C reading was indistinguishable from a missing one and suppressed
 * ordinary heating (an offline -1 -> 0 °C outdoor reading with indoor 20 °C
 * produced heating -> idle with no device commands).
 *
 * Agreed semantics (see "HAG winter implementation decisions"):
 *  - 0 °C is an ordinary valid temperature, indoors and outdoors; no special
 *    freezing-point pause/shutdown;
 *  - negative finite readings are valid input too, and the existing outdoor
 *    operating range keeps gating heating eligibility (-5 °C .. 15 °C);
 *  - missing / non-finite input stays distinguishable from a valid reading;
 *  - no threshold, schedule, room-selection, preset or defrost-policy change.
 *
 * Fully offline: the shared harness (./harness.ts) records service intent with
 * a fake Home Assistant client and pins the wall clock. No Home Assistant,
 * network or device is contacted.
 */

import { afterEach, describe, expect, test, setSystemTime, spyOn } from "bun:test";
import { type HvacOptions } from "../../../src/config/config.ts";
import { CyclingMonitor } from "../../../src/hvac/cycling-monitor.ts";
import {
  BASE_DATE,
  BEDROOM,
  DISABLED,
  type FakeHomeAssistantClient,
  Harness,
  LIVING_ROOM,
  flush,
  makeOptions,
} from "./harness.ts";

let active: Harness | undefined;

/** Captured before any spy is installed, so the spy can delegate to the real method. */
const originalRecordStateChange = CyclingMonitor.prototype.recordStateChange;

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
 * Production-like options with the defrost layer removed, so a 0 °C outdoor
 * reading can only be interpreted by the ordinary heating path.
 */
const heatingOptions = (overrides: Partial<HvacOptions> = {}): HvacOptions => {
  const options = makeOptions(overrides);
  delete (options.heating as { defrost?: unknown }).defrost;
  return options;
};

/** Send an UPDATE_CONDITIONS event that may carry a missing / non-finite reading. */
const sendRaw = (
  h: Harness,
  indoorTemp: number,
  outdoorTemp: number,
): void => {
  const now = new Date();
  h.actor.send({
    type: "UPDATE_CONDITIONS",
    data: {
      indoorTemp,
      outdoorTemp,
      currentHour: now.getHours(),
      isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
    },
  });
};

/**
 * Every numeric value that reached the fake client (device intent). Used to pin
 * that an unusable reading is never sent as a number.
 */
const sentNumbers = (ha: FakeHomeAssistantClient): number[] =>
  ha.calls.flatMap((call) =>
    Object.values(call.data ?? {}).filter(
      (value): value is number => typeof value === "number",
    ),
  );

// ---------------------------------------------------------------------------
// Valid zero / negative readings keep ordinary heating eligible
// ---------------------------------------------------------------------------

describe("Issue 1 - finite zero and negative readings are valid input", () => {
  test("keeps ordinary heating eligible with a valid outdoor 0.0 °C reading", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, 0.0); // heating demand, valid 0 °C outdoors
    await flush();

    // A zero reading must not translate into "missing input" -> idle.
    expect(h.state).toBe("heating");

    // Actor state alone is not proof of device intent: capture the commands.
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([
      {
        entityId: LIVING_ROOM,
        service: "climate.set_hvac_mode",
        data: { hvac_mode: "heat" },
      },
      {
        entityId: LIVING_ROOM,
        service: "climate.set_temperature",
        data: { temperature: 21.0 },
      },
      {
        entityId: LIVING_ROOM,
        service: "climate.set_preset_mode",
        data: { preset_mode: "wind_free_sleep" },
      },
    ]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual([
      "climate.set_hvac_mode",
      "climate.set_temperature",
      "climate.set_preset_mode",
    ]);
    // Disabled units are never touched.
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("keeps ordinary heating eligible with a valid negative outdoor reading", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, -3.5); // valid, inside the -5 °C .. 15 °C range
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
  });

  test("a below-range negative reading is valid data but still denies heating", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, -6.0); // valid, below outdoorMin (-5 °C)
    await flush();

    // Valid input, existing operating limit unchanged: no new automatic start.
    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
  });

  test("an above-range reading is valid data but still denies heating", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(20.0, 16.0); // valid, above outdoorMax (15 °C)
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Turn-off guard with a valid zero reading
// ---------------------------------------------------------------------------

describe("Issue 1 - turn-off guard with a valid zero outdoor reading", () => {
  test("stops heating at the indoor maximum despite a 0.0 °C outdoor reading", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(22.0, 0.0); // 22.0 >= indoorMax (21.8): heating is done
    await flush();

    expect(h.state).toBe("idle");
    // The off direction must actually reach the managed units.
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Auto-cool guard: a finite zero is present input, not absent input
// ---------------------------------------------------------------------------

describe("Issue 1 - auto-cool guard treats a finite zero as present input", () => {
  /**
   * The cooling guard's truthiness check (`!context.indoorTemp`) is only
   * observable when a zero-valued reading is decision-relevant for cooling,
   * which production thresholds make impossible (a 0 °C room is never cooled).
   * These threshold fixtures are therefore deliberately artificial: they pin
   * the validity classification — finite zero is *input*, missing is not —
   * without proposing any change to the operational thresholds.
   */
  const zeroCoolingOptions = (): HvacOptions =>
    heatingOptions({
      heating: {
        temperature: 21.0,
        presetMode: "wind_free_sleep",
        temperatureThresholds: {
          indoorMin: 21.2,
          indoorMax: 21.8,
          outdoorMin: 10.0, // outdoor 0 °C is outside the heating range
          outdoorMax: 15.0,
        },
      },
      cooling: {
        temperature: 15.0,
        presetMode: "wind_free",
        temperatureThresholds: {
          indoorMin: -5.0,
          indoorMax: 0.0,
          outdoorMin: -10.0,
          outdoorMax: 15.0,
        },
      },
    });

  test("a valid 0 °C indoor and outdoor reading can still be evaluated as cooling", async () => {
    const h = harness(zeroCoolingOptions());
    h.sendConditions(0.0, 0.0);
    await flush();

    // Missing input would fall through to idle; a valid zero must be evaluated.
    expect(h.state).toBe("cooling");
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([
      {
        entityId: LIVING_ROOM,
        service: "climate.set_hvac_mode",
        data: { hvac_mode: "cool" },
      },
      {
        entityId: LIVING_ROOM,
        service: "climate.set_temperature",
        data: { temperature: 15.0 },
      },
      {
        entityId: LIVING_ROOM,
        service: "climate.set_preset_mode",
        data: { preset_mode: "wind_free" },
      },
    ]);
  });

  test("with production cooling thresholds a 0 °C hall reading never starts cooling", async () => {
    const h = harness(heatingOptions());
    h.sendConditions(0.0, 25.0);
    await flush();

    // Valid input, unchanged thresholds: a cold room is not a cooling demand.
    expect(h.state).toBe("idle");
    expect(
      h.ha.calls.filter((call) => call.data?.hvac_mode === "cool"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The heating path feeds a valid zero reading to the cycling monitor
// ---------------------------------------------------------------------------

describe("Issue 1 - the heating path records a finite zero reading", () => {
  /**
   * `executeHeating` records the hall reading in the cycling monitor with
   * `if (isFiniteNumber(context.indoorTemp))`. The guard is only observable
   * through the monitor itself: a truthiness check silently drops a finite
   * 0 °C reading, leaving every other observable behaviour (actor state,
   * outgoing commands) unchanged. Spy on the monitor method so a revert of
   * those two lines is caught.
   */
  test("records the valid 0.0 °C hall reading when heating starts", async () => {
    const records: {
      fromState: string;
      toState: string;
      temperature: number;
    }[] = [];
    const spy = spyOn(CyclingMonitor.prototype, "recordStateChange");
    spy.mockImplementation(function (
      this: CyclingMonitor,
      fromState: string,
      toState: string,
      temperature: number,
    ) {
      records.push({ fromState, toState, temperature });
      return originalRecordStateChange.call(this, fromState, toState, temperature);
    });

    try {
      const h = harness(heatingOptions());
      h.sendConditions(0.0, 0.0); // indoor 0.0 is below indoorMin: heat is due
      await flush();

      // The reading is decision-relevant and produces real device intent ...
      expect(h.state).toBe("heating");
      expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");

      // ... and the cycle is recorded with the actual 0.0 °C reading. The
      // duplicated pair is the pre-existing production recording (unchanged
      // by this card): a truthiness check would record nothing at all.
      expect(records).toEqual([
        { fromState: "OFF", toState: "HEAT", temperature: 0 },
        { fromState: "OFF", toState: "HEAT", temperature: 0 },
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Missing / non-finite input stays distinguishable from a valid zero
// ---------------------------------------------------------------------------

describe("Issue 1/Issue 2 - missing and non-finite input are not valid readings", () => {
  test("a missing indoor reading is never interpreted as a temperature (issue 2 fallback start)", async () => {
    const h = harness(heatingOptions());
    sendRaw(h, undefined as unknown as number, 0.0);
    await flush();

    // Issue 2 supersedes the earlier "a missing indoor reading blocks
    // evaluation" behaviour for a failed hall sensor: with a start-eligible
    // outdoor reading, the eligible units start on their own thermostats. The
    // missing reading is still never *interpreted* as a number.
    expect(h.state).toBe("heating");
    expect(sentNumbers(h.ha)).toEqual([21.0, 21.0]);
    expect(sentNumbers(h.ha).every((value) => Number.isFinite(value))).toBe(true);
  });

  test("a NaN indoor reading is never interpreted as a temperature (issue 2 fallback start)", async () => {
    const h = harness(heatingOptions());
    sendRaw(h, Number.NaN, 0.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(sentNumbers(h.ha)).toEqual([21.0, 21.0]);
  });

  test("a NaN outdoor reading blocks evaluation while indoor demand is valid", async () => {
    const h = harness(heatingOptions());
    sendRaw(h, 20.0, Number.NaN);
    await flush();

    // No retained outdoor value exists in this harness, so no new automatic
    // heating may start: eligibility is never fabricated.
    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
  });

  test("an Infinity reading is not a valid temperature", async () => {
    const h = harness(heatingOptions());
    sendRaw(h, Number.POSITIVE_INFINITY, 0.0);
    await flush();

    // An infinite indoor reading is unusable (issue 2's fallback start), and it
    // must never reach the device as a number.
    expect(h.state).toBe("heating");
    expect(sentNumbers(h.ha)).toEqual([21.0, 21.0]);
  });
});
