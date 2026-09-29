/* ── Practice memory: spaced repetition, days, streaks, focus ───────────────
   One record per mistake in nl:srs:<user>, keyed gameId:ply:
   { box, streak, due, last, lapses, learned, tricky, skips, ls, lt }.
   The ladder (days): 1, 3, 7, 16, 35, 90. A position is Learned after its
   third clean solve in a row, the last one 16 or more days after the one
   before; it then returns once, 90 days later, as a spot check, and a clean
   spot check retires it. Intervals of three days or more are spread by up to
   15% either way, fixed per position, so one busy day does not come back as
   one busy day. */

var SRS_DAYS = [1, 3, 7, 16, 35, 90];
var DAY = 864e5;
var srsRevision = 0;
var srsMem = null;
/* progress is kept per site and player: one handle on two sites is two people */
function playerId() { return (typeof isCC === 'function' && isCC() ? 'cc:' : '') + String(cfg.user).toLowerCase(); }
function srsKey() { return 'nl:srs:' + playerId(); }
function srsLoad() {
  if (srsMem && srsMem.key === srsKey()) return srsMem.map;
  srsMem = { key: srsKey(), map: store.get(srsKey(), {}) };
  return srsMem.map;
}
function srsSave(map) {
  /* another tab may have saved since this one read: per position, the
     record practised last wins, so two open tabs never erase each other */
  var disk = store.get(srsKey(), {});
  Object.keys(disk).forEach(function (k) {
    var d = disk[k], m = map[k];
    if (!m || (d.last || 0) > (m.last || 0)) map[k] = d;
  });
  srsMem = { key: srsKey(), map: map };
  store.set(srsKey(), map);
  srsRevision++;
}
function srsRec(it) { return srsLoad()[it.key] || null; }
function isLearned(rec) { return !!(rec && rec.learned); }

/* result: 'first' (no miss, no hint), 'hint' (a hint, or good-then-best),
   'retry' (solved after a miss), 'fail' (shown the answer), 'skip'.
   info: { ms: solve time, gameMove: the game move was tried again } */
function spreadDays(days, key) {
  if (days < 3) return days;
  var h = 0, s = String(key);
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return days * (0.85 + (Math.abs(h) % 1000) / 1000 * 0.3);
}
function srsRecord(it, result, info) {
  info = info || {};
  var map = srsLoad(), now = Date.now();
  var rec = map[it.key], fresh = !rec;
  rec = rec || { box: 0, streak: 0, due: null, last: null, lapses: 0 };
  var dueNow = fresh || rec.due == null || rec.due <= now + 12 * 3600 * 1000;
  var prevGap = rec.ls ? now - rec.ls : 0;
  if (result === 'skip') {
    rec.skips = (rec.skips || 0) + 1;
    if (dueNow) rec.due = now + DAY;
  } else if (result === 'first' && info.alt) {
    /* a move that works too is a pass, not the lesson: sooner, like a hint */
    rec.due = now + Math.max(1, Math.round(SRS_DAYS[rec.box] / 2)) * DAY;
    rec.ls = now;
  } else if (result === 'first') {
    /* a first sighting solved fast may still be a lucky guess: a week, not 16 days */
    if (fresh) rec.box = info.ms != null && info.ms < 20000 ? 2 : 1;
    else if (dueNow) rec.box = Math.min(rec.box + 1, SRS_DAYS.length - 2);
    var spotCheck = rec.learned && dueNow;
    if (fresh || dueNow) rec.streak = (rec.streak || 0) + 1;
    if (!fresh && dueNow && prevGap >= 15.5 * DAY && rec.streak >= 3) rec.learned = true;
    if (spotCheck) { rec.retired = 1; rec.due = null; }
    else rec.due = now + spreadDays(rec.learned ? SRS_DAYS[SRS_DAYS.length - 1] : SRS_DAYS[rec.box], it.key) * DAY;
    rec.ls = now;
  } else if (result === 'hint') {
    /* hard, not failed: the schedule holds its place, a little sooner */
    rec.due = now + spreadDays(Math.max(1, Math.round(SRS_DAYS[rec.box] / 2)), it.key) * DAY;
    rec.ls = now;
  } else if (result === 'retry') {
    rec.streak = 0;
    rec.learned = false;
    delete rec.retired;
    rec.box = Math.max(0, rec.box - 2);
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  } else {
    rec.lapses = (rec.lapses || 0) + 1;
    rec.streak = 0;
    rec.learned = false;
    delete rec.retired;
    rec.box = rec.box >= 3 ? 1 : 0;
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  }
  if (info.gameMove) { rec.box = 0; rec.due = now + DAY; rec.learned = false; }
  if ((rec.lapses || 0) >= 4) rec.tricky = 1;
  if (info.ms != null) rec.lt = info.ms;
  rec.last = now;
  map[it.key] = rec;
  srsSave(map);
  dayBump(result, fresh, info.attempted);
  return rec;
}
/* a miss breaks the run the moment it happens (the meter shows it) */
function srsNoteMiss(it) {
  var map = srsLoad(), rec = map[it.key];
  if (!rec) return 0;
  var had = rec.streak || 0;
  rec.streak = 0;
  map[it.key] = rec;
  srsSave(map);
  return had;
}
function srsHide(it) {
  var map = srsLoad(), rec = map[it.key] || { box: 0, streak: 0 };
  rec.hidden = 1;
  map[it.key] = rec;
  srsSave(map);
}

/* ── days, the streak and the weekly goal ────────────────────────────────── */
function dayStamp(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function dayKeyFor(d) { return 'nl:day:' + playerId() + ':' + dayStamp(d); }
function dayKey() { return dayKeyFor(new Date()); }
function dayLoad() { return store.get(dayKey(), { answered: 0, solved: 0, first: 0, fresh: 0 }); }
function daySave(day) { store.set(dayKey(), day); }
function dayBump(result, fresh, attempted) {
  var day = dayLoad();
  if (result !== 'skip') day.answered = (day.answered || 0) + 1;
  if (result !== 'skip' && attempted) day.attempted = (day.attempted || 0) + 1;
  if (result === 'first' || result === 'hint' || result === 'retry') day.solved = (day.solved || 0) + 1;
  if (result === 'first') day.first = (day.first || 0) + 1;
  if (fresh) day.fresh = (day.fresh || 0) + 1;
  daySave(day);
}
/* one rule, said the same way in Settings: a day counts when you finish a
   session in which you tried at least 3 positions, or all of them if it had
   fewer. Tried means a move was played; skips and reveal-only taps never
   count */
var DAY_RULE = 'A day counts when you finish a session in which you tried at least 3 positions, or all of them if it had fewer.';
function dayCounts(rec) { return !!(rec && (rec.sessions || 0) >= 1); }
function dayRecOf(d) { return store.get(dayKeyFor(d), null); }
function weekGoal() { return store.get('nl:weekGoal', 4); }
function mondayOf(d) { var m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - (m.getDay() + 6) % 7); return m.getTime(); }
/* a new goal applies from next Monday: past weeks keep the goal they had */
function setWeekGoal(n) {
  var next = mondayOf(new Date()) + 7 * DAY + 3 * 3600 * 1000;
  var h = (store.get('nl:goalHist', null) || [{ from: 0, goal: weekGoal() }]).filter(function (e) { return e.from < mondayOf(next); });
  h.push({ from: mondayOf(next), goal: n });
  store.set('nl:goalHist', h);
  store.set('nl:weekGoal', n);
}
function weekGoalAt(ms) {
  var h = store.get('nl:goalHist', null);
  if (!h || !h.length) return weekGoal();
  var g = h[0].goal;
  h.forEach(function (e) { if (e.from <= ms) g = e.goal; });
  return g;
}
function goalThisWeek() { return weekGoalAt(Date.now()); }
/* consistency counted in weeks: the run of Monday-to-Sunday weeks that met
   the goal, this week included once it is met; a week still under way never
   breaks the run */
function weeksAtGoal() {
  var n = 0, d = new Date();
  d.setHours(12, 0, 0, 0);
  var dow = (d.getDay() + 6) % 7, monday = new Date(d);
  monday.setDate(d.getDate() - dow);
  var count = function (mon, days) {
    var c = 0;
    for (var i = 0; i < days; i++) { var x = new Date(mon); x.setDate(mon.getDate() + i); if (dayCounts(dayRecOf(x))) c++; }
    return c;
  };
  if (count(monday, dow + 1) >= weekGoalAt(monday.getTime())) n++;
  for (var w = 1; w < 105; w++) {
    var m = new Date(monday);
    m.setDate(monday.getDate() - 7 * w);
    if (count(m, 7) >= weekGoalAt(m.getTime())) n++; else break;
  }
  return n;
}
function weekDays() {
  var d = new Date(), n = 0, dow = (d.getDay() + 6) % 7;   /* Monday = 0 */
  for (var i = 0; i <= dow; i++) {
    var x = new Date(d); x.setDate(d.getDate() - i);
    if (dayCounts(dayRecOf(x))) n++;
  }
  return n;
}

/* ── families: the habit behind a pattern ────────────────────────────────── */
var FAMILIES = [
  { key: 'safety', name: 'Giving away material',
    habit: 'Before every move, look at what your opponent can capture next.',
    types: ['hung', 'threat', 'forkAllowed', 'pinAllowed', 'discoveredAllowed', 'badTrade', 'material', 'promotion'] },
  { key: 'king', name: 'King danger',
    habit: 'Before every move, look at every check your opponent could give.',
    types: ['mateAllowed', 'kingSafety'] },
  { key: 'chances', name: 'Missed chances',
    habit: 'After every opponent move, look for your own checks, captures and threats.',
    types: ['missedMaterial', 'missedTactic', 'mateMissed'] },
  { key: 'conversion', name: 'Letting wins slip',
    habit: 'When you are winning: trade pieces, keep your king safe, take no risks.',
    types: ['slipped'] },
  { key: 'quiet', name: 'Quiet mistakes',
    habit: 'When nothing is happening, find your worst piece and improve it.',
    types: ['openingSlip', 'drift', 'endgame'] }
];
var FAMILY_OF = {};
FAMILIES.forEach(function (f) { f.types.forEach(function (t) { FAMILY_OF[t] = f; }); });
function familyOf(patternKey) { return FAMILY_OF[patternKey] || FAMILIES[4]; }

