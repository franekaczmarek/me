"use client";

import { useState } from "react";
import type { MailAccount } from "@/lib/mail/types";
import { AccountsCard } from "./AccountsCard";
import { DigestView } from "./DigestView";

/** The Mail tab: Claude's digest of the unread mail (main column) and the connected inboxes (side column). */
export function MailModule() {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4 bg-[#faf7f2] p-4 md:flex-row md:p-6 dark:bg-zinc-950">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <DigestView accounts={accounts} />
      </div>
      <div className="flex w-full flex-col gap-4 md:w-96">
        <AccountsCard onChange={setAccounts} />
      </div>
    </div>
  );
}
