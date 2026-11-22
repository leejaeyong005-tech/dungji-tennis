-- 관리자 권한 분리
-- 회원(로그인 없음): 경기·선수 추가, 입력 후 24시간 안의 경기만 휴지통으로/되살리기
-- 관리자(admins 테이블에 등록된 계정): 모든 수정

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- players
revoke insert, update on public.players from anon, authenticated;
grant insert (id, name, active) on public.players to anon, authenticated;
grant update on public.players to authenticated;
drop policy if exists "insert players" on public.players;
drop policy if exists "update players" on public.players;
drop policy if exists "admin update players" on public.players;
create policy "insert players" on public.players for insert to anon, authenticated with check (deleted_at is null);
create policy "admin update players" on public.players for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- matches
revoke insert, update on public.matches from anon, authenticated;
grant insert (id, t, date, type, a, b, sa, sb, note) on public.matches to anon, authenticated;
grant update (deleted_at) on public.matches to anon;
grant update on public.matches to authenticated;
drop policy if exists "insert matches" on public.matches;
drop policy if exists "update matches" on public.matches;
drop policy if exists "recent trash" on public.matches;
drop policy if exists "admin update matches" on public.matches;
create policy "insert matches" on public.matches for insert to anon, authenticated with check (deleted_at is null);
create policy "recent trash" on public.matches for update to anon, authenticated
  using (created_at > now() - interval '24 hours') with check (created_at > now() - interval '24 hours');
create policy "admin update matches" on public.matches for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- settings
revoke update on public.settings from anon;
grant update on public.settings to authenticated;
drop policy if exists "update settings" on public.settings;
drop policy if exists "admin update settings" on public.settings;
create policy "admin update settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
