// Backend calls used by the to-do module.
import { api } from "@/lib/api";
import { dayOf } from "@/lib/timeline/dates";
import type { DaysFeed, Task, TaskInput } from "./types";

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
};
