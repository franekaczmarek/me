// Backend calls for the Mail module: connected Gmail inboxes and Claude's digests of unread mail.
import { api } from "@/lib/api";
import { localToday } from "@/lib/todo/api";
import type { AcceptedTask, ApplyResult, Digest, DigestResult, MailAccount, MailAccountInput, MailAccountPatch } from "./types";

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const mailApi = {
  accounts: () => api<MailAccount[]>("/mail/accounts"),
  /** Gmail checks the app password first; a wrong one fails with 400 and nothing is saved. */
  addAccount: (input: MailAccountInput) => api<MailAccount>("/mail/accounts", json("POST", input)),
  updateAccount: (id: string, patch: MailAccountPatch) => api<MailAccount>(`/mail/accounts/${id}`, json("PATCH", patch)),
  deleteAccount: (id: string) => api<void>(`/mail/accounts/${id}`, { method: "DELETE" }),

  /** Claude reads the new unread mail (nothing is marked as read) and saves a digest with proposed tasks. */
  digest: () => api<DigestResult>("/mail/digest", json("POST", { today: localToday() })),
  latestDigest: () => api<Digest | null>("/mail/digest/latest"),
  /** Adds the accepted tasks (as edited), dismisses the others and can mark the digest's emails as read in Gmail. */
  applyDigest: (id: string, accepted: AcceptedTask[], dismissed: string[], markRead: boolean) =>
    api<ApplyResult>(`/mail/digest/${id}/apply`, json("POST", { today: localToday(), accepted, dismissed, mark_read: markRead })),
};
