'use strict';
// Renders the PDF user manual (English + Italian) with screenshots of the real app.
// Loaded by main.js only when FLOWCAST_MANUAL_OUT is set (see scripts/manual/run.js);
// the scripts/ folder is not part of the packaged app.
//
// It runs FlowCast on a temporary data folder filled with fictional demo shows,
// captures the main screens in each language, then prints the manual with Chromium.

const { app, BrowserWindow, nativeImage } = require('electron');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT     = path.join(__dirname, '..', '..');
const OUT_DIR  = path.resolve(process.env.FLOWCAST_MANUAL_OUT);
const VERSION  = require(path.join(ROOT, 'package.json')).version;
const LANGS    = ['en', 'it'];
const TIMEOUT_MS = 5 * 60 * 1000;

// ── Demo data (fictional: no real station, server or show) ───────────────────

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcast-manual-'));
app.setPath('userData', tmpData);

function demoData() {
  const now   = new Date().toISOString();
  const ftp   = { enabled: true, bookmarkId: 'bm-demo', host: 'ftp.example.com', port: 21, user: 'podcast',
                  password: 'demo-password', secure: true };
  const ok    = { ftp: 'ok', archive: 'ok', local: 'skipped' };
  const show  = (id, name, slug, time, freq, days, parts, extra = {}) => ({
    id, name, slug, enabled: true, mode: 'scheduled', outputFormat: 'mp3', bitrate: '192k',
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
fs.writeFileSync(path.join(tmpData, 'data.json'), JSON.stringify(demoData(), null, 2));

// ── Screenshots ───────────────────────────────────────────────────────────────

const SHOTS = [
  ['dashboard',        "document.getElementById('nav-dashboard').click()"],
  ['show-general',     "openShow('demo-morning').then(() => switchTab('generale'))"],
  ['show-sources',     "switchTab('sorgenti')"],
  ['show-schedule',    "switchTab('schedule')"],
  ['show-output',      "switchTab('output')"],
  ['settings-general', "openSettings('general')"],
  ['settings-email',   "switchSettingsSection('email')"],
  ['settings-info',    "switchSettingsSection('info')"],
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

async function reloadIn(win, lang) {
  await win.webContents.executeJavaScript(
    `(async () => { const s = await api.getSettings(); s.language = '${lang}'; await api.saveSettings(s); })()`);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await sleep(1500);
}

async function captureAll(win) {
  const shots = {};
  for (const [name, action] of SHOTS) {
    await win.webContents.executeJavaScript(`Promise.resolve(${action}).then(() => {
      document.querySelectorAll('#content, .set-body, .set-content').forEach(el => { el.scrollTop = 0; });
    })`);
    await sleep(700);
    const img = (await win.webContents.capturePage()).resize({ width: 1400, quality: 'best' });
    shots[name] = 'data:image/png;base64,' + img.toPNG().toString('base64');
  }
  return shots;
}

// ── Manual HTML ───────────────────────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function logoDataUrl() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'flowcast_scritta.png')).resize({ width: 420, quality: 'best' });
  return 'data:image/png;base64,' + img.toPNG().toString('base64');
}

function buildHtml(c, lang, shots) {
  let fig = 0;
  const date = new Date().toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const chapters = c.chapters.map((ch, i) => {
    const body = ch.html.replace(/\{\{shot:([\w-]+)\}\}/g, (_, name) => {
      if (!shots[name]) throw new Error(`Missing screenshot ${name}`);
      fig++;
      return `<figure><img src="${shots[name]}" alt=""><figcaption>${esc(c.figure)} ${fig} — ${esc(c.shots[name])}</figcaption></figure>`;
    });
    return `<section class="chapter"><h2 id="ch${i + 1}"><span class="num">${i + 1}</span>${esc(ch.title)}</h2>${body}</section>`;
  }).join('\n');
  const toc = c.chapters.map((ch, i) => `<li><a href="#ch${i + 1}"><span class="num">${i + 1}</span>${esc(ch.title)}</a></li>`).join('');

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>FlowCast — ${esc(c.title)} ${VERSION}</title>
<style>
  @page { size: A4; margin: 18mm 17mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt;
         line-height: 1.5; color: #1d2330; margin: 0; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: center;
           text-align: center; page-break-after: always; }
  .cover img { width: 52mm; margin-bottom: 12mm; }
  .cover h1 { font-size: 30pt; margin: 0 0 4mm; color: #0b1a3a; }
  .cover .meta { color: #5a6475; font-size: 11pt; }
  .cover .intro { max-width: 140mm; margin-top: 14mm; color: #333; font-size: 10.5pt; }
  .cover .by { margin-top: 16mm; color: #5a6475; font-size: 9.5pt; }
  .toc { page-break-after: always; }
  .toc h2 { font-size: 18pt; color: #0b1a3a; border-bottom: 2px solid #1e7cf2; padding-bottom: 2mm; }
  .toc ol { list-style: none; padding: 0; columns: 2; column-gap: 10mm; }
  .toc li { margin: 1.6mm 0; break-inside: avoid; }
  .toc a { color: #1d2330; text-decoration: none; }
  .num { display: inline-block; min-width: 8mm; color: #1e7cf2; font-weight: 600; }
  .chapter { margin-bottom: 9mm; }
  h2 { font-size: 16pt; color: #0b1a3a; border-bottom: 2px solid #1e7cf2; padding-bottom: 2mm; margin: 0 0 4mm;
       break-after: avoid; page-break-after: avoid; }
  h3 { break-after: avoid; page-break-after: avoid; }
  h3 { font-size: 11.5pt; color: #0b1a3a; margin: 5mm 0 1.5mm; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin: 1mm 0; }
  code { font-family: Consolas, "SF Mono", Menlo, monospace; font-size: 9pt; background: #eef2f8; padding: 0.2mm 1mm; border-radius: 1mm; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.8pt; }
  th, td { text-align: left; vertical-align: top; padding: 1.6mm 2.2mm; border-bottom: 1px solid #d9dee8; }
  th { background: #eef2f8; color: #0b1a3a; }
  tr { break-inside: avoid; }
  .note { border-left: 3px solid #e0a100; background: #fff8e6; padding: 2.5mm 3.5mm; margin: 3mm 0; break-inside: avoid; }
  figure { margin: 4mm 0 5mm; break-inside: avoid; text-align: center; }
  figure img { width: 100%; border: 1px solid #c9d0dc; border-radius: 1.5mm; }
  figcaption { font-size: 8.8pt; color: #5a6475; margin-top: 1.5mm; }
</style></head><body>
<div class="cover">
  <img src="${logoDataUrl()}" alt="FlowCast">
  <h1>${esc(c.title)}</h1>
  <div class="meta">${esc(c.version)} ${VERSION} · ${esc(date)} · Windows 10/11 x64</div>
  <div class="intro">${esc(c.intro.replace(/\s*\n\s*/g, ' '))}</div>
  <div class="by">Graziano Melzi · OnAir Garage — onairgarage.com</div>
</div>
<div class="toc"><h2>${esc(c.contents)}</h2><ol>${toc}</ol></div>
${chapters}
</body></html>`;
}

async function printPdf(html, file, c) {
  const htmlPath = path.join(tmpData, path.basename(file, '.pdf') + '.html');
  fs.writeFileSync(htmlPath, html);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  await win.loadFile(htmlPath);
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#8a93a3;padding:0 17mm;display:flex;justify-content:space-between;font-family:'Segoe UI',system-ui,sans-serif">
      <span>FlowCast ${VERSION} — ${esc(c.title)}</span><span>${esc(c.page)} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    generateDocumentOutline: true
  });
  win.destroy();
  fs.writeFileSync(file, pdf);
  return pdf.length;
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function main() {
  const win = await waitForMainWindow();
  win.setSize(1200, 760);
  await win.webContents.insertCSS('#ffmpeg-warning, #update-banner { display: none !important; }');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const lang of LANGS) {
    const c = require(`./content.${lang}.js`);
    await reloadIn(win, lang);
    await win.webContents.insertCSS('#ffmpeg-warning, #update-banner { display: none !important; }');
    const shots = await captureAll(win);
    const file  = path.join(OUT_DIR, `${c.file}-${VERSION}.pdf`);
    const size  = await printPdf(buildHtml(c, lang, shots), file, c);
    console.log(`[manual] ${path.relative(process.cwd(), file)} (${Math.round(size / 1024)} KB)`);
  }
}

setTimeout(() => { console.error('[manual] timed out'); app.exit(1); }, TIMEOUT_MS).unref();

app.whenReady()
  .then(main)
  .then(() => { fs.rmSync(tmpData, { recursive: true, force: true }); app.exit(0); })
  .catch(err => { console.error('[manual] failed:', err); app.exit(1); });
