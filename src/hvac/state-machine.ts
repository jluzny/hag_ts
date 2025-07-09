/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import { ActorRefFrom, assign, createActor, createMachine, raise } from 'xstate';
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
  | { type: 'MODE_CHANGE'; mode: HVACMode; temperature?: number; isManual?: boolean }
  | { type: 'AUTO_EVALUATE' }
  | { type: 'DEFROST_CONTROL'; action: 'start' | 'complete' }
  | { type: 'UPDATE_DATA'; temperatures?: { indoor: number; outdoor: number }; conditions?: Partial<HVACContext> }
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

  constructor(private hvacOptions: HvacOptions) {}

  /**
   * Unified evaluation method that returns all condition checks
   */
  evaluateConditions(data: StateChangeData): HVACEvaluation {
    const evaluationStart = Date.now();
    
    const shouldHeat = this.shouldHeat(data);
    const shouldCool = this.shouldCool(data);
    const needsDefrost = this.needsDefrost(data);
    
    const evaluationTime = Date.now() - evaluationStart;
    
    let reason = 'no_action_needed';
    if (needsDefrost) reason = 'defrost_required';
    else if (shouldHeat) reason = 'heating_required';
    else if (shouldCool) reason = 'cooling_required';
    
    this.logger.info('🔍 HVAC conditions evaluated', {
      shouldHeat,
      shouldCool,
      needsDefrost,
      reason,
      evaluationTimeMs: evaluationTime,
      indoorTemp: data.currentTemp,
      outdoorTemp: data.weatherTemp,
      hour: data.hour,
      isWeekday: data.isWeekday,
    });

    return {
      shouldHeat,
      shouldCool,
      needsDefrost,
      reason,
      evaluationTimeMs: evaluationTime,
    };
  }

  private shouldHeat(data: StateChangeData): boolean {
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp >= thresholds.indoorMax) {
      return false;
    }

    // Check if conditions are valid for heating
    if (!this.isValidCondition(data, thresholds)) {
      return false;
    }

    const shouldHeat = data.currentTemp < thresholds.indoorMin;
    
    if (shouldHeat) {
      this.logger.info('✅ Heating approved', {
        currentTemp: data.currentTemp,
        indoorMin: thresholds.indoorMin,
        tempDifference: thresholds.indoorMin - data.currentTemp,
      });
    }
    
    return shouldHeat;
  }

  private shouldCool(data: StateChangeData): boolean {
    const { cooling } = this.hvacOptions;
    const thresholds = cooling.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp <= thresholds.indoorMin) {
      return false;
    }

    // Check if conditions are valid for cooling
    if (!this.isValidCondition(data, thresholds)) {
      return false;
    }

    const shouldCool = data.currentTemp > thresholds.indoorMin;
    
    if (shouldCool) {
      this.logger.info('✅ Cooling approved', {
        currentTemp: data.currentTemp,
        indoorMin: thresholds.indoorMin,
        tempDifference: data.currentTemp - thresholds.indoorMin,
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

    this.logger.info('❄️ Defrost cycle started', {
      startTime: this.lastDefrost.toISOString(),
      durationSeconds: this.hvacOptions.heating.defrost?.durationSeconds || 300,
    });
  }

  /**
   * Unified validation logic for temperature and time conditions
   */
  private isValidCondition(data: StateChangeData, thresholds: { outdoorMin: number; outdoorMax: number }): boolean {
    return this.isWithinTemperatureRange(data, thresholds) && 
           this.isActiveHour(data.hour, data.isWeekday);
  }

  private isWithinTemperatureRange(data: StateChangeData, thresholds: { outdoorMin: number; outdoorMax: number }): boolean {
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
    } satisfies HVACContext,
    states: {
      idle: {
        entry: 'logStateEntry',
        on: {
          // New consolidated events
          MODE_CHANGE: [
            {
              target: 'heating',
              guard: ({ context, event }) => event.mode === HVACMode.HEAT && context.systemMode !== SystemMode.COOL_ONLY && context.systemMode !== SystemMode.OFF,
            },
            {
              target: 'cooling',
              guard: ({ context, event }) => event.mode === HVACMode.COOL && context.systemMode !== SystemMode.HEAT_ONLY && context.systemMode !== SystemMode.OFF,
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
            actions: ['updateTemperatures', 'triggerAutoEvaluate', raise({ type: 'AUTO_EVALUATE' })],
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
        let message = '🔄 [HVAC] State transition';
        if (eventType) {
          message += ` triggered by: ${eventType}`;
        }
        logger.info(message, {
          toState: event.type,
          event, // Log the entire event object for debugging
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          systemMode: context.systemMode,
          currentHour: context.currentHour,
          isWeekday: context.isWeekday,
          timestamp: new Date().toISOString(),
        });
      },
      logHeatingStart: ({ context }) => {
        logger.info(`🔥 [HVAC] Starting heating mode`, {
          targetTemp: hvacOptions.heating.temperature,
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          presetMode: hvacOptions.heating.presetMode,
          thresholds: hvacOptions.heating.temperatureThresholds,
          timestamp: new Date().toISOString(),
        });
      },
      logCoolingStart: ({ context }) => {
        logger.info(`❄️ [HVAC] Starting cooling mode`, {
          targetTemp: hvacOptions.cooling.temperature,
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          presetMode: hvacOptions.cooling.presetMode,
          thresholds: hvacOptions.cooling.temperatureThresholds,
          timestamp: new Date().toISOString(),
        });
      },
      processManualOverride: (_, event) => {
        logger.info(`🎯 [HVAC] Manual override activated`, {
          event,
          timestamp: new Date().toISOString(),
        });
      },
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
        if (context.indoorTemp !== undefined && context.outdoorTemp !== undefined) {
          logger.info('🎯 Triggering condition evaluation', {
            currentState: 'idle',
            hasTemperatureData: true,
            indoorTemp: context.indoorTemp,
            outdoorTemp: context.outdoorTemp,
            systemMode: context.systemMode,
            currentHour: context.currentHour,
            isWeekday: context.isWeekday,
            timestamp: new Date().toISOString(),
          });
          
          logger.info('Sending AUTO_EVALUATE event');
        }
      },
      startDefrost: () => {
        hvacStrategy.startDefrost();
        logger.info(`❄️ [HVAC] Defrost cycle started`, {
          durationSeconds: hvacOptions.heating.defrost?.durationSeconds || 300,
          timestamp: new Date().toISOString(),
        });
      },
      completeDefrost: () => {
        logger.info(`✅ [HVAC] Defrost cycle completed`, {
          timestamp: new Date().toISOString(),
          nextState: 'heating',
        });
      },
      executeHeating: async () => {
        if (!haClient) {
          logger.warning('⚠️ No Home Assistant client available for heating control');
          return;
        }

        const enabledEntities = hvacOptions.hvacEntities.filter(e => e.enabled);
        
        logger.info('🔥 Executing heating mode on entities', {
          targetTemp: hvacOptions.heating.temperature,
          presetMode: hvacOptions.heating.presetMode,
          enabledEntities: enabledEntities.length,
          entities: enabledEntities.map(e => e.entityId),
        });

        for (const entity of enabledEntities) {
          try {
            await controlHVACEntity(haClient, entity.entityId, 'heat', hvacOptions.heating.temperature, hvacOptions.heating.presetMode, logger);
            logger.info('✅ Heating entity controlled', {
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
          logger.warning('⚠️ No Home Assistant client available for cooling control');
          return;
        }

        const enabledEntities = hvacOptions.hvacEntities.filter(e => e.enabled);
        
        logger.info('❄️ Executing cooling mode on entities', {
          targetTemp: hvacOptions.cooling.temperature,
          presetMode: hvacOptions.cooling.presetMode,
          enabledEntities: enabledEntities.length,
          entities: enabledEntities.map(e => e.entityId),
        });

        for (const entity of enabledEntities) {
          try {
            await controlHVACEntity(haClient, entity.entityId, 'cool', hvacOptions.cooling.temperature, hvacOptions.cooling.presetMode, logger);
            logger.info('✅ Cooling entity controlled', {
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
       * Unified guard logic - evaluates all conditions using single strategy
       */
      
      canHeat: ({ context }) => {
        // Check system mode restrictions
        if (context.systemMode === SystemMode.COOL_ONLY || context.systemMode === SystemMode.OFF) {
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
        
        logger.info('🔍 Heat evaluation', { result: evaluation.shouldHeat, evaluation });
        return evaluation.shouldHeat;
      },
      
      canCool: ({ context }) => {
        // Check system mode restrictions
        if (context.systemMode === SystemMode.HEAT_ONLY || context.systemMode === SystemMode.OFF) {
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
        
        logger.info('🔍 Cool evaluation', { result: evaluation.shouldCool, evaluation });
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
        
        logger.info('🔍 Auto heat evaluation', { result: evaluation.shouldHeat, evaluation });
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
        
        logger.info('🔍 Auto cool evaluation', { result: evaluation.shouldCool, evaluation });
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
        
        logger.info('🔍 Defrost evaluation', { result: evaluation.needsDefrost, evaluation });
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
    this.logger.debug('📍 HVACStateMachine.constructor() ENTRY');
    this.machine = createHVACMachine(hvacOptions!, this.logger, haClient);
    this.logger.debug('📍 HVACStateMachine.constructor() EXIT');
  }

  /**
   * Start the state machine
   */
  start(): void {
    this.logger.debug('📍 HVACStateMachine.start() ENTRY');
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
      this.logger.error('❌ Cannot send event: state machine not running', {
        event,
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
