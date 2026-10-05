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

  await test('replaying the game move never names the answer', () => {
    const A = boot();
    const bad = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [];
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
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
        var a = openCard(it);
        if (!a) return;
        var best = sanOf(a.pre, a.best), h1 = hintText(a);
        if (h1.indexOf(best) !== -1) out.push(it.key + ': ' + h1);
      });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, 'leaks: ' + bad.slice(0, 2).join(' | '));
  });

  await test('S1, S2 and the answered frame fit 26 / 40 / 60 characters at every tier', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      /* the band's caps (FINAL-SPEC 3): row 1 26 characters, row 2 40 and 7
         words, a caption 60 and 8; the chip one short label */
      var out = [], frames = 0, seen = {};
      var cap = function (what, s, ch, words) {
        s = String(s || '');
        if (s.length > ch || (s && s.split(/\\s+/).length > words) || /\u2014/.test(s)) out.push(what + ' (' + s.length + '): ' + s);
      };
      var band = function (what, a) {
        var d = displayFor(a);
        frames++;
        seen[what] = (seen[what] || 0) + 1;
        cap(what + ', row 1', d.row1, 26, 99); cap(what + ', row 2', d.row2, 40, 7); cap(what + ', caption', d.cap, 60, 8); cap(what + ', chip', d.chip, 14, 3);
        if (!d.cap && !d.row1) out.push(what + ': no row 1');
        return d;
      };
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
          /* and, until their slices give them their own words, the hints,
             the game move again and a try being checked stay in the caps */
          a.hints = 1; band(at + ' hint 1', a); a.hints = 2; band(at + ' hint 2', a); a.hints = 0;
          gradeMove(uciToMove(a.st, a.playedUci)); band(at + ' game move again', a);
          if (a.tried && a.tried.reply) { seeIt(); band(at + ' game move again, seen', a); }
          a = openCard(it);
          var off = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
          if (off) { gradeMove(off); band(at + ' a try ' + a.phase, a); }
          /* the answered frame: shown, found, found after a miss, close then shown, works too */
          a = openCard(it); reveal(); d = band(at + ' shown', a);
          if (d.row1 !== 'The answer: ' + a.lines.best.san[0]) out.push(at + ' shown reads ' + d.row1);
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
    ok(r.frames > 3000, 'frames ' + r.frames);
    eq(r.out.length, 0, r.out.length + ' too long, first: ' + r.out.slice(0, 3).join(' | '));
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
