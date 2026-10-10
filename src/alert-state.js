'use strict';
// What the alerts remember between runs and across restarts: how many runs in a row found the
// source not updated (per show) and which channels were already told about the latest new version.
// It lives in its own file (alert-state.json): it is not a setting, so it is never in an exported backup.
const fs   = require('fs');
const path = require('path');

function createAlertState(file) {
  let data = { noUpdate: {}, update: { version: '', channels: [] } };

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw && typeof raw === 'object') {
        for (const [id, n] of Object.entries(raw.noUpdate || {})) {
          const v = Math.floor(Number(n));
          if (v > 0) data.noUpdate[id] = v;
        }
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
    forgetShow(id) { if (id in data.noUpdate) { delete data.noUpdate[id]; save(); } },
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
