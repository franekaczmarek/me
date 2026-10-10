"use client";

import { useEffect, useState } from "react";
import { Message } from "@/components/ui";
import { withAlpha } from "@/lib/colors";
import { todoApi } from "@/lib/todo/api";
import { describeRule, formatMinutes } from "@/lib/todo/format";
import type { Routine, RoutineInput, RoutineKind } from "@/lib/todo/types";
import { PRIORITY_COLOR } from "./TaskRow";

const KINDS: [RoutineKind, string][] = [
  ["daily", "Every day"],
  ["weekdays", "Weekdays (Mon–Fri)"],
  ["weekly", "On chosen days"],
  ["interval", "Every few days"],
  ["monthly", "Once a month"],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DURATIONS = [10, 15, 30, 45, 60, 90, 120];
const input =
  "rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-stone-400 dark:border-zinc-700 dark:bg-zinc-900";

/** Expandable list of recurring items that show up on their days automatically. */
export function RoutinesCard({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    todoApi
      .routines()
      .then(setRoutines)
      .catch((e: Error) => setError(`Could not load routines: ${e.message}`));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setRoutines(await todoApi.routines());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = routines?.filter((r) => r.active).length ?? 0;

  return (
    <section
      aria-label="Routines"
      className="rounded-3xl border border-stone-100 bg-white p-4 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline justify-between px-3 text-left"
      >
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Routines</h2>
        <span className="flex items-center gap-2 text-xs text-stone-500">
          {routines ? `${active} active` : ""}
          <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            ▾
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 px-1">
          {error && <Message kind="error">{error}</Message>}
          {routines?.length === 0 && <p className="px-2 text-sm text-stone-500">Nothing recurring yet.</p>}
          <ul className="flex flex-col gap-1">
            {routines?.map((r) => (
              <li
                key={r.id}
                className={`flex items-center gap-3 rounded-2xl px-2 py-2 ${r.active ? "" : "opacity-50"}`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[r.priority] }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{r.title}</p>
                  <p className="text-xs text-stone-500">
                    {describeRule(r)}
                    {r.duration_min ? ` · ${formatMinutes(r.duration_min)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.active}
                  aria-label={`${r.title} active`}
                  onClick={() => run(() => todoApi.updateRoutine(r.id, { active: !r.active }))}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition ${r.active ? "bg-[#4cc9a0]" : "bg-stone-200 dark:bg-zinc-700"}`}
                >
                  <span
                    className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform ${r.active ? "translate-x-4" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${r.title}`}
                  onClick={() => run(() => todoApi.deleteRoutine(r.id))}
                  className="rounded-full px-2 text-stone-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-zinc-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <RoutineForm onCreate={(value) => run(() => todoApi.createRoutine(value))} />
        </div>
      )}
    </section>
  );
}

function RoutineForm({ onCreate }: { onCreate: (input: RoutineInput) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RoutineKind>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [intervalDays, setIntervalDays] = useState("2");
  const [monthDay, setMonthDay] = useState("1");
  const [duration, setDuration] = useState("");
  const [priority, setPriority] = useState<RoutineInput["priority"]>("normal");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Enter a title.");
    if (kind === "weekly" && weekdays.length === 0) return setError("Pick at least one day.");
    setError(null);
    await onCreate({
      title: title.trim(),
      kind,
      weekdays: kind === "weekly" ? weekdays : null,
      interval_days: kind === "interval" ? Number(intervalDays) : null,
      month_day: kind === "monthly" ? Number(monthDay) : null,
      duration_min: duration ? Number(duration) : null,
      priority,
    });
    setTitle("");
    setWeekdays([]);
  }

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-stone-50 p-3 dark:bg-zinc-800/50" noValidate>
      <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-200">New routine</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input aria-label="Routine title" placeholder="e.g. Workout" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={input} />
      <select aria-label="Repeats" value={kind} onChange={(e) => setKind(e.target.value as RoutineKind)} className={input}>
        {KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {kind === "weekly" && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
          {DAYS.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-pressed={weekdays.includes(i + 1)}
              onClick={() => toggleDay(i + 1)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                weekdays.includes(i + 1) ? "bg-[#56a8f5] text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {kind === "interval" && (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-zinc-300">
          Every
          <input aria-label="Every how many days" type="number" min={1} max={366} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} className={`${input} w-20`} />
          days
        </label>
      )}
      {kind === "monthly" && (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-zinc-300">
          On day
          <input aria-label="Day of the month" type="number" min={1} max={31} value={monthDay} onChange={(e) => setMonthDay(e.target.value)} className={`${input} w-20`} />
        </label>
      )}
      <div className="flex gap-2">
        <select aria-label="Routine duration" value={duration} onChange={(e) => setDuration(e.target.value)} className={`${input} flex-1`}>
          <option value="">No duration</option>
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {formatMinutes(m)}
            </option>
          ))}
        </select>
        {(["low", "normal", "high"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={priority === p}
            aria-label={`${p} priority`}
            onClick={() => setPriority(p)}
            className="size-8 rounded-full transition"
            style={{
              background: priority === p ? PRIORITY_COLOR[p] : withAlpha(PRIORITY_COLOR[p], 0.18),
              boxShadow: priority === p ? `0 0 0 3px ${withAlpha(PRIORITY_COLOR[p], 0.3)}` : undefined,
            }}
          />
        ))}
      </div>
      <button
        type="submit"
        className="self-start rounded-full bg-stone-800 px-4 py-1.5 text-sm font-medium text-white transition hover:-translate-y-0.5 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Add routine
      </button>
    </form>
  );
}
