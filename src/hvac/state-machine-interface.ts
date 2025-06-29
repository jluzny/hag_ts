/**
 * HVAC State Machine Interface
 * 
 * This interface provides a common abstraction for both XState and LangGraph
 * implementations, allowing the controller to work with either backend.
 */

import { HVACMode, SystemMode } from '../types/common.ts';

/**
 * Common interface for HVAC state machines
 */
export interface IHVACStateMachine {
  /**
   * Start the state machine
   */
  start(): Promise<void>;
  
  /**
   * Stop the state machine
   */
  stop(): Promise<void>;
  
  /**
   * Get current state name
   */
  getCurrentState(): string;
  
  /**
   * Get current context/state data
   */
  getContext(): Record<string, unknown>;
  
  /**
   * Get detailed status information
   */
  getStatus(): {
    currentState: string;
    context: Record<string, unknown>;
    canHeat: boolean;
    canCool: boolean;
    systemMode: SystemMode;
    [key: string]: unknown; // Allow for implementation-specific properties
  };
  
  /**
   * Handle temperature sensor changes
   */
  handleTemperatureChange(sensor: string, value: number): Promise<void>;
  
  /**
   * Execute manual override
   */
  manualOverride(mode: HVACMode, temperature?: number): Promise<void>;
  
  /**
   * Clear manual override
   */
  clearManualOverride?(): Promise<void>;
  
  /**
   * Update system mode
   */
  updateSystemMode?(systemMode: SystemMode): Promise<void>;
}

/**
 * Enhanced interface for LangGraph implementations
 * Includes additional capabilities not available in XState
 */
export interface IEnhancedHVACStateMachine extends IHVACStateMachine {
  /**
   * Get evaluation history (LangGraph specific)
   */
  getEvaluationHistory(): Array<{
    timestamp: Date;
    decision: string;
    reasoning: string;
    conditions: Record<string, unknown>;
    executionTimeMs: number;
  }>;
  
  /**
   * Get performance metrics (LangGraph specific)
   */
  getPerformanceMetrics(): {
    nodeExecutionTimes: Record<string, number[]>;
    totalTransitions: number;
    lastEvaluationDuration: number;
    avgDecisionTime: number;
  };
  
  /**
   * Get AI recommendations if available
   */
  getAIRecommendations?(): Array<{
    action: string;
    confidence: number;
    reasoning: string;
    timestamp: Date;
  }>;
}