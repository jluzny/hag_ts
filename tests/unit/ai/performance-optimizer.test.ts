/**
 * Unit tests for Performance Optimizer
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import {
  PerformanceConfig,
  PerformanceOptimizer,
} from '../../../src/ai/optimization/performance-optimizer.ts';
import { LoggerService } from '../../../src/core/logger.ts';

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

Deno.test('Performance Optimizer', async (t) => {
  const mockLogger = new MockLoggerService();

  await t.step('should initialize with configuration', () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    assertExists(optimizer);
  });

  await t.step('should start and stop successfully', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);

    await optimizer.start();
    // Should start without errors

    await optimizer.stop();
    // Should stop without errors
  });

  await t.step('should record and retrieve metrics', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    // Record test metrics
    optimizer.recordMetrics({
      memoryUsage: 128,
      cpuUsage: 45,
      averageResponseTime: 150,
      throughput: 10.5,
      aiDecisionTime: 80,
      cacheHitRate: 0.85,
      errorRate: 0.02,
    });

    const currentMetrics = optimizer.getCurrentMetrics();
    assertExists(currentMetrics);
    assertEquals(currentMetrics.memoryUsage, 128);
    assertEquals(currentMetrics.cpuUsage, 45);
    assertEquals(currentMetrics.averageResponseTime, 150);
    assertEquals(currentMetrics.cacheHitRate, 0.85);

    await optimizer.stop();
  });

  await t.step('should cache and retrieve decisions', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    const testDecision = {
      action: 'heating',
      confidence: 0.8,
      reasoning: 'Test decision',
    };

    // Cache decision
    optimizer.cacheDecision('test_context', testDecision, 300);

    // Retrieve decision
    const cachedDecision = optimizer.getCachedDecision('test_context');
    assertExists(cachedDecision);
    assertEquals(cachedDecision.action, 'heating');
    assertEquals(cachedDecision.confidence, 0.8);

    await optimizer.stop();
  });

  await t.step('should execute optimized tasks', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    const taskResult = await optimizer.executeOptimizedTask(
      'test_task',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { result: 'task_completed', value: 42 };
      },
      { timeout: 5000, priority: 'normal' },
    );

    assertExists(taskResult);
    assertEquals(taskResult.result, 'task_completed');
    assertEquals(taskResult.value, 42);

    await optimizer.stop();
  });

  await t.step('should provide cache statistics', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    // Add some cached items
    optimizer.cacheDecision('test1', { action: 'heat' }, 300);
    optimizer.cacheDecision('test2', { action: 'cool' }, 300);

    const stats = optimizer.getCacheStatistics();
    assertExists(stats);
    assertExists(stats.overall);
    assertInstanceOf(stats.overall.totalSize, Number);
    assertInstanceOf(stats.overall.hitRate, Number);
    assertInstanceOf(stats.overall.memoryUsage, Number);

    // Should have cached items
    assertEquals(stats.overall.totalSize >= 2, true);

    await optimizer.stop();
  });

  await t.step('should generate performance summary', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    // Record some metrics to generate summary
    optimizer.recordMetrics({
      memoryUsage: 256,
      cpuUsage: 60,
      averageResponseTime: 120,
      throughput: 15.0,
      aiDecisionTime: 90,
      cacheHitRate: 0.75,
      errorRate: 0.01,
    });

    const summary = optimizer.getPerformanceSummary();
    assertExists(summary);
    assertExists(summary.current);
    assertEquals(Array.isArray(summary.recommendations), true);
    assertInstanceOf(summary.overallHealth, String);

    await optimizer.stop();
  });

  await t.step('should handle metrics history', async () => {
    const config: PerformanceConfig = {
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

    const optimizer = new PerformanceOptimizer(config, mockLogger);
    await optimizer.start();

    // Record multiple metrics over time
    optimizer.recordMetrics({
      memoryUsage: 100,
      cpuUsage: 30,
      averageResponseTime: 100,
    });
    optimizer.recordMetrics({
      memoryUsage: 120,
      cpuUsage: 40,
      averageResponseTime: 110,
    });
    optimizer.recordMetrics({
      memoryUsage: 140,
      cpuUsage: 50,
      averageResponseTime: 120,
    });

    const history = optimizer.getMetricsHistory(2); // Get last 2 entries
    assertEquals(Array.isArray(history), true);
    assertEquals(history.length <= 2, true);

    if (history.length > 0) {
      const entry = history[0];
      assertExists(entry.timestamp);
      assertExists(entry.metrics);
      assertInstanceOf(entry.metrics.memoryUsage, Number);
    }

    await optimizer.stop();
  });
});
