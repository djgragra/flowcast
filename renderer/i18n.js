'use strict';

(function () {
  let _locale = {};
  let _lang = 'en';

  const DATE_LOCALE = { en: 'en-US', it: 'it-IT', es: 'es-ES' };

  function load(lang) {
    const supported = ['en', 'it', 'es'];
    _lang = supported.includes(lang) ? lang : 'en';
    _locale = (window.LOCALES && window.LOCALES[_lang])
           || (window.LOCALES && window.LOCALES['en'])
           || {};
  }

  function t(key, vars) {
    let str = _locale[key];
    if (str === undefined) str = key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
      });
    }
    return str;
  }

  function dateLocale() {
    return DATE_LOCALE[_lang] || 'en-US';
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  window.t          = t;
  window.i18n       = { load, t, applyI18n, dateLocale };
})();
