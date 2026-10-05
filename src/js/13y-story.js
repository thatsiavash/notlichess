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
   (T3), and the three answers to a tap that is not a move (T4 their piece,
   T5 a drop where that piece cannot go, N1 any piece after an answer) */
var CARD_COPY = {
  T1: function () { return 'Your turn'; },
  T2: function (a) { return 'Find a better move than ' + gameSan(a) + '.'; },
  T3: function () { return 'One more try'; },
  T4: function (a) { var s = sidesOf(a); return 'You are ' + s.me + '. Move a ' + s.mine + ' piece.'; },
  T5: function () { return 'That piece can\'t go there.'; },
  N1: function () { return 'To try moves, open Details.'; }
};

/* the live region leads with the verdict in words, so meaning never rests
   on colour */
var LIVE_PREFIX = { good: 'Correct.', bad: 'Wrong.', close: 'Good move, not best.', unchecked: 'Not checked.', info: 'Answer shown.' };

/* the fit ladder. cands run from fullest to barest; a caller that can say
   a material phrase as one word ("a rook", "the queen") passes that form
   as the next candidate. Then each candidate's first sentence, then the
   fallback. A row that fits nothing stays empty rather than overflow */
function fitsRow(s, row) {
  var cap = ROW_CAPS[row] || ROW_CAPS.row2;
  return !!s && s.length <= cap.ch && s.split(/\s+/).length <= cap.words;
}
function firstSentence(s) { var m = /^.*?[.!?…](?=\s|$)/.exec(String(s || '')); return m ? m[0] : String(s || ''); }
function fitRow(cands, row, fallback) {
  var list = [].concat(cands).filter(Boolean);
  list = list.concat(list.map(firstSentence));
  for (var i = 0; i < list.length; i++) if (fitsRow(list[i], row)) return list[i];
  return fitsRow(fallback, row) ? fallback : '';
}
/* a classifier sentence without its trailing line of moves: "It loses the
   bishop after Qxd6 Bxd6." reads "It loses the bishop." */
function noLine(s) { return String(s || '').replace(/[:,]? after [^.]*\.$/, '.').replace(/ and more\.$/, '.'); }

/* the band for the state the card is in: {disc, kind, row1, row2, chip,
   cap}. disc: king (in the solver's colour), good, bad, close, checking,
   unchecked or info; kind: neutral, good, bad, close, info, hint or
   explore; cap: one caption instead of two rows. The task, the relearn
   chip and the answered heads are the spec's own words; the verdicts,
   hints and forcing steps keep today's sentences inside the row caps until
   their slices give them their own words (6, 7, 10, 11) */
function bandFor(a) {
  var t = a.tried, v = a.verdict, best = a.lines ? a.lines.best.san[0] || '' : '';
  var say = function (fall) { return fitRow([v && v.say, noLine(v && v.say)], 'row2', fall); };
  if (a.phase === 'done' && a.explore) return { kind: 'explore', cap: sayAt(a, a.explore, a.explore.at) };
  if (a.phase === 'done') {
    if (a.result === 'fail' || a.revealed)
      return { disc: 'info', kind: 'info', row1: 'The answer: ' + best, row2: a.foundGood ? fitRow(['Your ' + a.foundGood.san + ' was close.'], 'row2', '') : '' };
    if (a.alt) return { disc: 'good', kind: 'good', row1: 'That works too', row2: fitRow(['The engine prefers ' + altNames(a).theirs + '.'], 'row2', '') };
    return { disc: 'good', kind: 'good', row1: a.result === 'first' ? 'Found it' : 'You got there', row2: '' };
  }
  if (a.phase === 'checking') return { disc: 'checking', kind: 'neutral', row1: fitRow(['Checking ' + (a.checking || 'your move') + '…'], 'row1', 'Checking…'), row2: '' };
  if (a.phase === 'tried' && t) {
    if (t.kind === 'close') return { disc: 'close', kind: 'close', row1: 'Good move', row2: say('There\'s a stronger one.') };
    if (t.kind === 'unchecked') return { disc: 'unchecked', kind: 'info', row1: 'Cannot check this move', row2: say('Not counted. Try again.') };
    if (t.uci === a.playedUci) return { disc: 'bad', kind: 'bad', row1: 'Your game move again', row2: say('There is something stronger here.') };
    return { disc: 'bad', kind: 'bad', row1: 'Not this one', row2: say(fitRow([t.san + ' does not work.'], 'row2', '')) };
  }
  if (a.phase === 'reply') return { disc: 'good', kind: 'good', row1: 'Right', row2: say('') };
  var mid = a.sol && a.solIdx > 0;
  if (a.hints >= 1 && (a.hintAfter || !mid)) {
    var fam = familyOf(patternOf(a.it.b)).key;
    var fall = mid ? 'The next move is forcing too.' : fam === 'chances' ? 'You can win material here.' : 'Your move allowed a strong reply.';
    /* a winning position's hint is its advice, not "You are winning." */
    var short_ = !mid && fam === 'conversion' ? 'Keep it simple and safe.' : null;
    return { disc: 'king', kind: 'hint', row1: a.hints >= 2 ? 'Hint 2 of 2' : 'Hint 1 of 2',
             row2: a.hints >= 2 ? 'Move the circled piece.' : fitRow([hintText(a), short_], 'row2', fall) };
  }
  if (mid) return { disc: 'king', kind: 'neutral', row1: 'Your move', row2: say('The next move is forcing too.') };
  return { disc: 'king', kind: 'neutral', row1: CARD_COPY.T1(), row2: CARD_COPY.T2(a), chip: ss_relearn(a) ? CARD_COPY.T3() : '' };
}
