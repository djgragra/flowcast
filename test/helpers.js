'use strict';
// Shared helpers for the tests: a fake "electron" (so store.js can be loaded without Electron),
// a fake system keystore, and a fresh temporary data folder.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

let _userData = os.tmpdir();
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => _userData, getVersion: () => '26.10.1' } };
  return origLoad.call(this, request, ...rest);
};

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'flowcast-test-')); }

// store.js reads the data folder when it is loaded: load it again for each folder
function freshStore(dir) {
  _userData = dir;
  for (const k of Object.keys(require.cache)) if (k.endsWith(path.join('src', 'store.js'))) delete require.cache[k];
  return require('../src/store');
}

// A keystore that "encrypts" by reversing the text; `locked` simulates another PC (cannot decrypt)
function fakeSafeStorage({ available = true, locked = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: s => Buffer.from('K' + [...s].reverse().join('')),
    decryptString: b => {
      if (locked) throw new Error('cannot decrypt');
      return [...b.toString().slice(1)].reverse().join('');
    }
  };
}

const SECRETS = { smtp: 'smtp-Pa55word!', token: '123456789:AAFexample_token_value_0123456789', ftp: 'ftp-Secr3t#1', bm: 'bm-Secr3t#2' };

function sampleData() {
  return {
    settings: {
      email: { enabled: true, smtp: { host: 'smtp.example.org', port: 587, user: 'alerts', password: SECRETS.smtp, secure: false },
               from: 'alerts@example.org', recipients: ['a@example.org', 'b@example.org'], onError: true, onNoUpdate: true, noUpdateStreakThreshold: 3 },
      telegram: { enabled: true, token: SECRETS.token, recipients: [{ chatId: '111', note: 'Anna' }], onError: true, onNoUpdate: false },
      language: 'en', updateAlert: true
    },
    shows: [{ id: 's1', name: 'Morning', category: 'News', ftp: { enabled: true, host: 'ftp.example.org', user: 'u', password: SECRETS.ftp } }],
    ftpBookmarks: [{ id: 'b1', name: 'Main FTP', host: 'ftp.example.org', user: 'u', password: SECRETS.bm }]
  };
}

module.exports = { tmpDir, freshStore, fakeSafeStorage, SECRETS, sampleData };
