/**
 * AI-Enhanced Evaluation Node for LangGraph HVAC State Machine
 *
 * This node integrates AI decision-making with the existing LangGraph
 * state machine structure, providing intelligent HVAC control decisions.
 */

import { AIDecisionEngine } from '../../ai/decision-engine.ts';
import {
  AIEnhancedState,
  DecisionResult,
  HVACDecisionContext,
} from '../../ai/types/ai-types.ts';
import { HVACLangGraphState } from '../lg-types/hvac-state.ts';
import { SystemMode } from '../../types/common.ts';
import { LoggerService } from '../../core/logger.ts';

/**
 * AI-enhanced evaluation node that replaces traditional rule-based logic
 * with intelligent AI-powered decision making
 */
export async function aiEvaluationNode(
  state: HVACLangGraphState,
  aiEngine?: AIDecisionEngine,
  logger?: LoggerService,
): Promise<HVACLangGraphState> {
  const startTime = performance.now();

  // Default logger if not provided
  const log = logger || {
    debug: () => {},
    info: () => {},
    warning: () => {},
    error: () => {},
  } as LoggerService;

  log.debug('🧠 [AI Evaluation] Starting AI-enhanced evaluation', {
    currentMode: state.currentMode,
    indoorTemp: state.indoorTemp,
    outdoorTemp: state.outdoorTemp,
    systemMode: state.systemMode,
  });

  try {
    let decision: DecisionResult;

    if (aiEngine) {
      // Use AI for decision making
      const context = buildDecisionContext(state);
      decision = await aiEngine.makeDecision(context);
    } else {
      // Fallback to rule-based logic
      decision = makeFallbackDecision(state);
      log.warning(
        '⚠️ [AI Evaluation] No AI engine available, using fallback logic',
      );
    }

    // Update state with AI decision
    const updatedState = applyDecision(state, decision);

    // Add AI-specific metadata
    const aiEnhancedState = enhanceStateWithAI(updatedState, decision);

    const executionTime = performance.now() - startTime;

    log.info('✅ [AI Evaluation] Decision completed', {
      decision: decision.action,
      confidence: decision.confidence,
      source: decision.source,
      reasoning: decision.reasoning.substring(0, 100) + '...',
      executionTimeMs: executionTime,
      stateChanged: state.currentMode !== decision.action,
    });

    return aiEnhancedState;
  } catch (error) {
    log.error('❌ [AI Evaluation] Failed to make decision', error);

    // Emergency fallback to basic logic
    const fallbackDecision = makeFallbackDecision(state);
    const updatedState = applyDecision(state, fallbackDecision);

    return {
      ...updatedState,
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: 'ai_evaluation',
        recoveryAction: 'fallback_to_rules',
      },
    };
  }
}

/**
 * Build decision context from current state
 */
function buildDecisionContext(state: HVACLangGraphState): HVACDecisionContext {
  return {
    indoorTemp: state.indoorTemp,
    outdoorTemp: state.outdoorTemp,
    targetTemp: state.manualOverride?.temperature || 22, // Default target
    systemMode: state.systemMode,
    currentMode: state.currentMode,
    currentHour: state.currentHour,
    isWeekday: state.isWeekday,
    manualOverride: state.manualOverride,
    lastTransitionTime: state.lastActionTimestamp,
    recentTransitions: state.totalTransitions,

    // Energy context (future enhancement)
    energyPrice: {
      level: 'medium',
      rate: 0.12, // Default rate per kWh
    },
  };
}

/**
 * Apply AI decision to state
 */
function applyDecision(
  state: HVACLangGraphState,
  decision: DecisionResult,
): HVACLangGraphState {
  const now = new Date();
  const stateChanged = state.currentMode !== decision.action;

  return {
    ...state,
    currentMode: decision.action,
    lastDecision: {
      action: decision.action,
      timestamp: now,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      source: decision.source,
    },
    totalTransitions: state.totalTransitions + (stateChanged ? 1 : 0),
    lastActionTimestamp: stateChanged ? now : state.lastActionTimestamp,

    // Update evaluation history
    evaluationHistory: [
      ...state.evaluationHistory.slice(-19), // Keep last 19 entries
      {
        timestamp: now,
        decision: decision.action,
        reasoning: decision.reasoning,
        conditions: {
          indoorTemp: state.indoorTemp,
          outdoorTemp: state.outdoorTemp,
          systemMode: state.systemMode,
          currentHour: state.currentHour,
          isWeekday: state.isWeekday,
        },
        executionTimeMs: decision.executionTimeMs,
      },
    ],
  };
}

/**
 * Enhance state with AI-specific data
 */
function enhanceStateWithAI(
  state: HVACLangGraphState,
  decision: DecisionResult,
): AIEnhancedState {
  const aiEnhanced = state as AIEnhancedState;

  // Initialize AI context if not present
  if (!aiEnhanced.aiContext) {
    aiEnhanced.aiContext = {
      decisionHistory: [],
      optimizationGoals: {
        energyEfficiency: 0.7,
        comfortPriority: 0.8,
        costOptimization: 0.6,
      },
    };
  }

  // Add decision to history
  aiEnhanced.aiContext.decisionHistory = [
    ...aiEnhanced.aiContext.decisionHistory.slice(-49), // Keep last 49 decisions
    decision,
  ];

  // Update AI metrics
  if (!aiEnhanced.aiMetrics) {
    aiEnhanced.aiMetrics = {
      totalAIDecisions: 0,
      aiSuccessRate: 1.0,
      avgDecisionTime: 0,
      fallbackRate: 0,
    };
  }

  aiEnhanced.aiMetrics.totalAIDecisions++;
  aiEnhanced.aiMetrics.fallbackRate =
    aiEnhanced.aiContext.decisionHistory.filter((d) => d.fallbackUsed).length /
    aiEnhanced.aiContext.decisionHistory.length;

  const totalDecisionTime = aiEnhanced.aiContext.decisionHistory
    .reduce((sum, d) => sum + d.executionTimeMs, 0);
  aiEnhanced.aiMetrics.avgDecisionTime = totalDecisionTime /
    aiEnhanced.aiContext.decisionHistory.length;

  return aiEnhanced;
}

/**
 * Fallback decision logic when AI is unavailable
 */
function makeFallbackDecision(state: HVACLangGraphState): DecisionResult {
  const { indoorTemp, systemMode, manualOverride } = state;
  const targetTemp = manualOverride?.temperature || 22;

  let action = 'idle';
  let reasoning = 'Fallback rule-based decision: ';

  // Handle manual override
  if (manualOverride?.active && manualOverride.mode) {
    action = manualOverride.mode;
    reasoning += `Manual override active for ${manualOverride.mode}.`;
  } // Handle system off
  else if (systemMode === SystemMode.OFF) {
    action = 'off';
    reasoning += 'System mode is OFF.';
  } // Handle no temperature data
  else if (!indoorTemp) {
    action = 'idle';
    reasoning += 'No temperature data available, staying idle.';
  } // Temperature-based logic
  else {
    const tempDiff = indoorTemp - targetTemp;

    if (tempDiff < -1.5 && systemMode !== SystemMode.COOL_ONLY) {
      action = 'heating';
      reasoning += `Indoor ${indoorTemp}°C is ${
        Math.abs(tempDiff).toFixed(1)
      }°C below target ${targetTemp}°C.`;
    } else if (tempDiff > 1.5 && systemMode !== SystemMode.HEAT_ONLY) {
      action = 'cooling';
      reasoning += `Indoor ${indoorTemp}°C is ${
        tempDiff.toFixed(1)
      }°C above target ${targetTemp}°C.`;
    } else {
      action = 'idle';
      reasoning +=
        `Indoor ${indoorTemp}°C is within range of target ${targetTemp}°C.`;
    }
  }

  return {
    action: action as string,
    confidence: 0.7,
    reasoning,
    factors: ['temperature_differential', 'system_mode', 'manual_override'],
    energyImpact: action === 'idle' ? 'low' : 'medium',
    comfortImpact: 'medium',
    source: 'fallback',
    executionTimeMs: 0,
    fallbackUsed: true,
    fallbackReason: 'AI_ENGINE_UNAVAILABLE',
  };
}

/**
 * Create a configured AI evaluation node with injected dependencies
 */
export function createAIEvaluationNode(
  aiEngine: AIDecisionEngine,
  logger: LoggerService,
) {
  return async (state: HVACLangGraphState): Promise<HVACLangGraphState> => {
    return await aiEvaluationNode(state, aiEngine, logger);
  };
}
