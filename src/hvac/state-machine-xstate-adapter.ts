/**
 * XState Adapter for HVAC State Machine Interface
 *
 * This adapter wraps the existing XState HVACStateMachine to conform
 * to the new IHVACStateMachine interface, allowing seamless switching
 * between XState and LangGraph implementations.
 */

import { HVACStateMachine } from './state-machine.ts';
import { IHVACStateMachine } from './state-machine-interface.ts';
import { HVACMode, SystemMode } from '../types/common.ts';
import { HvacOptions } from '../config/config.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * Adapter that wraps XState implementation to match the interface
 */
export class XStateHVACStateMachineAdapter implements IHVACStateMachine {
  private xstateStateMachine: HVACStateMachine;

  constructor(
    private hvacOptions: HvacOptions,
    private logger: LoggerService,
  ) {
    this.xstateStateMachine = new HVACStateMachine(hvacOptions);
  }

  /**
   * Start the state machine
   */
  async start(): Promise<void> {
    this.logger.info('🚀 [XState Adapter] Starting HVAC state machine');
    this.xstateStateMachine.start();
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Stop the state machine
   */
  async stop(): Promise<void> {
    this.logger.info('🛑 [XState Adapter] Stopping HVAC state machine');
    this.xstateStateMachine.stop();
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Get current state name
   */
  getCurrentState(): string {
    return this.xstateStateMachine.getCurrentState();
  }

  /**
   * Get current context/state data
   */
  getContext(): Record<string, unknown> {
    const context = this.xstateStateMachine.getContext();
    return {
      indoorTemp: context.indoorTemp,
      outdoorTemp: context.outdoorTemp,
      systemMode: context.systemMode,
      currentHour: context.currentHour,
      isWeekday: context.isWeekday,
      lastDefrost: context.lastDefrost,
    };
  }

  /**
   * Get detailed status information
   */
  getStatus(): {
    currentState: string;
    context: Record<string, unknown>;
    canHeat: boolean;
    canCool: boolean;
    systemMode: SystemMode;
  } {
    const currentState = this.getCurrentState();
    const context = this.getContext();
    const systemMode = context.systemMode as SystemMode;

    return {
      currentState,
      context,
      canHeat: systemMode !== SystemMode.COOL_ONLY,
      canCool: systemMode !== SystemMode.HEAT_ONLY,
      systemMode,
    };
  }

  /**
   * Handle temperature sensor changes
   */
  async handleTemperatureChange(sensor: string, value: number): Promise<void> {
    this.logger.debug('🌡️ [XState Adapter] Temperature change received', {
      sensor,
      value,
      currentState: this.getCurrentState(),
    });

    // For XState implementation, we need to get current temperatures
    // and update both indoor and outdoor together
    const context = this.getContext();
    let indoor = context.indoorTemp as number;
    let outdoor = context.outdoorTemp as number;

    // Update the appropriate temperature based on sensor name
    if (sensor.includes('indoor') || sensor.includes('hall_multisensor')) {
      indoor = value;
    } else if (
      sensor.includes('outdoor') || sensor.includes('openweathermap')
    ) {
      outdoor = value;
    }

    // Only update if we have both temperatures
    if (indoor !== undefined && outdoor !== undefined) {
      this.xstateStateMachine.updateTemperatures(indoor, outdoor);
    }
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Execute manual override
   */
  async manualOverride(mode: HVACMode, temperature?: number): Promise<void> {
    this.logger.info('👤 [XState Adapter] Manual override triggered', {
      mode,
      temperature,
      currentState: this.getCurrentState(),
    });

    this.xstateStateMachine.manualOverride(mode, temperature);
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Clear manual override (delegate to evaluation)
   */
  async clearManualOverride(): Promise<void> {
    this.logger.info('🔄 [XState Adapter] Clearing manual override');
    this.xstateStateMachine.evaluateConditions();
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Update system mode
   * Note: XState implementation doesn't have direct system mode updates,
   * so we trigger a re-evaluation which will pick up new configuration
   */
  async updateSystemMode(systemMode: SystemMode): Promise<void> {
    this.logger.info('⚙️ [XState Adapter] System mode updated', {
      newMode: systemMode,
      currentState: this.getCurrentState(),
    });

    // Update the hvacOptions with new system mode
    this.hvacOptions.systemMode = systemMode;

    // Trigger evaluation to apply new system mode
    this.xstateStateMachine.evaluateConditions();
    await Promise.resolve(); // Make async compliant
  }

  /**
   * Trigger evaluation (XState specific method)
   */
  evaluateConditions(): void {
    this.xstateStateMachine.evaluateConditions();
  }

  /**
   * Send event to XState machine (XState specific method)
   */
  send(event: Record<string, unknown>): void {
    this.xstateStateMachine.send(event as any);
  }
}
