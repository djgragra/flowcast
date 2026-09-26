'use strict';
// Main-process i18n: strings for logs, dialogs, notifications and email alerts.
const fs   = require('fs');
const path = require('path');

const SUPPORTED   = ['en', 'it', 'es'];
const DATE_LOCALE = { en: 'en-US', it: 'it-IT', es: 'es-ES' };

let _lang    = 'en';
let _strings = {};
let _fallback = null;

function readLocale(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${lang}.json`), 'utf8'));
  } catch(_) { return {}; }
}

function load(language) {
  const lang = ((language || 'en').split('-')[0]).toLowerCase();
  _lang = SUPPORTED.includes(lang) ? lang : 'en';
  _strings = readLocale(_lang);
  if (!_fallback) _fallback = readLocale('en');
}

function t(key, vars) {
  let s = _strings[key];
  if (s === undefined) s = (_fallback && _fallback[key]) || key;
  if (vars) Object.keys(vars).forEach(k => { s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k])); });
  return s;
}

function dateLocale() {
  return DATE_LOCALE[_lang] || 'en-US';
}

module.exports = { load, t, dateLocale };
