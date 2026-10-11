"use client";

import { useState } from "react";
import { Message } from "@/components/ui";
import { withAlpha } from "@/lib/colors";
import { todoApi } from "@/lib/todo/api";
import { dayTitle, formatMinutes, parseDay } from "@/lib/todo/format";
import type { Draft, Priority } from "@/lib/todo/types";
import { PRIORITY_COLOR } from "./TaskRow";

const NEXT_PRIORITY: Record<Priority, Priority> = { low: "normal", normal: "high", high: "low" };
const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const chip = "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap";

type Props = {
  today: string;
  /** Called after tasks were created. */
  onAdded: () => void;
};

/** "Type tasks the way you'd say them": Claude turns the note into tasks, shown for review before adding. */
export function SmartAdd({ today, onAdded }: Props) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"reading" | "adding" | null>(null);

  async function read(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || pending) return;
    setError(null);
    setPending("reading");
    try {
      const result = await todoApi.parse(text.trim());
      setDrafts(result.tasks);
      setWarnings(result.warnings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function add(items: Draft[]) {
    setPending("adding");
    setError(null);
    try {
      for (const d of items) {
        await todoApi.createTask({
          title: d.title,
          notes: d.notes,
          planned_date: d.planned_date,
          deadline: d.deadline,
          duration_min: d.duration_min,
          priority: d.priority,
          fixed_day: d.fixed_day && d.planned_date !== null,
        });
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

  /** Without Claude: keep the note as one inbox task. */
  const addAsIs = () =>
    add([
      {
        title: text.trim().slice(0, 200),
        notes: "",
        planned_date: null,
        deadline: null,
        duration_min: null,
        duration_estimated: false,
        priority: "normal",
        fixed_day: false,
      },
    ]);

  const update = (i: number, change: Partial<Draft>) =>
    setDrafts((ds) => ds && ds.map((d, j) => (j === i ? { ...d, ...change } : d)));
  const remove = (i: number) => setDrafts((ds) => ds && ds.filter((_, j) => j !== i));

  return (
    <section
      aria-label="Quick add"
      className="rounded-3xl border border-stone-100 bg-white p-3 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <form onSubmit={read} className="flex items-center gap-2">
        <span aria-hidden className="pl-2 text-lg">
          ✨
        </span>
        <input
          aria-label="Type tasks"
          value={text}
          maxLength={2000}
          disabled={pending !== null}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type tasks… e.g. dentist tomorrow at 3pm, important; call mum on Friday"
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
        <div className="mt-3 flex flex-wrap items-center gap-2 px-2">
          <Message kind="error">{error}</Message>
          <button
            type="button"
            onClick={addAsIs}
            disabled={pending !== null}
            className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            Add as one task to the inbox
          </button>
        </div>
      )}

      {drafts && (
        <div className="mt-3 flex flex-col gap-2 px-2 pb-1">
          {warnings.map((w) => (
            <p key={w} className="text-xs text-[#9a7414]">
              ⚠️ {w}
            </p>
          ))}
          {drafts.length === 0 && <p className="text-sm text-stone-500">No tasks found in that note.</p>}
          <ul className="flex flex-col gap-2">
            {drafts.map((d, i) => (
              <DraftRow
                key={i}
                draft={d}
                today={today}
                onChange={(change) => update(i, change)}
                onRemove={() => remove(i)}
              />
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
                {pending === "adding" ? "Adding…" : `Add ${drafts.length} task${drafts.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DraftRow({
  draft,
  today,
  onChange,
  onRemove,
}: {
  draft: Draft;
  today: string;
  onChange: (change: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const color = PRIORITY_COLOR[draft.priority];
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-stone-50 p-3 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Priority ${draft.priority} (click to change)`}
          title={`${draft.priority} priority — click to change`}
          onClick={() => onChange({ priority: NEXT_PRIORITY[draft.priority] })}
          className="size-4 shrink-0 rounded-full ring-4 transition"
          style={{ background: color, ["--tw-ring-color" as string]: withAlpha(color, 0.25) }}
        />
        <input
          aria-label="Task title"
          value={draft.title}
          maxLength={200}
          onChange={(e) => onChange({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-stone-800 outline-none dark:text-zinc-100"
        />
        <button
          type="button"
          aria-label={`Remove ${draft.title}`}
          onClick={onRemove}
          className="rounded-full px-2 text-stone-400 hover:bg-stone-200 hover:text-red-600 dark:hover:bg-zinc-700"
        >
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        <label className={`${chip} relative cursor-pointer bg-white text-stone-600 ring-1 ring-stone-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700`}>
          {draft.planned_date ? `📅 ${dayTitle(draft.planned_date, today).name}` : "📥 Inbox"}
          <input
            type="date"
            aria-label="Day"
            value={draft.planned_date ?? ""}
            min={today}
            onChange={(e) => onChange({ planned_date: e.target.value || null, fixed_day: e.target.value ? draft.fixed_day : false })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {draft.planned_date && (
          <>
            <button
              type="button"
              onClick={() => onChange({ planned_date: null, fixed_day: false })}
              className={`${chip} bg-white text-stone-500 ring-1 ring-stone-200 dark:bg-zinc-900 dark:ring-zinc-700`}
            >
              To inbox
            </button>
            <button
              type="button"
              aria-pressed={draft.fixed_day}
              onClick={() => onChange({ fixed_day: !draft.fixed_day })}
              className={`${chip} ${draft.fixed_day ? "bg-[#ff7a6b]/15 text-[#c2493d]" : "bg-white text-stone-500 ring-1 ring-stone-200 dark:bg-zinc-900 dark:ring-zinc-700"}`}
            >
              📌 {draft.fixed_day ? "Fixed day" : "Flexible"}
            </button>
          </>
        )}
        {draft.deadline && (
          <span className={`${chip} bg-[#ff7a6b]/15 text-[#c2493d]`}>
            due {SHORT.format(parseDay(draft.deadline))}
            <button type="button" aria-label="Remove deadline" onClick={() => onChange({ deadline: null })} className="ml-1">
              ×
            </button>
          </span>
        )}
        <label className={`${chip} relative bg-white text-stone-600 ring-1 ring-stone-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700`}>
          ⏱ {draft.duration_min ? `${draft.duration_estimated ? "~" : ""}${formatMinutes(draft.duration_min)}` : "No estimate"}
          <select
            aria-label="Duration"
            value={draft.duration_min ?? ""}
            onChange={(e) => onChange({ duration_min: e.target.value ? Number(e.target.value) : null, duration_estimated: false })}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">No estimate</option>
            {[...new Set([...DURATIONS, ...(draft.duration_min ? [draft.duration_min] : [])])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {formatMinutes(m)}
                </option>
              ))}
          </select>
        </label>
        {draft.notes && <span className="text-xs text-stone-500">· {draft.notes}</span>}
      </div>
    </li>
  );
}
