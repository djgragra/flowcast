'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpDir, freshStore } = require('./helpers');
const am = require('../src/ad-markers');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
const haveFfmpeg = !spawnSync('ffmpeg', ['-version']).error && !spawnSync('ffprobe', ['-version']).error;

test('ad breaks: positions are the sum of the parts before each selected join; the last part never has one', () => {
  assert.deepEqual(am.offsetsFromParts([1000, 2000, 3000, 4000], [true, true, true, true]), [1000, 3000, 6000]);
  assert.deepEqual(am.offsetsFromParts([1000, 2000, 3000, 4000], [true, false, true, true]), [1000, 6000]);
  assert.deepEqual(am.offsetsFromParts([1000, 2000, 3000, 4000], [false, false, false, true]), []);
  assert.deepEqual(am.offsetsFromParts([5000], [true]), []);
  assert.deepEqual(am.offsetsFromParts([1000.4, 2000.4, 9], [true, true, true]), [1000, 3001]);
  assert.deepEqual(am.offsetsFromParts([0, 0, 500, 9], [true, true, true]), [500], 'empty parts give no duplicate or zero position');
});

test('ad breaks: IndiPlay .mrp is one millisecond position per line, LF, as in the sample file from IndiPlay', () => {
  assert.equal(am.formatMrp([163950, 299083, 500481]), '163950\n299083\n500481\n');
  assert.equal(am.formatMrp([]), '');
});

test('ad breaks: Blubrry comment uses mid1, mid2... with HH:MM:SS and one decimal', () => {
  assert.equal(am.blubrryTime(163950), '00:02:44.0');
  assert.equal(am.blubrryTime(163940), '00:02:43.9');
  assert.equal(am.blubrryTime(3600000 + 61000 + 500), '01:01:01.5');
  assert.equal(am.blubrryTime(59999), '00:01:00.0', 'rounding carries into the seconds');
  assert.equal(am.formatBlubrry([266500, 4966300]), 'mid1 00:04:26.5, mid2 01:22:46.3');
});

test('ad breaks: configuration defaults (off, IndiPlay), Blubrry is written but not offered yet, and which formats fit which audio', () => {
  assert.deepEqual(am.normalizeConfig(undefined), { enabled: false, format: 'indiplay' });
  assert.deepEqual(am.normalizeConfig({ enabled: true, format: 'nope' }), { enabled: true, format: 'indiplay' });
  assert.deepEqual(am.normalizeConfig({ enabled: true, format: 'blubrry' }), { enabled: true, format: 'indiplay' }, 'not public yet: falls back to IndiPlay');
  assert.equal(am.formatSupports('indiplay', 'wav'), true);
  assert.equal(am.formatSupports('blubrry', 'mp3'), true);
  assert.equal(am.formatSupports('blubrry', 'aac'), false);
  assert.equal(am.formatSupports('other', 'mp3'), false);
});

test('ad breaks: FFmpeg duration is read from the last progress time or the Duration line', () => {
  assert.equal(am.parseFfmpegDuration('size=N/A time=00:00:01.00 bitrate=N/A\nsize=N/A time=00:02:43.95 bitrate=N/A'), 163950);
  assert.equal(am.parseFfmpegDuration('  Duration: 01:00:00.50, start: 0.000000'), 3600500);
  assert.equal(am.parseFfmpegDuration('nothing'), null);
});

test('ad breaks: a wav entry is "midroll after this file" by default; old shows and strings keep working', () => {
  const src = read('src/processor.js');
  assert.match(src, /midroll: entry\.midroll !== false/);
  assert.match(src, /typeof entry === 'string'\) return \{ path: entry, check: true, midroll: true \}/);
});

test('ad breaks: the window has the switch, the format, and the per-file box; the box is off the last row', () => {
  const html = read('renderer/index.html');
  assert.match(html, /id="f-markers-enabled"/);
  assert.match(html, /id="f-markers-format"/);
  assert.match(html, /<option value="indiplay"/);
  assert.match(html, /<option value="blubrry"[^>]*\bhidden\b/, 'Blubrry stays in the page but hidden');
  assert.match(html, /id="markers-format-field" style="display:none"/);
  const js = read('renderer/renderer.js');
  assert.match(js, /midroll: row\.querySelector\('\.wav-midroll'\)\.checked/);
  assert.match(js, /show\.adMarkers = /);
  assert.match(read('renderer/style.css'), /\.wav-row:last-child \.wav-midroll-label\s*\{[^}]*visibility:\s*hidden/);
});

// ── the whole production with real FFmpeg ───────────────────────────────────

function makeTone(ffmpegDir, name, seconds, freq) {
  const out = path.join(ffmpegDir, name);
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-ar', '44100', '-ac', '2', out]);
  assert.equal(r.status, 0, String(r.stderr));
  return out;
}

async function produce(adMarkers, outputFormat = 'mp3', midroll = [true, false, true, true]) {
  const dir = tmpDir();
  const store = freshStore(path.join(dir, 'data'));
  const processor = require('../src/processor');
  const src = path.join(dir, 'src'); fs.mkdirSync(src);
  const secs = [2, 3, 1.5, 1];
  const wavFiles = secs.map((s, i) => ({ path: makeTone(src, `p${i}.wav`, s, 300 + i * 100), check: false, midroll: midroll[i] }));
  const out = path.join(dir, 'out');
  const show = { id: 's1', name: 'Test', slug: 'prog', outputFormat, bitrate: '128k', wavFiles, outputFolder: out, adMarkers };
  const result = await processor.processShow(show, () => {}, () => {}, true, false);
  return { dir, out, result, store };
}

test('production: IndiPlay writes <name>.mrp next to the audio with the positions of the selected joins', { skip: !haveFfmpeg && 'ffmpeg not installed' }, async () => {
  const { out, result } = await produce({ enabled: true, format: 'indiplay' });
  assert.equal(result.markersResult, 'ok');
  assert.match(result.filename, /^prog_.*\.mp3$/);
  assert.equal(result.markerName, result.filename.replace(/\.mp3$/, '.mrp'));
  assert.ok(fs.existsSync(result.markerFile));
  const files = fs.readdirSync(out).sort();
  assert.deepEqual(files, [result.markerName, result.filename].sort(), 'both files reach the output folder');
  const text = fs.readFileSync(path.join(out, result.markerName), 'utf-8');
  assert.match(text, /^\d+\n\d+\n$/, 'two selected joins, one number per line, LF');
  const [a, b] = text.trim().split('\n').map(Number);
  assert.ok(Math.abs(a - 2000) < 100, `first break near 2.0 s, got ${a}`);
  assert.ok(Math.abs(b - 6500) < 150, `second break near 6.5 s (the join after the 2nd file is off), got ${b}`);
});

test('production: a saved Blubrry choice is ignored while Blubrry is not offered: IndiPlay is used', { skip: !haveFfmpeg && 'ffmpeg not installed' }, async () => {
  const { result } = await produce({ enabled: true, format: 'blubrry' });
  assert.match(result.markerName || '', /\.mrp$/);
});

test('production: markers off (default) or a single file write nothing', { skip: !haveFfmpeg && 'ffmpeg not installed' }, async () => {
  const off = await produce(undefined);
  assert.equal(off.result.markerFile, null);
  assert.equal(off.result.markersResult, 'skipped');
  assert.deepEqual(fs.readdirSync(off.out), [off.result.filename]);
  const none = await produce({ enabled: true, format: 'indiplay' }, 'mp3', [false, false, false, true]);
  assert.equal(none.result.markerFile, null);
});

test('production: Blubrry (switched on for the test) writes the positions in the MP3 comment and nothing next to it', { skip: !haveFfmpeg && 'ffmpeg not installed' }, async () => {
  am.FORMATS.blubrry.public = true;
  let out, result;
  try { ({ out, result } = await produce({ enabled: true, format: 'blubrry' })); } finally { am.FORMATS.blubrry.public = false; }
  assert.equal(result.markersResult, 'ok');
  assert.equal(result.markerFile, null);
  assert.deepEqual(fs.readdirSync(out), [result.filename]);
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'default=nw=1:nk=1', path.join(out, result.filename)]);
  const comment = String(r.stdout).trim();
  assert.match(comment, /^mid1 00:00:0[12]\.\d, mid2 00:00:0[67]\.\d$/);
});

test('production: Blubrry with a non-MP3 output is refused with a clear log and an error result, the audio still goes out', { skip: !haveFfmpeg && 'ffmpeg not installed' }, async () => {
  am.FORMATS.blubrry.public = true;
  let out, result;
  try { ({ out, result } = await produce({ enabled: true, format: 'blubrry' }, 'aac')); } finally { am.FORMATS.blubrry.public = false; }
  assert.equal(result.markersResult, 'error');
  assert.deepEqual(fs.readdirSync(out), [result.filename]);
});

test('production: the marker file goes to FTP before the audio, and a failed upload of either is an FTP error', () => {
  const main = read('main.js');
  assert.ok(main.indexOf('result.markerFile, logFn') < main.indexOf('result.file, logFn'));
  assert.match(main, /markers: result\.markersResult/);
});
