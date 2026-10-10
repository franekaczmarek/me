"use client";

import { useEffect, useState } from "react";
import { Message } from "@/components/ui";
import { todoApi } from "@/lib/todo/api";
import { dayTitle, formatMinutes } from "@/lib/todo/format";
import type { PlanChange, Proposal } from "@/lib/todo/types";

type Props = {
  today: string;
  onClose: () => void;
  /** Called after changes were applied. */
  onApplied: () => void;
};

const INBOX = "inbox";

/** Asks Claude for a plan of the coming week, lets the user pick which moves to apply. */
export function PlanDialog({ today, onClose, onApplied }: Props) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    todoApi
      .plan()
      .then((p) => {
        if (cancelled) return;
        setProposal(p);
        setSelected(new Set(p.changes.map((c) => c.task_id)));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !applying && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    try {
      await todoApi.applyPlan(proposal.changes.filter((c) => selected.has(c.task_id)));
      onApplied();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setApplying(false);
    }
  }

  // Group the proposed moves by target day, in date order (inbox last).
  const groups = new Map<string, PlanChange[]>();
  for (const change of proposal?.changes ?? []) {
    const key = change.to_date ?? INBOX;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  const load = new Map(proposal?.days.map((d) => [d.date, d]) ?? []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plan with Claude"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !applying && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-800 dark:text-zinc-100">✨ Plan with Claude</h2>
            <p className="text-sm text-stone-500">A suggestion for the next 7 days. Nothing changes until you apply it.</p>
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

        {!proposal && !error && (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-stone-500" role="status">
            <span className="size-8 animate-spin rounded-full border-[3px] border-[#ffd6cf] border-t-[#ff7a6b]" aria-hidden />
            Claude is looking at your tasks and your week…
          </div>
        )}

        {proposal && (
          <>
            <p className="rounded-2xl bg-[#fff6f4] px-4 py-3 text-sm text-stone-700 dark:bg-[#2a1b19] dark:text-zinc-200">
              {proposal.summary}
            </p>
            {proposal.warnings.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-[#9a7414]">
                {proposal.warnings.map((w) => (
                  <li key={w}>⚠️ {w}</li>
                ))}
              </ul>
            )}
            {proposal.changes.length === 0 ? (
              <p className="text-sm text-stone-500">Your plan already looks good — no changes suggested.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {[...groups].map(([key, changes]) => {
                  const day = key === INBOX ? null : load.get(key);
                  const title = key === INBOX ? null : dayTitle(key, today);
                  return (
                    <section key={key} aria-label={key === INBOX ? "Back to the inbox" : `${title!.name}, ${title!.date}`}>
                      <h3 className="mb-1 flex items-baseline justify-between text-sm font-semibold text-stone-700 dark:text-zinc-200">
                        <span>
                          {key === INBOX ? "Back to the inbox" : title!.name}{" "}
                          {title && <span className="font-normal text-stone-500">{title.date}</span>}
                        </span>
                        {day && (
                          <span className={`text-xs font-normal ${day.planned_min > day.capacity_min ? "text-[#e0574a]" : "text-stone-500"}`}>
                            {formatMinutes(day.planned_min)} of {formatMinutes(day.capacity_min)}
                          </span>
                        )}
                      </h3>
                      <ul className="flex flex-col gap-1">
                        {changes.map((c) => (
                          <li key={c.task_id}>
                            <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-2 hover:bg-stone-50 dark:hover:bg-zinc-800">
                              <input
                                type="checkbox"
                                className="mt-1 accent-[#ff7a6b]"
                                checked={selected.has(c.task_id)}
                                onChange={() => toggle(c.task_id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-stone-800 dark:text-zinc-100">
                                  {c.title}
                                  {c.duration_min ? <span className="ml-2 text-xs text-stone-400">{formatMinutes(c.duration_min)}</span> : null}
                                </span>
                                <span className="block text-xs text-stone-500">
                                  {c.from_date ? `from ${dayTitle(c.from_date, today).name}` : "from the inbox"} · {c.reason}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={applying} className="rounded-full px-4 py-2 text-sm hover:bg-stone-100 dark:hover:bg-zinc-800">
                Cancel
              </button>
              {proposal.changes.length > 0 && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={applying || selected.size === 0}
                  className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {applying ? "Applying…" : `Apply ${selected.size} change${selected.size === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
