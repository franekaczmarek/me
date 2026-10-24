"use client";

import { useState } from "react";
import type { MailAccount } from "@/lib/mail/types";
import { AccountsCard } from "./AccountsCard";

const card =
  "rounded-3xl border border-stone-100 bg-white p-6 shadow-[0_8px_30px_rgba(120,100,80,0.06)] dark:border-zinc-800 dark:bg-zinc-900";

/** The Mail tab: what's new in the connected Gmail inboxes (main column) and the inboxes (side column). */
export function MailModule() {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:flex-row md:p-6 dark:bg-zinc-950">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <section aria-label="New mail" className={card}>
          <h2 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">New mail</h2>
          <p className="mt-1 text-sm text-stone-500">
            {accounts?.length === 0
              ? "Connect a Gmail inbox to get a short summary of your unread mail and tasks to add from it."
              : "Claude reads your unread mail from every Gmail category, sums it up and proposes tasks."}
          </p>
        </section>
      </div>
      <div className="flex w-full flex-col gap-4 md:w-96">
        <AccountsCard onChange={setAccounts} />
      </div>
    </div>
  );
}
