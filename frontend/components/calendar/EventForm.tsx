"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import type { CalendarEvent, EventInput, Recurrence } from "@/lib/calendar/types";
import { PALETTE } from "@/lib/colors";
import { addDays, daysBetween } from "@/lib/todo/format";

const REPEATS: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];
const COLOR_NAMES = ["Coral", "Peach", "Butter", "Mint", "Sky", "Lavender", "Rose", "Teal"];

export type EventDefaults = { date: string; startTime?: string; endTime?: string };

type Props = {
  /** The whole event (series) when editing. */
  event?: CalendarEvent;
  defaults?: EventDefaults;
  submitLabel: string;
  onSave: (input: EventInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
};

const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : "");

export function EventForm({ event, defaults, submitLabel, onSave, onCancel, onDelete }: Props) {
  const day = defaults?.date ?? "";
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event ? event.start_time === null : !defaults?.startTime);
  const [startDate, setStartDate] = useState(event?.start_date ?? day);
  const [endDate, setEndDate] = useState(event?.end_date ?? day);
  const [startTime, setStartTime] = useState(hhmm(event?.start_time) || defaults?.startTime || "09:00");
  const [endTime, setEndTime] = useState(hhmm(event?.end_time) || defaults?.endTime || "10:00");
  const [recurrence, setRecurrence] = useState<Recurrence>(event?.recurrence ?? "none");
  const [until, setUntil] = useState(event?.recurrence_until ?? "");
  const [color, setColor] = useState(event?.color ?? PALETTE[4]);
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [addToTimeline, setAddToTimeline] = useState(event?.add_to_timeline ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Moving the start keeps the event's length.
  function changeStart(value: string) {
    if (value && startDate && endDate) setEndDate(addDays(value, daysBetween(startDate, endDate)));
    setStartDate(value);
  }

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
    if (!startDate) return setError("Choose a day.");
    const end = endDate || startDate;
    if (end < startDate) return setError("The event can't end before it starts.");
    if (!allDay && (!startTime || !endTime)) return setError("Enter the start and end time.");
    if (!allDay && end === startDate && endTime <= startTime) return setError("The event must end after it starts.");
    if (recurrence !== "none" && until && until < startDate) return setError("Repeating can't stop before the first day.");
    const toTimeline = addToTimeline && recurrence === "none";
    run(() =>
      onSave({
        title: title.trim(),
        notes,
        location: location.trim(),
        start_date: startDate,
        end_date: end,
        start_time: allDay ? null : startTime,
        end_time: allDay ? null : endTime,
        color,
        recurrence,
        recurrence_until: recurrence === "none" ? null : until || null,
        add_to_timeline: toTimeline,
      }),
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && <Message kind="error">{error}</Message>}
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">When</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Starts" type="date" value={startDate} onChange={(e) => changeStart(e.target.value)} />
          {!allDay && <Field label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
          <Field label="Ends" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          {!allDay && <Field label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Repeat</span>
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as Recurrence)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {REPEATS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {recurrence !== "none" && (
        <>
          <Field label="Repeat until (optional)" type="date" value={until} min={startDate} onChange={(e) => setUntil(e.target.value)} />
          {event && <p className="-mt-2 text-xs text-stone-500">Changes apply to every repeat of this event.</p>}
        </>
      )}

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={COLOR_NAMES[i]}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`size-7 rounded-full transition hover:scale-110 ${color === c ? "ring-2 ring-stone-800 ring-offset-2 dark:ring-zinc-100 dark:ring-offset-zinc-900" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>

      <Field label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />

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

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={addToTimeline && recurrence === "none"}
          disabled={recurrence !== "none"}
          onChange={(e) => setAddToTimeline(e.target.checked)}
        />
        <span>
          Add to my life timeline
          <span className="block text-xs text-stone-500">
            {recurrence !== "none" ? "Only one-off events can go on the timeline." : "A moment worth remembering, like a wedding or a big trip."}
          </span>
          {event?.timeline_event_id && event.add_to_timeline && (
            <Link href="/timeline" className="text-xs font-medium text-[#e0574a] hover:underline">
              View on the timeline →
            </Link>
          )}
        </span>
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
              {event?.recurrence !== "none" ? "Delete every repeat" : "Delete event"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              Delete…
            </button>
          ))}
      </div>
    </form>
  );
}
