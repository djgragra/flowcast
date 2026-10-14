// garage-common: backup 1
'use strict';
// Configuration backup (export / import), the common OnAir Garage file (apps/COMMON-FEATURES.md, section 3):
//   { app: "flowcast", version: 1, exportedAt, includesSecrets, settings, shows, ftpBookmarks, emptiedSecrets? }
// Passwords and tokens are written only when the user ticks "Include passwords and tokens"; then they are plain text,
// already decrypted, because an encrypted value cannot be opened on another PC. Without the box the file has no
// secrets and, after an import, the app lists what must be typed again. No Electron, no files: the main process
// asks for the file and applies the plan.
const { isSealed, secretSlots } = require('./secrets');
const { normalizeSettings } = require('./settings');

const BACKUP_APP = 'flowcast';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 5_000_000;
// kept on this PC, not part of the file: what the user was told once, where the window was, which PC this is
const RUNTIME_KEYS = ['updateState', 'lastSeenVersion', 'window', 'installationName'];

const clone = d => JSON.parse(JSON.stringify(d));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

const backupFileName = (now = new Date()) => `${BACKUP_APP}-backup-${now.toISOString().slice(0, 10)}.json`;

// data: { settings, shows, ftpBookmarks } with plain (decrypted) secrets, as the store holds them
function buildExport(data, { includeSecrets = false, now = new Date() } = {}) {
  const out = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    includesSecrets: !!includeSecrets,
    settings: clone(data.settings || {}),
    shows: clone(data.shows || []),
    ftpBookmarks: clone(data.ftpBookmarks || [])
  };
  for (const k of RUNTIME_KEYS) delete out.settings[k];
  if (!includeSecrets) {
    const emptied = [];
    for (const { id, obj, key } of secretSlots(out)) if (obj[key]) { obj[key] = ''; emptied.push(id); }
    if (emptied.length) out.emptiedSecrets = emptied;   // which secrets had a value and were left out
  }
  return out;
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// A secret the file does not carry is kept from what is already on this PC, but only for the same
// server and user: a password for another account would be wrong. The Telegram token is kept.
function keepKnownSecrets(incoming, current) {
  const cur = current || {};
  const curShows = new Map((cur.shows || []).map(s => [s.id, s]));
  const curBms   = new Map((cur.ftpBookmarks || []).map(b => [b.id, b]));
  const cn = (cur.settings && cur.settings.notifications) || {};
  const nn = (incoming.settings && incoming.settings.notifications) || {};

  if (nn.email && !nn.email.pass && cn.email && same(nn.email.host, cn.email.host) && same(nn.email.user, cn.email.user)) {
    nn.email.pass = cn.email.pass || '';
  }
  if (nn.telegram && !nn.telegram.botToken && cn.telegram) nn.telegram.botToken = cn.telegram.botToken || '';
  for (const sh of incoming.shows || []) {
    const old = curShows.get(sh.id);
    if (sh.ftp && !sh.ftp.password && old && old.ftp && same(sh.ftp.host, old.ftp.host) && same(sh.ftp.user, old.ftp.user)) {
      sh.ftp.password = old.ftp.password || '';
    }
  }
  for (const bm of incoming.ftpBookmarks || []) {
    const old = curBms.get(bm.id);
    if (!bm.password && old && same(bm.host, old.host) && same(bm.user, old.user)) bm.password = old.password || '';
  }
}

// What a working configuration needs but does not have, plus the secrets that were left out of the file and are
// still empty (`emptied`: ids from the file's emptiedSecrets): [{ id, kind, label }]
function missingSecrets(data, emptied = []) {
  const missing = [];
  const add = (id, kind, label) => { if (!missing.some(m => m.id === id)) missing.push({ id, kind, label }); };
  const n = (data.settings && data.settings.notifications) || {};
  if (n.email && n.email.user && !n.email.pass) add('email.pass', 'smtp', n.email.host || 'SMTP');
  if (n.telegram && !n.telegram.botToken && (n.telegram.enabled || (n.telegram.recipients || []).length)) add('telegram.botToken', 'telegram', 'Telegram');
  for (const sh of data.shows || []) {
    const f = sh.ftp;
    if (f && f.enabled && f.host && f.user && !f.password) add(`ftp-show:${sh.id}`, 'ftp-show', sh.name || sh.id);
  }
  for (const bm of data.ftpBookmarks || []) {
    if (bm.user && !bm.password) add(`ftp-bookmark:${bm.id}`, 'ftp-bookmark', bm.name || bm.host);
  }
  // a secret the file left out is listed even if the item that holds it is switched off
  const want = new Set(emptied);
  for (const { id, obj, key, kind, label } of secretSlots(data)) if (want.has(id) && !obj[key]) add(id, kind, label);
  return missing;
}

// current: what this PC has; file: the parsed backup (or its text); replace: true = take shows, bookmarks and
// settings from the file; false = add only the shows this PC does not have.
// Returns { ok, settings, shows, ftpBookmarks, missing } or { ok: false, error }. Older files (no `app`,
// `exportDate`, with secrets) work too.
function prepareImport(current, raw, { replace }) {
  let file = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_BACKUP_BYTES) return { ok: false, error: 'too-big' };
    try { file = JSON.parse(raw); } catch(_) { return { ok: false, error: 'invalid' }; }
  }
  if (!isObj(file) || (file.settings !== undefined && !isObj(file.settings))) return { ok: false, error: 'invalid' };
  if (file.app !== undefined && file.app !== BACKUP_APP) return { ok: false, error: 'wrong-app' };

  const incoming = clone({ settings: file.settings, shows: Array.isArray(file.shows) ? file.shows : [], ftpBookmarks: Array.isArray(file.ftpBookmarks) ? file.ftpBookmarks : [] });
  const emptied = new Set(Array.isArray(file.emptiedSecrets) ? file.emptiedSecrets.filter(x => typeof x === 'string') : []);
  // a sealed value cannot be opened here: it is dropped and, like a left-out one, listed to be typed again
  // (settings are shaped first, so old keys such as email.smtp.password are found in their slot)
  if (incoming.settings) {
    for (const k of RUNTIME_KEYS) delete incoming.settings[k];
    normalizeSettings(incoming.settings);   // the function that cleans the saved settings
  }
  for (const { id, obj, key } of secretSlots(incoming)) if (isSealed(obj[key])) { obj[key] = ''; emptied.add(id); }
  keepKnownSecrets(incoming, current);

  const have = new Set(((current && current.shows) || []).map(s => s.id));
  let result;
  if (replace) {
    result = { settings: incoming.settings || null, shows: incoming.shows, ftpBookmarks: incoming.ftpBookmarks };
    if (result.settings) {
      const cs = (current && current.settings) || {};
      for (const k of RUNTIME_KEYS) if (cs[k] !== undefined) result.settings[k] = cs[k];
    }
  } else {
    result = { settings: null, shows: incoming.shows.filter(s => !have.has(s.id)), ftpBookmarks: [] };
  }
  result.missing = missingSecrets({ settings: result.settings, shows: result.shows, ftpBookmarks: result.ftpBookmarks }, [...emptied]);
  result.ok = true;
  return result;
}

module.exports = { BACKUP_APP, BACKUP_VERSION, MAX_BACKUP_BYTES, RUNTIME_KEYS, backupFileName, buildExport, prepareImport, missingSecrets };
