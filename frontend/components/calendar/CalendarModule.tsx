"use client";

import { useEffect, useState } from "react";
import { Button, Message } from "@/components/ui";
import { type DayOff, type WorkSchedule, calendarApi } from "@/lib/calendar/api";
import { formatMinutes, parseDay } from "@/lib/todo/format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RANGE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const card =
  "rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900";
const input =
  "rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-stone-400 dark:border-zinc-700 dark:bg-zinc-900";

/** Work calendar for now: when you work and how much time you want for tasks (used to plan to-dos). */
export function CalendarModule() {
  return (
    <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:p-6 dark:bg-zinc-950">
      <div className="mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-2">
        <ScheduleCard />
        <DaysOffCard />
      </div>
      <p className="mx-auto max-w-4xl text-center text-xs text-stone-500">
        The full calendar view comes later. For now this tells your to-do list (and its planner) how much time each day has.
      </p>
    </div>
  );
}

function ScheduleCard() {
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    calendarApi
      .schedule()
      .then(setSchedule)
      .catch((e: Error) => setError(`Could not load your schedule: ${e.message}`));
  }, []);

  if (!schedule) {
    return (
      <section aria-label="Work schedule" className={card}>
        {error ? <Message kind="error">{error}</Message> : <p className="text-sm text-stone-500">Loading…</p>}
      </section>
    );
  }

  const set = (change: Partial<WorkSchedule>) => {
    setInfo(null);
    setSchedule({ ...schedule, ...change });
  };
  const toggleDay = (d: number) =>
    set({
      work_days: schedule.work_days.includes(d)
        ? schedule.work_days.filter((x) => x !== d)
        : [...schedule.work_days, d].sort(),
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!schedule) return;
    if (schedule.work_end.slice(0, 5) <= schedule.work_start.slice(0, 5)) {
      return setError("Work must end after it starts.");
    }
    setError(null);
    setPending(true);
    try {
      setSchedule(await calendarApi.saveSchedule(schedule));
      setInfo("Schedule saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Work schedule" className={card}>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Work schedule</h2>
        {error && <Message kind="error">{error}</Message>}
        {info && <Message kind="info">{info}</Message>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-stone-600 dark:text-zinc-300">Work days</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={schedule.work_days.includes(i + 1)}
                onClick={() => toggleDay(i + 1)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  schedule.work_days.includes(i + 1)
                    ? "bg-[#56a8f5] text-white shadow-[0_4px_12px_rgba(86,168,245,0.35)]"
                    : "bg-stone-100 text-stone-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-zinc-300">
          <label className="flex items-center gap-2">
            From
            <input
              type="time"
              aria-label="Work starts"
              value={schedule.work_start.slice(0, 5)}
              onChange={(e) => set({ work_start: e.target.value })}
              className={input}
            />
          </label>
          <label className="flex items-center gap-2">
            to
            <input
              type="time"
              aria-label="Work ends"
              value={schedule.work_end.slice(0, 5)}
              onChange={(e) => set({ work_end: e.target.value })}
              className={input}
            />
          </label>
        </div>

        <TimeForTasks
          label="Time for tasks on a work day"
          minutes={schedule.task_minutes_workday}
          onChange={(m) => set({ task_minutes_workday: m })}
        />
        <TimeForTasks
          label="Time for tasks on a day off"
          minutes={schedule.task_minutes_day_off}
          onChange={(m) => set({ task_minutes_day_off: m })}
        />

        <Button type="submit" disabled={pending} className="self-start rounded-full">
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </form>
    </section>
  );
}

function TimeForTasks({ label, minutes, onChange }: { label: string; minutes: number; onChange: (m: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between text-stone-600 dark:text-zinc-300">
        {label}
        <span className="font-semibold text-stone-800 dark:text-zinc-100">{formatMinutes(minutes)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={0}
        max={720}
        step={15}
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[#ff7a6b]"
      />
    </label>
  );
}

function DaysOffCard() {
  const [daysOff, setDaysOff] = useState<DayOff[] | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    calendarApi
      .daysOff()
      .then(setDaysOff)
      .catch((e: Error) => setError(`Could not load days off: ${e.message}`));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setDaysOff(await calendarApi.daysOff());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!start) return setError("Choose the first day off.");
    const last = end || start;
    if (last < start) return setError("The last day can't be before the first one.");
    if (await run(() => calendarApi.addDayOff({ start_date: start, end_date: last, label: label.trim() }))) {
      setStart("");
      setEnd("");
      setLabel("");
    }
  }

  const span = (d: DayOff) =>
    d.start_date === d.end_date
      ? RANGE.format(parseDay(d.start_date))
      : `${RANGE.format(parseDay(d.start_date))} – ${RANGE.format(parseDay(d.end_date))}`;

  return (
    <section aria-label="Days off" className={card}>
      <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Days off</h2>
      <p className="mt-1 text-xs text-stone-500">Vacations and holidays get your day-off time for tasks.</p>
      {error && (
        <div className="mt-3">
          <Message kind="error">{error}</Message>
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-1">
        {daysOff?.length === 0 && <li className="text-sm text-stone-500">No days off planned.</li>}
        {daysOff?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-[#f2c14e]/10 px-3 py-2">
            <span aria-hidden>🌴</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{d.label || "Day off"}</p>
              <p className="text-xs text-stone-500">{span(d)}</p>
            </div>
            <button
              type="button"
              aria-label={`Remove ${d.label || "day off"} (${span(d)})`}
              onClick={() => run(() => calendarApi.deleteDayOff(d.id))}
              className="rounded-full px-2 text-stone-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate className="mt-4 flex flex-col gap-2 rounded-2xl bg-stone-50 p-3 dark:bg-zinc-800/50">
        <input aria-label="What is it" placeholder="e.g. Summer vacation" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} className={input} />
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600 dark:text-zinc-300">
          <input type="date" aria-label="First day off" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
          –
          <input type="date" aria-label="Last day off" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={input} />
        </div>
        <button
          type="submit"
          className="self-start rounded-full bg-stone-800 px-4 py-1.5 text-sm font-medium text-white transition hover:-translate-y-0.5 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add days off
        </button>
      </form>
    </section>
  );
}
