'use strict';
const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { dateLocale } = require('./i18n');

const DATA_DIR    = app.getPath('userData');
const DATA_FILE   = path.join(DATA_DIR, 'data.json');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');
const WORK_DIR    = path.join(DATA_DIR, 'work');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function getLogsDir()    { return LOGS_DIR; }
function getDataDir()    { return DATA_DIR; }

function ensureDirs() {
  [DATA_DIR, LOGS_DIR, WORK_DIR, HISTORY_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

const DEFAULTS = {
  settings: {
    baseWav:     '',
    baseArchive: '',
    ffmpegPath:  'ffmpeg',
    ftpTimeout:  30,
    autostart:   false,
    startHidden: false,
    checkUpdates:    true,
    updateRepo:      'djgragra/flowcast',
    updateDismissed: '',
    email: {
      enabled:              false,
      smtp: { host: '', port: 587, user: '', password: '', secure: false },
      from:                 '',
      recipients:           '',
      onError:              true,
      onNoUpdate:           false,
      noUpdateStreakThreshold: 3
    }
  },
  shows: []
};

let _data = null;

// ── Settings migration ────────────────────────────────────────────────────────
// Defaults only apply to a new data.json, and imported backups may carry values from
// other installs. updateRepo is not editable in the UI, so anything that is empty,
// not a valid 'owner/repo' or a retired repository is reset to the current one.
const UPDATE_REPO          = 'djgragra/flowcast';
const RETIRED_UPDATE_REPOS = ['djgragra/flowcast_p'];   // compared lowercase

function normalizeSettings(settings) {
  const repo = typeof settings.updateRepo === 'string' ? settings.updateRepo.trim() : '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || RETIRED_UPDATE_REPOS.includes(repo.toLowerCase())) {
    settings.updateRepo = UPDATE_REPO;
  }
  if (typeof settings.checkUpdates !== 'boolean') settings.checkUpdates = true;
  if (typeof settings.updateDismissed !== 'string') settings.updateDismissed = '';
  return settings;
}

function load() {
  // ── Migration: copy data from old "Podcast Manager" userData dir if upgrading ──

  ensureDirs();
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
  const before = JSON.stringify(_data.settings);
  normalizeSettings(_data.settings);
  if (JSON.stringify(_data.settings) !== before) save();
  return _data;
}

function save() {
  ensureDirs();
  fs.writeFileSync(DATA_FILE, JSON.stringify(_data, null, 2), 'utf-8');
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

function appendLog(showId, line) {
  const ts  = new Date().toLocaleString(dateLocale());
  const msg = `[${ts}] ${line}\n`;
  const f   = logFilePath(showId);

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
  load, save, getData,
  getSettings, saveSettings,
  getShows, getShow, saveShow, deleteShow,
  getShowWorkDir,
  appendLog, readLog, clearLog,
  appendHistory, readHistory, clearHistory,
  getFtpBookmarks, saveFtpBookmark, deleteFtpBookmark,
  getLogsDir, getDataDir
};
