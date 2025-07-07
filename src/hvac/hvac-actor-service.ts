/**
 * HVAC Actor Service - DI-managed service for HVAC state machine lifecycle
 * Uses XState v5 state machine for unified HVAC control
 */

import { LoggerService } from '../core/logger.ts';
import type { HvacOptions } from '../config/config.ts';
import { HVACStateMachine } from './state-machine.ts';
import { HVACContext } from '../types/common.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';

export class HvacActorService {
  private stateMachine: HVACStateMachine;
  private logger: LoggerService;
  private hvacOptions: HvacOptions;
  private haClient?: HomeAssistantClient;

  constructor(
    hvacOptions: HvacOptions,
    logger?: LoggerService,
    haClient?: HomeAssistantClient,
  ) {
    this.hvacOptions = hvacOptions;
    this.haClient = haClient;
    this.logger = logger || new LoggerService('HAG.hvac-actor-service');
    this.stateMachine = new HVACStateMachine(hvacOptions, haClient);
  }



  /**
   * Start the HVAC system
   */
  start(): void {
    this.stateMachine.start();
    this.logger.info('▶️ HVAC system started');
  }

  /**
   * Stop the HVAC system
   */
  stop(): void {
    this.stateMachine.stop();
    this.logger.info('⏹️ HVAC system stopped');
  }


  /**
   * Get current HVAC state (returns context for internal use)
   */
  getContext(): HVACContext {
    return this.stateMachine.getContext();
  }

  /**
   * Get current state (compatibility with HVACStateMachine interface)
   */
  getCurrentState(): string {
    return this.stateMachine.getCurrentState();
  }


  /**
   * Check if HVAC is active (heating or cooling)
   */
  isActive(): boolean {
    const mode = this.getCurrentState();
    return mode === 'heating' || mode === 'cooling';
  }

  /**
   * Update sensor states from controller
   */
  updateSensorStates(sensorStates: Record<string, string>): void {
    this.logger.info('📊 Updating state machine with sensor states', {
      sensorStates,
      previousIndoor: this.getContext().indoorTemp,
      previousOutdoor: this.getContext().outdoorTemp,
    });

    // Extract temperature values from sensor states
    const indoorTemp = parseFloat(sensorStates[this.hvacOptions.tempSensor] || '0');
    const outdoorTemp = parseFloat(sensorStates[this.hvacOptions.outdoorSensor] || '0');
    
    if (!isNaN(indoorTemp) && !isNaN(outdoorTemp)) {
      // Send generic update event to state machine
      this.stateMachine.send({
        type: 'UPDATE_TEMPERATURES',
        indoor: indoorTemp,
        outdoor: outdoorTemp,
      });
      
      // Trigger evaluation after sensor update
      this.stateMachine.evaluateConditions();
    } else {
      this.logger.warning('⚠️ Invalid sensor readings, skipping update', {
        indoorReading: sensorStates[this.hvacOptions.tempSensor],
        outdoorReading: sensorStates[this.hvacOptions.outdoorSensor],
      });
    }
  }



  /**
   * Get detailed status for monitoring
   */
  getStatus(): {
    mode: string;
    temperatures: {
      current: number | undefined;
      target: number;
      outdoor: number | undefined;
    };
    isActive: boolean;
  } {
    const context = this.getContext();
    const status = this.stateMachine.getStatus();
    
    return {
      mode: status.currentState,
      temperatures: {
        current: context.indoorTemp,
        target: this.hvacOptions.heating.temperature, // Default to heating temp
        outdoor: context.outdoorTemp,
      },
      isActive: this.isActive(),
    };
  }
}