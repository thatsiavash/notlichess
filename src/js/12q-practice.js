/* ── Beginner teaching (F9.1 to F9.5) ───────────────────────────────────
   The help level (F9.1): More help, Normal or Less help, in Settings, set
   from the rating until the player picks one; it is the tier everywhere
   the tier sets help, words or depth (playerTier). The red-square third
   hint (F9.2): at More help, after Hint 2, red on every square where the
   circled piece would be taken for a loss or would allow mate in one,
   offered only where two or more of its squares stay plain and the
   answer's square is one of them. Mini lessons (F9.3): ten skills, three
   still frames each (a "Lesson" tag, 8 words or fewer), then one practice
   position; from a player's second set on, before the first card of a
   skill whose lesson is unseen (never card 1), and any time from the
   skill's card. Practice packs (F9.4): five positions of one skill, from
   lesson positions (step 1) to other players' real ones (step 2: 800 and
   1100, step 3: 1400); three first tries in a row step up, two misses in a
   row step down. A practice position wears "Practice" and its source,
   never a red arrow, and is scored apart: it never touches nl:srs,
   "learned" or since you started. Skill tiles (F9.5): on Insights at More
   help, a 10-dot meter of first tries, a badge once mastered, "Next" on
   the coming skill.
   nl:help:<player>: 'more', 'normal' or 'less' once chosen.
   nl:skill:<player>: { ls: {skill: when its lesson was seen}, k: {skill:
   { st (its step, 1 to 3), h ([time, first try 1/0, real 1/0], the last
   10), r (its run: +n first tries in a row, -n misses), m (when mastered),
   np (needs polish) }}, rc (practice ids met lately, the last 30), mx
   (the skill of the last mixed review) }, about 2 KB */

/* ── F9.1 the help level ── */
var HELP = ['more', 'normal', 'less'];
var HELP_WORD = { more: 'More help', normal: 'Normal', less: 'Less help' };
function helpKey() { return 'nl:help:' + playerId(); }
function helpChosen() { var h = store.get(helpKey(), null); return HELP.indexOf(h) >= 0 ? h : null; }
/* the tier the rating gives: under 1200 tier 1, under 1800 tier 2, else 3
   (the tracked format's current rating, band-equivalent) */
function ratingTier() {
  var r = null, perf = trackedPerfs()[0];
  if (data.user && data.user.perfs && perf && data.user.perfs[perf]) r = bandEquivRating(perf, data.user.perfs[perf].rating);
  if (r == null) return 2;
  return r < 1200 ? 1 : (r < 1800 ? 2 : 3);
}
function helpLevel() { return helpChosen() || HELP[ratingTier() - 1]; }
function setHelp(k) {
  if (HELP.indexOf(k) < 0) return;
  store.set(helpKey(), k);
  track('help_' + k);
  modelDirty();
  renderSettings();
  renderViews();
  renderTrain();
}

/* ── the ten skills (F9.3, F9.5) ──
   In path order. pre: the skills that come first (1, 2, 3 in turn; 4, 5, 9
   in turn; 6 to 8 and 10 after 2). task: the practice card's row 2; ask:
   its Hint 1 where the board shows no danger to draw (six words at most,
   a hint frame's room); idea: the skill's card. The lesson: its board (a
   position of its own) and three frames, each a caption of 8 words or
   fewer with its marks (rings [square, kind], arrows [from, to, kind,
   key], reds: red squares, guards [from, to]); a frame's move is played
   into it; the third frame shows the practice position that follows
   (try). Every caption is true on its board (test/practice.js) */
var PSKILL = [
  { k: 'free', name: 'Free pieces', pre: [], task: 'Find the free piece.', ask: 'Find a piece with no guard.', idea: 'A piece with no guard can be taken for free.',
    lesson: { fen: 'r5k1/5ppp/8/3b4/8/7P/5PP1/3R2K1 w - - 0 1', frames: [
      { cap: 'Nothing guards their bishop.', rings: [['d5', 'target']] },
      { cap: 'Take it. It is free.', move: 'd1d5' },
      { cap: 'Your turn: find the free piece.', board: 'try' }] }, tryId: 'free-1' },
  { k: 'safety', name: 'Piece safety', pre: ['free'], task: 'Find a safe square.', ask: 'Which of your pieces is attacked?', idea: 'When a piece of yours is attacked, move it where nothing takes it.',
    lesson: { fen: '2r3k1/4bppp/4p3/3p4/4N3/8/5PPP/6K1 w - - 0 1', frames: [
      { cap: 'Their pawn attacks your knight.', rings: [['e4', 'attacked']], arrows: [['d5', 'e4', 'threat', 'danger']] },
      { cap: 'Red squares are attacked too.', rings: [['e4', 'attacked']], reds: 'e4' },
      { cap: 'Your turn: find a safe square.', board: 'try' }] }, tryId: 'safety-1' },
  { k: 'count', name: 'Count first', pre: ['safety'], task: 'Take the safe one.', ask: 'Count the guards on each one.', idea: 'Before you take, check what guards it.',
    lesson: { fen: '6k1/5ppp/2p5/3n4/8/8/5PPP/b2R2K1 w - - 0 1', frames: [
      { cap: 'Two things to take. Which is safe?', arrows: [['d1', 'a1', 'lesson'], ['d1', 'd5', 'lesson']] },
      { cap: 'This one is guarded. You lose your rook.', rings: [['d5', 'attacked']], guards: [['c6', 'd5']] },
      { cap: 'Your turn: take the safe one.', board: 'try' }] }, tryId: 'count-1' },
  { k: 'mate1', name: 'Mate in one', pre: [], task: 'Find mate in one.', ask: 'Find a check with no escape.', idea: 'A check they cannot escape is checkmate.',
    lesson: { fen: '6k1/5p1p/6pQ/8/8/2B5/5PPP/6K1 w - - 0 1', frames: [
      { cap: 'Your queen and bishop aim at g7.', rings: [['g7', 'target']], arrows: [['c3', 'g7', 'lesson'], ['h6', 'g7', 'lesson']] },
      { cap: 'Check, and no way out: mate.', move: 'h6g7' },
      { cap: 'Your turn: find mate in one.', board: 'try' }] }, tryId: 'mate1-1' },
  { k: 'stopmate', name: 'Stop the mate', pre: ['mate1'], task: 'Stop the mate.', ask: 'Look for their mate threat.', idea: 'When they threaten mate, stop it first.',
    lesson: { fen: '5rk1/5ppp/8/7Q/8/3B4/5PPP/6K1 b - - 0 1', frames: [
      { cap: 'They can mate you on h7.', rings: [['h7', 'attacked', 1]], arrows: [['h5', 'h7', 'threat', 'danger']] },
      { cap: 'Ignore it, and it is mate.', rings: [['h7', 'attacked', 1]], arrows: [['h5', 'h7', 'threat', 'danger'], ['d3', 'h7', 'threat', 'danger']] },
      { cap: 'Your turn: stop the mate.', board: 'try' }] }, tryId: 'stopmate-1' },
  { k: 'fork', name: 'Forks', pre: ['safety'], task: 'Find the fork.', ask: 'One piece can hit two.', idea: 'One piece attacks two. They can save only one.',
    lesson: { fen: '3k4/6qp/8/8/3N4/8/5PPP/6K1 w - - 0 1', frames: [
      { cap: 'A fork: one piece attacks two.', move: 'd4e6', arrows: [['e6', 'd8', 'lesson'], ['e6', 'g7', 'lesson']] },
      { cap: 'They can save only one.', arrows: [['e6', 'g7', 'lesson']], rings: [['g7', 'target']] },
      { cap: 'Your turn: find the fork.', board: 'try' }] }, tryId: 'fork-1' },
  { k: 'pin', name: 'Pins', pre: ['safety'], task: 'Pin a piece.', ask: 'Line up two of their pieces.', idea: 'A pinned piece cannot leave the line.',
    lesson: { fen: '4k3/3q1ppp/8/8/P7/8/5PPP/5BK1 w - - 0 1', frames: [
      { cap: 'The queen cannot leave the line.', move: 'f1b5', rings: [['d7', 'target']] },
      { cap: 'It is pinned. You will win it.', arrows: [['b5', 'd7', 'lesson']], rings: [['d7', 'target']] },
      { cap: 'Your turn: pin a piece.', board: 'try' }] }, tryId: 'pin-1' },
  { k: 'hidden', name: 'Hidden attacks', pre: ['safety'], task: 'Find the hidden attack.', ask: 'Move one piece, open another.', idea: 'Move one piece, and the one behind it attacks.',
    lesson: { fen: '3q2k1/5ppp/8/8/8/3B4/5PPP/3R2K1 w - - 0 1', frames: [
      { cap: 'Your bishop hides your rook\'s attack.', rings: [['d3', 'hint']], arrows: [['d1', 'd8', 'lesson']] },
      { cap: 'Check, and the rook hits the queen.', move: 'd3h7', arrows: [['d1', 'd8', 'lesson']] },
      { cap: 'Your turn: find the hidden attack.', board: 'try' }] }, tryId: 'hidden-1' },
  { k: 'backrank', name: 'Back-rank mate', pre: ['stopmate'], task: 'Find the back-rank mate.', ask: 'Look at their back rank.', idea: 'A king stuck behind its pawns can be mated on the back row.',
    lesson: { fen: '1k6/ppp5/8/8/8/8/5PPP/4R1K1 w - - 0 1', frames: [
      { cap: 'Their king is stuck behind its pawns.', rings: [['b8', 'target']] },
      { cap: 'A rook on the back rank: mate.', move: 'e1e8' },
      { cap: 'Your turn: find the back-rank mate.', board: 'try' }] }, tryId: 'backrank-1' },
  { k: 'pawns', name: 'Runaway pawns', pre: ['safety'], task: 'Stop the pawn.', ask: 'Stop their pawn from queening.', idea: 'A pawn that reaches the end becomes a queen. Stop it in time.',
    lesson: { fen: '6k1/8/8/8/8/8/2p3K1/7R w - - 0 1', frames: [
      { cap: 'Their pawn wants to become a queen.', rings: [['c2', 'target']], arrows: [['c2', 'c1', 'threat', 'danger']] },
      { cap: 'Stand in front of it.', move: 'h1c1' },
      { cap: 'Your turn: stop the pawn.', board: 'try' }] }, tryId: 'pawns-1' }
];
var PSKILL_OF = {};
PSKILL.forEach(function (s, i) { s.n = i + 1; PSKILL_OF[s.k] = s; });

/* ── the practice positions (12p-pdata.js), read once ──
   'id|skill|source|band|fen|accepted|close|captures|mates|hint2': source L
   a lesson position, R another player's real one (band: their rating
   band); accepted, the moves within 4 points of Stockfish's best at
   8,000,000 nodes (on a mate in one, the mates); close, within 10; and the
   facts its claims read (V3.1, test/truth/pfacts.js), so that no practice
   claim reads a live search: captures, the misses whose capture reason
   holds where the line settles ('e1e2' names the capture pracCapture
   finds, 'e1e2>d8d1' Stockfish's own), mates, the misses that let them
   mate in two ('g1f1>d1d2:2', its first move and length), hint2, Hint 2's
   case (S exactly one safe square, O one move of the piece holds) */
var pracMemo = null;
function pracData() {
  if (pracMemo) return pracMemo;
  var by = {}, sk = {};
  (typeof PRAC_DATA !== 'undefined' ? PRAC_DATA : []).forEach(function (row) {
    var f = row.split('|'), p = { id: f[0], skill: f[1], src: f[2], band: +f[3] || 0, fen: f[4], ok: f[5] ? f[5].split(',') : [], cl: f[6] ? f[6].split(',') : [],
                                  caps: {}, mates: {}, h2: f[9] || '' };
    (f[7] ? f[7].split(',') : []).forEach(function (x) { var y = x.split('>'); p.caps[y[0]] = y[1] || ''; });
    (f[8] ? f[8].split(',') : []).forEach(function (x) { var y = /^(\w+)>(\w+):(\d+)$/.exec(x); if (y) p.mates[y[1]] = { r: y[2], n: +y[3] }; });
    by[p.id] = p;
    (sk[p.skill] = sk[p.skill] || []).push(p);
  });
  pracMemo = { byId: by, bySkill: sk };
  return pracMemo;
}
/* a position's step: lesson positions 1, real ones 2 (800 to 1100) or 3 (1400) */
function pracStep(p) { return p.src === 'L' ? 1 : p.band <= 1100 ? 2 : 3; }

/* ── nl:skill ── */
function skillKey() { return 'nl:skill:' + playerId(); }
function skillLoad() {
  var s = store.get(skillKey(), null);
  s = s && typeof s === 'object' ? s : {};
  return { ls: s.ls || {}, k: s.k || {}, rc: Array.isArray(s.rc) ? s.rc : [], mx: s.mx || null };
}
/* a practice write: before any game-cache write (build note 7) */
function skillSave(s) { practiceWrite(skillKey(), s); }
function skillRec(s, k) { return s.k[k] || (s.k[k] = { st: 1, h: [], r: 0 }); }
/* mastered (F9.4): 8 of the last 10 first try, over 2 days or more, half of
   them real positions (as many as the skill has, when it has fewer than 5);
   needs polish: once mastered, under 6 of the last 10 */
function masteryOf(k, r) {
  var h = (r && r.h) || [], first = 0, real = 0, days = {};
  h.forEach(function (x) { if (x[1]) first++; if (x[2]) real++; days[dayStamp(new Date(x[0]))] = 1; });
  var need = Math.min(5, (pracData().bySkill[k] || []).filter(function (p) { return p.src === 'R'; }).length);
  return { ok: h.length >= 10 && first >= 8 && Object.keys(days).length >= 2 && real >= need, polish: h.length >= 10 && first < 6, first: first, n: h.length };
}
function skillMastered(s, k) { var r = s.k[k]; return !!(r && r.m); }

/* ── items: a practice position or a lesson as a set's position ── */
function isPracKey(k) { return /^pk:/.test(String(k || '')); }
function isLessonKey(k) { return /^ls:/.test(String(k || '')); }
var pracItems = {};
function pracItem(key) {
  if (pracItems[key]) return pracItems[key];
  var p = pracData().byId[String(key).slice(3)], st = p ? stateFromFen(p.fen) : null;
  if (!p || !st) return null;
  pracItems[key] = { key: key, prac: true, id: p.id, skill: p.skill, src: p.src, band: p.band, fen: p.fen, ok: p.ok, cl: p.cl,
                     caps: p.caps, mates: p.mates, h2: p.h2, g: { id: 'prac', color: st.w ? 'white' : 'black', mv: '' }, b: {} };
  return pracItems[key];
}
function lessonItem(key) {
  var k = String(key).slice(3), sk = PSKILL_OF[k], st = sk && sk.lesson ? stateFromFen(sk.lesson.fen) : null;
  if (!st) return null;
  return { key: key, lesson: true, skill: k, g: { id: 'lesson', color: st.w ? 'white' : 'black', mv: '' }, b: {} };
}

/* ── F9.2 the red squares ──
   Each legal move of the piece on `from`, by its square: red when taking it
   there wins for them (the best legal capture of it, played out as the
   static exchange, beats what the move itself took) or when it lets them
   mate in one; a square every move to which is red is red (a promotion's
   four). {red, plain: squares, lose (every red one loses the piece), mate
   (every red one allows mate), piece} */
function loseSquares(st, from) {
  var by = {}, p = st.b[from];
  legalMoves(st).filter(function (m) { return m.from === from; }).forEach(function (m) {
    var after = cloneState(st);
    applyMove(after, m);
    var took = m.ep >= 0 ? 1 : st.b[m.to] ? MOTIF_VAL[pType(st.b[m.to])] : 0, best = 0, replies = legalMoves(after);
    replies.forEach(function (r) { if (r.to === m.to) { var g = dzSeeMove(after.b, r.from, m.to); if (g > best) best = g; } });
    var lose = best > took, mate = replies.some(function (r) { var x = cloneState(after); applyMove(x, r); return isMate(x); });
    var e = by[m.to] || (by[m.to] = { sq: m.to, lose: true, mate: true, bad: true });
    e.lose = e.lose && lose; e.mate = e.mate && mate; e.bad = e.bad && (lose || mate);
  });
  var out = { red: [], plain: [], lose: true, mate: true, piece: p ? pType(p) : '' };
  Object.keys(by).map(Number).sort(function (x, y) { return x - y; }).forEach(function (q) {
    var e = by[q];
    if (!e.bad) { out.plain.push(q); return; }
    out.red.push(q);
    if (!e.lose) out.lose = false;
    if (!e.mate) out.mate = false;
  });
  return out;
}
/* Hint 3 on this card (F9.2), read once on its own position: at More help
   (tier 1), on the card's first move, the piece Hint 2 circles (the answer's,
   never the king), at least one red square, two or more plain ones and the
   answer's square plain (a red one there would be untrue); null: none, and
   Hint 2 is the last */
function hint3Of(a) {
  if (a.h3 !== undefined) return a.h3;
  a.h3 = null;
  if (a.tier !== 1 || a.game || a.foil || a.lesson || !a.best || (a.sol && a.sol.length)) return null;
  var p = a.pre.b[a.best.from];
  if (!p || pType(p) === 'K') return null;
  var ls = loseSquares(a.pre, a.best.from);
  if (ls.red.length && ls.plain.length >= 2 && ls.plain.indexOf(a.best.to) >= 0) a.h3 = ls;
  return a.h3;
}
/* the hints a card has: 3 where Hint 3 can follow, else 2 */
function hintMax(a) { return hint3Of(a) ? 3 : 2; }
/* Hint 3's words: "Red squares lose your knight.", "Red squares allow
   mate." where every red square is that; else "Avoid the red squares." */
function hint3Words(h) {
  if (h.lose) return ['Red squares lose your ' + PIECE_WORD[h.piece] + '.', 'Avoid the red squares.'];
  if (h.mate) return ['Red squares allow mate.', 'Avoid the red squares.'];
  return ['Avoid the red squares.'];
}

/* ── the practice card ── */
/* the card for practice position it: one move to find, graded at once from
   its accepted moves (its close ones a good move that is not the best); no
   game move, so no red arrow, and nothing written to nl:srs */
function pracCardFor(it) {
  var pre = stateFromFen(it.fen), best = pre && it.ok.length ? uciToMove(pre, it.ok[0]) : null;
  if (!best) return null;
  var a = {
    it: it, key: it.key, pre: pre, st: cloneState(pre), phase: 'guess', best: best, bestUci: it.ok[0], playedUci: null, played: null,
    attempts: 0, misses: 0, hints: 0, sel: -1, shapes: [], t0: Date.now(), firstSight: true, tier: playerTier(), view: null,
    prac: true, game: false, foil: false, cls: null, sol: null, solIdx: 0, preKey: posKey(pre)
  };
  var kept = ui.session && ui.session.progress && ui.session.progress[it.key];
  if (kept) {
    a.misses = kept.m || 0; a.hints = kept.h || 0; a.foundGood = kept.f || null; a.attempts = kept.a || 0; a.autoH = kept.au || 0;
    a.fc = kept.fc || ''; a.tries = (kept.tr || []).map(function (x) { return { d: x[0], u: x[1], took: x[2] || '', mate: !!x[3], lost: !!x[4], san: x[5] || '' }; });
  }
  return a;
}
/* a move on a practice card: an accepted one is found (its claim said once
   it settles), a close one is a good move that is not the best (S5), any
   other a miss with its reason, read on the board (pracWhy) */
function pracTry(m) {
  var a = ui.session.active, u = moveUci(m), it = a.it;
  if (it.ok.indexOf(u) >= 0) { a.found = m; solved(m, u, null); return; }
  if (it.cl.indexOf(u) >= 0) {
    var again = !!a.foundGood;
    if (!again) { a.foundGood = { san: sanOf(a.st, m), win: 0 }; keepProgress(a); }
    a.cue = 'tap';
    showTry(a, m, 'close', null, null, again);
    return;
  }
  a.misses++;
  a.cue = 'bad';
  var why = pracWhy(a, m);
  a.hintAfter = false;
  noteTry(a, why);
  escalate();
  showTry(a, m, 'miss', why.reply, why);
}
/* a practice position's source line, beside its "Practice" tag before its
   first move (F9.4): "Lesson position", "Another player's game" (short
   enough for a 360 px phone; Details says the rest, "From another player's
   game, rated about 800.") */
function pracSrc(a) { return a.it.src === 'R' ? CARD_COPY.P4() : CARD_COPY.P3(); }
function pracSrcOn(a) { return !!a && !!a.prac && a.phase === 'guess' && !a.attempts && !a.hints && !a.revealed; }
/* the capture a practice try lets them make, as the static exchange sees it
   (the reply that nets them most, the bigger piece on a tie; never a king,
   never en passant): the capture a practice reason names, unless the
   position's facts hold Stockfish's own (pracWhy, test/truth/pfacts.js);
   null when no capture pays */
function pracCapture(after, me) {
  var best = null, gain = 0;
  legalMoves(after).forEach(function (r) {
    var t = after.b[r.to];
    if (!t || r.ep >= 0 || colorW(t) !== me || pType(t) === 'K') return;
    var g = dzSeeMove(after.b, r.from, r.to);
    if (g > gain || (g === gain && best && MOTIF_VAL[pType(t)] > MOTIF_VAL[pType(after.b[best.to])])) { gain = g; best = r; }
  });
  return best && gain > 0 ? best : null;
}
/* a try that takes a piece of theirs worth a knight or more for free */
function pracFreeTake(st, m) {
  var t = st.b[m.to];
  return !!t && m.ep < 0 && pType(t) !== 'P' && pType(t) !== 'K' && dzSeeMove(st.b, m.from, m.to) >= MOTIF_VAL[pType(t)];
}
/* why a practice try fails (V3.2): true on the board after it, or by the
   position's facts (12p-pdata.js, from test/truth/pfacts.js; never a live
   search), the skill's own reason first:
   - a mate task: "That is not mate.";
   - a free-piece or count task, a guarded piece taken for a loss by the
     exchange: "That piece is guarded." (See it: the guard takes back);
   - their mate in one: "Then queen takes on f2 is checkmate." (tier 1),
     "Then Qxf2 is checkmate.", where neither fits "Black could checkmate
     you.";
   - a runaway pawn let through: "Then their pawn can become a queen." (a
     promotion nothing takes at once);
   - their mate in two the facts hold: "Then they mate in two." (tier 1
     "Then they can force checkmate."), See it playing its first move;
   - a capture the facts hold, its loss standing where the line settles:
     "Their knight takes your queen.", tier 3 "Nxg5 takes your queen.";
   - the skill's own words: the free piece left (never when the try took
     one), the safe one left, the attacked piece left;
   - else, as the card says with no score, "That helps Black." (every move
     not accepted or close is 10 points or more below the best).
   Each one that names a move has See it play it; why.kind says which:
   task, guarded, mate, promo, forced, capture, skill, or '' */
function pracWhy(a, m) {
  var after = cloneState(a.pre), opp = sidesOf(a).opp, me = myPov(a.it), t1 = inWords(a), sk = a.it.skill, u = moveUci(m);
  applyMove(after, m);
  var replies = legalMoves(after), why = { kind: '', cands: [], fall: 'That helps ' + opp + '.', d: 0, u: '', took: '', mate: false };
  var tw = function (r, mt) {
    var x = cloneState(after); applyMove(x, r);
    return { from: r.from, to: r.to, piece: pType(after.b[r.from]), captured: after.b[r.to] ? pType(after.b[r.to]) : null, check: checkersOf(x).length > 0, mate: mt, san: sanOf(after, r) };
  };
  var says = function (kind, cands, r, mt) {
    why.kind = kind; why.cands = cands;
    if (r) { why.reply = moveUci(r); why.threat = tw(r, !!mt); why.u = why.reply; }
    return why;
  };
  if (sk === 'mate1' || sk === 'backrank') return says('task', ['That is not mate.']);
  if ((sk === 'free' || sk === 'count') && a.pre.b[m.to] && m.ep < 0 && attackersOf(a.pre.b, m.to, colorW(a.pre.b[m.to])).length && dzSeeMove(a.pre.b, m.from, m.to) < 0) {
    /* a guard on the board (an x-ray alone is none here), and the cheapest
       takes back */
    var back = replies.filter(function (r) { return r.to === m.to; }).sort(function (x, y) { return MOTIF_VAL[pType(after.b[x.from])] - MOTIF_VAL[pType(after.b[y.from])] || x.from - y.from; })[0];
    if (back) { why.took = pType(after.b[m.to]); return says('guarded', ['That piece is guarded.'], back); }
  }
  var mate = replies.filter(function (r) { var x = cloneState(after); applyMove(x, r); return isMate(x); })[0];
  if (mate) {
    why.mate = true;
    /* tier 1 says no move in SAN: where the words do not fit, that they could */
    return says('mate', [t1 ? 'Then ' + moveWords(after, mate) + ' is checkmate.' : 'Then ' + capSan(after, mate) + ' is checkmate.', opp + ' could checkmate you.'], mate, true);
  }
  if (sk === 'pawns') {
    var run = replies.filter(function (r) { if (!r.promo) return false; var x = cloneState(after); applyMove(x, r); return !legalMoves(x).some(function (y) { return y.to === r.to; }); })[0];
    if (run) return says('promo', ['Then their pawn can become a queen.'], run);
  }
  var fm = a.it.mates && a.it.mates[u], fr = fm && fm.n === 2 ? uciToMove(after, fm.r) : null;
  if (fr) {
    why.fmate = 2;
    return says('forced', [t1 ? 'Then they can force checkmate.' : 'Then they mate in two.', 'Then they can force checkmate.'], fr);
  }
  var cu = a.it.caps ? a.it.caps[u] : undefined, cr = cu === undefined ? null : cu ? uciToMove(after, cu) : pracCapture(after, me);
  var vic = cr ? (cr.ep >= 0 ? after.b[cr.ep] : after.b[cr.to]) : null;
  if (vic && colorW(vic) === me && pType(vic) !== 'K') {
    var P = PIECE_WORD[pType(vic)];
    why.took = pType(vic);
    return says('capture', a.tier >= 3 ? [capSan(after, cr) + ' takes your ' + P + '.'] : ['Their ' + PIECE_WORD[pType(after.b[cr.from])] + ' takes your ' + P + '.'], cr);
  }
  if (sk === 'free' && pracClaim(a.pre, a.best, 'free') && !pracFreeTake(a.pre, m)) return says('skill', ['A piece of theirs was free.']);
  if (sk === 'count' && pracClaim(a.pre, a.best, 'count')) return says('skill', ['One of them was safe to take.']);
  if (sk === 'safety') {
    var still = dangerAttacked(after, me).map(function (x) { return x[0]; }), was = a.pre.b[a.best.from];
    if (still.indexOf(a.best.from) >= 0 && after.b[a.best.from] === was) return says('skill', ['Your ' + PIECE_WORD[pType(was)] + ' is still attacked.']);
  }
  return why;
}
/* what an accepted move does, by its skill, true on the board (the
   settled row 2; test/practice.js holds every accepted move of every
   position to it): '' when the claim does not hold for this move */
function pracClaim(st, m, sk) {
  if (!st || !m) return '';
  var after = cloneState(st), me = !!st.w, took = m.ep >= 0 ? (me ? 'p' : 'P') : st.b[m.to];
  applyMove(after, m);
  var mateNext = function (x) { return legalMoves(x).some(function (r) { var y = cloneState(x); applyMove(y, r); return isMate(y); }); };
  if (sk === 'mate1' || sk === 'backrank') return isMate(after) ? 'That is checkmate.' : '';
  if (sk === 'free') return took && pType(took) !== 'P' && dzSeeMove(st.b, m.from, m.to) >= MOTIF_VAL[pType(took)] ? 'That wins their ' + PIECE_WORD[pType(took)] + '.' : '';
  if (sk === 'safety') {
    if (dangerAttacked(st, me).map(function (x) { return x[0]; }).indexOf(m.from) < 0 || mateNext(after)) return '';
    var tv = took ? MOTIF_VAL[pType(took)] : 0, lose = 0;
    legalMoves(after).forEach(function (r) { if (r.to === m.to) { var g = dzSeeMove(after.b, r.from, m.to); if (g > lose) lose = g; } });
    return lose <= tv ? 'Your ' + PIECE_WORD[pType(st.b[m.from])] + ' is safe there.' : '';
  }
  if (sk === 'count') {
    if (!took || dzSeeMove(st.b, m.from, m.to) < 0) return '';
    var bad = legalMoves(st).some(function (x) { return st.b[x.to] && x.ep < 0 && dzSeeMove(st.b, x.from, x.to) < 0; });
    return bad ? 'That one was safe to take.' : '';
  }
  if (sk === 'stopmate') return mateNext(dzNullState(st)) && !mateNext(after) ? 'That stops the mate.' : '';
  if (sk === 'fork') return mFork({ nodes: [{}, { after: after, move: m, piece: pType(st.b[m.from]) }, {}, { piece: 'K' }], povWhite: me }) ? 'One move, two attacks.' : '';
  if (sk === 'pin') {
    var pin = mPin({ nodes: [{}, { after: after, move: m }], povWhite: me }), was = mPin({ nodes: [{}, { after: st }], povWhite: me });
    return pin && !(was && was.sq === pin.sq) ? 'That pins their ' + PIECE_WORD[pin.piece] + '.' : '';
  }
  if (sk === 'hidden') {
    /* a piece of yours behind the one that moved now attacks a piece of theirs it did not */
    var hit = null;
    for (var q = 0; q < 64 && !hit; q++) {
      var L = after.b[q];
      if (!L || colorW(L) !== me || q === m.to || 'QRB'.indexOf(pType(L)) < 0) continue;
      var now = attacksFrom(after.b, q), then = attacksFrom(st.b, q);
      now.forEach(function (t) {
        var T = after.b[t];
        if (!T || colorW(T) === me || then.indexOf(t) >= 0 || pType(T) === 'P') return;
        if (!hit || MOTIF_VAL[pType(T)] > MOTIF_VAL[pType(after.b[hit.t])]) hit = { q: q, t: t };
      });
    }
    return hit ? (pType(after.b[hit.t]) === 'K' ? 'Now your ' + PIECE_WORD[pType(after.b[hit.q])] + ' gives check.' : 'Now your ' + PIECE_WORD[pType(after.b[hit.q])] + ' hits their ' + PIECE_WORD[pType(after.b[hit.t])] + '.') : '';
  }
  if (sk === 'pawns') {
    /* no pawn of theirs can then become a piece you cannot take at once */
    var safe = legalMoves(after).filter(function (r) { return r.promo; }).every(function (r) {
      var x = cloneState(after); applyMove(x, r);
      return legalMoves(x).some(function (y) { return y.to === r.to; });
    });
    return safe ? 'That stops the pawn.' : '';
  }
  return '';
}
/* the settled row 2 of a practice card: a lesson's own position ends "Now
   find it in your games." (content), any other says what the move found
   does (pracClaim), or nothing */
function pracSaid(a) {
  if (a.lessonTry) return CARD_COPY.P5();
  var m = a.found || (a.revealed ? a.best : null);
  return m ? pracClaim(a.pre, m, a.it.skill) : '';
}
/* Hint 1 on a practice card: where the danger is the skill (Piece safety,
   Stop the mate), what stands on the board, as F1.1 draws it (their mate
   in one: its square ringed; your pieces taking would win for them: up to
   two rings and three arrows); in check, the check; else none, and the
   skill's question says it in words. Never a mark on the answer's
   to-square */
function pracDanger(a) {
  var st = a.pre, due = a.best, sk = a.it.skill, skip = function (f, t) { return f === due.to || t === due.to; };
  if (checkersOf(st).length) return { kind: 'check', rings: [], arrows: [] };
  if (sk !== 'safety' && sk !== 'stopmate') return null;
  var nst = dzNullState(st), mate = legalMoves(nst).filter(function (r) { var x = cloneState(nst); applyMove(x, r); return isMate(x); })[0];
  if (mate) return { kind: 'mate', mate: { from: mate.from, to: mate.to, san: capSan(nst, mate) },
                     rings: skip(mate.to, mate.to) ? [] : [{ sq: mate.to, kind: 'attacked', mate: true }], arrows: skip(mate.from, mate.to) ? [] : [{ from: mate.from, to: mate.to, kind: 'threat', key: 'danger' }] };
  var pk = dangerPick(dangerAttacked(st, myPov(a.it)).map(function (x) { return { sq: x[0], p: st.b[x[0]], by: x.slice(1) }; }), [], skip);
  return pk ? { kind: 'attacked', named: pk.named, second: pk.second, rings: pk.rings, arrows: pk.arrows.map(function (x) { return { from: x.from, to: x.to, kind: 'threat', key: 'danger' }; }) } : null;
}
/* Hint 1's question on a practice card with no danger to draw: the skill's
   own (its ask), but "Find a piece with no guard." only where a piece of
   theirs that could be taken has none; otherwise the task line alone */
function pracAsk(a) {
  var sk = PSKILL_OF[a.it.skill], st = a.pre, me = myPov(a.it);
  if (sk.k !== 'free') return sk.ask;
  var loose = legalMoves(st).some(function (m) { var t = st.b[m.to]; return !!t && m.ep < 0 && colorW(t) !== me && pType(t) !== 'P' && pType(t) !== 'K' && !isDefended(st.b, m.to); });
  return loose ? sk.ask : sk.task;
}
/* Hint 2's words on a practice card (from the position's facts): the
   circled piece attacked and every safe square of it an accepted move (one,
   or several and all accepted: the orchestrator's call after V2.3, so the
   hint invites nothing rejected), "Find a safe square."; else V2.3's
   ladder: one move of it that holds, "Only one queen move holds." (tier 1
   "Only one queen move is best.": another may be a good move); else "Move
   the circled piece." */
function pracHint2(a) {
  var h = a.it.h2, p = PIECE_WORD[pType(a.pre.b[a.best.from])];
  if (h === 'S') return [CARD_COPY.H3c(), CARD_COPY.H3b()];
  if (h === 'O' && p) return ['Only one ' + p + ' move ' + (a.tier === 1 ? 'is best.' : 'holds.'), CARD_COPY.H3b()];
  return [CARD_COPY.H3b()];
}
/* the practice result, into nl:skill (never nl:srs): first try or not, real
   or a lesson's; the run and the step (3 first tries in a row up, 2 misses
   down); mastered or needs polish. {up, down, mastered} */
function pracRecord(a, result) {
  var s = skillLoad(), it = a.it, k = it.skill, r = skillRec(s, k), first = result === 'first' && !a.revealed && !a.foundGood;
  r.h = (r.h || []).concat([[Date.now(), first ? 1 : 0, it.src === 'R' ? 1 : 0]]).slice(-10);
  r.r = first ? Math.max(0, r.r || 0) + 1 : Math.min(0, r.r || 0) - 1;
  var out = { up: false, down: false, mastered: false };
  if (r.r >= 3) { if (r.st < 3 && stepPool(k, r.st + 1).length) { r.st++; out.up = true; } r.r = 0; }
  else if (r.r <= -2) { if (r.st > 1) { r.st--; out.down = true; } r.r = 0; }
  var m = masteryOf(k, r);
  if (m.ok && !r.m) { r.m = Date.now(); out.mastered = true; track('skill_mastered'); }
  if (r.m) { if (m.polish) r.np = 1; else delete r.np; }
  s.rc = [it.id].concat(s.rc.filter(function (x) { return x !== it.id; })).slice(0, 30);
  skillSave(s);
  return out;
}
/* a lesson's own position, met in its lesson's set: its end says to find
   it in the player's games */
function lessonTryOf(ss, key) {
  var i = ss ? ss.keys.indexOf(key) : -1, prev = i > 0 ? ss.keys[i - 1] : null;
  return !!prev && isLessonKey(prev) && PSKILL_OF[prev.slice(3)] && 'pk:' + PSKILL_OF[prev.slice(3)].tryId === key;
}

/* ── the lesson card (F9.3) ──
   Three still frames on the story stepper (‹ and Next ›, one tap each):
   the lesson's board with its marks and caption, the "Lesson" tag; a
   frame's move slides in as the story's plies do; the third shows the
   practice position that follows. The lesson counts as seen once its third
   frame shows */
function lessonCardFor(it) {
  var sk = PSKILL_OF[it.skill], pre = sk && stateFromFen(sk.lesson.fen);
  if (!pre) return null;
  return { it: it, key: it.key, lesson: { k: it.skill, i: 0 }, phase: 'lesson', pre: pre, st: cloneState(pre), tier: playerTier(), view: null,
           attempts: 0, misses: 0, hints: 0, sel: -1, shapes: [], t0: Date.now(), best: null, played: null, playedUci: null, solIdx: 0 };
}
/* frame i of a lesson as data: its position, the move into it, its marks
   and caption */
function lessonFrame(a, i) {
  var sk = PSKILL_OF[a.lesson.k], fr = sk.lesson.frames[i], st = stateFromFen(sk.lesson.fen), last = null;
  if (fr.board === 'try') {
    var tp = pracData().byId[sk.tryId];
    st = tp ? stateFromFen(tp.fen) : st;
  } else {
    for (var j = 0; j <= i; j++) {
      var mv = sk.lesson.frames[j].move, m = mv ? uciToMove(st, mv) : null;
      if (m) { applyMove(st, m); if (j === i) last = [m.from, m.to]; }
    }
  }
  var sq = function (s) { return sqIndex(s); };
  var reds = fr.reds ? loseSquares(stateFromFen(sk.lesson.fen), sq(fr.reds)).red : [];
  return { st: st, last: last, cap: fr.cap, try: fr.board === 'try',
           rings: (fr.rings || []).map(function (r) { return { sq: sq(r[0]), kind: r[1], mate: !!r[2] }; }),
           arrows: (fr.arrows || []).map(function (x) { return { from: sq(x[0]), to: sq(x[1]), kind: x[2], key: x[3] || 'lesson' }; }),
           guards: (fr.guards || []).map(function (x) { return { from: sq(x[0]), to: sq(x[1]) }; }), reds: reds };
}
/* the board of a lesson frame, as boardOptsFor gives it */
function lessonBoard(a) {
  var f = lessonFrame(a, a.lesson.i), opts = { flip: a.it.g.color === 'black' }, slideMs = 0;
  if (f.rings.length) opts.rings = f.rings;
  if (f.arrows.length) opts.arrows = f.arrows;
  if (f.guards.length) opts.guards = f.guards;
  if (f.reds.length) opts.tints = f.reds.map(function (q) { return { sq: q, kind: 'lose' }; });
  if (sameMove(a.animMove, f.last)) { opts.anim = a.animMove; slideMs = 320; opts.animMs = 320; }
  opts.mark = f.last;
  var ck = checkedKingSq(f.st);
  if (ck != null) opts.check = ck;
  opts.label = boardAria(a, f.st, opts);
  return { st: f.st, last: f.last, ev: 0, evLive: false, opts: opts, slideMs: slideMs, land: false, fadeMs: a.jump && !slideMs ? XFADE : 0, live: false, pending: true };
}
/* one step through the lesson: forward (Next ›, →, Space, Enter, a left
   swipe) or back (‹, ←, a right swipe); forward from the third frame goes
   on to its practice position. A frame's move slides in going forward; a
   change of board crossfades */
function lessonStep(d) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'lesson') return;
  var n = PSKILL_OF[a.lesson.k].lesson.frames.length, i = a.lesson.i + d;
  if (i < 0) return;
  if (i >= n) { lessonDone(a); nextCard(); return; }
  var f = lessonFrame(a, i), rm = reducedMotion();
  a.lesson.i = i;
  if (d > 0 && f.last) { a.animMove = f.last; a.animShown = true; a.moveCue = true; }
  else a.jump = true;
  if (i === n - 1) lessonSeen(a.lesson.k);
  renderCard(['fade', rm ? 0 : TEXT_OUT, 'board', 'land', 'text']);
}
/* the lesson met: seen for good (nl:skill), and done in its set */
function lessonSeen(k) {
  var s = skillLoad();
  if (s.ls[k]) return;
  s.ls[k] = Date.now();
  skillSave(s);
  track('lesson_seen');
}
function lessonDone(a) {
  var ss = ui.session;
  lessonSeen(a.lesson.k);
  if (ss && !ss.results[a.key]) { ss.results[a.key] = 'lesson'; saveSession(); }
}
/* the band of a lesson frame: its caption and the honey "Lesson" tag */
function lessonBand(a) {
  return { disc: 'king', kind: 'lesson', cap: lessonFrame(a, a.lesson.i).cap, tag: CARD_COPY.P2() };
}
function lessonSlots(a) {
  var i = a.lesson.i;
  return [{ act: 'lessonBack', label: '‹', cls: 'nav-btn' + (i === 0 ? ' nav-off' : ''), off: i === 0, aria: 'Back one step' },
          { act: 'lessonFwd', label: 'Next ›', cls: 'btn-big', aria: 'Next, step ' + Math.min(3, i + 2) + ' of 3' }];
}

/* ── which skill an own card trains (F9.3's lessons) ── */
var PATTERN_SKILL = { missedMaterial: 'free', hung: 'safety', threat: 'safety', material: 'safety', badTrade: 'count', mateMissed: 'mate1',
                      mateAllowed: 'stopmate', kingSafety: 'stopmate', forkAllowed: 'fork', pinAllowed: 'pin', discoveredAllowed: 'hidden', promotion: 'pawns' };
/* a mate by a rook or a queen on the mated king's back rank, the king on it */
function backRankMate(st, m) {
  var x = cloneState(st);
  applyMove(x, m);
  if (!isMate(x)) return false;
  var k = kingSq(x.b, x.w), back = x.w ? 0 : 7, t = pType(x.b[m.to]);
  return k >= 0 && (k >> 3) === back && (m.to >> 3) === back && (t === 'R' || t === 'Q');
}
var skillMemo = {};
function cardSkill(it) {
  if (!it || !it.b || it.foil || it.prac || it.lesson) return null;
  var mk = it.key + '|' + (it.b.t || '') + '|' + (it.b.bu || '');
  if (skillMemo[mk] !== undefined) return skillMemo[mk];
  var t = patternOf(it.b), k = PATTERN_SKILL[t] || null;
  try {
    var pre = stateAtPly(it.g.mv, it.b.p), best = pre && it.b.bu ? uciToMove(pre, it.b.bu) : null;
    if (t === 'missedTactic' && best) {
      var d = moveDoes(pre, best.from, best.to) || {};
      k = d.mate ? 'mate1' : d.fork ? 'fork' : d.pin ? 'pin' : 'free';
    }
    if (t === 'mateMissed' && best && backRankMate(pre, best)) k = 'backrank';
    if (t === 'mateAllowed' && pre) {
      var post = cloneState(pre), pm = uciToMove(pre, uciOfSan(it.g.mv, it.b.p)), r0 = unpackUci(it.b.ru)[0];
      if (pm) { applyMove(post, pm); var rm = r0 && uciToMove(post, r0); if (rm && backRankMate(post, rm)) k = 'backrank'; }
    }
  } catch (e) { }
  skillMemo[mk] = k;
  return k;
}
/* the own positions each skill would train, for the costliest "Next" */
function ownSkillCounts() {
  var n = {};
  allMistakes().forEach(function (it) { if (trainable(it)) { var k = cardSkill(it); if (k) n[k] = (n[k] || 0) + 1; } });
  return n;
}
/* the coming skill (F9.5's "Next"): not mastered, every skill before it
   mastered, the one with most of the player's own positions first, then
   in path order; null once all are mastered */
function nextSkill(s) {
  s = s || skillLoad();
  var cnt = ownSkillCounts();
  var c = PSKILL.filter(function (x) { return !skillMastered(s, x.k) && x.pre.every(function (p) { return skillMastered(s, p); }); });
  c.sort(function (x, y) { return (cnt[y.k] || 0) - (cnt[x.k] || 0) || x.n - y.n; });
  return c[0] || null;
}

/* ── packs (F9.4) ── */
var PACK_N = 5;
/* a skill's positions at a step; an empty step takes the nearest lower one,
   else the nearest higher */
function stepPool(k, st) {
  var all = pracData().bySkill[k] || [], at = function (x) { return all.filter(function (p) { return pracStep(p) === x; }); };
  if (at(st).length) return at(st);
  for (var lo = st - 1; lo >= 1; lo--) if (at(lo).length) return at(lo);
  for (var hi = st + 1; hi <= 3; hi++) if (at(hi).length) return at(hi);
  return [];
}
/* n positions of skill k at its step, never one in avoid, those met lately
   last (the longest ago first), the rest in a day's own order. A lesson
   position and its mirror (id + 'm') count as one: never both in a pack,
   and either met lately makes both so */
function pracBase(id) { return String(id).replace(/m$/, ''); }
function packKeys(k, n, avoid) {
  var s = skillLoad(), r = s.k[k] || { st: 1 }, rc = s.rc.map(pracBase), day = dayStamp(), used = {};
  var h = function (x) { var v = 0; for (var i = 0; i < x.length; i++) v = (v * 31 + x.charCodeAt(i)) | 0; return v >>> 0; };
  (avoid || []).forEach(function (x) { if (isPracKey(x)) used[pracBase(x.slice(3))] = 1; });
  var pool = stepPool(k, r.st || 1).filter(function (p) { return (avoid || []).indexOf('pk:' + p.id) < 0; });
  pool.sort(function (x, y) {
    var ix = rc.indexOf(pracBase(x.id)), iy = rc.indexOf(pracBase(y.id));
    return (ix < 0 ? -1 : 1) - (iy < 0 ? -1 : 1) || (ix >= 0 ? iy - ix : 0) || h(x.id + day) - h(y.id + day);
  });
  var out = [];
  pool.forEach(function (p) { if (out.length < n && !used[pracBase(p.id)]) { used[pracBase(p.id)] = 1; out.push('pk:' + p.id); } });
  /* a step with fewer positions than that: the mirrors too */
  pool.forEach(function (p) { if (out.length < n && out.indexOf('pk:' + p.id) < 0) out.push('pk:' + p.id); });
  return out;
}
/* a pack: its lesson and that lesson's own position first while unseen,
   then positions of the skill's step to five positions; no date moves */
function startPack(k) {
  var sk = PSKILL_OF[k];
  if (!sk) return;
  var s = skillLoad(), keys = [];
  if (!s.ls[k] && sk.lesson && pracData().byId[sk.tryId]) keys.push('ls:' + k, 'pk:' + sk.tryId);
  keys = keys.concat(packKeys(k, PACK_N - (keys.length ? 1 : 0), keys));
  if (!keys.length) { notice('No practice positions for this skill yet.'); return; }
  closeSheet();
  startSession('pack', keys, sk.name, { type: 'pack', k: k });
}
/* the lesson alone, from the skill's card: its frames and its position */
function startLesson(k) {
  var sk = PSKILL_OF[k];
  if (!sk || !pracData().byId[sk.tryId]) return;
  closeSheet();
  startSession('pack', ['ls:' + k, 'pk:' + sk.tryId], sk.name, { type: 'pack', k: k, lesson: 1 });
}
/* a step that changed during a pack: its positions still to come follow it */
function packAdapt(ss, a) {
  if (!ss || !ss.spec || ss.spec.type !== 'pack' || !a.pr || !(a.pr.up || a.pr.down)) return;
  var rest = [];
  for (var i = ss.idx + 1; i < ss.keys.length; i++) if (isPracKey(ss.keys[i]) && !ss.results[ss.keys[i]]) rest.push(i);
  if (!rest.length) return;
  var fresh = packKeys(a.it.skill, rest.length, ss.keys);
  rest.forEach(function (i, j) { if (fresh[j]) ss.keys[i] = fresh[j]; });
  saveSession();
}

/* ── practice in Today's sets (F9.3, F9.4, R5) ──
   At More help, from the player's second set on (a set finished before,
   startLoad), in Today's set and an extra set: before the first card (never
   card 1) of a skill whose lesson is unseen, that lesson and its own
   position; then one mixed review from the mastered skills in turn. At
   most one position in five is practice (R5); the set keeps its number of
   positions, so the last own ones wait (still due, or new) */
function withPractice(keys, mode) {
  if ((mode !== 'today' && mode !== 'more') || playerTier() !== 1 || !startLoad()) return keys;
  var own = keys.filter(function (k) { return !isFoilKey(k); }).length, cap = Math.floor(keys.length / 5);
  if (!cap || own < 2) return keys;
  var out = keys.slice(), s = skillLoad(), used = 0, keep = {};
  for (var i = 1; i < out.length; i++) {
    var it = itemOf(out[i]), k = it && cardSkill(it), sk = k && PSKILL_OF[k];
    if (!sk || s.ls[k] || !pracData().byId[sk.tryId]) continue;
    /* the card the lesson is for stays in the set */
    keep[out[i]] = 1;
    out.splice(i, 0, 'ls:' + k, 'pk:' + sk.tryId);
    used++;
    break;
  }
  if (used < cap) {
    var mk = nextMixed(s), pk = mk ? packKeys(mk, 1, out)[0] : null;
    if (pk) { out.splice(Math.max(1, Math.floor(out.length / 2)), 0, pk); used++; s.mx = mk; skillSave(s); }
  }
  for (var j = out.length - 1; j > 0 && used > 0; j--) {
    var x = out[j];
    if (isPracKey(x) || isLessonKey(x) || isFoilKey(x) || keep[x]) continue;
    out.splice(j, 1);
    used--;
  }
  return out;
}
/* the mastered skill whose turn it is for the mixed review (after the last
   one used, in path order); null with none mastered */
function nextMixed(s) {
  var m = PSKILL.filter(function (x) { return skillMastered(s, x.k); });
  if (!m.length) return null;
  var at = m.map(function (x) { return x.k; }).indexOf(s.mx);
  return m[(at + 1) % m.length].k;
}

/* ── the meter, the tiles and the skill's card (F9.5) ── */
/* a skill's last ten practice positions as 10 dots, lit for a first try,
   in the order played, the empty ones outlined; with its words */
function skillDots(r) {
  var h = (r && r.h) || [], out = '';
  for (var i = 0; i < 10; i++) out += '<i' + (i < h.length ? ' class="' + (h[i][1] ? 'on' : 'off') + '"' : '') + '></i>';
  return '<span class="sk-dots" aria-hidden="true">' + out + '</span>';
}
/* "4 of 5 first try" (the last ten at most), "3 tried" while none was,
   "Not started" before the first */
function skillWords(r) {
  var h = (r && r.h) || [], f = h.filter(function (x) { return x[1]; }).length;
  if (!h.length) return 'Not started';
  return f ? f + ' of ' + h.length + ' first try' : plur(h.length, 'tried', 'tried');
}
/* its state: Mastered (and Needs polish), else the meter's words */
function skillState(s, k) {
  var r = s.k[k];
  if (r && r.m) return r.np ? 'Needs polish' : 'Mastered';
  return skillWords(r);
}
/* Insights at More help opens with these (F9.5): ten tiles in path order,
   each its number (the seal once mastered), its name, its meter and its
   state, "Next" on the coming one; a tap opens its card */
function skillTilesHtml() {
  var s = skillLoad(), nx = nextSkill(s);
  return '<section class="sk-tiles" aria-label="Your skills"><h3 class="ins-h">Your skills</h3><div class="sk-grid">' + PSKILL.map(function (x) {
    var r = s.k[x.k], done = skillMastered(s, x.k), next = !!nx && nx.k === x.k;
    return '<a class="sk-tile' + (done ? ' is-done' : '') + (next ? ' is-next' : '') + '" data-act="sheet" data-k="skill:' + x.k + '">'
      + '<span class="sk-head"><span class="sk-num' + (done ? ' rg rg-learned' : '') + '" aria-hidden="true">' + (done ? '' : x.n) + '</span>'
      + '<span class="sk-name">' + esc(x.name) + '</span></span>'
      + skillDots(r) + '<span class="sk-foot"><span class="sk-state">' + esc(skillState(s, x.k)) + '</span>' + (next ? '<span class="pill">Next</span>' : '') + '</span></a>';
  }).join('') + '</div></section>';
}
/* the skill's card (a sheet): its idea, its meter, Practise 5 (its lesson
   first while unseen) and its lesson; practice positions are not the
   player's own and move no date */
function skillSheetHtml(k) {
  var sk = PSKILL_OF[k];
  if (!sk) return '';
  var s = skillLoad(), r = s.k[k], nx = nextSkill(s), st = skillState(s, k);
  return '<div class="kicker">Skill ' + sk.n + ' of 10</div><h3>' + esc(sk.name) + '</h3>'
    + '<p class="sheet-sum">' + esc(sk.idea) + '</p>'
    + '<div class="sk-meter">' + skillDots(r) + '<span class="sk-state">' + esc(st) + '</span>' + (nx && nx.k === k ? '<span class="pill">Next</span>' : '') + '</div>'
    + '<div class="acts-row sheet-acts"><a class="btn-big" data-icon="play" data-act="pack" data-k="' + k + '">Practise ' + PACK_N + '</a>'
    + '<a class="btn-line" data-act="lesson" data-k="' + k + '">' + (s.ls[k] ? 'See the lesson again' : 'See the lesson') + '</a></div>'
    + '<p class="dt-more">Practice positions, from lessons and other players\' games. They never change when your own positions come back.</p>';
}
/* ── the summary ── */
/* the practice in a set, apart from the score (F9.4): "Practice: 4 of 5
   first try." ('' with none answered) */
function pracWords(ss, keys) {
  var n = 0, f = 0;
  keys.forEach(function (k) { var e = ss.sum && ss.sum[k]; if (e && e.prac && e.c !== 'skip') { n++; if (e.c === 'first') f++; } });
  return n ? 'Practice: ' + f + ' of ' + n + ' first try.' : '';
}
/* a practice position's tile: its board (no arrow: no game move), its
   skill, "Practice", its result as glyph and word */
function pracTileHtml(it, e) {
  var st = stateFromFen(it.fen), sk = PSKILL_OF[it.skill];
  if (!st) return '';
  var done = e.c !== 'skip' && e.c !== 'shown' && e.c !== 'left';
  return '<div class="recap-item recap-prac">' + boardSvg(st, { flip: it.g.color === 'black', decor: true })
    + '<span>' + esc(sk ? sk.name : 'Practice') + ' · Practice</span>' + resultGlyph(e.c) + '<span class="res' + (done ? '' : ' shown') + '">' + CAT_WORD[e.c] + '</span></div>';
}
/* the end of a pack: the result row, "Practice: 4 of 5 first try." and
   the second line, what the pack did to the skill (mastered with its
   seal, a step up or down), its meter, the week, the tiles, and Practise 5
   more. No ladder moves: nothing here is the player's own */
function packDoneHtml(ss) {
  var uniq = [], fx = !ss.fxShown, row = '', sk = PSKILL_OF[(ss.spec || {}).k] || null;
  ss.keys.forEach(function (k) { if (uniq.indexOf(k) === -1) uniq.push(k); });
  var tiles = uniq.map(function (k) {
    var it = itemOf(k), e = sumOf(ss, k);
    if (!it || !it.prac || !e || !ss.results[k]) return '';
    row += resultGlyph(e.c);
    return pracTileHtml(it, e);
  }).join('');
  var n = 0, first = 0, by = {};
  uniq.forEach(function (k) { var e = ss.sum && ss.sum[k]; if (!e || !e.prac || e.c === 'skip') return; n++; if (e.c === 'first') first++; else by[e.c] = (by[e.c] || 0) + 1; });
  /* its second line as the summary's (V4.3): never "Then ..." */
  var then = playerTier() === 1 ? foundWords(by, 0) : thenWords(by);
  var s = skillLoad(), r = sk ? s.k[sk.k] : null, gm = ss.goalMet;
  var did = ss.packMastered ? '<p class="recap-then pack-mastered"><span class="rg rg-learned"' + (fx ? ' data-fx="seal"' : '') + ' aria-hidden="true"></span> Mastered: ' + esc(sk.name) + '.</p>'
    : ss.packUp ? '<p class="recap-small">Up a step: ' + (r && r.st >= 2 ? 'positions from other players\' games next.' : 'harder positions next.') + '</p>'
    : ss.packDown ? '<p class="recap-small">A step back: easier positions next.</p>' : '';
  var week = gm ? weekHtml(fx, goalMetWords(gm)) : weekHtml();
  return '<div class="card-top recap-top">' + sessionBarHtml(ss, null) + '</div>'
    + '<div class="today recap-page pack-page">'
    + (row ? '<div class="result-row" aria-hidden="true">' + row + '</div>' : '')
    + '<h2 class="done-big" id="recap-h" tabindex="-1">' + (n ? 'Practice: ' + first + ' of ' + n + ' first try.' : 'Lesson done.') + '</h2>'
    + (then ? '<p class="recap-then">' + then + '</p>' : '')
    + did
    + (sk ? '<div class="sk-meter recap-sk">' + skillDots(r) + '<span class="sk-state">' + esc(sk.name) + ' · ' + esc(skillState(s, sk.k)) + '</span></div>' : '')
    + '<div class="recap-week' + (gm ? ' met' : '') + '"><div class="kicker">This week</div>' + week + '</div>'
    + (tiles ? '<div class="recap">' + tiles + '</div>' : '')
    + '<p class="dt-more">Practice positions never change when your own positions come back.</p>'
    + '<div class="acts-row recap-acts">'
      + (sk ? '<a class="btn-big" data-icon="arrow" data-act="pack" data-k="' + sk.k + '">Practise ' + PACK_N + ' more</a>' : '')
      + '<a class="' + (sk ? 'btn-line' : 'btn-big') + '" data-act="endSession">Back to Today</a>'
    + '</div></div>';
}
/* At More help, under the next set: "Or practise Piece safety ›", a pack
   of the coming skill (no dates move) */
function packOfferHtml() {
  if (playerTier() !== 1) return '';
  var nx = nextSkill();
  return nx ? '<p class="pack-offer"><a data-act="pack" data-k="' + nx.k + '">Or practise ' + esc(nx.name) + ' ›</a></p>' : '';
}
/* a practice position's Details: not from the player's games, where it is
   from, the move found (or the answer) and what it does, the other moves
   accepted, the skill's idea. A move reads in words at tier 1, else in SAN
   with its case kept: "Your move: g6. That stops the mate.", "Also good:
   h6." (V3.2; a capital would make a pawn's file a piece, "B6") */
function pracDetailsHtml(a) {
  var it = a.it, sk = PSKILL_OF[it.skill], mv = a.found || a.best;
  var say = function (m) { return inWords(a) ? moveWords(a.pre, m) : sanOf(a.pre, m); }, claim = pracClaim(a.pre, mv, it.skill);
  var other = it.ok.filter(function (u) { return u !== moveUci(mv); }).map(function (u) { return say(uciToMove(a.pre, u)); });
  return '<div class="kicker">Details</div><p class="ctx">' + (it.src === 'R' ? 'From another player\'s game, rated about ' + it.band + '.' : 'A lesson position.') + '</p>'
    + '<div class="dt-lines"><p class="dt-line tl-good"><span class="tl-dot" aria-hidden="true"></span><span>' + (a.found ? 'Your move: ' : 'The answer: ') + esc(say(mv)) + '.' + (claim ? ' ' + esc(claim) : '') + '</span></p>'
    + (other.length ? '<p class="dt-line tl-alt"><span class="tl-dot" aria-hidden="true"></span><span>' + esc('Also good: ' + other.join(', ') + '.') + '</span></p>' : '') + '</div>'
    + '<p class="dt-more">Practice position, not from your games.</p>'
    + (sk ? '<p class="habit">' + esc(sk.name) + ': ' + esc(sk.idea) + '</p>' : '');
}
