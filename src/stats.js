'use strict';
// Permanent daily counters for the dashboard, independent of the capped per-show history.
// stats.json: { "YYYY-MM-DD": { s, e, u, bytes, dur, dn, shows: { id: [s, e] }, hours: [24] } }
//   s = produced, e = errors, u = no update, bytes = size of produced files,
//   dur/dn = total duration (ms) and count of timed productions
const fs   = require('fs');
const path = require('path');

let _file = null;
let _data = null;

function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function load(dataDir, historyDir) {
  _file = path.join(dataDir, 'stats.json');
  try { _data = JSON.parse(fs.readFileSync(_file, 'utf-8')); }
  catch(_) { _data = null; }
  if (!_data || typeof _data !== 'object') {
    _data = {};
    backfill(historyDir);
    save();
  }
}

// First start with this version: rebuild the counters from the existing run history
function backfill(historyDir) {
  let files = [];
  try { files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')); } catch(_) { return; }
  for (const f of files) {
    const id = f.slice(0, -5);
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8')); } catch(_) {}
    for (const h of list) {
      if (!h || !h.date) continue;
      add(id, new Date(h.date), h.result, h.bytes || 0, h.durationMs || 0, false);
    }
  }
}

function add(showId, date, result, bytes, durationMs, persist = true) {
  const key = dayKey(date);
  const day = _data[key] || (_data[key] = { s: 0, e: 0, u: 0, bytes: 0, dur: 0, dn: 0, shows: {}, hours: new Array(24).fill(0) });
  const per = day.shows[showId] || (day.shows[showId] = [0, 0]);
  if (result === 'ok')             { day.s++; per[0]++; day.hours[date.getHours()]++; }
  else if (result === 'error')     { day.e++; per[1]++; day.hours[date.getHours()]++; }
  else if (result === 'no-update') { day.u++; }
  if (bytes > 0)      day.bytes += bytes;
  if (durationMs > 0) { day.dur += durationMs; day.dn++; }
  if (persist) save();
}

function save() {
  if (!_file) return;
  try { fs.writeFileSync(_file, JSON.stringify(_data), 'utf-8'); } catch(_) {}
}

function all() { return _data || {}; }

module.exports = { load, add, all, dayKey };
