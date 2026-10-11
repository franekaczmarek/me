// Backend calls for the calendar: events, side-card summary, work schedule and days off.
import { api } from "@/lib/api";
import type { CalendarEvent, EventInput, EventParseResult, Occurrence, Suggestion, SuggestResult, Summary } from "./types";

export type WorkSchedule = {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  work_days: number[];
  /** "HH:MM:SS" */
  work_start: string;
  work_end: string;
  task_minutes_workday: number;
  task_minutes_day_off: number;
};

export type DayOff = { id: string; start_date: string; end_date: string; label: string };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const calendarApi = {
  schedule: () => api<WorkSchedule>("/calendar/work-schedule"),
  saveSchedule: (schedule: WorkSchedule) => api<WorkSchedule>("/calendar/work-schedule", json("PUT", schedule)),
  daysOff: () => api<DayOff[]>("/calendar/days-off"),
  addDayOff: (input: Omit<DayOff, "id">) => api<DayOff>("/calendar/days-off", json("POST", input)),
  deleteDayOff: (id: string) => api<void>(`/calendar/days-off/${id}`, { method: "DELETE" }),

  occurrences: (start: string, end: string) => api<Occurrence[]>(`/calendar/events?start=${start}&end=${end}`),
  event: (id: string) => api<CalendarEvent>(`/calendar/events/${id}`),
  createEvent: (input: EventInput) => api<CalendarEvent>("/calendar/events", json("POST", input)),
  saveEvent: (id: string, input: EventInput) => api<CalendarEvent>(`/calendar/events/${id}`, json("PUT", input)),
  deleteEvent: (id: string) => api<void>(`/calendar/events/${id}`, { method: "DELETE" }),
  summary: (month: string, today: string) => api<Summary>(`/calendar/summary?month=${month}&today=${today}`),

  /** Claude reads a note into event drafts for a preview; saves nothing. */
  parse: (text: string, today: string) => api<EventParseResult>("/calendar/parse", json("POST", { text, today })),

  /** Claude proposes tasks for the events of the next 30 days; saves nothing. */
  suggest: (today: string) => api<SuggestResult>("/calendar/suggest", json("POST", { today })),
  /** Creates the accepted tasks (`title`/`planned_date` as edited) and remembers dismissed suggestions. */
  applySuggestions: (today: string, accepted: { suggestion: Suggestion; title: string; planned_date: string }[], dismissed: Suggestion[]) =>
    api<{ created: number; dismissed: number }>(
      "/calendar/suggest/apply",
      json("POST", {
        today,
        accepted: accepted.map(({ suggestion: s, title, planned_date }) => ({
          event_id: s.event_id,
          occurrence_date: s.occurrence_date,
          suggested_title: s.title,
          title,
          planned_date,
          deadline: s.deadline,
          duration_min: s.duration_min,
          priority: s.priority,
          fixed_day: s.fixed_day && planned_date === s.occurrence_date,
        })),
        dismissed: dismissed.map((s) => ({ event_id: s.event_id, occurrence_date: s.occurrence_date, suggested_title: s.title })),
      }),
    ),
};
