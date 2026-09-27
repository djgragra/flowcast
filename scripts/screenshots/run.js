'use strict';
// Usage: node scripts/screenshots/run.js [outputDir]   (npm run screenshots)
// Starts FlowCast in "screenshots" mode: it renders the website PNGs into outputDir and quits.
const { spawnSync } = require('child_process');
const path     = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..', '..');
const out  = path.resolve(process.argv[2] || path.join(root, 'release', 'screenshots'));
const res  = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FLOWCAST_SHOTS_OUT: out }
});
process.exit(res.status === null ? 1 : res.status);
