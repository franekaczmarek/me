"use client";

import type { Segment, TaskItem } from "@/lib/calendar/grid";
import type { Task } from "@/lib/todo/types";
import { useDrag } from "@/components/todo/dnd";
import { PRIORITY_COLOR } from "@/components/todo/TaskRow";

type Props = {
  segment: Segment<TaskItem>;
  rowOffset: number;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
};

/** A to-do task in a row of days: check it off, open it, or drag it to another day. */
export function TaskChip({ segment, rowOffset, onToggle, onOpen }: Props) {
  const { task } = segment.occurrence;
  const { start, dragging } = useDrag();
  const done = task.status === "done";
  return (
    <div
      style={{ gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`, gridRow: segment.lane + rowOffset }}
      className={`pointer-events-auto mx-1 my-px flex min-w-0 items-center gap-1 rounded-full border border-dashed border-stone-300 bg-white/80 pr-2 pl-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-900/80 ${
        dragging?.id === task.id ? "opacity-40" : ""
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
        onClick={() => onToggle(task)}
        className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] text-[9px] text-white"
        style={{ borderColor: PRIORITY_COLOR[task.priority], background: done ? PRIORITY_COLOR[task.priority] : undefined }}
      >
        {done && "✓"}
      </button>
      <button
        type="button"
        aria-label={`Task: ${task.title}`}
        title="Click to edit, drag to another day"
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") start(e, task);
        }}
        onClick={() => onOpen(task)}
        className={`min-w-0 flex-1 cursor-grab touch-none truncate text-left font-medium ${
          done ? "text-stone-400 line-through dark:text-zinc-500" : "text-stone-700 dark:text-zinc-200"
        }`}
      >
        {task.source_event_id && <span className="mr-0.5">📅</span>}
        {task.source_mail_id && <span className="mr-0.5">📧</span>}
        {task.title}
      </button>
    </div>
  );
}
