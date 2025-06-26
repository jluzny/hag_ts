/**
 * HVAC state machine implementation for HAG JavaScript variant.
 * 
 * XState-powered state machine with heating/cooling strategies.
 */

import { createMachine, assign, createActor, ActorRefFrom } from 'xstate';
import { HvacOptions, TemperatureThresholds, DefrostOptions } from '../config/settings.ts';
import { HVACContext, StateChangeData, SystemMode, HVACMode } from '../types/common.ts';
import { StateError } from '../core/exceptions.ts';

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

  constructor(private hvacOptions: HvacOptions) {}

  shouldHeat(data: StateChangeData): boolean {
    const { heating } = this.hvacOptions;
    const thresholds = heating.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp >= thresholds.indoorMax) {
      return false;
    }

    // Check outdoor temperature range
    if (data.weatherTemp < thresholds.outdoorMin || data.weatherTemp > thresholds.outdoorMax) {
      return false;
    }

    // Check active hours
    if (!this.isActiveHour(data.hour, data.isWeekday)) {
      return false;
    }

    return data.currentTemp < thresholds.indoorMin;
  }

  needsDefrost(data: StateChangeData): boolean {
    const defrost = this.hvacOptions.heating.defrost;
    if (!defrost) return false;

    // Check temperature threshold
    if (data.weatherTemp > defrost.temperatureThreshold) {
      return false;
    }

    // Check time since last defrost
    if (this.lastDefrost) {
      const timeSinceDefrost = Date.now() - this.lastDefrost.getTime();
      if (timeSinceDefrost < defrost.periodSeconds * 1000) {
        return false;
      }
    }

    return true;
  }

  startDefrost(): void {
    this.lastDefrost = new Date();
  }

  private isActiveHour(hour: number, isWeekday: boolean): boolean {
    const activeHours = this.hvacOptions.activeHours;
    if (!activeHours) return true;

    const start = isWeekday ? activeHours.startWeekday : activeHours.start;
    return hour >= start && hour <= activeHours.end;
  }
}

export class CoolingStrategy {
  constructor(private hvacOptions: HvacOptions) {}

  shouldCool(data: StateChangeData): boolean {
    const { cooling } = this.hvacOptions;
    const thresholds = cooling.temperatureThresholds;

    // Check temperature conditions
    if (data.currentTemp <= thresholds.indoorMin) {
      return false;
    }

    // Check outdoor temperature range
    if (data.weatherTemp < thresholds.outdoorMin || data.weatherTemp > thresholds.outdoorMax) {
      return false;
    }

    // Check active hours
    if (!this.isActiveHour(data.hour, data.isWeekday)) {
      return false;
    }

    return data.currentTemp > thresholds.indoorMax;
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
export function createHVACMachine(hvacOptions: HvacOptions) {
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
            target: 'idle',
          },
        ],
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
      logStateEntry: ({ context }, event) => {
        const { type } = event as any;
        console.log(`[HVAC] Entering state: ${type}`, {
          indoorTemp: context.indoorTemp,
          outdoorTemp: context.outdoorTemp,
          systemMode: context.systemMode,
        });
      },
      logHeatingStart: ({ context }) => {
        console.log(`[HVAC] Starting heating`, {
          targetTemp: hvacOptions.heating.temperature,
          indoorTemp: context.indoorTemp,
        });
      },
      logCoolingStart: ({ context }) => {
        console.log(`[HVAC] Starting cooling`, {
          targetTemp: hvacOptions.cooling.temperature,
          indoorTemp: context.indoorTemp,
        });
      },
      logManualOverride: (_, event) => {
        const { type, ...eventData } = event as any;
        console.log(`[HVAC] Manual override activated`, event);
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
        console.log(`[HVAC] Defrost cycle started`);
      },
      completeDefrost: () => {
        console.log(`[HVAC] Defrost cycle completed`);
      },
    },
    guards: {
      canHeat: ({ context }) => {
        if (context.systemMode === SystemMode.COOL_ONLY || context.systemMode === SystemMode.OFF) {
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
        if (context.systemMode === SystemMode.HEAT_ONLY || context.systemMode === SystemMode.OFF) {
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
export class HVACStateMachine {
  private machine: HVACMachine;
  private actor?: HVACMachineActor;

  constructor(private hvacOptions: HvacOptions) {
    this.machine = createHVACMachine(hvacOptions);
  }

  /**
   * Start the state machine
   */
  start(): void {
    if (this.actor) {
      throw new StateError('State machine is already running');
    }

    this.actor = createActor(this.machine);
    this.actor.start();
  }

  /**
   * Stop the state machine
   */
  stop(): void {
    if (this.actor) {
      this.actor.stop();
      this.actor = undefined;
    }
  }

  /**
   * Send event to state machine
   */
  send(event: HVACEvent): void {
    if (!this.actor) {
      throw new StateError('State machine is not running');
    }
    this.actor.send(event);
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
    this.send({ type: 'AUTO_EVALUATE' });
  }

  /**
   * Manual HVAC override
   */
  manualOverride(mode: HVACMode, temperature?: number): void {
    this.send({
      type: 'MANUAL_OVERRIDE',
      mode,
      temperature,
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
      canHeat: context.systemMode !== SystemMode.COOL_ONLY && context.systemMode !== SystemMode.OFF,
      canCool: context.systemMode !== SystemMode.HEAT_ONLY && context.systemMode !== SystemMode.OFF,
      systemMode: context.systemMode,
    };
  }
}