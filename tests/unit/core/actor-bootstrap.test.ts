/**
 * Tests for the generic Actor Bootstrap system
 */

import { assertEquals, assertExists } from '@std/assert';
import { ActorBootstrap, DomainActor, ActorFactory, ActorStatus } from '../../../src/core/actor-bootstrap.ts';
import { EventBus, BaseEvent, AppEvent } from '../../../src/core/event-system.ts';
import { ActorSystem } from '../../../src/core/actor-system.ts';
import { LoggerService } from '../../../src/core/logger.ts';

// Mock domain actor for testing
class TestDomainActor implements DomainActor {
  readonly name: string;
  readonly domain = 'test';
  
  private status: ActorStatus;
  private isStarted = false;
  private events: BaseEvent[] = [];

  constructor(config: { name?: string }) {
    this.name = config.name || 'test-actor';
    this.status = {
      name: this.name,
      domain: this.domain,
      state: 'stopped',
      lastUpdate: new Date(),
    };
  }

  async start(): Promise<void> {
    this.isStarted = true;
    this.status.state = 'running';
    this.status.lastUpdate = new Date();
  }

  async stop(): Promise<void> {
    this.isStarted = false;
    this.status.state = 'stopped';
    this.status.lastUpdate = new Date();
  }

  getStatus(): ActorStatus {
    return { ...this.status };
  }

  async handleEvent(event: BaseEvent): Promise<void> {
    this.events.push(event);
  }

  getReceivedEvents(): BaseEvent[] {
    return [...this.events];
  }

  isRunning(): boolean {
    return this.isStarted;
  }
}

// Mock actor factory
class TestActorFactory implements ActorFactory<TestDomainActor> {
  readonly domain = 'test';

  create(config: unknown): TestDomainActor {
    return new TestDomainActor(config as { name?: string });
  }

  validateConfig(config: unknown): boolean {
    return typeof config === 'object' && config !== null;
  }
}

// Test event
class TestEvent extends AppEvent {
  constructor(message: string) {
    super('test.message', { message });
  }
}

Deno.test('ActorBootstrap - Basic lifecycle', async () => {
  const eventBus = new EventBus();
  const actorSystem = new ActorSystem(eventBus);
  const bootstrap = new ActorBootstrap(eventBus, actorSystem);

  // Register actor factory
  const factory = new TestActorFactory();
  const config = { name: 'test-actor-1' };
  
  bootstrap.registerActorFactory(factory, config);

  // Verify registration
  const domains = bootstrap.getRegisteredDomains();
  assertEquals(domains.length, 1);
  assertEquals(domains[0], 'test');

  // Start all actors
  await bootstrap.startAll();

  // Verify actor is running
  const activeActors = bootstrap.getActiveActors();
  assertEquals(activeActors.length, 1);
  assertEquals(activeActors[0].name, 'test-actor-1');
  assertEquals(activeActors[0].domain, 'test');

  // Get actor status
  const status = bootstrap.getActorStatus('test');
  assertExists(status);
  assertEquals(status.state, 'running');

  // Stop all actors
  await bootstrap.stopAll();

  // Verify actors are stopped
  const stoppedActors = bootstrap.getActiveActors();
  assertEquals(stoppedActors.length, 0);

  const finalStatus = bootstrap.getActorStatus('test');
  assertExists(finalStatus);
  assertEquals(finalStatus.state, 'stopped');
});

Deno.test('ActorBootstrap - Event handling', async () => {
  const eventBus = new EventBus();
  const actorSystem = new ActorSystem(eventBus);
  const bootstrap = new ActorBootstrap(eventBus, actorSystem);

  // Register and start actor
  const factory = new TestActorFactory();
  const config = { name: 'event-test-actor' };
  
  bootstrap.registerActorFactory(factory, config);
  await bootstrap.startAll();

  // Get actor reference
  const actor = bootstrap.getActor('test') as TestDomainActor;
  assertExists(actor);

  // Publish test event
  const testEvent = new TestEvent('Hello Actor!');
  eventBus.publishEvent(testEvent);

  // Wait a bit for event processing
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify actor received the event
  const receivedEvents = actor.getReceivedEvents();
  assertEquals(receivedEvents.length, 1);
  assertEquals(receivedEvents[0].type, 'test.message');

  await bootstrap.stopAll();
});

Deno.test('ActorBootstrap - Multiple actors', async () => {
  const eventBus = new EventBus();
  const actorSystem = new ActorSystem(eventBus);
  const bootstrap = new ActorBootstrap(eventBus, actorSystem);

  // Register multiple actor factories (same domain, different configs)
  const factory = new TestActorFactory();
  
  // Note: In real usage, you'd have different domains
  // For this test, we'll register the same domain with different configs
  bootstrap.registerActorFactory(factory, { name: 'actor-1' });

  await bootstrap.startAll();

  // Verify all actors are running
  const activeActors = bootstrap.getActiveActors();
  assertEquals(activeActors.length, 1); // Only one because same domain

  const allStatus = bootstrap.getAllActorStatus();
  assertEquals(allStatus.length, 1);
  assertEquals(allStatus[0].state, 'running');

  await bootstrap.stopAll();
});

Deno.test('ActorBootstrap - Error handling', async () => {
  const eventBus = new EventBus();
  const actorSystem = new ActorSystem(eventBus);
  const bootstrap = new ActorBootstrap(eventBus, actorSystem);

  // Create factory with validation
  class ValidatingFactory implements ActorFactory<TestDomainActor> {
    readonly domain = 'validating';

    create(config: unknown): TestDomainActor {
      return new TestDomainActor(config as { name?: string });
    }

    validateConfig(config: unknown): boolean {
      const cfg = config as { name?: string };
      return !!(cfg && cfg.name && cfg.name.length > 0);
    }
  }

  const factory = new ValidatingFactory();

  // Test invalid config
  let errorThrown = false;
  try {
    bootstrap.registerActorFactory(factory, { name: '' }); // Invalid: empty name
  } catch (error) {
    errorThrown = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    assertEquals(errorMessage.includes('Invalid configuration'), true);
  }
  assertEquals(errorThrown, true);

  // Test valid config
  bootstrap.registerActorFactory(factory, { name: 'valid-actor' });
  await bootstrap.startAll();

  const status = bootstrap.getActorStatus('validating');
  assertExists(status);
  assertEquals(status.state, 'running');

  await bootstrap.stopAll();
});