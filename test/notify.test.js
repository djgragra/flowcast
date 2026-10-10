'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const i18n = require('../src/i18n');
const notify = require('../src/notify');
const { SECRETS } = require('./helpers');

i18n.load('en');

const emailCfg = (extra = {}) => ({
  enabled: true,
  smtp: { host: 'smtp.example.org', port: 587, user: 'alerts', password: SECRETS.smtp, secure: false, ...(extra.smtp || {}) },
  from: 'alerts@example.org',
  recipients: ['a@example.org', 'b@example.org', 'c@example.org'],
  ...extra, smtp: { host: 'smtp.example.org', port: 587, user: 'alerts', password: SECRETS.smtp, secure: false, ...(extra.smtp || {}) }
});

// a transport that records what it was created with and what it sends
function fakeTransport(sendMail) {
  const log = { created: [], sent: [], closed: 0 };
  const factory = opts => {
    log.created.push(opts);
    return { sendMail: async m => { log.sent.push(m); return sendMail ? sendMail(m) : { rejected: [] }; }, close: () => { log.closed++; } };
  };
  return { log, factory };
}

test('email: one message, all recipients in Bcc, nobody in To', async () => {
  const { log, factory } = fakeTransport();
  await notify.sendEmail(emailCfg(), 'Subject', 'Body', factory);
  assert.equal(log.sent.length, 1);
  assert.deepEqual(log.sent[0].bcc, ['a@example.org', 'b@example.org', 'c@example.org']);
  assert.equal(log.sent[0].to, 'alerts@example.org');
  assert.ok(!String(log.sent[0].to).includes('a@example.org'));
  assert.equal(log.closed, 1);
});

test('email: recipients are validated, deduplicated, and old text lists still work', async () => {
  assert.deepEqual(notify.parseRecipients('a@example.org\nb@example.org, A@example.org; nonsense  c@example.org'),
    ['a@example.org', 'b@example.org', 'c@example.org']);
  const { log, factory } = fakeTransport();
  await notify.sendEmail(emailCfg({ recipients: 'x@example.org\ny@example.org' }), 's', 'b', factory);
  assert.deepEqual(log.sent[0].bcc, ['x@example.org', 'y@example.org']);
  await assert.rejects(notify.sendEmail(emailCfg({ recipients: ['not an address'] }), 's', 'b', factory), /Email is not set up/);
});

test('email: an address rejected by the server makes the send fail and names the address', async () => {
  const { factory } = fakeTransport(async () => ({ rejected: ['b@example.org'] }));
  await assert.rejects(notify.sendEmail(emailCfg(), 's', 'b', factory), /b@example\.org: rejected by the server/);
});

test('email: with an SMTP user the connection must be encrypted (STARTTLS required, or TLS from the start)', async () => {
  let o = notify.smtpOptions({ host: 'h', port: 587, user: 'u', password: 'p', secure: false });
  assert.equal(o.requireTLS, true);
  assert.equal(o.secure, false);
  o = notify.smtpOptions({ host: 'h', port: 465, user: 'u', password: 'p', secure: true });
  assert.equal(o.secure, true);
  assert.equal(o.requireTLS, false);          // already encrypted from the start
  o = notify.smtpOptions({ host: 'h', port: 25, user: '', password: '', secure: false });
  assert.equal(o.requireTLS, false);          // no user name, no password to protect
  assert.equal(o.auth, undefined);
  // the options really reach the transport, and certificates are verified by default
  const { log, factory } = fakeTransport();
  await notify.sendEmail(emailCfg(), 's', 'b', factory);
  assert.equal(log.created[0].requireTLS, true);
  assert.equal(log.created[0].tls.rejectUnauthorized, true);
  const t2 = fakeTransport();
  await notify.sendEmail(emailCfg({ smtp: { allowSelfSigned: true } }), 's', 'b', t2.factory);
  assert.equal(t2.log.created[0].tls.rejectUnauthorized, false);
});

test('timeouts: SMTP 15 s connection / 15 s greeting / 20 s socket, 15 s per Telegram call', async () => {
  const { log, factory } = fakeTransport();
  await notify.sendEmail(emailCfg(), 's', 'b', factory);
  assert.equal(log.created[0].connectionTimeout, 15000);
  assert.equal(log.created[0].greetingTimeout, 15000);
  assert.equal(log.created[0].socketTimeout, 20000);
  // the connection test uses the same options
  const t2 = fakeTransport(); let verified = false;
  const f2 = opts => { const tr = t2.factory(opts); tr.verify = async () => { verified = true; }; return tr; };
  const r = await notify.testEmailConnection(emailCfg(), f2);
  assert.equal(r.success, true); assert.ok(verified);
  assert.equal(t2.log.created[0].socketTimeout, 20000);
  // Telegram: every call carries an abort signal (15 s)
  const seen = [];
  const fetchFn = async (url, opts) => { seen.push(opts); return { ok: true, json: async () => ({ ok: true }) }; };
  await notify.sendTelegram({ enabled: true, token: SECRETS.token, recipients: [{ chatId: '1' }] }, 'hi', fetchFn);
  assert.ok(seen[0].signal instanceof AbortSignal);
});

test('retries: right away, again after 10 s, again after 60 s; stops at the first success', async () => {
  const waits = [];
  const sleep = async ms => { waits.push(ms); };
  let calls = 0;
  const r = await notify.withRetries('email', async () => { calls++; throw new Error('down'); }, { sleep });
  assert.equal(r.ok, false);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10000, 60000]);
  assert.equal(r.error, 'down');
  waits.length = 0; calls = 0;
  const ok = await notify.withRetries('email', async () => { calls++; if (calls < 2) throw new Error('once'); }, { sleep });
  assert.equal(ok.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10000]);
  assert.deepEqual(notify.RETRY_DELAYS, [0, 10000, 60000]);
});

test('retries: an alert goes through them on both channels; one failing channel does not stop the other', async () => {
  const sleep = async () => {};
  let emailCalls = 0, tgCalls = 0;
  const alerter = notify.createAlerter({
    getSettings: () => ({ email: { ...emailCfg(), onError: true }, telegram: { enabled: true, token: SECRETS.token, recipients: [{ chatId: '1' }], onError: true } }),
    state: { getNoUpdate: () => 0, setNoUpdate() {} }, sleep,
    deps: { sendEmail: async () => { emailCalls++; throw new Error('smtp down'); }, sendTelegram: async () => { tgCalls++; } }
  });
  const res = await alerter.alertShow({ id: 's1', name: 'Morning' }, 'error', { message: 'boom' });
  assert.equal(emailCalls, 3);
  assert.equal(tgCalls, 1);
  assert.equal(res.email.ok, false);
  assert.equal(res.telegram.ok, true);
});

test('masking: SMTP password, Telegram token and FTP password never appear in an error', async () => {
  const { factory } = fakeTransport(async () => { throw new Error(`535 login failed for password ${SECRETS.smtp}`); });
  await assert.rejects(notify.sendEmail(emailCfg(), 's', 'b', factory), e => {
    assert.ok(!e.message.includes(SECRETS.smtp)); assert.ok(e.message.includes('***')); return true;
  });
  const t3 = fakeTransport(); t3.factory; // connection test
  const bad = opts => ({ verify: async () => { throw new Error(`auth failed ${SECRETS.smtp}`); }, close() {} });
  const r = await notify.testEmailConnection(emailCfg(), bad);
  assert.equal(r.success, false); assert.ok(!r.message.includes(SECRETS.smtp));
  // Telegram: node/Electron put the URL (with the token) in the error
  const fetchFn = async url => { throw new Error(`request to ${url} failed`); };
  await assert.rejects(
    notify.sendTelegram({ enabled: true, token: SECRETS.token, recipients: [{ chatId: '42', note: 'Anna' }] }, 'hi', fetchFn),
    e => { assert.ok(!e.message.includes(SECRETS.token)); assert.ok(e.message.includes('Anna (42)')); return true; });
  const tr = await notify.testTelegramConnection({ token: SECRETS.token, recipients: [{ chatId: '1' }] }, fetchFn);
  assert.equal(tr.success, false); assert.ok(!tr.message.includes(SECRETS.token));
  // very short secrets are left alone (the text would become unreadable)
  const { maskSecrets } = require('../src/secrets');
  assert.equal(maskSecrets('password abc here', ['abc']), 'password abc here');
  assert.equal(maskSecrets('password abcd here', ['abcd']), 'password *** here');
});

test('masking: the FTP password is hidden in the connection test and in upload errors/logs', async (t) => {
  // basic-ftp exports Client as a read-only property: replace the whole module for this test
  const ftpPath = require.resolve('basic-ftp');
  const clientPath = require.resolve('../src/ftp-client');
  require('basic-ftp');
  const original = require.cache[ftpPath].exports;
  require.cache[ftpPath].exports = { Client: class { constructor() { this.ftp = {}; } async access(c) { throw new Error(`530 Login incorrect (${c.password})`); } close() {} } };
  delete require.cache[clientPath];
  t.after(() => { require.cache[ftpPath].exports = original; delete require.cache[clientPath]; });
  const ftpClient = require('../src/ftp-client');
  const cfg = { host: 'h', user: 'u', password: SECRETS.ftp };
  const r = await ftpClient.testConnection(cfg, 1000);
  assert.equal(r.success, false); assert.ok(!r.message.includes(SECRETS.ftp));
  // upload: three attempts with pauses of 8 s and 16 s; the timers are faked
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines = [];
  const p = ftpClient.upload(cfg, '/tmp/x.mp3', l => lines.push(l), 1000);
  let done = false; p.then(() => { done = true; });
  for (let i = 0; i < 20 && !done; i++) { await new Promise(res => setImmediate(res)); t.mock.timers.tick(20000); }
  const res = await p;
  assert.equal(res.success, false);
  assert.ok(!res.error.includes(SECRETS.ftp));
  assert.ok(lines.length >= 3);
  assert.ok(lines.every(l => !l.includes(SECRETS.ftp)));
});

test('messages: the Telegram text always says who writes (shared bot); the update text names version and page', () => {
  assert.equal(notify.withPrefix('Disk full'), '[FlowCast] Disk full');
  assert.equal(notify.withPrefix('⛔ FlowCast — Error: Morning\n\nbody'), '⛔ FlowCast — Error: Morning\n\nbody');
  const m = notify.buildUpdateMessage({ latest: '26.10.1', current: '26.9.8', notes: 'Alerts rebuilt\r\nTLS required' }, 'https://github.com/djgragra/flowcast/releases/tag/v26.10.1');
  assert.match(m.subject, /26\.10\.1/);
  assert.match(m.body, /26\.10\.1.*26\.9\.8/);
  assert.match(m.body, /releases\/tag\/v26\.10\.1/);
  assert.match(m.body, /TLS required/);
});
