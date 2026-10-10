"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { darken, lighten, withAlpha } from "@/lib/colors";
import { dayOf } from "@/lib/timeline/dates";
import {
  clampRange,
  fitRange,
  layoutItems,
  MAX_LABEL_WIDTH,
  panBy,
  type Range,
  ticks,
  timeAt,
  zoomAt,
} from "@/lib/timeline/layout";
import type { Category, PartialDate, TimelineEvent } from "@/lib/timeline/types";

// Vertical rhythm (px).
const PAD_TOP = 20;
const LABEL_H = 30;
const POINT_LANE = 40;
const STEM_GAP = 30;
const PERIOD_OFFSET = 50;
const PERIOD_LANE = 42;
const BAR_H = 30;
const PAD_BOTTOM = 28;
const OVERSCAN = 40;
const DOT = 16;

const ZOOM_STEP = 1.6;
const ANIMATION_MS = 280;

const CONTROLS = [
  ["−", "Zoom out"],
  ["+", "Zoom in"],
  ["Home", "Home"],
  ["Today", "Today"],
  ["Fit all", "Fit all"],
] as const;
type Control = (typeof CONTROLS)[number][1];

type Props = {
  events: TimelineEvent[];
  categories: Category[];
  /** Range shown on load and by "Home". */
  home: { start: Date; end: Date };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Double click on an empty spot: add an event on that day. */
  onAdd: (start: PartialDate) => void;
};

const toRange = (home: Props["home"]): Range => clampRange({ start: home.start.getTime(), end: home.end.getTime() });
/** Text colour variables: dark shade on light pages, light shade in dark mode. */
function textColors(color: string): React.CSSProperties {
  return { "--label": darken(color, 0.45), "--label-dark": lighten(color, 0.45) } as React.CSSProperties;
}

/** Same zoom, centred on the current moment. */
function centredOnNow(range: Range): Range {
  const half = (range.end - range.start) / 2;
  const now = Date.now();
  return { start: now - half, end: now + half };
}

const isOnItem = (target: EventTarget) => target instanceof Element && Boolean(target.closest("button"));

/** One horizontal line: events as dots with labels above, periods as rounded bars below. */
export function TimelineView({ events, categories, home, selectedId, onSelect, onAdd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [available, setAvailable] = useState(0);
  const [range, setRange] = useState<Range>(() => toRange(home));
  const rangeRef = useRef(range);
  const animation = useRef<number | null>(null);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Track the container width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth) setWidth(el.clientWidth);
      setAvailable(el.clientHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drag and wheel updates are applied once per frame, however many events arrive.
  const pending = useRef<((r: Range) => Range)[]>([]);
  const frame = useRef<number | null>(null);
  const update = useCallback((change: (r: Range) => Range) => {
    pending.current.push(change);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const changes = pending.current;
      pending.current = [];
      setRange((r) => changes.reduce((acc, f) => f(acc), r));
    });
  }, []);

  useEffect(
    () => () => {
      for (const id of [frame.current, animation.current]) if (id !== null) cancelAnimationFrame(id);
    },
    [],
  );

  const stopAnimation = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };

  /** Smoothly moves to a range (used by the buttons). */
  const animateTo = useCallback((target: Range) => {
    stopAnimation();
    const from = rangeRef.current;
    const to = clampRange(target);
    if (typeof requestAnimationFrame === "undefined") return setRange(to);
    // Timed from the first frame's timestamp: the same clock as every later frame.
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      const p = Math.min(1, (now - started) / ANIMATION_MS);
      const ease = 1 - (1 - p) ** 3;
      setRange({ start: from.start + (to.start - from.start) * ease, end: from.end + (to.end - from.end) * ease });
      animation.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, []);

  // Jump to the new home range when it changes (e.g. the birth date was edited).
  const homeStart = home.start.getTime();
  const homeEnd = home.end.getTime();
  const shownHome = useRef({ start: homeStart, end: homeEnd });
  useEffect(() => {
    if (shownHome.current.start === homeStart && shownHome.current.end === homeEnd) return;
    shownHome.current = { start: homeStart, end: homeEnd };
    animateTo({ start: homeStart, end: homeEnd });
  }, [homeStart, homeEnd, animateTo]);

  // Wheel / trackpad: vertical scroll or pinch zooms around the cursor, horizontal scroll pans.
  // A native listener, because React's wheel listener is passive and can't stop page scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnimation();
      const box = el.getBoundingClientRect();
      const w = box.width || 1000;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        update((r) => panBy(r, -e.deltaX, w));
      } else {
        const anchor = timeAt(e.clientX - box.left, rangeRef.current, w);
        update((r) => zoomAt(r, anchor, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  // Drag to pan; two fingers pinch to zoom.
  const pointers = useRef(new Map<number, number>());
  const dragged = useRef(0);

  function onPointerDown(e: React.PointerEvent) {
    if (isOnItem(e.target)) return;
    stopAnimation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, e.clientX);
    dragged.current = 0;
  }

  function onPointerMove(e: React.PointerEvent) {
    const last = pointers.current.get(e.pointerId);
    if (last === undefined) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 1) {
      const dx = e.clientX - last;
      dragged.current += Math.abs(dx);
      update((r) => panBy(r, dx, width));
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current].find(([id]) => id !== e.pointerId)![1];
      const before = Math.abs(last - other);
      const after = Math.abs(e.clientX - other);
      if (before > 0 && after > 0) {
        const anchor = timeAt((e.clientX + other) / 2 - box.left, rangeRef.current, width);
        update((r) => zoomAt(r, anchor, before / after));
      }
      dragged.current += Math.abs(e.clientX - last);
    }
    pointers.current.set(e.pointerId, e.clientX);
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
  }

  function onClick(e: React.MouseEvent) {
    // A click on empty space (not the end of a drag) clears the selection.
    if (!isOnItem(e.target) && dragged.current < 4) onSelect(null);
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (isOnItem(e.target)) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    onAdd(dayOf(new Date(timeAt(x, rangeRef.current, width))));
  }

  function navigate(control: Control) {
    const r = rangeRef.current;
    const centre = (r.start + r.end) / 2;
    if (control === "Zoom out") animateTo(zoomAt(r, centre, ZOOM_STEP));
    else if (control === "Zoom in") animateTo(zoomAt(r, centre, 1 / ZOOM_STEP));
    else if (control === "Home") animateTo(toRange(home));
    else if (control === "Today") animateTo(centredOnNow(r));
    else animateTo(fitRange(events) ?? toRange(home));
  }

  const layout = useMemo(() => layoutItems(events, categories, range, width), [events, categories, range, width]);
  const scale = useMemo(() => ticks(range, width), [range, width]);

  // Content height; the card grows to fill the page and centres the content vertically.
  const content =
    PAD_TOP + Math.max(1, layout.pointLanes) * POINT_LANE + STEM_GAP + PERIOD_OFFSET +
    Math.max(1, layout.periodLanes) * PERIOD_LANE + PAD_BOTTOM;
  const height = Math.max(content, available);
  const lineY = (height - content) / 2 + PAD_TOP + Math.max(1, layout.pointLanes) * POINT_LANE + STEM_GAP;
  const periodsTop = lineY + PERIOD_OFFSET;
  const labelBottom = (lane: number) => lineY - STEM_GAP + 8 - lane * POINT_LANE;

  const points = layout.points.filter((p) => p.x + p.labelWidth > -OVERSCAN && p.x - p.labelWidth < width + OVERSCAN);
  const periods = layout.periods.filter(
    (p) => p.x2 + (p.labelInside ? 0 : p.labelWidth) > -OVERSCAN && p.x1 < width + OVERSCAN,
  );
  const visible = (x: number) => x > -OVERSCAN && x < width + OVERSCAN;

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex justify-end gap-1.5" role="toolbar" aria-label="Timeline navigation">
        {CONTROLS.map(([label, name]) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            onClick={() => navigate(name)}
            className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition hover:-translate-y-px hover:border-stone-300 hover:shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {label}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        data-testid="timeline"
        className="relative min-h-[340px] flex-1 cursor-grab touch-none overflow-hidden rounded-3xl border border-stone-100 bg-white shadow-[0_8px_30px_rgba(120,100,80,0.08)] select-none active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-900"
        style={{ minHeight: content }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
          {/* Faint guides for decades/years etc. */}
          {scale
            .filter((t) => t.major)
            .map((t) => (
              <line
                key={`g${t.time}`}
                x1={t.x}
                x2={t.x}
                y1={12}
                y2={height - 12}
                className="stroke-stone-100 dark:stroke-zinc-800"
                strokeWidth={1.5}
                strokeDasharray="2 6"
                strokeLinecap="round"
              />
            ))}

          {/* The line, coloured where periods run. */}
          <line
            x1={8}
            x2={width - 8}
            y1={lineY}
            y2={lineY}
            className="stroke-stone-200 dark:stroke-zinc-700"
            strokeWidth={6}
            strokeLinecap="round"
          />
          {periods.map((p) => (
            <line
              key={`seg${p.id}`}
              x1={Math.max(p.x1, 8)}
              x2={Math.min(p.x2, width - 8)}
              y1={lineY}
              y2={lineY}
              stroke={withAlpha(p.color, 0.55)}
              strokeWidth={6}
              strokeLinecap="round"
            />
          ))}
          {points
            .filter((p) => p.span)
            .map((p) => (
              <line
                key={`span${p.id}`}
                x1={p.span![0]}
                x2={p.span![1]}
                y1={lineY}
                y2={lineY}
                stroke={withAlpha(p.color, 0.7)}
                strokeWidth={6}
                strokeDasharray="1 9"
                strokeLinecap="round"
              />
            ))}

          {/* Scale ticks under the line. */}
          {scale.map((t) => (
            <line
              key={`t${t.time}`}
              x1={t.x}
              x2={t.x}
              y1={lineY + 7}
              y2={lineY + (t.major ? 15 : 12)}
              className={t.major ? "stroke-stone-400 dark:stroke-zinc-500" : "stroke-stone-300 dark:stroke-zinc-600"}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}

          {/* Period boundaries on the line and their links down to the bars. */}
          {periods.map((p) =>
            [p.x1, p.x2].filter(visible).map((x, i) => (
              <g key={`b${p.id}${i}`}>
                <line x1={x} x2={x} y1={lineY - 10} y2={lineY + 10} stroke={p.color} strokeWidth={3.5} strokeLinecap="round" />
                <line
                  x1={x}
                  x2={x}
                  y1={lineY + 14}
                  y2={periodsTop + p.lane * PERIOD_LANE}
                  stroke={withAlpha(p.color, 0.35)}
                  strokeWidth={2}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                />
              </g>
            )),
          )}

          {/* Stems from the dots up to their labels. */}
          {points.map((p) => (
            <line
              key={`stem${p.id}`}
              x1={p.x}
              x2={p.x}
              y1={lineY - 8}
              y2={labelBottom(p.lane)}
              stroke={withAlpha(p.color, 0.6)}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          ))}
        </svg>

        {/* Scale labels. */}
        {scale.map((t) => (
          <span
            key={`l${t.time}`}
            className={`pointer-events-none absolute -translate-x-1/2 text-[11px] tracking-wide ${
              t.major ? "font-semibold text-stone-500 dark:text-zinc-400" : "text-stone-400 dark:text-zinc-500"
            }`}
            style={{ left: t.x, top: lineY + 18 }}
          >
            {t.label}
          </span>
        ))}

        {/* Dots on the line. */}
        {points.map((p) => {
          const selected = p.id === selectedId;
          return (
            <span
              key={`dot${p.id}`}
              aria-hidden
              data-dot={p.id}
              // Position follows the line instantly; only the look (size, glow) animates.
              className="pointer-events-none absolute rounded-full transition-[scale,box-shadow] duration-200"
              style={{
                left: p.x - DOT / 2,
                top: lineY - DOT / 2,
                width: DOT,
                height: DOT,
                scale: selected ? 1.35 : 1,
                background: p.span ? "white" : p.color,
                border: `3px solid ${p.span ? p.color : "white"}`,
                boxShadow: selected
                  ? `0 0 0 4px ${withAlpha(p.color, 0.3)}, 0 2px 8px rgba(0,0,0,0.15)`
                  : "0 2px 8px rgba(0,0,0,0.15)",
              }}
            />
          );
        })}

        {/* Event labels above the line. */}
        {points.map((p) => {
          const selected = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              title={p.title}
              data-event-id={p.id}
              data-color={p.color}
              aria-pressed={selected}
              onClick={() => onSelect(p.id)}
              className="absolute text-(--label) dark:text-(--label-dark) -translate-x-1/2 truncate rounded-full px-3 text-sm font-medium whitespace-nowrap transition hover:-translate-y-0.5 hover:shadow-md"
              style={{
                left: p.x,
                top: labelBottom(p.lane) - LABEL_H,
                height: LABEL_H,
                maxWidth: MAX_LABEL_WIDTH,
                background: withAlpha(p.color, selected ? 0.3 : 0.16),
                ...textColors(p.color),
                boxShadow: selected ? `0 0 0 2px ${p.color}, 0 6px 16px ${withAlpha(p.color, 0.35)}` : undefined,
              }}
            >
              {p.title}
            </button>
          );
        })}

        {/* Periods as rounded bars below the line. */}
        {periods.map((p) => {
          const selected = p.id === selectedId;
          const left = Math.max(p.x1, -OVERSCAN);
          const right = Math.min(p.x2, width + OVERSCAN);
          const barWidth = Math.max(right - left, 10);
          const inside = barWidth >= p.labelWidth;
          return (
            <button
              key={p.id}
              type="button"
              title={p.title}
              data-event-id={p.id}
              data-color={p.color}
              aria-pressed={selected}
              onClick={() => onSelect(p.id)}
              className="absolute text-(--label) dark:text-(--label-dark) rounded-full text-left text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-md"
              style={{
                left,
                top: periodsTop + p.lane * PERIOD_LANE,
                width: barWidth,
                height: BAR_H,
                background: withAlpha(p.color, selected ? 0.32 : 0.18),
                border: `2px solid ${withAlpha(p.color, selected ? 1 : 0.55)}`,
                ...textColors(p.color),
                boxShadow: selected ? `0 6px 16px ${withAlpha(p.color, 0.35)}` : undefined,
                paddingLeft: p.x1 < 0 ? -left + 12 : 12,
              }}
            >
              <span
                className={inside ? "block truncate pr-3" : "absolute top-1/2 -translate-y-1/2 whitespace-nowrap"}
                style={inside ? undefined : { left: barWidth + 4 }}
              >
                {p.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
