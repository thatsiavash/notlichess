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
  V1: function (a) { return 'The answer: ' + (a.answerSan || ''); },
  V2: function () { return 'Play the green arrow.'; }
};
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
    var w = materialWord(c.lossG);
    cands = ['You\'d lose ' + (plainCapture(c.gameLine, c.lossAt, 0) || w) + '.', 'You\'d lose ' + w + '.'];
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
/* the band for the state the card is in: {disc, kind, row1, row2, chip,
   cap, sweep}. disc: king (in the solver's colour), good, bad, close,
   checking, unchecked or info; kind: neutral, good, bad, close, info, hint
   or explore; cap: one caption instead of two rows; sweep: the thin line
   that runs along the band's foot while a move is checked. A word for a
   tap that is not a move (a.note) takes row 2 for a while, and the chip
   steps aside for it. Row 2 always fits the word budget (bandFit). The
   hints and forcing steps keep today's sentences inside the row caps until
   their slices give them their own words (10, 11) */
function bandFor(a) {
  var b = bandOf(a), n = a.note && a.note.key === cardStateKey(a) ? a.note : null;
  if (!b.cap && n) { b.cands = NOTE_COPY[n.id](a); b.fall = ''; b.chip = ''; }
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
  delete b.cands; delete b.fall; delete b.never;
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
      line = alt; at = (a.yours.at || 0) + 1;
      settle = settleIndex(alt);
      gain = matDiff(alt.nodes[settle].after.b, pov) - matDiff(a.pre.b, pov);
      better = sanOf(alt.nodes[at].before, alt.nodes[at].move);
    }
  }
  var bn = line && line.nodes[at];
  a.compare = {
    found: !!(gm[1] && ru[0] && gm[1] === ru[0]), betterSan: better, gameSan: gameSan(a),
    w: c.lossG >= 1 ? plainCapture(c.gameLine, c.lossAt, 0) || materialWord(c.lossG) : '', wn: materialWord(c.lossG),
    w2: gain >= 1 && line ? plainCapture(line, settle) || materialWord(gain) : '', w2n: materialWord(gain),
    guard: guardRule(c.gameLine, a.played, bn)
  };
  return a.compare;
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
    else if (cmp.w2) cands = both(function (x) { return bs + ' wins ' + x + '. ' + g + ' missed it.'; }, cmp.w2, cmp.w2n);
  } else if (fam === 'conversion') {
    cands = [c.stalemate ? g + ' allowed a draw.' : c.perpetualAgainst ? g + ' allowed endless checks.' : past];
  } else cands = [past];
  return { cands: cands, fall: g + ' was a mistake.', never: never };
}
/* the words the strip shows (2.0): the Details link once settled, the
   story's two names; nothing before an answer (the typed-move field is off
   screen until it has the keyboard) */
function stripWords(a) {
  if (a.phase !== 'done' || a.explore || !a.view) return 0;
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
  return WORD_BUDGET - bandWords({ row1: b.row1, chip: b.chip }, []) - bw - stripWords(a);
}
/* what the card is showing, so a word or an outline meant for one state
   never outlives it: a move (each one counted, so coming back to the same
   phase is still a change), a try seen, a hint, a step */
function cardStateKey(a) {
  var t = a.tried;
  return [a.phase, a.fxn || 0, t ? t.uci + (t.seen ? '+' : '') : '', a.hints, a.solIdx, a.view ? (a.view.mode || a.view.line + ':' + a.view.idx) : '', a.explore ? 'x' : ''].join('|');
}
function bandOf(a) {
  var t = a.tried, v = a.verdict;
  if (a.phase === 'done' && a.explore) return { kind: 'explore', cap: sayAt(a, a.explore, a.explore.at) };
  if (a.phase === 'done') {
    /* row 2: R4 once the result has settled (S0 at V+850, and the story
       that follows it); before that the answer shown says how to play it
       (V2), and a solve says nothing more yet */
    var mode = a.view && a.view.mode, said = !mode || (mode === 's0' && a.settle >= 2), r4 = said ? r4Of(a) : null;
    if (a.revealed)
      return { disc: 'info', kind: 'info', row1: CARD_COPY.V1(a), cands: r4 ? r4.cands : [CARD_COPY.V2()], fall: r4 ? r4.fall : '', never: r4 ? r4.never : null };
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
  if (a.phase === 'reply') return { disc: 'good', kind: 'good', row1: 'Right', cands: v && v.cands ? v.cands : [], fall: '' };
  var mid = a.sol && a.solIdx > 0;
  if (a.hints >= 1 && (a.hintAfter || !mid)) {
    var fam = familyOf(patternOf(a.it.b)).key;
    var fall = mid ? 'The next move is forcing too.' : fam === 'chances' ? 'You can win material here.' : 'Your move allowed a strong reply.';
    /* a winning position's hint is its advice, not "You are winning." */
    var short_ = !mid && fam === 'conversion' ? 'Keep it simple and safe.' : null;
    return { disc: 'king', kind: 'hint', row1: a.hints >= 2 ? 'Hint 2 of 2' : 'Hint 1 of 2',
             cands: a.hints >= 2 ? ['Move the circled piece.'] : [hintText(a), short_], fall: a.hints >= 2 ? '' : fall };
  }
  if (mid) return { disc: 'king', kind: 'neutral', row1: 'Your move', cands: v && v.cands ? v.cands : [], fall: 'The next move is forcing too.' };
  return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), cands: [CARD_COPY.T2(a)], fall: '', chip: ss_relearn(a) ? CARD_COPY.T3() : '' };
}
