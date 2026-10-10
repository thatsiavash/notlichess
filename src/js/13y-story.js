/* ── The card's words ───────────────────────────────────────────────────
   Every string on the card's face lives here, never in the classifier, so
   the explanation snapshot and CLASSIFY_V do not move. The band has two
   rows: row 1 at most 26 characters, row 2 at most 40 characters and 7
   words (a caption, the stepped story's layout, 60 and 8). Every templated
   row runs the fit ladder: the full text, the same with each material
   phrase as one word, its first sentence, then the row's fallback. */
var ROW_CAPS = { row1: { ch: 26, words: 99 }, row2: { ch: 40, words: 7 }, caption: { ch: 60, words: 8 } };

/* the move played in the game, and the two sides, as the copy names them */
function gameSan(a) { return sanOf(a.pre, a.played); }
/* tier 1 says a move in words: "rook to g1", "pawn takes on d3",
   "castling", "pawn to e8 to make a queen"; tiers 2 and 3 keep SAN.
   The words carry no check (the board's glow shows it, and the story's
   forms say it). Each row tries every form in words first, then the same
   form in SAN (interleave), so the fit ladder falls back to SAN only where
   the words do not fit. A move in words counts as one word against a row's
   cap and the word budget, as its SAN does (oneUnit). MOVE_WORDS false
   keeps SAN at every tier */
var MOVE_WORDS = true;
function inWords(a) { return MOVE_WORDS && a.tier === 1; }
function moveWords(st, m) {
  var p = m && st.b[m.from];
  if (!p) return '';
  if (m.castle || (pType(p) === 'K' && Math.abs(m.to - m.from) === 2)) return 'castling';
  /* where two pieces of that kind can go there, the one that moves:
     "rook from a8 to d8" */
  var twin = legalMoves(st).some(function (x) { return x.to === m.to && x.from !== m.from && st.b[x.from] === p; });
  return PIECE_WORD[pType(p)] + (twin ? ' from ' + sqName(m.from) : '') + (st.b[m.to] || m.ep >= 0 ? ' takes on ' : ' to ') + sqName(m.to)
    + (m.promo ? ' to make a ' + PIECE_WORD[pType(m.promo)] : '');
}
function upFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
var MOVE_PHRASE = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling\b/gi;
function oneUnit(s) { return String(s || '').replace(MOVE_PHRASE, 'M'); }
/* a row's forms in words and in SAN (lists of the same forms in the same
   order), each words form just before its SAN twin */
function interleave() {
  var lists = [].slice.call(arguments), out = [], n = Math.max.apply(null, lists.map(function (l) { return l.length; }));
  for (var i = 0; i < n; i++) lists.forEach(function (l) { if (l[i] && out.indexOf(l[i]) < 0) out.push(l[i]); });
  return out;
}
function sidesOf(a) {
  var w = myPov(a.it);
  return { me: w ? 'White' : 'Black', mine: w ? 'white' : 'black', opp: w ? 'Black' : 'White' };
}

/* the copy table, by its ids: the task (T1, T2), the relearn chip
   (T3), the three answers to a tap that is not a move (T4 their piece, T5
   a drop where that piece cannot go, N1 any piece after an answer), a move
   being checked (K1 at 300 ms, K2 at 3 s), a wrong try (M1, M2 for the game
   move again), a good move that is not the best (C1, C2) and a move the
   engine could not check (E1, E2) */
var CARD_COPY = {
  T1: function () { return 'Your turn'; },
  T2: function (a, w) { return 'Find a better move than ' + (w ? moveWords(a.pre, a.played) : gameSan(a)) + '.'; },
  T3: function () { return 'One more try'; },
  T4: function (a) { var s = sidesOf(a); return 'You are ' + s.me + '. Move a ' + s.mine + ' piece.'; },
  T5: function () { return 'That piece can\'t go there.'; },
  N1: function () { return 'To try moves, open Details.'; },
  /* exploring (S14): its band, and at tier 1 a row's standing in words
     (X3) from the learner's winning chances w; tiers 2 and 3 keep numbers */
  X1: function () { return 'Try your own moves'; },
  X2: function (a) { return (a.tier === 1 ? 'The computer' : 'Stockfish') + ' rates each move.'; },
  X3: function (a, w) {
    var opp = sidesOf(a).opp;
    return w >= 80 ? 'you are winning' : w >= 60 ? 'you are better' : w >= 40 ? 'even game' : w >= 20 ? opp + ' is better' : opp + ' is winning';
  },
  K1: function (a, w) { return 'Checking ' + ((w ? a.checkingW : a.checking) || 'your move') + '…'; },
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
  V3: function () { return 'Here is the answer'; },
  H1: function () { return 'Hint 1 of 2'; },
  H3: function () { return 'Hint 2 of 2'; },
  H3b: function () { return 'Move the circled piece.'; },
  H3c: function () { return 'Find a safe square.'; },
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
  var forms = function (w) {
    var did = took ? 'took your ' + PIECE_WORD[pType(took)] : checkersOf(after).length ? 'gives check' : 'played ' + (w ? moveWords(st, m) : capSan(st, m));
    return [opp + ' ' + did + ', as expected.', opp + ' ' + did + '.'];
  };
  return inWords(a) ? interleave(forms(true), forms(false)) : forms(false);
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
  /* the ledger's pieces are no words (each takes two characters, rowLen) */
  return !!s && rowLen(s) <= cap.ch && wordsIn(s) <= cap.words && oneUnit(s).split(/\s+/).filter(function (t) { return !/^[\u2654-\u265f.,]+$/.test(t); }).length <= cap.words;
}
function firstSentence(s) { var m = /^.*?[.!?…](?=\s|$)/.exec(String(s || '')); return m ? m[0] : String(s || ''); }
/* fallback: one string, or its words and SAN forms in that order */
function fitRow(cands, row, fallback) {
  var list = [].concat(cands).filter(Boolean);
  list = list.concat(list.map(firstSentence)).concat([].concat(fallback).filter(Boolean));
  for (var i = 0; i < list.length; i++) if (fitsRow(list[i], row)) return list[i];
  return '';
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
function wordsIn(s) { return oneUnit(s).split(/\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length; }
function barWords(slots) { return (slots || []).reduce(function (n, b) { return n + wordsIn(b.label); }, 0); }
function bandWords(b, slots) { return wordsIn(b.row1) + wordsIn(b.row2) + wordsIn(b.chip) + wordsIn(b.cap) + barWords(slots); }
/* a verdict as the band says it: {kind, row1, row2, html},
   with row 2's ladder kept (cands, fall) so the band can fit it to the
   words left beside the bar */
function verdictOf(kind, row1, cands, fall) {
  cands = [].concat(cands || []).filter(Boolean);
  var row2 = fitRow(cands, 'row2', fall || '');
  return { kind: kind, row1: row1, row2: row2, cands: cands, fall: fall || '', html: row1 + (row2 ? ' ' + row2 : '') };
}
/* what changed hands along a line, in plain words: the
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
/* ── the piece ledger (F1.2, F1.4) ──────────────────────────────────────
   What changed hands, when it is a trade or more than one kind of piece,
   is shown in the board's own pieces instead of words ("Rg1 lost ♕♗ for
   ♜."): in a row's text each piece is its chess symbol, in its side's
   colour; it counts no words and takes two of a row's characters (rowLen);
   the band draws each symbol as the board's piece (ledgerHtml) and a screen
   reader hears the words (ledgerSay: "a queen and a bishop for a rook").
   One kind of piece ("the queen", "two pawns") stays in words */
var LEDGER = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
var LEDGER_RE = /[\u2654-\u265f]/g;
function rowLen(s) { s = String(s || ''); return s.length + (s.match(LEDGER_RE) || []).length; }
/* the pieces each side took along a line from node `from` to node k, as
   captureWord counts them (equal swaps cancel, a knight against a bishop
   too): {gained, lost} piece letters in their colours, most valuable
   first. A pawn that promotes on the way and is taken counts as the pawn
   it was; one still standing at k leaves no count in pieces: null, as
   when the line's side gained nothing */
function ledgerOf(line, k, from) {
  var gained = [], lost = [], start = from == null ? 1 : from, promo = {};
  if (!line) return null;
  for (var i = start; i <= k && i < line.nodes.length; i++) {
    var n = line.nodes[i], m = n.move;
    if (!m) continue;
    var cap = n.captured, csq = m.ep >= 0 ? m.ep : m.to;
    if (cap && promo[csq]) { delete promo[csq]; cap = colorW(cap) ? 'P' : 'p'; }
    if (cap) (n.pov ? gained : lost).push(cap);
    if (promo[m.from]) { delete promo[m.from]; promo[m.to] = 1; }
    if (m.promo) promo[m.to] = 1;
  }
  if (Object.keys(promo).length) return null;
  [false, true].forEach(function (cross) {
    for (var g = gained.length - 1; g >= 0; g--) {
      var t = pType(gained[g]), j = -1;
      lost.forEach(function (l, li) { if (j < 0 && (pType(l) === t || (cross && (t === 'N' || t === 'B') && pType(l) === (t === 'N' ? 'B' : 'N')))) j = li; });
      if (j >= 0) { gained.splice(g, 1); lost.splice(j, 1); }
    }
  });
  var byVal = function (x, y) { return MOTIF_VAL[pType(y)] - MOTIF_VAL[pType(x)]; };
  return gained.length ? { gained: gained.sort(byVal), lost: lost.sort(byVal) } : null;
}
/* the icons for a material phrase x (the line's own words for what its
   side gained up to node k), when x is not one kind of piece: a trade, two
   kinds, or the words that name nothing ("material"). '' when x names one
   kind of piece, or the line cannot be read in pieces */
function ledgerIcons(line, k, from, x) {
  if (x && !/ for | and /.test(x) && x !== 'material') return '';
  var lg = ledgerOf(line, k, from), sym = function (l) { return l.map(function (p) { return LEDGER[p]; }).join(''); };
  return lg ? sym(lg.gained) + (lg.lost.length ? ' for ' + sym(lg.lost) : '') : '';
}
/* the ledger's symbols in words, for a screen reader */
function ledgerSay(s) {
  return String(s || '').replace(/[\u2654-\u265f]+/g, function (run) {
    var c = {};
    run.split('').forEach(function (g) { for (var p in LEDGER) if (LEDGER[p] === g) c[pType(p)] = (c[pType(p)] || 0) + 1; });
    var ws = Object.keys(c).sort(function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; }).map(function (t) {
      return c[t] === 1 ? 'a ' + PIECE_WORD[t] : (c[t] === 2 ? 'two ' : c[t] === 3 ? 'three ' : c[t] + ' ') + PIECE_WORD[t] + 's';
    });
    return ws.length < 2 ? ws.join('') : ws.slice(0, -1).join(', ') + ' and ' + ws[ws.length - 1];
  });
}
/* a row's text as the band draws it: escaped, each ledger symbol the
   board's own piece (a black one haloed), the words beside it for a screen
   reader */
function ledgerHtml(s) {
  s = String(s || '');
  if (!/[\u2654-\u265f]/.test(s)) return esc(s);
  var html = esc(s).replace(/[\u2654-\u265f]/g, function (g) {
    var p = null;
    for (var q in LEDGER) if (LEDGER[q] === g) p = q;
    return '<svg class="pc-ico' + (colorW(p) ? '' : ' pc-b') + '" viewBox="0 0 45 45"><use href="#pc-' + PIECE_ID[p] + '"/></svg>';
  });
  return '<span aria-hidden="true">' + html + '</span><span class="sr-only">' + esc(ledgerSay(s)) + '</span>';
}
/* how many times, in words */
function timesWord(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : (['', '', '', 'three', 'four', 'five', 'six'][n] || n) + ' times'; }
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

/* ── what a line may claim (fresh-eyes fixes A) ─────────────────────────
   A count of material is a result only where the line lets it stand: not
   on a capture or a check the line leaves unanswered (its last ply), and
   not with a capture or a check coming in the next two plies. The claim
   must also agree with the engine (a loss far bigger than the score's drop
   is a line cut short, not what the move costs) and with the better move
   (a loss the best line suffers as well is not why the move is wrong). A
   claim that fails any of these is not made: the caller says where the
   game stands instead */
var EVAL_SLACK = 3;
function quietPly(x) { return !x || !x.move || (!x.captured && !x.move.promo && !checkersOf(x.after).length); }
function settledAt(line, k) {
  var n = line && line.nodes;
  if (!n || !n[k]) return false;
  if (k === n.length - 1) return quietPly(n[k]);
  return quietPly(n[k + 1]) && quietPly(n[k + 2]);
}
/* the solver's score after the game move, in centipawns, as cardLines
   reads it (the deeper look, a mate, else the scan's win chance) */
function gameCpAfter(b) { return b.ea != null ? b.ea : b.ma != null ? (b.ma > 0 ? 1500 : -1500) : cpFromWin(b.wa); }
/* what the card's best line loses (in pawns, 0 when nothing) from its node
   j (the position the move is asked from: node 0 is the card's own, node
   solIdx inside a forcing line), read where it settles and where it ends
   when it is settled there; the worse of the two. line, settle: another
   line of yours and where it settles (S0's board on your own move's line) */
function bestLossFrom(a, j, line, settle) {
  if (!line) { line = a.cls.bestLine; settle = a.cls.bSettle; }
  var pov = myPov(a.it);
  if (!line || !line.nodes[j]) return 0;
  var base = matDiff(line.nodes[j].after.b, pov), worst = 0;
  [settle, line.nodes.length - 1].forEach(function (k) {
    if (k > j && settledAt(line, k)) worst = Math.min(worst, matDiff(line.nodes[k].after.b, pov) - base);
  });
  return -worst;
}
/* the loss a move's line (line, from node `from`: 0 for a move's own line,
   whose node 0 is that move) may claim at node k: {n, w, wn, k} or null.
   cpAfter, cpBest: the solver's score after the move and after the best
   one; bestLoss: what the best line loses itself. When the count at k does
   not stand and the line ends on a capture of the solver's (it takes
   something back), the count at the line's end, said "X for Y" (unless
   only: the story, which claims nothing past the ply on screen) */
function lossClaim(a, line, k, from, cpAfter, cpBest, bestLoss, only) {
  if (!line || !line.nodes[k]) return null;
  var pov = myPov(a.it), base = matDiff(line.nodes[from].before.b, pov), last = line.nodes.length - 1;
  var drop = cpAfter != null && cpBest != null ? (cpBest - cpAfter) / 100 : null;
  var at = [k];
  var back = line.nodes[last];
  if (!only && last > k && back.captured && colorW(back.captured) !== pov) at.push(last);
  for (var i = 0; i < at.length; i++) {
    var kk = at[i], n = base - matDiff(line.nodes[kk].after.b, pov);
    if (!(kk === k ? settledAt(line, kk) : true)) continue;
    if (n < 1 || n <= (bestLoss || 0)) continue;
    if (drop != null && cpAfter > -900 && n > drop + EVAL_SLACK) continue;
    var x = plainCapture(line, kk, from);
    /* ic: the same in the board's pieces, when it is not one kind (F1.2, F1.4) */
    return { n: n, w: x || oneWord(null, n), wn: oneWord(x, n), k: kk, ic: ledgerIcons(line, kk, from, x) };
  }
  return null;
}
/* the game's own moves from the card's position (the game move first), as
   UCI, up to n plies; shorter when the game ended */
function realGame(a, n) {
  var toks = a.it.g.mv.split(' '), st = cloneState(a.pre), out = [];
  for (var k = a.it.b.p; k < Math.min(toks.length, a.it.b.p + n); k++) {
    var m = sanToMove(st, toks[k]);
    if (!m) break;
    out.push(moveUci(m));
    applyMove(st, m);
  }
  return out;
}

/* where the game's own loss stands on its own moves (final fixes 1), when
   it left the engine's line: rl, the game's moves from the card's position
   (node 0 the game move). The first ply that mates you, or whose loss is
   claimed by the same rule as every other (lossClaim: it stands there, in
   line with the score, more than the best line loses), or the game's last
   move when the game ended on it with more lost than the best line loses
   (nothing was played after it). Only up to your next flagged mistake in
   that game: what comes after it is that mistake's. -1 when the game lost
   nothing so (or the card is not about material) */
function realLossAt(a, rl) {
  var c = a.cls, it = a.it, pov = myPov(it), last = rl.nodes.length - 1;
  var base = matDiff(rl.nodes[0].before.b, pov), bl = bestLossFrom(a, 0);
  var ended = it.b.p + last === it.g.mv.split(' ').length - 1;
  var hz = last;
  (it.g.bl || []).forEach(function (b) { if (!b.x && b.p > it.b.p) hz = Math.min(hz, b.p - it.b.p - 1); });
  for (var k = 1; k <= hz; k++) {
    var nd = rl.nodes[k];
    if (isMate(nd.after)) return nd.byWhite !== pov ? k : -1;
    if (!(c.lossG >= 1 || c.mateAgainst)) continue;
    if (lossClaim(a, rl, k, 0, gameCpAfter(it.b), it.b.eb, bl, true)) return k;
    var n = base - matDiff(nd.after.b, pov);
    if (k === last && ended && n >= 1 && n > bl) return k;
  }
  return -1;
}

/* why a wrong try fails (M3, F1.2), as row 2's ladder {cands, fall}, with
   the check step it failed (d, and its chip at tiers 2 and 3) and what its
   reply did (u, took, mate, lost, rs: for F1.3): c is the classifier on the
   try (on the game move again, the card's own), win the solver's win chance
   after it, reply their answer in SAN (replyW: in words, for tier 1). Row 2
   names what See it then plays: their mate ("Then Qxf2 is checkmate."),
   else their capture when it is what the try loses ("Their knight takes
   your queen.", tier 3 "Nxg5 takes your queen."), else the loss after that
   reply (a trade in the board's pieces), else where the game stands (at
   tier 1 "better", never "on top" or "advantage"). Inside a forcing line a
   try that loses nothing says so. The step: when the try loses (material or
   a mate), 1 (their move) if that reply already won before the try
   (dzStood), else 3 (safety check); a harmless try on a your-chances card
   2; else 0. A try that leaves the card's named danger standing says so
   first ("Qxc4, and your queen is still attacked.": step 1). Tier 1 says no
   move in SAN. A form that would name the answer due now (a whole move:
   "Qxc5" does not name "c5"), or needs a reply there is none of, gives way
   to the next; the fallback says where the game stands */
var STEP_CHIP = { 1: 'Their move', 2: 'Your chances', 3: 'Safety check' };
function missWhy(a, c, win, reply, inLine, replyW) {
  var s = sidesOf(a), t1 = inWords(a), cands = [];
  /* where the game stands now, never the vague "That helps Black."
     (content's review) where the score is known */
  var fall = win == null ? 'That helps ' + s.opp + '.' : win >= 60 ? 'You are still better, but less so.' : win >= 40 ? 'Now the game is even.' : 'Now ' + s.opp + (win >= 20 ? ' is better.' : ' is winning.');
  var r1 = c && c.gameLine && c.gameLine.nodes[1], rm = r1 && r1.move ? r1 : null, rs = rm ? capSan(rm.before, rm.move) : '', rp = t1 ? replyW : reply;
  var mate1 = !!(c && c.mateAgainst === 1 && rm && isMate(rm.after));
  /* the material it loses, only as missWhyLoss allows it */
  var lc = c && !c.mateAgainst && c.lossG >= 1 ? missWhyLoss(a, c, win) : null;
  /* See it plays one reply: a loss that takes more than that ply names the
     reply it starts from, so the words and the board agree; a reply that
     takes a piece not won back (replyTakes) is named in words, the count
     after it only below it on the ladder */
  var one = !!lc && lc.k === 1 && !!rm && !!rm.captured, tk = !one && !mate1 && !(c && c.mateAgainst) && replyTakes(a, c, win);
  if (mate1) cands = ['Then ' + (t1 ? replyW : rs) + ' is checkmate.', s.opp + ' could checkmate you.'];
  else if (c && c.mateAgainst) cands = [s.opp + ' could checkmate you.'];
  else if (lc || tk) {
    var ws = !lc ? [] : (lc.ic ? [lc.ic] : lc.wn !== lc.w ? [lc.w, lc.wn] : [lc.w]).filter(function (x) { return !t1 || !/material/.test(x); });
    var plain = ws.map(function (x) { return 'You\'d lose ' + x + '.'; });
    /* tier 3 names the reply in SAN, and where that would hold the answer
       (the guard below) tier 2's words come next (content's review) */
    var tw = ' takes your ' + PIECE_WORD[pType(rm.captured)] + '.';
    var takes = one || tk ? (a.tier >= 3 ? [rs + tw] : []).concat(['Their ' + PIECE_WORD[rm.piece] + tw]) : [];
    cands = takes.concat(!one && rp ? ws.map(function (x) { return 'After ' + rp + ', you\'d lose ' + x + '.'; }) : [], plain);
    if (lc) fall = lc.ic ? 'You\'d lose ' + lc.ic + '.' : t1 ? fall : 'You\'d lose material.';
  } else if (inLine) cands = ['Nothing lost, but there\'s a better move.'];
  else if (win >= 60) cands = [t1 ? 'You are still better, but less so.' : 'Most of your advantage is gone.'];
  else if (rp) cands = ['After ' + rp + ', ' + (win >= 40 ? 'the game is even.' : s.opp + (win >= 20 ? ' is better.' : ' is winning.'))];
  /* the danger the card is about, still standing after the try and the
     reply See it plays (the coach's review, 184455333378:68: Bxc4 Qxc4, and
     the queen is still attacked): said first unless the reply takes as much
     or a mate comes; the step it failed is their move (1) */
  var still = !mate1 && !(c && c.mateAgainst) ? stillAttacked(a, c) : null;
  if (still && !(rm && rm.captured && MOTIF_VAL[pType(rm.captured)] >= MOTIF_VAL[pType(still.p)])) {
    var sw = 'your ' + PIECE_WORD[pType(still.p)] + ' is still attacked.';
    cands = (t1 || !rs ? [] : [rs + ', and ' + sw]).concat([upFirst(sw)]).concat(cands);
  } else still = null;
  /* the guard: no form names the answer due now, as a whole move in SAN
     (Qxc5 is not c5) or in words */
  var dm = dueMove(a), due = capSan(a.st, dm), dueW = moveWords(a.st, dm);
  var names = function (x) { return String(x).split(/[\s.,:;]+/).some(function (t) { return t.replace(/[+#]$/, '') === due; }) || !!(dueW && x.indexOf(dueW) >= 0); };
  var out = { cands: cands.filter(function (x) { return !names(x); }), fall: fall,
              u: rm ? moveUci(rm.move) : '', took: rm && rm.captured && !mate1 ? pType(rm.captured) : '', mate: mate1, lost: (!!lc || tk) && !!(rm && rm.captured), rs: rs, d: 0 };
  if (still) out.d = 1;
  else if (rm && (mate1 || (c && c.mateAgainst) || lc || tk)) out.d = dzStood(a.st, out.u, rm.captured) ? 1 : 3;
  else if ((dangerView(a) || {}).step === 2) out.d = 2;
  out.chip = STEP_CHIP[out.d] || '';
  return out;
}
/* on a their-move card, the piece the better move saves (sv), in danger
   on the card's position, still in danger once the game move is played
   (it did not move it): {p, sq, n (the attackers that may legally take)}
   or null */
function stillAfterGame(a) {
  var v = dangerView(a);
  if (!v || v.step !== 1 || !v.saves.length) return null;
  var nm = v.attacked.filter(function (x) { return pType(x.p) === v.saves[0]; })[0];
  if (!nm || a.played.from === nm.sq) return null;
  var post = cloneState(a.pre), them = !myPov(a.it);
  applyMove(post, a.played);
  if (post.b[nm.sq] !== nm.p || !(dzSee(post.b, nm.sq, them) > 0)) return null;
  return { p: nm.p, sq: nm.sq, n: attackersOf(post.b, nm.sq, them).filter(function (f) { return dzCanTake(post.b, f, nm.sq); }).length };
}
/* the piece the danger facts name on a their-move card (F0.1: the one the
   better move saves, else the most valuable in danger), when a try on the
   card's first move left it where it stood and it is still in danger once
   their reply (c's game line, node 1) is on the board: {p, sq} or null */
function stillAttacked(a, c) {
  var v = dangerView(a), n = c && c.gameLine && c.gameLine.nodes;
  if (!v || v.step !== 1 || (a.sol && a.solIdx > 0) || !n || !n[0] || !n[0].move) return null;
  var pk = dangerPick(v.attacked, v.saves), nm = pk && pk.named;
  if (!nm || n[0].move.from === nm.sq) return null;
  var after = n[1] && n[1].move ? n[1].after : n[0].after;
  return after.b[nm.sq] === nm.p && dzSee(after.b, nm.sq, !myPov(a.it)) > 0 ? { p: nm.p, sq: nm.sq } : null;
}
/* F1.2: the reply See it plays takes a piece of yours (a knight or more)
   that is not won back at once: worth 3 or more net of what the try took
   and of what your next move takes, more than the card's best line loses,
   and with the score after the try down by at least 0.6 of it (a capture
   paid back later in the line costs less than that; the score's pawns run
   smaller than piece values, so a queen lost for nothing is about 6 down,
   184380745302:11's Qh4 5.86). Only the capture is said, never a count, so
   the line after it need not settle (Qg5 Nxg5 Nxg5 Bxg5 d5 exd6+ never
   does) */
function replyTakes(a, c, win) {
  var n = c && c.gameLine && c.gameLine.nodes, r1 = n && n[1], b = a.it.b;
  if (!r1 || !r1.move || !r1.captured || colorW(r1.captured) !== myPov(a.it) || MOTIF_VAL[pType(r1.captured)] < 3) return false;
  var v = function (x) { return x && x.move && x.captured ? MOTIF_VAL[pType(x.captured)] : 0; }, net = v(r1) - v(n[0]) - v(n[2]);
  var after = c === a.cls ? gameCpAfter(b) : win != null ? cpFromWin(win) : null, drop = after != null && b.eb != null ? (b.eb - after) / 100 : null;
  if (net < 3 || (drop != null && after > -900 && drop < 0.6 * net)) return false;
  return net > bestLossFrom(a, a.sol && a.solIdx > 0 ? a.solIdx : 0);
}
/* the loss a wrong move (or the game move again) may claim (lossClaim):
   settled where it is counted, in line with the score after it (win, the
   solver's chance) against the best move's, and more than the card's best
   line loses from the same position */
function missWhyLoss(a, c, win) {
  var b = a.it.b, j = a.sol && a.solIdx > 0 ? a.solIdx : 0;
  var after = c === a.cls ? gameCpAfter(b) : win != null ? cpFromWin(win) : null;
  return lossClaim(a, c.gameLine, c.lossAt, 0, after, b.eb, bestLossFrom(a, j));
}
/* the game move again (M2): its reason from the card's own refutation and
   the score after it; a missed-chance card says only that there is more
   to find, since what the game move allowed is not that card's lesson */
function gameMoveWhy(a) {
  if (familyOf(patternOf(a.it.b)).key === 'chances') return { cands: ['There\'s a stronger move here.'], fall: '', d: 2, chip: STEP_CHIP[2] };
  var r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  return missWhy(a, a.cls, a.it.b.wa, r1 ? sanOf(r1.before, r1.move) : null, false, r1 ? moveWords(r1.before, r1.move) : null);
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
   drawn, what the answer wins when it wins something, else where to look
   (a threat already there, the king, what the game move allowed). The
   danger hint (F1.1, marks.dz) and both tries' danger (F1.3, marks.rep)
   say their own words (dangerWords). Tier 1 says no move in SAN and no
   "material" (a trade or two kinds of piece in the board's pieces). No form
   names the answer due now */
function hintText(a) {
  var marks = hintMarks(a), due = dueMove(a), dueSan = sanOf(a.st, due), cands, fall, row = null;
  var r = { row1: CARD_COPY[a.hints >= 2 ? 'H3' : 'H1'](), marks: marks };
  /* hint 2 on a piece hint 1 rang as in danger: where to take it (content's
     review), when the answer takes it out of danger */
  if (a.hints >= 2) { cands = (safeSquare(a, due) ? [CARD_COPY.H3c()] : []).concat([CARD_COPY.H3b()]); fall = ''; }
  else if (a.sol && a.solIdx > 0) {
    var mine = kingSq(a.st.b, myPov(a.it));
    var inCheck = (a.phase === 'guess' || (a.phase === 'checking' && !a.checkSaid)) && !!a.st.w === myPov(a.it) && mine >= 0 && checkedKingSq(a.st) === mine;
    cands = [inCheck ? 'Your king is in check.' : 'The next move is forcing too.'];
    fall = 'The next move is forcing too.';
  } else {
    var fam = familyOf(patternOf(a.it.b)).key, c = a.cls, line = c.bestLine, mt = c.missed || {}, t1 = inWords(a);
    row = checkRow(a);
    var win = !!line && !line.unsettled && c.matBest >= 1, pw = win ? plainCapture(line, c.bSettle) : null, ic = win ? ledgerIcons(line, c.bSettle, 1, pw) : '';
    /* what the answer gets, in H2's words: a checkmate, or the material
       its line wins (a trade or two kinds of piece in the board's pieces) */
    var gets = c.mateFor ? ['There is a checkmate here.']
      : ic ? ['You can win ' + ic + ' here.'] : win && pw ? ['You can win ' + pw + ' here.', 'You can win ' + oneWord(pw, c.matBest) + ' here.']
      : win && !t1 ? ['You can win ' + oneWord(null, c.matBest) + ' here.'] : null;
    /* a safety or king card with nothing drawn (its danger would touch
       the answer's squares) still points somewhere (fresh-eyes C5): at a
       threat that stood before the game move, at the king, else at what the
       game move allowed */
    /* the game move, in words at tier 1 ("your move" where they do not fit) */
    var gms = t1 ? [moveWords(a.pre, a.played), 'your move'] : [gameSan(a)];
    /* where nothing particular is drawn or won, the card's check line in its
       row-2 form (F2.3: one routine, the same words everywhere) */
    fall = row[0];
    if (marks.rep) cands = repeatedWords(a, marks.rep);
    else if (marks.dz) cands = dangerWords(a, marks.dz);
    else if (fam === 'chances') cands = gets || (mt.fork && mt.fork.ply === 1 && c.matBest >= 2 ? ['One piece can hit two targets.'] : row);
    /* the reply the game move runs into, drawn beside these words */
    else if (marks.danger) cands = gms.map(function (x) { return 'See what ' + x + ' runs into.'; });
    else if (fam === 'conversion' || fam === 'quiet') cands = row;
    else cands = gets || row;
  }
  /* the guard: no form names the answer due now, in SAN or in words */
  var dueW = moveWords(a.st, due);
  var names = function (x) { return String(x || '').split(/[\s.,]+/).indexOf(dueSan) >= 0 || (!!dueW && String(x || '').toLowerCase().indexOf(dueW) >= 0); };
  /* the check line's shorter rung last, for a frame with six words left */
  if (row) row.slice(1).forEach(function (x) { if (cands.indexOf(x) < 0) cands = cands.concat([x]); });
  r.cands = cands.filter(function (x) { return x && !names(x); });
  r.fall = names(fall) ? '' : fall;
  r.row2 = fitRow(r.cands, 'row2', r.fall);
  return r;
}
/* the danger hint in words (F1.1), true on the board shown: "twice"
   counts the attackers that may legally take there; their mate only as the
   search found it; what the game move lets them take, as the board stands
   after it. Every tier alike but their mate (tier 1 says the square) and
   the game move (in words at tier 1, "that move" where they do not fit) */
function dangerWords(a, dz) {
  var P = function (p) { return PIECE_WORD[pType(p)]; }, t1 = inWords(a), gs = t1 ? [upFirst(moveWords(a.pre, a.played)), 'That move'] : [capSan(a.pre, a.played)];
  if (dz.kind === 'check') return ['In check: move, block or take?'];
  if (dz.kind === 'mate') return [t1 ? 'They can mate you on ' + sqName(dz.mate.to) + '.' : 'They threaten mate: ' + dz.mate.san + '.'];
  /* their mate the game move stopped, and what it allows (the coach's
     review): "O-O stops mate, allows Bxc3." (tier 1 "Castling stops mate.
     Watch your knight.") */
  if (dz.kind === 'parried') {
    var rp = dz.reply, what = rp.captured ? PIECE_WORD[rp.captured] : 'king';
    return t1 ? [upFirst(moveWords(a.pre, a.played)) + ' stops mate. Watch your ' + what + '.', 'Watch your ' + what + '.']
      : [capSan(a.pre, a.played) + ' stops mate, allows ' + rp.san.replace(/[+#]$/, '') + '.', 'Watch your ' + what + '.'];
  }
  /* a piece the game line wins later: "Rxf3 lets them win your bishop."
     (tier 1, where the move in words does not fit, "That lets them win
     your bishop.", then "Watch your bishop.") */
  if (dz.kind === 'lost') return gs.slice(0, 1).map(function (g) { return g + ' lets them win your ' + PIECE_WORD[dz.piece] + '.'; }).concat(['That lets them win your ' + PIECE_WORD[dz.piece] + '.', 'Watch your ' + PIECE_WORD[dz.piece] + '.']);
  if (dz.kind === 'mine') return ['You have a mate in one.'];
  /* the hint's bar and row 1 leave row 2 six words: the shorter form then */
  if (dz.kind === 'loose') return ['Their ' + P(dz.loose.p) + ' on ' + sqName(dz.loose.sq) + ' has no guard.', 'Nothing guards their ' + P(dz.loose.p) + ' on ' + sqName(dz.loose.sq) + '.'];
  if (dz.kind === 'madeMate') return gs.map(function (g) { return g + ' lets them mate you.'; });
  /* (a hint's frame leaves row 2 six words: "That lets ..." then) */
  if (dz.kind === 'made') return gs.map(function (g) { return g + ' lets them take your ' + P(dz.named.p) + '.'; }).concat(['That lets them take your ' + P(dz.named.p) + '.', 'Watch your ' + P(dz.named.p) + '.']);
  var nm = dz.named, n = nm.by.length, by = a.pre.b[nm.by[0]], sec = dz.second;
  if (n >= 2) return ['Your ' + P(nm.p) + ' is attacked ' + timesWord(n) + '.'];
  if (MOTIF_VAL[pType(by)] < MOTIF_VAL[pType(nm.p)] || !sec) return ['Their ' + P(by) + ' attacks your ' + P(nm.p) + '.'];
  return [pType(sec.p) === pType(nm.p) ? 'Two of your ' + P(nm.p) + 's are attacked.' : 'Your ' + P(nm.p) + ' and ' + P(sec.p) + ' are attacked.'];
}
/* hint 2's words on a piece hint 1 rang as in danger (the danger facts'
   attacked pieces), on the card's first move, when the answer takes it
   where taking it no longer pays for them: "Find a safe square." */
function safeSquare(a, due) {
  if ((a.sol && a.solIdx > 0) || !due) return false;
  var v = dangerView(a);
  if (!v || !v.attacked.some(function (x) { return x.sq === due.from; })) return false;
  var after = cloneState(a.st);
  applyMove(after, due);
  return !(dzSee(after.b, due.to, !myPov(a.it)) > 0);
}
/* ── One check routine (F2.3) ─────────────────────────────────────────────
   One line per card, by its check step (the danger facts' st; with none,
   by its family) and the player's tier, in place of every habit line:
   Details, the summary's "Keep in mind", the focus card, the family and
   pattern sheets, Insights and the hint fallbacks. The steps' names are the
   chips' (F1.2). Tier 1 sees each check only on its own card, never the
   routine line; at tier 3 a card's line is a computed fact where one is
   true (their threat, the chance missed, the only move or what the better
   move saves) and the plans are master's two lines; places above one card
   (a family, a set) use tier 2's question at tier 3 for the three checks */
var CHECK_LINE = {
  1: ['Their move: what does it attack?', 'Their move: what does it attack?', ''],
  2: ['Your chances: can you take or check?', 'Your chances: checks, captures, threats?', ''],
  3: ['Before you move: what can they take?', 'Before you move: their checks, captures, threats?', ''],
  4: ['Ahead? Trade pieces and stay safe.', 'Ahead? Trade pieces, guard your king, no risks.', 'Ahead? First ask what they want.'],
  5: ['Nothing to take? Improve your worst piece.', 'Nothing happening? Improve your worst piece.', 'Nothing forcing? Ask what they want.']
};
/* row 2's forms (a hint's fallback, 40 characters): the line where it
   fits, then a shorter rung for a frame that leaves six words (a hint's) */
var CHECK_SHORT = { 2: 'Can you take or check?', 3: 'What can they take?' };
var CHECK_ROW = {
  1: ['Their move: what does it attack?', 'Their move: what does it attack?', 'Their move: what does it attack?'],
  2: ['Your chances: can you take or check?', 'Your chances: checks, captures, threats?', 'Your chances: checks, captures, threats?'],
  3: ['Before you move: what can they take?', 'Before you move: what can they take?', 'Before you move: what can they take?'],
  4: ['Ahead? Trade pieces and stay safe.', 'Ahead? Trade pieces and stay safe.', 'Ahead? First ask what they want.'],
  5: ['Improve your worst piece.', 'Improve your worst piece.', 'Nothing forcing? Ask what they want.']
};
var ROUTINE_LINE = 'Every move: their move, your chances, safety check.';
var FAMILY_STEP = { safety: 3, king: 3, chances: 2, conversion: 4, quiet: 5 };
/* a step's line above one card: tier 2's question at tier 3 for the checks */
function lineOfStep(s, t) { var r = CHECK_LINE[s] || CHECK_LINE[5]; return t >= 3 ? r[2] || r[1] : r[t === 1 ? 0 : 1]; }
/* the step of a pattern or a family, for the places above one card */
function patternStep(k) { return DZ_STEP[k] || (PATTERN[k] ? 3 : 5); }
function familyStep(f) { return FAMILY_STEP[f] || 5; }
/* the card's step: its danger facts', else its family's */
function cardStep(a) { var v = dangerView(a); return (v && v.step) || familyStep(familyOf(patternOf(a.it.b)).key); }
function checkRow(a) { var s = cardStep(a), t = a.tier || 2; return [(CHECK_ROW[s] || CHECK_ROW[5])[t - 1]].concat(CHECK_SHORT[s] ? [CHECK_SHORT[s]] : []); }
/* the card's line, read once its answer is in (a.check), so Details and
   the summary always say the same */
function checkLine(a) {
  if (a.check == null) a.check = checkLineOf(a);
  return a.check;
}
function checkLineOf(a) {
  var s = cardStep(a), t = a.tier || 2;
  if (t < 3 || s > 3) return lineOfStep(s, t);
  return checkFact(a, s) || lineOfStep(s, t);
}
/* tier 3's computed line, '' when none is true: their threat, the one the
   game move left standing (standingThreat), "Their threat: Rxf5 takes your
   queen."; the chance missed, "Nxc2 wins the bishop. Ne2 missed it."; the
   only move (F1.4, "Only move" alone), else what the better move saves or
   keeps, "Qe6 saves your queen. Rg1 lost it." */
function checkFact(a, s) {
  var c = a.cls;
  if (s === 1) { var t = standingThreat(a); return t ? threatWords(t, 3) : ''; }
  var cmp = buildCompare(a), bs = cmp.betterSan, g = cmp.gameSan;
  if (s === 2) {
    if (familyOf(patternOf(a.it.b)).key !== 'chances') return '';
    if (c.mateFor) return bs + ' leads to checkmate. ' + g + ' missed it.';
    return cmp.w2 && !/material/.test(cmp.w2) ? bs + ' wins ' + cmp.w2 + '. ' + g + ' missed it.' : '';
  }
  if (cmp.only && /^Only move/.test(cmp.only)) return cmp.only;
  if (a.alt || !cmp.saves.length) return '';
  var ps = cmp.saves.slice(0, 2).map(function (x) { return PIECE_WORD[x]; });
  return bs + ' ' + savesVerb(a) + ' your ' + ps.join(' and ') + '. ' + g + (cmp.found ? ' lost ' : ' could lose ') + (ps.length > 1 ? 'them.' : 'it.');
}
/* their threat that the game move left standing (a threat it stopped is
   no danger: the coach's review), for tier 3's check line and Details
   (F2.5): the threat the danger facts kept, while it stands; else a capture
   of a piece in danger that the game move left where it stood, still
   winning for them (the piece the better move saves first: Rg1 pins the
   pawn on g6, the rook still takes the queen); else the game line's reply
   when it already stood (O-O stops their mate, Bxc3 still wins the
   knight). {st (the position it is played on), m, took, mate} or null */
function standingThreat(a) {
  var v = dangerView(a);
  if (!v) return null;
  var th = v.searched ? v.threat : null, nst = dzNullState(a.pre), c = a.cls;
  if (th && th.stands) { var tm = uciToMove(nst, th.uci); return tm ? { st: nst, m: tm, took: th.took, mate: th.mate } : null; }
  var post = cloneState(a.pre), pk = dangerPick(v.attacked, v.saves);
  applyMove(post, a.played);
  var order = pk ? [pk.named].concat(v.attacked.filter(function (x) { return x !== pk.named; })) : [];
  for (var i = 0; i < order.length; i++) {
    var x = order[i], f = post.b[x.sq] === x.p ? x.by.filter(function (q) { return post.b[q] === a.pre.b[q] && dzCanTake(post.b, q, x.sq) && dzSeeMove(post.b, q, x.sq) > 0; })[0] : null;
    var fm = f != null ? uciToMove(nst, sqName(f) + sqName(x.sq)) : null;
    if (fm) return { st: nst, m: fm, took: x.p, mate: 0 };
  }
  var r1 = c.gameLine && c.gameLine.nodes[1];
  if (r1 && r1.move && r1.captured && dzStood(a.pre, moveUci(r1.move), r1.captured)) return { st: r1.before, m: r1.move, took: r1.captured, mate: 0 };
  return null;
}
/* a threat in words: "Their threat: Rxf5 takes your queen." (tier 1
   "Their threat: their rook takes your queen."), "Their threat: Qxf2 is
   checkmate." (tier 1 "Their threat: checkmate on f2."); one that takes
   nothing "wins material" (tier 1: '') */
function threatWords(t, tier) {
  var san = capSan(t.st, t.m);
  if (t.mate) return 'Their threat: ' + (tier === 1 ? 'checkmate on ' + sqName(t.m.to) : san + (t.mate === 1 ? ' is checkmate' : ', with mate to follow')) + '.';
  if (!t.took) return tier === 1 ? '' : 'Their threat: ' + san + ' wins material.';
  return 'Their threat: ' + (tier === 1 ? 'their ' + PIECE_WORD[pType(t.st.b[t.m.from])] : san) + ' takes your ' + PIECE_WORD[pType(t.took)] + '.';
}
/* "saves" only for a piece that stood in danger on the card's position
   (the coach's review); one the game move put there is "kept" */
function savesVerb(a) {
  var v = dangerView(a), sv = (v && v.saves) || [], at = (v && v.attacked) || [];
  return sv.length && at.some(function (x) { return pType(x.p) === sv[0]; }) ? 'saves' : 'keeps';
}
/* both tries' danger in words (F1.3): their mate, or the piece both
   replies took ("lost" only when both tries' loss claims stood) */
function repeatedWords(a, rep) {
  var sq = sqName(rep.to), p = PIECE_WORD[rep.took];
  /* (beside the hint's bar row 2 has six words: the shorter forms then) */
  if (rep.mate) return inWords(a) ? ['Both tries let them mate on ' + sq + '.', 'Both tries allowed mate on ' + sq + '.'] : ['Both tries allowed ' + rep.san + ' mate.'];
  return !inWords(a) && rep.lost ? ['Both tries lost your ' + p + '.'] : ['Both tries let them take your ' + p + '.', 'Both tries gave away your ' + p + '.'];
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
    /* a step chip (F1.2) goes first when the frame has no room for it: the
       reason is never cut for it */
    if (b.stepChip && wordsIn(b.row2) > room) { b.chip = ''; room = rowRoom(a, b); }
    if (wordsIn(b.row2) > room) b.row2 = fitRow(b.cands, { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
    /* a ladder step that would say something untrue (R4's found form) */
    if (b.never && b.never.indexOf(b.row2) >= 0) b.row2 = fitRow([], { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
  }
  delete b.cands; delete b.fall; delete b.never; delete b.budget; delete b.stepChip;
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
  var betterW = moveWords(a.pre, a.best);
  if (a.alt && a.yours) {
    var alt = buildLine(a.pre, '0000', a.yours.uci, pov);
    if (alt && alt.nodes[(a.yours.at || 0) + 1]) {
      /* the alternative's own gain, from its own move: the line's moves
         before it (found as the card asked) are not its doing */
      line = alt; at = (a.yours.at || 0) + 1;
      settle = Math.max(at, settleIndex(alt));
      gain = matDiff(alt.nodes[settle].after.b, pov) - matDiff(alt.nodes[at].before.b, pov);
      better = sanOf(alt.nodes[at].before, alt.nodes[at].move);
      betterW = moveWords(alt.nodes[at].before, alt.nodes[at].move);
    }
  }
  var bn = line && line.nodes[at], gw = gain >= 1 && line ? plainCapture(line, settle, at) : null;
  /* what the game move lost, only where the claim stands (lossClaim) */
  var lc = c.lossG >= 1 && !c.mateAgainst ? lossClaim(a, c.gameLine, c.lossAt, 0, gameCpAfter(it.b), it.b.eb, bestLossFrom(a, 0)) : null;
  /* what the better move saves (F1.4): the card's own best move only */
  var v = a.alt ? null : dangerView(a);
  a.compare = {
    found: !!(gm[1] && ru[0] && gm[1] === ru[0]), replied: !!gm[1], betterSan: better, gameSan: gameSan(a),
    betterWords: betterW, gameWords: moveWords(a.pre, a.played),
    w: lc ? lc.w : '', wn: lc ? lc.wn : '', k: lc ? lc.k : -1, wi: lc ? lc.ic : '',
    w2: gain >= 1 && line ? gw || oneWord(null, gain) : '', w2n: gain >= 1 ? oneWord(gw, gain) : '', w2i: gain >= 1 && line ? ledgerIcons(line, settle, at, gw) : '',
    guard: guardRule(c.gameLine, a.played, bn) && guardMeans(c, a.pre, a.played, bn),
    saves: v && lc ? v.saves : [],
    /* tier 3's figures, read once, so a second line that lands later never
       changes words on screen */
    only: a.tier >= 3 && !a.alt ? onlyMoveLine(a) : '', figs: a.tier >= 3 && !a.alt ? figuresLine(a) : ''
  };
  return a.compare;
}
/* the scale the card's words use (X3): winning, better, even, their
   better, their winning */
function scaleStep(w) { return w >= 80 ? 4 : w >= 60 ? 3 : w >= 40 ? 2 : w >= 20 ? 1 : 0; }
/* F1.4 at tier 3, from the card's own two-line search: "Only move: Qe6 49%.
   Next best 18%." when the next best move is 10 or more points worse, a
   step lower on that scale and at 25% or less; "Best: Qe6 48%. Next best
   37%." when it is not that low; '' otherwise, or with no second line kept */
function onlyMoveLine(a) {
  var b = a.it.b;
  if (b.g2 == null || b.wb == null || !(b.g2 >= 10) || scaleStep(b.wb - b.g2) >= scaleStep(b.wb)) return '';
  /* "Only move" only where the next best leaves 25% or less: at 37% the
     game is still playable (the coach's review) */
  var nb = Math.round(b.wb - b.g2);
  return (nb <= 25 ? 'Only move: ' : 'Best: ') + capSan(a.pre, a.best) + ' ' + Math.round(b.wb) + '%. Next best ' + nb + '%.';
}
/* the better move's winning chances and the game move's: "Qe6 49%. Your
   Rg1 6%." */
function figuresLine(a) {
  var b = a.it.b;
  return b.wb == null || b.wa == null ? '' : capSan(a.pre, a.best) + ' ' + Math.round(b.wb) + '%. Your ' + capSan(a.pre, a.played) + ' ' + Math.round(b.wa) + '%.';
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
/* the guard rule: the square the game move went to is not
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
  var s = r4Forms(a, inWords(a)), sv = savesForms(a);
  return sv ? { cands: sv.concat(s.cands), fall: s.fall, never: s.never } : s;
}
/* F1.4, in front of R4's own forms, on the card's best move found or shown
   (a move that works too keeps R4's): what the better move saves (the
   danger facts' sv: what the game line lost and the best line keeps),
   "Queen to e6 saves your queen." at tier 1, "Qe6 saves your queen. Rg1
   lost it." at tiers 2 and 3 ("could lose it" when they did not play into
   it; never a piece the best line loses too; "keeps" for a piece that was
   not in danger before the game move); before them, where the card had two
   threats, what the better move guards ("Qf3 guards f2 and your knight.");
   else a trade the game move lost, in the board's pieces ("Rg1 lost ♕♗ for
   ♜."). Tier 3 leads a saved
   piece with the only-move line where it is true, and with nothing saved
   and no trade says the figures (the only-move line, else "Qe6 49%. Your
   Rg1 6%."). A missed chance is about what the better move wins: none */
function savesForms(a) {
  if (a.alt || familyOf(patternOf(a.it.b)).key === 'chances') return null;
  var cmp = buildCompare(a), t1 = inWords(a), t3 = a.tier >= 3, out = [];
  var g = t1 ? upFirst(cmp.gameWords) : cmp.gameSan, bs = t1 ? upFirst(cmp.betterWords) : cmp.betterSan, lost = cmp.found ? ' lost ' : ' could lose ';
  var gd = guardsForm(a);
  if (gd) out = gd;
  else if (cmp.saves.length) {
    var ps = cmp.saves.slice(0, 2).map(function (t) { return PIECE_WORD[t]; }), what = 'your ' + ps.join(' and '), vb = ' ' + savesVerb(a) + ' ';
    if (t3 && cmp.only) out.push(cmp.only);
    if (!t1) out.push(bs + vb + what + '.' + ' ' + g + lost + (ps.length > 1 ? 'them.' : 'it.'));
    out.push(bs + vb + what + '.');
  } else if (cmp.wi) out.push(g + lost + cmp.wi + '.');
  else if (t3) out = [cmp.only, cmp.figs].filter(Boolean);
  return out.length ? out : null;
}
/* two threats on the card's position, their mate (which the game move
   stopped) and the game line's reply (which already stood): {mate (the
   search's move), reply (the game line's first node)} or null (the coach's
   review, 184268949378:16: Qxf2 mate and Bxc3) */
function twoThreats(a) {
  var v = dangerView(a), th = v && v.searched ? v.threat : null, r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  if (!th || th.mate !== 1 || th.stands || !r1 || !r1.move || !r1.captured || moveUci(r1.move) === th.uci) return null;
  if (!dzStood(a.pre, moveUci(r1.move), r1.captured)) return null;
  var nst = dzNullState(a.pre);
  return { mate: uciToMove(nst, th.uci), reply: r1, nst: nst };
}
/* the better move guards both: "Qf3 guards f2 and your knight." (tier 1 in
   words), only when the piece it moves attacks the mating square and the
   piece the reply would take once it is played */
function guardsForm(a) {
  if (a.alt) return null;
  var tt = twoThreats(a);
  if (!tt || !tt.mate) return null;
  var after = cloneState(a.pre);
  applyMove(after, a.best);
  var hits = attacksFrom(after.b, a.best.to), cap = tt.reply.move.ep >= 0 ? tt.reply.move.ep : tt.reply.move.to;
  if (hits.indexOf(tt.mate.to) < 0 || hits.indexOf(cap) < 0 || after.b[cap] !== a.pre.b[cap]) return null;
  var tail = ' guards ' + sqName(tt.mate.to) + ' and your ' + PIECE_WORD[pType(tt.reply.captured)] + '.';
  return inWords(a) ? [upFirst(moveWords(a.pre, a.best)) + tail] : [capSan(a.pre, a.best) + tail];
}
/* R4's forms with the moves in SAN, or in words (mw: tier 1, where no form
   holds SAN or "material": a trade or two kinds of piece in the board's
   pieces, and "your game move" where the move in words does not fit, never
   "that move", which the move just played would answer to). No tier says
   "on top" (content's review): "better", or "winning" under 20% */
function r4Forms(a, mw) {
  var c = a.cls, cmp = buildCompare(a), fam = familyOf(patternOf(a.it.b)).key;
  var g = mw ? upFirst(cmp.gameWords) : cmp.gameSan, bs = mw ? upFirst(cmp.betterWords) : cmp.betterSan;
  var w = a.it.b.wa, opp = sidesOf(a).opp, cands = [];
  /* where the game move left it, said of your game (content's review:
     "After Nc5, ..." read as the move just played): "Knight to c5 left
     White better." (tier 1), "In your game, Nc5 left White better." */
  var state = w >= 60 ? 'you still better' : w >= 40 ? 'the game even' : opp + (w >= 20 ? ' better' : ' winning');
  var past = mw ? g + ' left ' + state + '.' : 'In your game, ' + g + ' left ' + state + '.', past2 = mw ? 'Your game move left ' + state + '.' : g + ' left ' + state + '.';
  /* a form with its material phrase, then the same with the one word (at
     tier 1 never "material"), the board's pieces for a trade */
  var both = function (f, x, xn, xi) { if (xi) return [f(xi)]; if (mw && /material/.test(xn || '')) xn = ''; return x === xn || !xn ? (mw && /material/.test(x) ? [] : [f(x)]) : [f(x), f(xn)]; };
  /* the found form ("lost", a checkmate allowed and played) only when the
     opponent did find it: a ladder step that would cut a not-found form
     down to it (never) takes the fallback instead */
  var never = [];
  if ((fam === 'king' || fam === 'safety') && c.mateAgainst) {
    cands = [g + ' allowed checkmate.' + (cmp.found ? '' : ' They missed it.')];
    if (!cmp.found) never.push(g + ' allowed checkmate.');
  }
  else if ((fam === 'safety' || fam === 'king') && cmp.w) {
    var mistake = function (x) { return g + (cmp.found ? ' lost ' : ' could lose ') + x + '.'; };
    var better = cmp.guard ? bs + ' is guarded. ' : null;
    if (better) cands = both(function (x) { return better + mistake(x); }, cmp.w, cmp.wn, cmp.wi);
    else if (cmp.w2) {
      var wins = function (x, y) { return bs + ' wins ' + x + '. ' + mistake(y); };
      cands = cmp.w2i || cmp.wi ? [wins(cmp.w2i || cmp.w2, cmp.wi || cmp.w)] : mw ? [wins(cmp.w2, cmp.w)].filter(function (x) { return !/material/.test(x); }) : [wins(cmp.w2, cmp.w), wins(cmp.w2n, cmp.wn)];
    }
    /* the mistake alone before the better half alone (the first sentence):
       the game move is what the card is about */
    cands = cands.concat(both(mistake, cmp.w, cmp.wn, cmp.wi));
  } else if (fam === 'chances') {
    if (c.mateFor) cands = [bs + ' leads to checkmate.'];
    else if (cmp.w2) {
      var won = function (x) { return bs + ' wins ' + x + '. ' + g + ' missed it.'; };
      /* a trade said as "material" tells less than its own first sentence;
         in the board's pieces it is whole */
      cands = cmp.w2i ? [won(cmp.w2i), bs + ' wins ' + cmp.w2i + '.'] : / for /.test(cmp.w2) ? [won(cmp.w2), bs + ' wins ' + cmp.w2 + '.', won(cmp.w2n)] : both(won, cmp.w2, cmp.w2n);
    }
  } else if (fam === 'conversion') {
    cands = [c.stalemate ? g + ' allowed a draw.' : c.perpetualAgainst ? g + ' allowed endless checks.' : past, past2];
  } else cands = [past, past2];
  /* a plan card whose game move lost material says so first (content's
     review: "left you better" read as praise); on a move that works too
     tier 1 says "Your game move", never the move just played */
  if ((fam === 'conversion' || fam === 'quiet') && cmp.w && !c.stalemate && !c.perpetualAgainst) {
    var gl = mw && a.alt ? 'Your game move' : g, lose = function (x) { return gl + (cmp.found ? ' lost ' : ' could lose ') + x + '.'; };
    cands = both(lose, cmp.w, cmp.wn, cmp.wi).concat(mw && a.alt ? [] : both(function (x) { return 'Your game move' + (cmp.found ? ' lost ' : ' could lose ') + x + '.'; }, cmp.w, cmp.wn, cmp.wi)).concat(cands);
  }
  return { cands: cands.filter(Boolean), fall: mw ? [g + ' was a mistake.', 'Your game move was a mistake.'] : g + ' was a mistake.', never: never };
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
  /* the game segment is your game (fresh-eyes T4): the engine's line only
   while the game really went that way. Where the game left it, the segment
   ends on the last move really played; when that is their first reply and
   it missed a blow, one step more shows the move they could have played
   ("could take ... They missed it."), and nothing after it */
  var real = realGame(a, Math.max(gEnd, 8) + 3), could = false, realSeg = false, threat = storyThreat(c, gl);
  for (var k = 1; k <= gEnd; k++) {
    if (real[k] === moveUci(gl.nodes[k].move)) continue;
    /* they went their own way and the game still lost (final fixes 1): its
       own moves to where its own loss stands, no later than the engine's
       line has it. Only where they left the line (where you did, what
       follows is your own choice, told as now) */
    var rl = k % 2 ? buildLine(a.pre, a.playedUci, real.slice(1), !pov) : null, lk = rl ? realLossAt(a, rl) : -1;
    if (lk >= 1 && lk <= gEnd) { gl = rl; gEnd = lk; realSeg = true; break; }
    var cmp0 = buildCompare(a);
    could = k === 1 && !cmp0.found && cmp0.replied && (!!c.mateAgainst || c.lossG >= 1);
    gEnd = could ? 1 : k - 1;
    break;
  }
  /* the danger frame first (F1.5): the card's own position, still */
  var df = dangerFrame(a);
  if (df) steps.push({ seg: 'danger', line: gl, k: 0, from: 0, df: df });
  for (k = 0; k <= gEnd; k++) steps.push({ seg: 'game', line: gl, k: k, from: 0 });
  var bl = c.bestLine || buildLine(a.pre, '0000', a.lines.best.uci, pov), from = 1, bEnd = Math.max(1, c.bSettle || 0), alt = null;
  if (a.alt && a.yours) {
    var al = buildLine(a.pre, '0000', a.yours.uci, pov), at = (a.yours.at || 0) + 1;
    if (al && al.nodes[at]) { alt = al; bl = al; from = at; bEnd = Math.max(at, settleIndex(al)); }
  } else if (c.mateFor) {
    var ml = buildLine(a.pre, '0000', a.lines.best.uci, pov), mk = ml ? mateAt(ml) : -1;
    if (mk >= 1) { bl = ml; bEnd = mk; }
  }
  bEnd = Math.max(from, Math.min(bEnd, bl.nodes.length - 1));
  /* S-same's step (the game's blow again, a move later) says itself that
     it still comes: it may end the line */
  var g1 = c.gameLine && c.gameLine.nodes[1], b2 = bl.nodes[2];
  var same = !alt && bl === c.bestLine && bEnd === 2 && !!g1 && !!b2 && sameMove([b2.move.from, b2.move.to], [g1.move.from, g1.move.to]);
  var whole = same || (!alt && !!c.mateFor && isMate(bl.nodes[bEnd].after));
  bEnd = betterEnd(bl, from, bEnd, pov, whole);
  /* nor on a bare move of theirs: a quiet move or a check of
     theirs where the line has nothing true to claim goes, back to your move
     before it (never before the better move itself) */
  while (!whole && bEnd > from && bl.nodes[bEnd].byWhite !== pov && !bl.nodes[bEnd].captured && !isMate(bl.nodes[bEnd].after) && !betterClaim(a, bl, bEnd, from)) bEnd--;
  for (k = from; k <= bEnd; k++) steps.push({ seg: 'better', line: bl, k: k, from: from });
  var S = a.story = { steps: steps, g: gEnd + 1 + (df ? 1 : 0), could: could, real: realSeg, threat: threat, guard: null, alt: !!alt,
                      mateG: isMate(gl.nodes[gEnd].after), mateB: isMate(bl.nodes[bEnd].after), danger: !!df };
  /* the guard dots and words of B1: the better move's own square guarded
     once it is played, the game move's not (the guard rule, read as R4 reads
     it), by a piece of yours that guards it directly */
  var bn = bl.nodes[from];
  if (!S.alt && from === 1 && buildCompare(a).guard) {
    var mine = colorW(bn.after.b[bn.move.to]), by = attackersOf(bn.after.b, bn.move.to, mine).sort(function (x, y) { return MOTIF_VAL[pType(bn.after.b[x])] - MOTIF_VAL[pType(bn.after.b[y])]; })[0];
    if (by != null) S.guard = { from: by, to: bn.move.to, piece: pType(bn.after.b[by]) };
  }
  steps.forEach(function (s, i) { s.cap = s.df ? s.df.cap : storyCaption(a, S, i); });
  return S;
}
/* F1.5, See why's first frame: the card's own position, still, with what
   was attacked before anything moves: at most three dashed red arrows and
   two rings, their last move tinted, one caption. On a their-move card
   their mate (the search's mate in one) or the player's attacked pieces
   (dangerPick); on a safety card those pieces when the one named is a
   piece the game line lost; on a your-chances card their loose piece (the
   prize the best line wins, unguarded). The caption names their last move
   when it made the named piece's attack (the attacker moved there, or its
   line crosses the square that move left): "After fxg6: queen attacked
   twice, bishop once." (tier 1 "Their last move attacks your queen
   twice."); else "Your queen is attacked twice, your bishop once.", "They
   threaten mate: Qxf2." or "Their knight on c6 has no guard." (tier 1 in
   words). First, where their mate was stopped by the game move and its
   punishment already stood, both ("Two threats: Qxf2 mate and Bxc3+."); a
   game move that unblocked their mate, the piece that blocked it ringed
   in gold ("Your bishop on g4 blocks their mate."). {rings, arrows, cap}; null
   with no such danger: no frame */
function dangerFrame(a) {
  var v = dangerView(a), t1 = inWords(a), P = function (p) { return PIECE_WORD[pType(p)]; };
  if (!v) return null;
  /* two threats, their mate (which the game move stopped) and the reply
     that punished it (the coach's review): "Two threats: Qxf2 mate and
     Bxc3+." (tier 1 "Two threats: mate on f2 and your knight.") */
  var tt = twoThreats(a);
  if (tt && tt.mate) {
    var rm = tt.reply.move, rs = sanOf(tt.nst, uciToMove(tt.nst, moveUci(rm))), cs = rm.ep >= 0 ? rm.ep : rm.to;
    return { rings: [{ sq: tt.mate.to, kind: 'attacked', mate: true }, { sq: cs, kind: 'attacked' }],
             arrows: [{ from: tt.mate.from, to: tt.mate.to, kind: 'threat', key: 'danger' }, { from: rm.from, to: rm.to, kind: 'threat', key: 'danger' }],
             cap: t1 ? 'Two threats: mate on ' + sqName(tt.mate.to) + ' and your ' + PIECE_WORD[pType(tt.reply.captured)] + '.'
               : 'Two threats: ' + capSan(tt.nst, tt.mate) + ' mate and ' + rs + '.' };
  }
  if (v.step === 1 && v.searched && v.threat && v.threat.mate === 1) {
    var th = v.threat, nst = dzNullState(a.pre);
    return { rings: [{ sq: th.to, kind: 'attacked', mate: true }], arrows: [{ from: th.from, to: th.to, kind: 'threat', key: 'danger' }],
             cap: t1 ? 'They can mate you on ' + sqName(th.to) + '.' : 'They threaten mate: ' + capSan(nst, uciToMove(nst, th.uci)) + '.' };
  }
  /* the game move unblocked their mate: what it stood in the way of, the
     board alone (the coach's review, 184435538450:67: "Your bishop on g4
     blocks their mate.") */
  var bk = mateBlocker(a);
  if (bk) return { rings: [{ sq: bk.sq, kind: 'block' }], arrows: [], cap: 'Your ' + P(bk.p) + ' on ' + sqName(bk.sq) + ' blocks their mate.' };
  var pk = v.step === 1 || v.step === 3 ? dangerPick(v.attacked, v.saves) : null;
  if (pk && (v.step === 1 || v.saves.indexOf(pType(pk.named.p)) >= 0)) {
    var nm = pk.named, sec = pk.second, n1 = nm.by.length, n2 = sec ? sec.by.length : 0, last = a.preLast, cands = [];
    var made = !!last && nm.by.some(function (f) { return f === last[1] || strictlyBetween(f, nm.sq, last[0]); });
    if (made) {
      var lastSan = (a.it.g.mv.split(' ')[a.it.b.p - 1] || '').replace(/[+#]$/, '');
      if (t1) cands.push('Their last move attacks your ' + P(nm.p) + (n1 >= 2 ? ' ' + timesWord(n1) : '') + '.');
      else if (lastSan && (n1 >= 2 || sec)) cands.push('After ' + lastSan + ': ' + P(nm.p) + ' attacked ' + timesWord(n1) + (sec ? ', ' + P(sec.p) + ' ' + timesWord(n2) : '') + '.');
      else if (lastSan) cands.push('After ' + lastSan + ': their ' + P(a.pre.b[nm.by[0]]) + ' attacks your ' + P(nm.p) + '.');
    }
    if (sec && n1 === 1 && n2 === 1) cands.push(pType(sec.p) === pType(nm.p) ? 'Two of your ' + P(nm.p) + 's are attacked.' : 'Your ' + P(nm.p) + ' and ' + P(sec.p) + ' are attacked.');
    else if (sec) cands.push('Your ' + P(nm.p) + ' is attacked ' + timesWord(n1) + ', your ' + P(sec.p) + ' ' + timesWord(n2) + '.');
    cands.push(n1 >= 2 ? 'Your ' + P(nm.p) + ' is attacked ' + timesWord(n1) + '.' : 'Their ' + P(a.pre.b[nm.by[0]]) + ' attacks your ' + P(nm.p) + '.');
    return { rings: pk.rings, arrows: pk.arrows.map(function (x) { return { from: x.from, to: x.to, kind: 'threat', key: 'danger' }; }), cap: fitRow(cands, 'caption', '') };
  }
  var pz = v.step === 2 ? hintPrize(a) : null;
  if (pz && isHangingAt(a.pre.b, pz.sq)) return { rings: [{ sq: pz.sq, kind: 'target' }], arrows: [], cap: 'Their ' + P(pz.p) + ' on ' + sqName(pz.sq) + ' has no guard.' };
  return null;
}
/* the game move's piece stood in the way of their mate: the game line's
   first reply mates after the game move, and on the card's position (their
   move) it would mate with that piece gone, not with it there. {p, sq} or
   null */
function mateBlocker(a) {
  var c = a.cls, r1 = c.gameLine && c.gameLine.nodes[1];
  if (!c.mateAgainst || !r1 || !r1.move || !isMate(r1.after)) return null;
  var u = moveUci(r1.move), nst = dzNullState(a.pre), m = uciToMove(nst, u);
  if (m) { var x = cloneState(nst); applyMove(x, m); if (isMate(x)) return null; }
  var gone = cloneState(nst), from = a.played.from;
  gone.b = gone.b.slice();
  gone.b[from] = null;
  var m2 = uciToMove(gone, u);
  if (!m2) return null;
  applyMove(gone, m2);
  return isMate(gone) ? { p: a.pre.b[from], sq: from } : null;
}
/* square q lies on the straight line strictly between squares f and t */
function strictlyBetween(f, t, q) {
  var df = (t % 8) - (f % 8), dr = (t >> 3) - (f >> 3), n = Math.max(Math.abs(df), Math.abs(dr));
  if (q == null || !n || (df && dr && Math.abs(df) !== Math.abs(dr))) return false;
  for (var i = 1; i < n; i++) if ((f % 8) + df / n * i === q % 8 && (f >> 3) + dr / n * i === q >> 3) return true;
  return false;
}
/* a better (or your own) line never ends on their capture (fresh-eyes
   T12): it reads as the line dropping that piece. It runs on to your
   recapture when that is the line's next ply, else stops before their
   capture (never before its first step); keep: a line that mates, or one
   whose last step is S-same's (its words say the blow still comes), is
   left whole */
function betterEnd(line, from, end, pov, keep) {
  if (keep) return end;
  for (var g = 0; g < 4 && end > from; g++) {
    var n = line.nodes[end];
    if (!n.captured || colorW(n.captured) !== pov) break;
    var nx = line.nodes[end + 1];
    end = nx && nx.captured && colorW(nx.captured) !== pov ? end + 1 : end - 1;
  }
  return end;
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
  return { from: n1.move.from, to: n1.move.to, motif: motif, th: th, san: sanOf(n1.before, n1.move), words: moveWords(n1.before, n1.move) };
}
/* a move as a caption names it: its SAN without the check or mate sign,
   on every rung, so one move reads the same in all of them (the board's
   check glow shows a check; the words say it only in the check and mate
   forms) */
function capSan(st, m) { return sanOf(st, m).replace(/[+#]$/, ''); }
/* a ply in plain words (S-ply): a capture names what it took, and whose; a
   check or a mate says so. w: the move in words (tier 1), where a capture
   is said by its piece ("Their pawn takes your bishop.", w 2: "Pawn takes
   your bishop.") */
function plySay(a, n, bare, w) {
  var san = w ? moveWords(n.before, n.move) : capSan(n.before, n.move), byMe = n.byWhite === myPov(a.it), whose = byMe ? 'You play ' : 'They play ';
  if (isMate(n.after)) return (w ? whose : '') + san + '. Checkmate.';
  /* a capture that gives check says both (fresh-eyes T7); bare: the
     capture alone, the next rung when that does not fit */
  if (n.captured) return (w ? pieceSay(a, n, w === 2) : san) + ' takes ' + (byMe ? 'their ' : 'your ') + PIECE_WORD[pType(n.captured)] + (!bare && checkersOf(n.after).length ? ' with check.' : '.');
  /* a quiet check says whose it is too, "Rg5, check." the rung
     below it */
  if (checkersOf(n.after).length) return (bare ? upFirst(san) : whose + san) + ', check.';
  /* a quiet move says whose it is (C3): "They play Qh3." / "You play Qe6." */
  return whose + san + '.';
}
/* the piece that makes a ply, and whose, in words: "Their rook"; bare,
   the piece alone ("Rook takes your queen.": whose is in the words after
   it), the shorter rung */
function pieceSay(a, n, bare) {
  var p = PIECE_WORD[pType(n.before.b[n.move.from])];
  return bare ? upFirst(p) : (n.byWhite === myPov(a.it) ? 'Your ' : 'Their ') + p;
}
/* what changed hands from node `from` to node k, as the caption names it:
   the line's own captures, else (only when the count really moved) the
   words that claim no piece; one word for the ladder's second step */
function storyGain(line, k, from, net) {
  if (net < 1) return null;
  var x = plainCapture(line, k, from), ic = ledgerIcons(line, k, from, x);
  /* a trade, or two kinds of piece, in the board's pieces */
  return ic ? { w: ic, wn: ic } : { w: x || oneWord(null, net), wn: oneWord(x, net) };
}
/* where a single piece won along a line was taken ("It wins the pawn
   on a3."): w is the line's own words for its gain from node `from`
   to node k; the square only when w is one piece ("the pawn") that you
   took exactly once there and lost none of, so the square is the only one
   it can be. '' otherwise */
function wonSquare(line, from, k, w) {
  var m = /^the (\w+)$/.exec(w || ''), at = [], gave = 0;
  if (!m || !line) return '';
  for (var i = from; i <= k && i < line.nodes.length; i++) {
    var n = line.nodes[i];
    if (!n.captured || PIECE_WORD[pType(n.captured)] !== m[1]) continue;
    if (n.pov) at.push(n.move.ep >= 0 ? n.move.ep : n.move.to); else gave++;
  }
  return at.length === 1 && !gave ? sqName(at[0]) : '';
}
/* a capture that already says it: the step took that one piece */
function namesIt(n, w) {
  return !!(n.captured && w && (w === 'the ' + PIECE_WORD[pType(n.captured)] || w === 'a ' + PIECE_WORD[pType(n.captured)]));
}
/* the caption of step i (S-G1, S-opp, S-ply, S-B1, S-same), fitted to the
   caption's 60 characters and 8 words. Each says what the ply shown does,
   true on its board; the last step of a segment adds what it lost or won.
   At tier 1 each form in words first, then in SAN (interleave) */
function storyCaption(a, S, i) {
  var s = capForms(a, S, i, 0);
  if (!inWords(a)) return fitRow(s.cands, 'caption', s.fall);
  /* tier 1 says no move in SAN and no "material" (F1.6) */
  var w = capForms(a, S, i, 1), w2 = capForms(a, S, i, 2), plain = function (x) { return !/\bmaterial\b/.test(x); };
  return fitRow(interleave(w.cands, w2.cands).filter(plain), 'caption', [w.fall, w2.fall].filter(plain));
}
/* step i's forms {cands, fall}, its moves in SAN (w 0) or in words (w 1,
   or 2 with a capture's piece alone); who: a capture's maker, its SAN or
   its piece in words; Mv: the ply as a sentence starts with it */
function capForms(a, S, i, w) {
  var c = a.cls, s = S.steps[i], n = s.line.nodes[s.k], sd = sidesOf(a), pov = myPov(a.it), cands = [], fall = '';
  var lastG = s.seg === 'game' && i === S.g - 1, lastB = s.seg === 'better' && i === S.steps.length - 1;
  var san = n.move ? (w ? moveWords(n.before, n.move) : capSan(n.before, n.move)) : '', Mv = w ? upFirst(san) : san;
  var who = n.move ? (w ? pieceSay(a, n, w === 2) : san) : '';
  if (s.seg === 'game' && s.k === 0) {
    var g = w ? upFirst(moveWords(a.pre, a.played)) : capSan(a.pre, a.played), t = S.threat, n1 = s.line.nodes[1];
    var tm = t ? (w ? t.words : t.san.replace(/[+#]$/, '')) : '';
    fall = g + ', your game move.';
    /* the piece the better move saves, left in danger by the game move (the
       reviews: Rg1 leaves the queen attacked; the bishop it loses, Qe6
       loses too) */
    var sa = c.stalemate || (c.mateAgainst && S.mateG) ? null : stillAfterGame(a);
    if (sa) cands.push(g + '. Your ' + PIECE_WORD[pType(sa.p)] + ' is still attacked' + (sa.n >= 2 ? ' ' + timesWord(sa.n) : '') + '.');
    if (c.stalemate) cands.push(g + '. ' + sd.opp + ' has no move: a draw.');
    else if (c.mateAgainst && S.mateG) cands.push(g + '. Now ' + sd.opp + ' can checkmate.');
    else if (t) {
      var th = t.th;
      if (th && th.captured) {
        var cap = PIECE_WORD[th.captured];
        if (!isDefended(n1.before.b, th.to)) cands.push(g + '. Nothing guards the ' + cap + ' on ' + sqName(th.to) + '.');
        else if (MOTIF_VAL[th.piece] < MOTIF_VAL[th.captured]) cands.push(g + '. Their ' + PIECE_WORD[th.piece] + ' can take your ' + cap + '.');
      }
      if (!cands.length && t.motif === 'fork') cands.push(g + '. Now ' + tm + ' hits two pieces.');
      if (!cands.length && th && th.check) cands.push(g + '. Now ' + tm + ' is check.');
      /* a pin only when it already holds on G1's board */
      if (!cands.length && t.motif === 'pin' && pinRay(n1.before.b, c.allowed.pin.sq)) cands.push(g + '. Your ' + PIECE_WORD[c.allowed.pin.piece] + ' can\'t move safely.');
      if (!cands.length && t.motif === 'discovered') cands.push(g + '. Moving one piece opens a line.');
    }
    return { cands: cands, fall: fall };
  }
  fall = Mv + '.';
  var say = plySay(a, n, false, w), say0 = plySay(a, n, true, w), says = say0 !== say ? [say, say0] : [say];
  if (s.seg === 'game') {
    /* their first reply: whether they found it in the game (S-opp). "They
       missed it." only when there was a blow to miss (a mate, or material
       the line wins) and they replied with something else; a reply that
       blows nothing is just its ply. That missed step is the move they
       could have played, the segment's last (S.could) */
    var cmp0 = buildCompare(a), found = s.k === 1 && cmp0.found;
    /* on the game's own moves past where it left the engine's line (S.real)
       their reply is the move played: nothing to have missed there */
    var missed = s.k === 1 && !found && !S.real && cmp0.replied && (!!c.mateAgainst || c.lossG >= 1);
    var heads = says, ck = checkersOf(n.after).length ? ' with check' : '';
    /* a check is on the board, "as in your game" is context: the check is
       kept first when both do not fit (final fixes 4) */
    if (found && n.captured && !isMate(n.after)) {
      var pw = PIECE_WORD[pType(n.captured)];
      heads = (ck ? [who + ' takes your ' + pw + ck + ', as in your game.', say] : []).concat([who + ' takes your ' + pw + ', as in your game.']).concat(says);
    } else if (found) heads = [say + ' As in your game.', say, say0 + ' As in your game.'].concat(says);
    else if (missed) {
      /* the move they could have played, said as one (never "takes"): with
         its check first, then "They missed it." */
      var cp = n.captured ? who + ' could take your ' + PIECE_WORD[pType(n.captured)] : null;
      var cw = isMate(n.after) ? [Mv + ' would be checkmate'] : cp ? (ck ? [cp + ck, cp] : [cp]) : ck ? [who + ' could give check'] : ['They could play ' + san];
      heads = [];
      cw.forEach(function (x) { heads.push(x + '. They missed it.', x + '.'); });
      fall = cw[cw.length - 1] + '.';
    }
    heads = heads.filter(function (h, j) { return heads.indexOf(h) === j; });
    /* the net loss on the last step, only where it stands on this board
       (lossClaim, with nothing past this ply counted), never on a move they
       only could have played */
    var lc = lastG && !S.mateG && !isMate(n.after) && !(S.could && s.k === 1) && c.lossG >= 1
      ? lossClaim(a, s.line, s.k, 0, gameCpAfter(a.it.b), a.it.b.eb, bestLossFrom(a, 0), true) : null;
    /* a trade, or two kinds of piece, in the board's pieces */
    var loss = lc ? { w: lc.ic || lc.w, wn: lc.ic || lc.wn } : null;
    if (loss && !namesIt(n, loss.w)) {
      /* the net loss before the step's longer words: last, the move alone
         (its token shows what it took) */
      heads.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' You lose ' + loss.w + '.'); });
      heads.concat([Mv + '.']).forEach(function (h) { if (loss.wn !== loss.w) cands.push(h + ' You lose ' + loss.wn + '.'); });
    }
    return { cands: cands.concat(heads), fall: fall };
  }
  var cmp = buildCompare(a), gain = matDiff(n.after.b, pov) - matDiff(s.line.nodes[s.from].before.b, pov);
  /* the story's end says what the better move saves (F1.4): at tier 3 the
     only-move line first where it is true; on B1 itself "Better: Qe6 saves
     your queen." (tier 1 "Better: queen to e6. Your queen is safe there.",
     "there" only when the better move moves that piece), later "Your queen
     is safe." after the ply. Never on your own move's line */
  var keep = lastB && !S.alt && !c.mateFor && cmp.saves.length ? PIECE_WORD[cmp.saves[0]] : '';
  if (lastB && !S.alt && cmp.only) cands.push(cmp.only);
  if (s.k === s.from) {
    var bs = san;
    fall = 'Better: ' + bs + '.';
    if (keep) cands.push(w ? fall + ' Your ' + keep + ' is safe' + (pType(n.before.b[n.move.from]) === cmp.saves[0] ? ' there.' : '.') : 'Better: ' + bs + ' ' + savesVerb(a) + ' your ' + keep + '.');
    if (S.alt) cands.push('Your ' + bs + ' works too.');
    else if (c.mateFor && S.mateB) cands.push(fall + ' It leads to checkmate.');
    else if (S.guard) cands.push(fall + ' The ' + PIECE_WORD[S.guard.piece] + ' on ' + sqName(S.guard.from) + ' guards it.');
    else if (cmp.w2) {
      /* one piece won names where it stands ("It wins the pawn on a3."); a
         trade or two kinds of piece in the board's pieces */
      var wsq = !a.alt && s.line === c.bestLine ? wonSquare(s.line, 1, c.bSettle, cmp.w2) : '';
      if (wsq) cands.push(fall + ' It wins ' + cmp.w2 + ' on ' + wsq + '.');
      cands.push(fall + ' It wins ' + (cmp.w2i || cmp.w2) + '.');
      if (!cmp.w2i && cmp.w2n !== cmp.w2) cands.push(fall + ' It wins ' + cmp.w2n + '.');
    }
    return { cands: cands, fall: fall };
  }
  /* the same blow as in the game, a move later (S-same, 3.7): what the
     better line nets where it settles (cls.matBest at bSettle) against what
     the game lost, in the copy row's forms when one is true; a line that
     loses as much says the capture again, which is all that is true */
  var g1 = c.gameLine.nodes[1];
  if (!S.alt && !S.mateB && s.k === 2 && c.bestLine && s.line === c.bestLine && g1 && sameMove([n.move.from, n.move.to], [g1.move.from, g1.move.to])) {
    var net = c.matBest, lost = c.lossG;
    fall = Mv + ' still comes.';
    if (net >= 1 && cmp.w2) { cands.push(Mv + ' still comes, but you win ' + (cmp.w2i || cmp.w2) + '.'); if (!cmp.w2i && cmp.w2n !== cmp.w2) cands.push(Mv + ' still comes, but you win ' + cmp.w2n + '.'); }
    else if (net === 0 && lost >= 1) cands.push(Mv + ' still comes, but you lose nothing.');
    else if (net < 0 && -net < lost && cmp.w) cands.push(Mv + ' still comes. You lose less.');
    else if (n.captured && colorW(n.captured) === pov) cands.push(who + ' still takes your ' + PIECE_WORD[pType(n.captured)] + '.');
    return { cands: cands, fall: fall };
  }
  /* what it nets where it ends, only where that count stands (settledAt) */
  var stands = lastB && !isMate(n.after) && settledAt(s.line, s.k);
  var won = stands ? storyGain(s.line, s.k, s.from, gain) : null;
  if (won && !namesIt(n, won.w)) says.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' You win ' + won.w + '.'); if (won.wn !== won.w) cands.push(h + ' You win ' + won.wn + '.'); });
  /* a better line that still loses material where it ends says so only when
     it loses less than the game did (a loss the card claims); one that
     loses nothing after a game move that lost something says so (and what
     it saves, F1.4); otherwise its ply alone */
  else if (stands && cmp.w && gain < 0 && -gain < c.lossG) says.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' You lose less.'); });
  else if (lastB && betterClaim(a, s.line, s.k, s.from) === 'none') says.concat([Mv + '.']).forEach(function (h) { if (keep) cands.push(h + ' Your ' + keep + ' is safe.'); cands.push(h + ' Nothing is lost.'); });
  return { cands: cands.concat(says), fall: fall };
}
/* what the better line may claim where it ends (node k, counted from node
   `from`), only where its count stands (settledAt): 'win' (it nets
   material), 'less' (it loses less than the game move did, a loss the card
   claims), 'none' (after a game move that lost material or allowed a mate,
   it has lost nothing, and loses nothing at any later point where the line
   stands), else '' */
function betterClaim(a, line, k, from) {
  var n = line.nodes[k], c = a.cls, pov = myPov(a.it);
  if (!n || !n.move || isMate(n.after) || !settledAt(line, k)) return '';
  var base = matDiff(line.nodes[from].before.b, pov), gain = matDiff(n.after.b, pov) - base;
  if (gain >= 1) return 'win';
  if (gain < 0) return buildCompare(a).w && -gain < c.lossG ? 'less' : '';
  if (!(c.lossG >= 1 || c.mateAgainst)) return '';
  for (var j = k + 1; j < line.nodes.length; j++) if (settledAt(line, j) && matDiff(line.nodes[j].after.b, pov) < base) return '';
  return 'none';
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
  /* the story: one caption for the ply on the board, a red border on your
     game's steps, green on the better ones. The better steps keep the
     card's verdict disc; your game's steps take your king (C4: a green tick
     never sits beside a move that went wrong) */
  if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    var sp = buildStory(a).steps[a.view.i], gm = sp.seg !== 'better';
    /* the danger frame (F1.5) is your game's, before its first move */
    return { disc: gm ? 'king' : a.revealed ? 'info' : 'good', kind: gm ? 'sgame' : 'sbetter', cap: sp.cap };
  }
  if (a.phase === 'done') {
    /* row 2: R4 once the result has settled (S0 at V+850, and the story
       that follows it); before that the answer shown says how to play it
       (V2), and a solve says nothing more yet */
    var mode = a.view && a.view.mode, said = !mode || (mode === 's0' && a.settle >= 2), r4 = said ? r4Of(a) : null;
    /* settled, a reveal names the card's own answer, the move R4 is about
       (inside a forcing line the band named each move as it came) */
    if (a.revealed)
      return { disc: 'info', kind: 'info', row1: answerRow(a, r4), cands: r4 ? r4.cands : [CARD_COPY.V2()], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null };
    return { disc: 'good', kind: 'good', row1: a.alt ? CARD_COPY.R3() : a.result === 'first' ? CARD_COPY.R1() : CARD_COPY.R2(),
             cands: r4 ? r4.cands : [], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null };
  }
  /* V1, the answer shown: settled, the card's own answer; before that the
   move due now (a.answerSan, and its words beside it). At tier 1 in words
   where row 1 has room */
function answerRow(a, settled) {
  var san = settled ? sanOf(a.pre, a.best) : a.answerSan || '', aw = a.answerWords;
  var w = !inWords(a) ? '' : settled ? moveWords(a.pre, a.best) : aw && aw.san === san ? aw.w : '';
  if (w && fitsRow(CARD_COPY.V1(a, w), 'row1')) return CARD_COPY.V1(a, w);
  /* tier 1 says no move in SAN: the green arrow shows it (F1.6) */
  return inWords(a) ? CARD_COPY.V3() : CARD_COPY.V1(a, san);
}
/* S3: the band keeps what it said for 300 ms, then says the move is
     being checked, and at 3 s that it still is */
  if (a.phase === 'checking' && a.checkSaid)
    return { disc: 'checking', kind: 'neutral', sweep: true, row1: fitRow(inWords(a) ? [a.checkingW ? CARD_COPY.K1(a, true) : '', 'Checking your move…'] : [CARD_COPY.K1(a)], 'row1', 'Checking…'), cands: a.checkSaid >= 2 ? [CARD_COPY.K2()] : [], fall: '' };
  if (a.phase === 'tried' && t) {
    /* a miss's reason waits for its own beat (S4, a.reason 2): the verdict
       alone first */
    var tv = v || triedVerdict(a, t, null, false), wait = t.kind === 'miss' && (a.reason || 0) < 2;
    /* the check step it failed comes with the reason, at tiers 2 and 3 (F1.2) */
    return { disc: t.kind === 'miss' ? 'bad' : t.kind, kind: t.kind === 'miss' ? 'bad' : t.kind === 'unchecked' ? 'info' : 'close',
             row1: tv.row1, cands: wait ? [] : tv.cands, fall: wait ? '' : tv.fall, chip: wait ? '' : t.chip || '', stepChip: !!t.chip };
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
  /* tier 1 names the game move in words, else says no move (F1.6) */
  return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), cands: inWords(a) ? [CARD_COPY.T2(a, true), 'Find a better move.'] : [CARD_COPY.T2(a)], fall: '', chip: ss_relearn(a) ? CARD_COPY.T3() : '' };
}

/* ── the board's labels (copy L) ──────────────────────────────────────────
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
   drawn, its piece to move (S0 draws a threat only where it holds there).
   Hint 1's danger after the game move (the arrow keyed hint) and both
   tries' danger (keyed tries) are not on the board now: no first-sight
   words, and "mate" or "takes" only when that mate or that capture of one
   of yours is there as drawn (S8); the danger keyed danger is (their
   capture, were it their move), and teaches only in See why. null: nothing
   true to say */
function threatSay(a, f, ar) {
  var ap = f.st.b[ar.from];
  if (!ap) return null;
  var pos = cloneState(f.st);
  pos.w = colorW(ap);
  pos.ep = -1;
  var d = moveDoes(pos, ar.from, ar.to);
  if (!d) return null;
  if (ar.key === 'hint' || ar.key === 'tries') return d.mate ? { say: 'mate', teach: '', does: d } : d.took && colorW(d.took) === myPov(a.it) ? { say: 'takes', teach: '', does: d } : null;
  var t = a.tier, opp = sidesOf(a).opp;
  var say = d.mate ? 'mate' : d.draw ? 'draw' : d.took ? (d.free ? 'free ' + PIECE_WORD[pType(d.took)] : 'takes')
    : d.fork ? (t === 3 ? 'fork' : 'hits two') : d.check ? 'check' : d.pin ? (t === 3 ? 'pinned' : 'stuck') : '';
  /* hint 1's danger never teaches: its frame has no room for first-sight
     words (they come in See why's danger frame) */
  return { say: say, teach: ar.key === 'danger' && a.phase !== 'done' ? '' : d.took ? opp + ' can take' : d.check ? opp + ' can check' : '', does: d };
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
  /* tier 1 names the game move in words where the label has room (alt:
     its SAN, tried next) */
  (o.ghosts || []).forEach(function (g) {
    if (seen('ghost') || first.ghost || g.rook) return;
    first.ghost = cand(gameSan(a) + ' in your game', 'red', 'ghost', g.sq, null, { kind: 'ghost', sq: g.sq, p: g.p });
    if (inWords(a)) { first.ghost.alt = first.ghost.text; first.ghost.text = upFirst(moveWords(a.pre, a.played)) + ' in your game'; }
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
  return WORD_BUDGET - bandWords(b, ss ? barSlots(v, ss) : []) - stripWords(v) - (retryTipOn(a) ? wordsIn(RETRY_TIP) : 0);
}
