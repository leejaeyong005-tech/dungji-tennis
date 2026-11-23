-- 수정 기한: 등록한 날과 그다음 날까지(한국 시간)는 누구나 수정, 그 뒤로는 관리자만
create or replace function public.in_edit_window(ts timestamptz) returns boolean
language sql stable as $$
  select (ts at time zone 'Asia/Seoul')::date >= (now() at time zone 'Asia/Seoul')::date - 1
$$;
grant execute on function public.in_edit_window(timestamptz) to anon, authenticated;

-- 경기: 회원은 기한 안에서 날짜·종류·선수·점수·메모 수정, 휴지통으로/되살리기
revoke update on public.matches from anon;
grant update (date, type, a, b, sa, sb, note, deleted_at) on public.matches to anon;
drop policy if exists "recent trash" on public.matches;
drop policy if exists "recent edit matches" on public.matches;
create policy "recent edit matches" on public.matches for update to anon, authenticated
  using (public.in_edit_window(created_at)) with check (public.in_edit_window(created_at));

-- 선수: 회원은 기한 안에서 이름·활동/휴면·삭제
grant update (name, active, deleted_at) on public.players to anon;
drop policy if exists "recent edit players" on public.players;
create policy "recent edit players" on public.players for update to anon, authenticated
  using (public.in_edit_window(created_at)) with check (public.in_edit_window(created_at));
