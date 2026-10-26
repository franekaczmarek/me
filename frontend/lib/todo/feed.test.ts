import { describe, expect, it } from "vitest";
import { withMove, withStatus } from "./feed";
import type { Day, DaysFeed, Task } from "./types";

const task = (id: string, planned_date: string | null): Task => ({
  id,
  title: id,
  notes: "",
  planned_date,
  deadline: null,
  duration_min: null,
  priority: "normal",
  fixed_day: false,
  status: "open",
  completed_at: null,
  first_planned_date: planned_date,
  postponed_count: 0,
  routine_id: null,
  occurrence_date: null,
  position: 0,
  created_at: "",
});
const day = (date: string, tasks: Task[]): Day => ({
  date,
  is_today: false,
  is_overdue: false,
  is_work_day: true,
  capacity_min: 0,
  planned_min: 0,
  event_min: 0,
  events: [],
  tasks,
});
const feed: DaysFeed = {
  today: "2026-03-04",
  days: [day("2026-03-04", [task("a", "2026-03-04"), task("b", "2026-03-04")]), day("2026-03-05", [])],
  inbox: [task("c", null)],
};
const ids = (f: DaysFeed) => ({ days: f.days.map((d) => d.tasks.map((t) => t.id)), inbox: f.inbox.map((t) => t.id) });

describe("withStatus", () => {
  it("changes only the given task, on a day or in the inbox", () => {
    const done = withStatus(withStatus(feed, "b", "done", "now"), "c", "done", "now");
    expect(done.days[0].tasks.map((t) => t.status)).toEqual(["open", "done"]);
    expect(done.days[0].tasks[1].completed_at).toBe("now");
    expect(done.inbox[0].status).toBe("done");
    expect(feed.days[0].tasks[1].status).toBe("open"); // not mutated
  });

  it("reopens and ignores unknown ids", () => {
    const done = withStatus(feed, "a", "done", "now");
    expect(withStatus(done, "a", "open", null).days[0].tasks[0]).toEqual(feed.days[0].tasks[0]);
    expect(withStatus(feed, "nope", "done", "now")).toEqual(feed);
  });
});

describe("withMove", () => {
  it("moves a task to the end of another day and updates its date", () => {
    const moved = withMove(feed, "a", "2026-03-05");
    expect(ids(moved)).toEqual({ days: [["b"], ["a"]], inbox: ["c"] });
    expect(moved.days[1].tasks[0].planned_date).toBe("2026-03-05");
  });

  it("moves to and from the inbox", () => {
    expect(ids(withMove(feed, "a", null))).toEqual({ days: [["b"], []], inbox: ["c", "a"] });
    expect(ids(withMove(feed, "c", "2026-03-04"))).toEqual({ days: [["a", "b", "c"], []], inbox: [] });
  });

  it("can be undone", () => {
    expect(ids(withMove(withMove(feed, "a", null), "a", "2026-03-04"))).toEqual({ days: [["b", "a"], []], inbox: ["c"] });
  });

  it("leaves the feed alone when the day isn't shown or the task is unknown", () => {
    expect(withMove(feed, "a", "2026-04-01")).toBe(feed);
    expect(withMove(feed, "nope", null)).toBe(feed);
  });
});
