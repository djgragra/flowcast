'use strict';
// The summary ("digest"): one text with what every show did in the last 24 hours or 7 days, and the rules
// for when it is due. Pure functions (no files, no Electron), so the tests can check them.
// Settings: digest = { enabled, frequency: 'daily' | 'weekly' (Monday), times: ['08:00', …], when: 'always' | 'problems' }
const { t, dateLocale } = require('./i18n');

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm  = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Latest time of today that has already passed, as "YYYY-MM-DD HH:MM" ('' if none yet)
function passedSlotKey(times, date) {
  const passed = (times || []).filter(x => x <= hm(date)).sort();
  return passed.length ? `${ymd(date)} ${passed[passed.length - 1]}` : '';
}

// The time to send now, or null. Once per time and day: lastKey is the last one sent (kept in alert-state.json).
// A PC that was off at the time sends at the first start after it (the latest time that has passed, once).
// Weekly: only on Mondays.
function dueSlot(digest, date, lastKey) {
  if (!digest || !digest.enabled) return null;
  if (digest.frequency === 'weekly' && date.getDay() !== 1) return null;
  const key = passedSlotKey(digest.times, date);
  return key && key > String(lastKey || '') ? key : null;
}

// How a history entry counts: a production whose upload, copy or archive failed is a failure
function outcome(entry) {
  if (!entry) return null;
  if (entry.result === 'error') return 'failed';
  if (entry.result === 'no-update') return 'noUpdate';
  if (entry.result === 'ok') return entry.details && Object.values(entry.details).includes('error') ? 'failed' : 'ok';
  return null;
}

// shows: the show records; historyByShow: { [id]: entries (newest first) }; days: 1 or 7.
// Returns { subject, body, problems } (problems = number of shows that need attention).
function buildDigest(shows, historyByShow, { now = new Date(), days = 1 } = {}) {
  const from = now.getTime() - days * 86_400_000;
  const loc = dateLocale();
  const fmt = iso => new Date(iso).toLocaleString(loc, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lines = [];
  let problems = 0;
  for (const show of shows.filter(s => s && s.enabled !== false)) {
    const entries = (historyByShow && historyByShow[show.id]) || [];
    const c = { ok: 0, failed: 0, noUpdate: 0 };
    for (const e of entries) {
      if (new Date(e.date).getTime() < from) continue;
      const o = outcome(e);
      if (o) c[o]++;
    }
    const last = entries.find(e => outcome(e) === 'ok');
    if (c.failed || c.noUpdate) problems++;
    lines.push(t('digest.show_line', { name: show.name, ok: c.ok, failed: c.failed, noupd: c.noUpdate, last: last ? fmt(last.date) : t('digest.never') }));
  }
  const head = [t(days === 7 ? 'digest.period_weekly' : 'digest.period_daily'), t('mail.date', { date: now.toLocaleString(loc) }), ''];
  const tail = ['', lines.length ? (problems ? t('digest.problems', { n: problems }) : t('digest.all_ok')) : t('digest.no_shows')];
  return {
    subject: t(days === 7 ? 'digest.subject_weekly' : 'digest.subject_daily'),
    body: [...head, ...lines, ...tail].join('\n'),
    problems
  };
}

module.exports = { passedSlotKey, dueSlot, outcome, buildDigest };
