"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Message } from "@/components/ui";
import { profileApi, timelineApi } from "@/lib/timeline/api";
import { initialWindow } from "@/lib/timeline/dates";
import { toItems } from "@/lib/timeline/items";
import type { Category, Profile, TimelineEvent } from "@/lib/timeline/types";
import { EventDetails } from "./EventDetails";
import { TimelineView } from "./TimelineView";

type Data = { events: TimelineEvent[]; categories: Category[]; profile: Profile };

export function TimelineModule() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selected = data.events.find((e) => e.id === selectedId);
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <div className="flex flex-1 flex-col">
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
        <TimelineView items={items} home={home} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      {selected && (
        <EventDetails
          event={selected}
          category={data.categories.find((c) => c.id === selected.category_id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
