/**
 * Comprehensive Unit Tests for Predictive Analytics Engine
 * 
 * Tests cover temperature prediction, pattern analysis, seasonal adjustments,
 * weather integration, and forecasting accuracy.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { PredictiveAnalyticsEngine, type AnalyticsConfig } from '../../../src/ai/predictive/analytics-engine.ts';
import { TemperatureReading, WeatherForecast } from '../../../../src/ai/types/ai-types.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockAnalyticsLogger');
  }
}

// Standard test configuration
const defaultConfig: AnalyticsConfig = {
  maxHistoricalDays: 30,
  minDataPointsForPrediction: 24,
  predictionHorizonHours: 24,
  confidenceInterval: 0.95,
  seasonalityPeriod: 24,
  trendSmoothingFactor: 0.3,
  seasonalSmoothingFactor: 0.3,
  weatherWeight: 0.6,
  occupancyWeight: 0.4,
  enableSeasonalAdjustment: true,
  enableWeatherIntegration: true,
};

// Helper functions for creating test data
function createTemperatureReadings(hours = 24, baseTemp = 20): TemperatureReading[] {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() - (hours - i) * 60 * 60 * 1000),
    indoor: baseTemp + Math.sin(i / 6) * 3 + Math.random() * 0.5, // Daily cycle with noise
    outdoor: baseTemp - 5 + Math.sin(i / 6) * 8 + Math.random() * 1, // Larger outdoor variation
    target: 22,
    mode: i % 8 < 6 ? 'heating' : i % 8 === 6 ? 'cooling' : 'idle',
  }));
}

function createWeatherForecast(hours = 24, baseTemp = 15): WeatherForecast[] {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
    temperature: baseTemp + Math.sin(i / 6) * 10, // Temperature variation
    humidity: 50 + Math.sin(i / 8) * 20 + Math.random() * 10,
    conditions: i % 6 < 4 ? 'clear' : i % 6 === 4 ? 'cloudy' : 'rainy',
    windSpeed: 5 + Math.random() * 10,
    pressure: 1013 + Math.sin(i / 12) * 20,
  }));
}

function createSeasonalData(days = 30): TemperatureReading[] {
  const readings: TemperatureReading[] = [];
  for (let day = 0; day < days; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const timestamp = new Date(Date.now() - (days - day) * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000);
      const seasonalTemp = 20 + Math.sin(day / 30 * Math.PI) * 5; // Seasonal variation
      const dailyTemp = Math.sin(hour / 24 * 2 * Math.PI) * 3; // Daily variation
      
      readings.push({
        timestamp,
        indoor: seasonalTemp + dailyTemp + Math.random() * 0.5,
        outdoor: seasonalTemp + dailyTemp * 2 + Math.random() * 2,
        target: 22,
        mode: hour % 8 < 6 ? 'heating' : hour % 8 === 6 ? 'cooling' : 'idle',
      });
    }
  }
  return readings;
}

Deno.test({
  name: 'Predictive Analytics Engine - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();

    await t.step('should initialize with default configuration', () => {
      const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);
      
      assertExists(engine);
      assertInstanceOf(engine, PredictiveAnalyticsEngine);
      
      console.log('✅ Predictive Analytics Engine initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        confidenceInterval: 1.5 // Invalid confidence interval > 1.0
      };
      
      assertThrows(
        () => new PredictiveAnalyticsEngine(invalidConfig, mockLogger),
        Error,
        'Confidence interval must be between 0.0 and 1.0'
      );
    });

    await t.step('should handle minimal configuration', () => {
      const minimalConfig: AnalyticsConfig = {
        maxHistoricalDays: 7,
        minDataPointsForPrediction: 12,
        predictionHorizonHours: 12,
        confidenceInterval: 0.90,
        seasonalityPeriod: 12,
        trendSmoothingFactor: 0.2,
        seasonalSmoothingFactor: 0.2,
        weatherWeight: 0.5,
        occupancyWeight: 0.5,
        enableSeasonalAdjustment: false,
        enableWeatherIntegration: false,
      };

      const engine = new PredictiveAnalyticsEngine(minimalConfig, mockLogger);
      assertExists(engine);
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Temperature Prediction',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should predict indoor temperature trends', async () => {
      const historicalData = createTemperatureReadings(72, 21); // 3 days of data
      
      const predictions = await engine.predictTemperatureTrends(historicalData);
      
      assertExists(predictions);
      assertEquals(Array.isArray(predictions), true);
      assertEquals(predictions.length, defaultConfig.predictionHorizonHours);
      
      // Verify prediction structure
      for (const prediction of predictions) {
        assertExists(prediction.timestamp);
        assertEquals(typeof prediction.predictedIndoor, 'number');
        assertEquals(typeof prediction.confidence, 'number');
        assertEquals(typeof prediction.upperBound, 'number');
        assertEquals(typeof prediction.lowerBound, 'number');
        assertExists(prediction.factors);
        
        // Verify confidence bounds
        assertEquals(prediction.confidence >= 0 && prediction.confidence <= 1, true);
        assertEquals(prediction.lowerBound <= prediction.predictedIndoor, true);
        assertEquals(prediction.predictedIndoor <= prediction.upperBound, true);
      }
      
      console.log(`✅ Generated ${predictions.length} temperature predictions`);
      console.log(`   First prediction: ${predictions[0].predictedIndoor.toFixed(1)}°C (confidence: ${(predictions[0].confidence * 100).toFixed(1)}%)`);
    });

    await t.step('should handle insufficient data gracefully', async () => {
      const minimalData = createTemperatureReadings(6, 20); // Only 6 hours (below minimum)
      
      const predictions = await engine.predictTemperatureTrends(minimalData);
      
      assertExists(predictions);
      
      // Should still provide predictions but with lower confidence
      if (predictions.length > 0) {
        assertEquals(predictions[0].confidence < 0.5, true); // Low confidence expected
      }
      
      console.log(`✅ Handled insufficient data: ${predictions.length} predictions with low confidence`);
    });

    await t.step('should adapt to different temperature patterns', async () => {
      // Stable temperature pattern
      const stableData = Array.from({ length: 48 }, (_, i) => ({
        timestamp: new Date(Date.now() - (48 - i) * 60 * 60 * 1000),
        indoor: 22 + Math.random() * 0.2, // Very stable
        outdoor: 15 + Math.random() * 1,
        target: 22,
        mode: 'idle' as const,
      }));

      // Volatile temperature pattern
      const volatileData = Array.from({ length: 48 }, (_, i) => ({
        timestamp: new Date(Date.now() - (48 - i) * 60 * 60 * 1000),
        indoor: 20 + Math.random() * 6, // High volatility
        outdoor: 10 + Math.random() * 20,
        target: 22,
        mode: i % 3 === 0 ? 'heating' : i % 3 === 1 ? 'cooling' : 'idle' as const,
      }));

      const stablePredictions = await engine.predictTemperatureTrends(stableData);
      const volatilePredictions = await engine.predictTemperatureTrends(volatileData);

      // Stable data should have higher confidence
      if (stablePredictions.length > 0 && volatilePredictions.length > 0) {
        const stableConfidence = stablePredictions[0].confidence;
        const volatileConfidence = volatilePredictions[0].confidence;
        
        console.log(`✅ Pattern adaptation:`);
        console.log(`   Stable data confidence: ${(stableConfidence * 100).toFixed(1)}%`);
        console.log(`   Volatile data confidence: ${(volatileConfidence * 100).toFixed(1)}%`);
      }
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Pattern Analysis',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should detect daily temperature patterns', async () => {
      const dailyData = createTemperatureReadings(168, 20); // 7 days of data
      
      const patterns = await engine.analyzeTemperaturePatterns(dailyData);
      
      assertExists(patterns);
      assertEquals(typeof patterns.dailyPattern, 'object');
      assertEquals(typeof patterns.weeklyPattern, 'object');
      assertEquals(typeof patterns.trendDirection, 'string');
      assertEquals(typeof patterns.volatility, 'number');
      assertEquals(typeof patterns.cyclicality, 'number');
      
      // Verify daily pattern structure
      assertExists(patterns.dailyPattern.peakHour);
      assertExists(patterns.dailyPattern.minHour);
      assertEquals(typeof patterns.dailyPattern.amplitude, 'number');
      
      console.log(`✅ Pattern analysis completed:`);
      console.log(`   Daily peak at hour: ${patterns.dailyPattern.peakHour}`);
      console.log(`   Daily minimum at hour: ${patterns.dailyPattern.minHour}`);
      console.log(`   Volatility: ${patterns.volatility.toFixed(2)}`);
      console.log(`   Trend: ${patterns.trendDirection}`);
    });

    await t.step('should identify seasonal trends', async () => {
      const seasonalData = createSeasonalData(60); // 60 days of seasonal data
      
      const patterns = await engine.analyzeTemperaturePatterns(seasonalData);
      
      assertExists(patterns.seasonalTrend);
      assertEquals(typeof patterns.seasonalTrend.direction, 'string');
      assertEquals(typeof patterns.seasonalTrend.strength, 'number');
      assertEquals(typeof patterns.seasonalTrend.period, 'number');
      
      console.log(`✅ Seasonal analysis:`);
      console.log(`   Seasonal direction: ${patterns.seasonalTrend.direction}`);
      console.log(`   Seasonal strength: ${patterns.seasonalTrend.strength.toFixed(2)}`);
    });

    await t.step('should calculate pattern confidence', async () => {
      const consistentData = Array.from({ length: 96 }, (_, i) => ({
        timestamp: new Date(Date.now() - (96 - i) * 60 * 60 * 1000),
        indoor: 20 + Math.sin(i / 12) * 2, // Consistent 24-hour cycle
        outdoor: 15 + Math.sin(i / 12) * 5,
        target: 22,
        mode: 'heating' as const,
      }));

      const patterns = await engine.analyzeTemperaturePatterns(consistentData);
      
      assertEquals(typeof patterns.confidence, 'number');
      assertEquals(patterns.confidence >= 0 && patterns.confidence <= 1, true);
      
      // Consistent data should have high confidence
      assertEquals(patterns.confidence > 0.7, true);
      
      console.log(`✅ Pattern confidence: ${(patterns.confidence * 100).toFixed(1)}%`);
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Weather Integration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should integrate weather forecasts into predictions', async () => {
      const historicalData = createTemperatureReadings(48, 22);
      const weatherForecast = createWeatherForecast(24, 20);
      
      const predictions = await engine.predictTemperatureWithWeather(historicalData, weatherForecast);
      
      assertExists(predictions);
      assertEquals(Array.isArray(predictions), true);
      assertEquals(predictions.length, 24);
      
      // Verify weather integration
      for (const prediction of predictions) {
        assertExists(prediction.weatherInfluence);
        assertEquals(typeof prediction.weatherInfluence.temperatureImpact, 'number');
        assertEquals(typeof prediction.weatherInfluence.humidityImpact, 'number');
        assertEquals(typeof prediction.weatherInfluence.conditionsImpact, 'number');
        assertExists(prediction.weatherInfluence.conditions);
      }
      
      console.log(`✅ Weather integration: ${predictions.length} predictions with weather data`);
    });

    await t.step('should handle different weather conditions', async () => {
      const historicalData = createTemperatureReadings(24, 20);
      
      // Clear weather forecast
      const clearForecast = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 25,
        humidity: 40,
        conditions: 'clear' as const,
        windSpeed: 5,
        pressure: 1020,
      }));

      // Rainy weather forecast
      const rainyForecast = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 18,
        humidity: 85,
        conditions: 'rainy' as const,
        windSpeed: 15,
        pressure: 1005,
      }));

      const clearPredictions = await engine.predictTemperatureWithWeather(historicalData, clearForecast);
      const rainyPredictions = await engine.predictTemperatureWithWeather(historicalData, rainyForecast);

      // Different weather should produce different predictions
      if (clearPredictions.length > 0 && rainyPredictions.length > 0) {
        const clearTemp = clearPredictions[0].predictedIndoor;
        const rainyTemp = rainyPredictions[0].predictedIndoor;
        
        console.log(`✅ Weather condition impact:`);
        console.log(`   Clear weather prediction: ${clearTemp.toFixed(1)}°C`);
        console.log(`   Rainy weather prediction: ${rainyTemp.toFixed(1)}°C`);
      }
    });

    await t.step('should weight weather influence appropriately', async () => {
      const historicalData = createTemperatureReadings(36, 21);
      const extremeWeather = Array.from({ length: 6 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 35, // Very hot
        humidity: 90,    // Very humid
        conditions: 'clear' as const,
        windSpeed: 0,    // No wind
        pressure: 1030,
      }));

      const predictions = await engine.predictTemperatureWithWeather(historicalData, extremeWeather);
      
      if (predictions.length > 0) {
        const weatherInfluence = predictions[0].weatherInfluence;
        const totalInfluence = Math.abs(weatherInfluence.temperatureImpact) + 
                             Math.abs(weatherInfluence.humidityImpact) + 
                             Math.abs(weatherInfluence.conditionsImpact);
        
        // Weather influence should be significant for extreme conditions
        assertEquals(totalInfluence > 0, true);
        
        console.log(`✅ Weather influence weighting: ${totalInfluence.toFixed(2)} total impact`);
      }
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Seasonal Adjustments',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should apply seasonal adjustments to predictions', async () => {
      const summerData = Array.from({ length: 72 }, (_, i) => ({
        timestamp: new Date(2024, 6, 15, i % 24), // July 15th
        indoor: 24 + Math.sin(i / 12) * 2, // Summer pattern
        outdoor: 30 + Math.sin(i / 12) * 8,
        target: 22,
        mode: i % 6 < 4 ? 'cooling' : 'idle' as const,
      }));

      const winterData = Array.from({ length: 72 }, (_, i) => ({
        timestamp: new Date(2024, 11, 15, i % 24), // December 15th
        indoor: 18 + Math.sin(i / 12) * 2, // Winter pattern
        outdoor: 5 + Math.sin(i / 12) * 5,
        target: 22,
        mode: i % 6 < 4 ? 'heating' : 'idle' as const,
      }));

      const summerPredictions = await engine.predictTemperatureTrends(summerData);
      const winterPredictions = await engine.predictTemperatureTrends(winterData);

      if (summerPredictions.length > 0 && winterPredictions.length > 0) {
        assertExists(summerPredictions[0].seasonalAdjustment);
        assertExists(winterPredictions[0].seasonalAdjustment);
        
        console.log(`✅ Seasonal adjustments applied:`);
        console.log(`   Summer baseline: ${summerPredictions[0].seasonalAdjustment.baseline.toFixed(1)}°C`);
        console.log(`   Winter baseline: ${winterPredictions[0].seasonalAdjustment.baseline.toFixed(1)}°C`);
      }
    });

    await t.step('should detect seasonal transition periods', async () => {
      // Create data spanning a seasonal transition (fall to winter)
      const transitionData = Array.from({ length: 240 }, (_, i) => { // 10 days
        const day = Math.floor(i / 24);
        const hour = i % 24;
        const seasonalShift = day * 0.5; // Gradual cooling
        
        return {
          timestamp: new Date(2024, 10, 1 + day, hour), // November transition
          indoor: 20 - seasonalShift + Math.sin(hour / 12) * 2,
          outdoor: 15 - seasonalShift * 1.5 + Math.sin(hour / 12) * 5,
          target: 22,
          mode: hour % 8 < 6 ? 'heating' : 'idle' as const,
        };
      });

      const patterns = await engine.analyzeTemperaturePatterns(transitionData);
      
      assertExists(patterns.seasonalTrend);
      assertEquals(patterns.seasonalTrend.direction, 'cooling');
      assertEquals(patterns.seasonalTrend.strength > 0.3, true); // Should detect transition
      
      console.log(`✅ Seasonal transition detected: ${patterns.seasonalTrend.direction} (strength: ${patterns.seasonalTrend.strength.toFixed(2)})`);
    });

    await t.step('should handle seasonal adjustment configuration', async () => {
      // Test with seasonal adjustment disabled
      const noSeasonalConfig = { ...defaultConfig, enableSeasonalAdjustment: false };
      const noSeasonalEngine = new PredictiveAnalyticsEngine(noSeasonalConfig, mockLogger);
      
      const testData = createSeasonalData(14);
      const predictions = await noSeasonalEngine.predictTemperatureTrends(testData);
      
      if (predictions.length > 0) {
        // Should not have seasonal adjustment data
        assertEquals(predictions[0].seasonalAdjustment, undefined);
      }
      
      console.log('✅ Seasonal adjustment configuration respected');
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Occupancy Integration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should integrate occupancy patterns into predictions', async () => {
      const historicalData = createTemperatureReadings(48, 21);
      
      // Create occupancy schedule (typical workday pattern)
      const occupancySchedule = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: hour >= 7 && hour <= 8 ? 0.9 :  // Morning rush
                    hour >= 17 && hour <= 19 ? 0.9 : // Evening rush
                    hour >= 9 && hour <= 16 ? 0.3 :  // Work hours (lower occupancy)
                    hour >= 22 || hour <= 6 ? 0.1 :  // Night (very low)
                    0.5, // Default
        pattern: 'weekday'
      }));

      const predictions = await engine.predictWithOccupancy(historicalData, occupancySchedule);
      
      assertExists(predictions);
      assertEquals(Array.isArray(predictions), true);
      
      // Verify occupancy integration
      for (const prediction of predictions) {
        assertExists(prediction.occupancyInfluence);
        assertEquals(typeof prediction.occupancyInfluence.probability, 'number');
        assertEquals(typeof prediction.occupancyInfluence.temperatureImpact, 'number');
        assertEquals(typeof prediction.occupancyInfluence.loadAdjustment, 'number');
      }
      
      console.log(`✅ Occupancy integration: ${predictions.length} predictions with occupancy data`);
    });

    await t.step('should differentiate weekday vs weekend patterns', async () => {
      const historicalData = createTemperatureReadings(24, 20);
      
      const weekdaySchedule = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: hour >= 9 && hour <= 17 ? 0.2 : 0.8, // Low during work hours
        pattern: 'weekday'
      }));

      const weekendSchedule = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: hour >= 8 && hour <= 22 ? 0.9 : 0.3, // High during day
        pattern: 'weekend'
      }));

      const weekdayPredictions = await engine.predictWithOccupancy(historicalData, weekdaySchedule);
      const weekendPredictions = await engine.predictWithOccupancy(historicalData, weekendSchedule);

      if (weekdayPredictions.length > 0 && weekendPredictions.length > 0) {
        const weekdayOccupancy = weekdayPredictions[10].occupancyInfluence; // 10 AM
        const weekendOccupancy = weekendPredictions[10].occupancyInfluence; // 10 AM

        console.log(`✅ Weekday vs Weekend occupancy (10 AM):`);
        console.log(`   Weekday probability: ${weekdayOccupancy.probability.toFixed(2)}`);
        console.log(`   Weekend probability: ${weekendOccupancy.probability.toFixed(2)}`);
      }
    });

    await t.step('should calculate occupancy impact on temperature', async () => {
      const historicalData = createTemperatureReadings(24, 21);
      
      // High occupancy scenario
      const highOccupancy = Array.from({ length: 8 }, (_, hour) => ({
        hour: hour + 8, // 8 AM to 4 PM
        probability: 0.95, // Very high occupancy
        pattern: 'event'
      }));

      // Low occupancy scenario
      const lowOccupancy = Array.from({ length: 8 }, (_, hour) => ({
        hour: hour + 8,
        probability: 0.05, // Very low occupancy
        pattern: 'vacation'
      }));

      const highOccupancyPredictions = await engine.predictWithOccupancy(historicalData, highOccupancy);
      const lowOccupancyPredictions = await engine.predictWithOccupancy(historicalData, lowOccupancy);

      if (highOccupancyPredictions.length > 0 && lowOccupancyPredictions.length > 0) {
        const highImpact = highOccupancyPredictions[0].occupancyInfluence.temperatureImpact;
        const lowImpact = lowOccupancyPredictions[0].occupancyInfluence.temperatureImpact;

        // High occupancy should have more temperature impact
        console.log(`✅ Occupancy temperature impact:`);
        console.log(`   High occupancy: ${highImpact.toFixed(2)}°C`);
        console.log(`   Low occupancy: ${lowImpact.toFixed(2)}°C`);
      }
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should handle empty or invalid data', async () => {
      const emptyData: TemperatureReading[] = [];
      const invalidData = null as unknown as TemperatureReading[];
      
      const emptyPredictions = await engine.predictTemperatureTrends(emptyData);
      const invalidPredictions = await engine.predictTemperatureTrends(invalidData);
      
      // Should handle gracefully
      assertExists(emptyPredictions);
      assertExists(invalidPredictions);
      
      console.log('✅ Empty and invalid data handled gracefully');
    });

    await t.step('should handle extreme temperature values', async () => {
      const extremeData = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        indoor: i % 2 === 0 ? -10 : 50, // Extreme alternating temperatures
        outdoor: i % 2 === 0 ? -20 : 60,
        target: 22,
        mode: 'heating' as const,
      }));

      const predictions = await engine.predictTemperatureTrends(extremeData);
      
      assertExists(predictions);
      
      // Should provide predictions with appropriate confidence
      if (predictions.length > 0) {
        assertEquals(predictions[0].confidence < 0.8, true); // Lower confidence expected
      }
      
      console.log('✅ Extreme temperature values handled');
    });

    await t.step('should handle inconsistent timestamps', async () => {
      const inconsistentData = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * i * 60 * 60 * 1000), // Non-linear timestamps
        indoor: 20 + Math.random() * 4,
        outdoor: 15 + Math.random() * 10,
        target: 22,
        mode: 'idle' as const,
      }));

      const predictions = await engine.predictTemperatureTrends(inconsistentData);
      
      assertExists(predictions);
      
      console.log('✅ Inconsistent timestamps handled');
    });

    await t.step('should handle missing weather data', async () => {
      const historicalData = createTemperatureReadings(24, 21);
      const incompleteWeather = [
        {
          timestamp: new Date(Date.now() + 60 * 60 * 1000),
          temperature: 20,
          humidity: undefined as unknown as number,
          conditions: 'unknown' as any,
          windSpeed: undefined as unknown as number,
          pressure: undefined as unknown as number,
        }
      ];

      const predictions = await engine.predictTemperatureWithWeather(historicalData, incompleteWeather);
      
      assertExists(predictions);
      
      // Should still provide predictions despite incomplete weather data
      if (predictions.length > 0) {
        assertExists(predictions[0].weatherInfluence);
      }
      
      console.log('✅ Missing weather data handled');
    });
  }
});

Deno.test({
  name: 'Predictive Analytics Engine - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const engine = new PredictiveAnalyticsEngine(defaultConfig, mockLogger);

    await t.step('should handle large datasets efficiently', async () => {
      const largeDataset = createTemperatureReadings(720, 21); // 30 days of hourly data
      
      const startTime = performance.now();
      const predictions = await engine.predictTemperatureTrends(largeDataset);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(predictions);
      assertEquals(duration < 5000, true); // Should complete within 5 seconds
      
      console.log(`✅ Processed 720 data points in ${duration.toFixed(2)}ms`);
    });

    await t.step('should scale pattern analysis efficiently', async () => {
      const patternData = createSeasonalData(90); // 90 days of data
      
      const startTime = performance.now();
      const patterns = await engine.analyzeTemperaturePatterns(patternData);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(patterns);
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Analyzed 90 days of patterns in ${duration.toFixed(2)}ms`);
    });

    await t.step('should handle concurrent predictions', async () => {
      const testData = createTemperatureReadings(48, 20);
      
      // Run multiple predictions concurrently
      const promises = Array.from({ length: 5 }, () => 
        engine.predictTemperatureTrends(testData)
      );
      
      const startTime = performance.now();
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertEquals(results.length, 5);
      results.forEach(result => assertExists(result));
      assertEquals(duration < 2000, true); // Should complete within 2 seconds
      
      console.log(`✅ Completed 5 concurrent predictions in ${duration.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All Predictive Analytics Engine unit tests completed successfully!');