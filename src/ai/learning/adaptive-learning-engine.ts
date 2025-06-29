/**
 * Adaptive Learning Engine for HVAC Systems
 *
 * This module implements machine learning algorithms to adapt to user preferences,
 * learn from manual overrides, and continuously improve system performance.
 */

import {
  HVACDecisionContext,
  LearningFeedback,
  PreferenceWeights,
  UserInteraction,
  UserPattern,
} from '../types/ai-types.ts';
import type { LoggerService } from '../../core/logger.ts';

/**
 * Learning configuration
 */
export interface LearningConfig {
  // Learning parameters
  learningRate: number; // 0.0 to 1.0 - how quickly to adapt
  forgettingFactor: number; // 0.0 to 1.0 - how quickly to forget old patterns
  minInteractionsForPattern: number; // Minimum interactions to establish a pattern

  // Pattern detection
  similarityThreshold: number; // 0.0 to 1.0 - threshold for pattern matching
  patternValidityPeriod: number; // Days a pattern remains valid

  // Preference weights
  initialComfortWeight: number; // Default comfort preference
  initialEfficiencyWeight: number; // Default efficiency preference
  initialConvenienceWeight: number; // Default convenience preference

  // Adaptation limits
  maxWeightChange: number; // Maximum weight change per update
  adaptationWindowDays: number; // Days of data to consider for adaptation
}

/**
 * Learned user preference
 */
export interface LearnedPreference {
  context: {
    timeOfDay?: number;
    dayOfWeek?: number;
    season?: string;
    indoorTempRange?: { min: number; max: number };
    outdoorTempRange?: { min: number; max: number };
  };
  preference: {
    targetTemp: number;
    tolerance: number;
    energyPriority: number; // 0.0 to 1.0
    comfortPriority: number; // 0.0 to 1.0
    responsiveness: number; // How quickly user wants changes
  };
  confidence: number; // 0.0 to 1.0
  sampleCount: number; // Number of interactions that created this preference
  lastUpdated: Date;
}

/**
 * Behavioral insight
 */
export interface BehavioralInsight {
  type:
    | 'temperature_preference'
    | 'timing_pattern'
    | 'energy_sensitivity'
    | 'comfort_priority';
  description: string;
  confidence: number;
  evidence: string[];
  actionable: boolean;
  recommendation?: string;
}

/**
 * Adaptive Learning Engine
 */
export class AdaptiveLearningEngine {
  private config: LearningConfig;
  private logger: LoggerService;

  // Learning data storage
  private userInteractions: UserInteraction[] = [];
  private learnedPatterns: UserPattern[] = [];
  private learnedPreferences: LearnedPreference[] = [];
  private currentWeights: PreferenceWeights;
  private feedbackHistory: LearningFeedback[] = [];

  // Analysis cache
  private lastAnalysisTime: Date = new Date(0);
  private cachedInsights: BehavioralInsight[] = [];

  constructor(config: LearningConfig, logger: LoggerService) {
    this.config = config;
    this.logger = logger;

    // Initialize preference weights
    this.currentWeights = {
      comfort: config.initialComfortWeight,
      energyEfficiency: config.initialEfficiencyWeight,
      cost: 1 - config.initialComfortWeight - config.initialEfficiencyWeight,
      convenience: config.initialConvenienceWeight,
      lastUpdated: new Date(),
    };

    this.logger.info('🧠 [Learning Engine] Initialized', {
      learningRate: config.learningRate,
      forgettingFactor: config.forgettingFactor,
      initialWeights: this.currentWeights,
    });
  }

  /**
   * Record a user interaction for learning
   */
  recordUserInteraction(interaction: UserInteraction): void {
    this.userInteractions.push(interaction);
    this.pruneOldData();

    this.logger.debug('📝 [Learning Engine] User interaction recorded', {
      type: interaction.type,
      timestamp: interaction.timestamp,
      totalInteractions: this.userInteractions.length,
    });

    // Trigger learning if we have enough data
    if (this.userInteractions.length % 10 === 0) {
      this.triggerLearningUpdate();
    }
  }

  /**
   * Record feedback on a decision's outcome
   */
  recordFeedback(feedback: LearningFeedback): void {
    this.feedbackHistory.push(feedback);
    this.pruneOldData();

    this.logger.debug('📊 [Learning Engine] Feedback recorded', {
      decisionId: feedback.decisionId,
      energyUsed: feedback.actualOutcome.energyUsed,
      userSatisfaction: feedback.actualOutcome.userSatisfaction,
    });

    // Immediate learning from feedback
    this.learnFromFeedback(feedback);
  }

  /**
   * Get current learned preferences for optimization
   */
  getCurrentPreferences(): PreferenceWeights {
    return { ...this.currentWeights };
  }

  /**
   * Get personalized recommendations for a given context
   */
  async getPersonalizedRecommendations(context: HVACDecisionContext): Promise<{
    targetTemp: number;
    tolerance: number;
    optimizationWeights: PreferenceWeights;
    confidence: number;
    reasoning: string;
  }> {
    this.logger.debug(
      '🎯 [Learning Engine] Generating personalized recommendations',
      {
        currentHour: context.currentHour,
        indoorTemp: context.indoorTemp,
        systemMode: context.systemMode,
      },
    );

    try {
      // Find matching learned preferences
      const matchingPreferences = this.findMatchingPreferences(context);

      if (matchingPreferences.length === 0) {
        return this.getDefaultRecommendations(context);
      }

      // Weight preferences by confidence and recency
      const weightedPreference = this.combinePreferences(matchingPreferences);

      // Generate personalized optimization weights
      const personalizedWeights = this.generatePersonalizedWeights(
        weightedPreference,
      );

      const reasoning = this.generateRecommendationReasoning(
        matchingPreferences,
        weightedPreference,
      );

      this.logger.info(
        '✅ [Learning Engine] Personalized recommendations generated',
        {
          targetTemp: weightedPreference.targetTemp,
          confidence: weightedPreference.confidence,
          matchingPatterns: matchingPreferences.length,
        },
      );

      return {
        targetTemp: weightedPreference.targetTemp,
        tolerance: weightedPreference.tolerance,
        optimizationWeights: personalizedWeights,
        confidence: weightedPreference.confidence,
        reasoning,
      };
    } catch (error) {
      this.logger.error(
        '❌ [Learning Engine] Failed to generate recommendations',
        error,
      );
      return this.getDefaultRecommendations(context);
    }
  }

  /**
   * Analyze user behavior and generate insights
   */
  async generateBehavioralInsights(): Promise<BehavioralInsight[]> {
    const now = new Date();
    const timeSinceLastAnalysis = now.getTime() -
      this.lastAnalysisTime.getTime();

    // Only regenerate insights every hour to avoid excessive computation
    if (
      timeSinceLastAnalysis < 60 * 60 * 1000 && this.cachedInsights.length > 0
    ) {
      return this.cachedInsights;
    }

    this.logger.debug('🔍 [Learning Engine] Analyzing user behavior');

    try {
      const insights: BehavioralInsight[] = [];

      // Analyze temperature preferences
      const tempInsight = this.analyzeTemperaturePreferences();
      if (tempInsight) insights.push(tempInsight);

      // Analyze timing patterns
      const timingInsight = this.analyzeTimingPatterns();
      if (timingInsight) insights.push(timingInsight);

      // Analyze energy sensitivity
      const energyInsight = this.analyzeEnergySensitivity();
      if (energyInsight) insights.push(energyInsight);

      // Analyze comfort priorities
      const comfortInsight = this.analyzeComfortPriorities();
      if (comfortInsight) insights.push(comfortInsight);

      this.cachedInsights = insights;
      this.lastAnalysisTime = now;

      this.logger.info('📊 [Learning Engine] Behavioral insights generated', {
        insightCount: insights.length,
        actionableInsights: insights.filter((i) => i.actionable).length,
      });

      return insights;
    } catch (error) {
      this.logger.error(
        '❌ [Learning Engine] Failed to generate insights',
        error,
      );
      return [];
    }
  }

  /**
   * Trigger learning update based on recent interactions
   */
  private async triggerLearningUpdate(): Promise<void> {
    this.logger.debug('🔄 [Learning Engine] Triggering learning update');

    try {
      // Update patterns
      await this.updateLearnedPatterns();

      // Update preferences
      await this.updateLearnedPreferences();

      // Update weights
      await this.updatePreferenceWeights();

      this.logger.info('✅ [Learning Engine] Learning update completed');
    } catch (error) {
      this.logger.error('❌ [Learning Engine] Learning update failed', error);
    }
  }

  /**
   * Update learned patterns from user interactions
   */
  private async updateLearnedPatterns(): Promise<void> {
    const recentInteractions = this.getRecentInteractions();

    // Group interactions by similar contexts
    const groupedInteractions = this.groupInteractionsByContext(
      recentInteractions,
    );

    for (const [contextKey, interactions] of groupedInteractions.entries()) {
      if (interactions.length >= this.config.minInteractionsForPattern) {
        const pattern = this.extractPattern(contextKey, interactions);

        // Update existing pattern or create new one
        const existingPatternIndex = this.learnedPatterns.findIndex((p) =>
          this.patternsAreSimilar(p, pattern)
        );

        if (existingPatternIndex >= 0) {
          this.learnedPatterns[existingPatternIndex] = this.mergePatterns(
            this.learnedPatterns[existingPatternIndex],
            pattern,
          );
        } else {
          this.learnedPatterns.push(pattern);
        }
      }
    }

    // Remove outdated patterns
    this.pruneOutdatedPatterns();
  }

  /**
   * Update learned preferences from patterns and feedback
   */
  private async updateLearnedPreferences(): Promise<void> {
    const contextGroups = this.groupInteractionsByDetailedContext();

    for (const [contextKey, interactions] of contextGroups.entries()) {
      if (interactions.length >= 3) { // Need minimum interactions for preference
        const preference = this.extractPreference(contextKey, interactions);

        // Update existing preference or create new one
        const existingPrefIndex = this.learnedPreferences.findIndex((p) =>
          this.contextsAreSimilar(p.context, preference.context)
        );

        if (existingPrefIndex >= 0) {
          this.learnedPreferences[existingPrefIndex] = this.mergePreferences(
            this.learnedPreferences[existingPrefIndex],
            preference,
          );
        } else {
          this.learnedPreferences.push(preference);
        }
      }
    }
  }

  /**
   * Update global preference weights based on learning
   */
  private async updatePreferenceWeights(): Promise<void> {
    if (this.feedbackHistory.length < 5) {
      return; // Need minimum feedback for weight updates
    }

    // Analyze recent feedback to adjust weights
    const recentFeedback = this.feedbackHistory.slice(-20); // Last 20 feedback items

    let comfortScore = 0;
    let energyScore = 0;
    let costScore = 0;

    recentFeedback.forEach((feedback) => {
      const comfort = feedback.actualOutcome.comfortAchieved || 0.5;
      const energy = 1 -
        Math.min(1, (feedback.actualOutcome.energyUsed || 2) / 4); // Normalize energy use
      const satisfaction = feedback.actualOutcome.userSatisfaction || 0.5;

      comfortScore += comfort * satisfaction;
      energyScore += energy * satisfaction;
      costScore += (energy * 0.8 + comfort * 0.2) * satisfaction; // Cost correlates with energy and comfort
    });

    // Normalize scores
    const totalScore = comfortScore + energyScore + costScore;
    if (totalScore > 0) {
      const newComfortWeight = comfortScore / totalScore;
      const newEnergyWeight = energyScore / totalScore;
      const newCostWeight = costScore / totalScore;

      // Apply learning rate and limits
      const weightChange = this.config.learningRate *
        this.config.maxWeightChange;

      this.currentWeights = {
        comfort: this.clampWeightChange(
          this.currentWeights.comfort,
          newComfortWeight,
          weightChange,
        ),
        energyEfficiency: this.clampWeightChange(
          this.currentWeights.energyEfficiency,
          newEnergyWeight,
          weightChange,
        ),
        cost: this.clampWeightChange(
          this.currentWeights.cost,
          newCostWeight,
          weightChange,
        ),
        convenience: this.currentWeights.convenience, // Keep convenience stable for now
        lastUpdated: new Date(),
      };

      this.logger.info('🎛️ [Learning Engine] Preference weights updated', {
        comfort: this.currentWeights.comfort.toFixed(3),
        energy: this.currentWeights.energyEfficiency.toFixed(3),
        cost: this.currentWeights.cost.toFixed(3),
      });
    }
  }

  /**
   * Learn from specific feedback
   */
  private learnFromFeedback(feedback: LearningFeedback): void {
    const context = feedback.context;
    const outcome = feedback.actualOutcome;

    // If user satisfaction is low, adjust preferences
    if (outcome.userSatisfaction && outcome.userSatisfaction < 0.6) {
      // Find relevant learned preference and adjust it
      const matchingPrefs = this.findMatchingPreferences(context);

      if (matchingPrefs.length > 0) {
        // Reduce confidence in matching preferences
        matchingPrefs.forEach((pref) => {
          pref.confidence *= 0.9; // Reduce confidence by 10%
        });

        this.logger.debug(
          '📉 [Learning Engine] Reduced confidence due to low satisfaction',
          {
            satisfaction: outcome.userSatisfaction,
            adjustedPreferences: matchingPrefs.length,
          },
        );
      }
    }

    // If energy use was higher than expected, increase energy weight slightly
    if (outcome.energyUsed && outcome.energyUsed > 3.0) {
      const adjustment = this.config.learningRate * 0.05; // Small adjustment
      this.currentWeights.energyEfficiency = Math.min(
        1.0,
        this.currentWeights.energyEfficiency + adjustment,
      );
      this.normalizeWeights();
    }
  }

  /**
   * Find preferences matching current context
   */
  private findMatchingPreferences(
    context: HVACDecisionContext,
  ): LearnedPreference[] {
    return this.learnedPreferences.filter((pref) => {
      const contextMatch = this.calculateContextSimilarity(
        pref.context,
        context,
      );
      return contextMatch >= this.config.similarityThreshold;
    });
  }

  /**
   * Calculate similarity between contexts
   */
  private calculateContextSimilarity(
    learnedContext: LearnedPreference['context'],
    currentContext: HVACDecisionContext,
  ): number {
    let similarities: number[] = [];

    // Time of day similarity
    if (
      learnedContext.timeOfDay !== undefined &&
      currentContext.currentHour !== undefined
    ) {
      const hourDiff = Math.abs(
        learnedContext.timeOfDay - currentContext.currentHour,
      );
      const hourSimilarity = 1 - Math.min(hourDiff, 24 - hourDiff) / 12; // Circular similarity
      similarities.push(hourSimilarity);
    }

    // Day of week similarity
    if (
      learnedContext.dayOfWeek !== undefined &&
      currentContext.isWeekday !== undefined
    ) {
      const isWeekday = currentContext.isWeekday;
      const learnedIsWeekday = learnedContext.dayOfWeek >= 1 &&
        learnedContext.dayOfWeek <= 5;
      similarities.push(isWeekday === learnedIsWeekday ? 1.0 : 0.3);
    }

    // Temperature range similarity
    if (
      learnedContext.indoorTempRange && currentContext.indoorTemp !== undefined
    ) {
      const { min, max } = learnedContext.indoorTempRange;
      const temp = currentContext.indoorTemp;

      if (temp >= min && temp <= max) {
        similarities.push(1.0);
      } else {
        const distance = Math.min(Math.abs(temp - min), Math.abs(temp - max));
        similarities.push(Math.max(0, 1 - distance / 5)); // 5°C tolerance
      }
    }

    return similarities.length > 0
      ? similarities.reduce((sum, sim) => sum + sim, 0) / similarities.length
      : 0;
  }

  /**
   * Combine multiple preferences into a weighted preference
   */
  private combinePreferences(
    preferences: LearnedPreference[],
  ): LearnedPreference {
    if (preferences.length === 1) {
      return preferences[0];
    }

    // Weight by confidence and recency
    const totalWeight = preferences.reduce((sum, pref) => {
      const recencyFactor = this.calculateRecencyFactor(pref.lastUpdated);
      return sum + pref.confidence * recencyFactor;
    }, 0);

    let weightedTargetTemp = 0;
    let weightedTolerance = 0;
    let weightedEnergyPriority = 0;
    let weightedComfortPriority = 0;
    let weightedResponsiveness = 0;

    preferences.forEach((pref) => {
      const recencyFactor = this.calculateRecencyFactor(pref.lastUpdated);
      const weight = (pref.confidence * recencyFactor) / totalWeight;

      weightedTargetTemp += pref.preference.targetTemp * weight;
      weightedTolerance += pref.preference.tolerance * weight;
      weightedEnergyPriority += pref.preference.energyPriority * weight;
      weightedComfortPriority += pref.preference.comfortPriority * weight;
      weightedResponsiveness += pref.preference.responsiveness * weight;
    });

    return {
      context: preferences[0].context, // Use first context as representative
      preference: {
        targetTemp: weightedTargetTemp,
        tolerance: weightedTolerance,
        energyPriority: weightedEnergyPriority,
        comfortPriority: weightedComfortPriority,
        responsiveness: weightedResponsiveness,
      },
      confidence: Math.min(...preferences.map((p) => p.confidence)),
      sampleCount: preferences.reduce((sum, p) => sum + p.sampleCount, 0),
      lastUpdated: new Date(),
    };
  }

  /**
   * Generate personalized optimization weights
   */
  private generatePersonalizedWeights(
    preference: LearnedPreference,
  ): PreferenceWeights {
    const base = this.currentWeights;
    const personalizedAdjustment = 0.3; // How much to adjust from base weights

    return {
      comfort: base.comfort +
        (preference.preference.comfortPriority - 0.5) * personalizedAdjustment,
      energyEfficiency: base.energyEfficiency +
        (preference.preference.energyPriority - 0.5) * personalizedAdjustment,
      cost: base.cost, // Keep cost stable
      convenience: base.convenience,
      lastUpdated: new Date(),
    };
  }

  /**
   * Analyze temperature preferences from user interactions
   */
  private analyzeTemperaturePreferences(): BehavioralInsight | null {
    const tempOverrides = this.userInteractions.filter((i) =>
      i.type === 'manual_override' && i.details.temperature
    );

    if (tempOverrides.length < 3) return null;

    const temperatures = tempOverrides.map((i) =>
      i.details.temperature as number
    );
    const avgTemp = temperatures.reduce((sum, temp) => sum + temp, 0) /
      temperatures.length;
    const tempRange = Math.max(...temperatures) - Math.min(...temperatures);

    return {
      type: 'temperature_preference',
      description: `User prefers temperature around ${
        avgTemp.toFixed(1)
      }°C with ${tempRange.toFixed(1)}°C variation`,
      confidence: Math.min(0.9, tempOverrides.length / 10),
      evidence: [
        `${tempOverrides.length} temperature overrides`,
        `Average: ${avgTemp.toFixed(1)}°C`,
      ],
      actionable: true,
      recommendation: `Adjust default target temperature to ${
        avgTemp.toFixed(1)
      }°C`,
    };
  }

  /**
   * Analyze timing patterns in user behavior
   */
  private analyzeTimingPatterns(): BehavioralInsight | null {
    const timedInteractions = this.userInteractions.filter((i) =>
      i.context.timeOfDay !== undefined
    );

    if (timedInteractions.length < 5) return null;

    // Group by hour
    const hourlyActivity: Record<number, number> = {};
    timedInteractions.forEach((i) => {
      const hour = i.context.timeOfDay!;
      hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
    });

    const peakHour = Object.entries(hourlyActivity)
      .sort(([, a], [, b]) => b - a)[0][0];

    return {
      type: 'timing_pattern',
      description: `Most active adjustment hour: ${peakHour}:00`,
      confidence: 0.7,
      evidence: [
        `${timedInteractions.length} timed interactions`,
        `Peak: ${peakHour}:00`,
      ],
      actionable: true,
      recommendation: `Consider proactive adjustments around ${peakHour}:00`,
    };
  }

  /**
   * Analyze energy sensitivity from feedback
   */
  private analyzeEnergySensitivity(): BehavioralInsight | null {
    const energyFeedback = this.feedbackHistory.filter((f) =>
      f.actualOutcome.energyUsed !== undefined
    );

    if (energyFeedback.length < 3) return null;

    // Correlation between energy use and satisfaction
    let correlation = 0;
    // Simplified correlation calculation
    const avgEnergy = energyFeedback.reduce(
      (sum, f) => sum + (f.actualOutcome.energyUsed || 0),
      0,
    ) / energyFeedback.length;
    const avgSatisfaction = energyFeedback.reduce(
      (sum, f) => sum + (f.actualOutcome.userSatisfaction || 0.5),
      0,
    ) / energyFeedback.length;

    const sensitivity = avgSatisfaction > 0.7 && avgEnergy < 2.0
      ? 'high'
      : 'moderate';

    return {
      type: 'energy_sensitivity',
      description: `User shows ${sensitivity} energy sensitivity`,
      confidence: 0.6,
      evidence: [`${energyFeedback.length} energy feedback points`],
      actionable: true,
      recommendation: sensitivity === 'high'
        ? 'Prioritize energy-efficient operations'
        : 'Balance energy and comfort',
    };
  }

  /**
   * Analyze comfort priorities
   */
  private analyzeComfortPriorities(): BehavioralInsight | null {
    const manualOverrides = this.userInteractions.filter((i) =>
      i.type === 'manual_override'
    );

    if (manualOverrides.length < 3) return null;

    const comfortOverrides = manualOverrides.filter((i) => {
      const tempDiff = Math.abs((i.context.indoorTemp || 21) - 22);
      return tempDiff > 1; // Override when temperature is more than 1°C from ideal
    });

    const comfortPriority = comfortOverrides.length / manualOverrides.length;

    return {
      type: 'comfort_priority',
      description: `Comfort priority: ${
        comfortPriority > 0.6 ? 'High' : 'Moderate'
      }`,
      confidence: Math.min(0.8, manualOverrides.length / 10),
      evidence: [
        `${comfortOverrides.length}/${manualOverrides.length} comfort-driven overrides`,
      ],
      actionable: true,
      recommendation: comfortPriority > 0.6
        ? 'Prioritize comfort over efficiency'
        : 'Balanced approach recommended',
    };
  }

  /**
   * Helper methods
   */

  private getRecentInteractions(days: number = 7): UserInteraction[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.userInteractions.filter((i) => i.timestamp >= cutoff);
  }

  private groupInteractionsByContext(
    interactions: UserInteraction[],
  ): Map<string, UserInteraction[]> {
    const groups = new Map<string, UserInteraction[]>();

    interactions.forEach((interaction) => {
      const contextKey = this.generateContextKey(interaction);
      if (!groups.has(contextKey)) {
        groups.set(contextKey, []);
      }
      groups.get(contextKey)!.push(interaction);
    });

    return groups;
  }

  private groupInteractionsByDetailedContext(): Map<string, UserInteraction[]> {
    const groups = new Map<string, UserInteraction[]>();

    this.userInteractions.forEach((interaction) => {
      const contextKey = this.generateDetailedContextKey(interaction);
      if (!groups.has(contextKey)) {
        groups.set(contextKey, []);
      }
      groups.get(contextKey)!.push(interaction);
    });

    return groups;
  }

  private generateContextKey(interaction: UserInteraction): string {
    const hour = interaction.context.timeOfDay || 12;
    const hourBucket = Math.floor(hour / 4) * 4; // 4-hour buckets
    const tempBucket = Math.floor((interaction.context.indoorTemp || 21) / 2) *
      2; // 2°C buckets

    return `h${hourBucket}_t${tempBucket}_${interaction.type}`;
  }

  private generateDetailedContextKey(interaction: UserInteraction): string {
    const hour = interaction.context.timeOfDay || 12;
    const hourBucket = Math.floor(hour / 2) * 2; // 2-hour buckets
    const tempBucket = Math.floor((interaction.context.indoorTemp || 21) / 1) *
      1; // 1°C buckets
    const dayType = new Date(interaction.timestamp).getDay() >= 1 &&
        new Date(interaction.timestamp).getDay() <= 5
      ? 'wd'
      : 'we';

    return `${dayType}_h${hourBucket}_t${tempBucket}`;
  }

  private extractPattern(
    contextKey: string,
    interactions: UserInteraction[],
  ): UserPattern {
    // Extract pattern from similar interactions
    const mostCommonAction = this.getMostCommonAction(interactions);
    const avgTime = this.getAverageTimeOfDay(interactions);
    const frequency = interactions.length;

    return {
      timeOfDay: avgTime,
      dayOfWeek: this.getMostCommonDayOfWeek(interactions),
      action: mostCommonAction,
      context: { contextKey },
      frequency,
      confidence: Math.min(0.9, frequency / 10),
    };
  }

  private extractPreference(
    contextKey: string,
    interactions: UserInteraction[],
  ): LearnedPreference {
    const temps = interactions
      .filter((i) => i.details.temperature)
      .map((i) => i.details.temperature as number);

    const avgTemp = temps.length > 0
      ? temps.reduce((sum, temp) => sum + temp, 0) / temps.length
      : 22;

    const tempVariance = temps.length > 1
      ? Math.sqrt(
        temps.reduce((sum, temp) => sum + Math.pow(temp - avgTemp, 2), 0) /
          temps.length,
      )
      : 1.5;

    return {
      context: this.parseContextKey(contextKey),
      preference: {
        targetTemp: avgTemp,
        tolerance: Math.max(0.5, tempVariance),
        energyPriority: 0.5, // Default
        comfortPriority: 0.8, // Assume comfort is important if user is overriding
        responsiveness: 0.7,
      },
      confidence: Math.min(0.9, interactions.length / 5),
      sampleCount: interactions.length,
      lastUpdated: new Date(),
    };
  }

  private parseContextKey(contextKey: string): LearnedPreference['context'] {
    // Parse context key back to context object
    // This is a simplified implementation
    return {
      timeOfDay: 12, // Default values
      dayOfWeek: 1,
    };
  }

  private getMostCommonAction(
    interactions: UserInteraction[],
  ): UserPattern['action'] {
    const actionCounts: Record<string, number> = {};
    interactions.forEach((i) => {
      actionCounts[i.type] = (actionCounts[i.type] || 0) + 1;
    });

    return Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)[0][0] as UserPattern['action'];
  }

  private getAverageTimeOfDay(interactions: UserInteraction[]): number {
    const times = interactions
      .filter((i) => i.context.timeOfDay !== undefined)
      .map((i) => i.context.timeOfDay!);

    return times.length > 0
      ? times.reduce((sum, time) => sum + time, 0) / times.length
      : 12;
  }

  private getMostCommonDayOfWeek(interactions: UserInteraction[]): number {
    const days = interactions.map((i) => new Date(i.timestamp).getDay());
    const dayCounts: Record<number, number> = {};

    days.forEach((day) => {
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });

    return parseInt(
      Object.entries(dayCounts)
        .sort(([, a], [, b]) => b - a)[0][0],
    );
  }

  private calculateRecencyFactor(lastUpdated: Date): number {
    const daysSince = (Date.now() - lastUpdated.getTime()) /
      (1000 * 60 * 60 * 24);
    return Math.exp(-daysSince / 30); // Exponential decay over 30 days
  }

  private clampWeightChange(
    current: number,
    target: number,
    maxChange: number,
  ): number {
    const change = Math.sign(target - current) *
      Math.min(Math.abs(target - current), maxChange);
    return Math.max(0, Math.min(1, current + change));
  }

  private normalizeWeights(): void {
    const total = this.currentWeights.comfort +
      this.currentWeights.energyEfficiency + this.currentWeights.cost;
    if (total > 0) {
      this.currentWeights.comfort /= total;
      this.currentWeights.energyEfficiency /= total;
      this.currentWeights.cost /= total;
    }
  }

  private patternsAreSimilar(
    pattern1: UserPattern,
    pattern2: UserPattern,
  ): boolean {
    return Math.abs(pattern1.timeOfDay - pattern2.timeOfDay) < 2 &&
      pattern1.action === pattern2.action;
  }

  private contextsAreSimilar(context1: any, context2: any): boolean {
    return Math.abs((context1.timeOfDay || 0) - (context2.timeOfDay || 0)) < 2;
  }

  private mergePatterns(
    existing: UserPattern,
    newPattern: UserPattern,
  ): UserPattern {
    const weight = this.config.learningRate;

    return {
      ...existing,
      timeOfDay: existing.timeOfDay * (1 - weight) +
        newPattern.timeOfDay * weight,
      frequency: existing.frequency + newPattern.frequency,
      confidence: Math.min(0.95, existing.confidence + 0.1),
    };
  }

  private mergePreferences(
    existing: LearnedPreference,
    newPref: LearnedPreference,
  ): LearnedPreference {
    const weight = this.config.learningRate;

    return {
      ...existing,
      preference: {
        targetTemp: existing.preference.targetTemp * (1 - weight) +
          newPref.preference.targetTemp * weight,
        tolerance: existing.preference.tolerance * (1 - weight) +
          newPref.preference.tolerance * weight,
        energyPriority: existing.preference.energyPriority * (1 - weight) +
          newPref.preference.energyPriority * weight,
        comfortPriority: existing.preference.comfortPriority * (1 - weight) +
          newPref.preference.comfortPriority * weight,
        responsiveness: existing.preference.responsiveness * (1 - weight) +
          newPref.preference.responsiveness * weight,
      },
      confidence: Math.min(
        0.95,
        (existing.confidence + newPref.confidence) / 2,
      ),
      sampleCount: existing.sampleCount + newPref.sampleCount,
      lastUpdated: new Date(),
    };
  }

  private pruneOldData(): void {
    const cutoff = new Date(
      Date.now() - this.config.adaptationWindowDays * 24 * 60 * 60 * 1000,
    );

    this.userInteractions = this.userInteractions.filter((i) =>
      i.timestamp >= cutoff
    );
    this.feedbackHistory = this.feedbackHistory.filter((f) =>
      f.timestamp >= cutoff
    );
  }

  private pruneOutdatedPatterns(): void {
    const cutoff = new Date(
      Date.now() - this.config.patternValidityPeriod * 24 * 60 * 60 * 1000,
    );

    this.learnedPatterns = this.learnedPatterns.filter((pattern) => {
      // Remove patterns that haven't been reinforced recently
      return pattern.confidence > 0.3; // Keep patterns with reasonable confidence
    });
  }

  private getDefaultRecommendations(context: HVACDecisionContext): any {
    return {
      targetTemp: context.targetTemp || 22,
      tolerance: 1.5,
      optimizationWeights: this.currentWeights,
      confidence: 0.3,
      reasoning:
        'Using default recommendations due to insufficient learning data',
    };
  }

  private generateRecommendationReasoning(
    matchingPrefs: LearnedPreference[],
    combined: LearnedPreference,
  ): string {
    const count = matchingPrefs.length;
    const avgConfidence =
      matchingPrefs.reduce((sum, p) => sum + p.confidence, 0) / count;

    return `Based on ${count} similar situation(s) with ${
      (avgConfidence * 100).toFixed(0)
    }% confidence. ` +
      `Learned preference: ${
        combined.preference.targetTemp.toFixed(1)
      }°C with ` +
      `${combined.preference.tolerance.toFixed(1)}°C tolerance.`;
  }

  /**
   * Get learning summary for monitoring
   */
  getLearningStats(): {
    interactions: number;
    patterns: number;
    preferences: number;
    feedbackItems: number;
    currentWeights: PreferenceWeights;
    learningCapability: boolean;
  } {
    return {
      interactions: this.userInteractions.length,
      patterns: this.learnedPatterns.length,
      preferences: this.learnedPreferences.length,
      feedbackItems: this.feedbackHistory.length,
      currentWeights: this.currentWeights,
      learningCapability:
        this.userInteractions.length >= this.config.minInteractionsForPattern,
    };
  }
}
