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


    this.logger.info(`✅ Module registered: ${module.name} (${module.version})`);
    this.logger.debug('📍 ModuleRegistry.registerModule() EXIT');
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
