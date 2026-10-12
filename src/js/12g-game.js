/* ── Game-mode reviews (F8.1 to F8.3) ───────────────────────────────────────
   At tiers 2 and 3 a review opens like the game: no red arrow, no "than
   Rg1", row 1 "Your move", row 2 the move and the clock the player had when
   the position arose ("Move 35 · 20:35 on your clock"; with no clocks "Move
   35 vs opponent1"), the neutral "Review" tag. A review is in game mode from
   the first one after a clean first-try find: its record has a run of clean
   finds (streak). First sight, every tier-1 card, "One more try" and a card
   last shown or missed (either ends the run) open cued. The game move shows
   after the first graded try or the answer, as its faded piece. "Learned"
   at tiers 2 and 3 needs the final 16-day find clean in game mode and under
   30 s (60 s at tier 3): srsRecord.
   Foils (F8.2): one game-mode position in four has nothing wrong, from the
   player's own games: a move of theirs that lost under 3 points, from move
   9 on, in a position still in play (15 to 85%), the nearest a mistake that
   follows in the same game first. Row 2 says the clock when the position
   arose, so in a game with clocks a foil comes only from a position whose
   clock is known (two plies after a stored mistake: what the player had
   left after that move); in a game with none, from any position. A foil and
   a mistake read alike. Before it opens, the game move is searched again
   (250,000 nodes, three lines, and when those miss it the game move and the
   best side by side): a foil whose move lost 3 points or more there is set
   aside for good. A foil is never scheduled (nothing in nl:srs), never
   shown twice in 7 days, and logged (mode 'foil').
   nl:foil:<player>: { s: {key: time shown} (a month of them), acc (the
   share of a foil carried to the next set), x: {key: 1} set aside } */
var FOIL_FROM = 16, FOIL_LOSS = 3, FOIL_GOOD = 4, FOIL_DAYS = 7, FOIL_NEAR = 8;
/* a review at tier `tier` opens in game mode: its record has a run of clean
   finds (a first sight, a position back from the queue and a run a miss or
   a shown answer ended open cued) */
function gameModeRec(rec, tier) { return tier >= 2 && !!rec && !rec.q && !rec.hidden && (rec.streak || 0) > 0; }
/* the game move is on the board of a game-mode card (its faded piece, F8.1):
   after the first graded try (a miss, the game move again or a good move
   that is not the best) or the answer shown; a foil's only when it ends,
   since its game move is a fine answer */
function ghostOn(a) { return !!a.game && !a.foil && (a.misses > 0 || !!a.foundGood || !!a.revealed); }

/* ── foils ── */
function isFoilKey(k) { return /^foil:/.test(String(k || '')); }
function foilKeyOf(g, q) { return 'foil:' + g.id + ':' + q; }
function foilStoreKey() { return 'nl:foil:' + playerId(); }
function foilStore() {
  var s = store.get(foilStoreKey(), null);
  s = s && typeof s === 'object' ? s : {};
  return { s: s.s || {}, x: s.x || {}, acc: +s.acc || 0 };
}
function foilSave(s) {
  var now = Date.now();
  Object.keys(s.s).forEach(function (k) { if (now - s.s[k] > 30 * DAY) delete s.s[k]; });
  store.set(foilStoreKey(), s);
}
/* shown now: not again for 7 days */
function foilShown(key) { var s = foilStore(); s.s[key] = Date.now(); foilSave(s); }
/* the clock the player had when the position at ply q arose: what they
   had left after their move two plies before, where a stored entry of the
   game keeps it (seconds); null when the game keeps no clock there */
function clockKnownAt(g, q) {
  var b = (g.bl || []).filter(function (x) { return x.p === q - 2 && x.c != null; })[0];
  return b ? b.c : null;
}
/* the foils the player's games hold: [{key, g, q, clock, rank}], three a
   game at most, the nearest a mistake that follows first (rank: 2 within 8
   plies, 1 within 16; one more when their last move took nothing and gave
   no check). Read once per set of games */
var foilMemo = { k: null, list: [] };
function foilPool() {
  var mk = data.games.length + '|' + (data.games[0] ? data.games[0].id : '') + '|' + trackedPerfs().join(',') + '|' + String(cfg.user);
  if (foilMemo.k === mk) return foilMemo.list;
  var out = [];
  data.games.forEach(function (g) {
    if (!g.mv || !g.wp || g.syn || !inScope(g)) return;
    var mine = g.color === 'white' ? 0 : 1, toks = g.mv.split(' '), bl = g.bl || [], known = {}, taken = {}, marks = [];
    var clocked = bl.some(function (b) { return b.c != null; });
    bl.forEach(function (b) { taken[b.p] = 1; if (b.c != null) known[b.p + 2] = b.c; if (!b.x) marks.push(b.p); });
    var st = chessStart(), n = Math.min(toks.length, g.wp.length), per = [];
    for (var q = 0; q < n; q++) {
      if (q >= FOIL_FROM && q % 2 === mine && !taken[q] && (!clocked || known[q] != null)) {
        var wb = wpAt(g, q - 1), wa = wpAt(g, q);
        if (wb != null && wa != null && wb - wa < FOIL_LOSS && wb >= 15 && wb <= 85 && legalMoves(st).length >= 3) {
          var gap = marks.filter(function (p) { return p > q; }).map(function (p) { return p - q; })[0] || 99;
          var quiet = toks[q - 1].indexOf('x') < 0 && !checkersOf(st).length;
          per.push({ key: foilKeyOf(g, q), g: g, q: q, clock: clocked ? known[q] : null, rank: (gap <= FOIL_NEAR ? 2 : gap <= 2 * FOIL_NEAR ? 1 : 0) + (quiet ? 1 : 0) });
        }
      }
      if (!sanApply(st, toks[q])) break;
    }
    per.sort(function (x, y) { return y.rank - x.rank || x.q - y.q; });
    out = out.concat(per.slice(0, 3));
  });
  foilMemo = { k: mk, list: out };
  return out;
}
/* a set's foils (F8.2), in Today's set and an extra set at tiers 2 and 3
   while the engine is up: one game-mode position in four (the share left
   over carried to the next set), each from another game than every other
   position of the set, never one shown in the last 7 days. They take the
   places of the least valuable game-mode reviews (which stay due), spread
   among the game-mode places, never the first; the set keeps its size */
function withFoils(keys, mode) {
  if ((mode !== 'today' && mode !== 'more') || SF.state === 'failed') return keys;
  var srs = srsLoad(), tier = playerTier(), slots = [];
  keys.forEach(function (k, i) { if (gameModeRec(srs[k], tier)) slots.push(i); });
  if (!slots.length) return keys;
  var st = foilStore(), share = slots.length / 4 + st.acc, want = Math.floor(share + 1e-9), now = Date.now(), day = dayStamp();
  st.acc = Math.round((share - want) * 1000) / 1000;
  var h = function (s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x >>> 0; };
  var games = {};
  keys.forEach(function (k) { games[String(k).split(':')[0]] = 1; });
  var take = [];
  foilPool().filter(function (f) { return !st.x[f.key] && !(st.s[f.key] && now - st.s[f.key] < FOIL_DAYS * DAY); })
    .sort(function (x, y) { return y.rank - x.rank || h(x.key + day) - h(y.key + day); })
    .forEach(function (f) { if (take.length < want && !games[f.g.id]) { games[f.g.id] = 1; take.push(f); } });
  foilSave(st);
  if (!take.length) return keys;
  var n = take.length, out = keys.slice(), keep = slots.map(function (i) { return keys[i]; }).slice(0, slots.length - n), at = [];
  for (var j = 0; j < n; j++) at.push(Math.floor((j + 1) * slots.length / (n + 1)));
  var ki = 0, fi = 0;
  slots.forEach(function (pos, s) { out[pos] = at.indexOf(s) >= 0 ? take[fi++].key : keep[ki++]; });
  return out;
}
/* a foil as the card reads it: {g, b, key, foil}, b made here and never
   stored with the games: p, wb and wa from the game's series, fc the clock
   when it arose; once looked at (foilLook) the best move and its line (bu,
   lu, eb, mb), the game move's score and the line after it (ea, ma, ru),
   what the game move lost (fl, points) and ok; x when set aside */
var foilItems = {};
function foilItem(key) {
  if (foilItems[key]) return foilItems[key];
  var m = /^foil:(.+):(\d+)$/.exec(String(key || '')), g = m ? data.games.filter(function (x) { return x.id === m[1]; })[0] : null;
  if (!g || !g.mv) return null;
  var q = +m[2], b = { p: q, wb: wpAt(g, q - 1), wa: wpAt(g, q), fc: clockKnownAt(g, q) };
  if (foilStore().x[key]) b.x = 'foil';
  foilItems[key] = { g: g, b: b, key: key, foil: true };
  return foilItems[key];
}
/* a session's position by its key: a foil, a practice position or a
   lesson (F9.3, F9.4: 12q-practice.js), or a mistake of the model */
function itemOf(key) { return isFoilKey(key) ? foilItem(key) : isPracKey(key) ? pracItem(key) : isLessonKey(key) ? lessonItem(key) : (key ? model().byKey[key] || null : null); }
function foilReady(it) { return !!(it && it.foil && it.b.ok); }
/* a foil as its opening frame draws it before its look: the game move
   stands in for the best move, which no frame shows before the answer (on
   Today, Resume's board when the set stopped at a foil after a reload) */
function foilFace(it) {
  if (!it || !it.foil || it.b.bu) return it;
  var gu = uciOfSan(it.g.mv, it.b.p);
  return gu ? { g: it.g, key: it.key, foil: true, b: Object.assign({}, it.b, { bu: gu, lu: packUci([gu]), ru: '' }) } : it;
}
/* set aside for good: its game move lost too much on a deeper look */
function foilSetAside(it) {
  it.b.x = 'foil';
  var s = foilStore();
  s.x[it.key] = 1;
  foilSave(s);
}
/* the foil's deeper look, in the loading frame (prio) or ahead of it: its
   best move and line, and the game move's score from the same search, or
   from a second one that scores the two side by side. Resolves with the
   item; a search that failed or was stopped leaves it unread (no foil this
   time), a game move that lost 3 points or more sets it aside */
var foilPending = {};
function foilLook(it, prio) {
  var b = it.b, g = it.g, key = it.key, myGen = gen;
  if (b.ok || b.x) return Promise.resolve(it);
  if (foilPending[key]) { if (prio) promoteTag(key); return foilPending[key]; }
  var pre = stateAtPly(g.mv, b.p), gu = pre ? uciOfSan(g.mv, b.p) : null, sign = g.color === 'white' ? 1 : -1;
  if (!gu || SF.state === 'failed') return Promise.resolve(it);
  var fen = stateFen(pre), lineOf = function (r, u) { return (r && r.lines || []).filter(function (l) { return l && l.pv && l.pv[0] === u; })[0] || null; };
  var ev = function (o) { return engineEval(fen, { nodes: DEEP_NODES }, !!prio, o).then(function (r) { if (!r || r.stopped) throw { stopped: true }; return r; }); };
  var p = ev({ multipv: 3, tag: key }).then(function (r1) {
    var best = r1.bestUci, bl = lineOf(r1, best) || { cp: r1.cp, mate: r1.mate, pv: r1.pv && r1.pv.length ? r1.pv : [best] }, gl = best === gu ? bl : lineOf(r1, gu);
    if (!best) throw { none: true };
    if (gl) return { best: best, bl: bl, gl: gl, r1: r1 };
    return ev({ searchmoves: [gu, best], multipv: 2, tag: key }).then(function (r2) { return { best: best, bl: lineOf(r2, best) || bl, gl: lineOf(r2, gu), r1: r1 }; });
  }).then(function (x) {
    if (stale(myGen) || b.ok || b.x || !x.gl) return;
    var wBest = winPct(sign * x.bl.cp), wGame = winPct(sign * x.gl.cp);
    if (wGame > wBest) wBest = wGame;
    if (!(wBest - wGame < FOIL_LOSS)) { foilSetAside(it); return; }
    /* V2.6: the only move, when the game move is the best and the search's
       next line is 10 or more points worse */
    var second = (x.r1.lines || []).filter(function (l) { return l && l.pv && l.pv[0] && l.pv[0] !== x.best; })[0];
    var om = x.best === gu && second && wBest - winPct(sign * second.cp) >= 10 ? 1 : 0;
    var fields = { bu: x.best, lu: packUci(x.bl.pv), eb: sign * x.bl.cp, mb: x.bl.mate != null ? sign * x.bl.mate : null,
                   ea: sign * x.gl.cp, ma: x.gl.mate != null ? sign * x.gl.mate : null, ru: packUci((x.gl.pv || []).slice(1, 9)),
                   wb: wBest, wa: wGame, fl: Math.round((wBest - wGame) * 10) / 10, om: om };
    /* V2.6: their threat, from a null-move search (them to move): a mate,
       a capture by what it nets, a quiet move only when a search of its own
       confirms what it wins where its line settles; [uci, mate, gain, the
       piece it wins] */
    Object.keys(fields).forEach(function (f) { b[f] = fields[f]; });
    b.ok = 1;
    /* the threat comes after, never holding the card: Hint 2 reads it once
       it is in (until then the board's own attacks) */
    it.thP = foilThreat(pre, sign > 0, false, key).then(function (th) { if (!stale(myGen) && th !== undefined) b.th = th; });
  });
  foilPending[key] = p.then(function () { delete foilPending[key]; return it; }, function () { delete foilPending[key]; return it; });
  return foilPending[key];
}
/* a foil's threat (V2.6): the null-move position searched (two lines,
   250,000 nodes), read by the fact sheet's rule (factsThreats); a quiet
   move kept only when a search from after it confirms what it wins where
   its line settles. Resolves with [uci, mate, gain, piece won] or null (none,
   or the player in check); undefined when no search could run */
function foilThreat(pre, pov, prio, key) {
  if (checkersOf(pre).length) return Promise.resolve(null);
  var nst = dzNullState(pre), fen = stateFen(nst);
  var settleWins = function (ucis) {
    var s = settleLine(nst, ucis), lost = lineNodes(nst, ucis.slice(0, s.k)).filter(function (x) { return x.cap && colorW(x.cap) === pov; }).map(function (x) { return pType(x.cap); });
    var won = lineNodes(nst, ucis.slice(0, s.k)).filter(function (x) { return x.cap && colorW(x.cap) !== pov; }).map(function (x) { return pType(x.cap); });
    won.forEach(function (w) { var j = lost.indexOf(w); if (j >= 0) lost.splice(j, 1); });
    lost.sort(function (x, y) { return MOTIF_VAL[y] - MOTIF_VAL[x]; });
    return { gain: pov ? s.w - s.b : s.b - s.w, wins: lost[0] || null };
  };
  return engineEval(fen, { nodes: DEEP_NODES }, prio, { multipv: 2, tag: key }).then(function (r) {
    if (!r || r.stopped) return undefined;
    var lines = r.lines && r.lines.length ? r.lines : [{ cp: r.cp, mate: r.mate, pv: r.pv || [] }];
    var c = factsThreats(pre, lines, pov, true)[0];
    if (!c) return null;
    var m = uciToMove(nst, c.u);
    if (!m) return null;
    if (c.mate) return [c.u, c.mate, 0, null];
    /* a capture is a threat only where its line nets them something (V1.5)
       and the exchange on its square pays (a 250,000-node line can miss
       the answer to it: foil:184359604942:26's Bxb2) */
    if (nst.b[m.to] && !(c.gain >= 1 && dzSeeMove(nst.b, m.from, m.to) > 0)) return null;
    /* every threat but a mate confirmed by a search of its own from after
       it (V1.5's quiet threats; a capture too, since a 250,000-node line can
       miss the answer to it: foil:184359604942:26's Bxb2 runs into Nc7+) */
    var after = cloneState(nst);
    applyMove(after, m);
    if (!legalMoves(after).length) return null;
    return engineEval(stateFen(after), { nodes: DEEP_NODES }, prio, { tag: key }).then(function (r2) {
      if (!r2 || r2.stopped) return null;
      var sw = settleWins([c.u].concat(r2.pv || []));
      /* the gain is theirs: the player's loss, the piece it wins */
      return -sw.gain >= 1 && sw.wins ? [c.u, 0, -sw.gain, sw.wins] : null;
    }, function () { return null; });
  }, function () { return undefined; });
}
/* the danger on a foil's board, for its Hint 2 (F8.1, V2.6): the check;
   their mate in one were it their move; their threat from the foil's look
   (a capture, or a quiet move that wins a piece); the only move when its
   search's next line is 10 points worse ("Only one move holds here."); the
   player's pieces taking would win for them (dangerAttacked) where no
   search ran; none: "Any good move passes here." No mark on the answer's
   to-square nor on the game move's (a fine answer too). {kind, rings,
   arrows, ...} */
function foilDanger(a) {
  var st = a.pre, pov = myPov(a.it), due = a.best, gm = a.played, b = a.it.b;
  var skip = function (f, t) { return f === due.to || t === due.to || f === gm.to || t === gm.to; };
  if (checkersOf(st).length) return { kind: 'check', rings: [], arrows: [] };
  var nst = dzNullState(st), mate = legalMoves(nst).filter(function (m) { var x = cloneState(nst); applyMove(x, m); return isMate(x); })[0];
  if (mate) return { kind: 'mate', mate: { from: mate.from, to: mate.to, san: capSan(nst, mate) },
                     rings: skip(mate.to, mate.to) ? [] : [{ sq: mate.to, kind: 'attacked', mate: true }], arrows: skip(mate.from, mate.to) ? [] : [{ from: mate.from, to: mate.to, kind: 'threat', key: 'danger' }] };
  var th = b.th, tm = th ? uciToMove(nst, th[0]) : null;
  if (tm) {
    var tt = { st: nst, m: tm, took: nst.b[tm.to] || null, mate: th[1] || 0, gain: th[2], wins: nst.b[tm.to] ? null : th[3] };
    return { kind: 'threat', t: tt, rings: [], arrows: skip(tm.from, tm.to) ? [] : [{ from: tm.from, to: tm.to, kind: 'threat', key: 'danger' }] };
  }
  if (b.om) return { kind: 'only', rings: [], arrows: [] };
  if (th === undefined) {
    var pk = dangerPick(dangerAttacked(st, pov).map(function (x) { return { sq: x[0], p: st.b[x[0]], by: x.slice(1) }; }), [], skip);
    if (pk) return { kind: 'attacked', named: pk.named, second: pk.second, rings: pk.rings, arrows: pk.arrows.map(function (x) { return { from: x.from, to: x.to, kind: 'threat', key: 'danger' }; }) };
  }
  return { kind: 'none', rings: [], arrows: [] };
}
