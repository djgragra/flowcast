'use strict';
const cron = require('node-cron');

// Map: showId → cron task
const _tasks = new Map();

// freq: 'daily' | 'weekdays' | 'weekend' | 'specific'
// days: array of 'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN'
// time: 'HH:MM'
function buildCronExpr(time, freq, days) {
  const [hh, mm] = time.split(':').map(Number);
  const dayMap = { MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6, SUN:0 };

  let dayPart;
  switch(freq) {
    case 'daily':    dayPart = '*';    break;
    case 'weekdays': dayPart = '1-5';  break;
    case 'weekend':  dayPart = '0,6';  break;
    case 'specific':
      dayPart = (days || []).map(d => dayMap[d]).filter(n => n !== undefined).join(',') || '*';
      break;
    default:         dayPart = '*';
  }
  return `${mm} ${hh} * * ${dayPart}`;
}

function scheduleShow(show, onTrigger) {
  cancelShow(show.id);
  if (!show.enabled) return;
  if (show.mode === 'manual') return;   // manual shows never auto-run

  const sch = show.schedule;
  if (!sch || !sch.time) return;

  const expr = buildCronExpr(sch.time, sch.freq, sch.days);
  // No timezone option: schedules follow the computer's local time,
  // like nextRun() and the catch-up check in main.js
  const task = cron.schedule(expr, () => {
    onTrigger(show.id);
  });

  _tasks.set(show.id, task);
}

function cancelShow(id) {
  if (_tasks.has(id)) {
    _tasks.get(id).destroy();
    _tasks.delete(id);
  }
}

function cancelAll() {
  for (const [id] of _tasks) cancelShow(id);
}

function nextRun(show) {
  const sch = show.schedule;
  if (!sch || !sch.time || !show.enabled) return null;
  try {
    const [hh, mm] = sch.time.split(':').map(Number);
    const dayMap = { MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6, SUN:0 };
    const now  = new Date();
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    // Respect startDate: if show hasn't started yet, jump to that date
    if (sch.startDate) {
      const start = new Date(sch.startDate + 'T00:00:00');
      if (next < start) {
        next.setFullYear(start.getFullYear(), start.getMonth(), start.getDate());
        next.setHours(hh, mm, 0, 0);
      }
    }

    // Advance until matching day
    const maxDays = 14;
    let tried = 0;
    while (tried < maxDays) {
      const dow = next.getDay(); // 0=Sun
      let ok = false;
      if (sch.freq === 'daily')    ok = true;
      if (sch.freq === 'weekdays') ok = dow >= 1 && dow <= 5;
      if (sch.freq === 'weekend')  ok = dow === 0 || dow === 6;
      if (sch.freq === 'specific') ok = (sch.days || []).some(d => dayMap[d] === dow);
      if (ok) return next;
      next.setDate(next.getDate() + 1);
      tried++;
    }
    return null;
  } catch(e) { return null; }
}

module.exports = { scheduleShow, cancelShow, cancelAll, nextRun };
