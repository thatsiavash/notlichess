/* ── The mistakes model ─────────────────────────────────────────────────────
   A mistake is one entry of g.bl: a move of yours that dropped your winning
   chances by 20 points or more. Everything the trainer and the insights
   show is computed here from the game records, once per data change. */

          /* win-chance points; lichess's own blunder line is 15 */
var LEGACY_PATTERN = { hung: 'hung', tactic: 'missedTactic', slip: 'slipped', collapse: 'drift' };

function mKey(g, b) { return g.id + ':' + b.p; }
function patternOf(b) { return b.t || LEGACY_PATTERN[b.k] || 'drift'; }
function patternInfo(key) { return PATTERN[key] || PATTERN.drift; }
function covered(g) { return !!(g.analysed || g.scanned || g.bl); }

/* one cache for everything derived from the games; invalidated by any
   change to games, enrichment or SRS through modelDirty() */
var modelCache = { token: null };
var modelRev = 0;
function modelDirty() { modelRev++; }
function modelToken() {
  return data.games.length + '|' + (data.games[0] ? data.games[0].id : '') + '|' + modelRev + '|' + String(cfg.user);
}
function model() {
  var tok = modelToken();
  if (modelCache.token === tok) return modelCache.m;
  var items = [], byKey = {}, dirtyGames = false;
  data.games.forEach(function (g) {
    if (!g.bl || !g.mv) return;
    migrateGame(g);
    markDecisive(g);
    g.bl.forEach(function (b) {
      if (!b.x && b.bu && (b.cv || 1) < CLASSIFY_V) { classifyEntry(b, g.mv); dirtyGames = true; }
      if (b.x) return;                  /* refuted, disputed, or the game move itself */
      if (b.sc && !b.d) return;         /* a time-scramble premove that decided nothing */
      var it = { g: g, b: b, key: mKey(g, b) };
      items.push(it);
      byKey[it.key] = it;
    });
  });
  modelCache = { token: tok, m: { items: items, byKey: byKey } };
  if (dirtyGames) scheduleSave();
  return modelCache.m;
}
function allMistakes() { return model().items; }
/* the stored cache's bookkeeping with the games already in memory: work
   done since the page loaded (scans, deeper looks, disputes) is not
   replaced by an older copy from storage */
function liveCache() {
  var c = loadCachedGames();
  if (!data.games.length) return c;
  return { games: data.games, ts: c.games.length ? c.ts : 0, perfs: c.perfs, hd: c.hd, fetchedAt: c.fetchedAt };
}
function trainable(it) { return !!(it.g.mv && it.b.bu && !it.b.x); }

/* records written before the rebuild: answers in a rough shorthand, no
   refutation, an old label. Converted once, with no engine time: the
   shorthand is matched against the legal moves, the game's own
   continuation stands in for the refutation until the card's deeper look */
function roughToMove(st, tok) {
  if (!tok) return null;
  tok = String(tok).replace(/[+#?!]+$/, '');
  if (tok === 'O-O' || tok === 'O-O-O') return legalMoves(st).filter(function (m) { return m.castle === tok; })[0] || null;
  var promo = /=([QRBN])/.exec(tok);
  var body = tok.replace(/=[QRBN]/, '').replace('x', '');
  var dest = body.slice(-2), piece = /^[NBRQK]/.test(body) ? body[0] : 'P';
  if (!/^[a-h][1-8]$/.test(dest)) return null;
  var to = (dest.charCodeAt(1) - 49) * 8 + (dest.charCodeAt(0) - 97);
  var fromFile = piece === 'P' && body.length === 3 ? body.charCodeAt(0) - 97 : -1;
  var hits = legalMoves(st).filter(function (m) {
    var p = st.b[m.from];
    return m.to === to && p && p.toUpperCase() === piece && (!promo || m.promo === promo[1])
      && (fromFile < 0 || m.from % 8 === fromFile) && (!m.promo || !promo || m.promo === promo[1]);
  });
  if (hits.length > 1 && !promo) hits = hits.filter(function (m) { return !m.promo || m.promo === 'Q'; });
  return hits.length === 1 ? hits[0] : null;
}
function migrateGame(g) {
  if (g.mig === 2) return;
  g.bl.forEach(function (b) {
    if (b.bu || b.x) return;
    var pre = stateAtPly(g.mv, b.p);
    if (!pre) { b.x = 'moves'; return; }
    var first = b.j === 'scan' ? roughToMove(pre, b.bs) : (function () {
      var probe = cloneState(pre), m = sanApply(probe, b.bs || '');
      return m ? legalMoves(pre).filter(function (x) { return x.from === m.from && x.to === m.to; })[0] : null;
    })();
    if (!first) { b.x = 'moves'; return; }
    b.bu = moveUci(first);
    var st = cloneState(pre), lu = [];
    var toks = String(b.bv || '').split(' ').filter(Boolean);
    for (var i = 0; i < toks.length && lu.length < 8; i++) {
      var mv = i === 0 ? first : (b.j === 'scan' ? roughToMove(st, toks[i]) : (function (tk) {
        var probe = cloneState(st), m = sanApply(probe, tk);
        return m ? legalMoves(st).filter(function (x) { return x.from === m.from && x.to === m.to; })[0] : null;
      })(toks[i]));
      if (!mv) break;
      lu.push(moveUci(mv));
      applyMove(st, mv);
    }
    b.lu = packUci(lu.length ? lu : [b.bu]);
    b.ru = packUci(gameContinuationPlain(g.mv, pre, b.p));
    b.j = b.j === 'scan' ? 's' : 'l';
    delete b.bs; delete b.bv; delete b.k; delete b.loc; delete b.rf;
    classifyEntry(b, g.mv);
  });
  g.mig = 2;
}
/* the real moves that followed a ply, as UCI */
function gameContinuationPlain(moves, pre, p) {
  var toks = moves.split(' '), st = cloneState(pre), out = [];
  for (var k = p; k < Math.min(toks.length, p + 7); k++) {
    var probe = cloneState(st), m = sanApply(probe, toks[k]);
    if (!m) break;
    var mv = legalMoves(st).filter(function (x) { return x.from === m.from && x.to === m.to; })[0];
    if (!mv) break;
    if (k > p) out.push(moveUci(mv));
    applyMove(st, mv);
  }
  return out;
}

/* ── decisive mistakes ──────────────────────────────────────────────────
   The move that decided a game. With the stored win-chance series (g.wp,
   one character per ply, White's view) the rule is exact: in a loss, the
   first mistake from 40%+ after which you never get back to 40%; in a draw
   or loss from a won game, a drop from 70%+ to under 60% that never
   recovers to 70%. Without the series (older records) the last such
   crossing among your mistakes stands in. */
function wpAt(g, ply) {
  if (!g.wp || ply < 0 || ply >= g.wp.length) return null;
  var ch = g.wp.charAt(ply);
  if (ch === '.') return null;
  var code = g.wp.charCodeAt(ply);
  var legacy = code >= 48 && code <= 111 && /[:;<=>?@\[\]^`]/.test(g.wp);
  var w = (legacy ? code - 48 : WP_ABC.indexOf(ch)) / 0.63;
  return g.color === 'white' ? w : 100 - w;
}
/* every mistake of mine in a game, counted from the win-chance series when
   there is one (the stored cards are capped; the rates must not be) */
function gameMistakeCount(g) {
  if (!g.wp) return g.bl ? g.bl.filter(function (b) { return !b.x; }).length : 0;
  var min = mistakeMinFor(g), n = 0, prev = null;
  var mine = g.color === 'white' ? 0 : 1;
  for (var i = 0; i < g.wp.length; i++) {
    var w = wpAt(g, i);
    if (w == null) { prev = null; continue; }
    if (i % 2 === mine && prev != null && prev - w >= min) n++;
    prev = w;
  }
  return n;
}
function maxAfter(g, ply) {
  var m = -1;
  for (var i = ply + 1; i < (g.wp ? g.wp.length : 0); i++) {
    var v = wpAt(g, i);
    if (v != null && v > m) m = v;
  }
  return m;
}
function markDecisive(g) {
  if (!g.bl) return;
  g.bl.forEach(function (b) { b.d = 0; });
  if (g.res === 'win') return;
  var mine = g.bl.filter(function (b) { return !b.x; }).sort(function (a, b) { return a.p - b.p; });
  var pick = null, w = 0;
  if (g.wp && g.wp.length > 20) {
    for (var i = 0; i < mine.length && !pick; i++) {
      var b = mine[i];
      if (g.res === 'loss' && b.wb >= 40 && b.wa < 40 && maxAfter(g, b.p) < 40) { pick = b; w = 1; }
    }
    if (!pick) for (var j = 0; j < mine.length && !pick; j++) {
      var c = mine[j];
      if (c.wb >= 70 && c.wa < 60 && maxAfter(g, c.p) < 70) { pick = c; w = g.res === 'loss' ? 1 : 0.5; }
    }
  } else {
    for (var k = mine.length - 1; k >= 0 && !pick; k--) {
      var d = mine[k];
      if (g.res === 'loss' && d.wb >= 40 && d.wa < 40) { pick = d; w = 1; }
    }
    if (!pick) for (var q = mine.length - 1; q >= 0 && !pick; q--) {
      var e = mine[q];
      if (e.wb >= 70 && e.wa < 60) { pick = e; w = g.res === 'loss' ? 1 : 0.5; }
    }
  }
  if (pick) pick.d = w;
}

/* ── lenses: where a mistake happened ────────────────────────────────────── */
function tcInitialSecs(tc) {
  if (!tc) return null;
  var mins = parseFloat(String(tc).split('+')[0]);
  return isFinite(mins) && mins > 0 ? mins * 60 : null;
}
function timeTrouble(it) {
  var c = it.b.c, init = tcInitialSecs(it.g.tc);
  if (c == null || !init) return false;
  return c < Math.max(20, 0.1 * init);
}
function openingFamily(g) {
  return g.opening ? String(g.opening).split(':')[0].trim() : null;
}

/* ── patterns: counts, cost, progress, trend ─────────────────────────────── */
function patternStats() {
  var m = model();
  if (m.patterns && m.patternsSrs === srsRevision) return m.patterns;
  var srs = srsLoad(), now = Date.now(), by = {};
  m.items.forEach(function (it) {
    if (!trainable(it)) return;
    var k = patternOf(it.b);
    var s = by[k] || (by[k] = { key: k, count: 0, cost: 0, pts: 0, fixed: 0, practising: 0, due: 0, fresh: 0,
                                 recent: 0, older: 0, items: [] });
    s.count++;
    s.cost += it.b.d || 0;
    s.pts += Math.max(0, it.b.wb - it.b.wa) / 100;
    s.items.push(it);
    var rec = srs[it.key];
    if (!rec) s.fresh++;
    else if (isLearned(rec)) s.fixed++;
    else { s.practising++; if (rec.due == null || rec.due <= now) s.due++; }
    var age = (now - it.g.ts) / 864e5;
    if (age <= 30) s.recent++; else if (age <= 60) s.older++;
  });
  /* rate trend per game over covered games, this month vs last */
  var gNow = 0, gPrev = 0;
  data.games.forEach(function (g) {
    if (!covered(g)) return;
    var age = (now - g.ts) / 864e5;
    if (age <= 30) gNow++; else if (age <= 60) gPrev++;
  });
  var list = Object.keys(by).map(function (k) {
    var s = by[k];
    s.info = patternInfo(k);
    s.rateNow = gNow >= 15 ? s.recent / gNow : null;
    s.ratePrev = gPrev >= 15 ? s.older / gPrev : null;
    return s;
  });
  list.sort(function (a, b) { return b.cost - a.cost || b.pts - a.pts || b.count - a.count; });
  m.patterns = list;
  m.patternsSrs = srsRevision;
  return list;
}
function coverage() {
  var n = 0, c = 0, lost = 0, decided = 0;
  data.games.forEach(function (g) {
    n++;
    if (!covered(g)) return;
    c++;
    if (g.res === 'loss') {
      lost++;
      if (g.bl && g.bl.some(function (b) { return b.d === 1; })) decided++;
    }
  });
  return { total: n, covered: c, losses: lost, decided: decided };
}

