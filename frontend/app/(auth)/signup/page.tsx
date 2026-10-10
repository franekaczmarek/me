"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Message } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: String(form.get("email")),
      password,
      options: { emailRedirectTo: `${window.location.origin}/timeline` },
    });
    setPending(false);
    if (error) return setError(error.message);
    // With email confirmation on, there is no session yet.
    if (!data.session) setInfo("Check your email to confirm your account, then log in.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Create account</h1>
      {error && <Message kind="error">{error}</Message>}
      {info && <Message kind="info">{info}</Message>}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Sign up"}
      </Button>
      <p className="text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Log in
        </Link>
      </p>
    </form>
  );
}
