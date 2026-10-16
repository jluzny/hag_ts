/**
 * Shared offline test harness for the HVAC state machine (issue 1 / issue 5 tests).
 *
 * Fully offline: a fake Home Assistant client records service intent, a fake
 * clock drives xstate one-shot timers, and the wall clock is pinned with
 * bun:test setSystemTime(). No Home Assistant, network or device is contacted.
 *
 * Extracted unchanged from tests/unit/hvac/defrost-restoration.test.ts so the
 * temperature-validity regressions reuse the same harness.
 */

import { setSystemTime } from "bun:test";
import { createActor } from "xstate";
import { createHVACMachine } from "../../../src/hvac/state-machine.ts";
import {
  SensorHealthMonitor,
  type SensorHealthOptions,
} from "../../../src/hvac/sensor-health.ts";
import { type Notifier } from "../../../src/hvac/notifier.ts";
import { type HvacOptions } from "../../../src/config/config.ts";
import { SystemMode } from "../../../src/types/common.ts";
import { LoggerService } from "../../../src/core/logging.ts";
import { HomeAssistantClient } from "../../../src/home-assistant/client.ts";
import { HassServiceCallImpl, HassStateImpl } from "../../../src/home-assistant/models.ts";

// ---------------------------------------------------------------------------
// Deterministic fake clock (xstate actor `clock` option)
// ---------------------------------------------------------------------------

export class FakeClock {
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

export interface RecordedCall {
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
}

/**
 * Test-side mirror of the production client's abandoned-batch handling: settle
 * with `promise`, but stop as soon as `signal` aborts (the production client
 * does this around its REST state read).
 */
export const raceSignal = <T>(
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

export class FakeHomeAssistantClient extends HomeAssistantClient {
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

export const LIVING_ROOM = "climate.living_room_ac"; // enabled, defrost: true
export const BEDROOM = "climate.bedroom_ac"; // enabled, defrost: false
export const DISABLED = "climate.disabled_ac"; // disabled, defrost: true

export const DURATION_MS = 300 * 1000; // production durationSeconds
export const PERIOD_MS = 7200 * 1000; // production periodSeconds

/** Local wall clock start: Thursday 2026-01-15 10:00 (inside production active hours). */
export const BASE_DATE = new Date(2026, 0, 15, 10, 0, 0);

export const makeOptions = (overrides: Partial<HvacOptions> = {}): HvacOptions =>
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

export class Harness {
  readonly clock = new FakeClock();
  readonly ha = new FakeHomeAssistantClient();
  // Deliberately loosely typed: these tests drive raw xstate actors directly.
  readonly actor: any;
  private readonly startMs: number;
  /** Issue 2: the shared sensor-health monitor, when one was injected. */
  readonly health?: SensorHealthMonitor;

  constructor(
    options: HvacOptions = makeOptions(),
    deps: {
      /**
       * Sensor-health monitor factory. It receives the harness clock so monitor
       * timers (report timeout, daily reminder) advance with `harness.advance()`.
       */
      sensorHealth?: (clock: FakeClock) => SensorHealthMonitor;
    } = {},
  ) {
    this.startMs = Date.now(); // the caller pins the wall clock before construction
    this.health = deps.sensorHealth?.(this.clock);
    const machine = createHVACMachine(
      options,
      new LoggerService("test.defrost"),
      this.ha,
      undefined,
      undefined,
      this.health,
    );
    this.actor = createActor(machine as any, { clock: this.clock as any });
    this.actor.start();
  }

  get state(): string {
    return this.actor.getSnapshot().value as string;
  }

  get context(): Record<string, unknown> {
    return this.actor.getSnapshot().context as Record<string, unknown>;
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

  /**
   * Issue 2: Home Assistant reconnect with the unit states the controller
   * actually observed on the device.
   */
  sendReconnected(
    observedUnits: Array<{ entityId: string; state: string }> = [],
  ): void {
    this.actor.send({ type: "HA_RECONNECTED", observedUnits } as never);
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

/** Recorded alert bodies; nothing leaves the process. */
export class RecordingNotifier implements Notifier {
  readonly messages: string[] = [];

  async send(message: string): Promise<void> {
    this.messages.push(message);
  }
}

/** A notifier whose transport always fails - must never break HVAC control. */
export class FailingNotifier implements Notifier {
  readonly messages: string[] = [];

  async send(message: string): Promise<void> {
    this.messages.push(message);
    throw new Error("simulated transport failure");
  }
}

/**
 * Build an issue-2 sensor-health monitor wired to the harness fake clock.
 *
 * `now` follows the pinned wall clock (bun:test setSystemTime), which
 * `Harness.advance()` keeps in step with virtual time.
 */
export const makeSensorHealth = (
  options: HvacOptions,
  deps: {
    clock: FakeClock;
    notifier?: Notifier;
    readReport?: SensorHealthOptions["readReport"];
    reportTimeoutMs?: number;
    dailyReminderMs?: number;
    /**
     * Notification grace window in ms. `0` (used by the fixtures that pin the
     * per-episode alert cadence rather than the debounce) alerts immediately;
     * omitted means the monitor's production default (one hour).
     */
    notificationGraceMs?: number;
    logger?: LoggerService;
    /** Probe-decided recovery hook (issue 2 review round 1, F1). */
    onRecovery?: SensorHealthOptions["onRecovery"];
    /** Calibration map applied before a valid value is retained (F5). */
    calibrate?: SensorHealthOptions["calibrate"];
  },
): SensorHealthMonitor =>
  new SensorHealthMonitor({
    entityIds: { hall: options.tempSensor, outdoor: options.outdoorSensor },
    scheduler: {
      setTimeout: (fn, ms) => deps.clock.setTimeout(fn, ms),
      clearTimeout: (id) => deps.clock.clearTimeout(id as number),
    },
    notifier: deps.notifier,
    readReport: deps.readReport,
    reportTimeoutMs: deps.reportTimeoutMs,
    dailyReminderMs: deps.dailyReminderMs,
    notificationGraceMs: deps.notificationGraceMs,
    onRecovery: deps.onRecovery,
    calibrate: deps.calibrate,
    logger: deps.logger ?? new LoggerService("test.sensor-health"),
  });

/** Let queued promises / async xstate actions settle. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/**
 * Poll `predicate()` with real timers until it is true (bounded retries and
 * deferred client promises use real timers, so the pinned wall clock must not
 * be used for the deadline).
 */
export const waitUntil = async (
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
