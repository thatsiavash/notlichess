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
/* intervals of three days or more are spread by up to 15% either way */
function near(ms, days, what) {
  const d = Math.round(ms / DAY * 10) / 10, tol = days >= 3 ? days * 0.15 + 0.05 : 0.05;
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
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 3 */
  s.advance(16);
  const r = s.srsRecord(card(), 'retry', {});
  eq(r.box, 1, 'box'); eq(r.streak, 0, 'streak'); near(r.due - s.clock.now, 3);
});
test('a failed card from a high step restarts at 3 days and counts a lapse', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 2 */
  s.advance(7);
  s.srsRecord(card(), 'first', { ms: 8000 });            /* box 3 */
  s.advance(16);
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
test('a miss note breaks the run at once and reports the run it broke', () => {
  const s = sandbox(T0);
  s.srsRecord(card(), 'first', { ms: 8000 });
  eq(s.srsNoteMiss(card()), 1, 'broken run');
  eq(s.srsLoad()[card().key].streak, 0, 'streak');
});
test('the retired opening lines stored beside the cards survive every save', () => {
  const s = sandbox(T0);
  s.store.set('nl:srs:tester', { 'l|e4-e5': { box: 3 }, 'g9:4': { box: 1 } });
  s.srsRecord(card(), 'first', { ms: 8000 });
  const raw = s.store.get('nl:srs:tester', {});
  eq(!!raw['l|e4-e5'], true, 'line kept');
  eq(!!raw['g9:4'], true, 'other card kept');
  eq(Object.keys(s.srsLoad()).indexOf('l|e4-e5'), -1, 'line hidden from the trainer');
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
