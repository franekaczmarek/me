"use client";

import { useEffect, useState } from "react";
import { Message } from "@/components/ui";
import { shortDay } from "@/lib/calendar/format";
import { withAlpha } from "@/lib/colors";
import { mailApi } from "@/lib/mail/api";
import type { ApplyResult, Digest, Importance, MailAccount, MailCategory, MailMessage } from "@/lib/mail/types";
import { localToday } from "@/lib/todo/api";
import { formatMinutes } from "@/lib/todo/format";

const card =
  "rounded-3xl border border-stone-100 bg-white p-6 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900";
const primaryButton =
  "rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60";
const WHEN = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Importance / priority colours (high coral, normal sky, low mint). */
export const IMPORTANCE: Record<Importance, { color: string; label: string }> = {
  high: { color: "#ff7a6b", label: "Needs action" },
  normal: { color: "#56a8f5", label: "Worth reading" },
  low: { color: "#4cc9a0", label: "Can wait" },
};
const CATEGORY: Record<MailCategory, string> = {
  primary: "Primary",
  social: "Social",
  promotions: "Promotions",
  updates: "Updates",
  forums: "Forums",
};

/** The main column of the Mail tab: run a digest of the unread mail and read the latest one. */
export function DigestView({ accounts }: { accounts: MailAccount[] | null }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // The button waits for this load, so it never overwrites a digest the user just made.
  useEffect(() => {
    let current = true;
    mailApi
      .latestDigest()
      .then((latest) => current && setDigest(latest))
      .catch((e: Error) => current && setLoadError(`Could not load your last summary: ${e.message}`))
      .finally(() => current && setLoaded(true));
    return () => {
      current = false;
    };
  }, []);

  async function run() {
    setRunning(true);
    setError(null);
    setNotice(null);
    setWarnings([]);
    try {
      const result = await mailApi.digest();
      setWarnings(result.warnings);
      if (result.digest) setDigest(result.digest);
      else setNotice("No new unread mail since the last summary.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  /** After tasks were added: say what happened and reload the digest from the server. */
  async function applied(result: ApplyResult) {
    const parts = [
      result.created && `Added ${result.created} task${result.created === 1 ? "" : "s"} to your to-do list.`,
      result.marked && `Marked ${result.marked} email${result.marked === 1 ? "" : "s"} as read.`,
    ].filter(Boolean);
    setNotice(parts.join(" ") || "Done.");
    setWarnings(result.warnings);
    setError(null);
    try {
      setDigest(await mailApi.latestDigest());
    } catch (e) {
      setLoadError(`Could not reload the summary: ${(e as Error).message}`);
    }
  }

  const noInboxes = accounts?.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="New mail" className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">New mail</h2>
            <p className="mt-1 text-sm text-stone-500">
              {noInboxes
                ? "Connect a Gmail inbox to get a short summary of your unread mail and tasks to add from it."
                : "Claude reads your unread mail from every Gmail tab, sums it up and proposes tasks. Nothing is marked as read."}
            </p>
          </div>
          <button type="button" onClick={run} disabled={running || !loaded || !accounts?.length} className={primaryButton}>
            {running ? "Reading your inboxes…" : "✨ Summarize new mail"}
          </button>
        </div>
        {(loadError || error || notice || warnings.length > 0) && (
          <div className="mt-4 flex flex-col gap-2">
            {loadError && <Message kind="error">{loadError}</Message>}
            {error && (
              <div className="flex flex-wrap items-center gap-2">
                <Message kind="error">{error}</Message>
                <button type="button" onClick={run} className="text-sm font-medium text-stone-600 underline-offset-2 hover:underline dark:text-zinc-300">
                  Try again
                </button>
              </div>
            )}
            {notice && <Message kind="info">{notice}</Message>}
            {warnings.map((w) => (
              <p key={w} className="rounded-2xl bg-[#f2c14e]/15 px-3 py-2 text-sm text-[#7a5a00] dark:text-[#f2c14e]">
                {w}
              </p>
            ))}
          </div>
        )}
      </section>

      {digest && <DigestDetails key={digest.id} digest={digest} accounts={accounts ?? []} onApplied={applied} />}
    </div>
  );
}

function DigestDetails({
  digest,
  accounts,
  onApplied,
}: {
  digest: Digest;
  accounts: MailAccount[];
  onApplied: (result: ApplyResult) => Promise<void>;
}) {
  const byId = new Map(digest.messages.map((m) => [m.id, m]));
  return (
    <>
      <section aria-label="Summary" className={card}>
        <p className="text-xs text-stone-500">
          Summary of {digest.messages.length} email{digest.messages.length === 1 ? "" : "s"} · {WHEN.format(new Date(digest.created_at))}
        </p>
        <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-stone-700 dark:text-zinc-200">{digest.summary}</p>
      </section>
      <ProposalsCard digest={digest} messages={byId} onApplied={onApplied} />
      <EmailsCard messages={digest.messages} accounts={accounts} />
    </>
  );
}

type Choice = { checked: boolean; title: string; planned_date: string };

/** Proposed tasks: tick, edit and add them; the unticked ones are dismissed. Can mark the emails as read too. */
function ProposalsCard({
  digest,
  messages,
  onApplied,
}: {
  digest: Digest;
  messages: Map<string, MailMessage>;
  onApplied: (result: ApplyResult) => Promise<void>;
}) {
  const today = localToday();
  const pending = digest.proposals.filter((p) => p.status === "pending");
  const unread = digest.messages.filter((m) => !m.marked_read).length;
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      pending.map((p) => [p.id, { checked: true, title: p.title, planned_date: p.planned_date < today ? today : p.planned_date }]),
    ),
  );
  const [markRead, setMarkRead] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const accepted = pending.filter((p) => choices[p.id]?.checked);
  const willMark = markRead && unread > 0;

  async function apply() {
    if (accepted.some((p) => !choices[p.id].title.trim())) return setError("Give every ticked task a title.");
    if (accepted.some((p) => !choices[p.id].planned_date || choices[p.id].planned_date < today)) {
      return setError("Tasks can't be planned in the past.");
    }
    setApplying(true);
    setError(null);
    try {
      const result = await mailApi.applyDigest(
        digest.id,
        accepted.map((p) => ({
          proposal_id: p.id,
          title: choices[p.id].title.trim(),
          planned_date: choices[p.id].planned_date,
          deadline: p.deadline,
          duration_min: p.duration_min,
          priority: p.priority,
        })),
        pending.filter((p) => !choices[p.id]?.checked).map((p) => p.id),
        willMark,
      );
      await onApplied(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const label = accepted.length
    ? `Add ${accepted.length} task${accepted.length === 1 ? "" : "s"}`
    : willMark
      ? "Mark as read"
      : "Done";

  return (
    <section aria-label="Tasks from your mail" className={card}>
      <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Tasks from your mail</h2>
      {digest.proposals.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">Nothing to do from these emails.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {digest.proposals.map((p) => {
            const choice = choices[p.id];
            const open = p.status === "pending" && choice;
            return (
              <li
                key={p.id}
                aria-label={p.title}
                className={`rounded-2xl px-4 py-3 ${open ? "bg-stone-50 dark:bg-zinc-800/50" : "bg-stone-50/50 dark:bg-zinc-800/20"}`}
              >
                <div className="flex items-start gap-3">
                  {open ? (
                    <input
                      type="checkbox"
                      aria-label={`Add ${p.title}`}
                      className="mt-1.5 accent-[#ff7a6b]"
                      checked={choice.checked}
                      disabled={applying}
                      onChange={(e) => change(p.id, { checked: e.target.checked })}
                    />
                  ) : (
                    <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: IMPORTANCE[p.priority].color }} />
                  )}
                  <div className="min-w-0 flex-1">
                    {open ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label="Task title"
                          value={choice.title}
                          maxLength={200}
                          disabled={!choice.checked || applying}
                          onChange={(e) => change(p.id, { title: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-stone-800 outline-none hover:border-stone-200 focus:border-stone-300 disabled:text-stone-400 disabled:line-through dark:text-zinc-100 dark:hover:border-zinc-700"
                        />
                        <input
                          type="date"
                          aria-label={`Day for ${p.title}`}
                          value={choice.planned_date}
                          min={today}
                          disabled={!choice.checked || applying}
                          onChange={(e) => change(p.id, { planned_date: e.target.value })}
                          className="rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        />
                      </div>
                    ) : (
                      <p className={`text-sm font-medium ${p.status === "dismissed" ? "text-stone-400 line-through" : "text-stone-800 dark:text-zinc-100"}`}>
                        {p.title}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1.5 text-xs text-stone-500">
                      {p.status === "accepted" && <Chip color="#4cc9a0">✓ Added</Chip>}
                      {p.status === "dismissed" && <Chip color="#a8a29e">Skipped</Chip>}
                      {!open && <Chip color="#56a8f5">{shortDay(p.planned_date)}</Chip>}
                      {p.deadline && <Chip color="#ff7a6b">due {shortDay(p.deadline)}</Chip>}
                      {p.priority === "high" && <span>important</span>}
                      {p.duration_min && <span>~{formatMinutes(p.duration_min)}</span>}
                      {p.reason && <span>· {p.reason}</span>}
                    </div>
                    <p className="mt-1 truncate px-1.5 text-xs text-stone-400">
                      From: {p.mail_ids.map((id) => messages.get(id)?.subject || "(no subject)").join(", ")}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(pending.length > 0 || unread > 0) && (
        <div className="mt-4 flex flex-col gap-3">
          {error && <Message kind="error">{error}</Message>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {unread > 0 ? (
              <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-zinc-300">
                <input type="checkbox" className="accent-[#ff7a6b]" checked={markRead} disabled={applying} onChange={(e) => setMarkRead(e.target.checked)} />
                Mark {unread === 1 ? "this email" : `these ${unread} emails`} as read in Gmail
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={apply}
              disabled={applying || (!pending.length && !willMark)}
              className={primaryButton}
            >
              {applying ? "Saving…" : label}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EmailsCard({ messages, accounts }: { messages: MailMessage[]; accounts: MailAccount[] }) {
  const groups = new Map<string, MailMessage[]>();
  for (const m of messages) groups.set(m.account_id, [...(groups.get(m.account_id) ?? []), m]);
  const order: Importance[] = ["high", "normal", "low"];

  return (
    <section aria-label="Emails" className={card}>
      <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Emails</h2>
      <div className="mt-3 flex flex-col gap-5">
        {[...groups].map(([accountId, list]) => {
          const account = accounts.find((a) => a.id === accountId);
          const sorted = [...list].sort((a, b) => order.indexOf(a.importance) - order.indexOf(b.importance));
          return (
            <div key={accountId}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-zinc-200">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: account?.color ?? "#a8a29e" }} />
                {account ? account.label || account.email : "Removed inbox"}
                <span className="font-normal text-stone-400">{list.length}</span>
              </h3>
              <ul className="mt-2 flex flex-col divide-y divide-stone-100 dark:divide-zinc-800">
                {sorted.map((m) => (
                  <li key={m.id} aria-label={m.subject || "(no subject)"} className="flex items-start gap-3 py-2.5">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: IMPORTANCE[m.importance].color }}
                      title={IMPORTANCE[m.importance].label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{m.subject || "(no subject)"}</p>
                        {m.category !== "primary" && <Chip color="#9b87f5">{CATEGORY[m.category]}</Chip>}
                      </div>
                      <p className="truncate text-xs text-stone-500">{m.sender}</p>
                      {m.summary && <p className="mt-0.5 text-sm text-stone-600 dark:text-zinc-300">{m.summary}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-stone-700 dark:text-zinc-200"
      style={{ background: withAlpha(color, 0.16) }}
    >
      {children}
    </span>
  );
}
