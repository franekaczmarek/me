"use client";

import { useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import { type DateParts, fromParts, periodStart, toParts } from "@/lib/timeline/dates";
import type { Category, EventInput, PartialDate } from "@/lib/timeline/types";
import { PartialDateInput } from "./PartialDateInput";

type Props = {
  /** Values to start from: an existing event, or e.g. just a start date for a new one. */
  initial?: Partial<EventInput>;
  categories: Category[];
  submitLabel: string;
  onSave: (input: EventInput) => Promise<void>;
  onCancel: () => void;
};

export function EventForm({ initial = {}, categories, submitLabel, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [categoryId, setCategoryId] = useState(initial.category_id ?? "");
  const [start, setStart] = useState<DateParts>(toParts(initial.start ?? null));
  const [isPeriod, setIsPeriod] = useState(Boolean(initial.end));
  const [end, setEnd] = useState<DateParts>(toParts(initial.end ?? null));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function buildInput(): EventInput {
    if (!title.trim()) throw new Error("Enter a title.");
    const startDate = withLabel(isPeriod ? "Start" : "Date", () => fromParts(start));
    let endDate: PartialDate | null = null;
    if (isPeriod) {
      endDate = withLabel("End", () => fromParts(end));
      if (periodStart(endDate) < periodStart(startDate)) throw new Error("The end can't be before the start.");
    }
    return {
      title: title.trim(),
      description,
      start: startDate,
      end: endDate,
      category_id: categoryId || null,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let input: EventInput;
    try {
      input = buildInput();
    } catch (err) {
      return setError((err as Error).message);
    }
    setPending(true);
    try {
      await onSave(input);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <Message kind="error">{error}</Message>}
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      <PartialDateInput label={isPeriod ? "Start" : "Date"} value={start} onChange={setStart} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPeriod} onChange={(e) => setIsPeriod(e.target.checked)} />
        Period (has an end date)
      </label>
      {isPeriod && <PartialDateInput label="End" value={end} onChange={setEnd} />}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Category</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={20000}
          rows={5}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

function withLabel<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new Error(`${label}: ${(err as Error).message}`);
  }
}
