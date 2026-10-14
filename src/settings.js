// garage-common: settings-shape 1
'use strict';
// The shape of the saved settings, and the one function that cleans them (used for the saved file and for an
// imported backup alike). Old keys are still read and rewritten in the common shape. No Electron, no files.
const { parseRecipients } = require('./notify');

const DEFAULTS = {
  settings: {
    baseWav:     '',
    baseArchive: '',
    ffmpegPath:  'ffmpeg',
    ftpTimeout:  30,
    autostart:   false,
    startHidden: false,
    keepAwake:   false,
    checkUpdates:    true,
    updateAlert:     true,
    updateRepo:      'djgragra/flowcast',
    installationName: '',          // empty = the computer name (apps/COMMON-FEATURES.md, 5.3)
    // Channels, one shape for every OnAir Garage app (apps/COMMON-FEATURES.md, section 1)
    notifications: {
      desktop: true,
      telegram: { enabled: false, botToken: '', recipients: [], onError: true, onRecovery: true, onNoUpdate: false },
      email: {
        enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '', allowSelfSigned: false,
        recipients: [], onError: true, onRecovery: true, onNoUpdate: false, noUpdateStreakThreshold: 3
      }
    },
    // Summary of what happened (sent on the channels that are switched on)
    digest: { enabled: false, frequency: 'daily', times: ['08:00'], when: 'always' },
    // Kept on this PC, never part of a backup (src/backup.js, RUNTIME_KEYS)
    updateState:     { skipVersion: '', remindUntil: 0, lastCheck: null },
    lastSeenVersion: '',
    window:          null
  },
  shows: []
};

// ── Settings migration ────────────────────────────────────────────────────────
// Defaults only apply to a new data.json, and imported backups may carry values from
// other installs. updateRepo is not editable in the UI, so anything that is empty,
// not a valid 'owner/repo' or a retired repository is reset to the current one.
const UPDATE_REPO          = 'djgragra/flowcast';
const RETIRED_UPDATE_REPOS = ['djgragra/flowcast_p'];   // compared lowercase

const clone = d => JSON.parse(JSON.stringify(d));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const bool  = (v, d) => (typeof v === 'boolean' ? v : d);
const str   = (v, d = '') => (typeof v === 'string' ? v : d);

// Old keys are still read and rewritten in the common shape: `telegram.token` / `telegram.chatId`,
// `email.smtp.*` (FlowCast up to 26.10.1) become `notifications.telegram.botToken` and `notifications.email.*`.
function migrateNotifications(settings) {
  const def = DEFAULTS.settings.notifications;
  const n = isObj(settings.notifications) ? settings.notifications : {};
  const oldEmail = isObj(settings.email) ? settings.email : null;
  const oldTg    = isObj(settings.telegram) ? settings.telegram : null;

  const em = isObj(n.email) ? n.email : {};
  if (oldEmail) {
    const sm = isObj(oldEmail.smtp) ? oldEmail.smtp : {};
    const pick = (k, v) => { if (em[k] === undefined && v !== undefined) em[k] = v; };
    pick('enabled', oldEmail.enabled); pick('host', sm.host); pick('port', sm.port); pick('secure', sm.secure);
    pick('user', sm.user); pick('pass', sm.password); pick('allowSelfSigned', sm.allowSelfSigned);
    pick('from', oldEmail.from); pick('recipients', oldEmail.recipients); pick('onError', oldEmail.onError);
    pick('onNoUpdate', oldEmail.onNoUpdate); pick('noUpdateStreakThreshold', oldEmail.noUpdateStreakThreshold);
  }
  const email = { ...clone(def.email), ...em };
  email.enabled = bool(email.enabled, false);
  email.host = str(email.host); email.user = str(email.user); email.pass = str(email.pass); email.from = str(email.from);
  email.port = parseInt(email.port) || 587;
  email.secure = bool(email.secure, false);
  email.allowSelfSigned = bool(email.allowSelfSigned, false);
  email.recipients = parseRecipients(email.recipients);   // older versions kept up to three addresses in one text
  email.onError = bool(email.onError, true); email.onRecovery = bool(email.onRecovery, true); email.onNoUpdate = bool(email.onNoUpdate, false);
  email.noUpdateStreakThreshold = Math.max(1, parseInt(email.noUpdateStreakThreshold) || 3);

  const tg = isObj(n.telegram) ? n.telegram : {};
  if (oldTg) {
    const pick = (k, v) => { if (tg[k] === undefined && v !== undefined) tg[k] = v; };
    pick('enabled', oldTg.enabled); pick('botToken', oldTg.token); pick('onError', oldTg.onError); pick('onNoUpdate', oldTg.onNoUpdate);
    if (tg.recipients === undefined && Array.isArray(oldTg.recipients)) tg.recipients = oldTg.recipients;
    // Pre-26.9.7 installs stored a single chatId
    if ((!tg.recipients || !tg.recipients.length) && typeof oldTg.chatId === 'string' && oldTg.chatId.trim()) tg.recipients = [{ chatId: oldTg.chatId.trim(), note: '' }];
  }
  const telegram = { ...clone(def.telegram), ...tg };
  telegram.enabled = bool(telegram.enabled, false);
  telegram.botToken = str(telegram.botToken);
  telegram.recipients = (Array.isArray(telegram.recipients) ? telegram.recipients : [])
    .filter(r => r && String(r.chatId || '').trim()).map(r => ({ chatId: String(r.chatId).trim(), note: str(r.note) }));
  telegram.onError = bool(telegram.onError, true); telegram.onRecovery = bool(telegram.onRecovery, true); telegram.onNoUpdate = bool(telegram.onNoUpdate, false);
  delete telegram.token; delete telegram.chatId;

  settings.notifications = { desktop: bool(n.desktop, true), telegram, email };
  delete settings.email; delete settings.telegram;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDigest(settings) {
  const d = isObj(settings.digest) ? settings.digest : {};
  const times = [...new Set((Array.isArray(d.times) ? d.times : []).map(x => String(x).trim()).filter(x => TIME_RE.test(x)))].sort().slice(0, 6);
  settings.digest = {
    enabled:   bool(d.enabled, false),
    frequency: d.frequency === 'weekly' ? 'weekly' : 'daily',
    times:     times.length ? times : ['08:00'],
    when:      d.when === 'problems' ? 'problems' : 'always'
  };
}

function normalizeSettings(settings) {
  const repo = typeof settings.updateRepo === 'string' ? settings.updateRepo.trim() : '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || RETIRED_UPDATE_REPOS.includes(repo.toLowerCase())) {
    settings.updateRepo = UPDATE_REPO;
  }
  if (typeof settings.checkUpdates !== 'boolean') settings.checkUpdates = true;
  if (typeof settings.updateAlert !== 'boolean') settings.updateAlert = true;
  if (typeof settings.keepAwake !== 'boolean') settings.keepAwake = false;
  settings.installationName = str(settings.installationName).trim().slice(0, 60);
  migrateNotifications(settings);
  normalizeDigest(settings);

  // "Skip this version" was `updateDismissed` before 26.10.2
  const us = isObj(settings.updateState) ? settings.updateState : {};
  const lc = isObj(us.lastCheck) ? us.lastCheck : null;
  settings.updateState = {
    skipVersion: str(us.skipVersion) || str(settings.updateDismissed),
    remindUntil: Number.isFinite(Number(us.remindUntil)) ? Number(us.remindUntil) : 0,
    lastCheck:   lc && Number.isFinite(Number(lc.at)) ? { at: Number(lc.at), ok: !!lc.ok, error: str(lc.error).slice(0, 200) } : null
  };
  delete settings.updateDismissed;
  settings.lastSeenVersion = str(settings.lastSeenVersion).slice(0, 40);
  const w = settings.window;
  settings.window = isObj(w) && Number.isFinite(w.width) && Number.isFinite(w.height)
    ? { x: Number.isFinite(w.x) ? w.x : undefined, y: Number.isFinite(w.y) ? w.y : undefined, width: w.width, height: w.height, maximized: !!w.maximized }
    : null;
  return settings;
}


module.exports = { DEFAULTS, normalizeSettings, UPDATE_REPO };
