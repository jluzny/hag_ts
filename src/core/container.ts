/**
 * Dependency injection container for HAG JavaScript variant.
 *
 * Uses @needle-di/core for type-safe dependency injection with decorators.
 */

import { Container } from '@needle-di/core';
import type {
  ApplicationOptions,
  HassOptions,
  HvacOptions,
  Settings,
} from '../config/config.ts';
import { ConfigLoader } from '../config/loader.ts';
import { HVACAgent } from '../ai/agent.ts';
import { TYPES } from './types.ts';
import { LoggerService } from './logger.ts';
import { HVACStateMachine } from '../hvac/state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { EventBus } from './event-system.ts';
import { ActorManager } from './actor-manager.ts';
import { HvacModule } from '../hvac/hvac-module.ts';
import { ModuleRegistry } from './module-registry.ts';

// Re-export for backward compatibility
export { LoggerService, TYPES };

/**
 * Application container setup
 */
export class ApplicationContainer {
  private container: Container;
  private settings?: Settings;
  private logger?: LoggerService;
  private moduleRegistry: ModuleRegistry;

  constructor() {
    this.container = new Container();
    // Initialize temporary logger for constructor
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.constructor() ENTRY');
    tempLogger.debug('📍 ApplicationContainer.constructor() EXIT');
    this.moduleRegistry = new ModuleRegistry(this.container, new LoggerService('HAG.module-registry'));
  }

  /**
   * Initialize container with configuration from file
   */
  async initialize(configPath?: string): Promise<void> {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.initialize() ENTRY');
    try {
      // Load configuration
      this.settings = await ConfigLoader.loadSettings(configPath);

      // Register configuration
      this.registerConfiguration();

      // Register core services
      this.registerCoreServices();
      
      // Initialize logger
      this.logger = this.container.get<LoggerService>(TYPES.Logger);

      // Register Home Assistant services
      this.registerHomeAssistantServices();

      // Register HVAC services
      this.registerHVACServices();

      // Register modules
      await this.registerModules(this.settings);

      // Register tools (if AI is enabled)
      if (this.settings.appOptions.useAi) {
        // TODO : Uncomment when tools are implemented
        // this.registerTools();
      }

      // Register experimental features
      await this.registerExperimentalFeatures();
    } catch (error) {
      throw error;
    }
    tempLogger.debug('📍 ApplicationContainer.initialize() EXIT');
  }

  /**
   * Initialize container with settings object (for testing)
   */
  async initializeWithSettings(
    settings: Settings,
    skipRegistrations: string[] = [],
  ): Promise<void> {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.initializeWithSettings() ENTRY');
    try {
      // Use provided settings
      this.settings = settings;

      // Register configuration
      this.registerConfiguration();

      // Register core services
      if (!skipRegistrations.includes('core')) {
        this.registerCoreServices();
      }

      // Register Home Assistant services
      if (!skipRegistrations.includes('homeassistant')) {
        this.registerHomeAssistantServices();
      }

      // Register HVAC services
      if (!skipRegistrations.includes('hvac')) {
        this.registerHVACServices();
      }

      // Register modules
      await this.registerModules(settings);

      // Register tools (if AI is enabled)
      if (this.settings.appOptions.useAi) {
        // TODO : Uncomment when tools are implemented
        // this.registerTools();
      }
    } catch (error) {
      throw error;
    }
    tempLogger.debug('📍 ApplicationContainer.initializeWithSettings() EXIT');
  }

  /**
   * Register configuration objects
   */
  private registerConfiguration(): void {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.registerConfiguration() ENTRY');
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    this.container.bind({ provide: TYPES.Settings, useValue: this.settings });
    this.container.bind({
      provide: TYPES.HvacOptions,
      useValue: this.settings.hvacOptions,
    });
    this.container.bind({
      provide: TYPES.HassOptions,
      useValue: this.settings.hassOptions,
    });
    this.container.bind({
      provide: TYPES.ApplicationOptions,
      useValue: this.settings.appOptions,
    });
    tempLogger.debug('📍 ApplicationContainer.registerConfiguration() EXIT');
  }

  /**
   * Register core services
   */
  private registerCoreServices(): void {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.registerCoreServices() ENTRY');
    this.container.bind({
      provide: TYPES.Logger,
      useFactory: () => new LoggerService('HAG.core'),
    });
    this.container.bind({
      provide: TYPES.ConfigLoader,
      useClass: ConfigLoader,
    });

    // Register event system
    this.registerEventSystem();
    tempLogger.debug('📍 ApplicationContainer.registerCoreServices() EXIT');
  }

  /**
   * Register event system services
   */
  private registerEventSystem(): void {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.registerEventSystem() ENTRY');
    // EventBus
    this.container.bind({
      provide: TYPES.EventBus,
      useFactory: () => {
        const logger = new LoggerService('HAG.event-bus');
        return new EventBus(logger);
      },
    });


    // Module Registry
    this.container.bind({
      provide: TYPES.ModuleRegistry,
      useValue: this.moduleRegistry,
    });

    // Actor Manager (new unified system)
    this.container.bind({
      provide: TYPES.ActorManager,
      useFactory: () => {
        const logger = new LoggerService('HAG.actor-manager');
        return new ActorManager(this.container, logger);
      },
    });

    tempLogger.debug('📍 ApplicationContainer.registerEventSystem() EXIT');
  }

  /**
   * Register Home Assistant services
   */
  private registerHomeAssistantServices(): void {
    const tempLogger = new LoggerService('HAG.container');
    tempLogger.debug('📍 ApplicationContainer.registerHomeAssistantServices() ENTRY');
    this.container.bind({
      provide: TYPES.HomeAssistantClient,
      useFactory: () => {
        const config = this.container.get<HassOptions>(TYPES.HassOptions);
        const logger = new LoggerService('HAG.home-assistant.client');
        return new HomeAssistantClient(config, logger);
      },
    });
    tempLogger.debug('📍 ApplicationContainer.registerHomeAssistantServices() EXIT');
  }

  /**
   * Register HVAC services
   */
  public registerHVACServices(): void {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerHVACServices() ENTRY');
    }
    // Register state machine based on experimental feature flag
    this.container.bind({
      provide: TYPES.HVACStateMachine,
      useFactory: () => {
        const hvacModule = this.moduleRegistry.getModule('hvac') as HvacModule;
        if (!hvacModule) {
          throw new Error('HVAC module not registered');
        }
        return hvacModule.getHVACStateMachine();
      },
    });

    // Register HVAC Controller (Actor Bootstrap version)
    this.container.bind({
      provide: TYPES.HVACController,
      useFactory: () => {
        const hvacModule = this.moduleRegistry.getModule('hvac') as HvacModule;
        if (!hvacModule) {
          throw new Error('HVAC module not registered');
        }
        return hvacModule.getHVACController();
      },
    });

    // Register AI agent if enabled
    if (this.settings?.appOptions.useAi) {
      this.container.bind({
        provide: TYPES.HVACAgent,
        useFactory: () => {
          const hvacOptions = this.container.get<HvacOptions>(
            TYPES.HvacOptions,
          );
          const appOptions = this.container.get<ApplicationOptions>(
            TYPES.ApplicationOptions,
          );
          const stateMachine = this.container.get<HVACStateMachine>(
            TYPES.HVACStateMachine,
          ) as unknown as HVACStateMachine;
          const haClient = this.container.get<HomeAssistantClient>(
            TYPES.HomeAssistantClient,
          );
          const logger = new LoggerService('HAG.ai');
          return new HVACAgent(
            hvacOptions,
            appOptions,
            stateMachine,
            haClient,
            logger,
          );
        },
      });
    }
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerHVACServices() EXIT');
    }
  }

  /**
   * Register LangChain tools
   */
  // TODO: Uncomment when tools are implemented
  // private registerTools(): void {
  //   Promise.all([
  //     import('../hvac/tools/temperature-monitor.ts'),
  //     import('../hvac/tools/hvac-control.ts'),
  //     import('../hvac/tools/sensor-reader.ts'),
  //   ]).then(([
  //     { TemperatureMonitorTool },
  //     { HVACControlTool },
  //     { SensorReaderTool },
  //   ]) => {
  //     this.container.bind({ provide: TYPES.TemperatureMonitorTool, useClass: TemperatureMonitorTool });
  //     this.container.bind({ provide: TYPES.HVACControlTool, useClass: HVACControlTool });
  //     this.container.bind({ provide: TYPES.SensorReaderTool, useClass: SensorReaderTool });
  //   });
  // }

  /**
   * Get service from container
   */
  get<T>(serviceIdentifier: symbol): T {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.get() ENTRY');
    }
    const result = this.container.get<T>(serviceIdentifier);
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.get() EXIT');
    }
    return result;
  }

  /**
   * Check if service is bound
   */
  isBound(serviceIdentifier: symbol): boolean {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.isBound() ENTRY');
    }
    const result = this.container.has(serviceIdentifier);
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.isBound() EXIT');
    }
    return result;
  }

  /**
   * Get container instance for advanced usage
   */
  getContainer(): Container {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.getContainer() ENTRY');
    }
    const result = this.container;
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.getContainer() EXIT');
    }
    return result;
  }

  /**
   * Get application settings
   */
  getSettings(): Settings {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.getSettings() ENTRY');
    }
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.getSettings() EXIT');
    }
    return this.settings;
  }

  /**
   * Register domain modules
   */
  private async registerModules(settings: Settings): Promise<void> {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerModules() ENTRY');
    }
    if (!settings) {
      throw new Error('Settings not loaded');
    }

    // Register HVAC module
    const hvacModule = new HvacModule();
    
    // Register services first
    hvacModule.registerServices(this.container);
    
    // Then register with module registry
    await this.moduleRegistry.registerModule(hvacModule, settings.hvacOptions);

    this.logger?.info('✅ Registered all domain modules');
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerModules() EXIT');
    }
  }

  /**
   * Note: Experimental features are handled separately in the experimental/ folder
   */
  private async registerExperimentalFeatures(): Promise<void> {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerExperimentalFeatures() ENTRY');
    }
    // This method is intentionally empty - experimental features are not part of the main codebase
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerExperimentalFeatures() EXIT');
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.dispose() ENTRY');
    }
    // Stop services that need cleanup
    try {
      await this.moduleRegistry.disposeAll();
    } catch (_error) {
      // Ignore cleanup errors
    }
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.dispose() EXIT');
    }
  }
}

/**
 * Global container instance
 */
let globalContainer: ApplicationContainer | undefined;

/**
 * Create and initialize application container
 */
export async function createContainer(
  configPath?: string,
): Promise<ApplicationContainer> {
  const tempLogger = new LoggerService('HAG.container');
  tempLogger.debug('📍 createContainer() ENTRY');
  if (globalContainer) {
    await globalContainer.dispose();
  }

  globalContainer = new ApplicationContainer();
  await globalContainer.initialize(configPath);

  tempLogger.debug('📍 createContainer() EXIT');
  return globalContainer;
}

/**
 * Get global container instance
 */
export function getContainer(): ApplicationContainer {
  const tempLogger = new LoggerService('HAG.container');
  tempLogger.debug('📍 getContainer() ENTRY');
  if (!globalContainer) {
    throw new Error('Container not initialized. Call createContainer() first.');
  }
  tempLogger.debug('📍 getContainer() EXIT');
  return globalContainer;
}

/**
 * Dispose global container
 */
export async function disposeContainer(): Promise<void> {
  const tempLogger = new LoggerService('HAG.container');
  tempLogger.debug('📍 disposeContainer() ENTRY');
  if (globalContainer) {
    await globalContainer.dispose();
    globalContainer = undefined;
  }
  tempLogger.debug('📍 disposeContainer() EXIT');
}
