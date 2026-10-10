"use client";

import { useEffect, useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import { profileApi } from "@/lib/timeline/api";
import type { Profile } from "@/lib/timeline/types";

/** Display name and birth date (the timeline opens on the user's life span). */
export function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    profileApi
      .get()
      .then(setProfile)
      .catch((e: Error) => setError(`Could not load the profile: ${e.message}`));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      setProfile(
        await profileApi.update({
          display_name: String(form.get("display_name")).trim() || null,
          birth_date: String(form.get("birth_date")) || null,
        }),
      );
      setInfo("Profile saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h2 className="font-semibold">Profile</h2>
      {error && <Message kind="error">{error}</Message>}
      {info && <Message kind="info">{info}</Message>}
      {profile && (
        <>
          <Field label="Display name" name="display_name" defaultValue={profile.display_name ?? ""} maxLength={100} />
          <Field
            label="Birth date"
            name="birth_date"
            type="date"
            defaultValue={profile.birth_date ?? ""}
            max={new Date().toISOString().slice(0, 10)}
          />
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </>
      )}
    </form>
  );
}
