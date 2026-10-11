"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Message } from "@/components/ui";
import { calendarApi, type DayOff } from "@/lib/calendar/api";
import { formatTime, longDay, monthTitle } from "@/lib/calendar/format";
import { addMonths, monthGrid, onDay, startOfMonth } from "@/lib/calendar/grid";
import type { CalendarEvent, EventInput, Occurrence, Summary } from "@/lib/calendar/types";
import { localToday } from "@/lib/todo/api";
import { type EventDefaults, EventForm } from "./EventForm";
import { MonthView } from "./MonthView";
import { SummaryCard, UpcomingCard } from "./SideCards";
import { WorkSettings } from "./WorkSettings";

type Panel =
  | { mode: "new"; defaults: EventDefaults }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "day"; day: string }
  | { mode: "settings" }
  | null;

type Data = { occurrences: Occurrence[]; daysOff: DayOff[] };

const panelCard =
  "flex flex-col gap-4 rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.08)] dark:border-zinc-800 dark:bg-zinc-900";
const secondary =
  "rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const round =
  "grid size-9 place-items-center rounded-full text-lg text-stone-600 transition hover:bg-white hover:shadow-sm dark:text-zinc-300 dark:hover:bg-zinc-900";

/** A Google-Calendar-like calendar: the month grid in the middle, a month summary and upcoming events on the right. */
export function CalendarModule() {
  const [today] = useState(localToday);
  const [cursor, setCursor] = useState(today);
  const [data, setData] = useState<Data | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [attempt, setAttempt] = useState(0);
  const sideRef = useRef<HTMLDivElement>(null);

  const weeks = monthGrid(cursor);
  const first = weeks[0][0];
  const last = weeks[5][6];
  const month = startOfMonth(cursor);

  const reload = useCallback(
    () =>
      Promise.all([calendarApi.occurrences(first, last), calendarApi.daysOff(), calendarApi.summary(month, today)]).then(
        ([occurrences, daysOff, sum]) => {
          setData({ occurrences, daysOff });
          setSummary(sum);
        },
      ),
    [first, last, month, today],
  );

  useEffect(() => {
    reload().catch((e: Error) => setError(`Could not load your calendar: ${e.message}`));
  }, [reload, attempt]);

  // On small screens the side column sits below the grid: bring an opened panel into view.
  useEffect(() => {
    if (panel) sideRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [panel]);

  async function openEvent(id: string) {
    setActionError(null);
    try {
      setPanel({ mode: "edit", event: await calendarApi.event(id) });
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function save(input: EventInput) {
    if (panel?.mode === "edit") await calendarApi.saveEvent(panel.event.id, input);
    else await calendarApi.createEvent(input);
    await reload();
    setPanel(null);
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <Message kind="error">{error}</Message>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:flex-row md:p-6 dark:bg-zinc-950">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setCursor(today)} className={secondary}>
            Today
          </button>
          <div className="flex items-center">
            <button type="button" aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))} className={round}>
              ‹
            </button>
            <button type="button" aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))} className={round}>
              ›
            </button>
          </div>
          <h1 className="mr-auto text-xl font-semibold text-stone-800 dark:text-zinc-100">{monthTitle(cursor)}</h1>
          <button
            type="button"
            onClick={() => setPanel({ mode: "new", defaults: { date: cursor.slice(0, 7) === today.slice(0, 7) ? today : month } })}
            className="rounded-full bg-gradient-to-r from-[#ff7a6b] to-[#ffa36c] px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(255,122,107,0.35)] transition hover:-translate-y-0.5"
          >
            New event
          </button>
          <button type="button" aria-label="Work schedule and days off" title="Work schedule and days off" onClick={() => setPanel({ mode: "settings" })} className={round}>
            ⚙
          </button>
        </div>
        {actionError && <Message kind="error">{actionError}</Message>}
        {data ? (
          <MonthView
            month={cursor}
            today={today}
            occurrences={data.occurrences}
            daysOff={data.daysOff}
            onCreate={(day) => setPanel({ mode: "new", defaults: { date: day } })}
            onOpen={(o) => openEvent(o.id)}
            onShowDay={(day) => setPanel({ mode: "day", day })}
          />
        ) : (
          <p className="p-6 text-sm text-stone-500">Loading your calendar…</p>
        )}
      </div>

      <div ref={sideRef} className="flex w-full scroll-mt-4 flex-col gap-4 md:w-96">
        {panel?.mode === "new" || panel?.mode === "edit" ? (
          <aside aria-label={panel.mode === "new" ? "New event" : "Edit event"} className={panelCard}>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{panel.mode === "new" ? "New event" : "Edit event"}</p>
            <EventForm
              key={panel.mode === "edit" ? panel.event.id : `new-${panel.defaults.date}`}
              event={panel.mode === "edit" ? panel.event : undefined}
              defaults={panel.mode === "new" ? panel.defaults : undefined}
              submitLabel={panel.mode === "new" ? "Add event" : "Save changes"}
              onSave={save}
              onCancel={() => setPanel(null)}
              onDelete={
                panel.mode === "edit"
                  ? async () => {
                      await calendarApi.deleteEvent(panel.event.id);
                      await reload();
                      setPanel(null);
                    }
                  : undefined
              }
            />
          </aside>
        ) : panel?.mode === "day" ? (
          <DayPanel
            day={panel.day}
            occurrences={onDay(data?.occurrences ?? [], panel.day)}
            onOpen={(o) => openEvent(o.id)}
            onAdd={() => setPanel({ mode: "new", defaults: { date: panel.day } })}
            onClose={() => setPanel(null)}
          />
        ) : panel?.mode === "settings" ? (
          <>
            <button type="button" onClick={() => setPanel(null)} className={`${secondary} self-start`}>
              ← Back to summary
            </button>
            <WorkSettings onChanged={() => reload().catch(() => {})} />
          </>
        ) : (
          <>
            <SummaryCard summary={summary?.month ?? null} />
            <UpcomingCard upcoming={summary?.upcoming ?? null} onOpen={(item) => openEvent(item.id)} />
          </>
        )}
      </div>
    </div>
  );
}

type DayPanelProps = {
  day: string;
  occurrences: Occurrence[];
  onOpen: (o: Occurrence) => void;
  onAdd: () => void;
  onClose: () => void;
};

function DayPanel({ day, occurrences, onOpen, onAdd, onClose }: DayPanelProps) {
  return (
    <aside aria-label={longDay(day)} className={panelCard}>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">{longDay(day)}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-zinc-800">
          ×
        </button>
      </header>
      {occurrences.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing planned.</p>
      ) : (
        <ul className="flex flex-col">
          {occurrences.map((o) => (
            <li key={`${o.id}-${o.occurrence_date}`}>
              <button type="button" onClick={() => onOpen(o)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-stone-50 dark:hover:bg-zinc-800/60">
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: o.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{o.title}</span>
                  <span className="block text-xs text-stone-500">
                    {o.all_day ? "All day" : `${formatTime(o.start_time!)} – ${formatTime(o.end_time!)}`}
                    {o.location && ` · ${o.location}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onAdd} className={`${secondary} self-start`}>
        + Add event
      </button>
    </aside>
  );
}
