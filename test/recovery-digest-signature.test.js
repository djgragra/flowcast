'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tmpDir, freshStore, fakeSafeStorage, SECRETS, sampleData } = require('./helpers');
const i18n = require('../src/i18n');
const notify = require('../src/notify');
const { createAlertState } = require('../src/alert-state');
const { createSecretBox, secretSlots } = require('../src/secrets');
const { normalizeSettings } = require('../src/settings');
const { buildExport, prepareImport } = require('../src/backup');
const { dueSlot, passedSlotKey, buildDigest } = require('../src/digest');
const { createLogger, logFileRe } = require('../src/logs');
const { buildSupportInfo } = require('../src/support');

i18n.load('en');

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const show = { id: 's1', name: 'Morning' };

function rig({ settings = sampleData().settings, file = path.join(tmpDir(), 'alert-state.json'), failEmail = false, extra = {} } = {}) {
  const sent = [];
  const state = createAlertState(file).load();
  const alerter = notify.createAlerter({
    getSettings: () => settings, state, sleep: async () => {},
    getPrefix: () => '[FlowCast · Studio 2]',
    deps: {
      sendEmail: async (c, subject, body) => { if (failEmail) throw new Error('smtp down'); sent.push({ ch: 'email', subject, body }); },
      sendTelegram: async (c, text, f, prefix) => { sent.push({ ch: 'tg', text, prefix }); }
    },
    ...extra
  });
  return { sent, state, alerter, settings, file };
}

// ── Installation name ────────────────────────────────────────────────────────

test('installation name: every alert starts with [FlowCast · name]; the computer name is the default', async () => {
  assert.equal(notify.alertPrefix({ installationName: 'Studio 2' }, 'PC-7'), '[FlowCast · Studio 2]');
  assert.equal(notify.alertPrefix({ installationName: '  ' }, 'PC-7'), '[FlowCast · PC-7]');
  const r = rig();
  await r.alerter.alertShow(show, 'error', { message: 'boom' });
  const mail = r.sent.find(x => x.ch === 'email'), tg = r.sent.find(x => x.ch === 'tg');
  assert.match(mail.subject, /^\[FlowCast · Studio 2\] ⛔ Error: Morning$/);
  assert.match(tg.text, /^\[FlowCast · Studio 2\] ⛔ Error: Morning/);
  assert.equal(tg.prefix, '[FlowCast · Studio 2]');
});

// ── Recovery ─────────────────────────────────────────────────────────────────

test('recovery: after an error alert, the first good production sends one "back to normal" and only one', async () => {
  const r = rig();
  await r.alerter.alertShow(show, 'error', { message: 'boom' });
  assert.equal(r.state.getAlerted('s1').error, true);
  r.sent.length = 0;
  await r.alerter.recovered(show);
  assert.equal(r.sent.length, 2);                                       // email + Telegram
  assert.match(r.sent[0].subject || r.sent[0].text, /Back to normal: Morning/);
  assert.equal(r.state.getAlerted('s1').error, false);
  await r.alerter.recovered(show);                                      // the next good run: nothing more
  assert.equal(r.sent.length, 2);
});

test('recovery: no alert before = no message', async () => {
  const r = rig();
  assert.equal(await r.alerter.recovered(show), null);
  assert.equal(r.sent.length, 0);
});

test('recovery: follows an alert that was sent before a restart', async () => {
  const first = rig();
  await first.alerter.alertShow(show, 'error', {});
  const again = rig({ file: first.file });                              // new process, same alert-state.json
  await again.alerter.recovered(show);
  assert.equal(again.sent.length, 2);
});

test('recovery: "source not updated" -> updated file is a recovery too (and one message for both)', async () => {
  const r = rig();
  for (let i = 0; i < 3; i++) r.alerter.noUpdateRun(show, true);
  await flush();
  assert.equal(r.state.getAlerted('s1').noUpdate, true);
  await r.alerter.alertShow(show, 'error', {});
  r.sent.length = 0;
  await r.alerter.recovered(show);
  const mail = r.sent.find(x => x.ch === 'email');
  assert.match(mail.body, /working again/);
  assert.match(mail.body, /updated again/);
  assert.equal(r.sent.length, 2);
  assert.deepEqual(r.state.getAlerted('s1'), { error: false, noUpdate: false });
});

test('recovery: an error alert that never went out (every channel failed) leaves nothing to recover from', async () => {
  const r = rig({ failEmail: true, settings: (() => { const s = sampleData().settings; s.notifications.telegram.enabled = false; return s; })() });
  await r.alerter.alertShow(show, 'error', {});
  assert.equal(r.state.getAlerted('s1').error, false);
  assert.equal(await r.alerter.recovered(show), null);
});

test('recovery: a channel that fails does not stop the other, and a failed recovery is tried again at the next good run', async () => {
  const r = rig();
  await r.alerter.alertShow(show, 'error', {});
  r.sent.length = 0;
  const failing = rig({ file: r.file, failEmail: true, settings: (() => { const s = sampleData().settings; return s; })() });
  await failing.alerter.recovered(show);
  assert.equal(failing.sent.filter(x => x.ch === 'tg').length, 1);      // Telegram went out although email failed
  assert.equal(failing.state.getAlerted('s1').error, false);            // one channel delivered: done
});

test('recovery: the channel switch is respected; with every switch off the old alarm is forgotten', async () => {
  const s = sampleData().settings;
  const r = rig({ settings: s });
  await r.alerter.alertShow(show, 'error', {});
  s.notifications.email.onRecovery = false; s.notifications.telegram.onRecovery = false;
  r.sent.length = 0;
  await r.alerter.recovered(show);
  assert.equal(r.sent.length, 0);
  assert.deepEqual(r.state.getAlerted('s1'), { error: false, noUpdate: false });
});

// ── Summary (digest) ─────────────────────────────────────────────────────────

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0);   // local time
const D = (extra = {}) => ({ enabled: true, frequency: 'daily', times: ['08:00'], when: 'always', ...extra });

test('digest: due once per time and day, also after a restart; a PC that was off sends at the first start after it', () => {
  assert.equal(dueSlot(D(), at(2026, 10, 14, 7, 59), ''), null);
  assert.equal(dueSlot(D(), at(2026, 10, 14, 8, 0), ''), '2026-10-14 08:00');
  assert.equal(dueSlot(D(), at(2026, 10, 14, 8, 1), '2026-10-14 08:00'), null);         // already sent
  assert.equal(dueSlot(D(), at(2026, 10, 14, 11, 40), ''), '2026-10-14 08:00');          // PC was off at 08:00
  assert.equal(dueSlot(D(), at(2026, 10, 15, 8, 0), '2026-10-14 08:00'), '2026-10-15 08:00');
  assert.equal(dueSlot(D({ enabled: false }), at(2026, 10, 14, 9, 0), ''), null);
  const two = D({ times: ['08:00', '18:00'] });
  assert.equal(dueSlot(two, at(2026, 10, 14, 18, 5), '2026-10-14 08:00'), '2026-10-14 18:00');
  assert.equal(dueSlot(two, at(2026, 10, 14, 18, 5), '2026-10-14 18:00'), null);
  assert.equal(passedSlotKey(['08:00', '18:00'], at(2026, 10, 14, 12, 0)), '2026-10-14 08:00');
});

test('digest: weekly only on Monday', () => {
  const w = D({ frequency: 'weekly' });
  assert.equal(dueSlot(w, at(2026, 10, 12, 8, 0), ''), '2026-10-12 08:00');             // Monday
  assert.equal(dueSlot(w, at(2026, 10, 13, 8, 0), ''), null);                           // Tuesday
  assert.equal(dueSlot(w, at(2026, 10, 18, 9, 0), ''), null);                           // Sunday
});

const hist = (date, result, details = null) => ({ date: date.toISOString(), result, details });

test('digest text: per show produced / failed / not updated / last production; "everything is working" when all is fine', () => {
  const shows = [{ id: 'a', name: 'Morning' }, { id: 'b', name: 'Jazz' }, { id: 'c', name: 'Off', enabled: false }];
  const now = at(2026, 10, 14, 8, 0);
  const h = {
    a: [hist(at(2026, 10, 14, 7, 10), 'ok'), hist(at(2026, 10, 13, 7, 10), 'ok')],
    b: [hist(at(2026, 10, 14, 6, 0), 'ok', { ftp: 'error' }), hist(at(2026, 10, 13, 21, 0), 'no-update')],
    c: [hist(at(2026, 10, 14, 5, 0), 'error')]
  };
  const day = buildDigest(shows, h, { now, days: 1 });
  assert.match(day.subject, /Daily summary/);
  assert.match(day.body, /Morning: 1 produced, 0 failed, 0 source not updated/);          // yesterday's run is outside 24 h
  assert.match(day.body, /Jazz: 0 produced, 1 failed, 1 source not updated/);             // a failed FTP step counts as a failure
  assert.ok(!/Off/.test(day.body));                                                      // switched-off shows are not listed
  assert.equal(day.problems, 1);
  assert.match(day.body, /1 show\(s\) need attention/);
  const week = buildDigest(shows, h, { now, days: 7 });
  assert.match(week.subject, /Weekly summary/);
  assert.match(week.body, /Morning: 2 produced/);
  const quiet = buildDigest([shows[0]], { a: h.a }, { now, days: 1 });
  assert.equal(quiet.problems, 0);
  assert.match(quiet.body, /Everything is working/);
});

function digestRig(extraSettings = {}, hists = {}) {
  const settings = sampleData().settings;
  settings.digest = D(extraSettings);
  return rig({ settings, extra: { getShows: () => [{ id: 'a', name: 'Morning' }], readHistory: id => hists[id] || [], now: () => at(2026, 10, 14, 8, 0) } });
}

test('digest: sent once per day on the channels that are on; not again after a restart; nothing when the channels are off', async () => {
  const r = digestRig({}, { a: [hist(at(2026, 10, 14, 7, 0), 'ok')] });
  await r.alerter.digestTick(at(2026, 10, 14, 8, 0));
  assert.equal(r.sent.length, 2);
  assert.match(r.sent[0].subject, /^\[FlowCast · Studio 2\] Daily summary$/);
  await r.alerter.digestTick(at(2026, 10, 14, 8, 1));
  assert.equal(r.sent.length, 2);
  const restarted = rig({ file: r.file, settings: r.settings, extra: { getShows: () => [{ id: 'a', name: 'Morning' }], readHistory: () => [] } });
  await restarted.alerter.digestTick(at(2026, 10, 14, 9, 0));
  assert.equal(restarted.sent.length, 0);
  // every channel off: nothing is sent, and the time counts as done (switching a channel on later does not flood)
  const off = digestRig();
  off.settings.notifications.email.enabled = false; off.settings.notifications.telegram.enabled = false;
  await off.alerter.digestTick(at(2026, 10, 14, 8, 0));
  assert.equal(off.sent.length, 0);
  assert.equal(off.state.getDigestSent(), '2026-10-14 08:00');
});

test('digest: "only if there is something to report" is respected; "Send now" always sends', async () => {
  const r = digestRig({ when: 'problems' }, { a: [hist(at(2026, 10, 14, 7, 0), 'ok')] });
  await r.alerter.digestTick(at(2026, 10, 14, 8, 0));
  assert.equal(r.sent.length, 0);
  const now = await r.alerter.sendDigest({ force: true });
  assert.equal(now.skipped, false);
  assert.equal(r.sent.length, 2);
  const bad = digestRig({ when: 'problems' }, { a: [hist(at(2026, 10, 14, 7, 0), 'error')] });
  await bad.alerter.digestTick(at(2026, 10, 14, 8, 0));
  assert.equal(bad.sent.length, 2);
});

test('digest: a summary that cannot be delivered is tried again, three rounds at most', async () => {
  const r = digestRig({}, {});
  const bad = rig({ settings: (() => { const s = sampleData().settings; s.digest = D(); s.notifications.telegram.enabled = false; return s; })(), failEmail: true,
    extra: { getShows: () => [{ id: 'a', name: 'Morning' }], readHistory: () => [] } });
  for (let i = 0; i < 3; i++) await bad.alerter.digestTick(at(2026, 10, 14, 8, i));
  assert.equal(bad.state.getDigestSent(), '2026-10-14 08:00');
  assert.ok(r);
});

// ── Settings: old keys are read, the common shape is written ─────────────────

test('settings: FlowCast 26.10.1 keys (email.smtp.*, telegram.token) become notifications.* and the old ones are gone', () => {
  const s = normalizeSettings({
    email: { enabled: true, smtp: { host: 'h', port: 465, user: 'u', password: 'p4ss', secure: true, allowSelfSigned: true }, from: 'f@x.org',
             recipients: 'a@x.org\nb@x.org', onError: false, onNoUpdate: true, noUpdateStreakThreshold: 5 },
    telegram: { enabled: true, token: '1:abc', chatId: '77', onError: true, onNoUpdate: false },
    updateDismissed: '26.10.1'
  });
  assert.equal(s.email, undefined); assert.equal(s.telegram, undefined);
  const e = s.notifications.email, g = s.notifications.telegram;
  assert.deepEqual([e.host, e.port, e.secure, e.user, e.pass, e.allowSelfSigned, e.from], ['h', 465, true, 'u', 'p4ss', true, 'f@x.org']);
  assert.deepEqual(e.recipients, ['a@x.org', 'b@x.org']);
  assert.deepEqual([e.onError, e.onNoUpdate, e.noUpdateStreakThreshold, e.onRecovery], [false, true, 5, true]);
  assert.equal(g.botToken, '1:abc'); assert.deepEqual(g.recipients, [{ chatId: '77', note: '' }]);
  assert.equal(s.updateDismissed, undefined); assert.equal(s.updateState.skipVersion, '26.10.1');
  assert.equal(s.digest.enabled, false); assert.deepEqual(s.digest.times, ['08:00']);
  // the new shape passes through unchanged
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(s))), s);
});

test('settings: a 26.10.1 data.json (sealed secrets under the old keys) opens, moves to the new shape and is saved sealed', () => {
  const dir = tmpDir();
  const box = createSecretBox(fakeSafeStorage());
  const old = { settings: { email: { enabled: true, smtp: { host: 'h', user: 'u', password: box.seal(SECRETS.smtp) }, recipients: ['a@x.org'] },
                            telegram: { enabled: true, token: box.seal(SECRETS.token), recipients: [{ chatId: '1', note: '' }] } },
                shows: [], ftpBookmarks: [] };
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(old));
  const store = freshStore(dir);
  store.setSecretBox(box);
  store.load();
  assert.equal(store.getSettings().notifications.email.pass, SECRETS.smtp);
  assert.equal(store.getSettings().notifications.telegram.botToken, SECRETS.token);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  assert.equal(disk.settings.email, undefined);
  assert.ok(disk.settings.notifications.email.pass.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(disk).includes(SECRETS.smtp));
});

// ── Backup: the common file ──────────────────────────────────────────────────

test('backup: the file has app, version, exportedAt; emptiedSecrets names what was left out', () => {
  const exp = buildExport(sampleData(), { now: new Date('2026-10-14T10:00:00Z') });
  assert.equal(exp.app, 'flowcast'); assert.equal(exp.version, 1); assert.equal(exp.exportedAt, '2026-10-14T10:00:00.000Z');
  assert.deepEqual(exp.emptiedSecrets.sort(), ['email.pass', 'ftp-bookmark:b1', 'ftp-show:s1', 'telegram.botToken']);
  assert.equal(buildExport(sampleData(), { includeSecrets: true }).emptiedSecrets, undefined);
  assert.deepEqual(secretSlots(sampleData()).map(s => s.id).sort(), ['email.pass', 'ftp-bookmark:b1', 'ftp-show:s1', 'telegram.botToken']);
});

test('backup: what stays on this PC (update choices, window, installation name) is not in the file and not replaced by an import', () => {
  const d = sampleData();
  Object.assign(d.settings, { installationName: 'Studio 2', lastSeenVersion: '26.10.1', window: { width: 1, height: 2 }, updateState: { skipVersion: '9', remindUntil: 0, lastCheck: null } });
  const exp = buildExport(d);
  for (const k of ['installationName', 'lastSeenVersion', 'window', 'updateState']) assert.equal(k in exp.settings, false, k);
  const cur = sampleData(); cur.settings.installationName = 'Here'; cur.settings.window = { width: 5, height: 6 };
  const plan = prepareImport(cur, buildExport(sampleData(), { includeSecrets: true }), { replace: true });
  assert.equal(plan.settings.installationName, 'Here'); assert.deepEqual(plan.settings.window, { width: 5, height: 6 });
});

test('backup: the file of another app is refused; a file without `app` (older versions) and with exportDate still imports', () => {
  const file = buildExport(sampleData(), { includeSecrets: true });
  assert.deepEqual(prepareImport(sampleData(), { ...file, app: 'g-downloader' }, { replace: true }), { ok: false, error: 'wrong-app' });
  assert.equal(prepareImport(sampleData(), '{ nope', { replace: true }).error, 'invalid');
  assert.equal(prepareImport(sampleData(), 'x'.repeat(6_000_000), { replace: true }).error, 'too-big');
  const old = { ...file, exportDate: file.exportedAt }; delete old.app; delete old.exportedAt;
  assert.equal(prepareImport(sampleData(), old, { replace: true }).ok, true);
});

test('backup: a 26.10.1 file (old keys, with secrets) imports into the new shape', () => {
  const d = sampleData();
  const n = d.settings.notifications;
  const legacy = { version: 1, exportDate: '2026-10-10T00:00:00Z', includesSecrets: true, shows: d.shows, ftpBookmarks: d.ftpBookmarks,
    settings: { email: { enabled: true, smtp: { host: n.email.host, user: n.email.user, password: SECRETS.smtp }, recipients: n.email.recipients },
                telegram: { enabled: true, token: SECRETS.token, recipients: n.telegram.recipients } } };
  const plan = prepareImport({ settings: {}, shows: [], ftpBookmarks: [] }, legacy, { replace: true });
  assert.equal(plan.settings.notifications.email.pass, SECRETS.smtp);
  assert.equal(plan.settings.notifications.telegram.botToken, SECRETS.token);
  assert.deepEqual(plan.missing, []);
});

test('backup: a secret that was left out is listed to be typed again even if the item that holds it is switched off', () => {
  const d = sampleData(); d.shows[0].ftp.enabled = false;
  const file = buildExport(d);
  const plan = prepareImport({ settings: {}, shows: [], ftpBookmarks: [] }, file, { replace: true });
  assert.ok(plan.missing.some(m => m.id === 'ftp-show:s1'));
  const kept = prepareImport(d, file, { replace: true });                  // this PC still has it: nothing to type
  assert.deepEqual(kept.missing, []);
});

// ── Logs and support info ────────────────────────────────────────────────────

test('logs: one file per day named flowcast_dd-mm-yyyy.log, 5 MB at most, 7 days kept', async () => {
  const dir = tmpDir();
  const log = createLogger({ dir, now: () => at(2026, 10, 14, 21, 5) });
  log.log('info', 'started', 'app');
  await log.flush();
  assert.deepEqual(fs.readdirSync(dir), ['flowcast_14-10-2026.log']);
  assert.match(fs.readFileSync(path.join(dir, 'flowcast_14-10-2026.log'), 'utf8'), /^2026-10-14 21:05:00 \| INFO  \| app \| started\n$/);
  const sdir = tmpDir();
  const small = createLogger({ dir: sdir, maxBytes: 200, now: () => at(2026, 10, 14, 12, 0) });
  for (let i = 0; i < 40; i++) small.log('info', 'x'.repeat(60) + i);
  await small.flush();
  const files = fs.readdirSync(sdir);
  assert.ok(files.length > 1 && files.length <= 4, files.join());          // a full file is closed and a new one starts; 4 per day at most
  const d2 = tmpDir();
  for (const n of ['flowcast_01-10-2026.log', 'flowcast_13-10-2026.log', 'other.log']) fs.writeFileSync(path.join(d2, n), 'x');
  assert.equal(createLogger({ dir: d2, now: () => at(2026, 10, 14, 12, 0) }).prune(), 1);
  assert.deepEqual(fs.readdirSync(d2).sort(), ['flowcast_13-10-2026.log', 'other.log']);
  assert.ok(logFileRe('flowcast').test('flowcast_14-10-2026_2.log'));
});

test('support info: version, system, language, installation, last check and error; home folder as ~, never settings values', () => {
  const text = buildSupportInfo({
    app: 'FlowCast', version: '26.10.2', electron: '44.4.5', platform: 'win32', arch: 'x64', osRelease: '10.0.19045', language: 'it', installationName: 'Studio 2',
    lastCheck: { at: Date.UTC(2026, 9, 14, 8, 0, 0), ok: false, error: 'ENOENT C:\\Users\\Mario Rossi\\Downloads\\x' },
    lastError: { t: Date.UTC(2026, 9, 14, 9, 0, 0), message: 'failed at /home/mario/radio/a.wav' }
  });
  assert.match(text, /^FlowCast 26\.10\.2\nElectron 44\.4\.5\nSystem: win32 x64 10\.0\.19045\nLanguage: it\nInstallation: Studio 2\n/);
  assert.match(text, /\(ENOENT ~\\Downloads\\x\)/);
  assert.ok(!/Rossi|mario/.test(text));
  assert.ok(!/smtp|token|password|@/i.test(text));
});
