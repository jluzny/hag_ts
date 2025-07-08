/**
 * Generic Actor Bootstrap System
 * Provides a framework for registering and managing domain-specific actors
 * with event-driven lifecycle management
 */

import { LoggerService } from './logger.ts';
import { EventBus, BaseEvent } from './event-system.ts';
import { ActorSystem } from './actor-system.ts';

// Generic actor interface that all domain actors must implement
export interface DomainActor {
  readonly name: string;
  readonly domain: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  getStatus(): ActorStatus;
  handleEvent?(event: BaseEvent): Promise<void> | void;
}

// Actor status interface
export interface ActorStatus {
  name: string;
  domain: string;
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  lastUpdate: Date;
  metadata?: Record<string, unknown>;
}

// Actor factory interface for creating domain-specific actors
export interface ActorFactory<T extends DomainActor> {
  readonly domain: string;
  create(config: unknown): T;
  validateConfig?(config: unknown): boolean;
}

// Actor registration information
interface ActorRegistration {
  factory: ActorFactory<DomainActor>;
  config: unknown;
  instance?: DomainActor;
  status: ActorStatus;
}

/**
 * Generic Actor Bootstrap manages the lifecycle of domain-specific actors
 */
export class ActorBootstrap {
  private registrations = new Map<string, ActorRegistration>();
  private logger: LoggerService;
  private eventBus: EventBus;
  private actorSystem: ActorSystem;
  private isStarted = false;

  constructor(
    eventBus: EventBus,
    actorSystem: ActorSystem,
    logger?: LoggerService,
  ) {
    this.logger = logger || new LoggerService('HAG.actor-bootstrap');
    this.logger.debug('📍 ActorBootstrap.constructor() ENTRY');
    this.eventBus = eventBus;
    this.actorSystem = actorSystem;
    this.logger.debug('📍 ActorBootstrap.constructor() EXIT');
  }

  /**
   * Register an actor factory for a specific domain
   */
  registerActorFactory<T extends DomainActor>(
    factory: ActorFactory<T>,
    config: unknown,
  ): void {
    this.logger.debug('📍 ActorBootstrap.registerActorFactory() ENTRY');
    const domain = factory.domain;

    // Validate configuration if factory provides validation
    if (factory.validateConfig && !factory.validateConfig(config)) {
      throw new Error(`Invalid configuration for actor domain: ${domain}`);
    }

    this.registrations.set(domain, {
      factory: factory as ActorFactory<DomainActor>,
      config,
      status: {
        name: domain,
        domain,
        state: 'stopped',
        lastUpdate: new Date(),
      },
    });

    this.logger.info(`🏭 Registered actor factory for domain: ${domain}`);
    this.logger.debug('📍 ActorBootstrap.registerActorFactory() EXIT');
  }

  /**
   * Start all registered actors
   */
  async startAll(): Promise<void> {
    this.logger.debug('📍 ActorBootstrap.startAll() ENTRY');
    if (this.isStarted) {
      this.logger.warning('⚠️ Actor bootstrap already started');
      return;
    }

    this.logger.info('🚀 Starting actor bootstrap system', {
      registeredDomains: Array.from(this.registrations.keys()),
    });

    const startPromises: Promise<void>[] = [];

    for (const [domain, registration] of this.registrations) {
      startPromises.push(this.startActor(domain, registration));
    }

    await Promise.allSettled(startPromises);
    this.isStarted = true;

    this.logger.info('✅ Actor bootstrap system started', {
      activeActors: this.getActiveActors().length,
    });
    this.logger.debug('📍 ActorBootstrap.startAll() EXIT');
  }

  /**
   * Stop all actors
   */
  async stopAll(): Promise<void> {
    this.logger.debug('📍 ActorBootstrap.stopAll() ENTRY');
    if (!this.isStarted) {
      this.logger.warning('⚠️ Actor bootstrap not started');
      return;
    }

    this.logger.info('🛑 Stopping actor bootstrap system');

    const stopPromises: Promise<void>[] = [];

    for (const [domain, registration] of this.registrations) {
      if (registration.instance) {
        stopPromises.push(this.stopActor(domain, registration));
      }
    }

    await Promise.allSettled(stopPromises);
    this.isStarted = false;

    this.logger.info('✅ Actor bootstrap system stopped');
    this.logger.debug('📍 ActorBootstrap.stopAll() EXIT');
  }

  /**
   * Start a specific actor
   */
  private async startActor(
    domain: string,
    registration: ActorRegistration,
  ): Promise<void> {
    this.logger.debug('📍 ActorBootstrap.startActor() ENTRY');
    try {
      this.updateActorStatus(domain, 'starting');

      this.logger.info(`🎭 Starting actor: ${domain}`);

      // Create actor instance
      const actor = registration.factory.create(registration.config);
      registration.instance = actor;

      // Subscribe to events if actor supports event handling
      if (actor.handleEvent) {
        this.subscribeActorToEvents(actor);
      }

      // Start the actor
      await actor.start();

      this.updateActorStatus(domain, 'running', {
        actorName: actor.name,
      });

      this.logger.info(`✅ Actor started successfully: ${domain}`, {
        actorName: actor.name,
      });
    } catch (error) {
      this.updateActorStatus(domain, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });

      this.logger.error(`❌ Failed to start actor: ${domain}`, error);
      throw error;
    }
    this.logger.debug('📍 ActorBootstrap.startActor() EXIT');
  }

  /**
   * Stop a specific actor
   */
  private async stopActor(
    domain: string,
    registration: ActorRegistration,
  ): Promise<void> {
    this.logger.debug('📍 ActorBootstrap.stopActor() ENTRY');
    if (!registration.instance) return;

    try {
      this.updateActorStatus(domain, 'stopping');

      this.logger.info(`🛑 Stopping actor: ${domain}`);

      await registration.instance.stop();
      registration.instance = undefined;

      this.updateActorStatus(domain, 'stopped');

      this.logger.info(`✅ Actor stopped successfully: ${domain}`);
    } catch (error) {
      this.updateActorStatus(domain, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });

      this.logger.error(`❌ Failed to stop actor: ${domain}`, error);
      throw error;
    }
    this.logger.debug('📍 ActorBootstrap.stopActor() EXIT');
  }

  /**
   * Subscribe actor to relevant events
   */
  private subscribeActorToEvents(actor: DomainActor): void {
    this.logger.debug('📍 ActorBootstrap.subscribeActorToEvents() ENTRY');
    if (!actor.handleEvent) return;
    
    // Subscribe to all domain events and system events
    this.eventBus.subscribeToEvent(`${actor.domain}.temperature_update`, async (event: BaseEvent) => {
      try {
        await actor.handleEvent!(event);
      } catch (error) {
        this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
          eventType: event.type,
        });
      }
    });

    this.eventBus.subscribeToEvent(`${actor.domain}.mode_change_request`, async (event: BaseEvent) => {
      try {
        await actor.handleEvent!(event);
      } catch (error) {
        this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
          eventType: event.type,
        });
      }
    });

    this.eventBus.subscribeToEvent(`${actor.domain}.evaluate_conditions`, async (event: BaseEvent) => {
      try {
        await actor.handleEvent!(event);
      } catch (error) {
        this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
          eventType: event.type,
        });
      }
    });

    // Subscribe to any event that starts with the domain prefix (for flexibility)
    this.eventBus.subscribeToEvent(`${actor.domain}.message`, async (event: BaseEvent) => {
      try {
        await actor.handleEvent!(event);
      } catch (error) {
        this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
          eventType: event.type,
        });
      }
    });

    this.eventBus.subscribeToEvent('system.shutdown', async (event: BaseEvent) => {
      try {
        await actor.handleEvent!(event);
      } catch (error) {
        this.logger.error(`❌ Actor event handling error: ${actor.name}`, error, {
          eventType: event.type,
        });
      }
    });

    const subscribedEvents = [
      `${actor.domain}.temperature_update`,
      `${actor.domain}.mode_change_request`, 
      `${actor.domain}.evaluate_conditions`,
      `${actor.domain}.message`,
      'system.shutdown'
    ];

    this.logger.debug(`📡 Subscribed actor to events: ${actor.name}`, {
      domain: actor.domain,
      subscribedEvents: subscribedEvents,
    });
    this.logger.debug('📍 ActorBootstrap.subscribeActorToEvents() EXIT');
  }

  /**
   * Update actor status
   */
  private updateActorStatus(
    domain: string,
    state: ActorStatus['state'],
    metadata?: Record<string, unknown>,
  ): void {
    this.logger.debug('📍 ActorBootstrap.updateActorStatus() ENTRY');
    const registration = this.registrations.get(domain);
    if (registration) {
      registration.status = {
        ...registration.status,
        state,
        lastUpdate: new Date(),
        metadata: metadata ? { ...registration.status.metadata, ...metadata } : registration.status.metadata,
      };
    }
    this.logger.debug('📍 ActorBootstrap.updateActorStatus() EXIT');
  }

  /**
   * Get status of all actors
   */
  getAllActorStatus(): ActorStatus[] {
    this.logger.debug('📍 ActorBootstrap.getAllActorStatus() ENTRY');
    const result = Array.from(this.registrations.values()).map(reg => ({
      ...reg.status,
      ...(reg.instance ? reg.instance.getStatus() : {}),
    }));
    this.logger.debug('📍 ActorBootstrap.getAllActorStatus() EXIT');
    return result;
  }

  /**
   * Get status of a specific actor
   */
  getActorStatus(domain: string): ActorStatus | undefined {
    this.logger.debug('📍 ActorBootstrap.getActorStatus() ENTRY');
    const registration = this.registrations.get(domain);
    if (!registration) return undefined;

    const result = {
      ...registration.status,
      ...(registration.instance ? registration.instance.getStatus() : {}),
    };
    this.logger.debug('📍 ActorBootstrap.getActorStatus() EXIT');
    return result;
  }

  /**
   * Get list of active actors
   */
  getActiveActors(): DomainActor[] {
    this.logger.debug('📍 ActorBootstrap.getActiveActors() ENTRY');
    const result = Array.from(this.registrations.values())
      .map(reg => reg.instance)
      .filter((actor): actor is DomainActor => actor !== undefined);
    this.logger.debug('📍 ActorBootstrap.getActiveActors() EXIT');
    return result;
  }

  /**
   * Get actor by domain
   */
  getActor(domain: string): DomainActor | undefined {
    this.logger.debug('📍 ActorBootstrap.getActor() ENTRY');
    const result = this.registrations.get(domain)?.instance;
    this.logger.debug('📍 ActorBootstrap.getActor() EXIT');
    return result;
  }

  /**
   * Check if bootstrap system is running
   */
  isRunning(): boolean {
    this.logger.debug('📍 ActorBootstrap.isRunning() ENTRY');
    const result = this.isStarted;
    this.logger.debug('📍 ActorBootstrap.isRunning() EXIT');
    return result;
  }

  /**
   * Get registered domains
   */
  getRegisteredDomains(): string[] {
    this.logger.debug('📍 ActorBootstrap.getRegisteredDomains() ENTRY');
    const result = Array.from(this.registrations.keys());
    this.logger.debug('📍 ActorBootstrap.getRegisteredDomains() EXIT');
    return result;
  }
}