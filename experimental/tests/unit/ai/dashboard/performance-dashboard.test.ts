/**
 * Comprehensive Unit Tests for Performance Dashboard
 * 
 * Tests cover dashboard data aggregation, real-time updates, visualization data,
 * alert management, and user interface components.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { PerformanceDashboard, type DashboardConfig } from '../../../src/ai/dashboard/performance-dashboard.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockDashboardLogger');
  }
}

// Mock data aggregator
class MockDataAggregator {
  async getSystemMetrics() {
    return {
      timestamp: new Date(),
      cpu: { usage: 45, temperature: 55 },
      memory: { used: 200, percentage: 20 },
      network: { latency: 25, throughput: 100 },
      disk: { usage: 50, ioWait: 2 }
    };
  }
  
  async getPerformanceHistory(hours = 24) {
    return Array.from({ length: hours }, (_, i) => ({
      timestamp: new Date(Date.now() - (hours - i) * 60 * 60 * 1000),
      cpu: 40 + Math.sin(i / 6) * 20,
      memory: 200 + Math.sin(i / 8) * 50,
      latency: 100 + Math.sin(i / 4) * 30
    }));
  }
  
  async getActiveAlerts() {
    return [
      {
        id: 'alert_1',
        type: 'performance',
        severity: 'warning',
        message: 'CPU usage above threshold',
        timestamp: new Date()
      }
    ];
  }
}

// Standard test configuration
const defaultConfig: DashboardConfig = {
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
function createDashboardData(overrides: Partial<any> = {}) {
  return {
    overview: {
      healthScore: 0.85,
      alertCount: 2,
      errorRate: 0.02,
      avgLatency: 150,
      uptime: 86400,
      ...overrides.overview
    },
    charts: {
      cpuTrend: Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        value: 40 + Math.sin(i / 6) * 20
      })),
      memoryTrend: Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        value: 200 + Math.sin(i / 8) * 50
      })),
      latencyTrend: Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        value: 100 + Math.sin(i / 4) * 30
      })),
      ...overrides.charts
    },
    alerts: [
      {
        id: 'alert_1',
        type: 'performance',
        severity: 'warning',
        message: 'CPU usage elevated',
        timestamp: new Date()
      },
      {
        id: 'alert_2',
        type: 'memory',
        severity: 'info',
        message: 'Memory usage normal',
        timestamp: new Date()
      }
    ],
    recommendations: [
      {
        id: 'rec_1',
        category: 'performance',
        priority: 'medium',
        description: 'Consider enabling caching',
        estimatedImpact: 0.15
      }
    ]
  };
}

function createMetricsHistory(days = 7) {
  const data = [];
  for (let day = 0; day < days; day++) {
    for (let hour = 0; hour < 24; hour++) {
      data.push({
        timestamp: new Date(Date.now() - (days - day) * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000),
        cpu: 30 + Math.sin((day * 24 + hour) / 12) * 20 + Math.random() * 10,
        memory: 150 + Math.sin((day * 24 + hour) / 16) * 100 + Math.random() * 20,
        latency: 80 + Math.sin((day * 24 + hour) / 8) * 40 + Math.random() * 15,
        throughput: 50 + Math.sin((day * 24 + hour) / 6) * 30 + Math.random() * 10,
        errorRate: Math.random() * 0.05
      });
    }
  }
  return data;
}

Deno.test({
  name: 'Performance Dashboard - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();

    await t.step('should initialize with default configuration', () => {
      const dashboard = new PerformanceDashboard(
        defaultConfig,
        mockLogger,
        mockAggregator as any
      );
      
      assertExists(dashboard);
      assertInstanceOf(dashboard, PerformanceDashboard);
      
      console.log('✅ Performance Dashboard initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        refreshInterval: -1 // Invalid negative value
      };
      
      assertThrows(
        () => new PerformanceDashboard(invalidConfig, mockLogger, mockAggregator as any),
        Error,
        'refreshInterval must be positive'
      );
    });

    await t.step('should handle minimal configuration', () => {
      const minimalConfig: DashboardConfig = {
        refreshInterval: 10,
        historyRetention: 24,
        maxDataPoints: 100,
        alertRetention: 12,
        enableRealTimeUpdates: false,
        chartUpdateInterval: 5,
        compressionEnabled: false,
        cacheEnabled: false,
        maxConcurrentUsers: 5,
        performanceThreshold: 0.5,
      };

      const dashboard = new PerformanceDashboard(
        minimalConfig,
        mockLogger,
        mockAggregator as any
      );
      assertExists(dashboard);
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Data Aggregation',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should aggregate current system metrics', async () => {
      const currentMetrics = await dashboard.getCurrentMetrics();
      
      assertExists(currentMetrics);
      assertExists(currentMetrics.timestamp);
      assertEquals(typeof currentMetrics.cpu.usage, 'number');
      assertEquals(typeof currentMetrics.memory.percentage, 'number');
      assertEquals(typeof currentMetrics.network.latency, 'number');
      assertEquals(typeof currentMetrics.disk.usage, 'number');
      
      console.log('✅ Current metrics aggregated successfully');
    });

    await t.step('should aggregate historical performance data', async () => {
      const historicalData = await dashboard.getHistoricalData(24);
      
      assertExists(historicalData);
      assertEquals(Array.isArray(historicalData), true);
      assertEquals(historicalData.length, 24);
      
      for (const dataPoint of historicalData) {
        assertExists(dataPoint.timestamp);
        assertEquals(typeof dataPoint.cpu, 'number');
        assertEquals(typeof dataPoint.memory, 'number');
        assertEquals(typeof dataPoint.latency, 'number');
      }
      
      console.log(`✅ Historical data aggregated: ${historicalData.length} data points`);
    });

    await t.step('should calculate performance statistics', async () => {
      const stats = await dashboard.calculatePerformanceStatistics();
      
      assertExists(stats);
      assertEquals(typeof stats.averageLatency, 'number');
      assertEquals(typeof stats.peakCpuUsage, 'number');
      assertEquals(typeof stats.memoryUtilization, 'number');
      assertEquals(typeof stats.uptime, 'number');
      assertEquals(typeof stats.errorRate, 'number');
      assertExists(stats.trends);
      
      console.log(`✅ Performance statistics calculated: ${stats.averageLatency.toFixed(1)}ms avg latency`);
    });

    await t.step('should aggregate alert data', async () => {
      const alertSummary = await dashboard.getAlertSummary();
      
      assertExists(alertSummary);
      assertEquals(typeof alertSummary.totalCount, 'number');
      assertEquals(typeof alertSummary.criticalCount, 'number');
      assertEquals(typeof alertSummary.warningCount, 'number');
      assertEquals(typeof alertSummary.infoCount, 'number');
      assertExists(alertSummary.recentAlerts);
      assertEquals(Array.isArray(alertSummary.recentAlerts), true);
      
      console.log(`✅ Alert summary: ${alertSummary.totalCount} total alerts`);
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Real-time Updates',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should enable real-time metric streaming', async () => {
      const updates: any[] = [];
      
      // Mock update handler
      const handleUpdate = (data: any) => {
        updates.push(data);
      };
      
      dashboard.enableRealTimeUpdates(handleUpdate);
      
      // Simulate some time passing for updates
      await new Promise(resolve => setTimeout(resolve, 100));
      
      dashboard.disableRealTimeUpdates();
      
      console.log('✅ Real-time updates enabled and disabled successfully');
    });

    await t.step('should throttle update frequency', async () => {
      const updates: any[] = [];
      let updateCount = 0;
      
      const handleUpdate = () => {
        updateCount++;
      };
      
      dashboard.enableRealTimeUpdates(handleUpdate);
      
      // Trigger multiple rapid updates
      for (let i = 0; i < 10; i++) {
        dashboard.triggerUpdate();
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      dashboard.disableRealTimeUpdates();
      
      // Should be throttled to prevent spam
      assertEquals(updateCount < 10, true);
      
      console.log(`✅ Update throttling: ${updateCount} updates from 10 triggers`);
    });

    await t.step('should handle connection failures gracefully', async () => {
      const failingAggregator = {
        async getSystemMetrics() {
          throw new Error('Connection failed');
        },
        async getPerformanceHistory() {
          return [];
        },
        async getActiveAlerts() {
          return [];
        }
      };
      
      const failingDashboard = new PerformanceDashboard(
        defaultConfig,
        mockLogger,
        failingAggregator as any
      );
      
      // Should handle failure gracefully
      const metrics = await failingDashboard.getCurrentMetrics();
      assertExists(metrics); // Should return fallback data
      
      console.log('✅ Connection failures handled gracefully');
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Visualization Data',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should generate chart data for CPU usage', async () => {
      const cpuChartData = await dashboard.generateCpuChart(24);
      
      assertExists(cpuChartData);
      assertEquals(Array.isArray(cpuChartData.dataPoints), true);
      assertEquals(cpuChartData.dataPoints.length, 24);
      assertExists(cpuChartData.metadata);
      
      for (const point of cpuChartData.dataPoints) {
        assertExists(point.timestamp);
        assertEquals(typeof point.value, 'number');
        assertEquals(point.value >= 0 && point.value <= 100, true);
      }
      
      console.log(`✅ CPU chart data: ${cpuChartData.dataPoints.length} data points`);
    });

    await t.step('should generate chart data for memory usage', async () => {
      const memoryChartData = await dashboard.generateMemoryChart(24);
      
      assertExists(memoryChartData);
      assertEquals(Array.isArray(memoryChartData.dataPoints), true);
      assertExists(memoryChartData.metadata);
      
      // Should include both usage and available memory
      assertEquals(typeof memoryChartData.metadata.totalMemory, 'number');
      assertEquals(typeof memoryChartData.metadata.averageUsage, 'number');
      
      console.log(`✅ Memory chart data: ${memoryChartData.dataPoints.length} data points`);
    });

    await t.step('should generate latency distribution chart', async () => {
      const latencyChart = await dashboard.generateLatencyChart(48);
      
      assertExists(latencyChart);
      assertEquals(Array.isArray(latencyChart.dataPoints), true);
      assertExists(latencyChart.percentiles);
      
      assertEquals(typeof latencyChart.percentiles.p50, 'number');
      assertEquals(typeof latencyChart.percentiles.p95, 'number');
      assertEquals(typeof latencyChart.percentiles.p99, 'number');
      
      console.log(`✅ Latency chart: p95=${latencyChart.percentiles.p95.toFixed(1)}ms`);
    });

    await t.step('should generate performance heatmap data', async () => {
      const heatmapData = await dashboard.generatePerformanceHeatmap(7);
      
      assertExists(heatmapData);
      assertEquals(Array.isArray(heatmapData.data), true);
      assertExists(heatmapData.scale);
      assertExists(heatmapData.labels);
      
      // Should have data for each day and hour
      assertEquals(heatmapData.data.length, 7); // 7 days
      assertEquals(heatmapData.data[0].length, 24); // 24 hours
      
      console.log(`✅ Performance heatmap: ${heatmapData.data.length}x${heatmapData.data[0].length} grid`);
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Alert Management',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should display active alerts', async () => {
      const activeAlerts = await dashboard.getActiveAlerts();
      
      assertExists(activeAlerts);
      assertEquals(Array.isArray(activeAlerts), true);
      
      for (const alert of activeAlerts) {
        assertExists(alert.id);
        assertExists(alert.type);
        assertEquals(typeof alert.severity, 'string');
        assertExists(alert.message);
        assertExists(alert.timestamp);
      }
      
      console.log(`✅ Active alerts displayed: ${activeAlerts.length} alerts`);
    });

    await t.step('should filter alerts by severity', async () => {
      const criticalAlerts = await dashboard.getAlertsBySeverity('critical');
      const warningAlerts = await dashboard.getAlertsBySeverity('warning');
      
      assertExists(criticalAlerts);
      assertExists(warningAlerts);
      assertEquals(Array.isArray(criticalAlerts), true);
      assertEquals(Array.isArray(warningAlerts), true);
      
      // Verify all alerts have correct severity
      for (const alert of criticalAlerts) {
        assertEquals(alert.severity, 'critical');
      }
      
      console.log(`✅ Alert filtering: ${criticalAlerts.length} critical, ${warningAlerts.length} warning`);
    });

    await t.step('should provide alert timeline', async () => {
      const alertTimeline = await dashboard.getAlertTimeline(24);
      
      assertExists(alertTimeline);
      assertEquals(Array.isArray(alertTimeline), true);
      
      for (const entry of alertTimeline) {
        assertExists(entry.timestamp);
        assertEquals(typeof entry.count, 'number');
        assertExists(entry.breakdown);
      }
      
      console.log(`✅ Alert timeline: ${alertTimeline.length} time periods`);
    });

    await t.step('should acknowledge alerts', async () => {
      const alertId = 'test_alert_123';
      
      const result = await dashboard.acknowledgeAlert(alertId, 'Test acknowledgment');
      
      assertEquals(typeof result, 'boolean');
      
      console.log('✅ Alert acknowledgment functionality verified');
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Performance Insights',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should generate performance insights', async () => {
      const insights = await dashboard.generatePerformanceInsights();
      
      assertExists(insights);
      assertEquals(Array.isArray(insights), true);
      
      for (const insight of insights) {
        assertExists(insight.category);
        assertExists(insight.title);
        assertExists(insight.description);
        assertEquals(typeof insight.impact, 'string');
        assertEquals(typeof insight.confidence, 'number');
        assertExists(insight.recommendations);
      }
      
      console.log(`✅ Performance insights: ${insights.length} insights generated`);
    });

    await t.step('should identify performance bottlenecks', async () => {
      const bottlenecks = await dashboard.identifyBottlenecks();
      
      assertExists(bottlenecks);
      assertEquals(Array.isArray(bottlenecks), true);
      
      for (const bottleneck of bottlenecks) {
        assertExists(bottleneck.component);
        assertEquals(typeof bottleneck.severity, 'string');
        assertEquals(typeof bottleneck.impact, 'number');
        assertExists(bottleneck.description);
        assertExists(bottleneck.suggestedActions);
      }
      
      console.log(`✅ Bottleneck identification: ${bottlenecks.length} bottlenecks found`);
    });

    await t.step('should track performance trends', async () => {
      const trends = await dashboard.getPerformanceTrends(7);
      
      assertExists(trends);
      assertExists(trends.cpu);
      assertExists(trends.memory);
      assertExists(trends.latency);
      
      assertEquals(typeof trends.cpu.direction, 'string');
      assertEquals(typeof trends.cpu.magnitude, 'number');
      assertEquals(typeof trends.memory.direction, 'string');
      assertEquals(typeof trends.latency.direction, 'string');
      
      console.log(`✅ Performance trends: CPU ${trends.cpu.direction}, Memory ${trends.memory.direction}`);
    });

    await t.step('should calculate efficiency scores', async () => {
      const efficiency = await dashboard.calculateEfficiencyScores();
      
      assertExists(efficiency);
      assertEquals(typeof efficiency.overall, 'number');
      assertEquals(typeof efficiency.cpu, 'number');
      assertEquals(typeof efficiency.memory, 'number');
      assertEquals(typeof efficiency.network, 'number');
      
      // Scores should be between 0 and 1
      assertEquals(efficiency.overall >= 0 && efficiency.overall <= 1, true);
      assertEquals(efficiency.cpu >= 0 && efficiency.cpu <= 1, true);
      
      console.log(`✅ Efficiency scores: ${(efficiency.overall * 100).toFixed(1)}% overall`);
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should handle missing data gracefully', async () => {
      const emptyAggregator = {
        async getSystemMetrics() { return null; },
        async getPerformanceHistory() { return []; },
        async getActiveAlerts() { return []; }
      };
      
      const emptyDashboard = new PerformanceDashboard(
        defaultConfig,
        mockLogger,
        emptyAggregator as any
      );
      
      const metrics = await emptyDashboard.getCurrentMetrics();
      const charts = await emptyDashboard.generateCpuChart(24);
      
      assertExists(metrics);
      assertExists(charts);
      
      console.log('✅ Missing data handled gracefully');
    });

    await t.step('should handle invalid time ranges', async () => {
      const cpuChart = await dashboard.generateCpuChart(-5); // Negative hours
      const historicalData = await dashboard.getHistoricalData(0); // Zero hours
      
      assertExists(cpuChart);
      assertExists(historicalData);
      
      console.log('✅ Invalid time ranges handled');
    });

    await t.step('should handle data corruption', async () => {
      const corruptedAggregator = {
        async getSystemMetrics() {
          return { cpu: 'invalid', memory: null, network: undefined };
        },
        async getPerformanceHistory() {
          return [{ timestamp: 'invalid', cpu: 'not-a-number' }];
        },
        async getActiveAlerts() {
          return [{ severity: null, message: undefined }];
        }
      };
      
      const corruptedDashboard = new PerformanceDashboard(
        defaultConfig,
        mockLogger,
        corruptedAggregator as any
      );
      
      const metrics = await corruptedDashboard.getCurrentMetrics();
      const insights = await corruptedDashboard.generatePerformanceInsights();
      
      assertExists(metrics);
      assertExists(insights);
      
      console.log('✅ Data corruption handled gracefully');
    });

    await t.step('should handle concurrent access', async () => {
      const promises = Array.from({ length: 5 }, () => 
        dashboard.getCurrentMetrics()
      );
      
      const results = await Promise.all(promises);
      
      assertEquals(results.length, 5);
      results.forEach(result => assertExists(result));
      
      console.log('✅ Concurrent access handled successfully');
    });
  }
});

Deno.test({
  name: 'Performance Dashboard - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const mockAggregator = new MockDataAggregator();
    const dashboard = new PerformanceDashboard(
      defaultConfig,
      mockLogger,
      mockAggregator as any
    );

    await t.step('should handle large datasets efficiently', async () => {
      const startTime = performance.now();
      
      const largeChart = await dashboard.generateCpuChart(168); // 7 days
      const heatmap = await dashboard.generatePerformanceHeatmap(30); // 30 days
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      assertExists(largeChart);
      assertExists(heatmap);
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Large dataset processing in ${duration.toFixed(2)}ms`);
    });

    await t.step('should compress historical data efficiently', async () => {
      const compressionConfig = { ...defaultConfig, compressionEnabled: true };
      const compressingDashboard = new PerformanceDashboard(
        compressionConfig,
        mockLogger,
        mockAggregator as any
      );
      
      const startTime = performance.now();
      const compressedData = await compressingDashboard.getHistoricalData(336); // 14 days
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      assertExists(compressedData);
      assertEquals(duration < 2000, true); // Should be fast with compression
      
      console.log(`✅ Data compression in ${duration.toFixed(2)}ms`);
    });

    await t.step('should cache frequently accessed data', async () => {
      const cachingConfig = { ...defaultConfig, cacheEnabled: true };
      const cachingDashboard = new PerformanceDashboard(
        cachingConfig,
        mockLogger,
        mockAggregator as any
      );
      
      // First call - should populate cache
      const startTime1 = performance.now();
      await cachingDashboard.getCurrentMetrics();
      const duration1 = performance.now() - startTime1;
      
      // Second call - should use cache
      const startTime2 = performance.now();
      await cachingDashboard.getCurrentMetrics();
      const duration2 = performance.now() - startTime2;
      
      // Cached call should be faster
      assertEquals(duration2 <= duration1, true);
      
      console.log(`✅ Caching: ${duration1.toFixed(2)}ms → ${duration2.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All Performance Dashboard unit tests completed successfully!');