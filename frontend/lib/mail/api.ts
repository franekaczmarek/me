// Backend calls for the Mail module: connected Gmail inboxes.
import { api } from "@/lib/api";
import type { MailAccount, MailAccountInput, MailAccountPatch } from "./types";

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const mailApi = {
  accounts: () => api<MailAccount[]>("/mail/accounts"),
  /** Gmail checks the app password first; a wrong one fails with 400 and nothing is saved. */
  addAccount: (input: MailAccountInput) => api<MailAccount>("/mail/accounts", json("POST", input)),
  updateAccount: (id: string, patch: MailAccountPatch) => api<MailAccount>(`/mail/accounts/${id}`, json("PATCH", patch)),
  deleteAccount: (id: string) => api<void>(`/mail/accounts/${id}`, { method: "DELETE" }),
};
