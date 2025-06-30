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
import { XStateHVACStateMachineAdapter } from '../hvac/state-machine-xstate-adapter.ts';
import { LangGraphHVACStateMachineAdapter } from '../hvac/state-machine-lg-adapter.ts';
import { IHVACStateMachine } from '../hvac/state-machine-interface.ts';
import { HomeAssistantClient } from '../home-assistant/client.ts';
import {
  type ExperimentalFeatures,
  defaultExperimentalFeatures,
} from './experimental-features.ts';
import { configureExperimentalFeatures } from './experimental-container.ts';

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
        const appOptions = this.container.get<ApplicationOptions>(
          TYPES.ApplicationOptions,
        );
        const logger = new LoggerService('HAG.hvac.state-machine-factory');

        // Check for LangGraph experiment feature flag
        const useLangGraph = Array.isArray(appOptions.experimentalFeatures)
          ? appOptions.experimentalFeatures.includes('langgraph-state-machine')
          : false;

        if (useLangGraph) {
          logger.info(
            '🧪 [Experiment] Creating LangGraph state machine implementation',
          );
          return new LangGraphHVACStateMachineAdapter(
            hvacOptions,
            appOptions,
            logger,
          );
        } else {
          logger.info(
            '🔄 Creating XState state machine implementation (default)',
          );
          return new XStateHVACStateMachineAdapter(hvacOptions, logger);
        }
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
        const stateMachine = this.container.get<IHVACStateMachine>(
          TYPES.HVACStateMachine,
        ) as unknown as HVACStateMachine;
        const haClient = this.container.get<HomeAssistantClient>(
          TYPES.HomeAssistantClient,
        );
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
   * Register experimental features
   */
  private async registerExperimentalFeatures(): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    const logger = new LoggerService('HAG.experimental');
    
    // Get experimental features configuration from settings
    const rawFeatures = this.settings.appOptions.experimentalFeatures;
    let experimentalFeatures = defaultExperimentalFeatures;
    
    if (rawFeatures) {
      if (Array.isArray(rawFeatures)) {
        // Legacy string array format - convert to structured format
        experimentalFeatures = {
          ...defaultExperimentalFeatures,
          adaptiveLearning: {
            enabled: (rawFeatures as string[]).includes('adaptive-learning'),
          },
        };
        logger.debug('🔄 Converted legacy experimental features format', { features: rawFeatures });
      } else {
        // New structured format
        experimentalFeatures = rawFeatures as ExperimentalFeatures;
      }
    }
    
    // Configure experimental features using the dedicated container
    await configureExperimentalFeatures(this.container, experimentalFeatures, logger);
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
