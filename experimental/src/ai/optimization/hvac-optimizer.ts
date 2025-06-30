/**
 * Intelligent HVAC Optimization Engine
 *
 * This module implements advanced optimization algorithms for HVAC systems,
 * focusing on energy efficiency, comfort optimization, and cost minimization.
 */

import {
  EnergyOptimizationResult,
  HVACDecisionContext,
  ScheduleItem,
} from '../../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../../src/types/common.ts';
import type { LoggerService } from '../../../../src/core/logger.ts';

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  // Objective weights (must sum to 1.0)
  comfortWeight: number; // 0.0 to 1.0
  energyWeight: number; // 0.0 to 1.0
  costWeight: number; // 0.0 to 1.0

  // Energy pricing
  energyRates: {
    peak: number; // $/kWh during peak hours
    offPeak: number; // $/kWh during off-peak hours
    peakHours: number[]; // Array of peak hours (0-23)
  };

  // Comfort constraints
  comfortRange: {
    min: number; // Minimum acceptable temperature
    max: number; // Maximum acceptable temperature
    preferred: number; // Preferred temperature
    tolerance: number; // Acceptable deviation from preferred
  };

  // System constraints
  systemConstraints: {
    minRunTime: number; // Minimum runtime in minutes
    maxCyclesPerHour: number; // Maximum on/off cycles per hour
    defrostInterval: number; // Hours between defrost cycles
  };

  // Optimization horizon
  optimizationHorizon: number; // Hours to optimize ahead
  updateInterval: number; // Minutes between optimization updates
}

/**
 * Optimization result for a single decision point
 */
export interface OptimizationDecision {
  action: 'heating' | 'cooling' | 'idle' | 'off';
  targetTemp?: number;
  duration: number; // Minutes

  // Scoring
  comfortScore: number; // 0.0 to 1.0
  energyScore: number; // 0.0 to 1.0 (higher = more efficient)
  costScore: number; // 0.0 to 1.0 (higher = lower cost)
  overallScore: number; // Weighted combination

  // Predictions
  predictedEnergyUse: number; // kWh
  predictedCost: number; // $
  predictedComfort: number; // 0.0 to 1.0

  // Reasoning
  reasoning: string;
  factors: string[];
}

/**
 * Intelligent HVAC Optimizer
 */
export class HVACOptimizer {
  private config: OptimizationConfig;
  private logger: LoggerService;

  constructor(config: OptimizationConfig, logger: LoggerService) {
    this.config = this.validateConfig(config);
    this.logger = logger;

    this.logger.info('🎯 [HVAC Optimizer] Initialized', {
      comfortWeight: this.config.comfortWeight,
      energyWeight: this.config.energyWeight,
      costWeight: this.config.costWeight,
      optimizationHorizon: this.config.optimizationHorizon,
    });
  }

  /**
   * Optimize HVAC operation for the next period
   */
  async optimizeDecision(
    context: HVACDecisionContext,
  ): Promise<OptimizationDecision> {
    const startTime = performance.now();

    this.logger.debug('🎯 [HVAC Optimizer] Starting optimization', {
      indoorTemp: context.indoorTemp,
      outdoorTemp: context.outdoorTemp,
      systemMode: context.systemMode,
      currentHour: context.currentHour,
    });

    try {
      // Generate possible actions
      const possibleActions = this.generatePossibleActions(context);

      // Evaluate each action
      const evaluatedActions = await Promise.all(
        possibleActions.map((action) => this.evaluateAction(action, context)),
      );

      // Select optimal action
      const optimalAction = this.selectOptimalAction(evaluatedActions);

      const executionTime = performance.now() - startTime;

      this.logger.info('✅ [HVAC Optimizer] Optimization completed', {
        selectedAction: optimalAction.action,
        overallScore: optimalAction.overallScore.toFixed(3),
        comfortScore: optimalAction.comfortScore.toFixed(3),
        energyScore: optimalAction.energyScore.toFixed(3),
        costScore: optimalAction.costScore.toFixed(3),
        executionTimeMs: executionTime,
      });

      return optimalAction;
    } catch (error) {
      this.logger.error('❌ [HVAC Optimizer] Optimization failed', error);

      // Fallback to simple decision
      return this.fallbackDecision(context);
    }
  }

  /**
   * Generate schedule optimization for the next period
   */
  async optimizeSchedule(
    context: HVACDecisionContext,
    horizonHours: number = 24,
  ): Promise<EnergyOptimizationResult> {
    this.logger.info('📅 [HVAC Optimizer] Generating optimized schedule', {
      horizonHours,
      currentTemp: context.indoorTemp,
      systemMode: context.systemMode,
    });

    try {
      const schedule: ScheduleItem[] = [];
      const currentTime = new Date();

      // Generate hourly schedule items
      for (let hour = 0; hour < horizonHours; hour++) {
        const timeSlot = new Date(
          currentTime.getTime() + hour * 60 * 60 * 1000,
        );
        const hourOfDay = timeSlot.getHours();

        // Determine optimal temperature and action for this hour
        const timeContext = {
          ...context,
          currentHour: hourOfDay,
          energyPrice: this.getEnergyPriceForHour(hourOfDay),
        };

        const decision = await this.optimizeDecision(timeContext);

        schedule.push({
          startTime: timeSlot,
          endTime: new Date(timeSlot.getTime() + 60 * 60 * 1000),
          targetTemp: decision.targetTemp || context.targetTemp || 22,
          priority: this.isComfortCriticalHour(hourOfDay) ? 'high' : 'medium',
          energyBudget: decision.predictedEnergyUse,
        });
      }

      // Calculate projected savings
      const projectedSavings = this.calculateProjectedSavings(
        schedule,
        context,
      );

      return {
        recommendedSchedule: schedule,
        projectedSavings,
        tradeoffs: {
          comfortImpact: projectedSavings.percentage > 15
            ? 'moderate'
            : 'minimal',
          convenienceImpact: 'minimal',
        },
        confidence: 0.85,
      };
    } catch (error) {
      this.logger.error(
        '❌ [HVAC Optimizer] Schedule optimization failed',
        error,
      );
      throw error;
    }
  }

  /**
   * Generate possible actions for current context
   */
  private generatePossibleActions(context: HVACDecisionContext): string[] {
    const actions: string[] = ['idle'];

    // Add heating if allowed
    if (
      context.systemMode !== SystemMode.COOL_ONLY &&
      context.systemMode !== SystemMode.OFF
    ) {
      actions.push('heating');
    }

    // Add cooling if allowed
    if (
      context.systemMode !== SystemMode.HEAT_ONLY &&
      context.systemMode !== SystemMode.OFF
    ) {
      actions.push('cooling');
    }

    // Add off if system allows
    if (
      context.systemMode === SystemMode.OFF ||
      context.systemMode === SystemMode.AUTO
    ) {
      actions.push('off');
    }

    return actions;
  }

  /**
   * Evaluate a single action against optimization criteria
   */
  private async evaluateAction(
    action: string,
    context: HVACDecisionContext,
  ): Promise<OptimizationDecision> {
    // Predict outcomes of this action
    const predictions = this.predictOutcomes(action, context);

    // Calculate scores
    const comfortScore = this.calculateComfortScore(
      predictions.resultTemp,
      context,
    );
    const energyScore = this.calculateEnergyScore(
      predictions.energyUse,
      action,
    );
    const costScore = this.calculateCostScore(predictions.cost, context);

    // Calculate weighted overall score
    const overallScore = this.config.comfortWeight * comfortScore +
      this.config.energyWeight * energyScore +
      this.config.costWeight * costScore;

    // Generate reasoning
    const reasoning = this.generateReasoning(action, predictions, {
      comfortScore,
      energyScore,
      costScore,
    });

    return {
      action: action as any,
      targetTemp: context.targetTemp,
      duration: 60, // Default 1 hour
      comfortScore,
      energyScore,
      costScore,
      overallScore,
      predictedEnergyUse: predictions.energyUse,
      predictedCost: predictions.cost,
      predictedComfort: comfortScore,
      reasoning,
      factors: predictions.factors,
    };
  }

  /**
   * Predict outcomes of an action
   */
  private predictOutcomes(action: string, context: HVACDecisionContext) {
    const indoorTemp = context.indoorTemp || 20;
    const outdoorTemp = context.outdoorTemp || 15;
    const currentHour = context.currentHour || 12;

    let resultTemp = indoorTemp;
    let energyUse = 0; // kWh
    let factors: string[] = [];

    switch (action) {
      case 'heating':
        // Predict temperature rise based on outdoor conditions
        const heatingEfficiency = this.calculateHeatingEfficiency(outdoorTemp);
        resultTemp = Math.min(indoorTemp + 2 * heatingEfficiency, 26);
        energyUse = 2.0 * (1 / heatingEfficiency); // More energy needed when less efficient
        factors = ['heating_efficiency', 'outdoor_temperature', 'thermal_mass'];
        break;

      case 'cooling':
        // Predict temperature drop based on outdoor conditions
        const coolingEfficiency = this.calculateCoolingEfficiency(outdoorTemp);
        resultTemp = Math.max(indoorTemp - 2 * coolingEfficiency, 18);
        energyUse = 1.8 * (1 / coolingEfficiency);
        factors = ['cooling_efficiency', 'outdoor_temperature', 'solar_load'];
        break;

      case 'idle':
        // Predict natural temperature drift
        const drift = (outdoorTemp - indoorTemp) * 0.1; // 10% drift per hour
        resultTemp = indoorTemp + drift;
        energyUse = 0.1; // Minimal energy for fans, etc.
        factors = ['natural_drift', 'thermal_insulation', 'outdoor_influence'];
        break;

      case 'off':
        // Faster drift toward outdoor temperature
        const fastDrift = (outdoorTemp - indoorTemp) * 0.2; // 20% drift per hour
        resultTemp = indoorTemp + fastDrift;
        energyUse = 0;
        factors = ['system_off', 'thermal_mass', 'building_envelope'];
        break;
    }

    // Calculate cost based on time of day
    const currentRate = this.getEnergyPriceForHour(currentHour);
    const cost = energyUse * currentRate.rate;

    return {
      resultTemp,
      energyUse,
      cost,
      factors,
    };
  }

  /**
   * Calculate heating efficiency based on outdoor temperature
   */
  private calculateHeatingEfficiency(outdoorTemp: number): number {
    // Heat pump efficiency decreases as outdoor temperature drops
    if (outdoorTemp < -10) return 0.4; // Very low efficiency
    if (outdoorTemp < 0) return 0.6; // Low efficiency
    if (outdoorTemp < 10) return 0.8; // Good efficiency
    return 1.0; // Excellent efficiency
  }

  /**
   * Calculate cooling efficiency based on outdoor temperature
   */
  private calculateCoolingEfficiency(outdoorTemp: number): number {
    // Cooling efficiency decreases as outdoor temperature rises
    if (outdoorTemp > 35) return 0.5; // Low efficiency
    if (outdoorTemp > 25) return 0.7; // Good efficiency
    if (outdoorTemp > 15) return 0.9; // Very good efficiency
    return 1.0; // Excellent efficiency
  }

  /**
   * Calculate comfort score
   */
  private calculateComfortScore(
    predictedTemp: number,
    context: HVACDecisionContext,
  ): number {
    const target = context.targetTemp || this.config.comfortRange.preferred;
    const tolerance = this.config.comfortRange.tolerance;

    const deviation = Math.abs(predictedTemp - target);

    if (deviation <= tolerance) {
      return 1.0; // Perfect comfort
    } else if (deviation <= tolerance * 2) {
      return 0.8 - (deviation - tolerance) / tolerance * 0.6; // Gradual decline
    } else {
      return Math.max(0.2, 1.0 - deviation / 10); // Minimum comfort score
    }
  }

  /**
   * Calculate energy efficiency score
   */
  private calculateEnergyScore(energyUse: number, action: string): number {
    // Normalize energy use (lower usage = higher score)
    const maxEnergyUse = 5.0; // kWh (worst case)
    const normalizedUse = Math.min(energyUse / maxEnergyUse, 1.0);

    let baseScore = 1.0 - normalizedUse;

    // Bonus for idle operation
    if (action === 'idle') {
      baseScore = Math.min(baseScore + 0.2, 1.0);
    }

    return Math.max(0.1, baseScore); // Minimum score
  }

  /**
   * Calculate cost efficiency score
   */
  private calculateCostScore(
    cost: number,
    context: HVACDecisionContext,
  ): number {
    const maxCost = 2.0; // $ (worst case scenario)
    const normalizedCost = Math.min(cost / maxCost, 1.0);

    return Math.max(0.1, 1.0 - normalizedCost);
  }

  /**
   * Select optimal action from evaluated options
   */
  private selectOptimalAction(
    actions: OptimizationDecision[],
  ): OptimizationDecision {
    return actions.reduce((best, current) =>
      current.overallScore > best.overallScore ? current : best
    );
  }

  /**
   * Generate human-readable reasoning for decision
   */
  private generateReasoning(
    action: string,
    predictions: any,
    scores: any,
  ): string {
    let reasoning = `Optimization selected "${action}" action. `;

    reasoning += `Predicted temperature: ${
      predictions.resultTemp.toFixed(1)
    }°C. `;
    reasoning += `Energy use: ${predictions.energyUse.toFixed(2)} kWh. `;
    reasoning += `Cost: $${predictions.cost.toFixed(3)}. `;

    reasoning += `Scores - Comfort: ${
      (scores.comfortScore * 100).toFixed(0)
    }%, `;
    reasoning += `Energy: ${(scores.energyScore * 100).toFixed(0)}%, `;
    reasoning += `Cost: ${(scores.costScore * 100).toFixed(0)}%.`;

    return reasoning;
  }

  /**
   * Get energy price for specific hour
   */
  private getEnergyPriceForHour(hour: number): { level: 'low' | 'medium' | 'high'; rate: number } {
    const isPeakHour = this.config.energyRates.peakHours.includes(hour);

    return {
      level: isPeakHour ? 'high' : 'low',
      rate: isPeakHour
        ? this.config.energyRates.peak
        : this.config.energyRates.offPeak,
    };
  }

  /**
   * Check if hour is comfort-critical (typically waking/sleeping hours)
   */
  private isComfortCriticalHour(hour: number): boolean {
    // Morning wake-up and evening hours are comfort-critical
    return (hour >= 6 && hour <= 9) || (hour >= 18 && hour <= 22);
  }

  /**
   * Calculate projected savings from optimized schedule
   */
  private calculateProjectedSavings(
    schedule: ScheduleItem[],
    context: HVACDecisionContext,
  ): EnergyOptimizationResult['projectedSavings'] {
    // Estimate baseline energy use (no optimization)
    const baselineEnergyPerHour = 2.0; // kWh
    const baselineEnergy = schedule.length * baselineEnergyPerHour;
    const baselineCost = baselineEnergy * this.config.energyRates.peak; // Worst case pricing

    // Calculate optimized energy use
    const optimizedEnergy = schedule.reduce(
      (total, item) => total + (item.energyBudget || 1.5),
      0,
    );
    const optimizedCost = schedule.reduce((total, item, index) => {
      const hour = item.startTime.getHours();
      const rate = this.getEnergyPriceForHour(hour).rate;
      return total + (item.energyBudget || 1.5) * rate;
    }, 0);

    const energySavings = baselineEnergy - optimizedEnergy;
    const costSavings = baselineCost - optimizedCost;
    const percentageSavings = (energySavings / baselineEnergy) * 100;

    return {
      energy: energySavings,
      cost: costSavings,
      percentage: percentageSavings,
    };
  }

  /**
   * Fallback decision when optimization fails
   */
  private fallbackDecision(context: HVACDecisionContext): OptimizationDecision {
    this.logger.warning('⚠️ [HVAC Optimizer] Using fallback decision');

    const indoorTemp = context.indoorTemp || 20;
    const targetTemp = context.targetTemp || 22;
    const tempDiff = indoorTemp - targetTemp;

    let action = 'idle';
    if (tempDiff < -1.5) action = 'heating';
    else if (tempDiff > 1.5) action = 'cooling';

    return {
      action: action as any,
      targetTemp,
      duration: 60,
      comfortScore: 0.7,
      energyScore: 0.6,
      costScore: 0.6,
      overallScore: 0.63,
      predictedEnergyUse: 1.5,
      predictedCost: 0.18,
      predictedComfort: 0.7,
      reasoning:
        'Fallback optimization based on simple temperature differential.',
      factors: ['temperature_differential', 'fallback_logic'],
    };
  }

  /**
   * Validate and normalize configuration
   */
  private validateConfig(config: OptimizationConfig): OptimizationConfig {
    const totalWeight = config.comfortWeight + config.energyWeight +
      config.costWeight;

    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new Error(
        `Optimization weights must sum to 1.0, got ${totalWeight}`,
      );
    }

    return config;
  }

  /**
   * Update optimization configuration
   */
  updateConfig(updates: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...updates };
    this.config = this.validateConfig(this.config);

    this.logger.info('🔧 [HVAC Optimizer] Configuration updated', {
      comfortWeight: this.config.comfortWeight,
      energyWeight: this.config.energyWeight,
      costWeight: this.config.costWeight,
    });
  }

  /**
   * Get current optimization configuration
   */
  getConfig(): OptimizationConfig {
    return { ...this.config };
  }
}
