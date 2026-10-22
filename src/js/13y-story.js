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
  /* V2.1: "castling" alone only where one castling is legal, else its side */
  if (m.castle || (pType(p) === 'K' && Math.abs(m.to - m.from) === 2)) {
    var other = legalMoves(st).some(function (x) { return x.from === m.from && pType(p) === 'K' && Math.abs(x.to - x.from) === 2 && x.to !== m.to; });
    return other ? 'castling on the ' + (m.to > m.from ? 'king\'s' : 'queen\'s') + ' side' : 'castling';
  }
  /* where two pieces of that kind can go there, the one that moves:
     "rook from a8 to d8" */
  var twin = legalMoves(st).some(function (x) { return x.to === m.to && x.from !== m.from && st.b[x.from] === p; });
  return PIECE_WORD[pType(p)] + (twin ? ' from ' + sqName(m.from) : '') + (st.b[m.to] || m.ep >= 0 ? ' takes on ' : ' to ') + sqName(m.to)
    + (m.promo ? ' to make a ' + PIECE_WORD[pType(m.promo)] : '');
}
function upFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
var MOVE_PHRASE = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling(?: on the (?:king|queen)'s side)?/gi;
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
  /* B8: the task as row 1 of a card that opens on its drawn Hint 1 */
  T7: function () { return 'Find a better move'; },
  T4: function (a) { var s = sidesOf(a); return 'You are ' + s.me + '. Move a ' + s.mine + ' piece.'; },
  T5: function () { return 'That piece can\'t go there.'; },
  /* V2.7: a move the rules refuse because the king would be in check */
  T6: function () { return 'Your king would be in check there.'; },
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
  /* V1.9: at More help, a try that takes the attacked piece to safety */
  C3: function (p) { return 'That saves your ' + PIECE_WORD[p] + '. Look for more.'; },
  E1: function () { return 'Cannot check this move'; },
  E2: function () { return 'Not counted. Try again.'; },
  R1: function () { return 'Found it'; },
  R2: function () { return 'You got there'; },
  R3: function () { return 'That works too'; },
  /* release 4: a find after a hint; under a move of the near band ("Found
     it"), the best named where it is really better at depth */
  R8: function () { return 'Found with a hint'; },
  R10: function (m) { return m + ' was a little better.'; },
  /* V1.2: a move in the found band (row 2 under "Found it"), and the main
     move named after one that works too; V1.6: a forcing line found, a
     later move missed (t1, then t2 and t3 with the two moves) */
  R5: function () { return 'Just as good as the main answer.'; },
  R6: function (m) { return 'The main move was ' + m + '.'; },
  R7: function (x, m) { return x + ' is as good as ' + m + '.'; },
  L1: function () { return 'First move found, a later one missed.'; },
  L2: function (f, m) { return f + ' found. ' + m + ' missed later.'; },
  /* B3: a forcing line found with a good move that was not the line's on
     the way (t1, then t2 and t3 with the two moves) */
  L3: function () { return 'Found it; one later move was weaker.'; },
  L4: function (f, m) { return f + ' found. ' + m + ' was stronger later.'; },
  V1: function (a, san) { return 'The answer: ' + (san || a.answerSan || ''); },
  V2: function () { return 'Play the green arrow.'; },
  V3: function () { return 'Here is the answer'; },
  H1: function () { return 'Hint 1 of 2'; },
  H3: function () { return 'Hint 2 of 2'; },
  H3b: function () { return 'Move the circled piece.'; },
  H3c: function () { return 'Find a safe square.'; },
  F1: function () { return 'Right'; },
  F2: function (a) { return sidesOf(a).opp + ' replies next.'; },
  F3: function () { return 'Your move'; },
  /* game mode (F8.1): the tag every game-mode card wears before its answer,
     its row 2 (gameRow), and the game move tried before it was shown */
  G1: function () { return 'Review'; },
  G3: function () { return 'As in your game'; },
  /* a foil (F8.2): its verdicts, its settled lines and its hint 2 with no
     danger on the board; m is the game move in SAN */
  O1: function () { return 'Good, nothing to fix'; },
  O2: function () { return 'Playable'; },
  O3: function (m) { return 'In your game, ' + m + ' was fine too.'; },
  O4: function (m) { return m + ' in your game kept more.'; },
  O5: function (m) { return 'Your game move ' + m + ' was fine here.'; },
  O6: function (m) { return 'You played ' + m + ' in your game too.'; },
  /* release 4: the game move played again, a find */
  O11: function (m) { return m + ' was good in your game too.'; },
  /* V2.6: a foil's Hint 2 with no threat and no only move, its only move,
     and its settled row after that only move; Show the answer's row 2 */
  O7: function () { return 'Any good move passes here.'; },
  O8: function () { return 'Only one move holds here.'; },
  O9: function () { return 'The only move, as in your game.'; },
  O10: function (m) { return 'Your game move ' + m + ' was good too.'; },
  /* practice (F9.3, F9.4): the tag a practice position wears, a lesson's
     tag, the two source lines, a lesson's own position's end; where Hint 3
     can follow (F9.2), the hint rows count to three */
  P1: function () { return 'Practice'; },
  /* a study (release 3 slice G): what it is, before its answer */
  S1: function () { return 'Study: steps do not change.'; },
  P2: function () { return 'Lesson'; },
  P3: function () { return 'Lesson position'; },
  P4: function () { return 'Another player\'s game'; },
  P5: function () { return 'Now find it in your games.'; },
  H4: function () { return 'Hint 1 of 3'; },
  H5: function () { return 'Hint 2 of 3'; },
  H6: function () { return 'Hint 3 of 3'; },
  /* predict their reply (F10.1): the question after the first move of a
     forcing line at tier 3 (Q2), and a tap on a piece of yours while it
     asks (Q1) */
  Q1: function (a) { return 'Guess their move: a ' + sidesOf(a).opp.toLowerCase() + ' piece.'; },
  Q2: function () { return 'Now their best reply?'; }
};
/* the first game-mode card's notice, once (F8.1) */
var GAME_NOTE = 'Reviews now look like your game: no arrow, and not every position hides a mistake.';
/* a game-mode card's row 2 before its game move shows (F8.1): the move and
   the clock the player had when the position arose ("Move 35 · 20:35 on
   your clock"), with no clock "Move 35 vs opponent1" ("Move 35 of your
   game" when the name does not fit) */
function gameRow(a) {
  var g = a.it.g, mv = 'Move ' + (Math.floor(a.it.b.p / 2) + 1), clk = clockWhen(a.it);
  if (clk != null) return mv + ' · ' + clockRow(clk) + ' on your clock';
  return g.opp && fitsRow(mv + ' vs ' + g.opp, 'row2') ? mv + ' vs ' + g.opp : mv + ' of your game';
}
/* a clock as it reads: "20:35", "1:05:09" */
function clockRow(s) {
  s = Math.max(0, Math.round(s));
  var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60, two = function (x) { return (x < 10 ? '0' : '') + x; };
  return (h ? h + ':' + two(m) : m) + ':' + two(r);
}
/* the player's clock when the position arose, in seconds: a mistake's from
   the clock after it and its time (b.c + b.tt, less the increment), a foil's
   as its record keeps it; null with no clock */
function clockWhen(it) {
  var b = it.b;
  if (it.foil) return b.fc != null ? b.fc : null;
  return b.c != null && b.tt != null ? b.c + b.tt - incOf(it.g) : null;
}
/* F10.1, V1.7: what a guess of their reply was, as row 2 says it once the
   reply has landed (g: the guess, its verdict g.v; y: the reply played, as
   SAN with its check or mate sign): their reply itself, "You saw it:
   Rf7+."; another move within 4 points of their best, "Close. Their best
   was Rf7+." (never "as good as": the list's depth is the key's, and the
   words claim only the best); else "Not f4: they had Rf7+."; one the
   three-line list cannot judge (no list, or a move off it that may be as
   good as the third), the shorter true line, "They had Rf7+." */
function guessWords(g, y) {
  if (!g || g.skip || !y) return [];
  if (g.v === 'saw') return ['You saw it: ' + y + '.'];
  if (g.v === 'good') return ['Close. Their best was ' + y + '.', 'They had ' + y + '.'];
  if (g.v === 'not') return ['Not ' + g.san + ': they had ' + y + '.', 'They had ' + y + '.'];
  return ['They had ' + y + '.'];
}
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
  T6: function (a) { return [CARD_COPY.T6(a)]; },
  N1: function (a) { return [CARD_COPY.N1(a)]; },
  Q1: function (a) { return [CARD_COPY.Q1(a)]; }
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
  /* the ledger's pieces are no words (each takes two characters, rowLen);
     a form that carries a program value never fits (progVal) */
  return !!s && !progVal(s) && rowLen(s) <= cap.ch && wordsIn(s) <= cap.words && oneUnit(s).split(/\s+/).filter(function (t) { return !/^[\u2654-\u265f.,]+$/.test(t); }).length <= cap.words;
}
/* a program value on screen ("b3null", "undefined", "NaN%", "[object
   Object]"): a string that carries one says nothing true, so no screen
   shows it. The fit ladder skips such a form (fitsRow), the band, Details,
   the check line, the board's description and the explorer's rows drop it
   or say their fallback instead (no lowercase letter on either side of the
   word: "b3null" is one, "annulled" none) */
var PROG_VAL = /(^|[^a-z])(null|undefined|NaN)(?![a-z])|\[object /;
function progVal(s) { return s != null && PROG_VAL.test(String(s)); }
/* the string itself, or '' where it carries a program value */
function noProg(s) { return s && !progVal(s) ? s : ''; }
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
/* the tag row's context line counts too (F4.2) */
/* and the step track's "Last step" (release 3) */
function bandWords(b, slots) { return wordsIn(b.row1) + wordsIn(b.row2) + wordsIn(b.chip) + wordsIn(b.tag) + wordsIn(b.src) + wordsIn(b.cap) + (b.tk && b.tk.pill ? 2 : 0) + (b.tk ? wordsIn(b.tk.note) : 0) + barWords(slots); }
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

/* ── what a wrong try's line does, to the end (V2.2) ───────────────────────
   A wrong try's row 2 names the first decisive event of its line (the try,
   then their reply and the line after it: the key's line for that try, the
   1,000,000-node re-check's, else the 250,000-node search's), read by the
   settle rule (settleLine's quiet plies): their mate in the line (next move,
   after you take back, or later), a promotion of theirs that stands, a
   forced mate the score shows, their first capture when its loss stands
   where the line settles, a fork of theirs (after you take back, or at once)
   whose loss stands, a later capture of theirs whose loss stands. A material
   event is named only when the loss goes beyond what the answer's settled
   line loses: the piece named is one the try's line loses where it settles,
   net of what it takes back, and the answer's line does not, and the try's
   line ends at least that much worse (a pawn's whole for a pawn, else 2) at
   its first and its last settled point. A fork is named only where the
   motif code finds it on that ply */
/* a line's plies from st (legal moves only, 12 at most, to a mate):
   {m, u, before, after, cap, check, mate, byW} */
function lineNodes(st, pv) {
  var s = cloneState(st), out = [];
  for (var i = 0; i < (pv || []).length && out.length < SETTLE_MAX; i++) {
    var m = typeof pv[i] === 'string' ? uciToMove(s, pv[i]) : pv[i];
    if (!m) break;
    var before = cloneState(s), cap = m.ep >= 0 ? s.b[m.ep] : s.b[m.to];
    applyMove(s, m);
    var chk = checkersOf(s).length > 0, mt = chk && !legalMoves(s).length;
    out.push({ m: m, u: moveUci(m), before: before, after: cloneState(s), cap: cap || null, check: chk, mate: mt, byW: !!before.w });
    if (mt) break;
  }
  return out;
}
/* a quiet ply as settleLine reads one: nothing taken, promoted or checked,
   and nothing left en prise after it */
function quietNode(x) { return !x.cap && !x.m.promo && !x.check && !enPrise(x.after) && !facesMate(x.after); }
/* the pieces each side took along plies [0, k), net (an equal swap
   cancels, a knight against a bishop too): {lost (side pov's), won (the
   other side's)}, piece letters */
function netSwap(ns, k, pov) {
  var lost = [], won = [];
  for (var i = 0; i < k && i < ns.length; i++) if (ns[i].cap) (colorW(ns[i].cap) === pov ? lost : won).push(pType(ns[i].cap));
  [false, true].forEach(function (cross) {
    for (var w = won.length - 1; w >= 0; w--) {
      var j = lost.indexOf(won[w]);
      if (j < 0 && cross && (won[w] === 'N' || won[w] === 'B')) j = lost.indexOf(won[w] === 'N' ? 'B' : 'N');
      if (j >= 0) { won.splice(w, 1); lost.splice(j, 1); }
    }
  });
  return { lost: lost, won: won };
}
/* the pieces one side lost along plies [0, k), net of what it took back */
function netLostOf(ns, k, pov) { return netSwap(ns, k, pov).lost; }
/* the answer's settled line from the position the card asks from (its node
   0 the answer due now): the player's net material where it settles and the
   pieces it loses there, net of what it takes back. {net, lost} */
function answerSettle(a) {
  var j = a.sol && a.solIdx > 0 ? a.solIdx : 0, pov = myPov(a.it);
  var line = unpackUci(a.it.b.lu).slice(j);
  if (!line.length) line = [moveUci(dueMove(a))];
  var ns = lineNodes(a.st, line), s = settleLine(a.st, line);
  return { net: pov ? s.w - s.b : s.b - s.w, lost: netLostOf(ns, s.k, pov) };
}
/* the fork the move of ply x makes, as the motif code finds it (motifMade's
   reading): {sq, targets (piece letters, the most valuable first)} or null */
function forkAt(x) {
  var piece = pType(x.before.b[x.m.from]);
  if (piece === 'K') return null;
  var f = mFork({ nodes: [{}, { after: x.after, move: x.m, piece: piece }, {}, { piece: 'K' }], povWhite: x.byW });
  if (!f) return null;
  return { sq: f.sq, targets: f.targets.map(function (q) { return pType(x.after.b[q]); }).sort(function (p, q) { return MOTIF_VAL[q] - MOTIF_VAL[p]; }) };
}
/* the loss a capture must leave standing: a pawn's whole for a pawn, else 2 */
function needOf(p) { return pType(p) === 'P' ? 1 : 2; }
/* the first decisive event of a wrong try's line pv (the try first, from
   o.st or the position the card asks from), or null: {t: 'mate1' | 'backMate'
   | 'forced' | 'promo' | 'take' | 'fork' | 'backFork' | 'backTake' | 'even'
   | 'refused' | 'later' | 'loss' | 'mateThreat' | 'attacks', n (its ply), cap
   and back (their capture and your move that takes back), f (a fork's
   targets), p (the piece taken, or the piece their reply attacks), p2 (a
   second piece the same capture's piece takes), at (the ply's index), loss
   (the pieces the line loses that the answer's does not), re and sub (a
   take-back the line avoids, and why it fails)}. o.mate: the try's score as
   a mate, from the player's side (negative: they mate); o.win its win
   chance; o.cp its score (centipawns, the player's side: B4, a settle point
   counts only where its material balance agrees with it, settleAgrees);
   o.back: the take-back the line avoids, searched (B6 c: {pv, cp, mate});
   o.deep false: a first search's line (no "Nothing lost" from it).
   Release 2: the line is read by the settle rule (mate threats read on, the
   score agreeing, B4; no material event where it never agrees); their
   first capture comes first (B6 a), a take-back the line plays says what
   follows it ("After the trade, Qxc3+ forks.", or nothing lost: b), one it
   avoids why it fails (c); with no event, what their reply attacks (d); at
   tier 1 a mate only within 3 of their moves (B7) */
function tryEvent(a, pv, o) {
  o = o || {};
  var st = o.st || a.st, pov = myPov(a.it), ns = lineNodes(st, pv), t1 = inWords(a);
  if (ns.length < 2) return null;
  var base = matDiff(st.b, pov), ans = answerSettle(a);
  var net = function (k) { return matDiff(ns[k - 1].after.b, pov) - base; };
  var setl = [], quietAll = [];
  for (var k = 1; k + 1 < ns.length; k++) if (quietNode(ns[k]) && quietNode(ns[k + 1])) quietAll.push(k);
  /* B4: a settle point counts only where its material balance agrees with
     the score (both the player's) */
  var agrees = function (kk) { return o.cp == null || settleAgrees(matDiff(ns[kk - 1].after.b, pov), o.cp / 100, true); };
  quietAll.forEach(function (kk) { if (agrees(kk)) setl.push(kk); });
  /* (c)'s own line, the take-back searched, read to its end where it never
     goes quiet: its count there stands where it agrees with the score (card
     4's bxc3 Qxc3+ Kd1 Qxa1 c3 d5 exd5 O-O Qxe7 Qxc3, 3 down at -4.55) */
  if (o.sub && !quietAll.length && ns.length >= SETTLE_MAX && o.cp != null && agrees(ns.length)) setl.push(ns.length);
  var noMat = quietAll.length > 0 && !setl.length;
  o.noMat = noMat;
  var mi = -1;
  for (var i = 0; i < ns.length; i++) if (ns[i].mate) { mi = i; break; }
  var k1 = mi >= 0 ? mi + 1 : setl.length ? setl[0] : -1, kL = setl.length ? setl[setl.length - 1] : k1;
  var theirs = function (x) { return !!x && x.byW !== pov; }, mine = function (x) { return !!x && !!x.cap && colorW(x.cap) === pov; };
  /* your move y takes back on the square where their capture x just landed,
     a piece worth at least what x took: a trade, not a loss */
  var back = function (x, y) { return !!y && !!y.cap && y.m.to === x.m.to && MOTIF_VAL[pType(y.cap)] >= MOTIF_VAL[pType(x.cap)]; };
  /* what the line loses beyond the answer's, at its first and last settled
     points: the pieces (net) the answer's line does not lose, and the count */
  var beyond = function (kk) {
    var lost = netLostOf(ns, kk, pov), extra = ans.lost.slice();
    return { n: ans.net - net(kk), lost: lost.filter(function (p) { var j = extra.indexOf(p); if (j >= 0) { extra.splice(j, 1); return false; } return true; }) };
  };
  var stands = function (need, p) {
    if (k1 <= 0 || noMat) return false;
    return [k1, kL].every(function (kk) { var b = beyond(kk); return b.n >= need && (!p || b.lost.indexOf(pType(p)) >= 0); });
  };
  /* the same, counted on the line alone (not beyond the answer's) */
  var standsAll = function (need, p) {
    if (k1 <= 0 || noMat) return false;
    return [k1, kL].every(function (kk) { return -net(kk) >= need && (!p || netLostOf(ns, kk, pov).indexOf(pType(p)) >= 0); });
  };
  var lossAt = k1 > 0 && !noMat ? beyond(k1).lost : [];
  /* B7: at tier 1 "checkmate" only where the mate comes within 3 of their moves */
  var near = function (moves) { return !t1 || moves <= 3; };
  /* their mate in the line: next move, after you take back, or later */
  if (mi >= 1 && theirs(ns[mi])) {
    if (mi === 1) return { t: 'mate1', n: ns[1], at: 1 };
    if (mi === 3 && mine(ns[1]) && back(ns[1], ns[2])) return { t: 'backMate', cap: ns[1], back: ns[2], n: ns[3], at: 3 };
    if (near((mi + 1) / 2)) return { t: 'forced', n: ns[1], at: 1 };
  }
  /* a promotion of theirs whose new piece stands to the line's end, while
     they are no worse */
  if (o.win == null || o.win < 50) {
    /* (within the plies See it plays: SEE_PLIES with the try) */
    for (i = 1; i < ns.length && i < SEE_PLIES; i++) {
      if (!theirs(ns[i]) || !ns[i].m.promo) continue;
      var sq = ns[i].m.to, gone = false;
      for (var j = i + 1; j < ns.length && !gone; j++) {
        if (theirs(ns[j]) && ns[j].m.from === sq) sq = ns[j].m.to;
        else if (!theirs(ns[j]) && ns[j].m.to === sq) gone = true;
      }
      if (!gone) return { t: 'promo', n: ns[i], at: i };
    }
  }
  /* a forced mate the score shows, past the line's end */
  if (o.mate != null && o.mate < 0 && near(-o.mate)) return { t: 'forced', n: ns[1], at: 1 };
  /* material is read only where a line can be trusted: its event among
     their first three moves (a search's line grows less sure along its
     tail: 184455333378:48's Rad1 line drops a bishop nine plies deep, which
     a search from there does not), and in line with the score: the drop
     from the answer to the try at least 0.6 of the loss named */
  var upto = Math.min(k1 > 0 ? k1 : ns.length, EVENT_PLIES + 1);
  var trusted = !(o.drop != null && k1 > 0 && o.drop < 0.6 * Math.max(1, beyond(k1).n));
  /* B6: their first capture of yours, never a later one first */
  var xi = -1;
  for (i = 1; i < upto; i += 2) if (theirs(ns[i]) && mine(ns[i])) { xi = i; break; }
  var x = xi >= 0 ? ns[xi] : null;
  /* (a take-back of less value counts as one where the line is no worse
     for the swap so far: the knight line's exf6 Bxd1 Kxd1 took a knight
     first, so Kxd1 leaves it a point up) */
  var y0 = x ? ns[xi + 1] : null, cheap = !!y0 && !!y0.cap && y0.m.to === x.m.to && net(xi + 2) >= 0;
  if (x && (back(x, y0) || cheap)) {
    /* (b) a take-back the line plays: what follows it where it settles */
    var y = ns[xi + 1], z = ns[xi + 2];
    var fz = theirs(z) ? forkAt(z) : null;
    if (fz && trusted && stands(1)) return { t: 'backFork', n: z, f: fz, cap: x, back: y, at: xi + 2, loss: lossAt };
    if (theirs(z) && mine(z) && !back(z, ns[xi + 3]) && trusted && stands(needOf(z.cap), z.cap)) return { t: 'backTake', n: z, p: pType(z.cap), cap: x, back: y, at: xi + 2, loss: lossAt };
    /* (nothing lost: at every point after the take-back where the line
       settles in line with its score, and at its end; or, where the try's
       own capture began the trade, at every quiet point after it, whatever
       the score: the knight line's exf6 Bxd1 Kxd1, a point up. A line whose
       count never agrees with its score says no such thing: B4,
       184172942198:33's Nh4 Rxf6 gxf6, whose deeper line loses the knight) */
    /* (read at the key's or the re-check's depth only, o.deep: a first
       search's line can trade where a deeper one wins the piece; and never
       where the try leaves the player under 20%, where the band says it:
       foil:184234373418:65's a5 Qxd5 Rxd5, 4%, loses a pawn further on) */
    var later = function (l) { return l.filter(function (kk) { return kk > xi + 1; }); };
    var noneLost = function (l) { return l.length > 0 && l.every(function (kk) { return net(kk) >= 0; }) && net(ns.length) >= 0; };
    if (o.deep !== false && !(o.win != null && o.win < 20) && (noneLost(later(setl)) || (!!ns[0].cap && noneLost(later(quietAll))))) return { t: 'even', n: x, cap: x, back: y, at: xi };
  } else if (x) {
    /* (c) a legal take-back the line avoids: why it fails, from its own
       search (o.back); (a) else their capture stays */
    var re = legalMoves(x.after).filter(function (m) { return (m.ep >= 0 ? m.ep : m.to) === x.m.to; });
    var bk = xi === 1 && o.back && o.back.pv && o.back.pv.length && re.some(function (m) { return moveUci(m) === o.back.pv[0]; }) ? o.back : null;
    if (bk) {
      var sub = tryEvent(a, pv.slice(0, xi + 1).concat(bk.pv), { st: st, mate: bk.mate != null ? bk.mate : null, cp: bk.cp, win: bk.cp != null ? winPct(bk.cp) : null, sub: true });
      if (sub && /^(mate1|forced|fork|backFork|backMate|take|backTake|later|loss)$/.test(sub.t) && (sub.at > xi + 1 || sub.t === 'forced')) return { t: 'refused', n: x, cap: x, re: lineNodes(x.after, [bk.pv[0]])[0], sub: sub, at: xi };
    }
    /* two captures that stay, by the same piece; the captures named are the
       loss (never a pawn where the line wins more, B4: 184435538450:47's
       Bxg7+ takes a pawn, and a bishop after) */
    var x2 = ns[xi + 2], p2 = theirs(x2) && mine(x2) && x2.m.from === x.m.to && !back(x2, ns[xi + 3]) ? pType(x2.cap) : '';
    /* (their reply's own capture is what See it shows first: named where
       the piece stays lost where the line settles, whatever the answer's
       line loses too, B6: 184212737262:58's Re3 Rxd2 takes the bishop;
       a later one only beyond the answer's) */
    var kept = xi === 1 ? standsAll(needOf(x.cap), x.cap) : stands(needOf(x.cap), x.cap);
    if (trusted && kept && MOTIF_VAL[pType(x.cap)] + (p2 ? MOTIF_VAL[p2] : 0) + 1 >= beyond(k1).n)
      return xi === 1 ? { t: 'take', n: x, p: pType(x.cap), p2: p2, at: 1, loss: lossAt } : { t: 'later', n: x, p: pType(x.cap), p2: p2, at: xi, loss: lossAt };
  }
  /* a fork of theirs whose loss stands */
  for (i = 1; i < upto; i += 2) {
    var f = theirs(ns[i]) ? forkAt(ns[i]) : null;
    if (f && trusted && stands(1)) return { t: 'fork', n: ns[i], f: f, cap: ns[1], back: ns[2], at: i, loss: lossAt };
  }
  /* else a loss that stands at both settled points, in the pieces the
     answer's line keeps, settled within the trusted plies */
  var sw = netSwap(ns, k1 > 0 ? k1 : 0, pov), worth = function (l) { return l.reduce(function (x0, p) { return x0 + MOTIF_VAL[p]; }, 0); };
  /* (the try's own line down at its settled point: "You'd lose ♜ for ♕"
     is never said of a line that wins a queen for a rook, however much
     more the answer wins) */
  if (trusted && k1 > 0 && k1 <= EVENT_PLIES + 2 && lossAt.length && worth(sw.lost) - worth(sw.won) >= (lossAt.length === 1 ? needOf(lossAt[0]) : 2) && -net(k1) >= 1
      && stands(lossAt.length === 1 ? needOf(lossAt[0]) : 2)) return { t: 'loss', n: ns[k1 - 1], lost: lossAt, won: sw.won, at: k1 - 1, loss: lossAt };
  if (o.sub) return null;
  /* (d) with no event, what their reply does: a mate it threatens, else the
     most valuable piece of yours it attacks (worth more than it, or with no
     guard) */
  var r1 = ns[1];
  if (theirs(r1) && !r1.cap) {
    if (!r1.check && mateInOne(dzNullState(r1.after))) return { t: 'mateThreat', n: r1, at: 1 };
    var hit = null, by = pType(r1.before.b[r1.m.from]);
    attacksFrom(r1.after.b, r1.m.to).forEach(function (q) {
      var tp = r1.after.b[q];
      if (!tp || colorW(tp) !== pov || pType(tp) === 'K') return;
      if (attacksFrom(r1.before.b, r1.m.from).indexOf(q) >= 0 && r1.before.b[q] === tp) return;
      if ((MOTIF_VAL[pType(tp)] > MOTIF_VAL[by] || !isDefended(r1.after.b, q)) && (hit == null || MOTIF_VAL[pType(tp)] > MOTIF_VAL[pType(r1.after.b[hit])])) hit = q;
    });
    if (hit != null) return { t: 'attacks', n: r1, p: pType(r1.after.b[hit]), sq: hit, at: 1 };
  }
  return null;
}
var EVENT_PLIES = 5;
/* pieces of the player's in words: "the bishop", "two pawns", else the
   board's pieces ("♖♙"); with pieces of theirs taken back on the way (won),
   the trade in the board's pieces ("♖ for ♘"), never one piece's word for
   less than its worth */
function lostWords(a, lost, won) {
  if (!lost || !lost.length) return '';
  var w = myPov(a.it), icons = function (l, white) { return l.slice().sort(function (p, q) { return MOTIF_VAL[q] - MOTIF_VAL[p]; }).map(function (p) { return LEDGER[white ? p : p.toLowerCase()]; }).join(''); };
  if (won && won.length) return icons(lost, w) + ' for ' + icons(won, !w);
  if (lost.length === 1) return 'the ' + PIECE_WORD[lost[0]];
  if (lost.length === 2 && lost[0] === lost[1]) return 'two ' + PIECE_WORD[lost[0]] + 's';
  return icons(lost, w);
}
function lowFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
/* an event in row 2's words, fullest first (t1: the moves in words, each
   form's SAN twin after it): "Qxf3 takes your knight." (tier 1 "Their queen
   takes your knight."), "Then Qxf2 is checkmate.", "Then Rd1+ forces mate."
   (tier 1 "Then they can force checkmate."), "Then f1=Q: their pawn becomes
   a queen." (tier 1 "Their pawn will become a queen."). Release 2 (B6):
   after a take-back at equal value, "After the trade, Qxc3+ forks." (tier 1
   "After the trade, their queen forks."), "After the trade, Qxg7 is mate."
   ("..., they can checkmate."), "After the trade, Rxd2 takes your bishop."
   ("..., you lose your bishop."); taken back with nothing lost, "Nothing
   lost, but there's a better move."; a take-back that fails, "Bxc3+, and
   bxc3 Qxc3+ forks." / "Rxd1, and Bxd1 allows Qxg7 mate." (tier 1 "If you
   take back, their queen forks."); what their reply does, "Then Nf5
   attacks your queen." (tier 1 "Then their knight attacks your queen."),
   "Then they threaten mate.". At tier 1 no row opens "Then" on a reply that
   takes */
function eventForms(a, ev) {
  var t1 = inWords(a), n = ev.n;
  var san = function (x) { return sanOf(x.before, x.m); }, cs = function (x) { return capSan(x.before, x.m); }, mw = function (x) { return moveWords(x.before, x.m); };
  var pw = function (x) { return PIECE_WORD[pType(x.before.b[x.m.from])]; };
  var tw = function (f) { var t = f.targets; return t.length >= 2 && t[0] === t[1] ? 'both ' + PIECE_WORD[t[0]] + 's' : PIECE_WORD[t[0]] + ' and ' + PIECE_WORD[t[1]]; };
  var both = function (w, s) { return t1 ? interleave(w, s) : s; };
  /* "After the trade" only where your take-back takes as much as they took */
  var trade = !!ev.cap && !!ev.back && ev.back.cap && (MOTIF_VAL[pType(ev.back.cap)] === MOTIF_VAL[pType(ev.cap.cap)]);
  var pair = ev.cap && ev.back ? san(ev.cap) + ' ' + san(ev.back) : '';
  var takes = function (p, p2) { return ' takes your ' + PIECE_WORD[p] + (p2 ? ' and ' + PIECE_WORD[p2] : '') + '.'; };
  if (ev.t === 'take') return (t1 ? [] : [san(n) + takes(ev.p, ev.p2)]).concat(['Their ' + pw(n) + takes(ev.p, ev.p2)]);
  if (ev.t === 'mate1') return n.cap ? both([upFirst(mw(n)) + ' is checkmate.'], ['Then ' + cs(n) + ' is checkmate.']) : both(['Then ' + mw(n) + ' is checkmate.'], ['Then ' + cs(n) + ' is checkmate.']);
  if (ev.t === 'forced') return t1 ? ['Then they can force checkmate.'] : ['Then ' + san(n) + ' forces mate.', 'Then they can force checkmate.'];
  if (ev.t === 'promo') {
    var pp = PIECE_WORD[pType(n.m.promo)], pt1 = 'Their pawn will become a ' + pp + '.';
    return t1 ? [pt1] : ['Then ' + san(n) + ': their pawn becomes a ' + pp + '.', pt1];
  }
  if (ev.t === 'backFork') {
    if (t1) return trade ? ['After the trade, their ' + pw(n) + ' forks.'] : ['Then their ' + pw(n) + ' forks ' + tw(ev.f) + '.'];
    return (trade ? ['After the trade, ' + san(n) + ' forks.'] : []).concat(['After ' + pair + ', ' + san(n) + ' forks.', 'Then ' + san(n) + ' forks ' + tw(ev.f) + '.']);
  }
  if (ev.t === 'fork') {
    var fw = (ev.at === 1 ? 'Their ' : 'Then their ') + pw(n) + ' forks ' + tw(ev.f) + '.';
    return t1 ? [fw] : [(ev.at === 1 ? '' : 'Then ') + san(n) + ' forks ' + tw(ev.f) + '.', fw];
  }
  if (ev.t === 'backMate') {
    if (t1) return trade ? ['After the trade, they can checkmate.'] : ['Then ' + mw(n) + ' is checkmate.'];
    return (trade ? ['After the trade, ' + cs(n) + ' is mate.'] : []).concat(['After ' + pair + ', ' + cs(n) + ' is mate.', 'Then ' + cs(n) + ' is checkmate.']);
  }
  if (ev.t === 'backTake') {
    if (t1) return trade ? ['After the trade, you lose your ' + PIECE_WORD[ev.p] + '.'] : ['Then their ' + pw(n) + ' takes your ' + PIECE_WORD[ev.p] + '.'];
    return (trade ? ['After the trade, ' + san(n) + ' takes your ' + PIECE_WORD[ev.p] + '.'] : []).concat(['Then ' + san(n) + ' takes your ' + PIECE_WORD[ev.p] + '.']);
  }
  if (ev.t === 'even') return ['Nothing lost, but there\'s a better move.'];
  if (ev.t === 'refused') {
    var sb = ev.sub, sn = sb.n, head = san(ev.cap) + ', and ' + san(ev.re) + ' ';
    if (sb.t === 'mate1' || sb.t === 'forced' || sb.t === 'backMate') return t1 ? ['If you take back, they can checkmate.', 'Taking back allows checkmate.'] : [head + 'allows ' + (sb.t !== 'forced' ? cs(sn) + ' mate.' : 'mate.'), 'Taking back allows mate.'];
    if (sb.t === 'fork' || sb.t === 'backFork') return t1 ? ['If you take back, their ' + pw(sn) + ' forks.', 'Taking back allows a fork.'] : [head + san(sn) + ' forks.', 'Taking back allows a fork.'];
    /* (a loss after the take-back, "Bxc3+, and bxc3 loses your knight.", is
       not said: its 250,000-node line is not sure enough, a deeper one often
       finds the piece back, release 2 P2; the ladder's next rung says it) */
    return [];
  }
  if (ev.t === 'later') {
    var lw = 'Then their ' + pw(n) + takes(ev.p, ev.p2);
    return t1 ? [lw] : ['Then ' + san(n) + takes(ev.p, ev.p2), lw];
  }
  if (ev.t === 'mateThreat') return t1 ? ['Then they threaten mate.'] : ['Then ' + san(n) + ' threatens mate.', 'Then they threaten mate.'];
  if (ev.t === 'attacks') {
    var aw = 'Then their ' + pw(n) + ' attacks your ' + PIECE_WORD[ev.p] + '.';
    return t1 ? [aw] : ['Then ' + san(n) + ' attacks your ' + PIECE_WORD[ev.p] + '.', aw];
  }
  return [];
}
/* where the game stands after a try, as a band word ("Black is better"),
   from the player's win chance w; with no deep look the word needs 5
   points of margin from its band's edges, else '' (the plain verdict) */
var BAND_MARGIN = 5;
function bandWord(a, w, deep) {
  var s = sidesOf(a), edges = [20, 40, 60, 80];
  if (w == null) return '';
  if (!deep && edges.some(function (e) { return Math.abs(w - e) < BAND_MARGIN; })) return '';
  return w >= 60 ? 'you are still better' : w >= 40 ? 'the game is even' : s.opp + (w >= 20 ? ' is better' : ' is winning');
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
/* o: {pv (the try and the line after it), deep (the key's or the
   re-check's depth: band words need no margin), mate (the try's score as a
   mate, the player's side), cp (its score in centipawns, the player's side:
   B4's settle rule), back (a take-back the line avoids, searched: B6 c),
   wBest (the answer's win chance in the same search), save (V1.9's saving
   try: at tiers 2 and 3 its reason starts "Safe, but")}. The reply and the
   band named are the line's and the score's that graded the miss (B9: the
   key's line, or the re-check's) */
function missWhy(a, c, win, reply, inLine, replyW, o) {
  o = o || {};
  var s = sidesOf(a), t1 = inWords(a), cands = [], deep = !!o.deep, bw = bandWord(a, win, deep);
  var wBest = o.wBest != null ? o.wBest : a.it.b.eb != null ? winPct(a.it.b.eb) : null;
  /* where the game stands now, never the vague "That helps Black."
     (content's review) where the score is known; "still better" only with
     the 5-point margin where the depth is not the key's (V2.1); at tier 1
     never a bare "That helps White." (B6: "Now White is ahead.") */
  var fall = !bw ? (t1 && win != null ? (win >= 50 ? 'You are still ahead, but less so.' : 'Now ' + s.opp + ' is ahead.') : 'That helps ' + s.opp + '.') : win >= 60 ? 'You are still better, but less so.' : win >= 40 ? 'Now the game is even.' : 'Now ' + s.opp + (win >= 20 ? ' is better.' : ' is winning.');
  var r1 = c && c.gameLine && c.gameLine.nodes[1], rm = r1 && r1.move ? r1 : null, rs = rm ? capSan(rm.before, rm.move) : '', rp = t1 ? replyW : reply;
  var pv = o.pv || (c && c.gameLine ? c.gameLine.nodes.filter(function (n) { return !!n.move; }).map(function (n) { return moveUci(n.move); }) : []);
  /* the line's first decisive event (V2.2, B6); a loss with no event is
     said only where the try scores 10 or more points below the answer
     (V2.1) */
  var drop = wBest != null && win != null ? (cpFromWin(wBest) - cpFromWin(win)) / 100 : null;
  var eo = { mate: o.mate, win: win, drop: drop, cp: o.cp, back: o.back, deep: deep };
  var ev = pv.length >= 2 ? tryEvent(a, pv, eo) : null;
  if (ev && ev.t === 'loss' && !(wBest != null && win != null && wBest - win >= 10)) ev = null;
  /* a line that never settles (Qg5 Nxg5 Nxg5 Bxg5 d5 exd6+ ...): their
     first capture still named where F1.2's rule holds (worth 3 net of what
     comes straight back, in line with the score, more than the best line
     loses), and only while the line still nets that loss at its end (V2.2:
     184174601056:59's Ra8 Rxd7 Bc5+ Kh1 Rxb3 wins it back); never where its
     material and its score disagree (B4) */
  if (!ev && !eo.noMat && rm && rm.captured && !(c && c.mateAgainst) && replyTakes(a, c, win)) {
    var nsAll = lineNodes(a.st, pv), n1 = nsAll[1], swAll = netSwap(nsAll, nsAll.length, myPov(a.it));
    var worthOf = function (l) { return l.reduce(function (x, p) { return x + MOTIF_VAL[p]; }, 0); };
    if (n1 && n1.cap && worthOf(swAll.lost) - worthOf(swAll.won) >= needOf(n1.cap)) ev = { t: 'take', n: n1, p: pType(n1.cap), at: 1 };
  }
  var mate1 = !!ev && ev.t === 'mate1', mateAny = !!ev && (ev.t === 'mate1' || ev.t === 'backMate' || ev.t === 'forced');
  var save = !!o.save;
  if (ev && ev.t === 'loss') {
    /* said as See it shows it: "You'd lose X." where their reply takes it,
       else after that reply */
    var lw = lostWords(a, ev.lost, ev.won), plain = ['You\'d lose ' + lw + '.'], after = rp ? ['After ' + rp + ', you\'d lose ' + lw + '.'] : [];
    cands = save ? [] : rm && rm.captured && ev.at === 1 ? plain.concat(after) : after.concat(plain);
    if (!save) fall = 'You\'d lose ' + lw + '.';
  } else if (ev) cands = eventForms(a, ev);
  /* a try that saves the attacked piece (R5.4: a miss at Normal and Less
     help): "Safe, but" the event, else where the game stands ("Safe, but
     Black is better now.", tier 3 at the key's depth "Safe, but only 34%
     for you.") */
  if (save) {
    /* (what their reply attacks is no reason here: the piece saved may be
       attacked again and still be safe, card 1's Qd7+ Rf7) */
    if (ev && /^(attacks|mateThreat)$/.test(ev.t)) cands = [];
    var ef = cands.filter(function (x) { return /^Then /.test(x) || /^Their pawn/.test(x) || /^After the trade/.test(x); }).map(function (x) { return 'Safe, but ' + lowFirst(x); });
    var sb = a.tier >= 3 && deep && win != null ? 'Safe, but only ' + Math.round(win) + '% for you.' : bw && win < 60 ? 'Safe, but ' + bw + ' now.' : 'Safe, but there\'s a stronger move.';
    /* (release 4: at More help too, "Safe, but ...": V1.9's "That saves
       your queen. Look for more." understated a try that was lost, the
       truth gate's 184330688628:85) */
    cands = ef.concat(cands, [sb]);
  } else if (!ev) {
    /* V2.1: "Most of your advantage is gone." only when the try loses half
       or more of the edge above 50% (the margin where the depth is not the
       key's), else "You are still better, but less so." */
    var mid = wBest != null ? (wBest + 50) / 2 - (deep ? 0 : BAND_MARGIN) : null;
    if (inLine) cands = ['Nothing lost, but there\'s a better move.'];
    else if (win >= 60 && bw) cands = [!t1 && mid != null && win <= mid ? 'Most of your advantage is gone.' : 'You are still better, but less so.'];
    else if (rp && bw) cands = ['After ' + rp + ', ' + bw + '.'];
  }
  /* the danger the card is about, still standing after the try and the
     reply See it plays (the coach's review, 184455333378:68: Bxc4 Qxc4, and
     the queen is still attacked): said first unless the event is a mate or
     a promotion, or the event or the reply takes as much; the step it failed
     is their move (1) */
  var still = !mateAny && !(ev && ev.t === 'promo') && !(c && c.mateAgainst) && !save ? stillAttacked(a, c) : null;
  var asMuch = function (p) { return !!p && MOTIF_VAL[p] >= MOTIF_VAL[pType(still.p)]; };
  if (still && !asMuch(ev && ev.p) && !asMuch(rm && rm.captured ? pType(rm.captured) : '')) {
    var sw = 'your ' + PIECE_WORD[pType(still.p)] + ' is still attacked.';
    cands = (t1 || !rs ? [] : [rs + ', and ' + sw]).concat([upFirst(sw)]).concat(cands);
  } else still = null;
  /* the guard: no form names the answer due now, as a whole move in SAN
     (Qxc5 is not c5) or in words */
  var dm = dueMove(a), due = capSan(a.st, dm), dueW = moveWords(a.st, dm);
  var names = function (x) { return String(x).split(/[\s.,:;]+/).some(function (t) { return t.replace(/[+#]$/, '') === due; }) || !!(dueW && x.indexOf(dueW) >= 0); };
  var lost = !!ev && (ev.t === 'take' || ev.t === 'loss') && !!(rm && rm.captured);
  var out = { cands: cands.filter(function (x) { return !names(x); }), fall: fall, ev: ev, pv: pv, save: save,
              u: rm ? moveUci(rm.move) : '', took: rm && rm.captured && !mate1 ? pType(rm.captured) : '', mate: mate1, lost: lost, rs: rs, d: 0 };
  /* (a step only where the try loses: never for nothing lost, or for what
     their reply only attacks, B6) */
  if (still) out.d = 1;
  else if (rm && ((ev && !/^(even|attacks|mateThreat)$/.test(ev.t)) || (c && c.mateAgainst))) out.d = dzStood(a.st, out.u, rm.captured) ? 1 : 3;
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
/* the game move again (M2): its reason from the card's own refutation and
   the score after it; a missed-chance card says only that there is more
   to find, since what the game move allowed is not that card's lesson */
function gameMoveWhy(a) {
  var b = a.it.b, r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  /* its line: the game move and the refutation, at the key's depth once
     the card has its fact sheet (V1.1) */
  /* (B6 c: the take-back its line avoids, as the key searched it) */
  var kg = factsOf(b), gb = kg && !kg.x && kg.gb && b.kp === FACTS_V ? { pv: unpackUci(kg.gb[3]), cp: kg.gb[1], mate: kg.gb[2] } : null;
  var o = { pv: [a.playedUci].concat(unpackUci(b.ru)), deep: !!kg && b.kp === FACTS_V, mate: b.ma != null ? b.ma : null, cp: b.ea != null ? b.ea : null, back: gb, wBest: b.wb };
  /* a missed chance says its line's decisive event where it has one (V2.2:
     the pawn race's Kxg6 lets the pawn queen), else that there is more to
     find */
  var w = missWhy(a, a.cls, b.wa, r1 ? sanOf(r1.before, r1.move) : null, false, r1 ? moveWords(r1.before, r1.move) : null, o);
  /* (B6's events that decide nothing, nothing lost or what their reply
     attacks, leave a missed chance's lesson where it is) */
  if (familyOf(patternOf(b)).key === 'chances' && (!w.ev || /^(loss|even|attacks|mateThreat)$/.test(w.ev.t))) return { cands: ['There\'s a stronger move here.'], fall: '', d: 2, chip: STEP_CHIP[2] };
  return w;
}

/* the verdict on a try that stays on the board (S4, S5, S11): row 1 in
   one to four words, row 2 from its ladder. A wrong try says why (why:
   missWhy's ladder; the band shows it once its reason beat comes), the game
   move again says so; a good move that is not the best says there is a
   stronger one, the second time row 1 alone; a move the engine could not
   check is not counted */
function triedVerdict(a, t, why, again) {
  /* a second good move says row 1 alone, but a saving move at More help
     says what it saved each time (V1.9) */
  /* V2.7: a second good move on the card keeps its row 2 */
  if (t.kind === 'close') return verdictOf('close', CARD_COPY.C1(), why && why.save ? [CARD_COPY.C3(why.save)] : [CARD_COPY.C2()], '');
  if (t.kind === 'unchecked') return verdictOf('unchecked', CARD_COPY.E1(), [CARD_COPY.E2()], '');
  why = why || { cands: [], fall: 'That helps ' + sidesOf(a).opp + '.' };
  /* in game mode the game move, tried before it was shown (its first graded
     try), is not "again" (F8.1) */
  var g1 = a.game && a.misses <= 1 && !a.foundGood;
  /* the game move again only on the card's own position: inside a forcing
     line the same squares are another move (V1.6) */
  return verdictOf('bad', t.uci === a.playedUci && !(a.sol && a.solIdx > 0) ? (g1 ? CARD_COPY.G3() : CARD_COPY.M2()) : CARD_COPY.M1(), why.cands, why.fall);
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
  /* where Hint 3 can follow (F9.2), "Hint 1 of 3", "Hint 2 of 3", "Hint 3 of 3" */
  var r = { row1: CARD_COPY[hintMax(a) === 3 ? (a.hints >= 3 ? 'H6' : a.hints >= 2 ? 'H5' : 'H4') : a.hints >= 2 ? 'H3' : 'H1'](), marks: marks };
  /* game mode (F8.1), on the card's first move: hint 1 the step's row-2
     form (F2.3), never a computed fact, which would name the answer or the
     game move (both tries' danger in its place, F1.3); hint 2 the danger on
     the board (hintMarks' dz, F1.1's words), else the circled piece */
  var gm = a.game && !(a.sol && a.solIdx > 0), sk = a.prac ? PSKILL_OF[a.it.skill] : null;
  /* Hint 3 (F9.2): what the red squares do, "Red squares lose your knight." */
  if (a.hints >= 3 && marks.reds.length) { cands = hint3Words(hint3Of(a)); fall = ''; }
  /* a practice position (F9.4, V3.2): hint 1 its board's danger where that
     is its skill (pracDanger), else the skill's question where it holds
     (pracAsk); hint 2 the circled piece from its facts (pracHint2: "Find a
     safe square." when every safe square is accepted, else V2.3's words) */
  else if (sk && a.hints >= 2) { cands = pracHint2(a); fall = ''; }
  else if (sk) { cands = marks.dz ? dangerWords(a, marks.dz) : [pracAsk(a)]; fall = pracAsk(a); }
  else if (gm && a.hints >= 2) { cands = marks.dz ? dangerWords(a, marks.dz) : hint2Words(a, due); fall = ''; }
  else if (gm) { row = checkRow(a); cands = marks.rep ? repeatedWords(a, marks.rep) : row.slice(0, 1); fall = row[0]; }
  /* hint 2 on the circled piece (V2.3): a safe square only where every
     safe square is an accepted move, else the one move that holds */
  else if (a.hints >= 2) { cands = hint2Words(a, due); fall = ''; }
  else if (a.sol && a.solIdx > 0) {
    var mine = kingSq(a.st.b, myPov(a.it));
    var inCheck = (a.phase === 'guess' || (a.phase === 'checking' && !a.checkSaid)) && !!a.st.w === myPov(a.it) && mine >= 0 && checkedKingSq(a.st) === mine;
    /* V2.1: "forcing" only where the move due takes, checks or promotes */
    var forcing = false;
    if (due && a.st.b[due.from]) {
      var dx = cloneState(a.st);
      applyMove(dx, due);
      forcing = !!(a.st.b[due.to] || due.ep >= 0 || due.promo || checkersOf(dx).length);
    }
    cands = [inCheck ? 'Your king is in check.' : forcing ? 'The next move is forcing too.' : 'Find the next move.'];
    fall = forcing ? 'The next move is forcing too.' : 'Find the next move.';
  } else {
    var fam = familyOf(patternOf(a.it.b)).key, c = a.cls, line = c.bestLine, mt = c.missed || {}, t1 = inWords(a);
    row = checkRow(a);
    /* (a win only where it leaves the player better, as V2.4's "wins": the
       pawn race's Kxf5 takes a pawn to hold a draw) */
    var win = !!line && !line.unsettled && c.matBest >= 1 && !(a.it.b.eb != null && winPct(a.it.b.eb) < 60), pw = win ? plainCapture(line, c.bSettle) : null, ic = win ? ledgerIcons(line, c.bSettle, 1, pw) : '';
    /* what the answer gets, in H2's words: a checkmate, or the material
       its line wins (a trade or two kinds of piece in the board's pieces) */
    var gets = forcedMate(a) ? ['There is a checkmate here.']
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
  /* the guard: no form names the answer due now, in SAN or in words; in
     game mode, nor the game move before it shows (a foil's, never) */
  var dueW = moveWords(a.st, due), hide = a.game && !ghostOn(a), gs = a.played ? [sanOf(a.pre, a.played), capSan(a.pre, a.played)] : [], gw = moveWords(a.pre, a.played);
  var names = function (x) {
    var ws = String(x || '').split(/[\s.,:]+/), low = String(x || '').toLowerCase();
    return ws.indexOf(dueSan) >= 0 || (!!dueW && low.indexOf(dueW) >= 0) || (hide && (ws.indexOf(gs[0]) >= 0 || ws.indexOf(gs[1]) >= 0 || (!!gw && low.indexOf(gw) >= 0)));
  };
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
  var P = function (p) { return PIECE_WORD[pType(p)]; }, t1 = inWords(a), gs = !a.played ? [] : t1 ? [upFirst(moveWords(a.pre, a.played)), 'That move'] : [sanOf(a.pre, a.played)];
  /* (each form's last rung fits five words: game mode's hint 2, beside "No
     more hints", F8.1) */
  if (dz.kind === 'check') return ['In check: move, block or take?', 'You are in check.'];
  if (dz.kind === 'mate') return [t1 ? 'They can mate you on ' + sqName(dz.mate.to) + '.' : 'They threaten mate: ' + dz.mate.san + '.'];
  /* game mode, its game move not shown (F8.1): the piece the better move
     keeps, in words; a foil with no danger on its board (F8.2) */
  if (dz.kind === 'watch') return ['Watch your ' + PIECE_WORD[dz.piece] + '.'];
  /* a foil's Hint 2 (V2.6): its threat ("Their threat: Rg5 wins your
     queen."), the only move ("Only one move holds here."), else that any
     good move passes ("No danger here." is gone) */
  if (dz.kind === 'none') return [CARD_COPY.O7()];
  if (dz.kind === 'only') return [CARD_COPY.O8()];
  if (dz.kind === 'threat') {
    /* (game mode's hint 2 leaves row 2 five words: the shorter rungs) */
    var ft = dz.t, fs = sanOf(ft.st, ft.m), fw = ft.wins ? PIECE_WORD[ft.wins] : ft.took ? PIECE_WORD[pType(ft.took)] : '';
    if (ft.m.promo && !ft.mate) return ['Their pawn can become a ' + PIECE_WORD[pType(ft.m.promo)] + '.', 'Their pawn can promote.'];
    return [threatWords(ft, a.tier)].filter(Boolean).concat(!ft.mate && fw && !t1 ? [fs + ' would ' + (ft.took ? 'take' : 'win') + ' your ' + fw + '.'] : [], fw ? ['Watch your ' + fw + '.'] : []);
  }
  /* V2.3: two threats on the card's position, their mate and a capture
     that already stood (the coach's review, 184268949378:16): "Two threats:
     mate on f2 and Bxc3+." (tier 1 "Stop the mate and guard your
     knight."); a hint never praises the game move */
  if (dz.kind === 'two') {
    var tp = PIECE_WORD[pType(dz.took)];
    /* (a hint's frame leaves row 2 six words: the spec's seven-word forms
       first, then six-word ones) */
    return t1 ? ['Stop the mate and guard your ' + tp + '.', 'Stop the mate, guard your ' + tp + '.', 'Watch your ' + tp + '.']
      : ['Two threats: mate on ' + sqName(dz.mate.to) + ' and ' + dz.san + '.', 'Two threats: ' + dz.mateSan + ' mate and ' + dz.san + '.', 'Watch your ' + tp + '.'];
  }
  /* their mate the game move stopped, and what it allows: the piece to
     watch (never the game move named as stopping it: no praise) */
  if (dz.kind === 'parried') return ['Watch your ' + (dz.reply.captured ? PIECE_WORD[dz.reply.captured] : 'king') + '.'];
  /* V2.3: a missed win, the piece the answer's line wins, ringed where it
     stands: "You can win their queen." (every tier) */
  if (dz.kind === 'win') return ['You can win their ' + PIECE_WORD[dz.p] + '.'];
  /* a piece the game line wins later: "Rxf3 lets them win your bishop."
     (tier 1, where the move in words does not fit, "That lets them win
     your bishop.", then "Watch your bishop.") */
  if (dz.kind === 'lost') return gs.slice(0, 1).map(function (g) { return g + ' lets them win your ' + PIECE_WORD[dz.piece] + '.'; }).concat(['That lets them win your ' + PIECE_WORD[dz.piece] + '.', 'Watch your ' + PIECE_WORD[dz.piece] + '.']);
  if (dz.kind === 'mine') return ['You have a mate in one.', 'You can mate in one.'];
  /* the hint's bar and row 1 leave row 2 six words: the shorter form then */
  if (dz.kind === 'loose') return ['Their ' + P(dz.loose.p) + ' on ' + sqName(dz.loose.sq) + ' has no guard.', 'Nothing guards their ' + P(dz.loose.p) + ' on ' + sqName(dz.loose.sq) + '.', 'Their ' + P(dz.loose.p) + ' has no guard.'];
  if (dz.kind === 'madeMate') return gs.map(function (g) { return g + ' lets them mate you.'; });
  /* (a hint's frame leaves row 2 six words: "That lets ..." then) */
  if (dz.kind === 'made') return gs.map(function (g) { return g + ' lets them take your ' + P(dz.named.p) + '.'; }).concat(['That lets them take your ' + P(dz.named.p) + '.', 'Watch your ' + P(dz.named.p) + '.']);
  var nm = dz.named, n = nm.by.length, by = a.pre.b[nm.by[0]], sec = dz.second;
  /* B4: never the pawn a bigger threat takes on its way */
  var bt = bigThreat(a, nm);
  if (bt) return [bigThreatWords(a, bt)];
  if (n >= 2) return ['Your ' + P(nm.p) + ' is attacked ' + timesWord(n) + '.'];
  if (MOTIF_VAL[pType(by)] < MOTIF_VAL[pType(nm.p)] || !sec) return ['Their ' + P(by) + ' attacks your ' + P(nm.p) + '.'];
  return pType(sec.p) === pType(nm.p) ? ['Two of your ' + P(nm.p) + 's are attacked.', 'Your ' + P(nm.p) + 's are attacked.']
    : ['Your ' + P(nm.p) + ' and ' + P(sec.p) + ' are attacked.', 'Your ' + P(nm.p) + ' is attacked.'];
}
/* Hint 2's words on the circled piece (the answer's), on the card's first
   move (V2.3 with the orchestrator's decision), from the key's moves of that
   piece (pm): "Find a safe square." where Hint 1 rang it as attacked and
   every safe square of it is an accepted move (one safe square, or several
   and all within 4 points of the best), so it never invites a rejected
   move; else "Only one queen move holds." (tier 1 "Only one queen move is
   best.", since V1.9 calls the other saving moves "Good move") where its next
   move is 10 or more points worse and a step lower on the card's scale;
   else "Move the circled piece." With no key, "Find a safe square." only
   where the static exchange leaves the piece one safe square, the answer's */
function hint2Words(a, due) {
  var move = CARD_COPY.H3b();
  if ((a.sol && a.solIdx > 0) || !due) return [move];
  var v = dangerView(a), p = a.st.b[due.from], pw = p ? PIECE_WORD[pType(p)] : 'piece';
  var attacked = !!v && v.attacked.some(function (x) { return x.sq === due.from; });
  var k = factsOf(a.it.b);
  if (k && !k.x && k.a === a.bestUci && k.pm && k.pm.length) {
    var pm = k.pm.filter(function (x) { return x[2] != null; });
    if (!pm.length) return [move];
    var w0 = Math.max.apply(null, pm.map(function (x) { return winPct(x[2]); }));
    var acc = function (x) { return x[2] != null && w0 - winPct(x[2]) <= SOLVE_TOL; };
    var safeOk = k.pm.filter(function (x) { return x[1] && acc(x); }).length;
    /* (and the answer's square safe by the exchange too: 184426845252:63's
       bxc5 is "kept" as an even trade, yet the pawn is taken there) */
    var ax = cloneState(a.st);
    applyMove(ax, due);
    var staticSafe = !(dzSee(ax.b, due.to, !myPov(a.it)) > 0);
    if (attacked && k.ps >= 1 && safeOk === k.ps && staticSafe) return [CARD_COPY.H3c(), move];
    var rest = pm.filter(function (x) { return x[0] !== k.a; }), w1 = rest.length ? winPct(rest[0][2]) : null;
    /* (beside "No more hints" a hint's row 2 has five words: tier 1's
       shorter rung then) */
    if ((k.pn || 0) >= 2 && w1 != null && w0 - w1 >= 10 && scaleStep(w1) < scaleStep(w0)) return a.tier === 1 ? ['Only one ' + pw + ' move is best.', 'One ' + pw + ' move is best.', move] : ['Only one ' + pw + ' move holds.', move];
    return [move];
  }
  if (!attacked) return [move];
  var them = !myPov(a.it), safe = legalMoves(a.st).filter(function (x) {
    if (x.from !== due.from) return false;
    var after = cloneState(a.st);
    applyMove(after, x);
    return !(dzSee(after.b, x.to, them) > 0);
  });
  return safe.length === 1 && safe[0].to === due.to ? [CARD_COPY.H3c(), move] : [move];
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
/* the card's step: its danger facts', else its family's; a foil's from its
   board (F8.2): their move while something stands in danger, else the
   safety check */
function cardStep(a) {
  if (a.foil) return foilDanger(a).kind === 'none' ? 3 : 1;
  /* a practice position's by its skill (F9.4): their move for a mate or a
     pawn to stop, the safety check for a piece to save, else your chances */
  if (a.prac) return { stopmate: 1, pawns: 1, safety: 3 }[a.it.skill] || 2;
  var v = dangerView(a);
  return (v && v.step) || familyStep(familyOf(patternOf(a.it.b)).key);
}
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
  var f = checkFact(a, s);
  return f && !progVal(f) ? f : lineOfStep(s, t);
}
/* tier 3's computed line, '' when none is true: their threat, the one the
   game move left standing (standingThreat), "Their threat: Rxf5 takes your
   queen."; the chance missed, "Nxc2 wins the bishop. Ne2 missed it."; the
   only move (F1.4, "Only move" alone), else what the better move saves or
   keeps, "Qe6 saves your queen. Rg1 lost it." */
function checkFact(a, s) {
  /* B5: on a keyed card their threats as Details names them (the key's th) */
  if (s === 1) { var kf = factsOf(a.it.b); if (kf && !kf.x && kf.th) return threatsLine(a); var t = standingThreat(a); return t ? threatWords(t, 3) : ''; }
  var cmp = buildCompare(a), bs = cmp.betterSan, g = cmp.gameSan;
  if (s === 2) {
    if (familyOf(patternOf(a.it.b)).key !== 'chances') return '';
    /* the mate and the reason are the card's answer's, said of it (never of
       a move of the player's own that worked mid-line: the pawn race's Kg5
       after Kxf5 does not stop the pawn) */
    var ans = a.best ? sanOf(a.pre, a.best) : bs;
    if (forcedMate(a)) return ans + ' leads to checkmate. ' + g + ' missed it.';
    /* V2.4: the answer's one reason where its fact sheet has one (the pawn
       race's Kxf5 stops the pawn, it does not win it); a band reason says
       no chance missed here */
    var wo = whyOf(a);
    /* B4 (C5 (c)): "X wins Y. Z missed it." sets the two moves side by
       side, so what it names must be most of what they differ by: no mate
       on either line, their scores 2 pawns or less beyond it */
    var sw = swingOf(a.it.b);
    /* a reason whose fact does not hold has no words (whyPred null: a
       "wins" whose settled line nets nothing, 184434540700:103), so the
       step's own line stands, never a program value */
    if (wo) {
      var wp = wo.r !== 'band' ? whyPred(a) : null, named = wo.r === 'wins' ? wo.n || 0 : wo.r === 'saves' ? MOTIF_VAL[wo.p] : null;
      if (named != null && sw > named + 2) return '';
      return wp ? ans + wp + '. ' + g + ' missed it.' : '';
    }
    return cmp.w2 && !/material/.test(cmp.w2) && sw <= (a.cls.matBest || 0) + 2 ? bs + ' wins ' + cmp.w2 + '. ' + g + ' missed it.' : '';
  }
  if (cmp.only && /^Only move/.test(cmp.only)) return cmp.only;
  /* the answer's own reason where it is a mate, a stop or the mate it
     avoids (B4: never the pawn a bigger threat would take first) */
  var wr = whyOf(a);
  if (wr && /^(mate|stops|avoids)$/.test(wr.r) && !a.alt && !a.near) return sanOf(a.pre, a.best) + whyPred(a) + '. ' + g + ' missed it.';
  if (a.alt || a.near || !cmp.saves.length) return '';
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
  if (th && th.stands) { var tm = uciToMove(nst, th.uci); return tm ? { st: nst, m: tm, took: th.took, mate: th.mate, gain: th.n } : null; }
  /* (B5: beside their mate nothing else is a threat, none coming within 5
     points of it; a mate the game move stopped leaves none to name) */
  if (th && th.mate) return null;
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
  var san = capSan(t.st, t.m), their = 'their ' + PIECE_WORD[pType(t.st.b[t.m.from])];
  /* a forced mate in more than one (V1.5's threats keep its length) is no
     mate on that square */
  if (t.mate) return 'Their threat: ' + (tier === 1 ? (t.mate === 1 ? 'checkmate on ' + sqName(t.m.to) : moveWords(t.st, t.m) + ', with checkmate to follow') : san + (t.mate === 1 ? ' is checkmate' : ', with mate to follow')) + '.';
  /* a quiet threat names the piece its settled line wins where that is
     known (a foil's, V2.6: "Their threat: Rg5 wins your queen."), else what
     its settled gain is (V2.1: only a gain that stands, V1.5's rule) */
  if (!t.took && t.wins) return 'Their threat: ' + (tier === 1 ? their : sanOf(t.st, t.m)) + ' wins your ' + PIECE_WORD[t.wins] + '.';
  if (!t.took) return tier === 1 || !(t.gain >= 1) ? '' : 'Their threat: ' + sanOf(t.st, t.m) + ' wins material.';
  return 'Their threat: ' + (tier === 1 ? their : sanOf(t.st, t.m)) + ' takes your ' + PIECE_WORD[pType(t.took)] + '.';
}
/* ── Details in the card face's words (V2.5) ──────────────────────────────
   At tier 1 Details holds no notation: each move of a classifier sentence
   in words, as the card face says it (the moves of the game line, the
   better line and the game's own moves, on their own boards), a move that
   takes as its piece ("their rook takes your pawn"), the opponent's
   "Black's" as "their"; moves one after another joined by commas. At tiers
   2 and 3 a sentence's figures are labelled: "Your chances: 49% before,
   35% after." in place of "(49% to 35%)" */
function wordsMap(a) {
  var map = {}, add = function (st, m) {
    if (!st || !m || !st.b[m.from]) return;
    var sn = sanOf(st, m), x = { w: moveWords(st, m), p: pType(st.b[m.from]), mine: !!st.w === myPov(a.it) };
    map[sn] = x; map[sn.replace(/[+#]$/, '')] = x;
  };
  add(a.pre, a.played); add(a.pre, a.best);
  [a.cls && a.cls.gameLine, a.cls && a.cls.bestLine].forEach(function (l) { (l ? l.nodes : []).forEach(function (n) { if (n.move) add(n.before, n.move); }); });
  if (a.lines) ['game', 'best', 'refute'].forEach(function (k) { var L = a.lines[k]; if (L) L.moves.forEach(function (m, i) { add(i ? L.states[i - 1] : a.pre, m); }); });
  return map;
}
var SAN_TOKEN = '(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?';
function detailsWords(a, s) { return wordsWith(a, s, wordsMap(a)); }
/* a sentence in SAN said in words (tier 1, V2.5), each move by map (SAN to
   {w, p, mine}); o.left is set where a move is not in the map */
function wordsWith(a, s, map, o) {
  var opp = sidesOf(a).opp, re = new RegExp('(^|[\\s(,:;])(' + SAN_TOKEN + ')(?=[\\s.,:;)!?]|$)', 'g');
  /* a move already in words stays as it is */
  var kept = [], keep = function (x) { kept.push(x); return '\u0001' + (kept.length - 1) + '\u0002'; };
  s = String(s || '').replace(MOVE_PHRASE, keep);
  /* and a square is a square: "the pawn on c3", "the c7 pawn" (never "the
     pawn on pawn to c3" where some line also plays c3) */
  s = s.replace(/\bon [a-h][1-8]\b|\bthe [a-h][1-8] (?=pawn\b)/g, keep);
  s = s.replace(new RegExp('\\b' + opp + '\'s\\b', 'g'), 'their');
  /* a move that takes, or that is strong, said as its piece */
  s = s.replace(new RegExp('(^|[\\s(,:;])(' + SAN_TOKEN + ')(?= (?:takes|is strong|could take|forks))', 'g'), function (all, pre, san) {
    var x = map[san];
    return x ? pre + (x.mine ? 'your ' : 'their ') + PIECE_WORD[x.p] : all;
  });
  s = s.replace(re, function (all, pre, san) { var x = map[san]; if (!x && o) o.left = true; return x ? pre + x.w : all; });
  /* moves one after another: "pawn takes on d4, knight to e6" */
  var two = new RegExp('(' + MOVE_PHRASE.source + ') (?=' + MOVE_PHRASE.source + ')', 'gi');
  s = s.replace(/\u0001(\d+)\u0002/g, function (x, i) { return kept[+i]; });
  s = s.replace(two, '$1, ');
  return upFirst(s);
}
function labelFigures(s) {
  return String(s || '').replace(/ \((\d+)% to (\d+)%\)\.?/, function (all, b, c) { return '. Your chances: ' + b + '% before, ' + c + '% after.'; }).replace(/\.\./g, '.');
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
  /* the learned moment's words (release 3, F3), in row 1's place */
  if (!b.cap && learnedNow(a)) b.row1 = a.tier === 1 ? YOURS_T1 : YOURS;
  /* the step track at the tag row's right (release 3, step-tracker.md) */
  if (!b.cap) b.tk = cardTrack(a);
  /* a study keeps its tag on its answered frames too (release 4: its find
     has the found sound and pop, and still moves no step) */
  if (!b.cap && studying() && a.phase === 'done' && !a.explore && !b.tag && !b.chip) b.tag = CARD_COPY.S1();
  return bandFit(a, b);
}
var YOURS = 'Learned! This one is yours.', YOURS_T1 = 'You learned this one!';
/* row 1 of a find with help (release 4): "Found with a hint" where a hint
   was pressed (no miss, no slip in a forcing line), else "You got there" */
function heldRow1(a) {
  var pressed = (a.hints || 0) - (a.predraw ? 1 : 0) - (a.autoH || 0);
  return a.result === 'hint' && pressed > 0 && !preMisses(a) && !a.slips && !a.lineHeld ? CARD_COPY.R8() : CARD_COPY.R2();
}
/* row 2 from its ladder: the row's own caps, then, over the word budget,
   the words that are left (and a note that still does not fit is dropped) */
function bandFit(a, b) {
  if (b.cands) {
    b.row2 = fitRow(b.cands, 'row2', b.fall);
    var room = rowRoom(a, b);
    /* a step chip (F1.2) or the context line (F4.2) goes first when the
       frame has no room for it: the task and the reason are never cut for it */
    if (b.stepChip && wordsIn(b.row2) > room) { b.chip = ''; room = rowRoom(a, b); }
    /* a practice position's source line goes before its tag (F9.4) */
    if (b.src && wordsIn(b.row2) > room) { b.src = ''; room = rowRoom(a, b); }
    /* a study's tag (release 3 slice G) stays on its opening frame: the
       task takes its shorter form ("Find a better move.", a game-mode
       card's "Move 23") instead */
    if (b.tag && b.tag === CARD_COPY.S1() && (b.row1 === CARD_COPY.T1() || b.row1 === CARD_COPY.F3()) && a.phase === 'guess' && !a.attempts && !a.hints && wordsIn(b.row2) > room) {
      var r2 = fitRow(b.cands.concat([a.game ? 'Move ' + (Math.floor(a.it.b.p / 2) + 1) : 'Find a better move.']), { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
      if (r2 && wordsIn(r2) <= room) b.row2 = r2;
    }
    if (b.tag && wordsIn(b.row2) > room) { b.tag = ''; b.src = ''; room = rowRoom(a, b); }
    if (wordsIn(b.row2) > room) b.row2 = fitRow(b.cands, { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
    /* a ladder step that would say something untrue (R4's found form) */
    if (b.never && b.never.indexOf(b.row2) >= 0) b.row2 = fitRow([], { ch: ROW_CAPS.row2.ch, words: Math.max(0, room) }, b.fall);
    /* the figures' label goes with the figures (V2.5) */
    if (b.figChip && !/\d%/.test(b.row2)) b.chip = '';
  }
  /* the track's "Last step" counts its two words: where they do not fit
     beside the reason, the pill goes and the seal ring pulses once instead */
  if (b.tk && b.tk.pill && wordsIn(b.row2) + wordsIn(b.cap) + 2 > rowRoom(a, b)) { b.tk.pill = false; b.tk.o.pulse = true; }
  /* release 4: the track's short note on a find that did not climb ("Climbs
     on Thu", "Alone climbs") counts its words too; where they do not fit
     beside the reason the note goes, and the track's own name and the live
     region still say why */
  if (b.tk && b.tk.note && wordsIn(b.row2) + wordsIn(b.cap) + wordsIn(b.tk.note) > rowRoom(a, b)) b.tk.note = '';
  delete b.cands; delete b.fall; delete b.never; delete b.budget; delete b.stepChip; delete b.figChip;
  return b;
}
/* V2.5: the label a tier 3 settled frame's figures wear */
var FIG_CHIP = 'Your chances';
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
  if (a.own && a.yours) {
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
  var v = a.alt || a.near ? null : dangerView(a);
  a.compare = {
    found: !!(gm[1] && ru[0] && gm[1] === ru[0]), replied: !!gm[1], betterSan: better, gameSan: gameSan(a),
    betterWords: betterW, gameWords: moveWords(a.pre, a.played),
    w: lc ? lc.w : '', wn: lc ? lc.wn : '', k: lc ? lc.k : -1, wi: lc ? lc.ic : '',
    w2: gain >= 1 && line ? gw || oneWord(null, gain) : '', w2n: gain >= 1 ? oneWord(gw, gain) : '', w2i: gain >= 1 && line ? ledgerIcons(line, settle, at, gw) : '',
    guard: guardRule(c.gameLine, a.played, bn) && guardMeans(c, a.pre, a.played, bn),
    saves: v && lc && savesFit(it.b, v.saves) ? v.saves : [],
    /* tier 3's figures, read once, so a second line that lands later never
       changes words on screen */
    only: a.tier >= 3 && !a.alt && !a.near ? onlyMoveLine(a) : '', figs: a.tier >= 3 && !a.alt && !a.near ? figuresLine(a) : ''
  };
  return a.compare;
}
/* what the answer and the game move differ by, in pawns, from the record's
   scores (the player's side; a record kept with win chances alone reads
   them from those); 99 where either line mates or no score is kept */
function swingOf(b) {
  if (b.mb != null || b.ma != null) return 99;
  var eb = b.eb != null ? b.eb : b.wb != null ? cpFromWin(b.wb) : null, ea = b.ea != null ? b.ea : b.wa != null ? cpFromWin(b.wa) : null;
  return eb == null || ea == null ? 99 : (eb - ea) / 100;
}
/* B4 (C5 (c)): what the better move keeps ("Rc4 keeps your pawn.") is
   named only where it is most of what the two moves differ by: their
   scores apart by no more than 2 pawns beyond the pieces named (the first
   two), and neither line a mate. b: the record (eb, ea from the player's
   side), saves: piece letters */
function savesFit(b, saves) {
  if (!saves || !saves.length) return false;
  var named = saves.slice(0, 2).reduce(function (s, p) { return s + MOTIF_VAL[p]; }, 0);
  return swingOf(b) <= named + 2;
}
/* the scale the card's words use (X3): winning, better, even, their
   better, their winning */
function scaleStep(w) { return w >= 80 ? 4 : w >= 60 ? 3 : w >= 40 ? 2 : w >= 20 ? 1 : 0; }
/* F1.4, V1.4 at tier 3, from the card's own search (its fact sheet's
   three lines): "Only move: Qe6 48%. Next best 34%." when the next best move
   is 10 or more points worse, a step lower on that scale, and either at 40%
   or less or the best at 80% or more (D11 with master's guard; the 25% rule
   is gone); "Best: Qe6 48%. Next best 37%." when only the first two hold;
   '' otherwise, or with no second line kept. A best line that forces mate
   says so, never a percentage: "Only move: Kb2 forces mate." when it is the
   only move, else "Kb2 forces mate." */
function onlyMoveLine(a) {
  var b = a.it.b, k = factsOf(b);
  if (k && !k.x && k.fm) return (k.om ? 'Only move: ' : '') + sanOf(a.pre, a.best) + ' forces mate.';
  if (b.g2 == null || b.wb == null || !(b.g2 >= 10) || scaleStep(b.wb - b.g2) >= scaleStep(b.wb)) return '';
  var nb = Math.round(b.wb - b.g2);
  return (nb <= 40 || b.wb >= 80 ? 'Only move: ' : 'Best: ') + sanOf(a.pre, a.best) + ' ' + Math.round(b.wb) + '%. Next best ' + nb + '%.';
}
/* the better move's winning chances and the game move's: "Qe6 49%. Your
   Rg1 6%." */
function figuresLine(a) {
  var b = a.it.b;
  return b.wb == null || b.wa == null ? '' : sanOf(a.pre, a.best) + ' ' + Math.round(b.wb) + '%. Your ' + sanOf(a.pre, a.played) + ' ' + Math.round(b.wa) + '%.';
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
/* the settled row 2 a card's own play decides, before R4 ({cands, fall}
   or null): a move in the found band (V1.2), "Just as good as the main
   answer." at tier 1, "Kb7 is as good as Rxa7." at tiers 2 and 3, said
   only where its depth was the key's or the re-check's (else the main move
   named, which compares nothing); a move that works too, "The main move was
   Rxa7." (tier 1 in words); a forcing line whose first move was found and
   a later one missed or shown (V1.6), "First move found, a later one
   missed." at tier 1, "Nxc7+ found. Nxa8 missed later." */
/* the main move where your own move left the line: the card's answer, or
   inside a forcing line the line's move at that step ({st, m}) */
function mainAt(a) {
  var at = (a.yours && a.yours.at) || 0, st = cloneState(a.pre);
  if (!at || !a.sol || at >= a.sol.length) return { st: a.pre, m: a.best };
  for (var i = 0; i < at; i++) { var mv = uciToMove(st, a.sol[i]); if (!mv) return { st: a.pre, m: a.best }; applyMove(st, mv); }
  var m = uciToMove(st, a.sol[at]);
  return m ? { st: st, m: m } : { st: a.pre, m: a.best };
}
function ownRow(a) {
  var t1 = inWords(a), mm = mainAt(a), main = interleave(t1 ? [CARD_COPY.R6(moveWords(mm.st, mm.m))] : [], [CARD_COPY.R6(sanOf(mm.st, mm.m))]);
  /* B2: a try that forces mate was the answer: its own mate row (tier 1:
     "checkmate" only for a mate within 3 moves, else the band) */
  if (a.mateTry) {
    var mt = a.mateTry;
    return { cands: t1 ? [upFirst(mt.w) + (mt.n <= 3 ? ' forces checkmate.' : ' keeps you winning.')] : [mt.san + ' forces mate.'], fall: '' };
  }
  if (a.near) {
    /* release 4: a move of the near band, the best named as a little
       better only where the depth was the key's or the re-check's */
    if (a.near.band === 'good') return { cands: a.near.deep ? interleave(t1 ? [CARD_COPY.R10(upFirst(moveWords(mm.st, mm.m)))] : [], [CARD_COPY.R10(sanOf(mm.st, mm.m))]) : main, fall: '' };
    if (!a.near.deep) return { cands: main, fall: '' };
    /* B7: at tier 1 a move as good as the answer says what it does itself,
       from its own line ("Queen to f3 guards f2 and your knight."), never
       "Just as good as the main answer." */
    if (t1) {
      var aw = altForms(a, a.yours && a.yours.uci[0]);
      /* (with no line of its own to read, where it keeps the game) */
      return { cands: aw || [upFirst(a.near.w) + whyPredOf(a, { r: 'band', w: a.near.win }, a.pre, null, null) + '.'], fall: '' };
    }
    return { cands: [CARD_COPY.R7(a.near.san, sanOf(a.pre, a.best))], fall: '' };
  }
  if (a.alt) return { cands: main, fall: '' };
  if ((a.slips || a.lineHeld) && a.sol && a.sol.length) {
    var f = uciToMove(a.pre, a.sol[0]);
    return { cands: t1 || !a.slipSan || !f ? [CARD_COPY.L1()] : [CARD_COPY.L2(sanOf(a.pre, f), a.slipSan), CARD_COPY.L1()], fall: '' };
  }
  /* B3: a forcing line found, with a good move that was not the line's on
     the way: "Nxc7+ found. Nxa8 was stronger later." */
  if (a.lineGood && a.sol && a.sol.length) {
    var f2 = uciToMove(a.pre, a.sol[0]);
    return { cands: t1 || !a.lineGood.san || !f2 ? [CARD_COPY.L3()] : [CARD_COPY.L4(sanOf(a.pre, f2), a.lineGood.san), CARD_COPY.L3()], fall: '' };
  }
  return null;
}
/* the best line forces mate (V1.4): the settled row says so, and no
   material claim shows anywhere on the card. "King to b2 forces
   checkmate." at tier 1, "Kb2 forces mate." at tier 2, at tier 3 "Only
   move: Kb2 forces mate." when it is the only move. null when it does not */
function forcedMate(a) {
  var k = factsOf(a.it.b);
  return !!(a.cls && a.cls.mateFor) || !!(k && !k.x && k.fm);
}
function mateRow(a) {
  var k = factsOf(a.it.b);
  if (!k || k.x || !k.fm || a.alt || a.near || a.mateTry) return null;
  var san = sanOf(a.pre, a.best);
  /* B7: at tier 1 "checkmate" only for a mate See why plays within 3
     moves; a longer one says the band (whyOf) */
  if (inWords(a)) return k.fm <= 3 ? interleave([upFirst(moveWords(a.pre, a.best)) + ' forces checkmate.'], [san + ' forces mate.']) : null;
  return a.tier >= 3 && k.om ? ['Only move: ' + san + ' forces mate.', san + ' forces mate.'] : [san + ' forces mate.'];
}
/* R4, the settled caption (S6), as row 2's ladder {cands, fall}: by the
   card's family, what the game move did against what the better move does.
   Each form also comes with its material as one word ("a rook"), the
   ladder's second step; the mistake alone, then the first sentence and the
   fallback come after */
function r4Of(a) {
  var fm = mateRow(a);
  if (fm) return { cands: fm, fall: fm[fm.length - 1], never: [] };
  /* V2.4: the answer's one reason, from its fact sheet */
  var wf = whyForms(a);
  if (wf) return { cands: wf, fall: wf[wf.length - 1], never: [] };
  var s = r4Forms(a, inWords(a)), sv = savesForms(a);
  return sv ? { cands: sv.concat(s.cands), fall: s.fall, never: s.never } : s;
}
/* ── what the found move does (V2.4) ─────────────────────────────────────
   One reason per answer, the fact sheet's why (V1.1, V2.4's order), read
   alike by the settled row 2, See why's better move and Details: saves,
   guards (one piece, or the mate square and a piece), stops (the mate, the
   threat, their pawn), traps, wins (what its settled line nets), blocks the
   check, attacks a piece, else where it keeps the game (the figure at tier
   3). The reason as a predicate, " guards your knight", or null with no
   current key for the card's own answer (a move that works too, or in the
   found band, keeps its own row) */
/* the reason in force: the key's why, but a check stops every threat for
   one move, so a "stops" reason on a checking answer gives way to what its
   line does (184359604942:24's Nxc7+ wins a rook, it does not stop Bxd1) */
function whyOf(a) {
  var k = factsOf(a.it.b);
  if (!k || k.x || k.a !== a.bestUci || !k.why || a.alt || a.near || a.mateTry) return null;
  var w = k.why, pov = myPov(a.it);
  /* "wins" only as far as the answer's score shows it (0.6 of a pawn for
     each one claimed): 184234373418:11's Nh6 line takes a bishop, the score
     says a pawn (a deeper look keeps the bishop) */
  if (w.r === 'wins' && !k.fm && k.l[0][2] == null && k.l[0][1] < 60 * (w.n || 1)) w = { r: 'band', w: winPct(k.l[0][1]) };
  if (w.r === 'stops' && w.t === 'threat') {
    var x = cloneState(a.pre);
    applyMove(x, a.best);
    if (checkersOf(x).length) {
      var kn = k.sb && k.sb.a !== 0 ? (pov ? k.sb.w - k.sb.b : k.sb.b - k.sb.w) : 0;
      w = kn >= 1 && winPct(k.l[0][1]) >= 60 ? { r: 'wins', n: kn } : { r: 'band', w: winPct(k.l[0][1]) };
    }
  }
  /* B2, B7: at tier 1 "checkmate" only for a mate within 3 moves; a
     longer one is the band ("Rook to g1 keeps you winning.") */
  if (w.r === 'mate' && inWords(a) && w.n > 3) w = { r: 'band', w: 100, mate: 1 };
  return w;
}
function whyPred(a) { return whyPredOf(a, whyOf(a), a.pre, unpackUci(a.it.b.lu), a.it.b.eb); }
/* a reason w as a predicate for the move it is about, on position st: its
   line (pv, the move first) and score (cp, the player's side) for "wins" */
function whyPredOf(a, w, st, pv, cp) {
  if (!w) return null;
  var t1 = inWords(a), PW = function (p) { return PIECE_WORD[pType(p)]; }, pov = myPov(a.it);
  var join = function (xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  var sym = function (ps, white) { return ps.map(function (p) { return LEDGER[white ? p : p.toLowerCase()]; }).join(''); };
  if (w.r === 'mate') return t1 ? ' forces checkmate' : ' forces mate';
  if (w.r === 'saves') return ' saves your ' + PW(w.p);
  if (w.r === 'guards') {
    var sqs = [], ps = [];
    (w.ps || []).forEach(function (p, i) { if (p === 'mate') sqs.push(w.sqs[i]); else ps.push(PW(p)); });
    return ' guards ' + join(sqs.concat(ps.length ? ['your ' + join(ps)] : []));
  }
  if (w.r === 'stops') {
    if (w.t === 'mate') return ' stops the mate';
    if (w.t === 'pawn') return ' stops their pawn';
    var nst = dzNullState(st), tm = uciToMove(nst, w.m);
    /* B4, tier 1: a check said as one ("Pawn to g6 stops their bishop check.") */
    if (t1 && tm) { var tx = cloneState(nst); applyMove(tx, tm); if (checkersOf(tx).length) return ' stops their ' + PIECE_WORD[pType(nst.b[tm.from])] + ' check'; }
    return tm && !t1 ? ' stops ' + sanOf(nst, tm) : ' stops their threat';
  }
  if (w.r === 'traps') return ' traps their ' + PW(w.p);
  if (w.r === 'wins') {
    var line = pv || [], ns = lineNodes(st, line), s = settleLine(st, line, null, cp != null ? (pov ? cp : -cp) : null), won = netLostOf(ns, s.k, !pov), gave = netLostOf(ns, s.k, pov);
    var byV = function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; };
    won.sort(byV); gave.sort(byV);
    /* (a line that, read here, wins no piece says where it keeps the game:
       never a reason with no words in it; one up by a promotion, "wins
       material" at tiers 2 and 3, as its count agrees with the score:
       184434540700:103's b3 trades rooks and queens a pawn) */
    if (!won.length) {
      var up = pov ? s.w - s.b : s.b - s.w;
      if (!t1 && up >= 1 && s.agree !== false && ns.slice(0, s.k).some(function (x) { return x.byW === pov && !!x.m.promo; })) return ' wins material';
      return whyPredOf(a, { r: 'band', w: winPct(cp != null ? cp : 0) }, st, pv, cp);
    }
    /* a trade in the board's pieces ("wins ♛ for ♜"), else the pieces won */
    if (gave.length) return ' wins ' + sym(won, !pov) + ' for ' + sym(gave, pov);
    return ' wins ' + (won.length === 1 ? 'a ' + PW(won[0]) : won.length === 2 && won[0] === won[1] ? 'two ' + PW(won[0]) + 's' : sym(won, !pov));
  }
  if (w.r === 'blocks') return ' blocks the check';
  if (w.r === 'attacks') return ' attacks their ' + PW(w.p);
  /* B7: the game move allowed their mate, the answer does not ("Rxf5
     avoids the mate Be3 allowed."; "allowed" only where that mate was not
     there before the game move) */
  if (w.r === 'avoids') {
    var nm = dzNullState(st), mm = uciToMove(nm, w.m), before = false;
    if (mm) { var mx = cloneState(nm); applyMove(mx, mm); before = isMate(mx); }
    return t1 ? ' avoids their mate' : ' avoids the mate' + (before ? '' : ' ' + sanOf(a.pre, a.played) + ' allowed');
  }
  /* B7: the answer's line gives material and the player stays better */
  if (w.r === 'gives') return ' gives ' + sym((w.lost || '').split(''), pov) + ' for ' + sym((w.won || '').split(''), !pov) + ', still better';
  var bw = w.mate ? ' keeps you winning' : w.w >= 60 ? ' keeps you better' : w.w >= 40 ? ' keeps the game level' : ' limits the damage';
  return a.tier >= 3 && !w.mate ? bw + ': ' + Math.round(w.w) + '%' : bw;
}
/* B7: a move as good as the answer, its own reason from its own line (the
   key's line for it, else the line your move was graded on): the key's
   rules (factsWhy) on that line. {w, pv, cp} or null */
function altWhyOf(a, u) {
  var k = factsOf(a.it.b), m = u ? uciToMove(a.pre, u) : null;
  if (!k || k.x || !m) return null;
  var l = (k.l || []).filter(function (x) { return x[0] === u; })[0], pv, cp, mate;
  if (l) { pv = unpackUci(l[3]); cp = l[1]; mate = l[2]; }
  else if (a.yours && a.yours.uci[a.yours.at || 0] === u && !(a.yours.at > 0)) { pv = a.yours.uci; cp = a.yours.cp; mate = a.near ? a.near.mate : null; }
  else return null;
  var pov = myPov(a.it);
  var ka = { a: u, l: [[u, cp, mate, packUci(pv)]], th: k.th, g: k.g, fm: mate != null && mate > 0 ? mate : 0, sb: settleRec(settleLine(a.pre, pv, pov, pov ? cp : -cp)) };
  var w = factsWhy(a.pre, ka, pov, pv);
  /* (it "saves" the piece only where nothing takes it on its line, a trade
     neither: 184216981622:42's Ne3 Bxe3 fxe3 says where it keeps the game) */
  if (w.r === 'saves' && !pieceSurvives(a.pre, pv, m.from, true)) w = { r: 'band', w: winPct(cp) };
  return { w: w, pv: pv, cp: cp };
}
/* its row 2 forms: "Queen to f3 guards f2 and your knight." (tier 1 in
   words), null with no reason to say */
function altForms(a, u) {
  var x = altWhyOf(a, u), m = u ? uciToMove(a.pre, u) : null;
  if (!x || !m) return null;
  var w = x.w;
  if (w.r === 'mate' && inWords(a) && w.n > 3) w = { r: 'band', w: 100, mate: 1 };
  var pr = whyPredOf(a, w, a.pre, x.pv, x.cp);
  if (pr == null) return null;
  if (w.r === 'gives' && inWords(a)) return ['You give ' + pr.slice(7).replace(', still better', '') + ' but stay better.'];
  return [(inWords(a) ? upFirst(moveWords(a.pre, m)) : sanOf(a.pre, m)) + pr + '.'];
}
/* the settled row 2's forms from the reason: "Pawn to f5 guards your
   knight." (tier 1, which never names the game move), "Qe6 saves your queen.
   Rg1 lost it." where the game move lost that piece (tiers 2 and 3), "Be3
   traps their queen."; at tier 3 the only-move line first where it is true
   (V1.4). Release 2 (B7): with the only move, tier 3 says the only-move
   line alone on every settled frame; a saving reason a rejected try of this
   showing met too says the only-move line where there is one (tier 1
   "Queen to e6 was the only good move.", tier 2 "Qe6 is the only move that
   holds."), else "Qd7+ saved it too. Qe6 holds better." (tier 1 "Queen to
   e6 is even better."); a line that gives material says so ("Rxf5 gives ♗
   for ♙, still better.", tier 1 "You give ♗ for ♙ but stay better.").
   null with no reason */
function whyForms(a) {
  var pr = whyPred(a);
  if (pr == null) return null;
  var t1 = inWords(a), bs = t1 ? upFirst(moveWords(a.pre, a.best)) : sanOf(a.pre, a.best), out = [], k = factsOf(a.it.b);
  var only = a.tier >= 3 ? buildCompare(a).only : '';
  if (only && /^Only move/.test(only)) {
    if (k && k.om) return [only];
    out.push(only);
  }
  var w = whyOf(a);
  if (w.r === 'saves' && a.savedBy && a.savedBy.p === w.p) {
    if (k && k.om) return t1 ? [bs + ' was the only good move.'] : [bs + ' is the only move that holds.'];
    return t1 ? [bs + ' is even better.'] : [a.savedBy.san + ' saved it too. ' + bs + ' holds better.', bs + ' holds better.'];
  }
  if (w.r === 'gives' && t1) return out.concat(['You give ' + pr.slice(7).replace(', still better', '') + ' but stay better.']);
  if (!t1 && w.r === 'saves') {
    var cmp = buildCompare(a);
    if (cmp.saves.indexOf(w.p) >= 0) out.push(bs + pr + '. ' + cmp.gameSan + (cmp.found ? ' lost' : ' could lose') + ' it.');
  }
  out.push(bs + pr + '.');
  return out;
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
  if (a.alt || a.near || familyOf(patternOf(a.it.b)).key === 'chances') return null;
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
   review, 184268949378:16: Qxf2 mate and Bxc3). B5: the reply only as a
   threat the key's search kept, which beside their mate it never is (no
   move comes within 5 points of a mate), so none is said */
function twoThreats(a) {
  var v = dangerView(a), th = v && v.searched ? v.threat : null, r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  if (!th || th.mate !== 1 || th.stands || !r1 || !r1.move || !r1.captured || moveUci(r1.move) === th.uci) return null;
  if (!dzStood(a.pre, moveUci(r1.move), r1.captured)) return null;
  var k = factsOf(a.it.b), u1 = moveUci(r1.move);
  if (!k || k.x || !(k.th || []).some(function (t) { return t[0].slice(0, 4) === u1.slice(0, 4); })) return null;
  var nst = dzNullState(a.pre);
  return { mate: uciToMove(nst, th.uci), reply: r1, nst: nst };
}
/* the better move guards both: "Qf3 guards f2 and your knight." (tier 1 in
   words), only when the piece it moves attacks the mating square and the
   piece the reply would take once it is played */
function guardsForm(a) {
  if (a.alt || a.near) return null;
  var tt = twoThreats(a);
  if (!tt || !tt.mate) return null;
  var after = cloneState(a.pre);
  applyMove(after, a.best);
  var hits = attacksFrom(after.b, a.best.to), cap = tt.reply.move.ep >= 0 ? tt.reply.move.ep : tt.reply.move.to;
  if (hits.indexOf(tt.mate.to) < 0 || hits.indexOf(cap) < 0 || after.b[cap] !== a.pre.b[cap]) return null;
  var tail = ' guards ' + sqName(tt.mate.to) + ' and your ' + PIECE_WORD[pType(tt.reply.captured)] + '.';
  return inWords(a) ? [upFirst(moveWords(a.pre, a.best)) + tail] : [sanOf(a.pre, a.best) + tail];
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
  } else {
    /* V2.2: your game's line runs to where it settles (the settle rule, 8
       plies at most), so a fork after a take-back is on screen */
    var gs = settleLine(a.pre, [a.playedUci].concat(unpackUci(it.b.ru)));
    gEnd = Math.max(gEnd, Math.min(gs.k, 8) - 1);
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
    could = k === 1 && !cmp0.found && cmp0.replied && (!!c.mateAgainst || c.lossG >= 1) && missedReally(a);
    gEnd = could ? 1 : k - 1;
    break;
  }
  /* the danger frame first (F1.5): the card's own position, still */
  var df = dangerFrame(a);
  if (df) steps.push({ seg: 'danger', line: gl, k: 0, from: 0, df: df });
  for (k = 0; k <= gEnd; k++) steps.push({ seg: 'game', line: gl, k: k, from: 0 });
  var bl = c.bestLine || buildLine(a.pre, '0000', a.lines.best.uci, pov), from = 1, bEnd = Math.max(1, c.bSettle || 0), alt = null;
  if (a.own && a.yours) {
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
  /* V2.4: with the answer's reason known, the better move says it on its
     own step (tiers 1 and 2: the step alone, but where the reason is what
     its line wins); at tier 3 its line plays to where it settles (4 to 6
     plies, so the last caption fits) and ends on the figure */
  /* (B7: at tier 1 a forced mate longer than 3 moves is told by its band
     reason, on the better move's own step) */
  var kf = factsOf(it.b), longMate = inWords(a) && !!kf && !kf.x && kf.fm > 3;
  var wp = !alt && (!c.mateFor || longMate) && !same && bl === c.bestLine ? whyPred(a) : null, fig = false;
  /* release 3 (both sides): at every help level the answer's line from its
     fact sheet plays to where it settles (sb), 2 to 6 plies past the better
     move, ending on a move of yours; the whole line where it mates within
     that (at tier 1 only a mate within 3 moves is played to the mate, the
     3-move rule for naming checkmate). Tier 3 ends on the figure */
  var keyed = !alt && !same && !!kf && !kf.x && kf.a === a.bestUci && from === 1 && (bl === c.bestLine || !!c.mateFor);
  if (keyed) {
    var mEnd = mateAt(bl);
    if (mEnd >= 1 && mEnd - from <= 6 && (!inWords(a) || kf.fm <= 3)) { bEnd = mEnd; whole = true; }
    else {
      var lastN = bl.nodes.length - 1;
      bEnd = Math.min(Math.max(kf.sb ? from + kf.sb.k - 1 : bEnd, from + 2), from + 6, lastN);
      /* a move of theirs: on to your next move where the window has it, else back to yours */
      if (bEnd > from && bl.nodes[bEnd].byWhite !== pov && !isMate(bl.nodes[bEnd].after)) bEnd = bEnd + 1 <= Math.min(from + 6, lastN) ? bEnd + 1 : bEnd - 1;
      whole = !!isMate(bl.nodes[bEnd].after);
    }
    fig = a.tier >= 3 && wp != null && bEnd > from;
  }
  else if (wp != null) {
    if (a.tier >= 3) {
      bEnd = Math.min(Math.max(kf.sb ? kf.sb.k : bEnd, 4), from + 5, bl.nodes.length - 1);
      /* never on their capture: back to the move before it */
      while (bEnd > from + 1 && bl.nodes[bEnd].captured && colorW(bl.nodes[bEnd].captured) === pov) bEnd--;
      whole = true; fig = bEnd > from;
    }
    else if (whyOf(a).r !== 'wins') { bEnd = from; whole = true; }
  }
  bEnd = betterEnd(bl, from, bEnd, pov, whole);
  /* nor on a bare move of theirs: a quiet move or a check of
     theirs where the line has nothing true to claim goes, back to your move
     before it (never before the better move itself) */
  while (!whole && bEnd > from && bl.nodes[bEnd].byWhite !== pov && !bl.nodes[bEnd].captured && !isMate(bl.nodes[bEnd].after) && !betterClaim(a, bl, bEnd, from)) bEnd--;
  for (k = from; k <= bEnd; k++) steps.push({ seg: 'better', line: bl, k: k, from: from });
  var S = a.story = { steps: steps, g: gEnd + 1 + (df ? 1 : 0), could: could, real: realSeg, threat: threat, guard: null, alt: !!alt,
                      mateG: isMate(gl.nodes[gEnd].after), mateB: isMate(bl.nodes[bEnd].after), danger: !!df, why: wp, fig: fig, keyed: keyed };
  /* the guard dots and words of B1: the better move's own square guarded
     once it is played, the game move's not (the guard rule, read as R4 reads
     it), by a piece of yours that guards it directly */
  var bn = bl.nodes[from];
  if (!S.alt && from === 1 && buildCompare(a).guard) {
    var mine = colorW(bn.after.b[bn.move.to]), by = attackersOf(bn.after.b, bn.move.to, mine).sort(function (x, y) { return MOTIF_VAL[pType(bn.after.b[x])] - MOTIF_VAL[pType(bn.after.b[y])]; })[0];
    if (by != null) S.guard = { from: by, to: bn.move.to, piece: pType(bn.after.b[by]) };
  }
  steps.forEach(function (s, i) { s.cap = s.df ? s.df.cap : storyCaption(a, S, i); });
  /* release 3: the strip names the better segment "Why it works" where it
     has room (unfolded, and every caption leaves the strip's four words and
     the bar's three within the frame's 15), else "Better" */
  S.wiw = !S.alt && steps.length <= 9 && steps.every(function (s) { return wordsIn(s.cap) <= 8; });
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
    /* (the capture's red ring where the search confirms it: B5) */
    var csOk = v.attacked.some(function (x) { return x.sq === cs; });
    return { rings: [{ sq: tt.mate.to, kind: 'attacked', mate: true }].concat(csOk ? [{ sq: cs, kind: 'attacked' }] : []),
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
  /* B4: the piece attacked is a pawn their threat takes on the way to more
     (184435538450:47's Bxg7+): the threat is named, never the pawn */
  var big = pk ? bigThreat(a, pk.named) : null;
  if (big) return { rings: [{ sq: big.to, kind: 'attacked' }], arrows: [{ from: big.from, to: big.to, kind: 'threat', key: 'danger' }], cap: bigThreatWords(a, big) };
  if (pk && (v.step === 1 || v.saves.indexOf(pType(pk.named.p)) >= 0)) {
    var nm = pk.named, sec = pk.second, n1 = nm.by.length, n2 = sec ? sec.by.length : 0, last = a.preLast, cands = [];
    var made = !!last && nm.by.some(function (f) { return f === last[1] || strictlyBetween(f, nm.sq, last[0]); });
    if (made) {
      var lastSan = (a.it.g.mv.split(' ')[a.it.b.p - 1] || '').replace(/[+#]$/, '');
      var same = !!sec && pType(sec.p) === pType(nm.p), both = same ? 'your ' + P(nm.p) + 's on ' + sqName(nm.sq) + ' and ' + sqName(sec.sq) + ' are attacked' : '';
      if (t1) cands.push(same ? 'Their last move attacks your ' + P(nm.p) + 's on ' + sqName(nm.sq) + ' and ' + sqName(sec.sq) + '.' : 'Their last move attacks your ' + P(nm.p) + (n1 >= 2 ? ' ' + timesWord(n1) : '') + '.');
      /* V2.7: two pieces of one kind by their squares, never "pawn attacked
         once, pawn once" */
      else if (lastSan && same) cands.push('After ' + lastSan + ': ' + both + '.');
      else if (lastSan && (n1 >= 2 || sec)) cands.push('After ' + lastSan + ': ' + P(nm.p) + ' attacked ' + timesWord(n1) + (sec ? ', ' + P(sec.p) + ' ' + timesWord(n2) : '') + '.');
      else if (lastSan) cands.push('After ' + lastSan + ': their ' + P(a.pre.b[nm.by[0]]) + ' attacks your ' + P(nm.p) + '.');
    }
    if (sec && pType(sec.p) === pType(nm.p)) cands.push('Your ' + P(nm.p) + 's on ' + sqName(nm.sq) + ' and ' + sqName(sec.sq) + ' are attacked.', 'Two of your ' + P(nm.p) + 's are attacked.');
    else if (sec && n1 === 1 && n2 === 1) cands.push('Your ' + P(nm.p) + ' and ' + P(sec.p) + ' are attacked.');
    else if (sec) cands.push('Your ' + P(nm.p) + ' is attacked ' + timesWord(n1) + ', your ' + P(sec.p) + ' ' + timesWord(n2) + '.');
    cands.push(n1 >= 2 ? 'Your ' + P(nm.p) + ' is attacked ' + timesWord(n1) + '.' : 'Their ' + P(a.pre.b[nm.by[0]]) + ' attacks your ' + P(nm.p) + '.');
    /* (B5: red rings and their arrows only where a search confirmed the
       captures) */
    return { rings: v.searched ? pk.rings : [], arrows: v.searched ? pk.arrows.map(function (x) { return { from: x.from, to: x.to, kind: 'threat', key: 'danger' }; }) : [], cap: fitRow(cands, 'caption', '') };
  }
  var pz = v.step === 2 ? hintPrize(a) : null;
  if (pz && isHangingAt(a.pre.b, pz.sq)) return { rings: [{ sq: pz.sq, kind: 'target' }], arrows: [], cap: 'Their ' + P(pz.p) + ' on ' + sqName(pz.sq) + ' has no guard.' };
  return null;
}
/* B4: their threat (the danger facts', a search's) takes the piece named,
   and wins 2 or more beyond it where its line settles: {from, to, uci, n,
   took} or null */
function bigThreat(a, named) {
  var v = dangerView(a), th = v && v.searched ? v.threat : null;
  if (!th || th.mate || !named || th.to !== named.sq || !th.took || !(th.n >= MOTIF_VAL[pType(named.p)] + 2)) return null;
  return th;
}
/* "They threaten Bxg7+." (tier 1 "Their bishop can take on g7 with
   check.") */
function bigThreatWords(a, th) {
  var nst = dzNullState(a.pre), m = uciToMove(nst, th.uci), x = cloneState(nst);
  if (!m) return '';
  applyMove(x, m);
  return inWords(a) ? 'Their ' + PIECE_WORD[pType(nst.b[m.from])] + ' can take on ' + sqName(m.to) + (checkersOf(x).length ? ' with check.' : '.') : 'They threaten ' + sanOf(nst, m) + '.';
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
/* V2.1: their reply missed a blow only where what they played was worse for
   them by 8 points or more than their best (the game's own series after
   their move against the score after the game move; the series is the
   scan's shallower reading, hence 8 for the rule's 5); unknown: not said */
function missedReally(a) {
  var w = wpAt(a.it.g, a.it.b.p + 1);
  return w != null && a.it.b.wa != null && w >= a.it.b.wa + 8;
}
/* V2.2: the fork a line's ply makes, as See why names it at its step:
   "Qxc3+ forks your rook and bishop." (in words "Their queen forks your
   rook and bishop."); '' with none */
function forkSay(a, n, w) {
  if (!n || !n.move) return '';
  var f = forkAt({ before: n.before, after: n.after, m: n.move, byW: n.byWhite });
  if (!f || f.targets.length < 2) return '';
  var mine = n.byWhite === myPov(a.it), t = f.targets, whose = mine ? 'their ' : 'your ';
  var tw = t[0] === t[1] ? 'both ' + whose + PIECE_WORD[t[0]] + 's' : whose + PIECE_WORD[t[0]] + ' and ' + PIECE_WORD[t[1]];
  return (w ? (mine ? 'Your ' : 'Their ') + PIECE_WORD[pType(n.before.b[n.move.from])] : sanOf(n.before, n.move)) + ' forks ' + tw + '.';
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
    /* (B8: SAN keeps its check sign: "Qg6+, your game move.") */
    var g = w ? upFirst(moveWords(a.pre, a.played)) : sanOf(a.pre, a.played), t = S.threat, n1 = s.line.nodes[1];
    var tm = t ? (w ? t.words : t.san.replace(/[+#]$/, '')) : '';
    fall = g + ', your game move.';
    /* the piece the better move saves, left in danger by the game move (the
       reviews: Rg1 leaves the queen attacked; the bishop it loses, Qe6
       loses too) */
    var sa = c.stalemate || (c.mateAgainst && S.mateG) ? null : stillAfterGame(a);
    if (sa) cands.push(g + '. Your ' + PIECE_WORD[pType(sa.p)] + ' is still attacked' + (sa.n >= 2 ? ' ' + timesWord(sa.n) : '') + '.');
    if (c.stalemate) cands.push(g + '. ' + sd.opp + ' has no move: a draw.');
    /* (B4: "Now" only where they had no mate in one before the game move) */
    else if (c.mateAgainst && S.mateG) { if (!mateInOne(dzNullState(a.pre))) cands.push(g + '. Now ' + sd.opp + ' can checkmate.'); }
    else if (t) {
      var th = t.th;
      if (th && th.captured) {
        var cap = PIECE_WORD[th.captured];
        if (!isDefended(n1.before.b, th.to)) cands.push(g + '. Nothing guards the ' + cap + ' on ' + sqName(th.to) + '.');
        else if (MOTIF_VAL[th.piece] < MOTIF_VAL[th.captured]) cands.push(g + '. Their ' + PIECE_WORD[th.piece] + ' can take your ' + cap + '.');
      }
      /* B4: "Now X" only where X was not there before the game move */
      var was = stoodBefore(a, n1);
      if (!cands.length && t.motif === 'fork' && !was) cands.push(g + '. Now ' + tm + ' hits two pieces.');
      if (!cands.length && th && th.check && !was) cands.push(g + '. Now ' + tm + ' is check.');
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
       their reply is the move played: nothing to have missed there; nor
       where what they played was about as good (V2.1) */
    var missed = s.k === 1 && !found && !S.real && cmp0.replied && (!!c.mateAgainst || c.lossG >= 1) && missedReally(a);
    var heads = says, ck = checkersOf(n.after).length ? ' with check' : '';
    /* V2.2: a fork the motif code finds on this ply is named: "Qxc3+ forks
       your rook and bishop." */
    var fk = forkSay(a, n, w);
    if (fk && !isMate(n.after)) heads = [fk].concat(heads);
    /* a check is on the board, "as in your game" is context: the check is
       kept first when both do not fit (final fixes 4) */
    if (found && n.captured && !isMate(n.after)) {
      var pw = PIECE_WORD[pType(n.captured)];
      heads = (ck ? [who + ' takes your ' + pw + ck + ', as in your game.', say] : []).concat([who + ' takes your ' + pw + ', as in your game.']).concat(says);
    } else if (found) heads = [say + ' As in your game.', say, say0 + ' As in your game.'].concat(says);
    else if (missed) {
      /* the move they could have played, said as one (never "takes"): with
         its check first, then "They missed it." */
      /* (never the pawn it takes where its line wins more, B4, nor where the
         two moves' scores differ by more than 2 pawns beyond it: C5 (c)) */
      var big = !!n.captured && (c.lossG >= MOTIF_VAL[pType(n.captured)] + 2 || swingOf(a.it.b) > MOTIF_VAL[pType(n.captured)] + 2);
      var cp = n.captured && !big ? who + ' could take your ' + PIECE_WORD[pType(n.captured)] : null;
      var cw = isMate(n.after) ? [Mv + ' would be checkmate'] : cp ? (ck ? [cp + ck, cp] : [cp]) : ck && !big ? [who + ' could give check'] : ['They could play ' + san.replace(/[+#]$/, '')];
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
  /* the story's end on a forced mate says so (V1.4), never material */
  var mr = lastB && !S.alt && !S.mateB ? mateRow(a) : null;
  if (mr) cands = cands.concat(mr);
  /* V2.4 at tier 3: the line's last step, to where it settles, ends on the
     answer's figure: "Qe6 b5 axb5 cxd3+ Rxd3: 50%." */
  var cmp0b = buildCompare(a);
  if (lastB && S.fig && s.k > s.from) {
    /* (with the only move, V1.4's line, which carries the figure too) */
    if (cmp0b.only && /^Only move/.test(cmp0b.only)) return { cands: [cmp0b.only], fall: '' };
    var fl = [];
    for (var fi = s.from; fi <= s.k; fi++) fl.push(sanOf(s.line.nodes[fi].before, s.line.nodes[fi].move));
    return { cands: [fl.join(' ') + ': ' + Math.round(a.it.b.wb) + '%.'], fall: '' };
  }
  if (s.k === s.from) {
    var bs = san;
    fall = 'Better: ' + bs + '.';
    /* V2.4: the answer's one reason, as the settled row and Details say it:
       "Better: f5. It guards your knight." (never a bare "Better: d5.") */
    /* (B4, C5 (c): beside the game move "It wins ..." is worth what the two
       moves differ by: never where the game line mates, nor where their
       scores are apart by more than 2 pawns beyond its count) */
    if (S.why != null && !S.alt) {
      var wr = whyOf(a);
      var under = !!wr && wr.r === 'wins' && swingOf(a.it.b) > (wr.n || 0) + 2;
      return { cands: [under ? fall : fall + ' It' + S.why + '.'], fall: fall };
    }
    if (keep) cands.push(w ? fall + ' Your ' + keep + ' is safe' + (pType(n.before.b[n.move.from]) === cmp.saves[0] ? ' there.' : '.') : 'Better: ' + bs + ' ' + savesVerb(a) + ' your ' + keep + '.');
    /* a move in the found band (V1.2) is the answer's equal, said only
       where its depth was the key's or the re-check's */
    /* (B7: at tier 1 the move's own reason, never "Just as good as the
       main answer.") */
    var awp = S.alt && a.near && a.near.deep && w ? altWhyOf(a, a.yours && a.yours.uci[0]) : null, awq = awp ? whyPredOf(a, awp.w.r === 'mate' && awp.w.n > 3 ? { r: 'band', w: 100, mate: 1 } : awp.w, a.pre, awp.pv, awp.cp) : null;
    if (S.alt && a.near) cands.push(a.near.deep ? (w ? 'Your move: ' + bs + '.' + (awq ? ' It' + awq + '.' : '') : a.near.band === 'good' ? CARD_COPY.R10(sanOf(a.pre, a.best)) : CARD_COPY.R7(bs, sanOf(a.pre, a.best))) : 'Your move: ' + bs + '.');
    else if (S.alt && a.alt) cands.push('Your ' + bs + ' works too.');
    /* later in a forcing line, a step in the found band (V1.6) */
    else if (S.alt) cands.push('Your move: ' + bs + '.');
    else if (c.mateFor && S.mateB) cands.push(fall + ' It leads to checkmate.');
    /* V1.4: a forced mate the line does not reach on screen says so, and
       never what it wins on the way */
    else if (forcedMate(a)) cands.push(fall + (w ? ' It forces checkmate.' : ' It forces mate.'));
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
    else if (net < 0 && -net < lost && cmp.w && loseLess(a, S)) cands.push(Mv + ' still comes. You lose less.');
    else if (n.captured && colorW(n.captured) === pov) cands.push(who + ' still takes your ' + PIECE_WORD[pType(n.captured)] + '.');
    return { cands: cands, fall: fall };
  }
  /* release 3: their reply in the answer's line says what they must do
     where the board proves it: their only legal move ("Kf3 is their only
     move."), else a quiet move out of check ("They play Kf3 out of check.") */
  if (S.keyed && n.byWhite !== pov && !n.captured && !isMate(n.after)) {
    var nLegal = legalMoves(n.before).length;
    if (nLegal === 1) says = [Mv + ' is their only move.'].concat(says);
    else if (checkersOf(n.before).length) says = ['They play ' + san.replace(/[+#]$/, '') + ' out of check.'].concat(says);
  }
  /* V2.2: a fork the motif code finds on this ply is named */
  var fk2 = forkSay(a, n, w);
  if (fk2 && !isMate(n.after)) says = [fk2].concat(says);
  /* what it nets where it ends, only where that count stands (settledAt) */
  var stands = lastB && !isMate(n.after) && settledAt(s.line, s.k) && !forcedMate(a);
  var won = stands ? storyGain(s.line, s.k, s.from, gain) : null;
  /* release 3: the answer's line ends on what you keep: the piece it saves
     or guards, still yours and safe where the line ends; else, for a reason
     that is where it keeps the game, that reason again ("King to b2 keeps
     you winning.", as a forced mate's end says "Kb2 forces mate.") */
  var safeP = lastB && S.keyed && !isMate(n.after) && !(won && !namesIt(n, won.w)) ? keptSafe(a, s.line, s.k, s.from) : '';
  var wEnd = lastB && S.keyed && !S.fig && !won && !safeP && !mr ? whyOf(a) : null;
  if (safeP) says.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' Your ' + safeP + ' is safe.'); });
  if (wEnd && wEnd.r === 'band') { var wf = whyForms(a); if (wf) cands.push(wf[wf.length - 1]); }
  if (won && !namesIt(n, won.w)) says.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' You win ' + won.w + '.'); if (won.wn !== won.w) cands.push(h + ' You win ' + won.wn + '.'); });
  /* a better line that still loses material where it ends says so only when
     it loses less than the game did (a loss the card claims); one that
     loses nothing after a game move that lost something says so (and what
     it saves, F1.4); otherwise its ply alone */
  else if (stands && cmp.w && gain < 0 && -gain < c.lossG && loseLess(a, S)) says.concat([Mv + '.']).forEach(function (h) { cands.push(h + ' You lose less.'); });
  else if (lastB && betterClaim(a, s.line, s.k, s.from) === 'none') says.concat([Mv + '.']).forEach(function (h) { if (keep) cands.push(h + ' Your ' + keep + ' is safe.'); cands.push(h + ' Nothing is lost.'); });
  return { cands: cands.concat(says), fall: fall };
}
/* B2: "You lose less." only where the line's own deep score leaves the
   player under 60%, and never on a line the player mates (184364964898:69:
   Rg1+ Nxg1 Qxg1+ ... gives a rook on the way to mate) */
function loseLess(a, S) {
  var b = a.it.b, y = S.alt && a.yours ? a.yours : null, alt = a.near || a.alt || a.mateTry;
  var mate = y ? alt && (alt.mate != null ? alt.mate : alt.n) : b.mb, cp = y ? y.cp : b.eb;
  if (mate != null && mate > 0) return false;
  return cp != null && winPct(cp) < 60;
}
/* B4: their reply n1 (a node of the game line) was there before the game
   move: the same piece makes the same move on the card's position with
   them to move, and gives check there too */
function stoodBefore(a, n1) {
  if (!n1 || !n1.move) return false;
  var nst = dzNullState(a.pre), m = uciToMove(nst, moveUci(n1.move));
  if (!m || nst.b[m.from] !== n1.before.b[n1.move.from]) return false;
  var x = cloneState(nst);
  applyMove(x, m);
  return checkersOf(x).length > 0 || !checkersOf(n1.after).length;
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
/* release 3: the piece the answer saves or guards (the card's saved piece,
   else its reason's), named where the answer's line ends (node k, from
   node `from`) only where every piece of that kind you had is still yours
   and none can be won there: each unattacked, or guarded at least as often
   as it is attacked with no cheaper attacker. Its word, or '' */
function keptSafe(a, line, k, from) {
  var n = line.nodes[k], pov = myPov(a.it), w = whyOf(a), cmp = buildCompare(a), t = cmp.saves.length ? cmp.saves[0] : '';
  if (!t && w && w.r === 'saves') t = pType(w.p);
  if (!t && w && w.r === 'guards') t = ((w.ps || []).filter(function (p) { return p !== 'mate'; })[0] || '');
  if (!t || !n || !n.after) return '';
  t = pType(t);
  var mine = function (b) { var q = []; for (var i = 0; i < 64; i++) if (b[i] && colorW(b[i]) === pov && pType(b[i]) === t) q.push(i); return q; };
  var at = mine(n.after.b);
  if (!at.length || at.length < mine(line.nodes[from].before.b).length) return '';
  var safe = at.every(function (sq) {
    var hit = attackersOf(n.after.b, sq, !pov);
    if (!hit.length) return true;
    var low = hit.some(function (f) { return MOTIF_VAL[pType(n.after.b[f])] < MOTIF_VAL[t]; });
    return !low && t !== 'K' && attackersOf(n.after.b, sq, pov).length >= hit.length;
  });
  return safe ? PIECE_WORD[t] : '';
}
/* the story's strip (S12): "Game ●●● Better ●", the step on screen larger;
   over 9 dots, "Game 2/5 · Better". Its words count in the budget */
function storyStripWords(a) {
  var S = buildStory(a);
  return S.steps.length > 9 ? 3 : S.wiw ? 4 : 2;
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
  if (ss && a.phase === 'tried' && a.tried && a.tried.kind === 'miss') bw = Math.max(barWords(triedSlots(a, false)), barWords(triedSlots(a, true, false)), barWords(triedSlots(a, true, true)));
  return (b.budget || WORD_BUDGET) - bandWords({ row1: b.row1, chip: b.chip, tag: b.tag, src: b.src }, []) - bw - stripWords(a);
}
/* what the card is showing, so a word or an outline meant for one state
   never outlives it: a move (each one counted, so coming back to the same
   phase is still a change), a try seen, a hint, a step */
function cardStateKey(a) {
  var t = a.tried;
  var v = a.view;
  return [a.phase, a.fxn || 0, t ? t.uci + (t.seen ? '+' : '') : '', a.hints, a.solIdx, v ? (v.mode === 'story' ? 'story:' + v.i : v.mode) : '', a.explore ? 'x' : '', a.guess ? 'g' : ''].join('|');
}
function bandOf(a) {
  var t = a.tried, v = a.verdict;
  /* a lesson's frame (F9.3): its caption and the "Lesson" tag */
  if (a.phase === 'lesson') return lessonBand(a);
  /* every game-mode card wears the neutral "Review" tag until its answer
     (F8.1), a practice position "Practice" (F9.4), where its frame has
     room: a step chip goes before it */
  var tag = studying() ? CARD_COPY.S1() : a.game ? CARD_COPY.G1() : a.prac ? CARD_COPY.P1() : '';
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
    /* V2.5: a step whose caption shows the figure is labelled */
    return { disc: gm ? 'king' : a.revealed ? 'info' : 'good', kind: gm ? 'sgame' : 'sbetter', cap: sp.cap, chip: a.tier >= 3 && /\d%/.test(sp.cap || '') ? FIG_CHIP : '' };
  }
  if (a.phase === 'done') {
    /* row 2: R4 once the result has settled (S0 at V+850, and the story
       that follows it); before that the answer shown says how to play it
       (V2), and a solve says nothing more yet */
    var mode = a.view && a.view.mode, said = !mode || (mode === 's0' && a.settle >= 2);
    /* a foil (F8.2): a find (release 4: "Found it", "You got there" after
       a miss, "Found with a hint"), then what its game move was: good
       too ("Qxa2 was good in your game too." where it was played again),
       fine too, or it kept more; after a miss or the answer shown "Your
       game move Nf3 was fine here." (the move as row 1 and the label write
       it, its check too) */
    if (a.foil) {
      var fm = gameSan(a), fok = a.foilKind !== 'playable';
      /* V2.6: the only move, played as in the game: "Found it" and "The
         only move, as in your game."; the answer shown: "Your game move Ra1
         was good too." (the game move itself shown: "You played Ra1 in your
         game too.") */
      var fonly = fok && !!a.it.b.om && a.foilGame && !a.misses && !a.revealed;
      var fend = a.revealed ? (a.bestUci === a.playedUci ? CARD_COPY.O6(fm) : CARD_COPY.O10(fm)) : a.misses ? CARD_COPY.O5(fm) : fonly ? CARD_COPY.O9() : !fok ? CARD_COPY.O4(fm) : a.foilGame ? CARD_COPY.O11(fm) : CARD_COPY.O3(fm);
      if (a.revealed) return { disc: 'info', kind: 'info', row1: answerRow(a, said), cands: said ? [fend] : arrowSaid(a), fall: '' };
      return { disc: 'good', kind: 'good', row1: a.misses ? CARD_COPY.R2() : a.hints ? CARD_COPY.R8() : CARD_COPY.R1(), cands: said ? [fend] : [], fall: '' };
    }
    /* a practice position (F9.4): "Found it" for every accepted move (each
       holds the skill's claim), else the answer shown; once settled, what
       the move does (pracSaid: "That wins their bishop."), a lesson's own
       position "Now find it in your games." Its tag stays with the task:
       answered, the tag row is the strip's place on a phone, and Details
       says where it is from */
    if (a.prac) {
      var ps = said ? pracSaid(a) : '';
      if (a.revealed) return { disc: 'info', kind: 'info', row1: answerRow(a, said), cands: said ? (ps ? [ps] : []) : arrowSaid(a), fall: '' };
      return { disc: 'good', kind: 'good', row1: a.result === 'first' ? CARD_COPY.R1() : CARD_COPY.R2(), cands: ps ? [ps] : [], fall: '' };
    }
    var own = said ? ownRow(a) : null, r4 = said ? own || r4Of(a) : null;
    /* V2.5: a tier 3 settled row with figures carries "Your chances" (kept
       only where the row fitted shows a figure) */
    var fig = !!r4 && a.tier >= 3 && r4.cands.some(function (x) { return /\d%/.test(x); });
    /* settled, a reveal names the card's own answer, the move R4 is about
       (inside a forcing line the band named each move as it came) */
    if (a.revealed) {
      /* B7: a move of the shown answer's found band played by hand
         (playNear) is the move on the board: the panel names it, with its
         own reason (card 4's Qf3 after Show the answer, "Qf3 guards f2 and
         your knight.", never Qd2's reason over it) */
      var nm = r4 && a.shownNear ? uciToMove(a.pre, a.shownNear) : null;
      if (nm) {
        var nw = inWords(a) ? moveWords(a.pre, nm) : '';
        return { disc: 'info', kind: 'info', row1: nw && fitsRow(CARD_COPY.V1(a, nw), 'row1') ? CARD_COPY.V1(a, nw) : inWords(a) ? CARD_COPY.V3() : CARD_COPY.V1(a, sanOf(a.pre, nm)),
                 cands: altForms(a, a.shownNear) || [], fall: '', never: null, chip: '', figChip: false };
      }
      return { disc: 'info', kind: 'info', row1: answerRow(a, r4), cands: r4 ? r4.cands : arrowSaid(a), fall: r4 ? r4.fall : '', never: r4 ? r4.never : null, chip: fig ? FIG_CHIP : '', figChip: fig };
    }
    return { disc: 'good', kind: 'good', row1: a.result === 'first' ? CARD_COPY.R1() : heldRow1(a),
             cands: r4 ? r4.cands : [], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null, chip: fig ? FIG_CHIP : '', figChip: fig };
  }
  /* V2.7: "Play the green arrow." only while the green arrow is drawn: once
     Play it has played it, the words leave with it */
function arrowSaid(a) { return showDue(a) && !a.showWait ? [CARD_COPY.V2()] : []; }
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
    return { disc: 'checking', kind: 'neutral', sweep: true, row1: fitRow(inWords(a) ? [a.checkingW ? CARD_COPY.K1(a, true) : '', 'Checking your move…'] : [CARD_COPY.K1(a)], 'row1', 'Checking…'), cands: a.checkSaid >= 2 ? [CARD_COPY.K2()] : [], fall: '', tag: tag };
  if (a.phase === 'tried' && t) {
    /* a miss's reason waits for its own beat (S4, a.reason 2): the verdict
       alone first */
    var tv = v || triedVerdict(a, t, null, false), wait = t.kind === 'miss' && (a.reason || 0) < 2;
    /* the check step it failed comes with the reason, at tiers 2 and 3 (F1.2) */
    return { disc: t.kind === 'miss' ? 'bad' : t.kind, kind: t.kind === 'miss' ? 'bad' : t.kind === 'unchecked' ? 'info' : 'close',
             row1: tv.row1, cands: wait ? [] : tv.cands, fall: wait ? '' : tv.fall, chip: wait ? '' : t.chip || '', stepChip: !!t.chip, tag: tag };
  }
  /* a move of the forcing line found (S10): right, and their reply comes;
     at tier 3 after the first move, the question until the reply's words
     (F10.1: a guess, or Their reply to skip it), in game mode beside its
     Review tag (F8.1) */
  if (a.phase === 'reply') return { disc: 'good', kind: 'good', row1: CARD_COPY.F1(), cands: [a.guessOn ? CARD_COPY.Q2() : CARD_COPY.F2(a)], fall: '', budget: LINE_BUDGET, tag: tag };
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
    /* B8: a card that opens on its drawn Hint 1 (the worked example, S9)
       keeps its task in row 1, the hint's words beside it */
    var opening = a.predraw && a.hints === 1 && !a.attempts && !a.hintAfter;
    return { disc: 'king', kind: 'hint', row1: opening ? CARD_COPY.T7() : h.row1, cands: h.cands, fall: h.fall, tag: tag };
  }
  /* their reply has landed: your move, and what it did (F4) */
  if (mid) return { disc: 'king', kind: 'neutral', row1: CARD_COPY.F3(), cands: a.replySaid ? a.replySaid.slice() : [], fall: 'The next move is forcing too.', budget: LINE_BUDGET, tag: tag };
  /* game mode (F8.1): "Your move" with the move and the clock, nothing
     that says a mistake is here; once its game move shows (a graded try),
     the task names it beside its faded piece (a foil's never shows) */
  if (a.game) return { disc: 'king', kind: 'neutral', row1: CARD_COPY.F3(), cands: [ghostOn(a) ? CARD_COPY.T2(a) : gameRow(a)], fall: '', tag: tag };
  /* a practice position (F9.4): your turn, and its skill's task ("Find the
     free piece."); no game move to name. Before its first move, its source
     beside the tag ("Lesson position", "Another player's game") */
  if (a.prac) return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), cands: [PSKILL_OF[a.it.skill].task], fall: '', tag: tag, src: pracSrcOn(a) ? pracSrc(a) : '' };
  /* tier 1 names the game move in words, else says no move (F1.6); a
     decisive first sight names the game it decided in the tag row (F4.2) */
  return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), cands: inWords(a) ? [CARD_COPY.T2(a, true), 'Find a better move.'] : [CARD_COPY.T2(a)], fall: '', chip: ss_relearn(a) ? CARD_COPY.T3() : '', tag: studying() ? CARD_COPY.S1() : ctxLine(a) };
}
/* the context line (F4.2): on a decisive first sight, the game it decided,
   "Lost vs opponent1" ("Drew vs opponent1" for a draw) within its own cap
   of 22 characters (the opponent's name one word), else "Lost the game"
   ("Drew the game"); '' on any other card. On a player's first three cards
   it yields to the teaching board label its frame can show (a kind of mark
   that teaches itself, such as "Your game move": asked as if nothing had
   taught itself yet, so the band and the label agree whatever was seen);
   after that a short label yields to it, as labelRoom counts it with the
   band (build note 2). bandFit drops it first when the words are over */
var CTX_CAP = 22;
function ctxLine(a) {
  var g = a.it.g, w = g.res === 'draw' ? 'Drew' : g.res === 'loss' ? 'Lost' : '';
  if (!w || !a.firstSight || !a.it.b.d || ss_relearn(a)) return '';
  var s = g.opp && (w + ' vs ' + g.opp).length <= CTX_CAP ? w + ' vs ' + g.opp : w + ' the game';
  if (practisedCount() < 3 && labelCands(a, boardOptsFor(a), function () { return false; }).some(function (c) { return !!c.tip; })) return '';
  return s;
}
/* how many positions the player has practised: their first three cards are
   the ones met while it is under 3 */
function practisedCount() { return Object.keys(srsLoad()).length; }

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
  /* a lesson's caption names its marks (F9.3) */
  if (!LABELS_ON || o.anim || o.decor || a.phase === 'lesson') return [];
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
    /* V2.2: See it's still marks (a label only where it has room clear of
       every piece, V5.2: the panel says it anyway) */
    else if (ar.kind === 'event' && ar.say) short.push(cand(ar.say, 'red', null, ar.to, ar.from, mk, 0.2));
    else if (ar.kind === 'back') short.push(cand('you take back', 'blue', null, ar.to, ar.from, mk, 0.3));
    /* the player's guess of their reply (F10.1): their reply's own label
       goes first once its telegraph is up */
    else if (ar.kind === 'guess') short.push(cand('your guess', 'blue', null, ar.to, ar.from, mk, 0.5));
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
  /* in game mode the faded game move is what names it (F8.1): its words
     wherever the frame has room, after its first sight too; a foil's (no
     cross, ok) in green, never the ghost's first-sight words (F8.2) */
  (o.ghosts || []).forEach(function (g) {
    if (first.ghost || g.rook) return;
    /* (B8: tier 1 in words, "Rook to h7 in your game", never SAN) */
    var gmk = { kind: 'ghost', sq: g.sq, p: g.p }, gtx = (inWords(a) ? upFirst(moveWords(a.pre, a.played)) : gameSan(a)) + ' in your game';
    if (g.ok) { short.push(cand(gtx, 'green', null, g.sq, null, gmk, 2)); return; }
    if (seen('ghost')) { if (a.game) short.push(cand(gtx, 'red', null, g.sq, null, gmk, 2)); return; }
    first.ghost = cand(gtx, 'red', 'ghost', g.sq, null, gmk);
    if (inWords(a)) first.ghost.alt = 'Your game move';
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
