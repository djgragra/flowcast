'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let _shows    = [];
let _settings = {};
let _activeShowId = null;
let _isNew    = false;
let _editMode = false;
let _wavCount = 0;
let _sortField   = 'name'; // 'name' | 'schedule'
let _sortDir     = 'asc';  // 'asc' | 'desc'
let _filters     = new Set(); // empty = all; values: 'enabled','disabled','error'
let _searchQuery = '';        // text search on show name

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  _settings = await api.getSettings();
  _shows    = await api.getShows();

  i18n.load(_settings.language || 'en');
  i18n.applyI18n();

  applyTheme(_settings.theme || 'dark');
  applySortUI();
  renderSidebar();
  renderDashboard();
  showView('dashboard');

  // Clock: tick every second; next-task refresh every 60s
  updateDashboardClock();
  updateNextTask();
  _clockInterval = setInterval(updateDashboardClock, 1000);
  setInterval(updateNextTask, 60000);

  checkFfmpegWarning();
  refreshAboutVersion();

  api.onShowStatus(({ id, status }) => updateShowStatus(id, status));
  api.onLogLine(({ id, line }) => { if (_activeShowId === id) appendLogLine(line); });
  api.onShowTriggered(({ id }) => { if (_activeShowId === id) refreshLogOutput(id); });
  api.onShowUpdated(({ id, lastRun, lastResult, lastDetails }) => {
    const show = _shows.find(s => s.id === id);
    if (show) { show.lastRun = lastRun; show.lastResult = lastResult; if (lastDetails !== undefined) show.lastDetails = lastDetails; }
    updateDashboardCard(id);
  });
}

// ── Views ─────────────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === name);
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('shows-list');
  list.innerHTML = '';

  if (_shows.length === 0) {
    list.innerHTML = `<div style="padding:16px 10px;font-size:12px;color:var(--muted)">${t('sidebar.no_shows')}</div>`;
    return;
  }

  getSortedShows().forEach(show => {
    const item = document.createElement('div');
    item.className = 'show-item'
      + (show.id === _activeShowId ? ' active' : '')
      + (!show.enabled ? ' disabled-show' : '');
    item.dataset.id = show.id;

    let subLine = '';
    if (isExpired(show))             subLine = t('card.expired');
    else if (!show.enabled)          subLine = t('show.disabled');
    else if (show.mode === 'manual') subLine = t('sidebar.manual');
    else if (show.schedule && show.schedule.time)
      subLine = `🕐 ${show.schedule.time} · ${freqLabel(show.schedule.freq)}`;
    else subLine = t('sidebar.no_sched');

    item.innerHTML = `
      <span class="si-dot ${show.lastResult || 'idle'}"></span>
      <span class="si-info">
        <span class="si-name">${esc(show.name || t('show.new'))}</span>
        <span class="si-next">${esc(subLine)}</span>
      </span>`;

    item.addEventListener('click', () => openShow(show.id));
    list.appendChild(item);
  });
}

function updateShowStatus(id, status) {
  const show = _shows.find(s => s.id === id);
  if (show) show.lastResult = status;

  const dot = document.querySelector(`.show-item[data-id="${id}"] .si-dot`);
  if (dot) dot.className = 'si-dot ' + status;

  if (_activeShowId === id) renderShowBadge(status);

  const card = document.querySelector(`.show-card[data-id="${id}"]`);
  if (card) {
    card.className = `show-card status-${status}`;
    const sc = card.querySelector('.sc-status');
    if (sc) sc.innerHTML = badgeHtml(status);
  }

  document.getElementById('tb-status').textContent =
    status === 'running' && show ? `▶ ${show.name}…` : '';
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

// Returns a numeric sort key for schedule-based ordering.
// Combines day-of-week (0=daily/always, 1=Mon, …, 7=Sun) with time-of-day.
// Manual shows or shows without schedule sort last.
function _scheduleKey(show) {
  if (show.mode === 'manual' || !show.schedule || !show.schedule.time) return 9999999;
  const [h, m] = show.schedule.time.split(':').map(Number);
  const timeMin = h * 60 + (m || 0);
  const DAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
  let dayBase = 0; // 0 = runs every day (sorts earliest)
  const freq = show.schedule.freq;
  if      (freq === 'daily')    dayBase = 0;
  else if (freq === 'weekdays') dayBase = 1;  // Mon = 1
  else if (freq === 'weekend')  dayBase = 6;  // Sat = 6
  else if (freq === 'specific') {
    const days = show.schedule.days || [];
    dayBase = days.length ? Math.min(...days.map(d => DAY[d] || 8)) : 8;
  }
  return dayBase * 10000 + timeMin;
}

function getSortedShows() {
  return [..._shows].sort((a, b) => {
    let cmp;
    if (_sortField === 'schedule') {
      cmp = _scheduleKey(a) - _scheduleKey(b);
      if (cmp === 0) {
        const dA = (a.schedule && a.schedule.startDate) || '0000-00-00';
        const dB = (b.schedule && b.schedule.startDate) || '0000-00-00';
        cmp = dA < dB ? -1 : dA > dB ? 1 : 0;
      }
    } else if (_sortField === 'lastrun') {
      const tA = a.lastRun ? new Date(a.lastRun).getTime() : 0;
      const tB = b.lastRun ? new Date(b.lastRun).getTime() : 0;
      cmp = tB - tA; // newest first when asc
    } else {
      const av = (a.name || '').toLowerCase();
      const bv = (b.name || '').toLowerCase();
      cmp = av < bv ? -1 : av > bv ? 1 : 0;
    }
    return _sortDir === 'asc' ? cmp : -cmp;
  });
}

function isExpired(show) {
  const end = show.schedule && show.schedule.endDate;
  if (!end) return false;
  return end < new Date().toISOString().slice(0, 10);
}

function matchesFilter(show) {
  // Text search: AND with filter chips
  if (_searchQuery) {
    if (!(show.name || '').toLowerCase().includes(_searchQuery.toLowerCase())) return false;
  }
  if (_filters.size === 0) return true;
  if (_filters.has('active')   && !isExpired(show))         return true;
  if (_filters.has('enabled')  && show.enabled !== false && !isExpired(show)) return true;
  if (_filters.has('disabled') && show.enabled === false  && !isExpired(show)) return true;
  if (_filters.has('expired')  && isExpired(show))          return true;
  if (_filters.has('error')) {
    if (show.lastResult === 'error') return true;
    const d = show.lastDetails;
    if (d && (d.ftp === 'error' || d.local === 'error' || d.archive === 'error')) return true;
  }
  return false;
}

function applyFilterUI() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    if (chip.dataset.filter === 'all') {
      chip.classList.toggle('active', _filters.size === 0);
    } else {
      chip.classList.toggle('active', _filters.has(chip.dataset.filter));
    }
  });
  const visible = _shows.filter(matchesFilter).length;
  const countEl = document.getElementById('filter-count');
  if (countEl) {
    countEl.textContent = (_filters.size > 0) ? `${visible} / ${_shows.length}` : '';
  }
}

// ── Dashboard clock & next task ──────────────────────────────────────────────

let _clockInterval = null;

function updateDashboardClock() {
  const el = document.getElementById('dash-clock');
  if (!el) return;
  const now = new Date();
  const loc = i18n.dateLocale();
  const date = now.toLocaleDateString(loc, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const time = now.toLocaleTimeString(loc, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const cap  = date.charAt(0).toUpperCase() + date.slice(1);
  el.innerHTML = `${cap} <span class="dash-clock-time">${time}</span>`;
}

async function updateNextTask() {
  const el = document.getElementById('dash-next-task');
  if (!el) return;
  try {
    const task = await api.getNextTask();
    if (task) {
      el.innerHTML = t('dash.next_task', { name: esc(task.name), time: task.time });
    } else {
      el.textContent = t('dash.no_task');
    }
  } catch(e) { el.textContent = ''; }
}

function applySortUI() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === _sortField);
  });
  const dirBtn = document.getElementById('btn-sort-dir');
  if (dirBtn) {
    if (_sortField === 'schedule') {
      dirBtn.textContent = _sortDir === 'asc' ? t('sort.asc_sched') : t('sort.desc_sched');
    } else if (_sortField === 'lastrun') {
      dirBtn.textContent = _sortDir === 'asc' ? t('sort.asc_lastrun') : t('sort.desc_lastrun');
    } else {
      dirBtn.textContent = _sortDir === 'asc' ? t('sort.asc_name') : t('sort.desc_name');
    }
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  const grid = document.getElementById('dashboard-grid');
  grid.innerHTML = '';

  if (_shows.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">🎙</div><p>${t('dash.empty.text')}</p><button class="btn btn-primary" id="btn-empty-new-show">${t('dash.empty.btn')}</button></div>`;
    document.getElementById('btn-empty-new-show').addEventListener('click', newShow);
    applyFilterUI();
    return;
  }

  const visible = getSortedShows().filter(matchesFilter);

  if (visible.length === 0) {
    grid.innerHTML = `<div class="h-empty" style="padding:40px 0;text-align:center">${t('dash.no_match')}</div>`;
  } else {
    visible.forEach(show => renderDashboardCard(show));
    // Fill nextRun asynchronously
    visible.filter(s => s.enabled !== false && s.mode !== 'manual').forEach(show => {
      api.nextRun(show).then(str => {
        const el = document.getElementById(`card-nextrun-${show.id}`);
        if (el) el.textContent = str ? `⏱ ${str}` : '';
      }).catch(() => {});
    });
  }

  applyFilterUI();
}

function renderDashboardCard(show) {
  const grid   = document.getElementById('dashboard-grid');
  const status = show.lastResult || 'idle';

  // Remove existing card if present
  const existing = document.querySelector(`.show-card[data-id="${show.id}"]`);
  if (existing) existing.remove();

  // Effective card status: 'error' if any enabled op failed
  const _d = show.lastDetails;
  let effectiveStatus = status;
  if (_d && show.lastResult === 'ok') {
    const _ops = [];
    if (show.outputFolder)                              _ops.push(_d.local);
    if (show.ftp && show.ftp.enabled && show.ftp.host) _ops.push(_d.ftp);
    if (show.archiveEnabled)                            _ops.push(_d.archive);
    if (_ops.some(s => s === 'error')) effectiveStatus = 'error';
  }

  const expired = isExpired(show);
  const card = document.createElement('div');
  card.className = `show-card status-${effectiveStatus}${show.enabled === false ? ' card-disabled' : ''}${expired ? ' card-expired' : ''}`;
  card.dataset.id = show.id;

  let subLine = '';
  if (!show.enabled)               subLine = t('show.disabled');
  else if (show.mode === 'manual') subLine = t('card.manual');
  else if (show.schedule && show.schedule.time)
    subLine = `🕐 ${show.schedule.time} · ${freqLabel(show.schedule.freq)}`;
  else subLine = '—';

  const fmt      = show.outputFormat && show.outputFormat !== 'copy' ? show.outputFormat : 'mp3';
  const fname    = show.slug ? `${show.slug}_DD-MM-YYYY_HH-NN.${fmt}` : '—';
  const modeTag  = show.mode === 'manual'
    ? `<span class="card-tag tag-manual">${t('sidebar.manual')}</span>` : '';
  const disabledTag = show.enabled === false
    ? `<span class="card-tag tag-disabled">${t('card.disabled')}</span>` : '';
  const expiredTag = expired
    ? `<span class="card-tag tag-expired">${t('card.expired')}</span>` : '';

  const lastRunStr = show.lastRun
    ? new Date(show.lastRun).toLocaleString(i18n.dateLocale(), { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : null;
  const lastRunHtml = lastRunStr
    ? `<div class="sc-lastrun">${t('card.last_run', { date: lastRunStr, result: statusLabel(show.lastResult || 'idle') })}</div>`
    : '';

  // Chips with inline status dots (show dot only when we have lastDetails)
  const d = show.lastDetails;
  function chipDot(opStatus) {
    if (!d) {
      // No lastDetails (old run): green if overall ok, else no dot
      return (show.lastResult === 'ok')
        ? '<span class="chip-dot chip-dot-ok">●</span>'
        : '';
    }
    if (opStatus === 'ok')    return '<span class="chip-dot chip-dot-ok">●</span>';
    if (opStatus === 'error') return '<span class="chip-dot chip-dot-err">●</span>';
    return '<span class="chip-dot chip-dot-skip">●</span>';
  }
  // Build tooltips for chips
  const _localTip   = show.outputFolder || '';
  const _ftpTip     = show.ftp
    ? (show.ftp.name ? show.ftp.name + ' → ' : '') + (show.ftp.remotePath || '/')
    : '';
  const _archSub    = show.archivePath || '';
  const _archAbs    = /^[A-Za-z]:[\\/]/.test(_archSub) || /^\\\\/.test(_archSub);
  const _archiveTip = _archAbs ? _archSub
    : (_settings.baseArchive && _archSub ? `${_settings.baseArchive}\\${_archSub}` : _archSub);

  const chips = [];
  if (show.outputFolder)                              chips.push(`<span class="chip chip-local" title="${esc(_localTip)}">📁 ${t('chip.local') || 'Local'}${chipDot(d && d.local)}</span>`);
  if (show.ftp && show.ftp.enabled && show.ftp.host) chips.push(`<span class="chip chip-ftp" title="${esc(_ftpTip)}">📡 FTP${chipDot(d && d.ftp)}</span>`);
  if (show.archiveEnabled)                            chips.push(`<span class="chip chip-archive" title="${esc(_archiveTip)}">🗄 ${t('chip.archive') || 'Archive'}${chipDot(d && d.archive)}</span>`);
  const chipsHtml = chips.length ? `<div class="card-chips">${chips.join('')}</div>` : '';

  // Prossima esecuzione placeholder (filled async by renderDashboard)
  const nextRunHtml = (show.enabled && show.mode !== 'manual')
    ? `<div class="sc-nextrun" id="card-nextrun-${show.id}"></div>`
    : '';

  card.innerHTML = `
    <div class="sc-name">${esc(show.name || t('show.new'))}${modeTag}${disabledTag}${expiredTag}</div>
    <div class="sc-meta">${esc(subLine)}</div>
    <div class="sc-meta" style="font-family:monospace;font-size:10px;color:var(--accent)">${esc(fname)}</div>
    <div class="sc-status">${badgeHtml(status)}</div>
    ${lastRunHtml}
    ${chipsHtml}
    ${nextRunHtml}`;

  card.addEventListener('click', () => openShow(show.id));
  grid.appendChild(card);
}

function updateDashboardCard(id) {
  const show = _shows.find(s => s.id === id);
  if (!show) return;
  if (!matchesFilter(show)) {
    // Remove card if now excluded by active filter
    const existing = document.querySelector(`.show-card[data-id="${id}"]`);
    if (existing) existing.remove();
    applyFilterUI();
    return;
  }
  renderDashboardCard(show);
  if (show.enabled !== false && show.mode !== 'manual') {
    api.nextRun(show).then(str => {
      const el = document.getElementById(`card-nextrun-${show.id}`);
      if (el) el.textContent = str ? `⏱ ${str}` : '';
    }).catch(() => {});
  }
  applyFilterUI();
}

// ── Show detail ───────────────────────────────────────────────────────────────

async function openShow(id) {
  _activeShowId = id;
  _isNew = false;
  const show = _shows.find(s => s.id === id) || await api.getShow(id);
  if (!show) return;

  fillShowForm(show);
  setEditMode(false); // view mode — click Modifica to edit
  renderSidebar();
  showView('show');
  switchTab('generale');
  refreshNextRun();
}

async function newShow() {
  const id   = await api.newId();
  const show = {
    id,
    name: '', slug: '',
    enabled: true,
    mode: 'scheduled',
    outputFormat: 'mp3',
    bitrate: '192k',
    wavBase:  _settings.baseWav || '',
    wavFiles: [''],
    archiveEnabled:  false,
    archivePath:     '',
    workDirOverride: '',
    verificaFile:    '',
    outputFolder:    '',
    clearOutput:     false,
    schedule: { time: '14:00', freq: 'daily', days: [], startDate: new Date().toISOString().slice(0,10), endDate: null },
    ftp: { enabled: false, name: '', host: '', port: 21, user: '', password: '', remotePath: '', secure: false },
    lastRun: null, lastResult: null
  };

  _isNew = true;
  _activeShowId = id;
  _shows.unshift(show);
  renderSidebar();
  fillShowForm(show);
  setEditMode(true); // new show starts directly in edit mode
  showView('show');
  switchTab('generale');
}

function fillShowForm(show) {
  document.getElementById('show-title').textContent = show.name || t('show.new');
  renderShowBadge(show.lastResult || 'idle');
  renderEnabledBtn(show.enabled !== false);

  document.getElementById('f-name').value          = show.name         || '';
  document.getElementById('f-slug').value          = show.slug         || '';
  document.getElementById('f-output-format').value = show.outputFormat || 'mp3';
  document.getElementById('f-bitrate').value       = show.bitrate      || '192k';
  toggleBitrateField(show.outputFormat || 'mp3');
  updateFilenamePreview(show.slug || '');
  setMode(show.mode || 'scheduled');

  document.getElementById('f-working').value  = show.workDirOverride || '';
  document.getElementById('f-verifica').value = show.verificaFile    || '';

  document.getElementById('f-wav-base').value = show.wavBase || '';
  buildWavList(show.wavFiles || ['']);

  const sch = show.schedule || {};
  document.getElementById('f-time').value           = sch.time      || '14:00';
  document.getElementById('f-freq').value           = sch.freq      || 'daily';
  document.getElementById('f-schedule-start').value = sch.startDate || '';
  document.getElementById('f-schedule-end').value   = sch.endDate   || '';
  setDayChips(sch.days || []);
  toggleDaysField(sch.freq);
  updateScheduleTabState(show.mode || 'scheduled');
  updateScheduleRangeInfo(sch);

  const ftp = show.ftp || {};
  document.getElementById('f-ftp-enabled').checked      = !!ftp.enabled;
  document.getElementById('f-ftp-bookmark-id').value    = ftp.bookmarkId || '';
  document.getElementById('f-ftp-host').value           = ftp.host       || '';
  document.getElementById('f-ftp-port').value           = ftp.port       || 21;
  document.getElementById('f-ftp-user').value           = ftp.user       || '';
  document.getElementById('f-ftp-pass').value           = ftp.password   || '';
  document.getElementById('f-ftp-path').value           = ftp.remotePath || '';
  document.getElementById('f-ftp-secure').checked       = !!ftp.secure;
  populateFtpBookmarkSelect(ftp.bookmarkId || '');
  toggleFtpFields(!!ftp.enabled);
  document.getElementById('f-output-folder').value  = show.outputFolder || '';
  document.getElementById('f-clear-output').checked = !!show.clearOutput;

  const archEnabled = !!show.archiveEnabled;
  document.getElementById('f-archive-enabled').checked = archEnabled;
  document.getElementById('f-archive').value            = show.archivePath || '';
  toggleArchiveFields(archEnabled);
  updateArchivePreview();

  refreshLogOutput(show.id);
  document.getElementById('ftp-test-result').textContent = '';
}

function renderShowBadge(status) {
  const el = document.getElementById('show-badge');
  el.className = `badge badge-${status}`;
  el.textContent = statusLabel(status);
}

function renderEnabledBtn(enabled) {
  const btn = document.getElementById('btn-toggle-enabled');
  btn.className = `btn-enable ${enabled ? 'on' : 'off'}`;
  btn.textContent = enabled ? t('show.enabled') : t('show.disabled');
}

function toggleBitrateField(format) {
  const el = document.getElementById('field-bitrate');
  if (el) el.style.display = format === 'copy' ? 'none' : '';
}

function updateFilenamePreview(slug) {
  const format = document.getElementById('f-output-format')?.value || 'mp3';
  const ext    = format === 'copy' ? '*' : format;
  const el = document.getElementById('filename-preview');
  el.textContent = slug ? `→ ${slug}_DD-MM-YYYY_HH-NN.${ext}` : '';
}

function setEditMode(on) {
  _editMode = on;
  const show = (id) => document.getElementById(id).style.display = '';
  const hide = (id) => document.getElementById(id).style.display = 'none';

  if (on) {
    hide('btn-edit-show');
    show('btn-save-show');
    show('btn-cancel-show');
    show('btn-duplicate-show');
  } else {
    show('btn-edit-show');
    hide('btn-save-show');
    hide('btn-cancel-show');
    hide('btn-duplicate-show');
  }

  // Tab content: lock/unlock form fields (exclude log/registro tabs which are always interactive)
  const formTabs = ['tab-generale','tab-sorgenti','tab-schedule','tab-output','tab-archivio'];
  formTabs.forEach(tabId => {
    const el = document.getElementById(tabId);
    if (el) el.classList.toggle('form-locked', !on);
  });
}

function setMode(mode) {
  document.getElementById('f-mode').value = mode;
  document.getElementById('mode-scheduled').className = 'mode-card' + (mode === 'scheduled' ? ' selected' : '');
  document.getElementById('mode-manual').className    = 'mode-card' + (mode === 'manual'    ? ' selected-manual' : '');
  updateScheduleTabState(mode);
}

function updateScheduleTabState(mode) {
  const notice = document.getElementById('schedule-manual-notice');
  const fields = document.getElementById('schedule-fields');
  if (mode === 'manual') {
    notice.style.display = '';
    fields.style.opacity = '0.4';
    fields.style.pointerEvents = 'none';
  } else {
    notice.style.display = 'none';
    fields.style.opacity = '1';
    fields.style.pointerEvents = '';
  }
  const tabBtn = document.getElementById('tab-btn-schedule');
  if (tabBtn) tabBtn.style.opacity = mode === 'manual' ? '0.5' : '';
}

function toggleArchiveFields(enabled) {
  document.getElementById('archive-fields').style.opacity = enabled ? '1' : '0.4';
  document.querySelectorAll('#archive-fields input, #archive-fields button').forEach(el => {
    el.disabled = !enabled;
  });
}

function updateArchivePreview() {
  const base = _settings.baseArchive || '';
  const sub  = document.getElementById('f-archive').value.trim();
  const lbl  = document.getElementById('archive-base-label');
  const prev = document.getElementById('archive-preview');
  if (lbl) lbl.textContent = base ? t('arch.base', { path: base }) : t('arch.no_base');
  if (prev) {
    if (!sub) { prev.textContent = ''; return; }
    // If absolute path, show as-is; otherwise combine
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(sub) || /^\\\\/.test(sub);
    prev.textContent = isAbsolute ? `→ ${sub}` : (base ? `→ ${base}\\${sub}` : `→ ${sub}`);
  }
}

function collectShowData() {
  const show = { ...(_shows.find(s => s.id === _activeShowId) || {}), id: _activeShowId };

  show.name         = document.getElementById('f-name').value.trim();
  show.slug         = document.getElementById('f-slug').value.trim();
  show.outputFormat = document.getElementById('f-output-format').value;
  show.bitrate      = document.getElementById('f-bitrate').value;
  show.enabled      = document.getElementById('btn-toggle-enabled').classList.contains('on');
  show.mode         = document.getElementById('f-mode').value;

  show.workDirOverride = document.getElementById('f-working').value.trim();
  show.verificaFile    = document.getElementById('f-verifica').value.trim();

  show.wavBase  = document.getElementById('f-wav-base').value.trim();
  show.wavFiles = collectWavFiles();

  show.schedule = {
    time:      document.getElementById('f-time').value,
    freq:      document.getElementById('f-freq').value,
    days:      collectDays(),
    startDate: document.getElementById('f-schedule-start').value || null,
    endDate:   document.getElementById('f-schedule-end').value   || null
  };

  show.outputFolder   = document.getElementById('f-output-folder').value.trim();
  show.clearOutput    = document.getElementById('f-clear-output').checked;
  show.archiveEnabled = document.getElementById('f-archive-enabled').checked;
  show.archivePath    = document.getElementById('f-archive').value.trim();

  show.ftp = {
    enabled:    document.getElementById('f-ftp-enabled').checked,
    bookmarkId: document.getElementById('f-ftp-bookmark-id').value || null,
    host:       document.getElementById('f-ftp-host').value.trim(),
    port:       parseInt(document.getElementById('f-ftp-port').value) || 21,
    user:       document.getElementById('f-ftp-user').value.trim(),
    password:   document.getElementById('f-ftp-pass').value,
    remotePath: document.getElementById('f-ftp-path').value.trim(),
    secure:     document.getElementById('f-ftp-secure').checked
  };

  return show;
}

async function saveShow() {
  const show = collectShowData();

  // Validate name
  if (!show.name) {
    document.getElementById('f-name').classList.add('error');
    switchTab('generale');
    document.getElementById('f-name').focus();
    return;
  }
  document.getElementById('f-name').classList.remove('error');

  if (!show.slug) show.slug = slugify(show.name);

  await api.saveShow(show);

  const idx = _shows.findIndex(s => s.id === show.id);
  if (idx >= 0) _shows[idx] = show; else _shows.unshift(show);

  _isNew = false;
  setEditMode(false); // back to view mode after save
  document.getElementById('show-title').textContent = show.name;
  renderSidebar();
  renderDashboard();
  refreshNextRun();
  updateNextTask();
}

async function deleteShow() {
  const show = _shows.find(s => s.id === _activeShowId);
  if (!show) return;
  if (!confirm(t('confirm.delete_show', { name: show.name }))) return;
  await api.deleteShow(_activeShowId);
  _shows = _shows.filter(s => s.id !== _activeShowId);
  _activeShowId = null; _isNew = false;
  renderSidebar(); renderDashboard(); showView('dashboard');
  updateNextTask();
}

async function duplicateShow() {
  if (!_activeShowId) return;
  const copy = await api.duplicateShow(_activeShowId);
  if (!copy) return;
  _shows.unshift(copy);
  renderSidebar();
  renderDashboard();
  _activeShowId = copy.id;
  _isNew = true; // treat as new so cancel → dashboard
  fillShowForm(copy);
  setEditMode(true);
  showView('show');
  switchTab('generale');
}

// ── FTP Bookmarks (Settings page) ─────────────────────────────────────────────

function _bmEditPanelHtml(bm) {
  // Shared HTML for both new and existing bookmark edit panels
  return `
    <div class="bm-edit-grid">
      <label>${t('bm.field.name')}</label><input class="bep-name" type="text" value="${esc(bm.name || '')}" placeholder="e.g. Main FTP">
      <label>${t('bm.field.host')}</label><input class="bep-host" type="text" value="${esc(bm.host || '')}" placeholder="ftp.example.com">
      <label>${t('bm.field.port')}</label><input class="bep-port" type="number" value="${bm.port || 21}" style="width:70px">
      <label>${t('bm.field.user')}</label><input class="bep-user" type="text" value="${esc(bm.user || '')}">
      <label>${t('bm.field.pass')}</label>
        <div class="ir" style="gap:4px">
          <input class="bep-pass" type="password" value="${esc(bm.password || '')}" placeholder="••••••••" style="flex:1">
          <button type="button" class="btn btn-muted btn-sm bep-eye" tabindex="-1">👁</button>
        </div>
      <label>${t('bm.field.path')}</label>
        <div class="ir" style="gap:4px">
          <input class="bep-path" type="text" value="${esc(bm.remotePath || '')}" placeholder="/percorso/remoto" style="flex:1">
          <button type="button" class="btn btn-muted btn-sm bep-browse-path" tabindex="-1" title="Sfoglia FTP">📂</button>
        </div>
      <label>FTPS</label><label style="cursor:pointer"><input class="bep-secure" type="checkbox" ${bm.secure ? 'checked' : ''}> Secure (FTPS)</label>
    </div>
    <div class="bm-notify" style="display:none;margin-bottom:8px;color:var(--green);font-size:12px"></div>`;
}

async function refreshSettingsFtpSection() {
  const bms = await api.getFtpBookmarks();
  const container = document.getElementById('ftp-bookmarks-list');
  if (!container) return;

  if (!bms || bms.length === 0) {
    container.innerHTML = `<div class="h-empty" style="padding:20px 0">${t('bm.empty')}</div>`;
    return;
  }

  container.innerHTML = '';
  bms.forEach(bm => {
    // Compact row: name only + expand + delete
    const row = document.createElement('div');
    row.className = 'bm-row bm-row-compact';
    row.dataset.bmId = bm.id;
    row.innerHTML = `
      <button class="btn-icon bm-expand-btn" data-id="${esc(bm.id)}" title="${t('bm.edit.title')}">▶</button>
      <span class="bm-name">${esc(bm.name)}</span>
      <span class="bm-host-hint">${esc(bm.host || '')}</span>
      <button class="btn btn-danger btn-sm bm-del-btn" data-id="${esc(bm.id)}" title="${t('bm.del.title')}">🗑</button>`;

    // Edit panel (hidden by default)
    const panel = document.createElement('div');
    panel.className = 'bm-edit-panel hidden';
    panel.id = `bm-panel-${bm.id}`;
    panel.innerHTML = _bmEditPanelHtml(bm) + `
      <div class="bm-edit-actions">
        <button class="btn btn-primary btn-sm bep-save-btn" data-id="${esc(bm.id)}">${t('bm.edit.save')}</button>
        <button class="btn btn-muted   btn-sm bep-cancel-btn" data-id="${esc(bm.id)}">${t('bm.edit.cancel')}</button>
      </div>`;

    container.appendChild(row);
    container.appendChild(panel);
  });

  _bindBmListeners(container, false);
}

function _bindBmListeners(container, isNew) {
  // Expand/collapse
  container.querySelectorAll('.bm-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`bm-panel-${btn.dataset.id}`);
      if (!panel) return;
      const open = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden', open);
      btn.textContent = open ? '▶' : '▼';
    });
  });

  // Password eye toggle
  container.querySelectorAll('.bep-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.closest('.ir').querySelector('.bep-pass');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });

  // Save & propagate (existing bookmark)
  container.querySelectorAll('.bep-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const panel = document.getElementById(`bm-panel-${btn.dataset.id}`);
      const updatedBm = {
        id:         btn.dataset.id,
        name:       panel.querySelector('.bep-name').value.trim(),
        host:       panel.querySelector('.bep-host').value.trim(),
        port:       parseInt(panel.querySelector('.bep-port').value) || 21,
        user:       panel.querySelector('.bep-user').value.trim(),
        password:   panel.querySelector('.bep-pass').value,
        remotePath: panel.querySelector('.bep-path').value.trim(),
        secure:     panel.querySelector('.bep-secure').checked
      };
      if (!updatedBm.name) { panel.querySelector('.bep-name').focus(); return; }
      const result = await api.saveFtpBookmark(updatedBm);
      const n = result && result.propagated !== undefined ? result.propagated : 0;
      const notify = panel.querySelector('.bm-notify');
      notify.textContent = t('bm.propagated', { n });
      notify.style.display = '';
      // Update row name hint inline
      const row = container.querySelector(`[data-bm-id="${updatedBm.id}"], .bm-row[data-bm-id="${btn.dataset.id}"]`);
      const nameEl = document.querySelector(`#bm-panel-${btn.dataset.id}`).previousElementSibling?.querySelector('.bm-name');
      if (nameEl) nameEl.textContent = updatedBm.name;
      const hostEl = document.querySelector(`#bm-panel-${btn.dataset.id}`).previousElementSibling?.querySelector('.bm-host-hint');
      if (hostEl) hostEl.textContent = updatedBm.host || '';
      setTimeout(() => { notify.style.display = 'none'; refreshSettingsFtpSection(); }, 2000);
    });
  });

  // Cancel edit
  container.querySelectorAll('.bep-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (isNew) {
        // Remove the temporary new row
        const panel = document.getElementById(`bm-panel-${btn.dataset.id}`);
        const row = panel?.previousElementSibling;
        panel?.remove(); row?.remove();
        const container2 = document.getElementById('ftp-bookmarks-list');
        if (container2 && !container2.querySelector('.bm-row')) refreshSettingsFtpSection();
      } else {
        const panel = document.getElementById(`bm-panel-${btn.dataset.id}`);
        if (panel) {
          panel.classList.add('hidden');
          const expandBtn = panel.previousElementSibling?.querySelector('.bm-expand-btn');
          if (expandBtn) expandBtn.textContent = '▶';
        }
      }
    });
  });

  // Delete
  container.querySelectorAll('.bm-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('confirm.del_bookmark'))) return;
      await api.deleteFtpBookmark(btn.dataset.id);
      refreshSettingsFtpSection();
    });
  });

  // Browse FTP path (bookmark panels)
  container.querySelectorAll('.bep-browse-path').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.bm-edit-panel');
      openFtpBrowser(
        () => ({
          host:     panel.querySelector('.bep-host').value.trim(),
          port:     parseInt(panel.querySelector('.bep-port').value) || 21,
          user:     panel.querySelector('.bep-user').value.trim(),
          password: panel.querySelector('.bep-pass').value,
          secure:   panel.querySelector('.bep-secure').checked
        }),
        (selectedPath) => { panel.querySelector('.bep-path').value = selectedPath; }
      );
    });
  });
}

// ── FTP Browser ────────────────────────────────────────────────────────────────

let _ftpBrowserGetCreds = null;
let _ftpBrowserSetPath  = null;
let _ftpBrowserCurrent  = '/';
let _ftpBrowserSelected = null;

async function openFtpBrowser(getCredsFn, setPathFn) {
  _ftpBrowserGetCreds = getCredsFn;
  _ftpBrowserSetPath  = setPathFn;
  _ftpBrowserCurrent  = '/';
  _ftpBrowserSelected = null;

  document.getElementById('ftp-browser-selected').textContent = '';
  document.getElementById('ftp-browser-select').disabled = true;
  document.getElementById('modal-ftp-browser').classList.remove('hidden');

  await _ftpBrowserLoad('/');
}

function closeFtpBrowser() {
  document.getElementById('modal-ftp-browser').classList.add('hidden');
  _ftpBrowserGetCreds = null;
  _ftpBrowserSetPath  = null;
  _ftpBrowserSelected = null;
}

async function _ftpBrowserLoad(dirPath) {
  const list   = document.getElementById('ftp-browser-list');
  const pathEl = document.getElementById('ftp-browser-path');
  const loading = document.getElementById('ftp-browser-loading');

  list.innerHTML = '';
  const loadingEl = document.createElement('div');
  loadingEl.className = 'ftp-browser-loading';
  loadingEl.textContent = t('ftp.browser.loading') || 'Connessione…';
  list.appendChild(loadingEl);
  pathEl.textContent = dirPath;
  document.getElementById('ftp-browser-up').disabled = (dirPath === '/');
  document.getElementById('ftp-browser-selected').textContent = '';
  document.getElementById('ftp-browser-select').disabled = true;
  _ftpBrowserSelected = null;

  const creds = _ftpBrowserGetCreds();
  const result = await api.ftpBrowse({ ...creds, path: dirPath });

  list.innerHTML = '';
  if (!result.ok) {
    const errEl = document.createElement('div');
    errEl.className = 'ftp-browser-error';
    errEl.textContent = '⚠ ' + result.error;
    list.appendChild(errEl);
    return;
  }

  _ftpBrowserCurrent = dirPath;
  pathEl.textContent = dirPath;
  document.getElementById('ftp-browser-up').disabled = (dirPath === '/');

  if (result.entries.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'ftp-browser-loading';
    emptyEl.textContent = t('ftp.browser.empty') || 'Cartella vuota';
    list.appendChild(emptyEl);
    // Still allow selecting current dir
    _ftpBrowserSelected = dirPath;
    document.getElementById('ftp-browser-selected').textContent = dirPath;
    document.getElementById('ftp-browser-select').disabled = false;
    return;
  }

  result.entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'ftp-entry' + (entry.isDir ? '' : ' ftp-entry-file');
    row.innerHTML = `<span class="ftp-entry-icon">${entry.isDir ? '📁' : '📄'}</span>
                     <span class="ftp-entry-name">${esc(entry.name)}</span>`;

    if (entry.isDir) {
      row.addEventListener('click', () => {
        // Single click = select this dir
        document.querySelectorAll('.ftp-entry').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        const fullPath = (_ftpBrowserCurrent === '/'
          ? '/' + entry.name
          : _ftpBrowserCurrent + '/' + entry.name);
        _ftpBrowserSelected = fullPath;
        document.getElementById('ftp-browser-selected').textContent = fullPath;
        document.getElementById('ftp-browser-select').disabled = false;
      });
      row.addEventListener('dblclick', () => {
        // Double click = navigate in
        const fullPath = (_ftpBrowserCurrent === '/'
          ? '/' + entry.name
          : _ftpBrowserCurrent + '/' + entry.name);
        _ftpBrowserLoad(fullPath);
      });
    }

    list.appendChild(row);
  });

  // Also allow selecting current directory itself
  _ftpBrowserSelected = dirPath;
  document.getElementById('ftp-browser-selected').textContent = dirPath;
  document.getElementById('ftp-browser-select').disabled = false;
}

// Load credentials into show form FTP fields (no remotePath)
function loadFtpBookmark(bm) {
  document.getElementById('f-ftp-bookmark-id').value = bm.id       || '';
  document.getElementById('f-ftp-host').value        = bm.host     || '';
  document.getElementById('f-ftp-port').value        = bm.port     || 21;
  document.getElementById('f-ftp-user').value        = bm.user     || '';
  document.getElementById('f-ftp-pass').value        = bm.password || '';
  document.getElementById('f-ftp-secure').checked    = !!bm.secure;
  // remotePath intentionally NOT loaded — each show keeps its own
  const sel = document.getElementById('f-ftp-bookmark-select');
  if (sel) sel.value = bm.id || '';
}

async function populateFtpBookmarkSelect(selectedId) {
  const bms = await api.getFtpBookmarks();
  const sel = document.getElementById('f-ftp-bookmark-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">–</option>` +
    bms.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  if (selectedId) sel.value = selectedId;
}

async function quickToggleEnabled() {
  const show = _shows.find(s => s.id === _activeShowId);
  if (!show) return;
  show.enabled = !show.enabled;
  renderEnabledBtn(show.enabled);
  await api.saveShow(show);
  renderSidebar(); renderDashboard();
}

// ── WAV list ──────────────────────────────────────────────────────────────────

function buildWavList(wavFiles) {
  const container = document.getElementById('wav-list');
  container.innerHTML = '';
  _wavCount = 0;
  const entries = (wavFiles && wavFiles.length) ? wavFiles : [''];
  entries.forEach(entry => {
    if (typeof entry === 'string') addWavRow(entry, true, '');
    else addWavRow(entry.path || '', entry.check !== false, entry.note || '');
  });
}

function addWavRow(value = '', check = true, note = '') {
  _wavCount++;
  const n = _wavCount;
  const container = document.getElementById('wav-list');
  const row = document.createElement('div');
  row.className = 'wav-row';
  row.dataset.n = n;
  const chkId = `wav-check-${n}-${Date.now()}`;
  row.innerHTML = `
    <span class="wav-n">${t('src.row.prefix')} ${String(n).padStart(2,'0')}</span>
    <input type="text" class="wav-input" placeholder="${t('src.row.ph')}" value="${esc(value)}">
    <button class="btn btn-muted btn-sm wav-browse" title="${t('src.row.browse')}">📁</button>
    <input type="text" class="wav-note" placeholder="${t('src.row.note.ph')}" value="${esc(note)}">
    <label class="wav-check-label" title="${t('src.row.check')}"><input type="checkbox" class="wav-check" id="${chkId}"${check ? ' checked' : ''}></label>
    <button class="btn btn-muted btn-sm wav-del" title="${t('src.row.remove')}">✕</button>`;
  row.querySelector('.wav-browse').addEventListener('click', async () => {
    const p = await api.browseFile([{ name: t('dlg.audio_files'), extensions: ['wav','mp3','aac','flac'] }, { name: t('dlg.all_files'), extensions: ['*'] }]);
    if (p) row.querySelector('.wav-input').value = p;
  });
  row.querySelector('.wav-del').addEventListener('click', () => removeWavRow(row.querySelector('.wav-del')));
  container.appendChild(row);
}

function removeWavRow(btn) {
  const row = btn.closest('.wav-row');
  const container = document.getElementById('wav-list');
  if (container.children.length <= 1) return;
  row.remove();
  let i = 1;
  container.querySelectorAll('.wav-row').forEach(r => {
    r.querySelector('.wav-n').textContent = `${t('src.row.prefix')} ${String(i).padStart(2,'0')}`;
    i++;
  });
  _wavCount = i - 1;
}

function collectWavFiles() {
  return Array.from(document.querySelectorAll('.wav-row'))
    .map(row => ({
      path:  row.querySelector('.wav-input').value.trim(),
      check: row.querySelector('.wav-check').checked,
      note:  row.querySelector('.wav-note').value.trim()
    }))
    .filter(e => e.path.length > 0);
}

// ── Schedule ──────────────────────────────────────────────────────────────────

function toggleDaysField(freq) {
  document.getElementById('field-days').style.display = freq === 'specific' ? '' : 'none';
}

function setDayChips(days) {
  document.querySelectorAll('.day-chip').forEach(chip => {
    const cb = chip.querySelector('input');
    const active = days.includes(chip.dataset.day);
    cb.checked = active;
    chip.classList.toggle('checked', active);
  });
}

function collectDays() {
  return Array.from(document.querySelectorAll('.day-chip input:checked')).map(cb => cb.value);
}

function updateScheduleRangeInfo(sch) {
  const el = document.getElementById('schedule-range-info');
  if (!el) return;
  const parts = [];
  if (sch.startDate) parts.push(t('sch.active_from', { date: sch.startDate }));
  if (sch.endDate)   parts.push(t('sch.expires',     { date: sch.endDate }));
  if (!sch.endDate)  parts.push(t('sch.no_expiry'));
  const today = new Date().toISOString().slice(0,10);
  const active = (!sch.startDate || sch.startDate <= today) && (!sch.endDate || sch.endDate >= today);
  el.style.color = active ? 'var(--green)' : 'var(--warn)';
  el.textContent = (active ? '● ' : '○ ') + parts.join(' · ');
}

async function refreshNextRun() {
  try {
    const show = collectShowData();
    const str  = show.mode === 'manual' ? `— (${t('sidebar.manual')})` : await api.nextRun(show);
    document.getElementById('next-run-display').textContent = str || '—';
  } catch(e) {}
}

// ── FTP ───────────────────────────────────────────────────────────────────────

function toggleFtpFields(enabled) {
  document.getElementById('ftp-fields').style.opacity = enabled ? '1' : '0.4';
  document.querySelectorAll('#ftp-fields input, #ftp-fields button').forEach(el => {
    el.disabled = !enabled;
  });
  // Keep bookmark load button always enabled even when FTP off (user can still browse)
  const bmBtn = document.getElementById('btn-load-ftp-bookmark');
  if (bmBtn) bmBtn.disabled = false;
}

// ── Log ───────────────────────────────────────────────────────────────────────

async function refreshLogOutput(id) {
  const lines = await api.getLog(id);
  const el = document.getElementById('log-output');
  el.textContent = lines || t('log.empty');
  el.scrollTop = el.scrollHeight;
}

function appendLogLine(line) {
  const el = document.getElementById('log-output');
  if (el.textContent === t('log.empty')) el.textContent = '';
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

// ── History / Registro ────────────────────────────────────────────────────────

async function refreshHistory(id) {
  const entries = await api.getHistory(id);
  const container = document.getElementById('history-list');

  if (!entries || entries.length === 0) {
    container.innerHTML = `<div class="h-empty">${t('hist.empty')}</div>`;
    return;
  }

  container.innerHTML = '';
  entries.forEach(entry => {
    const row  = document.createElement('div');
    row.className = 'history-row';
    const date = new Date(entry.date).toLocaleString(i18n.dateLocale(), {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const fileStr = entry.filename
      ? `<span class="h-file">${esc(entry.filename)}</span>`
      : (entry.error ? `<span class="h-file" style="color:var(--red)">${esc(entry.error)}</span>` : '');
    row.innerHTML = `
      <span class="h-date">${date}</span>
      ${badgeHtml(entry.result)}
      ${fileStr}`;
    container.appendChild(row);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
  document.getElementById('show-btn-row').style.display = (name === 'log' || name === 'registro') ? 'none' : '';

  // Load history when tab opened
  if (name === 'registro' && _activeShowId) refreshHistory(_activeShowId);
}

// ── Settings page ─────────────────────────────────────────────────────────────

function openSettings(section) {
  document.getElementById('s-base-wav').value      = _settings.baseWav     || '';
  document.getElementById('s-base-archive').value  = _settings.baseArchive || '';
  document.getElementById('s-ffmpeg').value         = _settings.ffmpegPath  || 'ffmpeg';
  document.getElementById('s-ftp-timeout').value    = _settings.ftpTimeout  || 30;
  document.getElementById('s-autostart').checked     = !!_settings.autostart;
  document.getElementById('s-start-hidden').checked  = !!_settings.startHidden;

  const em = _settings.email || {};
  const smtp = em.smtp || {};
  document.getElementById('s-email-enabled').checked    = !!em.enabled;
  document.getElementById('s-smtp-host').value           = smtp.host     || '';
  document.getElementById('s-smtp-port').value           = smtp.port     || 587;
  document.getElementById('s-smtp-user').value           = smtp.user     || '';
  document.getElementById('s-smtp-pass').value           = smtp.password || '';
  document.getElementById('s-smtp-from').value           = em.from       || '';
  document.getElementById('s-smtp-secure').checked       = !!smtp.secure;
  document.getElementById('s-smtp-selfsigned').checked   = !!smtp.allowSelfSigned;
  const recips = (em.recipients || '').split('\n').filter(Boolean);
  document.getElementById('s-email-recip-1').value = recips[0] || '';
  document.getElementById('s-email-recip-2').value = recips[1] || '';
  document.getElementById('s-email-recip-3').value = recips[2] || '';
  document.getElementById('s-email-on-error').checked    = em.onError !== false;
  document.getElementById('s-email-on-noupdate').checked = !!em.onNoUpdate;
  document.getElementById('email-test-result').textContent = '';
  document.getElementById('s-language').value      = _settings.language     || 'en';
  document.getElementById('s-close-to-tray').value = _settings.closeToTray  || 'auto';

  document.getElementById('page-settings').classList.remove('hidden');
  switchSettingsSection(section || 'general');
}

function closeSettings() {
  document.getElementById('page-settings').classList.add('hidden');
}

function switchSettingsSection(section) {
  document.querySelectorAll('.set-nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.section === section));
  document.querySelectorAll('.set-section').forEach(s =>
    s.classList.toggle('active', s.id === 'set-' + section));
  if (section === 'ftp') refreshSettingsFtpSection();
}

async function saveSettings() {
  _settings = {
    baseWav:     document.getElementById('s-base-wav').value.trim(),
    baseArchive: document.getElementById('s-base-archive').value.trim(),
    ffmpegPath:  document.getElementById('s-ffmpeg').value.trim() || 'ffmpeg',
    ftpTimeout:  parseInt(document.getElementById('s-ftp-timeout').value) || 30,
    autostart:   document.getElementById('s-autostart').checked,
    startHidden: document.getElementById('s-start-hidden').checked,
    theme:       _settings.theme || 'dark',
    language:    document.getElementById('s-language').value    || 'en',
    closeToTray: document.getElementById('s-close-to-tray').value || 'auto',
    email: {
      enabled:    document.getElementById('s-email-enabled').checked,
      smtp: {
        host:     document.getElementById('s-smtp-host').value.trim(),
        port:     parseInt(document.getElementById('s-smtp-port').value) || 587,
        user:     document.getElementById('s-smtp-user').value.trim(),
        password: document.getElementById('s-smtp-pass').value,
        secure:   document.getElementById('s-smtp-secure').checked,
        allowSelfSigned: document.getElementById('s-smtp-selfsigned').checked
      },
      from:         document.getElementById('s-smtp-from').value.trim(),
      recipients:   [
        document.getElementById('s-email-recip-1').value.trim(),
        document.getElementById('s-email-recip-2').value.trim(),
        document.getElementById('s-email-recip-3').value.trim()
      ].filter(Boolean).join('\n'),
      onError:      document.getElementById('s-email-on-error').checked,
      onNoUpdate:   document.getElementById('s-email-on-noupdate').checked,
      noUpdateStreakThreshold: 3
    }
  };
  await api.saveSettings(_settings);
  applyTheme(_settings.theme);
  i18n.load(_settings.language || 'en');
  i18n.applyI18n();
  checkFfmpegWarning();
  refreshAboutVersion();
  const saved = document.getElementById('settings-saved');
  saved.style.display = '';
  setTimeout(() => { saved.style.display = 'none'; }, 2000);
}

// ── About / Help ──────────────────────────────────────────────────────────────

// FFmpeg is external: warn on the dashboard when it cannot be started
async function checkFfmpegWarning() {
  const res = await api.checkFfmpeg();
  const el  = document.getElementById('ffmpeg-warning');
  document.getElementById('ffmpeg-warning-text').textContent = t('ffmpeg.missing', { path: res.path });
  el.classList.toggle('hidden', res.ok);
}

async function refreshAboutVersion() {
  const v = await api.getAppVersion();
  document.getElementById('about-version').textContent = t('about.version', { v });
}

function openAbout()  { document.getElementById('modal-about').classList.remove('hidden'); }
function closeAbout() { document.getElementById('modal-about').classList.add('hidden'); }
function openHelp()   { document.getElementById('modal-help').classList.remove('hidden'); }
function closeHelp()  { document.getElementById('modal-help').classList.add('hidden'); }

// ── Config export / import ────────────────────────────────────────────────────

async function exportConfig() {
  const status = document.getElementById('backup-status');
  status.style.color = 'var(--muted)';
  status.textContent = t('cfg.exporting');
  const ok = await api.exportConfig();
  if (ok) {
    status.style.color = 'var(--green)';
    status.textContent = t('cfg.exported');
  } else {
    status.textContent = '';
  }
  setTimeout(() => { status.textContent = ''; }, 3000);
}

async function importConfig() {
  const status = document.getElementById('backup-status');
  const data = await api.importConfig();
  if (!data) return;
  if (data.error) {
    status.style.color = 'var(--red)';
    status.textContent = t('cfg.error', { msg: data.error });
    return;
  }

  const showCount = (data.shows || []).length;
  const replace = confirm(t('confirm.import', { shows: showCount, bm: (data.ftpBookmarks||[]).length }));

  if (replace) {
    for (const show of (data.shows || []))        await api.saveShow(show);
    for (const bm   of (data.ftpBookmarks || []))  await api.saveFtpBookmark(bm);
    if (data.settings) await api.saveSettings(data.settings);
    _settings = await api.getSettings();
    _shows    = await api.getShows();
  } else {
    const existingIds = new Set(_shows.map(s => s.id));
    const toAdd = (data.shows || []).filter(s => !existingIds.has(s.id));
    for (const show of toAdd) {
      await api.saveShow(show);
      _shows.push(show);
    }
    status.style.color = 'var(--green)';
    status.textContent = t('cfg.added', { n: toAdd.length });
    setTimeout(() => { status.textContent = ''; }, 3000);
  }

  renderSidebar();
  renderDashboard();
  if (replace) {
    status.style.color = 'var(--green)';
    status.textContent = t('cfg.imported', { n: showCount });
    setTimeout(() => { status.textContent = ''; }, 3000);
  }
}

// ── Browse helpers ────────────────────────────────────────────────────────────

function bindBrowseFolder(btnId, inputId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const p = await api.browseFolder();
    if (p) document.getElementById(inputId).value = p;
  });
}
function bindBrowseFile(btnId, inputId, filters) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const p = await api.browseFile(typeof filters === 'function' ? filters() : filters);
    if (p) document.getElementById(inputId).value = p;
  });
}

bindBrowseFolder('btn-browse-working',  'f-working');
bindBrowseFile(  'btn-browse-verifica', 'f-verifica', () => [{ name: t('dlg.text_files'), extensions: ['txt'] }, { name: t('dlg.all_files'), extensions: ['*'] }]);
bindBrowseFolder('btn-browse-wav-base', 'f-wav-base');
bindBrowseFolder('btn-browse-archive',  'f-archive');
bindBrowseFolder('btn-browse-output',   'f-output-folder');
bindBrowseFolder('btn-browse-s-wav',    's-base-wav');
bindBrowseFolder('btn-browse-s-archive','s-base-archive');
bindBrowseFile(  'btn-browse-ffmpeg',   's-ffmpeg', () => [{ name: t('dlg.executables'), extensions: ['exe'] }, { name: t('dlg.all_files'), extensions: ['*'] }]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function freqLabel(freq) {
  const map = { daily:'sch.freq.daily', weekdays:'sch.freq.weekdays', weekend:'sch.freq.weekend', specific:'sch.freq.specific' };
  return map[freq] ? t(map[freq]) : (freq || '—');
}

function statusLabel(status) {
  const map = { ok:'status.ok', error:'status.error', running:'status.running', idle:'status.idle', 'no-update':'status.no_update' };
  return map[status] ? t(map[status]) : (status || '');
}

function badgeHtml(status) {
  return `<span class="badge badge-${status}">${statusLabel(status)}</span>`;
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('nav-dashboard').addEventListener('click', () => {
  _activeShowId = null;
  renderSidebar(); renderDashboard(); showView('dashboard');
});

document.getElementById('btn-new-show').addEventListener('click', newShow);

document.getElementById('btn-back-dashboard').addEventListener('click', () => {
  if (_isNew) _shows = _shows.filter(s => s.id !== _activeShowId);
  _activeShowId = null; _isNew = false;
  renderSidebar(); renderDashboard(); showView('dashboard');
});

document.getElementById('btn-toggle-enabled').addEventListener('click', quickToggleEnabled);
document.getElementById('btn-run-now').addEventListener('click',   () => { if (_activeShowId) api.runShow(_activeShowId, false, false); });
document.getElementById('btn-force-run').addEventListener('click', () => { if (_activeShowId) api.runShow(_activeShowId, true,  false); });
document.getElementById('btn-dry-run').addEventListener('click',   () => { if (_activeShowId) api.runShow(_activeShowId, false, true);  });

document.getElementById('f-name').addEventListener('input', function() {
  document.getElementById('show-title').textContent = this.value || t('show.new');
});

document.getElementById('f-slug').addEventListener('input', function() {
  updateFilenamePreview(this.value.trim());
});

document.getElementById('f-output-format').addEventListener('change', function() {
  toggleBitrateField(this.value);
  updateFilenamePreview(document.getElementById('f-slug').value.trim());
});

document.getElementById('btn-auto-slug').addEventListener('click', () => {
  const slug = slugify(document.getElementById('f-name').value);
  document.getElementById('f-slug').value = slug;
  updateFilenamePreview(slug);
});

document.querySelector('.adv-section').addEventListener('toggle', function() {
  document.getElementById('adv-arrow').textContent = this.open ? '▼' : '▶';
});

document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => { setMode(card.dataset.mode); refreshNextRun(); });
});

document.getElementById('btn-reset-wav-base').addEventListener('click', () => {
  document.getElementById('f-wav-base').value = _settings.baseWav || '';
});

document.getElementById('btn-reset-archive').addEventListener('click', () => {
  const slug  = document.getElementById('f-slug').value.trim() || slugify(document.getElementById('f-name').value);
  const slugU = slug.replace(/-/g, '_');
  document.getElementById('f-archive').value = slugU || '';
  updateArchivePreview();
});

document.getElementById('f-archive-enabled').addEventListener('change', function() {
  toggleArchiveFields(this.checked);
});

document.getElementById('f-archive').addEventListener('input', updateArchivePreview);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.getElementById('f-freq').addEventListener('change', function() {
  toggleDaysField(this.value); refreshNextRun();
});
document.getElementById('f-time').addEventListener('change', refreshNextRun);
document.getElementById('f-schedule-start').addEventListener('change', function() {
  updateScheduleRangeInfo({ startDate: this.value, endDate: document.getElementById('f-schedule-end').value });
});
document.getElementById('f-schedule-end').addEventListener('change', function() {
  updateScheduleRangeInfo({ startDate: document.getElementById('f-schedule-start').value, endDate: this.value });
});

document.querySelectorAll('.day-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    setTimeout(() => {
      chip.classList.toggle('checked', chip.querySelector('input').checked);
      refreshNextRun();
    }, 0);
  });
});

document.getElementById('f-ftp-enabled').addEventListener('change', function() {
  toggleFtpFields(this.checked);
});

document.getElementById('btn-test-ftp').addEventListener('click', async () => {
  const cfg = {
    host:     document.getElementById('f-ftp-host').value.trim(),
    port:     parseInt(document.getElementById('f-ftp-port').value) || 21,
    user:     document.getElementById('f-ftp-user').value.trim(),
    password: document.getElementById('f-ftp-pass').value,
    secure:   document.getElementById('f-ftp-secure').checked
  };
  const el = document.getElementById('ftp-test-result');
  el.style.color = 'var(--muted)';
  el.textContent = t('ftp.testing');
  const res = await api.testFtp(cfg);
  el.style.color = res.success ? 'var(--green)' : 'var(--red)';
  el.textContent = res.message;
});

document.getElementById('btn-add-wav').addEventListener('click', () => addWavRow(''));

document.getElementById('btn-edit-show').addEventListener('click', () => setEditMode(true));
document.getElementById('btn-save-show').addEventListener('click', saveShow);
document.getElementById('btn-cancel-show').addEventListener('click', () => {
  if (_isNew) {
    _shows = _shows.filter(s => s.id !== _activeShowId);
    _activeShowId = null; _isNew = false;
    renderSidebar(); renderDashboard(); showView('dashboard');
  } else {
    // Restore original data and go back to view mode
    const show = _shows.find(s => s.id === _activeShowId);
    if (show) fillShowForm(show);
    setEditMode(false);
  }
});
document.getElementById('btn-delete-show').addEventListener('click', deleteShow);
document.getElementById('btn-duplicate-show').addEventListener('click', duplicateShow);

// btn-load-ftp-bookmark listener now registered in the Settings page block above

document.getElementById('btn-run-now-log').addEventListener('click', () => { if (_activeShowId) api.runShow(_activeShowId, false, false); });
document.getElementById('btn-clear-log').addEventListener('click', async () => {
  if (!_activeShowId) return;
  await api.clearLog(_activeShowId);
  document.getElementById('log-output').textContent = t('log.empty');
});

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  if (!_activeShowId) return;
  if (!confirm(t('confirm.clear_history'))) return;
  await api.clearHistory(_activeShowId);
  document.getElementById('history-list').innerHTML = `<div class="h-empty">${t('hist.empty')}</div>`;
});

// Sort controls
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (_sortField === btn.dataset.sort) {
      _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _sortField = btn.dataset.sort;
      _sortDir   = 'asc';
    }
    applySortUI();
    renderSidebar();
    renderDashboard();
  });
});

document.getElementById('btn-sort-dir').addEventListener('click', () => {
  _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
  applySortUI();
  renderSidebar();
  renderDashboard();
});

// Filter chips
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    if (f === 'all') {
      _filters.clear();
    } else {
      if (_filters.has(f)) _filters.delete(f);
      else                 _filters.add(f);
    }
    renderDashboard(); // includes applyFilterUI
  });
});

// Backup
document.getElementById('btn-export-config').addEventListener('click', exportConfig);
document.getElementById('btn-import-config').addEventListener('click', importConfig);

// Sidebar toggle
document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
  document.getElementById('app').classList.toggle('sidebar-hidden');
});

// Search
document.getElementById('dash-search').addEventListener('input', function() {
  _searchQuery = this.value.trim();
  renderDashboard();
});

// Log: export + open folder
document.getElementById('btn-export-log').addEventListener('click', async () => {
  if (!_activeShowId) return;
  await api.exportLog(_activeShowId);
});
document.getElementById('btn-open-log-folder').addEventListener('click', async () => {
  await api.openLogFolder();
});

// FFmpeg test
document.getElementById('btn-test-ffmpeg').addEventListener('click', async () => {
  const el = document.getElementById('ffmpeg-test-result');
  el.style.color = 'var(--muted)';
  el.textContent = '…';
  const res = await api.checkFfmpeg(document.getElementById('s-ffmpeg').value.trim() || 'ffmpeg');
  el.style.color = res.ok ? 'var(--green)' : 'var(--red)';
  el.textContent = res.ok
    ? t('set.ffmpeg.ok', { v: res.version })
    : t('set.ffmpeg.fail', { error: res.error === 'not-found' ? t('set.ffmpeg.notfound') : res.error });
});
document.getElementById('btn-ffmpeg-settings').addEventListener('click', () => openSettings('general'));

// Email test
document.getElementById('btn-test-email').addEventListener('click', async () => {
  const el = document.getElementById('email-test-result');
  el.style.color = 'var(--muted)';
  el.textContent = t('set.email.testing');
  const cfg = {
    enabled: true,
    smtp: {
      host:     document.getElementById('s-smtp-host').value.trim(),
      port:     parseInt(document.getElementById('s-smtp-port').value) || 587,
      user:     document.getElementById('s-smtp-user').value.trim(),
      password: document.getElementById('s-smtp-pass').value,
      secure:   document.getElementById('s-smtp-secure').checked,
      allowSelfSigned: document.getElementById('s-smtp-selfsigned').checked
    }
  };
  const res = await api.testEmail(cfg);
  el.style.color = res.success ? 'var(--green)' : 'var(--red)';
  el.textContent = res.message;
});

// Theme toggle
document.getElementById('btn-theme-toggle').addEventListener('click', async () => {
  const newTheme = (_settings.theme === 'light') ? 'dark' : 'light';
  _settings.theme = newTheme;
  applyTheme(newTheme);
  await api.saveSettings(_settings);
});

// About / Help
document.getElementById('btn-about').addEventListener('click', openAbout);
document.getElementById('btn-about-close').addEventListener('click', closeAbout);
document.getElementById('modal-about').addEventListener('click', function(e) { if (e.target === this) closeAbout(); });
document.getElementById('btn-help').addEventListener('click', openHelp);
document.getElementById('btn-help-close').addEventListener('click', closeHelp);
document.getElementById('modal-help').addEventListener('click', function(e) { if (e.target === this) closeHelp(); });

// FTP Browser modal
document.getElementById('ftp-browser-close').addEventListener('click', closeFtpBrowser);
document.getElementById('ftp-browser-cancel').addEventListener('click', closeFtpBrowser);
document.getElementById('modal-ftp-browser').addEventListener('click', function(e) { if (e.target === this) closeFtpBrowser(); });
document.getElementById('ftp-browser-up').addEventListener('click', () => {
  if (_ftpBrowserCurrent === '/') return;
  const parent = _ftpBrowserCurrent.replace(/\/[^/]+$/, '') || '/';
  _ftpBrowserLoad(parent);
});
document.getElementById('ftp-browser-select').addEventListener('click', () => {
  if (_ftpBrowserSelected && _ftpBrowserSetPath) {
    _ftpBrowserSetPath(_ftpBrowserSelected);
  }
  closeFtpBrowser();
});

// Browse FTP path from show form
document.getElementById('btn-browse-ftp-path').addEventListener('click', async () => {
  // Collect credentials from show form fields
  const bookmarkId = document.getElementById('f-ftp-bookmark-id')?.value;
  let creds = {
    host:     document.getElementById('f-ftp-host')?.value.trim()     || '',
    port:     parseInt(document.getElementById('f-ftp-port')?.value)  || 21,
    user:     document.getElementById('f-ftp-user')?.value.trim()     || '',
    password: document.getElementById('f-ftp-pass')?.value            || '',
    secure:   document.getElementById('f-ftp-secure')?.checked        || false
  };
  // If credentials blank but bookmark loaded, fetch from bookmark
  if (!creds.host && bookmarkId) {
    const bms = await api.getFtpBookmarks();
    const bm = bms.find(b => b.id === bookmarkId);
    if (bm) { creds = { host: bm.host, port: bm.port || 21, user: bm.user, password: bm.password, secure: !!bm.secure }; }
  }
  if (!creds.host) { alert(t('ftp.browser.no_host') || 'Inserire host FTP prima di sfogliare.'); return; }
  openFtpBrowser(
    () => creds,
    (p) => { document.getElementById('f-ftp-path').value = p; }
  );
});

// Settings page
document.getElementById('btn-open-settings').addEventListener('click', () => openSettings());
document.getElementById('btn-settings-back').addEventListener('click', closeSettings);
document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
document.querySelectorAll('.set-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSettingsSection(btn.dataset.section));
});

// FTP bookmark load (from show form select)
document.getElementById('btn-load-ftp-bookmark').addEventListener('click', async () => {
  const sel = document.getElementById('f-ftp-bookmark-select');
  const id = sel ? sel.value : '';
  if (!id) return;
  const bms = await api.getFtpBookmarks();
  const bm = bms.find(b => b.id === id);
  if (bm) loadFtpBookmark(bm);
});

// Add new FTP bookmark — inserts inline blank row into list
document.getElementById('btn-add-ftp-bookmark').addEventListener('click', async () => {
  const container = document.getElementById('ftp-bookmarks-list');
  if (!container) return;
  // Don't add if a new-unsaved row already exists
  if (container.querySelector('.bm-row-new')) return;

  const tempId = '__new__' + Date.now();

  const row = document.createElement('div');
  row.className = 'bm-row bm-row-compact bm-row-new';
  row.dataset.bmId = tempId;
  row.innerHTML = `
    <button class="btn-icon bm-expand-btn" data-id="${tempId}" disabled>▼</button>
    <span class="bm-name" style="color:var(--muted);font-style:italic">${t('bm.new_name')}</span>
    <span class="bm-host-hint"></span>`;

  const panel = document.createElement('div');
  panel.className = 'bm-edit-panel';   // visible immediately
  panel.id = `bm-panel-${tempId}`;
  panel.innerHTML = _bmEditPanelHtml({ name:'', host:'', port:21, user:'', password:'', remotePath:'', secure:false }) + `
    <div class="bm-edit-actions">
      <button class="btn btn-primary btn-sm bep-save-new-btn" data-id="${tempId}">${t('bm.save.new')}</button>
      <button class="btn btn-muted   btn-sm bep-cancel-btn"   data-id="${tempId}">${t('bm.edit.cancel')}</button>
    </div>`;

  // Remove empty placeholder if present
  const empty = container.querySelector('.h-empty');
  if (empty) empty.remove();

  container.appendChild(row);
  container.appendChild(panel);

  // Bind eye toggle for new panel
  panel.querySelectorAll('.bep-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.closest('.ir').querySelector('.bep-pass');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });

  // Save new
  panel.querySelector('.bep-save-new-btn').addEventListener('click', async () => {
    const newBm = {
      id:         await api.newId(),
      name:       panel.querySelector('.bep-name').value.trim(),
      host:       panel.querySelector('.bep-host').value.trim(),
      port:       parseInt(panel.querySelector('.bep-port').value) || 21,
      user:       panel.querySelector('.bep-user').value.trim(),
      password:   panel.querySelector('.bep-pass').value,
      remotePath: panel.querySelector('.bep-path').value.trim(),
      secure:     panel.querySelector('.bep-secure').checked
    };
    if (!newBm.name) { panel.querySelector('.bep-name').focus(); return; }
    await api.saveFtpBookmark(newBm);
    refreshSettingsFtpSection();
  });

  // Cancel new — remove the temporary row+panel
  panel.querySelector('.bep-cancel-btn').addEventListener('click', () => {
    row.remove(); panel.remove();
    if (!container.querySelector('.bm-row')) refreshSettingsFtpSection();
  });

  panel.querySelector('.bep-name').focus();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
