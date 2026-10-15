/**
 * Sensor failure detection and degraded-mode state (issue 2).
 *
 * Approved semantics (see "HAG winter implementation decisions", Issue 2 and
 * `references/heating-sensor-fallback.md`):
 *
 *  - `unavailable`/`unknown`/non-finite readings are a fault *immediately*;
 *    an unchanged-but-reporting sensor is healthy, and a silent sensor is a
 *    fault only once the configurable reporting timeout has elapsed;
 *  - freshness is taken from Home Assistant's own report timestamp
 *    (`last_reported`), never from `last_changed` and never from a repeated
 *    read of cached state: a report whose timestamp does not advance is not a
 *    new report and does not extend freshness;
 *  - the outdoor sensor keeps its last valid finite value in memory, used
 *    indefinitely (no expiry) for heating start eligibility and room
 *    selection, and always labelled as stale fallback data — never relabelled
 *    fresh;
 *  - alerts: one per fault onset, one daily reminder while the fault persists,
 *    one recovery notification. Exactly one of each, no per-evaluation spam.
 *
 * Minimal by design: in-memory only, no persistence layer, no HVAC
 * evaluation is triggered from here. Timers exist only for fault/notification
 * timing (an explicitly separate concern from schedule evaluation) — this
 * module never starts heating, cooling or any other HVAC action.
 */

import type { LoggerService } from "../core/logging.ts";
import { type Notifier, NullNotifier } from "./notifier.ts";

export type SensorRole = "hall" | "outdoor";
export type FaultSource = SensorRole | "ha-connection";
export type SensorFaultReason = "invalid" | "silent" | "no-reading";

/** Minimal timer interface; the actor test harness passes its fake clock. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface SensorReport {
  entityId: string;
  rawState: string;
  /** Home Assistant's own report timestamp (`last_reported`). */
  reportedAt: Date;
}

export interface SensorHealthState {
  role: SensorRole;
  entityId: string;
  degraded: boolean;
  reason?: SensorFaultReason;
  faultSince?: string;
  lastReportAt?: string;
  lastValidValue?: number;
  lastValidAt?: string;
  /** True when the value in use is retained (stale) data, not a current reading. */
  retainedFallback: boolean;
}

export interface DegradedStatus {
  degraded: boolean;
  sources: Array<{ source: FaultSource; reason: SensorFaultReason; since: string }>;
  sensors: SensorHealthState[];
}

export interface SensorHealthOptions {
  entityIds: { hall: string; outdoor: string };
  /** Silent-reporting timeout (approved initial value: 30 minutes). */
  reportTimeoutMs?: number;
  /** Daily reminder interval while a fault persists. */
  dailyReminderMs?: number;
  scheduler?: Scheduler;
  notifier?: Notifier;
  logger: LoggerService;
  /** Current epoch milliseconds; injectable for tests. */
  now?: () => number;
  /**
   * Optional REST probe used when the reporting timeout elapses: it returns
   * Home Assistant's current report timestamp for the sensor, so a sensor that
   * keeps reporting the same value is not falsely declared silent.
   */
  readReport?: (
    role: SensorRole,
    entityId: string,
  ) => Promise<SensorReport | undefined>;
}

export const DEFAULT_SENSOR_REPORT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_DAILY_REMINDER_MS = 24 * 60 * 60 * 1000;

const schedulerOrDefault: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Parse a Home Assistant sensor state. Returns `undefined` (a fault) for
 * `unavailable`, `unknown`, empty and non-finite values; zero and negative
 * finite values are valid readings.
 */
export const parseSensorReading = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const text = raw.trim().toLowerCase();
  if (
    text === "" ||
    text === "unavailable" ||
    text === "unknown" ||
    text === "none" ||
    text === "nan"
  ) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

interface RoleRecord {
  role: SensorRole;
  entityId: string;
  lastReportAt?: number;
  lastValidValue?: number;
  lastValidAt?: number;
  fault?: { reason: SensorFaultReason; since: number };
  timeoutTimer?: unknown;
  reminderTimer?: unknown;
}

interface ConnectionFault {
  since: number;
}

export class SensorHealthMonitor {
  private readonly records: Record<SensorRole, RoleRecord>;
  private connectionFault?: ConnectionFault;
  private readonly reportTimeoutMs: number;
  private readonly dailyReminderMs: number;
  private readonly scheduler: Scheduler;
  private readonly notifier: Notifier;
  private readonly logger: LoggerService;
  private readonly nowFn: () => number;
  private readonly readReport?: SensorHealthOptions["readReport"];
  private disposed = false;

  constructor(private readonly options: SensorHealthOptions) {
    this.reportTimeoutMs =
      options.reportTimeoutMs ?? DEFAULT_SENSOR_REPORT_TIMEOUT_MS;
    this.dailyReminderMs = options.dailyReminderMs ?? DEFAULT_DAILY_REMINDER_MS;
    this.scheduler = options.scheduler ?? schedulerOrDefault;
    this.notifier = options.notifier ?? new NullNotifier();
    this.logger = options.logger;
    this.nowFn = options.now ?? (() => Date.now());
    this.readReport = options.readReport;
    this.records = {
      hall: { role: "hall", entityId: options.entityIds.hall },
      outdoor: { role: "outdoor", entityId: options.entityIds.outdoor },
    };
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  /**
   * Record a confirmed report from Home Assistant.
   *
   * A report whose timestamp does not advance (same state re-read) is ignored:
   * freshness is never extended by re-reading cached state.
   */
  report(role: SensorRole, report: SensorReport): void {
    if (this.disposed) return;
    const at = report.reportedAt?.getTime();
    if (!Number.isFinite(at)) return;
    this.applyReport(role, report.rawState, at);
  }

  /** The sensor has no readable report at all (startup/entity missing). */
  noteNoReading(role: SensorRole): void {
    if (this.disposed) return;
    this.enterFault(role, "no-reading");
  }

  private applyReport(role: SensorRole, rawState: string, at: number): void {
    const record = this.records[role];
    if (record.lastReportAt !== undefined && at <= record.lastReportAt) {
      this.logger.debug("📊 Repeated (cached) sensor read - freshness unchanged", {
        role,
        entityId: record.entityId,
        reportedAt: new Date(at).toISOString(),
        lastReportAt: new Date(record.lastReportAt).toISOString(),
      });
      return;
    }

    record.lastReportAt = at;
    this.clearTimeoutTimer(record);
    this.armTimeoutTimer(record);

    const value = parseSensorReading(rawState);
    if (value === undefined) {
      this.enterFault(role, "invalid");
      return;
    }

    record.lastValidValue = value;
    record.lastValidAt = at;
    this.recover(role, value);
  }

  // -------------------------------------------------------------------------
  // Fault lifecycle
  // -------------------------------------------------------------------------

  /**
   * Deliver one alert without ever letting a transport failure escape.
   *
   * The `Notifier` contract is "send must never throw"; this also swallows a
   * rejected promise, so a failing transport cannot surface as an unhandled
   * rejection (nor affect HVAC control) even if a transport misbehaves.
   */
  private notify(message: string): void {
    this.notifier.send(message).catch((error) => {
      this.logger.warning(
        "⚠️ Alert delivery failed - degraded mode continues without the notification",
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
  }

  private enterFault(role: SensorRole, reason: SensorFaultReason): void {
    const record = this.records[role];
    if (record.fault) {
      // One alert per fault episode - a persisting fault is not re-announced
      // on every evaluation (the daily reminder covers persistence).
      return;
    }

    record.fault = { reason, since: this.nowFn() };
    this.logger.warning("🚨 Sensor fault detected - degraded mode", {
      role,
      entityId: record.entityId,
      reason,
      lastValidValue: record.lastValidValue,
      lastReportAt:
        record.lastReportAt !== undefined
          ? new Date(record.lastReportAt).toISOString()
          : "never",
    });

    this.notify(this.faultMessage(role, reason));
    this.armReminderTimer(record);
  }

  private recover(role: SensorRole, value: number): void {
    const record = this.records[role];
    if (!record.fault) return;

    const faultedForMs = this.nowFn() - record.fault.since;
    record.fault = undefined;
    this.clearReminderTimer(record);

    this.logger.info("✅ Sensor recovered - leaving degraded mode", {
      role,
      entityId: record.entityId,
      value,
      faultedForMs,
    });

    this.notify(this.recoveryMessage(role, value));
  }

  /** Home Assistant became unreachable: alert once, never claim success. */
  noteHaDisconnected(): void {
    if (this.disposed || this.connectionFault) return;
    this.connectionFault = { since: this.nowFn() };
    this.logger.warning("🚨 Home Assistant connection lost", {
      reason:
        "commands cannot be confirmed and the schedule cutoff is not guaranteed while unreachable",
    });
    this.notify(
      "HAG: Home Assistant connection lost — HVAC commands cannot be confirmed and the " +
        "schedule cutoff is not guaranteed until the connection returns. Retrying.",
    );
  }

  /** Home Assistant is reachable again: recovery notification. */
  noteHaConnected(): void {
    if (this.disposed || !this.connectionFault) return;
    const outageMs = this.nowFn() - this.connectionFault.since;
    this.connectionFault = undefined;
    this.logger.info("✅ Home Assistant reconnected", { outageMs });
    this.notify(
      "HAG: Home Assistant reconnected — reading actual device and sensor state and " +
        "reconciling with the current schedule.",
    );
  }

  // -------------------------------------------------------------------------
  // Timers (fault timing only - never an HVAC evaluation)
  // -------------------------------------------------------------------------

  private armTimeoutTimer(record: RoleRecord): void {
    this.clearTimeoutTimer(record);
    record.timeoutTimer = this.scheduler.setTimeout(() => {
      record.timeoutTimer = undefined;
      void this.checkFreshness(record.role);
    }, this.reportTimeoutMs);
  }

  private clearTimeoutTimer(record: RoleRecord): void {
    if (record.timeoutTimer !== undefined) {
      this.scheduler.clearTimeout(record.timeoutTimer);
      record.timeoutTimer = undefined;
    }
  }

  private armReminderTimer(record: RoleRecord): void {
    this.clearReminderTimer(record);
    record.reminderTimer = this.scheduler.setTimeout(() => {
      record.reminderTimer = undefined;
      if (!record.fault) return;
      this.notify(this.reminderMessage(record));
      // Re-arm only while the fault persists.
      this.armReminderTimer(record);
    }, this.dailyReminderMs);
  }

  private clearReminderTimer(record: RoleRecord): void {
    if (record.reminderTimer !== undefined) {
      this.scheduler.clearTimeout(record.reminderTimer);
      record.reminderTimer = undefined;
    }
  }

  /**
   * Reporting timeout elapsed: ask Home Assistant for the sensor's current
   * report timestamp before declaring a silent fault. A sensor that keeps
   * reporting the same value therefore stays healthy.
   */
  private async checkFreshness(role: SensorRole): Promise<void> {
    if (this.disposed) return;
    const record = this.records[role];
    if (record.fault) return;

    if (this.readReport) {
      try {
        const latest = await this.readReport(role, record.entityId);
        if (latest) this.report(role, latest);
      } catch (error) {
        this.logger.debug("🔌 Sensor freshness probe failed", {
          role,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.disposed || record.fault) return;

    const now = this.nowFn();
    if (
      record.lastReportAt === undefined ||
      now - record.lastReportAt >= this.reportTimeoutMs
    ) {
      this.enterFault(role, "silent");
      return;
    }

    // Still reporting: check again one timeout later.
    this.armTimeoutTimer(record);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  isDegraded(role: SensorRole): boolean {
    return !!this.records[role].fault;
  }

  /** Retained last-valid outdoor value, labelled as stale fallback data. */
  effectiveOutdoorTemp(): { value?: number; staleFallback: boolean } {
    const record = this.records.outdoor;
    if (record.lastValidValue === undefined) {
      return { value: undefined, staleFallback: false };
    }
    return {
      value: record.lastValidValue,
      staleFallback: !!record.fault,
    };
  }

  /** Last valid hall value, if any (retained only - never fabricated). */
  lastValidHallTemp(): number | undefined {
    return this.records.hall.lastValidValue;
  }

  sensorState(role: SensorRole): SensorHealthState {
    const record = this.records[role];
    return {
      role,
      entityId: record.entityId,
      degraded: !!record.fault,
      reason: record.fault?.reason,
      faultSince: record.fault
        ? new Date(record.fault.since).toISOString()
        : undefined,
      lastReportAt:
        record.lastReportAt !== undefined
          ? new Date(record.lastReportAt).toISOString()
          : undefined,
      lastValidValue: record.lastValidValue,
      lastValidAt:
        record.lastValidAt !== undefined
          ? new Date(record.lastValidAt).toISOString()
          : undefined,
      retainedFallback: !!record.fault && record.lastValidValue !== undefined,
    };
  }

  status(): DegradedStatus {
    const sources: DegradedStatus["sources"] = [];
    for (const role of ["hall", "outdoor"] as SensorRole[]) {
      const fault = this.records[role].fault;
      if (fault) {
        sources.push({
          source: role,
          reason: fault.reason,
          since: new Date(fault.since).toISOString(),
        });
      }
    }
    if (this.connectionFault) {
      sources.push({
        source: "ha-connection",
        reason: "no-reading",
        since: new Date(this.connectionFault.since).toISOString(),
      });
    }

    return {
      degraded: sources.length > 0,
      sources,
      sensors: [this.sensorState("hall"), this.sensorState("outdoor")],
    };
  }

  // -------------------------------------------------------------------------
  // Alert bodies
  // -------------------------------------------------------------------------

  private faultMessage(role: SensorRole, reason: SensorFaultReason): string {
    const record = this.records[role];
    const label = role === "hall" ? "hall temperature" : "outdoor temperature";

    if (role === "hall") {
      return (
        `HAG: ${label} sensor fault (${reason}) — degraded mode active. ` +
        "Running ACs keep their targets until the sensor recovers; no automatic " +
        "shutdown; the schedule cutoff is still enforced."
      );
    }

    const retained = record.lastValidValue;
    return (
      `HAG: ${label} sensor fault (${reason}) — degraded mode active. ` +
      (retained !== undefined
        ? `Retaining last valid ${retained} °C as stale fallback for heating start ` +
          "eligibility and room selection. "
        : "No valid outdoor reading yet: no new automatic heating starts until one arrives. ")
    );
  }

  private reminderMessage(record: RoleRecord): string {
    const minutes = Math.round((this.nowFn() - record.fault!.since) / 60000);
    const label = record.role === "hall" ? "hall temperature" : "outdoor temperature";
    return (
      `HAG: ${label} sensor fault still active after ${minutes} min — degraded mode ` +
      "continues. Schedule cutoff remains enforced."
    );
  }

  private recoveryMessage(role: SensorRole, value: number): string {
    const label = role === "hall" ? "hall temperature" : "outdoor temperature";
    return (
      `HAG: ${label} sensor recovered (${value} °C) — leaving degraded mode and ` +
      "reevaluating normal heating rules and the schedule."
    );
  }

  /** Cancel every pending timer (controller/state-machine shutdown). */
  dispose(): void {
    this.disposed = true;
    for (const role of ["hall", "outdoor"] as SensorRole[]) {
      this.clearTimeoutTimer(this.records[role]);
      this.clearReminderTimer(this.records[role]);
    }
  }
}
