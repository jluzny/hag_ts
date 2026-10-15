/**
 * Review round 1 F3 (integration review t_6269b36c): defrost × sensor-fault
 * and reconnect interactions.
 *
 * Owner decision (recorded on card t_452d5d50): while the outdoor sensor is
 * failed, the calibrated in-memory last-valid outdoor value drives the custom
 * defrost threshold AND the operating-range gate — the same retained fallback
 * input the heating start already uses — explicitly labelled a stale fallback,
 * with no expiry and no persistence. With no retained value (cold restart)
 * there is no defrost entry. The hall-demand/validity gate (D2) is NOT touched
 * here: it stays current until separately approved.
 *
 * Fully offline: fake client, fake timer clock, pinned wall clock.
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  LIVING_ROOM,
  BEDROOM,
  DISABLED,
  BASE_DATE,
  Harness,
  flush,
  makeOptions,
  makeSensorHealth,
} from "./harness.ts";
import { type HvacOptions } from "../../../src/config/config.ts";
import { type SensorHealthMonitor } from "../../../src/hvac/sensor-health.ts";

const HALL = "sensor.1st_floor_hall_multisensor_temperature";
const OUTDOOR = "sensor.openweathermap_temperature";

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

/**
 * A harness whose outdoor sensor failed after it last reported `retained`
 * (the retained value is what the fallback flow must see, stale-labelled).
 */
const harnessWithFailedOutdoor = (
  retained: string | undefined,
  options?: HvacOptions,
  calibrate?: (role: "hall" | "outdoor", value: number) => number,
): Harness => {
  setSystemTime(BASE_DATE);
  const hvacOptions = makeOptions(options);
  const h = new Harness(hvacOptions, {
    sensorHealth: (clock) => makeSensorHealth(hvacOptions, { clock, calibrate }),
  });
  active = h;
  if (retained !== undefined) {
    const monitor = h.health!;
    monitor.report("outdoor", {
      entityId: OUTDOOR,
      rawState: retained,
      reportedAt: new Date(Date.now()),
    });
    monitor.report("outdoor", {
      entityId: OUTDOOR,
      rawState: "unavailable",
      reportedAt: new Date(Date.now() + 60_000),
    });
  }
  return h;
};

/** A harness whose hall sensor failed after it last reported `retained`. */
const harnessWithFailedHall = (
  options?: HvacOptions,
): { harness: Harness; monitor: SensorHealthMonitor } => {
  const hvacOptions = makeOptions(options);
  setSystemTime(BASE_DATE);
  const h = new Harness(hvacOptions, {
    sensorHealth: (clock) => makeSensorHealth(hvacOptions, { clock }),
  });
  active = h;
  const monitor = h.health!;
  monitor.report("hall", {
    entityId: HALL,
    rawState: "18.5",
    reportedAt: new Date(Date.now()),
  });
  monitor.report("hall", {
    entityId: HALL,
    rawState: "unavailable",
    reportedAt: new Date(Date.now() + 60_000),
  });
  return { harness: h, monitor };
};

/** Long defrost period, so no one-shot timer re-enters a cycle mid-test. */
const longDefrostOptions = (): HvacOptions => {
  const options = makeOptions();
  return {
    ...options,
    heating: {
      ...options.heating,
      defrost: {
        temperatureThreshold: 0.0,
        periodSeconds: 864_000,
        durationSeconds: 3_600,
      },
    },
  } as HvacOptions;
};

// ---------------------------------------------------------------------------
// D1 — outdoor sensor failed: the retained last-valid value drives custom
// defrost (owner decision), stale-labelled, no expiry, not after cold restart.
// ---------------------------------------------------------------------------

describe("Defrost x outdoor sensor failure (F3/D1 - retained fallback entry)", () => {
  test("a retained fallback at/below the threshold enters defrost from off/idle", async () => {
    const h = harnessWithFailedOutdoor("-3.0");

    // outdoorTemp is NaN in the context (the faulted sensor sent an invalid
    // reading); the retained last-valid -3 °C is the only outdoor input.
    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).toBe("defrosting");
    // defrost=true unit -> forced cool; defrost=false enabled unit -> off;
    // disabled unit untouched.
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
    expect(h.ha.callsFor(LIVING_ROOM)).toEqual([
      { entityId: LIVING_ROOM, service: "climate.set_hvac_mode", data: { hvac_mode: "cool" } },
    ]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });

  test("the fallback is the retained value and is explicitly stale-labelled", async () => {
    const h = harnessWithFailedOutdoor("-3.0");

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).toBe("defrosting");
    const effective = h.health!.effectiveOutdoorTemp();
    expect(effective.value).toBe(-3.0);
    expect(effective.staleFallback).toBe(true);
  });

  test("a retained 0.0 C fallback is a valid defrost boundary (inclusive threshold)", async () => {
    const h = harnessWithFailedOutdoor("0.0");

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
  });

  test("a calibrated fallback that lifts the retained reading above the threshold blocks entry", async () => {
    // Raw 0.0 °C would sit at/below the threshold; the +0.5 calibration moves
    // the retained value to +0.5 °C, which is above it. The defrost decision
    // must use the calibrated retained value, never a raw one.
    const h = harnessWithFailedOutdoor(
      "0.0",
      undefined,
      (role, value) => (role === "outdoor" ? value + 0.5 : value),
    );

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(
      h.ha.calls.filter((call) => call.data?.hvac_mode === "cool"),
    ).toEqual([]);
  });

  test("a retained fallback below the operating range blocks entry (no cool, no heat)", async () => {
    const h = harnessWithFailedOutdoor("-7.0"); // below outdoorMin -5

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.ha.calls).toEqual([]);
  });

  test("a retained fallback above the threshold blocks defrost and allows ordinary heating", async () => {
    const h = harnessWithFailedOutdoor("7.0"); // in range, above threshold

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).toBe("heating");
    expect(
      h.ha.calls.filter((call) => call.data?.hvac_mode === "cool"),
    ).toEqual([]);
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
  });

  test("no retained value (cold restart) means no defrost entry", async () => {
    const h = harnessWithFailedOutdoor(undefined);

    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(h.ha.calls).toEqual([]);
  });

  test("the retained fallback drives defrost entry from ACTIVE heating too", async () => {
    const h = harnessWithFailedOutdoor("-3.0");

    // Heating first with a live in-range, above-threshold outdoor reading.
    h.sendConditions(20.5, 7.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    // Outdoor fails: the next evaluation's only outdoor input is the retained
    // -3 °C fallback -> the running heating cycle must enter defrost.
    h.sendConditions(20.5, NaN);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.set_hvac_mode"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });
});

// ---------------------------------------------------------------------------
// D2 — hall sensor failed: defrost entry stays blocked (current constraint,
// pinned; bypassing the hall-demand/validity gate needs separate approval).
// ---------------------------------------------------------------------------

describe("Defrost x hall sensor failure (F3/D2 - entry stays blocked)", () => {
  test("a hall fault blocks defrost entry from off/idle and starts the thermostat fallback", async () => {
    const { harness: h, monitor } = harnessWithFailedHall();

    // Live outdoor -3 at/below the threshold, but the hall reading is gone.
    h.sendConditions(NaN, -3.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(monitor.isDegraded("hall")).toBe(true);
    // Ordinary fallback heating commands, never a forced cool.
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
    expect(
      h.ha.calls.filter((call) => call.data?.hvac_mode === "cool"),
    ).toEqual([]);
  });

  test("a hall fault blocks defrost entry from active heating", async () => {
    const { harness: h, monitor } = harnessWithFailedHall();

    // Heating with a live outdoor reading above the threshold.
    h.sendConditions(20.5, 7.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    // Hall fails; the live outdoor reading stays valid and, being above the
    // threshold, defrost is not entered anyway — this pin is about the hall
    // gate, so the outdoor reading also exercises eligible values in the
    // from-heating test below.
    h.sendConditions(NaN, -3.0);
    await flush();

    expect(h.state).not.toBe("defrosting");
    expect(monitor.isDegraded("hall")).toBe(true);
    expect(
      h.ha.calls.filter((call) => call.data?.hvac_mode === "cool"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D3 — reconnect during an active defrost cycle (schedule cutoff enforcement).
// ---------------------------------------------------------------------------

describe("Defrost x HA reconnect (F3/D3 - cutoff enforced at reconnect)", () => {
  test("reconnect during defrost still inside active hours does not disturb the cycle", async () => {
    const h = harness(longDefrostOptions());

    h.sendConditions(20.5, -3.0);
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    h.sendReconnected([
      { entityId: LIVING_ROOM, state: "cool" },
      { entityId: BEDROOM, state: "off" },
    ]);
    await flush();

    expect(h.state).toBe("defrosting");
    expect(h.ha.calls).toEqual([]);
  });

  test("reconnect during defrost after the cutoff aborts the cycle and switches the units off", async () => {
    const h = harness(longDefrostOptions());

    h.sendConditions(20.5, -3.0); // entered at 10:00, inside hours
    await flush();
    expect(h.state).toBe("defrosting");
    h.ha.reset();

    setSystemTime(new Date(2026, 0, 15, 23, 5, 0)); // past the 23:00 cutoff
    h.sendReconnected([
      { entityId: LIVING_ROOM, state: "cool" },
      { entityId: BEDROOM, state: "off" },
    ]);
    await flush();

    // The cycle must not keep running on its own duration timer once the
    // schedule window is closed: abort now, leave no unit in forced cool.
    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.callsFor(DISABLED)).toEqual([]);
  });
});
