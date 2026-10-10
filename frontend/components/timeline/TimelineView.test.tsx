import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PALETTE } from "@/lib/timeline/colors";
import type { Category, TimelineEvent } from "@/lib/timeline/types";
import { TimelineView } from "./TimelineView";

// jsdom has no layout: the view falls back to a 1000 px wide timeline starting at x = 0.
const home = { start: new Date(2000, 0, 1), end: new Date(2010, 0, 1) };
const school: Category = { id: "c1", name: "School", color: "#56a8f5" };
const event = (fields: Partial<TimelineEvent>): TimelineEvent => ({
  id: "e",
  title: "Event",
  description: "",
  start: "2005-06-17",
  end: null,
  category_id: null,
  created_at: "",
  updated_at: "",
  ...fields,
});
const events = [
  event({ id: "wedding", title: "Wedding", start: "2005-06-17" }),
  event({ id: "school", title: "High school", start: "2001", end: "2004-06", category_id: "c1" }),
  event({ id: "old", title: "Long ago", start: "1931-05-20" }),
];

function renderView(props: Partial<React.ComponentProps<typeof TimelineView>> = {}) {
  const onSelect = vi.fn();
  const onAdd = vi.fn();
  const view = render(
    <TimelineView
      events={events}
      categories={[school]}
      home={home}
      selectedId={null}
      onSelect={onSelect}
      onAdd={onAdd}
      {...props}
    />,
  );
  return { ...view, onSelect, onAdd, timeline: screen.getByTestId("timeline") };
}

const item = (name: string) => within(screen.getByTestId("timeline")).getByRole("button", { name });
const leftOf = (el: HTMLElement) => parseFloat(el.style.left);
const scaleLabels = () =>
  Array.from(screen.getByTestId("timeline").querySelectorAll("span.absolute")).map((s) => s.textContent ?? "");

describe("TimelineView", () => {
  it("shows events as labels and periods as bars, in their colours", () => {
    renderView();
    expect(PALETTE).toContain(item("Wedding").dataset.color);
    expect(item("High school")).toHaveAttribute("data-color", "#56a8f5");
  });

  it("only renders what is on screen", () => {
    renderView();
    expect(within(screen.getByTestId("timeline")).queryByRole("button", { name: "Long ago" })).not.toBeInTheDocument();
  });

  it("shows a time scale for the visible range", () => {
    renderView();
    expect(scaleLabels()).toEqual(expect.arrayContaining(["2000", "2005", "2010"]));
  });

  it("selects an item on click and clears the selection on empty space", async () => {
    const { onSelect, timeline } = renderView();
    await userEvent.click(item("Wedding"));
    expect(onSelect).toHaveBeenLastCalledWith("wedding");
    await userEvent.click(item("High school"));
    expect(onSelect).toHaveBeenLastCalledWith("school");
    fireEvent.click(timeline);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("marks the selected item", () => {
    renderView({ selectedId: "wedding" });
    expect(item("Wedding")).toHaveAttribute("aria-pressed", "true");
    expect(item("High school")).toHaveAttribute("aria-pressed", "false");
  });

  it("adds an event on the double-clicked day", () => {
    const { onAdd, timeline } = renderView();
    fireEvent.doubleClick(timeline, { clientX: 500 });
    expect(onAdd).toHaveBeenCalledWith(expect.stringMatching(/^(2004-12|2005-01)-\d\d$/));
  });

  it("does not add an event when an item is double-clicked", () => {
    const { onAdd } = renderView();
    fireEvent.doubleClick(item("Wedding"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("zooms in with the mouse wheel around the cursor", async () => {
    const { timeline } = renderView();
    const before = leftOf(item("Wedding"));
    fireEvent.wheel(timeline, { deltaY: -800, clientX: before });
    await waitFor(() =>
      expect(scaleLabels().some((label) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(label))).toBe(
        true,
      ),
    );
    // The point under the cursor stays put.
    expect(Math.abs(leftOf(item("Wedding")) - before)).toBeLessThan(2);
  });

  it("pans with horizontal scrolling and by dragging", async () => {
    const { timeline, onSelect } = renderView();
    const start = leftOf(item("Wedding"));
    fireEvent.wheel(timeline, { deltaX: 100, deltaY: 0 });
    await waitFor(() => expect(leftOf(item("Wedding"))).toBeCloseTo(start - 100));

    fireEvent.pointerDown(timeline, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(timeline, { pointerId: 1, clientX: 450 });
    fireEvent.pointerUp(timeline, { pointerId: 1, clientX: 450 });
    await waitFor(() => expect(leftOf(item("Wedding"))).toBeCloseTo(start + 50));
    // The click that ends a drag doesn't clear the selection.
    fireEvent.click(timeline);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("zooms with a two-finger pinch", async () => {
    const { timeline } = renderView();
    fireEvent.pointerDown(timeline, { pointerId: 1, clientX: 400 });
    fireEvent.pointerDown(timeline, { pointerId: 2, clientX: 600 });
    fireEvent.pointerMove(timeline, { pointerId: 2, clientX: 1400 });
    await waitFor(() => expect(scaleLabels()).not.toContain("2000"));
  });

  it("applies many wheel events in one update per frame", async () => {
    const { timeline } = renderView();
    const start = leftOf(item("Wedding"));
    for (let i = 0; i < 5; i++) fireEvent.wheel(timeline, { deltaX: 20, deltaY: 0 });
    await waitFor(() => expect(leftOf(item("Wedding"))).toBeCloseTo(start - 100));
  });

  it("moves dots with the line instantly; only selection is animated", () => {
    renderView({ selectedId: "wedding" });
    const dot = screen.getByTestId("timeline").querySelector<HTMLElement>('[data-dot="wedding"]')!;
    expect(dot.className).not.toMatch(/transition-all/);
    expect(dot.className).toMatch(/transition-\[scale,box-shadow\]/);
    expect(dot.style.scale).toBe("1.35");
    expect(leftOf(dot) + 8).toBeCloseTo(leftOf(item("Wedding")));
  });

  it("has zoom, Home, Today and Fit all buttons", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    // More years fit on screen: some from before 2000 appear.
    await waitFor(() => expect(scaleLabels().some((label) => Number(label) < 2000)).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Fit all" }));
    await waitFor(() => expect(item("Long ago")).toBeInTheDocument());

    // Each step waits for the end state of its animation before the next click.
    const years = Array.from({ length: 11 }, (_, i) => String(2000 + i));
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => expect(scaleLabels().filter(Boolean)).toEqual(years));

    // 10 years / 1.6 = 6.25 years around 2005 once the zoom has finished.
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() =>
      expect(scaleLabels().filter(Boolean)).toEqual(["2002", "2003", "2004", "2005", "2006", "2007", "2008"]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(scaleLabels().join(" ")).toContain(String(new Date().getFullYear())));
  });

  it("moves to the new home range when it changes", async () => {
    const { rerender, onSelect, onAdd } = renderView();
    const newHome = { start: new Date(1925, 0, 1), end: new Date(1940, 0, 1) };
    rerender(
      <TimelineView
        events={events}
        categories={[school]}
        home={newHome}
        selectedId={null}
        onSelect={onSelect}
        onAdd={onAdd}
      />,
    );
    await waitFor(() => expect(item("Long ago")).toBeInTheDocument());
  });
});
