/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import { ActorRefFrom, assign, cancel, createActor, createMachine, sendTo } from "xstate";
import { injectable } from "@needle-di/core";
import { type HvacOptions } from "../config/config.ts";
import {
  HVACContext,
  HVACMode,
  StateChangeData,
  SystemMode,
  type HvacEntity,
} from "../types/common.ts";
import { StateError } from "../core/exceptions.ts";
import { LoggerService } from "../core/logging.ts";
import {
  HomeAssistantClient,
  deriveTemperatureSensor,
} from "../home-assistant/client.ts";
import { CyclingMonitor } from "./cycling-monitor.ts";

/**
 * Simplified HVAC events that can trigger state transitions
 */
export type HVACEvent =
  | {
      type: "MODE_CHANGE";
      mode: HVACMode;
      temperature?: number;
      presetMode?: string;
    }
  | { type: "AUTO_EVALUATE" }
  | { type: "DEFROST_NEEDED" }
  | { type: "DEFROST_COMPLETE" }
  /** One-shot defrost reevaluation (post-completion and after the configured period). */
  | { type: "DEFROST_REEVALUATE" }
  | { type: "OFF" }
  | {
      type: "UPDATE_CONDITIONS";
      data: Partial<HVACContext>;
      eventSource?: {
        type: string;
        entityId?: string;
        newValue?: string;
        [key: string]: any;
      };
    }
  | { type: "MANUAL_OVERRIDE"; mode: HVACMode; temperature?: number };

/**
 * State machine type definitions
 */
export type HVACMachine = ReturnType<typeof createHVACMachine>;
export type HVACMachineActor = ActorRefFrom<HVACMachine>;

/**
 * HVAC evaluation result
 */
export interface HVACEvaluation {
  shouldHeat: boolean;
  shouldCool: boolean;
  needsDefrost: boolean;
  shouldTurnOff: boolean;
  reason: string;
}

/**
 * Unified HVAC strategy for heating and cooling logic
 */
export class HVACStrategy {
  private lastDefrost?: Date;
  private logger = new LoggerService("HAG.hvac.strategy");
  private evaluationCache?: {
    input: string;
    result: HVACEvaluation;
    timestamp: number;
  };
  public cyclingMonitor: CyclingMonitor;

  constructor(private hvacOptions: HvacOptions) {
    this.cyclingMonitor = new CyclingMonitor(this.logger);
  }

  public getCyclingMonitor(): CyclingMonitor {
    return this.cyclingMonitor;
  }

  public logCyclingHealth(): void {
    this.cyclingMonitor.logHealthStatus();
  }

  /**
   * Unified evaluation method that returns all condition checks
   */
  evaluateConditions(data: StateChangeData): HVACEvaluation {
    interface HVACReason {
      code: string;
      description: string;
      getLogData?: (data: StateChangeData) => Record<string, unknown>;
    }

    const inputKey = JSON.stringify(data);
    const now = Date.now();

    // Cache check
    if (
      this.evaluationCache?.input === inputKey &&
      now - this.evaluationCache.timestamp < this.hvacOptions.evaluationCacheMs
    ) {
      return this.evaluationCache.result;
    }

    // Core evaluation
    const shouldHeat = this.shouldHeat(data);
    const shouldCool = this.shouldCool(data);
    const needsDefrost = this.needsDefrost(data);
    const shouldTurnOff = this.shouldTurnOff(data);

    // Unified reason construction
    const reason = ((): HVACReason => {
      const baseLogData = {
        currentConditions: {
          indoorTemp: `${data.currentTemp}°C`,
          outdoorTemp: `${data.weatherTemp}°C`,
          timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
        },
      };

      if (shouldTurnOff) {
        // Determine specific turn-off reason
        let turnOffReason = "comfortable temperature maintained";

        if (!this.isActiveHour(data.hour, data.isWeekday)) {
          turnOffReason = `outside active hours (${data.hour}:00)`;
        } else if (this.hasReachedMaximumTemperature(data) && !shouldCool) {
          turnOffReason = `heating target reached (${data.currentTemp}°C >= ${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C)`;
        } else if (shouldCool && this.hasReachedMinimumCoolingTemperature(data)) {
          // Only check cooling threshold if cooling was actually active
          turnOffReason = `cooling target reached (${data.currentTemp}°C <= ${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C)`;
        } else if (!shouldHeat && !shouldCool) {
          // More specific reason based on current temperature vs thresholds
          const heatingMin = this.hvacOptions.heating.temperatureThresholds.indoorMin;
          const heatingMax = this.hvacOptions.heating.temperatureThresholds.indoorMax;
          const coolingMin = this.hvacOptions.cooling.temperatureThresholds.indoorMin;
          const coolingMax = this.hvacOptions.cooling.temperatureThresholds.indoorMax;

          if (data.currentTemp >= heatingMin && data.currentTemp <= heatingMax) {
            turnOffReason = `temperature within heating hysteresis band (${data.currentTemp}°C between ${heatingMin}°C - ${heatingMax}°C)`;
          } else if (data.currentTemp >= coolingMin && data.currentTemp <= coolingMax) {
            turnOffReason = `temperature within cooling hysteresis band (${data.currentTemp}°C between ${coolingMin}°C - ${coolingMax}°C)`;
          } else if (data.currentTemp > heatingMax && data.currentTemp < coolingMin) {
            turnOffReason = `temperature in comfortable range (${data.currentTemp}°C between heating max ${heatingMax}°C and cooling min ${coolingMin}°C)`;
          } else {
            turnOffReason = `temperature maintained - no heating or cooling needed (${data.currentTemp}°C)`;
          }
        }

        return {
          code: "turning_off",
          description: `Turning off required - ${turnOffReason}`,
          getLogData: () => ({
            ...baseLogData,
            mode: "OFF",
            turnOffReason,
            activeHours: this.hvacOptions.activeHours,
            heatingRange: `${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C`,
            coolingRange: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.indoorMax}°C`,
          }),
        };
      }

      if (needsDefrost)
        return {
          code: "defrost_required",
          description: `Defrost needed - outdoor temp ${data.weatherTemp}°C below threshold`,
          getLogData: () => ({
            ...baseLogData,
            mode: "DEFROST",
          }),
        };

      if (shouldHeat) {
        const targetTemp = this.hvacOptions.heating.temperature;
        const minThreshold =
          this.hvacOptions.heating.temperatureThresholds.indoorMin;
        const maxThreshold =
          this.hvacOptions.heating.temperatureThresholds.indoorMax;
        const maxDiff = maxThreshold - data.currentTemp;

        return {
          code: "heating_required",
          description: `Heating - indoor ${data.currentTemp}°C is ${maxDiff.toFixed(1)}°C below maximum threshold (${maxThreshold}°C)`,
          getLogData: () => ({
            ...baseLogData,
            mode: "HEAT",
            thresholds: {
              targetTemp: `${targetTemp}°C`,
              minIndoor: `${minThreshold}°C`,
              maxIndoor: `${maxThreshold}°C`,
              outdoorRange: `${this.hvacOptions.heating.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.outdoorMax}°C`,
            },
            hysteresisBehavior: `Will continue heating until reaching ${maxThreshold}°C maximum threshold (target: ${targetTemp}°C)`,
          }),
        };
      }

      if (shouldCool) {
        const tempDiff =
          data.currentTemp -
          this.hvacOptions.cooling.temperatureThresholds.indoorMin;
        return {
          code: "cooling_required",
          description: `Cooling - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C above max`,
          getLogData: () => ({
            ...baseLogData,
            mode: "COOL",
            thresholds: {
              maxIndoor: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`,
              outdoorRange: `${this.hvacOptions.cooling.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.outdoorMax}°C`,
            },
          }),
        };
      }

      return {
        code: "no_action_needed",
        description: "All conditions satisfied - no HVAC action required",
      };
    })();

    // Unified logging with cycling detection
    const logData = reason.getLogData?.(data) || { data };

    // Add cycling prevention metrics
    if (
      reason.code === "no_action_needed" &&
      data.currentTemp >=
        this.hvacOptions.heating.temperatureThresholds.indoorMin &&
      data.currentTemp <=
        this.hvacOptions.heating.temperatureThresholds.indoorMax
    ) {
      logData.hysteresisStatus = "COMFORT_ZONE";
      logData.cyclingRisk = "LOW";
      logData.stabilityInfo = `Temperature in stable range (${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C)`;
    } else if (reason.code === "heating_required") {
      logData.hysteresisStatus = "HEATING_ACTIVE";
      logData.cyclingRisk = "MONITORING";
      logData.stabilityInfo = `Heating initiated below minimum threshold (${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C)`;
    }

    this.logger.info("🔍 HVAC Evaluation Result", {
      decision: reason.description,
      ...logData,
      timestamp: new Date().toISOString(),
    });

    // Result construction
    const result = {
      shouldHeat,
      shouldCool,
      needsDefrost,
      shouldTurnOff,
      reason: reason.code,
    };

    // Cache update
    this.evaluationCache = { input: inputKey, result, timestamp: now };
    return result;
  }

  private shouldHeat(data: StateChangeData): boolean {
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;
    const targetTemp = heating.temperature;

    // Check temperature conditions - comprehensive validation
    if (data.currentTemp >= thresholds.indoorMax) {
      this.logger.debug(
        "❌ Heating not activated - indoor temp at/above maximum",
        {
          currentTemp: `${data.currentTemp}°C`,
          maxThreshold: `${thresholds.indoorMax}°C`,
          targetTemp: `${targetTemp}°C`,
          reason: "Indoor temperature is already at or above maximum threshold",
        },
      );
      return false;
    }

    // Check if conditions are valid for heating
    if (!this.isValidCondition(data, thresholds)) {
      const timeReason = !this.isActiveHour(data.hour, data.isWeekday)
        ? `outside active hours (current: ${data.hour}:00)`
        : "within active hours";
      const tempReason = !this.isWithinTemperatureRange(data, thresholds)
        ? `outdoor temp ${data.weatherTemp}°C outside range ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C`
        : "outdoor temp within range";

      this.logger.debug("❌ Heating not activated - invalid conditions", {
        currentTemp: `${data.currentTemp}°C`,
        targetTemp: `${targetTemp}°C`,
        outdoorTemp: `${data.weatherTemp}°C`,
        timeCheck: timeReason,
        temperatureCheck: tempReason,
        reason: "Operating conditions not suitable for heating",
      });
      return false;
    }

    const shouldHeat = data.currentTemp < thresholds.indoorMin;

    if (shouldHeat) {
      this.logger.debug("✅ Heating conditions met", {
        currentTemp: `${data.currentTemp}°C`,
        targetTemp: `${targetTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempDeficit: `${(targetTemp - data.currentTemp).toFixed(1)}°C below target`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
        hysteresisInfo: `Heating will continue until reaching ${thresholds.indoorMax}°C maximum threshold (target: ${targetTemp}°C)`,
      });
    } else {
      this.logger.debug("ℹ️ Heating not needed", {
        currentTemp: `${data.currentTemp}°C`,
        targetTemp: `${targetTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        reason:
          data.currentTemp >= targetTemp
            ? "Temperature at or above target"
            : "Temperature above minimum threshold",
      });
    }

    return shouldHeat;
  }

  private shouldCool(data: StateChangeData): boolean {
    const { cooling } = this.hvacOptions;
    const thresholds = cooling.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp <= thresholds.indoorMin) {
      this.logger.debug(
        "❌ Cooling not activated - indoor temp at/below minimum",
        {
          currentTemp: `${data.currentTemp}°C`,
          minThreshold: `${thresholds.indoorMin}°C`,
          reason:
            "Indoor temperature is already at or below minimum cooling threshold",
        },
      );
      return false;
    }

    // Check if conditions are valid for cooling
    if (!this.isValidCondition(data, thresholds)) {
      const timeReason = !this.isActiveHour(data.hour, data.isWeekday)
        ? `outside active hours (current: ${data.hour}:00)`
        : "within active hours";
      const tempReason = !this.isWithinTemperatureRange(data, thresholds)
        ? `outdoor temp ${data.weatherTemp}°C outside range ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C`
        : "outdoor temp within range";

      this.logger.debug("❌ Cooling not activated - invalid conditions", {
        currentTemp: `${data.currentTemp}°C`,
        outdoorTemp: `${data.weatherTemp}°C`,
        timeCheck: timeReason,
        temperatureCheck: tempReason,
        reason: "Operating conditions not suitable for cooling",
      });
      return false;
    }

    const shouldCool = data.currentTemp > thresholds.indoorMin;

    if (shouldCool) {
      this.logger.debug("✅ Cooling conditions met", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempExcess: `${(data.currentTemp - thresholds.indoorMin).toFixed(1)}°C above minimum`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
      });
    } else {
      this.logger.debug("ℹ️ Cooling not needed", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempBelowMin: `${(thresholds.indoorMin - data.currentTemp).toFixed(1)}°C below minimum`,
      });
    }

    return shouldCool;
  }

  private needsDefrost(data: StateChangeData): boolean {
    const defrost = this.hvacOptions.heating.defrost;

    if (!defrost) {
      return false;
    }

    // A missing/non-finite outdoor reading is never a defrost signal
    // (zero and negative finite values are valid readings).
    if (!Number.isFinite(data.weatherTemp)) {
      return false;
    }

    // Check temperature threshold (at/below is defrost territory)
    if (data.weatherTemp > defrost.temperatureThreshold) {
      return false;
    }

    // Check time since last defrost (recorded at cycle completion, as legacy)
    if (this.lastDefrost) {
      const timeSinceDefrost = Date.now() - this.lastDefrost.getTime();
      const periodMs = defrost.periodSeconds * 1000;

      if (timeSinceDefrost < periodMs) {
        return false;
      }
    }

    return true;
  }

  /**
   * Defrost entry eligibility (restored legacy Kameo behaviour).
   *
   * Legacy `need_defrost_cycle` + `can_operate` gating:
   * - from an off/idle evaluation (`fromHeating === false`) heating demand is
   *   required as well (legacy `is_temp_too_low`);
   * - from an actively heating system only the operating conditions apply.
   *
   * Operating conditions are the active-hours window and a valid outdoor
   * reading inside the heating outdoor range — legacy `can_operate`. The
   * outdoor temperature must additionally be at/below the defrost threshold and
   * the configured period must have elapsed since the last completion.
   */
  public isDefrostEntryEligible(
    data: StateChangeData,
    fromHeating: boolean,
  ): boolean {
    const defrost = this.hvacOptions.heating.defrost;
    if (!defrost) {
      return false;
    }

    const reasons: string[] = [];
    const eligible = ((): boolean => {
      if (!Number.isFinite(data.weatherTemp)) {
        reasons.push("outdoor reading not finite");
        return false;
      }
      if (!this.isActiveHour(data.hour, data.isWeekday)) {
        reasons.push(`outside active hours (${data.hour}:00)`);
        return false;
      }
      if (
        !this.isWithinTemperatureRange(
          data,
          this.hvacOptions.heating.temperatureThresholds,
        )
      ) {
        reasons.push(
          `outdoor ${data.weatherTemp}°C outside operating range ${this.hvacOptions.heating.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.outdoorMax}°C`,
        );
        return false;
      }
      if (!this.needsDefrost(data)) {
        reasons.push(
          `outdoor ${data.weatherTemp}°C above threshold ${defrost.temperatureThreshold}°C or cycle period not elapsed`,
        );
        return false;
      }
      if (!fromHeating && !this.shouldHeat(data)) {
        reasons.push("no heating demand from off/idle");
        return false;
      }
      return true;
    })();

    this.logger.debug("🔍 Defrost eligibility check", {
      eligible,
      fromHeating,
      origin: fromHeating ? "active heating" : "off/idle",
      indoorTemp: `${data.currentTemp}°C`,
      outdoorTemp: `${data.weatherTemp}°C`,
      hour: data.hour,
      isWeekday: data.isWeekday,
      threshold: `${defrost.temperatureThreshold}°C`,
      periodSeconds: defrost.periodSeconds,
      lastDefrost: this.lastDefrost?.toISOString() ?? "never",
      reason: eligible ? "defrost cycle eligible" : reasons.join("; "),
    });

    return eligible;
  }

  /**
   * Entering a defrost cycle. The last-defrost timestamp is deliberately NOT
   * recorded here: legacy records it when the cycle completes, so the next
   * cycle's minimum interval is measured from completion.
   */
  startDefrost(): void {
    // Clear evaluation cache since internal state changed
    this.evaluationCache = undefined;

    this.logger.info("❄️ Defrost cycle started", {
      durationSeconds: this.hvacOptions.heating.defrost?.durationSeconds ?? 300,
    });
  }

  /**
   * Completing a defrost cycle: this is where the last-defrost timestamp is
   * recorded (legacy `stop_defrost`).
   */
  completeDefrost(): void {
    this.lastDefrost = new Date();
    // Clear evaluation cache since internal state changed
    this.evaluationCache = undefined;

    this.logger.info("✅ Defrost cycle completed", {
      completedAt: this.lastDefrost.toISOString(),
      nextEligibleInSeconds: this.hvacOptions.heating.defrost?.periodSeconds,
    });
  }

  /**
   * Ending a defrost cycle early (abort: manual off, explicit stop, schedule or
   * operating constraint violated).
   *
   * Legacy has no abort path — `Defrosting` only exits through `stop_defrost` —
   * so a cycle always recorded `defrost_last` when it ended. Recording it here
   * preserves that invariant: an aborted cycle must not allow the next cycle to
   * start immediately, and the next cycle's minimum interval is measured from
   * this end either way.
   */
  abortDefrostCycle(): void {
    this.lastDefrost = new Date();
    this.evaluationCache = undefined;

    this.logger.info("⏹️ Defrost cycle ended early", {
      endedAt: this.lastDefrost.toISOString(),
      nextEligibleInSeconds: this.hvacOptions.heating.defrost?.periodSeconds,
    });
  }

  /**
   * Unified validation logic for temperature and time conditions
   */
  private isValidCondition(
    data: StateChangeData,
    thresholds: { outdoorMin: number; outdoorMax: number },
  ): boolean {
    return (
      this.isWithinTemperatureRange(data, thresholds) &&
      this.isActiveHour(data.hour, data.isWeekday)
    );
  }

  private isWithinTemperatureRange(
    data: StateChangeData,
    thresholds: { outdoorMin: number; outdoorMax: number },
  ): boolean {
    return (
      data.weatherTemp >= thresholds.outdoorMin &&
      data.weatherTemp <= thresholds.outdoorMax
    );
  }

  /** Public so machine guards can enforce the schedule window (e.g. during defrost). */
  public isActiveHour(hour: number, isWeekday: boolean): boolean {
    const activeHours = this.hvacOptions.activeHours;
    if (!activeHours) return true;

    const start = isWeekday ? activeHours.startWeekday : activeHours.start;
    return hour >= start && hour < activeHours.end;
  }

  /**
   * Check if maximum temperature threshold has been reached (for proper hysteresis)
   */
  private hasReachedMaximumTemperature(data: StateChangeData): boolean {
    const maxThreshold =
      this.hvacOptions.heating.temperatureThresholds.indoorMax;
    const hasReachedMax = data.currentTemp >= maxThreshold;

    if (hasReachedMax) {
      this.logger.debug(
        "🎯 Maximum temperature reached - heating cycle complete",
        {
          currentTemp: `${data.currentTemp}°C`,
          maxThreshold: `${maxThreshold}°C`,
          targetTemp: `${this.hvacOptions.heating.temperature}°C`,
          difference: `${(data.currentTemp - maxThreshold).toFixed(1)}°C above maximum threshold`,
          hysteresisInfo: `Heating started at ${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C, stopping at ${maxThreshold}°C`,
        },
      );
    }

    return hasReachedMax;
  }

  /**
   * Check if we should turn off all entities
   */
  shouldTurnOff(data: StateChangeData): boolean {
    // Turn off if outside active hours
    if (!this.isActiveHour(data.hour, data.isWeekday)) {
      this.logger.debug("🕐 Turn off required - outside active hours", {
        currentHour: data.hour,
        isWeekday: data.isWeekday,
        activeHours: this.hvacOptions.activeHours,
      });
      return true;
    }

    // Turn off if maximum heating threshold reached (proper hysteresis)
    // But only if cooling is NOT needed — when it's hot enough to need cooling,
    // reaching the heating max is irrelevant and should not block the cooling transition
    if (this.hasReachedMaximumTemperature(data) && !this.shouldCool(data)) {
      this.logger.debug("🎯 Turn off heating - maximum threshold reached", {
        currentTemp: `${data.currentTemp}°C`,
        maxThreshold: `${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C`,
        targetTemp: `${this.hvacOptions.heating.temperature}°C`,
        reason: "Heating cycle completed - maximum threshold reached for anti-cycling",
      });
      return true;
    }

    // Turn off if minimum cooling threshold reached (proper hysteresis)
    // Only check if cooling is actually needed (system is in cooling mode)
    if (this.shouldCool(data) && this.hasReachedMinimumCoolingTemperature(data)) {
      this.logger.debug("🎯 Turn off cooling - minimum threshold reached", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`,
        targetTemp: `${this.hvacOptions.cooling.temperature}°C`,
        reason: "Cooling cycle completed - minimum threshold reached for anti-cycling",
      });
      return true;
    }

    // FIXED: Don't turn off when in comfortable range between thresholds
    // This prevents rapid cycling at boundary conditions
    this.logger.debug("🔄 Continue current operation - temperature within hysteresis range", {
      currentTemp: `${data.currentTemp}°C`,
      heatingRange: `${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.indoorMax}°C`,
      coolingRange: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.indoorMax}°C`,
      reason: "Temperature maintained within hysteresis bands - preventing rapid cycling",
    });

    return false;
  }

  /**
   * Check if minimum cooling temperature threshold has been reached
   */
  private hasReachedMinimumCoolingTemperature(data: StateChangeData): boolean {
    const minThreshold = this.hvacOptions.cooling.temperatureThresholds.indoorMin;
    const hasReachedMin = data.currentTemp <= minThreshold;

    if (hasReachedMin) {
      this.logger.debug("🎯 Minimum cooling temperature reached - cooling cycle complete", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${minThreshold}°C`,
        targetTemp: `${this.hvacOptions.cooling.temperature}°C`,
        difference: `${(minThreshold - data.currentTemp).toFixed(1)}°C below minimum threshold`,
        hysteresisInfo: `Cooling started at ${this.hvacOptions.cooling.temperatureThresholds.indoorMax}°C, stopping at ${minThreshold}°C`,
      });
    }

    return hasReachedMin;
  }
}

/**
 * Send id of the cancellable one-shot defrost period timer.
 */
const DEFROST_PERIOD_SEND_ID = "defrost-period";

/** Attempts for a fail-safe "off" command (initial attempt + retries). */
const OFF_COMMAND_MAX_ATTEMPTS = 3;
/** Pause between fail-safe "off" attempts. */
const OFF_COMMAND_RETRY_DELAY_MS = 100;

/**
 * Per-machine command serializer.
 *
 * The Home Assistant client's `controlEntity` awaits a `getState` round-trip
 * (and the "off" path awaits a dynamic import) before its service call reaches
 * the wire, while other paths do not. Without serialization two commands issued
 * by different transitions can therefore reach the device out of order — e.g. a
 * defrost abort's `off` arriving before an in-flight entry `cool` would leave
 * the unit in forced COOL, and a manual heat arriving before the abort's `off`
 * would leave the unit OFF.
 *
 * Every HVAC command batch of one machine goes through one FIFO chain, so wire
 * order always matches transition order.
 *
 * A queued batch can also be *abandoned* (`abandonOutstanding`): a fail-safe
 * `off` batch marks every batch enqueued before it as superseded, so a command
 * stuck in a hung state read stops there instead of delaying the `off` commands
 * (or landing after them, which would leave the unit in the superseded mode).
 */
export class HvacCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Batches enqueued and not finished yet (running and waiting). */
  private outstanding = new Set<AbortController>();

  /**
   * Run `task` after every previously enqueued task has settled.
   *
   * `task` receives the batch's abort signal and must pass it to the client
   * calls it makes. `abandoned` is the value returned when the batch was
   * abandoned before it even started — nothing is sent to the device in that
   * case.
   */
  run<T>(task: (signal: AbortSignal) => Promise<T>, abandoned: T): Promise<T> {
    const controller = new AbortController();
    this.outstanding.add(controller);

    const entry = async (): Promise<T> => {
      if (controller.signal.aborted) return abandoned;
      return task(controller.signal);
    };

    const result = this.tail.then(entry, entry);
    // Keep the chain alive whatever the batch outcome.
    const release = (): void => {
      this.outstanding.delete(controller);
    };
    this.tail = result.then(release, release);
    return result;
  }

  /**
   * Abandon every batch enqueued so far (running and waiting).
   *
   * Called by a fail-safe `off` batch before it enqueues itself: the `off`
   * commands must not wait behind a hung command, and a superseded command must
   * not reach the device after them.
   */
  abandonOutstanding(): void {
    for (const controller of [...this.outstanding]) {
      controller.abort();
    }
  }
}

/**
 * True only for present, finite numbers. Zero is a legitimate temperature, so
 * falsy checks (`!value`) must not be used for temperature validity.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Settle with `promise`, but stop as soon as `signal` aborts.
 *
 * Mirrors the client's own abandoned-batch handling for the state reads a
 * command batch performs directly: the batch must not hold the machine's command
 * queue (and any fail-safe `off` behind it) until a transport answers. Late
 * settlement is swallowed — the caller has already moved on.
 */
function raceAbandoned<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error("command batch abandoned"));
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
}

/**
 * Command every enabled HVAC entity to a per-entity mode.
 *
 * Used by the custom defrost cycle (defrost=true -> cool, defrost=false -> off,
 * completion/abort -> off) and by turnOff. Disabled/unmanaged entities are left
 * untouched. Commands are attempted independently: a failing command is logged
 * and reported to the caller, never silently swallowed.
 *
 * Fail-safe `off` commands (completion, abort, stop, turn off) are retried a
 * bounded number of times: leaving a unit in forced cool (or heating) because a
 * single command was lost is the failure mode this guards against. Only the
 * fail-safe direction is retried — a failed `cool`/`heat` simply leaves the unit
 * as it was. After the bounded retries the failure is reported to the caller and
 * logged; no automatic recovery is claimed.
 *
 * All work runs inside the machine's command queue so that the order in which
 * commands reach the device matches the order in which transitions requested
 * them.
 *
 * @returns entity ids whose command failed after every allowed attempt
 */
async function commandHvacEntities(
  haClient: HomeAssistantClient | undefined,
  hvacOptions: HvacOptions,
  logger: LoggerService,
  resolveMode: (entity: HvacEntity) => "cool" | "off",
  reason: string,
  queue?: HvacCommandQueue,
  // A fail-safe `off` batch supersedes the batches enqueued before it (see
  // HvacCommandQueue.abandonOutstanding): its `off` commands must not wait
  // behind a hung command, and a superseded command must not land after them.
  failSafeOff = false,
): Promise<string[]> {
  const runBatch = async (signal: AbortSignal): Promise<string[]> => {
    if (!haClient) {
      logger.warning("⚠️ No Home Assistant client available for HVAC commands", {
        reason,
      });
      return [];
    }

    const enabledEntities = hvacOptions.hvacEntities.filter((e) => e.enabled);
    const failedEntities: string[] = [];

    for (const entity of enabledEntities) {
      if (signal.aborted) break;

      const mode = resolveMode(entity);
      const maxAttempts = mode === "off" ? OFF_COMMAND_MAX_ATTEMPTS : 1;
      let lastError: unknown;
      let commanded = false;

      for (let attempt = 1; attempt <= maxAttempts && !commanded; attempt++) {
        if (signal.aborted) break;
        try {
          await controlHVACEntity(
            haClient,
            entity.entityId,
            mode,
            undefined,
            undefined,
            logger,
            signal,
          );
          // The client returns without sending when the batch was abandoned
          // during its state read: that is not a successful command.
          if (signal.aborted) break;
          commanded = true;
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts) {
            logger.warning("⚠️ Retrying failed HVAC command", {
              entityId: entity.entityId,
              mode,
              attempt,
              maxAttempts,
              reason,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, OFF_COMMAND_RETRY_DELAY_MS),
            );
          }
        }
      }

      if (signal.aborted) break;

      if (commanded) {
        logger.debug("✅ HVAC entity commanded", {
          entityId: entity.entityId,
          mode,
          reason,
        });
      } else {
        failedEntities.push(entity.entityId);
        logger.error("❌ Failed to command HVAC entity", lastError, {
          entityId: entity.entityId,
          mode,
          attempts: maxAttempts,
          reason,
        });
      }
    }

    if (signal.aborted) {
      // Superseded by a later fail-safe batch: whatever is still unsent is
      // deliberately dropped, and the batch that superseded this one commands
      // every enabled unit itself.
      logger.warning(
        "⏹️ HVAC command batch abandoned - superseded by a fail-safe batch; unsent commands dropped",
        { reason, failedBeforeAbandon: failedEntities },
      );
      return failedEntities;
    }

    if (failedEntities.length > 0) {
      logger.warning(
        "⚠️ HVAC commands failed - no automatic recovery is attempted; the affected unit may not reflect the requested mode until a later successful command",
        { reason, failedEntities, attemptsPerCommand: OFF_COMMAND_MAX_ATTEMPTS },
      );
    }

    return failedEntities;
  };

  if (failSafeOff) queue?.abandonOutstanding();
  return queue
    ? queue.run(runBatch, [])
    : runBatch(new AbortController().signal);
}

/**
 * Create HVAC state machine with XState
 */
export function createHVACMachine(
  hvacOptions: HvacOptions,
  logger: LoggerService,
  haClient?: HomeAssistantClient,
  commandQueue: HvacCommandQueue = new HvacCommandQueue(),
  // Shared with HVACStateMachine so that stop() can close an in-flight cycle
  // for the defrost period gate (the machine and its strategy survive a
  // controller stop/start in the same process).
  hvacStrategy: HVACStrategy = new HVACStrategy(hvacOptions),
) {
  return createMachine(
    {
      id: "hvac",
      initial: "idle",
      context: {
        indoorTemp: undefined,
        outdoorTemp: undefined,
        currentHour: new Date().getHours(),
        isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
        lastDefrost: undefined,
        systemMode: hvacOptions.systemMode,
        manualOverride: undefined,
      } satisfies HVACContext,
      states: {
        idle: {
          entry: "init",
          on: {
            MODE_CHANGE: [
              {
                target: "heating",
                guard: ({ context, event }) =>
                  event.mode === HVACMode.HEAT &&
                  context.systemMode !== SystemMode.COOL_ONLY &&
                  context.systemMode !== SystemMode.OFF,
                actions: "storeManualOverride",
              },
              {
                target: "cooling",
                guard: ({ context, event }) =>
                  event.mode === HVACMode.COOL &&
                  context.systemMode !== SystemMode.HEAT_ONLY &&
                  context.systemMode !== SystemMode.OFF,
                actions: "storeManualOverride",
              },
            ],
            AUTO_EVALUATE: {
              target: "evaluating",
            },
            // One-shot defrost event: refresh the wall clock, then ordinary evaluation
            DEFROST_REEVALUATE: {
              actions: ["refreshClock", "eventAutoEvaluate"],
            },
            UPDATE_CONDITIONS: {
              actions: ["updateConditions", "eventAutoEvaluate"],
            },
            MANUAL_OVERRIDE: {
              target: "evaluating",
              actions: "processManualOverride",
            },
          },
        },
        evaluating: {
          entry: "init",
          always: [
            {
              target: "idle",
              guard: "isManualOff",
            },
            {
              target: "idle",
              guard: "shouldTurnOff",
              actions: "turnOff",
            },
            {
              target: "heating",
              guard: "isManualHeat",
            },
            {
              target: "cooling",
              guard: "isManualCool",
            },
            // Legacy: from Off requires heating demand as well
            {
              target: "defrosting",
              guard: "shouldAutoDefrost",
            },
            {
              target: "heating",
              guard: "shouldAutoHeat",
            },
            {
              target: "cooling",
              guard: "shouldAutoCool",
            },
            {
              target: "idle",
            },
          ],
          on: {
            UPDATE_CONDITIONS: {
              actions: "updateConditions",
            },
            // Self-transition re-runs the always transitions with fresh context
            DEFROST_REEVALUATE: {
              target: "evaluating",
              actions: "refreshClock",
            },
          },
        },
        heating: {
          entry: ["init", "executeHeating"],
          on: {
            OFF: "idle",
            DEFROST_NEEDED: {
              target: "defrosting",
              guard: "canDefrost",
            },
            AUTO_EVALUATE: [
              // Legacy: from active heating only operating conditions apply
              {
                target: "defrosting",
                guard: "canDefrost",
              },
              {
                target: "evaluating",
              },
            ],
            // One-shot defrost event: refresh the wall clock first, then evaluate
            DEFROST_REEVALUATE: {
              actions: ["refreshClock", "eventAutoEvaluate"],
            },
            UPDATE_CONDITIONS: {
              actions: ["updateConditions", "eventAutoEvaluate"],
            },
            MANUAL_OVERRIDE: {
              target: "evaluating",
              actions: "processManualOverride",
            },
          },
        },
        cooling: {
          entry: ["init", "executeCooling"],
          on: {
            OFF: "idle",
            DEFROST_REEVALUATE: {
              actions: ["refreshClock", "eventAutoEvaluate"],
            },
            UPDATE_CONDITIONS: {
              actions: ["updateConditions", "eventAutoEvaluate"],
            },
            AUTO_EVALUATE: {
              target: "evaluating",
            },
            MANUAL_OVERRIDE: {
              target: "evaluating",
              actions: "processManualOverride",
            },
          },
        },
        defrosting: {
          entry: ["init", "cancelDefrostPeriod", "startDefrost"],
          on: {
            // Explicit stop: units must not stay in the forced cool mode
            OFF: {
              target: "idle",
              actions: "abortDefrost",
            },
            // Explicit one-shot completion (the duration timer normally fires it)
            DEFROST_COMPLETE: {
              target: "idle",
              actions: ["cancelDefrostPeriod", "completeDefrost", "scheduleDefrostPeriod"],
            },
            // Manual off/heat/cool during the cycle: leave the forced cool mode
            // and let ordinary (manual) evaluation decide, never a stale cycle
            MANUAL_OVERRIDE: {
              target: "evaluating",
              actions: ["abortDefrost", "processManualOverride"],
            },
            UPDATE_CONDITIONS: {
              actions: ["updateConditions", "eventDefrostReevaluate"],
            },
            DEFROST_REEVALUATE: [
              // Spontaneous events never restart or duplicate the cycle
              {
                guard: "defrostCanContinue",
                actions: "continueDefrost",
              },
              // Schedule/operating constraint violated: abort and leave units off
              {
                target: "idle",
                actions: "abortDefrost",
              },
            ],
          },
          after: {
            // One-shot completion event after durationSeconds, independent of sensors
            [`${hvacOptions.heating.defrost?.durationSeconds ?? 300}000`]: {
              target: "idle",
              actions: ["cancelDefrostPeriod", "completeDefrost", "scheduleDefrostPeriod"],
            },
          },
        },
      },
    },
    {
      actions: {
        init: ({ context, event }) => {
          const eventType = (event as unknown as { type?: string })?.type;
          if (
            eventType &&
            !["UPDATE_CONDITIONS", "AUTO_EVALUATE"].includes(eventType)
          ) {
            logger.debug("🔄 [HVAC] State transition", {
              event: eventType,
              indoorTemp: context.indoorTemp,
              outdoorTemp: context.outdoorTemp,
              systemMode: context.systemMode,
            });
          } else {
            logger.debug("🔄 [HVAC] State entry", {
              event: eventType,
              indoorTemp: context.indoorTemp,
              outdoorTemp: context.outdoorTemp,
            });
          }
        },
        processManualOverride: assign(({ context, event }) => {
          if (event.type !== "MANUAL_OVERRIDE") return context;

          logger.info(`🎯 [HVAC] Manual override activated`, {
            mode: (event as any).mode,
            temperature: (event as any).temperature,
          });

          return {
            ...context,
            manualOverride: {
              mode: (event as any).mode,
              temperature: (event as any).temperature,
              timestamp: new Date(),
            },
          } as any;
        }),

        storeManualOverride: assign(({ context, event }) => {
          if (event.type !== "MODE_CHANGE") return context;

          logger.info(`🎯 [HVAC] Manual override stored from MODE_CHANGE`, {
            mode: (event as any).mode,
            temperature: (event as any).temperature,
            presetMode: (event as any).presetMode,
          });

          return {
            ...context,
            manualOverride: {
              mode: (event as any).mode,
              temperature: (event as any).temperature,
              presetMode: (event as any).presetMode,
              timestamp: new Date(),
            },
          } as any;
        }),

        updateConditions: assign(({ context, event }) => {
          if (event.type !== "UPDATE_CONDITIONS") return context;

          // Log the event source generically
          if (event.eventSource) {
            const { type, entityId, newValue, ...extraData } =
              event.eventSource;
            logger.info("📊 Sensor event triggering HVAC evaluation", {
              eventType: type,
              eventEntity: entityId,
              eventValue: newValue,
              ...extraData,
              updatedConditions: event.data,
            });
          }

          return { ...context, ...event.data };
        }),

        eventAutoEvaluate: ({ context, self }) => {
          logger.debug("🎯 Starting HVAC auto-evaluate logic", {
            indoorTemp: context.indoorTemp,
            outdoorTemp: context.outdoorTemp,
            systemMode: context.systemMode,
          });
          // Event evaluation now that conditions are met
          self.send({ type: "AUTO_EVALUATE" });
        },

        startDefrost: async () => {
          hvacStrategy.startDefrost();

          // Legacy start_defrost: every enabled unit gets a mode command —
          // defrost=true -> cool, defrost=false -> off. No temperature/preset.
          // (Off is issued through the existing climate.turn_off path, the same
          // service the rest of hag_ts uses for "off"; legacy set_hvac_mode
          // with value "off" is equivalent in Home Assistant.)
          const failedEntities = await commandHvacEntities(
            haClient,
            hvacOptions,
            logger,
            (entity) => (entity.defrost ? "cool" : "off"),
            "defrost_start",
            commandQueue,
          );

          logger.info(`❄️ [HVAC] Defrost cycle started`, {
            durationSeconds:
              hvacOptions.heating.defrost?.durationSeconds || 300,
            defrostUnits: hvacOptions.hvacEntities
              .filter((e) => e.enabled && e.defrost)
              .map((e) => e.entityId),
            switchedOffUnits: hvacOptions.hvacEntities
              .filter((e) => e.enabled && !e.defrost)
              .map((e) => e.entityId),
            failedEntities,
          });
        },

        completeDefrost: async ({ self }) => {
          // 1. Record completion here (not at start): the next cycle's minimum
          //    interval is measured from completion, as in legacy stop_defrost.
          hvacStrategy.completeDefrost();

          // 2. Cycle-controlled enabled units are commanded off.
          const failedEntities = await commandHvacEntities(
            haClient,
            hvacOptions,
            logger,
            () => "off",
            "defrost_complete",
            commandQueue,
            true,
          );

          logger.info(`✅ [HVAC] Defrost cycle completed`, {
            failedEntities,
            note: "ordinary evaluation now decides whether heating resumes",
          });

          // 3. Ordinary evaluation (with a freshly read wall clock) decides
          //    whether heat resumes — there is no unconditional return to heating.
          self.send({ type: "DEFROST_REEVALUATE" });
        },

        abortDefrost: async ({ event }) => {
          // A cycle that ends early is still a cycle end (legacy invariant):
          // record it so the next cycle cannot start before the period elapses.
          hvacStrategy.abortDefrostCycle();

          logger.warning(
            "⚠️ [HVAC] Defrost cycle aborted - switching enabled units off",
            {
              abortingEvent: (event as { type?: string })?.type,
              reason:
                "abort/stop/manual-off must not leave a unit in forced cool mode",
            },
          );

          await commandHvacEntities(
            haClient,
            hvacOptions,
            logger,
            () => "off",
            "defrost_abort",
            commandQueue,
            true,
          );
        },

        cancelDefrostPeriod: cancel(DEFROST_PERIOD_SEND_ID),

        // One-shot next eligibility evaluation after periodSeconds (legacy
        // schedules a state publication after the configured period).
        scheduleDefrostPeriod: sendTo(
          ({ self }) => self,
          { type: "DEFROST_REEVALUATE" },
          {
            id: DEFROST_PERIOD_SEND_ID,
            delay: (hvacOptions.heating.defrost?.periodSeconds ?? 7200) * 1000,
          },
        ),

        refreshClock: assign(({ context }) => {
          const now = new Date();
          return {
            ...context,
            currentHour: now.getHours(),
            isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
          };
        }),

        eventDefrostReevaluate: ({ self }) => {
          self.send({ type: "DEFROST_REEVALUATE" });
        },

        continueDefrost: () => {
          logger.debug(
            "❄️ [HVAC] Defrost cycle continues - schedule/operating constraints still satisfied",
          );
        },


        executeHeating: async ({ context }: { context: HVACContext }) =>
          // Serialized: these commands must not overtake an earlier
          // batch (e.g. a defrost abort's off commands) and are dropped when a
          // fail-safe off batch supersedes them.
          commandQueue.run(async (signal) => {
            if (!haClient) {
              logger.warning(
                "⚠️ No Home Assistant client available for heating control",
              );
              return;
            }
            if (signal.aborted) {
              logger.warning(
                "⏹️ Heating command batch abandoned before it ran - superseded by a fail-safe batch",
              );
              return;
            }

            const enabledEntities = hvacOptions.hvacEntities.filter(
              (e) => e.enabled,
            );

            let heatingEntities = enabledEntities;
            let matchedRule: any = null;

            if (context.outdoorTemp !== undefined && hvacOptions.heating.rules?.length) {
              for (const rule of hvacOptions.heating.rules) {
                const cond = rule.conditions.outdoorTemp;
                if (!cond) continue;

                const { gt, gte, lt, lte } = cond;
                let matches = true;
                if (gt !== undefined && !(context.outdoorTemp > gt)) matches = false;
                if (gte !== undefined && !(context.outdoorTemp >= gte)) matches = false;
                if (lt !== undefined && !(context.outdoorTemp < lt)) matches = false;
                if (lte !== undefined && !(context.outdoorTemp <= lte)) matches = false;

                if (matches) {
                  const ruleEntityIds = new Set(rule.actions.includeUnits);
                  heatingEntities = enabledEntities.filter((e) =>
                    ruleEntityIds.has(e.entityId),
                  );
                  matchedRule = rule;
                  break;
                }
              }
            }
            // Use manual override preset mode if available, otherwise use config default
            const presetMode =
              context.manualOverride?.presetMode ??
              hvacOptions.heating.presetMode;
            const targetTemp =
              context.manualOverride?.temperature ??
              hvacOptions.heating.temperature;

            // Record state change for cycling monitoring
            if (isFiniteNumber(context.indoorTemp)) {
              hvacStrategy.cyclingMonitor.recordStateChange(
                "OFF",
                "HEAT",
                context.indoorTemp,
              );
            }

            if (isFiniteNumber(context.indoorTemp)) {
              hvacStrategy
                .getCyclingMonitor()
                .recordStateChange("OFF", "HEAT", context.indoorTemp);
            }

            logger.info("🔥 Executing heating mode on entities", {
              targetTemp,
              presetMode,
              totalEntities: heatingEntities.length,
              matchedRule: matchedRule
                ? `rule-${hvacOptions.heating.rules.indexOf(matchedRule)}`
                : "fallback (all enabled)",
              isManualOverride: !!context.manualOverride,
              cyclingStatus:
                "Heating cycle started - monitoring for rapid cycling",
            });

            for (const entity of heatingEntities) {
              if (signal.aborted) break;
              try {
                // Apply per-unit temperature correction if configured
                const entityTargetTemp =
                  targetTemp + (entity.temperatureCorrection ?? 0);

                await controlHVACEntity(
                  haClient,
                  entity.entityId,
                  "heat",
                  entityTargetTemp,
                  presetMode,
                  logger,
                  signal,
                );
                logger.debug("✅ Heating entity controlled", {
                  entityId: entity.entityId,
                  baseTemp: targetTemp,
                  correction: entity.temperatureCorrection ?? 0,
                  targetTemp: entityTargetTemp,
                  presetMode,
                });
              } catch (error) {
                logger.error("❌ Failed to control heating entity", error, {
                  entityId: entity.entityId,
                });
              }
            }
          }, undefined),

        executeCooling: async ({ context }: { context: HVACContext }) =>
          // Serialized: these commands must not overtake an earlier
          // batch (e.g. a defrost abort's off commands) and are dropped when a
          // fail-safe off batch supersedes them.
          commandQueue.run(async (signal) => {
            if (!haClient) {
              logger.warning(
                "⚠️ No Home Assistant client available for cooling control",
              );
              return;
            }
            if (signal.aborted) {
              logger.warning(
                "⏹️ Cooling command batch abandoned before it ran - superseded by a fail-safe batch",
              );
              return;
            }

            const enabledEntities = hvacOptions.hvacEntities.filter(
              (e) => e.enabled,
            );

            // Use the calibrated indoor temperature (hall sensor) for the
            // overall system decision — per-unit sensors are only used as a
            // safety floor to avoid over-cooling already-cold rooms.
            const systemIndoorTemp = context?.indoorTemp;
            const shouldCoolSystem =
              systemIndoorTemp !== undefined &&
              systemIndoorTemp > hvacOptions.cooling.temperatureThresholds.indoorMin;

            // Staleness threshold for per-unit sensor readings (default: 30 min)
            const stalenessMs = hvacOptions.sensorStalenessMs ?? 30 * 60 * 1000;
            const now = Date.now();

            logger.info("❄️ Executing cooling control on entities", {
              systemIndoorTemp: systemIndoorTemp ?? "unknown",
              shouldCoolSystem,
              targetTemp: hvacOptions.cooling.temperature,
              presetMode: hvacOptions.cooling.presetMode,
              enabledEntities: enabledEntities.length,
              stalenessThresholdMs: stalenessMs,
              systemThresholds: {
                indoorMin: hvacOptions.cooling.temperatureThresholds.indoorMin,
                indoorMax: hvacOptions.cooling.temperatureThresholds.indoorMax,
              },
            });

            for (const entity of enabledEntities) {
              if (signal.aborted) break;
              try {
                // Derive temperature sensor for this unit
                const tempSensorId = deriveTemperatureSensor(entity.entityId);

                // Get current room temperature and check staleness
                const tempState = await raceAbandoned(
                  haClient.getState(tempSensorId, signal),
                  signal,
                );
                if (signal.aborted) break;
                const roomTemp = parseFloat(tempState.state);

                // Check if the sensor reading is stale
                const sensorAge = tempState.lastUpdated
                  ? now - tempState.lastUpdated.getTime()
                  : Infinity;
                const isStale = sensorAge > stalenessMs;

                // When stale, fall back to the system (hall) sensor temperature
                const effectiveRoomTemp = isStale ? (systemIndoorTemp ?? roomTemp) : roomTemp;

                // Apply calibration if configured for this sensor
                const calibratedRoomTemp = isStale
                  ? effectiveRoomTemp // Hall sensor already calibrated in context
                  : (hvacOptions.temperatureCalibration?.[tempSensorId]
                      ? effectiveRoomTemp + hvacOptions.temperatureCalibration[tempSensorId]
                      : effectiveRoomTemp);

                if (isStale) {
                  logger.info("🕰️ Stale sensor detected — using hall sensor fallback", {
                    entityId: entity.entityId,
                    tempSensorId,
                    staleTemp: roomTemp,
                    sensorAgeMs: sensorAge,
                    stalenessThresholdMs: stalenessMs,
                    fallbackTemp: effectiveRoomTemp,
                    lastUpdated: tempState.lastUpdated?.toISOString(),
                  });
                }

                logger.debug("🌡️ Room temperature check", {
                  entityId: entity.entityId,
                  tempSensorId,
                  roomTemp,
                  effectiveRoomTemp,
                  calibratedRoomTemp,
                  isStale,
                  sensorAgeMs: sensorAge,
                });

                // Decision logic:
                // 1. If system says cool (hall sensor above threshold), turn on
                //    units UNLESS the individual room is already comfortably cool
                //    (below a safety floor of cooling.temperature - 2°C).
                // 2. If system says no cooling needed, turn off units that are running.
                // Stale per-unit sensors are replaced by hall sensor readings so
                // they don't falsely block cooling when units have been off.

                // Apply per-unit temperature correction if configured
                const entityTargetTemp =
                  hvacOptions.cooling.temperature +
                  (entity.temperatureCorrection ?? 0);

                if (shouldCoolSystem) {
                  // System-wide decision is to cool (hall sensor above threshold)
                  // Check if this specific room is already too cold to warrant cooling
                  const coolingSafetyFloor =
                    hvacOptions.cooling.temperature - 2; // e.g. 24.3 - 2 = 22.3°C

                  if (calibratedRoomTemp < coolingSafetyFloor) {
                    // Room is already cool enough — skip cooling this unit
                    logger.info(
                      "⏭️ Unit skipped - room already cool enough",
                      {
                        entityId: entity.entityId,
                        roomTemp,
                        effectiveRoomTemp,
                        calibratedRoomTemp,
                        safetyFloor: coolingSafetyFloor,
                        isStale,
                        reason: `Room at ${calibratedRoomTemp}°C is below safety floor ${coolingSafetyFloor}°C`,
                      },
                    );
                  } else {
                    // Room is warm enough to warrant cooling
                    await controlHVACEntity(
                      haClient,
                      entity.entityId,
                      "cool",
                      entityTargetTemp,
                      hvacOptions.cooling.presetMode,
                      logger,
                      signal,
                    );
                    logger.info("❄️ Unit turned ON for cooling", {
                      entityId: entity.entityId,
                      roomTemp,
                      effectiveRoomTemp,
                      calibratedRoomTemp,
                      targetTemp: entityTargetTemp,
                      isStale,
                    });
                  }
                } else {
                  // System-wide: no cooling needed — turn off any running units
                  await controlHVACEntity(
                    haClient,
                    entity.entityId,
                    "off",
                    undefined,
                    undefined,
                    logger,
                    signal,
                  );
                  logger.info("🔴 Unit turned OFF - system cooling not needed", {
                    entityId: entity.entityId,
                    systemIndoorTemp,
                    threshold:
                      hvacOptions.cooling.temperatureThresholds.indoorMin,
                  });
                }
              } catch (error) {
                logger.error(
                  "❌ Failed to control cooling entity individually",
                  error,
                  {
                    entityId: entity.entityId,
                  },
                );
              }
            }
          }, undefined),

        turnOff: async () => {
          if (!haClient) {
            logger.warning(
              "⚠️ No Home Assistant client available for turn off control",
            );
            return;
          }

          const enabledEntities = hvacOptions.hvacEntities.filter(
            (e) => e.enabled,
          );

          logger.info("🔴 Turning off enabled HVAC entities", {
            totalEntities: hvacOptions.hvacEntities.length,
            enabledEntities: enabledEntities.length,
            reason: "Turning off conditions met",
            cyclingStatus: "Heating cycle ended - monitoring for rapid cycling",
          });

          await commandHvacEntities(
            haClient,
            hvacOptions,
            logger,
            () => "off",
            "turn_off",
            commandQueue,
            true,
          );
        },
      },
      guards: {
        /**
         * Manual override guards
         */
        isManualOff: ({ context }) => {
          return (context as any).manualOverride?.mode === HVACMode.OFF;
        },

        isManualHeat: ({ context }) => {
          return (context as any).manualOverride?.mode === HVACMode.HEAT;
        },

        isManualCool: ({ context }) => {
          return (context as any).manualOverride?.mode === HVACMode.COOL;
        },

        /**
         * Simplified guards that delegate to strategy methods
         * Complex logic stays in the strategy, not in guards
         */

        shouldAutoHeat: ({ context }) => {
          if (context.systemMode !== SystemMode.AUTO) return false;
          // Zero is a valid temperature: only missing/non-finite readings block
          // evaluation (full zero-validity handling is issue 1's scope).
          if (!isFiniteNumber(context.indoorTemp) || !isFiniteNumber(context.outdoorTemp)) {
            return false;
          }

          const evaluation = hvacStrategy.evaluateConditions({
            currentTemp: context.indoorTemp,
            weatherTemp: context.outdoorTemp,
            hour: context.currentHour,
            isWeekday: context.isWeekday,
          });

          logger.debug("🔍 Auto heat guard evaluation", {
            allowed: evaluation.shouldHeat,
            systemMode: context.systemMode,
            reason: evaluation.shouldHeat
              ? "Auto heating approved"
              : "Auto heating denied",
          });
          return evaluation.shouldHeat;
        },

        shouldAutoCool: ({ context }) => {
          if (context.systemMode !== SystemMode.AUTO) return false;
          // Zero is a valid temperature: only missing/non-finite readings block
          // evaluation (issue 1). A truthiness check would treat a finite 0 °C
          // reading as absent input and silently skip the cooling evaluation.
          if (
            !isFiniteNumber(context.indoorTemp) ||
            !isFiniteNumber(context.outdoorTemp)
          ) {
            return false;
          }

          const evaluation = hvacStrategy.evaluateConditions({
            currentTemp: context.indoorTemp,
            weatherTemp: context.outdoorTemp,
            hour: context.currentHour,
            isWeekday: context.isWeekday,
          });

          logger.debug("🔍 Auto cool guard evaluation", {
            allowed: evaluation.shouldCool,
            systemMode: context.systemMode,
            reason: evaluation.shouldCool
              ? "Auto cooling approved"
              : "Auto cooling denied",
          });
          return evaluation.shouldCool;
        },

        /** Defrost entry from an off/idle evaluation (legacy: Off requires heating demand). */
        shouldAutoDefrost: ({ context }) => {
          if (context.systemMode !== SystemMode.AUTO) return false;
          if (!isFiniteNumber(context.indoorTemp) || !isFiniteNumber(context.outdoorTemp)) {
            return false;
          }

          const eligible = hvacStrategy.isDefrostEntryEligible(
            {
              currentTemp: context.indoorTemp,
              weatherTemp: context.outdoorTemp,
              hour: context.currentHour,
              isWeekday: context.isWeekday,
            },
            false,
          );

          logger.debug("🔍 Auto defrost guard evaluation", {
            eligible,
            origin: "off/idle",
            systemMode: context.systemMode,
            reason: eligible ? "Auto defrost approved" : "Auto defrost denied",
          });
          return eligible;
        },

        /**
         * Defrost entry while the machine is in active heating. Legacy:
         * `can_operate && need_defrost_cycle`, no additional demand check.
         */
        canDefrost: ({ context }) => {
          if (
            context.systemMode === SystemMode.COOL_ONLY ||
            context.systemMode === SystemMode.OFF
          ) {
            return false;
          }
          if (!isFiniteNumber(context.indoorTemp) || !isFiniteNumber(context.outdoorTemp)) {
            return false;
          }

          const eligible = hvacStrategy.isDefrostEntryEligible(
            {
              currentTemp: context.indoorTemp,
              weatherTemp: context.outdoorTemp,
              hour: context.currentHour,
              isWeekday: context.isWeekday,
            },
            true,
          );

          logger.debug("🔍 Defrost guard evaluation", {
            eligible,
            origin: "active heating",
            reason: eligible ? "Defrost cycle required" : "Defrost not needed",
          });
          return eligible;
        },

        /**
         * During an active defrost cycle: only the schedule window (and, through
         * MANUAL_OVERRIDE/OFF, an explicit stop) can abort it. The duration
         * timer — not spontaneous sensor events — completes the cycle.
         *
         * Only the active-hours window is checked here, matching the legacy
         * runtime behaviour (legacy `continue_defrost` leaves the outdoor
         * operating range unenforced for a running cycle; only entry requires
         * it).
         */
        defrostCanContinue: ({ context }) =>
          hvacStrategy.isActiveHour(context.currentHour, context.isWeekday),

        shouldTurnOff: ({ context }) => {
          // Don't turn off if manual override is active
          if (context.manualOverride) {
            logger.debug("🔍 Turn off guard - manual override active", {
              manualMode: context.manualOverride.mode,
              manualTemp: context.manualOverride.temperature,
              reason: "Manual override takes precedence",
            });
            return false;
          }

          // Zero is a valid temperature: only missing/non-finite readings block
          // evaluation (full zero-validity handling is issue 1's scope).
          if (!isFiniteNumber(context.indoorTemp) || !isFiniteNumber(context.outdoorTemp)) {
            return false;
          }

          const evaluation = hvacStrategy.evaluateConditions({
            currentTemp: context.indoorTemp,
            weatherTemp: context.outdoorTemp,
            hour: context.currentHour,
            isWeekday: context.isWeekday,
          });

          logger.debug("🔍 Turn off guard evaluation", {
            required: evaluation.shouldTurnOff,
            reason: evaluation.shouldTurnOff
              ? "System shutdown required"
              : "System can continue operating",
          });
          return evaluation.shouldTurnOff;
        },
      },
    },
  );
}

/**
 * Generic HVAC entity control helper using the new generic controlEntity method
 */
async function controlHVACEntity(
  haClient: HomeAssistantClient,
  entityId: string,
  mode: string,
  targetTemp?: number,
  presetMode?: string,
  logger?: LoggerService,
  // Batch signal: when the batch that requested this command was abandoned
  // (superseded by a fail-safe batch), nothing further may reach the device.
  signal?: AbortSignal,
): Promise<void> {
  if (!haClient) return;
  if (signal?.aborted) {
    logger?.debug("⏭️ HVAC entity control skipped - batch abandoned", {
      entityId,
      mode,
    });
    return;
  }

  if (mode === "off") {
    // Turn off entity - turn_off service doesn't need additional parameters
    // Import HassServiceCallImpl dynamically to avoid circular dependency
    const { HassServiceCallImpl } = await import("../home-assistant/models.ts");
    const offCall = HassServiceCallImpl.climate("turn_off", entityId, {});
    await haClient.callService(offCall, signal);
  } else {
    // Set HVAC mode (heat, cool, etc.)
    await haClient.controlEntity(
      entityId,
      "climate",
      "set_hvac_mode",
      { type: "state", key: "hvac_mode" },
      mode,
      signal,
    );

    // Set temperature if provided
    if (targetTemp !== undefined) {
      await haClient.controlEntity(
        entityId,
        "climate",
        "set_temperature",
        { type: "attribute", key: "temperature" },
        targetTemp,
        signal,
      );
    }

    // Set preset mode if provided
    if (presetMode) {
      await haClient.controlEntity(
        entityId,
        "climate",
        "set_preset_mode",
        { type: "attribute", key: "preset_mode" },
        presetMode,
        signal,
      );
    }
  }

  logger?.debug("🎯 HVAC entity control completed", {
    entityId,
    mode,
    temperature: targetTemp,
    presetMode,
  });
}

/**
 * HVAC state machine service
 */
@injectable()
export class HVACStateMachine {
  private machine: HVACMachine;
  private actor?: HVACMachineActor;
  private logger: LoggerService;
  private hvacOptions?: HvacOptions;
  private haClient?: HomeAssistantClient;
  /**
   * One command queue per state-machine instance: every HVAC command of this
   * machine (including the ones `stop()` issues) is serialized through it, so
   * the order of commands on the wire matches the order transitions requested
   * them.
   */
  private commandQueue = new HvacCommandQueue();
  /**
   * Shared with the machine so `stop()` can close an in-flight defrost cycle
   * for the period gate: this instance (and its last-defrost timestamp) is
   * reused across a controller stop/start in the same process.
   */
  private strategy: HVACStrategy;

  constructor(hvacOptions?: HvacOptions, haClient?: HomeAssistantClient) {
    this.logger = new LoggerService("HAG.hvac.state-machine");
    this.hvacOptions = hvacOptions;
    this.haClient = haClient;
    this.strategy = new HVACStrategy(hvacOptions!);
    this.machine = createHVACMachine(
      hvacOptions!,
      this.logger,
      haClient,
      this.commandQueue,
      this.strategy,
    );
  }

  /**
   * Start the state machine
   */
  start(): void {
    this.logger.info("🚀 Starting HVAC state machine", {
      machineId: this.machine.id,
      initialState: "idle", // XState v5 doesn't expose initial directly
      alreadyRunning: !!this.actor,
    });

    if (this.actor) {
      throw new StateError("State machine is already running");
    }

    this.actor = createActor(this.machine);

    // Add state transition logging
    this.actor.subscribe((snapshot) => {
      this.logger.debug("🔄 State machine transition", {
        toState: snapshot.value,
        context: snapshot.context,
        status: snapshot.status,
        timestamp: new Date().toISOString(),
      });
    });

    this.actor.start();

    const initialSnapshot = this.actor.getSnapshot();

    this.logger.info("✅ HVAC state machine started", {
      initialState: initialSnapshot.value,
      initialContext: initialSnapshot.context,
      machineStatus: initialSnapshot.status,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Stop the state machine.
   *
   * Stopping during a defrost cycle switches the managed units off first: the
   * cycle leaves units in a forced cool mode and the actor (with its timers)
   * is about to disappear, so nothing else would correct them.
   */
  async stop(): Promise<void> {
    this.logger.info("🛑 Stopping HVAC state machine", {
      currentState: this.actor?.getSnapshot().value || "not_running",
      isRunning: !!this.actor,
    });

    if (this.actor) {
      const finalSnapshot = this.actor.getSnapshot();

      this.logger.debug("📋 Final state machine status", {
        finalState: finalSnapshot.value,
        finalContext: finalSnapshot.context,
        machineStatus: finalSnapshot.status,
      });

      if (finalSnapshot.value === "defrosting" && this.hvacOptions) {
        this.logger.warning(
          "⚠️ Stopping during a defrost cycle - switching enabled units off",
          {
            reason:
              "controller stop must not leave a unit in forced cool mode",
          },
        );
        // Queued behind any in-flight defrost command, so the off commands are
        // the last thing that reaches the device for these units.
        await commandHvacEntities(
          this.haClient,
          this.hvacOptions,
          this.logger,
          () => "off",
          "state_machine_stop",
          this.commandQueue,
          true,
        );
        // Stopping ends the cycle: record it so a restart in this process cannot
        // start the next defrost before the period elapses (same invariant as
        // the in-machine abort paths).
        this.strategy.abortDefrostCycle();
      }

      this.actor.stop();
      this.actor = undefined;

      this.logger.info("✅ HVAC state machine stopped");
    } else {
      this.logger.debug("🔄 State machine was not running");
    }
  }

  /**
   * Send event to state machine
   */
  send(event: HVACEvent): void {
    if (!this.actor) {
      this.logger.error(
        "❌ Cannot send event: state machine not running",
        new Error("State machine not running"),
        {
          eventType: event.type,
        },
      );
      throw new StateError("State machine is not running");
    }

    const beforeSnapshot = this.actor.getSnapshot();

    this.logger.debug("📤 Sending event to state machine", {
      event,
      eventType: event.type,
      currentState: beforeSnapshot.value,
      context: beforeSnapshot.context,
      timestamp: new Date().toISOString(),
    });

    this.actor.send(event);

    const afterSnapshot = this.actor.getSnapshot();

    if (beforeSnapshot.value !== afterSnapshot.value) {
      this.logger.debug("⚙️ Event triggered state transition", {
        event,
        fromState: beforeSnapshot.value,
        toState: afterSnapshot.value,
        contextChanged:
          JSON.stringify(beforeSnapshot.context) !==
          JSON.stringify(afterSnapshot.context),
      });
    } else {
      this.logger.debug("🔄 Event processed without state change", {
        event,
        currentState: afterSnapshot.value,
        contextChanged:
          JSON.stringify(beforeSnapshot.context) !==
          JSON.stringify(afterSnapshot.context),
      });
    }
  }

  /**
   * Get current state
   */
  getCurrentState(): string {
    if (!this.actor) {
      return "stopped";
    }
    return this.actor.getSnapshot().value as string;
  }

  /**
   * Get current context
   */
  getContext(): HVACContext {
    if (!this.actor) {
      throw new StateError("State machine is not running");
    }
    return this.actor.getSnapshot().context;
  }

  /**
   * Manual HVAC override
   */
  manualOverride(mode: HVACMode, temperature?: number): void {
    const currentState = this.getCurrentState();
    const context = this.getContext();

    this.logger.info("🎯 Manual override initiated", {
      requestedMode: mode,
      requestedTemperature: temperature,
      currentState,
      currentContext: context,
      systemMode: context.systemMode,
      timestamp: new Date().toISOString(),
    });

    this.send({
      type: "MANUAL_OVERRIDE",
      mode,
      temperature,
    });

    this.logger.debug("✅ Manual override event sent", {
      mode,
      temperature,
      newState: this.getCurrentState(),
    });
  }

  /**
   * Get comprehensive status
   */
  getStatus(): {
    currentState: string;
    context: HVACContext;
    canHeat: boolean;
    canCool: boolean;
    systemMode: SystemMode;
  } {
    const currentState = this.getCurrentState();
    const context = this.getContext();

    return {
      currentState,
      context,
      canHeat:
        context.systemMode !== SystemMode.COOL_ONLY &&
        context.systemMode !== SystemMode.OFF,
      canCool:
        context.systemMode !== SystemMode.HEAT_ONLY &&
        context.systemMode !== SystemMode.OFF,
      systemMode: context.systemMode,
    };
  }
}
