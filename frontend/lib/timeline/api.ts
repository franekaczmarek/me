// Backend calls used by the timeline module.
import { api } from "@/lib/api";
import type { Category, EventInput, Media, Profile, TimelineEvent } from "./types";

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

  listMedia: (eventId: string) => api<Media[]>(`/timeline/events/${eventId}/media`),
  uploadMedia: (eventId: string, file: File, caption = "") => {
    const body = new FormData();
    body.append("file", file);
    body.append("caption", caption);
    return api<Media>(`/timeline/events/${eventId}/media`, { method: "POST", body });
  },
  updateMedia: (id: string, input: Partial<Pick<Media, "caption" | "position">>) =>
    api<Media>(`/timeline/media/${id}`, json("PATCH", input)),
  deleteMedia: (id: string) => api<void>(`/timeline/media/${id}`, { method: "DELETE" }),
};

export const profileApi = {
  get: () => api<Profile>("/profile"),
  update: (input: Partial<Profile>) => api<Profile>("/profile", json("PATCH", input)),
};
