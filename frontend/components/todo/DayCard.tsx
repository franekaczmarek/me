"use client";

import { dayTitle, formatMinutes } from "@/lib/todo/format";
import type { Day, Task } from "@/lib/todo/types";
import { useIsOver } from "./dnd";
import { QuickAdd } from "./QuickAdd";
import { TaskRow } from "./TaskRow";

type Props = {
  day: Day;
  today: string;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onMove: (task: Task, plannedDate: string | null) => void;
  onAdd: (title: string, plannedDate: string) => Promise<void>;
  ref?: React.Ref<HTMLElement>;
};

/** One day: name + date, how full it is, its tasks and a quick-add line. */
export function DayCard({ day, today, onToggle, onOpen, onMove, onAdd, ref }: Props) {
  const { name, date } = dayTitle(day.date, today);
  const over = day.planned_min > day.capacity_min;
  const fill = day.capacity_min ? Math.min(1, day.planned_min / day.capacity_min) : day.planned_min ? 1 : 0;
  const done = day.tasks.filter((t) => t.status === "done").length;
  // Tasks can be dropped on today and later days, not on past ones.
  const isOver = useIsOver(day.date);

  return (
    <section
      ref={ref}
      aria-label={`${name}, ${date}`}
      data-day={day.date}
      data-drop-date={day.is_overdue ? undefined : day.date}
      className={`rounded-3xl border p-4 shadow-[0_8px_30px_rgba(120,100,80,0.06)] transition-[box-shadow,background-color] ${
        isOver ? "!bg-[#fff1ec] ring-2 ring-[#ffa36c] dark:!bg-[#2d211b]" : ""
      } ${
        day.is_today
          ? "border-transparent bg-white ring-2 ring-[#ff7a6b] shadow-[0_10px_34px_rgba(255,122,107,0.22)] dark:bg-zinc-900"
          : day.is_overdue
            ? "border-[#ffd6cf] bg-[#fff6f4] dark:border-[#5a2f2a] dark:bg-[#2a1b19]"
            : "border-stone-100 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-3">
        <div className="flex items-baseline gap-2">
          <h2 className={`text-lg font-semibold ${day.is_today ? "text-[#e0574a]" : "text-stone-800 dark:text-zinc-100"}`}>
            {name}
          </h2>
          <span className="text-sm text-stone-500 dark:text-zinc-400">{date}</span>
          {day.is_overdue && (
            <span className="rounded-full bg-[#ff7a6b] px-2 py-0.5 text-[11px] font-semibold text-white">Not done</span>
          )}
          {!day.is_work_day && !day.is_overdue && (
            <span className="rounded-full bg-[#f2c14e]/20 px-2 py-0.5 text-[11px] font-medium text-[#9a7414]">Day off</span>
          )}
        </div>
        {!day.is_overdue && (
          <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-zinc-400">
            {day.tasks.length > 0 && (
              <span>
                {done}/{day.tasks.length} done
              </span>
            )}
            <span className={over ? "font-semibold text-[#e0574a]" : undefined}>
              {formatMinutes(day.planned_min)} of {formatMinutes(day.capacity_min)}
            </span>
            <span
              role="meter"
              aria-label="Planned time"
              aria-valuemin={0}
              aria-valuemax={day.capacity_min}
              aria-valuenow={day.planned_min}
              className="h-2 w-20 overflow-hidden rounded-full bg-stone-100 dark:bg-zinc-800"
            >
              <span
                className="block h-full rounded-full transition-[width] duration-300"
                style={{ width: `${fill * 100}%`, background: over ? "#ff7a6b" : "#4cc9a0" }}
              />
            </span>
          </div>
        )}
      </header>

      {day.tasks.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {day.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              overdue={day.is_overdue}
              onToggle={onToggle}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
      {!day.is_overdue && <QuickAdd label={`Add a task on ${name}`} onAdd={(title) => onAdd(title, day.date)} />}
    </section>
  );
}
