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
import { LoggerService } from './logging.ts';
import { HVACStateMachine } from '../hvac/state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client-xs.ts';
import { EventBus } from './event-system.ts';
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
    // Defer logger creation until after global logging setup
    this.moduleRegistry = new ModuleRegistry(this.container);
  }

  /**
   * Initialize container with configuration from file
   */
  async initialize(configPathOrSettings?: string | Settings): Promise<void> {
    // Create logger after global logging setup
    this.logger = new LoggerService('HAG.container');
    this.logger.debug('📍 ApplicationContainer.initialize() ENTRY');
    
    // Initialize module registry logger after global logging setup
    this.moduleRegistry.setLogger(new LoggerService('HAG.module-registry'));
    try {
      // Load configuration or use provided settings
      if (typeof configPathOrSettings === 'string') {
        this.settings = await ConfigLoader.loadSettings(configPathOrSettings);
      } else if (configPathOrSettings) {
        this.settings = configPathOrSettings;
        this.logger.debug('📍 Using pre-loaded configuration');
      } else {
        this.settings = await ConfigLoader.loadSettings();
      }

      // Register configuration
      this.registerConfiguration();

      // Register core services
      this.registerCoreServices();
      
      // Initialize logger
      this.logger = this.container.get<LoggerService>(TYPES.Logger);

      // Register Home Assistant services
      this.registerHomeAssistantServices([]);

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
    this.logger?.debug('📍 ApplicationContainer.initialize() EXIT');
  }


  /**
   * Register configuration objects
   */
  private registerConfiguration(): void {
    this.logger?.debug('📍 ApplicationContainer.registerConfiguration() ENTRY');
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
    this.logger?.debug('📍 ApplicationContainer.registerConfiguration() EXIT');
  }

  /**
   * Register core services
   */
  private registerCoreServices(): void {
    this.logger?.debug('📍 ApplicationContainer.registerCoreServices() ENTRY');
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
    this.logger?.debug('📍 ApplicationContainer.registerCoreServices() EXIT');
  }

  /**
   * Register event system services
   */
  private registerEventSystem(): void {
    this.logger?.debug('📍 ApplicationContainer.registerEventSystem() ENTRY');
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


    this.logger?.debug('📍 ApplicationContainer.registerEventSystem() EXIT');
  }

  /**
   * Register Home Assistant services
   */
  private registerHomeAssistantServices(excludeServices: string[] = []): void {
    this.logger?.debug('📍 ApplicationContainer.registerHomeAssistantServices() ENTRY');
    
    if (!excludeServices.includes('homeassistant')) {
      this.container.bind({
        provide: TYPES.HomeAssistantClient,
        useFactory: () => {
          const config = this.container.get<HassOptions>(TYPES.HassOptions);
          const logger = new LoggerService('HAG.home-assistant.client');
          return new HomeAssistantClient(config, logger);
        },
      });
    }
    
    this.logger?.debug('📍 ApplicationContainer.registerHomeAssistantServices() EXIT');
  }

  /**
   * Register HVAC services using direct DI
   */
  public registerHVACServices(): void {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerHVACServices() ENTRY');
    }

    // Register HVAC module as a DI service
    this.container.bind({
      provide: TYPES.HvacModule,
      useFactory: () => {
        const hvacOptions = this.container.get<HvacOptions>(TYPES.HvacOptions);
        const appOptions = this.container.get<ApplicationOptions>(TYPES.ApplicationOptions);
        const haClient = this.container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
        const eventBus = this.container.get<EventBus>(TYPES.EventBus);
        return new HvacModule(hvacOptions, appOptions, haClient, eventBus);
      },
    });

    // Register HVAC State Machine - direct access from module
    this.container.bind({
      provide: TYPES.HVACStateMachine,
      useFactory: () => {
        const hvacModule = this.container.get<HvacModule>(TYPES.HvacModule);
        return hvacModule.getHVACStateMachine();
      },
    });

    // Register HVAC Controller - direct access from module
    this.container.bind({
      provide: TYPES.HVACController,
      useFactory: () => {
        const hvacModule = this.container.get<HvacModule>(TYPES.HvacModule);
        return hvacModule.getHVACController();
      },
    });

    // Register AI agent if enabled
    if (this.settings?.appOptions.useAi) {
      this.container.bind({
        provide: TYPES.HVACAgent,
        useFactory: () => {
          const hvacOptions = this.container.get<HvacOptions>(TYPES.HvacOptions);
          const appOptions = this.container.get<ApplicationOptions>(TYPES.ApplicationOptions);
          const stateMachine = this.container.get<HVACStateMachine>(TYPES.HVACStateMachine);
          const haClient = this.container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
          const logger = new LoggerService('HAG.ai');
          return new HVACAgent(hvacOptions, appOptions, stateMachine, haClient, logger);
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
   * Check if service is bound to container
   */
  isBound(serviceIdentifier: symbol): boolean {
    try {
      this.container.get(serviceIdentifier);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get settings from container
   */
  getSettings(): Settings {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }
    return this.settings;
  }

  /**
   * Initialize container with settings and optional excluded services
   */
  async initializeWithSettings(settings: Settings, excludeServices: string[] = []): Promise<void> {
    this.settings = settings;
    this.registerConfiguration();
    this.registerCoreServices();
    this.logger = this.container.get<LoggerService>(TYPES.Logger);
    this.registerHomeAssistantServices(excludeServices);
    this.registerHVACServices();
    await this.registerModules(settings);
    await this.registerExperimentalFeatures();
  }

  /**
   * Get underlying container for advanced operations
   */
  getContainer(): Container {
    return this.container;
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

    // Get HVAC module from DI container (already registered in registerHVACServices)
    const hvacModule = this.container.get<HvacModule>(TYPES.HvacModule);
    
    // Register with module registry for lifecycle management
    await this.moduleRegistry.registerModule(hvacModule, settings.hvacOptions);

    this.logger?.info('✅ Registered all domain modules');
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerModules() EXIT');
    }
  }

  /**
   * Note: Experimental features are handled separately in the experimental/ folder
   */
  private registerExperimentalFeatures(): Promise<void> {
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerExperimentalFeatures() ENTRY');
    }
    // This method is intentionally empty - experimental features are not part of the main codebase
    if (this.logger) {
      this.logger.debug('📍 ApplicationContainer.registerExperimentalFeatures() EXIT');
    }
    return Promise.resolve();
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
  configPathOrSettings?: string | Settings,
): Promise<ApplicationContainer> {
  // Note: Using a temporary logger here as container instance isn't available yet
  const tempLogger = new LoggerService('HAG.container');
  tempLogger.debug('📍 createContainer() ENTRY');
  
  if (globalContainer) {
    await globalContainer.dispose();
  }

  globalContainer = new ApplicationContainer();
  await globalContainer.initialize(configPathOrSettings);

  tempLogger.debug('📍 createContainer() EXIT');
  return globalContainer;
}

/**
 * Get global container instance
 */
export function getContainer(): ApplicationContainer {
  // Note: Using a temporary logger here as we're retrieving the container instance
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
  // Note: Using a temporary logger here as we're disposing the container instance
  const tempLogger = new LoggerService('HAG.container');
  tempLogger.debug('📍 disposeContainer() ENTRY');
  if (globalContainer) {
    await globalContainer.dispose();
    globalContainer = undefined;
  }
  tempLogger.debug('📍 disposeContainer() EXIT');
}
