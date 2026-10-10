'use strict';
// Alerts: desktop notification, Telegram and email. The same rules as the other OnAir Garage apps
// (apps/STANDARD.md, "Alerts"):
//  - email: one message to all recipients, all in Bcc, so they do not see each other's addresses;
//    with an SMTP user the connection must be encrypted; timeouts 15 / 15 / 20 s
//  - every send is tried right away, again after 10 s and again after 60 s
//  - passwords and tokens are masked in every error message
//  - what has already been announced survives a restart (alert-state.js)
const { t } = require('./i18n');
const { maskSecrets } = require('./secrets');

const PREFIX = '[FlowCast]';
const RETRY_DELAYS = [0, 10_000, 60_000];
const TOKEN_RE = /^\d+:[\w-]{20,}$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_RECIPIENTS = 20;

const clip = s => (s.length > 4000 ? s.slice(0, 3997) + '…' : s);

// The bot may be shared with other programs: the first line must say who is writing
function withPrefix(text) {
  const first = String(text).split('\n')[0];
  return /FlowCast/i.test(first) ? String(text) : `${PREFIX} ${text}`;
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
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
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
  const smtp = emailCfg.smtp || {};
  const to   = parseRecipients(emailCfg.recipients);
  const from = emailCfg.from || smtp.user || (smtp.host ? `flowcast@${smtp.host}` : '');
  if (!smtp.host || !to.length || !from) throw new Error(t('mail.incomplete'));
  const transporter = makeTransport(smtp, transportFactory);
  try {
    // one message, all recipients in Bcc
    const info = await transporter.sendMail({ from, to: from, bcc: to, subject, text });
    const rejected = (info && info.rejected) || [];
    if (rejected.length) throw new Error(t('mail.rejected', { list: rejected.join(', ') }));
  } catch(e) {
    throw new Error(t('mail.failed') + maskSecrets(e.message, [smtp.password]));
  } finally {
    if (transporter.close) transporter.close();
  }
}

async function testEmailConnection(emailCfg, transportFactory = null) {
  const smtp = (emailCfg && emailCfg.smtp) || {};
  if (!smtp.host) return { success: false, message: t('mail.smtp_incomplete') };
  const transporter = makeTransport(smtp, transportFactory);
  try {
    await transporter.verify();
    return { success: true, message: t('mail.smtp_ok') };
  } catch(e) {
    return { success: false, message: maskSecrets(e.message, [smtp.password]) };
  } finally {
    if (transporter.close) transporter.close();
  }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

function telegramRecipients(cfg) {
  const list = Array.isArray(cfg.recipients) ? cfg.recipients.filter(r => String((r && r.chatId) || '').trim()) : [];
  if (list.length) return list;
  return cfg.chatId ? [{ chatId: cfg.chatId, note: '' }] : [];   // settings of versions before 26.9.7
}

async function sendTelegram(cfg, text, fetchFn = defaultFetch) {
  if (!cfg || !cfg.enabled) return;
  const token = cfg.token || '';
  if (!TOKEN_RE.test(token)) throw new Error(t('tg.bad_token'));
  const recipients = telegramRecipients(cfg);
  if (!recipients.length) throw new Error(t('tg.no_recipients'));
  const body = clip(withPrefix(text));
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

async function testTelegramConnection(cfg, fetchFn = defaultFetch) {
  try {
    await sendTelegram({ ...(cfg || {}), enabled: true }, t('tg.test_message'), fetchFn);
    return { success: true, message: t('tg.test_ok') };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── Texts of the alerts (subject and body), shared by email and Telegram ─────

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
  return null;
}

// A new version of FlowCast. url: only this repository's release page (checked by the caller)
function buildUpdateMessage(info, url) {
  const notes = String(info.notes || '').replace(/\r/g, '').trim().slice(0, 400);
  const lines = [t('upd.alert_body', { v: info.latest, cur: info.current }), url];
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

function createAlerter({ getSettings, state, notifyDesktop = () => {}, log = () => {}, deps = {}, delays = RETRY_DELAYS, sleep = realSleep }) {
  const email = deps.sendEmail    || sendEmail;
  const tg    = deps.sendTelegram || sendTelegram;
  const opts  = { delays, sleep, log };

  const emailReady = s => !!(s.email && s.email.enabled && s.email.smtp && s.email.smtp.host && parseRecipients(s.email.recipients).length);
  const tgReady    = s => !!(s.telegram && s.telegram.enabled && s.telegram.token && telegramRecipients(s.telegram).length);

  // Alert about a show: type 'error' | 'no-update'. Returns the results by channel.
  async function alertShow(show, type, details) {
    const s = getSettings();
    const msg = buildMessage(show, type, details);
    if (!msg) return {};
    const out = {};
    const jobs = [];
    const e = s.email, g = s.telegram;
    if (e && e.enabled && (type === 'error' ? e.onError !== false : !!e.onNoUpdate)) {
      if (!emailReady(s)) log('warn', 'email alert not sent: ' + t('mail.incomplete'));
      else jobs.push(withRetries('email', () => email(getSettings().email, msg.subject, msg.body), opts).then(r => { out.email = r; }));
    }
    if (g && g.enabled && (type === 'error' ? g.onError !== false : !!g.onNoUpdate)) {
      if (!tgReady(s)) log('warn', 'Telegram alert not sent: ' + t('tg.no_recipients'));
      else jobs.push(withRetries('Telegram', () => tg(getSettings().telegram, `${msg.subject}\n\n${msg.body}`), opts).then(r => { out.telegram = r; }));
    }
    await Promise.all(jobs);
    return out;
  }

  // After a run: counts runs in a row with the source not updated (kept across restarts) and
  // alerts when the count reaches the threshold and then at every multiple of it. Returns the count.
  function noUpdateRun(show, noUpdate) {
    if (!noUpdate) { state.setNoUpdate(show.id, 0); return 0; }
    const streak = state.getNoUpdate(show.id) + 1;
    state.setNoUpdate(show.id, streak);
    const threshold = Number(getSettings().email && getSettings().email.noUpdateStreakThreshold) || 3;
    if (streak >= threshold && streak % threshold === 0) alertShow(show, 'no-update', { streak }).catch(() => {});
    return streak;
  }

  // New version of FlowCast: once per version and channel; a channel is marked only after its message
  // was really delivered, so a failure is tried again at the next check. Returns the channels sent now.
  async function notifyUpdate(info, releaseUrl) {
    const s = getSettings();
    if (!info || !info.available || !info.latest) return [];
    if (s.updateAlert === false) return [];
    // the notice goes out only when Telegram or email is switched on (the desktop one comes along)
    if (!emailReady(s) && !tgReady(s)) return [];
    const done = state.getUpdateDone(info.latest);
    const msg = buildUpdateMessage(info, releaseUrl);
    const sent = [];
    const jobs = [];
    if (!done.includes('desktop')) {
      try { notifyDesktop(msg.subject, msg.body); state.markUpdateDone(info.latest, 'desktop'); sent.push('desktop'); } catch(_) {}
    }
    if (emailReady(s) && !done.includes('email')) {
      jobs.push(withRetries('email', () => email(getSettings().email, msg.subject, msg.body), opts).then(r => {
        if (r.ok) { state.markUpdateDone(info.latest, 'email'); sent.push('email'); }
      }));
    }
    if (tgReady(s) && !done.includes('telegram')) {
      jobs.push(withRetries('Telegram', () => tg(getSettings().telegram, `${msg.subject}\n\n${msg.body}`), opts).then(r => {
        if (r.ok) { state.markUpdateDone(info.latest, 'telegram'); sent.push('telegram'); }
      }));
    }
    await Promise.all(jobs);
    return sent;
  }

  return { alertShow, noUpdateRun, notifyUpdate };
}

module.exports = {
  PREFIX, RETRY_DELAYS, TOKEN_RE, EMAIL_RE,
  withPrefix, parseRecipients, smtpOptions, telegramRecipients,
  sendEmail, sendTelegram, testEmailConnection, testTelegramConnection,
  buildMessage, buildUpdateMessage, withRetries, createAlerter
};
