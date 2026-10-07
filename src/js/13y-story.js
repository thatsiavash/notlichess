/* ── The card's words (FINAL-SPEC section 3) ─────────────────────────────
   Every string on the card's face lives here, never in the classifier, so
   the explanation snapshot and CLASSIFY_V do not move. The band has two
   rows: row 1 at most 26 characters, row 2 at most 40 characters and 7
   words (a caption, the stepped story's layout, 60 and 8). Every templated
   row runs the fit ladder: the full text, the same with each material
   phrase as one word, its first sentence, then the row's fallback. */
var ROW_CAPS = { row1: { ch: 26, words: 99 }, row2: { ch: 40, words: 7 }, caption: { ch: 60, words: 8 } };

/* the move played in the game, and the two sides, as the copy names them */
function gameSan(a) { return sanOf(a.pre, a.played); }
function sidesOf(a) {
  var w = myPov(a.it);
  return { me: w ? 'White' : 'Black', mine: w ? 'white' : 'black', opp: w ? 'Black' : 'White' };
}

/* the copy table, by the spec's ids: the task (T1, T2), the relearn chip
   (T3), the three answers to a tap that is not a move (T4 their piece, T5
   a drop where that piece cannot go, N1 any piece after an answer), a move
   being checked (K1 at 300 ms, K2 at 3 s), a wrong try (M1, M2 for the game
   move again), a good move that is not the best (C1, C2) and a move the
   engine could not check (E1, E2) */
var CARD_COPY = {
  T1: function () { return 'Your turn'; },
  T2: function (a) { return 'Find a better move than ' + gameSan(a) + '.'; },
  T3: function () { return 'One more try'; },
  T4: function (a) { var s = sidesOf(a); return 'You are ' + s.me + '. Move a ' + s.mine + ' piece.'; },
  T5: function () { return 'That piece can\'t go there.'; },
  N1: function () { return 'To try moves, open Details.'; },
  /* exploring (S14): its band, and at tier 1 a row's standing in words
     (X3) from the learner's winning chances w; tiers 2 and 3 keep numbers */
  X1: function () { return 'Try your own moves'; },
  X2: function (a) { return (a.tier === 1 ? 'The computer' : 'Stockfish') + ' answers each one.'; },
  X3: function (a, w) {
    var opp = sidesOf(a).opp;
    return w >= 80 ? 'you are winning' : w >= 60 ? 'you are better' : w >= 40 ? 'even game' : w >= 20 ? opp + ' is better' : opp + ' is winning';
  },
  K1: function (a) { return 'Checking ' + (a.checking || 'your move') + '…'; },
  K2: function () { return 'Still checking.'; },
  M1: function () { return 'Not this one'; },
  M2: function () { return 'Your game move again'; },
  C1: function () { return 'Good move'; },
  C2: function () { return 'There\'s a stronger one.'; },
  E1: function () { return 'Cannot check this move'; },
  E2: function () { return 'Not counted. Try again.'; },
  R1: function () { return 'Found it'; },
  R2: function () { return 'You got there'; },
  R3: function () { return 'That works too'; },
  V1: function (a, san) { return 'The answer: ' + (san || a.answerSan || ''); },
  V2: function () { return 'Play the green arrow.'; },
  H1: function () { return 'Hint 1 of 2'; },
  H3: function () { return 'Hint 2 of 2'; },
  H3b: function () { return 'Move the circled piece.'; },
  F1: function () { return 'Right'; },
  F2: function (a) { return sidesOf(a).opp + ' replies next.'; },
  F3: function () { return 'Your move'; }
};
/* F4: their reply in a forcing line, once it has landed, as row 2 says it:
   what it took, or the check it gives, or the move itself; st is the
   position before it, took what it captured. The ladder's next form drops
   "as expected" (S10's 13 words beside a bar after two hints) */
function replyWords(a, st, m, took) {
  var opp = sidesOf(a).opp, after = cloneState(st);
  applyMove(after, m);
  var did = took ? 'took your ' + PIECE_WORD[pType(took)] : checkersOf(after).length ? 'gives check' : 'played ' + capSan(st, m);
  return [opp + ' ' + did + ', as expected.', opp + ' ' + did + '.'];
}
/* the forcing pips (2.0): one dot per move of yours in the line, from your
   first move found to the line's end (never before it: the card opens as
   any other does, with no count). done: the moves found; cur: the move due
   now, or -1 while their reply is on its way */
function pipsOf(a) {
  if (!a.sol || !(a.solIdx > 0) || a.phase === 'done') return null;
  var found = Math.ceil(a.solIdx / 2);
  return { n: Math.ceil(a.sol.length / 2), done: found, cur: a.phase === 'reply' ? -1 : found };
}
/* a word for a tap that is not a move, as row 2 says it: the full text,
   then (when the words on screen would go over budget) a shorter one */
var NOTE_COPY = {
  T4: function (a) { return [CARD_COPY.T4(a), 'Move a ' + sidesOf(a).mine + ' piece.']; },
  T5: function (a) { return [CARD_COPY.T5(a)]; },
  N1: function (a) { return [CARD_COPY.N1(a)]; }
};

/* the live region leads with the verdict in words, so meaning never rests
   on colour */
var LIVE_PREFIX = { good: 'Correct.', bad: 'Wrong.', close: 'Good move, not best.', unchecked: 'Not checked.', info: 'Answer shown.' };

/* the fit ladder. cands run from fullest to barest; a caller that can say
   a material phrase as one word ("a rook", "the queen") passes that form
   as the next candidate. Then each candidate's first sentence, then the
   fallback. A row that fits nothing stays empty rather than overflow */
function fitsRow(s, row) {
  var cap = typeof row === 'object' ? row : ROW_CAPS[row] || ROW_CAPS.row2;
  return !!s && s.length <= cap.ch && wordsIn(s) <= cap.words && s.split(/\s+/).length <= cap.words;
}
function firstSentence(s) { var m = /^.*?[.!?…](?=\s|$)/.exec(String(s || '')); return m ? m[0] : String(s || ''); }
function fitRow(cands, row, fallback) {
  var list = [].concat(cands).filter(Boolean);
  list = list.concat(list.map(firstSentence));
  for (var i = 0; i < list.length; i++) if (fitsRow(list[i], row)) return list[i];
  return fitsRow(fallback, row) ? fallback : '';
}
/* principle 5: at most 15 words on screen before the next tap, counting
   the band's rows and chip and the bar's labels (arrows and glyphs such as
   ‹ › … are not words). Over budget, row 2 runs its ladder again with the
   words that are left */
var WORD_BUDGET = 15;
/* a forcing line's own frames (S10: "Right", "Your move") hold 13 words,
   band and bar; the reply's board label (slice 13, two words) is not
   counted here: it is the first thing to drop when a frame goes over
   (principle 5), before row 2 runs its ladder */
var LINE_BUDGET = 13;
function wordsIn(s) { return String(s || '').split(/\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length; }
function barWords(slots) { return (slots || []).reduce(function (n, b) { return n + wordsIn(b.label); }, 0); }
function bandWords(b, slots) { return wordsIn(b.row1) + wordsIn(b.row2) + wordsIn(b.chip) + wordsIn(b.cap) + barWords(slots); }
/* a verdict as the band says it (FINAL-SPEC 3): {kind, row1, row2, html},
   with row 2's ladder kept (cands, fall) so the band can fit it to the
   words left beside the bar */
function verdictOf(kind, row1, cands, fall) {
  cands = [].concat(cands || []).filter(Boolean);
  var row2 = fitRow(cands, 'row2', fall || '');
  return { kind: kind, row1: row1, row2: row2, cands: cands, fall: fall || '', html: row1 + (row2 ? ' ' + row2 : '') };
}
/* what changed hands along a line, in plain words (FINAL-SPEC 3): the
   classifier's captureWord, with "the exchange" spelled out as the rook
   and the piece it went for. Game lines count from 0 (node 0 is your own
   move, and the line's side is the opponent), best and alternative lines
   from 1 (node 0 is a null move). Three kinds of piece or more come back
   as "material", which names nothing: null, so the caller's own words
   (materialWord) come next */
function plainCapture(line, k, from) {
  var w = line ? captureWord(line, k, from) : null;
  if (w === 'material') return null;
  if (w !== 'the exchange') return w;
  var minors = {};
  for (var i = from == null ? 1 : from; i <= k && i < line.nodes.length; i++) {
    var n = line.nodes[i];
    if (n.captured && !n.pov && (pType(n.captured) === 'N' || pType(n.captured) === 'B')) minors[pType(n.captured)] = 1;
  }
  return 'a rook for a ' + (minors.N && !minors.B ? 'knight' : minors.B && !minors.N ? 'bishop' : 'piece');
}
/* a material phrase in one word, the fit ladder's second step, only where
   that word stays true to what changed hands (n, the net, in pawns): a
   trade ("a rook for a knight") is "material", never its net ("two
   pawns"); two kinds of piece taken one way are "a lot of material" when
   worth that much; a single kind stays as it is. With no phrase (three kinds
   of piece, a promotion on the way, nothing taken outright) only the words
   "material" and "a lot of material" are true */
function oneWord(x, n) {
  n = Math.abs(n || 0);
  if (!x) return n >= 6 ? 'a lot of material' : 'material';
  if (/ for /.test(x)) return 'material';
  return / and /.test(x) && n >= 6 ? 'a lot of material' : x;
}

/* why a wrong try fails (M3), as row 2's ladder {cands, fall}: c is the
   classifier on the try (on the game move again, the card's own), win the
   solver's win chance after it, reply their answer in SAN. Checkmate first,
   then the material it loses, then where the game stands. Inside a forcing
   line a try that loses nothing says so. A form that would name the answer
   due now, or needs a reply there is none of, gives way to the fallback */
function missWhy(a, c, win, reply, inLine) {
  var s = sidesOf(a), cands = [], fall = 'That helps ' + s.opp + '.';
  if (c && c.mateAgainst === 1 && reply) cands = ['Then ' + reply.replace(/#$/, '') + ' is checkmate.', s.opp + ' could checkmate you.'];
  else if (c && c.mateAgainst > 1) cands = [s.opp + ' could checkmate you.'];
  else if (c && c.lossG >= 1) {
    var lw = plainCapture(c.gameLine, c.lossAt, 0), w = oneWord(lw, c.lossG);
    cands = ['You\'d lose ' + (lw || w) + '.', 'You\'d lose ' + w + '.'];
    fall = 'You\'d lose material.';
  }
  else if (inLine) cands = ['Nothing lost, but there\'s a better move.'];
  else if (win >= 60) cands = ['Most of your advantage is gone.'];
  else if (reply) cands = ['After ' + reply + ', ' + (win >= 40 ? 'the game is even.' : s.opp + ' is on top.')];
  var due = sanOf(a.st, dueMove(a));
  return { cands: cands.filter(function (x) { return x.indexOf(due) < 0; }), fall: fall };
}
/* the game move again (M2): its reason from the card's own refutation and
   the score after it; a missed-chance card says only that there is more
   to find, since what the game move allowed is not that card's lesson */
function gameMoveWhy(a) {
  if (familyOf(patternOf(a.it.b)).key === 'chances') return { cands: ['There\'s a stronger move here.'], fall: '' };
  var r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  return missWhy(a, a.cls, a.it.b.wa, r1 ? sanOf(r1.before, r1.move) : null, false);
}

/* the verdict on a try that stays on the board (S4, S5, S11): row 1 in
   one to four words, row 2 from its ladder. A wrong try says why (why:
   missWhy's ladder; the band shows it once its reason beat comes), the game
   move again says so; a good move that is not the best says there is a
   stronger one, the second time row 1 alone; a move the engine could not
   check is not counted */
function triedVerdict(a, t, why, again) {
  if (t.kind === 'close') return verdictOf('close', CARD_COPY.C1(), again ? [] : [CARD_COPY.C2()], '');
  if (t.kind === 'unchecked') return verdictOf('unchecked', CARD_COPY.E1(), [CARD_COPY.E2()], '');
  why = why || { cands: [], fall: 'That helps ' + sidesOf(a).opp + '.' };
  return verdictOf('bad', t.uci === a.playedUci ? CARD_COPY.M2() : CARD_COPY.M1(), why.cands, why.fall);
}
/* a hint as the band says it (S8, H1 to H3), with the marks it draws
   (hintMarks): {row1, row2, cands, fall, marks}, row 2 fitted to its caps
   and its ladder kept (cands, fall) for the word budget. Hint 2: "Move the
   circled piece." Hint 1 inside a forcing line is about this step: your
   king in check (only the solver's own, on the position the card asks
   from: U3), else that the next move is forcing too. On the card's first
   move only H2's forms: a danger drawn says to look at it ("runs into"
   only beside its marks, so never pointing at an empty board); a missed
   chance names its prize (the line's own words, else one word true to a
   trade), a checkmate, a fork made by the first move (only when the line
   is missing), else checks and captures; a winning position, keeping it
   simple; a quiet one, its worst piece; a safety or king card with nothing
   drawn, what the answer wins when it wins something, else keeping it
   safe. No form names the answer due now */
function hintText(a) {
  var marks = hintMarks(a), due = dueMove(a), dueSan = sanOf(a.st, due), cands, fall;
  var r = { row1: CARD_COPY[a.hints >= 2 ? 'H3' : 'H1'](), marks: marks };
  if (a.hints >= 2) { cands = [CARD_COPY.H3b()]; fall = ''; }
  else if (a.sol && a.solIdx > 0) {
    var mine = kingSq(a.st.b, myPov(a.it));
    var inCheck = (a.phase === 'guess' || (a.phase === 'checking' && !a.checkSaid)) && !!a.st.w === myPov(a.it) && mine >= 0 && checkedKingSq(a.st) === mine;
    cands = [inCheck ? 'Your king is in check.' : 'The next move is forcing too.'];
    fall = 'The next move is forcing too.';
  } else {
    var fam = familyOf(patternOf(a.it.b)).key, c = a.cls, line = c.bestLine, mt = c.missed || {};
    var win = !!line && !line.unsettled && c.matBest >= 1, pw = win ? plainCapture(line, c.bSettle) : null;
    /* what the answer gets, in H2's words: a checkmate, or the material
       its line wins */
    var gets = c.mateFor ? ['There is a checkmate here.']
      : win ? ['You can win ' + (pw || oneWord(null, c.matBest)) + ' here.', 'You can win ' + oneWord(pw, c.matBest) + ' here.'] : null;
    var own = fam === 'conversion' ? 'Keep it simple and safe.' : fam === 'quiet' ? 'Improve your worst piece.'
      : fam === 'chances' || win ? 'You can win material here.' : 'Keep it simple and safe.';
    fall = own;
    if (fam === 'chances') cands = gets || (mt.fork && mt.fork.ply === 1 && c.matBest >= 2 ? ['One piece can hit two targets.'] : ['Look for checks and captures.']);
    /* the reply the game move runs into, drawn beside these words */
    else if (marks.danger) cands = ['See what ' + gameSan(a) + ' runs into.'];
    else if (fam === 'conversion') cands = ['Keep it simple and safe.'];
    else if (fam === 'quiet') cands = ['Find your worst piece and improve it.', 'Improve your worst piece.'];
    else cands = gets || ['Keep it simple and safe.'];
  }
  /* the guard: no form names the answer due now */
  var names = function (x) { return String(x || '').split(/[\s.,]+/).indexOf(dueSan) >= 0; };
  r.cands = cands.filter(function (x) { return x && !names(x); });
  r.fall = names(fall) ? '' : fall;
  r.row2 = fitRow(r.cands, 'row2', r.fall);
  return r;
}
/* the band for the state the card is in: {disc, kind, row1, row2, chip,
   cap, sweep, pips}. disc: king (in the solver's colour), good, bad, close,
   checking, unchecked or info; kind: neutral, good, bad, close, info, hint
   or explore; cap: one caption instead of two rows; sweep: the thin line
   that runs along the band's foot while a move is checked. A word for a
   tap that is not a move (a.note) takes row 2 for a while, and the chip
   steps aside for it. Row 2 always fits the word budget (bandFit). pips:
   inside a forcing line, from the first move found, at the right of row 1
   (a relearn card's chip, shown only before that move, gives way to them) */
function bandFor(a) {
  var b = bandOf(a), n = a.note && a.note.key === cardStateKey(a) ? a.note : null;
  if (!b.cap && n) { b.cands = NOTE_COPY[n.id](a); b.fall = ''; b.chip = ''; }
  if (!b.cap) b.pips = pipsOf(a);
  return bandFit(a, b);
}
/* row 2 from its ladder: the row's own caps, then, over the word budget,
   the words that are left (and a note that still does not fit is dropped) */
function bandFit(a, b) {
  if (b.cands) {
    b.row2 = fitRow(b.cands, 'row2', b.fall);
    var room = rowRoom(a, b);
    if (wordsIn(b.row2) > room) b.row2 = fitRow(b.cands, { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
    /* a ladder step that would say something untrue (R4's found form) */
    if (b.never && b.never.indexOf(b.row2) >= 0) b.row2 = fitRow([], { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
  }
  delete b.cands; delete b.fall; delete b.never; delete b.budget;
  return b;
}
/* the comparison a settled card makes (S6, R4), read once from the
   classifier and the card's lines: did the opponent find the punishment
   (found: their game reply was the refutation's first move), what the game
   move lost (w, in plain words, and wn as one word), what the better move
   wins (w2, w2n: the card's best line, or for a move that works too its own
   line) and whether it is guarded (the guard rule) */
function buildCompare(a) {
  if (a.compare) return a.compare;
  var c = a.cls, it = a.it, pov = myPov(it), ru = unpackUci(it.b.ru), gm = a.lines ? a.lines.game.uci : [];
  var line = c.bestLine, settle = c.bSettle, gain = c.matBest, at = 1, better = a.lines ? a.lines.best.san[0] || '' : '';
  if (a.alt && a.yours) {
    var alt = buildLine(a.pre, '0000', a.yours.uci, pov);
    if (alt && alt.nodes[(a.yours.at || 0) + 1]) {
      /* the alternative's own gain, from its own move: the line's moves
         before it (found as the card asked) are not its doing */
      line = alt; at = (a.yours.at || 0) + 1;
      settle = Math.max(at, settleIndex(alt));
      gain = matDiff(alt.nodes[settle].after.b, pov) - matDiff(alt.nodes[at].before.b, pov);
      better = sanOf(alt.nodes[at].before, alt.nodes[at].move);
    }
  }
  var bn = line && line.nodes[at], lw = plainCapture(c.gameLine, c.lossAt, 0), gw = gain >= 1 && line ? plainCapture(line, settle, at) : null;
  a.compare = {
    found: !!(gm[1] && ru[0] && gm[1] === ru[0]), replied: !!gm[1], betterSan: better, gameSan: gameSan(a),
    w: c.lossG >= 1 ? lw || oneWord(null, c.lossG) : '', wn: c.lossG >= 1 ? oneWord(lw, c.lossG) : '',
    w2: gain >= 1 && line ? gw || oneWord(null, gain) : '', w2n: gain >= 1 ? oneWord(gw, gain) : '',
    guard: guardRule(c.gameLine, a.played, bn) && guardMeans(c, a.pre, a.played, bn)
  };
  return a.compare;
}
/* "{bestSan} is guarded." says something only when what the game move
   lost was the piece it moved, taken on the square it went to, and neither
   move is a king's (a king is never guarded against capture) */
function guardMeans(c, pre, played, bn) {
  var g = c.gameLine, mover = pre.b[played.from];
  if (!g || !mover || pType(mover) === 'K' || pType(bn.before.b[bn.move.from]) === 'K') return false;
  for (var k = 1; k <= c.lossAt && k < g.nodes.length; k += 2) {
    var n = g.nodes[k];
    if (n.move && n.move.to === played.to && n.captured) return pType(n.captured) === pType(played.promo || mover);
  }
  return false;
}
/* the guard rule (FINAL-SPEC 3): the square the game move went to is not
   defended once it is played, the better move's square is (isDefended
   says false on an empty square, so each is read on the board just after
   its own move). Its other half, a better move that defends a piece the
   game move left hanging, does not make "{bestSan} is guarded." true, so
   R4 reads only this one */
function guardRule(gameLine, played, bn) {
  var g0 = gameLine && gameLine.nodes[0];
  if (!g0 || !bn || !bn.move || !played) return false;
  return !isDefended(g0.after.b, played.to) && isDefended(bn.after.b, bn.move.to);
}
/* R4, the settled caption (S6), as row 2's ladder {cands, fall}: by the
   card's family, what the game move did against what the better move does.
   Each form also comes with its material as one word ("a rook"), the
   ladder's second step; the mistake alone, then the first sentence and the
   fallback come after */
function r4Of(a) {
  var c = a.cls, cmp = buildCompare(a), g = cmp.gameSan, bs = cmp.betterSan, fam = familyOf(patternOf(a.it.b)).key;
  var w = a.it.b.wa, opp = sidesOf(a).opp, cands = [];
  var past = 'After ' + g + ', ' + (w >= 60 ? 'you were still better' : w >= 40 ? 'the game was even' : opp + ' was on top') + '.';
  /* a form with its material phrase, then the same with the one word */
  var both = function (f, x, xn) { return x === xn || !xn ? [f(x)] : [f(x), f(xn)]; };
  /* the found form ("lost", a checkmate allowed and played) only when the
     opponent did find it: a ladder step that would cut a not-found form
     down to it (never) takes the fallback instead */
  var never = [];
  if ((fam === 'king' || fam === 'safety') && c.mateAgainst) {
    cands = [g + ' allowed checkmate.' + (cmp.found ? '' : ' They missed it.')];
    if (!cmp.found) never.push(g + ' allowed checkmate.');
  }
  else if ((fam === 'safety' || fam === 'king') && c.lossG >= 1) {
    var mistake = function (x) { return g + (cmp.found ? ' lost ' : ' could lose ') + x + '.'; };
    var better = cmp.guard ? bs + ' is guarded. ' : null;
    if (better) cands = both(function (x) { return better + mistake(x); }, cmp.w, cmp.wn);
    else if (cmp.w2) cands = [bs + ' wins ' + cmp.w2 + '. ' + mistake(cmp.w), bs + ' wins ' + cmp.w2n + '. ' + mistake(cmp.wn)];
    /* the mistake alone before the better half alone (the first sentence):
       the game move is what the card is about */
    cands = cands.concat(both(mistake, cmp.w, cmp.wn));
  } else if (fam === 'chances') {
    if (c.mateFor) cands = [bs + ' leads to checkmate.'];
    else if (cmp.w2) {
      var won = function (x) { return bs + ' wins ' + x + '. ' + g + ' missed it.'; };
      /* a trade said as "material" tells less than its own first sentence */
      cands = / for /.test(cmp.w2) ? [won(cmp.w2), bs + ' wins ' + cmp.w2 + '.', won(cmp.w2n)] : both(won, cmp.w2, cmp.w2n);
    }
  } else if (fam === 'conversion') {
    cands = [c.stalemate ? g + ' allowed a draw.' : c.perpetualAgainst ? g + ' allowed endless checks.' : past];
  } else cands = [past];
  return { cands: cands, fall: g + ' was a mistake.', never: never };
}
/* ── The story (S12): See why, one ply per tap ─────────────────────────────
   Two segments. Your game: the game move (G1), then the refutation ply by
   ply to where the loss is counted (cls.lossAt), or to the mate on the
   stored refutation when it mates. Better: the better move (B1) and the
   plies after it to where its material settles (cls.bSettle), the whole
   line to the mate when it mates, or a move that works too stepped from
   where it left the card's line to where its own line settles. Each step is
   {seg, line, k, from}: node k of a buildLine line (node 0 of the game line
   is the game move; node 0 of the better line is a null move, so it starts
   at from = 1, or later for an alternative inside a forcing line), with its
   caption (cap). Built once per card; S.g is the number of game steps,
   S.threat the reply G1 rings and arrows, S.guard the guard dots of B1.
   S.alt: the better segment is your own move's line (an alternative whose
   line could not be built is told as the better move, never as yours);
   S.mateG, S.mateB: that segment ends in a checkmate on its board (a mate
   the line does not reach on screen is told as the material it loses) */
function buildStory(a) {
  if (a.story) return a.story;
  var c = a.cls, it = a.it, pov = myPov(it), steps = [];
  var gl = c.gameLine, gEnd = c.lossAt || 0;
  if (c.mateAgainst) {
    var ref = buildLine(a.pre, a.playedUci, unpackUci(it.b.ru).slice(0, 20), !pov), rk = ref ? mateAt(ref) : -1;
    if (rk >= 0) { gl = ref; gEnd = rk; }
  }
  gEnd = Math.max(0, Math.min(gEnd, gl.nodes.length - 1));
  for (var k = 0; k <= gEnd; k++) steps.push({ seg: 'game', line: gl, k: k, from: 0 });
  var bl = c.bestLine || buildLine(a.pre, '0000', a.lines.best.uci, pov), from = 1, bEnd = Math.max(1, c.bSettle || 0), alt = null;
  if (a.alt && a.yours) {
    var al = buildLine(a.pre, '0000', a.yours.uci, pov), at = (a.yours.at || 0) + 1;
    if (al && al.nodes[at]) { alt = al; bl = al; from = at; bEnd = Math.max(at, settleIndex(al)); }
  } else if (c.mateFor) {
    var ml = buildLine(a.pre, '0000', a.lines.best.uci, pov), mk = ml ? mateAt(ml) : -1;
    if (mk >= 1) { bl = ml; bEnd = mk; }
  }
  bEnd = Math.max(from, Math.min(bEnd, bl.nodes.length - 1));
  for (k = from; k <= bEnd; k++) steps.push({ seg: 'better', line: bl, k: k, from: from });
  var S = a.story = { steps: steps, g: gEnd + 1, threat: storyThreat(c, gl), guard: null, alt: !!alt,
                      mateG: isMate(gl.nodes[gEnd].after), mateB: isMate(bl.nodes[bEnd].after) };
  /* the guard dots and words of B1: the better move's own square guarded
     once it is played, the game move's not (the guard rule, read as R4 reads
     it), by a piece of yours that guards it directly */
  var bn = bl.nodes[from];
  if (!S.alt && from === 1 && buildCompare(a).guard) {
    var mine = colorW(bn.after.b[bn.move.to]), by = attackersOf(bn.after.b, bn.move.to, mine).sort(function (x, y) { return MOTIF_VAL[pType(bn.after.b[x])] - MOTIF_VAL[pType(bn.after.b[y])]; })[0];
    if (by != null) S.guard = { from: by, to: bn.move.to, piece: pType(bn.after.b[by]) };
  }
  steps.forEach(function (s, i) { s.cap = storyCaption(a, S, i); });
  return S;
}
/* the first checkmate along a line (from node 1), -1 when it has none */
function mateAt(line) {
  for (var k = 1; k < line.nodes.length; k++) if (isMate(line.nodes[k].after)) return k;
  return -1;
}
/* the reply G1 marks (S12): the opponent's next move, when it captures or
   checks, or is the move of a fork, pin or discovered attack the classifier
   found right there (ply 1). A tactic further down the line is not on G1's
   board yet, so it is never drawn or named there */
function storyThreat(c, gl) {
  var n1 = gl.nodes[1];
  if (!n1 || !n1.move) return null;
  var al = c.allowed || {}, at1 = function (m) { return !!m && m.ply === 1; };
  var motif = at1(al.fork) ? 'fork' : at1(al.pin) && al.pin.piece !== 'P' ? 'pin' : at1(al.discoveredAttack) ? 'discovered' : null;
  var th = threatOf(gl, 1);
  if (!th && !motif) return null;
  return { from: n1.move.from, to: n1.move.to, motif: motif, th: th, san: sanOf(n1.before, n1.move) };
}
/* a move as a caption names it: its SAN without the check or mate sign,
   on every rung, so one move reads the same in all of them (the board's
   check glow shows a check; the words say it only in the check and mate
   forms) */
function capSan(st, m) { return sanOf(st, m).replace(/[+#]$/, ''); }
/* a ply in plain words (S-ply): a capture names what it took, and whose; a
   check or a mate says so */
function plySay(a, n) {
  var san = capSan(n.before, n.move), byMe = n.byWhite === myPov(a.it);
  if (isMate(n.after)) return san + '. Checkmate.';
  if (n.captured) return san + ' takes ' + (byMe ? 'their ' : 'your ') + PIECE_WORD[pType(n.captured)] + '.';
  if (checkersOf(n.after).length) return san + ', check.';
  return san + '.';
}
/* what changed hands from node `from` to node k, as the caption names it:
   the line's own captures, else (only when the count really moved) the
   words that claim no piece; one word for the ladder's second step */
function storyGain(line, k, from, net) {
  if (net < 1) return null;
  var x = plainCapture(line, k, from);
  return { w: x || oneWord(null, net), wn: oneWord(x, net) };
}
/* a capture that already says it: the step took that one piece */
function namesIt(n, w) {
  return !!(n.captured && w && (w === 'the ' + PIECE_WORD[pType(n.captured)] || w === 'a ' + PIECE_WORD[pType(n.captured)]));
}
/* the caption of step i (S-G1, S-opp, S-ply, S-B1, S-same), fitted to the
   caption's 60 characters and 8 words. Each says what the ply shown does,
   true on its board; the last step of a segment adds what it lost or won */
function storyCaption(a, S, i) {
  var c = a.cls, s = S.steps[i], n = s.line.nodes[s.k], sd = sidesOf(a), pov = myPov(a.it), cands = [], fall = '';
  var lastG = s.seg === 'game' && i === S.g - 1, lastB = s.seg === 'better' && i === S.steps.length - 1;
  var san = n.move ? capSan(n.before, n.move) : '';
  if (s.seg === 'game' && s.k === 0) {
    var g = capSan(a.pre, a.played), t = S.threat, n1 = s.line.nodes[1];
    fall = g + ', your game move.';
    if (c.stalemate) cands.push(g + '. ' + sd.opp + ' has no move: a draw.');
    else if (c.mateAgainst && S.mateG) cands.push(g + '. Now ' + sd.opp + ' can checkmate.');
    else if (t) {
      var th = t.th;
      if (th && th.captured) {
        var cap = PIECE_WORD[th.captured];
        if (!isDefended(n1.before.b, th.to)) cands.push(g + '. Nothing guards the ' + cap + ' on ' + sqName(th.to) + '.');
        else if (MOTIF_VAL[th.piece] < MOTIF_VAL[th.captured]) cands.push(g + '. Their ' + PIECE_WORD[th.piece] + ' can take your ' + cap + '.');
      }
      if (!cands.length && t.motif === 'fork') cands.push(g + '. Now ' + t.san.replace(/[+#]$/, '') + ' hits two pieces.');
      if (!cands.length && th && th.check) cands.push(g + '. Now ' + t.san.replace(/[+#]$/, '') + ' is check.');
      /* a pin only when it already holds on G1's board */
      if (!cands.length && t.motif === 'pin' && pinRay(n1.before.b, c.allowed.pin.sq)) cands.push(g + '. Your ' + PIECE_WORD[c.allowed.pin.piece] + ' can\'t move safely.');
      if (!cands.length && t.motif === 'discovered') cands.push(g + '. Moving one piece opens a line.');
    }
    return fitRow(cands, 'caption', fall);
  }
  fall = san + '.';
  var say = plySay(a, n);
  if (s.seg === 'game') {
    /* their first reply: whether they found it in the game (S-opp). "They
       missed it." only when there was a blow to miss (a mate, or material
       the line wins) and they replied with something else; a reply that
       blows nothing is just its ply */
    var cmp0 = buildCompare(a), found = s.k === 1 && cmp0.found;
    var missed = s.k === 1 && !found && cmp0.replied && (!!c.mateAgainst || c.lossG >= 1);
    var heads = [say];
    if (s.k === 1 && n.captured && !isMate(n.after) && (found || missed)) {
      var pw = PIECE_WORD[pType(n.captured)];
      heads = [found ? san + ' takes your ' + pw + ', as in your game.' : san + ' could take your ' + pw + '. They missed it.', say];
    } else if (found) heads = [say + ' As in your game.', say];
    else if (missed) heads = [say + ' They missed it.', say];
    var loss = lastG && !S.mateG && !isMate(n.after) ? storyGain(s.line, s.k, 0, c.lossG) : null;
    if (loss && !namesIt(n, loss.w)) {
      /* the net loss before the step's longer words: last, the move alone
         (its token shows what it took) */
      heads.concat([san + '.']).forEach(function (h) { cands.push(h + ' You lose ' + loss.w + '.'); });
      heads.concat([san + '.']).forEach(function (h) { if (loss.wn !== loss.w) cands.push(h + ' You lose ' + loss.wn + '.'); });
    }
    return fitRow(cands.concat(heads), 'caption', fall);
  }
  var cmp = buildCompare(a), gain = matDiff(n.after.b, pov) - matDiff(s.line.nodes[s.from].before.b, pov);
  if (s.k === s.from) {
    var bs = san;
    fall = 'Better: ' + bs + '.';
    if (S.alt) cands.push('Your ' + bs + ' works too.');
    else if (c.mateFor && S.mateB) cands.push(fall + ' It leads to checkmate.');
    else if (S.guard) cands.push(fall + ' The ' + PIECE_WORD[S.guard.piece] + ' on ' + sqName(S.guard.from) + ' guards it.');
    else if (cmp.w2) { cands.push(fall + ' It wins ' + cmp.w2 + '.'); if (cmp.w2n !== cmp.w2) cands.push(fall + ' It wins ' + cmp.w2n + '.'); }
    return fitRow(cands, 'caption', fall);
  }
  /* the same blow as in the game, a move later (S-same, 3.7): what the
     better line nets where it settles (cls.matBest at bSettle) against what
     the game lost, in the copy row's forms when one is true; a line that
     loses as much says the capture again, which is all that is true */
  var g1 = c.gameLine.nodes[1];
  if (!S.alt && !S.mateB && s.k === 2 && c.bestLine && s.line === c.bestLine && g1 && sameMove([n.move.from, n.move.to], [g1.move.from, g1.move.to])) {
    var net = c.matBest, lost = c.lossG;
    fall = san + ' still comes.';
    if (net >= 1 && cmp.w2) { cands.push(san + ' still comes, but you win ' + cmp.w2 + '.'); if (cmp.w2n !== cmp.w2) cands.push(san + ' still comes, but you win ' + cmp.w2n + '.'); }
    else if (net === 0 && lost >= 1) cands.push(san + ' still comes, but you lose nothing.');
    else if (net < 0 && -net < lost) cands.push(san + ' still comes. You lose less.');
    else if (n.captured && colorW(n.captured) === pov) cands.push(san + ' still takes your ' + PIECE_WORD[pType(n.captured)] + '.');
    return fitRow(cands, 'caption', fall);
  }
  var won = lastB && !isMate(n.after) ? storyGain(s.line, s.k, s.from, gain) : null;
  if (won && !namesIt(n, won.w)) [say, san + '.'].forEach(function (h) { cands.push(h + ' You win ' + won.w + '.'); if (won.wn !== won.w) cands.push(h + ' You win ' + won.wn + '.'); });
  /* a better line that still loses material where it ends says so only when
     it loses less than the game did; otherwise its ply alone */
  else if (lastB && !isMate(n.after) && gain < 0 && -gain < c.lossG) cands.push(say + ' You lose less.', san + '. You lose less.');
  return fitRow(cands.concat([say]), 'caption', fall);
}
/* the story's strip (S12): "Game ●●● Better ●", the step on screen larger;
   over 9 dots, "Game 2/5 · Better". Its words count in the budget */
function storyStripWords(a) {
  var S = buildStory(a);
  return S.steps.length > 9 ? 3 : 2;
}
/* the words the strip shows (2.0): the Details link once settled, the
   story's two names; nothing before an answer (the typed-move field is off
   screen until it has the keyboard). A word for a tap (N1) takes the
   story's strip for a while */
function stripWords(a) {
  if (a.phase !== 'done' || a.explore || !a.view) return 0;
  if (a.view.mode === 'story') return a.note && a.note.key === cardStateKey(a) ? wordsIn(CARD_COPY.N1(a)) : storyStripWords(a);
  if (a.view.mode) return a.view.mode === 's0' && a.settle >= 2 ? 1 : 0;
  return 2;
}
/* the words row 2 has left beside row 1, the chip, the strip and the bar. A miss's
   bar changes while its words stay (See it gives way to Hint or Show the
   answer), so its row 2 is fitted once, beside the wider of its two bars:
   the reason never rewrites itself when only a button changes */
function rowRoom(a, b) {
  var ss = ui.session, slots = ss ? barSlots(a, ss) : [], bw = barWords(slots);
  if (ss && a.phase === 'tried' && a.tried && a.tried.kind === 'miss') bw = Math.max(barWords(triedSlots(a, false)), barWords(triedSlots(a, true)));
  return (b.budget || WORD_BUDGET) - bandWords({ row1: b.row1, chip: b.chip }, []) - bw - stripWords(a);
}
/* what the card is showing, so a word or an outline meant for one state
   never outlives it: a move (each one counted, so coming back to the same
   phase is still a change), a try seen, a hint, a step */
function cardStateKey(a) {
  var t = a.tried;
  var v = a.view;
  return [a.phase, a.fxn || 0, t ? t.uci + (t.seen ? '+' : '') : '', a.hints, a.solIdx, v ? (v.mode === 'story' ? 'story:' + v.i : v.mode) : '', a.explore ? 'x' : ''].join('|');
}
function bandOf(a) {
  var t = a.tried, v = a.verdict;
  /* exploring (S14): what it is, in two fixed rows; Stockfish's sentence
     is in the panel */
  if (a.phase === 'done' && a.explore) return { disc: 'king', kind: 'explore', row1: CARD_COPY.X1(), row2: CARD_COPY.X2(a) };
  /* the story: one caption for the ply on the board, the card's verdict
     disc kept, a red border on your game's steps, green on the better ones */
  if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    var sp = buildStory(a).steps[a.view.i];
    return { disc: a.revealed ? 'info' : 'good', kind: sp.seg === 'game' ? 'sgame' : 'sbetter', cap: sp.cap };
  }
  if (a.phase === 'done') {
    /* row 2: R4 once the result has settled (S0 at V+850, and the story
       that follows it); before that the answer shown says how to play it
       (V2), and a solve says nothing more yet */
    var mode = a.view && a.view.mode, said = !mode || (mode === 's0' && a.settle >= 2), r4 = said ? r4Of(a) : null;
    /* settled, a reveal names the card's own answer, the move R4 is about
       (inside a forcing line the band named each move as it came) */
    if (a.revealed)
      return { disc: 'info', kind: 'info', row1: CARD_COPY.V1(a, r4 ? sanOf(a.pre, a.best) : ''), cands: r4 ? r4.cands : [CARD_COPY.V2()], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null };
    return { disc: 'good', kind: 'good', row1: a.alt ? CARD_COPY.R3() : a.result === 'first' ? CARD_COPY.R1() : CARD_COPY.R2(),
             cands: r4 ? r4.cands : [], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null };
  }
  /* S3: the band keeps what it said for 300 ms, then says the move is
     being checked, and at 3 s that it still is */
  if (a.phase === 'checking' && a.checkSaid)
    return { disc: 'checking', kind: 'neutral', sweep: true, row1: fitRow([CARD_COPY.K1(a)], 'row1', 'Checking…'), cands: a.checkSaid >= 2 ? [CARD_COPY.K2()] : [], fall: '' };
  if (a.phase === 'tried' && t) {
    /* a miss's reason waits for its own beat (S4, a.reason 2): the verdict
       alone first */
    var tv = v || triedVerdict(a, t, null, false), wait = t.kind === 'miss' && (a.reason || 0) < 2;
    return { disc: t.kind === 'miss' ? 'bad' : t.kind, kind: t.kind === 'miss' ? 'bad' : t.kind === 'unchecked' ? 'info' : 'close',
             row1: tv.row1, cands: wait ? [] : tv.cands, fall: wait ? '' : tv.fall };
  }
  /* a move of the forcing line found (S10): right, and their reply comes */
  if (a.phase === 'reply') return { disc: 'good', kind: 'good', row1: CARD_COPY.F1(), cands: [CARD_COPY.F2(a)], fall: '', budget: LINE_BUDGET };
  /* a hint says itself on the showing it came with (pressed, or the
     automatic one this Try again brought: S4), and afterwards while its
     marks stand on the board, so band and board agree; a hint in words
     only, from before the last miss, gives the task back (T1, T2). A
     hint set with no showing recorded (hintAt) counts as this one's */
  var mid = a.sol && a.solIdx > 0, hm = a.hints >= 1 ? hintMarks(a) : null;
  /* the worked example (S9) says its drawn hint as any hint 1 does ("Hint
     1 of 2", what the game move runs into), from its first frame */
  if (a.hints >= 1 && (a.hintAfter || !mid) && (a.hintAt == null || a.hintAt === a.misses || hm.rings.length + hm.arrows.length > 0)) {
    var h = hintText(a);
    return { disc: 'king', kind: 'hint', row1: h.row1, cands: h.cands, fall: h.fall };
  }
  /* their reply has landed: your move, and what it did (F4) */
  if (mid) return { disc: 'king', kind: 'neutral', row1: CARD_COPY.F3(), cands: a.replySaid ? a.replySaid.slice() : [], fall: 'The next move is forcing too.', budget: LINE_BUDGET };
  return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), cands: [CARD_COPY.T2(a)], fall: '', chip: ss_relearn(a) ? CARD_COPY.T3() : '' };
}

/* ── the board's labels (FINAL-SPEC 2.1, copy L) ─────────────────────────
   One pill a frame names one mark, in words read from what is drawn, never
   from the pattern tag. The first time a kind of mark ever shows on this
   device its label teaches it (first sight: the game arrow, a threat, a
   lost piece, the ghost); after that the short words. Labels are the first
   words to go when a frame is over its budget (principle 5): a label shows
   only where the words on screen leave it room. LABELS_ON false takes every
   label away, first sight too, and the band carries the meaning alone */
var LABELS_ON = true;
var TIP_KINDS = ['game', 'threat', 'token', 'ghost'];
/* what a move does on the position it is played from: what it takes (and
   whether that piece was guarded), a check, a mate, a draw (no move left,
   no check), a fork (mFork on the board after it) and a pin it makes (mPin,
   a pin that was not there before it, never of a pawn). null when it is no
   legal move there */
function moveDoes(pos, from, to) {
  var m = legalMoves(pos).filter(function (x) { return x.from === from && x.to === to; })[0];
  if (!m) return null;
  var after = cloneState(pos);
  applyMove(after, m);
  var tsq = m.ep >= 0 ? m.ep : to, took = pos.b[tsq] || null, check = checkersOf(after).length > 0, none = !legalMoves(after).length;
  var mover = !!pos.w, node = { after: after, move: m, piece: pType(pos.b[from]) };
  var fork = mFork({ nodes: [{}, node, {}, { piece: 'K' }], povWhite: mover });
  var pin = mPin({ nodes: [{}, node], povWhite: mover }), was = pin && mPin({ nodes: [{}, { after: pos }], povWhite: mover });
  return { took: took, free: !!took && !isDefended(pos.b, tsq), check: check, mate: check && none, draw: !check && none,
           fork: !!fork, pin: !!pin && pin.piece !== 'P' && !(was && was.sq === pin.sq) };
}
/* a threat arrow in words (L): checkmate, a draw, what it takes ("free
   knight" when nothing guards it), a fork ("hits two", "fork" at tier 3),
   a check, a pin ("stuck", "pinned" at tier 3); and its first-sight words,
   "{Opp} can take" or "{Opp} can check". Every word is read on the board as
   drawn, its piece to move: S0's ghost counts as the piece on its square.
   Hint 1's danger (the arrow keyed hint) is the reply the game line has
   after the game move, not one on the board now: no first-sight words, and
   "takes" only when that capture of one of yours is there as drawn (S8).
   null: nothing true to say */
function threatSay(a, f, ar) {
  var ap = f.st.b[ar.from];
  if (!ap) return null;
  var pos = cloneState(f.st), s0 = a.phase === 'done' && a.view && a.view.mode === 's0';
  pos.w = colorW(ap);
  pos.ep = -1;
  if (s0) (f.opts.ghosts || []).forEach(function (g) { if (g.sq === ar.to && !pos.b[g.sq]) pos.b[g.sq] = g.p; });
  var d = moveDoes(pos, ar.from, ar.to);
  if (!d) return null;
  if (ar.key === 'hint') return d.took && colorW(d.took) === myPov(a.it) ? { say: 'takes', teach: '', does: d } : null;
  var t = a.tier, opp = sidesOf(a).opp;
  var say = d.mate ? 'mate' : d.draw ? 'draw' : d.took ? (d.free ? 'free ' + PIECE_WORD[pType(d.took)] : 'takes')
    : d.fork ? (t === 3 ? 'fork' : 'hits two') : d.check ? 'check' : d.pin ? (t === 3 ? 'pinned' : 'stuck') : '';
  return { say: say, teach: d.took ? opp + ' can take' : d.check ? opp + ' can check' : '', does: d };
}
/* the labels a frame could show, in the order they take the one place:
   first-sight labels first (game arrow, threat, lost piece, ghost), then
   the short ones (their reply, a threat, the piece See it took, the better
   move or the answer, a hint's prize, Stockfish's pick). seen(kind): that
   kind of mark has taught itself already. Each: {text, role (red, green,
   blue, gold), tip (its first-sight kind), head, tail (the squares it sits
   beside: an arrow's head and tail, or the marked square), mark (what it
   names)}. A short label of a kind that teaches itself (a threat's words,
   "lost") waits until that kind has: where its first-sight words do not
   fit, that kind has no label yet. Nothing while a piece slides: words
   never change in a slide */
function labelCands(a, f, seen) {
  var o = f.opts, first = {}, short = [], answered = a.phase === 'done';
  if (!LABELS_ON || o.anim || o.decor) return [];
  var cand = function (text, role, tip, head, tail, mark, order) { return { text: text, role: role, tip: tip, head: head, tail: tail, mark: mark, order: order }; };
  var arrows = [];
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better', key: 'good' });
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  arrows.concat(o.arrows || []).forEach(function (ar) {
    var mk = { kind: ar.kind, key: ar.key || null, from: ar.from, to: ar.to };
    if (ar.kind === 'game') { if (!seen('game') && !first.game) first.game = cand('Your game move', 'red', 'game', ar.to, ar.from, mk); }
    else if (ar.kind === 'threat') {
      var w = threatSay(a, f, ar);
      if (!w) return;
      mk.does = w.does;
      if (w.teach && !seen('threat') && !first.threat) first.threat = cand(w.teach, 'red', 'threat', ar.to, ar.from, mk);
      if (w.say && seen('threat')) short.push(cand(w.say, 'red', null, ar.to, ar.from, mk, 1));
    }
    else if (ar.kind === 'reply') short.push(cand('their reply', 'blue', null, ar.to, ar.from, mk, 0));
    else if (ar.kind === 'better' && answered) short.push(cand(ar.key === 'answer' ? 'the answer' : 'better', 'green', null, ar.to, ar.from, mk, 3));
    else if (ar.kind === 'explore') short.push(cand(a.tier === 1 ? 'the computer' : 'Stockfish', 'gold', null, ar.to, ar.from, mk, 5));
  });
  (o.tokens || []).forEach(function (tk) {
    if (tk.kind === 'won') return;
    var mk = { kind: 'token', sq: tk.sq, p: tk.p };
    if (!seen('token') && !first.token) first.token = cand('Lost piece', 'red', 'token', tk.sq, null, mk);
    /* "lost": the piece See it's reply took, as it lands (S4) */
    if (a.phase === 'tried' && a.tried && a.tried.seen && seen('token')) short.push(cand('lost', 'red', null, tk.sq, null, mk, 2));
  });
  (o.ghosts || []).forEach(function (g) {
    if (!seen('ghost') && !first.ghost) first.ghost = cand(gameSan(a) + ' in your game', 'red', 'ghost', g.sq, null, { kind: 'ghost', sq: g.sq, p: g.p });
  });
  /* a hint's prize (S8): "free {piece}" when nothing of theirs guards it */
  (o.rings || []).forEach(function (rg) {
    var p = f.st.b[rg.sq];
    if (rg.kind === 'target' && p && !isDefended(f.st.b, rg.sq)) short.push(cand('free ' + PIECE_WORD[pType(p)], 'gold', null, rg.sq, null, { kind: 'prize', sq: rg.sq, p: p }, 4));
  });
  short.sort(function (x, y) { return x.order - y.order; });
  return TIP_KINDS.map(function (k) { return first[k]; }).filter(Boolean).concat(short);
}
/* the words a label may take beside the band, the bar and the strip
   (principle 5: 15, the label going first). Read on the frame's words as
   they settle, so a label never comes and goes within one state: a miss
   with its reason said (S4), S0 with R4 and Details (S6). Exploring is
   exempt (S14) */
function labelRoom(a) {
  var ss = ui.session;
  if (a.phase === 'done' && a.explore) return 99;
  var v = Object.create(a);
  if (a.phase === 'tried' && a.tried && a.tried.kind === 'miss') v.reason = 2;
  if (a.phase === 'done' && a.view && a.view.mode === 's0' && a.settle >= 1) v.settle = 2;
  var b = bandFor(v);
  return WORD_BUDGET - bandWords(b, ss ? barSlots(v, ss) : []) - stripWords(v);
}
