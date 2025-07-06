/**
 * HVAC Actor Service - DI-managed service for HVAC actor lifecycle
 * Integrates HVAC actor with the application's event system
 */

import { ActorSystem } from '../core/actor-system.ts';
import { createHvacMachine, type HvacContext } from './hvac-actor.ts';
import { LoggerService } from '../core/logger.ts';
import type { HvacOptions } from '../config/config.ts';

// Type definition for XState actor - matches ActorSystem interface
interface HvacActor {
  send(event: { type: string; [key: string]: unknown }): void;
  getSnapshot(): { context: HvacContext };
  subscribe(
    observer: (snapshot: { context: HvacContext }) => void,
  ): { unsubscribe(): void };
}

export class HvacActorService {
  private hvacActor!: HvacActor;
  private logger: LoggerService;
  private actorSystem: ActorSystem;
  private hvacOptions: HvacOptions;

  constructor(
    actorSystem: ActorSystem,
    hvacOptions: HvacOptions,
    logger?: LoggerService,
  ) {
    this.actorSystem = actorSystem;
    this.hvacOptions = hvacOptions;
    this.logger = logger || new LoggerService('HAG.hvac-actor-service');
    this.initializeHvacActor();
  }

  private initializeHvacActor(): void {
    const machine = createHvacMachine(this.hvacOptions);
    this.hvacActor = this.actorSystem.createActor('hvac', machine) as HvacActor;

    // Subscribe to Home Assistant state change events
    this.actorSystem.subscribeActorToEvents('hvac', 'state_changed');

    this.logger.info('🎭 HVAC actor initialized', {
      tempSensor: this.hvacOptions.tempSensor,
      outdoorSensor: this.hvacOptions.outdoorSensor,
    });
  }

  /**
   * Start the HVAC system
   */
  start(): void {
    this.hvacActor.send({ type: 'START' });
    this.logger.info('▶️ HVAC system started');
  }

  /**
   * Stop the HVAC system
   */
  stop(): void {
    this.hvacActor.send({ type: 'STOP' });
    this.logger.info('⏹️ HVAC system stopped');
  }

  /**
   * Set target temperature
   */
  setTargetTemperature(temp: number): void {
    this.hvacActor.send({ type: 'SET_TARGET_TEMP', temp });
    this.logger.info(`🌡️ Target temperature set to ${temp}°C`);
  }

  /**
   * Get current HVAC state (returns context for internal use)
   */
  getContext(): HvacContext {
    return this.hvacActor.getSnapshot().context;
  }

  /**
   * Get current state (compatibility with HVACStateMachine interface)
   */
  getCurrentState(): string {
    return this.getContext().currentMode;
  }

  /**
   * Get current HVAC mode
   */
  getCurrentMode(): string {
    return this.getContext().currentMode;
  }

  /**
   * Get current temperatures
   */
  getTemperatures(): {
    current: number | undefined;
    target: number;
    outdoor: number | undefined;
  } {
    const state = this.getContext();
    return {
      current: state.currentTemp,
      target: state.targetTemp,
      outdoor: state.outdoorTemp,
    };
  }

  /**
   * Get sensor data
   */
  getSensorData(): Record<string, unknown> {
    return this.getContext().sensorData;
  }

  /**
   * Check if HVAC is active (heating or cooling)
   */
  isActive(): boolean {
    const mode = this.getCurrentMode();
    return mode === 'heating' || mode === 'cooling';
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
    lastUpdate: Date;
    isActive: boolean;
    sensorCount: number;
  } {
    const state = this.getContext();
    return {
      mode: state.currentMode,
      temperatures: {
        current: state.currentTemp,
        target: state.targetTemp,
        outdoor: state.outdoorTemp,
      },
      lastUpdate: state.lastUpdate,
      isActive: this.isActive(),
      sensorCount: Object.keys(state.sensorData).length,
    };
  }
}