'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SECRETS, sampleData } = require('./helpers');
const { buildExport, prepareImport } = require('../src/backup');
const { renameCategory, deleteCategory } = require('../src/categories');

const allSecretsIn = text => Object.values(SECRETS).filter(v => text.includes(v));

test('export without the box: no password, no token anywhere in the file', () => {
  const exp = buildExport(sampleData());
  assert.equal(exp.includesSecrets, false);
  assert.deepEqual(allSecretsIn(JSON.stringify(exp)), []);
  assert.equal(exp.settings.email.smtp.password, '');
  assert.equal(exp.settings.telegram.token, '');
  assert.equal(exp.shows[0].ftp.password, '');
  assert.equal(exp.ftpBookmarks[0].password, '');
  assert.equal(exp.shows[0].ftp.host, 'ftp.example.org');                   // the rest is intact
});

test('export with the box: the secrets are written in plain text (decrypted), and the file says so', () => {
  const exp = buildExport(sampleData(), { includeSecrets: true });
  assert.equal(exp.includesSecrets, true);
  assert.equal(allSecretsIn(JSON.stringify(exp)).length, 4);
  assert.ok(!JSON.stringify(exp).includes('enc:v1:'));
});

test('export does not touch what the app holds', () => {
  const d = sampleData(); buildExport(d);
  assert.equal(d.settings.email.smtp.password, SECRETS.smtp);
});

test('import of a file without secrets keeps this PC\'s secrets for the same server and user', () => {
  const current = sampleData();
  const file = buildExport(sampleData());
  const plan = prepareImport(current, file, { replace: true });
  assert.equal(plan.settings.email.smtp.password, SECRETS.smtp);
  assert.equal(plan.settings.telegram.token, SECRETS.token);
  assert.equal(plan.shows[0].ftp.password, SECRETS.ftp);
  assert.equal(plan.ftpBookmarks[0].password, SECRETS.bm);
  assert.deepEqual(plan.missing, []);
});

test('import on another PC: nothing to keep, the app lists what must be typed again', () => {
  const file = buildExport(sampleData());
  const plan = prepareImport({ settings: {}, shows: [], ftpBookmarks: [] }, file, { replace: true });
  assert.deepEqual(plan.missing.map(m => m.kind).sort(), ['ftp-bookmark', 'ftp-show', 'smtp', 'telegram']);
  assert.equal(plan.missing.find(m => m.kind === 'ftp-show').label, 'Morning');
  // a password for another account is not carried over
  const other = sampleData(); other.settings.email.smtp.user = 'someone-else';
  const p2 = prepareImport(other, file, { replace: true });
  assert.equal(p2.settings.email.smtp.password, '');
  assert.ok(p2.missing.some(m => m.kind === 'smtp'));
});

test('import of an older file (with secrets) still works, and a sealed value from another machine is dropped', () => {
  const old = buildExport(sampleData(), { includeSecrets: true });
  const plan = prepareImport({ settings: {}, shows: [], ftpBookmarks: [] }, old, { replace: true });
  assert.equal(plan.settings.email.smtp.password, SECRETS.smtp);
  assert.deepEqual(plan.missing, []);
  const sealed = buildExport(sampleData(), { includeSecrets: true });
  sealed.settings.telegram.token = 'enc:v1:AAAA';
  const p2 = prepareImport({ settings: {}, shows: [], ftpBookmarks: [] }, sealed, { replace: true });
  assert.equal(p2.settings.telegram.token, '');
  assert.ok(p2.missing.some(m => m.kind === 'telegram'));
});

test('import "add only missing shows": no settings, no bookmarks, only shows this PC does not have', () => {
  const file = buildExport(sampleData(), { includeSecrets: true });
  file.shows.push({ id: 's2', name: 'Evening', category: 'Music' });
  const plan = prepareImport(sampleData(), file, { replace: false });
  assert.deepEqual(plan.shows.map(s => s.id), ['s2']);
  assert.equal(plan.settings, null);
  assert.deepEqual(plan.ftpBookmarks, []);
});

// ── Categories ───────────────────────────────────────────────────────────────

const shows = () => [
  { id: '1', name: 'A', category: 'News' }, { id: '2', name: 'B', category: ' News ' },
  { id: '3', name: 'C', category: 'Music' }, { id: '4', name: 'D' }
];

test('categories: renaming changes every show of the category and moves the chosen colour', () => {
  const r = renameCategory(shows(), { News: '#112233', Music: '#445566' }, 'News', 'Bulletins');
  assert.deepEqual(r.changed.map(s => [s.id, s.category]), [['1', 'Bulletins'], ['2', 'Bulletins']]);
  assert.deepEqual(r.colors, { Bulletins: '#112233', Music: '#445566' });
  assert.equal(r.merged, false);
});

test('categories: renaming into an existing one merges them; the shows take the colour of the target', () => {
  const r = renameCategory(shows(), { News: '#112233', Music: '#445566' }, 'News', 'Music');
  assert.equal(r.merged, true);
  assert.deepEqual(r.changed.map(s => s.category), ['Music', 'Music']);
  assert.deepEqual(r.colors, { Music: '#445566' });
});

test('categories: nothing happens for an empty or unchanged name', () => {
  assert.deepEqual(renameCategory(shows(), {}, 'News', '  ').changed, []);
  assert.deepEqual(renameCategory(shows(), {}, 'News', 'News').changed, []);
});

test('categories: deleting moves the shows to another category, and the colour is removed', () => {
  const r = deleteCategory(shows(), { News: '#112233', Music: '#445566' }, 'News', 'Music');
  assert.deepEqual(r.changed.map(s => [s.id, s.category]), [['1', 'Music'], ['2', 'Music']]);
  assert.deepEqual(r.colors, { Music: '#445566' });
});

test('categories: deleting can move the shows to "no category"; no show is ever left behind', () => {
  const r = deleteCategory(shows(), { News: '#112233' }, 'News', '');
  assert.deepEqual(r.changed.map(s => s.category), ['', '']);
  assert.deepEqual(r.colors, {});
  const all = shows().map(s => r.changed.find(c => c.id === s.id) || s);
  assert.ok(!all.some(s => String(s.category || '').trim() === 'News'));
  assert.deepEqual(deleteCategory(shows(), {}, 'News', 'News').changed, []);   // moving into itself is refused
});
