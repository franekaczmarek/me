import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, Occurrence, Summary } from "@/lib/calendar/types";
import type { Task } from "@/lib/todo/types";
import { CalendarModule } from "./CalendarModule";

const calendarApi = vi.hoisted(() => ({
  schedule: vi.fn(),
  saveSchedule: vi.fn(),
  daysOff: vi.fn(),
  addDayOff: vi.fn(),
  deleteDayOff: vi.fn(),
  occurrences: vi.fn(),
  event: vi.fn(),
  createEvent: vi.fn(),
  saveEvent: vi.fn(),
  deleteEvent: vi.fn(),
  summary: vi.fn(),
  suggest: vi.fn(),
  applySuggestions: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("@/lib/calendar/api", () => ({ calendarApi }));
const todoApi = vi.hoisted(() => ({
  tasks: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("@/lib/todo/api", () => ({ localToday: () => "2026-10-11", todoApi }));

const birthday: CalendarEvent = {
  id: "e1",
  title: "Mom's birthday",
  notes: "",
  location: "",
  start_date: "1965-10-25",
  end_date: "1965-10-25",
  start_time: null,
  end_time: null,
  color: "#f27fb2",
  recurrence: "yearly",
  recurrence_until: null,
  add_to_timeline: false,
  timeline_event_id: null,
};
const occurrence = (event: CalendarEvent, date: string, extra: Partial<Occurrence> = {}): Occurrence => ({
  ...event,
  start_date: date,
  end_date: date,
  all_day: event.start_time === null,
  occurrence_date: date,
  ...extra,
});
const doctor: CalendarEvent = { ...birthday, id: "e2", title: "Doctor", start_date: "2026-10-14", end_date: "2026-10-14", start_time: "15:30:00", end_time: "16:30:00", color: "#56a8f5", recurrence: "none" };
const summary: Summary = {
  month: { month: "2026-10-01", events: 2, event_minutes: 60, busiest_day: "2026-10-14", busiest_day_events: 1, days_off: 0, tasks_done: 3, tasks_open: 2, tasks_overdue: 1 },
  upcoming: [{ id: "e1", title: "Mom's birthday", color: "#f27fb2", start_date: "2026-10-25", end_date: "2026-10-25", start_time: null, all_day: true, occurrence_date: "2026-10-25", days_until: 14, has_task: true }],
};

const wine: Task = {
  id: "t1",
  title: "Buy wine",
  notes: "",
  planned_date: "2026-10-13",
  deadline: null,
  duration_min: null,
  priority: "high",
  fixed_day: false,
  status: "open",
  completed_at: null,
  first_planned_date: "2026-10-13",
  postponed_count: 0,
  routine_id: null,
  occurrence_date: null,
  position: 0,
  created_at: "",
  source_event_id: "e1",
  source_occurrence_date: "2026-10-25",
};

beforeEach(() => {
  localStorage.clear();
  todoApi.tasks.mockResolvedValue([wine]);
  todoApi.updateTask.mockResolvedValue(wine);
  todoApi.completeTask.mockResolvedValue(wine);
  todoApi.reopenTask.mockResolvedValue(wine);
  todoApi.deleteTask.mockResolvedValue(undefined);
  calendarApi.occurrences.mockResolvedValue([occurrence(doctor, "2026-10-14"), occurrence(birthday, "2026-10-25")]);
  calendarApi.daysOff.mockResolvedValue([{ id: "d1", start_date: "2026-10-30", end_date: "2026-10-30", label: "Holiday" }]);
  calendarApi.summary.mockResolvedValue(summary);
  calendarApi.event.mockImplementation(async (id: string) => (id === "e1" ? birthday : doctor));
  calendarApi.createEvent.mockResolvedValue(doctor);
  calendarApi.saveEvent.mockResolvedValue(doctor);
  calendarApi.deleteEvent.mockResolvedValue(undefined);
  calendarApi.schedule.mockResolvedValue({ work_days: [1, 2, 3, 4, 5], work_start: "09:00:00", work_end: "17:00:00", task_minutes_workday: 180, task_minutes_day_off: 360 });
});

const grid = () => screen.getByRole("grid", { name: "Month" });
const findGrid = () => screen.findByRole("grid", { name: "Month" });

describe("CalendarModule", () => {
  it("shows the month with events, days off and the side cards", async () => {
    render(<CalendarModule />);
    expect(await within(await findGrid()).findByRole("button", { name: "Doctor, 15:30" })).toBeInTheDocument();
    expect(within(grid()).getByRole("button", { name: "Mom's birthday" })).toBeInTheDocument();
    expect(within(grid()).getByText("🌴 Holiday")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "October 2026", level: 1 })).toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenCalledWith("2026-09-28", "2026-11-08");
    expect(calendarApi.summary).toHaveBeenCalledWith("2026-10-01", "2026-10-11");

    const card = screen.getByRole("region", { name: "Month summary" });
    expect(within(card).getByText("1h")).toBeInTheDocument();
    expect(within(card).getByText("Overdue")).toBeInTheDocument();
    expect(within(card).getByText("Busiest day: Wed 14 Oct (1 event)")).toBeInTheDocument();
    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    expect(within(upcoming).getByText("in 14 days")).toBeInTheDocument();
    expect(within(upcoming).getByText("✓ task")).toBeInTheDocument();
  });

  it("moves between months", async () => {
    render(<CalendarModule />);
    await within(await findGrid()).findByRole("button", { name: "Doctor, 15:30" });
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenLastCalledWith("2026-10-26", "2026-12-06");
    expect(calendarApi.summary).toHaveBeenLastCalledWith("2026-11-01", "2026-10-11");
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "October 2026", level: 1 })).toBeInTheDocument();
  });

  it("creates an event by clicking a day", async () => {
    render(<CalendarModule />);
    await within(await findGrid()).findByRole("button", { name: "Doctor, 15:30" });
    await userEvent.click(within(grid()).getByRole("gridcell", { name: "Thursday 22 October" }));
    const panel = screen.getByRole("complementary", { name: "New event" });
    expect(within(panel).getByLabelText("Starts")).toHaveValue("2026-10-22");
    await userEvent.type(within(panel).getByLabelText("Title"), "Haircut");
    await userEvent.click(within(panel).getByLabelText("All day"));
    await userEvent.click(within(panel).getByRole("button", { name: "Add event" }));
    expect(calendarApi.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Haircut", start_date: "2026-10-22", end_date: "2026-10-22", start_time: "09:00", end_time: "10:00" }),
    );
    expect(screen.queryByRole("complementary", { name: "New event" })).not.toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenCalledTimes(2);
  });

  it("edits and deletes a whole event", async () => {
    render(<CalendarModule />);
    await userEvent.click(await within(await findGrid()).findByRole("button", { name: "Mom's birthday" }));
    const panel = await screen.findByRole("complementary", { name: "Edit event" });
    expect(calendarApi.event).toHaveBeenCalledWith("e1");
    expect(within(panel).getByLabelText("Starts")).toHaveValue("1965-10-25");
    expect(within(panel).getByText("Changes apply to every repeat of this event.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Lavender" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(calendarApi.saveEvent).toHaveBeenCalledWith("e1", expect.objectContaining({ color: "#9b87f5", recurrence: "yearly" }));

    await userEvent.click(within(grid()).getByRole("button", { name: "Mom's birthday" }));
    const again = await screen.findByRole("complementary", { name: "Edit event" });
    await userEvent.click(within(again).getByRole("button", { name: "Delete…" }));
    await userEvent.click(within(again).getByRole("button", { name: "Delete every repeat" }));
    expect(calendarApi.deleteEvent).toHaveBeenCalledWith("e1");
  });

  it("opens an upcoming event", async () => {
    render(<CalendarModule />);
    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    await userEvent.click(await within(upcoming).findByText("Mom's birthday"));
    expect(await screen.findByRole("complementary", { name: "Edit event" })).toBeInTheDocument();
  });

  it("lists a day and shows what does not fit", async () => {
    const many = ["A", "B", "C", "D", "E"].map((t, i) => occurrence({ ...doctor, id: `m${i}`, title: t }, "2026-10-14"));
    calendarApi.occurrences.mockResolvedValue(many);
    render(<CalendarModule />);
    await userEvent.click(await within(await findGrid()).findByRole("button", { name: "+2 more" }));
    const day = screen.getByRole("complementary", { name: "Wednesday 14 October" });
    expect(within(day).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(within(day).getByRole("button", { name: "+ Add event" }));
    expect(within(screen.getByRole("complementary", { name: "New event" })).getByLabelText("Starts")).toHaveValue("2026-10-14");
  });

  it("opens the work schedule settings", async () => {
    render(<CalendarModule />);
    await userEvent.click(screen.getByRole("button", { name: "Work schedule and days off" }));
    expect(await screen.findByRole("region", { name: "Work schedule" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← Back to summary" }));
    expect(screen.getByRole("region", { name: "Month summary" })).toBeInTheDocument();
  });

  it("offers to try again when loading fails", async () => {
    calendarApi.occurrences.mockRejectedValueOnce(new Error("down"));
    render(<CalendarModule />);
    expect(await screen.findByText("Could not load your calendar: down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await within(await findGrid()).findByRole("button", { name: "Doctor, 15:30" })).toBeInTheDocument();
  });

  it("switches to week and day views and remembers the choice", async () => {
    const { unmount } = render(<CalendarModule />);
    await findGrid();
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("grid", { name: "Week" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "5 – 11 Oct 2026" })).toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenLastCalledWith("2026-10-05", "2026-10-11");
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "12 – 18 Oct 2026" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Doctor, 15:30 – 16:30" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show Wednesday 14 October" }));
    expect(await screen.findByRole("grid", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wednesday, 14 October 2026" })).toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenLastCalledWith("2026-10-14", "2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByRole("heading", { name: "Tuesday, 13 October 2026" })).toBeInTheDocument();

    unmount();
    render(<CalendarModule />);
    expect(await screen.findByRole("grid", { name: "Day" })).toBeInTheDocument();
  });

  it("opens a day from the month grid", async () => {
    render(<CalendarModule />);
    await userEvent.click(await within(await findGrid()).findByRole("button", { name: "Show Sunday 25 October" }));
    expect(await screen.findByRole("grid", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sunday, 25 October 2026" })).toBeInTheDocument();
  });

  it("saves a dragged event, moving its whole series", async () => {
    const series: CalendarEvent = { ...doctor, start_date: "2026-09-30", end_date: "2026-09-30", recurrence: "weekly" };
    calendarApi.event.mockResolvedValue(series);
    localStorage.setItem("me.calendar.view", "day");
    render(<CalendarModule />);
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    const event = await screen.findByRole("button", { name: "Doctor, 15:30 – 16:30" });
    const px = 48 / 60;
    fireEvent.pointerDown(event, { button: 0, clientX: 10, clientY: 940 * px, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 1000 * px, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 1000 * px, pointerId: 1 });
    // Shown at the new time straight away.
    expect(await screen.findByRole("button", { name: "Doctor, 16:30 – 17:30" })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(calendarApi.saveEvent).toHaveBeenCalledWith("e2", {
        title: "Doctor",
        notes: "",
        location: "",
        start_date: "2026-09-30",
        end_date: "2026-09-30",
        start_time: "16:30",
        end_time: "17:30",
        color: "#56a8f5",
        recurrence: "weekly",
        recurrence_until: null,
        add_to_timeline: false,
      }),
    );
  });

  it("ignores a slower, older load", async () => {
    let resolveOld: (value: Occurrence[]) => void = () => {};
    calendarApi.occurrences
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce([occurrence(doctor, "2026-11-04")]);
    render(<CalendarModule />);
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await within(await findGrid()).findByRole("button", { name: "Doctor, 15:30" })).toBeInTheDocument();
    resolveOld([occurrence(birthday, "2026-10-25")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(within(grid()).getByRole("button", { name: "Doctor, 15:30" })).toBeInTheDocument();
  });

  it("shows tasks on their days: check off, edit, and list them with the day", async () => {
    render(<CalendarModule />);
    const month = await findGrid();
    expect(todoApi.tasks).toHaveBeenCalledWith("2026-09-28", "2026-11-08");
    await userEvent.click(await within(month).findByRole("checkbox", { name: "Complete Buy wine" }));
    expect(todoApi.completeTask).toHaveBeenCalledWith("t1");

    await userEvent.click(within(month).getByRole("button", { name: "Task: Buy wine" }));
    const panel = screen.getByRole("complementary", { name: "Edit task" });
    await userEvent.clear(within(panel).getByLabelText("Title"));
    await userEvent.type(within(panel).getByLabelText("Title"), "Buy red wine");
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(todoApi.updateTask).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "Buy red wine" }));

    calendarApi.occurrences.mockResolvedValue(["A", "B", "C"].map((t, i) => occurrence({ ...doctor, id: `m${i}`, title: t }, "2026-10-13")));
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await userEvent.click(await within(await findGrid()).findByRole("button", { name: "+1 more" }));
    const day = screen.getByRole("complementary", { name: "Tuesday 13 October" });
    expect(within(within(day).getByRole("list", { name: "Tasks" })).getByText("Buy wine")).toBeInTheDocument();
  });

  it("checks off a task at once, keeps it through a reload that was already on its way, and saves it", async () => {
    let finish!: () => void;
    todoApi.completeTask.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<CalendarModule />);
    const month = await findGrid();
    await userEvent.click(await within(month).findByRole("checkbox", { name: "Complete Buy wine" }));
    expect(within(month).getByRole("checkbox", { name: "Reopen Buy wine" })).toBeInTheDocument();

    // Moving between months reloads the old (still open) task; the check mark stays.
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await within(await findGrid()).findByRole("checkbox", { name: "Reopen Buy wine" })).toBeInTheDocument();

    const loads = todoApi.tasks.mock.calls.length;
    todoApi.tasks.mockResolvedValue([{ ...wine, status: "done", completed_at: "x" }]);
    finish();
    await vi.waitFor(() => expect(todoApi.tasks.mock.calls.length).toBe(loads + 1));
    expect(within(grid()).getByRole("checkbox", { name: "Reopen Buy wine" })).toBeInTheDocument();
  });

  it("puts a task back when saving fails", async () => {
    todoApi.completeTask.mockRejectedValue(new Error("Database unavailable"));
    render(<CalendarModule />);
    const month = await findGrid();
    todoApi.tasks.mockRejectedValue(new Error("offline"));
    await userEvent.click(await within(month).findByRole("checkbox", { name: "Complete Buy wine" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(within(grid()).getByRole("checkbox", { name: "Complete Buy wine" })).toBeInTheDocument();
  });

  it("moves a task by dropping it on another day", async () => {
    render(<CalendarModule />);
    const month = await findGrid();
    const chip = await within(month).findByRole("button", { name: "Task: Buy wine" });
    const target = within(month).getByRole("gridcell", { name: "Friday 16 October" });
    document.elementFromPoint = vi.fn(() => target);
    fireEvent.pointerDown(chip, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(todoApi.updateTask).toHaveBeenCalledWith("t1", { planned_date: "2026-10-16" });
  });

  it("prepares tasks from upcoming events with Claude", async () => {
    calendarApi.suggest.mockResolvedValue({
      suggestions: [
        {
          event_id: "e1",
          occurrence_date: "2026-10-25",
          event_title: "Mom's birthday",
          event_color: "#f27fb2",
          title: "Buy a present",
          planned_date: "2026-10-15",
          deadline: "2026-10-25",
          duration_min: 60,
          priority: "normal",
          fixed_day: false,
          reason: "Time to shop",
        },
      ],
      events: 2,
      warnings: [],
    });
    calendarApi.applySuggestions.mockResolvedValue({ created: 1, dismissed: 0 });
    render(<CalendarModule />);
    await findGrid();
    await userEvent.click(screen.getByRole("button", { name: "✨ Prepare tasks" }));
    const dialog = screen.getByRole("dialog", { name: "Tasks from your calendar" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Add 1 task" }));
    expect(calendarApi.applySuggestions).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calendarApi.occurrences).toHaveBeenCalledTimes(2);
  });
});
