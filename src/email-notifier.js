'use strict';
const nodemailer = require('nodemailer');
const { t, dateLocale } = require('./i18n');

function makeTransport(smtp) {
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   parseInt(smtp.port) || 587,
    secure: !!smtp.secure,
    auth:   smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    // Certificates are verified unless the user explicitly allows self-signed ones
    tls:    { rejectUnauthorized: !smtp.allowSelfSigned }
  });
}

function parseRecipients(str) {
  return (str || '').split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Send an alert email.
 * type: 'error' | 'no-update'
 * details: { message?, ops?: {ftp,local,archive}, streak? }
 */
async function sendAlert(emailConfig, show, type, details = {}) {
  if (!emailConfig || !emailConfig.enabled) return;
  const recipients = parseRecipients(emailConfig.recipients);
  if (!recipients.length) return;
  if (!emailConfig.smtp || !emailConfig.smtp.host) return;
  if (type === 'error'     && !emailConfig.onError)    return;
  if (type === 'no-update' && !emailConfig.onNoUpdate) return;

  const now = new Date().toLocaleString(dateLocale());
  let subject, body;

  if (type === 'error') {
    subject = t('mail.err_subject', { name: show.name });
    const lines = [
      t('mail.show', { name: show.name }),
      t('mail.date', { date: now }),
      t('mail.result_error'),
      ''
    ];
    if (details.message) lines.push(t('mail.message', { message: details.message }), '');
    if (details.ops) {
      if (details.ops.local   === 'error') lines.push(t('mail.op_local'));
      if (details.ops.ftp     === 'error') lines.push(t('mail.op_ftp'));
      if (details.ops.archive === 'error') lines.push(t('mail.op_archive'));
    }
    body = lines.join('\n');
  } else if (type === 'no-update') {
    subject = t('mail.noupd_subject', { name: show.name });
    body = [
      t('mail.show', { name: show.name }),
      t('mail.date', { date: now }),
      '',
      t('mail.noupd_line1', { n: details.streak || 3 }),
      t('mail.noupd_line2')
    ].join('\n');
  } else {
    return;
  }

  const from = emailConfig.from || emailConfig.smtp.user
    || `flowcast@${emailConfig.smtp.host}`;

  await makeTransport(emailConfig.smtp).sendMail({
    from,
    to: recipients.join(', '),
    subject,
    text: body
  });
}

async function testConnection(emailConfig) {
  if (!emailConfig || !emailConfig.smtp || !emailConfig.smtp.host) {
    return { success: false, message: t('mail.smtp_incomplete') };
  }
  try {
    await makeTransport(emailConfig.smtp).verify();
    return { success: true, message: t('mail.smtp_ok') };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

module.exports = { sendAlert, testConnection };
