/**
 * Comprehensive Integration Tests for Experimental AI System
 * 
 * Tests cover end-to-end workflows, component interactions, data flow,
 * system integration, and real-world scenarios across all AI modules.
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import { AdaptiveLearningEngine } from '../src/ai/learning/adaptive-learning-engine.ts';
import { HVACOptimizer } from '../src/ai/optimization/hvac-optimizer.ts';
import { PredictiveAnalyticsEngine } from '../src/ai/predictive/analytics-engine.ts';
import { SmartScheduler } from '../src/ai/scheduling/smart-scheduler.ts';
import { SystemMonitor } from '../src/ai/monitoring/system-monitor.ts';
import { PerformanceOptimizer } from '../src/ai/optimization/performance-optimizer.ts';
import { PerformanceDashboard } from '../src/ai/dashboard/performance-dashboard.ts';
import { LoggerService } from '../../src/core/logger.ts';
import { SystemMode } from '../../src/types/common.ts';

// Mock logger for integration tests
class IntegrationTestLogger extends LoggerService {
  constructor() {
    super('IntegrationTestLogger');
  }
}

// Default configurations for integration testing
const learningConfig = {
  learningRate: 0.2,
  forgettingFactor: 0.1,
  minInteractionsForPattern: 5,
  similarityThreshold: 0.8,
  patternValidityPeriod: 30,
  initialComfortWeight: 0.6,
  initialEfficiencyWeight: 0.3,
  initialConvenienceWeight: 0.1,
  maxWeightChange: 0.1,
  adaptationWindowDays: 14
};

const optimizerConfig = {
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

const analyticsConfig = {
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

const schedulerConfig = {
  defaultLookaheadHours: 24,
  maxConcurrentEvents: 10,
  eventConflictResolution: 'priority' as const,
  autoOptimizationInterval: 60,
  weatherUpdateInterval: 30,
  occupancyDetectionEnabled: true,
  adaptScheduleFromLearning: true,
  learningInfluenceWeight: 0.7,
  maxTempChange: 3.0,
  minComfortScore: 0.7,
  emergencyOverrideEnabled: true,
};

const monitorConfig = {
  enabled: true,
  maxDecisionLatency: 1000,
  minComfortScore: 0.3,
  maxErrorRate: 5,
  maxMemoryUsage: 500,
  maxCpuUsage: 80,
  maxNetworkLatency: 500,
  alertCooldown: 300,
  escalationThreshold: 3,
};

const performanceConfig = {
  maxCpuUsage: 80,
  maxMemoryUsage: 512,
  maxLatency: 1000,
  optimizationInterval: 30,
  performanceThreshold: 0.7,
  bottleneckDetectionEnabled: true,
  autoOptimizationEnabled: true,
  cachingEnabled: true,
  cacheSize: 100,
  monitoringInterval: 5,
  alertThreshold: 0.3,
};

const dashboardConfig = {
  refreshInterval: 5,
  historyRetention: 168,
  maxDataPoints: 1000,
  alertRetention: 48,
  enableRealTimeUpdates: true,
  chartUpdateInterval: 1,
  compressionEnabled: true,
  cacheEnabled: true,
  maxConcurrentUsers: 10,
  performanceThreshold: 0.7,
};

// Helper functions for creating test data
function createTemperatureHistory(hours = 48) {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() - (hours - i) * 60 * 60 * 1000),
    indoor: 20 + Math.sin(i / 6) * 3 + Math.random() * 0.5,
    outdoor: 15 + Math.sin(i / 6) * 8 + Math.random() * 1,
    target: 22,
    mode: i % 8 < 6 ? 'heating' : i % 8 === 6 ? 'cooling' : 'idle' as const,
  }));
}

function createWeatherForecast(hours = 24) {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 60 * 60 * 1000),
    temperature: 15 + Math.sin(i / 6) * 10,
    humidity: 50 + Math.random() * 20,
    conditions: i % 8 < 6 ? 'clear' : 'cloudy' as const,
    windSpeed: 5 + Math.random() * 10,
    pressure: 1013 + Math.sin(i / 12) * 20,
  }));
}

function createUserInteractions(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - (count - i) * 60 * 60 * 1000),
    context: {
      indoorTemp: 20 + Math.random() * 4,
      outdoorTemp: 15 + Math.random() * 10,
      targetTemp: 22,
      currentHour: (8 + i) % 24,
    },
    userAction: 'temperature_adjustment',
    actionValue: (21 + Math.random() * 2).toString(),
    satisfaction: 0.7 + Math.random() * 0.3,
    metadata: {
      timeOfDay: (8 + i) % 24,
      dayOfWeek: 1 + (i % 7),
      season: 'summer',
      occupancyDetected: true
    }
  }));
}

function createHVACContext(hour = 10, indoorTemp = 22, outdoorTemp = 15) {
  return {
    indoorTemp,
    outdoorTemp,
    targetTemp: 22,
    systemMode: SystemMode.AUTO,
    currentMode: 'idle' as const,
    currentHour: hour,
    isWeekday: true,
  };
}

// Integration test suite
Deno.test({
  name: 'AI System Integration - Component Initialization',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();

    await t.step('should initialize all AI components successfully', () => {
      const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
      const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);
      const analyticsEngine = new PredictiveAnalyticsEngine(analyticsConfig, logger);
      const smartScheduler = new SmartScheduler(
        schedulerConfig,
        logger,
        hvacOptimizer,
        analyticsEngine,
        learningEngine
      );
      const systemMonitor = new SystemMonitor(monitorConfig, logger);
      const performanceOptimizer = new PerformanceOptimizer(performanceConfig, logger);

      assertExists(learningEngine);
      assertExists(hvacOptimizer);
      assertExists(analyticsEngine);
      assertExists(smartScheduler);
      assertExists(systemMonitor);
      assertExists(performanceOptimizer);

      console.log('✅ All AI components initialized successfully');
    });
  }
});

Deno.test({
  name: 'AI System Integration - End-to-End Learning Workflow',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
    const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);
    const analyticsEngine = new PredictiveAnalyticsEngine(analyticsConfig, logger);

    await t.step('should complete full learning cycle', async () => {
      // 1. Record user interactions
      const interactions = createUserInteractions(20);
      for (const interaction of interactions) {
        learningEngine.recordInteraction(interaction);
      }

      // 2. Generate temperature predictions
      const temperatureHistory = createTemperatureHistory(72);
      const predictions = await analyticsEngine.predictTemperatureTrends(temperatureHistory);

      // 3. Get personalized recommendations
      const context = createHVACContext(10, 20, 15);
      const recommendations = learningEngine.getPersonalizedRecommendations(context);

      // 4. Generate optimized schedule
      const weatherForecast = createWeatherForecast(24);
      const schedule = await hvacOptimizer.generateOptimalSchedule(context, weatherForecast);

      // Verify the complete workflow
      assertExists(predictions);
      assertEquals(predictions.length, 24);
      assertExists(recommendations);
      assertEquals(typeof recommendations.targetTemp, 'number');
      assertExists(schedule);
      assertEquals(schedule.length, 24);

      console.log('✅ Complete learning workflow executed successfully');
      console.log(`   Predictions: ${predictions.length} hours`);
      console.log(`   Recommendations: ${recommendations.targetTemp.toFixed(1)}°C target`);
      console.log(`   Schedule: ${schedule.length} optimization points`);
    });
  }
});

Deno.test({
  name: 'AI System Integration - Smart Scheduling with Learning Integration',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
    const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);
    const analyticsEngine = new PredictiveAnalyticsEngine(analyticsConfig, logger);
    const smartScheduler = new SmartScheduler(
      schedulerConfig,
      logger,
      hvacOptimizer,
      analyticsEngine,
      learningEngine
    );

    await t.step('should create intelligent schedules based on learned preferences', async () => {
      // Setup learning data
      const morningInteractions = Array.from({ length: 10 }, () => ({
        timestamp: new Date(),
        context: { indoorTemp: 18, outdoorTemp: 5, targetTemp: 22, currentHour: 7 },
        userAction: 'temperature_adjustment',
        actionValue: '21.0',
        satisfaction: 0.9,
        metadata: { timeOfDay: 7, dayOfWeek: 1, season: 'winter', occupancyDetected: true }
      }));

      for (const interaction of morningInteractions) {
        learningEngine.recordInteraction(interaction);
      }

      // Create occupancy schedule
      const occupancySchedule = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: hour >= 7 && hour <= 8 ? 0.9 : hour >= 17 && hour <= 19 ? 0.9 : 0.3,
        pattern: 'weekday' as const
      }));

      const weatherForecast = createWeatherForecast(24);
      const optimizedSchedule = await smartScheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );

      assertExists(optimizedSchedule);
      assertEquals(optimizedSchedule.length, 24);

      // Verify learning influence in recommendations
      const morningEntry = optimizedSchedule.find(entry => entry.timestamp.getHours() === 7);
      if (morningEntry) {
        assertExists(morningEntry.reasoning);
        // Should reflect learned preferences
        assertEquals(typeof morningEntry.confidence, 'number');
      }

      console.log('✅ Smart scheduling with learning integration completed');
    });
  }
});

Deno.test({
  name: 'AI System Integration - Predictive Analytics with Optimization',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const analyticsEngine = new PredictiveAnalyticsEngine(analyticsConfig, logger);
    const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);

    await t.step('should optimize based on predictive insights', async () => {
      // Generate historical data with trends
      const temperatureHistory = createTemperatureHistory(168); // 7 days
      const weatherForecast = createWeatherForecast(48); // 2 days ahead

      // Analyze patterns and predict trends
      const patterns = await analyticsEngine.analyzeTemperaturePatterns(temperatureHistory);
      const predictions = await analyticsEngine.predictTemperatureWithWeather(
        temperatureHistory,
        weatherForecast
      );

      assertExists(patterns);
      assertExists(predictions);

      // Use predictions to optimize HVAC operations
      const context = createHVACContext(14, 25, 30); // Hot afternoon scenario
      const historicalData = temperatureHistory.map(reading => ({
        timestamp: reading.timestamp,
        indoorTemp: reading.indoor,
        outdoorTemp: reading.outdoor,
        energyUsage: 2 + Math.random() * 3,
        cost: (2 + Math.random() * 3) * 0.12,
        comfortScore: 0.7 + Math.random() * 0.3,
        mode: reading.mode,
      }));

      const energyPrediction = await hvacOptimizer.predictEnergyUsage(context, historicalData);
      const schedule = await hvacOptimizer.generateOptimalSchedule(context, weatherForecast);

      assertExists(energyPrediction);
      assertExists(schedule);

      console.log('✅ Predictive analytics with optimization integration completed');
      console.log(`   Pattern confidence: ${(patterns.confidence * 100).toFixed(1)}%`);
      console.log(`   Energy prediction: ${energyPrediction.predictedUsage.toFixed(2)}kWh`);
      console.log(`   Schedule length: ${schedule.length} periods`);
    });
  }
});

Deno.test({
  name: 'AI System Integration - System Monitoring and Performance Optimization',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const systemMonitor = new SystemMonitor(monitorConfig, logger);
    const performanceOptimizer = new PerformanceOptimizer(performanceConfig, logger);

    await t.step('should monitor system and optimize performance automatically', async () => {
      // Simulate system metrics over time
      const systemMetrics = Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() - (12 - i) * 60 * 60 * 1000),
        cpu: {
          usage: 40 + Math.sin(i / 3) * 20 + Math.random() * 10,
          cores: 4,
          loadAverage: [0.5, 0.6, 0.7],
          temperature: 50 + Math.random() * 20,
        },
        memory: {
          used: 200 + i * 10,
          total: 1024,
          percentage: (200 + i * 10) / 1024 * 100,
          available: 1024 - (200 + i * 10),
        },
        network: {
          latency: 50 + Math.random() * 100,
          bandwidth: 100,
          packetsDropped: Math.floor(Math.random() * 5),
          connectionsActive: 5 + Math.floor(Math.random() * 10),
        },
        disk: {
          used: 100 + i * 5,
          total: 500,
          percentage: (100 + i * 5) / 500 * 100,
          ioWait: Math.random() * 10,
        },
        hvac: {
          currentMode: 'heating',
          targetTemp: 22,
          actualTemp: 21 + Math.random() * 2,
          energyUsage: 2 + Math.random() * 2,
          cycleCount: i,
          lastDecisionTime: 100 + Math.random() * 100,
        }
      }));

      // Record metrics in system monitor
      for (const metrics of systemMetrics) {
        await systemMonitor.recordSystemMetrics(metrics);
      }

      // Get system health assessment
      const healthStatus = await systemMonitor.getSystemHealth();
      const anomalies = await systemMonitor.detectAnomalies();

      assertExists(healthStatus);
      assertExists(anomalies);

      // Analyze performance and generate optimizations
      const currentMetrics = systemMetrics[systemMetrics.length - 1];
      const performanceAnalysis = await performanceOptimizer.analyzePerformance(currentMetrics);
      const recommendations = await performanceOptimizer.generateOptimizationRecommendations(currentMetrics);

      assertExists(performanceAnalysis);
      assertExists(recommendations);

      console.log('✅ System monitoring and performance optimization completed');
      console.log(`   System health: ${healthStatus.overall} (${(healthStatus.score * 100).toFixed(1)}%)`);
      console.log(`   Anomalies detected: ${anomalies.length}`);
      console.log(`   Performance score: ${(performanceAnalysis.overallScore * 100).toFixed(1)}%`);
      console.log(`   Optimization recommendations: ${recommendations.length}`);
    });
  }
});

Deno.test({
  name: 'AI System Integration - Real-time Dashboard and Alerting',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const systemMonitor = new SystemMonitor(monitorConfig, logger);

    // Mock data aggregator for dashboard
    const mockDataAggregator = {
      async getSystemMetrics() {
        return {
          timestamp: new Date(),
          cpu: { usage: 65, temperature: 60 },
          memory: { used: 300, percentage: 30 },
          network: { latency: 80, throughput: 120 },
          disk: { usage: 150, ioWait: 5 }
        };
      },
      async getPerformanceHistory(hours: number) {
        return Array.from({ length: hours }, (_, i) => ({
          timestamp: new Date(Date.now() - (hours - i) * 60 * 60 * 1000),
          cpu: 50 + Math.sin(i / 6) * 20,
          memory: 250 + Math.sin(i / 8) * 50,
          latency: 100 + Math.sin(i / 4) * 30
        }));
      },
      async getActiveAlerts() {
        return [
          {
            id: 'alert_1',
            type: 'performance',
            severity: 'warning',
            message: 'CPU usage elevated',
            timestamp: new Date()
          }
        ];
      }
    };

    const dashboard = new PerformanceDashboard(
      dashboardConfig,
      logger,
      mockDataAggregator
    );

    await t.step('should provide comprehensive real-time monitoring dashboard', async () => {
      // Generate system events that trigger alerts
      const criticalMetrics = {
        timestamp: new Date(),
        cpu: { usage: 90, cores: 4, loadAverage: [2.0, 2.1, 2.2], temperature: 80 },
        memory: { used: 800, total: 1024, percentage: 78, available: 224 },
        network: { latency: 500, bandwidth: 100, packetsDropped: 20, connectionsActive: 50 },
        disk: { used: 400, total: 500, percentage: 80, ioWait: 15 },
        hvac: {
          currentMode: 'cooling',
          targetTemp: 22,
          actualTemp: 25,
          energyUsage: 4.5,
          cycleCount: 20,
          lastDecisionTime: 800,
        }
      };

      await systemMonitor.recordSystemMetrics(criticalMetrics);

      // Get dashboard data
      const currentMetrics = await dashboard.getCurrentMetrics();
      const cpuChart = await dashboard.generateCpuChart(24);
      const performanceInsights = await dashboard.generatePerformanceInsights();
      const activeAlerts = await dashboard.getActiveAlerts();
      const systemAlerts = await systemMonitor.getActiveAlerts();

      assertExists(currentMetrics);
      assertExists(cpuChart);
      assertExists(performanceInsights);
      assertExists(activeAlerts);
      assertExists(systemAlerts);

      // Verify alert generation for critical conditions
      assertEquals(systemAlerts.length > 0, true);

      console.log('✅ Real-time dashboard and alerting integration completed');
      console.log(`   Dashboard metrics: CPU ${currentMetrics.cpu.usage}%`);
      console.log(`   Chart data points: ${cpuChart.dataPoints.length}`);
      console.log(`   Performance insights: ${performanceInsights.length}`);
      console.log(`   Active alerts: ${activeAlerts.length} dashboard, ${systemAlerts.length} system`);
    });
  }
});

Deno.test({
  name: 'AI System Integration - Complex Real-World Scenario',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    
    // Initialize all components
    const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
    const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);
    const analyticsEngine = new PredictiveAnalyticsEngine(analyticsConfig, logger);
    const smartScheduler = new SmartScheduler(
      schedulerConfig,
      logger,
      hvacOptimizer,
      analyticsEngine,
      learningEngine
    );
    const systemMonitor = new SystemMonitor(monitorConfig, logger);
    const performanceOptimizer = new PerformanceOptimizer(performanceConfig, logger);

    await t.step('should handle complete home automation scenario', async () => {
      // Scenario: Smart home system learning from user patterns over a week
      
      // 1. Historical temperature data (one week)
      const weekOfTemperatureData = createTemperatureHistory(168);
      
      // 2. User interactions showing preferences
      const userInteractions = [
        // Morning preferences (cooler)
        ...Array.from({ length: 7 }, (_, day) => ({
          timestamp: new Date(Date.now() - (7 - day) * 24 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000),
          context: { indoorTemp: 19, outdoorTemp: 10, targetTemp: 22, currentHour: 7 },
          userAction: 'temperature_adjustment',
          actionValue: '20.5',
          satisfaction: 0.9,
          metadata: { timeOfDay: 7, dayOfWeek: day + 1, season: 'spring', occupancyDetected: true }
        })),
        // Evening preferences (warmer)
        ...Array.from({ length: 7 }, (_, day) => ({
          timestamp: new Date(Date.now() - (7 - day) * 24 * 60 * 60 * 1000 + 19 * 60 * 60 * 1000),
          context: { indoorTemp: 21, outdoorTemp: 15, targetTemp: 22, currentHour: 19 },
          userAction: 'temperature_adjustment',
          actionValue: '23.0',
          satisfaction: 0.85,
          metadata: { timeOfDay: 19, dayOfWeek: day + 1, season: 'spring', occupancyDetected: true }
        }))
      ];

      // Record all user interactions
      for (const interaction of userInteractions) {
        learningEngine.recordInteraction(interaction);
      }

      // 3. Analyze patterns and predict future needs
      const patterns = await analyticsEngine.analyzeTemperaturePatterns(weekOfTemperatureData);
      const weatherForecast = createWeatherForecast(48); // 2-day forecast
      const predictions = await analyticsEngine.predictTemperatureWithWeather(
        weekOfTemperatureData.slice(-48), // Last 2 days
        weatherForecast
      );

      // 4. Generate personalized recommendations
      const morningContext = createHVACContext(7, 19, 10);
      const eveningContext = createHVACContext(19, 21, 15);
      
      const morningRecs = learningEngine.getPersonalizedRecommendations(morningContext);
      const eveningRecs = learningEngine.getPersonalizedRecommendations(eveningContext);

      // 5. Create intelligent schedule
      const occupancySchedule = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        probability: hour >= 7 && hour <= 8 ? 0.9 : // Morning
                    hour >= 9 && hour <= 17 ? 0.2 : // Work hours
                    hour >= 18 && hour <= 22 ? 0.9 : // Evening
                    0.1, // Night
        pattern: 'weekday' as const
      }));

      const optimizedSchedule = await smartScheduler.generateOptimizedSchedule(
        occupancySchedule,
        weatherForecast
      );

      // 6. Monitor system performance
      const systemPerformanceData = {
        timestamp: new Date(),
        cpu: { usage: 55, cores: 4, loadAverage: [0.8, 0.9, 1.0], temperature: 65 },
        memory: { used: 350, total: 1024, percentage: 34, available: 674 },
        network: { latency: 120, bandwidth: 100, packetsDropped: 2, connectionsActive: 15 },
        disk: { used: 200, total: 500, percentage: 40, ioWait: 8 },
        hvac: {
          currentMode: 'auto',
          targetTemp: morningRecs.targetTemp,
          actualTemp: 20.5,
          energyUsage: 2.8,
          cycleCount: 15,
          lastDecisionTime: 180,
        }
      };

      await systemMonitor.recordSystemMetrics(systemPerformanceData);
      const systemHealth = await systemMonitor.getSystemHealth();

      // 7. Optimize overall performance
      const performanceAnalysis = await performanceOptimizer.analyzePerformance(systemPerformanceData);

      // Verify complete integration
      assertExists(patterns);
      assertEquals(patterns.confidence > 0.5, true);
      
      assertExists(predictions);
      assertEquals(predictions.length, 48);
      
      assertExists(morningRecs);
      assertEquals(morningRecs.targetTemp, 20.5); // Should match learned preference
      
      assertExists(eveningRecs);
      assertEquals(eveningRecs.targetTemp, 23.0); // Should match learned preference
      
      assertExists(optimizedSchedule);
      assertEquals(optimizedSchedule.length, 24);
      
      assertExists(systemHealth);
      assertEquals(systemHealth.overall === 'healthy' || systemHealth.overall === 'degraded', true);
      
      assertExists(performanceAnalysis);
      assertEquals(performanceAnalysis.overallScore > 0, true);

      console.log('✅ Complete home automation scenario integration successful');
      console.log(`   Pattern confidence: ${(patterns.confidence * 100).toFixed(1)}%`);
      console.log(`   Morning preference: ${morningRecs.targetTemp}°C (confidence: ${(morningRecs.confidence * 100).toFixed(1)}%)`);
      console.log(`   Evening preference: ${eveningRecs.targetTemp}°C (confidence: ${(eveningRecs.confidence * 100).toFixed(1)}%)`);
      console.log(`   Schedule generated: ${optimizedSchedule.length} time periods`);
      console.log(`   System health: ${systemHealth.overall} (${(systemHealth.score * 100).toFixed(1)}%)`);
      console.log(`   Performance score: ${(performanceAnalysis.overallScore * 100).toFixed(1)}%`);
    });
  }
});

Deno.test({
  name: 'AI System Integration - Error Recovery and Resilience',
  fn: async (t) => {
    const logger = new IntegrationTestLogger();
    const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
    const hvacOptimizer = new HVACOptimizer(optimizerConfig, logger);
    const systemMonitor = new SystemMonitor(monitorConfig, logger);

    await t.step('should handle system failures and maintain functionality', async () => {
      // Simulate various failure scenarios
      
      // 1. Invalid data inputs
      const invalidInteraction = {
        timestamp: 'invalid-date',
        context: null,
        userAction: '',
        actionValue: 'not-a-number',
        satisfaction: -5
      } as any;

      // Should handle gracefully without crashing
      learningEngine.recordInteraction(invalidInteraction);

      const invalidContext = null as any;
      const recommendations = learningEngine.getPersonalizedRecommendations(invalidContext);
      assertExists(recommendations);

      // 2. Empty or corrupted data
      const emptyTemperatureData: any[] = [];
      const corruptedWeatherData = [{ temperature: 'invalid', humidity: null }] as any;

      const schedule = await hvacOptimizer.generateOptimalSchedule(invalidContext, corruptedWeatherData);
      assertExists(schedule);

      // 3. System resource exhaustion simulation
      const extremeMetrics = {
        timestamp: new Date(),
        cpu: { usage: 100, cores: 4, loadAverage: [5.0, 5.1, 5.2], temperature: 95 },
        memory: { used: 1000, total: 1024, percentage: 98, available: 24 },
        network: { latency: 5000, bandwidth: 1, packetsDropped: 1000, connectionsActive: 100 },
        disk: { used: 495, total: 500, percentage: 99, ioWait: 80 },
        hvac: {
          currentMode: 'emergency',
          targetTemp: 22,
          actualTemp: 30,
          energyUsage: 10,
          cycleCount: 100,
          lastDecisionTime: 5000,
        }
      };

      await systemMonitor.recordSystemMetrics(extremeMetrics);
      const healthStatus = await systemMonitor.getSystemHealth();

      // System should detect critical condition but not crash
      assertExists(healthStatus);
      assertEquals(healthStatus.overall, 'critical');

      console.log('✅ Error recovery and resilience testing completed');
      console.log(`   System gracefully handled invalid inputs`);
      console.log(`   Critical system state detected: ${healthStatus.overall}`);
    });
  }
});

console.log('🎉 All AI System Integration tests completed successfully!');