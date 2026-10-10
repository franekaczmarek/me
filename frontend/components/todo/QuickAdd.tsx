"use client";

import { useState } from "react";

type Props = {
  label: string;
  onAdd: (title: string) => Promise<void>;
};

/** One-line "type and press Enter" task input. */
export function QuickAdd({ label, onAdd }: Props) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onAdd(title.trim());
      setTitle("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="px-3 pt-1">
      <input
        aria-label={label}
        placeholder="+ Add a task"
        value={title}
        disabled={pending}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-xl bg-transparent px-2 py-1.5 text-sm text-stone-700 outline-none placeholder:text-stone-400 focus:bg-stone-50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-800"
      />
      {error && <p className="px-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}
