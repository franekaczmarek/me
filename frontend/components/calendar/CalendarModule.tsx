"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Message } from "@/components/ui";
import { calendarApi, type DayOff } from "@/lib/calendar/api";
import { toInput } from "@/lib/calendar/events";
import { formatTime, fullDay, longDay, monthTitle, weekTitle } from "@/lib/calendar/format";
import { addMonths, minutesOf, monthGrid, onDay, startOfMonth, startOfWeek, timeOf } from "@/lib/calendar/grid";
import type { CalendarEvent, EventInput, Occurrence, Summary } from "@/lib/calendar/types";
import { localToday, todoApi } from "@/lib/todo/api";
import { addDays, daysBetween } from "@/lib/todo/format";
import type { Task, TaskInput } from "@/lib/todo/types";
import { DragProvider } from "@/components/todo/dnd";
import { TaskForm } from "@/components/todo/TaskForm";
import { TaskRow } from "@/components/todo/TaskRow";
import { type EventDefaults, EventForm } from "./EventForm";
import { MonthView } from "./MonthView";
import { SummaryCard, UpcomingCard } from "./SideCards";
import { SuggestDialog } from "./SuggestDialog";
import { type TimeChange, TimeGrid } from "./TimeGrid";
import { WorkSettings } from "./WorkSettings";

type View = "month" | "week" | "day";
const VIEWS: { value: View; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];
const VIEW_KEY = "me.calendar.view";
/** Used until the work schedule loads (or if it can't). */
const DEFAULT_HOURS = { start: 9 * 60, end: 17 * 60 };

function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "week" || v === "day" ? v : "month";
  } catch {
    return "month";
  }
}

/** First and last day shown, and the toolbar title. */
function range(view: View, cursor: string): { first: string; last: string; title: string } {
  if (view === "day") return { first: cursor, last: cursor, title: fullDay(cursor) };
  if (view === "week") {
    const first = startOfWeek(cursor);
    const last = addDays(first, 6);
    return { first, last, title: weekTitle(first, last) };
  }
  const weeks = monthGrid(cursor);
  return { first: weeks[0][0], last: weeks[5][6], title: monthTitle(cursor) };
}

function step(view: View, cursor: string, by: number): string {
  if (view === "month") return addMonths(cursor, by);
  return addDays(cursor, by * (view === "week" ? 7 : 1));
}

type Panel =
  | { mode: "new"; defaults: EventDefaults }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "day"; day: string }
  | { mode: "task"; task: Task }
  | { mode: "settings" }
  | null;

type Data = { occurrences: Occurrence[]; tasks: Task[]; daysOff: DayOff[] };

const panelCard =
  "flex flex-col gap-4 rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.08)] dark:border-zinc-800 dark:bg-zinc-900";
const secondary =
  "rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const round =
  "grid size-9 place-items-center rounded-full text-lg text-stone-600 transition hover:bg-white hover:shadow-sm dark:text-zinc-300 dark:hover:bg-zinc-900";

/** A Google-Calendar-like calendar: the month grid in the middle, a month summary and upcoming events on the right. */
export function CalendarModule() {
  const [today] = useState(localToday);
  const [cursor, setCursor] = useState(today);
  const [view, setViewState] = useState<View>(savedView);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [data, setData] = useState<Data | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [attempt, setAttempt] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const sideRef = useRef<HTMLDivElement>(null);

  const { first, last, title } = range(view, cursor);
  const month = startOfMonth(cursor);
  const unit = view === "month" ? "month" : view === "week" ? "week" : "day";

  function setView(next: View) {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering the view is only a convenience.
    }
  }

  // Only the latest load may update the screen (an older, slower one would show the wrong range).
  const latest = useRef(0);
  const reload = useCallback(() => {
    const request = ++latest.current;
    return Promise.all([
      calendarApi.occurrences(first, last),
      todoApi.tasks(first, last),
      calendarApi.daysOff(),
      calendarApi.summary(month, today),
    ]).then(([occurrences, tasks, daysOff, sum]) => {
      if (request !== latest.current) return;
      setData({ occurrences, tasks, daysOff });
      setSummary(sum);
    });
  }, [first, last, month, today]);

  useEffect(() => {
    reload().catch((e: Error) => setError(`Could not load your calendar: ${e.message}`));
  }, [reload, attempt]);

  useEffect(() => {
    calendarApi
      .schedule()
      .then((s) => setHours({ start: minutesOf(s.work_start), end: minutesOf(s.work_end) }))
      .catch(() => {});
  }, []);

  // On small screens the side column sits below the grid: bring an opened panel into view.
  useEffect(() => {
    if (panel) sideRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [panel]);

  async function openEvent(id: string) {
    setActionError(null);
    try {
      setPanel({ mode: "edit", event: await calendarApi.event(id) });
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  /** A dragged event: shows the new time at once, saves the whole event (every repeat moves too), then reloads. */
  async function move(o: Occurrence, change: TimeChange) {
    setActionError(null);
    const start_time = `${timeOf(change.start)}:00`;
    const end_time = `${timeOf(change.end)}:00`;
    setData((d) =>
      d && {
        ...d,
        occurrences: d.occurrences.map((x) =>
          x.id === o.id && x.occurrence_date === o.occurrence_date ? { ...x, start_date: change.date, end_date: change.date, start_time, end_time } : x,
        ),
      },
    );
    try {
      const series = await calendarApi.event(o.id);
      const shift = daysBetween(o.occurrence_date, change.date);
      await calendarApi.saveEvent(o.id, {
        ...toInput(series),
        start_date: addDays(series.start_date, shift),
        end_date: addDays(series.end_date, shift),
        start_time: timeOf(change.start),
        end_time: timeOf(change.end),
      });
    } catch (e) {
      setActionError(`Could not move "${o.title}": ${(e as Error).message}`);
    }
    await reload().catch(() => {});
  }

  /** Runs a task change, then reloads (the server decides what is shown). */
  async function act(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError((e as Error).message);
    }
    await reload().catch(() => {});
  }

  const toggleTask = (task: Task) =>
    act(() => (task.status === "done" ? todoApi.reopenTask(task.id) : todoApi.completeTask(task.id)));

  function moveTask(task: Task, day: string | null) {
    if (!day) return;
    setData((d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, planned_date: day } : t)) });
    act(() => todoApi.updateTask(task.id, { planned_date: day }));
  }

  async function saveTask(input: TaskInput) {
    if (panel?.mode !== "task") return;
    await todoApi.updateTask(panel.task.id, input);
    await reload();
    setPanel(null);
  }

  async function save(input: EventInput) {
    if (panel?.mode === "edit") await calendarApi.saveEvent(panel.event.id, input);
    else await calendarApi.createEvent(input);
    await reload();
    setPanel(null);
  }

  function showDay(day: string) {
    setCursor(day);
    setView("day");
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <Message kind="error">{error}</Message>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <DragProvider onDrop={moveTask}>
      <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:flex-row md:p-6 dark:bg-zinc-950">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCursor(today)} className={secondary}>
              Today
            </button>
            <div className="flex items-center">
              <button type="button" aria-label={`Previous ${unit}`} onClick={() => setCursor(step(view, cursor, -1))} className={round}>
                ‹
              </button>
              <button type="button" aria-label={`Next ${unit}`} onClick={() => setCursor(step(view, cursor, 1))} className={round}>
                ›
              </button>
            </div>
            <h1 className="mr-auto text-xl font-semibold text-stone-800 dark:text-zinc-100">{title}</h1>
            <div role="group" aria-label="View" className="flex rounded-full bg-stone-100 p-1 dark:bg-zinc-800">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  aria-pressed={view === v.value}
                  onClick={() => setView(v.value)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                    view === v.value ? "bg-white text-stone-800 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-stone-500 hover:text-stone-700 dark:text-zinc-400"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPanel({ mode: "new", defaults: { date: first <= today && today <= last ? today : view === "month" ? month : cursor } })}
              className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5"
            >
              New event
            </button>
            <button type="button" onClick={() => setSuggesting(true)} className={secondary}>
              ✨ Prepare tasks
            </button>
            <button type="button" aria-label="Work schedule and days off" title="Work schedule and days off" onClick={() => setPanel({ mode: "settings" })} className={round}>
              ⚙
            </button>
          </div>
          {actionError && <Message kind="error">{actionError}</Message>}
          {!data ? null : view === "month" ? (
            <MonthView
              month={cursor}
              today={today}
              occurrences={data.occurrences}
              tasks={data.tasks}
              daysOff={data.daysOff}
              onCreate={(day) => setPanel({ mode: "new", defaults: { date: day } })}
              onOpen={(o) => openEvent(o.id)}
              onToggleTask={toggleTask}
              onOpenTask={(task) => setPanel({ mode: "task", task })}
              onShowDay={showDay}
              onListDay={(day) => setPanel({ mode: "day", day })}
            />
          ) : (
            <TimeGrid
              key={view}
              days={view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(first, i)) : [cursor]}
              today={today}
              occurrences={data.occurrences}
              tasks={data.tasks}
              daysOff={data.daysOff}
              onToggleTask={toggleTask}
              onOpenTask={(task) => setPanel({ mode: "task", task })}
              workStart={hours.start}
              workEnd={hours.end}
              onCreate={(defaults) => setPanel({ mode: "new", defaults })}
              onOpen={(o) => openEvent(o.id)}
              onMove={move}
              onShowDay={view === "week" ? showDay : undefined}
            />
          )}
          {!data && (
            <p className="p-6 text-sm text-stone-500">Loading your calendar…</p>
          )}
        </div>

        <div ref={sideRef} className="flex w-full scroll-mt-4 flex-col gap-4 md:w-96">
          {panel?.mode === "new" || panel?.mode === "edit" ? (
            <aside aria-label={panel.mode === "new" ? "New event" : "Edit event"} className={panelCard}>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{panel.mode === "new" ? "New event" : "Edit event"}</p>
              <EventForm
                key={panel.mode === "edit" ? panel.event.id : `new-${panel.defaults.date}-${panel.defaults.startTime}-${panel.defaults.endTime}`}
                event={panel.mode === "edit" ? panel.event : undefined}
                defaults={panel.mode === "new" ? panel.defaults : undefined}
                submitLabel={panel.mode === "new" ? "Add event" : "Save changes"}
                onSave={save}
                onCancel={() => setPanel(null)}
                onDelete={
                  panel.mode === "edit"
                    ? async () => {
                        await calendarApi.deleteEvent(panel.event.id);
                        await reload();
                        setPanel(null);
                      }
                    : undefined
                }
              />
            </aside>
          ) : panel?.mode === "task" ? (
            <aside aria-label="Edit task" className={panelCard}>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Edit task</p>
              <TaskForm
                key={panel.task.id}
                task={panel.task}
                submitLabel="Save changes"
                onSave={saveTask}
                onCancel={() => setPanel(null)}
                onDelete={async () => {
                  await todoApi.deleteTask(panel.task.id);
                  await reload();
                  setPanel(null);
                }}
              />
            </aside>
          ) : panel?.mode === "day" ? (
            <DayPanel
              day={panel.day}
              today={today}
              occurrences={onDay(data?.occurrences ?? [], panel.day)}
              tasks={(data?.tasks ?? []).filter((t) => t.planned_date === panel.day)}
              onToggleTask={toggleTask}
              onOpenTask={(task) => setPanel({ mode: "task", task })}
              onOpen={(o) => openEvent(o.id)}
              onAdd={() => setPanel({ mode: "new", defaults: { date: panel.day } })}
              onClose={() => setPanel(null)}
            />
          ) : panel?.mode === "settings" ? (
            <>
              <button type="button" onClick={() => setPanel(null)} className={`${secondary} self-start`}>
                ← Back to summary
              </button>
              <WorkSettings onChanged={() => reload().catch(() => {})} />
            </>
          ) : (
            <>
              <SummaryCard summary={summary?.month ?? null} />
              <UpcomingCard upcoming={summary?.upcoming ?? null} onOpen={(item) => openEvent(item.id)} />
            </>
          )}
        </div>
      </div>
      {suggesting && <SuggestDialog today={today} onClose={() => setSuggesting(false)} onApplied={() => reload().catch(() => {})} />}
    </DragProvider>
  );
}

type DayPanelProps = {
  day: string;
  today: string;
  occurrences: Occurrence[];
  tasks: Task[];
  onToggleTask: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  onOpen: (o: Occurrence) => void;
  onAdd: () => void;
  onClose: () => void;
};

function DayPanel({ day, today, occurrences, tasks, onToggleTask, onOpenTask, onOpen, onAdd, onClose }: DayPanelProps) {
  return (
    <aside aria-label={longDay(day)} className={panelCard}>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">{longDay(day)}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-zinc-800">
          ×
        </button>
      </header>
      {occurrences.length === 0 && tasks.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing planned.</p>
      ) : (
        <ul className="flex flex-col">
          {occurrences.map((o) => (
            <li key={`${o.id}-${o.occurrence_date}`}>
              <button type="button" onClick={() => onOpen(o)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-stone-50 dark:hover:bg-zinc-800/60">
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: o.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{o.title}</span>
                  <span className="block text-xs text-stone-500">
                    {o.all_day ? "All day" : `${formatTime(o.start_time!)} – ${formatTime(o.end_time!)}`}
                    {o.location && ` · ${o.location}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 && (
        <ul aria-label="Tasks" className="-mx-2 flex flex-col">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} today={today} onToggle={onToggleTask} onOpen={onOpenTask} />
          ))}
        </ul>
      )}
      <button type="button" onClick={onAdd} className={`${secondary} self-start`}>
        + Add event
      </button>
    </aside>
  );
}
