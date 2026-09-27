'use strict';
// FFmpeg executable to use. An explicit path from Settings wins. With the default "ffmpeg",
// macOS apps started from the Finder do not see the shell PATH, so the usual Homebrew and
// MacPorts locations are tried before falling back to the PATH lookup.
const fs = require('fs');

const CANDIDATES = {
  darwin: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg'],
  linux:  ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg']
};

function resolveFfmpeg(setting) {
  const p = String(setting || '').trim();
  if (p && p !== 'ffmpeg') return p;
  for (const c of CANDIDATES[process.platform] || []) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch(_) {}
  }
  return 'ffmpeg';
}

module.exports = { resolveFfmpeg };
