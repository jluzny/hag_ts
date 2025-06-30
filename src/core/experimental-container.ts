/**
 * Experimental features container configuration
 * 
 * Extends the base container with experimental components when enabled.
 */

import { Container } from '@needle-di/core';
import { TYPES } from './types.ts';
import { LoggerService } from './logger.ts';
import {
  type ExperimentalFeatures,
  type IAdaptiveLearningEngine,
  type IHVACOptimizer,
  type IPredictiveAnalyticsEngine,
  type ISystemMonitor,
  type ISmartScheduler,
  type IPerformanceOptimizer,
  NullAdaptiveLearningEngine,
  NullHVACOptimizer,
  NullPredictiveAnalyticsEngine,
  NullSystemMonitor,
  NullSmartScheduler,
  NullPerformanceOptimizer,
} from './experimental-features.ts';

/**
 * Configure experimental features in the container
 */
export async function configureExperimentalFeatures(
  container: Container,
  features: ExperimentalFeatures,
  logger: LoggerService,
): Promise<void> {
  logger.info('🧪 Configuring experimental features', {
    adaptiveLearning: features.adaptiveLearning.enabled,
    hvacOptimization: features.hvacOptimization?.enabled || false,
    predictiveAnalytics: features.predictiveAnalytics?.enabled || false,
    systemMonitoring: features.systemMonitoring?.enabled || false,
    smartScheduling: features.smartScheduling?.enabled || false,
    performanceOptimization: features.performanceOptimization?.enabled || false,
  });

  // Configure Adaptive Learning Engine
  if (features.adaptiveLearning.enabled) {
    logger.info('🧠 Enabling adaptive learning engine');
    await configureAdaptiveLearning(container, features.adaptiveLearning.config || {}, logger);
  } else {
    logger.debug('🚫 Adaptive learning disabled - using null implementation');
    container.bind({
      provide: TYPES.AdaptiveLearningEngine,
      useValue: new NullAdaptiveLearningEngine(),
    });
  }

  // Configure HVAC Optimizer
  if (features.hvacOptimization?.enabled) {
    logger.info('⚡ Enabling HVAC optimization engine');
    await configureHVACOptimizer(container, features.hvacOptimization.config || {}, logger);
  } else {
    logger.debug('🚫 HVAC optimization disabled - using null implementation');
    container.bind({
      provide: TYPES.HVACOptimizer,
      useValue: new NullHVACOptimizer(),
    });
  }

  // Configure Predictive Analytics Engine
  if (features.predictiveAnalytics?.enabled) {
    logger.info('🔮 Enabling predictive analytics engine');
    await configurePredictiveAnalytics(container, features.predictiveAnalytics.config || {}, logger);
  } else {
    logger.debug('🚫 Predictive analytics disabled - using null implementation');
    container.bind({
      provide: TYPES.PredictiveAnalyticsEngine,
      useValue: new NullPredictiveAnalyticsEngine(),
    });
  }

  // Configure System Monitor
  if (features.systemMonitoring?.enabled) {
    logger.info('📊 Enabling system monitoring');
    await configureSystemMonitor(container, features.systemMonitoring.config || {}, logger);
  } else {
    logger.debug('🚫 System monitoring disabled - using null implementation');
    container.bind({
      provide: TYPES.SystemMonitor,
      useValue: new NullSystemMonitor(),
    });
  }

  // Configure Smart Scheduler
  if (features.smartScheduling?.enabled) {
    logger.info('🗓️ Enabling smart scheduling');
    await configureSmartScheduler(container, features.smartScheduling.config || {}, logger);
  } else {
    logger.debug('🚫 Smart scheduling disabled - using null implementation');
    container.bind({
      provide: TYPES.SmartScheduler,
      useValue: new NullSmartScheduler(),
    });
  }

  // Configure Performance Optimizer
  if (features.performanceOptimization?.enabled) {
    logger.info('🚀 Enabling performance optimization');
    await configurePerformanceOptimizer(container, features.performanceOptimization.config || {}, logger);
  } else {
    logger.debug('🚫 Performance optimization disabled - using null implementation');
    container.bind({
      provide: TYPES.PerformanceOptimizer,
      useValue: new NullPerformanceOptimizer(),
    });
  }

  // Store experimental features configuration
  container.bind({
    provide: TYPES.ExperimentalFeatures,
    useValue: features,
  });
}

/**
 * Configure adaptive learning with dynamic import
 */
async function configureAdaptiveLearning(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    // Dynamic import of experimental module
    const { AdaptiveLearningEngine } = await import(
      '../../experimental/src/ai/learning/adaptive-learning-engine.ts'
    );

    // Create learning configuration with defaults
    const learningConfig = {
      learningRate: 0.2,
      forgettingFactor: 0.1,
      minInteractionsForPattern: 10,
      similarityThreshold: 0.8,
      patternValidityPeriod: 30,
      initialComfortWeight: 0.6,
      initialEfficiencyWeight: 0.3,
      initialConvenienceWeight: 0.1,
      maxWeightChange: 0.1,
      adaptationWindowDays: 14,
      ...config, // Override with user configuration
    };

    // Create and register the learning engine
    const learningEngine = new AdaptiveLearningEngine(learningConfig, logger);
    
    container.bind({
      provide: TYPES.AdaptiveLearningEngine,
      useValue: learningEngine,
    });

    logger.info('✅ Adaptive learning engine configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure adaptive learning engine', { error });
    
    // Fallback to null implementation
    logger.warning('🔄 Falling back to null adaptive learning implementation');
    container.bind({
      provide: TYPES.AdaptiveLearningEngine,
      useValue: new NullAdaptiveLearningEngine(),
    });
  }
}

/**
 * Configure HVAC optimizer with dynamic import
 */
async function configureHVACOptimizer(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    const { HVACOptimizer } = await import('../../experimental/src/ai/optimization/hvac-optimizer.ts');
    
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
      ...config,
    };
    
    const optimizer = new HVACOptimizer(optimizerConfig, logger);
    
    container.bind({
      provide: TYPES.HVACOptimizer,
      useValue: optimizer,
    });
    
    logger.info('✅ HVAC optimizer configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure HVAC optimizer', { error });
    container.bind({
      provide: TYPES.HVACOptimizer,
      useValue: new NullHVACOptimizer(),
    });
  }
}

/**
 * Configure predictive analytics with dynamic import
 */
async function configurePredictiveAnalytics(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    const { PredictiveAnalyticsEngine } = await import('../../experimental/src/ai/predictive/analytics-engine.ts');
    
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
      ...config,
    };
    
    const analytics = new PredictiveAnalyticsEngine(analyticsConfig, logger);
    
    container.bind({
      provide: TYPES.PredictiveAnalyticsEngine,
      useValue: analytics,
    });
    
    logger.info('✅ Predictive analytics engine configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure predictive analytics engine', { error });
    container.bind({
      provide: TYPES.PredictiveAnalyticsEngine,
      useValue: new NullPredictiveAnalyticsEngine(),
    });
  }
}

/**
 * Configure system monitor with dynamic import
 */
async function configureSystemMonitor(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    const { SystemMonitor } = await import('../../experimental/src/ai/monitoring/system-monitor.ts');
    
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
      ...config,
    };
    
    const monitor = new SystemMonitor(monitorConfig, logger);
    
    container.bind({
      provide: TYPES.SystemMonitor,
      useValue: monitor,
    });
    
    logger.info('✅ System monitor configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure system monitor', { error });
    container.bind({
      provide: TYPES.SystemMonitor,
      useValue: new NullSystemMonitor(),
    });
  }
}

/**
 * Configure smart scheduler with dynamic import
 */
async function configureSmartScheduler(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    const { SmartScheduler } = await import('../../experimental/src/ai/scheduling/smart-scheduler.ts');
    
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
      ...config,
    };
    
    // Get dependencies - these may be null implementations
    const optimizer = container.get<IHVACOptimizer>(TYPES.HVACOptimizer);
    const analytics = container.get<IPredictiveAnalyticsEngine>(TYPES.PredictiveAnalyticsEngine);
    const learning = container.get<IAdaptiveLearningEngine>(TYPES.AdaptiveLearningEngine);
    
    // SmartScheduler expects concrete classes, but we may have interfaces
    // Only pass if they're actual implementations, not null objects
    const concreteOptimizer = (optimizer instanceof NullHVACOptimizer) ? undefined : optimizer as any;
    const concreteAnalytics = (analytics instanceof NullPredictiveAnalyticsEngine) ? undefined : analytics as any;
    
    const scheduler = new SmartScheduler(schedulerConfig, logger, concreteOptimizer, concreteAnalytics, learning);
    
    container.bind({
      provide: TYPES.SmartScheduler,
      useValue: scheduler,
    });
    
    logger.info('✅ Smart scheduler configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure smart scheduler', { error });
    container.bind({
      provide: TYPES.SmartScheduler,
      useValue: new NullSmartScheduler(),
    });
  }
}

/**
 * Configure performance optimizer with dynamic import
 */
async function configurePerformanceOptimizer(
  container: Container,
  config: Record<string, unknown>,
  logger: LoggerService,
): Promise<void> {
  try {
    const { PerformanceOptimizer } = await import('../../experimental/src/ai/optimization/performance-optimizer.ts');
    
    const perfConfig = {
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
      ...config,
    };
    
    const perfOptimizer = new PerformanceOptimizer(perfConfig, logger);
    
    container.bind({
      provide: TYPES.PerformanceOptimizer,
      useValue: perfOptimizer,
    });
    
    logger.info('✅ Performance optimizer configured successfully');
  } catch (error) {
    logger.error('❌ Failed to configure performance optimizer', { error });
    container.bind({
      provide: TYPES.PerformanceOptimizer,
      useValue: new NullPerformanceOptimizer(),
    });
  }
}

/**
 * Check if experimental features are available
 */
export async function checkExperimentalAvailability(): Promise<{
  adaptiveLearning: boolean;
  advancedAnalytics: boolean;
  predictiveModeling: boolean;
}> {
  const availability = {
    adaptiveLearning: false,
    advancedAnalytics: false,
    predictiveModeling: false,
  };

  try {
    // Try to import adaptive learning
    await import('../../experimental/src/ai/learning/adaptive-learning-engine.ts');
    availability.adaptiveLearning = true;
  } catch {
    // Module not available
  }

  // Add checks for future experimental features here

  return availability;
}