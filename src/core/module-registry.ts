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
    if (this.logger) {
      this.logger.debug('📍 BaseModule.initialize() ENTRY');
    }
    // Override in subclasses - config parameter available for subclasses
    if (this.logger) {
      this.logger.debug('📍 BaseModule.initialize() EXIT');
    }
  }

  abstract createActorFactory(): ActorFactory<DomainActor>;

  registerServices(container: Container): void {
    this.container = container;
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    this.logger.debug('📍 BaseModule.registerServices() ENTRY');
    this.eventBus = container.get(Symbol.for('EventBus')) as EventBus;
    this.logger.debug('📍 BaseModule.registerServices() EXIT');
  }

  getRequiredDependencies(): symbol[] {
    if (this.logger) {
      this.logger.debug('📍 BaseModule.getRequiredDependencies() ENTRY');
    }
    const result = [
      Symbol.for('EventBus'),
      Symbol.for('Logger'),
    ];
    if (this.logger) {
      this.logger.debug('📍 BaseModule.getRequiredDependencies() EXIT');
    }
    return result;
  }

  validateConfig(config: unknown): boolean {
    if (this.logger) {
      this.logger.debug('📍 BaseModule.validateConfig() ENTRY');
    }
    const result = config !== null && config !== undefined;
    if (this.logger) {
      this.logger.debug('📍 BaseModule.validateConfig() EXIT');
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (this.logger) {
      this.logger.debug('📍 BaseModule.dispose() ENTRY');
    }
    // Override in subclasses
    if (this.logger) {
      this.logger.debug('📍 BaseModule.dispose() EXIT');
    }
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
    this.logger.debug('📍 ModuleRegistry.constructor() ENTRY');
    this.logger.debug('📍 ModuleRegistry.constructor() EXIT');
  }

  /**
   * Register a domain module with its configuration
   */
  async registerModule(module: Module, config: unknown): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.registerModule() ENTRY');
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
    this.logger.debug('📍 ModuleRegistry.registerModule() EXIT');
  }

  /**
   * Set common configuration shared across modules
   */
  setCommonConfig(key: string, value: unknown): void {
    this.logger.debug('📍 ModuleRegistry.setCommonConfig() ENTRY');
    this.commonConfig.set(key, value);
    this.logger.debug(`📋 Set common config: ${key}`);
    this.logger.debug('📍 ModuleRegistry.setCommonConfig() EXIT');
  }

  /**
   * Get common configuration
   */
  getCommonConfig<T>(key: string): T | undefined {
    this.logger.debug('📍 ModuleRegistry.getCommonConfig() ENTRY');
    const result = this.commonConfig.get(key) as T | undefined;
    this.logger.debug('📍 ModuleRegistry.getCommonConfig() EXIT');
    return result;
  }

  /**
   * Get module configuration
   */
  getModuleConfig<T>(domain: string): T | undefined {
    this.logger.debug('📍 ModuleRegistry.getModuleConfig() ENTRY');
    const result = this.modules.get(domain)?.config as T;
    this.logger.debug('📍 ModuleRegistry.getModuleConfig() EXIT');
    return result;
  }

  /**
   * Get merged configuration (common + module-specific)
   */
  getMergedConfig<T>(domain: string): T {
    this.logger.debug('📍 ModuleRegistry.getMergedConfig() ENTRY');
    const common = Object.fromEntries(this.commonConfig);
    const moduleSpecific = this.modules.get(domain)?.config || {};
    
    const result = { ...common, ...moduleSpecific } as T;
    this.logger.debug('📍 ModuleRegistry.getMergedConfig() EXIT');
    return result;
  }

  /**
   * Get module by domain
   */
  getModule(domain: string): Module | undefined {
    this.logger.debug('📍 ModuleRegistry.getModule() ENTRY');
    const result = this.modules.get(domain)?.module;
    this.logger.debug('📍 ModuleRegistry.getModule() EXIT');
    return result;
  }

  /**
   * Get actor factory for a domain
   */
  getActorFactory(domain: string): ActorFactory<DomainActor> | undefined {
    this.logger.debug('📍 ModuleRegistry.getActorFactory() ENTRY');
    const result = this.modules.get(domain)?.factory;
    this.logger.debug('📍 ModuleRegistry.getActorFactory() EXIT');
    return result;
  }

  /**
   * Get all active modules
   */
  getActiveModules(): Module[] {
    this.logger.debug('📍 ModuleRegistry.getActiveModules() ENTRY');
    const result = Array.from(this.modules.values())
      .filter(meta => meta.status === 'active')
      .map(meta => meta.module);
    this.logger.debug('📍 ModuleRegistry.getActiveModules() EXIT');
    return result;
  }

  /**
   * Get module status
   */
  getModuleStatus(): Array<{ domain: string; status: string; error?: string }> {
    this.logger.debug('📍 ModuleRegistry.getModuleStatus() ENTRY');
    const result = Array.from(this.modules.entries()).map(([domain, meta]) => ({
      domain,
      status: meta.status,
      error: meta.error,
    }));
    this.logger.debug('📍 ModuleRegistry.getModuleStatus() EXIT');
    return result;
  }

  /**
   * Check if module exists
   */
  hasModule(domain: string): boolean {
    this.logger.debug('📍 ModuleRegistry.hasModule() ENTRY');
    const result = this.modules.has(domain);
    this.logger.debug('📍 ModuleRegistry.hasModule() EXIT');
    return result;
  }

  /**
   * Get registered module domains
   */
  getRegisteredModules(): string[] {
    this.logger.debug('📍 ModuleRegistry.getRegisteredModules() ENTRY');
    const result = Array.from(this.modules.keys());
    this.logger.debug('📍 ModuleRegistry.getRegisteredModules() EXIT');
    return result;
  }

  /**
   * Initialize a specific module
   */
  private async initializeModule(domain: string): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.initializeModule() ENTRY');
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
    this.logger.debug('📍 ModuleRegistry.initializeModule() EXIT');
  }

  /**
   * Dispose all modules
   */
  async disposeAll(): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.disposeAll() ENTRY');
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
    this.logger.debug('📍 ModuleRegistry.disposeAll() EXIT');
  }
}