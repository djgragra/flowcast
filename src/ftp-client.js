'use strict';
const ftp  = require('basic-ftp');
const path = require('path');
const { t } = require('./i18n');

const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 8000; // 8s, 16s between retries

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function attemptUpload(ftpConfig, localFilePath, logFn, timeoutMs) {
  // basic-ftp Client constructor accepts optional timeout in ms
  const client = new ftp.Client(timeoutMs || 30000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host:     ftpConfig.host,
      port:     ftpConfig.port || 21,
      user:     ftpConfig.user,
      password: ftpConfig.password,
      secure:   ftpConfig.secure || false
    });
    logFn(t('ftp.connected', { host: ftpConfig.host }));
    const remotePath = ftpConfig.remotePath || '/';
    await client.ensureDir(remotePath);
    await client.cd(remotePath);
    const filename = path.basename(localFilePath);
    logFn(t('ftp.uploading', { file: filename, path: remotePath }));
    await client.uploadFrom(localFilePath, filename);
    logFn(t('ftp.uploaded', { file: filename }));
    return { success: true };
  } finally {
    client.close();
  }
}

async function upload(ftpConfig, localFilePath, logFn, timeoutMs) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const delay = RETRY_DELAY_MS * (attempt - 1);
      logFn(t('ftp.retry', { attempt, max: MAX_RETRIES, sec: delay / 1000 }));
      await sleep(delay);
    }
    try {
      return await attemptUpload(ftpConfig, localFilePath, logFn, timeoutMs);
    } catch(e) {
      lastError = e;
      logFn(t('ftp.attempt_failed', { attempt, max: MAX_RETRIES, error: e.message }));
    }
  }
  logFn(t('ftp.final_error', { max: MAX_RETRIES, error: lastError.message }));
  return { success: false, error: lastError.message };
}

async function testConnection(ftpConfig, timeoutMs) {
  const client = new ftp.Client(timeoutMs || 30000);
  try {
    await client.access({
      host:     ftpConfig.host,
      port:     ftpConfig.port || 21,
      user:     ftpConfig.user,
      password: ftpConfig.password,
      secure:   ftpConfig.secure || false
    });
    const list = await client.list();
    return { success: true, message: t('ftp.test_ok', { n: list.length }) };
  } catch(e) {
    return { success: false, message: e.message };
  } finally {
    client.close();
  }
}

module.exports = { upload, testConnection };
