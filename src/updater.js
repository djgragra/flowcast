'use strict';
// Update check: asks GitHub for the latest release of the public repository and compares
// it with the running version. On request it downloads the installer for this platform,
// verifies it against the release's SHA256SUMS.txt and hands it to the user to install.
const { app, net } = require('electron');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function parts(v) {
  return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}

// true only if latest is strictly greater: the same version counts as up to date
function isNewer(latest, current) {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function checkForUpdate(repo) {
  const current = app.getVersion();
  if (!REPO_RE.test(repo || '')) return { ok: false, current, error: 'invalid-repo' };
  try {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `FlowCast/${current}` },
      signal: AbortSignal.timeout(15000)
    });
    // 404 = no published release (or repository not reachable): not an error for the user
    if (res.status === 404) return { ok: true, current, available: false, noRelease: true };
    if (!res.ok) return { ok: false, current, error: `GitHub HTTP ${res.status}` };
    const rel    = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    // Only ever open this repository's release pages, never a URL taken as-is from the response
    const url    = `https://github.com/${repo}/releases/tag/${encodeURIComponent(rel.tag_name || '')}`;
    const assets = releaseAssets(repo, rel);
    return { ok: true, current, latest, available: isNewer(latest, current), url,
             installer: pickInstaller(assets), notes: String(rel.body || '').slice(0, 2000), sumsUrl: (assets.find(a => a.name === 'SHA256SUMS.txt') || {}).url || null };
  } catch(e) {
    return { ok: false, current, error: e.message };
  }
}

// Assets of the release, keeping only download URLs of this repository
function releaseAssets(repo, rel) {
  const prefix = `https://github.com/${repo}/releases/download/`;
  return (rel.assets || [])
    .filter(a => typeof a.browser_download_url === 'string' && a.browser_download_url.startsWith(prefix))
    .map(a => ({ name: String(a.name), url: a.browser_download_url, size: a.size || 0 }));
}

// Installer for the running platform: Windows setup .exe, macOS .dmg (matching the CPU), Linux .AppImage
function pickInstaller(assets, platform = process.platform, arch = process.arch) {
  const tests = {
    win32:  n => /^FlowCast-Setup-[\d.]+\.exe$/i.test(n),
    darwin: n => arch === 'arm64' ? /-arm64\.dmg$/i.test(n) : /\.dmg$/i.test(n) && !/arm64/i.test(n),
    linux:  n => /\.AppImage$/i.test(n)
  };
  const test = tests[platform];
  return (test && assets.find(a => test(a.name))) || null;
}

// Downloads the installer into dir, reporting progress, and checks it against SHA256SUMS.txt.
// A file that does not match is deleted.
async function downloadInstaller(info, dir, onProgress) {
  if (!info || !info.installer) throw new Error('no-installer');
  if (!info.sumsUrl) throw new Error('no-checksums');
  const { name, url } = info.installer;
  const headers = { 'User-Agent': `FlowCast/${app.getVersion()}` };

  const sumsRes = await net.fetch(info.sumsUrl, { headers, signal: AbortSignal.timeout(30000) });
  if (!sumsRes.ok) throw new Error(`SHA256SUMS.txt: HTTP ${sumsRes.status}`);
  const line = (await sumsRes.text()).split('\n').map(l => l.trim().split(/\s+\*?/)).find(p => p[1] === name);
  if (!line || !/^[0-9a-f]{64}$/i.test(line[0])) throw new Error('no-checksums');
  const expected = line[0].toLowerCase();

  const res = await net.fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || info.installer.size || 0;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(name));
  const out  = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let received = 0, lastReport = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      const now = Date.now();
      if (onProgress && now - lastReport > 250) { lastReport = now; onProgress(received, total); }
    }
    await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
  } catch(e) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw e;
  }
  if (onProgress) onProgress(received, total);
  if (hash.digest('hex') !== expected) {
    fs.rmSync(file, { force: true });
    throw new Error('checksum-mismatch');
  }
  return file;
}

module.exports = { REPO_RE, isNewer, checkForUpdate, pickInstaller, downloadInstaller };
