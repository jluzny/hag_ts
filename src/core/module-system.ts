/**
 * Module system for domain actors integrated with dependency injection
 * Provides a framework for registering and managing pluggable domain modules
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
  
  /**
   * Initialize module with configuration
   */
  initialize(config: unknown): Promise<void> | void;
  
  /**
   * Create actor factory for this domain
   */
  createActorFactory(): ActorFactory<DomainActor>;
  
  /**
   * Register domain-specific services in DI container
   */
  registerServices(container: Container): void;
  
  /**
   * Get required dependencies (DI symbols)
   */
  getRequiredDependencies(): symbol[];
  
  /**
   * Validate module configuration
   */
  validateConfig(config: unknown): boolean;
  
  /**
   * Cleanup module resources
   */
  dispose?(): Promise<void> | void;
}

/**
 * Module metadata for registration
 */
export interface ModuleMetadata {
  module: Module;
  config: unknown;
  factory?: ActorFactory<DomainActor>;
  status: 'registered' | 'initialized' | 'active' | 'error';
  error?: string;
}

/**
 * Module manager integrated with dependency injection
 */
export class ModuleManager {
  private modules = new Map<string, ModuleMetadata>();
  private container: Container;
  private logger: LoggerService;
  private eventBus: EventBus;

  constructor(container: Container, logger?: LoggerService) {
    this.container = container;
    this.logger = logger || new LoggerService('HAG.module-manager');
    this.eventBus = container.get(Symbol.for('EventBus')) as EventBus;
  }

  /**
   * Register a domain module
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
        description: module.description,
      });

      // Initialize module
      await this.initializeModule(domain);
      
    } catch (error) {
      this.logger.error(`❌ Failed to register module: ${domain}`, error);
      throw error;
    }
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
   * Get module by domain
   */
  getModule(domain: string): Module | undefined {
    return this.modules.get(domain)?.module;
  }

  /**
   * Get module metadata
   */
  getModuleMetadata(domain: string): ModuleMetadata | undefined {
    return this.modules.get(domain);
  }

  /**
   * Get actor factory for a domain
   */
  getActorFactory(domain: string): ActorFactory<DomainActor> | undefined {
    return this.modules.get(domain)?.factory;
  }

  /**
   * Get all registered modules
   */
  getRegisteredModules(): Map<string, ModuleMetadata> {
    return new Map(this.modules);
  }

  /**
   * Get active modules
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
    
    this.logger.info('🧹 Disposed all modules');
  }

  /**
   * Validate module compatibility
   */
  validateModuleCompatibility(module: Module): boolean {
    // Check if domain is already registered
    if (this.modules.has(module.domain)) {
      this.logger.warning(`⚠️ Domain already registered: ${module.domain}`);
      return false;
    }

    // Check required dependencies
    const requiredDeps = module.getRequiredDependencies();
    for (const dep of requiredDeps) {
      if (!this.container.has(dep)) {
        this.logger.warning(`⚠️ Missing dependency: ${dep.toString()}`);
        return false;
      }
    }

    return true;
  }
}

/**
 * Base class for domain modules to reduce boilerplate
 */
export abstract class BaseModule implements Module {
  abstract readonly name: string;
  abstract readonly domain: string;
  abstract readonly version: string;
  abstract readonly description?: string;

  protected container?: Container;
  protected logger?: LoggerService;
  protected eventBus?: EventBus;

  /**
   * Initialize module with DI container access
   */
  async initialize(): Promise<void> {
    // Override in subclasses for custom initialization
  }

  /**
   * Create actor factory - must be implemented by subclasses
   */
  abstract createActorFactory(): ActorFactory<DomainActor>;

  /**
   * Register services - override in subclasses
   */
  registerServices(container: Container): void {
    this.container = container;
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    this.eventBus = container.get(Symbol.for('EventBus')) as EventBus;
  }

  /**
   * Default required dependencies
   */
  getRequiredDependencies(): symbol[] {
    return [
      Symbol.for('EventBus'),
      Symbol.for('Logger'),
    ];
  }

  /**
   * Default config validation - override in subclasses
   */
  validateConfig(config: unknown): boolean {
    return config !== null && config !== undefined;
  }

  /**
   * Cleanup - override in subclasses
   */
  async dispose(): Promise<void> {
    // Override in subclasses for cleanup
  }
}