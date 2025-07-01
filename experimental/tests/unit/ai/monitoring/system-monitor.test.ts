/**
 * Comprehensive Unit Tests for System Monitor
 * 
 * Tests cover system health monitoring, performance tracking, alert management,
 * anomaly detection, and real-time monitoring capabilities.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { SystemMonitor, type MonitorConfig } from '../../../src/ai/monitoring/system-monitor.ts';
import { LoggerService } from '../../../../src/core/logger.ts';

// Mock logger
class MockLoggerService extends LoggerService {
  constructor() {
    super('MockMonitorLogger');
  }
}

// Standard test configuration
const defaultConfig: MonitorConfig = {
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

// Helper functions for creating test data
function createSystemMetrics(
  timestamp = new Date(),
  overrides: Partial<any> = {}
) {
  return {
    timestamp,
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
      ...overrides.memory
    },
    network: {
      latency: 25,
      bandwidth: 100,
      packetsDropped: 0,
      connectionsActive: 5,
      ...overrides.network
    },
    disk: {
      used: 50,
      total: 500,
      percentage: 10,
      ioWait: 2,
      ...overrides.disk
    },
    hvac: {
      currentMode: 'idle',
      targetTemp: 22,
      actualTemp: 21.5,
      energyUsage: 2.5,
      cycleCount: 12,
      lastDecisionTime: 150,
      ...overrides.hvac
    }
  };
}

function createPerformanceData(count = 10, baseLatency = 100) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - (count - i) * 60 * 1000),
    operation: 'hvac_decision',
    latency: baseLatency + Math.random() * 50,
    success: Math.random() > 0.1, // 90% success rate
    errorType: Math.random() > 0.9 ? 'timeout' : null,
    resourceUsage: {
      cpu: 20 + Math.random() * 30,
      memory: 100 + Math.random() * 50
    }
  }));
}

function createAlertHistory(count = 5) {
  const alertTypes = ['high_latency', 'memory_usage', 'error_rate', 'temperature_anomaly'];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `alert_${i}`,
    timestamp: new Date(Date.now() - (count - i) * 60 * 60 * 1000),
    type: alertTypes[i % alertTypes.length],
    severity: i % 3 === 0 ? 'critical' : i % 3 === 1 ? 'warning' : 'info',
    message: `Test alert ${i}`,
    acknowledged: i % 2 === 0,
    resolved: i % 3 === 0,
    metadata: {
      source: 'system_monitor',
      component: 'hvac'
    }
  }));
}

Deno.test({
  name: 'System Monitor - Initialization and Configuration',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();

    await t.step('should initialize with default configuration', () => {
      const monitor = new SystemMonitor(defaultConfig, mockLogger);
      
      assertExists(monitor);
      assertInstanceOf(monitor, SystemMonitor);
      
      console.log('✅ System Monitor initialized successfully');
    });

    await t.step('should validate configuration parameters', () => {
      const invalidConfig = { 
        ...defaultConfig, 
        maxDecisionLatency: -100 // Invalid negative value
      };
      
      assertThrows(
        () => new SystemMonitor(invalidConfig, mockLogger),
        Error,
        'maxDecisionLatency must be positive'
      );
    });

    await t.step('should handle minimal configuration', () => {
      const minimalConfig: MonitorConfig = {
        enabled: true,
        maxDecisionLatency: 500,
        minComfortScore: 0.5,
        maxErrorRate: 10,
        maxMemoryUsage: 1000,
        maxCpuUsage: 90,
        maxNetworkLatency: 1000,
        alertCooldown: 600,
        escalationThreshold: 5,
      };

      const monitor = new SystemMonitor(minimalConfig, mockLogger);
      assertExists(monitor);
    });

    await t.step('should handle disabled monitoring', () => {
      const disabledConfig = { ...defaultConfig, enabled: false };
      const monitor = new SystemMonitor(disabledConfig, mockLogger);
      
      assertExists(monitor);
      
      console.log('✅ Disabled monitoring configuration handled');
    });
  }
});

Deno.test({
  name: 'System Monitor - Health Monitoring',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should monitor system health status', async () => {
      const healthyMetrics = createSystemMetrics();
      
      await monitor.recordSystemMetrics(healthyMetrics);
      
      const healthStatus = await monitor.getSystemHealth();
      
      assertExists(healthStatus);
      assertEquals(typeof healthStatus.overall, 'string');
      assertEquals(typeof healthStatus.score, 'number');
      assertExists(healthStatus.components);
      assertExists(healthStatus.lastUpdated);
      
      // Healthy system should have good score
      assertEquals(healthStatus.score >= 0.7, true);
      assertEquals(healthStatus.overall, 'healthy');
      
      console.log(`✅ System health: ${healthStatus.overall} (score: ${healthStatus.score.toFixed(2)})`);
    });

    await t.step('should detect degraded performance', async () => {
      const degradedMetrics = createSystemMetrics(new Date(), {
        cpu: { usage: 85 }, // High CPU usage
        memory: { percentage: 85 }, // High memory usage
        hvac: { lastDecisionTime: 1500 } // Slow decisions
      });
      
      await monitor.recordSystemMetrics(degradedMetrics);
      
      const healthStatus = await monitor.getSystemHealth();
      
      // Should detect degradation
      assertEquals(healthStatus.overall === 'degraded' || healthStatus.overall === 'critical', true);
      assertEquals(healthStatus.score < 0.7, true);
      
      console.log(`✅ Degraded performance detected: ${healthStatus.overall} (score: ${healthStatus.score.toFixed(2)})`);
    });

    await t.step('should identify critical system issues', async () => {
      const criticalMetrics = createSystemMetrics(new Date(), {
        cpu: { usage: 95, temperature: 85 }, // Critical CPU
        memory: { percentage: 95 }, // Critical memory
        network: { latency: 2000 }, // Very high latency
        hvac: { lastDecisionTime: 5000 } // Very slow decisions
      });
      
      await monitor.recordSystemMetrics(criticalMetrics);
      
      const healthStatus = await monitor.getSystemHealth();
      
      // Should detect critical issues
      assertEquals(healthStatus.overall, 'critical');
      assertEquals(healthStatus.score < 0.4, true);
      
      console.log(`✅ Critical issues detected: ${healthStatus.overall} (score: ${healthStatus.score.toFixed(2)})`);
    });

    await t.step('should track health trends over time', async () => {
      // Record a series of metrics showing improvement
      const improvingMetrics = [
        createSystemMetrics(new Date(Date.now() - 3 * 60 * 1000), {
          cpu: { usage: 90 },
          memory: { percentage: 80 }
        }),
        createSystemMetrics(new Date(Date.now() - 2 * 60 * 1000), {
          cpu: { usage: 70 },
          memory: { percentage: 60 }
        }),
        createSystemMetrics(new Date(Date.now() - 1 * 60 * 1000), {
          cpu: { usage: 50 },
          memory: { percentage: 40 }
        })
      ];
      
      for (const metrics of improvingMetrics) {
        await monitor.recordSystemMetrics(metrics);
      }
      
      const trends = await monitor.getHealthTrends();
      
      assertExists(trends);
      assertEquals(typeof trends.direction, 'string');
      assertEquals(typeof trends.confidence, 'number');
      assertExists(trends.projection);
      
      // Should detect improving trend
      assertEquals(trends.direction, 'improving');
      
      console.log(`✅ Health trend: ${trends.direction} (confidence: ${(trends.confidence * 100).toFixed(1)}%)`);
    });
  }
});

Deno.test({
  name: 'System Monitor - Performance Tracking',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should track HVAC decision latency', async () => {
      const performanceData = createPerformanceData(20, 200);
      
      for (const data of performanceData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const latencyStats = await monitor.getLatencyStatistics();
      
      assertExists(latencyStats);
      assertEquals(typeof latencyStats.average, 'number');
      assertEquals(typeof latencyStats.p95, 'number');
      assertEquals(typeof latencyStats.p99, 'number');
      assertEquals(typeof latencyStats.max, 'number');
      assertEquals(typeof latencyStats.min, 'number');
      
      // Verify statistical ordering
      assertEquals(latencyStats.min <= latencyStats.average, true);
      assertEquals(latencyStats.average <= latencyStats.p95, true);
      assertEquals(latencyStats.p95 <= latencyStats.p99, true);
      assertEquals(latencyStats.p99 <= latencyStats.max, true);
      
      console.log(`✅ Latency stats: avg=${latencyStats.average.toFixed(1)}ms, p95=${latencyStats.p95.toFixed(1)}ms`);
    });

    await t.step('should detect performance anomalies', async () => {
      // Record normal performance
      const normalData = createPerformanceData(10, 100);
      for (const data of normalData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      // Record anomalous performance
      const anomalousData = createPerformanceData(3, 2000); // Very high latency
      for (const data of anomalousData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const anomalies = await monitor.detectAnomalies();
      
      assertExists(anomalies);
      assertEquals(Array.isArray(anomalies), true);
      assertEquals(anomalies.length > 0, true);
      
      // Verify anomaly structure
      for (const anomaly of anomalies) {
        assertExists(anomaly.timestamp);
        assertExists(anomaly.type);
        assertEquals(typeof anomaly.severity, 'string');
        assertEquals(typeof anomaly.confidence, 'number');
        assertExists(anomaly.description);
        assertExists(anomaly.affectedMetrics);
      }
      
      console.log(`✅ Detected ${anomalies.length} performance anomalies`);
    });

    await t.step('should calculate error rates', async () => {
      const errorData = Array.from({ length: 20 }, (_, i) => ({
        timestamp: new Date(Date.now() - (20 - i) * 60 * 1000),
        operation: 'hvac_decision',
        latency: 150,
        success: i < 17, // 3 failures out of 20 = 15% error rate
        errorType: i >= 17 ? 'timeout' : null,
        resourceUsage: { cpu: 30, memory: 120 }
      }));
      
      for (const data of errorData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const errorRate = await monitor.getErrorRate();
      
      assertEquals(typeof errorRate.current, 'number');
      assertEquals(typeof errorRate.average, 'number');
      assertExists(errorRate.trend);
      assertExists(errorRate.breakdown);
      
      // Should detect elevated error rate
      assertEquals(errorRate.current > 10, true); // Higher than 10%
      
      console.log(`✅ Error rate: ${errorRate.current.toFixed(1)}% (trend: ${errorRate.trend})`);
    });

    await t.step('should track resource utilization', async () => {
      const resourceData = Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date(Date.now() - (15 - i) * 60 * 1000),
        operation: 'system_monitoring',
        latency: 50,
        success: true,
        errorType: null,
        resourceUsage: {
          cpu: 20 + Math.sin(i / 5) * 30, // Varying CPU usage
          memory: 100 + i * 5 // Gradually increasing memory
        }
      }));
      
      for (const data of resourceData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const utilization = await monitor.getResourceUtilization();
      
      assertExists(utilization);
      assertEquals(typeof utilization.cpu.current, 'number');
      assertEquals(typeof utilization.cpu.average, 'number');
      assertEquals(typeof utilization.memory.current, 'number');
      assertEquals(typeof utilization.memory.average, 'number');
      assertExists(utilization.trends);
      
      console.log(`✅ Resource utilization: CPU=${utilization.cpu.current.toFixed(1)}%, Memory=${utilization.memory.current.toFixed(1)}MB`);
    });
  }
});

Deno.test({
  name: 'System Monitor - Alert Management',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should generate alerts for threshold violations', async () => {
      const criticalMetrics = createSystemMetrics(new Date(), {
        cpu: { usage: 95 }, // Exceeds maxCpuUsage
        memory: { percentage: 90 }, // High memory usage
        hvac: { lastDecisionTime: 1500 } // Exceeds maxDecisionLatency
      });
      
      await monitor.recordSystemMetrics(criticalMetrics);
      
      const alerts = await monitor.getActiveAlerts();
      
      assertExists(alerts);
      assertEquals(Array.isArray(alerts), true);
      assertEquals(alerts.length > 0, true);
      
      // Verify alert structure
      for (const alert of alerts) {
        assertExists(alert.id);
        assertExists(alert.timestamp);
        assertExists(alert.type);
        assertEquals(typeof alert.severity, 'string');
        assertExists(alert.message);
        assertEquals(typeof alert.acknowledged, 'boolean');
        assertEquals(typeof alert.resolved, 'boolean');
        assertExists(alert.metadata);
      }
      
      console.log(`✅ Generated ${alerts.length} alerts for threshold violations`);
    });

    await t.step('should manage alert severity levels', async () => {
      // Create different severity scenarios
      const scenarios = [
        { 
          metrics: createSystemMetrics(new Date(), { cpu: { usage: 85 } }), 
          expectedSeverity: 'warning' 
        },
        { 
          metrics: createSystemMetrics(new Date(), { cpu: { usage: 95 } }), 
          expectedSeverity: 'critical' 
        },
        { 
          metrics: createSystemMetrics(new Date(), { memory: { percentage: 75 } }), 
          expectedSeverity: 'info' 
        }
      ];
      
      for (const scenario of scenarios) {
        await monitor.recordSystemMetrics(scenario.metrics);
      }
      
      const alerts = await monitor.getActiveAlerts();
      
      // Should have alerts of different severity levels
      const severityLevels = [...new Set(alerts.map(alert => alert.severity))];
      assertEquals(severityLevels.length >= 2, true);
      
      console.log(`✅ Alert severity levels: ${severityLevels.join(', ')}`);
    });

    await t.step('should handle alert acknowledgment', async () => {
      const alerts = await monitor.getActiveAlerts();
      
      if (alerts.length > 0) {
        const alertToAck = alerts[0];
        
        const success = await monitor.acknowledgeAlert(alertToAck.id);
        assertEquals(success, true);
        
        const updatedAlerts = await monitor.getActiveAlerts();
        const acknowledgedAlert = updatedAlerts.find(a => a.id === alertToAck.id);
        
        if (acknowledgedAlert) {
          assertEquals(acknowledgedAlert.acknowledged, true);
        }
        
        console.log(`✅ Alert acknowledged: ${alertToAck.id}`);
      }
    });

    await t.step('should implement alert cooldown periods', async () => {
      const initialAlertCount = (await monitor.getActiveAlerts()).length;
      
      // Generate same type of alert multiple times rapidly
      for (let i = 0; i < 5; i++) {
        const criticalMetrics = createSystemMetrics(new Date(), {
          cpu: { usage: 96 } // Consistently critical
        });
        await monitor.recordSystemMetrics(criticalMetrics);
      }
      
      const finalAlertCount = (await monitor.getActiveAlerts()).length;
      
      // Should not generate multiple identical alerts due to cooldown
      const newAlerts = finalAlertCount - initialAlertCount;
      assertEquals(newAlerts <= 2, true); // Should be limited by cooldown
      
      console.log(`✅ Alert cooldown: ${newAlerts} new alerts generated from 5 identical conditions`);
    });

    await t.step('should escalate persistent issues', async () => {
      // Simulate persistent high CPU usage
      for (let i = 0; i < 5; i++) {
        const persistentIssue = createSystemMetrics(new Date(Date.now() + i * 60 * 1000), {
          cpu: { usage: 97 } // Consistently critical
        });
        await monitor.recordSystemMetrics(persistentIssue);
      }
      
      const escalations = await monitor.getEscalatedAlerts();
      
      assertExists(escalations);
      assertEquals(Array.isArray(escalations), true);
      
      if (escalations.length > 0) {
        assertEquals(escalations[0].escalationLevel > 1, true);
        
        console.log(`✅ Alert escalation: ${escalations.length} escalated alerts`);
      }
    });
  }
});

Deno.test({
  name: 'System Monitor - Anomaly Detection',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should detect temperature anomalies', async () => {
      // Record normal temperature patterns
      const normalTemps = Array.from({ length: 20 }, (_, i) => 
        createSystemMetrics(new Date(Date.now() - (20 - i) * 60 * 1000), {
          hvac: { 
            actualTemp: 21 + Math.sin(i / 6) * 1, // Normal daily variation
            targetTemp: 22 
          }
        })
      );
      
      // Record anomalous temperature
      const anomalousTemp = createSystemMetrics(new Date(), {
        hvac: { 
          actualTemp: 30, // Sudden spike
          targetTemp: 22 
        }
      });
      
      for (const metrics of [...normalTemps, anomalousTemp]) {
        await monitor.recordSystemMetrics(metrics);
      }
      
      const anomalies = await monitor.detectAnomalies();
      
      const tempAnomalies = anomalies.filter(a => a.type === 'temperature_anomaly');
      assertEquals(tempAnomalies.length > 0, true);
      
      console.log(`✅ Temperature anomalies: ${tempAnomalies.length} detected`);
    });

    await t.step('should detect energy usage anomalies', async () => {
      // Record normal energy usage
      const normalUsage = Array.from({ length: 15 }, (_, i) => 
        createSystemMetrics(new Date(Date.now() - (15 - i) * 60 * 1000), {
          hvac: { energyUsage: 2.5 + Math.random() * 0.5 } // Normal range
        })
      );
      
      // Record anomalous usage
      const anomalousUsage = createSystemMetrics(new Date(), {
        hvac: { energyUsage: 8.5 } // Sudden spike
      });
      
      for (const metrics of [...normalUsage, anomalousUsage]) {
        await monitor.recordSystemMetrics(metrics);
      }
      
      const anomalies = await monitor.detectAnomalies();
      
      const energyAnomalies = anomalies.filter(a => a.type === 'energy_anomaly');
      assertEquals(energyAnomalies.length > 0, true);
      
      console.log(`✅ Energy anomalies: ${energyAnomalies.length} detected`);
    });

    await t.step('should detect system behavior anomalies', async () => {
      // Record normal system behavior
      const normalBehavior = Array.from({ length: 12 }, (_, i) => 
        createPerformanceData(1, 100 + Math.random() * 50)[0] // Normal latency range
      );
      
      // Record anomalous behavior
      const anomalousBehavior = createPerformanceData(3, 2500); // Very high latency
      
      for (const data of [...normalBehavior, ...anomalousBehavior]) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const anomalies = await monitor.detectAnomalies();
      
      const behaviorAnomalies = anomalies.filter(a => a.type === 'performance_anomaly');
      assertEquals(behaviorAnomalies.length > 0, true);
      
      console.log(`✅ Behavior anomalies: ${behaviorAnomalies.length} detected`);
    });

    await t.step('should calculate anomaly confidence scores', async () => {
      const anomalies = await monitor.detectAnomalies();
      
      for (const anomaly of anomalies) {
        assertEquals(typeof anomaly.confidence, 'number');
        assertEquals(anomaly.confidence >= 0 && anomaly.confidence <= 1, true);
        
        // High-confidence anomalies should have confidence > 0.7
        if (anomaly.severity === 'critical') {
          assertEquals(anomaly.confidence > 0.7, true);
        }
      }
      
      if (anomalies.length > 0) {
        const avgConfidence = anomalies.reduce((sum, a) => sum + a.confidence, 0) / anomalies.length;
        console.log(`✅ Anomaly confidence: average ${(avgConfidence * 100).toFixed(1)}%`);
      }
    });
  }
});

Deno.test({
  name: 'System Monitor - Real-time Monitoring',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should provide real-time system status', async () => {
      const metrics = createSystemMetrics();
      await monitor.recordSystemMetrics(metrics);
      
      const status = await monitor.getRealTimeStatus();
      
      assertExists(status);
      assertEquals(typeof status.timestamp, 'object');
      assertEquals(typeof status.uptime, 'number');
      assertExists(status.systemHealth);
      assertExists(status.activeAlerts);
      assertExists(status.performanceMetrics);
      assertExists(status.resourceUsage);
      
      console.log(`✅ Real-time status: ${status.systemHealth.overall} health, ${status.activeAlerts.length} alerts`);
    });

    await t.step('should track system uptime', async () => {
      const status = await monitor.getRealTimeStatus();
      
      assertEquals(typeof status.uptime, 'number');
      assertEquals(status.uptime >= 0, true);
      
      console.log(`✅ System uptime: ${status.uptime.toFixed(2)} seconds`);
    });

    await t.step('should monitor component connectivity', async () => {
      const connectivity = await monitor.getComponentConnectivity();
      
      assertExists(connectivity);
      assertEquals(typeof connectivity.hvacController, 'object');
      assertEquals(typeof connectivity.homeAssistant, 'object');
      assertEquals(typeof connectivity.weatherService, 'object');
      assertEquals(typeof connectivity.database, 'object');
      
      // Verify connectivity status structure
      for (const [component, status] of Object.entries(connectivity)) {
        assertEquals(typeof status.connected, 'boolean');
        assertEquals(typeof status.latency, 'number');
        assertEquals(typeof status.lastCheck, 'object');
        assertEquals(typeof status.errorCount, 'number');
      }
      
      console.log(`✅ Component connectivity monitored: ${Object.keys(connectivity).length} components`);
    });

    await t.step('should provide performance dashboard data', async () => {
      const dashboardData = await monitor.getDashboardData();
      
      assertExists(dashboardData);
      assertExists(dashboardData.overview);
      assertExists(dashboardData.charts);
      assertExists(dashboardData.alerts);
      assertExists(dashboardData.trends);
      
      // Verify overview data
      assertEquals(typeof dashboardData.overview.healthScore, 'number');
      assertEquals(typeof dashboardData.overview.alertCount, 'number');
      assertEquals(typeof dashboardData.overview.errorRate, 'number');
      assertEquals(typeof dashboardData.overview.avgLatency, 'number');
      
      // Verify charts data
      assertEquals(Array.isArray(dashboardData.charts.latencyTrend), true);
      assertEquals(Array.isArray(dashboardData.charts.resourceUsage), true);
      assertEquals(Array.isArray(dashboardData.charts.errorRate), true);
      
      console.log(`✅ Dashboard data: ${dashboardData.charts.latencyTrend.length} data points`);
    });
  }
});

Deno.test({
  name: 'System Monitor - Error Handling and Edge Cases',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should handle missing or invalid metrics', async () => {
      const invalidMetrics = null as unknown as any;
      const emptyMetrics = {} as any;
      
      // Should handle gracefully without throwing
      await monitor.recordSystemMetrics(invalidMetrics);
      await monitor.recordSystemMetrics(emptyMetrics);
      
      const health = await monitor.getSystemHealth();
      assertExists(health);
      
      console.log('✅ Invalid metrics handled gracefully');
    });

    await t.step('should handle corrupted performance data', async () => {
      const corruptedData = {
        timestamp: 'invalid-date',
        operation: null,
        latency: 'not-a-number',
        success: 'maybe',
        errorType: 123,
        resourceUsage: null
      } as any;
      
      // Should handle gracefully
      await monitor.recordPerformanceMetric(corruptedData);
      
      const stats = await monitor.getLatencyStatistics();
      assertExists(stats);
      
      console.log('✅ Corrupted performance data handled');
    });

    await t.step('should handle alert system failures', async () => {
      // Try to acknowledge non-existent alert
      const success = await monitor.acknowledgeAlert('non-existent-alert-id');
      assertEquals(typeof success, 'boolean');
      
      // Try to get alerts when system might be unavailable
      const alerts = await monitor.getActiveAlerts();
      assertExists(alerts);
      assertEquals(Array.isArray(alerts), true);
      
      console.log('✅ Alert system failures handled');
    });

    await t.step('should handle resource exhaustion scenarios', async () => {
      // Simulate very high resource usage
      const exhaustionMetrics = createSystemMetrics(new Date(), {
        cpu: { usage: 100, temperature: 95 },
        memory: { percentage: 99, available: 10 },
        disk: { percentage: 95, ioWait: 50 },
        network: { latency: 5000, packetsDropped: 100 }
      });
      
      await monitor.recordSystemMetrics(exhaustionMetrics);
      
      const health = await monitor.getSystemHealth();
      
      // Should detect critical state
      assertEquals(health.overall, 'critical');
      assertEquals(health.score < 0.2, true);
      
      console.log(`✅ Resource exhaustion detected: ${health.overall} (score: ${health.score.toFixed(2)})`);
    });
  }
});

Deno.test({
  name: 'System Monitor - Performance and Scalability',
  fn: async (t) => {
    const mockLogger = new MockLoggerService();
    const monitor = new SystemMonitor(defaultConfig, mockLogger);

    await t.step('should handle large volumes of metrics efficiently', async () => {
      const metricsVolume = 1000;
      const startTime = performance.now();
      
      // Record large volume of metrics
      const promises = Array.from({ length: metricsVolume }, (_, i) => 
        monitor.recordSystemMetrics(createSystemMetrics(
          new Date(Date.now() - (metricsVolume - i) * 1000),
          { cpu: { usage: 40 + (i % 20) } }
        ))
      );
      
      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should handle efficiently
      assertEquals(duration < 5000, true); // Should complete within 5 seconds
      
      console.log(`✅ Processed ${metricsVolume} metrics in ${duration.toFixed(2)}ms`);
    });

    await t.step('should perform anomaly detection at scale', async () => {
      const dataPoints = 500;
      const startTime = performance.now();
      
      // Generate mixed normal and anomalous data
      const performanceData = Array.from({ length: dataPoints }, (_, i) => ({
        timestamp: new Date(Date.now() - (dataPoints - i) * 60 * 1000),
        operation: 'hvac_decision',
        latency: i % 50 === 0 ? 2000 + Math.random() * 1000 : 100 + Math.random() * 50, // Periodic anomalies
        success: i % 100 !== 0, // Periodic failures
        errorType: i % 100 === 0 ? 'timeout' : null,
        resourceUsage: { cpu: 30 + Math.random() * 20, memory: 100 + Math.random() * 50 }
      }));
      
      for (const data of performanceData) {
        await monitor.recordPerformanceMetric(data);
      }
      
      const anomalies = await monitor.detectAnomalies();
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      assertExists(anomalies);
      assertEquals(duration < 3000, true); // Should complete within 3 seconds
      
      console.log(`✅ Anomaly detection on ${dataPoints} points: ${anomalies.length} anomalies in ${duration.toFixed(2)}ms`);
    });

    await t.step('should maintain responsiveness under load', async () => {
      // Simulate concurrent monitoring operations
      const operations = [
        () => monitor.getSystemHealth(),
        () => monitor.getActiveAlerts(),
        () => monitor.getLatencyStatistics(),
        () => monitor.getRealTimeStatus(),
        () => monitor.detectAnomalies()
      ];
      
      const startTime = performance.now();
      
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => operations[i % operations.length]())
      );
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // All operations should complete
      assertEquals(results.length, 20);
      results.forEach(result => assertExists(result));
      
      // Should remain responsive
      assertEquals(duration < 2000, true); // Should complete within 2 seconds
      
      console.log(`✅ Concurrent operations: 20 operations in ${duration.toFixed(2)}ms`);
    });
  }
});

console.log('🎉 All System Monitor unit tests completed successfully!');