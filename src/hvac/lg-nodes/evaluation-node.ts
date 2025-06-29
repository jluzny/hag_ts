/**
 * LangGraph Evaluation Node for HVAC System
 * 
 * This node performs the core evaluation logic that was previously handled
 * in XState guards and actions. It determines the next HVAC mode based on
 * current conditions.
 */

import { HVACLangGraphState, EvaluationHistoryEntry } from '../lg-types/hvac-state.ts';
import { SystemMode } from '../../types/common.ts';
import { HeatingStrategy, CoolingStrategy } from '../state-machine.ts';

/**
 * Evaluation node - Core decision making logic
 * 
 * This replicates the XState evaluation logic but in LangGraph node format
 */
export async function evaluationNode(state: HVACLangGraphState): Promise<HVACLangGraphState> {
  const startTime = performance.now();
  
  // Extract current conditions
  const { 
    indoorTemp, 
    outdoorTemp, 
    systemMode, 
    currentHour, 
    isWeekday,
    manualOverride 
  } = state;
  
  let newMode: string;
  let reasoning: string;
  
  try {
    // Check for manual override first
    if (manualOverride?.active) {
      const now = new Date();
      if (manualOverride.expiresAt && now > manualOverride.expiresAt) {
        // Override expired, clear it
        newMode = await evaluateAutomaticMode(state);
        reasoning = "Manual override expired, resuming automatic operation";
      } else {
        newMode = manualOverride.mode || "idle";
        reasoning = `Manual override active: ${newMode}`;
      }
    } else {
      newMode = await evaluateAutomaticMode(state);
      reasoning = await getEvaluationReasoning(state, newMode);
    }
    
    const executionTime = performance.now() - startTime;
    
    // Create evaluation history entry
    const historyEntry: EvaluationHistoryEntry = {
      timestamp: new Date(),
      decision: newMode,
      reasoning,
      conditions: {
        indoorTemp,
        outdoorTemp,
        systemMode,
        currentHour,
        isWeekday
      },
      executionTimeMs: executionTime
    };
    
    // Update performance metrics
    const updatedMetrics = updatePerformanceMetrics(state, 'evaluation', executionTime);
    
    return {
      ...state,
      currentMode: newMode as any,
      previousMode: state.currentMode,
      evaluationHistory: [
        ...state.evaluationHistory.slice(-19), // Keep last 20 entries
        historyEntry
      ],
      totalTransitions: state.totalTransitions + 1,
      performanceMetrics: updatedMetrics,
      lastError: undefined // Clear any previous errors
    };
    
  } catch (error) {
    // Error handling
    console.error('Evaluation node error:', error);
    
    return {
      ...state,
      currentMode: "idle", // Safe fallback
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: "evaluation",
        recoveryAction: "fallback_to_idle"
      }
    };
  }
}

/**
 * Core automatic mode evaluation logic
 * Replicates XState guard conditions
 */
async function evaluateAutomaticMode(state: HVACLangGraphState): Promise<string> {
  const { systemMode, indoorTemp, outdoorTemp } = state;
  
  // System is turned off
  if (systemMode === SystemMode.OFF) {
    return "off";
  }
  
  // No temperature readings available
  if (indoorTemp === undefined || outdoorTemp === undefined) {
    return "idle";
  }
  
  // Create mock strategies (in real implementation, these would be injected)
  const heatingStrategy = createMockHeatingStrategy();
  const coolingStrategy = createMockCoolingStrategy();
  
  // Convert state to strategy format
  const strategyData = {
    currentTemp: indoorTemp,
    weatherTemp: outdoorTemp,
    hour: state.currentHour,
    isWeekday: state.isWeekday
  };
  
  // Apply heating/cooling logic based on system mode
  switch (systemMode) {
    case SystemMode.HEAT_ONLY:
      return heatingStrategy.shouldHeat(strategyData) ? "heating" : "idle";
      
    case SystemMode.COOL_ONLY:
      return coolingStrategy.shouldCool(strategyData) ? "cooling" : "idle";
      
    case SystemMode.AUTO:
    default:
      // Priority: heating > cooling > idle
      if (heatingStrategy.shouldHeat(strategyData)) {
        return "heating";
      } else if (coolingStrategy.shouldCool(strategyData)) {
        return "cooling";
      } else {
        return "idle";
      }
  }
}

/**
 * Generate human-readable reasoning for the decision
 */
async function getEvaluationReasoning(state: HVACLangGraphState, decision: string): Promise<string> {
  const { indoorTemp, outdoorTemp, systemMode } = state;
  
  switch (decision) {
    case "off":
      return `System mode set to OFF`;
      
    case "heating":
      return `Heating needed: indoor ${indoorTemp}°C below comfort threshold (outdoor: ${outdoorTemp}°C)`;
      
    case "cooling":
      return `Cooling needed: indoor ${indoorTemp}°C above comfort threshold (outdoor: ${outdoorTemp}°C)`;
      
    case "idle":
      if (indoorTemp === undefined) {
        return "No temperature readings available, staying idle";
      }
      return `Temperature within comfort range: ${indoorTemp}°C (outdoor: ${outdoorTemp}°C)`;
      
    default:
      return `Unknown decision: ${decision}`;
  }
}

/**
 * Update performance metrics
 */
function updatePerformanceMetrics(
  state: HVACLangGraphState, 
  operation: string, 
  executionTime: number
): typeof state.performanceMetrics {
  const current = state.performanceMetrics || {
    nodeExecutionTimes: {},
    totalTransitions: 0,
    lastEvaluationDuration: 0,
    avgDecisionTime: 0
  };
  
  // Update execution times for this operation
  if (!current.nodeExecutionTimes[operation]) {
    current.nodeExecutionTimes[operation] = [];
  }
  current.nodeExecutionTimes[operation].push(executionTime);
  
  // Keep only last 50 measurements per operation
  if (current.nodeExecutionTimes[operation].length > 50) {
    current.nodeExecutionTimes[operation] = current.nodeExecutionTimes[operation].slice(-50);
  }
  
  // Update averages
  const allTimes = Object.values(current.nodeExecutionTimes).flat();
  const avgTime = allTimes.reduce((sum, time) => sum + time, 0) / allTimes.length;
  
  return {
    ...current,
    lastEvaluationDuration: executionTime,
    avgDecisionTime: avgTime,
    totalTransitions: current.totalTransitions + 1
  };
}

/**
 * Mock strategy implementations (temporary)
 * TODO: Replace with actual strategy injection
 */
function createMockHeatingStrategy() {
  return {
    shouldHeat: (data: any) => {
      // Simple threshold logic - replace with actual heating strategy
      return data.currentTemp < 20.0 && data.weatherTemp < 15.0;
    }
  };
}

function createMockCoolingStrategy() {
  return {
    shouldCool: (data: any) => {
      // Simple threshold logic - replace with actual cooling strategy  
      return data.currentTemp > 24.0 && data.weatherTemp > 22.0;
    }
  };
}