// Backend calls used by the timeline module.
import { api } from "@/lib/api";
import type { Category, EventInput, Profile, TimelineEvent } from "./types";

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const timelineApi = {
  listEvents: () => api<TimelineEvent[]>("/timeline/events"),
  createEvent: (input: EventInput) => api<TimelineEvent>("/timeline/events", json("POST", input)),
  updateEvent: (id: string, input: Partial<EventInput>) =>
    api<TimelineEvent>(`/timeline/events/${id}`, json("PATCH", input)),
  deleteEvent: (id: string) => api<void>(`/timeline/events/${id}`, { method: "DELETE" }),

  listCategories: () => api<Category[]>("/timeline/categories"),
  createCategory: (input: Omit<Category, "id">) => api<Category>("/timeline/categories", json("POST", input)),
  updateCategory: (id: string, input: Partial<Omit<Category, "id">>) =>
    api<Category>(`/timeline/categories/${id}`, json("PATCH", input)),
  deleteCategory: (id: string) => api<void>(`/timeline/categories/${id}`, { method: "DELETE" }),
};

export const profileApi = {
  get: () => api<Profile>("/profile"),
  update: (input: Partial<Profile>) => api<Profile>("/profile", json("PATCH", input)),
};
