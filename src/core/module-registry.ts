/**
 * Module registry that combines module management with configuration storage
 * Consolidates ModuleManager and ConfigurationRegistry responsibilities
 */

import { Container } from '@needle-di/core';
import { LoggerService } from './logger.ts';
import { EventBus } from './event-system.ts';
import { DomainActor, ActorFactory } from './actor-bootstrap.ts';

/**
 * Module interface for domain-specific modules
 */
export interface Module {
  readonly name: string;
  readonly domain: string;
  readonly version: string;
  readonly description?: string;
  
  initialize(config: unknown): Promise<void> | void;
  createActorFactory(): ActorFactory<DomainActor>;
  registerServices(container: Container): void;
  getRequiredDependencies(): symbol[];
  validateConfig(config: unknown): boolean;
  dispose?(): Promise<void> | void;
}

/**
 * Module metadata with configuration
 */
export interface ModuleMetadata {
  module: Module;
  config: unknown;
  factory?: ActorFactory<DomainActor>;
  status: 'registered' | 'initialized' | 'active' | 'error';
  error?: string;
}

/**
 * Base class for domain modules
 */
export abstract class BaseModule implements Module {
  abstract readonly name: string;
  abstract readonly domain: string;
  abstract readonly version: string;
  abstract readonly description?: string;

  protected container?: Container;
  protected logger?: LoggerService;
  protected eventBus?: EventBus;

  async initialize(_config: unknown): Promise<void> {
    // Override in subclasses - config parameter available for subclasses
  }

  abstract createActorFactory(): ActorFactory<DomainActor>;

  registerServices(container: Container): void {
    this.container = container;
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    this.eventBus = container.get(Symbol.for('EventBus')) as EventBus;
  }

  getRequiredDependencies(): symbol[] {
    return [
      Symbol.for('EventBus'),
      Symbol.for('Logger'),
    ];
  }

  validateConfig(config: unknown): boolean {
    return config !== null && config !== undefined;
  }

  async dispose(): Promise<void> {
    // Override in subclasses
  }
}

/**
 * Module registry that manages modules and their configurations
 */
export class ModuleRegistry {
  private modules = new Map<string, ModuleMetadata>();
  private commonConfig = new Map<string, unknown>();
  private container: Container;
  private logger: LoggerService;

  constructor(container: Container, logger?: LoggerService) {
    this.container = container;
    this.logger = logger || new LoggerService('HAG.module-registry');
  }

  /**
   * Register a domain module with its configuration
   */
  async registerModule(module: Module, config: unknown): Promise<void> {
    const domain = module.domain;
    
    try {
      // Validate configuration
      if (!module.validateConfig(config)) {
        throw new Error(`Invalid configuration for module: ${domain}`);
      }

      // Check required dependencies
      const requiredDeps = module.getRequiredDependencies();
      for (const dep of requiredDeps) {
        if (!this.container.has(dep)) {
          throw new Error(`Missing required dependency: ${dep.toString()}`);
        }
      }

      // Register module metadata
      const metadata: ModuleMetadata = {
        module,
        config,
        status: 'registered',
      };
      
      this.modules.set(domain, metadata);
      
      this.logger.info(`🔌 Registered module: ${domain}`, {
        name: module.name,
        version: module.version,
      });

      // Initialize module
      await this.initializeModule(domain);
      
    } catch (error) {
      this.logger.error(`❌ Failed to register module: ${domain}`, error);
      throw error;
    }
  }

  /**
   * Set common configuration shared across modules
   */
  setCommonConfig(key: string, value: unknown): void {
    this.commonConfig.set(key, value);
    this.logger.debug(`📋 Set common config: ${key}`);
  }

  /**
   * Get common configuration
   */
  getCommonConfig<T>(key: string): T | undefined {
    return this.commonConfig.get(key) as T | undefined;
  }

  /**
   * Get module configuration
   */
  getModuleConfig<T>(domain: string): T | undefined {
    return this.modules.get(domain)?.config as T;
  }

  /**
   * Get merged configuration (common + module-specific)
   */
  getMergedConfig<T>(domain: string): T {
    const common = Object.fromEntries(this.commonConfig);
    const moduleSpecific = this.modules.get(domain)?.config || {};
    
    return { ...common, ...moduleSpecific } as T;
  }

  /**
   * Get module by domain
   */
  getModule(domain: string): Module | undefined {
    return this.modules.get(domain)?.module;
  }

  /**
   * Get actor factory for a domain
   */
  getActorFactory(domain: string): ActorFactory<DomainActor> | undefined {
    return this.modules.get(domain)?.factory;
  }

  /**
   * Get all active modules
   */
  getActiveModules(): Module[] {
    return Array.from(this.modules.values())
      .filter(meta => meta.status === 'active')
      .map(meta => meta.module);
  }

  /**
   * Get module status
   */
  getModuleStatus(): Array<{ domain: string; status: string; error?: string }> {
    return Array.from(this.modules.entries()).map(([domain, meta]) => ({
      domain,
      status: meta.status,
      error: meta.error,
    }));
  }

  /**
   * Check if module exists
   */
  hasModule(domain: string): boolean {
    return this.modules.has(domain);
  }

  /**
   * Get registered module domains
   */
  getRegisteredModules(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Initialize a specific module
   */
  private async initializeModule(domain: string): Promise<void> {
    const metadata = this.modules.get(domain);
    if (!metadata) {
      throw new Error(`Module not found: ${domain}`);
    }

    try {
      metadata.status = 'initialized';
      
      // Initialize module
      await metadata.module.initialize(metadata.config);
      
      // Register module services in DI container
      metadata.module.registerServices(this.container);
      
      // Create actor factory
      metadata.factory = metadata.module.createActorFactory();
      
      metadata.status = 'active';
      
      this.logger.info(`✅ Initialized module: ${domain}`);
      
    } catch (error) {
      metadata.status = 'error';
      metadata.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Failed to initialize module: ${domain}`, error);
      throw error;
    }
  }

  /**
   * Dispose all modules
   */
  async disposeAll(): Promise<void> {
    const disposePromises: Promise<void>[] = [];
    
    for (const [domain, metadata] of this.modules) {
      if (metadata.module.dispose) {
        disposePromises.push(
          Promise.resolve(metadata.module.dispose()).catch((error: unknown) => {
            this.logger.error(`❌ Error disposing module: ${domain}`, error);
          })
        );
      }
    }
    
    await Promise.allSettled(disposePromises);
    this.modules.clear();
    this.commonConfig.clear();
    
    this.logger.info('🧹 Disposed all modules');
  }
}