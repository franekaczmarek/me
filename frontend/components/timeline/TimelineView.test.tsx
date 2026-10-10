import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineItem } from "@/lib/timeline/items";
import { TimelineView } from "./TimelineView";

// Fake vis-timeline: records calls and lets tests fire its events.
const vis = vi.hoisted(() => {
  const instances: FakeTimeline[] = [];
  class FakeTimeline {
    handlers: Record<string, (props: unknown) => void> = {};
    setItems = vi.fn();
    setSelection = vi.fn();
    setWindow = vi.fn();
    moveTo = vi.fn();
    fit = vi.fn();
    destroy = vi.fn();
    constructor(
      public container: HTMLElement,
      public items: unknown,
      public options: Record<string, unknown>,
    ) {
      instances.push(this);
    }
    on(event: string, handler: (props: unknown) => void) {
      this.handlers[event] = handler;
    }
  }
  return { instances, FakeTimeline };
});
vi.mock("vis-timeline/standalone", () => ({ Timeline: vis.FakeTimeline }));
vi.mock("vis-timeline/styles/vis-timeline-graph2d.min.css", () => ({}));

const home = { start: new Date(1988, 0, 1), end: new Date(2029, 0, 1) };
const item = (id: string): TimelineItem => ({
  id,
  content: id,
  start: new Date(2015, 0, 1),
  type: "point",
  className: "me-item",
  style: "",
  title: id,
});

async function renderView(props: Partial<React.ComponentProps<typeof TimelineView>> = {}) {
  const onSelect = vi.fn();
  const onAdd = vi.fn();
  const view = render(
    <TimelineView items={[item("a")]} home={home} selectedId={null} onSelect={onSelect} onAdd={onAdd} {...props} />,
  );
  await waitFor(() => expect(vis.instances).toHaveLength(1));
  return { ...view, onSelect, onAdd, timeline: vis.instances[0] };
}

beforeEach(() => {
  vis.instances.length = 0;
});

describe("TimelineView", () => {
  it("creates the timeline in its container, opened on the home window", async () => {
    const { timeline } = await renderView();
    expect(timeline.container).toBe(screen.getByTestId("timeline"));
    expect(timeline.options).toMatchObject({ start: home.start, end: home.end, selectable: true });
    expect(timeline.items).toEqual([item("a")]);
  });

  it("rebuilds with the current items when a hidden route is shown again", async () => {
    const onSelect = vi.fn();
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <TimelineView items={[item("a"), item("b")]} home={home} selectedId="b" onSelect={onSelect} onAdd={vi.fn()} />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    await waitFor(() => expect(vis.instances).toHaveLength(1));
    rerender(view("hidden"));
    await waitFor(() => expect(vis.instances[0].destroy).toHaveBeenCalled());
    rerender(view("visible"));
    await waitFor(() => expect(vis.instances).toHaveLength(2));
    expect(vis.instances[1].items).toEqual([item("a"), item("b")]);
    expect(vis.instances[1].setSelection).toHaveBeenCalledWith(["b"]);
  });

  it("moves to the new home window when it changes", async () => {
    const { timeline, rerender, onSelect } = await renderView();
    const newHome = { start: new Date(1960, 0, 1), end: new Date(2030, 0, 1) };
    // Same window, new objects: no jump.
    rerender(<TimelineView items={[item("a")]} home={{ ...home }} selectedId={null} onSelect={onSelect} onAdd={vi.fn()} />);
    rerender(<TimelineView items={[item("a")]} home={newHome} selectedId={null} onSelect={onSelect} onAdd={vi.fn()} />);
    await waitFor(() => expect(timeline.setWindow).toHaveBeenCalledTimes(1));
    expect(timeline.setWindow).toHaveBeenCalledWith(newHome.start.getTime(), newHome.end.getTime());
  });

  it("reports selection changes", async () => {
    const { timeline, onSelect } = await renderView();
    timeline.handlers.select({ items: ["a"] });
    expect(onSelect).toHaveBeenCalledWith("a");
    timeline.handlers.select({ items: [] });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("pushes new items and the selection to the timeline", async () => {
    const { timeline, rerender, onSelect } = await renderView();
    rerender(<TimelineView items={[item("a"), item("b")]} home={home} selectedId="b" onSelect={onSelect} onAdd={vi.fn()} />);
    await waitFor(() => expect(timeline.setItems).toHaveBeenLastCalledWith([item("a"), item("b")]));
    expect(timeline.setSelection).toHaveBeenLastCalledWith(["b"]);
  });

  it("asks to add an event when an empty spot is double-clicked", async () => {
    const { timeline, onAdd } = await renderView();
    timeline.handlers.doubleClick({ item: "a", time: new Date(2015, 5, 7) });
    expect(onAdd).not.toHaveBeenCalled();
    timeline.handlers.doubleClick({ item: null, time: new Date(2015, 5, 7, 18) });
    expect(onAdd).toHaveBeenCalledWith("2015-06-07");
  });

  it("has Home, Today and Fit all controls", async () => {
    const { timeline } = await renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: "Home" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(timeline.setWindow).toHaveBeenCalledWith(home.start, home.end);
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(timeline.moveTo).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(timeline.fit).toHaveBeenCalled();
  });

  it("destroys the timeline on unmount", async () => {
    const { timeline, unmount } = await renderView();
    unmount();
    expect(timeline.destroy).toHaveBeenCalled();
  });
});
