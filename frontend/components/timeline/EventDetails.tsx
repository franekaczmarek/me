"use client";

import { useState } from "react";
import { Message } from "@/components/ui";
import { formatSpan } from "@/lib/timeline/dates";
import type { Category, TimelineEvent } from "@/lib/timeline/types";
import { EventPhotos } from "./EventPhotos";

type Props = {
  event: TimelineEvent;
  category?: Category;
  onEdit: () => void;
  onDelete: () => Promise<void>;
};

const secondaryButton = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function EventDetails({ event, category, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmDelete() {
    setError(null);
    setPending(true);
    try {
      await onDelete();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold break-words">{event.title}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{formatSpan(event.start, event.end)}</p>
      {category && (
        <p className="flex items-center gap-2 text-sm">
          <span className="size-3 rounded-full" style={{ backgroundColor: category.color }} />
          {category.name}
        </p>
      )}
      {event.description && <p className="text-sm whitespace-pre-wrap">{event.description}</p>}
      {error && <Message kind="error">{error}</Message>}
      {confirming ? (
        <div className="flex items-center gap-2 text-sm">
          <span>Delete this event and its photos?</span>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={pending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-500 disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={secondaryButton}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className={secondaryButton}>
            Edit
          </button>
          <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
            Delete…
          </button>
        </div>
      )}
      <EventPhotos eventId={event.id} />
    </div>
  );
}
