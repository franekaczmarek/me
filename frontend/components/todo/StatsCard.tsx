"use client";

import { useEffect, useState } from "react";
import { todoApi } from "@/lib/todo/api";
import { parseDay } from "@/lib/todo/format";
import type { DayStats, Stats } from "@/lib/todo/types";

// Status colours (validated with the dataviz palette checker): light / dark steps.
const STATUS = {
  on_time: { label: "On time", className: "bg-[#2fb88a] dark:bg-[#229a74]", stroke: "stroke-[#2fb88a] dark:stroke-[#229a74]" },
  late: { label: "Late", className: "bg-[#d9a514] dark:bg-[#b88a0c]" },
  missed: { label: "Missed", className: "bg-[#e0475e]" },
} as const;
const SERIES = ["on_time", "late", "missed"] as const;
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const FULL = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

function describeDay(d: DayStats) {
  return `${FULL.format(parseDay(d.date))}: ${d.on_time} on time, ${d.late} late, ${d.missed} missed`;
}

/** Small dashboard: how much gets done on time. `version` changes → reload. */
export function StatsCard({ version }: { version: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    todoApi
      .stats()
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => setError(`Could not load statistics: ${e.message}`));
  }, [version]);

  return (
    <section
      aria-label="Statistics"
      className="rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">How it&apos;s going</h2>
        <span className="text-xs text-stone-500">last {stats?.days ?? 30} days</span>
      </header>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {stats && <StatsBody stats={stats} />}
    </section>
  );
}

function StatsBody({ stats }: { stats: Stats }) {
  const rate = stats.on_time_rate;
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const max = Math.max(1, ...stats.last_week.map((d) => d.on_time + d.late + d.missed));

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="flex items-center gap-5">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
            <circle cx={40} cy={40} r={r} fill="none" strokeWidth={9} className="stroke-stone-100 dark:stroke-zinc-800" />
            {rate !== null && rate > 0 && (
              <circle
                cx={40}
                cy={40}
                r={r}
                fill="none"
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={`${rate * circumference} ${circumference}`}
                className={`${STATUS.on_time.stroke} transition-[stroke-dasharray] duration-500`}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-stone-800 dark:text-zinc-100">
              {rate === null ? "–" : `${Math.round(rate * 100)}%`}
            </span>
            <span className="text-[10px] tracking-wide text-stone-500 uppercase">on time</span>
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {(
            [
              ["On time", stats.on_time, STATUS.on_time.className],
              ["Late", stats.late, STATUS.late.className],
              ["Overdue", stats.overdue, "bg-[#ff7a6b]"],
              ["Missed", stats.missed, STATUS.missed.className],
            ] as const
          ).map(([label, value, dot]) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${dot}`} aria-hidden />
              <dt className="text-stone-500 dark:text-zinc-400">{label}</dt>
              <dd className="ml-auto font-semibold text-stone-800 dark:text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-[#ffa36c]/15 px-3 py-1 font-medium text-[#b9612c] dark:text-[#ffb98f]">
          🔥 {stats.streak}-day streak
        </span>
        {stats.avg_postponed !== null && (
          <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300">
            postponed {stats.avg_postponed}× on average
          </span>
        )}
      </div>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-medium text-stone-500">Last 7 days</figcaption>
        <div className="flex h-24 items-end gap-2" aria-hidden>
          {stats.last_week.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={describeDay(d)}>
              <div className="flex h-20 w-full max-w-7 flex-col-reverse items-stretch gap-[2px]">
                {SERIES.filter((s) => d[s] > 0).map((s, i, shown) => (
                  <span
                    key={s}
                    className={`${STATUS[s].className} ${i === shown.length - 1 ? "rounded-t-[4px]" : ""}`}
                    style={{ height: `${(d[s] / max) * 100}%` }}
                  />
                ))}
                {d.on_time + d.late + d.missed === 0 && <span className="h-[3px] rounded-full bg-stone-100 dark:bg-zinc-800" />}
              </div>
              <span className="text-[10px] text-stone-400">{WEEKDAY.format(parseDay(d.date))}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 text-[11px] text-stone-500 dark:text-zinc-400">
          {SERIES.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${STATUS[s].className}`} aria-hidden />
              {STATUS[s].label}
            </span>
          ))}
        </div>
        <table className="sr-only">
          <caption>Tasks per day, last 7 days</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>On time</th>
              <th>Late</th>
              <th>Missed</th>
            </tr>
          </thead>
          <tbody>
            {stats.last_week.map((d) => (
              <tr key={d.date}>
                <td>{FULL.format(parseDay(d.date))}</td>
                <td>{d.on_time}</td>
                <td>{d.late}</td>
                <td>{d.missed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </div>
  );
}
