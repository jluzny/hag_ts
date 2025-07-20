/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import { ActorRefFrom, assign, createActor, createMachine } from "xstate";
import { injectable } from "@needle-di/core";
import {
  type HvacOptions,
} from "../config/config.ts";
import {
  HVACContext,
  HVACMode,
  StateChangeData,
  SystemMode,
} from "../types/common.ts";
import { StateError } from "../core/exceptions.ts";
import { LoggerService } from "../core/logging.ts";
import { HomeAssistantClient } from "../home-assistant/client.ts";

/**
 * Simplified HVAC events that can trigger state transitions
 */
export type HVACEvent =
  | {
    type: "MODE_CHANGE";
    mode: HVACMode;
    temperature?: number;
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

  constructor(private hvacOptions: HvacOptions) { }


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
    if (this.evaluationCache?.input === inputKey &&
      now - this.evaluationCache.timestamp < this.hvacOptions.evaluationCacheMs) {
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
        }
      };

      if (shouldTurnOff) {
        // Determine specific turn-off reason
        let turnOffReason = "unknown";
        if (!this.isActiveHour(data.hour, data.isWeekday)) {
          turnOffReason = `outside active hours (${data.hour}:00)`;
        }

        return {
          code: "turning_off",
          description: `Turning off required - conditions not met for operation`,
          getLogData: () => ({
            ...baseLogData,
            mode: "OFF",
            turnOffReason,
            activeHours: this.hvacOptions.activeHours
          })
        };
      }

      if (needsDefrost) return {
        code: "defrost_required",
        description: `Defrost needed - outdoor temp ${data.weatherTemp}°C below threshold`,
        getLogData: () => ({
          ...baseLogData,
          mode: "DEFROST"
        })
      };

      if (shouldHeat) {
        const tempDiff = this.hvacOptions.heating.temperatureThresholds.indoorMin - data.currentTemp;
        return {
          code: "heating_required",
          description: `Heating - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C below min`,
          getLogData: () => ({
            ...baseLogData,
            mode: "HEAT",
            thresholds: {
              minIndoor: `${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C`,
              outdoorRange: `${this.hvacOptions.heating.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.outdoorMax}°C`,
            }
          })
        };
      }

      if (shouldCool) {
        const tempDiff = data.currentTemp - this.hvacOptions.cooling.temperatureThresholds.indoorMin;
        return {
          code: "cooling_required",
          description: `Cooling - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C above max`,
          getLogData: () => ({
            ...baseLogData,
            mode: "COOL",
            thresholds: {
              maxIndoor: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`,
              outdoorRange: `${this.hvacOptions.cooling.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.outdoorMax}°C`,
            }
          })
        };
      }

      return {
        code: "no_action_needed",
        description: "All conditions satisfied - no HVAC action required"
      };
    })();

    // Unified logging
    this.logger.info("🔍 HVAC Evaluation Result", {
      decision: reason.description,
      ...(reason.getLogData?.(data) || { data })
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


  /**
   * Unified evaluation method that returns all condition checks
   */
  // evaluateConditions(data: StateChangeData): HVACEvaluation {
  //   const evaluationStart = Date.now();
  //
  //   // Create a cache key from the input data
  //   const inputKey = JSON.stringify(data);
  //   const now = Date.now();
  //
  //   // Check if we have a recent evaluation for the same input
  //   if (
  //     this.evaluationCache &&
  //     this.evaluationCache.input === inputKey &&
  //     now - this.evaluationCache.timestamp < this.hvacOptions.evaluationCacheMs
  //   ) {
  //     return this.evaluationCache.result;
  //   }
  //
  //   const shouldHeat = this.shouldHeat(data);
  //   const shouldCool = this.shouldCool(data);
  //   const needsDefrost = this.needsDefrost(data);
  //
  //   const evaluationTime = Date.now() - evaluationStart;
  //
  //   let reason = "no_action_needed";
  //   let humanReason = "All conditions satisfied - no HVAC action required";
  //
  //   if (needsDefrost) {
  //     reason = "defrost_required";
  //     humanReason = `Defrost cycle needed - outdoor temperature ${data.weatherTemp}°C is below threshold`;
  //   } else if (shouldHeat) {
  //     reason = "heating_required";
  //     const tempDiff =
  //       this.hvacOptions.heating.temperatureThresholds.indoorMin -
  //       data.currentTemp;
  //     humanReason = `Heating required - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C below minimum ${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C`;
  //   } else if (shouldCool) {
  //     reason = "cooling_required";
  //     const tempDiff =
  //       data.currentTemp -
  //       this.hvacOptions.cooling.temperatureThresholds.indoorMin;
  //     humanReason = `Cooling required - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C above maximum ${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`;
  //   }
  //
  //   // Enhanced human-readable logging
  //   if (shouldHeat || shouldCool || needsDefrost) {
  //     this.logger.info("🔍 HVAC Decision Made", {
  //       decision: humanReason,
  //       mode: needsDefrost ? "DEFROST" : shouldHeat ? "HEAT" : "COOL",
  //       currentConditions: {
  //         indoorTemp: `${data.currentTemp}°C`,
  //         outdoorTemp: `${data.weatherTemp}°C`,
  //         timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
  //       },
  //       thresholds: shouldHeat
  //         ? {
  //           minIndoor: `${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C`,
  //           outdoorRange: `${this.hvacOptions.heating.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.outdoorMax}°C`,
  //         }
  //         : shouldCool
  //           ? {
  //             maxIndoor: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`,
  //             outdoorRange: `${this.hvacOptions.cooling.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.outdoorMax}°C`,
  //           }
  //           : undefined,
  //       evaluationTimeMs: evaluationTime,
  //     });
  //   } else {
  //     this.logger.debug("🔍 HVAC Evaluation Complete", {
  //       decision: humanReason,
  //       data,
  //       evaluationTimeMs: evaluationTime,
  //     });
  //   }
  //
  //   const result = {
  //     shouldHeat,
  //     shouldCool,
  //     needsDefrost,
  //     reason,
  //     evaluationTimeMs: evaluationTime,
  //   };
  //
  //   // Cache the result for subsequent calls with the same input
  //   this.evaluationCache = {
  //     input: inputKey,
  //     result,
  //     timestamp: now,
  //   };
  //
  //   this.logger.info("🔍 HVAC Evaluation Result", {
  //     decision: humanReason,
  //     data,
  //     evaluationTimeMs: evaluationTime,
  //   });
  //
  //   return result;
  // }

  private shouldHeat(data: StateChangeData): boolean {
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp >= thresholds.indoorMax) {
      this.logger.info(
        "❌ Heating not activated - indoor temp at/above maximum",
        {
          currentTemp: `${data.currentTemp}°C`,
          maxThreshold: `${thresholds.indoorMax}°C`,
          reason:
            "Indoor temperature is already at or above maximum heating threshold",
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

      this.logger.info("❌ Heating not activated - invalid conditions", {
        currentTemp: `${data.currentTemp}°C`,
        outdoorTemp: `${data.weatherTemp}°C`,
        timeCheck: timeReason,
        temperatureCheck: tempReason,
        reason: "Operating conditions not suitable for heating",
      });
      return false;
    }

    const shouldHeat = data.currentTemp < thresholds.indoorMin;

    if (shouldHeat) {
      this.logger.info("✅ Heating conditions met", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempDeficit: `${(thresholds.indoorMin - data.currentTemp).toFixed(1)}°C below minimum`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
      });
    } else {
      this.logger.info("ℹ️ Heating not needed", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempAboveMin: `${(data.currentTemp - thresholds.indoorMin).toFixed(1)}°C above minimum`,
      });
    }

    return shouldHeat;
  }

  private shouldCool(data: StateChangeData): boolean {
    const { cooling } = this.hvacOptions;
    const thresholds = cooling.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp <= thresholds.indoorMin) {
      this.logger.info(
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

      this.logger.info("❌ Cooling not activated - invalid conditions", {
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
      this.logger.info("✅ Cooling conditions met", {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempExcess: `${(data.currentTemp - thresholds.indoorMin).toFixed(1)}°C above minimum`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? "weekday" : "weekend"}`,
      });
    } else {
      this.logger.info("ℹ️ Cooling not needed", {
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
   * Check if we should turn off all entities
   */
  shouldTurnOff(data: StateChangeData): boolean {
    return !this.isActiveHour(data.hour, data.isWeekday);
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
              },
              {
                target: "cooling",
                guard: ({ context, event }) =>
                  event.mode === HVACMode.COOL &&
                  context.systemMode !== SystemMode.HEAT_ONLY &&
                  context.systemMode !== SystemMode.OFF,
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
              actions: "updateConditions",
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
              actions: "updateConditions",
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
            !["UPDATE_CONDITIONS", "AUTO_EVALUATE"].includes(
              eventType,
            )
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
          logger.debug(
            "🎯 Starting HVAC auto-evaluate logic",
            {
              indoorTemp: context.indoorTemp,
              outdoorTemp: context.outdoorTemp,
              systemMode: context.systemMode,
            },
          );
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


        executeHeating: async () => {
          if (!haClient) {
            logger.warning(
              "⚠️ No Home Assistant client available for heating control",
            );
            return;
          }

          const enabledEntities = hvacOptions.hvacEntities.filter(
            (e) => e.enabled,
          );

          logger.info("🔥 Executing heating mode on entities", {
            targetTemp: hvacOptions.heating.temperature,
            presetMode: hvacOptions.heating.presetMode,
            enabledEntities: enabledEntities.length,
          });

          for (const entity of enabledEntities) {
            try {
              await controlHVACEntity(
                haClient,
                entity.entityId,
                "heat",
                hvacOptions.heating.temperature,
                hvacOptions.heating.presetMode,
                logger,
              );
              logger.debug("✅ Heating entity controlled", {
                entityId: entity.entityId,
                temperature: hvacOptions.heating.temperature,
                presetMode: hvacOptions.heating.presetMode,
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

          logger.info("❄️ Executing cooling mode on entities", {
            targetTemp: hvacOptions.cooling.temperature,
            presetMode: hvacOptions.cooling.presetMode,
            enabledEntities: enabledEntities.length,
          });

          for (const entity of enabledEntities) {
            try {
              await controlHVACEntity(
                haClient,
                entity.entityId,
                "cool",
                hvacOptions.cooling.temperature,
                hvacOptions.cooling.presetMode,
                logger,
              );
              logger.debug("✅ Cooling entity controlled", {
                entityId: entity.entityId,
                temperature: hvacOptions.cooling.temperature,
                presetMode: hvacOptions.cooling.presetMode,
              });
            } catch (error) {
              logger.error("❌ Failed to control cooling entity", error, {
                entityId: entity.entityId,
              });
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
          });

          for (const entity of enabledEntities) {
            try {
              await controlHVACEntity(haClient, entity.entityId, "off", undefined, undefined, logger);
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
         * Unified guard logic - evaluates all conditions using single strategy
         */


        shouldAutoHeat: ({ context }) => {
          // Check system mode is AUTO
          if (context.systemMode !== SystemMode.AUTO) {
            return false;
          }

          if (!context.indoorTemp || !context.outdoorTemp) {
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
            autoModeActive: context.systemMode === SystemMode.AUTO,
            reason: evaluation.shouldHeat
              ? "Auto heating approved"
              : "Auto heating denied",
          });
          return evaluation.shouldHeat;
        },

        shouldAutoCool: ({ context }) => {
          // Check system mode is AUTO
          if (context.systemMode !== SystemMode.AUTO) {
            return false;
          }

          if (!context.indoorTemp || !context.outdoorTemp) {
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
            autoModeActive: context.systemMode === SystemMode.AUTO,
            reason: evaluation.shouldCool
              ? "Auto cooling approved"
              : "Auto cooling denied",
          });
          return evaluation.shouldCool;
        },

        canDefrost: ({ context }) => {
          if (!context.indoorTemp || !context.outdoorTemp) {
            return false;
          }

          const evaluation = hvacStrategy.evaluateConditions({
            currentTemp: context.indoorTemp,
            weatherTemp: context.outdoorTemp,
            hour: context.currentHour,
            isWeekday: context.isWeekday,
          });

          logger.debug("🔍 Defrost guard evaluation", {
            required: evaluation.needsDefrost,
            hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
            reason: evaluation.needsDefrost
              ? "Defrost cycle required"
              : "Defrost not needed",
          });
          return evaluation.needsDefrost;
        },

        shouldTurnOff: ({ context }) => {
          if (!context.indoorTemp || !context.outdoorTemp) {
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
            hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
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
 * Generic HVAC entity control helper
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

  // Import HassServiceCallImpl dynamically to avoid circular dependency
  const { HassServiceCallImpl } = await import("../home-assistant/models.ts");

  if (mode === "off") {
    // Turn off entity
    const offCall = HassServiceCallImpl.climate("turn_off", entityId, {});
    await haClient.callService(offCall);
  } else {
    // Set HVAC mode (heat, cool, etc.)
    const modeCall = HassServiceCallImpl.climate("set_hvac_mode", entityId, {
      hvac_mode: mode,
    });
    await haClient.callService(modeCall);

    // Set temperature if provided
    if (targetTemp !== undefined) {
      const tempCall = HassServiceCallImpl.climate("set_temperature", entityId, {
        temperature: targetTemp,
      });
      await haClient.callService(tempCall);
    }

    // Set preset mode if provided
    if (presetMode) {
      const presetCall = HassServiceCallImpl.climate("set_preset_mode", entityId, {
        preset_mode: presetMode,
      });
      await haClient.callService(presetCall);
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

