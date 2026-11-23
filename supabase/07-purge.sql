-- 휴지통 완전 삭제: 휴지통에 있는 경기만, 관리자 또는 등록한 날과 그다음 날까지(수정 기한과 같음)
grant delete on public.matches to anon, authenticated;
drop policy if exists "delete trashed matches" on public.matches;
create policy "delete trashed matches" on public.matches for delete to anon, authenticated
  using (deleted_at is not null and (public.is_admin() or public.in_edit_window(created_at)));

-- 자동 삭제: 휴지통에 30일 넘게 있던 경기, 삭제된 지 30일 넘고 경기 기록이 없는 선수 (매일 새벽 4시, 한국 시간)
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'dungji-purge-trash';
select cron.schedule('dungji-purge-trash', '0 19 * * *', $job$
  delete from public.matches where deleted_at < now() - interval '30 days';
  delete from public.players p
   where p.deleted_at < now() - interval '30 days'
     and not exists (select 1 from public.matches m where p.id = any(m.a) or p.id = any(m.b));
$job$);
select jobname, schedule from cron.job where jobname = 'dungji-purge-trash';
