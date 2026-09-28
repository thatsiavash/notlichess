/* ── Motifs: what a line of moves actually does ─────────────────────────────
   Deterministic tactic detection on our own move generator, ported from the
   rules of the lichess puzzle tagger (ornicar/lichess-puzzler, cook.py), so
   the names match what players already know from lichess puzzle themes.
   A "line" is judged from one side's point of view (pov): the side whose
   moves are the idea. line.nodes[0] is the move that set it up (the game
   move, or a null move), then the pov side and the other side alternate. */

var MOTIF_VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 99 };

function pieceAt(b, sq) { return sq >= 0 && sq < 64 ? b[sq] : null; }
function pType(p) { return p ? p.toUpperCase() : null; }
function colorW(p) { return p >= 'A' && p <= 'Z'; }

/* every square the piece on `sq` attacks (sliders stop at the first piece) */
function attacksFrom(b, sq) {
  var p = b[sq];
  if (!p) return [];
  var u = pType(p), w = colorW(p), f = sq % 8, r = sq >> 3, out = [], i, d, tf, tr;
  if (u === 'P') {
    var dr = w ? 1 : -1;
    [-1, 1].forEach(function (df) {
      if (sqOk(f + df, r + dr)) out.push((r + dr) * 8 + f + df);
    });
    return out;
  }
  if (u === 'N' || u === 'K') {
    var steps = u === 'N' ? KNIGHT_D : BISHOP_D.concat(ROOK_D);
    for (i = 0; i < steps.length; i++) {
      tf = f + steps[i][0]; tr = r + steps[i][1];
      if (sqOk(tf, tr)) out.push(tr * 8 + tf);
    }
    return out;
  }
  var rays = u === 'B' ? BISHOP_D : (u === 'R' ? ROOK_D : BISHOP_D.concat(ROOK_D));
  for (i = 0; i < rays.length; i++) {
    d = rays[i]; tf = f + d[0]; tr = r + d[1];
    while (sqOk(tf, tr)) {
      out.push(tr * 8 + tf);
      if (b[tr * 8 + tf]) break;
      tf += d[0]; tr += d[1];
    }
  }
  return out;
}
/* squares of `byWhite` pieces attacking `sq` */
function attackersOf(b, sq, byWhite) {
  var out = [];
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (!p || colorW(p) !== byWhite) continue;
    if (attacksFrom(b, i).indexOf(sq) !== -1) out.push(i);
  }
  return out;
}
/* cook's is_defended: a direct defender, or one standing behind an enemy
   slider that attacks the square (the x-ray defence) */
function isDefended(b, sq) {
  var p = b[sq];
  if (!p) return false;
  var w = colorW(p);
  if (attackersOf(b, sq, w).length) return true;
  var enemies = attackersOf(b, sq, !w);
  for (var i = 0; i < enemies.length; i++) {
    var e = pType(b[enemies[i]]);
    if (e === 'Q' || e === 'R' || e === 'B') {
      var bc = b.slice();
      bc[enemies[i]] = null;
      if (attackersOf(bc, sq, w).length) return true;
    }
  }
  return false;
}
function isHangingAt(b, sq) { return !isDefended(b, sq); }
function takenByLower(b, sq) {
  var p = b[sq], v = MOTIF_VAL[pType(p)];
  return attackersOf(b, sq, !colorW(p)).some(function (a) {
    var t = pType(b[a]);
    return t !== 'K' && MOTIF_VAL[t] < v;
  });
}
function inBadSpot(b, sq) {
  var p = b[sq];
  if (!p) return false;
  return attackersOf(b, sq, !colorW(p)).length > 0 && (isHangingAt(b, sq) || takenByLower(b, sq));
}
/* the squares a piece may still move along when pinned to its own king
   (the ray, pinner included), or null when it is not pinned */
function pinRay(b, sq) {
  var p = b[sq];
  if (!p || pType(p) === 'K') return null;
  var w = colorW(p), k = kingSq(b, w);
  if (k < 0) return null;
  var df = (sq % 8) - (k % 8), dr = (sq >> 3) - (k >> 3);
  if (df && dr && Math.abs(df) !== Math.abs(dr)) return null;
  var sf = df ? (df > 0 ? 1 : -1) : 0, sr = dr ? (dr > 0 ? 1 : -1) : 0;
  var diag = sf !== 0 && sr !== 0, ray = [];
  var f = (k % 8) + sf, r = (k >> 3) + sr, seen = false;
  while (sqOk(f, r)) {
    var s = r * 8 + f, q = b[s];
    ray.push(s);
    if (q) {
      if (s === sq) { seen = true; }
      else if (!seen) return null;               /* something else stands first */
      else {
        if (colorW(q) === w) return null;
        var t = pType(q);
        return (t === 'Q' || (diag ? t === 'B' : t === 'R')) ? ray : null;
      }
    }
    f += sf; r += sr;
  }
  return null;
}
function checkersOf(st) {
  var k = kingSq(st.b, st.w);
  return k < 0 ? [] : attackersOf(st.b, k, !st.w);
}
function isMate(st) { return checkersOf(st).length > 0 && legalMoves(st).length === 0; }
function sideMaterial(b, white) {
  var s = 0;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (p && colorW(p) === white && pType(p) !== 'K') s += MOTIF_VAL[pType(p)];
  }
  return s;
}
function matDiff(b, white) { return sideMaterial(b, white) - sideMaterial(b, !white); }

/* cook's is_trapped: a piece in a bad spot with no square to run to */
function isTrappedAt(st, sq) {
  if (checkersOf(st).length || pinRay(st.b, sq)) return false;
  var p = st.b[sq], t = pType(p);
  if (!p || t === 'P' || t === 'K') return false;
  if (!inBadSpot(st.b, sq)) return false;
  var ms = legalMoves(st);
  for (var i = 0; i < ms.length; i++) {
    if (ms[i].from !== sq) continue;
    var cap = st.b[ms[i].to];
    if (cap && MOTIF_VAL[pType(cap)] >= MOTIF_VAL[t]) return false;
    var nx = cloneState(st);
    applyMove(nx, ms[i]);
    if (!inBadSpot(nx.b, ms[i].to)) return false;
  }
  return true;
}

/* ── building a line ─────────────────────────────────────────────────────
   nodes[i] = { before, after, move|null (null move), piece, captured,
                pov: true when the pov side made this move } */
function buildLine(st0, firstMove, ucis, povWhite) {
  var nodes = [], st = cloneState(st0);
  /* a null first move means "it's already my turn": start from the other
     side to move so the null move hands the turn back */
  if (firstMove === '0000') { st.w = !st.w; st.ep = -1; }
  var first = firstMove === '0000' ? null : (typeof firstMove === 'string' ? uciToMove(st, firstMove) : firstMove);
  if (firstMove !== '0000' && !first) return null;
  var keepEp = firstMove === '0000' ? st0.ep : -1;
  var push = function (m) {
    var before = cloneState(st);
    if (m) {
      var captured = m.ep >= 0 ? before.b[m.ep] : before.b[m.to];
      applyMove(st, m);
      nodes.push({ before: before, after: cloneState(st), move: m, piece: pType(before.b[m.from]),
                   captured: captured || null, byWhite: before.w });
    } else {
      st.w = !st.w; st.ep = keepEp;
      nodes.push({ before: before, after: cloneState(st), move: null, piece: null, captured: null, byWhite: before.w });
    }
  };
  push(first);
  for (var i = 0; i < (ucis || []).length; i++) {
    var m = uciToMove(st, ucis[i]);
    if (!m) break;
    push(m);
  }
  nodes.forEach(function (n) { n.pov = n.byWhite === povWhite; });
  return { nodes: nodes, povWhite: povWhite };
}
function povMoves(line) { return line.nodes.filter(function (n, i) { return i % 2 === 1; }); }

/* ── detectors (each returns false or a detail object for sentences) ────── */
function mHanging(line) {
  var n0 = line.nodes[0], n1 = line.nodes[1];
  if (!n1) return false;
  var to = n1.move.to, captured = n0.after.b[to];
  if (checkersOf(n0.after).length && (!captured || pType(captured) === 'P')) return false;
  if (!captured || pType(captured) === 'P') return false;
  if (!isHangingAt(n0.after.b, to)) return false;
  /* recapturing an equal or bigger piece the other side just took is a trade */
  if (n0.move && n0.captured && MOTIF_VAL[pType(n0.captured)] >= MOTIF_VAL[pType(captured)] && n0.move.to === to) return false;
  if (line.nodes.length >= 4
      && matDiff(line.nodes[3].after.b, line.povWhite) < matDiff(line.nodes[1].after.b, line.povWhite)) return false;
  return { sq: to, piece: pType(captured) };
}
function mFork(line) {
  var pm = povMoves(line);
  for (var i = 0; i < pm.length - 1; i++) {
    var n = pm[i];
    if (n.piece === 'K') continue;
    var b = n.after.b, to = n.move.to;
    if (inBadSpot(b, to)) continue;
    var hits = [];
    attacksFrom(b, to).forEach(function (sq) {
      var q = b[sq];
      if (!q || colorW(q) === line.povWhite || pType(q) === 'P') return;
      var moverV = MOTIF_VAL[pType(b[to])];
      if (MOTIF_VAL[pType(q)] > moverV
          || (isHangingAt(b, sq) && attackersOf(b, to, !line.povWhite).indexOf(sq) === -1)) hits.push(sq);
    });
    if (hits.length > 1) return { sq: to, targets: hits, piece: pType(b[to]), ply: line.nodes.indexOf(n) };
  }
  return false;
}
function mPin(line) {
  var pm = povMoves(line);
  for (var i = 0; i < pm.length; i++) {
    var b = pm[i].after.b;
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p || colorW(p) === line.povWhite) continue;
      var ray = pinRay(b, sq);
      if (!ray) continue;
      /* the pinned piece cannot take what it attacks off the ray */
      var att = attacksFrom(b, sq);
      for (var a = 0; a < att.length; a++) {
        var q = b[att[a]];
        if (q && colorW(q) === line.povWhite && ray.indexOf(att[a]) === -1
            && (MOTIF_VAL[pType(q)] > MOTIF_VAL[pType(p)] || isHangingAt(b, att[a])))
          return { sq: sq, piece: pType(p), ply: line.nodes.indexOf(pm[i]) };
      }
      /* or the pinned piece cannot escape an attack */
      var byPov = attackersOf(b, sq, line.povWhite);
      for (var k = 0; k < byPov.length; k++) {
        if (ray.indexOf(byPov[k]) === -1) continue;
        var at = b[byPov[k]];
        if (MOTIF_VAL[pType(p)] > MOTIF_VAL[pType(at)]) return { sq: sq, piece: pType(p), ply: line.nodes.indexOf(pm[i]) };
        if (isHangingAt(b, sq) && attackersOf(b, byPov[k], !line.povWhite).indexOf(sq) === -1) {
          var st2 = cloneState(pm[i].after);
          st2.w = !line.povWhite;
          var canStep = legalMovesPseudo(st2, sq).some(function (t) { return ray.indexOf(t) === -1; });
          if (canStep) return { sq: sq, piece: pType(p), ply: line.nodes.indexOf(pm[i]) };
        }
      }
    }
  }
  return false;
}
/* pseudo-legal destinations for one piece (cook uses pseudo_legal_moves) */
function legalMovesPseudo(st, sq) {
  var p = st.b[sq];
  if (!p) return [];
  var w = colorW(p), u = pType(p), out = [];
  if (u === 'P') {
    var dir = w ? 8 : -8, one = sq + dir;
    if (one >= 0 && one < 64 && !st.b[one]) out.push(one);
    attacksFrom(st.b, sq).forEach(function (t) { if (st.b[t] && colorW(st.b[t]) !== w) out.push(t); });
    return out;
  }
  attacksFrom(st.b, sq).forEach(function (t) { if (!st.b[t] || colorW(st.b[t]) !== w) out.push(t); });
  return out;
}
function between(a, b2) {
  var df = (b2 % 8) - (a % 8), dr = (b2 >> 3) - (a >> 3), out = [];
  if (df && dr && Math.abs(df) !== Math.abs(dr)) return out;
  var sf = df ? (df > 0 ? 1 : -1) : 0, sr = dr ? (dr > 0 ? 1 : -1) : 0;
  var f = (a % 8) + sf, r = (a >> 3) + sr;
  while ((r * 8 + f) !== b2 && sqOk(f, r)) { out.push(r * 8 + f); f += sf; r += sr; }
  return out;
}
function mSkewer(line) {
  var pm = povMoves(line);
  for (var i = 1; i < pm.length; i++) {
    var n = pm[i], prev = line.nodes[line.nodes.indexOf(n) - 1];
    if (!prev || !prev.move) continue;
    var cap = n.captured;
    if (!cap || ['Q', 'R', 'B'].indexOf(n.piece) === -1 || isMate(n.after)) continue;
    var btw = between(n.move.from, n.move.to);
    if (prev.move.to === n.move.to || btw.indexOf(prev.move.from) === -1) continue;
    if (MOTIF_VAL[prev.piece] > MOTIF_VAL[pType(cap)] && inBadSpot(prev.after.b, n.move.to))
      return { sq: n.move.to, piece: pType(cap), front: prev.piece, ply: line.nodes.indexOf(n) };
  }
  return false;
}
function mDiscovered(line) {
  var pm = povMoves(line), i;
  for (i = 0; i < pm.length; i++) {
    var ch = checkersOf(pm[i].after);
    if (ch.length && ch.indexOf(pm[i].move.to) === -1) return { check: true, ply: line.nodes.indexOf(pm[i]) };
  }
  for (i = 1; i < pm.length; i++) {
    var n = pm[i];
    if (!n.captured) continue;
    var idx = line.nodes.indexOf(n), opp = line.nodes[idx - 1], prev = line.nodes[idx - 2];
    if (!opp || !prev || !prev.move) continue;
    if (opp.move && opp.move.to === n.move.to) return false;
    var btw = between(n.move.from, n.move.to);
    if (btw.indexOf(prev.move.from) !== -1 && n.move.to !== prev.move.to
        && n.move.from !== prev.move.to && !prev.move.castle) return { check: false, ply: idx };
  }
  return false;
}
function mDoubleCheck(line) {
  return povMoves(line).some(function (n) { return checkersOf(n.after).length > 1; });
}
function mTrapped(line) {
  var pm = povMoves(line);
  for (var i = 1; i < pm.length; i++) {
    var n = pm[i], cap = n.captured;
    if (!cap || pType(cap) === 'P') continue;
    var idx = line.nodes.indexOf(n), prev = line.nodes[idx - 1];
    var sq = n.move.to;
    if (prev.move && prev.move.to === sq) sq = prev.move.from;
    if (isTrappedAt(prev.before, sq)) return { sq: sq, piece: pType(prev.before.b[sq]) };
  }
  return false;
}
function mPromotion(line) {
  var n = povMoves(line).filter(function (x) { return x.move.promo; })[0];
  return n ? { sq: n.move.to, ply: line.nodes.indexOf(n) } : false;
}
function mMate(line) {
  var last = line.nodes[line.nodes.length - 1];
  if (!last.pov || !isMate(last.after)) return false;
  var b = last.after.b, loserW = !line.povWhite, k = kingSq(b, loserW);
  var backRank = loserW ? 0 : 7, back = false;
  if ((k >> 3) === backRank) {
    var ahead = loserW ? 8 : -8, sqs = [k + ahead];
    if (k % 8 < 7) sqs.push(k + ahead + 1);
    if (k % 8 > 0) sqs.push(k + ahead - 1);
    back = sqs.every(function (s) {
      var q = b[s];
      return q && colorW(q) === loserW && !attackersOf(b, s, line.povWhite).length;
    }) && checkersOf(last.after).some(function (c) { return (c >> 3) === backRank; });
  }
  return { moves: Math.ceil((line.nodes.length - 1) / 2), backRank: back };
}
function mAdvancedPawn(line) {
  return povMoves(line).some(function (n) {
    if (n.move.promo) return true;
    if (n.piece !== 'P') return false;
    var r = n.move.to >> 3;
    return line.povWhite ? r > 5 : r < 2;
  });
}
function mCapturingDefender(line) {
  var pm = povMoves(line);
  for (var i = 1; i < pm.length; i++) {
    var n = pm[i], idx = line.nodes.indexOf(n), opp = line.nodes[idx - 1], prev = line.nodes[idx - 2];
    var cap = n.captured;
    if (!(isMate(n.after) || (cap && n.piece !== 'K' && MOTIF_VAL[pType(cap)] <= MOTIF_VAL[n.piece]
        && isHangingAt(opp.after.b, n.move.to) && opp.move && opp.move.to !== n.move.to))) continue;
    if (!prev || !prev.move || checkersOf(prev.after).length || prev.move.to === n.move.from) continue;
    var init = prev.before.b, defSq = prev.move.to, def = init[defSq];
    if (def && attackersOf(init, n.move.to, colorW(def)).indexOf(defSq) !== -1 && !checkersOf(prev.before).length)
      return { sq: defSq };
  }
  return false;
}

/* every tag for a line, as lichess would name them, plus details */
function lineMotifs(line) {
  var out = {};
  if (!line || line.nodes.length < 2) return out;
  var t;
  if ((t = mMate(line))) { out.mate = t; if (t.backRank) out.backRankMate = t; }
  if ((t = mHanging(line))) out.hangingPiece = t;
  if ((t = mFork(line))) out.fork = t;
  if ((t = mPin(line))) out.pin = t;
  if ((t = mSkewer(line))) out.skewer = t;
  if ((t = mDiscovered(line))) out.discoveredAttack = t;
  if (mDoubleCheck(line)) out.doubleCheck = true;
  if ((t = mTrapped(line))) out.trappedPiece = t;
  if ((t = mPromotion(line))) out.promotion = t;
  if (mAdvancedPawn(line)) out.advancedPawn = true;
  if ((t = mCapturingDefender(line))) out.capturingDefender = t;
  return out;
}

