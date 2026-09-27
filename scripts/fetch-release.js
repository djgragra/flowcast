'use strict';
// Usage: npm run release:local [-- <version>]
// Downloads the installer, manuals and SHA256SUMS.txt of a published GitHub release
// into release/<version>/ and verifies every file against SHA256SUMS.txt.
// Needs the GitHub CLI (gh). Default version: the one in package.json.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT    = path.join(__dirname, '..');
const REPO    = 'djgragra/flowcast';
const version = (process.argv[2] || require(path.join(ROOT, 'package.json')).version).replace(/^v/, '');
const dir     = path.join(ROOT, 'release', version);

fs.mkdirSync(dir, { recursive: true });
console.log(`Downloading v${version} from ${REPO} into ${path.relative(ROOT, dir)}/`);
execFileSync('gh', ['release', 'download', `v${version}`, '--repo', REPO, '--dir', dir, '--clobber'], { stdio: 'inherit' });

// GitHub may rename assets (spaces become dots): match by hash, not only by name
const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
  .map(line => { const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim()); return m && { hash: m[1], name: m[2] }; })
  .filter(Boolean);
let failed = 0;
for (const { hash, name } of sums) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) { console.log(`MISSING  ${name}`); failed++; continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const ok = actual === hash;
  if (!ok) failed++;
  console.log(`${ok ? 'OK      ' : 'MISMATCH'} ${name}`);
}
if (failed) { console.error(`\n${failed} file(s) failed verification`); process.exit(1); }
console.log(`\nAll files verified: ${dir}`);
