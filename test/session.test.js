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
/* ONLY=<words> runs the tests whose names hold them */
async function test(name, fn) {
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
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

/* plain words on the card face: no percentages, "winning
   chances", "about level", "edge", "lead", "exchange", "Stockfish" at tier
   1, and no pattern names ("pinned" and "fork" only at tier 3). unplain(s,
   tier) names the first word that breaks it, '' when none does */
const PLAIN = `function unplain(s, tier) {
  s = String(s || '');
  /* tier 3's settled line has figures (F1.4): the only-move line, or both moves' winning chances */
  if (tier === 3 && /^(Only move: \\S+ \\d+%\\. Next best \\d+%\\.|\\S+ \\d+%\\. Your \\S+ \\d+%\\.)$/.test(s)) s = s.replace(/\\d+%/g, 'N');
  var m = /\\d+ ?%|winning chances|about level|\\bedge\\b|\\blead\\b|\\bexchange\\b/i.exec(s);
  if (m) return m[0];
  if (tier === 1 && /stockfish/i.test(s)) return 'Stockfish';
  var re = /\\b(forks?|forked|forking|pins?|pinned|pinning|skewers?|skewered|discovered|hanging|hidden attack|tactics?|tactical|overload(ed|ing)?|deflection|decoy|zwischenzug|desperado|x-ray|back rank)\\b/gi, w;
  /* V2.2 names a fork at every tier, as its event and See why's step ("Then their queen forks king
     and rook.", "Qxc3+ forks your king and rook.") */
  while ((w = re.exec(s))) if (!(tier === 3 && /^(fork|pinned)$/i.test(w[1])) && !/^forks?$/i.test(w[1])) return w[1];
  return '';
}`;
/* tier 1 says moves in words: "rook to g1", "rook from a8 to
   d8" where two can go there, "pawn takes on d3", "castling", "pawn to a8 to
   make a queen". wordsOf(st, m): the test's own reading of a move in words;
   unit(s): s with each move in words as one word, as a SAN counts; named(a,
   f, cap, t1fall): what a row with one move says, f(the move's name), in
   words at tier 1 where that fits the row's cap (40 characters and 7
   words), else at tier 1 the row's own form with no move (t1fall: tier 1
   says no move in SAN, F1.6), else in SAN */
const WORDS = `function wordsOf(st, m) {
  var P = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }, p = st.b[m.from], t = pType(p);
  /* V2.1: "castling" where only one castling is legal, else its side */
  if (t === 'K' && Math.abs(m.to - m.from) === 2) return legalMoves(st).filter(function (x) { return x.from === m.from && Math.abs(x.to - x.from) === 2; }).length > 1 ? 'castling on the ' + (m.to > m.from ? 'king' : 'queen') + '\\'s side' : 'castling';
  var from = {};
  legalMoves(st).forEach(function (x) { if (x.to === m.to && st.b[x.from] === p) from[x.from] = 1; });
  return P[t] + (Object.keys(from).length > 1 ? ' from ' + sqName(m.from) : '') + (st.b[m.to] || m.ep >= 0 ? ' takes on ' : ' to ') + sqName(m.to) + (m.promo ? ' to make a ' + P[pType(m.promo)] : '');
}
function unit(s) { return String(s || '').replace(/\\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\\bcastling(?: on the (?:king|queen)'s side)?/gi, 'Mv'); }
function named(a, st, m, f, ch, t1fall) {
  var w = f(wordsOf(st, m));
  if (a.tier !== 1) return f(sanOf(st, m));
  return w.length <= (ch || 40) && unit(w).split(/\\s+/).length <= 7 ? w : t1fall;
}`;
/* the extra-set rule (F7.1): growPool(n) adds n trainable positions as
   clones of the fixture's games with their cards (a player who keeps
   playing); heroWords() reads Today's title and its line 2 */
const POOL = `function growPool(n) {
  var proto = data.games.filter(function (g) { return g.mv && !/^sim/.test(g.id) && (g.bl || []).some(function (b) { return !b.x && b.bu; }); })
    .sort(function (x, y) { return x.ts - y.ts || (x.id < y.id ? -1 : 1); });
  var want = allMistakes().filter(trainable).length + n;
  while (allMistakes().filter(trainable).length < want) {
    var g = JSON.parse(JSON.stringify(proto[(window.__grown = (window.__grown || 0) + 1) % proto.length]));
    g.id = 'sim' + window.__grown; g.ts = Date.now() - 3600e3;
    data.games.unshift(g); modelDirty();
  }
}
function heroWords() {
  var h = heroHtml();
  return { title: (/<h2[^>]*>([^<]*)</.exec(h) || [])[1], more: (/class="why hero-more">([^<]*)</.exec(h) || [])[1] || '' };
}`;
/* Insights (F6.1 to F6.3): insAt(t) draws it at tier t into a stub box and returns its HTML; insText(h)
   its words in order; insRows(h) each skill's row (name, glyph, the focus with "Start here", plain
   line, games and positions, progress words, the bar's parts as l/c/g and their sizes, under "Also
   seen"); sinceText(h) the "since you started" card's words; clockText(h) the clock's */
/* how we count at tier 3 also says what its rows on how games are decided count (F10.3) */
const DECIDED_COUNT = ['+2 means Stockfish had you two pawns or more ahead at some point of the game, \u22122 as far behind.',
  'Players at your level: lichess games from July 2026 at the lichess rating that matches yours, measured by lichess\'s own analysis, so they are context, not a target.'];
const INS = `function insAt(tier) {
  playerTier = function () { return tier; };
  var box = { innerHTML: '' }, el0 = el;
  el = function (id) { return id === 'insightsbox' ? box : el0(id); };
  ui.view = 'insights'; renderInsights(); ui.view = 'train';
  el = el0;
  return box.innerHTML;
}
/* (the skill tiles that open Insights at More help, F9.5, are read apart: tilesOf) */
function insText(h) { return String(h).replace(/<section class="sk-tiles"[\\s\\S]*?<\\/section>/, '').replace(/<[^>]+>/g, '\\n').split('\\n').map(function (x) { return x.replace(/\\s+/g, ' ').trim(); }).filter(Boolean); }
function insRows(h) {
  var also = false;
  return String(h).split(/(?=<a class="fam-row)|(?=<h3 class="ins-h ins-also">)/).map(function (p) {
    if (/^<h3 class="ins-h ins-also">/.test(p)) { also = true; return null; }
    if (!/^<a class="fam-row/.test(p)) return null;
    var g = function (re) { var m = re.exec(p); return m ? m[1] : ''; };
    return { name: g(/class="fr-name">([^<]*)</), glyph: g(/data-icon="(\\w+)"/), focus: /^<a class="fam-row is-focus"/.test(p) && /Start here/.test(p), line: g(/class="fr-line">([^<]*)</),
      n: g(/class="fr-n">([^<]*)</), prog: g(/class="fr-prog">([^<]*)</), also: also,
      bar: (p.match(/<i class="sk-\\w" style="flex-grow:\\d+"/g) || []).map(function (x) { return /sk-(\\w)/.exec(x)[1] + /(\\d+)"$/.exec(x)[1]; }).join(' ') };
  }).filter(Boolean);
}
function sinceText(h) { var m = /<section class="since"[\\s\\S]*?<\\/section>/.exec(h); return m ? insText(m[0]) : null; }
function clockText(h) { var m = /<div class="clock-rows">[\\s\\S]*?<\\/div>/.exec(h); return m ? insText(m[0]) : null; }`;
/* learning's simulator (absorb-sim.js, absorb-r3c.js) on the real
   schedule: a day is shiftDays(1) and the pool grows by 5 positions; the
   day opens (absorbOpen), then Today and extra sets; each position
   answered by learning's learner (first sight 45% clean, 60% of them fast,
   15% hint, 25% after a miss, 15% shown; a review clean at 0.70 + 0.05 x
   rung, at most .92 (.90 learned), 2 points less a day late) */
const SIM = `function simRun(seed, days, plan, noRule) {
  SF.state = 'failed'; store.set('nl:sessionSize', 10);
  var ideal = {}, out = { days: [], late: 0, reviews: 0, starved: 0 }, pool = 91;
  var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  var answer = function (k, day) {
    var it = model().byKey[k], r = srsLoad()[k], now = Date.now(), first = !r || !!r.q, res, ms = 30000, u = rnd();
    var early = !first && !r.sp && r.due != null && r.due > now + 12 * 3600e3;
    if (first) { res = u < 0.45 ? 'first' : u < 0.60 ? 'hint' : u < 0.85 ? 'retry' : 'fail'; if (res === 'first' && rnd() < 0.6) ms = 8000; }
    else {
      var late = early || ideal[k] == null ? 0 : Math.max(0, day - ideal[k]);
      var p = r.learned ? 0.9 - 0.02 * late : Math.min(0.92, 0.70 + 0.05 * (r.box || 0)) - 0.02 * late;
      res = u < p ? 'first' : u < p + 0.08 ? 'hint' : (rnd() < 0.6 ? 'retry' : 'fail');
      if (!early) { out.late += late; out.reviews++; }
    }
    var rec = srsRecord(it, res, { ms: ms, attempted: true });
    if (rec.due != null) ideal[k] = day + daysFrom(now, rec.due);
  };
  for (var day = 0; day < days; day++) {
    if (day) { shiftDays(1); var before = allMistakes().filter(trainable).length; growPool(Math.max(0, 91 + 5 * day - before)); }
    var ab = noRule ? null : absorbOpen(), opened = dueCards().length;
    for (var s = 0; s < plan(day); s++) {
      var keys = s ? morePracticeKeys() : todayPlan().keys;
      if (!keys.length) break;
      /* practice only once no new own position is left out of the set */
      if (s && keys.some(function (k) { var r = srsLoad()[k]; return r && !r.q && !r.sp && !(r.due != null && r.due <= Date.now() + 12 * 3600e3); })
        && buildCandidates(1000, null, true).some(function (x) { return keys.indexOf(x.key) < 0; })) out.starved++;
      store.set('nl:setSize', keys.length);
      keys.forEach(function (k) { answer(k, day); });
    }
    var srs = srsLoad(), m = model(), end = dayStart(Date.now(), 1), d = { opened: opened, left: ab ? ab.left : 0, over: 0, learned: 0, queued: 0 };
    Object.keys(srs).forEach(function (k) {
      var r = srs[k], it = m.byKey[k];
      if (!it || r.hidden) return;
      if (r.q) d.queued++;
      else { if (r.learned || r.retired) d.learned++; if (r.due != null && r.due < end) d.over++; }
    });
    out.days.push(d);
  }
  out.queuedEver = logLoad().filter(function (e) { return e.e === 'o'; }).reduce(function (a, e) { return a + e.q; }, 0);
  return out;
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
      return JSON.stringify({ before: before, after: weeksAtGoal(), now: weekGoalInfo(Date.now()).goal, chosen: weekGoal() }); })()`));
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

  await test('a card that came back for one more try reads both showings ("Shown, then found"); the score counts first showings (F2.1: tier 1 in stars), and at tier 1 a find on the one more try too (C3: shown, then found, took more than one try); a first look needs no miss; a card skipped untouched gives no check line (T10, slice 14 nits, F2.3)', () => {
    const A = boot({ storage: Object.assign(base(), { 'nl:tip:game': '1' }) });
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 1; };
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && unpackUci(x.b.ru).length; });
      var we = its.filter(function (x) { var a = cardFor(x); ui.session = { keys: [x.key], idx: 0, results: {}, relearn: [], relearnOf: {} }; return workedExample(a); })[0];
      var rest = its.filter(function (x) { return x !== we; });
      var famOf = function (x) { return familyOf(patternOf(x.b)).key; };
      var pick = [rest[0], rest[1], rest[2], we];
      /* one more card, of a family none of the others has, left untouched */
      var odd = rest.filter(function (x) { return pick.every(function (y) { return famOf(y) !== famOf(x); }); })[0];
      pick.push(odd);
      ui.session = { mode: 'today', label: 't', keys: pick.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      var ss = ui.session, act = function (i, fn) { ss.idx = i; var a = cardFor(pick[i]); ss.active = a; fn(a); return a; };
      var best = function (a) { solved(uciToMove(a.st, a.bestUci), a.bestUci, null); };
      var miss = function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); };
      act(0, function (a) { reveal(); });                                     /* Shown, comes back */
      act(1, function (a) { miss(a); tryAgain(); best(a); });                 /* Found after a miss, comes back */
      act(2, function (a) { reveal(); });                                     /* Shown, comes back, skipped then */
      act(3, function (a) { workedExample(a); miss(a); tryAgain(); best(a); }); /* a worked example missed first */
      act(4, function (a) { settleLeft(a); });                                /* skipped untouched */
      queueRelearn(ss);
      var at = function (k) { return ss.keys.lastIndexOf(k); };
      ss.idx = at(pick[0].key); var r0 = cardFor(pick[0]); ss.active = r0; best(r0);           /* then found */
      ss.idx = at(pick[1].key); var r1 = cardFor(pick[1]); ss.active = r1; reveal();           /* then shown */
      ss.idx = at(pick[2].key); var r2 = cardFor(pick[2]); ss.active = r2; settleLeft(r2);     /* then left untouched */
      ss.active = null; ss.finished = true;
      var h = doneHtml(ss), words = [];
      h.replace(/class="res[^"]*">([^<]*)</g, function (m, w) { words.push(w); return m; });
      var habits = []; h.replace(/class="(?:plan )?keep-line">([^<]*)</g, function (m, t) { habits.push(t); return m; });
      var want = []; pick.slice(0, 4).forEach(function (x) { var l = esc(ss.sum[x.key].l); if (want.indexOf(l) < 0) want.push(l); });
      var oddLine = odd ? esc(lineOfStep(familyStep(famOf(odd)), 1)) : null;
      return JSON.stringify({ words: words, head: (/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], then: (/class="recap-then">([^<]*)</.exec(h) || [])[1], note3: ss.notes[pick[3].key] || null, notes: ss.notes,
        habits: habits, want: want, odd: !!odd, oddLine: oddLine && want.indexOf(oddLine) < 0 ? oddLine : null, skip: ss.sum[pick[4].key] }); })()`));
    eq(r.words.join(' | '), 'Shown, then found | After a miss, then shown again | Shown | After a miss | Skipped', 'the words: ' + JSON.stringify(r.notes));
    eq(r.note3, null, 'a worked example missed first is no first look');
    eq(r.head, 'You found 3 of 5.', 'tier 1 (V4.3): the first showings found and the one found on its one more try (C3), of the set (the skip one it did not find), never "of 15"');
    eq(r.then, '3 took more than one try, 1 was shown, 1 was skipped.', 'the others in one line, never starting "Then"; shown, then found, took more than one try');
    ok(r.odd, 'a card of another family');
    eq(JSON.stringify(r.habits), JSON.stringify(r.want), 'the check lines of the cards played only');
    ok(r.skip && r.skip.c === 'skip' && !r.skip.l, 'a card skipped untouched has no check line');
    if (r.oddLine) ok(r.habits.indexOf(r.oddLine) < 0, 'no line for the family met only on the skipped card');
  });

  await test('small words: "Next set of N" says how many it gives, "Click a game" where a mouse points, and a session over leaves nothing in the live region (C2, C9, C11)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable), res = {}, real = morePracticeKeys;
      ui.session = { mode: 'today', label: 't', keys: [its[0].key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {}, finished: true };
      morePracticeKeys = function () { return its.slice(0, 3).map(function (x) { return x.key; }); };
      res.three = (/data-act="keepGoing">([^<]*)</.exec(doneHtml(ui.session)) || [])[1];
      morePracticeKeys = function () { return its.slice(0, 8).map(function (x) { return x.key; }); };
      res.eight = (/data-act="keepGoing">([^<]*)</.exec(doneHtml(ui.session)) || [])[1];
      morePracticeKeys = real;
      res.touch = /Tap a game to see its mistakes in the order played\\./.test(gamesHtml());
      var mm = window.matchMedia;
      window.matchMedia = function (q) { return { matches: q === '(pointer: fine)' }; };
      res.mouse = gamesHtml().indexOf('Click a game to see its mistakes') >= 0;
      res.word = tapWord();
      window.matchMedia = mm;
      /* the live region: emptied as a session ends and as it finishes */
      var live = { textContent: '' }, g0 = document.getElementById;
      document.getElementById = function (id) { return id === 'sr-live' ? live : g0(id); };
      startSession('t', [its[0].key, its[1].key], 't');
      live.textContent = 'Correct. Found it';
      endSession();
      res.ended = live.textContent;
      startSession('t', [its[0].key], 't');
      live.textContent = 'Correct. Found it';
      finishSession();
      res.finished = live.textContent;
      document.getElementById = g0;
      return JSON.stringify(res); })()`));
    eq(r.three, 'Next set of 3', 'three to give'); eq(r.eight, 'Next set of 8', 'all eight');
    ok(r.touch, 'Tap on a touch screen'); ok(r.mouse, 'Click where a mouse points'); eq(r.word, 'Click', 'tapWord with a fine pointer');
    eq(r.ended, '', 'nothing left in the live region when a session ends'); eq(r.finished, '', 'nor when it finishes');
  });

  await test('sets never run out by the day: each next set is as big as the set played, never repeats the last hours, and no screen after practice sends you off to play', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var res = { sizes: [], overlap: 0 }, prev = [];
      store.set('nl:sessionSize', 10);
      startSession('today', allMistakes().filter(trainable).slice(0, 5).map(function (x) { return x.key; }), 'Today');
      endSession();
      for (var n = 0; n < 4; n++) {
        var keys = morePracticeKeys();
        res.sizes.push(keys.length);
        keys.forEach(function (k) { if (prev.indexOf(k) >= 0) res.overlap++; });
        keys.forEach(function (k) { var it = model().byKey[k]; if (it) srsRecord(it, 'first', {}); });
        prev = prev.concat(keys);
      }
      ui.session = { mode: 'more', label: 't', keys: prev.slice(-5), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {}, finished: true };
      var done = doneHtml(ui.session);
      res.summaryPlay = /Play a game/.test(done);
      res.summaryNext = (/data-act="keepGoing">([^<]*)</.exec(done) || [])[1];
      res.todayPlay = /Play a game/.test(doneTodayHtml());
      res.todayNext = /data-act="keepGoing"/.test(doneTodayHtml());
      ui.session = null;
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.sizes), JSON.stringify([5, 5, 5, 5]), 'four more sets of five, as big as the set played');
    eq(r.overlap, 0, 'no position comes back within a few hours');
    ok(!r.summaryPlay && !r.todayPlay, 'no "Play a game" after practice');
    eq(r.summaryNext, 'Next set of 5', 'the summary offers the next set');
    ok(r.todayNext, 'Today offers the next set too');
  });

  await test('the summary and Today in plain words: when the positions come back ("Back in 7 days: 1. Back in 3 days: 1. Back tomorrow: 1.", V4.3), "Tomorrow: 5 positions, about 4 minutes (1 back, 4 new)." (the set the next day deals, V4.1), "back for another look" (never "reviews")', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable).filter(function (it) { return !it.b.d; }), res = {}, srs = srsLoad(), now = Date.now();
      var keys = its.slice(0, 3).map(function (x) { return x.key; });
      srs[keys[0]] = { box: 1, due: now + 3 * DAY }; srs[keys[1]] = { box: 2, due: now + 7 * DAY }; srs[keys[2]] = { box: 0, due: now + DAY };
      srsSave(srs);
      var ss = { mode: 'today', label: 't', keys: keys, idx: 3, results: {}, relearn: [], relearnOf: {}, notes: {}, finished: true };
      ss.results[keys[0]] = 'first'; ss.results[keys[1]] = 'first'; ss.results[keys[2]] = 'hint';
      res.two = (/class="recap-moved">([^<]*)</.exec(doneHtml(ss)) || [])[1];
      res.one = /recap-ladder/.test(doneHtml(ss));
      res.next = nextDueHtml();
      var tp = todayPlan;
      todayPlan = function () { return { keys: keys, fresh: 1, firstTime: false }; };
      res.why = (/class="why hero-cap">([^<]*)</.exec(heroHtml()) || [])[1];
      res.opp = model().byKey[keys[0]].g.opp;
      todayPlan = tp;
      return JSON.stringify(res); })()`));
    eq(r.two, 'Back in 7 days: 1. Back in 3 days: 1. Back tomorrow: 1.', 'when each comes back, the longest wait first (V4.3)');
    ok(!r.one, 'no second sentence on the same thing');
    eq(r.next, 'Tomorrow: 5 positions, about 4 minutes (1 back, 4 new).', 'what comes next: the set the next day deals, the one due and the new ones (V4.1)');
    eq(r.why, 'First: back for another look, from your game vs ' + r.opp + '.', 'card 1, a position met before, beside its board (F5.1)');
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

  await test('the summary\'s words for each position (F2.1): a first look, first try, with a hint, after a miss, a reveal reads Shown, left after a miss Missed, left untouched Skipped; a removed card is gone; one check line per step met (F2.3)', () => {
    const A = boot({ storage: Object.assign(base(), { 'nl:tip:game': '1' }) });
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 1; };
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && unpackUci(x.b.ru).length; });
      var we = its.filter(function (x) { var a = cardFor(x); ui.session = { keys: [x.key], idx: 0, results: {}, relearn: [], relearnOf: {} }; return workedExample(a); })[0];
      var pick = [we].concat(its.filter(function (x) { return x !== we; }).slice(0, 7));
      ui.session = { mode: 'today', label: 't', keys: pick.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      var ss = ui.session, act = function (i, fn) { ss.idx = i; var a = cardFor(pick[i]); ss.active = a; fn(a); };
      var best = function (a) { solved(uciToMove(a.st, a.bestUci), a.bestUci, null); };
      var miss = function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); };
      act(0, function (a) { workedExample(a); best(a); });                    /* First look */
      act(1, best);                                                           /* Found */
      act(2, function (a) { a.hints = 1; best(a); });                         /* With help */
      act(3, function (a) { miss(a); tryAgain(); best(a); });                 /* Found after a miss */
      act(4, function (a) { reveal(); });                                     /* Shown */
      act(5, function (a) { miss(a); settleLeft(a); });                       /* Missed */
      act(6, function (a) { settleLeft(a); });                                /* Skipped */
      act(7, function (a) { disputeCard('engine'); });                        /* gone */
      ss.active = null; ss.finished = true;
      var h = doneHtml(ss), words = [];
      h.replace(/class="res[^"]*">([^<]*)</g, function (m, w) { words.push(w); return m; });
      /* the check lines of the cards played (the one skipped untouched taught nothing), each once */
      var want = [];
      pick.slice(0, 6).forEach(function (x) { var e = ss.sum[x.key], l = e && esc(e.l); if (l && want.indexOf(l) < 0) want.push(l); });
      var habits = []; h.replace(/class="(?:plan )?keep-line">([^<]*)</g, function (m, t) { habits.push(t); return m; });
      return JSON.stringify({ words: words, head: (/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], then: (/class="recap-then">([^<]*)</.exec(h) || [])[1], notes: [ss.notes[pick[0].key], ss.notes[pick[4].key], ss.notes[pick[5].key], ss.notes[pick[6].key]],
        stars: (h.match(/<span class="stars"[^>]*aria-label="(\\d) of 3 stars"/g) || []).map(function (x) { return /(\\d) of 3/.exec(x)[1]; }).join(''),
        habits: habits, heads: (h.match(/>Keep in mind</g) || []).length, want: want, spotted: /spotted/i.test(h), glyphs: /[✓◐]/.test(h) }); })()`));
    eq(r.words.join(' | '), 'First look | First try | With a hint | After a miss | Shown | Missed | Skipped', 'the words, in session order, the removed card gone');
    eq(r.notes.join(' | '), 'firstlook | shown | leftMiss | left', 'the notes');
    eq(r.head, 'You found 4 of 7.', 'tier 1 (V4.3): a first look, a first try, a hint and a miss found, of the seven met (shown, missed and skipped not found)');
    eq(r.stars, '332200', 'the tiles\' stars, the skip none');
    eq(r.then, '1 took more than one try, 1 needed a hint, 1 was shown, 1 was missed, 1 was skipped.', 'the others in one line, in plain words');
    eq(JSON.stringify(r.habits), JSON.stringify(r.want), 'each check line met once, in the order met');
    eq(r.heads, 1, '"Keep in mind" once, the lines under it (C9)');
    ok(!r.spotted && !r.glyphs, 'no "spotted" recap line, no glyphs: words only');
  });

  await test('F2.2: what moved: one due clean find, one hint and one miss read "1 moved up, 1 held, 1 back to the start." with the tiles\' rungs at tier 2; a third clean find 16 days after the second leads the tiles: "Learned: Rg1, from your loss to opponent1. Found 3 times over N days." (shiftDays)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && x.key !== '184455333378:68'; }).slice(0, 3), now = Date.now(), srs = srsLoad();
      its.forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: now - 3600e3, last: now - 3 * DAY, ls: now - 3 * DAY, lapses: 0, rs: now - 3 * DAY }; });
      srsSave(srs);
      ui.session = { mode: 'today', label: 'Today', keys: its.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      var ss = ui.session, act = function (i, fn) { ss.idx = i; var a = cardFor(its[i]); ss.active = a; fn(a); };
      var best = function (a) { solved(uciToMove(a.st, a.bestUci), a.bestUci, null); };
      act(0, best);
      act(1, function (a) { a.hints = 1; best(a); });
      act(2, function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); tryAgain(); best(a); });
      ss.active = null; ss.finished = true;
      var h = doneHtml(ss), res = { moved: (/class="recap-moved">([^<]*)</.exec(h) || [])[1], rungs: (h.match(/class="rungs" role="img" aria-label="[^"]*"/g) || []).map(function (x) { return /label="([^"]*)"/.exec(x)[1]; }) };
      /* the days each comes back in, from its record: the clean find climbs (a week), the hint holds (sooner), the miss starts again (tomorrow) */
      res.days = its.map(function (x) { return daysFrom(Date.now(), srsRec(x).due); });
      /* card 1 found clean three times: fast at first sight (a week), again when due, then 16 days on */
      var it = model().byKey['184455333378:68'], a = openCard(it);
      best(a);
      var d1 = Math.ceil((srsRec(it).due - Date.now()) / DAY);
      shiftDays(d1);
      a = openCard(it); best(a);
      var d2 = Math.max(16, Math.ceil((srsRec(it).due - Date.now()) / DAY));
      shiftDays(d2);
      a = openCard(it); best(a);
      ui.session.active = null; ui.session.finished = true;
      var h2 = doneHtml(ui.session), first = (/<div class="recap">([\\s\\S]*?)<\\/div>/.exec(h2) || [])[1] || '';
      res.learned = { rec: srsRec(it).learned, moved: (/class="recap-moved">([^<]*)</.exec(h2) || [])[1], lead: /^<div class="recap-item recap-learned"/.test(first), say: ((/class="learned-say">([\\s\\S]*?)<\\/span>/.exec(h2) || [])[1] || '').replace(/<[^>]+>/g, ''), days: d1 + d2,
        seal: /^<div class="recap-item recap-learned"[^>]*><span class="learned-board"><svg class="board"[\\s\\S]*<\\/svg><span class="rg rg-learned" aria-hidden="true"><\\/span><\\/span><span class="learned-say">/.test(first), pips: /class="rungs"/.test(first) };
      return JSON.stringify(res); })()`));
    ok(r.days[0] > r.days[1] && r.days[1] > r.days[2] && r.days[2] === 1, 'the clean find waits longest, the hint less, the miss is back tomorrow: ' + r.days.join(' '));
    eq(r.moved, 'Back in ' + r.days[0] + ' days: 1. Back in ' + r.days[1] + ' days: 1. Back tomorrow: 1.', 'what moved, as when each comes back (V4.3: never "moved up", "held" or "back to the start")');
    eq(JSON.stringify(r.rungs), JSON.stringify(['2 of 3 steps to learned', '1 of 3 steps to learned', '0 of 3 steps to learned']), 'the rungs: a clean find on a due day climbs, a hint holds, a miss empties them');
    ok(r.learned.rec, 'card 1 is learned');
    eq(r.learned.moved, '1 learned.', 'what moved says it');
    ok(r.learned.lead, 'the learned position leads the tiles');
    ok(r.learned.seal && !r.learned.pips, 'its tile shows the learned glyph, the honey seal (F3.1), on its board\'s corner before its words, and no pips (the design lead\'s review of slice 4)');
    eq(r.learned.say, 'Learned: Rg1, from your loss to opponent1. Found 3 times over ' + r.learned.days + ' days.', 'its words');
  });

  await test('F2.4: when two or more wrong tries share a step, "Keep in mind" leads with it: digits 3, 3, 3, 1 read "3 of your 4 wrong tries failed the safety check." then "Before you move: their checks, captures, threats?" at tier 2 (tier 1 in its own words); two read "Both your wrong tries ..."; one shared by none adds nothing', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable).slice(0, 2), k1 = its[0].key, k2 = its[1].key;
      var keep = function (tier, fc1, fc2) {
        playerTier = function () { return tier; };
        var ss = { mode: 'today', label: 'Today', keys: [k1, k2], idx: 2, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
        ss.results[k1] = ss.results[k2] = 'retry';
        ss.sum[k1] = { c: 'miss', s: 1, fc: fc1, l: lineOfStep(3, tier), st: 3, m: 'start', p: 0 };
        ss.sum[k2] = { c: 'miss', s: 1, fc: fc2, l: lineOfStep(1, tier), st: 1, m: 'start', p: 0 };
        var h = doneHtml(ss), out = [];
        h.replace(/class="(?:plan )?keep-line">([^<]*)</g, function (m, t) { out.push(t); return m; });
        return out;
      };
      return JSON.stringify({ t2: keep(2, '33', '31'), t1: keep(1, '33', '31'), both: keep(2, '3', '3'), none: keep(2, '3', '1'), mine: keep(3, '22', '') }); })()`));
    eq(JSON.stringify(r.t2), JSON.stringify(['3 of your 4 wrong tries failed the safety check.', 'Before you move: their checks, captures, threats?', 'Their move: what does it attack?']), 'tier 2');
    eq(JSON.stringify(r.t1), JSON.stringify(['3 of your 4 wrong tries missed what they could take.', 'Before you move: what can they take?', 'Their move: what does it attack?']), 'tier 1');
    eq(r.both[0], 'Both your wrong tries failed the safety check.', 'two of two');
    eq(JSON.stringify(r.none), JSON.stringify(['Before you move: their checks, captures, threats?', 'Their move: what does it attack?']), 'no step shared: the lines alone');
    eq(r.mine[0], 'Both your wrong tries missed your chance.', 'step 2\'s words');
  });

  await test('F2.6, V4.1: a calm Tomorrow, the set the next day deals: 23 due read "Tomorrow: a set of 10, about 8 minutes. 13 more over the next 3 weeks." (F7.2\'s words), 10 "Tomorrow: a set of 10, about 8 minutes.", 3 with new positions left "Tomorrow: 7 positions, about 6 minutes (3 back, 4 new)."; a day counts once 3 positions are tried, the set paused (2 tried do not); Settings says the rule', () => {
    const run = (n) => {
      const A = boot();
      return A.ev(`(function () {
        var its = allMistakes().filter(trainable).slice(0, ${n}), srs = {}, t = new Date(); t.setDate(t.getDate() + 1); t.setHours(12, 0, 0, 0);
        its.forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: t.getTime(), last: Date.now() - DAY }; });
        store.set('nl:sessionSize', 10); srsSave(srs);
        return nextDueHtml(); })()`);
    };
    eq(run(23), 'Tomorrow: a set of 10, about 8 minutes. 13 more over the next 3 weeks.', 'more than a set');
    eq(run(10), 'Tomorrow: a set of 10, about 8 minutes.', 'a set');
    eq(run(3), 'Tomorrow: 7 positions, about 6 minutes (3 back, 4 new).', 'fewer due: the new ones the day adds are in it (V4.1)');
    const day = (tried) => {
      const A = boot();
      return JSON.parse(A.ev(`(function () {
        var keys = allMistakes().filter(trainable).slice(0, 5).map(function (x) { return x.key; });
        startSession('today', keys, 'Today'); ui.session.active = null; ui.session.idx = 3; ui.session.results[keys[0]] = 'first'; ui.session.attempted = ${tried};
        endSession();
        return JSON.stringify({ counts: dayCounts(dayLoad()), paused: !!savedSession(), week: weekDays(), rule: settingsHtml().indexOf(DAY_RULE) >= 0 && DAY_RULE }); })()`));
    };
    const three = day(3), two = day(2);
    ok(three.counts && three.paused && three.week === 1, 'a paused set with 3 tried counts the day: ' + JSON.stringify(three));
    ok(!two.counts && two.paused, 'with 2 tried it does not: ' + JSON.stringify(two));
    eq(three.rule, 'A day counts once you try 3 positions, or all of a shorter set.', 'Settings says the rule');
  });

  await test('F7.1: extra sets keep bringing new positions: with 85 unpractised, Today and every extra set after it take new ones while any remain, far past the day\'s 8; then practice, where a clean find moves no date and a miss comes back tomorrow', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var its = allMistakes().filter(trainable), now = Date.now(), srs = srsLoad(), res = { sets: [] }, n = 0;
      its.slice(0, 6).forEach(function (x, i) { srs[x.key] = { box: 2, streak: 1, due: now + (3 + i) * DAY, last: now - 2 * DAY, ls: now - 2 * DAY, lapses: 0 }; });
      srsSave(srs);
      res.unpractised = buildCandidates(500).length;
      var play = function (mode, keys) {
        store.set('nl:setSize', keys.length); logSet(mode, keys);
        keys.forEach(function (k) { srsRecord(model().byKey[k], n++ % 3 ? 'first' : 'retry', { ms: 30000, attempted: true }); });
      };
      var today = todayPlan().keys;
      res.today = [today.length, today.filter(function (k) { return !srsLoad()[k]; }).length];
      play('today', today);
      for (var s = 0; s < 40; s++) {
        var left = buildCandidates(500).length, keys = morePracticeKeys();
        if (!keys.length) break;
        res.sets.push([keys.length, keys.filter(function (k) { return !srsLoad()[k]; }).length, left]);
        if (left) { play('more', keys); continue; }
        /* new ones all gone: practice; a clean find moves nothing, a miss comes back tomorrow */
        var before = keys.map(function (k) { var x = srsLoad()[k]; return JSON.stringify([x.due, x.box, x.streak, x.ls]); });
        logSet('more', keys);
        res.practice = keys.map(function (k, i) {
          var rec = srsRecord(model().byKey[k], i ? 'first' : 'retry', { ms: 9000, attempted: true });
          return i ? JSON.stringify([rec.due, rec.box, rec.streak, rec.ls]) === before[i] : rec.due === dayStart(Date.now(), 1);
        });
        break;
      }
      res.dayNew = dayLoad().fresh;
      res.log = logLoad().filter(function (e) { return e.e === 's'; }).map(function (e) { return [e.mo, e.n, e.new, e.due, e.sp, e.pr]; });
      return JSON.stringify(res); })()`));
    eq(r.unpractised, 85, '85 unpractised positions');
    eq(JSON.stringify(r.today), '[4,4]', 'Today keeps today\'s rule: 4 new');
    ok(r.sets.length >= 7, 'Today and 6 extra sets, and more: ' + r.sets.length);
    r.sets.forEach((x, i) => ok(x[1] === Math.min(x[0], x[2]), 'extra set ' + (i + 1) + ' takes every new position it has room for: ' + JSON.stringify(x)));
    ok(r.sets.slice(0, 6).every((x) => x[1] > 0), 'new positions in each of the first 6 extra sets');
    eq(r.dayNew, 85, 'all 85 new today, no daily limit');
    ok(r.practice && r.practice.length >= 2 && r.practice.every(Boolean), 'practice: a miss back tomorrow, clean finds move nothing: ' + JSON.stringify(r.practice));
    const last = r.log[r.log.length - 1];
    ok(last[2] === 0 && last[5] === last[1] && last[1] >= 2, 'the log says the last set is practice: ' + JSON.stringify(last));
  });

  await test('F7.1: when only the focus family has new positions left, an extra set still fills with them (practice only once none is left); Today keeps the family to half', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed'; store.set('nl:sessionSize', 10); store.set('nl:setSize', 10);
      var f = currentFocus(), srs = {}, now = Date.now();
      allMistakes().filter(trainable).forEach(function (it) { if (familyOf(patternOf(it.b)).key !== f.fam) srs[it.key] = { box: 2, streak: 1, due: now + 5 * DAY, last: now - 2 * DAY, ls: now - 2 * DAY, lapses: 0 }; });
      srsSave(srs);
      var keys = morePracticeKeys();
      return JSON.stringify({ left: buildCandidates(500).length, today: buildCandidates(10).length, more: keys.filter(function (k) { return !srsLoad()[k]; }).length }); })()`));
    ok(r.left >= 10, 'focus positions left: ' + r.left);
    eq(r.today, 5, 'Today: the focus family at most half');
    eq(r.more, 10, 'an extra set: all ten new');
  });

  await test('F7.1: the day\'s first opening with 40 due (shiftDays): the 12 that decided no game, are outside the focus and are overdue by more than twice their interval go back to the queue (no date, new again), the 10 most valuable stay due, the other 18 spread over the next 21 days with no day above 10; the notices show once, the opening is logged and measured; extra sets take due, then spread, then new; a spread position found clean moves up a rung', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${POOL}
      SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var calls = [], notes = [], n0 = notice, res = {};
      window.clarity = function () { calls.push([].slice.call(arguments).map(String)); };
      notice = function (m) { notes.push(m); };
      var fam = currentFocus().fam, P = Date.now(), its = allMistakes().filter(trainable);
      var inF = function (x) { return familyOf(patternOf(x.b)).key === fam; };
      var dec = its.filter(function (x) { return x.b.d; }), foc = its.filter(function (x) { return !x.b.d && inF(x); }), low = its.filter(function (x) { return !x.b.d && !inF(x); });
      var Q = low.slice(0, 12), D = dec.slice(0, 10), KF = foc.slice(0, 9), KL = low.slice(12, 21), used = Q.concat(D, KF, KL);
      var F = its.filter(function (x) { return used.indexOf(x) < 0; }).slice(0, 8), srs = {};
      /* as they will stand four days on, after shiftDays(4) */
      var put = function (x, box, last, due) { srs[x.key] = { box: box, streak: box ? 1 : 0, due: due + 4 * DAY, last: last + 4 * DAY, ls: last + 4 * DAY, lapses: 0 }; };
      Q.forEach(function (x) { put(x, 0, P - 4 * DAY, P - 3 * DAY); });           /* a day's interval, 3 days late */
      D.forEach(function (x) { put(x, 1, P - 4 * DAY, P - DAY); });
      KF.forEach(function (x) { put(x, 0, P - 4 * DAY, P - 3 * DAY); });          /* as late, but the focus */
      KL.forEach(function (x) { put(x, 2, P - 8 * DAY, P - DAY); });              /* a week's interval, a day late */
      F.forEach(function (x) { put(x, 2, P - 6 * DAY, dayStart(P, 1) + 12 * 3600e3); });
      srsSave(srs);
      store.set(absorbKey(), { d: dayStamp(), due: 0, sp: 0, q: 0, left: 0 });   /* today already opened */
      res.before = [dueCards().length, absorbOpen()];
      window.__nlTest.shiftDays(4);
      res.s = absorbOpen();
      res.again = absorbOpen();
      var map = srsLoad(), key = function (x) { return x.key; };
      res.queued = Q.every(function (x) { return map[x.key].due === null && map[x.key].q > 0; });
      var cand = buildCandidates(500).map(key);
      res.asNew = Q.every(function (x) { return cand.indexOf(x.key) >= 0; });
      res.dueKeys = dueCards().map(key).sort().join() === D.map(key).sort().join();
      var spread = KF.concat(KL), perDay = {};
      res.spreadAll = spread.every(function (x) { var d = daysFrom(Date.now(), map[x.key].due); return map[x.key].sp > 0 && d >= 1 && d <= 21; });
      Object.keys(map).forEach(function (k) { var r = map[k]; if (r.due != null && daysFrom(Date.now(), r.due) >= 1) { var d = daysFrom(Date.now(), r.due); perDay[d] = (perDay[d] || 0) + 1; } });
      res.perDay = perDay;
      res.hero = heroWords();
      res.notes = notes.slice();
      res.log = logLoad().filter(function (e) { return e.e === 'o'; }).map(function (e) { return [e.due, e.kept, e.sp, e.q, e.left, e.od]; });
      res.events = calls.filter(function (c) { return c[0] === 'event'; }).map(function (c) { return c[1]; });
      /* extra sets: the due first, then the spread ones (graded as due), then new */
      var k1 = morePracticeKeys();
      res.first = k1.length === 10 && k1.every(function (k) { return D.some(function (x) { return x.key === k; }); });
      k1.forEach(function (k) { srsRecord(model().byKey[k], 'first', { ms: 30000, attempted: true }); });
      var k2 = morePracticeKeys(), m2 = srsLoad();
      res.second = k2.length === 10 && k2.every(function (k) { return m2[k] && m2[k].sp; }) && k2.slice(0, 9).every(function (k) { return KF.some(function (x) { return x.key === k; }); });
      /* a spread position found clean in that set: up a rung */
      var sp = model().byKey[k2.filter(function (k) { var c = cardFor(model().byKey[k]); return c && !c.sol; })[0]], rec0 = JSON.parse(JSON.stringify(srsLoad()[sp.key]));
      var a = openCard(sp); solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      var rec1 = srsLoad()[sp.key];
      res.up = { box: [rec0.box, rec1.box], streak: [rec0.streak, rec1.streak], sp: rec1.sp === undefined, moved: ui.session.sum[sp.key].m, due: daysFrom(Date.now(), rec1.due) };
      k2.forEach(function (k) { if (k !== sp.key) srsRecord(model().byKey[k], 'first', { ms: 30000, attempted: true }); });
      var k3 = morePracticeKeys(), m3 = srsLoad();
      res.third = [k3.filter(function (k) { return m3[k] && m3[k].sp; }).length, k3.filter(function (k) { return !m3[k] || m3[k].q; }).length];
      notice = n0;
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.before), '[0,null]', 'nothing due before, today already opened');
    eq(JSON.stringify(r.s), JSON.stringify({ d: r.s.d, due: 40, sp: 18, q: 12, left: 0 }), 'the opening: 40 due, 18 spread, 12 queued');
    eq(r.again, null, 'once a day');
    ok(r.queued && r.asNew, 'the 12 have no due date and count as new');
    ok(r.dueKeys, 'the 10 that decided games stay due');
    ok(r.spreadAll, 'the other 18 get dates within 21 days');
    eq(JSON.stringify(r.perDay), JSON.stringify({ 1: 10, 2: 10, 3: 6 }), 'onto the first days with room, no day above 10 (8 were due tomorrow already)');
    eq(JSON.stringify(r.hero), JSON.stringify({ title: '10 positions, about 8 minutes', more: '18 more spread over the next 3 weeks.' }), 'Today leads with one set, the rest in line 2');
    eq(JSON.stringify(r.notes), JSON.stringify(['18 reviews spread over the next 3 weeks, so today stays at one set. 12 older positions went back to your queue, to return later.']), 'the notices, once');
    eq(JSON.stringify(r.log), JSON.stringify([[40, 10, 18, 12, 0, 40]]), 'the opening in the log');
    eq(JSON.stringify(r.events.filter((e) => /^overdue_|^queued$/.test(e))), JSON.stringify(['overdue_30_plus', 'queued']), 'measured once: how far behind, a queue used');
    ok(r.first, 'an extra set takes the due ones first');
    ok(r.second, 'then the spread ones, most valuable first');
    eq(JSON.stringify(r.up), JSON.stringify({ box: [0, 1], streak: [0, 1], sp: true, moved: 'up', due: 3 }), 'a spread position found clean moves up a rung, graded as due');
    eq(JSON.stringify(r.third), JSON.stringify([8, 2]), 'then the last spread ones, then new ones');
  });

  await test('F7.2: one set leads, the total follows: 23 due tomorrow with room, the summary says "Tomorrow: a set of 10, about 8 minutes. 13 more over the next 3 weeks." and the next day agrees ("10 positions, about 8 minutes", "13 more spread over the next 3 weeks.", the notice once); with no room the title still names one set and line 2 reads "23 due in all. Each set takes the most important first."; more left today reads "13 more due today; any left spread over the next 3 weeks."', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${POOL}
      SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var its = allMistakes().filter(trainable), now = Date.now(), srs = {}, t = dayStart(now, 1) + 12 * 3600e3, res = {}, notes = [], n0 = notice;
      notice = function (m) { notes.push(m); };
      its.slice(0, 23).forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: t, last: now - 2 * DAY, ls: now - 2 * DAY, lapses: 0 }; });
      srsSave(srs);
      absorbOpen();
      var keys = its.slice(30, 33).map(function (x) { return x.key; });
      var ss = { mode: 'today', label: 'Today', keys: keys, idx: 3, results: {}, relearn: [], relearnOf: {}, notes: {}, finished: true };
      res.summary = (/class="recap-next">([^<]*)</.exec(doneHtml(ss)) || [])[1];
      window.__nlTest.shiftDays(1);
      absorbOpen();
      res.hero = heroWords(); res.notes = notes.slice();
      /* after Today's set (the 10 due, no new one pushing a due one out: V4.1), nothing due is left today */
      res.taken = todayPlan(); res.taken = [res.taken.keys.length, res.taken.dueTaken, res.taken.fresh];
      todayPlan().keys.forEach(function (k) { srsRecord(model().byKey[k], 'first', { ms: 30000, attempted: true }); });
      res.after = nextDueHtml();
      /* no room: the next 21 days already hold 10 each */
      growPool(150);
      its = allMistakes().filter(trainable);
      var map = {}, i = 0;
      its.slice(0, 23).forEach(function (x) { map[x.key] = { box: 1, streak: 1, due: Date.now() - 3600e3, last: Date.now() - 3 * DAY, ls: Date.now() - 3 * DAY, lapses: 0 }; });
      for (var d = 1; d <= 21; d++) for (var j = 0; j < 10; j++) { var x = its[23 + i++]; map[x.key] = { box: 3, streak: 2, due: dayStart(Date.now(), d) + 12 * 3600e3, last: Date.now() - 10 * DAY, ls: Date.now() - 10 * DAY, lapses: 0 }; }
      store.set(srsKey(), map); srsMem = null; srsRevision++;
      store.del(absorbKey()); notes.length = 0;
      res.full = absorbOpen();
      res.fullHero = heroWords(); res.fullNotes = notes.slice();
      res.fullLeft = nextDueHtml();
      notice = n0;
      return JSON.stringify(res); })()`));
    eq(r.summary, 'Tomorrow: a set of 10, about 8 minutes. 13 more over the next 3 weeks.', 'the summary\'s Tomorrow');
    eq(JSON.stringify(r.hero), JSON.stringify({ title: '10 positions, about 8 minutes', more: '13 more spread over the next 3 weeks.' }), 'the next day agrees: a set of 10, 13 spread');
    eq(JSON.stringify(r.notes), JSON.stringify(['13 reviews spread over the next 3 weeks, so today stays at one set.']), 'the notice, once');
    eq(JSON.stringify(r.taken), '[10,10,0]', 'Today\'s set holds the 10 due, none left out for a new one (V4.1)');
    ok(/^Tomorrow: /.test(r.after) && !/due today/.test(r.after), 'after Today\'s set: nothing due is left today, so the summary goes on to tomorrow: ' + r.after);
    eq(JSON.stringify([r.full.sp, r.full.q, r.full.left]), '[0,0,13]', 'no room: nothing spread, 13 left due');
    eq(JSON.stringify(r.fullHero), JSON.stringify({ title: '10 positions, about 8 minutes', more: '23 due in all. Each set takes the most important first.' }), 'the title names one set, the total in line 2');
    eq(JSON.stringify(r.fullNotes), '[]', 'nothing spread or queued: no notice');
    eq(r.fullLeft, '23 more are ready for your next sets. Each set takes the most important first.', 'the summary says what is left today, never "due today" (V4.1)');
  });

  await test('F7.1 simulated (shiftDays, learning\'s learner and scenario): a keen fortnight of 4 sets a day, then Today only, 90 days: every opening leads with one set, about one position overdue on an average day from day 21 (Appendix A: 1.0), reviews less than 3.5 days late, low-value overdue positions go back to the queue, practice only once no new position is left; without the opening\'s rule the overdue pile passes 10 (V4.1: with a set\'s worth due, Today takes no new one, so the pile grows less than the 77 it did)', () => {
    const run = (noRule) => {
      const A = boot();
      return JSON.parse(A.ev(`(function () { ${POOL} ${SIM}
        return JSON.stringify(simRun(8, 90, function (d) { return d < 14 ? 4 : 1; }, ${noRule ? 'true' : 'false'})); })()`));
    };
    const rule = run(false), none = run(true);
    const mean = (o) => o.days.slice(20).reduce((a, d) => a + d.over, 0) / 70;
    const late = rule.late / rule.reviews, maxOpen = Math.max(...rule.days.slice(1).map((d) => (d.left ? 0 : d.opened)));
    ok(maxOpen <= 10, 'every opening with room leads with at most one set due: ' + maxOpen);
    ok(rule.days.every((d) => !d.left), 'room every day');
    ok(mean(rule) <= 2, 'overdue on an average day from day 21: ' + mean(rule).toFixed(1));
    ok(late <= 3.5, 'days late: ' + late.toFixed(2));
    ok(rule.queuedEver >= 5, 'positions back to the queue: ' + rule.queuedEver);
    eq(rule.starved, 0, 'no practice while a new own position was left');
    ok(rule.days[89].learned >= 80, 'learned by day 90: ' + rule.days[89].learned);
    ok(mean(none) >= 10 && mean(none) >= 5 * Math.max(1, mean(rule)), 'without the rule, overdue on an average day: ' + mean(none).toFixed(1));
  });

  await test('the relearn segment joins the session bar as the card is queued, marked, after a gap (V4.2) and named for a screen reader, and stays marked when the card comes back, counted apart: "One more try, 1 of 1"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 3);
      ui.session = { mode: 'today', label: 't', keys: its.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      var ss = ui.session, res = {}, bar = function () { return sessionBarHtml(ss, null); }, n = function (h, re) { return (h.match(re) || []).length; };
      ss.active = cardFor(its[0]);
      res.before = [n(bar(), /<span class="dot/g), n(bar(), /relearn/g), /try again/.test(bar())];
      reveal();
      res.queued = [n(bar(), /<span class="dot/g), n(bar(), /class="dot relearn gap"/g), (/<span class="sr-only">([^<]*)</.exec(bar()) || [])[1]];
      ss.idx = 1; ss.active = cardFor(its[1]); solved(uciToMove(ss.active.st, ss.active.bestUci), ss.active.bestUci, null);
      ss.idx = 2; ss.active = cardFor(its[2]); solved(uciToMove(ss.active.st, ss.active.bestUci), ss.active.bestUci, null);
      queueRelearn(ss); ss.idx = 3; ss.active = cardFor(its[0]);
      res.back = [n(bar(), /<span class="dot/g), n(bar(), /class="dot on relearn gap"/g), n(bar(), /class="dot done"/g), /try again/.test(bar()), (/<span class="sr-only">([^<]*)</.exec(bar()) || [])[1]];
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.before), JSON.stringify([3, 0, false]), 'nothing queued: three plain segments');
    eq(JSON.stringify(r.queued.slice(0, 2)), JSON.stringify([4, 1]), 'a shown answer queues it: a fourth segment, marked, after a gap');
    eq(r.queued[2], 'Position 1 of 3, and one position to try again', 'named for a screen reader');
    eq(JSON.stringify(r.back.slice(0, 4)), JSON.stringify([4, 1, 3, false]), 'back again: its segment current and still marked, after the gap');
    eq(r.back[4], 'One more try, 1 of 1', 'counted apart from the set: never "Position 4 of 4"');
  });
  await test('V4.2: a set keeps its size: a set of 5 with 3 misses never reads "of 8"; each miss says "This one comes back at the end." once, in a notice once its verdict has landed; the bar draws 5 segments, a gap, then 3', () => {
    const A = boot();
    A.ev(`(function () {
      playerTier = function () { return 2; };
      window.__notes = []; notice = function (m) { window.__notes.push(m); };
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 5);
      window.__keys = its.map(function (x) { return x.key; });
      ui.session = { mode: 'today', label: 'Today', keys: window.__keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      return 1; })()`);
    const says = [], notes = [];
    for (let i = 0; i < 5; i++) {
      says.push(A.ev(`(function () {
        var ss = ui.session, a = cardFor(model().byKey[window.__keys[${i}]]);
        ss.idx = ${i}; ss.active = a;
        if (${i} < 3) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); tryAgain(); }
        a.attempts = (a.attempts || 0) + 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        return (/<span class="sr-only">([^<]*)</.exec(sessionBarHtml(ss, a)) || [])[1]; })()`));
      A.advance(800);
      notes.push(A.ev('window.__notes.length'));
    }
    const r = JSON.parse(A.ev(`(function () { var ss = ui.session;
      var dots = (sessionBarHtml(ss, null).match(/<span class="dot[^"]*"/g) || []).map(function (x) { return /gap/.test(x) ? 'gap+r' : /relearn/.test(x) ? 'r' : 's'; }).join(' ');
      ss.idx = 5; ss.active = null; queueRelearn(ss); ss.active = cardFor(model().byKey[window.__keys[0]]);
      return JSON.stringify({ queued: ss.keys.length - 5, dots: dots, retry: (/<span class="sr-only">([^<]*)</.exec(sessionBarHtml(ss, ss.active)) || [])[1], words: window.__notes.slice(0, 1) }); })()`));
    ok(says.every((x) => /^Position \d of 5\b/.test(x)), 'the counter stays at the set\'s size: ' + says.join(' | '));
    eq(JSON.stringify(notes), '[1,2,3,3,3]', 'each miss says it once, the clean finds nothing');
    eq(JSON.stringify(r.words), JSON.stringify(['This one comes back at the end.']), 'the words');
    eq(r.dots, 's s s s s gap+r r r', 'the set\'s 5 segments, a gap, then the 3 retries');
    eq(r.queued, 3, 'the three come back after the set');
    eq(r.retry, 'One more try, 1 of 3', 'a retry counts among the retries, never "Position 6 of 8"');
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

  await test('hints never name the answer, in words or marks: every card and tier, hints 1 and 2 (and 3 where it follows, F9.2), on the card and inside a forcing line; a prize ringed is a piece the line wins', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      ${PLAIN}
      ${WORDS}
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
        /* (a trade, or two kinds of piece, in the board's pieces: the line's own ledger) */
        if (m[1] === own || m[1] === 'material' || (m[1] === 'a lot of material' && Math.abs(c.matBest) >= 6) || (m[1] === ledgerIcons(c.bestLine, c.bSettle, 1, own) && /[\\u2654-\\u265f]/.test(m[1]))) return;
        out.push(what + ': "' + s + '" where the line took ' + (own || 'no one phrase') + ' (net ' + c.matBest + ')');
      };
      /* the danger hint (F1.1, dangerHint) as the board shows it: rings on your pieces (or the square they
         mate on, or their loose piece), arrows that are legal captures of a ringed piece (were it their
         move, or after the game move on a safety card), words its own and true: "twice" counts the legal
         takers, "Their X attacks your Y" names a taker, "lets them take your Y" a legal capture once the game
         move is played, "has no guard" a piece of theirs nothing guards that the best line wins */
      var takers = function (pos, sq) { var f = {}; legalMoves(pos).forEach(function (m) { if (m.to === sq) f[m.from] = 1; }); return Object.keys(f).map(Number); };
      var PW = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
      var dangerTrue = function (what, a, d, h, hm) {
        var dz = hm.dz || hm.rep, ws = hm.rep ? repeatedWords(a, hm.rep) : dangerWords(a, hm.dz), pov = myPov(a.it), m;
        n.dz = (n.dz || 0) + 1; n['dz ' + dz.kind] = (n['dz ' + dz.kind] || 0) + 1;
        if (ws.indexOf(d.row2) < 0 && d.row2 !== h.fall) out.push(what + ': the danger hint reads ' + d.row2 + ', not one of ' + ws.join(' | '));
        if (checkersOf(a.pre).length) {
          /* in check: the check, in words, nothing drawn (the coach's review) */
          if (dz.kind !== 'check' && !hm.rep) out.push(what + ': in check, a ' + dz.kind + ' hint');
          if (dz.kind === 'check' && (d.row2 !== 'In check: move, block or take?' || hm.rings.length || hm.arrows.length)) out.push(what + ': in check reads ' + d.row2);
          return;
        }
        var nst = cloneState(a.pre); nst.w = !nst.w; nst.ep = -1;
        var post = cloneState(a.pre); applyMove(post, a.played);
        var ringed = function (sq) { return dz.rings.some(function (x) { return x.sq === sq; }); };
        if (dz.kind === 'attacked') {
          dz.rings.forEach(function (x) { var p = a.pre.b[x.sq]; if (x.kind !== 'attacked' || !p || isW(p) !== pov || pType(p) === 'K') out.push(what + ': a danger ring on ' + sqName(x.sq) + ', not a piece of yours'); });
          dz.arrows.forEach(function (x) { if (takers(nst, x.to).indexOf(x.from) < 0 || !(ringed(x.to) || x.to === dz.named.sq || (dz.second && x.to === dz.second.sq))) out.push(what + ': ' + sqName(x.from) + ' cannot take on ' + sqName(x.to)); });
          var tk = takers(nst, dz.named.sq);
          if ((m = /^Your (\\w+) is attacked (twice|three times|four times)\\.$/.exec(d.row2))) { if (PW[m[1]] !== pType(dz.named.p) || tk.length !== { twice: 2, 'three times': 3, 'four times': 4 }[m[2]]) out.push(what + ': ' + d.row2 + ' where ' + tk.length + ' may take'); }
          else if ((m = /^Their (\\w+) attacks your (\\w+)\\.$/.exec(d.row2))) { if (PW[m[2]] !== pType(dz.named.p) || !tk.some(function (f) { return pType(a.pre.b[f]) === PW[m[1]]; })) out.push(what + ': ' + d.row2 + ' is not true here'); }
          else if ((m = /^(?:Your (\\w+) and (\\w+)|Two of your (\\w+)s) are attacked\\.$/.exec(d.row2))) { if (!dz.second || !takers(nst, dz.second.sq).length || !tk.length) out.push(what + ': ' + d.row2 + ' is not true here'); }
          else if (d.row2 !== h.fall) out.push(what + ': an unknown danger form ' + d.row2);
        } else if (dz.kind === 'made') {
          dz.arrows.forEach(function (x) { if (takers(post, x.to).indexOf(x.from) < 0) out.push(what + ': after the game move ' + sqName(x.from) + ' cannot take on ' + sqName(x.to)); });
          if ((m = / lets them take your (\\w+)\\.$/.exec(d.row2)) && (PW[m[1]] !== pType(post.b[dz.named.sq]) || !takers(post, dz.named.sq).length)) out.push(what + ': ' + d.row2 + ' is not true here');
        } else if (dz.kind === 'madeMate') {
          var mm = legalMoves(post).filter(function (x) { return x.from === dz.mate.from && x.to === dz.mate.to; })[0], af = mm ? cloneState(post) : null;
          if (af) applyMove(af, mm);
          if (!af || !isMate(af)) out.push(what + ': ' + d.row2 + ' where that move does not mate');
        } else if (dz.kind === 'win') {
          /* V2.3: a missed win rings the piece the answer's line wins, where it stands now: theirs, and
             the line (to where it settles) takes one of its kind */
          var wp = a.pre.b[dz.sq], wl = buildLine(a.pre, '0000', unpackUci(a.it.b.lu), pov), wk = Math.min(settleLine(a.pre, unpackUci(a.it.b.lu)).k, wl.nodes.length - 1);
          var wonIt = false;
          for (var q = 1; q <= wk; q++) { var wn = wl.nodes[q]; if (wn.pov && wn.captured && pType(wn.captured) === pType(wp)) wonIt = true; }
          var wnet = matDiff(wl.nodes[wk].after.b, pov) - matDiff(wl.nodes[0].before.b, pov);
          /* (a piece won for less: a net of 2, a pawn's 1; under 60% the answer's own first capture) */
          if (winPct(a.it.b.eb) < 60) { var f1 = wl.nodes[1]; wonIt = !!f1 && !!f1.captured && pType(f1.captured) === pType(wp); wnet = wonIt ? MOTIF_VAL[pType(wp)] : 0; }
          if (!wp || isW(wp) === pov || !wonIt || wnet < (pType(wp) === 'P' ? 1 : 2)) out.push(what + ': "' + d.row2 + '" where the line does not win the ' + wp + ' on ' + sqName(dz.sq));
          if ((m = /^You can win their (\w+)\.$/.exec(d.row2)) && PW[m[1]] !== pType(wp)) out.push(what + ': ' + d.row2 + ' rings a ' + wp);
          if (hm.rings.length && (hm.rings.length !== 1 || hm.rings[0].sq !== dz.sq || hm.rings[0].kind !== 'target')) out.push(what + ': a missed win draws ' + JSON.stringify(hm));
        } else if (dz.kind === 'loose') {
          var lp = a.pre.b[dz.loose.sq];
          if (!lp || isW(lp) === pov || isDefended(a.pre.b, dz.loose.sq) || !hintPrize(a) || hintPrize(a).sq !== dz.loose.sq) out.push(what + ': the loose piece on ' + sqName(dz.loose.sq) + ' is not one');
        } else if (dz.kind === 'mine') {
          if (!(c0(a).mateFor && a.it.b.mb === 1) || hm.rings.length || hm.arrows.length) out.push(what + ': a mate in one where there is none, or drawn');
        } else if (dz.kind === 'lost') {
          /* a piece the better move keeps, in words: one the danger facts save */
          var lsv = (dangerNow(a.it) || {}).sv || '';
          if ((m = / lets them win your (\\w+)\\.$|^Watch your (\\w+)\\.$/.exec(d.row2)) && lsv.indexOf(PW[m[1] || m[2]]) < 0) out.push(what + ': ' + d.row2 + ' where it keeps ' + lsv);
          if (hm.rings.length || hm.arrows.length) out.push(what + ': a lost piece drawn');
        } else if (dz.kind === 'parried') {
          /* their mate the game move stopped, and the game line's reply, drawn where it stands */
          var g1 = threatOf(a.cls.gameLine, 1);
          if (!g1 || !same(hm.rings, [{ sq: g1.from, kind: 'threat' }]) || hm.arrows.length !== 1 || hm.arrows[0].from !== g1.from || hm.arrows[0].to !== g1.to) out.push(what + ': a stopped mate draws ' + JSON.stringify(hm));
        }
      };
      var c0 = function (a) { return a.cls; };
      var frame = function (what, a) {
        n.frames++;
        var due = dueMove(a), dueSan = sanOf(a.st, due), d = displayFor(a), h = hintText(a), hm = hintMarks(a), f = boardOptsFor(a);
        if (h.row1 !== d.row1) out.push(what + ': the band reads ' + d.row1 + ', the hint ' + h.row1);
        if (!same(h.marks, hm)) out.push(what + ': hintText draws other marks than hintMarks');
        if (words(d.row1).concat(words(d.row2)).indexOf(dueSan) >= 0) out.push(what + ' names the answer: ' + d.row1 + ' / ' + d.row2);
        /* nor the answer's square, inside any move it names but the game move (whose red arrow is on the card) */
        [d.row2].concat(h.cands, [h.fall]).forEach(function (x) {
          if (words(x).indexOf(dueSan) >= 0 || String(x).toLowerCase().indexOf(wordsOf(a.st, due)) >= 0) out.push(what + ' has a form naming the answer: ' + x);
          var gw = wordsOf(a.pre, a.played);
          if (String(x).split(gameSan(a)).join(' ').split(gw).join(' ').split(gw.charAt(0).toUpperCase() + gw.slice(1)).join(' ').indexOf(sqName(due.to)) >= 0) out.push(what + ' names the answer square: ' + x);
        });
        /* every hint string, ladder and fallback too, in plain words at this tier */
        [d.row1, d.row2, h.fall].concat(h.cands).forEach(function (x) { var bad = unplain(x, a.tier); n.plain2++; if (bad) out.push(what + ': "' + bad + '" in a hint: ' + x); });
        /* the board draws exactly these marks */
        var rings = (f.opts.rings || []).filter(function (m) { return m.kind !== 'nope'; }), arrows = (f.opts.arrows || []);
        if (!same(rings, hm.rings) || !same(arrows, hm.arrows) || f.opts.hint != null) out.push(what + ': the board draws ' + JSON.stringify([rings, arrows, f.opts.hint]) + ' for ' + JSON.stringify([hm.rings, hm.arrows]));
        var sqs = [];
        hm.rings.forEach(function (m) { sqs.push(m.sq); });
        hm.arrows.forEach(function (m) { sqs.push(m.from, m.to); });
        /* Hint 3 (F9.2): the circled piece and the red squares, never the answer's own square */
        if (a.hints >= 3) {
          n.ring3 = (n.ring3 || 0) + 1;
          var h3 = hint3Of(a), tints = (f.opts.tints || []).filter(function (t) { return t.kind === 'lose'; }).map(function (t) { return t.sq; });
          if (!h3 || a.tier !== 1 || !same(hm.rings, [{ sq: due.from, kind: 'hint' }]) || hm.arrows.length || !same(tints, hm.reds) || hm.reds.indexOf(due.to) >= 0 || !hm.reds.length) out.push(what + ': hint 3 draws ' + JSON.stringify([hm, tints]));
          if (d.row1 !== 'Hint 3 of 3' || hint3Words(h3 || {}).indexOf(d.row2) < 0) out.push(what + ': hint 3 reads ' + d.row1 + ' / ' + d.row2);
          return;
        }
        if (a.hints >= 2) {
          n.ring2++;
          if (!same(hm.rings, [{ sq: due.from, kind: 'hint' }]) || hm.arrows.length) out.push(what + ': hint 2 draws ' + JSON.stringify(hm));
          /* "Find a safe square." only where hint 1 rang that piece as in danger and the answer takes it out
             of danger (content's review) */
          /* V2.3 (the orchestrator's rule): with no fact sheet, only where the piece has one safe square,
             the answer's, so it never invites a rejected move */
          var safe = !(a.sol && a.solIdx > 0) && (dangerView(a) || { attacked: [] }).attacked.some(function (x) { return x.sq === due.from; });
          if (safe) {
            var outs = legalMoves(a.st).filter(function (x) { if (x.from !== due.from) return false; var af2 = cloneState(a.st); applyMove(af2, x); return !(dzSee(af2.b, x.to, !myPov(a.it)) > 0); });
            safe = outs.length === 1 && moveUci(outs[0]) === moveUci(due);
          }
          if (d.row1 !== (hintMax(a) === 3 ? 'Hint 2 of 3' : 'Hint 2 of 2') || d.row2 !== (safe ? 'Find a safe square.' : 'Move the circled piece.')) out.push(what + ': hint 2 reads ' + d.row1 + ' / ' + d.row2);
          n.safe = (n.safe || 0) + (safe ? 1 : 0);
          return;
        }
        if (d.row1 !== (hintMax(a) === 3 ? 'Hint 1 of 3' : 'Hint 1 of 2')) out.push(what + ': hint 1 reads ' + d.row1);
        /* hint 1 never touches the answer's to-square (both arrow ends), nor its from-square but for the
           danger's red ring on the player's own attacked piece and its attackers' arrows into it (F1.1:
           what is attacked is the lesson, where it goes is the answer) */
        var ownRing = hm.rings.some(function (m) { return m.kind === 'attacked' && m.sq === due.from; });
        if (sqs.indexOf(due.to) >= 0 || hm.rings.some(function (m) { return m.sq === due.from && m.kind !== 'attacked'; })
          || hm.arrows.some(function (m) { return m.from === due.from || (m.to === due.from && !ownRing); })) out.push(what + ': hint 1 marks the answer ' + JSON.stringify(hm));
        if (a.sol && a.solIdx > 0) {
          n.mid++;
          var mine = checkersOf(a.st).length > 0 && !!a.st.w === myPov(a.it);
          if (sqs.length) out.push(what + ': an in-line hint 1 draws ' + JSON.stringify(hm));
          /* (V2.1: "forcing" only where the move due takes, checks or promotes) */
          var dx = cloneState(a.st); applyMove(dx, due);
          var forcing = !!(a.st.b[due.to] || due.ep >= 0 || due.promo || checkersOf(dx).length);
          if (d.row2 !== (mine ? 'Your king is in check.' : forcing ? 'The next move is forcing too.' : 'Find the next move.')) out.push(what + ': an in-line hint 1 reads ' + d.row2);
          return;
        }
        var fam = familyOf(patternOf(a.it.b)).key, c = a.cls, th = threatOf(c.gameLine, 1);
        prizeWord(what, a, d.row2); h.cands.forEach(function (x) { prizeWord(what + ' (ladder)', a, x); });
        /* the danger hint (F1.1): its own words, true on the board shown */
        if (hm.dz || hm.rep) { dangerTrue(what, a, d, h, hm); return; }
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
            if (d.row2 !== named(a, a.pre, a.played, function (x) { return 'See what ' + x + ' runs into.'; }, 40, 'See what your move runs into.')) out.push(what + ': a danger reads ' + d.row2);
          } else n.dropped++;
        } else if (sqs.length) out.push(what + ': marks with no losing capture or check to show ' + JSON.stringify(hm));
        if (!sqs.length) {
          /* "runs into" only beside its marks; then the card's check line in its row-2 form (F2.3: a
             winning position, a quiet one, a safety or king card with nothing to win), or what the
             answer gets */
          if (/runs into/.test(d.row2)) out.push(what + ': says runs into with nothing drawn');
          var look = checkRow(a);
          n.look = (n.look || 0) + (look.indexOf(d.row2) >= 0 ? 1 : 0);
          if (h.fall !== look[0]) out.push(what + ': the fallback reads ' + h.fall + ', not ' + look[0]);
          if ((fam === 'conversion' || fam === 'quiet') && look.indexOf(d.row2) < 0) out.push(what + ': a ' + fam + ' card reads ' + d.row2 + ', not its check line');
          if (fam === 'safety' || fam === 'king') {
            n.plain++;
            var get = c.mateFor ? 'There is a checkmate here.' : null;
            /* (V2.4's rule: a win only where it leaves the player better, 60% or more) */
            var better = !(a.it.b.eb != null && winPct(a.it.b.eb) < 60);
            if (!(d.row2 === get || /^You can win .+ here\\.$/.test(d.row2) && c.matBest >= 1 && !c.mateFor && better || look.indexOf(d.row2) >= 0 && !c.mateFor && !(c.matBest >= 1 && c.bestLine && !c.bestLine.unsettled && better))) out.push(what + ': a ' + fam + ' card with nothing drawn reads ' + d.row2);
          }
        }
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key;
          [1, 2, 3].forEach(function (h) {
            var a = openCard(it);
            if (!a || (h === 3 && hintMax(a) < 3)) return;
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
        /* the fork form (reached only when the best line is missing) in plain words at tiers 1 and 2 (in
           check, the check is the hint: the coach's review) */
        if (fam === 'chances' && !c.mateFor && !checkersOf(a.pre).length) {
          /* (the line missing: the stored one too, which V2.3's missed win reads) */
          var keepF = [c.bestLine, c.missed, a.it.b.lu];
          c.bestLine = null; c.missed = { fork: { ply: 1 } }; a.it.b.lu = '';
          try {
            var fr = hintText(a);
            fx.fork++;
            if (fr.row2 !== 'One piece can hit two targets.' && fr.row2 !== 'You can win material here.') out.push(at + ': the fork form reads ' + fr.row2);
            [1, 2].forEach(function (tr) { [fr.row2].concat(fr.cands).forEach(function (x) { var bad = unplain(x, tr); if (bad) out.push(at + ': "' + bad + '" at tier ' + tr + ': ' + x); }); });
          } finally { c.bestLine = keepF[0]; c.missed = keepF[1]; a.it.b.lu = keepF[2]; }
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
    /* (V2.3: a missed win's hint 1 rings the piece its line wins, in place of the prize ring, the loose piece
       and "You can win X here.", which with V2.4's rule comes only where the win leaves the player better) */
    ok(r.n.frames > 600 && r.n.danger >= 15 && r.n.harmless >= 3 && r.n.look >= 10 && r.n.prize + (r.n['dz win'] || 0) >= 6 && r.n.words + (r.n['dz win'] || 0) >= 20 && r.n.mid > 30 && r.n.ring2 > 300 && r.n.ring3 >= 10 && r.n.plain2 > 4 * r.n.frames
      && r.n.dz > 40 && r.n['dz attacked'] >= 15 && r.n['dz made'] >= 15 && r.n['dz madeMate'] >= 6 && (r.n['dz loose'] || 0) + (r.n['dz win'] || 0) >= 3 && r.n['dz win'] >= 10 && r.n['dz lost'] >= 10 && r.n['dz check'] >= 3 && r.n.safe >= 3, JSON.stringify(r.n));
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
            var dm = a.solIdx < a.sol.length ? uciToMove(a.st, a.sol[a.solIdx]) : null, dx2 = cloneState(a.st);
            if (dm) applyMove(dx2, dm);
            var forcing2 = !!dm && !!(a.st.b[dm.to] || dm.ep >= 0 || dm.promo || checkersOf(dx2).length);
            var d = displayFor(a), want = checked ? 'Your king is in check.' : forcing2 ? 'The next move is forcing too.' : 'Find the next move.';
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

  await test('tier 1 says moves in words where the row has room: "rook to g1", "pawn takes on d3", "castling" (its side where both are legal: V2.1), "rook from a8 to d8" where two can go there, "pawn to a8 to make a queen", one word against the caps; the task, the hint, the reason, R4, the answer and the story in words, tiers 2 and 3 in SAN', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      ${WORDS}
      var mw = function (fen, uci) { var st = stateFromFen(fen); return moveWords(st, uciToMove(st, uci)); };
      var one = {
        castle: mw('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), long: mw('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), only: mw('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'),
        takes: mw('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'a1a8'), ep: mw('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'),
        promo: mw('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q'), twin: mw('R6R/8/8/8/8/8/8/4K2k w - - 0 1', 'a8d8'),
        lone: mw('R7/8/8/8/8/8/8/4K2k w - - 0 1', 'a8d8'), pawns: mw('4k3/8/8/3p4/2P1P3/8/8/4K3 w - - 0 1', 'c4d5'),
        units: wordsIn('Find a better move than rook from a8 to d8.') + ' ' + fitsRow('Find a better move than rook to d8.', 'row2')
      };
      var out = [], n = { t2: 0, r4: 0, m3: 0, hint: 0, v1: 0, cap: 0 };
      var moved = function (what, s, tier) {
        if (unit(s) === s) return 0;
        if (tier > 1) out.push(what + ': a move in words at tier ' + tier + ': ' + s);
        return 1;
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key, a = openCard(it);
          if (!a) return;
          var d = displayFor(a), t2w = 'Find a better move than ' + wordsOf(a.pre, a.played) + '.';
          /* the task: in words exactly where they fit row 2 */
          if ((d.row2 === t2w) !== (tier === 1 && fitsRow(t2w, 'row2'))) out.push(at + ': the task reads ' + d.row2);
          n.t2 += moved(at + ' T2', d.row2, tier);
          a.hints = 1; a.hintAfter = true; n.hint += moved(at + ' hint 1', displayFor(a).row2, tier);
          a = openCard(it); gradeMove(uciToMove(a.st, a.playedUci)); a.reason = 2; n.m3 += moved(at + ' M2', displayFor(a).row2, tier);
          a = openCard(it); reveal(); n.v1 += moved(at + ' V1', displayFor(a).row1, tier);
          a.view = { mode: 's0' }; a.settle = 2; n.r4 += moved(at + ' R4', displayFor(a).row2, tier);
          buildStory(a).steps.forEach(function (x, i) { n.cap += moved(at + ' step ' + i, x.cap, tier); });
        });
      });
      return JSON.stringify({ one: one, out: out, n: n }); })()`));
    /* V2.1: "castling" only where one castling is legal, else its side */
    eq(JSON.stringify(r.one), JSON.stringify({ castle: 'castling on the king\'s side', long: 'castling on the queen\'s side', only: 'castling', takes: 'rook takes on a8', ep: 'pawn takes on d6', promo: 'pawn to a8 to make a queen',
      twin: 'rook from a8 to d8', lone: 'rook to d8', pawns: 'pawn from c4 takes on d5', units: '6 true' }), 'moves in words');
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
    ok(r.n.t2 > 40 && r.n.hint > 10 && r.n.m3 > 20 && r.n.v1 > 50 && r.n.r4 > 40 && r.n.cap > 250, JSON.stringify(r.n));
  });

  await test('S1 to S8, S10, S11 and the answered frame fit 26 / 40 / 60 characters and 15 words at every tier, the board\'s label included, in plain words', () => {
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
       says "material", which names nothing, and a net word ("the queen")
       would claim one piece: the reason names what their one reply took
       (F1.2), and the loss is said in the board's pieces, read from the
       line's own captures, never a word that claims what it did not take */
    /* (V2.2: the try's line read from the position it is played on, its
       first capture named as its event; a loss of several kinds of piece in
       the board's pieces) */
    eq(A.ev(`(function () { ${OPEN} playerTier = function () { return 2; };
      var it = allMistakes().filter(trainable).filter(function (x) { return myPov(x); })[0], a = openCard(it), cw = captureWord, keep = a.st;
      captureWord = function () { return 'material'; };
      var st = stateFromFen('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1'), line = buildLine(st, 'd1d4', ['d5d4', 'e1e2'], false);
      a.st = st;
      try { return plainCapture({ nodes: [] }, 1, 0) + ' / ' + missWhy(a, { lossG: 9, lossAt: 1, gameLine: line }, 1, null, false, null, { pv: ['d1d4', 'd5d4', 'e1e2'], wBest: 50 }).cands.join(' / ') + ' / ' + lostWords(a, ['B', 'Q', 'R']); } finally { captureWord = cw; a.st = keep; } })()`),
    "null / Their queen takes your queen. / \u2655\u2656\u2657", 'three kinds of piece: the reply named, the loss in pieces');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      /* the band's caps: row 1 26 characters, row 2 40 and 7
         words, a caption 60 and 8; the chip one short label */
      var out = [], frames = 0, seen = {}, plainSeen = 0, labelled = {}, wordsT2 = 0, k1w = 0;
      ${PLAIN}
      ${WORDS}
      /* a move in words counts as one word, as its SAN does */
      /* the piece ledger's symbols are no words and take two characters each (F1.2, F1.4) */
      var cap = function (what, s, ch, words) {
        s = String(s || '');
        var ln = s.length + (s.match(/[\\u2654-\\u265f]/g) || []).length, toks = unit(s).split(/\\s+/).filter(function (t) { return !/^[\\u2654-\\u265f.,]+$/.test(t); });
        if (ln > ch || (s && toks.length > words) || /\u2014/.test(s)) out.push(what + ' (' + ln + '): ' + s);
      };
      /* principle 5: 15 words before the next tap, the band and the bar
         together (glyphs such as the arrows are not words) */
      var words = function (s) { return unit(s).split(/\\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length; };
      var band = function (what, a) {
        var d = displayFor(a);
        frames++;
        seen[what] = (seen[what] || 0) + 1;
        cap(what + ', row 1', d.row1, 26, 99); cap(what + ', row 2', d.row2, 40, 7); cap(what + ', caption', d.cap, 60, 8); cap(what + ', chip', d.chip, 14, 3);
        /* the tag row's context line (F4.2): its own cap of 22 characters, the opponent's name one word */
        cap(what + ', tag', d.tag, 22, 3);
        /* and in plain words, the explore panel aside (S14) */
        if (!a.explore) [d.row1, d.row2, d.cap, d.chip, d.tag, d.strip].concat(d.buttons.map(function (b) { return b.label; })).forEach(function (x) {
          var bad = unplain(String(x || '').replace(/<[^>]*>/g, ' '), a.tier);
          if (bad) out.push(what + ': "' + bad + '" on the card face at tier ' + a.tier + ': ' + x);
          plainSeen++;
        });
        if (!d.cap && !d.row1) out.push(what + ': no row 1');
        /* the strip counts too (its typed-move field is off screen until it
           has the keyboard): empty before an answer, Details once settled */
        var strip = String(d.strip || '').replace(/<label class="kb-move">[\\s\\S]*?<\\/label>/g, '').replace(/<[^>]*>/g, ' ');
        var n = [d.row1, d.row2, d.chip, d.tag, d.cap, strip].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (x, y) { return x + words(y); }, 0);
        if (n > 15) out.push(what + ': ' + n + ' words, ' + [d.row1, d.row2, d.chip, d.tag, strip.trim()].join(' / ') + ' | ' + d.buttons.map(function (b) { return b.label; }).join(' | '));
        /* the board's label counts too (principle 5), as a first-sight
           label or a short one, on a phone's board and the desktop's; it is
           the first word to go, so the band never shrinks for it */
        if (!a.explore) [false, true].forEach(function (sn) {
          [[384, false], [720, true]].forEach(function (sz) {
            var lb = frameLabel(a, boardOptsFor(a), sz[0], sz[1], function () { return sn; });
            if (!lb) return;
            labelled[lb.tip ? 'tip' : 'short'] = (labelled[lb.tip ? 'tip' : 'short'] || 0) + 1;
            if (n + words(lb.text) > 15) out.push(what + ': ' + (n + words(lb.text)) + ' words with the label "' + lb.text + '"');
            var badL = unplain(lb.text, a.tier);
            if (badL) out.push(what + ': the label "' + lb.text + '" at tier ' + a.tier);
          });
        });
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
      /* R4 and F1.4: what the better move saves (or keeps), what it guards, a trade in the board's pieces, a
         plan card's loss, where your game left it ("In your game, Nc5 left White better."), tier 3's figures,
         tier 1 without SAN; never "on top" (content's review of slice 1) */
      /* V1.2 adds the found band's and works too's forms, V1.4 a forced mate's, V1.6 a line's later miss */
      var R4 = /^(\\S+ is guarded\\. |\\S+ wins (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\. )?\\S+ (lost|could lose) (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.$|^\\S+ (is guarded|wins (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?))\\.$|^\\S+ allowed checkmate\\.( They missed it\\.)?$|^\\S+ wins (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\. \\S+ missed it\\.$|^\\S+ leads to checkmate\\.$|^\\S+ allowed (a draw|endless checks)\\.$|^(In your game, \\S+|\\S+|Your game move) left (you still better|the game even|(White|Black) (better|winning))\\.$|^(\\S+|Your game move) was a mistake\\.$|^Your game move (lost|could lose) (?:(?:a|an|the|two|three) [a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.$|^\\S+ (saves|keeps) your (?:pawn|knight|bishop|rook|queen)( and (?:pawn|knight|bishop|rook|queen))?\\.( \\S+ (lost|could lose) (it|them)\\.)?$|^\\S+ guards [a-h][1-8] and your (?:pawn|knight|bishop|rook|queen)\\.$|^(Only move|Best): \\S+ \\d+%\\. Next best \\d+%\\.$|^\\S+ \\d+%\\. Your \\S+ \\d+%\\.$|^The main move was \\S+\\.$|^\\S+ is as good as \\S+\\.$|^Just as good as the main answer\\.$|^(Only move: )?\\S+ forces (mate|checkmate)\\.$|^First move found, a later one missed\\.$|^\\S+ found\\. \\S+ missed later\\.$/;
      /* a word for a tap that is not a move, shown as the page shows it */
      var note = function (a, id) { a.note = { id: id, key: cardStateKey(a), seq: 0 }; return a; };
      /* a miss's reason (M3), in one of its forms or its fallbacks, in plain
         words ("the exchange" is spelled out as the rook and what it went for) */
      var plain = function (what, s) { if (/exchange/.test(s)) out.push(what + ' says ' + s); };
      /* F1.2: their one reply named (tier 3 its SAN), a trade in the board's pieces, a danger left standing
         ("Qxc4, and your queen is still attacked."), where the game stands now, tier 1's plain words */
      var M3 = /^(Then \\S+ is checkmate\\.|(White|Black) could checkmate you\\.|You'd lose (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.|After \\S+, you'd lose (?:(?:a|an|the|two|three) [a-z ]+|material|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.|Their (?:pawn|knight|bishop|rook|queen|king) takes your (?:pawn|knight|bishop|rook|queen)\\.|\\S+ takes your (?:pawn|knight|bishop|rook|queen)\\.|Most of your advantage is gone\\.|You are still better, but less so\\.|After \\S+, (the game is even|(White|Black) is (better|winning))\\.|Now (the game is even|(White|Black) is (better|winning))\\.|(\\S+, and y|Y)our (?:pawn|knight|bishop|rook|queen) is still attacked\\.|That helps (White|Black)\\.|There's a stronger move here\\.|Then (?:their (?:pawn|knight|bishop|rook|queen|king)|\\S+) takes your (?:pawn|knight|bishop|rook|queen)\\.|Then \\S+ forces mate\\.|Then they can force checkmate\\.|Then \\S+: their pawn becomes a (?:queen|rook|bishop|knight)\\.|Their pawn will become a (?:queen|rook|bishop|knight)\\.|After \\S+ \\S+, \\S+ (?:forks|is mate)\\.|Then (?:their (?:pawn|knight|bishop|rook|queen|king)|\\S+) forks (?:both (?:pawn|knight|bishop|rook|queen|king)s|(?:pawn|knight|bishop|rook|queen|king) and (?:pawn|knight|bishop|rook|queen|king))\\.|Safe, but (?:then .+|their pawn will become a (?:queen|rook|bishop|knight)\\.|only \\d+% for you\\.|(?:the game is even|(?:White|Black) is (?:better|winning)) now\\.|there's a stronger move\\.)|After \\S+, you are still better\\.)$/;
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
          /* S1: the task, in its own words */
          var d = band(at + ' open', a), want = named(a, a.pre, a.played, function (x) { return 'Find a better move than ' + x + '.'; }, 40, 'Find a better move.');
          if (tier === 1 && want !== 'Find a better move than ' + sanOf(a.pre, a.played) + '.') wordsT2++;
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
            /* K1 names the move in words at tier 1 where row 1 has room (round D), else in SAN */
            var k1Words = 'Checking ' + moveWords(a.st, off0) + '…', k1 = tier === 1 ? (k1Words.length <= 26 ? k1Words : 'Checking your move…') : 'Checking ' + sanOf(a.st, off0) + '…';
            if (d.row1 !== k1 || d.row2 || !d.sweep || labs(d) !== 'Take back | Show the answer') out.push(at + ' K1 reads ' + d.row1 + ' / ' + d.row2 + ' | ' + labs(d));
            if (tier === 1 && d.row1 === k1Words) k1w++;
            d = band(at + ' checking, 300 ms, T4', note(a, 'T4'));
            if (!/^Checking /.test(d.row1) || d.row2 !== t4 || !d.sweep) out.push(at + ' T4 while checking reads ' + d.row1 + ' / ' + d.row2);
            a.note = null;
            a.checkSaid = 2; d = band(at + ' checking, 3 s', a);
            if (d.row2 !== 'Still checking.') out.push(at + ' K2 reads ' + d.row2);
            takeBack();
            /* S5: a good move that is not the best; the second time the same (V2.7: it keeps its row 2) */
            a = openCard(it); showTry(a, off0, 'close', null, null, false); d = band(at + ' close', a);
            if (d.row1 + ' / ' + d.row2 !== 'Good move / There\\'s a stronger one.' || d.disc !== 'close') out.push(at + ' close reads ' + d.row1 + ' / ' + d.row2);
            d = band(at + ' close, T4', note(a, 'T4'));
            a = openCard(it); showTry(a, off0, 'close', null, null, true); d = band(at + ' close again', a);
            if (d.row1 + ' / ' + d.row2 !== 'Good move / There\\'s a stronger one.') out.push(at + ' close again reads ' + d.row1 + ' / ' + d.row2);
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
            if (/does not work|Nothing lost/.test(d.row2) || !M3.test(unit(d.row2)) || d.row1 !== 'Not this one') out.push(at + ' a miss outside a line reads ' + d.row1 + ' / ' + d.row2);
            d = band(at + ' a miss, T4', note(a, 'T4'));
            if (d.row2 !== t4) out.push(at + ' a miss T4 reads ' + d.row2);
            /* the same try answered with the card's stored refutation, as
               the engine stub answers it: M3 in every form the fixture gives */
            var ru0 = unpackUci(it.b.ru), aft0 = cloneState(a.st);
            a = openCard(it); applyMove(aft0, off0);
            if (ru0.length && playUci(aft0, ru0).uci.length === ru0.length) {
              miss(off0, moveUci(off0), { cp: it.b.ea != null ? it.b.ea : cpFromWin(it.b.wa), mate: it.b.ma, pv: [moveUci(off0)].concat(ru0), win: it.b.wa }, false);
              a.reason = 2; d = band(at + ' a miss with a reply', a);
              if (!M3.test(unit(d.row2))) out.push(at + ' a miss with a reply reads ' + d.row1 + ' / ' + d.row2);
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
            if (d.kind !== 'hint' || !/^Hint ([12] of 2|[123] of 3)$/.test(d.row1) || !d.row2) out.push(what + ' reads ' + d.kind + ': ' + d.row1 + ' / ' + d.row2);
            band(what + ', T4', note(a, 'T4')); a.note = null;
          };
          a.hints = 1; hintBand(at + ' hint 1', a); a.hints = 2; hintBand(at + ' hint 2', a);
          /* Hint 3 where it follows (F9.2) */
          if (hintMax(a) === 3) { a.hints = 3; hintBand(at + ' hint 3', a); }
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
             motion "Their reply" alone on the right), the telegraph, their
             reply landed, then "Your move" with F4; at most 13 words */
          if (a.sol) [0, 1, 2].forEach(function (hn) {
            /* and after hints (taken at an earlier move: the line's own
               frames keep the hint bar), where F4 drops "as expected" beside
               [No more hints] [Show the answer] to stay within 13 */
            a = openCard(it);
            a.hints = hn;
            var F4 = /^(White|Black) (took your (pawn|knight|bishop|rook|queen)|gives check|played [^ ,]+)(, as expected)?\.$/;
            var w13 = function (what, d) { var n = wordsIn(d.row1) + wordsIn(d.row2) + barWords(d.buttons); if (n > 13) out.push(what + ': ' + n + ' words, ' + d.row1 + ' / ' + d.row2 + ' | ' + d.buttons.map(function (x) { return x.label; }).join(' | ')); };
            var hl = hn >= 2 ? 'No more hints' : hn ? 'Hint 2' : 'Hint', hw = hn ? ', hints ' + hn : '';
            for (var fk = 0; fk < a.sol.length - 1; fk += 2) {
              var fat = at + ' forcing move ' + (fk / 2 + 1) + hw, frp;
              /* at tier 3 the first move found asks for their best reply first (F10.1):
                 "Right" / "Now their best reply?" beside [Their reply], which skips it */
              var asks = tier >= 3 && fk === 0;
              if (asks) SF.state = 'ready';
              gradeMove(uciToMove(a.st, a.sol[fk]));
              if (!(frp = a.reply)) { out.push(fat + ': no reply, ' + a.phase); break; }
              if (!!frp.ask !== asks) out.push(fat + ': asks for their reply: ' + !!frp.ask);
              d = band(fat + ', right', a); w13(fat + ', right', d);
              if (d.row1 !== 'Right' || d.row2 !== (asks ? 'Now their best reply?' : sidesOf(a).opp + ' replies next.') || d.buttons.map(function (x) { return x.label + (x.off ? ' (off)' : ''); }).join(' | ') !== (asks ? ' (off) | Their reply' : hl + ' (off) | Show the answer (off)'))
                out.push(fat + ' reads ' + d.row1 + ' / ' + d.row2 + ' | ' + JSON.stringify(d.buttons));
              ui.reducedTest = true; d = band(fat + ', right, reduced motion', a); w13(fat + ', right, reduced motion', d); ui.reducedTest = false;
              if (d.buttons.map(function (x) { return x.label + (x.off ? ' (off)' : ''); }).join(' | ') !== ' (off) | Their reply') out.push(fat + ' under reduced motion offers ' + JSON.stringify(d.buttons));
              frp.tele = true; d = band(fat + ', the telegraph', a); w13(fat + ', the telegraph', d);
              theirReply(a, false); d = band(fat + ', landed', a); w13(fat + ', landed', d);
              if (d.row1 !== 'Right') out.push(fat + ': the words changed as their reply landed: ' + d.row1);
              replyDone(a, frp); d = band(fat + ', your move', a); w13(fat + ', your move', d);
              if (d.row1 !== 'Your move' || !F4.test(d.row2)) out.push(fat + ' then reads ' + d.row1 + ' / ' + d.row2);
              /* the full form whenever it fits beside the bar; the short one only after two hints */
              var full = a.replySaid[0], fits = wordsIn(full) <= 13 - 2 - barWords(d.buttons);
              if ((d.row2 === full) !== fits || (hn < 2 && !fits)) out.push(fat + ': F4 reads ' + d.row2 + ' (full: ' + full + ', fits ' + fits + ')');
              if (!fits) seen['forcing, F4 short'] = (seen['forcing, F4 short'] || 0) + 1;
            }
          });
          a = openCard(it);
          /* the game move again: M2, then its reason (M3 from the card's own
             refutation, or on a missed-chance card that there is more) */
          gradeMove(uciToMove(a.st, a.playedUci)); d = band(at + ' game move again', a);
          if (d.row1 !== 'Your game move again' || d.row2) out.push(at + ' game move again reads ' + d.row1 + ' / ' + d.row2);
          a.reason = 2; d = band(at + ' game move again, its reason', a);
          plain(at + ' game move again', a.verdict.cands.join(' | '));
          if (!M3.test(unit(d.row2)) && !(d.row2 === '' && !M3.test(unit(a.verdict.row2)))) out.push(at + ' game move again, its reason reads ' + d.row2 + ' (' + a.verdict.row2 + ')');
          lossFall(at + ' game move again', a, d.row2);
          /* (V2.2: unless its line has a decisive event, said as any wrong try's) */
          if (familyOf(patternOf(it.b)).key === 'chances' && a.verdict.row2 !== 'There\\'s a stronger move here.' && !/^(Then .+|Their (?:pawn|knight|bishop|rook|queen|king) takes your .+|\\S+ takes your .+|Their pawn will become a .+|After \\S+ \\S+, \\S+ (?:forks|is mate)\\.)$/.test(unit(a.verdict.row2))) out.push(at + ' a missed chance\\'s game move reads ' + a.verdict.row2);
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
            if (d.row1 !== r1 || !R4.test(unit(d.row2))) out.push(what + ' settled reads ' + d.row1 + ' / ' + d.row2);
            plain(what + ', R4', r4Of(a).cands.join(' | '));
            if (!/data-act="details"/.test(d.strip)) out.push(what + ': no Details once settled');
            /* the strip's Details is a word of the budget: row 2 has that much less room */
            var room = 15 - words(d.row1) - d.buttons.reduce(function (x, b) { return x + words(b.label); }, 0) - 1;
            if (rowRoom(a, { row1: d.row1, chip: '' }) !== room) out.push(what + ': row 2 has ' + rowRoom(a, { row1: d.row1, chip: '' }) + ' words of room, not ' + room);
            if (!/^See why \| (Continue|Finish)$/.test(d.buttons.map(function (b) { return b.label; }).join(' | '))) out.push(what + ' settled bar ' + d.buttons.map(function (b) { return b.label; }).join(' | '));
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
              if (!d.cap || d.row1 || d.row2 || d.disc !== (si < S.g ? 'king' : a.revealed ? 'info' : 'good') || d.kind !== (si < S.g ? 'sgame' : 'sbetter')) out.push(what + ', story step ' + si + ': ' + JSON.stringify([d.cap, d.row1, d.disc, d.kind]));
              var want = '‹ | Next move ›' + (last ? ' (off)' : '') + ' | ';
              if (bl.indexOf(want) !== 0 || !/^(Continue|Finish)$/.test(bl.slice(want.length))) out.push(what + ', story step ' + si + ' bar ' + bl);
              var sw = words(String(d.strip).replace(/<[^>]*>/g, ' '));
              if (sw !== (S.steps.length > 9 ? 3 : 2)) out.push(what + ', story step ' + si + ' strip ' + d.strip);
              if (!/^Step \\d+ of \\d+, (your game|the better move|your move|what they could have played|before your game move)\\. /.test(d.live) || d.live.indexOf(ledgerSay(d.cap)) < 0) out.push(what + ', story step ' + si + ' live ' + d.live);
              /* the move they could have played is never called your game (fresh-eyes T4) */
              if (/could have played/.test(d.live) !== !!(S.could && si === S.g - 1)) out.push(what + ', story step ' + si + ' live ' + d.live + ' for a ' + (S.could ? 'could' : 'real') + ' step');
              tapNote(a, 'N1', 2500, null); d = band(what + ', story step, N1', a);
              var withN1 = /To try moves, open Details\\./.test(d.strip);
              if (withN1 !== (words(d.cap) + 5 + 3 <= 15)) out.push(what + ', story step ' + si + ': N1 ' + (withN1 ? 'over the budget' : 'missing') + ', ' + d.cap);
            }
            a.note = null;
          };
          a = openCard(it); reveal(); d = band(at + ' shown', a);
          var v1 = named(a, a.pre, a.best, function (x) { return 'The answer: ' + x; }, 26, 'Here is the answer');
          if (d.row1 !== v1 || d.row2 !== 'Play the green arrow.' || d.disc !== 'info') out.push(at + ' shown reads ' + d.row1 + ' / ' + d.row2);
          d = band(at + ' shown, N1', note(a, 'N1'));
          if (d.row2 !== 'To try moves, open Details.') out.push(at + ' N1 reads ' + d.row2);
          a.note = null;
          /* V2.7: "Play the green arrow." leaves with the arrow */
          if (!a.sol) { playIt(false); d = band(at + ' shown, played', a); if (d.row1 + ' / ' + d.row2 !== v1 + ' / ') out.push(at + ' played reads ' + d.row1 + ' / ' + d.row2); }
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
      return JSON.stringify({ out: out, frames: frames, seen: seen, plain: plainSeen, labelled: labelled, wordsT2: wordsT2, k1w: k1w }); })()`));
    ok(r.wordsT2 > 40, 'tier 1 tasks in words: ' + r.wordsT2);
    ok(r.k1w > 20, 'tier 1 K1 in words: ' + r.k1w);
    ok(r.frames > 6000 && r.plain > 6 * r.frames, 'frames ' + r.frames + ', strings read for plain words ' + r.plain);
    ok(r.labelled.tip > 1000 && r.labelled.short > 1000, 'frames with a label, counted in the words: ' + JSON.stringify(r.labelled));
    eq(r.out.length, 0, r.out.length + ' too long or not plain, first: ' + r.out.slice(0, 3).join(' | '));
    ['K1', 'checking, 3 s', 'close again', 'not checked, T4', 'a miss outside a line', 'a miss with a reply', 'game move again, its reason', 'a miss that loses nothing, in a line', 'shown, N1',
     'shown, played', 'mid-line shown, settled', 'found, settled', 'works too, settled', 'line found, settled', 'story step', 'story step, N1',
     'the automatic hint after Try again', 'Hint pressed over a try', 'Hint pressed over a try, T4', ', hint 2, T4', 'move 2, hint 1',
     'forcing move 1, right', 'forcing move 2, right, reduced motion', 'forcing move 1, the telegraph', 'forcing move 2, your move', 'forcing move 1, hints 2, your move', 'forcing, F4 short'].forEach((k) => ok(Object.keys(r.seen).some((w) => w.indexOf(k.replace('K1', 'checking, 300 ms')) >= 0), 'no ' + k + ' frame'));
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
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${WORDS}
      var out = [], n = { r4: 0, m3: 0, word: 0, trade: 0, guard: 0 };
      /* every material phrase a form says ("lost X", "could lose X", "wins
         X", "You'd lose X"), against what the line took: its own captures
         (plainCapture), or the two words that claim no piece */
      /* (the saves form's "lost it" points back at the piece saved, checked by itself; a trade in the board's pieces is checked against the line's own ledger) */
      var phrases = function (s) { var m, re = /(?:lost|could lose|wins|You'd lose) ([a-z ]+?|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\./g, got = []; while ((m = re.exec(s))) if (m[1] !== 'it' && m[1] !== 'them') got.push(m[1]); return got; };
      /* a loss the line takes partly back at its end (the solver's capture
         there) may be said "X for Y" at that end (fresh-eyes T8) */
      var check = function (what, cands, line, k, from, net) {
        var own = plainCapture(line, k, from), end = line && line.nodes.length - 1, back = end > k && line.nodes[end].captured && isW(line.nodes[end].captured) === line.povWhite;
        var own2 = back && from === 0 ? plainCapture(line, end, 0) : null, ic = line ? ledgerIcons(line, k, from, own) : '', ic2 = back && from === 0 ? ledgerIcons(line, end, 0, own2) : '';
        if (own && / for /.test(own)) n.trade++;
        cands.forEach(function (c) {
          phrases(c).forEach(function (p) {
            n.word++;
            if (/[\\u2654-\\u265f]/.test(p)) { n.ledger = (n.ledger || 0) + 1; if (p === ic || p === ic2) return; }
            else if (p === own || p === own2 || p === 'material' || (p === 'a lot of material' && Math.abs(net) >= 6)) return;
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
            /* tier 1's forms in words read as their SAN twins */
            var up = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }, gw = wordsOf(a.pre, a.played), bw = wordsOf(a.pre, a.best);
            if (tier === 1) cands = cands.map(function (x) { return x.split(up(gw)).join(gameSan(a)).split(gw).join(gameSan(a)).split(up(bw)).join(buildCompare(a).betterSan); });
            n.r4++;
            /* the game move's words against the game line, the better move's against its own */
            var game = cands.map(function (x) { return x.split(/(?<=\\.) /).filter(function (y) { return y.indexOf(buildCompare(a).gameSan + ' ') === 0; }).join(' '); });
            var best = cands.map(function (x) { return x.split(/(?<=\\.) /).filter(function (y) { return y.indexOf(buildCompare(a).betterSan + ' wins') === 0; }).join(' '); });
            check(at + ' R4', game, c.gameLine, c.lossAt, 0, c.lossG);
            check(at + ' R4', best, c.bestLine, c.bSettle, 1, c.matBest);
            /* F1.4: "saves your X" only a piece the game line lost and the best line keeps (the danger facts' sv), never a move that works too */
            cands.forEach(function (x) {
              var sm = /saves your (\\w+)(?: and (\\w+))?\\./.exec(x);
              if (!sm) return;
              n.saves = (n.saves || 0) + 1;
              var sv = dangerView(a).saves, P = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q' }, pov = myPov(it);
              [sm[1], sm[2]].filter(Boolean).forEach(function (w) {
                var t = P[w], keeps = !c.bestLine.nodes.some(function (y, i) { return i >= 1 && y.captured && isW(y.captured) === pov && pType(y.captured) === t; });
                var lost = c.gameLine.nodes.some(function (y) { return y.captured && isW(y.captured) === pov && pType(y.captured) === t; });
                if (sv.indexOf(t) < 0 || !keeps || !lost || a.alt) out.push(at + ': "' + x + '" where the better move does not save the ' + w);
              });
            });
            /* "is guarded" only where the guard rule holds and means it: the
               game move's own piece taken on its square, no king's move */
            if (cands.some(function (x) { return / is guarded\./.test(x); })) {
              n.guard++;
              var bn = c.bestLine.nodes[1], g0 = c.gameLine.nodes[0];
              if (isDefended(g0.after.b, a.played.to) || !isDefended(bn.after.b, bn.move.to) || pType(a.pre.b[a.played.from]) === 'K' || pType(bn.before.b[bn.move.from]) === 'K'
                || !c.gameLine.nodes.slice(1, c.lossAt + 1).some(function (x, i) { return i % 2 === 0 && x.move.to === a.played.to && x.captured && pType(x.captured) === pType(a.pre.b[a.played.from]); }))
                out.push(at + ': "is guarded" where it means nothing: ' + cands.join(' | '));
            } else if (buildCompare(a).w && /safety|king/.test(familyOf(patternOf(it.b)).key) && guardRule(c.gameLine, a.played, c.bestLine.nodes[1]) && guardMeans(c, a.pre, a.played, c.bestLine.nodes[1])) out.push(at + ': the guard holds, no guard form');
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
    ok(r.n.r4 > 400 && r.n.m3 > 150 && r.n.word > 300 && r.n.trade > 50 && r.n.guard >= 6 && r.n.saves > 100 && r.n.ledger > 100, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' untrue material words, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('honest captions (U2): every story caption says only what the ply shown does, true on its own board; a material word is the line\'s own captures, "material", or "a lot of material" worth 6 or more; in plain words', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      ${PLAIN}
      ${WORDS}
      var out = [], n = { caps: 0, sent: 0, forms: {} };
      var PW = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
      var bare = function (s) { return s.replace(/[+#]$/, ''); };
      /* a material phrase against the line's own captures from node f to k, and its net */
      /* "material" only where the line's own phrase is none or a trade (one
         word never claims a piece, and never hides one that can be named) */
      var matOk = function (p, line, k, f, net) {
        var own = plainCapture(line, k, f);
        /* (a trade, or two kinds of piece, in the board's pieces: the line's own ledger, F1.2, F1.4) */
        if (/[\\u2654-\\u265f]/.test(p)) { n.ledger = (n.ledger || 0) + 1; return net >= 1 && p === ledgerIcons(line, k, f, own); }
        return net >= 1 && (p === own || (p === 'material' && (!own || / for /.test(own))) || (p === 'a lot of material' && Math.abs(net) >= 6 && (!own || / and /.test(own))));
      };
      var sides = function (w) { return w ? 'White' : 'Black'; };
      /* tier 1 says moves in words: the caption read back into SAN, each move in words the test's own
         reading of a move this step may name (its line's, the game move, the reply G1 warns of), a capture said by
         its piece ("Their pawn takes", "Pawn takes") only of this step's ply and by its side, the mate's "They play"
         only by its side; what is left is checked as every caption is. No words survive the reading, none at tiers 2, 3 */
      var toSan = function (a, S, s, cap) {
        var nd = s.line.nodes[s.k], byMe = !!nd.byWhite === myPov(a.it), mv = [], t1 = a.cls.gameLine.nodes[1];
        s.line.nodes.concat([{ before: a.pre, move: a.played }, t1 || {}]).forEach(function (x) { if (x.move) mv.push({ w: wordsOf(x.before, x.move), san: bare(sanOf(x.before, x.move)) }); });
        mv.sort(function (x, y) { return y.w.length - x.w.length; });
        mv.forEach(function (x) { cap = cap.split(x.w).join(x.san).split(x.w.charAt(0).toUpperCase() + x.w.slice(1)).join(x.san); });
        if (nd.move) {
          var pw = Object.keys(PW).filter(function (w) { return PW[w] === pType(nd.before.b[nd.move.from]); })[0];
          var subj = new RegExp('^(?:' + (byMe ? 'Your ' : 'Their ') + pw + '|' + pw.charAt(0).toUpperCase() + pw.slice(1) + ')(?= (?:takes|could take|could give|still takes|forks) )');
          cap = cap.replace(subj, bare(sanOf(nd.before, nd.move)));
        }
        var m = /^(You|They) play (\\S+)\\. Checkmate\\./.exec(cap);
        if (m && (m[1] === 'You') === byMe && isMate(nd.after)) cap = cap.replace(/^(You|They) play /, '');
        return cap;
      };
      /* See why's danger frame (F1.5): the first step, the card's own position, one caption true there:
         the counts are the legal takers (were it their move), "After X:" their last move, which made the
         named piece's attack (the attacker moved there, or its line crosses the square it left) */
      var TW = { once: 1, twice: 2, 'three times': 3, 'four times': 4 };
      var checkDanger = function (what, a, S, i) {
        var s = S.steps[i], cap = s.cap, pov = myPov(a.it), ok = false, m, fail = function (x) { out.push(what + ' step ' + i + ' "' + cap + '": ' + x); };
        n.caps++; n.forms.danger = (n.forms.danger || 0) + 1;
        if (i !== 0) fail('the danger frame is not the first step');
        var unpl = unplain(cap, a.tier);
        if (unpl) fail('"' + unpl + '" on the card face');
        var nst = cloneState(a.pre); nst.w = !nst.w; nst.ep = -1;
        var takers = function (sq) { var f = {}; legalMoves(nst).forEach(function (x) { if (x.to === sq) f[x.from] = 1; }); return Object.keys(f).map(Number); };
        var mine = function (w) { var o = []; for (var q = 0; q < 64; q++) { var p = a.pre.b[q]; if (p && isW(p) === pov && pType(p) === PW[w]) o.push(q); } return o; };
        var att = function (w, k) { return mine(w).some(function (q) { return takers(q).length === k; }); };
        var lm = a.preLast, last = (a.it.g.mv.split(' ')[a.it.b.p - 1] || '').replace(/[+#]$/, '');
        var made = function (w) { return !!lm && mine(w).some(function (q) { return takers(q).some(function (f) { return f === lm[1] || strictlyBetween(f, q, lm[0]); }); }); };
        if ((m = /^After (\\S+): (\\w+) attacked (once|twice|three times|four times)(?:, (\\w+) (once|twice|three times|four times))?\\.$/.exec(cap))) ok = m[1] === last && made(m[2]) && att(m[2], TW[m[3]]) && (!m[4] || att(m[4], TW[m[5]]));
        else if ((m = /^After (\\S+): their (\\w+) attacks your (\\w+)\\.$/.exec(cap))) ok = m[1] === last && made(m[3]) && mine(m[3]).some(function (q) { return takers(q).some(function (f) { return pType(a.pre.b[f]) === PW[m[2]]; }); });
        else if ((m = /^Their last move: your (\\w+) is attacked (twice|three times|four times)\\.$/.exec(cap))) ok = a.tier === 1 && made(m[1]) && att(m[1], TW[m[2]]);
        else if ((m = /^Their last move attacks your (\\w+) (twice|three times|four times)\\.$/.exec(cap))) ok = a.tier === 1 && made(m[1]) && att(m[1], TW[m[2]]);
        /* two threats, their mate (the game move stopped it) and the game line's reply (it stood): the coach's review */
        else if (/^Two threats: \\S+ mate and \\S+\\.$|^Two threats: mate on [a-h][1-8] and your \\w+\\.$/.test(cap)) { var tt = twoThreats(a); ok = !!tt && !!tt.mate && !dangerView(a).threat.stands; n.forms.two = (n.forms.two || 0) + 1; }
        /* the game move's piece stood in the way of their mate */
        else if ((m = /^Your (\\w+) on ([a-h][1-8]) blocks their mate\\.$/.exec(cap))) { var bk = mateBlocker(a); ok = !!bk && sqName(bk.sq) === m[2] && pType(bk.p) === PW[m[1]]; n.forms.block = (n.forms.block || 0) + 1; }
        /* V2.7: two pieces of one kind by their squares */
        else if ((m = /^(?:After (\\S+): your|Your) (\\w+)s on ([a-h][1-8]) and ([a-h][1-8]) are attacked\\.$|^Their last move attacks your (\\w+)s on ([a-h][1-8]) and ([a-h][1-8])\\.$/.exec(cap))) {
          var tw2 = m[2] || m[5], twoAt = [m[3] || m[6], m[4] || m[7]].map(sqNum);
          ok = twoAt.every(function (q) { var p = a.pre.b[q]; return !!p && isW(p) === pov && pType(p) === PW[tw2] && takers(q).length >= 1; }) && (!m[1] || (m[1] === last && made(tw2))) && (!m[5] || (a.tier === 1 && made(tw2)));
          n.forms.twoSq = (n.forms.twoSq || 0) + 1;
        }
        else if ((m = /^Their last move attacks your (\\w+)\\.$/.exec(cap))) ok = a.tier === 1 && made(m[1]);
        else if ((m = /^Your (\\w+) is attacked (once|twice|three times|four times), your (\\w+) (once|twice|three times|four times)\\.$/.exec(cap))) ok = att(m[1], TW[m[2]]) && att(m[3], TW[m[4]]);
        else if ((m = /^Your (\\w+) is attacked (twice|three times|four times)\\.$/.exec(cap))) ok = att(m[1], TW[m[2]]);
        else if ((m = /^Your (\\w+) and (\\w+) are attacked\\.$/.exec(cap))) ok = att(m[1], 1) && att(m[2], 1);
        else if ((m = /^Two of your (\\w+)s are attacked\\.$/.exec(cap))) ok = mine(m[1]).filter(function (q) { return takers(q).length === 1; }).length >= 2;
        else if ((m = /^Their (\\w+) attacks your (\\w+)\\.$/.exec(cap))) ok = mine(m[2]).some(function (q) { return takers(q).some(function (f) { return pType(a.pre.b[f]) === PW[m[1]]; }); });
        else if ((m = /^Their (\\w+) on ([a-h][1-8]) has no guard\\.$/.exec(cap))) { var lq = sqNum(m[2]), lp = a.pre.b[lq]; ok = !!lp && isW(lp) !== pov && pType(lp) === PW[m[1]] && !isDefended(a.pre.b, lq) && !!hintPrize(a) && hintPrize(a).sq === lq; }
        else if (/^They threaten mate: \\S+\\.$|^They can mate you on [a-h][1-8]\\.$/.test(cap)) ok = !!dangerView(a).searched && !!dangerView(a).threat && dangerView(a).threat.mate === 1;
        else return fail('an unknown danger caption');
        if (!ok) fail('not true on the card\\'s position');
      };
      var check = function (what, a, S, i) {
        if (S.steps[i].df) return checkDanger(what, a, S, i);
        var s = S.steps[i], line = s.line, nd = line.nodes[s.k], c = a.cls, pov = myPov(a.it), cap = a.tier === 1 ? toSan(a, S, s, s.cap) : s.cap, cmp = buildCompare(a);
        if (unit(cap) !== cap) out.push(what + ' step ' + i + ' "' + s.cap + '": a move in words that is none of this step\\'s, or at tier ' + a.tier);
        if (a.tier === 1 && cap !== s.cap) n.inWords = (n.inWords || 0) + 1;
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
        /* a move is named without its check sign on every rung (the check form says it in words), but
           V2.2's fork, which says no check otherwise ("Qxc3+ forks your king and rook.") */
        if (/[+#]/.test(cap.replace(/^(\\S+)[+#] forks /, '$1 forks '))) fail('a check or mate sign');
        /* the story's end says what the better move saves (F1.4): tier 3's only-move line where it is
           true, "Better: Qe6 saves your queen." on B1, else "Your queen is safe." after the ply (below) */
        var lastStep = !game && i === S.steps.length - 1, m0;
        if (lastStep && !S.alt && cmp.only && cap === cmp.only) { n.forms.only = (n.forms.only || 0) + 1; return; }
        if (firstB && (m0 = /^Better: (\\S+) (?:saves|keeps) your (\\w+)\\.$/.exec(cap))) {
          n.forms.saves = (n.forms.saves || 0) + 1;
          if (m0[1] !== bare(san) || !lastStep || S.alt || cmp.saves.indexOf(PW[m0[2]]) < 0) fail('saves what the better move does not save');
          return;
        }
        if (game && s.k === 0) { if (head !== bare(gameSan(a)) + '.' && cap !== bare(gameSan(a)) + ', your game move.') fail('does not start with the game move ' + gameSan(a)); }
        else if (firstB) {
          if (head !== 'Better: ' + bare(san) + '.' && cap !== 'Your ' + bare(san) + ' works too.') fail('does not name the better move ' + san);
          /* "yours" only for your own move's line, never the engine's best */
          if (/works too/.test(cap) !== !!S.alt || (S.alt && (!a.alt || line === c.bestLine || moveUci(nd.move) !== a.yours.uci[a.yours.at]))) fail('works too on a card that is ' + (a.alt ? '' : 'not ') + 'an alternative');
        }
        else if (cap.indexOf(bare(san)) !== 0 && cap.indexOf('You play ' + bare(san)) !== 0 && cap.indexOf('They play ' + bare(san)) !== 0 && cap.indexOf('They could play ' + bare(san)) !== 0) fail('does not start with its ply ' + san);
        /* a better line never ends on a bare quiet move or check of theirs */
        if (lastB && s.k > s.from && nd.byWhite !== pov && !nd.captured && !isMate(nd.after) && sents.length < 2) fail('the better line ends on a bare move of theirs');
        /* the move they could have played is said as one, never as played (final fixes 2) */
        var couldStep = game && s.k === 1 && !!S.could;
        if (couldStep && !/^(\\S+ could (take|give)|They could play|\\S+ would be checkmate)/.test(cap)) fail('the move they could have played said as played');
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
          if (j === 0 && !firstB && !(game && s.k === 0) && (m = /^(\\S+) takes (your|their) (\\w+)( with check)?(, as in your game)?\\.$/.exec(x))) {
            form = 'takes'; var cp = nd.captured;
            ok = !!cp && pType(cp) === PW[m[3]] && (isW(cp) === pov) === (m[2] === 'your') && (!m[5] || (game && s.k === 1 && found)) && (!m[4] || checkersOf(nd.after).length > 0);
            if (m[4]) n.withCheck = (n.withCheck || 0) + 1;
          } else if (j === 0 && (m = /^(\\S+) could take your (\\w+)( with check)?\\.$/.exec(x))) { form = 'could take'; ok = couldStep && blow && !!nd.captured && isW(nd.captured) === pov && pType(nd.captured) === PW[m[2]] && (!m[3] || checkersOf(nd.after).length > 0); }
          else if (j === 0 && /^\\S+ could give check\\.$/.test(x)) { form = 'could check'; ok = couldStep && blow && !nd.captured && checkersOf(nd.after).length > 0 && !isMate(nd.after); }
          else if (j === 0 && /^\\S+ would be checkmate\\.$/.test(x)) { form = 'could mate'; ok = couldStep && isMate(nd.after); }
          else if (j === 0 && (m = /^They could play (\\S+)\\.$/.exec(x))) { form = 'could play'; ok = couldStep && blow && m[1] === bare(san) && !nd.captured && !checkersOf(nd.after).length; }
          else if (j === 0 && /^\\S+, check\\.$/.test(x)) { form = 'check'; ok = checkersOf(nd.after).length > 0 && !isMate(nd.after); }
          /* V2.2: a fork the ply makes, its targets the other side's pieces it attacks from where it lands */
          else if (j === 0 && (m = /^(\\S+?)[+#]? forks (?:(your|their) (\\w+) and (\\w+)|both (your|their) (\\w+)s)\\.$/.exec(x))) {
            form = 'forks';
            var fw = m[2] || m[5], fa = PW[m[3] || m[6]], fb = PW[m[4] || m[6]], fmine = !!nd.byWhite === pov;
            var hit = attacksFrom(nd.after.b, nd.move.to).map(function (q) { return nd.after.b[q]; }).filter(function (p) { return p && isW(p) !== !!nd.byWhite; }).map(pType);
            ok = m[1] === bare(san) && (fw === 'their') === fmine && hit.indexOf(fa) >= 0 && hit.indexOf(fb) >= 0 && (fa !== fb || hit.filter(function (p) { return p === fa; }).length >= 2);
          }
          /* a quiet check says whose it is */
          else if (j === 0 && (m = /^(You|They) play (\\S+), check\\.$/.exec(x))) { form = 'whose check'; ok = m[2] === bare(san) && (m[1] === 'You') === (!!nd.byWhite === pov) && !nd.captured && checkersOf(nd.after).length > 0 && !isMate(nd.after); }
          else if (j === 0 && /^\\S+$/.test(x.replace(/\\.$/, '')) && sents.length > 1 && /^Checkmate\\.$/.test(sents[1].trim())) { form = 'mate'; ok = isMate(nd.after); }
          else if (/^Checkmate\\.$/.test(x)) { form = 'mate'; ok = isMate(nd.after); }
          else if (j === 0 && x === bare(san) + '.') { form = 'quiet'; }
          /* a quiet move says whose it is (C3), and only of a quiet move */
          else if (j === 0 && (m = /^(You|They) play (\\S+)\\.$/.exec(x))) { form = 'whose'; ok = m[2] === bare(san) && (m[1] === 'You') === (!!nd.byWhite === pov) && !nd.captured && !checkersOf(nd.after).length && !isMate(nd.after); }
          else if (/^As in your game\\.$/.test(x)) { form = 'found'; ok = game && s.k === 1 && found; }
          else if (/^They missed it\\.$/.test(x)) { form = 'missed'; ok = couldStep && blow; if (!nd.captured && !checkersOf(nd.after).length) n.quietMissed = (n.quietMissed || 0) + 1; }
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
          else if ((m = /^It wins ([a-z ]+?|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)(?: on ([a-h][1-8]))?\\.$/.exec(x))) {
            form = 'it wins'; ok = firstB && !a.alt && matOk(m[1], c.bestLine, c.bSettle, 1, c.matBest);
            /* its square: where that one piece of theirs was taken, the only one taken along the line */
            if (m[2]) {
              n.wonSq = (n.wonSq || 0) + 1;
              var tk = c.bestLine.nodes.filter(function (y, k) { return k >= 1 && k <= c.bSettle && y.captured && 'the ' + Object.keys(PW).filter(function (w) { return PW[w] === pType(y.captured); })[0] === m[1]; });
              ok = ok && tk.length === 1 && !!tk[0].pov && sqName(tk[0].move.ep >= 0 ? tk[0].move.ep : tk[0].move.to) === m[2];
            }
          }
          else if (/^It leads to checkmate\\.$/.test(x)) { form = 'leads to mate'; ok = firstB && !!c.mateFor && !!S.mateB && isMate(line.nodes[S.steps[S.steps.length - 1].k].after); }
          else if ((m = /^(\\S+) still (comes|takes your (\\w+))(, but you (win ([a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)|lose nothing))?\\.$/.exec(x)) || (same && /^You lose less\\.$/.test(x))) {
            /* S-same: the copy row's forms, each true of the line where it
               settles against the game's loss; a line that loses as much
               names the capture again */
            form = 'still comes';
            ok = same && (!m || !m[4] || (m[6] ? matOk(m[6], c.bestLine, c.bSettle, 1, c.matBest) : c.matBest === 0 && c.lossG >= 1))
              && (!m || !m[3] || (!!nd.captured && isW(nd.captured) === pov && pType(nd.captured) === PW[m[3]] && !(c.matBest >= 0 && c.lossG >= 1) && !(c.matBest < 0 && -c.matBest < c.lossG)))
              && (!/less/.test(x) || (c.matBest < 0 && -c.matBest < c.lossG));
            if (m && !m[4] && !m[3] && nd.captured) n.sameBare = (n.sameBare || 0) + 1;
          }
          else if (/^Nothing is lost\\.$/.test(x)) {
            /* the better line's last step, standing, nothing lost from its first move, after a game move that lost
               material or allowed a mate, and nothing lost at any later point where the line stands */
            form = 'nothing lost'; var base = matDiff(line.nodes[s.from].before.b, pov);
            ok = lastB && settledAt(line, s.k) && matDiff(b, pov) - base === 0 && (c.lossG >= 1 || !!c.mateAgainst)
              && !line.nodes.some(function (y, k) { return k > s.k && settledAt(line, k) && matDiff(y.after.b, pov) < base; });
          }
          else if (/^You lose less\\.$/.test(x)) { form = 'lose less'; var net = matDiff(b, pov) - matDiff(line.nodes[s.from].before.b, pov); ok = lastB && net < 0 && -net < c.lossG; }
          else if ((m = /^You lose ([a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.$/.exec(x))) { form = 'you lose'; ok = lastG && matOk(m[1], line, s.k, 0, matDiff(line.nodes[0].before.b, pov) - matDiff(b, pov)); }
          else if ((m = /^You win ([a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\.$/.exec(x))) { form = 'you win'; ok = lastB && matOk(m[1], line, s.k, s.from, matDiff(b, pov) - matDiff(line.nodes[s.from].before.b, pov)); }
          /* F1.4: the piece the better move saves, standing at the story's end ("there": the better move moved it) */
          /* the piece the better move saves, left in danger by the game move (the reviews of slice 1) */
          else if ((m = /^Your (\\w+) is still attacked( twice| three times| four times)?\\.$/.exec(x))) { form = 'still attacked'; var sa = stillAfterGame(a); ok = game && s.k === 0 && !!sa && pType(sa.p) === PW[m[1]] && (m[2] ? TW[m[2].trim()] === sa.n : sa.n === 1); }
          else if ((m = /^Your (\\w+) is safe( there)?\\.$/.exec(x))) { form = 'safe'; ok = lastB && !S.alt && cmp.saves.indexOf(PW[m[1]]) >= 0 && b.some(function (p) { return p && isW(p) === pov && pType(p) === PW[m[1]]; }) && (!m[2] || (firstB && pType(nd.before.b[nd.move.from]) === PW[m[1]])); }
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
      && f['it wins'] > 20 && f['you win'] > 10 && r.n.lineWins > 5 && f['still comes'] >= 4 && f.found > 50 && f.missed > 50 && f['could take'] > 10 && f['could play'] > 20 && f.mate > 5 && r.n.withCheck >= 5 && f.whose > 100
      && f['nothing lost'] > 20 && f['whose check'] > 30 && r.n.wonSq > 5 && r.n.inWords > 1000 && f.danger > 50 && f.saves > 30 && f.safe > 20 && r.n.ledger > 50, JSON.stringify(r.n));
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
        var S = buildStory(a), c = a.cls, g2 = S.steps[(S.danger ? 1 : 0) + 1];
        if (S.g > 1 && g2 && / They missed it\\.$/.test(g2.cap) && !c.mateAgainst && c.lossG < 1) quiet.push(it.key + ' ' + g2.cap);
      });
      return JSON.stringify({ q48: caps('184455333378:48'), s46: caps('184216981622:46'), c57: caps('184435538450:57'), c68: caps('184455333378:68'), quiet: quiet }); })()`));
    /* the game segment is the game: a quiet first reply that was not played is not shown (fresh-eyes T4) */
    eq(r.q48[1], 'Better: Kg2.', 'a quiet first reply after a move that lost nothing, not the game\'s');
    eq(r.s46[r.s46.length - 1], 'Rxh2 still takes your knight.', 'S-same where the better line loses the same knight');
    /* (each after See why's danger frame, F1.5) */
    eq(r.c57[0], 'Their knight on f5 has no guard.', 'the danger frame of a missed chance: their loose piece');
    /* (V2.2: the game's line runs on to where it settles, so the loss is said a move later) */
    eq(r.c57[6] + ' | ' + r.c57[7], 'They play Qd5, check. | You play Kh8. You lose the pawn.', 'a checking move, whose it is and without its sign; the loss where the line settles');
    /* a capture that checks says both (fresh-eyes T7), and drops the check before the game's words */
    eq(r.c57[4], 'Qxd6 takes your bishop with check.', 'a capture that checks');
    /* the check is a board fact, "as in your game" context: the check is kept when both do not fit (final fixes 4) */
    eq(r.c68[2], 'cxd3 takes your bishop with check.', 'a capture that checks, its check kept over "as in your game"');
    eq(r.c68[0], 'After fxg6: queen attacked twice, bishop once.', 'the danger frame: their last move made the attacks');
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
      cardEase = function (it) { return asks(it) ? 3 : 2; };
      keys = todayPlan().keys;
      out.easiest = { first: asks(m.byKey[keys[0]]), three: count(keys, asks) };
      /* a card the cheap check flags that asks for one move, made the
         easiest of all, still leads: the head is decided by the card's own rule */
      var flagged = its.filter(function (it) { return looksForcing(it) && !asks(it); });
      out.flagged = flagged.length;
      if (flagged[0]) { cardEase = function (it) { return it === flagged[0] ? 3 : 1; }; out.flaggedLeads = todayPlan().keys[0] === flagged[0].key; }
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
    ok(r.flagged > 0, 'flagged cards that ask for one move: ' + r.flagged); eq(r.flaggedLeads, true, 'a flagged one-move card, the easiest, leads');
    eq(r.tieSkips, 0, 'one-move cards as easy left out for a forcing card');
    eq(r.lostLeads, true, 'the latest loss leads'); ok(r.forcingLostAt < 0 || r.forcingLostAt >= 2, 'a forcing latest loss pulled forward, card ' + (r.forcingLostAt + 1));
  });

  await test('a first session keeps its head when a card drops out before it is shown: card 1 asks for one move, at most one of the first three a forcing line; the set keeps its size, the next new position joining at its end (C1)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 2; };
      SF.state = 'failed';
      var its = allMistakes().filter(trainable), m = model();
      var asks = function (it) { var a = cardFor(it); return !!(a && a.sol); };
      var plain = its.filter(function (it) { return !asks(it); }), forcing = its.filter(asks);
      /* card 1 drops out (the deeper look): a forcing card would move up to lead */
      var keys = [plain[0], forcing[0], forcing[1], plain[1], plain[2]].map(function (x) { return x.key; });
      ui.session = { mode: 'today', label: 'Today', keys: keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {}, firstTime: true };
      plain[0].b.x = 'deep';
      ui.session.active = null; loadCard();
      var ss = ui.session, a = ss.active, res = { lead: a && a.key, sol: !!(a && a.sol), three: ss.keys.slice(0, 3).filter(function (k) { return asks(m.byKey[k]); }).length, n: ss.keys.length,
        joined: keys.indexOf(ss.keys[4]) < 0 && !srsLoad()[ss.keys[4]], gone: ss.keys.indexOf(plain[0].key) < 0 };
      res.want = plain[1].key;
      /* saved and read back with it */
      saveSession(); res.saved = !!savedSession().firstTime;
      /* not a first session: the order is left as it was */
      plain[0].b.x = null;
      ui.session = { mode: 'today', label: 'Today', keys: keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      plain[0].b.x = 'deep'; ui.session.active = null; loadCard();
      res.other = ui.session.active && ui.session.active.key;
      plain[0].b.x = null;
      return JSON.stringify(res); })()`));
    eq(r.lead, r.want, 'the next one-move card leads'); eq(r.sol, false, 'card 1 asks for one move');
    ok(r.three <= 1, r.three + ' forcing in the first three'); eq(r.n, 5, 'the set keeps its size (C1)');
    ok(r.joined && r.gone, 'the card dropped is gone, and a new position joined at the end');
    eq(r.saved, true, 'the session remembers it is a first one');
    ok(r.other && r.other !== r.want, 'a later session keeps its order: ' + r.other);
  });

  await test('a first session keeps its head from its first card: the rule is known as it starts, and a card 1 that asks for a forcing line goes behind a one-move card (slice 14 #5, #6)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 2; };
      SF.state = 'failed';
      var its = allMistakes().filter(trainable), m = model();
      var asks = function (it) { var a = cardFor(it); return !!(a && a.sol); };
      var plain = its.filter(function (it) { return !asks(it); }), forcing = its.filter(asks);
      var res = {}, real = todayPlan;
      /* card 1 drops out at the very first load: the next one-move card leads */
      todayPlan = function () { return { keys: [plain[0], forcing[0], forcing[1], plain[1], plain[2]].map(function (x) { return x.key; }), firstTime: true }; };
      plain[0].b.x = 'deep';
      startToday();
      res.drop = ui.session.active && ui.session.active.key; res.dropWant = plain[1].key; res.first = !!ui.session.firstTime; res.saved = !!(savedSession() || {}).firstTime;
      plain[0].b.x = null;
      /* card 1 asks for a forcing line once built (the deeper look made it one): a one-move card leads */
      todayPlan = function () { return { keys: [forcing[0], plain[1], forcing[1], plain[2]].map(function (x) { return x.key; }), firstTime: true }; };
      startToday();
      var ss = ui.session;
      res.lead = ss.active && ss.active.key; res.leadWant = plain[1].key;
      res.three = ss.keys.slice(0, 3).filter(function (k) { return asks(m.byKey[k]); }).length; res.n = ss.keys.length;
      /* not a first session: left as it was */
      todayPlan = function () { return { keys: [forcing[0], plain[1], forcing[1], plain[2]].map(function (x) { return x.key; }), firstTime: false }; };
      startToday();
      res.later = ui.session.active && ui.session.active.key; res.laterWant = forcing[0].key;
      todayPlan = real;
      return JSON.stringify(res); })()`));
    eq(r.drop, r.dropWant, 'card 1 dropped at the first load: the next one-move card leads');
    eq(r.first, true, 'the session knows it is a first one'); eq(r.saved, true, 'and saved it');
    eq(r.lead, r.leadWant, 'a forcing card 1 goes behind a one-move card'); ok(r.three <= 1, r.three + ' forcing in the first three'); eq(r.n, 4, 'no card lost');
    eq(r.later, r.laterWant, 'a later session keeps its order');
  });

  await test('the cheap forcing check runs once per card and line, as the ease check does', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 2; };
      var n = 0, real = stateAtPly;
      stateAtPly = function () { n++; return real.apply(this, arguments); };
      var it = allMistakes().filter(trainable)[0];
      looksForcing(it); var first = n; looksForcing(it); looksForcing(it);
      var again = n - first;
      playerTier = function () { return 3; }; looksForcing(it);
      stateAtPly = real;
      return JSON.stringify({ first: first, again: again, tier: n - first }); })()`));
    ok(r.first <= 1, 'first call replays at most once'); eq(r.again, 0, 'memoised'); ok(r.tier <= 1, 'a new tier is a new answer');
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

  await test('the manifest and its icons are what they claim: the name, the app opening on Today in its own window, the Night colour of the page (F11.1), a 192 and a 512 icon and a maskable one', () => {
    const root = path.join(__dirname, '..');
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    eq(m.name, 'notlichess', 'name'); eq(m.short_name, 'notlichess', 'short_name'); eq(m.start_url, '/#train', 'start_url'); eq(m.display, 'standalone', 'display');
    eq(m.id, '/', 'id'); eq(m.scope, '/', 'scope');
    const bg = (/--bg:(#[0-9A-Fa-f]{6})/.exec(fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8')) || [])[1];
    const meta = (/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/.exec(fs.readFileSync(path.join(root, 'src', 'page.html'), 'utf8')) || [])[1];
    eq(bg, '#141310', 'the Night ground'); eq(m.background_color, bg, 'background_color'); eq(m.theme_color, bg, 'theme_color'); eq(meta, bg, 'the page\'s theme-color');
    ok(m.icons.some((ic) => ic.sizes === '192x192' && !ic.purpose) && m.icons.some((ic) => ic.sizes === '512x512' && !ic.purpose) && m.icons.some((ic) => ic.purpose === 'maskable'), 'a 192, a 512 and a maskable icon');
    m.icons.forEach((ic) => {
      const b = fs.readFileSync(path.join(root, ic.src.replace(/^\//, '')));
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      eq(w + 'x' + h, ic.sizes, ic.src);
    });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    ok(html.includes('rel="manifest"') && html.includes('apple-touch-icon'), 'linked from the page');
    ok(!html.includes('cdn.jsdelivr.net'), 'no CDN engine');
  });

  /* ── final build round D ── */
  await test('round D, I9: "Not a real mistake" takes the card and its segment out of the session, and its toast\'s Undo puts back the card, its segment and its stored state; after something else happened only the stored state', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 3), res = {}, said = [];
      its.forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
      notice = function (t, act) { said.push([t, act ? act.act + ':' + act.label : '']); };
      var dots = function () { return (sessionBarHtml(ui.session, null).match(/<span class="dot/g) || []).length; };
      var stored = function (k) { var g = store.get(cacheKey(), null), hit = null;
        ((g && g.games) || []).forEach(function (gm) { (gm.bl || []).forEach(function (b) { if (gm.id + ':' + b.p === k) hit = b.x || null; }); }); return hit; };
      startSession('t', its.map(function (x) { return x.key; }), 't');
      var ss = ui.session, k1 = its[0].key, rec0 = JSON.stringify(srsLoad()[k1] || null), b1 = its[0].b, b2 = null;
      res.before = [dots(), ss.active && ss.active.key];
      disputeCard('engine');
      res.gone = [dots(), ss.keys.length, ss.active && ss.active.key, !!b1.x, !!(srsLoad()[k1] || {}).hidden, stored(k1), said[0]];
      undoDispute();
      res.back = [dots(), ss.keys.length, ss.idx, ss.active && ss.active.key, b1.x || null, JSON.stringify(srsLoad()[k1] || null) === rec0, stored(k1)];
      /* an answered card comes back as it was left */
      var a = ss.active; solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      disputeCard('misclick');
      res.answeredGone = [dots(), Object.keys(ss.results).length];
      undoDispute();
      res.answeredBack = [dots(), ss.active === a, a.phase, ss.results[k1]];
      /* something else happened since: the stored state only */
      nextCard();
      var k2 = ss.active.key;
      b2 = ss.active.it.b;
      disputeCard('decided');
      var a3 = ss.active; solved(uciToMove(a3.st, a3.bestUci), a3.bestUci, null); nextCard();
      undoDispute();
      res.later = [ss.keys.indexOf(k2), b2.x || null, !!(srsLoad()[k2] || {}).hidden, said[said.length - 1][0]];
      /* the last card of a session: it finishes, and Undo opens it again on that card, the day as it was */
      startSession('t', [its[1].key], 't');
      var day0 = JSON.stringify(dayLoad());
      disputeCard('engine');
      res.ended = [ui.session ? 'session' : 'none'];
      undoDispute();
      res.reopened = [ui.session && !ui.session.finished, ui.session && ui.session.active && ui.session.active.key, JSON.stringify(dayLoad()) === day0, dots()];
      res.toast = said[0][1];
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.before), JSON.stringify([3, r.before[1]]), 'three segments');
    eq(r.toast, 'undoDispute:Undo', 'the toast carries Undo');
    eq(JSON.stringify(r.gone.slice(0, 6)), JSON.stringify([2, 2, r.gone[2], true, true, 'user:engine']), 'removed: its segment gone, the next card on, hidden and stored');
    ok(r.gone[2] !== r.before[1], 'the next card took its place');
    eq(JSON.stringify(r.back), JSON.stringify([3, 3, 0, r.before[1], null, true, null]), 'undone: the card, its segment and its stored state back');
    eq(JSON.stringify(r.answeredGone), JSON.stringify([2, 0]), 'an answered card removed: its segment and result gone');
    eq(JSON.stringify(r.answeredBack), JSON.stringify([3, true, 'done', r.answeredBack[3]]), 'and back as it was left');
    ok(r.answeredBack[3], 'with its result');
    eq(JSON.stringify(r.later), JSON.stringify([-1, null, false, 'Put back. It comes back in a later session.']), 'after another card: the stored state only');
    eq(JSON.stringify(r.reopened), JSON.stringify([true, r.reopened[1], true, 1]), 'the session it ended opened again on that card, the day as it was');
    ok(r.reopened[1], 'on its card');
  });

  await test('round D, I8: one position opened from the summary goes back to the summary, by × and once done', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 2), res = {};
      its.forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
      notice = function () {};
      var sum = { mode: 'today', label: 't', keys: its.map(function (x) { return x.key; }), idx: 2, results: {}, relearn: [], relearnOf: {}, notes: {}, finished: true };
      sum.results[its[0].key] = 'first'; sum.results[its[1].key] = 'fail';
      ui.session = sum;
      var spec = /data-act="drill" data-spec="([^"]*)"/.exec(doneHtml(sum));
      startDrill(JSON.parse(spec[1].replace(/&quot;/g, '"')));
      res.opened = [ui.session !== sum, ui.session.from === sum, ui.session.keys.length];
      endSession();
      res.x = [ui.session === sum, !!ui.session.finished];
      startDrill({ type: 'one', key: its[1].key, label: 'One position' });
      var a = ui.session.active; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); nextCard();
      res.done = [ui.session === sum, !!ui.session.finished];
      /* from Today, × goes to Today as before */
      ui.session = null;
      startDrill({ type: 'one', key: its[1].key, label: 'One position' });
      res.today = [!!ui.session.from];
      endSession();
      res.today.push(ui.session);
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.opened), '[true,true,1]', 'a one-position session from the summary');
    eq(JSON.stringify(r.x), '[true,true]', '× goes back to the summary');
    eq(JSON.stringify(r.done), '[true,true]', 'done, back to the summary');
    eq(JSON.stringify(r.today), '[false,null]', 'from Today, back to Today');
  });

  await test('round D, C1: the count never seems to grow ("3 of 5 done, 2 to try again."); a card queued says it comes back in a notice (V4.2), never in its own frame, which stays within 15 words', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var its = allMistakes().filter(trainable), k = its.slice(0, 5).map(function (x) { return x.key; }), res = {};
      var s = { keys: k.concat([k[1], k[3]]), idx: 6, results: {}, relearn: [], relearnOf: {} };
      [0, 1, 2].forEach(function (i) { s.results[k[i]] = 'first'; });
      res.mid = countsWords(s);
      s.results[k[1] + '#r'] = 'retry';
      res.one = countsWords(s);
      res.queued = countsWords({ keys: k, idx: 3, results: { a: 1, b: 1, c: 1 }, relearn: [k[0], k[1]], relearnOf: {} });
      res.none = countsWords({ keys: k, idx: 3, results: { a: 1, b: 1, c: 1 }, relearn: [], relearnOf: {} });
      res.resume = (/<p class="why hero-cap">([^<]*)</.exec(resumeHtml(s)) || [])[1];
      /* a card queued: no line in its strip (it would pass 15 words), its frame within them */
      playerTier = function () { return 2; };
      var queued = 0, inStrip = 0, over = 0;
      its.forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        reveal();
        if (a.relearnQueued) queued++;
        var d = displayFor(a), strip = String(d.strip || '').replace(/<[^>]*>/g, ' ');
        if (/comes back/.test(strip)) inStrip++;
        var words = [d.row1, d.row2, d.chip, d.cap, strip].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (n, x) { return n + wordsIn(x); }, 0);
        if (words > 15) over++;
      });
      res.tip = [queued === its.length, inStrip, over];
      return JSON.stringify(res); })()`));
    eq(r.mid, '3 of 5 done, 2 to try again.', 'two coming back');
    eq(r.one, '3 of 5 done, 1 to try again.', 'one of them done');
    eq(r.queued, '3 of 5 done, 2 to try again.', 'two queued, not yet in the bar\'s keys');
    eq(r.none, '3 of 5 done.', 'none coming back');
    eq(r.resume, '3 of 5 done, 1 to try again. The rest are waiting where you stopped.', 'the resume line');
    eq(JSON.stringify(r.tip), '[true,0,0]', 'every card shown is queued; none says it in its strip; every frame within 15 words');
  });

  /* ── groundwork ─────────────────────────────────────────────────── */
  /* F8 (release QA): a full browser dropped the games without cards, and Insights moved from "Based on 50 ...
     24 of your 27 losses" to "Based on 41 ... 25 of your 25 losses" with no word. Those games are packed
     first (what Insights counts stays); games still left out are named on Insights for as long as they are */
  const QUOTA = `var notes = [], n0 = notice, real = localStorage.setItem;
      notice = function (t, o) { notes.push([t, o ? o.act : null]); };
      var size = function (skip) { var n = 0; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== skip) n += k.length + String(localStorage.getItem(k)).length; } return n; };
      localStorage.setItem = function (k, v) { if (size(k) + k.length + String(v).length > window.__quota) throw new Error('QuotaExceededError'); real(k, v); };
      var insNow = function () { var r = insightReport(), c = coverage(), box = { innerHTML: '' }, el0 = el; el = function (id) { return id === 'insightsbox' ? box : el0(id); }; ui.view = 'insights'; renderInsights(); el = el0; ui.view = 'train';
        var t = box.innerHTML.replace(/<[^>]+>/g, '|'); return { cov: [c.total, c.covered, c.losses, c.decided].join(','), games: r.games, kicker: (/Based on [^|]*/.exec(t) || [''])[0], gone: (/This browser is out of room[^|]*/.exec(t) || [''])[0], head: (/In \\d+ of your \\d+ losses[^|]*/.exec(t) || [''])[0] }; };`;
  await test('a practice write the browser refuses: the game cache gives way down its own ladder (movetext, other players\' games, the games without cards packed, then old games) and the record is kept; after a reload Insights counts the same games, or says how many it does not count; a store that cannot recover says so once, with the progress file', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed';
      ${QUOTA}
      var before = insNow();
      /* full: a little room left, less than one record needs */
      window.__quota = size(null) + 60;
      var its = allMistakes().filter(trainable);
      srsRecord(its[0], 'first', { ms: 30000, attempted: true });
      var disk = JSON.parse(localStorage.getItem('nl:srs:cc:tester') || '{}'), c = JSON.parse(localStorage.getItem('nl:games:cc:tester'));
      var first = { kept: !!disk[its[0].key], games: c.games.length, packed: (c.packed || []).length, gone: (c.gone || []).length, notes: notes.slice() };
      localStorage.setItem = real; notice = n0;
      return JSON.stringify({ before: before, first: first }); })()`));
    eq(r.first.kept, true, 'the record is on disk');
    eq(JSON.stringify([r.first.games, r.first.packed, r.first.gone]), '[40,10,0]', 'the 10 games without cards packed, none left out');
    eq(JSON.stringify(r.first.notes), '[]', 'nothing lost, nothing to say');
    /* a reload: Insights counts the same games */
    const B = boot({ storage: Object.assign({}, A.storage) });
    const b = JSON.parse(B.ev(`(function () { SF.state = 'failed'; ${QUOTA} localStorage.setItem = real; notice = n0; return JSON.stringify(insNow()); })()`));
    eq(JSON.stringify(b), JSON.stringify(r.before), 'Insights after the reload, as before: ' + JSON.stringify(b));
    ok(/^Based on 50 /.test(b.kicker) && !b.gone, 'its window: ' + b.kicker);
    /* fuller still: old games without cards are left out, said once, and Insights names them after a reload */
    const r2 = JSON.parse(B.ev(`(function () {
      SF.state = 'failed';
      ${QUOTA}
      var c0 = JSON.parse(localStorage.getItem('nl:games:cc:tester'));
      window.__quota = size(null) - 400;
      var its = allMistakes().filter(trainable);
      srsRecord(its[1], 'first', { ms: 30000, attempted: true });
      var c = JSON.parse(localStorage.getItem('nl:games:cc:tester')), disk = JSON.parse(localStorage.getItem('nl:srs:cc:tester') || '{}');
      var out = { kept: !!disk[its[1].key], packed: [(c0.packed || []).length, (c.packed || []).length], gone: (c.gone || []).length, notes: notes.slice() };
      /* nothing fits any more: one notice for the visit, however many writes fail */
      window.__quota = 0;
      notes.length = 0;
      srsRecord(its[2], 'first', {}); srsRecord(its[3], 'fail', {}); daySave(dayLoad());
      out.second = { notes: notes.slice(), mem: !!srsLoad()[its[3].key] };
      localStorage.setItem = real; notice = n0;
      return JSON.stringify(out); })()`));
    eq(r2.kept, true, 'the record is on disk');
    ok(r2.gone > 0 && r2.packed[1] === r2.packed[0] - r2.gone, 'packed games left out for room: ' + JSON.stringify(r2));
    eq(JSON.stringify(r2.notes), JSON.stringify([['This browser is out of room, so ' + (50 - r2.gone) + ' games are kept, including every game you practise from.', null]]), 'said once');
    eq(JSON.stringify(r2.second.notes), JSON.stringify([['This browser is out of room, so your last answers may not be kept. Save a progress file in Settings.', 'exportProgress']]), 'one notice, with Save');
    eq(r2.second.mem, true, 'kept in memory for this visit');
    const C = boot({ storage: Object.assign({}, B.storage) });
    const c = JSON.parse(C.ev(`(function () { SF.state = 'failed'; ${QUOTA} localStorage.setItem = real; notice = n0; return JSON.stringify(insNow()); })()`));
    eq(c.gone, 'This browser is out of room, so ' + (r2.gone === 1 ? 'one of your games is' : r2.gone + ' of your games are') + ' not counted here.', 'Insights names the games it does not count: ' + JSON.stringify(c));
    ok(c.kicker.indexOf('Based on ' + (50 - r2.gone) + ' ') === 0, 'its window counts what it holds: ' + c.kicker);
    /* the games back (a later fetch, room again): nothing left to say */
    const back = JSON.parse(C.ev(`(function () { var fx = ${FIX}; data.games = fx.games.slice(); modelDirty(); saveGames(data.games); return JSON.stringify({ gone: goneGames().length, stored: (JSON.parse(localStorage.getItem('nl:games:cc:tester')).gone || []).length }); })()`));
    eq(JSON.stringify(back), '{"gone":0,"stored":0}', 'the games back: none named');
  });

  /* F3, F9, F10 (release QA, r6 growth M1): a rate limit gave a silent minute of "Looking..." and then "Check your
     connection"; a failed first load claimed saved games; a returning player's failed check said nothing. The
     sites answer here through a stubbed fetch (window.__net: a URL's answer, 'fail' for no answer) */
  const NET = `window.__fetches = []; window.__net = function () { return null; };
    fetch = function (u) {
      window.__fetches.push(String(u));
      var a = window.__net(String(u));
      if (a === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      var st = a ? a.status : 404, body = a && a.body != null ? a.body : {};
      return Promise.resolve({ status: st, ok: st >= 200 && st < 300, url: String(u), type: 'basic', body: null,
        headers: { get: function (h) { return a && a.headers ? a.headers[h] || null : null; } },
        json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } });
    };
    window.__notes = []; notice = function (t) { window.__notes.push(t); };`;
  const pump = async (A, n) => { for (let i = 0; i < (n || 30); i++) { A.advance(0); await tick(); } };
  await test('F3: a busy site (429) says so at once, counts down ("chess.com and lichess are busy and asked us to wait. Trying again in 60 s.") and tries again by itself, the button usable; Retry-After sets the wait; a name found on the other site goes ahead; no answer at all keeps "Check your connection"', async () => {
    const A = boot({ storage: {} });
    A.ev(`(function () { ${NET}
      var box = { innerHTML: '' }, inp = { value: 'tester', focus: function () {} }, btn = { textContent: '', classList: { add: function () { btn.off = true; }, remove: function () { btn.off = false; } } }, el0 = el;
      el = function (id) { return id === 'whichSite' ? box : id === 'firstUser' ? inp : id === 'findBtn' ? btn : el0(id); };
      window.__box = box; window.__btn = btn; window.__went = []; setUser = function (n) { window.__went.push([cfg.src, n]); };
      window.__net = function (u) { return /chess\\.com|lichess/.test(u) ? { status: 429 } : null; };
      findUser('tester'); return 1; })()`);
    const t0 = A.getNow();
    await pump(A);
    const r1 = JSON.parse(A.ev(`JSON.stringify({ box: window.__box.innerHTML.replace(/<[^>]+>/g, ''), btn: [window.__btn.textContent, !!window.__btn.off], n: window.__fetches.length })`));
    eq(A.getNow() - t0, 0, 'no wait before the line');
    eq(r1.box, 'chess.com and lichess are busy and asked us to wait. Trying again in 60 s60 s. Try now', 'at once, with its count (the seconds once for the eye, once for a screen reader)');
    eq(JSON.stringify(r1.btn), '["Find my mistakes",false]', 'the button usable meanwhile');
    eq(r1.n, 2, 'one request a site');
    /* the count runs down; at 0 it tries again by itself: chess.com has the name now */
    A.ev(`window.__net = function (u) { return /lichess/.test(u) ? { status: 404 } : /stats/.test(u) ? { status: 200, body: { chess_rapid: { last: { rating: 1500 }, record: { win: 3, loss: 2, draw: 0 } } } } : /chess\\.com/.test(u) ? { status: 200, body: { username: 'tester' } } : null; }; 1`);
    A.advance(30000); await pump(A, 5);
    eq(A.ev('window.__went.length'), 0, 'not before the count ends');
    A.advance(31000); await pump(A);
    eq(A.ev('JSON.stringify(window.__went)'), '[["chesscom","tester"]]', 'tried again by itself at 0, and goes');
    /* Retry-After sets the wait; lichess busy while chess.com has the name: chess.com goes ahead */
    const B = boot({ storage: {} });
    B.ev(`(function () { ${NET}
      var box = { innerHTML: '' }, inp = { value: 'tester', focus: function () {} }, el0 = el;
      el = function (id) { return id === 'whichSite' ? box : id === 'firstUser' ? inp : el0(id); };
      window.__box = box; window.__went = []; setUser = function (n) { window.__went.push([cfg.src, n]); };
      window.__net = function (u) { return /chess\\.com/.test(u) ? { status: 429, headers: { 'Retry-After': '7' } } : /lichess/.test(u) ? { status: 404 } : null; };
      findUser('tester'); return 1; })()`);
    await pump(B);
    eq(B.ev(`window.__box.innerHTML.replace(/<[^>]+>/g, '')`), 'chess.com is busy and asked us to wait. Trying again in 7 s7 s. Try now', 'Retry-After: 7 s');
    B.ev(`(function () { window.__net = function (u) { return /lichess/.test(u) ? { status: 429 } : /stats/.test(u) ? { status: 200, body: {} } : /chess\\.com/.test(u) ? { status: 200, body: { username: 'tester' } } : null; }; window.__realmClick('findNow'); return 1; })()`);
    await pump(B);
    eq(B.ev('JSON.stringify(window.__went)'), '[["chesscom","tester"]]', 'Try now goes at once; a name found on chess.com goes ahead while lichess is busy');
    /* no answer from either: the connection */
    const C = boot({ storage: {} });
    C.ev(`(function () { ${NET}
      var box = { innerHTML: '' }, inp = { value: 'tester', focus: function () {} }, el0 = el;
      el = function (id) { return id === 'whichSite' ? box : id === 'firstUser' ? inp : el0(id); };
      window.__box = box; window.__net = function () { return 'fail'; }; findUser('tester'); return 1; })()`);
    await pump(C);
    eq(C.ev(`window.__box.innerHTML.replace(/<[^>]+>/g, '')`), 'Could not reach chess.com or lichess. Check your connection and try again.', 'no answer: the connection');
  });

  await test('F3, F9: a first load that fails: busy says so at once and counts down to trying again (Try now beside it); no answer "Check your connection", an error "Try again in a minute."; never "saved games" where there are none', async () => {
    const A = boot({ storage: { 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom') } });
    const card = `(function () { var box = { innerHTML: '', dataset: {} }, el0 = el; el = function (id) { return id === 'trainbox' ? box : el0(id); }; data.narrate = false; renderTrain(); el = el0; return box.innerHTML.replace(/<[^>]+>/g, '|').replace(/\\|+/g, '|'); })()`;
    A.ev(`(function () { ${NET} window.__net = function (u) { return /archives/.test(u) ? { status: 429 } : null; }; gen++; loadGames(); return 1; })()`);
    await pump(A);
    const busy = A.ev(card);
    ok(/\|chess\.com is busy and asked us to wait\.\|Trying again in \|60 s\|60 s\|\.\|Try now\|/.test(busy) && !/saved games/i.test(busy), 'busy: ' + busy);
    const n0 = A.ev('window.__fetches.length');
    A.ev(`window.__net = function (u) { return /archives/.test(u) ? 'fail' : null; }; 1`);
    A.advance(61000); await pump(A);
    ok(A.ev('window.__fetches.length') > n0, 'tried again by itself at 0');
    const net = A.ev(card);
    ok(/\|chess\.com did not answer\.\|Check your connection and try again\.\|Try again\|/.test(net) && !/saved/i.test(net), 'no answer: ' + net);
    A.ev(`window.__net = function (u) { return /archives/.test(u) ? { status: 503 } : null; }; checkForGames(true); 1`);
    await pump(A);
    const err = A.ev(card);
    ok(/\|chess\.com did not answer\.\|Try again in a minute\.\|/.test(err) && !/saved/i.test(err), 'an error: ' + err);
  });

  await test('F10: a returning player\'s failed check says what happened under the Games tab\'s head ("Couldn\'t check for new games: chess.com is busy. Your practice is ready."), in a notice too when they asked', async () => {
    const A = boot();
    A.ev(`(function () { ${NET} SF.state = 'failed'; data.sections.games = 'ok'; window.__net = function (u) { return /archives/.test(u) ? { status: 429 } : /stats/.test(u) ? { status: 200, body: {} } : { status: 200, body: { username: 'tester' } }; }; checkForGames(true); return 1; })()`);
    await pump(A);
    const r = JSON.parse(A.ev(`JSON.stringify({ notes: window.__notes.slice(), aside: (/<p class="lg-note"[^>]*>([^<]*)</.exec(gamesHtml()) || [])[1], games: data.games.length })`));
    eq(r.aside, 'Couldn&#39;t check for new games: chess.com is busy. Your practice is ready.', 'under the games');
    eq(JSON.stringify(r.notes), JSON.stringify(['Checking for new games…', 'Couldn\'t check for new games: chess.com is busy. Your practice is ready.']), 'and in a notice');
    eq(r.games, 50, 'the saved games stay');
    A.ev(`(function () { window.__notes.length = 0; window.__net = function (u) { return /archives/.test(u) ? 'fail' : /stats/.test(u) ? { status: 200, body: {} } : { status: 200, body: { username: 'tester' } }; }; checkForGames(false); return 1; })()`);
    /* (it waits out chess.com's minute first, as background work does) */
    A.advance(61000); await pump(A);
    const r2 = JSON.parse(A.ev(`JSON.stringify({ notes: window.__notes.slice(), aside: (/<p class="lg-note"[^>]*>([^<]*)</.exec(gamesHtml()) || [])[1] })`));
    eq(r2.aside, 'Couldn&#39;t check for new games: chess.com did not answer. Your saved games are still here.', 'no answer: under the games');
    eq(JSON.stringify(r2.notes), JSON.stringify(['Checking for new games…']), 'a check nobody asked for adds no notice');
  });

  /* F2 (release QA): Save on the out-of-room notice wrote an empty file under "Saved to ..." (it read storage
     only). The file holds what this visit holds, and the notice counts it */
  await test('the progress file holds this visit\'s progress when storage is full or throws ("Saved 1 position to notlichess-tester-2026-09-28.json."); a refused write reads back its newer value; a file that cannot be made never says "Saved"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed';
      var notes = [], n0 = notice, real = localStorage.setItem, blob = null, B0 = Blob, ce = document.createElement;
      notice = function (t) { notes.push(t); };
      Blob = function (parts) { blob = parts[0]; };
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var out = {};
      /* a refused write: the store reads back the newer value, not storage's older one */
      store.set('nl:x', 1); localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      out.refused = [store.set('nl:x', 2), store.get('nl:x', null), JSON.parse(localStorage.getItem('nl:x'))];
      /* full from here: a card found, then Save on the notice */
      var its = allMistakes().filter(trainable);
      srsRecord(its[0], 'first', { ms: 30000, attempted: true });
      out.disk = !!JSON.parse(localStorage.getItem('nl:srs:cc:tester') || '{}')[its[0].key];
      out.roomNote = notes.slice();
      notes.length = 0;
      exportProgress();
      var f = JSON.parse(blob);
      out.file = { srs: Object.keys(f.keys['nl:srs:cc:tester'] || {}), day: Object.keys(f.keys).filter(function (k) { return /^nl:day:/.test(k); }).length };
      out.saved = notes.slice(); out.sv = !!cueLoad().sv;
      /* storage that throws on every use: the same */
      var gi = localStorage.getItem, ln = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(localStorage), 'length');
      localStorage.getItem = function () { throw new Error('SecurityError'); };
      srsRecord(its[1], 'first', { ms: 30000, attempted: true });
      notes.length = 0; blob = null;
      exportProgress();
      out.thrown = { srs: Object.keys(JSON.parse(blob).keys['nl:srs:cc:tester'] || {}).length, notes: notes.slice() };
      localStorage.getItem = gi;
      /* a file that cannot be made: no "Saved", no last save noted */
      var c = cueLoad(); delete c.sv; cueSave(c);
      document.createElement = function () { throw new Error('no anchors'); };
      notes.length = 0;
      exportProgress();
      out.cannot = { notes: notes.slice(), sv: !!cueLoad().sv };
      localStorage.setItem = real; notice = n0; Blob = B0; document.createElement = ce;
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.refused), '[false,2,1]', 'a refused write: false, read back as 2 (storage still holds 1)');
    eq(r.disk, false, 'the answer never reached storage');
    eq(JSON.stringify(r.roomNote), JSON.stringify(['This browser is out of room, so your last answers may not be kept. Save a progress file in Settings.']), 'the out-of-room notice');
    ok(r.file.srs.length === 1 && r.file.day >= 1, 'the file holds the answer and the day: ' + JSON.stringify(r.file));
    eq(JSON.stringify(r.saved), JSON.stringify(['Saved 1 position to notlichess-tester-2026-09-28.json.']), 'the notice counts what it saved');
    eq(r.sv, true, 'the last save noted');
    eq(JSON.stringify(r.thrown), JSON.stringify({ srs: 2, notes: ['Saved 2 positions to notlichess-tester-2026-09-28.json.'] }), 'storage that throws: the file holds both answers');
    eq(JSON.stringify(r.cannot), JSON.stringify({ notes: ['The progress file could not be made in this browser. Try again, or save it from another browser.'], sv: false }), 'a file that cannot be made never says "Saved"');
  });

  await test('tester helpers: after shiftDays(1) a card due tomorrow is due today, the day records, first and last seen and the paused set move back with it; the practice log keeps one entry per answered card and one per set, the last 500', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      SF.state = 'failed';
      var its = allMistakes().filter(trainable), res = {};
      openCard(its[0]); reveal();
      res.due0 = dueCards().some(function (x) { return x.key === its[0].key; });
      var now = Date.now(), rec0 = JSON.parse(JSON.stringify(srsLoad()[its[0].key]));
      store.set('nl:firstSeen:cc:tester', now - 2 * DAY); store.set('nl:lastSeen:cc:tester', now - DAY);
      var day0 = dayKey(), sess = { date: dayStamp(), mode: 'today', label: 'Today', keys: [its[1].key, its[2].key], idx: 1, results: {}, relearn: [], relearnOf: {} };
      store.set(sessKey(), sess);
      res.saved0 = !!savedSession();
      res.shift = window.__nlTest.shiftDays(1);
      var rec1 = srsLoad()[its[0].key];
      res.moved = [rec0.due - rec1.due, rec0.last - rec1.last];
      res.due1 = dueCards().some(function (x) { return x.key === its[0].key; });
      res.days = [!!store.get(day0, null), !!store.get(dayKeyFor(new Date(now - DAY)), null)];
      res.seen = [now - 3 * DAY === store.get('nl:firstSeen:cc:tester', 0), now - 2 * DAY === store.get('nl:lastSeen:cc:tester', 0)];
      res.saved1 = !!savedSession();
      /* the log: one entry per set started, one per card answered */
      store.del(logKey());
      var plain = its.filter(function (x) { var c = cardFor(x); return c && !c.sol; });
      startSession('more', [plain[3].key, plain[4].key, plain[5].key], 'Next set');
      var a = ui.session.active; gradeMove(uciToMove(a.st, a.bestUci)); nextCard();
      a = ui.session.active; a.hints = 1; gradeMove(uciToMove(a.st, a.bestUci)); nextCard();
      a = ui.session.active; reveal(); nextCard();
      res.log = window.__nlTest.log();
      for (var i = 0; i < 510; i++) logAdd({ e: 'x', i: i });
      res.cap = [logLoad().length, logLoad()[0].i];
      return JSON.stringify(res); })()`));
    eq(JSON.stringify([r.due0, r.due1]), '[false,true]', 'due tomorrow, then due today');
    eq(JSON.stringify(r.moved), JSON.stringify([864e5, 864e5]), 'due and last moved back a day');
    eq(JSON.stringify(r.days), '[false,true]', 'today\'s record is now yesterday\'s');
    eq(JSON.stringify(r.seen), '[true,true]', 'first and last seen a day earlier');
    eq(JSON.stringify([r.saved0, r.saved1]), '[true,false]', 'the paused set is yesterday\'s now, so it is gone');
    eq(r.shift.days, 1, 'shifted a day');
    const sets = r.log.filter((e) => e.e === 's'), cards = r.log.filter((e) => e.e === 'c');
    eq(JSON.stringify(sets.map((e) => [e.mo, e.n, e.new, e.due])), '[["more",3,3,0]]', 'one set: three new positions');
    ok(sets[0].od != null && sets[0].hl != null && sets[0].t, 'overdue, the healthy load and the time: ' + JSON.stringify(sets[0]));
    eq(JSON.stringify(cards.map((e) => [e.c, e.r, e.m, e.n, e.a, e.h])), '[["first","first","cued",0,1,0],["hint","hint","cued",0,1,1],["shown","fail","cued",0,0,0]]', 'one entry per card, in its category');
    ok(cards.every((e) => e.k && e.tr === 2 && e.s >= 0 && e.d == null) && typeof cards[0].f === 'number' && typeof cards[1].f === 'number' && cards[2].f === null, 'key, tier, solve time, no days at first sight, time to the first move: ' + JSON.stringify(cards));
    eq(JSON.stringify(r.cap), '[500,10]', 'the last 500 kept');
  });

  await test('tester helpers: seedAfterGames adds clones of the fixture after the start in date order (F0.5, deterministic): "halved" flattens the 1st, 3rd, 5th... big mistake of each game and drops their cards, cut 1 all of them, "plus one" adds a 25-point drop on the player\'s 10th move, at a rating; the same every time, round again past the last game', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed';
      var res = {}, from = Date.now() - 20 * DAY, before = data.games.length;
      var real = data.games.filter(function (g) { return !g.syn && g.wp; }).sort(function (x, y) { return x.ts - y.ts || (x.id < y.id ? -1 : 1); });
      var syn = function () { return data.games.filter(function (g) { return g.syn; }).sort(function (x, y) { return x.ts - y.ts; }); };
      var drop = function () { data.games = data.games.filter(function (g) { return !g.syn; }); };
      var at = function (g) { return bigMistakesAt(g, mistakeMinFor(g)); }, big = function (g) { return scoredPlies(g).mistakes; };
      res.a = window.__nlTest.seedAfterGames({ n: 24, from: from });
      var s = syn();
      res.n = [before, data.games.length, s.length];
      res.dated = s.every(function (g) { return g.ts > from && g.ts < Date.now(); });
      res.order = s.every(function (g, i) { return g.opp === real[i].opp && g.plies === real[i].plies && g.color === real[i].color; });
      res.bare = s.every(function (g) { return !g.mv && g.scanned && /^syn\\d+$/.test(g.id); }) && !allMistakes().some(function (it) { return it.g.syn; });
      res.same = s.every(function (g, i) { return g.wp === real[i].wp && at(g) === at(real[i]); });
      var wp1 = s.map(function (g) { return g.wp; }).join('|');
      drop();
      window.__nlTest.seedAfterGames({ n: 24, halved: true, from: from });
      var h = syn();
      res.halved = h.every(function (g, i) { return at(g) === Math.floor(at(real[i]) / 2); });
      res.kept = h.every(function (g, i) { var gone = big(real[i]).filter(function (p, k) { return k % 2 === 0; }); return (g.bl || []).every(function (b) { return gone.indexOf(b.p) === -1; }) && (real[i].bl || []).filter(function (b) { return gone.indexOf(b.p) === -1; }).length === (g.bl || []).length; });
      var wp2 = h.map(function (g) { return g.wp; }).join('|');
      drop();
      window.__nlTest.seedAfterGames({ n: 24, halved: true, from: from });
      res.again = syn().map(function (g) { return g.wp; }).join('|') === wp2 && wp1 !== wp2;
      drop();
      window.__nlTest.seedAfterGames({ n: 24, cut: 1, from: from });
      res.flat = syn().every(function (g) { return at(g) === 0; });
      drop();
      window.__nlTest.seedAfterGames({ n: 24, plus: 1, from: from, rating: 1060 });
      var p = syn();
      res.plus = p.every(function (g, i) { return at(g) === at(real[i]) + 1; });
      /* the added drop is a position, as Insights counts them (V4.8) */
      res.plusCard = p.every(function (g, i) { return (g.bl || []).filter(function (b) { return b.t === 'drift' && !b.bu && b.wb - b.wa === 25; }).length === 1 && bigCardsAt(g, 15).n === bigCardsAt(real[i], 15).n + 1; });
      res.tenth = p.filter(function (g) { var j = 18 + (g.color === 'white' ? 0 : 1); return Math.abs(wpAt(g, j - 1) - wpAt(g, j) - 25) < 1.6; }).length;
      res.rated = p.every(function (g) { return g.myR === 1060 && mistakeMinFor(g) === 15; });
      res.stored = JSON.parse(localStorage.getItem('nl:games:cc:tester')).games.filter(function (g) { return g.syn; }).length;
      drop();
      window.__nlTest.seedAfterGames({ n: 60, from: from });
      res.round = syn()[50].wp === real[0].wp && syn().length === 60 && new Set(syn().map(function (g) { return g.id; })).size === 60;
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.n), JSON.stringify([50, 74, 24]), '24 games added');
    eq(r.a.added, 24, 'it says so');
    ok(r.dated && r.order, 'dated after the start, the fixture\'s games in date order');
    eq(r.bare, true, 'no moves, so no new position to practise');
    eq(r.same, true, 'unchanged: each counts the big mistakes of the game it copies');
    eq(r.halved, true, 'halved: the 1st, 3rd, 5th... big mistake flattened, so each game keeps half of them, rounded down');
    eq(r.kept, true, 'the cards of the flattened mistakes go, the others stay');
    eq(r.again, true, 'the same games every time');
    eq(r.flat, true, 'cut 1: every big mistake flattened');
    eq(r.plus, true, 'plus one: one more big mistake in each game');
    eq(r.plusCard, true, 'and one more position, which "since you started" counts (V4.8)');
    ok(r.tenth >= 20, 'a 25-point drop on the 10th move where there is room: ' + r.tenth + ' of 24');
    eq(r.rated, true, 'at the rating asked (chess.com 1060, a 1210 band: 15 points)');
    eq(r.stored, 24, 'saved with the games');
    eq(r.round, true, 'past the last game, round again from the first');
  });

  await test('F6.1, V4.7, V4.8: Insights at three tiers on the fixture: the window, the headline and its lead, the skills by losses decided, each once, adding up to the headline\'s games (glyph, name, plain line, games and positions, a bar of their positions by steps, the positions in words: learned, in practice, not started), "Start here" on the focus at tiers 2 and 3 only, under 3 games "Also seen" with their bars; progress from the first clean find with zero parts dropped; how we count in each tier\'s words; under 5 losses and while reading', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var out = {};
      [1, 2, 3].forEach(function (t) {
        var h = insAt(t);
        out[t] = { w: insText(h).slice(0, 4), rows: insRows(h), count: insText(sheetHtml('count')), routine: /class="routine"/.test(h), since: /class="since"/.test(h), link: /data-act="sheet" data-k="count"/.test(h) };
      });
      /* practice: Piece safety 3 learned, 12 climbing and one back in the queue (C3: shown, so in practice); one clean find in Spotting chances */
      var srs = srsLoad(), now = Date.now(), fam = function (k) { return allMistakes().filter(function (it) { return trainable(it) && familyOf(patternOf(it.b)).key === k; }); };
      fam('safety').slice(0, 16).forEach(function (it, i) {
        srs[it.key] = i < 3 ? { box: 5, streak: 3, due: now + 90 * DAY, last: now, learned: true, lapses: 0 } : { box: 2, streak: 1, due: now + 7 * DAY, last: now, lapses: 0 };
        if (i === 15) srs[it.key].q = now;
      });
      srsSave(srs);
      srsRecord(fam('chances')[0], 'first', { ms: 9000, attempted: true });
      var h2 = insAt(2);
      out.practised = insRows(h2);
      out.zero = /(^|\\D)0 (learned|in practice|not started)/.test(insText(h2).join(' '));
      /* under 5 losses: the fallback headline, the lead kept */
      var k = 0;
      data.games.forEach(function (g) { if (g.res === 'loss' && ++k > 4) g.res = 'win'; });
      modelDirty();
      var hf = insAt(2);
      out.few = insText(hf).slice(1, 3);
      out.fewFirst = insRows(hf)[0].also;
      return JSON.stringify(out); })()`));
    const B = boot();
    const p = JSON.parse(B.ev(`(function () { ${INS}
      SF.state = 'failed';
      data.games.slice(0, 5).forEach(function (g) { delete g.scanned; delete g.bl; delete g.wp; delete g.mv; delete g.analysed; });
      modelDirty();
      return JSON.stringify(insText(insAt(2))[0]); })()`));
    ok(/^Based on 50 rapid games, \d+ to \d+ Sept? 2026$/.test(r[2].w[0]), 'the window: ' + r[2].w[0]);
    eq(JSON.stringify(r[2].w.slice(1, 3)), JSON.stringify(['In 25 of your 27 losses, one move turned the game for good.', 'Piece safety decided the most: 16 games.']), 'headline and lead, tier 2 (losses, each once: no draws to explain; V1.8: losses to mate and from 30% count)');
    eq(JSON.stringify(r[3].w.slice(1, 3)), JSON.stringify(r[2].w.slice(1, 3)), 'tier 3 the same');
    eq(JSON.stringify(r[1].w.slice(1, 3)), JSON.stringify(['In 25 of your 27 losses, one move cost you the game.', 'Piece safety cost you the most games: 16.']), 'tier 1 in its words');
    const col = (t, k) => r[t].rows.map((x) => x[k]);
    eq(JSON.stringify(col(2, 'name')), JSON.stringify(['Piece safety', 'King safety', 'Quiet moves', 'Spotting chances', 'Finishing wins']), 'the skills, by games decided');
    eq(JSON.stringify(col(2, 'glyph')), JSON.stringify(['shield', 'crown', 'compass', 'target', 'flag']), 'their glyphs');
    eq(JSON.stringify(col(2, 'focus')), JSON.stringify([true, false, false, false, false]), '"Start here" on the focus');
    eq(JSON.stringify(col(1, 'focus')), JSON.stringify([false, false, false, false, false]), 'tier 1: no "Start here", the skill tiles\' "Next" the one next step (V4.7)');
    eq(col(2, 'n').reduce((a, x) => a + (+((/decided (\d+)/.exec(x) || [])[1]) || (/decided one/.test(x) ? 1 : 0)), 0), 25, 'the rows add up to the headline\'s 25 games (V4.8)');
    eq(JSON.stringify(col(2, 'also')), JSON.stringify([false, false, true, true, true]), 'under 3 games decided: "Also seen"');
    eq(JSON.stringify(col(2, 'n')), JSON.stringify(['decided 16 games · 38 positions', 'decided 6 games · 7 positions', 'decided 2 games · 27 positions', 'decided one game · 10 positions', 'decided no games · 9 positions']), 'games decided and positions');
    eq(JSON.stringify(col(1, 'n')), JSON.stringify(['cost you 16 games · 38 positions', 'cost you 6 games · 7 positions', 'cost you 2 games · 27 positions', 'cost you one game · 10 positions', 'cost you no games · 9 positions']), 'tier 1: what they cost you');
    eq(JSON.stringify(col(2, 'line')), JSON.stringify(['Moves that let them win material.', 'Moves that exposed your king or allowed mate.', 'Moves with no tactic that made your position worse.', 'Moves that missed a free piece, a tactic or a mate.', 'Moves that let a winning position get away.']), 'plain lines, tier 2');
    eq(JSON.stringify(col(3, 'line')), JSON.stringify(col(2, 'line')), 'tier 3 the same');
    eq(JSON.stringify(col(1, 'line')), JSON.stringify(['Moves that let them take your pieces.', 'Moves that put your king in danger.', 'Moves with no trick that made things worse.', 'Free pieces and mates you missed.', 'Times you were winning and let it go.']), 'plain lines, tier 1');
    eq(JSON.stringify(col(2, 'prog')), JSON.stringify(['38 not started', '7 not started', '27 not started', '10 not started', '9 not started']), 'nothing practised yet: all not started');
    eq(JSON.stringify(col(2, 'bar')), JSON.stringify(['g114', 'g21', 'g81', 'g30', 'g27']), 'every skill a bar of its positions\' steps, 3 each, "Also seen" too');
    const pr = r.practised.filter((x) => /Piece safety|Spotting chances/.test(x.name)).map((x) => [x.name, x.prog, x.bar]);
    eq(JSON.stringify(pr), JSON.stringify([['Piece safety', '3 learned · 13 in practice · 22 not started', 'l9 c12 g93'], ['Spotting chances', '1 in practice · 9 not started', 'c1 g29']]), 'learned (3 steps each), in practice (its rungs: one back in the queue starts again at 0, and stays in practice: "not started" is never shown, C3), and one clean find (a step)');
    eq(r.zero, false, 'never "0 learned", nor any zero part');
    eq(JSON.stringify([r[1].routine, r[2].routine, r[3].routine]), '[false,true,true]', 'the routine line from tier 2');
    eq(JSON.stringify([r[1].since, r[2].since, r[3].since]), '[false,false,false]', 'no "since you started" before a set is finished');
    ok(r[1].link && r[2].link && r[3].link, 'how we count, a sheet');
    eq(JSON.stringify(r[1].count), JSON.stringify(['Insights', 'How we count', 'A big mistake: a move that made your position much worse.', 'A move cost you the game if you never came back from it.', 'Find it first try 3 times in a row, over 3 weeks or more, and it is learned.']), 'how we count, tier 1 (a big mistake, as the app says it everywhere; learned in plain words, as the ladder keeps it: C3)');
    eq(JSON.stringify(r[2].count), JSON.stringify(['Insights', 'How we count', 'A big mistake cut your winning chances by 15 points or more (20 under 1200, 12 at 1800+).', 'A move decided a game if it lost a game you could still play and you never came back.', 'Three first-try finds in a row make it learned if the last comes 16 days or more after the one before, in game view within 30 seconds (60 at Less help). A miss starts it again.']), 'how we count, tier 2 (V4.8; learned as the ladder keeps it, C3)');
    /* tier 3 adds what its rows on how games are decided count (F10.3): +2, and the peer figures' source */
    eq(JSON.stringify(r[3].count), JSON.stringify(r[2].count.concat(DECIDED_COUNT)), 'tier 3 names the threshold its games are counted at (15 for the fixture\'s 1350s)');
    eq(r.few[0], 'Your mistakes, grouped by the skill that would prevent them.', 'under 5 losses: the fallback headline');
    eq(r.fewFirst, false, 'the list always starts above "Also seen"');
    ok(/^Based on 45 of 50 rapid games so far, /.test(p), 'while reading: the part read so far: ' + p);
  });

  await test('F6.2: "since you started" stays hidden until the first finished set, which notes the start and freezes the threshold per format; practice from before this build starts at the end of its first day with a finished set; shiftDays, Reset and the progress file carry the start; the before numbers are kept once their games leave the cache', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {}, its = allMistakes().filter(trainable), now = Date.now();
      res.none = [!!sinceText(insAt(2)), !!store.get(startKey(), null)];
      ui.session = { mode: 'today', label: 'Today', keys: [its[0].key], idx: 1, results: {}, relearn: [], relearnOf: {}, attempted: 0 };
      finishSession();
      res.idle = !!store.get(startKey(), null);
      ui.session = { mode: 'today', label: 'Today', keys: [its[1].key, its[2].key, its[3].key], idx: 3, results: {}, relearn: [], relearnOf: {}, attempted: 3 };
      finishSession();
      var s = store.get(startKey(), null);
      res.start = [s.t === now, JSON.stringify(s.thr)];
      res.panel = sinceText(insAt(2));
      res.t1 = JSON.stringify(sinceText(insAt(1))) === JSON.stringify(res.panel);
      /* the before games leave the cache: their numbers stay */
      var b0 = sinceStats().before, keep = data.games;
      data.games = keep.filter(function (g, i) { return i < 20; }); modelDirty();
      var b1 = sinceStats().before;
      res.copy = [b0.n, b1.n, b0.total === b1.total, b0.clean === b1.clean];
      data.games = keep; modelDirty();
      ui.session = { mode: 'more', label: 'Next set', keys: [its[4].key, its[5].key, its[6].key], idx: 3, results: {}, relearn: [], relearnOf: {}, attempted: 3 };
      finishSession();
      res.kept = store.get(startKey(), null).t === now;
      window.__nlTest.shiftDays(2);
      res.shifted = now - store.get(startKey(), null).t;
      var sp = sinceStats();
      res.split = [sp.before.n + sp.since.n, sp.since.n > 0];
      /* the progress file carries it; Reset clears it */
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var blob = ''; Blob = function (parts) { blob = parts[0]; };
      exportProgress();
      res.file = !!JSON.parse(blob).keys['nl:start:cc:tester'];
      return JSON.stringify(res); })()`));
    A.click('resetProgress'); A.advance(1500); A.click('resetProgress');
    const gone = A.ev(`JSON.stringify([store.get(startKey(), null), sinceStats()])`);
    const B = boot();
    const d = JSON.parse(B.ev(`(function () {
      var now = Date.now(), d3 = new Date(now - 3 * DAY), d1 = new Date(now - DAY);
      store.set(dayKeyFor(d3), { answered: 5, sessions: 1 }); store.set(dayKeyFor(d1), { answered: 3, sessions: 2 });
      store.set(dayKeyFor(new Date(now - 5 * DAY)), { answered: 2, counted: 1 });
      var s = startLoad();
      return JSON.stringify({ t: s.t, want: new Date(d3.getFullYear(), d3.getMonth(), d3.getDate() + 1).getTime() - 1, stored: !!store.get(startKey(), null), thr: s.thr }); })()`));
    eq(JSON.stringify(r.none), '[false,false]', 'hidden, nothing stored, before a finished set');
    eq(r.idle, false, 'a set of reveals only starts nothing');
    eq(JSON.stringify(r.start), JSON.stringify([true, '{"rapid":15}']), 'the first finished set notes the start and its threshold (the rapid band that day; no blitz game, no blitz threshold yet)');
    eq(JSON.stringify(r.panel), JSON.stringify(['Since you started, 28 Sept', 'Big mistakes per game before: 1.8 (50 games).', 'Comparison from 10 games since you started: 0 of 10 new games so far.']), 'the waiting card (V4.8: one count, the positions at the frozen line)');
    eq(r.t1, true, 'the same words at tier 1');
    eq(r.kept, true, 'a later set leaves the start where it was');
    eq(r.shifted, 2 * 864e5, 'shiftDays moves the start back');
    eq(JSON.stringify(r.split), '[50,true]', 'and the games after it count since, none twice');
    eq(r.file, true, 'the progress file carries it');
    eq(JSON.stringify(r.copy), JSON.stringify([50, 50, true, true]), 'the before numbers kept once the games have left');
    eq(gone, '[null,null]', 'Reset clears it');
    eq(d.t, d.want, 'practice from before this build: the end of the first day a set was finished (a day counted by a paused set is no finished set)');
    ok(d.stored && d.thr.rapid === 15, 'and it is kept, with its threshold');
  });

  await test('F6.2: the verdict on F0.5\'s deterministic games, by learning\'s calibrated rule: 9 games the waiting line (even all flattened); 10 halved (1.20 a game) "No clear change yet."; 24 unchanged (2.00) the same; 20 halved (0.90) "Probably fewer. More games will tell."; 40 halved (0.68) "Fewer than before."; 24 plus one (3.00) "Probably more than before."; with games with no big mistake (V4.8: one count, the positions at the frozen line)', () => {
    const cases = [[{ n: 9 }, 'wait'], [{ n: 9, cut: 1 }, 'wait'], [{ n: 10, halved: true }, 'no_change'], [{ n: 24 }, 'no_change'], [{ n: 20, halved: true }, 'probably_fewer'], [{ n: 40, halved: true }, 'fewer'], [{ n: 24, plus: 1 }, 'probably_more']];
    const got = cases.map(([spec]) => JSON.parse(boot().ev(`(function () { ${INS}
      SF.state = 'failed';
      noteStart(Date.now() - 3600e3);
      window.__nlTest.seedAfterGames(${JSON.stringify(spec)});
      var st = sinceStats();
      return JSON.stringify({ v: st.verdict, b: st.before.mean.toFixed(2), s: st.since.mean.toFixed(2), card: sinceText(insAt(2)) }); })()`)));
    eq(JSON.stringify(got.map((x) => x.v)), JSON.stringify(cases.map((c) => c[1])), 'the verdicts');
    eq(JSON.stringify(got.map((x) => x.b)), JSON.stringify(cases.map(() => '1.82')), 'before: 1.82 a game over the fixture\'s 50 ((20 deciding + 71 other) / 50, V4.8)');
    eq(JSON.stringify(got.slice(2).map((x) => x.s)), JSON.stringify(['1.20', '2.00', '0.90', '0.68', '3.00']), 'since: learning\'s means, counted as positions');
    eq(JSON.stringify(got[0].card), JSON.stringify(['Since you started, 28 Sept', 'Big mistakes per game before: 1.8 (50 games).', 'Comparison from 10 games since you started: 9 of 10 new games so far.']), '9 games: the waiting line');
    eq(JSON.stringify(got[1].card.slice(1)), JSON.stringify(['Big mistakes per game before: 1.8 (50 games).', 'Comparison from 10 games since you started: 9 of 10 new games so far.']), 'no verdict before 10 games, however few the mistakes');
    eq(JSON.stringify(got[2].card), JSON.stringify(['Since you started, 28 Sept', 'Big mistakes per game: 1.8 before, 1.2 since (10 games).', 'No clear change yet.', 'Games with no big mistake: 10 of 50 before, 4 of 10 since.']), '10 halved');
    eq(JSON.stringify(got[4].card.slice(1, 4)), JSON.stringify(['Big mistakes per game: 1.8 before, 0.9 since (20 games).', 'Probably fewer. More games will tell.', 'Games with no big mistake: 10 of 50 before, 9 of 20 since.']), '20 halved');
    eq(JSON.stringify(got[5].card.slice(1, 4)), JSON.stringify(['Big mistakes per game: 1.8 before, 0.7 since (40 games).', 'Fewer than before.', 'Games with no big mistake: 10 of 50 before, 22 of 40 since.']), '40 halved');
    eq(JSON.stringify(got[6].card.slice(1, 4)), JSON.stringify(['Big mistakes per game: 1.8 before, 3.0 since (24 games).', 'Probably more than before.', 'Games with no big mistake: 10 of 50 before, 0 of 24 since.']), '24 plus one');
  });

  await test('F6.2: the threshold stays frozen at the start (games at 1210 against a 1190 baseline counted at 20 points, while Insights counts each game at its own); a practised skill\'s mistakes with its calibrated word (V4.8), opponents 100 points stronger or more; Today\'s line from 10 games since; the measure once per state', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {};
      /* chess.com rapid counts 150 more: 1040 is a 1190 band, 1060 a 1210 one */
      data.games.forEach(function (g) { g.myR = 1040; }); modelDirty();
      noteStart(Date.now() - 3600e3);
      window.__nlTest.seedAfterGames({ n: 24, rating: 1060 });
      var st = sinceStats(), syn = data.games.filter(function (g) { return g.syn; });
      var sum = function (f) { return syn.reduce(function (a, g) { return a + f(g); }, 0); };
      /* V4.8: one count, the positions; at 15 each clone counts every position it keeps, as Insights would */
      res.freeze = [st.thr.rapid, syn.every(function (g) { return mistakeMinFor(g) === 15; }), st.since.total, sum(function (g) { return bigCardsAt(g, 20).n; }), sum(function (g) { return bigCardsAt(g, 15).n; }), sum(function (g) { return (g.bl || []).filter(function (b) { return !b.x; }).length; })];
      res.card = sinceText(insAt(2)).slice(1, 3);
      return JSON.stringify(res); })()`));
    const B = boot();
    const q = JSON.parse(B.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {}, calls = [], now = Date.now();
      window.clarity = function () { calls.push([].slice.call(arguments).map(String)); };
      var srs = srsLoad();
      allMistakes().filter(function (it) { return trainable(it) && familyOf(patternOf(it.b)).key === 'safety'; }).slice(0, 5)
        .forEach(function (it) { srs[it.key] = { box: 2, streak: 1, due: now + 7 * DAY, last: now, lapses: 0 }; });
      srsSave(srs);
      noteStart(now - 3600e3);
      window.__nlTest.seedAfterGames({ n: 9 });
      insAt(2); insAt(3);
      /* Today's line waits for 10 games since: the old greeting */
      var syn = function () { return data.games.filter(function (g) { return g.syn; }).sort(function (x, y) { return y.ts - x.ts; }); };
      res.early = greetingLine(syn()[3].ts);
      data.games = data.games.filter(function (g) { return !g.syn; });
      window.__nlTest.seedAfterGames({ n: 24, halved: true });
      data.games.forEach(function (g) { if (g.syn && g.oppR) g.oppR += 150; });
      res.card = sinceText(insAt(2));
      insAt(1);
      var st = sinceStats(), last = syn().slice(0, 3);
      res.moved = Math.round((st.since.opp / st.since.on - st.before.opp / st.before.on) / 10) * 10;
      res.usual = [last.reduce(function (a, g) { return a + bigCardsAt(g, 15).n; }, 0), Math.round(st.before.mean * 3)];
      res.today = greetingLine(syn()[3].ts);
      last[0].wp = null;
      res.unread = greetingLine(syn()[3].ts);
      res.calls = calls.filter(function (c) { return /^since_/.test(c[1]); }).map(function (c) { return c[1]; });
      res.flat = JSON.stringify(calls);
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.freeze.slice(0, 2)), '[20,true]', 'frozen at the 1190 band\'s 20 points, though the games since are at 1210 (15)');
    eq(r.freeze[2], r.freeze[3], 'since: counted at 20');
    ok(r.freeze[4] > r.freeze[3] && r.freeze[5] === r.freeze[4], 'at 15 they would count more, as Insights counts each game at its own rating: ' + r.freeze.join(', '));
    eq(r.card[0], 'Big mistakes per game: ' + '1.8 before, ' + (Math.round(r.freeze[2] / 24 * 10) / 10).toFixed(1) + ' since (24 games).', 'the card at the frozen threshold (the fixture\'s positions, read at 15, all reach the 20 its games now claim)');
    ok(/^Since your last visit: \d+ games? \(\d+ won, \d+ lost\)\./.test(q.early), 'under 10 games since, Today keeps its greeting: ' + q.early);
    eq(q.card.slice(4).join(' | '), 'Piece safety mistakes: 38 in 50 games before, 6 in 24 since. Probably fewer. More games will tell. | Your opponents since are ' + q.moved + ' points stronger.', 'a practised skill (5 positions) counted, with its calibrated word (V4.8: 24 games since, 38 before); the opponents\' level');
    ok(q.moved >= 100, 'opponents moved ' + q.moved);
    eq(q.today, 'Since your last visit: 3 games, ' + (q.usual[0] ? q.usual[0] + ' big mistake' + (q.usual[0] === 1 ? '' : 's') : 'no big mistakes') + ' (before you started: about ' + q.usual[1] + ').', 'Today, from 10 games since: their big mistakes against as many games before the start, named as that');
    ok(/^Since your last visit: 3 games \(/.test(q.unread), 'a game not read yet: the greeting as before');
    eq(JSON.stringify(q.calls), JSON.stringify(['since_wait', 'since_probably_fewer']), 'the measure: once per state a visit');
    ok(!/tester|\b1[0-9]{3}\b|\b\d{12}\b/.test(q.flat), 'no name, rating or key: ' + q.flat);
  });

  await test('F6.3: your clock on the fixture: tier 2 "In your losses you used 10 of 30 minutes." and "The moves that lost took 18 s (your pace: 15 s a move), with 23 min left.", tier 3 adds "7 of 26 deciding moves took under 10 s (21 of your 65 other big mistakes did too).", tier 1 spells the units; a 30+0 game\'s time trouble is under 3 minutes (a quarter of the losing moves, with Practise these); mixed time controls in shares; under 5 losses with a clock, no row; the end clock stored at ingest', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {};
      [1, 2, 3].forEach(function (t) { res[t] = clockText(insAt(t)); });
      var lost = allMistakes().filter(function (it) { return it.b.d === 1 && it.g.res === 'loss'; }).sort(function (x, y) { return x.b.c - y.b.c; });
      /* one short of a quarter of the losing moves under 3 minutes, then a quarter */
      var q = Math.ceil(lost.length / 4);
      res.q = [q, lost.length];
      lost.slice(0, q - 1).forEach(function (it) { it.b.c = 150; });
      res.four = clockText(insAt(2)).length;
      lost[q - 1].b.c = 170;
      var h = insAt(2);
      res.trouble = clockText(h).slice(2).join(' ');
      res.drill = /data-act="drill" data-spec="\\{&quot;type&quot;:&quot;clock&quot;,&quot;label&quot;:&quot;Time trouble&quot;\\}">Practise these ›</.test(h);
      res.items = drillItems({ type: 'clock' }, 20).filter(function (it) { return it.b.d === 1; }).length;
      /* mixed time controls: shares */
      var k = 0;
      data.games.forEach(function (g) { if (g.res === 'loss' && ++k <= 10) { g.tc = '15+0'; (g.bl || []).forEach(function (b) { if (b.c != null) b.c = b.c / 2; }); } });
      res.mixed2 = clockText(insAt(2)).slice(0, 2);
      res.mixed1 = clockText(insAt(1)).slice(0, 2);
      /* under 5 losses with an end clock: no row */
      k = 0;
      data.games.forEach(function (g) { if (g.res === 'loss' && ++k > 4) delete g.clockPct; });
      res.few = clockText(insAt(2));
      /* the end clock at ingest: lichess and chess.com shapes */
      var li = compact({ id: 'x1', createdAt: Date.now(), perf: 'rapid', speed: 'rapid', status: 'resign', winner: 'black', moves: 'e4 e5 Nf3 Nc6',
        players: { white: { user: { id: 'tester', name: 'tester' }, rating: 1500 }, black: { user: { id: 'b', name: 'b' }, rating: 1500 } },
        clocks: [60000, 60000, 59000, 58000], clock: { initial: 600, increment: 0 } }, 'tester');
      var cc = ccShape({ rules: 'chess', rated: true, time_class: 'blitz', time_control: '300', url: 'https://www.chess.com/game/live/9', end_time: 1790000000,
        white: { username: 'a', rating: 1400, result: 'win' }, black: { username: 'tester', rating: 1400, result: 'resigned' },
        pgn: '[Event "x"]\\n\\n1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:04:51.5]} 2. Nf3 {[%clk 0:04:58]} 1-0' });
      res.ingest = [li.clockPct, compact(cc, 'tester').clockPct, endClockPct(null, true, 600)];
      return JSON.stringify(res); })()`));
    /* V1.8: 25 losses decided (mates scored as losses, the 30% floor), so 26 deciding moves and their pace */
    eq(JSON.stringify(r[2]), JSON.stringify(['In your losses you used 10 of 30 minutes.', 'The moves that lost took 18 s (your pace: 15 s a move), with 23 min left.']), 'tier 2');
    eq(JSON.stringify(r[3]), JSON.stringify(['In your losses you used 10 of 30 minutes.', 'The moves that lost took 18 s (your pace: 15 s a move), with 23 min left.', '7 of 26 deciding moves took under 10 s (21 of your 65 other big mistakes did too).']), 'tier 3');
    eq(JSON.stringify(r[1]), JSON.stringify(['In your losses you used 10 of 30 minutes.', 'The moves that lost took 18 seconds (you usually take 15), with 23 minutes left.']), 'tier 1');
    eq(JSON.stringify(r.q), '[7,25]', 'a quarter of the 25 losing moves is 7');
    eq(r.four, 2, '6 of 25 losing moves under 3 minutes: under a quarter, no row');
    eq(r.trouble, '7 of 25 losing moves came with under 3 min left. Practise these ›', '7 of 25: the row, at 3 minutes for 30+0');
    ok(r.drill && r.items >= 7, 'Practise these drills them (' + r.items + ')');
    eq(JSON.stringify(r.mixed2), JSON.stringify(['In your losses you used 33% of your time.', 'The moves that lost took 18 s (your pace: 13 s a move), with 78% of your time left.']), 'mixed time controls: shares (the pace is seconds a move in any)');
    eq(JSON.stringify(r.mixed1), JSON.stringify(['In your losses you used about a third of your time.', 'The moves that lost took 18 seconds (you usually take 13), with about three quarters of your time left.']), 'tier 1: shares in words');
    eq(r.few, null, 'under 5 losses with an end clock: no clock row');
    eq(JSON.stringify(r.ingest), JSON.stringify([98.3, 97.2, null]), 'the end clock kept at ingest, in percent of the start');
  });

  /* the learning scientist's review of slice 6 */
  await test('slice 6 review: a skill\'s line counts only the games whose positions reach the frozen threshold (a baseline at 1210 counted at 15 against games since at 1190, whose positions start at 20: no line, never fewer mistakes that are not), with those games as its denominator; V4.8: the line shows only with its calibrated word, from 20 such games (19: none; 21: one ending in the rule\'s word)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {}, now = Date.now(), srs = srsLoad();
      /* chess.com rapid counts 150 more: 1060 is a 1210 band (15 points), 1040 a 1190 one (20) */
      data.games.forEach(function (g) { g.myR = 1060; }); modelDirty();
      allMistakes().filter(function (it) { return trainable(it) && familyOf(patternOf(it.b)).key === 'safety'; }).slice(0, 5)
        .forEach(function (it) { srs[it.key] = { box: 2, streak: 1, due: now + 7 * DAY, last: now, lapses: 0 }; });
      srsSave(srs);
      noteStart(now - 3600e3);
      window.__nlTest.seedAfterGames({ n: 24, rating: 1040 });
      var st = sinceStats();
      res.low = [st.thr.rapid, st.since.n, st.since.famN, st.before.famN, st.since.total > 0];
      res.lowCard = sinceText(insAt(2));
      /* 19 more since at 1210: their positions reach 15, so they are the line's games; under 20 of them, no line yet (V4.8) */
      window.__nlTest.seedAfterGames({ n: 19, rating: 1060 });
      st = sinceStats();
      res.n19 = [st.since.n, st.since.famN];
      res.card19 = sinceText(insAt(2));
      window.__nlTest.seedAfterGames({ n: 2, rating: 1060 });
      st = sinceStats();
      var mine = data.games.filter(function (g) { return g.syn && g.myR === 1060; }), safety = 0;
      mine.forEach(function (g) { (g.bl || []).forEach(function (b) { if (!b.x && familyOf(patternOf(b)).key === 'safety') safety++; }); });
      res.mixed = [st.since.n, st.since.famN, mine.length, safety];
      res.mixedCard = sinceText(insAt(2));
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.low.slice(0, 4)), '[15,24,0,50]', 'frozen at 15; the 24 games since at 1190 keep positions only from 20 points, so none counts for a skill; all 50 before do');
    ok(r.low[4], 'their big mistakes still count in the totals, from the series');
    ok(r.lowCard.length >= 4 && !r.lowCard.some((x) => / mistakes: \d+ in /.test(x)), 'no skill line: ' + r.lowCard.join(' | '));
    eq(JSON.stringify(r.n19), '[43,19]', '19 more since at 1210: 43 games since, 19 of them for the skills');
    ok(!r.card19.some((x) => / mistakes: \d+ in /.test(x)), '19 games for the skills: no skill line yet (V4.8): ' + r.card19.join(' | '));
    eq(JSON.stringify(r.mixed.slice(0, 3)), '[45,21,21]', '2 more: 45 games since, 21 of them for the skills');
    const line = r.mixedCard.find((x) => / mistakes: \d+ in /.test(x)) || '';
    ok(new RegExp('^Piece safety mistakes: 38 in 50 games before, ' + r.mixed[3] + ' in 21 since\\. (Fewer than before|Probably fewer\\. More games will tell|No clear change yet|Probably more than before|More than before)\\.$').test(line), 'the line over those 21 games, ending in the rule\'s word (V4.8): ' + r.mixedCard.join(' | '));
  });

  await test('slice 6 review: while fewer than 20 games before the start leave the next games to the before count, the card says how many ("Your next 3 games complete the before count; the comparison comes 10 games after.") instead of a count since that sits at 0; then the count since moves from the first game after', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var res = {}, old = data.games.slice().sort(function (x, y) { return x.ts - y.ts; });
      var meter = function (h) { return /class="since-meter"/.test(h) ? (h.match(/<i class="on">/g) || []).length : null; };
      /* 17 games before the start, none after yet */
      data.games = old.slice(0, 17).reverse(); modelDirty();
      noteStart(old[16].ts + 60e3);
      var at = function (k) { var h = insAt(2); res[k] = sinceText(h); res[k + 'm'] = meter(h); res[k + 'n'] = sinceStats().before.n; };
      at('c17');
      window.__nlTest.seedAfterGames({ n: 2 }); at('c19');
      window.__nlTest.seedAfterGames({ n: 1 }); at('c20');
      window.__nlTest.seedAfterGames({ n: 3 }); at('c23');
      return JSON.stringify(res); })()`));
    const before = (n) => new RegExp('^Big mistakes per game before: \\d\\.\\d \\(' + n + ' games\\)\\.$');
    ok(before(17).test(r.c17[1]), 'the before number over the 17: ' + r.c17[1]);
    eq(r.c17[2], 'Your next 3 games complete the before count; the comparison comes 10 games after.', '17 before: 3 to go');
    eq(r.c17m, null, 'no meter while the before count fills');
    ok(before(19).test(r.c19[1]) && r.c19n === 19, 'two games after the start join the before count: ' + r.c19[1]);
    eq(r.c19[2], 'Your next game completes the before count; the comparison comes 10 games after.', 'one to go');
    eq(r.c19m, null, 'still no meter');
    ok(before(20).test(r.c20[1]), 'the third completes it');
    eq(r.c20[2], 'Comparison from 10 games since you started: 0 of 10 new games so far.', 'the count since starts');
    eq(r.c20m, 0, 'its meter, empty');
    eq(r.c23[2], 'Comparison from 10 games since you started: 3 of 10 new games so far.', 'and moves with each game after');
    eq(r.c23m, 3, 'the meter with it');
  });

  await test('slice 6 review: the tester\'s clones (seedAfterGames) count in "since you started" only: the window, the headline, the clock, how we count and the part read so far stay the player\'s own games', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var look = function () { var h = insAt(3); playerTier = function () { return 2; }; return { top: insText(h).slice(0, 3), clock: clockText(h), count: insText(sheetHtml('count'))[2], since: sinceText(h) }; };
      var res = { before: look() };
      noteStart(Date.now() - 3600e3);
      /* at 2100 (a 2250 band, 12 points), the clones would also move how we count */
      window.__nlTest.seedAfterGames({ n: 24, halved: true, rating: 2100 });
      res.after = look();
      res.syn = data.games.filter(function (g) { return g.syn; }).length;
      return JSON.stringify(res); })()`));
    const B = boot();
    const p = JSON.parse(B.ev(`(function () { ${INS}
      SF.state = 'failed';
      data.games.slice(0, 5).forEach(function (g) { delete g.scanned; delete g.bl; delete g.wp; delete g.mv; delete g.analysed; });
      modelDirty();
      window.__nlTest.seedAfterGames({ n: 24 });
      return JSON.stringify(insText(insAt(2))[0]); })()`));
    eq(r.syn, 24, '24 clones');
    eq(JSON.stringify(r.after.top), JSON.stringify(r.before.top), 'the window and the headline as before: ' + r.after.top.join(' | '));
    ok(/^Based on 50 rapid games, /.test(r.after.top[0]) && /^In 25 of your 27 losses, /.test(r.after.top[1]), 'the player\'s 50 games, 25 of 27 losses');
    eq(JSON.stringify(r.after.clock), JSON.stringify(r.before.clock), 'the clock as before');
    eq(r.after.count, r.before.count, 'how we count at the player\'s own band: ' + r.after.count);
    eq(r.before.since, null, 'no start, no card');
    ok(/ since \(24 games\)\.$/.test(r.after.since[1]), 'since you started counts the clones: ' + r.after.since[1]);
    ok(/^Based on 45 of 50 rapid games so far, /.test(p), 'while reading, the part read so far leaves the clones out too: ' + p);
  });

  await test('slice 6 review: "big mistake" has one meaning: how we count names it at every tier and, once since you started shows, the line it counts at (the start day\'s, each format\'s where they differ); the Games tab\'s loss with no position says "No single losing move"; the clock\'s pace is Details\' own, its tier 1 bracket keeps the unit, and none is said without one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${INS}
      SF.state = 'failed';
      var res = {};
      noteStart(Date.now() - 3600e3);
      [1, 2, 3].forEach(function (t) { playerTier = function () { return t; }; res[t] = insText(sheetHtml('count')); });
      /* the pace in the bracket is Details' own (tier 3), over the moves that lost */
      playerTier = function () { return 3; };
      var lost = allMistakes().filter(function (it) { return it.b.d === 1 && it.g.res === 'loss' && it.b.c != null && it.b.tt != null && tcInitialSecs(it.g.tc); });
      res.details = lost.map(function (it) { var m = /Your pace: (\\d+) s a move\\./.exec(clockLine(openCard(it))); return m ? +m[1] : null; });
      res.paces = lost.map(paceOf);
      ui.session = null;
      res.bracket = (/\\(your pace: (\\d+) s a move\\)/.exec(clockText(insAt(2))[1]) || [])[1];
      /* the base rate: three more of the other big mistakes made quick */
      allMistakes().filter(function (it) { return !(it.b.d > 0) && it.b.tt >= 10; }).slice(0, 3).forEach(function (it) { it.b.tt = 5; });
      res.quick = clockText(insAt(3))[2];
      /* tier 1 says the unit where the time before it is in minutes */
      lost.forEach(function (it) { it.b.tt = 75; });
      res.t1 = clockText(insAt(1))[1];
      /* no pace (each clock full before its move): no bracket */
      lost.forEach(function (it) { it.b.c = 1800; });
      res.none = clockText(insAt(2))[1];
      /* two formats frozen at different lines, each said */
      data.games[0].perf = 'blitz';
      trackedPerfs = function () { return ['rapid', 'blitz']; };
      res.two = sinceLine({ thr: { rapid: 15, blitz: 20 } }, 2);
      res.alike = sinceLine({ thr: { rapid: 15, blitz: 15 } }, 3);
      res.t1line = sinceLine({ thr: { rapid: 15, blitz: 20 } }, 1);
      return JSON.stringify(res); })()`));
    const B = boot();
    const row = B.ev(`(function () { SF.state = 'failed';
      var g = data.games.slice().sort(function (x, y) { return y.ts - x.ts; })[0];
      g.res = 'loss'; g.bl = null; modelDirty();
      return gameRowHtml(g, gamesIndex()[g.id]); })()`);
    eq(JSON.stringify(r[1].slice(2, 4)), JSON.stringify(['A big mistake: a move that made your position much worse.', 'Since you started, every game counts the same way.']), 'tier 1: a big mistake, and since you started counts every game the same way');
    eq(JSON.stringify(r[2].slice(2, 4)), JSON.stringify(['A big mistake cut your winning chances by 15 points or more (20 under 1200, 12 at 1800+).', 'To compare fairly, every game since you started counts at 15 points, your line when you started, even if your rating changes.']), 'tier 2: the line since you started counts at (V4.8\'s words)');
    eq(JSON.stringify(r[3]), JSON.stringify(r[2].concat(DECIDED_COUNT)), 'tier 3 the same, with what its rows on how games are decided count (F10.3)');
    eq(r.two, 'To compare fairly, since you started rapid games count at 15 points and blitz games at 20, your lines when you started, even if your rating changes.', 'two formats at different lines');
    eq(r.alike, 'To compare fairly, every game since you started counts at 15 points, your line when you started, even if your rating changes.', 'two formats at one line');
    eq(r.t1line, 'Since you started, every game counts the same way.', 'tier 1 names no number');
    const said = r.details.filter((x) => x != null).sort((a, b) => a - b), h = Math.floor(said.length / 2);
    ok(said.length >= 15 && JSON.stringify(r.details) === JSON.stringify(r.paces), 'Details says each losing move\'s pace as paceOf: ' + r.details.join(','));
    eq(+r.bracket, Math.round(said.length % 2 ? said[h] : (said[h - 1] + said[h]) / 2), 'the bracket is the median of Details\' paces over the moves that lost');
    eq(+r.bracket, 15, 'on the fixture, 15 s against the 18 s the moves that lost took');
    eq(r.quick, '7 of 26 deciding moves took under 10 s (24 of your 65 other big mistakes did too).', 'the other big mistakes counted as the deciding moves are');
    ok(/^The moves that lost took 1 minute 15 seconds \(you usually take \d+ seconds\), with 23 minutes left\.$/.test(r.t1), 'tier 1 keeps the unit beside minutes: ' + r.t1);
    eq(r.none, 'The moves that lost took 1:15, with 30 min left.', 'no pace, no bracket');
    ok(/No single losing move/.test(row) && !/big mistake/.test(row), 'the Games tab: a loss with no position to practise has no single losing move');
  });

  await test('truth fixes off the card: the landing, the footer, Settings, the paused set, the ••• menu and the site picker say only true things', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      SF.state = 'failed';
      var res = {}, boxes = {}, el0 = el;
      el = function (id) { if (/^(foot|whichSite|findBtn)$/.test(id)) return boxes[id] || (boxes[id] = { innerHTML: '', textContent: '', classList: { add: function () {}, remove: function () {} } }); return el0(id); };
      renderFirstVisit(); res.landing = el('main').innerHTML;
      var user = cfg.user, src = cfg.src;
      cfg.user = ''; cfg.src = 'lichess'; renderFoot(); res.footNone = boxes.foot.innerHTML;
      cfg.user = 'someone'; renderFoot(); res.footLi = boxes.foot.innerHTML;
      cfg.user = user; cfg.src = src; renderFoot(); res.footCc = boxes.foot.innerHTML;
      data.sections.games = 'ok'; res.settings = settingsHtml();
      res.resume = resumeHtml({ keys: ['a', 'b'], results: { a: 'first' }, relearn: [] });
      var a = openCard(allMistakes().filter(trainable)[0]);
      a.tier = 2; res.menu2 = menuHtml(a); a.tier = 1; res.menu1 = menuHtml(a);
      var mm = window.matchMedia;
      window.matchMedia = function (q) { return { matches: /pointer: coarse/.test(q) }; }; res.menuTouch = menuHtml(a);
      window.matchMedia = function (q) { return { matches: /pointer: fine/.test(q) }; }; res.menuMouse = menuHtml(a);
      window.matchMedia = mm;
      var notes = [], n0 = notice; notice = function (t) { notes.push(t); };
      a.attempts = 1; endSession(); res.paused = notes.slice(); notice = n0;
      /* the site picker: lichess silent, chess.com has the name */
      getJSON = function () { return Promise.reject({ code: 500 }); };
      ccJSON = function (p) { return Promise.resolve(/stats$/.test(p) ? { chess_rapid: { last: { rating: 1351 }, record: { win: 3, loss: 2, draw: 0 } } } : { username: 'tester2' }); };
      findUser('tester2');
      window.__boxes = boxes;
      return JSON.stringify(res); })()`));
    await tick(); await tick(); await tick();
    const which = A.ev('window.__boxes.whichSite.innerHTML');
    ok(r.landing.indexOf('In 169 of their 237 losses, one move turned the game for good. Piece safety decided 107.') >= 0 && !/biggest leak|came down to one big mistake|169 of your/.test(r.landing), 'the landing\'s proof');
    ok(r.landing.indexOf('A set is 5 to 10 of your own positions. Each comes back, with longer gaps as you get it right.') >= 0 && !/Five of your own|before you would forget/.test(r.landing), 'the landing\'s set');
    eq(JSON.stringify([/Donate to lichess/.test(r.footNone), /Donate to lichess/.test(r.footLi), /Donate to lichess/.test(r.footCc)]), '[false,true,false]', 'Donate to lichess for a lichess player only');
    ok(r.settings.indexOf('Saved in this browser: 50 games and your practice. Clearing browser data erases them.') >= 0, 'what this browser holds');
    ok(/>Reset</.test(r.settings) && !/>Start over</.test(r.settings), 'the data section is Reset');
    ok(r.settings.indexOf('Rapid · 10 min or more') >= 0 && r.settings.indexOf('Blitz · 3 to 10 min') >= 0 && !/–/.test(r.settings), 'the format chips read whole, in the site\'s own categories (V4.8)');
    ok(/>End this set</.test(r.resume) && !/Start over/.test(r.resume), 'the paused set ends with End this set');
    ok(/I think Stockfish is wrong/.test(r.menu2) && /I think the computer is wrong/.test(r.menu1) && !/engine/.test((r.menu1 + r.menu2).replace(/<[^>]+>/g, ' ')), 'the menu says who is wrong, never "engine"');
    eq(JSON.stringify([/menu-keys/.test(r.menuTouch), /menu-keys/.test(r.menuMouse), /menu-keys/.test(r.menu2)]), '[false,true,true]', 'the keys never on a touch screen, kept where a mouse or no pointer is reported');
    ok(r.paused.length === 1 && /^Set paused\. /.test(r.paused[0]), 'the toast: ' + r.paused.join(' | '));
    ok(/Is this you\?/.test(which) && /data-k="chesscom"/.test(which) && !/data-k="lichess"/.test(which) && /lichess did not answer/.test(which), 'only the site that confirmed the name: ' + which);
  });

  await test('the focus and the tab\'s dot show the moment the read ends: the deeper look running in the background never hides the focus', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed';
      var res = {}, calls = { train: 0, views: 0 }, rt = renderTrain, rv = renderViews;
      SF.state = 'ready'; scanState.running = false; scanState.pending = false; enrichState.running = true;
      res.focus = currentFocus();
      scanState.running = true; res.reading = currentFocus();
      renderTrain = function () { calls.train++; }; renderViews = function () { calls.views++; };
      ui.view = 'train'; ui.session = null; lastSigCheck = Date.now(); lastReadyShown = 3;
      renderAnalysisStatus();
      var before = { train: calls.train, views: calls.views };
      lastSigCheck = Date.now();
      scanState.running = false;
      renderAnalysisStatus();
      res.end = { train: calls.train - before.train, views: calls.views - before.views };
      lastSigCheck = Date.now();
      renderAnalysisStatus();
      res.again = { train: calls.train - before.train, views: calls.views - before.views };
      renderTrain = rt; renderViews = rv; enrichState.running = false; SF.state = 'failed';
      res.dot = tabDot();
      return JSON.stringify(res); })()`));
    ok(r.focus && r.focus.fam === 'safety', 'the focus while the deeper look runs: ' + JSON.stringify(r.focus));
    eq(r.reading, null, 'no focus while the games are still read');
    eq(JSON.stringify(r.end), JSON.stringify({ train: 1, views: 1 }), 'Today and the tabs repainted as the read ends');
    eq(JSON.stringify(r.again), JSON.stringify({ train: 1, views: 1 }), 'once');
    eq(r.dot, true, 'practice waiting: the dot');
  });

  await test('measures: the visit\'s tags and the events that have a place today fire once at their trigger and carry no name, rating or position', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      SF.state = 'failed';
      var calls = [];
      window.clarity = function () { calls.push([].slice.call(arguments).map(String)); };
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var blob = ''; Blob = function (parts) { blob = parts[0]; };
      returnEvents();
      var its = allMistakes().filter(trainable);
      var a = openCard(its[0]); solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      a = openCard(its[1]); reveal();
      setView('insights'); setView('insights'); setView('train'); setView('insights'); setView('train');
      exportProgress();
      var map = srsLoad(), now = Date.now();
      map[its[2].key] = { box: 3, streak: 2, due: now - 1000, last: now - 17 * DAY, ls: now - 17 * DAY, lapses: 0 };
      srsSave(map);
      srsRecord(its[2], 'first', { ms: 9000, attempted: true });
      srsRecord(its[2], 'first', { ms: 9000, attempted: true });
      ui.session = { mode: 'more', label: 'x', keys: [its[3].key, its[4].key, its[5].key], idx: 3, results: {}, relearn: [], relearnOf: {}, attempted: 3 };
      finishSession();
      ui.session = { mode: 'more', label: 'x', keys: [its[3].key], idx: 1, results: {}, relearn: [], relearnOf: {}, attempted: 3 };
      finishSession();
      return JSON.stringify({ calls: calls, logged: /nl:log:cc:tester/.test(blob) }); })()`));
    const ev = (n) => r.calls.filter((c) => c[0] === 'event' && c[1] === n).length, tag = (k) => r.calls.filter((c) => c[0] === 'set' && c[1] === k).map((c) => c[2]);
    eq(JSON.stringify([tag('first_week'), tag('tier'), tag('installed')]), JSON.stringify([['2026-W40'], ['2'], ['no']]), 'the visit\'s tags');
    eq(JSON.stringify([ev('first_card_result'), tag('first_card')]), JSON.stringify([1, ['first']]), 'the first card\'s result, once');
    eq(ev('insights_open'), 2, 'each time Insights opens');
    eq(ev('export_done'), 1, 'a progress file saved');
    eq(r.logged, true, 'the file carries the practice log');
    eq(ev('learned'), 1, 'a position learned, once');
    eq(ev('day_counted'), 1, 'the day counted, once');
    const flat = JSON.stringify(r.calls);
    ok(!/tester|135\d|\b\d{12}\b|[a-h][1-8][a-h][1-8]|\//.test(flat), 'no name, rating, key or position: ' + flat);
  });

  /* ── slice 4: the Coach Panel card and moments ── */
  await test('F4.3: after the answer Details says the ladder with the real interval: a miss on a box-3 card "Back to the start · back in 3 days"; a due clean find on box 2 "Step 2 of 3 · back in N days"; the find that makes it learned "Learned · one last check in N days"; a first sight with a hint "Starting out · back tomorrow"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }), now = Date.now(), srs = srsLoad(), out = {};
      var when = function () { return (/<span class="when">([^<]*)</.exec(detailsHtml()) || [])[1]; };
      var days = function (it) { return daysFrom(Date.now(), srsRec(it).due); };
      var best = function (a) { a.attempts = Math.max(1, a.attempts); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); };
      srs[its[0].key] = { box: 3, streak: 2, due: now - 3600e3, last: now - 16 * DAY, ls: now - 16 * DAY, lapses: 0 };
      srs[its[1].key] = { box: 2, streak: 1, due: now - 3600e3, last: now - 7 * DAY, ls: now - 7 * DAY, lapses: 0 };
      srs[its[2].key] = { box: 3, streak: 2, due: now - 3600e3, last: now - 16 * DAY, ls: now - 16 * DAY, lapses: 0 };
      srsSave(srs);
      /* a miss (not the game move), then found */
      var a = openCard(its[0]); a.misses = 1; best(a);
      out.miss = when();
      a = openCard(its[1]); best(a);
      out.step = when(); out.stepDays = days(its[1]);
      a = openCard(its[2]); best(a);
      out.learned = when(); out.learnedDays = days(its[2]); out.isLearned = !!srsRec(its[2]).learned;
      a = openCard(its[3]); a.hints = 1; best(a);
      out.hint = when();
      return JSON.stringify(out); })()`));
    eq(r.miss, 'Back to the start · back in 3 days', 'a miss on a box-3 card');
    eq(r.step, 'Step 2 of 3 · back in ' + r.stepDays + ' days', 'a due clean find on box 2, with the real interval');
    ok(r.stepDays >= 16 && r.stepDays <= 18, 'the step before learned: 16 to 18 days, never fewer (C3): ' + r.stepDays);
    ok(r.isLearned, 'the third clean find 16 days on is learned');
    eq(r.learned, 'Learned · one last check in ' + r.learnedDays + ' days', 'learned, with its one last check');
    eq(r.hint, 'Starting out · back tomorrow', 'one day reads "tomorrow"');
  });

  await test('F4.4, F4.5: a set that makes a position learned and meets the week\'s goal shows both: the seal stamps, the medal shows as it ends, "Goal met: 1 day this week."; the ding, then the four notes; drawn again, nothing moves or sounds; a goal alone settles its medal; a set with neither plays its own; the summary in order, the next set in the bar at its foot', () => {
    const A = boot();
    A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      window.__snd = []; snd = function (n) { window.__snd.push(n + '@' + Date.now()); };
      var it = model().byKey['184455333378:68'], best = function (a) { a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); };
      /* card 1 found clean three times: at first sight, when due, then 16 days on */
      var a = openCard(it); best(a);
      shiftDays(Math.ceil((srsRec(it).due - Date.now()) / DAY)); a = openCard(it); best(a);
      shiftDays(Math.max(16, Math.ceil((srsRec(it).due - Date.now()) / DAY)));
      /* the week's goal of 1, not yet met this week: the third find meets it */
      store.set('nl:weekGoal', 1); store.del('nl:goalSent:' + playerId());
      rewardLog.splice(0); window.__snd = [];
      a = openCard(it); best(a);
      ui.session.active = null; ui.session.finished = true;
      window.__ss1 = ui.session;
      return 1; })()`);
    const r1 = JSON.parse(A.ev(`(function () { var ss = window.__ss1, h = doneHtml(ss); summaryMoments(ss);
      return JSON.stringify({ learned: !!srsRec(model().byKey['184455333378:68']).learned, goal: ss.goalMet, seal: /<div class="recap-item recap-learned" data-fx="seal"/.test(h), medal: (/<span class="medal"( data-fx="medal")? aria-hidden="true"><\\/span>/.exec(h) || [''])[0],
        line: /Goal met: 1 day this week\\./.test(h), sounds: window.__snd.map(function (x) { return x.split('@')[0]; }), rewards: rewardLog.map(function (x) { return x.kind; }),
        order: ['result-row', 'id="recap-h"', 'recap-moved', 'recap-week met', 'class="recap"', 'recap-habit', 'recap-acts'].map(function (k) { return h.indexOf(k); }),
        acts: (/<div class="acts-row recap-acts">([\\s\\S]*?)<\\/div>/.exec(h) || [])[1] || '' }); })()`));
    A.advance(500);
    const r2 = JSON.parse(A.ev(`(function () { var ss = window.__ss1, h = doneHtml(ss); summaryMoments(ss);
      return JSON.stringify({ sounds: window.__snd.map(function (x) { return x.split('@')[0]; }), gap: window.__snd.length > 1 ? +window.__snd[1].split('@')[1] - +window.__snd[0].split('@')[1] : null, fx: /data-fx=/.test(h) }); })()`));
    ok(r1.learned && !!r1.goal, 'learned, and the goal met in this set');
    ok(r1.seal, 'the learned tile stamps its seal');
    eq(r1.medal, '<span class="medal" aria-hidden="true"></span>', 'the medal shows as it ends');
    ok(r1.line, '"Goal met: 1 day this week."');
    eq(JSON.stringify(r1.sounds), JSON.stringify(['learned']), 'the ding first');
    eq(JSON.stringify(r1.rewards), JSON.stringify(['learned', 'goal']), 'both moments');
    eq(JSON.stringify(r2.sounds), JSON.stringify(['learned', 'goal']), 'then the four notes');
    eq(r2.gap, 450, 'the notes 450 ms after the ding');
    ok(!r2.fx, 'drawn again: nothing moves, nothing more sounds');
    ok(r1.order.every((x, i) => x > 0 && (i === 0 || x > r1.order[i - 1])), 'the summary in order: result row, headline, what moved, the week, the tiles, the habit card, the bar: ' + r1.order.join(' '));
    ok(/^<a class="btn-big" data-icon="arrow" data-act="keepGoing">Next set of \d+<\/a><a class="btn-line" data-act="endSession">Back to Today<\/a>$/.test(r1.acts), 'the bar: the next set, then the way back: ' + r1.acts);
    /* a goal alone settles its medal; a set with neither plays its own sound */
    const r3 = JSON.parse(A.ev(`(function () {
      var mk = function (goal) { var k = allMistakes().filter(trainable)[3].key, ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true, goalMet: goal };
        ss.results[k] = 'first'; ss.sum[k] = { c: 'first', s: 3, m: 'up', p: 1 }; return ss; };
      window.__snd = []; rewardLog.splice(0);
      var g = mk({ days: 4, goal: 4 }), hg = doneHtml(g); summaryMoments(g);
      var n = mk(null), hn = doneHtml(n); summaryMoments(n);
      return JSON.stringify({ medal: /<span class="medal" data-fx="medal" aria-hidden="true">/.test(hg), line: /Goal met: 4 days this week\\./.test(hg), plain: !/data-fx="medal"/.test(hn) && !/Goal met/.test(hn),
        sounds: window.__snd.map(function (x) { return x.split('@')[0]; }), rewards: rewardLog.map(function (x) { return x.kind; }) }); })()`));
    ok(r3.medal && r3.line, 'a goal alone: its medal settles, its line');
    ok(r3.plain, 'neither: no medal moment and no goal-met line (the week row\'s medal at the goal stays as the week stands, F5.1)');
    eq(JSON.stringify(r3.sounds), JSON.stringify(['goal', 'set']), 'the four notes; a set with neither its own three');
    eq(JSON.stringify(r3.rewards), JSON.stringify(['goal']), 'one moment');
  });

  await test('F4.4: the week\'s goal met brings its medal once a week, and again in a week met after a week missed (the run of weeks at the goal is 1 both times)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      store.set('nl:weekGoal', 1); store.del('nl:goalSent:' + playerId());
      var out = [], day = function () { var d = dayLoad(); d.counted = 1; daySave(d); }, ss;
      day(); ss = {}; goalCheck(ss); out.push(!!ss.goalMet, weeksAtGoal());
      ss = {}; goalCheck(ss); out.push(!!ss.goalMet);
      /* two weeks on, last week missed: this week's first counted day meets it again */
      shiftDays(14);
      day(); ss = {}; goalCheck(ss); out.push(!!ss.goalMet, weeksAtGoal());
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r), JSON.stringify([true, 1, false, true, 1]), 'met, once that week, met again two weeks on');
  });

  /* ── slice 5: Today and the way back ── */
  await test('F5.1: Today shows card 1 as it opens, beside its caption, Start and the week; the board is the card\'s own opening frame (the red arrow, never the First look\'s hint nor the answer), a tap on it starts; while the games are read a still square waits in its place', () => {
    const A = boot({ storage: Object.assign(base(), { 'nl:tip:game': '1' }) });
    const r = JSON.parse(A.ev(`(function () {
      var norm = function (s) { return String(s).replace(/(checkglow|ah)b\\d+/g, '$1B'); }, out = {};
      [1, 2].forEach(function (tier) {
        playerTier = function () { return tier; };
        var plan = todayPlan(), it = model().byKey[plan.keys[0]], h = heroHtml();
        var board = (/<a class="hero-board" data-act="startToday"[^>]*>(<svg[\\s\\S]*?<\\/svg>)<\\/a>/.exec(h) || [])[1] || '';
        var f = boardOptsFor(cardFor(it)), own = boardSvg(f.st, Object.assign({}, f.opts, { decor: true, fx: null }));
        /* the card in a set: at tier 1 its First look draws hint 1's marks on it */
        ui.session = { mode: 'today', label: 'Today', keys: plan.keys, idx: 0, results: {}, relearn: [], relearnOf: {} };
        var a = cardFor(it), look = workedExample(a), sb = boardSvg(boardOptsFor(a).st, Object.assign({}, boardOptsFor(a).opts, { decor: true }));
        ui.session = null;
        out[tier] = { order: ['<h2 id="hero-n"', 'class="hero-first"', 'data-act="startToday">Start<', 'class="week"'].map(function (k) { return h.indexOf(k); }),
          same: !!board && norm(board) === norm(own), red: (board.match(/class="bad-arrow"/g) || []).length, marks: /good-arrow|threat-arrow|ring-|class="badge/.test(board),
          cap: (/class="why hero-cap">([^<]*)</.exec(h) || [])[1], first: it.key, opp: it.g.opp, d: it.b.d, look: look, lookMarks: /threat-arrow|ring-/.test(sb) };
      });
      out.reading = findingHtml({ total: 40, covered: 3, ready: 0, working: true });
      return JSON.stringify(out); })()`));
    [1, 2].forEach((t) => {
      const x = r[t];
      ok(x.order.every((v, i) => v > 0 && (i === 0 || v > x.order[i - 1])), 'tier ' + t + ': the title, the board beside its caption, Start, the week: ' + x.order.join(' '));
      ok(x.same, 'tier ' + t + ': the board is card 1\'s opening frame, drawn by the card\'s own code');
      eq(x.red, 1, 'tier ' + t + ': the red arrow of the game move');
      ok(!x.marks, 'tier ' + t + ': no hint, no answer, no verdict on it');
    });
    eq(r[2].first, '184455333378:68', 'card 1 is the move that lost the latest game');
    eq(r[2].cap, 'First: the move that lost vs opponent1.', 'its caption');
    ok(r[1].look && r[1].lookMarks, 'at tier 1 the card opens on its First look, hint 1 drawn');
    ok(!r[1].marks, 'Today\'s board never shows that hint');
    ok(/<span class="hero-board wait" aria-hidden="true"><\/span><p class="why hero-cap">Stockfish checks your moves/.test(r.reading) && !/<svg/.test(r.reading), 'while reading: a still square in the board\'s place');
  });

  await test('F5.1: the week: Monday to Sunday, the first week\'s goal cut to the days it has left: a first practice on a Saturday with goal 4 reads "1 of 2 days this week (your first week)" (V4.4), a Sunday set meets it once, Monday reads "0 of 4 days this week · 1 week in a row" and "2 practice days"; no zero part anywhere on Today', () => {
    const A = boot({ now: T0 + 5 * 864e5 });
    const at = (d, code) => { A.setNow(T0 + d * 864e5); return JSON.parse(A.ev(code)); };
    const SAY = `(function () { var h = weekHtml(); return { say: (/class="wk-say">([^<]*)</.exec(h) || [])[1], life: (/class="wk-life">([^<]*)</.exec(h) || [])[1] || '',
      on: (h.match(/class="wk-b on/g) || []).length, now: (/<span class="wk-b( on)? now">/.exec(h) || [])[0] || '', medal: /<span class="medal"/.test(h), goal: weekGoalInfo(Date.now()).goal }; })()`;
    A.ev(`(function () { window.clarity = function () { window.__calls = (window.__calls || []).concat([Array.prototype.slice.call(arguments).map(String)]); }; store.set('nl:weekGoal', 4); return 1; })()`);
    const sat0 = at(5, 'JSON.stringify(' + SAY + ')');
    const sat = at(5, `(function () { var d = dayLoad(); d.counted = 1; daySave(d); var ss = {}; goalCheck(ss); return JSON.stringify({ w: ${SAY}, met: !!ss.goalMet }); })()`);
    const sun = at(6, `(function () { var d = dayLoad(); d.counted = 1; daySave(d); var ss = {}, ss2 = {}; goalCheck(ss); goalCheck(ss2);
      return JSON.stringify({ w: ${SAY}, met: ss.goalMet, again: !!ss2.goalMet, sent: (window.__calls || []).filter(function (c) { return c[1] === 'week_goal_met'; }).length }); })()`);
    const mon = at(7, `(function () { var today = heroHtml() + focusHtml() + whyTheseHtml(todayPlan()); return JSON.stringify({ w: ${SAY}, weeks: weeksAtGoal(), zero: /(^|\\D)0 (learned|in practice|not started|weeks?|practice days?)/.test(today.replace(/<[^>]+>/g, ' ')) }); })()`);
    eq(sat0.say, '0 of 2 days this week (your first week)', 'a Saturday start, before practice: the days left, said as a short week (V4.4)');
    eq(sat0.life, '', 'no "0 practice days"');
    eq(sat.w.say, '1 of 2 days this week (your first week)', 'first practice on a Saturday with goal 4');
    eq(sat.w.life, '1 practice day', 'the lifetime count');
    eq(sat.w.on + '|' + sat.w.now, '1|<span class="wk-b on now">', 'Saturday filled with its tick and ringed as today');
    ok(!sat.met && !sat.w.medal, 'not met yet: the medal glyph waits at the goal');
    eq(JSON.stringify(sun.met), JSON.stringify({ days: 2, goal: 2, cut: 'first' }), 'a Sunday set meets it');
    eq(sun.again, false, 'once');
    eq(sun.sent, 1, 'its measure once');
    eq(sun.w.say, '2 of 2 days this week (your first week) · 1 week in a row', 'Sunday');
    ok(sun.w.medal, 'the medal at the goal, met');
    eq(mon.w.say, '0 of 4 days this week · 1 week in a row', 'Monday: the full goal again, the first week counted');
    eq(mon.w.life, '2 practice days', 'two practice days in all');
    eq(mon.w.goal, 4, 'goal 4');
    ok(!mon.zero, 'no zero part on Today');
  });

  await test('F5.1: the focus card: the skill\'s glyph and name, its check line, a meter of its positions in words with zero parts dropped ("38 not started", then "1 in practice · 37 not started"); V4.7: one tap target with a chevron that opens the skill\'s sheet, no Practise 8 or Details', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 2; };
      var words = function (h) { return { name: (/class="focus-name">([^<]*)</.exec(h) || [])[1], glyph: (/class="sk-glyph" data-icon="(\\w+)"/.exec(h) || [])[1], line: (/<div class="plan">([^<]*)</.exec(h) || [])[1],
        prog: (/class="focus-prog">([^<]*)</.exec(h) || [])[1], bar: (h.match(/<i class="sk-\\w"/g) || []).join(''),
        tap: (/^<a class="focus focus-go" data-act="sheet" data-k="([^"]*)" role="button"/.exec(h) || [])[1] || '', chev: /class="focus-chev"/.test(h),
        rest: (h.match(/data-act=/g) || []).length + '|' + /btn|Practise|Details/.test(h) + '|' + (h.match(/class="fr-bar/g) || []).length }; };
      var f0 = words(focusHtml());
      var it = allMistakes().filter(function (x) { return trainable(x) && familyOf(patternOf(x.b)).key === 'safety'; })[0];
      srsRecord(it, 'first', { ms: 30000, attempted: true });
      var f1 = words(focusHtml());
      return JSON.stringify({ f0: f0, f1: f1 }); })()`));
    eq(JSON.stringify([r.f0.name, r.f0.glyph, r.f0.line]), JSON.stringify(['Piece safety', 'shield', 'Before you move: their checks, captures, threats?']), 'its glyph, name and check line');
    eq(r.f0.prog, '38 not started', 'a fresh player: no "0 learned"');
    eq(r.f0.bar, '<i class="sk-g"', 'its meter all not started');
    eq(JSON.stringify([r.f0.tap, r.f0.chev, r.f0.rest]), JSON.stringify(['family:safety', true, '1|false|1']), 'one tap target, its chevron, opening the skill\'s sheet; one meter; no Practise 8 or Details (V4.7)');
    eq(r.f1.prog, '1 in practice · 37 not started', 'after a first clean find: progress from day one');
    eq(r.f1.bar, '<i class="sk-c"<i class="sk-g"', 'the meter fills by a step');
  });

  await test('F5.2: the diagnosis shows on each summary until it has shown in full once: the first summary "Your report builds as you practise: 12 of 40 games read.", then "So far: ...", then with the read done the full card ("In 25 of your 27 losses, one move turned the game for good.", the top three skills, "You started on the biggest: Piece safety.", See your report ›, reveal_seen once), then one line ("Piece safety: 1 climbing · 37 to go."); tier 1\'s words; Today\'s "Why these?"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      window.__calls = []; window.clarity = function () { window.__calls.push([].slice.call(arguments).map(String)); };
      var cov0 = coverage, ro0 = readOver, out = {};
      var its = allMistakes().filter(trainable), safe = its.filter(function (x) { return familyOf(patternOf(x.b)).key === 'safety'; })[0];
      var set = function () { var ss = { mode: 'today', label: 'Today', keys: [safe.key], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true, sum: {} };
        ss.results[safe.key] = 'first'; ss.sum[safe.key] = { c: 'first', s: 3, m: 'up', p: 1, l: lineOfStep(3, 2), st: 3 }; return ss; };
      var diag = function (h) { var m = /<section class="diag"[\\s\\S]*?<\\/section>/.exec(h); return m ? m[0].replace(/<[^>]+>/g, '\\n').split('\\n').map(function (x) { return x.trim(); }).filter(Boolean) : null; };
      var line = function (h) { return ((/<p class="diag-line">([\\s\\S]*?)<\\/p>/.exec(h) || [])[1] || '').replace(/<[^>]+>/g, ''); };
      var seen = function () { return window.__calls.filter(function (c) { return c[1] === 'reveal_seen'; }).length; };
      srsRecord(safe, 'first', { ms: 30000, attempted: true });
      coverage = function () { return { total: 40, covered: 12, losses: 3, decided: 2 }; }; readOver = function () { return false; };
      var s1 = set(), h1 = doneHtml(s1); summaryMoments(s1);
      out.first = { card: diag(h1), seen: seen(), before: h1.indexOf('class="diag"') < h1.indexOf('class="result-row"') };
      coverage = function () { return { total: 40, covered: 20, losses: 9, decided: 7 }; };
      var s2 = set(), h2 = doneHtml(s2); summaryMoments(s2);
      out.sofar = diag(h2);
      coverage = cov0; readOver = function () { return true; };
      var s3 = set(), h3 = doneHtml(s3); summaryMoments(s3);
      out.full = { card: diag(h3), seen: seen(), again: diag(doneHtml(s3)), link: /data-act="reportOpen">See your report ›</.test(h3) };
      var s4 = set(), h4 = doneHtml(s4); summaryMoments(s4);
      out.later = { card: diag(h4), line: line(h4), seen: seen() };
      playerTier = function () { return 1; };
      var c = cueLoad(); delete c.rv; cueSave(c);
      out.t1 = diag(doneHtml(set()));
      out.why = [2, 1].map(function (t) { playerTier = function () { return t; }; return (/<a data-act="view" data-k="insights">([^<]*)<\\/a>/.exec(whyTheseHtml(todayPlan())) || [])[1]; });
      readOver = ro0;
      window.__calls = [];
      window.__realmClick && window.__realmClick('reportOpen');
      out.open = { calls: window.__calls.filter(function (c) { return c[1] === 'reveal_open'; }).length, view: ui.view };
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.first.card), JSON.stringify(['Your games, read', 'Your report builds as you practise: 12 of 40 games read.', 'See your report ›']), 'first summary: the read under way, under 5 losses');
    ok(r.first.before, 'above the result row');
    eq(r.first.seen, 0, 'not yet seen in full');
    eq(r.sofar[1], 'So far: in 7 of your 9 losses, one move turned the game for good.', '5 losses read, the read under way');
    eq(r.full.card[0] + ' | ' + r.full.card[1], 'Your games, read | In 25 of your 27 losses, one move turned the game for good.', 'the read done: the full card');
    eq(JSON.stringify(r.full.card.slice(2, 8)), JSON.stringify(['Piece safety', 'decided 16 games', 'King safety', 'decided 6 games', 'Quiet moves', 'decided 2 games']), 'the top three skills with the games they decided');
    eq(r.full.card[8], 'You started on the biggest: Piece safety.', 'the skill practised first');
    ok(r.full.link, 'See your report ›');
    eq(r.full.seen, 1, 'reveal_seen once');
    eq(JSON.stringify(r.full.again), JSON.stringify(r.full.card), 'drawn again, the same card');
    eq(r.later.card, null, 'after it has shown in full: no card');
    eq(r.later.line, 'Piece safety: 1 in practice · 37 not started.', 'one line, zero parts dropped');
    eq(r.later.seen, 1, 'seen once only');
    eq(r.t1[1], 'In 25 of your 27 losses, one move cost you the game.', 'tier 1\'s headline');
    eq(r.t1[8], 'Your first skill: Piece safety.', 'tier 1\'s skill line');
    eq(JSON.stringify(r.why), JSON.stringify(['Why these? Piece safety decided 16 of your games ›', 'Why these? Piece safety cost you 16 games ›']), 'Today, under the hero, at tiers 2 and 1');
    eq(JSON.stringify(r.open), JSON.stringify({ calls: 1, view: 'insights' }), 'See your report opens Insights, reveal_open once');
  });

  await test('F5.3: a game read with no big mistake: "Clean game vs opponent41: no big mistakes." shown once (still there while the page stays), not after a reload; a newer clean game gets its own line once', () => {
    const A = boot();
    const first = A.ev('cleanLineHtml() + "|" + cleanLineHtml()');
    const B = makeApp({ now: T0 + 3600e3, storage: Object.assign({}, A.storage) });
    const again = B.ev('cleanLineHtml()');
    B.ev(`(function () { var g = JSON.parse(JSON.stringify(data.games.filter(function (x) { return x.opp === 'opponent41'; })[0]));
      g.id = 'clean2'; g.opp = 'opponent99'; g.ts = Date.now() - 600e3; data.games.unshift(g); modelDirty(); saveGames(data.games); return 1; })()`);
    const C = makeApp({ now: T0 + 7200e3, storage: Object.assign({}, B.storage) });
    const newer = C.ev('cleanLineHtml()');
    const D = makeApp({ now: T0 + 9000e3, storage: Object.assign({}, C.storage) });
    eq(first, '<p class="clean-line">Clean game vs opponent41: no big mistakes.</p>|<p class="clean-line">Clean game vs opponent41: no big mistakes.</p>', 'shown, and kept while the page stays');
    eq(again, '', 'not after a reload');
    eq(newer, '<p class="clean-line">Clean game vs opponent99: no big mistakes.</p>', 'a newer clean game, once');
    eq(D.ev('cleanLineHtml()'), '', 'then not again');
  });

  await test('F5.4: the calendar file: Evening and goal 4 repeat Mon, Tue, Thu and Sat at 19:30 for 10 minutes from the next of those days, with an alarm at the start and the link, and name no minutes; the goal\'s other days and times; the Google Calendar link carries the same', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`JSON.stringify({ ics: icsText('evening', cueDays(4), Date.now()), g3: icsText('morning', cueDays(3), Date.now()), g5: icsText('midday', cueDays(5), Date.now()), g7: icsText('evening', cueDays(7), Date.now()),
      gcal: gcalUrl('evening', cueDays(4), Date.now()), when: [cueWhen('evening'), (store.set('nl:weekGoal', 5), cueWhen('morning')), (store.set('nl:weekGoal', 7), cueWhen('midday'))] })`));
    const lines = r.ics.split('\r\n'), unfolded = r.ics.replace(/\r\n /g, '');
    ok(/\r\n$/.test(r.ics) && !/[^\r]\n/.test(r.ics), 'CRLF line ends');
    ok(lines.every((l) => l.length <= 75), 'no line over 75 octets');
    ok(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/.test(r.ics) && /END:VEVENT\r\nEND:VCALENDAR\r\n$/.test(r.ics), 'a calendar with one event');
    ok(unfolded.indexOf('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,TH,SA\r\n') >= 0, 'weekly on Mon, Tue, Thu, Sat');
    /* T0 is a Monday at 14:00: the next goal day is Tuesday */
    ok(unfolded.indexOf('DTSTART:20260929T193000\r\n') >= 0 && unfolded.indexOf('DTEND:20260929T194000\r\n') >= 0, 'at 19:30 local, 10 minutes, from the next goal day: ' + (/DTSTART:\S+/.exec(unfolded) || [''])[0]);
    ok(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:notlichess: your practice\r\nTRIGGER:PT0S\r\nEND:VALARM/.test(unfolded), 'an alarm at the start');
    ok(unfolded.indexOf('SUMMARY:notlichess: your practice\r\n') >= 0 && unfolded.indexOf('DESCRIPTION:A few minutes on positions from your own games.\\nhttps://notlichess.org/#train\r\n') >= 0, 'its title, its note and the link');
    ok(unfolded.indexOf('URL:https://notlichess.org/#train') >= 0, 'the link');
    ok(!/\d\s*(minutes?|mins?)\b/i.test(unfolded) && /A few minutes on/.test(unfolded), 'names no count of minutes (D12): "A few minutes"');
    ok(/BYDAY=MO,WE,FR/.test(r.g3) && /DTSTART:\d{8}T080000/.test(r.g3), 'goal 3: Mon, Wed, Fri; morning 08:00');
    ok(/BYDAY=MO,TU,WE,TH,FR\r\n/.test(r.g5) && /DTSTART:\d{8}T123000/.test(r.g5), 'goal 5: Monday to Friday; midday 12:30');
    ok(/BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n/.test(r.g7), 'goal 7: every day');
    ok(r.gcal.indexOf('https://calendar.google.com/calendar/render?action=TEMPLATE&text=notlichess%3A%20your%20practice&dates=20260929T193000/20260929T194000') === 0
      && r.gcal.indexOf('&recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3DMO%2CTU%2CTH%2CSA') > 0 && r.gcal.indexOf(encodeURIComponent('https://notlichess.org/#train')) > 0, 'the Google Calendar link: ' + r.gcal);
    eq(JSON.stringify(r.when), JSON.stringify(['At 7:30 pm on Mon, Tue, Thu and Sat.', 'At 8:00 am Monday to Friday.', 'At 12:30 pm every day.']), 'the reminder in words, in the device\'s time format (V4.6; Node\'s default locale has a 12-hour clock)');
  });

  await test('F5.4: the reminder asks once, on the first summary after the habit card (that day\'s others until answered): Not now hides it (cue_notnow, the cue tag); Evening then Add to calendar makes the file (cue_calendar, the tag "evening") and Settings keeps it; the tab title "(3) notlichess.org" with 3 due, "notlichess.org" with none', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      window.__calls = []; window.clarity = function () { window.__calls.push([].slice.call(arguments).map(String)); };
      var blob = null; Blob = function (parts, o) { blob = { text: parts[0], type: o && o.type }; };
      var made = null; document.createElement = function () { var a = { click: function () { made = a.download; }, remove: function () {}, setAttribute: function () {}, style: {} }; return a; };
      var k = allMistakes().filter(trainable)[0].key, mk = function () { var ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true }; ss.results[k] = 'first'; return ss; };
      var q = function (h) { return /When will you practise\\?/.test(h); }, out = {};
      var s1 = mk(), h1 = doneHtml(s1); summaryMoments(s1);
      out.first = { ask: q(h1), order: h1.indexOf('recap-habit') < h1.indexOf('id="cue"') && h1.indexOf('id="cue"') < h1.indexOf('recap-acts'), chips: (h1.match(/data-act="cueSlot" data-k="(\\w+)"/g) || []).length, no: /data-act="cueNo">Not now</.test(h1), add: /data-act="cueAdd"/.test(h1) };
      out.later = q(doneHtml(mk()));
      window.__realmClick('cueNo');
      out.no = { again: q(doneHtml(mk())), ev: window.__calls.filter(function (c) { return c[1] === 'cue_notnow'; }).length, tag: window.__calls.filter(function (c) { return c[0] === 'set' && c[1] === 'cue'; }).map(function (c) { return c[2]; }), stored: !!cueLoad().no };
      /* another player's first summary, a day later than first asked and never answered: not asked */
      var c = cueLoad(); delete c.no; c.q = Date.now() - 2 * DAY; cueSave(c);
      out.nextDay = q(doneHtml(mk()));
      delete c.q; cueSave(c); window.__calls = [];
      var s2 = mk(); ui.session = s2; doneHtml(s2);
      window.__realmClick('cueSlot', 'evening');
      out.picked = { when: cueWhen('evening'), card: cueCardHtml(s2) };
      window.__realmClick('cueAdd', 'evening');
      out.added = { ev: window.__calls.filter(function (c) { return c[1] === 'cue_calendar'; }).length, tag: window.__calls.filter(function (c) { return c[0] === 'set' && c[1] === 'cue'; }).map(function (c) { return c[2]; }),
        file: made, type: blob && blob.type, rrule: /BYDAY=MO,TU,TH,SA/.test(blob && blob.text), stored: cueLoad().slot, card: cueCardHtml(s2), after: q(doneHtml(mk())), settings: /data-act="cueSlot" data-k="evening" aria-pressed="true"/.test(settingsHtml()), tagNow: cueTag() };
      ui.session = null;
      /* the tab's title */
      var srs = srsLoad(), now = Date.now();
      allMistakes().filter(trainable).slice(0, 3).forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: now - 3600e3, last: now - 3 * DAY, lapses: 0 }; });
      srsSave(srs); paintTitle(); out.title3 = document.title;
      allMistakes().filter(trainable).slice(0, 3).forEach(function (x) { srs[x.key].due = now + 5 * DAY; });
      srsSave(srs); paintTitle(); out.title0 = document.title;
      return JSON.stringify(out); })()`));
    ok(r.first.ask && r.first.order, 'the first summary asks, after the habit card, before the bar');
    ok(r.first.chips === 3 && r.first.no && !r.first.add, 'Morning, Midday, Evening and Not now; Add to calendar once a time is picked');
    eq(r.later, true, 'that day\'s next summary asks again while unanswered');
    eq(JSON.stringify(r.no), JSON.stringify({ again: false, ev: 1, tag: ['notnow'], stored: true }), 'Not now: hidden, measured, tagged');
    eq(r.nextDay, false, 'not asked on a later day');
    ok(/At 7:30 pm on Mon, Tue, Thu and Sat\./.test(r.picked.card) && /data-act="cueAdd" data-k="evening">Add to calendar</.test(r.picked.card) && /data-act="cueGcal" data-k="evening">Google Calendar ›</.test(r.picked.card)
      && /data-k="evening" aria-pressed="true"/.test(r.picked.card), 'Evening picked: what the reminder will be, Add to calendar and Google Calendar');
    eq(JSON.stringify([r.added.ev, r.added.tag, r.added.file, r.added.type, r.added.rrule, r.added.stored]), JSON.stringify([1, ['evening'], 'notlichess-practice.ics', 'text/calendar;charset=utf-8', true, 'evening']), 'the file made, measured and tagged');
    ok(/Open the file to add it to your calendar\./.test(r.added.card) && /data-act="cueGcal"/.test(r.added.card), 'the card says how to finish');
    eq(r.added.after, false, 'never asked again');
    ok(r.added.settings, 'Settings keeps the reminder, Evening lit');
    eq(r.added.tagNow, 'evening', 'the cue tag for later visits');
    eq(r.title3, '(3) notlichess.org', '3 due');
    eq(r.title0, 'notlichess.org', 'none due');
  });

  await test('F5.4 with V4.5: the backup prompt: not before the 3rd practice day; on its summary "Your progress lives only in this browser. Save a copy?" (Save a file, Later); Later waits 30 practice days; a file saved waits 30 practice days from then, says where it went ("Saved to notlichess-tester-2026-09-28.json.") and Settings says when ("Last saved: 28 Sept", before that "Never saved"); the first summary after 7 or more days away asks when nothing was saved in 14 days; Safari on an iPhone outside the home-screen app every 7 practice days, with "Or add notlichess to your home screen."', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var k = allMistakes().filter(trainable)[0].key, out = {}, notes = [], n0 = notice;
      notice = function (m) { notes.push(m); };
      var mk = function (o) { var ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true }; Object.keys(o || {}).forEach(function (x) { ss[x] = o[x]; }); ss.results[k] = 'first'; return ss; };
      var c = cueLoad(); c.q = Date.now() - 2 * DAY; cueSave(c);
      var Q = /Your progress lives only in this browser\\. Save a copy\\?/, HOME = /<p class="cue-when">Or add notlichess to your home screen\\.<\\/p>/;
      var prompt = function (o) { return Q.test(doneHtml(mk(o))); };
      var off = 40, days = function (n) { for (var i = 0; i < n; i++) store.set('nl:day:' + playerId() + ':' + dayStamp(new Date(Date.now() - (off++) * DAY)), { counted: 1 }); };
      out.fresh = prompt();
      days(2); out.d2 = prompt();
      days(1);
      var h = doneHtml(mk());
      out.d3 = { prompt: Q.test(h), acts: /data-act="backupSave">Save a file<\\/a><a class="btn-quiet" data-act="backupLater">Later</.test(h), after: h.indexOf('id="cue"') > h.indexOf('recap-habit'), home: HOME.test(h) };
      out.never = (/<p class="last-saved">([^<]*)<\\/p>/.exec(settingsHtml()) || [])[1];
      var s = mk(); ui.session = s; doneHtml(s); window.__realmClick('backupLater'); ui.session = null;
      out.later = { prompt: prompt(), bk: cueLoad().bk };
      days(29); out.d32 = prompt();
      days(1); out.d33 = prompt();
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      exportProgress();
      out.saved = { prompt: prompt(), bk: cueLoad().bk, note: notes.filter(function (m) { return /^Saved to /.test(m); }), last: (/<p class="last-saved">([^<]*)<\\/p>/.exec(settingsHtml()) || [])[1] };
      /* after a break: the day's first summary (ss.away), when nothing was saved in 14 days */
      out.away = [prompt({ away: 14 })];
      c = cueLoad(); c.sv = Date.now() - 15 * DAY; cueSave(c);
      out.away.push(prompt({ away: 14 }), prompt());
      /* Safari on an iPhone, in a tab: every 7 practice days, and the home screen named */
      navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      days(6); out.ios6 = prompt();
      days(1); h = doneHtml(mk()); out.ios7 = [Q.test(h), HOME.test(h)];
      navigator.standalone = true; out.app = prompt();
      notice = n0;
      return JSON.stringify(out); })()`));
    eq(r.fresh, false, 'not on a fresh profile');
    eq(r.d2, false, 'not on the 2nd practice day');
    eq(JSON.stringify(r.d3), JSON.stringify({ prompt: true, acts: true, after: true, home: false }), 'the 3rd practice day\'s summary, after the habit card, with Save a file and Later');
    eq(r.never, 'Never saved', 'Settings, before a file is saved');
    eq(JSON.stringify(r.later), JSON.stringify({ prompt: false, bk: 3 }), 'Later: gone, noted at 3 practice days');
    eq(r.d32, false, '29 practice days on: not yet');
    eq(r.d33, true, '30 practice days on: again');
    eq(JSON.stringify(r.saved), JSON.stringify({ prompt: false, bk: 33, note: ['Saved to notlichess-tester-2026-09-28.json.'], last: 'Last saved: 28 Sept' }), 'a file saved: where it went, Settings says when, and not again for 30 practice days');
    eq(JSON.stringify(r.away), '[false,true,false]', 'after 7 or more days away: not with a file saved today; with none in 14 days, on that first summary only');
    eq(r.ios6, false, 'Safari on an iPhone: not 6 practice days on');
    eq(JSON.stringify(r.ios7), '[true,true]', '7 practice days on, with "Or add notlichess to your home screen."');
    eq(r.app, false, 'the home-screen app waits the 30');
  });

  await test('the design lead\'s review of slice 4 on the summary: the headline and its category line, then when they come back (V4.3: "Back in 7 days: 1.") in one quiet paragraph before the week; the habit card\'s kicker "Keep in mind", its check lines under one bulb, the routine after them in small words', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 2; };
      var its = allMistakes().filter(trainable).slice(0, 2), k1 = its[0].key, k2 = its[1].key, srs = srsLoad(), now = Date.now();
      srs[k1] = { box: 2, streak: 1, due: now + 7 * DAY, last: now, lapses: 0 }; srsSave(srs);
      var ss = { mode: 'today', label: 'Today', keys: [k1, k2], idx: 2, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true, routine: true };
      ss.results[k1] = 'first'; ss.results[k2] = 'retry';
      ss.sum[k1] = { c: 'first', s: 3, fc: '', l: lineOfStep(3, 2), st: 3, m: 'up', p: 1 };
      ss.sum[k2] = { c: 'miss', s: 1, fc: '3', l: lineOfStep(1, 2), st: 1, m: 'start', p: 0 };
      var h = doneHtml(ss), habit = (/<div class="focus recap-habit">([\\s\\S]*?)<\\/div><section|<div class="focus recap-habit">([\\s\\S]*?)<\\/div><div class="acts-row/.exec(h) || []);
      habit = habit[1] || habit[2] || '';
      return JSON.stringify({ stack: (/<h2 class="done-big"[^>]*>[^<]*<\\/h2>(<p class="recap-then">[^<]*<\\/p>)?(<p class="recap-small">[\\s\\S]*?<\\/p>)<div class="recap-week/.exec(h) || [])[2] || '', habit: habit }); })()`));
    ok(/^<p class="recap-small"><span class="recap-moved">Back in 7 days: 1\.<\/span><\/p>$/.test(r.stack), 'one quiet paragraph, then the week: ' + r.stack);
    ok(/^<div class="kicker">Keep in mind<\/div><div class="plan"><ul class="plans"><li class="keep-line">[^<]+<\/li><li class="keep-line">[^<]+<\/li><\/ul><\/div><p class="routine-line">Every move: their move, your chances, safety check\.<\/p>$/.test(r.habit),
      'the kicker, two lines under one bulb (one .plan), the routine after them: ' + r.habit);
  });

  /* ── the installable app (F11.1): sw.js in test/sw.js; the page's side here ── */
  await test('F11.1: the service worker (test/sw.js): VERSION carries the hash of the files kept cache-first; one cache per version, filled all or nothing, the older ones deleted; the page and the manifest network first, the kept copy offline, on an error or after NET_WAIT; Stockfish, the icons and the font (V5.4) cache first, Stockfish refilled as a pair, the .js held open until its .wasm; chess.com, lichess, Clarity and other sites never answered or kept; the off switch (test/sw-off.js, V5.6) deletes only the notlichess- caches and unregisters, and README.md gives it word for word with the Render headers and the two checks', async () => {
    const f = await require('./sw')();
    eq(f.length, 0, f.length + ' service worker failures: ' + f.slice(0, 6).join(' || '));
  });

  /* a browser with a service worker, and Clarity's calls, as the realm's own */
  const SW = `(function () { window.__sw = []; window.__calls = [];
    window.clarity = function () { window.__calls.push(Array.prototype.slice.call(arguments)); };
    navigator.serviceWorker = { register: function (u, o) { window.__sw.push([u, o && o.updateViaCache]); return Promise.resolve({ update: function () { window.__sw.push(['update']); return Promise.resolve(); } }); } };
    return 1; })()`;
  const EVENTS = `JSON.stringify(window.__calls.filter(function (c) { return c[0] === 'event'; }).map(function (c) { return c[1]; }))`;
  await test('F11.1: the page registers sw.js once, with a player and once Stockfish has settled, never on a first visit\'s landing or without service workers; an app left open checks for a new version when it comes back, at most hourly', async () => {
    const A = boot();
    eq(A.ev('swState.asked'), false, 'no service workers in this browser: nothing asked');
    A.ev(SW);
    A.ev('swRegister(); swRegister(); 1');
    await tick(); await tick();
    eq(A.ev('JSON.stringify(window.__sw)'), JSON.stringify([['sw.js', 'none']]), 'registered once, sw.js beside the page, never from the browser\'s cache');
    eq(A.ev('!!swState.reg'), true, 'the registration kept');
    /* an hour on, the page shown again: one check for a new version; again at once: none */
    A.advance(3600 * 1000 + 1);
    A.fire('visibilitychange'); A.fire('visibilitychange');
    await tick();
    eq(A.ev('JSON.stringify(window.__sw)'), JSON.stringify([['sw.js', 'none'], ['update']]), 'one check an hour on');
    /* Stockfish still loading: the worker waits for it */
    const B = boot();
    B.ev(SW);
    B.ev('(function () { var go; SF.loading = new Promise(function (r) { go = r; }); window.__go = go; swRegister(); return 1; })()');
    await tick(); await tick();
    eq(B.ev('window.__sw.length'), 0, 'not while Stockfish downloads');
    B.ev('window.__go(); 1');
    await tick(); await tick();
    eq(B.ev('window.__sw.length'), 1, 'once it is in');
    /* the landing: no player, nothing registered */
    const L = makeApp({ now: T0, storage: {} });
    L.ev(SW);
    L.ev('swRegister(); 1');
    await tick(); await tick();
    eq(L.ev('window.__sw.length'), 0, 'a first visit\'s landing registers nothing');
  });

  /* a finished set on the summary, the week's goal met or not, the player first seen days days ago; the
     reminder's question (F5.4) answered Not now that day, so its place holds nothing (cue: an nl:cue of its own) */
  const SUMMARY = (days, goal, cue) => `(function () {
    store.set('nl:firstSeen:' + playerId(), Date.now() - ${days} * DAY);
    store.set('nl:cue:' + playerId(), ${cue || `Object.assign(cueLoad(), { q: Date.now() - ${days} * DAY, no: Date.now() - ${days} * DAY })`});
    var k = allMistakes().filter(trainable)[3].key, ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true, goalMet: ${goal ? '{ days: 4, goal: 4 }' : 'null'} };
    ss.results[k] = 'first'; ss.sum[k] = { c: 'first', s: 3, m: 'up', p: 1 }; ss.fxShown = true;
    ui.session = ss; return 1; })()`;
  const PROMPT = `(function () { window.__prompted = 0; installPromptSeen({ preventDefault: function () { window.__prevented = 1; }, prompt: function () { window.__prompted++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) }); return 1; })()`;
  const PHONE = `(function () { window.matchMedia = function (q) { return { matches: /coarse/.test(q) }; }; return 1; })()`;
  const CARD = `(function () { var h = doneHtml(ui.session), m = /<div class="focus recap-install">([\\s\\S]*?)<\\/div><\\/div>/.exec(h);
    return JSON.stringify({ card: m ? m[1].replace(/<[^>]+>/g, '|').replace(/\\|+/g, '|') : null, acts: m ? (m[1].match(/data-act="\\w+"/g) || []).join(' ') : '',
      at: [h.indexOf('recap-habit'), h.indexOf('recap-install'), h.indexOf('recap-acts')], kept: store.get('nl:install', null) }); })()`;
  await test('F11.1: the install offer comes on the first summary with the week\'s goal met, never on the first visit\'s day, once: "Add notlichess to your home screen?" [Add] [Not now] on a phone, "Install notlichess as an app?" [Install] on a desktop, "and works offline" only when the page is kept; after the habit card, before the bar; held back from the browser until then', () => {
    const A = boot();
    A.ev(SW); A.ev(PHONE); A.ev(PROMPT);
    eq(A.ev('window.__prevented'), 1, 'the browser\'s own offer held back');
    /* the goal met on the player's first day: no offer */
    A.ev(SUMMARY(0, true));
    let r = JSON.parse(A.ev(CARD));
    eq(r.card, null, 'not on the first visit\'s day'); eq(r.kept, null, 'nothing noted');
    /* a later day, a set that did not meet the goal: no offer */
    A.ev(SUMMARY(3, false));
    eq(JSON.parse(A.ev(CARD)).card, null, 'not without the goal met');
    /* a later day, the goal met: the offer, after the habit card, before the bar */
    A.ev(SUMMARY(3, true));
    r = JSON.parse(A.ev(CARD));
    eq(r.card, '|Add notlichess to your home screen?|Add|Not now|', 'the phone\'s offer');
    eq(r.acts, 'data-act="installApp" data-act="installLater"', 'Add, Not now');
    ok(r.at[0] > 0 && r.at[1] > r.at[0] && r.at[2] > r.at[1], 'after the habit card, before the bar: ' + r.at);
    ok(r.kept && r.kept.kind === 'prompt', 'noted once, this browser\'s');
    eq(A.ev(EVENTS), JSON.stringify(['install_offer']), 'measured');
    /* drawn again: it stays; the next summary with the goal met: never again */
    eq(JSON.parse(A.ev(CARD)).card, '|Add notlichess to your home screen?|Add|Not now|', 'it stays while the summary does');
    A.ev(SUMMARY(10, true));
    eq(JSON.parse(A.ev(CARD)).card, null, 'offered once');
    /* the page kept by the worker: why, in one line; a desktop installs */
    const D = boot();
    D.ev(SW); D.ev(PROMPT); D.ev('navigator.serviceWorker.controller = {}; 1');
    D.ev(SUMMARY(3, true));
    eq(JSON.parse(D.ev(CARD)).card, '|Install notlichess as an app?|It opens in its own window, and works offline.|Install|Not now|', 'the desktop\'s offer, offline when kept');
    const P = boot();
    P.ev(SW); P.ev(PHONE); P.ev(PROMPT); P.ev('navigator.serviceWorker.controller = {}; 1');
    P.ev(SUMMARY(3, true));
    eq(JSON.parse(P.ev(CARD)).card, '|Add notlichess to your home screen?|It opens in one tap, and works offline.|Add|Not now|', 'the phone\'s, offline when kept');
    /* a browser with no offer (and not an iPhone): nothing, and nothing noted for later */
    const F = boot();
    F.ev(SW); F.ev(SUMMARY(3, true));
    r = JSON.parse(F.ev(CARD));
    eq(r.card, null, 'no offer to make'); eq(r.kept, null, 'nothing noted');
    /* the installed app: nothing */
    const I = boot();
    I.ev(SW); I.ev(PROMPT); I.ev('navigator.standalone = true; 1'); I.ev(SUMMARY(3, true));
    eq(JSON.parse(I.ev(CARD)).card, null, 'not in the installed app');
  });

  await test('F11.1: Add opens the browser\'s own dialog once and the card goes, its answer measured; Not now takes the card away; once installed the offer is gone from Settings too', async () => {
    const A = boot();
    A.ev(SW); A.ev(PHONE); A.ev(PROMPT); A.ev(SUMMARY(3, true));
    ok(JSON.parse(A.ev(CARD)).card, 'the offer');
    A.click('installApp', null, null, { detail: 1 });
    await tick(); await tick();
    eq(A.ev('window.__prompted'), 1, 'the browser\'s dialog, once');
    eq(JSON.parse(A.ev(CARD)).card, null, 'the card goes');
    eq(A.ev(EVENTS), JSON.stringify(['install_offer', 'install_add', 'install_accepted']), 'the answer measured');
    eq(A.ev('installSettingsHtml()'), '', 'the offer used: Settings has none left');
    A.click('installApp', null, null, { detail: 1 });
    await tick();
    eq(A.ev('window.__prompted'), 1, 'never twice from one offer');
    /* Not now */
    const B = boot();
    B.ev(SW); B.ev(PHONE); B.ev(PROMPT); B.ev(SUMMARY(3, true));
    ok(JSON.parse(B.ev(CARD)).card, 'the offer');
    B.click('installLater', null, null, { detail: 1 });
    eq(JSON.parse(B.ev(CARD)).card, null, 'Not now: the card goes');
    eq(B.ev('window.__prompted'), 0, 'no dialog');
    eq(B.ev(EVENTS), JSON.stringify(['install_offer', 'install_later']), 'measured');
    ok(/data-act="installApp"/.test(B.ev('installSettingsHtml()')), 'Settings still offers it');
    /* installed from the browser's menu: never offered again */
    const C = boot();
    C.ev(SW); C.ev(PHONE); C.ev(PROMPT); C.ev('appInstalled(); 1');
    eq(C.ev(EVENTS), JSON.stringify(['app_installed']), 'measured');
    eq(C.ev('installSettingsHtml()'), '', 'Settings offers nothing');
    C.ev(SUMMARY(3, true));
    eq(JSON.parse(C.ev(CARD)).card, null, 'nor the summary');
  });

  await test('F11.1: on an iPhone or iPad the summary and Settings say how: "Tap Share, then Add to Home Screen. The app starts empty: save a progress file here, then load it there." with Save a progress file; the home-screen app\'s landing loads the file saved in Safari', () => {
    const A = boot();
    A.ev(SW);
    A.ev(`navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'; 1`);
    eq(A.ev('installKind()'), 'ios', 'an iPhone');
    A.ev(SUMMARY(3, true));
    const r = JSON.parse(A.ev(CARD));
    eq(r.card, '|Add notlichess to your home screen?|Tap Share|, then Add to Home Screen. The app starts empty: save a progress file here, then load it there.|Save a progress file|Not now|', 'the how-to');
    eq(r.acts, 'data-act="exportProgress" data-act="installLater"', 'Save a progress file, Not now');
    ok(/<span class="ios-share" aria-hidden="true"><\/span>/.test(A.ev('doneHtml(ui.session)')), 'Share drawn as iOS draws it, hidden from a screen reader');
    eq(A.ev(EVENTS), JSON.stringify(['install_howto']), 'measured');
    /* Settings: the how-to, right above the progress file's buttons */
    const s = A.ev('settingsHtml()');
    ok(/<span class="kicker">App<\/span><p>Tap Share<span class="ios-share" aria-hidden="true"><\/span>, then Add to Home Screen\. The app starts empty: save a progress file here, then load it there\.<\/p><\/div><div class="set-block"><span class="kicker">Your data<\/span><div class="chips"><a class="chip" data-act="exportProgress">Save progress to a file<\/a><a class="chip" data-act="importProgress">Load progress from a file<\/a>/.test(s), 'Settings: the how-to above the file\'s buttons: ' + s.slice(s.indexOf('App<'), s.indexOf('App<') + 200));
    /* an iPad calls itself a Mac with a touch screen */
    const P = boot();
    P.ev(`navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'; navigator.platform = 'MacIntel'; navigator.maxTouchPoints = 5; 1`);
    eq(P.ev('installKind()'), 'ios', 'an iPad');
    P.ev('navigator.maxTouchPoints = 0; 1');
    eq(P.ev('installKind()'), '', 'a Mac');
    /* the home-screen app: what it does in Settings; its first landing loads the file saved in Safari */
    const H = makeApp({ now: T0, storage: {} });
    H.ev(SW);
    H.ev(`navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'; navigator.standalone = true; navigator.serviceWorker.controller = {}; renderFirstVisit(); 1`);
    const land = H.ev(`el('main').innerHTML`);
    ok(/<p class="handoff">Used notlichess in Safari\? Load the progress file you saved there\. <a class="btn-line" data-act="importProgress">Load progress from a file<\/a><\/p>/.test(land), 'the landing: ' + (/<p class="handoff">[\s\S]*?<\/p>/.exec(land) || [''])[0]);
    eq(H.ev('installSettingsHtml()'), '<div class="set-block set-app"><span class="kicker">App</span><p>This is the installed app. It works offline, from your saved games.</p><p>Used notlichess in Safari? Load the progress file you saved there.</p></div>', 'Settings in the app');
  });

  /* merged with slice 5 (F5.4): the place after the habit card holds one ask a summary */
  await test('F11.1 with F5.4: the offer never shares a summary with the reminder\'s question or the backup prompt: it waits, nothing noted or measured, nor once the question is answered there, and comes on the next summary with the goal met; Settings has Reminders, then App right above Your data', () => {
    /* the backup prompt is due on the 3rd practice day (V4.5) */
    const THIRD = `(function () { for (var i = 1; i <= 3; i++) store.set('nl:day:' + playerId() + ':' + dayStamp(new Date(Date.now() - i * DAY)), { counted: 1 }); return 1; })()`;
    const A = boot();
    A.ev(SW); A.ev(PHONE); A.ev(PROMPT);
    /* a player here for days, on the first summary since the reminder came (never asked): the question, no offer */
    A.ev(SUMMARY(3, true, '{}'));
    let h = A.ev('doneHtml(ui.session)');
    ok(/When will you practise\?/.test(h) && h.indexOf('recap-habit') < h.indexOf('id="cue"') && h.indexOf('id="cue"') < h.indexOf('recap-acts'), 'the question, after the habit card, before the bar');
    let r = JSON.parse(A.ev(CARD));
    eq(r.card, null, 'no offer beside it'); eq(r.kept, null, 'nothing noted'); eq(A.ev(EVENTS), '[]', 'nothing measured');
    /* Not now: the question goes, and no offer takes its place on this summary */
    A.click('cueNo', null, null, { detail: 1 });
    r = JSON.parse(A.ev(CARD));
    eq(r.card, null, 'none in its place'); eq(r.kept, null, 'still nothing noted'); eq(A.ev(EVENTS), JSON.stringify(['cue_notnow']), 'only the answer measured');
    /* the next summary with the goal met: the offer, alone after the habit card */
    A.ev(SUMMARY(4, true));
    h = A.ev('doneHtml(ui.session)');
    r = JSON.parse(A.ev(CARD));
    eq(r.card, '|Add notlichess to your home screen?|Add|Not now|', 'the offer, a summary later');
    ok(!/id="cue"/.test(h) && r.at[0] > 0 && r.at[1] > r.at[0] && r.at[2] > r.at[1], 'alone after the habit card, before the bar: ' + r.at);
    eq(A.ev(EVENTS), JSON.stringify(['cue_notnow', 'install_offer']), 'measured then');
    /* the backup prompt due (the 3rd practice day) takes the place; after Later, the next summary offers */
    const B = boot();
    B.ev(SW); B.ev(PHONE); B.ev(PROMPT); B.ev(THIRD);
    B.ev(SUMMARY(3, true));
    ok(/Your progress lives only in this browser\. Save a copy\?/.test(B.ev('doneHtml(ui.session)')), 'the backup prompt');
    r = JSON.parse(B.ev(CARD));
    eq(r.card, null, 'no offer beside it'); eq(r.kept, null, 'nothing noted');
    B.click('backupLater', null, null, { detail: 1 });
    B.ev(SUMMARY(4, true));
    eq(JSON.parse(B.ev(CARD)).card, '|Add notlichess to your home screen?|Add|Not now|', 'then the offer');
    /* an iPhone: no how-to beside the backup prompt either */
    const I = boot();
    I.ev(SW); I.ev(`navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'; 1`); I.ev(THIRD);
    I.ev(SUMMARY(3, true));
    r = JSON.parse(I.ev(CARD));
    eq(r.card, null, 'no how-to beside it'); eq(r.kept, null, 'nothing noted'); eq(I.ev(EVENTS), '[]', 'nothing measured');
    /* Settings keeps both: Reminders, then the App block right above Your data */
    const s = I.ev('settingsHtml()'), rem = s.indexOf('<span class="kicker">Reminders</span>'), app = s.indexOf('<span class="kicker">App</span>');
    ok(rem > 0 && app > rem && /<span class="kicker">App<\/span>((?!set-block)[\s\S])*<\/div><div class="set-block"><span class="kicker">Your data</.test(s), 'Reminders, then App right above Your data');
  });

  await test('F11.1: Settings offers the app where the browser can install it, "and works offline" only when the page is kept, and says nothing where it cannot', () => {
    const A = boot();
    A.ev(SW);
    eq(A.ev('installSettingsHtml()'), '', 'no offer, no iPhone, not installed: nothing');
    ok(!/kicker">App</.test(A.ev('settingsHtml()')), 'no App block');
    A.ev(PHONE); A.ev(PROMPT);
    eq(A.ev('installSettingsHtml()'), '<div class="set-block set-app"><span class="kicker">App</span><p>It opens in one tap.</p><a class="btn-line" data-act="installApp">Add to home screen</a></div>', 'a phone, the page not kept yet');
    A.ev('navigator.serviceWorker.controller = {}; 1');
    eq(A.ev('installSettingsHtml()'), '<div class="set-block set-app"><span class="kicker">App</span><p>It opens in one tap, and works offline.</p><a class="btn-line" data-act="installApp">Add to home screen</a></div>', 'a phone, the page kept');
    A.ev('window.matchMedia = function () { return { matches: false }; }; 1');
    eq(A.ev('installSettingsHtml()'), '<div class="set-block set-app"><span class="kicker">App</span><p>It opens in its own window, and works offline.</p><a class="btn-line" data-act="installApp">Install</a></div>', 'a desktop');
    /* Settings opens the offer at any time, the first day too, and it is not the summary's once */
    A.ev(`store.set('nl:firstSeen:' + playerId(), Date.now()); 1`);
    ok(/installApp/.test(A.ev('installSettingsHtml()')), 'the first day too');
  });

  /* ── v2 slice 4: sets, the summary and the way back (V4.1 to V4.8) ──
     playSet(miss) answers a whole set on the page: each card found (its best move, or its line played
     out); miss(a, i) true makes the i-th card's first showing a miss first (the game's move, then Try
     again) */
  const PLAYSET = `function playSet(miss) {
  for (var i = 0; i < 80 && ui.session && !ui.session.finished; i++) {
    var a = ui.session.active;
    if (!a) { loadCard(); a = ui.session.active; if (!a) break; }
    if (a.phase === 'lesson') { lessonStep(1); continue; }
    if (miss && !a.sol && !a.prac && !a.foil && a.playedUci && !ss_relearn(a) && miss(a, i)) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); tryAgain(); }
    if (a.sol) { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
    else if (a.phase !== 'done') { a.attempts = (a.attempts || 0) + 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); }
    if (a.phase !== 'done') finishCard('first');
    nextCard();
  }
}`;
  await test('V4.1: "Tomorrow" is the set Today will deal: after Today and one more set (a third of the cards missed first), at sizes 10 and 5, the summary\'s Tomorrow count is the set the next day deals; 9 due at size 10: all 9 in the set (the new slot is kept for a new position only while fewer than a set\'s worth are due), and nothing "more due today" after it; one left reads "Your next set starts with the one still due." (C4: never "1 more is ready in the next set" above the next set\'s button)', () => {
    const run = (size) => JSON.parse(boot().ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', ${size});
      var out = {}, miss = function (a, i) { return i % 3 === 1; };
      startToday(); out.first = ui.session.keys.length; playSet(miss);
      keepGoing(); out.more = ui.session.keys.length; playSet(miss);
      out.said = (/class="recap-next">([^<]*)</.exec(doneHtml(ui.session)) || [])[1];
      ui.session = null;
      window.__nlTest.shiftDays(1);
      absorbOpen();
      startToday();
      out.dealt = ui.session.keys.length;
      return JSON.stringify(out); })()`));
    const count = (s) => { const m = /Tomorrow: (?:a set of (\d+)|(\d+) positions?), about \d+ minutes?/.exec(s || ''); return m ? +(m[1] || m[2]) : null; };
    [10, 5].forEach((size) => {
      const r = run(size);
      ok(r.first > 0 && r.more > 0, size + ': Today and one more set played: ' + r.first + ', ' + r.more);
      eq(count(r.said), r.dealt, size + ': the summary\'s Tomorrow ("' + r.said + '") is the set dealt the next day');
    });
    const q = JSON.parse(boot().ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var its = allMistakes().filter(trainable), now = Date.now(), srs = {};
      its.slice(0, 9).forEach(function (x) { srs[x.key] = { box: 2, streak: 1, due: now - 3600e3, last: now - 3 * DAY, ls: now - 3 * DAY, lapses: 0, n: 1 }; });
      srsSave(srs); absorbOpen();
      var p = todayPlan(), nine = its.slice(0, 9).map(function (x) { return x.key; });
      var out = { plan: [nine.every(function (k) { return p.keys.indexOf(k) >= 0; }), p.dueTaken, p.fresh, p.keys.length] };
      startToday(); out.dealt = nine.every(function (k) { return ui.session.keys.indexOf(k) >= 0; }); playSet();
      out.left = dueCards().length; out.after = nextDueHtml();
      var s2 = srsLoad(), x = its.filter(function (it) { return !s2[it.key]; })[0];
      s2[x.key] = { box: 2, streak: 1, due: Date.now() - 3600e3, last: Date.now() - 3 * DAY, ls: Date.now() - 3 * DAY, lapses: 0, n: 1 }; srsSave(s2);
      out.one = nextDueHtml();
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(q.plan), '[true,9,1,10]', '9 due at size 10: all 9 in the plan, and one new position');
    eq(q.dealt, true, 'and in the set dealt');
    ok(q.left === 0 && /^Tomorrow: /.test(q.after) && !/due today|more (is|are) ready/.test(q.after), 'after it nothing is left due today, so the summary goes on to tomorrow: ' + q.after);
    ok(/^Your next set starts with the one still due\. Tomorrow: /.test(q.one), 'one due left: ' + q.one);
  });

  await test('V4.3: tier 1\'s summary: the kid\'s day 1 at 700 (four found after misses, one shown) reads "You found 4 of 5." then "4 took more than one try, 1 was shown.", 5 filled stars across 5 groups leading the page; the earned stars fill in order, at most 80 ms apart and 1.2 s in all, then the seal (a position learned) or the medal (the goal met), never with them; under reduced motion the end state at once; tiers 2 and 3 "2 of 5 found first try." then "2 after a miss · 1 shown"', () => {
    const A = boot();
    const SET = `var its = allMistakes().filter(trainable);
      var mk = function (cats, stars, o) { var ks = its.slice(0, cats.length).map(function (x) { return x.key; }), ss = { mode: 'today', label: 'Today', keys: ks, idx: ks.length, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
        ks.forEach(function (k, i) { ss.results[k] = cats[i] === 'shown' ? 'fail' : cats[i] === 'first' ? 'first' : 'retry'; ss.sum[k] = { c: cats[i], s: stars[i], fc: '' }; });
        Object.keys(o || {}).forEach(function (x) { ss[x] = o[x]; }); return ss; };
      var row = function (h) { var m = /<div class="result-row star-row( fx)?" aria-hidden="true">([\\s\\S]*?)<\\/div>/.exec(h) || [], x = m[2] || '';
        return { fx: !!m[1], groups: (x.match(/class="star-grp"/g) || []).length, on: (x.match(/class="st on"/g) || []).length, all: (x.match(/class="st[ "]/g) || []).length,
          d: (x.match(/--d:\\d+ms/g) || []).map(function (y) { return +/\\d+/.exec(y)[0]; }), lead: h.indexOf('star-row') > 0 && h.indexOf('star-row') < h.indexOf('id="recap-h"') }; };
      var words = function (h) { return [(/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], (/<p class="recap-then">([^<]*)</.exec(h) || [])[1]]; };`;
    const r = JSON.parse(A.ev(`(function () { ${SET}
      data.user = { perfs: { rapid: { rating: 700 } } }; SF.state = 'failed';
      var out = { tier: playerTier() };
      var kid = mk(['miss', 'miss', 'miss', 'miss', 'shown'], [1, 2, 1, 1, 0]), h = doneHtml(kid);
      out.kid = { words: words(h), row: row(h), lag: kid.starLag };
      summaryMoments(kid);
      out.again = row(doneHtml(kid));
      var all = mk(['first', 'first', 'first', 'first', 'first'], [3, 3, 3, 3, 3]); out.all = { words: words(doneHtml(all)), row: row(doneHtml(all)), lag: all.starLag };
      /* a position learned: its seal waits for the stars */
      var ln = mk(['first', 'miss', 'first'], [3, 1, 3]); ln.sum[ln.keys[0]].m = 'learned';
      var hl = doneHtml(ln); out.learned = { wait: /data-fx="seal-wait"/.test(hl), lag: ln.starLag };
      window.__ln = ln; window.__n0 = rewardLog.length; summaryMoments(ln);
      out.learned.early = rewardLog.slice(window.__n0).map(function (x) { return x.kind; });
      /* reduced motion: the end state at once */
      ui.reducedTest = true;
      var rm = mk(['first', 'miss', 'first'], [3, 1, 3]); rm.sum[rm.keys[0]].m = 'learned';
      var hr = doneHtml(rm); out.reduced = { row: row(hr), seal: /data-fx="seal"/.test(hr), lag: rm.starLag };
      ui.reducedTest = false;
      return JSON.stringify(out); })()`));
    A.advance(r.learned.lag + 50);
    const later = JSON.parse(A.ev('JSON.stringify(rewardLog.slice(window.__n0).map(function (x) { return x.kind; }))'));
    /* the goal met (a Thursday, the week's 4 days counted): its medal waits too */
    const medal = JSON.parse(boot({ now: T0 + 3 * 864e5 }).ev(`(function () { ${SET}
      data.user = { perfs: { rapid: { rating: 700 } } }; SF.state = 'failed'; store.set('nl:weekGoal', 4);
      for (var i = 0; i < 4; i++) store.set(dayKeyFor(new Date(Date.now() - i * DAY)), { counted: 1, sessions: 1 });
      var gm = mk(['first', 'first'], [3, 3], { goalMet: { days: 4, goal: 4, cut: '' } }), h = doneHtml(gm);
      return JSON.stringify([/data-fx="medal-wait"/.test(h), gm.starLag > 0, /Goal met: 4 days this week\./.test(h)]); })()`));
    const t2 = JSON.parse(A.ev(`(function () { ${SET}
      playerTier = function () { return 2; };
      var h = doneHtml(mk(['first', 'first', 'miss', 'miss', 'shown'], [3, 3, 1, 1, 0])), t2 = words(h);
      playerTier = function () { return 3; };
      return JSON.stringify(t2.concat(words(doneHtml(mk(['first', 'first', 'miss', 'miss', 'shown'], [3, 3, 1, 1, 0]))), /star-row/.test(h))); })()`));
    eq(r.tier, 1, 'a 700 player is at tier 1');
    eq(JSON.stringify(r.kid.words), JSON.stringify(['You found 4 of 5.', '4 took more than one try, 1 was shown.']), 'the kid\'s headline and its line: never "of 15", never "Then"');
    eq(JSON.stringify([r.kid.row.groups, r.kid.row.on, r.kid.row.all, r.kid.row.lead]), '[5,5,15,true]', '5 filled stars across 5 groups of three, leading the page');
    ok(r.kid.row.fx && r.kid.row.d.length === 5 && r.kid.row.d.every((x, i) => !i || (x - r.kid.row.d[i - 1] > 0 && x - r.kid.row.d[i - 1] <= 80)), 'they fill in order, at most 80 ms apart: ' + r.kid.row.d.join(','));
    eq(JSON.stringify([r.again.fx, r.again.d.length]), '[false,0]', 'on a later paint, no fill');
    eq(JSON.stringify(r.all.words), JSON.stringify(['You found all 5.', null]), 'all found: "You found all 5." and no second line');
    ok(r.all.row.d.length === 15 && r.all.row.d.every((x, i) => !i || x - r.all.row.d[i - 1] <= 80) && r.all.lag <= 1200 && r.all.row.d[14] + 200 === r.all.lag, '15 stars in 1.2 s in all: ' + r.all.row.d.join(',') + ' / ' + r.all.lag);
    ok(r.learned.wait && r.learned.lag > 0 && r.learned.early.indexOf('learned') < 0, 'the seal waits for the stars: ' + JSON.stringify(r.learned));
    ok(later.indexOf('learned') >= 0, 'then comes: ' + later.join(','));
    eq(JSON.stringify(medal), '[true,true,true]', 'the medal waits for them too');
    eq(JSON.stringify([r.reduced.row.fx, r.reduced.row.d.length, r.reduced.row.on, r.reduced.seal, r.reduced.lag]), '[false,0,7,true,0]', 'reduced motion: the stars (3 + 1 + 3) and the seal at once');
    eq(JSON.stringify(t2), JSON.stringify(['2 of 5 found first try.', '2 after a miss · 1 shown', '2 of 5 found first try.', '2 after a miss · 1 shown', false]), 'tiers 2 and 3: the first-try count, then the rest in one line; glyphs, no stars');
  });

  /* round 6 (kid550-r2, adult850-r2; growth M4): a lesson in a set's slot read "You found 9 of 10 ... 1 was
     skipped". A lesson is no position: never skipped, never counted; only what the player played or skipped */
  await test('a lesson in a set\'s slot is never "skipped": the kid\'s day 2 (a lesson in slot 2, 9 found first try) reads "You found all 9." at tier 1 and "9 of 9 found first try." at tier 2; a position the player skipped still counts', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      data.user = { perfs: { rapid: { rating: 700 } } }; SF.state = 'failed';
      var its = allMistakes().filter(trainable).slice(0, 9).map(function (x) { return x.key; });
      var mk = function (skipLast) {
        var ks = its.slice(0, 1).concat(['ls:free'], its.slice(1)), ss = { mode: 'today', label: 'Today', keys: ks, idx: ks.length, results: { 'ls:free': 'lesson' }, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
        its.forEach(function (k, i) { var c = skipLast && i === its.length - 1 ? 'skip' : 'first'; ss.results[k] = c === 'skip' ? 'skip' : 'first'; ss.sum[k] = { c: c, s: c === 'first' ? 3 : 0, fc: '' }; });
        return ss;
      };
      var text = function (h) { return [(/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], (/<p class="recap-then">([^<]*)</.exec(h) || [])[1] || '']; };
      var out = { tier: playerTier(), t1: text(doneHtml(mk(false))), score: recapScore(mk(false), mk(false).keys, 1), skip1: text(doneHtml(mk(true))) };
      playerTier = function () { return 2; };
      out.t2 = text(doneHtml(mk(false)));
      return JSON.stringify(out); })()`));
    eq(r.tier, 1, 'a 700 player is at tier 1');
    eq(JSON.stringify(r.t1), JSON.stringify(['You found all 9.', '']), 'the kid\'s day 2: "You found all 9.", nothing skipped');
    eq(JSON.stringify(r.score), JSON.stringify({ head: 'You found all 9.', then: '' }), 'the score itself');
    eq(JSON.stringify(r.skip1), JSON.stringify(['You found 8 of 9.', '1 was skipped.']), 'a position the player skipped still counts');
    eq(JSON.stringify(r.t2), JSON.stringify(['9 of 9 found first try.', '']), 'tier 2');
  });

  await test('V4.3: at tier 1 a found verdict on a card\'s first showing adds its stars after the verdict\'s glyph, off the board (they fill 80 ms apart with the found moment); none for the answer shown, on a retry, or at tier 2', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      data.user = { perfs: { rapid: { rating: 700 } } }; SF.state = 'failed';
      var its = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && a.playedUci; });
      var band = function (a) { var h = bandHtml(a, displayFor(a)), m = /<span class="bd-stars" aria-hidden="true">((?:<i class="st(?: on)?"><\\/i>)*)<\\/span>/.exec(h);
        return m ? (m[1].match(/st on/g) || []).length + '/' + (m[1].match(/class="st/g) || []).length + (h.indexOf('bd-stars') > h.indexOf('bd-disc') && h.indexOf('bd-stars') < h.indexOf('bd-rows') ? ' after the glyph' : ' elsewhere') : 'none'; };
      var out = {};
      var a = openCard(its[0]); a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); out.first = band(a);
      var b = openCard(its[1]); b.tapped = true; gradeMove(uciToMove(b.st, b.playedUci)); tryAgain(); b.attempts = 2; solved(uciToMove(b.st, b.bestUci), b.bestUci, null); out.miss = band(b);
      var c = openCard(its[2]); reveal(); out.shown = band(c);
      var e = openCard(its[3]); ui.session.keys.push(its[3].key); ui.session.relearnOf[its[3].key] = 1; ui.session.idx = 1; e = cardFor(its[3]); ui.session.active = e; e.attempts = 1; solved(uciToMove(e.st, e.bestUci), e.bestUci, null); out.retry = band(e);
      playerTier = function () { return 2; };
      var d = openCard(its[4]); d.attempts = 1; solved(uciToMove(d.st, d.bestUci), d.bestUci, null); out.t2 = band(d);
      return JSON.stringify(out); })()`));
    eq(r.first, '3/3 after the glyph', 'a first-try find: three stars after the verdict\'s glyph');
    eq(r.miss, '2/3 after the glyph', 'found after one miss: two of three (C10)');
    eq(r.shown, 'none', 'the answer shown: none');
    eq(r.retry, 'none', 'a retry: none (its stars were the first showing\'s)');
    eq(r.t2, 'none', 'tier 2: none');
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app.css'), 'utf8');
    ok(/\.bd-stars\.fx \.st:nth-child\(2\)::after\{animation-delay:80ms\}/.test(css) && /\.bd-stars\.fx \.st:nth-child\(3\)::after\{animation-delay:160ms\}/.test(css), 'the band\'s stars fill 80 ms apart');
  });

  await test('V4.4, C4: coming back after a break (three practice days, then 14 days to a Sunday): Today welcomes all through the return day ("Welcome back. Your practice waited where you left it.", a reload or two before the first set ends never uses it up), and reads "0 of 1 day this week (since you came back)", as Settings does ("This week has 1 day. From Monday: 4."); after one set "Goal met: 1 of 1 day since you came back." and, above the headline, "After 14 days away, you found F of N reviews first try." (tier 1 "After 14 days away, you found F of N."), with the backup prompt (V4.5: nothing saved in 14 days), neither on the next set; a new day opens on Today', () => {
    const A = boot({ now: T0 + 6 * 864e5 });
    A.ev(`(function () { playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:weekGoal', 4); return 1; })()`);
    const SAY = `(function () { var h = weekHtml(); return (/class="wk-say">([^<]*)</.exec(h) || [])[1]; })()`;
    const day = (later) => JSON.parse(A.ev(`(function () { ${PLAYSET}
      if (!${later}) { ui.session = null; startToday(); } else keepGoing();
      playSet(function (a, i) { return i % 2 === 0; });
      var ss = ui.session, h = doneHtml(ss); summaryMoments(ss); window.__ss = ss;
      return JSON.stringify({ away: ss.away || 0, rev: Object.keys(ss.rev || {}).length, week: ((/class="wk-say">([^<]*)</.exec(h) || [])[1]), recall: (/<p class="recall">([^<]*)</.exec(h) || [])[1] || '',
        backup: /Your progress lives only in this browser/.test(h), before: h.indexOf('class="recall"') < h.indexOf('id="recap-h"') }); })()`));
    const d1 = day(false); A.ev('window.__nlTest.shiftDays(1); 1');
    day(false); A.ev('window.__nlTest.shiftDays(1); 1');
    const d3 = day(false);
    A.click('backupLater');
    A.ev('ui.session = null; window.__nlTest.shiftDays(14); 1');
    const back = JSON.parse(A.ev(`JSON.stringify({ dow: new Date().getDay(), away: daysAway(), welcome: welcomeHtml(), again: welcomeHtml(), week: ${SAY}, settings: weekGoalLine() })`));
    const B = makeApp({ now: T0 + 6 * 864e5, storage: Object.assign({}, A.storage) });
    const reopen = B.ev('welcomeHtml()');
    const C = makeApp({ now: T0 + 6 * 864e5 + 3 * 3600e3, storage: Object.assign({}, B.storage) });
    const reopen2 = C.ev('welcomeHtml()');
    const set = day(false);
    const after = JSON.parse(A.ev(`JSON.stringify({ week: ${SAY}, settings: weekGoalLine(), t1: recallHtml(window.__ss, window.__ss.keys, 1), welcome: welcomeHtml() })`));
    const next = day(true);
    eq(JSON.stringify([d1.away, d3.backup]), '[0,true]', 'no break on the first day; the 3rd practice day\'s summary asks for a backup (answered Later)');
    eq(JSON.stringify([back.dow, back.away]), '[0,14]', 'a Sunday, 14 days after the last practice day');
    eq(back.welcome, '<p class="welcome-line">Welcome back. Your practice waited where you left it.</p>', 'the welcome on Today');
    eq(back.again, back.welcome, 'kept while the page stays');
    eq(reopen, back.welcome, 'reloaded before the first set: still there (C4: never used up when first drawn)');
    eq(reopen2, back.welcome, 'reloaded twice, three hours on: still there');
    eq(back.week, '0 of 1 day this week (since you came back)', 'a short week, said why');
    eq(back.settings, '<p>This week has 1 day. From Monday: 4.</p>', 'Settings matches Today');
    eq(set.away, 14, 'the day\'s first set after the break');
    ok(set.rev > 0, 'its reviews: ' + set.rev);
    ok(/^After 14 days away, you found \d+ of \d+ reviews first try\.( They come back sooner now\.)?$/.test(set.recall) && set.before, 'the recall line above the headline: ' + set.recall);
    const m = /found (\d+) of (\d+)/.exec(set.recall) || [];
    eq(/They come back sooner now\./.test(set.recall), +m[1] * 2 < +m[2], 'under half adds "They come back sooner now."');
    eq(set.week, 'Goal met: 1 of 1 day since you came back.', 'the goal met, in the short week\'s words');
    eq(set.backup, true, 'the backup prompt on the first summary back (nothing saved in 14 days)');
    eq(after.week, '1 of 1 day this week (since you came back) · 1 week in a row', 'Today after it: the short week met counts as a week at the goal');
    eq(after.settings, back.settings, 'Settings still matches Today');
    eq(after.welcome, '', 'the welcome goes once that day\'s first set has ended');
    ok(/^<p class="recall">After 14 days away, you found \d+ of \d+\.( They come back sooner now\.)?<\/p>$/.test(after.t1), 'tier 1: ' + after.t1);
    eq(JSON.stringify([next.away, next.recall, next.backup]), '[0,"",false]', 'the next set that day: neither the recall line nor the prompt');
    /* a new day opens on Today; the tab comes back on the day it was left */
    const stamp = (d) => JSON.parse(boot().ev(`JSON.stringify(dayStamp(new Date(Date.now() - ${d} * DAY)))`));
    const view = (d) => makeApp({ now: T0, storage: Object.assign(base(), { 'nl:view': JSON.stringify('insights'), 'nl:viewDay': JSON.stringify(stamp(d)) }) }).ev('ui.view');
    eq(view(0) + ' ' + view(1), 'insights train', 'left on Insights today: Insights; left yesterday: Today');
  });

  await test('V4.5: Erase everything and Reset practice history count a second tap only 1 to 6 s after the first: two taps 200 ms apart erase nothing (the armed row reads "Tap again to erase 50 games and your practice"); after 6 s the row disarms; a tap 1.5 s after the first resets', () => {
    const A = boot();
    A.ev(`(function () { var srs = srsLoad(), it = allMistakes().filter(trainable)[0]; srs[it.key] = { box: 2, streak: 1, due: Date.now() + DAY, last: Date.now(), lapses: 0, n: 1 }; srsSave(srs); return 1; })()`);
    A.click('wipe');
    const armed = A.ev(`(/data-act="wipe" class="danger-row armed">([^<]*)</.exec(settingsHtml()) || [])[1] || ''`);
    A.advance(200); A.click('wipe');
    const kept = JSON.parse(A.ev(`JSON.stringify([data.games.length, !!data.wiped, Object.keys(store.get(srsKey(), {})).length])`));
    A.advance(6500);
    const off = A.ev(`/danger-row armed/.test(settingsHtml())`);
    A.click('resetProgress'); A.advance(200); A.click('resetProgress');
    const r1 = A.ev(`Object.keys(store.get(srsKey(), {}) || {}).length`);
    A.advance(1300); A.click('resetProgress');
    const r2 = A.ev(`Object.keys(store.get(srsKey(), {}) || {}).length`);
    eq(armed, 'Tap again to erase 50 games and your practice', 'the armed row');
    eq(JSON.stringify(kept), '[50,false,1]', 'two taps 200 ms apart: nothing erased');
    eq(off, false, 'after 6 s it disarms');
    eq(r1, 1, 'Reset: two taps 200 ms apart reset nothing');
    eq(r2, 0, 'a tap 1.5 s after the first resets');
  });

  await test('V4.6: the reminder the player picks: after a time chip, seven day chips (M T W T F S S) preset from the goal; Evening with Saturday off and Sunday on reads "At 7:30 pm on Mon, Tue, Thu and Sun." and the file repeats BYDAY=MO,TU,TH,SU at 19:30 local; the last day stays on; Settings lights those days and the time; en-US "7:30 pm", en-GB "19:30"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var blob = ''; Blob = function (parts) { blob = parts[0]; };
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var k = allMistakes().filter(trainable)[0].key, ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true }; ss.results[k] = 'first';
      ui.session = ss; var out = {};
      var chips = function (h) { return (h.match(/data-act="cueDay" data-k="\\d" aria-pressed="\\w+" aria-label="\\w+">\\w</g) || []).map(function (x) { var m = /aria-pressed="(\\w+)" aria-label="(\\w+)">(\\w)</.exec(x); return m[3] + (m[1] === 'true' ? '+' : '-'); }).join(' '); };
      out.before = chips(doneHtml(ss));
      window.__realmClick('cueSlot', 'evening');
      out.preset = chips(cueCardHtml(ss));
      out.names = (cueCardHtml(ss).match(/aria-label="(\\w+day)"/g) || []).map(function (x) { return x.slice(12, 15); }).join(' ');
      window.__realmClick('cueDay', '6'); window.__realmClick('cueDay', '0');
      var c2 = cueCardHtml(ss);
      out.picked = chips(c2);
      out.when = (/<p class="cue-when">([^<]*)</.exec(c2) || [])[1];
      window.__realmClick('cueAdd', 'evening');
      out.ics = [/RRULE:FREQ=WEEKLY;BYDAY=MO,TU,TH,SU\\r\\n/.test(blob), (/DTSTART:\\d{8}T(\\d{6})/.exec(blob) || [])[1]];
      out.saved = [cueLoad().slot, JSON.stringify(cueLoad().days)];
      ui.session = null; ui.cueSlot = null; ui.cueDays = null;
      var cue = (/<div class="set-block cue-set">[\\s\\S]*?<\\/div><div class="set-block">/.exec(settingsHtml()) || [''])[0];
      out.settings = [chips(cue), /data-act="cueSlot" data-k="evening" aria-pressed="true"/.test(cue), (/<p class="cue-when">([^<]*)</.exec(cue) || [])[1]];
      /* the last day on stays on */
      ui.cueSlot = 'morning'; ui.cueDays = [3]; cueDayToggle(3); out.last = JSON.stringify(cueDayList()); ui.cueSlot = null; ui.cueDays = null;
      out.clock = [clockTime(19, 30, 'en-US'), clockTime(19, 30, 'en-GB'), clockTime(8, 0, 'en-US'), clockTime(0, 5, 'en-US'), clockTime(12, 30, 'en-US')];
      return JSON.stringify(out); })()`));
    eq(r.before, '', 'no day chips before a time is picked');
    eq(r.preset, 'M+ T+ W- T+ F- S+ S-', 'the goal\'s days lit (4: Mon, Tue, Thu, Sat), Monday first');
    eq(r.names, 'Mon Tue Wed Thu Fri Sat Sun', 'each chip named in full for a screen reader');
    eq(r.picked, 'M+ T+ W- T+ F- S- S+', 'Saturday off, Sunday on');
    eq(r.when, 'At 7:30 pm on Mon, Tue, Thu and Sun.', 'the line, in the device\'s time format, no "your goal\'s days"');
    eq(JSON.stringify(r.ics), JSON.stringify([true, '193000']), 'the file: BYDAY=MO,TU,TH,SU at 19:30 local');
    eq(JSON.stringify(r.saved), JSON.stringify(['evening', '[1,2,4,0]']), 'kept with its days');
    eq(JSON.stringify(r.settings), JSON.stringify(['M+ T+ W- T+ F- S- S+', true, 'At 7:30 pm on Mon, Tue, Thu and Sun.']), 'Settings lights those days and the time');
    eq(r.last, '[3]', 'the last day on stays on');
    eq(JSON.stringify(r.clock), JSON.stringify(['7:30 pm', '19:30', '8:00 am', '12:05 am', '12:30 pm']), 'en-US a 12-hour clock, en-GB 24');
  });

  await test('r6 growth M3: the reminder picked is the reminder kept: Evening and Wednesday picked on the summary are saved at once, without Add to calendar; Settings lights them, reads "At 7:30 pm on Mon, Tue, Wed, Thu and Sat." and "Not in your calendar yet." until one is added with that time and those days', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      Blob = function () {}; document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var k = allMistakes().filter(trainable)[0].key, ss = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true }; ss.results[k] = 'first';
      ui.session = ss; doneHtml(ss); var out = {};
      var set = function () { var h = (/<div class="set-block cue-set">[\\s\\S]*?<\\/div><div class="set-block">/.exec(settingsHtml()) || [''])[0];
        return { slot: /data-act="cueSlot" data-k="evening" aria-pressed="true"/.test(h), wed: /data-act="cueDay" data-k="3" aria-pressed="true"/.test(h),
          when: (/<p class="cue-when">([^<]*)</.exec(h) || [])[1] || '', cal: /<p class="cue-when cue-cal">Not in your calendar yet\\.<\\/p>/.test(h) }; };
      window.__realmClick('cueSlot', 'evening'); window.__realmClick('cueDay', '3');
      out.kept = [cueLoad().slot, JSON.stringify(cueLoad().days.slice().sort()), !!cueLoad().cal];
      /* the page left before any calendar: what Settings reads from storage alone */
      ui.session = null; ui.cueSlot = null; ui.cueDays = null;
      out.settings = set();
      window.__realmClick('cueAdd', 'evening'); ui.cueSlot = null; ui.cueDays = null;
      out.added = set();
      window.__realmClick('cueDay', '5'); ui.cueSlot = null; ui.cueDays = null;
      out.changed = set();
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.kept), JSON.stringify(['evening', '[1,2,3,4,6]', false]), 'the time and the days kept the moment they are picked');
    eq(JSON.stringify(r.settings), JSON.stringify({ slot: true, wed: true, when: 'At 7:30 pm on Mon, Tue, Wed, Thu and Sat.', cal: true }), 'Settings lights them, says when, and that no calendar has it yet');
    eq(r.added.cal, false, 'added: the line goes');
    eq(JSON.stringify([r.changed.cal, r.changed.when]), JSON.stringify([true, 'At 7:30 pm on Mon, Tue, Wed, Thu, Fri and Sat.']), 'a day changed after: kept, and not in the calendar yet again');
  });

  await test('F5, F6 (release 2 slice A): Escape from a Settings switch closes Settings; the view tabs take the arrows, Home and End (the tab pattern), and are marked up as tabs', () => {
    const A = boot();
    A.click('settings');
    eq(A.ev('ui.sheet'), 'settings', 'the gear opens Settings');
    A.key('Escape', false, { id: 'sw-sound' });
    eq(A.ev('ui.sheet || ""'), '', 'Escape on a switch closes it');
    A.key('Escape', false, { id: 'firstUser' });
    eq(A.ev('ui.sheet || ""'), '', 'and Escape in a field with no sheet open stays the field\'s');
    A.ev("setView('train')");
    const go = (key, on) => { A.key(key, false, { tab: on }); return A.ev('ui.view'); };
    eq([go('ArrowRight', 'train'), go('ArrowRight', 'games'), go('ArrowRight', 'insights'), go('ArrowLeft', 'train'), go('Home', 'insights'), go('End', 'train')].join(' '), 'games insights train insights train insights', '→ ← through the three tabs and wrap; Home, End (slice D: Today, Games, Insights)');
    const tabs = A.ev(`(function () { var n = { innerHTML: '', contains: function () { return false; } }, pane = { hidden: false }, get0 = document.getElementById;
      document.getElementById = function (id) { return id === 'views' ? n : /^view-/.test(id) ? pane : get0(id); };
      try { setView('train'); } finally { document.getElementById = get0; } return n.innerHTML; })()`);
    ok(/<a class="view-tab view-on" id="tab-train" data-act="view" data-k="train" role="tab" aria-selected="true" aria-controls="view-train" tabindex="0">/.test(tabs)
      && /id="tab-games" data-act="view" data-k="games" role="tab" aria-selected="false" aria-controls="view-games" tabindex="-1">Games</.test(tabs)
      && /id="tab-insights" data-act="view" data-k="insights" role="tab" aria-selected="false" aria-controls="view-insights" tabindex="-1">/.test(tabs), 'the tab shown takes the keyboard, the others an arrow away: ' + tabs.slice(0, 300));
    eq((tabs.match(/data-k="(\w+)" role="tab"/g) || []).map((x) => x.slice(8, -12)).join(' '), 'train games insights', 'in order: Today, Games, Insights');
  });

  await test('V4.7: a game\'s walk-through opens its positions in move order, whatever their state (a game with positions at moves 25 and 35 opens move 25 first); tier 1 Insights has no "Start here"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed';
      var by = {}; allMistakes().filter(trainable).forEach(function (it) { (by[it.g.id] = by[it.g.id] || []).push(it); });
      var g = Object.keys(by).map(function (id) { return by[id]; }).filter(function (l) { return l.length >= 2; })[0].sort(function (x, y) { return x.b.p - y.b.p; });
      /* the earlier position learned, the later new: by state the later would come first */
      var srs = srsLoad(); srs[g[0].key] = { box: 5, streak: 3, due: Date.now() + 60 * DAY, last: Date.now(), lapses: 0, learned: true, n: 3 }; srsSave(srs);
      var plies = drillItems({ type: 'game', id: g[0].g.id }, 8).map(function (it) { return it.b.p; });
      var byState = drillItems({ type: 'colour', colour: g[0].g.color }, 999).map(function (it) { return it.key; });
      return JSON.stringify({ plies: plies, n: g.length, stateFirst: byState.indexOf(g[0].key) > byState.indexOf(g[g.length - 1].key), t1: /Start here/.test(insAt(1)), t2: /Start here/.test(insAt(2)) }); })()`));
    ok(r.plies.length === r.n && r.plies.every((p, i) => !i || p > r.plies[i - 1]), 'in move order: plies ' + r.plies.join(', '));
    ok(r.stateFirst, 'where the state order would put the later one first');
    eq(JSON.stringify([r.t1, r.t2]), '[false,true]', 'no "Start here" at tier 1 ("Next" is the only next step); tier 2 keeps it');
  });

  await test('V4.8: progress words nobody misreads: 6 positions found first try grow the skill\'s bar 6 steps, a miss takes the steps back; Insights says "Checking 12 more positions…" while the background check runs; each pattern sheet lists every position it counts; the per-game figure is (deciding + other) / games; the skill rows sum to the headline\'s games', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      SF.state = 'failed'; playerTier = function () { return 2; };
      var fam = function () { return insightReport().families.filter(function (a) { return a.fam.key === 'safety'; })[0]; };
      var its = allMistakes().filter(function (it) { return trainable(it) && familyOf(patternOf(it.b)).key === 'safety'; }), out = {};
      var s0 = fam().steps;
      its.slice(0, 6).forEach(function (it) { srsRecord(it, 'first', { ms: 30000, attempted: true }); });
      var s1 = fam().steps;
      srsRecord(its[0], 'fail', { ms: 30000, attempted: true });
      var s2 = fam().steps;
      out.steps = [s1.l + s1.c - s0.l - s0.c, s1.n === s0.n, s1.l + s1.c - s2.l - s2.c];
      var bar = function (h) { var m = /<span class="fr-bar"[^>]*>([\\s\\S]*?)<\\/span>/.exec(h); return m ? m[1].replace(/<i class="sk-(\\w)" style="flex-grow:(\\d+)"><\\/i>/g, '$1$2 ').trim() : ''; };
      out.bar = bar(insAt(2));
      /* while the background check runs: how many positions it has left (12: every other one keyed, or one it cannot read) */
      var st0 = SF.state, all = allMistakes().filter(trainable);
      SF.state = 'idle'; enrichState.running = true;
      all.slice(12).forEach(function (it) { factsState.failed[it.key] = 1; });
      out.checking = (/<p class="checking-line ins-checking">([^<]*)<\\/p>/.exec(insAt(2)) || [])[1] || '';
      enrichState.running = false;
      out.idle = /checking-line/.test(insAt(2));
      all.forEach(function (it) { delete factsState.failed[it.key]; }); SF.state = st0;
      /* every pattern sheet lists the positions it counts */
      out.sheets = patternStats().filter(function (s) { return s.count > 0; }).map(function (s) { var h = sheetHtml('pattern:' + s.key); return [s.key, s.count, (h.match(/<div class="ex" /g) || []).length, (/<p class="sheet-sum">(\\d+) positions?/.exec(h) || [])[1]].join(':'); })
        .filter(function (x) { var p = x.split(':'); return !(+p[1] === +p[2] && +p[1] === +p[3]); });
      var rep = insightReport(), lead = insText(insAt(2));
      out.rows = rep.families.reduce(function (a, f) { return a + f.lost; }, 0);
      out.lead = lead.filter(function (x) { return /decided the most/.test(x); })[0] || '';
      out.losses = (lead.filter(function (x) { return /^In \\d+ of your \\d+ losses/.test(x); })[0] || '').replace(/^In (\\d+) of.*$/, '$1');
      var dec = 0, oth = 0; allMistakes().filter(function (it) { return !it.b.x; }).forEach(function (it) { if (it.b.d === 1) dec++; else oth++; });
      noteStart(Date.now() - 3600e3);
      out.perGame = [sinceStats().before.mean.toFixed(2), ((dec + oth) / data.games.length).toFixed(2), dec, oth];
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.steps), '[6,true,1]', '6 first-try finds: 6 steps more of the same track; a miss takes its step back');
    ok(/^l\d+ c\d+ g\d+$|^c\d+ g\d+$/.test(r.bar), 'the bar by steps: ' + r.bar);
    eq(r.checking, 'Checking 12 more positions…', 'while the background check runs');
    eq(r.idle, false, 'not once it stops');
    eq(JSON.stringify(r.sheets), '[]', 'every pattern sheet lists every position it counts: ' + r.sheets.join(' | '));
    eq(String(r.rows), r.losses, 'the skill rows sum to the headline\'s games');
    eq(r.perGame[0], r.perGame[1], 'the per-game figure is (deciding + other) / games: ' + r.perGame.join(', '));
  });

  /* ── release 2, slice C: counts that settle, due dates by whole days, the ladder's words, the way back ── */
  const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
  await test('C1: counts settle before they are shown: on a first visit, while the background check runs, Today (beside the focus card\'s counts), the Games tab (above its rows), the first summary\'s report and Insights (under the lead, the skills, the clock) say "Checking N more positions…"; as the keys land in the check\'s own order, every screen whose counts are not yet the settled ones says it, and once the last is in, none does', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      var cards = ${JSON.stringify(FACTS.cards)};
      SF.state = 'ready'; enrichState.running = true;
      var strip = function (h) { return String(h).replace(/<p class="checking-line[^"]*">[^<]*<\\/p>/g, ''); };
      var lines = function (h) { return (String(h).match(/<p class="checking-line[^"]*">Checking \\d+ more positions?…<\\/p>/g) || []).length; };
      var ss = { mode: 'today', label: 'Today', keys: [], idx: 0, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true, sum: {} };
      var todayAt = function () { var box = { innerHTML: '', dataset: {} }, el0 = el; el = function (id) { return id === 'trainbox' ? box : el0(id); }; renderTrain(); el = el0; return box.innerHTML; };
      var screens = function () { return { today: todayAt(), games: gamesHtml(), summary: diagHtml(ss, 2), ins: insAt(2) }; };
      var states = [screens()], first = checkingLeft(), order = enrichTargets();
      for (var i = 0; i < order.length; i += 20) {
        order.slice(i, i + 20).forEach(function (it) { var c = cards[it.key]; if (c) { it.b.k = c; delete it.b.kp; } else factsState.failed[it.key] = 1; });
        modelDirty();
        states.push(screens());
      }
      var fin = states[states.length - 1], out = { first: first, n: states.length, left: checkingLeft(), bad: [], moved: [] };
      out.lines0 = { focus: /focus-check/.test(states[0].today), games: /gl-check/.test(states[0].games), summary: lines(states[0].summary), ins: lines(states[0].ins) };
      var t0 = states[0].today; out.order = t0.indexOf('class="why-these"') < t0.indexOf('focus-check') && t0.indexOf('focus-check') < t0.indexOf('class="focus focus-go"');
      out.linesEnd = lines(fin.today) + lines(fin.games) + lines(fin.summary) + lines(fin.ins);
      states.forEach(function (s, j) { ['today', 'games', 'summary', 'ins'].forEach(function (w) {
        if (strip(s[w]) !== strip(fin[w])) { out.moved.push(w); if (!lines(s[w])) out.bad.push(j + ':' + w); } }); });
      return JSON.stringify(out); })()`));
    ok(r.first > 50, 'a first visit: every position waits for the check: ' + r.first);
    eq(JSON.stringify(r.lines0), JSON.stringify({ focus: true, games: true, summary: 1, ins: 3 }), 'the line beside each block of counts: why these and the focus card, the Games tab\'s rows, the report, Insights\' lead, skills and clock');
    ok(r.order, 'on Today it sits between why these and the focus card');
    ok(r.moved.indexOf('today') >= 0 && r.moved.indexOf('summary') >= 0 && r.moved.indexOf('ins') >= 0, 'the check does change counts on all three screens: ' + r.moved.join(','));
    eq(JSON.stringify(r.bad), '[]', 'no screen shows a count the check will change without the line');
    eq(r.left + r.linesEnd, 0, 'every key in: nothing left, no line');
  });
  await test('C1: a position set aside before it is shown gives its slot to the next new one, so a set keeps its size: a set of 5 with its 3rd position taken out by the deeper look, and its 4th on screen by its key, still ends "Position 5 of 5", never "of 4" or "of 3"; one position from a summary gives up its slot', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', 5);
      startToday();
      var ss = ui.session, keys0 = ss.keys.slice(), said = [], where = function () { return (/class="sr-only">(Position [^<]*)</.exec(sessionBarHtml(ss, ss.active)) || [])[1]; };
      itemOf(keys0[2]).b.x = 'deep'; modelDirty();
      for (var i = 0; i < 40 && !ss.finished; i++) {
        var a = ss.active;
        if (!a) { loadCard(); a = ss.active; if (!a) break; }
        said.push(where());
        /* the 4th position on screen, asking: its key lands and sets it aside (factsSwap) */
        if (a.key === keys0[3] && !a.it.b.x) { a.it.b.x = 'deep'; modelDirty(); a.keyDue = true; motionUntil = 0; factsSwap(a); continue; }
        if (a.sol) { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.solIdx++; } finishCard('first'); }
        else { a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); if (a.phase !== 'done') finishCard('first'); }
        nextCard();
      }
      var out = { said: said, n: ss.keys.length, gone: ss.keys.indexOf(keys0[2]) < 0 && ss.keys.indexOf(keys0[3]) < 0, joined: ss.keys.filter(function (k) { return keys0.indexOf(k) < 0; }).length, end: where() };
      /* one position opened from a summary: nothing takes its place */
      var it = allMistakes().filter(trainable)[0];
      ui.session = { mode: 'drill', label: 'One position', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {}, spec: { type: 'one', key: it.key } };
      out.one = setFill(ui.session, it.key);
      return JSON.stringify(out); })()`));
    ok(r.said.length >= 5 && r.said.every((x) => / of 5$/.test(x)), 'every place reads "of 5": ' + r.said.join(' | '));
    eq(r.end, 'Position 5 of 5', 'and the set ends "Position 5 of 5"');
    eq(JSON.stringify([r.n, r.gone, r.joined]), '[5,true,2]', 'both taken out, two new positions joined: still 5');
    eq(r.one, null, 'one position from a summary: no other takes its place');
  });
  await test('C1: since you started counts checked games only: with the games since the start not yet checked, the comparison waits ("2 of 10 new games so far": only the clean ones count), and once the check has looked at them it is made; the card says "Checking N more positions…" while its games wait', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS}
      playerTier = function () { return 2; }; SF.state = 'ready'; enrichState.running = true;
      var gs = data.games.slice().sort(function (x, y) { return y.ts - x.ts; }), since = gs.slice(0, 14);
      noteStart(gs[14].ts);
      var open = function (g) { return (g.bl || []).filter(function (b) { return !b.x && b.bu && !(b.sc && !b.d); }); };
      var clean = since.filter(function (g) { return !open(g).length; }).length, out = { clean: clean };
      var st = sinceStats(), h = insAt(2);
      out.wait = [st.since.n, st.verdict, (sinceText(h) || []).filter(function (x) { return /new games so far/.test(x); })[0] || '', /class="since"[\\s\\S]*?checking-line/.test(h)];
      since.forEach(function (g) { (g.bl || []).forEach(function (b) { factsState.failed[mKey(g, b)] = 1; }); });
      st = sinceStats();
      out.made = [st.since.n, st.verdict];
      return JSON.stringify(out); })()`));
    ok(r.clean < 10, 'fewer than 10 of the 14 games since are clean: ' + r.clean);
    eq(JSON.stringify(r.wait), JSON.stringify([r.clean, 'wait', 'Comparison from 10 games since you started: ' + r.clean + ' of 10 new games so far.', true]), 'the unchecked games wait; the card says the check runs');
    ok(r.made[0] === 14 && r.made[1] !== 'wait', 'checked, all 14 count and the comparison is made: ' + JSON.stringify(r.made));
  });
  await test('C2: due dates by whole days (shiftDays): a 3-day find at 9 pm reads "back in 3 days" in Details and "Back in 3 days" on the summary, is dealt at 7 am on that date and climbs; "Tomorrow" (3 due tomorrow, 3 due at 5 am the day after) is the set dealt the next day at 7 am and at 10 pm', () => {
    const A = boot({ now: T0 + 7 * 3600e3 });                         /* Monday 9 pm */
    const r = JSON.parse(A.ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var its = allMistakes().filter(trainable), srs = {}, now = Date.now(), out = {};
      /* due tomorrow at 3 pm and the day after at 5 am, as release 1 kept them (to the hour) */
      its.slice(0, 3).forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: dayStart(now, 1) + 15 * 3600e3, last: now - 2 * DAY, ls: now - 2 * DAY, lapses: 0, n: 1 }; });
      its.slice(3, 6).forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: dayStart(now, 2) + 5 * 3600e3, last: now - 2 * DAY, ls: now - 2 * DAY, lapses: 0, n: 1 }; });
      srsSave(srs);
      out.read = [daysFrom(now, srsLoad()[its[0].key].due), srsLoad()[its[0].key].due === dayStart(now, 1), srsLoad()[its[3].key].due === dayStart(now, 2)];
      startToday();
      var ss = ui.session, a = ss.active || (loadCard(), ss.active);
      out.key = a.key;
      a.t0 = Date.now() - 30000; a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      out.details = scheduleWords(srsRec(a.it), a);
      nextCard(); playSet();
      var h = doneHtml(ss);
      out.moved = (/class="recap-moved">([^<]*)</.exec(h) || [])[1] || '';
      out.next = (/class="recap-next">([^<]*)</.exec(h) || [])[1] || '';
      ui.session = null;
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.read), '[1,true,true]', 'a due time kept to the hour reads as its date, from midnight');
    eq(r.details, 'Step 1 of 3 · back in 3 days', 'Details: back in 3 days');
    ok(/Back in 3 days: 1\./.test(r.moved), 'the summary: ' + r.moved);
    const m = /^Tomorrow: (\d+) positions?, about \d+ minutes? \((\d+) back, (\d+) new\)\.$/.exec(r.next) || [];
    eq(JSON.stringify([+m[1], +m[2]]), '[7,3]', 'Tomorrow: the 3 due tomorrow and 4 new, not the day after\'s: ' + r.next);
    const dealt = (at) => {
      const B = makeApp({ now: T0 + 7 * 3600e3, storage: Object.assign({}, A.storage) });
      B.ev('window.__nlTest.shiftDays(1); 1');
      B.setNow(T0 - 14 * 3600e3 + at * 3600e3);                        /* Monday's midnight, then the hour */
      return JSON.parse(B.ev(`(function () { playerTier = function () { return 2; }; SF.state = 'failed'; startToday(); return JSON.stringify([ui.session.keys.length, new Date().getHours()]); })()`));
    };
    eq(JSON.stringify(dealt(7)), '[7,7]', 'the next day at 7 am: the set of 7');
    eq(JSON.stringify(dealt(22)), '[7,22]', 'and at 10 pm: the same 7');
    /* three days on, at 7 am: dealt, and found it climbs */
    const C = makeApp({ now: T0 + 7 * 3600e3, storage: Object.assign({}, A.storage) });
    C.ev('window.__nlTest.shiftDays(3); 1');
    C.setNow(T0 - 7 * 3600e3);                                          /* Monday 7 am, three days after the find */
    const t = JSON.parse(C.ev(`(function () { playerTier = function () { return 2; }; SF.state = 'failed'; startToday();
      var ss = ui.session, k = ${JSON.stringify(r.key)}, at = ss.keys.indexOf(k), out = { dealt: at >= 0, box0: srsLoad()[k].box };
      if (at >= 0) { ss.idx = at; ss.active = null; loadCard(); var a = ss.active; a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); out.box1 = srsLoad()[k].box; }
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(t), JSON.stringify({ dealt: true, box0: 1, box1: 2 }), 'its date at 7 am: dealt, and found it climbs');
  });
  await test('C3: ladder words: at tier 1 a find on the one more try counts in "You found N of M" (kid550\'s drill of one, shown then found on its retry: "You found it."; kid550\'s day 2, a lesson in slot 2 and 9 positions, one of them shown then found on its retry: "You found all 9.", with slice A\'s lesson never skipped); positions back in the queue stay "in practice" ("not started" never rises: club1550\'s 29 to 31)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      data.user = { perfs: { rapid: { rating: 700 } } }; SF.state = 'failed';
      var its = allMistakes().filter(trainable), out = { tier: playerTier() };
      var mk = function (n, shownThenFound, lesson) { var ks = its.slice(0, n).map(function (x) { return x.key; }), ss = { mode: 'today', label: 'Today', keys: ks.slice(), idx: n, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
        ks.forEach(function (k, i) { var c = i === shownThenFound ? 'shown' : i % 3 ? 'first' : 'miss'; ss.results[k] = c === 'shown' ? 'fail' : c === 'first' ? 'first' : 'retry'; ss.sum[k] = { c: c, s: c === 'first' ? 3 : c === 'miss' ? 2 : 0 }; });
        /* a lesson in slot 2 (F9.3), seen to its end */
        if (lesson) { ss.keys.splice(1, 0, 'ls:free'); ss.results['ls:free'] = 'lesson'; }
        if (shownThenFound != null) { var k = ks[shownThenFound]; ss.keys.push(k); ss.relearnOf[k] = 1; ss.results[k + '#r'] = 'first'; ss.sum[k + '#r'] = { c: 'first', s: 3 }; }
        ss.idx = ss.keys.length;
        return ss; };
      var words = function (ss) { var h = doneHtml(ss); return [(/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], (/<p class="recap-then">([^<]*)</.exec(h) || [])[1] || '']; };
      out.drill = words(mk(1, 0));
      out.day = words(mk(9, 4, true));
      /* two practised positions go back to the queue (F7.1): still in practice */
      var fam = function () { return insightReport().families.filter(function (a) { return a.fam.key === 'safety'; })[0]; };
      var safe = its.filter(function (it) { return familyOf(patternOf(it.b)).key === 'safety'; }), srs = srsLoad(), now = Date.now();
      safe.slice(0, 4).forEach(function (it) { srs[it.key] = { box: 2, streak: 1, due: now + 5 * DAY, last: now - DAY, ls: now - DAY, lapses: 0, n: 1 }; });
      srsSave(srs);
      out.before = progressWords(fam());
      srs = srsLoad(); safe.slice(0, 2).forEach(function (it) { srs[it.key].q = now; srs[it.key].due = null; }); srsSave(srs);
      out.queued = progressWords(fam());
      return JSON.stringify(out); })()`));
    eq(r.tier, 1, 'a 700 player is at tier 1');
    eq(JSON.stringify(r.drill), JSON.stringify(['You found it.', '1 took more than one try.']), 'a drill of one, shown then found on its retry: found');
    eq(r.day[0], 'You found all 9.', 'a lesson and 9 positions, one shown then found on its retry: all 9');
    ok(!/shown|skipped/.test(r.day[1]), 'nothing reads shown or skipped: ' + r.day[1]);
    eq(r.queued, r.before, 'two positions back in the queue: the words do not move (' + r.before + ')');
  });
  await test('C4: the way back: a game drill after a break has no recall line, Today\'s set after it has; a remainder reads "Your next set starts with the 2 still due." above [Next set of 10]; a first practice on a Thursday reads "0 of 4 days this week (your first week)"', () => {
    const A = boot({ now: T0 + 6 * 864e5 });
    const r = JSON.parse(A.ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', 10); store.set('nl:weekGoal', 4);
      var its = allMistakes().filter(trainable), srs = {}, now = Date.now(), out = {};
      /* practised 14 days ago, every position due now */
      its.forEach(function (x) { srs[x.key] = { box: 1, streak: 1, due: now - 3600e3, last: now - 14 * DAY, ls: now - 14 * DAY, lapses: 0, n: 1 }; });
      srsSave(srs);
      for (var d = 14; d < 17; d++) store.set(dayKeyFor(new Date(now - d * DAY)), { counted: 1, sessions: 1 });
      out.away = daysAway();
      var g = its[0].g;
      startDrill({ type: 'game', id: g.id, label: 'Game vs ' + g.opp }); playSet();
      out.drill = [ui.session.mode, /class="recall"/.test(doneHtml(ui.session))];
      ui.session = null; absorbOpen(); startToday(); playSet();
      out.today = (/<p class="recall">([^<]*)</.exec(doneHtml(ui.session)) || [])[1] || '';
      ui.session = null;
      return JSON.stringify(out); })()`));
    eq(r.away, 14, '14 days away');
    eq(JSON.stringify(r.drill), '["drill",false]', 'a game drill\'s summary: no recall line');
    ok(/^After 14 days away, you found \d+ of \d+ reviews first try\./.test(r.today), 'Today\'s set after it: ' + r.today);
    const B = boot();
    const left = B.ev(`(function () { ${PLAYSET}
      playerTier = function () { return 2; }; SF.state = 'failed'; store.set('nl:sessionSize', 10);
      var its = allMistakes().filter(trainable).filter(function (x) { return !x.b.d; }), srs = {}, now = Date.now();
      its.slice(0, 12).forEach(function (x) { srs[x.key] = { box: 2, streak: 1, due: now - 3600e3, last: now - 7 * DAY, ls: now - 7 * DAY, lapses: 0, n: 1 }; });
      srsSave(srs); store.set(absorbKey(), { d: dayStamp(), due: 0, sp: 0, q: 0, left: 0 });
      startToday(); playSet();
      var h = doneHtml(ui.session);
      return JSON.stringify([(/class="recap-next">([^<]*)</.exec(h) || [])[1], (/data-act="keepGoing">([^<]*)</.exec(h) || [])[1]]); })()`);
    const lw = JSON.parse(left);
    ok(/^Your next set starts with the 2 still due\./.test(lw[0]), 'the remainder: ' + lw[0]);
    eq(lw[1], 'Next set of 10', 'above the next set of 10');
    const thu = boot({ now: T0 + 3 * 864e5 }).ev(`(function () { store.set('nl:weekGoal', 4); return (/class="wk-say">([^<]*)</.exec(weekHtml()) || [])[1] + '|' + new Date().getDay(); })()`);
    eq(thu, '0 of 4 days this week (your first week)|4', 'a first practice on a Thursday');
  });

  /* ── beginner teaching (F9.1 to F9.5): its tests in test/practice.js ── */
  for (const t of require('./practice')({ boot, eq, ok, tick })) await test(t[0], t[1]);

  /* how your games are decided (F10.3): decidedText(h) the rows' words, in order */
  const DECIDED = `function decidedText(h) { var m = /<h3 class="ins-h">How your games are decided<\\/h3><div class="clock-rows dec-rows">([\\s\\S]*?)<\\/div>/.exec(h); return m ? m[1].split('</p>').filter(Boolean).map(function (p) { return insText(p).join(' '); }) : null; }`;
  await test('F10.3: the fixture as a chess.com 2000 player, at tier 3 under the headline: "Converting wins: won 21 of 30 games after reaching +2.", "Saving bad positions: saved 11 of 38 after falling to \u22122." and "Slow slides: 2 of 27 losses had no single losing move.", the peer figures 72% and 31% beside the first two (lichess rapid 2100), Practise these on the rows with positions, no verdict word; none at tiers 1 and 2; a row needs 10 games; no peer figure for a format the blob lacks; the definitions are the peer script\'s', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${INS} ${DECIDED}
      SF.state = 'failed';
      data.user = { perfs: { rapid: { rating: 2000 } } };
      var res = { t3: decidedText(insAt(3)), t2: decidedText(insAt(2)), t1: decidedText(insAt(1)), d: decidedReport() };
      var h3 = insAt(3);
      res.order = [h3.indexOf('class="lead"'), h3.indexOf('How your games are decided'), h3.indexOf('What decided your games')];
      res.links = (h3.match(/data-spec="\\{&quot;type&quot;:&quot;(convert|save)&quot;/g) || []).length;
      /* the drills hold the positions behind their rows: after +2 in a game not won, after -2 in one lost */
      var conv = drillItems({ type: 'convert' }, 100), save = drillItems({ type: 'save' }, 100);
      res.conv = conv.length; res.save = save.length;
      res.convOk = conv.every(function (it) { var s = gameSwings(it.g); return it.g.res !== 'win' && s.reach != null && it.b.p > s.reach; });
      res.saveOk = save.every(function (it) { var s = gameSwings(it.g); return it.g.res === 'loss' && s.fell != null && it.b.p > s.fell; });
      /* the thresholds: the win chances of 200 and -200 centipawns */
      res.thr = [Math.round(CONV_WIN * 10) / 10, Math.round(RES_WIN * 10) / 10];
      /* the band: chess.com rapid counts 150 more on lichess (2150: 2100), lichess as it is */
      data.user.perfs.rapid.rating = 2049; res.p2049 = Math.round(decidedReport().conv.peer * 10) / 10;
      data.user.perfs.rapid.rating = 600; res.p600 = Math.round(decidedReport().conv.peer * 10) / 10;
      data.user.perfs.rapid.rating = 3000; res.p3000 = Math.round(decidedReport().conv.peer * 10) / 10;
      /* a daily game among them: no peer figure */
      var dg = data.games.filter(function (g) { var s = gameSwings(g); return s && s.reach != null; })[0], perf0 = dg.perf;
      data.user.perfs.rapid.rating = 2000;
      dg.perf = 'daily'; cfg.perfs = ['rapid', 'blitz', 'daily']; windowMemo.key = ''; modelDirty();
      res.daily = decidedReport().conv;
      dg.perf = perf0; cfg.perfs = null; windowMemo.key = ''; modelDirty();
      /* no rating known: the counts, no peer figure */
      data.user = null;
      res.norating = decidedText(insAt(3));
      /* under 10 qualifying games: no row */
      var keep = data.games.slice();
      data.games = keep.filter(function (g) { var s = gameSwings(g); return !(s && s.reach != null); }).concat(keep.filter(function (g) { var s = gameSwings(g); return s && s.reach != null; }).slice(0, 9));
      modelDirty();
      res.few = decidedReport();
      data.games = keep; modelDirty();
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.t3), JSON.stringify(['Converting wins: won 21 of 30 games after reaching +2. Practise these › Lichess players at your level: 72%.',
      'Saving bad positions: saved 11 of 38 after falling to \u22122. Practise these › Lichess players at your level: 31%.',
      'Slow slides: 2 of 27 losses had no single losing move.']), 'the three rows at tier 3');
    eq(JSON.stringify([r.d.conv.n, r.d.conv.won, r.d.save.n, r.d.save.saved, r.d.slow.n, r.d.slow.none]), '[30,21,38,11,27,2]', 'the counts');
    eq(JSON.stringify([Math.round(r.d.conv.peer * 10) / 10, Math.round(r.d.save.peer * 10) / 10]), '[71.9,30.6]', 'lichess rapid 2100: 71.9% and 30.6%');
    ok(r.order[0] > 0 && r.order[0] < r.order[1] && r.order[1] < r.order[2], 'under the headline and its lead, above the skills: ' + r.order);
    eq(JSON.stringify([r.t2, r.t1]), '[null,null]', 'none at tiers 2 and 1');
    eq(r.links, 2, 'Practise these on the two rows with positions');
    ok(r.conv >= 5 && r.save >= 5 && r.convOk && r.saveOk, 'the drills hold their rows\' positions: ' + JSON.stringify([r.conv, r.save, r.convOk, r.saveOk]));
    eq(JSON.stringify(r.thr), '[67.6,32.4]', '+2 and -2 as the win chances of 200 and -200 centipawns');
    eq(JSON.stringify([r.p2049, r.p600, r.p3000]), '[71.9,59,77.9]', 'chess.com 2049 is lichess 2199 (2100); 600 the 800 band; 3000 the 2400 band');
    eq(r.daily && r.daily.peer, null, 'a daily game among them: no peer figure');
    ok(r.daily && r.daily.n === 30, 'its count stands');
    eq(JSON.stringify(r.norating), JSON.stringify(['Converting wins: won 21 of 30 games after reaching +2. Practise these ›', 'Saving bad positions: saved 11 of 38 after falling to \u22122. Practise these ›', 'Slow slides: 2 of 27 losses had no single losing move.']), 'no rating known: no peer figure');
    eq(r.few.conv, null, 'under 10 games that reached +2: no row');
    ok(!/better|worse|good|bad|well|weak|strong/i.test(r.t3.join(' ').replace(/Saving bad positions/, '')), 'no verdict word');
  });

  /* ── release 2 slice D: the games get their own tab ── */
  /* Today's box drawn into a stub, as the page draws it */
  const TODAY_AT = `function todayAt() { var box = { innerHTML: '', dataset: {} }, el0 = el; el = function (id) { return id === 'trainbox' ? box : el0(id); }; try { renderTrain(); } finally { el = el0; } return box.innerHTML; }`;
  await test('slice D, the tab and its route: three tabs, Today, Games and Insights, each panel with its one h1; Games opens on #games (kept as the tab for the day, its measure once); Back moves between the tabs; a game opened on the Games tab goes back there on ×, on Back and by its summary\'s "Back to Games", its place in the history the tab\'s own (one Back leaves it); a set from Today still says "Back to Today"', () => {
    const A = boot();
    const shell = A.ev('(renderShell(), el("main").innerHTML)');
    ok(/<div id="view-train" class="view" role="tabpanel" aria-labelledby="tab-train"><h1 class="sr-only">Today<\/h1><section id="trainbox"><\/section><\/div><div id="view-games" class="view" role="tabpanel" aria-labelledby="tab-games" hidden><h1 class="sr-only">Games<\/h1><section id="gamesbox"><\/section><\/div><div id="view-insights" class="view" role="tabpanel" aria-labelledby="tab-insights" hidden><h1 class="sr-only">Insights<\/h1>/.test(shell), 'three panels in the tabs\' order, one h1 each: ' + shell.slice(0, 400));
    eq((shell.match(/<h1/g) || []).length, 3, 'one h1 a panel, so one a screen');
    A.ev(`(function () { window.__calls = []; window.clarity = function () { window.__calls.push([].slice.call(arguments).map(String)); }; SF.state = 'failed'; return 1; })()`);
    A.ev("setView('games')");
    const r0 = JSON.parse(A.ev(`JSON.stringify({ view: ui.view, kept: store.get('nl:view', ''), day: store.get('nl:viewDay', '') === dayStamp() })`));
    eq(JSON.stringify(r0), JSON.stringify({ view: 'games', kept: 'games', day: true }), 'Games opens, kept as the tab for today');
    eq(JSON.stringify(A.urls.slice(-1)), JSON.stringify([['push', '/#games']]), '#games pushed');
    A.ev("setView('games')");
    eq(A.ev(`window.__calls.filter(function (c) { return c[0] === 'event' && c[1] === 'games_open'; }).length`), 1, 'its measure once, as Insights\' is');
    /* Back and Forward between the tabs */
    A.pop('#train'); eq(A.ev('ui.view'), 'train', 'Back to #train: Today');
    A.pop('#games'); eq(A.ev('ui.view'), 'games', 'Forward to #games: Games');
    A.pop('#insights'); eq(A.ev('ui.view'), 'insights', '#insights: Insights');
    A.pop('#games');
    /* a game opened on the Games tab */
    const gid = A.ev(`(function () { var by = {}; allMistakes().filter(trainable).forEach(function (it) { by[it.g.id] = (by[it.g.id] || 0) + 1; }); return Object.keys(by).filter(function (k) { return by[k] >= 2; })[0]; })()`);
    const open = () => { const n = A.urls.length; A.ev(`(function () { startDrill({ type: 'game', id: '${gid}', label: 'Game vs x' }); return 1; })()`); return A.urls.slice(n); };
    const u1 = open();
    const s1 = JSON.parse(A.ev(`JSON.stringify({ back: ui.session.back, view: ui.view, state: history.state, plies: ui.session.keys.map(function (k) { return itemOf(k).b.p; }) })`));
    eq(JSON.stringify([s1.back, s1.view, s1.state]), JSON.stringify(['games', 'train', { nlSession: 1 }]), 'the set runs in the card\'s place, marked to go back to Games');
    eq(JSON.stringify(u1), JSON.stringify([['push', '/#train']]), 'one history entry for the set, on top of the Games tab\'s (no #train between)');
    ok(s1.plies.every((p, i) => !i || p > s1.plies[i - 1]), 'its positions in move order (V4.7): ' + s1.plies.join(','));
    A.click('endSession');
    eq(JSON.stringify([A.ev('ui.view'), A.ev('!!ui.session')]), JSON.stringify(['games', false]), '×: back on the Games tab');
    eq(JSON.stringify(A.urls.slice(-1)), JSON.stringify([['back']]), '× leaves the set\'s own entry, so the next Back goes on from the tab');
    open();
    A.pop('#games', null);
    eq(JSON.stringify([A.ev('ui.view'), A.ev('!!ui.session')]), JSON.stringify(['games', false]), 'Back from the set: the Games tab');
    /* its summary\'s way back */
    const sum = JSON.parse(A.ev(`(function () { var k = allMistakes().filter(trainable).filter(function (it) { return it.g.id === '${gid}'; })[0].key;
      var ss = { mode: 'drill', label: 'Game vs x', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true, back: 'games', spec: { type: 'game', id: '${gid}' } };
      ss.results[k] = 'first'; ui.session = ss; ui.view = 'train'; var h = doneHtml(ss);
      var t = { mode: 'today', label: 'Today', keys: [k], idx: 1, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true }; t.results[k] = 'first';
      return JSON.stringify({ games: (/data-act="endSession">([^<]*)</.exec(h) || [])[1], today: (/data-act="endSession">([^<]*)</.exec(doneHtml(t)) || [])[1] }); })()`));
    eq(JSON.stringify(sum), JSON.stringify({ games: 'Back to Games', today: 'Back to Today' }), 'the summary of a game opened on Games says where it goes back to');
    A.click('endSession');
    eq(JSON.stringify([A.ev('ui.view'), A.ev('!!ui.session')]), JSON.stringify(['games', false]), 'Back to Games: the Games tab');
  });

  await test('slice D, which tab opens (V4.4): a cold open on a new day opens on Today, whichever tab was left; a same-day reopen restores the last tab, Games included; a link to #games opens Games on any day, a reload is no link; a page left open on Games comes back on a later day on Today', () => {
    const stamp = (d) => JSON.parse(boot().ev(`JSON.stringify(dayStamp(new Date(Date.now() - ${d} * DAY)))`));
    const view = (left, d, o) => makeApp(Object.assign({ now: T0, storage: Object.assign(base(), { 'nl:view': JSON.stringify(left), 'nl:viewDay': JSON.stringify(stamp(d)) }) }, o || {})).ev('ui.view');
    eq([view('games', 0), view('insights', 0), view('train', 0)].join(' '), 'games insights train', 'reopened the same day: the tab left, Games included');
    eq([view('games', 1), view('insights', 1)].join(' '), 'train train', 'a new day: Today');
    eq(view('games', 3, { hash: '#games', nav: 'navigate' }), 'games', 'a link to #games opens Games on a later day');
    eq(view('train', 3, { hash: '#games' }), 'games', 'and whatever tab was left');
    eq(view('games', 1, { hash: '#games', nav: 'reload' }), 'train', 'a reload the next day is no link: Today');
    eq(view('games', 0, { hash: '#games', nav: 'reload' }), 'games', 'a reload the same day keeps Games');
    /* a page left open on Games, back in view on a later day */
    const A = makeApp({ now: T0, storage: Object.assign(base(), { 'nl:view': JSON.stringify('games'), 'nl:viewDay': JSON.stringify(stamp(0)) }) });
    eq(A.ev('ui.view'), 'games', 'open on Games');
    A.ev('(data.sections.games = "ok", document.hidden = true, onReturn(), document.hidden = false, 1)');
    A.setNow(T0 + 864e5 + 120e3);
    A.ev('(onReturn(), 1)');
    eq(A.ev('ui.view'), 'train', 'back in view the next day: Today');
  });

  await test('slice D, Today holds the day\'s practice: the hero with Start and the week, why these, the checking line and the focus card; no game row, no games list, no clean game and no news of the games since (both on the Games tab); the focus card beside the hero on a wide screen (has-side), one column without one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${TODAY_AT}
      SF.state = 'ready'; enrichState.running = true; playerTier = function () { return 2; };
      data.greeting = 'Since your last visit: 3 games (2 won, 1 lost).';
      var t = todayAt(), g = gamesHtml(), cf = currentFocus;
      currentFocus = function () { return null; };
      var none = todayAt();
      currentFocus = cf; SF.state = 'failed'; enrichState.running = false;
      return JSON.stringify({ t: t, g: g, none: none }); })()`));
    ['class="hero"', 'data-act="startToday"', 'class="week"', 'class="why-these"', 'class="focus focus-go"'].forEach((x) => ok(r.t.indexOf(x) >= 0, 'Today has ' + x));
    ok(/<div class="today today-grid has-side"><div class="today-main">[\s\S]*class="why-these"[\s\S]*<\/div><div class="today-side"><p class="checking-line focus-check">Checking \d+ more positions…<\/p><a class="focus focus-go"/.test(r.t), 'the hero and why these, then beside them the checking line over the focus card: ' + r.t.slice(-600, -300));
    ['lg-row', 'Your latest games', 'class="clean-line"', 'Clean game vs', 'class="since"', 'Since your last visit', 'data-act="reload"', 'allGames', 'gamesMore'].forEach((x) => ok(r.t.indexOf(x) < 0, 'Today has no ' + x));
    ok(r.g.indexOf('<p class="since">Since your last visit: 3 games (2 won, 1 lost).</p>') >= 0 && /<p class="clean-line">Clean game vs opponent41: no big mistakes\.<\/p>/.test(r.g), 'the games since and the newest clean game lead the Games tab');
    ok(!/has-side|today-side/.test(r.none) && /class="hero"/.test(r.none), 'no focus card: one column');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.css'), 'utf8');
    ok(/@media \(min-width:1000px\)\{\s*\.today-grid\.has-side\{grid-template-columns:minmax\(0,1fr\) 380px/.test(css), 'two columns from 1000 px only with the focus card beside the hero');
  });

  await test('slice D, the Games tab: the newest 30 games of the window, newest first, then "Show 20 more"; each row says its result, the opponent and both ratings, the type, the day, the side, the moves, its mistakes and the one that cost the game, and its positions learned or in practice, and reads as one sentence; a clean game says so; the filters (result, type where two are played, the games a move cost, the clean ones) keep their games, say "27 of 50 games", say so when they keep none and clear, and last for the visit; Check for new games and its busy words at the top; the checking line while counts can change', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed'; playerTier = function () { return 2; }; data.sections.games = 'ok';
      var out = {}, rows = function (h) { return (h.match(/<(?:div|a) class="lg-row[^>]*>[\\s\\S]*?<\\/(?:div|a)>(?=<(?:div|a) class="lg-row|<\\/div>)/g) || []); };
      var ids = function (h) { return (h.match(/data-g="([^"]*)"/g) || []).map(function (x) { return x.slice(8, -1); }); };
      var h = gamesHtml();
      out.n = rows(h).length; out.more = (/data-act="gamesMore">([^<]*)</.exec(h) || [])[1];
      out.order = ids(h).join(',') === scopedGames().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 30).map(function (g) { return g.id; }).join(',');
      out.count = (/id="gl-count" role="status">([^<]*)</.exec(h) || [])[1];
      out.head = [/<h2 class="gl-h" id="gl-h">Your games<\\/h2>/.test(h), (/data-act="reload">([^<]*)</.exec(h) || [])[1], h.indexOf('data-act="reload"') < h.indexOf('class="lg-row')];
      ui.gShow = 60; out.all = rows(gamesBodyHtml(gamesList())).length; out.moreAll = /gamesMore/.test(gamesBodyHtml(gamesList())); ui.gShow = 30;
      /* opponent1's game: two of its positions practised, one learned */
      var g1 = data.games.filter(function (g) { return g.opp === 'opponent1'; })[0], its = allMistakes().filter(function (it) { return trainable(it) && it.g === g1; }), srs = srsLoad();
      srs[its[0].key] = { box: 5, streak: 3, due: Date.now() + 60 * DAY, last: Date.now(), lapses: 0, learned: true, n: 3 };
      srs[its[1].key] = { box: 1, streak: 1, due: Date.now() + DAY, last: Date.now(), lapses: 0, n: 1 };
      srsSave(srs);
      var row1 = gameRowHtml(g1, gamesIndex()[g1.id]);
      out.row1 = { said: (/class="sr-only">([^<]*)</.exec(row1) || [])[1], name: (/class="lg-name">([\\s\\S]*?)<\\/span><small>/.exec(row1) || [])[1], meta: (/<small>([^<]*)<\\/small>/.exec(row1) || [])[1],
        state: (/<span class="lg-state" aria-hidden="true">([\\s\\S]*?)<\\/span><\\/div>$/.exec(row1) || [])[1], res: (/class="lg-res lg-(\\w)"/.exec(row1) || [])[1], hid: (row1.match(/aria-hidden="true"/g) || []).length, label: /aria-label/.test(row1),
        open: (/^<div class="lg-row is-open" data-g="[^"]*" data-act="drill" data-spec="([^"]*)" role="button">/.exec(row1) || [])[1] };
      var g41 = data.games.filter(function (g) { return g.opp === 'opponent41'; })[0], row41 = gameRowHtml(g41, gamesIndex()[g41.id]);
      out.clean = [(/class="sr-only">([^<]*)</.exec(row41) || [])[1], /<span class="lg-state ok" aria-hidden="true">✓ Clean game<\\/span>/.test(row41), /^<a class="lg-row is-open" data-g="[^"]*" href=/.test(row41)];
      /* the filters, by the page's change listener */
      window.__realmChange('gf', 'loss', 'r');
      var hl = gamesHtml();
      out.loss = { n: rows(hl).length, all: rows(hl).every(function (x) { return /lg-res lg-L/.test(x); }), count: (/id="gl-count" role="status">([^<]*)</.exec(hl) || [])[1], on: /<span class="gf gf-on"><select data-act="gf" data-k="r"/.test(hl), kept: sessionStorage.getItem('nl:gf:' + playerId()) };
      window.__realmChange('gf', 'cost', 'p');
      var hc = gamesHtml(), lostIds = {}; allMistakes().filter(trainable).forEach(function (it) { if (it.b.d) lostIds[it.g.id] = 1; });
      out.cost = { all: rows(hc).every(function (x) { return /<i>1 cost the game<\\/i>/.test(x); }), n: (/id="gl-count" role="status">(\\d+) of/.exec(hc) || [])[1], want: scopedGames().filter(function (g) { return g.res === 'loss' && lostIds[g.id]; }).length };
      window.__realmChange('gf', 'clean', 'p');
      var hn = gamesHtml();
      out.none = [(/class="gl-none"><p>([^<]*)<\\/p><a class="btn-quiet" data-act="gamesClear">([^<]*)</.exec(hn) || []).slice(1).join(' | '), (/id="gl-count" role="status">([^<]*)</.exec(hn) || [])[1]];
      out.persist = sessionStorage.getItem('nl:gf:' + playerId());
      window.__realmClick('gamesClear');
      out.cleared = [(/id="gl-count" role="status">([^<]*)</.exec(gamesHtml()) || [])[1], JSON.stringify(gamesFilter())];
      window.__realmChange('gf', 'clean', 'p');
      out.cleanOnly = rows(gamesHtml()).every(function (x) { return /✓ Clean game/.test(x); });
      gamesFilterSet({});
      /* the type: no choice with one type played; with two, its select, the sites' order, and it filters */
      out.oneType = /data-k="t"/.test(gamesHtml());
      var tp = trackedPerfs; trackedPerfs = function () { return ['rapid', 'blitz']; };
      data.games.slice(0, 6).forEach(function (g) { g.perf = 'blitz'; }); modelDirty();
      var ht = gamesHtml();
      out.types = (/<select data-act="gf" data-k="t" aria-label="Game type">([\\s\\S]*?)<\\/select>/.exec(ht) || ['', ''])[1].replace(/<option value="(\\w+)"( selected)?>([^<]*)<\\/option>/g, '$1:$3 ').trim();
      window.__realmChange('gf', 'blitz', 't');
      out.blitz = [rows(gamesHtml()).length, rows(gamesHtml()).every(function (x) { return /<small>Blitz · /.test(x); }), (/id="gl-count" role="status">([^<]*)</.exec(gamesHtml()) || [])[1]];
      trackedPerfs = tp; data.games.slice(0, 6).forEach(function (g) { g.perf = 'rapid'; }); modelDirty(); gamesFilterSet({});
      /* the check for new games while it runs, and the checking line while counts can change */
      data.sections.games = 'loading';
      out.busy = /<a class="btn-quiet gl-refresh is-busy" data-icon="rotate" data-act="reload" aria-disabled="true">Checking for new games…<\\/a>/.test(gamesHtml());
      data.sections.games = 'ok';
      SF.state = 'ready'; enrichState.running = true;
      out.checking = /<div class="gl-body" id="gl-body"><p class="checking-line gl-check">Checking \\d+ more positions…<\\/p><div class="gl-rows">/.test(gamesHtml());
      SF.state = 'failed'; enrichState.running = false;
      out.calm = /checking-line/.test(gamesHtml());
      return JSON.stringify(out); })()`));
    eq(JSON.stringify([r.n, r.more, r.order]), JSON.stringify([30, 'Show 20 more', true]), 'the newest 30, newest first, then "Show 20 more"');
    eq(JSON.stringify([r.all, r.moreAll]), JSON.stringify([50, false]), 'shown on: all 50, no more to show');
    eq(r.count, '50 games', 'the count');
    eq(JSON.stringify(r.head), JSON.stringify([true, 'Check for new games', true]), '"Your games" with Check for new games at the top, above the rows');
    ok(/^Lost to opponent1 \(1388\), 4 mistakes, 1 cost the game, 1 learned, 1 in practice\. Rapid, (today|yesterday|\d{1,2} \w+), White, 36 moves, your rating 1351\.$/.test(r.row1.said), 'one sentence in reading order: ' + r.row1.said);
    eq(r.row1.name, 'vs opponent1 <span class="dim">1388</span><span class="lg-me"> · you 1351</span>', 'the opponent and both ratings');
    ok(/^Rapid · (today|yesterday|\d{1,2} \w+) · White · 36 moves$/.test(r.row1.meta), 'the type, the day, the side and the moves: ' + r.row1.meta);
    eq(r.row1.state, '4 mistakes<i>1 cost the game</i><b class="gl-prac">1 learned · 1 in practice</b>', 'its mistakes, the one that cost the game, its positions learned and in practice');
    eq(JSON.stringify([r.row1.res, r.row1.hid, r.row1.label]), JSON.stringify(['L', 3, false]), 'its letter and lines hidden from a screen reader, no aria-label');
    ok(r.row1.open && JSON.parse(r.row1.open.replace(/&quot;/g, '"')).type === 'game', 'it opens the game\'s positions');
    ok(/^Won against opponent41 \(1323\), Clean game\. Rapid, /.test(r.clean[0]) && r.clean[1] && r.clean[2], 'a clean game says so, and opens on its site: ' + r.clean[0]);
    eq(JSON.stringify([r.loss.n > 0, r.loss.all, r.loss.count, r.loss.on]), JSON.stringify([true, true, '27 of 50 games', true]), 'Losses: the 27 losses, said, the filter in use outlined');
    eq(r.loss.kept, JSON.stringify({ r: 'loss', t: 'all', p: 'all' }), 'kept for the visit');
    ok(r.cost.all && +r.cost.n === r.cost.want && r.cost.want > 0, 'Cost the game: the losses a move decided: ' + r.cost.n + ' of ' + r.cost.want);
    eq(JSON.stringify(r.none), JSON.stringify(['No games match these filters. | Clear filters', '0 of 50 games']), 'a filter that keeps none says so, with Clear filters');
    eq(r.persist, JSON.stringify({ r: 'loss', t: 'all', p: 'clean' }), 'the filters as picked, for the visit');
    eq(JSON.stringify(r.cleared), JSON.stringify(['50 games', JSON.stringify({ r: 'all', t: 'all', p: 'all' })]), 'cleared: every game');
    ok(r.cleanOnly, 'Clean games keeps the clean ones');
    eq(r.oneType, false, 'one type played: no type to choose');
    eq(r.types, 'all:All types blitz:Blitz rapid:Rapid', 'two types: the type filter, in the sites\' order');
    eq(JSON.stringify(r.blitz), JSON.stringify([6, true, '6 of 50 games']), 'Blitz keeps the blitz games');
    eq(r.busy, true, 'checking: the button says so ("Checking for new games…")');
    eq(r.checking, true, 'while the check runs, "Checking N more positions…" above the rows (C1)');
    eq(r.calm, false, 'and none once nothing can change');
    /* the filters last for the visit: a reload in the same tab keeps them; a new visit starts with all */
    const B = makeApp({ now: T0, storage: base(), session: { ['nl:gf:cc:tester']: JSON.stringify({ r: 'win', t: 'all', p: 'all' }) } });
    eq(B.ev(`(/id="gl-count" role="status">([^<]*)</.exec(gamesHtml()) || [])[1]`), '22 of 50 games', 'reloaded in the same tab: still the wins');
    eq(boot().ev(`(/id="gl-count" role="status">([^<]*)</.exec(gamesHtml()) || [])[1]`), '50 games', 'a new visit: all');
  });

  await test('slice D, the Games tab with no games yet says what to do: reading (the first load), a load that failed (its words and Try again), and none at all ("No rated games yet." / "Play a rated game on chess.com, then check for new games." with Play a game and Check for new games)', () => {
    const A = makeApp({ now: T0, storage: { 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom') } });
    const r = JSON.parse(A.ev(`(function () { var out = {}, words = function (h) { return h.replace(/<[^>]+>/g, '|').split('|').map(function (x) { return x.trim(); }).filter(Boolean); };
      out.reading = words(gamesHtml());
      data.sections.games = 'fail'; data.gamesErr = { site: 'chess.com', net: true };
      out.fail = words(gamesHtml());
      data.sections.games = 'ok'; data.gamesErr = null;
      var h = gamesHtml();
      out.none = words(h); out.acts = (h.match(/<a class="(btn-big|btn-quiet)"[^>]*>/g) || []).map(function (x) { return (/data-act="(\\w+)"/.exec(x) || [0, 'link'])[1]; });
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.reading), JSON.stringify(['Reading your games', 'Fetching your rated games from chess.com.']), 'reading');
    eq(JSON.stringify(r.fail), JSON.stringify(['chess.com did not answer.', 'Check your connection and try again.', 'Try again']), 'a first load that failed: its words, as Today says them');
    eq(JSON.stringify(r.none), JSON.stringify(['No rated games yet.', 'Play a rated game on chess.com, then check for new games. Each one shows up here with its mistakes, newest first. Daily games are not read yet.', 'Play a game ↗', 'Check for new games']), 'none: what to do');
    eq(JSON.stringify(r.acts), JSON.stringify(['link', 'reload']), 'Play a game (on the site), and Check for new games');
  });

  /* ── v2 slice 5, look and release; Clarity as the owner wants it (release 2 slice D) ── */
  /* every call Clarity's queue holds, as the realm's own */
  const QUEUED = `JSON.stringify(typeof window.clarity === 'function' ? (window.clarity.q || []).map(function (c) { return [].slice.call(c).map(function (x) { return typeof x === 'object' && x ? JSON.stringify(x) : String(x); }).join(' '); }) : null)`;
  await test('Clarity for every visitor, and said (the owner, release 2 slice D): its tag loads at boot, on the landing and for a player, with no question and no call to its consent API; the measures go to it; the landing, the footer and Settings say "notlichess uses Microsoft Clarity to see how the site is used. It records clicks and screens, with all text hidden." with Microsoft\'s privacy statement, never a switch; no consent card anywhere, and an old yes or no is dropped', () => {
    const T = 'https://www.clarity.ms/tag/y95daq5rao', SAY = 'notlichess uses Microsoft Clarity to see how the site is used. It records clicks and screens, with all text hidden. <a class="say-link" href="https://privacy.microsoft.com/privacystatement">Microsoft\'s privacy statement</a>';
    const tags = (X) => X.appended.filter((e) => e.src === T).length;
    /* a first visit: the landing, no player yet, a device that kept an old "no" */
    const L = makeApp({ now: T0, storage: { 'nl:consent': JSON.stringify('no') } });
    eq(tags(L), 1, 'the landing: the tag at boot, with no question');
    eq(L.storage['nl:consent'], undefined, 'the old answer dropped');
    L.ev('(track("first_visit"), measureTag("tier", 1), clarityLoad(), 1)');
    const q = JSON.parse(L.ev(QUEUED));
    ok(q && q.indexOf('event first_visit') >= 0 && q.indexOf('set tier 1') >= 0, 'the measures go to it: ' + JSON.stringify(q));
    ok(!q.some((c) => /^consent/.test(c)), 'never a call to its consent API (Clarity applies its own consent mode where the law asks): ' + JSON.stringify(q));
    eq(tags(L), 1, 'one tag a page');
    L.ev('(renderFirstVisit(), 1)');
    const land = L.ev('el("main").innerHTML');
    ok(land.indexOf('<p class="first-foot">Free, with no account. Your games and progress are saved in this browser, not on our servers. ' + SAY + '</p>') >= 0, 'the landing says it, under the form, with the privacy statement');
    ok(!/consent|With your yes|Help improve/i.test(land), 'no question on the landing');
    /* a player (the fixture): the tag at boot too; the footer, Settings and the shell */
    const A = boot();
    eq(tags(A), 1, 'a player: the tag at boot');
    A.ev(`(function () { var f = { innerHTML: '' }, el0 = el; el = function (id) { return id === 'foot' ? f : el0(id); }; renderFoot(); el = el0; window.__foot = f.innerHTML; return 1; })()`);
    ok(A.ev('window.__foot').indexOf('<span class="foot-line">Free and open source. Your games and progress are saved in this browser, not on our servers. ' + SAY + '</span>') >= 0, 'the footer says it');
    const set = A.ev('settingsHtml()'), data0 = (/<span class="kicker">Your data<\/span>[\s\S]*?(?=<div class="set-block"><span class="kicker">Reset)/.exec(set) || [''])[0];
    ok(data0.indexOf('<p>None of it is kept on our servers. ' + SAY + '</p>') >= 0, 'Settings, Your data: the same line');
    ok(!/data-act="consent"|Usage recording|With your yes/.test(set), 'no switch in Settings');
    ok(!/consent/.test(A.ev('(renderShell(), el("main").innerHTML)')), 'no slot for a question on Today');
    /* nothing left of the question: no card, no switch, no stored answer, no "With your yes" */
    const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'page.html'), 'utf8');
    const src = fs.readdirSync(path.join(__dirname, '..', 'src', 'js')).filter((f) => /\.js$/.test(f)).map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8')).join('\n');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.css'), 'utf8');
    ok(!/clarity\.ms/i.test(page), 'page.html adds no tag of its own (the script does, at boot)');
    ok(!/consentCardHtml|consentYes|consentNo|consentv2|consent-slot|With your yes/.test(src) && !/\.consent/.test(css), 'no consent card, switch or call left in the code');
  });

  await test('V5.8: "Find my mistakes" with the box empty says "Type your username first." and looks nothing up', () => {
    const L = makeApp({ now: T0, storage: {} });
    const r = JSON.parse(L.ev(`(function () { var notes = [], looked = 0;
      notice = function (m) { notes.push(m); };
      getJSON = function () { looked++; return new Promise(function () {}); }; ccJSON = getJSON;
      renderFirstVisit();
      findUser(''); findUser('   ');
      /* the button, with the box empty (no box in the realm: its value is empty) */
      window.__realmClick('findUser');
      return JSON.stringify({ notes: notes, looked: looked }); })()`));
    eq(JSON.stringify(r.notes), JSON.stringify(['Type your username first.', 'Type your username first.', 'Type your username first.']), 'the words, each time');
    eq(r.looked, 0, 'nothing looked up');
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'sessions and bookkeeping: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
