-- 대회: 관리자가 날짜를 지정. 그 날짜의 경기는 대회 기록으로만 집계하고 평소 통계에서 제외
create table if not exists public.events (
  id text primary key,
  date date not null unique,
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
grant select on public.events to anon, authenticated;
grant insert, update on public.events to authenticated;

drop policy if exists "read events" on public.events;
drop policy if exists "admin insert events" on public.events;
drop policy if exists "admin update events" on public.events;
create policy "read events" on public.events for select to anon, authenticated using (true);
create policy "admin insert events" on public.events for insert to authenticated with check (public.is_admin());
create policy "admin update events" on public.events for update to authenticated using (public.is_admin()) with check (public.is_admin());
