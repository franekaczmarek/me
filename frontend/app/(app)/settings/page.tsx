"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button, Field, Message } from "@/components/ui";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  // Confirms the backend accepts this user's token.
  useEffect(() => {
    api<{ id: string }>("/me")
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  async function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const password = String(form.get("password"));
    setError(null);
    setInfo(null);
    if (password !== String(form.get("confirm"))) return setError("Passwords do not match.");
    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (error) return setError(error.message);
    formEl.reset();
    setInfo("Password changed.");
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Account</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{session?.user.email}</p>
        <p className="text-xs text-zinc-500">
          Backend:{" "}
          {backendOk === null ? "checking…" : backendOk ? "connected" : "not reachable (is it running?)"}
        </p>
      </section>

      <form onSubmit={onChangePassword} className="flex flex-col gap-4">
        <h2 className="font-semibold">Change password</h2>
        {error && <Message kind="error">{error}</Message>}
        {info && <Message kind="info">{info}</Message>}
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}
