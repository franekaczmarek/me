"use client";

import { useEffect, useState } from "react";
import { Message } from "@/components/ui";
import { calendarApi } from "@/lib/calendar/api";
import { countdown, shortDay } from "@/lib/calendar/format";
import type { Suggestion, SuggestResult } from "@/lib/calendar/types";
import { daysBetween, formatMinutes } from "@/lib/todo/format";

type Props = {
  today: string;
  onClose: () => void;
  /** Called after tasks were created or suggestions dismissed. */
  onApplied: () => void;
};

type Choice = { checked: boolean; title: string; planned_date: string };

const keyOf = (s: Suggestion) => `${s.event_id}|${s.occurrence_date}|${s.title}`;

/** Claude looks at the next 30 days of the calendar and proposes tasks; the user picks, edits and adds them. */
export function SuggestDialog({ today, onClose, onApplied }: Props) {
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [forget, setForget] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    calendarApi
      .suggest(today)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setChoices(Object.fromEntries(r.suggestions.map((s) => [keyOf(s), { checked: true, title: s.title, planned_date: s.planned_date }])));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [today]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !applying && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  const suggestions = result?.suggestions ?? [];
  const accepted = suggestions.filter((s) => choices[keyOf(s)]?.checked);
  const unchecked = suggestions.filter((s) => !choices[keyOf(s)]?.checked);
  const change = (s: Suggestion, update: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [keyOf(s)]: { ...c[keyOf(s)], ...update } }));

  async function apply() {
    if (accepted.some((s) => !choices[keyOf(s)].title.trim())) return setError("Every task needs a title.");
    if (accepted.some((s) => !choices[keyOf(s)].planned_date || choices[keyOf(s)].planned_date < today)) {
      return setError("Choose today or a later day for every task.");
    }
    setApplying(true);
    setError(null);
    try {
      await calendarApi.applySuggestions(
        today,
        accepted.map((s) => ({ suggestion: s, title: choices[keyOf(s)].title.trim(), planned_date: choices[keyOf(s)].planned_date })),
        forget ? unchecked : [],
      );
      onApplied();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setApplying(false);
    }
  }

  // One group per event occurrence, soonest event first.
  const groups = new Map<string, Suggestion[]>();
  for (const s of [...suggestions].sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))) {
    const key = `${s.event_id}|${s.occurrence_date}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tasks from your calendar"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !applying && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-800 dark:text-zinc-100">✨ Tasks from your calendar</h2>
            <p className="text-sm text-stone-500">Claude looked at the next 30 days. Nothing is added until you say so.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={applying}
            className="rounded-full px-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </header>

        {error && <Message kind="error">{error}</Message>}

        {!result && !error && (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-stone-500" role="status">
            <span className="size-8 animate-spin rounded-full border-[3px] border-[#ffd6cf] border-t-[#ff7a6b]" aria-hidden />
            Claude is reading your calendar…
          </div>
        )}

        {result && (
          <>
            {result.warnings.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-[#9a7414]">
                {result.warnings.map((w) => (
                  <li key={w}>⚠️ {w}</li>
                ))}
              </ul>
            )}
            {suggestions.length === 0 ? (
              <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                {result.events === 0
                  ? "Nothing in your calendar for the next 30 days."
                  : `Looked at ${result.events} event${result.events === 1 ? "" : "s"} — nothing new to prepare.`}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {[...groups].map(([key, items]) => {
                  const first = items[0];
                  return (
                    <section key={key} aria-label={`${first.event_title}, ${shortDay(first.occurrence_date)}`}>
                      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-zinc-200">
                        <span className="h-4 w-1.5 rounded-full" style={{ background: first.event_color }} />
                        {first.event_title}
                        <span className="font-normal text-stone-500">
                          {shortDay(first.occurrence_date)} · {countdown(daysBetween(today, first.occurrence_date))}
                        </span>
                      </h3>
                      <ul className="flex flex-col gap-1">
                        {items.map((s) => {
                          const choice = choices[keyOf(s)];
                          return (
                            <li key={keyOf(s)} className="flex items-start gap-3 rounded-2xl px-3 py-2 hover:bg-stone-50 dark:hover:bg-zinc-800">
                              <input
                                type="checkbox"
                                aria-label={`Add ${s.title}`}
                                className="mt-2 accent-[#ff7a6b]"
                                checked={choice.checked}
                                onChange={(e) => change(s, { checked: e.target.checked })}
                              />
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    aria-label="Task title"
                                    value={choice.title}
                                    maxLength={200}
                                    disabled={!choice.checked}
                                    onChange={(e) => change(s, { title: e.target.value })}
                                    className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-stone-800 outline-none hover:border-stone-200 focus:border-stone-300 disabled:text-stone-400 disabled:line-through dark:text-zinc-100 dark:hover:border-zinc-700"
                                  />
                                  <input
                                    type="date"
                                    aria-label={`Day for ${s.title}`}
                                    value={choice.planned_date}
                                    min={today}
                                    disabled={!choice.checked}
                                    onChange={(e) => change(s, { planned_date: e.target.value })}
                                    className="rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                                  />
                                </div>
                                <p className="px-1.5 text-xs text-stone-500">
                                  {s.reason}
                                  {s.duration_min ? ` · ~${formatMinutes(s.duration_min)}` : ""}
                                  {s.priority === "high" ? " · important" : ""}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
            {unchecked.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-zinc-300">
                <input type="checkbox" className="accent-[#ff7a6b]" checked={forget} onChange={(e) => setForget(e.target.checked)} />
                Don&apos;t suggest the unticked ones again
              </label>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={applying} className="rounded-full px-4 py-2 text-sm hover:bg-stone-100 dark:hover:bg-zinc-800">
                {suggestions.length ? "Cancel" : "Close"}
              </button>
              {suggestions.length > 0 && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={applying || (accepted.length === 0 && !(forget && unchecked.length))}
                  className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {applying ? "Adding…" : accepted.length ? `Add ${accepted.length} task${accepted.length === 1 ? "" : "s"}` : "Save choices"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
