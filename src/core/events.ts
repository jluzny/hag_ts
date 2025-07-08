/**
 * Defines the standardized, type-safe event structure for the application.
 * All events should extend the base `AppEvent` class.
 */

import { AppEvent } from './event-system.ts';

export { AppEvent };

// Type definitions for event payloads
interface HassStateChangedPayload {
  entityId: string;
  oldState: unknown;
  newState: unknown;
}

interface SystemShutdownPayload {
  reason: string;
}

interface HvacModeChangedPayload {
  mode: string;
  previousMode: string;
  targetTemp: number;
  currentTemp: number;
}

/**
 * Fired when a Home Assistant entity changes its state.
 */
export class HassStateChangedEvent extends AppEvent {
  constructor(payload: HassStateChangedPayload) {
    // Note: Using console.log here since we don't have logger instance
    // console.log('📍 HassStateChangedEvent.constructor() ENTRY');
    super('hass.state_changed', payload);
    // console.log('📍 HassStateChangedEvent.constructor() EXIT');
  }

  get entityId(): string {
    // console.log('📍 HassStateChangedEvent.entityId() ENTRY');
    const result = (this.payload as HassStateChangedPayload).entityId;
    // console.log('📍 HassStateChangedEvent.entityId() EXIT');
    return result;
  }

  get oldState(): unknown {
    // console.log('📍 HassStateChangedEvent.oldState() ENTRY');
    const result = (this.payload as HassStateChangedPayload).oldState;
    // console.log('📍 HassStateChangedEvent.oldState() EXIT');
    return result;
  }

  get newState(): unknown {
    // console.log('📍 HassStateChangedEvent.newState() ENTRY');
    const result = (this.payload as HassStateChangedPayload).newState;
    // console.log('📍 HassStateChangedEvent.newState() EXIT');
    return result;
  }
}

/**
 * Fired when the application is preparing to shut down.
 */
export class SystemShutdownEvent extends AppEvent {
  constructor(payload: SystemShutdownPayload) {
    // console.log('📍 SystemShutdownEvent.constructor() ENTRY');
    super('system.shutdown', payload);
    // console.log('📍 SystemShutdownEvent.constructor() EXIT');
  }

  get reason(): string {
    // console.log('📍 SystemShutdownEvent.reason() ENTRY');
    const result = (this.payload as SystemShutdownPayload).reason;
    // console.log('📍 SystemShutdownEvent.reason() EXIT');
    return result;
  }
}

/**
 * Fired when HVAC mode changes
 */
export class HvacModeChangedEvent extends AppEvent {
  constructor(payload: HvacModeChangedPayload) {
    // console.log('📍 HvacModeChangedEvent.constructor() ENTRY');
    super('hvac.mode_changed', payload);
    // console.log('📍 HvacModeChangedEvent.constructor() EXIT');
  }

  get mode(): string {
    // console.log('📍 HvacModeChangedEvent.mode() ENTRY');
    const result = (this.payload as HvacModeChangedPayload).mode;
    // console.log('📍 HvacModeChangedEvent.mode() EXIT');
    return result;
  }

  get previousMode(): string {
    // console.log('📍 HvacModeChangedEvent.previousMode() ENTRY');
    const result = (this.payload as HvacModeChangedPayload).previousMode;
    // console.log('📍 HvacModeChangedEvent.previousMode() EXIT');
    return result;
  }
}

/**
 * Event builders for common patterns
 */
export class EventBuilder {
  static hassStateChanged(
    entityId: string,
    oldState: unknown,
    newState: unknown,
  ): HassStateChangedEvent {
    // console.log('📍 EventBuilder.hassStateChanged() ENTRY');
    const result = new HassStateChangedEvent({ entityId, oldState, newState });
    // console.log('📍 EventBuilder.hassStateChanged() EXIT');
    return result;
  }

  static systemShutdown(reason: string): SystemShutdownEvent {
    // console.log('📍 EventBuilder.systemShutdown() ENTRY');
    const result = new SystemShutdownEvent({ reason });
    // console.log('📍 EventBuilder.systemShutdown() EXIT');
    return result;
  }

  static hvacModeChanged(
    mode: string,
    previousMode: string,
    targetTemp: number,
    currentTemp: number,
  ): HvacModeChangedEvent {
    // console.log('📍 EventBuilder.hvacModeChanged() ENTRY');
    const result = new HvacModeChangedEvent({
      mode,
      previousMode,
      targetTemp,
      currentTemp,
    });
    // console.log('📍 EventBuilder.hvacModeChanged() EXIT');
    return result;
  }
}
