/* ── The deeper look ────────────────────────────────────────────────────────
   Every mistake is named at scan time from the scan's own lines. A card gets
   a deeper look (250k nodes, two lines) just before it is shown, and in
   the background only the cards that matter next: the mistake that decided
   each game, and the next day's candidates. Lichess's own server analysis
   searched far deeper than a browser can, so its verdict is never
   overruled: its cards only gain the refutation line. */

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
  if ((b.v || 0) >= 2 && !recheck) return Promise.resolve(it);
  var DN = deep ? CONFIRM_NODES : DEEP_NODES;
  if (enrichPending[it.key]) {
    /* started in the background, and now the player is waiting on it */
    if (prio && enrichCtx[it.key] && !enrichCtx[it.key].prio) { enrichCtx[it.key].prio = true; promoteTag(it.key); }
    return enrichPending[it.key].then(function () { return it; });
  }
  var pre = stateAtPly(g.mv, b.p), post = postState(g, b.p);
  if (!pre || !post) { b.x = 'moves'; modelDirty(); return Promise.resolve(it); }
  var sign = g.color === 'white' ? 1 : -1;
  var key = it.key, done = function () { delete enrichPending[key]; delete enrichCtx[key]; return it; };
  var ctx = enrichCtx[key] = { prio: !!prio };
  var p;
  if (b.j === 'l') {
    /* lichess analysed this: keep its verdict, its answer and its line */
    p = engineEval(stateFen(post), { nodes: DEEP_NODES }, ctx.prio, { tag: key }).then(function (r2) {
      if (stale(myGen) || (b.v || 0) >= 2) return;
      b.ma = r2.mate != null ? r2.mate * sign : b.ma;
      b.ea = r2.cp * sign;
      return extendLine(post, r2.pv || [], EXT_NODES, ctx, key).then(function (ru) {
        if (stale(myGen)) return;
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
    p = engineEval(stateFen(pre), { nodes: DN }, ctx.prio, { multipv: 2, tag: key })
      .then(function (r) { r1 = r; return engineEval(stateFen(post), { nodes: DN }, ctx.prio, { tag: key }); })
      .then(function (r2) {
        /* a close call on a thin board is searched again, four times deeper,
           but only in the background: a player never waits on it */
        var drop = winPct(sign * r1.cp) - winPct(sign * r2.cp);
        if (stale(myGen) || ctx.prio || deep || !thinBoard(pre) || drop < bar || drop >= bar + 10) return r2;
        return engineEval(stateFen(pre), { nodes: CONFIRM_NODES }, ctx.prio, { multipv: 2, tag: key }).then(function (r) {
          r1 = r;
          return engineEval(stateFen(post), { nodes: CONFIRM_NODES }, ctx.prio, { tag: key });
        });
      })
      .then(function (r2) {
        if (stale(myGen) || ((b.v || 0) >= 2 && !recheck)) return;
        if (deep) b.dv = 1;
        var wb2 = winPct(sign * r1.cp), wa2 = winPct(sign * r2.cp);
        /* a mistake the deeper look does not confirm never becomes a card,
           nor does a slip in a game that was already lost and not decided by it */
        if (wb2 - wa2 < bar) { b.x = 'deep'; modelDirty(); return; }
        if (!b.d && wb2 < 15) { b.x = 'lost'; modelDirty(); return; }
        if (!r1.bestUci || r1.bestUci === uciOfSan(g.mv, b.p)) { b.x = 'same'; modelDirty(); return; }
        b.wb = wb2; b.wa = wa2;
        b.bu = r1.bestUci;
        b.eb = r1.cp * sign;
        b.ea = r2.cp * sign;
        b.mb = r1.mate != null ? r1.mate * sign : null;
        b.ma = r2.mate != null ? r2.mate * sign : null;
        var second = r1.lines && r1.lines[1];
        if (second && second.pv && second.pv[0]) {
          /* only move: every alternative is 15 or more points worse */
          b.om = winPct(b.eb) - winPct(second.cp * sign) >= 15 ? 1 : 0;
          /* the gap to the second-best move, in win-chance points */
          b.g2 = Math.round(winPct(b.eb) - winPct(second.cp * sign));
        }
        return Promise.all([
          extendLine(pre, r1.pv || [], EXT_NODES, ctx, key),
          extendLine(post, r2.pv || [], EXT_NODES, ctx, key)
        ]).then(function (lines) {
          if (stale(myGen)) return;
          b.lu = packUci(lines[0]);
          b.ru = packUci(lines[1]);
          classifyEntry(b, g.mv);
          b.v = 2;
          modelDirty();
        });
      });
  }
  enrichPending[key] = p.then(done, function () { enrichState.failed[key] = 1; return done(); });
  return enrichPending[key];
}

/* the background queue: decisive mistakes first (newest games first), then
   tomorrow's likely cards. Paused while a move is being checked. */
function enrichTargets() {
  var out = [];
  allMistakes().forEach(function (it) {
    if ((it.b.v || 0) < 2 && !it.b.x && it.b.d && !enrichState.failed[it.key]) out.push(it);
  });
  if (out.length < 5) {
    buildCandidates(12).forEach(function (it) {
      if ((it.b.v || 0) < 2 && out.indexOf(it) === -1 && !enrichState.failed[it.key]) out.push(it);
    });
  }
  /* Thorough, with nothing new to look at: saved positions checked at the
     standard depth are checked again, never one in today's session */
  if (!out.length && scanDepth() === 'thorough') {
    var inSession = {}, ss = ui.session || savedSession();
    if (ss && ss.keys) ss.keys.forEach(function (k) { inSession[k] = 1; });
    allMistakes().forEach(function (it) {
      if (out.length < 1 && trainable(it) && (it.b.v || 0) >= 2 && it.b.dv !== 1 && it.b.j !== 'l' && !it.b.x
          && !inSession[it.key] && !enrichState.failed[it.key]) out.push(it);
    });
  }
  return out;
}
/* the recheck, counted for Settings */
function recheckCount() {
  var n = 0, done = 0;
  allMistakes().forEach(function (it) {
    if (!trainable(it) || it.b.j === 'l') return;
    n++;
    if (it.b.dv === 1) done++;
  });
  return { n: n, done: done };
}
function autoEnrich() {
  if (!cfg.user || enrichState.running || SF.state === 'failed') return;
  var a = ui.session && ui.session.active;
  if (a && (a.phase === 'checking' || !a.phase)) { setTimeout(autoEnrich, 3000); return; }
  if (scanState.running && ui.session) { setTimeout(autoEnrich, 4000); return; }
  var next = enrichTargets()[0];
  if (!next) return;
  enrichState.running = true;
  deepEnrich(next, false, true).then(function () {
    enrichState.running = false;
    enrichState.done++;
    scheduleSave();
    setTimeout(autoEnrich, 200);
  });
}

