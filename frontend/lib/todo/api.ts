// Backend calls used by the to-do module.
import { api } from "@/lib/api";
import { dayOf } from "@/lib/timeline/dates";
import type { DaysFeed, PlanChange, Proposal, Routine, RoutineInput, Stats, Task, TaskInput } from "./types";

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** The user's local date (YYYY-MM-DD): "today" follows their time zone, not the server's. */
export const localToday = () => dayOf(new Date());

export const todoApi = {
  days: () => api<DaysFeed>(`/todo/days?today=${localToday()}`),
  createTask: (input: Partial<TaskInput> & { title: string }) => api<Task>("/todo/tasks", json("POST", input)),
  updateTask: (id: string, input: Partial<TaskInput> & { position?: number }) =>
    api<Task>(`/todo/tasks/${id}`, json("PATCH", input)),
  completeTask: (id: string) => api<Task>(`/todo/tasks/${id}/complete`, json("POST", { today: localToday() })),
  reopenTask: (id: string) => api<Task>(`/todo/tasks/${id}/reopen`, { method: "POST" }),
  deleteTask: (id: string) => api<void>(`/todo/tasks/${id}`, { method: "DELETE" }),

  /** Asks Claude for a plan of the next `days` days; changes nothing. */
  plan: (days = 7) => api<Proposal>("/todo/plan", json("POST", { today: localToday(), days })),
  applyPlan: (changes: PlanChange[]) =>
    api<{ applied: number }>(
      "/todo/plan/apply",
      json("POST", {
        today: localToday(),
        changes: changes.map((c) => ({ task_id: c.task_id, to_date: c.to_date, order: c.order })),
      }),
    ),

  stats: (days = 30) => api<Stats>(`/todo/stats?today=${localToday()}&days=${days}`),

  routines: () => api<Routine[]>("/todo/routines"),
  createRoutine: (input: RoutineInput) => api<Routine>("/todo/routines", json("POST", input)),
  updateRoutine: (id: string, input: Partial<RoutineInput> & { active?: boolean }) =>
    api<Routine>(`/todo/routines/${id}?today=${localToday()}`, json("PATCH", input)),
  deleteRoutine: (id: string) => api<void>(`/todo/routines/${id}?today=${localToday()}`, { method: "DELETE" }),
};
