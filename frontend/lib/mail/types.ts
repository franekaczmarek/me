/** A connected Gmail inbox (the app password is never sent back). */
export type MailAccount = {
  id: string;
  email: string;
  label: string;
  color: string;
  created_at: string;
};

export type MailAccountInput = { email: string; app_password: string; label: string; color: string };

export type MailAccountPatch = Partial<Pick<MailAccountInput, "label" | "color" | "app_password">>;

export type Importance = "low" | "normal" | "high";

/** Gmail inbox tab the email arrived in. */
export type MailCategory = "primary" | "social" | "promotions" | "updates" | "forums";

/** An email covered by a digest, with Claude's one-line summary. */
export type MailMessage = {
  id: string;
  account_id: string;
  sender: string;
  subject: string;
  received_at: string | null;
  category: MailCategory;
  /** The user's own Gmail labels ("Invoices"). */
  labels: string[];
  summary: string;
  importance: Importance;
  marked_read: boolean;
};

/** A task Claude proposed from one or more emails (created only when accepted). */
export type MailProposal = {
  id: string;
  title: string;
  planned_date: string;
  deadline: string | null;
  duration_min: number | null;
  priority: Importance;
  reason: string;
  mail_ids: string[];
  status: "pending" | "accepted" | "dismissed";
};

export type Digest = {
  id: string;
  summary: string;
  proposals: MailProposal[];
  created_at: string;
  applied_at: string | null;
  messages: MailMessage[];
};

/** `digest` is null when there was no new unread mail. */
export type DigestResult = { digest: Digest | null; warnings: string[] };

/** A proposal the user accepted, with their edits. */
export type AcceptedTask = Pick<MailProposal, "title" | "planned_date" | "deadline" | "duration_min" | "priority"> & { proposal_id: string };

export type ApplyResult = { created: number; dismissed: number; marked: number; warnings: string[] };
