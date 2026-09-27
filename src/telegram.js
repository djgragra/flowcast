'use strict';
// Telegram alerts through a bot: settings.telegram = { enabled, token, chatId, onError, onNoUpdate }.
// The message has the same text as the email alert.
const { net } = require('electron');
const { t } = require('./i18n');
const { buildMessage } = require('./email-notifier');

const TOKEN_RE = /^\d+:[\w-]{20,}$/;

async function send(cfg, text) {
  if (!TOKEN_RE.test(cfg.token || '')) throw new Error(t('tg.bad_token'));
  if (!String(cfg.chatId || '').trim()) throw new Error(t('tg.no_chat'));
  const res = await net.fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(cfg.chatId).trim(), text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `HTTP ${res.status}`);
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

module.exports = { sendAlert, testConnection };
