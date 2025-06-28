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
import { type HVACAgentInterface, HVACController } from '../hvac/controller.ts';
import { ConfigLoader } from '../config/loader.ts';
import { HVACAgent } from '../ai/agent.ts';
import { TYPES } from './types.ts';
import { LoggerService } from './logger.ts';
import { HVACStateMachine } from '../hvac/state-machine.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';

// Re-export for backward compatibility
export { LoggerService, TYPES };

/**
 * Application container setup
 */
export class ApplicationContainer {
  private container: Container;
  private settings?: Settings;

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

      // Setup logging based on configuration
      await this.setupLogging(this.settings.appOptions.logLevel);

      // Register configuration
      this.registerConfiguration();

      // Register core services
      this.registerCoreServices();

      // Register Home Assistant services
      this.registerHomeAssistantServices();

      // Register HVAC services
      this.registerHVACServices();

      // Register tools (if AI is enabled)
      if (this.settings.appOptions.useAi) {
        // TODO : Uncomment when tools are implemented
        // this.registerTools();
      }

      console.log('✅ Container initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize container:', error);
      throw error;
    }
  }

  /**
   * Initialize container with settings object (for testing)
   */
  async initializeWithSettings(
    settings: Settings,
    skipRegistrations: string[] = [],
  ): Promise<void> {
    try {
      // Use provided settings
      this.settings = settings;

      // Setup logging based on configuration
      await this.setupLogging(this.settings.appOptions.logLevel);

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

      console.log(
        '✅ Container initialized successfully with provided settings',
      );
    } catch (error) {
      console.error('❌ Failed to initialize container with settings:', error);
      throw error;
    }
  }

  /**
   * Setup logging configuration
   */
  private async setupLogging(logLevel: string): Promise<void> {
    const { setup, ConsoleHandler } = await import('@std/log');

    setup({
      handlers: {
        console: new ConsoleHandler(
          logLevel.toUpperCase() as unknown as
            | 'DEBUG'
            | 'INFO'
            | 'WARN'
            | 'ERROR'
            | 'CRITICAL',
        ),
      },
      loggers: {
        default: {
          level: logLevel.toUpperCase() as unknown as
            | 'DEBUG'
            | 'INFO'
            | 'WARN'
            | 'ERROR'
            | 'CRITICAL',
          handlers: ['console'],
        },
        HAG: {
          level: logLevel.toUpperCase() as unknown as
            | 'DEBUG'
            | 'INFO'
            | 'WARN'
            | 'ERROR'
            | 'CRITICAL',
          handlers: ['console'],
        },
      },
    });
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
    this.container.bind({ provide: TYPES.Logger, useClass: LoggerService });
    this.container.bind({
      provide: TYPES.ConfigLoader,
      useClass: ConfigLoader,
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
        const logger = this.container.get<LoggerService>(TYPES.Logger);
        return new HomeAssistantClient(config, logger);
      },
    });
  }

  /**
   * Register HVAC services
   */
  public registerHVACServices(): void {
    this.container.bind({
      provide: TYPES.HVACStateMachine,
      useFactory: () => {
        const hvacOptions = this.container.get<HvacOptions>(TYPES.HvacOptions);
        return new HVACStateMachine(hvacOptions);
      },
    });
    this.container.bind({
      provide: TYPES.HVACController,
      useFactory: () => {
        const hvacOptions = this.container.get<HvacOptions>(
          TYPES.HvacOptions,
        );
        const appOptions = this.container.get<ApplicationOptions>(
          TYPES.ApplicationOptions,
        );
        const stateMachine = this.container.get<HVACStateMachine>(
          TYPES.HVACStateMachine,
        );
        const haClient = this.container.get<HomeAssistantClient>(
          TYPES.HomeAssistantClient,
        );
        const logger = this.container.get<LoggerService>(TYPES.Logger);
        const hvacAgent = this.settings?.appOptions.useAi
          ? this.container.get(
            TYPES.HVACAgent,
          ) as unknown as HVACAgentInterface
          : undefined;
        return new HVACController(
          hvacOptions,
          appOptions,
          stateMachine,
          haClient,
          logger,
          hvacAgent,
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
          const stateMachine = this.container.get<HVACStateMachine>(
            TYPES.HVACStateMachine,
          );
          const haClient = this.container.get<HomeAssistantClient>(
            TYPES.HomeAssistantClient,
          );
          const logger = this.container.get<LoggerService>(TYPES.Logger);
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

      console.log('✅ Container disposed successfully');
    } catch (error) {
      console.error('❌ Error during container disposal:', error);
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
