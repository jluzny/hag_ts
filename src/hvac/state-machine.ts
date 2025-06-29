/**
 * HVAC state machine implementation for HAG JavaScript variant.
 *
 * XState-powered state machine with heating/cooling strategies.
 */

import { ActorRefFrom, assign, createActor, createMachine } from 'xstate';
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
import { LoggerService } from '../core/logger.ts';

/**
 * HVAC events that can trigger state transitions
 */
export type HVACEvent =
  | { type: 'HEAT' }
  | { type: 'COOL' }
  | { type: 'OFF' }
  | { type: 'AUTO_EVALUATE' }
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
 * HVAC strategies for heating and cooling logic
 */
export class HeatingStrategy {
  private lastDefrost?: Date;
  private logger = new LoggerService('HAG.hvac.heating-strategy');

  constructor(private hvacOptions: HvacOptions) {}

  shouldHeat(data: StateChangeData): boolean {
    const evaluationStart = Date.now();
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;

    this.logger.debug('🔥 Evaluating heating conditions', {
      currentTemp: data.currentTemp,
      weatherTemp: data.weatherTemp,
      hour: data.hour,
      isWeekday: data.isWeekday,
      thresholds,
      targetTemperature: heating.temperature,
    });

    // Check temperature conditions
    if (data.currentTemp >= thresholds.indoorMax) {
      this.logger.debug('❌ Heating rejected: indoor temp at/above max', {
        currentTemp: data.currentTemp,
        indoorMax: thresholds.indoorMax,
        reason: 'indoor_temp_too_high',
      });
      return false;
    }

    // Check outdoor temperature range
    if (
      data.weatherTemp < thresholds.outdoorMin ||
      data.weatherTemp > thresholds.outdoorMax
    ) {
      this.logger.debug('❌ Heating rejected: outdoor temp out of range', {
        weatherTemp: data.weatherTemp,
        outdoorMin: thresholds.outdoorMin,
        outdoorMax: thresholds.outdoorMax,
        reason: data.weatherTemp < thresholds.outdoorMin
          ? 'outdoor_too_cold'
          : 'outdoor_too_hot',
      });
      return false;
    }

    // Check active hours
    if (!this.isActiveHour(data.hour, data.isWeekday)) {
      this.logger.debug('❌ Heating rejected: outside active hours', {
        currentHour: data.hour,
        isWeekday: data.isWeekday,
        activeHours: this.hvacOptions.activeHours,
        reason: 'outside_active_hours',
      });
      return false;
    }

    const shouldHeat = data.currentTemp < thresholds.indoorMin;
    const evaluationTime = Date.now() - evaluationStart;

    this.logger.info(
      shouldHeat
        ? '✅ Heating approved'
        : '❌ Heating rejected: temp above min',
      {
        currentTemp: data.currentTemp,
        indoorMin: thresholds.indoorMin,
        shouldHeat,
        tempDifference: thresholds.indoorMin - data.currentTemp,
        evaluationTimeMs: evaluationTime,
        reason: shouldHeat ? 'temp_below_minimum' : 'temp_above_minimum',
      },
    );

    return shouldHeat;
  }

  needsDefrost(data: StateChangeData): boolean {
    const defrost = this.hvacOptions.heating.defrost;

    this.logger.debug('❄️ Evaluating defrost need', {
      weatherTemp: data.weatherTemp,
      defrostEnabled: !!defrost,
      lastDefrost: this.lastDefrost?.toISOString(),
      defrostConfig: defrost,
    });

    if (!defrost) {
      this.logger.debug('❌ Defrost disabled in configuration');
      return false;
    }

    // Check temperature threshold
    if (data.weatherTemp > defrost.temperatureThreshold) {
      this.logger.debug('❌ Defrost not needed: outdoor temp too warm', {
        weatherTemp: data.weatherTemp,
        temperatureThreshold: defrost.temperatureThreshold,
        tempDifference: data.weatherTemp - defrost.temperatureThreshold,
      });
      return false;
    }

    // Check time since last defrost
    if (this.lastDefrost) {
      const timeSinceDefrost = Date.now() - this.lastDefrost.getTime();
      const periodMs = defrost.periodSeconds * 1000;

      if (timeSinceDefrost < periodMs) {
        this.logger.debug(
          '❌ Defrost not needed: too soon since last defrost',
          {
            lastDefrost: this.lastDefrost.toISOString(),
            timeSinceDefrostMs: timeSinceDefrost,
            timeSinceDefrostMinutes: Math.round(timeSinceDefrost / 60000),
            periodSeconds: defrost.periodSeconds,
            remainingTimeMs: periodMs - timeSinceDefrost,
            remainingTimeMinutes: Math.round(
              (periodMs - timeSinceDefrost) / 60000,
            ),
          },
        );
        return false;
      }
    }

    this.logger.info('✅ Defrost needed', {
      weatherTemp: data.weatherTemp,
      temperatureThreshold: defrost.temperatureThreshold,
      lastDefrost: this.lastDefrost?.toISOString() || 'never',
      timeSinceLastDefrost: this.lastDefrost
        ? Math.round((Date.now() - this.lastDefrost.getTime()) / 60000) +
          ' minutes'
        : 'never',
      periodSeconds: defrost.periodSeconds,
      durationSeconds: defrost.durationSeconds,
    });

    return true;
  }

  startDefrost(): void {
    this.lastDefrost = new Date();

    this.logger.info('❄️ Defrost cycle started', {
      startTime: this.lastDefrost.toISOString(),
      durationSeconds: this.hvacOptions.heating.defrost?.durationSeconds || 300,
      expectedEndTime: new Date(
        this.lastDefrost.getTime() +
          (this.hvacOptions.heating.defrost?.durationSeconds || 300) * 1000,
      ).toISOString(),
    });
  }

  private isActiveHour(hour: number, isWeekday: boolean): boolean {
    const activeHours = this.hvacOptions.activeHours;
    if (!activeHours) return true;

    const start = isWeekday ? activeHours.startWeekday : activeHours.start;
    return hour >= start && hour <= activeHours.end;
  }
}

export class CoolingStrategy {
  private logger = new LoggerService('HAG.hvac.cooling-strategy');

  constructor(private hvacOptions: HvacOptions) {}

  shouldCool(data: StateChangeData): boolean {
    const evaluationStart = Date.now();
    const { cooling } = this.hvacOptions;
    const thresholds = cooling.temperatureThresholds;

    this.logger.debug('❄️ Evaluating cooling conditions', {
      currentTemp: data.currentTemp,
      weatherTemp: data.weatherTemp,
      hour: data.hour,
      isWeekday: data.isWeekday,
      thresholds,
      targetTemperature: cooling.temperature,
    });

    // Check temperature conditions
    if (data.currentTemp <= thresholds.indoorMin) {
      this.logger.debug('❌ Cooling rejected: indoor temp at/below min', {
        currentTemp: data.currentTemp,
        indoorMin: thresholds.indoorMin,
        reason: 'indoor_temp_too_low',
      });
      return false;
    }

    // Check outdoor temperature range
    if (
      data.weatherTemp < thresholds.outdoorMin ||
      data.weatherTemp > thresholds.outdoorMax
    ) {
      this.logger.debug('❌ Cooling rejected: outdoor temp out of range', {
        weatherTemp: data.weatherTemp,
        outdoorMin: thresholds.outdoorMin,
        outdoorMax: thresholds.outdoorMax,
        reason: data.weatherTemp < thresholds.outdoorMin
          ? 'outdoor_too_cold'
          : 'outdoor_too_hot',
      });
      return false;
    }

    // Check active hours
    if (!this.isActiveHour(data.hour, data.isWeekday)) {
      this.logger.debug('❌ Cooling rejected: outside active hours', {
        currentHour: data.hour,
        isWeekday: data.isWeekday,
        activeHours: this.hvacOptions.activeHours,
        reason: 'outside_active_hours',
      });
      return false;
    }

    const shouldCool = data.currentTemp > thresholds.indoorMax;
    const evaluationTime = Date.now() - evaluationStart;

    this.logger.info(
      shouldCool
        ? '✅ Cooling approved'
        : '❌ Cooling rejected: temp below max',
      {
        currentTemp: data.currentTemp,
        indoorMax: thresholds.indoorMax,
        shouldCool,
        tempDifference: data.currentTemp - thresholds.indoorMax,
        evaluationTimeMs: evaluationTime,
        reason: shouldCool ? 'temp_above_maximum' : 'temp_below_maximum',
      },
    );

    return shouldCool;
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
) {
  const heatingStrategy = new HeatingStrategy(hvacOptions);
  const coolingStrategy = new CoolingStrategy(hvacOptions);

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
            actions: 'updateTemperatures',
          },
          MANUAL_OVERRIDE: {
            target: 'manualOverride',
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
            target: 'off',
          },
        ],
      },
      off: {
        entry: 'logStateEntry',
        on: {
          AUTO_EVALUATE: {
            target: 'evaluating',
          },
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: 'updateTemperatures',
          },
          HEAT: {
            target: 'heating',
            guard: 'canHeat',
          },
          COOL: {
            target: 'cooling',
            guard: 'canCool',
          },
          MANUAL_OVERRIDE: {
            target: 'manualOverride',
          },
        },
      },
      heating: {
        entry: ['logStateEntry', 'logHeatingStart'],
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
            target: 'manualOverride',
          },
        },
        after: {
          // Re-evaluate every 5 minutes during heating
          300000: 'evaluating',
        },
      },
      cooling: {
        entry: ['logStateEntry', 'logCoolingStart'],
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
            target: 'manualOverride',
          },
        },
        after: {
          // Re-evaluate every 5 minutes during cooling
          300000: 'evaluating',
        },
      },
      defrosting: {
        entry: ['logStateEntry', 'startDefrost'],
        on: {
          OFF: 'idle',
          DEFROST_COMPLETE: 'heating',
          MANUAL_OVERRIDE: {
            target: 'manualOverride',
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
      manualOverride: {
        entry: ['logStateEntry', 'logManualOverride'],
        on: {
          AUTO_EVALUATE: 'evaluating',
          UPDATE_CONDITIONS: {
            actions: 'updateConditions',
          },
          UPDATE_TEMPERATURES: {
            actions: 'updateTemperatures',
          },
        },
        after: {
          // Return to auto mode after 30 minutes
          1800000: 'evaluating',
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
      logManualOverride: (_, event) => {
        logger.info(`🎯 [HVAC] Manual override activated`, {
          event,
          timestamp: new Date().toISOString(),
        });
      },
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
      startDefrost: () => {
        heatingStrategy.startDefrost();
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
    },
    guards: {
      canHeat: ({ context }) => {
        if (
          context.systemMode === SystemMode.COOL_ONLY ||
          context.systemMode === SystemMode.OFF
        ) {
          return false;
        }

        if (!context.indoorTemp || !context.outdoorTemp) {
          return false;
        }

        return heatingStrategy.shouldHeat({
          currentTemp: context.indoorTemp,
          weatherTemp: context.outdoorTemp,
          hour: context.currentHour,
          isWeekday: context.isWeekday,
        });
      },
      canCool: ({ context }) => {
        if (
          context.systemMode === SystemMode.HEAT_ONLY ||
          context.systemMode === SystemMode.OFF
        ) {
          return false;
        }

        if (!context.indoorTemp || !context.outdoorTemp) {
          return false;
        }

        return coolingStrategy.shouldCool({
          currentTemp: context.indoorTemp,
          weatherTemp: context.outdoorTemp,
          hour: context.currentHour,
          isWeekday: context.isWeekday,
        });
      },
      shouldAutoHeat: ({ context }) => {
        if (context.systemMode !== SystemMode.AUTO) return false;

        if (!context.indoorTemp || !context.outdoorTemp) {
          return false;
        }

        return heatingStrategy.shouldHeat({
          currentTemp: context.indoorTemp,
          weatherTemp: context.outdoorTemp,
          hour: context.currentHour,
          isWeekday: context.isWeekday,
        });
      },
      shouldAutoCool: ({ context }) => {
        if (context.systemMode !== SystemMode.AUTO) return false;

        if (!context.indoorTemp || !context.outdoorTemp) {
          return false;
        }

        return coolingStrategy.shouldCool({
          currentTemp: context.indoorTemp,
          weatherTemp: context.outdoorTemp,
          hour: context.currentHour,
          isWeekday: context.isWeekday,
        });
      },
      canDefrost: ({ context }) => {
        if (!context.indoorTemp || !context.outdoorTemp) {
          return false;
        }

        return heatingStrategy.needsDefrost({
          currentTemp: context.indoorTemp,
          weatherTemp: context.outdoorTemp,
          hour: context.currentHour,
          isWeekday: context.isWeekday,
        });
      },
    },
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

  constructor(hvacOptions?: HvacOptions) {
    this.logger = new LoggerService('HAG.hvac.state-machine');
    this.machine = createHVACMachine(hvacOptions!, this.logger);
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
   * Update temperature conditions
   */
  updateTemperatures(indoor: number, outdoor: number): void {
    const context = this.getContext();
    const tempChange = {
      indoorChange: context.indoorTemp
        ? indoor - context.indoorTemp
        : undefined,
      outdoorChange: context.outdoorTemp
        ? outdoor - context.outdoorTemp
        : undefined,
    };

    this.logger.info('🌡️ Updating temperature conditions', {
      indoor,
      outdoor,
      previousIndoor: context.indoorTemp,
      previousOutdoor: context.outdoorTemp,
      indoorChange: tempChange.indoorChange,
      outdoorChange: tempChange.outdoorChange,
      significantChange: Math.abs(tempChange.indoorChange || 0) > 0.5 ||
        Math.abs(tempChange.outdoorChange || 0) > 2,
      timestamp: new Date().toISOString(),
    });

    this.send({
      type: 'UPDATE_TEMPERATURES',
      indoor,
      outdoor,
    });
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
