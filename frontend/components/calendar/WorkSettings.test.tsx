import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkSettings } from "./WorkSettings";

const calendarApi = vi.hoisted(() => ({
  schedule: vi.fn(),
  saveSchedule: vi.fn(),
  daysOff: vi.fn(),
  addDayOff: vi.fn(),
  deleteDayOff: vi.fn(),
}));
vi.mock("@/lib/calendar/api", () => ({ calendarApi }));

const schedule = {
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00:00",
  work_end: "17:00:00",
  task_minutes_workday: 180,
  task_minutes_day_off: 360,
};
const vacation = { id: "d1", start_date: "2026-08-01", end_date: "2026-08-14", label: "Vacation" };

beforeEach(() => {
  calendarApi.schedule.mockResolvedValue(schedule);
  calendarApi.saveSchedule.mockImplementation(async (s) => s);
  calendarApi.daysOff.mockResolvedValue([vacation]);
  calendarApi.addDayOff.mockResolvedValue(undefined);
  calendarApi.deleteDayOff.mockResolvedValue(undefined);
});

const scheduleCard = () => screen.getByRole("region", { name: "Work schedule" });

describe("WorkSettings", () => {
  it("edits and saves the work schedule", async () => {
    render(<WorkSettings />);
    const card = await screen.findByRole("region", { name: "Work schedule" });
    await within(card).findByRole("button", { name: "Mon" });
    expect(within(card).getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(within(card).getByRole("button", { name: "Fri" }));
    await userEvent.click(within(card).getByRole("button", { name: "Sat" }));
    fireEvent.change(within(card).getByLabelText("Work starts"), { target: { value: "08:00" } });
    fireEvent.change(within(card).getByLabelText("Time for tasks on a work day"), { target: { value: "120" } });
    expect(within(card).getByText("2h")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Save schedule" }));

    expect(calendarApi.saveSchedule).toHaveBeenCalledWith({
      ...schedule,
      work_days: [1, 2, 3, 4, 6],
      work_start: "08:00",
      task_minutes_workday: 120,
    });
    expect(await within(card).findByText("Schedule saved.")).toBeInTheDocument();
  });

  it("rejects a work day that ends before it starts", async () => {
    render(<WorkSettings />);
    const end = await within(await screen.findByRole("region", { name: "Work schedule" })).findByLabelText("Work ends");
    fireEvent.change(end, { target: { value: "08:00" } });
    await userEvent.click(within(scheduleCard()).getByRole("button", { name: "Save schedule" }));
    expect(screen.getByText("Work must end after it starts.")).toBeInTheDocument();
    expect(calendarApi.saveSchedule).not.toHaveBeenCalled();
  });

  it("lists, adds and removes days off", async () => {
    render(<WorkSettings />);
    const card = screen.getByRole("region", { name: "Days off" });
    expect(await within(card).findByText("Vacation")).toBeInTheDocument();
    expect(within(card).getByText("1 Aug 2026 – 14 Aug 2026")).toBeInTheDocument();

    await userEvent.type(within(card).getByLabelText("What is it"), "Holiday");
    fireEvent.change(within(card).getByLabelText("First day off"), { target: { value: "2026-11-11" } });
    await userEvent.click(within(card).getByRole("button", { name: "Add days off" }));
    expect(calendarApi.addDayOff).toHaveBeenCalledWith({ start_date: "2026-11-11", end_date: "2026-11-11", label: "Holiday" });

    await userEvent.click(within(card).getByRole("button", { name: /Remove Vacation/ }));
    expect(calendarApi.deleteDayOff).toHaveBeenCalledWith("d1");
  });

  it("validates days off", async () => {
    render(<WorkSettings />);
    const card = screen.getByRole("region", { name: "Days off" });
    await within(card).findByText("Vacation");
    await userEvent.click(within(card).getByRole("button", { name: "Add days off" }));
    expect(within(card).getByText("Choose the first day off.")).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("First day off"), { target: { value: "2026-11-11" } });
    fireEvent.change(within(card).getByLabelText("Last day off"), { target: { value: "2026-11-01" } });
    await userEvent.click(within(card).getByRole("button", { name: "Add days off" }));
    expect(within(card).getByText("The last day can't be before the first one.")).toBeInTheDocument();
    expect(calendarApi.addDayOff).not.toHaveBeenCalled();
  });

  it("shows loading errors", async () => {
    calendarApi.schedule.mockRejectedValue(new Error("down"));
    calendarApi.daysOff.mockRejectedValue(new Error("down"));
    render(<WorkSettings />);
    expect(await screen.findByText("Could not load your schedule: down")).toBeInTheDocument();
    expect(await screen.findByText("Could not load days off: down")).toBeInTheDocument();
  });
});
