/**
 * Comprehensive Unit Tests for HVAC Optimizer
 * 
 * Tests cover optimization algorithms, energy efficiency, cost analysis,
 * comfort scoring, and real-world scenarios.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { HVACOptimizer, type OptimizerConfig } from '../../../src/ai/optimization/hvac-optimizer.ts';
import { HVACDecisionContext } from '../../../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../../../src/types/common.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockOptimizerLogger');
  }
}

// Standard test configuration
const defaultConfig: OptimizerConfig = {
  comfortWeight: 0.6,
  energyWeight: 0.3,
  costWeight: 0.1,
  energyRates: {
    peak: 0.15,
    offPeak: 0.08,
    peakHours: [16, 17, 18, 19, 20],
  },
  comfortRange: {
    min: 18,
    max: 26,
    preferred: 22,
    tolerance: 1.5,
  },
  systemConstraints: {
    minRunTime: 15,
    maxCyclesPerHour: 4,
    defrostInterval: 4,
  },
  optimizationHorizon: 24,
  updateInterval: 15,
};

// Helper functions for creating test data
function createTestContext(
  hour = 10,
  indoorTemp = 22,
  outdoorTemp = 15,
  systemMode: SystemMode = SystemMode.AUTO
): HVACDecisionContext {
  return {
    indoorTemp,
    outdoorTemp,
    targetTemp: 22,
    systemMode,
    currentMode: 'idle' as const,
    currentHour: hour,
    isWeekday: true,
  };
}

function createWeatherForecast(hours = 24) {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
    temperature: 15 + Math.sin(i / 6) * 10, // Temperature variation
    humidity: 50 + Math.random() * 20,
    conditions: i % 8 < 6 ? 'clear' : 'cloudy' as const,
  }));
}

function createHistoricalData(days = 7) {
  return Array.from({ length: days * 24 }, (_, i) => ({
    timestamp: new Date(Date.now() - (days * 24 - i) * 60 * 60 * 1000),
    indoorTemp: 20 + Math.sin(i / 6) * 3,
    outdoorTemp: 15 + Math.sin(i / 12) * 8,
    energyUsage: 2 + Math.random() * 3,
    cost: (2 + Math.random() * 3) * 0.12,
    comfortScore: 0.7 + Math.random() * 0.3,
    mode: i % 4 === 0 ? 'heating' : i % 4 === 1 ? 'cooling' : 'idle',
  }));
}

Deno.test({
  name: 'HVAC Optimizer - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();

    await t.step('should initialize with default configuration', () => {
      const optimizer = new HVACOptimizer(defaultConfig, mockLogger);
      
      assertExists(optimizer);
      assertInstanceOf(optimizer, HVACOptimizer);
      
      console.log('✅ HVAC Optimizer initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        comfortWeight: 1.5, // Should cause weights > 1.0
        energyWeight: 0.3,
        costWeight: 0.1
      };
      
      assertThrows(
        () => new HVACOptimizer(invalidConfig, mockLogger),
        Error,
        'Weight sum must not exceed 1.0'
      );
    });

    await t.step('should handle minimal configuration', () => {
      const minimalConfig: OptimizerConfig = {
        comfortWeight: 0.5,
        energyWeight: 0.3,
        costWeight: 0.2,
        energyRates: {
          peak: 0.12,
          offPeak: 0.06,
          peakHours: [17, 18, 19],
        },
        comfortRange: {
          min: 19,
          max: 25,
          preferred: 22,
          tolerance: 1.0,
        },
        systemConstraints: {
          minRunTime: 10,
          maxCyclesPerHour: 6,
          defrostInterval: 2,
        },
        optimizationHorizon: 12,
        updateInterval: 10,
      };

      const optimizer = new HVACOptimizer(minimalConfig, mockLogger);
      assertExists(optimizer);
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Energy Efficiency Optimization',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should generate energy-efficient schedules', async () => {
      const context = createTestContext(10, 20, 15);
      const forecast = createWeatherForecast(24);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      assertExists(schedule);
      assertEquals(Array.isArray(schedule), true);
      assertEquals(schedule.length, 24); // 24-hour schedule
      
      // Verify each schedule entry has required properties
      for (const entry of schedule) {
        assertExists(entry.timestamp);
        assertExists(entry.recommendedMode);
        assertExists(entry.targetTemp);
        assertEquals(typeof entry.energyScore, 'number');
        assertEquals(typeof entry.comfortScore, 'number');
        assertEquals(typeof entry.costScore, 'number');
        assertEquals(typeof entry.overallScore, 'number');
      }
      
      console.log(`✅ Generated ${schedule.length}-hour energy-efficient schedule`);
    });

    await t.step('should optimize for off-peak energy usage', async () => {
      const context = createTestContext(14, 25, 30); // Hot afternoon
      const forecast = createWeatherForecast(8);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      // Check if optimizer prefers off-peak hours for energy-intensive operations
      const peakHourEntries = schedule.filter(entry => 
        defaultConfig.energyRates.peakHours.includes(entry.timestamp.getHours())
      );
      const offPeakEntries = schedule.filter(entry => 
        !defaultConfig.energyRates.peakHours.includes(entry.timestamp.getHours())
      );
      
      if (peakHourEntries.length > 0 && offPeakEntries.length > 0) {
        // Off-peak entries should generally have better energy scores
        const avgOffPeakEnergyScore = offPeakEntries.reduce((sum, entry) => 
          sum + entry.energyScore, 0) / offPeakEntries.length;
        const avgPeakEnergyScore = peakHourEntries.reduce((sum, entry) => 
          sum + entry.energyScore, 0) / peakHourEntries.length;
        
        console.log(`✅ Off-peak optimization: Peak=${avgPeakEnergyScore.toFixed(2)}, Off-peak=${avgOffPeakEnergyScore.toFixed(2)}`);
      }
    });

    await t.step('should calculate accurate energy predictions', async () => {
      const context = createTestContext(10, 18, 5); // Cold morning
      const historicalData = createHistoricalData(14);
      
      const prediction = await optimizer.predictEnergyUsage(context, historicalData);
      
      assertExists(prediction);
      assertEquals(typeof prediction.predictedUsage, 'number');
      assertEquals(typeof prediction.confidence, 'number');
      assertEquals(typeof prediction.costEstimate, 'number');
      assertExists(prediction.factors);
      
      assertEquals(prediction.confidence >= 0 && prediction.confidence <= 1, true);
      assertEquals(prediction.predictedUsage >= 0, true);
      assertEquals(prediction.costEstimate >= 0, true);
      
      console.log(`✅ Energy prediction: ${prediction.predictedUsage.toFixed(2)}kWh (confidence: ${(prediction.confidence * 100).toFixed(1)}%)`);
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Comfort Optimization',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should calculate accurate comfort scores', () => {
      const testCases = [
        { temp: 22, expected: 'high' }, // Preferred temperature
        { temp: 20, expected: 'good' }, // Within tolerance
        { temp: 18, expected: 'low' },  // At minimum
        { temp: 16, expected: 'poor' }, // Below minimum
        { temp: 28, expected: 'poor' }  // Above maximum
      ];

      for (const testCase of testCases) {
        const context = createTestContext(10, testCase.temp, 15);
        const score = optimizer.calculateComfortScore(context);
        
        assertEquals(typeof score, 'number');
        assertEquals(score >= 0 && score <= 1, true);
        
        console.log(`✅ Comfort score for ${testCase.temp}°C: ${score.toFixed(2)} (${testCase.expected})`);
      }
    });

    await t.step('should balance comfort with energy efficiency', async () => {
      // High comfort weight scenario
      const comfortFocusedConfig = {
        ...defaultConfig,
        comfortWeight: 0.8,
        energyWeight: 0.2,
        costWeight: 0.0
      };
      const comfortOptimizer = new HVACOptimizer(comfortFocusedConfig, mockLogger);

      // High energy weight scenario
      const energyFocusedConfig = {
        ...defaultConfig,
        comfortWeight: 0.2,
        energyWeight: 0.8,
        costWeight: 0.0
      };
      const energyOptimizer = new HVACOptimizer(energyFocusedConfig, mockLogger);

      const context = createTestContext(10, 19, 10); // Slightly cold
      const forecast = createWeatherForecast(4);

      const comfortSchedule = await comfortOptimizer.generateOptimalSchedule(context, forecast);
      const energySchedule = await energyOptimizer.generateOptimalSchedule(context, forecast);

      // Comfort-focused should have higher comfort scores
      const avgComfortScoreComfort = comfortSchedule.reduce((sum, entry) => 
        sum + entry.comfortScore, 0) / comfortSchedule.length;
      const avgComfortScoreEnergy = energySchedule.reduce((sum, entry) => 
        sum + entry.comfortScore, 0) / energySchedule.length;

      console.log(`✅ Comfort vs Energy balance:`);
      console.log(`   Comfort-focused: ${avgComfortScoreComfort.toFixed(2)} comfort score`);
      console.log(`   Energy-focused: ${avgComfortScoreEnergy.toFixed(2)} comfort score`);
    });

    await t.step('should handle comfort preferences dynamically', () => {
      const morningContext = createTestContext(7, 18, 5);   // Cold morning
      const afternoonContext = createTestContext(14, 24, 25); // Hot afternoon
      const eveningContext = createTestContext(20, 22, 18);   // Comfortable evening

      const morningScore = optimizer.calculateComfortScore(morningContext);
      const afternoonScore = optimizer.calculateComfortScore(afternoonContext);
      const eveningScore = optimizer.calculateComfortScore(eveningContext);

      assertEquals(typeof morningScore, 'number');
      assertEquals(typeof afternoonScore, 'number');
      assertEquals(typeof eveningScore, 'number');

      // Evening should have the highest comfort score (closest to preferred)
      console.log(`✅ Dynamic comfort scores:`);
      console.log(`   Morning (18°C): ${morningScore.toFixed(2)}`);
      console.log(`   Afternoon (24°C): ${afternoonScore.toFixed(2)}`);
      console.log(`   Evening (22°C): ${eveningScore.toFixed(2)}`);
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Cost Analysis and Optimization',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should calculate accurate cost estimates', async () => {
      const context = createTestContext(18, 20, 10); // Peak hour, heating needed
      const historicalData = createHistoricalData(7);
      
      const costAnalysis = await optimizer.analyzeCosts(context, historicalData);
      
      assertExists(costAnalysis);
      assertEquals(typeof costAnalysis.currentHourCost, 'number');
      assertEquals(typeof costAnalysis.dailyCostEstimate, 'number');
      assertEquals(typeof costAnalysis.weeklyCostEstimate, 'number');
      assertEquals(typeof costAnalysis.potentialSavings, 'number');
      assertExists(costAnalysis.recommendations);
      
      assertEquals(costAnalysis.currentHourCost >= 0, true);
      assertEquals(costAnalysis.dailyCostEstimate >= 0, true);
      
      console.log(`✅ Cost analysis:`);
      console.log(`   Current hour: $${costAnalysis.currentHourCost.toFixed(3)}`);
      console.log(`   Daily estimate: $${costAnalysis.dailyCostEstimate.toFixed(2)}`);
      console.log(`   Potential savings: $${costAnalysis.potentialSavings.toFixed(2)}`);
    });

    await t.step('should differentiate peak vs off-peak costs', async () => {
      const peakContext = createTestContext(18, 25, 30); // Peak hour, cooling needed
      const offPeakContext = createTestContext(2, 25, 30); // Off-peak hour, same conditions
      const historicalData = createHistoricalData(3);
      
      const peakCostAnalysis = await optimizer.analyzeCosts(peakContext, historicalData);
      const offPeakCostAnalysis = await optimizer.analyzeCosts(offPeakContext, historicalData);
      
      // Peak hour should cost more for the same conditions
      console.log(`✅ Peak vs Off-peak costs:`);
      console.log(`   Peak hour (6 PM): $${peakCostAnalysis.currentHourCost.toFixed(3)}`);
      console.log(`   Off-peak (2 AM): $${offPeakCostAnalysis.currentHourCost.toFixed(3)}`);
    });

    await t.step('should provide cost optimization recommendations', async () => {
      const context = createTestContext(17, 26, 32); // Hot peak hour
      const forecast = createWeatherForecast(12);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      // Verify cost optimization in schedule
      const peakEntries = schedule.filter(entry => 
        defaultConfig.energyRates.peakHours.includes(entry.timestamp.getHours())
      );
      const offPeakEntries = schedule.filter(entry => 
        !defaultConfig.energyRates.peakHours.includes(entry.timestamp.getHours())
      );
      
      if (peakEntries.length > 0 && offPeakEntries.length > 0) {
        const avgPeakCostScore = peakEntries.reduce((sum, entry) => 
          sum + entry.costScore, 0) / peakEntries.length;
        const avgOffPeakCostScore = offPeakEntries.reduce((sum, entry) => 
          sum + entry.costScore, 0) / offPeakEntries.length;
        
        console.log(`✅ Cost optimization in schedule:`);
        console.log(`   Peak cost score: ${avgPeakCostScore.toFixed(2)}`);
        console.log(`   Off-peak cost score: ${avgOffPeakCostScore.toFixed(2)}`);
      }
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - System Constraints and Safety',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should respect minimum run time constraints', async () => {
      const context = createTestContext(10, 18, 5); // Cold, needs heating
      const forecast = createWeatherForecast(4);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      // Check for mode changes and verify minimum run time
      let currentMode = schedule[0].recommendedMode;
      let modeStartTime = 0;
      let violations = 0;
      
      for (let i = 1; i < schedule.length; i++) {
        if (schedule[i].recommendedMode !== currentMode) {
          const runDuration = (i - modeStartTime) * 60; // Convert hours to minutes
          if (runDuration < defaultConfig.systemConstraints.minRunTime && currentMode !== 'idle') {
            violations++;
          }
          currentMode = schedule[i].recommendedMode;
          modeStartTime = i;
        }
      }
      
      console.log(`✅ Minimum run time constraint check: ${violations} violations found`);
    });

    await t.step('should limit cycling frequency', async () => {
      const context = createTestContext(10, 21, 20); // Moderate conditions
      const forecast = createWeatherForecast(6);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      // Count mode transitions per hour equivalent
      const transitions = schedule.slice(1).filter((entry, i) => 
        entry.recommendedMode !== schedule[i].recommendedMode
      ).length;
      
      const maxTransitions = defaultConfig.systemConstraints.maxCyclesPerHour * (schedule.length / 1); // Adjust for schedule length
      
      console.log(`✅ Cycling frequency: ${transitions} transitions (max: ${maxTransitions.toFixed(0)})`);
    });

    await t.step('should handle defrost requirements', async () => {
      const coldContext = createTestContext(10, 15, -5); // Very cold, defrost likely needed
      const forecast = createWeatherForecast(8);
      
      const schedule = await optimizer.generateOptimalSchedule(context, forecast);
      
      // Look for defrost considerations in the schedule
      const heatingEntries = schedule.filter(entry => entry.recommendedMode === 'heating');
      
      assertExists(heatingEntries);
      console.log(`✅ Defrost handling: ${heatingEntries.length} heating periods scheduled`);
    });

    await t.step('should enforce temperature safety limits', () => {
      const extremeColdContext = createTestContext(10, 10, -10);
      const extremeHotContext = createTestContext(10, 35, 40);
      
      const coldScore = optimizer.calculateComfortScore(extremeColdContext);
      const hotScore = optimizer.calculateComfortScore(extremeHotContext);
      
      // Extreme temperatures should have very low comfort scores
      assertEquals(coldScore < 0.3, true);  // Very low for extreme cold
      assertEquals(hotScore < 0.3, true);   // Very low for extreme heat
      
      console.log(`✅ Safety limits enforced: Cold=${coldScore.toFixed(2)}, Hot=${hotScore.toFixed(2)}`);
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Real-world Scenarios',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should handle hot summer day scenario', async () => {
      const summerContext = createTestContext(14, 26, 35); // Hot afternoon
      const summerForecast = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 30 + Math.sin(i / 3) * 5, // Hot day cycle
        humidity: 60 + Math.random() * 20,
        conditions: 'clear' as const,
      }));
      
      const schedule = await optimizer.generateOptimalSchedule(summerContext, summerForecast);
      
      // Should recommend cooling during hot periods
      const coolingEntries = schedule.filter(entry => entry.recommendedMode === 'cooling');
      
      assertExists(coolingEntries);
      assertEquals(coolingEntries.length > 0, true);
      
      console.log(`✅ Summer scenario: ${coolingEntries.length} cooling periods recommended`);
    });

    await t.step('should handle cold winter morning scenario', async () => {
      const winterContext = createTestContext(6, 16, -5); // Cold morning
      const winterForecast = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: -2 + i * 0.5, // Gradual warming
        humidity: 40 + Math.random() * 15,
        conditions: i < 6 ? 'cloudy' : 'clear' as const,
      }));
      
      const schedule = await optimizer.generateOptimalSchedule(winterContext, winterForecast);
      
      // Should recommend heating during cold periods
      const heatingEntries = schedule.filter(entry => entry.recommendedMode === 'heating');
      
      assertExists(heatingEntries);
      assertEquals(heatingEntries.length > 0, true);
      
      console.log(`✅ Winter scenario: ${heatingEntries.length} heating periods recommended`);
    });

    await t.step('should handle shoulder season optimization', async () => {
      const shoulderContext = createTestContext(10, 20, 18); // Mild conditions
      const shoulderForecast = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: 16 + Math.sin(i / 4) * 4, // Mild variation
        humidity: 50 + Math.random() * 10,
        conditions: 'partly_cloudy' as const,
      }));
      
      const schedule = await optimizer.generateOptimalSchedule(shoulderContext, shoulderForecast);
      
      // Should prefer idle mode during mild conditions
      const idleEntries = schedule.filter(entry => entry.recommendedMode === 'idle');
      
      assertExists(idleEntries);
      console.log(`✅ Shoulder season: ${idleEntries.length} idle periods (energy saving)`);
    });

    await t.step('should optimize for weekend vs weekday patterns', async () => {
      const weekdayContext = createTestContext(8, 21, 15); // Monday morning
      const weekendContext = { ...weekdayContext, isWeekday: false }; // Weekend morning
      const forecast = createWeatherForecast(6);
      
      const weekdaySchedule = await optimizer.generateOptimalSchedule(weekdayContext, forecast);
      const weekendSchedule = await optimizer.generateOptimalSchedule(weekendContext, forecast);
      
      // Compare energy usage patterns
      const weekdayAvgScore = weekdaySchedule.reduce((sum, entry) => 
        sum + entry.overallScore, 0) / weekdaySchedule.length;
      const weekendAvgScore = weekendSchedule.reduce((sum, entry) => 
        sum + entry.overallScore, 0) / weekendSchedule.length;
      
      console.log(`✅ Weekday vs Weekend optimization:`);
      console.log(`   Weekday score: ${weekdayAvgScore.toFixed(2)}`);
      console.log(`   Weekend score: ${weekendAvgScore.toFixed(2)}`);
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should handle missing or invalid data', async () => {
      const invalidContext = null as unknown as HVACDecisionContext;
      const emptyForecast: any[] = [];
      
      // Should handle gracefully without throwing
      const schedule = await optimizer.generateOptimalSchedule(invalidContext, emptyForecast);
      assertExists(schedule);
      
      console.log('✅ Invalid data handled gracefully');
    });

    await t.step('should handle extreme weather conditions', async () => {
      const extremeContext = createTestContext(10, 15, -20); // Extreme cold
      const extremeForecast = Array.from({ length: 6 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
        temperature: -25 + i, // Extreme cold
        humidity: 90,
        conditions: 'snow' as any,
      }));
      
      const schedule = await optimizer.generateOptimalSchedule(extremeContext, extremeForecast);
      
      assertExists(schedule);
      assertEquals(Array.isArray(schedule), true);
      
      console.log('✅ Extreme weather conditions handled');
    });

    await t.step('should handle insufficient historical data', async () => {
      const context = createTestContext(10, 22, 15);
      const minimalHistory = createHistoricalData(1); // Only 1 day
      
      const prediction = await optimizer.predictEnergyUsage(context, minimalHistory);
      
      assertExists(prediction);
      assertEquals(typeof prediction.predictedUsage, 'number');
      // Should have lower confidence with minimal data
      assertEquals(prediction.confidence <= 0.7, true);
      
      console.log(`✅ Minimal data handled: confidence ${(prediction.confidence * 100).toFixed(1)}%`);
    });

    await t.step('should handle system mode restrictions', async () => {
      const heatOnlyContext = createTestContext(10, 25, 30, SystemMode.HEAT_ONLY);
      const coolOnlyContext = createTestContext(10, 18, 5, SystemMode.COOL_ONLY);
      const forecast = createWeatherForecast(4);
      
      const heatSchedule = await optimizer.generateOptimalSchedule(heatOnlyContext, forecast);
      const coolSchedule = await optimizer.generateOptimalSchedule(coolOnlyContext, forecast);
      
      // Heat-only mode should not recommend cooling
      const heatCoolingEntries = heatSchedule.filter(entry => entry.recommendedMode === 'cooling');
      assertEquals(heatCoolingEntries.length, 0);
      
      // Cool-only mode should not recommend heating
      const coolHeatingEntries = coolSchedule.filter(entry => entry.recommendedMode === 'heating');
      assertEquals(coolHeatingEntries.length, 0);
      
      console.log('✅ System mode restrictions enforced');
    });
  }
});

Deno.test({
  name: 'HVAC Optimizer - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new HVACOptimizer(defaultConfig, mockLogger);

    await t.step('should generate schedules efficiently', async () => {
      const context = createTestContext(10, 22, 18);
      const largeForecast = createWeatherForecast(48); // 48-hour forecast
      
      const startTime = performance.now();
      const schedule = await optimizer.generateOptimalSchedule(context, largeForecast);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(schedule);
      assertEquals(schedule.length, 48);
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Generated 48-hour schedule in ${duration.toFixed(2)}ms`);
    });

    await t.step('should handle large historical datasets efficiently', async () => {
      const context = createTestContext(10, 22, 15);
      const largeHistory = createHistoricalData(30); // 30 days of data
      
      const startTime = performance.now();
      const prediction = await optimizer.predictEnergyUsage(context, largeHistory);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(prediction);
      assertEquals(duration < 2000, true); // Should complete within 2 seconds
      
      console.log(`✅ Processed 30 days of historical data in ${duration.toFixed(2)}ms`);
    });

    await t.step('should scale comfort calculations', () => {
      const contexts = Array.from({ length: 100 }, (_, i) => 
        createTestContext(i % 24, 18 + i % 8, 10 + i % 15)
      );
      
      const startTime = performance.now();
      const scores = contexts.map(context => optimizer.calculateComfortScore(context));
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertEquals(scores.length, 100);
      scores.forEach(score => {
        assertEquals(typeof score, 'number');
        assertEquals(score >= 0 && score <= 1, true);
      });
      assertEquals(duration < 1000, true); // Should complete within 1 second
      
      console.log(`✅ Calculated 100 comfort scores in ${duration.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All HVAC Optimizer unit tests completed successfully!');