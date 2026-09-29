/* ── The card: one mistake, retried ─────────────────────────────────────────
   Phases: 'loading' (the deeper look) -> 'guess' -> 'checking' (a move is
   being graded) -> 'guess' again after a miss, or 'reply' (the opponent's
   answer inside a forcing line) -> 'done' (the why). */

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
    a.animMove = a.lastMove;
    a.preLast = a.lastMove;
  }
  /* the settled lengths of both lines, and a forcing-line task for players
     who should see the whole combination, not just its first move */
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
  /* the blunder check: on first sight of a card where the move gave
     something away or opened the king, and the punishment starts with a
     capture or a check, the player first plays the opponent's reply */
  var fam0 = familyOf(patternOf(b)).key, ru0 = unpackUci(b.ru)[0];
  if (a.firstSight && !kept && ru0 && (fam0 === 'safety' || fam0 === 'king')) {
    var post = cloneState(pre);
    applyMove(post, a.played);
    var r0 = uciToMove(post, ru0);
    if (r0) {
      var cap = post.b[r0.to] != null || r0.ep >= 0, afterR = cloneState(post);
      applyMove(afterR, r0);
      var chk = checkedKingSq(afterR) != null;
      if (cap || chk) {
        a.check1 = { uci: ru0, reply: r0, san: sanOf(post, r0), capture: cap, check: chk };
        a.phase = 'check';
        a.st = post;
        a.lastMove = [a.played.from, a.played.to];
        a.animMove = null;
      }
    }
  }
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
  if (!a || (a.phase !== 'guess' && a.phase !== 'check') || a.pendingPromo) {
    if (a && a.phase === 'done' && a.explore) exploreClick(sq);
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
  if (m) gradeMove(m); else renderCard();
}

function gradeMove(m) {
  var ss = ui.session, a = ss.active;
  var u = moveUci(m);
  a.sel = -1;
  a.shapes = [];
  a.verdict = null; a.hintAfter = false;
  a.strongerOffer = false;
  a.attempts++;
  store.set('nl:marksSeen', true);
  /* the slide is kept until the move is actually drawn: a replayed game
     move or a refused one is never animated */
  a.tapAnim = a.tapped ? [m.from, m.to] : null;
  a.animMove = null;
  a.tapped = false;
  if (a.phase === 'check') { checkStep(m, u); return; }
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
/* the blunder check, graded without the engine: the stored reply, or any
   capture on the same square, is what the move allowed. One question per
   showing: found or not, the card is then answered, with the better move as
   a worked example; the fix is asked when the card comes back */
function checkStep(m, u) {
  var a = ui.session.active, c1 = a.check1, ss = ui.session;
  var found = !!m && (u === c1.uci || (c1.capture && m.to === c1.reply.to && a.st.b[m.to] != null));
  var san = m ? sanOf(a.st, m) : '';
  c1.found = found;
  ss.checks = (ss.checks || 0) + 1;
  if (found) ss.checksFound = (ss.checksFound || 0) + 1;
  /* the recap's tally is the day's, across every session */
  var dy = dayLoad();
  dy.checks = (dy.checks || 0) + 1;
  if (found) dy.checksFound = (dy.checksFound || 0) + 1;
  daySave(dy);
  if (found) {
    c1.played = san;
    a.checkVerdict = '✓ ' + esc(san) + '. That is what your move allowed.';
    snd('good');
  } else {
    a.checkVerdict = '✗ ' + (a.it.g.color === 'white' ? 'Black' : 'White') + ' had ' + esc(c1.san) + '.';
    snd('bad');
  }
  track((found ? 'check_first_t' : 'check_miss_t') + a.tier);
  /* the answered view starts from the position before the mistake */
  a.st = cloneState(a.pre);
  a.lastMove = a.preLast;
  a.animMove = null;
  a.check1.done = true;
  if (!found) a.revealed = true;
  finishCard(found ? 'first' : 'fail');
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
  a.verdict = { cls: 'verdict-good', html: '✓ ' + esc(san) + '. Move ' + (Math.floor(a.solIdx / 2) + 1) + ' of ' + Math.ceil(a.sol.length / 2) + ': now finish it.', panel: '✓ ' + esc(san) + '.' };
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
/* the tried move is the game move: show why it failed, then try again */
function sameAsGame(m) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  a.triedGameMove = true;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  snd('bad');
  var line = [a.playedUci].concat(unpackUci(it.b.ru).slice(0, 2));
  /* the card's own sentence, unless it would name the answer */
  var said = (a.cls.sentences.short || a.cls.sentences.game).replace(/^\S+\s/, 'It ');
  var bestSan = sanOf(a.pre, a.best);
  if (said.indexOf(bestSan) >= 0 || familyOf(patternOf(it.b)).key === 'chances') said = 'There is something stronger here.';
  a.lastTry = sanOf(a.pre, a.played);
  a.hintAfter = false;
  a.verdict = { cls: 'verdict-bad', html: esc(fitLine(['✗ Your game move again. ' + said, '✗ Your game move again. ' + firstClause(said), '✗ Your game move again.'])) };
  escalate(line);
}
/* misses and hints outlive a reload, so a retry is never scored first-try */
function keepProgress(a) {
  var ss = ui.session;
  if (!ss || !a) return;
  ss.progress = ss.progress || {};
  ss.progress[a.key] = { m: a.misses, h: a.hints, g: a.triedGameMove ? 1 : 0, f: a.foundGood || null, a: a.attempts };
  saveSession();
}
/* the second miss brings the first hint; the third shows the answer */
function escalate(line) {
  var a = ui.session.active;
  keepProgress(a);
  if (a.misses >= 3) { a.thirdMiss = true; reveal(); return; }
  if (a.misses === 2 && !a.hints) a.hints = 1;
  playPunish(line, a.misses);
}
/* ask the engine about a move, from the same position, at the same depth
   the best move was measured at */
function checkMove(m, u, inLine) {
  var ss = ui.session, a = ss.active, it = a.it, b = it.b;
  if (SF.state === 'failed') { miss(m, u, null); return; }
  a.phase = 'checking';
  a.ghostMove = [m.from, m.to];
  a.checking = sanOf(a.st, m);
  /* the checking frame draws the move: it slides there, once */
  a.animMove = a.tapAnim; a.tapAnim = null;
  renderCard();
  var cardKey = a.key, fen = stateFen(a.st), sign = myPov(it) ? 1 : -1;
  var tok = a.checkTok = (a.checkTok || 0) + 1;
  var live = function (a2) { return a2 && a2.key === cardKey && a2.phase === 'checking' && a2.checkTok === tok; };
  var timer = setTimeout(function () {
    var a2 = ui.session && ui.session.active;
    if (live(a2)) {
      a2.checkTok++;
      a2.phase = 'guess';
      a2.ghostMove = null;
      a2.verdict = { cls: 'verdict-mid', html: 'Stockfish cannot check this move right now. Try again, or show the answer.' };
      renderCard();
    }
  }, 9000);
  /* one search, two candidates: the tried move and the expected one are
     scored side by side, so depth noise cannot decide the verdict */
  var expect = inLine ? a.sol[a.solIdx] : a.bestUci;
  engineEval(fen, { nodes: inLine ? EXT_NODES : DEEP_NODES }, true,
             { searchmoves: expect && expect !== u ? [u, expect] : [u], multipv: expect && expect !== u ? 2 : 1 }).then(function (r) {
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
      a2.phase = 'guess';
      a2.verdict = { cls: 'verdict-mid', html: '◐ ' + esc(sanOf(a2.st, m)) + ' is close too. The best move is stronger still.' };
      a2.strongerOffer = true;
      renderCard();
      return;
    }
    var stronger = close;
    if (stronger) {
      track('close_shown');
      a2.foundGood = { san: sanOf(a2.st, m), win: wMove };
      keepProgress(a2);
      a2.phase = 'guess';
      a2.verdict = { cls: 'verdict-mid', html: '◐ ' + esc(a2.foundGood.san) + ' is close'
        + (mateCard ? ', but there is a forced mate here.' : a2.tier === 1 ? '. The best move keeps more. Keep looking.'
          : ': ' + Math.round(wMove) + '% against ' + Math.round(wBest) + '%. Keep looking.') };
      a2.strongerOffer = true;
      renderCard();
      return;
    }
    miss(m, u, { cp: myCp, mate: myMate, pv: r.pv || [], win: wMove });
  }, function () {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (!live(a2)) return;
    a2.phase = 'guess';
    a2.ghostMove = null;
    a2.verdict = { cls: 'verdict-mid', html: 'Stockfish cannot check this move right now. Try again, or show the answer.' };
    renderCard();
  });
}
/* a miss explains itself: the engine's punishment is played on the board
   with one line of why, then the position resets */
function miss(m, u, info) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  snd('bad');
  var line = [u].concat(info && info.pv ? info.pv.slice(u === (info.pv[0] || '') ? 1 : 0, (u === info.pv[0] ? 3 : 2)) : []);
  var why = '', san = sanOf(a.st, m);
  if (info && info.pv && info.pv.length) {
    /* judged only on what the tried move allows: the card's own answer is
       never part of the verdict, or a miss would print the solution */
    var reply = info.pv[0] === u ? info.pv.slice(1) : info.pv;
    var c = classifyMistake(a.st, u, { pv: [] }, { pv: reply, mate: info.mate }, winPct(it.b.eb), info.win, it.b.p);
    var concrete = c.mateAgainst || c.matGame <= -1;
    /* a wrong try is told in words at every level: the numbers belong to
       the close and the found states */
    why = concrete ? c.sentences.short.replace(/ \(\d+% to \d+%\)/g, '')
      : (info.win >= winPct(it.b.eb) - 10 ? san + ' does not lose anything, but there is something stronger here.'
        : 'After ' + san + ' ' + standingWords(info.win) + '. There is something stronger here.');
  }
  why = why || san + ' does not work.';
  a.lastTry = san;
  a.hintAfter = false;
  a.verdict = { cls: 'verdict-bad', html: esc(fitLine(['✗ ' + why, '✗ ' + firstClause(why), '✗ ' + san + ' does not work.'])) };
  escalate(line);
}
/* show a line of moves from the current position, then put the board back */
function playPunish(ucis, missNo) {
  var a = ui.session.active, cardKey = a.key;
  var base = cloneState(a.st), lastMove = a.lastMove;
  a.phase = 'punish';
  var played = playUci(base, ucis);
  var i = 0;
  var step = function () {
    var a2 = ui.session && ui.session.active;
    if (!a2 || a2.key !== cardKey) return;
    if (i < played.states.length) {
      a2.st = played.states[i];
      a2.lastMove = [played.moves[i].from, played.moves[i].to];
      a2.animMove = a2.lastMove;
      i++;
      snd(i === 1 ? 'tap' : 'move');
      renderCard();
      setTimeout(step, i === 1 ? 500 : 700);
      return;
    }
    setTimeout(function () {
      var a3 = ui.session && ui.session.active;
      if (!a3 || a3.key !== cardKey) return;
      a3.st = base;
      a3.lastMove = lastMove;
      a3.animMove = null;
      a3.phase = 'guess';
      /* the second miss brought the first hint: once the replay is over it
         takes the phone's line */
      if (missNo === 2 && a3.hints) a3.hintAfter = true;
      renderCard();
    }, 900);
  };
  renderCard();
  setTimeout(step, 250);
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
  a.revealed = true;
  a.st = cloneState(a.pre);
  /* found a close move and then asked for the best one: a hint, not a miss */
  if (a.foundGood && !a.misses) (ui.session.notes = ui.session.notes || {})[a.key] = 'close';
  finishCard(a.foundGood && !a.misses ? 'hint' : 'fail');
}
/* a second tap on Next lands where Show the answer now sits: taps in the
   first half second of a card are the old card's */
function tooSoon(a) { return !!a && Date.now() - (a.shownAt || 0) < 450; }
function giveHint() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'guess' || a.hints >= 2 || (a.tier === 3 && !a.misses)) return;
  a.hints = a.hints + 1;
  a.hintAfter = true;
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
    if ((result === 'fail' || result === 'retry') && !a.check1 && (ss.relearn || []).length < 3) {
      ss.relearn = ss.relearn || [];
      ss.relearn.push(a.key);
      a.relearnQueued = true;
    }
  } else {
    a.rec = srsRec(a.it);
    ss.results[a.key + '#r'] = result;
  }
  a.lines = cardLines(a);
  /* the habit line: every card for newer players, otherwise once a week
     per pattern (decided once here, not on every repaint) */
  var habitKey = 'nl:habitSeen:' + patternOf(a.it.b);
  a.showHabit = a.tier === 1 || Date.now() - store.get(habitKey, 0) > 7 * DAY;
  if (a.showHabit) store.set(habitKey, Date.now());
  /* the board keeps showing what was just played: the move found, the
     alternative that also works, or the end of the forcing line */
  if (a.revealed || result === 'fail') a.view = { line: 'refute', idx: -1 };
  else if (a.check1 && a.check1.done) a.view = { line: 'best', idx: -1 };
  else if (a.alt && a.lines.yours && a.lines.yours.states.length) a.view = { line: 'yours', idx: Math.min(a.yours.at || 0, a.lines.yours.states.length - 1) };
  else a.view = { line: 'best', idx: Math.min(a.sol ? a.solIdx - 1 : 0, a.lines.best.states.length - 1) };
  saveSession();
  modelDirty();
  renderCard();
  renderHeader();
  /* the why, played out: after a reveal, what the game move allowed and
     then the answer; after a solve, the answer's next moves up to the
     point where it pays off */
  var toPayoff = function () {
    var a2 = ui.session && ui.session.active;
    if (!a2 || a2.key !== a.key) return;
    var key = a2.view.line, L = a2.lines[key];
    if (!L) return;
    var endIdx = Math.min(L.states.length - 1, Math.max(2, key !== 'best' ? 2 : a2.cls && a2.cls.mateFor ? L.states.length - 1 : (a2.settleBest || 2)));
    var from = Math.max(0, a2.view.idx + 1);
    if (endIdx >= from) autoplayLine(key, null, from, endIdx - from + 1);
  };
  if (a.revealed || result === 'fail') {
    autoplayLine('refute', function () { a.view = { line: 'best', idx: -1 }; renderCard(); setTimeout(toPayoff, 300); }, 0, 3);
  } else setTimeout(function () { if (a.autoTok == null) toPayoff(); }, 900);
  track(result === 'first' ? 'solve_first' : 'solve_' + result);
}
/* any hand on the lines stops an autoplay */
function stopAuto(a) { if (a) a.autoTok = (a.autoTok || 0) + 1; }
function autoplayLine(key, then, from, count) {
  var a = ui.session && ui.session.active, cardKey = a && a.key;
  if (!a || !a.lines || !a.lines[key]) { if (then) then(); return; }
  var L = a.lines[key], i = from || 0, end = Math.min(L.states.length, i + (count || 3));
  stopAuto(a);
  var tok = a.autoTok;
  a.view = { line: key, idx: i - 1 };
  /* reduced motion: nothing plays by itself; the arrows step the line */
  if (reducedMotion()) { renderCard(); if (then) then(); return; }
  var step = function () {
    var a2 = ui.session && ui.session.active;
    if (!a2 || a2.key !== cardKey || a2.autoTok !== tok || a2.phase !== 'done') return;
    if (i < end) { a2.view.idx = i; i++; snd('move'); renderCard(); setTimeout(step, 700); return; }
    if (then) setTimeout(function () { if (a2.autoTok === tok) then(); }, 900);
  };
  renderCard();
  /* from the start, the arrow shows first */
  setTimeout(step, i === 0 ? 900 : 400);
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
  var L = a.lines[a.view.line];
  if (!L) return;
  a.explore = null;
  stopAuto(a);
  a.view.idx = Math.max(-1, Math.min(L.states.length - 1, a.view.idx + d));
  if (d > 0) snd('move');
  renderCard();
}
/* after the answer, the board is free: try your own ideas, the bar follows */
function exploreClick(sq) {
  var a = ui.session.active, ex = a.explore;
  var p = ex.st.b[sq];
  if (p && isW(p) === ex.st.w) { ex.sel = ex.sel === sq ? -1 : sq; renderCard(); return; }
  if (ex.sel < 0) return;
  var legal = legalMoves(ex.st).filter(function (m) { return m.from === ex.sel && m.to === sq; });
  ex.sel = -1;
  if (!legal.length) { renderCard(); return; }
  var m = legal[0];
  ex.san.push(sanOf(ex.st, m));
  applyMove(ex.st, m);
  ex.last = [m.from, m.to];
  ex.anim = pointerState.suppressClick ? null : [m.from, m.to];
  ex.ev = null;
  ex.reply = null;
  snd('move');
  renderCard();
  var cardKey = a.key, fen = stateFen(ex.st);
  engineEvalCached(fen, { nodes: EXT_NODES }, true).then(function (r) {
    var a2 = ui.session && ui.session.active;
    if (!a2 || a2.key !== cardKey || !a2.explore || stateFen(a2.explore.st) !== fen) return;
    a2.explore.ev = r.cp * (myPov(a2.it) ? 1 : -1);
    a2.explore.reply = r.bestUci;
    /* a cached answer arrives at once: let the slide finish first */
    setTimeout(renderCard, 260);
  }, function () {});
}
function startExplore() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done') return;
  var v = lineView(a);
  a.explore = { st: cloneState(v.st), sel: -1, san: [], last: v.last, ev: v.ev };
  renderCard();
}

