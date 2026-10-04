/* ── The card: one mistake, retried ─────────────────────────────────────────
   Phases: 'loading' (the deeper look) -> 'guess' -> 'checking' (a move is
   being graded) -> 'tried' (the try stays on the board: a miss, a close
   move, or one the engine could not check) -> 'guess' again on Try again,
   or 'reply' (the opponent's answer inside a forcing line) -> 'done' (the
   why). Nothing on the board moves without a tap, except that reply. */

var SOLVE_TOL = 4;        /* win-chance points from the best move: solved */
var STRONGER_TOL = 10;    /* within this: good, but look for more */

/* the player's help level: the defaults change with rating (novices get
   more guidance, strong players get the whole line and no hints) */
/* the help level follows the tracked format's current rating */
function playerTier() {
  var r = null, perf = trackedPerfs()[0];
  if (data.user && data.user.perfs && perf && data.user.perfs[perf]) r = bandEquivRating(perf, data.user.perfs[perf].rating);
  if (r == null) return 2;
  return r < 1200 ? 1 : (r < 1800 ? 2 : 3);
}
function myPov(it) { return it.g.color === 'white'; }
function evalWhite(it, myCp) { return myPov(it) ? myCp : -myCp; }

/* the three (or four) lines a solved card can show, each position with the
   evaluation it inherits from the search that produced the line */
function cardLines(a) {
  var it = a.it, g = it.g, b = it.b, pre = a.pre, p = b.p;
  var mk = function (ucis, startPly, evalMy, evalsMy) {
    var played = playUci(pre, ucis);
    return { uci: played.uci, san: played.san, states: played.states, moves: played.moves,
             ply0: startPly, ev: evalsMy || played.uci.map(function () { return evalMy; }) };
  };
  var best = unpackUci(b.lu);
  if (!best.length && b.bu) best = [b.bu];
  /* the evaluation after the game move, from the deeper look or the scan */
  var ea = b.ea != null ? b.ea : (b.ma != null ? (b.ma > 0 ? 1500 : -1500) : cpFromWin(b.wa));
  var out = {
    best: mk(best.slice(0, a.cls && a.cls.mateFor ? 20 : Math.max(2, (a.settleBest || 6) + 2)), p, b.eb),
    refute: mk([a.playedUci].concat(unpackUci(b.ru)).slice(0, a.cls && a.cls.mateAgainst ? 21
      : Math.max(3, Math.max(a.settleGame || 6, a.cls && a.cls.lossAt || 0) + 3)), p, ea)
  };
  /* what really happened: the game's own moves, evaluated by the scan */
  var toks = g.mv.split(' '), gm = [], st = cloneState(pre);
  for (var k = p; k < Math.min(toks.length, p + 8); k++) {
    var mv = sanToMove(st, toks[k]);
    if (!mv) break;
    gm.push(moveUci(mv));
    applyMove(st, mv);
  }
  var gEv = gm.map(function (u, i) {
    var w = wpAt(g, p + i);
    return w == null ? ea : cpFromWin(w);
  });
  out.game = mk(gm, p, ea, gEv);
  if (a.yours) out.yours = mk(a.yours.uci, p, a.yours.cp);
  return out;
}
/* the inverse of the win-chance curve, for drawing the bar from a series */
function cpFromWin(w) {
  w = Math.max(0.5, Math.min(99.5, w));
  var x = w / 50 - 1;
  return Math.round(-Math.log(2 / (x + 1) - 1) / 0.00368208);
}

/* one line on a phone is 80 characters: the first candidate that fits,
   else the shortest (candidates run from fullest to barest) */
var LINE_MAX = 80;
function fitLine(cands) {
  cands = cands.filter(Boolean);
  for (var i = 0; i < cands.length; i++) if (cands[i].length <= LINE_MAX) return cands[i];
  return cands.reduce(function (x, y) { return y.length < x.length ? y : x; });
}
/* a sentence cut back to its first clause, keeping the move it names */
function firstClause(s) { var i = s.indexOf(': '); return i > 0 ? s.slice(0, i) + '.' : s; }

/* ── starting a card ─────────────────────────────────────────────────────── */
function cardFor(it) {
  var g = it.g, b = it.b;
  var pre = stateAtPly(g.mv, b.p);
  if (!pre) return null;
  var playedUci = uciOfSan(g.mv, b.p);
  var best = b.bu ? uciToMove(pre, b.bu) : null;
  if (!best || !playedUci || b.bu === playedUci) return null;
  var rec = srsRec(it);
  var a = {
    it: it, key: it.key, pre: pre, st: cloneState(pre), phase: 'guess', best: best, bestUci: b.bu,
    playedUci: playedUci, played: uciToMove(pre, playedUci),
    attempts: 0, misses: 0, hints: 0, sel: -1, shapes: [], t0: Date.now(),
    firstSight: !rec, tier: playerTier(), view: null
  };
  var kept = ui.session && ui.session.progress && ui.session.progress[it.key];
  if (kept) { a.misses = kept.m || 0; a.hints = kept.h || 0; a.triedGameMove = !!kept.g; a.foundGood = kept.f || null; a.attempts = kept.a || 0; }
  /* prior move, to show how the position arose */
  if (b.p > 0) {
    var before = stateAtPly(g.mv, b.p - 1);
    var pm = before ? sanApply(cloneState(before), g.mv.split(' ')[b.p - 1]) : null;
    if (pm) a.lastMove = [pm.from, pm.to];
    a.preLast = a.lastMove;
  }
  /* the settled lengths of both lines, and a forcing-line task for players
     who should see the whole combination, not just its first move
     (looksForcing, for the first session's order, reads the same rule
     from the stored line without the classifier) */
  var cls = classifyMistake(pre, playedUci, { pv: unpackUci(b.lu), mate: b.mb }, { pv: unpackUci(b.ru), mate: b.ma }, b.wb, b.wa, b.p);
  a.cls = cls;
  a.settleBest = cls.bSettle;
  a.settleGame = cls.gSettle;
  var lu = unpackUci(b.lu);
  var forcing = cls.bestLine && cls.bestLine.nodes[1]
    && (cls.bestLine.nodes[1].captured || checkersOf(cls.bestLine.nodes[1].after).length || cls.mateFor);
  if (a.tier >= 2 && forcing && lu.length >= 3 && cls.bSettle >= 3) {
    /* my moves sit at even offsets of the best line; stop at the settle */
    var endAt = cls.mateFor ? lu.length : Math.min(lu.length, cls.bSettle + (cls.bSettle % 2 === 0 ? 1 : 0));
    a.sol = lu.slice(0, endAt % 2 === 0 ? endAt - 1 : endAt);
    if (a.sol.length < 3) a.sol = null;
  }
  a.solIdx = 0;
  return a;
}
function currentItem() {
  var ss = ui.session;
  if (!ss) return null;
  var key = ss.keys[ss.idx];
  return key ? model().byKey[key] || null : null;
}
function loadCard() {
  var ss = ui.session;
  if (!ss) return;
  ss.active = null;
  if (ss.idx >= ss.keys.length && queueRelearn(ss)) saveSession();
  if (ss.idx >= ss.keys.length) {
    /* every position was removed by the deeper look before one was shown */
    if (!Object.keys(ss.results || {}).length) { endSession(); notice('On a deeper look that position was not a real mistake, so it was removed.'); return; }
    finishSession(); return;
  }
  var it = currentItem();
  if (!it || !trainable(it) || it.b.x) { ss.keys.splice(ss.idx, 1); saveSession(); loadCard(); return; }
  var myGen = gen, key = it.key;
  var go = function () {
    if (ss.loadingKey === key) ss.loadingKey = null;
    if (stale(myGen) || ui.session !== ss || ss.keys[ss.idx] !== key) return;
    if (it.b.x) { ss.keys.splice(ss.idx, 1); saveSession(); loadCard(); return; }
    var a = cardFor(it);
    if (!a) { it.b.x = 'moves'; ss.keys.splice(ss.idx, 1); saveSession(); loadCard(); return; }
    ss.active = a;
    a.shownAt = Date.now();
    renderCard();
    setTimeout(scrollTrainerTop, 60);
    prefetchCards(ss);
    track('card_shown');
  };
  if ((it.b.v || 0) >= 2 || SF.state === 'failed') go();
  else {
    ss.loadingKey = key;
    renderCard();
    deepEnrich(it, true).then(go, go);
  }
}
/* the next two cards get their deeper look while this one is solved */
function prefetchCards(ss) {
  for (var i = ss.idx + 1; i < Math.min(ss.keys.length, ss.idx + 3); i++) {
    var it = model().byKey[ss.keys[i]];
    if (it && (it.b.v || 0) < 2) deepEnrich(it, false);
  }
}

/* ── moves on the board ──────────────────────────────────────────────────── */
function sessionClick(sq) {
  var ss = ui.session, a = ss && ss.active;
  if (a && a.phase === 'tried' && !a.pendingPromo) {
    /* a try on the board: a tap on one of your pieces takes it back and
       picks that piece up; anything else is not a move here */
    var pick = triedPick(a, sq);
    if (pick >= 0) tryAgain(pick);
    return;
  }
  if (!a || a.phase !== 'guess' || a.pendingPromo) {
    if (a && a.phase === 'done' && !a.pendingPromo) {
      if (a.explore) exploreClick(sq);
      else {
        /* a tap on a piece of the side to move starts exploring from the
           frame on screen (a swipe over the board still scrolls the page) */
        var vs = lineView(a).st, pc = vs.b[sq];
        if (pc && isW(pc) === vs.w) startExplore({ sq: sq, via: 'tap' });
        else if (pc) notice('It is ' + sideName(vs.w) + '\'s move here. Move a ' + sideName(vs.w).toLowerCase() + ' piece.');
      }
    }
    return;
  }
  var p = a.st.b[sq];
  if (p && isW(p) === a.st.w) {
    a.sel = a.sel === sq ? -1 : sq;
    snd('tap');
    renderCard();
    return;
  }
  if (a.sel < 0) return;
  var legal = legalMoves(a.st).filter(function (m) { return m.from === a.sel && m.to === sq; });
  if (!legal.length) { a.sel = -1; renderCard(); return; }
  if (legal.length > 1 && legal[0].promo) { a.pendingPromo = { moves: legal, to: sq }; renderCard(); return; }
  /* a tapped move slides into place; a dragged one is already where it was dropped */
  a.tapped = !pointerState.suppressClick;
  gradeMove(legal[0]);
}
function promoChoose(piece) {
  var a = ui.session && ui.session.active;
  if (!a || !a.pendingPromo) return;
  var m = a.pendingPromo.moves.filter(function (x) { return x.promo === piece; })[0];
  a.pendingPromo = null;
  if (!m) { renderCard(); return; }
  if (a.phase === 'done' && a.explore) explorePlay(m, false); else gradeMove(m);
}

function gradeMove(m) {
  var ss = ui.session, a = ss.active;
  var u = moveUci(m);
  a.sel = -1;
  a.shapes = [];
  a.verdict = null; a.hintAfter = false;
  a.attempts++;
  store.set('nl:marksSeen', true);
  /* the slide is kept until the move is actually drawn: a refused one is
     never animated */
  a.tapAnim = a.tapped ? [m.from, m.to] : null;
  a.animMove = null;
  a.tapped = false;
  /* inside a forcing line: later steps must follow it (or mate) */
  if (a.sol && a.solIdx > 0) {
    var want = a.sol[a.solIdx];
    var after = cloneState(a.st);
    applyMove(after, m);
    var mates = checkedKingSq(after) != null && !legalMoves(after).length;
    if (u === want || mates) { stepLine(m, u); return; }
    return checkMove(m, u, true);
  }
  if (u === a.bestUci || (a.sol && u === a.sol[0])) {
    if (a.sol && a.sol.length > 1) { stepLine(m, u); return; }
    solved(m, u, null);
    return;
  }
  if (u === a.playedUci) { sameAsGame(m); return; }
  checkMove(m, u, false);
}
/* the forcing line, move by move: my move, then theirs is played for me */
function stepLine(m, u) {
  var a = ui.session.active;
  var san = sanOf(a.st, m);
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.animMove = a.tapAnim || null; a.tapAnim = null;
  a.solIdx++;
  snd('good');
  if (a.solIdx >= a.sol.length) { solved(null, null, null, true); return; }
  var reply = uciToMove(a.st, a.sol[a.solIdx]);
  if (!reply) { solved(null, null, null, true); return; }
  a.phase = 'reply';
  /* my moves sit at even offsets of the line: the next one is number n */
  a.hintAfter = false;
  a.verdict = { cls: 'verdict-good', html: '✓ ' + esc(san) + '. Move ' + (Math.ceil(a.solIdx / 2) + 1) + ' of ' + Math.ceil(a.sol.length / 2) + ': now finish it.', panel: '✓ ' + esc(san) + '.' };
  renderCard();
  var cardKey = a.key;
  setTimeout(function () {
    var a2 = ui.session && ui.session.active;
    if (!a2 || a2.key !== cardKey || a2.phase !== 'reply') return;
    applyMove(a2.st, reply);
    a2.lastMove = [reply.from, reply.to];
    a2.animMove = [reply.from, reply.to];
    a2.solIdx++;
    snd('move');
    if (a2.solIdx >= a2.sol.length) { solved(null, null, null, true); return; }
    a2.phase = 'guess';
    renderCard();
  }, 650);
}
/* the tried move is the game move: it stays on the board with why it
   failed, and their reply from the game is one tap away (See it) */
function sameAsGame(m) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  a.triedGameMove = true;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  snd('bad');
  /* the card's own sentence, unless it would name the answer */
  var said = (a.cls.sentences.short || a.cls.sentences.game).replace(/^\S+\s/, 'It ');
  var bestSan = sanOf(a.pre, a.best);
  if (said.indexOf(bestSan) >= 0 || familyOf(patternOf(it.b)).key === 'chances') said = 'There is something stronger here.';
  a.hintAfter = false;
  a.verdict = { cls: 'verdict-bad', html: esc(fitLine(['✗ Your game move again. ' + said, '✗ Your game move again. ' + firstClause(said), '✗ Your game move again.'])) };
  escalate();
  /* a tapped game move slides in on this, its first frame */
  a.animMove = a.tapAnim; a.tapAnim = null;
  showTry(a, m, 'miss', unpackUci(it.b.ru)[0]);
}
/* misses and hints outlive a reload, so a retry is never scored first-try */
function keepProgress(a) {
  var ss = ui.session;
  if (!ss || !a) return;
  ss.progress = ss.progress || {};
  ss.progress[a.key] = { m: a.misses, h: a.hints, g: a.triedGameMove ? 1 : 0, f: a.foundGood || null, a: a.attempts };
  saveSession();
}
/* a miss is kept at once, and brings the first hint for players who need
   it: after one miss at tier 1, after two at tier 2, never at tier 3. The
   hint shows on Try again; no number of misses shows the answer */
function escalate() {
  var a = ui.session.active, autoAt = a.tier === 1 ? 1 : (a.tier === 2 ? 2 : 0);
  if (autoAt && a.misses >= autoAt && !a.hints) a.hints = 1;
  keepProgress(a);
}
/* a try stays where it landed until the player takes it back: a.st keeps
   the position before it, and the board draws the try over it (and their
   reply, once See it plays it). kind: 'miss', 'close' or 'unchecked' */
function showTry(a, m, kind, reply) {
  var after = cloneState(a.st);
  applyMove(after, m);
  a.phase = 'tried';
  a.ghostMove = null;
  a.tried = { from: m.from, to: m.to, uci: moveUci(m), san: sanOf(a.st, m), kind: kind,
              reply: reply && uciToMove(after, reply) ? reply : null, seen: false };
  renderCard();
}
/* what the board shows while a try is on it: the position and its last move */
function triedFrame(a) {
  var t = a.tried, st = cloneState(a.st), m = uciToMove(st, t.uci), last = [t.from, t.to];
  if (m) applyMove(st, m);
  var r = t.seen && t.reply ? uciToMove(st, t.reply) : null;
  if (r) { applyMove(st, r); last = [r.from, r.to]; }
  return { st: st, last: last };
}
/* the piece a tap picks up while a try is on the board: one of yours where
   it stands now, the tried piece from where it came (a castled rook from its
   corner); -1 for anything else */
function triedPick(a, sq) {
  var p = triedFrame(a).st.b[sq], t = a.tried;
  if (!p || isW(p) !== a.st.w) return -1;
  var m = uciToMove(a.st, t.uci), at = sq;
  if (sq === t.to) at = t.from;
  else if (m && m.castle) {
    var short_ = m.castle === 'O-O';
    if (sq === t.to + (short_ ? -1 : 1)) at = t.to + (short_ ? 1 : -2);
  }
  var q = a.st.b[at];
  return q && isW(q) === a.st.w ? at : -1;
}
/* Try again: the try leaves the board and the card asks again from the
   position before it (a forcing line keeps the moves already found). The
   model part runs first for anything pressed while a try is shown. The bar
   changes under the thumb here, so its buttons wait out tooSoon */
function clearTry(a) {
  engineStop('check');
  a.barAt = Date.now();
  a.phase = 'guess';
  a.tried = null;
  a.ghostMove = null;
  a.verdict = null;
  a.sel = -1;
}
function tryAgain(sel) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'tried') return;
  clearTry(a);
  /* a tap on a piece took it back: that piece is picked up */
  if (sel != null && sel >= 0) { a.sel = sel; snd('tap'); }
  renderCard();
}
/* See it: their reply to the try, one move, played on the player's tap */
function seeIt() {
  var a = ui.session && ui.session.active, t = a && a.tried;
  if (!t || a.phase !== 'tried' || !t.reply || t.seen) return;
  t.seen = true;
  /* the left button becomes help: a second tap of a double tap waits */
  a.barAt = Date.now();
  a.animMove = triedFrame(a).last;
  snd('move');
  renderCard();
}
/* the engine could not answer: the try stays where it is, and is not counted */
function cannotCheck(a, m) {
  a.checkTok = ++checkSeq;
  a.verdict = { cls: 'verdict-mid', html: 'Stockfish cannot check this move right now. Try again, or show the answer.' };
  showTry(a, m, 'unchecked', null);
}
/* ask the engine about a move, from the same position, at the same depth
   the best move was measured at */
var checkSeq = 0;
function checkMove(m, u, inLine) {
  var ss = ui.session, a = ss.active, it = a.it, b = it.b;
  /* no engine at all: the try is shown, never counted as a miss */
  if (SF.state === 'failed') { a.animMove = a.tapAnim; a.tapAnim = null; cannotCheck(a, m); return; }
  a.phase = 'checking';
  a.ghostMove = [m.from, m.to];
  a.checking = sanOf(a.st, m);
  /* the checking frame draws the move: it slides there, once */
  a.animMove = a.tapAnim; a.tapAnim = null;
  renderCard();
  var cardKey = a.key, fen = stateFen(a.st), sign = myPov(it) ? 1 : -1;
  /* one counter for every card: a check started before a pause can never
     answer a move played after the resume */
  var tok = a.checkTok = ++checkSeq;
  var live = function (a2) { return a2 && a2.key === cardKey && a2.phase === 'checking' && a2.checkTok === tok; };
  var timer = setTimeout(function () {
    var a2 = ui.session && ui.session.active;
    if (live(a2)) cannotCheck(a2, m);
  }, 9000);
  /* one search, two candidates: the tried move and the expected one are
     scored side by side, so depth noise cannot decide the verdict */
  var expect = inLine ? a.sol[a.solIdx] : a.bestUci;
  /* tagged, so Try again, Show the answer and leaving the card stop it */
  engineEval(fen, { nodes: inLine ? EXT_NODES : DEEP_NODES }, true,
             { searchmoves: expect && expect !== u ? [u, expect] : [u], multipv: expect && expect !== u ? 2 : 1, tag: 'check' }).then(function (r) {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (!live(a2)) return;
    a2.ghostMove = null;
    var mine = null, theirs = null;
    (r.lines || []).forEach(function (ln) {
      if (ln.pv && ln.pv[0] === u) mine = ln;
      else if (ln.pv && ln.pv[0] === expect) theirs = ln;
    });
    mine = mine || r;
    var myCp = mine.cp * sign, myMate = mine.mate != null ? mine.mate * sign : null;
    var wMove = winPct(myCp);
    var wBest = theirs ? winPct(theirs.cp * sign) : winPct(b.eb);
    if (wMove > wBest) wBest = wMove;
    r = mine;
    var mateCard = b.mb != null && b.mb > 0;
    var keepsMate = myMate != null && myMate > 0;
    /* a safe winning move passes, except on a missed chance, where the
       lesson is the tactic itself: there a lesser move is only "close" */
    var chances = familyOf(patternOf(b)).key === 'chances';
    var safeWin = wMove >= 70 && wBest >= 70 && wMove >= b.wa + 15 && !chances;
    var solvedIt = mateCard ? keepsMate
      : (wBest - wMove <= SOLVE_TOL || safeWin || keepsMate);
    if (solvedIt) {
      var cont = r.pv && r.pv[0] === u ? r.pv.slice(1) : (r.pv || []);
      var before = inLine ? a2.sol.slice(0, a2.solIdx) : [];
      a2.yours = { uci: before.concat([u], cont), cp: myCp, at: before.length };
      solved(m, u, { win: wMove, best: wBest, mate: myMate }, inLine);
      return;
    }
    var close = !inLine && (mateCard ? wMove >= 80 : ((wBest - wMove <= STRONGER_TOL || (chances && wMove >= 70)) && wMove >= b.wa + 10));
    if (close && a2.foundGood) {
      /* already told this kind of move is close: say it again, no penalty */
      a2.verdict = { cls: 'verdict-mid', html: '◐ ' + esc(sanOf(a2.st, m)) + ' is close too. The best move is stronger still.' };
      showTry(a2, m, 'close', null);
      return;
    }
    var stronger = close;
    if (stronger) {
      track('close_shown');
      a2.foundGood = { san: sanOf(a2.st, m), win: wMove };
      keepProgress(a2);
      a2.verdict = { cls: 'verdict-mid', html: '◐ ' + esc(a2.foundGood.san) + ' is close'
        + (mateCard ? ', but there is a forced mate here.' : a2.tier === 1 ? '. The best move keeps more. Keep looking.'
          : ': ' + Math.round(wMove) + '% against ' + Math.round(wBest) + '%. Keep looking.') };
      showTry(a2, m, 'close', null);
      return;
    }
    miss(m, u, { cp: myCp, mate: myMate, pv: r.pv || [], win: wMove });
  }, function () {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (live(a2)) cannotCheck(a2, m);
  });
}
/* a miss explains itself: the try stays on the board with one line of why,
   and the engine's reply to it is one tap away (See it) */
function miss(m, u, info) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  snd('bad');
  var why = '', san = sanOf(a.st, m);
  var reply = info && info.pv ? (info.pv[0] === u ? info.pv.slice(1) : info.pv) : [];
  if (info && info.pv && info.pv.length) {
    /* judged only on what the tried move allows: the card's own answer is
       never part of the verdict, or a miss would print the solution */
    var c = classifyMistake(a.st, u, { pv: [] }, { pv: reply, mate: info.mate }, winPct(it.b.eb), info.win, it.b.p);
    var concrete = c.mateAgainst || c.matGame <= -1;
    /* a wrong try is told in words at every level: the numbers belong to
       the close and the found states */
    why = concrete ? c.sentences.short.replace(/ \(\d+% to \d+%\)/g, '')
      : (info.win >= winPct(it.b.eb) - 10 ? san + ' does not lose anything, but there is something stronger here.'
        : 'After ' + san + ', ' + standingWords(info.win).replace(/^about level$/, 'it is about level') + '. There is something stronger here.');
  }
  why = why || san + ' does not work.';
  a.hintAfter = false;
  a.verdict = { cls: 'verdict-bad', html: esc(fitLine(['✗ ' + why, '✗ ' + firstClause(why), '✗ ' + san + ' does not work.'])) };
  escalate();
  showTry(a, m, 'miss', reply[0]);
}
function solved(m, u, alt, lineDone) {
  var ss = ui.session, a = ss.active;
  if (m) { applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.animMove = a.tapAnim || null; a.tapAnim = null; }
  a.alt = alt && u !== a.bestUci ? alt : null;
  var result = a.misses ? 'retry' : ((a.hints || a.foundGood) ? 'hint' : 'first');
  finishCard(result);
  snd('good');
}
function reveal() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase === 'done') return;
  /* pressed while a try is shown: the try goes first */
  if (a.phase === 'tried') clearTry(a);
  engineStop('check');
  a.revealed = true;
  a.st = cloneState(a.pre);
  /* found a close move and then asked for the best one: a hint, not a miss */
  if (a.foundGood && !a.misses && !ss_relearn(a)) (ui.session.notes = ui.session.notes || {})[a.key] = 'close';
  finishCard(a.foundGood && !a.misses ? 'hint' : 'fail');
}
/* a second tap on Next lands where Show the answer now sits: taps in the
   first half second of a card are the old card's. The same holds for half a
   second after the bar changes under the thumb (Try again, See it, a hint) */
function tooSoon(a) { return !!a && Date.now() - Math.max(a.shownAt || 0, a.barAt || 0) < 450; }
function giveHint() {
  var a = ui.session && ui.session.active;
  if (!a) return;
  /* pressed while a try is shown: the try goes first */
  var cleared = a.phase === 'tried';
  if (cleared) clearTry(a);
  if (a.phase !== 'guess' || a.hints >= 2 || (a.tier === 3 && !a.misses)) { if (cleared) renderCard(); return; }
  a.hints = a.hints + 1;
  a.hintAfter = true;
  a.barAt = Date.now();
  keepProgress(a);
  renderCard();
}
function hintText(a) {
  var t = patternOf(a.it.b), info = patternInfo(t), fam = familyOf(t), c = a.cls;
  /* inside a forcing line the hint is about this step, not the whole card */
  if (a.sol && a.solIdx > 0) {
    return checkedKingSq(a.st) != null ? 'You are in check. Find the square where your king is safe.'
      : 'Keep going: the next move is forcing too. Look at every check and capture.';
  }
  if (fam.key === 'chances') {
    var mt = c.missed;
    if (c.mateFor) return 'There is a forced mate. Look at every check.';
    /* the first hint names the prize, never the move */
    var prize = c.bestLine && !c.bestLine.unsettled ? (captureWord(c.bestLine, c.bSettle) || materialWord(c.matBest)) : '';
    if (a.hints < 2 && prize && c.matBest >= 1) return fitLine(['You can win ' + prize + ' here. Look at every check and capture.', 'You can win ' + prize + ' here.']);
    if (mt.fork && c.matBest >= 2) return mt.fork.ply === 1 ? 'There is a fork: one of your pieces can hit two targets.' : 'Your first move sets up a fork.';
    if (mt.pin && mt.pin.ply === 1 && mt.pin.piece !== 'P') return 'Look along the lines: something can be pinned.';
    if (t === 'missedMaterial') return 'Something of theirs is undefended. Can you take it?';
    return 'Look for checks, captures and threats: yours first.';
  }
  if (fam.key === 'conversion') return 'You are winning. Find the move that keeps it simple and safe.';
  var g = c.gameLine, n0 = g && g.nodes[0], r1 = g && g.nodes[1];
  if (!r1) return info.habit;
  /* a capture answered by a recapture on the same square: count first */
  if (n0.captured && r1.captured && r1.move.to === n0.move.to && !c.mateAgainst)
    return 'Before you capture on ' + sqName(n0.move.to) + ', count who defends it.';
  /* name the move the tactic turns on, else the first capture or check */
  var motif = { forkAllowed: c.allowed.fork, pinAllowed: c.allowed.pin, discoveredAllowed: c.allowed.discoveredAttack,
                promotion: c.allowed.promotion }[t];
  var k = motif && motif.ply >= 1 ? motif.ply - (motif.ply % 2 === 0 ? 1 : 0) : 0;
  if (!k && fam.key !== 'quiet') {
    for (var i = 1; i < g.nodes.length && i <= Math.max(1, c.gSettle); i += 2) {
      var n = g.nodes[i];
      if (n.captured || checkersOf(n.after).length) { k = i; break; }
    }
  }
  var key = (k && g.nodes[k]) || r1, word = { forkAllowed: ', a fork', pinAllowed: ', a pin', discoveredAllowed: ', a discovered attack' }[t] || '';
  var said = 'Your move allowed ' + sanOf(r1.before, r1.move) + (key !== r1 ? ', then ' + sanOf(key.before, key.move) : '') + word + '.';
  /* a reply on the answer's own square would give the answer away */
  var ans = a.best, hit = function (n) { return ans && n && n.move && n.move.to === ans.to; };
  if (hit(r1) || hit(key)) said = 'Your move allowed a strong reply' + word + '.';
  return fitLine([said + ' Find a move that stops it.', said]);
}
function finishCard(result) {
  var ss = ui.session, a = ss.active;
  a.phase = 'done';
  a.result = result;
  a.ms = Date.now() - a.t0;
  var relearn = ss.relearnOf && ss.relearnOf[a.key];
  if (ss.progress) delete ss.progress[a.key];
  if (!relearn) {
    var rec = srsRecord(a.it, result, { ms: a.ms, gameMove: a.triedGameMove, attempted: a.attempts > 0, alt: !!a.alt });
    if (a.attempts > 0) ss.attempted = (ss.attempted || 0) + 1;
    a.rec = rec;
    ss.results[a.key] = result;
    if ((result === 'fail' || result === 'retry') && (ss.relearn || []).length < 3) {
      ss.relearn = ss.relearn || [];
      ss.relearn.push(a.key);
      a.relearnQueued = true;
    }
  } else {
    a.rec = srsRec(a.it);
    ss.results[a.key + '#r'] = result;
  }
  a.lines = cardLines(a);
  a.invite = inviteFor(a);
  /* the habit line: every card for newer players, otherwise once a week
     per pattern (decided once here, not on every repaint) */
  var habitKey = 'nl:habitSeen:' + patternOf(a.it.b);
  a.showHabit = a.tier === 1 || Date.now() - store.get(habitKey, 0) > 7 * DAY;
  if (a.showHabit) store.set(habitKey, Date.now());
  /* the board keeps showing what was just played: the move found, the
     alternative that also works, or the end of the forcing line; a shown
     answer is its green arrow. Nothing plays by itself from here */
  if (a.revealed || result === 'fail') a.view = { line: 'best', idx: -1 };
  else if (a.alt && a.lines.yours && a.lines.yours.states.length) a.view = { line: 'yours', idx: Math.min(a.yours.at || 0, a.lines.yours.states.length - 1) };
  else a.view = { line: 'best', idx: Math.min(a.sol ? a.solIdx - 1 : 0, a.lines.best.states.length - 1) };
  saveSession();
  modelDirty();
  renderCard();
  renderHeader();
  track(result === 'first' ? 'solve_first' : 'solve_' + result);
}
/* missed cards come back once at the end, for the widest spacing */
function queueRelearn(ss) {
  if (!ss.relearn || !ss.relearn.length) return false;
  ss.relearnOf = ss.relearnOf || {};
  ss.relearn.forEach(function (k) { ss.keys.push(k); ss.relearnOf[k] = 1; });
  ss.relearn = [];
  return true;
}
function nextCard() {
  var ss = ui.session;
  if (!ss) return;
  if (ss.active && ss.active.explore) exploreExit('silent');
  engineStop('check');
  ss.active = null;
  ss.idx++;
  saveSession();
  loadCard();
  setTimeout(autoScan, 400);
}
/* a card the player leaves before answering: untouched it is a free skip;
   after a miss it counts as missed, after only a hint as solved with help */
function settleLeft(a) {
  var ss = ui.session;
  if (!ss || !a || a.phase === 'done') return;
  var again = ss_relearn(a), result = a.misses ? 'fail' : (a.hints ? 'hint' : 'skip');
  if (!again) srsRecord(a.it, result, { attempted: a.attempts > 0, gameMove: a.triedGameMove });
  if (a.attempts > 0) ss.attempted = (ss.attempted || 0) + 1;
  if (ss.progress) delete ss.progress[a.key];
  ss.results[a.key + (again ? '#r' : '')] = result;
  if (!again) (ss.notes = ss.notes || {})[a.key] = 'left';
  a.phase = 'done';
}
function skipCard() {
  var ss = ui.session, a = ss && ss.active;
  if (!a) return;
  settleLeft(a);
  nextCard();
}
/* "not a real mistake": the card leaves the queue and the statistics */
function disputeCard(reason) {
  var ss = ui.session, a = ss && ss.active;
  if (!a) return;
  a.it.b.x = 'user:' + reason;
  srsHide(a.it);
  modelDirty();
  saveGames(data.games);
  notice('Removed. It won\'t come back or count in your stats.');
  if (a.phase !== 'done') ss.results[a.key + (ss_relearn(a) ? '#r' : '')] = 'skip';
  nextCard();
}

/* ── after answering: stepping through the lines ────────────────────────── */
function lineView(a) {
  var v = a.view || { line: 'best', idx: -1 };
  var L = a.lines && a.lines[v.line];
  if (!L || !L.states.length) return { st: a.pre, last: a.preLast, ev: a.it.b.eb };
  if (v.idx < 0) return { st: a.pre, last: a.preLast, ev: a.it.b.eb };
  var i = Math.min(v.idx, L.states.length - 1);
  return { st: L.states[i], last: [L.moves[i].from, L.moves[i].to], ev: L.ev[i] != null ? L.ev[i] : a.it.b.eb };
}
function stepView(d) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || !a.lines) return;
  if (a.explore) { exploreStep(d); return; }
  var L = a.lines[a.view.line];
  if (!L) return;
  a.view.idx = Math.max(-1, Math.min(L.states.length - 1, a.view.idx + d));
  if (d > 0) snd('move');
  renderCard();
}

