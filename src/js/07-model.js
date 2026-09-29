/* ── The mistakes model ─────────────────────────────────────────────────────
   A mistake is one entry of g.bl: a move of yours that dropped your winning
   chances by 20 points or more. Everything the trainer and the insights
   show is computed here from the game records, once per data change. */

          /* win-chance points; lichess's own blunder line is 15 */

function mKey(g, b) { return g.id + ':' + b.p; }
function patternOf(b) { return b.t || 'drift'; }
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
/* the formats being trained: a change in Settings takes effect at once,
   while other formats' games stay stored for switching back */
/* one window for every number: the last 12 months of the tracked format,
   and at least its latest 150 games (the player as they are now) */
var windowMemo = { key: '', cut: {} };
function windowCut(perf) {
  var key = data.games.length + '|' + (data.games.length ? data.games[0].ts + '|' + data.games[data.games.length - 1].ts : '') + '|' + trackedPerfs().join(',');
  if (windowMemo.key !== key) {
    var cut = {}, year = Date.now() - 365 * DAY;
    trackedPerfs().forEach(function (p) {
      var ts = data.games.filter(function (g) { return g.perf === p; }).map(function (g) { return g.ts; }).sort(function (a, b) { return b - a; });
      cut[p] = ts.length > 150 ? Math.min(year, ts[149]) : 0;
    });
    windowMemo = { key: key, cut: cut };
  }
  return windowMemo.cut[perf] || 0;
}
function inScope(g) { return trackedPerfs().indexOf(g.perf) !== -1 && g.ts >= windowCut(g.perf); }
function scopedGames() { return data.games.filter(inScope); }
function model() {
  var tok = modelToken();
  if (modelCache.token === tok) return modelCache.m;
  var items = [], byKey = {};
  data.games.forEach(function (g) {
    if (!g.bl || !g.mv || !inScope(g)) return;
    markDecisive(g);
    g.bl.forEach(function (b) {
      if (!b.x && b.bu && (b.cv || 1) < CLASSIFY_V) relabelLater();
      if (b.x) return;                  /* refuted, disputed, or the game move itself */
      if (b.sc && !b.d) return;         /* a time-scramble premove that decided nothing */
      var it = { g: g, b: b, key: mKey(g, b) };
      items.push(it);
      byKey[it.key] = it;
    });
  });
  modelCache = { token: tok, m: { items: items, byKey: byKey } };
  return modelCache.m;
}
/* cards named by an older classifier are renamed in small batches while
   the page is idle, never in one long pause (a card on screen is always
   explained afresh anyway) */
var relabelTimer = null;
function relabelLater() {
  if (relabelTimer) return;
  relabelTimer = setTimeout(function step() {
    var n = 0;
    data.games.forEach(function (g) {
      if (!g.bl || !g.mv || n >= 120) return;
      g.bl.forEach(function (b) {
        if (n < 120 && !b.x && b.bu && (b.cv || 1) < CLASSIFY_V) { classifyEntry(b, g.mv); n++; }
      });
    });
    if (n) { modelDirty(); scheduleSave(); relabelTimer = setTimeout(step, 40); }
    else { relabelTimer = null; if (!ui.session) { renderTrain(); if (ui.view === 'insights') renderInsights(); } }
  }, 200);
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
  g.bl.forEach(function (b) { b.d = 0; delete b.dw; });
  if (g.res === 'win') return;
  var mine = g.bl.filter(function (b) { return !b.x; }).sort(function (a, b) { return a.p - b.p; });
  var pick = null, w = 0;
  if (g.wp && g.wp.length > 20) {
    /* in a loss: the biggest drop from a playable position after which the
       player never got back to even */
    if (g.res === 'loss') mine.forEach(function (b) {
      if (b.wb >= 40 && maxAfter(g, b.p) < 50 && (!pick || b.wb - b.wa > pick.wb - pick.wa)) { pick = b; w = 1; }
    });
    if (pick) pick.dw = pick.wa < 30 ? 'lost' : 'turn';
    if (!pick) for (var j = 0; j < mine.length && !pick; j++) {
      var c = mine[j];
      if (c.wb >= 70 && c.wa < 60 && maxAfter(g, c.p) < 70) { pick = c; w = g.res === 'loss' ? 1 : 0.5; pick.dw = 'slip'; }
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

