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
 *  - alerts: the initial alert for a fault episode is sent only once the same
 *    episode has been continuously active for the configured notification
 *    grace (approved default: one hour) *after detection* — a fault that
 *    resolves inside the window produces neither a fault nor a recovery
 *    message. Once the onset alert has been issued: one daily reminder while
 *    the fault persists (cadence anchored to the sent onset) and one recovery
 *    notification. Exactly one of each, no per-evaluation spam.
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
  /**
   * Notification grace window (approved policy): the initial fault alert for
   * an episode is sent only once the same episode has been continuously
   * active for this long *after detection*. A fault that resolves inside the
   * window sends neither a fault nor a recovery message. `0` disables the
   * debounce (alert immediately, the pre-policy behaviour).
   *
   * Detection, logging and degraded mode are unaffected: they stay immediate.
   */
  notificationGraceMs?: number;
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
  /**
   * Called exactly once per recovery with the first confirmed fresh, valid
   * value that ended degraded mode. The monitor itself never evaluates HVAC
   * rules; the controller uses this to route a probe-detected recovery (a
   * fresh report is not a state change, so no `state_changed` event follows)
   * into the same evaluation the ordinary sensor-change path performs.
   */
  onRecovery?: (role: SensorRole, validValue: number) => void;
  /**
   * Calibration applied to a valid parsed reading before it is retained as the
   * last-valid value / fallback. Live evaluations calibrate fresh readings the
   * same way, so the retained fallback must never use the raw value.
   */
  calibrate?: (role: SensorRole, value: number) => number;
}

export const DEFAULT_SENSOR_REPORT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_DAILY_REMINDER_MS = 24 * 60 * 60 * 1000;
/**
 * Approved notification debounce: the initial Telegram fault alert (hall,
 * outdoor or Home Assistant connection) is sent only when the same fault
 * episode has been continuously active for one hour after detection. A fault
 * that resolves inside the window is announced with neither a fault nor a
 * recovery message. Detection, logging and degraded mode stay immediate.
 */
export const DEFAULT_NOTIFICATION_GRACE_MS = 60 * 60 * 1000;
/**
 * Backoff between freshness probe retries: a single failed REST read at the
 * timeout instant is inconclusive, not evidence of silence. The retry fires
 * long before the next full reporting timeout would, so a healthy-but-unchanged
 * sensor is re-checked quickly and is not declared silent on the throw.
 */
export const PROBE_RETRY_BACKOFF_MS = 60 * 1000;

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
  fault?: EpisodeFault;
  timeoutTimer?: unknown;
  reminderTimer?: unknown;
  /**
   * Set when the last freshness probe failed and the check was inconclusive:
   * the next probe decides the fault instead of a single thrown REST read.
   */
  probeRetryArmed?: boolean;
}

/**
 * A fault episode and its notification state.
 *
 * The object identity is the episode identity: a stale timer callback or a
 * late reason change can only ever act on the episode it was armed for
 * (`record.fault === episode`), so a callback from a recovered or superseded
 * episode can never send an alert.
 */
interface FaultEpisode {
  since: number;
  /** Pending notification-grace timer for this episode's onset alert. */
  graceTimer?: unknown;
  /**
   * Set when this episode survived the notification grace window and its onset
   * alert was issued (with `notificationGraceMs` at or below zero: immediately
   * at detection). Gates the recovery notification and the daily reminders, so
   * a fault that resolved inside the grace window is announced with neither.
   *
   * Whether the transport actually delivered the message is the transport's
   * own truth (`Notifier.send` never rejects; a failure is logged): the
   * monitor never claims delivery, and it never retries a failed send, so a
   * broken route cannot turn into alert spam.
   */
  alertIssued?: boolean;
}

interface EpisodeFault extends FaultEpisode {
  reason: SensorFaultReason;
}

/** The Home Assistant connection outage is an episode without a reason. */
type ConnectionFault = FaultEpisode;

export class SensorHealthMonitor {
  private readonly records: Record<SensorRole, RoleRecord>;
  private connectionFault?: ConnectionFault;
  private readonly reportTimeoutMs: number;
  private readonly dailyReminderMs: number;
  private readonly notificationGraceMs: number;
  private readonly scheduler: Scheduler;
  private readonly notifier: Notifier;
  private readonly logger: LoggerService;
  private readonly nowFn: () => number;
  private readonly readReport?: SensorHealthOptions["readReport"];
  private readonly onRecovery?: SensorHealthOptions["onRecovery"];
  private readonly calibrate?: SensorHealthOptions["calibrate"];
  private disposed = false;

  constructor(private readonly options: SensorHealthOptions) {
    this.reportTimeoutMs =
      options.reportTimeoutMs ?? DEFAULT_SENSOR_REPORT_TIMEOUT_MS;
    this.dailyReminderMs = options.dailyReminderMs ?? DEFAULT_DAILY_REMINDER_MS;
    this.notificationGraceMs =
      options.notificationGraceMs ?? DEFAULT_NOTIFICATION_GRACE_MS;
    this.scheduler = options.scheduler ?? schedulerOrDefault;
    this.notifier = options.notifier ?? new NullNotifier();
    this.logger = options.logger;
    this.nowFn = options.now ?? (() => Date.now());
    this.readReport = options.readReport;
    this.onRecovery = options.onRecovery;
    this.calibrate = options.calibrate;
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

    // The retained value is stored calibrated: live evaluations calibrate fresh
    // readings, so the fallback must not silently diverge from them.
    const stored = this.calibrate ? this.calibrate(role, value) : value;
    record.lastValidValue = stored;
    record.lastValidAt = at;
    this.recover(role, stored);
  }

  // -------------------------------------------------------------------------
  // Fault lifecycle
  // -------------------------------------------------------------------------

  /**
   * Deliver one alert without ever letting a transport failure escape.
   *
   * The `Notifier` contract is "send must never throw"; this also swallows a
   * rejected promise, so a failing transport cannot surface as an unhandled
   * rejection (nor affect HVAC control) even if a transport misbehaves. A
   * failed delivery is reported as a failure and never claimed as delivered;
   * it is not retried, so a broken route cannot become an alert loop.
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
      // on every evaluation (the daily reminder covers persistence), and a
      // reason change never restarts the notification grace window. The reason
      // is updated in place (the alerts use the current reason) without a
      // second onset alert and without resetting the episode start.
      if (record.fault.reason !== reason) {
        this.logger.warning("🚨 Sensor fault reason changed", {
          role,
          entityId: record.entityId,
          previousReason: record.fault.reason,
          reason,
        });
        record.fault.reason = reason;
      }
      return;
    }

    const fault: EpisodeFault = { reason, since: this.nowFn() };
    record.fault = fault;
    this.logger.warning("🚨 Sensor fault detected - degraded mode", {
      role,
      entityId: record.entityId,
      reason,
      lastValidValue: record.lastValidValue,
      lastReportAt:
        record.lastReportAt !== undefined
          ? new Date(record.lastReportAt).toISOString()
          : "never",
      // Approved notification policy: the alert waits for the grace window.
      notificationGraceMs: this.notificationGraceMs,
    });

    this.armGraceTimer(record, fault);
  }

  private recover(role: SensorRole, value: number): void {
    const record = this.records[role];
    const fault = record.fault;
    if (!fault) return;

    const faultedForMs = this.nowFn() - fault.since;
    const alertIssued = !!fault.alertIssued;
    record.fault = undefined;
    record.probeRetryArmed = undefined;
    // Timers die with the episode: a pending grace timer can no longer fire
    // (its callback also re-checks the episode identity), nor can a reminder.
    this.clearGraceTimer(fault);
    this.clearReminderTimer(record);

    this.logger.info("✅ Sensor recovered - leaving degraded mode", {
      role,
      entityId: record.entityId,
      value,
      faultedForMs,
      alertIssued,
    });

    // A fault that resolved inside the notification grace window was never
    // announced: it gets neither a fault nor a recovery message.
    if (alertIssued) this.notify(this.recoveryMessage(role, value));
    // The evaluation itself is not the monitor's business: the controller
    // routes a probe-detected recovery (no state_changed event exists for it)
    // into the same evaluation an ordinary sensor change gets.
    this.onRecovery?.(role, value);
  }

  /**
   * Home Assistant became unreachable: detect immediately, alert only if the
   * outage outlives the notification grace window.
   */
  noteHaDisconnected(): void {
    if (this.disposed || this.connectionFault) return;
    const fault: ConnectionFault = { since: this.nowFn() };
    this.connectionFault = fault;
    this.logger.warning("🚨 Home Assistant connection lost", {
      reason:
        "commands cannot be confirmed and the schedule cutoff is not guaranteed while unreachable",
      notificationGraceMs: this.notificationGraceMs,
    });
    this.armConnectionGraceTimer(fault);
  }

  /** Home Assistant is reachable again: recovery notification. */
  noteHaConnected(): void {
    if (this.disposed || !this.connectionFault) return;
    const fault = this.connectionFault;
    const outageMs = this.nowFn() - fault.since;
    const alertIssued = !!fault.alertIssued;
    this.connectionFault = undefined;
    this.clearGraceTimer(fault);
    this.logger.info("✅ Home Assistant reconnected", { outageMs, alertIssued });
    // An outage that ended inside the grace window was never announced: it gets
    // neither an outage nor a recovery message.
    if (!alertIssued) return;
    this.notify(
      "HAG: Home Assistant reconnected — reading actual device and sensor state and " +
        "reconciling with the current schedule.",
    );
  }

  // -------------------------------------------------------------------------
  // Notification grace (the onset alert waits for a continuous episode)
  // -------------------------------------------------------------------------

  /**
   * Arm the onset alert for a fresh episode.
   *
   * The alert is only issued if the *same* episode is still active when the
   * window closes: a recovery (or a new episode) clears this timer and makes
   * the callback a no-op. `notificationGraceMs <= 0` disables the debounce and
   * alerts immediately.
   */
  private armGraceTimer(record: RoleRecord, fault: EpisodeFault): void {
    this.clearGraceTimer(fault);
    if (this.notificationGraceMs <= 0) {
      this.announceSensorOnset(record, fault);
      return;
    }
    fault.graceTimer = this.scheduler.setTimeout(() => {
      fault.graceTimer = undefined;
      // Stale-callback guard: disposed, recovered or already superseded.
      if (this.disposed || record.fault !== fault) return;
      this.announceSensorOnset(record, fault);
    }, this.notificationGraceMs);
  }

  private armConnectionGraceTimer(fault: ConnectionFault): void {
    this.clearGraceTimer(fault);
    if (this.notificationGraceMs <= 0) {
      this.announceConnectionOutage(fault);
      return;
    }
    fault.graceTimer = this.scheduler.setTimeout(() => {
      fault.graceTimer = undefined;
      if (this.disposed || this.connectionFault !== fault) return;
      this.announceConnectionOutage(fault);
    }, this.notificationGraceMs);
  }

  private clearGraceTimer(fault: FaultEpisode | undefined): void {
    if (fault?.graceTimer !== undefined) {
      this.scheduler.clearTimeout(fault.graceTimer);
      fault.graceTimer = undefined;
    }
  }

  /**
   * Issue the onset alert for an episode that survived the grace window and
   * start the reminder cadence anchored to this instant. Exactly one onset per
   * episode.
   */
  private announceSensorOnset(record: RoleRecord, fault: EpisodeFault): void {
    if (fault.alertIssued) return;
    fault.alertIssued = true;
    this.notify(this.faultMessage(record.role, fault.reason));
    this.armReminderTimer(record, fault);
  }

  private announceConnectionOutage(fault: ConnectionFault): void {
    if (fault.alertIssued) return;
    fault.alertIssued = true;
    this.notify(
      "HAG: Home Assistant connection lost — HVAC commands cannot be confirmed and the " +
        "schedule cutoff is not guaranteed until the connection returns. Retrying.",
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

  private armReminderTimer(record: RoleRecord, fault: EpisodeFault): void {
    this.clearReminderTimer(record);
    record.reminderTimer = this.scheduler.setTimeout(() => {
      record.reminderTimer = undefined;
      // Stale-callback guard: the episode may have recovered, been superseded
      // by a new one, or the monitor may have been disposed.
      if (this.disposed || record.fault !== fault) return;
      this.notify(this.reminderMessage(record, fault));
      // Re-arm only while the same episode persists.
      this.armReminderTimer(record, fault);
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
   *
   * The probe cycle also runs while a fault is active: HA `state_changed`
   * fires only on value changes, so a sensor that resumes reporting the SAME
   * value (last_reported advancing) is otherwise invisible and degraded mode
   * would stick. A probe-detected fresh, valid report recovers through
   * `report()` -> `recover()` (which also fires the recovery evaluation hook).
   */
  private async checkFreshness(role: SensorRole): Promise<void> {
    if (this.disposed) return;
    const record = this.records[role];

    if (this.readReport) {
      let probed = false;
      try {
        const latest = await this.readReport(role, record.entityId);
        if (latest) this.report(role, latest);
        probed = true;
      } catch (error) {
        this.logger.debug("🔌 Sensor freshness probe failed", {
          role,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (this.disposed) return;

      if (!probed && !record.fault && !record.probeRetryArmed) {
        // A single thrown REST read is inconclusive, not evidence of silence:
        // retry quickly (backoff) before the silent fault is declared.
        record.probeRetryArmed = true;
        this.clearTimeoutTimer(record);
        record.timeoutTimer = this.scheduler.setTimeout(() => {
          record.timeoutTimer = undefined;
          void this.checkFreshness(record.role);
        }, PROBE_RETRY_BACKOFF_MS);
        return;
      }
    }

    if (this.disposed) return;
    record.probeRetryArmed = undefined;

    const now = this.nowFn();
    const stale =
      record.lastReportAt === undefined ||
      now - record.lastReportAt >= this.reportTimeoutMs;

    if (stale) {
      if (!record.fault) {
        this.enterFault(role, "silent");
      }
      // While silent, keep the probe cycle alive so a resumed report (even a
      // same-value one) is seen at the next timeout.
      if (this.readReport) this.armTimeoutTimer(record);
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

  private reminderMessage(record: RoleRecord, fault: EpisodeFault): string {
    const minutes = Math.round((this.nowFn() - fault.since) / 60000);
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
      const record = this.records[role];
      // Pending notification grace windows die with the monitor: no alert may
      // be issued after disposal.
      this.clearGraceTimer(record.fault);
      this.clearTimeoutTimer(record);
      this.clearReminderTimer(record);
    }
    this.clearGraceTimer(this.connectionFault);
  }
}
