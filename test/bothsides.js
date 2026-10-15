// See why shows both sides (release 3), run from cardflow.test.js on the built page in Node (test/app-realm.js)
// with the fixture's fact sheets (test/data/facts-fixture.json): require('./bothsides')(h) returns its tests as
// [name, fn] pairs, h holding cardflow.test.js's boot (the engine stub), eq, ok, OPEN and TRY.
//   At every help level the Better segment plays the answer's line from its fact sheet to where it settles, 2 to
//   6 plies past the better move, ending on a move of yours (the whole line where it mates within that; at tier 1
//   only a mate within 3 moves); each step a caption the board proves; the strip's "Why it works" jumps to B1;
//   a card found opens See why on B1, a card shown on your game.
const fs = require('fs'), path = require('path');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
function keyedFixture() {
  const d = JSON.parse(FIX);
  d.games.forEach((g) => (g.bl || []).forEach((b) => { const k = g.id + ':' + b.p; if (FACTS.cards[k]) b.k = FACTS.cards[k]; }));
  return JSON.stringify(d);
}
const store = (fix) => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': fix });
const CARD1 = '184455333378:68', CARD2 = '184380745302:11', QTRAP = '184257113186:38', KB2 = '184205946040:62', MATE = '184364964898:69';

module.exports = function (h) {
  const { boot, eq, ok, OPEN, TRY } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);
  const keyed = () => boot({ storage: store(keyedFixture()) });
  /* a card answered (found first try, or shown and played), settled: the Better segment's moves and captions */
  const BETTER = `function betterOf(key, tier, how) {
    var a = openAt(key, tier);
    if (!a) return null;
    if (how === 'shown') { reveal(); a.animMove = null; if (!a.sol) playIt(false); }
    else if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
    else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
    a.animMove = null; a.settle = 2; a.view = { mode: 's0' };
    var S = buildStory(a), out = [];
    S.steps.forEach(function (s) { if (s.seg !== 'better') return; var n = s.line.nodes[s.k]; out.push(sanOf(n.before, n.move) + ' | ' + s.cap); });
    return { steps: out, S: S, a: a };
  }`;
  const better = (A, key, tier) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${BETTER} return JSON.stringify(betterOf('${key}', ${tier}).steps); })()`));

  test('release 3, See why shows both sides: the Better segment plays the answer\'s line at every help level, with captions the board proves (card 1, card 2, the queen trap, the Kb2 card, the mate card at tiers 1, 2 and 3)', () => {
    const A = keyed();
    const want = {
      [CARD1]: {
        1: ['Qe6 | Better: queen to e6. It saves your queen.', 'b5 | They play pawn to b5.', 'b3 | You play pawn to b3.', 'Rf6 | They play rook to f6.', 'Qe8 | You play queen to e8.',
          'cxd3+ | Their pawn takes your bishop with check.', 'Rxd3 | Rook takes their pawn. Your queen is safe.'],
        2: ['Qe6 | Better: Qe6. It saves your queen.', 'b5 | They play b5.', 'b3 | You play b3.', 'Rf6 | They play Rf6.', 'Qe8 | You play Qe8.', 'cxd3+ | cxd3 takes your bishop with check.',
          'Rxd3 | Rxd3 takes their pawn. Your queen is safe.'],
        3: ['Qe6 | Better: Qe6. It saves your queen.', 'b5 | They play b5.', 'b3 | You play b3.', 'Rf6 | They play Rf6.', 'Qe8 | You play Qe8.', 'cxd3+ | cxd3 takes your bishop with check.',
          'Rxd3 | Only move: Qe6 50%. Next best 34%.']
      },
      [CARD2]: {
        1: ['f5 | Better: pawn to f5. It guards your knight.', 'exf6 | Their pawn takes your pawn.', 'd5 | You play pawn to d5. Your knight is safe.'],
        2: ['f5 | Better: f5. It guards your knight.', 'exf6 | exf6 takes your pawn.', 'd5 | You play d5. Your knight is safe.'],
        3: ['f5 | Better: f5. It guards your knight.', 'exf6 | exf6 takes your pawn.', 'd5 | f5 exf6 d5: 47%.']
      },
      [QTRAP]: {
        1: ['Be3 | Better: bishop to e3. It traps their queen.', 'Qxf3 | Their queen takes your knight.', 'gxf3 | Your pawn takes their queen. You win ♛ for ♘.'],
        2: ['Be3 | Better: Be3. It traps their queen.', 'Qxf3 | Qxf3 takes your knight.', 'gxf3 | gxf3 takes their queen. You win ♛ for ♘.'],
        3: ['Be3 | Better: Be3. It traps their queen.', 'Qxf3 | Qxf3 takes your knight.', 'gxf3 | Be3 Qxf3 gxf3: 86%.']
      },
      [KB2]: {
        1: ['Kb2 | Better: king to b2. It keeps you winning.', 'Qh7 | They play queen to h7.', 'Qd5 | You play queen to d5.', 'a5 | They play pawn to a5.', 'Qxa8 | Your queen takes their rook.',
          'Qd7 | They play queen to d7.', 'Qa6 | King to b2 keeps you winning.'],
        2: ['Kb2 | Better: Kb2. It forces mate.', 'Qh7 | They play Qh7.', 'Qd5 | You play Qd5.', 'a5 | They play a5.', 'Qxa8 | Qxa8 takes their rook.', 'Qd7 | They play Qd7.', 'Qa6 | Kb2 forces mate.'],
        3: ['Kb2 | Better: Kb2. It forces mate.', 'Qh7 | They play Qh7.', 'Qd5 | You play Qd5.', 'a5 | They play a5.', 'Qxa8 | Qxa8 takes their rook.', 'Qd7 | They play Qd7.', 'Qa6 | Only move: Kb2 forces mate.']
      },
      [MATE]: {
        1: ['Rg1+ | Better: rook to g1. It keeps you winning.', 'Nxg1 | Their knight takes your rook.', 'Qxg1+ | Your queen takes their knight with check.', 'Kf3 | They play king to f3 out of check.',
          'Qf1+ | You play queen to f1, check.', 'Kg3 | They play king to g3 out of check.', 'Re2 | Rook to g1 keeps you winning.'],
        2: ['Rg1+ | Better: Rg1. It forces mate.', 'Nxg1 | Nxg1 takes your rook.', 'Qxg1+ | Qxg1 takes their knight with check.', 'Kf3 | They play Kf3 out of check.', 'Qf1+ | You play Qf1, check.',
          'Kg3 | They play Kg3 out of check.', 'Re2 | Rg1+ forces mate.'],
        3: ['Rg1+ | Better: Rg1. It forces mate.', 'Nxg1 | Nxg1 takes your rook.', 'Qxg1+ | Qxg1 takes their knight with check.', 'Kf3 | They play Kf3 out of check.', 'Qf1+ | You play Qf1, check.',
          'Kg3 | They play Kg3 out of check.', 'Re2 | Rg1+ Nxg1 Qxg1+ Kf3 Qf1+ Kg3 Re2: 100%.']
      }
    };
    for (const key of Object.keys(want)) for (const t of [1, 2, 3]) eq(JSON.stringify(better(A, key, t)), JSON.stringify(want[key][t]), key + ' at tier ' + t);
  });

  test('release 3: on every keyed card at every help level the Better segment runs 2 to 6 plies past the better move (the whole line to a mate within that, at tier 1 only a mate within 3 moves), ends on a move of yours or a mate, never on their capture or a bare move of theirs; each caption fits, says no SAN at tier 1, and a card found or shown tells the same line', () => {
    const A = keyed();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${BETTER}
      var bad = [], n = 0, lens = {};
      var SAN = /(?:\\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\\b[a-h]x[a-h][1-8]|\\bO-O)/;
      allMistakes().filter(trainable).forEach(function (it) {
        var k = factsOf(it.b);
        if (!k || k.x) return;
        [1, 2, 3].forEach(function (t) {
          var f = betterOf(it.key, t, 'first');
          if (!f || !f.S.keyed || f.a.own) return;
          var S = f.S, bs = S.steps.filter(function (s) { return s.seg === 'better'; }), last = bs[bs.length - 1], nd = last.line.nodes[last.k], pov = myPov(f.a.it);
          var past = last.k - last.from, at = it.key + ' t' + t;
          n++; lens[past] = (lens[past] || 0) + 1;
          var mate = isMate(nd.after);
          if (past > 6 || (past < 2 && last.line.nodes.length - 1 >= last.from + 2 && !mate)) bad.push(at + ': ' + past + ' plies past');
          if (!mate && nd.byWhite !== pov && past > 0) bad.push(at + ': ends on their move ' + sanOf(nd.before, nd.move));
          if (mate && t === 1 && k.fm > 3) bad.push(at + ': a mate in ' + k.fm + ' played to the mate at tier 1');
          bs.forEach(function (s) {
            if (!s.cap || !fitsRow(s.cap, 'caption')) bad.push(at + ': caption ' + JSON.stringify(s.cap));
            if (t === 1 && SAN.test(s.cap)) bad.push(at + ': SAN at tier 1: ' + s.cap);
          });
          if (bs[0].cap.indexOf('Better: ') !== 0) bad.push(at + ': B1 ' + bs[0].cap);
          var sh = betterOf(it.key, t, 'shown');
          if (sh && sh.S.steps.length - sh.S.g !== bs.length) bad.push(at + ': shown plays ' + (sh.S.steps.length - sh.S.g) + ' steps, found ' + bs.length);
        });
      });
      return JSON.stringify({ bad: bad, n: n, lens: lens }); })()`));
    ok(r.n > 150, 'keyed stories walked: ' + r.n + ' ' + JSON.stringify(r.lens));
    eq(r.bad.length, 0, r.bad.length + ' faults, first: ' + r.bad.slice(0, 5).join(' | '));
  });

  test('release 3: a card found opens See why on B1 (first try, after a hint, after a miss), a card shown opens on your game; the strip names the segment "Why it works" where it has room, and its two names jump between B1 and G1', () => {
    const A = keyed();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var out = {};
      var open = function (key, tier, how) {
        var a = openAt(key, tier);
        if (how === 'hint') a.hints = 1;
        if (how === 'miss') a.misses = 1;
        if (how === 'shown') { reveal(); a.animMove = null; playIt(false); }
        else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        a.animMove = null; a.settle = 2; a.view = { mode: 's0' };
        seeWhy();
        var S = buildStory(a);
        return { i: a.view.i, g: S.g, n: S.steps.length, result: a.result, strip: storyStripHtml(a).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim(), wiw: S.wiw, a: a };
      };
      ['first', 'hint', 'miss', 'shown'].forEach(function (how) { var o = open('${CARD2}', 1, how); out[how] = [o.i, o.g, o.result]; });
      /* the strip: "Why it works" (four words with Game) where every caption leaves the room, else "Better"; Game first */
      var o = open('${CARD2}', 2, 'first');
      out.strip = [o.strip, o.wiw, storyStripWords(o.a)];
      var o1 = open('${CARD1}', 2, 'first');
      out.folded = [o1.n > 9, o1.strip];
      /* the jumps: Game opens G1, the better name B1 */
      storyJump('game'); out.jump = [o1.i === o1.g, ui.session.active.view.i];
      storyJump('better'); out.jump.push(ui.session.active.view.i === o1.g);
      return JSON.stringify(out); })()`));
    eq(JSON.stringify([r.first[0] === r.first[1], r.hint[0] === r.hint[1], r.miss[0] === r.miss[1], r.shown[0]]), JSON.stringify([true, true, true, 0]),
      'found first try, after a hint and after a miss open on B1, shown on the game: ' + JSON.stringify(r));
    eq(JSON.stringify([r.first[2], r.hint[2], r.miss[2]]), JSON.stringify(['first', 'hint', 'retry']), 'the three ways to find it');
    eq(JSON.stringify(r.strip), JSON.stringify(['Game Why it works', true, 4]), 'card 2\'s strip at 1600');
    eq(JSON.stringify(r.folded), JSON.stringify([true, 'Game · Better 1/7']), 'card 1\'s ten steps fold: "Better", on B1');
    eq(JSON.stringify(r.jump), JSON.stringify([true, 0, true]), 'card 1 found opens on B1, Game opens G1 (its danger frame), Better B1 again');
  });

  return T;
};
