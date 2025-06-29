/**
 * LangGraph Cooling Node for HVAC System
 *
 * This node handles the execution of cooling actions when the system
 * is in cooling mode. It coordinates with the HVAC controller to
 * activate cooling on all configured entities.
 */

import { HVACLangGraphState } from '../lg-types/hvac-state.ts';
import { HVACMode } from '../../types/common.ts';

/**
 * Cooling node - Execute cooling actions
 *
 * This node performs the actual cooling operations when the system
 * has determined cooling is needed.
 */
export async function coolingNode(
  state: HVACLangGraphState,
): Promise<HVACLangGraphState> {
  const startTime = performance.now();

  try {
    // Validate cooling conditions
    if (!canExecuteCooling(state)) {
      return transitionToIdle(state, 'Cooling conditions no longer valid');
    }

    // Log cooling action start
    console.log(`❄️ [LangGraph] Starting cooling operation`, {
      indoorTemp: state.indoorTemp,
      targetTemp: getTargetCoolingTemp(state),
      outdoorTemp: state.outdoorTemp,
      timestamp: new Date().toISOString(),
    });

    // Execute cooling through controller
    const coolingResult = await executeCoolingAction(state);

    const executionTime = performance.now() - startTime;

    // Update state with cooling execution results
    return {
      ...state,
      currentMode: 'cooling',
      lastActionTimestamp: new Date(),
      lastActionResult: {
        action: 'cooling',
        success: coolingResult.success,
        timestamp: new Date(),
        details: coolingResult,
      },
      performanceMetrics: updateNodeMetrics(state, 'cooling', executionTime),
      evaluationHistory: [
        ...state.evaluationHistory.slice(-19),
        {
          timestamp: new Date(),
          decision: 'cooling_executed',
          reasoning: `Cooling activated: target ${
            getTargetCoolingTemp(state)
          }°C`,
          conditions: {
            indoorTemp: state.indoorTemp,
            outdoorTemp: state.outdoorTemp,
            systemMode: state.systemMode,
            currentHour: state.currentHour,
            isWeekday: state.isWeekday,
          },
          executionTimeMs: executionTime,
        },
      ],
    };
  } catch (error) {
    console.error('Cooling node error:', error);

    return {
      ...state,
      currentMode: 'idle', // Safe fallback
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: 'cooling',
        recoveryAction: 'fallback_to_idle',
      },
    };
  }
}

/**
 * Validate if cooling can be safely executed
 */
function canExecuteCooling(state: HVACLangGraphState): boolean {
  // Check for manual override that prevents cooling
  if (state.manualOverride?.active && state.manualOverride.mode !== 'cooling') {
    return false;
  }

  // Check if temperatures are still valid for cooling
  if (state.indoorTemp === undefined || state.outdoorTemp === undefined) {
    return false;
  }

  // Safety check: don't cool if it's already too cold
  const targetTemp = getTargetCoolingTemp(state);
  if (state.indoorTemp <= targetTemp - 1.0) {
    return false;
  }

  // Outdoor temperature efficiency check
  if (state.outdoorTemp < 15.0) {
    return false; // Inefficient to cool when it's cold outside
  }

  return true;
}

/**
 * Execute cooling action through HVAC controller
 */
async function executeCoolingAction(state: HVACLangGraphState): Promise<{
  success: boolean;
  entitiesControlled: number;
  targetTemperature: number;
  presetMode: string;
}> {
  const targetTemp = getTargetCoolingTemp(state);
  const presetMode = getCoolingPresetMode(state);

  // In real implementation:
  // const controller = getHVACController();
  // const result = await controller.executeHVACMode(HVACMode.COOL, targetTemp);

  // Simulated successful cooling execution
  return {
    success: true,
    entitiesControlled: 5, // From config: 5 HVAC entities
    targetTemperature: targetTemp,
    presetMode: presetMode,
  };
}

/**
 * Get target cooling temperature based on configuration and conditions
 */
function getTargetCoolingTemp(state: HVACLangGraphState): number {
  // Default cooling temperature from config
  let targetTemp = 24.0;

  // Apply manual override if active
  if (state.manualOverride?.active && state.manualOverride.temperature) {
    targetTemp = state.manualOverride.temperature;
  }

  // Time-based adjustments
  if (!state.isWeekday && (state.currentHour < 8 || state.currentHour > 22)) {
    // Allow slightly warmer temperatures during weekend nights
    targetTemp += 1.0;
  }

  // Energy efficiency: adjust based on outdoor temperature
  if (state.outdoorTemp && state.outdoorTemp > 35.0) {
    // Don't overcool when it's very hot outside (energy efficiency)
    targetTemp += 0.5;
  }

  return Math.max(20.0, Math.min(28.0, targetTemp)); // Safety bounds
}

/**
 * Get cooling preset mode based on conditions
 */
function getCoolingPresetMode(state: HVACLangGraphState): string {
  // Default from config
  let presetMode = 'windFree';

  // Time-based preset adjustments
  if (state.currentHour >= 22 || state.currentHour <= 6) {
    presetMode = 'sleep'; // Quieter operation at night
  } else if (state.outdoorTemp && state.outdoorTemp > 35.0) {
    presetMode = 'turbo'; // More aggressive cooling when very hot
  } else if (state.currentHour >= 13 && state.currentHour <= 17) {
    presetMode = 'eco'; // Energy efficient during peak hours
  }

  return presetMode;
}

/**
 * Transition to idle state with reasoning
 */
function transitionToIdle(
  state: HVACLangGraphState,
  reason: string,
): HVACLangGraphState {
  return {
    ...state,
    currentMode: 'idle',
    evaluationHistory: [
      ...state.evaluationHistory.slice(-19),
      {
        timestamp: new Date(),
        decision: 'cooling_to_idle',
        reasoning: reason,
        conditions: {
          indoorTemp: state.indoorTemp,
          outdoorTemp: state.outdoorTemp,
          systemMode: state.systemMode,
          currentHour: state.currentHour,
          isWeekday: state.isWeekday,
        },
        executionTimeMs: 0,
      },
    ],
  };
}

/**
 * Update performance metrics for cooling node
 */
function updateNodeMetrics(
  state: HVACLangGraphState,
  operation: string,
  executionTime: number,
): typeof state.performanceMetrics {
  const current = state.performanceMetrics || {
    nodeExecutionTimes: {},
    totalTransitions: 0,
    lastEvaluationDuration: 0,
    avgDecisionTime: 0,
  };

  if (!current.nodeExecutionTimes[operation]) {
    current.nodeExecutionTimes[operation] = [];
  }

  current.nodeExecutionTimes[operation].push(executionTime);

  // Keep only last 50 measurements
  if (current.nodeExecutionTimes[operation].length > 50) {
    current.nodeExecutionTimes[operation] = current
      .nodeExecutionTimes[operation].slice(-50);
  }

  return {
    ...current,
    totalTransitions: current.totalTransitions + 1,
  };
}
