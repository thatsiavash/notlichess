// Realm-side frame walks for the truth audit: every frame a card shows that needs no new search
// (the card asking, its hints, the worked example, its game move tried, the solve and S0, See why's
// steps, the answer shown, Details), a forcing line's frames with their reply list, and a game-mode
// review's frames. The tries the engine must answer are driven from Node (dump.js).
module.exports = `
var TA = window.TA;
TA.details = function (a, frame) { var r = TA.snap(a, frame + ', Details'); r.details = TA.txt(detailsHtml()); return r; };
TA.settledFrames = function (a, tag) {
  a.animMove = null; TA.snap(a, tag + ' found');
  a.settle = 1; TA.snap(a, tag + ' S0 marks');
  a.settle = 2; TA.snap(a, tag + ' S0 settled');
  TA.details(a, tag + ' S0 settled');
  if (!a.foil && !a.prac) TA.summary(a, tag);
  if (a.foil || a.prac) return;
  TA.storyFrames(a, tag);
};
/* a frame that carries only what the caller adds (the summary's lines, Explore's words): the card's
   context as TA.snap keeps it, with the card's own strings left out (they are read on its frames) */
TA.snapLite = function (a, frame, extra) {
  var r = TA.snap(a, frame, extra);
  r.row1 = r.row2 = r.cap = r.chip = r.tag = r.src = r.strip = r.live = r.aria = '';
  r.buttons = []; r.label0 = r.label1 = null; r.marks = {};
  return r;
};
/* release 2's C5 (f): what the summary of this showing says of the card: its tile's computed fact
   (tier 3) and its "Keep in mind" lines, as the set's summary would draw them */
TA.summary = function (a, tag) {
  var ss = ui.session, e = ss && ss.sum && ss.sum[a.key];
  if (!e) return null;
  var r = TA.snapLite(a, tag + ' summary');
  r.keep = keepLines(ss, [a.key], a.tier || 2);
  r.tile = e.f && e.l ? e.l : '';
  return r;
};
/* See why's steps after the answer shown or found */
TA.storyFrames = function (a, tag) {
  try { seeWhy(); } catch (e) { return; }
  var S = null;
  try { S = buildStory(a); } catch (e) { TA.snap(a, tag + ' story error ' + e); return; }
  for (var i = 0; i < S.steps.length; i++) { a.view = { mode: 'story', i: i }; a.animMove = null; TA.snap(a, tag + ' story ' + i); }
};
/* release 2's C5 (f): Explore after the answer (startExplore, from the card's own position), one move
   at a time from there; TA.xpReady says when its searches are in, TA.xpSnap reads the sentence, the
   rows and what they were said on */
TA.xpStart = function () {
  var a = ui.session && ui.session.active;
  if (!a || !xpOpen(a)) return 0;
  startExplore({ via: 'audit' });
  return a.explore ? 1 : 0;
};
TA.xpPlay = function (u) {
  var a = ui.session.active, ex = a && a.explore;
  if (!ex) return 'none';
  if (ex.at !== 0) exploreGo(0);
  var m = uciToMove(ex.nodes[0].st, u);
  if (!m) return 'illegal';
  explorePlay(m, false);
  return 'ok';
};
TA.xpReady = function () {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return 'none';
  var C = xpCur(ex), P = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  if (xpGameOver(C.st) || xpSpoil(C) || C.down) return 'ready';
  var cr = ex.res[C.key], pr = P ? ex.res[P.key] : null;
  if (!cr || cr.step < 2) return 'wait';
  if (P && !xpSpoil(P) && !xpGameOver(P.st) && (!pr || pr.step < 2)) return 'wait';
  return 'ready';
};
TA.xpSnap = function (frame, extra) {
  var a = ui.session.active, ex = a.explore, n = xpCur(ex), P = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  var L = function (ls) { return (ls || []).map(function (l) { return l ? { pv: l.pv.slice(0, 10), cp: l.cp, mate: l.mate } : null; }); };
  var r = TA.snapLite(a, frame, extra), rows = null;
  try { rows = xpRows(a, ex); } catch (e) { rows = null; }
  r.xp = { say: sayAt(a, ex, ex.at), fen: n.fen, parent: P ? P.fen : null, move: n.mv ? n.mv.uci : null, san: n.mv ? n.mv.san : null,
           byYou: n.mv ? !!n.mv.byYou : null, spoil: !!xpSpoil(n),
           rows: (rows || []).map(function (w) { return { uci: w.uci, first: w.first, cont: w.cont || '', chip: w.chip || '', words: w.words || '', label: w.label || '', li: w.li }; }),
           lines: L(xpShown(ex, n)), parentLines: P && ex.res[P.key] ? L(ex.res[P.key].lines) : null };
  return r;
};
/* release 2's C5 (f): every legal check and capture of the player on the card's position */
TA.checksCaptures = function (key) {
  var it = itemOf(key), pre = it && stateAtPly(it.g.mv, it.b.p);
  if (!pre) return '[]';
  return JSON.stringify(legalMoves(pre).filter(function (m) { var x = cloneState(pre); applyMove(x, m); return !!pre.b[m.to] || checkedKingSq(x) != null || (m.ep != null && m.ep >= 0); }).map(moveUci));
};
/* the card's own answer played (a forcing line played through), then its settled frames */
TA.solve = function (key, tag) {
  var a = TA.open(key);
  if (!a) return 'none';
  if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
  else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); if (a.solIdx % 2 === 0) noteWon(a, lm); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
  TA.settledFrames(a, tag);
  return 'ok';
};
TA.cardSync = function (key) {
  var a = TA.open(key);
  if (!a) return 'none';
  TA.snap(a, 'open');
  a.hints = 1; TA.snap(a, 'hint 1'); a.hints = 2; TA.snap(a, 'hint 2');
  if (hintMax(a) === 3) { a.hints = 3; TA.snap(a, 'hint 3'); }
  /* the worked example, on a card after the first ever (S18) */
  a = TA.open(key);
  var tg = store.get('nl:tip:game', 0); store.set('nl:tip:game', 1);
  var fam = familyOf(patternOf(a.it.b)).key, seen0 = store.get('nl:seen:' + fam, 0); store.del('nl:seen:' + fam);
  var we = workedExample(a);
  if (!tg) store.del('nl:tip:game');
  if (seen0) store.set('nl:seen:' + fam, seen0);
  if (we) TA.snap(a, 'worked example');
  /* the game move tried: its verdict, reason, See it landed, Try again */
  a = TA.open(key); a.tapped = true;
  gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
  if (a.phase === 'tried') {
    TA.snap(a, 'game move again'); a.reason = 1; TA.snap(a, 'game move again, reason drawn'); a.reason = 2; TA.snap(a, 'game move again, reason said');
    if (a.tried.reply) {
      seeIt(); a.animMove = null; TA.snap(a, 'game move again, See it landed');
      /* v2 slice 2 (V2.2): Next move steps the rest of their line */
      for (var g0 = 0; g0 < 10 && typeof seeMore === 'function' && seeMore(a.tried); g0++) { seeIt(); a.animMove = null; TA.snap(a, 'game move again, See it step ' + a.tried.step); }
    }
    tryAgain(); a.triedHold = false; TA.snap(a, 'game move again, after Try again');
  }
  /* solved: the card's own answer (a forcing line played through) */
  a = TA.open(key);
  if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
  else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); if (a.solIdx % 2 === 0) noteWon(a, lm); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
  TA.settledFrames(a, 'best');
  /* the answer shown, played, settled */
  a = TA.open(key); reveal(); a.animMove = null; TA.snap(a, 'shown');
  if (!a.sol) { playIt(false); a.animMove = null; TA.snap(a, 'shown, played'); a.settle = 2; TA.snap(a, 'shown, settled'); TA.details(a, 'shown, settled'); TA.summary(a, 'shown'); TA.storyFrames(a, 'shown'); }
  else {
    var guard = 0;
    while (showDue(a) && guard++ < 12) { playIt(false); if (a.reply) { theirReply(a, false); replyDone(a, a.reply); } a.animMove = null; }
    a.view = { mode: 's0' }; a.settle = 2; TA.snap(a, 'shown line, settled'); TA.details(a, 'shown line, settled'); TA.summary(a, 'shown line');
  }
  return 'ok';
};
/* a forcing line's frames (S10, F10.1): each move found, the reply's
   telegraph and landing, the next move asked; at tier 3 the question and the
   guesses g (uci list) judged against the record's reply list */
TA.forcing = function (key, guesses) {
  var a = TA.open(key);
  if (!a || !a.sol) return 'none';
  var sf0 = SF.state; if (!TA.engineDown) SF.state = 'ready';
  for (var k = 0; k < a.sol.length - 1; k += 2) {
    gradeMove(uciToMove(a.st, a.sol[k]));
    var rp = a.reply;
    if (!rp) break;
    a.animMove = null; TA.snap(a, 'forcing ' + k + ', right');
    if (rp.ask) { makeGuess(a, uciToMove(a.st, a.sol[k + 1])); a.animMove = null; TA.snap(a, 'forcing ' + k + ', guessed right'); }
    rp.tele = true; TA.snap(a, 'forcing ' + k + ', telegraph');
    theirReply(a, false); a.animMove = null; a.animSlow = false; TA.snap(a, 'forcing ' + k + ', landed');
    replyDone(a, rp); TA.snap(a, 'forcing ' + k + ', your move');
    a.hints = 1; a.hintAfter = true; TA.snap(a, 'forcing ' + k + ', hint 1'); a.hints = 0; a.hintAfter = false;
  }
  (guesses || []).forEach(function (g) {
    var b = TA.open(key);
    gradeMove(uciToMove(b.st, b.sol[0]));
    var rq = b.reply;
    if (!rq || !rq.ask) return;
    var m = uciToMove(b.st, g);
    if (!m) return;
    makeGuess(b, m); b.animMove = null; TA.snap(b, 'forcing 0, guessed ' + g);
    rq.tele = true; theirReply(b, false); b.animMove = null; b.animSlow = false;
    replyDone(b, rq); TA.snap(b, 'forcing 0, your move after guessing ' + g);
  });
  SF.state = sf0;
  return 'ok';
};
/* a game-mode review's frames (F8.1) */
TA.gameSync = function (key) {
  TA.gameRec(key);
  var a = TA.open(key, true);
  if (!a || !a.game) { TA.ungame(key); return 'nogame'; }
  TA.snap(a, 'game open');
  a.hints = 1; TA.snap(a, 'game hint 1'); a.hints = 2; TA.snap(a, 'game hint 2');
  a = TA.open(key, true); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
  if (a.phase === 'tried') {
    a.reason = 2; TA.snap(a, 'game game move, reason said');
    if (a.tried.reply) {
      seeIt(); a.animMove = null; TA.snap(a, 'game game move, See it landed');
      for (var g1 = 0; g1 < 10 && typeof seeMore === 'function' && seeMore(a.tried); g1++) { seeIt(); a.animMove = null; TA.snap(a, 'game game move, See it step ' + a.tried.step); }
    }
    tryAgain(); a.triedHold = false; TA.snap(a, 'game game move, after Try again');
    a.hints = 1; a.hintAt = a.misses; a.hintAfter = true; TA.snap(a, 'game after a miss, hint 1'); a.hints = 2; TA.snap(a, 'game after a miss, hint 2');
  }
  a = TA.open(key, true); reveal(); a.animMove = null; TA.snap(a, 'game shown');
  if (!a.sol) { playIt(false); a.animMove = null; a.settle = 2; TA.snap(a, 'game shown, settled'); }
  a = TA.open(key, true);
  if (!a.sol) { a.tapped = true; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2; TA.snap(a, 'game found, settled'); TA.details(a, 'game found, settled'); }
  TA.ungame(key);
  return 'ok';
};
1;
`;
