/**
 * Module Registry - Manages application modules and their lifecycle.
 */

import { Container } from '@needle-di/core';
import { LoggerService } from './logger.ts';

/**
 * Base interface for all application modules.
 */
export interface Module {
  readonly name: string;
  readonly domain: string;
  readonly version: string;
  readonly description: string;

  initialize(config: unknown): Promise<void>;
  registerServices(container: Container): void;
  createActorFactory?(): ActorFactory<DomainActor>;
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

  async initialize(config: unknown): Promise<void> {
    this.config = config;
    this.logger = new LoggerService(`HAG.module.${this.domain}`);
    this.logger.debug(`📍 Module ${this.domain}.initialize() ENTRY`);
    // Default initialization logic
    this.logger.debug(`📍 Module ${this.domain}.initialize() EXIT`);
  }

  registerServices(_container: Container): void {
    this.logger?.debug(`📍 Module ${this.domain}.registerServices() ENTRY`);
    // Default service registration logic (empty)
    this.logger?.debug(`📍 Module ${this.domain}.registerServices() EXIT`);
  }

  createActorFactory?(): ActorFactory<DomainActor> {
    return undefined;
  }

  getRequiredDependencies?(): symbol[] {
    return [];
  }

  validateConfig?(config: unknown): boolean {
    return !!config; // Default validation
  }

  async dispose(): Promise<void> {
    this.logger?.debug(`📍 Module ${this.domain}.dispose() ENTRY`);
    // Default dispose logic
    this.logger?.debug(`📍 Module ${this.domain}.dispose() EXIT`);
  }
}

/**
 * Domain Actor interface - represents a long-running process or service within a module.
 */
export interface DomainActor {
  readonly name: string;
  readonly domain: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus?(): Record<string, unknown>;
  handleEvent?(event: unknown): Promise<void>;
}

/**
 * Actor Factory interface - responsible for creating DomainActor instances.
 */
export interface ActorFactory<T extends DomainActor> {
  readonly domain: string;
  create(config: unknown): T;
  validateConfig?(config: unknown): boolean;
}

/**
 * Status of an actor.
 */
export interface ActorStatus {
  name: string;
  domain: string;
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  lastUpdate: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Manages the registration, initialization, and lifecycle of application modules.
 */
export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private actorFactories = new Map<string, ActorFactory<DomainActor>>();
  private commonConfig?: unknown;
  private logger: LoggerService;

  constructor(container: Container, logger: LoggerService) {
    this.logger = logger;
    this.logger.debug('📍 ModuleRegistry.constructor() ENTRY');
    // Register self in container for other modules to access if needed
    container.bind({ provide: Symbol.for('ModuleRegistry'), useValue: this });
    this.logger.debug('📍 ModuleRegistry.constructor() EXIT');
  }

  /**
   * Register a module with the registry.
   */
  async registerModule(module: Module, config: unknown): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.registerModule() ENTRY');
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

    // Register actor factory if provided by the module
    const actorFactory = module.createActorFactory?.();
    if (actorFactory) {
      this.actorFactories.set(module.domain, actorFactory);
      this.logger.info(`🏭 Registered actor factory for module: ${module.domain}`);
    }

    this.logger.info(`✅ Module registered: ${module.name} (${module.version})`);
    this.logger.debug('📍 ModuleRegistry.registerModule() EXIT');
  }

  /**
   * Set common configuration for all modules.
   */
  setCommonConfig(config: unknown): void {
    this.logger.debug('📍 ModuleRegistry.setCommonConfig() ENTRY');
    this.commonConfig = config;
    this.logger.debug('📍 ModuleRegistry.setCommonConfig() EXIT');
  }

  /**
   * Get common configuration.
   */
  getCommonConfig<T>(): T | undefined {
    this.logger.debug('📍 ModuleRegistry.getCommonConfig() ENTRY');
    const result = this.commonConfig as T;
    this.logger.debug('📍 ModuleRegistry.getCommonConfig() EXIT');
    return result;
  }

  /**
   * Get configuration for a specific module.
   */
  getModuleConfig<T>(domain: string): T | undefined {
    this.logger.debug('📍 ModuleRegistry.getModuleConfig() ENTRY');
    const module = this.modules.get(domain);
    const result = module ? (module as BaseModule).config as T : undefined;
    this.logger.debug('📍 ModuleRegistry.getModuleConfig() EXIT');
    return result;
  }

  /**
   * Get merged configuration (module-specific + common).
   */
  getMergedConfig<T>(domain: string): T | undefined {
    this.logger.debug('📍 ModuleRegistry.getMergedConfig() ENTRY');
    const moduleConfig = this.getModuleConfig<T>(domain);
    const commonConfig = this.getCommonConfig<T>();
    const result = { ...commonConfig, ...moduleConfig } as T;
    this.logger.debug('📍 ModuleRegistry.getMergedConfig() EXIT');
    return result;
  }

  /**
   * Get a registered module by its domain.
   */
  getModule(domain: string): Module | undefined {
    this.logger.debug('📍 ModuleRegistry.getModule() ENTRY');
    const result = this.modules.get(domain);
    this.logger.debug('📍 ModuleRegistry.getModule() EXIT');
    return result;
  }

  /**
   * Get an actor factory for a given domain.
   */
  getActorFactory(domain: string): ActorFactory<DomainActor> | undefined {
    this.logger.debug('📍 ModuleRegistry.getActorFactory() ENTRY');
    const result = this.actorFactories.get(domain);
    this.logger.debug('📍 ModuleRegistry.getActorFactory() EXIT');
    return result;
  }

  /**
   * Get all active modules.
   */
  getActiveModules(): Module[] {
    this.logger.debug('📍 ModuleRegistry.getActiveModules() ENTRY');
    const result = Array.from(this.modules.values());
    this.logger.debug('📍 ModuleRegistry.getActiveModules() EXIT');
    return result;
  }

  /**
   * Get status of a specific module.
   */
  getModuleStatus(domain: string): ActorStatus | undefined {
    this.logger.debug('📍 ModuleRegistry.getModuleStatus() ENTRY');
    const module = this.modules.get(domain);
    // Assuming module has a getStatus method or similar
    const result = module ? { name: module.name, domain: module.domain, state: 'running', lastUpdate: new Date() } : undefined;
    this.logger.debug('📍 ModuleRegistry.getModuleStatus() EXIT');
    return result;
  }

  /**
   * Check if a module is registered.
   */
  hasModule(domain: string): boolean {
    this.logger.debug('📍 ModuleRegistry.hasModule() ENTRY');
    const result = this.modules.has(domain);
    this.logger.debug('📍 ModuleRegistry.hasModule() EXIT');
    return result;
  }

  /**
   * Get list of registered module domains.
   */
  getRegisteredModules(): string[] {
    this.logger.debug('📍 ModuleRegistry.getRegisteredModules() ENTRY');
    const result = Array.from(this.modules.keys());
    this.logger.debug('📍 ModuleRegistry.getRegisteredModules() EXIT');
    return result;
  }

  /**
   * Initialize all registered modules.
   */
  async initializeModule(domain: string, config: unknown): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.initializeModule() ENTRY');
    const module = this.modules.get(domain);
    if (module) {
      await module.initialize(config);
    } else {
      this.logger.warning(`⚠️ Module ${domain} not found for initialization.`);
    }
    this.logger.debug('📍 ModuleRegistry.initializeModule() EXIT');
  }

  /**
   * Dispose all registered modules.
   */
  async disposeAll(): Promise<void> {
    this.logger.debug('📍 ModuleRegistry.disposeAll() ENTRY');
    for (const module of this.modules.values()) {
      try {
        await module.dispose();
      } catch (error) {
        this.logger.error(`❌ Error disposing module ${module.domain}:`, error);
      }
    }
    this.modules.clear();
    this.actorFactories.clear();
    this.logger.info('🗑️ All modules disposed.');
    this.logger.debug('📍 ModuleRegistry.disposeAll() EXIT');
  }
}
