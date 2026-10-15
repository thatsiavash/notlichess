/* ── The card: one mistake, retried ─────────────────────────────────────────
   Phases: 'loading' (the deeper look) -> 'guess' -> 'checking' (a move is
   being graded) -> 'tried' (the try stays on the board: a miss, a close
   move, or one the engine could not check) -> 'guess' again on Try again,
   or 'reply' (the opponent's answer inside a forcing line) -> 'done' (the
   why). A move still being checked can be taken back, ungraded. Nothing on
   the board moves without a tap, except that reply. */

var SOLVE_TOL = 4;        /* win-chance points from the best move: solved */
var STRONGER_TOL = 10;    /* within this: good, but look for more */

/* the player's tier, the help, words and depth the card gives: the help
   level chosen in Settings (F9.1: More help 1, Normal 2, Less help 3),
   else the one the tracked format's current rating gives (novices get
   more guidance, strong players the whole line and no hints) */
function playerTier() { return HELP.indexOf(helpLevel()) + 1; }
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
  /* a practice position, a lesson (F9.3, F9.4) */
  if (it.prac) return pracCardFor(it);
  if (it.lesson) return lessonCardFor(it);
  var g = it.g, b = it.b;
  var pre = stateAtPly(g.mv, b.p);
  if (!pre) return null;
  var playedUci = uciOfSan(g.mv, b.p);
  var best = b.bu ? uciToMove(pre, b.bu) : null;
  /* a foil's best move may be the game move itself (F8.2) */
  if (!best || !playedUci || (b.bu === playedUci && !it.foil)) return null;
  var rec = it.foil ? null : srsRec(it);
  var a = {
    it: it, key: it.key, pre: pre, st: cloneState(pre), phase: 'guess', best: best, bestUci: b.bu,
    playedUci: playedUci, played: uciToMove(pre, playedUci),
    attempts: 0, misses: 0, hints: 0, sel: -1, shapes: [], t0: Date.now(),
    firstSight: !rec || !!rec.q, tier: playerTier(), view: null, foil: !!it.foil
  };
  /* game mode (F8.1): a review after a clean find at tiers 2 and 3, and
     every foil; "One more try" asks cued */
  a.game = a.foil || (gameModeRec(rec, a.tier) && !ss_relearn(a));
  var kept = ui.session && ui.session.progress && ui.session.progress[it.key];
  if (kept) {
    a.misses = kept.m || 0; a.hints = kept.h || 0; a.triedGameMove = !!kept.g; a.foundGood = kept.f || null; a.attempts = kept.a || 0; a.predraw = !!kept.p; a.autoH = kept.au || 0;
    a.fc = kept.fc || ''; a.tries = (kept.tr || []).map(function (x) { return { d: x[0], u: x[1], took: x[2] || '', mate: !!x[3], lost: !!x[4], san: x[5] || '' }; });
    /* a forcing line's later misses (V1.6), and the move first missed there */
    a.slips = kept.sl || 0; a.slipSan = kept.ss || '';
    /* a showing keeps its mode across a reload, though its miss ended the run */
    if (kept.gm != null) a.game = !!kept.gm || a.foil;
  }
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
  var fs = factsSettle(b, myPov(it));
  /* (B5: the key's threats, for "ignores their threat") */
  var kth = factsOf(b) && !factsOf(b).x ? factsOf(b).th : undefined;
  var cls = classifyMistake(pre, playedUci, { pv: unpackUci(b.lu), mate: b.mb, settle: fs.b }, { pv: unpackUci(b.ru), mate: b.ma, settle: fs.g, th: kth }, b.wb, b.wa, b.p);
  a.cls = cls;
  /* the forcing line's length reads the line's own settle (the key's
     settle rule reads on further, for its counts only: V1.1) */
  var own = cls.bSettleOwn != null ? cls.bSettleOwn : cls.bSettle;
  a.settleBest = own;
  a.settleGame = cls.gSettle;
  var lu = unpackUci(b.lu);
  var forcing = cls.bestLine && cls.bestLine.nodes[1]
    && (cls.bestLine.nodes[1].captured || checkersOf(cls.bestLine.nodes[1].after).length || cls.mateFor);
  /* a foil asks for one move: nothing in it is a line to find */
  if (a.tier >= 2 && forcing && lu.length >= 3 && own >= 3 && !a.foil) {
    /* my moves sit at even offsets of the best line; stop at the settle */
    var endAt = cls.mateFor ? lu.length : Math.min(lu.length, own + (own % 2 === 0 ? 1 : 0));
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
  return itemOf(ss.keys[ss.idx]);
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
  /* a practice position or a lesson (F9.3, F9.4) opens at once: nothing to
     look at first, graded from what it keeps */
  if (it && (it.prac || it.lesson)) {
    var pa = cardFor(it);
    if (!pa) { ss.keys.splice(ss.idx, 1); saveSession(); loadCard(); return; }
    pa.lessonTry = !!it.prac && lessonTryOf(ss, it.key);
    ss.active = pa;
    pa.shownAt = Date.now();
    renderCard();
    setTimeout(scrollTrainerTop, 60);
    prefetchCards(ss);
    track(it.lesson ? 'lesson_shown' : 'practice_shown');
    return;
  }
  /* a foil goes too with the engine down: its game move cannot be checked;
     so does a position with no fact sheet (V1.1: only keyed cards then).
     A position taken out gives its slot to the next one (C1, setAside) */
  if (!it || (it.foil ? SF.state === 'failed' : !dealable(it)) || it.b.x) { setAside(ss); loadCard(); return; }
  var myGen = gen, key = it.key;
  var go = function () {
    if (ss.loadingKey === key) ss.loadingKey = null;
    if (stale(myGen) || ui.session !== ss || ss.keys[ss.idx] !== key) return;
    if (it.b.x || (it.foil && !foilReady(it))) { setAside(ss); loadCard(); return; }
    var a = cardFor(it);
    if (!a) { it.b.x = 'moves'; setAside(ss); loadCard(); return; }
    /* a first session's head card that the deeper look turned into a
       forcing line goes back behind one that asks for one move, if any */
    if (a.sol && ss.firstTime && ss.idx < 3) {
      keepFirstThree(ss);
      if (ss.keys[ss.idx] !== key) { saveSession(); loadCard(); return; }
    }
    ss.active = a;
    if (workedExample(a)) keepProgress(a);
    a.shownAt = Date.now();
    /* a foil shown is not shown again for 7 days (F8.2) */
    if (a.foil) foilShown(a.key);
    renderCard();
    setTimeout(scrollTrainerTop, 60);
    prefetchCards(ss);
    /* tier 3's settled line has figures: the card's two-line search, when
       its record has none (F1.4); a forcing line's guess of their reply is
       judged against a three-line list, asked for now (F10.1) */
    if (a.tier >= 3 && !a.foil) ensureGap(it);
    if (a.tier >= 3 && a.sol) ensureReplies(a, false);
    /* the first game-mode card says what changed, once (F8.1) */
    if (a.game && !store.get('nl:tip:gamemode', 0)) { store.set('nl:tip:gamemode', 1); notice(GAME_NOTE, null, 9000); }
    track('card_shown');
  };
  /* a foil is looked at once (foilLook) in the loading frame */
  if (it.foil) {
    if (foilReady(it)) go();
    else { ss.loadingKey = key; renderCard(); foilLook(it, true).then(go, go); }
    return;
  }
  /* a card with its fact sheet (V1.1) opens at once: its danger facts read
     the key's threats, with no search. One looked at before still waits for
     its danger facts' one search while the engine is up (the loading
     frame); with the engine down or still loading it opens at once on the
     facts read without it, and asks for their threat as soon as it can.
     Without a key the 250,000-node look stands in; the key, made in the
     background, takes its place between frames (factsSwap) */
  if (factsOf(it.b)) { if (!dangerReady(it.b)) dangerNow(it); go(); return; }
  var dzWait = !dangerReady(it.b) && SF.state === 'ready';
  if (((it.b.v || 0) >= 2 && !dzWait) || SF.state === 'failed') {
    if (!dangerReady(it.b)) { if (SF.state === 'failed') dangerNow(it); else ensureDanger(it, true); }
    go();
  } else {
    ss.loadingKey = key;
    renderCard();
    deepEnrich(it, true).then(go, go);
  }
}
/* the next two cards get their deeper look (and danger facts) while this
   one is solved */
function prefetchCards(ss) {
  for (var i = ss.idx + 1; i < Math.min(ss.keys.length, ss.idx + 3); i++) {
    var it = itemOf(ss.keys[i]);
    if (!it || it.prac || it.lesson) continue;
    if (it.foil) { if (SF.state !== 'failed') foilLook(it, false); }
    else if (it && (it.b.v || 0) < 2) deepEnrich(it, false);
    else if (it && !dangerReady(it.b) && SF.state !== 'failed') ensureDanger(it, false);
  }
}

/* a card's fact sheet has landed (V1.1). The card on screen takes it
   between frames, never while a piece moves or a move is judged: at once
   when it is asking with nothing on the board (its first move, no try, no
   piece picked up, nothing sliding), else the next time it asks so
   (factsSwap from Try again). A key that sets the card aside takes it out
   of the set there; an answered card keeps what it showed */
function factsLanded(it) {
  var a = ui.session && ui.session.active;
  if (!a || a.key !== it.key || a.foil || a.prac || a.lesson) return;
  a.keyDue = true;
  factsSwap(a);
}
function factsQuiet(a) {
  return a.phase === 'guess' && !(a.solIdx > 0) && !a.tried && !a.reply && !a.explore && !a.pendingPromo && a.sel < 0 && Date.now() >= motionUntil;
}
function factsSwap(a) {
  var ss = ui.session;
  if (!a || !a.keyDue || !ss || ss.active !== a || !factsQuiet(a)) return false;
  a.keyDue = false;
  var it = a.it;
  if (it.b.x) {
    setAside(ss); stageReset();
    notice('On a deeper look that position was not a real mistake, so it was removed.');
    loadCard();
    return true;
  }
  /* the card again, from its record as the key wrote it, with what was
     tried on it kept (as a reload keeps it) */
  keepProgress(a);
  var b2 = cardFor(it);
  if (!b2) return false;
  ['t0', 'shownAt', 'firstAt', 'wrong', 'fxn', 'predraw', 'hintAt', 'hintAfter', 'runBroke', 'note', 'nope'].forEach(function (f) { if (a[f] !== undefined) b2[f] = a[f]; });
  b2.lastMove = a.lastMove;
  ss.active = b2;
  if (b2.tier >= 3 && b2.sol) ensureReplies(b2, false);
  renderCard();
  return true;
}

/* ── moves on the board ──────────────────────────────────────────────────── */
function sessionClick(sq) {
  /* input first; while the forcing reply is on its way a tap moves
     nothing, and one on a piece of yours is kept for its landing */
  if (flushStage(true)) { replyTap(ui.session && ui.session.active, sq); return; }
  var ss = ui.session, a = ss && ss.active;
  if (!a || a.pendingPromo) return;
  /* a lesson's frames take no moves (F9.3) */
  if (a.phase === 'lesson') return;
  /* their best reply asked for (F10.1): the board takes a guess */
  if (a.reply && a.reply.ask && a.phase === 'reply') { guessClick(a, sq); return; }
  /* under reduced motion the reply waits for its button: the same */
  if (a.reply && !a.explore && (a.phase === 'reply' || a.phase === 'done')) { replyTap(a, sq); return; }
  if (a.phase === 'checking') {
    /* a move being checked: a tap on it takes it back (S3) with nothing
       picked up, as a tap on a try does (I1); a piece of theirs says which
       side you are (T4, under the check's own row 1); any other piece of
       yours only says this is not a move here */
    var back = checkingPick(a, sq), cp = checkingFrame(a).b[sq];
    if (back >= 0) takeBack();
    else if (cp && isW(cp) !== a.st.w) tapNote(a, 'T4', 2500, sq);
    else if (cp) nopeAt(a, sq);
    return;
  }
  if (a.phase === 'tried') {
    /* a try on the board: a tap on one of your pieces takes it back and
       picks that piece up; a tap on one of theirs says which side you are */
    var pick = triedPick(a, sq), tp = triedFrame(a).st.b[sq];
    if (pick >= 0 || pick === TRY_ONLY) tryAgain(pick);
    else if (tp && isW(tp) !== a.st.w) tapNote(a, 'T4', 2500, sq);
    return;
  }
  if (a.phase === 'done') {
    if (a.explore) { exploreClick(sq); return; }
    /* the answer shown takes that one move, by hand (S7): its piece picks
       up, its square plays it, anything else puts it down. A move in its
       found band (V1.2: the key's lines within 4 points) plays as it does */
    var due = !a.showWait ? showDue(a) : null, near = due ? showNearMoves(a) : [];
    var nearFrom = function (q) { return near.some(function (x) { return x.from === q; }); };
    if (due && (sq === due.from || a.sel === due.from || nearFrom(sq) || nearFrom(a.sel))) {
      var nm = near.filter(function (x) { return x.from === a.sel && x.to === sq; })[0];
      if (a.sel === due.from && sq === due.to) playIt(pointerState.suppressClick, true);
      else if (nm) playNear(a, nm, pointerState.suppressClick);
      else if (sq === due.from || nearFrom(sq)) { a.sel = a.sel === sq ? -1 : sq; if (a.sel >= 0) snd('tap'); renderCardBoard(); }
      else { a.sel = -1; renderCardBoard(); }
      return;
    }
    if (a.sel >= 0) { a.sel = -1; renderCardBoard(); }
    /* after an answer the board takes no moves: a tap on any piece says
       where to try them (N1), and nothing changes; with the engine down
       there is nowhere to try them (S11), so the outline answers alone */
    if (doneBoard(a).b[sq]) { if (SF.state === 'failed' || a.prac) nopeAt(a, sq); else tapNote(a, 'N1', 2500, sq); }
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
    var dropped = pointerState.suppressClick, from = a.sel;
    a.sel = -1;
    renderCardBoard();
    /* V2.7: a move the piece could make but for the check it would leave
       its king in says so */
    if (legalMovesPseudo(a.st, from).indexOf(sq) >= 0) tapNote(a, 'T6', 2500, dropped ? null : sq);
    else if (dropped) tapNote(a, 'T5', 2000, null);
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
  /* the practice log's time to the first move */
  if (!a.firstAt) a.firstAt = Date.now();
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
  /* a practice position (F9.4): graded at once from what it keeps */
  if (a.prac) { pracTry(m); return; }
  /* a foil (F8.2): its best move and its game move pass as they are (the
     game move lost under 3 points on the foil's own look), any other move is
     scored against the best */
  if (a.foil) {
    if (u === a.bestUci) foilPass(m, 0);
    else if (u === a.playedUci) foilPass(m, a.it.b.fl || 0);
    else checkMove(m, u, false);
    return;
  }
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
  /* a try among the key's three lines (V1.1) is graded at the key's depth
     with no search; it lands as a judged move does */
  var kv = keyVerdict(a, u);
  if (kv) { if (kv.kind !== 'solved') { a.animMove = a.tapAnim; a.tapAnim = null; } applyTry(a, m, u, false, kv); return; }
  checkMove(m, u, false);
}
/* the forcing line, move by move (S10): your move found lands with its
   tick ("Right"), then their reply plays by itself on its timeline
   (replyClock); the line's last move is the solve. At tier 3 the first
   move found asks for their best reply first (F10.1): nothing moves until
   a guess or Their reply */
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
  var ask = a.solIdx === 1 && u === a.sol[0] && guessable(a);
  a.guessOn = ask;
  a.verdict = verdictOf('good', CARD_COPY.F1(), [ask ? CARD_COPY.Q2() : CARD_COPY.F2(a)], '');
  var rm = reducedMotion(), lands = a.animMove && !rm ? SLIDE_LEAD + 220 : 0;
  startReply(a, reply, false);
  /* the question: no telegraph (it would show the answer), no timeline;
     the three-line list it is judged against is asked for now if the
     card's load did not bring it */
  if (ask) { a.reply.ask = true; a.reply.tele = false; a.askAt = Date.now(); ensureReplies(a, true); }
  /* under reduced motion the reply waits for its button, which gets the
     keyboard; the question's button only skips it, so it gets none */
  a.focusRight = rm && !ask;
  renderCard();
  if (!ask) replyClock(a, lands);
}
/* ── predict their reply (F10.1) ─────────────────────────────────────────
   On a tier 3 forcing card (and its game-mode reviews), after the line's
   first move is found: "Right" / "Now their best reply?" and [Their reply]
   to skip. The player taps a piece of theirs and a square: a blue-grey
   arrow, "your guess"; nothing moves. The guess is judged against a
   three-line list for the position after the expected move (searched at
   the card's load, 250,000 nodes, kept on the record as b.rl), right when
   it is their reply or within 4 points of their best; then the reply plays
   on its own timeline from the guess (its telegraph at 600, its slide at
   1500, its words at 2050, or under reduced motion 300 ms later at once),
   and row 2 says what the guess was. A wrong guess is not a miss; a right
   one is kept on the record (rec.pg), which a tier 3 forcing card needs
   once before it can be learned. No guess after a move that works too (the
   card ends there), inside the line, on a line shown, with the engine down
   (the reply plays as before) or with one legal reply; never on a practice
   position or a lesson (F9.3, F9.4), which hold no line. The time the
   question stands open is no part of the card's solve time (askClose) */
var GUESS_TOL = 4;
/* the node after the line's first move (a.st there) can be asked about */
function guessable(a) {
  if ((a.tier || 2) < 3 || !a.sol || a.prac || a.lesson || a.explore || SF.state === 'failed') return false;
  return legalMoves(a.st).length >= 2;
}
/* the question closed (a guess, or Their reply): how long it stood open,
   kept apart from the solve time, so F8.3's 30 s (60 s) never counts it */
function askClose(a) {
  if (!a.askAt) return;
  a.askMs = (a.askMs || 0) + Date.now() - a.askAt;
  a.askAt = 0;
}
/* the list, while it is current for the record's lines: {k, n (legal
   replies), l [[uci, cp, mate], ...]} with scores from their side, best
   first; null when not read */
function replyList(b) { var r = b && b.rl; return r && r.k === dzSig(b) && r.d === CONFIRM_NODES ? r : null; }
function replyNode(a) {
  var st = cloneState(a.pre), m = a.sol ? uciToMove(st, a.sol[0]) : null;
  if (!m) return null;
  applyMove(st, m);
  return st;
}
/* the list, asked once per card (at its load in the background, the
   player's own question from the first move found), tagged with the card */
var replyPending = {};
function ensureReplies(a, prio) {
  var it = a.it, b = it.b, key = it.key, myGen = gen;
  if (!a.sol || (a.tier || 2) < 3 || replyList(b) || b.x || SF.state === 'failed') return;
  if (replyPending[key]) { if (prio) promoteTag(key); return; }
  var st = replyNode(a), n = st ? legalMoves(st).length : 0;
  if (n < 2) return;
  var sig = dzSig(b), mine = myPov(it);
  replyPending[key] = engineEval(stateFen(st), { nodes: CONFIRM_NODES }, !!prio, { multipv: 3, tag: key, rl: 1 }).then(function (r) {
    delete replyPending[key];
    if (!r || r.stopped || stale(myGen) || b.x || dzSig(b) !== sig) return;
    var l = (r.lines || []).filter(function (x) { return x && x.pv && x.pv[0] && uciToMove(st, x.pv[0]); }).slice(0, 3).map(function (x) {
      return [x.pv[0], mine ? -x.cp : x.cp, x.mate == null ? null : mine ? -x.mate : x.mate];
    });
    if (!l.length) return;
    b.rl = { k: sig, d: CONFIRM_NODES, n: n, l: l };
    scheduleSave();
  }, function () { delete replyPending[key]; });
}
/* a line of the list within 4 points of the best, from their side: a
   mate against them only beside one at least as far off as the best's, a
   mate of theirs only beside another */
function guessNear(x, best) {
  var xm = x[2], bm = best[2];
  if (bm != null && bm < 0) return xm != null && xm < 0 && xm <= bm;
  if (xm != null && xm < 0) return false;
  if (bm != null && bm > 0) return xm != null && xm > 0;
  return winPct(x[1]) >= winPct(best[1]) - GUESS_TOL;
}
/* the guess uci, judged: 'saw' (their reply itself), 'good' (within 4
   points of their best), 'not', or 'open' when the list cannot say (none
   yet, or a move off it while its last line is as good as the best: it may
   be too); null while the list is on its way, unless final */
function guessVerdict(a, uci, final) {
  if (uci === a.sol[1]) return 'saw';
  var rl = replyList(a.it.b);
  if (!rl) return final ? 'open' : null;
  var l = rl.l, best = l[0], g = l.filter(function (x) { return x[0] === uci; })[0];
  if (g) return guessNear(g, best) ? 'good' : 'not';
  return l.length >= Math.min(3, rl.n || 3) && !guessNear(l[l.length - 1], best) ? 'not' : 'open';
}
/* a tap while the question is asked: a piece of theirs picks up (its dots
   drawn), a square it can go to is the guess; a piece of yours says whose
   move it is (Q1); a drop where the piece cannot go snaps back (T5) */
function guessClick(a, sq) {
  var p = a.st.b[sq], theirs = !!a.st.w;
  if (p && isW(p) === theirs) {
    if (pointerState.suppressClick && a.sel >= 0 && a.sel !== sq) { a.sel = -1; renderCardBoard(); tapNote(a, 'T5', 2000, null); return; }
    a.sel = a.sel === sq ? -1 : sq;
    snd('tap');
    renderCardBoard();
    return;
  }
  if (a.sel < 0) { if (p) tapNote(a, 'Q1', 2500, sq); return; }
  var legal = legalMoves(a.st).filter(function (m) { return m.from === a.sel && m.to === sq; });
  if (!legal.length) {
    var dropped = pointerState.suppressClick;
    a.sel = -1;
    renderCardBoard();
    if (dropped) tapNote(a, 'T5', 2000, null);
    else if (p) tapNote(a, 'Q1', 2500, sq);
    return;
  }
  /* a promotion: the piece their reply makes, if it is that move, else a queen */
  var want = a.sol[a.solIdx];
  makeGuess(a, legal.filter(function (m) { return moveUci(m) === want; })[0] || legal.filter(function (m) { return !m.promo || pType(m.promo) === 'Q'; })[0] || legal[0]);
}
/* the guess is made: its arrow at once (the press's own feedback), the bar
   switched off 150 ms later, and their reply on its timeline from now */
function makeGuess(a, m) {
  var rp = a.reply, u = moveUci(m);
  if (!rp || !rp.ask) return;
  rp.ask = false;
  askClose(a);
  a.sel = -1;
  a.guess = { uci: u, from: m.from, to: m.to, san: sanOf(a.st, m), v: guessVerdict(a, u, false) };
  snd('tap');
  /* under reduced motion its telegraph at once, as a reply waiting for its
     button has it, and the reply itself 300 ms later */
  var rm = reducedMotion();
  if (rm) rp.tele = true;
  stage(['board', TEXT_GAP, 'text']);
  if (rm) stageAt(300, function (a2) { if (a2.reply === rp && !rp.played) theirReply(a2, true); });
  else replyClock(a, 0);
}
/* the guess's verdict for the record, the log and the measure: judged at
   the latest when it is said (or the card is left) */
function guessResult(a) {
  var g = a.guess;
  if (!g) return null;
  if (g.skip) return 'skip';
  if (!g.v) g.v = guessVerdict(a, g.uci, true);
  return g.v;
}
function guessRight(a) { var v = guessResult(a); return v === 'saw' || v === 'good'; }
/* a measure (F0.7): the guess, once a showing, as a word */
function noteGuess(a) {
  if (a.guessSent || !a.guess) return;
  a.guessSent = true;
  var v = guessResult(a);
  track('guess_' + (v === 'skip' ? 'skip' : v === 'open' ? 'open' : v === 'not' ? 'wrong' : 'right'));
}
/* the forcing reply (S10), the one move that plays by itself, inside a
   forcing line being solved or shown (show: after Play it). a.reply:
   {uci, from, to, show, tele (its telegraph is drawn), played} */
function startReply(a, m, show) {
  a.replyQ = null;
  a.reply = { uci: moveUci(m), from: m.from, to: m.to, show: !!show, tele: reducedMotion(), played: false };
}
/* its timeline, from t0, when the move before it lands (landIn ms from
   now): at 600 the telegraph (its piece ringed, a blue-grey dashed arrow),
   at 1500 the slide (400 ms, so it lands at 1900), at 2050 the words. The
   slide's board is drawn SLIDE_LEAD before the piece is let go, and a shown
   line's words fade out 100 ms before that (theirReply). Under reduced
   motion nothing runs: the telegraph is drawn at once and the reply waits
   for "Their reply" */
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
  /* the question not answered (F10.1): Their reply plays it, the guess
     skipped */
  if (rp.ask) { rp.ask = false; askClose(a); a.sel = -1; a.guess = { skip: true }; }
  var before = cloneState(a.st), took = m.ep >= 0 ? a.st.b[m.ep] : a.st.b[m.to];
  rp.played = true;
  rp.tele = true;
  rp.san = sanOf(before, m);
  /* and what their reply took, so the settled board reads the line whole */
  if (took) (a.lineLost = a.lineLost || []).push({ sq: m.ep >= 0 ? m.ep : m.to, p: took });
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.solIdx++;
  a.replyMark = { from: m.from, to: m.to, token: took ? { sq: m.ep >= 0 ? m.ep : m.to, p: took } : null, fx: a.key + ':rp' + a.solIdx };
  a.replySaid = replyWords(a, before, m, took);
  var next = a.solIdx < a.sol.length ? uciToMove(a.st, a.sol[a.solIdx]) : null;
  /* a shown line: the next move of yours is the answer now */
  if (rp.show) { a.markMove = null; if (next) { a.answerSan = sanOf(a.st, next); a.answerWords = { san: a.answerSan, w: moveWords(a.st, next) }; } }
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
  stage(fade.concat(['board', 'land', { run: function (a2) { replyLanded(a2, rp); } }, rm ? 300 : TEXT_GAP, { run: function (a2) { replyDone(a2, rp); } }, 'text']));
  return true;
}
/* a tap while the forcing reply is on its way (I4) moves nothing and never
   hurries the slide: one on a piece of yours is kept (a second tap on it
   lets it go) and picks that piece up as the reply lands (replyLanded); any
   other tap is dropped, so no move is ever made from a piece the player did
   not see picked up */
function replyTap(a, sq) {
  if (!a || !a.reply || a.explore || sq == null || sq < 0) return;
  var p = a.st.b[sq];
  if (!p || isW(p) !== myPov(a.it)) return;
  a.replyQ = a.replyQ && a.replyQ.sq === sq ? null : { sq: sq, p: p };
}
/* the reply has landed: the piece tapped during it is picked up, drawn at
   once, if it still stands there and has a move to make (in a line shown,
   only the answer's own piece); from here the board takes input again
   (flushStage), the words still 150 ms later */
function replyLanded(a, rp) {
  var q = a.replyQ;
  a.replyQ = null;
  if (!q || a.reply !== rp || a.st.b[q.sq] !== q.p || !!a.st.w !== myPov(a.it)) return;
  var due = rp.show && a.sol && a.sol[a.solIdx] ? uciToMove(a.st, a.sol[a.solIdx]) : null;
  if (rp.show ? !(due && due.from === q.sq) : !legalMoves(a.st).some(function (m) { return m.from === q.sq; })) return;
  a.sel = q.sq;
  snd('tap');
  paintBoard(a, true);
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
  /* the question's end (F10.1): the guess judged now at the latest, and
     said in row 2 before what the reply did */
  if (a.guessOn) {
    a.guessOn = false;
    if (a.guess && !a.guess.skip) { guessResult(a); a.replySaid = guessWords(a.guess, rp.san).concat(a.replySaid || []); }
    noteGuess(a);
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
  noteTry(a, why);
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
  /* an automatic hint due counts as shown for a reload, which opens the
     card asking again */
  ss.progress[a.key] = { m: a.misses, h: a.hints + (a.autoDue ? 1 : 0), g: a.triedGameMove ? 1 : 0, f: a.foundGood || null, a: a.attempts, p: a.predraw ? 1 : 0, au: (a.autoH || 0) + (a.autoDue ? 1 : 0), gm: a.game ? 1 : 0,
                         fc: a.fc || '', tr: (a.tries || []).slice(-2).map(function (x) { return [x.d, x.u, x.took, x.mate ? 1 : 0, x.lost ? 1 : 0, x.san]; }), sl: a.slips || 0, ss: a.slipSan || '' };
  saveSession();
}
/* a miss is kept at once, and brings an automatic hint for players who
   need it: at the first miss at tier 1, at the second at tier 2, never at
   tier 3. It is the next hint not yet shown (F1.1: a hint never repeats one
   already shown, the worked example's own included, so after hint 1 it is
   hint 2), once per showing. The hint shows on Try again; no number of
   misses shows the answer */
function escalate() {
  var a = ui.session.active, autoAt = a.tier === 1 ? 1 : (a.tier === 2 ? 2 : 0);
  /* the automatic hint is counted apart: at tier 1 it comes with its miss
     as one help step (F2.1's stars). V2.3: it counts when it shows (Try
     again), not at the miss, so the bar over the try never reads "No more
     hints" while it is unseen, and See it leaves "Hint" there */
  if (autoAt && a.misses === autoAt && a.hints < hintMax(a)) a.autoDue = 1;
  keepProgress(a);
}
/* the automatic hint due, now shown: true when one was added */
function applyAutoHint(a) {
  if (!a.autoDue) return false;
  a.autoDue = 0;
  if (a.hints >= hintMax(a)) return false;
  a.hints++; a.hintAt = a.misses; a.autoH = (a.autoH || 0) + 1;
  return true;
}
/* a wrong try's check step (F1.2), as its reason found it (why.d: 3 the
   try created the loss, 1 the danger was already there, 2 a harmless try
   on a your-chances card, 0 anything else), with what its reply did, for
   F1.3's repeated danger: kept on the card for this showing, and written
   to the position's record (rec.fc, the last 8) when the showing ends */
function noteTry(a, why) {
  if (!why) return;
  a.fc = ((a.fc || '') + (why.d || 0)).slice(-8);
  (a.tries = a.tries || []).push({ d: why.d || 0, u: why.u || '', took: why.took || '', mate: !!why.mate, lost: !!why.lost, san: why.rs || '' });
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
  /* lost: the piece their reply takes, shown as a token once See it plays it;
     chip: the check step the miss failed (F1.2), for the tag row at tiers 2
     and 3 */
  a.tried = { from: m.from, to: m.to, uci: moveUci(m), san: sanOf(a.st, m), kind: kind,
              reply: r ? reply : null, seen: false, threat: (why && why.threat) || null, lost: took ? { sq: r.ep >= 0 ? r.ep : r.to, p: took } : null,
              chip: kind === 'miss' && why && why.chip && a.tier >= 2 ? why.chip : '' };
  /* V2.2: the line See it steps through, their reply first, to where it
     settles or to its event (8 plies at most from the try), and the event
     its still marks point to */
  if (r && kind === 'miss' && why && why.pv && why.pv.length >= 2 && why.pv[0] === a.tried.uci && why.pv[1] === reply) seeLine(a, a.tried, why);
  else if (r) { a.tried.line = [reply]; a.tried.step = 0; }
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
   dashed red arrow draws, from the attacker's square to
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
   line's next move: what no mark may give away before an answer */
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
  /* See it played their reply, and then the line's moves one a tap (V2.2) */
  var line = t.line || (t.reply ? [t.reply] : []), n = t.seen ? Math.max(1, t.step || 1) : 0;
  for (var i = 0; i < n && i < line.length; i++) {
    var r = uciToMove(st, line[i]);
    if (!r) break;
    applyMove(st, r);
    last = [r.from, r.to];
  }
  return { st: st, last: last };
}
/* what a tap on the board does while a try is on it: one of your pieces
   that stands on the same square in the card's position is picked up there
   (its square); the tried piece itself (a castled rook too), or anything of
   yours that is not where it stands in the card's position, only takes the
   try back with nothing picked up (TRY_ONLY), since picking it up on its old
   square would play from a board the player is not looking at (I1); -1 for
   anything else */
var TRY_ONLY = -2;
function triedPick(a, sq) {
  var p = triedFrame(a).st.b[sq], t = a.tried;
  if (!p || isW(p) !== a.st.w) return -1;
  var m = uciToMove(a.st, t.uci);
  if (sq === t.to) return TRY_ONLY;
  if (m && m.castle && sq === t.to + (m.castle === 'O-O' ? -1 : 1)) return TRY_ONLY;
  return a.st.b[sq] === p ? sq : TRY_ONLY;
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
   castled rook too), as where it came from; -1 for anything else */
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
  /* the automatic hint this miss brought shows now (V2.3) */
  a.autoAdded = applyAutoHint(a);
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
   search stops and its answer is ignored (a new token) and the attempt is
   undone. A tap on the moved piece takes it back with nothing picked up:
   picking it up on its old square would play from a board the player was
   not looking at (as a tap on a try, I1) */
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
  /* the app added a hint itself: it says so (V2.3) */
  if (a.autoAdded) { a.autoAdded = false; notice(HINT_ADDED(a.hints), null, 3000); }
  /* a tap on a piece took it back: that piece is picked up */
  if (sel != null && sel >= 0) { a.sel = sel; snd('tap'); }
  /* a fact sheet that landed meanwhile takes the card's place now (V1.1) */
  if (a.keyDue && factsSwap(a)) return;
  renderCard();
}
/* V2.2: the line See it plays, one move a tap: the try's line (why.pv,
   the try first) to its settle ply, or on to its event where that comes
   later (the pawn race's promotion), 8 plies at most from the try; the
   event (why.ev) as See it's first frame draws it still: your take-back,
   then the event's move. t.line: their reply first; t.step: the plies of it
   on the board; t.ev: {back, move, say} the still marks' moves (uci) */
var SEE_PLIES = 8;
function seeLine(a, t, why) {
  var pv = why.pv, s = settleLine(a.st, pv), ev = why.ev, end = Math.max(s.k, ev && ev.at != null ? ev.at + 1 : 0);
  end = Math.max(2, Math.min(end, SEE_PLIES, lineNodes(a.st, pv).length));
  t.line = pv.slice(1, end);
  t.step = 0;
  /* (a loss said as a count, "You'd lose the bishop.", has no one move to
     draw: no event arrow) */
  if (ev && ev.n && ev.t !== 'loss' && ev.at != null && ev.at < end) {
    var say = ev.t === 'fork' || ev.t === 'backFork' ? 'fork' : ev.t === 'promo' ? PIECE_WORD[pType(ev.n.m.promo)] : ev.t === 'mate1' || ev.t === 'backMate' || ev.t === 'forced' ? 'mate' : 'takes';
    /* a promotion is drawn as the pawn's path, from where it stands once
       See it has played their reply to where it queens */
    var from = ev.n.m.from, sqAt = null;
    if (ev.t === 'promo') {
      var ps = lineNodes(a.st, pv.slice(0, ev.at));
      for (var i = ps.length - 1; i >= 2; i--) if (ps[i].m.to === from && pType(ps[i].before.b[ps[i].m.from]) === 'P') from = ps[i].m.from;
      /* where the pawn stands after each move See it plays */
      sqAt = { 1: sqName(from) };
      for (var j = 2, cur = from; j < ps.length; j++) { if (ps[j].m.from === cur) cur = ps[j].m.to; sqAt[j] = sqName(cur); }
    }
    t.ev = { at: ev.at, back: ev.back ? moveUci(ev.back.m) : null, backAt: ev.back ? ev.at - 1 : -1, backP: ev.back ? pType(ev.back.before.b[ev.back.m.from]) : '',
             move: sqName(from) + sqName(ev.n.m.to), sqAt: sqAt, p: pType(ev.n.before.b[ev.n.m.from]), say: ev.t === 'forced' && ev.at === 1 ? '' : say };
  }
}
/* See it: their reply to the try, played on the player's tap; then (V2.2)
   each further move of the line, one a tap, as See why steps */
function seeIt() {
  var a = ui.session && ui.session.active, t = a && a.tried;
  if (!t || a.phase !== 'tried' || !t.reply) return;
  if (t.seen) { seeStep(a, t); return; }
  t.seen = true;
  t.step = 1;
  /* the reason's ring and arrow ride the slide only if already drawn */
  t.ringed = a.reason >= 1;
  /* the words about to change (the bar's See it) fade out first (2.2), then
     it slides as a move the app shows, its sound as it starts, along the
     reason's arrow; as it lands the ring and arrow go and what it took
     comes (a token). The bar changes after that */
  a.animMove = triedFrame(a).last;
  a.moveCue = true;
  /* pressed from the keyboard: its slot turns into Hint 2 (or Show the
     answer) as the reply lands, so the keyboard goes where Enter goes, the
     right-hand Try again (S20); a pointer's click left no focus there */
  var bar = el('cbar'), f = document.activeElement;
  if (bar && f && bar.contains && bar.contains(f) && !seeMore(t)) a.focusRight = true;
  renderCard(['fade', reducedMotion() ? 0 : TEXT_OUT, 'board', 'land', 'text']);
}
/* the next move of the line See it plays (Next move ›, →), as a move the
   app shows, to the line's last */
function seeStep(a, t) {
  if (!t.line || t.step >= t.line.length) return;
  t.step++;
  a.animMove = triedFrame(a).last;
  a.moveCue = true;
  var bar = el('cbar'), f = document.activeElement;
  if (bar && f && bar.contains && bar.contains(f) && t.step >= t.line.length) a.focusRight = true;
  renderCard(['fade', reducedMotion() ? 0 : TEXT_OUT, 'board', 'land', 'text']);
}
/* the line See it still has to play */
function seeMore(t) { return !!t && t.seen && !!t.line && t.step < t.line.length; }
/* the engine could not answer: the try stays where it is, and is not counted */
function cannotCheck(a, m) {
  a.checkTok = ++checkSeq;
  showTry(a, m, 'unchecked', null);
}
/* ask the engine about a move, from the same position, at the same depth
   the best move was measured at */
var checkSeq = 0;
function checkMove(m, u, inLine) {
  var ss = ui.session, a = ss.active;
  /* no engine at all: the try is shown, never counted as a miss */
  if (SF.state === 'failed') { a.animMove = a.tapAnim; a.tapAnim = null; cannotCheck(a, m); return; }
  /* a device with one analyst: a fact sheet's search in the background
     (V1.1) gives way to the try, and is made again later */
  if (SF.workers.length < 2) engineStop(function (j) { return /^k:/.test(j.tag || ''); });
  a.phase = 'checking';
  a.ghostMove = [m.from, m.to];
  a.checking = sanOf(a.st, m);
  a.checkingW = moveWords(a.st, m);
  a.checkSaid = 0;
  /* the checking frame draws the move: it slides there, once */
  a.animMove = a.tapAnim; a.tapAnim = null;
  renderCard();
  var cardKey = a.key, fen = stateFen(a.st);
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
  var t0 = Date.now(), timer = setTimeout(function () {
    var a2 = ui.session && ui.session.active;
    if (live(a2)) cannotCheck(a2, m);
  }, 9000);
  /* one search, two candidates: the tried move and the expected one are
     scored side by side, so depth noise cannot decide the verdict */
  var expect = inLine ? a.sol[a.solIdx] : a.bestUci;
  /* tagged, so Try again, Show the answer and leaving the card stop it */
  /* the re-check starts from a clean engine with the harness's options,
     as a fact sheet's searches do (B1: fresh) */
  var search = function (nodes) {
    return engineEval(fen, { nodes: nodes }, true, { searchmoves: expect && expect !== u ? [u, expect] : [u], multipv: expect && expect !== u ? 2 : 1, tag: 'check', fresh: nodes >= CONFIRM_NODES });
  };
  search(inLine ? EXT_NODES : DEEP_NODES).then(function (r) {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (!live(a2)) return;
    /* a first answer is never the 1,000,000-node depth the found band asks
       (V1.2): its comparative words wait for the re-check */
    var v = tryVerdict(a2, u, expect, r, inLine, false), left = t0 + RECHECK_MS - Date.now();
    v.deep = false;
    /* a foil passes any move short of the player's mistake threshold for
       that game (D10); at or over it the try is a miss, said as any is. B9:
       a miss is graded, and said, by the 1,000,000-node re-check where it
       answers in time (foil:184364964898:45's Ne5: its reply f3, "Then f3
       attacks your bishop.", never the shallow search's Nxe2) */
    if (a2.foil) {
      var foilEnd = function (v1) {
        var a3 = ui.session && ui.session.active;
        if (!live(a3)) return;
        a3.ghostMove = null;
        if (v1.wBest - v1.wMove < mistakeMinFor(a3.it.g)) foilPass(m, v1.wBest - v1.wMove);
        else miss(m, u, { cp: v1.myCp, mate: v1.myMate, pv: v1.line.pv || [], win: v1.wMove, deep: !!v1.deep }, false);
      };
      if (v.wBest - v.wMove < mistakeMinFor(a2.it.g) || left <= 0) { foilEnd(v); return; }
      var fcap = setTimeout(function () { var a4 = ui.session && ui.session.active; if (live(a4)) { engineStop('check'); foilEnd(v); } }, left), fdone = false;
      search(CONFIRM_NODES).then(function (r2) {
        clearTimeout(fcap);
        if (fdone) return;
        fdone = true;
        var v2 = r2 && !r2.stopped ? tryVerdict(a2, u, expect, r2, inLine, true) : v;
        if (v2 !== v) v2.deep = true;
        foilEnd(v2);
      }, function () { clearTimeout(fcap); if (!fdone) { fdone = true; foilEnd(v); } });
      return;
    }
    if (left <= 0 || !recheckBand(a2, v)) { applyTry(a2, m, u, inLine, v); return; }
    /* F10.4, V1.3: the second search decides, unless the first verdict's
       8 s from the try run out first (the band still says "Checking…") */
    var rc = a2.rc = a2.rc || { n: 0, flip: 0, late: 0 }, settled = false;
    rc.n++;
    var cap = setTimeout(function () {
      var a3 = ui.session && ui.session.active;
      if (settled || !live(a3)) return;
      settled = true;
      rc.late++;
      engineStop('check');
      applyTry(a3, m, u, inLine, v);
    }, left);
    var decide = function (v2) {
      clearTimeout(cap);
      var a3 = ui.session && ui.session.active;
      if (settled || !live(a3)) return;
      settled = true;
      if (v2.kind !== v.kind) rc.flip++;
      applyTry(a3, m, u, inLine, v2);
    };
    search(CONFIRM_NODES).then(function (r2) {
      var v2 = r2 && !r2.stopped ? tryVerdict(a2, u, expect, r2, inLine, true) : v;
      if (v2 !== v) v2.deep = true;
      decide(v2);
    }, function () { decide(v); });
  }, function () {
    clearTimeout(timer);
    var a2 = ui.session && ui.session.active;
    if (live(a2)) cannotCheck(a2, m);
  });
}
/* a try's verdict from a search r that scored it (and the expected move,
   expect): 'solved', 'close' or 'miss', with the figures it was read from */
function tryVerdict(a, u, expect, r, inLine, deep) {
  var b = a.it.b, sign = myPov(a.it) ? 1 : -1, mine = null, theirs = null;
  (r.lines || []).forEach(function (ln) {
    if (ln.pv && ln.pv[0] === u) mine = ln;
    else if (ln.pv && ln.pv[0] === expect) theirs = ln;
  });
  mine = mine || r;
  var v = tryKind(a, mine.cp * sign, mine.mate != null ? mine.mate * sign : null, theirs ? winPct(theirs.cp * sign) : winPct(b.eb), inLine, deep);
  v.line = mine;
  return v;
}
/* the verdict from a try's score (myCp, myMate) against the best's win
   chance, from the player's side. band 'found' (V1.2): within 4 points of
   the best, or a mate kept on a mate card: the answer's equal, graded as
   the best move; 'safe': a safe win more than 4 points below (the lesson is
   not a missed chance), works too and holds; else a good move that is not
   the best (closeTry) or a miss */
function tryKind(a, myCp, myMate, wBest0, inLine, deep) {
  var b = a.it.b, wMove = winPct(myCp), wBest = Math.max(wBest0, wMove);
  var mateCard = b.mb != null && b.mb > 0;
  var keepsMate = myMate != null && myMate > 0;
  /* a safe winning move passes, except on a missed chance, where the
     lesson is the tactic itself: there a lesser move is only "close" */
  var chances = familyOf(patternOf(b)).key === 'chances';
  var safeWin = wMove >= 70 && wBest >= 70 && wMove >= b.wa + 15 && !chances;
  var found = mateCard ? keepsMate : (wBest - wMove <= SOLVE_TOL || keepsMate);
  var band = found ? 'found' : !mateCard && safeWin ? 'safe' : '';
  return { kind: band ? 'solved' : closeTry(b, wMove, wBest, mateCard, chances, inLine, deep) ? 'close' : 'miss', band: band,
           myCp: myCp, myMate: myMate, wMove: wMove, wBest: wBest, mateCard: mateCard, keepsMate: keepsMate, safeWin: safeWin };
}
/* a try among the key's three lines (V1.1), on the card's own position:
   its verdict at the key's depth, with no search; null when the key has
   no line for it (or is not the card's: its answer differs) */
function keyVerdict(a, u) {
  var k = factsOf(a.it.b);
  if (!k || k.x || a.foil || a.prac || (a.sol && a.solIdx > 0) || k.a !== a.bestUci) return null;
  var ls = factsLines(k), l = ls.filter(function (x) { return x.u === u; })[0];
  if (!l) return null;
  var v = tryKind(a, l.cp, l.mate, winPct(ls[0].cp), false, true);
  v.line = { pv: l.pv };
  v.deep = true;
  return v;
}
/* F10.4, V1.3 (at every tier): a try whose first score lands within 12
   points of a verdict line (the found band, 4; the good-move band, 10; the
   player's big-mistake threshold) is searched again at 1,000,000 nodes:
   every gap up to the threshold and 12 more; not where a mate decides. The
   second search decides; if it has not answered RECHECK_MS after the try,
   the first verdict stands (a 1,000,000-node search takes 4 to 10 s on a
   weak phone), with no comparative words (its depth is not the key's) */
var RECHECK_MS = 8000, RECHECK_NEAR = 12;
function recheckBand(a, v) {
  if (v.mateCard || v.keepsMate) return false;
  return v.wBest - v.wMove <= Math.max(SOLVE_TOL, STRONGER_TOL, mistakeMinFor(a.it.g)) + RECHECK_NEAR;
}
/* the verdict, given: solved, a good move that is not the best, or a miss */
function applyTry(a2, m, u, inLine, v) {
  a2.ghostMove = null;
  var r = v.line;
  if (v.kind === 'solved') {
    var cont = r.pv && r.pv[0] === u ? r.pv.slice(1) : (r.pv || []);
    var before = inLine ? a2.sol.slice(0, a2.solIdx) : [];
    a2.yours = { uci: before.concat([u], cont), cp: v.myCp, at: before.length };
    solved(m, u, { win: v.wMove, best: v.wBest, mate: v.myMate, band: v.band, deep: !!v.deep, san: sanOf(a2.st, m), w: moveWords(a2.st, m) }, inLine);
    return;
  }
  /* V1.9: at More help a try that takes the attacked piece to safety and
     scores 10 points or more above the game move is a good move (it holds:
     two stars); at Normal and Less help it stays a miss whose reason starts
     "Safe, but" (R5.4, V2.2). Saved: read from the exchange on its square
     after their reply (B7). A try that saved it is kept for the answer's
     words (a.savedBy: "Qd7+ saved it too.") */
  var save = !inLine && !a2.foil && (a2.tier === 1 || v.kind !== 'close') ? savingTry(a2, m, u, v) : null;
  if (save && !a2.savedBy) a2.savedBy = { san: sanOf(a2.st, m), p: save.p };
  var pv = r.pv && r.pv.length ? (r.pv[0] === u ? r.pv : [u].concat(r.pv)) : [u];
  if (save && a2.tier !== 1) { backCheck(a2, m, pv, function (bk) { miss(m, u, { cp: v.myCp, mate: v.myMate, pv: r.pv || [], win: v.wMove, wBest: v.wBest, deep: !!v.deep, save: save, back: bk }, inLine); }); return; }
  if (v.kind === 'close' || save) {
    /* a good move that is not the best: not a miss (S5). The first one is
       remembered, so a later solve or the answer counts as help; a second
       says row 1 alone. B3: one inside a forcing line holds the line's step
       too (a.lineGood: the line's own move there, "Nxa8 was stronger
       later."), and the line goes on from the same position */
    var again = !!a2.foundGood;
    if (!again) {
      track('close_shown');
      a2.foundGood = { san: sanOf(a2.st, m), win: v.wMove };
      keepProgress(a2);
    }
    if (inLine && !a2.lineGood) { var due2 = uciToMove(a2.st, a2.sol[a2.solIdx]); a2.lineGood = { san: due2 ? sanOf(a2.st, due2) : '' }; }
    a2.cue = 'tap';
    showTry(a2, m, 'close', null, save ? { save: save.p } : null, again);
    return;
  }
  backCheck(a2, m, pv, function (bk) { miss(m, u, { cp: v.myCp, mate: v.myMate, pv: r.pv || [], win: v.wMove, wBest: v.wBest, deep: !!v.deep, back: bk }, inLine); });
}
/* B6 (c): their reply takes a piece of yours that you could take back on
   its square, and the line plays something else: the take-back is searched
   (250,000 nodes, a clean engine) before the reason is said, under
   "Checking…", so row 2 can say why it fails ("Bxc3+, and bxc3 Qxc3+
   forks."). done(back) with {pv (the take-back first), cp, mate (the
   player's side)} or null: none needed, the engine down, or the try taken
   back meanwhile (then done never runs) */
function backNeed(a, pv) { return takeBackNeed(a.st, pv, myPov(a.it)); }
function backCheck(a, m, pv, done) {
  var need = SF.state !== 'failed' && !a.prac ? backNeed(a, pv) : null;
  if (!need) { done(null); return; }
  var tok = a.checkTok = a.checkTok || ++checkSeq, key = a.key, sign = myPov(a.it) ? 1 : -1;
  if (a.phase !== 'checking') {
    a.phase = 'checking';
    a.animMove = a.tapAnim; a.tapAnim = null;
    a.ghostMove = [m.from, m.to];
    a.checking = sanOf(a.st, m);
    a.checkingW = moveWords(a.st, m);
    a.checkSaid = 0;
    renderCard();
  }
  var live = function (a2) { return a2 && a2.key === key && a2.phase === 'checking' && a2.checkTok === tok; };
  var after = cloneState(need.st);
  applyMove(after, need.m);
  var fin = function (bk) { var a2 = ui.session && ui.session.active; if (!live(a2)) return; a2.ghostMove = null; done(bk); };
  if (!legalMoves(after).length) { fin({ pv: [moveUci(need.m)], cp: null, mate: null }); return; }
  engineEval(stateFen(after), { nodes: DEEP_NODES }, true, { tag: 'check', back: 1, fresh: true }).then(function (r) {
    fin(r && !r.stopped ? { pv: [moveUci(need.m)].concat(r.pv || []), cp: r.cp * sign, mate: r.mate != null ? r.mate * sign : null } : null);
  }, function () { fin(null); });
}
/* V1.9's saving move, B7's reading: the try moves a piece in danger on the
   card's own position (the danger facts' attacked pieces), their reply does
   not win it on its new square (it takes it there only where the exchange
   pays them nothing), and it scores 10 points or more above the game move:
   card 1's Qd7+ (Rf7 attacks the queen, which then moves on), Qh3 and Qg4.
   {p (the piece's letter)} or null */
function savingTry(a, m, u, v) {
  if (a.sol && a.solIdx > 0) return null;
  var dv = dangerView(a), b = a.it.b;
  if (!dv || !dv.attacked.some(function (x) { return x.sq === m.from; }) || !(v.wMove >= b.wa + 10)) return null;
  var pv = v.line && v.line.pv && v.line.pv.length ? (v.line.pv[0] === u ? v.line.pv : [u].concat(v.line.pv)) : [u];
  var st = cloneState(a.pre), tm = uciToMove(st, u);
  if (!tm) return null;
  applyMove(st, tm);
  var r = pv[1] ? uciToMove(st, pv[1]) : null;
  if (r && (r.ep >= 0 ? r.ep : r.to) === tm.to && dzSeeMove(st.b, r.from, tm.to) > 0) return null;
  return { p: pType(a.pre.b[m.from]) };
}
/* the close rule (S5), the one path for a good move that is not the best:
   a move that loses nothing by the card's own measure (within STRONGER_TOL
   of b.eb; every card's game move lost more than that, so it is always
   better than the game move); or one within STRONGER_TOL of the best move
   in this search, or on a missed chance one that keeps a big edge, when it
   is clearly better than the game move; on a mate card a move that still
   wins big. Never inside a forcing line */
function closeTry(b, wMove, wBest, mateCard, chances, inLine, deep) {
  /* B3: within 10 points of the best and both at 70% or more, by the key
     or the 1,000,000-node re-check (deep): a first try that beats the game
     move (184434540700:103's Ra1), or a step inside a forcing line (the
     knight line's gxf3) */
  if (deep && !mateCard && wBest - wMove <= STRONGER_TOL && wMove >= 70 && wBest >= 70 && (inLine || wMove > b.wa)) return true;
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
  /* V1.6: after the line's right first move a miss holds the rung (graded
     with a hint), so it never breaks the run; the move due there is the one
     row 2 says was missed */
  if (a.sol && a.solIdx > 0) {
    a.slips = (a.slips || 0) + 1;
    if (!a.slipSan) { var due0 = uciToMove(a.st, a.sol[a.solIdx]); a.slipSan = due0 ? sanOf(a.st, due0) : ''; }
  } else if (preMisses(a) === 1) a.runBroke = srsNoteMiss(it) > 0;
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
  /* the try's line read to its decisive event (V2.2): the key's line for
     it, the re-check's, else the first search's (deep false: band words
     then need their margin) */
  var why = missWhy(a, c, info ? info.win : null, r1 ? sanOf(r1.before, r1.move) : null,
                    !!inLine && !concrete && !!info && info.win >= winPct(it.b.eb) - STRONGER_TOL, r1 ? moveWords(r1.before, r1.move) : null,
                    { pv: [u].concat(reply), deep: !!(info && info.deep), mate: info ? info.mate : null, cp: info && info.cp != null ? info.cp : null, back: info ? info.back : null, wBest: info ? info.wBest : null, save: info ? info.save : null });
  /* the reply that punishes it is marked when it captures or checks and
     the try loses something by it */
  why.threat = concrete ? threatOf(c.gameLine, 1) : null;
  a.hintAfter = false;
  noteTry(a, why);
  escalate();
  showTry(a, m, 'miss', reply[0], why);
}
/* a foil passed (F8.2): the move stays on the board, its verdict by what it
   lost against the best move: 4 points or less "Good, nothing to fix" (a
   filled tick), more "Playable" (the ring with a tick, as a good move that
   is not the best). Never scheduled: finishCard writes no record */
function foilPass(m, loss) {
  var a = ui.session.active;
  applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.animMove = a.tapAnim || null; a.tapAnim = null;
  a.foilKind = loss <= FOIL_GOOD ? 'good' : 'playable';
  a.foilGame = moveUci(m) === a.playedUci;
  a.cue = a.foilKind === 'good' ? 'good' : 'tap';
  finishCard(a.misses ? 'retry' : a.hints ? 'hint' : 'first');
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
  var ss = ui.session, a = ss.active, first = !(a.sol && a.solIdx > 0);
  if (m) {
    if (!first) noteWon(a, m);
    applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.animMove = a.tapAnim || null; a.tapAnim = null;
  }
  /* another move than the answer: in the found band (alt.band 'found') it
     is the answer's equal (V1.2: graded as the best move, first try climbs;
     a.near, its words said only where its depth is the key's or the
     re-check's: deep); a safe win more than 4 points below works too and
     holds (a.alt). Later in a forcing line a step in the found band simply
     continues as found (V1.6) */
  var other = !!alt && u !== a.bestUci, b = a.it.b;
  /* B2: a try that forces mate, where the answer does not (or only later),
     is the answer: found, it climbs, its own mate row; never "works too" */
  var mateTry = other && first && alt.mate != null && alt.mate > 0 && !(b.mb != null && b.mb > 0 && b.mb <= alt.mate);
  a.mateTry = mateTry ? { san: alt.san, w: alt.w, n: alt.mate } : null;
  a.alt = other && !mateTry && alt.band !== 'found' ? alt : null;
  a.near = other && first && !mateTry && alt.band === 'found' ? alt : null;
  /* the board then shows the player's own line (a.yours), which the story
     and the settled board tell */
  a.own = other;
  var result = preMisses(a) ? 'retry' : ((a.hints || a.foundGood || a.slips) ? 'hint' : 'first');
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
  var inLine = !!(a.sol && a.solIdx > 0);
  if (!inLine) { a.st = cloneState(a.pre); a.lastMove = a.preLast; }
  /* V1.6: shown later in a forcing line, once its first move was found, the
     card holds its rung (graded with a hint), never "Shown"; row 2 names the
     move due there as the one missed */
  if (inLine) {
    a.lineHeld = true;
    if (!a.slipSan) { var due1 = uciToMove(a.st, a.sol[a.solIdx]); a.slipSan = due1 ? sanOf(a.st, due1) : ''; }
  }
  /* the summary says it was shown (S17); a relearn card keeps its first note */
  if (!inLine || preMisses(a)) (ui.session.notes = ui.session.notes || {})[a.key + (ss_relearn(a) ? '#r' : '')] = 'shown';
  /* graded at once (a close move found first makes it a hint), so leaving
     the card from here never grades it again; then the answer is shown */
  finishCard(inLine ? (preMisses(a) ? 'retry' : 'hint') : a.foundGood && !a.misses ? 'hint' : 'fail', still && !a.jump ? MARKS_THEN_WORDS : null);
}
/* the move the reveal shows now (S7): the forcing line's next move of
   yours, else the card's answer; null once it is played */
function showDue(a) {
  if (!a.view || a.view.mode !== 'show') return null;
  if (a.sol) return a.solIdx < a.sol.length && !!a.st.w === myPov(a.it) ? uciToMove(a.st, a.sol[a.solIdx]) : null;
  return a.showDone ? null : uciToMove(a.st, a.bestUci);
}
/* V1.2: after Show the answer, another move in the shown move's found band
   (the key's lines within 4 points of its best, on the card's own position,
   before any move of a line is played) plays as the shown move does, graded
   Shown as the reveal graded it, instead of being refused */
function showNearMoves(a) {
  var k = factsOf(a.it.b);
  if (!k || k.x || !a.view || a.view.mode !== 'show' || a.showDone || (a.sol && a.solIdx > 0) || k.a !== a.bestUci) return [];
  var ls = factsLines(k), w0 = winPct(ls[0].cp), out = [];
  ls.slice(1).forEach(function (l) {
    var m = w0 - winPct(l.cp) <= SOLVE_TOL ? uciToMove(a.st, l.u) : null;
    if (m) out.push(m);
  });
  return out;
}
/* such a move played by hand: tapped it slides, dragged it lands where it
   was dropped, with the grey i badge; the card settles as a shown line does */
function playNear(a, m, dragged) {
  a.sel = -1;
  applyMove(a.st, m);
  a.lastMove = [m.from, m.to];
  a.markMove = { from: m.from, to: m.to, kind: 'info' };
  a.fxn = (a.fxn || 0) + 1;
  a.animMove = dragged ? null : [m.from, m.to];
  a.animShown = false;
  a.moveCue = !dragged;
  a.showDone = true;
  a.shownNear = moveUci(m);
  settleShown(a);
  renderCard();
}
/* Play it (S7): the answer shown is played, as a move the app shows (320
   ms, its sound as it starts); it lands with the grey i badge and tints,
   and the band stays. Inside a forcing line their reply follows as the
   forcing reply does, and the next move of yours is shown the same way.
   At the end of the line (at once on a one-move card) the card settles:
   S0's marks, then R4 and the bar to the story. Played by hand (byHand)
   it goes at once, as the player's own moves do: tapped it slides, dragged
   it lands where it was dropped. Their reply plays on S10's timeline, and
   waits for "Their reply" under reduced motion */
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
/* See why (S12): from S0 (See why, →, a left swipe) the story opens at
   G1, or at B1 on a card found (release 3). A revealed card offers it once
   settled */
function seeWhy() {
  var a = ui.session && ui.session.active;
  /* a foil had nothing wrong: no story to tell (F8.2); a practice position
     has no game to tell (F9.4) */
  if (!a || a.foil || a.prac || a.phase !== 'done' || a.explore || !a.lines || !a.view || a.view.mode !== 's0' || a.settle < (a.revealed ? 2 : 0)) return;
  a.settle = 2;
  /* release 3: a card you found yourself (first try, or after a hint or a
     miss) opens on why the move works; your game is the strip's first tap */
  var S = buildStory(a), found = !a.revealed && !a.alt && S.steps.length > S.g;
  storyGo(a, found ? S.g : 0, true);
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
  /* the danger frame (F1.5) is still: a jump to the card's position with
     its marks, the caption after them, once the bar that faded out at the
     tap takes taps again (SLOT_GUARD), so its first visible tap works; the
     next step plays the game move */
  if (s.df) {
    a.view = { mode: 'story', i: j }; a.jump = true;
    renderCard(['fade', rm ? 0 : TEXT_OUT, 'board', 'land'].concat(rm ? [] : [SLOT_GUARD - TEXT_OUT - XFADE], ['text']));
    return;
  }
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
var HINT_ADDED = function (n) { return 'Hint ' + n + ' added.'; };
function giveHint() {
  var a = ui.session && ui.session.active;
  /* no hint left (Hint 3 at More help, F9.2): nothing at all, a try on the
     board stays (? pressed then) */
  if (!a || a.phase === 'lesson' || a.hints >= hintMax(a)) return;
  /* pressed while a try is shown, or over a move being checked while the
     guess bar still offers Hint (before K1): it goes first, the board
     crossfading back, the words after it */
  var cleared = a.phase === 'tried' || (a.phase === 'checking' && !a.checkSaid);
  /* pressed over a try whose miss brought an automatic hint: that hint is
     the one given (V2.3), never one more */
  var auto = false;
  if (a.phase === 'tried') { clearTry(a); auto = !!a.autoAdded; a.autoAdded = false; }
  else if (cleared) dropCheck(a);
  if (a.phase !== 'guess') { if (cleared) renderCard(); return; }
  if (!auto) a.hints = a.hints + 1;
  a.hintAt = a.misses;
  a.hintAfter = true;
  keepProgress(a);
  if (cleared) holdMarks(a);
  /* from the card itself only its marks change: they are drawn, then the
     words 150 ms later, never in the same frame (principles 1 and 2) */
  renderCard(cleared ? null : MARKS_THEN_WORDS);
}
/* the marks a hint draws (S8), from the card's hint state,
   on the position the card asks from: hint 2 is the gold ring on the piece
   to move (the answer due now, so inside a forcing line the step's own
   piece); hint 1 on the card's first move is the danger (F1.1, dangerHint:
   the danger both last tries ran into, F1.3, first), and where the danger
   facts give none, today's: on a missed-chance card a dashed gold ring on
   the prize (hintPrize), else the danger the game move ran into
   (hintDanger): the piece that punishes it ringed, a dashed arrow to what
   it takes or checks. Inside a forcing line hint 1 is words only. A hint-1
   mark never touches the answer's to-square (2.3, both arrow ends), nor its
   from-square, except for the player's own attacked piece (the danger's
   red ring and its attackers' arrows): what is attacked is the lesson,
   where it goes is the answer. The two hints never share a frame, so "the
   circled piece" is always one piece. {rings, arrows, prize, danger, dz
   (the danger hint), rep (both tries' danger)}; drawn only while the card
   asks (guess) */
function hintMarks(a) {
  var out = { rings: [], arrows: [], prize: null, danger: null, dz: null, rep: null, reds: [] };
  if (!a || !(a.hints >= 1) || a.phase === 'lesson') return out;
  var due = dueMove(a);
  /* Hint 3 (F9.2): the circled piece, and red where it would be lost */
  if (a.hints >= 3 && hint3Of(a)) { out.rings.push({ sq: due.from, kind: 'hint' }); out.reds = hint3Of(a).red.slice(); return out; }
  /* a practice position (F9.4): hint 1 the danger on its board where that
     is the skill (pracDanger), hint 2 the circled piece */
  if (a.prac) {
    if (a.hints >= 2) { out.rings.push({ sq: due.from, kind: 'hint' }); return out; }
    var pd = pracDanger(a);
    if (pd) { out.dz = pd; out.rings = pd.rings.slice(); out.arrows = pd.arrows.slice(); }
    return out;
  }
  /* game mode (F8.1), on the card's first move: hint 1 is the check's
     question, words only (both tries' danger, F1.3, takes its place, as it
     names neither the answer nor the game move); hint 2 the danger on the
     board as it stands (gameDanger), else the circled piece */
  if (a.game && !(a.sol && a.solIdx > 0)) {
    if (a.hints >= 2) {
      var gd = gameDanger(a);
      if (!gd) { out.rings.push({ sq: due.from, kind: 'hint' }); return out; }
      out.dz = gd; out.rings = gd.rings.slice(); out.arrows = gd.arrows.slice();
      if (gd.loose) out.prize = gd.loose;
      return out;
    }
    var gr = repeatedDanger(a);
    if (gr) { out.rep = gr; out.rings = gr.rings.slice(); out.arrows = gr.arrows.slice(); }
    return out;
  }
  if (a.hints >= 2) { out.rings.push({ sq: due.from, kind: 'hint' }); return out; }
  if (a.sol && a.solIdx > 0) return out;
  var rep = repeatedDanger(a), dz = rep ? null : dangerHint(a);
  if (rep || dz) {
    out.rep = rep; out.dz = dz;
    out.rings = (rep || dz).rings.slice(); out.arrows = (rep || dz).arrows.slice();
    if (dz && dz.loose) out.prize = dz.loose;
    return out;
  }
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
/* hint 1's danger on the card's first move (F1.1), from its danger facts
   (dangerView) on the card's own position, by the check step:
     1, their move: their mate threat (the null-move search's mate in one:
       the mating square ringed, the mating piece's dashed arrow), else the
       player's attacked pieces (dangerPick: up to two ringed, the piece the
       better line saves first, and up to three attackers' arrows);
     2, your chances: their loose piece (the prize the best line wins,
       standing unguarded) ringed; a mate in one, in words only;
     3, a safety check: the attacks the game move creates (dangerCreated,
       drawn as the board stands after it), when that is the danger the game
       line plays (the piece it takes, or what its first reply takes), or
       the mate in one it allows; else a piece the better move keeps that
       the game line wins later, in words.
   In check, the check, in words. Their mate only while the game move leaves
   it standing; one it stopped gives what the game move allows instead
   (parried). Their threat is claimed only from a search that ran
   (searched), and a piece in danger only where it confirms the capture
   (B5: with no search, none). No mark on
   the answer's to-square. now (a game-mode card whose game move is not on
   the board yet, F8.1): only what stands on the board, never the game move
   or what it allows: their mate while they threaten it, the pieces in
   danger, else in words the piece the better move keeps ("Watch your
   queen.", the king for a mate the game move allows). {kind: check, mate,
   parried, attacked, mine, loose, made, madeMate, lost or watch, rings,
   arrows, ...} or null: none, and the step's check line stays (F2.3) */
function dangerHint(a, now) {
  var v = a.sol && a.solIdx > 0 ? null : dangerView(a);
  if (!v) return null;
  var due = dueMove(a), c = a.cls, b = a.it.b, threat = function (x, key) { return { from: x.from, to: x.to, kind: 'threat', key: key }; };
  var skip = function (f, t) { return f === due.to || t === due.to; };
  /* in check, the check is the danger, and no capture elsewhere is legal:
     words only (the coach's review: never their loose rook then) */
  if (v.check) return { kind: 'check', rings: [], arrows: [] };
  /* (B5: the red rings and their arrows only where a search confirmed the
     captures; before one, in words alone) */
  var attacked = function (list) {
    var pk = dangerPick(list, v.saves, skip);
    return pk ? { kind: 'attacked', named: pk.named, second: pk.second, rings: v.searched ? pk.rings : [], arrows: v.searched ? pk.arrows.map(function (x) { return threat(x, 'danger'); }) : [] } : null;
  };
  if (now && v.step === 3) return attacked(v.attacked) || (c.mateAgainst ? { kind: 'watch', piece: 'K', rings: [], arrows: [] } : v.saves.length ? { kind: 'watch', piece: v.saves[0], rings: [], arrows: [] } : null);
  if (v.step === 1) {
    var th = v.searched && v.threat && v.threat.mate === 1 ? v.threat : null;
    if (th && (th.stands || now)) {
      var nst = dzNullState(a.pre);
      return { kind: 'mate', mate: { from: th.from, to: th.to, san: capSan(nst, uciToMove(nst, th.uci)) },
               rings: skip(th.to, th.to) ? [] : [{ sq: th.to, kind: 'attacked', mate: true }], arrows: skip(th.from, th.to) ? [] : [threat(th, 'danger')] };
    }
    /* V2.3: their mate, which the game move stopped, beside a capture that
       already stood (184268949378:16's Qxf2 mate and Bxc3+): both drawn,
       as See why's danger frame draws them */
    var tt = th && !th.stands ? twoThreats(a) : null;
    if (tt && tt.mate) {
      var rmv = tt.reply.move, csq = rmv.ep >= 0 ? rmv.ep : rmv.to, m2 = uciToMove(tt.nst, moveUci(rmv));
      var trs = [], tas = [];
      if (!skip(tt.mate.to, tt.mate.to)) trs.push({ sq: tt.mate.to, kind: 'attacked', mate: true });
      /* (the capture's ring where the search confirms it: B5) */
      if (!skip(csq, csq) && csq !== due.from && v.attacked.some(function (x) { return x.sq === csq; })) trs.push({ sq: csq, kind: 'attacked' });
      if (!skip(tt.mate.from, tt.mate.to)) tas.push(threat(tt.mate, 'danger'));
      if (!skip(rmv.from, rmv.to) && rmv.to !== due.from) tas.push(threat(rmv, 'danger'));
      if (m2) return { kind: 'two', mate: { from: tt.mate.from, to: tt.mate.to }, mateSan: capSan(tt.nst, tt.mate), took: tt.reply.captured, san: sanOf(tt.nst, m2), rings: trs, arrows: tas };
    }
    /* their mate, which the game move stopped: what it allows instead (the
       game line's reply that punishes it, drawn as hintDanger draws it) */
    var hd = th ? hintDanger(a) : null;
    if (hd && !skip(hd.from, hd.to) && hd.from !== due.from && hd.to !== due.from)
      return { kind: 'parried', reply: hd, rings: [{ sq: hd.from, kind: 'threat' }], arrows: [threat(hd, 'hint')] };
    return attacked(v.attacked);
  }
  if (v.step === 2) {
    if (c.mateFor && b.mb === 1) return { kind: 'mine', rings: [], arrows: [] };
    /* V2.3: a missed win rings the piece the answer's line wins, where it
       stands now (never on the answer's own squares: words alone then) */
    var wt = !forcedMate(a) ? winTarget(a) : null;
    if (wt) return { kind: 'win', p: wt.p, sq: wt.sq, loose: wt, rings: wt.sq === due.to || wt.sq === due.from ? [] : [{ sq: wt.sq, kind: 'target' }], arrows: [] };
    var pz = hintPrize(a);
    return pz && isHangingAt(a.pre.b, pz.sq) && pz.sq !== due.to ? { kind: 'loose', loose: pz, rings: [{ sq: pz.sq, kind: 'target' }], arrows: [] } : null;
  }
  if (v.step !== 3) return null;
  var g1 = c.gameLine && c.gameLine.nodes[1];
  /* B4: "lets them mate you" only where they had no mate in one before the
     game move, and "lets them take (win) your X" only where no X of yours
     could be taken for profit before it (the moved piece where it is an X,
     else any X: the exchange on the card's position); what stood is said
     as it stands, else "Watch your X." */
  var mateBefore = mateInOne(dzNullState(a.pre)), stood = function (t) {
    var moved = pType(a.pre.b[a.played.from]) === t;
    return dangerAttacked(a.pre, myPov(a.it)).some(function (x) { return moved ? x[0] === a.played.from : pType(a.pre.b[x[0]]) === t; });
  };
  var watch = function (t) { return attacked(v.attacked) || { kind: 'watch', piece: t, rings: [], arrows: [] }; };
  if (c.mateAgainst && g1 && g1.move && isMate(g1.after) && !mateBefore) {
    var mg = { from: g1.move.from, to: g1.move.to };
    return { kind: 'madeMate', mate: mg, rings: skip(mg.to, mg.to) ? [] : [{ sq: mg.to, kind: 'attacked', mate: true }], arrows: skip(mg.from, mg.to) ? [] : [threat(mg, 'hint')] };
  }
  var cr = dangerCreated(a), plays = function (x) { return v.saves.indexOf(pType(x.p)) >= 0 || !!(g1 && g1.captured && g1.move.to === x.sq); };
  var rel = cr.filter(plays);
  /* a piece the better move keeps that the game line wins later, with no
     attack on the board yet: in words (the coach's review, never the plan
     line then) */
  if (!rel.length) return !v.saves.length ? null : stood(v.saves[0]) ? watch(v.saves[0]) : { kind: 'lost', piece: v.saves[0], rings: [], arrows: [] };
  /* B5: the red ring and its arrows only on the piece the game line's
     first reply takes where that line loses material (the search confirms
     the capture); another piece the game move leaves attacked is said in
     words alone */
  var gq = g1 && g1.captured && (c.lossG || 0) >= 1 ? (g1.move.ep >= 0 ? g1.move.ep : g1.move.to) : -1;
  var pk3 = dangerPick(rel.concat(cr.filter(function (x) { return !plays(x); })), v.saves, function (f, t) { return skip(f, t) || t !== gq; });
  if (stood(pType(pk3.named.p))) return watch(pType(pk3.named.p));
  return { kind: 'made', named: pk3.named, second: pk3.second, rings: pk3.rings.map(function (r) { r.after = 1; return r; }), arrows: pk3.arrows.map(function (x) { return threat(x, 'hint'); }) };
}
/* a game-mode card's hint 2 (F8.1): F1.1's danger, only what stands on the
   board while its game move is not shown (dangerHint's now); a foil's own
   (foilDanger, "Any good move passes here." when none: V2.6). null: nothing to draw */
function gameDanger(a) { return a.foil ? foilDanger(a) : dangerHint(a, !ghostOn(a)); }
/* F1.3: the last two wrong tries of this showing failed the same check
   (their digit) to the same capture (the same reply taking the same piece)
   or the same mate: hint 1 draws that danger instead, on the position the
   card asks from, its reply's piece ringed where it lands with the dashed
   arrow there, at tiers 1 and 2 (tier 3 has no automatic hint). No mark on
   the answer's to-square. {kind: 'rep', mate, took, lost (both tries' loss
   claims stood), from, to, san, rings, arrows} or null */
function repeatedDanger(a) {
  var t = a.tries || [], x = t[t.length - 1], y = t[t.length - 2];
  if (a.tier >= 3 || !x || !y || !x.d || x.d !== y.d || !x.u || x.u !== y.u || x.took !== y.took || x.mate !== y.mate || !(x.mate || x.took)) return null;
  var due = dueMove(a), from = sqIndex(x.u.slice(0, 2)), to = sqIndex(x.u.slice(2, 4)), p = a.st.b[from];
  if (!p || isW(p) === myPov(a.it)) return null;
  var skip = function (f, q) { return f === due.to || q === due.to; };
  return { kind: 'rep', mate: x.mate, took: x.took, lost: x.lost && y.lost, from: from, to: to, san: x.san || '',
           rings: skip(to, to) ? [] : [{ sq: to, kind: 'attacked', mate: x.mate, key: 'tries' }], arrows: skip(from, to) ? [] : [{ from: from, to: to, kind: 'threat', key: 'tries' }] };
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
/* V2.3: the piece the answer's line wins on a missed-win card: the most
   valuable piece of theirs its settled line takes, net of what it gives
   back, followed back to the square it stands on now, where the line nets
   2 or more (a pawn: 1), so a queen won for a rook is said. {sq, p} or null */
function winTarget(a) {
  var b = a.it.b, pov = myPov(a.it), line = unpackUci(b.lu);
  if (!line.length || (a.sol && a.solIdx > 0)) return null;
  var ns = lineNodes(a.pre, line), s = settleLine(a.pre, line), won = netLostOf(ns, s.k, !pov);
  if (!won.length) return null;
  won.sort(function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; });
  var X = won[0], net = pov ? s.w - s.b : s.b - s.w;
  /* a win only where it leaves the player better (60% or more), as V2.4's
     "wins" reason: the pawn race's Kxf5 and the rook ending's Rxa7 take a
     pawn to hold a draw, which is no win to hint at */
  if (b.eb != null && winPct(b.eb) < 60) return null;
  if (net < needOf(X)) return null;
  /* (and as far as the score shows it: 0.6 of a pawn a point) */
  if (b.eb != null && b.mb == null && b.eb < 60 * Math.min(net, MOTIF_VAL[X])) return null;
  /* each piece of theirs by the square it started on */
  var orig = {}, sq;
  for (sq = 0; sq < 64; sq++) if (a.pre.b[sq] && colorW(a.pre.b[sq]) !== pov) orig[sq] = sq;
  for (var i = 0; i < s.k && i < ns.length; i++) {
    var n = ns[i], csq = n.m.ep >= 0 ? n.m.ep : n.m.to;
    if (n.cap && colorW(n.cap) !== pov && pType(n.cap) === X && orig[csq] != null && a.pre.b[orig[csq]] && pType(a.pre.b[orig[csq]]) === X) return { sq: orig[csq], p: X };
    if (n.cap) delete orig[csq];
    if (orig[n.m.from] != null) { orig[n.m.to] = orig[n.m.from]; delete orig[n.m.from]; }
  }
  return null;
}
/* S9, the worked example: a tier-1 player's first card of a pattern family
   (nl:seen:<family> still 0) opens with hint 1's marks drawn, so Hint gives
   hint 2 and a solve records hint. Never at tiers 2 and 3, on a relearn
   card, on a card already tried or helped, or when hint 1 draws nothing
   there (words only: that family waits for a card that can show it).
   Storage that cannot be read counts as seen; a count that could not be
   written is kept in store's memory for the page load. Not on the first
   card ever (S18): that card teaches only the game arrow, "Your game move"
   beside the task, which needs the words' room; until that label has shown
   (nl:tip:game) no card is a worked example, and the family keeps its
   count at 0, so its worked example comes on its next card. True when it
   applies */
function familySeen(fam) {
  try { localStorage.getItem('nl:seen:' + fam); } catch (e) { return 1; }
  return +store.get('nl:seen:' + fam, 0) || 0;
}
function workedExample(a) {
  if (!a || a.prac || a.lesson || a.tier !== 1 || a.hints || a.misses || a.attempts || ss_relearn(a)) return false;
  if (familySeen(familyOf(patternOf(a.it.b)).key) > 0) return false;
  if (LABELS_ON && !store.get('nl:tip:game', 0)) return false;
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
  /* the solve time leaves out the time their reply's question stood open
     (F10.1): thinking over their move is no time spent finding yours, so
     F8.3's learned time, the first sight's step and the log never count it */
  askClose(a);
  a.ms = Date.now() - a.t0 - (a.askMs || 0);
  var relearn = ss.relearnOf && ss.relearnOf[a.key], prev = a.foil || a.prac ? null : logPrev(a), first = !relearn && !a.foil && !a.prac && !Object.keys(srsLoad()).length;
  if (ss.progress) delete ss.progress[a.key];
  if (a.prac) {
    /* a practice position (F9.4) is scored in nl:skill alone, never on the
       schedule, and never comes back for one more try; its try counts
       toward the day, as practice does. A pack's step may change, and the
       positions still to come follow it */
    if (a.attempts > 0) { ss.attempted = (ss.attempted || 0) + 1; countDay(ss, 0); }
    a.rec = null;
    ss.results[a.key] = result;
    a.pr = pracRecord(a, result);
    if (a.pr.up) ss.packUp = true;
    if (a.pr.down) ss.packDown = true;
    if (a.pr.mastered) ss.packMastered = a.it.skill;
    packAdapt(ss, a);
  } else if (a.foil) {
    /* a foil (F8.2) is never scheduled and never comes back for one more
       try; its try still counts toward the day */
    if (a.attempts > 0) { ss.attempted = (ss.attempted || 0) + 1; countDay(ss, 0); }
    a.rec = null;
    ss.results[a.key] = result;
  } else if (!relearn) {
    var info = { ms: a.ms, gameMove: a.triedGameMove, attempted: a.attempts > 0, alt: !!a.alt, fc: a.fc, tier: a.tier, game: !!a.game, guess: !!a.guess, guessRight: guessRight(a) };
    var rec = srsRecord(a.it, result, info);
    /* a find that would have made it learned, held by F8.3 (slow, cued) or
       for want of a right guess of their reply (F10.1: guess) */
    a.held = info.held || null;
    if (a.attempts > 0) { ss.attempted = (ss.attempted || 0) + 1; countDay(ss, 0); }
    a.rec = rec;
    ss.results[a.key] = result;
    if ((result === 'fail' || result === 'retry') && (ss.relearn || []).length < 3) {
      ss.relearn = ss.relearn || [];
      ss.relearn.push(a.key);
      a.relearnQueued = true;
      /* each card queued says so, once (V4.2) */
      retryNote(a);
    }
  } else {
    srsNoteTries(a.it, a.fc);
    if (guessRight(a)) srsNoteGuess(a.it);
    a.rec = srsRec(a.it);
    ss.results[a.key + '#r'] = result;
  }
  logCard(a, result, prev, relearn);
  /* a measure: the result of a player's first card ever, as a word */
  if (first) { measureTag('first_card', cardCategory(a, result)); track('first_card_result'); }
  /* the worked example done (S9): the family counts as seen, and the
     summary says it was a first look (a shown answer stays "Shown") */
  if (a.predraw) {
    var fam = familyOf(patternOf(a.it.b)).key;
    store.set('nl:seen:' + fam, familySeen(fam) + 1);
    if (!a.revealed && !relearn && !a.misses) (ss.notes = ss.notes || {})[a.key] = 'firstlook';
  }
  /* a practice position has no game, so no lines to tell */
  a.lines = a.prac ? null : cardLines(a);
  noteResult(ss, a, result, relearn, prev);
  /* the check line is in Details and on the summary (F2.3) */
  /* the board keeps showing what was just played (S6: the move found, the
     alternative that also works, or the end of the forcing line), its tick
     landing with the piece, then settles (S0); a shown answer is its green
     arrow, to be played (S7). Nothing plays by itself from here */
  a.settle = 0;
  if (a.revealed) {
    a.view = { mode: 'show' };
    var due = showDue(a);
    a.answerSan = due ? sanOf(a.st, due) : '';
    a.answerWords = due ? { san: a.answerSan, w: moveWords(a.st, due) } : null;
  } else {
    a.view = { mode: 's0' };
    /* a foil's "Playable" lands as a good move that is not the best */
    if (a.lastMove) a.markMove = { from: a.lastMove[0], to: a.lastMove[1], kind: a.foilKind === 'playable' ? 'close' : 'good' };
    a.settleFor = true;
  }
  saveSession();
  modelDirty();
  renderCard(beats);
  renderHeader();
  /* the tab's due count follows each answer (F5.4) */
  paintTitle();
  track(result === 'first' ? 'solve_first' : 'solve_' + result);
}
/* a card queued to come back says so, once (V4.2: the set keeps its size,
   its retries after it): "This one comes back at the end.", in a notice
   once its verdict has landed, while it is still on screen. The words
   would not fit the card's own frame (15 at most, and its answered frames
   hold 10 to 14). It goes with its card: on the next one "this one" would
   name the wrong position */
var RETRY_NOTE = 'This one comes back at the end.', RETRY_NOTE_AT = 700;
function retryNote(a) {
  setTimeout(function () {
    var ss = ui.session;
    if (!ss || ss.active !== a) return;
    notice(RETRY_NOTE, null, 4000);
    var n = el('overlay') && el('overlay').querySelector('.notice');
    if (n && n.classList) n.classList.add('retry-note');
  }, RETRY_NOTE_AT);
}
function retryNoteGone() {
  var n = el('overlay') && el('overlay').querySelector('.notice.retry-note');
  if (n) n.remove();
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
  retryNoteGone();
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
   after a miss it counts as missed, after only a hint as solved with help.
   The summary reads the note (S17): left after a miss "Missed", otherwise
   "Skipped" */
function settleLeft(a) {
  var ss = ui.session;
  if (!ss || !a || a.phase === 'done') return;
  /* a lesson's frames left: seen as far as they went, nothing graded (F9.3) */
  if (a.phase === 'lesson') { if (a.lesson.i >= 2) lessonDone(a); return; }
  var again = ss_relearn(a), result = preMisses(a) ? 'fail' : (a.hints || a.slips ? 'hint' : 'skip'), prev = a.foil || a.prac ? null : logPrev(a), first = !again && !a.foil && !a.prac && !Object.keys(srsLoad()).length;
  /* a foil is never scheduled (F8.2); a practice position left after a miss
     counts so in nl:skill alone (F9.4); a right guess of their reply is
     kept on the record (F10.1) */
  if (a.foil) a.rec = null;
  else if (a.prac) { a.rec = null; if (a.misses) pracRecord(a, 'fail'); }
  else if (!again) a.rec = srsRecord(a.it, result, { attempted: a.attempts > 0, gameMove: a.triedGameMove, fc: a.fc, guess: !!a.guess, guessRight: guessRight(a) });
  else { srsNoteTries(a.it, a.fc); if (guessRight(a)) srsNoteGuess(a.it); }
  noteGuess(a);
  logCard(a, result, prev, again);
  if (first) { measureTag('first_card', cardCategory(a, result)); track('first_card_result'); }
  if (a.attempts > 0) { ss.attempted = (ss.attempted || 0) + 1; countDay(ss, 0); }
  if (ss.progress) delete ss.progress[a.key];
  ss.results[a.key + (again ? '#r' : '')] = result;
  (ss.notes = ss.notes || {})[a.key + (again ? '#r' : '')] = preMisses(a) ? 'leftMiss' : 'left';
  a.phase = 'done';
  /* a card left after a miss taught its check: the summary says it */
  noteResult(ss, a, result, again, prev, true);
}
/* the honest result of one showing, the worst event deciding: 'shown'
   (the answer shown), 'miss' (after a miss), 'hint' (with a hint, the
   worked example's own included), 'good' (a good move before the best, or
   one that works too), 'first' (found first try), 'skip' (left untouched) */
function cardCategory(a, result) {
  if (result === 'skip') return 'skip';
  if (a.revealed && !(a.lineHeld && !preMisses(a))) return 'shown';
  if (preMisses(a)) return 'miss';
  if (a.hints || a.slips || a.lineHeld) return 'hint';
  if (a.foundGood || a.alt) return 'good';
  return 'first';
}
/* the summary's finer category of one showing (F2.1, C10), the worst event
   deciding: 'shown' (the answer shown), 'left' (left after a miss), 'miss'
   (found after a miss), 'hint' (with a hint pressed), 'look' (the worked
   example's drawn hint alone: a first look), 'good' (a good move, then
   found), 'alt' (another move that works, found first), 'first' (the best
   move, no help: the finds that climb), 'skip' (left untouched, or after a
   hint only: not counted) */
function resultCategory(a, result, left) {
  if (left) return preMisses(a) ? 'left' : a.slips ? 'hint' : 'skip';
  if (result === 'skip') return 'skip';
  /* V1.6: a later miss, or the answer shown later in a forcing line, holds
     the rung: with a hint, never shown */
  if (a.revealed && !(a.lineHeld && !preMisses(a))) return 'shown';
  if (preMisses(a)) return 'miss';
  var pressed = (a.hints || 0) - (a.predraw ? 1 : 0) - (a.autoH || 0);
  if (pressed > 0 || a.slips || a.lineHeld) return 'hint';
  if (a.predraw) return 'look';
  if (a.foundGood) return 'good';
  if (a.alt) return 'alt';
  return 'first';
}
/* tier 1's stars (C10): 3 found with no help step (first try, works too,
   a first look: the hint the app draws by itself is no step); 2 after one
   step (a close move, one hint, or one miss with its automatic hint); 1
   after more; 0 shown or left */
function cardStars(a, cat) {
  if (cat === 'shown' || cat === 'left' || cat === 'skip') return 0;
  var steps = (a.foundGood ? 1 : 0) + preMisses(a) + (a.slips || a.lineHeld ? 1 : 0) + Math.max(0, (a.hints || 0) - (a.predraw ? 1 : 0) - (a.autoH || 0));
  return steps === 0 ? 3 : steps === 1 ? 2 : 1;
}
/* the misses before a forcing line's first move was found (all of a
   card's misses when it has no line): later ones are slips (V1.6) */
function preMisses(a) { return Math.max(0, (a.misses || 0) - (a.slips || 0)); }
/* the rungs a record stands on (F2.2): 3 (gold) learned, else its run of
   clean finds, at most 2 */
function rungsOf(rec) { return rec ? (rec.learned ? 3 : Math.min(2, rec.streak || 0)) : 0; }
/* what one showing did on its ladder (F2.2): 'learned' (it became learned),
   'up' (a clean find that climbed), 'held' (works too, a good move first, a
   hint or a first look, a find that would have made it learned held by
   F8.3 or for want of a right guess of their reply, F10.1: held), 'start'
   (a miss or the answer shown), '' (a find before its due date, a spot
   check, a skip) */
function ladderMove(cat, prev, rec, held) {
  if (cat === 'skip' || !rec) return '';
  if (rec.learned && !(prev && prev.learned)) return 'learned';
  if (cat === 'first') return (rec.streak || 0) > ((prev && prev.streak) || 0) && !(prev && prev.learned) ? 'up' : held ? 'held' : '';
  if (cat === 'miss' || cat === 'shown' || cat === 'left') return 'start';
  return 'held';
}
/* what the summary keeps of a showing (ss.sum, by key, '#r' for one more
   try): c its category, s its stars, l its check line and st its step
   (F2.3), f whether that line is tier 3's computed fact, fc its wrong
   tries' steps (F2.4); for a first showing m what moved, p its rungs after
   it, and for a position just learned n its clean finds and d the days
   they took */
function noteResult(ss, a, result, again, prev, left) {
  var k = a.key + (again ? '#r' : ''), cat = resultCategory(a, result, left), e = { c: cat, s: cardStars(a, cat), fc: a.fc || '' };
  /* a foil (F8.2): its verdict (fk: good or playable), no check line and no
     ladder; the summary counts it apart */
  if (a.foil) {
    e.foil = 1;
    if (a.foilKind) e.fk = a.foilKind;
    (ss.sum = ss.sum || {})[k] = e;
    return;
  }
  /* a practice position (F9.4): scored apart, its skill; no check line, no
     ladder, and its tries are no own position's check steps (F2.4) */
  if (a.prac) {
    e.prac = 1; e.sk = a.it.skill; e.fc = '';
    (ss.sum = ss.sum || {})[k] = e;
    return;
  }
  if (cat !== 'skip') {
    a.lines = a.lines || cardLines(a);
    e.l = checkLine(a); e.st = cardStep(a);
    e.f = (a.tier || 2) >= 3 && e.l !== lineOfStep(e.st, 3);
  }
  if (!again) {
    var rec = a.rec || srsRec(a.it);
    e.m = ladderMove(cat, prev, rec, a.held); e.p = rungsOf(rec);
    if (e.m === 'learned') { e.n = rec.streak || 3; if (rec.rs) e.d = daysFrom(rec.rs, Date.now()); }
  }
  (ss.sum = ss.sum || {})[k] = e;
}
/* what the practice log needs from the record before this answer (and
   the summary, its rungs: run and learned) */
function logPrev(a) {
  var r = srsRec(a.it);
  /* why it was in the set (F7.1): spread to a later day, back from the
     queue (its ladder starting again), or practice before its due date */
  return r ? { n: r.n, last: r.last, lf: r.lf, streak: r.q ? 0 : r.streak || 0, learned: !r.q && !!r.learned, sp: !!r.sp, q: !!r.q,
               pr: !r.sp && !r.q && r.due != null && r.due > Date.now() } : null;
}
/* one card answered, in the practice log (08-srs.js): its mode, 'cued',
   'game' (F8.1) or 'foil' (F8.2, with its verdict fv: good or playable);
   review number 0 at first sight (unknown, null, for a record older than
   the count, and for a foil, which is no review); tb: a find that would
   have made it learned, held by F8.3 (hd says why: slow, cued, or guess
   for F10.1's hold); s the solve time, with the time their reply's
   question stood open apart in gt (F10.1). Measured as card_result_<tier>_
   <mode>_<category> (F0.7), which names no player, rating or position */
function logCard(a, result, prev, again) {
  var mode = a.prac ? 'practice' : a.foil ? 'foil' : a.game ? 'game' : 'cued', cat = cardCategory(a, result);
  var now = Date.now(), e = { e: 'c', k: a.key, tr: a.tier, m: mode, c: cat, r: result, a: a.attempts || 0, h: a.hints || 0 };
  e.n = a.foil || a.prac ? null : prev ? (prev.n != null ? prev.n : null) : 0;
  /* a practice position's skill and source (F9.4) */
  if (a.prac) { e.sk = a.it.skill; e.src = a.it.src; }
  if (a.foil && a.foilKind) e.fv = a.foilKind;
  if (a.held === 'slow' || a.held === 'cued') e.tb = 1;
  e.d = prev && prev.last ? Math.round((now - prev.last) / DAY * 10) / 10 : null;
  e.f = a.firstAt ? a.firstAt - (a.shownAt || a.t0) : null;
  askClose(a);
  e.s = a.ms != null ? a.ms : now - a.t0 - (a.askMs || 0);
  if (a.askMs) e.gt = a.askMs;
  if (a.triedGameMove) e.g = 1;
  /* each wrong try's check step (F1.2), in order */
  if (a.fc) e.fc = a.fc;
  if (prev && prev.lf) e.lf = 1;
  if (a.predraw) e.pd = 1;
  if (again) e.ag = 1;
  if (prev && prev.sp) e.sp = 1;
  if (prev && prev.q) e.q = 1;
  if (prev && prev.pr) e.pr = 1;
  /* F10.1: the guess of their reply (saw, good, not, open or skip), and a
     find held (slow, cued, or for want of a right guess); F10.4: the
     re-checks (searched, the verdict changed, the first verdict kept at 8 s) */
  if (a.guess) e.gu = guessResult(a);
  if (a.held) e.hd = a.held;
  if (a.rc) e.rc = [a.rc.n, a.rc.flip, a.rc.late];
  logAdd(e);
  track('card_result_' + (a.tier || 2) + '_' + mode + '_' + cat);
}
function skipCard() {
  var ss = ui.session, a = ss && ss.active;
  if (!a) return;
  settleLeft(a);
  nextCard();
}
/* "not a real mistake": the card leaves the queue and the statistics, and
   this session too: its segment goes from the bar (it never reads as done),
   a showing still to come goes with it, and the next card takes its place.
   The toast's Undo (undoDispute) puts it all back */
var lastDispute = null;
function disputeCard(reason) {
  var ss = ui.session, a = ss && ss.active;
  /* a foil claims no mistake: nothing to dispute (F8.2); nor does a
     practice position or a lesson (F9.3, F9.4) */
  if (!a || a.foil || a.prac || a.lesson) return;
  if (a.explore) exploreExit('silent');
  var key = a.key, rk = key + (ss_relearn(a) ? '#r' : ''), map = srsLoad(), copy = function (o) { return JSON.parse(JSON.stringify(o || {})); };
  var snap = { ss: ss, a: a, key: key, x: a.it.b.x || null, rec: map[key] ? copy(map[key]) : null, day: dayLoad(),
               keys: ss.keys.slice(), idx: ss.idx, relearn: (ss.relearn || []).slice(), relearnOf: copy(ss.relearnOf),
               results: copy(ss.results), notes: copy(ss.notes), sum: copy(ss.sum), progress: ss.progress && ss.progress[key] ? copy(ss.progress[key]) : null };
  a.it.b.x = 'user:' + reason;
  srsHide(a.it);
  modelDirty();
  saveGames(data.games);
  engineStop('check');
  stageReset();
  a.menuOpen = false;
  ss.keys.splice(ss.idx, 1);
  ss.relearn = (ss.relearn || []).filter(function (k) { return k !== key; });
  delete ss.results[rk];
  if (ss.notes) delete ss.notes[rk];
  if (ss.sum) delete ss.sum[rk];
  if (ss.progress) delete ss.progress[key];
  ss.active = null;
  saveSession();
  lastDispute = snap;
  /* nothing left to show and nothing answered: the session simply ends */
  if (ss.idx >= ss.keys.length && !ss.relearn.length && !Object.keys(ss.results).length) { snap.ended = true; endSession(); }
  else loadCard();
  snap.after = disputeSig(ss);
  notice('Removed. It won\'t come back or count in your stats.', { act: 'undoDispute', label: 'Undo' });
}
/* what a session looks like, to tell whether anything happened in it since */
function disputeSig(ss) { return JSON.stringify([ss.idx, ss.keys, Object.keys(ss.results || {}).sort(), !!ss.finished]); }
/* Undo: the card is a mistake again (in the stored games and the schedule)
   and, while nothing else happened in the session since, it is back where
   it was, with its segment: answered, as it was left; else asked again
   (its misses and hints kept). A session the removal ended or finished is
   opened again on it, the day's count as it was before */
function undoDispute() {
  var s = lastDispute;
  lastDispute = null;
  if (!s) return;
  var it = s.a.it;
  if (s.x) it.b.x = s.x; else delete it.b.x;
  srsRestore(s.key, s.rec);
  modelDirty();
  saveGames(data.games);
  var ss = s.ss, now = ui.session;
  if (now ? now !== ss || disputeSig(ss) !== s.after : !s.ended) { notice('Put back. It comes back in a later session.'); return; }
  if (ss.active && ss.active.explore) exploreExit('silent');
  engineStop('check');
  stageReset();
  /* the card that took its place keeps what was tried on it */
  var cur = ss.active;
  if (cur && cur.phase !== 'done' && (cur.misses || cur.hints || cur.attempts)) keepProgress(cur);
  ss.keys = s.keys; ss.idx = s.idx; ss.relearn = s.relearn; ss.relearnOf = s.relearnOf; ss.results = s.results; ss.notes = s.notes; ss.sum = s.sum;
  if (s.progress) (ss.progress = ss.progress || {})[s.key] = s.progress;
  if (ss.finished || s.ended) { ss.finished = false; daySave(s.day); }
  if (!now) { ui.session = ss; setView('train', false); pushSessionState(); }
  saveSession();
  renderHeader();
  if (s.a.phase === 'done') { ss.active = s.a; renderCard(); }
  else { ss.active = null; loadCard(); }
}

/* ── after answering: the frame on screen ───────────────────────────────── */
/* the position an answered card shows: S0 and the answer shown, the card's
   own board as play left it (a.st); a story step, its ply landed (or, while
   a segment's first step crossfades in, where that segment starts), with
   its last move and the bar's value */
function storyView(a) {
  var v = a.view, s = buildStory(a).steps[v.i], n = s.line.nodes[s.k];
  /* the danger frame (F1.5): the card's own position, their last move tinted */
  if (s.df) return { st: a.pre, last: a.preLast, ev: a.it.b.eb };
  if (!v.pre) return { st: n.after, last: [n.move.from, n.move.to], ev: a.it.b.eb };
  var pn = s.line.nodes[s.k - 1];
  return { st: n.before, last: pn && pn.move ? [pn.move.from, pn.move.to] : a.preLast, ev: a.it.b.eb };
}
function doneBoard(a) { return a.view && a.view.mode === 'story' ? storyView(a).st : a.st; }

