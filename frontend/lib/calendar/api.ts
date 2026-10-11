// Backend calls for the calendar: events, side-card summary, work schedule and days off.
import { api } from "@/lib/api";
import type { CalendarEvent, EventInput, Occurrence, Summary } from "./types";

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
};
