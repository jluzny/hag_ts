/**
 * Dependency injection types for HAG JavaScript variant.
 *
 * Separated to avoid circular dependencies with decorators.
 */

/**
 * Dependency injection tokens
 */
export const TYPES = {
  // Configuration
  Settings: Symbol.for('Settings'),
  HvacOptions: Symbol.for('HvacOptions'),
  HassOptions: Symbol.for('HassOptions'),
  ApplicationOptions: Symbol.for('ApplicationOptions'),

  // Core services
  Logger: Symbol.for('Logger'),
  ConfigLoader: Symbol.for('ConfigLoader'),

  // Home Assistant
  HomeAssistantClient: Symbol.for('HomeAssistantClient'),

  // HVAC
  HVACStateMachine: Symbol.for('HVACStateMachine'),
  HVACController: Symbol.for('HVACController'),
  HVACAgent: Symbol.for('HVACAgent'),

  // Tools
  TemperatureMonitorTool: Symbol.for('TemperatureMonitorTool'),
  HVACControlTool: Symbol.for('HVACControlTool'),
  SensorReaderTool: Symbol.for('SensorReaderTool'),

  // Experimental Features
  AdaptiveLearningEngine: Symbol.for('AdaptiveLearningEngine'),
  HVACOptimizer: Symbol.for('HVACOptimizer'),
  PredictiveAnalyticsEngine: Symbol.for('PredictiveAnalyticsEngine'),
  SystemMonitor: Symbol.for('SystemMonitor'),
  SmartScheduler: Symbol.for('SmartScheduler'),
  PerformanceOptimizer: Symbol.for('PerformanceOptimizer'),
  ExperimentalFeatures: Symbol.for('ExperimentalFeatures'),
} as const;
