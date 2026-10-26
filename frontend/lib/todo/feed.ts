// Local edits of the days feed, shown right away while the server catches up (then the feed is reloaded).
import type { DaysFeed, Task } from "./types";

const mapTasks = (feed: DaysFeed, fn: (tasks: Task[]) => Task[]): DaysFeed => ({
  ...feed,
  days: feed.days.map((day) => ({ ...day, tasks: fn(day.tasks) })),
  inbox: fn(feed.inbox),
});

/** The feed with one task's status (and completion time) changed. */
export function withStatus(feed: DaysFeed, id: string, status: Task["status"], completedAt: string | null): DaysFeed {
  return mapTasks(feed, (tasks) =>
    tasks.map((t) => (t.id === id ? { ...t, status, completed_at: completedAt } : t)),
  );
}

/**
 * The feed with a task moved to the end of another day (null = the inbox).
 * Unchanged when the task or the target day isn't shown, so the move can always be undone.
 */
export function withMove(feed: DaysFeed, id: string, plannedDate: string | null): DaysFeed {
  const task = [...feed.inbox, ...feed.days.flatMap((d) => d.tasks)].find((t) => t.id === id);
  if (!task || (plannedDate !== null && !feed.days.some((d) => d.date === plannedDate))) return feed;
  const moved = { ...task, planned_date: plannedDate };
  const without = mapTasks(feed, (tasks) => tasks.filter((t) => t.id !== id));
  return plannedDate === null
    ? { ...without, inbox: [...without.inbox, moved] }
    : { ...without, days: without.days.map((d) => (d.date === plannedDate ? { ...d, tasks: [...d.tasks, moved] } : d)) };
}
