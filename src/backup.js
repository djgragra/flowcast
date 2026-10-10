'use strict';
// Configuration backup (export / import). Passwords and tokens are written only when the user ticks
// "Include passwords and tokens" (apps/STANDARD.md, "Settings"); then they are plain text, already
// decrypted, because an encrypted value cannot be opened on another PC. Without the box the file
// has no secrets and, after an import, the app lists what must be typed again.
const { isSealed, secretSlots } = require('./secrets');

const clone = d => JSON.parse(JSON.stringify(d));

// data: { settings, shows, ftpBookmarks } with plain (decrypted) secrets, as the store holds them
function buildExport(data, { includeSecrets = false, now = new Date() } = {}) {
  const out = {
    version: 1,
    exportDate: now.toISOString(),
    includesSecrets: !!includeSecrets,
    settings: clone(data.settings || {}),
    shows: clone(data.shows || []),
    ftpBookmarks: clone(data.ftpBookmarks || [])
  };
  if (!includeSecrets) {
    for (const { obj, key } of secretSlots(out)) if (obj[key]) obj[key] = '';
  }
  return out;
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// A secret the file does not carry is kept from what is already on this PC, but only for the same
// server and user: a password for another account would be wrong.
function keepKnownSecrets(incoming, current) {
  const cur = current || {};
  const curShows = new Map((cur.shows || []).map(s => [s.id, s]));
  const curBms   = new Map((cur.ftpBookmarks || []).map(b => [b.id, b]));
  const cs = cur.settings || {};
  const is = incoming.settings || {};

  if (is.email && is.email.smtp && !is.email.smtp.password && cs.email && cs.email.smtp
      && same(is.email.smtp.host, cs.email.smtp.host) && same(is.email.smtp.user, cs.email.smtp.user)) {
    is.email.smtp.password = cs.email.smtp.password || '';
  }
  if (is.telegram && !is.telegram.token && cs.telegram) is.telegram.token = cs.telegram.token || '';
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

// What a working configuration needs but does not have: [{ kind, label }]
function missingSecrets(data) {
  const missing = [];
  const s = data.settings;
  if (s && s.email && s.email.smtp && s.email.smtp.user && !s.email.smtp.password) {
    missing.push({ kind: 'smtp', label: s.email.smtp.host || 'SMTP' });
  }
  if (s && s.telegram && !s.telegram.token && (s.telegram.enabled || (s.telegram.recipients || []).length)) {
    missing.push({ kind: 'telegram', label: 'Telegram' });
  }
  for (const sh of data.shows || []) {
    const f = sh.ftp;
    if (f && f.enabled && f.host && f.user && !f.password) missing.push({ kind: 'ftp-show', label: sh.name || sh.id });
  }
  for (const bm of data.ftpBookmarks || []) {
    if (bm.user && !bm.password) missing.push({ kind: 'ftp-bookmark', label: bm.name || bm.host });
  }
  return missing;
}

// current: what this PC has; file: the parsed backup; replace: true = take shows, bookmarks and
// settings from the file; false = add only the shows this PC does not have.
// Returns what to save, and the secrets that stay empty. Files of older versions (with secrets) work too.
function prepareImport(current, file, { replace }) {
  const incoming = clone({ settings: file.settings, shows: file.shows || [], ftpBookmarks: file.ftpBookmarks || [] });
  // sealed values come from a file written by something else: they cannot be opened here
  for (const { obj, key } of secretSlots(incoming)) if (isSealed(obj[key])) obj[key] = '';
  keepKnownSecrets(incoming, current);

  const have = new Set(((current && current.shows) || []).map(s => s.id));
  const result = replace
    ? { settings: incoming.settings || null, shows: incoming.shows, ftpBookmarks: incoming.ftpBookmarks }
    : { settings: null, shows: incoming.shows.filter(s => !have.has(s.id)), ftpBookmarks: [] };
  result.missing = missingSecrets({ settings: result.settings, shows: result.shows, ftpBookmarks: result.ftpBookmarks });
  return result;
}

module.exports = { buildExport, prepareImport, missingSecrets };
