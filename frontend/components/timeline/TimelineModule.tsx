"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Message } from "@/components/ui";
import { profileApi, timelineApi } from "@/lib/timeline/api";
import { initialWindow } from "@/lib/timeline/dates";
import { toItems } from "@/lib/timeline/items";
import type { Category, EventInput, PartialDate, Profile, TimelineEvent } from "@/lib/timeline/types";
import { EventDetails } from "./EventDetails";
import { EventForm } from "./EventForm";
import { TimelineView } from "./TimelineView";

type Data = { events: TimelineEvent[]; categories: Category[]; profile: Profile };

/** What the side panel shows. */
type Panel = { mode: "view" | "edit"; id: string } | { mode: "new"; start?: PartialDate } | null;

const PANEL_TITLES = { view: "Event details", edit: "Edit event", new: "New event" };

export function TimelineModule() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    Promise.all([timelineApi.listEvents(), timelineApi.listCategories(), profileApi.get()])
      .then(([events, categories, profile]) => setData({ events, categories, profile }))
      .catch((e: Error) => setError(`Could not load the timeline: ${e.message}`));
  }, []);

  const items = useMemo(() => (data ? toItems(data.events, data.categories) : []), [data]);
  const home = useMemo(() => initialWindow(data?.profile.birth_date ?? null), [data?.profile.birth_date]);

  if (error) {
    return (
      <div className="p-6">
        <Message kind="error">{error}</Message>
      </div>
    );
  }
  if (!data) return <p className="p-6 text-sm text-zinc-500">Loading timeline…</p>;

  const setEvents = (update: (events: TimelineEvent[]) => TimelineEvent[]) =>
    setData((d) => d && { ...d, events: update(d.events) });

  async function create(input: EventInput) {
    const created = await timelineApi.createEvent(input);
    setEvents((events) => [...events, created]);
    setPanel({ mode: "view", id: created.id });
  }

  async function update(id: string, input: EventInput) {
    const updated = await timelineApi.updateEvent(id, input);
    setEvents((events) => events.map((e) => (e.id === id ? updated : e)));
    setPanel({ mode: "view", id });
  }

  async function remove(id: string) {
    await timelineApi.deleteEvent(id);
    setEvents((events) => events.filter((e) => e.id !== id));
    setPanel(null);
  }

  const selected = panel && panel.mode !== "new" ? data.events.find((e) => e.id === panel.id) : undefined;

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <Button type="button" onClick={() => setPanel({ mode: "new" })}>
            Add event
          </Button>
          <p className="text-xs text-zinc-500">Or double-click the timeline to add an event on that day.</p>
        </div>
        {data.events.length === 0 && (
          <p className="px-4 pt-3 text-sm text-zinc-500">No events yet. Your timeline is empty.</p>
        )}
        {!data.profile.birth_date && (
          <p className="px-4 pt-3 text-sm text-zinc-500">
            Tip: set your birth date in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>{" "}
            to open the timeline on your life.
          </p>
        )}
        <TimelineView
          items={items}
          home={home}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setPanel(id ? { mode: "view", id } : null)}
          onAdd={(start) => setPanel({ mode: "new", start })}
        />
      </div>
      {panel && (panel.mode === "new" || selected) && (
        <aside
          aria-label={PANEL_TITLES[panel.mode]}
          className="flex w-full flex-col gap-4 overflow-y-auto border-t border-zinc-200 p-4 md:w-96 md:border-t-0 md:border-l dark:border-zinc-800"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{PANEL_TITLES[panel.mode]}</p>
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Close panel"
              className="rounded-md px-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          </div>
          {panel.mode === "new" && (
            <EventForm
              // A new double-click starts a fresh form.
              key={panel.start ?? "new"}
              initial={{ start: panel.start }}
              categories={data.categories}
              submitLabel="Add event"
              onSave={create}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel.mode === "edit" && selected && (
            <EventForm
              key={selected.id}
              initial={selected}
              categories={data.categories}
              submitLabel="Save changes"
              onSave={(input) => update(selected.id, input)}
              onCancel={() => setPanel({ mode: "view", id: selected.id })}
            />
          )}
          {panel.mode === "view" && selected && (
            <EventDetails
              key={selected.id}
              event={selected}
              category={data.categories.find((c) => c.id === selected.category_id)}
              onEdit={() => setPanel({ mode: "edit", id: selected.id })}
              onDelete={() => remove(selected.id)}
            />
          )}
        </aside>
      )}
    </div>
  );
}
