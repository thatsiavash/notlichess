// Beginner teaching (slice 9, F9.1 to F9.5), run from session.test.js on the built page in Node
// (test/app-realm.js) with the fixture: require('./practice')(h) returns its tests as [name, fn] pairs,
// h holding session.test.js's boot, eq, ok and tick.
//   Truth on the card: every practice position (src/js/12p-pdata.js) legal by the app's move generator,
//   its accepted and close moves legal and apart, every accepted move holding its skill's claim
//   (pracClaim), a mate in one's accepted moves every mate there and nothing else, the real ones the
//   stored positions of test/data/mistakes.ndjson with their stored answer (the better move, or the
//   punishment) accepted; every miss's reason true on the board after it; every lesson's board legal,
//   its frames' moves legal and each caption true on its board. NL_SF=1 asks Stockfish 17.1 again (about
//   5 minutes): its best move accepted, every accepted move within the card's tolerance.
//   F9.1 the help level, F9.2 Hint 3's red squares, F9.3 lessons in Today's sets, F9.4 packs and
//   mastery, F9.5 the skill tiles, and the skill store's bookkeeping.
const fs = require('fs'), path = require('path');
const MIST = fs.readFileSync(path.join(__dirname, 'data', 'mistakes.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .map((m) => ({ fen: m.fen, played: m.played, best: m.best && m.best.pv ? m.best.pv[0] : null, ref: m.refutation && m.refutation.pv ? m.refutation.pv[0] : null, band: m.band }));

/* a player at a rating (chess.com rapid: 700 is tier 1, 1600 tier 2, 2000 tier 3), the engine off (no
   foils, no deeper look) */
const AT = (r) => `data.user = { perfs: { rapid: { rating: ${r} } } }; SF.state = 'failed';`;
/* the fixture's own cards answered to the end of a set (the best move, a line played out) */
const PLAY = `function playOwn(a) {
  if (a.sol) { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
  else gradeMove(uciToMove(a.st, a.bestUci));
  if (a.phase !== 'done') finishCard('first');
}
function finishSet() {
  for (var i = 0; i < 60 && ui.session && !ui.session.finished; i++) {
    var a = ui.session.active;
    if (!a) { loadCard(); a = ui.session.active; if (!a) break; }
    if (a.phase === 'lesson') { lessonStep(1); continue; }
    if (a.prac) gradeMove(uciToMove(a.st, a.bestUci)); else playOwn(a);
    nextCard();
  }
}
function words(h) { return String(h).replace(/<svg[\\s\\S]*?<\\/svg>/g, ' ').replace(/<label class="kb-move[\\s\\S]*?<\\/label>/g, ' ').replace(/<[^>]+>/g, '\\n').replace(/&#39;/g, "'").split('\\n').map(function (x) { return x.replace(/\\s+/g, ' ').trim(); }).filter(Boolean); }`;

module.exports = function practiceTests(h) {
  const { boot, eq, ok } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);

  test('F9.3, F9.4: every practice position is legal by the app\'s move generator, its accepted and close moves legal and apart, every accepted move holding its skill\'s claim, a mate in one\'s accepted moves every mate there and only those, the real ones the stored positions of mistakes.ndjson with their stored answer accepted; every skill five or more apart at step 1, its lesson\'s own position among them', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { var M = ${JSON.stringify(MIST)};
      var out = [], n = { L: 0, R: 0, ok: 0, cl: 0, mates: 0 }, base = {};
      var legalFen = function (fen) {
        var st = stateFromFen(fen);
        if (!st) return 'unreadable';
        var K = 0, k = 0, edge = false;
        st.b.forEach(function (p, q) { if (p === 'K') K++; if (p === 'k') k++; if ((p === 'P' || p === 'p') && (q < 8 || q >= 56)) edge = true; });
        if (K !== 1 || k !== 1) return 'kings';
        if (edge) return 'a pawn on its last rank';
        if (checkersOf(dzNullState(st)).length) return 'the side not to move is in check';
        if (!legalMoves(st).length) return 'no legal move';
        if (stateFen(st).split(' ').slice(0, 4).join(' ') !== fen.split(' ').slice(0, 4).join(' ')) return 'reads back as ' + stateFen(st);
        return '';
      };
      PRAC_DATA.forEach(function (row) {
        var f = row.split('|'), p = pracData().byId[f[0]], at = f[0];
        if (!p || !PSKILL_OF[p.skill] || (p.src !== 'L' && p.src !== 'R')) { out.push(at + ': unreadable row'); return; }
        var bad = legalFen(p.fen);
        if (bad) { out.push(at + ': ' + bad); return; }
        n[p.src]++;
        var st = stateFromFen(p.fen), legal = legalMoves(st).map(moveUci);
        if (!p.ok.length) out.push(at + ': nothing accepted');
        p.ok.concat(p.cl).forEach(function (u) { if (legal.indexOf(u) < 0) out.push(at + ': ' + u + ' is no legal move'); });
        p.cl.forEach(function (u) { if (p.ok.indexOf(u) >= 0) out.push(at + ': ' + u + ' both accepted and close'); });
        p.ok.forEach(function (u) { n.ok++; var m = uciToMove(st, u); if (m && !pracClaim(st, m, p.skill)) out.push(at + ': ' + u + ' does not hold its claim (' + p.skill + ')'); });
        n.cl += p.cl.length;
        if (p.skill === 'mate1' || p.skill === 'backrank') {
          var mates = legalMoves(st).filter(function (m) { var x = cloneState(st); applyMove(x, m); return isMate(x); }).map(moveUci).sort();
          n.mates += mates.length;
          if (mates.join() !== p.ok.slice().sort().join() || p.cl.length) out.push(at + ': accepts ' + p.ok.join() + ', the mates are ' + mates.join());
        }
        if (p.src === 'R') {
          var mm = /^m(\\d+)([ab])$/.exec(p.id), m0 = mm && M[+mm[1]];
          if (!m0) { out.push(at + ': no such mistake'); return; }
          var want = m0.fen, ans = m0.best;
          if (mm[2] === 'b') { var x = stateFromFen(m0.fen), pm = uciToMove(x, m0.played); if (pm) applyMove(x, pm); want = stateFen(x); ans = m0.ref; }
          if (want.split(' ').slice(0, 4).join(' ') !== p.fen.split(' ').slice(0, 4).join(' ')) out.push(at + ': not the stored position ' + want);
          if (p.ok.indexOf(ans) < 0) out.push(at + ': the stored answer ' + ans + ' is not accepted');
          if (p.band !== m0.band || [800, 1100, 1400].indexOf(p.band) < 0) out.push(at + ': band ' + p.band + ', stored ' + m0.band);
        } else if (p.id.indexOf(p.skill + '-') !== 0) out.push(at + ': a lesson position named for another skill');
        if (pracStep(p) === 1) (base[p.skill] = base[p.skill] || {})[pracBase(p.id)] = 1;
      });
      PSKILL.forEach(function (sk) {
        var tp = pracData().byId[sk.tryId];
        if (!tp || tp.src !== 'L' || tp.skill !== sk.k) out.push(sk.k + ': no lesson position ' + sk.tryId);
        if (Object.keys(base[sk.k] || {}).length < 5) out.push(sk.k + ': ' + Object.keys(base[sk.k] || {}).length + ' positions apart at step 1');
      });
      return JSON.stringify({ out: out, n: n, rows: PRAC_DATA.length, real: PSKILL.map(function (sk) { return (pracData().bySkill[sk.k] || []).filter(function (p) { return p.src === 'R'; }).length; }) }); })()`));
    ok(r.rows >= 150 && r.n.L >= 100 && r.n.R >= 50 && r.n.mates >= 20, 'positions ' + JSON.stringify(r));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  test('F9.4: a practice try that is neither accepted nor close says why, true on the board after it: their mate in one mates, the capture named is legal and takes the piece named for a gain; every legal move of every position', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)}
      var out = [], n = { tries: 0, mate: 0, took: 0, skill: 0, fall: 0 }, PW = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
      PRAC_DATA.forEach(function (row) {
        var it = pracItem('pk:' + row.split('|')[0]);
        ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
        var a = pracCardFor(it);
        ui.session.active = a;
        legalMoves(a.pre).forEach(function (m) {
          var u = moveUci(m);
          if (it.ok.indexOf(u) >= 0 || it.cl.indexOf(u) >= 0) return;
          n.tries++;
          var w = pracWhy(a, m), at = it.id + ' ' + u, after = cloneState(a.pre);
          applyMove(after, m);
          var r = w.reply ? uciToMove(after, w.reply) : null;
          if (w.mate) {
            n.mate++;
            var x = r && cloneState(after); if (x) applyMove(x, r);
            if (!x || !isMate(x)) out.push(at + ': "' + w.cands[0] + '" but ' + w.reply + ' is no mate');
          } else if (w.took) {
            n.took++;
            var t = r && after.b[r.to], mw = /takes your (\\w+)\\.$/.exec(w.cands[0] || '');
            if (!r || !t || pType(t) !== w.took || colorW(t) !== myPov(it) || !(dzSeeMove(after.b, r.from, r.to) > 0) || !mw || PW[mw[1]] !== w.took) out.push(at + ': "' + w.cands[0] + '" is not true after it');
          } else if (w.cands.length) n.skill++; else n.fall++;
          /* the ladder always lands on a rung that fits row 2, never in SAN at tier 1 */
          var said = fitRow(w.cands, 'row2', w.fall);
          if (!said || !fitsRow(said, 'row2') || /\\b[KQRBN]x?[a-h][1-8]|\\b[a-h]x[a-h][1-8]|=[QRBN]/.test(said)) out.push(at + ': its reason reads ' + said + ' (' + w.cands.concat([w.fall]).join(' | ') + ')');
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.tries > 3000 && r.n.mate > 50 && r.n.took > 1000 && r.n.skill > 20, 'tries ' + JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  test('F9.3: the ten lessons: each board legal, three frames of 8 words or fewer (60 characters) with the "Lesson" tag, a frame\'s move legal, the third frame its own practice position; every caption true on its board, every mark on a square that says it', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)}
      var out = [], S = function (x) { return sqIndex(x); };
      var nullMate = function (st) { var x = dzNullState(st); return legalMoves(x).filter(function (m) { var y = cloneState(x); applyMove(y, m); return isMate(y); }); };
      var played = function (st, u) { var x = cloneState(st), m = uciToMove(x, u); if (!m) return null; applyMove(x, m); return x; };
      /* each skill's captions, as facts on its own board (frame 1, frame 2; the third is the practice position) */
      var TRUE = {
        free: function (st) { var q = S('d5'); return [st.b[q] === 'b' && !isDefended(st.b, q), dzSeeMove(st.b, S('d1'), q) >= 3]; },
        safety: function (st) { var at = dangerAttacked(st, true).map(function (x) { return x[0]; }), ls = loseSquares(st, S('e4'));
          return [st.b[S('e4')] === 'N' && at.indexOf(S('e4')) >= 0 && legalMoves(dzNullState(st)).some(function (m) { return m.from === S('d5') && m.to === S('e4'); }), ls.red.length >= 3 && ls.lose]; },
        count: function (st) { var gain = function (t) { return dzSeeMove(st.b, S('d1'), S(t)); };
          var after = played(st, 'd1d5');
          return [!!uciToMove(st, 'd1a1') && !!uciToMove(st, 'd1d5') && gain('a1') >= 3, gain('d5') < 0 && !!after && legalMoves(after).some(function (m) { return m.from === S('c6') && m.to === S('d5'); })]; },
        mate1: function (st) { var at = function (f) { return attacksFrom(st.b, S(f)).indexOf(S('g7')) >= 0; }, x = played(st, 'h6g7');
          return [at('c3') && at('h6'), !!x && isMate(x)]; },
        stopmate: function (st) { var m = nullMate(st); return [m.length > 0 && m.every(function (x) { return x.to === S('h7'); }), m.some(function (x) { return x.from === S('h5'); })]; },
        fork: function (st) { var x = played(st, 'd4e6'); if (!x) return [false, false];
          var d = moveDoes(st, S('d4'), S('e6'));
          return [!!d.fork && d.check, legalMoves(x).every(function (r) { var y = cloneState(x); applyMove(y, r); return y.b[S('e6')] === 'N' && legalMoves(y).some(function (m) { return m.from === S('e6') && y.b[m.to] === 'q'; }); })]; },
        pin: function (st) { var x = played(st, 'f1b5'); if (!x) return [false, false];
          var d = moveDoes(st, S('f1'), S('b5'));
          return [!!d.pin && pracClaim(st, uciToMove(st, 'f1b5'), 'pin') === 'That pins their queen.',
                  legalMoves(x).every(function (r) { var y = cloneState(x); applyMove(y, r); return legalMoves(y).some(function (m) { return y.b[m.to] === 'q' && dzSeeMove(y.b, m.from, m.to) >= 3; }); })]; },
        hidden: function (st) { var x = played(st, 'd3h7'); if (!x) return [false, false];
          return [attacksFrom(st.b, S('d1')).indexOf(S('d8')) < 0 && st.b[S('d3')] === 'B', checkersOf(x).length > 0 && attacksFrom(x.b, S('d1')).indexOf(S('d8')) >= 0 && x.b[S('d8')] === 'q']; },
        backrank: function (st) { var k = S('b8'), x = played(st, 'e1e8'), ks = legalMoves(dzNullState(st)).filter(function (m) { return m.from === k; });
          return [ks.length > 0 && ks.every(function (m) { return (m.to >> 3) === 7; }), !!x && isMate(x)]; },
        pawns: function (st) { var c2 = S('c2'), x = played(st, 'h1c1');
          return [st.b[c2] === 'p' && legalMoves(dzNullState(st)).some(function (m) { return m.from === c2 && m.promo; }), !!x && x.b[S('c1')] === 'R' && !legalMoves(x).some(function (m) { return m.promo; })]; }
      };
      PSKILL.forEach(function (sk) {
        var L = sk.lesson, st = stateFromFen(L.fen), at = sk.k;
        if (!st || checkersOf(dzNullState(st)).length || !legalMoves(st).length) { out.push(at + ': the board is not legal'); return; }
        if (L.frames.length !== 3) out.push(at + ': ' + L.frames.length + ' frames');
        var facts = TRUE[sk.k](st);
        facts.forEach(function (x, i) { if (!x) out.push(at + ': frame ' + (i + 1) + ' "' + L.frames[i].cap + '" is not true on its board'); });
        ui.session = { mode: 'pack', label: sk.name, keys: ['ls:' + sk.k, 'pk:' + sk.tryId], idx: 0, results: {}, relearn: [], relearnOf: {}, spec: { type: 'pack', k: sk.k } };
        var a = lessonCardFor(lessonItem('ls:' + sk.k));
        ui.session.active = a;
        L.frames.forEach(function (fr, i) {
          if (!fitsRow(fr.cap, 'caption') || wordsIn(fr.cap) > 8) out.push(at + ': frame ' + (i + 1) + ' over 8 words: ' + fr.cap);
          if (fr.move && !uciToMove(stateFromFen(L.fen), fr.move) && i === 0) out.push(at + ': frame 1\\'s move is no legal move');
          a.lesson.i = i;
          var f = lessonFrame(a, i), d = displayFor(a), bo = boardOptsFor(a);
          if (d.cap !== fr.cap || d.tag !== 'Lesson' || d.row1 || d.buttons.map(function (b) { return b.label + (b.off ? ' (off)' : ''); }).join(' | ') !== (i ? '‹' : '‹ (off)') + ' | Next ›') out.push(at + ': frame ' + (i + 1) + ' reads ' + JSON.stringify([d.cap, d.tag, d.row1, d.buttons]));
          if (bandWords(bandFor(a), d.buttons) > 15) out.push(at + ': frame ' + (i + 1) + ' over 15 words');
          if (fr.move && !f.last) out.push(at + ': frame ' + (i + 1) + '\\'s move ' + fr.move + ' did not play');
          if (fr.board === 'try' && stateFen(f.st) !== stateFen(stateFromFen(pracData().byId[sk.tryId].fen))) out.push(at + ': frame 3 is not its practice position');
          if (bo.live || bo.opts.bad) out.push(at + ': frame ' + (i + 1) + ' takes moves or draws a game arrow');
          /* the marks: a ring on a piece or a square named, an arrow from a piece, a guard from a piece of theirs */
          f.rings.forEach(function (rg) { if (rg.kind === 'target' && f.st.b[rg.sq] && colorW(f.st.b[rg.sq]) === !!stateFromFen(L.fen).w) out.push(at + ': a target ring on a piece of yours'); });
          f.arrows.forEach(function (ar) { if (!f.st.b[ar.from]) out.push(at + ': an arrow from an empty square'); });
          f.guards.forEach(function (g) { var p = f.st.b[g.from]; if (!p || colorW(p) === !!stateFromFen(L.fen).w) out.push(at + ': a guard from no piece of theirs'); });
          if (d.live.indexOf('Lesson, step ' + (i + 1) + ' of 3. ') !== 0) out.push(at + ': the live region reads ' + d.live);
        });
      });
      return JSON.stringify({ out: out }); })()`));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  test('F9.1: the help level: Settings\' Help (More help, Normal, Less help) from the rating until chosen, then the choice; a 1600 player on More help gets tier 1\'s words and a hint after miss 1; Less help at 700 gets notation and no automatic hint; the choice outlives the rating', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(1600)} ${PLAY}
      var out = {}, lv = function (x) { data.user.perfs.rapid.rating = x; return helpLevel() + ' ' + playerTier(); };
      out.byRating = [lv(700), lv(1600), lv(2000)].join(', ');
      var block = function () { var m = /<span class="kicker">Help<\\/span>([\\s\\S]*?)<\\/div><div class="set-block">/.exec(settingsHtml()); return m ? m[1] : ''; };
      data.user.perfs.rapid.rating = 1600;
      var b0 = block();
      out.chips0 = (b0.match(/data-act="help" data-k="(\\w+)" aria-pressed="(\\w+)"/g) || []).join(' ');
      out.lines0 = words(b0);
      setHelp('more');
      out.stored = localStorage.getItem('nl:help:' + playerId());
      out.lines1 = words(block());
      out.tier = playerTier();
      /* an own card: tier 1's words, and miss 1 brings the hint */
      var it = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && c.played && familyOf(patternOf(x.b)).key === 'safety'; })[0];
      ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
      var a = cardFor(it); ui.session.active = a;
      out.words = [inWords(a), displayFor(a).row2 === CARD_COPY.T2(a, true) || displayFor(a).row2 === 'Find a better move.'];
      gradeMove(uciToMove(a.st, a.playedUci));
      out.hintAfterMiss = [a.misses, a.hints].join('/');
      /* Less help at 700: notation, no automatic hint */
      data.user.perfs.rapid.rating = 700;
      setHelp('less');
      ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
      var b = cardFor(it); ui.session.active = b;
      out.less = [playerTier(), inWords(b), displayFor(b).row2 === CARD_COPY.T2(b)].join('/');
      gradeMove(uciToMove(b.st, b.playedUci)); tryAgain(); gradeMove(uciToMove(b.st, b.playedUci));
      out.lessHints = [b.misses, b.hints].join('/');
      out.lessRating = lv(500);
      return JSON.stringify(out); })()`));
    eq(r.byRating, 'more 1, normal 2, less 3', 'from the rating: 700 More help, 1600 Normal, 2000 Less help');
    eq(r.chips0, 'data-act="help" data-k="more" aria-pressed="false" data-act="help" data-k="normal" aria-pressed="true" data-act="help" data-k="less" aria-pressed="false"', 'three chips, Normal on at 1600');
    eq(JSON.stringify(r.lines0), JSON.stringify(['More help', '✓ Normal', 'Less help', 'More help: moves in words, a hint after a miss, a third hint. Less help: notation, no automatic hints.', 'Set from your rating until you pick one.']), 'the block\'s words');
    eq(r.stored, '"more"', 'nl:help:<player> once chosen');
    eq(r.lines1.indexOf('Set from your rating until you pick one.'), -1, 'chosen: no longer from the rating');
    eq(r.tier, 1, 'More help is tier 1');
    eq(JSON.stringify(r.words), '[true,true]', 'a 1600 player on More help: moves in words');
    eq(r.hintAfterMiss, '1/1', 'and a hint after miss 1');
    eq(r.less, '3/false/true', 'Less help at 700: tier 3, notation');
    eq(r.lessHints, '2/0', 'no automatic hint');
    eq(r.lessRating, 'less 3', 'the choice outlives the rating');
    /* the chip, through the page's own click handler */
    const B = boot();
    B.ev(`(function () { ${AT(700)} return 1; })()`);
    B.click('help', 'normal');
    eq(B.ev('helpLevel() + " " + playerTier() + " " + localStorage.getItem("nl:help:" + playerId())'), 'normal 2 "normal"', 'Normal picked by its chip');
  });

  test('F9.2: Hint 3: on 5rk1/3p2pp/b7/4p3/3N4/8/P6P/6K1 w exactly c2 and b3 stay plain, the other six red; one plain square: no Hint 3; at More help after Hint 2 [Hint 3] rings the piece and reds its squares, "Hint 3 of 3" / "Red squares lose your knight.", the earlier rows "Hint 1 of 3", "Hint 2 of 3"; never the answer\'s square; graded with a hint; never at Normal help', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)}
      var out = {}, nm = function (xs) { return xs.map(sqName).sort().join(','); };
      var st = stateFromFen('5rk1/3p2pp/b7/4p3/3N4/8/P6P/6K1 w - - 0 1'), ls = loseSquares(st, sqIndex('d4'));
      out.spec = [nm(ls.plain), nm(ls.red), ls.lose, hint3Words(ls)[0]].join(' / ');
      var one = stateFromFen('5rk1/3p2pp/b7/4p3/p2N4/8/P6P/6K1 w - - 0 1'), l1 = loseSquares(one, sqIndex('d4'));
      out.one = [nm(l1.plain), hint3Of({ tier: 1, pre: one, best: uciToMove(one, 'd4c2') }) === null].join(' / ');
      /* a practice card on its balanced version (safety-1: the same red and plain squares) */
      var it = pracItem('pk:safety-1');
      ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
      var a = pracCardFor(it); ui.session.active = a;
      var row = function () { var d = displayFor(a); return d.row1 + ' / ' + d.row2 + ' | ' + d.buttons.map(function (b) { return b.label + (b.off ? ' (off)' : ''); }).join(' | '); };
      out.rows = [];
      out.rows.push(row()); giveHint(); out.rows.push(row()); giveHint(); out.rows.push(row()); giveHint(); out.rows.push(row());
      var o = boardOptsFor(a).opts;
      out.board = [JSON.stringify(o.rings), nm((o.tints || []).filter(function (t) { return t.kind === 'lose'; }).map(function (t) { return t.sq; }))].join(' / ');
      giveHint(); out.hints = a.hints;
      gradeMove(uciToMove(a.st, 'd4c2'));
      out.graded = [a.result, cardCategory(a, a.result), CAT_WORD[resultCategory(a, a.result)]].join(' / ');
      /* every practice position and every fixture card at More help: Hint 3 never reds the answer's square */
      var bad = [], n3 = 0;
      PRAC_DATA.forEach(function (row) { var p = pracItem('pk:' + row.split('|')[0]); ui.session = { mode: 't', label: 't', keys: [p.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
        var c = pracCardFor(p); ui.session.active = c; var h3 = hint3Of(c); if (!h3) return; n3++;
        if (h3.red.indexOf(c.best.to) >= 0 || p.ok.some(function (u) { return h3.red.indexOf(uciToMove(c.pre, u).to) >= 0 && uciToMove(c.pre, u).from === c.best.from; })) bad.push(p.id); });
      allMistakes().filter(trainable).forEach(function (x) { ui.session = { mode: 't', label: 't', keys: [x.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
        var c = cardFor(x); if (!c) return; ui.session.active = c; var h3 = hint3Of(c); if (!h3) return; n3++; if (h3.red.indexOf(c.best.to) >= 0) bad.push(x.key); });
      out.bad = bad; out.n3 = n3;
      /* an own card graded after Hint 3: with a hint, its record held */
      var own = allMistakes().filter(trainable).filter(function (x) { ui.session = { mode: 't', label: 't', keys: [x.key], idx: 0, results: {}, relearn: [], relearnOf: {} }; var c = cardFor(x); return c && hintMax(c) === 3; })[0];
      ui.session = { mode: 't', label: 't', keys: [own.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
      var b = cardFor(own); ui.session.active = b; giveHint(); giveHint(); giveHint();
      var h3row = displayFor(b).row1;
      gradeMove(uciToMove(b.st, b.bestUci));
      out.own = [h3row, b.hints, b.result, ui.session.sum[own.key].c].join(' / ');
      /* Normal help: the same card has two hints */
      setHelp('normal');
      ui.session = { mode: 't', label: 't', keys: [own.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
      var c2 = cardFor(own); ui.session.active = c2; giveHint();
      out.normal = [hintMax(c2), displayFor(c2).row1].join(' / ');
      return JSON.stringify(out); })()`));
    eq(r.spec, 'b3,c2 / b5,c6,e2,e6,f3,f5 / true / Red squares lose your knight.', 'the spec position: exactly c2 and b3 plain');
    eq(r.one, 'c2 / true', 'one plain square: no Hint 3');
    eq(JSON.stringify(r.rows), JSON.stringify(['Your turn / Find a safe square. | Hint | Show the answer', 'Hint 1 of 3 / Their pawn attacks your knight. | Hint 2 | Show the answer',
      'Hint 2 of 3 / Find a safe square. | Hint 3 | Show the answer', 'Hint 3 of 3 / Red squares lose your knight. | No more hints (off) | Show the answer']), 'the rows, and the bar\'s Hint naming the next');
    eq(r.board, '[{"sq":27,"kind":"hint"}] / b5,c6,e2,e6,f3,f5', 'the knight ringed, its six red squares, c2 and b3 plain');
    eq(r.hints, 3, 'no fourth hint');
    eq(r.graded, 'hint / hint / With a hint', 'graded "With a hint"');
    ok(r.n3 >= 20, 'cards and practice positions with Hint 3: ' + r.n3);
    eq(r.bad.length, 0, 'the answer\'s square red: ' + r.bad.join(', '));
    eq(r.own, 'Hint 3 of 3 / 3 / hint / hint', 'an own card after Hint 3: with a hint');
    eq(r.normal, '2 / Hint 1 of 2', 'Normal help: no Hint 3');
  });

  test('F9.3: a t1 player in their second set, new to Piece safety: the set\'s own first card, then three frames, a Practice position (its end "Now find it in your games."), then the card; the frames and the Practice position write nothing to nl:srs; never in a first set, never card 1, one lesson a set, at most one practice position in five, the set keeping its number of positions; a lesson seen is not shown again', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)} ${PLAY}
      var out = { first: null, steps: [] };
      startToday();
      out.first = ui.session.keys.filter(function (k) { return isPracKey(k) || isLessonKey(k); }).length;
      finishSet();
      out.after1 = [dayLoad().sessions, !!startLoad()].join('/');
      ui.session = null;
      /* every lesson seen but Piece safety's */
      var s = skillLoad(); PSKILL.forEach(function (x) { if (x.k !== 'safety') s.ls[x.k] = Date.now(); }); skillSave(s);
      var plan = morePracticeKeys().length;
      keepGoing();
      var ss = ui.session, keys = ss.keys.slice(), li = keys.indexOf('ls:safety');
      out.keys = keys.map(function (k) { return isPracKey(k) || isLessonKey(k) ? k : 'own:' + (cardSkill(itemOf(k)) || '-'); });
      out.shape = [li, keys[li + 1], keys[0] !== 'ls:safety' && !isPracKey(keys[0]), keys.filter(function (k) { return !isLessonKey(k); }).length === plan, keys.filter(isPracKey).length <= Math.floor(plan / 5)].join(' / ');
      var card = keys[li + 2];
      out.cardSkill = cardSkill(itemOf(card));
      /* the set: its first card, then the lesson */
      for (var i = 0; i < li; i++) { playOwn(ui.session.active); nextCard(); }
      var srs0 = JSON.stringify(srsLoad());
      for (var f = 0; f < 3; f++) { var a = ui.session.active, d = displayFor(a); out.steps.push([a.phase, d.cap, d.tag].join(' / ')); lessonStep(1); }
      var p = ui.session.active, d0 = displayFor(p);
      out.prac = [p.key, p.prac, d0.row1, d0.row2, d0.tag, d0.src === 'Lesson position', boardOptsFor(p).opts.bad === undefined].join(' / ');
      gradeMove(uciToMove(p.st, p.bestUci)); p.settle = 2;
      var d1 = displayFor(p);
      out.end = [d1.row1, d1.row2, d1.buttons.map(function (b) { return b.label; }).join(' | ')].join(' / ');
      out.srsSame = JSON.stringify(srsLoad()) === srs0;
      nextCard();
      out.then = ui.session.active.key === card && !ui.session.active.prac;
      out.seen = !!skillLoad().ls.safety;
      finishSet();
      ui.session = null;
      /* the next set: no lesson for Piece safety again */
      keepGoing();
      out.again = ui.session.keys.filter(function (k) { return k === 'ls:safety'; }).length;
      /* Normal help: none */
      ui.session = null; setHelp('normal');
      out.normal = withPractice(['a', 'b', 'c', 'd', 'e'], 'today').join(',');
      return JSON.stringify(out); })()`));
    eq(r.first, 0, 'never in a first set');
    eq(r.after1, '1/true', 'a first set finished');
    ok(/^\d+ \/ pk:safety-1 \/ true \/ true \/ true$/.test(r.shape) && +r.shape.split(' / ')[0] >= 1, 'the lesson before a later card, its practice position after it, card 1 an own one, the set\'s positions kept, one in five at most: ' + r.shape + ' ' + JSON.stringify(r.keys));
    eq(r.cardSkill, 'safety', 'then the Piece safety card');
    eq(JSON.stringify(r.steps), JSON.stringify(['lesson / Their pawn attacks your knight. / Lesson', 'lesson / Red squares are attacked too. / Lesson', 'lesson / Your turn: find a safe square. / Lesson']), 'three frames');
    eq(r.prac, 'pk:safety-1 / true / Your turn / Find a safe square. / Practice / true / true', 'the Practice position: its tag, its source, no red arrow');
    eq(r.end, 'Found it / Now find it in your games. /  | Continue', 'its end');
    eq(r.srsSame, true, 'the frames and the Practice position write nothing to nl:srs');
    eq(r.then, true, 'then the card');
    eq(r.seen, true, 'the lesson seen');
    eq(r.again, 0, 'not shown again');
    eq(r.normal, 'a,b,c,d,e', 'Normal help: no practice in a set');
  });

  test('F9.4: a pack of 5 at 700: no nl:srs change, 5 first tries in nl:skill; 3 first tries in a row step up (the pack\'s rest from other players\' games), 2 misses in a row step down; the pack\'s end; the day counted, but no set of the player\'s own (day.sessions, since you started) and nothing learned', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)} ${PLAY}
      var out = {}, s = skillLoad(); s.ls.free = Date.now(); skillSave(s);
      var srs0 = JSON.stringify(srsLoad());
      startPack('free');
      out.keys0 = ui.session.keys.map(function (k) { var p = itemOf(k); return p.src + pracStep(p); }).join(',');
      var steps = [];
      for (var i = 0; i < 5; i++) { var a = ui.session.active; gradeMove(uciToMove(a.st, a.bestUci)); steps.push(skillLoad().k.free.st); nextCard(); }
      out.steps = steps.join(',');
      out.keys1 = ui.session.keys.map(function (k) { var p = itemOf(k); return p.src + pracStep(p); }).join(',');
      var rec = skillLoad().k.free;
      out.h = rec.h.map(function (x) { return x[1]; }).join('');
      out.srs = JSON.stringify(srsLoad()) === srs0;
      out.done = words(doneHtml(ui.session)).filter(function (x) { return /^Practice:|^Up a step|^Free pieces · \\d/.test(x); });
      out.day = [dayLoad().sessions || 0, !!store.get(startKey(), null), dayCounts(dayLoad())].join('/');
      out.learned = Object.keys(srsLoad()).filter(function (k) { return srsLoad()[k].learned; }).length;
      /* two misses in a row: a step back */
      ui.session = null;
      startPack('free');
      for (var j = 0; j < 2; j++) { var b = ui.session.active, off = legalMoves(b.st).filter(function (m) { return b.it.ok.indexOf(moveUci(m)) < 0 && b.it.cl.indexOf(moveUci(m)) < 0; })[0]; gradeMove(off); reveal(); nextCard(); }
      out.down = [skillLoad().k.free.st, !!ui.session.packDown].join('/');
      out.downWords = words(doneHtml(Object.assign({}, ui.session, { finished: true }))).filter(function (x) { return /step/.test(x); });
      return JSON.stringify(out); })()`));
    eq(r.keys0, 'L1,L1,L1,L1,L1', 'five lesson positions at step 1');
    eq(r.steps, '1,1,2,2,2', 'the third first try in a row steps up');
    ok(/^L1,L1,L1,R2,R2$/.test(r.keys1), 'the rest of the pack from other players\' games (800 to 1100): ' + r.keys1);
    eq(r.h, '11111', '5 first tries in nl:skill');
    eq(r.srs, true, 'no nl:srs change');
    eq(JSON.stringify(r.done), JSON.stringify(['Practice: 5 of 5 first try.', 'Up a step: positions from other players\' games next.', 'Free pieces · 5 of 5 first try']), 'the pack\'s end');
    eq(r.day, '0/false/true', 'the day counted, no set of the player\'s own');
    eq(r.learned, 0, 'nothing learned');
    eq(r.down, '1/true', 'two misses in a row: a step back');
    eq(JSON.stringify(r.downWords), JSON.stringify(['A step back: easier positions next.']), 'said on its end');
  });

  test('F9.4: a practice position wears "Practice" and its source line before its first move, no red arrow, Details "Practice position, not from your games." with where it is from; a close move, a miss and the answer shown read as on any card; scored apart in a Today set ("Practice: 1 of 1 first try."), never in the headline', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)} ${PLAY}
      var out = {}, open = function (key) { var it = pracItem(key); ui.session = { mode: 't', label: 't', keys: [key], idx: 0, results: {}, relearn: [], relearnOf: {} }; var a = pracCardFor(it); ui.session.active = a; return a; };
      var a = open('pk:m16b'), d = displayFor(a);
      out.open = [d.row1, d.row2, d.tag, d.src, boardOptsFor(a).opts.bad === undefined, d.buttons.map(function (b) { return b.label; }).join(' | '), /<span class="tag tag-slate">Practice<\\/span><span class="tag-src">Another player&#39;s game<\\/span>/.test(tagRowHtml(d))].join(' / ');
      gradeMove(uciToMove(a.st, a.bestUci)); a.settle = 2;
      d = displayFor(a);
      out.found = [d.row1, d.row2, d.tag, words(d.strip).join(' ')].join(' / ');
      out.details = words(detailsHtml());
      out.menu = words(menuHtml(a));
      /* a close move, then found: a good move first */
      var c = PRAC_DATA.map(function (x) { return x.split('|'); }).filter(function (x) { return x[6]; })[0];
      var b = open('pk:' + c[0]); gradeMove(uciToMove(b.st, c[6].split(',')[0]));
      out.close = [displayFor(b).row1, displayFor(b).row2].join(' / ');
      tryAgain(); gradeMove(uciToMove(b.st, b.bestUci));
      out.closeThen = [b.result, ui.session.sum[b.key].c].join(' / ');
      /* a miss: its verdict, then its reason */
      var m = open('pk:free-1'), off = legalMoves(m.st).filter(function (x) { return moveUci(x) === 'g1f1'; })[0];
      gradeMove(off); m.reason = 2;
      out.miss = [displayFor(m).row1, displayFor(m).row2, m.misses, m.hints].join(' / ');
      /* the answer shown */
      var v = open('pk:free-2'); reveal();
      out.shown = [displayFor(v).row1, displayFor(v).row2].join(' / ');
      playIt(false); v.settle = 2;
      out.shownSettled = [displayFor(v).row1, displayFor(v).row2, v.result].join(' / ');
      /* in a Today set's summary: apart from the headline */
      var own = allMistakes().filter(trainable)[0].key, ss = { mode: 'today', label: 'Today', keys: [own, 'pk:free-1'], idx: 2, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
      ss.results[own] = 'retry'; ss.sum[own] = { c: 'miss', s: 1, fc: '' };
      ss.results['pk:free-1'] = 'first'; ss.sum['pk:free-1'] = { c: 'first', s: 3, fc: '', prac: 1, sk: 'free' };
      var dh = doneHtml(ss), w = words(dh);
      out.summary = [(/<h2 class="done-big"[^>]*>([^<]*)</.exec(dh) || [])[1], w.indexOf('Practice: 1 of 1 first try.') >= 0, w.indexOf('Free pieces · Practice') >= 0].join(' / ');
      return JSON.stringify(out); })()`));
    eq(r.open, 'Your turn / Find the free piece. / Practice / Another player\'s game / true / Hint | Show the answer / true', 'before its first move: its tag and source line in the tag row');
    ok(/^Found it \/ That wins their \w+\. \/  \/ Details$/.test(r.found), 'found, then settled (the tag row the strip\'s place): ' + r.found);
    ok(r.details.indexOf('From another player\'s game, rated about 800.') >= 0 && r.details.indexOf('Practice position, not from your games.') >= 0 && r.details.some((x) => /^Your move: \w+ takes on [a-h][1-8]\. That wins their \w+\.$/.test(x)), 'Details: ' + JSON.stringify(r.details));
    ok(r.menu.indexOf('Open the game ↗') < 0 && !r.menu.some((x) => /Not a real mistake/.test(x)), 'no game, nothing to dispute: ' + JSON.stringify(r.menu));
    eq(r.close, 'Good move / There\'s a stronger one.', 'a close move');
    eq(r.closeThen, 'hint / good', 'then found: after a good move');
    ok(/^Not this one \/ .+ \/ 1 \/ 1$/.test(r.miss), 'a miss says why, and brings Hint 1 at More help: ' + r.miss);
    eq(r.shown, 'Here is the answer / Play the green arrow.', 'the answer shown');
    ok(/^Here is the answer \/ That wins their \w+\. \/ fail$|^The answer: .+ \/ That wins their \w+\. \/ fail$/.test(r.shownSettled), 'shown, played and settled: ' + r.shownSettled);
    eq(r.summary, 'You found it. / true / true', 'the headline counts the own position alone (V4.3: "You found it.", one found); practice on its own line and tile');
  });

  test('F9.4: mastery: 8 of the last 10 first tries over 2 days or more, half from real positions (as many as the skill has), the seal on the pack\'s end; "Needs polish" under 6 of 10 later; one mixed review per Today set, from the mastered skills in turn, never card 1', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)} ${PLAY}
      var out = {}, now = Date.now(), s = skillLoad();
      PSKILL.forEach(function (x) { s.ls[x.k] = now; });
      /* nine first tries over two days, five of them real */
      s.k.free = { st: 3, r: 0, h: [] };
      for (var i = 0; i < 9; i++) s.k.free.h.push([now - (i < 4 ? 2 * DAY : 0), 1, i < 5 ? 1 : 0]);
      skillSave(s);
      out.before = JSON.stringify(masteryOf('free', skillLoad().k.free));
      startPack('free');
      var a = ui.session.active; gradeMove(uciToMove(a.st, a.bestUci));
      out.mastered = [!!skillLoad().k.free.m, ui.session.packMastered].join('/');
      ui.session.finished = true;
      out.page = words(doneHtml(ui.session)).filter(function (x) { return /Mastered/.test(x); });
      out.seal = /rg rg-learned" data-fx="seal"/.test(doneHtml(ui.session));
      out.tile = /class="sk-tile is-done[^"]*" data-act="sheet" data-k="skill:free">/.test(skillTilesHtml()) && /Mastered/.test(skillTilesHtml());
      /* five misses later: needs polish, the badge kept */
      var s2 = skillLoad(); for (var j = 0; j < 5; j++) s2.k.free.h.push([now, 0, 0]); s2.k.free.h = s2.k.free.h.slice(-10); skillSave(s2);
      ui.session = null; startPack('free'); var b = ui.session.active; reveal();
      out.polish = [skillState(skillLoad(), 'free'), !!skillLoad().k.free.m].join('/');
      /* a Today set after a first one: one mixed review of a mastered skill, never card 1 */
      ui.session = null;
      var s3 = skillLoad(); s3.k.pin = { st: 1, r: 0, h: [], m: now }; skillSave(s3);
      startToday(); finishSet(); ui.session = null;
      var mixed = [];
      for (var k = 0; k < 3; k++) { keepGoing(); var ks = ui.session.keys; mixed.push(ks.filter(isPracKey).map(function (x) { return itemOf(x).skill; }).join('+') + '@' + ks.indexOf(ks.filter(isPracKey)[0])); finishSet(); ui.session = null; }
      out.mixed = mixed;
      return JSON.stringify(out); })()`));
    ok(/"ok":false/.test(r.before) && /"first":9/.test(r.before), 'nine first tries are not yet mastery: ' + r.before);
    eq(r.mastered, 'true/free', 'the tenth masters it');
    eq(JSON.stringify(r.page), JSON.stringify(['Mastered: Free pieces.', 'Free pieces · Mastered']), 'said on the pack\'s end, its meter "Mastered"');
    eq(r.seal, true, 'with its seal');
    eq(r.tile, true, 'its tile: the badge, "Mastered"');
    eq(r.polish, 'Needs polish/true', 'under 6 of 10 later: "Needs polish", the badge kept');
    eq(r.mixed.length, 3, 'three sets');
    r.mixed.forEach((x, i) => ok(/^(free|pin)@[1-9]\d*$/.test(x), 'set ' + (i + 2) + ': one mixed review, never card 1: ' + x));
    ok(r.mixed[0].split('@')[0] !== r.mixed[1].split('@')[0], 'taken in turn: ' + r.mixed.join(', '));
  });

  test('F9.5: skill tiles: at More help Insights shows, right under its headline and lead, ten tiles a beginner can read (number, name, a 10-dot meter, its words, "Next" on the coming skill), meters moving from a new player\'s first pack; a tap opens the skill\'s card (Practise 5, the lesson); the focus card one tap target with one meter (V4.7: no skill meter beside it); none at Normal help', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)} ${PLAY}
      var out = {}, ins = function () { var box = { innerHTML: '' }, el0 = el; el = function (id) { return id === 'insightsbox' ? box : el0(id); }; ui.view = 'insights'; renderInsights(); ui.view = 'train'; el = el0; return box.innerHTML; };
      var tiles = function (h) { return (String(h).match(/<a class="sk-tile[\\s\\S]*?<\\/a>/g) || []).map(function (t) { return [(/data-k="skill:(\\w+)"/.exec(t) || [])[1], (t.match(/<i class="on">/g) || []).length, (/class="sk-state">([^<]*)</.exec(t) || [])[1], /class="pill">Next</.test(t)].join(':'); }); };
      var h0 = ins();
      /* the headline, its lead, the tiles, then what cost the games (the first screen keeps the headline, F6.1) */
      out.first = ['<h2>', '<p class="lead">', '<section class="sk-tiles"', '<h3 class="ins-h">What cost you games'].map(function (k) { return h0.indexOf(k); });
      out.t0 = tiles(h0);
      var s = skillLoad(); s.ls.free = Date.now(); skillSave(s);
      startPack('free');
      for (var i = 0; i < 5; i++) { var a = ui.session.active; gradeMove(uciToMove(a.st, a.bestUci)); nextCard(); }
      ui.session = null;
      out.t1 = tiles(ins())[0];
      out.sheet = words(sheetHtml('skill:free'));
      out.acts = (sheetHtml('skill:free').match(/data-act="(pack|lesson)" data-k="free"/g) || []).length;
      var fh = focusHtml();
      out.focus = [(/^<a class="focus focus-go" data-act="sheet" data-k="([^"]*)"/.exec(fh) || [])[1] || 'no link', /focus-sk|Piece safety ·/.test(fh), (fh.match(/class="fr-bar/g) || []).length];
      setHelp('normal');
      out.normal = /sk-tiles/.test(ins()) || /focus-sk/.test(focusHtml());
      return JSON.stringify(out); })()`));
    ok(r.first.every((v, i) => v > 0 && (i === 0 || v > r.first[i - 1])), 'Insights: the headline and its lead, then the tiles, then what cost the games: ' + r.first.join(' '));
    eq(r.t0.length, 10, 'ten tiles');
    eq(r.t0.map((x) => x.split(':')[0]).join(','), 'free,safety,count,mate1,stopmate,fork,pin,hidden,backrank,pawns', 'in path order');
    ok(r.t0.every((x) => /^\w+:0:Not started:/.test(x)), 'a new player: empty meters, "Not started": ' + r.t0.join(' '));
    eq(r.t0.filter((x) => /:true$/.test(x)).length, 1, 'one "Next"');
    eq(r.t1, 'free:5:5 of 5 first try:true', 'the meter moves from the first pack (Free pieces still the coming skill)');
    eq(JSON.stringify(r.sheet.slice(0, 3)), JSON.stringify(['Skill 1 of 10', 'Free pieces', 'A piece with no guard can be taken for free.']), 'the skill\'s card');
    ok(r.sheet.indexOf('Practise 5') >= 0 && r.sheet.indexOf('See the lesson again') >= 0 && r.acts === 2, 'Practise 5 and the lesson: ' + JSON.stringify(r.sheet));
    eq(JSON.stringify(r.focus), JSON.stringify(['family:safety', false, 1]), 'the focus card: one tap target opening its skill\'s sheet, one meter, no skill meter beside it (V4.7)');
    eq(r.normal, false, 'Normal help: none');
  });

  test('slice 9 storage: nl:skill (lessons seen, each skill\'s step, run and last ten, when mastered) moves with shiftDays, rides in the progress file with nl:help and goes with Reset (nl:help stays: a setting)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${AT(700)}
      var out = {}, now = Date.now(), s = skillLoad();
      s.ls.free = now; s.k.free = { st: 2, r: 1, h: [[now, 1, 0]], m: now }; skillSave(s); setHelp('more');
      window.__nlTest.shiftDays(3);
      var t = skillLoad();
      out.shift = [now - t.ls.free, now - t.k.free.h[0][0], now - t.k.free.m].map(function (x) { return Math.round(x / DAY); }).join(',');
      var got = null; Blob = function (parts) { got = JSON.parse(parts[0]); };
      try { exportProgress(); } catch (e) { }
      out.file = Object.keys(got.keys).filter(function (k) { return /^nl:(skill|help):/.test(k); }).sort().join(',');
      return JSON.stringify(out); })()`));
    eq(r.shift, '3,3,3', 'three days back');
    eq(r.file, 'nl:help:cc:tester,nl:skill:cc:tester', 'in the progress file');
    A.click('resetProgress'); A.advance(1500); A.click('resetProgress');
    eq(A.ev('localStorage.getItem("nl:skill:" + playerId())'), null, 'Reset takes nl:skill');
    eq(A.ev('localStorage.getItem("nl:help:" + playerId())'), '"more"', 'and keeps the help level');
  });

  if (process.env.NL_SF) test('NL_SF=1: Stockfish 17.1 at 1,000,000 nodes agrees with every practice position: its best move accepted, each accepted move within the card\'s 4 points of it (2 more for the search\'s own noise), a mate in one\'s mates', async () => {
    const A = boot();
    const rows = JSON.parse(A.ev('JSON.stringify(PRAC_DATA.map(function (x) { var f = x.split("|"); return { id: f[0], fen: f[4], ok: f[5].split(","), n: legalMoves(stateFromFen(f[4])).length }; }))'));
    const e = engine();
    const win = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    const out = [];
    for (const p of rows) {
      const res = await e.go(p.fen, Math.min(8, p.n));
      const top = res[0], w0 = top.mate != null ? (top.mate > 0 ? 100 : 0) : win(top.cp);
      if (p.ok.indexOf(top.pv[0]) < 0) out.push(p.id + ': Stockfish plays ' + top.pv[0] + ', accepted ' + p.ok.join());
      p.ok.forEach((u) => {
        const l = res.filter((x) => x.pv[0] === u)[0];
        if (!l) return;
        const w = l.mate != null ? (l.mate > 0 ? 100 : 0) : win(l.cp);
        if (top.mate != null && top.mate > 0 ? l.mate !== top.mate : w0 - w > 6) out.push(p.id + ': ' + u + ' is ' + (w0 - w).toFixed(1) + ' points below');
      });
    }
    e.quit();
    eq(out.length, 0, out.length + ' disagreements, first: ' + out.slice(0, 4).join(' | '));
  });

  return T;
};

/* the repo's own Stockfish under Node, by UCI: go(fen, multipv) -> its last complete set of lines, best
   first ({ pv, cp, mate }) */
function engine() {
  const { spawn } = require('child_process');
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'sf', 'stockfish.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', on = null;
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (on) on(l); } });
  const send = (s) => p.stdin.write(s + '\n');
  const until = (pred, each) => new Promise((res) => { on = (l) => { if (each) each(l); if (pred(l)) { on = null; res(l); } }; });
  const ready = (async () => { const w = until((l) => l === 'uciok'); send('uci'); await w; send('setoption name Threads value 1'); send('setoption name Hash value 64'); const r = until((l) => l === 'readyok'); send('isready'); await r; })();
  return {
    async go(fen, mpv) {
      await ready;
      send('setoption name MultiPV value ' + mpv); send('ucinewgame');
      const r = until((l) => l === 'readyok'); send('isready'); await r;
      send('position fen ' + fen);
      let cur = {}, last = {}, most = 0;
      const done = until((l) => /^bestmove/.test(l), (l) => {
        const m = /^info .*?\bmultipv (\d+) .*?\bscore (cp|mate) (-?\d+).*?\bpv (.+)$/.exec(l);
        if (!m) return;
        if (+m[1] === 1) cur = {};
        cur[m[1]] = { pv: m[4].trim().split(/\s+/), cp: m[2] === 'cp' ? +m[3] : null, mate: m[2] === 'mate' ? +m[3] : null };
        if (Object.keys(cur).length >= most) { most = Object.keys(cur).length; last = Object.assign({}, cur); }
      });
      send('go nodes 1000000');
      await done;
      return Object.keys(last).sort((a, b) => a - b).map((k) => last[k]);
    },
    quit() { try { send('quit'); } catch (x) {} setTimeout(() => { try { p.kill(); } catch (x) {} }, 200); },
  };
}
