/**
 * LangGraph Adapter for Controller Integration
 *
 * This adapter wraps the LangGraph state machine to work with the existing
 * controller structure while providing enhanced capabilities.
 */

import { HVACLangGraphStateMachineV2 } from './state-machine-lg-v2.ts';
import { IHVACStateMachine } from './state-machine-interface.ts';
import { HVACMode, SystemMode } from '../types/common.ts';
import { ApplicationOptions, HvacOptions } from '../config/config.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * Adapter that provides enhanced LangGraph capabilities to the controller
 */
export class LangGraphHVACStateMachineAdapter implements IHVACStateMachine {
  private langGraphStateMachine: HVACLangGraphStateMachineV2;

  constructor(
    private hvacOptions: HvacOptions,
    private appOptions: ApplicationOptions,
    private logger: LoggerService,
  ) {
    this.langGraphStateMachine = new HVACLangGraphStateMachineV2(
      hvacOptions,
      appOptions,
      logger,
    );
  }

  /**
   * Start the state machine
   */
  async start(): Promise<void> {
    this.logger.info('🚀 [LangGraph Adapter] Starting HVAC state machine');
    await this.langGraphStateMachine.start();
  }

  /**
   * Stop the state machine
   */
  async stop(): Promise<void> {
    this.logger.info('🛑 [LangGraph Adapter] Stopping HVAC state machine');
    await this.langGraphStateMachine.stop();
  }

  /**
   * Get current state name
   */
  getCurrentState(): string {
    return this.langGraphStateMachine.getCurrentState();
  }

  /**
   * Get current context/state data
   */
  getContext(): Record<string, unknown> {
    return this.langGraphStateMachine.getContext();
  }

  /**
   * Get enhanced status information
   */
  getStatus(): {
    currentState: string;
    context: Record<string, unknown>;
    canHeat: boolean;
    canCool: boolean;
    systemMode: SystemMode;
    evaluationHistory?: unknown[];
    performanceMetrics?: unknown;
    totalTransitions?: number;
  } {
    const status = this.langGraphStateMachine.getStatus();
    return {
      currentState: status.currentState,
      context: status.context,
      canHeat: status.canHeat,
      canCool: status.canCool,
      systemMode: status.systemMode,
      evaluationHistory: status.evaluationHistory,
      performanceMetrics: status.performanceMetrics,
      totalTransitions: status.totalTransitions,
    };
  }

  /**
   * Handle temperature sensor changes
   */
  async handleTemperatureChange(sensor: string, value: number): Promise<void> {
    this.logger.debug('🌡️ [LangGraph Adapter] Temperature change received', {
      sensor,
      value,
      currentState: this.getCurrentState(),
    });

    await this.langGraphStateMachine.handleTemperatureChange(sensor, value);
  }

  /**
   * Execute manual override
   */
  async manualOverride(mode: HVACMode, temperature?: number): Promise<void> {
    this.logger.info('👤 [LangGraph Adapter] Manual override triggered', {
      mode,
      temperature,
      currentState: this.getCurrentState(),
    });

    await this.langGraphStateMachine.manualOverride(mode, temperature);
  }

  /**
   * Clear manual override
   */
  async clearManualOverride(): Promise<void> {
    this.logger.info('🔄 [LangGraph Adapter] Clearing manual override');
    await this.langGraphStateMachine.clearManualOverride();
  }

  /**
   * Update system mode
   */
  async updateSystemMode(systemMode: SystemMode): Promise<void> {
    this.logger.info('⚙️ [LangGraph Adapter] System mode updated', {
      newMode: systemMode,
    });

    await this.langGraphStateMachine.updateSystemMode(systemMode);
  }

  /**
   * Get internal LangGraph state for debugging
   */
  getInternalState(): unknown {
    return this.langGraphStateMachine.getInternalState();
  }

  /**
   * Get LangGraph-specific evaluation history
   */
  getEvaluationHistory(): Array<{
    timestamp: Date;
    decision: string;
    reasoning: string;
    conditions: Record<string, unknown>;
    executionTimeMs: number;
  }> {
    const state = this.langGraphStateMachine.getInternalState();
    return state.evaluationHistory || [];
  }

  /**
   * Get LangGraph-specific performance metrics
   */
  getPerformanceMetrics(): {
    nodeExecutionTimes: Record<string, number[]>;
    totalTransitions: number;
    lastEvaluationDuration: number;
    avgDecisionTime: number;
  } {
    const state = this.langGraphStateMachine.getInternalState();
    const metrics = state.performanceMetrics || {
      nodeExecutionTimes: {},
      totalTransitions: 0,
      lastEvaluationDuration: 0,
      avgDecisionTime: 0,
    };

    // Calculate average decision time
    const allTimes = Object.values(metrics.nodeExecutionTimes).flat();
    const avgDecisionTime = allTimes.length > 0
      ? allTimes.reduce((sum, time) => sum + time, 0) / allTimes.length
      : 0;

    return {
      ...metrics,
      avgDecisionTime,
    };
  }

  /**
   * Legacy methods for compatibility with existing controller
   */

  /**
   * Update temperatures (compatibility method)
   */
  async updateTemperatures(indoor: number, outdoor: number): Promise<void> {
    this.logger.debug(
      '🌡️ [LangGraph Adapter] Updating temperatures (compatibility)',
      {
        indoor,
        outdoor,
      },
    );

    // Update both temperatures via the new interface
    await this.handleTemperatureChange(this.hvacOptions.tempSensor, indoor);
    await this.handleTemperatureChange(this.hvacOptions.outdoorSensor, outdoor);
  }

  /**
   * Trigger evaluation (compatibility method)
   */
  async evaluateConditions(): Promise<void> {
    this.logger.debug(
      '🎯 [LangGraph Adapter] Triggering evaluation (compatibility)',
    );

    // LangGraph handles evaluation automatically, but we can trigger a temperature update
    // to force re-evaluation if needed
    const context = this.getContext();
    if (context.indoorTemp && context.outdoorTemp) {
      await this.handleTemperatureChange(
        this.hvacOptions.tempSensor,
        context.indoorTemp as number,
      );
    }
  }

  /**
   * Send event (compatibility method - maps to appropriate LangGraph method)
   */
  async send(event: any): Promise<void> {
    this.logger.debug('📤 [LangGraph Adapter] Sending event (compatibility)', {
      event,
    });

    // Map XState events to LangGraph methods
    switch (event.type) {
      case 'UPDATE_TEMPERATURES':
        await this.updateTemperatures(event.indoor, event.outdoor);
        break;
      case 'MANUAL_OVERRIDE':
        await this.manualOverride(event.mode, event.temperature);
        break;
      case 'AUTO_EVALUATE':
        await this.evaluateConditions();
        break;
      default:
        this.logger.warning('⚠️ [LangGraph Adapter] Unknown event type', {
          eventType: event.type,
          event,
        });
    }
  }
}
