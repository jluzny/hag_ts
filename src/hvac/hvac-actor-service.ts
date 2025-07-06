/**
 * HVAC Actor Service - DI-managed service for HVAC state machine lifecycle
 * Uses XState v5 state machine for unified HVAC control
 */

import { LoggerService } from '../core/logger.ts';
import type { HvacOptions } from '../config/config.ts';
import { HVACStateMachine, type HVACMachineActor } from './state-machine.ts';
import { HVACContext } from '../types/common.ts';

export class HvacActorService {
  private stateMachine: HVACStateMachine;
  private logger: LoggerService;
  private hvacOptions: HvacOptions;
  private haClient?: any; // HomeAssistantClient

  constructor(
    hvacOptions: HvacOptions,
    logger?: LoggerService,
    haClient?: any,
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
   * Set target temperature
   */
  setTargetTemperature(temp: number): void {
    // XState machine doesn't need explicit target temperature setting
    // Temperature is handled through configuration
    this.logger.info(`🌡️ Target temperature request: ${temp}°C (handled via configuration)`);
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
   * Get current HVAC mode
   */
  getCurrentMode(): string {
    return this.stateMachine.getCurrentState();
  }

  /**
   * Get current temperatures
   */
  getTemperatures(): {
    current: number | undefined;
    target: number;
    outdoor: number | undefined;
  } {
    const context = this.getContext();
    return {
      current: context.indoorTemp,
      target: this.hvacOptions.heating.temperature, // Default to heating temp
      outdoor: context.outdoorTemp,
    };
  }

  /**
   * Check if HVAC is active (heating or cooling)
   */
  isActive(): boolean {
    const mode = this.getCurrentMode();
    return mode === 'heating' || mode === 'cooling';
  }

  /**
   * Update temperatures from controller
   */
  updateTemperatures(indoor: number, outdoor: number): void {
    this.logger.info('🌡️ Updating state machine temperatures', {
      indoor,
      outdoor,
      previousIndoor: this.getContext().indoorTemp,
      previousOutdoor: this.getContext().outdoorTemp,
    });

    this.stateMachine.updateTemperatures(indoor, outdoor);
    
    // Trigger evaluation after temperature update
    this.stateMachine.evaluateConditions();
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