import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/todo/types";
import { TaskForm } from "./TaskForm";

const task: Task = {
  id: "t1",
  title: "Dentist",
  notes: "Bring card",
  planned_date: "2026-03-06",
  deadline: null,
  duration_min: 60,
  priority: "high",
  fixed_day: true,
  status: "open",
  completed_at: null,
  first_planned_date: "2026-03-06",
  postponed_count: 0,
  routine_id: null,
  occurrence_date: null,
  position: 0,
  created_at: "",
};

function renderForm(props: Partial<React.ComponentProps<typeof TaskForm>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<TaskForm submitLabel="Save" onSave={onSave} onCancel={onCancel} {...props} />);
  return { onSave, onCancel };
}

const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("TaskForm", () => {
  it("creates an inbox task by default", async () => {
    const { onSave } = renderForm();
    expect(screen.getByLabelText("Keep in the inbox (no day yet)")).toBeChecked();
    await userEvent.type(screen.getByLabelText("Title"), " Renew passport ");
    await userEvent.selectOptions(screen.getByLabelText("Duration"), "1 h");
    await save();
    expect(onSave).toHaveBeenCalledWith({
      title: "Renew passport",
      notes: "",
      planned_date: null,
      deadline: null,
      duration_min: 60,
      priority: "normal",
      fixed_day: false,
    });
  });

  it("plans a task on a day with a deadline, priority and fixed day", async () => {
    const { onSave } = renderForm({ defaultDate: "2026-03-04" });
    await userEvent.type(screen.getByLabelText("Title"), "Report");
    expect(screen.getByLabelText("Day")).toHaveValue("2026-03-04");
    await userEvent.type(screen.getByLabelText("Deadline (optional)"), "2026-03-05");
    await userEvent.click(screen.getByRole("button", { name: "high" }));
    await userEvent.click(screen.getByLabelText(/Must happen this day/));
    await save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ planned_date: "2026-03-04", deadline: "2026-03-05", priority: "high", fixed_day: true }),
    );
  });

  it("is prefilled when editing", () => {
    renderForm({ task });
    expect(screen.getByLabelText("Title")).toHaveValue("Dentist");
    expect(screen.getByLabelText("Day")).toHaveValue("2026-03-06");
    expect(screen.getByLabelText("Duration")).toHaveValue("60");
    expect(screen.getByRole("button", { name: "high" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring card");
  });

  it("moving a task to the inbox drops its day and fixed flag", async () => {
    const { onSave } = renderForm({ task });
    await userEvent.click(screen.getByLabelText("Keep in the inbox (no day yet)"));
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ planned_date: null, fixed_day: false }));
  });

  it("validates", async () => {
    const { onSave } = renderForm({ defaultDate: "2026-03-04" });
    await save();
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "x");
    await userEvent.clear(screen.getByLabelText("Day"));
    await save();
    expect(screen.getByText("Choose a day, or keep the task in the inbox.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows save errors", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    renderForm({ task, onSave });
    await save();
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
  });

  it("deletes after confirmation, or skips a routine occurrence", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<TaskForm task={task} submitLabel="Save" onSave={vi.fn()} onCancel={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(onDelete).toHaveBeenCalled();
    unmount();

    render(
      <TaskForm task={{ ...task, routine_id: "r1" }} submitLabel="Save" onSave={vi.fn()} onCancel={vi.fn()} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Skip…" }));
    expect(screen.getByRole("button", { name: "Skip this time" })).toBeInTheDocument();
  });

  it("cancels", async () => {
    const { onCancel } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
