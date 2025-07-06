/**
 * This module is responsible for converting raw Home Assistant events
 * into strongly-typed `AppEvent` classes.
 */

import { HassEventImpl } from './models.ts';
import { AppEvent, HassStateChangedEvent } from '../core/events.ts';

/**
 * Creates a strongly-typed `AppEvent` from a raw Home Assistant event.
 *
 * @param rawEvent The raw event object from the Home Assistant WebSocket.
 * @returns An `AppEvent` instance or `null` if the event type is not supported.
 */
export function createHassEvent(
  rawEvent: HassEventImpl,
): AppEvent | null {
  switch (rawEvent.eventType) {
    case 'state_changed':
      // Ensure the data payload exists and has the expected properties.
      if (rawEvent.data && 'entity_id' in rawEvent.data) {
        return new HassStateChangedEvent({
          entityId: rawEvent.data.entity_id as string,
          oldState: rawEvent.data.old_state,
          newState: rawEvent.data.new_state,
        });
      }
      break;

    // Add cases for other Home Assistant event types here.
    // For example:
    // case 'call_service':
    //   if (rawEvent.data && 'service' in rawEvent.data) {
    //     return new HassCallServiceEvent({ ... });
    //   }
    //   break;

    default:
      // If the event type is not recognized, return null.
      return null;
  }

  // Return null if the data payload is missing or invalid.
  return null;
}
