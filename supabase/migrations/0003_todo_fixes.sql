-- Fixes after 0002_todo, plus covering indexes for foreign keys (Supabase performance advisor).
-- Applied as migration `0003_todo_fixes`. Wrapped in a transaction: all or nothing.

begin;

-- A weekly routine without weekdays slipped through: cardinality(null) is null, which passes a check.
alter table public.todo_routines drop constraint weekly_needs_weekdays;
alter table public.todo_routines
  add constraint weekly_needs_weekdays check (kind <> 'weekly' or coalesce(cardinality(weekdays), 0) > 0);

create index todo_routines_user_idx on public.todo_routines (user_id);
create index todo_tasks_routine_user_idx on public.todo_tasks (routine_id, user_id);
drop index public.todo_tasks_routine_idx;
create index timeline_events_category_user_idx on public.timeline_events (category_id, user_id);
create index timeline_event_media_event_user_idx on public.timeline_event_media (event_id, user_id);
create index timeline_event_media_user_idx on public.timeline_event_media (user_id);

commit;
