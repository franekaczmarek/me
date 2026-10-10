"use client";

import { useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import { withAlpha } from "@/lib/colors";
import type { Priority, Task, TaskInput } from "@/lib/todo/types";
import { PRIORITY_COLOR } from "./TaskRow";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const PRIORITIES: Priority[] = ["low", "normal", "high"];

type Props = {
  task?: Task;
  /** Day for a new task; null = inbox. */
  defaultDate?: string | null;
  submitLabel: string;
  onSave: (input: TaskInput) => Promise<void>;
  onCancel: () => void;
  /** Existing tasks only. Routine occurrences are skipped rather than deleted. */
  onDelete?: () => Promise<void>;
};

export function TaskForm({ task, defaultDate = null, submitLabel, onSave, onCancel, onDelete }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [inInbox, setInInbox] = useState(task ? task.planned_date === null : defaultDate === null);
  const [plannedDate, setPlannedDate] = useState(task?.planned_date ?? defaultDate ?? "");
  const [deadline, setDeadline] = useState(task?.deadline ?? "");
  const [duration, setDuration] = useState(task?.duration_min ? String(task.duration_min) : "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const [fixedDay, setFixedDay] = useState(task?.fixed_day ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Enter a title.");
    if (!inInbox && !plannedDate) return setError("Choose a day, or keep the task in the inbox.");
    const minutes = duration ? Number(duration) : null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      return setError("Duration must be between 1 and 1440 minutes.");
    }
    run(() =>
      onSave({
        title: title.trim(),
        notes,
        planned_date: inInbox ? null : plannedDate,
        deadline: deadline || null,
        duration_min: minutes,
        priority,
        fixed_day: !inInbox && fixedDay,
      }),
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && <Message kind="error">{error}</Message>}
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">When</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={inInbox} onChange={(e) => setInInbox(e.target.checked)} />
          Keep in the inbox (no day yet)
        </label>
        {!inInbox && (
          <>
            <Field label="Day" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fixedDay} onChange={(e) => setFixedDay(e.target.checked)} />
              Must happen this day (the planner won&apos;t move it)
            </label>
          </>
        )}
      </fieldset>

      <Field label="Deadline (optional)" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Duration</span>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Not set</option>
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </option>
          ))}
          {duration && !DURATIONS.includes(Number(duration)) && <option value={duration}>{duration} min</option>}
        </select>
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Priority</legend>
        <div className="flex gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={priority === p}
              onClick={() => setPriority(p)}
              className="flex-1 rounded-full px-3 py-1.5 text-sm font-medium capitalize transition"
              style={
                priority === p
                  ? { background: PRIORITY_COLOR[p], color: "white" }
                  : { background: withAlpha(PRIORITY_COLOR[p], 0.14), color: PRIORITY_COLOR[p] }
              }
            >
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={5000}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Cancel
        </button>
        {onDelete &&
          (confirmDelete ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(onDelete)}
              className="ml-auto rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50"
            >
              {task?.routine_id ? "Skip this time" : "Delete task"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              {task?.routine_id ? "Skip…" : "Delete…"}
            </button>
          ))}
      </div>
    </form>
  );
}
