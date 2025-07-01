/**
 * Simple event-driven pub/sub system following Rust HAG actor pattern
 *
 * Only handles Home Assistant state_changed events.
 * All sensor-specific logic is handled by subscribers.
 */

import { EventEmitter } from 'node:events';
import { LoggerService } from './logger.ts';
import { HassEventImpl } from '../home-assistant/models.ts';

/**
 * Simple EventBus for Home Assistant events only
 */
export class EventBus extends EventEmitter {
  private logger = new LoggerService('HAG.event-bus');

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Publish a Home Assistant event
   */
  publish(event: HassEventImpl): void {
    this.logger.debug('📤 Publishing event', {
      type: event.eventType,
      origin: event.origin,
      listeners: this.listenerCount(event.eventType),
    });

    this.emit(event.eventType, event);
  }

  /**
   * Subscribe to Home Assistant events
   */
  subscribe(
    eventType: string,
    handler: (event: HassEventImpl) => Promise<void> | void,
  ): void {
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
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    const count = this.eventNames().reduce(
      (sum, name) => sum + this.listenerCount(name as string),
      0,
    );
    this.removeAllListeners();
    this.logger.info('🧹 Cleared all subscriptions', { count });
  }
}

/**
 * Global event bus instance
 */
export const eventBus = new EventBus();
