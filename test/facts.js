// Checked facts and fair grading (v2 slice 1, V1.1 to V1.9), run from cardflow.test.js on the built page
// in Node (test/app-realm.js) with the fixture: require('./facts')(h) returns its tests as [name, fn]
// pairs, h holding cardflow.test.js's boot (the engine stub), eq, ok, tick, OPEN, TRY and AFTER.
//   The fact sheets are test/data/facts-fixture.json, made by test/truth/facts.js with the app's own code
//   (ensureFacts) and the repo's Stockfish 17.1 at 1,000,000 nodes: keyedStorage() puts them on the
//   fixture's records, as a returning player's stored keys, and the page applies them as it loads.
//   V1.1 the fact sheet (the settle rule, the record, grading from the key, the answer it names, the key
//   taking a card's place between frames, only keyed cards dealt with the engine down, the facts the real
//   engine found), V1.2 the found band, V1.3 the re-check at every tier, V1.4 the only move and a forced
//   mate, V1.5 the threats, V1.6 forcing lines graded by their first move, V1.7 the guess words, V1.8
//   mates counted as losses, V1.9 a saving move at More help.
const fs = require('fs'), path = require('path');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
/* the fixture with keys on its records (only those named, when keys is given) */
function keyedFixture(keys) {
  const d = JSON.parse(FIX);
  d.games.forEach((g) => (g.bl || []).forEach((b) => { const k = g.id + ':' + b.p; if (FACTS.cards[k] && (!keys || keys.indexOf(k) >= 0)) b.k = FACTS.cards[k]; }));
  return JSON.stringify(d);
}
const keyedStorage = (keys) => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': keyedFixture(keys) });
const CARD1 = '184455333378:68', CARD2 = '184380745302:11', CARD4 = '184268949378:16', KB2 = '184205946040:62', ROOK = '184430145348:107', KNIGHT = '184359604942:24';

module.exports = function (h) {
  const { boot, eq, ok, tick, OPEN, TRY } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);
  const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

  test('V1.1 the settle rule: a line read to two quiet plies (a quiet check is not one), or a mate, 12 plies at most; each side\'s material and losses there; the first decisive event in order (mate, promotion, a fork or pin it makes, a capture after the side\'s first move, net material), one side\'s alone when asked', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var S = function (fen, ucis, side) { var s = settleLine(stateFromFen(fen), ucis, side); return { k: s.k, ok: s.ok, n: s.n, mate: s.mate, w: s.w, b: s.b, lw: s.lw.join(''), lb: s.lb.join(''), ev: s.ev }; };
      return JSON.stringify({
        mate: S('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8']),
        promo: S('8/P5k1/8/8/8/8/6K1/8 w - - 0 1', ['a7a8q', 'g7g6', 'g2g3', 'g6g5']),
        fork: S('r3k3/8/8/1N6/8/8/6PP/6K1 w - - 0 1', ['b5c7', 'e8d7', 'c7a8', 'd7c8', 'g1f2', 'c8b8']),
        later: S('3qk3/8/8/3p4/8/8/3Q4/3RK3 w - - 0 1', ['d2d5', 'd8d5', 'd1d5', 'e8e7', 'e1e2', 'e7e6']),
        laterB: S('3qk3/8/8/3p4/8/8/3Q4/3RK3 w - - 0 1', ['d2d5', 'd8d5', 'd1d5', 'e8e7', 'e1e2', 'e7e6'], false),
        quiet: S('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', ['e2e3', 'e8e7', 'e3e4', 'e7e6']),
        open: S('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', ['e2e3']),
        illegal: S('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', ['e2e5', 'e8e7'])
      }); })()`));
    eq(JSON.stringify([r.mate.k, r.mate.ok, r.mate.mate, r.mate.ev.t, r.mate.ev.m]), JSON.stringify([1, true, 1, 'mate', 'a1a8']), 'a mate settles the line, and is its event');
    eq(JSON.stringify([r.promo.k, r.promo.w, r.promo.ev.t, r.promo.ev.p]), JSON.stringify([1, 8, 'promo', 'Q']), 'a promotion: settled after it, the new queen less the pawn, its event');
    eq(JSON.stringify([r.fork.ev.t, r.fork.ev.at, r.fork.ev.sq, r.fork.k, r.fork.lb]), JSON.stringify(['fork', 1, 'c7', 3, 'R']), 'Nc7+ forks: the check is no quiet ply, so the line reads on and settles after Nxa8');
    eq(JSON.stringify([r.later.ev.t, r.later.ev.at, r.later.ev.m, r.later.lw, r.later.lb]), JSON.stringify(['capture', 3, 'd1d5', 'Q', 'PQ']), 'a capture after White\'s first move is the event; the losses where it settles');
    eq(JSON.stringify([r.laterB.ev.t, r.laterB.ev.at]), JSON.stringify(['net', 3]), 'Black\'s events alone: its only capture was its first move, so net material');
    eq(JSON.stringify([r.quiet.k, r.quiet.ok, r.quiet.w, r.quiet.ev.t]), JSON.stringify([1, true, 0, 'net']), 'a quiet line settles after its first move');
    eq(JSON.stringify([r.open.k, r.open.ok]), JSON.stringify([1, false]), 'a line that ends before it settles says so (it wants extending)');
    eq(JSON.stringify([r.illegal.n, r.illegal.k, r.illegal.ok]), JSON.stringify([0, 0, false]), 'an illegal move ends the line');
  });

  test('V1.1 the record: every fixture card\'s key (test/truth/facts.js, the repo\'s Stockfish at 1,000,000 nodes) holds the answer, three lines, the refutation, the only move, a forced mate, their threats, both settled lines, the answer\'s reason and Hint 2\'s moves, in about 300 to 800 bytes; the 1,000,000-node facts the spec names: the Kb2 card forces mate, card 2\'s answer is f5, card 4\'s threats are Qxf2 mate then Bxc3, card 1\'s gxf5, 184434540700:103\'s Nxg3 and never e5', () => {
    const cards = FACTS.cards, keys = Object.keys(cards);
    eq(FACTS.v, 1, 'FACTS_V'); eq(FACTS.nodes, 1000000, 'searched at 1,000,000 nodes');
    ok(keys.length >= 85, keys.length + ' keys');
    const bad = [];
    keys.forEach((k) => {
      const c = cards[k];
      if (c.x) { if (['deep', 'lost', 'same'].indexOf(c.x) < 0) bad.push(k + ' x ' + c.x); return; }
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c.a) || !c.l || !c.l.length || c.l[0][0] !== c.a || c.l.length > 3) bad.push(k + ' lines');
      if (!c.g || c.g.length !== 3 || !c.sg || !c.sb || !c.why || !c.why.r || !Array.isArray(c.th) || c.th.length > 2) bad.push(k + ' fields');
      if (c.om !== 0 && c.om !== 1) bad.push(k + ' om');
      if (!Array.isArray(c.pm) || !c.pm.length || c.pm.length > 6 || c.pn < c.pm.length) bad.push(k + ' pm');
      if (JSON.stringify(c).length > 1000) bad.push(k + ' ' + JSON.stringify(c).length + ' bytes');
    });
    eq(bad.length, 0, bad.slice(0, 5).join(' | '));
    ok(cards[KB2].fm > 0 && cards[KB2].why.r === 'mate', 'the Kb2 card forces mate: ' + JSON.stringify([cards[KB2].fm, cards[KB2].why]));
    eq(cards[CARD2].a, 'f7f5', 'card 2\'s answer is f5');
    eq(JSON.stringify(cards[CARD4].th), JSON.stringify([['f6f2', 1, 0], ['d4c3', 0, 3]]), 'card 4: Qxf2 mate, then Bxc3');
    eq(cards[CARD2].th[0][0], 'e2e4', 'card 2: Qxe4');
    eq(cards[CARD1].th[0][0], 'g6f5', 'card 1: gxf5');
    const t103 = cards['184434540700:103'].th;
    ok(t103.length && t103[0][0] === 'f5g3' && !t103.some((t) => t[0] === 'e6e5'), '184434540700:103: Nxg3, never e5: ' + JSON.stringify(t103));
  });

  test('V1.1 the key on a record: a key whose answer differs from the stored one becomes the card\'s answer (card 2: d5 stored, f5 the key\'s), its lines and scores the record\'s; a try among the key\'s three lines is graded at the key\'s depth with no search (d5, in the found band: "Found it", first try)', async () => {
    const A = boot({ storage: keyedStorage() });
    const rec = JSON.parse(A.ev(`(function () { var b = model().byKey['${CARD2}'].b; return JSON.stringify({ bu: b.bu, kp: b.kp, eb: b.eb, lu: b.lu, v: b.v }); })()`));
    const k = FACTS.cards[CARD2];
    eq(JSON.stringify([rec.bu, rec.kp, rec.eb, rec.lu, rec.v]), JSON.stringify(['f7f5', 1, k.l[0][1], k.l[0][3], 2]), 'the record follows its key');
    A.ev(`(function () { ${OPEN} ${TRY} window.readyEngine(); var a = openAt('${CARD2}', 2); a.t0 = Date.now() - 30000; window.__evals = []; a.tapped = true; gradeMove(uciToMove(a.st, 'd7d5')); return 1; })()`);
    await settle();
    const r = JSON.parse(A.ev(`(function (a) { a.settle = 2; var d = displayFor(a); return JSON.stringify({ best: a.bestUci, phase: a.phase, result: a.result, near: a.near && a.near.deep, alt: !!a.alt, searched: window.__evals.length, row1: d.row1, row2: d.row2 }); })(ui.session.active)`));
    eq(r.best, 'f7f5', 'the card asks for the key\'s answer');
    eq(r.searched, 0, 'no search for a try among the key\'s lines');
    eq(JSON.stringify([r.phase, r.result, r.near, r.alt]), JSON.stringify(['done', 'first', true, false]), 'd5 is in the found band: found first try, at the key\'s depth');
    eq(r.row1 + ' / ' + r.row2, 'Found it / d5 is as good as f5.', 'its words');
  });

  test('V1.1 the key takes the card\'s place between frames: one landing while the card asks with nothing on the board replaces it at once (the answer and lines the key\'s, what was tried kept); one landing over a try waits for Try again; a key that sets the card aside takes it out of the set', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var put = function (key) { var it = itemOf(key); it.b.k = ${JSON.stringify(FACTS.cards[CARD2])}; delete it.b.kp; factsApply(it); delete it.b.dz; modelDirty(); return it; };
      var out = {};
      ui.session = { mode: 't', label: 't', keys: ['${CARD2}'], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard();
      var a = ui.session.active; a.hints = 1; keepProgress(a);
      out.before = a.bestUci;
      var t0 = a.t0;
      factsLanded(put('${CARD2}'));
      var b = ui.session.active;
      out.now = [b !== a, b.bestUci, b.hints, b.t0 === t0];
      /* over a try (the engine down: unchecked, on the board) */
      var it = itemOf('${CARD2}'); delete it.b.k; delete it.b.kp; it.b.bu = 'd7d5'; modelDirty();
      ui.session = { mode: 't', label: 't', keys: ['${CARD2}'], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard();
      a = ui.session.active; a.shownAt = 0; gradeMove(uciToMove(a.st, 'e4c5'));
      out.tried = a.phase;
      factsLanded(put('${CARD2}'));
      out.held = [ui.session.active === a, a.keyDue, a.bestUci];
      tryAgain();
      out.after = [ui.session.active !== a, ui.session.active.bestUci, ui.session.active.phase, ui.session.active.attempts];
      /* a key that sets it aside */
      var it2 = itemOf('${CARD1}');
      ui.session = { mode: 't', label: 't', keys: ['${CARD1}', '${CARD4}'], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard();
      it2.b.k = { v: FACTS_V, x: 'deep', a: it2.b.bu, l: [], g: [] }; delete it2.b.kp; factsApply(it2);
      factsLanded(it2);
      out.aside = [it2.b.x, ui.session.keys.join(','), ui.session.active && ui.session.active.key];
      return JSON.stringify(out); })()`));
    eq(r.before, 'd7d5', 'the stored answer before the key');
    eq(JSON.stringify(r.now), JSON.stringify([true, 'f7f5', 1, true]), 'replaced at once, its answer the key\'s, its hint and clock kept');
    eq(r.tried, 'tried', 'a try on the board');
    eq(JSON.stringify(r.held), JSON.stringify([true, true, 'd7d5']), 'a try on the board: the key waits');
    eq(JSON.stringify(r.after), JSON.stringify([true, 'f7f5', 'guess', 1]), 'Try again: the card asks again on the key, the try counted');
    eq(JSON.stringify(r.aside), JSON.stringify(['deep', CARD4, CARD4]), 'a key that sets the card aside takes it out, the next one opens');
  });

  test('V1.1 with the engine down only cards with a stored key are dealt: Today\'s set and an extra set hold keyed cards alone (none with no key at all), and a set holding an unkeyed card skips it when it comes', () => {
    const keyed = [CARD1, CARD2, CARD4, KB2, ROOK, KNIGHT, '184257113186:38', '184435538450:67'];
    const A = boot({ keysOnly: true, storage: keyedStorage(keyed) });
    const r = JSON.parse(A.ev(`(function () {
      SF.state = 'failed';
      var plan = todayPlan().keys, more = morePracticeKeys(), all = allMistakes().filter(trainable).length;
      ui.session = { mode: 't', label: 't', keys: ['184212737262:56', '${CARD1}'], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard();
      return JSON.stringify({ plan: plan, more: more, all: all, open: ui.session && ui.session.active && ui.session.active.key, keys: ui.session && ui.session.keys });
    })()`));
    ok(r.plan.length > 0 && r.plan.every((k) => keyed.indexOf(k) >= 0), 'Today: keyed cards alone: ' + r.plan.join(','));
    ok(r.more.every((k) => keyed.indexOf(k) >= 0), 'an extra set: keyed cards alone: ' + r.more.join(','));
    ok(r.all > 60, 'the other cards are still in the model (' + r.all + '), only not dealt');
    eq(r.open, CARD1, 'the unkeyed card is skipped at its turn');
    eq(JSON.stringify(r.keys), JSON.stringify([CARD1]), 'and leaves the set');
    const B = boot({ keysOnly: true });
    eq(B.ev(`(SF.state = 'failed', todayPlan().keys.length)`), 0, 'no key at all: nothing dealt');
    eq(B.ev(`(SF.state = 'ready', todayPlan().keys.length > 0)`), true, 'the engine up: the stored cards are dealt, each waiting for its look');
  });

  test('V1.2 a move within 4 points counts as found: the rook ending at 1600, Kb7 first: "Found it" ("Kb7 is as good as Rxa7."), counted first try in the headline, one rung, Details "Step 1 of 3 · back in 3 days", the main move a thin green arrow on the settled frame; card 2, f5: "Found it", a step up; at tier 1 "Just as good as the main answer."', async () => {
    const A = boot({ storage: keyedStorage() });
    const play = (key, tier, u) => {
      A.ev(`(function () { ${OPEN} ${TRY} window.readyEngine(); var a = openAt('${key}', ${tier}); a.t0 = Date.now() - 30000; a.tapped = true; gradeMove(uciToMove(a.st, '${u}')); return 1; })()`);
    };
    play(ROOK, 2, 'c7b7');
    await settle();
    const r = JSON.parse(A.ev(`(function (a) { a.settle = 2; a.animMove = null; var d = displayFor(a), f = boardOptsFor(a), e = ui.session.sum[a.key];
      return JSON.stringify({ result: a.result, row1: d.row1, row2: d.row2, cat: e.c, rungs: e.p, moved: e.m, when: scheduleWords(a.rec, a), head: recapScore(ui.session, [a.key], 2).head,
        main: (f.opts.arrows || []).filter(function (x) { return x.kind === 'main'; }).map(function (x) { return sqName(x.from) + sqName(x.to); }), aria: /Thin green arrow: the main move, rook a1 to a7\\./.test(f.opts.label) }); })(ui.session.active)`));
    eq(r.row1 + ' / ' + r.row2, 'Found it / Kb7 is as good as Rxa7.', 'its words at 1600');
    eq(JSON.stringify([r.result, r.cat, r.rungs, r.moved]), JSON.stringify(['first', 'first', 1, 'up']), 'graded first try: one rung, a step up');
    eq(r.head, '1 of 1 found first try.', 'the headline counts it');
    eq(r.when, 'Step 1 of 3 · back in 3 days', 'Details');
    eq(JSON.stringify([r.main, r.aria]), JSON.stringify([['a1a7'], true]), 'the main move, a thin green arrow, named on the board');
    play(CARD2, 2, 'f7f5');
    await settle();
    eq(A.ev(`(function (a) { return [a.result, displayFor(a).row1, ui.session.sum[a.key].m].join(' / '); })(ui.session.active)`), 'first / Found it / up', 'card 2, f5: found, a step up');
    play(ROOK, 1, 'c7b7');
    await settle();
    eq(A.ev(`(function (a) { a.settle = 2; return displayFor(a).row2; })(ui.session.active)`), 'Just as good as the main answer.', 'tier 1');
  });

  test('V1.2 "works too" only for a safe win more than 4 points below the best: "That works too", "The main move was X." (tier 1 in words), it holds, and the summary gives it no first-try tick; after Show the answer a move in the shown move\'s found band plays as the shown move does (graded shown)', async () => {
    const A = boot();
    const key = A.ev(`(function () { playerTier = function () { return 2; }; return allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && !(x.b.mb > 0) && winPct(x.b.eb) >= 85 && x.b.wa < 60 && familyOf(patternOf(x.b)).key !== 'chances'; })[0].key; })()`);
    ok(!!key, 'a winning card');
    const go = async (tier) => {
      A.ev(`(function () { ${OPEN} ${TRY} ${h.AFTER} var a = openAt('${key}', ${tier}); a.t0 = Date.now() - 30000; var off = offBook(a);
        window.__bestCp = a.it.b.eb; tryMove(a, moveUci(off), null, cpFromWin(winPct(a.it.b.eb) - 10), null); return 1; })()`);
      await settle();
      return JSON.parse(A.ev(`(function (a) { a.settle = 2; var d = displayFor(a), e = ui.session.sum[a.key];
        return JSON.stringify({ result: a.result, alt: !!a.alt, row1: d.row1, row2: d.row2, cat: e.c, moved: e.m, glyph: resultGlyph(e.c), want: [sanOf(a.pre, a.best), moveWords(a.pre, a.best)] }); })(ui.session.active)`));
    };
    let r = await go(2);
    eq(JSON.stringify([r.result, r.alt, r.row1, r.row2]), JSON.stringify(['first', true, 'That works too', 'The main move was ' + r.want[0] + '.']), 'works too, the main move named');
    eq(JSON.stringify([r.cat, r.moved]), JSON.stringify(['alt', 'held']), 'it holds');
    ok(r.glyph.indexOf('rg-first') < 0, 'no first-try tick: ' + r.glyph);
    r = await go(1);
    ok(r.row2 === 'The main move was ' + r.want[1] + '.' || r.row2 === 'The main move was ' + r.want[0] + '.', 'tier 1: ' + r.row2);
    /* the answer shown, then a move of its found band (card 2: f5 shown, d5 played) */
    const B = boot({ storage: keyedStorage() });
    const s = JSON.parse(B.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD2}', 2); a.shownAt = 0; reveal();
      var near = showNearMoves(a).map(moveUci), r0 = a.result;
      sessionClick(sqIndex('d7')); sessionClick(sqIndex('d5'));
      return JSON.stringify({ near: near, result: r0, played: a.shownNear || null, view: a.view.mode, due: !!showDue(a) }); })()`));
    eq(JSON.stringify(s), JSON.stringify({ near: ['d7d5'], result: 'fail', played: 'd7d5', view: 's0', due: false }), 'd5 plays as the shown f5 would, the card graded shown');
  });

  test('V1.2 a move that works too inside a forcing line names the main move of its own step ("The main move was X.", X the line\'s move there, never the line\'s first move)', async () => {
    const A = boot({ storage: keyedStorage() });
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} window.readyEngine();
      var a = openAt('184434540700:79', 2); a.t0 = Date.now() - 30000;
      gradeMove(uciToMove(a.st, a.sol[0])); var rp = a.reply; theirReply(a, true); replyDone(a, rp);
      var step = sanOf(a.st, uciToMove(a.st, a.sol[2])), first = sanOf(a.pre, a.best);
      var alt = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.sol[2] && !a.st.b[m.to]; })[0];
      window.__bestCp = 900; window.__tryPv = null; tryMove(a, moveUci(alt), null, 500, null);
      return JSON.stringify({ step: step, first: first }); })()`));
    await settle();
    const s = JSON.parse(A.ev(`(function (a) { a.settle = 2; a.animMove = null; var d = displayFor(a); return JSON.stringify({ phase: a.phase, alt: !!a.alt, at: a.yours && a.yours.at, row1: d.row1, row2: d.row2 }); })(ui.session.active)`));
    eq(JSON.stringify([s.phase, s.alt, s.at, s.row1]), JSON.stringify(['done', true, 2, 'That works too']), 'works too at the line\'s second move of yours: ' + JSON.stringify(s));
    ok(r.step !== r.first, 'the step\'s move is not the first: ' + JSON.stringify(r));
    eq(s.row2, 'The main move was ' + r.step + '.', 'the main move of that step');
  });

  test('V1.3 the re-check at every tier: at 700 and at 1600 a try 3 points inside the found band is searched again at 1,000,000 nodes, and that search decides; one unanswered 8 s after the try keeps the first verdict, with no comparative words', async () => {
    const A = boot();
    A.ev('(window.readyEngine(), window.__re = [], 1)');
    A.ev(`(function () { var e0 = engineEval;
      engineEval = function (fen, mt, prio, opts) {
        if (!(opts && opts.tag === 'check' && mt && mt.nodes === CONFIRM_NODES)) return e0.apply(this, arguments);
        var a = ui.session.active, sign = myPov(a.it) ? 1 : -1, u = opts.searchmoves[0], ex = opts.searchmoves[1];
        var job = { fen: fen, opts: opts, prio: prio };
        window.__re.push(job);
        var lines = [{ cp: window.__reCp * sign, mate: null, pv: [u] }].concat(ex ? [{ cp: a.it.b.eb * sign, mate: null, pv: [ex] }] : []);
        var r = { cp: lines[0].cp, mate: null, bestUci: u, pv: lines[0].pv, lines: lines, depth: 22, stopped: false };
        return window.__reHold ? new Promise(function (res) { job.res = res; }) : Promise.resolve(r);
      };
      return 1; })()`);
    const key = A.ev(`(function () { playerTier = function () { return 2; }; return allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && !(x.b.mb > 0) && winPct(x.b.eb) < 60 && winPct(x.b.eb) > 30 && familyOf(patternOf(x.b)).key !== 'chances'; })[0].key; })()`);
    const tryAt = (tier, gap, reGap, hold) => A.ev(`(function () { ${OPEN} ${TRY} ${h.AFTER}
      window.__re = []; window.__stops = []; window.__reHold = ${!!hold}; window.__bestCp = null;
      var a = openAt('${key}', ${tier}); a.shownAt = 0;
      var b = a.it.b, off = offBook(a);
      window.__reCp = cpFromWin(winPct(b.eb) - ${reGap});
      tryMove(a, moveUci(off), null, cpFromWin(winPct(b.eb) - ${gap}), null);
      return a.phase; })()`);
    const state = () => JSON.parse(A.ev('(function (a) { a.settle = 2; var d = displayFor(a); return JSON.stringify({ phase: a.phase, kind: a.tried ? a.tried.kind : null, result: a.result || null, re: window.__re.length, deep: a.near ? a.near.deep : null, rows: d.row1 + " / " + d.row2 }); })(ui.session.active)'));
    for (const tier of [1, 2]) {
      tryAt(tier, 1, 20, false);
      await settle();
      let s = state();
      eq(JSON.stringify([s.phase, s.kind, s.re]), JSON.stringify(['tried', 'miss', 1]), 'tier ' + tier + ': found at first, a miss by the second search, which decides: ' + JSON.stringify(s));
      tryAt(tier, 1, 20, true);
      await settle();
      A.advance(8100);
      await settle();
      s = state();
      eq(JSON.stringify([s.phase, s.result, s.deep]), JSON.stringify(['done', 'first', false]), 'tier ' + tier + ': unanswered at 8 s, the first verdict stands: ' + JSON.stringify(s));
      ok(!/as good as|works too|still better/.test(s.rows), 'tier ' + tier + ': no comparative words: ' + s.rows);
    }
    /* far from every verdict line: one search */
    tryAt(2, 45, 1, false);
    await settle();
    eq(state().re, 0, 'a try 45 points down is not searched again');
  });

  test('V1.4 the only move and a forced mate at 2000: card 1 settles on "Only move: Qe6 50%. Next best 34%." (the key\'s figures), the story ending on it; the Kb2 card on "Only move: Kb2 forces mate.", and no material claim anywhere on it (hints, rows, See why, Details)', async () => {
    const A = boot({ storage: keyedStorage() });
    const k1 = FACTS.cards[CARD1];
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} window.readyEngine();
      var said = function (key, u) { var a = openAt(key, 3); a.tapped = true; gradeMove(uciToMove(a.st, u)); a.settle = 2; a.animMove = null; return a; };
      var a = said('${CARD1}', 'f5e6'), S = buildStory(a);
      var out = { c1: displayFor(a).row2, end: S.steps[S.steps.length - 1].cap };
      var texts = [];
      var b = openAt('${KB2}', 3);
      [1, 2].forEach(function (n) { b.hints = n; b.hintAfter = true; var d = displayFor(b); texts.push(d.row1, d.row2); });
      b = said('${KB2}', 'c1b2');
      out.kb2 = displayFor(b).row2;
      var S2 = buildStory(b);
      S2.steps.forEach(function (st) { texts.push(st.cap); });
      texts.push(detailsHtml().replace(/<[^>]*>/g, ' '));
      out.texts = texts;
      return JSON.stringify(out); })()`));
    const m = /^Only move: Qe6 (\d+)%\. Next best (\d+)%\.$/.exec(r.c1);
    ok(!!m, 'card 1: ' + r.c1);
    const win = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    ok(Math.abs(+m[1] - win(k1.l[0][1])) <= 2 && Math.abs(+m[2] - win(k1.l[1][1])) <= 2, 'within 2 points of the key: ' + r.c1);
    eq(r.end, r.c1, 'the story ends on it');
    eq(r.kb2, 'Only move: Kb2 forces mate.', 'the Kb2 card');
    const bad = r.texts.filter((t) => /wins the pawn|\bwins\b|You can win|You win/.test(t || ''));
    eq(bad.length, 0, 'no material claim on the Kb2 card: ' + bad.join(' | '));
  });

  test('V1.6 a forcing line is graded by its first move: the rook ending, Rxa7, then a move within 4 points of that step\'s best: "Found it", one rung; the knight line, a slip at Nxa8, then Show the answer: the rung holds (with a hint, never shown) and row 2 reads "Nxc7+ found. Nxa8 missed later."; after Nxc7+, gxf3 off the line is "Not this one", never the game move again', async () => {
    const A = boot({ storage: keyedStorage() });
    /* the line played to its step i (their replies at once) */
    const LINE = `function toStep(a, i) { while (a.solIdx < i) { var mv = uciToMove(a.st, a.sol[a.solIdx]); a.tapped = false; gradeMove(mv); if (a.reply) { var rp = a.reply; theirReply(a, true); replyDone(a, rp); } } return a; }`;
    A.ev(`(function () { ${OPEN} ${TRY} ${LINE} window.readyEngine(); var a = openAt('${ROOK}', 2); a.t0 = Date.now() - 30000; toStep(a, 2);
      var other = legalMoves(a.st).filter(function (x) { return moveUci(x) !== a.sol[2]; })[0];
      window.__bestCp = 0; tryMove(a, moveUci(other), null, -30, null); return 1; })()`);
    await settle();
    let r = JSON.parse(A.ev(`(function (a) { return JSON.stringify({ phase: a.phase, result: a.result, row1: displayFor(a).row1, rungs: ui.session.sum[a.key].p, sol: a.sol.length }); })(ui.session.active)`));
    eq(JSON.stringify([r.phase, r.result, r.row1, r.rungs]), JSON.stringify(['done', 'first', 'Found it', 1]), 'a later step within tolerance continues as found: ' + JSON.stringify(r));
    /* the knight line */
    r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${LINE} var a = openAt('${KNIGHT}', 2); a.t0 = Date.now() - 30000;
      var at = a.sol.indexOf('c7a8');
      return JSON.stringify({ sol: a.sol, at: at, played: a.playedUci }); })()`));
    ok(r.at >= 2 && r.at % 2 === 0, 'the knight line reaches Nxa8 as a move of yours: ' + JSON.stringify(r));
    A.ev(`(function () { ${OPEN} ${TRY} ${LINE} var a = openAt('${KNIGHT}', 2); a.t0 = Date.now() - 30000; toStep(a, ${r.at});
      var other = legalMoves(a.st).filter(function (x) { return moveUci(x) !== 'c7a8'; })[0];
      window.__bestCp = 400; tryMove(a, moveUci(other), null, -400, null); return 1; })()`);
    await settle();
    const s = JSON.parse(A.ev(`(function (a) { var t = [a.phase, a.tried && a.tried.kind, displayFor(a).row1]; a.shownAt = 0; tryAgain(); reveal();
      a.settle = 2; a.view = { mode: 's0' }; var d = displayFor(a), e = ui.session.sum[a.key];
      return JSON.stringify({ t: t, result: a.result, cat: e.c, moved: e.m, note: (ui.session.notes || {})[a.key] || null, row2: d.row2, srs: srsRec(a.it) && srsRec(a.it).streak }); })(ui.session.active)`));
    eq(JSON.stringify(s.t), JSON.stringify(['tried', 'miss', 'Not this one']), 'the slip is a miss on the board');
    eq(JSON.stringify([s.result, s.cat, s.note]), JSON.stringify(['hint', 'hint', null]), 'Show the answer later in the line: with a hint, never shown');
    eq(s.row2, 'Nxc7+ found. Nxa8 missed later.', 'row 2');
    /* gxf3 off the line, right after Nxc7+ */
    A.ev(`(function () { ${OPEN} ${TRY} ${LINE} var a = openAt('${KNIGHT}', 2); toStep(a, 2);
      window.__bestCp = 400; tryMove(a, 'g2f3', null, -200, null); return 1; })()`);
    await settle();
    const g = JSON.parse(A.ev(`(function (a) { a.reason = 2; return JSON.stringify([a.playedUci, a.sol[2], a.tried && a.tried.uci, displayFor(a).row1]); })(ui.session.active)`));
    ok(g[0] === 'g2f3' && g[1] !== 'g2f3' && g[2] === 'g2f3', 'gxf3 is the game move and not the line\'s step here: ' + JSON.stringify(g));
    eq(g[3], 'Not this one', 'inside the line: "Not this one"');
  });

  test('V1.7 guess words that hold: the list is one 1,000,000-node search of three lines; "You saw it: Rf7+." keeps its check, a guess within 4 points "Close. Their best was Rf7+.", else "Not f4: they had Rf7+."; never "as good as"', () => {
    const A = boot();
    const w = JSON.parse(A.ev(`JSON.stringify([guessWords({ v: 'saw', san: 'Rf7+' }, 'Rf7+'), guessWords({ v: 'good', san: 'Kc5' }, 'Rf7+'), guessWords({ v: 'not', san: 'f4' }, 'Rf7+'), guessWords({ v: 'open', san: 'f4' }, 'Rf7+')])`));
    eq(JSON.stringify(w.map((x) => x[0])), JSON.stringify(['You saw it: Rf7+.', 'Close. Their best was Rf7+.', 'Not f4: they had Rf7+.', 'They had Rf7+.']), 'the four kinds');
    ok(!/as good as/.test(JSON.stringify(w)), 'never "as good as"');
    /* the rook ending at tier 3: Rxa7, their best reply Rf7+ guessed, then f4 */
    const B = boot({ storage: keyedStorage() });
    const r = JSON.parse(B.ev(`(function () { ${OPEN} ${TRY} window.readyEngine();
      var out = [];
      ['f8f7', 'f2f4'].forEach(function (g) {
        var a = openAt('${ROOK}', 3), b = a.it.b;
        a.tapped = false; gradeMove(uciToMove(a.st, a.sol[0]));
        var st = replyNode(a);
        b.rl = { k: dzSig(b), d: CONFIRM_NODES, n: legalMoves(st).length, l: [['f8f7', 300, null], ['f2f4', 0, null], ['c4c5', -100, null]] };
        out.push(window.__evals.filter(function (j) { return j.opts && j.opts.rl; }).map(function (j) { return j.nodes + ':' + j.opts.multipv; })[0] || '');
        var rp = a.reply; makeGuess(a, uciToMove(a.st, g)); theirReply(a, true); replyDone(a, rp);
        out.push(displayFor(a).row2);
      });
      return JSON.stringify(out); })()`));
    eq(r[0], '1000000:3', 'the list asked at the key\'s budget');
    eq(r[1], 'You saw it: Rf7+.', 'their reply guessed: its check kept');
    eq(r[3], 'Not f4: they had Rf7+.', 'f4: not "as good as"');
  });

  test('V1.8 a game that ended in mate scores 0 or 100: the fixture stores its mated positions so; an imported game whose analysis left the mated position unscored, and a stored record whose series says 50% there, read it as the mate; the decided rule\'s floor is 30%: on the fixture "In 25 of your 27 losses" and "Slow slides: 2 of 27" (the scope\'s 22 and 5 were counted before opponent3\'s card stood and without the floor\'s two other games: see the build notes); opponent22\'s Re8 into Ra7# decides its game', () => {
    const d = JSON.parse(FIX), mates = d.games.filter((g) => g.status === 'mate');
    eq(mates.length, 10, 'ten games end in mate');
    ok(mates.every((g) => g.wp.slice(-1) === (((g.color === 'white') === (g.res === 'win')) ? '_' : 'A')), 'each one\'s last position scored as the mate');
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var me = { name: 'tester', id: 'tester' }, them = { name: 'x', id: 'x' };
      var lg = { id: 'mate1', createdAt: Date.now() - 86400000, perf: 'rapid', speed: 'rapid', status: 'mate', winner: 'black', moves: 'f3 e5 g4 Qh4#',
                 players: { white: { user: me, rating: 1500 }, black: { user: them, rating: 1500 } }, analysis: [{ eval: 0 }, { eval: 20 }, { eval: -50 }], clock: { initial: 600, increment: 0 } };
      var c = compact(lg, 'tester');
      var old = { wp: 'ggfgg', color: 'white', res: 'loss', status: 'mate', plies: 5 };
      allMistakes();
      var g22 = data.games.filter(function (g) { return g.id === '184330688628'; })[0], d22 = g22.bl.filter(function (b) { return b.d === 1; }).map(function (b) { return b.p + ':' + b.dw; });
      var g34 = data.games.filter(function (g) { return g.id === '184205946040'; })[0], d34 = g34.bl.filter(function (b) { return b.d === 1; }).map(function (b) { return b.p + ':' + b.dw; });
      return JSON.stringify({ wp: c.wp, last: wpAt(c, 3), old: wpAt(old, 4), floor: DECIDED_FLOOR, cov: coverage(), d22: d22, d34: d34 });
    })()`));
    eq(r.wp.length, 4, 'the series reaches the mated position');
    eq(JSON.stringify([r.last, r.old, r.floor]), JSON.stringify([0, 0, 30]), 'the mate read as lost, a stored 50% too; the floor 30%');
    eq(r.cov.losses + ' ' + r.cov.decided, '27 25', 'In 25 of your 27 losses');
    eq(JSON.stringify([r.d22, r.d34]), JSON.stringify([['85:lost'], ['62:lost']]), 'Re8 from 38% into mate decides opponent22\'s game; bxc5 into mate opponent34\'s, lost (no longer a slip)');
    const sl = JSON.parse(A.ev('JSON.stringify(decidedReport().slow)'));
    eq(sl.n + ' ' + sl.none, '27 2', 'Slow slides: 2 of 27');
  });

  test('V1.9 a saving move counts at More help: card 1 at 700, Qd7+, Qh3 and Qg4 each "Good move" with "That saves your queen. Look for more." (a second one on the same showing says it again; two stars, it holds; Qh3 by the key\'s own line, where the d3 bishop still falls to the pawn that attacked it), Qe6 "Found it"; Qxf4 losing the queen and Qg4 at 1600 stay "Not this one"', async () => {
    const A = boot({ storage: keyedStorage() });
    const go = async (tier, u, pv) => {
      A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', ${tier}); a.t0 = Date.now() - 30000; window.__bestCp = null; tryMove(a, '${u}', ${JSON.stringify(pv || ['b7b5'])}, -282, null); return 1; })()`);
      await settle();
      return JSON.parse(A.ev(`(function (a) { var d = displayFor(a); return JSON.stringify({ phase: a.phase, kind: a.tried ? a.tried.kind : null, row1: d.row1, row2: d.row2, good: !!a.foundGood }); })(ui.session.active)`));
    };
    for (const u of ['f5d7', 'f5h3', 'f5g4']) {
      const r = await go(1, u);
      eq(JSON.stringify([r.kind, r.row1, r.row2, r.good]), JSON.stringify(['close', 'Good move', 'That saves your queen. Look for more.', true]), u + ' at 700');
    }
    /* on one showing, Keep looking and a second saving move: it says what it saved again */
    A.ev(`(function () { ${OPEN} ${TRY} var a = ui.session.active; tryAgain(); a.shownAt = 0; window.__bestCp = null; tryMove(a, 'f5h3', ['b7b5'], -282, null); return 1; })()`);
    await settle();
    const again = JSON.parse(A.ev(`(function (a) { var d = displayFor(a); return JSON.stringify([a.tried && a.tried.kind, d.row1, d.row2]); })(ui.session.active)`));
    eq(JSON.stringify(again), JSON.stringify(['close', 'Good move', 'That saves your queen. Look for more.']), 'a second saving move on the same showing says it too');
    const stars = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = ui.session.active; tryAgain(); a.shownAt = 0; gradeMove(uciToMove(a.st, 'f5e6')); var e = ui.session.sum[a.key]; return JSON.stringify([a.result, displayFor(a).row1, e.s, e.c]); })()`));
    eq(JSON.stringify(stars), JSON.stringify(['hint', 'You got there', 2, 'good']), 'then Qe6: found after a good move, two stars, it holds');
    const f = await go(1, 'f5e6');
    eq(f.row1, 'Found it', 'Qe6 at 700');
    const t2 = await go(2, 'f5g4');
    eq(JSON.stringify([t2.kind, t2.row1]), JSON.stringify(['miss', 'Not this one']), 'Qg4 at 1600');
    const lost = await go(1, 'f5f4', ['e5f4']);
    eq(JSON.stringify([lost.kind, lost.row1]), JSON.stringify(['miss', 'Not this one']), 'Qxf4 exf4 at 700: the queen is not saved');
  });

  return T;
};
