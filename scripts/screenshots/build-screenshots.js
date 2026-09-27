'use strict';
// Renders website screenshots (1280x800 PNG, English UI, generic demo data) into
// release/screenshots/. Loaded by main.js only when FLOWCAST_SHOTS_OUT is set
// (see scripts/screenshots/run.js); scripts/ is not part of the packaged app.

const { app, BrowserWindow } = require('electron');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT       = path.join(__dirname, '..', '..');
const OUT_DIR     = path.resolve(process.env.FLOWCAST_SHOTS_OUT);
const TIMEOUT_MS  = 5 * 60 * 1000;
const W = 1280, H = 800;

// ── Demo data (fictional: no real station, server or show) ───────────────────

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcast-shots-'));
app.setPath('userData', tmpData);

const CATEGORIES = { 'demo-morning': 'News', 'demo-city': 'News', 'demo-sport': 'Sport', 'demo-jazz': 'Music', 'demo-summer': 'Music', 'demo-tech': 'Talk' };

function demoHistory(shows) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  fs.mkdirSync(path.join(tmpData, 'history'), { recursive: true });
  for (const s of shows) {
    const [hh, mm] = s.schedule.time.split(':').map(Number);
    const list = [];
    for (let d = 1; d <= 35; d++) {
      if (rnd() < 0.3) continue;
      const date = new Date(); date.setDate(date.getDate() - d); date.setHours(hh, mm + 1, 0, 0);
      const r = rnd(), result = r < 0.04 ? 'error' : r < 0.12 ? 'no-update' : 'ok';
      list.push({ date: date.toISOString(), result, filename: result === 'ok' ? `${s.slug}.mp3` : null,
        durationMs: result === 'ok' ? 20000 + Math.round(rnd() * 40000) : undefined,
        bytes: result === 'ok' ? 20e6 + Math.round(rnd() * 60e6) : undefined, error: result === 'error' ? 'FTP: connection timed out' : undefined });
    }
    fs.writeFileSync(path.join(tmpData, 'history', s.id + '.json'), JSON.stringify(list));
  }
}

function demoData() {
  const now = new Date().toISOString();
  const ftp = { enabled: true, bookmarkId: 'bm-demo', host: 'ftp.example.com', port: 21, user: 'podcast',
                password: 'demo-password', secure: true };
  const ok  = { ftp: 'ok', archive: 'ok', local: 'skipped' };
  const show = (id, name, slug, time, freq, days, parts, extra = {}) => ({
    id, name, slug, category: CATEGORIES[id] || '', enabled: true, mode: 'scheduled', outputFormat: 'mp3', bitrate: '192k',
    wavBase: 'C:\\Radio\\Exports',
    wavFiles: parts.map((p, i) => ({ path: p, check: !/jingle|intro/i.test(p), note: i === 0 && /jingle|intro/i.test(p) ? 'Intro' : `Part ${i + 1}` })),
    archiveEnabled: true, archivePath: slug.toUpperCase().replace(/-/g, ' '), workDirOverride: '', verificaFile: '',
    outputFolder: '', clearOutput: false,
    schedule: { time, freq, days, startDate: '2026-09-01', endDate: null },
    ftp: { ...ftp, remotePath: '/' + slug.replace(/-/g, '_') },
    lastRun: now, lastResult: 'ok', lastDetails: ok, noUpdateStreak: 0, ...extra
  });
  return {
    settings: {
      baseWav: 'C:\\Radio\\Exports', baseArchive: 'D:\\Archive', ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      ftpTimeout: 30, autostart: false, startHidden: false, theme: 'dark', language: 'en', closeToTray: 'auto',
      checkUpdates: false, updateRepo: 'djgragra/flowcast', updateDismissed: '',
      email: {
        enabled: true,
        smtp: { host: 'smtp.example.com', port: 587, user: 'alerts@example.com', password: 'demo-password', secure: false, allowSelfSigned: false },
        from: 'alerts@example.com', recipients: 'producer@example.com\nengineer@example.com',
        onError: true, onNoUpdate: true, noUpdateStreakThreshold: 3
      }
    },
    shows: [
      show('demo-morning', 'Morning News',   'morning-news',   '07:10', 'weekdays', [], ['Jingles\\intro.wav', 'News\\morning_1.wav', 'News\\morning_2.wav']),
      show('demo-jazz',    'Jazz Corner',    'jazz-corner',    '21:10', 'specific', ['SAT'], ['Music\\jazz_1.wav', 'Music\\jazz_2.wav']),
      show('demo-tech',    'Tech Weekly',    'tech-weekly',    '13:10', 'specific', ['FRI'], ['Talk\\tech_1.wav', 'Talk\\tech_2.wav', 'Talk\\tech_3.wav']),
      show('demo-sport',   'Sports Roundup', 'sports-roundup', '17:10', 'weekdays', [], ['Sport\\roundup.wav'],
           { lastResult: 'no-update', lastDetails: null, noUpdateStreak: 1 }),
      show('demo-city',    'City Talk',      'city-talk',      '11:10', 'daily',    [], ['Talk\\city.wav'],
           { lastResult: 'error', lastDetails: { ftp: 'error', archive: 'ok', local: 'skipped' } }),
      show('demo-summer',  'Summer Nights',  'summer-nights',  '23:10', 'weekend',  [], ['Music\\summer.wav'],
           { enabled: false, schedule: { time: '23:10', freq: 'weekend', days: [], startDate: '2026-06-01', endDate: '2026-08-31' } })
    ],
    ftpBookmarks: [
      { id: 'bm-demo', name: 'Podcast server', host: 'ftp.example.com', port: 21, user: 'podcast',
        password: 'demo-password', remotePath: '/', secure: true }
    ]
  };
}
const DEMO = demoData();
fs.writeFileSync(path.join(tmpData, 'data.json'), JSON.stringify(DEMO, null, 2));
demoHistory(DEMO.shows);

// ── Shots ─────────────────────────────────────────────────────────────────────
// [outputName, theme, jsAction]
const SHOTS = [
  ['01-dashboard-dark',    'dark',  "document.getElementById('nav-dashboard').click()"],
  ['02-schedule-dark',     'dark',  "document.getElementById('nav-schedule').click(); document.querySelector('[data-pal=timeline]').click(); document.querySelector('#timeline-range [data-range=\"7\"]').click()"],
  ['03-show-editor-dark',  'dark',  "await openShow('demo-morning'); switchTab('sorgenti')"],
  ['04-settings-dark',     'dark',  "openSettings('general')"],
  ['05-dashboard-light',   'light', "closeSettings(); document.getElementById('nav-dashboard').click()"],
  ['06-schedule-light',    'light', "document.getElementById('nav-schedule').click(); document.querySelector('[data-pal=shows]').click()"],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForMainWindow() {
  for (let i = 0; i < 300; i++) {
    const win = BrowserWindow.getAllWindows().find(w => /renderer[\\/]index\.html$/.test(w.webContents.getURL()));
    if (win && !win.webContents.isLoading()) return win;
    await sleep(100);
  }
  throw new Error('FlowCast window did not open');
}

async function setLanguage(win, lang) {
  await win.webContents.executeJavaScript(
    `(async () => { const s = await api.getSettings(); s.language = '${lang}'; await api.saveSettings(s); })()`);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await sleep(1500);
}

async function setTheme(win, theme) {
  await win.webContents.executeJavaScript(
    `(async () => { const s = await api.getSettings(); s.theme = '${theme}'; await api.saveSettings(s); applyTheme('${theme}'); })()`);
  await sleep(300);
}

async function captureOne(win, action) {
  await win.webContents.executeJavaScript(`(async () => { ${action}; })().then(() => {
    document.querySelectorAll('#content, .set-body, .set-content').forEach(el => { el.scrollTop = 0; });
  })`);
  await sleep(1200);
  await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  win.webContents.invalidate();
  await sleep(250);
  let raw = null;
  for (let i = 0; i < 4 && !raw; i++) {
    try { raw = await win.webContents.capturePage(); } catch(e) { if (i === 3) throw e; await sleep(800); }
  }
  // Flatten to opaque RGB (no alpha) at exactly W x H, matching the G-Downloader screenshots
  return raw.resize({ width: W, height: H, quality: 'best' });
}

async function main() {
  const win = await waitForMainWindow();
  win.setSize(W, H);
  win.webContents.setBackgroundThrottling(false);
  win.show();
  await win.webContents.insertCSS('#ffmpeg-warning, #update-banner, #console { display: none !important; }');
  await setLanguage(win, 'en');
  await win.webContents.insertCSS('#ffmpeg-warning, #update-banner, #console { display: none !important; }');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let currentTheme = 'dark';
  for (const [name, theme, action] of SHOTS) {
    if (theme !== currentTheme) { await setTheme(win, theme); currentTheme = theme; }
    const img  = await captureOne(win, action);
    const file = path.join(OUT_DIR, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log(`[shots] ${path.relative(process.cwd(), file)}`);
  }
}

setTimeout(() => { console.error('[shots] timed out'); app.exit(1); }, TIMEOUT_MS).unref();

app.whenReady()
  .then(main)
  .then(() => {
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch(_) {}
    app.exit(0);
  })
  .catch(err => { console.error('[shots] failed:', err); app.exit(1); });
