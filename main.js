'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } = require('electron');
const path           = require('path');
const fs             = require('fs');
// Development only: `npm run manual` renders the PDF manual with screenshots of the app.
// scripts/ is not packaged, so this never runs in the installed app.
if (process.env.FLOWCAST_MANUAL_OUT) require('./scripts/manual/build-manual');
const { v4: uuidv4 } = require ? (() => { try { return require('uuid'); } catch(e){ return {v4: ()=> Date.now().toString(36)+Math.random().toString(36).slice(2)}; } })() : {v4: ()=> Date.now().toString(36)+Math.random().toString(36).slice(2)};
const store          = require('./src/store');
const scheduler      = require('./src/scheduler');
const processor      = require('./src/processor');
const ftpClient      = require('./src/ftp-client');
const emailNotifier  = require('./src/email-notifier');
const i18n           = require('./src/i18n');
const updater        = require('./src/updater');
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
const START_HIDDEN = process.argv.includes('--hidden');

let mainWindow = null;
let tray       = null;

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

function makeTrayIcon() {
  return loadAppIcon().resize({ width: 16, height: 16 });
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

  const logFn      = line => logLine(showId, line);
  const progressFn = s    => notifyStatus(showId, s === 'start' ? 'running' : s);
  const settings   = store.getSettings();

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

    // Track no-update streak for email alerts
    let noUpdateStreak = show.noUpdateStreak || 0;
    if (result.action === 'no-update') {
      noUpdateStreak++;
    } else {
      noUpdateStreak = 0;
    }

    const now = new Date().toISOString();
    const updated = { ...show, lastRun: now, lastResult: finalStatus, lastDetails, noUpdateStreak };
    if (!dryRun) {
      store.saveShow(updated);
      store.appendHistory(showId, {
        date: now, result: finalStatus,
        filename: result.filename || null,
        details: lastDetails
      });
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

    // Email alerts
    if (!dryRun) {
      const emailCfg = settings.email;
      if (result.action === 'produced' && lastDetails) {
        const hasOpError = Object.values(lastDetails).includes('error');
        if (hasOpError) {
          emailNotifier.sendAlert(emailCfg, show, 'error', { ops: lastDetails })
            .catch(e => store.appendLog('_system', `Email alert failed: ${e.message}`));
        }
      }
      if (result.action === 'no-update') {
        const threshold = (emailCfg && emailCfg.noUpdateStreakThreshold) || 3;
        if (noUpdateStreak >= threshold && noUpdateStreak % threshold === 0) {
          emailNotifier.sendAlert(emailCfg, show, 'no-update', { streak: noUpdateStreak })
            .catch(e => store.appendLog('_system', `Email alert failed: ${e.message}`));
        }
      }
    }

  } catch(e) {
    logFn(mt('log.error', { message: e.message }));
    notifyStatus(showId, 'error');
    updateTrayMenu();
    const now = new Date().toISOString();
    if (!dryRun) {
      const updated = { ...show, lastRun: now, lastResult: 'error', lastDetails: null, noUpdateStreak: 0 };
      store.saveShow(updated);
      store.appendHistory(showId, { date: now, result: 'error', error: e.message });
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

    // Email alert on critical error
    if (!dryRun) {
      const emailCfg = store.getSettings().email;
      emailNotifier.sendAlert(emailCfg, show, 'error', { message: e.message })
        .catch(err => store.appendLog('_system', `Email alert failed: ${err.message}`));
    }
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

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-settings',   ()    => store.getSettings());
ipcMain.handle('save-settings',  (_, s) => {
  store.saveSettings(s);
  _loadMainLocale();
  updateTrayMenu();
  // Sync Windows autostart registry
  try {
    app.setLoginItemSettings({
      openAtLogin: !!s.autostart,
      args: (s.autostart && s.startHidden) ? ['--hidden'] : []
    });
  } catch(e) {}
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

ipcMain.handle('export-config', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: mt('dlg.export_config'),
    defaultPath: `flowcast-backup-${date}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return false;
  const data = {
    version:      1,
    exportDate:   new Date().toISOString(),
    settings:     store.getSettings(),
    shows:        store.getShows(),
    ftpBookmarks: store.getFtpBookmarks()
  };
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
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
    return { ok: false, error: err.message };
  } finally {
    client.close();
  }
});

ipcMain.handle('test-email', (_, cfg) => emailNotifier.testConnection(cfg));

ipcMain.handle('get-app-version', () => app.getVersion());

// ── Update notice ─────────────────────────────────────────────────────────────
// Asks GitHub for the latest release; the renderer shows a banner with a link to
// the release page. Nothing is downloaded or installed automatically.

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
  const bin = (ffmpegPath || store.getSettings().ffmpegPath || 'ffmpeg').trim() || 'ffmpeg';
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
  // Remove default Electron menu (File/Edit/View/Help) — we use custom titlebar
  Menu.setApplicationMenu(null);

  // Load store here (inside whenReady) so app.getPath('userData') is guaranteed ready.
  // This fixes "first install doesn't work, second does" on some Windows configurations.
  store.load();
  _loadMainLocale();

  // Sync autostart setting on startup
  try {
    const s = store.getSettings();
    app.setLoginItemSettings({
      openAtLogin: !!s.autostart,
      args: (s.autostart && s.startHidden) ? ['--hidden'] : []
    });
  } catch(e) {}

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
  scheduleUpdateChecks();
});

app.on('window-all-closed', (e) => {
  // Keep running in tray (don't quit)
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
