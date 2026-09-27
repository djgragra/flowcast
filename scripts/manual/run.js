'use strict';
// Usage: node scripts/manual/run.js [outputDir]   (npm run manual)
// Starts FlowCast in "manual" mode: it renders the PDF manuals into outputDir and quits.
const { spawnSync } = require('child_process');
const path     = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..', '..');
const out  = path.resolve(process.argv[2] || path.join(root, 'dist'));
const res  = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FLOWCAST_MANUAL_OUT: out }
});
process.exit(res.status === null ? 1 : res.status);
