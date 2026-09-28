'use strict';
// Top bar (clock, next production, running shows), production queue, statistics dashboard,
// schedule timeline, categories and the console. Loaded before renderer.js; uses its globals
// (_shows, _settings, openShow, getSortedShows, freqLabel, esc, t, i18n) at call time.

let _queue          = [];     // [{ showId, name, category, time }] soonest first
let _running        = [];     // ids of shows in production
let _categoryFilter = null;   // sidebar filter by category name
let _statsRange     = 7;      // 7 | 14 | 30 days
let _timelineDays   = 1;      // 1 | 7
let _dashTimer      = null;

// ── Formatting ────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function fmtShort(ts) {
  const d = new Date(ts), loc = i18n.dateLocale();
  return `${d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(i18n.dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
}

function formatCountdown(ms) {
  if (ms <= 0) return t('count.now');
  const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const v = h >= 24 ? t('count.days', { d: Math.floor(h / 24), h: h % 24 })
    : h ? `${h}h ${pad2(m)}m ${pad2(s)}s` : m ? `${m}m ${pad2(s)}s` : `${s}s`;
  return t('count.in', { t: v });
}

function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 0) return t('day.today');
  if (diff === 1) return t('day.tomorrow');
  const s = d.toLocaleDateString(i18n.dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORY_PALETTE = ['#5b8cff', '#a478f0', '#38c6d9', '#35c98f', '#e6b450', '#ef6bab', '#ff8a4c', '#7bd88f', '#c084fc', '#4dd0e1', '#f2727f', '#8fb339'];

function categoryOf(show) { return (show.category || '').trim(); }

function categoryColor(name) {
  if (!name) return '#9aa1ae';
  const custom = (_settings.categoryColors || {})[name];
  if (/^#[0-9a-f]{6}$/i.test(custom || '')) return custom;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

// Settings → General: one row per category in use, with a colour picker and a reset button
function renderCategoryColors() {
  const el = document.getElementById('category-colors-list');
  if (!el) return;
  const cats = allCategories();
  if (!cats.length) { el.innerHTML = `<div class="hint">${t('set.cat.empty')}</div>`; return; }
  el.innerHTML = cats.map(c => {
    const n = _shows.filter(s => categoryOf(s) === c).length;
    return `<div class="cat-color-row">
      <input type="color" value="${categoryColor(c)}" data-cat-color="${esc(c)}" title="${esc(t('set.cat.pick'))}">
      <span class="cat-color-name">${esc(c)}</span>
      <span class="hint">${t(n === 1 ? 'set.cat.count.one' : 'set.cat.count', { n })}</span>
      <button type="button" class="btn btn-xs btn-ghost" data-cat-reset="${esc(c)}" title="${esc(t('set.cat.reset'))}">↺</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-cat-color]').forEach(input => {
    input.addEventListener('change', () => saveCategoryColor(input.dataset.catColor, input.value));
  });
  el.querySelectorAll('[data-cat-reset]').forEach(btn => {
    btn.addEventListener('click', () => saveCategoryColor(btn.dataset.catReset, null));
  });
}

async function saveCategoryColor(name, color) {
  const colors = { ..._settings.categoryColors };
  if (color) colors[name] = color; else delete colors[name];
  _settings = { ..._settings, categoryColors: colors };
  await api.saveSettings(_settings);
  renderSidebar();
  renderCategoryColors();
  if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
}

function categoryDot(name) {
  return `<i class="cat-dot" style="background:${categoryColor(name)}"></i>`;
}

function categoryPill(name) {
  if (!name) return '';
  const c = categoryColor(name);
  return `<span class="cat-pill" style="color:${c};background:${c}22;border-color:${c}66">${esc(name)}</span>`;
}

function allCategories() {
  return [...new Set(_shows.map(categoryOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Named categories alphabetically, shows without category last
function groupByCategory(shows) {
  const map = new Map();
  for (const s of shows) {
    const k = categoryOf(s);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  const named = [...map.entries()].filter(([k]) => k).sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name, items }));
  if (map.has('')) named.push({ name: '', items: map.get('') });
  return named;
}

function setCategoryFilter(name) {
  _categoryFilter = name;
  renderSidebar();
}

function renderCategoryFilter() {
  const el = document.getElementById('category-filter');
  if (!el) return;
  if (!_categoryFilter) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="category-filter-chip">${esc(_categoryFilter)} <span id="btn-clear-category">✕</span></span>`;
  document.getElementById('btn-clear-category').addEventListener('click', e => { e.stopPropagation(); setCategoryFilter(null); });
}

// ── Queue and top bar ─────────────────────────────────────────────────────────

function nextRunOf(showId) {
  const q = _queue.find(x => x.showId === showId);
  return q ? q.time : null;
}

async function refreshQueue() {
  try { _queue = await api.getQueue(7); } catch(_) { _queue = []; }
  renderQueue();
  renderNextWidget();
  renderSidebar();
  scheduleDashboardRefresh();
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  if (!list) return;
  if (!_queue.length) { list.innerHTML = `<div class="queue-empty">${t('queue.empty')}</div>`; return; }
  list.innerHTML = _queue.slice(0, 40).map((q, i) => `
    <div class="queue-item${i === 0 ? ' next' : ''}" data-show="${esc(q.showId)}" title="${esc(q.name)}">
      <span class="queue-time">${esc(fmtShort(q.time))}</span>
      <span class="queue-name">${categoryDot(q.category)}${esc(q.name)}</span>
    </div>`).join('');
  list.querySelectorAll('[data-show]').forEach(el => el.addEventListener('click', () => openShow(el.dataset.show)));
}

function renderNextWidget() {
  const nameEl = document.getElementById('next-widget-name');
  const cntEl  = document.getElementById('next-widget-countdown');
  const next = _queue[0];
  if (!next) { nameEl.textContent = t('next.none'); cntEl.textContent = '—'; return; }
  const minute = ts => Math.floor(ts / 60000);
  const names  = [...new Set(_queue.filter(q => minute(q.time) === minute(next.time)).map(q => q.name))];
  nameEl.textContent = `${names.join(' · ')} — ${fmtShort(next.time)}`;
  nameEl.title = names.join(', ');
  cntEl.textContent = formatCountdown(next.time - Date.now());
}

function tickTopbar() {
  const now = new Date(), loc = i18n.dateLocale();
  document.getElementById('clock-time').textContent = now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const d = now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('clock-date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  if (_queue.length) {
    const diff = _queue[0].time - now.getTime();
    document.getElementById('next-widget-countdown').textContent = formatCountdown(diff);
    if (diff < -5000) refreshQueue();   // the first item has started: move on
  }
  document.querySelectorAll('[data-countdown]').forEach(el => {
    el.textContent = formatCountdown(Number(el.dataset.countdown) - now.getTime());
  });
}

async function refreshRunning() {
  try { _running = await api.getRunning(); } catch(_) { _running = []; }
  const box  = document.getElementById('active-widget');
  const body = document.getElementById('active-widget-body');
  box.classList.toggle('hidden', !_running.length);
  body.innerHTML = _running.map(id => {
    const s = _shows.find(x => x.id === id);
    return `<div class="active-item" data-show="${esc(id)}"><span class="spinner"></span>${esc(s ? s.name : id)}</div>`;
  }).join('');
  body.querySelectorAll('[data-show]').forEach(el => el.addEventListener('click', () => openShow(el.dataset.show)));
}

// ── Dashboard (statistics) ────────────────────────────────────────────────────

function scheduleDashboardRefresh() {
  clearTimeout(_dashTimer);
  _dashTimer = setTimeout(() => {
    if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
  }, 800);
}

async function renderDashboard() {
  const root = document.getElementById('dashboard-body');
  const [stats, activity] = await Promise.all([api.getStats(), api.getActivity(60)]);
  const today = stats[dayKey(new Date())] || {};
  const days  = Object.values(stats);

  const enabled  = _shows.filter(s => s.enabled !== false).length;
  const next24   = _queue.filter(q => q.time - Date.now() <= 86400000);
  const bytes    = days.reduce((a, d) => a + (d.bytes || 0), 0);
  const durSum   = days.reduce((a, d) => a + (d.dur || 0), 0);
  const durN     = days.reduce((a, d) => a + (d.dn || 0), 0);
  let ok30 = 0, ko30 = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const st = stats[dayKey(d)];
    if (st) { ok30 += st.s || 0; ko30 += st.e || 0; }
  }
  const rate = ok30 + ko30 ? Math.round(ok30 * 100 / (ok30 + ko30)) + '%' : '—';

  // Productions per day over the selected range, oldest first
  const range = _statsRange;
  const dayList = [];
  for (let i = range - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); dayList.push(d); }
  const perDay = dayList.map(d => {
    const st = stats[dayKey(d)] || {};
    return { d, s: st.s || 0, e: st.e || 0, u: st.u || 0,
      label: range === 7 ? d.toLocaleDateString(i18n.dateLocale(), { weekday: 'short' }) : String(d.getDate()) };
  });
  const rS = perDay.reduce((a, x) => a + x.s, 0), rE = perDay.reduce((a, x) => a + x.e, 0), rU = perDay.reduce((a, x) => a + x.u, 0);
  const rB = dayList.reduce((a, d) => a + ((stats[dayKey(d)] || {}).bytes || 0), 0);
  const maxDay = Math.max(1, ...perDay.map(x => x.s + x.e));
  const chartH = 110, barW = range === 7 ? 34 : range === 14 ? 22 : 12, gap = range === 7 ? 16 : range === 14 ? 10 : 5;
  const chartW = range * (barW + gap) - gap;
  const bars = perDay.map((x, i) => {
    const px = i * (barW + gap), sH = Math.round(x.s / maxDay * chartH), eH = Math.round(x.e / maxDay * chartH), tot = x.s + x.e;
    const tip = `${x.d.toLocaleDateString(i18n.dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}: ${x.s} ok, ${x.e} ${t('st.failed')}, ${x.u} ${t('st.noupdate')}`;
    const lbl = range < 30 || i % 3 === 0 || i === range - 1;
    return `<g><title>${esc(tip)}</title>
      ${x.e ? `<rect x="${px}" y="${chartH - sH - eH}" width="${barW}" height="${eH}" rx="3" fill="var(--red)"/>` : ''}
      ${x.s ? `<rect x="${px}" y="${chartH - sH}" width="${barW}" height="${sH}" rx="3" fill="var(--green)"/>` : ''}
      ${!tot ? `<rect x="${px}" y="${chartH - 3}" width="${barW}" height="3" rx="1.5" fill="var(--border)"/>` : ''}
      ${tot && range <= 14 ? `<text x="${px + barW / 2}" y="${chartH - sH - eH - 4}" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="700">${tot}</text>` : ''}
      ${lbl ? `<text x="${px + barW / 2}" y="${chartH + 16}" text-anchor="middle" fill="var(--muted)" font-size="${range === 30 ? 9 : 10}">${esc(x.label)}</text>` : ''}</g>`;
  }).join('');

  // Per show and per hour over the same range
  const perShow = {}, hours = new Array(24).fill(0);
  for (const d of dayList) {
    const st = stats[dayKey(d)] || {};
    for (const [id, [s, e]] of Object.entries(st.shows || {})) { (perShow[id] ||= { s: 0, e: 0 }); perShow[id].s += s; perShow[id].e += e; }
    (st.hours || []).forEach((n, h) => { hours[h] += n; });
  }
  const showRows = Object.entries(perShow).map(([id, v]) => ({ id, name: (_shows.find(s => s.id === id) || {}).name, ...v }))
    .filter(r => r.name).sort((a, b) => (b.s + b.e) - (a.s + a.e));
  const maxShow = Math.max(1, ...showRows.map(r => r.s + r.e));
  const maxHour = Math.max(1, ...hours);
  const hourBars = hours.map((n, h) => {
    const bh = Math.round(n / maxHour * 70);
    return `<g><title>${pad2(h)}:00 – ${n}</title><rect x="${h * 14}" y="${74 - bh}" width="11" height="${Math.max(bh, n ? 2 : 1)}" rx="2" fill="${n ? 'var(--accent)' : 'var(--border)'}"/>
      ${h % 3 === 0 ? `<text x="${h * 14 + 5.5}" y="90" text-anchor="middle" fill="var(--muted)" font-size="9">${pad2(h)}</text>` : ''}</g>`;
  }).join('');

  const failing = showRows.filter(r => r.e).sort((a, b) => b.e - a.e).slice(0, 5);
  const catRows = groupByCategory(_shows).map(g => ({ name: g.name, n: g.items.length, on: g.items.filter(s => s.enabled !== false).length }));
  const resultDot = r => r === 'ok' ? 'ok' : r === 'error' ? 'err' : r === 'no-update' ? 'warn' : 'idle';
  const tile = (cls, v, key) => `<div class="stat-tile stat-${cls}"><div class="stat-value">${v}</div><div class="stat-label">${t(key)}</div></div>`;

  root.innerHTML = `
    <div class="stat-grid">
      ${tile('blue', _shows.length, 'st.total')}
      ${tile('purple', enabled, 'st.enabled')}
      ${tile('teal', next24.length, 'st.next24')}
      ${tile('ok', today.s || 0, 'st.today_ok')}
      ${tile('err', today.e || 0, 'st.today_err')}
    </div>
    <div class="stat-grid stat-grid-3">
      ${tile('teal', rate, 'st.rate30')}
      ${tile('blue', formatBytes(bytes), 'st.bytes')}
      ${tile('purple', formatDuration(durN ? durSum / durN : 0), 'st.avg')}
    </div>
    <div class="dash-columns">
      <div class="card">
        <div class="card-head"><h3>${t('st.activity', { n: range })}</h3>
          <div class="seg-control seg-small">${[7, 14, 30].map(n => `<button class="seg-btn${n === range ? ' on' : ''}" data-range="${n}">${t('st.days', { n })}</button>`).join('')}</div></div>
        <div class="chart-summary">
          <span><b>${rS + rE}</b> ${t('st.productions')}</span>
          <span style="color:var(--green)"><b>${rS}</b> ok</span>
          <span style="color:${rE ? 'var(--red)' : 'var(--muted)'}"><b>${rE}</b> ${t('st.failed')}</span>
          <span style="color:var(--muted)"><b>${rU}</b> ${t('st.noupdate')}</span>
          <span><b>${formatBytes(rB)}</b> ${t('st.produced')}</span>
        </div>
        <svg viewBox="0 -16 ${chartW} ${chartH + 40}" class="dash-chart">${bars}</svg>
        <div class="chart-legend"><span><i class="legend-dot" style="background:var(--green)"></i> ${t('st.legend_ok')}</span><span><i class="legend-dot" style="background:var(--red)"></i> ${t('st.legend_err')}</span></div>
      </div>
      <div class="card">
        <h3>${t('st.next24h')}</h3>
        ${next24.length ? `<div class="activity-list">${next24.map(q => `
          <div class="activity-row clickable" data-show="${esc(q.showId)}">
            <span class="activity-name">${categoryDot(q.category)}${esc(q.name)}</span><span class="activity-time">${esc(fmtShort(q.time))}</span></div>`).join('')}</div>`
          : `<div class="hint">${t('st.none24h')}</div>`}
      </div>
    </div>
    <div class="dash-columns">
      <div class="card">
        <h3>${t('st.per_show')} <span class="hint">— ${t('st.last_days', { n: range })}</span></h3>
        ${showRows.length ? `<div class="show-bars">${showRows.map(r => `
          <div class="show-bar-row clickable" data-show="${esc(r.id)}" title="${esc(r.name)}: ${r.s} ok, ${r.e} ${t('st.failed')}">
            <span class="show-bar-name">${esc(r.name)}</span>
            <span class="show-bar-track"><i style="width:${(r.s / maxShow * 100).toFixed(1)}%;background:var(--green)"></i><i style="width:${(r.e / maxShow * 100).toFixed(1)}%;background:var(--red)"></i></span>
            <span class="show-bar-num">${r.s + r.e}</span></div>`).join('')}</div>`
          : `<div class="hint">${t('st.none_period')}</div>`}
      </div>
      <div class="card">
        <h3>${t('st.per_hour')} <span class="hint">— ${t('st.last_days', { n: range })}</span></h3>
        <svg viewBox="0 0 336 96" class="dash-chart">${hourBars}</svg>
      </div>
    </div>
    <div class="dash-columns">
      <div class="card">
        <h3>${t('st.recent')}</h3>
        ${activity.length ? `<div class="activity-list">${activity.slice(0, 12).map(h => `
          <div class="activity-row clickable" data-show="${esc(h.showId)}"><span class="activity-dot ${resultDot(h.result)}"></span>
            <span class="activity-name">${esc(h.name)}</span>
            <span class="activity-detail">${esc(h.result === 'error' ? (h.error || t('st.legend_err')) : h.result === 'no-update' ? t('st.noupdate') : (h.filename || 'ok'))}</span>
            <span class="activity-time">${esc(fmtShort(h.date))}</span></div>`).join('')}</div>`
          : `<div class="hint">${t('st.no_activity')}</div>`}
      </div>
      <div class="card">
        <h3>${t('st.failing')} <span class="hint">— ${t('st.last_days', { n: range })}</span></h3>
        ${failing.length ? `<div class="activity-list">${failing.map(r => `
          <div class="activity-row clickable" data-show="${esc(r.id)}"><span class="activity-dot err"></span>
            <span class="activity-name">${esc(r.name)}</span><span class="activity-detail">${t(r.e > 1 ? 'st.errors' : 'st.error', { n: r.e })}</span></div>`).join('')}</div>`
          : `<div class="hint">${t('st.no_errors')}</div>`}
      </div>
    </div>
    ${catRows.length > 1 || (catRows[0] && catRows[0].name) ? `<div class="card">
      <h3>${t('st.by_category')}</h3>
      <div class="activity-list">${catRows.map(c => `
        <div class="activity-row clickable" data-category="${esc(c.name)}"><span class="activity-dot" style="background:${categoryColor(c.name)}"></span>
          <span class="activity-name">${esc(c.name || t('cat.none'))}</span><span class="activity-detail">${t('st.cat_count', { on: c.on, n: c.n })}</span></div>`).join('')}</div>
    </div>` : ''}`;

  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { _statsRange = Number(b.dataset.range); renderDashboard(); }));
  root.querySelectorAll('[data-show]').forEach(el => el.addEventListener('click', () => openShow(el.dataset.show)));
  root.querySelectorAll('[data-category]').forEach(el => el.addEventListener('click', () => setCategoryFilter(el.dataset.category || null)));
}

// ── Schedule: shows grid and timeline ─────────────────────────────────────────

function renderPalinsesto() {
  const timeline = document.querySelector('#pal-mode .seg-btn.on').dataset.pal === 'timeline';
  document.getElementById('pal-shows').classList.toggle('hidden', timeline);
  document.getElementById('pal-timeline').classList.toggle('hidden', !timeline);
  if (timeline) renderTimeline(); else renderShowsGrid();
}

async function renderTimeline() {
  const root  = document.getElementById('timeline-body');
  const items = (await api.getQueue(_timelineDays)).filter(q => q.time - Date.now() <= _timelineDays * 86400000);
  if (!items.length) { root.innerHTML = `<div class="hint" style="padding:20px 0">${t('queue.empty')}</div>`; return; }
  const byDay = new Map();
  for (const q of items) {
    const k = dayKey(new Date(q.time));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(q);
  }
  root.innerHTML = [...byDay.values()].map(list => `
    <div class="timeline-day">
      <h3>${esc(dayLabel(list[0].time))} <span class="hint">· ${t('pal.count', { n: list.length })}</span></h3>
      ${list.map(q => {
        const s = _shows.find(x => x.id === q.showId) || {};
        const fmt = (s.outputFormat || 'mp3') === 'copy' ? t('pal.copy') : (s.outputFormat || 'mp3').toUpperCase();
        const dest = [s.ftp && s.ftp.enabled ? 'FTP' : '', s.outputFolder ? t('chip.local') : '', s.archiveEnabled ? t('chip.archive') : ''].filter(Boolean).join(' · ');
        return `<div class="timeline-row clickable" data-show="${esc(q.showId)}">
          <span class="timeline-time">${esc(fmtTime(q.time))}</span>
          <span class="timeline-name">${esc(q.name)} ${categoryPill(q.category)}</span>
          <span class="timeline-meta">${esc(fmt)}${dest ? ' → ' + esc(dest) : ''}</span>
          <span class="timeline-count" data-countdown="${q.time}">${esc(formatCountdown(q.time - Date.now()))}</span>
        </div>`;
      }).join('')}
    </div>`).join('');
  root.querySelectorAll('[data-show]').forEach(el => el.addEventListener('click', () => openShow(el.dataset.show)));
}

document.querySelectorAll('#pal-mode .seg-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#pal-mode .seg-btn').forEach(x => x.classList.toggle('on', x === b));
  renderPalinsesto();
}));
document.querySelectorAll('#timeline-range .seg-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#timeline-range .seg-btn').forEach(x => x.classList.toggle('on', x === b));
  _timelineDays = Number(b.dataset.range);
  renderTimeline();
}));

// ── Console: live output of every production ─────────────────────────────────

const CONSOLE_MAX = 500;

function initConsole() {
  const box = document.getElementById('console');
  const toggle = () => {
    box.classList.toggle('collapsed');
    document.getElementById('btn-toggle-console').textContent = box.classList.contains('collapsed') ? '▸' : '▾';
  };
  document.getElementById('console-header').addEventListener('click', e => { if (!e.target.closest('#btn-clear-console')) toggle(); });
  document.getElementById('btn-clear-console').addEventListener('click', () => {
    document.getElementById('console-body').innerHTML = '';
    document.getElementById('console-count').textContent = '';
  });
}

function consoleAppend(showId, line) {
  const body = document.getElementById('console-body');
  const text = String(line || '').replace(/\s+$/, '');
  if (!text) return;
  const s = _shows.find(x => x.id === showId);
  const row = document.createElement('div');
  row.className = 'console-line' + (/ERROR|ERRORE|FAILED|fallit|fallid/i.test(text) ? ' err' : /WARNING|ATTENZIONE|ATENCIÓN/i.test(text) ? ' warn' : '');
  row.textContent = `${s ? s.name : showId} · ${text.replace(/^\[[^\]]+\]\s*/, '')}`;
  const stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
  body.appendChild(row);
  while (body.childElementCount > CONSOLE_MAX) body.firstChild.remove();
  if (stick) body.scrollTop = body.scrollHeight;
  document.getElementById('console-count').textContent = body.childElementCount;
}
