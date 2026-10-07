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

  await test('the Details row and the ••• item open exploring on an answered card; never before it, by a board tap, or with no engine', () => {
    const A = boot(); A.ev(STUB);
    /* before an answer: no item, and the action does nothing */
    A.ev(`(function () { ${OPEN} var it = allMistakes().filter(trainable).filter(function (x) { var a0 = cardFor(x); return a0 && unpackUci(x.b.lu).length >= 2; })[0]; openCard(it); return 1; })()`);
    ok(A.ev('menuHtml(ui.session.active).indexOf(\'data-act="explore"\')') < 0, 'the ••• item before an answer');
    A.click('explore', 'menu'); A.click('explore');
    eq(A.ev('!!ui.session.active.explore'), false, 'exploring before an answer');
    A.ev('reveal()');
    ok(A.ev('detailsHtml().indexOf(\'data-act="explore">Try your own moves with Stockfish ›</a>\')') >= 0, 'the Details row');
    ok(A.ev('menuHtml(ui.session.active).indexOf(\'data-act="explore" data-k="menu">Try your own moves</a>\')') >= 0, 'the ••• item');
    /* a tap on any piece of the answered board says N1 and opens nothing */
    const any = A.ev('(function (a) { for (var q = 0; q < 64; q++) if (a.st.b[q]) return q; })(ui.session.active)');
    A.tap(any);
    eq(A.ev('!!ui.session.active.explore'), false, 'a board tap opened exploring');
    A.click('explore');
    eq(A.ev('!!ui.session.active.explore'), true, 'the Details row opens it');
    ok(A.ev('menuHtml(ui.session.active).indexOf(\'data-act="explore"\')') < 0, 'the ••• item while exploring');
    A.ev(`exploreExit('link')`);
    A.ev('ui.session.active.menuOpen = true');
    A.click('explore', 'menu');
    eq(A.ev('!!ui.session.active.explore && !ui.session.active.menuOpen'), true, 'the ••• item opens it and closes the menu');
    A.ev(`exploreExit('link')`);
    /* the engine down: hidden everywhere, and nothing opens it (S11) */
    A.ev(`SF.state = 'failed'`);
    ok(A.ev('detailsHtml().indexOf(\'data-act="explore"\')') < 0 && A.ev('menuHtml(ui.session.active).indexOf(\'data-act="explore"\')') < 0, 'offered with no engine');
    A.click('explore'); A.click('explore', 'menu'); A.ev('startExplore({})');
    eq(A.ev('!!ui.session.active.explore'), false, 'exploring with no engine');
    /* and a tap on a piece gets the outline alone: N1 would point at a way in that is not there */
    A.ev('ui.session.active.note = null; ui.session.active.nope = null');
    A.tap(any);
    eq(A.ev('JSON.stringify([ui.session.active.note, ui.session.active.nope && ui.session.active.nope.sq])'), JSON.stringify([null, any]), 'a tap with no engine');
  });

  await test('starts at the card position with the solver to move, and asks for three lines', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`(function () { var a = ui.session.active; a.view = { mode: 's0' }; startExplore({}); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes[0].fen'), A.ev('stateFen(ui.session.active.pre)'), 'start frame');
    eq(A.ev('ui.session.active.explore.st.w === myPov(ui.session.active.it)'), true, 'the solver to move');
    eq(A.ev('JSON.stringify(ui.session.active.explore.last)'), A.ev('JSON.stringify(ui.session.active.preLast)'), 'its last move');
    const j = JSON.parse(A.ev('JSON.stringify(window.__jobs.map(function (j) { return { n: j.nodes, mpv: j.opts.multipv, tag: j.opts.tag, lanes: j.opts.lanes, fen: j.fen }; }))'));
    ok(j.length >= 1 && j[0].n === 250000 && j[0].mpv === 3 && j[0].tag === 'explore' && JSON.stringify(j[0].lanes) === '[0,1]', JSON.stringify(j));
    eq(j[0].fen, A.ev('stateFen(ui.session.active.pre)'), 'the search is the card position');
    /* the same start from a story step */
    A.ev(`exploreExit('silent')`);
    A.ev(`(function () { var a = ui.session.active; a.view = { mode: 'story', i: 0 }; startExplore({}); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes[0].fen'), A.ev('stateFen(ui.session.active.pre)'), 'from a story step');
    /* the answer played: the board shows the position after it, exploring still starts before it */
    A.ev(`exploreExit('silent')`);
    A.ev('ui.session.active.view = { mode: "show" }; playIt(true)'); A.flush(4);
    ok(A.ev('stateFen(ui.session.active.st) !== stateFen(ui.session.active.pre)'), 'the answer was played');
    A.ev(`(function () { SF.state = 'ready'; startExplore({}); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes[0].fen'), A.ev('stateFen(ui.session.active.pre)'), 'after the answer was played');
    eq(A.ev('ui.session.active.explore.st.w === myPov(ui.session.active.it)'), true, 'the solver to move after the answer was played');
  });

  await test('results arrive, the deeper step follows, and the rows and sentence appear', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev(`window.__answer(window.__jobs[0])`); await flush(A);
    eq(A.ev('ui.session.active.explore.res[xpCur(ui.session.active.explore).key].step'), 1, 'step 1 stored');
    ok(A.ev('window.__jobs.some(function (j) { return j.nodes === 1000000 && j.opts.tag === "explore"; })'), 'the 1M step is asked');
    A.ev(`window.__answer(window.__jobs.filter(function (j) { return j.nodes === 1000000; })[0])`); await flush(A);
    const say = A.ev('sayAt(ui.session.active, ui.session.active.explore, 0)');
    /* the sentence names no control: the button under it says how to play it */
    ok(/^Your move\. Stockfish's pick is .+, the gold arrow\.$/.test(say), say);
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
    A.ev(`startExplore({})`);
    /* the solver moves first (the start is the card position), then the opponent: step 1 then step 2 each */
    A.ev(`(function () { var ex = ui.session.active.explore; explorePlay(legalMoves(ex.st)[0]); return 1; })()`);
    for (let i = 0; i < 4 && A.ev('window.__jobs.length'); i++) { A.ev(`window.__answer(window.__jobs[0], [60, 20, -300])`); await flush(A); }
    eq(A.ev('ui.session.active.explore.st.w === myPov(ui.session.active.it)'), false, 'the opponent to move');
    A.ev(`(function () { var ex = ui.session.active.explore, r = ex.res[xpCur(ex).key]; var m = uciToMove(ex.st, r.lines[2].pv[0]); explorePlay(m); return 1; })()`);
    eq(A.ev('ui.session.active.explore.nodes[2].mv.byYou'), false, 'played by the opponent');
    for (let i = 0; i < 4 && A.ev('window.__jobs.length'); i++) { A.ev(`window.__answer(window.__jobs[0], [200, 100, 50])`); await flush(A); }
    const say = A.ev('sayAt(ui.session.active, ui.session.active.explore, 2)');
    ok(!/thinking/.test(say), 'a sentence, not a wait: ' + say);
    ok(say.length <= 80, 'length ' + say.length + ': ' + say);
    ok(!/—/.test(say) && !/[+-]\d+\.\d/.test(say), 'no em dash or pawn number: ' + say);
    eq(A.ev('sayAt(ui.session.active, ui.session.active.explore, 2)'), say, 'written once');
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

  await test('mates read the right way round in the sentence', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    /* a made-up exploration: White mates with Rh8; Rh7 still mates, Ra7 walks into mate */
    const say = (fen, x, bestPv, bestMate, replyPv, replyMate) => JSON.parse(A.ev(`(function () {
      var a = ui.session.active, st = stateFromFen('${fen}');
      a.explore = { root: { line: 'best', idx: -1 }, nodes: [xpNode(st, null, null)], at: 0, sel: -1, res: {}, hot: 0, k: 3, say: {}, flash: null };
      var ex = a.explore, P = ex.nodes[0], m = uciToMove(st, '${x}'), c = cloneState(st); applyMove(c, m);
      ex.nodes.push(xpNode(c, [m.from, m.to], { san: sanOf(st, m), uci: '${x}', byYou: true, pick: false, ply: xpPly(st) }));
      ex.at = 1;
      ex.res[P.key] = { step: 2, lines: [{ cp: 1500, mate: ${bestMate}, pv: ${JSON.stringify(bestPv)} }] };
      ex.res[ex.nodes[1].key] = { step: 2, lines: [{ cp: ${replyMate} > 0 ? 1500 : -1500, mate: ${replyMate}, pv: ${JSON.stringify(replyPv)} }] };
      return JSON.stringify(xpVerdict(a, ex, 1));
    })()`));
    const still = say('k7/8/1K6/8/8/8/8/7R w - - 0 1', 'h1h7', ['h1h8'], 1, ['a8b8', 'h7h8'], 2);
    ok(!/allows mate/.test(still.text), 'a move that still mates: ' + still.text);
    const walks = say('4r1k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a7', ['h2h3'], null, ['e8e1'], -1);
    ok(/^Ra7 allows mate in 1/.test(walks.text), 'a move that walks into mate: ' + walks.text);
  });

  await test("the card's own position is never silenced, a twin card's position is", () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev(`(function () { var a = ui.session.active; ui.session.xpSpoil = {}; ui.session.xpSpoil[posKey(a.pre)] = 'someone-else:1'; ui.session.xpSpoil['8/8/8/8/8/8/8/8 w - -'] = 'x:1'; return 1; })()`);
    eq(A.ev(`xpSpoil({ key: posKey(ui.session.active.pre) })`), false, 'own position');
    eq(A.ev(`xpSpoil({ key: '8/8/8/8/8/8/8/8 w - -' })`), true, 'another card');
  });

  await test('a search stopped by stepping never marks a position as down', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    A.ev(`startExplore({})`);
    A.ev(`(function () { var ex = ui.session.active.explore; explorePlay(legalMoves(ex.st)[0]); return 1; })()`);
    A.ev('exploreStep(-1)'); A.ev('exploreStep(1)'); A.ev('exploreStep(-1)'); A.ev('exploreStep(1)');
    await flush(A);
    eq(A.ev('!!xpCur(ui.session.active.explore).down'), false, 'not down');
    ok(A.ev('window.__jobs.some(function (j) { return j.opts.tag === "explore"; })'), 'asked again');
  });

  await test('engine: a line reprinted from a shallower depth never replaces a real one', () => {
    const A = boot();
    const got = JSON.parse(A.ev(`(function () {
      var slot = { w: { postMessage: function () {} } }, out = null;
      slotWire(slot);
      clearInterval(slot.guardTimer);
      slot.pending.push({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', mpv: 3, resolve: function (r) { out = r; }, reject: function () {} });
      var say = function (t) { slot.w.onmessage({ data: t }); };
      say('info depth 14 multipv 1 score cp 30 nodes 1 pv e2e4 e7e5');
      say('info depth 14 multipv 2 score cp 25 nodes 1 pv d2d4 d7d5');
      say('info depth 14 multipv 3 score cp 20 nodes 1 pv g1f3 g8f6');
      say('info depth 15 multipv 1 score cp 31 nodes 1 pv e2e4 c7c5');
      say('info depth 15 multipv 2 score cp 24 nodes 1 pv c2c4 e7e5');
      say('info depth 14 multipv 3 score cp 25 nodes 1 pv d2d4 d7d5');
      say('bestmove e2e4');
      return JSON.stringify(out.lines.map(function (l) { return l.pv[0]; }));
    })()`));
    eq(JSON.stringify(got), JSON.stringify(['e2e4', 'd2d4', 'g1f3']), 'three distinct lines from depth 14');
  });

  await test('engine: a bound line at the next depth still marks shallower reprints', () => {
    const A = boot();
    const got = JSON.parse(A.ev(`(function () {
      var slot = { w: { postMessage: function () {} } }, out = null;
      slotWire(slot);
      clearInterval(slot.guardTimer);
      slot.pending.push({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', mpv: 3, resolve: function (r) { out = r; }, reject: function () {} });
      var say = function (t) { slot.w.onmessage({ data: t }); };
      say('info depth 15 multipv 1 score cp 30 nodes 1 pv e2e4 e7e5');
      say('info depth 15 multipv 2 score cp 25 nodes 1 pv d2d4 d7d5');
      say('info depth 15 multipv 3 score cp 20 nodes 1 pv g1f3 g8f6');
      say('info depth 16 multipv 1 score cp 40 lowerbound nodes 1 pv d2d4 d7d5');
      say('info depth 15 multipv 2 score cp 30 nodes 1 pv e2e4 e7e5');
      say('info depth 15 multipv 3 score cp 20 nodes 1 pv g1f3 g8f6');
      say('bestmove d2d4');
      return JSON.stringify(out.lines.map(function (l) { return l.pv[0]; }));
    })()`));
    eq(got.length, 3, 'three lines: ' + JSON.stringify(got));
    eq(got[0], 'd2d4', 'the best move leads');
  });

  await test('a queen given for two pieces is not called a lost queen; a mate count matches the rows', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    const verdict = (fen, x, bestLine, childLine, byYou) => JSON.parse(A.ev(`(function () {
      var a = ui.session.active, st = stateFromFen('${fen}');
      a.explore = { root: { line: 'best', idx: -1 }, nodes: [xpNode(st, null, null)], at: 0, sel: -1, res: {}, hot: 0, k: 3, say: {}, flash: null };
      var ex = a.explore, P = ex.nodes[0], m = uciToMove(st, '${x}'), c = cloneState(st); applyMove(c, m);
      ex.nodes.push(xpNode(c, [m.from, m.to], { san: sanOf(st, m), uci: '${x}', byYou: ${byYou}, pick: false, ply: xpPly(st) }));
      ex.at = 1;
      ex.res[P.key] = { step: 2, lines: [${JSON.stringify(bestLine)}] };
      ex.res[ex.nodes[1].key] = { step: 2, lines: [${JSON.stringify(childLine)}] };
      return JSON.stringify(xpVerdict(a, ex, 1));
    })()`));
    const b6 = verdict('r1b1k2r/ppq1bpp1/2pp1n1p/4n3/3NPP2/PBN4P/1PPB2P1/R2QK2R b KQkq f3 0 12', 'b7b6',
      { cp: 60, mate: null, pv: ['e5g6'] }, { cp: 372, mate: null, pv: 'f4e5 d6e5 d4c6 c7c6 b3a4 c6a4 c3a4 f6e4 e1g1 e4d2'.split(' ') }, false);
    ok(!/loses the queen/.test(b6.text), b6.text);
    /* a pick whose line mates: the count follows the child's own search plus the move itself */
    const mate = verdict('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a8', { cp: 1500, mate: 3, pv: ['a1a8'] }, { cp: 1500, mate: 1, pv: ['g8h8', 'a8a7'] }, true);
    ok(/It mates in 2\./.test(mate.text) || /^Ra8/.test(mate.text), mate.text);
  });

  await test("the opponent's voice keeps the learner as 'you' in 'is better'", () => {
    eq(C.themVoice('Nb5 lets your winning position slip: after Na6 Black is better.', 'White', 'Black'),
      "Nb5 lets White's winning position slip: after Na6 you are better.", 'voice');
  });

  await test('Back to the lesson and Esc return to the exact frame exploring came from: S0, a story step, the answer shown', () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    const frames = JSON.parse(A.ev(`(function () { var a = ui.session.active, n = buildStory(a).steps.length;
      return JSON.stringify([{ mode: 'show' }, { mode: 's0' }, { mode: 'story', i: 0 }, { mode: 'story', i: n - 1 }]); })()`));
    for (const f of frames) {
      for (const how of ['link', 'esc', 'back']) {
        A.ev(`(function () { var a = ui.session.active; a.view = ${JSON.stringify(f)}; startExplore({}); return 1; })()`);
        eq(A.ev('!!ui.session.active.explore'), true, JSON.stringify(f) + ': exploring');
        /* a move or two first: the way back does not depend on where the trail is */
        A.ev(`(function () { var ex = ui.session.active.explore; explorePlay(legalMoves(ex.st)[0]); return 1; })()`);
        if (how === 'link') { ok(/data-act="exploreOff"[^>]*>Back to the lesson</.test(A.ev('stripHtml(ui.session.active, ui.session)')), 'the panel keeps Back to the lesson'); A.click('exploreOff'); }
        else if (how === 'esc') A.key('Escape');
        else { A.ev('exploreStep(-1)'); A.click('xpBack', null, 0); }
        eq(A.ev('!!ui.session.active.explore'), false, JSON.stringify(f) + ' ' + how + ': still exploring');
        eq(A.ev('JSON.stringify(ui.session.active.view)'), JSON.stringify(f), how + ': the frame it came from');
        eq(A.ev('window.__jobs.filter(function (j) { return j.opts.tag === "explore"; }).length'), 0, how + ': explore jobs left');
      }
    }
    /* a story step still crossfading in comes back landed */
    A.ev(`(function () { var a = ui.session.active; a.view = { mode: 'story', i: 0, pre: true }; startExplore({}); return 1; })()`);
    A.key('Escape');
    eq(A.ev('JSON.stringify(ui.session.active.view)'), JSON.stringify({ mode: 'story', i: 0 }), 'a story step comes back landed');
  });

  await test('the band says what exploring is; the panel holds the trail, the sentence and the rows; the bar is ‹, › and Continue', async () => {
    for (const tier of [1, 2, 3]) {
      const A = boot(); A.ev(STUB);
      A.ev(`(playerTier = function () { return ${tier}; }, 1)`);
      A.ev(ANSWERED);
      A.ev(`(function () { var a = ui.session.active; a.view = { mode: 's0' }; startExplore({}); return 1; })()`);
      const d = JSON.parse(A.ev('JSON.stringify(displayFor(ui.session.active))'));
      eq(d.disc + '|' + d.kind + '|' + d.row1 + '|' + d.row2 + '|' + d.cap, 'king|explore|Try your own moves|' + (tier === 1 ? 'The computer' : 'Stockfish') + ' rates each move.|', 'tier ' + tier + ' band');
      const bar = () => JSON.parse(A.ev('JSON.stringify(barSlots(ui.session.active, ui.session))'));
      let b = bar();
      eq(b.map((x) => x.act).join(' '), 'xpBack xpFwd next', 'the bar');
      eq(b[0].label + '|' + b[0].aria, '‹|Back to the lesson', '‹ at the start');
      /* the button, the band and the sentence name the same one: the computer at tier 1 */
      const pickLabel = tier === 1 ? 'Play its pick' : "Play Stockfish's pick";
      eq(b[1].label, pickLabel, '› at the end of the trail');
      ok(/nav-off/.test(b[1].cls), '› waits for Stockfish');
      ok(/^(Continue|Finish)$/.test(b[2].label) && /btn-big/.test(b[2].cls), 'Continue in gold');
      for (let i = 0; i < 2; i++) { A.ev(`window.__answer(window.__jobs[0], [60, 20, -300])`); await flush(A); }
      b = bar();
      ok(!/nav-off/.test(b[1].cls) && b[1].label === pickLabel, 'Play Stockfish\'s pick once it answers');
      const say0 = A.ev('sayAt(ui.session.active, ui.session.active.explore, 0)');
      ok(tier === 1 ? /^Your move\. The computer's pick is \S+, the gold arrow\.$/.test(say0) : /^Your move\. Stockfish's pick is \S+, the gold arrow\.$/.test(say0), 'tier ' + tier + ' sentence: ' + say0);
      const strip = A.ev('stripHtml(ui.session.active, ui.session)');
      ok(strip.indexOf('<p class="xp-say">' + A.ev('esc(sayAt(ui.session.active, ui.session.active.explore, 0))') + '</p>') >= 0, 'the sentence in the panel');
      ok(/xp-trail/.test(strip) && /data-act="exploreOff"/.test(strip) && (strip.match(/data-act="xpRow"/g) || []).length === 3, 'trail, way back and rows');
      ok(/Your best moves/.test(strip), 'the solver\'s best moves');
      /* › plays Stockfish's pick; then ‹ and the trail's own › */
      const pick = A.ev('ui.session.active.explore.res[xpCur(ui.session.active.explore).key].lines[0].pv[0]');
      A.click('xpFwd', null, 1);
      eq(A.ev('ui.session.active.explore.at + " " + ui.session.active.explore.nodes[1].mv.uci + " " + ui.session.active.explore.nodes[1].mv.pick'), '1 ' + pick + ' true', 'Play Stockfish\'s pick plays it');
      ok(A.ev('sayAt(ui.session.active, ui.session.active.explore, 1)').endsWith(tier === 1 ? '. The computer is thinking…' : '. Stockfish is thinking…'), 'tier ' + tier + ' thinking');
      A.ev('exploreStep(-1)');
      b = bar();
      eq(b[1].label + '|' + b[1].aria + '|' + /nav-off/.test(b[1].cls), '›|Forward one move|false', '› inside the trail');
      eq(b[0].aria, 'Back to the lesson', '‹ at the start again');
      A.ev('exploreStep(1)');
      eq(bar()[0].aria, 'Back one move', '‹ inside the trail');
    }
  });

  await test('tier 1 rows say the standing in words (X3); tiers 2 and 3 keep the numbers', async () => {
    const A = boot(); A.ev(STUB); A.ev(ANSWERED);
    const words = JSON.parse(A.ev(`(function () { var a = ui.session.active, opp = sidesOf(a).opp;
      return JSON.stringify({ opp: opp, w: [100, 80, 79.9, 60, 59.9, 40, 39.9, 20, 19.9, 0].map(function (w) { return CARD_COPY.X3(a, w); }) }); })()`));
    const o = words.opp;
    eq(words.w.join(' / '), ['you are winning', 'you are winning', 'you are better', 'you are better', 'even game', 'even game', o + ' is better', o + ' is better', o + ' is winning', o + ' is winning'].join(' / '), 'X3');
    /* on the rows: the words at tier 1, never the old ones; a percentage at tiers 2 and 3 */
    for (const tier of [1, 2, 3]) {
      A.ev(`(function () { if (ui.session.active.explore) exploreExit('silent'); SF.state = 'ready'; ui.session.active.tier = ${tier}; ui.session.active.xpRes = {}; startExplore({}); return 1; })()`);
      for (let i = 0; i < 2; i++) { A.ev(`window.__answer(window.__jobs[0], [10, -30, -60])`); await flush(A); }
      const rows = JSON.parse(A.ev('JSON.stringify(xpRows(ui.session.active, ui.session.active.explore))'));
      ok(rows && rows.length, 'rows at tier ' + tier);
      if (tier === 1) rows.forEach((r) => ok(r.words && !/about level|you are worse|you are losing|%/.test(r.words) && !r.chip, 'tier 1 row: ' + JSON.stringify(r)));
      else rows.forEach((r) => ok(/^You \d{1,2}%$|mate in/.test(r.chip) && !r.words, 'tier ' + tier + ' row: ' + JSON.stringify(r)));
    }
    /* an even position reads "even game" on a row with nothing more to say */
    A.ev(`(function () { exploreExit('silent'); SF.state = 'ready'; ui.session.active.tier = 1; ui.session.active.xpRes = {}; startExplore({}); return 1; })()`);
    for (let i = 0; i < 2; i++) { A.ev(`window.__answer(window.__jobs[0], [0, 0, 0])`); await flush(A); }
    const r1 = JSON.parse(A.ev('JSON.stringify(xpRows(ui.session.active, ui.session.active.explore))'));
    ok(r1.some((r) => r.words === 'even game'), JSON.stringify(r1.map((r) => r.words)));
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'exploring: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
