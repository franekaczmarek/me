"use client";

import { countdown, monthTitle, shortDay, when } from "@/lib/calendar/format";
import type { MonthSummary, Upcoming } from "@/lib/calendar/types";
import { withAlpha } from "@/lib/colors";
import { formatMinutes } from "@/lib/todo/format";

const card =
  "rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900";

export function SummaryCard({ summary }: { summary: MonthSummary | null }) {
  return (
    <section aria-label="Month summary" className={card}>
      <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">
        {summary ? monthTitle(summary.month) : "This month"}
      </h2>
      {!summary ? (
        <p className="mt-2 text-sm text-stone-500">Loading…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Tile label="Events" value={String(summary.events)} color="#56a8f5" />
            <Tile label="Busy time" value={summary.event_minutes ? formatMinutes(summary.event_minutes) : "–"} color="#9b87f5" />
            <Tile label="Days off" value={String(summary.days_off)} color="#f2c14e" />
          </div>
          <dl className="mt-4 flex flex-col gap-1.5 text-sm">
            <Row label="Tasks done" value={summary.tasks_done} dot="#2fb88a" />
            <Row label="Tasks still open" value={summary.tasks_open} dot="#56a8f5" />
            {summary.tasks_overdue > 0 && <Row label="Overdue" value={summary.tasks_overdue} dot="#e0475e" />}
          </dl>
          <p className="mt-3 text-xs text-stone-500">
            {summary.busiest_day
              ? `Busiest day: ${shortDay(summary.busiest_day)} (${summary.busiest_day_events} event${summary.busiest_day_events === 1 ? "" : "s"})`
              : "Nothing planned yet this month."}
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl px-3 py-2" style={{ background: withAlpha(color, 0.14) }}>
      <p className="text-lg font-semibold text-stone-800 tabular-nums dark:text-zinc-100">{value}</p>
      <p className="text-[11px] text-stone-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function Row({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={{ background: dot }} />
      <dt className="flex-1 text-stone-600 dark:text-zinc-300">{label}</dt>
      <dd className="font-semibold text-stone-800 tabular-nums dark:text-zinc-100">{value}</dd>
    </div>
  );
}

export function UpcomingCard({ upcoming, onOpen }: { upcoming: Upcoming[] | null; onOpen: (item: Upcoming) => void }) {
  return (
    <section aria-label="Upcoming" className={card}>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Upcoming</h2>
        <span className="text-xs text-stone-500">next 30 days</span>
      </header>
      {!upcoming ? (
        <p className="mt-2 text-sm text-stone-500">Loading…</p>
      ) : upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Nothing coming up.</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {upcoming.map((item) => (
            <li key={`${item.id}-${item.occurrence_date}`}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-stone-50 dark:hover:bg-zinc-800/60"
              >
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: item.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{item.title}</span>
                  <span className="block text-xs text-stone-500">{when(item)}</span>
                </span>
                {item.has_task && (
                  <span title="A task is planned for it" className="rounded-full bg-[#4cc9a0]/15 px-2 py-0.5 text-[11px] font-medium text-[#1f7a5c] dark:text-[#8fe3c6]">
                    ✓ task
                  </span>
                )}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    item.days_until <= 1
                      ? "bg-[#ff7a6b]/15 text-[#b8483b] dark:text-[#ffb3a9]"
                      : "bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {countdown(item.days_until)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
