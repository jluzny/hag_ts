/**
 * LangGraph Heating Node for HVAC System
 *
 * This node handles the execution of heating actions when the system
 * is in heating mode. It coordinates with the HVAC controller to
 * activate heating on all configured entities.
 */

import { HVACLangGraphState } from '../lg-types/hvac-state.ts';

/**
 * Heating node - Execute heating actions
 *
 * This node performs the actual heating operations when the system
 * has determined heating is needed.
 */
export async function heatingNode(
  state: HVACLangGraphState,
): Promise<HVACLangGraphState> {
  const startTime = performance.now();

  // Yield control to event loop for async consistency
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    // Validate heating conditions
    if (!canExecuteHeating(state)) {
      return transitionToIdle(state, 'Heating conditions no longer valid');
    }

    // Log heating action start
    console.log(`🔥 [LangGraph] Starting heating operation`, {
      indoorTemp: state.indoorTemp,
      targetTemp: getTargetHeatingTemp(state),
      outdoorTemp: state.outdoorTemp,
      timestamp: new Date().toISOString(),
    });

    // Execute heating through controller
    // Note: In real implementation, this would call the actual HVAC controller
    const heatingResult = executeHeatingAction(state);

    const executionTime = performance.now() - startTime;

    // Update state with heating execution results
    return {
      ...state,
      currentMode: 'heating',
      lastActionTimestamp: new Date(),
      lastActionResult: {
        action: 'heating',
        success: heatingResult.success,
        timestamp: new Date(),
        details: heatingResult,
      },
      performanceMetrics: updateNodeMetrics(state, 'heating', executionTime),
      evaluationHistory: [
        ...state.evaluationHistory.slice(-19),
        {
          timestamp: new Date(),
          decision: 'heating_executed',
          reasoning: `Heating activated: target ${
            getTargetHeatingTemp(state)
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
    console.error('Heating node error:', error);

    return {
      ...state,
      currentMode: 'idle', // Safe fallback
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: 'heating',
        recoveryAction: 'fallback_to_idle',
      },
    };
  }
}

/**
 * Validate if heating can be safely executed
 */
function canExecuteHeating(state: HVACLangGraphState): boolean {
  // Check for manual override that prevents heating
  if (state.manualOverride?.active && state.manualOverride.mode !== 'heating') {
    return false;
  }

  // Check if temperatures are still valid for heating
  if (state.indoorTemp === undefined || state.outdoorTemp === undefined) {
    return false;
  }

  // Safety check: don't heat if it's already too hot
  const targetTemp = getTargetHeatingTemp(state);
  if (state.indoorTemp >= targetTemp + 1.0) {
    return false;
  }

  // Outdoor temperature safety check (e.g., don't heat if it's very hot outside)
  if (state.outdoorTemp > 30.0) {
    return false;
  }

  return true;
}

/**
 * Execute heating action through HVAC controller
 * In real implementation, this would interface with the actual controller
 */
function executeHeatingAction(state: HVACLangGraphState): {
  success: boolean;
  entitiesControlled: number;
  targetTemperature: number;
  presetMode: string;
} {
  // Simulate HVAC controller interaction
  const targetTemp = getTargetHeatingTemp(state);
  const presetMode = getHeatingPresetMode(state);

  // In real implementation:
  // const controller = getHVACController();
  // const result = await controller.executeHVACMode(HVACMode.HEAT, targetTemp);

  // Simulated successful heating execution
  return {
    success: true,
    entitiesControlled: 5, // From config: 5 HVAC entities
    targetTemperature: targetTemp,
    presetMode: presetMode,
  };
}

/**
 * Get target heating temperature based on configuration and conditions
 */
function getTargetHeatingTemp(state: HVACLangGraphState): number {
  // Default heating temperature from config
  let targetTemp = 21.0;

  // Apply manual override if active
  if (state.manualOverride?.active && state.manualOverride.temperature) {
    targetTemp = state.manualOverride.temperature;
  }

  // Time-based adjustments (could be enhanced with AI in Phase 4)
  if (!state.isWeekday && (state.currentHour < 8 || state.currentHour > 22)) {
    // Reduce heating during weekend nights/early mornings
    targetTemp -= 1.0;
  }

  return Math.max(18.0, Math.min(26.0, targetTemp)); // Safety bounds
}

/**
 * Get heating preset mode
 */
function getHeatingPresetMode(state: HVACLangGraphState): string {
  // Default from config
  let presetMode = 'windFreeSleep';

  // Time-based preset adjustments
  if (state.currentHour >= 22 || state.currentHour <= 6) {
    presetMode = 'sleep'; // Quieter operation at night
  } else if (state.currentHour >= 7 && state.currentHour <= 9) {
    presetMode = 'turbo'; // Faster heating in morning
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
        decision: 'heating_to_idle',
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
 * Update performance metrics for heating node
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
