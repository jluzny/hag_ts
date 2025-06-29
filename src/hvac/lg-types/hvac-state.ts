/**
 * LangGraph State Type Definitions for HVAC System
 * 
 * Defines the state structure for LangGraph-based HVAC state machine
 */

import { SystemMode } from '../../types/common.ts';

/**
 * Evaluation decision history entry
 */
export interface EvaluationHistoryEntry {
  timestamp: Date;
  decision: string;
  reasoning: string;
  conditions: {
    indoorTemp?: number;
    outdoorTemp?: number;
    systemMode: SystemMode;
    currentHour: number;
    isWeekday: boolean;
  };
  executionTimeMs: number;
}

/**
 * AI recommendation entry (for future AI enhancement)
 */
export interface AIRecommendation {
  action: "idle" | "heating" | "cooling" | "off";
  confidence: number;
  reasoning: string;
  timestamp: Date;
  energyTips?: string[];
  targetTemperature?: number;
}

/**
 * Performance metrics for monitoring
 */
export interface PerformanceMetrics {
  nodeExecutionTimes: Record<string, number[]>;
  totalTransitions: number;
  lastEvaluationDuration: number;
  avgDecisionTime: number;
}

/**
 * Main LangGraph state for HVAC system
 * 
 * This replaces the XState context with a more comprehensive state object
 * that supports LangGraph's message-passing architecture
 */
export interface HVACLangGraphState {
  // Core state (equivalent to XState current state)
  currentMode: "idle" | "evaluating" | "heating" | "cooling" | "off";
  
  // Previous mode for change detection
  previousMode?: string;
  
  // Context data (equivalent to XState context)
  indoorTemp?: number;
  outdoorTemp?: number;
  systemMode: SystemMode;
  currentHour: number;
  isWeekday: boolean;
  lastDefrost?: Date;
  
  // Enhanced tracking for LangGraph
  evaluationHistory: EvaluationHistoryEntry[];
  
  // AI enhancement capabilities (Phase 4)
  aiEnabled?: boolean;
  aiRecommendations?: AIRecommendation[];
  
  // Decision methodology tracking
  decisionMethod?: "rule_based" | "ai_assisted" | "hybrid";
  
  // Performance monitoring
  performanceMetrics?: PerformanceMetrics;
  
  // State machine metadata
  graphStartTime: Date;
  totalTransitions: number;
  
  // Action timestamps for state machine transition tracking
  lastActionTimestamp?: Date;
  lastIdleTimestamp?: Date;
  lastShutdownTimestamp?: Date;
  
  // Error handling
  lastError?: {
    timestamp: Date;
    error: string;
    node: string;
    recoveryAction?: string;
  };
  
  // Manual override tracking
  manualOverride?: {
    active: boolean;
    mode?: string;
    temperature?: number;
    setBy?: string;
    timestamp?: Date;
    expiresAt?: Date;
  };
  
  // Shutdown result tracking (for off node)
  shutdownResult?: {
    shutdownActions: string[];
    hvacEntitiesOff: boolean;
    monitoringActive: boolean;
    emergencyContactsNotified: boolean;
  };
  
  // Action results tracking (for specific nodes)
  lastActionResult?: {
    action: string;
    success: boolean;
    timestamp: Date;
    details?: Record<string, unknown>;
  };
  
  idleMaintenanceResult?: {
    maintenancePerformed: string[];
    nextMaintenanceIn: string;
    systemHealthStatus: "good" | "warning" | "error";
    energyUsageOptimal: boolean;
  };
}

/**
 * Input event types for LangGraph nodes
 */
export interface HVACInputEvent {
  type: "TEMPERATURE_UPDATE" | "MANUAL_OVERRIDE" | "SYSTEM_MODE_CHANGE" | "TIME_TICK" | "EVALUATE";
  payload?: {
    sensor?: string;
    value?: number;
    mode?: string;
    temperature?: number;
    systemMode?: SystemMode;
  };
  timestamp: Date;
}

/**
 * Node execution result
 */
export interface NodeExecutionResult {
  state: HVACLangGraphState;
  nextNode?: string;
  shouldContinue: boolean;
  metadata?: {
    executionTime: number;
    decision: string;
    reasoning: string;
  };
}

/**
 * Default state factory
 */
export function createDefaultHVACState(overrides: Partial<HVACLangGraphState> = {}): HVACLangGraphState {
  const now = new Date();
  
  return {
    currentMode: "idle",
    systemMode: SystemMode.AUTO,
    currentHour: now.getHours(),
    isWeekday: now.getDay() >= 1 && now.getDay() <= 5,
    evaluationHistory: [],
    graphStartTime: now,
    totalTransitions: 0,
    aiEnabled: false,
    decisionMethod: "rule_based",
    ...overrides
  };
}