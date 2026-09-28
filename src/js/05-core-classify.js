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
  { key: 'material', side: 'allowed', name: 'Lost material', plural: 'Material lost to combinations',
    habit: 'Before you move, look at every capture your opponent will have next.' },
  { key: 'kingSafety', side: 'eval', name: 'Exposed your king', plural: 'King safety',
    habit: 'The pawns in front of your castled king do not move without a concrete reason.' },
  { key: 'slipped', side: 'eval', name: 'Let the win slip', plural: 'Winning positions let slip',
    habit: 'When you are winning: trade pieces, keep your king safe, take no risks.' },
  { key: 'openingSlip', side: 'eval', name: 'Opening slip', plural: 'Opening slips',
    habit: 'In the opening: develop a new piece each move, castle, and don\'t move a piece twice.' },
  { key: 'drift', side: 'eval', name: 'Drifted into a worse position', plural: 'Middlegame drift',
    habit: 'When nothing is happening, ask: which of my pieces is doing nothing?' },
  { key: 'endgame', side: 'eval', name: 'Endgame technique', plural: 'Endgame technique',
    habit: 'In the endgame, bring your king into the game. It is a strong piece now.' }
];
var PATTERN = {};
PATTERNS.forEach(function (p, i) { p.rank = i; PATTERN[p.key] = p; });

/* the index after which material is settled: two quiet plies in a row
   (no capture, check or promotion), or the end of the line */
function settleIndex(line) {
  var n = line.nodes;
  for (var i = 1; i < n.length; i++) {
    var q1 = n[i + 1], q2 = n[i + 2];
    var quiet = function (x) {
      return !x || (!x.captured && !x.move.promo && !checkersOf(x.after).length);
    };
    if (quiet(q1) && quiet(q2)) return endCapture(n, i);
  }
  return endCapture(n, n.length - 1);
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
   "the exchange", "a knight for a pawn". Equal swaps cancel out. */
function captureWord(line, upto) {
  var gained = [], lost = [];
  for (var k = 1; k <= upto && k < line.nodes.length; k++) if (line.nodes[k].move && line.nodes[k].move.promo) return null;
  for (var i = 1; i <= upto && i < line.nodes.length; i++) {
    var n = line.nodes[i];
    if (!n.captured) continue;
    (n.pov ? gained : lost).push(pType(n.captured));
  }
  for (var g = gained.length - 1; g >= 0; g--) {
    var j = lost.indexOf(gained[g]);
    if (j === -1 && (gained[g] === 'N' || gained[g] === 'B')) j = lost.indexOf(gained[g] === 'N' ? 'B' : 'N');
    if (j !== -1) { gained.splice(g, 1); lost.splice(j, 1); }
  }
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
  var MATE_MAX = 5;
  var mateAgainst = after && after.mate != null && after.mate < 0 && -after.mate <= MATE_MAX ? -after.mate : null;
  var mateFor = best && best.mate != null && best.mate > 0 && best.mate <= MATE_MAX ? best.mate : null;
  var alreadyLost = best && best.mate != null && best.mate < 0;
  var stillMating = after && after.mate != null && after.mate > 0;
  var lossG = -matGame, gainB = matBest, t;
  var soon = function (m, settle) { return !!m && (m.ply == null || m.ply <= Math.max(1, settle)); };
  var aFork = soon(allowed.fork, gSettle) ? allowed.fork : null;
  var aPin = (allowed.pin && allowed.pin.piece !== 'P' && soon(allowed.pin, gSettle)) || soon(allowed.skewer, gSettle);
  var aDisc = soon(allowed.discoveredAttack, gSettle) || allowed.doubleCheck;
  var edge = gainB - matGame;
  var sameCapture = bestLine && bestLine.nodes[1] && gameLine && gameLine.nodes[0] && bestLine.nodes[1].captured
    && gameLine.nodes[0].captured && bestLine.nodes[1].move.to === gameLine.nodes[0].move.to;
  var n0 = gameLine && gameLine.nodes[0], r1 = gameLine && gameLine.nodes[1];
  var checksAgainst = 0;
  if (gameLine) for (var ci = 1; ci < Math.min(gameLine.nodes.length, 7); ci += 2) {
    if (checkersOf(gameLine.nodes[ci].after).length) checksAgainst++;
  }
  if (mateAgainst && !alreadyLost) t = 'mateAllowed';
  else if (mateFor && !stillMating) t = 'mateMissed';
  else if (!sameCapture && gainB > lossG && (edge >= 2 || (edge >= 1 && gainB >= 1 && firstMoveTakesLoose(bestLine)))) {
    /* the bigger story is what you could have won */
    t = (missed.hangingPiece || firstMoveTakesLoose(bestLine)) ? 'missedMaterial' : 'missedTactic';
  }
  else if (lossG >= 1) {
    var loose = firstReplyTakesLoose(gameLine);
    if (lossG >= 2 && aFork) t = 'forkAllowed';
    else if (lossG >= 2 && aPin) t = 'pinAllowed';
    else if (lossG >= 2 && aDisc) t = 'discoveredAllowed';
    else if ((loose || allowed.hangingPiece) && threatExisted(pre, gameLine)) t = 'threat';
    else if (lossG >= 2 && n0 && n0.captured && r1 && r1.captured && r1.move.to === n0.move.to) t = 'badTrade';
    else if (loose || allowed.hangingPiece || allowed.trappedPiece) t = 'hung';
    else if (lossG >= 2 && allowed.promotion) t = 'promotion';
    else if (lossG >= 2) t = 'material';
  }
  if (!t) {
    if (allowed.promotion && wb - wa >= 20) t = 'promotion';
    else if (checksAgainst >= 2 || (n0 && loosensKing(pre, n0.move) && checksAgainst >= 1)) t = 'kingSafety';
    else if (wb >= 65 && wa < 60) t = 'slipped';
    else {
      var ph = phaseOf(pre, ply || 0);
      t = ph === 'open' ? 'openingSlip' : (ph === 'end' ? 'endgame' : 'drift');
    }
  }
  var res = {
    t: t, allowed: allowed, missed: missed, matGame: matGame, matBest: matBest,
    mateAgainst: mateAgainst, mateFor: mateFor, gameLine: gameLine, bestLine: bestLine,
    gSettle: gSettle, bSettle: bSettle
  };
  res.sentences = explainMistake(res, pre, wb, wa);
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
/* Two sentences: what the game move did, and what the best move does. */
function explainMistake(c, pre, wb, wa) {
  var g = c.gameLine, bl = c.bestLine;
  var n0 = g && g.nodes[0], r1 = g && g.nodes[1];
  var played = g ? sanOf(pre, g.nodes[0].move) : '?';
  var reply = g && g.nodes[1] ? sanOf(g.nodes[1].before, g.nodes[1].move) : null;
  var bestSan = bl && bl.nodes[1] ? sanOf(bl.nodes[1].before, bl.nodes[1].move) : null;
  var them = pre.w ? 'Black' : 'White';
  var lost = captureWord(g || { nodes: [] }, c.gSettle) || materialWord(c.matGame);
  var won = bl ? (captureWord(bl, c.bSettle) || materialWord(c.matBest)) : '';
  var gameS, bestS;
  switch (c.t) {
    case 'mateAllowed':
      gameS = played + ' allows mate in ' + c.mateAgainst + (reply ? ', starting with ' + reply : '') + '.';
      break;
    case 'hung': {
      var hp = c.allowed.hangingPiece, tr = c.allowed.trappedPiece;
      var sq = hp ? hp.sq : (r1 && r1.captured ? r1.move.to : null);
      var pc = hp ? PIECE_WORD[hp.piece] : (r1 && r1.captured ? PIECE_WORD[pType(r1.captured)] : 'piece');
      if (tr && !hp) gameS = played + ' lets your ' + PIECE_WORD[tr.piece] + ' get trapped.';
      else if (n0.captured && sq === n0.move.to)
        gameS = played + ' takes a ' + PIECE_WORD[pType(n0.captured)] + ', but the ' + pc + ' is lost' + (reply ? ' to ' + reply : '') + '.';
      else gameS = played + ' leaves your ' + pc + (sq != null ? ' on ' + sqWord(sq) : '') + ' undefended' + (reply ? ': ' + reply + ' takes it' : '') + '.';
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
      gameS = c.allowed.skewer
        ? played + ' walks into a skewer: you lose ' + (lost || 'material') + '.'
        : (lost === 'the ' + pinned
            ? played + ' walks into a pin, and the pinned ' + pinned + ' is lost.'
            : played + ' walks into a pin: you lose ' + (lost || 'material') + '.');
      break;
    }
    case 'discoveredAllowed':
      gameS = played + ' allows a discovered ' + (c.allowed.discoveredAttack && c.allowed.discoveredAttack.check ? 'check' : 'attack') + '. You lose ' + (lost || 'material') + '.';
      break;
    case 'badTrade': {
      var got = n0 && n0.captured ? PIECE_WORD[pType(n0.captured)] : 'piece';
      var gone = r1 && r1.captured ? PIECE_WORD[pType(r1.captured)] : 'piece';
      gameS = played + ' takes a ' + got + ', but ' + (reply || 'the reply') + ' takes your ' + gone + '.'
        + (lost && lost !== 'the ' + gone ? ' You lose ' + lost + '.' : '');
      break;
    }
    case 'kingSafety':
      gameS = played + ' opens up your king' + (reply ? ': after ' + reply + ' ' + them + ' attacks it' : '') + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
      break;
    case 'promotion':
      gameS = played + ' lets ' + them + '\'s pawn run through to promote.';
      break;
    case 'threat':
      gameS = played + ' ignores ' + them + '\'s threat: ' + (reply || 'the reply') + ' takes ' + (lost || 'material') + '.';
      break;
    case 'material':
      var lastCap = 0;
      for (var li = 1; li <= c.gSettle && li < g.nodes.length; li++) if (g.nodes[li].captured) lastCap = li;
      var shown = Math.min(Math.max(lastCap, 1), 6);
      gameS = played + ' loses ' + (lost || 'material') + (reply ? ' after ' + lineSans(g, shown).join(' ') + (lastCap > shown ? ' and more' : '') : '') + '.';
      break;
    case 'mateMissed':
      gameS = played + ' lets a forced mate slip away.';
      break;
    case 'missedMaterial': {
      var bm = bl && bl.nodes[1], hp2 = c.missed.hangingPiece;
      var what = bm && bm.captured ? { piece: pType(bm.captured), sq: bm.move.ep >= 0 ? bm.move.ep : bm.move.to } : (hp2 ? { piece: hp2.piece, sq: hp2.sq } : null);
      gameS = what ? played + ' leaves ' + them + '\'s loose ' + PIECE_WORD[what.piece] + ' on ' + sqWord(what.sq) + ' alone.'
        : played + ' misses a chance to win material.';
      break;
    }
    case 'missedTactic':
      gameS = played + ' misses ' + (bestSan || 'a stronger move') + '.';
      break;
    case 'slipped':
      gameS = played + ' lets your winning position slip' + (reply ? ': after ' + reply + ' ' + standing(wa, them) : '')
        + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
      break;
    case 'openingSlip':
    case 'endgame':
    case 'drift':
    default: {
      var r1n = g && g.nodes[1];
      var forcing = r1n && (r1n.captured || checkersOf(r1n.after).length);
      gameS = (wb < 40 ? played + ' makes a difficult position worse' : played + ' lets ' + them + ' take over')
        + (forcing ? ': ' + reply + ' is strong' : '') + ' (' + Math.round(wb) + '% to ' + Math.round(wa) + '%).';
    }
  }
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
  else if (c.matBest >= 1) bestS = bestSan + ' wins ' + won + '.';
  else if (c.matGame <= -1 && c.matBest >= c.matGame + 1) bestS = bestSan + ' keeps everything safe.';
  else bestS = bestSan + (wb >= 60 ? ' keeps your advantage.' : wb >= 40 ? ' keeps the game balanced.' : ' is the most stubborn defence.');
  return { game: gameS, best: bestS };
}

