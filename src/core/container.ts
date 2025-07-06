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
import { XStateHVACStateMachineAdapter } from '../hvac/state-machine-xstate-adapter.ts';
import { IHVACStateMachine } from '../hvac/state-machine-interface.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import { EventBus } from './event-system.ts';
import { ActorSystem } from './actor-system.ts';
import { ActorBootstrap } from './actor-bootstrap.ts';
import { HVACController } from '../hvac/controller.ts';
import { ActorManager } from './actor-manager.ts';
import { HvacModule } from '../hvac/hvac-module.ts';

// Re-export for backward compatibility
export { LoggerService, TYPES };

/**
 * Application container setup
 */
export class ApplicationContainer {
  private container: Container;
  private settings?: Settings;
  private logger?: LoggerService;

  constructor() {
    this.container = new Container();
  }

  /**
   * Initialize container with configuration from file
   */
  async initialize(configPath?: string): Promise<void> {
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
      await this.registerModules();

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
  }

  /**
   * Initialize container with settings object (for testing)
   */
  initializeWithSettings(
    settings: Settings,
    skipRegistrations: string[] = [],
  ): void {
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

      // Register tools (if AI is enabled)
      if (this.settings.appOptions.useAi) {
        // TODO : Uncomment when tools are implemented
        // this.registerTools();
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Register configuration objects
   */
  private registerConfiguration(): void {
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
  }

  /**
   * Register core services
   */
  private registerCoreServices(): void {
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
  }

  /**
   * Register event system services
   */
  private registerEventSystem(): void {
    // EventBus
    this.container.bind({
      provide: TYPES.EventBus,
      useFactory: () => {
        const logger = new LoggerService('HAG.event-bus');
        return new EventBus(logger);
      },
    });


    // Actor Manager (new unified system)
    this.container.bind({
      provide: TYPES.ActorManager,
      useFactory: () => {
        const logger = new LoggerService('HAG.actor-manager');
        return new ActorManager(this.container, logger);
      },
    });

    // Legacy ActorSystem (for backward compatibility)
    this.container.bind({
      provide: TYPES.ActorSystem,
      useFactory: () => {
        const eventBus = this.container.get(TYPES.EventBus) as EventBus;
        const logger = new LoggerService('HAG.actor-system');
        return new ActorSystem(eventBus, logger);
      },
    });

    // Legacy ActorBootstrap (for backward compatibility)
    this.container.bind({
      provide: TYPES.ActorBootstrap,
      useFactory: () => {
        const eventBus = this.container.get(TYPES.EventBus) as EventBus;
        const actorSystem = this.container.get(TYPES.ActorSystem) as ActorSystem;
        const logger = new LoggerService('HAG.actor-bootstrap');
        return new ActorBootstrap(eventBus, actorSystem, logger);
      },
    });
  }

  /**
   * Register Home Assistant services
   */
  private registerHomeAssistantServices(): void {
    this.container.bind({
      provide: TYPES.HomeAssistantClient,
      useFactory: () => {
        const config = this.container.get<HassOptions>(TYPES.HassOptions);
        const logger = new LoggerService('HAG.home-assistant.client');
        return new HomeAssistantClient(config, logger);
      },
    });
  }

  /**
   * Register HVAC services
   */
  public registerHVACServices(): void {
    // Register state machine based on experimental feature flag
    this.container.bind({
      provide: TYPES.HVACStateMachine,
      useFactory: () => {
        const hvacOptions = this.container.get<HvacOptions>(TYPES.HvacOptions);
        const _appOptions = this.container.get<ApplicationOptions>(
          TYPES.ApplicationOptions,
        );
        const logger = new LoggerService('HAG.hvac.state-machine');

        logger.info('🔄 Creating XState state machine implementation');
        return new XStateHVACStateMachineAdapter(hvacOptions, logger);
      },
    });

    // Register HVAC Controller (Actor Bootstrap version)
    this.container.bind({
      provide: TYPES.HVACController,
      useFactory: () => {
        const hvacOptions = this.container.get<HvacOptions>(TYPES.HvacOptions);
        const appOptions = this.container.get<ApplicationOptions>(TYPES.ApplicationOptions);
        const haClient = this.container.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
        const actorBootstrap = this.container.get<ActorBootstrap>(TYPES.ActorBootstrap);
        const eventBus = this.container.get<EventBus>(TYPES.EventBus);
        
        return new HVACController(
          hvacOptions,
          appOptions,
          haClient,
          actorBootstrap,
          eventBus,
        );
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
          const stateMachine = this.container.get<IHVACStateMachine>(
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
    return this.container.get<T>(serviceIdentifier);
  }

  /**
   * Check if service is bound
   */
  isBound(serviceIdentifier: symbol): boolean {
    return this.container.has(serviceIdentifier);
  }

  /**
   * Get container instance for advanced usage
   */
  getContainer(): Container {
    return this.container;
  }

  /**
   * Get application settings
   */
  getSettings(): Settings {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }
    return this.settings;
  }

  /**
   * Register domain modules
   */
  private async registerModules(): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    const actorManager = this.container.get<ActorManager>(TYPES.ActorManager);

    // Register HVAC module
    const hvacModule = new HvacModule();
    await actorManager.registerModule(hvacModule, this.settings.hvacOptions);

    this.logger?.info('✅ Registered all domain modules');
  }

  /**
   * Note: Experimental features are handled separately in the experimental/ folder
   */
  private async registerExperimentalFeatures(): Promise<void> {
    // This method is intentionally empty - experimental features are not part of the main codebase
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    // Stop services that need cleanup
    try {
      if (this.isBound(TYPES.HVACController)) {
        const controller = this.get<HVACController>(TYPES.HVACController);
        if (controller?.stop && typeof controller.stop === 'function') {
          await controller.stop();
        }
      }

      if (this.isBound(TYPES.HomeAssistantClient)) {
        const client = this.get<HomeAssistantClient>(TYPES.HomeAssistantClient);
        if (client?.disconnect && typeof client.disconnect === 'function') {
          await client.disconnect();
        }
      }
    } catch (_error) {
      // Ignore cleanup errors
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
  if (globalContainer) {
    await globalContainer.dispose();
  }

  globalContainer = new ApplicationContainer();
  await globalContainer.initialize(configPath);

  return globalContainer;
}

/**
 * Get global container instance
 */
export function getContainer(): ApplicationContainer {
  if (!globalContainer) {
    throw new Error('Container not initialized. Call createContainer() first.');
  }
  return globalContainer;
}

/**
 * Dispose global container
 */
export async function disposeContainer(): Promise<void> {
  if (globalContainer) {
    await globalContainer.dispose();
    globalContainer = undefined;
  }
}
