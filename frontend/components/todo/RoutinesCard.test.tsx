import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine } from "@/lib/todo/types";
import { RoutinesCard } from "./RoutinesCard";

const todoApi = vi.hoisted(() => ({
  routines: vi.fn(),
  createRoutine: vi.fn(),
  updateRoutine: vi.fn(),
  deleteRoutine: vi.fn(),
}));
vi.mock("@/lib/todo/api", () => ({ todoApi }));

const workout: Routine = {
  id: "r1",
  title: "Workout",
  notes: "",
  kind: "weekly",
  weekdays: [1, 3, 5],
  interval_days: null,
  month_day: null,
  duration_min: 45,
  priority: "normal",
  active: true,
  starts_on: "2026-03-01",
  created_at: "",
};

async function renderOpen() {
  const onChanged = vi.fn();
  render(<RoutinesCard onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: /Routines/ }));
  return { onChanged };
}

beforeEach(() => {
  todoApi.routines.mockResolvedValue([workout]);
  for (const fn of [todoApi.createRoutine, todoApi.updateRoutine, todoApi.deleteRoutine]) fn.mockResolvedValue(undefined);
});

describe("RoutinesCard", () => {
  it("is collapsed until opened and lists routines with their rules", async () => {
    render(<RoutinesCard onChanged={vi.fn()} />);
    expect(await screen.findByText("1 active")).toBeInTheDocument();
    expect(screen.queryByText("Workout")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Routines/ }));
    expect(screen.getByText("Workout")).toBeInTheDocument();
    expect(screen.getByText("Mon, Wed, Fri · 45m")).toBeInTheDocument();
  });

  it("creates a weekly routine", async () => {
    const { onChanged } = await renderOpen();
    await userEvent.type(screen.getByLabelText("Routine title"), "Swim");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "On chosen days");
    await userEvent.click(screen.getByRole("button", { name: "Tue" }));
    await userEvent.click(screen.getByRole("button", { name: "Sat" }));
    await userEvent.selectOptions(screen.getByLabelText("Routine duration"), "1h");
    await userEvent.click(screen.getByRole("button", { name: "high priority" }));
    await userEvent.click(screen.getByRole("button", { name: "Add routine" }));
    expect(todoApi.createRoutine).toHaveBeenCalledWith({
      title: "Swim",
      kind: "weekly",
      weekdays: [2, 6],
      interval_days: null,
      month_day: null,
      duration_min: 60,
      priority: "high",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("creates every-N-days and monthly routines", async () => {
    await renderOpen();
    await userEvent.type(screen.getByLabelText("Routine title"), "Water plants");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "Every few days");
    await userEvent.clear(screen.getByLabelText("Every how many days"));
    await userEvent.type(screen.getByLabelText("Every how many days"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Add routine" }));
    expect(todoApi.createRoutine).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "interval", interval_days: 3 }));

    await userEvent.type(screen.getByLabelText("Routine title"), "Rent");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "Once a month");
    await userEvent.clear(screen.getByLabelText("Day of the month"));
    await userEvent.type(screen.getByLabelText("Day of the month"), "28");
    await userEvent.click(screen.getByRole("button", { name: "Add routine" }));
    expect(todoApi.createRoutine).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "monthly", month_day: 28 }));
  });

  it("validates the form", async () => {
    await renderOpen();
    await userEvent.click(screen.getByRole("button", { name: "Add routine" }));
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Routine title"), "x");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "On chosen days");
    await userEvent.click(screen.getByRole("button", { name: "Add routine" }));
    expect(screen.getByText("Pick at least one day.")).toBeInTheDocument();
    expect(todoApi.createRoutine).not.toHaveBeenCalled();
  });

  it("pauses and deletes routines", async () => {
    const { onChanged } = await renderOpen();
    await userEvent.click(screen.getByRole("switch", { name: "Workout active" }));
    expect(todoApi.updateRoutine).toHaveBeenCalledWith("r1", { active: false });
    await userEvent.click(screen.getByRole("button", { name: "Delete Workout" }));
    expect(todoApi.deleteRoutine).toHaveBeenCalledWith("r1");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("shows errors", async () => {
    todoApi.deleteRoutine.mockRejectedValue(new Error("Database unavailable"));
    await renderOpen();
    await userEvent.click(screen.getByRole("button", { name: "Delete Workout" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
  });
});
