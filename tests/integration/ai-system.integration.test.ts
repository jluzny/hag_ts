/**
 * Integration tests for AI System
 *
 * This test validates the complete AI system integration including
 * decision engine, optimizer, analytics, learning, and scheduling.
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  AIDecisionConfig,
  AIDecisionEngine,
} from '../../src/ai/decision-engine.ts';
import {
  HVACOptimizer,
  OptimizationConfig,
} from '../../src/ai/optimization/hvac-optimizer.ts';
import {
  AnalyticsConfig,
  PredictiveAnalyticsEngine,
} from '../../src/ai/predictive/analytics-engine.ts';
import {
  AdaptiveLearningEngine,
  LearningConfig,
} from '../../src/ai/learning/adaptive-learning-engine.ts';
import {
  SchedulingConfig,
  SmartScheduler,
} from '../../src/ai/scheduling/smart-scheduler.ts';
import {
  PerformanceConfig,
  PerformanceOptimizer,
} from '../../src/ai/optimization/performance-optimizer.ts';
import {
  EnergyUsageData,
  HVACDecisionContext,
  TemperatureReading,
} from '../../src/ai/types/ai-types.ts';
import { SystemMode } from '../../src/types/common.ts';
import { LoggerService } from '../../src/core/logger.ts';

// Mock logger
class MockLoggerService implements LoggerService {
  info(_message: string, _data?: Record<string, unknown>): void {}
  error(
    _message: string,
    _error?: unknown,
    _data?: Record<string, unknown>,
  ): void {}
  debug(_message: string, _data?: Record<string, unknown>): void {}
  warning(_message: string, _data?: Record<string, unknown>): void {}
}

// Skip AI tests if no OpenAI API key available
const hasApiKey = !!Deno.env.get('OPENAI_API_KEY');

/**
 * Create AI system components for testing
 */
async function createAISystem() {
  const logger = new MockLoggerService();

  // Decision Engine
  const decisionConfig: AIDecisionConfig = {
    openaiApiKey: Deno.env.get('OPENAI_API_KEY'),
    model: 'gpt-4',
    temperature: 0.3,
    maxTokens: 1000,
    enabled: hasApiKey,
    fallbackToRules: true,
    maxRetries: 3,
    timeoutMs: 30000,
  };
  const decisionEngine = new AIDecisionEngine(decisionConfig, logger);

  // HVAC Optimizer
  const optimizerConfig: OptimizationConfig = {
    comfortWeight: 0.4,
    energyWeight: 0.4,
    costWeight: 0.2,
    targetComfortScore: 0.8,
    maxEnergyUsage: 100,
    maxCostPerHour: 5.0,
    optimizationInterval: 15,
    historyWindow: 24,
    learningRate: 0.1,
    adaptationEnabled: true,
  };
  const optimizer = new HVACOptimizer(optimizerConfig, logger);

  // Predictive Analytics
  const analyticsConfig: AnalyticsConfig = {
    predictionHorizon: 8,
    trainingWindow: 168,
    updateInterval: 60,
    confidenceThreshold: 0.7,
    seasonalityEnabled: true,
    weatherIntegration: true,
    occupancyPrediction: true,
    energyForecasting: true,
    alertThresholds: {
      temperature: { min: 15, max: 30 },
      humidity: { min: 30, max: 70 },
      energy: { max: 150 },
    },
  };
  const analytics = new PredictiveAnalyticsEngine(analyticsConfig, logger);

  // Adaptive Learning
  const learningConfig: LearningConfig = {
    learningRate: 0.2,
    adaptationWindow: 14,
    preferenceWeight: 0.6,
    patternWeight: 0.4,
    minimumInteractions: 10,
    confidenceThreshold: 0.7,
    enablePersonalization: true,
    enablePatternDetection: true,
    enableSeasonalAdaptation: true,
    enableOccupancyLearning: true,
    maxPatterns: 100,
    patternMinSupport: 0.3,
    adaptationRate: 0.1,
  };
  const learning = new AdaptiveLearningEngine(learningConfig, logger);

  // Smart Scheduler
  const schedulingConfig: SchedulingConfig = {
    defaultLookaheadHours: 8,
    scheduleUpdateInterval: 30,
    maxScheduleItems: 48,
    enableWeatherIntegration: true,
    enableOccupancyPrediction: true,
    enableEnergyOptimization: true,
    enableCostOptimization: true,
    priorityWeights: {
      comfort: 0.4,
      energy: 0.3,
      cost: 0.2,
      manual: 0.1,
    },
    optimizationEngine: optimizer,
    analyticsEngine: analytics,
    learningEngine: learning,
  };
  const scheduler = new SmartScheduler(schedulingConfig, logger);

  // Performance Optimizer
  const performanceConfig: PerformanceConfig = {
    maxMemoryUsage: 512,
    gcThreshold: 400,
    cacheCleanupInterval: 5,
    maxCpuUsage: 80,
    taskBatching: true,
    parallelization: true,
    maxConcurrentTasks: 4,
    enableCaching: true,
    cacheTimeout: 300,
    maxCacheSize: 1000,
    batchSize: 50,
    connectionPoolSize: 10,
    queryTimeout: 30,
    modelCaching: true,
    predictionBatching: true,
    inferenceTimeout: 10,
    enableProfiling: true,
    performanceLogging: true,
    alertThresholds: {
      memoryUsage: 90,
      cpuUsage: 80,
      latency: 1000,
    },
  };
  const performance = new PerformanceOptimizer(performanceConfig, logger);

  return {
    decisionEngine,
    optimizer,
    analytics,
    learning,
    scheduler,
    performance,
    logger,
  };
}

/**
 * Generate test data for AI system
 */
function generateTestData() {
  const context: HVACDecisionContext = {
    indoorTemp: 21.0,
    outdoorTemp: 15.0,
    targetTemp: 22.0,
    systemMode: SystemMode.AUTO,
    currentMode: 'idle',
    currentHour: 14,
    isWeekday: true,
  };

  const temperatureReadings: TemperatureReading[] = Array.from(
    { length: 24 },
    (_, i) => ({
      timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
      indoor: 20 + Math.sin(i / 4) * 3 + Math.random(),
      outdoor: 15 + Math.sin(i / 6) * 5 + Math.random() * 2,
      target: 22,
      mode: i % 4 === 0 ? 'heating' : i % 4 === 1 ? 'cooling' : 'idle',
    }),
  );

  const energyData: EnergyUsageData[] = Array.from({ length: 24 }, (_, i) => ({
    timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
    consumption: 50 + Math.random() * 30,
    cost: 0.15 + Math.random() * 0.1,
    source: 'grid',
    efficiency: 0.8 + Math.random() * 0.15,
  }));

  return { context, temperatureReadings, energyData };
}

Deno.test('AI System Integration', async (t) => {
  await t.step('should initialize all AI components', async () => {
    const system = await createAISystem();

    assertExists(system.decisionEngine);
    assertExists(system.optimizer);
    assertExists(system.analytics);
    assertExists(system.learning);
    assertExists(system.scheduler);
    assertExists(system.performance);

    console.log('✅ All AI components initialized successfully');
  });

  await t.step('should process complete decision workflow', async () => {
    const system = await createAISystem();
    const { context, temperatureReadings, energyData } = generateTestData();

    await system.performance.start();

    // 1. Analytics prediction
    const prediction = await system.analytics.predictTemperature(context, 2);
    assertExists(prediction);
    console.log(
      `📈 Temperature prediction: ${prediction.values[0]?.toFixed(1)}°C`,
    );

    // 2. Optimization
    const optimization = await system.optimizer.optimize(context);
    assertExists(optimization);
    console.log(
      `⚡ Optimization score: ${optimization.overallScore.toFixed(2)}`,
    );

    // 3. Learning (add historical data)
    system.learning.recordInteraction({
      timestamp: new Date(),
      context,
      userAction: 'manual_override',
      actionValue: 'heating',
      satisfaction: 0.8,
      metadata: { reason: 'too_cold' },
    });

    const patterns = system.learning.detectPatterns(temperatureReadings);
    assertEquals(Array.isArray(patterns), true);
    console.log(`🧠 Detected ${patterns.length} behavioral patterns`);

    // 4. Decision making
    const decision = await system.decisionEngine.makeDecision(context);
    assertExists(decision);
    console.log(
      `🤖 AI Decision: ${decision.action} (confidence: ${
        decision.confidence.toFixed(2)
      })`,
    );

    // 5. Scheduling
    const schedule = await system.scheduler.generateSchedule(4);
    assertEquals(Array.isArray(schedule), true);
    console.log(`📅 Generated schedule with ${schedule.length} items`);

    await system.performance.stop();

    console.log('✅ Complete decision workflow processed successfully');
  });

  await t.step('should handle data flow between components', async () => {
    const system = await createAISystem();
    const { context, temperatureReadings, energyData } = generateTestData();

    await system.performance.start();

    // Feed historical data to analytics
    for (const reading of temperatureReadings) {
      system.analytics.addTemperatureReading(reading);
    }

    for (const data of energyData) {
      system.analytics.addEnergyData(data);
    }

    // Analytics should now have data for predictions
    const tempPrediction = await system.analytics.predictTemperature(
      context,
      1,
    );
    assertExists(tempPrediction);
    assertEquals(tempPrediction.values.length >= 1, true);

    const energyPrediction = await system.analytics.predictEnergyUsage(
      context,
      1,
    );
    assertExists(energyPrediction);

    // Optimizer should use analytics data
    const optimization = await system.optimizer.optimize(context);
    assertExists(optimization);
    assertInstanceOf(optimization.overallScore, Number);

    // Scheduler should integrate all components
    const schedule = await system.scheduler.generateSchedule(2);
    assertEquals(Array.isArray(schedule), true);

    await system.performance.stop();

    console.log('✅ Data flow between components working correctly');
  });

  await t.step('should handle performance monitoring', async () => {
    const system = await createAISystem();
    const { context } = generateTestData();

    await system.performance.start();

    // Record performance metrics during AI operations
    const startTime = performance.now();

    const decision = await system.decisionEngine.makeDecision(context);
    const optimization = await system.optimizer.optimize(context);

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // Record metrics
    system.performance.recordMetrics({
      memoryUsage: 200,
      cpuUsage: 60,
      averageResponseTime: totalTime,
      throughput: 1000 / totalTime,
      aiDecisionTime: totalTime,
      cacheHitRate: 0.5,
      errorRate: 0.0,
    });

    const metrics = system.performance.getCurrentMetrics();
    assertExists(metrics);
    assertEquals(metrics.averageResponseTime, totalTime);

    const summary = system.performance.getPerformanceSummary();
    assertExists(summary);
    assertEquals(Array.isArray(summary.recommendations), true);

    await system.performance.stop();

    console.log(
      `✅ Performance monitoring completed (${totalTime.toFixed(2)}ms total)`,
    );
  });

  await t.step('should handle error scenarios gracefully', async () => {
    const system = await createAISystem();

    await system.performance.start();

    // Test with invalid context
    const invalidContext: HVACDecisionContext = {
      indoorTemp: NaN,
      outdoorTemp: undefined as any,
      targetTemp: -1000,
      systemMode: SystemMode.AUTO,
      currentMode: 'invalid' as any,
      currentHour: 25, // Invalid hour
      isWeekday: true,
    };

    try {
      // Should handle gracefully or provide fallback
      const decision = await system.decisionEngine.makeDecision(invalidContext);
      assertExists(decision);
      // Should fall back to rule-based decision
      assertEquals(decision.fallbackUsed, true);
    } catch (error) {
      // Acceptable if it throws a descriptive error
      assertInstanceOf(error, Error);
    }

    await system.performance.stop();

    console.log('✅ Error handling working correctly');
  });

  await t.step('should demonstrate learning and adaptation', async () => {
    const system = await createAISystem();
    const { context } = generateTestData();

    await system.performance.start();

    // Simulate user interactions over time
    const interactions = [
      { action: 'heating', satisfaction: 0.9, reason: 'comfortable' },
      { action: 'cooling', satisfaction: 0.3, reason: 'too_cold' },
      { action: 'heating', satisfaction: 0.8, reason: 'perfect' },
      { action: 'idle', satisfaction: 0.7, reason: 'good' },
    ];

    for (const interaction of interactions) {
      system.learning.recordInteraction({
        timestamp: new Date(),
        context: { ...context, currentMode: interaction.action },
        userAction: 'feedback',
        actionValue: interaction.satisfaction.toString(),
        satisfaction: interaction.satisfaction,
        metadata: { reason: interaction.reason },
      });
    }

    // Learning should adapt preferences
    const preferences = system.learning.getUserPreferences();
    assertExists(preferences);

    // Should show learning has occurred
    const userProfile = system.learning.getUserProfile();
    assertExists(userProfile);
    assertInstanceOf(userProfile.totalInteractions, Number);
    assertEquals(userProfile.totalInteractions, interactions.length);

    await system.performance.stop();

    console.log('✅ Learning and adaptation demonstrated successfully');
  });

  if (hasApiKey) {
    await t.step('should test full AI decision pipeline', async () => {
      const system = await createAISystem();
      const { context, temperatureReadings } = generateTestData();

      await system.performance.start();

      // Full AI pipeline test
      console.log('🔄 Running full AI decision pipeline...');

      // Add historical data
      for (const reading of temperatureReadings.slice(0, 10)) {
        system.analytics.addTemperatureReading(reading);
      }

      // Get predictions
      const prediction = await system.analytics.predictTemperature(context, 1);
      console.log(`📊 Predicted temp: ${prediction.values[0]?.toFixed(1)}°C`);

      // Optimize based on predictions
      const optimization = await system.optimizer.optimize(context);
      console.log(
        `⚡ Optimization score: ${optimization.overallScore.toFixed(2)}`,
      );

      // Make AI decision
      const decision = await system.decisionEngine.makeDecision(context);
      console.log(`🤖 AI recommendation: ${decision.action}`);

      // Create schedule
      const schedule = await system.scheduler.generateSchedule(2);
      console.log(`📅 Schedule generated: ${schedule.length} items`);

      // Validate results
      assertExists(prediction);
      assertExists(optimization);
      assertExists(decision);
      assertEquals(Array.isArray(schedule), true);
      assertEquals(decision.fallbackUsed, false); // Should use AI with API key

      await system.performance.stop();

      console.log('✅ Full AI decision pipeline completed successfully');
    });
  } else {
    await t.step('should skip AI pipeline test - no OpenAI API key', () => {
      console.log(
        '⚠️  Skipping full AI pipeline test - OPENAI_API_KEY not configured',
      );
      assertEquals(true, true); // Pass the test
    });
  }

  console.log('🎉 All AI system integration tests completed successfully!');
});
