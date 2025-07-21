/**
 * Type definitions for AI-enhanced HVAC system
 */

import { SystemMode } from "../../types/common.ts";

/**
 * Context information for AI decision making
 */
export interface HVACDecisionContext {
  // Current temperature readings
  indoorTemp?: number;
  outdoorTemp?: number;
  targetTemp?: number;

  // System state
  systemMode: SystemMode;
  currentMode: string;

  // Temporal context
  currentHour?: number;
  isWeekday?: boolean;

  // Manual overrides
  manualOverride?: {
    active: boolean;
    mode?: string;
    temperature?: number;
    expiresAt?: Date;
  };

  // Historical context
  lastTransitionTime?: Date;
  recentTransitions?: number;

  // Energy and optimization context
  energyPrice?: {
    level: "low" | "medium" | "high";
    rate: number; // per kWh
  };

  // Weather forecast (for future enhancements)
  weatherForecast?: {
    nextHourTemp?: number;
    next4HourTrend?: "rising" | "falling" | "stable";
  };

  // User preferences (for future enhancements)
  userPreferences?: {
    comfortRange: { min: number; max: number };
    energySavingMode: boolean;
    occupancySchedule?: string[];
  };
}

/**
 * Result of an AI decision
 */
export interface DecisionResult {
  // Primary decision
  action: "heating" | "cooling" | "idle" | "off";

  // Confidence and reasoning
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  factors: string[];

  // Impact assessment
  energyImpact: "low" | "medium" | "high";
  comfortImpact: "low" | "medium" | "high";

  // Metadata
  source: "ai" | "fallback" | "rule_based";
  executionTimeMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

/**
 * AI-enhanced state for HVAC system
 */
export interface AIEnhancedState {
  // AI-specific context
  aiContext?: {
    // Decision history
    decisionHistory: DecisionResult[];

    // Prediction data
    predictions?: {
      nextHourTemp?: number;
      energyUsageForecast?: number;
      optimalSchedule?: ScheduleItem[];
    };

    // Learning data
    learningData?: {
      userPatterns: UserPattern[];
      environmentalPatterns: EnvironmentalPattern[];
      preferenceWeights: PreferenceWeights;
    };

    // Optimization goals
    optimizationGoals?: {
      energyEfficiency: number; // 0.0 to 1.0
      comfortPriority: number; // 0.0 to 1.0
      costOptimization: number; // 0.0 to 1.0
    };
  };

  // Enhanced historical data
  historicalData?: {
    temperatureHistory: TemperatureReading[];
    energyUsageHistory: EnergyUsageData[];
    userInteractions: UserInteraction[];
    weatherHistory: WeatherData[];
  };

  // AI performance metrics
  aiMetrics?: {
    totalAIDecisions: number;
    aiSuccessRate: number;
    avgDecisionTime: number;
    fallbackRate: number;
    energySavings?: number;
    comfortScore?: number;
  };
}

/**
 * Schedule item for optimization
 */
export interface ScheduleItem {
  startTime: Date;
  endTime: Date;
  targetTemp: number;
  priority: "low" | "medium" | "high";
  energyBudget?: number;
}

/**
 * User behavior pattern
 */
export interface UserPattern {
  timeOfDay: number; // Hour of day
  dayOfWeek: number; // 0-6
  action: "manual_override" | "schedule_change" | "mode_change";
  context: Record<string, unknown>;
  frequency: number; // How often this pattern occurs
  confidence: number; // 0.0 to 1.0
}

/**
 * Environmental pattern recognition
 */
export interface EnvironmentalPattern {
  pattern: string;
  conditions: Record<string, unknown>;
  outcomes: Record<string, unknown>;
  accuracy: number; // Historical accuracy of this pattern
  lastUpdated: Date;
}

/**
 * User preference weights for optimization
 */
export interface PreferenceWeights {
  comfort: number; // 0.0 to 1.0
  energyEfficiency: number; // 0.0 to 1.0
  cost: number; // 0.0 to 1.0
  convenience: number; // 0.0 to 1.0
  lastUpdated: Date;
}

/**
 * Temperature reading with metadata
 */
export interface TemperatureReading {
  timestamp: Date;
  indoorTemp: number;
  outdoorTemp?: number;
  humidity?: number;
  source: string; // sensor identifier
}

/**
 * Energy usage data point
 */
export interface EnergyUsageData {
  timestamp: Date;
  usage: number; // kWh
  cost?: number; // currency units
  hvacMode: string;
  efficiency?: number;
}

/**
 * User interaction record
 */
export interface UserInteraction {
  timestamp: Date;
  type:
    | "manual_override"
    | "schedule_change"
    | "mode_change"
    | "preference_update";
  details: Record<string, unknown>;
  context: {
    indoorTemp?: number;
    outdoorTemp?: number;
    currentMode: string;
    timeOfDay: number;
  };
}

/**
 * Weather data point
 */
export interface WeatherData {
  timestamp: Date;
  temperature: number;
  humidity?: number;
  windSpeed?: number;
  conditions?: string;
  forecast?: {
    next1h?: number;
    next4h?: number;
    next24h?: number;
  };
}

/**
 * AI agent interface
 */
export interface AIAgent {
  name: string;
  description: string;

  /**
   * Process input and generate output
   */
  process(input: unknown): Promise<unknown>;

  /**
   * Check agent health and availability
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get agent configuration
   */
  getConfig(): Record<string, unknown>;
}

/**
 * Multi-agent coordination result
 */
export interface AgentCoordinationResult {
  primaryDecision: DecisionResult;
  agentInputs: Record<string, unknown>;
  consensusScore: number; // 0.0 to 1.0
  conflictResolution?: string;
  executionPlan: {
    immediate: string[];
    shortTerm: string[]; // next hour
    mediumTerm: string[]; // next 4 hours
  };
}

/**
 * AI learning feedback
 */
export interface LearningFeedback {
  decisionId: string;
  actualOutcome: {
    energyUsed?: number;
    comfortAchieved?: number;
    userSatisfaction?: number;
  };
  timestamp: Date;
  context: HVACDecisionContext;
}

/**
 * Energy optimization result
 */
export interface EnergyOptimizationResult {
  recommendedSchedule: ScheduleItem[];
  projectedSavings: {
    energy: number; // kWh
    cost: number; // currency units
    percentage: number; // % improvement
  };
  tradeoffs: {
    comfortImpact: "minimal" | "moderate" | "significant";
    convenienceImpact: "minimal" | "moderate" | "significant";
  };
  confidence: number; // 0.0 to 1.0
}
