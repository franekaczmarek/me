"use client";

/* eslint-disable @next/next/no-img-element -- photos are private signed URLs; they must not go through the image optimizer */
import { useEffect, useRef, useState } from "react";
import { Message } from "@/components/ui";
import { timelineApi } from "@/lib/timeline/api";
import type { Media } from "@/lib/timeline/types";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const smallButton =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** Photo grid for one event: upload, view large, edit caption, delete. */
export function EventPhotos({ eventId }: { eventId: string }) {
  const [photos, setPhotos] = useState<Media[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Re-fetched each time the panel opens: the signed URLs expire after an hour.
  useEffect(() => {
    timelineApi
      .listMedia(eventId)
      .then(setPhotos)
      .catch((e: Error) => setError(`Could not load photos: ${e.message}`));
  }, [eventId]);

  async function upload(files: File[]) {
    setError(null);
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      try {
        const photo = await timelineApi.uploadMedia(eventId, file);
        setPhotos((current) => [...(current ?? []), photo]);
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setProgress(null);
    if (failed.length) setError(`Some photos were not added. ${failed.join("; ")}`);
    if (fileInput.current) fileInput.current.value = "";
  }

  const open = photos?.find((p) => p.id === openId);

  return (
    <section aria-label="Photos" className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Photos</h3>
        <label className={`${smallButton} cursor-pointer ${progress ? "pointer-events-none opacity-50" : ""}`}>
          Add photos
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            disabled={Boolean(progress)}
            onChange={(e) => upload(Array.from(e.target.files ?? []))}
          />
        </label>
      </div>
      {progress && <p className="text-xs text-zinc-500">{progress}</p>}
      {error && <Message kind="error">{error}</Message>}
      {photos === null && !error && <p className="text-xs text-zinc-500">Loading photos…</p>}
      {photos?.length === 0 && <p className="text-xs text-zinc-500">No photos yet.</p>}
      {photos && photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setOpenId(photo.id)}
                className="block aspect-square w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800"
              >
                <img
                  src={photo.thumb_url ?? ""}
                  alt={photo.caption || "Event photo"}
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <PhotoViewer
          key={open.id}
          photo={open}
          onClose={() => setOpenId(null)}
          onSaved={(saved) => setPhotos((current) => current?.map((p) => (p.id === saved.id ? saved : p)) ?? null)}
          onDeleted={() => {
            setPhotos((current) => current?.filter((p) => p.id !== open.id) ?? null);
            setOpenId(null);
          }}
        />
      )}
    </section>
  );
}

function PhotoViewer({
  photo,
  onClose,
  onSaved,
  onDeleted,
}: {
  photo: Media;
  onClose: () => void;
  onSaved: (photo: Media) => void;
  onDeleted: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-3 rounded-lg bg-white p-4 dark:bg-zinc-900">
        <img
          src={photo.url ?? ""}
          alt={photo.caption || "Event photo"}
          className="max-h-[70vh] w-full rounded object-contain"
        />
        {error && <Message kind="error">{error}</Message>}
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Caption"
            placeholder="Add a caption"
            value={caption}
            maxLength={500}
            onChange={(e) => setCaption(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {caption !== photo.caption && (
            <button
              type="button"
              disabled={pending}
              className={smallButton}
              onClick={() => run(async () => onSaved(await timelineApi.updateMedia(photo.id, { caption })))}
            >
              Save caption
            </button>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await timelineApi.deleteMedia(photo.id);
                    onDeleted();
                  })
                }
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50"
              >
                Delete photo
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={smallButton}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={smallButton}>
              Delete…
            </button>
          )}
          <button type="button" onClick={onClose} className={smallButton}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
