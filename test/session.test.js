// The practice bookkeeping, run on the built page in Node (test/app-realm.js) with 50 real, anonymised
// chess.com games (test/data/fixture-games.json): skips, day credit, the focus, links, erase, a failed
// engine, no blunder check, the first session's order and spoilers. node test/session.test.js   (exit code 1 on any failure)
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
const OPEN = `function openCard(it) {
  ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
  var a = cardFor(it);
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
      var it = allMistakes().filter(trainable)[0], a = openCard(it);
      a.misses = 1; a.attempts = 1; skipCard();
      return JSON.stringify({ res: ui.session ? ui.session.results[it.key] : null, rec: srsLoad()[it.key] }); })()`));
    eq(r.rec.lapses, 1, 'lapses');
  });

  await test('a card left untouched is a free skip', () => {
    const A = boot();
    const rec = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[1], a = openCard(it);
      skipCard(); return JSON.stringify(srsLoad()[it.key]); })()`));
    eq(rec.skips, 1, 'skips'); eq(rec.lapses || 0, 0, 'lapses');
  });

  await test('a card left after a hint counts as solved with help', () => {
    const A = boot();
    const rec = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[2], a = openCard(it);
      a.hints = 1; skipCard(); return JSON.stringify(srsLoad()[it.key]); })()`));
    eq(rec.lapses || 0, 0, 'lapses'); ok(rec.due > A.getNow(), 'scheduled');
  });

  await test('a finished session of reveal-only taps earns no day', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[3]; openCard(it);
      ui.session.attempted = 0; finishSession(); return JSON.stringify({ day: dayLoad(), counts: dayCounts(dayLoad()) }); })()`));
    eq(r.counts, false, 'day counts');
  });

  await test('a finished two-card session with both tried earns the day', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var its = allMistakes().filter(trainable);
      ui.session = { mode: 't', label: 't', keys: [its[5].key, its[6].key], idx: 1, results: {}, relearn: [], relearnOf: {} };
      ui.session.attempted = 2; finishSession(); return JSON.stringify({ counts: dayCounts(dayLoad()) }); })()`));
    eq(r.counts, true, 'day counts');
  });

  await test('a finished session with three real tries earns the day', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[3]; openCard(it);
      ui.session.attempted = 3; finishSession(); return JSON.stringify({ day: dayLoad(), counts: dayCounts(dayLoad()), week: weekDays() }); })()`));
    eq(r.counts, true, 'day counts'); eq(r.day.sessions, 1, 'sessions'); eq(r.week, 1, 'week days');
  });

  await test('while the read is short, there is no focus, and nothing is stored', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 12, total: 50, ready: 20, working: true }; };
      return JSON.stringify({ f: currentFocus() }); })()`));
    eq(r.f, null, 'focus');
    ok(!Object.keys(A.storage).some((k) => /focus/.test(k)), 'no focus key');
  });
  await test('a 5-to-0 lead after 5 games is not a focus', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 5, total: 5, ready: 5, working: false }; };
      insightFamiliesQuick = function () { return [{ fam: FAMILIES[0], count: 5, cost: 4, learned: 0 }]; };
      return JSON.stringify({ f: currentFocus() }); })()`));
    eq(r.f, null, 'focus');
  });

  await test('after the read, a clear leader is the focus, and it is the first family in Insights', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      analysisNumbers = function () { return { covered: 50, total: 50, ready: 40, working: false }; };
      var f = currentFocus(), top = insightReport().families[0];
      return JSON.stringify({ f: f, top: top && top.fam.key }); })()`));
    ok(r.f, 'shown'); eq(r.f.fam, r.top, 'family');
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

  await test('a ?u= link is read once: a reload opens the saved player', () => {
    const A = boot({ session: { 'nl:linkUser': 'someone', 'nl:linkSrc': 'lichess' } });
    eq(A.ev('cfg.user'), 'someone', 'link player');
    eq(A.session['nl:linkUser'], undefined, 'link cleared from the tab');
    const B = makeApp({ now: T0, storage: A.storage, session: A.session });
    eq(B.ev('cfg.user'), 'tester', 'after reload');
    const C = makeApp({ now: T0, storage: {}, session: { 'nl:linkUser': 'someone' } });
    const D = makeApp({ now: T0, storage: C.storage, session: C.session });
    eq(D.ev('cfg.user'), '', 'fresh browser reload shows the landing');
  });

  await test('a ?u= link never saves the linked player\'s formats', () => {
    const st = Object.assign(base(), { 'nl:perfs': JSON.stringify(['rapid']), 'nl:tcs': JSON.stringify(['10+0']), 'nl:perfsFor': JSON.stringify('cc:tester') });
    const A = makeApp({ now: T0, storage: st, session: { 'nl:linkUser': 'someone', 'nl:linkSrc': 'lichess' } });
    eq(A.ev('cfg.perfs'), null, 'link starts from its own profile');
    A.ev(`setPerfs(['bullet'])`);
    eq(A.storage['nl:perfs'], JSON.stringify(['rapid']), 'saved formats kept');
    eq(A.storage['nl:tcs'], JSON.stringify(['10+0']), 'saved time controls kept');
    eq(JSON.stringify(A.ev('trackedPerfs()')), JSON.stringify(['bullet']), 'link trains its own format');
  });

  await test('a link to this browser\'s own player is a plain visit; a site without a name changes nothing', () => {
    const A = boot({ session: { 'nl:linkUser': 'Tester', 'nl:linkSrc': 'chesscom' } });
    eq(A.ev('linkVisit'), false, 'own link');
    const B = boot({ session: { 'nl:linkSrc': 'lichess' } });
    eq(B.ev('cfg.src'), 'chesscom', 'site kept'); eq(B.ev('cfg.user'), 'tester', 'player kept');
  });

  await test('saved formats belong to one player', () => {
    const st = Object.assign(base(), { 'nl:perfs': JSON.stringify(['bullet']), 'nl:perfsFor': JSON.stringify('other') });
    const A = makeApp({ now: T0, storage: st });
    eq(A.ev('cfg.perfs'), null, 'another player\'s formats dropped');
    const st2 = Object.assign(base(), { 'nl:perfs': JSON.stringify(['blitz']), 'nl:perfsFor': JSON.stringify('cc:tester') });
    eq(JSON.stringify(makeApp({ now: T0, storage: st2 }).ev('cfg.perfs')), JSON.stringify(['blitz']), 'own formats kept');
  });

  await test('a first visit and a same-day reload send first_visit only', () => {
    const A = boot();
    A.ev(`(function () { window.clarity = function () { window.__calls = (window.__calls || []).concat([Array.prototype.slice.call(arguments)]); }; return 1; })()`);
    A.ev(`(function () { store.del('nl:firstSeen:' + playerId()); returnEvents(); returnEvents(); return 1; })()`);
    const got = JSON.parse(A.ev('JSON.stringify(window.__calls || [])'));
    ok(got.some((c) => c[1] === 'first_visit'), 'first_visit');
    ok(!got.some((c) => /^return_/.test(c[1]) || c[1] === 'active_days'), JSON.stringify(got));
  });

  await test('a paused session counts one more try in its totals', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`JSON.stringify([sessionDoneCount({ keys: ['a', 'b', 'a'], results: { a: 'fail', b: 'first', 'a#r': 'first' }, relearn: [] }),
      sessionTotal({ keys: ['a', 'b'], results: {}, relearn: ['a'] })])`));
    eq(r[0], 3, 'done'); eq(r[1], 3, 'total');
  });

  await test('a new weekly goal applies from next week; past weeks keep theirs', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var mon = mondayOf(new Date());
      /* two full past weeks at 4 days each */
      [1, 2].forEach(function (w) { for (var i = 0; i < 4; i++) { var d = new Date(mon - w * 7 * DAY + (i * 2) * DAY + 12 * 3600e3); store.set('nl:day:' + playerId() + ':' + dayStamp(d), { sessions: 1 }); } });
      var before = weeksAtGoal();
      setWeekGoal(5);
      return JSON.stringify({ before: before, after: weeksAtGoal(), now: goalThisWeek(), chosen: weekGoal() }); })()`));
    eq(r.before, 2, 'weeks before'); eq(r.after, 2, 'weeks after the change'); eq(r.now, 4, 'this week'); eq(r.chosen, 5, 'chosen');
  });

  await test('Start over on a paused card after a miss grades it a fail', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[0], a = openCard(it);
      a.misses = 1; a.attempts = 1; keepProgress(a); ui.session = null;
      settleSaved(savedSession()); store.del(sessKey());
      var rec = srsLoad()[it.key];
      return JSON.stringify({ lapses: rec && rec.lapses }); })()`));
    eq(r.lapses, 1, 'graded a fail');
  });

  await test('tries from a closed paused session count only toward 3', () => {
    const run = (tries) => {
      const A = boot();
      return JSON.parse(A.ev(`(function () {
        var its = allMistakes().filter(trainable);
        store.set(sessKey(), { date: dayStamp(), mode: 'today', label: 'x', keys: [its[0].key, its[1].key], idx: 1, results: {}, relearn: [], relearnOf: {}, progress: {}, attempted: ${tries} });
        startSession('drill', [its[2].key], 'd'); ui.session.active = null; finishSession();
        return JSON.stringify({ counted: (dayLoad().sessions || 0) > 0 }); })()`));
    };
    eq(run(3).counted, true, '3 carried'); eq(run(1).counted, false, '1 carried, none here');
  });

  await test('a skipped new position counts against the day\'s new positions', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { var it = allMistakes().filter(trainable)[1]; var f0 = dayLoad().fresh || 0; srsRecord(it, 'skip', {}); return JSON.stringify({ d: (dayLoad().fresh || 0) - f0 }); })()`));
    eq(r.d, 1, 'fresh count');
  });

  await test('a card left after a hint is captioned Skipped and not counted solved', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable)[0], a = openCard(it);
      a.hints = 1; settleLeft(a); ui.session.finished = true;
      var h = doneHtml(ui.session);
      return JSON.stringify({ skipped: h.indexOf('Skipped') !== -1, solved: /1 of 1 solved/.test(h) }); })()`));
    ok(r.skipped, 'caption'); ok(!r.solved, 'not solved');
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
      var it = allMistakes().filter(trainable)[4], a = openCard(it);
      var m = legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0];
      gradeMove(m); return 1; })()`);
    for (let i = 0; i < 6; i++) await tick();
    const r = JSON.parse(A.ev('JSON.stringify({ misses: ui.session.active.misses, v: ui.session.active.verdict && ui.session.active.verdict.html })'));
    eq(r.misses, 0, 'misses'); ok(/cannot check/i.test(r.v || ''), r.v);
    /* SF failed plus an off-book move: no miss, /cannot check/, the stored best still solves */
    const f = JSON.parse(A.ev(`(function () { ${OPEN}
      SF.state = 'failed';
      var q0 = SF.queue.length, it = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol; })[5], a = openCard(it);
      var m = legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0];
      gradeMove(m);
      var out = { misses: a.misses, v: a.verdict && a.verdict.html, phase: a.phase, kind: a.tried && a.tried.kind, asked: SF.queue.length - q0, srs: !!srsLoad()[it.key] };
      out.play = window.__nlTest.play(a.bestUci);
      out.after = { phase: a.phase, result: a.result || null, misses: a.misses };
      return JSON.stringify(out); })()`));
    eq(f.misses, 0, 'misses with the engine failed'); ok(/cannot check/i.test(f.v || ''), f.v);
    eq(f.phase, 'tried', 'the try stays on the board'); eq(f.kind, 'unchecked', 'kind'); eq(f.asked, 0, 'engine jobs');
    eq(f.srs, false, 'a schedule changed');
    eq(f.play, 'graded', 'the stored best is played'); eq(f.after.phase, 'done', 'solved'); eq(f.after.result, 'first', 'result'); eq(f.after.misses, 0, 'misses after');
  });

  await test('no card enters a check phase: every card opens on the position before your move, asking for a better one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], cards = 0, its = allMistakes().filter(trainable);
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        its.forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          cards++;
          var bad = [];
          if (a.phase !== 'guess') bad.push('phase ' + a.phase);
          if ('check1' in a) bad.push('a check question');
          if (stateFen(a.st) !== stateFen(a.pre)) bad.push('not the position before the move');
          if (!!a.st.w !== myPov(it)) bad.push('the wrong side to move');
          var tc = window.__nlTest.card();
          if (tc.phase !== 'guess' || 'check1' in tc) bad.push('the test window reports a check');
          var d = displayFor(a);
          if (/What can (White|Black) do now|Move their piece/.test(bandHtml(a, d) + d.strip)) bad.push('check wording');
          if (bad.length) out.push('tier ' + tier + ' ' + it.key + ': ' + bad.join(', '));
        });
      });
      return JSON.stringify({ out: out, cards: cards, trainable: its.length }); })()`));
    ok(r.cards === 3 * r.trainable, r.cards + ' cards of ' + r.trainable);
    eq(r.out.length, 0, r.out.length + ' cards, first: ' + r.out.slice(0, 3).join(' | '));
    /* and nothing in the page can start one, or count one in the recap */
    const page = fs.readFileSync(process.env.NL_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
    const left = page.match(/phase\s*[!=]==?\s*'check'|'check'\s*[!=]==?\s*\w+\.phase|checkShow|checkStep|check1|checksFound|spotted their reply/g);
    ok(!left, 'still in the page: ' + (left || []).join(', '));
  });

  await test('an opponent-piece tap never grades and the phase stays guess', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], taps = 0, q0 = SF.queue.length, saved = JSON.stringify(srsLoad());
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        var side = function (w) { return a.st.b.map(function (p, i) { return p && isW(p) === w ? i : -1; }).filter(function (i) { return i >= 0; }); };
        var mine = side(!!a.st.w), legal = legalMoves(a.st);
        /* with nothing selected, and with a piece of yours selected that cannot take there */
        side(!a.st.w).forEach(function (sq) {
          var from = mine.filter(function (f) { return !legal.some(function (m) { return m.from === f && m.to === sq; }); })[0];
          [-1, from].forEach(function (f) {
            if (f == null) return;
            a.sel = f;
            sessionClick(sq);
            taps++;
            if (a.phase !== 'guess' || a.attempts || a.misses || a.result) out.push(it.key + ' ' + (f >= 0 ? sqName(f) : 'none') + ' then ' + sqName(sq) + ': ' + a.phase);
          });
        });
      });
      return JSON.stringify({ out: out, taps: taps, q: SF.queue.length - q0, srs: JSON.stringify(srsLoad()) === saved }); })()`));
    ok(r.taps > 1000, 'taps ' + r.taps);
    eq(r.out.length, 0, r.out.length + ' graded, first: ' + r.out.slice(0, 3).join(' | '));
    eq(r.q, 0, 'engine jobs'); ok(r.srs, 'a schedule changed');
  });

  await test('no miss caption names the answer: the game move again and every try answered with the stored refutation', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      /* the verdict and the band once its reason has come: never the answer
         due now, and on a missed-chance card never its square either */
      var check = function (a, what) {
        if (a.phase !== 'tried' || !a.tried) return;
        var due = dueMove(a), best = sanOf(a.st, due), d = (a.reason = 2, displayFor(a));
        var said = [a.verdict ? a.verdict.html : '', d.row1, d.row2].join(' | ');
        n++;
        if (said.indexOf(best) !== -1 || (said.indexOf(sqName(due.to)) !== -1 && familyOf(patternOf(a.it.b)).key === 'chances')) out.push(what + ': ' + said);
      };
      /* a try answered as the engine stub answers it: the stored refutation
         when it is legal after the try, else the first legal reply */
      var tryIt = function (a, m, inLine) {
        var after = cloneState(a.st), ru = unpackUci(a.it.b.ru);
        applyMove(after, m);
        var stored = ru.length && playUci(after, ru).uci.length === ru.length, reply = stored ? ru : legalMoves(after).slice(0, 1).map(moveUci);
        miss(m, moveUci(m), { cp: 0, mate: stored ? a.it.b.ma : null, pv: [moveUci(m)].concat(reply), win: a.it.b.wa }, inLine);
      };
      /* tier 1 has no forcing lines; tier 3 asks the same moves as tier 2 */
      [1, 2].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          gradeMove(uciToMove(a.st, a.playedUci));
          check(a, 'tier ' + tier + ' ' + it.key + ' the game move');
          a = openCard(it);
          legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); }).slice(0, 12).forEach(function (m) {
            a = openCard(it); tryIt(a, m, false); check(a, 'tier ' + tier + ' ' + it.key + ' ' + moveUci(m));
          });
          if (a.sol && a.sol.length >= 3) {
            var mid = function () { var x = openCard(it); applyMove(x.st, uciToMove(x.st, x.sol[0])); applyMove(x.st, uciToMove(x.st, x.sol[1])); x.solIdx = 2; return x; };
            a = mid();
            legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.sol[2]; }).slice(0, 12).forEach(function (m) {
              a = mid(); tryIt(a, m, true); check(a, 'tier ' + tier + ' ' + it.key + ' mid-line ' + moveUci(m));
            });
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n > 1800, 'misses ' + r.n);
    eq(r.out.length, 0, 'leaks: ' + r.out.slice(0, 2).join(' | '));
  });

  await test('hints never name the answer on a missed-chance card', () => {
    const A = boot();
    const bad = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [];
      allMistakes().filter(trainable).forEach(function (it) {
        if (familyOf(patternOf(it.b)).key !== 'chances') return;
        var a = openCard(it);
        if (!a) return;
        var best = sanOf(a.pre, a.best), h1 = hintText(a);
        if (h1.indexOf(best) !== -1) out.push(it.key + ': ' + h1);
      });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, 'leaks: ' + bad.slice(0, 2).join(' | '));
  });

  await test('S1 to S5, S11 and the answered frame fit 26 / 40 / 60 characters and 15 words at every tier', () => {
    const A = boot();
    /* the fit ladder's own steps: a row that fits stays as it is; a longer
       one falls to its first sentence; then to the fallback; and a fallback
       over the cap leaves the row empty */
    const fit = (cands, row, fb) => A.ev(`fitRow(${JSON.stringify(cands)}, '${row}', ${JSON.stringify(fb)})`);
    eq(fit(['Rook takes on d6. Then the knight forks your king and queen.'], 'row2', 'F'), 'Rook takes on d6.', 'the first sentence when the whole row is too long');
    eq(fit(['It loses the bishop.'], 'row2', 'F'), 'It loses the bishop.', 'a row that fits is kept');
    eq(fit(['One two three four five six seven eight.'], 'row2', 'F'), 'F', 'eight words fall to the fallback');
    eq(fit(['This sentence is far too long to fit in row two at all.'], 'row2', 'A fallback that is also far too long for row two.'), '', 'a fallback over the cap leaves the row empty');
    eq(fit(['Too long a first sentence for the twenty-six.', 'Found it'], 'row1', 'F'), 'Found it', 'the first candidate that fits wins');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      /* the band's caps (FINAL-SPEC 3): row 1 26 characters, row 2 40 and 7
         words, a caption 60 and 8; the chip one short label */
      var out = [], frames = 0, seen = {};
      var cap = function (what, s, ch, words) {
        s = String(s || '');
        if (s.length > ch || (s && s.split(/\\s+/).length > words) || /\u2014/.test(s)) out.push(what + ' (' + s.length + '): ' + s);
      };
      /* principle 5: 15 words before the next tap, the band and the bar
         together (glyphs such as the arrows are not words) */
      var words = function (s) { return String(s || '').split(/\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length; };
      var band = function (what, a) {
        var d = displayFor(a);
        frames++;
        seen[what] = (seen[what] || 0) + 1;
        cap(what + ', row 1', d.row1, 26, 99); cap(what + ', row 2', d.row2, 40, 7); cap(what + ', caption', d.cap, 60, 8); cap(what + ', chip', d.chip, 14, 3);
        if (!d.cap && !d.row1) out.push(what + ': no row 1');
        var n = [d.row1, d.row2, d.chip, d.cap].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (x, y) { return x + words(y); }, 0);
        if (n > 15) out.push(what + ': ' + n + ' words, ' + [d.row1, d.row2, d.chip].join(' / ') + ' | ' + d.buttons.map(function (b) { return b.label; }).join(' | '));
        return d;
      };
      /* a word for a tap that is not a move, shown as the page shows it */
      var note = function (a, id) { a.note = { id: id, key: cardStateKey(a), seq: 0 }; return a; };
      /* a miss's reason (M3), in one of its forms or its fallbacks, in plain
         words ("the exchange" is spelled out as the rook and what it went for) */
      var plain = function (what, s) { if (/exchange/.test(s)) out.push(what + ' says ' + s); };
      var M3 = /^(Then \\S+ is checkmate\\.|(White|Black) could checkmate you\\.|You'd lose .+\\.|Most of your advantage is gone\\.|After \\S+, (the game is even|(White|Black) is on top)\\.|That helps (White|Black)\\.|There's a stronger move here\\.)$/;
      var theirs = function (a) { for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) !== !!a.st.w) return q; return -1; };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          var at = 'tier ' + tier + ' ' + it.key;
          /* S1: the task, in the spec's words */
          var d = band(at + ' open', a), want = 'Find a better move than ' + sanOf(a.pre, a.played) + '.';
          if (d.row1 !== 'Your turn' || d.row2 !== want || d.chip) out.push(at + ' open reads ' + d.row1 + ' / ' + d.row2 + ' / ' + d.chip);
          /* S1 on a relearn card: the chip */
          ui.session.keys = [it.key, it.key]; ui.session.relearnOf = {}; ui.session.relearnOf[it.key] = 1; ui.session.idx = 1;
          d = band(at + ' relearn', a);
          if (d.chip !== 'One more try') out.push(at + ' relearn chip: ' + d.chip);
          a = openCard(it);
          /* S2: a selection leaves the band as it was; the words for a tap
             that is not a move fit row 2 */
          var mine = legalMoves(a.st)[0];
          a.sel = mine.from;
          if (JSON.stringify(band(at + ' selected', a)) !== JSON.stringify((a.sel = -1, displayFor(a)))) out.push(at + ': a selection changed the band');
          ['T4', 'T5', 'N1'].forEach(function (id) { frames++; cap(at + ' ' + id, CARD_COPY[id](a), 40, 7); });
          /* in the band: T4 in full on the card, and over a relearn card's
             chip, which steps aside; in its short form beside a hint */
          var t4 = CARD_COPY.T4(a), t4s = 'Move a ' + sidesOf(a).mine + ' piece.';
          d = band(at + ' T4', note(a, 'T4'));
          if (d.row2 !== t4 || d.row1 !== 'Your turn') out.push(at + ' T4 reads ' + d.row1 + ' / ' + d.row2);
          d = band(at + ' T5', note(a, 'T5'));
          if (d.row2 !== CARD_COPY.T5(a)) out.push(at + ' T5 reads ' + d.row2);
          ui.session.keys = [it.key, it.key]; ui.session.relearnOf = {}; ui.session.relearnOf[it.key] = 1; ui.session.idx = 1;
          d = band(at + ' relearn, T4', note(a, 'T4'));
          if (d.row2 !== t4 || d.chip) out.push(at + ' relearn T4 reads ' + d.row2 + ' / chip ' + d.chip);
          a = openCard(it); a.hints = 1;
          d = band(at + ' hint 1, T4', note(a, 'T4'));
          if (d.row2 !== t4s) out.push(at + ' hint 1 T4 reads ' + d.row2);
          a = openCard(it);
          /* S3: a move being checked says nothing for 300 ms, then K1, then K2 at 3 s */
          var off0 = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
          if (off0) {
            SF.state = 'ready';
            gradeMove(off0);
            d = band(at + ' checking', a);
            /* the bar too: the guess bar until K1, then [Take back] [Show the answer] */
            var labs = function (d) { return d.buttons.map(function (b) { return b.label; }).join(' | '); };
            if (d.row1 !== 'Your turn' || labs(d) !== 'Hint | Show the answer') out.push(at + ' checking at once reads ' + d.row1 + ' | ' + labs(d));
            d = band(at + ' checking at once, T4', note(a, 'T4'));
            if (d.row1 !== 'Your turn' || d.row2 !== t4) out.push(at + ' T4 while checking at once reads ' + d.row1 + ' / ' + d.row2);
            a.note = null;
            a.checkSaid = 1; d = band(at + ' checking, 300 ms', a);
            if (d.row1 !== 'Checking ' + sanOf(a.st, off0) + '…' || d.row2 || !d.sweep || labs(d) !== 'Take back | Show the answer') out.push(at + ' K1 reads ' + d.row1 + ' / ' + d.row2 + ' | ' + labs(d));
            d = band(at + ' checking, 300 ms, T4', note(a, 'T4'));
            if (!/^Checking /.test(d.row1) || d.row2 !== t4 || !d.sweep) out.push(at + ' T4 while checking reads ' + d.row1 + ' / ' + d.row2);
            a.note = null;
            a.checkSaid = 2; d = band(at + ' checking, 3 s', a);
            if (d.row2 !== 'Still checking.') out.push(at + ' K2 reads ' + d.row2);
            takeBack();
            /* S5: a good move that is not the best; the second time row 1 alone */
            a = openCard(it); showTry(a, off0, 'close', null, null, false); d = band(at + ' close', a);
            if (d.row1 + ' / ' + d.row2 !== 'Good move / There\\'s a stronger one.' || d.disc !== 'close') out.push(at + ' close reads ' + d.row1 + ' / ' + d.row2);
            d = band(at + ' close, T4', note(a, 'T4'));
            a = openCard(it); showTry(a, off0, 'close', null, null, true); d = band(at + ' close again', a);
            if (d.row1 !== 'Good move' || d.row2) out.push(at + ' close again reads ' + d.row1 + ' / ' + d.row2);
            /* S11: a move the engine could not check */
            a = openCard(it); showTry(a, off0, 'unchecked', null); d = band(at + ' not checked', a);
            if (d.row1 + ' / ' + d.row2 !== 'Cannot check this move / Not counted. Try again.' || d.disc !== 'unchecked' || d.kind !== 'info') out.push(at + ' not checked reads ' + d.row1 + ' / ' + d.row2);
            d = band(at + ' not checked, T4', note(a, 'T4'));
            if (d.row2 !== t4s) out.push(at + ' not checked T4 reads ' + d.row2);
            /* S4: a miss says "Not this one" alone, then its reason (M3)
               once its beat comes (a.reason 2). With no concrete loss and
               outside a forcing line (where a try that loses nothing is
               close, never a miss), where the game stands: never "does not
               work" and never "Nothing lost" */
            a = openCard(it);
            miss(off0, moveUci(off0), { cp: it.b.eb, mate: null, pv: [moveUci(off0)], win: winPct(it.b.eb) }, false);
            d = band(at + ' a miss, the verdict', a);
            if (d.row1 !== 'Not this one' || d.row2) out.push(at + ' a miss before its reason reads ' + d.row1 + ' / ' + d.row2);
            a.reason = 2;
            d = band(at + ' a miss outside a line', a);
            if (/does not work|Nothing lost/.test(d.row2) || !M3.test(d.row2) || d.row1 !== 'Not this one') out.push(at + ' a miss outside a line reads ' + d.row1 + ' / ' + d.row2);
            d = band(at + ' a miss, T4', note(a, 'T4'));
            if (d.row2 !== t4) out.push(at + ' a miss T4 reads ' + d.row2);
            /* the same try answered with the card's stored refutation, as
               the engine stub answers it: M3 in every form the fixture gives */
            var ru0 = unpackUci(it.b.ru), aft0 = cloneState(a.st);
            a = openCard(it); applyMove(aft0, off0);
            if (ru0.length && playUci(aft0, ru0).uci.length === ru0.length) {
              miss(off0, moveUci(off0), { cp: it.b.ea != null ? it.b.ea : cpFromWin(it.b.wa), mate: it.b.ma, pv: [moveUci(off0)].concat(ru0), win: it.b.wa }, false);
              a.reason = 2; d = band(at + ' a miss with a reply', a);
              if (!M3.test(d.row2)) out.push(at + ' a miss with a reply reads ' + d.row1 + ' / ' + d.row2);
              plain(at + ' a miss with a reply', a.verdict.cands.join(' | '));
              if (a.tried.reply) { seeIt(); band(at + ' a miss with a reply, seen', a); }
            }
            /* inside a forcing line a try that loses nothing is a miss, and says so honestly */
            if (a.sol && a.sol.length >= 3) {
              a = openCard(it);
              applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2;
              var offL = legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.sol[2]; })[0];
              miss(offL, moveUci(offL), { cp: it.b.eb, mate: null, pv: [moveUci(offL)], win: winPct(it.b.eb) }, true);
              a.reason = 2; d = band(at + ' a miss that loses nothing, in a line', a);
              if (d.row1 + ' / ' + d.row2 !== 'Not this one / Nothing lost, but there\\'s a better move.') out.push(at + ' a miss that loses nothing in a line reads ' + d.row1 + ' / ' + d.row2);
            }
          }
          a = openCard(it);
          /* and, until their slices give them their own words, the hints
             and a try being checked stay in the caps */
          a.hints = 1; band(at + ' hint 1', a); a.hints = 2; band(at + ' hint 2', a); a.hints = 0;
          /* the game move again: M2, then its reason (M3 from the card's own
             refutation, or on a missed-chance card that there is more) */
          gradeMove(uciToMove(a.st, a.playedUci)); d = band(at + ' game move again', a);
          if (d.row1 !== 'Your game move again' || d.row2) out.push(at + ' game move again reads ' + d.row1 + ' / ' + d.row2);
          a.reason = 2; d = band(at + ' game move again, its reason', a);
          plain(at + ' game move again', a.verdict.cands.join(' | '));
          if (!M3.test(d.row2) && !(d.row2 === '' && !M3.test(a.verdict.row2))) out.push(at + ' game move again, its reason reads ' + d.row2 + ' (' + a.verdict.row2 + ')');
          if (familyOf(patternOf(it.b)).key === 'chances' && a.verdict.row2 !== 'There\\'s a stronger move here.') out.push(at + ' a missed chance\\'s game move reads ' + a.verdict.row2);
          if (a.tried && a.tried.reply) { seeIt(); band(at + ' game move again, seen', a); }
          a = openCard(it);
          var off = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
          if (off) { gradeMove(off); band(at + ' a try ' + a.phase, a); }
          /* the answered frame: shown, found, found after a miss, close then shown, works too */
          a = openCard(it); reveal(); d = band(at + ' shown', a);
          if (d.row1 !== 'The answer: ' + a.lines.best.san[0]) out.push(at + ' shown reads ' + d.row1);
          d = band(at + ' shown, N1', note(a, 'N1'));
          if (d.row2 !== 'To try moves, open Details.') out.push(at + ' N1 reads ' + d.row2);
          a = openCard(it); a.foundGood = { san: sanOf(a.st, mine), win: 60 }; reveal(); band(at + ' shown after a close move', a);
          if (!a.sol) {
            a = openCard(it); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); d = band(at + ' found', a);
            if (d.row1 !== 'Found it') out.push(at + ' found reads ' + d.row1);
            a = openCard(it); a.misses = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); d = band(at + ' found after a miss', a);
            if (d.row1 !== 'You got there') out.push(at + ' found after a miss reads ' + d.row1);
            a = openCard(it); var alt = off || mine;
            if (moveUci(alt) !== a.bestUci) {
              a.yours = { uci: [moveUci(alt)], cp: 0, at: 0 };
              solved(alt, moveUci(alt), { win: 50, best: 52, mate: null }); band(at + ' works too', a);
            }
          }
        });
      });
      return JSON.stringify({ out: out, frames: frames, seen: seen }); })()`));
    ok(r.frames > 6000, 'frames ' + r.frames);
    eq(r.out.length, 0, r.out.length + ' too long, first: ' + r.out.slice(0, 3).join(' | '));
    ['K1', 'checking, 3 s', 'close again', 'not checked, T4', 'a miss outside a line', 'a miss with a reply', 'game move again, its reason', 'a miss that loses nothing, in a line', 'shown, N1'].forEach((k) => ok(Object.keys(r.seen).some((w) => w.indexOf(k.replace('K1', 'checking, 300 ms')) >= 0), 'no ' + k + ' frame'));
  });

  await test('one format by default: the most played among those played in the last 90 days', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var now = Date.now(), d = 864e5;
      var cc = { perfs: { blitz: { games: 1205, last: now - 400 * d }, rapid: { games: 900, last: now - 3 * d }, bullet: { games: 40, last: now - 2 * d } } };
      var stale = { perfs: { blitz: { games: 5000, last: now - 100 * d }, rapid: { games: 20, last: now - 10 * d } } };
      var li = { perfs: { bullet: { games: 45308 }, rapid: { games: 2458 }, blitz: { games: 900 } } };
      var none = { perfs: { rapid: { games: 50, last: now - 200 * d }, blitz: { games: 10, last: now - 300 * d } } };
      return JSON.stringify([autoPerfs(cc), autoPerfs(stale), autoPerfs(li), autoPerfs(none)]); })()`));
    eq(JSON.stringify(r[0]), '["rapid"]', 'chess.com, blitz gone quiet');
    eq(JSON.stringify(r[1]), '["rapid"]', 'a format last played 100 days ago');
    eq(JSON.stringify(r[2]), '["bullet"]', 'lichess, lifetime counts');
    eq(JSON.stringify(r[3]), '["rapid"]', 'nothing recent: the most played');
  });

  await test('the first session opens on the move that decided the latest loss, when it is not a quiet one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var p = todayPlan(), m = model(), first = m.byKey[p.keys[0]];
      var cands = allMistakes().filter(trainable).filter(function (it) { return it.b.d && it.g.res === 'loss' && cardEase(it) >= 2; })
        .sort(function (x, y) { return y.g.ts - x.g.ts; });
      return JSON.stringify({ firstTime: p.firstTime, first: first && first.key, expect: cands[0] && cands[0].key }); })()`));
    eq(r.firstTime, true, 'first session'); eq(r.first, r.expect, 'card 1');
  });

  await test('first-session card 1 is not forcing, and at most one of the first three is', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var m = model(), out = {}, realEase = cardEase, realLooks = looksForcing, its = allMistakes().filter(trainable);
      var count = function (keys, fn) { return keys.slice(0, 3).filter(function (k) { return fn(m.byKey[k]); }).length; };
      var asks = function (it) { var a = cardFor(it); return !!(a && a.sol); };
      playerTier = function () { return 2; };
      var keys = todayPlan().keys;
      out.plain = { n: keys.length, first: asks(m.byKey[keys[0]]), three: count(keys, asks) };
      /* ease ties put one-move cards first: a forcing card is dealt only when
         no one-move card as easy is left out (the plan's own candidates) */
      var pool = buildCandidates(11).concat(buildCandidates(60));
      out.tieSkips = keys.filter(function (k) { return looksForcing(m.byKey[k]); }).map(function (k) {
        var e = cardEase(m.byKey[k]);
        return pool.filter(function (it) { return keys.indexOf(it.key) < 0 && !looksForcing(it) && cardEase(it) >= e; }).length;
      }).reduce(function (x, y) { return x + y; }, 0);
      /* the plan's rule never misses a card that asks for a forcing line */
      out.forcing = its.filter(asks).length;
      out.missed = its.filter(function (it) { return asks(it) && !looksForcing(it); }).length;
      /* forcing cards made the easiest of all: card 1 still asks for one move */
      cardEase = function (it) { return realLooks(it) ? 3 : 2; };
      keys = todayPlan().keys;
      out.easiest = { first: looksForcing(m.byKey[keys[0]]), three: count(keys, looksForcing) };
      cardEase = realEase;
      /* the latest loss leads, unless it looks forcing: then it keeps its place in the ease order */
      var lost = its.filter(function (it) { return it.b.d && it.g.res === 'loss'; }).sort(function (x, y) { return y.g.ts - x.g.ts; })[0];
      out.lostLeads = todayPlan().keys[0] === lost.key;
      looksForcing = function (it) { return it === lost || realLooks(it); };
      out.forcingLostAt = todayPlan().keys.indexOf(lost.key);
      looksForcing = realLooks;
      return JSON.stringify(out); })()`));
    ok(r.plain.n >= 3, 'cards ' + r.plain.n);
    eq(r.plain.first, false, 'card 1 asks for a forcing line'); ok(r.plain.three <= 1, r.plain.three + ' forcing in the first three');
    ok(r.forcing > 0, 'no forcing cards at tier 2'); eq(r.missed, 0, 'forcing cards the plan cannot see');
    eq(r.easiest.first, false, 'card 1, forcing cards easiest'); ok(r.easiest.three <= 1, r.easiest.three + ' forcing in the first three, forcing cards easiest');
    eq(r.tieSkips, 0, 'one-move cards as easy left out for a forcing card');
    eq(r.lostLeads, true, 'the latest loss leads'); ok(r.forcingLostAt < 0 || r.forcingLostAt >= 2, 'a forcing latest loss pulled forward, card ' + (r.forcingLostAt + 1));
  });

  await test('the coarse events carry no names or ratings', () => {
    const calls = [];
    const A = boot();
    A.ev(`(function () { window.clarity = function () { window.__calls = (window.__calls || []).concat([Array.prototype.slice.call(arguments)]); }; return 1; })()`);
    A.ev(`(function () { store.set('nl:firstSeen:' + playerId(), Date.now() - 3 * 864e5); returnEvents(); track('solve_first'); track('close_shown'); return 1; })()`);
    const got = JSON.parse(A.ev('JSON.stringify(window.__calls || [])'));
    ok(got.some((c) => c[1] === 'return_d2_7'), JSON.stringify(got));
    ok(got.some((c) => c[1] === 'active_days'), 'active days');
    ok(!JSON.stringify(got).includes('tester') && !/opponent\d/.test(JSON.stringify(got)), 'names in events');
  });

  await test('the manifest and its icons are what they claim', () => {
    const root = path.join(__dirname, '..');
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    eq(m.name, 'notlichess', 'name'); eq(m.start_url, '/#train', 'start_url'); eq(m.display, 'standalone', 'display');
    m.icons.forEach((ic) => {
      const b = fs.readFileSync(path.join(root, ic.src.replace(/^\//, '')));
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      eq(w + 'x' + h, ic.sizes, ic.src);
    });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    ok(html.includes('rel="manifest"') && html.includes('apple-touch-icon'), 'linked from the page');
    ok(!html.includes('cdn.jsdelivr.net'), 'no CDN engine');
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'sessions and bookkeeping: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
