// Words from the facts (v2 slice 2, V2.1 to V2.7), run from cardflow.test.js on the built page in Node
// (test/app-realm.js) with the fixture: require('./words')(h) returns its tests as [name, fn] pairs, h
// holding cardflow.test.js's boot (the engine stub), eq, ok, tick, OPEN and TRY.
//   The fact sheets are test/data/facts-fixture.json (as test/facts.js reads them): keyed() boots with
//   them on the fixture's records, plain() without. A try is answered by the stub with the line and
//   score a test gives it (window.__tryPv, __tryCp, __tryMate); a try among a key's three lines is
//   graded from the key, with no search.
//   V2.1 each template's rule on its audit card (SCRATCH truth audit, findings 2 to 16), V2.2 a wrong
//   try's first decisive event and See it's line, V2.3 Hint 2 from the key's moves of the piece, the
//   missed win and the two threats, the hint counted as it shows; V2.4 one reason per answer; V2.5 the
//   threats line and labelled figures; V2.6 foils from their look; V2.7 the small card fixes.
const fs = require('fs'), path = require('path');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
function keyedFixture() {
  const d = JSON.parse(FIX);
  d.games.forEach((g) => (g.bl || []).forEach((b) => { const k = g.id + ':' + b.p; if (FACTS.cards[k]) b.k = FACTS.cards[k]; }));
  return JSON.stringify(d);
}
const store = (fix) => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': fix });
/* the spec's card names (scope-v2.md, build note 6) */
const CARD1 = '184455333378:68', CARD2 = '184380745302:11', CARD4 = '184268949378:16', KB2 = '184205946040:62', RACE = '184425961982:122',
  QTRAP = '184257113186:38', BACK = '184435538450:67', KNIGHT = '184359604942:24';

module.exports = function (h) {
  const { boot, eq, ok, tick, OPEN, TRY } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);
  const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
  const keyed = () => boot({ storage: store(keyedFixture()) });
  const plain = () => boot();
  /* a card's frame as the band shows it, its reason said */
  const BAND = `function bandNow(a) { a.reason = 2; var d = displayFor(a); return { phase: a.phase, kind: a.tried ? a.tried.kind : null, r1: d.row1, r2: d.row2, chip: d.chip, bar: d.buttons.map(function (b) { return b.label; }).join(' | ') }; }`;
  /* a card answered (found, or shown and played), settled: its rows, the story's captions and Details' lines */
  const SETTLED = `function settledOf(key, tier, how) {
    var a = openAt(key, tier);
    if (how === 'shown') { reveal(); a.animMove = null; if (!a.sol) playIt(false); }
    else if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
    else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
    a.animMove = null; a.settle = 2; a.view = { mode: 's0' };
    var d = displayFor(a), S = buildStory(a);
    var dh = detailsHtml().replace(/<[^>]+>/g, '\\n').split('\\n').map(function (x) { return x.trim().replace(/&#39;/g, "'"); }).filter(Boolean);
    a.view = { mode: 'story', i: S.steps.length - 1 };
    var last = displayFor(a);
    a.view = { mode: 's0' };
    return { r1: d.row1, r2: d.row2, chip: d.chip, caps: S.steps.map(function (s) { return s.cap; }), segs: S.steps.map(function (s) { return s.seg; }), lastChip: last.chip, details: dh, check: checkLine(a) };
  }`;
  const tryOn = async (A, key, tier, u, pv, cp, mate) => {
    A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${key}', ${tier}); a.t0 = Date.now() - 30000; window.__bestCp = null; tryMove(a, '${u}', ${JSON.stringify(pv)}, ${cp == null ? 'null' : cp}, ${mate == null ? 'null' : mate}); return 1; })()`);
    await settle();
    return JSON.parse(A.ev(`(function () { ${BAND} return JSON.stringify(bandNow(ui.session.active)); })()`));
  };
  /* a foil opened as looked at (cardflow.test.js's GAME helper): the game move the best, unless told */
  const FOIL = `function foilOpen(key) {
    var it = itemOf(key), b = it.b, gu = uciOfSan(it.g.mv, b.p);
    b.bu = gu; b.lu = packUci([b.bu]); b.ru = ''; b.eb = 20; b.ea = 20; b.wb = winPct(b.eb); b.wa = winPct(b.ea); b.fl = 0; b.ok = 1; delete b.x;
    return openCard(it);
  }`;
  const settledOf = (A, key, tier, how) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${SETTLED} return JSON.stringify(settledOf('${key}', ${tier}, '${how || ''}')); })()`));

  /* ── V2.1 ── */
  test('V2.1 each claim checks its premise, on its audit card: "Most of your advantage is gone." only where half the edge goes (184173626058:106\'s Nc5 and 184434540700:103\'s Rg7 keep most of it); "back in the game" never under 40% (the Kb2 card); "keeps" only where the piece survives the answer\'s line (184228984228:42); "defends" only by the moved piece (a4, Rc1); "They missed it." only 5 points worse (184181546074:61, 184430145348:99); the king only where the line attacks it (184379966256:39); a threat only with a gain (184434540700:103: never e5); castling by its side where both are legal; comparative words with the 5-point margin; the ring sentence where the danger is', async () => {
    const A = keyed(), P = plain();
    /* "Most of your advantage is gone." (tiers 2 and 3): the key's figures, Nc5 84% to Nb4's 91%, a sixth of the edge */
    const nc5 = await tryOn(A, '184173626058:106', 2, 'd3c5', ['b6d5'], 359);
    ok(!/advantage is gone/.test(nc5.r1 + ' ' + nc5.r2), '184173626058:106 Nc5 in play: ' + JSON.stringify(nc5));
    const nc5w = A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184173626058:106', 2), u = 'd3c5', c = { gameLine: buildLine(a.st, u, [], !myPov(a.it)) };
      return missWhy(a, c, 78.9, null, false, null, { pv: [u], deep: true, wBest: 87.2 }).cands[0]; })()`);
    eq(nc5w, 'You are still better, but less so.', '184173626058:106 Nc5, 78.9% to Nb4\'s 87.2% (a fifth of the edge): most of it kept');
    const rg7 = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184434540700:103', 2), u = 'g3g7', c = { gameLine: buildLine(a.st, u, [], !myPov(a.it)) };
      var keep = missWhy(a, c, 84, null, false, null, { pv: [u], deep: true, wBest: 99.5 }).cands[0], half = missWhy(a, c, 70, null, false, null, { pv: [u], deep: true, wBest: 99.5 }).cands[0];
      var shallow = missWhy(a, c, 72, null, false, null, { pv: [u], deep: false, wBest: 99.5 }).cands[0];
      playerTier = function () { return 1; }; a = openAt('184434540700:103', 1);
      var t1 = missWhy(a, c, 70, null, false, null, { pv: [u], deep: true, wBest: 99.5 }).cands[0];
      return JSON.stringify([keep, half, shallow, t1]); })()`));
    eq(JSON.stringify(rg7), JSON.stringify(['You are still better, but less so.', 'Most of your advantage is gone.', 'You are still better, but less so.', 'You are still better, but less so.']),
      '184434540700:103 Rg7 84% of 99.5% (31% of the edge) keeps most; 70% loses over half; 72% within the margin with no deep look; tier 1 never says it');
    /* "back in the game": the Kb2 card's opponent missed it, and they were still ahead */
    for (const t of [1, 2]) {
      const d = settledOf(A, KB2, t).details.filter((x) => /missed it/.test(x));
      ok(d.length === 1 && !/back in the game/.test(d[0]) && /but (after Qf8 )?they were still (ahead|winning)\.$/.test(d[0]), 'the Kb2 card at tier ' + t + ': ' + d.join(' | '));
    }
    /* "keeps": 184228984228:42, never the pawn the answer's line loses */
    for (const t of [1, 2, 3]) {
      const s = settledOf(A, '184228984228:42', t), all = [s.r2, s.check].concat(s.details).join(' | ');
      ok(!/keeps your pawn/.test(all), '184228984228:42 at tier ' + t + ': ' + all);
    }
    /* "defends": the moved piece itself, else "stays defended" (the stored answers, a4 and Rc1) */
    eq(settledOf(P, '184380449450:16', 2).details.filter((x) => /defend/.test(x)).join(' | '), 'After a4, the pawn on c3 stays defended.', '184380449450:16: a4 does not defend c3');
    ok(settledOf(P, '184329623608:48', 2).details.indexOf('After Rc1, the pawn on b4 stays defended.') >= 0, '184329623608:48: Rc1 does not defend b4');
    /* "They missed it.": what they played was as good */
    for (const k of ['184181546074:61', '184430145348:99']) for (const X of [A, P]) {
      const caps = settledOf(X, k, 2).caps;
      ok(!caps.some((x) => /missed it/.test(x)), k + ': no missed blow, ' + caps.join(' | '));
    }
    /* the king: d6 attacks the queen and the c7 pawn */
    for (const t of [1, 2]) {
      const d = settledOf(A, '184379966256:39', t).details.join(' | ');
      ok(!/opens up your king/.test(d) && /White attacks your queen and the c7 pawn\./.test(d), '184379966256:39 at tier ' + t + ': ' + d);
    }
    /* their threat: Nxg3 (the rook), never the quiet e5; release 2 (B5): nor Nxd6, a pawn no search confirms
       as a threat, so the one threat left is Nxg3, which Rd3 met, and Details names none */
    for (const t of [2, 3]) {
      const d = settledOf(A, '184434540700:103', t).details.join(' | ');
      ok(!/\be5\b/.test(d) && !/Nxd6/.test(d), '184434540700:103 at tier ' + t + ': ' + d);
    }
    /* castling: its side where both are legal (row 1 has room for neither, so the arrow shows it) */
    const cw = JSON.parse(P.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184205297974:26', 1), b = openAt('184172942198:33', 1), one = stateFromFen('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
      var a1 = openAt('184205297974:26', 1); reveal();
      return JSON.stringify([moveWords(a.pre, a.best), moveWords(b.pre, b.best), moveWords(one, uciToMove(one, 'e1g1')), displayFor(a1).row1]); })()`));
    eq(JSON.stringify(cw), JSON.stringify(['castling on the queen\'s side', 'castling on the king\'s side', 'castling', 'Here is the answer']), 'castling words');
    /* comparative words: 5 points of margin from a band's edge with no deep look */
    eq(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2); return JSON.stringify([bandWord(a, 62, false), bandWord(a, 62, true), bandWord(a, 43, false), bandWord(a, 36, true)]); })()`),
      JSON.stringify(['', 'you are still better', '', 'Black is better']), 'band words keep their margin');
    /* the ring sentence on the board described: c3 is in danger only after the game move */
    for (const X of [A, P]) {
      const lab = X.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184380449450:16', 1); a.hints = 1; a.hintAfter = true; return boardOptsFor(a).opts.label; })()`);
      ok(/Red ring: after your game move, your pawn on c3 can be taken\./.test(lab) && !/your pawn on c3 is in danger/.test(lab), '184380449450:16 hint 1: ' + lab);
    }
  });

  test('V2.1 a loss is claimed only where it stands: "After X, you\'d lose Y" needs the try 10 or more points below the answer (184455333378:48\'s Rad1, whose 250,000-node line dropped the bishop nine plies down, says no loss); the comparative band words need the margin; card 2\'s Explore never says f5 "gives up 3 pawns"', async () => {
    const A = keyed();
    /* Rad1 at the answer's own score: whatever its line drops, no loss */
    const rad1 = await tryOn(A, '184455333378:48', 2, 'a1d1', ['b7b5', 'b3a2'], 512);
    ok(!/lose/.test(rad1.r2), 'Rad1 within 10 points of Kg2: ' + rad1.r2);
    /* card 2's f5 in Explore: its line counted where it settles */
    const xp = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD2}', 2), k = a.it.b.k, line = unpackUci(k.l[0][3]);
      /* the line as the key has it, and cut short on a capture still to be answered */
      return JSON.stringify([xpClaim(a.pre, line, null), xpClaim(a.pre, line.slice(0, 2), null), line.slice(0, 6).join(' ')]); })()`));
    ok(!(xp[0] && xp[0].n <= -3) && !(xp[1] && xp[1].n <= -3), 'card 2\'s f5 in Explore gives up no 3 pawns: ' + JSON.stringify(xp));
  });

  /* ── V2.2 ── */
  test('V2.2 a wrong try says its first decisive event, to the end: the pawn race\'s Kxg6 at 700 "Their pawn will become a queen." with the pawn\'s path drawn; card 4\'s Qe2 at 1600 "After the trade, Qxc3+ forks." (tier 1 "After the trade, their queen forks.", release 2 B6), See it reaching Qxc3+ in three taps, c3 never "lost"; the back rank\'s Rd1+ "After the trade, Qxg7 is mate."; card 1\'s Qg4 at 1600 "Safe, but Black is better now." (2000: "Safe, but only 26% for you.")', async () => {
    const A = keyed();
    /* the pawn race: the game move again, its line queens on f1 */
    const race = await tryOn(A, RACE, 1, 'f6g6', null, null);
    eq(race.r2, 'Their pawn will become a queen.', 'the pawn race at 700');
    const path0 = JSON.parse(A.ev(`(function () { var a = ui.session.active; seeIt(); a.animMove = null; return JSON.stringify((boardOptsFor(a).opts.arrows || []).filter(function (x) { return x.kind === 'event'; }).map(function (x) { return sqName(x.from) + sqName(x.to) + ' ' + x.say; })); })()`));
    eq(JSON.stringify(path0), JSON.stringify(['f4f1 queen']), 'See it draws the pawn\'s path to f1, "queen"');
    /* card 4: Qe2 Bxc3+ bxc3 Qxc3+ Kf1 Qxa1, settled */
    const L4 = ['d4c3', 'b2c3', 'f6c3', 'e1f1', 'c3a1', 'e2d2', 'd7d6', 'h2h4', 'c8e6'];
    const c4 = [];
    for (const t of [1, 2, 3]) c4.push((await tryOn(A, CARD4, t, 'd1e2', L4, -494)).r2);
    /* (release 2, B6: after a take-back at equal value, "After the trade") */
    eq(JSON.stringify(c4), JSON.stringify(['After the trade, their queen forks.', 'After the trade, Qxc3+ forks.', 'After the trade, Qxc3+ forks.']), 'card 4, Qe2, at each tier');
    const taps = JSON.parse(A.ev(`(function () { var a = ui.session.active, out = [];
      for (var i = 0; i < 3; i++) { seeIt(); a.animMove = null; var f = boardOptsFor(a); out.push({ last: sqName(f.last[0]) + sqName(f.last[1]), lost: (f.opts.tokens || []).filter(function (x) { return x.kind === 'lost'; }).length, marks: (f.opts.arrows || []).filter(function (x) { return x.kind === 'event' || x.kind === 'back'; }).map(function (x) { return x.kind + ' ' + sqName(x.from) + sqName(x.to) + (x.say ? ' ' + x.say : ''); }) }); }
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(taps.map((x) => x.last)), JSON.stringify(['d4c3', 'b2c3', 'f6c3']), 'See it, then Next move twice: Qxc3+ on the third tap');
    eq(JSON.stringify(taps[0].marks), JSON.stringify(['back b2c3', 'event f6c3 fork']), 'on See it\'s frame the rest of the line drawn still: you take back, then the fork');
    ok(taps.every((x) => !x.lost), 'c3 never wears "lost": it is taken back');
    /* the back rank */
    const back = [];
    for (const t of [1, 2, 3]) back.push((await tryOn(A, BACK, t, 'd8d1', ['g1d1', 'g4d1', 'b7g7'], null, -2)).r2);
    eq(JSON.stringify(back), JSON.stringify(['After the trade, they can checkmate.', 'After the trade, Qxg7 is mate.', 'After the trade, Qxg7 is mate.']), 'the back rank, Rd1+');
    /* card 1, Qg4: safe, and Qe6's line loses the bishop too, so no capture is named */
    eq((await tryOn(A, CARD1, 2, 'f5g4', ['b7b5'], -282)).r2, 'Safe, but Black is better now.', 'card 1, Qg4, at 1600');
    eq((await tryOn(A, CARD1, 3, 'f5g4', ['b7b5'], -282)).r2, 'Safe, but only 26% for you.', 'card 1, Qg4, at 2000: the key\'s figure');
    /* F1.2's first capture only while the piece stays lost: 184174601056:59's Ra8 Rxd7 Bc5+ Kh1 Rxb3 wins it back (the audit) */
    const ra8 = [];
    for (const t of [1, 3]) ra8.push((await tryOn(A, '184174601056:59', t, 'f8a8', ['d3d7', 'b4c5', 'g1h1', 'b7b3', 'd7d8', 'a8d8', 'd1d8'], -240)).r2);
    eq(JSON.stringify(ra8), JSON.stringify(['After rook takes on d7, White is better.', 'After Rxd7, White is better.']), 'Ra8: no "takes your bishop" where the line wins it back');
    eq((await tryOn(A, CARD4, 2, 'c1e3', ['d4c3', 'e3d2', 'c3d2', 'd1d2', 'd7d5', 'e1c1', 'e8g8', 'c4d5', 'e7d5', 'd2d5', 'a7a5'], -410)).r2, 'Bxc3+ takes your knight.', 'card 4, Be3: the line still nets a piece at its end (a bishop for a pawn), so the capture is named (in SAN at 1600, release 2 B6)');
  });

  test('V2.2 no fixture try whose line mates, promotes or settles a loss ends row 2 in "better" or "winning": every second and third line of every key, at each tier, read by the settle rule (a promotion whose piece stands; a loss beyond the answer\'s, in line with the score)', async () => {
    const A = keyed();
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var k = it.b.k; return k && !k.x && it.b.kp === FACTS_V; }).map(function (it) { return it.key; }))`));
    ok(keys.length >= 70, 'keyed cards ' + keys.length);
    const out = [], n = { tries: 0, mate: 0, promo: 0, loss: 0, named: 0 };
    for (const tier of [1, 2, 3]) for (const key of keys) {
      const us = JSON.parse(A.ev(`JSON.stringify(model().byKey['${key}'].b.k.l.slice(1).map(function (x) { return x[0]; }))`));
      for (const u of us) {
        const go = A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${key}', ${tier}); if (!a || a.sol) return 0; var m = uciToMove(a.st, '${u}'); if (!m) return 0; a.t0 = Date.now() - 30000;
          window.__tryPv = null; window.__tryCp = null; window.__bestCp = null; window.readyEngine(); a.tapped = true; gradeMove(m); return 1; })()`);
        if (!go) continue;
        await settle();
        const b = JSON.parse(A.ev(`(function (a) {
          if (a.phase !== 'tried' || a.tried.kind !== 'miss') return 'null';
          a.reason = 2;
          var d = displayFor(a), k = a.it.b.k, l = k.l.filter(function (x) { return x[0] === '${u}'; })[0], pov = myPov(a.it), sign = pov ? 1 : -1;
          /* (the key's scores are the player's; settleLine reads White's) */
          var pv = unpackUci(l[3] || ''), ns = lineNodes(a.st, pv), s = settleLine(a.st, pv, null, sign * l[1]), ans = answerSettle(a);
          /* release 2, B7: at tier 1 a mate is named only within 3 of their moves */
          var mi = -1; ns.some(function (x, i) { if (x.mate && x.byW !== pov) { mi = i; return true; } return false; });
          var mate = (mi >= 0 && (${tier} > 1 || mi <= 5)) || (l[2] != null && l[2] < 0 && (${tier} > 1 || -l[2] <= 3));
          /* a promotion within the plies See it plays (SEE_PLIES with the try) */
          var promo = ns.some(function (x, i) { if (i >= SEE_PLIES || !x.m.promo || x.byW === pov) return false; var sq = x.m.to; for (var j = i + 1; j < ns.length; j++) { if (ns[j].byW !== pov && ns[j].m.from === sq) sq = ns[j].m.to; else if (ns[j].byW === pov && ns[j].m.to === sq) return false; } return true; });
          /* the pieces its line loses where it settles, net, that the answer's line keeps, worth 2 (a pawn 1), with the drop from the answer at least 0.6 of it;
             release 2, B4: settled only where its count agrees with the line's score */
          var lost = netLostOf(ns, s.k, pov), extra = ans.lost.slice();
          lost = lost.filter(function (p) { var j = extra.indexOf(p); if (j >= 0) { extra.splice(j, 1); return false; } return true; });
          var worth = lost.reduce(function (x, p) { return x + MOTIF_VAL[p]; }, 0), drop = (k.l[0][1] - l[1]) / 100;
          var loss = s.ok && s.agree && lost.length && worth >= (lost.length === 1 && lost[0] === 'P' ? 1 : 2) && drop >= 0.6 * worth;
          return JSON.stringify({ r2: d.row2, mate: mate, promo: promo, loss: !!loss }); })(ui.session.active)`));
        if (!b) continue;
        n.tries++;
        ['mate', 'promo', 'loss'].forEach((f) => { if (b[f]) n[f]++; });
        if (b.mate || b.promo || b.loss) {
          n.named++;
          if (/(better|winning)\.$/.test(b.r2)) out.push('tier ' + tier + ' ' + key + ' ' + u + ': ' + b.r2 + ' ' + JSON.stringify(b));
        }
      }
    }
    /* (the key's scores are the player's: a mate of theirs in a key's second or third line is rare, and
       a promotion See it reaches rarer, B7 and SEE_PLIES) */
    ok(n.tries > 100 && n.named >= 15 && n.promo >= 1 && n.loss >= 10, JSON.stringify(n));
    eq(out.length, 0, out.length + ' tries end in a band word over their event: ' + out.slice(0, 3).join(' | '));
  });

  /* ── V2.3 ── */
  test('V2.3 hints that never invite a rejected move: card 1\'s Hint 2 "Only one queen move is best." at 700, "Only one queen move holds." at 1600 and 2000 (Qd7+, Qh3 and Qg4 are safe and lose); the queen trap\'s Hint 1 rings f4, "You can win their queen."; card 4\'s Hint 1 what castling runs into (release 2, B5: no threat beside their mate), never praise for O-O; card 1\'s Qxe5 at 700: See it leaves "Hint" (the automatic hint counts as it shows), Try again adds it and says so; never "No more hints" while one is unseen', async () => {
    const A = keyed();
    const hint = (key, tier, n) => JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${key}', ${tier}); a.hints = ${n}; a.hintAfter = true; var d = displayFor(a), hm = hintMarks(a);
      return JSON.stringify({ r2: d.row2, rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }), arrows: hm.arrows.map(function (x) { return sqName(x.from) + sqName(x.to); }), kind: hm.dz ? hm.dz.kind : null }); })()`));
    eq(JSON.stringify([1, 2, 3].map((t) => hint(CARD1, t, 2).r2)), JSON.stringify(['Only one queen move is best.', 'Only one queen move holds.', 'Only one queen move holds.']), 'card 1, Hint 2');
    /* "Find a safe square." only where every safe square is accepted (the orchestrator's rule): a doctored key with one safe square, the answer's */
    const one = A.ev(`(function () { ${OPEN} ${TRY} var it = model().byKey['${CARD1}'], k = it.b.k, keep = [k.pm, k.ps, k.pn];
      k.pm = [['f5e6', 1, 0], ['f5d7', 0, -900]]; k.ps = 1; k.pn = 2;
      try { var a = openAt('${CARD1}', 2); a.hints = 2; a.hintAfter = true; return displayFor(a).row2; } finally { k.pm = keep[0]; k.ps = keep[1]; k.pn = keep[2]; } })()`);
    eq(one, 'Find a safe square.', 'one safe square, the answer\'s: "Find a safe square."');
    for (const t of [1, 2, 3]) {
      const q = hint(QTRAP, t, 1);
      eq(JSON.stringify([q.r2, q.rings, q.kind]), JSON.stringify(['You can win their queen.', ['f4 target'], 'win']), 'the queen trap\'s Hint 1 at tier ' + t);
    }
    const c4 = [1, 2, 3].map((t) => hint(CARD4, t, 1));
    /* (release 2, B5: beside their mate no other move is a threat, so V2.3's two threats are gone: O-O
       stopped the mate, and Hint 1 is what castling runs into, the bishop that takes on c3 drawn as the
       danger the game move ran into) */
    eq(JSON.stringify(c4.map((x) => x.r2)), JSON.stringify(['See what castling runs into.', 'See what O-O runs into.', 'See what O-O runs into.']), 'card 4\'s Hint 1');
    ok(c4.every((x) => x.kind === null && JSON.stringify(x.rings) === JSON.stringify(['d4 threat']) && JSON.stringify(x.arrows) === JSON.stringify(['d4c3'])), 'the bishop and its arrow: ' + JSON.stringify(c4));
    ok(!c4.some((x) => /stops|met |Two threats/.test(x.r2)), 'never praise for the game move, never a second threat beside the mate');
    /* the automatic hint, counted as it shows */
    const qx = await tryOn(A, CARD1, 1, 'f5e5', ['f4e5'], -900);
    eq(qx.bar, 'See it | Try again', 'card 1, Qxe5, at 700');
    const flow = JSON.parse(A.ev(`(function () { var a = ui.session.active, o = { hints: a.hints, due: a.autoDue }; seeIt(); a.animMove = null; o.seen = displayFor(a).buttons.map(function (b) { return b.label; }).join(' | ');
      var said = [], n0 = notice; notice = function (t) { said.push(t); }; tryAgain(); notice = n0; a.triedHold = false;
      o.after = [a.hints, displayFor(a).row1, displayFor(a).buttons.map(function (b) { return b.label; }).join(' | ')]; o.said = said; return JSON.stringify(o); })()`));
    eq(JSON.stringify([flow.hints, flow.due, flow.seen]), JSON.stringify([0, 1, 'Hint | Try again']), 'the hint is due, not counted: See it leaves "Hint"');
    eq(JSON.stringify([flow.after, flow.said]), JSON.stringify([[1, 'Hint 1 of 3', 'Hint 2 | Show the answer'], ['Hint 1 added.']]), 'Try again shows it, counts it and says so');
    /* never "No more hints" over a try while a hint is due: tier 2, Hint 1 seen, then two misses (Hint 2 due at the second) */
    A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2); a.t0 = Date.now() - 30000; a.hints = 1; a.hintAfter = true; window.__bestCp = null; tryMove(a, 'f5e5', ['f4e5'], -900, null); return 1; })()`);
    await settle();
    A.ev(`(function () { ${TRY} var a = ui.session.active; tryAgain(); a.triedHold = false; a.shownAt = 0; tryMove(a, 'f5f4', ['e5f4'], -900, null); return 1; })()`);
    await settle();
    const bar2 = JSON.parse(A.ev(`(function () { var a = ui.session.active; a.reason = 2; var o = [a.misses, a.hints, a.autoDue, displayFor(a).buttons.map(function (b) { return b.label; }).join(' | ')]; seeIt(); a.animMove = null; o.push(displayFor(a).buttons.map(function (b) { return b.label; }).join(' | ')); return JSON.stringify(o); })()`));
    ok(bar2[0] === 2 && bar2[1] === 1 && bar2[2] === 1 && !/No more hints/.test(bar2[3] + bar2[4]), 'tier 2, miss 2 with Hint 2 due: ' + JSON.stringify(bar2));
  });

  /* ── V2.4 ── */
  test('V2.4 one reason for the found move: card 2 at 700 after a miss "Pawn to f5 guards your knight.", See why ending "Better: pawn to f5. It guards your knight."; the queen trap "Be3 traps their queen."; the Kb2 card one reason in the row, See why and Details (at 700 its band, release 2 B7); the pawn race\'s Kxf5 stops the pawn, never "wins the pawn"; card 1\'s Better branch at 2000 four or more steps, ending on its figure with "Your chances"', async () => {
    const A = keyed();
    const c2 = settledOf(A, CARD2, 1);
    eq(c2.r2, 'Pawn to f5 guards your knight.', 'card 2 at 700');
    eq(c2.caps[c2.caps.length - 1], 'Better: pawn to f5. It guards your knight.', 'card 2\'s See why ends on the reason');
    eq(settledOf(A, CARD2, 2).caps.slice(-1)[0], 'Better: f5. It guards your knight.', 'at 1600');
    for (const t of [2, 3]) eq(settledOf(A, QTRAP, t).r2, 'Be3 traps their queen.', 'the queen trap at tier ' + t);
    /* (release 2, B7: at tier 1 a mate in 7 is no "checkmate": its band, and See why's last step says it as a better move does) */
    for (const t of [1, 2]) {
      const k = settledOf(A, KB2, t), say = t === 1 ? 'King to b2 keeps you winning.' : 'Kb2 forces mate.', cap = t === 1 ? 'Better: king to b2. It keeps you winning.' : say;
      eq(JSON.stringify([k.r2, k.caps.slice(-1)[0], k.details.indexOf(say) >= 0]), JSON.stringify([say, cap, true]), 'the Kb2 card at tier ' + t + ': one reason, three places');
    }
    for (const t of [1, 2, 3]) {
      const r = settledOf(A, RACE, t), all = [r.r2, r.check].concat(r.caps, r.details).join(' | ');
      ok(!/wins the pawn/.test(all) && /stops their pawn/.test(all), 'the pawn race at tier ' + t + ': ' + all);
    }
    /* the reason is the answer's: a move of the player's own that worked mid-line (Kg5 after Kxf5) is not said to stop the pawn */
    eq(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${RACE}', 3), l = unpackUci(factsOf(a.it.b).l[0][3]);
      solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
      a.compare = null; a.own = true; a.yours = { uci: l.slice(0, 2).concat(['f5g5']), cp: 0, at: 2 };
      return buildCompare(a).betterSan + ' | ' + checkLine(a); })()`), 'Kg5 | Kxf5 stops their pawn. Kxg6 missed it.', 'the check line names the answer');
    const c1 = settledOf(A, CARD1, 3), better = c1.segs.filter((x) => x === 'better').length;
    ok(better >= 4 && /\d+%/.test(c1.caps[c1.caps.length - 1]) && c1.lastChip === 'Your chances', 'card 1\'s Better branch at 2000: ' + better + ' steps, ' + c1.caps.slice(-1)[0] + ' (' + c1.lastChip + ')');
  });

  /* ── V2.5 ── */
  test('V2.5 Details, Explore and figures: card 4\'s Details names no threat O-O left (release 2, B5: the mate alone, and O-O stopped it); card 1\'s "Their threats: gxf5, cxd3+. Rg1 met neither."; tier 1 Details in words with no notation and no figure; every figure labelled ("Your chances: 36% before, 16% after.", the chip beside a tier 3 frame\'s); SAN keeps its signs', async () => {
    const A = keyed();
    /* (release 2, B5: beside their mate no other move is a threat, so card 4 has the one, the mate O-O
       stopped, and Details names no threat the game move left standing) */
    eq(settledOf(A, CARD4, 2).details.filter((x) => /^Their threats?:/.test(x)).join(' | '), '', 'card 4 at 1600');
    eq(settledOf(A, CARD4, 1).details.filter((x) => /^Their threats?:/.test(x)).join(' | '), '', 'card 4 at 700');
    eq(settledOf(A, CARD1, 2).details.filter((x) => /^Their threats?:/.test(x)).join(' | '), 'Their threats: gxf5, cxd3+. Rg1 met neither.', 'card 1 at 1600');
    const SAN = /(?:\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\b[a-h][18]=[QRBN]|\bO-O(?:-O)?)[+#]?/;
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).slice(0, 40).map(function (it) { return it.key; }))`));
    const bad = [];
    keys.forEach((k) => {
      const t1 = settledOf(A, k, 1).details.slice(1);
      t1.forEach((x) => { if (SAN.test(x) || /\d\s?%/.test(x)) bad.push(k + ' tier 1: ' + x); });
      settledOf(A, k, 2).details.forEach((x) => { if (/\d\s?%/.test(x) && !/chances/.test(x)) bad.push(k + ' tier 2: ' + x); });
    });
    eq(bad.length, 0, bad.length + ' lines with notation at tier 1 or a bare figure: ' + bad.slice(0, 3).join(' | '));
    /* a square stays a square where some line also plays a pawn there (the audit's "the pawn on pawn to c3") */
    eq(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184380449450:16', 1); return [wordsMap(a).c3 ? 'c3 played' : 'no c3', detailsWords(a, 'After Nd2, the pawn on c3 stays defended.'), detailsWords(a, 'After d6, White attacks your queen and the c3 pawn.')].join(' | '); })()`),
      'c3 played | After knight to d2, the pawn on c3 stays defended. | After pawn to d6, White attacks your queen and the c3 pawn.', 'squares kept in words');
    const lab =settledOf(A, '184379966256:39', 2).details.join(' | ');
    ok(/Your chances: \d+% before, \d+% after\./.test(lab), 'figures labelled: ' + lab);
    const t3 = settledOf(A, CARD1, 3);
    eq(JSON.stringify([t3.r2, t3.chip]), JSON.stringify(['Only move: Qe6 50%. Next best 34%.', 'Your chances']), 'a tier 3 frame\'s figures wear "Your chances"');
  });

  /* ── V2.6 ── */
  test('V2.6 foils say what holds, from their look: foil:184329623608:98 (only Kg2 holds) passes with "The only move, as in your game.", its Hint 2 "Only one move holds here."; foil:184455333378:60\'s Hint 2 names Rg5 from the null-move search (a quiet threat its own search confirms); a foil with neither "Any good move passes here."; never "No danger here."', async () => {
    const A = keyed();
    const pending = (key) => JSON.parse(A.ev(`JSON.stringify(window.__evals.filter(function (j) { return j.opts.tag === '${key}' && !j.done; }).map(function (j) { return { fen: j.fen, mpv: j.opts.multipv || 1 }; }))`));
    const answer = (key, lines) => A.ev(`(function () { var j = window.__evals.filter(function (x) { return x.opts.tag === '${key}' && !x.done; })[0]; j.done = 1;
      var ls = ${JSON.stringify(lines)}; j.res({ cp: ls[0].cp, mate: null, bestUci: ls[0].pv[0], pv: ls[0].pv, lines: ls.map(function (l) { return { cp: l.cp, mate: null, pv: l.pv }; }), depth: 18, stopped: false }); return 1; })()`);
    const open = (key) => A.ev(`(function () { window.readyEngine(); playerTier = function () { return 2; }; ui.session = { mode: 'today', label: 'Today', keys: ['${key}', '${CARD1}'], idx: 0, results: {}, relearn: [], relearnOf: {} }; loadCard(); return 1; })()`);
    const hints = () => JSON.parse(A.ev(`(function () { var a = ui.session.active; a.hints = 1; var h1 = displayFor(a).row2; a.hints = 2; var h2 = displayFor(a).row2; a.hints = 0; return JSON.stringify([h1, h2]); })()`));
    /* the K+P ending: Kg2 holds, every other king move loses */
    const K98 = 'foil:184329623608:98';
    open(K98);
    answer(K98, [{ cp: -16, pv: ['f2g2', 'h6h5'] }, { cp: -1278, pv: ['f2e3', 'g4g3'] }, { cp: -1515, pv: ['f2e2', 'g4g3'] }]);
    await settle();
    eq(A.ev('ui.session.active && ui.session.active.key + " " + ui.session.active.it.b.om'), K98 + ' 1', 'the look: the only move');
    answer(K98, [{ cp: 300, pv: ['g4h3', 'f2f3'] }]);
    await settle();
    eq(hints()[1], 'Only one move holds here.', 'its Hint 2');
    const pass = JSON.parse(A.ev(`(function () { var a = ui.session.active; a.tapped = true; gradeMove(uciToMove(a.st, 'f2g2')); a.settle = 2; var d = displayFor(a); return JSON.stringify([a.result, d.row1, d.row2]); })()`));
    eq(JSON.stringify(pass), JSON.stringify(['first', 'Found it', 'The only move, as in your game.']), 'Kg2 passes as the only move');
    /* Rg5 wins the queen, were it Black's move: the null-move search, then Rg5's own line confirms it */
    const R60 = 'foil:184455333378:60';
    open(R60);
    answer(R60, [{ cp: -10, pv: ['f1e2', 'f4h2'] }, { cp: -60, pv: ['a1d1', 'g6g5'] }, { cp: -70, pv: ['b2b3', 'g6g5'] }]);
    await settle();
    eq(JSON.stringify(pending(R60).map((j) => j.mpv)), '[2]', 'then their threat, the null-move position in two lines');
    answer(R60, [{ cp: -396, pv: ['g6f6', 'f5g4', 'f6g6', 'g4f5', 'g6g5', 'f5g5', 'f4g5'] }, { cp: -404, pv: ['g6g5', 'f5g5', 'f4g5', 'f1e2', 'f8g8', 'e1h1', 'g7f8'] }]);
    await settle();
    answer(R60, [{ cp: -407, pv: ['f5g5', 'f4g5', 'a1d1', 'f8g8', 'f1e2', 'g7f8', 'e1h1', 'e7c5'] }]);
    await settle();
    eq(A.ev('JSON.stringify(ui.session.active.it.b.th)'), JSON.stringify(['g6g5', 0, 4, 'Q']), 'the threat kept: Rg5, the queen for a rook');
    const h60 = hints();
    /* ("Their threat: Rg5 wins your queen." has six words; beside "No more hints" row 2 has five: build note 5) */
    ok(/Rg5/.test(h60[1]) && /queen/.test(h60[1]), 'Hint 2 names Rg5: ' + h60[1]);
    /* a foil with no only move and no threat */
    const calm = A.ev(`(function () { ${OPEN} ${FOIL} var f = foilPool().filter(function (x) { var a = foilOpen(x.key); return a && foilDanger(a).kind === 'none'; })[0], a = foilOpen(f.key); a.hints = 2; return displayFor(a).row2; })()`);
    eq(calm, 'Any good move passes here.', 'a foil with nothing to name');
    const none = A.ev(`(function () { ${OPEN} ${FOIL} var n = 0; foilPool().forEach(function (x) { var a = foilOpen(x.key); if (!a) return; a.hints = 2; if (/No danger here/.test(displayFor(a).row2)) n++; }); return n; })()`);
    eq(none, 0, 'no foil reads "No danger here."');
  });

  /* ── V2.7 ── */
  test('V2.7 small card fixes: a move into check says "Your king would be in check there."; See why\'s danger frame names two pieces of one kind by square; Details\' mate in one reads "After Bf3, Qxg7 is mate."; a second "Good move" keeps its row 2; Play it takes "Play the green arrow." with the arrow', async () => {
    const A = keyed(), P = plain();
    /* a move a piece could make but for the check it leaves its king in */
    const chk = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var hit = null;
      allMistakes().filter(trainable).some(function (it) { var a = openCard(it); if (!a) return false;
        for (var sq = 0; sq < 64 && !hit; sq++) { var p = a.st.b[sq]; if (!p || isW(p) !== a.st.w) continue;
          var legal = legalMoves(a.st).filter(function (m) { return m.from === sq; }).map(function (m) { return m.to; });
          var t = legalMovesPseudo(a.st, sq).filter(function (q) { return legal.indexOf(q) < 0; })[0];
          if (t != null) hit = { key: it.key, from: sq, to: t }; }
        return !!hit; });
      var a = openCard(model().byKey[hit.key]); a.sel = hit.from; sessionClick(hit.to);
      return JSON.stringify({ key: hit.key, r2: displayFor(a).row2, phase: a.phase }); })()`));
    eq(JSON.stringify([chk.r2, chk.phase]), JSON.stringify(['Your king would be in check there.', 'guess']), 'a move into check on ' + chk.key);
    /* the Kb2 card's danger frame (stored danger facts): its two pawns by their squares */
    const df = settledOf(P, KB2, 2).caps[0];
    ok(/^(Your pawns on a3 and b4 are attacked\.|After \S+: your pawns on a3 and b4 are attacked\.)$/.test(df), 'two pawns by square: ' + df);
    for (const t of [1, 2]) {
      const m = settledOf(A, BACK, t).details.filter((x) => /mate/.test(x));
      eq(m[0], t === 1 ? 'After bishop to f3, queen takes on g7 is mate.' : 'After Bf3, Qxg7 is mate.', 'the back rank\'s Details at tier ' + t + ', never "mate in 1, starting with"');
    }
    /* a second good move on one showing keeps its row 2 */
    const two = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2), m = uciToMove(a.st, 'f5d7');
      showTry(a, m, 'close', null, null, false); var one = displayFor(a).row1 + ' / ' + displayFor(a).row2;
      a = openAt('${CARD1}', 2); showTry(a, m, 'close', null, null, true); return JSON.stringify([one, displayFor(a).row1 + ' / ' + displayFor(a).row2]); })()`));
    eq(two[1], two[0], 'the second "Good move" says what the first did');
    /* Play it: the arrow played, its words go with it */
    const play = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('${CARD1}', 2); reveal(); a.animMove = null; var before = displayFor(a).row2; playIt(false); a.animMove = null; return JSON.stringify([before, displayFor(a).row2]); })()`));
    eq(JSON.stringify(play), JSON.stringify(['Play the green arrow.', '']), 'Play it: "Play the green arrow." leaves with the arrow');
  });

  return T;
};
