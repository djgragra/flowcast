'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('macOS: the ad-hoc signature hook is wired into the build and only acts on a Mac app', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.afterPack, 'dev/sign-adhoc.cjs');
  assert.ok(fs.existsSync(path.join(root, pkg.build.afterPack)));
  const hook = require('../dev/sign-adhoc.cjs').default;
  assert.equal(await hook({ electronPlatformName: 'win32' }), undefined); // nothing on Windows
  assert.equal(await hook({ electronPlatformName: 'linux' }), undefined);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/build-installers.yml'), 'utf8');
  assert.match(wf, /codesign --verify --deep --strict/, 'the workflow checks the apps inside the disk images');
});

test('main window: runs in the Electron sandbox with context isolation', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true/);
});
