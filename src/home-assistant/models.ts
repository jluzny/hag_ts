/**
 * Home Assistant data models for HAG JavaScript variant.
 *
 * Type-safe models for Home Assistant WebSocket and REST API interactions.
 */

import {
  HassEvent,
  HassServiceCall,
  HassState,
  HassStateChangeData,
  WebSocketMessage,
} from '../types/common.ts';
import { ValidationError } from '../core/exceptions.ts';

/**
 * Home Assistant authentication response
 */
export interface HassAuthResponse {
  type: 'auth_ok' | 'auth_invalid' | 'auth_required';
  message?: string;
  haVersion?: string;
}

/**
 * Home Assistant WebSocket command types
 */
export enum HassCommandType {
  AUTH = 'auth',
  SUBSCRIBE_EVENTS = 'subscribe_events',
  UNSUBSCRIBE_EVENTS = 'unsubscribe_events',
  GET_STATES = 'get_states',
  GET_STATE = 'get_state',
  CALL_SERVICE = 'call_service',
  PING = 'ping',
  PONG = 'pong',
}

/**
 * Enhanced WebSocket message with HAG-specific properties
 */
export interface HagWebSocketMessage extends WebSocketMessage {
  success?: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Home Assistant state implementation
 */
export class HassStateImpl implements HassState {
  constructor(
    public readonly entityId: string,
    public readonly state: string,
    public readonly attributes: Record<string, unknown>,
    public readonly lastChanged: Date,
    public readonly lastUpdated: Date,
  ) {}

  /**
   * Get numeric state value if possible
   */
  getNumericState(): number | null {
    const numericValue = parseFloat(this.state);
    return isNaN(numericValue) ? null : numericValue;
  }

  /**
   * Check if state represents a valid numeric temperature
   */
  isValidTemperature(): boolean {
    const temp = this.getNumericState();
    return temp !== null && temp >= -50 && temp <= 60;
  }

  /**
   * Get unit of measurement from attributes
   */
  getUnit(): string | null {
    return this.attributes.unit_of_measurement as string || null;
  }

  /**
   * Create from Home Assistant API response
   */
  static fromApiResponse(data: Record<string, unknown>): HassStateImpl {
    if (!data.entity_id || typeof data.entity_id !== 'string') {
      throw new ValidationError(
        'Invalid entity_id in state data',
        'entity_id',
        'string',
        data.entity_id,
      );
    }

    if (!data.state || typeof data.state !== 'string') {
      throw new ValidationError(
        'Invalid state in state data',
        'state',
        'string',
        data.state,
      );
    }

    const lastChanged = data.last_changed
      ? new Date(data.last_changed as string)
      : new Date();
    const lastUpdated = data.last_updated
      ? new Date(data.last_updated as string)
      : new Date();
    const attributes = data.attributes as Record<string, unknown> || {};

    return new HassStateImpl(
      data.entity_id,
      data.state,
      attributes,
      lastChanged,
      lastUpdated,
    );
  }
}

/**
 * Home Assistant event implementation
 */
export class HassEventImpl implements HassEvent {
  constructor(
    public readonly eventType: string,
    public readonly data: Record<string, unknown>,
    public readonly origin: string,
    public readonly timeFired: Date,
  ) {}

  /**
   * Check if this is a state change event
   */
  isStateChanged(): boolean {
    return this.eventType === 'state_changed';
  }

  /**
   * Get state change data if this is a state change event
   */
  getStateChangeData(): HassStateChangeData | null {
    if (!this.isStateChanged()) {
      return null;
    }

    const entityId = this.data.entity_id as string;
    if (!entityId) {
      return null;
    }

    const newState = this.data.new_state
      ? HassStateImpl.fromApiResponse(
        this.data.new_state as Record<string, unknown>,
      )
      : null;

    const oldState = this.data.old_state
      ? HassStateImpl.fromApiResponse(
        this.data.old_state as Record<string, unknown>,
      )
      : null;

    return {
      entityId,
      newState,
      oldState,
    };
  }

  /**
   * Create from Home Assistant WebSocket event
   */
  static fromWebSocketEvent(data: Record<string, unknown>): HassEventImpl {
    const event = data.event as Record<string, unknown>;
    if (!event) {
      throw new ValidationError('Invalid event data', 'event', 'object', data);
    }

    const eventType = event.event_type as string;
    if (!eventType) {
      throw new ValidationError(
        'Invalid event_type',
        'event_type',
        'string',
        event.event_type,
      );
    }

    const eventData = event.data as Record<string, unknown> || {};
    const origin = event.origin as string || 'LOCAL';
    const timeFired = event.time_fired
      ? new Date(event.time_fired as string)
      : new Date();

    return new HassEventImpl(eventType, eventData, origin, timeFired);
  }
}

/**
 * Home Assistant service call implementation
 */
export class HassServiceCallImpl implements HassServiceCall {
  constructor(
    public readonly domain: string,
    public readonly service: string,
    public readonly serviceData: Record<string, unknown>,
    public readonly target?: {
      entityId?: string | string[];
      deviceId?: string | string[];
      areaId?: string | string[];
    },
  ) {}

  /**
   * Convert to WebSocket message format
   */
  toWebSocketMessage(id: number): HagWebSocketMessage {
    const message: HagWebSocketMessage = {
      id,
      type: HassCommandType.CALL_SERVICE,
      domain: this.domain,
      service: this.service,
      service_data: this.serviceData,
    };

    if (this.target) {
      message.target = {
        entity_id: this.target.entityId,
        device_id: this.target.deviceId,
        area_id: this.target.areaId,
      };
    }

    return message;
  }

  /**
   * Create climate service call
   */
  static climate(
    service: 'set_hvac_mode' | 'set_temperature' | 'set_preset_mode',
    entityId: string,
    data: Record<string, unknown>,
  ): HassServiceCallImpl {
    return new HassServiceCallImpl(
      'climate',
      service,
      { entity_id: entityId, ...data },
    );
  }

  /**
   * Create homeassistant service call
   */
  static homeassistant(
    service: 'update_entity' | 'reload_config_entry',
    entityId?: string,
  ): HassServiceCallImpl {
    const serviceData = entityId ? { entity_id: entityId } : {};
    return new HassServiceCallImpl('homeassistant', service, serviceData);
  }
}

/**
 * WebSocket connection state
 */
export enum WebSocketState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  AUTHENTICATING = 'authenticating',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * Connection statistics
 */
export interface ConnectionStats {
  totalConnections: number;
  totalReconnections: number;
  totalMessages: number;
  totalErrors: number;
  lastConnected?: Date;
  lastError?: Date;
  averageLatency?: number;
}

/**
 * Utility functions for Home Assistant data
 */
export const HassUtils = {
  /**
   * Check if entity ID is valid format
   */
  isValidEntityId: (entityId: string): boolean => {
    const parts = entityId.split('.');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  },

  /**
   * Extract domain from entity ID
   */
  getDomain: (entityId: string): string => {
    return entityId.split('.')[0] || '';
  },

  /**
   * Extract entity name from entity ID
   */
  getEntityName: (entityId: string): string => {
    return entityId.split('.')[1] || '';
  },

  /**
   * Check if entity is a sensor
   */
  isSensor: (entityId: string): boolean => {
    return HassUtils.getDomain(entityId) === 'sensor';
  },

  /**
   * Check if entity is a climate device
   */
  isClimate: (entityId: string): boolean => {
    return HassUtils.getDomain(entityId) === 'climate';
  },

  /**
   * Parse Home Assistant timestamp
   */
  parseTimestamp: (timestamp: string | Date): Date => {
    if (timestamp instanceof Date) {
      return timestamp;
    }
    return new Date(timestamp);
  },
} as const;
