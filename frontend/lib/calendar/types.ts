// Calendar data as the backend returns it. Dates are "YYYY-MM-DD", times "HH:MM:SS" (local wall-clock).

export type Recurrence = "none" | "weekly" | "monthly" | "yearly";

export type EventInput = {
  title: string;
  notes: string;
  location: string;
  start_date: string;
  /** Inclusive. */
  end_date: string;
  /** Both null = all-day. */
  start_time: string | null;
  end_time: string | null;
  color: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  add_to_timeline: boolean;
};

export type CalendarEvent = EventInput & { id: string; timeline_event_id: string | null };

/** One occurrence of an event: start_date/end_date are this occurrence's dates; `id` is the event's. */
export type Occurrence = CalendarEvent & { all_day: boolean; occurrence_date: string };

export type MonthSummary = {
  month: string;
  events: number;
  event_minutes: number;
  busiest_day: string | null;
  busiest_day_events: number;
  days_off: number;
  tasks_done: number;
  tasks_open: number;
  tasks_overdue: number;
};

export type Upcoming = {
  id: string;
  title: string;
  color: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  all_day: boolean;
  occurrence_date: string;
  days_until: number;
  has_task: boolean;
};

export type Summary = { month: MonthSummary; upcoming: Upcoming[] };
