/**
 * Generic event-driven pub/sub system with XState actor integration
 * Supports both Home Assistant events and custom application events
 * Maintains backward compatibility with existing HassEventImpl
 */

import { EventEmitter } from 'node:events';
import { LoggerService } from './logging.ts';
import { HassEventImpl } from '../home-assistant/models.ts';

export interface BaseEvent {
  readonly type: string;
  readonly timestamp: Date;
  readonly payload?: unknown;
}

export abstract class AppEvent implements BaseEvent {
  public readonly timestamp = new Date();

  constructor(
    public readonly type: string,
    public readonly payload?: unknown,
  ) {}
}

/**
 * Enhanced EventBus supporting both legacy and new event types
 */
export class EventBus extends EventEmitter {
  private logger: LoggerService;

  constructor(logger?: LoggerService) {
    super();
    this.setMaxListeners(100);
    this.logger = logger || new LoggerService('HAG.event-bus');
    this.logger.debug('📍 EventBus.constructor() ENTRY');
    this.logger.debug('📍 EventBus.constructor() EXIT');
  }

  /**
   * Publish any event (new generic method)
   */
  publishEvent<T extends BaseEvent>(event: T): void {
    this.logger.debug('📍 EventBus.publishEvent() ENTRY');
    this.logger.debug(`📤 ${event.type}`, {
      listeners: this.listenerCount(event.type),
      timestamp: event.timestamp,
    });

    this.emit(event.type, event);
    this.logger.debug('📍 EventBus.publishEvent() EXIT');
  }

  /**
   * Publish a Home Assistant event (legacy compatibility)
   */
  publish(event: HassEventImpl): void {
    this.logger.debug('📍 EventBus.publish() ENTRY');
    this.logger.debug('📤 Publishing event', {
      type: event.eventType,
      origin: event.origin,
      listeners: this.listenerCount(event.eventType),
    });

    this.emit(event.eventType, event);
    this.logger.debug('📍 EventBus.publish() EXIT');
  }

  /**
   * Subscribe to events with type safety (new generic method)
   */
  subscribeToEvent<T extends BaseEvent>(
    eventType: string,
    handler: (event: T) => Promise<void> | void,
  ): () => void {
    this.logger.debug('📍 EventBus.subscribeToEvent() ENTRY');
    const wrappedHandler = async (event: T) => {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(`❌ Event handler error: ${eventType}`, { error });
      }
    };

    this.on(eventType, wrappedHandler);

    this.logger.debug(`📡 Subscribed to ${eventType}`, {
      listeners: this.listenerCount(eventType),
    });

    // Return unsubscribe function
    this.logger.debug('📍 EventBus.subscribeToEvent() EXIT');
    return () => this.off(eventType, wrappedHandler);
  }

  /**
   * Subscribe to Home Assistant events (legacy compatibility)
   */
  subscribe(
    eventType: string,
    handler: (event: HassEventImpl) => Promise<void> | void,
  ): void {
    this.logger.debug('📍 EventBus.subscribe() ENTRY');
    const wrappedHandler = async (event: HassEventImpl) => {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error('❌ Event handler error', error, {
          eventType: event.eventType,
          origin: event.origin,
        });
      }
    };

    this.on(eventType, wrappedHandler);

    this.logger.debug('📡 Subscription added', {
      eventType,
      listeners: this.listenerCount(eventType),
    });
    this.logger.debug('📍 EventBus.subscribe() EXIT');
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.logger.debug('📍 EventBus.clear() ENTRY');
    const count = this.eventNames().reduce(
      (sum, name) => sum + this.listenerCount(name as string),
      0,
    );
    this.removeAllListeners();
    this.logger.info('🧹 Cleared all subscriptions', { count });
    this.logger.debug('📍 EventBus.clear() EXIT');
  }
}

/**
 * Global event bus instance
 */
export const eventBus = new EventBus();
