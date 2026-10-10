import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/todo/types";
import { PlanDialog } from "./PlanDialog";

const todoApi = vi.hoisted(() => ({ plan: vi.fn(), applyPlan: vi.fn() }));
vi.mock("@/lib/todo/api", () => ({ todoApi }));

const TODAY = "2026-03-04";
const proposal: Proposal = {
  summary: "Passport first, photos at the weekend.",
  warnings: ["Thursday 5 March is over its available time (200 of 180 min)."],
  changes: [
    { task_id: "a", title: "Renew passport", from_date: null, to_date: "2026-03-05", order: 0, duration_min: 60, reason: "Deadline soon" },
    { task_id: "b", title: "Call the bank", from_date: "2026-03-02", to_date: "2026-03-05", order: 1, duration_min: 15, reason: "Overdue" },
    { task_id: "c", title: "Sort photos", from_date: "2026-03-06", to_date: null, order: 0, duration_min: null, reason: "No room" },
  ],
  days: [{ date: "2026-03-05", capacity_min: 180, planned_min: 200 }],
};

function renderDialog() {
  const onClose = vi.fn();
  const onApplied = vi.fn();
  render(<PlanDialog today={TODAY} onClose={onClose} onApplied={onApplied} />);
  return { onClose, onApplied };
}

beforeEach(() => {
  todoApi.plan.mockResolvedValue(proposal);
  todoApi.applyPlan.mockResolvedValue({ applied: 2 });
});

describe("PlanDialog", () => {
  it("shows a loading state, then the proposal grouped by day", async () => {
    renderDialog();
    expect(screen.getByRole("status")).toHaveTextContent("Claude is looking at your tasks");
    expect(await screen.findByText("Passport first, photos at the weekend.")).toBeInTheDocument();
    expect(screen.getByText(/over its available time/)).toBeInTheDocument();

    const tomorrow = screen.getByRole("region", { name: "Tomorrow, Thursday, 5 March" });
    expect(within(tomorrow).getByText("Renew passport")).toBeInTheDocument();
    expect(within(tomorrow).getByText("from the inbox · Deadline soon")).toBeInTheDocument();
    expect(within(tomorrow).getByText("from Monday · Overdue")).toBeInTheDocument();
    expect(within(tomorrow).getByText("3h 20m of 3h")).toHaveClass("text-[#e0574a]");
    expect(within(screen.getByRole("region", { name: "Back to the inbox" })).getByText("Sort photos")).toBeInTheDocument();
  });

  it("applies only the selected changes", async () => {
    const { onApplied, onClose } = renderDialog();
    await screen.findByText("Renew passport");
    expect(screen.getByRole("button", { name: "Apply 3 changes" })).toBeEnabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Sort photos/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));
    expect(todoApi.applyPlan).toHaveBeenCalledWith([proposal.changes[0], proposal.changes[1]]);
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("can't apply nothing", async () => {
    renderDialog();
    await screen.findByText("Renew passport");
    for (const name of [/Renew passport/, /Call the bank/, /Sort photos/]) {
      await userEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByRole("button", { name: "Apply 0 changes" })).toBeDisabled();
  });

  it("says when nothing needs to change", async () => {
    todoApi.plan.mockResolvedValue({ ...proposal, changes: [], warnings: [] });
    renderDialog();
    expect(await screen.findByText(/no changes suggested/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("shows planner errors, e.g. when Claude isn't set up", async () => {
    todoApi.plan.mockRejectedValue(new Error("Planning with Claude isn't set up (no API key)."));
    renderDialog();
    expect(await screen.findByText("Planning with Claude isn't set up (no API key).")).toBeInTheDocument();
  });

  it("keeps the dialog open when applying fails", async () => {
    todoApi.applyPlan.mockRejectedValue(new Error("Database unavailable"));
    const { onClose } = renderDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Apply 3 changes" }));
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with Escape and the close button", async () => {
    const { onClose } = renderDialog();
    await screen.findByText("Renew passport");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
