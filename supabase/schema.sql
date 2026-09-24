-- LSSD RECORDS DATABASE
-- Uruchom w Supabase SQL Editor.
-- Bot korzysta z SERVICE_ROLE_KEY, strona z ANON_KEY + logowaniem użytkownika.

create extension if not exists pgcrypto;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('DTU','SERT','IAD','DEPUTY')),
  title text not null,
  subject text,
  details text not null,
  badge_number text,
  author_discord_id text not null,
  author_discord_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  officer_name text not null,
  badge_number text,
  old_rank text not null,
  new_rank text not null,
  reason text,
  promoted_by text not null,
  promoted_by_discord_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.demotions (
  id uuid primary key default gen_random_uuid(),
  officer_name text not null,
  badge_number text,
  old_rank text not null,
  new_rank text not null,
  reason text,
  demoted_by text not null,
  demoted_by_discord_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.dismissals (
  id uuid primary key default gen_random_uuid(),
  officer_name text not null,
  badge_number text,
  rank text,
  reason text,
  dismissed_by text not null,
  dismissed_by_discord_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists reports_type_idx on public.reports(report_type);
create index if not exists reports_created_idx on public.reports(created_at desc);
create index if not exists promotions_created_idx on public.promotions(created_at desc);
create index if not exists promotions_badge_idx on public.promotions(badge_number);
create index if not exists demotions_created_idx on public.demotions(created_at desc);
create index if not exists demotions_badge_idx on public.demotions(badge_number);
create index if not exists dismissals_created_idx on public.dismissals(created_at desc);
create index if not exists dismissals_badge_idx on public.dismissals(badge_number);

alter table public.reports enable row level security;
alter table public.promotions enable row level security;
alter table public.demotions enable row level security;
alter table public.dismissals enable row level security;

drop policy if exists "authenticated can read reports" on public.reports;
create policy "authenticated can read reports"
on public.reports for select
to authenticated
using (true);

drop policy if exists "authenticated can read promotions" on public.promotions;
create policy "authenticated can read promotions"
on public.promotions for select
to authenticated
using (true);

drop policy if exists "authenticated can read demotions" on public.demotions;
create policy "authenticated can read demotions"
on public.demotions for select
to authenticated
using (true);

drop policy if exists "authenticated can read dismissals" on public.dismissals;
create policy "authenticated can read dismissals"
on public.dismissals for select
to authenticated
using (true);

-- Brak polityk INSERT/UPDATE/DELETE dla zwykłych użytkowników.
-- Zapisy wykonuje bot Discord używający SERVICE_ROLE_KEY po stronie serwera.
