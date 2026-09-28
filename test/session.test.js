// The practice bookkeeping, run on the built page in Node (test/app-realm.js) with 50 real, anonymised
// chess.com games (test/data/fixture-games.json): skips, day credit, the focus, links, erase, a failed
// engine, the blunder check and spoilers. node test/session.test.js   (exit code 1 on any failure)
const fs = require('fs'), path = require('path');
const makeApp = require('./app-realm');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const base = () => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': FIX });
const boot = (o) => makeApp(Object.assign({ now: T0, storage: base() }, o || {}));
const tick = () => new Promise((r) => setImmediate(r));

let failed = 0, passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; results.push('FAIL ' + name + ': ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(c, what) { if (!c) throw new Error(what || 'condition failed'); }
/* open one card as the active card of a one-card session */
const OPEN = `function openCard(it, guess) {
  ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
  var a = cardFor(it);
  if (guess && a.check1) { a.check1 = null; a.phase = 'guess'; a.st = cloneState(a.pre); a.lastMove = a.preLast; }
  ui.session.active = a;
  return a;
}`;

(async () => {
  await test('the fixture boots with its games and cards', () => {
    const A = boot();
    eq(A.ev('data.games.length'), 50, 'games');
    ok(A.ev('allMistakes().filter(trainable).length') >= 40, 'trainable cards');
  });

  await test('a card left after a miss counts as missed', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[0], a = openCard(it, true);
      a.misses = 1; a.attempts = 1; skipCard();
      return JSON.stringify({ res: ui.session ? ui.session.results[it.key] : null, rec: srsLoad()[it.key] }); })()`));
    eq(r.rec.lapses, 1, 'lapses');
  });

  await test('a card left untouched is a free skip', () => {
    const A = boot();
    const rec = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[1], a = openCard(it, true);
      skipCard(); return JSON.stringify(srsLoad()[it.key]); })()`));
    eq(rec.skips, 1, 'skips'); eq(rec.lapses || 0, 0, 'lapses');
  });

  await test('a card left after a hint counts as solved with help', () => {
    const A = boot();
    const rec = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[2], a = openCard(it, true);
      a.hints = 1; skipCard(); return JSON.stringify(srsLoad()[it.key]); })()`));
    eq(rec.lapses || 0, 0, 'lapses'); ok(rec.due > A.getNow(), 'scheduled');
  });

  await test('a finished session of reveal-only taps earns no day', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[3]; openCard(it, true);
      ui.session.attempted = 0; finishSession(); return JSON.stringify({ day: dayLoad(), counts: dayCounts(dayLoad()) }); })()`));
    eq(r.counts, false, 'day counts');
  });

  await test('a finished session with three real tries earns the day', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[3]; openCard(it, true);
      ui.session.attempted = 3; finishSession(); return JSON.stringify({ day: dayLoad(), counts: dayCounts(dayLoad()), week: weekDays() }); })()`));
    eq(r.counts, true, 'day counts'); eq(r.day.sessions, 1, 'sessions'); eq(r.week, 1, 'week days');
  });

  await test('while the read is short, the focus is provisional, stored nowhere and boosts nothing', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 12, total: 50, ready: 20, working: true }; };
      var f = currentFocus(); return JSON.stringify({ f: f, stored: store.get(focusKey(), null) }); })()`));
    ok(!r.f || r.f.provisional, 'provisional'); eq(r.stored, null, 'stored');
  });

  await test('after the read, a clear leader is stored and equals the first family in Insights', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 50, total: 50, ready: 40, working: false }; };
      var f = currentFocus(), top = insightReport().families[0];
      return JSON.stringify({ f: f, top: top && top.fam.key, stored: store.get(focusKey(), null) }); })()`));
    ok(r.f && !r.f.provisional, 'settled'); eq(r.f.fam, r.top, 'family'); ok(r.stored && r.stored.fam === r.top, 'stored');
  });

  await test('the focus family takes at most half of the new positions', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 50, total: 50, ready: 40, working: false }; };
      var f = currentFocus(), c = buildCandidates(6);
      return JSON.stringify({ n: c.length, inF: c.filter(function (it) { return familyOf(patternOf(it.b)).key === f.fam; }).length }); })()`));
    ok(r.inF <= Math.ceil(r.n / 2), r.inF + ' of ' + r.n);
  });

  await test('progress is kept per site: the same name on lichess starts clean', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { var k1 = srsKey(); cfg.src = 'lichess'; var k2 = srsKey(); cfg.src = 'chesscom'; return JSON.stringify([k1, k2]); })()`));
    ok(r[0] !== r[1], r.join(' vs '));
  });

  await test('a ?u= link opens its player in this tab only and never replaces the saved one', () => {
    const A = boot({ session: { 'nl:linkUser': 'someone', 'nl:linkSrc': 'lichess' } });
    eq(A.ev('cfg.user'), 'someone', 'player'); eq(A.storage['nl:user'], JSON.stringify('tester'), 'saved player');
    const B = makeApp({ now: T0, storage: {}, session: { 'nl:linkUser': 'someone' } });
    eq(B.storage['nl:user'], undefined, 'fresh browser');
  });

  await test('the page title never names the player', () => {
    const A = boot();
    ok(A.ev('document.title').indexOf('tester') === -1, A.ev('document.title'));
  });

  await test('after erase, nothing writes itself back', () => {
    const A = boot();
    A.ev(`(function () { data.wiped = true; cfg.user = ''; var all = []; for (var i = 0; i < localStorage.length; i++) all.push(localStorage.key(i));
      all.forEach(function (k) { if (k.indexOf('nl:') === 0) localStorage.removeItem(k); }); saveGames(data.games); flushSave(); return 1; })()`);
    ok(!Object.keys(A.storage).some((k) => k.indexOf('nl:games') === 0), Object.keys(A.storage).join(','));
  });

  await test('when the engine cannot check a move, no miss is counted', async () => {
    const A = boot();
    A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[4], a = openCard(it, true);
      var m = legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0];
      gradeMove(m); return 1; })()`);
    for (let i = 0; i < 6; i++) await tick();
    const r = JSON.parse(A.ev('JSON.stringify({ misses: ui.session.active.misses, v: ui.session.active.verdict && ui.session.active.verdict.html })'));
    eq(r.misses, 0, 'misses'); ok(/cannot check/i.test(r.v || ''), r.v);
  });

  await test('the blunder check appears only on first-sight safety and king cards with a capture or check reply', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var out = { eligible: 0, safetyKing: 0, wrongFamily: 0, notForcing: 0 };
      allMistakes().filter(trainable).forEach(function (it) {
        var fam = familyOf(patternOf(it.b)).key, a = cardFor(it);
        if (fam === 'safety' || fam === 'king') out.safetyKing++;
        if (!a || !a.check1) return;
        out.eligible++;
        if (fam !== 'safety' && fam !== 'king') out.wrongFamily++;
        if (!a.check1.capture && !a.check1.check) out.notForcing++;
      });
      return JSON.stringify(out); })()`));
    ok(r.eligible > 0, 'some eligible'); eq(r.wrongFamily, 0, 'other families'); eq(r.notForcing, 0, 'quiet replies');
    ok(r.eligible >= 0.5 * r.safetyKing, r.eligible + ' of ' + r.safetyKing);
  });

  await test('step 1 needs no engine, and missing it caps the card at "with help"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && a.check1; })[0];
      var a = openCard(it, false), q0 = SF.queue.length;
      ui.session.active = a;
      var wrong = legalMoves(a.st).filter(function (x) { return moveUci(x) !== a.check1.uci && x.to !== a.check1.reply.to; })[0];
      gradeMove(wrong);
      var q1 = SF.queue.length;
      /* step 2 begins after a pause */
      a.st = cloneState(a.pre); a.phase = 'guess'; a.check1.done = true;
      gradeMove(uciToMove(a.st, a.bestUci));
      return JSON.stringify({ q0: q0, q1: q1, result: a.result, missed: !!a.check1Missed }); })()`));
    eq(r.q1, r.q0, 'engine requests'); eq(r.missed, true, 'missed'); eq(r.result, 'hint', 'result');
  });

  await test('replaying the game move never names the answer', () => {
    const A = boot();
    const bad = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [];
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it, true);
        if (!a) return;
        var best = sanOf(a.pre, a.best);
        gradeMove(uciToMove(a.st, a.playedUci));
        var v = a.verdict ? a.verdict.html : '';
        if (v.indexOf(best) !== -1 || v.indexOf(sqName(a.best.to)) !== -1 && familyOf(patternOf(it.b)).key === 'chances') out.push(it.key + ': ' + v);
      });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, 'leaks: ' + bad.slice(0, 2).join(' | '));
  });

  await test('hints never name the answer on a missed-chance card', () => {
    const A = boot();
    const bad = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [];
      allMistakes().filter(trainable).forEach(function (it) {
        if (familyOf(patternOf(it.b)).key !== 'chances') return;
        var a = openCard(it, true);
        if (!a) return;
        var best = sanOf(a.pre, a.best), h1 = hintText(a);
        if (h1.indexOf(best) !== -1) out.push(it.key + ': ' + h1);
      });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, 'leaks: ' + bad.slice(0, 2).join(' | '));
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'sessions and bookkeeping: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
