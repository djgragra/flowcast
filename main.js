'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification, safeStorage } = require('electron');
const path           = require('path');
const fs             = require('fs');
// Development only: `npm run manual` renders the PDF manual with screenshots of the app.
// `npm run screenshots` renders website PNGs the same way. scripts/ is not packaged,
// so neither ever runs in the installed app.
if (process.env.FLOWCAST_MANUAL_OUT) require('./scripts/manual/build-manual');
if (process.env.FLOWCAST_SHOTS_OUT)  require('./scripts/screenshots/build-screenshots');
const { v4: uuidv4 } = require ? (() => { try { return require('uuid'); } catch(e){ return {v4: ()=> Date.now().toString(36)+Math.random().toString(36).slice(2)}; } })() : {v4: ()=> Date.now().toString(36)+Math.random().toString(36).slice(2)};
const store          = require('./src/store');
const scheduler      = require('./src/scheduler');
const processor      = require('./src/processor');
const ftpClient      = require('./src/ftp-client');
const notify         = require('./src/notify');
const backup         = require('./src/backup');
const categories     = require('./src/categories');
const { createSecretBox, maskSecrets } = require('./src/secrets');
const { createAlertState } = require('./src/alert-state');
const i18n           = require('./src/i18n');
const { resolveFfmpeg } = require('./src/ffmpeg-path');
const updater        = require('./src/updater');
const stats          = require('./src/stats');
const { execFile }   = require('child_process');

// ── Main-process i18n ─────────────────────────────────────────────────────────

function _loadMainLocale() {
  try { i18n.load(store.getSettings().language); } catch(_) { i18n.load('en'); }
}

const mt = i18n.t;

// ── Close behavior ────────────────────────────────────────────────────────────

function hasActiveScheduledShows() {
  try {
    return store.getShows().some(s =>
      s.enabled !== false && s.mode !== 'manual' && s.schedule && s.schedule.time
    );
  } catch(_) { return false; }
}

function resolveCloseBehavior() {
  const s = store.getSettings();
  const pref = s.closeToTray || 'auto';
  if (pref === 'always') return 'tray';
  if (pref === 'never')  return 'quit';
  // auto
  return hasActiveScheduledShows() ? 'tray' : 'quit';
}

// Simple UUID fallback
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Single instance ───────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// ── Global error handlers ─────────────────────────────────────────────────────
process.on('uncaughtException',  (e) => {
  console.error('[FATAL]', e.message);
  try { store.appendLog('_system', `FATAL uncaughtException: ${e.message}\n${e.stack}`); } catch(_) {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED]', reason);
  try { store.appendLog('_system', `UNHANDLED rejection: ${reason}`); } catch(_) {}
});

// --hidden arg: passed by Windows autostart when startHidden is enabled
const START_HIDDEN = process.argv.includes('--hidden') ||
  (process.platform === 'darwin' && (() => { try { return app.getLoginItemSettings().wasOpenedAsHidden; } catch(_) { return false; } })());

let mainWindow = null;
let tray       = null;

// Alerts (email, Telegram, new-version notice) and what they remember across restarts.
// Created once the store is loaded, in app.whenReady.
let alertState = null;
let alerter    = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    },
    title: 'FlowCast',
    icon: loadAppIcon(),
    show: false,
    backgroundColor: '#0f1117'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => { if (!START_HIDDEN) mainWindow.show(); });

  // External links (About: website, mailto) open in the system browser/mail client
  const openExternal = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL()) { e.preventDefault(); openExternal(url); }
  });

  // Right-click context menu (cut / copy / paste / select-all)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable || params.selectionText) {
      if (params.isEditable) {
        items.push({ role: 'cut',   label: mt('ctx.cut'),        enabled: params.editFlags.canCut   });
      }
      items.push(  { role: 'copy',  label: mt('ctx.copy'),       enabled: params.editFlags.canCopy  });
      if (params.isEditable) {
        items.push({ role: 'paste', label: mt('ctx.paste'),      enabled: params.editFlags.canPaste });
        items.push({ type: 'separator' });
        items.push({ role: 'selectAll', label: mt('ctx.select_all') });
      }
      if (items.length) Menu.buildFromTemplate(items).popup();
    }
  });

  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    const behavior = resolveCloseBehavior();
    if (behavior === 'tray') {
      e.preventDefault();
      mainWindow.hide();
      dialog.showMessageBox({
        type: 'info',
        title: 'FlowCast',
        message: mt('tray.minimized'),
        detail: mt('tray.minimized_detail'),
        buttons: ['OK'],
        icon: makeTrayIcon()
      }).catch(() => {});
    } else {
      app.isQuitting = true;
      // will close naturally
    }
  });
}

// ── App icon ─────────────────────────────────────────────────────────────────

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_DIR  = path.join(__dirname, 'assets', 'tray');

function loadAppIcon() {
  if (fs.existsSync(ICON_PATH)) {
    return nativeImage.createFromPath(ICON_PATH);
  }
  // Fallback: programmatic blue circle
  const size = 256;
  const buf  = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2 - 0.5, cy = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) < size / 2 - 2) {
        const i = (y * size + x) * 4;
        buf[i] = 79; buf[i+1] = 79; buf[i+2] = 220; buf[i+3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// macOS: monochrome template image (adapts to light/dark menu bar); elsewhere the colour symbol.
// nativeImage picks the @2x file automatically on high-DPI screens.
function makeTrayIcon() {
  const file = path.join(TRAY_DIR, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  if (fs.existsSync(file)) {
    const img = nativeImage.createFromPath(file);
    if (process.platform === 'darwin') img.setTemplateImage(true);
    return img;
  }
  return loadAppIcon().resize({ width: 16, height: 16 });
}

// Start at login. Windows: "--hidden" starts in the tray; macOS: open hidden. Not available on Linux.
function applyLoginItem(s) {
  if (process.platform === 'linux') return;
  try {
    app.setLoginItemSettings(process.platform === 'darwin'
      ? { openAtLogin: !!s.autostart, openAsHidden: !!(s.autostart && s.startHidden) }
      : { openAtLogin: !!s.autostart, args: (s.autostart && s.startHidden) ? ['--hidden'] : [] });
  } catch(_) {}
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  const icon = makeTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('FlowCast');
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const items = [
    { label: mt('tray.open'), click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' }
  ];

  // Quick-run entries: enabled, non-manual shows (max 12)
  try {
    const shows = store.getShows()
      .filter(s => s.enabled !== false && s.mode !== 'manual')
      .slice(0, 12);
    if (shows.length > 0) {
      items.push({ label: mt('tray.run_header'), enabled: false });
      shows.forEach(show => {
        const status = _runStatus.get(show.id) || 'idle';
        items.push({
          label:   `   ${show.name}`,
          enabled: status !== 'running',
          click:   () => { runShow(show.id, false); }
        });
      });
      items.push({ type: 'separator' });
    }
  } catch(_) {}

  items.push({ label: mt('tray.quit'), click: () => { app.isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ── Run logic ─────────────────────────────────────────────────────────────────

const _runStatus = new Map(); // showId → 'idle'|'running'|'error'|'ok'|'no-update'

function notifyStatus(showId, status) {
  _runStatus.set(showId, status);
  if (mainWindow) mainWindow.webContents.send('show-status', { id: showId, status });
}

function logLine(showId, line) {
  const msg = store.appendLog(showId, line);
  if (mainWindow) mainWindow.webContents.send('log-line', { id: showId, line: msg });
}

async function runShow(showId, force = false, dryRun = false) {
  const show = store.getShow(showId);
  if (!show) return;
  if (_runStatus.get(showId) === 'running') return;

  notifyStatus(showId, 'running');
  updateTrayMenu();
  if (mainWindow) mainWindow.webContents.send('show-triggered', { id: showId });

  // Watchdog: if the run gets stuck (e.g. FTP hangs mid-transfer), reset status
  // after 30 min so future cron ticks are not permanently blocked.
  const watchdog = setTimeout(() => {
    if (_runStatus.get(showId) === 'running') {
      logLine(showId, '[watchdog] Run exceeded 30 min — forcing status reset');
      notifyStatus(showId, 'error');
      updateTrayMenu();
    }
  }, 30 * 60 * 1000);

  const logFn      = line => logLine(showId, line);
  const progressFn = s    => notifyStatus(showId, s === 'start' ? 'running' : s);
  const settings   = store.getSettings();
  const startedAt  = Date.now();

  try {
    const result = await processor.processShow(show, logFn, progressFn, force, dryRun);

    let ftpResult = 'skipped';
    if (result.action === 'produced' && !dryRun && show.ftp && show.ftp.enabled && show.ftp.host) {
      logFn(mt('log.ftp_start'));
      const ftpTimeoutMs = ((settings.ftpTimeout || 30) * 1000);
      const ftpR = await ftpClient.upload(show.ftp, result.file, logFn, ftpTimeoutMs);
      ftpResult = ftpR.success ? 'ok' : 'error';
      if (!ftpR.success) logFn(mt('log.ftp_failed', { error: ftpR.error }));
    } else if (dryRun && show.ftp && show.ftp.enabled) {
      logFn(mt('log.dry_ftp'));
    }

    const finalStatus = result.action === 'no-update' ? 'no-update' : 'ok';
    notifyStatus(showId, finalStatus);

    const lastDetails = (result.action === 'produced' && !dryRun) ? {
      ftp:     ftpResult,
      archive: result.archiveResult || 'skipped',
      local:   result.localResult   || 'skipped'
    } : null;

    const now = new Date().toISOString();
    const updated = { ...show, lastRun: now, lastResult: finalStatus, lastDetails };
    if (!dryRun) {
      store.saveShow(updated);
      const durationMs = Date.now() - startedAt;
      let bytes = 0;
      try { if (result.file) bytes = fs.statSync(result.file).size; } catch(_) {}
      store.appendHistory(showId, {
        date: now, result: finalStatus,
        filename: result.filename || null,
        details: lastDetails,
        durationMs: result.action === 'produced' ? durationMs : undefined,
        bytes: bytes || undefined
      });
      // A production whose upload, copy or archive failed counts as an error in the statistics
      const statResult = (lastDetails && Object.values(lastDetails).includes('error')) ? 'error' : finalStatus;
      stats.add(showId, new Date(now), statResult, bytes, result.action === 'produced' ? durationMs : 0);
    }
    if (mainWindow) mainWindow.webContents.send('show-updated', { id: showId, lastRun: now, lastResult: finalStatus, lastDetails });

    tray && tray.setToolTip(`FlowCast — ${show.name}: ${finalStatus}`);
    updateTrayMenu();

    // Windows notification
    if (result.action === 'produced' && Notification.isSupported()) {
      const hasOpError = lastDetails && Object.values(lastDetails).includes('error');
      new Notification({
        title: `FlowCast — ${show.name}${dryRun ? ' [DRY RUN]' : ''}`,
        body: dryRun
          ? mt('notif.dryrun')
          : hasOpError
            ? mt('notif.partial_err')
            : mt('notif.ok'),
        icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined
      }).show();
    }

    // Email and Telegram alerts
    if (!dryRun) {
      if (result.action === 'produced' && lastDetails) {
        const hasOpError = Object.values(lastDetails).includes('error');
        if (hasOpError) {
          sendAlerts(show, 'error', { ops: lastDetails });
        }
      }
      // counts the runs in a row with the source not updated (kept across restarts) and alerts at the threshold
      alerter.noUpdateRun(show, result.action === 'no-update');
    }

  } catch(e) {
    logFn(mt('log.error', { message: e.message }));
    notifyStatus(showId, 'error');
    updateTrayMenu();
    const now = new Date().toISOString();
    if (!dryRun) {
      const updated = { ...show, lastRun: now, lastResult: 'error', lastDetails: null };
      store.saveShow(updated);
      store.appendHistory(showId, { date: now, result: 'error', error: e.message });
      stats.add(showId, new Date(now), 'error', 0, 0);
    }
    if (mainWindow) mainWindow.webContents.send('show-updated', { id: showId, lastRun: now, lastResult: 'error', lastDetails: null });

    // Windows notification
    if (Notification.isSupported()) {
      new Notification({
        title: mt('notif.err_title', { name: show.name }),
        body: e.message,
        icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined
      }).show();
    }

    // Email and Telegram alert on critical error
    if (!dryRun) {
      alerter.noUpdateRun(show, false);
      sendAlerts(show, 'error', { message: e.message });
    }
  } finally {
    clearTimeout(watchdog);
  }
}

// Email and Telegram alerts (each channel has its own on/off settings; each is tried again after 10 s and 60 s)
function sendAlerts(show, type, details) {
  alerter.alertShow(show, type, details)
    .catch(e => store.appendLog('_system', `Alert failed: ${maskSecrets(e.message, secretsInUse())}`));
}

// Every password and token in use: masked in anything that reaches a log or a message
function secretsInUse() {
  const s = store.getSettings();
  const out = [s.email && s.email.smtp && s.email.smtp.password, s.telegram && s.telegram.token];
  store.getShows().forEach(sh => out.push(sh.ftp && sh.ftp.password));
  store.getFtpBookmarks().forEach(b => out.push(b.password));
  return out.filter(Boolean);
}

function desktopNotice(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined }).show();
  }
}

// ── Schedule date range check ─────────────────────────────────────────────────

function isWithinScheduleRange(show) {
  if (!show.schedule) return true;
  const now = new Date();
  if (show.schedule.startDate) {
    const start = new Date(show.schedule.startDate + 'T00:00:00');
    if (now < start) return false;
  }
  if (show.schedule.endDate) {
    const end = new Date(show.schedule.endDate + 'T23:59:59');
    if (now > end) return false;
  }
  return true;
}

function scheduledRun(id) {
  const show = store.getShow(id);
  if (show && isWithinScheduleRange(show)) runShow(id);
}

// ── Scheduler setup ───────────────────────────────────────────────────────────

function setupSchedulers() {
  store.getShows().forEach(show => {
    scheduler.scheduleShow(show, scheduledRun);
  });
}

// ── Catch-up: run shows missed while app was not running ──────────────────────

function isTodayScheduled(show) {
  const sch = show.schedule;
  if (!sch || !sch.time) return false;
  const dayMap = { MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6, SUN:0 };
  const dow = new Date().getDay();
  if (sch.freq === 'daily')    return true;
  if (sch.freq === 'weekdays') return dow >= 1 && dow <= 5;
  if (sch.freq === 'weekend')  return dow === 0 || dow === 6;
  if (sch.freq === 'specific') return (sch.days || []).some(d => dayMap[d] === dow);
  return false;
}

function ranToday(show) {
  if (!show.lastRun) return false;
  const last = new Date(show.lastRun);
  const now  = new Date();
  return last.getFullYear() === now.getFullYear() &&
         last.getMonth()    === now.getMonth()    &&
         last.getDate()     === now.getDate();
}

function scheduledTimePassed(show) {
  const sch = show.schedule;
  if (!sch || !sch.time) return false;
  const [hh, mm] = sch.time.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(hh, mm, 0, 0);
  return new Date() > scheduled;
}

function checkMissedRuns() {
  const shows = store.getShows().filter(s => s.enabled !== false && s.mode !== 'manual');
  const missed = shows.filter(show =>
    isWithinScheduleRange(show) &&
    isTodayScheduled(show)      &&
    scheduledTimePassed(show)   &&
    !ranToday(show)
  );

  if (missed.length === 0) return;

  // Delay startup: 8s base + 3s stagger between shows
  missed.forEach((show, i) => {
    setTimeout(() => {
      logLine(show.id, mt('catchup.log', { time: show.schedule.time }));
      runShow(show.id, false, false);
    }, 8000 + i * 3000);
  });
}

// ── Live schedule check: safety net in case node-cron misses a tick ──────────
// Runs every 2 min; re-triggers any show whose scheduled time has passed today
// but hasn't run yet (and isn't currently running).

function startLiveScheduleCheck() {
  setInterval(() => {
    const shows = store.getShows().filter(s => s.enabled !== false && s.mode !== 'manual');
    for (const show of shows) {
      if (!isWithinScheduleRange(show)) continue;
      if (!isTodayScheduled(show))      continue;
      if (!scheduledTimePassed(show))   continue;
      if (ranToday(show))               continue;
      if (_runStatus.get(show.id) === 'running') continue;
      logLine(show.id, '[live-check] Esecuzione riavviata (tick perso)');
      runShow(show.id);
    }
  }, 2 * 60 * 1000);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-settings',   ()    => store.getSettings());
ipcMain.handle('save-settings',  (_, s) => {
  store.saveSettings(s);
  _loadMainLocale();
  updateTrayMenu();
  applyLoginItem(s);
  return true;
});

ipcMain.handle('get-shows',  ()   => store.getShows());
ipcMain.handle('get-show',   (_, id) => store.getShow(id));
ipcMain.handle('new-id',     ()   => newId());

ipcMain.handle('save-show', (_, show) => {
  store.saveShow(show);
  scheduler.cancelShow(show.id);
  scheduler.scheduleShow(show, scheduledRun);
  updateTrayMenu();
  return true;
});

ipcMain.handle('delete-show', (_, id) => {
  scheduler.cancelShow(id);
  store.deleteShow(id);
  alertState.forgetShow(id);
  updateTrayMenu();
  return true;
});

ipcMain.handle('run-show', (_, id, force, dryRun) => {
  runShow(id, force === true, dryRun === true);
  return true;
});
ipcMain.handle('get-run-status', (_, id) => _runStatus.get(id) || 'idle');

ipcMain.handle('get-log',   (_, id) => store.readLog(id));
ipcMain.handle('clear-log', (_, id) => { store.clearLog(id); return true; });

ipcMain.handle('export-log', async (_, id) => {
  const content = store.readLog(id, 9999);
  if (!content) return false;
  const show = store.getShow(id);
  const name = (show && show.slug) ? show.slug : id;
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: mt('dlg.export_log'),
    defaultPath: `${name}_log_${date}.txt`,
    filters: [{ name: mt('dlg.text_files'), extensions: ['txt', 'log'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('open-log-folder', () => {
  shell.openPath(store.getLogsDir());
  return true;
});

ipcMain.handle('get-history',   (_, id) => store.readHistory(id));
ipcMain.handle('clear-history', (_, id) => { store.clearHistory(id); return true; });

// includeSecrets: the "Include passwords and tokens" box (off by default). Off, the file has no secrets.
ipcMain.handle('export-config', async (_, includeSecrets) => {
  const withSecrets = includeSecrets === true;
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: mt('dlg.export_config'),
    defaultPath: `flowcast-backup-${date}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return false;
  const data = backup.buildExport(
    { settings: store.getSettings(), shows: store.getShows(), ftpBookmarks: store.getFtpBookmarks() },
    { includeSecrets: withSecrets });
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: withSecrets ? 0o600 : 0o644 });
  return true;
});

ipcMain.handle('import-config', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: mt('dlg.import_config'),
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return null;
  try {
    return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
  } catch(e) {
    return { error: e.message };
  }
});

// Applies the file chosen with import-config. A secret the file does not carry is kept from this PC
// (same server and user); the ones that stay empty are returned, so the app can list them.
ipcMain.handle('apply-import', (_, { data, replace }) => {
  const plan = backup.prepareImport(
    { settings: store.getSettings(), shows: store.getShows(), ftpBookmarks: store.getFtpBookmarks() },
    data || {}, { replace: replace === true });
  for (const show of plan.shows) {
    store.saveShow(show);
    scheduler.cancelShow(show.id);
    scheduler.scheduleShow(show, scheduledRun);
  }
  for (const bm of plan.ftpBookmarks) store.saveFtpBookmark(bm);
  if (plan.settings) {
    store.saveSettings(plan.settings);
    _loadMainLocale();
    applyLoginItem(store.getSettings());
  }
  updateTrayMenu();
  return { shows: plan.shows.length, settings: !!plan.settings, missing: plan.missing };
});

// Categories: rename (merges into an existing one if the name is taken) and delete (shows move elsewhere)
function applyCategoryChange(res) {
  for (const show of res.changed) store.saveShow(show);
  store.saveSettings({ categoryColors: res.colors });
  updateTrayMenu();
  return { changed: res.changed.length, merged: !!res.merged, shows: store.getShows(), settings: store.getSettings() };
}
ipcMain.handle('category-rename', (_, { from, to }) =>
  applyCategoryChange(categories.renameCategory(store.getShows(), store.getSettings().categoryColors, from, to)));
ipcMain.handle('category-delete', (_, { name, moveTo }) =>
  applyCategoryChange(categories.deleteCategory(store.getShows(), store.getSettings().categoryColors, name, moveTo)));

ipcMain.handle('get-ftp-bookmarks',   ()       => store.getFtpBookmarks());
ipcMain.handle('save-ftp-bookmark', (_, bm) => {
  store.saveFtpBookmark(bm);
  // Propagate updated credentials to all shows using this bookmark
  let propagated = 0;
  for (const show of store.getShows()) {
    const ftp = show.ftp;
    if (!ftp) continue;
    const match = (ftp.bookmarkId && ftp.bookmarkId === bm.id) ||
                  (!ftp.bookmarkId && ftp.name === bm.name);
    if (match) {
      show.ftp = { ...ftp, bookmarkId: bm.id, name: bm.name, host: bm.host, port: bm.port, user: bm.user, password: bm.password, secure: bm.secure };
      // remotePath intentionally NOT propagated — each show keeps its own remote path
      store.saveShow(show);
      propagated++;
    }
  }
  return { propagated };
});
ipcMain.handle('delete-ftp-bookmark', (_, id)  => { store.deleteFtpBookmark(id); return true; });

ipcMain.handle('duplicate-show', (_, id) => {
  const show = store.getShow(id);
  if (!show) return null;
  const nid  = newId();
  const copy = { ...JSON.parse(JSON.stringify(show)), id: nid, name: show.name + mt('show.copy_suffix'), lastRun: null, lastResult: null };
  store.saveShow(copy);
  if (copy.enabled) scheduler.scheduleShow(copy, sid => runShow(sid));
  updateTrayMenu();
  return copy;
});

ipcMain.handle('test-ftp', (_, cfg) => {
  const s = store.getSettings();
  const timeoutMs = ((s.ftpTimeout || 30) * 1000);
  return ftpClient.testConnection(cfg, timeoutMs);
});

ipcMain.handle('ftp-browse', async (_, { host, port, user, password, secure, path: dirPath }) => {
  const { Client } = require('basic-ftp');
  const client = new Client(15000);
  client.ftp.verbose = false;
  try {
    await client.access({ host, port: port || 21, user, password, secure: !!secure });
    const rawPath = dirPath || '/';
    const list = await client.list(rawPath);
    const entries = list.map(e => ({
      name: e.name,
      isDir: e.isDirectory,
      size: e.size
    }));
    // Sort: dirs first, then files, both alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, path: rawPath, entries };
  } catch (err) {
    return { ok: false, error: maskSecrets(err.message, [password]) };
  } finally {
    client.close();
  }
});

ipcMain.handle('test-email', (_, cfg) => notify.testEmailConnection(cfg));
ipcMain.handle('test-telegram', (_, cfg) => notify.testTelegramConnection(cfg));

// ── Dashboard data ────────────────────────────────────────────────────────────

// Next runs of all enabled scheduled shows, soonest first
ipcMain.handle('get-queue', (_, days = 7) => {
  const from = new Date();
  const to   = new Date(from.getTime() + Math.min(Math.max(days, 1), 31) * 86400000);
  const out  = [];
  for (const show of store.getShows()) {
    for (const d of scheduler.upcomingRuns(show, from, to)) {
      out.push({ showId: show.id, name: show.name, category: show.category || '', time: d.getTime() });
    }
  }
  return out.sort((a, b) => a.time - b.time).slice(0, 500);
});

ipcMain.handle('get-stats', () => stats.all());

// Latest runs of all shows, newest first
ipcMain.handle('get-activity', (_, limit = 50) => {
  const all = [];
  for (const show of store.getShows()) {
    for (const h of store.readHistory(show.id, 30)) all.push({ ...h, showId: show.id, name: show.name });
  }
  return all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
});

ipcMain.handle('get-running', () => [..._runStatus.entries()].filter(([, st]) => st === 'running').map(([id]) => id));
ipcMain.handle('get-platform', () => ({ platform: process.platform, dataDir: store.getDataDir(), secretsEncrypted: store.secretsEncrypted() }));

ipcMain.handle('get-app-version', () => app.getVersion());

// ── Updates ───────────────────────────────────────────────────────────────────
// Asks GitHub for the latest release; the renderer shows a banner. On request the
// installer is downloaded to the Downloads folder and verified (SHA-256); it only
// runs when the user presses "Close and install".

const UPDATE_FIRST_CHECK_MS = 20 * 1000;          // after the 8s catch-up runs
const UPDATE_INTERVAL_MS    = 24 * 3600 * 1000;
let _lastUpdateInfo = null;

async function runUpdateCheck(manual) {
  const info = await updater.checkForUpdate(store.getSettings().updateRepo);
  if (info.ok) _lastUpdateInfo = info;
  if (!info.ok) store.appendLog('_system', `Update check failed: ${info.error}`);
  if (!manual && info.available && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', info);
  }
  // Desktop, Telegram and email, once per version and channel (needs the option and a channel switched on)
  if (!manual && info.available) {
    const repo = store.getSettings().updateRepo;
    const url  = info.url && info.url.startsWith(`https://github.com/${repo}/releases/`) ? info.url : `https://github.com/${repo}/releases/latest`;
    alerter.notifyUpdate(info, url).catch(e => store.appendLog('_system', `Update alert failed: ${maskSecrets(e.message, secretsInUse())}`));
  }
  return info;
}

function scheduleUpdateChecks() {
  const auto = () => { if (store.getSettings().checkUpdates !== false) runUpdateCheck(false); };
  setTimeout(auto, UPDATE_FIRST_CHECK_MS);
  setInterval(auto, UPDATE_INTERVAL_MS);
}

ipcMain.handle('check-updates', () => runUpdateCheck(true));
// Result of the last automatic check, for a renderer that loads after it ran
ipcMain.handle('get-update-info', () =>
  (store.getSettings().checkUpdates !== false && _lastUpdateInfo && _lastUpdateInfo.available) ? _lastUpdateInfo : null);
ipcMain.handle('dismiss-update', (_, version) => {
  store.saveSettings({ updateDismissed: String(version || '') });
  return true;
});
let _downloadedInstaller = null;   // { version, file } once downloaded and verified

ipcMain.handle('download-update', async () => {
  const info = _lastUpdateInfo;
  if (!info || !info.available) return { ok: false, error: 'no-update' };
  if (_downloadedInstaller && _downloadedInstaller.version === info.latest && fs.existsSync(_downloadedInstaller.file)) {
    return { ok: true, file: _downloadedInstaller.file };
  }
  try {
    const file = await updater.downloadInstaller(info, app.getPath('downloads'), (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-progress', { received, total });
    });
    _downloadedInstaller = { version: info.latest, file };
    store.appendLog('_system', `Update ${info.latest} downloaded and verified: ${file}`);
    return { ok: true, file };
  } catch(e) {
    store.appendLog('_system', `Update download failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Windows: start the installer and quit so it can replace the app.
// macOS / Linux: open the downloaded disk image / show the AppImage; the user completes it.
ipcMain.handle('install-update', () => {
  const d = _downloadedInstaller;
  if (!d || !fs.existsSync(d.file)) return false;
  if (process.platform === 'win32') {
    require('child_process').spawn(d.file, [], { detached: true, stdio: 'ignore' }).unref();
    app.isQuitting = true;
    setTimeout(() => app.quit(), 500);
  } else if (process.platform === 'darwin') {
    shell.openPath(d.file);
  } else {
    shell.showItemInFolder(d.file);
  }
  return true;
});

// User manual (PDF) of the installed version, attached to its GitHub release
ipcMain.handle('open-manual', () => {
  const v    = app.getVersion();
  const name = ((store.getSettings().language || 'en').startsWith('it')) ? 'FlowCast-Manuale' : 'FlowCast-Manual';
  shell.openExternal(`https://github.com/${store.getSettings().updateRepo}/releases/download/v${v}/${name}-${v}.pdf`);
  return true;
});

ipcMain.handle('open-update', () => {
  const repo = store.getSettings().updateRepo;
  const url  = _lastUpdateInfo && _lastUpdateInfo.url;
  // Only this repository's release pages
  if (url && url.startsWith(`https://github.com/${repo}/releases/`)) shell.openExternal(url);
  else shell.openExternal(`https://github.com/${repo}/releases/latest`);
  return true;
});

// FFmpeg is an external program: check it can be started, report its version
// and which output formats its build can encode (e.g. some builds lack libvorbis)
const FFMPEG_ENCODERS = { mp3: 'libmp3lame', aac: 'aac', ogg: 'libvorbis' };

function runFfmpegInfo(bin, args) {
  return new Promise(resolve => {
    execFile(bin, args, { timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

ipcMain.handle('check-ffmpeg', async (_, ffmpegPath) => {
  const bin = resolveFfmpeg(ffmpegPath || store.getSettings().ffmpegPath);
  const ver = await runFfmpegInfo(bin, ['-version']);
  if (ver.err) return { ok: false, path: bin, error: ver.err.code === 'ENOENT' ? 'not-found' : ver.err.message };
  const m   = /ffmpeg version (\S+)/.exec(ver.stdout);
  const enc = await runFfmpegInfo(bin, ['-hide_banner', '-encoders']);
  const missing = enc.err ? [] : Object.keys(FFMPEG_ENCODERS)
    .filter(fmt => !new RegExp(`^\\s*A\\S*\\s+${FFMPEG_ENCODERS[fmt]}\\s`, 'm').test(enc.stdout));
  return { ok: true, path: bin, version: m ? m[1] : '', missing };
});

ipcMain.handle('next-run', (_, show) => {
  const d = scheduler.nextRun(show);
  return d ? d.toLocaleString(i18n.dateLocale()) : null;
});

ipcMain.handle('get-next-task', () => {
  const shows = store.getShows().filter(s => s.enabled !== false && s.mode !== 'manual');
  let earliest = null;
  let earliestShow = null;
  shows.forEach(show => {
    if (!isWithinScheduleRange(show)) return;
    const d = scheduler.nextRun(show);
    if (d && (!earliest || d < earliest)) { earliest = d; earliestShow = show; }
  });
  if (!earliest) return null;
  return {
    id:   earliestShow.id,
    name: earliestShow.name,
    time: earliest.toLocaleDateString(i18n.dateLocale(), { weekday:'long', day:'numeric', month:'long' }) + ', ' +
          earliest.toLocaleTimeString(i18n.dateLocale(), { hour:'2-digit', minute:'2-digit' }),
    ts:   earliest.getTime()
  };
});

ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('browse-file', async (_, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: mt('dlg.all_files'), extensions: ['*'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // No menu bar on Windows/Linux. macOS needs an app menu for Cmd+Q and the edit shortcuts (Cmd+C/V/X/A).
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null);
  if (process.platform === 'win32') app.setAppUserModelId('com.onairgarage.flowcast');

  // Load store here (inside whenReady) so app.getPath('userData') is guaranteed ready.
  // This fixes "first install doesn't work, second does" on some Windows configurations.
  store.setSecretBox(createSecretBox(safeStorage));   // passwords and tokens are encrypted on disk when the keystore allows it
  store.load();
  stats.load(store.getDataDir(), store.getHistoryDir());
  _loadMainLocale();
  const sec = store.getSecretStatus();
  if (sec.unreadable) store.appendLog('_system', `${sec.unreadable} saved password(s)/token(s) could not be decrypted on this PC: enter them again in Settings`);
  if (!sec.encrypted) store.appendLog('_system', 'System keystore not available: passwords and tokens are saved without encryption');

  alertState = createAlertState(path.join(store.getDataDir(), 'alert-state.json')).load();
  // versions before 26.10.1 kept the "source not updated" count inside the show: move it to the alert state
  for (const show of store.getShows()) if (alertState.adoptShowStreak(show)) store.saveShow(show);
  alerter = notify.createAlerter({
    getSettings: () => store.getSettings(),
    state: alertState,
    notifyDesktop: desktopNotice,
    log: (level, text) => store.appendLog('_system', text)
  });

  // Sync autostart setting on startup
  applyLoginItem(store.getSettings());

  createWindow();
  createTray();
  // Auto-disable shows past their end date
  const today = new Date().toISOString().slice(0, 10);
  for (const show of store.getShows()) {
    if (show.enabled !== false && show.schedule && show.schedule.endDate && show.schedule.endDate < today) {
      show.enabled = false;
      store.saveShow(show);
      console.log(`[scheduler] Auto-disabled expired show: ${show.name}`);
    }
  }
  setupSchedulers();
  checkMissedRuns();
  startLiveScheduleCheck();
  scheduleUpdateChecks();
});

app.on('window-all-closed', (e) => {
  // Keep running in tray (don't quit)
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
