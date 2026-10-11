"use client";

import { useState } from "react";
import { Message } from "@/components/ui";
import { calendarApi } from "@/lib/calendar/api";
import { formatTime, when } from "@/lib/calendar/format";
import type { EventDraft, Recurrence } from "@/lib/calendar/types";

const REPEAT_LABEL: Record<Recurrence, string> = { none: "", weekly: "every week", monthly: "every month", yearly: "every year" };

type Props = {
  today: string;
  /** Called after events were created. */
  onAdded: () => void;
};

/** "Type events the way you'd say them": Claude turns the note into events, shown for review before adding. */
export function SmartEventAdd({ today, onAdded }: Props) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<EventDraft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"reading" | "adding" | null>(null);

  async function read(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || pending) return;
    setError(null);
    setPending("reading");
    try {
      const result = await calendarApi.parse(text.trim(), today);
      setDrafts(result.events);
      setWarnings(result.warnings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function add(items: EventDraft[]) {
    setPending("adding");
    setError(null);
    try {
      for (const d of items) {
        await calendarApi.createEvent({ ...d, title: d.title.trim(), recurrence_until: null, add_to_timeline: false });
      }
      setText("");
      setDrafts(null);
      setWarnings([]);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  const change = (i: number, update: Partial<EventDraft>) =>
    setDrafts((d) => d && d.map((x, j) => (j === i ? { ...x, ...update } : x)));

  return (
    <section
      aria-label="Quick add events"
      className="rounded-3xl border border-stone-100 bg-white p-3 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <form onSubmit={read} className="flex items-center gap-2">
        <span aria-hidden className="pl-2 text-lg">
          ✨
        </span>
        <input
          aria-label="Describe events"
          placeholder="Type events… e.g. dentist Thursday 15:30; Kasia's birthday 3 March every year"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={!text.trim() || pending !== null}
          className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-4 py-1.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.3)] transition hover:-translate-y-0.5 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
        >
          {pending === "reading" ? "Reading…" : "Read"}
        </button>
      </form>

      {error && (
        <div className="mt-3 px-2">
          <Message kind="error">{error}</Message>
        </div>
      )}

      {drafts && (
        <div className="mt-3 flex flex-col gap-2 px-2 pb-1">
          {warnings.map((w) => (
            <p key={w} className="text-xs text-[#9a7414]">
              ⚠️ {w}
            </p>
          ))}
          {drafts.length === 0 && <p className="text-sm text-stone-500">No events found in that note.</p>}
          <ul className="flex flex-col gap-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-2xl bg-stone-50 p-3 dark:bg-zinc-800/60">
                <span className="size-3 shrink-0 rounded-full" style={{ background: d.color }} />
                <input
                  aria-label="Event title"
                  value={d.title}
                  maxLength={200}
                  onChange={(e) => change(i, { title: e.target.value })}
                  className="min-w-40 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-stone-800 outline-none hover:border-stone-200 focus:border-stone-300 dark:text-zinc-100 dark:hover:border-zinc-700"
                />
                <span className="text-xs text-stone-500">
                  {d.start_time ? `${when(d)} – ${formatTime(d.end_time!)}` : when(d)}
                  {d.recurrence !== "none" && ` · ${REPEAT_LABEL[d.recurrence]}`}
                  {d.location && ` · ${d.location}`}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${d.title}`}
                  onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                  className="rounded-full px-2 text-stone-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-zinc-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setDrafts(null);
                setWarnings([]);
              }}
              disabled={pending !== null}
              className="rounded-full px-4 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            {drafts.length > 0 && (
              <button
                type="button"
                onClick={() => add(drafts)}
                disabled={pending !== null || drafts.some((d) => !d.title.trim())}
                className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-1.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {pending === "adding" ? "Adding…" : `Add ${drafts.length} event${drafts.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
