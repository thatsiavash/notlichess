// Chess truth (release 2 slice B, B1 to B9), run from cardflow.test.js on the built page in Node
// (test/app-realm.js) with the fixture: require('./chesstruth')(h) returns its tests as [name, fn] pairs, h
// holding cardflow.test.js's boot (the engine stub), eq, ok, tick, OPEN and TRY.
//   The fact sheets are test/data/facts-fixture.json (FACTS_V 2: test/truth/facts.js, the repo's Stockfish 17.1
//   at the app's budgets, 4,000,000 nodes for a winning card's three lines). A try is answered by the stub with
//   the line and score a test gives it, as the real engine gave them at 1,000,000 nodes (the re-check), or from
//   the key with no search; a take-back the line avoids (B6 c) by window.__back.
//   B1 every browser computes the same key, B2 mate first, B3 "Good move" for near winning moves, B4 material
//   words agree with the score, B5 threats a search confirms, B6 what follows a take-back, B7 the answer's reason
//   fits, B8 small word fixes, B9 a miss explained by the line that graded it.
//   The real engine's own test of B1 (a key made on a worker that searched before, twice) is test/keys-real.js.
const fs = require('fs'), path = require('path');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
function keyedFixture(edit) {
  const d = JSON.parse(FIX);
  d.games.forEach((g) => (g.bl || []).forEach((b) => {
    const k = g.id + ':' + b.p;
    if (FACTS.cards[k]) b.k = JSON.parse(JSON.stringify(FACTS.cards[k]));
    if (edit && b.k) edit(k, b);
  }));
  return JSON.stringify(d);
}
const store = (fix) => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': fix });
const CARD1 = '184455333378:68', CARD4 = '184268949378:16', KB2 = '184205946040:62', RACE = '184425961982:122', BACK = '184435538450:67',
  KNIGHT = '184359604942:24', MATE = '184364964898:69', ATTACK = '184435538450:47', RA1 = '184434540700:103', P38 = '184205946040:38',
  P58 = '184212737262:58', P56 = '184363754280:56';

module.exports = function (h) {
  const { boot, eq, ok, tick, OPEN, TRY } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);
  const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
  const keyed = (edit) => boot({ storage: store(keyedFixture(edit)) });
  const BAND = `function bandNow(a) { a.reason = 2; var d = displayFor(a); return { phase: a.phase, kind: a.tried ? a.tried.kind : null, r1: d.row1, r2: d.row2, result: a.result || null, misses: a.misses }; }`;
  /* a try answered by the stub: the first search with the line and score given (pv: the reply line, cp and best
     the player's side), the 1,000,000-node re-check the same (its depth the key's, B3); at = moves of a forcing
     line played first */
  const tryOn = async (A, key, tier, u, pv, cp, best, at, mate) => {
    A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${key}', ${tier}); a.t0 = Date.now() - 30000;
      (${JSON.stringify(at || [])}).forEach(function (x) { var m = uciToMove(a.st, x); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; });
      window.__bestCp = ${best == null ? 'null' : best}; tryMove(a, '${u}', ${JSON.stringify(pv)}, ${cp == null ? 'null' : cp}, ${mate == null ? 'null' : mate}); return 1; })()`);
    await settle();
    return JSON.parse(A.ev(`(function () { ${BAND} return JSON.stringify(bandNow(ui.session.active)); })()`));
  };
  /* the card answered with its own answer (or a line played through), settled: rows, See why, Details, check line */
  const SETTLED = `function settledNow(a) {
    a.animMove = null; a.settle = 2; a.view = { mode: 's0' };
    var d = displayFor(a), S = buildStory(a);
    var dh = detailsHtml().replace(/<[^>]+>/g, '\\n').split('\\n').map(function (x) { return x.trim().replace(/&#39;/g, "'"); }).filter(Boolean);
    return { r1: d.row1, r2: d.row2, caps: S.steps.map(function (s) { return s.cap; }), details: dh, check: checkLine(a), result: a.result, cat: resultCategory(a, a.result), stars: cardStars(a, resultCategory(a, a.result)) };
  }`;
  const solve = (A, key, tier) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${SETTLED} var a = openAt('${key}', ${tier});
    if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
    else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
    return JSON.stringify(settledNow(a)); })()`));
  const hints = (A, key, tier) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${key}', ${tier}), out = [];
    for (var n = 1; n <= hintMax(a); n++) { a.hints = n; a.hintAfter = true; out.push(displayFor(a).row2); }
    return JSON.stringify(out); })()`));

  /* ── B1 ── */
  test('R2 B1 every browser computes the same key: each fact sheet search and each 1,000,000-node re-check starts with ucinewgame, Hash 32 and Threads 1 (a first 250,000-node check does not); a winning card\'s three lines are searched at 4,000,000 nodes; FACTS_V 2, so a stored key of version 1 is made again in the background', async () => {
    const A = keyed();
    const r = JSON.parse(A.ev(`(function () {
      var log = [], fen = stateFen(stateAtPly(itemOf('${CARD1}').g.mv, itemOf('${CARD1}').b.p));
      /* the fact sheet asks for a fresh job (the stub keeps each job's opts) */
      factsEval(fen, FACTS_NODES, { multipv: 3 }, { tag: 'k:x', prio: false });
      var asked = window.__evals[window.__evals.length - 1].opts;
      /* the page's own pump sends a fresh job to a worker so */
      SF.workers = [{ w: { postMessage: function (m) { log.push(m); } } }]; SF.state = 'ready';
      var job = function (fresh, nodes) { return { fen: fen, movetime: { nodes: nodes }, mpv: 3, moves: null, prio: false, tag: 'k:x', fresh: fresh, resolve: function () {}, reject: function () {} }; };
      SF.queue = [job(true, FACTS_NODES)]; enginePump();
      var key = log.slice();
      log.length = 0; SF.workers[0].pending = []; SF.queue = [job(false, DEEP_NODES)]; enginePump();
      return JSON.stringify({ asked: !!asked.fresh, key: key, plain: log.slice(), v: FACTS_V, deep: [DEEP_FACTS_NODES, DEEP_FACTS_AT] });
    })()`));
    ok(r.asked, 'a fact sheet\'s search asks for a fresh engine');
    eq(JSON.stringify(r.key.slice(0, 3)), JSON.stringify(['ucinewgame', 'setoption name Hash value 32', 'setoption name Threads value 1']), 'a key job\'s first commands');
    ok(/^position fen /.test(r.key[r.key.length - 2]) && r.key[r.key.length - 1] === 'go nodes 1000000', 'then the position and the search: ' + r.key.join(' | '));
    ok(r.plain.indexOf('ucinewgame') < 0 && /^position fen /.test(r.plain[0]), 'a job that is not fresh starts at its position: ' + r.plain.join(' | '));
    /* a try's first search is not fresh, its 1,000,000-node re-check is (Ra1 on 184434540700:103, near the bands) */
    await tryOn(A, RA1, 2, 'a4a1', ['f5d4', 'g3e3'], 515, 883);
    const jobs = JSON.parse(A.ev(`JSON.stringify(window.__evals.filter(function (j) { return j.opts.tag === 'check'; }).map(function (j) { return [j.nodes, !!j.opts.fresh]; }))`));
    eq(JSON.stringify(jobs), JSON.stringify([[250000, false], [1000000, true]]), 'the check, then its fresh re-check');
    eq(JSON.stringify([r.v, FACTS.v, r.deep[0], r.deep[1]]), JSON.stringify([2, 2, 4000000, 90]), 'FACTS_V 2, the fixture made with it; 4,000,000 nodes from 90%');
    /* a version 1 key is no key: the card waits for its key in the background queue */
    const B = keyed((k, b) => { if (k === CARD1) b.k.v = 1; });
    const old = JSON.parse(B.ev(`JSON.stringify([factsOf(itemOf('${CARD1}').b) === null, enrichTargets().some(function (it) { return it.key === '${CARD1}'; }), factsOf(itemOf('${CARD4}').b) !== null])`));
    eq(JSON.stringify(old), JSON.stringify([true, true, true]), 'a version 1 key is made again, a version 2 one kept');
    /* the facts the fresh, deeper key holds: the mate card's Rg1+ mates in 11 */
    const mk = FACTS.cards[MATE];
    eq(JSON.stringify([mk.a, mk.l[0][2], mk.fm]), JSON.stringify(['f1g1', 11, 11]), 'the mate card\'s key: Rg1+, mate in 11');
  });

  /* ── B2 ── */
  test('R2 B2 mate first: on the mate card (184364964898:69) Rg1+, mate in 11, is the key\'s answer: at 1600 and 2000 "Found it" / "Rg1+ forces mate.", counted first try, one rung; at 700 a mate longer than 3 moves says the band ("Rook to g1 keeps you winning."); its See why never says "lose"; where the key misses the mate, a try that forces mate is the answer all the same (never "That works too"); a safe win 10 points below the best still works too', async () => {
    const A = keyed();
    for (const t of [2, 3]) {
      const s = solve(A, MATE, t);
      eq(s.r1 + ' / ' + s.r2, 'Found it / Rg1+ forces mate.', 'the mate card at tier ' + t);
      eq(JSON.stringify([s.result, s.cat]), JSON.stringify(['first', 'first']), 'counted first try at tier ' + t);
      ok(!s.caps.some((x) => /\blose\b/i.test(x)), 'See why never says "lose" at tier ' + t + ': ' + s.caps.join(' | '));
      const rung = JSON.parse(A.ev(`JSON.stringify(srsRec(itemOf('${MATE}')))`));
      ok(rung && rung.streak === 1, 'one rung climbed at tier ' + t + ': ' + JSON.stringify(rung));
      A.ev(`(function () { var m = srsLoad(); delete m['${MATE}']; srsSave(m); return 1; })()`);
    }
    const s1 = solve(A, MATE, 1);
    eq(s1.r2, 'Rook to g1 keeps you winning.', 'at 700, a mate in 11 is not called checkmate');
    ok(!s1.caps.concat(s1.details).some((x) => /checkmate|\bmate\b/i.test(x)), 'nor anywhere on the card at 700: ' + s1.caps.concat(s1.details).join(' | '));
    /* the key without the mate (as a warm browser made it before B1): Rxf3+ its answer, Rg1+ searched */
    const B = keyed((k, b) => { if (k === MATE) { b.k.a = 'f1f3'; b.k.l = b.k.l.slice(1); b.k.fm = 0; b.k.why = { r: 'band', w: 97 }; b.k.om = 0; } });
    await tryOn(B, MATE, 2, 'f1g1', ['f3g1', 'b1g1', 'g3f3', 'g1f1'], 1500, 812, null, 11);
    const mt = JSON.parse(B.ev(`(function () { ${SETTLED} var a = ui.session.active; return JSON.stringify(settledNow(a)); })()`));
    eq(mt.r1 + ' / ' + mt.r2 + ' / ' + mt.result, 'Found it / Rg1+ forces mate. / first', 'a try that forces mate is found, first try, with its own row');
    ok(mt.details.indexOf('Rg1+ forces mate.') >= 0 && !mt.details.some((x) => /also holds/.test(x)), 'Details name the move on the board: ' + mt.details.join(' | '));
    const mtc = JSON.parse(B.ev(`(function () { var a = ui.session.active; a.settle = 2; a.view = { mode: 'story', i: 0 }; var S = buildStory(a); return JSON.stringify([!!a.alt, !!a.near, S.steps.map(function (x) { return x.cap; })]); })()`));
    ok(!mtc[0] && !mtc[1] && !mtc[2].some((x) => /\blose\b/i.test(x)), 'never works too, never "lose": ' + JSON.stringify(mtc));
    /* a safe win 10 points below the best: That works too, and it holds (the back rank, not a missed chance) */
    const W = keyed();
    const sw = JSON.parse(W.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${BACK}', 2); var v = tryKind(a, 360, null, 89.8, false, true); return JSON.stringify([v.kind, v.band]); })()`));
    eq(JSON.stringify(sw), JSON.stringify(['solved', 'safe']), 'a safe win 10 points below the best, at depth: works too');
  });

  /* ── B3 ── */
  test('R2 B3 "Good move" for near, winning moves: Ra1 on 184434540700:103 (87% against b3\'s 96% at 1,000,000 nodes, above the game move\'s 85%) reads "Good move / There\'s a stronger one." at all three tiers, two stars at 700; the knight line\'s gxf3 after Nxc7+ Ke7 (73% against exf6+\'s 80%) reads "Good move" and the line goes on, ending "Nxc7+ found. exf6+ was stronger later."; mid-line Be6+ on 184205946040:38 (82% against 89%) reads "Good move"; a try below 70% stays a miss; only at depth (a first search alone keeps the old rule)', async () => {
    for (const t of [1, 2, 3]) {
      const A = keyed();
      const r = await tryOn(A, RA1, t, 'a4a1', ['f5d4', 'g3e3', 'd4b3', 'a1a8'], 515, 883);
      eq(r.phase + ' ' + r.kind + ' / ' + r.r1 + ' / ' + r.r2, 'tried close / Good move / There\'s a stronger one.', 'Ra1 at tier ' + t);
      if (t === 1) {
        const st = JSON.parse(A.ev(`(function () { var a = ui.session.active; tryAgain(); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); return JSON.stringify([resultCategory(a, a.result), cardStars(a, resultCategory(a, a.result))]); })()`));
        eq(JSON.stringify(st), JSON.stringify(['good', 2]), 'two stars at 700 once the answer follows');
      }
    }
    /* below 70%: a miss */
    const L = keyed();
    const low = await tryOn(L, RA1, 2, 'a4a1', ['f5d4', 'g3e3'], 150, 883);
    eq(low.kind + ' ' + low.r1, 'miss Not this one', 'a try under 70% stays a miss');
    /* the knight line: Nxc7+ Ke7, then gxf3 */
    const K = keyed();
    const kg = await tryOn(K, KNIGHT, 2, 'g2f3', ['f6e5', 'c7a8', 'h8c8'], 275, 373, ['b5c7', 'e8e7']);
    eq(kg.phase + ' ' + kg.kind + ' / ' + kg.r1 + ' / ' + kg.misses, 'tried close / Good move / 0', 'gxf3 inside the line');
    const go = JSON.parse(K.ev(`(function () { var a = ui.session.active; tryAgain(); var at = [a.phase, a.solIdx]; while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } solved(null, null, null, true); a.settle = 2; a.view = { mode: 's0' }; var d = displayFor(a); return JSON.stringify([at, d.row1, d.row2, a.result, resultCategory(a, a.result)]); })()`));
    eq(JSON.stringify(go[0]), JSON.stringify(['guess', 2]), 'the line goes on from the same step');
    eq(go[1] + ' / ' + go[2], 'You got there / Nxc7+ found. exf6+ was stronger later.', 'the line\'s end');
    eq(go[4], 'good', 'it holds (a good move first)');
    /* mid-line Be6+ on 184205946040:38 */
    const M = keyed();
    const be = await tryOn(M, P38, 2, 'c4e6', ['d7e6', 'e2h5', 'a8g8'], 411, 558, ['f3e5', 'd6e5']);
    eq(be.kind + ' / ' + be.r1, 'close / Good move', 'mid-line Be6+');
    /* a first search alone (no re-check: the bands far) keeps the old rule */
    const N = keyed();
    const shallow = JSON.parse(N.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${RA1}', 2); return JSON.stringify([tryKind(a, 515, null, 96.3, false, false).kind, tryKind(a, 515, null, 96.3, false, true).kind]); })()`));
    eq(JSON.stringify(shallow), JSON.stringify(['miss', 'close']), 'Good move needs the key\'s or the re-check\'s depth');
  });

  /* ── B4 ── */
  test('R2 B4 material words agree with the score: the settle rule reads on while either side faces a mate in one, and with a score accepts a settle point only within 2 pawns of it (else reads on, then names no material); on the attack card (184435538450:47) at 700, 1600 and 2000 nothing says "the pawn", the answer reads "g6 stops Bxg7+." (tier 1 "Pawn to g6 stops their bishop check."), See why never "Now Bxg7 is check"', async () => {
    const A = keyed();
    const r = JSON.parse(A.ev(`(function () {
      /* White to move after Kh8?: Qh5 threatens Qxh7 mate (a mate in one for White, were it their move again) */
      var S = function (fen, ucis, cp) { var s = settleLine(stateFromFen(fen), ucis, null, cp); return { k: s.k, ok: s.ok, agree: s.agree, w: s.w, b: s.b }; };
      return JSON.stringify({
        threat: S('6k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 0 1', ['g8f8', 'b1b8', 'f8e7', 'g2g3', 'e7d6', 'g3g4']),
        quiet: S('6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1', ['g1f1', 'g8f8', 'f1e1', 'f8e8']),
        agree: S('4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1', ['d2d5', 'e8e7', 'e1e2', 'e7e6', 'e2e3', 'e6e7'], 900),
        off: S('4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1', ['d2d5', 'e8e7', 'e1e2', 'e7e6', 'e2e3', 'e6e7'], 200),
        /* a rook down before the line, which takes a rook back: the balance there, 0, is what the score says
           (the change, +5, against +0.2 would not agree) */
        down: S('r3k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1', ['d2d5', 'e8f8', 'e1f1', 'f8g8', 'f1g1', 'g8h8'], 20),
        /* a queen won where the score says +6 (the engine's pawns run smaller than piece values): a fact sheet
           keeps to 2 pawns, a wrong try's reason (settleAgrees loose) agrees */
        big: S('4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1', ['d2d5', 'e8e7', 'e1e2', 'e7e6', 'e2e3', 'e6e7'], 600),
        loose: [settleAgrees(9, 6, true), settleAgrees(9, 6), settleAgrees(9, 2, true), settleAgrees(1, 3.76, true)]
      }); })()`));
    eq(JSON.stringify([r.quiet.k, r.quiet.ok]), JSON.stringify([1, true]), 'a quiet line settles after its first move');
    ok(r.threat.k > 1, 'after Rb8+ no ply is quiet while a mate in one stands: read on (' + JSON.stringify(r.threat) + ')');
    eq(JSON.stringify([r.agree.agree, r.agree.ok, r.agree.w - r.agree.b]), JSON.stringify([true, true, 9]), 'a queen won, the score +9: settled there');
    eq(JSON.stringify([r.off.agree, r.off.ok]), JSON.stringify([false, false]), 'the same count against a score of +2: no settle point agrees, no material named');
    eq(JSON.stringify([r.down.agree, r.down.ok, r.down.k]), JSON.stringify([true, true, 1]), 'a rook down first, one taken back: the balance (0) agrees with +0.2');
    eq(JSON.stringify([r.big.agree, r.loose]), JSON.stringify([false, [true, false, false, false]]), 'a queen won at +6: agreed only for a try\'s reason; never a score worse than the material (the attack card\'s pawn at -3.76)');
    for (const t of [1, 2, 3]) {
      const s = solve(A, ATTACK, t), hs = hints(A, ATTACK, t);
      const all = [s.r2, s.check].concat(s.caps, s.details, hs);
      ok(!all.some((x) => /\bthe pawn\b|\byour pawn\b/.test(x)), 'the attack card at tier ' + t + ': ' + all.join(' | '));
      eq(s.r2, t === 1 ? 'Pawn to g6 stops their bishop check.' : 'g6 stops Bxg7+.', 'its answer at tier ' + t);
      ok(!s.caps.some((x) => /Now (Bxg7|bishop takes on g7) is check/.test(x)), 'no "Now Bxg7 is check" at tier ' + t + ': ' + s.caps.join(' | '));
    }
    /* Ne6 tried: their first capture is a pawn on the way to more, never named; the take-back Nxg7 allows mate */
    const ne6 = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${ATTACK}', 2); window.readyEngine(); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.reason = 2; var d = displayFor(a); return JSON.stringify([d.row1, d.row2]); })()`));
    eq(ne6[1], 'Bxg7+, and Nxg7 allows mate.', 'Ne6 again at 1600 (' + ne6[0] + ')');
  });

  /* ── B5 ── */
  test('R2 B5 threats a search confirms, the same everywhere: a threat is named only within 5 points of their best null-move line and gaining them 10 or more; the back rank never names Rxg4 or Qxa6; 184363754280:56 never reads "Qc6 guards your pawn"; card 1 names gxf5 in Details, the bulb (tier 3\'s check line) and the summary\'s tile; card 4 keeps Qxf2 mate alone (nothing comes within 5 points of a mate) and, O-O having stopped it, names none', async () => {
    const A = keyed();
    eq(JSON.stringify(FACTS.cards[BACK].th), '[]', 'the back rank: no threat confirmed');
    for (const t of [1, 2, 3]) {
      const b = solve(A, BACK, t), q = solve(A, P56, t);
      ok(!b.details.concat([b.check]).some((x) => /Rxg4|Qxa6|rook takes on g4|queen takes on a6/.test(x)), 'the back rank at tier ' + t + ': ' + b.details.join(' | '));
      ok(![q.r2, q.check].concat(q.details, q.caps).some((x) => /guards your pawn/.test(x)), '184363754280:56 at tier ' + t + ': ' + [q.r2].concat(q.details).join(' | '));
    }
    for (const [key, first] of [[CARD1, 'gxf5']]) {
      const s = solve(A, key, 3);
      const th = s.details.filter((x) => /^Their threats?:/.test(x));
      ok(th.length === 1 && th[0].indexOf('Their threat' + (th[0].indexOf('threats') >= 0 ? 's' : '') + ': ' + first) === 0, key + ' Details: ' + th.join(' | '));
      eq(s.check, th[0], key + ': the bulb says the same');
      const tile = JSON.parse(A.ev(`(function () { var ss = ui.session, e = ss.sum && ss.sum['${key}']; return JSON.stringify(e ? e.l : null); })()`));
      eq(tile, th[0], key + ': the summary\'s tile too');
    }
    /* card 4: beside their mate no other move is a threat (none comes within 5 points of a mate), so its
       key keeps Qxf2 mate alone; O-O stopped it, and no surface names a threat, Bxc3+ least of all */
    eq(JSON.stringify(FACTS.cards[CARD4].th), JSON.stringify([['f6f2', 1, 0]]), 'card 4: the mate alone');
    for (const t of [1, 2, 3]) {
      const s = solve(A, CARD4, t);
      ok(![s.r2, s.check].concat(s.details, s.caps).some((x) => /Their threats?:|Two threats|threaten|guards f2 and/.test(x)), 'card 4 at tier ' + t + ': ' + [s.check].concat(s.details, s.caps).join(' | '));
    }
  });

  /* ── B6 ── */
  test('R2 B6 a wrong try says what follows a take-back: at 1600 Qf1 on 184205946040:38 names the knight first ("Qxf3 takes your knight."); exf6 on the knight line "Nothing lost, but there\'s a better move."; card 4\'s Qe2 "After the trade, Qxc3+ forks." where the line takes back, and where it avoids the take-back why that fails ("Bxc3+, and bxc3 Qxc3+ forks."); the back rank\'s Rd1+ "After the trade, Qxg7 is mate." / "Rxd1, and Bxd1 allows Qxg7 mate."; at 700 the attack card\'s Qh6 after Hint 1 "Then their knight attacks your queen.", 184212737262:58\'s Re3 names the bishop; no tier 1 row 2 opens "Then" on a capturing reply', async () => {
    const A = keyed();
    const qf1 = await tryOn(A, P38, 2, 'e2f1', ['h5f3', 'b2b4', 'c5d4', 'c2c3', 'h7g8', 'g1g3', 'f3f2'], -302, 558);
    eq(qf1.r2, 'Qxf3 takes your knight.', 'Qf1 on :38');
    const exf6 = await tryOn(A, KNIGHT, 2, 'e5f6', null, null);
    eq(exf6.r2, 'Nothing lost, but there\'s a better move.', 'exf6 on the knight line (the key\'s own line)');
    /* (bxc3 played: Stockfish 17.1 then gives Qxc3+ Bd2 Qxa1 Qd1 Qxd1+ Kxd1, White -5.43) */
    const qe2 = await tryOn(A, CARD4, 2, 'd1e2', ['d4c3', 'b2c3', 'f6c3', 'c1d2', 'c3a1', 'e2d1', 'a1d1', 'e1d1', 'd7d6', 'h2h4'], -543, 23);
    eq(qe2.r2, 'After the trade, Qxc3+ forks.', 'card 4\'s Qe2, the line taking back');
    /* (Stockfish 17.1: Qe2 Bxc3+ Bd2 at 1,000,000 nodes, -3.74; the take-back bxc3 at 250,000, -4.55: the line
       never goes quiet in 12 plies, and is read to its end) */
    A.ev(`(window.__back = { cp: -455, mate: null, pv: ['f6c3', 'e1d1', 'c3a1', 'c2c3', 'd7d5', 'e4d5', 'e8g8', 'e2e7', 'a1c3', 'e7e2', 'c3d4', 'e2d3'], lines: [], depth: 20, stopped: false }, 1)`);
    const qe2b = await tryOn(A, CARD4, 2, 'd1e2', ['d4c3', 'c1d2', 'c3b2', 'a1b1', 'b2c3', 'e1g1', 'c3d2', 'e2d2', 'd7d5', 'e4d5', 'e8g8'], -374, 23);
    eq(qe2b.r2, 'Bxc3+, and bxc3 Qxc3+ forks.', 'card 4\'s Qe2, the line avoiding bxc3');
    A.ev(`(window.__back = null, 1)`);
    const rd1 = await tryOn(A, BACK, 2, 'd8d1', ['g1d1', 'g4d1', 'b7g7'], 15, 597);
    eq(rd1.r2, 'After the trade, Qxg7 is mate.', 'the back rank\'s Rd1+, taken back');
    A.ev(`(window.__back = { cp: 1500, mate: 1, pv: ['b7g7'], lines: [], depth: 18, stopped: false }, 1)`);
    const rd1b = await tryOn(A, BACK, 2, 'd8d1', ['g1d1', 'h3f3', 'b7f3', 'g4f3', 'g2d2'], 15, 597);
    eq(rd1b.r2, 'Rxd1, and Bxd1 allows Qxg7 mate.', 'the back rank\'s Rd1+, the take-back avoided');
    A.ev(`(window.__back = null, 1)`);
    /* at 700 */
    const B = keyed();
    B.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${ATTACK}', 1); a.hints = 1; a.hintAt = 0; return 1; })()`);
    const qh6 = JSON.parse(B.ev(`(function () { ${TRY} ${BAND} var a = ui.session.active; a.t0 = Date.now() - 30000; window.__bestCp = 364; tryMove(a, 'h3h6', ['g3f5', 'h6e6', 'd4g7', 'f8f7', 'f5h6'], -387); return 1; })()`));
    await settle();
    eq(JSON.parse(B.ev(`(function () { ${BAND} return JSON.stringify(bandNow(ui.session.active)); })()`)).r2, 'Then their knight attacks your queen.', 'the attack card\'s Qh6 after Hint 1, at 700');
    const re3 = await tryOn(B, P58, 1, 'f3e3', ['d4d2', 'g2g3', 'd2d5', 'f2f4', 'd6c5', 'e3e6'], 40, 199);
    /* (Rxd2, then Rxd5: B6's "two captures stay" row) */
    eq(re3.r2, 'Their rook takes your bishop and pawn.', '184212737262:58\'s Re3 at 700');
    /* no tier 1 row 2 opens "Then" on a capturing reply: every key line's try at tier 1 */
    const bad = JSON.parse(B.ev(`(function () { ${OPEN} ${TRY} var out = [];
      allMistakes().forEach(function (it) { var k = factsOf(it.b); if (!k || k.x) return;
        factsLines(k).slice(1).forEach(function (l) {
          var a = openAt(it.key, 1); if (!a || a.sol) return;
          var pv = l.pv, st = cloneState(a.st), m = uciToMove(st, pv[0]); if (!m) return; applyMove(st, m); var r = pv[1] ? uciToMove(st, pv[1]) : null;
          var c = classifyMistake(a.st, pv[0], { pv: [] }, { pv: pv.slice(1), mate: l.mate }, winPct(it.b.eb), winPct(l.cp), it.b.p);
          var w = missWhy(a, c, winPct(l.cp), null, false, null, { pv: pv, deep: true, mate: l.mate, cp: l.cp });
          var row = fitRow(w.cands, 'row2', w.fall);
          if (r && (r.ep >= 0 || st.b[r.to]) && /^Then /.test(row)) out.push(it.key + ' ' + pv[0] + ': ' + row);
        }); });
      return JSON.stringify(out); })()`));
    eq(bad.length, 0, 'tier 1 rows opening "Then" over a capture: ' + bad.slice(0, 4).join(' | '));
    /* "Nothing lost" only where it holds: never from a line whose count disagrees with its score (184172942198:33's
       Nh4 Rxf6 gxf6, 1,000,000 nodes, whose deeper line wins the knight), nor from a first search's line */
    const nl = JSON.parse(B.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184172942198:33', 2);
      var deep = ['g6h4','f1f6','g7f6','d4d5','c7c6','d5e6','d7d1','a1d1','c6b5','e2h5','h4g6','h2f3'], first = ['g6h4','f1f6','g7f6','d4d5','e6h3','g2h3','e8c8','c3c4','a7a6','b5d4','f6f5','d1d3'];
      var e1 = tryEvent(a, deep, { cp: -37, win: winPct(-37), deep: true }), e2 = tryEvent(a, first, { cp: -11, win: winPct(-11), deep: false }), e3 = tryEvent(a, first, { cp: -11, win: winPct(-11), deep: true });
      return JSON.stringify([e1 && e1.t, e2 && e2.t, e3 && e3.t]); })()`));
    eq(JSON.stringify(nl), JSON.stringify([null, null, 'even']), '184172942198:33\'s Nh4: no "Nothing lost" out of line with the score or from a first search');
  });

  /* ── B7 ── */
  test('R2 B7 the answer\'s reason fits: card 1 at 1600, Qd7+ then Qe6, "Safe, but Black is better now." then "Qe6 is the only move that holds." (a first-try Qe6 keeps "Qe6 saves your queen. Rg1 lost it."); 184212737262:58 "Rxf5 avoids the mate Be3 allowed."; card 4 at 700, Qf3, "Queen to f3 guards f2." (B5: the mate alone); the pawn race at 700, Kxg6, "Their pawn will become a queen."; the Kb2 card at 700 never says "checkmate"; a found-band move has no main-move arrow at 700; after Show the answer, a found-band move played by hand gets its own reason ("Qf3 guards f2.")', async () => {
    const A = keyed();
    const d7 = await tryOn(A, CARD1, 2, 'f5d7', null, null);
    eq(d7.r2, 'Safe, but Black is better now.', 'Qd7+ at 1600');
    const e6 = JSON.parse(A.ev(`(function () { ${SETTLED} var a = ui.session.active; tryAgain(); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); return JSON.stringify(settledNow(a)); })()`));
    eq(e6.r2, 'Qe6 is the only move that holds.', 'then Qe6');
    eq(solve(A, CARD1, 2).r2, 'Qe6 saves your queen. Rg1 lost it.', 'a first-try Qe6');
    eq(solve(A, P58, 2).r2, 'Rxf5 avoids the mate Be3 allowed.', '184212737262:58 at 1600');
    const f3 = await tryOn(A, CARD4, 1, 'd1f3', null, null);
    const f3s = JSON.parse(A.ev(`(function () { ${SETTLED} return JSON.stringify(settledNow(ui.session.active)); })()`));
    /* (B5: beside the mate Bxc3+ is no threat, so Qf3 guards f2, the mating square, alone) */
    eq(f3s.r1 + ' / ' + f3s.r2, 'Found it / Queen to f3 guards f2.', 'card 4 at 700, Qf3');
    ok(!f3s.caps.concat(f3s.details).some((x) => /Just as good as the main answer/.test(x)), 'never "Just as good as the main answer."');
    /* at tier 1 a found-band move has no main-move arrow (tier 2 keeps its thin green one) */
    const mainArrow = (t) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD4}', ${t}); solved(uciToMove(a.st, 'd1f3'), 'd1f3', { win: winPct(a.it.b.eb), best: winPct(a.it.b.eb), mate: null, band: 'found', deep: true, san: 'Qf3', w: 'queen to f3' });
      a.animMove = null; a.settle = 2; a.view = { mode: 's0' }; return JSON.stringify((boardOptsFor(a).opts.arrows || []).filter(function (x) { return x.kind === 'main'; }).length); })()`));
    eq(JSON.stringify([mainArrow(1), mainArrow(2)]), '[0,1]', 'the main-move arrow: none at 700, one at 1600');
    /* the panel's reason is the move on the board: after Show the answer, Qf3 (in the answer's found band) played by hand */
    const sn = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${SETTLED} var a = openAt('${CARD4}', 2); reveal(); a.animMove = null;
      var near = showNearMoves(a).some(function (x) { return moveUci(x) === 'd1f3'; }); playNear(a, uciToMove(a.st, 'd1f3'), true); var s = settledNow(a); return JSON.stringify([near, s.r1, s.r2]); })()`));
    eq(JSON.stringify(sn), JSON.stringify([true, 'The answer: Qf3', 'Qf3 guards f2.']), 'after Show the answer, Qf3 played: its own reason, never Qd2\'s');
    const race = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${RACE}', 1); window.readyEngine(); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.reason = 2; return JSON.stringify(displayFor(a).row2); })()`));
    eq(race, 'Their pawn will become a queen.', 'the pawn race at 700, Kxg6');
    const kb = solve(A, KB2, 1), kh = hints(A, KB2, 1);
    /* (its Details still count the game move's mate: "Pawn takes on c5 allows mate in 7, ...") */
    ok(![kb.r2].concat(kb.caps, kb.details, kh).some((x) => /checkmate/i.test(x)), 'the Kb2 card at 700: ' + [kb.r2].concat(kb.caps, kb.details, kh).join(' | '));
    eq(kb.r2, 'King to b2 keeps you winning.', 'the Kb2 card\'s answer at 700');
    /* an alternative that only trades its piece off never "saves" it (184216981622:42's Ne3 Bxe3 fxe3) */
    const ne3 = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184216981622:42', 1); var w = altWhyOf(a, 'g4e3'); return JSON.stringify([w && w.w.r, altForms(a, 'g4e3')]); })()`));
    ok(ne3[0] !== 'saves' && !/saves/.test(String(ne3[1])), '184216981622:42\'s Ne3: ' + JSON.stringify(ne3));
  });

  /* ── B8 ── */
  test('R2 B8 small word fixes: tier 1\'s Details and board labels hold no notation and no "material" on any keyed card; SAN keeps its check sign ("Qg6+, your game move", "Qg6+ took 6 s"); a card that opens on its drawn Hint 1 keeps its task in row 1; Explore\'s "sets up" names a move legal after the line\'s move; "Kb7 is as good as Rxa7." never beside "Rxa7 was the better move."', async () => {
    const A = keyed();
    const leaks = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var out = [], SAN = /(^|[^A-Za-z0-9])(O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8])[+#]?(?![A-Za-z0-9])/;
      allMistakes().forEach(function (it) { if (!factsOf(it.b) || factsOf(it.b).x) return;
        var a = openAt(it.key, 1); if (!a) return;
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2; a.view = { mode: 's0' };
        var dh = detailsHtml().replace(/<[^>]+>/g, '\\n').split('\\n').map(function (x) { return x.trim().replace(/&#39;/g, "'"); }).filter(Boolean);
        var labs = labelCands(a, boardOptsFor(a), function () { return true; }).map(function (c) { return c.text; });
        /* (the pattern's chip is its name, as Insights and the summary say it: "Lost material to a tactic ›") */
        dh.concat(labs).forEach(function (x) { if (/ \\u203a$/.test(x)) return; if (SAN.test(x) || /\\bmaterial\\b/.test(x)) out.push(it.key + ': ' + x); });
      });
      return JSON.stringify(out); })()`));
    eq(leaks.length, 0, 'tier 1 Details and labels: ' + leaks.slice(0, 5).join(' | '));
    const g1 = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${MATE}', 2); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.lines = a.lines || cardLines(a); var S = buildStory(a);
      return JSON.stringify([S.steps.filter(function (s) { return s.seg === 'game'; }).map(function (s) { return s.cap; })[0], clockLine(a)]); })()`));
    ok(/^Qg6\+/.test(g1[0]) && /^Qg6\+ took /.test(g1[1]), 'check signs kept: ' + JSON.stringify(g1));
    const we = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} store.set('nl:tip:game', 1); var a = openAt('184380745302:11', 1), on = workedExample(a); var d = displayFor(a); return JSON.stringify([on, d.row1, d.row2]); })()`));
    eq(JSON.stringify(we.slice(0, 2)), JSON.stringify([true, 'Find a better move']), 'the worked example keeps its task: ' + JSON.stringify(we));
    const su = JSON.parse(A.ev(`(function () { var st = stateFromFen('6k1/5ppp/8/8/8/2Q5/5PPP/6K1 w - - 0 1'); return JSON.stringify([setsUpOk(st, 'Qc8+', ['c3c4', 'g8h8']), setsUpOk(st, 'Qa3', ['c3c4', 'g8h8'])]); })()`));
    eq(JSON.stringify(su), JSON.stringify([true, false]), 'a "sets up" move must be legal after the line\'s move');
    /* one frame never holds "X is as good as Y" beside "Y was the better move" (the rook ending at 1600, Kb7 found) */
    const rk = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${SETTLED} var a = openAt('184430145348:107', 2); var k = factsOf(a.it.b), l = k.l.filter(function (x) { return x[0] === 'c7b7'; })[0];
      a.yours = { uci: unpackUci(l[3]), cp: l[1], at: 0 }; solved(uciToMove(a.st, 'c7b7'), 'c7b7', { win: winPct(l[1]), best: winPct(k.l[0][1]), mate: null, band: 'found', deep: true, san: 'Kb7', w: 'king to b7' });
      var s = settledNow(a); return JSON.stringify([s.r2, s.details.filter(function (x) { return / was the (better|main) move\\.$/.test(x); })]); })()`));
    ok(rk[0] === 'Kb7 is as good as Rxa7.' && !rk[1].some((x) => /better move/.test(x)), 'the rook ending at 1600: ' + JSON.stringify(rk));
  });

  /* ── B9 ── */
  test('R2 B9 a miss is explained by the line that graded it: foil:184364964898:45\'s Ne5, read "After Nxe2, the game is even." by its first 250,000-node search, is graded and said by the 1,000,000-node re-check: "After f3, White is better."', async () => {
    const A = keyed();
    A.ev(`(function () { ${OPEN} ${TRY} var it = itemOf('foil:184364964898:45'), b = it.b, gu = uciOfSan(it.g.mv, b.p);
      b.bu = gu; b.lu = packUci([gu]); b.ru = ''; b.eb = 288; b.ea = 288; b.wb = winPct(b.eb); b.wa = winPct(b.ea); b.fl = 0; b.ok = 1; delete b.x;
      playerTier = function () { return 2; }; var a = openCard(it); a.t0 = Date.now() - 30000; window.readyEngine(); window.__holdTry = true; a.tapped = true;
      gradeMove(uciToMove(a.st, 'g4e5')); return 1; })()`);
    /* Stockfish 17.1: at 250,000 nodes Ne5 Nxe2 (Black +0.34), at 1,000,000 Ne5 f3 (Black -2.21); the game move Bxg2 +2.88 */
    const answer = (i, tryCp, pv) => A.ev(`(function () { var j = window.__evals.filter(function (x) { return x.opts.tag === 'check'; })[${i}];
      var lines = [{ cp: -288, mate: null, pv: ['e4g2', 'g1g2'] }, { cp: ${-tryCp}, mate: null, pv: ${JSON.stringify(pv)} }];
      j.res({ cp: -288, mate: null, bestUci: 'e4g2', pv: lines[0].pv, lines: lines, depth: 20, stopped: false }); return 1; })()`);
    answer(0, 34, ['g4e5', 'd4e2', 'e5f3', 'g2f3', 'e4f3']);
    await settle();
    eq(A.ev('ui.session.active.phase'), 'checking', 'the first search alone does not grade the foil\'s miss');
    answer(1, -221, ['g4e5', 'f2f3', 'e4d3', 'd4e2', 'd3e2', 'f1f2']);
    await settle();
    const r = JSON.parse(A.ev(`(function () { ${BAND} return JSON.stringify(bandNow(ui.session.active)); })()`));
    /* (B6's order puts what the reply attacks before the band: f3 hits the bishop on e4) */
    eq(r.kind + ' / ' + r.r2, 'miss / Then f3 attacks your bishop.', 'graded and said by the re-check');
    ok(!/Nxe2|even/.test(r.r2), 'never the first search\'s line or band');
    const t3 = JSON.parse(A.ev(`(function () { var a = ui.session.active; return JSON.stringify([a.tried.reply, (a.tried.line || [])[0]]); })()`));
    eq(JSON.stringify(t3), JSON.stringify(['f2f3', 'f2f3']), 'See it plays the re-check\'s reply');
  });

  /* ── what the new gate (C5) read on release 2: Explore, the danger ring, "allows", threats beside a mate ── */
  test('R2 C5 Explore says material as the card face does: a count only where the line\'s material agrees with its score (B4), still stands where the line ends (what is won back on its last move was never won) and is more than a pawn; "B sets up X" only where X, after B and their reply, is a move of B\'s side that forks the pieces named', () => {
    const A = keyed();
    const r = JSON.parse(A.ev(`(function () {
      var st = stateFromFen('4k3/8/8/8/3n4/8/3Q4/4K3 b - - 0 1'), L = ['e8e7', 'd2d4', 'e7e6', 'e1e2', 'e6e7', 'e2e3'];
      var pawn = stateFromFen('4k3/8/8/8/3p4/8/3Q4/4K3 b - - 0 1');
      var back = stateFromFen('8/8/4k3/3n4/4P3/4K3/8/8 w - - 0 1'), B = ['e4d5', 'e6e7', 'e3d4', 'e7d6', 'd4c4', 'd6c7', 'c4c5', 'c7d7', 'c5b6', 'd7d6', 'b6b7', 'd6d5'];
      var fork = stateFromFen('r3k3/7p/8/1N6/8/8/8/6K1 w - - 0 1'), a63 = cardFor(itemOf('184234373418:63'));
      return JSON.stringify({ agree: xpClaim(st, L, -900), under: xpClaim(st, L, -1500), pawn: xpClaim(pawn, L, -950), back: xpClaim(back, B, 0), short: xpClaim(back, B.slice(0, 6), 100),
        nc7: setsUpOk(fork, 'Nc7+', ['g1f1', 'h7h6'], ['rook', 'king']), nc7q: setsUpOk(fork, 'Nc7+', ['g1f1', 'h7h6'], ['queen', 'king']),
        qd5: setsUpOk(a63.pre, 'Qd5+', unpackUci(a63.it.b.lu), ['rook', 'king']),
        named: [xpNamedLoss('Qxh2 takes a pawn, but Rxh2 takes your queen.'), xpNamedLoss('Qf3 puts your queen where Nxf3+ takes it.'), xpNamedLoss('Kf7 misses c5.')] });
    })()`));
    eq(JSON.stringify(r.agree), JSON.stringify({ n: -3, w: 'the knight' }), 'a knight lost, the score in line with it');
    eq(r.under, null, 'the same knight under a score 6 pawns worse: no count (the line is not read out)');
    eq(r.pawn, null, 'a single pawn: no count');
    eq(r.back, null, 'a knight won, then a pawn of it given back on the line\'s last move: no count of the knight');
    eq(JSON.stringify(r.short), JSON.stringify({ n: 3, w: 'the knight' }), 'the same line ending before the king takes back: the knight');
    eq(JSON.stringify([r.nc7, r.nc7q]), '[true,false]', 'Nc7+ after Kf1 h6 forks the rook and king (and no queen)');
    eq(r.qd5, false, '184234373418:63: Qd5+ is no move of Black\'s after c5 bxc5');
    eq(JSON.stringify(r.named), '[8,9,0]', 'what a sentence says is lost: a queen for a pawn, a queen, nothing');
  });

  test('R2 C5 the danger ring and "lets them": a piece is in danger only where the key\'s search confirms a capture of it (no ring from the exchange alone, none before a search), and "M lets them take your X" only where no X could be taken for profit before M; "Now Black can checkmate" only where they had no mate in one before', async () => {
    /* card 1 with its key (gxf5 and cxd3+ confirmed), and with cxd3+ taken out of its threats */
    const ring = (A) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2); a.hints = 1; a.hintAfter = true; var hm = hintMarks(a), dz = dangerNow(a.it);
      return JSON.stringify({ at: dz.at.map(function (x) { return sqName(x[0]); }), rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }), aria: (function () { var f = boardOptsFor(a); return boardAria(a, f.st, f.opts).split(/(?<=\\.) /).filter(function (x) { return /^Red ring/.test(x); }); })() }); })()`));
    const full = ring(keyed());
    eq(JSON.stringify(full.at), '["f5","d3"]', 'card 1: the queen and the bishop, both captures confirmed');
    eq(JSON.stringify(full.rings), '["f5 attacked","d3 attacked"]', 'both ringed');
    const one = ring(keyed((k, b) => { if (k === CARD1) b.k.th = [['g6f5', 0, 9]]; }));
    eq(JSON.stringify([one.at, one.rings]), JSON.stringify([['f5'], ['f5 attacked']]), 'with cxd3+ unconfirmed, the bishop is not in danger and not ringed');
    ok(one.aria.length === 1 && /queen on f5 is in danger/.test(one.aria[0]), 'the board says so: ' + JSON.stringify(one.aria));
    /* before any search (no key, the engine down): the exchange's words, no ring */
    const B = boot();
    const pre = JSON.parse(B.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2); a.hints = 1; a.hintAfter = true; var hm = hintMarks(a); return JSON.stringify([displayFor(a).row2, hm.rings.length, hm.arrows.length]); })()`));
    eq(JSON.stringify(pre), JSON.stringify(['Your queen is attacked twice.', 0, 0]), 'no search yet: the words, nothing drawn');
    /* 184430442654:12: the bishop on c4 stood attacked by d5 before Bxd5, so Hint 1 says so, never "lets them take" */
    const A = keyed();
    for (const t of [1, 2]) {
      const h = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184430442654:12', ${t}); a.hints = 1; a.hintAfter = true; var hm = hintMarks(a);
        return JSON.stringify([displayFor(a).row2, hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; })]); })()`));
      ok(!/lets them/.test(h[0]) && JSON.stringify(h[1]) === '["c4 attacked"]', '184430442654:12 at tier ' + t + ': ' + JSON.stringify(h));
    }
    /* 184234147866:38: Qxh2 mated in one before Qd4 too */
    const qd4 = solve(A, '184234147866:38', 2);
    ok(!qd4.caps.some((x) => /Now Black can checkmate/.test(x)), '184234147866:38: ' + qd4.caps.join(' | '));
  });

  test('R2 C5 the classifier\'s words hold as said: "M allows X, forking ..." (and "allows A B, and then C forks") only where the same fork was not there before M; "ignores their threat: X" only for a threat the key\'s search kept; beside a mate of theirs no other threat (B5), so card 4\'s Qd2 guards f2 alone', () => {
    const A = keyed();
    for (const [key, re] of [['184380449450:16', /allows Bxc3\+/], [CARD4, /allows Bxc3 bxc3/], ['184226907592:43', /allows Nd7/], ['184205946040:58', /ignores Black's threat/], ['184364964898:59', /ignores White's threat/]]) {
      for (const t of [2, 3]) {
        const s = solve(A, key, t);
        ok(!s.details.some((x) => re.test(x)), key + ' at tier ' + t + ': ' + s.details.filter((x) => / allows | ignores | loses | lets | gives back | take over/.test(x)).join(' | '));
      }
    }
    const c4 = solve(A, CARD4, 2);
    eq(c4.r2, 'Qd2 guards f2.', 'card 4: Qd2 guards the mating square alone');
    const r = JSON.parse(A.ev(`(function () { var st = stateFromFen('r1b1k2r/ppppnppp/5q2/8/2BbP3/2N5/PPP2PPP/R1BQK2R w KQkq - 0 9');
      return JSON.stringify(factsThreats(st, [{ cp: 0, mate: -1, pv: ['f6f2'] }, { cp: -500, mate: null, pv: ['d4c3', 'b2c3', 'f6c3', 'e1f1', 'c3a1', 'h2h3', 'd7d6'] }], true, false, { w: 52, cp: -17 })); })()`));
    eq(JSON.stringify(r), JSON.stringify([['f6f2', 1, 0]]), 'their mate alone: Bxc3+ is 19 points below it');
  });

  test('R2 C5 a save or a win set beside the game move is worth what the two moves differ by: "X keeps your pawn. Y lost it." and "Better: X. It wins ..." only where the pieces named are within 2 pawns of the swing and neither line mates', () => {
    const A = keyed();
    for (const [key, re] of [['184409997020:80', /keeps your pawn/], ['184173626058:106', /keeps your pawn/], ['184426845252:63', /saves your pawn/]]) {
      for (const t of [1, 2, 3]) {
        const s = solve(A, key, t);
        ok(![s.r2, s.check].concat(s.details, s.caps).some((x) => re.test(x)), key + ' at tier ' + t + ': ' + [s.r2, s.check].concat(s.details).join(' | '));
      }
    }
    for (const t of [2, 3]) {
      const b = solve(A, BACK, t);
      ok(b.caps.indexOf('Better: Rd7.') >= 0 && !b.caps.some((x) => /^Better: Rd7\. It wins/.test(x)), 'the back rank at tier ' + t + ' (Rg4 was mated): ' + b.caps.join(' | '));
    }
  });

  return T;
};
