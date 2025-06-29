/**
 * LangGraph HVAC State Machine Implementation
 *
 * This is the main LangGraph-based state machine that replaces the XState
 * implementation. It uses LangGraph's graph-based architecture to manage
 * HVAC system states and transitions.
 */

import { Annotation, StateGraph } from '@langchain/langgraph';
import {
  createDefaultHVACState,
  HVACInputEvent,
  HVACLangGraphState,
} from './lg-types/hvac-state.ts';
import { evaluationNode } from './lg-nodes/evaluation-node.ts';
import { heatingNode } from './lg-nodes/heating-node.ts';
import { coolingNode } from './lg-nodes/cooling-node.ts';
import { idleNode } from './lg-nodes/idle-node.ts';
import { offNode } from './lg-nodes/off-node.ts';
import { HVACMode, SystemMode } from '../types/common.ts';
import { ApplicationOptions, HvacOptions } from '../config/config.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * LangGraph-based HVAC State Machine
 *
 * This class provides the same interface as the XState implementation
 * but uses LangGraph's graph execution model internally.
 */
export class HVACLangGraphStateMachine {
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

    this.graph = this.buildGraph();
    this.logger.info('🔧 [LangGraph] HVAC State Machine initialized', {
      systemMode: hvacOptions.systemMode,
      aiEnabled: appOptions.useAi,
      initialState: this.currentState.currentMode,
    });
  }

  /**
   * Build the LangGraph state machine graph
   */
  private buildGraph(): StateGraph<HVACLangGraphState> {
    // Define the state schema for LangGraph with channels
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
        graphStartTime: {
          value: (x: Date, y: Date) => y || x,
          default: () => new Date(),
        },
        currentHour: {
          value: (x: number, y: number) => y !== undefined ? y : x,
          default: () => new Date().getHours(),
        },
        isWeekday: {
          value: (x: boolean, y: boolean) => y !== undefined ? y : x,
          default: () => new Date().getDay() >= 1 && new Date().getDay() <= 5,
        },
      },
    };

    const graph = new StateGraph(stateSchema);

    // Add all nodes
    graph.addNode('evaluate', evaluationNode);
    graph.addNode('heating', heatingNode);
    graph.addNode('cooling', coolingNode);
    graph.addNode('idle', idleNode);
    graph.addNode('off', offNode);

    // Set entry point
    graph.setEntryPoint('evaluate');

    // Add conditional edges from evaluation node
    graph.addConditionalEdges(
      'evaluate',
      this.routeFromEvaluation.bind(this),
      {
        'heating': 'heating',
        'cooling': 'cooling',
        'idle': 'idle',
        'off': 'off',
        'END': '__end__',
      },
    );

    // Add edges that terminate execution after action nodes
    // This prevents infinite loops by ending after each action
    graph.addEdge('heating', '__end__');
    graph.addEdge('cooling', '__end__');
    graph.addEdge('idle', '__end__');
    graph.addEdge('off', '__end__');

    return graph;
  }

  /**
   * Route from evaluation node based on current mode
   */
  private routeFromEvaluation(state: HVACLangGraphState): string {
    const mode = state.currentMode;

    this.logger.debug(`🔀 [LangGraph] Routing from evaluation to: ${mode}`, {
      indoorTemp: state.indoorTemp,
      outdoorTemp: state.outdoorTemp,
      systemMode: state.systemMode,
      decision: mode,
    });

    return mode;
  }

  /**
   * Route from off node
   */
  private routeFromOff(state: HVACLangGraphState): string {
    // Check if system should turn back on
    if (state.systemMode !== SystemMode.OFF && !state.manualOverride?.active) {
      return 'evaluate';
    }

    // Stay off
    return 'off';
  }

  /**
   * Start the state machine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warning('🔄 [LangGraph] State machine already running');
      return;
    }

    try {
      // Compile the graph
      this.compiledGraph = this.graph.compile();
      this.isRunning = true;

      this.logger.info('🚀 [LangGraph] Starting HVAC state machine', {
        initialState: this.currentState.currentMode,
        systemMode: this.currentState.systemMode,
        graphNodes: ['evaluate', 'heating', 'cooling', 'idle', 'off'],
      });

      // Start the evaluation loop
      await this.startEvaluationLoop();
    } catch (error) {
      this.logger.error('❌ [LangGraph] Failed to start state machine', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the state machine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 [LangGraph] Stopping HVAC state machine', {
      currentState: this.currentState.currentMode,
      totalTransitions: this.currentState.totalTransitions,
    });

    this.isRunning = false;

    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }

    // If currently in an active mode, transition to off
    if (this.currentState.currentMode !== 'off') {
      await this.executeTransition({ type: 'EVALUATE', timestamp: new Date() });
    }
  }

  /**
   * Start the evaluation loop
   */
  private async startEvaluationLoop(): Promise<void> {
    // Initial evaluation
    await this.executeTransition({ type: 'EVALUATE', timestamp: new Date() });

    // Set up periodic evaluation (reduced frequency to prevent spam)
    this.evaluationInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.executeTransition({
          type: 'TIME_TICK',
          timestamp: new Date(),
        });
      }
    }, 300000); // Evaluate every 5 minutes (same as XState)
  }

  /**
   * Execute a state transition
   */
  private async executeTransition(event: HVACInputEvent): Promise<void> {
    if (!this.compiledGraph) {
      throw new Error('Graph not compiled');
    }

    try {
      // Update state with current time information
      const now = new Date();
      this.currentState = {
        ...this.currentState,
        currentHour: now.getHours(),
        isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
      };

      // Execute the graph
      const result = await this.compiledGraph.invoke(this.currentState);

      // Update current state
      this.currentState = result;

      this.logger.debug('🔄 [LangGraph] State transition completed', {
        event: event.type,
        currentMode: this.currentState.currentMode,
        totalTransitions: this.currentState.totalTransitions,
      });
    } catch (error) {
      this.logger.error('❌ [LangGraph] State transition failed', error, {
        event: event.type,
        currentMode: this.currentState.currentMode,
      });

      // Update error state
      this.currentState = {
        ...this.currentState,
        lastError: {
          timestamp: new Date(),
          error: error instanceof Error ? error.message : String(error),
          node: 'transition',
          recoveryAction: 'continue_current_state',
        },
      };
    }
  }

  /**
   * Handle temperature change events
   */
  async handleTemperatureChange(sensor: string, value: number): Promise<void> {
    this.logger.debug('🌡️ [LangGraph] Temperature change received', {
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
    await this.executeTransition({
      type: 'TEMPERATURE_UPDATE',
      payload: { sensor, value },
      timestamp: new Date(),
    });
  }

  /**
   * Handle manual override
   */
  async manualOverride(mode: HVACMode, temperature?: number): Promise<void> {
    this.logger.info('👤 [LangGraph] Manual override triggered', {
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
    await this.executeTransition({
      type: 'MANUAL_OVERRIDE',
      payload: { mode: mode.toLowerCase(), temperature },
      timestamp: new Date(),
    });
  }

  /**
   * Get current state information
   */
  getCurrentState(): string {
    return this.currentState.currentMode;
  }

  /**
   * Get current context (for compatibility with XState interface)
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
   * Get enhanced status information (LangGraph specific)
   */
  getStatus(): {
    currentState: string;
    context: Record<string, unknown>;
    canHeat: boolean;
    canCool: boolean;
    systemMode: SystemMode;
    evaluationHistory: Array<{
      timestamp: Date;
      decision: string;
      reasoning: string;
      conditions: Record<string, unknown>;
      executionTimeMs: number;
    }>;
    performanceMetrics: {
      nodeExecutionTimes: Record<string, number[]>;
      totalTransitions: number;
      lastEvaluationDuration: number;
      avgDecisionTime: number;
    };
    totalTransitions: number;
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
    };
  }

  /**
   * Get internal state (for debugging and testing)
   */
  getInternalState(): HVACLangGraphState {
    return { ...this.currentState };
  }

  /**
   * Clear manual override
   */
  async clearManualOverride(): Promise<void> {
    this.logger.info('🔄 [LangGraph] Clearing manual override');

    this.currentState = {
      ...this.currentState,
      manualOverride: {
        active: false,
      },
    };

    await this.executeTransition({
      type: 'EVALUATE',
      timestamp: new Date(),
    });
  }

  /**
   * Update system mode
   */
  async updateSystemMode(systemMode: SystemMode): Promise<void> {
    this.logger.info('⚙️ [LangGraph] System mode updated', {
      oldMode: this.currentState.systemMode,
      newMode: systemMode,
    });

    this.currentState = {
      ...this.currentState,
      systemMode,
    };

    await this.executeTransition({
      type: 'SYSTEM_MODE_CHANGE',
      payload: { systemMode },
      timestamp: new Date(),
    });
  }
}
