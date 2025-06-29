/**
 * Predictive Analytics Engine for HVAC Systems
 *
 * This module implements advanced analytics and forecasting capabilities
 * to predict temperature trends, energy usage, and optimal scheduling.
 */

import {
  EnergyUsageData,
  TemperatureReading,
  WeatherData,
} from '../types/ai-types.ts';
import type { LoggerService } from '../../core/logger.ts';

/**
 * Time series prediction result
 */
export interface PredictionResult {
  timestamp: Date;
  predictedValue: number;
  confidence: number; // 0.0 to 1.0
  upperBound: number;
  lowerBound: number;
  factors: string[];
}

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  // Historical data retention
  maxHistoricalDays: number;
  minDataPointsForPrediction: number;

  // Prediction parameters
  predictionHorizonHours: number;
  confidenceInterval: number; // e.g., 0.95 for 95% confidence

  // Model parameters
  seasonalityPeriod: number; // Hours (e.g., 24 for daily pattern)
  trendSmoothingFactor: number; // 0.0 to 1.0
  seasonalSmoothingFactor: number; // 0.0 to 1.0

  // External factors
  weatherWeight: number; // How much weather affects predictions
  occupancyWeight: number; // How much occupancy affects predictions
}

/**
 * Seasonal pattern detection
 */
interface SeasonalPattern {
  period: number; // Hours
  amplitude: number; // Temperature variation
  phase: number; // Hour offset
  confidence: number; // 0.0 to 1.0
}

/**
 * Trend analysis result
 */
interface TrendAnalysis {
  direction: 'rising' | 'falling' | 'stable';
  rate: number; // Degrees per hour
  confidence: number; // 0.0 to 1.0
  significance: 'high' | 'medium' | 'low';
}

/**
 * Predictive Analytics Engine
 */
export class PredictiveAnalyticsEngine {
  private config: AnalyticsConfig;
  private logger: LoggerService;

  // Historical data storage
  private temperatureHistory: TemperatureReading[] = [];
  private energyHistory: EnergyUsageData[] = [];
  private weatherHistory: WeatherData[] = [];

  // Cached analysis results
  private seasonalPatterns: Map<string, SeasonalPattern> = new Map();
  private lastAnalysisTime: Date = new Date(0);

  constructor(config: AnalyticsConfig, logger: LoggerService) {
    this.config = config;
    this.logger = logger;

    this.logger.info('📊 [Analytics Engine] Initialized', {
      predictionHorizon: config.predictionHorizonHours,
      seasonalityPeriod: config.seasonalityPeriod,
      maxHistoricalDays: config.maxHistoricalDays,
    });
  }

  /**
   * Add temperature reading to historical data
   */
  addTemperatureReading(reading: TemperatureReading): void {
    this.temperatureHistory.push(reading);
    this.pruneHistoricalData();

    this.logger.debug('📈 [Analytics Engine] Temperature reading added', {
      source: reading.source,
      temperature: reading.indoorTemp,
      historicalCount: this.temperatureHistory.length,
    });
  }

  /**
   * Add energy usage data to historical data
   */
  addEnergyData(data: EnergyUsageData): void {
    this.energyHistory.push(data);
    this.pruneHistoricalData();

    this.logger.debug('⚡ [Analytics Engine] Energy data added', {
      usage: data.usage,
      mode: data.hvacMode,
      historicalCount: this.energyHistory.length,
    });
  }

  /**
   * Add weather data to historical data
   */
  addWeatherData(data: WeatherData): void {
    this.weatherHistory.push(data);
    this.pruneHistoricalData();
  }

  /**
   * Predict indoor temperature for the next period
   */
  async predictIndoorTemperature(
    hoursAhead: number = 1,
    currentOutdoorTemp?: number,
  ): Promise<PredictionResult> {
    this.logger.debug('🔮 [Analytics Engine] Predicting indoor temperature', {
      hoursAhead,
      currentOutdoorTemp,
      historicalPoints: this.temperatureHistory.length,
    });

    try {
      // Check if we have enough data
      if (
        this.temperatureHistory.length < this.config.minDataPointsForPrediction
      ) {
        return this.fallbackTemperaturePrediction(
          hoursAhead,
          currentOutdoorTemp,
        );
      }

      // Update seasonal patterns if needed
      await this.updateSeasonalPatterns();

      // Get recent temperature trend
      const trend = this.analyzeTrend(this.temperatureHistory, 24); // Last 24 hours

      // Get seasonal component
      const seasonal = this.getSeasonalComponent(
        new Date(Date.now() + hoursAhead * 60 * 60 * 1000),
      );

      // Get weather influence
      const weatherInfluence = this.calculateWeatherInfluence(
        currentOutdoorTemp,
        hoursAhead,
      );

      // Combine all factors
      const lastReading =
        this.temperatureHistory[this.temperatureHistory.length - 1];
      const baseTemp = lastReading.indoorTemp;

      const predictedValue = baseTemp +
        (trend.rate * hoursAhead) +
        seasonal +
        weatherInfluence;

      // Calculate confidence based on data quality and consistency
      const confidence = this.calculatePredictionConfidence(
        trend,
        seasonal,
        weatherInfluence,
      );

      // Calculate bounds
      const uncertainty = (1 - confidence) * 3; // Temperature uncertainty range
      const upperBound = predictedValue + uncertainty;
      const lowerBound = predictedValue - uncertainty;

      const result: PredictionResult = {
        timestamp: new Date(Date.now() + hoursAhead * 60 * 60 * 1000),
        predictedValue,
        confidence,
        upperBound,
        lowerBound,
        factors: [
          'trend_analysis',
          'seasonal_pattern',
          'weather_influence',
          'historical_data',
        ],
      };

      this.logger.info(
        '✅ [Analytics Engine] Temperature prediction completed',
        {
          predicted: predictedValue.toFixed(1),
          confidence: (confidence * 100).toFixed(0),
          hoursAhead,
          factors: result.factors,
        },
      );

      return result;
    } catch (error) {
      this.logger.error(
        '❌ [Analytics Engine] Temperature prediction failed',
        error,
      );
      return this.fallbackTemperaturePrediction(hoursAhead, currentOutdoorTemp);
    }
  }

  /**
   * Predict energy usage for the next period
   */
  async predictEnergyUsage(
    hoursAhead: number = 1,
    plannedHvacMode: string = 'auto',
  ): Promise<PredictionResult> {
    this.logger.debug('⚡ [Analytics Engine] Predicting energy usage', {
      hoursAhead,
      plannedHvacMode,
      historicalPoints: this.energyHistory.length,
    });

    try {
      if (this.energyHistory.length < this.config.minDataPointsForPrediction) {
        return this.fallbackEnergyPrediction(hoursAhead, plannedHvacMode);
      }

      // Get average energy usage for similar conditions
      const similarConditions = this.findSimilarEnergyConditions(
        plannedHvacMode,
      );
      const avgUsage = similarConditions.reduce((sum, data) =>
        sum + data.usage, 0) / similarConditions.length;

      // Apply time-of-day factor
      const futureTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
      const timeOfDayFactor = this.getTimeOfDayEnergyFactor(
        futureTime.getHours(),
      );

      // Apply efficiency factor based on outdoor conditions
      const efficiencyFactor = this.calculateEfficiencyFactor(plannedHvacMode);

      const predictedValue = avgUsage * timeOfDayFactor * efficiencyFactor;
      const confidence = similarConditions.length >= 10 ? 0.8 : 0.6;

      const uncertainty = predictedValue * 0.2; // 20% uncertainty
      const upperBound = predictedValue + uncertainty;
      const lowerBound = Math.max(0, predictedValue - uncertainty);

      const result: PredictionResult = {
        timestamp: futureTime,
        predictedValue,
        confidence,
        upperBound,
        lowerBound,
        factors: [
          'historical_average',
          'time_of_day',
          'efficiency_factor',
          'hvac_mode',
        ],
      };

      this.logger.info('✅ [Analytics Engine] Energy prediction completed', {
        predicted: predictedValue.toFixed(2),
        confidence: (confidence * 100).toFixed(0),
        mode: plannedHvacMode,
      });

      return result;
    } catch (error) {
      this.logger.error(
        '❌ [Analytics Engine] Energy prediction failed',
        error,
      );
      return this.fallbackEnergyPrediction(hoursAhead, plannedHvacMode);
    }
  }

  /**
   * Detect and update seasonal patterns in temperature data
   */
  private async updateSeasonalPatterns(): Promise<void> {
    const now = new Date();
    const timeSinceLastAnalysis = now.getTime() -
      this.lastAnalysisTime.getTime();

    // Only update patterns every 4 hours to avoid excessive computation
    if (timeSinceLastAnalysis < 4 * 60 * 60 * 1000) {
      return;
    }

    this.logger.debug('🔄 [Analytics Engine] Updating seasonal patterns');

    try {
      // Analyze daily pattern (24-hour cycle)
      const dailyPattern = this.detectSeasonalPattern(
        this.temperatureHistory,
        24,
      );
      if (dailyPattern) {
        this.seasonalPatterns.set('daily', dailyPattern);
      }

      // Analyze weekly pattern (7-day cycle)
      const weeklyPattern = this.detectSeasonalPattern(
        this.temperatureHistory,
        24 * 7,
      );
      if (weeklyPattern) {
        this.seasonalPatterns.set('weekly', weeklyPattern);
      }

      this.lastAnalysisTime = now;

      this.logger.info('📊 [Analytics Engine] Seasonal patterns updated', {
        dailyConfidence: dailyPattern?.confidence || 0,
        weeklyConfidence: weeklyPattern?.confidence || 0,
      });
    } catch (error) {
      this.logger.error(
        '❌ [Analytics Engine] Failed to update seasonal patterns',
        error,
      );
    }
  }

  /**
   * Detect seasonal pattern in time series data
   */
  private detectSeasonalPattern(
    data: TemperatureReading[],
    periodHours: number,
  ): SeasonalPattern | null {
    if (data.length < periodHours * 2) {
      return null; // Need at least 2 cycles for pattern detection
    }

    // Group data by hour within the period
    const buckets: number[][] = Array(periodHours).fill(null).map(() => []);

    data.forEach((reading) => {
      const hourInPeriod = Math.floor(
        (reading.timestamp.getTime() / (1000 * 60 * 60)) % periodHours,
      );
      buckets[hourInPeriod].push(reading.indoorTemp);
    });

    // Calculate average for each hour
    const averages = buckets.map((bucket) =>
      bucket.length > 0
        ? bucket.reduce((sum, temp) => sum + temp, 0) / bucket.length
        : 0
    );

    // Calculate overall average
    const overallAvg = averages.reduce((sum, avg) => sum + avg, 0) /
      averages.length;

    // Calculate amplitude (peak-to-peak variation)
    const maxAvg = Math.max(...averages);
    const minAvg = Math.min(...averages);
    const amplitude = maxAvg - minAvg;

    // Find phase (hour of maximum temperature)
    const maxIndex = averages.indexOf(maxAvg);

    // Calculate confidence based on data consistency
    const confidence = this.calculatePatternConfidence(
      buckets,
      averages,
      overallAvg,
    );

    return {
      period: periodHours,
      amplitude,
      phase: maxIndex,
      confidence,
    };
  }

  /**
   * Calculate confidence in detected pattern
   */
  private calculatePatternConfidence(
    buckets: number[][],
    averages: number[],
    overallAvg: number,
  ): number {
    let totalVariance = 0;
    let totalPoints = 0;

    buckets.forEach((bucket, index) => {
      if (bucket.length > 0) {
        const bucketAvg = averages[index];
        const variance = bucket.reduce((sum, temp) =>
          sum + Math.pow(temp - bucketAvg, 2), 0) / bucket.length;

        totalVariance += variance * bucket.length;
        totalPoints += bucket.length;
      }
    });

    const avgVariance = totalVariance / totalPoints;

    // Lower variance = higher confidence
    const varianceScore = Math.max(0, 1 - avgVariance / 4); // Normalize to 0-1

    // More data points = higher confidence
    const dataScore = Math.min(1, totalPoints / (buckets.length * 10)); // Target 10+ points per bucket

    return (varianceScore + dataScore) / 2;
  }

  /**
   * Get seasonal component for a specific time
   */
  private getSeasonalComponent(timestamp: Date): number {
    let seasonalEffect = 0;

    // Apply daily pattern
    const dailyPattern = this.seasonalPatterns.get('daily');
    if (dailyPattern && dailyPattern.confidence > 0.5) {
      const hourOfDay = timestamp.getHours();
      const phase = (hourOfDay - dailyPattern.phase + 24) % 24;
      const dailyComponent = dailyPattern.amplitude *
        Math.sin(2 * Math.PI * phase / 24) * dailyPattern.confidence;
      seasonalEffect += dailyComponent;
    }

    // Apply weekly pattern (if available)
    const weeklyPattern = this.seasonalPatterns.get('weekly');
    if (weeklyPattern && weeklyPattern.confidence > 0.3) {
      const hourOfWeek = timestamp.getDay() * 24 + timestamp.getHours();
      const phase = (hourOfWeek - weeklyPattern.phase + 168) % 168; // 168 hours in a week
      const weeklyComponent = weeklyPattern.amplitude *
        Math.sin(2 * Math.PI * phase / 168) * weeklyPattern.confidence * 0.5; // Reduced weight
      seasonalEffect += weeklyComponent;
    }

    return seasonalEffect;
  }

  /**
   * Analyze trend in temperature data
   */
  private analyzeTrend(
    data: TemperatureReading[],
    hoursBack: number,
  ): TrendAnalysis {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const recentData = data.filter((reading) =>
      reading.timestamp >= cutoffTime
    );

    if (recentData.length < 3) {
      return {
        direction: 'stable',
        rate: 0,
        confidence: 0,
        significance: 'low',
      };
    }

    // Simple linear regression for trend
    const n = recentData.length;
    const startTime = recentData[0].timestamp.getTime();

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    recentData.forEach((reading) => {
      const x = (reading.timestamp.getTime() - startTime) / (1000 * 60 * 60); // Hours from start
      const y = reading.indoorTemp;

      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared for confidence
    const avgY = sumY / n;
    let ssRes = 0, ssTot = 0;

    recentData.forEach((reading) => {
      const x = (reading.timestamp.getTime() - startTime) / (1000 * 60 * 60);
      const predicted = slope * x + intercept;
      const actual = reading.indoorTemp;

      ssRes += Math.pow(actual - predicted, 2);
      ssTot += Math.pow(actual - avgY, 2);
    });

    const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    return {
      direction: slope > 0.1 ? 'rising' : slope < -0.1 ? 'falling' : 'stable',
      rate: slope,
      confidence: Math.max(0, rSquared),
      significance: Math.abs(slope) > 0.5
        ? 'high'
        : Math.abs(slope) > 0.2
        ? 'medium'
        : 'low',
    };
  }

  /**
   * Calculate weather influence on indoor temperature
   */
  private calculateWeatherInfluence(
    currentOutdoorTemp?: number,
    hoursAhead: number = 1,
  ): number {
    if (!currentOutdoorTemp || this.temperatureHistory.length === 0) {
      return 0;
    }

    const lastIndoorTemp =
      this.temperatureHistory[this.temperatureHistory.length - 1].indoorTemp;
    const tempDifference = currentOutdoorTemp - lastIndoorTemp;

    // Weather influence decreases with good insulation and increases over time
    const influenceRate = 0.05; // 5% influence per hour
    const maxInfluence = 2.0; // Maximum 2°C influence

    const influence = Math.min(
      maxInfluence,
      tempDifference * influenceRate * hoursAhead * this.config.weatherWeight,
    );

    return influence;
  }

  /**
   * Calculate prediction confidence
   */
  private calculatePredictionConfidence(
    trend: TrendAnalysis,
    seasonal: number,
    weatherInfluence: number,
  ): number {
    let confidence = 0.5; // Base confidence

    // Add confidence based on trend analysis
    confidence += trend.confidence * 0.3;

    // Add confidence based on seasonal pattern strength
    const dailyPattern = this.seasonalPatterns.get('daily');
    if (dailyPattern) {
      confidence += dailyPattern.confidence * 0.2;
    }

    // Reduce confidence for extreme weather influence
    if (Math.abs(weatherInfluence) > 1.0) {
      confidence *= 0.8;
    }

    return Math.min(0.95, Math.max(0.1, confidence));
  }

  /**
   * Find similar energy usage conditions
   */
  private findSimilarEnergyConditions(
    mode: string,
    maxResults: number = 20,
  ): EnergyUsageData[] {
    return this.energyHistory
      .filter((data) => data.hvacMode === mode)
      .slice(-maxResults); // Get most recent similar conditions
  }

  /**
   * Get time-of-day energy factor
   */
  private getTimeOfDayEnergyFactor(hour: number): number {
    // Energy usage is typically higher during active hours
    if (hour >= 6 && hour <= 9) return 1.2; // Morning peak
    if (hour >= 17 && hour <= 21) return 1.3; // Evening peak
    if (hour >= 22 || hour <= 5) return 0.8; // Night low
    return 1.0; // Normal hours
  }

  /**
   * Calculate efficiency factor based on conditions
   */
  private calculateEfficiencyFactor(mode: string): number {
    // Simplified efficiency model
    // In reality, this would consider outdoor temperature, humidity, etc.

    switch (mode) {
      case 'heating':
        return 0.9; // Heating is generally less efficient
      case 'cooling':
        return 0.85; // Cooling efficiency varies with outdoor temp
      case 'idle':
        return 0.2; // Very low energy use
      case 'off':
        return 0.05; // Minimal energy use
      default:
        return 1.0;
    }
  }

  /**
   * Fallback temperature prediction when insufficient data
   */
  private fallbackTemperaturePrediction(
    hoursAhead: number,
    currentOutdoorTemp?: number,
  ): PredictionResult {
    const currentTemp = this.temperatureHistory.length > 0
      ? this.temperatureHistory[this.temperatureHistory.length - 1].indoorTemp
      : 21; // Default temperature

    // Simple assumption: temperature drifts slowly toward outdoor temperature
    let predictedValue = currentTemp;
    if (currentOutdoorTemp) {
      const drift = (currentOutdoorTemp - currentTemp) * 0.05 * hoursAhead;
      predictedValue += drift;
    }

    return {
      timestamp: new Date(Date.now() + hoursAhead * 60 * 60 * 1000),
      predictedValue,
      confidence: 0.3, // Low confidence for fallback
      upperBound: predictedValue + 2,
      lowerBound: predictedValue - 2,
      factors: ['fallback_logic', 'insufficient_data'],
    };
  }

  /**
   * Fallback energy prediction when insufficient data
   */
  private fallbackEnergyPrediction(
    hoursAhead: number,
    mode: string,
  ): PredictionResult {
    // Default energy usage estimates by mode
    const defaultUsage: Record<string, number> = {
      'heating': 2.5,
      'cooling': 2.0,
      'idle': 0.3,
      'off': 0.1,
      'auto': 1.5,
    };

    const predictedValue = defaultUsage[mode] || 1.5;

    return {
      timestamp: new Date(Date.now() + hoursAhead * 60 * 60 * 1000),
      predictedValue,
      confidence: 0.2, // Very low confidence for fallback
      upperBound: predictedValue * 1.5,
      lowerBound: predictedValue * 0.5,
      factors: ['default_estimates', 'insufficient_data'],
    };
  }

  /**
   * Prune old historical data to manage memory
   */
  private pruneHistoricalData(): void {
    const cutoffTime = new Date(
      Date.now() - this.config.maxHistoricalDays * 24 * 60 * 60 * 1000,
    );

    this.temperatureHistory = this.temperatureHistory.filter(
      (reading) => reading.timestamp >= cutoffTime,
    );

    this.energyHistory = this.energyHistory.filter(
      (data) => data.timestamp >= cutoffTime,
    );

    this.weatherHistory = this.weatherHistory.filter(
      (data) => data.timestamp >= cutoffTime,
    );
  }

  /**
   * Get analytics summary
   */
  getAnalyticsSummary(): {
    dataPoints: {
      temperature: number;
      energy: number;
      weather: number;
    };
    patterns: {
      daily: SeasonalPattern | undefined;
      weekly: SeasonalPattern | undefined;
    };
    predictionCapability: boolean;
  } {
    return {
      dataPoints: {
        temperature: this.temperatureHistory.length,
        energy: this.energyHistory.length,
        weather: this.weatherHistory.length,
      },
      patterns: {
        daily: this.seasonalPatterns.get('daily'),
        weekly: this.seasonalPatterns.get('weekly'),
      },
      predictionCapability: this.temperatureHistory.length >=
        this.config.minDataPointsForPrediction,
    };
  }
}
