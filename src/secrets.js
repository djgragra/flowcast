'use strict';
// Secrets: SMTP password, Telegram bot token, FTP passwords (shows and bookmarks).
// On disk they are encrypted with the system keystore (Electron safeStorage) when it is available;
// in memory, and everywhere else in the app, they are plain text. Nothing here needs Electron: the
// keystore is handed in, so the tests can use a fake one.
const SEAL = 'enc:v1:';

const isSealed = v => typeof v === 'string' && v.startsWith(SEAL);

// box: { available, seal(text), open(text) }. Without a keystore: text is kept as it is.
function createSecretBox(safeStorage) {
  const available = () => {
    try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch(_) { return false; }
  };
  return {
    available,
    seal(v) {
      if (typeof v !== 'string' || !v || isSealed(v) || !available()) return v;
      try { return SEAL + safeStorage.encryptString(v).toString('base64'); } catch(_) { return v; }
    },
    // '' when the value was sealed on another PC / user account and cannot be read here
    open(v) {
      if (!isSealed(v)) return v;
      try { return safeStorage.decryptString(Buffer.from(v.slice(SEAL.length), 'base64')); } catch(_) { return ''; }
    }
  };
}

const PLAIN_BOX = { available: () => false, seal: v => v, open: v => (isSealed(v) ? '' : v) };

// Every place that holds a secret. Each entry gives the container objects of data and the field name.
// kind: what the user knows it as (used to list what must be typed again after an import).
function secretSlots(data) {
  const slots = [];
  const s = data && data.settings;
  if (s && s.email && s.email.smtp)   slots.push({ obj: s.email.smtp, key: 'password', kind: 'smtp', label: s.email.smtp.host || 'SMTP' });
  if (s && s.telegram)                slots.push({ obj: s.telegram,   key: 'token',    kind: 'telegram', label: 'Telegram' });
  for (const sh of (data && data.shows) || []) {
    if (sh && sh.ftp) slots.push({ obj: sh.ftp, key: 'password', kind: 'ftp-show', label: sh.name || sh.id || '' });
  }
  for (const bm of (data && data.ftpBookmarks) || []) {
    if (bm) slots.push({ obj: bm, key: 'password', kind: 'ftp-bookmark', label: bm.name || bm.host || '' });
  }
  return slots;
}

const clone = d => JSON.parse(JSON.stringify(d));

// Copy of data ready to be written to disk: secrets sealed
function sealData(data, box) {
  const out = clone(data);
  for (const { obj, key } of secretSlots(out)) {
    if (typeof obj[key] === 'string' && obj[key]) obj[key] = box.seal(obj[key]);
  }
  return out;
}

// In place: sealed secrets become plain text. Returns { unreadable, plain } counts:
// unreadable = sealed values that could not be decrypted here; plain = non-empty values that were
// stored without encryption (to be re-saved sealed when the keystore is available).
function openData(data, box) {
  let unreadable = 0, plain = 0;
  for (const { obj, key } of secretSlots(data)) {
    const v = obj[key];
    if (typeof v !== 'string' || !v) continue;
    if (isSealed(v)) {
      const o = box.open(v);
      if (!o) unreadable++;
      obj[key] = o;
    } else {
      plain++;
    }
  }
  return { unreadable, plain };
}

// Every non-empty secret value of data (used to mask them in messages)
function collectSecrets(data) {
  return secretSlots(data).map(({ obj, key }) => obj[key]).filter(v => typeof v === 'string' && v);
}

// Replaces every occurrence of the given secrets in text with ***. Very short values (under 4
// characters) are not masked, or the text would become unreadable.
function maskSecrets(text, secrets) {
  let out = String(text == null ? '' : text);
  for (const s of secrets || []) {
    if (typeof s === 'string' && s.length >= 4) out = out.split(s).join('***');
  }
  return out;
}

module.exports = { SEAL, isSealed, createSecretBox, PLAIN_BOX, secretSlots, sealData, openData, collectSecrets, maskSecrets };
