-- Timeline module: profiles, categories, events, event media + photo storage.
-- Every row belongs to one user; RLS restricts all access to the owner.
-- Applied as migration `0001_timeline`. Wrapped in a transaction: all or nothing.

begin;

-- Shared trigger: keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: per-user settings. birth_date centers the timeline's initial view.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Categories: user-defined, with a user-chosen color (#rrggbb).
-- ---------------------------------------------------------------------------
create table public.timeline_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets events reference (id, user_id) so a category can't be another user's.
  unique (id, user_id)
);

create unique index timeline_categories_user_name_key
  on public.timeline_categories (user_id, lower(trim(name)));

create trigger timeline_categories_set_updated_at
  before update on public.timeline_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Events: a point (end_date null) or a period. Partial dates are stored as the
-- first day of the period they describe plus a precision:
--   year  -> 2015-01-01, month -> 2015-06-01, day -> 2015-06-17.
-- ---------------------------------------------------------------------------
create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  start_date date not null,
  start_precision text not null default 'day' check (start_precision in ('year', 'month', 'day')),
  end_date date,
  end_precision text check (end_precision in ('year', 'month', 'day')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),
  -- Category must belong to the same user; deleting it only clears category_id.
  foreign key (category_id, user_id)
    references public.timeline_categories (id, user_id)
    on delete set null (category_id),

  constraint end_date_and_precision_together check ((end_date is null) = (end_precision is null)),
  constraint end_not_before_start check (end_date is null or end_date >= start_date),
  constraint start_matches_precision check (
    (start_precision <> 'month' or extract(day from start_date) = 1)
    and (start_precision <> 'year' or (extract(day from start_date) = 1 and extract(month from start_date) = 1))
  ),
  constraint end_matches_precision check (
    end_date is null
    or ((end_precision <> 'month' or extract(day from end_date) = 1)
        and (end_precision <> 'year' or (extract(day from end_date) = 1 and extract(month from end_date) = 1)))
  )
);

create index timeline_events_user_start_idx on public.timeline_events (user_id, start_date);
create index timeline_events_category_idx on public.timeline_events (category_id);

create trigger timeline_events_set_updated_at
  before update on public.timeline_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event media: photos stored in the private `timeline-media` bucket.
-- Paths: {user_id}/{event_id}/{media_id}-display.webp and -thumb.webp
-- ---------------------------------------------------------------------------
create table public.timeline_event_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null,
  storage_path text not null unique,
  thumb_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 500),
  position integer not null default 0,
  width integer check (width > 0),
  height integer check (height > 0),
  created_at timestamptz not null default now(),

  foreign key (event_id, user_id)
    references public.timeline_events (id, user_id)
    on delete cascade,
  -- Files must live in the owner's folder.
  constraint storage_path_in_user_folder check (storage_path like user_id::text || '/%'),
  constraint thumb_path_in_user_folder check (thumb_path like user_id::text || '/%')
);

create index timeline_event_media_event_idx on public.timeline_event_media (event_id, position);

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only access for logged-in users; nothing for anon.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.timeline_categories enable row level security;
alter table public.timeline_events enable row level security;
alter table public.timeline_event_media enable row level security;

revoke all on public.profiles, public.timeline_categories, public.timeline_events, public.timeline_event_media from anon;
grant select, insert, update, delete
  on public.profiles, public.timeline_categories, public.timeline_events, public.timeline_event_media
  to authenticated;

create policy "Owner access" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Owner access" on public.timeline_categories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.timeline_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owner access" on public.timeline_event_media
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private bucket; each user may only touch files in their own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('timeline-media', 'timeline-media', false, 10485760, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "Timeline media: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'timeline-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Timeline media: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'timeline-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Timeline media: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'timeline-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Timeline media: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'timeline-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
