'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf-8');

const rendererLocale = l => { const w = {}; new Function('window', read(`renderer/locales/${l}.js`))(w); return w.LOCALES[l]; };
const mainLocale = l => JSON.parse(read(`src/locales/${l}.json`));

test('texts: English, Italian and Spanish have exactly the same keys (main process and window)', () => {
  for (const [name, load] of [['src/locales', mainLocale], ['renderer/locales', rendererLocale]]) {
    const en = Object.keys(load('en')).sort();
    for (const l of ['it', 'es']) assert.deepEqual(Object.keys(load(l)).sort(), en, `${name}/${l} differs from en`);
  }
});

test('texts: every key the code asks for exists, and no text is empty', () => {
  const src = ['src/notify.js', 'src/digest.js', 'src/store.js', 'src/ftp-client.js', 'main.js'].map(read).join('\n');
  const mainKeys = [...src.matchAll(/\b(?:t|mt)\('([\w.]+)'/g)].map(m => m[1]);
  for (const l of ['en', 'it', 'es']) {
    const loc = mainLocale(l);
    for (const k of mainKeys) assert.ok(k in loc, `src/locales/${l}.json lacks ${k}`);
    assert.ok(Object.values(loc).every(v => String(v).trim()));
  }
  const html = read('renderer/index.html');
  const ui = [...html.matchAll(/data-i18n(?:-html|-placeholder|-title|-href)?="([\w.]+)"/g)].map(m => m[1]);
  const js = read('renderer/renderer.js') + read('renderer/dashboard.js');
  const codeKeys = [...js.matchAll(/\bt\('([\w.-]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.'));   // 'cfg.kind.' + kind is checked below
  for (const l of ['en', 'it', 'es']) {
    const loc = rendererLocale(l);
    for (const k of [...ui, ...codeKeys]) assert.ok(k in loc, `renderer/locales/${l}.js lacks ${k}`);
    for (const kind of ['smtp', 'telegram', 'ftp-show', 'ftp-bookmark']) assert.ok(`cfg.kind.${kind}` in loc);
  }
});

test('email settings: same layout as the other OnAir Garage apps (server, port, user, password, sender, recipients in one field, TLS box, test button)', () => {
  const html = read('renderer/index.html');
  const section = html.slice(html.indexOf('id="set-alerts"'), html.indexOf('id="set-backup"'));
  const ids = [...section.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]);
  const order = ['s-email-enabled', 's-smtp-host', 's-smtp-port', 's-smtp-user', 's-smtp-pass', 's-smtp-from', 's-email-recipients', 's-smtp-secure'];
  const pos = order.map(id => ids.indexOf(id));
  assert.ok(pos.every(p => p >= 0), 'a field is missing: ' + JSON.stringify(pos));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'fields are in a different order');
  assert.ok(ids.indexOf('btn-test-email') > ids.indexOf('s-smtp-secure'));
  assert.ok(!ids.some(id => /^s-email-recip-\d$/.test(id)), 'the three separate recipient fields are gone');
  assert.equal(ids.filter(id => id === 's-email-recipients').length, 1);
  assert.match(section, /type="password" id="s-smtp-pass"/);
  assert.ok(ids.includes('btn-test-telegram'));
});

test('backup screen: the "Include passwords and tokens" box exists, is off by default, and has a warning', () => {
  const html = read('renderer/index.html');
  assert.match(html, /<input type="checkbox" id="s-export-secrets">/);
  assert.match(html, /id="export-secrets-warn"/);
  assert.match(read('renderer/renderer.js'), /api\.exportConfig\(document\.getElementById\('s-export-secrets'\)\.checked\)/);
});

test('every api.* call of the window exists in preload.js', () => {
  const preload = read('preload.js');
  const defined = new Set([...preload.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]));
  const used = new Set();
  for (const f of ['renderer/renderer.js', 'renderer/dashboard.js']) for (const m of read(f).matchAll(/\bapi\.(\w+)/g)) used.add(m[1]);
  for (const name of used) assert.ok(defined.has(name), `api.${name} is not exposed by preload.js`);
  // and every channel preload invokes has a handler in main.js
  const main = read('main.js');
  for (const m of preload.matchAll(/invoke\('([\w-]+)'/g)) assert.ok(main.includes(`'${m[1]}'`), `no handler for ${m[1]}`);
});

test('tip card (Help & About): text, pill and link in the three languages, jar image shipped, link only to the site\'s support page', () => {
  const html = read('renderer/index.html');
  assert.match(html, /<img class="tip-jar" src="img\/tip-jar\.png" alt="">|<img class="tip-jar" src="img\/tip-jar\.png" alt="" width/);
  assert.ok(fs.existsSync(path.join(root, 'renderer/img/tip-jar.png')));
  // the jar is a second link to the same page (decorative: not in the tab order, hidden from screen readers)
  assert.match(html, /<a class="tip-jar-link" href="https:\/\/onairgarage\.com\/support\/" data-i18n-href="about\.tip\.url" tabindex="-1" aria-hidden="true"><img class="tip-jar"/);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('renderer/**/*'));
  const urls = { en: 'https://onairgarage.com/support/', it: 'https://onairgarage.com/it/support/', es: 'https://onairgarage.com/es/support/' };
  for (const l of ['en', 'it', 'es']) {
    const loc = rendererLocale(l);
    assert.equal(loc['about.tip.url'], urls[l]);
    assert.ok(loc['about.tip.text'].trim() && loc['about.tip.link'].trim());
  }
  assert.equal(rendererLocale('en')['about.tip.link'], 'Tip jar');
  assert.equal(rendererLocale('it')['about.tip.link'], 'Salvadanaio');
  assert.equal(rendererLocale('es')['about.tip.link'], 'Hucha');
  // no pop-up, no reminder: the card is only in the About page and nothing in the code opens it by itself
  assert.equal((html.match(/class="tip-card"/g) || []).length, 1);
  assert.ok(html.indexOf('class="tip-card"') > html.indexOf('id="set-about"'));
});
