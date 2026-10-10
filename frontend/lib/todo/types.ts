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
};

export type Day = {
  date: string;
  is_today: boolean;
  /** A past day that still has undone tasks. */
  is_overdue: boolean;
  is_work_day: boolean;
  capacity_min: number;
  planned_min: number;
  tasks: Task[];
};

export type DaysFeed = { today: string; days: Day[]; inbox: Task[] };

export type TaskInput = Pick<
  Task,
  "title" | "notes" | "planned_date" | "deadline" | "duration_min" | "priority" | "fixed_day"
>;
