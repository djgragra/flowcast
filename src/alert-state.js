// garage-common: alert-state 1
'use strict';
// What the alerts remember between runs and across restarts: how many runs in a row found the
// source not updated (per show), which alerts were already sent for a show (so a "back to normal" follows only
// an alert that went out), the last summary sent and which channels were already told about the latest new version.
// It lives in its own file (alert-state.json): it is not a setting, so it is never in an exported backup.
const fs   = require('fs');
const path = require('path');

function createAlertState(file) {
  let data = { noUpdate: {}, alerted: {}, digest: '', update: { version: '', channels: [] } };

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw && typeof raw === 'object') {
        for (const [id, n] of Object.entries(raw.noUpdate || {})) {
          const v = Math.floor(Number(n));
          if (v > 0) data.noUpdate[id] = v;
        }
        for (const [id, a] of Object.entries(raw.alerted || {})) {
          if (a && typeof a === 'object' && (a.error || a.noUpdate)) data.alerted[id] = { error: !!a.error, noUpdate: !!a.noUpdate };
        }
        if (typeof raw.digest === 'string') data.digest = raw.digest;
        const u = raw.update || {};
        if (typeof u.version === 'string') {
          data.update = { version: u.version, channels: (Array.isArray(u.channels) ? u.channels : []).filter(c => typeof c === 'string') };
        }
      }
    } catch(_) { /* no file yet, or damaged: start empty */ }
    return api;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf-8');
      fs.renameSync(tmp, file);
    } catch(_) { /* the alert still goes out; it may be repeated after a restart */ }
  }

  const api = {
    load,
    getNoUpdate: id => data.noUpdate[id] || 0,
    setNoUpdate(id, n) {
      if (n > 0) data.noUpdate[id] = n; else delete data.noUpdate[id];
      save();
    },
    forgetShow(id) {
      if (id in data.noUpdate || id in data.alerted) { delete data.noUpdate[id]; delete data.alerted[id]; save(); }
    },
    // alerts already sent for a show: { error, noUpdate } (cleared when the "back to normal" message went out)
    getAlerted: id => ({ error: !!(data.alerted[id] && data.alerted[id].error), noUpdate: !!(data.alerted[id] && data.alerted[id].noUpdate) }),
    setAlerted(id, kind, on) {
      const a = data.alerted[id] || { error: false, noUpdate: false };
      a[kind] = !!on;
      if (a.error || a.noUpdate) data.alerted[id] = a; else delete data.alerted[id];
      save();
    },
    clearAlerted(id) { if (id in data.alerted) { delete data.alerted[id]; save(); } },
    // last summary sent, as "YYYY-MM-DD HH:MM" of the time it was due
    getDigestSent: () => data.digest,
    markDigestSent(key) { if (String(key) > data.digest) { data.digest = String(key); save(); } },
    // channels already told about this version
    getUpdateDone: version => (data.update.version === version ? [...data.update.channels] : []),
    markUpdateDone(version, channel) {
      if (data.update.version !== version) data.update = { version, channels: [] };
      if (!data.update.channels.includes(channel)) data.update.channels.push(channel);
      save();
    },
    // Old versions kept the streak inside the show record: move it here, once.
    // Returns true when a show had it (the caller then saves the show without it).
    adoptShowStreak(show) {
      if (!show || !('noUpdateStreak' in show)) return false;
      const n = Math.floor(Number(show.noUpdateStreak));
      if (n > 0 && !(show.id in data.noUpdate)) { data.noUpdate[show.id] = n; save(); }
      delete show.noUpdateStreak;
      return true;
    },
    snapshot: () => JSON.parse(JSON.stringify(data))
  };
  return api;
}

module.exports = { createAlertState };
