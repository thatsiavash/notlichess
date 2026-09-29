/* ── Patterns: one name per mistake, and the sentences that explain it ─────
   Every word here is backed by something computed: a motif found on the
   board, a material count at a settled position, or a mate the engine
   proved. When nothing concrete is there, the text says only what the
   evaluation says. */

var PIECE_WORD = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

/* The pattern registry. `side`: 'allowed' = what your move let the opponent
   do; 'missed' = what you could have done; 'eval' = no concrete tactic. */
var PATTERNS = [
  { key: 'mateAllowed', side: 'allowed', name: 'Walked into mate', plural: 'Walking into mate',
    habit: 'Before every move, look at every check your opponent could give.' },
  { key: 'mateMissed', side: 'missed', name: 'Missed a checkmate', plural: 'Missed checkmates',
    habit: 'When their king is short of squares, look at every check you have.' },
  { key: 'missedMaterial', side: 'missed', name: 'Missed a free piece', plural: 'Free pieces missed',
    habit: 'After every opponent move, ask: did they leave anything undefended?' },
  { key: 'missedTactic', side: 'missed', name: 'Missed a winning tactic', plural: 'Missed tactics',
    habit: 'Checks, captures, threats: look at your own forcing moves first.' },
  { key: 'forkAllowed', side: 'allowed', name: 'Walked into a fork', plural: 'Forks',
    habit: 'Look for squares where one enemy piece could hit two of yours.' },
  { key: 'pinAllowed', side: 'allowed', name: 'Walked into a pin', plural: 'Pins and skewers',
    habit: 'Pieces lined up with your king or queen are targets. Take them off the line.' },
  { key: 'discoveredAllowed', side: 'allowed', name: 'Missed a hidden attack', plural: 'Hidden attacks',
    habit: 'Watch enemy pieces standing in front of their rooks, bishops and queen.' },
  { key: 'threat', side: 'allowed', name: 'Ignored a threat', plural: 'Ignored threats',
    habit: 'Every turn, ask first: what does their last move threaten?' },
  { key: 'badTrade', side: 'allowed', name: 'Bad trade', plural: 'Bad trades',
    habit: 'Before you capture, count attackers and defenders on that square.' },
  { key: 'hung', side: 'allowed', name: 'Left a piece hanging', plural: 'Hanging pieces',
    habit: 'Before you let go of a piece: what does this move leave undefended?' },
  { key: 'promotion', side: 'allowed', name: 'Let a pawn through', plural: 'Runaway pawns',
    habit: 'A passed pawn is a runaway. Put a piece in front of it early.' },
  { key: 'material', side: 'allowed', name: 'Lost material to a tactic', plural: 'Lost to a tactic',
    habit: 'Before you move, look at every capture your opponent will have next.' },
  { key: 'kingSafety', side: 'eval', name: 'Exposed your king', plural: 'King safety',
    habit: 'The pawns in front of your castled king do not move without a concrete reason.' },
  { key: 'slipped', side: 'eval', name: 'Let the win slip', plural: 'Wins let slip',
    habit: 'When you are winning: trade pieces, keep your king safe, take no risks.' },
  { key: 'openingSlip', side: 'eval', name: 'Opening slip', plural: 'Opening slips',
    habit: 'In the opening: develop a new piece each move, castle, and don\'t move a piece twice.' },
  { key: 'drift', side: 'eval', name: 'A planless middlegame move', plural: 'Planless middlegame moves',
    habit: 'When nothing is happening, ask: which of my pieces is doing nothing?' },
  { key: 'endgame', side: 'eval', name: 'Endgame mistake', plural: 'Endgame mistakes',
    habit: 'In the endgame, bring your king into the game. It is a strong piece now.' }
];
var PATTERN = {};
PATTERNS.forEach(function (p, i) { p.rank = i; PATTERN[p.key] = p; });

/* the index after which material is settled: two quiet plies in a row
   (no capture, check or promotion) and nothing left en prise for the side
   to move, or the end of the line */
function settleIndex(line) {
  var n = line.nodes;
  var quiet = function (x) {
    return !x || (!x.captured && !x.move.promo && !checkersOf(x.after).length);
  };
  for (var i = 1; i < n.length; i++) {
    if (quiet(n[i + 1]) && quiet(n[i + 2]) && !enPrise(n[i].after)) return endCapture(n, i);
  }
  return endCapture(n, n.length - 1);
}
/* material is still in motion: the side to move can take something for
   profit (a loose piece, or one attacked by a cheaper piece; kings and pawns
   aside), or it faces a double attack it cannot fully meet (two of its own
   pieces en prise, or one while in check) */
function enPrise(st) {
  var b = st.b, own = 0;
  for (var sq = 0; sq < 64; sq++) {
    var p = b[sq];
    if (!p || pType(p) === 'K' || pType(p) === 'P') continue;
    var mine = colorW(p) === st.w;
    if (!attackersOf(b, sq, !colorW(p)).length) continue;
    if (!isHangingAt(b, sq) && !takenByLower(b, sq)) continue;
    if (!mine) return true;
    own++;
  }
  if (!own) return false;
  var k = kingSq(b, st.w);
  return own >= 2 || (k >= 0 && attackersOf(b, k, !st.w).length > 0);
}
/* the engine's line can stop on a capture before the recapture: a defended
   piece taken on the last move is not counted as won */
function endCapture(n, i) {
  if (i === n.length - 1 && i >= 1 && n[i].captured && !isHangingAt(n[i].before.b, n[i].move.to)) return i - 1;
  return i;
}
function materialWord(n) {
  n = Math.abs(n);
  if (n <= 0) return '';
  if (n === 1) return 'a pawn';
  if (n === 2) return 'two pawns';
  if (n === 3) return 'a piece';
  if (n === 4) return 'a piece and a pawn';
  if (n === 5) return 'a rook';
  if (n >= 9) return 'the queen';
  return 'a lot of material';
}
/* what changed hands along a line, from the pov side's view: "the knight",
   "the exchange", "a knight for a pawn". Equal swaps cancel out, identical
   pieces first, then a knight against a bishop. `from` is 1 for lines that
   open with a null move or with the pov side's own move left out, 0 to count
   the game move's own capture too. */
function captureWord(line, upto, from) {
  var gained = [], lost = [], start = from == null ? 1 : from;
  for (var k = Math.max(1, start); k <= upto && k < line.nodes.length; k++) if (line.nodes[k].move && line.nodes[k].move.promo) return null;
  for (var i = start; i <= upto && i < line.nodes.length; i++) {
    var n = line.nodes[i];
    if (!n.captured) continue;
    (n.pov ? gained : lost).push(pType(n.captured));
  }
  var cancel = function (cross) {
    for (var g = gained.length - 1; g >= 0; g--) {
      var j = lost.indexOf(gained[g]);
      if (j === -1 && cross && (gained[g] === 'N' || gained[g] === 'B')) j = lost.indexOf(gained[g] === 'N' ? 'B' : 'N');
      if (j !== -1) { gained.splice(g, 1); lost.splice(j, 1); }
    }
  };
  cancel(false);
  cancel(true);
  var byVal = function (a, b) { return MOTIF_VAL[b] - MOTIF_VAL[a]; };
  gained.sort(byVal); lost.sort(byVal);
  var words = function (list) {
    var c = {};
    list.forEach(function (p) { c[p] = (c[p] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return MOTIF_VAL[b] - MOTIF_VAL[a]; }).slice(0, 2).map(function (p) {
      return c[p] === 1 ? 'a ' + PIECE_WORD[p] : (c[p] === 2 ? 'two ' : c[p] + ' ') + PIECE_WORD[p] + 's';
    }).join(' and ');
  };
  if (!gained.length) return null;
  if (gained.length === 1 && !lost.length) return 'the ' + PIECE_WORD[gained[0]];
  if (gained.length === 1 && lost.length === 1 && gained[0] === 'R' && (lost[0] === 'N' || lost[0] === 'B'))
    return 'the exchange';
  return words(gained) + (lost.length ? ' for ' + words(lost) : '');
}
function sqWord(sq) { return String.fromCharCode(97 + sq % 8) + (1 + (sq >> 3)); }
function lineSans(line, upto) {
  var out = [];
  for (var i = 1; i <= upto && i < line.nodes.length; i++) out.push(sanOf(line.nodes[i].before, line.nodes[i].move));
  return out;
}

/* opening / middlegame / endgame, by what is on the board: endgame once
   six or fewer pieces (not pawns or kings) remain, opening while it is
   early (before move 13) and most pieces are still on */
function phaseOf(st, ply) {
  var pieces = 0;
  for (var i = 0; i < 64; i++) {
    var p = st.b[i];
    if (p && 'NBRQnbrq'.indexOf(p) !== -1) pieces++;
  }
  if (pieces <= 6) return 'end';
  if (ply < 24 && pieces >= 11) return 'open';
  return 'mid';
}
/* the game move weakened the king: a pawn in front of a castled king
   moved, or the king walked off its shelter */
function loosensKing(pre, m) {
  if (!m) return false;
  var p = pre.b[m.from], meW = pre.w, k = kingSq(pre.b, meW);
  if (k < 0 || !p) return false;
  var home = meW ? 0 : 7, kf = k % 8;
  if (pType(p) === 'K' && !m.castle) return (k >> 3) === home && Math.abs((m.to >> 3) - home) >= 1;
  if (pType(p) !== 'P' || (k >> 3) !== home) return false;
  var ff = m.from % 8;
  return (kf >= 5 && ff >= 5) || (kf <= 2 && ff <= 2);
}
/* the index at which the first blow has landed: from the line's first
   capture, the first point that two quiet plies follow. A line that later
   hands material back must not hide the blow (a bad capture stays bad). */
function blowIndex(line) {
  var n = line.nodes, c = -1;
  for (var i = 1; i < n.length; i++) if (n[i].captured) { c = i; break; }
  if (c < 0) return -1;
  var quiet = function (x) { return !x || (!x.captured && !x.move.promo && !checkersOf(x.after).length); };
  for (var j = c; j < n.length; j++) if (quiet(n[j + 1]) && quiet(n[j + 2])) return endCapture(n, j);
  return endCapture(n, n.length - 1);
}
function pieceCount(b) {
  var k = 0;
  for (var i = 0; i < 64; i++) if (b[i] && 'NBRQnbrq'.indexOf(b[i]) !== -1) k++;
  return k;
}
/* every move of one side in the first plies of a line is a check */
function checksAll(line, first) {
  var n = 0, all = true;
  for (var i = first; i < Math.min(line.nodes.length, first + 6); i += 2) {
    n++;
    if (!checkersOf(line.nodes[i].after).length) all = false;
  }
  return all && n >= 3;
}
/* input: pre = position before my move (me to move); played = my game move
   (UCI); best = { pv: [uci...], mate: n|null } from MY point of view
   (mate > 0: I mate in n; < 0: I get mated); after = { pv: [uci...],
   mate: n|null } for the position after my move, also from MY point of view;
   wb/wa = my win chance before/after (0-100).
   output: { t: pattern key, tags: {...}, matGame, matBest, sentences } */
function classifyMistake(pre, played, best, after, wb, wa, ply) {
  var meW = pre.w;
  var gameLine = buildLine(pre, played, (after && after.pv || []).slice(0, 8), !meW);
  var bestLine = best && best.pv && best.pv.length ? buildLine(pre, '0000', best.pv.slice(0, 8), meW) : null;
  var allowed = gameLine ? lineMotifs(gameLine) : {};
  var missed = bestLine ? lineMotifs(bestLine) : {};
  var mat0 = matDiff(pre.b, meW);
  var gSettle = gameLine ? settleIndex(gameLine) : 0;
  var bSettle = bestLine ? settleIndex(bestLine) : 0;
  var matGame = gameLine ? matDiff(gameLine.nodes[gSettle].after.b, meW) - mat0 : 0;
  var matBest = bestLine ? matDiff(bestLine.nodes[bSettle].after.b, meW) - mat0 : 0;
  var n0 = gameLine && gameLine.nodes[0], r1 = gameLine && gameLine.nodes[1];
  var gBlow = gameLine ? blowIndex(gameLine) : -1;
  var matBlow = gBlow > 0 ? matDiff(gameLine.nodes[gBlow].after.b, meW) - mat0 : 0;
  var MATE_MAX = 10;
  var mateAgainst = after && after.mate != null && after.mate < 0 && -after.mate <= MATE_MAX ? -after.mate : null;
  var mateFor = best && best.mate != null && best.mate > 0 && best.mate <= MATE_MAX ? best.mate : null;
  var alreadyLost = best && best.mate != null && best.mate < 0;
  var stillMating = after && after.mate != null && after.mate > 0;
  /* the loss is the bigger of the settled balance and the first blow, when
     the opponent's first reply is the capture that starts it */
  var blowFirst = !!(r1 && r1.captured) && -matBlow > -matGame;
  var lossG = blowFirst ? -matBlow : -matGame, gainB = matBest, t;
  var lossAt = blowFirst ? gBlow : gSettle;
  /* the tactic that did the damage: the earliest within the first four
     plies of the refutation and before the material settles */
  var horizon = Math.min(8, Math.max(1, lossAt));
  var tactics = [];
  var add = function (m, key, rank) { if (m && (m.ply == null || m.ply <= horizon)) tactics.push({ t: key, ply: m.ply == null ? 1 : m.ply, rank: rank }); };
  add(allowed.fork, 'forkAllowed', 0);
  add(allowed.discoveredAttack, 'discoveredAllowed', 1);
  if (allowed.doubleCheck) add({ ply: 1 }, 'discoveredAllowed', 1);
  if (allowed.pin && allowed.pin.piece !== 'P') add(allowed.pin, 'pinAllowed', 2);
  add(allowed.skewer, 'pinAllowed', 2);
  tactics.sort(function (a, b) { return a.ply - b.ply || a.rank - b.rank; });
  var edge = gainB - matGame;
  var sameCapture = bestLine && bestLine.nodes[1] && n0 && bestLine.nodes[1].captured
    && n0.captured && bestLine.nodes[1].move.to === n0.move.to;
  var checksAgainst = 0;
  if (gameLine) for (var ci = 1; ci < Math.min(gameLine.nodes.length, 7); ci += 2) {
    if (checkersOf(gameLine.nodes[ci].after).length) checksAgainst++;
  }
  var stalemate = !!(n0 && !legalMoves(n0.after).length && !checkersOf(n0.after).length);
  var perpetualAgainst = !!(gameLine && checksAll(gameLine, 1) && wa >= 35 && wa <= 65);
  /* king danger only where it is real: the move weakened the king, or the
     king still stands on its home rank with pieces around */
  var k = kingSq(pre.b, meW), kingHome = k >= 0 && (k >> 3) === (meW ? 0 : 7), pieces = pieceCount(pre.b);
  var kingCentral = k >= 0 && (k % 8) >= 2 && (k % 8) <= 5;
  var loosened = !!(n0 && loosensKing(pre, n0.move));
  var kingMoved = !!(n0 && pType(pre.b[n0.move.from]) === 'K' && !n0.move.castle);
  var kingExposed = loosened || (pieces >= 5 && (kingMoved || kingHome)) || (pieces >= 6 && kingCentral);
  /* a long forced mate that runs through a promotion is a pawn lesson */
  if (mateAgainst && mateAgainst > 5 && allowed.promotion) mateAgainst = null;
  /* nor does it hide a queen or rook taken on the spot */
  if (mateAgainst && mateAgainst > 5 && r1 && r1.captured && MOTIF_VAL[pType(r1.captured)] >= 5) mateAgainst = null;
  /* a capture answered on the same square by a cheaper piece: a bad trade,
     whatever the line gives back later */
  var myPiece = n0 ? pType(pre.b[n0.move.from]) : null;
  var badSwap = !!(n0 && n0.captured && r1 && r1.captured && r1.move.to === n0.move.to
    && MOTIF_VAL[myPiece] > MOTIF_VAL[pType(n0.captured)] + 1 && myPiece !== 'K');
  /* the reply takes a piece that stood where a cheaper piece could take it */
  var lowerTake = !!(r1 && r1.captured && n0 && pType(r1.captured) !== 'P' && pType(r1.before.b[r1.move.from]) !== 'K'
    && MOTIF_VAL[pType(r1.before.b[r1.move.from])] < MOTIF_VAL[pType(r1.captured)]);
  if (stalemate && wb >= 60) t = 'slipped';
  else if (perpetualAgainst && wb >= 60 && lossG <= 1 && !mateAgainst) t = 'slipped';
  else if (mateAgainst && !alreadyLost) t = 'mateAllowed';
  else if (mateFor && !stillMating && lossG < 5) t = 'mateMissed';
  else if (!(mateFor && lossG >= 5) && !sameCapture && gainB > lossG && (edge >= 2 || (edge >= 1 && gainB >= 1 && firstMoveTakesLoose(bestLine)))) {
    /* the bigger story is what you could have won */
    t = (missed.hangingPiece || firstMoveTakesLoose(bestLine)) ? 'missedMaterial' : 'missedTactic';
  }
  else if (lossG >= 1) {
    var loose = firstReplyTakesLoose(gameLine);
    /* an ignored threat when the capture is the damage; when a pawn grab
       only opens a fork or a pin, the tactic is the lesson */
    var threat = r1 && r1.captured && threatExisted(pre, gameLine)
      && (MOTIF_VAL[pType(r1.captured)] >= Math.min(lossG, 3) || !tactics.length);
    var tactic = tactics.length && (lossG >= 2 || tactics[0].t === 'forkAllowed') ? tactics[0].t : null;
    if (threat) t = 'threat';
    else if (tactic) t = tactic;
    else if (badSwap || (lossG >= 2 && n0 && n0.captured && r1 && r1.captured && r1.move.to === n0.move.to)) t = 'badTrade';
    else if (loose || allowed.hangingPiece || allowed.trappedPiece || (lowerTake && lossG >= 2)) t = 'hung';
    else if (lossG >= 2 && allowed.promotion) t = 'promotion';
    else if (lossG >= 2 || (r1 && r1.captured)) t = 'material';
  }
  if (!t && badSwap) t = 'badTrade';
  if (!t) {
    if (perpetualAgainst && wb >= 60) t = 'slipped';
    else if (allowed.promotion && wb - wa >= 20) t = 'promotion';
    else if (kingExposed && (checksAgainst >= 2 || (loosened && checksAgainst >= 1))) t = 'kingSafety';
    else if (wb >= 65 && wa < 60) t = 'slipped';
    else {
      var ph = phaseOf(pre, ply || 0);
      t = ph === 'open' ? 'openingSlip' : (ph === 'end' ? 'endgame' : 'drift');
    }
  }
  var res = {
    t: t, allowed: allowed, missed: missed, matGame: matGame, matBest: matBest,
    mateAgainst: mateAgainst, mateFor: mateFor, gameLine: gameLine, bestLine: bestLine,
    gSettle: gSettle, bSettle: bSettle, lossG: lossG, lossAt: lossAt, stalemate: stalemate,
    perpetualAgainst: perpetualAgainst, loosened: loosened, kingMoved: kingMoved, sameCapture: !!sameCapture,
    lowerTake: lowerTake, ply: ply || 0, alreadyLost: !!alreadyLost
  };
  res.sentences = explainMistake(res, pre, wb, wa);
  res.sentences.short = shortSentence(res.sentences.game);
  return res;
}
/* the piece the refutation takes was already attacked, and already short
   of defence, before my move: the threat was there and my move ignored it */
function threatExisted(pre, line) {
  if (!line || line.nodes.length < 2) return false;
  var r = line.nodes[1], sq = r.move.to, mine = line.nodes[0];
  if (!r.captured || mine.move && (mine.move.to === sq || mine.move.from === sq)) return false;
  if (pre.b[sq] !== r.captured) return false;
  var probe = cloneState(pre);
  probe.w = !probe.w; probe.ep = -1;
  var m = uciToMove(probe, sqWord(r.move.from) + sqWord(r.move.to) + (r.move.promo ? r.move.promo.toLowerCase() : ''));
  return !!m && (isHangingAt(pre.b, sq) || takenByLower(pre.b, sq));
}
/* the refutation opens by capturing something my move left undefended */
function firstReplyTakesLoose(line) {
  if (!line || line.nodes.length < 2) return false;
  var r = line.nodes[1];
  return !!(r.captured && isHangingAt(line.nodes[0].after.b, r.move.to));
}
function firstMoveTakesLoose(line) {
  if (!line || line.nodes.length < 2) return false;
  var m = line.nodes[1];
  return !!(m.captured && isHangingAt(line.nodes[0].after.b, m.move.to));
}

/* where the game stands after the damage, in words */
function standing(wa, them) {
  if (wa < 25) return 'you are losing';
  if (wa < 42) return them + ' is better';
  if (wa < 58) return 'it is roughly level';
  return 'you are still better, but only just';
}
/* what the better move does about the reply that hurt: it makes it
   illegal, takes the target away, or defends it */
function stopsWhat(c, pre) {
  var g = c.gameLine, bl = c.bestLine, r1 = g && g.nodes[1], b1 = bl && bl.nodes[1];
  if (!r1 || !b1 || !r1.move) return '';
  if (!(r1.captured || checkersOf(r1.after).length)) return '';
  var bestSan = sanOf(b1.before, b1.move), replySan = sanOf(r1.before, r1.move);
  var st = b1.after;
  var still = legalMoves(st).filter(function (m) { return m.from === r1.move.from && m.to === r1.move.to; })[0];
  if (!still) return bestSan + ' stops ' + replySan + '.';
  if (r1.captured) {
    var sq = r1.move.ep >= 0 ? r1.move.ep : r1.move.to, target = st.b[sq];
    if (!target && b1.move.from === sq) return bestSan + ' moves the ' + PIECE_WORD[pType(r1.captured)] + ' out of danger.';
    if (target && colorW(target) === pre.w && isDefended(st.b, sq) && isHangingAt(g.nodes[0].after.b, sq))
      return bestSan + ' defends the ' + PIECE_WORD[pType(target)] + ' on ' + sqWord(sq) + '.';
  }
  return '';
}
/* what the better move plainly does, when the board proves it: takes the
   piece that was about to strike, trades, castles or develops. Nothing
   here claims more than the move itself shows */
function whatItDoes(c, pre, ply) {
  var bl = c.bestLine, g = c.gameLine, b1 = bl && bl.nodes[1], r1 = g && g.nodes[1];
  if (!b1 || !b1.move) return '';
  var san = sanOf(b1.before, b1.move), mover = b1.before.b[b1.move.from], mt = pType(mover);
  var took = b1.captured ? pType(b1.captured) : null;
  if (took && r1 && r1.move && r1.move.from === b1.move.to && c.matBest >= 0)
    return san + ' takes the ' + PIECE_WORD[took] + (r1.captured ? ' before it can take your ' + PIECE_WORD[pType(r1.captured)] : (checkersOf(r1.after).length ? ' before it can give check' : '')) + '.';
  var b2 = bl.nodes[2];
  if (took && took === mt && b2 && b2.captured && b2.move.to === b1.move.to && c.matBest === 0)
    return san + (mt === 'Q' ? ' trades queens.' : ' trades ' + PIECE_WORD[mt] + 's.');
  if (b1.move.castle || (mt === 'K' && Math.abs(b1.move.to - b1.move.from) === 2)) return san + ' castles your king first.';
  var home = pre.w ? 0 : 7;
  if ((ply || 0) < 24 && (mt === 'N' || mt === 'B') && (b1.move.from >> 3) === home && !took) return san + ' develops the ' + PIECE_WORD[mt] + '.';
  if (mt === 'P' && !took && passedPawn(b1.after.b, b1.move.to, pre.w)) return san + ' pushes your passed pawn.';
  return '';
}
/* no enemy pawn ahead on its own file or the two next to it */
function passedPawn(b, sq, white) {
  var f = sq % 8, r = sq >> 3, enemy = white ? 'p' : 'P';
  for (var rr = white ? r + 1 : r - 1; white ? rr < 8 : rr >= 0; rr += white ? 1 : -1)
    for (var ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) if (b[rr * 8 + ff] === enemy) return false;
  return true;
}
/* Two sentences: what the game move did, and what the best move does. */
/* the same sentence for a small screen: the move and what it costs, without
   the path of moves or the percentages the board has just shown */
var SAN_RE = '(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?';
function shortSentence(s) {
  s = String(s || '')
    .replace(/ \(\d+% to \d+%\)/g, '')
    .replace(new RegExp(' after (?:' + SAN_RE + ' )*' + SAN_RE + '(?: and more)?\\.$'), '.');
  /* still too long for two lines: the material count goes, the move stays */
  return s.length > 84 ? s.replace(/ You lose [^.]*\.$/, '') : s;
}
function explainMistake(c, pre, wb, wa) {
  var g = c.gameLine, bl = c.bestLine;
  var n0 = g && g.nodes[0], r1 = g && g.nodes[1];
  var played = g ? sanOf(pre, g.nodes[0].move) : '?';
  var reply = g && g.nodes[1] ? sanOf(g.nodes[1].before, g.nodes[1].move) : null;
  var bestSan = bl && bl.nodes[1] ? sanOf(bl.nodes[1].before, bl.nodes[1].move) : null;
  var them = pre.w ? 'Black' : 'White';
  var at = c.lossAt != null ? c.lossAt : c.gSettle;
  var lost = captureWord(g || { nodes: [] }, at, 0) || materialWord(c.lossG != null ? -c.lossG : c.matGame);
  var won = bl ? (captureWord(bl, c.bSettle) || materialWord(c.matBest)) : '';
  var gameS, bestS, does;
  switch (c.t) {
    case 'mateAllowed':
      gameS = played + ' allows mate in ' + c.mateAgainst + (reply ? ', starting with ' + reply : '') + '.';
      break;
    case 'hung': {
      var hp = c.allowed.hangingPiece, tr = c.allowed.trappedPiece;
      var ep = r1 && r1.captured && r1.move.ep >= 0;
      var sq = hp ? hp.sq : (r1 && r1.captured ? (ep ? r1.move.ep : r1.move.to) : null);
      var pc = hp ? PIECE_WORD[hp.piece] : (r1 && r1.captured ? PIECE_WORD[pType(r1.captured)] : 'piece');
      if (tr && !hp) gameS = played + ' lets your ' + PIECE_WORD[tr.piece] + ' get trapped.';
      else if (!hp && c.lowerTake && r1 && r1.captured && !(n0.captured && sq === n0.move.to))
        gameS = played + ' puts your ' + pc + ' where ' + reply + ' takes it.';
      else if (n0.captured && sq === n0.move.to)
        gameS = played + ' takes a ' + PIECE_WORD[pType(n0.captured)] + ', but the ' + pc + ' is lost' + (reply ? ' to ' + reply : '') + '.';
      else gameS = played + ' leaves your ' + pc + (sq != null ? ' on ' + sqWord(sq) : '') + ' undefended' + (reply ? ': ' + reply + ' takes it' + (ep ? ' en passant' : '') : '') + '.';
      break;
    }
    case 'forkAllowed': {
      var f = c.allowed.fork, fm = g.nodes[f.ply];
      var targets = f.targets.map(function (s) { return PIECE_WORD[pType(fm.after.b[s])]; });
      var forkSan = sanOf(fm.before, fm.move);
      gameS = f.ply <= 1
        ? played + ' allows ' + forkSan + ', forking your ' + targets.slice(0, 2).join(' and ') + '.'
        : played + ' allows ' + lineSans(g, f.ply - 1).join(' ') + ', and then ' + forkSan + ' forks your ' + targets.slice(0, 2).join(' and ') + '.';
      break;
    }
    case 'pinAllowed': {
      var pinned = c.allowed.pin && PIECE_WORD[c.allowed.pin.piece];
      var skewerFirst = c.allowed.skewer && (!c.allowed.pin || c.allowed.pin.piece === 'P' || (c.allowed.skewer.ply || 9) < (c.allowed.pin.ply || 9));
      gameS = skewerFirst
        ? played + ' walks into a skewer: you lose ' + (lost || 'material') + '.'
        : (lost === 'the ' + pinned
            ? played + ' walks into a pin, and the pinned ' + pinned + ' is lost.'
            : played + ' walks into a pin: you lose ' + (lost || 'material') + '.');
      break;
    }
    case 'discoveredAllowed':
      gameS = played + ' allows a discovered ' + ((c.allowed.discoveredAttack && c.allowed.discoveredAttack.check) || c.allowed.doubleCheck ? 'check' : 'attack') + '. You lose ' + (lost || 'material') + '.';
      break;
    case 'badTrade': {
      var got = n0 && n0.captured ? PIECE_WORD[pType(n0.captured)] : 'piece';
      var gone = r1 && r1.captured ? PIECE_WORD[pType(r1.captured)] : 'piece';
      gameS = played + ' takes a ' + got + ', but ' + (reply || 'the reply') + ' takes your ' + gone + '.'
        + (lost && lost !== 'the ' + gone && lost !== 'a ' + gone + ' for a ' + got ? ' You lose ' + lost + '.' : '');
      break;
    }
    case 'kingSafety':
      gameS = played + (c.kingMoved ? ' walks your king into danger' : c.loosened ? ' opens up your king' : ' leaves your king exposed') + (reply ? ': after ' + reply + ' ' + them + ' attacks it' : '') + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
      break;
    case 'promotion':
      gameS = played + ' lets ' + them + '\'s pawn run through to promote.';
      break;
    case 'threat': {
      var took = r1 && r1.captured ? 'your ' + PIECE_WORD[pType(r1.captured)] : (lost || 'material');
      gameS = played + ' ignores ' + them + '\'s threat: ' + (reply || 'the reply') + ' takes ' + took + '.'
        + (lost && r1 && r1.captured && lost !== 'the ' + PIECE_WORD[pType(r1.captured)] ? ' You lose ' + lost + '.' : '');
      break;
    }
    case 'material': {
      var lastCap = 0;
      for (var li = 1; li <= at && li < g.nodes.length; li++) if (g.nodes[li].captured) lastCap = li;
      var shown = Math.min(Math.max(lastCap, 1), 4);
      gameS = played + ' loses ' + (lost || 'material') + (reply ? ' after ' + lineSans(g, shown).join(' ') + (lastCap > shown ? ' and more' : '') : '') + '.';
      break;
    }
    case 'mateMissed':
      gameS = played + ' lets a forced mate slip away.';
      break;
    case 'missedMaterial': {
      var bm = bl && bl.nodes[1], hp2 = c.missed.hangingPiece;
      var what = bm && bm.captured ? { piece: pType(bm.captured), sq: bm.move.ep >= 0 ? bm.move.ep : bm.move.to } : (hp2 ? { piece: hp2.piece, sq: hp2.sq } : null);
      gameS = what ? played + ' leaves ' + them + '\'s ' + PIECE_WORD[what.piece] + ' on ' + sqWord(what.sq) + ' undefended.'
        : played + ' misses a chance to win material.';
      break;
    }
    case 'missedTactic':
      gameS = played + ' misses ' + (bestSan || 'a stronger move') + '.';
      break;
    case 'slipped':
      if (c.stalemate) gameS = played + ' is stalemate: the win becomes a draw.';
      else if (c.perpetualAgainst) gameS = played + ' lets ' + them + ' force a draw with checks' + (reply ? ', starting with ' + reply : '') + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
      else gameS = played + ' lets your winning position slip' + (reply ? ': after ' + reply + ' ' + standing(wa, them) : '')
        + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
      break;
    case 'openingSlip':
    case 'endgame':
    case 'drift':
    default: {
      var r1n = g && g.nodes[1];
      var forcing = r1n && (r1n.captured || checkersOf(r1n.after).length) && !(r1n.captured && n0 && n0.captured && r1n.move.to === n0.move.to);
      var head = wb < 40 ? ' makes a difficult position worse'
        : (wa < 45 ? ' lets ' + them + ' take over' : (wa < 55 ? ' lets the game slip back to level' : ' gives back much of your advantage'));
      /* a reply that only takes the piece that just moved is not "strong":
         the damage comes after it */
      var takesBack = r1n && r1n.captured && n0 && r1n.move.to === n0.move.to;
      gameS = played + head + (forcing ? (takesBack ? ' after ' + reply : ': ' + reply + ' is strong') : '') + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
    }
  }
  var bestPiece = bl && bl.nodes[1] ? pType(bl.nodes[1].before.b[bl.nodes[1].move.from]) : null;
  var stop = (c.lossG >= 1 || c.mateAgainst) ? stopsWhat(c, pre) : '';
  if (!bl || !bestSan) bestS = '';
  else if (c.mateFor) bestS = bestSan + ' forces mate in ' + c.mateFor + '.';
  else if (c.missed.fork && c.matBest >= 2 && c.missed.fork.ply <= Math.max(1, c.bSettle)) {
    var mf = c.missed.fork, fn = bl.nodes[mf.ply];
    bestS = (mf.ply === 1 ? bestSan : bestSan + ' sets up ' + sanOf(fn.before, fn.move) + ', which')
      + ' forks the ' + mf.targets.slice(0, 2).map(function (s) { return PIECE_WORD[pType(fn.after.b[s])]; }).join(' and ') + '.';
  }
  else if (c.missed.pin && c.matBest >= 2 && c.missed.pin.ply === 1 && c.missed.pin.piece !== 'P') {
    var pw = PIECE_WORD[c.missed.pin.piece];
    bestS = won === 'the ' + pw ? bestSan + ' pins and wins the ' + pw + '.' : bestSan + ' pins the ' + pw + ' and wins ' + won + '.';
  }
  else if (c.sameCapture && bestPiece) bestS = 'Take back with the ' + PIECE_WORD[bestPiece] + ': ' + bestSan + '.';
  else if (c.matBest >= 1) bestS = bestSan + ' wins ' + won + '.';
  else if (checksAll(bl, 1) && wb >= 35 && wb <= 65) bestS = bestSan + ' forces a draw with checks.';
  else if (stop) bestS = stop;
  else if ((does = whatItDoes(c, pre, c.ply))) bestS = does;
  else if (c.mateAgainst && !c.mateFor && !c.alreadyLost && bl) bestS = bestSan + ' avoids the mate.';
  else if (c.matGame <= -1 && c.matBest >= c.matGame + 1 && c.matBest >= 0) {
    /* name what it keeps when the loss was one piece */
    var one = /^the (pawn|knight|bishop|rook|queen)$/.exec(lost || '');
    bestS = bestSan + (one ? ' keeps your ' + one[1] + ' safe.' : ' keeps everything safe.');
  }
  else bestS = bestSan + (wb >= 60 ? ' keeps your advantage.' : wb >= 40 ? ' keeps the game balanced.' : ' is the most stubborn defence.');
  return { game: gameS, best: bestS };
}
