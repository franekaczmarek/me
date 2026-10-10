"use client";

import { withAlpha } from "@/lib/colors";
import { deadlineLabel, formatMinutes } from "@/lib/todo/format";
import type { Priority, Task } from "@/lib/todo/types";

export const PRIORITY_COLOR: Record<Priority, string> = { high: "#ff7a6b", normal: "#56a8f5", low: "#4cc9a0" };

type Props = {
  task: Task;
  today: string;
  /** On a past day: offer moving it to today or back to the inbox. */
  overdue?: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onMove?: (task: Task, plannedDate: string | null) => void;
};

const chip = "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

export function TaskRow({ task, today, overdue, onToggle, onOpen, onMove }: Props) {
  const done = task.status === "done";
  const color = PRIORITY_COLOR[task.priority];
  const deadline = task.deadline && !done ? deadlineLabel(task.deadline, today) : null;

  return (
    <li
      data-task-id={task.id}
      className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-stone-50 dark:hover:bg-zinc-800/60"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
        onClick={() => onToggle(task)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full border-[2.5px] text-white transition hover:scale-110"
        style={{ borderColor: color, background: done ? color : "transparent" }}
      >
        {done && (
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${
          done ? "text-stone-400 line-through decoration-2 dark:text-zinc-500" : "text-stone-800 dark:text-zinc-100"
        }`}
      >
        {task.routine_id && (
          <span aria-label="Recurring" title="Recurring" className="mr-1.5 text-stone-400">
            ↻
          </span>
        )}
        {task.fixed_day && (
          <span aria-label="Fixed to this day" title="Must happen this day" className="mr-1.5">
            📌
          </span>
        )}
        {task.title}
      </button>

      {deadline && (
        <span
          className={chip}
          style={
            deadline.urgent
              ? { background: withAlpha("#ff7a6b", 0.16), color: "#c2493d" }
              : { background: withAlpha("#a8a29e", 0.16), color: "#78716c" }
          }
        >
          {deadline.text}
        </span>
      )}
      {task.duration_min && (
        <span className={chip} style={{ background: withAlpha(color, 0.14), color }}>
          {formatMinutes(task.duration_min)}
        </span>
      )}

      {overdue && onMove && (
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onMove(task, today)}
            className={`${chip} bg-white text-stone-600 shadow-sm ring-1 ring-stone-200 hover:ring-stone-300 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700`}
          >
            Move to today
          </button>
          <button
            type="button"
            onClick={() => onMove(task, null)}
            className={`${chip} bg-white text-stone-600 shadow-sm ring-1 ring-stone-200 hover:ring-stone-300 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700`}
          >
            To inbox
          </button>
        </span>
      )}
    </li>
  );
}
