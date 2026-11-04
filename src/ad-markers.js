'use strict';
// Ad break markers (midroll): where each ad break goes in a produced show, and how a
// platform wants to be told about it.
//
// A show made of N source files has N-1 joins. Each join can carry an ad break. The position
// is the sum of the durations of the parts before the join, in milliseconds. The same list of
// positions can be written in more than one format:
//   - "indiplay": a text file next to the audio, same name, extension .mrp, one position in
//     milliseconds per line (IndiPlay.it).
//   - "blubrry":  a comment inside the MP3 (ID3), "mid1 00:02:43.9, mid2 00:04:59.0" (Blubrry).
// Platforms that only take ad breaks from their own web panel cannot be served from here.

const { spawn } = require('child_process');

// `public: false` = written and tested, but not offered yet: the window does not show it and a
// saved configuration naming it falls back to IndiPlay. To switch Blubrry on later: remove the flag
// and the `hidden` on its option in renderer/index.html.
const FORMATS = {
  indiplay: { id: 'indiplay', kind: 'sidecar', ext: 'mrp' },
  blubrry:  { id: 'blubrry',  kind: 'id3',     audioExt: 'mp3', public: false }
};
const DEFAULT_FORMAT = 'indiplay';

const MODES = ['joins', 'interval'];
const DEFAULT_INTERVAL_MIN = 15;
const MAX_INTERVAL_MIN = 240;
const MIN_TAIL_MS = 60 * 1000;   // an automatic break never lands in the last minute of the show

function normalizeConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const minutes = Math.round(Number(c.intervalMinutes));
  return {
    enabled: !!c.enabled,
    format: FORMATS[c.format] && FORMATS[c.format].public !== false ? c.format : DEFAULT_FORMAT,
    // joins: a break at the joins ticked "Ad break after"; interval: one break every N minutes
    mode: MODES.includes(c.mode) ? c.mode : 'joins',
    intervalMinutes: minutes >= 1 ? Math.min(minutes, MAX_INTERVAL_MIN) : DEFAULT_INTERVAL_MIN
  };
}

// Can this format be written for an audio file with this extension?
function formatSupports(format, audioExt) {
  const f = FORMATS[format];
  if (!f) return false;
  if (f.kind === 'id3') return String(audioExt || '').toLowerCase() === f.audioExt;
  return true;
}

/**
 * Positions (ms) of the ad breaks.
 * @param {number[]} durationsMs  duration of every part, in order
 * @param {boolean[]} flags       flags[i] = ad break after part i (the last part never has one)
 */
function offsetsFromParts(durationsMs, flags) {
  const out = [];
  let pos = 0;
  for (let i = 0; i < durationsMs.length - 1; i++) {
    pos += Math.max(0, Number(durationsMs[i]) || 0);
    if (flags[i] !== false) {
      const ms = Math.round(pos);
      if (ms > 0 && out[out.length - 1] !== ms) out.push(ms);
    }
  }
  return out;
}

/**
 * Positions (ms) of a break every `minutes` minutes: N, 2N, 3N... of the whole show, only while
 * at least a minute of audio is left after the break.
 */
function offsetsEveryMinutes(totalMs, minutes) {
  const step = Math.round(Number(minutes) * 60000);
  const out = [];
  if (!(step > 0) || !(totalMs > 0)) return out;
  for (let pos = step; pos <= totalMs - MIN_TAIL_MS; pos += step) out.push(pos);
  return out;
}

// IndiPlay .mrp: one millisecond position per line, LF, final line break.
function formatMrp(offsetsMs) {
  return offsetsMs.map(ms => String(Math.round(ms))).join('\n') + (offsetsMs.length ? '\n' : '');
}

// Blubrry: "mid1 HH:MM:SS.d, mid2 ..." (one decimal, as in the examples of its documentation).
function blubrryTime(ms) {
  const tenths = Math.round(ms / 100);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = Math.floor((tenths % 600) / 10);
  const d = tenths % 10;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${d}`;
}
function formatBlubrry(offsetsMs) {
  return offsetsMs.map((ms, i) => `mid${i + 1} ${blubrryTime(ms)}`).join(', ');
}

// ── Measuring a part ─────────────────────────────────────────────────────────

// Duration in ms from FFmpeg's output: the last "time=HH:MM:SS.cc" of the decode (accurate even
// for files without a reliable header), or the "Duration:" line when there is no progress.
function parseFfmpegDuration(text) {
  const times = [...String(text).matchAll(/time=(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/g)];
  const m = times.length ? times[times.length - 1] : String(text).match(/Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const frac = m[4] ? Number('0.' + m[4]) : 0;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac) * 1000);
}

function measureDurationMs(ffmpegPath, file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-i', file, '-vn', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      const ms = code === 0 ? parseFfmpegDuration(err) : null;
      if (ms == null) reject(new Error(`cannot measure ${file}`));
      else resolve(ms);
    });
  });
}

// Writes the Blubrry comment into an MP3 (stream copy, nothing is re-encoded).
function writeId3Comment(ffmpegPath, inFile, outFile, comment) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-nostdin', '-hide_banner', '-i', inFile, '-c', 'copy', '-map_metadata', '0',
                  '-metadata', `comment=${comment}`, '-id3v2_version', '3', outFile];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit code ${code}: ${err.trim().split('\n').pop()}`)));
  });
}

module.exports = {
  FORMATS, DEFAULT_FORMAT, normalizeConfig, formatSupports,
  MODES, DEFAULT_INTERVAL_MIN, MAX_INTERVAL_MIN, MIN_TAIL_MS,
  offsetsFromParts, offsetsEveryMinutes, formatMrp, formatBlubrry, blubrryTime,
  parseFfmpegDuration, measureDurationMs, writeId3Comment
};
