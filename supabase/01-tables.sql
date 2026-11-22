-- 둥지 테니스 기록: 테이블 생성
create table if not exists public.players (
  id text primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id text primary key,
  t bigint not null default (extract(epoch from now()) * 1000)::bigint,
  date date not null,
  type text not null default 'D' check (type in ('D', 'S')),
  a text[] not null,
  b text[] not null,
  sa int not null check (sa >= 0),
  sb int not null check (sb >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists matches_date_idx on public.matches (date);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  club text not null default '둥지 테니스 클럽',
  min_games int not null default 3,
  draw_at int not null default 5,
  draw_mode text not null default 'half' check (draw_mode in ('half', 'exclude'))
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 보안: 누구나 보기, 로그인한 관리자만 입력/수정/삭제
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.settings enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.players, public.matches, public.settings to anon, authenticated;
grant insert, update, delete on public.players, public.matches to authenticated;
grant update on public.settings to authenticated;

drop policy if exists "read players" on public.players;
drop policy if exists "write players" on public.players;
drop policy if exists "read matches" on public.matches;
drop policy if exists "write matches" on public.matches;
drop policy if exists "read settings" on public.settings;
drop policy if exists "write settings" on public.settings;

create policy "read players" on public.players for select to anon, authenticated using (true);
create policy "write players" on public.players for all to authenticated using (true) with check (true);
create policy "read matches" on public.matches for select to anon, authenticated using (true);
create policy "write matches" on public.matches for all to authenticated using (true) with check (true);
create policy "read settings" on public.settings for select to anon, authenticated using (true);
create policy "write settings" on public.settings for update to authenticated using (true) with check (true);
