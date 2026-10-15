/**
 * Issue 2 — hall/outdoor sensor failure detection, degraded-mode state and
 * fault notification cadence.
 *
 * Agreed semantics (see "HAG winter implementation decisions", Issue 2 and
 * `references/heating-sensor-fallback.md`):
 *  - `unavailable`/`unknown`/non-finite readings are a fault *immediately*;
 *    zero and negative finite readings are valid (issue 1);
 *  - an unchanged-but-reporting sensor is healthy: a silent sensor is a fault
 *    only once the configurable reporting timeout elapses;
 *  - freshness comes only from Home Assistant's own report timestamp
 *    (`last_reported`). A report whose timestamp does not advance is not a new
 *    report and does not extend freshness;
 *  - the outdoor sensor keeps its last valid finite value in memory, used
 *    indefinitely (no expiry) for heating start eligibility and room
 *    selection, and always labelled as stale fallback data;
 *  - alerts: exactly one per fault onset, one daily reminder while the fault
 *    persists, one recovery notification.
 *
 * Fully offline: a fake clock drives the monitor's timers and a recording
 * notifier captures alert bodies. No Home Assistant, network or device is
 * contacted.
 */

import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import {
  DEFAULT_DAILY_REMINDER_MS,
  DEFAULT_SENSOR_REPORT_TIMEOUT_MS,
  SensorHealthMonitor,
  parseSensorReading,
} from "../../../src/hvac/sensor-health.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import {
  FakeClock,
  FailingNotifier,
  RecordingNotifier,
  flush,
  makeOptions,
  makeSensorHealth,
} from "./harness.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date(2026, 0, 15, 10, 0, 0); // Thursday 2026-01-15 10:00

interface Fixture {
  clock: FakeClock;
  notifier: RecordingNotifier;
  monitor: SensorHealthMonitor;
  advance: (ms: number) => void;
  at: (offsetMs: number) => Date;
}

const baseMs = BASE_DATE.getTime();

const fixture = (deps: {
  notifier?: RecordingNotifier;
  readReport?: Parameters<typeof makeSensorHealth>[1]["readReport"];
  reportTimeoutMs?: number;
  dailyReminderMs?: number;
} = {}): Fixture => {
  setSystemTime(BASE_DATE);
  const clock = new FakeClock();
  const notifier = deps.notifier ?? new RecordingNotifier();
  const options = makeOptions();
  const monitor = makeSensorHealth(options, {
    clock,
    notifier,
    readReport: deps.readReport,
    reportTimeoutMs: deps.reportTimeoutMs,
    dailyReminderMs: deps.dailyReminderMs,
  });

  return {
    clock,
    notifier,
    monitor,
    advance: (ms: number) =>
      clock.advance(ms, (virtualNow) => {
        setSystemTime(new Date(baseMs + virtualNow));
      }),
    at: (offsetMs: number) => new Date(baseMs + offsetMs),
  };
};

let active: Fixture | undefined;

const setup = (
  deps: Parameters<typeof fixture>[0] = {},
): Fixture => {
  active = fixture(deps);
  return active;
};

afterEach(() => {
  active?.monitor.dispose();
  active = undefined;
  setSystemTime();
});

describe("Issue 2 - a sensor failure is detected without false positives", () => {
  test("unavailable, unknown, empty and non-finite readings are a fault immediately", () => {
    for (const raw of ["unavailable", "unknown", "", "  ", "NaN", "inf", "none"]) {
      const f = setup();
      f.monitor.report("hall", { entityId: "sensor.hall", rawState: raw, reportedAt: f.at(0) });

      expect(parseSensorReading(raw)).toBeUndefined();
      expect(f.monitor.isDegraded("hall")).toBe(true);
      expect(f.monitor.sensorState("hall").reason).toBe("invalid");
      expect(f.notifier.messages.length).toBe(1);
      f.monitor.dispose();
    }
  });

  test("zero and negative finite readings are valid, not a fault", () => {
    const f = setup();
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "0.0",
      reportedAt: f.at(0),
    });
    expect(f.monitor.isDegraded("outdoor")).toBe(false);
    expect(f.monitor.effectiveOutdoorTemp()).toEqual({
      value: 0,
      staleFallback: false,
    });

    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "-7.5",
      reportedAt: f.at(60_000),
    });
    expect(f.monitor.isDegraded("outdoor")).toBe(false);
    expect(f.monitor.effectiveOutdoorTemp().value).toBe(-7.5);
    expect(f.notifier.messages).toEqual([]);
  });

  test("a sensor that reports no new timestamp does not stay fresh - silence is a fault after the timeout", async () => {
    const f = setup();
    // Reporting every 5 min for the whole window is healthy ...
    for (let i = 0; i < 6; i++) {
      f.monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "18.0",
        reportedAt: f.at(i * 5 * 60_000),
      });
      f.advance(5 * 60_000);
    }
    expect(f.monitor.isDegraded("hall")).toBe(false);

    // ... but a repeated read of the *same* report (unchanged timestamp) is not
    // a new report: freshness is not extended, so the timeout still fires.
    const staleTimestamp = f.at(5 * 60_000);
    for (let i = 0; i < 7; i++) {
      f.monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "18.0",
        reportedAt: staleTimestamp,
      });
      f.advance(5 * 60_000);
    }

    await flush();
    expect(f.monitor.isDegraded("hall")).toBe(true);
    expect(f.monitor.sensorState("hall").reason).toBe("silent");
  });

  test("silence is a fault only after the configured reporting timeout", async () => {
    const f = setup({ reportTimeoutMs: 30 * 60_000 });
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "18.0",
      reportedAt: f.at(0),
    });

    f.advance(30 * 60_000 - 1000);
    await flush();
    expect(f.monitor.isDegraded("hall")).toBe(false);

    f.advance(2000);
    await flush();
    expect(f.monitor.isDegraded("hall")).toBe(true);
    expect(f.monitor.sensorState("hall").reason).toBe("silent");
    // Only the daily reminder remains scheduled - no freshness churn on a
    // sensor that is already in fault.
    expect(f.clock.pendingDelays()).toEqual([DEFAULT_DAILY_REMINDER_MS]);
  });

  test("a silent-but-still-reporting sensor stays healthy when Home Assistant reports a newer timestamp", async () => {
    let reportedAt = BASE_DATE;
    const f = setup({
      reportTimeoutMs: 30 * 60_000,
      readReport: async (role, entityId) => ({
        entityId,
        rawState: role === "hall" ? "18.0" : "7.0",
        reportedAt,
      }),
    });

    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "18.0",
      reportedAt,
    });

    // The probe returns a *newer* report each time it is asked.
    for (let i = 0; i < 3; i++) {
      reportedAt = new Date(reportedAt.getTime() + 30 * 60_000);
      f.advance(31 * 60_000);
      await flush();
    }

    expect(f.monitor.isDegraded("hall")).toBe(false);
    expect(f.notifier.messages).toEqual([]);
  });

  test("no readable report at all is a fault (entity missing / read failed)", () => {
    const f = setup();
    f.monitor.noteNoReading("outdoor");
    expect(f.monitor.isDegraded("outdoor")).toBe(true);
    expect(f.monitor.sensorState("outdoor").reason).toBe("no-reading");
  });

  test("the approved reporting timeout default is 30 minutes", () => {
    expect(DEFAULT_SENSOR_REPORT_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_DAILY_REMINDER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("Issue 2 - the outdoor fallback is retained and always labelled stale", () => {
  test("the last valid outdoor value is kept indefinitely and never relabelled fresh", () => {
    const f = setup();
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "7.5",
      reportedAt: f.at(0),
    });
    expect(f.monitor.effectiveOutdoorTemp()).toEqual({
      value: 7.5,
      staleFallback: false,
    });

    // The sensor fails (unavailable) ...
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "unavailable",
      reportedAt: f.at(60_000),
    });
    const failed = f.monitor.sensorState("outdoor");
    expect(failed.degraded).toBe(true);
    expect(failed.retainedFallback).toBe(true);
    expect(failed.lastValidValue).toBe(7.5);
    expect(failed.lastValidAt).toBe(f.at(0).toISOString());

    // ... and stays failed: the retained value is used without an expiry, still
    // labelled as fallback data (never fresh, never updated).
    for (const hours of [1, 24, 72]) {
      f.advance(hours * 60 * 60_000);
    }
    expect(f.monitor.effectiveOutdoorTemp()).toEqual({
      value: 7.5,
      staleFallback: true,
    });
    expect(f.monitor.sensorState("outdoor").lastValidValue).toBe(7.5);
    expect(f.monitor.sensorState("outdoor").lastValidAt).toBe(
      f.at(0).toISOString(),
    );
  });

  test("with no valid outdoor reading ever, there is no fallback value to use", () => {
    const f = setup();
    f.monitor.noteNoReading("outdoor");
    expect(f.monitor.effectiveOutdoorTemp()).toEqual({
      value: undefined,
      staleFallback: false,
    });
  });

  test("recovery resumes live values and clears the fallback label", () => {
    const f = setup();
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "7.5",
      reportedAt: f.at(0),
    });
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "unavailable",
      reportedAt: f.at(60_000),
    });
    f.monitor.report("outdoor", {
      entityId: "sensor.outdoor",
      rawState: "6.0",
      reportedAt: f.at(120_000),
    });

    expect(f.monitor.isDegraded("outdoor")).toBe(false);
    expect(f.monitor.effectiveOutdoorTemp()).toEqual({
      value: 6,
      staleFallback: false,
    });
  });
});

describe("Issue 2 - alert cadence is exactly one per event", () => {
  test("one alert per fault onset, one daily reminder, one recovery", () => {
    const f = setup();
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "18.0",
      reportedAt: f.at(0),
    });

    // Onset.
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "unavailable",
      reportedAt: f.at(60_000),
    });
    expect(f.notifier.messages.length).toBe(1);
    expect(f.notifier.messages[0]).toContain("hall temperature sensor fault");

    // Repeated evaluations / repeats of the same fault do not re-announce.
    for (let i = 0; i < 5; i++) {
      f.monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "unknown",
        reportedAt: f.at(60_000 + i * 1000),
      });
    }
    f.monitor.noteNoReading("hall");
    expect(f.notifier.messages.length).toBe(1);

    // One reminder after the daily interval, and one more the next day.
    f.advance(DAY_MS);
    expect(f.notifier.messages.length).toBe(2);
    expect(f.notifier.messages[1]).toContain("still active");
    f.advance(2 * DAY_MS);
    expect(f.notifier.messages.length).toBe(4);

    // Recovery - exactly once, and the reminder timers stop.
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "19.0",
      reportedAt: f.at(20 * DAY_MS),
    });
    expect(f.notifier.messages.length).toBe(5);
    expect(f.notifier.messages[4]).toContain("recovered");

    // The reminder cadence stops with the fault (no more "still active"). This
    // window is shorter than the reporting timeout, so no new fault is due.
    f.advance(25 * 60_000);
    expect(f.notifier.messages.length).toBe(5);
  });

  test("a second, separate fault episode notifies again", () => {
    const f = setup();
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "18.0",
      reportedAt: f.at(0),
    });
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "unavailable",
      reportedAt: f.at(60_000),
    });
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "18.5",
      reportedAt: f.at(120_000),
    });
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "unavailable",
      reportedAt: f.at(180_000),
    });

    expect(f.notifier.messages.length).toBe(3);
    expect(f.notifier.messages[0]).toContain("fault");
    expect(f.notifier.messages[1]).toContain("recovered");
    expect(f.notifier.messages[2]).toContain("fault");
  });

  test("a daily reminder interval is configurable and never fires more often than that", () => {
    const f = setup({ dailyReminderMs: 60 * 60_000 });
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "unavailable",
      reportedAt: f.at(0),
    });
    expect(f.notifier.messages.length).toBe(1);

    for (let i = 1; i <= 4; i++) {
      f.advance(60 * 60_000);
      expect(f.notifier.messages.length).toBe(1 + i);
    }
  });
});

describe("Issue 2 - notification failures never break control", () => {
  test("a notifier whose transport always fails does not propagate the failure", async () => {
    setSystemTime(BASE_DATE);
    const clock = new FakeClock();
    const notifier = new FailingNotifier();
    const options = makeOptions();
    const monitor = new SensorHealthMonitor({
      entityIds: { hall: options.tempSensor, outdoor: options.outdoorSensor },
      scheduler: clock,
      notifier,
      logger: new LoggerService("test.sensor-health"),
    });
    active = undefined;

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // The send failures are isolated: reporting, recovery and status all keep
      // working, and the process sees no unhandled rejection.
      monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "18.0",
        reportedAt: BASE_DATE,
      });
      await flush();
      monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "unavailable",
        reportedAt: new Date(BASE_DATE.getTime() + 60_000),
      });
      await flush();
      monitor.report("hall", {
        entityId: "sensor.hall",
        rawState: "18.5",
        reportedAt: new Date(BASE_DATE.getTime() + 120_000),
      });
      await flush();

      expect(notifier.messages.length).toBe(2);
      expect(monitor.isDegraded("hall")).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      monitor.dispose();
      setSystemTime();
    }
  });

  test("dispose cancels pending fault timers", () => {
    const f = setup();
    f.monitor.report("hall", {
      entityId: "sensor.hall",
      rawState: "unavailable",
      reportedAt: f.at(0),
    });
    expect(f.clock.pending()).toBeGreaterThan(0);

    const before = f.notifier.messages.length;
    f.monitor.dispose();
    f.advance(48 * 60 * 60_000);
    expect(f.notifier.messages.length).toBe(before);
  });
});
