/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import {
  ActorRefFrom,
  assign,
  createActor,
  createMachine,
} from 'xstate';
import { injectable } from '@needle-di/core';
import {
  type DefrostOptions as _DefrostOptions,
  type HvacOptions,
  type TemperatureThresholds as _TemperatureThresholds,
} from '../config/config.ts';
import {
  HVACContext,
  HVACMode,
  StateChangeData,
  SystemMode,
} from '../types/common.ts';
import { StateError } from '../core/exceptions.ts';
import { LoggerService } from '../core/logging.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';

/**
 * Simplified HVAC events that can trigger state transitions
 */
export type HVACEvent =
  | {
    type: 'MODE_CHANGE';
    mode: HVACMode;
    temperature?: number;
    isManual?: boolean;
  }
  | { type: 'AUTO_EVALUATE' }
  | { type: 'DEFROST_CONTROL'; action: 'start' | 'complete' }
  | {
    type: 'UPDATE_DATA';
    temperatures?: { indoor: number; outdoor: number };
    conditions?: Partial<HVACContext>;
  }
  // Legacy events for backward compatibility
  | { type: 'HEAT' }
  | { type: 'COOL' }
  | { type: 'OFF' }
  | { type: 'DEFROST_NEEDED' }
  | { type: 'DEFROST_COMPLETE' }
  | { type: 'UPDATE_CONDITIONS'; data: Partial<HVACContext> }
  | { type: 'UPDATE_TEMPERATURES'; indoor: number; outdoor: number }
  | { type: 'MANUAL_OVERRIDE'; mode: HVACMode; temperature?: number };

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
  reason: string;
  evaluationTimeMs: number;
}

/**
 * Unified HVAC strategy for heating and cooling logic
 */
export class HVACStrategy {
  private lastDefrost?: Date;
  private logger = new LoggerService('HAG.hvac.strategy');
  private evaluationCache?: {
    input: string;
    result: HVACEvaluation;
    timestamp: number;
  };

  constructor(private hvacOptions: HvacOptions) {}

  /**
   * Unified evaluation method that returns all condition checks
   */
  evaluateConditions(data: StateChangeData): HVACEvaluation {
    const evaluationStart = Date.now();
    
    // Create a cache key from the input data
    const inputKey = JSON.stringify(data);
    const now = Date.now();
    
    // Check if we have a recent evaluation for the same input
    if (this.evaluationCache && 
        this.evaluationCache.input === inputKey && 
        (now - this.evaluationCache.timestamp) < this.hvacOptions.evaluationCacheMs) {
      return this.evaluationCache.result;
    }

    const shouldHeat = this.shouldHeat(data);
    const shouldCool = this.shouldCool(data);
    const needsDefrost = this.needsDefrost(data);

    const evaluationTime = Date.now() - evaluationStart;

    let reason = 'no_action_needed';
    let humanReason = 'All conditions satisfied - no HVAC action required';
    
    if (needsDefrost) {
      reason = 'defrost_required';
      humanReason = `Defrost cycle needed - outdoor temperature ${data.weatherTemp}°C is below threshold`;
    } else if (shouldHeat) {
      reason = 'heating_required';
      const tempDiff = this.hvacOptions.heating.temperatureThresholds.indoorMin - data.currentTemp;
      humanReason = `Heating required - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C below minimum ${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C`;
    } else if (shouldCool) {
      reason = 'cooling_required';
      const tempDiff = data.currentTemp - this.hvacOptions.cooling.temperatureThresholds.indoorMin;
      humanReason = `Cooling required - indoor ${data.currentTemp}°C is ${tempDiff.toFixed(1)}°C above maximum ${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`;
    }

    // Enhanced human-readable logging
    if (shouldHeat || shouldCool || needsDefrost) {
      this.logger.info('🔍 HVAC Decision Made', {
        decision: humanReason,
        mode: needsDefrost ? 'DEFROST' : shouldHeat ? 'HEAT' : 'COOL',
        currentConditions: {
          indoorTemp: `${data.currentTemp}°C`,
          outdoorTemp: `${data.weatherTemp}°C`,
          timeOfDay: `${data.hour}:00 ${data.isWeekday ? 'weekday' : 'weekend'}`,
        },
        thresholds: shouldHeat ? {
          minIndoor: `${this.hvacOptions.heating.temperatureThresholds.indoorMin}°C`,
          outdoorRange: `${this.hvacOptions.heating.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.heating.temperatureThresholds.outdoorMax}°C`,
        } : shouldCool ? {
          maxIndoor: `${this.hvacOptions.cooling.temperatureThresholds.indoorMin}°C`,
          outdoorRange: `${this.hvacOptions.cooling.temperatureThresholds.outdoorMin}°C - ${this.hvacOptions.cooling.temperatureThresholds.outdoorMax}°C`,
        } : undefined,
        evaluationTimeMs: evaluationTime,
      });
    } else {
      this.logger.debug('🔍 HVAC Evaluation Complete', {
        decision: humanReason,
        currentConditions: {
          indoorTemp: `${data.currentTemp}°C`,
          outdoorTemp: `${data.weatherTemp}°C`,
        },
        evaluationTimeMs: evaluationTime,
      });
    }

    const result = {
      shouldHeat,
      shouldCool,
      needsDefrost,
      reason,
      evaluationTimeMs: evaluationTime,
    };

    // Cache the result for subsequent calls with the same input
    this.evaluationCache = {
      input: inputKey,
      result,
      timestamp: now,
    };

    return result;
  }

  private shouldHeat(data: StateChangeData): boolean {
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp >= thresholds.indoorMax) {
      this.logger.info('❌ Heating blocked - indoor temp at/above maximum', {
        currentTemp: `${data.currentTemp}°C`,
        maxThreshold: `${thresholds.indoorMax}°C`,
        reason: 'Indoor temperature is already at or above maximum heating threshold'
      });
      return false;
    }

    // Check if conditions are valid for heating
    if (!this.isValidCondition(data, thresholds)) {
      const timeReason = !this.isActiveHour(data.hour, data.isWeekday) 
        ? `outside active hours (current: ${data.hour}:00)` 
        : 'within active hours';
      const tempReason = !this.isWithinTemperatureRange(data, thresholds)
        ? `outdoor temp ${data.weatherTemp}°C outside range ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C`
        : 'outdoor temp within range';
      
      this.logger.info('❌ Heating blocked - invalid conditions', {
        currentTemp: `${data.currentTemp}°C`,
        outdoorTemp: `${data.weatherTemp}°C`,
        timeCheck: timeReason,
        temperatureCheck: tempReason,
        reason: 'Operating conditions not suitable for heating'
      });
      return false;
    }

    const shouldHeat = data.currentTemp < thresholds.indoorMin;

    if (shouldHeat) {
      this.logger.info('✅ Heating conditions met', {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        tempDeficit: `${(thresholds.indoorMin - data.currentTemp).toFixed(1)}°C below minimum`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? 'weekday' : 'weekend'}`,
      });
    } else {
      this.logger.info('ℹ️ Heating not needed', {
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
      this.logger.info('❌ Cooling blocked - indoor temp at/below minimum', {
        currentTemp: `${data.currentTemp}°C`,
        minThreshold: `${thresholds.indoorMin}°C`,
        reason: 'Indoor temperature is already at or below minimum cooling threshold'
      });
      return false;
    }

    // Check if conditions are valid for cooling
    if (!this.isValidCondition(data, thresholds)) {
      const timeReason = !this.isActiveHour(data.hour, data.isWeekday) 
        ? `outside active hours (current: ${data.hour}:00)` 
        : 'within active hours';
      const tempReason = !this.isWithinTemperatureRange(data, thresholds)
        ? `outdoor temp ${data.weatherTemp}°C outside range ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C`
        : 'outdoor temp within range';
      
      this.logger.info('❌ Cooling blocked - invalid conditions', {
        currentTemp: `${data.currentTemp}°C`,
        outdoorTemp: `${data.weatherTemp}°C`,
        timeCheck: timeReason,
        temperatureCheck: tempReason,
        reason: 'Operating conditions not suitable for cooling'
      });
      return false;
    }

    const shouldCool = data.currentTemp > thresholds.indoorMin;

    if (shouldCool) {
      this.logger.info('✅ Cooling conditions met', {
        currentTemp: `${data.currentTemp}°C`,
        maxThreshold: `${thresholds.indoorMin}°C`,
        tempExcess: `${(data.currentTemp - thresholds.indoorMin).toFixed(1)}°C above maximum`,
        outdoorTemp: `${data.weatherTemp}°C (within ${thresholds.outdoorMin}°C-${thresholds.outdoorMax}°C range)`,
        timeOfDay: `${data.hour}:00 ${data.isWeekday ? 'weekday' : 'weekend'}`,
      });
    } else {
      this.logger.info('ℹ️ Cooling not needed', {
        currentTemp: `${data.currentTemp}°C`,
        maxThreshold: `${thresholds.indoorMin}°C`,
        tempBelowMax: `${(thresholds.indoorMin - data.currentTemp).toFixed(1)}°C below maximum`,
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

    this.logger.info('❄️ Defrost cycle started', {
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
    return this.isWithinTemperatureRange(data, thresholds) &&
      this.isActiveHour(data.hour, data.isWeekday);
  }

  private isWithinTemperatureRange(
    data: StateChangeData,
    thresholds: { outdoorMin: number; outdoorMax: number },
  ): boolean {
    return data.weatherTemp >= thresholds.outdoorMin &&
      data.weatherTemp <= thresholds.outdoorMax;
  }

  private isActiveHour(hour: number, isWeekday: boolean): boolean {
    const activeHours = this.hvacOptions.activeHours;
    if (!activeHours) return true;

    const start = isWeekday ? activeHours.startWeekday : activeHours.start;
    return hour >= start && hour <= activeHours.end;
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

  return createMachine({
    id: 'hvac',
    initial: 'idle',
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
        entry: 'logStateEntry',
        on: {
          // New consolidated events
          MODE_CHANGE: [
            {
              target: 'heating',
              guard: ({ context, event }) =>
                event.mode === HVACMode.HEAT &&
                context.systemMode !== SystemMode.COOL_ONLY &&
                context.systemMode !== SystemMode.OFF,
            },
            {
              target: 'cooling',
              guard: ({ context, event }) =>
                event.mode === HVACMode.COOL &&
                context.systemMode !== SystemMode.HEAT_ONLY &&
                context.systemMode !== SystemMode.OFF,
            },
            {
              target: 'evaluating',
              actions: 'processManualOverride',
              guard: ({ event }) => event.isManual === true,
            },
          ],
          UPDATE_DATA: {
            actions: 'updateData',
          },
          // Legacy events for backward compatibility
          HEAT: {
            target: 'heating',
            guard: 'canHeat',
          },
          COOL: {
            target: 'cooling',
            guard: 'canCool',
          },
          AUTO_EVALUATE: {
            target: 'evaluating',
          },
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: [
              'updateTemperatures',
              'triggerAutoEvaluate',
            ],
          },
          MANUAL_OVERRIDE: {
            target: 'evaluating',
            actions: 'processManualOverride',
          },
        },
      },
      evaluating: {
        entry: 'logStateEntry',
        always: [
          {
            target: 'idle',
            guard: 'isManualOff',
          },
          {
            target: 'heating',
            guard: 'isManualHeat',
          },
          {
            target: 'cooling',
            guard: 'isManualCool',
          },
          {
            target: 'heating',
            guard: 'shouldAutoHeat',
          },
          {
            target: 'cooling',
            guard: 'shouldAutoCool',
          },
          {
            target: 'idle',
          },
        ],
        on: {
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: 'updateTemperatures',
          },
        },
      },
      heating: {
        entry: ['logStateEntry', 'logHeatingStart', 'executeHeating'],
        on: {
          OFF: 'idle',
          COOL: {
            target: 'cooling',
            guard: 'canCool',
          },
          DEFROST_NEEDED: {
            target: 'defrosting',
            guard: 'canDefrost',
          },
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: 'updateTemperatures',
          },
          AUTO_EVALUATE: {
            target: 'evaluating',
          },
          MANUAL_OVERRIDE: {
            target: 'evaluating',
            actions: 'processManualOverride',
          },
        },
      },
      cooling: {
        entry: ['logStateEntry', 'logCoolingStart', 'executeCooling'],
        on: {
          OFF: 'idle',
          HEAT: {
            target: 'heating',
            guard: 'canHeat',
          },
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: 'updateTemperatures',
          },
          AUTO_EVALUATE: {
            target: 'evaluating',
          },
          MANUAL_OVERRIDE: {
            target: 'evaluating',
            actions: 'processManualOverride',
          },
        },
      },
      defrosting: {
        entry: ['logStateEntry', 'startDefrost'],
        on: {
          OFF: 'idle',
          DEFROST_COMPLETE: 'heating',
          MANUAL_OVERRIDE: {
            target: 'evaluating',
            actions: 'processManualOverride',
          },
        },
        after: {
          // Defrost duration from configuration
          [`${hvacOptions.heating.defrost?.durationSeconds ?? 300}000`]: {
            target: 'heating',
            actions: 'completeDefrost',
          },
        },
      },
    },
  }, {
    actions: {
      logStateEntry: ({ context, event }) => {
        const eventType = (event as unknown as { type?: string })?.type;
        // Only log significant state changes to reduce noise
        // Skip AUTO_EVALUATE events as they're logged by the subscription
        if (
          eventType &&
          !['UPDATE_TEMPERATURES', 'UPDATE_CONDITIONS', 'UPDATE_DATA', 'AUTO_EVALUATE'].includes(
            eventType,
          )
        ) {
          logger.info('🔄 [HVAC] State transition', {
            event: eventType,
            indoorTemp: context.indoorTemp,
            outdoorTemp: context.outdoorTemp,
            systemMode: context.systemMode,
          });
        } else {
          logger.debug('🔄 [HVAC] State entry', {
            event: eventType,
            indoorTemp: context.indoorTemp,
            outdoorTemp: context.outdoorTemp,
          });
        }
      },
      logModeStart: ({ context, event }) => {
        const mode = (event as { mode?: string })?.mode || 'unknown';
        const icon = mode === 'heating'
          ? '🔥'
          : mode === 'cooling'
          ? '❄️'
          : '🔍';
        logger.info(`${icon} [HVAC] Starting ${mode} mode`, {
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          systemMode: context.systemMode,
        });
      },
      // Legacy actions for backward compatibility
      logHeatingStart: ({ context }) => {
        logger.info(`🔥 [HVAC] Starting heating mode`, {
          targetTemp: hvacOptions.heating.temperature,
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          presetMode: hvacOptions.heating.presetMode,
          thresholds: hvacOptions.heating.temperatureThresholds,
        });
      },
      logCoolingStart: ({ context }) => {
        logger.info(`❄️ [HVAC] Starting cooling mode`, {
          targetTemp: hvacOptions.cooling.temperature,
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          presetMode: hvacOptions.cooling.presetMode,
          thresholds: hvacOptions.cooling.temperatureThresholds,
        });
      },
      processManualOverride: assign(({ context, event }) => {
        if (event.type !== 'MANUAL_OVERRIDE') return context;
        
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
      updateData: assign(({ context, event }) => {
        if (event.type !== 'UPDATE_DATA') return context;

        let newContext = { ...context };

        // Update temperatures if provided
        if (event.temperatures) {
          newContext = {
            ...newContext,
            indoorTemp: event.temperatures.indoor,
            outdoorTemp: event.temperatures.outdoor,
            currentHour: new Date().getHours(),
            isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
          };
        }

        // Update conditions if provided
        if (event.conditions) {
          newContext = { ...newContext, ...event.conditions };
        }

        return newContext;
      }),
      updateConditions: assign(({ context, event }) => {
        if (event.type !== 'UPDATE_CONDITIONS') return context;
        return { ...context, ...event.data };
      }),
      updateTemperatures: assign(({ context, event }) => {
        if (event.type !== 'UPDATE_TEMPERATURES') return context;
        return {
          ...context,
          indoorTemp: event.indoor,
          outdoorTemp: event.outdoor,
          currentHour: new Date().getHours(),
          isWeekday: new Date().getDay() >= 1 && new Date().getDay() <= 5,
        };
      }),
      triggerAutoEvaluate: ({ context }) => {
        if (
          context.indoorTemp !== undefined && context.outdoorTemp !== undefined
        ) {
          logger.debug('🎯 Conditions ready for evaluation', {
            indoorTemp: context.indoorTemp,
            outdoorTemp: context.outdoorTemp,
            systemMode: context.systemMode,
          });
          // Note: AUTO_EVALUATE will be triggered by the controller
        }
      },
      handleDefrost: ({ event }) => {
        const action = (event as { action?: string })?.action || 'start';

        if (action === 'start') {
          hvacStrategy.startDefrost();
          logger.info(`❄️ [HVAC] Defrost cycle started`, {
            durationSeconds: hvacOptions.heating.defrost?.durationSeconds ||
              300,
          });
        } else if (action === 'complete') {
          logger.info(`✅ [HVAC] Defrost cycle completed`, {
            nextState: 'heating',
          });
        }
      },
      // Legacy actions for backward compatibility
      startDefrost: () => {
        hvacStrategy.startDefrost();
        logger.info(`❄️ [HVAC] Defrost cycle started`, {
          durationSeconds: hvacOptions.heating.defrost?.durationSeconds || 300,
        });
      },
      completeDefrost: () => {
        logger.info(`✅ [HVAC] Defrost cycle completed`, {
          nextState: 'heating',
        });
      },
      executeMode: async ({ event }) => {
        if (!haClient) {
          logger.warning(
            '⚠️ No Home Assistant client available for HVAC control',
          );
          return;
        }

        const mode = (event as { mode?: string })?.mode || 'unknown';
        const isHeating = mode === 'heating';
        const config = isHeating ? hvacOptions.heating : hvacOptions.cooling;
        const hvacMode = isHeating ? 'heat' : 'cool';
        const icon = isHeating ? '🔥' : '❄️';
        const modeText = isHeating ? 'heating' : 'cooling';

        const enabledEntities = hvacOptions.hvacEntities.filter((e) =>
          e.enabled
        );

        logger.info(`${icon} Executing ${modeText} mode on entities`, {
          targetTemp: config.temperature,
          presetMode: config.presetMode,
          enabledEntities: enabledEntities.length,
        });

        for (const entity of enabledEntities) {
          try {
            await controlHVACEntity(
              haClient,
              entity.entityId,
              hvacMode,
              config.temperature,
              config.presetMode,
              logger,
            );
            logger.debug(`✅ ${modeText} entity controlled`, {
              entityId: entity.entityId,
              temperature: config.temperature,
              presetMode: config.presetMode,
            });
          } catch (error) {
            logger.error(`❌ Failed to control ${modeText} entity`, error, {
              entityId: entity.entityId,
            });
          }
        }
      },
      // Legacy actions for backward compatibility
      executeHeating: async () => {
        if (!haClient) {
          logger.warning(
            '⚠️ No Home Assistant client available for heating control',
          );
          return;
        }

        const enabledEntities = hvacOptions.hvacEntities.filter((e) =>
          e.enabled
        );

        logger.info('🔥 Executing heating mode on entities', {
          targetTemp: hvacOptions.heating.temperature,
          presetMode: hvacOptions.heating.presetMode,
          enabledEntities: enabledEntities.length,
        });

        for (const entity of enabledEntities) {
          try {
            await controlHVACEntity(
              haClient,
              entity.entityId,
              'heat',
              hvacOptions.heating.temperature,
              hvacOptions.heating.presetMode,
              logger,
            );
            logger.debug('✅ Heating entity controlled', {
              entityId: entity.entityId,
              temperature: hvacOptions.heating.temperature,
              presetMode: hvacOptions.heating.presetMode,
            });
          } catch (error) {
            logger.error('❌ Failed to control heating entity', error, {
              entityId: entity.entityId,
            });
          }
        }
      },
      executeCooling: async () => {
        if (!haClient) {
          logger.warning(
            '⚠️ No Home Assistant client available for cooling control',
          );
          return;
        }

        const enabledEntities = hvacOptions.hvacEntities.filter((e) =>
          e.enabled
        );

        logger.info('❄️ Executing cooling mode on entities', {
          targetTemp: hvacOptions.cooling.temperature,
          presetMode: hvacOptions.cooling.presetMode,
          enabledEntities: enabledEntities.length,
        });

        for (const entity of enabledEntities) {
          try {
            await controlHVACEntity(
              haClient,
              entity.entityId,
              'cool',
              hvacOptions.cooling.temperature,
              hvacOptions.cooling.presetMode,
              logger,
            );
            logger.debug('✅ Cooling entity controlled', {
              entityId: entity.entityId,
              temperature: hvacOptions.cooling.temperature,
              presetMode: hvacOptions.cooling.presetMode,
            });
          } catch (error) {
            logger.error('❌ Failed to control cooling entity', error, {
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

      canHeat: ({ context }) => {
        // Check system mode restrictions
        if (
          context.systemMode === SystemMode.COOL_ONLY ||
          context.systemMode === SystemMode.OFF
        ) {
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

        logger.debug('🔍 Heat guard evaluation', {
          allowed: evaluation.shouldHeat,
          systemMode: context.systemMode,
          hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
          reason: evaluation.shouldHeat ? 'Heating conditions satisfied' : 'Heating conditions not met',
        });
        return evaluation.shouldHeat;
      },

      canCool: ({ context }) => {
        // Check system mode restrictions
        if (
          context.systemMode === SystemMode.HEAT_ONLY ||
          context.systemMode === SystemMode.OFF
        ) {
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

        logger.debug('🔍 Cool guard evaluation', {
          allowed: evaluation.shouldCool,
          systemMode: context.systemMode,
          hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
          reason: evaluation.shouldCool ? 'Cooling conditions satisfied' : 'Cooling conditions not met',
        });
        return evaluation.shouldCool;
      },

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

        logger.debug('🔍 Auto heat guard evaluation', {
          allowed: evaluation.shouldHeat,
          systemMode: context.systemMode,
          autoModeActive: context.systemMode === SystemMode.AUTO,
          reason: evaluation.shouldHeat ? 'Auto heating approved' : 'Auto heating denied',
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

        logger.debug('🔍 Auto cool guard evaluation', {
          allowed: evaluation.shouldCool,
          systemMode: context.systemMode,
          autoModeActive: context.systemMode === SystemMode.AUTO,
          reason: evaluation.shouldCool ? 'Auto cooling approved' : 'Auto cooling denied',
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

        logger.debug('🔍 Defrost guard evaluation', {
          required: evaluation.needsDefrost,
          hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
          reason: evaluation.needsDefrost ? 'Defrost cycle required' : 'Defrost not needed',
        });
        return evaluation.needsDefrost;
      },
    },
  });
}

/**
 * Control individual HVAC entity
 */
async function controlHVACEntity(
  haClient: HomeAssistantClient,
  entityId: string,
  mode: string,
  targetTemp: number,
  presetMode: string,
  logger: LoggerService,
): Promise<void> {
  if (!haClient) return;

  // Import HassServiceCallImpl dynamically to avoid circular dependency
  const { HassServiceCallImpl } = await import('../home-assistant/models.ts');

  // Set HVAC mode
  const modeCall = HassServiceCallImpl.climate('set_hvac_mode', entityId, {
    hvac_mode: mode,
  });
  await haClient.callService(modeCall);

  // Set temperature
  const tempCall = HassServiceCallImpl.climate('set_temperature', entityId, {
    temperature: targetTemp,
  });
  await haClient.callService(tempCall);

  // Set preset mode
  const presetCall = HassServiceCallImpl.climate('set_preset_mode', entityId, {
    preset_mode: presetMode,
  });
  await haClient.callService(presetCall);

  logger.debug('🎯 HVAC entity control completed', {
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
    this.logger = new LoggerService('HAG.hvac.state-machine');
    this.machine = createHVACMachine(hvacOptions!, this.logger, haClient);
  }

  /**
   * Start the state machine
   */
  start(): void {
    this.logger.info('🚀 Starting HVAC state machine', {
      machineId: this.machine.id,
      initialState: 'idle', // XState v5 doesn't expose initial directly
      alreadyRunning: !!this.actor,
    });

    if (this.actor) {
      this.logger.error('❌ State machine is already running');
      throw new StateError('State machine is already running');
    }

    this.actor = createActor(this.machine);

    // Add state transition logging
    this.actor.subscribe((snapshot) => {
      this.logger.info('🔄 State machine transition', {
        toState: snapshot.value,
        context: snapshot.context,
        status: snapshot.status,
        timestamp: new Date().toISOString(),
      });
    });

    this.actor.start();

    const initialSnapshot = this.actor.getSnapshot();

    this.logger.info('✅ HVAC state machine started', {
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
    this.logger.info('🛑 Stopping HVAC state machine', {
      currentState: this.actor?.getSnapshot().value || 'not_running',
      isRunning: !!this.actor,
    });

    if (this.actor) {
      const finalSnapshot = this.actor.getSnapshot();

      this.logger.debug('📋 Final state machine status', {
        finalState: finalSnapshot.value,
        finalContext: finalSnapshot.context,
        machineStatus: finalSnapshot.status,
      });

      this.actor.stop();
      this.actor = undefined;

      this.logger.info('✅ HVAC state machine stopped');
    } else {
      this.logger.debug('🔄 State machine was not running');
    }
  }

  /**
   * Send event to state machine
   */
  send(event: HVACEvent): void {
    if (!this.actor) {
      this.logger.error('❌ Cannot send event: state machine not running', new Error('State machine not running'), {
        eventType: event.type,
      });
      throw new StateError('State machine is not running');
    }

    const beforeSnapshot = this.actor.getSnapshot();

    this.logger.debug('📤 Sending event to state machine', {
      event,
      eventType: event.type,
      currentState: beforeSnapshot.value,
      context: beforeSnapshot.context,
      timestamp: new Date().toISOString(),
    });

    this.actor.send(event);

    const afterSnapshot = this.actor.getSnapshot();

    if (beforeSnapshot.value !== afterSnapshot.value) {
      this.logger.info('⚙️ Event triggered state transition', {
        event,
        fromState: beforeSnapshot.value,
        toState: afterSnapshot.value,
        contextChanged: JSON.stringify(beforeSnapshot.context) !==
          JSON.stringify(afterSnapshot.context),
      });
    } else {
      this.logger.debug('🔄 Event processed without state change', {
        event,
        currentState: afterSnapshot.value,
        contextChanged: JSON.stringify(beforeSnapshot.context) !==
          JSON.stringify(afterSnapshot.context),
      });
    }
  }

  /**
   * Get current state
   */
  getCurrentState(): string {
    if (!this.actor) {
      return 'stopped';
    }
    return this.actor.getSnapshot().value as string;
  }

  /**
   * Get current context
   */
  getContext(): HVACContext {
    if (!this.actor) {
      throw new StateError('State machine is not running');
    }
    return this.actor.getSnapshot().context;
  }

  /**
   * Trigger auto evaluation
   */
  evaluateConditions(): void {
    const currentState = this.getCurrentState();
    const context = this.getContext();

    this.logger.info('🎯 Triggering condition evaluation', {
      currentState,
      hasTemperatureData: !!(context.indoorTemp && context.outdoorTemp),
      indoorTemp: context.indoorTemp,
      outdoorTemp: context.outdoorTemp,
      systemMode: context.systemMode,
      currentHour: context.currentHour,
      isWeekday: context.isWeekday,
      timestamp: new Date().toISOString(),
    });

    this.logger.info('Sending AUTO_EVALUATE event');
    this.send({ type: 'AUTO_EVALUATE' });
  }

  /**
   * Manual HVAC override
   */
  manualOverride(mode: HVACMode, temperature?: number): void {
    const currentState = this.getCurrentState();
    const context = this.getContext();

    this.logger.info('🎯 Manual override initiated', {
      requestedMode: mode,
      requestedTemperature: temperature,
      currentState,
      currentContext: context,
      systemMode: context.systemMode,
      timestamp: new Date().toISOString(),
    });

    this.send({
      type: 'MANUAL_OVERRIDE',
      mode,
      temperature,
    });

    this.logger.debug('✅ Manual override event sent', {
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
      canHeat: context.systemMode !== SystemMode.COOL_ONLY &&
        context.systemMode !== SystemMode.OFF,
      canCool: context.systemMode !== SystemMode.HEAT_ONLY &&
        context.systemMode !== SystemMode.OFF,
      systemMode: context.systemMode,
    };
  }
}
