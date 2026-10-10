'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, freshStore, fakeSafeStorage, SECRETS, sampleData } = require('./helpers');
const i18n = require('../src/i18n');
const notify = require('../src/notify');
const { createAlertState } = require('../src/alert-state');
const { createSecretBox } = require('../src/secrets');

i18n.load('en');

const rawFile = dir => fs.readFileSync(path.join(dir, 'data.json'), 'utf-8');

// ── Alert state that survives a restart ──────────────────────────────────────

function alerterWith(state, settings, sent, extra = {}) {
  return notify.createAlerter({
    getSettings: () => settings, state, sleep: async () => {},
    deps: { sendEmail: async (c, subject) => { sent.push('email:' + subject); }, sendTelegram: async (c, text) => { sent.push('tg:' + text.split('\n')[0]); } },
    ...extra
  });
}

test('alert state: the "source not updated" count is kept after a restart and alerts at the threshold, once', async () => {
  const dir = tmpDir(); const file = path.join(dir, 'alert-state.json');
  const settings = sampleData().settings;
  const sent = [];
  const show = { id: 's1', name: 'Morning' };
  let a = alerterWith(createAlertState(file).load(), settings, sent);
  a.noUpdateRun(show, true); a.noUpdateRun(show, true);                 // 2 runs in a row, below the threshold of 3
  await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 0);
  // restart: a new state object reads the file
  const restarted = createAlertState(file).load();
  assert.equal(restarted.getNoUpdate('s1'), 2);
  a = alerterWith(restarted, settings, sent);
  assert.equal(a.noUpdateRun(show, true), 3);                           // the 3rd run reaches the threshold
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(sent.filter(x => x.startsWith('email:')).length, 1);
  assert.equal(sent.filter(x => x.startsWith('tg:')).length, 0);        // Telegram "not updated" alerts are off in the sample
  // a run that produces a file resets the count, also on disk
  a.noUpdateRun(show, false);
  assert.equal(createAlertState(file).load().getNoUpdate('s1'), 0);
});

test('alert state: a damaged file starts empty; an old show record hands over its count once', () => {
  const dir = tmpDir(); const file = path.join(dir, 'alert-state.json');
  fs.writeFileSync(file, '{ not json');
  const st = createAlertState(file).load();
  assert.equal(st.getNoUpdate('x'), 0);
  const show = { id: 'x', name: 'Old', noUpdateStreak: 5 };
  assert.equal(st.adoptShowStreak(show), true);
  assert.equal('noUpdateStreak' in show, false);
  assert.equal(st.getNoUpdate('x'), 5);
  assert.equal(createAlertState(file).load().getNoUpdate('x'), 5);
  assert.equal(st.adoptShowStreak({ id: 'y' }), false);
});

test('alert state is not part of data.json: nothing about it reaches a backup', () => {
  const { buildExport } = require('../src/backup');
  const exp = JSON.stringify(buildExport(sampleData(), { includeSecrets: true }));
  assert.ok(!/"noUpdateStreak"|alert-state|"update":|"channels"/.test(exp));
});

// ── New version notice ───────────────────────────────────────────────────────

const INFO = { available: true, latest: '26.10.1', current: '26.9.8', notes: 'Alerts rebuilt' };
const URL = 'https://github.com/djgragra/flowcast/releases/tag/v26.10.1';

test('new version: once per version on each channel, also after a restart; a newer version is announced again', async () => {
  const dir = tmpDir(); const file = path.join(dir, 'alert-state.json');
  const settings = sampleData().settings; const sent = []; const desktop = [];
  let a = alerterWith(createAlertState(file).load(), settings, sent, { notifyDesktop: (t) => desktop.push(t) });
  assert.deepEqual((await a.notifyUpdate(INFO, URL)).sort(), ['desktop', 'email', 'telegram']);
  assert.deepEqual(await a.notifyUpdate(INFO, URL), []);                 // same version, next check
  a = alerterWith(createAlertState(file).load(), settings, sent, { notifyDesktop: (t) => desktop.push(t) });
  assert.deepEqual(await a.notifyUpdate(INFO, URL), []);                 // after a restart
  assert.equal(sent.length, 2); assert.equal(desktop.length, 1);
  assert.deepEqual((await a.notifyUpdate({ ...INFO, latest: '26.10.2' }, URL)).sort(), ['desktop', 'email', 'telegram']);
});

test('new version: not announced when the option is off or no channel is on', async () => {
  const dir = tmpDir(); const sent = [];
  const st = createAlertState(path.join(dir, 's.json')).load();
  const base = sampleData().settings;
  assert.deepEqual(await alerterWith(st, { ...base, updateAlert: false }, sent).notifyUpdate(INFO, URL), []);
  const none = { ...base, email: { ...base.email, enabled: false }, telegram: { ...base.telegram, enabled: false } };
  assert.deepEqual(await alerterWith(st, none, sent).notifyUpdate(INFO, URL), []);
  assert.deepEqual(await alerterWith(st, base, sent).notifyUpdate({ ...INFO, available: false }, URL), []);
  assert.equal(sent.length, 0);
});

test('new version: a failed send is marked only after it works, and tried again at the next check; a channel switched on later is told', async () => {
  const dir = tmpDir(); const st = createAlertState(path.join(dir, 's.json')).load();
  const settings = JSON.parse(JSON.stringify(sampleData().settings));
  let emailUp = false; const got = [];
  const a = notify.createAlerter({
    getSettings: () => settings, state: st, sleep: async () => {},
    deps: { sendEmail: async () => { if (!emailUp) throw new Error('smtp down'); got.push('email'); }, sendTelegram: async () => { got.push('tg'); } }
  });
  settings.telegram.enabled = false;                                      // only email is on
  assert.deepEqual((await a.notifyUpdate(INFO, URL)).filter(c => c !== 'desktop'), []);   // 3 attempts, all failed
  assert.deepEqual(st.getUpdateDone('26.10.1'), ['desktop']);            // email NOT marked
  emailUp = true;
  assert.deepEqual((await a.notifyUpdate(INFO, URL)).filter(c => c !== 'desktop'), ['email']);   // next check: sent
  settings.telegram.enabled = true;                                       // switched on afterwards
  assert.deepEqual(await a.notifyUpdate(INFO, URL), ['telegram']);
  assert.deepEqual(got, ['email', 'tg']);
  assert.deepEqual(await a.notifyUpdate(INFO, URL), []);
});

// ── Secrets on disk ──────────────────────────────────────────────────────────

function saveSample(store, dir, safe) {
  store.setSecretBox(createSecretBox(safe));
  store.load();
  const d = sampleData();
  store.saveSettings(d.settings);
  for (const sh of d.shows) store.saveShow(sh);
  for (const bm of d.ftpBookmarks) store.saveFtpBookmark(bm);
}

test('secrets: with a keystore none of the passwords or the token is readable in data.json; reading gives them back', () => {
  const dir = tmpDir(); const store = freshStore(dir);
  saveSample(store, dir, fakeSafeStorage());
  const text = rawFile(dir);
  for (const v of Object.values(SECRETS)) assert.ok(!text.includes(v), 'plain secret found on disk: ' + v);
  assert.ok(text.includes('enc:v1:'));
  assert.ok(!fs.existsSync(path.join(dir, 'data.json.tmp')));
  // a new start reads them back
  const again = freshStore(dir);
  again.setSecretBox(createSecretBox(fakeSafeStorage()));
  again.load();
  assert.equal(again.getSettings().email.smtp.password, SECRETS.smtp);
  assert.equal(again.getSettings().telegram.token, SECRETS.token);
  assert.equal(again.getShow('s1').ftp.password, SECRETS.ftp);
  assert.equal(again.getFtpBookmarks()[0].password, SECRETS.bm);
  assert.equal(again.getSecretStatus().encrypted, true);
});

test('secrets: values saved in plain text by older versions are encrypted at the first start', () => {
  const dir = tmpDir();
  const d = sampleData();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings: d.settings, shows: d.shows, ftpBookmarks: d.ftpBookmarks }));
  assert.ok(rawFile(dir).includes(SECRETS.smtp));
  const store = freshStore(dir);
  store.setSecretBox(createSecretBox(fakeSafeStorage()));
  store.load();
  for (const v of Object.values(SECRETS)) assert.ok(!rawFile(dir).includes(v));
  assert.equal(store.getSettings().email.smtp.password, SECRETS.smtp);   // and the app still sees them
});

test('secrets: without a keystore they are kept as they are and the app can say so', () => {
  const dir = tmpDir(); const store = freshStore(dir);
  saveSample(store, dir, fakeSafeStorage({ available: false }));
  assert.ok(rawFile(dir).includes(SECRETS.smtp));
  assert.equal(store.secretsEncrypted(), false);
  assert.equal(store.getSecretStatus().encrypted, false);
});

test('secrets: values encrypted on another PC cannot be read: they come back empty and are counted', () => {
  const dir = tmpDir(); const store = freshStore(dir);
  saveSample(store, dir, fakeSafeStorage());
  const other = freshStore(dir);
  other.setSecretBox(createSecretBox(fakeSafeStorage({ locked: true })));
  other.load();
  assert.equal(other.getSettings().email.smtp.password, '');
  assert.equal(other.getSecretStatus().unreadable, 4);
});

test('settings: the recipients of older versions (text, one per line) become a clean list', () => {
  const dir = tmpDir();
  const d = sampleData(); d.settings.email.recipients = 'a@example.org\nb@example.org\nnope\na@example.org';
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(d));
  const store = freshStore(dir);
  store.load();
  assert.deepEqual(store.getSettings().email.recipients, ['a@example.org', 'b@example.org']);
  assert.equal(store.getSettings().updateAlert, true);
});
