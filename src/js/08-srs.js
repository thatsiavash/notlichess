/* ── Practice memory: spaced repetition, days, streaks, focus ───────────────
   One record per mistake in nl:srs:<user>, keyed gameId:ply:
   { box, streak, due, last, lapses, learned, tricky, skips, ls, lt }.
   The ladder (days): 1, 3, 7, 16, 35, 90. A position is Learned after a
   clean first-try solve that came 16 or more days after the previous one;
   it then returns once, 90 days later, as a spot check. */

var SRS_DAYS = [1, 3, 7, 16, 35, 90];
var DAY = 864e5;
var srsRevision = 0;
var srsMem = null;
function srsKey() { return 'nl:srs:' + String(cfg.user).toLowerCase(); }
/* the retired opening trainer kept its lines in the same map under l|...;
   they are set aside, untouched, and written back with every save, so the
   progress survives if that trainer ever returns */
function splitSrs(raw) {
  var map = {}, kept = {};
  Object.keys(raw || {}).forEach(function (k) { (k.indexOf('l|') === 0 ? kept : map)[k] = raw[k]; });
  return { map: map, kept: kept };
}
function srsLoad() {
  if (srsMem && srsMem.key === srsKey()) return srsMem.map;
  var parts = splitSrs(store.get(srsKey(), {}));
  srsMem = { key: srsKey(), map: parts.map, kept: parts.kept };
  return parts.map;
}
function srsSave(map) {
  var kept = srsMem && srsMem.key === srsKey() ? srsMem.kept : splitSrs(store.get(srsKey(), {})).kept;
  srsMem = { key: srsKey(), map: map, kept: kept };
  var out = {};
  Object.keys(kept).forEach(function (k) { out[k] = kept[k]; });
  Object.keys(map).forEach(function (k) { out[k] = map[k]; });
  store.set(srsKey(), out);
  srsRevision++;
}
function srsRec(it) { return srsLoad()[it.key] || null; }
function isLearned(rec) { return !!(rec && (rec.learned || rec.mastered)); }

/* result: 'first' (no miss, no hint), 'hint' (a hint, or good-then-best),
   'retry' (solved after a miss), 'fail' (shown the answer), 'skip'.
   info: { ms: solve time, gameMove: the game move was tried again } */
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
  } else if (result === 'first') {
    if (fresh) rec.box = info.ms != null && info.ms < 20000 ? 3 : 1;
    else if (dueNow) rec.box = Math.min(rec.box + 1, SRS_DAYS.length - 2);
    if (fresh || dueNow) rec.streak = (rec.streak || 0) + 1;
    if (!fresh && dueNow && prevGap >= 15.5 * DAY && rec.streak >= 2) rec.learned = true;
    rec.due = now + (rec.learned ? SRS_DAYS[SRS_DAYS.length - 1] : SRS_DAYS[rec.box]) * DAY;
    rec.ls = now;
  } else if (result === 'hint') {
    /* hard, not failed: the schedule holds its place, a little sooner */
    rec.due = now + Math.max(1, Math.round(SRS_DAYS[rec.box] / 2)) * DAY;
    rec.ls = now;
  } else if (result === 'retry') {
    rec.streak = 0;
    rec.learned = false;
    rec.box = Math.max(0, rec.box - 2);
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  } else {
    rec.lapses = (rec.lapses || 0) + 1;
    rec.streak = 0;
    rec.learned = false;
    rec.box = rec.box >= 3 ? 1 : 0;
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  }
  if (info.gameMove) { rec.box = 0; rec.due = now + DAY; rec.learned = false; }
  if ((rec.lapses || 0) >= 4) rec.tricky = 1;
  if (info.ms != null) rec.lt = info.ms;
  delete rec.mastered;
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
function dayKeyFor(d) { return 'nl:day:' + String(cfg.user).toLowerCase() + ':' + dayStamp(d); }
function dayKey() { return dayKeyFor(new Date()); }
function dayLoad() { return store.get(dayKey(), { answered: 0, solved: 0, first: 0, fresh: 0 }); }
function daySave(day) { store.set(dayKey(), day); }
function dayBump(result, fresh, attempted) {
  var day = dayLoad();
  if (result !== 'skip') day.answered = (day.answered || 0) + 1;
  if (result !== 'skip' && attempted) day.attempted = (day.attempted || 0) + 1;
  if (result === 'first' || result === 'hint' || result === 'retry') day.solved = (day.solved || 0) + 1;
  if (result === 'first') day.first = (day.first || 0) + 1;
  if (fresh && result !== 'skip') day.fresh = (day.fresh || 0) + 1;
  daySave(day);
}
/* a day counts once five positions were tried (a reveal-only tap does not
   count), a session of three or more was finished, or everything due was
   cleared; old records count too */
function dayCounts(rec) {
  if (!rec) return false;
  return Math.max(rec.solved || 0, rec.attempted || 0) >= 5 || !!rec.cleared || (rec.sessions || 0) >= 1
    || (rec.sets || 0) >= 1 || (rec.trained || 0) >= 5;
}
function dayRecOf(d) { return store.get(dayKeyFor(d), null); }
/* the run of days, forgiving: two missed days in any seven are free, the
   third breaks it. Today not yet done never breaks anything. */
function streakInfo() {
  var d = new Date(), days = 0, misses = [], best = store.get('nl:bestStreak:' + String(cfg.user).toLowerCase(), 0);
  if (!dayCounts(dayRecOf(d))) d.setDate(d.getDate() - 1);
  for (var i = 0; i < 400; i++) {
    if (dayCounts(dayRecOf(d))) days++;
    else {
      misses.push(i);
      var recent = misses.filter(function (m) { return i - m < 7; }).length;
      if (recent > 2) break;
    }
    d.setDate(d.getDate() - 1);
  }
  if (days > best) { best = days; store.set('nl:bestStreak:' + String(cfg.user).toLowerCase(), best); }
  return { days: days, best: best, today: dayCounts(dayRecOf(new Date())) };
}
function weekGoal() { return store.get('nl:weekGoal', 4); }
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

