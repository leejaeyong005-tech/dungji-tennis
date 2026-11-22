-- 기수: 관리자가 이름과 기간(시작일~종료일)을 정하고 언제든 수정 가능
create table if not exists public.seasons (
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (start_date <= end_date)
);
alter table public.seasons enable row level security;
grant select on public.seasons to anon, authenticated;
grant insert, update on public.seasons to authenticated;

drop policy if exists "read seasons" on public.seasons;
drop policy if exists "admin insert seasons" on public.seasons;
drop policy if exists "admin update seasons" on public.seasons;
create policy "read seasons" on public.seasons for select to anon, authenticated using (true);
create policy "admin insert seasons" on public.seasons for insert to authenticated with check (public.is_admin());
create policy "admin update seasons" on public.seasons for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 기수 단위 (다음 기수 자동 제안용): quarter | half | year
alter table public.settings add column if not exists season_unit text not null default 'half';
alter table public.settings drop constraint if exists settings_season_unit_check;
alter table public.settings add constraint settings_season_unit_check check (season_unit in ('quarter', 'half', 'year'));
