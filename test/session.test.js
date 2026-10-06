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

/* plain words on the card face (FINAL-SPEC 3): no percentages, "winning
   chances", "about level", "edge", "lead", "exchange", "Stockfish" at tier
   1, and no pattern names ("pinned" and "fork" only at tier 3). unplain(s,
   tier) names the first word that breaks it, '' when none does */
const PLAIN = `function unplain(s, tier) {
  s = String(s || '');
  var m = /\\d+ ?%|winning chances|about level|\\bedge\\b|\\blead\\b|\\bexchange\\b/i.exec(s);
  if (m) return m[0];
  if (tier === 1 && /stockfish/i.test(s)) return 'Stockfish';
  var re = /\\b(forks?|forked|forking|pins?|pinned|pinning|skewers?|skewered|discovered|hanging|hidden attack|tactics?|tactical|overload(ed|ing)?|deflection|decoy|zwischenzug|desperado|x-ray|back rank)\\b/gi, w;
  while ((w = re.exec(s))) if (!(tier === 3 && /^(fork|pinned)$/i.test(w[1]))) return w[1];
  return '';
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

  await test('hints never name the answer, in words or marks: every card and tier, hints 1 and 2, on the card and inside a forcing line; a prize ringed is a piece the line wins', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      ${PLAIN}
      var out = [], n = { frames: 0, plain2: 0, danger: 0, dropped: 0, harmless: 0, plain: 0, prize: 0, prizeDropped: 0, words: 0, mid: 0, ring2: 0 };
      var same = function (x, y) { return JSON.stringify(x) === JSON.stringify(y); };
      var words = function (s) { return String(s || '').split(/[\\s.,:]+/); };
      /* "You can win X here.": X is the line's own captures, or the two
         words that claim no piece ("a lot of material" worth 6 or more) */
      var prizeWord = function (what, a, s) {
        var m = /^You can win (.+) here\\.$/.exec(s), c = a.cls;
        if (!m) return;
        n.words++;
        var own = plainCapture(c.bestLine, c.bSettle);
        if (m[1] === own || m[1] === 'material' || (m[1] === 'a lot of material' && Math.abs(c.matBest) >= 6)) return;
        out.push(what + ': "' + s + '" where the line took ' + (own || 'no one phrase') + ' (net ' + c.matBest + ')');
      };
      var frame = function (what, a) {
        n.frames++;
        var due = dueMove(a), dueSan = sanOf(a.st, due), d = displayFor(a), h = hintText(a), hm = hintMarks(a), f = boardOptsFor(a);
        if (h.row1 !== d.row1) out.push(what + ': the band reads ' + d.row1 + ', the hint ' + h.row1);
        if (!same(h.marks, hm)) out.push(what + ': hintText draws other marks than hintMarks');
        if (words(d.row1).concat(words(d.row2)).indexOf(dueSan) >= 0) out.push(what + ' names the answer: ' + d.row1 + ' / ' + d.row2);
        /* nor the answer's square, inside any move it names but the game move (whose red arrow is on the card) */
        [d.row2].concat(h.cands, [h.fall]).forEach(function (x) {
          if (words(x).indexOf(dueSan) >= 0) out.push(what + ' has a form naming the answer: ' + x);
          if (String(x).split(gameSan(a)).join(' ').indexOf(sqName(due.to)) >= 0) out.push(what + ' names the answer square: ' + x);
        });
        /* every hint string, ladder and fallback too, in plain words at this tier */
        [d.row1, d.row2, h.fall].concat(h.cands).forEach(function (x) { var bad = unplain(x, a.tier); n.plain2++; if (bad) out.push(what + ': "' + bad + '" in a hint: ' + x); });
        /* the board draws exactly these marks */
        var rings = (f.opts.rings || []).filter(function (m) { return m.kind !== 'nope'; }), arrows = (f.opts.arrows || []);
        if (!same(rings, hm.rings) || !same(arrows, hm.arrows) || f.opts.hint != null) out.push(what + ': the board draws ' + JSON.stringify([rings, arrows, f.opts.hint]) + ' for ' + JSON.stringify([hm.rings, hm.arrows]));
        var sqs = [];
        hm.rings.forEach(function (m) { sqs.push(m.sq); });
        hm.arrows.forEach(function (m) { sqs.push(m.from, m.to); });
        if (a.hints >= 2) {
          n.ring2++;
          if (!same(hm.rings, [{ sq: due.from, kind: 'hint' }]) || hm.arrows.length) out.push(what + ': hint 2 draws ' + JSON.stringify(hm));
          if (d.row1 !== 'Hint 2 of 2' || d.row2 !== 'Move the circled piece.') out.push(what + ': hint 2 reads ' + d.row1 + ' / ' + d.row2);
          return;
        }
        if (d.row1 !== 'Hint 1 of 2') out.push(what + ': hint 1 reads ' + d.row1);
        /* hint 1 never touches the answer's squares, both arrow ends */
        if (sqs.indexOf(due.from) >= 0 || sqs.indexOf(due.to) >= 0) out.push(what + ': hint 1 marks the answer ' + JSON.stringify(hm));
        if (a.sol && a.solIdx > 0) {
          n.mid++;
          var mine = checkersOf(a.st).length > 0 && !!a.st.w === myPov(a.it);
          if (sqs.length) out.push(what + ': an in-line hint 1 draws ' + JSON.stringify(hm));
          if (d.row2 !== (mine ? 'Your king is in check.' : 'The next move is forcing too.')) out.push(what + ': an in-line hint 1 reads ' + d.row2);
          return;
        }
        var fam = familyOf(patternOf(a.it.b)).key, c = a.cls, th = threatOf(c.gameLine, 1);
        prizeWord(what, a, d.row2); h.cands.forEach(function (x) { prizeWord(what + ' (ladder)', a, x); });
        if (fam === 'chances') {
          if (hm.arrows.length || hm.rings.some(function (m) { return m.kind !== 'target'; }) || hm.rings.length > 1) out.push(what + ': a missed chance draws ' + JSON.stringify(hm));
          var pz = hintPrize(a);
          if (pz && (pz.sq === due.to || pz.sq === due.from)) n.prizeDropped++;
          if (!hm.rings.length) return;
          n.prize++;
          /* truth: the piece ringed stands there now, is theirs, and the
             stored line (starting with the answer, winning material) takes
             it on that square before it settles, nothing having moved there */
          var sq = hm.rings[0].sq, p = a.st.b[sq], line = c.bestLine, took = false, touched = false;
          if (!p || isW(p) === myPov(a.it) || pType(p) === 'K') out.push(what + ': the prize ring is on ' + (p || 'an empty square'));
          if (!(c.matBest >= 1) || line.unsettled || moveUci(line.nodes[1].move) !== a.bestUci) out.push(what + ': a prize on a line that wins nothing');
          for (var k = 1; k <= c.bSettle && k < line.nodes.length && !took; k++) {
            var nd = line.nodes[k], at = nd.move.ep >= 0 ? nd.move.ep : nd.move.to;
            if (at === sq && nd.pov && nd.captured === p && !touched) took = true;
            if (nd.move.from === sq || nd.move.to === sq) touched = true;
          }
          if (!took) out.push(what + ': the line never wins the ' + p + ' on ' + sqName(sq));
          return;
        }
        /* a danger is drawn only for a reply that captures or checks on a
           game line that really loses (material, or a checkmate) */
        var hurts = th && (c.lossG >= 1 || c.mateAgainst);
        if (th && !hurts) n.harmless++;
        if (hurts && (sqs.length || [th.from, th.to].some(function (q) { return q === due.from || q === due.to; }))) {
          if (sqs.length) {
            n.danger++;
            if (!same(hm.rings, [{ sq: th.from, kind: 'threat' }]) || hm.arrows.length !== 1 || hm.arrows[0].from !== th.from || hm.arrows[0].to !== th.to || hm.arrows[0].kind !== 'threat') out.push(what + ': the danger drawn is not the game reply ' + th.san + ': ' + JSON.stringify(hm));
            if (!a.st.b[th.from] || isW(a.st.b[th.from]) === myPov(a.it)) out.push(what + ': the ring is not on a piece of theirs');
            if (d.row2 !== 'See what ' + gameSan(a) + ' runs into.') out.push(what + ': a danger reads ' + d.row2);
          } else n.dropped++;
        } else if (sqs.length) out.push(what + ': marks with no losing capture or check to show ' + JSON.stringify(hm));
        if (!sqs.length) {
          /* "runs into" only beside its marks; then H2 by family: a winning
             position keeps it simple, a quiet one improves its worst
             piece, safety and king say what the answer gets or keep it safe */
          if (/runs into/.test(d.row2)) out.push(what + ': says runs into with nothing drawn');
          if (fam === 'conversion' && d.row2 !== 'Keep it simple and safe.') out.push(what + ': a winning position reads ' + d.row2);
          if (fam === 'quiet' && !/^(Find your worst piece and improve it|Improve your worst piece)\.$/.test(d.row2)) out.push(what + ': a quiet position reads ' + d.row2);
          if (fam === 'safety' || fam === 'king') {
            n.plain++;
            var get = c.mateFor ? 'There is a checkmate here.' : null;
            if (!(d.row2 === get || /^You can win .+ here\.$/.test(d.row2) && c.matBest >= 1 && !c.mateFor || d.row2 === 'Keep it simple and safe.' && !c.mateFor && !(c.matBest >= 1 && c.bestLine && !c.bestLine.unsettled))) out.push(what + ': a ' + fam + ' card with nothing drawn reads ' + d.row2);
          }
        }
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key;
          [1, 2].forEach(function (h) {
            var a = openCard(it);
            if (!a) return;
            a.hints = h; a.hintAfter = true; frame(at + ' hint ' + h, a);
            /* inside a forcing line, at each of your moves after the first */
            for (var i = 2; a.sol && i < a.sol.length; i += 2) {
              a = openCard(it);
              for (var j = 0; j < i; j++) { var m = uciToMove(a.st, a.sol[j]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; }
              a.solIdx = i; a.hints = h; a.hintAfter = true;
              frame(at + ' move ' + (i / 2 + 1) + ' hint ' + h, a);
            }
          });
        });
      });
      /* what the fixture never reaches, doctored: a card whose answer is
         not its line's first move has no prize; a prize square holding
         another piece now is not ringed; with no one phrase for what
         changed hands (three kinds of piece) only "material" or "a lot of
         material" is said; a game move spelled like the answer drops "runs
         into"; a piece that came to its square during the line is not the
         one standing there now */
      var fx = { line: 0, swap: 0, word: 0, mate: 0, fork: 0 };
      playerTier = function () { return 2; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        a.hints = 1;
        var at = 'doctored ' + it.key, fam = familyOf(patternOf(it.b)).key, pz = hintPrize(a), c = a.cls;
        if (fam === 'chances' && pz) {
          var keep = [a.best, a.bestUci], other = legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.bestUci; })[0];
          a.best = other; a.bestUci = moveUci(other);
          fx.line++;
          if (hintPrize(a)) out.push(at + ': a prize on a line that does not start with the answer');
          a.best = keep[0]; a.bestUci = keep[1];
          var was = a.pre.b[pz.sq], alt = pType(was) === 'P' ? (isW(was) ? 'N' : 'n') : (isW(was) ? 'P' : 'p');
          a.pre.b[pz.sq] = a.st.b[pz.sq] = alt;
          fx.swap++;
          var pz2 = hintPrize(a);
          if (pz2 && pz2.sq === pz.sq) out.push(at + ': the prize ring stays on ' + sqName(pz.sq) + ' over another piece');
          a.pre.b[pz.sq] = a.st.b[pz.sq] = was;
        }
        if (fam === 'chances' && c.matBest >= 1 && !c.mateFor && c.bestLine && !c.bestLine.unsettled) {
          var cw = captureWord;
          captureWord = function () { return 'material'; };
          try { fx.word++; hintText(a).cands.concat([displayFor(a).row2]).forEach(function (x) { prizeWord(at + ' (three kinds of piece)', a, x); }); } finally { captureWord = cw; }
        }
        /* a form that would name the answer gives way to the fallback, its
           family's own (a win claimed only where the line wins) */
        if (fam !== 'chances' && hintDanger(a)) {
          var gs = gameSan, ans = sanOf(a.st, a.best), wins = c.matBest >= 1 && c.bestLine && !c.bestLine.unsettled;
          gameSan = function () { return ans; };
          try {
            var hx = hintText(a); fx.named = (fx.named || 0) + 1;
            hx.cands.concat([hx.fall, hx.row2]).forEach(function (x) { if (words(x).indexOf(ans) >= 0) out.push(at + ': a hint names the answer: ' + x); });
            if (/^You can win/.test(hx.row2) && !wins) out.push(at + ': the fallback claims a win the line does not have: ' + hx.row2);
          } finally { gameSan = gs; }
        }
        /* a checkmate against you with no material lost is a danger too */
        var th1 = threatOf(c.gameLine, 1);
        if (fam !== 'chances' && th1 && a.pre.b[th1.from] && isW(a.pre.b[th1.from]) !== myPov(a.it)) {
          var keepL = [c.lossG, c.mateAgainst];
          c.lossG = 0; c.mateAgainst = 3;
          try { fx.mate++; if (!hintDanger(a)) out.push(at + ': a reply leading to mate is no danger'); c.mateAgainst = null; if (hintDanger(a)) out.push(at + ': a reply that loses nothing is a danger'); } finally { c.lossG = keepL[0]; c.mateAgainst = keepL[1]; }
        }
        /* the fork form (reached only when the best line is missing) in plain words at tiers 1 and 2 */
        if (fam === 'chances' && !c.mateFor) {
          var keepF = [c.bestLine, c.missed];
          c.bestLine = null; c.missed = { fork: { ply: 1 } };
          try {
            var fr = hintText(a);
            fx.fork++;
            if (fr.row2 !== 'One piece can hit two targets.' && fr.row2 !== 'You can win material here.') out.push(at + ': the fork form reads ' + fr.row2);
            [1, 2].forEach(function (tr) { [fr.row2].concat(fr.cands).forEach(function (x) { var bad = unplain(x, tr); if (bad) out.push(at + ': "' + bad + '" at tier ' + tr + ': ' + x); }); });
          } finally { c.bestLine = keepF[0]; c.missed = keepF[1]; }
        }
      });
      var st0 = stateFromFen('4k3/8/8/3n4/1n6/8/8/R3K3 w - - 0 1');
      var fake = { cls: { bestLine: buildLine(st0, '0000', ['a1a2', 'b4c6', 'a2b2', 'd5b4', 'b2b4'], true), bSettle: 5, matBest: 3, mateFor: 0 }, best: uciToMove(st0, 'a1a2'), pre: st0 };
      if (hintPrize(fake)) out.push('a knight that came to b4 during the line is ringed as the one standing there: ' + JSON.stringify(hintPrize(fake)));
      fake.cls.bestLine = buildLine(st0, '0000', ['a1a2', 'e8d8', 'a2b2', 'd8e8', 'b2b4'], true);
      var ctl = hintPrize(fake);
      if (!ctl || ctl.sq !== 25 || ctl.p !== 'n') out.push('the knight standing on b4 all along is not the prize: ' + JSON.stringify(ctl));
      n.doctored = fx;
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.doctored.line >= 5 && r.n.doctored.word >= 10 && r.n.doctored.named >= 20 && r.n.doctored.mate >= 20 && r.n.doctored.fork >= 5, JSON.stringify(r.n.doctored));
    ok(r.n.frames > 600 && r.n.danger > 60 && r.n.dropped >= 10 && r.n.harmless >= 6 && r.n.plain >= 40 && r.n.prize >= 10 && r.n.words >= 30 && r.n.mid > 30 && r.n.ring2 > 300 && r.n.plain2 > 4 * r.n.frames, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('U3: an in-line hint says "Your king is in check." only when the solver\'s own king is in check, on the position the card asks from', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { mine: 0, free: 0, theirs: 0 };
      [2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a || !a.sol) return;
          for (var i = 0; i < a.sol.length; i++) {
            var m = uciToMove(a.st, a.sol[i]);
            applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx = i + 1;
            var at = 'tier ' + tier + ' ' + it.key + ' after ' + a.sol.slice(0, i + 1).join(' ');
            var checked = checkersOf(a.st).length > 0;
            a.hints = 1; a.hintAfter = true;
            if (i % 2 === 0) {
              /* your move just made, their reply to come (phase reply): their
                 king in check is never yours */
              if (checked) n.theirs++;
              a.phase = 'reply';
              if (/king is in check/.test(hintText(a).row2)) out.push(at + ' (reply): ' + hintText(a).row2);
              a.phase = 'guess';
              continue;
            }
            /* your move again (phase guess): the band says it exactly when
               your king is attacked; while a move is checked (before K1) it
               keeps saying it, after K1 the band speaks of the check */
            checked ? n.mine++ : n.free++;
            var d = displayFor(a), want = checked ? 'Your king is in check.' : 'The next move is forcing too.';
            if (d.row1 !== 'Hint 1 of 2' || d.row2 !== want) out.push(at + ': ' + d.row1 + ' / ' + d.row2 + ', want ' + want);
            a.phase = 'checking'; a.checkSaid = 0;
            if (displayFor(a).row2 !== want) out.push(at + ' (checking, before K1): ' + displayFor(a).row2);
            a.checkSaid = 1;
            if (/king is in check/.test(hintText(a).row2)) out.push(at + ' (checking, after K1): ' + hintText(a).row2);
            a.phase = 'guess'; a.checkSaid = 0;
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.mine >= 8 && r.n.free >= 20 && r.n.theirs >= 7, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('S1 to S8, S10, S11 and the answered frame fit 26 / 40 / 60 characters and 15 words at every tier, in plain words', () => {
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
    /* M3 (c): when what changed hands is three kinds of piece, captureWord
       says "material", which names nothing: a net word ("the queen") would
       claim one piece, so the row says "a lot of material" (worth 6 or more),
       and "material" below that */
    eq(A.ev(`(function () { ${OPEN} var it = allMistakes().filter(trainable)[0], a = openCard(it), cw = captureWord;
      captureWord = function () { return 'material'; };
      try { return plainCapture({ nodes: [] }, 1, 0) + ' / ' + missWhy(a, { lossG: 9, lossAt: 1, gameLine: { nodes: [] } }, 30, null, false).cands[0]; } finally { captureWord = cw; } })()`),
    "null / You'd lose a lot of material.", 'three kinds of piece: the material word');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      /* the band's caps (FINAL-SPEC 3): row 1 26 characters, row 2 40 and 7
         words, a caption 60 and 8; the chip one short label */
      var out = [], frames = 0, seen = {}, plainSeen = 0;
      ${PLAIN}
      var cap = function (what, s, ch, words) {
        s = String(s || '');
        if (s.length > ch || (s && s.split(/\\s+/).length > words) || /\u2014/.test(s)) out.push(what + ' (' + s.length + '): ' + s);
      };
      /* principle 5: 15 words before the next tap, the band and the bar
         together (glyphs such as the arrows are not words) */
      var words = function (s) { return String(s || '').split(/\\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length; };
      var band = function (what, a) {
        var d = displayFor(a);
        frames++;
        seen[what] = (seen[what] || 0) + 1;
        cap(what + ', row 1', d.row1, 26, 99); cap(what + ', row 2', d.row2, 40, 7); cap(what + ', caption', d.cap, 60, 8); cap(what + ', chip', d.chip, 14, 3);
        /* and in plain words, the explore panel aside (S14) */
        if (!a.explore) [d.row1, d.row2, d.cap, d.chip, d.strip].concat(d.buttons.map(function (b) { return b.label; })).forEach(function (x) {
          var bad = unplain(String(x || '').replace(/<[^>]*>/g, ' '), a.tier);
          if (bad) out.push(what + ': "' + bad + '" on the card face at tier ' + a.tier + ': ' + x);
          plainSeen++;
        });
        if (!d.cap && !d.row1) out.push(what + ': no row 1');
        /* the strip counts too (its typed-move field is off screen until it
           has the keyboard): empty before an answer, Details once settled */
        var strip = String(d.strip || '').replace(/<label class="kb-move">[\\s\\S]*?<\\/label>/g, '').replace(/<[^>]*>/g, ' ');
        var n = [d.row1, d.row2, d.chip, d.cap, strip].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (x, y) { return x + words(y); }, 0);
        if (n > 15) out.push(what + ': ' + n + ' words, ' + [d.row1, d.row2, d.chip, strip.trim()].join(' / ') + ' | ' + d.buttons.map(function (b) { return b.label; }).join(' | '));
        return d;
      };
      /* the rest of a line shown (S7), their replies played at once, to the
         settled frame */
      var playLine = function (a) {
        for (var g = 0; g < 20 && showDue(a); g++) {
          playIt(false);
          if (!a.showWait) continue;
          var rp = uciToMove(a.st, a.sol[a.solIdx]);
          a.showWait = false; applyMove(a.st, rp); a.lastMove = [rp.from, rp.to]; a.markMove = null; a.solIdx++;
          var nx = showDue(a);
          if (nx) a.answerSan = sanOf(a.st, nx); else settleShown(a);
        }
      };
      var R4 = /^(\\S+ is guarded\\. |\\S+ wins [a-z ]+\\. )?\\S+ (lost|could lose) ((a|an|the|two|three) [a-z ]+|material)\\.$|^\\S+ (is guarded|wins [a-z ]+)\\.$|^\\S+ allowed checkmate\\.( They missed it\\.)?$|^\\S+ wins [a-z ]+\\. \\S+ missed it\\.$|^\\S+ leads to checkmate\\.$|^\\S+ allowed (a draw|endless checks)\\.$|^After \\S+, (you were still better|the game was even|(White|Black) was on top)\\.$|^\\S+ was a mistake\\.$/;
      /* a word for a tap that is not a move, shown as the page shows it */
      var note = function (a, id) { a.note = { id: id, key: cardStateKey(a), seq: 0 }; return a; };
      /* a miss's reason (M3), in one of its forms or its fallbacks, in plain
         words ("the exchange" is spelled out as the rook and what it went for) */
      var plain = function (what, s) { if (/exchange/.test(s)) out.push(what + ' says ' + s); };
      var M3 = /^(Then \\S+ is checkmate\\.|(White|Black) could checkmate you\\.|You'd lose (a|an|the|two|three) [a-z ]+\\.|You'd lose material\\.|Most of your advantage is gone\\.|After \\S+, (the game is even|(White|Black) is on top)\\.|That helps (White|Black)\\.|There's a stronger move here\\.)$/;
      /* "You'd lose material." only when no form before it fits beside row
         1 and the widest bar this miss shows: as the ladder's one word for a
         trade ("a rook for a knight" is never said as its net), or as the
         fallback */
      var lossFall = function (what, a, row2) {
        if (row2 !== 'You\\'d lose material.') return;
        var room = rowRoom(a, { row1: a.verdict.row1, chip: '' }), at = a.verdict.cands.indexOf(row2);
        var fit = a.verdict.cands.slice(0, at < 0 ? a.verdict.cands.length : at).filter(function (c) { return fitsRow(c, { ch: 40, words: room }); });
        if (fit.length) out.push(what + ' says ' + row2 + ' where ' + fit[0] + ' fits');
      };
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
              lossFall(at + ' a miss with a reply', a, d.row2);
              plain(at + ' a miss with a reply', a.verdict.cands.join(' | '));
              if (a.tried.reply) { seeIt(); if (band(at + ' a miss with a reply, seen', a).row2 !== d.row2) out.push(at + ' a miss with a reply: row 2 changed with See it'); }
              /* at miss 3 See it gives way to Show the answer, a word more:
                 the reason was fitted for that bar from the start */
              a = openCard(it); a.misses = 2;
              miss(off0, moveUci(off0), { cp: it.b.ea != null ? it.b.ea : cpFromWin(it.b.wa), mate: it.b.ma, pv: [moveUci(off0)].concat(ru0), win: it.b.wa }, false);
              a.reason = 2; d = band(at + ' miss 3 with a reply', a);
              lossFall(at + ' miss 3 with a reply', a, d.row2);
              if (a.tried.reply) { seeIt(); var d3 = band(at + ' miss 3 with a reply, seen', a); if (d3.row2 !== d.row2) out.push(at + ' miss 3: row 2 rewrote itself with See it, ' + d.row2 + ' -> ' + d3.row2); }
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
          /* the hints (S8): hint 1 and hint 2 on the card, the automatic one
             after Try again, one pressed over the try, and at each later
             move of a forcing line; T4 beside each */
          var hintBand = function (what, a) {
            d = band(what, a);
            if (d.kind !== 'hint' || !/^Hint [12] of 2$/.test(d.row1) || !d.row2) out.push(what + ' reads ' + d.kind + ': ' + d.row1 + ' / ' + d.row2);
            band(what + ', T4', note(a, 'T4')); a.note = null;
          };
          a.hints = 1; hintBand(at + ' hint 1', a); a.hints = 2; hintBand(at + ' hint 2', a);
          a = openCard(it); a.misses = 1; gradeMove(uciToMove(a.st, a.playedUci));
          if (a.phase === 'tried') { tryAgain(); if (a.hints) hintBand(at + ' the automatic hint after Try again', a); }
          a = openCard(it); gradeMove(uciToMove(a.st, a.playedUci));
          if (a.phase === 'tried') { giveHint(); hintBand(at + ' Hint pressed over a try', a); }
          for (var hi = 2; a.sol && hi < a.sol.length; hi += 2) {
            a = openCard(it);
            for (var hj = 0; hj < hi; hj++) { var hm = uciToMove(a.st, a.sol[hj]); applyMove(a.st, hm); a.lastMove = [hm.from, hm.to]; }
            a.solIdx = hi; a.hintAfter = true;
            a.hints = 1; hintBand(at + ' move ' + (hi / 2 + 1) + ', hint 1', a); a.hints = 2; hintBand(at + ' move ' + (hi / 2 + 1) + ', hint 2', a);
          }
          /* the forcing line (S10), at each move of yours found: "Right" and
             "{Opp} replies next." beside the bar switched off (under reduced
             motion "Their reply ›" alone on the right), the telegraph, their
             reply landed, then "Your move" with F4; at most 13 words */
          if (a.sol) {
            a = openCard(it);
            var F4 = /^(White|Black) (took your (pawn|knight|bishop|rook|queen)|gives check|played [^ ,]+), as expected\.$/;
            var w13 = function (what, d) { var n = wordsIn(d.row1) + wordsIn(d.row2) + barWords(d.buttons); if (n > 13) out.push(what + ': ' + n + ' words'); };
            for (var fk = 0; fk < a.sol.length - 1; fk += 2) {
              var fat = at + ' forcing move ' + (fk / 2 + 1), frp;
              gradeMove(uciToMove(a.st, a.sol[fk]));
              if (!(frp = a.reply)) { out.push(fat + ': no reply, ' + a.phase); break; }
              d = band(fat + ', right', a); w13(fat + ', right', d);
              if (d.row1 !== 'Right' || d.row2 !== sidesOf(a).opp + ' replies next.' || d.buttons.map(function (x) { return x.label + (x.off ? ' (off)' : ''); }).join(' | ') !== (a.hints ? 'Hint 2' : 'Hint') + ' (off) | Show the answer (off)')
                out.push(fat + ' reads ' + d.row1 + ' / ' + d.row2 + ' | ' + JSON.stringify(d.buttons));
              ui.reducedTest = true; d = band(fat + ', right, reduced motion', a); ui.reducedTest = false;
              if (d.buttons.map(function (x) { return x.label + (x.off ? ' (off)' : ''); }).join(' | ') !== ' (off) | Their reply ›') out.push(fat + ' under reduced motion offers ' + JSON.stringify(d.buttons));
              frp.tele = true; band(fat + ', the telegraph', a);
              theirReply(a, false); d = band(fat + ', landed', a);
              if (d.row1 !== 'Right') out.push(fat + ': the words changed as their reply landed: ' + d.row1);
              replyDone(a, frp); d = band(fat + ', your move', a); w13(fat + ', your move', d);
              if (d.row1 !== 'Your move' || !F4.test(d.row2)) out.push(fat + ' then reads ' + d.row1 + ' / ' + d.row2);
            }
          }
          a = openCard(it);
          /* the game move again: M2, then its reason (M3 from the card's own
             refutation, or on a missed-chance card that there is more) */
          gradeMove(uciToMove(a.st, a.playedUci)); d = band(at + ' game move again', a);
          if (d.row1 !== 'Your game move again' || d.row2) out.push(at + ' game move again reads ' + d.row1 + ' / ' + d.row2);
          a.reason = 2; d = band(at + ' game move again, its reason', a);
          plain(at + ' game move again', a.verdict.cands.join(' | '));
          if (!M3.test(d.row2) && !(d.row2 === '' && !M3.test(a.verdict.row2))) out.push(at + ' game move again, its reason reads ' + d.row2 + ' (' + a.verdict.row2 + ')');
          lossFall(at + ' game move again', a, d.row2);
          if (familyOf(patternOf(it.b)).key === 'chances' && a.verdict.row2 !== 'There\\'s a stronger move here.') out.push(at + ' a missed chance\\'s game move reads ' + a.verdict.row2);
          if (a.tried && a.tried.reply) { seeIt(); if (band(at + ' game move again, seen', a).row2 !== d.row2) out.push(at + ' game move again: row 2 changed with See it'); }
          /* the game move again at miss 3: its reason stays as See it goes */
          a = openCard(it); a.misses = 2; gradeMove(uciToMove(a.st, a.playedUci)); a.reason = 2; d = band(at + ' game move again, miss 3', a);
          lossFall(at + ' game move again, miss 3', a, d.row2);
          if (a.tried && a.tried.reply) { seeIt(); var g3 = band(at + ' game move again, miss 3, seen', a); if (g3.row2 !== d.row2) out.push(at + ' game move again at miss 3: row 2 rewrote itself with See it, ' + d.row2 + ' -> ' + g3.row2); }
          a = openCard(it);
          var off = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
          if (off) { gradeMove(off); band(at + ' a try ' + a.phase, a); }
          /* the answered frames. Shown (S7): V1 / V2 exactly, the band kept
             once played, then V1 over R4 when settled; found (S6): R1 alone,
             then R1 over R4; found after a miss (R2), works too (R3); a
             mid-line reveal names the move due now; See why keeps R4 */
          var settled = function (what, a, r1, r1early) {
            a.settle = 1; d = band(what + ', S0 marks', a);
            if (d.row1 !== (r1early || r1) || (d.row2 && !a.revealed)) out.push(what + ' at V+700 reads ' + d.row1 + ' / ' + d.row2);
            a.settle = 2; d = band(what + ', settled', a);
            if (d.row1 !== r1 || !R4.test(d.row2)) out.push(what + ' settled reads ' + d.row1 + ' / ' + d.row2);
            plain(what + ', R4', r4Of(a).cands.join(' | '));
            if (!/data-act="details"/.test(d.strip)) out.push(what + ': no Details once settled');
            /* the strip's Details is a word of the budget: row 2 has that much less room */
            var room = 15 - words(d.row1) - d.buttons.reduce(function (x, b) { return x + words(b.label); }, 0) - 1;
            if (rowRoom(a, { row1: d.row1, chip: '' }) !== room) out.push(what + ': row 2 has ' + rowRoom(a, { row1: d.row1, chip: '' }) + ' words of room, not ' + room);
            if (!/^See why › \| (Continue|Finish)$/.test(d.buttons.map(function (b) { return b.label; }).join(' | '))) out.push(what + ' settled bar ' + d.buttons.map(function (b) { return b.label; }).join(' | '));
            d = band(what + ', settled, N1', note(a, 'N1'));
            if (d.row2 !== 'To try moves, open Details.') out.push(what + ' N1 reads ' + d.row2);
            /* the story (S12): every step one caption beside the verdict's
               disc, the strip's two names (a count past 9 steps), the bar
               [‹] [Next move ›] [Continue], Next move off at the last step;
               N1 in the strip, beside the caption, only within the budget */
            a.note = null; seeWhy();
            var S = buildStory(a);
            if (a.view.mode !== 'story' || a.view.i !== 0) out.push(what + ': See why did not open the story at G1');
            for (var si = 0; si < S.steps.length; si++) {
              a.view = { mode: 'story', i: si }; a.note = null;
              d = band(what + ', story step', a);
              var last = si === S.steps.length - 1, bl = d.buttons.map(function (b) { return b.label + (b.off ? ' (off)' : ''); }).join(' | ');
              if (!d.cap || d.row1 || d.row2 || d.disc !== (a.revealed ? 'info' : 'good') || d.kind !== (si < S.g ? 'sgame' : 'sbetter')) out.push(what + ', story step ' + si + ': ' + JSON.stringify([d.cap, d.row1, d.disc, d.kind]));
              var want = '‹ | Next move ›' + (last ? ' (off)' : '') + ' | ';
              if (bl.indexOf(want) !== 0 || !/^(Continue|Finish)$/.test(bl.slice(want.length))) out.push(what + ', story step ' + si + ' bar ' + bl);
              var sw = words(String(d.strip).replace(/<[^>]*>/g, ' '));
              if (sw !== (S.steps.length > 9 ? 3 : 2)) out.push(what + ', story step ' + si + ' strip ' + d.strip);
              if (!/^Step \\d+ of \\d+, (your game|the better move|your move)\\. /.test(d.live) || d.live.indexOf(d.cap) < 0) out.push(what + ', story step ' + si + ' live ' + d.live);
              tapNote(a, 'N1', 2500, null); d = band(what + ', story step, N1', a);
              var withN1 = /To try moves, open Details\\./.test(d.strip);
              if (withN1 !== (words(d.cap) + 5 + 3 <= 15)) out.push(what + ', story step ' + si + ': N1 ' + (withN1 ? 'over the budget' : 'missing') + ', ' + d.cap);
            }
            a.note = null;
          };
          a = openCard(it); reveal(); d = band(at + ' shown', a);
          var v1 = 'The answer: ' + a.lines.best.san[0];
          if (d.row1 !== v1 || d.row2 !== 'Play the green arrow.' || d.disc !== 'info') out.push(at + ' shown reads ' + d.row1 + ' / ' + d.row2);
          d = band(at + ' shown, N1', note(a, 'N1'));
          if (d.row2 !== 'To try moves, open Details.') out.push(at + ' N1 reads ' + d.row2);
          a.note = null;
          if (!a.sol) { playIt(false); d = band(at + ' shown, played', a); if (d.row1 + ' / ' + d.row2 !== v1 + ' / Play the green arrow.') out.push(at + ' played reads ' + d.row1 + ' / ' + d.row2); }
          else playLine(a);
          /* settled, a reveal names the card's own answer (R4's), also after
             a line whose band named each move as it came */
          settled(at + ' shown', a, v1, displayFor(a).row1);
          a = openCard(it); a.foundGood = { san: sanOf(a.st, mine), win: 60 }; reveal(); band(at + ' shown after a close move', a);
          playLine(a); settled(at + ' shown after a close move', a, v1, displayFor(a).row1);
          if (a.sol && a.sol.length >= 3) {
            a = openCard(it);
            applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2;
            reveal(); d = band(at + ' mid-line shown', a);
            if (d.row1 !== 'The answer: ' + sanOf(a.st, uciToMove(a.st, a.sol[2])) || d.row2 !== 'Play the green arrow.') out.push(at + ' mid-line shown reads ' + d.row1 + ' / ' + d.row2);
            playLine(a); settled(at + ' mid-line shown', a, v1, displayFor(a).row1);
          }
          if (!a.sol) {
            a = openCard(it); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); d = band(at + ' found', a);
            if (d.row1 !== 'Found it' || d.row2 || d.strip) out.push(at + ' found reads ' + d.row1 + ' / ' + d.row2 + ' / ' + d.strip);
            settled(at + ' found', a, 'Found it');
            a = openCard(it); a.misses = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); d = band(at + ' found after a miss', a);
            if (d.row1 !== 'You got there') out.push(at + ' found after a miss reads ' + d.row1);
            settled(at + ' found after a miss', a, 'You got there');
            a = openCard(it); var alt = off || mine;
            if (moveUci(alt) !== a.bestUci) {
              a.yours = { uci: [moveUci(alt)], cp: 0, at: 0 };
              solved(alt, moveUci(alt), { win: 50, best: 52, mate: null }); band(at + ' works too', a);
              settled(at + ' works too', a, 'That works too');
            }
          } else {
            /* the whole line found */
            a = openCard(it);
            while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; }
            finishCard('first'); settled(at + ' line found', a, 'Found it');
          }
        });
      });
      return JSON.stringify({ out: out, frames: frames, seen: seen, plain: plainSeen }); })()`));
    ok(r.frames > 6000 && r.plain > 6 * r.frames, 'frames ' + r.frames + ', strings read for plain words ' + r.plain);
    eq(r.out.length, 0, r.out.length + ' too long or not plain, first: ' + r.out.slice(0, 3).join(' | '));
    ['K1', 'checking, 3 s', 'close again', 'not checked, T4', 'a miss outside a line', 'a miss with a reply', 'game move again, its reason', 'a miss that loses nothing, in a line', 'shown, N1',
     'shown, played', 'mid-line shown, settled', 'found, settled', 'works too, settled', 'line found, settled', 'story step', 'story step, N1',
     'the automatic hint after Try again', 'Hint pressed over a try', 'Hint pressed over a try, T4', ', hint 2, T4', 'move 2, hint 1',
     'forcing move 1, right', 'forcing move 2, right, reduced motion', 'forcing move 1, the telegraph', 'forcing move 2, your move'].forEach((k) => ok(Object.keys(r.seen).some((w) => w.indexOf(k.replace('K1', 'checking, 300 ms')) >= 0), 'no ' + k + ' frame'));
  });

  await test('R4 never uses the found form when lines.game.uci[1] !== ru[0]', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { found: 0, missed: 0, doctored: 0, long: 0 };
      /* the found form: the game move "lost" something, or "allowed
         checkmate" with nothing after it (said only when the opponent played
         the refutation's first move in the game) */
      var foundForm = function (a, row2) { var g = buildCompare(a).gameSan; return row2.indexOf(g + ' lost ') >= 0 || row2 === g + ' allowed checkmate.'; };
      var look = function (a, what, doctor) {
        var ru = unpackUci(a.it.b.ru), gm = a.lines.game.uci;
        if (doctor) { gm = a.lines.game.uci = gm.slice(); gm[1] = ru[0] === 'a1a2' ? 'a1a3' : 'a1a2'; a.compare = null; n.doctored++; }
        /* a longer move name, so the not-found mate form no longer fits and
           the ladder would cut it to its first sentence */
        if (doctor === 'long') { buildCompare(a).gameSan = 'Qxe8+R'; n.long++; }
        a.settle = 2;
        var row2 = displayFor(a).row2, found = gm[1] === ru[0];
        if (found) n.found++; else n.missed++;
        if (!found && foundForm(a, row2)) out.push(what + (doctor ? ' (doctored)' : '') + ': ' + row2);
        if (!found && r4Of(a).cands.some(function (c) { return foundForm(a, c); })) out.push(what + ': a found form among ' + r4Of(a).cands.join(' | '));
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key, a = openCard(it);
          if (!a) return;
          var settle = function () {
            if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
            else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
          };
          settle(); look(a, at + ' solved', false);
          a = openCard(it); settle(); look(a, at + ' solved', true);
          a = openCard(it); reveal(); a.view = { mode: 's0' }; look(a, at + ' shown', false);
          a = openCard(it); reveal(); a.view = { mode: 's0' }; look(a, at + ' shown', true);
          if (a.cls.mateAgainst) { a = openCard(it); settle(); look(a, at + ' solved, a long name', 'long'); }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.found > 50 && r.n.missed > 100 && r.n.doctored > 500 && r.n.long >= 6, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' found forms, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('R4 and M3 name only what changed hands: a material word is the line\'s own captures, "material", or "a lot of material" worth 6 or more; "is guarded" only where it means it', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { r4: 0, m3: 0, word: 0, trade: 0, guard: 0 };
      /* every material phrase a form says ("lost X", "could lose X", "wins
         X", "You'd lose X"), against what the line took: its own captures
         (plainCapture), or the two words that claim no piece */
      var phrases = function (s) { var m, re = /(?:lost|could lose|wins|You'd lose) ([a-z ]+?)\\./g, got = []; while ((m = re.exec(s))) got.push(m[1]); return got; };
      var check = function (what, cands, line, k, from, net) {
        var own = plainCapture(line, k, from);
        if (own && / for /.test(own)) n.trade++;
        cands.forEach(function (c) {
          phrases(c).forEach(function (p) {
            n.word++;
            if (p === own || p === 'material' || (p === 'a lot of material' && Math.abs(net) >= 6)) return;
            out.push(what + ': "' + c + '" where the line took ' + (own || 'no one phrase') + ' (net ' + net + ')');
          });
        });
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key;
          [false, true].forEach(function (shown) {
            var a = openCard(it);
            if (!a) return;
            if (shown) { reveal(); a.view = { mode: 's0' }; }
            else if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
            else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
            a.settle = 2;
            var c = a.cls, r4 = r4Of(a), row2 = displayFor(a).row2, cands = r4.cands.concat([row2]);
            n.r4++;
            /* the game move's words against the game line, the better move's against its own */
            var game = cands.map(function (x) { return x.split(/(?<=\\.) /).filter(function (y) { return y.indexOf(buildCompare(a).gameSan + ' ') === 0; }).join(' '); });
            var best = cands.map(function (x) { return x.split(/(?<=\\.) /).filter(function (y) { return y.indexOf(buildCompare(a).betterSan + ' wins') === 0; }).join(' '); });
            check(at + ' R4', game, c.gameLine, c.lossAt, 0, c.lossG);
            check(at + ' R4', best, c.bestLine, c.bSettle, 1, c.matBest);
            /* "is guarded" only where the guard rule holds and means it: the
               game move's own piece taken on its square, no king's move */
            if (cands.some(function (x) { return / is guarded\./.test(x); })) {
              n.guard++;
              var bn = c.bestLine.nodes[1], g0 = c.gameLine.nodes[0];
              if (isDefended(g0.after.b, a.played.to) || !isDefended(bn.after.b, bn.move.to) || pType(a.pre.b[a.played.from]) === 'K' || pType(bn.before.b[bn.move.from]) === 'K'
                || !c.gameLine.nodes.slice(1, c.lossAt + 1).some(function (x, i) { return i % 2 === 0 && x.move.to === a.played.to && x.captured && pType(x.captured) === pType(a.pre.b[a.played.from]); }))
                out.push(at + ': "is guarded" where it means nothing: ' + cands.join(' | '));
            } else if (c.lossG >= 1 && !c.mateAgainst && /safety|king/.test(familyOf(patternOf(it.b)).key) && guardRule(c.gameLine, a.played, c.bestLine.nodes[1]) && guardMeans(c, a.pre, a.played, c.bestLine.nodes[1])) out.push(at + ': the guard holds, no guard form');
          });
          /* M3: the game move again, its reason from the card's own refutation */
          var a2 = openCard(it);
          if (!a2 || familyOf(patternOf(it.b)).key === 'chances') return;
          var w = gameMoveWhy(a2);
          n.m3++;
          check(at + ' M3', w.cands.concat([w.fall]), a2.cls.gameLine, a2.cls.lossAt, 0, a2.cls.lossG);
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.r4 > 400 && r.n.m3 > 150 && r.n.word > 300 && r.n.trade > 50 && r.n.guard >= 6, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' untrue material words, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('honest captions (U2): every story caption says only what the ply shown does, true on its own board; a material word is the line\'s own captures, "material", or "a lot of material" worth 6 or more; in plain words', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      ${PLAIN}
      var out = [], n = { caps: 0, sent: 0, forms: {} };
      var PW = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
      var bare = function (s) { return s.replace(/[+#]$/, ''); };
      /* a material phrase against the line's own captures from node f to k, and its net */
      /* "material" only where the line's own phrase is none or a trade (one
         word never claims a piece, and never hides one that can be named) */
      var matOk = function (p, line, k, f, net) {
        var own = plainCapture(line, k, f);
        return net >= 1 && (p === own || (p === 'material' && (!own || / for /.test(own))) || (p === 'a lot of material' && Math.abs(net) >= 6 && (!own || / and /.test(own))));
      };
      var sides = function (w) { return w ? 'White' : 'Black'; };
      var check = function (what, a, S, i) {
        var s = S.steps[i], line = s.line, nd = line.nodes[s.k], c = a.cls, pov = myPov(a.it), cap = s.cap, cmp = buildCompare(a);
        var san = sanOf(nd.before, nd.move), b = nd.after.b, game = s.seg === 'game', firstB = !game && s.k === s.from, lastG = game && i === S.g - 1, lastB = !game && i === S.steps.length - 1;
        var n1 = game && s.k === 0 ? line.nodes[1] : null, rsan = n1 ? sanOf(n1.before, n1.move) : null, found = cmp.found;
        /* a blow they could miss: a mate or material the line wins, and a game reply that was another move */
        var blow = !found && cmp.replied && (!!c.mateAgainst || c.lossG >= 1);
        var g1 = c.gameLine.nodes[1], same = !game && !S.alt && s.k === 2 && line === c.bestLine && !!g1 && sameMove([nd.move.from, nd.move.to], [g1.move.from, g1.move.to]);
        var mine = function (sq, t) { var p = nd.after.b[sq]; return !!p && isW(p) === pov && (!t || pType(p) === t); };
        var fail = function (x) { out.push(what + ' step ' + i + ' "' + cap + '": ' + x); };
        n.caps++;
        /* in plain words at this tier */
        var unpl = unplain(cap, a.tier);
        if (unpl) fail('"' + unpl + '" on the card face');
        /* the ply it names: the game move, the better move, or this step's own */
        var sents = cap.match(/[^.]+\\./g) || [cap];
        var head = sents[0];
        /* a move is named without its check sign on every rung (the check form says it in words) */
        if (/[+#]/.test(cap)) fail('a check or mate sign');
        if (game && s.k === 0) { if (head !== bare(gameSan(a)) + '.' && cap !== bare(gameSan(a)) + ', your game move.') fail('does not start with the game move ' + gameSan(a)); }
        else if (firstB) {
          if (head !== 'Better: ' + bare(san) + '.' && cap !== 'Your ' + bare(san) + ' works too.') fail('does not name the better move ' + san);
          /* "yours" only for your own move's line, never the engine's best */
          if (/works too/.test(cap) !== !!S.alt || (S.alt && (!a.alt || line === c.bestLine || moveUci(nd.move) !== a.yours.uci[a.yours.at]))) fail('works too on a card that is ' + (a.alt ? '' : 'not ') + 'an alternative');
        }
        else if (cap.indexOf(bare(san)) !== 0) fail('does not start with its ply ' + san);
        /* no other move of the line is named, except the reply G1 warns of */
        line.nodes.forEach(function (x, k) {
          if (!x.move || k === s.k) return;
          var o = bare(sanOf(x.before, x.move));
          if (o === bare(san) || (o.length < 3 && !/x/.test(o))) return;
          if (new RegExp('(^|\\\\s)' + o.replace(/[+#=]/g, '\\\\$&') + '([\\\\s.,]|$)').test(cap) && !(n1 && k === 1)) fail('names another ply, ' + o);
        });
        /* each sentence: a known form, true here */
        sents.slice(firstB || (game && s.k === 0) ? 1 : 0).forEach(function (x, j) {
          x = x.trim(); n.sent++;
          var m, form = null, ok = true;
          if (j === 0 && !firstB && !(game && s.k === 0) && (m = /^(\\S+) takes (your|their) (\\w+)(, as in your game)?\\.$/.exec(x))) {
            form = 'takes'; var cp = nd.captured;
            ok = !!cp && pType(cp) === PW[m[3]] && (isW(cp) === pov) === (m[2] === 'your') && (!m[4] || (game && s.k === 1 && found));
          } else if (j === 0 && (m = /^(\\S+) could take your (\\w+)\\.$/.exec(x))) { form = 'could take'; ok = game && s.k === 1 && blow && !!nd.captured && isW(nd.captured) === pov && pType(nd.captured) === PW[m[2]]; }
          else if (j === 0 && /^\\S+, check\\.$/.test(x)) { form = 'check'; ok = checkersOf(nd.after).length > 0 && !isMate(nd.after); }
          else if (j === 0 && /^\\S+$/.test(x.replace(/\\.$/, '')) && sents.length > 1 && /^Checkmate\\.$/.test(sents[1].trim())) { form = 'mate'; ok = isMate(nd.after); }
          else if (/^Checkmate\\.$/.test(x)) { form = 'mate'; ok = isMate(nd.after); }
          else if (j === 0 && x === bare(san) + '.') { form = 'quiet'; }
          else if (/^As in your game\\.$/.test(x)) { form = 'found'; ok = game && s.k === 1 && found; }
          else if (/^They missed it\\.$/.test(x)) { form = 'missed'; ok = game && s.k === 1 && blow; if (!nd.captured && !checkersOf(nd.after).length) n.quietMissed = (n.quietMissed || 0) + 1; }
          else if ((m = /^Nothing guards the (\\w+) on ([a-h][1-8])\\.$/.exec(x))) { form = 'unguarded'; var q = sqNum(m[2]); ok = !!n1 && mine(q, PW[m[1]]) && !isDefended(b, q) && n1.move.to === q && !!n1.captured; }
          else if ((m = /^Their (\\w+) can take your (\\w+)\\.$/.exec(x))) { form = 'can take'; ok = !!n1 && pType(n1.before.b[n1.move.from]) === PW[m[1]] && !!n1.captured && pType(n1.captured) === PW[m[2]] && isW(n1.captured) === pov
            && MOTIF_VAL[PW[m[1]]] < MOTIF_VAL[PW[m[2]]] && isDefended(b, n1.move.to); }
          else if ((m = /^Now (\\S+) hits two pieces\\.$/.exec(x))) { form = 'fork'; ok = !!n1 && bare(rsan) === m[1] && attacksFrom(n1.after.b, n1.move.to).filter(function (q) { var p = n1.after.b[q]; return p && isW(p) === pov; }).length >= 2; }
          else if ((m = /^Now (\\S+) is check\\.$/.exec(x))) { form = 'gives check'; ok = !!n1 && bare(rsan) === m[1] && checkersOf(n1.after).length > 0; }
          else if ((m = /^Now (White|Black) can checkmate\\.$/.exec(x))) { form = 'mate against'; ok = !!c.mateAgainst && !!S.mateG && m[1] === sides(!pov) && isMate(S.steps[S.g - 1].line.nodes[S.steps[S.g - 1].k].after); }
          else if ((m = /^Your (\\w+) can't move safely\\.$/.exec(x))) { form = 'pin'; ok = game && s.k === 0 && b.some(function (p, q) { return p && isW(p) === pov && pType(p) === PW[m[1]] && !!pinRay(b, q); }); }
          else if (/^Moving one piece opens a line\\.$/.test(x)) { form = 'discovered'; ok = game && s.k === 0 && !!c.allowed.discoveredAttack && c.allowed.discoveredAttack.ply === 1; }
          else if ((m = /^(White|Black) has no move: a draw\\.$/.exec(x))) { form = 'stalemate'; ok = !legalMoves(nd.after).length && !checkersOf(nd.after).length; }
          else if ((m = /^The (\\w+) on ([a-h][1-8]) guards it\\.$/.exec(x))) { form = 'guard'; var d = sqNum(m[2]); ok = firstB && mine(d, PW[m[1]]) && attackersOf(b, nd.move.to, pov).indexOf(d) >= 0 && !isDefended(c.gameLine.nodes[0].after.b, a.played.to); }
          else if ((m = /^It wins ([a-z ]+)\\.$/.exec(x))) { form = 'it wins'; ok = firstB && !a.alt && matOk(m[1], c.bestLine, c.bSettle, 1, c.matBest); }
          else if (/^It leads to checkmate\\.$/.test(x)) { form = 'leads to mate'; ok = firstB && !!c.mateFor && !!S.mateB && isMate(line.nodes[S.steps[S.steps.length - 1].k].after); }
          else if ((m = /^(\\S+) still (comes|takes your (\\w+))(, but you (win ([a-z ]+)|lose nothing))?\\.$/.exec(x)) || (same && /^You lose less\\.$/.test(x))) {
            /* S-same: the copy row's forms, each true of the line where it
               settles against the game's loss; a line that loses as much
               names the capture again */
            form = 'still comes';
            ok = same && (!m || !m[4] || (m[6] ? matOk(m[6], c.bestLine, c.bSettle, 1, c.matBest) : c.matBest === 0 && c.lossG >= 1))
              && (!m || !m[3] || (!!nd.captured && isW(nd.captured) === pov && pType(nd.captured) === PW[m[3]] && !(c.matBest >= 0 && c.lossG >= 1) && !(c.matBest < 0 && -c.matBest < c.lossG)))
              && (!/less/.test(x) || (c.matBest < 0 && -c.matBest < c.lossG));
            if (m && !m[4] && !m[3] && nd.captured) n.sameBare = (n.sameBare || 0) + 1;
          }
          else if (/^You lose less\\.$/.test(x)) { form = 'lose less'; var net = matDiff(b, pov) - matDiff(line.nodes[s.from].before.b, pov); ok = lastB && net < 0 && -net < c.lossG; }
          else if ((m = /^You lose ([a-z ]+)\\.$/.exec(x))) { form = 'you lose'; ok = lastG && matOk(m[1], line, s.k, 0, c.lossG); }
          else if ((m = /^You win ([a-z ]+)\\.$/.exec(x))) { form = 'you win'; ok = lastB && matOk(m[1], line, s.k, s.from, matDiff(b, pov) - matDiff(line.nodes[s.from].before.b, pov)); }
          if (!form) return fail('an unknown sentence: ' + x);
          if (form === 'you win' && s.from > 1) n.lineWins = (n.lineWins || 0) + 1;
          n.forms[form] = (n.forms[form] || 0) + 1;
          if (!ok) fail(form + ' is not true here');
        });
      };
      var sqNum = function (s) { return (s.charCodeAt(0) - 97) + 8 * (+s[1] - 1); };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          ['solved', 'shown', 'works too', 'works too in a line', 'the line from its third move'].forEach(function (how) {
            var a = openCard(it);
            if (!a) return;
            if (how === 'shown') { reveal(); a.view = { mode: 's0' }; }
            else if (/in a line|third move/.test(how)) {
              /* inside a forcing line, another move at the third: its own line from there, the best line after it */
              if (!a.sol || a.sol.length < 3) return;
              applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2;
              /* (or the line's own third move, credited from there: what the moves before it took is not its gain) */
              var alt2 = how === 'the line from its third move' ? uciToMove(a.st, a.sol[2]) : legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.sol[2]; })[0];
              if (!alt2) return;
              var aft = cloneState(a.st); applyMove(aft, alt2);
              a.yours = { uci: a.sol.slice(0, 2).concat([moveUci(alt2)]).concat(playUci(aft, unpackUci(it.b.lu).slice(3)).uci), cp: 0, at: 2 };
              solved(alt2, moveUci(alt2), { win: 50, best: 52, mate: null }, true);
            }
            else if (how === 'works too') {
              /* another move that holds, its own line after it (the alternative's story) */
              var alt = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci; })[0];
              if (!alt || a.sol) return;
              var after = cloneState(a.st); applyMove(after, alt);
              var rep = legalMoves(after)[0];
              a.yours = { uci: [moveUci(alt)].concat(rep ? [moveUci(rep)] : []), cp: 0, at: 0 };
              solved(alt, moveUci(alt), { win: 50, best: 52, mate: null });
            }
            else if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
            else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
            var S = buildStory(a);
            for (var i = 0; i < S.steps.length; i++) check('tier ' + tier + ' ' + it.key + ' ' + how, a, S, i);
          });
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    const f = r.n.forms;
    ok(r.n.caps > 3000 && f.takes > 500 && f['you lose'] > 50 && f.unguarded > 20 && f['can take'] > 10 && f.fork > 5 && f['gives check'] > 20 && f['mate against'] > 5 && f.guard >= 6
      && f['it wins'] > 20 && f['you win'] > 10 && r.n.lineWins > 5 && f['still comes'] >= 4 && f.found > 50 && f.missed > 50 && f['could take'] > 10 && f.mate > 5, JSON.stringify(r.n));
    /* S-same on a capture never falls back to the bare "still comes" (184216981622:46's better line loses the same knight: it names it) */
    ok(!r.n.sameBare, 'S-same fallback used ' + r.n.sameBare);
    eq(r.out.length, 0, r.out.length + ' untrue captions, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('story captions the review read: a quiet reply misses nothing, S-same names the knight lost again, one check rule on every rung', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      var caps = function (key) {
        var a = openCard(model().byKey[key]);
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        return buildStory(a).steps.map(function (s) { return s.cap; });
      };
      /* every card: "They missed it." only after a blow they could miss */
      var quiet = [];
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a || a.sol) return;
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        var S = buildStory(a), c = a.cls;
        if (S.g > 1 && / They missed it\\.$/.test(S.steps[1].cap) && !c.mateAgainst && c.lossG < 1) quiet.push(it.key + ' ' + S.steps[1].cap);
      });
      return JSON.stringify({ q48: caps('184455333378:48'), s46: caps('184216981622:46'), c64: caps('184455333378:64'), c68: caps('184455333378:68'), quiet: quiet }); })()`));
    eq(r.q48[1], 'Rfd8.', 'a quiet first reply after a move that lost nothing');
    eq(r.s46[r.s46.length - 1], 'Rxh2 still takes your knight.', 'S-same where the better line loses the same knight');
    eq(r.c64[8], 'Rd7. You lose a bishop for a pawn.', 'a checking move on the loss rung, without its sign');
    eq(r.c68[3], 'Qd2, check.', 'the check form');
    eq(r.c68[1], 'cxd3 takes your bishop, as in your game.', 'a capture that checks, without its sign');
    eq(r.quiet.length, 0, 'They missed it with nothing to miss: ' + r.quiet.slice(0, 3).join(' | '));
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
