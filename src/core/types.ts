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

  // Event System
  EventBus: Symbol.for('EventBus'),
  ActorSystem: Symbol.for('ActorSystem'),
  HvacActorService: Symbol.for('HvacActorService'),
  ActorBootstrap: Symbol.for('ActorBootstrap'),

  // New Architecture
  ActorManager: Symbol.for('ActorManager'),

  // Note: Experimental features are in experimental/ folder and have their own TYPES
} as const;
