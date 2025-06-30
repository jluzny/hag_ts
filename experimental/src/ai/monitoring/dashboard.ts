/**
 * AI HVAC System Dashboard
 *
 * This module provides a comprehensive dashboard interface for monitoring
 * and managing the AI-enhanced HVAC system with real-time metrics,
 * alerts, and performance analytics.
 */

import {
  ComponentHealth,
  SystemAlert,
  SystemMetrics,
  SystemMonitor,
  TrendAnalysis,
} from './system-monitor.ts';
import { HVACOptimizer } from '../optimization/hvac-optimizer.ts';
import { PredictiveAnalyticsEngine } from '../predictive/analytics-engine.ts';
import type { IAdaptiveLearningEngine } from '../../../../src/core/experimental-features.ts';
import { SmartScheduler } from '../scheduling/smart-scheduler.ts';
import type { LoggerService } from '../../../../src/core/logger.ts';

/**
 * Dashboard configuration
 */
export interface DashboardConfig {
  // Display settings
  refreshInterval: number; // seconds
  metricsRetention: number; // hours

  // Chart settings
  chartDataPoints: number;
  trendAnalysisPeriod: number; // hours

  // Alert settings
  autoAcknowledgeInfo: boolean;
  alertDisplayLimit: number;

  // Export settings
  enableDataExport: boolean;
  exportFormats: string[];
}

/**
 * Dashboard widget data
 */
export interface DashboardWidget {
  id: string;
  title: string;
  type: 'metric' | 'chart' | 'status' | 'list' | 'gauge';
  size: 'small' | 'medium' | 'large';
  position: { row: number; col: number };
  data: any;
  refreshRate: number; // seconds
  lastUpdate: Date;
}

/**
 * Dashboard layout
 */
export interface DashboardLayout {
  name: string;
  widgets: DashboardWidget[];
  columns: number;
  rows: number;
}

/**
 * Export data format
 */
export interface ExportData {
  timestamp: Date;
  timeRange: { start: Date; end: Date };
  metrics: SystemMetrics[];
  alerts: SystemAlert[];
  componentHealth: ComponentHealth[];
  summary: {
    averageComfort: number;
    averageEfficiency: number;
    totalUptime: number;
    alertCount: number;
    errorRate: number;
  };
}

/**
 * AI HVAC Dashboard
 */
export class AIHVACDashboard {
  private config: DashboardConfig;
  private logger: LoggerService;

  // System components
  private monitor: SystemMonitor;
  private optimizer?: HVACOptimizer;
  private analytics?: PredictiveAnalyticsEngine;
  private learning?: IAdaptiveLearningEngine;
  private scheduler?: SmartScheduler;

  // Dashboard state
  private isRunning: boolean = false;
  private currentLayout: DashboardLayout;
  private widgets: Map<string, DashboardWidget> = new Map();
  private refreshInterval?: number;

  // Real-time data
  private realtimeMetrics: SystemMetrics[] = [];
  private realtimeAlerts: SystemAlert[] = [];

  constructor(
    config: DashboardConfig,
    monitor: SystemMonitor,
    logger: LoggerService,
    optimizer?: HVACOptimizer,
    analytics?: PredictiveAnalyticsEngine,
    learning?: IAdaptiveLearningEngine,
    scheduler?: SmartScheduler,
  ) {
    this.config = config;
    this.monitor = monitor;
    this.logger = logger;
    this.optimizer = optimizer;
    this.analytics = analytics;
    this.learning = learning;
    this.scheduler = scheduler;

    // Initialize default layout
    this.currentLayout = this.createDefaultLayout();

    this.logger.info('📊 [Dashboard] Initialized', {
      refreshInterval: config.refreshInterval,
      widgets: this.currentLayout.widgets.length,
      components: {
        optimizer: !!optimizer,
        analytics: !!analytics,
        learning: !!learning,
        scheduler: !!scheduler,
      },
    });
  }

  /**
   * Start the dashboard
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warning('🔄 [Dashboard] Already running');
      return;
    }

    try {
      this.isRunning = true;

      // Initialize widgets
      await this.initializeWidgets();

      // Start periodic refresh
      this.startPeriodicRefresh();

      this.logger.info('🚀 [Dashboard] Started successfully', {
        layout: this.currentLayout.name,
        widgets: this.widgets.size,
      });
    } catch (error) {
      this.logger.error('❌ [Dashboard] Failed to start', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the dashboard
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 [Dashboard] Stopping');

    this.isRunning = false;

    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  /**
   * Get current dashboard state
   */
  getDashboardState(): {
    isRunning: boolean;
    layout: DashboardLayout;
    widgets: DashboardWidget[];
    lastUpdate: Date;
    systemStatus: {
      health: string;
      uptime: number;
      activeAlerts: number;
      componentCount: number;
    };
  } {
    const dashboard = this.monitor.getDashboard();

    return {
      isRunning: this.isRunning,
      layout: this.currentLayout,
      widgets: Array.from(this.widgets.values()),
      lastUpdate: new Date(),
      systemStatus: {
        health: dashboard.overview.healthStatus,
        uptime: dashboard.overview.uptime,
        activeAlerts: dashboard.overview.alertCount,
        componentCount: dashboard.overview.componentCount,
      },
    };
  }

  /**
   * Get real-time metrics for charts
   */
  getRealtimeMetrics(hours: number = 24): SystemMetrics[] {
    return this.monitor.getMetricsHistory(hours);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    current: {
      comfort: number;
      efficiency: number;
      aiLatency: number;
      systemHealth: string;
    };
    trends: {
      comfort: TrendAnalysis | null;
      efficiency: TrendAnalysis | null;
      performance: TrendAnalysis | null;
    };
    achievements: {
      uptimePercent: number;
      avgComfortScore: number;
      energySavings: number;
      alertResolutionTime: number;
    };
  } {
    const dashboard = this.monitor.getDashboard();
    const metrics = this.monitor.getMetricsHistory(24);
    const current = dashboard.currentMetrics;

    // Calculate achievements
    const uptimePercent = metrics.length > 0
      ? (metrics.filter((m) => m.healthStatus !== 'critical').length /
        metrics.length) * 100
      : 100;

    const avgComfortScore = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + m.comfortScore, 0) / metrics.length
      : 0;

    const energySavings = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + m.energyEfficiency, 0) / metrics.length
      : 0;

    // Calculate alert resolution time
    const resolvedAlerts = this.monitor.getAlertHistory(24).filter((a) =>
      a.resolvedAt
    );
    const avgResolutionTime = resolvedAlerts.length > 0
      ? resolvedAlerts.reduce(
        (sum, a) => sum + (a.resolvedAt!.getTime() - a.timestamp.getTime()),
        0,
      ) / resolvedAlerts.length / (1000 * 60)
      : 0;

    return {
      current: {
        comfort: current?.comfortScore || 0,
        efficiency: current?.energyEfficiency || 0,
        aiLatency: current?.aiDecisionLatency || 0,
        systemHealth: current?.healthStatus || 'unknown',
      },
      trends: {
        comfort:
          dashboard.recentTrends.find((t) => t.metric === 'comfortScore') ||
          null,
        efficiency:
          dashboard.recentTrends.find((t) => t.metric === 'energyEfficiency') ||
          null,
        performance: null, // Would be calculated from multiple metrics
      },
      achievements: {
        uptimePercent,
        avgComfortScore,
        energySavings: energySavings * 100, // As percentage
        alertResolutionTime: avgResolutionTime, // Minutes
      },
    };
  }

  /**
   * Get AI component status
   */
  getAIComponentStatus(): {
    decisionEngine: {
      status: string;
      responseTime: number;
      accuracy: number;
      decisionsToday: number;
    };
    optimizer: {
      status: string;
      optimizations: number;
      energySavings: number;
      comfortImpact: number;
    };
    analytics: {
      status: string;
      predictions: number;
      accuracy: number;
      dataPoints: number;
    };
    learning: {
      status: string;
      interactions: number;
      patterns: number;
      adaptations: number;
    };
    scheduler: {
      status: string;
      scheduleItems: number;
      automations: number;
      nextEvent: Date | null;
    };
  } {
    const dashboard = this.monitor.getDashboard();
    const components = dashboard.componentHealth;

    // Get component status by name
    const getComponentStatus = (name: string) =>
      components.find((c) => c.name.includes(name))?.status || 'unknown';

    return {
      decisionEngine: {
        status: getComponentStatus('decision'),
        responseTime: dashboard.currentMetrics?.aiDecisionLatency || 0,
        accuracy: dashboard.currentMetrics?.predictionAccuracy || 0,
        decisionsToday: 0, // Would be tracked separately
      },
      optimizer: {
        status: getComponentStatus('optimizer'),
        optimizations: 0, // Would be tracked by optimizer
        energySavings: dashboard.currentMetrics?.energyEfficiency || 0,
        comfortImpact: dashboard.currentMetrics?.comfortScore || 0,
      },
      analytics: {
        status: getComponentStatus('analytics'),
        predictions: 0, // Would be tracked by analytics
        accuracy: dashboard.currentMetrics?.predictionAccuracy || 0,
        dataPoints:
          this.analytics?.getAnalyticsSummary().dataPoints.temperature || 0,
      },
      learning: {
        status: getComponentStatus('learning'),
        interactions: this.learning?.getUserProfile().totalInteractions || 0,
        patterns: 0, // Pattern count not available in interface
        adaptations: 0, // Would be tracked separately
      },
      scheduler: {
        status: getComponentStatus('scheduler'),
        scheduleItems: this.scheduler?.getCurrentSchedule().length || 0,
        automations: this.scheduler?.getEventHistory(24).length || 0,
        nextEvent:
          this.scheduler?.getScheduleStatus().nextScheduledItem?.startTime ||
          null,
      },
    };
  }

  /**
   * Get alert management interface
   */
  getAlertManager(): {
    active: SystemAlert[];
    recent: SystemAlert[];
    summary: {
      critical: number;
      warnings: number;
      info: number;
      acknowledged: number;
    };
    actions: {
      acknowledgeAll: () => Promise<number>;
      resolveAlert: (id: string) => Promise<boolean>;
      getRecommendations: (alertId: string) => string[];
    };
  } {
    const dashboard = this.monitor.getDashboard();
    const activeAlerts = dashboard.activeAlerts;
    const recentAlerts = this.monitor.getAlertHistory(24);

    return {
      active: activeAlerts,
      recent: recentAlerts,
      summary: {
        critical: activeAlerts.filter((a) => a.severity === 'critical').length,
        warnings: activeAlerts.filter((a) => a.severity === 'warning').length,
        info: activeAlerts.filter((a) => a.severity === 'info').length,
        acknowledged: activeAlerts.filter((a) => a.acknowledged).length,
      },
      actions: {
        acknowledgeAll: async () => {
          let acknowledged = 0;
          for (const alert of activeAlerts) {
            if (
              !alert.acknowledged && this.monitor.acknowledgeAlert(alert.id)
            ) {
              acknowledged++;
            }
          }
          return acknowledged;
        },
        resolveAlert: async (id: string) => {
          return this.monitor.resolveAlert(id);
        },
        getRecommendations: (alertId: string) => {
          const alert = activeAlerts.find((a) => a.id === alertId);
          return alert ? this.generateAlertRecommendations(alert) : [];
        },
      },
    };
  }

  /**
   * Export dashboard data
   */
  async exportData(
    format: 'json' | 'csv' | 'xlsx',
    timeRange: { start: Date; end: Date },
  ): Promise<ExportData> {
    if (!this.config.enableDataExport) {
      throw new Error('Data export is disabled');
    }

    const metrics = this.monitor.getMetricsHistory(
      Math.ceil(
        (timeRange.end.getTime() - timeRange.start.getTime()) /
          (1000 * 60 * 60),
      ),
    ).filter((m) =>
      m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
    );

    const alerts = this.monitor.getAlertHistory(
      Math.ceil(
        (timeRange.end.getTime() - timeRange.start.getTime()) /
          (1000 * 60 * 60),
      ),
    ).filter((a) =>
      a.timestamp >= timeRange.start && a.timestamp <= timeRange.end
    );

    const dashboard = this.monitor.getDashboard();

    // Calculate summary statistics
    const summary = {
      averageComfort:
        metrics.reduce((sum, m) => sum + m.comfortScore, 0) / metrics.length ||
        0,
      averageEfficiency:
        metrics.reduce((sum, m) => sum + m.energyEfficiency, 0) /
          metrics.length || 0,
      totalUptime: metrics.length > 0
        ? metrics[metrics.length - 1].systemUptime - metrics[0].systemUptime
        : 0,
      alertCount: alerts.length,
      errorRate:
        metrics.reduce((sum, m) => sum + m.errorRate, 0) / metrics.length || 0,
    };

    const exportData: ExportData = {
      timestamp: new Date(),
      timeRange,
      metrics,
      alerts,
      componentHealth: dashboard.componentHealth,
      summary,
    };

    this.logger.info('📁 [Dashboard] Data exported', {
      format,
      timeRange:
        `${timeRange.start.toISOString()} to ${timeRange.end.toISOString()}`,
      metricsCount: metrics.length,
      alertsCount: alerts.length,
    });

    return exportData;
  }

  /**
   * Create default dashboard layout
   */
  private createDefaultLayout(): DashboardLayout {
    return {
      name: 'AI HVAC Overview',
      columns: 4,
      rows: 3,
      widgets: [
        {
          id: 'system_health',
          title: 'System Health',
          type: 'gauge',
          size: 'small',
          position: { row: 0, col: 0 },
          data: {},
          refreshRate: 30,
          lastUpdate: new Date(),
        },
        {
          id: 'comfort_score',
          title: 'Comfort Score',
          type: 'gauge',
          size: 'small',
          position: { row: 0, col: 1 },
          data: {},
          refreshRate: 30,
          lastUpdate: new Date(),
        },
        {
          id: 'energy_efficiency',
          title: 'Energy Efficiency',
          type: 'gauge',
          size: 'small',
          position: { row: 0, col: 2 },
          data: {},
          refreshRate: 30,
          lastUpdate: new Date(),
        },
        {
          id: 'active_alerts',
          title: 'Active Alerts',
          type: 'metric',
          size: 'small',
          position: { row: 0, col: 3 },
          data: {},
          refreshRate: 10,
          lastUpdate: new Date(),
        },
        {
          id: 'metrics_chart',
          title: 'Performance Metrics',
          type: 'chart',
          size: 'large',
          position: { row: 1, col: 0 },
          data: {},
          refreshRate: 60,
          lastUpdate: new Date(),
        },
        {
          id: 'component_status',
          title: 'Component Status',
          type: 'status',
          size: 'medium',
          position: { row: 1, col: 2 },
          data: {},
          refreshRate: 30,
          lastUpdate: new Date(),
        },
        {
          id: 'recent_alerts',
          title: 'Recent Alerts',
          type: 'list',
          size: 'medium',
          position: { row: 2, col: 0 },
          data: {},
          refreshRate: 20,
          lastUpdate: new Date(),
        },
        {
          id: 'ai_performance',
          title: 'AI Performance',
          type: 'chart',
          size: 'medium',
          position: { row: 2, col: 2 },
          data: {},
          refreshRate: 60,
          lastUpdate: new Date(),
        },
      ],
    };
  }

  /**
   * Initialize dashboard widgets
   */
  private async initializeWidgets(): Promise<void> {
    for (const widget of this.currentLayout.widgets) {
      widget.data = await this.updateWidgetData(widget);
      this.widgets.set(widget.id, widget);
    }
  }

  /**
   * Start periodic refresh
   */
  private startPeriodicRefresh(): void {
    this.refreshInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.refreshWidgets();
      }
    }, this.config.refreshInterval * 1000);
  }

  /**
   * Refresh all widgets
   */
  private async refreshWidgets(): Promise<void> {
    const now = new Date();

    for (const widget of this.widgets.values()) {
      const timeSinceUpdate = now.getTime() - widget.lastUpdate.getTime();
      const shouldUpdate = timeSinceUpdate >= widget.refreshRate * 1000;

      if (shouldUpdate) {
        try {
          widget.data = await this.updateWidgetData(widget);
          widget.lastUpdate = now;
        } catch (error) {
          this.logger.error(
            `❌ [Dashboard] Failed to update widget ${widget.id}`,
            error,
          );
        }
      }
    }
  }

  /**
   * Update data for a specific widget
   */
  private async updateWidgetData(widget: DashboardWidget): Promise<any> {
    const dashboard = this.monitor.getDashboard();

    switch (widget.id) {
      case 'system_health':
        return {
          value: dashboard.overview.healthStatus,
          score: this.healthToScore(dashboard.overview.healthStatus),
          color: this.healthToColor(dashboard.overview.healthStatus),
        };

      case 'comfort_score':
        return {
          value: dashboard.currentMetrics?.comfortScore || 0,
          percentage: (dashboard.currentMetrics?.comfortScore || 0) * 100,
          trend: this.getMetricTrend('comfortScore'),
        };

      case 'energy_efficiency':
        return {
          value: dashboard.currentMetrics?.energyEfficiency || 0,
          percentage: (dashboard.currentMetrics?.energyEfficiency || 0) * 100,
          trend: this.getMetricTrend('energyEfficiency'),
        };

      case 'active_alerts':
        return {
          count: dashboard.activeAlerts.length,
          critical:
            dashboard.activeAlerts.filter((a) => a.severity === 'critical')
              .length,
          warnings:
            dashboard.activeAlerts.filter((a) => a.severity === 'warning')
              .length,
        };

      case 'metrics_chart':
        const metrics = this.monitor.getMetricsHistory(
          this.config.chartDataPoints / 4,
        );
        return {
          labels: metrics.map((m) => m.timestamp.toLocaleTimeString()),
          datasets: [
            {
              name: 'Comfort',
              data: metrics.map((m) => m.comfortScore * 100),
              color: '#4CAF50',
            },
            {
              name: 'Efficiency',
              data: metrics.map((m) => m.energyEfficiency * 100),
              color: '#2196F3',
            },
            {
              name: 'AI Latency',
              data: metrics.map((m) => m.aiDecisionLatency),
              color: '#FF9800',
            },
          ],
        };

      case 'component_status':
        return {
          components: dashboard.componentHealth.map((c) => ({
            name: c.name,
            status: c.status,
            responseTime: c.responseTime,
            issues: c.issues.length,
          })),
        };

      case 'recent_alerts':
        return {
          alerts: dashboard.activeAlerts.slice(0, this.config.alertDisplayLimit)
            .map((a) => ({
              id: a.id,
              severity: a.severity,
              title: a.title,
              component: a.component,
              timestamp: a.timestamp.toLocaleString(),
              acknowledged: a.acknowledged,
            })),
        };

      case 'ai_performance':
        const aiMetrics = this.monitor.getMetricsHistory(12);
        return {
          labels: aiMetrics.map((m) => m.timestamp.toLocaleTimeString()),
          datasets: [
            {
              name: 'Decision Latency',
              data: aiMetrics.map((m) => m.aiDecisionLatency),
              color: '#E91E63',
            },
            {
              name: 'Prediction Accuracy',
              data: aiMetrics.map((m) => m.predictionAccuracy * 100),
              color: '#9C27B0',
            },
          ],
        };

      default:
        return {};
    }
  }

  /**
   * Helper methods
   */

  private healthToScore(health: string): number {
    switch (health) {
      case 'healthy':
        return 100;
      case 'warning':
        return 75;
      case 'critical':
        return 25;
      default:
        return 50;
    }
  }

  private healthToColor(health: string): string {
    switch (health) {
      case 'healthy':
        return '#4CAF50';
      case 'warning':
        return '#FF9800';
      case 'critical':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  }

  private getMetricTrend(metric: string): 'up' | 'down' | 'stable' {
    const dashboard = this.monitor.getDashboard();
    const trend = dashboard.recentTrends.find((t) => t.metric === metric);

    if (!trend) return 'stable';

    switch (trend.trend) {
      case 'improving':
        return 'up';
      case 'degrading':
        return 'down';
      default:
        return 'stable';
    }
  }

  private generateAlertRecommendations(alert: SystemAlert): string[] {
    const recommendations = [];

    if (alert.recommendation) {
      recommendations.push(alert.recommendation);
    }

    // Add general recommendations based on alert type
    switch (alert.category) {
      case 'performance':
        recommendations.push('Check system load and resource availability');
        recommendations.push('Review recent configuration changes');
        break;
      case 'resource':
        recommendations.push('Monitor memory and CPU usage trends');
        recommendations.push('Consider scaling system resources');
        break;
      case 'error':
        recommendations.push('Check system logs for error details');
        recommendations.push('Verify component connectivity');
        break;
      case 'health':
        recommendations.push('Perform component health checks');
        recommendations.push('Restart affected services if necessary');
        break;
    }

    return recommendations;
  }
}
