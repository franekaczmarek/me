"use client";

import { useEffect, useRef, useState } from "react";
import type { DayOff } from "@/lib/calendar/api";
import { formatTime, longDay } from "@/lib/calendar/format";
import {
  isTimedSingleDay,
  layoutDay,
  MINUTES_PER_DAY,
  minutesOf,
  type Placed,
  SNAP,
  snap,
  timeOf,
  weekSegments,
} from "@/lib/calendar/grid";
import type { Occurrence } from "@/lib/calendar/types";
import { darken, lighten, withAlpha } from "@/lib/colors";
import type { EventDefaults } from "./EventForm";
import { EventBar } from "./MonthView";

/** Pixels per hour. */
export const HOUR_PX = 48;
const PX = HOUR_PX / 60;
/** Pointer travel (px) before a press becomes a drag. */
const THRESHOLD = 4;
const SHORT_WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export type TimeChange = { date: string; start: number; end: number };

type Props = {
  days: string[];
  today: string;
  occurrences: Occurrence[];
  daysOff: DayOff[];
  /** Work hours, minutes from midnight: shaded outside, scrolled to on open. */
  workStart: number;
  workEnd: number;
  onCreate: (defaults: EventDefaults) => void;
  onOpen: (occurrence: Occurrence) => void;
  /** A timed event was dragged (moved or resized). */
  onMove: (occurrence: Occurrence, change: TimeChange) => void;
  onShowDay?: (day: string) => void;
};

type Session = {
  kind: "create" | "move" | "resize";
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  dayIndex: number;
  placed?: Placed;
  el?: HTMLElement;
  result?: TimeChange;
  frame: number;
};

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export function TimeGrid({ days, today, occurrences, daysOff, workStart, workEnd, onCreate, onOpen, onMove, onShowDay }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const ghost = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const [now, setNow] = useState(nowMinutes);

  useEffect(() => {
    const timer = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => cleanup.current(), []);

  // Open at the start of the work day.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (workStart - 60) * PX - 8);
  }, [workStart]);

  const allDay = occurrences.filter((o) => !isTimedSingleDay(o));
  const segments = weekSegments(days, allDay);
  const lanes = segments.reduce((n, s) => Math.max(n, s.lane + 1), 0);
  const template = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  const dayOff = (day: string) => daysOff.find((d) => d.start_date <= day && d.end_date >= day);

  // --- pointer interactions: positions are applied straight to the DOM once per frame ---

  const minuteAt = (clientY: number) => {
    const rect = columns.current[0]!.getBoundingClientRect();
    return (clientY - rect.top) / PX;
  };
  const dayAt = (clientX: number) => {
    const rects = columns.current.map((c) => c!.getBoundingClientRect());
    const i = rects.findIndex((r) => clientX < r.right);
    return i === -1 ? rects.length - 1 : i;
  };

  function render(s: Session) {
    s.frame = 0;
    if (s.kind === "create") {
      const a = snap(minuteAt(s.y), SNAP);
      const b = snap(minuteAt(s.lastY), SNAP);
      const start = Math.max(0, Math.min(a, b));
      const end = Math.min(MINUTES_PER_DAY, Math.max(a, b, start + SNAP));
      s.result = { date: days[s.dayIndex], start, end };
      const col = columns.current[s.dayIndex]!;
      const g = ghost.current!;
      g.style.display = "block";
      g.style.top = `${start * PX}px`;
      g.style.height = `${(end - start) * PX}px`;
      g.style.left = `${col.offsetLeft + 2}px`;
      g.style.width = `${col.offsetWidth - 4}px`;
      g.textContent = `${timeOf(start)} – ${timeOf(end)}`;
      return;
    }
    const p = s.placed!;
    const realEnd = minutesOf(p.occurrence.end_time!);
    const length = realEnd - p.start;
    const dy = (s.lastY - s.y) / PX;
    let start = p.start;
    let end = realEnd;
    let dayIndex = s.dayIndex;
    if (s.kind === "move") {
      start = Math.max(0, Math.min(MINUTES_PER_DAY - length, snap(p.start + dy)));
      end = start + length;
      dayIndex = dayAt(s.lastX);
      const dx = columns.current[dayIndex]!.offsetLeft - columns.current[s.dayIndex]!.offsetLeft;
      s.el!.style.transform = `translate3d(${dx}px, ${(start - p.start) * PX}px, 0)`;
    } else {
      end = Math.max(start + SNAP, Math.min(MINUTES_PER_DAY, snap(realEnd + dy)));
      s.el!.style.height = `${Math.max(end - start, 20) * PX - 2}px`;
    }
    s.result = { date: days[dayIndex], start, end };
    const label = s.el!.querySelector<HTMLElement>("[data-time]");
    if (label) label.textContent = `${timeOf(start)} – ${timeOf(end)}`;
  }

  function begin(e: React.PointerEvent, s: Omit<Session, "x" | "y" | "lastX" | "lastY" | "moved" | "frame">) {
    if (e.button !== 0) return;
    const state: Session = { ...s, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, frame: 0 };
    session.current = state;

    const move = (ev: PointerEvent) => {
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      if (!state.moved && Math.hypot(ev.clientX - state.x, ev.clientY - state.y) < THRESHOLD) return;
      state.moved = true;
      if (!state.frame) state.frame = requestAnimationFrame(() => render(state));
    };
    const end = (ev: PointerEvent) => {
      if (state.frame) cancelAnimationFrame(state.frame);
      const cancelled = ev.type === "pointercancel";
      if (state.moved && !cancelled) render(state);
      cleanup.current();
      if (cancelled) return;
      if (state.kind === "create") {
        const start = Math.max(0, Math.min(MINUTES_PER_DAY - 60, Math.floor(minuteAt(state.y) / 30) * 30));
        const range = state.moved && state.result ? state.result : { date: days[state.dayIndex], start, end: start + 60 };
        onCreate({ date: range.date, startTime: timeOf(range.start), endTime: timeOf(range.end) });
        return;
      }
      if (!state.moved || !state.result) return; // a plain click opens the event
      const p = state.placed!;
      const r = state.result;
      // The click that ends a drag must not open the event.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (r.date !== p.occurrence.start_date || r.start !== p.start || r.end !== minutesOf(p.occurrence.end_time!)) {
        onMove(p.occurrence, r);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (ghost.current) ghost.current.style.display = "none";
      if (state.el) {
        state.el.style.transform = "";
        state.el.style.height = "";
      }
      session.current = null;
      cleanup.current = () => {};
    };
  }

  return (
    <div
      role="grid"
      aria-label={days.length === 1 ? "Day" : "Week"}
      className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-stone-100 bg-white shadow-[0_8px_30px_rgba(120,100,80,0.06)] [--grid-line:#f1ece6] dark:border-zinc-800 dark:bg-zinc-900 dark:[--grid-line:#27272a]"
    >
      {/* Day headers */}
      <div role="row" className="grid border-b border-stone-100 dark:border-zinc-800" style={template}>
        <div />
        {days.map((day) => {
          const off = dayOff(day);
          return (
            <div role="columnheader" key={day} aria-label={longDay(day)} className={`flex flex-col items-center gap-0.5 py-2 ${off ? "bg-[#f2c14e]/10" : ""}`}>
              <span className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase">{SHORT_WEEKDAY.format(new Date(`${day}T12:00:00`))}</span>
              <button
                type="button"
                aria-label={`Show ${longDay(day)}`}
                onClick={() => onShowDay?.(day)}
                className={`grid size-8 place-items-center rounded-full text-base transition hover:bg-stone-100 dark:hover:bg-zinc-800 ${
                  day === today ? "font-semibold text-[#ff7a6b] ring-2 ring-[#ff7a6b]" : "text-stone-700 dark:text-zinc-200"
                }`}
              >
                {Number(day.slice(8))}
              </button>
              {off && <span className="max-w-full truncate px-1 text-[10px] text-[#9a7612] dark:text-[#f2c14e]">🌴 {off.label || "Day off"}</span>}
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      <div role="row" aria-label="All day" className="grid border-b border-stone-100 dark:border-zinc-800" style={template}>
        <div className="self-center pr-2 text-right text-[10px] text-stone-400">all-day</div>
        <div className="relative" style={{ gridColumn: `2 / span ${days.length}` }}>
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day) => (
              <div
                key={day}
                data-all-day={day}
                aria-hidden
                onClick={() => onCreate({ date: day })}
                className="cursor-pointer border-l border-stone-100 hover:bg-stone-50/80 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
              />
            ))}
          </div>
          <div
            className="pointer-events-none relative grid py-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(lanes, 1)}, 1.4rem)` }}
          >
            {segments.map((s) => (
              <EventBar key={`${s.occurrence.id}-${s.occurrence.occurrence_date}`} segment={s} onOpen={onOpen} rowOffset={1} />
            ))}
          </div>
        </div>
      </div>

      {/* Hours */}
      <div ref={scroller} className="h-[32rem] overflow-y-auto overscroll-contain md:h-[calc(100vh-17rem)] md:min-h-[24rem]">
        <div className="relative grid" style={{ ...template, height: 24 * HOUR_PX }}>
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-stone-400 tabular-nums" style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day, dayIndex) => {
            const placed = layoutDay(occurrences.filter((o) => o.start_date === day));
            const off = dayOff(day);
            return (
              <div
                key={day}
                ref={(el) => {
                  columns.current[dayIndex] = el;
                }}
                data-col-day={day}
                aria-label={`Hours of ${longDay(day)}`}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) begin(e, { kind: "create", dayIndex });
                }}
                className={`relative cursor-cell touch-pan-y border-l border-stone-100 select-none dark:border-zinc-800 ${off ? "bg-[#f2c14e]/5" : ""}`}
                style={{
                  backgroundImage: "linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_PX}px`,
                }}
              >
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-stone-500/[0.035] dark:bg-black/20" style={{ height: workStart * PX }} />
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-stone-500/[0.035] dark:bg-black/20" style={{ top: workEnd * PX }} />
                {placed.map((p) => (
                  <TimedEvent key={`${p.occurrence.id}-${p.occurrence.occurrence_date}`} placed={p} onOpen={onOpen} onPress={(e, kind, el) => begin(e, { kind, dayIndex, placed: p, el })} />
                ))}
                {day === today && (
                  <div aria-label="Now" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-[#ff7a6b]" style={{ top: now * PX }}>
                    <span className="absolute -top-[5px] -left-[5px] size-3 rounded-full bg-[#ff7a6b]" />
                  </div>
                )}
              </div>
            );
          })}
          <div
            ref={ghost}
            aria-hidden
            data-testid="new-event-ghost"
            className="pointer-events-none absolute z-20 hidden rounded-xl border-2 border-dashed border-[#ff7a6b] bg-[#ff7a6b]/15 px-2 py-1 text-[11px] font-semibold text-[#b8483b] dark:text-[#ffb3a9]"
          />
        </div>
      </div>
    </div>
  );
}

type TimedEventProps = {
  placed: Placed;
  onOpen: (o: Occurrence) => void;
  onPress: (e: React.PointerEvent, kind: "move" | "resize", el: HTMLElement) => void;
};

function TimedEvent({ placed, onOpen, onPress }: TimedEventProps) {
  const { occurrence: o, start, end, col, cols } = placed;
  const times = `${formatTime(o.start_time!)} – ${formatTime(o.end_time!)}`;
  const short = end - start < 45;
  return (
    <button
      type="button"
      aria-label={`${o.title}, ${times}`}
      onClick={() => onOpen(o)}
      onPointerDown={(e) => {
        // Touch keeps scrolling the grid; mouse and pen drag the event.
        if (e.pointerType === "touch") return;
        e.preventDefault();
        onPress(e, "move", e.currentTarget);
      }}
      className="group absolute z-[1] flex cursor-grab touch-pan-y flex-col overflow-hidden rounded-xl border-l-[3px] px-2 py-0.5 text-left text-[11px] leading-tight text-(--label) shadow-[0_2px_8px_rgba(120,100,80,0.08)] select-none hover:z-[2] hover:brightness-[0.97] active:cursor-grabbing dark:text-(--label-dark)"
      style={
        {
          top: start * PX + 1,
          height: (end - start) * PX - 2,
          left: `calc(${(col / cols) * 100}% + 2px)`,
          width: `calc(${100 / cols}% - 4px)`,
          background: withAlpha(o.color, 0.2),
          borderColor: o.color,
          willChange: "transform",
          "--label": darken(o.color, 0.5),
          "--label-dark": lighten(o.color, 0.5),
        } as React.CSSProperties
      }
    >
      <span className={`truncate font-semibold ${short ? "inline" : "block"}`}>
        {o.title}
        {short && <span data-time className="ml-1 font-normal opacity-75">{formatTime(o.start_time!)}</span>}
      </span>
      {!short && (
        <span data-time className="truncate opacity-75">
          {times}
        </span>
      )}
      {!short && o.location && <span className="truncate opacity-60">{o.location}</span>}
      <span
        aria-hidden
        data-resize
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return;
          e.preventDefault();
          e.stopPropagation();
          onPress(e, "resize", e.currentTarget.parentElement as HTMLElement);
        }}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
      />
    </button>
  );
}
