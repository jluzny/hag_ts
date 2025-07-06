/**
 * HVAC Actor using XState for state management
 * Handles temperature events and HVAC mode transitions
 */

import { assign, createMachine } from 'xstate';
import type { HvacOptions } from '../config/config.ts';

export interface HvacContext {
  currentMode: 'off' | 'heating' | 'cooling' | 'idle';
  targetTemp: number;
  currentTemp: number | undefined;
  outdoorTemp: number | undefined;
  lastUpdate: Date;
  sensorData: Record<string, unknown>;
}

export interface HvacEvents {
  type: 'START' | 'STOP' | 'SET_TARGET_TEMP' | 'HASS_STATE_CHANGED';
  temp?: number;
  event?: {
    type: string;
    payload?: {
      entityId: string;
      newState: unknown;
      oldState: unknown;
    };
  };
}

export const createHvacMachine = (options: HvacOptions) =>
  createMachine({
    id: 'hvac',
    initial: 'off',
    context: {
      currentMode: 'off',
      targetTemp: options.heating.temperature,
      currentTemp: undefined,
      outdoorTemp: undefined,
      lastUpdate: new Date(),
      sensorData: {},
    } as HvacContext,

    states: {
      off: {
        entry: assign({ currentMode: 'off' }),
        on: {
          START: 'idle',
          HASS_STATE_CHANGED: {
            actions: 'updateSensorData',
          },
        },
      },

      idle: {
        entry: assign({ currentMode: 'idle' }),
        always: [
          {
            guard: 'shouldStartHeating',
            target: 'heating',
          },
          {
            guard: 'shouldStartCooling',
            target: 'cooling',
          },
        ],

        on: {
          STOP: 'off',
          SET_TARGET_TEMP: {
            actions: assign({
              targetTemp: ({ event }) => event.temp || 22,
            }),
          },
          HASS_STATE_CHANGED: {
            actions: 'updateSensorData',
          },
        },
      },

      heating: {
        entry: [
          assign({ currentMode: 'heating' }),
          'logModeChange',
        ],

        always: {
          guard: 'shouldStopHeating',
          target: 'idle',
        },

        on: {
          STOP: 'off',
          HASS_STATE_CHANGED: {
            actions: 'updateSensorData',
          },
        },
      },

      cooling: {
        entry: [
          assign({ currentMode: 'cooling' }),
          'logModeChange',
        ],

        always: {
          guard: 'shouldStopCooling',
          target: 'idle',
        },

        on: {
          STOP: 'off',
          HASS_STATE_CHANGED: {
            actions: 'updateSensorData',
          },
        },
      },
    },
  }, {
    guards: {
      shouldStartHeating: ({ context }) => {
        if (context.currentTemp === undefined || context.outdoorTemp === undefined) {
          return false;
        }
        const thresholds = options.heating.temperatureThresholds;
        return context.currentTemp < thresholds.indoorMin &&
               context.outdoorTemp >= thresholds.outdoorMin &&
               context.outdoorTemp <= thresholds.outdoorMax;
      },

      shouldStartCooling: ({ context }) => {
        if (context.currentTemp === undefined || context.outdoorTemp === undefined) {
          return false;
        }
        const thresholds = options.cooling.temperatureThresholds;
        return context.currentTemp > thresholds.indoorMax &&
               context.outdoorTemp >= thresholds.outdoorMin &&
               context.outdoorTemp <= thresholds.outdoorMax;
      },

      shouldStopHeating: ({ context }) => {
        if (context.currentTemp === undefined) {
          return false;
        }
        const thresholds = options.heating.temperatureThresholds;
        return context.currentTemp >= thresholds.indoorMax;
      },

      shouldStopCooling: ({ context }) => {
        if (context.currentTemp === undefined) {
          return false;
        }
        const thresholds = options.cooling.temperatureThresholds;
        return context.currentTemp <= thresholds.indoorMin;
      },
    },

    actions: {
      updateSensorData: assign({
        currentTemp: ({ context, event }) => {
          if (event.event?.payload?.entityId === options.tempSensor) {
            const newTemp = parseFloat(String(event.event.payload.newState));
            return isNaN(newTemp) ? context.currentTemp : newTemp;
          }
          return context.currentTemp;
        },

        outdoorTemp: ({ context, event }) => {
          if (event.event?.payload?.entityId === options.outdoorSensor) {
            const newTemp = parseFloat(String(event.event.payload.newState));
            return isNaN(newTemp) ? context.outdoorTemp : newTemp;
          }
          return context.outdoorTemp;
        },

        lastUpdate: () => new Date(),

        sensorData: ({ context, event }) => {
          if (event.event?.payload?.entityId) {
            return {
              ...context.sensorData,
              [event.event.payload.entityId]: {
                value: event.event.payload.newState,
                timestamp: new Date(),
              },
            };
          }
          return context.sensorData;
        },
      }),

      logModeChange: ({ context }) => {
        console.log(`🏠 HVAC mode changed to: ${context.currentMode}`, {
          targetTemp: context.targetTemp,
          currentTemp: context.currentTemp,
          outdoorTemp: context.outdoorTemp,
        });
      },
    },
  });
