import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Occurrence } from "@/lib/calendar/types";
import { DragProvider } from "@/components/todo/dnd";
import { HOUR_PX, TimeGrid } from "./TimeGrid";

const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

function occ(title: string, date: string, start: string | null, end: string | null, extra: Partial<Occurrence> = {}): Occurrence {
  return {
    id: title,
    title,
    notes: "",
    location: "",
    start_date: date,
    end_date: date,
    start_time: start,
    end_time: end,
    color: "#56a8f5",
    recurrence: "none",
    recurrence_until: null,
    add_to_timeline: false,
    timeline_event_id: null,
    all_day: start === null,
    occurrence_date: date,
    ...extra,
  };
}

const doctor = occ("Doctor", "2026-10-14", "15:30:00", "16:30:00", { location: "Clinic" });
const trip = occ("Trip", "2026-10-16", null, null, { end_date: "2026-10-18" });

// jsdom has no layout: columns are 100px wide, side by side, starting at the top of the page.
let rectSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const i = DAYS.indexOf(this.dataset.colDay ?? "");
    return { left: i * 100, right: (i + 1) * 100, top: 0, bottom: 24 * HOUR_PX, width: 100, height: 24 * HOUR_PX, x: i * 100, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => rectSpy.mockRestore());

const wine = {
  id: "t1",
  title: "Buy wine",
  notes: "",
  planned_date: "2026-10-13",
  deadline: null,
  duration_min: null,
  priority: "normal" as const,
  fixed_day: false,
  status: "open" as const,
  completed_at: null,
  first_planned_date: "2026-10-13",
  postponed_count: 0,
  routine_id: null,
  occurrence_date: null,
  position: 0,
  created_at: "",
};

function setup(occurrences = [doctor, trip]) {
  const props = { onCreate: vi.fn(), onOpen: vi.fn(), onMove: vi.fn(), onShowDay: vi.fn(), onToggleTask: vi.fn(), onOpenTask: vi.fn() };
  render(
    <DragProvider onDrop={vi.fn()}>
    <TimeGrid
      days={DAYS}
      today="2026-10-14"
      occurrences={occurrences}
      tasks={[wine]}
      daysOff={[{ id: "d1", start_date: "2026-10-17", end_date: "2026-10-17", label: "Holiday" }]}
      workStart={540}
      workEnd={1020}
      {...props}
    />
    </DragProvider>,
  );
  return props;
}

const at = (minutes: number) => (minutes * HOUR_PX) / 60;
const column = (day: string) => screen.getByLabelText(`Hours of ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00`))}`);

function drag(from: Element, start: { x: number; y: number }, end: { x: number; y: number }) {
  fireEvent.pointerDown(from, { button: 0, clientX: start.x, clientY: start.y, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: end.x, clientY: end.y, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: end.x, clientY: end.y, pointerId: 1 });
}

describe("TimeGrid", () => {
  it("places timed events by time and the rest in the all-day row", () => {
    setup();
    const event = screen.getByRole("button", { name: "Doctor, 15:30 – 16:30" });
    expect(event.style.top).toBe(`${at(930) + 1}px`);
    expect(event.style.height).toBe(`${at(60) - 2}px`);
    expect(within(event).getByText("Clinic")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: "All day" })).getByRole("button", { name: "Trip" })).toBeInTheDocument();
    expect(screen.getByText("🌴 Holiday")).toBeInTheDocument();
    expect(within(column("2026-10-14")).getByLabelText("Now")).toBeInTheDocument();
    expect(within(column("2026-10-13")).queryByLabelText("Now")).not.toBeInTheDocument();
  });

  it("opens an event on click and a day from its header", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Doctor, 15:30 – 16:30" }));
    expect(props.onOpen).toHaveBeenCalledWith(doctor);
    await userEvent.click(screen.getByRole("button", { name: "Show Friday 16 October" }));
    expect(props.onShowDay).toHaveBeenCalledWith("2026-10-16");
  });

  it("creates a one-hour event where you click", () => {
    const props = setup();
    const col = column("2026-10-13");
    fireEvent.pointerDown(col, { button: 0, clientX: 150, clientY: at(625), pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: at(625), pointerId: 1 });
    expect(props.onCreate).toHaveBeenCalledWith({ date: "2026-10-13", startTime: "10:00", endTime: "11:00" });
  });

  it("creates an event over the dragged time", () => {
    const props = setup();
    drag(column("2026-10-15"), { x: 350, y: at(14 * 60 + 5) }, { x: 350, y: at(15 * 60 + 25) });
    expect(props.onCreate).toHaveBeenCalledWith({ date: "2026-10-15", startTime: "14:00", endTime: "15:30" });
  });

  it("creates an all-day event from the all-day row", () => {
    const props = setup();
    const row = screen.getByRole("row", { name: "All day" });
    fireEvent.click(row.querySelector('[data-all-day="2026-10-12"]')!);
    expect(props.onCreate).toHaveBeenCalledWith({ date: "2026-10-12" });
  });

  it("moves an event to another day and time", () => {
    const props = setup();
    const event = screen.getByRole("button", { name: "Doctor, 15:30 – 16:30" });
    drag(event, { x: 250, y: at(940) }, { x: 450, y: at(940 + 62) });
    expect(props.onMove).toHaveBeenCalledWith(doctor, { date: "2026-10-16", start: 990, end: 1050 });
    expect(event.style.transform).toBe("");
  });

  it("resizes an event from its bottom edge", () => {
    const props = setup();
    const handle = screen.getByRole("button", { name: "Doctor, 15:30 – 16:30" }).querySelector("[data-resize]")!;
    drag(handle, { x: 250, y: at(990) }, { x: 250, y: at(990 + 31) });
    expect(props.onMove).toHaveBeenCalledWith(doctor, { date: "2026-10-14", start: 930, end: 1020 });
  });

  it("ignores tiny pointer jitter and touch drags", () => {
    const props = setup();
    const event = screen.getByRole("button", { name: "Doctor, 15:30 – 16:30" });
    drag(event, { x: 250, y: 700 }, { x: 251, y: 701 });
    fireEvent.pointerDown(event, { button: 0, clientX: 250, clientY: 700, pointerType: "touch" });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 900 });
    fireEvent.pointerUp(window, { clientX: 250, clientY: 900 });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("shows tasks in the all-day row", async () => {
    const props = setup();
    const row = screen.getByRole("row", { name: "All day" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Complete Buy wine" }));
    expect(props.onToggleTask).toHaveBeenCalledWith(wine);
    await userEvent.click(within(row).getByRole("button", { name: "Task: Buy wine" }));
    expect(props.onOpenTask).toHaveBeenCalledWith(wine);
    expect(row.querySelector('[data-drop-date="2026-10-13"]')).not.toBeNull();
  });
});
