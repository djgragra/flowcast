'use strict';
const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { dateLocale } = require('./i18n');
const { PLAIN_BOX, sealData, openData } = require('./secrets');
const { DEFAULTS, normalizeSettings } = require('./settings');

const DATA_DIR    = app.getPath('userData');
const DATA_FILE   = path.join(DATA_DIR, 'data.json');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');
const WORK_DIR    = path.join(DATA_DIR, 'work');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function getLogsDir()    { return LOGS_DIR; }
function getDataDir()    { return DATA_DIR; }
function getHistoryDir() { return HISTORY_DIR; }

function ensureDirs() {
  [DATA_DIR, LOGS_DIR, WORK_DIR, HISTORY_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

let _data = null;
let _hadFile = false;   // a data.json existed before this start (to tell an update from a new installation)
function hadSettingsFile() { return _hadFile; }

// Passwords and tokens are encrypted on disk when the system keystore allows it (src/secrets.js).
// Everywhere else in the app they are plain text.
let _box = PLAIN_BOX;
let _secretStatus = { unreadable: 0, plain: 0 };
function setSecretBox(box) { _box = box || PLAIN_BOX; }
function secretsEncrypted() { return !!_box.available(); }
function getSecretStatus() { return { ..._secretStatus, encrypted: secretsEncrypted() }; }

function load() {
  // ── Migration: copy data from old "Podcast Manager" userData dir if upgrading ──

  ensureDirs();
  _hadFile = fs.existsSync(DATA_FILE);
  if (!fs.existsSync(DATA_FILE)) {
    _data = JSON.parse(JSON.stringify(DEFAULTS));
    save();
    return _data;
  }
  try {
    _data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    if (!_data.settings) _data.settings = { ...DEFAULTS.settings };
    if (!_data.shows)    _data.shows    = [];
  } catch(e) {
    _data = JSON.parse(JSON.stringify(DEFAULTS));
  }
  // first the shape (old keys move to the common ones, values still sealed), then the secrets are opened
  const before = JSON.stringify(_data.settings);
  normalizeSettings(_data.settings);
  const migrated = JSON.stringify(_data.settings) !== before;
  _secretStatus = openData(_data, _box);
  // settings changed by the migration, or secrets still stored in plain text that can now be encrypted
  if (migrated || (_secretStatus.plain > 0 && _box.available())) save();
  return _data;
}

function save() {
  ensureDirs();
  // written under a temporary name and renamed: a crash never leaves a half-written data.json
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sealData(_data, _box), null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}

function getData() {
  if (!_data) load();
  return _data;
}

function getSettings() {
  return getData().settings;
}

function saveSettings(s) {
  getData().settings = normalizeSettings({ ...getData().settings, ...s });
  save();
}

function getShows() {
  return getData().shows;
}

function getShow(id) {
  return getData().shows.find(s => s.id === id) || null;
}

function saveShow(show) {
  const shows = getData().shows;
  const idx   = shows.findIndex(s => s.id === show.id);
  if (idx >= 0) shows[idx] = show;
  else shows.push(show);
  save();
}

function deleteShow(id) {
  getData().shows = getData().shows.filter(s => s.id !== id);
  save();
}

// Returns the working directory for a show.
// Uses show.workDirOverride if set, otherwise internal app data folder.
function getShowWorkDir(show) {
  if (show.workDirOverride) return show.workDirOverride;
  return path.join(WORK_DIR, show.slug || show.id);
}

function logFilePath(showId) {
  return path.join(LOGS_DIR, showId + '.log');
}

const LOG_MAX_LINES  = 1000;
const LOG_TRIM_LINES = 800;

// The daily log (src/logs.js: one file per day, 5 MB, 7 days) receives every line too; the per-show files
// below are what the Log tab of a show reads.
let _logger = null;
function setLogger(l) { _logger = l; }

function appendLog(showId, line, level = 'info') {
  const ts  = new Date().toLocaleString(dateLocale());
  const msg = `[${ts}] ${line}\n`;
  if (_logger) {
    const sh = showId === '_system' ? null : (_data && _data.shows.find(x => x.id === showId));
    _logger.log(level, line, sh ? sh.name : (showId === '_system' ? 'app' : showId));
  }
  if (showId === '_system') return msg;
  const f = logFilePath(showId);

  // Rotation: if file exceeds LOG_MAX_LINES, keep only LOG_TRIM_LINES
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf-8');
    const lines   = content.split('\n');
    if (lines.length > LOG_MAX_LINES) {
      fs.writeFileSync(f, lines.slice(-LOG_TRIM_LINES).join('\n') + '\n', 'utf-8');
    }
  }

  fs.appendFileSync(f, msg, 'utf-8');
  return msg;
}

function readLog(showId, maxLines = 300) {
  const f = logFilePath(showId);
  if (!fs.existsSync(f)) return '';
  const lines = fs.readFileSync(f, 'utf-8').split('\n');
  return lines.slice(-maxLines).join('\n');
}

function clearLog(showId) {
  const f = logFilePath(showId);
  if (fs.existsSync(f)) fs.writeFileSync(f, '', 'utf-8');
}

// ── History ───────────────────────────────────────────────────────────────────

function historyFilePath(showId) {
  return path.join(HISTORY_DIR, showId + '.json');
}

function appendHistory(showId, entry) {
  // entry: { date, result, filename?, error? }
  ensureDirs();
  const f = historyFilePath(showId);
  let list = [];
  if (fs.existsSync(f)) {
    try { list = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch(e) {}
  }
  list.unshift(entry);            // newest first
  if (list.length > 200) list = list.slice(0, 200);
  fs.writeFileSync(f, JSON.stringify(list, null, 2), 'utf-8');
}

function readHistory(showId, max = 50) {
  const f = historyFilePath(showId);
  if (!fs.existsSync(f)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return list.slice(0, max);
  } catch(e) { return []; }
}

function clearHistory(showId) {
  const f = historyFilePath(showId);
  if (fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
}

// ── FTP Bookmarks ─────────────────────────────────────────────────────────────

function getFtpBookmarks() {
  const d = getData();
  if (!d.ftpBookmarks) d.ftpBookmarks = [];
  return d.ftpBookmarks;
}

function saveFtpBookmark(bm) {
  const d = getData();
  if (!d.ftpBookmarks) d.ftpBookmarks = [];
  const idx = d.ftpBookmarks.findIndex(b => b.id === bm.id);
  if (idx >= 0) d.ftpBookmarks[idx] = bm;
  else d.ftpBookmarks.push(bm);
  save();
}

function deleteFtpBookmark(id) {
  const d = getData();
  if (!d.ftpBookmarks) return;
  d.ftpBookmarks = d.ftpBookmarks.filter(b => b.id !== id);
  save();
}

module.exports = {
  load, save, hadSettingsFile, getDataFile: () => DATA_FILE, getData, setSecretBox, secretsEncrypted, getSecretStatus,
  getSettings, saveSettings,
  getShows, getShow, saveShow, deleteShow,
  getShowWorkDir,
  setLogger, appendLog, readLog, clearLog,
  appendHistory, readHistory, clearHistory,
  getFtpBookmarks, saveFtpBookmark, deleteFtpBookmark,
  getLogsDir, getDataDir, getHistoryDir
};
