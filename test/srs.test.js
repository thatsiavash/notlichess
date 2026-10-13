// Spaced repetition, days, streaks and the weekly goal, run against src/js/08-srs.js with a fake clock.
// node test/srs.test.js   (exit code 1 on any failure)
const fs = require('fs'), path = require('path'), vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', '08-srs.js'), 'utf8');
const DAY = 864e5;

function sandbox(startMs) {
  const clock = { now: startMs };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const mem = {};
  const store = {
    get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d),
    set: (k, v) => { mem[k] = JSON.stringify(v); return true; },
    del: (k) => { delete mem[k]; },
  };
  const ctx = { store, cfg: { user: 'Tester' }, Date: FakeDate, Math, JSON, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: '08-srs.js' });
  ctx.clock = clock;
  ctx.mem = mem;
  ctx.advance = (days) => { clock.now += days * DAY; };
  return ctx;
}

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
/* an interval in whole days (C2: due on a date, from its local midnight, never within 8 hours of the
   answer, so a due date a few hours short of N days away is N days on); intervals of three days or
   more are spread by up to 15% either way, in whole days */
function near(ms, days, what) {
  const d = Math.ceil(ms / DAY - 1e-9), tol = days >= 3 ? Math.floor(days * 0.15 + 0.5) : 0;
  if (Math.abs(d - days) > tol) throw new Error((what || 'interval') + ' expected ' + days + ' days, got ' + d);
}
const T0 = Date.UTC(2026, 8, 7, 15, 0, 0);   /* a Monday afternoon */
const card = (k) => ({ key: k || 'g1:10' });

/* ── the ladder ─────────────────────────────────────────────────────────── */
test('a fast first-try solve of a new card comes back in a week, not 16 days', () => {
  const s = sandbox(T0);
  const r = s.srsRecord(card(), 'first', { ms: 8000, attempted: true });
  eq(r.box, 2, 'box'); near(r.due - s.clock.now, 7);
});
test('a move that works too is scheduled like a hint, not a first-try', () => {
  const s = sandbox(T0);
  const r = s.srsRecord(card(), 'first', { ms: 8000, attempted: true, alt: true });
  eq(r.box, 0, 'box'); near(r.due - s.clock.now, 1);
});
test('a slow first-try solve of a new card comes back in 3 days', () => {
  const s = sandbox(T0);
  const r = s.srsRecord(card(), 'first', { ms: 45000, attempted: true });
  eq(r.box, 1, 'box'); near(r.due - s.clock.now, 3);
});
test('a due card solved first try climbs one step', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 45000 });           /* box 1, due in 3 days */
  s.advance(3);
  const r = s.srsRecord(card(), 'first', { ms: 45000 });
  eq(r.box, 2, 'box'); near(r.due - s.clock.now, 7);
});
test('early practice of a card that is not due does not climb', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 45000 });           /* box 1 */
  s.advance(1);
  const r = s.srsRecord(card(), 'first', { ms: 5000 });
  eq(r.box, 1, 'box');
});
test('a hint keeps the step and halves the wait', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 45000 });           /* box 1 */
  s.advance(3);
  const r = s.srsRecord(card(), 'hint', {});
  eq(r.box, 1, 'box'); near(r.due - s.clock.now, 2);     /* round(3 / 2) */
});
test('a solve after a miss drops two steps and breaks the run', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 2 */
  s.advance(7);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 3, due in 16 days, spread by up to 15% */
  s.advance(19);
  const r = s.srsRecord(card(), 'retry', {});
  eq(r.box, 1, 'box'); eq(r.streak, 0, 'streak'); near(r.due - s.clock.now, 3);
});
test('a failed card from a high step restarts at 3 days and counts a lapse', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 2 */
  s.advance(7);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 3, due in 16 days, spread by up to 15% */
  s.advance(19);
  const r = s.srsRecord(card(), 'fail', {});
  eq(r.box, 1, 'box'); eq(r.lapses, 1, 'lapses'); near(r.due - s.clock.now, 3);
});
test('a failed low card comes back tomorrow', () => {
  const s = sandbox(T0);
  const r = s.srsRecord(card(), 'fail', {});
  eq(r.box, 0, 'box'); near(r.due - s.clock.now, 1);
});
test('replaying the game move sends the card back to tomorrow', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });
  s.advance(16);
  const r = s.srsRecord(card(), 'retry', { gameMove: true });
  eq(r.box, 0, 'box'); near(r.due - s.clock.now, 1); eq(r.learned, false, 'learned');
});
test('four lapses mark a card as tricky', () => {
  const s = sandbox(T0);
  let r;
  for (let i = 0; i < 4; i++) { r = s.srsRecord(card(), 'fail', {}); s.advance(1); }
  eq(r.tricky, 1, 'tricky');
});
const learn = (s) => {
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 2, streak 1, a week */
  s.advance(8);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 3, streak 2, 16 days */
  s.advance(18);
  return s.srsRecord(card(), 'first', { ms: 8000 });     /* gap 18 days, streak 3 */
};
test('learned needs a third clean solve, the last after a gap of about 16 days', () => {
  const s = sandbox(T0);
  const r = learn(s);
  eq(r.learned, true, 'learned'); near(r.due - s.clock.now, 90);
  eq(s.isLearned(r), true, 'isLearned');
});
/* F8.3: at tiers 2 and 3 the find that makes it learned must be clean in game mode and quick */
test('F8.3: at tier 2 the third clean find 16 days on is learned only in game mode under 30 s; cued or at 42 s it holds its step (the run, the box, the same interval again) and says why; at tier 3 the bar is 60 s; at tier 1, or with no tier said, as before', () => {
  const at = (tier, game, ms) => {
    const s = sandbox(T0);
    s.srsRecord(card(), 'first', { ms: 8000 });          /* box 2, streak 1 */
    s.advance(8);
    s.srsRecord(card(), 'first', { ms: 8000, tier, game }); /* box 3, streak 2 */
    s.advance(18);
    const info = { ms, tier, game };
    const r = s.srsRecord(card(), 'first', info);
    return { r, held: info.held || null, days: Math.round((r.due - s.clock.now) / DAY * 10) / 10 };
  };
  let x = at(2, false, 9000);
  eq(!!x.r.learned, false, 'cued: not learned'); eq(x.held, 'cued', 'held, cued'); eq(x.r.box, 3, 'the same step'); eq(x.r.streak, 2, 'the run as it was');
  near(x.r.due - (T0 + 26 * DAY), 16, 'the same interval again');
  x = at(2, true, 20000);
  eq(x.r.learned, true, 'game mode at 20 s: learned'); eq(x.held, null, 'nothing held');
  x = at(2, true, 42000);
  eq(!!x.r.learned, false, 'game mode at 42 s: not learned'); eq(x.held, 'slow', 'held, too slow'); eq(x.r.streak, 2, 'run kept');
  x = at(2, true, 30000);
  eq(!!x.r.learned, false, '30 s is not under 30 s');
  x = at(3, true, 42000);
  eq(x.r.learned, true, 'tier 3 at 42 s: learned');
  x = at(3, true, 65000);
  eq(x.held, 'slow', 'tier 3 at 65 s: held');
  x = at(1, false, 50000);
  eq(x.r.learned, true, 'tier 1, cued: learned as before');
  x = at(undefined, undefined, 50000);
  eq(x.r.learned, true, 'no tier said: as before');
  /* a learned position's clean spot check still retires it, cued or slow */
  const s = sandbox(T0);
  learn(s);
  s.advance(100);
  const r = s.srsRecord(card(), 'first', { ms: 90000, tier: 2, game: false });
  eq(r.retired, 1, 'the spot check retires it');
});
test('two clean solves are not enough to be learned, even after a long gap', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* streak 1 */
  s.advance(17);
  const r = s.srsRecord(card(), 'first', { ms: 8000 });  /* streak 2, gap 17 days */
  eq(!!r.learned, false, 'learned');
});
test('a clean 90-day spot check retires the card for good', () => {
  const s = sandbox(T0);
  learn(s);
  s.advance(100);
  const r = s.srsRecord(card(), 'first', { ms: 8000 });
  eq(r.retired, 1, 'retired'); eq(r.due, null, 'no due date'); eq(s.isLearned(r), true, 'still learned');
});
test('a short gap never marks a card learned', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 45000 });           /* box 1, due 3 */
  s.advance(3);
  const r = s.srsRecord(card(), 'first', { ms: 5000 });
  eq(!!r.learned, false, 'learned');
});
test('a miss on a learned card un-learns it', () => {
  const s = sandbox(T0);
  learn(s);
  s.advance(90);
  const r = s.srsRecord(card(), 'fail', {});
  eq(r.learned, false, 'learned');
});
test('skipping a card that is not due leaves its date alone', () => {
  const s = sandbox(T0);
  const r1 = s.srsRecord(card(), 'first', { ms: 8000 });  /* due in 16 days */
  const due = r1.due;
  s.advance(2);
  const r2 = s.srsRecord(card(), 'skip', {});
  eq(r2.due, due, 'due');
});
test('skipping a due card brings it back tomorrow', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'fail', {});                        /* due tomorrow */
  s.advance(1);
  const r = s.srsRecord(card(), 'skip', {});
  near(r.due - s.clock.now, 1);
});
/* ── the extra-set rule (F7.1) ─────────────────────────────────────────── */
test('practice before the due date never moves the date later: a clean find changes nothing, a hint brings it sooner only', () => {
  const s = sandbox(T0);
  const r1 = s.srsRecord(card(), 'first', { ms: 45000 });            /* box 1, due in about 3 days */
  const due = r1.due, ls = r1.ls;
  s.advance(1);
  const r2 = s.srsRecord(card(), 'first', { ms: 5000 });
  eq(JSON.stringify([r2.box, r2.streak, r2.due, r2.ls, r2.rs]), JSON.stringify([1, 1, due, ls, r1.rs]), 'a clean find a day early: nothing moves');
  eq(r2.n, 2, 'it still counts as an answer');
  const r3 = s.srsRecord(card(), 'hint', {});
  ok3(r3.due <= due && r3.box === 1, 'a hint early: no later than before, the step kept');
  s.srsRecord(card('g2:4'), 'first', { ms: 8000 });                   /* box 2, due in about a week */
  s.advance(1);
  const r4 = s.srsRecord(card('g2:4'), 'hint', {});
  near(r4.due - s.clock.now, 4, 'a hint a day after a week-long find: back in its hint interval, sooner than its date');
});
test('a miss before the due date brings it back tomorrow, its ladder as any miss', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });                         /* box 2 */
  s.advance(8);
  s.srsRecord(card(), 'first', { ms: 8000 });                         /* box 3, 16 days */
  s.advance(4);
  const r = s.srsRecord(card(), 'retry', {});
  eq(r.box, 1, 'two steps down'); eq(r.streak, 0, 'run broken'); near(r.due - s.clock.now, 1, 'back tomorrow');
  s.advance(1.2);
  const r2 = s.srsRecord(card(), 'first', { ms: 30000 });
  eq(r2.box, 2, 'found when due, it climbs again');
});
test('a spread position is graded as due: a clean find before its new date climbs a rung, and it is back on its own schedule', () => {
  const s = sandbox(T0);
  const map = s.srsLoad();
  map['g1:10'] = { box: 1, streak: 1, due: T0 + 9 * DAY, last: T0 - 6 * DAY, ls: T0 - 6 * DAY, lapses: 0, sp: T0 - DAY };
  s.srsSave(map);
  const r = s.srsRecord(card(), 'first', { ms: 30000 });
  eq(r.box, 2, 'up a rung'); eq(r.streak, 2, 'the run grows'); eq(r.sp, undefined, 'no longer spread'); near(r.due - s.clock.now, 7, 'its next interval');
});
test('a position back from the queue comes back as new: its ladder starts again, its history is kept, and it counts as new today', () => {
  const s = sandbox(T0);
  const map = s.srsLoad();
  map['g1:10'] = { box: 3, streak: 2, due: null, last: T0 - 60 * DAY, ls: T0 - 70 * DAY, lapses: 2, n: 5, fc: '31', learned: false, q: T0 - 5 * DAY };
  s.srsSave(map);
  const r = s.srsRecord(card(), 'first', { ms: 8000 });
  eq(JSON.stringify([r.box, r.streak, !!r.learned, r.q]), JSON.stringify([2, 1, false, undefined]), 'a fast first find: a week, a run of one, not learned');
  eq(JSON.stringify([r.lapses, r.n, r.fc]), JSON.stringify([2, 6, '31']), 'the history kept');
  near(r.due - s.clock.now, 7);
  eq(s.dayLoad().fresh, 1, 'it took a new position\'s place today');
  map['g1:11'] = { box: 2, streak: 1, due: null, last: T0 - 60 * DAY, lapses: 0, q: T0 - 5 * DAY };
  s.srsSave(map);
  const m = s.srsRecord(card('g1:11'), 'retry', {});
  eq(JSON.stringify([m.box, m.streak, m.q]), JSON.stringify([0, 0, undefined]), 'a miss: from the start, not two steps down from its old rung');
});
test('two open tabs: a position spread or queued in one tab stays so when the other, which read before, saves', () => {
  const s = sandbox(T0);
  s.srsRecord(card('a'), 'first', { ms: 8000 });
  s.srsRecord(card('b'), 'first', { ms: 8000 });
  s.srsLoad();                                                        /* this tab has read both */
  const other = s.store.get(s.srsKey(), {});                          /* the other tab spreads one and queues the other */
  other.a = Object.assign({}, other.a, { sp: T0 + 1000, due: s.dayStart(T0, 12) });
  other.b = Object.assign({}, other.b, { q: T0 + 1000, due: null });
  s.store.set(s.srsKey(), other);
  s.advance(0.01);
  s.srsRecord(card('c'), 'first', { ms: 45000 });                     /* this tab saves */
  const disk = s.store.get(s.srsKey(), {});
  eq(JSON.stringify([disk.a.sp, disk.a.due, disk.b.q, disk.b.due]), JSON.stringify([T0 + 1000, s.dayStart(T0, 12), T0 + 1000, null]), 'the spreading and the queue survive');
  s.advance(0.01);
  s.srsRecord(card('a'), 'first', { ms: 45000 });                     /* an answer after it wins */
  eq(s.store.get(s.srsKey(), {}).a.sp, undefined, 'answered later: the answer stands');
});
test('a miss note breaks the run at once and reports the run it broke', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });
  eq(s.srsNoteMiss(card()), 1, 'broken run');
  eq(s.srsLoad()[card().key].streak, 0, 'streak');
});

/* ── due dates by whole days (C2) and the spread (C3) ───────────────────── */
test('C2: a position is due on a date: a 3-day find at 9 pm is due from local midnight 3 days on (not 9 pm), counted 3 days by date; a miss at 11:30 pm is not due again at midnight but 8 hours after it; the grade reads the date: found on that date (0:30) it climbs, the evening before (10 pm, inside the old 12-hour look-ahead) it does not', () => {
  const s = sandbox(T0 + 6 * 3600e3);                                  /* Monday 9 pm */
  const r = s.srsRecord(card(), 'first', { ms: 45000 });               /* box 1: 3 days */
  eq(r.due, s.dayStart(s.clock.now, 3), 'due from Thursday\'s midnight');
  eq(s.daysFrom(s.clock.now, r.due), 3, 'three days by date');
  const late = sandbox(T0 + 8.5 * 3600e3);                             /* Monday 11:30 pm */
  const m = late.srsRecord(card(), 'fail', {});
  eq(m.due, late.clock.now + 8 * 3600e3, 'a miss at 11:30 pm: due at 7:30 am, not at midnight');
  eq(late.daysFrom(late.clock.now, m.due), 1, 'still tomorrow by date');
  const a = sandbox(T0 + 6 * 3600e3);
  a.srsRecord(card(), 'first', { ms: 45000 });
  a.clock.now = a.dayStart(a.clock.now, 3) + 0.5 * 3600e3;             /* Thursday 0:30 */
  eq(a.srsRecord(card(), 'first', { ms: 45000 }).box, 2, 'found on its date, just after midnight: it climbs');
  const b = sandbox(T0 + 6 * 3600e3);
  b.srsRecord(card(), 'first', { ms: 45000 });
  b.clock.now = b.dayStart(b.clock.now, 3) - 2 * 3600e3;               /* Wednesday 10 pm */
  const rb = b.srsRecord(card(), 'first', { ms: 45000 });
  eq(rb.box, 1, 'the evening before its date: practice, no climb');
  eq(b.daysFrom(T0, rb.due), 3, 'and its date stays (8 hours after that answer at the earliest: 6 am)');
  eq(rb.due, b.clock.now + 8 * 3600e3, 'at 6 am');
});
test('C3: the spread keeps whole days, and the step before learned never comes back under 16 days (16 to 18); a card spread at 0.86 is found on its 16-day date and is learned (before: 13.8 days, a gap under 15.5, and 35 more days to wait); the learned test counts days by date (11 pm to 7 am 16 days on is 16 days)', () => {
  const s = sandbox(T0);
  const factor = (k) => { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return 0.85 + (Math.abs(h) % 1000) / 1000 * 0.3; };
  const bad = [];
  for (let i = 0; i < 2000; i++) {
    const k = '1842' + (i * 7919) + ':' + (i % 90);
    const d3 = s.spreadDays(3, k), d7 = s.spreadDays(7, k), d16 = s.spreadDays(16, k), d35 = s.spreadDays(35, k);
    if (d3 !== 3 || d7 < 6 || d7 > 8 || d16 < 16 || d16 > 18 || d35 < 30 || d35 > 40 || [d7, d16, d35].some((d) => d !== Math.round(d))) bad.push(k + ': ' + [d3, d7, d16, d35].join(','));
  }
  eq(bad.length, 0, 'whole days, the 16-day step 16 to 18: ' + bad.slice(0, 3).join(' | '));
  let key = null;
  for (let i = 0; i < 5000 && !key; i++) { const k = 'g' + i + ':40'; if (Math.abs(factor(k) - 0.86) < 0.004) key = k; }
  ok3(!!key, 'a key spread at 0.86');
  const L = sandbox(T0);
  L.srsRecord(card(key), 'first', { ms: 8000 });                       /* box 2, streak 1 */
  let r = L.srsLoad()[key];
  L.clock.now = r.due + 7 * 3600e3;                                    /* its date, 7 am */
  r = L.srsRecord(card(key), 'first', { ms: 8000 });                   /* box 3, streak 2 */
  eq(L.daysFrom(L.clock.now, r.due), 16, 'the step before learned: 16 days, not ' + Math.round(16 * factor(key) * 10) / 10);
  L.clock.now = r.due + 7 * 3600e3;                                    /* its 16-day date, 7 am */
  r = L.srsRecord(card(key), 'first', { ms: 8000 });
  eq(r.learned, true, 'found on its date: learned');
  const D = sandbox(T0 + 8 * 3600e3), k2 = card('g2:4');              /* Monday 11 pm; its 16-day step is 16 */
  D.srsRecord(k2, 'first', { ms: 8000 });
  D.clock.now = D.dayStart(D.srsLoad()[k2.key].due) + 23 * 3600e3;    /* its date, 11 pm */
  r = D.srsRecord(k2, 'first', { ms: 8000 });                          /* box 3, streak 2 */
  eq(D.daysFrom(D.clock.now, r.due), 16, 'due 16 days on');
  D.clock.now = D.dayStart(D.clock.now, 16) + 7 * 3600e3;              /* 16 days on by date, 7 am: 15 days 8 hours */
  eq(D.srsRecord(k2, 'first', { ms: 8000 }).learned, true, '16 days by date is learned');
});

/* ── days ───────────────────────────────────────────────────────────────── */
function practise(s, n, result) { for (let i = 0; i < n; i++) s.srsRecord(card('d' + s.clock.now + ':' + i), result || 'first', { ms: 30000, attempted: true }); }
test('tried positions alone do not count the day: finishing a session does', () => {
  const s = sandbox(T0);
  practise(s, 6);
  eq(s.dayCounts(s.dayLoad()), false, 'tries only');
  const d = s.dayLoad(); d.sessions = 1; s.daySave(d);
  eq(s.dayCounts(s.dayLoad()), true, 'a counted session');
});
test('reveal-only taps do not count toward the day', () => {
  const s = sandbox(T0);
  for (let i = 0; i < 6; i++) s.srsRecord(card('r' + i), 'fail', { attempted: false });
  eq(s.dayCounts(s.dayLoad()), false, 'counted');
});
test('a finished session of three or more counts the day', () => {
  const s = sandbox(T0);
  const d = s.dayLoad(); d.sessions = 1; s.daySave(d);
  eq(s.dayCounts(s.dayLoad()), true, 'counted');
});
test('skips never count as answered', () => {
  const s = sandbox(T0);
  s.srsRecord(card('s1'), 'skip', {});
  eq(s.dayLoad().answered || 0, 0, 'answered');
});
test('new positions are counted per day', () => {
  const s = sandbox(T0);
  practise(s, 3);
  eq(s.dayLoad().fresh, 3, 'fresh');
});

test('two open tabs never erase each other\'s practice', () => {
  const s = sandbox(T0);
  s.srsRecord(card('a'), 'first', { ms: 8000 });           /* this tab */
  const other = s.store.get(s.srsKey(), {});                /* the other tab writes behind our back */
  other.b = { box: 1, streak: 1, due: T0 + 3 * DAY, last: T0 + 1000, lapses: 0 };
  other.a = Object.assign({}, other.a, { last: T0 + 2000, box: 0, lapses: 1 });
  s.store.set(s.srsKey(), other);
  s.advance(0.01);
  s.srsRecord(card('c'), 'first', { ms: 45000 });           /* this tab saves again */
  const disk = s.store.get(s.srsKey(), {});
  ok3(!!disk.b, 'the other tab\'s new position survives');
  eq(disk.a.lapses, 1, 'the newer record of a shared position wins');
  ok3(!!disk.c, 'this tab\'s position is saved');
});
function ok3(c, what) { if (!c) throw new Error(what); }

/* ── weeks at the goal ─────────────────────────────────────────────────── */
function dayOn(s, daysAgo) {
  const d = new s.Date(s.clock.now); d.setDate(d.getDate() - daysAgo);
  s.store.set(s.dayKeyFor(d), { answered: 5, solved: 5, attempted: 5, sessions: 1 });
}
test('no practice ever means no weeks at the goal', () => {
  const s = sandbox(T0);
  eq(s.weeksAtGoal(), 0, 'weeks');
});
test('this week counts once the goal is met', () => {
  const s = sandbox(T0);
  s.advance(3);                                           /* Thursday */
  dayOn(s, 0); dayOn(s, 1); dayOn(s, 2);
  eq(s.weeksAtGoal(), 0, 'three of four days');
  dayOn(s, 3);
  eq(s.weeksAtGoal(), 1, 'four of four days');
});
test('a week still under way never breaks the run', () => {
  const s = sandbox(T0);
  s.advance(1);                                           /* Tuesday, nothing yet */
  [2, 3, 4, 5, 9, 10, 11, 12].forEach((d) => dayOn(s, d)); /* the two weeks before */
  eq(s.weeksAtGoal(), 2, 'weeks');
});
test('a past week under the goal ends the run', () => {
  const s = sandbox(T0);
  [1, 2, 3, 4].forEach((d) => dayOn(s, d));               /* last week: at goal */
  [8, 9].forEach((d) => dayOn(s, d));                     /* the week before: two days */
  [15, 16, 17, 18].forEach((d) => dayOn(s, d));           /* three weeks ago: at goal */
  eq(s.weeksAtGoal(), 1, 'weeks');
});

/* ── the week ───────────────────────────────────────────────────────────── */
test('the week counts Monday to today', () => {
  const s = sandbox(T0);                                  /* Monday */
  s.advance(3);                                           /* Thursday */
  dayOn(s, 0); dayOn(s, 2); dayOn(s, 3);                  /* Thu, Tue, Mon */
  dayOn(s, 4);                                            /* last Sunday: not this week */
  eq(s.weekDays(), 3, 'days');
});
test('the weekly goal defaults to four days', () => {
  const s = sandbox(T0);
  eq(s.weekGoal(), 4, 'goal');
});

/* ── families ───────────────────────────────────────────────────────────── */
test('every pattern belongs to exactly one family', () => {
  const s = sandbox(T0);
  const seen = {};
  s.FAMILIES.forEach((f) => f.types.forEach((t) => { if (seen[t]) throw new Error(t + ' in two families'); seen[t] = f.key; }));
  eq(Object.keys(seen).length, 17, 'patterns');
  eq(s.familyOf('unknown').key, 'quiet', 'fallback family');
});

console.log((failed ? 'FAIL ' : 'ok   ') + 'practice memory: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
