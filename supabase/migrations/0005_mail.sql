-- Mail: connected Gmail inboxes (IMAP + app password), Claude digests of unread mail, and the emails
-- they covered. Tasks created from a digest point back to their email.
-- Applied as migration `0005_mail`. Wrapped in a transaction: all or nothing.

begin;

-- ---------------------------------------------------------------------------
-- Inboxes. password_enc is the app password encrypted by the backend (Fernet); the key never
-- reaches the database, and the API never returns this column.
-- ---------------------------------------------------------------------------
create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  label text not null default '' check (char_length(label) <= 60),
  color text not null default '#56a8f5' check (color ~ '^#[0-9a-f]{6}$'),
  password_enc text not null check (char_length(password_enc) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),
  unique (user_id, email)
);

create trigger mail_accounts_set_updated_at
  before update on public.mail_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- One run of "Summarize new mail": Claude's summary and the tasks it proposed.
-- proposals: [{id, title, planned_date, deadline, duration_min, priority, reason, mail_ids, status}],
-- status pending | accepted | dismissed, so the review survives a reload.
-- ---------------------------------------------------------------------------
create table public.mail_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 4000),
  proposals jsonb not null default '[]' check (jsonb_typeof(proposals) = 'array'),
  created_at timestamptz not null default now(),
  applied_at timestamptz,

  unique (id, user_id)
);

create index mail_digests_user_created_idx on public.mail_digests (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Emails covered by a digest. (account_id, message_id) is unique: an email is summarized once.
-- uidvalidity + uid locate it in the inbox to mark it as read later.
-- ---------------------------------------------------------------------------
create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  digest_id uuid not null,
  uidvalidity bigint not null check (uidvalidity > 0),
  uid bigint not null check (uid > 0),
  message_id text not null check (char_length(message_id) between 1 and 998),
  sender text not null default '' check (char_length(sender) <= 300),
  subject text not null default '' check (char_length(subject) <= 500),
  received_at timestamptz,
  category text not null default 'primary'
    check (category in ('primary', 'social', 'promotions', 'updates', 'forums')),
  summary text not null default '' check (char_length(summary) <= 500),
  importance text not null default 'normal' check (importance in ('low', 'normal', 'high')),
  marked_read boolean not null default false,
  created_at timestamptz not null default now(),

  unique (id, user_id),
  unique (account_id, message_id),
  foreign key (account_id, user_id)
    references public.mail_accounts (id, user_id)
    on delete cascade,
  foreign key (digest_id, user_id)
    references public.mail_digests (id, user_id)
    on delete cascade
);

create index mail_messages_account_user_idx on public.mail_messages (account_id, user_id);
create index mail_messages_digest_user_idx on public.mail_messages (digest_id, user_id);
create index mail_messages_user_idx on public.mail_messages (user_id);

-- ---------------------------------------------------------------------------
-- Tasks made from an email.
-- ---------------------------------------------------------------------------
alter table public.todo_tasks
  add column source_mail_id uuid,
  add foreign key (source_mail_id, user_id)
    references public.mail_messages (id, user_id)
    on delete set null (source_mail_id);

create index todo_tasks_source_mail_user_idx on public.todo_tasks (source_mail_id, user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only access for logged-in users; nothing for anon.
-- ---------------------------------------------------------------------------
alter table public.mail_accounts enable row level security;
alter table public.mail_digests enable row level security;
alter table public.mail_messages enable row level security;

revoke all on public.mail_accounts, public.mail_digests, public.mail_messages from anon;
grant select, insert, update, delete on public.mail_accounts, public.mail_digests, public.mail_messages to authenticated;

create policy "Owner access" on public.mail_accounts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.mail_digests
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.mail_messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
