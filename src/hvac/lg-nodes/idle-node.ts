/**
 * LangGraph Idle Node for HVAC System
 * 
 * This node handles the idle state where no active heating or cooling
 * is required. It monitors conditions and prepares for the next evaluation.
 */

import { HVACLangGraphState } from '../lg-types/hvac-state.ts';

/**
 * Idle node - Handle idle state monitoring
 * 
 * This node manages the system when no active HVAC operation is needed,
 * ensuring efficient monitoring and preparation for next actions.
 */
export async function idleNode(state: HVACLangGraphState): Promise<HVACLangGraphState> {
  const startTime = performance.now();
  
  try {
    // Log idle state entry
    console.log(`⏸️ [LangGraph] Entering idle state`, {
      indoorTemp: state.indoorTemp,
      outdoorTemp: state.outdoorTemp,
      systemMode: state.systemMode,
      timestamp: new Date().toISOString()
    });
    
    // Perform idle state maintenance
    const idleResult = await performIdleMaintenance(state);
    
    const executionTime = performance.now() - startTime;
    
    // Update state with idle maintenance results
    return {
      ...state,
      currentMode: "idle",
      lastIdleTimestamp: new Date(),
      idleMaintenanceResult: {
        maintenancePerformed: idleResult.maintenancePerformed,
        nextMaintenanceIn: `${idleResult.nextEvaluationIn} minutes`,
        systemHealthStatus: idleResult.systemHealth,
        energyUsageOptimal: idleResult.systemHealth === "good"
      },
      performanceMetrics: updateNodeMetrics(state, 'idle', executionTime),
      evaluationHistory: [
        ...state.evaluationHistory.slice(-19),
        {
          timestamp: new Date(),
          decision: "idle_maintained",
          reasoning: generateIdleReasoning(state),
          conditions: {
            indoorTemp: state.indoorTemp,
            outdoorTemp: state.outdoorTemp,
            systemMode: state.systemMode,
            currentHour: state.currentHour,
            isWeekday: state.isWeekday
          },
          executionTimeMs: executionTime
        }
      ]
    };
    
  } catch (error) {
    console.error('Idle node error:', error);
    
    return {
      ...state,
      currentMode: "idle", // Stay in idle on error
      lastError: {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        node: "idle",
        recoveryAction: "continue_idle"
      }
    };
  }
}

/**
 * Perform maintenance tasks during idle state
 */
async function performIdleMaintenance(state: HVACLangGraphState): Promise<{
  maintenancePerformed: string[];
  nextEvaluationIn: number;
  systemHealth: "good" | "warning" | "error";
}> {
  const maintenanceTasks: string[] = [];
  
  // 1. Check for stale temperature readings
  if (await checkTemperatureReadingAge(state)) {
    maintenanceTasks.push("temperature_reading_check");
  }
  
  // 2. Validate system configuration
  if (await validateSystemConfiguration(state)) {
    maintenanceTasks.push("configuration_validation");
  }
  
  // 3. Monitor manual override expiration
  if (await checkManualOverrideExpiration(state)) {
    maintenanceTasks.push("manual_override_check");
  }
  
  // 4. Performance metrics cleanup
  if (await cleanupPerformanceMetrics(state)) {
    maintenanceTasks.push("metrics_cleanup");
  }
  
  // 5. Determine next evaluation timing
  const nextEvaluationDelay = calculateNextEvaluationDelay(state);
  
  // 6. Assess overall system health
  const systemHealth = assessSystemHealth(state);
  
  return {
    maintenancePerformed: maintenanceTasks,
    nextEvaluationIn: nextEvaluationDelay,
    systemHealth
  };
}

/**
 * Check if temperature readings are stale
 */
async function checkTemperatureReadingAge(state: HVACLangGraphState): Promise<boolean> {
  // In real implementation, this would check timestamp of last sensor readings
  // For now, simulate the check
  return true; // Always perform this maintenance task
}

/**
 * Validate system configuration consistency
 */
async function validateSystemConfiguration(state: HVACLangGraphState): Promise<boolean> {
  // Check system mode validity
  if (!["auto", "heat_only", "cool_only", "off"].includes(state.systemMode)) {
    console.warn(`Invalid system mode: ${state.systemMode}`);
    return false;
  }
  
  // Validate temperature bounds
  if (state.indoorTemp !== undefined && (state.indoorTemp < -50 || state.indoorTemp > 60)) {
    console.warn(`Indoor temperature out of bounds: ${state.indoorTemp}°C`);
    return false;
  }
  
  return true;
}

/**
 * Check if manual override has expired
 */
async function checkManualOverrideExpiration(state: HVACLangGraphState): Promise<boolean> {
  if (!state.manualOverride?.active) {
    return false;
  }
  
  const now = new Date();
  if (state.manualOverride.expiresAt && now > state.manualOverride.expiresAt) {
    console.log('Manual override expired, will be cleared on next evaluation');
    return true;
  }
  
  return false;
}

/**
 * Cleanup old performance metrics to prevent memory bloat
 */
async function cleanupPerformanceMetrics(state: HVACLangGraphState): Promise<boolean> {
  const metrics = state.performanceMetrics;
  if (!metrics) return false;
  
  // Check if any node has too many stored measurements
  for (const [node, times] of Object.entries(metrics.nodeExecutionTimes)) {
    if (times.length > 100) {
      console.log(`Cleaning up performance metrics for node: ${node}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate optimal delay until next evaluation
 */
function calculateNextEvaluationDelay(state: HVACLangGraphState): number {
  // Base evaluation interval: 30 seconds
  let delayMs = 30000;
  
  // Adjust based on recent activity
  const recentEvaluations = state.evaluationHistory.slice(-5);
  const hasRecentChanges = recentEvaluations.some(
    evaluation => evaluation.decision !== "idle_maintained"
  );
  
  if (hasRecentChanges) {
    // More frequent evaluations if system is active
    delayMs = 15000;
  }
  
  // Adjust based on temperature stability
  if (state.indoorTemp !== undefined && state.outdoorTemp !== undefined) {
    const tempDiff = Math.abs(state.indoorTemp - (state.outdoorTemp || 20));
    if (tempDiff > 10) {
      // More frequent evaluations when temperatures are very different
      delayMs = Math.min(delayMs, 20000);
    }
  }
  
  // Night time: less frequent evaluations
  if (state.currentHour >= 22 || state.currentHour <= 6) {
    delayMs = Math.max(delayMs, 60000); // At least 1 minute at night
  }
  
  return delayMs;
}

/**
 * Assess overall system health
 */
function assessSystemHealth(state: HVACLangGraphState): "good" | "warning" | "error" {
  // Check for recent errors
  if (state.lastError && (new Date().getTime() - state.lastError.timestamp.getTime()) < 300000) {
    return "error"; // Error in last 5 minutes
  }
  
  // Check for missing temperature readings
  if (state.indoorTemp === undefined || state.outdoorTemp === undefined) {
    return "warning";
  }
  
  // Check for performance issues
  const avgDecisionTime = state.performanceMetrics?.avgDecisionTime;
  if (avgDecisionTime && avgDecisionTime > 1000) { // Over 1 second
    return "warning";
  }
  
  // Check evaluation history for anomalies
  const recentHistory = state.evaluationHistory.slice(-10);
  const errorCount = recentHistory.filter(evaluation => 
    evaluation.decision.includes("error") || evaluation.reasoning.includes("error")
  ).length;
  
  if (errorCount > 2) {
    return "warning";
  }
  
  return "good";
}

/**
 * Generate human-readable reasoning for idle state
 */
function generateIdleReasoning(state: HVACLangGraphState): string {
  const { indoorTemp, outdoorTemp, systemMode } = state;
  
  if (systemMode === "off") {
    return "System is turned off";
  }
  
  if (indoorTemp === undefined || outdoorTemp === undefined) {
    return "Waiting for temperature readings";
  }
  
  return `Temperature stable at ${indoorTemp}°C (outdoor: ${outdoorTemp}°C) - no action needed`;
}

/**
 * Update performance metrics for idle node
 */
function updateNodeMetrics(
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
  
  if (!current.nodeExecutionTimes[operation]) {
    current.nodeExecutionTimes[operation] = [];
  }
  
  current.nodeExecutionTimes[operation].push(executionTime);
  
  // Keep only last 50 measurements
  if (current.nodeExecutionTimes[operation].length > 50) {
    current.nodeExecutionTimes[operation] = current.nodeExecutionTimes[operation].slice(-50);
  }
  
  return {
    ...current,
    totalTransitions: current.totalTransitions + 1
  };
}