/* ── The deeper look ────────────────────────────────────────────────────────
   Every mistake is named at scan time from the scan's own lines. A card
   reached before its fact sheet (V1.1, below) gets a deeper look (250k
   nodes, two lines) just before it is shown, the next two cards of a set
   ahead of it; the fact sheet, made in the background, replaces it. Lichess's
   own server analysis searched far deeper than a browser can, so its verdict
   is never overruled: its cards only gain the refutation line. */

var DEEP_NODES = 250000, EXT_NODES = 120000, CONFIRM_NODES = 1000000;
var enrichState = { running: false, done: 0, failed: {} };
/* in-flight deeper looks by position: the model's wrappers are rebuilt on
   every change, so the promise cannot live on them */
var enrichPending = {}, enrichCtx = {};

function postState(g, p) { return stateAtPly(g.mv, p + 1); }
/* few pieces, or queens only: where a 250k search is least sure */
function thinBoard(st) {
  var n = 0, other = 0;
  st.b.forEach(function (p) {
    if (!p || p === 'K' || p === 'k' || p === 'P' || p === 'p') return;
    n++;
    if (p !== 'Q' && p !== 'q') other++;
  });
  return n <= 6 || other === 0;
}
/* a line that ends before the position settles is searched again from its
   last position; 8 plies at most */
function extendLine(st0, pv, nodes, ctx, tag) {
  /* a line that ends in mate is kept to the mate, up to 20 plies */
  var full = playUci(st0, pv.slice(0, 20)), fe = full.states[full.states.length - 1];
  if (full.uci.length > 8 && fe && !legalMoves(fe).length && checkedKingSq(fe) != null) return Promise.resolve(full.uci);
  var played = playUci(st0, pv.slice(0, 8));
  var endSt = played.states.length ? played.states[played.states.length - 1] : st0;
  if (played.uci.length >= 6 || !legalMoves(endSt).length) return Promise.resolve(played.uci);
  return engineEval(stateFen(endSt), { nodes: nodes }, ctx.prio, { tag: tag }).then(function (r) {
    return played.uci.concat((r.pv || []).slice(0, 8 - played.uci.length));
  }, function () { return played.uci; });
}
function deepEnrich(it, prio, bg) {
  var g = it.g, b = it.b, myGen = gen;
  /* Thorough: the background look searches four times deeper, and saved
     positions checked at the standard depth are checked again */
  var deep = !!bg && !prio && scanDepth() === 'thorough';
  var recheck = deep && (b.v || 0) >= 2 && b.dv !== 1 && b.j !== 'l' && !b.x;
  /* a card already looked at still needs its danger facts (11d-danger.js) */
  if ((b.v || 0) >= 2 && !recheck) return ensureDanger(it, prio).then(function () { return it; });
  var DN = deep ? CONFIRM_NODES : DEEP_NODES;
  if (enrichPending[it.key]) {
    var c0 = enrichCtx[it.key];
    /* a Thorough look in flight, and now the player is waiting: it stops, and
       a standard look runs instead, so nobody waits on a deep search */
    if (prio && c0 && c0.deep) {
      engineStop(it.key);
      return enrichPending[it.key].then(function () { delete enrichState.failed[it.key]; return deepEnrich(it, true); });
    }
    /* started in the background, and now the player is waiting on it */
    if (prio && c0 && !c0.prio) { c0.prio = true; promoteTag(it.key); }
    return enrichPending[it.key].then(function () { return it; });
  }
  var pre = stateAtPly(g.mv, b.p), post = postState(g, b.p);
  if (!pre || !post) { b.x = 'moves'; modelDirty(); return Promise.resolve(it); }
  var sign = g.color === 'white' ? 1 : -1;
  var key = it.key, done = function () { delete enrichPending[key]; delete enrichCtx[key]; return it; };
  var ctx = enrichCtx[key] = { prio: !!prio, deep: deep };
  /* a search stopped part-way is not an answer */
  var ev = function (fen, mt, pr, opts) { return engineEval(fen, mt, pr, opts).then(function (r) { if (r && r.stopped) throw { stopped: true }; return r; }); };
  var p;
  if (b.j === 'l') {
    /* lichess analysed this: keep its verdict, its answer and its line */
    p = engineEval(stateFen(post), { nodes: DEEP_NODES }, ctx.prio, { tag: key }).then(function (r2) {
      if (stale(myGen) || (b.v || 0) >= 2 || factsOf(b)) return;
      b.ma = r2.mate != null ? r2.mate * sign : b.ma;
      b.ea = r2.cp * sign;
      return extendLine(post, r2.pv || [], EXT_NODES, ctx, key).then(function (ru) {
        if (stale(myGen) || factsOf(b)) return;
        b.ru = packUci(ru);
        classifyEntry(b, g.mv);
        /* a quiet card: is there more than one good answer? (the same
           question the scan asks on its own cards) */
        if (familyOf(patternOf(b)).key !== 'quiet') { b.v = 2; modelDirty(); return; }
        return engineEval(stateFen(pre), { nodes: DEEP_NODES }, ctx.prio, { multipv: 2, tag: key }).then(function (r) {
          var sec = r.lines && r.lines[1];
          if (sec && sec.pv && sec.pv[0]) b.g2 = Math.round(winPct(sign * r.cp) - winPct(sign * sec.cp));
        }, function () {}).then(function () { b.v = 2; modelDirty(); });
      });
    });
  } else {
    var r1, bar = Math.max(10, mistakeMinFor(g) - 3);
    p = ev(stateFen(pre), { nodes: DN }, ctx.prio, { multipv: 2, tag: key })
      .then(function (r) { r1 = r; return ev(stateFen(post), { nodes: DN }, ctx.prio, { tag: key }); })
      .then(function (r2) {
        /* a close call on a thin board is searched again, four times deeper,
           but only in the background: a player never waits on it */
        var drop = winPct(sign * r1.cp) - winPct(sign * r2.cp);
        if (stale(myGen) || ctx.prio || deep || !thinBoard(pre) || drop < bar || drop >= bar + 10) return r2;
        return ev(stateFen(pre), { nodes: CONFIRM_NODES }, ctx.prio, { multipv: 2, tag: key }).then(function (r) {
          r1 = r;
          return ev(stateFen(post), { nodes: CONFIRM_NODES }, ctx.prio, { tag: key });
        });
      })
      .then(function (r2) {
        if (stale(myGen) || ((b.v || 0) >= 2 && !recheck) || factsOf(b)) return;
        /* a recheck never touches a card that is in today's session, nor one
           the player has disputed meanwhile: it tries again another time */
        var blocked = function () { return recheck && (!!b.x || cardInSession(key)); };
        if (blocked()) return;
        var wb2 = winPct(sign * r1.cp), wa2 = winPct(sign * r2.cp);
        /* a mistake the deeper look does not confirm never becomes a card,
           nor does a slip in a game that was already lost and not decided by it */
        var drop = null;
        if (wb2 - wa2 < bar) drop = 'deep';
        else if (!b.d && wb2 < 15) drop = 'lost';
        else if (!r1.bestUci || r1.bestUci === uciOfSan(g.mv, b.p)) drop = 'same';
        if (drop) { b.x = drop; if (deep) b.dv = 1; modelDirty(); return; }
        var upd = { wb: wb2, wa: wa2, bu: r1.bestUci, eb: r1.cp * sign, ea: r2.cp * sign,
                    mb: r1.mate != null ? r1.mate * sign : null, ma: r2.mate != null ? r2.mate * sign : null };
        var second = r1.lines && r1.lines[1];
        if (second && second.pv && second.pv[0]) {
          /* only move: every alternative is 15 or more points worse */
          upd.om = winPct(upd.eb) - winPct(second.cp * sign) >= 15 ? 1 : 0;
          /* the gap to the second-best move, in win-chance points */
          upd.g2 = Math.round(winPct(upd.eb) - winPct(second.cp * sign));
        }
        return Promise.all([
          extendLine(pre, r1.pv || [], EXT_NODES, ctx, key),
          extendLine(post, r2.pv || [], EXT_NODES, ctx, key)
        ]).then(function (lines) {
          /* everything lands together, or nothing does; never over a fact
             sheet that landed meanwhile (V1.1) */
          if (stale(myGen) || blocked() || factsOf(b)) return;
          Object.keys(upd).forEach(function (k2) { b[k2] = upd[k2]; });
          b.lu = packUci(lines[0]);
          b.ru = packUci(lines[1]);
          classifyEntry(b, g.mv);
          b.v = 2;
          if (deep) b.dv = 1;
          modelDirty();
        });
      });
  }
  /* the danger facts are read once the lines have landed, inside the same
     wait: one search more, and the loading frame covers it */
  p = p.then(function () { if (!stale(myGen) && (b.v || 0) >= 2 && !b.x) return ensureDanger(it, ctx.prio); });
  enrichPending[key] = p.then(done, function () { enrichState.failed[key] = 1; return done(); });
  return enrichPending[key];
}

function recheckText(rc) {
  if (rc.done >= rc.n) return rc.n === 1 ? 'Your saved position is rechecked.' : 'All ' + rc.n + ' saved positions rechecked.';
  return 'Saved positions rechecked: ' + rc.done + ' of ' + rc.n + '.';
}
/* a card in today's session, open or paused */
function cardInSession(key) {
  var ss = ui.session || savedSession();
  return !!(ss && ss.keys && ss.keys.indexOf(key) !== -1);
}
/* the recheck, counted for Settings: since the fact sheet (V1.1) every
   saved position is checked again at 1,000,000 nodes, so a position counts
   once its key is in */
function recheckCount() {
  var n = 0, done = 0;
  allMistakes().forEach(function (it) {
    if (!trainable(it)) return;
    n++;
    if (factsOf(it.b) || it.b.dv === 1) done++;
  });
  return { n: n, done: done };
}
/* the background work: one card's fact sheet at a time (enrichTargets'
   order), never while a move is being checked or the session's scan runs.
   A card reached before its key still opens on the 250,000-node look */
function autoEnrich() {
  if (!cfg.user || enrichState.running || SF.state === 'failed') return;
  var a = ui.session && ui.session.active;
  if (a && (a.phase === 'checking' || !a.phase)) { setTimeout(autoEnrich, 3000); return; }
  if (scanState.running && ui.session) { setTimeout(autoEnrich, 4000); return; }
  var next = enrichTargets()[0];
  if (!next) return;
  enrichState.running = true;
  ensureFacts(next, false).then(function () {
    enrichState.running = false;
    enrichState.done++;
    var rl = el('recheck-line');
    if (rl) rl.textContent = recheckText(recheckCount());
    scheduleSave();
    setTimeout(autoEnrich, 200);
  });
}

/* ── The settle rule (V1.1), shared by every slice ─────────────────────────
   settleLine(st, moves, side): the line (uci moves, or moves) played from
   st, legal moves only, its first move always, until material is unchanged
   for two plies (two quiet plies: no capture, no promotion and no check, so
   a quiet check that forks is read on to the capture, as settleIndex and
   settledAt count them; and nothing en prise after either, so a piece left
   hanging is read on until it is taken or saved), or mate, at most
   SETTLE_MAX (12) plies. Returns {
     k     the settle ply (1 or more; 0 only for a line with no legal move);
           the counts are read there
     ok    true when two quiet plies followed it or it mates; false when the
           moves ran out first (the line wants extending) or 12 passed
     n     the plies read (the legal moves, at most 12); moves their uci
     mate  the ply that mates, 0 when none
     w, b  White's and Black's material change from st to ply k, in pawns
           (MOTIF_VAL; a promotion counts its new piece less the pawn)
     lw, lb  the pieces White and Black lost up to ply k (letters)
     ev    the first decisive event, in this order: mate, promotion, a fork
           or pin the motif code finds at that ply (one the move makes, never
           a pin that stood before it), a capture after the first (after the
           side's own first move of the line, whose capture F1.2's words
           already name), net material: {t: 'mate' | 'promo' | 'fork' | 'pin'
           | 'capture' | 'net', at (the ply), w (true: White made it), m
           (uci), p (a capture's piece taken, a promotion's new piece), sq
           (the forking piece's square, or the pinned piece's)}; side (true
           White, false Black, omitted either) keeps that side's events only.
           {t: 'net', at: k} when nothing else holds }
   The engine's lines end where Stockfish stops printing: a line that ends
   before it settles is extended (factsSettled) */
var SETTLE_MAX = 12;
function settleLine(st0, moves, side) {
  var st = cloneState(st0), nodes = [], list = moves || [], mate = 0;
  for (var i = 0; i < list.length && nodes.length < SETTLE_MAX; i++) {
    var m = typeof list[i] === 'string' ? uciToMove(st, list[i]) : list[i];
    if (!m) break;
    var before = cloneState(st), cap = m.ep >= 0 ? st.b[m.ep] : st.b[m.to];
    applyMove(st, m);
    var chk = checkersOf(st).length > 0, mt = chk && !legalMoves(st).length;
    nodes.push({ m: m, u: moveUci(m), w: !!before.w, cap: cap || null, before: before, after: cloneState(st), check: chk });
    if (mt) { mate = nodes.length; break; }
  }
  /* a quiet ply: no capture, promotion or check, and nothing left en prise
     after it (enPrise, the classifier's own test: a piece the side to move
     can take for profit, loose or hit by a cheaper piece; two quiet moves
     beside a bishop a pawn attacks have not settled anything) */
  var quiet = function (x) { return !x.cap && !x.m.promo && !x.check && !enPrise(x.after); }, k = -1;
  if (mate) k = mate;
  else for (var j = 1; j + 1 < nodes.length; j++) if (quiet(nodes[j]) && quiet(nodes[j + 1])) { k = j; break; }
  var ok = k >= 0;
  if (!ok) k = nodes.length;
  var end = k ? nodes[k - 1].after : st0, lw = [], lb = [];
  for (var q = 0; q < k; q++) if (nodes[q].cap) (colorW(nodes[q].cap) ? lw : lb).push(pType(nodes[q].cap));
  return { k: k, ok: ok, n: nodes.length, mate: mate, moves: nodes.map(function (x) { return x.u; }),
           w: sideMaterial(end.b, true) - sideMaterial(st0.b, true), b: sideMaterial(end.b, false) - sideMaterial(st0.b, false),
           lw: lw, lb: lb, ev: settleEvent(nodes, k, mate, side) };
}
function settleEvent(nodes, k, mate, side) {
  var mine = function (x) { return side == null || x.w === !!side; }, upto = nodes.slice(0, k), i;
  if (mate && mine(nodes[mate - 1])) return { t: 'mate', at: mate, w: nodes[mate - 1].w, m: nodes[mate - 1].u };
  for (i = 0; i < upto.length; i++) if (upto[i].m.promo && mine(upto[i])) return { t: 'promo', at: i + 1, w: upto[i].w, m: upto[i].u, p: pType(upto[i].m.promo) };
  for (i = 0; i < upto.length; i++) {
    var f = mine(upto[i]) ? motifMade(upto[i]) : null;
    if (f) return { t: f.t, at: i + 1, w: upto[i].w, m: upto[i].u, sq: sqName(f.sq) };
  }
  var first = {};
  for (i = 0; i < upto.length; i++) {
    var x = upto[i];
    if (first[x.w] == null) { first[x.w] = i; continue; }
    if (x.cap && mine(x)) return { t: 'capture', at: i + 1, w: x.w, m: x.u, p: pType(x.cap) };
  }
  return { t: 'net', at: k };
}
/* a fork or a pin the move of node x makes, as the motif code finds them
   (moveDoes reads a move the same way): {t, sq} or null */
function motifMade(x) {
  var piece = pType(x.before.b[x.m.from]);
  if (piece !== 'K') {
    var f = mFork({ nodes: [{}, { after: x.after, move: x.m, piece: piece }, {}, { piece: 'K' }], povWhite: x.w });
    if (f) return { t: 'fork', sq: f.sq };
  }
  var p = mPin({ nodes: [{}, { after: x.after }], povWhite: x.w });
  if (p && p.piece !== 'P') {
    var was = mPin({ nodes: [{}, { after: x.before }], povWhite: x.w });
    if (!(was && was.sq === p.sq)) return { t: 'pin', sq: p.sq };
  }
  return null;
}
/* a settled line as the key keeps it: {k, ok (1/0), w, b, lw, lb (piece
   letters as strings), e (the event)} */
function settleRec(s) {
  return { k: s.k, ok: s.ok ? 1 : 0, w: s.w, b: s.b, lw: s.lw.join(''), lb: s.lb.join(''), e: s.ev };
}
/* the piece on square from survives line ucis (from st) to where it
   settles: followed as it moves, lost when a capture lands on its square,
   unless that is a trade: it had just taken a piece worth as much (card
   1's queen takes theirs on f8 and is taken back), or the capturer, worth
   as much, is taken back on the next ply */
function pieceSurvives(st, ucis, from) {
  var s = settleLine(st, ucis), pos = cloneState(st), sq = from, mine = st.b[from] ? colorW(st.b[from]) : null, took = 0;
  if (mine == null) return false;
  var worth = MOTIF_VAL[pType(st.b[from])];
  for (var i = 0; i < s.k; i++) {
    var m = uciToMove(pos, s.moves[i]);
    if (!m) break;
    var csq = m.ep >= 0 ? m.ep : m.to;
    if (!!pos.w === mine && m.from === sq) { took = pos.b[csq] ? MOTIF_VAL[pType(pos.b[csq])] : 0; sq = m.to; }
    else if (!!pos.w !== mine && csq === sq) {
      if (took >= worth) return true;
      var by = MOTIF_VAL[pType(pos.b[m.from])], nx = cloneState(pos);
      applyMove(nx, m);
      var back = s.moves[i + 1] ? uciToMove(nx, s.moves[i + 1]) : null;
      return !!back && back.to === m.to && by >= worth;
    }
    else if (!!pos.w === mine) took = 0;
    applyMove(pos, m);
  }
  return true;
}

/* ── The fact sheet (V1.1) ──────────────────────────────────────────────────
   One checked record per card, b.k, from 1,000,000-node searches, kept for
   the card's life and read again only when FACTS_V changes. Every chess
   claim on the card reads it, or the record's own fields, which it writes
   (factsApply: the answer, its line and score, the game move's score and
   the refutation, win chances, the only move, the gap to the next best).
   Computed in the background, one card at a time, so it holds one engine
   worker (a phone keeps its other for tries): today's set as soon as Today
   opens, in set order, then the next set's candidates, then every other
   position, decided games first (enrichTargets). A card reached before its
   key opens on the 250,000-node look (deepEnrich) and takes the key between
   frames (factsSwap, 13-card.js). With the engine down only keyed cards are
   dealt (dealable).
   b.k = {
     v    FACTS_V
     a    the answer: the best line's first move (uci). It replaces the
          stored answer when they differ, and every word follows it
     l    the card position's three best lines, best first: [uci, cp, mate,
          packed line], cp from the player's side (clamped to +-1500), mate
          in moves from the player's side (+ the player mates, - is mated)
          or null; each line extended to where it settles, 12 plies at most.
          The first is the answer's, from a search of one line (where a mate
          or the best move shows soonest: at 1,000,000 nodes three lines
          miss the Kb2 card's mate in 7 and rank d5 over f5 on card 2), the
          other two the best others of a search of three lines; one of
          those clearly better than the single line (factsBetter: a mate it
          lacks, or more than 4 points above it) becomes the answer instead.
          The answer's line past its first move is a search of its own from
          the position after it (their best reply, as a search there finds
          it), the score the root search's
     g    the position after the game move: [cp, mate, packed line], the
          refutation (their move first), from the player's side
     om   1 when the answer is the only move (V1.4): the next best is 10 or
          more points worse and a step lower on the card's scale (scaleStep),
          and either at 40% or less or the best at 80% or more
     fm   the forced mate's length in moves when the best line mates, else 0
     th   their threats (V1.5), up to two: [uci, mate (1: mate in one; n: a
          forced mate in n; 0 none), gain (pawns where its line settles)],
          mate first, then the biggest settled gain; every mate in one, every
          capture (its line's settled gain, else the static exchange) and
          the null-move lines, a quiet move only when its line wins material
          where it settles; [] when none or the player is in check
     sg   the game move's settled line (settleLine from the card's position:
          the game move, then the refutation), its events theirs (settleRec)
     sb   the answer's settled line (the best line), its events the player's
     why  the answer's reason, the first that holds in V2.4's order: {r:
          'mate', n}; {r: 'saves', p, sq} (the attacked piece moves to
          safety); {r: 'guards', sqs, ps} (the moved piece itself defends an
          attacked piece or the mate square; ps piece letters, 'mate' for
          the mate square); {r: 'stops', t: 'mate' | 'threat' | 'pawn', m};
          {r: 'traps', p, sq} (the piece its line wins has no safe square);
          {r: 'wins', n} (net where the line settles, the player then better
          or winning); {r: 'blocks'} (the check); {r: 'attacks', p, sq}; {r:
          'band', w} (the answer's win chance)
     pm   the moves of the answer's piece (V2.3's Hint 2): up to six [uci,
          safe (1: the piece is not lost where its line settles), cp], best
          first, from one 250,000-node search of those moves (the answer,
          the piece's moves among the lines, then the statically safe ones);
          pn its legal moves, ps how many of them are safe (the searched ones
          by their line, the rest by the static exchange on the square)
     ic   1 when the player is in check (no null-move search, no threats)
     x    the deeper look's drop rules on the key: 'deep' (the game move
          within the bar), 'lost' (a game already lost, not decided by it),
          'same' (the game move is the answer); the card leaves the set
   } */
var FACTS_V = 1, FACTS_NODES = 1000000, PM_NODES = 250000, PM_MAX = 6;
var factsState = { failed: {}, pending: {} };
/* the key's searches carry a tag of their own: a card's other searches
   (the stand-in look, its danger facts, its reply list) are promoted or
   stopped by the card's key without touching it */
function factsTag(key) { return 'k:' + key; }
/* the key while it is current, else null */
function factsOf(b) { var k = b && b.k; return k && k.v === FACTS_V ? k : null; }
/* the key's lines as moves from the player's side: [{u, cp, mate, pv}] */
function factsLines(k) { return (k && k.l || []).map(function (l) { return { u: l[0], cp: l[1], mate: l[2], pv: unpackUci(l[3]) }; }); }
/* one search of the fact sheet, tagged with its card; a search stopped
   part-way is no answer */
function factsEval(fen, nodes, o, ctx) {
  var opts = { tag: ctx.tag };
  for (var k in o || {}) opts[k] = o[k];
  return engineEval(fen, { nodes: nodes }, ctx.prio, opts).then(function (r) {
    if (!r || r.stopped) throw { stopped: true };
    return r;
  });
}
/* a line made long enough to settle (V1.1): searched on from its last
   position at 120,000 nodes, twice at most, 12 plies in all */
function factsSettled(st, pv, ctx) {
  var line = (pv || []).slice(0, SETTLE_MAX), rounds = 0;
  var step = function () {
    var s = settleLine(st, line);
    if (s.n < line.length) line = line.slice(0, s.n);
    if (s.ok || line.length >= SETTLE_MAX || rounds >= 2 || s.n < 1) return Promise.resolve(line);
    var end = playUci(st, line).states.pop() || st;
    if (!legalMoves(end).length) return Promise.resolve(line);
    rounds++;
    return factsEval(stateFen(end), EXT_NODES, {}, ctx).then(function (r) {
      var more = (r.pv || []).slice(0, SETTLE_MAX - line.length);
      if (!more.length) return line;
      line = line.concat(more);
      return step();
    }, function (e) { if (e && e.stopped) throw e; return line; });
  };
  return step();
}
/* their threats on the card's position (V1.5), from lines of the null-move
   position (them to move; scores from White's side, as the engine gives
   them): [[uci, mate, gain], ...] up to two, mate first, then the biggest
   settled gain. A line that does not mate counts only where it is a real
   option for them (within 10 points of their best line that does not
   mate), and a quiet move only when what it wins is not another threat's
   capture played later in its line (184434540700:103's e5 dxe5 Nxg3 is the
   threat Nxg3); a promotion's pieces are one threat (the queen's) */
function factsThreats(pre, lines, pov, all) {
  if (checkersOf(pre).length) return [];
  var nst = dzNullState(pre), them = !pov, c = {};
  var sq = function (u) { return u.slice(0, 4); };
  var add = function (u, mate, gain, i) {
    var x = c[sq(u)];
    if (!x) c[sq(u)] = { u: u, mate: mate, gain: gain, i: i };
    else { if (mate && (!x.mate || mate < x.mate)) x.mate = mate; if (gain > x.gain) x.gain = gain; if (i < x.i) { x.i = i; } if (/q$/.test(u)) x.u = u; }
  };
  var gainOf = function (s) { return them ? s.w - s.b : s.b - s.w; };
  var wThem = function (l) { return winPct(them ? l.cp : -l.cp); }, ok = (lines || []).filter(function (l) { return l && l.pv && l.pv[0] && uciToMove(nst, l.pv[0]); });
  var mates = function (l) { return l.mate != null && (them ? l.mate : -l.mate) > 0; };
  var top = Math.max.apply(null, [0].concat(ok.filter(function (l) { return !mates(l); }).map(wThem)));
  var quiet = [];
  /* the null-move lines: a mate of theirs, else what the line wins where it
     settles (a quiet move is named only then) */
  ok.forEach(function (l, i) {
    var u = l.pv[0];
    if (mates(l)) { add(u, them ? l.mate : -l.mate, 0, i); return; }
    if (wThem(l) < top - 10) return;
    var s0 = settleLine(nst, l.pv), g = gainOf(s0), m0 = uciToMove(nst, u);
    if (g < 1) return;
    if (nst.b[m0.to] || m0.ep >= 0 || m0.promo) add(u, 0, g, i);
    else quiet.push({ u: u, g: g, i: i, caps: s0.moves.slice(1, s0.k).filter(function (x, j) { return j % 2 === 1; }) });
  });
  /* every mate in one, and every capture by what it nets where its line
     settles: a capture the lines play keeps their count, any other the
     static exchange on its square (both sides taking in turn, each free to
     stop) */
  legalMoves(nst).forEach(function (m) {
    var u = moveUci(m), x = cloneState(nst);
    applyMove(x, m);
    if (isMate(x)) { add(u, 1, 0, 9); return; }
    if (c[sq(u)] || !nst.b[m.to]) return;
    var g = dzSeeMove(nst.b, m.from, m.to);
    if (g >= 1) add(u, 0, g, 9);
  });
  /* a quiet move whose line only plays another threat's capture later is
     that threat, not one of its own */
  quiet.forEach(function (x) { if (!x.caps.some(function (u2) { return !!c[sq(u2)]; })) { add(x.u, 0, x.g, x.i); c[sq(x.u)].q = 1; } });
  var list = Object.keys(c).map(function (k) { return c[k]; }).sort(function (x, y) {
    return (y.mate ? 1 : 0) - (x.mate ? 1 : 0) || (x.mate && y.mate ? x.mate - y.mate : 0) || y.gain - x.gain || x.i - y.i;
  });
  /* all: every candidate, best first, a quiet one marked (q) for the key
     to confirm (factsCompute) */
  return all ? list : list.slice(0, 2).map(function (x) { return [x.u, x.mate, x.gain]; });
}
/* the key's threats: factsThreats' candidates, a quiet one kept only when
   a search of its own confirms what it wins where its line settles (the
   null-move line's tail can miss their best answer: 184257113186:38's
   Nc8 is met by Be3, 184329623608:48's a5 by Rg3+); up to two */
function factsThreatsChecked(pre, lines, pov, ctx) {
  var cands = factsThreats(pre, lines, pov, true), nst = dzNullState(pre), th = [];
  if (!cands.length) return Promise.resolve(th);
  var gainOf = function (s) { return !pov ? s.w - s.b : s.b - s.w; };
  return cands.reduce(function (p, x) {
    return p.then(function () {
      if (th.length >= 2) return;
      if (!x.q || x.mate) { th.push([x.u, x.mate, x.gain]); return; }
      var after = cloneState(nst), m = uciToMove(after, x.u);
      if (!m) return;
      applyMove(after, m);
      if (!legalMoves(after).length) return;
      return factsEval(stateFen(after), FACTS_NODES, {}, ctx).then(function (r) {
        return factsSettled(after, r.pv || [], ctx);
      }).then(function (pv) {
        var g = gainOf(settleLine(nst, [x.u].concat(pv)));
        if (g >= 1) th.push([x.u, 0, Math.min(g, x.gain)]);
      });
    });
  }, Promise.resolve()).then(function () { return th; });
}
/* a threat t ([uci, mate, gain]) no longer works once the answer is on the
   board (after: them to move): its move is gone, mates no more, or no
   longer wins what it would take (V2.1's "stops": legal before the answer,
   winning or mating there, and not after it) */
function factsStopped(pre, after, t) {
  var nst = dzNullState(pre), m0 = uciToMove(nst, t[0]), m1 = uciToMove(after, t[0]);
  if (!m0) return false;
  if (!m1) return true;
  var x = cloneState(after);
  applyMove(x, m1);
  if (t[1] === 1) return !isMate(x);
  if (t[1] > 1) return false;
  var t0 = nst.b[m0.to], t1 = after.b[m1.to];
  if (!t0) return false;
  return t1 !== t0 || !(dzSeeMove(after.b, m1.from, m1.to) > 0);
}
/* the answer's reason (V2.4's order), from the key's own facts */
function factsWhy(pre, k, pov, bestPv) {
  var m = uciToMove(pre, k.a);
  if (!m) return { r: 'band', w: winPct(k.l[0][1]) };
  if (k.fm) return { r: 'mate', n: k.fm };
  var after = cloneState(pre), piece = pType(pre.b[m.from]), them = !pov;
  applyMove(after, m);
  var at = dangerAttacked(pre, pov), sb = k.sb, w = winPct(k.l[0][1]);
  /* saves: the attacked piece moves where its line keeps it */
  if (at.some(function (x) { return x[0] === m.from; }) && pieceSurvives(pre, bestPv, m.from)) return { r: 'saves', p: piece, sq: sqName(m.to) };
  /* guards: the moved piece itself defends an attacked piece of yours, or
     the square their mate in one lands on */
  var hits = attacksFrom(after.b, m.to), sqs = [], ps = [], mt = (k.th || []).filter(function (t) { return t[1] === 1; })[0];
  if (mt && hits.indexOf(sqIndex(mt[0].slice(2, 4))) >= 0) { sqs.push(mt[0].slice(2, 4)); ps.push('mate'); }
  at.forEach(function (x) { if (x[0] !== m.from && hits.indexOf(x[0]) >= 0 && after.b[x[0]] === pre.b[x[0]] && sqs.indexOf(sqName(x[0])) < 0) { sqs.push(sqName(x[0])); ps.push(pType(pre.b[x[0]])); } });
  if (sqs.length) return { r: 'guards', sqs: sqs, ps: ps };
  /* stops: their mate, the threat named, or their pawn */
  var t0 = mt || (k.th || [])[0];
  if (t0 && factsStopped(pre, after, t0)) {
    /* a pawn's run (a pawn move that takes nothing) is their pawn, even
       where it ends in mate; a pawn's capture is a threat like any other */
    var nst0 = dzNullState(pre), tm = uciToMove(nst0, t0[0]), run = !!tm && pType(nst0.b[tm.from]) === 'P' && !nst0.b[tm.to] && tm.ep < 0;
    return { r: 'stops', t: run && t0[1] !== 1 ? 'pawn' : t0[1] ? 'mate' : 'threat', m: t0[0] };
  }
  var net = sb ? (pov ? sb.w - sb.b : sb.b - sb.w) : 0;
  /* traps: the piece the line wins, of theirs, has no safe square once the
     answer is played */
  var won = sb ? (pov ? sb.lb : sb.lw).split('').sort(function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; })[0] : null;
  if (won && won !== 'P' && net >= 1) {
    for (var sq = 0; sq < 64; sq++) {
      var p = after.b[sq];
      if (p && colorW(p) === them && pType(p) === won && isTrappedAt(after, sq)) return { r: 'traps', p: won, sq: sqName(sq) };
    }
  }
  /* wins: net where the line settles, the player then better or winning */
  if (net >= 1 && w >= 60) return { r: 'wins', n: net };
  /* blocks the check */
  if (checkersOf(pre).length && piece !== 'K' && !pre.b[m.to]) return { r: 'blocks' };
  /* attacks a piece: one worth more than the mover, or unguarded */
  var hit = null;
  hits.forEach(function (q) {
    var tp = after.b[q];
    if (!tp || colorW(tp) !== them || pType(tp) === 'K') return;
    if ((MOTIF_VAL[pType(tp)] > MOTIF_VAL[piece] || !isDefended(after.b, q)) && (!hit || MOTIF_VAL[pType(tp)] > MOTIF_VAL[pType(after.b[hit])])) hit = q;
  });
  if (hit != null) return { r: 'attacks', p: pType(after.b[hit]), sq: sqName(hit) };
  return { r: 'band', w: w };
}
/* the answer's piece's moves (pm, V2.3), one 250,000-node search */
function factsPm(pre, k, lines, sign, ctx) {
  var best = uciToMove(pre, k.a);
  if (!best) return Promise.resolve();
  var from = best.from, them = !pre.w, mv = legalMoves(pre).filter(function (x) { return x.from === from; });
  var safeNow = function (x) { var a = cloneState(pre); applyMove(a, x); return !(dzSee(a.b, x.to, them) > 0); };
  var order = [k.a];
  lines.forEach(function (l) { var x = uciToMove(pre, l.pv[0]); if (x && x.from === from && order.indexOf(l.pv[0]) < 0) order.push(l.pv[0]); });
  var rest = mv.filter(function (x) { return order.indexOf(moveUci(x)) < 0; }).sort(function (x, y) {
    return (safeNow(y) ? 2 : 0) + (pre.b[y.to] ? 1 : 0) - (safeNow(x) ? 2 : 0) - (pre.b[x.to] ? 1 : 0);
  });
  order = order.concat(rest.map(moveUci)).slice(0, PM_MAX);
  k.pn = mv.length;
  var finish = function (r) {
    var got = {};
    (r && r.lines || []).forEach(function (l) { if (l && l.pv && l.pv[0] && !got[l.pv[0]]) got[l.pv[0]] = l; });
    k.pm = order.map(function (u) {
      var l = got[u] || (u === k.a ? { cp: k.l[0][1] * sign, pv: unpackUci(k.l[0][3]) } : null);
      return [u, l ? (pieceSurvives(pre, l.pv, from) ? 1 : 0) : (safeNow(uciToMove(pre, u)) ? 1 : 0), l ? l.cp * sign : null];
    }).sort(function (x, y) { return (y[2] == null ? -9999 : y[2]) - (x[2] == null ? -9999 : x[2]); });
    var safe = {};
    k.pm.forEach(function (x) { safe[x[0]] = x[1]; });
    k.ps = mv.filter(function (x) { var u = moveUci(x); return u in safe ? safe[u] : safeNow(x); }).length;
  };
  if (order.length < 2) { finish(null); return Promise.resolve(); }
  return factsEval(stateFen(pre), PM_NODES, { searchmoves: order, multipv: order.length }, ctx).then(finish, function (e) { if (e && e.stopped) throw e; finish(null); });
}
/* the key for card it: its searches, one after another (one worker), then
   the facts read from them. Resolves with the key, or null when the card
   cannot be read */
/* line x clearly better than line y (both from the player's side): a mate
   y lacks, a quicker mate, a longer defence against one, or more than the
   found band (SOLVE_TOL) above it */
function factsBetter(x, y) {
  var val = function (l) { return l.mate != null && l.mate > 0 ? 1e5 - l.mate : l.mate != null && l.mate < 0 ? -1e5 - l.mate : winPct(l.cp); };
  if (x.mate != null || y.mate != null) return val(x) > val(y);
  return winPct(x.cp) - winPct(y.cp) > SOLVE_TOL;
}
function factsCompute(it, prio) {
  var g = it.g, b = it.b;
  var pre = g && g.mv ? stateAtPly(g.mv, b.p) : null, post = pre ? postState(g, b.p) : null, pu = pre ? uciOfSan(g.mv, b.p) : null;
  if (!pre || !post || !pu) return Promise.resolve(null);
  var sign = g.color === 'white' ? 1 : -1, pov = sign > 0, ctx = { prio: !!prio, tag: factsTag(it.key) }, inCheck = checkersOf(pre).length > 0;
  var mine = function (l) { return { cp: l.cp * sign, mate: l.mate != null ? l.mate * sign : null, pv: (l.pv || []).slice() }; };
  var S1, S2, S3, k = { v: FACTS_V };
  var seq = function (list) { return list.reduce(function (p, f) { return p.then(f); }, Promise.resolve()); };
  var legal = function (l) { return l && l.pv && l.pv[0] && uciToMove(pre, l.pv[0]); };
  return factsEval(stateFen(pre), FACTS_NODES, {}, ctx).then(function (r) {
    var top = { cp: r.cp, mate: r.mate, pv: r.pv && r.pv.length ? r.pv : r.bestUci ? [r.bestUci] : [] };
    if (!legal(top)) throw { none: true };
    S1 = [mine(top)];
    return factsEval(stateFen(pre), FACTS_NODES, { multipv: 3 }, ctx);
  }).then(function (r) {
    (r.lines && r.lines.length ? r.lines : [{ cp: r.cp, mate: r.mate, pv: r.pv || [] }]).forEach(function (l) {
      if (S1.length < 3 && legal(l) && l.pv[0] !== S1[0].pv[0]) S1.push(mine(l));
    });
    /* the answer is the single line's move unless one of the three is
       clearly better: each search can miss what the other finds at this
       budget (184364964898:69's mate in 11 shows only among the three) */
    var bi = 0;
    S1.forEach(function (l, i) { if (i && factsBetter(l, S1[bi])) bi = i; });
    if (bi) S1.unshift(S1.splice(bi, 1)[0]);
    /* the answer's line from a search of its own, after it: a line's tail
       from the root search can miss their best reply (184426845252:51's b5
       is met by d6, not cxb5), and every claim of the answer reads this
       line */
    var x = cloneState(pre), m = uciToMove(x, S1[0].pv[0]);
    applyMove(x, m);
    return legalMoves(x).length ? factsEval(stateFen(x), FACTS_NODES, {}, ctx).then(function (r2) {
      var tail = r2.pv && r2.pv.length ? r2.pv : r2.bestUci ? [r2.bestUci] : [];
      if (tail.length && uciToMove(x, tail[0])) S1[0].pv = [S1[0].pv[0]].concat(tail);
    }) : null;
  }).then(function () {
    return factsEval(stateFen(post), FACTS_NODES, {}, ctx);
  }).then(function (r) {
    S2 = mine({ cp: r.cp, mate: r.mate, pv: r.pv || [] });
    return inCheck ? null : factsEval(stateFen(dzNullState(pre)), FACTS_NODES, { multipv: 2 }, ctx);
  }).then(function (r) {
    S3 = !r ? [] : (r.lines && r.lines.length ? r.lines : [{ cp: r.cp, mate: r.mate, pv: r.pv || [] }]).filter(function (l) { return l && l.pv && l.pv[0]; }).slice(0, 2).map(function (l) { return { cp: l.cp, mate: l.mate, pv: l.pv.slice() }; });
    /* every line extended to where it settles */
    var nst = dzNullState(pre);
    return seq(S1.map(function (l) { return function () { return factsSettled(pre, l.pv, ctx).then(function (x) { l.pv = x; }); }; })
      .concat([function () { return factsSettled(post, S2.pv, ctx).then(function (x) { S2.pv = x; }); }])
      .concat(S3.map(function (l) { return function () { return l.mate != null ? null : factsSettled(nst, l.pv, ctx).then(function (x) { l.pv = x; }); }; })));
  }).then(function () {
    var l0 = S1[0], l1 = S1[1], wb = winPct(l0.cp), wa = winPct(S2.cp), bar = Math.max(10, mistakeMinFor(g) - 3);
    k.a = l0.pv[0];
    k.l = S1.map(function (l) { return [l.pv[0], l.cp, l.mate, packUci(l.pv)]; });
    k.g = [S2.cp, S2.mate, packUci(S2.pv)];
    /* the deeper look's drop rules, on the key; a lichess verdict stands */
    if (b.j !== 'l') {
      if (wb - wa < bar) k.x = 'deep';
      else if (!b.d && wb < 15) k.x = 'lost';
      else if (k.a === pu) k.x = 'same';
    }
    if (k.x) return k;
    var w1 = l1 ? winPct(l1.cp) : null;
    k.om = l1 && wb - w1 >= 10 && scaleStep(w1) < scaleStep(wb) && (w1 <= 40 || wb >= 80) ? 1 : 0;
    k.fm = l0.mate != null && l0.mate > 0 ? l0.mate : 0;
    if (inCheck) k.ic = 1;
    return factsThreatsChecked(pre, S3, pov, ctx).then(function (th) { k.th = th; return factsRest(); });
  }).catch(function (e) { if (e && e.none) return null; throw e; });
  function factsRest() {
    var l0 = S1[0];
    k.sg = settleRec(settleLine(pre, [pu].concat(S2.pv), !pov));
    k.sb = settleRec(settleLine(pre, l0.pv, pov));
    k.why = factsWhy(pre, k, pov, l0.pv);
    return factsPm(pre, k, S1, sign, ctx).then(function () { return k; });
  }
}
/* where the record's two lines settle by the key's settle rule, as the
   classifier's node indexes (its best line opens with a null move, its game
   line with the game move): {b, g}, or {} with no key (V1.1: the
   classifier counts material where the fact sheet does) */
function factsSettle(b, pov) {
  var k = factsOf(b);
  if (!k || k.x || b.kp !== FACTS_V || !k.sb || !k.sg || b.lu !== k.l[0][3] || b.ru !== k.g[2]) return {};
  /* a gain the answer's score does not show counts only as far as the
     answer's own capture: in a dead draw the line's later moves are any
     (184425961982:122's Kxf5 takes the pawn; the knight is not lost) */
  var net = pov ? k.sb.w - k.sb.b : k.sb.b - k.sb.w;
  return { b: net >= 1 && winPct(k.l[0][1]) < 60 ? 1 : k.sb.k, g: Math.max(0, k.sg.k - 1) };
}
/* the key's facts written to the record's own fields, which every older
   reader uses (the answer, its line and score, the game move's score and
   the refutation, the win chances, the only move, the gap to the next
   best), and the card named again from them; a key that does not confirm
   the mistake sets it aside. Once per key (b.kp) */
function factsApply(it) {
  var b = it.b, k = factsOf(b);
  if (!k || b.kp === FACTS_V) return;
  b.kp = FACTS_V;
  if (k.x) { if (!b.x) b.x = k.x; return; }
  var l0 = k.l[0], l1 = k.l[1];
  b.bu = l0[0]; b.lu = l0[3]; b.eb = l0[1]; b.mb = l0[2];
  b.ea = k.g[0]; b.ma = k.g[1]; b.ru = k.g[2];
  b.wb = winPct(b.eb); b.wa = winPct(b.ea);
  b.om = k.om || 0;
  if (l1) b.g2 = Math.round(b.wb - winPct(l1[1])); else delete b.g2;
  b.v = Math.max(b.v || 0, 2);
  classifyEntry(b, it.g.mv);
}
/* the card's key, made now if it has none (prio: a player waits on it).
   Resolves with the item once stored (and applied), or when it cannot be */
function ensureFacts(it, prio) {
  var b = it.b, key = it.key, myGen = gen;
  if (factsOf(b) || b.x || it.foil || it.prac || it.lesson) return Promise.resolve(it);
  if (factsState.pending[key]) { if (prio) promoteTag(factsTag(key)); return factsState.pending[key]; }
  if (SF.state === 'failed') return Promise.resolve(it);
  var done = function () { delete factsState.pending[key]; return it; };
  var p = factsCompute(it, prio).then(function (k) {
    if (stale(myGen) || b.x) return;
    /* a card that cannot be read is not asked again this visit */
    if (!k) { factsState.failed[key] = 1; return; }
    b.k = k;
    delete b.kp;
    factsApply(it);
    /* the danger facts read the key's threats from now on */
    delete b.dz;
    modelDirty();
    scheduleSave();
    factsLanded(it);
  }, function (e) { if (!(e && e.stopped)) factsState.failed[key] = 1; });
  factsState.pending[key] = p.then(done, done);
  return factsState.pending[key];
}
/* the background queue: every position still waiting for its key, in the
   order the keys are made in: the set being played from the card on screen
   (else today's set), in set order; then the next set's candidates; then
   every other position, decided games first, newest games first. The name
   is the deeper look's queue's, so whatever counted that queue counts this */
function enrichTargets() {
  var out = [], seen = {}, add = function (it) {
    if (!it || seen[it.key] || it.foil || it.prac || it.lesson || !trainable(it) || factsOf(it.b) || factsState.failed[it.key]) return;
    seen[it.key] = 1;
    out.push(it);
  };
  var ss = ui.session || savedSession();
  if (ss && ss.keys && !ss.finished) ss.keys.slice(ss.idx || 0).concat(ss.relearn || []).forEach(function (k) { add(itemOf(k)); });
  else todayPlan().keys.forEach(function (k) { add(itemOf(k)); });
  morePracticeKeys().forEach(function (k) { add(itemOf(k)); });
  allMistakes().slice().sort(function (x, y) { return (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || y.g.ts - x.g.ts; }).forEach(add);
  return out;
}

