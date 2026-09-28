'use strict';
// Telegram alerts through a bot: settings.telegram = { enabled, token, recipients: [{chatId, note}], onError, onNoUpdate }.
// The message has the same text as the email alert. Older installs stored a single "chatId"
// string; store.js migrates it to recipients on load, and recipientsOf() below falls back to
// it too, in case a raw cfg reaches here before that migration (e.g. from the test button).
const { net } = require('electron');
const { t } = require('./i18n');
const { buildMessage } = require('./email-notifier');

const TOKEN_RE = /^\d+:[\w-]{20,}$/;

function recipientsOf(cfg) {
  const list = Array.isArray(cfg.recipients) ? cfg.recipients.filter(r => String((r && r.chatId) || '').trim()) : [];
  if (list.length) return list;
  return cfg.chatId ? [{ chatId: cfg.chatId, note: '' }] : [];
}

async function sendOne(token, chatId, text) {
  const res = await net.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId).trim(), text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `HTTP ${res.status}`);
}

// Sends to every recipient; a bad chat ID does not stop the others.
async function send(cfg, text) {
  if (!TOKEN_RE.test(cfg.token || '')) throw new Error(t('tg.bad_token'));
  const recipients = recipientsOf(cfg);
  if (!recipients.length) throw new Error(t('tg.no_recipients'));
  const failures = [];
  for (const r of recipients) {
    try { await sendOne(cfg.token, r.chatId, text); }
    catch(e) { failures.push(`${r.note ? r.note + ' ' : ''}(${r.chatId}): ${e.message}`); }
  }
  if (failures.length) throw new Error(t('tg.send_failed', { list: failures.join(' | ') }));
}

async function sendAlert(cfg, show, type, details = {}) {
  if (!cfg || !cfg.enabled) return;
  if (type === 'error'     && cfg.onError === false) return;
  if (type === 'no-update' && !cfg.onNoUpdate)        return;
  const msg = buildMessage(show, type, details);
  if (msg) await send(cfg, `${msg.subject}\n\n${msg.body}`);
}

async function testConnection(cfg) {
  try {
    await send(cfg || {}, t('tg.test_message'));
    return { success: true, message: t('tg.test_ok') };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

module.exports = { sendAlert, testConnection, recipientsOf };
