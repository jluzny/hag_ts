/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import { ActorRefFrom, assign, createActor, createMachine } from "xstate";
import { injectable } from "@needle-di/core";
import { type HvacOptions } from "../config/config.ts";
import {
  HVACContext,
  HVACMode,
  StateChangeData,
  SystemMode,
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
        } else if (this.hasReachedMaximumTemperature(data)) {
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

    // Check temperature threshold
    if (data.weatherTemp > defrost.temperatureThreshold) {
      return false;
    }

    // Check time since last defrost
    if (this.lastDefrost) {
      const timeSinceDefrost = Date.now() - this.lastDefrost.getTime();
      const periodMs = defrost.periodSeconds * 1000;

      if (timeSinceDefrost < periodMs) {
        return false;
      }
    }

    return true;
  }

  startDefrost(): void {
    this.lastDefrost = new Date();
    // Clear evaluation cache since internal state changed
    this.evaluationCache = undefined;

    this.logger.info("❄️ Defrost cycle started", {
      startTime: this.lastDefrost.toISOString(),
      durationSeconds: this.hvacOptions.heating.defrost?.durationSeconds || 300,
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

  private isActiveHour(hour: number, isWeekday: boolean): boolean {
    const activeHours = this.hvacOptions.activeHours;
    if (!activeHours) return true;

    const start = isWeekday ? activeHours.startWeekday : activeHours.start;
    return hour >= start && hour <= activeHours.end;
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
    if (this.hasReachedMaximumTemperature(data)) {
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
 * Create HVAC state machine with XState
 */
export function createHVACMachine(
  hvacOptions: HvacOptions,
  logger: LoggerService,
  haClient?: HomeAssistantClient,
) {
  const hvacStrategy = new HVACStrategy(hvacOptions);

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
        cooling: {
          entry: ["init", "executeCooling"],
          on: {
            OFF: "idle",
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
          entry: ["init", "startDefrost"],
          on: {
            OFF: "idle",
            DEFROST_COMPLETE: "heating",
            MANUAL_OVERRIDE: {
              target: "evaluating",
              actions: "processManualOverride",
            },
          },
          after: {
            // Defrost duration from configuration
            [`${hvacOptions.heating.defrost?.durationSeconds ?? 300}000`]: {
              target: "heating",
              actions: "completeDefrost",
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

        startDefrost: () => {
          hvacStrategy.startDefrost();
          logger.info(`❄️ [HVAC] Defrost cycle started`, {
            durationSeconds:
              hvacOptions.heating.defrost?.durationSeconds || 300,
          });
        },

        completeDefrost: () => {
          logger.info(`✅ [HVAC] Defrost cycle completed`, {
            nextState: "heating",
          });
        },

        executeHeating: async ({ context }: { context: HVACContext }) => {
          if (!haClient) {
            logger.warning(
              "⚠️ No Home Assistant client available for heating control",
            );
            return;
          }

          const enabledEntities = hvacOptions.hvacEntities.filter(
            (e) => e.enabled,
          );

          // Use manual override preset mode if available, otherwise use config default
          const presetMode =
            context.manualOverride?.presetMode ??
            hvacOptions.heating.presetMode;
          const targetTemp =
            context.manualOverride?.temperature ??
            hvacOptions.heating.temperature;

          // Record state change for cycling monitoring
          if (context.indoorTemp) {
            hvacStrategy.cyclingMonitor.recordStateChange(
              "OFF",
              "HEAT",
              context.indoorTemp,
            );
          }

          // Record state change for cycling monitoring
          if (context.indoorTemp) {
            hvacStrategy
              .getCyclingMonitor()
              .recordStateChange("OFF", "HEAT", context.indoorTemp);
          }

          logger.info("🔥 Executing heating mode on entities", {
            targetTemp,
            presetMode,
            enabledEntities: enabledEntities.length,
            isManualOverride: !!context.manualOverride,
            cyclingStatus:
              "Heating cycle started - monitoring for rapid cycling",
          });

          for (const entity of enabledEntities) {
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
        },

        executeCooling: async () => {
          if (!haClient) {
            logger.warning(
              "⚠️ No Home Assistant client available for cooling control",
            );
            return;
          }

          const enabledEntities = hvacOptions.hvacEntities.filter(
            (e) => e.enabled,
          );

          logger.info("❄️ Executing individual cooling control on entities", {
            targetTemp: hvacOptions.cooling.temperature,
            presetMode: hvacOptions.cooling.presetMode,
            enabledEntities: enabledEntities.length,
            indoorMax: hvacOptions.cooling.temperatureThresholds.indoorMax,
            indoorMin: hvacOptions.cooling.temperatureThresholds.indoorMin,
          });

          for (const entity of enabledEntities) {
            try {
              // Derive temperature sensor for this unit
              const tempSensorId = deriveTemperatureSensor(entity.entityId);

              // Get current room temperature
              const tempState = await haClient.getState(tempSensorId);
              const roomTemp = parseFloat(tempState.state);

              logger.debug("🌡️ Room temperature check", {
                entityId: entity.entityId,
                tempSensorId,
                roomTemp,
                indoorMax: hvacOptions.cooling.temperatureThresholds.indoorMax,
                indoorMin: hvacOptions.cooling.temperatureThresholds.indoorMin,
              });

              // Individual unit decision logic
              if (
                roomTemp > hvacOptions.cooling.temperatureThresholds.indoorMax
              ) {
                // Turn ON cooling - room too hot
                await controlHVACEntity(
                  haClient,
                  entity.entityId,
                  "cool",
                  hvacOptions.cooling.temperature,
                  hvacOptions.cooling.presetMode,
                  logger,
                );
                logger.info("❄️ Unit turned ON - room too hot", {
                  entityId: entity.entityId,
                  roomTemp,
                  threshold:
                    hvacOptions.cooling.temperatureThresholds.indoorMax,
                  excess: (
                    roomTemp -
                    hvacOptions.cooling.temperatureThresholds.indoorMax
                  ).toFixed(1),
                });
              } else if (
                roomTemp < hvacOptions.cooling.temperatureThresholds.indoorMin
              ) {
                // Turn OFF cooling - room cool enough
                await controlHVACEntity(
                  haClient,
                  entity.entityId,
                  "off",
                  undefined,
                  undefined,
                  logger,
                );
                logger.info("🔴 Unit turned OFF - room cool enough", {
                  entityId: entity.entityId,
                  roomTemp,
                  threshold:
                    hvacOptions.cooling.temperatureThresholds.indoorMin,
                  deficit: (
                    hvacOptions.cooling.temperatureThresholds.indoorMin -
                    roomTemp
                  ).toFixed(1),
                });
              } else {
                // Room temperature in acceptable range - maintain current state
                logger.info(
                  "✅ Unit state maintained - room temperature acceptable",
                  {
                    entityId: entity.entityId,
                    roomTemp,
                    minThreshold:
                      hvacOptions.cooling.temperatureThresholds.indoorMin,
                    maxThreshold:
                      hvacOptions.cooling.temperatureThresholds.indoorMax,
                  },
                );
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
        },

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

          for (const entity of enabledEntities) {
            try {
              await controlHVACEntity(
                haClient,
                entity.entityId,
                "off",
                undefined,
                undefined,
                logger,
              );
              logger.debug("✅ Entity turned off", {
                entityId: entity.entityId,
              });
            } catch (error) {
              logger.error("❌ Failed to turn off entity", error, {
                entityId: entity.entityId,
              });
            }
          }
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
          if (!context.indoorTemp || !context.outdoorTemp) return false;

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
          if (!context.indoorTemp || !context.outdoorTemp) return false;

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

        canDefrost: ({ context }) => {
          if (!context.indoorTemp || !context.outdoorTemp) return false;

          const evaluation = hvacStrategy.evaluateConditions({
            currentTemp: context.indoorTemp,
            weatherTemp: context.outdoorTemp,
            hour: context.currentHour,
            isWeekday: context.isWeekday,
          });

          logger.debug("🔍 Defrost guard evaluation", {
            required: evaluation.needsDefrost,
            reason: evaluation.needsDefrost
              ? "Defrost cycle required"
              : "Defrost not needed",
          });
          return evaluation.needsDefrost;
        },

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

          if (!context.indoorTemp || !context.outdoorTemp) return false;

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
): Promise<void> {
  if (!haClient) return;

  if (mode === "off") {
    // Turn off entity - turn_off service doesn't need additional parameters
    // Import HassServiceCallImpl dynamically to avoid circular dependency
    const { HassServiceCallImpl } = await import("../home-assistant/models.ts");
    const offCall = HassServiceCallImpl.climate("turn_off", entityId, {});
    await haClient.callService(offCall);
  } else {
    // Set HVAC mode (heat, cool, etc.)
    await haClient.controlEntity(
      entityId,
      "climate",
      "set_hvac_mode",
      { type: "state", key: "hvac_mode" },
      mode,
    );

    // Set temperature if provided
    if (targetTemp !== undefined) {
      await haClient.controlEntity(
        entityId,
        "climate",
        "set_temperature",
        { type: "attribute", key: "temperature" },
        targetTemp,
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

  constructor(hvacOptions?: HvacOptions, haClient?: HomeAssistantClient) {
    this.logger = new LoggerService("HAG.hvac.state-machine");
    this.machine = createHVACMachine(hvacOptions!, this.logger, haClient);
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
   * Stop the state machine
   */
  stop(): void {
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
