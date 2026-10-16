/**
 * Issue 2 — hall/outdoor failure behaviour in the HVAC state machine.
 *
 * Approved semantics (see "HAG winter implementation decisions", Issue 2 and
 * `references/heating-sensor-fallback.md`):
 *  - a failed hall sensor must not push a running cycle to a stop, and must not
 *    block a deliberate thermostat-controlled start: at schedule opening the
 *    eligible units start on their own thermostats (target = the configured
 *    heating temperature; the failed reading is never fabricated into a
 *    number);
 *  - the schedule cutoff is unaffected by a failed sensor;
 *  - the outdoor sensor's last valid finite value is retained indefinitely as
 *    fallback data for heating start eligibility and room selection;
 *  - with no retained outdoor value, no new automatic heating starts.
 *
 * Fully offline: shared harness fake client + fake clock + recording notifier.
 */

import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import { type HvacOptions } from "../../../src/config/config.ts";
import { type SensorHealthMonitor } from "../../../src/hvac/sensor-health.ts";
import {
  BASE_DATE,
  BEDROOM,
  DISABLED,
  Harness,
  LIVING_ROOM,
  RecordingNotifier,
  flush,
  makeOptions,
  makeSensorHealth,
} from "./harness.ts";

let active: Harness | undefined;
let activeMonitor: SensorHealthMonitor | undefined;
let notifier: RecordingNotifier;

interface Scaffold {
  h: Harness;
  monitor: SensorHealthMonitor;
  report: (role: "hall" | "outdoor", rawState: string, offsetMs?: number) => void;
}

/**
 * Build a harness with the issue-2 monitor injected. `clock` comes from the
 * harness, so monitor timers advance with `h.advance()`.
 */
const scaffold = (
  overrides: Partial<HvacOptions> = {},
  deps: { readReport?: Parameters<typeof makeSensorHealth>[1]["readReport"] } = {},
): Scaffold => {
  setSystemTime(BASE_DATE);
  notifier = new RecordingNotifier();
  const options = makeOptions(overrides);
  let monitor!: SensorHealthMonitor;

  const h = new Harness(options, {
    sensorHealth: (clock) =>
      (monitor = makeSensorHealth(options, {
        clock,
        notifier,
        readReport: deps.readReport,
        // These tests describe the fallback/control behaviour, not the
        // notification debounce: alert immediately (the grace window has its
        // own tests in sensor-health.test.ts).
        notificationGraceMs: 0,
      })),
  });

  active = h;
  activeMonitor = monitor;

  const baseMs = BASE_DATE.getTime();
  return {
    h,
    monitor,
    report: (role, rawState, offsetMs = 0) =>
      monitor.report(role, {
        entityId: role === "hall" ? options.tempSensor : options.outdoorSensor,
        rawState,
        reportedAt: new Date(baseMs + offsetMs),
      }),
  };
};

afterEach(async () => {
  if (active) {
    await active.stop();
    active = undefined;
  }
  activeMonitor?.dispose();
  activeMonitor = undefined;
  setSystemTime();
});

describe("Issue 2 - a failed hall sensor starts eligible units on their own thermostats", () => {
  test("a hall fault at schedule opening starts the eligible units at the configured target", async () => {
    const { h, report } = scaffold();

    // The hall sensor is unusable (Home Assistant reports `unavailable`), the
    // outdoor reading is inside the operating range and the window is open.
    report("hall", "unavailable");
    h.sendConditions(Number.NaN, 7.0);
    await flush();

    expect(h.state).toBe("heating");

    // The target is the configured heating temperature — never a value derived
    // from the failed reading.
    const livingRoomTemp = h.ha
      .callsFor(LIVING_ROOM)
      .find((call) => call.service === "climate.set_temperature");
    expect(livingRoomTemp?.data).toEqual({ temperature: 21 });
    expect(h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
    expect(
      h.ha.calls.some((call) =>
        Object.values(call.data ?? {}).some(
          (value) => typeof value === "number" && !Number.isFinite(value),
        ),
      ),
    ).toBe(false);
  });

  test("a hall fault with a stale numeric reading does not stop a start either", async () => {
    const { h, report } = scaffold();
    report("hall", "18.0"); // a valid reading first ...
    report("hall", "unavailable", 1000); // ... then the sensor fails

    h.sendConditions(18.0, 7.0);
    await flush();

    expect(h.state).toBe("heating");
  });

  test("a hall fault with an outdoor reading outside the range does not start", async () => {
    const { h, report } = scaffold();
    report("hall", "unavailable");

    h.sendConditions(Number.NaN, 20.0); // 20 °C > outdoorMax (15 °C)
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
  });

  test("with no hall reading and no retained outdoor value, no heating starts", async () => {
    const { h, report } = scaffold();
    report("hall", "unavailable");
    report("outdoor", "unavailable"); // never had a valid reading

    h.sendConditions(Number.NaN, Number.NaN);
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.calls).toEqual([]);
    expect(notifier.messages.length).toBe(2); // both faults are announced
  });

  test("a healthy hall sensor keeps the ordinary threshold behaviour", async () => {
    const { h, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0");

    h.sendConditions(18.0, 7.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual([
      "climate.set_hvac_mode",
      "climate.set_temperature",
      "climate.set_preset_mode",
    ]);
  });
});

describe("Issue 2 - the outdoor fallback keeps eligibility working while the sensor is failed", () => {
  test("the retained outdoor value is used for start eligibility and labelled stale", async () => {
    const { h, monitor, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0"); // last valid outdoor reading ...
    report("outdoor", "unavailable", 60_000); // ... then the sensor fails

    expect(monitor.isDegraded("outdoor")).toBe(true);
    expect(monitor.effectiveOutdoorTemp()).toEqual({
      value: 7,
      staleFallback: true,
    });

    // The current outdoor reading is unusable, so only the retained fallback can
    // carry start eligibility — and the cycle must still start.
    h.sendConditions(18.0, Number.NaN);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(BEDROOM)).toContain("climate.set_hvac_mode");
  });

  test("room selection is driven by the retained outdoor value", async () => {
    const { h, report } = scaffold({
      heating: {
        ...makeOptions().heating,
        rules: [
          {
            conditions: { outdoorTemp: { gte: 5 } },
            actions: { includeUnits: [BEDROOM] },
          },
        ],
      } as HvacOptions["heating"],
    });

    report("outdoor", "6.0"); // rule matches: bedroom only
    report("outdoor", "unavailable", 60_000); // retained 6.0, still >= 5
    report("hall", "18.0");

    h.sendConditions(18.0, Number.NaN);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.servicesFor(BEDROOM)).toContain("climate.set_hvac_mode");
    // Without the retained value the reading would be unusable: no rule could
    // match and every enabled unit would have been started instead.
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual([]);
    expect(h.ha.servicesFor(DISABLED)).toEqual([]);
  });

  test("the approved >10 °C room rule still applies through the retained outdoor value", async () => {
    // Production rule shape (config/hvac_config_prod.yaml): outdoorTemp > 10 runs
    // the living room only; at or below 10 every enabled unit is eligible.
    const prodRules = [
      {
        conditions: { outdoorTemp: { gt: 10 } },
        actions: { includeUnits: [LIVING_ROOM] },
      },
    ] as unknown as HvacOptions["heating"]["rules"];

    // Above 10 (retained 10.5): living room only.
    const above = scaffold({
      heating: { ...makeOptions().heating, rules: prodRules },
    });
    above.report("outdoor", "10.5");
    above.report("outdoor", "unavailable", 60_000); // retained 10.5
    above.report("hall", "18.0");
    above.h.sendConditions(18.0, Number.NaN);
    await flush();

    expect(above.h.state).toBe("heating");
    expect(above.h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
    expect(above.h.ha.servicesFor(BEDROOM)).toEqual([]);
    await above.h.stop();
    active = undefined;
    activeMonitor?.dispose();

    // At 10.0 the rule does not match (strictly greater): every enabled unit is
    // eligible, so the fallback value keeps the boundary exact.
    const at = scaffold({
      heating: { ...makeOptions().heating, rules: prodRules },
    });
    at.report("outdoor", "10.0");
    at.report("outdoor", "unavailable", 60_000); // retained 10.0
    at.report("hall", "18.0");
    at.h.sendConditions(18.0, Number.NaN);
    await flush();

    expect(at.h.state).toBe("heating");
    expect(at.h.ha.servicesFor(LIVING_ROOM)).toContain("climate.set_hvac_mode");
    expect(at.h.ha.servicesFor(BEDROOM)).toContain("climate.set_hvac_mode");
  });

  test("an out-of-service hall sensor recovers with the outdoor fallback still in use", async () => {
    const { h, monitor, report } = scaffold();
    report("outdoor", "7.0");
    report("outdoor", "unavailable", 1000);
    report("hall", "unavailable", 2000);

    h.sendConditions(Number.NaN, Number.NaN);
    await flush();
    expect(h.state).toBe("heating"); // started on the retained outdoor value

    report("hall", "18.5", 3000); // hall recovers while the outdoor sensor is failed
    h.sendConditions(18.5, Number.NaN);
    await flush();

    expect(monitor.isDegraded("hall")).toBe(false);
    expect(h.state).toBe("heating");
    expect(monitor.effectiveOutdoorTemp()).toEqual({
      value: 7,
      staleFallback: true,
    });
  });
});

describe("Issue 2 - a failed hall sensor does not stop a running cycle, but the schedule still does", () => {
  test("a running cycle is not ended by an indoor reading while the hall sensor is failed", async () => {
    const { h, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0");

    h.sendConditions(18.0, 7.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    // The hall sensor fails, and the (stale) indoor reading is far above the
    // stop threshold: the approved retention policy means it must not end the
    // cycle yet.
    report("hall", "unavailable", 2000);
    h.sendConditions(30.0, 7.0);
    await flush();

    expect(h.state).toBe("heating");
    expect(h.ha.calls).toEqual([]);
  });

  test("the schedule cutoff is still enforced while the hall sensor is failed", async () => {
    const { h, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0");

    h.sendConditions(18.0, 7.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    report("hall", "unavailable", 2000);
    // Wall clock outside the active-hours window (production active hours 9..23).
    setSystemTime(new Date(2026, 0, 15, 23, 30, 0));
    h.sendConditions(30.0, 7.0);
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });

  test("recovery re-enables hall-based stopping", async () => {
    const { h, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0");

    h.sendConditions(18.0, 7.0);
    await flush();
    expect(h.state).toBe("heating");
    h.ha.reset();

    report("hall", "unavailable", 2000);
    h.sendConditions(30.0, 7.0);
    await flush();
    expect(h.state).toBe("heating");

    // The sensor reports again with a temperature above the stop threshold.
    report("hall", "24.0", 5000);
    h.sendConditions(24.0, 7.0);
    await flush();

    expect(h.state).toBe("idle");
    expect(h.ha.servicesFor(LIVING_ROOM)).toEqual(["climate.turn_off"]);
    expect(h.ha.servicesFor(BEDROOM)).toEqual(["climate.turn_off"]);
  });
});

describe("Issue 2 - a silent sensor is only a fault once the timeout has elapsed", () => {
  test("a hall sensor that stops reporting is a fault after the reporting timeout, not before", async () => {
    const { h, monitor, report } = scaffold();
    report("hall", "18.0");
    report("outdoor", "7.0");

    h.sendConditions(18.0, 7.0);
    await flush();
    expect(h.state).toBe("heating");

    h.advance(29 * 60_000);
    await flush();
    expect(monitor.isDegraded("hall")).toBe(false);

    h.advance(2 * 60_000);
    await flush();
    expect(monitor.isDegraded("hall")).toBe(true);
    expect(monitor.sensorState("hall").reason).toBe("silent");
  });
});
