-- To-do module: tasks (scheduled or in the inbox), recurring routines, and a simple work calendar
-- (work days/hours, time available for tasks, days off) used to plan the days.
-- Applied as migration `0002_todo`. Wrapped in a transaction: all or nothing.

begin;

-- ---------------------------------------------------------------------------
-- Routines: recurring items that generate one task per occurrence.
--   daily | weekdays (Mon–Fri) | weekly (on `weekdays`, ISO 1 = Monday … 7 = Sunday)
--   interval (every `interval_days` from `starts_on`) | monthly (on `month_day`)
-- ---------------------------------------------------------------------------
create table public.todo_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 5000),
  kind text not null check (kind in ('daily', 'weekdays', 'weekly', 'interval', 'monthly')),
  weekdays smallint[] check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  interval_days integer check (interval_days between 1 and 366),
  month_day smallint check (month_day between 1 and 31),
  duration_min integer check (duration_min between 1 and 1440),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  active boolean not null default true,
  starts_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),
  constraint weekly_needs_weekdays check (kind <> 'weekly' or cardinality(weekdays) > 0),
  constraint interval_needs_days check (kind <> 'interval' or interval_days is not null),
  constraint monthly_needs_day check (kind <> 'monthly' or month_day is not null)
);

create trigger todo_routines_set_updated_at
  before update on public.todo_routines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks. planned_date null = in the inbox. deadline is optional.
-- status: open | done | missed (a routine occurrence that passed undone).
-- ---------------------------------------------------------------------------
create table public.todo_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 5000),
  planned_date date,
  deadline date,
  duration_min integer check (duration_min between 1 and 1440),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  -- "Must happen that day": the planner never moves it.
  fixed_day boolean not null default false,
  status text not null default 'open' check (status in ('open', 'done', 'missed')),
  completed_at timestamptz,
  -- Kept up to date by the trigger below, for "postponed N times" stats.
  first_planned_date date,
  postponed_count integer not null default 0 check (postponed_count >= 0),
  routine_id uuid,
  occurrence_date date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The routine must belong to the same user; deleting it keeps past occurrences (history).
  foreign key (routine_id, user_id)
    references public.todo_routines (id, user_id)
    on delete set null (routine_id),
  unique (routine_id, occurrence_date),

  constraint done_has_completed_at check ((status = 'done') = (completed_at is not null)),
  constraint fixed_day_needs_date check (not fixed_day or planned_date is not null),
  constraint occurrence_has_date check (routine_id is null or occurrence_date is not null)
);

create index todo_tasks_user_planned_idx on public.todo_tasks (user_id, planned_date);
create index todo_tasks_user_status_idx on public.todo_tasks (user_id, status);
create index todo_tasks_routine_idx on public.todo_tasks (routine_id);

create trigger todo_tasks_set_updated_at
  before update on public.todo_tasks
  for each row execute function public.set_updated_at();

-- Remember the first day a task was planned for, and count moves to a later day.
create or replace function public.todo_track_planning()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_planned_date is null and new.planned_date is not null then
    new.first_planned_date = new.planned_date;
  end if;
  if tg_op = 'UPDATE'
     and old.planned_date is not null
     and (new.planned_date is null or new.planned_date > old.planned_date) then
    new.postponed_count = old.postponed_count + 1;
  end if;
  return new;
end;
$$;

create trigger todo_tasks_track_planning
  before insert or update of planned_date on public.todo_tasks
  for each row execute function public.todo_track_planning();

-- ---------------------------------------------------------------------------
-- Work calendar: one schedule row per user + days off (vacations, holidays).
-- ---------------------------------------------------------------------------
create table public.calendar_work_schedule (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  work_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[]
    check (work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  work_start time not null default '09:00',
  work_end time not null default '17:00',
  -- Time the user wants to spend on tasks on a work day / a day off.
  task_minutes_workday integer not null default 180 check (task_minutes_workday between 0 and 1440),
  task_minutes_day_off integer not null default 360 check (task_minutes_day_off between 0 and 1440),
  updated_at timestamptz not null default now(),

  constraint work_end_after_start check (work_end > work_start)
);

create trigger calendar_work_schedule_set_updated_at
  before update on public.calendar_work_schedule
  for each row execute function public.set_updated_at();

create table public.calendar_days_off (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  label text not null default '' check (char_length(label) <= 100),
  created_at timestamptz not null default now(),

  constraint days_off_end_not_before_start check (end_date >= start_date)
);

create index calendar_days_off_user_idx on public.calendar_days_off (user_id, start_date);

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only access for logged-in users; nothing for anon.
-- ---------------------------------------------------------------------------
alter table public.todo_routines enable row level security;
alter table public.todo_tasks enable row level security;
alter table public.calendar_work_schedule enable row level security;
alter table public.calendar_days_off enable row level security;

revoke all on public.todo_routines, public.todo_tasks, public.calendar_work_schedule, public.calendar_days_off
  from anon;
grant select, insert, update, delete
  on public.todo_routines, public.todo_tasks, public.calendar_work_schedule, public.calendar_days_off
  to authenticated;

create policy "Owner access" on public.todo_routines
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.todo_tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.calendar_work_schedule
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.calendar_days_off
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
