import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/calendar/types";
import { SuggestDialog } from "./SuggestDialog";

const calendarApi = vi.hoisted(() => ({ suggest: vi.fn(), applySuggestions: vi.fn() }));
vi.mock("@/lib/calendar/api", () => ({ calendarApi }));

const present: Suggestion = {
  event_id: "e1",
  occurrence_date: "2026-10-25",
  event_title: "Urodziny mamy",
  event_color: "#f27fb2",
  title: "Kup prezent dla mamy",
  planned_date: "2026-10-15",
  deadline: "2026-10-25",
  duration_min: 60,
  priority: "normal",
  fixed_day: false,
  reason: "Time to shop",
};
const cake: Suggestion = { ...present, title: "Zamów tort", planned_date: "2026-10-22", duration_min: 15, reason: "Bakeries need notice" };
const visit: Suggestion = {
  ...present,
  event_id: "e2",
  occurrence_date: "2026-10-14",
  event_title: "Lekarz",
  event_color: "#56a8f5",
  title: "Wizyta u lekarza 15:30",
  planned_date: "2026-10-14",
  deadline: null,
  fixed_day: true,
  priority: "high",
  reason: "The visit itself",
};

function setup() {
  const props = { onClose: vi.fn(), onApplied: vi.fn() };
  render(<SuggestDialog today="2026-10-11" {...props} />);
  return props;
}

beforeEach(() => {
  calendarApi.suggest.mockResolvedValue({ suggestions: [present, cake, visit], events: 3, warnings: [] });
  calendarApi.applySuggestions.mockResolvedValue({ created: 2, dismissed: 1 });
});

describe("SuggestDialog", () => {
  it("groups suggestions by event, soonest first", async () => {
    setup();
    const groups = await screen.findAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Lekarz, Wed 14 Oct", "Urodziny mamy, Sun 25 Oct"]);
    expect(within(groups[0]).getByText("The visit itself · ~1h · important")).toBeInTheDocument();
    expect(within(groups[1]).getByText(/in 14 days/)).toBeInTheDocument();
    expect(calendarApi.suggest).toHaveBeenCalledWith("2026-10-11");
  });

  it("adds the ticked tasks as edited and forgets the unticked ones", async () => {
    const props = setup();
    const cakeBox = await screen.findByRole("checkbox", { name: "Add Zamów tort" });
    await userEvent.click(cakeBox);
    const presentGroup = screen.getByRole("region", { name: "Urodziny mamy, Sun 25 Oct" });
    const [title] = within(presentGroup).getAllByLabelText("Task title");
    await userEvent.clear(title);
    await userEvent.type(title, "Kup książkę dla mamy");
    fireEvent.change(within(presentGroup).getByLabelText("Day for Kup prezent dla mamy"), { target: { value: "2026-10-18" } });
    await userEvent.click(screen.getByRole("button", { name: "Add 2 tasks" }));
    expect(calendarApi.applySuggestions).toHaveBeenCalledWith(
      "2026-10-11",
      [
        { suggestion: present, title: "Kup książkę dla mamy", planned_date: "2026-10-18" },
        { suggestion: visit, title: "Wizyta u lekarza 15:30", planned_date: "2026-10-14" },
      ],
      [cake],
    );
    expect(props.onApplied).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("can keep unticked suggestions for later", async () => {
    setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Add Zamów tort" }));
    await userEvent.click(screen.getByLabelText("Don't suggest the unticked ones again"));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 tasks" }));
    expect(calendarApi.applySuggestions.mock.calls[0][2]).toEqual([]);
  });

  it("checks titles and days before adding", async () => {
    setup();
    const [title] = await screen.findAllByLabelText("Task title");
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole("button", { name: "Add 3 tasks" }));
    expect(screen.getByText("Every task needs a title.")).toBeInTheDocument();
    await userEvent.type(title, "Visit");
    fireEvent.change(screen.getByLabelText("Day for Zamów tort"), { target: { value: "2026-10-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Add 3 tasks" }));
    expect(screen.getByText("Choose today or a later day for every task.")).toBeInTheDocument();
    expect(calendarApi.applySuggestions).not.toHaveBeenCalled();
  });

  it("says when there is nothing to prepare", async () => {
    calendarApi.suggest.mockResolvedValue({ suggestions: [], events: 4, warnings: [] });
    setup();
    expect(await screen.findByText("Looked at 4 events — nothing new to prepare.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("shows errors from Claude", async () => {
    calendarApi.suggest.mockRejectedValue(new Error("Can't reach Claude right now."));
    setup();
    expect(await screen.findByText("Can't reach Claude right now.")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const props = setup();
    await screen.findAllByRole("region");
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});
