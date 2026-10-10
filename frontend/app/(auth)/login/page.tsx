"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    // On success AuthGate redirects to the app.
    if (error) setError(error.message);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Log in</h1>
      {error && <Message kind="error">{error}</Message>}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-zinc-500">
        No account?{" "}
        <Link href="/signup" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Sign up
        </Link>
      </p>
    </form>
  );
}
