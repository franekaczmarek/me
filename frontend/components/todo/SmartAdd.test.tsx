import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "@/lib/todo/types";
import { SmartAdd } from "./SmartAdd";

const todoApi = vi.hoisted(() => ({ parse: vi.fn(), createTask: vi.fn() }));
vi.mock("@/lib/todo/api", () => ({ todoApi }));

const TODAY = "2026-10-11";
const dentist: Draft = {
  title: "Dentysta",
  notes: "o 15:00",
  planned_date: "2026-10-12",
  deadline: null,
  duration_min: 60,
  duration_estimated: true,
  priority: "high",
  fixed_day: true,
};
const report: Draft = {
  title: "Oddać raport",
  notes: "",
  planned_date: null,
  deadline: "2026-10-14",
  duration_min: 45,
  duration_estimated: false,
  priority: "normal",
  fixed_day: false,
};

async function readNote(note = "dentysta jutro o 15, ważne; raport do środy") {
  const onAdded = vi.fn();
  render(<SmartAdd today={TODAY} onAdded={onAdded} />);
  await userEvent.type(screen.getByLabelText("Type tasks"), note);
  await userEvent.click(screen.getByRole("button", { name: "Read" }));
  return { onAdded };
}

const row = (title: string) => screen.getByDisplayValue(title).closest("li")!;

beforeEach(() => {
  todoApi.parse.mockResolvedValue({ tasks: [dentist, report], warnings: [] });
  todoApi.createTask.mockResolvedValue({});
});

describe("SmartAdd", () => {
  it("previews what Claude read", async () => {
    await readNote();
    expect(todoApi.parse).toHaveBeenCalledWith("dentysta jutro o 15, ważne; raport do środy");
    const d = await screen.findByDisplayValue("Dentysta");
    const first = d.closest("li")!;
    expect(within(first).getByText("📅 Tomorrow")).toBeInTheDocument();
    expect(within(first).getByText("⏱ ~1h")).toBeInTheDocument(); // estimated
    expect(within(first).getByRole("button", { name: /Fixed day/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByText("· o 15:00")).toBeInTheDocument();
    const second = row("Oddać raport");
    expect(within(second).getByText("📥 Inbox")).toBeInTheDocument();
    expect(within(second).getByText(/due 14 Oct/)).toBeInTheDocument();
    expect(within(second).getByText("⏱ 45m")).toBeInTheDocument(); // given, not estimated
  });

  it("adds the reviewed tasks and clears the bar", async () => {
    const { onAdded } = await readNote();
    await userEvent.click(await screen.findByRole("button", { name: "Add 2 tasks" }));
    expect(todoApi.createTask).toHaveBeenNthCalledWith(1, {
      title: "Dentysta",
      notes: "o 15:00",
      planned_date: "2026-10-12",
      deadline: null,
      duration_min: 60,
      priority: "high",
      fixed_day: true,
    });
    expect(todoApi.createTask).toHaveBeenCalledTimes(2);
    expect(onAdded).toHaveBeenCalled();
    expect(screen.getByLabelText("Type tasks")).toHaveValue("");
    expect(screen.queryByDisplayValue("Dentysta")).not.toBeInTheDocument();
  });

  it("lets the user edit each task before adding", async () => {
    await readNote();
    const first = (await screen.findByDisplayValue("Dentysta")).closest("li")!;
    await userEvent.clear(within(first).getByLabelText("Task title"));
    await userEvent.type(within(first).getByLabelText("Task title"), "Dentist");
    await userEvent.click(within(first).getByRole("button", { name: /Priority high/ })); // high → low
    await userEvent.click(within(first).getByRole("button", { name: "To inbox" }));
    fireEvent.change(within(first).getByLabelText("Duration"), { target: { value: "30" } });

    const second = row("Oddać raport");
    await userEvent.click(within(second).getByRole("button", { name: "Remove deadline" }));
    fireEvent.change(within(second).getByLabelText("Day"), { target: { value: "2026-10-13" } });

    await userEvent.click(screen.getByRole("button", { name: "Add 2 tasks" }));
    expect(todoApi.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "Dentist", priority: "low", planned_date: null, fixed_day: false, duration_min: 30,
    }));
    expect(todoApi.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({ deadline: null, planned_date: "2026-10-13" }));
  });

  it("removes tasks from the preview", async () => {
    await readNote();
    await userEvent.click(await screen.findByRole("button", { name: "Remove Dentysta" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 1 task" }));
    expect(todoApi.createTask).toHaveBeenCalledTimes(1);
    expect(todoApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Oddać raport" }));
  });

  it("shows warnings and an empty result", async () => {
    todoApi.parse.mockResolvedValue({ tasks: [], warnings: ["Only the first 20 tasks were kept."] });
    await readNote("hmm");
    expect(await screen.findByText("No tasks found in that note.")).toBeInTheDocument();
    expect(screen.getByText(/Only the first 20/)).toBeInTheDocument();
  });

  it("cancels the preview", async () => {
    await readNote();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("Dentysta")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type tasks")).toHaveValue("dentysta jutro o 15, ważne; raport do środy");
  });

  it("falls back to one inbox task when Claude isn't available", async () => {
    todoApi.parse.mockRejectedValue(new Error("Claude isn't set up (no API key)."));
    const { onAdded } = await readNote("buy milk");
    expect(await screen.findByText("Claude isn't set up (no API key).")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add as one task to the inbox" }));
    expect(todoApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "buy milk", planned_date: null }));
    expect(onAdded).toHaveBeenCalled();
  });

  it("does nothing for an empty note", async () => {
    render(<SmartAdd today={TODAY} onAdded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Read" })).toBeDisabled();
  });
});
