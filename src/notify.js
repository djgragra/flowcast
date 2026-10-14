// garage-common: notify 1
'use strict';
// Alerts: desktop notification, Telegram and email. The same rules as the other OnAir Garage apps
// (apps/STANDARD.md, "Alerts"):
//  - email: one message to all recipients, all in Bcc, so they do not see each other's addresses;
//    with an SMTP user the connection must be encrypted; timeouts 15 / 15 / 20 s
//  - every send is tried right away, again after 10 s and again after 60 s
//  - passwords and tokens are masked in every error message
//  - what has already been announced survives a restart (alert-state.js)
//  - every alert starts with [FlowCast · installation name] (apps/COMMON-FEATURES.md, 5.3)
// Settings shape: settings.notifications = { desktop, telegram: { enabled, botToken, recipients, … }, email: { enabled, host, port, … } }
const os = require('os');
const { t } = require('./i18n');
const { maskSecrets } = require('./secrets');
const { buildDigest, dueSlot } = require('./digest');

const PREFIX = '[FlowCast]';
const RETRY_DELAYS = [0, 10_000, 60_000];
const TOKEN_RE = /^\d+:[\w-]{20,}$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_RECIPIENTS = 20;

const clip = s => (s.length > 4000 ? s.slice(0, 3997) + '…' : s);

// Name of this installation: the one in Settings, else the computer name
function installationName(settings, hostname = os.hostname()) {
  return String((settings && settings.installationName) || '').trim() || String(hostname || '').trim();
}

// "[FlowCast · Studio PC]": every alert starts with it, so with several PCs the message says which one
function alertPrefix(settings, hostname) {
  const name = installationName(settings, hostname);
  return name ? `[FlowCast · ${name}]` : PREFIX;
}

// The bot may be shared with other programs: the first line must say who is writing
function withPrefix(text, prefix = PREFIX) {
  const first = String(text).split('\n')[0];
  return /^\[FlowCast\b/.test(first) ? String(text) : `${prefix} ${text}`;
}

// Valid, unique addresses from a list or from text separated by commas, semicolons, spaces or new lines
function parseRecipients(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const seen = new Set();
  return raw.map(x => String(x || '').trim())
    .filter(x => EMAIL_RE.test(x) && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .slice(0, MAX_RECIPIENTS);
}

// ── Transport ────────────────────────────────────────────────────────────────

function smtpOptions(smtp) {
  const secure = !!smtp.secure;           // true = TLS from the start (usually port 465); false = STARTTLS
  return {
    host: smtp.host,
    port: parseInt(smtp.port) || 587,
    secure,
    requireTLS: !secure && !!smtp.user,   // with a user name the password never travels in clear text
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    // Certificates are verified unless the user explicitly allows self-signed ones
    tls: { rejectUnauthorized: !smtp.allowSelfSigned },
    connectionTimeout: 15_000,
    greetingTimeout:   15_000,
    socketTimeout:     20_000
  };
}

function defaultFetch(url, opts) {
  // Electron's net follows the system proxy; plain fetch is the fallback (tests, headless)
  try { return require('electron').net.fetch(url, opts); } catch(_) { return globalThis.fetch(url, opts); }
}

function makeTransport(smtp, transportFactory) {
  const create = transportFactory || require('nodemailer').createTransport;
  return create(smtpOptions(smtp));
}

// ── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(emailCfg, subject, text, transportFactory = null) {
  if (!emailCfg || !emailCfg.enabled) return;
  const to   = parseRecipients(emailCfg.recipients);
  const from = emailCfg.from || emailCfg.user || (emailCfg.host ? `flowcast@${emailCfg.host}` : '');
  if (!emailCfg.host || !to.length || !from) throw new Error(t('mail.incomplete'));
  const transporter = makeTransport(emailCfg, transportFactory);
  try {
    // one message, all recipients in Bcc
    const info = await transporter.sendMail({ from, to: from, bcc: to, subject, text });
    const rejected = (info && info.rejected) || [];
    if (rejected.length) throw new Error(t('mail.rejected', { list: rejected.join(', ') }));
  } catch(e) {
    throw new Error(t('mail.failed') + maskSecrets(e.message, [emailCfg.pass]));
  } finally {
    if (transporter.close) transporter.close();
  }
}

async function testEmailConnection(emailCfg, transportFactory = null) {
  const smtp = emailCfg || {};
  if (!smtp.host) return { success: false, message: t('mail.smtp_incomplete') };
  const transporter = makeTransport(smtp, transportFactory);
  try {
    await transporter.verify();
    return { success: true, message: t('mail.smtp_ok') };
  } catch(e) {
    return { success: false, message: maskSecrets(e.message, [smtp.pass]) };
  } finally {
    if (transporter.close) transporter.close();
  }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

function telegramRecipients(cfg) {
  return Array.isArray(cfg.recipients) ? cfg.recipients.filter(r => String((r && r.chatId) || '').trim()) : [];
}

async function sendTelegram(cfg, text, fetchFn = defaultFetch, prefix = PREFIX) {
  if (!cfg || !cfg.enabled) return;
  const token = cfg.botToken || '';
  if (!TOKEN_RE.test(token)) throw new Error(t('tg.bad_token'));
  const recipients = telegramRecipients(cfg);
  if (!recipients.length) throw new Error(t('tg.no_recipients'));
  const body = clip(withPrefix(text, prefix));
  const failures = [];
  for (const r of recipients) {
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(r.chatId).trim(), text: body, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.description || `HTTP ${res.status}`);
    } catch(e) {
      // one bad recipient must not stop the others; the token must never reach a message or a log
      failures.push(`${r.note ? r.note + ' ' : ''}(${r.chatId}): ${maskSecrets(e.message, [token])}`);
    }
  }
  if (failures.length) throw new Error(t('tg.send_failed', { list: failures.join(' | ') }));
}

async function testTelegramConnection(cfg, fetchFn = defaultFetch, prefix = PREFIX) {
  try {
    await sendTelegram({ ...(cfg || {}), enabled: true }, t('tg.test_message'), fetchFn, prefix);
    return { success: true, message: t('tg.test_ok') };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── Texts of the alerts (subject and body), shared by email and Telegram ─────
// The subjects have no program name: the alerter puts [FlowCast · installation] in front of them.

function buildMessage(show, type, details = {}, now = new Date()) {
  const when = now.toLocaleString(require('./i18n').dateLocale());
  if (type === 'error') {
    const lines = [t('mail.show', { name: show.name }), t('mail.date', { date: when }), t('mail.result_error'), ''];
    if (details.message) lines.push(t('mail.message', { message: details.message }), '');
    if (details.ops) {
      if (details.ops.local   === 'error') lines.push(t('mail.op_local'));
      if (details.ops.ftp     === 'error') lines.push(t('mail.op_ftp'));
      if (details.ops.archive === 'error') lines.push(t('mail.op_archive'));
    }
    return { subject: t('mail.err_subject', { name: show.name }), body: lines.join('\n') };
  }
  if (type === 'no-update') {
    return {
      subject: t('mail.noupd_subject', { name: show.name }),
      body: [t('mail.show', { name: show.name }), t('mail.date', { date: when }), '',
             t('mail.noupd_line1', { n: details.streak || 3 }), t('mail.noupd_line2')].join('\n')
    };
  }
  if (type === 'recovery') {
    const kinds = details.kinds || ['error'];
    const lines = [t('mail.show', { name: show.name }), t('mail.date', { date: when }), ''];
    if (kinds.includes('error'))     lines.push(t('mail.rec_error'));
    if (kinds.includes('no-update')) lines.push(t('mail.rec_noupd'));
    return { subject: t('mail.rec_subject', { name: show.name }), body: lines.join('\n') };
  }
  return null;
}

// A new version of FlowCast. url: only this repository's release page (checked by the caller)
function buildUpdateMessage(info, url) {
  const notes = String(info.notes || '').replace(/\r/g, '').trim().slice(0, 400);
  const lines = [t('upd.alert_body', { v: info.latest, cur: info.current }), url, '', t('upd.alert_hint')];
  if (notes) lines.push('', notes);
  return { subject: t('upd.alert_subject', { v: info.latest }), body: lines.join('\n') };
}

// ── Retries ──────────────────────────────────────────────────────────────────

const realSleep = ms => new Promise(r => setTimeout(r, ms));

// fn is tried right away; if it fails, again after delays[1] ms, then again after delays[2] ms.
// Resolves { ok: true } or { ok: false, error } (the message of the last failure). Never rejects.
async function withRetries(name, fn, { delays = RETRY_DELAYS, sleep = realSleep, log = () => {} } = {}) {
  let last = null;
  for (let n = 0; n < delays.length; n++) {
    if (n > 0) await sleep(delays[n]);
    try {
      await fn();
      log('info', `${name}: alert sent${n ? ` (attempt ${n + 1})` : ''}`);
      return { ok: true };
    } catch(e) {
      last = e.message;
      log('warn', `${name}: attempt ${n + 1} of ${delays.length} failed: ${e.message}`);
    }
  }
  return { ok: false, error: last };
}

// ── The alerter: decides, sends, remembers ───────────────────────────────────

function createAlerter({ getSettings, state, notifyDesktop = () => {}, log = () => {}, deps = {}, delays = RETRY_DELAYS, sleep = realSleep,
                         getPrefix = () => PREFIX, getShows = () => [], readHistory = () => [], now = () => new Date() }) {
  const email = deps.sendEmail    || sendEmail;
  const tg    = deps.sendTelegram || sendTelegram;
  const opts  = { delays, sleep, log };
  const digestTries = new Map();     // slot key -> rounds that found every channel failing
  let digestBusy = false;

  const cfgs = () => { const n = getSettings().notifications || {}; return { e: n.email || {}, g: n.telegram || {}, desktop: n.desktop !== false }; };
  const emailReady = c => !!(c.enabled && c.host && parseRecipients(c.recipients).length);
  const tgReady    = c => !!(c.enabled && c.botToken && telegramRecipients(c).length);

  // Sends subject + body on the channels that are on and (wants) says yes to. Returns { attempted, delivered, out }.
  async function dispatch(subject, body, wants, runOpts = opts) {
    const { e, g } = cfgs();
    const prefix = getPrefix();
    const subj = withPrefix(subject, prefix);
    const out = {};
    const jobs = [];
    if (e.enabled && wants(e)) {
      if (!emailReady(e)) log('warn', 'email alert not sent: ' + t('mail.incomplete'));
      else jobs.push(withRetries('email', () => email(cfgs().e, subj, body), runOpts).then(r => { out.email = r; }));
    }
    if (g.enabled && wants(g)) {
      if (!tgReady(g)) log('warn', 'Telegram alert not sent: ' + t('tg.no_recipients'));
      else jobs.push(withRetries('Telegram', () => tg(cfgs().g, `${subj}\n\n${body}`, undefined, prefix), runOpts).then(r => { out.telegram = r; }));
    }
    await Promise.all(jobs);
    const results = Object.values(out);
    return { out, attempted: results.length, delivered: results.some(r => r.ok) };
  }

  const WANTS = {
    error:      c => c.onError !== false,
    'no-update': c => !!c.onNoUpdate,
    recovery:   c => c.onRecovery !== false
  };

  // Alert about a show: type 'error' | 'no-update' | 'recovery'. Returns the results by channel.
  // What was announced is remembered (alert-state.json): a recovery follows only an alert that was delivered.
  async function alertShow(show, type, details) {
    const msg = buildMessage(show, type, details);
    if (!msg || !WANTS[type]) return {};
    const r = await dispatch(msg.subject, msg.body, WANTS[type]);
    if (type === 'error' && r.delivered)     state.setAlerted(show.id, 'error', true);
    if (type === 'no-update' && r.delivered) state.setAlerted(show.id, 'noUpdate', true);
    if (type === 'recovery' && (r.delivered || r.attempted === 0)) state.clearAlerted(show.id);
    return r.out;
  }

  // After a run: counts runs in a row with the source not updated (kept across restarts) and
  // alerts when the count reaches the threshold and then at every multiple of it. Returns the count.
  function noUpdateRun(show, noUpdate) {
    if (!noUpdate) { state.setNoUpdate(show.id, 0); return 0; }
    const streak = state.getNoUpdate(show.id) + 1;
    state.setNoUpdate(show.id, streak);
    const threshold = Number(cfgs().e.noUpdateStreakThreshold) || 3;
    if (streak >= threshold && streak % threshold === 0) alertShow(show, 'no-update', { streak }).catch(() => {});
    return streak;
  }

  // A production finished without a failed step: if an alert had been sent for this show, one "back to normal"
  // message goes out (also after a restart: the flag is in alert-state.json). No alert before = no message.
  async function recovered(show) {
    const a = state.getAlerted(show.id);
    const kinds = [a.error && 'error', a.noUpdate && 'no-update'].filter(Boolean);
    if (!kinds.length) return null;
    return alertShow(show, 'recovery', { kinds });
  }

  // New version of FlowCast: once per version and channel; a channel is marked only after its message
  // was really delivered, so a failure is tried again at the next check. Returns the channels sent now.
  async function notifyUpdate(info, releaseUrl) {
    const s = getSettings();
    if (!info || !info.available || !info.latest) return [];
    if (s.updateAlert === false) return [];
    const { e, g, desktop } = cfgs();
    // the notice goes out only when Telegram or email is switched on (the desktop one comes along)
    if (!emailReady(e) && !tgReady(g)) return [];
    const done = state.getUpdateDone(info.latest);
    const msg = buildUpdateMessage(info, releaseUrl);
    const prefix = getPrefix();
    const subj = withPrefix(msg.subject, prefix);
    const sent = [];
    const jobs = [];
    if (desktop && !done.includes('desktop')) {
      try { notifyDesktop(subj, msg.body); state.markUpdateDone(info.latest, 'desktop'); sent.push('desktop'); } catch(_) {}
    }
    if (emailReady(e) && !done.includes('email')) {
      jobs.push(withRetries('email', () => email(cfgs().e, subj, msg.body), opts).then(r => {
        if (r.ok) { state.markUpdateDone(info.latest, 'email'); sent.push('email'); }
      }));
    }
    if (tgReady(g) && !done.includes('telegram')) {
      jobs.push(withRetries('Telegram', () => tg(cfgs().g, `${subj}\n\n${msg.body}`, undefined, prefix), opts).then(r => {
        if (r.ok) { state.markUpdateDone(info.latest, 'telegram'); sent.push('telegram'); }
      }));
    }
    await Promise.all(jobs);
    return sent;
  }

  // The summary. force = "Send now": always sends, whatever the "only if there is something to report" choice.
  async function sendDigest({ force = false, date = now() } = {}) {
    const d = getSettings().digest || {};
    const days = d.frequency === 'weekly' ? 7 : 1;
    const shows = getShows();
    const hist = {};
    for (const sh of shows) hist[sh.id] = readHistory(sh.id);
    const msg = buildDigest(shows, hist, { now: date, days });
    if (!force && d.when === 'problems' && !msg.problems) return { skipped: true, problems: 0, out: {} };
    // "Send now" is a test the user is waiting for: one attempt, the answer comes at once. The scheduled one retries.
    const r = await dispatch(msg.subject, msg.body, () => true, force ? { ...opts, delays: [0] } : opts);
    return { skipped: false, problems: msg.problems, attempted: r.attempted, delivered: r.delivered, out: r.out };
  }

  // Called every minute: sends the summary of a time that has passed and was not sent yet (once per time and day,
  // also after a restart; a PC that was off at the time sends it at the first start after it).
  async function digestTick(date = now()) {
    const d = getSettings().digest;
    if (!d || !d.enabled || digestBusy) return null;
    const slot = dueSlot(d, date, state.getDigestSent());
    if (!slot) return null;
    digestBusy = true;
    try {
      const { e, g } = cfgs();
      if (!emailReady(e) && !tgReady(g)) { state.markDigestSent(slot); return { skipped: true }; }   // every channel off: nothing to send
      const r = await sendDigest({ date });
      const tries = (digestTries.get(slot) || 0) + 1;
      // a summary that could not be delivered is tried again at the next minutes, three rounds at most
      if (r.skipped || r.delivered || tries >= 3) { state.markDigestSent(slot); digestTries.delete(slot); }
      else digestTries.set(slot, tries);
      return r;
    } finally { digestBusy = false; }
  }

  return { alertShow, noUpdateRun, recovered, notifyUpdate, sendDigest, digestTick };
}

module.exports = {
  PREFIX, RETRY_DELAYS, TOKEN_RE, EMAIL_RE,
  installationName, alertPrefix, withPrefix, parseRecipients, smtpOptions, telegramRecipients,
  sendEmail, sendTelegram, testEmailConnection, testTelegramConnection,
  buildMessage, buildUpdateMessage, withRetries, createAlerter
};
