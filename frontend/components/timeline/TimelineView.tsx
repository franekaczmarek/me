"use client";

import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import { useEffect, useRef, useState } from "react";
import type { Timeline, TimelineOptions } from "vis-timeline/standalone";
import { dayOf } from "@/lib/timeline/dates";
import { loadVis } from "@/lib/timeline/vis";
import type { TimelineItem } from "@/lib/timeline/items";
import type { PartialDate } from "@/lib/timeline/types";

const DAY = 24 * 60 * 60 * 1000;

const OPTIONS: TimelineOptions = {
  height: "100%",
  orientation: "top",
  stack: true,
  selectable: true,
  showCurrentTime: true,
  // From a few days up to three centuries on screen.
  zoomMin: 7 * DAY,
  zoomMax: 300 * 365 * DAY,
  margin: { item: 8 },
};

const CONTROLS = ["Home", "Today", "Fit all"] as const;
type Control = (typeof CONTROLS)[number];

type Props = {
  items: TimelineItem[];
  /** Range shown on load and by "Home". */
  home: { start: Date; end: Date };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Double click on an empty spot: add an event on that day. */
  onAdd: (start: PartialDate) => void;
};

/** Zoomable, pannable timeline (vis-timeline), loaded in the browser only. */
export function TimelineView({ items, home, selectedId, onSelect, onAdd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const latest = useRef({ items, home, selectedId, onSelect, onAdd });
  const shownHome = useRef(home);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = { items, home, selectedId, onSelect, onAdd };
  });

  // Create the timeline. Also re-runs when Next.js shows a preserved (hidden) route
  // again: state like `ready` survives, so the new instance gets the current data here.
  useEffect(() => {
    let cancelled = false;
    let timeline: Timeline | null = null;
    loadVis().then(({ Timeline }) => {
      if (cancelled || !containerRef.current) return;
      const { items, home, selectedId } = latest.current;
      timeline = new Timeline(containerRef.current, items, { ...OPTIONS, ...home });
      timeline.setSelection(selectedId ? [selectedId] : []);
      // vis-timeline stays hidden until it redraws after its first range change, and
      // that redraw would only come with the next clock tick (~1 s later).
      const reveal = () => {
        timeline?.off("rangechanged", reveal);
        timeline?.redraw();
      };
      timeline.on("rangechanged", reveal);
      timeline.on("select", ({ items }: { items: string[] }) => latest.current.onSelect(items[0] ?? null));
      timeline.on("doubleClick", ({ item, time }: { item: string | null; time: Date }) => {
        if (!item && time) latest.current.onAdd(dayOf(time));
      });
      shownHome.current = home;
      timelineRef.current = timeline;
      setReady(true);
    });
    return () => {
      cancelled = true;
      timeline?.destroy();
      timelineRef.current = null;
    };
  }, []);

  // Replacing the items keeps the visible window.
  useEffect(() => {
    if (ready) timelineRef.current?.setItems(items);
  }, [items, ready]);

  // Runs after the items effect, so the selection survives item updates.
  useEffect(() => {
    if (ready) timelineRef.current?.setSelection(selectedId ? [selectedId] : []);
  }, [items, selectedId, ready]);

  // Jump to the new home window when it changes (e.g. the birth date was edited).
  const homeStart = home.start.getTime();
  const homeEnd = home.end.getTime();
  useEffect(() => {
    const shown = shownHome.current;
    if (!ready || (shown.start.getTime() === homeStart && shown.end.getTime() === homeEnd)) return;
    shownHome.current = { start: new Date(homeStart), end: new Date(homeEnd) };
    timelineRef.current?.setWindow(homeStart, homeEnd);
  }, [homeStart, homeEnd, ready]);

  function navigate(control: Control) {
    const timeline = timelineRef.current;
    if (control === "Home") timeline?.setWindow(home.start, home.end);
    else if (control === "Today") timeline?.moveTo(new Date());
    else timeline?.fit();
  }

  return (
    <div className="relative flex min-h-80 flex-1 flex-col">
      <div className="absolute right-2 bottom-2 z-10 flex gap-1">
        {CONTROLS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(label)}
            disabled={!ready}
            className="rounded-md border border-zinc-300 bg-white/90 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/90 dark:hover:bg-zinc-800"
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={containerRef} data-testid="timeline" className="me-timeline flex-1" />
    </div>
  );
}
