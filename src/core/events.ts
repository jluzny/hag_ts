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
    super('hass.state_changed', payload);
  }

  get entityId(): string {
    return (this.payload as HassStateChangedPayload).entityId;
  }

  get oldState(): unknown {
    return (this.payload as HassStateChangedPayload).oldState;
  }

  get newState(): unknown {
    return (this.payload as HassStateChangedPayload).newState;
  }
}

/**
 * Fired when the application is preparing to shut down.
 */
export class SystemShutdownEvent extends AppEvent {
  constructor(payload: SystemShutdownPayload) {
    super('system.shutdown', payload);
  }

  get reason(): string {
    return (this.payload as SystemShutdownPayload).reason;
  }
}

/**
 * Fired when HVAC mode changes
 */
export class HvacModeChangedEvent extends AppEvent {
  constructor(payload: HvacModeChangedPayload) {
    super('hvac.mode_changed', payload);
  }

  get mode(): string {
    return (this.payload as HvacModeChangedPayload).mode;
  }

  get previousMode(): string {
    return (this.payload as HvacModeChangedPayload).previousMode;
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
    return new HassStateChangedEvent({ entityId, oldState, newState });
  }

  static systemShutdown(reason: string): SystemShutdownEvent {
    return new SystemShutdownEvent({ reason });
  }

  static hvacModeChanged(
    mode: string,
    previousMode: string,
    targetTemp: number,
    currentTemp: number,
  ): HvacModeChangedEvent {
    return new HvacModeChangedEvent({
      mode,
      previousMode,
      targetTemp,
      currentTemp,
    });
  }
}
