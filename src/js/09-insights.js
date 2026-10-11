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

/* ── the five skills, as Insights draws them (F6.1) ─────────────────────
   One per family of 08-srs.js: a glyph (Lucide) and one plain line, tier 1
   first, then tiers 2 and 3. A skill's bar counts its own positions in
   practice: learned, climbing (practised, not learned yet), to go (never
   practised, or back in the queue) */
var SKILL = {
  safety: { glyph: 'shield', line: ['Moves that let them take your pieces.', 'Moves that let them win material.'] },
  king: { glyph: 'crown', line: ['Moves that put your king in danger.', 'Moves that exposed your king or allowed mate.'] },
  chances: { glyph: 'target', line: ['Free pieces and mates you missed.', 'Moves that missed a free piece, a tactic or a mate.'] },
  conversion: { glyph: 'flag', line: ['Times you were winning and let it go.', 'Moves that let a winning position get away.'] },
  quiet: { glyph: 'compass', line: ['Slow moves that made things worse.', 'Moves with no tactic that made your position worse.'] }
};
var ALSO_SEEN = 3;               /* a skill that decided fewer games sits under "Also seen" */
function skillLine(key, tier) { var s = SKILL[key]; return s ? s.line[tier === 1 ? 0 : 1] : ''; }
/* "3 learned · 12 climbing · 29 to go", its zero parts dropped (D17): a
   beginner reads "1 climbing · 43 to go", never "0 learned" */
function progressWords(agg) {
  return [[agg.learned, 'learned'], [agg.practising, 'climbing'], [agg.fresh, 'to go']]
    .filter(function (x) { return x[0] > 0; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ');
}
/* games decided, said as a count (draws half, in whole games): "decided
   15 games", tier 1 "cost you 15 games"; half a game where a draw alone */
function decidedWords(cost, tier) {
  var v = tier === 1 ? 'cost you ' : 'decided ';
  if (!(cost > 0)) return tier === 1 ? 'cost you no games' : 'decided no games';
  return v + (cost < 1 ? 'half a game' : fmtGames(cost));
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
/* the before and since numbers: { t, thr, before: { n, mean, v, clean, fam,
   famN, opp }, since: { n, total, mean, clean, fam, famN, opp }, need,
   verdict } (verdict a key of SINCE_SAY, 'wait' under 10 games since; need
   the games still to come before the before count has its 20); null before
   the start */
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
  var sum = function (list) {
    var o = { n: 0, total: 0, sq: 0, clean: 0, fam: {}, famN: 0, opp: 0, on: 0 };
    list.forEach(function (g) {
      var k = bigMistakesAt(g, thr[g.perf]);
      o.n++; o.total += k; o.sq += k * k; if (!k) o.clean++;
      /* a skill's mistakes: the big ones (by the series, as counted) whose
         card is of that skill, in the games whose cards reach down to the
         frozen threshold (famN of them): a game read at a higher one (its
         player in a lower band) has no card for the mistakes between the
         two, and would read as fewer mistakes where there were not */
      if (mistakeMinFor(g) <= thr[g.perf]) {
        o.famN++;
        (g.bl || []).forEach(function (b) {
          var w0 = wpAt(g, b.p - 1), w1 = wpAt(g, b.p);
          if (b.x || (w0 != null && w1 != null ? w0 - w1 : b.wb - b.wa) < thr[g.perf]) return;
          var f = familyOf(patternOf(b)).key;
          o.fam[f] = (o.fam[f] || 0) + 1;
        });
      }
      if (g.oppR) { o.opp += g.oppR; o.on++; }
    });
    return o;
  };
  var B = sum(pre), key = tp.slice().sort().join(','), copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  /* the kept copy (for these formats and this start) stands in once the
     before games have left the cache */
  var same = s.b && s.b.p === key && s.b.at === s.t;
  if (same && s.b.n > B.n) { B = copy(s.b); B.fam = B.fam || {}; B.famN = B.famN || 0; }
  else if (!same || B.n !== s.b.n || B.total !== s.b.total || B.sq !== s.b.sq || B.famN !== s.b.famN) { s.b = copy(B); s.b.p = key; s.b.at = s.t; grew = true; }
  if (grew) { s.thr = thr; practiceWrite(startKey(), s); }
  /* too few before: the first games after the start fill it to 20 */
  var fill = Math.max(0, BASE_MIN - B.n), F = sum(post.slice(0, fill)), S = sum(post.slice(fill));
  ['n', 'total', 'sq', 'clean', 'famN', 'opp', 'on'].forEach(function (k) { B[k] += F[k]; });
  Object.keys(F.fam).forEach(function (f) { B.fam[f] = (B.fam[f] || 0) + F.fam[f]; });
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
  fresh.forEach(function (g) { n += bigMistakesAt(g, st.thr[g.perf]); });
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

