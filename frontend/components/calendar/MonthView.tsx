"use client";

import type { DayOff } from "@/lib/calendar/api";
import { formatTime, longDay } from "@/lib/calendar/format";
import { type CalendarItem, hiddenPerDay, isTask, monthGrid, type Segment, type TaskItem, taskItems, weekSegments } from "@/lib/calendar/grid";
import type { Occurrence } from "@/lib/calendar/types";
import { darken, lighten, withAlpha } from "@/lib/colors";
import type { Task } from "@/lib/todo/types";
import { useIsOver } from "@/components/todo/dnd";
import { TaskChip } from "./TaskChip";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Event lanes shown per week before "+N more". */
const LANES = 3;

type Props = {
  /** Any day of the month to show. */
  month: string;
  today: string;
  occurrences: Occurrence[];
  tasks: Task[];
  daysOff: DayOff[];
  onCreate: (day: string) => void;
  onOpen: (occurrence: Occurrence) => void;
  onToggleTask: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  /** Opens the day (its number was clicked). */
  onShowDay: (day: string) => void;
  /** Lists everything on a day ("+N more"). */
  onListDay: (day: string) => void;
};

export function MonthView({ month, today, occurrences, tasks, daysOff, onCreate, onOpen, onToggleTask, onOpenTask, onShowDay, onListDay }: Props) {
  const weeks = monthGrid(month);
  const items: CalendarItem[] = [...occurrences, ...taskItems(tasks)];
  const inMonth = month.slice(0, 7);
  const dayOff = (day: string) => daysOff.find((d) => d.start_date <= day && d.end_date >= day);

  return (
    <div role="grid" aria-label="Month" className="flex min-h-[36rem] flex-1 flex-col overflow-hidden rounded-3xl border border-stone-100 bg-white shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900">
      <div role="row" className="grid grid-cols-7 border-b border-stone-100 dark:border-zinc-800">
        {WEEKDAYS.map((name) => (
          <div role="columnheader" key={name} className="py-2 text-center text-[11px] font-semibold tracking-wide text-stone-400 uppercase">
            {name}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const segments = weekSegments(week, items);
        const hidden = hiddenPerDay(segments, LANES);
        return (
          <div role="row" key={week[0]} className="relative min-h-[6.25rem] flex-1 border-b border-stone-100 last:border-b-0 dark:border-zinc-800">
            <div className="absolute inset-0 grid grid-cols-7">
              {week.map((day) => {
                const off = dayOff(day);
                const outside = day.slice(0, 7) !== inMonth;
                return (
                  <DayCell
                    key={day}
                    day={day}
                    onClick={() => onCreate(day)}
                    className={off ? "bg-[#f2c14e]/10" : outside ? "bg-stone-50/50 dark:bg-zinc-950/30" : ""}
                  >
                    <button
                      type="button"
                      aria-label={`Show ${longDay(day)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowDay(day);
                      }}
                      className={`grid size-6 shrink-0 place-items-center rounded-full text-xs transition hover:bg-stone-100 dark:hover:bg-zinc-800 ${
                        day === today
                          ? "font-semibold text-[#ff7a6b] ring-2 ring-[#ff7a6b]"
                          : outside
                            ? "text-stone-300 dark:text-zinc-600"
                            : "text-stone-600 dark:text-zinc-300"
                      }`}
                    >
                      {Number(day.slice(8))}
                    </button>
                    {off && (
                      <span title={off.label || "Day off"} className="mt-0.5 truncate text-[10px] text-[#9a7612] dark:text-[#f2c14e]">
                        🌴 {off.label || "Day off"}
                      </span>
                    )}
                  </DayCell>
                );
              })}
            </div>

            <div className="pointer-events-none relative grid grid-cols-7 grid-rows-[1.9rem_repeat(4,1.4rem)] pb-1">
              {segments
                .filter((s) => s.lane < LANES)
                .map((s) => (
                  <Item key={`${s.occurrence.id}-${s.occurrence.occurrence_date}`} segment={s} rowOffset={2} onOpen={onOpen} onToggleTask={onToggleTask} onOpenTask={onOpenTask} />
                ))}
              {hidden.map((count, col) =>
                count ? (
                  <button
                    key={week[col]}
                    type="button"
                    onClick={() => onListDay(week[col])}
                    style={{ gridColumn: col + 1, gridRow: LANES + 2 }}
                    className="pointer-events-auto mx-1 truncate rounded-full px-2 text-left text-[11px] font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-zinc-800"
                  >
                    +{count} more
                  </button>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A day of the grid: click to add an event; tasks can be dropped on it. */
function DayCell({ day, className, onClick, children }: { day: string; className: string; onClick: () => void; children: React.ReactNode }) {
  const isOver = useIsOver(day);
  return (
    <div
      role="gridcell"
      aria-label={longDay(day)}
      data-day={day}
      data-drop-date={day}
      onClick={onClick}
      className={`flex cursor-pointer items-start gap-1 border-r border-stone-100 p-1.5 last:border-r-0 hover:bg-stone-50/80 dark:border-zinc-800 dark:hover:bg-zinc-800/40 ${className} ${
        isOver ? "!bg-[#fff1ec] ring-2 ring-[#ffa36c] ring-inset dark:!bg-[#2d211b]" : ""
      }`}
    >
      {children}
    </div>
  );
}

type ItemProps = {
  segment: Segment<CalendarItem>;
  rowOffset: number;
  onOpen: (o: Occurrence) => void;
  onToggleTask: (task: Task) => void;
  onOpenTask: (task: Task) => void;
};

/** An event bar or a task chip. */
export function Item({ segment, rowOffset, onOpen, onToggleTask, onOpenTask }: ItemProps) {
  const item = segment.occurrence;
  if (isTask(item)) {
    return <TaskChip segment={segment as Segment<TaskItem>} rowOffset={rowOffset} onToggle={onToggleTask} onOpen={onOpenTask} />;
  }
  return <EventBar segment={segment as Segment<Occurrence>} rowOffset={rowOffset} onOpen={onOpen} />;
}

/** An event in a row of days: a tinted bar (all-day / several days) or a dot with the time. Rows below `rowOffset` hold other content. */
export function EventBar({ segment, onOpen, rowOffset = 2 }: { segment: Segment; onOpen: (o: Occurrence) => void; rowOffset?: number }) {
  const { occurrence: o, startCol, endCol, lane, continuesBefore, continuesAfter } = segment;
  const bar = o.all_day || o.start_date !== o.end_date;
  const place = { gridColumn: `${startCol + 1} / ${endCol + 2}`, gridRow: lane + rowOffset };
  const label = `${o.title}${o.start_time ? `, ${formatTime(o.start_time)}` : ""}`;

  if (!bar) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => onOpen(o)}
        style={place}
        className="pointer-events-auto mx-1 flex min-w-0 items-center gap-1.5 rounded-full px-1.5 text-left text-[11px] text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />
        <span className="shrink-0 text-stone-400 tabular-nums">{formatTime(o.start_time!)}</span>
        <span className="truncate font-medium">{o.title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onOpen(o)}
      style={
        {
          ...place,
          background: withAlpha(o.color, 0.18),
          "--label": darken(o.color, 0.45),
          "--label-dark": lighten(o.color, 0.45),
        } as React.CSSProperties
      }
      className={`pointer-events-auto my-px truncate px-2 text-left text-[11px] font-semibold text-(--label) transition hover:brightness-95 dark:text-(--label-dark) ${
        continuesBefore ? "ml-0 rounded-l-none" : "ml-1 rounded-l-full"
      } ${continuesAfter ? "mr-0 rounded-r-none" : "mr-1 rounded-r-full"}`}
    >
      {o.start_time && <span className="mr-1 font-normal opacity-70">{formatTime(o.start_time)}</span>}
      {o.title}
    </button>
  );
}
