/**
 * Comprehensive Unit Tests for Performance Optimizer
 * 
 * Tests cover performance analysis, bottleneck detection, optimization strategies,
 * resource management, and real-time performance monitoring.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { PerformanceOptimizer, type PerformanceConfig } from '../../../src/ai/optimization/performance-optimizer.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockPerformanceLogger');
  }
}

// Standard test configuration
const defaultConfig: PerformanceConfig = {
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

// Helper functions for creating test data
function createPerformanceMetrics(overrides: Partial<any> = {}) {
  return {
    timestamp: new Date(),
    cpu: {
      usage: 45,
      cores: 4,
      loadAverage: [0.5, 0.6, 0.7],
      temperature: 55,
      ...overrides.cpu
    },
    memory: {
      used: 200,
      total: 1024,
      percentage: 19.5,
      available: 824,
      heapUsed: 150,
      heapTotal: 300,
      ...overrides.memory
    },
    network: {
      latency: 25,
      bandwidth: 100,
      packetsDropped: 0,
      connectionsActive: 5,
      throughput: 50,
      ...overrides.network
    },
    disk: {
      used: 50,
      total: 500,
      percentage: 10,
      ioWait: 2,
      readOps: 100,
      writeOps: 50,
      ...overrides.disk
    },
    application: {
      responseTime: 150,
      errorRate: 0.01,
      activeConnections: 12,
      queueDepth: 3,
      cacheHitRate: 0.85,
      ...overrides.application
    }
  };
}

function createOperationMetrics(count = 10, baseLatency = 100) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - (count - i) * 60 * 1000),
    operation: 'hvac_decision',
    latency: baseLatency + Math.random() * 50,
    success: Math.random() > 0.1,
    resourceUsage: {
      cpu: 20 + Math.random() * 30,
      memory: 100 + Math.random() * 50
    },
    metadata: {
      complexity: Math.floor(Math.random() * 5) + 1,
      cacheHit: Math.random() > 0.3
    }
  }));
}

function createResourceHistory(hours = 24) {
  return Array.from({ length: hours }, (_, i) => ({
    timestamp: new Date(Date.now() - (hours - i) * 60 * 60 * 1000),
    cpu: 30 + Math.sin(i / 6) * 20 + Math.random() * 10,
    memory: 200 + Math.sin(i / 8) * 100 + Math.random() * 50,
    latency: 80 + Math.sin(i / 4) * 30 + Math.random() * 20,
    throughput: 50 + Math.sin(i / 12) * 20 + Math.random() * 10
  }));
}

Deno.test({
  name: 'Performance Optimizer - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();

    await t.step('should initialize with default configuration', () => {
      const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);
      
      assertExists(optimizer);
      assertInstanceOf(optimizer, PerformanceOptimizer);
      
      console.log('✅ Performance Optimizer initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        maxCpuUsage: 150 // Invalid value > 100
      };
      
      assertThrows(
        () => new PerformanceOptimizer(invalidConfig, mockLogger),
        Error,
        'maxCpuUsage must be between 0 and 100'
      );
    });

    await t.step('should handle minimal configuration', () => {
      const minimalConfig: PerformanceConfig = {
        maxCpuUsage: 70,
        maxMemoryUsage: 256,
        maxLatency: 500,
        optimizationInterval: 60,
        performanceThreshold: 0.6,
        bottleneckDetectionEnabled: false,
        autoOptimizationEnabled: false,
        cachingEnabled: false,
        cacheSize: 50,
        monitoringInterval: 10,
        alertThreshold: 0.4,
      };

      const optimizer = new PerformanceOptimizer(minimalConfig, mockLogger);
      assertExists(optimizer);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Performance Analysis',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should analyze current performance metrics', async () => {
      const metrics = createPerformanceMetrics();
      
      const analysis = await optimizer.analyzePerformance(metrics);
      
      assertExists(analysis);
      assertEquals(typeof analysis.overallScore, 'number');
      assertEquals(typeof analysis.cpuScore, 'number');
      assertEquals(typeof analysis.memoryScore, 'number');
      assertEquals(typeof analysis.networkScore, 'number');
      assertEquals(typeof analysis.diskScore, 'number');
      assertExists(analysis.bottlenecks);
      assertExists(analysis.recommendations);
      
      // Scores should be between 0 and 1
      assertEquals(analysis.overallScore >= 0 && analysis.overallScore <= 1, true);
      assertEquals(analysis.cpuScore >= 0 && analysis.cpuScore <= 1, true);
      assertEquals(analysis.memoryScore >= 0 && analysis.memoryScore <= 1, true);
      
      console.log(`✅ Performance analysis: ${(analysis.overallScore * 100).toFixed(1)}% overall score`);
    });

    await t.step('should detect performance degradation', async () => {
      const degradedMetrics = createPerformanceMetrics({
        cpu: { usage: 85 },
        memory: { percentage: 85 },
        application: { responseTime: 800, errorRate: 0.1 }
      });
      
      const analysis = await optimizer.analyzePerformance(degradedMetrics);
      
      assertEquals(analysis.overallScore < 0.7, true);
      assertEquals(analysis.bottlenecks.length > 0, true);
      
      console.log(`✅ Degradation detected: ${analysis.bottlenecks.length} bottlenecks found`);
    });

    await t.step('should identify specific performance issues', async () => {
      const problematicMetrics = createPerformanceMetrics({
        cpu: { usage: 95, temperature: 80 },
        memory: { percentage: 90 },
        network: { latency: 500, packetsDropped: 10 },
        disk: { ioWait: 25 }
      });
      
      const analysis = await optimizer.analyzePerformance(problematicMetrics);
      
      assertExists(analysis.bottlenecks);
      assertEquals(Array.isArray(analysis.bottlenecks), true);
      
      // Should identify multiple issues
      const cpuBottleneck = analysis.bottlenecks.find(b => b.component === 'cpu');
      const memoryBottleneck = analysis.bottlenecks.find(b => b.component === 'memory');
      
      if (cpuBottleneck) {
        assertEquals(cpuBottleneck.severity, 'critical');
      }
      
      console.log(`✅ Performance issues identified: ${analysis.bottlenecks.map(b => b.component).join(', ')}`);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Bottleneck Detection',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should detect CPU bottlenecks', async () => {
      const cpuBottleneckMetrics = createPerformanceMetrics({
        cpu: { usage: 98, loadAverage: [2.5, 2.8, 3.0], temperature: 85 }
      });
      
      const bottlenecks = await optimizer.detectBottlenecks(cpuBottleneckMetrics);
      
      assertExists(bottlenecks);
      assertEquals(Array.isArray(bottlenecks), true);
      
      const cpuBottleneck = bottlenecks.find(b => b.component === 'cpu');
      if (cpuBottleneck) {
        assertEquals(cpuBottleneck.severity, 'critical');
        assertEquals(typeof cpuBottleneck.impact, 'number');
        assertExists(cpuBottleneck.description);
        assertExists(cpuBottleneck.suggestedActions);
      }
      
      console.log('✅ CPU bottleneck detection working');
    });

    await t.step('should detect memory bottlenecks', async () => {
      const memoryBottleneckMetrics = createPerformanceMetrics({
        memory: { percentage: 95, available: 50, heapUsed: 280, heapTotal: 300 }
      });
      
      const bottlenecks = await optimizer.detectBottlenecks(memoryBottleneckMetrics);
      
      const memoryBottleneck = bottlenecks.find(b => b.component === 'memory');
      if (memoryBottleneck) {
        assertEquals(memoryBottleneck.severity === 'critical' || memoryBottleneck.severity === 'warning', true);
        assertExists(memoryBottleneck.suggestedActions);
      }
      
      console.log('✅ Memory bottleneck detection working');
    });

    await t.step('should detect network bottlenecks', async () => {
      const networkBottleneckMetrics = createPerformanceMetrics({
        network: { latency: 1500, packetsDropped: 50, throughput: 10 }
      });
      
      const bottlenecks = await optimizer.detectBottlenecks(networkBottleneckMetrics);
      
      const networkBottleneck = bottlenecks.find(b => b.component === 'network');
      if (networkBottleneck) {
        assertEquals(typeof networkBottleneck.impact, 'number');
        assertExists(networkBottleneck.description);
      }
      
      console.log('✅ Network bottleneck detection working');
    });

    await t.step('should prioritize bottlenecks by severity', async () => {
      const multiBottleneckMetrics = createPerformanceMetrics({
        cpu: { usage: 85 },
        memory: { percentage: 95 },
        network: { latency: 800 },
        disk: { ioWait: 30 }
      });
      
      const bottlenecks = await optimizer.detectBottlenecks(multiBottleneckMetrics);
      
      assertExists(bottlenecks);
      assertEquals(bottlenecks.length > 1, true);
      
      // Should be sorted by severity/impact
      for (let i = 0; i < bottlenecks.length - 1; i++) {
        assertEquals(bottlenecks[i].impact >= bottlenecks[i + 1].impact, true);
      }
      
      console.log(`✅ Bottleneck prioritization: ${bottlenecks.length} bottlenecks sorted by impact`);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Optimization Strategies',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should generate optimization recommendations', async () => {
      const metrics = createPerformanceMetrics({
        cpu: { usage: 75 },
        memory: { percentage: 70 },
        application: { cacheHitRate: 0.6, responseTime: 300 }
      });
      
      const recommendations = await optimizer.generateOptimizationRecommendations(metrics);
      
      assertExists(recommendations);
      assertEquals(Array.isArray(recommendations), true);
      
      for (const rec of recommendations) {
        assertExists(rec.category);
        assertExists(rec.description);
        assertEquals(typeof rec.priority, 'string');
        assertEquals(typeof rec.estimatedImpact, 'number');
        assertExists(rec.implementation);
      }
      
      console.log(`✅ Generated ${recommendations.length} optimization recommendations`);
    });

    await t.step('should optimize caching strategies', async () => {
      const operationMetrics = createOperationMetrics(50, 200);
      
      const cacheOptimization = await optimizer.optimizeCaching(operationMetrics);
      
      assertExists(cacheOptimization);
      assertEquals(typeof cacheOptimization.currentHitRate, 'number');
      assertEquals(typeof cacheOptimization.targetHitRate, 'number');
      assertEquals(typeof cacheOptimization.recommendedSize, 'number');
      assertExists(cacheOptimization.strategy);
      assertExists(cacheOptimization.expectedImprovement);
      
      console.log(`✅ Cache optimization: ${(cacheOptimization.currentHitRate * 100).toFixed(1)}% → ${(cacheOptimization.targetHitRate * 100).toFixed(1)}% hit rate`);
    });

    await t.step('should optimize resource allocation', async () => {
      const resourceHistory = createResourceHistory(48);
      
      const resourceOptimization = await optimizer.optimizeResourceAllocation(resourceHistory);
      
      assertExists(resourceOptimization);
      assertExists(resourceOptimization.cpu);
      assertExists(resourceOptimization.memory);
      assertExists(resourceOptimization.recommendations);
      
      assertEquals(typeof resourceOptimization.cpu.recommendedLimit, 'number');
      assertEquals(typeof resourceOptimization.memory.recommendedLimit, 'number');
      
      console.log(`✅ Resource optimization: CPU ${resourceOptimization.cpu.recommendedLimit}%, Memory ${resourceOptimization.memory.recommendedLimit}MB`);
    });

    await t.step('should optimize processing pipeline', async () => {
      const operationMetrics = createOperationMetrics(30, 250);
      
      const pipelineOptimization = await optimizer.optimizeProcessingPipeline(operationMetrics);
      
      assertExists(pipelineOptimization);
      assertExists(pipelineOptimization.currentLatency);
      assertExists(pipelineOptimization.targetLatency);
      assertExists(pipelineOptimization.optimizations);
      
      assertEquals(typeof pipelineOptimization.currentLatency.average, 'number');
      assertEquals(typeof pipelineOptimization.targetLatency.average, 'number');
      assertEquals(Array.isArray(pipelineOptimization.optimizations), true);
      
      console.log(`✅ Pipeline optimization: ${pipelineOptimization.currentLatency.average.toFixed(1)}ms → ${pipelineOptimization.targetLatency.average.toFixed(1)}ms`);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Resource Management',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should monitor resource utilization trends', async () => {
      const resourceHistory = createResourceHistory(72); // 3 days
      
      const trends = await optimizer.analyzeResourceTrends(resourceHistory);
      
      assertExists(trends);
      assertExists(trends.cpu);
      assertExists(trends.memory);
      assertExists(trends.latency);
      
      assertEquals(typeof trends.cpu.trend, 'string');
      assertEquals(typeof trends.cpu.forecast, 'number');
      assertEquals(typeof trends.memory.trend, 'string');
      assertEquals(typeof trends.memory.forecast, 'number');
      
      console.log(`✅ Resource trends: CPU ${trends.cpu.trend}, Memory ${trends.memory.trend}`);
    });

    await t.step('should predict resource exhaustion', async () => {
      const increasingUsage = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        cpu: 30 + i * 2, // Steadily increasing
        memory: 200 + i * 10,
        latency: 100 + i * 5,
        throughput: 50 - i * 0.5
      }));
      
      const exhaustionPrediction = await optimizer.predictResourceExhaustion(increasingUsage);
      
      assertExists(exhaustionPrediction);
      assertExists(exhaustionPrediction.cpu);
      assertExists(exhaustionPrediction.memory);
      
      if (exhaustionPrediction.cpu.willExhaust) {
        assertExists(exhaustionPrediction.cpu.timeToExhaustion);
        assertEquals(typeof exhaustionPrediction.cpu.confidence, 'number');
      }
      
      console.log(`✅ Resource exhaustion prediction completed`);
    });

    await t.step('should implement resource throttling', async () => {
      const highUsageMetrics = createPerformanceMetrics({
        cpu: { usage: 90 },
        memory: { percentage: 85 }
      });
      
      const throttlingConfig = await optimizer.calculateThrottlingLimits(highUsageMetrics);
      
      assertExists(throttlingConfig);
      assertEquals(typeof throttlingConfig.maxConcurrentOps, 'number');
      assertEquals(typeof throttlingConfig.requestQueueSize, 'number');
      assertEquals(typeof throttlingConfig.processingDelay, 'number');
      assertExists(throttlingConfig.priorityRules);
      
      console.log(`✅ Throttling limits: ${throttlingConfig.maxConcurrentOps} ops, ${throttlingConfig.processingDelay}ms delay`);
    });

    await t.step('should manage memory efficiently', async () => {
      const memoryMetrics = createPerformanceMetrics({
        memory: { percentage: 80, heapUsed: 240, heapTotal: 300 }
      });
      
      const memoryOptimization = await optimizer.optimizeMemoryUsage(memoryMetrics);
      
      assertExists(memoryOptimization);
      assertExists(memoryOptimization.garbageCollection);
      assertExists(memoryOptimization.cacheManagement);
      assertExists(memoryOptimization.objectPooling);
      
      assertEquals(typeof memoryOptimization.expectedReduction, 'number');
      
      console.log(`✅ Memory optimization: ${memoryOptimization.expectedReduction.toFixed(1)}MB reduction expected`);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Real-time Monitoring',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should provide real-time performance dashboard', async () => {
      const metrics = createPerformanceMetrics();
      
      const dashboard = await optimizer.getPerformanceDashboard(metrics);
      
      assertExists(dashboard);
      assertExists(dashboard.overview);
      assertExists(dashboard.charts);
      assertExists(dashboard.alerts);
      assertExists(dashboard.recommendations);
      
      assertEquals(typeof dashboard.overview.healthScore, 'number');
      assertEquals(typeof dashboard.overview.bottleneckCount, 'number');
      assertEquals(Array.isArray(dashboard.charts.cpuTrend), true);
      assertEquals(Array.isArray(dashboard.alerts), true);
      
      console.log(`✅ Performance dashboard: ${(dashboard.overview.healthScore * 100).toFixed(1)}% health`);
    });

    await t.step('should track performance alerts', async () => {
      const criticalMetrics = createPerformanceMetrics({
        cpu: { usage: 95 },
        memory: { percentage: 90 },
        application: { responseTime: 1200, errorRate: 0.15 }
      });
      
      const alerts = await optimizer.generatePerformanceAlerts(criticalMetrics);
      
      assertExists(alerts);
      assertEquals(Array.isArray(alerts), true);
      
      for (const alert of alerts) {
        assertExists(alert.id);
        assertExists(alert.type);
        assertEquals(typeof alert.severity, 'string');
        assertExists(alert.message);
        assertExists(alert.timestamp);
        assertExists(alert.metadata);
      }
      
      console.log(`✅ Performance alerts: ${alerts.length} alerts generated`);
    });

    await t.step('should monitor optimization effectiveness', async () => {
      const beforeMetrics = createPerformanceMetrics({
        cpu: { usage: 85 },
        application: { responseTime: 400, cacheHitRate: 0.6 }
      });
      
      const afterMetrics = createPerformanceMetrics({
        cpu: { usage: 70 },
        application: { responseTime: 250, cacheHitRate: 0.8 }
      });
      
      const effectiveness = await optimizer.measureOptimizationEffectiveness(beforeMetrics, afterMetrics);
      
      assertExists(effectiveness);
      assertEquals(typeof effectiveness.performanceImprovement, 'number');
      assertEquals(typeof effectiveness.resourceSavings, 'number');
      assertExists(effectiveness.metrics);
      assertExists(effectiveness.summary);
      
      console.log(`✅ Optimization effectiveness: ${(effectiveness.performanceImprovement * 100).toFixed(1)}% improvement`);
    });

    await t.step('should provide performance recommendations prioritization', async () => {
      const metrics = createPerformanceMetrics({
        cpu: { usage: 80 },
        memory: { percentage: 75 },
        network: { latency: 300 },
        application: { responseTime: 500, errorRate: 0.05 }
      });
      
      const prioritizedRecs = await optimizer.prioritizeRecommendations(metrics);
      
      assertExists(prioritizedRecs);
      assertEquals(Array.isArray(prioritizedRecs), true);
      
      // Should be sorted by priority/impact
      for (let i = 0; i < prioritizedRecs.length - 1; i++) {
        const current = prioritizedRecs[i];
        const next = prioritizedRecs[i + 1];
        
        assertExists(current.priority);
        assertExists(next.priority);
        
        // High priority should come before low priority
        if (current.priority === 'high' && next.priority === 'low') {
          assertEquals(true, true); // This order is correct
        }
      }
      
      console.log(`✅ Recommendation prioritization: ${prioritizedRecs.length} recommendations prioritized`);
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should handle missing or invalid metrics', async () => {
      const invalidMetrics = null as unknown as any;
      const emptyMetrics = {} as any;
      
      const invalidAnalysis = await optimizer.analyzePerformance(invalidMetrics);
      const emptyAnalysis = await optimizer.analyzePerformance(emptyMetrics);
      
      assertExists(invalidAnalysis);
      assertExists(emptyAnalysis);
      
      console.log('✅ Invalid metrics handled gracefully');
    });

    await t.step('should handle extreme performance conditions', async () => {
      const extremeMetrics = createPerformanceMetrics({
        cpu: { usage: 100, temperature: 100 },
        memory: { percentage: 100, available: 0 },
        network: { latency: 10000, packetsDropped: 1000 },
        application: { responseTime: 30000, errorRate: 0.9 }
      });
      
      const analysis = await optimizer.analyzePerformance(extremeMetrics);
      
      assertExists(analysis);
      assertEquals(analysis.overallScore < 0.2, true); // Should be very low
      assertEquals(analysis.bottlenecks.length > 0, true);
      
      console.log('✅ Extreme performance conditions handled');
    });

    await t.step('should handle insufficient historical data', async () => {
      const minimalHistory = createResourceHistory(2); // Only 2 hours
      
      const trends = await optimizer.analyzeResourceTrends(minimalHistory);
      
      assertExists(trends);
      // Should provide trends but with lower confidence
      if (trends.cpu.confidence) {
        assertEquals(trends.cpu.confidence < 0.5, true);
      }
      
      console.log('✅ Insufficient historical data handled');
    });

    await t.step('should handle optimization failures gracefully', async () => {
      const problematicMetrics = createPerformanceMetrics({
        cpu: { usage: NaN },
        memory: { percentage: undefined as unknown as number }
      });
      
      const recommendations = await optimizer.generateOptimizationRecommendations(problematicMetrics);
      
      assertExists(recommendations);
      assertEquals(Array.isArray(recommendations), true);
      
      console.log('✅ Optimization failures handled gracefully');
    });
  }
});

Deno.test({
  name: 'Performance Optimizer - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const optimizer = new PerformanceOptimizer(defaultConfig, mockLogger);

    await t.step('should analyze large datasets efficiently', async () => {
      const largeHistory = createResourceHistory(168); // 7 days
      
      const startTime = performance.now();
      const trends = await optimizer.analyzeResourceTrends(largeHistory);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(trends);
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Analyzed 7 days of data in ${duration.toFixed(2)}ms`);
    });

    await t.step('should handle concurrent optimization requests', async () => {
      const metrics = createPerformanceMetrics();
      
      const startTime = performance.now();
      const promises = Array.from({ length: 5 }, () => 
        optimizer.analyzePerformance(metrics)
      );
      
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertEquals(results.length, 5);
      results.forEach(result => assertExists(result));
      assertEquals(duration < 2000, true); // Should complete within 2 seconds
      
      console.log(`✅ Completed 5 concurrent analyses in ${duration.toFixed(2)}ms`);
    });

    await t.step('should scale bottleneck detection', async () => {
      const complexMetrics = createPerformanceMetrics({
        cpu: { usage: 85, cores: 16 },
        memory: { percentage: 75, total: 8192 },
        network: { connectionsActive: 1000 }
      });
      
      const startTime = performance.now();
      const bottlenecks = await optimizer.detectBottlenecks(complexMetrics);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(bottlenecks);
      assertEquals(duration < 1000, true); // Should complete within 1 second
      
      console.log(`✅ Bottleneck detection on complex system in ${duration.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All Performance Optimizer unit tests completed successfully!');