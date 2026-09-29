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
      var it = allMistakes().filter(trainable)[3]; openCard(it, true);
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

  await test('the blunder check is one question, graded with no engine: found is a first try, missed a fail', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var elig = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && a.check1; });
      var a = openCard(elig[0], false), q0 = SF.queue.length;
      gradeMove(uciToMove(a.st, a.check1.uci));
      var found = { result: a.result, phase: a.phase, q: SF.queue.length - q0 };
      var b = openCard(elig[1], false);
      var own = b.st.b.map(function (p, i) { return p && isW(p) !== b.st.w ? i : -1; }).filter(function (i) { return i >= 0; })[0];
      sessionClick(own);
      var afterOwnTap = b.phase;
      var wrong = legalMoves(b.st).filter(function (x) { return moveUci(x) !== b.check1.uci && x.to !== b.check1.reply.to; })[0];
      gradeMove(wrong);
      var missed = { result: b.result, phase: b.phase, q: SF.queue.length - q0 };
      srsRecord(elig[1], 'fail', {});
      var review = cardFor(elig[1]);
      return JSON.stringify({ found: found, missed: missed, own: afterOwnTap, reviewCheck: !!(review && review.check1),
        recap: [ui.session.checks, ui.session.checksFound] }); })()`));
    eq(r.found.result, 'first', 'found result'); eq(r.found.phase, 'done', 'found answered'); eq(r.found.q, 0, 'engine');
    eq(r.own, 'check', 'own-piece tap spends nothing');
    eq(r.missed.result, 'fail', 'missed result'); eq(r.missed.phase, 'done', 'missed answered'); eq(r.missed.q, 0, 'engine');
    eq(r.reviewCheck, false, 'reviews have no check step');
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

  await test('every message on the phone line is 80 characters or fewer, at every level', () => {
    const A = boot();
    const bad = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], strip = function (h) { return String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); };
      var line = function (a) { var m = /<div class="card-task[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/.exec(cardTaskHtml(a)); return strip(m ? m[1] : ''); };
      var keep = function (what, t) { if (t.length > 80 || /\u2014/.test(t)) out.push(what + ' (' + t.length + '): ' + t); };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it, false);
          if (!a) return;
          a.tier = tier;
          if (a.check1) keep('check prompt', line(a));
          a = openCard(it, true); a.tier = tier;
          keep('prompt', line(a));
          a.hints = 1; keep('hint 1', strip(hintText(a))); a.hints = 2; keep('hint 2', strip(hintText(a))); a.hints = 0;
          gradeMove(uciToMove(a.st, a.playedUci)); keep('game move again', strip(a.verdict && a.verdict.html));
          a = openCard(it, true); a.tier = tier; reveal(); keep('answered, shown', line(a));
          a = openCard(it, true); a.tier = tier;
          if (!a.sol) { solved(uciToMove(a.st, a.bestUci), a.bestUci, null); keep('answered, found', line(a)); }
        });
      });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, bad.length + ' too long, first: ' + bad.slice(0, 3).join(' | '));
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

  await test('the coarse events carry no names or ratings', () => {
    const calls = [];
    const A = boot();
    A.ev(`(function () { window.clarity = function () { window.__calls = (window.__calls || []).concat([Array.prototype.slice.call(arguments)]); }; return 1; })()`);
    A.ev(`(function () { store.set('nl:firstSeen:' + playerId(), Date.now() - 3 * 864e5); returnEvents(); track('check_first_t2'); track('close_shown'); return 1; })()`);
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
