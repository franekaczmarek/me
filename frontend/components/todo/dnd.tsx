"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/todo/types";

/** Drop targets carry `data-drop-date`: a YYYY-MM-DD day, or "inbox". */
export const INBOX = "inbox";
const THRESHOLD = 5;

type Ctx = {
  start: (e: React.PointerEvent, task: Task) => void;
  dragging: Task | null;
  over: string | null;
};

const DragContext = createContext<Ctx>({ start: () => {}, dragging: null, over: null });

export const useDrag = () => useContext(DragContext);

/** True while a dragged task hovers the target with this id. */
export function useIsOver(target: string) {
  const { dragging, over } = useDrag();
  return dragging !== null && over === target;
}

type Props = {
  onDrop: (task: Task, plannedDate: string | null) => void;
  children: React.ReactNode;
};

/**
 * Pointer-based drag and drop (mouse, pen and touch). The floating card follows the pointer
 * through a transform set directly on the element, so dragging never waits for React.
 */
export function DragProvider({ onDrop, children }: Props) {
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const session = useRef<{ task: Task; x: number; y: number; started: boolean; over: string | null } | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  });
  useEffect(() => () => cleanup.current(), []);

  const place = (x: number, y: number) => {
    if (ghost.current) ghost.current.style.transform = `translate3d(${x + 12}px, ${y - 18}px, 0) rotate(-2deg)`;
  };

  const start = useCallback((e: React.PointerEvent, task: Task) => {
    if (e.button !== 0) return;
    e.preventDefault();
    session.current = { task, x: e.clientX, y: e.clientY, started: false, over: null };

    const move = (ev: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      if (!s.started) {
        if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < THRESHOLD) return;
        s.started = true;
        setDragging(s.task);
      }
      place(ev.clientX, ev.clientY);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop-date]");
      const id = target?.dataset.dropDate ?? null;
      if (id !== s.over) {
        s.over = id;
        setOver(id);
      }
    };

    const end = () => {
      const s = session.current;
      cleanup.current();
      if (!s?.started) return;
      const current = s.task.planned_date ?? INBOX;
      if (s.over && s.over !== current) onDropRef.current(s.task, s.over === INBOX ? null : s.over);
      // The click that ends a drag must not open the task.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      session.current = null;
      setDragging(null);
      setOver(null);
    };
  }, []);

  // Position the card as soon as it appears (before the next pointer move).
  useEffect(() => {
    const s = session.current;
    if (dragging && s) place(s.x, s.y);
  }, [dragging]);

  return (
    <DragContext.Provider value={{ start, dragging, over }}>
      {children}
      {dragging && (
        <div
          ref={ghost}
          aria-hidden
          data-testid="drag-ghost"
          className="pointer-events-none fixed top-0 left-0 z-50 max-w-64 truncate rounded-2xl bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-[0_14px_40px_rgba(120,100,80,0.28)] ring-2 ring-[#ff7a6b] dark:bg-zinc-800 dark:text-zinc-100"
          style={{ willChange: "transform" }}
        >
          {dragging.title}
        </div>
      )}
    </DragContext.Provider>
  );
}

/** Grip that starts dragging a task. Visible on hover, always on touch screens. */
export function DragHandle({ task }: { task: Task }) {
  const { start, dragging } = useDrag();
  return (
    // Pointer-only affordance; keyboard users move tasks with the row actions and the edit form.
    <span
      aria-hidden
      data-drag-handle={task.id}
      title="Drag to another day or the inbox"
      onPointerDown={(e) => start(e, task)}
      className={`flex w-3 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-[3px] opacity-0 transition group-hover:opacity-60 pointer-coarse:opacity-60 ${
        dragging?.id === task.id ? "opacity-60" : ""
      }`}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex gap-[3px]">
          <span className="size-[3px] rounded-full bg-stone-400" />
          <span className="size-[3px] rounded-full bg-stone-400" />
        </span>
      ))}
    </span>
  );
}

/** A section that accepts dropped tasks and lights up while one hovers it. */
export function DropZone({
  id,
  className = "",
  children,
  ...props
}: { id: string } & React.HTMLAttributes<HTMLElement>) {
  const isOver = useIsOver(id);
  return (
    <section
      {...props}
      data-drop-date={id}
      className={`${className} transition-[box-shadow,background-color] ${
        isOver ? "!bg-[#fff1ec] ring-2 ring-[#ffa36c] dark:!bg-[#2d211b]" : ""
      }`}
    >
      {children}
    </section>
  );
}
