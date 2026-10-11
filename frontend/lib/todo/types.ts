// Shapes returned by the backend to-do API.

export type Priority = "low" | "normal" | "high";
export type TaskStatus = "open" | "done" | "missed";

export type Task = {
  id: string;
  title: string;
  notes: string;
  /** YYYY-MM-DD; null = in the inbox. */
  planned_date: string | null;
  deadline: string | null;
  duration_min: number | null;
  priority: Priority;
  /** Must happen on its day; the planner won't move it. */
  fixed_day: boolean;
  status: TaskStatus;
  completed_at: string | null;
  first_planned_date: string | null;
  postponed_count: number;
  routine_id: string | null;
  occurrence_date: string | null;
  position: number;
  created_at: string;
  /** Created for this calendar event occurrence. */
  source_event_id?: string | null;
  source_occurrence_date?: string | null;
};

/** A calendar event shown on a day of the to-do list. */
export type EventChip = {
  id: string;
  title: string;
  color: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
};

export type Day = {
  date: string;
  is_today: boolean;
  /** A past day that still has undone tasks. */
  is_overdue: boolean;
  is_work_day: boolean;
  capacity_min: number;
  planned_min: number;
  /** Task time taken by calendar events (outside work hours on a work day). */
  event_min: number;
  events: EventChip[];
  tasks: Task[];
};

export type DaysFeed = { today: string; days: Day[]; inbox: Task[] };

export type TaskInput = Pick<
  Task,
  "title" | "notes" | "planned_date" | "deadline" | "duration_min" | "priority" | "fixed_day"
>;

export type DayStats = { date: string; on_time: number; late: number; missed: number };

export type Stats = {
  days: number;
  done: number;
  on_time: number;
  late: number;
  overdue: number;
  missed: number;
  on_time_rate: number | null;
  avg_postponed: number | null;
  streak: number;
  last_week: DayStats[];
};

export type RoutineKind = "daily" | "weekdays" | "weekly" | "interval" | "monthly";

export type Routine = {
  id: string;
  title: string;
  notes: string;
  kind: RoutineKind;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[] | null;
  interval_days: number | null;
  month_day: number | null;
  duration_min: number | null;
  priority: Priority;
  active: boolean;
  starts_on: string;
  created_at: string;
};

export type RoutineInput = Pick<Routine, "title" | "kind" | "weekdays" | "interval_days" | "month_day" | "duration_min" | "priority">;

export type PlanChange = {
  task_id: string;
  title: string;
  from_date: string | null;
  to_date: string | null;
  order: number;
  duration_min: number | null;
  reason: string;
};

export type Proposal = {
  summary: string;
  changes: PlanChange[];
  warnings: string[];
  days: { date: string; capacity_min: number; planned_min: number }[];
};

/** A task as Claude read it from free text; not saved until the user adds it. */
export type Draft = Pick<TaskInput, "title" | "planned_date" | "deadline" | "duration_min" | "priority" | "fixed_day" | "notes"> & {
  /** Claude guessed the duration (shown as "~1h"). */
  duration_estimated: boolean;
};

export type ParseResult = { tasks: Draft[]; warnings: string[] };
