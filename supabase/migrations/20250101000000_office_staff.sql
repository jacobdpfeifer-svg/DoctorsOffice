-- Migration: office_staff table
--
-- Tracks which authenticated users are authorized to operate the front desk
-- for a given office. The desk UI queries this table to enforce membership
-- before starting a Realtime session, and RLS ensures users can only read
-- their own rows.
--
-- Usage:
--   INSERT INTO public.office_staff (user_id, office_id)
--   VALUES ('<auth user uuid>', 'demo');
--
-- Use the Supabase dashboard (Table Editor) or the service-role client to
-- manage rows — the anon/authenticated roles are limited to SELECT on their
-- own rows.

create table if not exists public.office_staff (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  office_id  text        not null,
  created_at timestamptz not null default now(),

  constraint office_staff_user_office_unique unique (user_id, office_id)
);

alter table public.office_staff enable row level security;

-- Staff may read only their own membership rows.
-- DeskView calls: .from("office_staff").select().eq("user_id", user.id).eq("office_id", ...)
create policy "staff can view own memberships"
  on public.office_staff
  for select
  to authenticated
  using (user_id = auth.uid());

-- All mutations are reserved for the service role (admin operations only).
create policy "service role manages staff"
  on public.office_staff
  for all
  to service_role
  using (true)
  with check (true);

-- Speeds up the membership check performed on every desk page load.
create index if not exists office_staff_user_office_idx
  on public.office_staff (user_id, office_id);
