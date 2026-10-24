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
