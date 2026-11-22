-- 회원 누구나 입력 가능 (로그인 없음). 삭제는 휴지통(deleted_at)으로만.
alter table public.players add column if not exists deleted_at timestamptz;
alter table public.matches add column if not exists deleted_at timestamptz;

revoke delete on public.players, public.matches from anon, authenticated;
grant select, insert, update on public.players, public.matches to anon, authenticated;
grant select, update on public.settings to anon, authenticated;

drop policy if exists "write players" on public.players;
drop policy if exists "write matches" on public.matches;
drop policy if exists "write settings" on public.settings;

create policy "insert players" on public.players for insert to anon, authenticated with check (true);
create policy "update players" on public.players for update to anon, authenticated using (true) with check (true);
create policy "insert matches" on public.matches for insert to anon, authenticated with check (true);
create policy "update matches" on public.matches for update to anon, authenticated using (true) with check (true);
create policy "update settings" on public.settings for update to anon, authenticated using (true) with check (true);
