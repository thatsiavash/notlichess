/* ── Insights: where your mistakes come from ────────────────────────────────
   Every finding is a comparison of mistake RATES (per 100 of your own moves,
   worded as "a mistake every N moves"), tested with a game-level bootstrap
   (mistakes cluster inside games, so games are the unit that is resampled),
   and shown only when it is both clear and large. Each one ends in a drill
   of the mistakes behind it. */

var INSIGHT_MIN_GAMES = 30;      /* below this, no findings: just counts */

function ownMoves(g) { return Math.max(1, Math.floor((g.plies || 0) / 2)); }
function gameMistakes(g) {
  return g.bl ? g.bl.filter(function (b) { return !b.x; }) : [];
}
/* for rates: every mistake, from the series when available */
function gameMistakeList(g) {
  var sp = scoredPlies(g);
  if (sp.plies.length) return sp.mistakes;
  var n = gameMistakeCount(g), out = [];
  for (var i = 0; i < n; i++) out.push(1);
  return out;
}
/* the moves a rate is taken over: the scored ones when the series exists */
function scoredMoves(g) { var sp = scoredPlies(g); return sp.plies.length || ownMoves(g); }
function coveredGames() {
  return scopedGames().filter(function (g) { return covered(g) && (g.plies || 0) >= 6; });
}
/* a small seeded generator, so the same data always gives the same answer */
function seededRand(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/* my moves the engine scored, by ply, with the mistakes among them: rates
   divide by moves that were actually looked at, not by the whole game */
function scoredPlies(g) {
  if (g.scoredCache && g.scoredCache.wp === g.wp) return g.scoredCache;
  var out = { wp: g.wp, plies: [], mistakes: [] };
  if (g.wp) {
    var min = mistakeMinFor(g), mine = g.color === 'white' ? 0 : 1;
    for (var i = 1; i < g.wp.length; i++) {
      if (i % 2 !== mine) continue;
      var a = wpAt(g, i - 1), b = wpAt(g, i);
      if (a == null || b == null) continue;
      out.plies.push(i);
      if (a - b >= min) out.mistakes.push(i);
    }
  }
  Object.defineProperty(g, 'scoredCache', { value: out, enumerable: false, configurable: true, writable: true });
  return out;
}
function rateOf(games, pickMistakes, movesOf) {
  var m = 0, n = 0;
  movesOf = movesOf || ownMoves;
  games.forEach(function (g) { m += pickMistakes(g).length; n += movesOf(g); });
  return { m: m, n: n, rate: n ? m * 100 / n : 0 };
}
/* is the rate inside A clearly higher than inside B? */
function compareRates(A, B, pick, seed, movesOf) {
  movesOf = movesOf || ownMoves;
  var ra = rateOf(A, pick, movesOf), rb = rateOf(B, pick, movesOf);
  if (A.length < 15 || B.length < 15 || !ra.n || !rb.n) return null;
  var rnd = seededRand(seed || 7), diffs = [];
  var per = function (list) {
    return list.map(function (g) { return [pick(g).length, movesOf(g)]; });
  };
  var pa = per(A), pb = per(B);
  for (var it = 0; it < 300; it++) {
    var ma = 0, na = 0, mb = 0, nb = 0, i, x;
    for (i = 0; i < pa.length; i++) { x = pa[Math.floor(rnd() * pa.length)]; ma += x[0]; na += x[1]; }
    for (i = 0; i < pb.length; i++) { x = pb[Math.floor(rnd() * pb.length)]; mb += x[0]; nb += x[1]; }
    diffs.push(ma * 100 / Math.max(1, na) - mb * 100 / Math.max(1, nb));
  }
  diffs.sort(function (a, b) { return a - b; });
  var lo = diffs[Math.floor(diffs.length * 0.025)], hi = diffs[Math.floor(diffs.length * 0.975)];
  /* the effect must also show in both halves of the history, not just the sum */
  var halves = function (list) {
    var s2 = list.slice().sort(function (x, y) { return x.ts - y.ts; }), h = Math.floor(s2.length / 2);
    return [s2.slice(0, h), s2.slice(h)];
  };
  var ha = halves(A), hb = halves(B), both = true;
  for (var hh = 0; hh < 2; hh++) {
    var x1 = rateOf(ha[hh], pick, movesOf), x2 = rateOf(hb[hh], pick, movesOf);
    if (!(x1.rate >= x2.rate * 1.1)) both = false;
  }
  return { a: ra, b: rb, lo: lo, hi: hi, ratio: rb.rate ? ra.rate / rb.rate : null,
           clear: lo > 0 && both && ra.rate >= rb.rate * 1.25 && ra.rate - rb.rate >= 0.4 };
}
/* "a mistake every 12 moves" */
function everyMoves(rate) {
  if (!rate) return 'no mistakes';
  var n = Math.round(100 / rate);
  return n <= 1 ? 'a mistake almost every move' : 'a mistake every ' + n + ' moves';
}

function insightReport() {
  var m = model();
  if (m.report && m.reportSrs === srsRevision) return m.report;
  var gs = coveredGames(), all = gameMistakeList;
  var out = { games: gs.length, ready: gs.length >= INSIGHT_MIN_GAMES, slices: [], families: [] };
  var cov = coverage();
  out.coverage = cov;
  /* families, with their patterns underneath */
  var stats = patternStats();
  out.families = FAMILIES.map(function (f) {
    var ps = stats.filter(function (s) { return f.types.indexOf(s.key) !== -1; });
    var agg = { fam: f, patterns: ps, count: 0, cost: 0, pts: 0, learned: 0, practising: 0, fresh: 0, recent: 0, older: 0 };
    ps.forEach(function (s) {
      agg.count += s.count; agg.cost += s.cost; agg.pts += s.pts; agg.learned += s.fixed;
      agg.practising += s.practising; agg.fresh += s.fresh; agg.recent += s.recent; agg.older += s.older;
    });
    return agg;
  }).filter(function (a) { return a.count > 0; })
    .sort(function (a, b) { return b.cost - a.cost || b.pts - a.pts; });
  out.rate = rateOf(gs, all, scoredMoves);
  if (!out.ready) { m.report = out; m.reportSrs = srsRevision; return out; }

  /* colour */
  var W = gs.filter(function (g) { return g.color === 'white'; });
  var B = gs.filter(function (g) { return g.color === 'black'; });
  [[B, W, 'black', 'As Black'], [W, B, 'white', 'As White']].forEach(function (pair, i) {
    var c = compareRates(pair[0], pair[1], all, 11 + i, scoredMoves);
    if (c && c.clear) out.slices.push({
      key: 'colour:' + pair[2], kind: 'colour', label: pair[3], cmp: c,
      text: pair[3] + ' you make ' + everyMoves(c.a.rate) + '; with the other colour, ' + everyMoves(c.b.rate) + '.',
      spec: { type: 'colour', colour: pair[2], label: 'Your mistakes as ' + pair[2] }
    });
  });
  /* no phase slice (the middlegame is the worst phase for nearly every
     player, so it restates everyone) and no clock slice (no baseline) */
  /* openings: early mistakes (first 15 moves) per family, shrunk toward
     your own average so a small family cannot shout */
  var early = function (g) {
    var sp = scoredPlies(g);
    return sp.plies.length ? sp.mistakes.filter(function (p) { return p < 30; }) : gameMistakes(g).filter(function (b) { return b.p < 30; });
  };
  var earlyMoves = function (g) {
    var sp = scoredPlies(g);
    return sp.plies.length ? sp.plies.filter(function (p) { return p < 30; }).length : Math.min(ownMoves(g), 15);
  };
  var fams = {};
  gs.forEach(function (g) {
    var f = openingFamily(g);
    if (!f) return;
    var k = g.color + '|' + f;
    (fams[k] = fams[k] || { fam: f, colour: g.color, games: [] }).games.push(g);
  });
  /* each opening against the player's other games with the same colour */
  var prior = 150, baseBy = {
    white: rateOf(W, early, earlyMoves), black: rateOf(B, early, earlyMoves)
  };
  var famRows = Object.keys(fams).map(function (k) {
    var F = fams[k], base = baseBy[F.colour];
    if (F.games.length < 15) return null;
    var rest = gs.filter(function (g) { return g.color === F.colour && F.games.indexOf(g) === -1; });
    var r = rateOf(F.games, early, earlyMoves);
    var shrunk = (r.m + base.rate / 100 * prior) * 100 / (r.n + prior);
    var c = compareRates(F.games, rest, early, 101 + F.games.length, earlyMoves);
    return c ? { F: F, r: r, shrunk: shrunk, c: c, base: base } : null;
  }).filter(Boolean);
  /* Benjamini-Hochberg-style guard: with many families, demand more */
  var need = famRows.length > 6 ? 1.6 : 1.4;
  famRows.filter(function (x) { return x.c.clear && x.shrunk >= x.base.rate * need; })
    .sort(function (a, b) { return b.shrunk - a.shrunk; }).slice(0, 2).forEach(function (x) {
      out.slices.push({
        key: 'opening:' + x.F.colour + '|' + x.F.fam, kind: 'opening', label: x.F.fam + ' as ' + x.F.colour,
        text: 'In the ' + x.F.fam + ' as ' + x.F.colour + ' you make ' + everyMoves(x.r.rate)
          + ' in the first 15 moves; in your other openings as ' + x.F.colour + ', ' + everyMoves(x.c.b.rate) + '.',
        spec: { type: 'opening', family: x.F.fam, colour: x.F.colour, label: 'Early mistakes in the ' + x.F.fam }
      });
    });
  m.report = out;
  m.reportSrs = srsRevision;
  return out;
}
/* draws count half; shown as whole games, which is how people count */
function fmtGames(x) {
  var n = Math.max(1, Math.round(x));
  return n === 1 ? 'one game' : n + ' games';
}

