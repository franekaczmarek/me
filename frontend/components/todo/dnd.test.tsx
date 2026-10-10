import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/todo/types";
import { DragHandle, DragProvider, DropZone, INBOX } from "./dnd";

const task = { id: "t1", title: "Gym", planned_date: "2026-03-04" } as Task;

function setup(onOpen = vi.fn()) {
  const onDrop = vi.fn();
  render(
    <DragProvider onDrop={onDrop}>
      <div>
        <DragHandle task={task} />
        <button onClick={onOpen}>Gym</button>
      </div>
      <DropZone id="2026-03-05" aria-label="Thursday">
        Thursday
      </DropZone>
      <DropZone id={INBOX} aria-label="Inbox">
        Inbox
      </DropZone>
    </DragProvider>,
  );
  const handle = document.querySelector<HTMLElement>("[data-drag-handle]")!;
  return { onDrop, handle };
}

/** jsdom has no layout: say which element is under the pointer. */
function pointAt(el: Element | null) {
  document.elementFromPoint = vi.fn(() => el) as typeof document.elementFromPoint;
}

function drag(handle: HTMLElement, to: { x: number; y: number }) {
  fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

afterEach(() => {
  // @ts-expect-error cleaning up the stub
  delete document.elementFromPoint;
});

describe("drag and drop", () => {
  it("drops a task on another day", () => {
    const { onDrop, handle } = setup();
    pointAt(screen.getByRole("region", { name: "Thursday" }));
    drag(handle, { x: 50, y: 80 });
    expect(screen.getByTestId("drag-ghost")).toHaveTextContent("Gym");
    expect(screen.getByRole("region", { name: "Thursday" }).className).toMatch(/ring-2/);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onDrop).toHaveBeenCalledWith(task, "2026-03-05");
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });

  it("drops a task into the inbox", () => {
    const { onDrop, handle } = setup();
    pointAt(screen.getByRole("region", { name: "Inbox" }));
    drag(handle, { x: 50, y: 80 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onDrop).toHaveBeenCalledWith(task, null);
  });

  it("ignores tiny movements (that's a click) and drops outside any target", () => {
    const { onDrop, handle } = setup();
    pointAt(screen.getByRole("region", { name: "Thursday" }));
    drag(handle, { x: 2, y: 2 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1 });

    pointAt(null);
    drag(handle, { x: 100, y: 100 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does nothing when dropped on the day it is already on", () => {
    const { onDrop, handle } = setup();
    const sameDay = document.createElement("section");
    sameDay.dataset.dropDate = "2026-03-04";
    document.body.append(sameDay);
    pointAt(sameDay);
    drag(handle, { x: 50, y: 50 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
    sameDay.remove();
  });

  it("swallows the click that ends a drag", () => {
    const onOpen = vi.fn();
    const { handle } = setup(onOpen);
    pointAt(screen.getByRole("region", { name: "Thursday" }));
    drag(handle, { x: 50, y: 80 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Gym" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("only starts with the primary button", () => {
    const { handle } = setup();
    fireEvent.pointerDown(handle, { button: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });
});
