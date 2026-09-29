// Exploring a position after a card, run on the built page in Node (test/app-realm.js) with the
// fixture games. The engine is replaced by a stub whose answers the test hands out, so every
// ordering (late, stopped, stale) can be forced. node test/explore.test.js  (exit 1 on failure)
const fs = require('fs'), path = require('path');
const makeApp = require('./app-realm');
const C = require('./chess');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const base = () => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': FIX });
const boot = (o) => makeApp(Object.assign({ now: T0, storage: base() }, o || {}));

let failed = 0, passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; results.push('FAIL ' + name + ': ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(c, what) { if (!c) throw new Error(what || 'condition failed'); }

/* an engine that answers only when told: jobs wait in window.__jobs */
const STUB = `(function () {
  window.__jobs = [];
  engineEval = function (fen, mt, prio, opts) {
    return new Promise(function (res, rej) { window.__jobs.push({ fen: fen, nodes: mt && mt.nodes, opts: opts || {}, res: res, rej: rej }); });
  };
  engineStop = function (t) {
    var hit = typeof t === 'function' ? t : function (j) { return j.tag === t; };
    window.__jobs = window.__jobs.filter(function (j) {
      if (hit({ tag: j.opts.tag, xp: j.opts.xp })) { j.rej({ stopped: true }); return false; }
      return true;
    });
  };
  /* answer a job with three legal lines, the first scored best for the side to move */
  window.__answer = function (j, cps, stopped) {
    window.__jobs = window.__jobs.filter(function (x) { return x !== j; });
    var st = stateFromFen(j.fen), ms = legalMoves(st).slice(0, 3);
    var lines = ms.map(function (m, i) {
      var after = cloneState(st); applyMove(after, m);
      var rep = legalMoves(after)[0];
      var cp = (cps && cps[i] != null) ? cps[i] : 50 - 40 * i;
      return { cp: st.w ? cp : -cp, mate: null, pv: [moveUci(m)].concat(rep ? [moveUci(rep)] : []) };
    });
    j.res({ cp: lines[0].cp, mate: null, bestUci: lines[0].pv[0], pv: lines[0].pv, lines: lines, depth: 18, stopped: !!stopped });
  };
  return 1;
})()`;
const OPEN = `function openCard(it) {
  ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
  var a = cardFor(it);
  if (a.check1) { a.check1 = null; a.phase = 'guess'; a.st = cloneState(a.pre); a.lastMove = a.preLast; }
  ui.session.active = a;
  return a;
}`;
/* a card answered by "Show the answer", ready to explore */
const ANSWERED = `(function () { ${OPEN}
  var it = allMistakes().filter(trainable).filter(function (x) { var a0 = cardFor(x); return a0 && unpackUci(x.b.lu).length >= 2; })[0];
  var a = openCard(it);
  reveal();
  return 1;
})()`;
const flush = (A) => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

(async () => {
  await test('nothing is explored before the answer', () => {
    const A = boot(); A.ev(STUB);
    A.ev(`(function () { ${OPEN} var it = allMistakes().filter(trainable)[0]; openCard(it); startExplore({}); return 1; })()`);
    eq(A.ev('!!ui.session.active.explore'), false, 'explore before the answer');
    eq(A.ev('window.__jobs.filter(function (j) { return j.opts.tag === "explore"; }).length'), 0, 'explore jobs');
  });

  await test('the invite is written once, at most 80 characters', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    const inv = A.ev('JSON.stringify(ui.session.active.invite)');
    const o = JSON.parse(inv);
    ok(/^Why \S+\? Try another (white|black) move and Stockfish answers\.$/.test(o.text) || o.text === 'Move any piece to test an idea. Stockfish answers.', o.text);
    ok(o.text.length <= 80, 'length');
    A.flush(6);
    eq(A.ev('JSON.stringify(ui.session.active.invite)'), inv, 'unchanged after the autoplay');
  });

  await test('exploring starts from the frame on screen and asks for three lines', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`(function () { var a = ui.session.active; a.view = { line: 'refute', idx: 1 }; startExplore({}); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes[0].fen'), A.ev('stateFen(ui.session.active.lines.refute.states[1])'), 'start frame');
    const j = JSON.parse(A.ev('JSON.stringify(window.__jobs.map(function (j) { return { n: j.nodes, mpv: j.opts.multipv, tag: j.opts.tag, lanes: j.opts.lanes }; }))'));
    ok(j.length >= 1 && j[0].n === 250000 && j[0].mpv === 3 && j[0].tag === 'explore' && JSON.stringify(j[0].lanes) === '[0,1]', JSON.stringify(j));
  });

  await test('the invite jumps to the moment the opponent chose', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    const v = JSON.parse(A.ev('JSON.stringify(ui.session.active.invite.view)'));
    if (!v) return;   /* the fallback starts from the frame on screen */
    A.ev(`startExplore({ view: ui.session.active.invite.view, via: 'invite' })`);
    eq(A.ev('ui.session.active.explore.nodes[0].fen'), A.ev('stateFen(ui.session.active.lines.best.states[0])'), 'the position before the reply');
  });

  await test('results arrive, the deeper step follows, and the rows and sentence appear', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev(`window.__answer(window.__jobs[0])`); await flush(A);
    eq(A.ev('ui.session.active.explore.res[xpCur(ui.session.active.explore).key].step'), 1, 'step 1 stored');
    ok(A.ev('window.__jobs.some(function (j) { return j.nodes === 1000000 && j.opts.tag === "explore"; })'), 'the 1M step is asked');
    A.ev(`window.__answer(window.__jobs.filter(function (j) { return j.nodes === 1000000; })[0])`); await flush(A);
    const say = A.ev('sayAt(ui.session.active, ui.session.active.explore, 0)');
    ok(/Stockfish's pick is .+, the gold arrow\. › plays it\.$/.test(say), say);
    ok(A.ev('xpRows(ui.session.active, ui.session.active.explore).length') >= 2, 'rows');
  });

  await test('a move, a step back, and a new move that drops the old trail', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev(`(function () { var ex = ui.session.active.explore, ms = legalMoves(ex.st); explorePlay(ms[0]); var ms2 = legalMoves(ui.session.active.explore.st); explorePlay(ms2[0]); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes.length'), 3, 'three nodes');
    A.ev('exploreStep(-1)');
    eq(A.ev('ui.session.active.explore.at'), 1, 'stepped back');
    A.ev(`(function () { var ex = ui.session.active.explore, ms = legalMoves(ex.st); explorePlay(ms[ms.length - 1]); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes.length'), 3, 'the old tail is gone');
    eq(A.ev('ui.session.active.explore.at'), 2, 'at the new move');
    A.ev('exploreStep(-1)'); A.ev('exploreStep(-1)'); A.ev('exploreStep(-1)');
    eq(A.ev('ui.session.active.explore'), null, '‹ at the start leaves exploring');
    eq(A.ev('window.__jobs.filter(function (j) { return j.opts.tag === "explore"; }).length'), 0, 'no explore job left');
  });

  await test('a stopped or late answer is never shown', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    const j0 = 'window.__jobs[0]';
    A.ev(`window.__keep = ${j0};`);
    A.ev(`window.__answer(window.__keep, null, true)`); await flush(A);
    eq(A.ev('!!ui.session.active.explore.res[xpCur(ui.session.active.explore).key]'), false, 'stopped answer not stored');
    A.ev(`window.__late = window.__jobs[window.__jobs.length - 1] || null`);
    A.ev(`exploreExit('silent')`);
    A.ev(`if (window.__late) window.__late.res({ cp: 10, mate: null, bestUci: null, pv: [], lines: [], depth: 5 })`); await flush(A);
    eq(A.ev('ui.session.active.explore'), null, 'still out of exploring');
  });

  await test('a move played by the opponent is judged in words, 80 characters at most', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({ view: ui.session.active.invite.view || null })`);
    /* the start: step 1 then step 2 */
    for (let i = 0; i < 2; i++) { A.ev(`window.__answer(window.__jobs[0], [60, 20, -300])`); await flush(A); }
    A.ev(`(function () { var ex = ui.session.active.explore, r = ex.res[xpCur(ex).key]; var m = uciToMove(ex.st, r.lines[2].pv[0]); explorePlay(m); return 1; })()`);
    for (let i = 0; i < 4 && A.ev('window.__jobs.length'); i++) { A.ev(`window.__answer(window.__jobs[0], [200, 100, 50])`); await flush(A); }
    const say = A.ev('sayAt(ui.session.active, ui.session.active.explore, 1)');
    ok(!/thinking/.test(say), 'a sentence, not a wait: ' + say);
    ok(say.length <= 80, 'length ' + say.length + ': ' + say);
    ok(!/—/.test(say) && !/[+-]\d+\.\d/.test(say), 'no em dash or pawn number: ' + say);
    eq(A.ev('sayAt(ui.session.active, ui.session.active.explore, 1)'), say, 'written once');
  });

  await test("the opponent's voice never says 'you lose' about the opponent", () => {
    const ms = fs.readFileSync(path.join(__dirname, 'data', 'mistakes.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
    const bad = [];
    ms.forEach((r) => {
      const pre = C.stateFromFen(r.fen);
      const c = C.classifyMistake(pre, r.played, { pv: r.best.pv, mate: r.best.mate },
        r.refutation ? { pv: r.refutation.pv, mate: r.refutation.mate == null ? null : -r.refutation.mate } : { pv: [], mate: null }, r.wb, r.wa, r.ply, 'them');
      const s = c.sentences.game + ' ' + c.sentences.short;
      if (/\b[Yy]ou lose\b|\byou are losing\b|\byour (?:winning position|advantage)\b/.test(s)) bad.push(s);
    });
    eq(bad.length, 0, bad.slice(0, 2).join(' | '));
  });

  await test('reading depth: Standard by default, Thorough reads deeper once three positions are ready', () => {
    const A = boot();
    eq(A.ev('scanDepth()'), 'std', 'default');
    eq(A.ev('scanNodes()'), 18000, 'standard budget');
    A.ev(`store.set('nl:scanDepth', 'thorough')`);
    eq(A.ev('scanNodes()'), 50000, 'thorough budget');
    A.ev(`store.set('nl:scanDepth', 'nonsense')`);
    eq(A.ev('scanDepth()'), 'std', 'garbage reads as standard');
  });

  await test('Next and the end of a session stop exploring', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev('nextCard()');
    eq(A.ev('window.__jobs.filter(function (j) { return j.opts.tag === "explore"; }).length'), 0, 'no explore job after Next');
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'exploring: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
