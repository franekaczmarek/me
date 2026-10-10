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
}));
vi.mock("@/lib/todo/api", () => ({ todoApi, localToday: () => "2026-03-04" }));

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

  it("checks off and reopens tasks, then reloads", async () => {
    render(<TodoModule />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Finish the report" }));
    expect(todoApi.completeTask).toHaveBeenCalledWith("report");
    await userEvent.click(screen.getByRole("checkbox", { name: "Reopen Reply to Anna" }));
    expect(todoApi.reopenTask).toHaveBeenCalledWith("done");
    expect(todoApi.days).toHaveBeenCalledTimes(3);
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
