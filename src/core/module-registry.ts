/**
 * Module Registry - Manages application modules and their lifecycle.
 */

import { Container } from '@needle-di/core';
import { LoggerService } from './logging.ts';

/**
 * Base interface for all application modules.
 */
export interface Module {
  readonly name: string;
  readonly domain: string;
  readonly version: string;
  readonly description: string;

  initialize(config: unknown): Promise<void>;
  getRequiredDependencies?(): symbol[];
  validateConfig?(config: unknown): boolean;
  dispose(): Promise<void>;
}

/**
 * Base class for application modules.
 */
export abstract class BaseModule implements Module {
  abstract readonly name: string;
  abstract readonly domain: string;
  abstract readonly version: string;
  abstract readonly description: string;

  protected logger?: LoggerService;
  protected config?: unknown;

  initialize(config: unknown): Promise<void> {
    this.config = config;
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    // Default initialization logic
    return Promise.resolve();
  }



  getRequiredDependencies?(): symbol[] {
    return [];
  }

  validateConfig?(config: unknown): boolean {
    return !!config; // Default validation
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}


/**
 * Manages the registration, initialization, and lifecycle of application modules.
 */
export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private logger: LoggerService;

  constructor(container: Container, logger?: LoggerService) {
    this.logger = logger || new LoggerService('HAG.module-registry');
    // Register self in container for other modules to access if needed
    container.bind({ provide: Symbol.for('ModuleRegistry'), useValue: this });
  }

  /**
   * Set logger for the registry (called after global logging setup)
   */
  setLogger(logger: LoggerService): void {
    this.logger = logger;
  }

  /**
   * Register a module with the registry.
   */
  async registerModule(module: Module, config: unknown): Promise<void> {
    if (this.modules.has(module.domain)) {
      this.logger.warning(`⚠️ Module ${module.domain} already registered.`);
      return;
    }

    // Validate module configuration
    if (module.validateConfig && !module.validateConfig(config)) {
      throw new Error(`Invalid configuration for module: ${module.domain}`);
    }

    await module.initialize(config);
    this.modules.set(module.domain, module);


    this.logger.info(`✅ Module registered: ${module.name} (${module.version})`);
  }


  /**
   * Get a registered module by its domain.
   */
  getModule(domain: string): Module | undefined {
    const result = this.modules.get(domain);
    return result;
  }



  /**
   * Dispose all registered modules.
   */
  async disposeAll(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.dispose();
      } catch (error) {
        this.logger.error(`❌ Error disposing module ${module.domain}:`, error);
      }
    }
    this.modules.clear();
    this.logger.info('🗑️ All modules disposed.');
  }
}
