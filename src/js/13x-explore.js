/* ── Explore: after the answer, test any move ─────────────────────────────
   The board becomes a question box: play the move you doubt, for either
   side, and Stockfish answers with one arrow, three lines and one sentence
   that says why. One straight trail (a new move drops the moves after it),
   stepped with ‹ ›; ‹ at the start returns to the lesson. Nothing here runs
   before the card is answered. */

var XP_NODES = [0, 250000, 1000000];
function xpActive() { return !!(ui.session && ui.session.active && ui.session.active.explore); }
function posKey(st) { return stateFen(st).split(' ').slice(0, 4).join(' '); }
function xpNode(st, last, mv) { return { st: cloneState(st), key: posKey(st), fen: stateFen(st), last: last || null, mv: mv || null }; }
function xpCur(ex) { return ex.nodes[ex.at]; }
/* the board code reads ex.st, ex.last and ex.sel: they follow the trail */
function xpSync(ex) { var n = xpCur(ex); ex.st = n.st; ex.last = n.last; }
function xpTouch() { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; }
function sideName(w) { return w ? 'White' : 'Black'; }

/* the invite under the lesson, written once when the card is answered:
   "Why Rxc5?" jumps to the moment the opponent chose */
function inviteFor(a) {
  var fallback = { text: 'Move a piece to test an idea. Stockfish answers.', view: null };
  var L = a.lines && a.lines.best;
  if (!L || L.moves.length < 2) return fallback;
  var mine = L.moves[0], reply = L.moves[1], before = L.states[0];
  var myCapture = a.pre.b[mine.to] != null || mine.ep >= 0;
  if (legalMoves(before).length < 2) return fallback;
  if (myCapture && reply.to === mine.to) return fallback;
  var them = a.it.g.color === 'white' ? 'black' : 'white';
  return { text: 'Why ' + L.san[1] + '? Try another ' + them + ' move and Stockfish answers.', view: { line: 'best', idx: 0 } };
}

function startExplore(o) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || a.pendingPromo || !a.lines) return;
  o = o || {};
  a.menuOpen = false;
  /* the frame it came from, to come back to (S14) */
  var from = a.view ? JSON.parse(JSON.stringify(a.view)) : { mode: 's0' };
  if (o.view) a.view = { line: o.view.line, idx: o.view.idx };
  var v = lineView(a);
  a.xpRes = a.xpRes || {};
  var ask = o.via === 'invite' && o.view && a.lines.best.uci[1] && posKey(v.st) === posKey(a.lines.best.states[0])
    ? { uci: a.lines.best.uci[1], san: a.lines.best.san[1] } : null;
  a.explore = { root: from, nodes: [xpNode(v.st, v.last, null)],
                at: 0, sel: o.sq != null ? o.sq : -1, res: a.xpRes, hot: 0, k: 3, say: {}, flash: null,
                ask: ask, wantRow: o.via === 'invite' ? 0 : null };
  xpSync(a.explore);
  xpSpoilIndex();
  track('explore_start_' + (o.via || 'link'));
  renderCard();
  exploreAnalyse(false);
}
function exploreExit(how) {
  var a = ui.session && ui.session.active;
  if (!a || !a.explore) return;
  var root = a.explore.root;
  engineStop('explore');
  a.explore = null;
  a.view = JSON.parse(JSON.stringify(root));
  a.lastView = { line: root.line, idx: root.idx, mode: root.mode };
  track('explore_exit_' + (how || 'link'));
  enginePump();
  if (how === 'silent') return;
  renderCard();
  var inv = document.querySelector('#cpanel [data-act="details"]');
  if (inv && how !== 'pop') inv.focus({ preventScroll: true });
}
/* a move in the exploration, by either side */
function explorePlay(m, dragged) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  var P = xpCur(ex), uci = moveUci(m);
  var pr = ex.res[P.key], pick = !!(pr && pr.lines[0] && pr.lines[0].pv[0] === uci);
  var san = sanOf(P.st, m), st = cloneState(P.st);
  applyMove(st, m);
  ex.nodes = ex.nodes.slice(0, ex.at + 1);
  ex.nodes.push(xpNode(st, [m.from, m.to], { san: san, uci: uci, byYou: P.st.w === myPov(a.it), pick: pick, ply: xpPly(P.st) }));
  ex.at++;
  Object.keys(ex.say).forEach(function (k) { if (+k >= ex.at) delete ex.say[k]; });
  ex.sel = -1; ex.hot = 0; ex.flash = null; ex.hover = null;
  xpThaw(ex);
  xpSync(ex);
  ex.anim = dragged ? null : [m.from, m.to];
  snd('move');
  track(pick ? 'explore_pick' : 'explore_move');
  renderCard();
  exploreAnalyse(true);
}
function xpPly(st) { return (st.full - 1) * 2 + (st.w ? 0 : 1); }
function exploreGo(i) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex || i < 0 || i >= ex.nodes.length || i === ex.at) return;
  var fwd = i === ex.at + 1;
  ex.at = i; ex.sel = -1; ex.hot = 0; ex.flash = null; ex.hover = null;
  xpThaw(ex);
  xpSync(ex);
  var n = xpCur(ex);
  ex.anim = fwd && n.last ? n.last : null;
  if (fwd) snd('move');
  renderCard();
  exploreAnalyse(false);
}
function exploreStep(d) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  if (d < 0) { if (ex.at === 0) exploreExit('back'); else exploreGo(ex.at - 1); return; }
  if (ex.at < ex.nodes.length - 1) { exploreGo(ex.at + 1); return; }
  /* at the end, › plays Stockfish's pick, the one the arrow shows */
  var n = xpCur(ex), r = { lines: xpShown(ex, n) || [] };
  if (!r || !r.lines[0] || xpSpoil(n) || !legalMoves(n.st).length) return;
  var m = uciToMove(n.st, r.lines[0].pv[0]);
  if (m) explorePlay(m, false);
}
/* a click on the board while exploring: pick up a piece of the side to move,
   or play the picked-up one */
function exploreClick(sq) {
  var a = ui.session.active, ex = a.explore;
  var p = ex.st.b[sq];
  if (p && isW(p) === ex.st.w) { ex.sel = ex.sel === sq ? -1 : sq; ex.flash = null; renderCard(); return; }
  if (ex.sel < 0) {
    if (p) { ex.flash = 'It is ' + sideName(ex.st.w) + '\'s move here. Move a ' + sideName(ex.st.w).toLowerCase() + ' piece.'; renderCard(); }
    return;
  }
  var legal = legalMoves(ex.st).filter(function (m) { return m.from === ex.sel && m.to === sq; });
  if (!legal.length) { ex.sel = -1; renderCard(); return; }
  if (legal.length > 1 && legal[0].promo) { a.pendingPromo = { moves: legal, to: sq, explore: true }; renderCard(); return; }
  explorePlay(legal[0], pointerState.suppressClick);
}

/* ── the analysis loop ───────────────────────────────────────────────────── */
function xpGameOver(st) { return !legalMoves(st).length; }
/* another card's own position: Stockfish stays quiet there, or exploring
   would print the answer to a card still to come */
function xpSpoilIndex() {
  var ss = ui.session;
  if (!ss || ss.xpSpoil) return;
  var idx = {};
  allMistakes().forEach(function (it) {
    if (!trainable(it) || it.b.x) return;
    var st = stateAtPly(it.g.mv, it.b.p);
    if (st) idx[posKey(st)] = it.key;
  });
  ss.xpSpoil = idx;
}
/* another card's position, never the position of the card on screen (a
   twin card from another game at the same position included). It reads
   only: cardFor keys the card's position once */
function xpSpoil(n) {
  var ss = ui.session, a = ss && ss.active;
  if (!ss || !ss.xpSpoil || !ss.xpSpoil[n.key]) return false;
  return !(a && n.key === (a.preKey || posKey(a.pre)));
}
function xpRun(a, ex, n, step) {
  return engineEval(n.fen, { nodes: XP_NODES[step] }, true,
    { multipv: 3, tag: 'explore', lanes: [0, 1], hash: xpTouch() ? 32 : 64, xp: { key: n.key, step: step } })
    .then(function (r) {
      if (!r || r.stopped) return;
      var a2 = ui.session && ui.session.active;
      if (a2 !== a || a2.explore !== ex) return;
      var old = ex.res[n.key];
      if (old && old.step >= step) return;
      /* rows under the pointer or keyboard focus keep what they show for up
         to 3 s: the sentence, meter and bar still update */
      if (n === xpCur(ex) && old && old.lines.length && !ex.frozen && (ex.hover != null || xpRowFocused())) {
        ex.frozen = { key: n.key, lines: old.lines };
        ex.frozenT = setTimeout(function () { var a3 = ui.session && ui.session.active; if (xpThaw(ex) && a3 && a3.explore === ex) renderCard(); }, 3000);
      }
      ex.res[n.key] = { step: step, lines: keepSlots(old && old.lines, r.lines.slice(0, 3)), depth: r.depth };
      xpAfterResult(a, ex, n);
    }, function (err) {
      if (err && err.stopped) return;
      var a2 = ui.session && ui.session.active;
      if (a2 !== a || a2.explore !== ex) return;
      n.fails = (n.fails || 0) + 1;
      if (SF.state === 'failed' || n.fails >= 2) { n.down = true; if (xpCur(ex) === n) renderCard(); }
    });
}
function xpRowFocused() { var f = document.activeElement; return !!(f && f.closest && f.closest('#xp .xp-row[data-act="xpRow"]')); }
/* the lines the rows show: the frozen ones while the rows are held */
function xpShown(ex, n) { return ex.frozen && ex.frozen.key === n.key ? ex.frozen.lines : (ex.res[n.key] ? ex.res[n.key].lines : null); }
function xpThaw(ex) { if (!ex.frozen) return false; ex.frozen = null; clearTimeout(ex.frozenT); return true; }
/* slot 0 is always the new best (the gold arrow is row 1); the other rows
   keep their place while their first move stays in the top three */
function keepSlots(old, fresh) {
  if (!old || !old.length) return fresh;
  var out = [fresh[0]], rest = fresh.slice(1), used = {};
  used[fresh[0].pv[0]] = 1;
  for (var i = 1; i < 3; i++) {
    var prev = old[i] && old[i].pv[0], same = null;
    rest.forEach(function (l) { if (!same && l.pv[0] === prev && !used[prev]) same = l; });
    out[i] = same || null;
    if (same) used[prev] = 1;
  }
  rest.forEach(function (l) { if (used[l.pv[0]]) return; for (var j = 1; j < 3; j++) if (!out[j]) { out[j] = l; used[l.pv[0]] = 1; return; } });
  return out.filter(Boolean);
}
function xpAfterResult(a, ex, n) {
  var cur = xpCur(ex), parent = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  if (n === cur || n === parent) {
    if (pointerState.dragFrom >= 0) ex.dirty = true;
    else renderCard();
  }
  exploreAnalyse(false, true);
}
/* what to search next: the current position to 1M, and the position before
   it to 1M when the sentence still needs it. A new move stops everything but
   the parent's deep search; a step stops everything */
function exploreAnalyse(newMove, cont) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  var C = xpCur(ex), P = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  var pNeeds = !!(P && !xpSpoil(P) && !xpGameOver(P.st) && !(ex.res[P.key] && ex.res[P.key].step >= 2));
  if (!cont) {
    var keepKey = newMove && pNeeds ? P.key : null;
    engineStop(function (j) { return j.tag === 'explore' && !(keepKey && j.xp && j.xp.key === keepKey && j.xp.step === 2); });
  }
  var want = [];
  var cNeeds = !xpSpoil(C) && !xpGameOver(C.st) && !C.down;
  var cStep = ex.res[C.key] ? ex.res[C.key].step : 0;
  if (cNeeds && cStep < 1) want.push([C, 1]);
  if (pNeeds) want.push([P, 2]);
  if (cNeeds && cStep < 2) want.push([C, 2]);
  var busy = {};
  SF.queue.forEach(function (j) { if (j.tag === 'explore' && j.xp) busy[j.xp.key + '|' + j.xp.step] = 1; });
  SF.workers.forEach(function (sl) { var j = sl.pending && sl.pending[0]; if (j && j.tag === 'explore' && j.xp && !j.stopping) busy[j.xp.key + '|' + j.xp.step] = 1; });
  want.forEach(function (w) { if (!busy[w[0].key + '|' + w[1]]) xpRun(a, ex, w[0], w[1]); });
}

/* ── the sentence ────────────────────────────────────────────────────────── */
var XP_TACTIC = ['mateAllowed', 'forkAllowed', 'pinAllowed', 'discoveredAllowed', 'threat', 'badTrade', 'hung', 'promotion', 'material', 'missedMaterial', 'missedTactic', 'mateMissed'];
var XP_MISSED = ['missedMaterial', 'missedTactic', 'mateMissed'];
/* the score of a line for the side `w` (true = White), mates as +-1500 */
function sideCp(line, w) { return w ? line.cp : -line.cp; }
/* the material a line wins or gives up for the mover, in words, once it
   settles: "wins the rook", "gives up the exchange" */
function xpSameKind(p1, p2) { return p1 === p2 || ((p1 === 'N' || p1 === 'B') && (p2 === 'N' || p2 === 'B')); }
function xpMaterialWords(c, tier) {
  var g = c.gameLine;
  if (!g) return '';
  var up = Math.min(g.nodes.length - 1, c.gSettle != null ? c.gSettle : g.nodes.length - 1);
  /* a line that promotes is not counted in pieces */
  for (var pk = 0; pk <= up; pk++) if (g.nodes[pk] && g.nodes[pk].move && g.nodes[pk].move.promo) return '';
  /* the line stops with material still in motion: say nothing about it */
  if (up === g.nodes.length - 1 && enPrise(g.nodes[up].after)) return '';
  var mine = [], theirs = [];
  for (var i = 0; i <= up; i++) {
    var n = g.nodes[i];
    if (!n || !n.captured) continue;
    (n.pov ? theirs : mine).push(pType(n.captured));
    /* taken by a piece of the same kind that the mover takes back on that
       square a few moves later, with only quiet moves between: a trade */
    if (n.pov && xpSameKind(n.piece, pType(n.captured))) {
      for (var k = i + 1; k < g.nodes.length && k <= i + 4; k++) {
        var m2 = g.nodes[k];
        if (!m2 || !m2.move || m2.move.from === n.move.to) break;
        if (m2.move.to === n.move.to) { if (k > up && !m2.pov && m2.captured) mine.push(pType(m2.captured)); break; }
        if (m2.captured) break;
      }
    }
  }
  var cancel = function (cross) {
    for (var x = mine.length - 1; x >= 0; x--) {
      var j = theirs.indexOf(mine[x]);
      if (j === -1 && cross && (mine[x] === 'N' || mine[x] === 'B')) j = theirs.indexOf(mine[x] === 'N' ? 'B' : 'N');
      if (j !== -1) { mine.splice(x, 1); theirs.splice(j, 1); }
    }
  };
  cancel(false); cancel(true);
  var val = function (l) { return l.reduce(function (s, p) { return s + MOTIF_VAL[p]; }, 0); };
  var NUMW = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  var word = function (l) {
    var cnt = {};
    l.forEach(function (p) { cnt[p] = (cnt[p] || 0) + 1; });
    var ks = Object.keys(cnt).sort(function (p1, p2) { return MOTIF_VAL[p2] - MOTIF_VAL[p1]; });
    if (ks.length > 2) return null;
    return ks.map(function (p) { return cnt[p] === 1 ? 'a ' + PIECE_WORD[p] : (NUMW[cnt[p]] || cnt[p]) + ' ' + PIECE_WORD[p] + 's'; }).join(' and ');
  };
  var exch = function (a1, b1) { return a1.length === 1 && b1.length === 1 && a1[0] === 'R' && (b1[0] === 'N' || b1[0] === 'B'); };
  if (!mine.length && !theirs.length) return '';
  if (word(mine) === null || word(theirs) === null) return '';
  if (val(mine) > val(theirs)) {
    if (exch(mine, theirs)) return tier === 1 ? 'wins a rook for a ' + PIECE_WORD[theirs[0]] : 'wins the exchange';
    return theirs.length ? 'wins ' + word(mine) + ' for ' + word(theirs) : 'wins ' + (mine.length === 1 ? 'the ' + PIECE_WORD[mine[0]] : word(mine));
  }
  if (val(mine) < val(theirs)) {
    if (exch(theirs, mine)) return tier === 1 ? 'gives up a rook for a ' + PIECE_WORD[mine[0]] : 'gives up the exchange';
    return 'gives up ' + word(theirs) + (mine.length ? ' for ' + word(mine) : '');
  }
  return '';
}
/* the biggest piece the move loses once the line settles, and the moves
   that take it: exploring often meets a quiet first capture before the real
   loss ("Qxd5+ Kh8 Rxa4"), and the sentence must name the real loss */
/* the mover's pieces lost once the line settles: a piece taken straight back
   (the move before or after) by one of the same kind is a trade, not a
   loss; a line that promotes is not counted in pieces at all */
function xpLostPieces(c) {
  var g = c.gameLine;
  if (!g) return null;
  var up = Math.min(g.nodes.length - 1, c.gSettle != null ? c.gSettle : g.nodes.length - 1);
  var mine = [], lost = [];
  for (var i = 0; i <= up; i++) {
    var n0 = g.nodes[i];
    if (!n0) continue;
    if (n0.move && n0.move.promo) return null;
    if (!n0.captured) continue;
    (n0.pov ? lost : mine).push({ p: pType(n0.captured), at: i });
  }
  var same = function (a1, b1) { return a1 === b1 || ((a1 === 'N' || a1 === 'B') && (b1 === 'N' || b1 === 'B')); };
  mine.forEach(function (m) {
    var j = -1;
    lost.forEach(function (l, k) { if (j === -1 && Math.abs(l.at - m.at) === 1 && same(l.p, m.p)) j = k; });
    if (j !== -1) lost.splice(j, 1);
  });
  return lost;
}
function xpBigLoss(c) {
  var g = c.gameLine, lost = xpLostPieces(c), big = null;
  if (!g || !lost) return null;
  lost.forEach(function (l) { if (!big || MOTIF_VAL[l.p] > MOTIF_VAL[big.p]) big = l; });
  if (!big || MOTIF_VAL[big.p] < 5 || c.matGame > -3 || -c.matGame < MOTIF_VAL[big.p] - 1) return null;
  var sans = [];
  for (var k = 1; k <= big.at; k++) sans.push(sanOf(g.nodes[k].before, g.nodes[k].move));
  return { word: PIECE_WORD[big.p], line: sans.join(' ') };
}
/* was the reply already a threat before the move? (the other side to move,
   in the position before) */
function xpThreatBefore(P, reply) {
  if (!reply) return false;
  var st = cloneState(P.st);
  st.w = !st.w; st.ep = -1;
  var m = uciToMove(st, reply);
  if (!m) return false;
  var after = cloneState(st);
  applyMove(after, m);
  return !!(st.b[m.to] || checkedKingSq(after) != null);
}
function xpVerdict(a, ex, at) {
  if (ex.say[at]) return ex.say[at];
  var C = ex.nodes[at], P = ex.nodes[at - 1];
  if (!P || !C.mv) return null;
  var pr = ex.res[P.key], cr = ex.res[C.key];
  var over = xpGameOver(C.st);
  if (!over && (!pr || pr.step < 2 || !cr || cr.step < 2)) return null;
  if (!pr || pr.step < 2) return null;
  var tier = a.tier || 2, s = P.st.w, voice = C.mv.byYou ? 'you' : 'them';
  var best = pr.lines[0], X = C.mv.uci, B = sanOf(P.st, uciToMove(P.st, best.pv[0]));
  var row = pr.lines.filter(function (l) { return l.pv[0] === X; })[0];
  var cpBest = sideCp(best, s);
  /* the move's value: its row in the parent's search, or the child's own
     search; when both exist the worse of the two, so a move one search
     finds bad is never called "about as good" */
  var own = cr && cr.lines[0] ? sideCp(cr.lines[0], s) : null;
  var cpX = row ? sideCp(row, s) : (own != null ? own : (checkedKingSq(C.st) != null ? 1500 : 0));
  if (row && own != null && cpX - own >= 100) cpX = own;
  var wBest = winPct(cpBest), wX = winPct(cpX), drop = wBest - wX, gap = cpBest - cpX;
  var R = cr && cr.lines[0] ? cr.lines[0].pv : [];
  var mateOf = function (l, w) { return l && l.mate != null ? (w ? l.mate : -l.mate) : null; };
  var c = classifyMistake(P.st, X, { pv: best.pv, mate: mateOf(best, s) }, { pv: R, mate: cr && cr.lines[0] ? mateOf(cr.lines[0], s) : null },
    wBest, wX, C.mv.ply, voice);
  var text, cat, whose = voice === 'them' ? ' for ' + sideName(s) : '';
  if (X === best.pv[0]) {
    cat = 'best';
    var mw = xpMaterialWords(c, tier), mateIn = mateOf(best, s);
    /* the count the rows show: the child's own search, plus this move */
    var cm = cr && cr.lines[0] ? mateOf(cr.lines[0], s) : null;
    if (cm != null && mateIn != null && (cm > 0) === (mateIn > 0)) mateIn = cm > 0 ? cm + 1 : cm;
    text = fitLine([C.mv.san + ' is Stockfish\'s pick.' + (mateIn > 0 ? ' It mates in ' + mateIn + '.' : mateIn < 0 ? ' It allows mate in ' + (-mateIn) + '.' : (mw ? ' It ' + mw + '.' : '')),
      C.mv.san + ' is Stockfish\'s pick.']);
  } else {
    var decided = Math.abs(cpBest) >= 1000 && Math.abs(cpX) >= 1000 && (cpBest > 0) === (cpX > 0);
    var mateBoth = best.mate != null && ((row && row.mate != null) || !!(cr && cr.lines[0] && cr.lines[0].mate != null)) && (cpBest > 0) === (cpX > 0);
    var concrete = XP_TACTIC.indexOf(c.t) !== -1 && (c.t === 'mateMissed' || gap >= 100
      || (!mateBoth && ((c.mateAgainst && !c.alreadyLost) || (decided && c.lossG >= 3))));
    /* near 0% or 100% the winning-chance scale is flat: a real difference in
       material is still a difference, unless the game is decided either way */
    if (concrete || drop > STRONGER_TOL || (gap >= 100 && !decided)) {
      cat = concrete ? 'concrete' : 'worse';
      var reason = String(c.sentences.short || c.sentences.game).replace(/ \(\d+% to \d+%\)/g, '');
      var big = XP_MISSED.indexOf(c.t) === -1 && c.t !== 'mateAllowed' ? xpBigLoss(c) : null;
      if (big && reason.indexOf(big.word) === -1) reason = C.mv.san + ' loses the ' + big.word + ': ' + big.line + '.';
      var cmp;
      if (XP_MISSED.indexOf(c.t) !== -1 && c.sentences.best) {
        cmp = c.sentences.best;
        if (cmp.indexOf(B + ' ') === 0 && reason.indexOf(B) !== -1) cmp = 'It ' + cmp.slice(B.length + 1);
      } else {
        var stop = stopsWhat(c, P.st);
        if (stop && voice === 'them') stop = themVoice(stop, sideName(s), sideName(!s));
        cmp = stop && xpThreatBefore(P, R[0]) ? stop : (B + (wBest < 45 ? ' loses less.' : ' keeps more.'));
      }
      var lean = reason.replace(/ (You|White|Black) loses? [^.]*\.$/, '');
      text = fitLine([reason + ' ' + cmp, reason + ' Best was ' + B + '.', reason, lean + ' ' + cmp, lean + ' Best was ' + B + '.',
        firstClause(reason) + ' Best was ' + B + '.', firstClause(reason), C.mv.san + ' is worse' + whose + ' than ' + B + '.']);
    } else if (drop <= SOLVE_TOL) {
      cat = 'fine';
      text = C.mv.san + ' is about as good' + whose + ' as ' + B + '.';
    } else {
      cat = 'little';
      var rep = R[0] ? sanOf(C.st, uciToMove(C.st, R[0])) : '';
      text = fitLine([C.mv.san + ' is a little worse' + whose + ' than ' + B + '.' + (rep ? ' Best reply: ' + rep + ', the gold arrow.' : ''),
        C.mv.san + ' is a little worse' + whose + ' than ' + B + '.']);
    }
  }
  ex.say[at] = { text: text, cat: cat };
  track('explore_say_' + cat);
  return ex.say[at];
}
/* what the prompt line (phone) and the say line (desktop) show at a node:
   the same string, 80 characters at most */
function sayAt(a, ex, at) {
  var n = ex.nodes[at];
  if (ex.flash && !xpGameOver(n.st)) return ex.flash;
  if (xpGameOver(n.st)) {
    if (checkedKingSq(n.st) == null) return 'Stalemate. The game is a draw.';
    var winnerW = !n.st.w;
    return 'Checkmate. ' + (winnerW === myPov(a.it) ? 'You win.' : sideName(winnerW) + ' wins.');
  }
  if (xpSpoil(n)) return 'This is one of your own positions. Stockfish stays quiet so it can test you.';
  if (n.down) return 'Stockfish is not answering right now. Try again, or go back to the lesson.';
  var P = at > 0 ? ex.nodes[at - 1] : null;
  if (at === 0 || (P && xpSpoil(P))) {
    var r = { lines: xpShown(ex, n) || [] }, who = n.st.w === myPov(a.it) ? 'Your move.' : sideName(n.st.w) + ' to move.';
    if (!r.lines[0]) return who + ' Stockfish is thinking…';
    var pick = sanOf(n.st, uciToMove(n.st, r.lines[0].pv[0]));
    if (at === 0 && ex.ask && r.lines[0].pv[0] !== ex.ask.uci)
      return fitLine([who + ' Stockfish\'s pick is ' + pick + ', not ' + ex.ask.san + ', the gold arrow. › plays it.',
        who + ' Stockfish\'s pick is ' + pick + ', not ' + ex.ask.san + '. › plays it.']);
    return who + ' Stockfish\'s pick is ' + pick + ', the gold arrow. › plays it.';
  }
  if (n.mv && n.mv.pick) {
    /* walking Stockfish's line keeps the explanation of the move that started it */
    for (var i = at - 1; i >= 1; i--) {
      var sv = ex.say[i] || (ex.nodes[i].mv && !ex.nodes[i].mv.pick ? xpVerdict(a, ex, i) : null);
      if (sv && sv.cat !== 'best') return sv.text.replace(/ Best reply: [^,]+, the gold arrow\./, '');
      if (ex.nodes[i].mv && !ex.nodes[i].mv.pick) break;
    }
  }
  var v = xpVerdict(a, ex, at), sh = xpShown(ex, n), lv = ex.res[n.key];
  if (v && v.cat === 'little' && sh && sh[0] && lv && lv.lines[0] && sh[0].pv[0] !== lv.lines[0].pv[0])
    return v.text.replace(/ Best reply: [^,]+, the gold arrow\./, '');
  return v ? v.text : n.mv.san + '. Stockfish is thinking…';
}

/* what a screen reader hears: the move before a kept sentence, and only the
   move while Stockfish thinks */
function xpLive(a, ex, at) {
  var s = sayAt(a, ex, at), n = ex.nodes[at];
  if (/ Stockfish is thinking…$/.test(s)) return s.replace(/ Stockfish is thinking…$/, '');
  if (ex.flash || at === 0 || !n.mv || xpSpoil(n) || s.indexOf(n.mv.san + ' ') === 0) return s;
  return n.mv.san + (checkedKingSq(n.st) != null ? ', check. ' : '. ') + s;
}
/* ── the rows: Stockfish's three best moves at the position on screen ───── */
function xpNum(st, i) {
  /* move number of the i-th move from st: "20." before a white move, "20…" for black */
  var ply = xpPly(st) + i, full = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? full + '.' : full + '…';
}
function xpRowWords(a, n, line, best, tier) {
  var w = n.st.w, m0 = line.pv[0];
  var mateFor = line.mate != null ? (w ? line.mate : -line.mate) : null;
  if (mateFor != null && mateFor > 0) return 'mates in ' + mateFor;
  if (mateFor != null && mateFor < 0) return 'allows mate in ' + (-mateFor);
  var cpB = sideCp(best, w), cpL = sideCp(line, w), isBest = line === best || (winPct(cpB) - winPct(cpL) <= SOLVE_TOL && cpB - cpL < 100);
  var c = classifyMistake(n.st, m0, { pv: best.pv, mate: null }, { pv: line.pv.slice(1), mate: null }, winPct(cpB), winPct(cpL), xpPly(n.st));
  if (isBest) {
    var mw = xpMaterialWords(c, tier);
    if (mw) return mw;
  } else {
    var g = c.gameLine, r1 = g && g.nodes[1], rSan = r1 && r1.move ? sanOf(r1.before, r1.move) : '';
    if (c.t === 'forkAllowed' && c.allowed.fork) { var fm = g.nodes[c.allowed.fork.ply]; return 'allows a fork: ' + sanOf(fm.before, fm.move); }
    if (c.t === 'pinAllowed') return 'walks into a pin';
    if (c.t === 'discoveredAllowed') return 'allows a hidden attack';
    if (c.t === 'mateAllowed') return 'allows mate in ' + (c.mateAgainst || 2);
    if (['threat', 'hung', 'badTrade', 'material'].indexOf(c.t) !== -1 && r1 && r1.captured && c.matGame <= -1) {
      /* only when that piece stays lost once the line settles */
      var L = xpLostPieces(c) || [], p1 = pType(r1.captured);
      if (L.some(function (l) { return l.p === p1; })) return 'loses the ' + PIECE_WORD[p1] + ' to ' + rSan;
    }
    if (XP_MISSED.indexOf(c.t) !== -1) { var bs = sanOf(n.st, uciToMove(n.st, best.pv[0])); return 'misses ' + bs; }
  }
  return standingWords(winPct(myPov(a.it) ? line.cp : -line.cp));
}
function xpRows(a, ex) {
  var n = xpCur(ex), shown = xpShown(ex, n);
  if (!shown || !shown.length || xpSpoil(n) || xpGameOver(n.st)) return null;
  var tier = a.tier || 2, me = myPov(a.it), touch = window.innerWidth <= 860;
  var lines = shown.slice(0, 3), idx = [0, 1, 2].filter(function (i) { return lines[i]; }), ws = null;
  if (tier === 1) {
    /* two rows: the best, and the line that teaches something different,
       a tactic before a plain standing, never the same words twice */
    ws = lines.map(function (l) { return xpRowWords(a, n, l, lines[0], 1); });
    var tac = /^(allows a fork|walks into a pin|allows a hidden attack|allows mate|loses the|misses )/;
    var two = [1, 2].filter(function (i) { return lines[i] && tac.test(ws[i]); })[0];
    if (two == null) two = lines[1] ? 1 : -1;
    if (two > 0 && ws[two] === ws[0]) {
      var alt = [1, 2].filter(function (i) { return lines[i] && i !== two && ws[i] !== ws[0]; })[0];
      if (alt != null) two = alt;
    }
    idx = two > 0 ? [0, two] : [0];
  }
  return idx.map(function (li) {
    var l = lines[li];
    var sans = playUci(n.st, l.pv.slice(0, 8)).san;
    var first = sans[0] || l.pv[0];
    var row = { uci: l.pv[0], first: first, num: xpNum(n.st, 0), li: li };
    if (tier === 1) {
      row.words = ws[li];
      row.label = first + ', ' + row.words + '.';
      return row;
    }
    var myMate = l.mate != null ? (me ? l.mate : -l.mate) : null;
    row.chip = myMate != null ? (myMate > 0 ? 'You mate in ' + myMate : 'They mate in ' + (-myMate))
      : 'You ' + Math.max(1, Math.min(99, Math.round(winPct(me ? l.cp : -l.cp)))) + '%';
    var plies = tier === 3 ? (touch ? 4 : 6) : 2, cont = [];
    for (var k = 1; k <= plies && k < sans.length; k++) cont.push(((xpPly(n.st) + k) % 2 === 0 ? xpNum(n.st, k) : '') + sans[k]);
    row.cont = cont.join(' ');
    row.label = first + (cont.length ? ', then ' + sans.slice(1, plies + 1).join(' ') : '') + '. ' + (myMate != null ? row.chip + '.' : 'Your winning chances ' + row.chip.replace('You ', '') + '.');
    return row;
  });
}
