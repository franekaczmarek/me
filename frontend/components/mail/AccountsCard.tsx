"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Message } from "@/components/ui";
import { PALETTE } from "@/lib/colors";
import { mailApi } from "@/lib/mail/api";
import type { MailAccount } from "@/lib/mail/types";

const card =
  "rounded-3xl border border-stone-100 bg-white p-5 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900";
const input =
  "rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-stone-400 dark:border-zinc-700 dark:bg-zinc-900";
const darkPill =
  "rounded-full bg-stone-800 px-4 py-1.5 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const smallButton = "rounded-full px-2 py-0.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-zinc-800";

/** The connected Gmail inboxes: add one with an app password, change its password, remove it. */
export function AccountsCard({ onChange }: { onChange?: (accounts: MailAccount[]) => void }) {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const show = useCallback((list: MailAccount[]) => {
    setAccounts(list);
    onChangeRef.current?.(list);
  }, []);

  async function reload() {
    show(await mailApi.accounts());
  }

  useEffect(() => {
    // An answer that arrives after a remount (or a later reload) is stale.
    let current = true;
    mailApi
      .accounts()
      .then((list) => current && show(list))
      .catch((e: Error) => current && setError(`Could not load your inboxes: ${e.message}`));
    return () => {
      current = false;
    };
  }, [show]);

  /** Runs a change, then reloads from the server; returns whether it worked. */
  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  const formOpen = adding || accounts?.length === 0;

  return (
    <section aria-label="Inboxes" className={card}>
      <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">Inboxes</h2>
      <p className="mt-1 text-xs text-stone-500">Gmail inboxes Claude reads unread mail from.</p>
      {error && (
        <div className="mt-3">
          <Message kind="error">{error}</Message>
        </div>
      )}
      {accounts === null && !error && <p className="mt-3 text-sm text-stone-500">Loading…</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {accounts?.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            onPassword={(password) => run(() => mailApi.updateAccount(a.id, { app_password: password }))}
            onRemove={() => run(() => mailApi.deleteAccount(a.id))}
          />
        ))}
      </ul>
      {accounts !== null &&
        (formOpen ? (
          <AddForm
            usedColors={accounts.map((a) => a.color)}
            onCancel={accounts.length ? () => setAdding(false) : undefined}
            onAdd={async (input) => {
              const ok = await run(() => mailApi.addAccount(input));
              if (ok) setAdding(false);
              return ok;
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={`mt-3 ${darkPill}`}>
            + Add Gmail
          </button>
        ))}
    </section>
  );
}

function AccountRow({
  account,
  onPassword,
  onRemove,
}: {
  account: MailAccount;
  onPassword: (password: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"idle" | "password" | "remove">("idle");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const name = account.label || account.email;

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setPending(true);
    if (await onPassword(password)) {
      setPassword("");
      setMode("idle");
    }
    setPending(false);
  }

  return (
    <li className="rounded-2xl bg-stone-50 px-3 py-2 dark:bg-zinc-800/50" aria-label={name}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: account.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-800 dark:text-zinc-100">{name}</p>
          {account.label && <p className="truncate text-xs text-stone-500">{account.email}</p>}
        </div>
        {mode === "idle" && (
          <>
            <button type="button" onClick={() => setMode("password")} className={smallButton}>
              New password
            </button>
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => setMode("remove")}
              className="rounded-full px-2 text-stone-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          </>
        )}
      </div>
      {mode === "remove" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-stone-600 dark:text-zinc-300">
          <span className="flex-1">Disconnect this inbox? Its summaries go too.</span>
          <button
            type="button"
            onClick={async () => {
              setPending(true);
              if (!(await onRemove())) setPending(false);
            }}
            disabled={pending}
            className="rounded-full bg-[#ff7a6b] px-3 py-1 font-semibold text-white"
          >
            Remove
          </button>
          <button type="button" onClick={() => setMode("idle")} className={smallButton}>
            Cancel
          </button>
        </div>
      )}
      {mode === "password" && (
        <form onSubmit={savePassword} className="mt-2 flex items-center gap-2" noValidate>
          <input
            type="password"
            aria-label={`New app password for ${account.email}`}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${input} min-w-0 flex-1`}
          />
          <button type="submit" disabled={pending || !password.trim()} className={darkPill}>
            {pending ? "Checking…" : "Save"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className={smallButton}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

function AddForm({
  usedColors,
  onAdd,
  onCancel,
}: {
  usedColors: string[];
  onAdd: (input: { email: string; app_password: string; label: string; color: string }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(() => PALETTE.find((c) => !usedColors.includes(c)) ?? PALETTE[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return setError("Enter the Gmail address and its app password.");
    setError(null);
    setPending(true);
    await onAdd({ email: email.trim(), app_password: password, label: label.trim(), color });
    setPending(false);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add a Gmail inbox"
      className="mt-4 flex flex-col gap-2 rounded-2xl bg-stone-50 p-3 dark:bg-zinc-800/50"
    >
      {error && <Message kind="error">{error}</Message>}
      <input
        type="email"
        aria-label="Gmail address"
        placeholder="you@gmail.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={input}
      />
      <input
        type="password"
        aria-label="App password"
        placeholder="App password (16 letters)"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={input}
      />
      <p className="text-xs text-stone-500">
        Not your Google password: turn on 2-Step Verification, then create an app password at{" "}
        <a
          href="https://myaccount.google.com/apppasswords"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#e0604f] underline-offset-2 hover:underline"
        >
          myaccount.google.com/apppasswords
        </a>
        .
      </p>
      <input
        aria-label="Name"
        placeholder="Name, e.g. Private or Work"
        value={label}
        maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
        className={input}
      />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`size-6 rounded-full transition ${color === c ? "ring-2 ring-stone-400 ring-offset-2 dark:ring-offset-zinc-900" : ""}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={darkPill}>
          {pending ? "Checking with Gmail…" : "Connect inbox"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={smallButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
