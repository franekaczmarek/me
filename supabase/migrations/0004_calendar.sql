-- Calendar events (all-day or timed, optionally repeating) and their links to to-do tasks.
-- Times are local wall-clock times (date + time, no time zone), like every other date in the app.
-- Applied as migration `0004_calendar`. Wrapped in a transaction: all or nothing.

begin;

-- ---------------------------------------------------------------------------
-- Events. All-day: start_time and end_time are null; end_date is inclusive.
-- Timed: both times set; the event runs from start_date start_time to end_date end_time.
-- recurrence repeats the whole event (weekly | monthly | yearly) until recurrence_until.
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 5000),
  location text not null default '' check (char_length(location) <= 200),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  color text not null default '#56a8f5' check (color ~ '^#[0-9a-f]{6}$'),
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly', 'yearly')),
  recurrence_until date,
  -- Copy to the life timeline once the event has happened.
  add_to_timeline boolean not null default false,
  timeline_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),
  foreign key (timeline_event_id, user_id)
    references public.timeline_events (id, user_id)
    on delete set null (timeline_event_id),

  constraint end_not_before_start check (end_date >= start_date),
  constraint times_together check ((start_time is null) = (end_time is null)),
  constraint timed_end_after_start check (
    start_time is null or end_date > start_date or end_time > start_time
  ),
  constraint until_not_before_start check (recurrence_until is null or recurrence_until >= start_date)
);

create index calendar_events_user_start_idx on public.calendar_events (user_id, start_date);
create index calendar_events_timeline_user_idx on public.calendar_events (timeline_event_id, user_id);

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks created from an event occurrence ("Buy a present" before a birthday).
-- ---------------------------------------------------------------------------
alter table public.todo_tasks add constraint todo_tasks_id_user_key unique (id, user_id);
alter table public.todo_tasks
  add column source_event_id uuid,
  add column source_occurrence_date date,
  add foreign key (source_event_id, user_id)
    references public.calendar_events (id, user_id)
    on delete set null (source_event_id);

create index todo_tasks_source_event_user_idx on public.todo_tasks (source_event_id, user_id);

-- Suggestions already handled per occurrence: accepted (task created) or dismissed (never suggest again).
create table public.calendar_task_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null,
  occurrence_date date not null,
  -- Normalized task title, so the same suggestion is recognised again.
  title_key text not null check (char_length(title_key) between 1 and 200),
  status text not null check (status in ('accepted', 'dismissed')),
  task_id uuid,
  created_at timestamptz not null default now(),

  foreign key (event_id, user_id)
    references public.calendar_events (id, user_id)
    on delete cascade,
  foreign key (task_id, user_id)
    references public.todo_tasks (id, user_id)
    on delete set null (task_id),
  unique (event_id, occurrence_date, title_key)
);

create index calendar_task_links_user_idx on public.calendar_task_links (user_id);
create index calendar_task_links_task_user_idx on public.calendar_task_links (task_id, user_id);
create index calendar_task_links_event_user_idx on public.calendar_task_links (event_id, user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only access for logged-in users; nothing for anon.
-- ---------------------------------------------------------------------------
alter table public.calendar_events enable row level security;
alter table public.calendar_task_links enable row level security;

revoke all on public.calendar_events, public.calendar_task_links from anon;
grant select, insert, update, delete on public.calendar_events, public.calendar_task_links to authenticated;

create policy "Owner access" on public.calendar_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.calendar_task_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
