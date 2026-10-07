/* ── The card: one mistake, retried ─────────────────────────────────────────
   Phases: 'loading' (the deeper look) -> 'guess' -> 'checking' (a move is
   being graded) -> 'tried' (the try stays on the board: a miss, a close
   move, or one the engine could not check) -> 'guess' again on Try again,
   or 'reply' (the opponent's answer inside a forcing line) -> 'done' (the
   why). A move still being checked can be taken back, ungraded. Nothing on
   the board moves without a tap, except that reply. */

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
  if (kept) { a.misses = kept.m || 0; a.hints = kept.h || 0; a.triedGameMove = !!kept.g; a.foundGood = kept.f || null; a.attempts = kept.a || 0; a.predraw = !!kept.p; }
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
  /* the card's own position, as exploring keys positions */
  a.preKey = posKey(pre);
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
    if (workedExample(a)) keepProgress(a);
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
  /* input first; dropped while the forcing reply slides */
  if (flushStage()) return;
  var ss = ui.session, a = ss && ss.active;
  if (!a || a.pendingPromo) return;
  if (a.phase === 'checking') {
    /* a move being checked: a tap on it takes it back (S3); a piece of
       theirs says which side you are (T4, under the check's own row 1); any
       other piece of yours only says this is not a move here */
    var back = checkingPick(a, sq), cp = checkingFrame(a).b[sq];
    if (back >= 0) takeBack(back);
    else if (cp && isW(cp) !== a.st.w) tapNote(a, 'T4', 2500, sq);
    else if (cp) nopeAt(a, sq);
    return;
  }
  if (a.phase === 'tried') {
    /* a try on the board: a tap on one of your pieces takes it back and
       picks that piece up; a tap on one of theirs says which side you are */
    var pick = triedPick(a, sq), tp = triedFrame(a).st.b[sq];
    if (pick >= 0) tryAgain(pick);
    else if (tp && isW(tp) !== a.st.w) tapNote(a, 'T4', 2500, sq);
    return;
  }
  if (a.phase === 'done') {
    if (a.explore) { exploreClick(sq); return; }
    /* the answer shown takes that one move, by hand (S7): its piece picks
       up, its square plays it, anything else puts it down */
    var due = !a.showWait ? showDue(a) : null;
    if (due && (sq === due.from || a.sel === due.from)) {
      if (sq === due.from) { a.sel = a.sel === sq ? -1 : sq; if (a.sel >= 0) snd('tap'); renderCardBoard(); }
      else if (sq === due.to) playIt(pointerState.suppressClick, true);
      else { a.sel = -1; renderCardBoard(); }
      return;
    }
    if (a.sel >= 0) { a.sel = -1; renderCardBoard(); }
    /* after an answer the board takes no moves: a tap on any piece says
       where to try them (N1), and nothing changes; with the engine down
       there is nowhere to try them (S11), so the outline answers alone */
    if (doneBoard(a).b[sq]) { if (SF.state === 'failed') nopeAt(a, sq); else tapNote(a, 'N1', 2500, sq); }
    return;
  }
  if (a.phase !== 'guess') return;
  var p = a.st.b[sq];
  /* a selection changes the board alone: the words stay */
  if (p && isW(p) === a.st.w) {
    /* a piece dragged onto another of yours snaps back and says so (T5);
       a tap there picks that piece up instead */
    if (pointerState.suppressClick && a.sel >= 0 && a.sel !== sq) { a.sel = -1; renderCardBoard(); tapNote(a, 'T5', 2000, null); return; }
    a.sel = a.sel === sq ? -1 : sq;
    snd('tap');
    renderCardBoard();
    return;
  }
  /* a piece of theirs, with nothing picked up: not a move, never graded,
     and the band says which side you are (T4) */
  if (a.sel < 0) { if (p) tapNote(a, 'T4', 2500, sq); return; }
  var legal = legalMoves(a.st).filter(function (m) { return m.from === a.sel && m.to === sq; });
  if (!legal.length) {
    /* a piece dragged where it cannot go snaps back and says so (T5); a
       tap there puts the piece down, and a tap on a piece of theirs says
       which side you are too (T4) */
    var dropped = pointerState.suppressClick;
    a.sel = -1;
    renderCardBoard();
    if (dropped) tapNote(a, 'T5', 2000, null);
    else if (p && isW(p) !== a.st.w) tapNote(a, 'T4', 2500, sq);
    return;
  }
  if (legal.length > 1 && legal[0].promo) { a.pendingPromo = { moves: legal, to: sq }; renderCard(); return; }
  /* a tapped move slides into place; a dragged one is already where it was dropped */
  a.tapped = !pointerState.suppressClick;
  gradeMove(legal[0]);
}
/* a tap that is not a move (S2): the square tapped gets the grey outline
   for 600 ms, and row 2 says why for a while (T4, T5, N1, ms long); nothing
   is graded and nothing else changes. Both belong to what the card shows
   now (cardStateKey), so a move, a hint or Try again ends them at once */
var noteSeq = 0;
function tapNote(a, id, ms, sq) {
  var seq = ++noteSeq;
  if (sq != null) nopeAt(a, sq);
  a.note = { id: id, key: cardStateKey(a), seq: seq };
  /* over the word budget even in its short form, the outline answers alone
     (in the story the word takes the strip, beside the step's caption) */
  var story = a.phase === 'done' && a.view && a.view.mode === 'story';
  if (story ? bandWords(bandFor(a), barSlots(a, ui.session)) + stripWords(a) > WORD_BUDGET : !bandFor(a).row2) { a.note = null; return; }
  /* the words come after the outline, and go back after ms */
  stage([TEXT_GAP, 'text']);
  stageAt(TEXT_GAP + ms, function (a2) { if (a2.note && a2.note.seq === seq) { a2.note = null; stage(['text']); } });
}
function nopeAt(a, sq) {
  var seq = ++noteSeq;
  a.nope = { sq: sq, key: cardStateKey(a), seq: seq };
  stage(['marks']);
  stageAt(600, function (a2) { if (a2.nope && a2.nope.seq === seq) { a2.nope = null; stage(['marks']); } });
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
  /* each move tried has its own effect id, so its badge pops once */
  a.fxn = (a.fxn || 0) + 1;
  /* the slide is kept until the move is actually drawn: a refused one is
     never animated */
  a.tapAnim = a.tapped ? [m.from, m.to] : null;
  a.animMove = null;
  a.tapped = false;
  /* their reply's marks stay only until your next move */
  a.replyMark = null;
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
/* the forcing line, move by move (S10): your move found lands with its
   tick ("Right"), then their reply plays by itself on its timeline
   (replyClock); the line's last move is the solve */
function stepLine(m, u) {
  var a = ui.session.active;
  noteWon(a, m);
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.animMove = a.tapAnim || null; a.tapAnim = null;
  a.replyMark = null;
  a.solIdx++;
  /* the line's last move is the solve: its sound comes with its badge */
  if (a.solIdx >= a.sol.length) { solved(null, null, null, true); return; }
  var reply = uciToMove(a.st, a.sol[a.solIdx]);
  if (!reply) { solved(null, null, null, true); return; }
  a.phase = 'reply';
  a.hintAfter = false;
  /* the tick, the green tints and the sound land with the piece */
  a.cue = 'good';
  a.verdict = verdictOf('good', CARD_COPY.F1(), [CARD_COPY.F2(a)], '');
  var rm = reducedMotion(), lands = a.animMove && !rm ? SLIDE_LEAD + 220 : 0;
  startReply(a, reply, false);
  /* under reduced motion the reply waits for its button, which gets the keyboard */
  a.focusRight = rm;
  renderCard();
  replyClock(a, lands);
}
/* the forcing reply (S10), the one move that plays by itself, inside a
   forcing line being solved or shown (show: after Play it). a.reply:
   {uci, from, to, show, tele (its telegraph is drawn), played} */
function startReply(a, m, show) {
  a.reply = { uci: moveUci(m), from: m.from, to: m.to, show: !!show, tele: reducedMotion(), played: false };
}
/* its timeline, from t0, when the move before it lands (landIn ms from
   now): at 600 the telegraph (its piece ringed, a blue-grey dashed arrow),
   at 1500 the slide (400 ms, so it lands at 1900), at 2050 the words. The
   slide's board is drawn SLIDE_LEAD before the piece is let go, and a shown
   line's words fade out 100 ms before that (theirReply). Under reduced
   motion nothing runs: the telegraph is drawn at once and the reply waits
   for "Their reply ›" */
var REPLY_TELE = 600, REPLY_SLIDE = 1500;
function replyClock(a, landIn) {
  var rp = a.reply;
  if (!rp || reducedMotion()) return;
  stageAt(landIn + REPLY_TELE, function (a2) { if (a2.reply === rp && !rp.played) { rp.tele = true; stage(['marks']); } });
  stageAt(landIn + REPLY_SLIDE - SLIDE_LEAD - (rp.show ? TEXT_OUT : 0), function (a2) {
    if (a2.reply !== rp || rp.played) return;
    /* a tab in the background draws no frames: the piece would only jump.
       It waits, telegraphed, until the page is seen again (replyOnReturn) */
    if (document.hidden) rp.held = true;
    else theirReply(a2, false);
  });
}
/* back on the tab: a reply held while it was hidden plays now, sliding,
   and its words and pips follow it as usual */
function replyOnReturn() {
  var a = ui.session && ui.session.active, rp = a && a.reply;
  if (document.hidden || !rp || !rp.held || rp.played) return;
  rp.held = false;
  theirReply(a, false);
}
document.addEventListener('visibilitychange', replyOnReturn);
/* the reply plays: on its timeline, or now (early: an input before 1500
   starts it at once, its telegraph kept, flushStage; or its own button
   under reduced motion). It slides 400 ms with its sound, its ring and
   dashed arrow riding along; as it lands the arrow turns solid, what it
   took shows as a token and a check glows; 150 ms later (300 under reduced
   motion) the words, and the board takes moves again. Returns false when
   there is no reply to play */
function theirReply(a, early) {
  var rp = a && a.reply;
  if (!rp || rp.played) return false;
  var m = a.sol && a.sol[a.solIdx] === rp.uci ? uciToMove(a.st, rp.uci) : null;
  if (!m) { a.reply = null; return false; }
  var before = cloneState(a.st), took = m.ep >= 0 ? a.st.b[m.ep] : a.st.b[m.to];
  rp.played = true;
  rp.tele = true;
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.solIdx++;
  a.replyMark = { from: m.from, to: m.to, token: took ? { sq: m.ep >= 0 ? m.ep : m.to, p: took } : null, fx: a.key + ':rp' + a.solIdx };
  a.replySaid = replyWords(a, before, m, took);
  var next = a.solIdx < a.sol.length ? uciToMove(a.st, a.sol[a.solIdx]) : null;
  /* a shown line: the next move of yours is the answer now */
  if (rp.show) { a.markMove = null; if (next) a.answerSan = sanOf(a.st, next); }
  /* exploring has the board: the reply is played there unseen, and the
     frame exploring comes back to is the one it leads to */
  if (a.explore) {
    replyDone(a, rp);
    if (!next) { a.explore.root = { mode: 's0' }; a.settle = 0; a.settleFor = true; }
    return true;
  }
  var rm = reducedMotion();
  a.animMove = [m.from, m.to];
  a.animSlow = true;
  a.animShown = false;
  /* paintBoard holds its slide: no input jumps it (flushStage) */
  a.replySlide = true;
  a.moveCue = true;
  var fade = rp.show && !early && !rm ? ['fade', TEXT_OUT] : [];
  stage(fade.concat(['board', 'land', rm ? 300 : TEXT_GAP, { run: function (a2) { replyDone(a2, rp); } }, 'text']));
  return true;
}
/* the reply's words are due (2050): the card asks for your next move (a
   shown line offers Play it again) */
function replyDone(a, rp) {
  if (a.reply !== rp) return;
  a.reply = null;
  if (rp.show) {
    a.showWait = false;
    if (!(a.solIdx < a.sol.length)) settleShown(a);
    return;
  }
  a.phase = 'guess';
  a.verdict = null;
  /* the keyboard goes to the band's "Your move", not to the button that
     takes the place of the one it was on */
  a.focusTask = true;
}
/* the tried move is the game move: it stays on the board with why it
   failed, and their reply from the game is one tap away (See it) */
function sameAsGame(m) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  a.triedGameMove = true;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  /* the sound comes with the badge, once the move lands */
  a.cue = 'bad';
  /* why, from the card's own refutation (M2, never naming the answer); the
     reply that punishes it is marked when it captures or checks and loses
     something, except on a missed-chance card, whose lesson is elsewhere */
  var why = gameMoveWhy(a), c = a.cls;
  why.threat = (c.mateAgainst || c.lossG >= 1) && familyOf(patternOf(it.b)).key !== 'chances' ? threatOf(c.gameLine, 1) : null;
  a.hintAfter = false;
  escalate();
  /* a tapped game move slides in on this, its first frame */
  a.animMove = a.tapAnim; a.tapAnim = null;
  showTry(a, m, 'miss', unpackUci(it.b.ru)[0], why);
}
/* misses and hints outlive a reload, so a retry is never scored first-try */
function keepProgress(a) {
  var ss = ui.session;
  if (!ss || !a) return;
  ss.progress = ss.progress || {};
  ss.progress[a.key] = { m: a.misses, h: a.hints, g: a.triedGameMove ? 1 : 0, f: a.foundGood || null, a: a.attempts, p: a.predraw ? 1 : 0 };
  saveSession();
}
/* a miss is kept at once, and brings the first hint for players who need
   it: after one miss at tier 1, after two at tier 2, never at tier 3. The
   hint shows on Try again; no number of misses shows the answer */
function escalate() {
  var a = ui.session.active, autoAt = a.tier === 1 ? 1 : (a.tier === 2 ? 2 : 0);
  if (autoAt && a.misses >= autoAt && !a.hints) { a.hints = 1; a.hintAt = a.misses; }
  keepProgress(a);
}
/* a try stays where it landed until the player takes it back: a.st keeps
   the position before it, and the board draws the try over it (and their
   reply, once See it plays it). kind: 'miss', 'close' or 'unchecked'; why,
   a miss's reason (missWhy's ladder, and threat: the reply as threatOf
   gives it, when it is marked); again, a second close move. The verdict
   lands on the square (badge and tints), the band and the bar together, and
   the keyboard goes to the bar's right-hand button (S20); a miss's reason
   follows in two beats of its own, timed from when the verdict's words
   paint (a.reasonFor: paintText starts missReason) */
function showTry(a, m, kind, reply, why, again) {
  var after = cloneState(a.st);
  applyMove(after, m);
  var r = reply ? uciToMove(after, reply) : null, took = r ? (r.ep >= 0 ? after.b[r.ep] : after.b[r.to]) : null;
  a.phase = 'tried';
  a.ghostMove = null;
  /* lost: the piece their reply takes, shown as a token once See it plays it */
  a.tried = { from: m.from, to: m.to, uci: moveUci(m), san: sanOf(a.st, m), kind: kind,
              reply: r ? reply : null, seen: false, threat: (why && why.threat) || null, lost: took ? { sq: r.ep >= 0 ? r.ep : r.to, p: took } : null };
  a.verdict = triedVerdict(a, a.tried, why, again);
  a.reason = 0;
  a.focusRight = true;
  /* a wrong move is remembered for this showing of the card, at this step
     of a forcing line, and drawn faintly once the card asks again (the game
     move has its own red arrow) */
  if (kind === 'miss' && a.tried.uci !== a.playedUci) {
    a.wrong = (a.wrong || []).filter(function (w) { return !(w.uci === a.tried.uci && w.at === a.solIdx); });
    a.wrong.push({ from: m.from, to: m.to, uci: a.tried.uci, at: a.solIdx, fx: a.key + ':' + (a.fxn || 0) + 'tl' });
  }
  a.reasonFor = kind === 'miss' ? a.tried : null;
  renderCard();
}
/* a miss gives its reason in two more beats once its verdict is read (S4,
   principle 1): 600 ms after the verdict's words paint (paintText calls
   this then, so an input that moved those words moves the beats too) the
   piece that punishes the try, ringed, with a dashed arrow to what it
   takes; 150 ms after that the words (300 and 400 under reduced motion).
   a.reason counts them. See it before then plays that move instead of
   marking it; the words still come */
function missReason(a) {
  var t = a.tried, rm = reducedMotion();
  a.reasonFor = null;
  stageAt(rm ? 300 : 600, function (a2) {
    if (a2.tried !== t || a2.reason >= 1) return;
    a2.reason = 1;
    if (t.threat && !t.seen) stage(['marks']);
  });
  stageAt(rm ? 400 : 750, function (a2) {
    if (a2.tried !== t) return;
    a2.reason = 2;
    stage(['text']);
  });
}
/* the move at ply k of a line, when it captures or checks: the threat a
   dashed red arrow draws (FINAL-SPEC 2.1), from the attacker's square to
   where it lands, with what it takes; null for a quiet move */
function threatOf(line, k) {
  var n = line && line.nodes[k];
  if (!n || !n.move) return null;
  var check = checkersOf(n.after).length > 0;
  if (!n.captured && !check) return null;
  return { from: n.move.from, to: n.move.to, piece: n.piece, captured: n.captured ? pType(n.captured) : null,
           check: check, mate: check && !legalMoves(n.after).length, san: sanOf(n.before, n.move) };
}
/* the answer due now: the card's best move, or inside a forcing line the
   line's next move (FINAL-SPEC 2.3) */
function dueMove(a) { return (a.sol && a.solIdx > 0 && uciToMove(a.st, a.sol[a.solIdx])) || a.best; }
/* the wrong move tried last at this step, as the board draws it on the
   card's position: a faint line and a cross where it landed, one per frame
   (2.1); when it landed on the answer's square, the cross alone on the
   square it left (2.3) */
function triedMark(a) {
  var at = a.solIdx || 0, w = (a.wrong || []).filter(function (x) { return x.at === at; }).pop();
  if (!w) return null;
  return w.to === dueMove(a).to ? { sq: w.from, fx: w.fx } : { from: w.from, to: w.to, fx: w.fx };
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
/* the move being checked, as a move from the position before it */
function checkingMove(a) {
  var g = a.ghostMove;
  return g ? legalMoves(a.st).filter(function (m) { return m.from === g[0] && m.to === g[1]; })[0] || null : null;
}
/* what the board shows while a move is checked: the move made */
function checkingFrame(a) {
  var st = cloneState(a.st), m = checkingMove(a);
  if (m) applyMove(st, m);
  return st;
}
/* while a move is checked only that move answers a tap: the moved piece (a
   castled rook too) maps to where it came from; -1 for anything else */
function checkingPick(a, sq) {
  var m = checkingMove(a);
  if (!m) return -1;
  if (sq === m.to) return m.from;
  if (m.castle) {
    var short_ = m.castle === 'O-O';
    if (sq === m.to + (short_ ? -1 : 1)) return m.to + (short_ ? 1 : -2);
  }
  return -1;
}
/* Try again: the try leaves the board and the card asks again from the
   position before it (a forcing line keeps the moves already found). The
   model part runs first for anything pressed while a try is shown */
function clearTry(a) {
  engineStop('check');
  a.phase = 'guess';
  a.tried = null;
  a.ghostMove = null;
  a.verdict = null;
  a.reason = 0;
  a.reasonFor = null;
  a.sel = -1;
  /* back to another position: the board crossfades (2.2) */
  a.jump = true;
  holdMarks(a);
}
/* back on the card's position after a crossfade: the wrong move just taken
   back stays as a faint line (S4), and a hint (one drawn before, or the
   automatic one this miss brought, or one pressed over the try) shows its
   marks; both are drawn once the crossfade is over: the board, then those
   marks, then the words. Run again once a hint is added */
function holdMarks(a) {
  var hm = hintMarks(a), hold = (!!triedMark(a) || hm.rings.length + hm.arrows.length > 0) && !reducedMotion();
  if (hold && !a.triedHold) stageAt(XFADE, function (a2) { if (a2.triedHold) { a2.triedHold = false; stage(['marks']); } });
  a.triedHold = hold;
}
/* Take back (S3): the move being checked leaves the board, ungraded. The
   search stops and its answer is ignored (a new token), the attempt is
   undone, and a tap on the moved piece picks it up from where it came */
function takeBack(sel) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'checking') return;
  dropCheck(a);
  a.sel = sel != null && sel >= 0 ? sel : -1;
  if (a.sel >= 0) snd('tap');
  renderCard();
}
/* the model part of Take back, also run first by Hint and Show the answer
   pressed while the guess bar still shows them over a move being checked
   (before K1): the board crossfades back to the position before it */
function dropCheck(a) {
  engineStop('check');
  a.checkTok = ++checkSeq;
  if (a.attempts > 0) a.attempts--;
  a.phase = 'guess';
  a.ghostMove = null;
  a.checking = null;
  a.checkSaid = 0;
  a.jump = true;
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
  /* the reason's ring and arrow ride the slide only if already drawn */
  t.ringed = a.reason >= 1;
  /* the words about to change (the bar's See it) fade out first (2.2), then
     it slides as a move the app shows, its sound as it starts, along the
     reason's arrow; as it lands the ring and arrow go and what it took
     comes (a token). The bar changes after that */
  a.animMove = triedFrame(a).last;
  a.moveCue = true;
  renderCard(['fade', reducedMotion() ? 0 : TEXT_OUT, 'board', 'land', 'text']);
}
/* the engine could not answer: the try stays where it is, and is not counted */
function cannotCheck(a, m) {
  a.checkTok = ++checkSeq;
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
  a.checkSaid = 0;
  /* the checking frame draws the move: it slides there, once */
  a.animMove = a.tapAnim; a.tapAnim = null;
  renderCard();
  var cardKey = a.key, fen = stateFen(a.st), sign = myPov(it) ? 1 : -1;
  /* one counter for every card: a check started before a pause can never
     answer a move played after the resume */
  var tok = a.checkTok = ++checkSeq;
  var live = function (a2) { return a2 && a2.key === cardKey && a2.phase === 'checking' && a2.checkTok === tok; };
  /* the band says nothing for 300 ms after the move lands (most answers
     come sooner), then that the move is being checked, and at 3 s that it
     still is (K1, K2) */
  var land = Math.max(0, motionUntil - Date.now());
  [[300, 1], [3000, 2]].forEach(function (k) {
    stageAt(land + k[0], function (a2) { if (live(a2)) { a2.checkSaid = k[1]; stage(['text']); } });
  });
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
    if (closeTry(b, wMove, wBest, mateCard, chances, inLine)) {
      /* a good move that is not the best: not a miss (S5). The first one is
         remembered, so a later solve or the answer counts as help; a second
         says row 1 alone */
      var again = !!a2.foundGood;
      if (!again) {
        track('close_shown');
        a2.foundGood = { san: sanOf(a2.st, m), win: wMove };
        keepProgress(a2);
      }
      a2.cue = 'tap';
      showTry(a2, m, 'close', null, null, again);
      return;
    }
    miss(m, u, { cp: myCp, mate: myMate, pv: r.pv || [], win: wMove }, inLine);
  }, function () {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (live(a2)) cannotCheck(a2, m);
  });
}
/* the close rule (S5), the one path for a good move that is not the best:
   a move that loses nothing by the card's own measure (within STRONGER_TOL
   of b.eb; every card's game move lost more than that, so it is always
   better than the game move); or one within STRONGER_TOL of the best move
   in this search, or on a missed chance one that keeps a big edge, when it
   is clearly better than the game move; on a mate card a move that still
   wins big. Never inside a forcing line */
function closeTry(b, wMove, wBest, mateCard, chances, inLine) {
  if (inLine) return false;
  if (mateCard) return wMove >= 80;
  if (wMove >= winPct(b.eb) - STRONGER_TOL) return true;
  return (wBest - wMove <= STRONGER_TOL || (chances && wMove >= 70)) && wMove >= b.wa + 10;
}
/* a miss explains itself: the try stays on the board with one line of why,
   and the engine's reply to it is one tap away (See it). inLine: the try
   was a step of a forcing line */
function miss(m, u, info, inLine) {
  var a = ui.session.active, it = a.it;
  a.misses++;
  if (a.misses === 1) a.runBroke = srsNoteMiss(it) > 0;
  /* the sound comes with the badge */
  a.cue = 'bad';
  var reply = info && info.pv ? (info.pv[0] === u ? info.pv.slice(1) : info.pv) : [];
  /* judged only on what the tried move allows: the card's own answer is
     never part of the verdict, or a miss would print the solution */
  var c = info && info.pv && info.pv.length ? classifyMistake(a.st, u, { pv: [] }, { pv: reply, mate: info.mate }, winPct(it.b.eb), info.win, it.b.p) : null;
  var concrete = !!c && !!(c.mateAgainst || c.lossG >= 1), r1 = c && c.gameLine && c.gameLine.nodes[1];
  /* a wrong try is told in words at every level (M3). One that loses
     nothing is a close move outside a forcing line (closeTry), never a
     miss; inside one it is still a miss, and says so honestly */
  var why = missWhy(a, c, info ? info.win : null, r1 ? sanOf(r1.before, r1.move) : null,
                    !!inLine && !concrete && !!info && info.win >= winPct(it.b.eb) - STRONGER_TOL);
  /* the reply that punishes it is marked when it captures or checks and
     the try loses something by it */
  why.threat = concrete ? threatOf(c.gameLine, 1) : null;
  a.hintAfter = false;
  escalate();
  showTry(a, m, 'miss', reply[0], why);
}
/* a capture of yours inside a forcing line, kept for the settled board's
   tokens (S6: green tokens on what you won) */
function noteWon(a, m) {
  var took = m.ep >= 0 ? a.st.b[m.ep] : a.st.b[m.to];
  if (took) (a.won = a.won || []).push({ sq: m.ep >= 0 ? m.ep : m.to, p: took });
}
/* the card is solved (S6): the board keeps your move, and the verdict (a
   filled tick, green tints, its sound) lands with the piece */
function solved(m, u, alt, lineDone) {
  var ss = ui.session, a = ss.active;
  if (m) {
    if (a.sol && a.solIdx > 0) noteWon(a, m);
    applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.animMove = a.tapAnim || null; a.tapAnim = null;
  }
  a.alt = alt && u !== a.bestUci ? alt : null;
  var result = a.misses ? 'retry' : ((a.hints || a.foundGood) ? 'hint' : 'first');
  a.cue = 'good';
  finishCard(result);
}
function reveal() {
  var a = ui.session && ui.session.active;
  /* not while a move is checked once the band says so: the bar shows Show
     the answer switched off then (S3). Before that (K1, 300 ms after it
     lands) the guess bar still offers it: the move is taken back first.
     Nor while a forcing reply is on its way (S10: its bar is off) */
  if (!a || a.phase === 'done' || a.phase === 'reply' || (a.phase === 'checking' && a.checkSaid)) return;
  /* pressed while a try is shown (or a move is checked): it goes first, the
     board crossfading back; from the card itself the green arrow is drawn
     and the words follow 150 ms after it (principle 2) */
  var still = a.phase === 'guess';
  if (a.phase === 'checking') dropCheck(a);
  if (a.phase === 'tried') clearTry(a);
  engineStop('check');
  a.revealed = true;
  a.sel = -1;
  /* the answer's arrow alone: a landed reply's own marks go */
  a.replyMark = null;
  /* inside a forcing line the moves already found stay on the board, and
     the answer is the move due now (problem map 4.7) */
  if (!(a.sol && a.solIdx > 0)) { a.st = cloneState(a.pre); a.lastMove = a.preLast; }
  /* the summary says it was shown (S17); a relearn card keeps its first note */
  if (!ss_relearn(a)) (ui.session.notes = ui.session.notes || {})[a.key] = 'shown';
  /* graded at once (a close move found first makes it a hint), so leaving
     the card from here never grades it again; then the answer is shown */
  finishCard(a.foundGood && !a.misses ? 'hint' : 'fail', still && !a.jump ? MARKS_THEN_WORDS : null);
}
/* the move the reveal shows now (S7): the forcing line's next move of
   yours, else the card's answer; null once it is played */
function showDue(a) {
  if (!a.view || a.view.mode !== 'show') return null;
  if (a.sol) return a.solIdx < a.sol.length && !!a.st.w === myPov(a.it) ? uciToMove(a.st, a.sol[a.solIdx]) : null;
  return a.showDone ? null : uciToMove(a.st, a.bestUci);
}
/* Play it (S7): the answer shown is played, as a move the app shows (320
   ms, its sound as it starts); it lands with the grey i badge and tints,
   and the band stays. Inside a forcing line their reply follows as the
   forcing reply does, and the next move of yours is shown the same way.
   At the end of the line (at once on a one-move card) the card settles:
   S0's marks, then R4 and the bar to the story. Played by hand (byHand)
   it goes at once, as the player's own moves do: tapped it slides, dragged
   it lands where it was dropped. Their reply plays on S10's timeline, and
   waits for "Their reply ›" under reduced motion */
function playIt(dragged, byHand) {
  var a = ui.session && ui.session.active, m = a && a.phase === 'done' && !a.explore && !a.showWait ? showDue(a) : null;
  if (!m) return;
  a.sel = -1;
  if (a.sol) noteWon(a, m);
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.markMove = { from: m.from, to: m.to, kind: 'info' };
  a.fxn = (a.fxn || 0) + 1;
  a.animMove = dragged ? null : [m.from, m.to];
  a.animShown = true;
  a.moveCue = !dragged;
  var reply = null;
  if (a.sol) { a.solIdx++; reply = a.solIdx < a.sol.length ? uciToMove(a.st, a.sol[a.solIdx]) : null; }
  else a.showDone = true;
  /* from Play it, a move the app shows: the words about to change (Play
     it, going off) fade out first (2.2), then it slides */
  var beats = dragged || byHand ? null : ['fade', reducedMotion() ? 0 : TEXT_OUT, 'board', 'land', 'text'];
  if (!reply) { settleShown(a); renderCard(beats); return; }
  /* their reply, on the forcing line's timeline (S10), from when this move
     lands: after the fade and the 320 ms slide from the button, the slide
     alone by hand, at once dragged or under reduced motion; Play it is off
     until its words come */
  a.showWait = true;
  startReply(a, reply, true);
  renderCard(beats);
  var rm = reducedMotion();
  replyClock(a, (beats && !rm ? TEXT_OUT : 0) + (dragged || rm ? 0 : SLIDE_LEAD + 320));
}
/* the shown line is over: the card settles as S0 does (the answer's band
   stays until R4 comes) */
function settleShown(a) {
  a.view = { mode: 's0' };
  a.settle = 0;
  a.settleFor = true;
}
/* S0's two beats once the verdict is read (S6): 700 ms after its words
   paint (paintText calls this then) the game move's ghost and the threat it
   ran into; at 850 R4 in row 2, the strip's Details and, after a reveal,
   the bar to the story (300 and 400 under reduced motion) */
function settleBeats(a) {
  var rm = reducedMotion();
  a.settleFor = false;
  stageAt(rm ? 300 : 700, function (a2) {
    if (a2.view.mode !== 's0' || a2.settle >= 1) return;
    a2.settle = 1;
    /* the ghost lives in the board svg: a board beat with nothing sliding */
    stage(['board']);
  });
  stageAt(rm ? 400 : 850, function (a2) {
    if (a2.view.mode !== 's0' || a2.settle >= 2) return;
    a2.settle = 2;
    stage(['text']);
  });
}
/* See why (S12): from S0 (See why ›, →, a left swipe) the story opens at
   G1. A revealed card offers it once settled */
function seeWhy() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || !a.lines || !a.view || a.view.mode !== 's0' || a.settle < (a.revealed ? 2 : 0)) return;
  a.settle = 2;
  storyGo(a, 0, true);
}
/* back to the settled result (‹ on G1, Esc): a jump, so it crossfades */
function backToSettled() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || !a.view || a.view.mode !== 'story') return;
  a.view = { mode: 's0' };
  a.jump = true;
  renderCard();
}
/* one ply per tap (S12): forward (d 1: Next move ›, →, Space, a left swipe)
   or back (d -1: ‹, ←, a right swipe). From S0 forward opens the story; back
   from G1 is S0 again; forward at the last step does nothing */
function storyStep(d) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || !a.view) return;
  if (a.view.mode === 's0') { if (d > 0) seeWhy(); return; }
  if (a.view.mode !== 'story') return;
  var i = a.view.i, n = buildStory(a).steps.length;
  if (d < 0) { if (i === 0) backToSettled(); else storyGo(a, i - 1, false); }
  else if (i < n - 1) storyGo(a, i + 1, true);
}
/* the strip's names: "Game" opens G1, "Better" B1, each played from its start */
function storyJump(seg) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || !a.view || a.view.mode !== 'story') return;
  var j = seg === 'better' ? buildStory(a).g : 0;
  if (j < buildStory(a).steps.length && j !== a.view.i) storyGo(a, j, true);
}
/* step j on screen. Played forward, its ply is a move the app shows: the
   words about to change fade out (100 ms), then it slides (320 ms) with its
   sound, what it brings lands with it, then its caption. The first step of
   a segment (G1, B1) first crossfades to where the segment starts, with its
   arrow (the red game move, the green better move), then slides. Back is a
   jump to that step as it landed: a crossfade */
function storyGo(a, j, play) {
  var S = buildStory(a), s = S.steps[j], n = s && s.line.nodes[s.k];
  if (!n || !n.move) return;
  var rm = reducedMotion(), first = s.k === (s.seg === 'game' ? 0 : s.from);
  a.sel = -1;
  if (!play) { a.view = { mode: 'story', i: j }; a.jump = true; renderCard(); return; }
  var slide = function (a2) { a2.animMove = [n.move.from, n.move.to]; a2.animShown = true; a2.moveCue = true; };
  if (!first) {
    a.view = { mode: 'story', i: j };
    slide(a);
    renderCard(['fade', rm ? 0 : TEXT_OUT, 'board', 'land', 'text']);
    return;
  }
  a.view = { mode: 'story', i: j, pre: true };
  a.jump = true;
  renderCard(['fade', rm ? 0 : TEXT_OUT, 'board', { run: function (a2) {
    if (a2.view.mode !== 'story' || a2.view.i !== j || !a2.view.pre) return;
    delete a2.view.pre;
    slide(a2);
  } }, 'board', 'land', 'text']);
}
/* a second tap on Next lands where Show the answer now sits: taps in the
   first half second of a card are the old card's. After that, each bar
   slot guards itself for half a second once it changes (slotGuarded) */
function tooSoon(a) { return !!a && Date.now() - (a.shownAt || 0) < 450; }
function giveHint() {
  var a = ui.session && ui.session.active;
  if (!a) return;
  /* pressed while a try is shown, or over a move being checked while the
     guess bar still offers Hint (before K1): it goes first, the board
     crossfading back, the words after it */
  var cleared = a.phase === 'tried' || (a.phase === 'checking' && !a.checkSaid);
  if (a.phase === 'tried') clearTry(a);
  else if (cleared) dropCheck(a);
  if (a.phase !== 'guess' || a.hints >= 2) { if (cleared) renderCard(); return; }
  a.hints = a.hints + 1;
  a.hintAt = a.misses;
  a.hintAfter = true;
  keepProgress(a);
  if (cleared) holdMarks(a);
  /* from the card itself only its marks change: they are drawn, then the
     words 150 ms later, never in the same frame (principles 1 and 2) */
  renderCard(cleared ? null : MARKS_THEN_WORDS);
}
/* the marks a hint draws (FINAL-SPEC S8, 2.1), from the card's hint state,
   on the position the card asks from: hint 2 is the gold ring on the piece
   to move (the answer due now, so inside a forcing line the step's own
   piece); hint 1 on the card's first move is, on a missed-chance card, a
   dashed gold ring on the prize (hintPrize), else the danger the game move
   ran into (hintDanger): the piece that punishes it ringed, a dashed arrow
   to what it takes or checks. Inside a forcing line hint 1 is words only.
   A hint-1 mark never touches the answer's from- or to-square (2.3, both
   arrow ends): such a mark is dropped and hint 1 is words only. The two
   hints never share a frame, so "the circled piece" is always one piece.
   {rings, arrows, prize, danger}; drawn only while the card asks (guess) */
function hintMarks(a) {
  var out = { rings: [], arrows: [], prize: null, danger: null };
  if (!a || !(a.hints >= 1)) return out;
  var due = dueMove(a);
  if (a.hints >= 2) { out.rings.push({ sq: due.from, kind: 'hint' }); return out; }
  if (a.sol && a.solIdx > 0) return out;
  var off = function (sqs) { return sqs.every(function (q) { return q !== due.from && q !== due.to; }); };
  if (familyOf(patternOf(a.it.b)).key === 'chances') {
    var pz = hintPrize(a);
    if (pz && off([pz.sq])) { out.prize = pz; out.rings.push({ sq: pz.sq, kind: 'target' }); }
    return out;
  }
  var th = hintDanger(a);
  if (th && off([th.from, th.to])) {
    out.danger = th;
    out.rings.push({ sq: th.from, kind: 'threat' });
    out.arrows.push({ from: th.from, to: th.to, kind: 'threat', key: 'hint' });
  }
  return out;
}
/* hint 1's danger: the game line's first reply after the game move, when it
   captures or checks (threatOf) and the game line really loses (material,
   or a checkmate against you), drawn on the card's position, where its
   piece already stands. A reply that hurts nothing is no danger */
function hintDanger(a) {
  var c = a.cls, th = c && (c.lossG >= 1 || c.mateAgainst) ? threatOf(c.gameLine, 1) : null;
  return th && a.pre.b[th.from] && isW(a.pre.b[th.from]) !== myPov(a.it) ? th : null;
}
/* hint 1's prize on a missed-chance card: the most valuable piece of theirs
   the stored best line takes before it settles, still standing on its
   square in the card's position (no move of the line has touched that
   square before the capture), on a line that starts with the card's answer
   and wins material overall. {sq, p}; null when there is none */
function hintPrize(a) {
  var c = a.cls, line = c && c.bestLine, n1 = line && line.nodes[1];
  if (!n1 || !n1.move || line.unsettled || c.mateFor || !(c.matBest >= 1)) return null;
  if (n1.move.from !== a.best.from || n1.move.to !== a.best.to) return null;
  var best = null, touched = {};
  for (var k = 1; k <= c.bSettle && k < line.nodes.length; k++) {
    var n = line.nodes[k];
    if (!n.move) break;
    var sq = n.move.ep >= 0 ? n.move.ep : n.move.to;
    if (n.pov && n.captured && !touched[sq] && a.pre.b[sq] === n.captured && (!best || MOTIF_VAL[pType(n.captured)] > MOTIF_VAL[pType(best.p)]))
      best = { sq: sq, p: n.captured };
    touched[n.move.from] = touched[n.move.to] = 1;
    if (n.move.ep >= 0) touched[n.move.ep] = 1;
  }
  return best;
}
/* S9, the worked example: a tier-1 player's first card of a pattern family
   (nl:seen:<family> still 0) opens with hint 1's marks drawn, so Hint gives
   hint 2 and a solve records hint. Never at tiers 2 and 3, on a relearn
   card, on a card already tried or helped, or when hint 1 draws nothing
   there (words only: that family waits for a card that can show it).
   Storage that cannot be read counts as seen. True when it applies */
function familySeen(fam) {
  try { var v = localStorage.getItem('nl:seen:' + fam); return v == null ? 0 : +JSON.parse(v) || 0; }
  catch (e) { return 1; }
}
function workedExample(a) {
  if (!a || a.tier !== 1 || a.hints || a.misses || a.attempts || ss_relearn(a)) return false;
  if (familySeen(familyOf(patternOf(a.it.b)).key) > 0) return false;
  a.hints = 1;
  var hm = hintMarks(a);
  if (!hm.rings.length && !hm.arrows.length) { a.hints = 0; return false; }
  a.predraw = true;
  a.hintAt = 0;
  return true;
}
function finishCard(result, beats) {
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
  /* the worked example done (S9): the family counts as seen, and the
     summary says it was a first look (a shown answer stays "Shown") */
  if (a.predraw) {
    var fam = familyOf(patternOf(a.it.b)).key;
    store.set('nl:seen:' + fam, familySeen(fam) + 1);
    if (!a.revealed && !relearn) (ss.notes = ss.notes || {})[a.key] = 'firstlook';
  }
  a.lines = cardLines(a);
  /* the habit line: every card for newer players, otherwise once a week
     per pattern (decided once here, not on every repaint) */
  var habitKey = 'nl:habitSeen:' + patternOf(a.it.b);
  a.showHabit = a.tier === 1 || Date.now() - store.get(habitKey, 0) > 7 * DAY;
  if (a.showHabit) store.set(habitKey, Date.now());
  /* the board keeps showing what was just played (S6: the move found, the
     alternative that also works, or the end of the forcing line), its tick
     landing with the piece, then settles (S0); a shown answer is its green
     arrow, to be played (S7). Nothing plays by itself from here */
  a.settle = 0;
  if (a.revealed) {
    a.view = { mode: 'show' };
    var due = showDue(a);
    a.answerSan = due ? sanOf(a.st, due) : '';
  } else {
    a.view = { mode: 's0' };
    if (a.lastMove) a.markMove = { from: a.lastMove[0], to: a.lastMove[1], kind: 'good' };
    a.settleFor = true;
  }
  saveSession();
  modelDirty();
  renderCard(beats);
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
  /* what was staged for this card dies with it */
  stageReset();
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

/* ── after answering: the frame on screen ───────────────────────────────── */
/* the position an answered card shows: S0 and the answer shown, the card's
   own board as play left it (a.st); a story step, its ply landed (or, while
   a segment's first step crossfades in, where that segment starts), with
   its last move and the bar's value */
function storyView(a) {
  var v = a.view, s = buildStory(a).steps[v.i], n = s.line.nodes[s.k];
  if (!v.pre) return { st: n.after, last: [n.move.from, n.move.to], ev: a.it.b.eb };
  var pn = s.line.nodes[s.k - 1];
  return { st: n.before, last: pn && pn.move ? [pn.move.from, pn.move.to] : a.preLast, ev: a.it.b.eb };
}
function doneBoard(a) { return a.view && a.view.mode === 'story' ? storyView(a).st : a.st; }

