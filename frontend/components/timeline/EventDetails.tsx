import { formatSpan } from "@/lib/timeline/dates";
import type { Category, TimelineEvent } from "@/lib/timeline/types";

type Props = {
  event: TimelineEvent;
  category?: Category;
  onClose: () => void;
};

export function EventDetails({ event, category, onClose }: Props) {
  return (
    <aside
      aria-label="Event details"
      className="flex w-full flex-col gap-3 border-t border-zinc-200 p-4 md:w-96 md:border-t-0 md:border-l dark:border-zinc-800"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold break-words">{event.title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md px-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ×
        </button>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{formatSpan(event.start, event.end)}</p>
      {category && (
        <p className="flex items-center gap-2 text-sm">
          <span className="size-3 rounded-full" style={{ backgroundColor: category.color }} />
          {category.name}
        </p>
      )}
      {event.description && <p className="text-sm whitespace-pre-wrap">{event.description}</p>}
    </aside>
  );
}
