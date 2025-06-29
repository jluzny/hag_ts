/**
 * LangGraph Off Node for HVAC System
 *
 * This node handles the system shutdown state where all HVAC operations
 * are disabled. It ensures safe system shutdown and monitoring.
 */

import { HVACLangGraphState } from '../lg-types/hvac-state.ts';

/**
 * Off node - Handle system shutdown state
 *
 * This node manages the system when it's turned off, ensuring proper
 * shutdown procedures and minimal monitoring for safety.
 */
export async function offNode(
  state: HVACLangGraphState,
): Promise<HVACLangGraphState> {
  const startTime = performance.now();

  try {
    // Log off state entry
    console.log(`🛑 [LangGraph] Entering off state`, {
      previousMode: state.previousMode,
      systemMode: state.systemMode,
      timestamp: new Date().toISOString(),
    });

    // Perform shutdown procedures
    const shutdownResult = await performShutdownProcedures(state);

    const executionTime = performance.now() - startTime;

    // Update state with shutdown results
    return {
      ...state,
      currentMode: 'off',
      lastShutdownTimestamp: new Date(),
      shutdownResult: shutdownResult,
      performanceMetrics: updateNodeMetrics(state, 'off', executionTime),
      evaluationHistory: [
        ...state.evaluationHistory.slice(-19),
        {
          timestamp: new Date(),
          decision: 'system_off',
          reasoning: generateOffReasoning(state),
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
    console.error('Off node error:', error);

    return {
      ...state,
      currentMode: 'off', // Stay in off state on error
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: 'off',
        recoveryAction: 'maintain_shutdown',
      },
    };
  }
}

/**
 * Perform safe shutdown procedures
 */
async function performShutdownProcedures(state: HVACLangGraphState): Promise<{
  shutdownActions: string[];
  hvacEntitiesOff: boolean;
  monitoringActive: boolean;
  emergencyContactsNotified: boolean;
}> {
  const shutdownActions: string[] = [];

  // 1. Ensure all HVAC entities are turned off
  const hvacShutdownSuccess = await shutdownHVACEntities(state);
  if (hvacShutdownSuccess) {
    shutdownActions.push('hvac_entities_shutdown');
  }

  // 2. Disable active heating/cooling operations
  const operationsDisabled = await disableActiveOperations(state);
  if (operationsDisabled) {
    shutdownActions.push('active_operations_disabled');
  }

  // 3. Set up minimal monitoring
  const monitoringSetup = await setupMinimalMonitoring(state);
  shutdownActions.push('minimal_monitoring_enabled');

  // 4. Check for emergency conditions that require notification
  const emergencyCheck = await checkEmergencyConditions(state);
  let emergencyNotified = false;
  if (
    emergencyCheck.hasEmergency && emergencyCheck.emergencyType &&
    emergencyCheck.message
  ) {
    emergencyNotified = await notifyEmergencyContacts({
      emergencyType: emergencyCheck.emergencyType,
      severity: emergencyCheck.severity,
      message: emergencyCheck.message,
    });
    if (emergencyNotified) {
      shutdownActions.push('emergency_contacts_notified');
    }
  }

  // 5. Clear any active manual overrides
  if (state.manualOverride?.active) {
    shutdownActions.push('manual_override_cleared');
  }

  return {
    shutdownActions,
    hvacEntitiesOff: hvacShutdownSuccess,
    monitoringActive: monitoringSetup,
    emergencyContactsNotified: emergencyNotified,
  };
}

/**
 * Shutdown all HVAC entities
 */
async function shutdownHVACEntities(
  state: HVACLangGraphState,
): Promise<boolean> {
  try {
    // In real implementation:
    // const controller = getHVACController();
    // const result = await controller.executeHVACMode(HVACMode.OFF);

    console.log('🛑 Shutting down all HVAC entities');

    // Simulate shutdown of all 5 HVAC entities
    const shutdownResults = await Promise.all([
      shutdownEntity('climate.living_room_ac'),
      shutdownEntity('climate.bedroom_ac'),
      shutdownEntity('climate.matej_ac'),
      shutdownEntity('climate.anicka_ac'),
      shutdownEntity('climate.radek_ac'),
    ]);

    const allShutdown = shutdownResults.every((result) => result.success);

    if (allShutdown) {
      console.log('✅ All HVAC entities successfully shut down');
    } else {
      console.warn('⚠️ Some HVAC entities failed to shut down');
    }

    return allShutdown;
  } catch (error) {
    console.error('❌ Error shutting down HVAC entities:', error);
    return false;
  }
}

/**
 * Shutdown individual HVAC entity
 */
async function shutdownEntity(
  entityId: string,
): Promise<{ success: boolean; entityId: string }> {
  // Simulate entity shutdown
  console.log(`🛑 Shutting down ${entityId}`);

  // In real implementation, this would call Home Assistant service
  // await homeAssistantClient.callService("climate", "set_hvac_mode", {
  //   entity_id: entityId,
  //   hvac_mode: "off"
  // });

  return { success: true, entityId };
}

/**
 * Disable any active heating/cooling operations
 */
async function disableActiveOperations(
  state: HVACLangGraphState,
): Promise<boolean> {
  const previousMode = state.previousMode;

  if (previousMode === 'heating' || previousMode === 'cooling') {
    console.log(`🛑 Disabling active ${previousMode} operations`);

    // In real implementation, ensure all operations are stopped
    // This might include stopping fans, closing dampers, etc.

    return true;
  }

  return true; // No active operations to disable
}

/**
 * Setup minimal monitoring for safety during shutdown
 */
async function setupMinimalMonitoring(
  state: HVACLangGraphState,
): Promise<boolean> {
  console.log('👁️ Setting up minimal safety monitoring');

  // Continue monitoring critical parameters even when off:
  // - Extreme temperatures (fire/freeze protection)
  // - System health status
  // - Emergency override capabilities

  return true;
}

/**
 * Check for emergency conditions during shutdown
 */
async function checkEmergencyConditions(state: HVACLangGraphState): Promise<{
  hasEmergency: boolean;
  emergencyType?: string;
  severity: 'low' | 'medium' | 'high';
  message?: string;
}> {
  const { indoorTemp, outdoorTemp } = state;

  // Check for extreme temperature conditions
  if (indoorTemp !== undefined) {
    // Fire risk
    if (indoorTemp > 40) {
      return {
        hasEmergency: true,
        emergencyType: 'extreme_heat',
        severity: 'high',
        message: `Dangerous indoor temperature: ${indoorTemp}°C`,
      };
    }

    // Freeze risk
    if (indoorTemp < 5) {
      return {
        hasEmergency: true,
        emergencyType: 'freeze_risk',
        severity: 'high',
        message: `Freeze risk: indoor temperature ${indoorTemp}°C`,
      };
    }
  }

  // Check for equipment malfunction indicators
  const recentErrors = state.evaluationHistory
    .slice(-5)
    .filter((evaluation) => evaluation.reasoning.includes('error'));

  if (recentErrors.length >= 3) {
    return {
      hasEmergency: true,
      emergencyType: 'equipment_malfunction',
      severity: 'medium',
      message: 'Multiple system errors detected before shutdown',
    };
  }

  return {
    hasEmergency: false,
    severity: 'low',
  };
}

/**
 * Notify emergency contacts if required
 */
async function notifyEmergencyContacts(emergency: {
  emergencyType: string;
  severity: string;
  message: string;
}): Promise<boolean> {
  console.log(`🚨 Emergency condition detected: ${emergency.emergencyType}`);
  console.log(`Severity: ${emergency.severity}`);
  console.log(`Message: ${emergency.message}`);

  // In real implementation, this would:
  // - Send notifications via email/SMS
  // - Log to monitoring systems
  // - Potentially contact building management
  // - Create service tickets

  return true; // Simulate successful notification
}

/**
 * Generate human-readable reasoning for off state
 */
function generateOffReasoning(state: HVACLangGraphState): string {
  if (state.manualOverride?.active && state.manualOverride.mode === 'off') {
    return 'Manual override: system turned off by user';
  }

  if (state.systemMode === 'off') {
    return 'System mode set to OFF in configuration';
  }

  return 'System shutdown initiated';
}

/**
 * Update performance metrics for off node
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
