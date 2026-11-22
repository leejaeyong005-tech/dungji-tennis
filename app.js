// 둥지 테니스 기록 — Supabase 연결 버전
(function(){
"use strict";
const SB_URL = 'https://oftmhyaqlomqqhsvqppw.supabase.co';
const SB_KEY = 'sb_publishable_nNaiMgeEMsA8HBczx4rFZA_6PFp7Re3';   // 브라우저용 공개 키 (RLS로 보호)
const CACHE_KEY = 'dungji-tennis-cache-v1';

const $ = (s, el) => (el || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const pct = r => (r * 100).toFixed(1) + '%';
const sgn = n => n > 0 ? '+' + n : String(n);

/* ---------- state ---------- */
let state = { club: '둥지 테니스 클럽', players: [], matches: [], events: [], minGames: 3, drawAt: 5, drawMode: 'half' };
let conn = 'loading';          // loading | ok | offline
let lastSync = null;
let sb = null;

const VIEWS = ['ranking', 'events', 'add', 'matches', 'players', 'settings'];
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ranking';
let viewPid = null;
let filter = { period: 'all', from: '', to: '', type: 'all' };
let sort = { key: 'rank', dir: 1 };
let form = { date: today(), type: 'D', a1: '', a2: '', b1: '', b2: '', sa: '', sb: '', note: '', err: '' };
let bulk = { text: '', preview: null };
let newPlayer = '';
let showTrash = false;
let viewEid = null;
let evForm = { date: '', name: '' };
let busy = false;

let isAdmin = false, adminEmail = '', signedIn = false;
const canAdd = () => conn === 'ok' && !busy;                 // 회원 누구나: 경기·선수 추가
const canAdmin = () => canAdd() && isAdmin;                  // 관리자만: 전체 수정
const RECENT_MS = 23.5 * 3600 * 1000;                        // 서버 규칙은 24시간, 화면은 여유를 둠
const isRecent = m => m.created_at && (Date.now() - new Date(m.created_at).getTime()) < RECENT_MS;
const canTrash = m => canAdmin() || (canAdd() && isRecent(m));
const live = () => state.matches.filter(m => !m.deleted_at);
const trash = () => state.matches.filter(m => m.deleted_at).sort((x, y) => (y.deleted_at > x.deleted_at ? 1 : -1));
const visiblePlayers = () => state.players.filter(p => !p.deleted_at);
let PM = new Map();
const reindex = () => { PM = new Map(state.players.map(p => [p.id, p])); EV = new Map(liveEvents().map(e => [e.date, e])); };
const liveEvents = () => (state.events || []).filter(e => !e.deleted_at).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
let EV = new Map();                                   // 대회 날짜 → 대회
const isEventMatch = m => EV.has(m.date);
const regular = () => live().filter(m => !EV.has(m.date));   // 평소 통계용 (대회 날짜 제외)
const nameOf = id => (PM.get(id) || {}).name || '(알 수 없음)';
const plink = id => `<a class="p" data-act="player" data-id="${esc(id)}">${esc(nameOf(id))}</a>`;
const names = ids => ids.map(plink).join(' · ');

/* ---------- data ---------- */
function fromDb(s, players, matches, events){
  state.events = (events || []).map(e => ({ id: e.id, date: e.date, name: e.name, deleted_at: e.deleted_at || null }));
  state.club = (s && s.club) || '둥지 테니스 클럽';
  state.minGames = s ? s.min_games : 3;
  state.drawAt = s ? s.draw_at : 5;
  state.drawMode = s && s.draw_mode === 'exclude' ? 'exclude' : 'half';
  state.players = players.map(p => ({ id: p.id, name: p.name, active: p.active !== false, deleted_at: p.deleted_at || null }));
  state.matches = matches.map(m => ({ id: m.id, t: Number(m.t) || 0, date: m.date, type: m.type, a: m.a || [], b: m.b || [], sa: m.sa, sb: m.sb, note: m.note || '', deleted_at: m.deleted_at || null, created_at: m.created_at || null }));
  reindex();
}
async function fetchAll(table){
  const out = []; const step = 1000;
  for (let i = 0; ; i += step) {
    const { data, error } = await sb.from(table).select('*').range(i, i + step - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < step) break;
  }
  return out;
}
async function load(silent){
  if (!sb) { conn = 'offline'; render(); return; }
  try {
    const [sres, players, matches, events] = await Promise.all([sb.from('settings').select('*').eq('id', 1), fetchAll('players'), fetchAll('matches'), fetchAll('events')]);
    if (sres.error) throw sres.error;
    fromDb(sres.data && sres.data[0], players, matches, events);
    conn = 'ok'; lastSync = new Date();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch (e) {}
  } catch (e) {
    conn = 'offline';
    if (!silent) toast('서버에 연결하지 못했어요. 저장된 기록을 보여 드려요.');
  }
  render();
}
function loadCache(){
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && Array.isArray(c.matches)) { state = Object.assign(state, c); reindex(); return true; } } catch (e) {}
  return false;
}
let pre = null;
const mark = () => { pre = JSON.stringify(state); };
async function run(label, fn){
  // 서버에 쓰기. 실패하면 서버 기록을 다시 불러와 화면을 맞춥니다.
  busy = true;
  try { const r = await fn(); if (r && r.error) throw r.error; return true; }
  catch (e) {
    toast(label + ' 실패: ' + ((e && e.message) || e) + ' — 저장되지 않았어요.');
    if (pre) { try { state = JSON.parse(pre); reindex(); } catch (x) {} }
    await load(true); return false;
  }
  finally { busy = false; try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch (e) {} render(); }
}
const matchRowDb = m => ({ id: m.id, t: m.t, date: m.date, type: m.type, a: m.a, b: m.b, sa: m.sa, sb: m.sb, note: m.note || '' });

/* ---------- stats ---------- */
function periodRange(){
  const d = new Date();
  switch (filter.period) {
    case 'month': return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ''];
    case 'year': return [d.getFullYear() + '-01-01', ''];
    case '3m': { const s = new Date(d); s.setMonth(s.getMonth() - 3); return [ymd(s), '']; }
    case 'custom': return [filter.from, filter.to];
    default: return ['', ''];
  }
}
const byDate = (x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : (x.t || 0) - (y.t || 0);
function periodMatches(onlyType){       // 기간·종류 필터 (대회 경기 포함)
  const [from, to] = periodRange(), ty = onlyType || filter.type;
  return live().filter(m => (!from || m.date >= from) && (!to || m.date <= to) && (ty === 'all' || m.type === ty));
}
function filteredMatches(onlyType){     // 평소 통계용: 대회 날짜 경기 제외
  return periodMatches(onlyType).filter(m => !EV.has(m.date));
}
function rateOf(r){
  if (state.drawMode === 'exclude') return (r.w + r.l) ? r.w / (r.w + r.l) : 0;
  return r.n ? (r.w + r.d * 0.5) / r.n : 0;
}
const wdl = r => r.w + '-' + r.d + '-' + r.l;
const isDraw = m => m.sa === m.sb;
function computeStats(ms){
  const P = {}, pairs = {};
  const get = id => P[id] || (P[id] = { id, n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, seq: [], partners: {}, opps: {} });
  const tally = (r, res) => { r.n++; res === 'W' ? r.w++ : res === 'D' ? r.d++ : r.l++; };
  const rec = (o, k, res) => tally(o[k] || (o[k] = { n: 0, w: 0, d: 0, l: 0 }), res);
  for (const m of ms.slice().sort(byDate)) {
    const aWin = m.sa > m.sb;
    for (const side of ['a', 'b']) {
      const mine = m[side], other = m[side === 'a' ? 'b' : 'a'];
      const res = m.sa === m.sb ? 'D' : (side === 'a') === aWin ? 'W' : 'L';
      const gf = side === 'a' ? m.sa : m.sb, ga = side === 'a' ? m.sb : m.sa;
      for (const pid of mine) {
        const s = get(pid); tally(s, res); s.gf += gf; s.ga += ga; s.seq.push(res);
        for (const q of mine) if (q !== pid) rec(s.partners, q, res);
        for (const o of other) rec(s.opps, o, res);
      }
      if (m.type === 'D' && mine.length === 2) {
        const ids = mine.slice().sort(), key = ids.join('|');
        const r = pairs[key] || (pairs[key] = { ids, n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
        tally(r, res); r.gf += gf; r.ga += ga;
      }
    }
  }
  for (const s of Object.values(P)) { s.rate = rateOf(s); s.diff = s.gf - s.ga; s.streak = streak(s.seq); }
  for (const r of Object.values(pairs)) { r.rate = rateOf(r); r.diff = r.gf - r.ga; }
  return { P, pairs };
}
function streak(seq){
  if (!seq.length) return '';
  const last = seq[seq.length - 1]; let k = 0;
  if (last === 'D') return '';
  for (let i = seq.length - 1; i >= 0 && seq[i] === last; i--) k++;
  return k + (last === 'W' ? '연승' : '연패');
}
const rankCmp = (x, y) => (y.rate - x.rate) || (y.w - x.w) || (y.diff - x.diff);
function assignRanks(rows){
  rows.sort(rankCmp);
  rows.forEach((r, i) => { const p = rows[i - 1]; r.rank = (p && !rankCmp(p, r)) ? p.rank : i + 1; });
}
const chips = seq => `<span class="chips">${seq.map(c => `<span class="chip ${c}">${c === 'W' ? '승' : c === 'D' ? '무' : '패'}</span>`).join('')}</span>`;
const diffCell = n => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${sgn(n)}</span>`;
const streakCell = s => s ? `<span class="${s.endsWith('연승') ? 'pos' : 'neg'}">${s}</span>` : '';

/* ---------- views ---------- */
function render(){
  const root = $('#root');
  const ae = document.activeElement;
  const keep = ae && ae.dataset && (ae.dataset.form || ae.hasAttribute('data-bulk') || ae.hasAttribute('data-np') || ae.dataset.ev) ? (ae.dataset.ev ? 'ev:' + ae.dataset.ev : ae.dataset.form || (ae.hasAttribute('data-bulk') ? 'bulk' : 'np')) : null;
  const y = window.scrollY;
  root.innerHTML = header() + '<main><div class="wrap">' + body() + '</div></main>';
  window.scrollTo(0, y);
  if (keep) { const el = keep === 'bulk' ? $('[data-bulk]') : keep === 'np' ? $('[data-np]') : keep.startsWith('ev:') ? $(`[data-ev="${keep.slice(3)}"]`) : $(`[data-form="${keep}"]`); if (el && el.tagName !== 'SELECT') el.focus(); }
}
function header(){
  const tabs = [['ranking', '순위'], ['events', '대회'], ['add', '경기 입력'], ['matches', '경기 기록'], ['players', '선수'], ['settings', '설정']];
  const cur = view === 'player' ? 'players' : view === 'event' ? 'events' : view;
  const st = conn === 'loading' ? '<span class="sync">불러오는 중…</span>'
    : conn === 'offline' ? '<button class="sync off" data-act="refresh">연결 안 됨 · 보기만 가능 ↻</button>'
    : `<button class="sync" data-act="refresh" title="새로고침">↻ ${lastSync ? pad(lastSync.getHours()) + ':' + pad(lastSync.getMinutes()) : ''}</button>`;
  return `<header><div class="wrap"><div class="toprow"><div class="club">${esc(state.club)}${isAdmin ? ' <span class="badge">관리자</span>' : ''}</div>${st}</div><h1>경기 결과 · 통계</h1>
    <nav>${tabs.map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</nav></div></header>`;
}
function body(){
  if (conn === 'loading' && !state.matches.length && !state.players.length) return '<div class="card empty">기록을 불러오는 중이에요…</div>';
  switch (view) {
    case 'add': return addView();
    case 'matches': return matchesView();
    case 'players': return playersView();
    case 'settings': return settingsView();
    case 'player': return playerView(viewPid);
    case 'events': return eventsView();
    case 'event': return eventView(viewEid);
    default: return rankingView();
  }
}
function opt(list, cur){ return list.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join(''); }
function filterBar(noType){
  return `<div class="filters">
    <label>기간 <select data-f="period">${opt([['all', '전체'], ['month', '이번 달'], ['3m', '최근 3개월'], ['year', '올해'], ['custom', '직접 지정']], filter.period)}</select></label>
    ${filter.period === 'custom' ? `<label>시작 <input type="date" data-f="from" value="${esc(filter.from)}"></label><label>끝 <input type="date" data-f="to" value="${esc(filter.to)}"></label>` : ''}
    ${noType ? '<span class="badge">복식 경기 기준</span>' : `<label>종류 <select data-f="type">${opt([['all', '전체'], ['D', '복식'], ['S', '단식']], filter.type)}</select></label>`}
  </div>`;
}
function emptyState(){
  return `<div class="card empty"><b>아직 기록이 없어요</b>
    선수를 등록하고 경기 결과를 입력하면 순위와 통계가 자동으로 계산돼요.
    <div class="row" style="justify-content:center;margin-top:14px">
      <button class="primary" data-act="tab" data-v="add">경기 입력하기</button>
      <button class="ghost" data-act="tab" data-v="players">선수 등록하기</button>
    </div></div>`;
}

function rankingView(){
  if (!live().length) return emptyState();
  if (!regular().length) return filterBar(true) + '<div class="card empty"><b>평소 경기 기록이 없어요</b>지금까지 입력된 경기는 모두 대회 날 경기예요. 대회 탭에서 볼 수 있어요.</div>';
  const ms = filteredMatches('D');
  const singles = filteredMatches('S').length;
  const evExcluded = periodMatches('all').filter(isEventMatch).length;
  const { P, pairs } = computeStats(ms);
  const rows = Object.values(P);
  const q = rows.filter(r => r.n >= state.minGames), low = rows.filter(r => r.n < state.minGames);
  assignRanks(q);
  if (sort.key !== 'rank') {
    const k = sort.key;
    q.sort((x, y) => k === 'name' ? nameOf(x.id).localeCompare(nameOf(y.id), 'ko') * sort.dir : ((x[k] - y[k]) * -sort.dir) || (x.rank - y.rank));
  }
  const draws = ms.filter(isDraw).length;
  const top = q.slice().sort(rankCmp)[0];
  const th = (k, l, cls) => `<th class="${cls || ''} ${sort.key === k ? 'sorted' : ''}" data-act="sort" data-k="${k}">${l}${sort.key === k ? (sort.dir > 0 ? ' ▾' : ' ▴') : ''}</th>`;
  const prow = r => `<tr class="${r.rank === 1 ? 'rank1' : ''}"><td>${r.rank || '–'}</td><td class="name">${plink(r.id)}</td><td>${r.n}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td><b>${pct(r.rate)}</b></td><td>${diffCell(r.diff)}</td><td>${chips(r.seq.slice(-5))}</td><td>${streakCell(r.streak)}</td></tr>`;
  const pairRows = Object.values(pairs).filter(r => r.n >= 2).sort(rankCmp).slice(0, 10);
  return filterBar(true) + `
  <div class="tiles">
    <div class="tile"><div class="k">복식 경기</div><div class="v">${ms.length}<small> 경기</small></div></div>
    <div class="tile"><div class="k">무승부</div><div class="v">${draws}<small> 경기</small></div></div>
    <div class="tile"><div class="k">참가 선수</div><div class="v">${rows.length}<small> 명</small></div></div>
    <div class="tile"><div class="k">승률 1위</div><div class="v" style="font-size:18px">${top ? esc(nameOf(top.id)) + ` <small>${pct(top.rate)}</small>` : '–'}</div></div>
  </div>
  <div class="card"><h2>개인 순위<small>복식 ${state.minGames}경기 이상 · 승률 → 승수 → 게임 득실 순 · ${state.drawMode === 'half' ? '무승부는 0.5승' : '무승부는 승률에서 제외'}</small></h2>
    ${q.length ? `<div class="tablewrap"><table><thead><tr>${th('rank', '순위')}${th('name', '이름', 'name')}${th('n', '경기')}${th('w', '승')}${th('d', '무')}${th('l', '패')}${th('rate', '승률')}${th('diff', '게임 득실')}<th>최근 5경기</th><th>연속</th></tr></thead>
    <tbody>${q.map(prow).join('')}</tbody></table></div>` : `<p class="muted small">이 기간에 복식 ${state.minGames}경기 이상 뛴 선수가 없어요.</p>`}
    ${low.length ? `<p class="muted small" style="margin:12px 0 4px">경기 수 부족 (${state.minGames}경기 미만)</p>
      <div class="tablewrap"><table><tbody>${low.sort(rankCmp).map(r => prow(Object.assign(r, { rank: 0 }))).join('')}</tbody></table></div>` : ''}
    ${singles ? `<p class="help" style="margin-top:10px">단식 ${singles}경기는 개인 순위에 들어가지 않아요. 경기 기록과 선수 상세에서 볼 수 있어요.</p>` : ''}
    ${evExcluded ? `<p class="help" style="margin-top:6px">🏆 대회 날 경기 ${evExcluded}경기는 평소 통계에서 빠지고 대회 탭에서 따로 집계돼요.</p>` : ''}
  </div>
  <div class="card"><h2>복식 조합 순위<small>함께 2경기 이상</small></h2>
    ${pairRows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th class="name">조합</th><th>경기</th><th>승-무-패</th><th>승률</th><th>게임 득실</th></tr></thead><tbody>
    ${pairRows.map((r, i) => `<tr><td>${i + 1}</td><td class="name">${names(r.ids)}</td><td>${r.n}</td><td>${wdl(r)}</td><td><b>${pct(r.rate)}</b></td><td>${diffCell(r.diff)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">아직 2경기 이상 함께한 조합이 없어요.</p>'}
  </div>`;
}

function matchRow(m, restore){
  const aWin = m.sa > m.sb, bWin = m.sb > m.sa;
  const btn = !canTrash(m) ? '<span></span>' : restore
    ? `<button class="ghost tiny" data-act="restorematch" data-id="${esc(m.id)}">되살리기</button>`
    : `<button class="x" data-act="delmatch" data-id="${esc(m.id)}" title="휴지통으로">✕</button>`;
  return `<div class="match"><span class="badge ${m.type}">${m.type === 'D' ? '복식' : '단식'}${EV.has(m.date) ? ' 🏆' : ''}</span>
    <span class="side ${aWin ? 'win' : ''}">${names(m.a)}</span>
    <span class="score">${m.sa} : ${m.sb}${isDraw(m) ? '<span class="drawtag">무승부</span>' : ''}</span>
    <span class="side b ${bWin ? 'win' : ''}">${names(m.b)}</span>
    ${btn}
    ${m.note ? `<span class="note">${esc(m.note)}</span>` : ''}</div>`;
}
function matchList(ms, restore){
  const sorted = restore ? ms : ms.slice().sort(byDate).reverse();
  let out = '', last = '';
  for (const m of sorted) {
    if (m.date !== last) { out += `<div class="day">${dayLabel(m.date)}${EV.has(m.date) ? ` · <span class="evtag">🏆 ${esc(EV.get(m.date).name)}</span>` : ''}</div>`; last = m.date; }
    out += matchRow(m, restore);
  }
  return out;
}
function dayLabel(s){
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return esc(s);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}
function matchesView(){
  const tr = trash();
  if (!live().length && !tr.length) return emptyState();
  const ms = periodMatches();
  return filterBar() + `<div class="card"><h2>경기 기록<small>${ms.length}경기${ms.some(isEventMatch) ? ' · 🏆 표시는 대회 경기' : ''}</small></h2>${ms.length ? matchList(ms) : '<p class="muted small">이 조건에 맞는 경기가 없어요.</p>'}</div>
  ${tr.length ? `<div class="card"><h2 style="margin:0"><button class="back" style="margin:0" data-act="trash">${showTrash ? '▾' : '▸'} 휴지통 ${tr.length}경기</button></h2>
    ${showTrash ? `<p class="help">실수로 지운 경기는 여기서 되살릴 수 있어요. 휴지통 경기는 통계에 들어가지 않아요.</p>${matchList(tr, true)}` : ''}</div>` : ''}`;
}

function addView(){
  if (conn !== 'ok') return '<div class="card empty">서버에 연결되어 있을 때만 경기를 입력할 수 있어요. 인터넷 연결을 확인하고 위쪽 ↻ 를 눌러 주세요.</div>';
  const active = visiblePlayers().filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (active.length < 2) return `<div class="card empty"><b>선수가 2명 이상 필요해요</b>먼저 선수 탭에서 회원을 등록하거나, 아래 '여러 경기 한 번에 입력'에 이름을 그대로 적으면 자동으로 등록돼요.</div>` + bulkCard();
  const sel = k => `<select data-form="${k}"><option value="">선수 선택</option>${active.map(p => `<option value="${esc(p.id)}" ${form[k] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const D = form.type === 'D';
  const N = state.drawAt, G = N + 1, quick = [];
  for (let i = 0; i < N; i++) quick.push(G + ':' + i);
  quick.push(N + ':' + N);
  for (let i = 0; i < N; i++) quick.push(i + ':' + G);
  const sameDay = live().filter(m => m.date === form.date);
  const ev = EV.get(form.date);
  return `${ev ? `<div class="card evnote">🏆 <b>${esc(form.date)}</b>은 <b>${esc(ev.name)}</b> 대회 날이에요. 이 날 경기는 대회 기록으로만 집계되고 평소 통계에는 들어가지 않아요.</div>` : ''}<div class="card"><h2>경기 결과 입력</h2>
  <form id="addform" autocomplete="off">
    <div class="row" style="gap:14px;margin-bottom:12px">
      <label class="field" style="margin:0"><span>날짜</span><input type="date" data-form="date" value="${esc(form.date)}"></label>
      <div class="field" style="margin:0"><span>종류</span><div class="seg"><button type="button" data-act="ftype" data-v="D" class="${D ? 'on' : ''}">복식</button><button type="button" data-act="ftype" data-v="S" class="${!D ? 'on' : ''}">단식</button></div></div>
    </div>
    <div class="teams">
      <div class="team"><b>팀 A</b>${sel('a1')}${D ? sel('a2') : ''}</div>
      <div class="vs">VS</div>
      <div class="team"><b>팀 B</b>${sel('b1')}${D ? sel('b2') : ''}</div>
    </div>
    <div class="field" style="margin-top:14px;align-items:center"><span>게임 스코어 (A : B) · ${N}:${N}는 무승부</span>
      <div class="scorebox"><input type="number" min="0" max="99" inputmode="numeric" data-form="sa" value="${esc(form.sa)}"><b>:</b><input type="number" min="0" max="99" inputmode="numeric" data-form="sb" value="${esc(form.sb)}"></div>
      <div class="quick">${quick.map(s => `<button type="button" data-act="quick" data-v="${s}">${s}</button>`).join('')}</div>
    </div>
    <label class="field"><span>메모 (선택)</span><input type="text" data-form="note" value="${esc(form.note)}" placeholder="예: 정기 모임, 코트 2번"></label>
    ${form.err ? `<div class="err">${esc(form.err)}</div>` : ''}
    <div class="row end"><button class="primary" type="submit" ${busy ? 'disabled' : ''}>경기 추가</button></div>
  </form></div>
  ${sameDay.length ? `<div class="card"><h2>${dayLabel(form.date)} 경기<small>${sameDay.length}경기</small></h2>${matchList(sameDay)}</div>` : ''}
  ${bulkCard()}`;
}
function bulkCard(){
  const pv = bulk.preview;
  const ok = pv ? pv.filter(r => !r.err) : [];
  return `<div class="card"><h2>여러 경기 한 번에 입력</h2>
    <p class="help">한 줄에 한 경기씩, <code>팀A 선수들 점수 팀B 선수들</code> 순서로 적어 주세요. 단톡방 기록을 붙여 넣어도 돼요.<br>
    예) <code>김민준 이서연 6:4 박지훈 최수아</code> · <code>2026-11-15 김민준 6-3 박지훈</code> (날짜를 안 쓰면 위 입력 날짜 ${esc(form.date)})<br>
    처음 보는 이름은 새 선수로 등록돼요.</p>
    <textarea data-bulk placeholder="김민준 이서연 6:4 박지훈 최수아">${esc(bulk.text)}</textarea>
    <div class="row end" style="margin-top:8px"><button class="ghost" data-act="bulkpreview">미리보기</button>
    ${ok.length ? `<button class="primary" data-act="bulkadd" ${busy ? 'disabled' : ''}>${ok.length}경기 추가</button>` : ''}</div>
    ${pv ? `<div style="margin-top:10px">${pv.map(r => r.err
      ? `<div class="err">✕ ${esc(r.line)} — ${esc(r.err)}</div>`
      : `<div class="match"><span class="badge ${r.type}">${r.type === 'D' ? '복식' : '단식'}</span><span class="side ${r.sa > r.sb ? 'win' : ''}">${r.a.map(bn).join(' · ')}</span><span class="score">${r.sa} : ${r.sb}${r.sa === r.sb ? '<span class="drawtag">무승부</span>' : ''}</span><span class="side b ${r.sb > r.sa ? 'win' : ''}">${r.b.map(bn).join(' · ')}</span><span class="muted small">${esc(r.date)}${EV.has(r.date) ? ' 🏆' : ''}</span></div>`).join('')}</div>` : ''}
  </div>`;
}
const bn = n => esc(n) + (visiblePlayers().some(p => p.name === n) ? '' : '<span class="new">새</span>');
function normDate(s){
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : null;
}
function scoreErr(sa, sb){
  const N = state.drawAt;
  if (sa === sb) return sa === N ? '' : `동점은 ${N}:${N}만 무승부로 입력할 수 있어요.`;
  if (Math.max(sa, sb) !== N + 1 || Math.min(sa, sb) > N - 1) return `${N + 1}게임 선승이에요. ${N + 1}:0 ~ ${N + 1}:${N - 1} 사이로 입력해 주세요.`;
  return '';
}
function parseBulk(text){
  const out = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim(); if (!line) continue;
    let rest = line, date = form.date;
    const dm = rest.match(/^(\d{4}[-./]\d{1,2}[-./]\d{1,2})\.?\s+/);
    if (dm) { const d = normDate(dm[1]); if (d) date = d; rest = rest.slice(dm[0].length); }
    const sm = rest.match(/(\d{1,2})\s*[:\-]\s*(\d{1,2})/);
    if (!sm) { out.push({ line, err: '점수(예: 6:4)를 찾지 못했어요' }); continue; }
    const split = s => s.split(/[\s,\/&·+]+/).map(x => x.trim()).filter(x => x && !/^vs\.?$/i.test(x));
    const a = split(rest.slice(0, sm.index)), b = split(rest.slice(sm.index + sm[0].length));
    const sa = +sm[1], sb = +sm[2];
    if (!((a.length === 1 && b.length === 1) || (a.length === 2 && b.length === 2))) { out.push({ line, err: '인원이 맞지 않아요 (단식 1:1, 복식 2:2)' }); continue; }
    if (new Set([...a, ...b]).size !== a.length + b.length) { out.push({ line, err: '같은 이름이 두 번 들어 있어요' }); continue; }
    const ve = scoreErr(sa, sb); if (ve) { out.push({ line, err: ve }); continue; }
    out.push({ line, date, type: a.length === 2 ? 'D' : 'S', a, b, sa, sb });
  }
  return out;
}
// 이름 → 선수 id. 새 이름이면 추가 목록에, 휴지통에 있던 이름이면 되살리기 목록에 넣음
function resolveNames(nameList){
  const add = [], revive = [], map = {};
  for (const n of nameList) {
    if (map[n]) continue;
    const p = state.players.find(x => x.name === n);
    if (p) { map[n] = p.id; if (isAdmin && (p.deleted_at || p.active === false)) revive.push(p); }
    else { const np = { id: uid(), name: n, active: true, deleted_at: null }; add.push(np); map[n] = np.id; }
  }
  return { add, revive, map };
}
async function savePlayers(add, revive){
  if (add.length) { const { error } = await sb.from('players').insert(add.map(p => ({ id: p.id, name: p.name, active: true }))); if (error) throw error; }
  for (const p of revive) { const { error } = await sb.from('players').update({ deleted_at: null, active: true }).eq('id', p.id); if (error) throw error; }
}

function playersView(){
  const { P } = computeStats(regular().filter(m => m.type === 'D'));
  const list = visiblePlayers().sort((a, b) => ((a.active === false) - (b.active === false)) || a.name.localeCompare(b.name, 'ko'));
  const ed = canAdmin();
  return `${conn === 'ok' ? `<div class="card"><h2>선수 등록</h2>
    <form id="playerform" class="row" autocomplete="off"><input type="text" data-np value="${esc(newPlayer)}" placeholder="이름 (여러 명은 쉼표로 구분)" style="flex:1;min-width:180px"><button class="primary" type="submit" ${busy ? 'disabled' : ''}>추가</button></form></div>` : ''}
  <div class="card"><h2>선수 목록<small>${list.length}명 · 전체 기간 복식 기준 (대회 제외)</small></h2>
  ${list.length ? `<div class="tablewrap"><table class="plist"><thead><tr><th></th><th class="name">이름</th><th>경기</th><th>승-무-패</th><th>승률</th><th>상태</th><th></th></tr></thead><tbody>
  ${list.map(p => { const s = P[p.id]; return `<tr class="${p.active === false ? 'inactive' : ''}">
    <td><button class="x" data-act="player" data-id="${esc(p.id)}" title="상세 보기">▸</button></td>
    <td class="name">${ed ? `<input type="text" data-rename="${esc(p.id)}" value="${esc(p.name)}">` : esc(p.name)}</td>
    <td>${s ? s.n : 0}</td><td>${s ? wdl(s) : '–'}</td><td>${s ? pct(s.rate) : '–'}</td>
    <td>${ed ? `<button class="ghost tiny" data-act="toggle" data-id="${esc(p.id)}">${p.active === false ? '휴면' : '활동'}</button>` : (p.active === false ? '휴면' : '활동')}</td>
    <td>${ed ? `<button class="x" data-act="delplayer" data-id="${esc(p.id)}" title="삭제">✕</button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div><p class="help">${ed ? "이름을 눌러 바로 고칠 수 있어요. '휴면' 선수는 경기 입력 목록에서 빠지지만 기록은 그대로 남아요." : '선수 이름 수정·휴면·삭제는 관리자만 할 수 있어요.'}</p>` : '<p class="muted small">등록된 선수가 없어요.</p>'}
  </div>`;
}

function playerView(pid){
  const p = PM.get(pid);
  if (!p) { view = 'players'; return playersView(); }
  const ms = filteredMatches().filter(m => m.a.includes(pid) || m.b.includes(pid));
  const { P } = computeStats(ms);
  const s = P[pid];
  const back = `<button class="back" data-act="tab" data-v="players">‹ 선수 목록</button>`;
  if (!s) return back + `<div class="card"><h2>${esc(p.name)}</h2></div>` + filterBar() + '<div class="card empty">이 조건에서 뛴 평소 경기가 없어요.</div>' + playerEventsCard(pid);
  const relTable = (obj, label) => {
    const rows = Object.entries(obj).map(([id, r]) => Object.assign({ id, rate: rateOf(r) }, r)).sort((x, y) => (y.n - x.n) || (y.rate - x.rate));
    if (!rows.length) return `<p class="muted small">기록 없음</p>`;
    return `<div class="tablewrap"><table><thead><tr><th>#</th><th class="name">${label}</th><th>경기</th><th>승-무-패</th><th>승률</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="name">${plink(r.id)}</td><td>${r.n}</td><td>${wdl(r)}</td><td><b class="${r.rate >= .5 ? 'pos' : 'neg'}">${pct(r.rate)}</b></td></tr>`).join('')}</tbody></table></div>`;
  };
  return back + `<div class="card" style="padding:14px 16px"><h2 style="margin:0;font-size:20px">${esc(p.name)} ${p.active === false ? '<span class="badge S">휴면</span>' : ''}</h2></div>
  ${filterBar()}
  <div class="tiles">
    <div class="tile"><div class="k">경기</div><div class="v">${s.n}</div></div>
    <div class="tile"><div class="k">승 - 무 - 패</div><div class="v">${s.w}<small> - ${s.d} - ${s.l}</small></div></div>
    <div class="tile"><div class="k">승률</div><div class="v">${pct(s.rate)}</div></div>
    <div class="tile"><div class="k">게임 득실</div><div class="v">${diffCell(s.diff)}<small> (${s.gf}:${s.ga})</small></div></div>
    <div class="tile"><div class="k">현재</div><div class="v" style="font-size:18px">${streakCell(s.streak) || '–'}</div></div>
  </div>
  <div class="card"><h2>최근 10경기<small>대회 제외</small></h2>${chips(s.seq.slice(-10))}</div>
  ${playerEventsCard(pid)}
  <div class="grid2">
    <div class="card"><h2>파트너별 전적<small>복식</small></h2>${relTable(s.partners, '파트너')}</div>
    <div class="card"><h2>상대별 전적</h2>${relTable(s.opps, '상대')}</div>
  </div>
  <div class="card"><h2>경기 기록<small>${ms.length}경기</small></h2>${matchList(ms)}</div>`;
}

/* ---------- 대회 ---------- */
const MEDAL = ['🥇', '🥈', '🥉'];
function eventResult(ev){
  const ms = live().filter(m => m.date === ev.date);
  const { P, pairs } = computeStats(ms);
  const ind = Object.values(P); assignRanks(ind);
  const prs = Object.values(pairs); assignRanks(prs);
  return { ms, ind, prs };
}
function podium(rows, label){
  const top = rows.filter(r => r.rank <= 3);
  if (!top.length) return '';
  return `<div class="podium">${top.map(r => `<div class="prize r${r.rank}"><span class="medal">${MEDAL[r.rank - 1]}</span>
    <span class="pname">${r.ids ? names(r.ids) : plink(r.id)}</span>
    <span class="pstat">${r.rank}위 · ${wdl(r)} · ${pct(r.rate)} · 득실 ${sgn(r.diff)}</span></div>`).join('')}</div>`;
}
function eventsView(){
  const evs = liveEvents();
  const admin = canAdmin();
  return `${admin ? `<div class="card"><h2>대회 지정</h2>
    <p class="help" style="margin-top:0">날짜를 대회로 지정하면 그날 경기는 대회 기록으로만 집계되고, 평소 순위와 통계에서는 빠져요.</p>
    <form id="eventform" class="row" autocomplete="off">
      <input type="date" data-ev="date" value="${esc(evForm.date || today())}" required>
      <input type="text" data-ev="name" value="${esc(evForm.name)}" placeholder="대회 이름 (예: 송년 대회)" style="flex:1;min-width:160px" required>
      <button class="primary" type="submit" ${busy ? 'disabled' : ''}>지정</button>
    </form></div>` : ''}
  <div class="card"><h2>대회 목록<small>${evs.length}개</small></h2>
  ${evs.length ? evs.map(ev => {
    const { ms, ind } = eventResult(ev);
    const win = ind.filter(r => r.rank === 1);
    return `<button class="evrow" data-act="event" data-id="${esc(ev.id)}">
      <span class="evname">🏆 ${esc(ev.name)}</span>
      <span class="muted small">${dayLabel(ev.date)} · ${ms.length}경기</span>
      <span class="small">${win.length ? '우승 ' + win.map(r => esc(nameOf(r.id))).join(', ') : (ev.date > today() ? '예정' : '경기 기록 없음')}</span></button>`;
  }).join('') : `<p class="muted small">아직 지정된 대회가 없어요.${admin ? '' : ' 대회 지정은 관리자가 해요.'}</p>`}
  </div>`;
}
function eventView(eid){
  const ev = liveEvents().find(e => e.id === eid);
  if (!ev) { view = 'events'; return eventsView(); }
  const { ms, ind, prs } = eventResult(ev);
  const back = `<button class="back" data-act="tab" data-v="events">‹ 대회 목록</button>`;
  const admin = canAdmin();
  const head = `<div class="card evhead"><div class="muted small">${dayLabel(ev.date)}</div>
    ${admin ? `<input class="evtitle" type="text" data-evname="${esc(ev.id)}" value="${esc(ev.name)}">` : `<h2 class="evtitle">🏆 ${esc(ev.name)}</h2>`}
    <div class="muted small">${ms.length}경기 · 참가 ${ind.length}명</div></div>`;
  if (!ms.length) return back + head + `<div class="card empty">아직 이 날 입력된 경기가 없어요. 경기 입력 탭에서 날짜를 ${esc(ev.date)}로 골라 입력하면 여기에 집계돼요.</div>` + eventAdmin(ev);
  const row = r => `<tr class="${r.rank === 1 ? 'rank1' : ''}"><td>${r.rank}</td><td class="name">${r.ids ? names(r.ids) : plink(r.id)}</td><td>${r.n}</td><td>${wdl(r)}</td><td><b>${pct(r.rate)}</b></td><td>${diffCell(r.diff)}</td></tr>`;
  const table = (rows, label) => `<div class="tablewrap"><table><thead><tr><th>순위</th><th class="name">${label}</th><th>경기</th><th>승-무-패</th><th>승률</th><th>게임 득실</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
  return back + head + `
  <div class="card"><h2>개인 시상<small>그날 경기만 · 승률 → 승수 → 게임 득실 순</small></h2>${podium(ind)}</div>
  ${prs.length ? `<div class="card"><h2>복식 조합 시상</h2>${podium(prs)}</div>` : ''}
  <div class="card"><h2>개인 순위 전체</h2>${table(ind, '이름')}</div>
  ${prs.length ? `<div class="card"><h2>조합 순위 전체</h2>${table(prs, '조합')}</div>` : ''}
  <div class="card"><h2>대회 경기<small>${ms.length}경기</small></h2>${matchList(ms)}</div>
  ${eventAdmin(ev)}`;
}
function eventAdmin(ev){
  if (!canAdmin()) return '';
  return `<div class="card"><h2>대회 관리</h2><p class="help" style="margin-top:0">대회 이름은 위 제목을 눌러 고칠 수 있어요. 대회 지정을 해제하면 이 날 경기는 다시 평소 통계에 들어가요.</p>
    <div class="row end"><button class="danger" data-act="delevent" data-id="${esc(ev.id)}">대회 지정 해제</button></div></div>`;
}
function playerEventsCard(pid){
  const rows = [];
  for (const ev of liveEvents()) {
    const { ind } = eventResult(ev);
    const r = ind.find(x => x.id === pid);
    if (r) rows.push(`<tr><td>${r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank + '위'}</td><td class="name"><a class="p" data-act="event" data-id="${esc(ev.id)}">${esc(ev.name)}</a> <span class="muted small">${esc(ev.date)}</span></td><td>${wdl(r)}</td><td>${pct(r.rate)}</td></tr>`);
  }
  if (!rows.length) return '';
  return `<div class="card"><h2>대회 성적</h2><div class="tablewrap"><table><tbody>${rows.join('')}</tbody></table></div></div>`;
}

function adminCard(){
  if (isAdmin) return `<div class="card"><h2>관리자</h2><p class="help" style="margin-top:0">관리자로 로그인되어 있어요${adminEmail ? ' (' + esc(adminEmail) + ')' : ''}. 지난 기록 삭제·되살리기, 선수 수정, 설정 변경을 할 수 있어요.</p>
    <div class="row end"><button class="ghost" data-act="logout">로그아웃</button></div></div>`;
  if (signedIn) return `<div class="card"><h2>관리자</h2><p class="err">이 계정은 관리자로 등록되어 있지 않아요.</p><div class="row end"><button class="ghost" data-act="logout">로그아웃</button></div></div>`;
  return `<div class="card"><h2>관리자 로그인</h2>
    <p class="help" style="margin-top:0">회원은 로그인 없이 경기를 입력할 수 있어요. 기록 전체를 고치려면 관리자 로그인이 필요해요.</p>
    <form id="loginform" autocomplete="on">
      <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label>
      <div class="row end"><button class="primary" type="submit" ${conn === 'ok' ? '' : 'disabled'}>로그인</button></div>
    </form></div>`;
}
function settingsView(){
  const ed = canAdmin();
  return `${adminCard()}<div class="card"><h2>클럽 설정</h2>
    <p class="help" style="margin-top:0">${ed ? '여기서 바꾸면 모든 회원 화면에 똑같이 적용돼요.' : '설정은 관리자만 바꿀 수 있어요.'}</p>
    <label class="field"><span>클럽 이름</span><input type="text" data-set="club" value="${esc(state.club)}" ${ed ? '' : 'disabled'}></label>
    <label class="field"><span>순위에 들어가는 최소 경기 수</span><input type="number" min="0" max="99" data-set="minGames" value="${state.minGames}" style="width:100px" ${ed ? '' : 'disabled'}></label>
    <label class="field"><span>무승부 게임 스코어 (이 점수에서 끝나면 무승부, 그 외에는 ${state.drawAt + 1}게임 선승)</span><div class="row"><input type="number" min="1" max="20" data-set="drawAt" value="${state.drawAt}" style="width:80px" ${ed ? '' : 'disabled'}><span class="muted">: ${state.drawAt}</span></div></label>
    <label class="field"><span>승률 계산 방식</span><select data-set="drawMode" ${ed ? '' : 'disabled'}>${opt([['half', '무승부 = 0.5승  (승 + 무×0.5) ÷ 경기'], ['exclude', '무승부 제외  승 ÷ (승 + 패)']], state.drawMode)}</select></label>
  </div>
  <div class="card"><h2>앱으로 설치하기</h2>
    <p class="help" style="margin:0">
      <b>아이폰:</b> 사파리에서 이 페이지 → 공유 버튼 → '홈 화면에 추가'<br>
      <b>안드로이드:</b> 크롬에서 이 페이지 → 메뉴(⋮) → '앱 설치' 또는 '홈 화면에 추가'</p></div>
  <div class="card"><h2>백업 · 내보내기</h2>
    <div class="row"><button class="ghost" data-act="copyjson">백업 데이터 복사</button><button class="ghost" data-act="copycsv">경기 기록 CSV 복사 (엑셀용)</button></div>
    ${ed ? `<p class="help" style="margin-top:14px">백업 데이터를 붙여 넣으면 없는 선수와 경기만 추가돼요. 지금 기록은 지워지지 않아요.</p>
    <textarea id="restore" placeholder='{"players": [...], "matches": [...]}'></textarea>
    <div class="row end" style="margin-top:8px"><button class="ghost" data-act="import">가져오기</button></div>` : ''}
  </div>`;
}

/* ---------- helpers ---------- */
let toastTimer;
function toast(msg){
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2800);
}
function ask(msg, ok, danger){
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'modal-bg';
    d.innerHTML = `<div class="modal"><p>${esc(msg)}</p><div class="row end"><button class="ghost" data-r="0">취소</button><button class="${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok || '확인')}</button></div></div>`;
    d.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b || e.target === d) { d.remove(); res(!!b && b.dataset.r === '1'); } });
    document.body.appendChild(d);
  });
}
function showText(title, text){
  const d = document.createElement('div'); d.className = 'modal-bg';
  d.innerHTML = `<div class="modal"><p>${esc(title)}</p><textarea readonly style="min-height:200px">${esc(text)}</textarea><div class="row end" style="margin-top:10px"><button class="primary" data-r="1">닫기</button></div></div>`;
  d.addEventListener('click', e => { if (e.target.closest('[data-r]') || e.target === d) d.remove(); });
  document.body.appendChild(d); const ta = $('textarea', d); ta.focus(); ta.select();
}
async function copy(text, label){
  try { await navigator.clipboard.writeText(text); toast(label + ' 복사했어요.'); }
  catch (e) { showText('자동 복사가 안 돼서 아래 내용을 직접 복사해 주세요.', text); }
}
function csv(){
  const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const rows = [['날짜', '종류', '팀A', '팀A 점수', '팀B 점수', '팀B', '승리', '대회', '메모']];
  for (const m of live().sort(byDate)) rows.push([m.date, m.type === 'D' ? '복식' : '단식', m.a.map(nameOf).join(' / '), String(m.sa), String(m.sb), m.b.map(nameOf).join(' / '), m.sa > m.sb ? 'A' : m.sb > m.sa ? 'B' : '무승부', EV.has(m.date) ? EV.get(m.date).name : '', m.note || '']);
  return rows.map(r => r.map(q).join(',')).join('\n');
}
function go(v, pid){ view = v; viewPid = pid || null; if (VIEWS.includes(v) && location.hash.slice(1) !== v) { try { history.replaceState(null, '', '#' + v); } catch (e) {} } render(); window.scrollTo(0, 0); }
const settingsRow = () => ({ club: state.club, min_games: state.minGames, draw_at: state.drawAt, draw_mode: state.drawMode });

/* ---------- events ---------- */
const root = $('#root');
root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'tab': go(el.dataset.v); break;
    case 'player': go('player', id); break;
    case 'event': viewEid = id; go('event'); break;
    case 'delevent': {
      if (!canAdmin()) break; mark();
      const ev = liveEvents().find(e => e.id === id); if (!ev) break;
      if (!(await ask(`'${ev.name}' (${ev.date}) 대회 지정을 해제할까요?\n이 날 경기는 다시 평소 순위와 통계에 들어가요. 경기 기록은 지워지지 않아요.`, '해제', true))) break;
      ev.deleted_at = new Date().toISOString(); reindex(); go('events');
      if (await run('대회 해제', () => sb.from('events').update({ deleted_at: ev.deleted_at }).eq('id', id))) toast('대회 지정을 해제했어요.');
      break;
    }
    case 'refresh': conn = 'loading'; render(); await load(); toast('최신 기록을 불러왔어요.'); break;
    case 'trash': showTrash = !showTrash; render(); break;
    case 'sort': { const k = el.dataset.k; if (sort.key === k) sort.dir *= -1; else sort = { key: k, dir: 1 }; render(); break; }
    case 'ftype': form.type = el.dataset.v; if (form.type === 'S') { form.a2 = ''; form.b2 = ''; } render(); break;
    case 'quick': { const [x, y] = el.dataset.v.split(':'); form.sa = x; form.sb = y; render(); break; }
    case 'delmatch': {
      const m = state.matches.find(x => x.id === id); if (!m || !canTrash(m)) break; mark();
      if (!(await ask(`${m.date}  ${m.a.map(nameOf).join('·')} ${m.sa}:${m.sb} ${m.b.map(nameOf).join('·')}\n이 경기를 휴지통으로 옮길까요? 경기 기록 탭 아래 휴지통에서 되살릴 수 있어요.`, '휴지통으로', true))) break;
      m.deleted_at = new Date().toISOString(); render();
      if (await run('삭제', () => sb.from('matches').update({ deleted_at: m.deleted_at }).eq('id', id))) toast('휴지통으로 옮겼어요.');
      break;
    }
    case 'restorematch': {
      const m = state.matches.find(x => x.id === id); if (!m || !canTrash(m)) break; mark();
      m.deleted_at = null; render();
      if (await run('되살리기', () => sb.from('matches').update({ deleted_at: null }).eq('id', id))) toast('경기를 되살렸어요.');
      break;
    }
    case 'toggle': {
      if (!canAdmin()) break; mark();
      const p = PM.get(id); if (!p) break;
      p.active = p.active === false; render();
      await run('상태 변경', () => sb.from('players').update({ active: p.active }).eq('id', id));
      break;
    }
    case 'delplayer': {
      if (!canAdmin()) break; mark();
      const p = PM.get(id); if (!p) break;
      const n = state.matches.filter(m => m.a.includes(id) || m.b.includes(id)).length;
      if (n) { await ask(`${p.name} 님은 ${n}경기 기록이 있어서 삭제할 수 없어요. (휴지통 경기 포함)\n대신 '휴면'으로 바꾸면 입력 목록에서 빠져요.`, '알겠어요'); break; }
      if (!(await ask(`${p.name} 님을 목록에서 삭제할까요?`, '삭제', true))) break;
      p.deleted_at = new Date().toISOString(); render();
      await run('삭제', () => sb.from('players').update({ deleted_at: p.deleted_at }).eq('id', id));
      break;
    }
    case 'bulkpreview': bulk.preview = parseBulk(bulk.text); render(); break;
    case 'bulkadd': {
      if (!canAdd()) break; mark();
      const ok = (bulk.preview || []).filter(r => !r.err);
      const { add, revive, map } = resolveNames(ok.flatMap(r => [...r.a, ...r.b]));
      let t = Date.now();
      const rows = ok.map(r => ({ id: uid(), t: t++, date: r.date, type: r.type, a: r.a.map(n => map[n]), b: r.b.map(n => map[n]), sa: r.sa, sb: r.sb, note: '', deleted_at: null, created_at: new Date().toISOString() }));
      state.players.push(...add); revive.forEach(p => { p.deleted_at = null; p.active = true; }); reindex();
      state.matches.push(...rows); render();
      const good = await run('경기 추가', async () => { await savePlayers(add, revive); return sb.from('matches').insert(rows.map(matchRowDb)); });
      if (good) { bulk = { text: '', preview: null }; render(); toast(rows.length + '경기를 추가했어요.'); }
      break;
    }
    case 'copyjson': copy(JSON.stringify({ club: state.club, players: state.players, matches: live() }, null, 1), '백업 데이터를'); break;
    case 'copycsv': copy(csv(), 'CSV를'); break;
    case 'logout': await sb.auth.signOut().catch(() => {}); await checkAdmin(); render(); toast('로그아웃했어요.'); break;
    case 'import': {
      if (!canAdmin()) break; mark();
      let d; try { d = JSON.parse($('#restore').value); } catch (err) { toast('백업 데이터 형식이 올바르지 않아요.'); break; }
      if (!d || !Array.isArray(d.matches) || !Array.isArray(d.players)) { toast('선수/경기 정보가 없는 데이터예요.'); break; }
      const oldName = {}; d.players.forEach(p => { oldName[p.id] = p.name; });
      const { add, revive, map } = resolveNames(d.players.map(p => p.name).filter(Boolean));
      const have = new Set(state.matches.map(m => m.id));
      const rows = d.matches.filter(m => m && m.id && !have.has(m.id) && Array.isArray(m.a) && Array.isArray(m.b) && m.a.concat(m.b).every(x => map[oldName[x]]))
        .map(m => ({ id: m.id, t: Number(m.t) || Date.now(), date: m.date, type: m.type === 'S' ? 'S' : 'D', a: m.a.map(x => map[oldName[x]]), b: m.b.map(x => map[oldName[x]]), sa: +m.sa, sb: +m.sb, note: m.note || '', deleted_at: null, created_at: new Date().toISOString() }));
      if (!(await ask(`새 선수 ${add.length}명, 새 경기 ${rows.length}건을 추가할까요?`, '가져오기'))) break;
      state.players.push(...add); reindex(); state.matches.push(...rows); render();
      if (await run('가져오기', async () => { await savePlayers(add, []); return rows.length ? sb.from('matches').insert(rows.map(matchRowDb)) : null; })) { $('#restore') && ($('#restore').value = ''); toast('가져왔어요.'); }
      break;
    }
  }
});
root.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.form) form[t.dataset.form] = t.value;
  else if (t.hasAttribute('data-bulk')) bulk.text = t.value;
  else if (t.hasAttribute('data-np')) newPlayer = t.value;
  else if (t.dataset.ev) evForm[t.dataset.ev] = t.value;
});
root.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.f) { filter[t.dataset.f] = t.value; render(); }
  else if (t.dataset.form) { form[t.dataset.form] = t.value; if (t.dataset.form === 'date') render(); }
  else if (t.dataset.set) {
    if (!canAdmin()) return; mark();
    const k = t.dataset.set;
    if (k === 'club') state.club = t.value.trim() || state.club;
    else if (k === 'drawAt') state.drawAt = Math.max(1, parseInt(t.value, 10) || 5);
    else if (k === 'drawMode') state.drawMode = t.value === 'exclude' ? 'exclude' : 'half';
    else state.minGames = Math.max(0, parseInt(t.value, 10) || 0);
    render();
    if (await run('설정 저장', () => sb.from('settings').update(settingsRow()).eq('id', 1))) toast('설정을 저장했어요.');
  }
  else if (t.dataset.evname) {
    if (!canAdmin()) return; mark();
    const ev = liveEvents().find(e => e.id === t.dataset.evname); const v = t.value.trim();
    if (!ev || !v || v === ev.name) { render(); return; }
    ev.name = v; reindex(); render();
    if (await run('대회 이름 변경', () => sb.from('events').update({ name: v }).eq('id', ev.id))) toast('대회 이름을 바꿨어요.');
  }
  else if (t.dataset.rename) {
    if (!canAdmin()) return; mark();
    const p = PM.get(t.dataset.rename); const v = t.value.trim();
    if (!p) return;
    if (!v || state.players.some(x => x !== p && x.name === v)) { toast(v ? '같은 이름의 선수가 이미 있어요.' : '이름을 비울 수 없어요.'); render(); return; }
    p.name = v; render();
    await run('이름 변경', () => sb.from('players').update({ name: v }).eq('id', p.id));
  }
});
root.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'loginform') {
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email') || '').trim(), password: String(fd.get('password') || '') });
    if (error) { btn.disabled = false; toast('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.'); return; }
    await checkAdmin(); await load(true);
    toast(isAdmin ? '관리자로 로그인했어요.' : '관리자로 등록된 계정이 아니에요.');
    return;
  }
  if (e.target.id === 'eventform') {
    if (!canAdmin()) return; mark();
    const date = evForm.date || today(), name = evForm.name.trim();
    if (!name) { toast('대회 이름을 넣어 주세요.'); return; }
    if (EV.has(date)) { toast(date + '은 이미 대회로 지정되어 있어요.'); return; }
    const old = (state.events || []).find(x => x.date === date);
    let ev;
    if (old) { old.name = name; old.deleted_at = null; ev = old; }
    else { ev = { id: uid(), date, name, deleted_at: null }; state.events = (state.events || []).concat(ev); }
    reindex(); evForm = { date: '', name: '' }; render();
    const ok = await run('대회 지정', () => old ? sb.from('events').update({ name, deleted_at: null }).eq('id', old.id) : sb.from('events').insert({ id: ev.id, date, name }));
    if (ok) toast(`${date} '${name}' 대회를 지정했어요.`);
    return;
  }
  if (!canAdd()) return; mark();
  if (e.target.id === 'playerform') {
    const ns = [...new Set(newPlayer.split(/[,\n]/).map(s => s.trim()).filter(Boolean))];
    const fresh = ns.filter(n => !visiblePlayers().some(p => p.name === n && p.active !== false));
    newPlayer = '';
    if (!fresh.length) { if (ns.length) toast('이미 등록된 이름이에요.'); render(); return; }
    const { add, revive } = resolveNames(fresh);
    state.players.push(...add); revive.forEach(p => { p.deleted_at = null; p.active = true; }); reindex(); render();
    if (await run('선수 등록', () => savePlayers(add, revive))) toast(fresh.join(', ') + ' 님을 등록했어요.');
    setTimeout(() => { const i = $('[data-np]'); if (i) i.focus(); }, 0);
    return;
  }
  if (e.target.id === 'addform') {
    const D = form.type === 'D';
    const a = D ? [form.a1, form.a2] : [form.a1], b = D ? [form.b1, form.b2] : [form.b1];
    const sa = parseInt(form.sa, 10), sbv = parseInt(form.sb, 10);
    let err = '';
    if (!form.date) err = '날짜를 골라 주세요.';
    else if ([...a, ...b].some(x => !x)) err = '선수를 모두 골라 주세요.';
    else if (new Set([...a, ...b]).size !== a.length + b.length) err = '같은 선수가 두 번 들어가 있어요.';
    else if (!Number.isFinite(sa) || !Number.isFinite(sbv) || sa < 0 || sbv < 0) err = '점수를 입력해 주세요.';
    else err = scoreErr(sa, sbv);
    form.err = err;
    if (err) { render(); return; }
    const m = { id: uid(), t: Date.now(), date: form.date, type: form.type, a, b, sa, sb: sbv, note: form.note.trim(), deleted_at: null, created_at: new Date().toISOString() };
    state.matches.push(m);
    form = Object.assign(form, { a1: '', a2: '', b1: '', b2: '', sa: '', sb: '', note: '', err: '' });
    render();
    if (await run('경기 추가', () => sb.from('matches').insert(matchRowDb(m)))) toast('경기를 추가했어요.');
  }
});
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== view) go(h); });

// 다른 회원이 입력한 기록 반영: 앱으로 돌아올 때, 그리고 열려 있는 동안 1분마다
function typing(){ const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); }
const onLogin = () => view === 'settings' && !signedIn;   // 로그인 입력 중에는 화면을 새로 그리지 않음
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !busy && !onLogin()) load(true); });
setInterval(() => { if (document.visibilityState === 'visible' && !busy && !typing() && !onLogin() && !$('.modal-bg')) load(true); }, 60000);

/* ---------- start ---------- */
if (loadCache()) conn = 'loading';
render();
try { sb = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) { sb = null; }
async function checkAdmin(){
  isAdmin = false; signedIn = false; adminEmail = '';
  if (!sb) return;
  try {
    const { data } = await sb.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user) return;
    signedIn = true; adminEmail = user.email || '';
    const r = await sb.rpc('is_admin');
    isAdmin = !r.error && r.data === true;
  } catch (e) {}
}
checkAdmin().then(() => load());
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
