/**
 * Actor Manager - consolidates ActorBootstrap and ActorSystem
 * Provides a single interface for managing both domain actors and state machine actors
 */

import { Container } from '@needle-di/core';
import { LoggerService } from './logger.ts';
import { EventBus, BaseEvent } from './event-system.ts';
import { DomainActor, ActorFactory, ActorStatus } from './actor-bootstrap.ts';
import { ModuleRegistry, Module } from './module-registry.ts';
import { createActor } from 'xstate';

/**
 * State machine actor interface
 */
interface StateMachineActor {
  start(): void;
  stop(): void;
  send(event: StateMachineEvent): void;
  getSnapshot(): unknown;
  subscribe(observer: (snapshot: unknown) => void): { unsubscribe(): void };
}

interface StateMachineEvent {
  type: string;
  [key: string]: unknown;
}

// State machine type
// deno-lint-ignore no-explicit-any
type StateMachine = any;

/**
 * Actor registration for domain actors
 */
interface ActorRegistration {
  type: 'domain';
  factory: ActorFactory<DomainActor>;
  config: unknown;
  instance?: DomainActor;
  status: ActorStatus;
  module?: Module;
}

/**
 * State machine actor registration
 */
interface StateMachineActorRegistration {
  type: 'state-machine';
  machine: StateMachine;
  actor: StateMachineActor;
  status: {
    name: string;
    domain: string;
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
    lastUpdate: Date;
    metadata?: Record<string, unknown>;
  };
}

type ActorRegistrationUnion = ActorRegistration | StateMachineActorRegistration;

/**
 * Actor manager that handles both domain actors and state machine actors
 */
export class ActorManager {
  private registrations = new Map<string, ActorRegistrationUnion>();
  private moduleRegistry: ModuleRegistry;
  private container: Container;
  private logger: LoggerService;
  private eventBus: EventBus;
  private isStarted = false;

  constructor(container: Container, logger?: LoggerService) {
    this.container = container;
    this.logger = logger || new LoggerService('HAG.actor-manager');
    this.eventBus = container.get(Symbol.for('EventBus')) as EventBus;
    this.moduleRegistry = new ModuleRegistry(container, 
      new LoggerService('HAG.module-registry')
    );
  }

  /**
   * Register a domain module
   */
  async registerModule(module: Module, config: unknown): Promise<void> {
    try {
      await this.moduleRegistry.registerModule(module, config);
      
      // Get the actor factory from the module
      const factory = this.moduleRegistry.getActorFactory(module.domain);
      if (!factory) {
        throw new Error(`Module ${module.domain} did not provide actor factory`);
      }

      // Register the actor with the manager
      const registration: ActorRegistration = {
        type: 'domain',
        factory,
        config,
        module,
        status: {
          name: module.domain,
          domain: module.domain,
          state: 'stopped',
          lastUpdate: new Date(),
        },
      };

      this.registrations.set(module.domain, registration);
      
      this.logger.info(`🏭 Registered module actor: ${module.domain}`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to register module: ${module.domain}`, error);
      throw error;
    }
  }

  /**
   * Register an actor factory directly (backward compatibility)
   */
  registerActorFactory<T extends DomainActor>(
    factory: ActorFactory<T>,
    config: unknown,
  ): void {
    const domain = factory.domain;

    // Validate configuration if factory provides validation
    if (factory.validateConfig && !factory.validateConfig(config)) {
      throw new Error(`Invalid configuration for actor domain: ${domain}`);
    }

    const registration: ActorRegistration = {
      type: 'domain',
      factory: factory as ActorFactory<DomainActor>,
      config,
      status: {
        name: domain,
        domain,
        state: 'stopped',
        lastUpdate: new Date(),
      },
    };

    this.registrations.set(domain, registration);
    this.logger.info(`🏭 Registered actor factory for domain: ${domain}`);
  }

  /**
   * Create and register a state machine actor
   */
  createStateMachineActor(name: string, machine: StateMachine, domain = 'state-machine'): StateMachineActor {
    // deno-lint-ignore no-explicit-any
    const actor = createActor(machine as any) as StateMachineActor;
    
    const registration: StateMachineActorRegistration = {
      type: 'state-machine',
      machine,
      actor,
      status: {
        name,
        domain,
        state: 'stopped',
        lastUpdate: new Date(),
      },
    };

    this.registrations.set(name, registration);
    this.logger.info(`🎭 Created state machine actor: ${name}`);
    
    return actor;
  }

  /**
   * Start all registered actors
   */
  async startAll(): Promise<void> {
    if (this.isStarted) {
      this.logger.warning('⚠️ Actor manager already started');
      return;
    }

    this.logger.info('🚀 Starting actor manager', {
      registeredActors: Array.from(this.registrations.keys()),
    });

    const startPromises: Promise<void>[] = [];

    for (const [name, registration] of this.registrations) {
      if (registration.type === 'domain') {
        startPromises.push(this.startDomainActor(name, registration));
      } else {
        startPromises.push(this.startStateMachineActor(name, registration));
      }
    }

    await Promise.allSettled(startPromises);
    this.isStarted = true;

    this.logger.info('✅ Actor manager started', {
      activeActors: this.getActiveActors().length,
    });
  }

  /**
   * Stop all actors
   */
  async stopAll(): Promise<void> {
    if (!this.isStarted) {
      this.logger.warning('⚠️ Actor manager not started');
      return;
    }

    this.logger.info('🛑 Stopping actor manager');

    const stopPromises: Promise<void>[] = [];

    for (const [name, registration] of this.registrations) {
      if (registration.type === 'domain') {
        if (registration.instance) {
          stopPromises.push(this.stopDomainActor(name, registration));
        }
      } else {
        stopPromises.push(this.stopStateMachineActor(name, registration));
      }
    }

    await Promise.allSettled(stopPromises);
    
    // Dispose all modules
    await this.moduleRegistry.disposeAll();
    
    this.isStarted = false;
    this.logger.info('✅ Actor manager stopped');
  }

  /**
   * Start a domain actor
   */
  private async startDomainActor(
    name: string,
    registration: ActorRegistration,
  ): Promise<void> {
    try {
      this.updateActorStatus(name, 'starting');
      this.logger.info(`🎭 Starting domain actor: ${name}`);

      // Create actor instance
      const actor = registration.factory.create(registration.config);
      registration.instance = actor;

      // Subscribe to events if actor supports event handling
      if (actor.handleEvent) {
        this.subscribeActorToEvents(actor);
      }

      // Start the actor
      await actor.start();

      this.updateActorStatus(name, 'running', {
        actorName: actor.name,
        type: 'domain',
      });

      this.logger.info(`✅ Domain actor started: ${name}`, {
        actorName: actor.name,
      });
    } catch (error) {
      this.updateActorStatus(name, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(`❌ Failed to start domain actor: ${name}`, error);
      throw error;
    }
  }

  /**
   * Start a state machine actor
   */
  private startStateMachineActor(
    name: string,
    registration: StateMachineActorRegistration,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.updateActorStatus(name, 'starting');
        this.logger.info(`🎭 Starting state machine actor: ${name}`);

        registration.actor.start();

        this.updateActorStatus(name, 'running', {
          type: 'state-machine',
        });

        this.logger.info(`✅ State machine actor started: ${name}`);
        resolve();
      } catch (error) {
        this.updateActorStatus(name, 'error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(`❌ Failed to start state machine actor: ${name}`, error);
        reject(error);
      }
    });
  }

  /**
   * Stop a domain actor
   */
  private async stopDomainActor(
    name: string,
    registration: ActorRegistration,
  ): Promise<void> {
    if (!registration.instance) return;

    try {
      this.updateActorStatus(name, 'stopping');
      this.logger.info(`🛑 Stopping domain actor: ${name}`);

      await registration.instance.stop();
      registration.instance = undefined;

      this.updateActorStatus(name, 'stopped');
      this.logger.info(`✅ Domain actor stopped: ${name}`);
    } catch (error) {
      this.updateActorStatus(name, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(`❌ Failed to stop domain actor: ${name}`, error);
      throw error;
    }
  }

  /**
   * Stop a state machine actor
   */
  private stopStateMachineActor(
    name: string,
    registration: StateMachineActorRegistration,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.updateActorStatus(name, 'stopping');
        this.logger.info(`🛑 Stopping state machine actor: ${name}`);

        registration.actor.stop();

        this.updateActorStatus(name, 'stopped');
        this.logger.info(`✅ State machine actor stopped: ${name}`);
        resolve();
      } catch (error) {
        this.updateActorStatus(name, 'error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(`❌ Failed to stop state machine actor: ${name}`, error);
        reject(error);
      }
    });
  }

  /**
   * Subscribe domain actor to events
   */
  private subscribeActorToEvents(actor: DomainActor): void {
    if (!actor.handleEvent) return;
    
    const eventTypes = [
      `${actor.domain}.temperature_update`,
      `${actor.domain}.mode_change_request`,
      `${actor.domain}.evaluate_conditions`,
      `${actor.domain}.message`,
      'system.shutdown'
    ];

    for (const eventType of eventTypes) {
      this.eventBus.subscribeToEvent(eventType, async (event: BaseEvent) => {
        try {
          await actor.handleEvent!(event);
        } catch (error) {
          this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
            eventType: event.type,
          });
        }
      });
    }

    this.logger.debug(`📡 Subscribed actor to events: ${actor.name}`, {
      domain: actor.domain,
      subscribedEvents: eventTypes,
    });
  }

  /**
   * Update actor status
   */
  private updateActorStatus(
    name: string,
    state: ActorStatus['state'],
    metadata?: Record<string, unknown>,
  ): void {
    const registration = this.registrations.get(name);
    if (!registration) return;

    if (registration.type === 'domain') {
      registration.status = {
        ...registration.status,
        state,
        lastUpdate: new Date(),
        metadata: metadata ? { ...registration.status.metadata, ...metadata } : registration.status.metadata,
      };
    } else {
      registration.status = {
        ...registration.status,
        state,
        lastUpdate: new Date(),
        metadata: metadata ? { ...registration.status.metadata, ...metadata } : registration.status.metadata,
      };
    }
  }

  /**
   * Send message to state machine actor
   */
  sendToStateMachineActor(actorName: string, event: StateMachineEvent): void {
    const registration = this.registrations.get(actorName);
    if (registration?.type === 'state-machine') {
      this.logger.debug(`📨 Sending to state machine actor ${actorName}:`, event);
      registration.actor.send(event);
    } else {
      this.logger.warning(`❌ State machine actor not found: ${actorName}`);
    }
  }

  /**
   * Get all actor status
   */
  getAllActorStatus(): ActorStatus[] {
    return Array.from(this.registrations.values()).map(reg => {
      if (reg.type === 'domain') {
        return {
          ...reg.status,
          ...(reg.instance ? reg.instance.getStatus() : {}),
        };
      } else {
        return reg.status;
      }
    });
  }

  /**
   * Get actor by name
   */
  getActor(name: string): DomainActor | StateMachineActor | undefined {
    const registration = this.registrations.get(name);
    if (!registration) return undefined;

    if (registration.type === 'domain') {
      return registration.instance;
    } else {
      return registration.actor;
    }
  }

  /**
   * Get active actors
   */
  getActiveActors(): Array<DomainActor | StateMachineActor> {
    const actors: Array<DomainActor | StateMachineActor> = [];
    
    for (const registration of this.registrations.values()) {
      if (registration.type === 'domain' && registration.instance) {
        actors.push(registration.instance);
      } else if (registration.type === 'state-machine') {
        actors.push(registration.actor);
      }
    }
    
    return actors;
  }

  /**
   * Get module registry
   */
  getModuleRegistry(): ModuleRegistry {
    return this.moduleRegistry;
  }

  /**
   * Check if manager is running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Get registered actor names
   */
  getRegisteredActors(): string[] {
    return Array.from(this.registrations.keys());
  }
}