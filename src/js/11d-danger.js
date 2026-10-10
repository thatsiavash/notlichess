/* ── Danger facts: what the card's position holds for the player ───────────
   One shared reading of the danger on a card, for its hints, its reasons,
   its settled line, See why and the check line, computed once per card
   beside the deeper look and kept on the mistake record as b.dz:
     at  the player's pieces (not the king) on the card's own position that
         stand unguarded, attacked by a cheaper piece, or attacked more often
         than guarded: [[square, attacker squares...], ...], the most
         valuable piece first, its cheapest attacker first; only attackers
         that may legally take (not pinned off the line, a king only where
         nothing guards)
     th  their best move if it were their turn: a null-move search (the same
         position with them to move and no en passant, 250,000 nodes, three
         lines), each line kept only when it wins material by the card
         face's own claim rule (xpClaim) or mates; the one named, as [uci,
         mate in n or 0, pawns won]: a mate beats material, then the threat
         the better move meets, then the biggest. null: searched and none
         (or the player is in check, where no search runs); absent: not
         searched yet (the engine down), so a later load asks again
     sv  what the better move saves: the pieces the game line takes from
         the player, net of what it gives back, up to where its loss is
         claimed (lossClaim: in line with the score, more than the best line
         loses), that the best line never loses; piece letters, the most
         valuable first ("Q"); '' when none
     st  the check step: 1 their move, 2 your chances, 3 safety check,
         4 finishing wins, 5 quiet moves. The pattern sets it (DZ_STEP); on
         a safety card a danger already on the board makes it 1: a threat
         the search kept, when it still stands after the game move; with no
         search run, the refutation's first move, legal before the game move
         and already winning there (the piece it takes unguarded, or worth
         more than the taker) or mating. A capture that was merely legal
         before is no such danger: taking away a guard is a safety check
         missed
     v, k  the version (DZ_V) and a signature of the lines and scores it was
         read from (dzSig): a change to either reads it again */
var DZ_V = 1;
var DZ_STEP = { threat: 1, missedMaterial: 2, missedTactic: 2, mateMissed: 2, slipped: 4, openingSlip: 5, drift: 5, endgame: 5 };
var DZ_NODES = 250000;
function dzSig(b) {
  var s = [b.bu, b.lu, b.ru, b.t, b.mb, b.ma, b.eb, b.ea].join('|'), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/* the stored facts while they are current, else null */
function dangerOf(b) {
  var d = b && b.dz;
  return d && d.v === DZ_V && d.k === dzSig(b) ? d : null;
}
/* current, and their threat asked (or no search needed) */
function dangerReady(b) { var d = dangerOf(b); return !!d && d.th !== undefined; }
/* the card as the facts read it: its position, the game move and the
   classifier's two lines, as cardFor builds them; null when the record
   cannot be read */
function dangerCard(it) {
  var g = it.g, b = it.b, pre = g && g.mv ? stateAtPly(g.mv, b.p) : null, pu = pre ? uciOfSan(g.mv, b.p) : null;
  var played = pu ? uciToMove(pre, pu) : null, best = b.bu && pre ? uciToMove(pre, b.bu) : null;
  if (!played || !best || b.bu === pu) return null;
  var cls = classifyMistake(pre, pu, { pv: unpackUci(b.lu), mate: b.mb }, { pv: unpackUci(b.ru), mate: b.ma }, b.wb, b.wa, b.p);
  return { it: it, key: it.key, pre: pre, played: played, playedUci: pu, best: best, cls: cls };
}
/* the same position with them to move: castling kept, no en passant */
function dzNullState(st) { var n = cloneState(st); n.w = !n.w; n.ep = -1; return n; }
function dzInCheck(a) { return checkersOf(a.pre).length > 0; }
/* the attacker on `from` may legally take on `to` (with them to move): not
   pinned off that line, and a king only takes what nothing guards */
function dzCanTake(b, from, to) {
  var ray = pinRay(b, from);
  if (ray && ray.indexOf(to) < 0) return false;
  return !(pType(b[from]) === 'K' && isDefended(b, to));
}
function dangerAttacked(st, pov) {
  var b = st.b, out = [], val = function (sq) { return MOTIF_VAL[pType(b[sq])]; };
  for (var sq = 0; sq < 64; sq++) {
    var p = b[sq];
    if (!p || colorW(p) !== pov || pType(p) === 'K') continue;
    var by = attackersOf(b, sq, !pov).filter(function (f) { return dzCanTake(b, f, sq); });
    if (!by.length) continue;
    var cheap = by.some(function (f) { return pType(b[f]) !== 'K' && val(f) < val(sq); });
    if (!(isHangingAt(b, sq) || cheap || by.length > attackersOf(b, sq, pov).length)) continue;
    by.sort(function (x, y) { return val(x) - val(y) || x - y; });
    out.push([sq].concat(by));
  }
  return out.sort(function (x, y) { return val(y[0]) - val(x[0]) || x[0] - y[0]; });
}
/* the player's pieces a line takes, net of what they take back (an equal
   swap cancels, a knight against a bishop too), nodes from..to; null when a
   pawn promotes on the way (the count is no longer pieces) */
function dzNetLost(line, from, to, pov) {
  var lost = [], won = [];
  for (var i = from; i <= to && i < line.nodes.length; i++) {
    var n = line.nodes[i];
    if (n.move && n.move.promo) return null;
    if (n.captured) (colorW(n.captured) === pov ? lost : won).push(pType(n.captured));
  }
  [false, true].forEach(function (cross) {
    for (var w = won.length - 1; w >= 0; w--) {
      var j = lost.indexOf(won[w]);
      if (j < 0 && cross && (won[w] === 'N' || won[w] === 'B')) j = lost.indexOf(won[w] === 'N' ? 'B' : 'N');
      if (j >= 0) { won.splice(w, 1); lost.splice(j, 1); }
    }
  });
  return lost;
}
function dangerSaves(a) {
  var c = a.cls, b = a.it.b, pov = myPov(a.it), bl = c.bestLine;
  if (!c.gameLine || !bl || c.mateAgainst || !(c.lossG >= 1)) return '';
  var lc = lossClaim(a, c.gameLine, c.lossAt, 0, gameCpAfter(b), b.eb, bestLossFrom(a, 0));
  var lost = lc ? dzNetLost(c.gameLine, 0, lc.k, pov) : null;
  if (!lost || !lost.length) return '';
  var keeps = function (t) {
    for (var i = 1; i < bl.nodes.length; i++) { var n = bl.nodes[i]; if (n.captured && colorW(n.captured) === pov && pType(n.captured) === t) return false; }
    return true;
  };
  var out = [];
  lost.forEach(function (t) { if (t !== 'K' && out.indexOf(t) < 0 && keeps(t)) out.push(t); });
  return out.sort(function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; }).join('');
}
/* their threats from the null-move search r (scores from White's side):
   each kept line as [uci, mate, pawns], the one to name first (a mate,
   then what the better move meets, then the biggest); [] when none */
function dangerThreats(a, r, sv) {
  var nst = dzNullState(a.pre), them = !myPov(a.it), cands = [];
  var lines = r && r.lines && r.lines.length ? r.lines : r && r.pv ? [{ cp: r.cp, mate: r.mate, pv: r.pv }] : [];
  lines.forEach(function (l, i) {
    var u = l && l.pv && l.pv[0], m = u ? uciToMove(nst, u) : null;
    if (!m) return;
    var mate = l.mate != null ? (them ? l.mate : -l.mate) : null;
    if (mate != null && mate > 0) { cands.push({ u: u, m: m, mate: mate, n: 0, i: i }); return; }
    var cl = xpClaim(nst, l.pv, them ? l.cp : -l.cp);
    if (cl && cl.n >= 1) cands.push({ u: u, m: m, mate: 0, n: cl.n, i: i });
  });
  if (!cands.length) return [];
  /* the better move meets it: after it their move is gone, or takes
     something else, or what it would take is what the better move saves */
  var after = cloneState(a.pre);
  applyMove(after, a.best);
  var meets = function (x) {
    var m2 = uciToMove(after, x.u), t0 = nst.b[x.m.to];
    if (!m2) return true;
    if (t0 && after.b[m2.to] !== t0) return true;
    return !!t0 && (sv || '').indexOf(pType(t0)) >= 0;
  };
  cands.forEach(function (x) { x.met = meets(x) ? 1 : 0; });
  cands.sort(function (x, y) {
    return (y.mate ? 1 : 0) - (x.mate ? 1 : 0) || (x.mate && y.mate ? x.mate - y.mate : 0) || y.met - x.met || y.n - x.n || x.i - y.i;
  });
  return cands.map(function (x) { return [x.u, x.mate, x.n]; });
}
/* their threat still stands once the game move is on the board: the same
   piece makes the same move there and takes the same piece (a mate in one
   still mates); a threat the game move met is no "their move" miss */
function dzThreatStands(a, th) {
  var nst = dzNullState(a.pre), post = cloneState(a.pre);
  applyMove(post, a.played);
  var m0 = uciToMove(nst, th[0]), m1 = uciToMove(post, th[0]);
  if (!m0 || !m1 || nst.b[m0.from] !== post.b[m1.from]) return false;
  var t0 = nst.b[m0.to], t1 = post.b[m1.to];
  if (t0 ? t1 !== t0 : !!t1) return false;
  if (th[1] === 1) { var x = cloneState(post); applyMove(x, m1); return isMate(x); }
  return true;
}
/* with no search: the refutation's first move, legal before the game move,
   already won material there (what it takes stood unguarded, or is worth
   more than the piece taking it) or mated */
function dzStoodBefore(a) {
  var r1 = a.cls.gameLine && a.cls.gameLine.nodes[1];
  if (!r1 || !r1.move) return false;
  var nst = dzNullState(a.pre), m = uciToMove(nst, moveUci(r1.move));
  if (!m) return false;
  var x = cloneState(nst);
  applyMove(x, m);
  if (isMate(x)) return true;
  var t = nst.b[m.to];
  return !!t && t === r1.captured && (isHangingAt(nst.b, m.to) || MOTIF_VAL[pType(nst.b[m.from])] < MOTIF_VAL[pType(t)]);
}
/* th: the threat named, null (searched, none) or undefined (no search
   ran); more: the other threats the search kept. Any of them still
   standing after the game move is a danger the move ignored: Rg1 pins the
   pawn that would take the queen, and the rook still takes it */
function dangerStep(a, th, more) {
  var s = DZ_STEP[patternOf(a.it.b)] || (PATTERN[patternOf(a.it.b)] ? 3 : 5);
  if (s !== 3) return s;
  if (th === undefined) return dzStoodBefore(a) ? 1 : 3;
  return th && [th].concat(more || []).some(function (x) { return dzThreatStands(a, x); }) ? 1 : 3;
}
/* the facts for card a; r: the null-move search's answer, null when it
   found nothing, undefined when none ran */
function dangerFacts(a, r) {
  var b = a.it.b, pov = myPov(a.it), d = { v: DZ_V, k: dzSig(b), at: dangerAttacked(a.pre, pov), sv: dangerSaves(a) }, all = [];
  if (dzInCheck(a)) d.th = null;
  else if (r !== undefined) { all = r ? dangerThreats(a, r, d.sv) : []; d.th = all[0] || null; }
  d.st = dangerStep(a, d.th, all.slice(1));
  return d;
}
/* the facts read now, without a search (the engine down): kept, and asked
   again on a later load */
function dangerNow(it) {
  if (dangerOf(it.b)) return it.b.dz;
  var a = dangerCard(it);
  if (a) it.b.dz = dangerFacts(a, undefined);
  return it.b.dz || null;
}
/* the facts made current: read at once, then their threat from one search
   (prio: the player is waiting on it, in the loading frame). Resolves with
   the item once they are stored, or when no search can run */
var dangerPending = {};
function ensureDanger(it, prio) {
  var b = it.b, key = it.key, myGen = gen;
  if (dangerReady(b) || b.x) return Promise.resolve(it);
  if (dangerPending[key]) { if (prio) promoteTag(key); return dangerPending[key]; }
  var a = dangerCard(it);
  if (!a) return Promise.resolve(it);
  if (!dangerOf(b)) b.dz = dangerFacts(a, undefined);
  if (dzInCheck(a) || SF.state === 'failed') return Promise.resolve(it);
  var sig = dzSig(b), done = function () { delete dangerPending[key]; return it; };
  var p = engineEval(stateFen(dzNullState(a.pre)), { nodes: DZ_NODES }, !!prio, { multipv: 3, tag: key, dz: 1 }).then(function (r) {
    if (!r || r.stopped || stale(myGen) || b.x || dzSig(b) !== sig) return;
    b.dz = dangerFacts(a, r);
    scheduleSave();
  }, function () {});
  dangerPending[key] = p.then(done, done);
  return dangerPending[key];
}
/* the facts for the card on screen, in plain parts (what the hints,
   reasons and settled lines say reads this): attacked [{sq, p, by}], threat {uci, from, to, p (the piece
   that moves), took (what it takes, or null), mate, n} or null, saves
   ['Q'], step; null while not read */
function dangerView(a) {
  var d = dangerOf(a.it.b) || dangerNow(a.it);
  if (!d) return null;
  var b = a.pre.b, th = d.th, nst = th ? dzNullState(a.pre) : null, m = th ? uciToMove(nst, th[0]) : null;
  return {
    attacked: d.at.map(function (x) { return { sq: x[0], p: b[x[0]], by: x.slice(1) }; }),
    threat: m ? { uci: th[0], from: m.from, to: m.to, p: b[m.from], took: b[m.to] || null, mate: th[1] || 0, n: th[2] || 0 } : null,
    searched: th !== undefined, saves: (d.sv || '').split('').filter(Boolean), step: d.st
  };
}
