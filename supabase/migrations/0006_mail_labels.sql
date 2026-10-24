-- Gmail labels of a summarized email (the user's own labels, e.g. "Invoices"; system ones left out).
-- Mail is read from All Mail, so emails that filters keep out of the inbox are covered too.
-- Applied as migration `0006_mail_labels`.

alter table public.mail_messages
  add column labels text[] not null default '{}'
    check (cardinality(labels) <= 20);
