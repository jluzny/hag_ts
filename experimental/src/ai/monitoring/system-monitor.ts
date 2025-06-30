/**
 * System Monitor for HVAC AI Operations
 *
 * This module provides comprehensive monitoring, metrics collection,
 * and real-time analytics for the AI-enhanced HVAC system.
 */

import type { LoggerService } from '../../../../src/core/logger.ts';

/**
 * System performance metrics
 */
export interface SystemMetrics {
  timestamp: Date;

  // AI component performance
  aiDecisionLatency: number; // ms
  optimizationLatency: number; // ms
  predictionAccuracy: number; // 0.0 to 1.0
  learningEfficiency: number; // 0.0 to 1.0

  // HVAC system performance
  energyEfficiency: number; // 0.0 to 1.0
  comfortScore: number; // 0.0 to 1.0
  systemUptime: number; // hours
  cycleCount: number;

  // Resource utilization
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
  networkLatency: number; // ms

  // Error rates
  errorRate: number; // errors per hour
  healthStatus: 'healthy' | 'warning' | 'critical';
}

/**
 * Component health status
 */
export interface ComponentHealth {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  lastCheck: Date;
  responseTime: number; // ms
  errorCount: number;
  metrics: Record<string, number>;
  issues: string[];
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  enabled: boolean;

  // Performance thresholds
  maxDecisionLatency: number; // ms
  minComfortScore: number;
  maxErrorRate: number; // errors per hour

  // Resource thresholds
  maxMemoryUsage: number; // MB
  maxCpuUsage: number; // percentage
  maxNetworkLatency: number; // ms

  // Notification settings
  alertCooldown: number; // minutes
  escalationThreshold: number; // repeated alerts
}

/**
 * System alert
 */
export interface SystemAlert {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: 'performance' | 'resource' | 'error' | 'health';
  title: string;
  description: string;
  component: string;
  metric: string;
  threshold: number;
  actualValue: number;
  recommendation?: string;
  acknowledged: boolean;
  resolvedAt?: Date;
}

/**
 * Performance trend analysis
 */
export interface TrendAnalysis {
  metric: string;
  period: 'hour' | 'day' | 'week';
  trend: 'improving' | 'stable' | 'degrading';
  changeRate: number; // percentage change
  significance: 'high' | 'medium' | 'low';
  prediction: {
    nextValue: number;
    confidence: number;
    timeframe: number; // hours
  };
}

/**
 * System Monitor Dashboard
 */
export class SystemMonitor {
  private config: AlertConfig;
  private logger: LoggerService;

  // Metrics storage
  private metricsHistory: SystemMetrics[] = [];
  private componentHealth: Map<string, ComponentHealth> = new Map();
  private activeAlerts: Map<string, SystemAlert> = new Map();
  private alertHistory: SystemAlert[] = [];

  // Monitoring state
  private isMonitoring: boolean = false;
  private monitoringInterval?: number;
  private healthCheckInterval?: number;

  // Performance tracking
  private lastMetricsUpdate: Date = new Date(0);
  private metricsBuffer: Partial<SystemMetrics>[] = [];

  constructor(config: AlertConfig, logger: LoggerService) {
    this.config = config;
    this.logger = logger;

    this.logger.info('📊 [System Monitor] Initialized', {
      alertsEnabled: config.enabled,
      maxDecisionLatency: config.maxDecisionLatency,
      maxErrorRate: config.maxErrorRate,
    });
  }

  /**
   * Start system monitoring
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warning('🔄 [System Monitor] Already monitoring');
      return;
    }

    try {
      this.isMonitoring = true;

      // Initialize component health tracking
      await this.initializeComponentTracking();

      // Start periodic monitoring
      this.startPeriodicMonitoring();

      this.logger.info('🚀 [System Monitor] Started successfully', {
        components: this.componentHealth.size,
        alertsEnabled: this.config.enabled,
      });
    } catch (error) {
      this.logger.error('❌ [System Monitor] Failed to start', error);
      this.isMonitoring = false;
      throw error;
    }
  }

  /**
   * Stop system monitoring
   */
  async stop(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    this.logger.info('🛑 [System Monitor] Stopping', {
      metricsCollected: this.metricsHistory.length,
      activeAlerts: this.activeAlerts.size,
    });

    this.isMonitoring = false;

    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
  }

  /**
   * Record system metrics
   */
  recordMetrics(metrics: Partial<SystemMetrics>): void {
    const timestamp = new Date();

    const fullMetrics: SystemMetrics = {
      timestamp,
      aiDecisionLatency: metrics.aiDecisionLatency || 0,
      optimizationLatency: metrics.optimizationLatency || 0,
      predictionAccuracy: metrics.predictionAccuracy || 0.5,
      learningEfficiency: metrics.learningEfficiency || 0.5,
      energyEfficiency: metrics.energyEfficiency || 0.5,
      comfortScore: metrics.comfortScore || 0.5,
      systemUptime: metrics.systemUptime || 0,
      cycleCount: metrics.cycleCount || 0,
      memoryUsage: metrics.memoryUsage || this.getMemoryUsage(),
      cpuUsage: metrics.cpuUsage || this.getCpuUsage(),
      networkLatency: metrics.networkLatency || 0,
      errorRate: metrics.errorRate || 0,
      healthStatus: this.calculateHealthStatus(metrics),
    };

    this.metricsHistory.push(fullMetrics);
    this.pruneMetricsHistory();

    this.logger.debug('📈 [System Monitor] Metrics recorded', {
      healthStatus: fullMetrics.healthStatus,
      comfortScore: fullMetrics.comfortScore.toFixed(2),
      energyEfficiency: fullMetrics.energyEfficiency.toFixed(2),
    });

    // Check for alerts if enabled
    if (this.config.enabled) {
      this.checkAlerts(fullMetrics);
    }
  }

  /**
   * Record component health status
   */
  recordComponentHealth(name: string, health: Partial<ComponentHealth>): void {
    const timestamp = new Date();

    const fullHealth: ComponentHealth = {
      name,
      status: health.status || 'online',
      lastCheck: timestamp,
      responseTime: health.responseTime || 0,
      errorCount: health.errorCount || 0,
      metrics: health.metrics || {},
      issues: health.issues || [],
    };

    this.componentHealth.set(name, fullHealth);

    this.logger.debug('🔧 [System Monitor] Component health updated', {
      component: name,
      status: fullHealth.status,
      responseTime: fullHealth.responseTime,
      issues: fullHealth.issues.length,
    });
  }

  /**
   * Get current system dashboard
   */
  getDashboard(): {
    overview: {
      healthStatus: string;
      uptime: number;
      alertCount: number;
      componentCount: number;
    };
    currentMetrics: SystemMetrics | null;
    componentHealth: ComponentHealth[];
    activeAlerts: SystemAlert[];
    recentTrends: TrendAnalysis[];
  } {
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1] ||
      null;
    const components = Array.from(this.componentHealth.values());
    const alerts = Array.from(this.activeAlerts.values());

    return {
      overview: {
        healthStatus: latestMetrics?.healthStatus || 'unknown',
        uptime: latestMetrics?.systemUptime || 0,
        alertCount:
          alerts.filter((a) =>
            a.severity === 'error' || a.severity === 'critical'
          ).length,
        componentCount: components.filter((c) => c.status === 'online').length,
      },
      currentMetrics: latestMetrics,
      componentHealth: components,
      activeAlerts: alerts,
      recentTrends: this.generateTrendAnalysis(),
    };
  }

  /**
   * Get performance metrics for a time period
   */
  getMetricsHistory(hours: number = 24): SystemMetrics[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.metricsHistory.filter((m) => m.timestamp >= cutoff);
  }

  /**
   * Get alert history
   */
  getAlertHistory(hours: number = 24): SystemAlert[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.alertHistory.filter((a) => a.timestamp >= cutoff);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;

    this.logger.info('✅ [System Monitor] Alert acknowledged', {
      alertId,
      title: alert.title,
      acknowledgedBy,
    });

    return true;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string, resolvedBy?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.resolvedAt = new Date();
    this.activeAlerts.delete(alertId);

    this.logger.info('🔒 [System Monitor] Alert resolved', {
      alertId,
      title: alert.title,
      resolvedBy,
      duration: alert.resolvedAt.getTime() - alert.timestamp.getTime(),
    });

    return true;
  }

  /**
   * Initialize component tracking
   */
  private async initializeComponentTracking(): Promise<void> {
    const components = [
      'ai_decision_engine',
      'hvac_optimizer',
      'predictive_analytics',
      'adaptive_learning',
      'smart_scheduler',
      'home_assistant_client',
      'hvac_controller',
      'state_machine',
    ];

    for (const component of components) {
      this.componentHealth.set(component, {
        name: component,
        status: 'online',
        lastCheck: new Date(),
        responseTime: 0,
        errorCount: 0,
        metrics: {},
        issues: [],
      });
    }
  }

  /**
   * Start periodic monitoring tasks
   */
  private startPeriodicMonitoring(): void {
    // Main monitoring loop (every minute)
    this.monitoringInterval = setInterval(async () => {
      if (this.isMonitoring) {
        await this.collectSystemMetrics();
      }
    }, 60000);

    // Health check loop (every 5 minutes)
    this.healthCheckInterval = setInterval(async () => {
      if (this.isMonitoring) {
        await this.performHealthChecks();
      }
    }, 5 * 60000);
  }

  /**
   * Collect current system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      const metrics: Partial<SystemMetrics> = {
        timestamp: new Date(),
        memoryUsage: this.getMemoryUsage(),
        cpuUsage: this.getCpuUsage(),
        systemUptime: this.getSystemUptime(),
      };

      // Add metrics from buffer if available
      if (this.metricsBuffer.length > 0) {
        const bufferedMetrics = this.metricsBuffer.reduce(
          (acc, m) => ({ ...acc, ...m }),
          {},
        );
        Object.assign(metrics, bufferedMetrics);
        this.metricsBuffer = [];
      }

      this.recordMetrics(metrics);
    } catch (error) {
      this.logger.error('❌ [System Monitor] Failed to collect metrics', error);
    }
  }

  /**
   * Perform health checks on all components
   */
  private async performHealthChecks(): Promise<void> {
    for (const [name, health] of this.componentHealth.entries()) {
      try {
        const startTime = performance.now();

        // Simulate health check (in production, this would ping actual components)
        const isHealthy = await this.checkComponentHealth(name);
        const responseTime = performance.now() - startTime;

        this.recordComponentHealth(name, {
          status: isHealthy ? 'online' : 'degraded',
          responseTime,
          lastCheck: new Date(),
        });
      } catch (error) {
        this.recordComponentHealth(name, {
          status: 'offline',
          responseTime: 0,
          lastCheck: new Date(),
          issues: [`Health check failed: ${error instanceof Error ? error.message : String(error)}`],
        });
      }
    }
  }

  /**
   * Check component health (simulated)
   */
  private async checkComponentHealth(componentName: string): Promise<boolean> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));

    // Simulate occasional failures
    return Math.random() > 0.05; // 95% success rate
  }

  /**
   * Check for alert conditions
   */
  private checkAlerts(metrics: SystemMetrics): void {
    const alerts: SystemAlert[] = [];

    // Check decision latency
    if (metrics.aiDecisionLatency > this.config.maxDecisionLatency) {
      alerts.push(this.createAlert(
        'performance',
        'error',
        'High AI Decision Latency',
        `AI decision making is taking ${metrics.aiDecisionLatency}ms, exceeding threshold of ${this.config.maxDecisionLatency}ms`,
        'ai_decision_engine',
        'aiDecisionLatency',
        this.config.maxDecisionLatency,
        metrics.aiDecisionLatency,
        'Consider scaling AI resources or optimizing decision algorithms',
      ));
    }

    // Check comfort score
    if (metrics.comfortScore < this.config.minComfortScore) {
      alerts.push(this.createAlert(
        'performance',
        'warning',
        'Low Comfort Score',
        `System comfort score is ${
          (metrics.comfortScore * 100).toFixed(0)
        }%, below target of ${(this.config.minComfortScore * 100).toFixed(0)}%`,
        'hvac_controller',
        'comfortScore',
        this.config.minComfortScore,
        metrics.comfortScore,
        'Review HVAC settings and optimization parameters',
      ));
    }

    // Check error rate
    if (metrics.errorRate > this.config.maxErrorRate) {
      alerts.push(this.createAlert(
        'error',
        'critical',
        'High Error Rate',
        `System is experiencing ${metrics.errorRate} errors per hour, exceeding threshold of ${this.config.maxErrorRate}`,
        'system',
        'errorRate',
        this.config.maxErrorRate,
        metrics.errorRate,
        'Investigate error sources and check component health',
      ));
    }

    // Check memory usage
    if (metrics.memoryUsage > this.config.maxMemoryUsage) {
      alerts.push(this.createAlert(
        'resource',
        'warning',
        'High Memory Usage',
        `Memory usage is ${metrics.memoryUsage}MB, exceeding threshold of ${this.config.maxMemoryUsage}MB`,
        'system',
        'memoryUsage',
        this.config.maxMemoryUsage,
        metrics.memoryUsage,
        'Consider restarting components or increasing memory allocation',
      ));
    }

    // Process new alerts
    for (const alert of alerts) {
      this.processAlert(alert);
    }
  }

  /**
   * Create a system alert
   */
  private createAlert(
    category: SystemAlert['category'],
    severity: SystemAlert['severity'],
    title: string,
    description: string,
    component: string,
    metric: string,
    threshold: number,
    actualValue: number,
    recommendation?: string,
  ): SystemAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      severity,
      category,
      title,
      description,
      component,
      metric,
      threshold,
      actualValue,
      recommendation,
      acknowledged: false,
    };
  }

  /**
   * Process and potentially trigger an alert
   */
  private processAlert(alert: SystemAlert): void {
    // Check if similar alert already exists
    const existingAlert = Array.from(this.activeAlerts.values()).find((a) =>
      a.component === alert.component &&
      a.metric === alert.metric &&
      !a.acknowledged
    );

    if (existingAlert) {
      // Update existing alert
      existingAlert.actualValue = alert.actualValue;
      existingAlert.timestamp = alert.timestamp;
      return;
    }

    // Add new alert
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);

    this.logger.warning('🚨 [System Monitor] Alert triggered', {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title,
      component: alert.component,
      metric: alert.metric,
      threshold: alert.threshold,
      actual: alert.actualValue,
    });

    // Limit alert history size
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }
  }

  /**
   * Calculate overall health status
   */
  private calculateHealthStatus(
    metrics: Partial<SystemMetrics>,
  ): SystemMetrics['healthStatus'] {
    const issues = [];

    if (
      metrics.aiDecisionLatency &&
      metrics.aiDecisionLatency > this.config.maxDecisionLatency
    ) {
      issues.push('High latency');
    }

    if (
      metrics.comfortScore && metrics.comfortScore < this.config.minComfortScore
    ) {
      issues.push('Low comfort');
    }

    if (metrics.errorRate && metrics.errorRate > this.config.maxErrorRate) {
      issues.push('High errors');
    }

    if (
      metrics.memoryUsage && metrics.memoryUsage > this.config.maxMemoryUsage
    ) {
      issues.push('High memory');
    }

    if (issues.length === 0) return 'healthy';
    if (issues.length <= 2) return 'warning';
    return 'critical';
  }

  /**
   * Generate trend analysis for key metrics
   */
  private generateTrendAnalysis(): TrendAnalysis[] {
    if (this.metricsHistory.length < 10) {
      return [];
    }

    const trends: TrendAnalysis[] = [];
    const recent = this.metricsHistory.slice(-24); // Last 24 metrics

    // Analyze comfort score trend
    const comfortTrend = this.analyzeTrend(recent.map((m) => m.comfortScore));
    if (comfortTrend) {
      trends.push({
        metric: 'comfortScore',
        period: 'hour',
        trend: comfortTrend.direction,
        changeRate: comfortTrend.changeRate,
        significance: comfortTrend.significance,
        prediction: {
          nextValue: comfortTrend.prediction,
          confidence: 0.7,
          timeframe: 1,
        },
      });
    }

    // Analyze energy efficiency trend
    const energyTrend = this.analyzeTrend(
      recent.map((m) => m.energyEfficiency),
    );
    if (energyTrend) {
      trends.push({
        metric: 'energyEfficiency',
        period: 'hour',
        trend: energyTrend.direction,
        changeRate: energyTrend.changeRate,
        significance: energyTrend.significance,
        prediction: {
          nextValue: energyTrend.prediction,
          confidence: 0.6,
          timeframe: 1,
        },
      });
    }

    return trends;
  }

  /**
   * Analyze trend in metric values
   */
  private analyzeTrend(values: number[]): {
    direction: TrendAnalysis['trend'];
    changeRate: number;
    significance: TrendAnalysis['significance'];
    prediction: number;
  } | null {
    if (values.length < 5) return null;

    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const changeRate = (slope / (sumY / n)) * 100; // Percentage change
    const prediction = slope * n + intercept;

    return {
      direction: slope > 0.01
        ? 'improving'
        : slope < -0.01
        ? 'degrading'
        : 'stable',
      changeRate: Math.abs(changeRate),
      significance: Math.abs(changeRate) > 5
        ? 'high'
        : Math.abs(changeRate) > 2
        ? 'medium'
        : 'low',
      prediction: Math.max(0, Math.min(1, prediction)),
    };
  }

  /**
   * Get current memory usage (simulated)
   */
  private getMemoryUsage(): number {
    // In a real implementation, this would get actual memory usage
    return 50 + Math.random() * 30; // 50-80 MB
  }

  /**
   * Get current CPU usage (simulated)
   */
  private getCpuUsage(): number {
    // In a real implementation, this would get actual CPU usage
    return 10 + Math.random() * 20; // 10-30%
  }

  /**
   * Get system uptime in hours
   */
  private getSystemUptime(): number {
    // Calculate uptime since first metrics recording
    if (this.metricsHistory.length === 0) return 0;

    const firstMetric = this.metricsHistory[0];
    return (Date.now() - firstMetric.timestamp.getTime()) / (1000 * 60 * 60);
  }

  /**
   * Prune old metrics to manage memory
   */
  private pruneMetricsHistory(): void {
    const maxEntries = 1000; // Keep last 1000 metrics
    if (this.metricsHistory.length > maxEntries) {
      this.metricsHistory = this.metricsHistory.slice(-maxEntries / 2);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...newConfig };

    this.logger.info('🔧 [System Monitor] Configuration updated', {
      alertsEnabled: this.config.enabled,
      changes: Object.keys(newConfig),
    });
  }

  /**
   * Get monitoring summary for external systems
   */
  getMonitoringSummary(): {
    status: string;
    metrics: Record<string, number>;
    alerts: number;
    uptime: number;
    components: Record<string, string>;
  } {
    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    const components = Array.from(this.componentHealth.entries()).reduce(
      (acc, [name, health]) => {
        acc[name] = health.status;
        return acc;
      },
      {} as Record<string, string>,
    );

    return {
      status: latest?.healthStatus || 'unknown',
      metrics: {
        comfortScore: latest?.comfortScore || 0,
        energyEfficiency: latest?.energyEfficiency || 0,
        aiDecisionLatency: latest?.aiDecisionLatency || 0,
        memoryUsage: latest?.memoryUsage || 0,
      },
      alerts: this.activeAlerts.size,
      uptime: latest?.systemUptime || 0,
      components,
    };
  }
}
