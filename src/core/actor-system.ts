/**
 * XState Actor System for managing domain actors
 * Integrates with EventBus to route events to appropriate actors
 */

import { createActor } from 'xstate';
import { LoggerService } from './logger.ts';
import { EventBus } from './event-system.ts';

// Type definitions for XState actors
interface XStateActor {
  start(): void;
  stop(): void;
  send(event: XStateEvent): void;
  getSnapshot(): unknown;
  subscribe(observer: (snapshot: unknown) => void): { unsubscribe(): void };
}

interface XStateEvent {
  type: string;
  [key: string]: unknown;
}

// XState machine type - needs to be any due to complex XState generics
// deno-lint-ignore no-explicit-any
type XStateMachine = any;

export class ActorSystem {
  private actors = new Map<string, XStateActor>();
  private logger: LoggerService;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, logger?: LoggerService) {
    this.logger = logger || new LoggerService('HAG.actor-system');
    this.logger.debug('📍 ActorSystem.constructor() ENTRY');
    this.eventBus = eventBus;
    this.logger.debug('📍 ActorSystem.constructor() EXIT');
  }

  /**
   * Create and start an XState actor
   */
  createActor(name: string, machine: XStateMachine): XStateActor {
    this.logger.debug('📍 ActorSystem.createActor() ENTRY');
    // deno-lint-ignore no-explicit-any
    const actor = createActor(machine as any) as XStateActor;
    actor.start();

    this.actors.set(name, actor);
    this.logger.debug(`🎭 Started actor: ${name}`);

    this.logger.debug('📍 ActorSystem.createActor() EXIT');
    return actor;
  }

  /**
   * Get actor by name
   */
  getActor(name: string): XStateActor | undefined {
    this.logger.debug('📍 ActorSystem.getActor() ENTRY');
    const result = this.actors.get(name);
    this.logger.debug('📍 ActorSystem.getActor() EXIT');
    return result;
  }

  /**
   * Send message to specific actor
   */
  send(actorName: string, event: XStateEvent): void {
    this.logger.debug('📍 ActorSystem.send() ENTRY');
    const actor = this.actors.get(actorName);
    if (actor) {
      this.logger.debug(`📨 Sending to ${actorName}:`, event);
      actor.send(event);
    } else {
      this.logger.warning(`❌ Actor not found: ${actorName}`);
    }
    this.logger.debug('📍 ActorSystem.send() EXIT');
  }

  /**
   * Subscribe actor to EventBus events
   * Converts EventBus events to actor messages
   */
  subscribeActorToEvents(actorName: string, eventType: string): () => void {
    this.logger.debug('📍 ActorSystem.subscribeActorToEvents() ENTRY');
    const actor = this.actors.get(actorName);
    if (!actor) {
      this.logger.warning(
        `❌ Cannot subscribe - actor not found: ${actorName}`,
      );
      return () => {};
    }

    const unsubscribe = this.eventBus.subscribe(eventType, (event) => {
      // Convert event type to actor message format
      const messageType = eventType.toUpperCase().replace('.', '_');
      actor.send({ type: messageType, event });
    });

    this.logger.debug('📍 ActorSystem.subscribeActorToEvents() EXIT');
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }

  /**
   * Broadcast event to all actors
   */
  broadcast(event: XStateEvent): void {
    this.logger.debug('📍 ActorSystem.broadcast() ENTRY');
    this.actors.forEach((actor, name) => {
      this.logger.debug(`📢 Broadcasting to ${name}:`, event);
      actor.send(event);
    });
    this.logger.debug('📍 ActorSystem.broadcast() EXIT');
  }

  /**
   * Get current state of an actor
   */
  getActorState(actorName: string): unknown {
    this.logger.debug('📍 ActorSystem.getActorState() ENTRY');
    const actor = this.actors.get(actorName);
    const result = actor ? actor.getSnapshot() : null;
    this.logger.debug('📍 ActorSystem.getActorState() EXIT');
    return result;
  }

  /**
   * Stop and remove an actor
   */
  stopActor(actorName: string): void {
    this.logger.debug('📍 ActorSystem.stopActor() ENTRY');
    const actor = this.actors.get(actorName);
    if (actor) {
      actor.stop();
      this.actors.delete(actorName);
      this.logger.debug(`🛑 Stopped actor: ${actorName}`);
    }
    this.logger.debug('📍 ActorSystem.stopActor() EXIT');
  }

  /**
   * Stop all actors
   */
  stopAll(): void {
    this.logger.debug('📍 ActorSystem.stopAll() ENTRY');
    this.actors.forEach((actor, name) => {
      actor.stop();
      this.logger.debug(`🛑 Stopped actor: ${name}`);
    });
    this.actors.clear();
    this.logger.debug('📍 ActorSystem.stopAll() EXIT');
  }

  /**
   * Get list of active actors
   */
  getActiveActors(): string[] {
    this.logger.debug('📍 ActorSystem.getActiveActors() ENTRY');
    const result = Array.from(this.actors.keys());
    this.logger.debug('📍 ActorSystem.getActiveActors() EXIT');
    return result;
  }
}
