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
  Settings: Symbol.for("Settings"),
  HvacOptions: Symbol.for("HvacOptions"),
  HassOptions: Symbol.for("HassOptions"),
  ApplicationOptions: Symbol.for("ApplicationOptions"),

  // Core services
  Logger: Symbol.for("Logger"),
  ConfigLoader: Symbol.for("ConfigLoader"),

  // Home Assistant
  HomeAssistantClient: Symbol.for("HomeAssistantClient"),

  // HVAC
  HvacModule: Symbol.for("HvacModule"),
  HVACStateMachine: Symbol.for("HVACStateMachine"),
  HVACController: Symbol.for("HVACController"),
  HVACAgent: Symbol.for("HVACAgent"),

  // Event System
  EventBus: Symbol.for("EventBus"),
  ModuleRegistry: Symbol.for("ModuleRegistry"),

  // Note: Experimental features are in experimental/ folder and have their own TYPES
} as const;
