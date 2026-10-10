"use client";

import { useState } from "react";
import { Button, Message } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { PALETTE } from "@/lib/colors";
import type { Category } from "@/lib/timeline/types";

type CategoryInput = Omit<Category, "id">;

type Props = {
  categories: Category[];
  onCreate: (input: CategoryInput) => Promise<void>;
  onUpdate: (id: string, input: CategoryInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};


const inputClass =
  "min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300";
const smallButton =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

function message(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return "A category with this name already exists.";
  return (err as Error).message;
}

/** Create, rename, recolor and delete the user's categories. */
export function CategoryManager({ categories, onCreate, onUpdate, onDelete }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[categories.length % PALETTE.length]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    setError(null);
    setPending(true);
    try {
      await onCreate({ name: name.trim(), color });
      setName("");
      setColor(PALETTE[(categories.length + 1) % PALETTE.length]);
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {categories.length === 0 && <p className="text-sm text-zinc-500">No categories yet.</p>}
      <ul className="flex flex-col gap-2">
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">New category</h3>
        {error && <Message kind="error">{error}</Message>}
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="New category color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-300 dark:border-zinc-700"
          />
          <input
            aria-label="New category name"
            placeholder="e.g. Family"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={inputClass}
          />
          <Button type="submit" disabled={pending} className="shrink-0 px-3 py-1.5">
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}

function CategoryRow({
  category,
  onUpdate,
  onDelete,
}: {
  category: Category;
  onUpdate: Props["onUpdate"];
  onDelete: Props["onDelete"];
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = name.trim() !== category.name || color !== category.color;

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${category.name} color`}
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-300 dark:border-zinc-700"
        />
        <input
          aria-label={`${category.name} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className={inputClass}
        />
        {confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => onDelete(category.id))}
              className="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
            >
              Delete
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={smallButton}>
              Keep
            </button>
          </>
        ) : dirty ? (
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() => run(() => onUpdate(category.id, { name: name.trim(), color }))}
            className={smallButton}
          >
            Save
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Delete ${category.name}`}
            onClick={() => setConfirming(true)}
            className={smallButton}
          >
            Delete…
          </button>
        )}
      </div>
      {confirming && <p className="text-xs text-zinc-500">Its events stay on the timeline without a category.</p>}
      {error && <Message kind="error">{error}</Message>}
    </li>
  );
}
