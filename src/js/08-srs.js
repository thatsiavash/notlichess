/* ── Practice memory: spaced repetition, days, streaks, focus ───────────────
   One record per mistake in nl:srs:<user>, keyed gameId:ply:
   { box, streak, due, last, lapses, learned, tricky, skips, ls, lt, n, fc,
   rs (the time of the current run's first clean find), sp (the time it was
   spread to a later day, F7.1), q (the time it went back to the queue) }.
   The ladder (days): 1, 3, 7, 16, 35, 90. A position is Learned after its
   third clean solve in a row, the last one 16 or more days after the one
   before (at tiers 2 and 3 that one in game mode, under 30 s or 60 s at
   tier 3: F8.3); it then returns once, 90 days later, as a spot check, and
   a clean spot check retires it. Intervals of three days or more are spread by up to
   15% either way, fixed per position, so one busy day does not come back as
   one busy day. An answer before the due date never moves the date later
   (a clean find changes nothing; a hint or a miss may bring it sooner). */

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
/* when a record last changed: answered, spread or queued (F7.1) */
function srsTouched(r) { return Math.max(r.last || 0, r.sp || 0, r.q || 0); }
function srsSave(map) {
  /* another tab may have saved since this one read: per position, the
     record changed last wins, so two open tabs never erase each other's
     answers, nor the day's spreading */
  var disk = store.get(srsKey(), {});
  Object.keys(disk).forEach(function (k) {
    var d = disk[k], m = map[k];
    if (!m || srsTouched(d) > srsTouched(m)) map[k] = d;
  });
  srsMem = { key: srsKey(), map: map };
  practiceWrite(srsKey(), map);
  srsRevision++;
}
/* a practice write (the schedule, a day) the browser refuses, out of room:
   the game cache gives way first, step by step down its own ladder
   (saveGames: movetext kept for later scans, other players' games, games
   without cards, then the rest), the write tried again after each step.
   If it still fails, one notice a visit says so and offers the progress
   file; a private window that keeps nothing gets the same notice once. The
   value stays in the store's memory for this visit either way, and after
   one failure the ladder is not walked again this visit */
var ROOM_NOTE = 'This browser is out of room, so your last answers may not be kept. Save a progress file in Settings.';
function practiceWrite(k, v) {
  if (store.set(k, v)) return true;
  var ok = false;
  if (!data.roomFailed && cfg.user && data.games && data.games.length && !data.wiped)
    saveGames(data.games, function () { return (ok = store.set(k, v)); });
  if (ok) return true;
  data.roomFailed = true;
  if (!data.roomWarned) {
    data.roomWarned = true;
    notice(ROOM_NOTE, { act: 'exportProgress', label: 'Save' });
  }
  return false;
}
function srsRec(it) { return srsLoad()[it.key] || null; }
function isLearned(rec) { return !!(rec && rec.learned); }

/* the find that makes a position learned at tiers 2 and 3, at most this
   long (F8.3: 30 s, 60 s at tier 3) */
var LEARN_MS = 30000, LEARN_MS_T3 = 60000;
function learnMs(tier) { return tier >= 3 ? LEARN_MS_T3 : LEARN_MS; }
function spreadDays(days, key) {
  if (days < 3) return days;
  var h = 0, s = String(key);
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return days * (0.85 + (Math.abs(h) % 1000) / 1000 * 0.3);
}
/* result: 'first' (no miss, no hint), 'hint' (a hint, or good-then-best),
   'retry' (solved after a miss), 'fail' (shown the answer), 'skip'.
   info: { ms: solve time, gameMove: the game move was tried again, tier and
   game: the card's tier and whether it showed in game mode (F8.3); held is
   written back when a find that would make it learned holds instead } */
function srsRecord(it, result, info) {
  info = info || {};
  var map = srsLoad(), now = Date.now();
  var rec = map[it.key], fresh = !rec;
  rec = rec || { box: 0, streak: 0, due: null, last: null, lapses: 0 };
  /* a position back from the queue (F7.1) comes back as new: its history
     (lapses, answers, wrong tries) is kept, its ladder starts again */
  var anew = fresh || !!rec.q;
  if (rec.q) { rec.box = 0; rec.streak = 0; rec.due = null; rec.learned = false; delete rec.rs; delete rec.retired; delete rec.q; }
  var wasLearned = !!rec.learned;
  /* a spread position is graded as due, so it still climbs (F7.1) */
  var dueNow = anew || !!rec.sp || rec.due == null || rec.due <= now + 12 * 3600 * 1000;
  var prevGap = rec.ls ? now - rec.ls : 0;
  if (result === 'skip') {
    rec.skips = (rec.skips || 0) + 1;
    if (dueNow) rec.due = now + DAY;
  } else if (!dueNow && result !== 'retry' && result !== 'fail') {
    /* found before its due date (practice, a drill): never an early
       review that moves the date (F7.1). A clean find changes nothing; a
       hint brings it back no later than a hint would */
    if (result === 'hint') rec.due = Math.min(rec.due, now + spreadDays(Math.max(1, Math.round(SRS_DAYS[rec.box] / 2)), it.key) * DAY);
  } else if (result === 'first' && info.alt) {
    /* a move that works too is a pass, not the lesson: sooner, like a hint */
    rec.due = now + Math.max(1, Math.round(SRS_DAYS[rec.box] / 2)) * DAY;
    rec.ls = now;
  } else if (result === 'first' && info.tier >= 2 && !anew && !rec.learned && prevGap >= 15.5 * DAY && (rec.streak || 0) >= 2
             && !(info.game && info.ms != null && info.ms < learnMs(info.tier))) {
    /* F8.3: at tiers 2 and 3 the find that would make a position learned
       must be clean in game mode and quick (learnMs); a slower one, or one
       shown with the arrow, holds its step: the same interval again, its run
       as it was (info.held says why, for Details and what moved) */
    info.held = info.game ? 'slow' : 'cued';
    rec.due = now + spreadDays(SRS_DAYS[rec.box], it.key) * DAY;
    rec.ls = now;
  } else if (result === 'first') {
    /* a first sighting solved fast may still be a lucky guess: a week, not 16 days */
    if (anew) rec.box = info.ms != null && info.ms < 20000 ? 2 : 1;
    else rec.box = Math.min(rec.box + 1, SRS_DAYS.length - 2);
    var spotCheck = !!rec.learned;
    /* the run's first clean find, for "Found 3 times over 23 days." */
    if (!(rec.streak > 0)) rec.rs = now;
    rec.streak = (rec.streak || 0) + 1;
    if (!anew && prevGap >= 15.5 * DAY && rec.streak >= 3) rec.learned = true;
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
    delete rec.rs;
    rec.box = Math.max(0, rec.box - 2);
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  } else {
    rec.lapses = (rec.lapses || 0) + 1;
    rec.streak = 0;
    rec.learned = false;
    delete rec.retired;
    delete rec.rs;
    rec.box = rec.box >= 3 ? 1 : 0;
    rec.due = now + SRS_DAYS[rec.box] * DAY;
  }
  /* a miss before its due date brings it back tomorrow (F7.1) */
  if (!dueNow && (result === 'retry' || result === 'fail')) rec.due = Math.min(rec.due, now + DAY);
  if (info.gameMove) { rec.box = 0; rec.due = now + DAY; rec.learned = false; }
  /* answered: back on its own schedule */
  if (result !== 'skip') delete rec.sp;
  if ((rec.lapses || 0) >= 4) rec.tricky = 1;
  if (info.ms != null) rec.lt = info.ms;
  /* each wrong try's check step (F1.2: 1 their move, 2 your chances, 3
     safety check, 0 anything else), the last 8 */
  if (info.fc) rec.fc = ((rec.fc || '') + info.fc).slice(-8);
  /* how many times it was answered (a skip is not an answer): the
     practice log's review number */
  if (result !== 'skip') rec.n = (rec.n || 0) + 1;
  rec.last = now;
  map[it.key] = rec;
  srsSave(map);
  dayBump(result, anew, info.attempted);
  /* a measure: a position learned, never which one */
  if (rec.learned && !wasLearned && typeof track === 'function') track('learned');
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
/* the check steps of a showing that grades nothing (one more try): added
   to the record it already has */
function srsNoteTries(it, fc) {
  var map = srsLoad(), rec = map[it.key];
  if (!rec || !fc) return;
  rec.fc = ((rec.fc || '') + fc).slice(-8);
  srsSave(map);
}
/* one position's record put back as it was (null: it had none), as the
   Undo of a removal does: the rest saved as srsSave keeps them */
function srsRestore(key, rec) {
  var map = srsLoad();
  if (rec) map[key] = rec; else delete map[key];
  srsSave(map);
  if (rec) return;
  /* srsSave keeps a record the disk has: one that was not there goes from both */
  var disk = store.get(srsKey(), {});
  delete disk[key];
  practiceWrite(srsKey(), disk);
  srsMem = { key: srsKey(), map: disk };
  srsRevision++;
}
function srsHide(it) {
  var map = srsLoad(), rec = map[it.key] || { box: 0, streak: 0 };
  rec.hidden = 1;
  map[it.key] = rec;
  srsSave(map);
}

/* ── the practice log ───────────────────────────────────────────────────
   nl:log:<player>: one entry for each card answered (e 'c': key, tier,
   mode, review number, days since last shown, category, tries, hints, time
   to the first move, solve time, the game move replayed, a long first
   interval's first review, a spread position, one back from the queue, a
   practice position), one for each set started (e 's': mode, size, due,
   new, of them back from the queue, spread, practice, overdue, a healthy
   load) and one for each day's first opening (e 'o': due, kept, spread,
   queued, left due for want of room, overdue), the last 500 (about 40
   KB). For testing: a progress file carries it.
   Written after the practice records and only where there is room, so it
   never pushes them (or the games) out */
var LOG_MAX = 500;
function logKey() { return 'nl:log:' + playerId(); }
function logLoad() { var l = store.get(logKey(), []); return Array.isArray(l) ? l : []; }
function logAdd(e) {
  var l = logLoad();
  e.t = Date.now();
  l.push(e);
  if (l.length > LOG_MAX) l = l.slice(l.length - LOG_MAX);
  if (!store.set(logKey(), l) && l.length > 50) store.set(logKey(), l.slice(-Math.floor(l.length / 2)));
}

/* ── days, the streak and the weekly goal ────────────────────────────────── */
function dayStamp(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function dayKeyFor(d) { return 'nl:day:' + playerId() + ':' + dayStamp(d); }
function dayKey() { return dayKeyFor(new Date()); }
function dayLoad() { return store.get(dayKey(), { answered: 0, solved: 0, first: 0, fresh: 0 }); }
function daySave(day) { practiceWrite(dayKey(), day); }
function dayBump(result, fresh, attempted) {
  var day = dayLoad();
  if (result !== 'skip') day.answered = (day.answered || 0) + 1;
  if (result !== 'skip' && attempted) day.attempted = (day.attempted || 0) + 1;
  if (result === 'first' || result === 'hint' || result === 'retry') day.solved = (day.solved || 0) + 1;
  if (result === 'first') day.first = (day.first || 0) + 1;
  if (fresh) day.fresh = (day.fresh || 0) + 1;
  daySave(day);
}
/* one rule, said the same way in Settings: a day counts once you try 3
   positions, or all of a shorter set, finished or paused (counted, or a set
   finished: sessions). Tried means a move was played; skips and reveal-only
   taps never count */
var DAY_RULE = 'A day counts once you try 3 positions, or all of a shorter set.';
function dayCounts(rec) { return !!(rec && ((rec.sessions || 0) >= 1 || rec.counted)); }
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
/* the days that counted, from this player's day records: their local
   midnights, oldest first (F5.1: the lifetime practice days, the first
   practice day) */
function countedDays() {
  var p = 'nl:day:' + playerId() + ':', keys = {}, out = [];
  Object.keys(mem).forEach(function (k) { keys[k] = 1; });
  try { for (var i = 0; i < localStorage.length; i++) { var k0 = localStorage.key(i); if (k0) keys[k0] = 1; } } catch (e) {}
  Object.keys(keys).forEach(function (k) {
    var m = k.indexOf(p) === 0 && /^(\d+)-(\d+)-(\d+)$/.exec(k.slice(p.length));
    if (m && dayCounts(store.get(k, null))) out.push(new Date(+m[1], +m[2] - 1, +m[3]).getTime());
  });
  return out.sort(function (a, b) { return a - b; });
}
/* "27 practice days": every day that counted, never reset by a week */
function practiceDays() { return countedDays().length; }
/* a week's goal, the first week's cut to the days it has left (F5.1): from
   the first practice day (today, while none has counted yet) to Sunday, so
   a Saturday starter reads "1 of 2 days this week". first: the first
   practice day, or null */
function goalOfWeek(ms, first) {
  var g = weekGoalAt(ms), start = first != null ? first : new Date().setHours(0, 0, 0, 0);
  if (mondayOf(start) !== mondayOf(ms)) return g;
  return Math.min(g, 7 - (new Date(start).getDay() + 6) % 7);
}
function goalThisWeek() { return goalOfWeek(Date.now(), countedDays()[0]); }
/* consistency counted in weeks: the run of Monday-to-Sunday weeks that met
   the goal, this week included once it is met; a week still under way never
   breaks the run */
function weeksAtGoal() {
  var n = 0, d = new Date(), first = countedDays()[0];
  d.setHours(12, 0, 0, 0);
  var dow = (d.getDay() + 6) % 7, monday = new Date(d);
  monday.setDate(d.getDate() - dow);
  var count = function (mon, days) {
    var c = 0;
    for (var i = 0; i < days; i++) { var x = new Date(mon); x.setDate(mon.getDate() + i); if (dayCounts(dayRecOf(x))) c++; }
    return c;
  };
  if (count(monday, dow + 1) >= goalOfWeek(monday.getTime(), first)) n++;
  for (var w = 1; w < 105; w++) {
    var m = new Date(monday);
    m.setDate(monday.getDate() - 7 * w);
    if (count(m, 7) >= goalOfWeek(m.getTime(), first)) n++; else break;
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

/* ── families: the patterns' groups (their check line: F2.3's step), named
   as the skills they train (F6.1) ─────────────────────────────────────── */
var FAMILIES = [
  { key: 'safety', name: 'Piece safety',
    types: ['hung', 'threat', 'forkAllowed', 'pinAllowed', 'discoveredAllowed', 'badTrade', 'material', 'promotion'] },
  { key: 'king', name: 'King safety',
    types: ['mateAllowed', 'kingSafety'] },
  { key: 'chances', name: 'Spotting chances',
    types: ['missedMaterial', 'missedTactic', 'mateMissed'] },
  { key: 'conversion', name: 'Finishing wins',
    types: ['slipped'] },
  { key: 'quiet', name: 'Quiet moves',
    types: ['openingSlip', 'drift', 'endgame'] }
];
var FAMILY_OF = {};
FAMILIES.forEach(function (f) { f.types.forEach(function (t) { FAMILY_OF[t] = f; }); });
function familyOf(patternKey) { return FAMILY_OF[patternKey] || FAMILIES[4]; }

