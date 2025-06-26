/**
 * Dependency injection container for HAG JavaScript variant.
 * 
 * Uses @needle-di/core for type-safe dependency injection with decorators.
 */

import { Container, injectable, inject } from '@needle-di/core';
import { getLogger, Logger } from '@std/log';
import type { Settings, HvacOptions, HassOptions, ApplicationOptions } from '../config/settings.ts';
import { ConfigLoader } from '../config/loader.ts';
import { HVACAgent } from '../ai/agent.ts';

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
} as const;

/**
 * Logger service wrapper
 */
@injectable()
export class LoggerService {
  private logger: Logger;

  constructor() {
    this.logger = getLogger('HAG');
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(data ? `${message} ${JSON.stringify(data)}` : message);
  }

  error(message: string, error?: unknown): void {
    this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ? `${message} ${JSON.stringify(data)}` : message);
  }

  warning(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ? `${message} ${JSON.stringify(data)}` : message);
  }
}

/**
 * Configuration service
 */
@injectable()
export class ConfigService {
  constructor(
    @inject(TYPES.Settings) private settings: Settings,
    @inject(TYPES.Logger) private logger: LoggerService,
  ) {}

  getSettings(): Settings {
    return this.settings;
  }

  getHvacOptions(): HvacOptions {
    return this.settings.hvacOptions;
  }

  getHassOptions(): HassOptions {
    return this.settings.hassOptions;
  }

  getApplicationOptions(): ApplicationOptions {
    return this.settings.appOptions;
  }

  updateSettings(newSettings: Partial<Settings>): void {
    Object.assign(this.settings, newSettings);
    this.logger.info('Settings updated', { updated: Object.keys(newSettings) });
  }
}

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
   * Initialize container with configuration
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
        this.registerTools();
      }
      
      console.log('✅ Container initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize container:', error);
      throw error;
    }
  }

  /**
   * Setup logging configuration
   */
  private async setupLogging(logLevel: string): Promise<void> {
    const { setup } = await import('@std/log');
    
    await setup({
      handlers: {
        console: {
          level: logLevel.toUpperCase() as any,
          formatter: '[{datetime}] {levelName} {msg}' as any,
        },
      },
      loggers: {
        default: {
          level: logLevel.toUpperCase() as any,
          handlers: ['console'],
        },
        HAG: {
          level: logLevel.toUpperCase() as any, 
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
    this.container.bind({ provide: TYPES.HvacOptions, useValue: this.settings.hvacOptions });
    this.container.bind({ provide: TYPES.HassOptions, useValue: this.settings.hassOptions });
    this.container.bind({ provide: TYPES.ApplicationOptions, useValue: this.settings.appOptions });
  }

  /**
   * Register core services
   */
  private registerCoreServices(): void {
    this.container.bind({ provide: TYPES.Logger, useClass: LoggerService });
    this.container.bind({ provide: TYPES.ConfigLoader, useClass: ConfigLoader });
  }

  /**
   * Register Home Assistant services
   */
  private registerHomeAssistantServices(): void {
    // Lazy import to avoid circular dependencies
    import('../home-assistant/client.ts').then(({ HomeAssistantClient }) => {
      this.container.bind({ provide: TYPES.HomeAssistantClient, useClass: HomeAssistantClient });
    });
  }

  /**
   * Register HVAC services
   */
  private registerHVACServices(): void {
    // Lazy import to avoid circular dependencies
    Promise.all([
      import('../hvac/state-machine.ts'),
      import('../hvac/controller.ts'),
    ]).then(([{ HVACStateMachine }, { HVACController }]) => {
      this.container.bind({ provide: TYPES.HVACStateMachine, useClass: HVACStateMachine });
      this.container.bind({ provide: TYPES.HVACController, useClass: HVACController });
    });

    // Register AI agent if enabled
    if (this.settings?.appOptions.useAi) {
      this.container.bind({ provide: TYPES.HVACAgent, useClass: HVACAgent });
    }
  }

  /**
   * Register LangChain tools
   */
  private registerTools(): void {
    Promise.all([
      import('../hvac/tools/temperature-monitor.ts'),
      import('../hvac/tools/hvac-control.ts'),
      import('../hvac/tools/sensor-reader.ts'),
    ]).then(([
      { TemperatureMonitorTool },
      { HVACControlTool },
      { SensorReaderTool },
    ]) => {
      this.container.bind({ provide: TYPES.TemperatureMonitorTool, useClass: TemperatureMonitorTool });
      this.container.bind({ provide: TYPES.HVACControlTool, useClass: HVACControlTool });
      this.container.bind({ provide: TYPES.SensorReaderTool, useClass: SensorReaderTool });
    });
  }

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
        const controller = this.get<any>(TYPES.HVACController);
        if (controller.stop && typeof controller.stop === 'function') {
          await controller.stop();
        }
      }
      
      if (this.isBound(TYPES.HomeAssistantClient)) {
        const client = this.get<any>(TYPES.HomeAssistantClient);
        if (client.disconnect && typeof client.disconnect === 'function') {
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
export async function createContainer(configPath?: string): Promise<ApplicationContainer> {
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