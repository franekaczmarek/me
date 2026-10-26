import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Day, DaysFeed, Task } from "@/lib/todo/types";
import { TodoModule } from "./TodoModule";

const todoApi = vi.hoisted(() => ({
  days: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  stats: vi.fn(),
  routines: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("@/lib/todo/api", () => ({ todoApi, localToday: () => "2026-03-04" }));
const calendarApi = vi.hoisted(() => ({ suggest: vi.fn(), applySuggestions: vi.fn() }));
vi.mock("@/lib/calendar/api", () => ({ calendarApi }));

const TODAY = "2026-03-04";
const task = (fields: Partial<Task>): Task => ({
  id: "t",
  title: "Task",
  notes: "",
  planned_date: TODAY,
  deadline: null,
  duration_min: null,
  priority: "normal",
  fixed_day: false,
  status: "open",
  completed_at: null,
  first_planned_date: TODAY,
  postponed_count: 0,
  routine_id: null,
  occurrence_date: null,
  position: 0,
  created_at: "",
  ...fields,
});
const day = (date: string, fields: Partial<Day> = {}): Day => ({
  date,
  is_today: date === TODAY,
  is_overdue: date < TODAY,
  is_work_day: true,
  capacity_min: 180,
  planned_min: 0,
  event_min: 0,
  events: [],
  tasks: [],
  ...fields,
});
const feed: DaysFeed = {
  today: TODAY,
  days: [
    day("2026-03-02", { tasks: [task({ id: "late", title: "Call the bank", planned_date: "2026-03-02" })] }),
    day(TODAY, {
      planned_min: 240,
      tasks: [
        task({ id: "report", title: "Finish the report", duration_min: 240, deadline: "2026-03-05" }),
        task({ id: "done", title: "Reply to Anna", status: "done", completed_at: "x" }),
      ],
    }),
    day("2026-03-05"),
  ],
  inbox: [task({ id: "inbox", title: "Renew passport", planned_date: null })],
};

const card = (name: RegExp) => screen.getByRole("region", { name });

beforeEach(() => {
  todoApi.days.mockResolvedValue(feed);
  todoApi.routines.mockResolvedValue([]);
  todoApi.stats.mockResolvedValue({
    days: 30, done: 0, on_time: 0, late: 0, overdue: 0, missed: 0,
    on_time_rate: null, avg_postponed: null, streak: 0, last_week: [],
  });
  for (const fn of [todoApi.createTask, todoApi.updateTask, todoApi.completeTask, todoApi.reopenTask, todoApi.deleteTask]) {
    fn.mockResolvedValue(undefined);
  }
});

describe("TodoModule", () => {
  it("shows overdue days, today with its load, the coming days and the inbox", async () => {
    render(<TodoModule />);
    const today = await screen.findByRole("region", { name: /^Today/ });
    expect(within(today).getByText("Finish the report")).toBeInTheDocument();
    expect(within(today).getByText("1/2 done")).toBeInTheDocument();
    expect(within(today).getByText("4h of 3h")).toHaveClass("font-semibold"); // overloaded
    expect(within(today).getByText("due tomorrow")).toBeInTheDocument();

    const overdue = card(/^Monday/);
    expect(within(overdue).getByText("Not done")).toBeInTheDocument();
    expect(within(overdue).getByText("Call the bank")).toBeInTheDocument();
    expect(card(/^Tomorrow/)).toBeInTheDocument();
    expect(within(card(/Inbox/)).getByText("Renew passport")).toBeInTheDocument();
  });

  it("shows calendar events on their day, counts their time and marks where tasks came from", async () => {
    todoApi.days.mockResolvedValue({
      ...feed,
      days: [
        day(TODAY, {
          planned_min: 60,
          event_min: 120,
          events: [{ id: "e1", title: "Dinner", color: "#9b87f5", start_time: "18:00:00", end_time: "20:00:00", all_day: false }],
          tasks: [
            task({ id: "wine", title: "Buy wine", source_event_id: "e1", source_occurrence_date: TODAY }),
            task({ id: "pay", title: "Pay the invoice", source_mail_id: "m1" }),
          ],
        }),
      ],
    });
    render(<TodoModule />);
    const today = await screen.findByRole("region", { name: /^Today/ });
    const events = within(today).getByRole("list", { name: "Events" });
    expect(within(events).getByRole("link", { name: "Dinner, 18:00" })).toHaveAttribute("href", "/calendar");
    expect(within(today).getByText("3h of 3h")).toHaveAttribute("title", "Tasks 1h + events 2h");
    expect(within(today).getByRole("meter", { name: "Planned time" })).toHaveAttribute("aria-valuenow", "180");
    expect(within(today).getByLabelText("From a calendar event")).toBeInTheDocument();
    expect(within(today).getByLabelText("From an email")).toBeInTheDocument();
  });

  it("asks Claude for tasks from the calendar", async () => {
    calendarApi.suggest.mockResolvedValue({ suggestions: [], events: 0, warnings: [] });
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("button", { name: "📅 From calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Tasks from your calendar" });
    expect(await within(dialog).findByText("Nothing in your calendar for the next 30 days.")).toBeInTheDocument();
    expect(calendarApi.suggest).toHaveBeenCalledWith(TODAY);
  });

  it("checks off and reopens tasks, then reloads", async () => {
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    expect(todoApi.completeTask).toHaveBeenCalledWith("report");
    await userEvent.click(screen.getByRole("checkbox", { name: "Reopen Reply to Anna" }));
    expect(todoApi.reopenTask).toHaveBeenCalledWith("done");
    expect(todoApi.days).toHaveBeenCalledTimes(3);
    // Statistics reload with every change.
    expect(todoApi.stats.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("shows a check-off right away, before the server answers, then reloads without syncing routines", async () => {
    let finish!: () => void;
    todoApi.completeTask.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    expect(screen.getByRole("checkbox", { name: "Reopen Finish the report" })).toHaveAttribute("aria-checked", "true");
    expect(todoApi.days).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(todoApi.days).toHaveBeenCalledTimes(2));
    expect(todoApi.days).toHaveBeenLastCalledWith(false);
  });

  it("puts a failed check-off back", async () => {
    todoApi.completeTask.mockRejectedValue(new Error("Database unavailable"));
    todoApi.days.mockResolvedValueOnce(feed).mockRejectedValue(new Error("offline"));
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    expect(await screen.findByRole("checkbox", { name: "Complete Finish the report" })).toHaveAttribute("aria-checked", "false");
  });

  it("reloads once after quick changes in a row and keeps them all on screen", async () => {
    const finishers: (() => void)[] = [];
    todoApi.completeTask.mockImplementation(() => new Promise<void>((resolve) => finishers.push(resolve)));
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Complete Call the bank" }));
    finishers[0]();
    await vi.waitFor(() => expect(todoApi.completeTask).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("checkbox", { name: "Reopen Call the bank" })).toBeInTheDocument();
    expect(todoApi.days).toHaveBeenCalledTimes(1);
    finishers[1]();
    await vi.waitFor(() => expect(todoApi.days).toHaveBeenCalledTimes(2));
  });

  it("moves a task on screen right away and back when saving fails", async () => {
    let fail!: (e: Error) => void;
    todoApi.updateTask.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    todoApi.days.mockResolvedValueOnce(feed).mockRejectedValue(new Error("offline"));
    render(<TodoModule />);
    const overdue = await screen.findByRole("region", { name: /^Monday/ });
    await userEvent.click(within(overdue).getByRole("button", { name: "To inbox" }));
    expect(within(card(/Inbox/)).getByText("Call the bank")).toBeInTheDocument();
    fail(new Error("Database unavailable"));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(within(card(/Inbox/)).queryByText("Call the bank")).not.toBeInTheDocument();
  });

  it("moves overdue tasks to today or the inbox", async () => {
    render(<TodoModule />);
    const overdue = await screen.findByRole("region", { name: /^Monday/ });
    await userEvent.click(within(overdue).getByRole("button", { name: "Move to today" }));
    expect(todoApi.updateTask).toHaveBeenCalledWith("late", { planned_date: TODAY });
    await userEvent.click(within(overdue).getByRole("button", { name: "To inbox" }));
    expect(todoApi.updateTask).toHaveBeenLastCalledWith("late", { planned_date: null });
  });

  it("quick-adds to a day and to the inbox", async () => {
    render(<TodoModule />);
    await userEvent.type(await screen.findByLabelText("Add a task on Tomorrow"), "Gym{Enter}");
    expect(todoApi.createTask).toHaveBeenCalledWith({ title: "Gym", planned_date: "2026-03-05" });
    await userEvent.type(screen.getByLabelText("Add a task to the inbox"), "Someday{Enter}");
    expect(todoApi.createTask).toHaveBeenLastCalledWith({ title: "Someday", planned_date: null });
  });

  it("adds a task with details in the side panel", async () => {
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("button", { name: "Add task" }));
    const panel = screen.getByRole("complementary", { name: "New task" });
    expect(within(panel).getByLabelText("Day")).toHaveValue(TODAY);
    await userEvent.type(within(panel).getByLabelText("Title"), "Dentist");
    await userEvent.click(within(panel).getByRole("button", { name: "Add task" }));
    expect(todoApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Dentist", planned_date: TODAY }));
    expect(screen.queryByRole("complementary", { name: "New task" })).not.toBeInTheDocument();
  });

  it("edits and deletes a task", async () => {
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("button", { name: "Finish the report" }));
    const panel = screen.getByRole("complementary", { name: "Edit task" });
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(todoApi.updateTask).toHaveBeenCalledWith("report", expect.objectContaining({ title: "Finish the report" }));

    await userEvent.click(await screen.findByRole("button", { name: "Finish the report" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(todoApi.deleteTask).toHaveBeenCalledWith("report");
  });

  it("shows action errors without losing the list", async () => {
    todoApi.completeTask.mockRejectedValue(new Error("Database unavailable"));
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByText("Finish the report")).toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    todoApi.days.mockRejectedValueOnce(new Error("down"));
    render(<TodoModule />);
    expect(await screen.findByText("Could not load your tasks: down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Finish the report")).toBeInTheDocument();
  });
});
