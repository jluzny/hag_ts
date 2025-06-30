/**
 * LangGraph HVAC State Machine Implementation v2
 *
 * Event-driven approach where each graph execution is a single evaluation
 * that determines the next action, avoiding infinite loops.
 */

import { StateGraph } from '@langchain/langgraph';
import {
  createDefaultHVACState,
  HVACLangGraphState,
} from './lg-types/hvac-state.ts';
import { evaluationNode } from './lg-nodes/evaluation-node.ts';
import { HVACMode, SystemMode } from '../types/common.ts';
import { ApplicationOptions, HvacOptions } from '../config/config.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * Event-driven LangGraph HVAC State Machine
 *
 * This version executes the graph once per event, making a single decision,
 * rather than continuous execution. This matches the XState pattern better.
 */
export class HVACLangGraphStateMachineV2 {
  private graph: StateGraph<HVACLangGraphState>;
  private compiledGraph: any;
  private currentState: HVACLangGraphState;
  private isRunning: boolean = false;
  private evaluationInterval?: number;

  constructor(
    private hvacOptions: HvacOptions,
    private appOptions: ApplicationOptions,
    private logger: LoggerService,
  ) {
    this.currentState = createDefaultHVACState({
      systemMode: hvacOptions.systemMode,
      aiEnabled: appOptions.useAi || false,
    });

    this.graph = this.buildEvaluationGraph();
    this.logger.info('🔧 [LangGraph v2] HVAC State Machine initialized', {
      systemMode: hvacOptions.systemMode,
      aiEnabled: appOptions.useAi,
      approach: 'event-driven',
    });
  }

  /**
   * Build a simple evaluation-only graph
   * Each execution makes one decision and terminates
   */
  private buildEvaluationGraph(): StateGraph<HVACLangGraphState> {
    const stateSchema = {
      channels: {
        currentMode: {
          value: (x: string, y: string) => y || x,
          default: () => 'idle',
        },
        indoorTemp: {
          value: (x: number | undefined, y: number | undefined) =>
            y !== undefined ? y : x,
          default: () => undefined,
        },
        outdoorTemp: {
          value: (x: number | undefined, y: number | undefined) =>
            y !== undefined ? y : x,
          default: () => undefined,
        },
        systemMode: {
          value: (x: any, y: any) => y || x,
          default: () => this.hvacOptions.systemMode,
        },
        evaluationHistory: {
          value: (x: any[], y: any[]) => y || x,
          default: () => [],
        },
        totalTransitions: {
          value: (x: number, y: number) => y !== undefined ? y : x,
          default: () => 0,
        },
        lastDecision: {
          value: (x: any, y: any) => y || x,
          default: () => null,
        },
      },
    };

    const graph = new StateGraph(stateSchema);

    // Single evaluation node that determines the next action
    graph.addNode('evaluate', evaluationNode);

    // Set entry point and terminate after evaluation
    graph.setEntryPoint('evaluate');
    graph.addEdge('evaluate', '__end__');

    return graph;
  }

  /**
   * Start the state machine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warning('🔄 [LangGraph v2] State machine already running');
      return;
    }

    try {
      this.compiledGraph = this.graph.compile();
      this.isRunning = true;

      this.logger.info('🚀 [LangGraph v2] Starting HVAC state machine', {
        initialState: this.currentState.currentMode,
        systemMode: this.currentState.systemMode,
        approach: 'event-driven',
      });

      // Perform initial evaluation
      await this.performEvaluation('STARTUP');

      // Set up periodic evaluation (like XState)
      this.setupPeriodicEvaluation();
    } catch (error) {
      this.logger.error(
        '❌ [LangGraph v2] Failed to start state machine',
        error,
      );
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the state machine
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 [LangGraph v2] Stopping HVAC state machine', {
      currentState: this.currentState.currentMode,
      totalTransitions: this.currentState.totalTransitions,
    });

    this.isRunning = false;

    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
  }

  /**
   * Perform a single evaluation by running the graph once
   */
  private async performEvaluation(trigger: string): Promise<void> {
    if (!this.compiledGraph || !this.isRunning) {
      return;
    }

    try {
      const startTime = performance.now();

      // Update temporal context
      const now = new Date();
      const inputState = {
        ...this.currentState,
        currentHour: now.getHours(),
        isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
        evaluationTrigger: trigger,
      };

      this.logger.debug('🎯 [LangGraph v2] Starting evaluation', {
        trigger,
        currentMode: inputState.currentMode,
        indoorTemp: inputState.indoorTemp,
        outdoorTemp: inputState.outdoorTemp,
      });

      // Execute graph once
      const result = await this.compiledGraph.invoke(inputState);

      const executionTime = performance.now() - startTime;

      // Determine if state changed
      const previousMode = this.currentState.currentMode;
      const newMode = result.currentMode;
      const stateChanged = previousMode !== newMode;

      // Update current state
      this.currentState = {
        ...result,
        totalTransitions: this.currentState.totalTransitions +
          (stateChanged ? 1 : 0),
        lastEvaluationTime: now,
        lastEvaluationTrigger: trigger,
        lastEvaluationDuration: executionTime,
      };

      this.logger.info(
        `${stateChanged ? '🔄' : '✅'} [LangGraph v2] Evaluation completed`,
        {
          trigger,
          previousMode,
          newMode,
          stateChanged,
          executionTimeMs: executionTime,
          totalTransitions: this.currentState.totalTransitions,
        },
      );

      // If state changed to an action state, execute the action
      if (
        stateChanged &&
        (newMode === 'heating' || newMode === 'cooling' || newMode === 'off')
      ) {
        await this.executeAction(newMode, result);
      }
    } catch (error) {
      this.logger.error('❌ [LangGraph v2] Evaluation failed', error, {
        trigger,
        currentMode: this.currentState.currentMode,
      });
    }
  }

  /**
   * Execute the actual HVAC action (placeholder for controller integration)
   */
  private executeAction(
    mode: string,
    state: HVACLangGraphState,
  ): void {
    this.logger.info(`⚡ [LangGraph v2] Executing ${mode} action`, {
      mode,
      indoorTemp: state.indoorTemp,
      outdoorTemp: state.outdoorTemp,
      dryRun: true, // Always dry run in this implementation
    });

    // In real implementation, this would call the HVAC controller
    // For now, just simulate the action
    switch (mode) {
      case 'heating':
        this.logger.debug('🔥 [LangGraph v2] Would activate heating');
        break;
      case 'cooling':
        this.logger.debug('❄️ [LangGraph v2] Would activate cooling');
        break;
      case 'off':
        this.logger.debug('🛑 [LangGraph v2] Would turn off HVAC');
        break;
    }
  }

  /**
   * Set up periodic evaluation (every 5 minutes like XState)
   */
  private setupPeriodicEvaluation(): void {
    this.evaluationInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.performEvaluation('PERIODIC');
      }
    }, 300000); // 5 minutes
  }

  /**
   * Handle temperature change events
   */
  async handleTemperatureChange(sensor: string, value: number): Promise<void> {
    this.logger.debug('🌡️ [LangGraph v2] Temperature change received', {
      sensor,
      value,
      currentMode: this.currentState.currentMode,
    });

    // Update state with new temperature
    if (sensor.includes('indoor') || sensor.includes('hall_multisensor')) {
      this.currentState = {
        ...this.currentState,
        indoorTemp: value,
      };
    } else if (
      sensor.includes('outdoor') || sensor.includes('openweathermap')
    ) {
      this.currentState = {
        ...this.currentState,
        outdoorTemp: value,
      };
    }

    // Trigger evaluation
    await this.performEvaluation('TEMPERATURE_CHANGE');
  }

  /**
   * Handle manual override
   */
  async manualOverride(mode: HVACMode, temperature?: number): Promise<void> {
    this.logger.info('👤 [LangGraph v2] Manual override triggered', {
      mode,
      temperature,
      previousMode: this.currentState.currentMode,
    });

    // Set manual override in state
    this.currentState = {
      ...this.currentState,
      manualOverride: {
        active: true,
        mode: mode.toLowerCase(),
        temperature,
        setBy: 'user',
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour expiration
      },
    };

    // Trigger evaluation
    await this.performEvaluation('MANUAL_OVERRIDE');
  }

  /**
   * Clear manual override
   */
  async clearManualOverride(): Promise<void> {
    this.logger.info('🔄 [LangGraph v2] Clearing manual override');

    this.currentState = {
      ...this.currentState,
      manualOverride: {
        active: false,
      },
    };

    await this.performEvaluation('CLEAR_OVERRIDE');
  }

  /**
   * Update system mode
   */
  async updateSystemMode(systemMode: SystemMode): Promise<void> {
    this.logger.info('⚙️ [LangGraph v2] System mode updated', {
      oldMode: this.currentState.systemMode,
      newMode: systemMode,
    });

    this.currentState = {
      ...this.currentState,
      systemMode,
    };

    await this.performEvaluation('SYSTEM_MODE_CHANGE');
  }

  /**
   * Get current state information
   */
  getCurrentState(): string {
    return this.currentState.currentMode;
  }

  /**
   * Get current context (for compatibility)
   */
  getContext(): Record<string, unknown> {
    return {
      indoorTemp: this.currentState.indoorTemp,
      outdoorTemp: this.currentState.outdoorTemp,
      systemMode: this.currentState.systemMode,
      currentHour: this.currentState.currentHour,
      isWeekday: this.currentState.isWeekday,
      lastDefrost: this.currentState.lastDefrost,
    };
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
    evaluationHistory: typeof this.currentState.evaluationHistory;
    performanceMetrics: any;
    totalTransitions: number;
    lastEvaluationTime?: Date;
    lastEvaluationTrigger?: string;
    lastEvaluationDuration?: number;
  } {
    return {
      currentState: this.currentState.currentMode,
      context: this.getContext(),
      canHeat: this.currentState.systemMode !== SystemMode.COOL_ONLY,
      canCool: this.currentState.systemMode !== SystemMode.HEAT_ONLY,
      systemMode: this.currentState.systemMode,
      evaluationHistory: this.currentState.evaluationHistory,
      performanceMetrics: this.currentState.performanceMetrics || {
        nodeExecutionTimes: {},
        totalTransitions: 0,
        lastEvaluationDuration: 0,
        avgDecisionTime: 0,
      },
      totalTransitions: this.currentState.totalTransitions,
      lastEvaluationTime: (this.currentState as any).lastEvaluationTime,
      lastEvaluationTrigger: (this.currentState as any).lastEvaluationTrigger,
      lastEvaluationDuration: (this.currentState as any).lastEvaluationDuration,
    };
  }

  /**
   * Get internal state for debugging
   */
  getInternalState(): HVACLangGraphState {
    return { ...this.currentState };
  }
}
