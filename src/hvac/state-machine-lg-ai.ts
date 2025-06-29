/**
 * AI-Enhanced LangGraph HVAC State Machine Implementation
 *
 * This extends the LangGraph v2 implementation with AI-powered decision making,
 * providing intelligent HVAC control while maintaining the same interface.
 */

import { StateGraph } from '@langchain/langgraph';
import {
  createDefaultHVACState,
  HVACInputEvent,
  HVACLangGraphState,
} from './lg-types/hvac-state.ts';
import { AIEnhancedState } from '../ai/types/ai-types.ts';
import { AIDecisionConfig, AIDecisionEngine } from '../ai/decision-engine.ts';
import { createAIEvaluationNode } from './lg-nodes/ai-evaluation-node.ts';
import { HVACMode, SystemMode } from '../types/common.ts';
import { ApplicationOptions, HvacOptions } from '../config/config.ts';
import type { LoggerService } from '../core/logger.ts';

/**
 * AI-Enhanced LangGraph HVAC State Machine
 *
 * This version replaces rule-based logic with AI-powered decision making
 * while maintaining the same external interface as the v2 implementation.
 */
export class HVACAILangGraphStateMachine {
  private graph: StateGraph<HVACLangGraphState>;
  private compiledGraph: any;
  private currentState: AIEnhancedState;
  private isRunning: boolean = false;
  private evaluationInterval?: number;

  private aiDecisionEngine: AIDecisionEngine;
  private aiEvaluationNode: (
    state: HVACLangGraphState,
  ) => Promise<HVACLangGraphState>;

  constructor(
    private hvacOptions: HvacOptions,
    private appOptions: ApplicationOptions,
    private logger: LoggerService,
  ) {
    // Initialize AI decision engine
    const aiConfig: AIDecisionConfig = {
      openaiApiKey: appOptions.openaiApiKey,
      model: appOptions.aiModel || 'gpt-4',
      temperature: 0.3, // Lower temperature for more consistent decisions
      maxTokens: 500,
      enabled: appOptions.useAi === true,
      fallbackToRules: true,
      maxRetries: 3,
      timeoutMs: 10000, // 10 second timeout
    };

    this.aiDecisionEngine = new AIDecisionEngine(aiConfig, logger);
    this.aiEvaluationNode = createAIEvaluationNode(
      this.aiDecisionEngine,
      logger,
    );

    // Initialize state
    this.currentState = this.createInitialState();

    // Build graph with AI evaluation
    this.graph = this.buildAIGraph();

    this.logger.info('🤖 [AI State Machine] Initialized', {
      systemMode: hvacOptions.systemMode,
      aiEnabled: aiConfig.enabled,
      model: aiConfig.model,
      approach: 'ai-enhanced-event-driven',
    });
  }

  /**
   * Create initial AI-enhanced state
   */
  private createInitialState(): AIEnhancedState {
    const baseState = createDefaultHVACState({
      systemMode: this.hvacOptions.systemMode,
      aiEnabled: this.appOptions.useAi || false,
    });

    return {
      ...baseState,
      aiContext: {
        decisionHistory: [],
        optimizationGoals: {
          energyEfficiency: 0.7,
          comfortPriority: 0.8,
          costOptimization: 0.6,
        },
      },
      aiMetrics: {
        totalAIDecisions: 0,
        aiSuccessRate: 1.0,
        avgDecisionTime: 0,
        fallbackRate: 0,
      },
    };
  }

  /**
   * Build AI-enhanced evaluation graph
   */
  private buildAIGraph(): StateGraph<HVACLangGraphState> {
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
        aiContext: {
          value: (x: any, y: any) => y || x,
          default: () => ({
            decisionHistory: [],
            optimizationGoals: {
              energyEfficiency: 0.7,
              comfortPriority: 0.8,
              costOptimization: 0.6,
            },
          }),
        },
        aiMetrics: {
          value: (x: any, y: any) => y || x,
          default: () => ({
            totalAIDecisions: 0,
            aiSuccessRate: 1.0,
            avgDecisionTime: 0,
            fallbackRate: 0,
          }),
        },
      },
    };

    const graph = new StateGraph(stateSchema);

    // Add AI evaluation node
    graph.addNode('ai_evaluate', this.aiEvaluationNode);

    // Set entry point and terminate after evaluation
    graph.setEntryPoint('ai_evaluate');
    graph.addEdge('ai_evaluate', '__end__');

    return graph;
  }

  /**
   * Start the AI state machine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warning('🔄 [AI State Machine] Already running');
      return;
    }

    try {
      // Check AI engine health
      const healthCheck = await this.aiDecisionEngine.healthCheck();
      this.logger.info(
        '🏥 [AI State Machine] AI Engine Health Check',
        healthCheck,
      );

      this.compiledGraph = this.graph.compile();
      this.isRunning = true;

      this.logger.info(
        '🚀 [AI State Machine] Starting AI-enhanced HVAC state machine',
        {
          initialState: this.currentState.currentMode,
          systemMode: this.currentState.systemMode,
          aiHealthy: healthCheck.healthy,
          approach: 'ai-enhanced-event-driven',
        },
      );

      // Perform initial AI evaluation
      await this.performAIEvaluation('STARTUP');

      // Set up periodic evaluation
      this.setupPeriodicEvaluation();
    } catch (error) {
      this.logger.error('❌ [AI State Machine] Failed to start', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the AI state machine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 [AI State Machine] Stopping', {
      currentState: this.currentState.currentMode,
      totalTransitions: this.currentState.totalTransitions,
      totalAIDecisions: this.currentState.aiMetrics?.totalAIDecisions,
      aiSuccessRate: this.currentState.aiMetrics?.aiSuccessRate,
    });

    this.isRunning = false;

    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
  }

  /**
   * Perform AI-powered evaluation
   */
  private async performAIEvaluation(trigger: string): Promise<void> {
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

      this.logger.debug('🧠 [AI State Machine] Starting AI evaluation', {
        trigger,
        currentMode: inputState.currentMode,
        indoorTemp: inputState.indoorTemp,
        outdoorTemp: inputState.outdoorTemp,
        aiDecisionsCount: inputState.aiMetrics?.totalAIDecisions,
      });

      // Execute AI-enhanced graph
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
        `${
          stateChanged ? '🔄' : '✅'
        } [AI State Machine] AI evaluation completed`,
        {
          trigger,
          previousMode,
          newMode,
          stateChanged,
          executionTimeMs: executionTime,
          totalTransitions: this.currentState.totalTransitions,
          aiDecision: this.currentState.lastDecision?.confidence
            ? `${
              (this.currentState.lastDecision.confidence * 100).toFixed(0)
            }% confident`
            : 'N/A',
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
      this.logger.error('❌ [AI State Machine] AI evaluation failed', error, {
        trigger,
        currentMode: this.currentState.currentMode,
      });
    }
  }

  /**
   * Execute HVAC action (placeholder for controller integration)
   */
  private async executeAction(
    mode: string,
    state: HVACLangGraphState,
  ): Promise<void> {
    this.logger.info(`⚡ [AI State Machine] Executing ${mode} action`, {
      mode,
      indoorTemp: state.indoorTemp,
      outdoorTemp: state.outdoorTemp,
      aiReasoning: state.lastDecision?.reasoning,
      dryRun: true, // Always dry run in this implementation
    });

    // In real implementation, this would call the HVAC controller
    switch (mode) {
      case 'heating':
        this.logger.debug('🔥 [AI State Machine] Would activate heating');
        break;
      case 'cooling':
        this.logger.debug('❄️ [AI State Machine] Would activate cooling');
        break;
      case 'off':
        this.logger.debug('🛑 [AI State Machine] Would turn off HVAC');
        break;
    }
  }

  /**
   * Set up periodic AI evaluation
   */
  private setupPeriodicEvaluation(): void {
    this.evaluationInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.performAIEvaluation('PERIODIC');
      }
    }, 300000); // 5 minutes
  }

  /**
   * Handle temperature change events
   */
  async handleTemperatureChange(sensor: string, value: number): Promise<void> {
    this.logger.debug('🌡️ [AI State Machine] Temperature change received', {
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

    // Trigger AI evaluation
    await this.performAIEvaluation('TEMPERATURE_CHANGE');
  }

  /**
   * Handle manual override
   */
  async manualOverride(mode: HVACMode, temperature?: number): Promise<void> {
    this.logger.info('👤 [AI State Machine] Manual override triggered', {
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

    // Trigger AI evaluation with manual override context
    await this.performAIEvaluation('MANUAL_OVERRIDE');
  }

  /**
   * Clear manual override
   */
  async clearManualOverride(): Promise<void> {
    this.logger.info('🔄 [AI State Machine] Clearing manual override');

    this.currentState = {
      ...this.currentState,
      manualOverride: {
        active: false,
      },
    };

    await this.performAIEvaluation('CLEAR_OVERRIDE');
  }

  /**
   * Update system mode
   */
  async updateSystemMode(systemMode: SystemMode): Promise<void> {
    this.logger.info('⚙️ [AI State Machine] System mode updated', {
      oldMode: this.currentState.systemMode,
      newMode: systemMode,
    });

    this.currentState = {
      ...this.currentState,
      systemMode,
    };

    await this.performAIEvaluation('SYSTEM_MODE_CHANGE');
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
   * Get enhanced status information including AI metrics
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
    aiMetrics?: typeof this.currentState.aiMetrics;
    lastAIDecision?: any;
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
      aiMetrics: this.currentState.aiMetrics,
      lastAIDecision: this.currentState.lastDecision,
      lastEvaluationTime: (this.currentState as any).lastEvaluationTime,
      lastEvaluationTrigger: (this.currentState as any).lastEvaluationTrigger,
      lastEvaluationDuration: (this.currentState as any).lastEvaluationDuration,
    };
  }

  /**
   * Get AI-specific decision history
   */
  getAIDecisionHistory(): any[] {
    return this.currentState.aiContext?.decisionHistory || [];
  }

  /**
   * Get AI engine health status
   */
  async getAIHealthStatus(): Promise<any> {
    return await this.aiDecisionEngine.healthCheck();
  }

  /**
   * Get internal state for debugging
   */
  getInternalState(): AIEnhancedState {
    return { ...this.currentState };
  }
}
