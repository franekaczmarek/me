// Helpers for calendar events (pure).
import type { CalendarEvent, EventInput } from "./types";

/** The editable fields of an event (to save it back with some of them changed). */
export function toInput(event: CalendarEvent): EventInput {
  const { id, timeline_event_id, ...input } = event;
  void id;
  void timeline_event_id;
  return input;
}
