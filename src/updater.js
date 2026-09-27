'use strict';
// Update notice only: asks GitHub for the latest release of the public repository and
// compares it with the running version. Nothing is downloaded or installed automatically.
const { app, net } = require('electron');

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
    return { ok: true, current, latest, available: isNewer(latest, current), url };
  } catch(e) {
    return { ok: false, current, error: e.message };
  }
}

module.exports = { REPO_RE, isNewer, checkForUpdate };
