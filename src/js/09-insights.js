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
  return realGames().filter(function (g) { return covered(g) && (g.plies || 0) >= 6; });
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
    var agg = { fam: f, patterns: ps, count: 0, cost: 0, lost: 0, pts: 0, learned: 0, practising: 0, fresh: 0, recent: 0, older: 0 };
    ps.forEach(function (s) {
      agg.count += s.count; agg.cost += s.cost; agg.lost += lostOf(s.items); agg.pts += s.pts; agg.learned += s.fixed;
      agg.practising += s.practising; agg.fresh += s.fresh; agg.recent += s.recent; agg.older += s.older;
    });
    agg.steps = skillSteps(ps);
    return agg;
  }).filter(function (a) { return a.count > 0; })
    /* by the losses each decided (V4.8: the rows add up to the headline's
       games), then as the focus weighs them (cost: a draw half) */
    .sort(function (a, b) { return b.lost - a.lost || b.cost - a.cost || b.pts - a.pts; });
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
/* a count of games in words: "one game", "14 games" (V4.8: the losses a
   skill decided, each once) */
function fmtGames(x) {
  var n = Math.max(1, Math.round(x));
  return n === 1 ? 'one game' : n + ' games';
}

/* ── the five skills, as Insights draws them (F6.1) ─────────────────────
   One per family of 08-srs.js: a glyph (Lucide) and one plain line, tier 1
   first, then tiers 2 and 3. A skill's bar fills by steps (V4.8: each of
   its positions its rungs out of 3); its words count the positions:
   learned, in practice (practised, not learned yet), not started (never
   practised, or back in the queue) */
var SKILL = {
  safety: { glyph: 'shield', line: ['Moves that let them take your pieces.', 'Moves that let them win material.'] },
  king: { glyph: 'crown', line: ['Moves that put your king in danger.', 'Moves that exposed your king or allowed mate.'] },
  chances: { glyph: 'target', line: ['Free pieces and mates you missed.', 'Moves that missed a free piece, a tactic or a mate.'] },
  conversion: { glyph: 'flag', line: ['Times you were winning and let it go.', 'Moves that let a winning position get away.'] },
  quiet: { glyph: 'compass', line: ['Moves with no trick that made things worse.', 'Moves with no tactic that made your position worse.'] }
};
var ALSO_SEEN = 3;               /* a skill that decided fewer games sits under "Also seen" */
function skillLine(key, tier) { var s = SKILL[key]; return s ? s.line[tier === 1 ? 0 : 1] : ''; }
/* "3 learned · 12 in practice · 29 not started", its zero parts dropped
   (D17): a beginner reads "1 in practice · 43 not started", never "0
   learned" (V4.8: nobody misreads "climbing" or "to go") */
function progressWords(agg) {
  return [[agg.learned, 'learned'], [agg.practising, 'in practice'], [agg.fresh, 'not started']]
    .filter(function (x) { return x[0] > 0; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ');
}
/* the losses a skill's positions decided (V4.8: each decided game counted
   once, as the headline counts them; a draw is no loss) */
function lostOf(items) { return items.filter(function (it) { return it.b.d === 1; }).length; }
/* a skill's positions as steps (V4.8): each position its rungs out of 3
   (rungsOf: a clean find on a later day climbs one, learned 3; one back in
   the queue starts again at 0), so a find grows its bar and a miss shrinks
   it. pats: patternStats rows. { l: the learned positions' steps, c: the
   others', n: 3 a position } */
function skillSteps(pats) {
  var srs = srsLoad(), o = { l: 0, c: 0, n: 0 };
  pats.forEach(function (s) {
    s.items.forEach(function (it) {
      var r = srs[it.key];
      o.n += 3;
      if (!r || r.q) return;
      if (isLearned(r)) o.l += 3; else o.c += rungsOf(r);
    });
  });
  return o;
}
/* a skill's bar (F6.1, V4.8): an outlined track its steps fill, learned
   leaf, in practice honey */
function stepBarHtml(st, cls) {
  return '<span class="fr-bar' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + [[st.l, 'sk-l'], [st.c, 'sk-c'], [st.n - st.l - st.c, 'sk-g']].filter(function (x) { return x[0] > 0; })
    .map(function (x) { return '<i class="' + x[1] + '" style="flex-grow:' + x[0] + '"></i>'; }).join('') + '</span>';
}
/* games decided (V4.8: losses, each once), said as a count: "decided 15
   games", tier 1 "cost you 15 games" */
function decidedWords(lost, tier) {
  if (!(lost > 0)) return tier === 1 ? 'cost you no games' : 'decided no games';
  return (tier === 1 ? 'cost you ' : 'decided ') + fmtGames(lost);
}
/* the positions the background check still has to look at, while it runs
   (V4.8: Insights says so, as counts may shrink when a look takes one out):
   the deeper look's queue (V1.1's fact sheets, once they run in the
   background, count here instead) */
function checkingLeft() {
  if (SF.state === 'failed') return 0;
  return enrichState.running ? enrichTargets().length : 0;
}
/* the window as dates: "21 to 27 Sept 2026", "28 Aug to 3 Sept 2026",
   "3 Nov 2025 to 27 Sept 2026" */
function dateSpan(t0, t1) {
  var d0 = new Date(t0), d1 = new Date(t1), f = function (d, o) { return d.toLocaleDateString('en-GB', o); };
  var dmy = { day: 'numeric', month: 'short', year: 'numeric' }, dm = { day: 'numeric', month: 'short' };
  if (d0.toDateString() === d1.toDateString()) return f(d1, dmy);
  if (d0.getFullYear() !== d1.getFullYear()) return f(d0, dmy) + ' to ' + f(d1, dmy);
  return (d0.getMonth() === d1.getMonth() ? String(d0.getDate()) : f(d0, dm)) + ' to ' + f(d1, dmy);
}

/* ── since you started (F6.2) ───────────────────────────────────────────
   The start is the first finished set (nl:start:<player> = { t, thr, b }).
   The mistake threshold is frozen then, per format, at the band of the
   player's rating that day (their newest game before it), so a new band
   later moves nothing; every big mistake is recounted from the games'
   stored series at that threshold. Before: the format's games with a
   series before the start (its 12 months, and at least its newest 150), 20
   at least, else the first games after the start fill it; since: the games
   after those. Counts always; a verdict only from 10 games since, by
   learning's calibrated rule (sinceVerdict). b keeps the before numbers for
   when those games have left this browser (the cache keeps the newest) */
var SINCE_MIN = 10, BASE_MIN = 20;
function startKey() { return 'nl:start:' + playerId(); }
/* the first finished set notes the start (at: a time, for testing and for
   practice from before this build) */
function noteStart(at) {
  if (!cfg.user || (store.get(startKey(), null) || {}).t) return;
  var rec = { t: at || Date.now(), thr: {} };
  trackedPerfs().forEach(function (p) { var v = startThreshold(p, rec.t); if (v) rec.thr[p] = v; });
  practiceWrite(startKey(), rec);
}
/* the band on the start day: the rating of the format's newest game before
   it (else its first game after, else the profile), as mistakeMinFor reads
   it; null with none of these (a format not played yet is frozen later) */
function startThreshold(perf, t) {
  var before = null, after = null;
  data.games.forEach(function (g) {
    if (g.perf !== perf || !g.myR) return;
    if (g.ts <= t) { if (!before || g.ts > before.ts) before = g; }
    else if (!after || g.ts < after.ts) after = g;
  });
  var pr = data.user && data.user.perfs && data.user.perfs[perf];
  return before || after ? mistakeMinFor(before || after) : pr && pr.rating ? mistakeMinFor({ perf: perf, myR: pr.rating }) : null;
}
/* the start, or none before a finished set; practice from before this
   build starts at the end of the first day a set was finished (that day's
   games count before) */
function startLoad() {
  var s = store.get(startKey(), null);
  if (s && s.t) return s;
  var pre = 'nl:day:' + playerId() + ':', first = null, keys = Object.keys(mem);
  try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
  keys.forEach(function (k) {
    var m = k && k.indexOf(pre) === 0 && /^(\d+)-(\d+)-(\d+)$/.exec(k.slice(pre.length));
    if (!m || !((store.get(k, null) || {}).sessions >= 1)) return;
    var end = new Date(+m[1], +m[2] - 1, +m[3] + 1).getTime() - 1;
    if (first == null || end < first) first = end;
  });
  if (first == null) return null;
  noteStart(Math.min(first, Date.now()));
  return store.get(startKey(), null) || { t: Math.min(first, Date.now()), thr: {} };
}
/* the player's big mistakes in one game, recounted from its series at thr
   (kept on the game, out of storage, until the series or thr changes) */
function bigMistakesAt(g, thr) {
  var c = g.bigCache;
  if (c && c.wp === g.wp && c.thr === thr) return c.n;
  var n = 0, mine = g.color === 'white' ? 0 : 1;
  for (var i = 1; i < (g.wp ? g.wp.length : 0); i++) {
    if (i % 2 !== mine) continue;
    var a = wpAt(g, i - 1), b = wpAt(g, i);
    if (a != null && b != null && a - b >= thr) n++;
  }
  Object.defineProperty(g, 'bigCache', { value: { wp: g.wp, thr: thr, n: n }, enumerable: false, configurable: true, writable: true });
  return n;
}
/* a game's big mistakes at the frozen threshold thr, as its positions
   (V4.8: one count over what Insights shows): its positions not taken out,
   those that reach thr where the game was read at a lower one. A game read
   at a higher one (its player in a lower band then) has no position for
   the mistakes between the two, so its series counts them (fam null: no
   skill's line counts it, which would read as fewer mistakes where there
   were not). { n, fam: each skill's } */
function bigCardsAt(g, thr) {
  var own = mistakeMinFor(g), o = { n: 0, fam: {} };
  if (own > thr) return { n: bigMistakesAt(g, thr), fam: null };
  (g.bl || []).forEach(function (b) {
    var w0 = wpAt(g, b.p - 1), w1 = wpAt(g, b.p);
    if (b.x || (own < thr && (w0 != null && w1 != null ? w0 - w1 : b.wb - b.wa) < thr)) return;
    o.n++;
    var f = familyOf(patternOf(b)).key;
    o.fam[f] = (o.fam[f] || 0) + 1;
  });
  return o;
}
/* a practised skill's verdict (V4.8), by the same calibrated rule as the
   total, over the games its positions count in (famN), from 20 games since
   and 10 of its mistakes before; null under those (its line hides) */
function skillVerdict(B, S, f) {
  if (S.famN < 20 || !B.famN || (B.fam[f] || 0) < 10) return null;
  var m = B.fam[f] / B.famN, v = B.famN > 1 ? ((B.fsq[f] || 0) - B.famN * m * m) / (B.famN - 1) : 0;
  return sinceVerdict({ n: B.famN, mean: m, v: v }, { n: S.famN, total: S.fam[f] || 0 });
}
/* the before and since numbers: { t, thr, before: { n, mean, v, clean, fam,
   fsq, famN, opp }, since: { n, total, mean, clean, fam, fsq, famN, opp },
   need, verdict } (verdict a key of SINCE_SAY, 'wait' under 10 games
   since; need the games still to come before the before count has its 20);
   null before the start */
function sinceStats() {
  var s = startLoad();
  if (!s) return null;
  var tp = trackedPerfs(), thr = s.thr || {}, grew = false;
  tp.forEach(function (p) { var v = !thr[p] && startThreshold(p, s.t); if (v) { thr[p] = v; grew = true; } });
  var games = data.games.filter(function (g) { return g.wp && tp.indexOf(g.perf) !== -1 && thr[g.perf]; });
  var year = s.t - 365 * DAY;
  var pre = games.filter(function (g) { return g.ts <= s.t; }).sort(function (x, y) { return y.ts - x.ts; })
    .filter(function (g, i) { return i < 150 || g.ts >= year; });
  var post = games.filter(function (g) { return g.ts > s.t; }).sort(function (x, y) { return x.ts - y.ts || (x.id < y.id ? -1 : 1); });
  /* one count over the positions Insights shows (V4.8: the per-game figure
     is the deciding and the other big mistakes over the games), each skill's
     its own positions, in the games whose positions reach down to the
     frozen threshold (bigCardsAt); fsq: each skill's per-game squares, for
     its verdict */
  var sum = function (list) {
    var o = { n: 0, total: 0, sq: 0, clean: 0, fam: {}, fsq: {}, famN: 0, opp: 0, on: 0 };
    list.forEach(function (g) {
      var c = bigCardsAt(g, thr[g.perf]);
      o.n++; o.total += c.n; o.sq += c.n * c.n; if (!c.n) o.clean++;
      if (c.fam) {
        o.famN++;
        Object.keys(c.fam).forEach(function (f) { o.fam[f] = (o.fam[f] || 0) + c.fam[f]; o.fsq[f] = (o.fsq[f] || 0) + c.fam[f] * c.fam[f]; });
      }
      if (g.oppR) { o.opp += g.oppR; o.on++; }
    });
    return o;
  };
  var B = sum(pre), key = tp.slice().sort().join(','), copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  /* the kept copy (for these formats and this start) stands in once the
     before games have left the cache */
  var same = s.b && s.b.p === key && s.b.at === s.t && !!s.b.fsq;
  if (same && s.b.n > B.n) { B = copy(s.b); B.fam = B.fam || {}; B.fsq = B.fsq || {}; B.famN = B.famN || 0; }
  else if (!same || B.n !== s.b.n || B.total !== s.b.total || B.sq !== s.b.sq || B.famN !== s.b.famN) { s.b = copy(B); s.b.p = key; s.b.at = s.t; grew = true; }
  if (grew) { s.thr = thr; practiceWrite(startKey(), s); }
  /* too few before: the first games after the start fill it to 20 */
  var fill = Math.max(0, BASE_MIN - B.n), F = sum(post.slice(0, fill)), S = sum(post.slice(fill));
  ['n', 'total', 'sq', 'clean', 'famN', 'opp', 'on'].forEach(function (k) { B[k] += F[k]; });
  Object.keys(F.fam).forEach(function (f) { B.fam[f] = (B.fam[f] || 0) + F.fam[f]; B.fsq[f] = (B.fsq[f] || 0) + F.fsq[f]; });
  B.mean = B.n ? B.total / B.n : 0;
  B.v = B.n > 1 ? (B.sq - B.n * B.mean * B.mean) / (B.n - 1) : 0;
  S.mean = S.n ? S.total / S.n : 0;
  return { t: s.t, thr: thr, before: B, since: S, need: Math.max(0, BASE_MIN - B.n), verdict: S.n < SINCE_MIN ? 'wait' : sinceVerdict(B, S) };
}
/* the standard normal's distribution function (Abramowitz and Stegun 26.2.17) */
function normCdf(z) {
  var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
/* learning's calibrated verdict: v the sample variance of big mistakes per
   game before; since* = (since total + before mean x 10) / (since games +
   10); SE = sqrt(v / before games + v x max(0.2, since* / before mean) /
   since games); P = Phi((before mean - since*) / SE). With no change a
   false "fewer" stays at or under 2% from 10 to 50 games */
function sinceVerdict(B, S) {
  var shrunk = (S.total + B.mean * SINCE_MIN) / (S.n + SINCE_MIN);
  var se = Math.sqrt(B.v / B.n + B.v * Math.max(0.2, shrunk / B.mean) / S.n);
  if (!(se > 0) || !isFinite(se)) return 'no_change';
  var P = normCdf((B.mean - shrunk) / se);
  return P >= 0.975 ? 'fewer' : P >= 0.9 ? 'probably_fewer' : P > 0.1 ? 'no_change' : P > 0.025 ? 'probably_more' : 'more';
}
var SINCE_SAY = { fewer: 'Fewer than before.', probably_fewer: 'Probably fewer. More games will tell.', no_change: 'No clear change yet.',
                  probably_more: 'Probably more than before.', more: 'More than before.' };
/* Today, from 10 games since the start: the games since the last visit and
   their big mistakes against what as many games had before practice
   started (the before count, the only usual there is), "Since your last
   visit: 3 games, 4 big mistakes (before you started: about 6)." Only once
   every one of those games is read; '' otherwise */
function sinceVisitWords(fresh) {
  var tp = trackedPerfs();
  fresh = fresh.filter(function (g) { return tp.indexOf(g.perf) !== -1; });
  var st = fresh.length ? sinceStats() : null;
  if (!st || st.since.n < SINCE_MIN || !st.before.n || fresh.some(function (g) { return !g.wp || !st.thr[g.perf]; })) return '';
  var n = 0;
  fresh.forEach(function (g) { n += bigCardsAt(g, st.thr[g.perf]).n; });
  return 'Since your last visit: ' + plur(fresh.length, 'game') + ', ' + (n ? plur(n, 'big mistake') : 'no big mistakes') + ' (before you started: about ' + Math.round(st.before.mean * fresh.length) + ').';
}

/* ── your clock (F6.3) ──────────────────────────────────────────────────
   From 5 losses with an end clock (g.clockPct, stored at ingest: the
   player's clock when the game ended, in percent of the starting time):
   the time used in a loss (the median of base plus increments minus the
   end clock); the moves that lost, their think time and the clock left
   (medians over the moves that decided a lost game); how many came in time
   trouble (under max(20 s, base / 10), timeTrouble), shown from 3 such
   moves when a quarter did; at tier 3 how many deciding moves took under
   10 s. One time control is said in its own minutes, mixed ones in shares.
   Each time has its base rate beside it, so a slow or quick move is never
   read without the player's own norm: the moves that lost against the
   player's pace before them (the median of Details' tier 3 pace over those
   moves), the quick deciding moves against the player's other big
   mistakes */
function median(xs) {
  var s = xs.slice().sort(function (a, b) { return a - b; }), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
function incOf(g) { return parseFloat(String(g.tc || '').split('+')[1]) || 0; }
/* the player's pace before a move, in whole seconds a move, as Details
   says it at tier 3: (base + increment x (n - 1) - the clock before it) /
   (n - 1) for their n-th move, from the clock after it (b.c) and its time
   (b.tt); null on a first move, with no clock, or under a second */
function paceOf(it) {
  var b = it.b, base = tcInitialSecs(it.g.tc), inc = incOf(it.g), n = Math.floor(b.p / 2) + 1;
  if (!base || n < 2 || b.c == null || b.tt == null) return null;
  var pace = Math.round((base + inc * (n - 1) - (b.c + b.tt - inc)) / (n - 1));
  return pace >= 1 ? pace : null;
}
function clockReport() {
  var losses = realGames().filter(function (g) { return covered(g) && g.res === 'loss' && g.clockPct != null && tcInitialSecs(g.tc); });
  if (losses.length < 5) return null;
  var one = losses.every(function (g) { return g.tc === losses[0].tc; }), base = tcInitialSecs(losses[0].tc);
  var used = losses.map(function (g) {
    var b = tcInitialSecs(g.tc), n = g.color === 'white' ? Math.ceil((g.plies || 0) / 2) : Math.floor((g.plies || 0) / 2), all = b + incOf(g) * n;
    return { used: Math.max(0, all - g.clockPct * b / 100), all: all };
  });
  var timed = allMistakes().filter(function (it) { return it.b.c != null && it.b.tt != null && tcInitialSecs(it.g.tc); });
  var dec = timed.filter(function (it) { return it.b.d > 0; }), other = timed.filter(function (it) { return !(it.b.d > 0); });
  var lost = dec.filter(function (it) { return it.b.d === 1 && it.g.res === 'loss'; });
  var paces = lost.map(paceOf).filter(function (x) { return x != null; });
  var quick = function (it) { return it.b.tt < 10; };
  return {
    one: one && dec.every(function (it) { return it.g.tc === losses[0].tc; }), base: base,
    used: median(used.map(function (x) { return x.used; })), all: median(used.map(function (x) { return x.all; })),
    share: median(used.map(function (x) { return x.used / x.all; })),
    lost: lost.length, took: lost.length ? median(lost.map(function (it) { return it.b.tt; })) : null,
    pace: paces.length ? Math.round(median(paces)) : null,
    left: lost.length ? median(lost.map(function (it) { return it.b.c; })) : null,
    leftShare: lost.length ? median(lost.map(function (it) { return it.b.c / tcInitialSecs(it.g.tc); })) : null,
    trouble: lost.filter(timeTrouble).length, dec: dec.length, fast: dec.filter(quick).length,
    other: other.length, otherFast: other.filter(quick).length
  };
}

/* ── how your games are decided (F10.3, master) ──────────────────────────
   At tier 3, three counts over the window's own games, defined as record()
   in tools/build-peer-baselines.py so that the peer figures measure the
   same thing: a game reached +2 when the player's winning chances after
   some ply came to those of 200 centipawns or more (winPct(200), 67.6; a
   mate sits at the end of the scale, as the script's 1500 clamp does), and
   fell to -2 at winPct(-200) or less; counted over games of 6 plies or more
   with 5 or more of the player's moves scored. Converting wins: won of
   those that reached +2; saving bad positions: not lost of those that fell
   to -2; slow slides: losses that no single move decided (the headline
   counts the others). A row needs DECIDED_MIN qualifying games. Beside the
   first two, the peer figure (PEER_DECIDED): lichess rapid, blitz, bullet
   and classical games of July 2026, 6.7 million, per 100-point band (800
   and under to 2400 and over), trimmed from the v1 platform's blob to
   these two numbers, at the player's lichess-equivalent rating
   (bandEquivRating) in each format, weighted by the player's qualifying
   games per format. Context, never a verdict: the peer games were scored
   by lichess's own analysis, the player's by the series stored here */
var DECIDED_MIN = 10;
var CONV_WIN = winPct(200), RES_WIN = winPct(-200);
var PEER_DECIDED = { src: 'lichess_db_standard_rated_2026-07', from: 800,
  bullet: [[53.7,41.5],[56.5,43.4],[58.1,42.4],[58.5,42.1],[59.2,42.3],[59.1,41.5],[60.1,41.2],[61.5,41.6],[61.9,40.7],[62.3,39.7],[61.5,38.5],[61.7,38.7],[61.3,37.1],[60.7,34.8],[59.4,33.2],[61.0,35.0],[64.0,34.5]],
  blitz: [[58.9,38.4],[61.1,38.9],[61.7,37.9],[63.3,37.8],[63.7,37.8],[63.5,36.4],[64.1,36.3],[65.9,36.4],[65.0,35.2],[65.0,34.3],[65.2,33.4],[65.7,32.4],[66.0,31.6],[66.8,31.7],[67.6,31.1],[69.5,32.0],[71.2,33.4]],
  rapid: [[59.0,37.7],[61.2,37.4],[63.5,37.8],[63.0,36.4],[63.9,35.9],[64.5,35.6],[64.8,34.4],[66.8,34.1],[65.8,33.4],[66.3,33.1],[67.9,32.7],[68.0,31.4],[69.5,31.0],[71.9,30.6],[74.1,30.6],[77.1,31.6],[77.9,33.9]],
  classical: [[58.7,27.4],[59.1,38.5],[61.7,35.1],[63.9,34.2],[62.8,33.8],[63.1,32.4],[67.1,34.4],[67.8,31.9],[66.9,31.3],[67.1,32.8],[69.2,31.4],[72.1,31.8],[75.0,28.6],[76.5,35.2],[75.8,35.4]] };
/* a game's swings from its stored series, the player's side: the first
   ply after which it stood at +2 (reach) and at -2 (fell), or null; null
   for a game too short or too little scored to count */
function gameSwings(g) {
  if (!g.wp || (g.plies || 0) < 6) return null;
  var mine = g.color === 'white' ? 0 : 1, scored = 0, reach = null, fell = null;
  for (var i = 0; i < g.wp.length; i++) {
    var w = wpAt(g, i);
    if (w == null) continue;
    if (i % 2 === mine) scored++;
    if (reach == null && w >= CONV_WIN) reach = i;
    if (fell == null && w <= RES_WIN) fell = i;
  }
  return scored >= 5 ? { reach: reach, fell: fell } : null;
}
/* the peer rate (k 0: converting, 1: saving) for the formats of games gs,
   weighted by their count; null when a format has none (a daily game, a
   rating unknown, a band the blob lacks) */
function peerDecided(gs, k) {
  var by = {}, sum = 0, n = 0, ok = true;
  gs.forEach(function (g) { by[g.perf] = (by[g.perf] || 0) + 1; });
  Object.keys(by).forEach(function (p) {
    var rows = PEER_DECIDED[p], u = data.user && data.user.perfs && data.user.perfs[p], r = u ? bandEquivRating(p, u.rating) : null;
    var row = rows && r != null ? rows[Math.max(0, Math.min(16, Math.floor(r / 100) - PEER_DECIDED.from / 100))] : null;
    if (!row) { ok = false; return; }
    sum += row[k] * by[p]; n += by[p];
  });
  return ok && n ? sum / n : null;
}
/* the three rows' counts: {conv: {n, won, peer}, save: {n, saved, peer},
   slow: {n (losses), none (decided by no single move)}}, each null under
   DECIDED_MIN qualifying games */
function decidedReport() {
  var reached = [], fell = [], won = 0, saved = 0, losses = 0, slow = 0;
  /* the moves that decided games are marked by the model */
  model();
  coveredGames().forEach(function (g) {
    if (g.res === 'loss') { losses++; if (!(g.bl || []).some(function (b) { return b.d === 1; })) slow++; }
    var s = gameSwings(g);
    if (!s) return;
    if (s.reach != null) { reached.push(g); if (g.res === 'win') won++; }
    if (s.fell != null) { fell.push(g); if (g.res !== 'loss') saved++; }
  });
  return {
    conv: reached.length >= DECIDED_MIN ? { n: reached.length, won: won, peer: peerDecided(reached, 0) } : null,
    save: fell.length >= DECIDED_MIN ? { n: fell.length, saved: saved, peer: peerDecided(fell, 1) } : null,
    slow: losses >= DECIDED_MIN ? { n: losses, none: slow } : null
  };
}
/* the positions behind a row (its Practise these): the big mistakes made
   after a game reached +2 in the games not won ('convert'), or after it
   fell to -2 in the games lost ('save') */
function decidedPosition(it, kind) {
  var g = it.g, s = gameSwings(g);
  if (!s) return false;
  return kind === 'convert' ? g.res !== 'win' && s.reach != null && it.b.p > s.reach : g.res === 'loss' && s.fell != null && it.b.p > s.fell;
}

