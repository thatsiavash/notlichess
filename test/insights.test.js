// The numbers behind Insights: the win-chance series, mistakes counted over analysed moves, the mistake that
// decided a game, and the significance test used before any "you do worse as Black" style finding is shown.
// node test/insights.test.js   (exit code 1 on any failure)
const fs = require('fs'), path = require('path'), vm = require('vm');
const js = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8');
const ctx = {
  console, Math, JSON, Date,
  cfg: { user: 'tester', src: 'lichess' },
  data: { games: [] },
  store: { get: (k, d) => d, set: () => true, del: () => {} },
  isCC: () => false,
  CC_OFFSET: {},
  winPct: (cp) => Math.round(10 * (50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1))) / 10,
  bandEquivRating: (perf, r) => r,
};
vm.createContext(ctx);
['06-ingest.js', '07-model.js', '08-srs.js', '09-insights.js'].forEach((f) => vm.runInContext(js(f), ctx, { filename: f }));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

let seq = 0;
function cpOf(w) { const x = Math.max(0.6, Math.min(99.4, w)) / 50 - 1; return Math.round(-Math.log(2 / (x + 1) - 1) / 0.00368208); }
/* a game from White's win chance after each ply (null = not analysed) */
function game(color, whiteWins, extra) {
  return Object.assign({ id: 'g' + (++seq), color, plies: whiteWins.length, myR: 1500, perf: 'rapid', res: 'loss',
    ts: 1e12 + seq, wp: ctx.wpSeries(whiteWins.map((w) => (w == null ? null : cpOf(w)))) }, extra || {});
}

/* ── the series ─────────────────────────────────────────────────────────── */
test('the win-chance series round-trips within a point', () => {
  const ws = [50, 62.5, 80, 20, 99, 1];
  const g = game('white', ws);
  ws.forEach((w, i) => { if (Math.abs(ctx.wpAt(g, i) - w) > 1) throw new Error('ply ' + i + ': ' + ctx.wpAt(g, i)); });
});
test('the series reads from the player\'s side when they had Black', () => {
  const g = game('black', [50, 62.5, 80]);
  if (Math.abs(ctx.wpAt(g, 2) - 20) > 1) throw new Error('got ' + ctx.wpAt(g, 2));
});
test('unanalysed plies read as unknown, never as a value', () => {
  eq(ctx.wpAt(game('white', [50, null, 55]), 1), null, 'ply 1');
});

/* ── mistakes over analysed moves ───────────────────────────────────────── */
test('a mistake is a drop on the player\'s own move, at or above the threshold', () => {
  /* White moves on even plies; 60 -> 30 at ply 2 is a 30 point drop, 32 -> 31 at ply 4 is nothing */
  const sp = ctx.scoredPlies(game('white', [55, 60, 30, 32, 31, 10]));
  eq(sp.plies.join(','), '2,4', 'scored plies');
  eq(sp.mistakes.join(','), '2', 'mistakes');
});
test('the opponent\'s drops are never the player\'s mistakes', () => {
  const sp = ctx.scoredPlies(game('black', [50, 50, 10, 10, 10]));   /* White dropped at ply 2 */
  eq(sp.mistakes.length, 0, 'mistakes');
});
test('a move is only scored when both sides of it were analysed', () => {
  const sp = ctx.scoredPlies(game('white', [50, null, 20, 25, 24, 22]));
  eq(sp.plies.join(','), '4', 'scored plies');
});
test('the threshold follows the rating: 20 below 1200, 15 below 1800, 12 above', () => {
  const drop = [50, 50, 33, 33, 33];                                  /* a 17 point drop at ply 2 */
  eq(ctx.scoredPlies(game('white', drop, { myR: 1000 })).mistakes.length, 0, 'at 1000');
  eq(ctx.scoredPlies(game('white', drop, { myR: 1500 })).mistakes.length, 1, 'at 1500');
  eq(ctx.scoredPlies(game('white', drop, { myR: 2000 })).mistakes.length, 1, 'at 2000');
});
test('the series count and the scored count agree', () => {
  const g = game('white', [55, 60, 30, 32, 31, 10, 12, 40, 5]);
  eq(ctx.gameMistakeCount(g), ctx.scoredPlies(g).mistakes.length, 'count');
});
test('rates divide by the moves that were analysed', () => {
  const a = game('white', [50, 50, 20, 20, 20, 20]);                   /* 2 scored moves, 1 mistake */
  const r = ctx.rateOf([a], ctx.gameMistakeList, ctx.scoredMoves);
  eq(r.m, 1, 'mistakes'); eq(r.n, 2, 'moves'); eq(r.rate, 50, 'rate per 100');
});
test('"a mistake every N moves" wording', () => {
  eq(ctx.everyMoves(5), 'a mistake every 20 moves', '5 per 100');
  eq(ctx.everyMoves(0), 'no mistakes', 'zero');
  eq(ctx.fmtGames(1), 'one game', 'one'); eq(ctx.fmtGames(2.5), '3 games', 'rounded');
});

/* ── the mistake that decided the game ──────────────────────────────────── */
function withMistakes(g, list) { g.bl = list.map((m) => Object.assign({ bu: 'e2e4' }, m)); return g; }
test('in a loss, the drop below 40% that never recovered decided it', () => {
  const ws = [50, 50, 55, 55, 55, 55, 30, 30, 30, 30, 20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 5, 5];
  const g = withMistakes(game('white', ws), [{ p: 6, wb: 55, wa: 30 }, { p: 10, wb: 30, wa: 20 }]);
  ctx.markDecisive(g);
  eq(g.bl[0].d, 1, 'first'); eq(g.bl[1].d, 0, 'second');
});
test('a mistake the player recovered from did not decide the game', () => {
  const ws = [50, 50, 55, 55, 55, 55, 30, 30, 30, 30, 60, 60, 60, 60, 35, 35, 20, 20, 10, 10, 5, 5];
  const g = withMistakes(game('white', ws), [{ p: 6, wb: 55, wa: 30 }, { p: 14, wb: 60, wa: 35 }]);
  ctx.markDecisive(g);
  eq(g.bl[0].d, 0, 'recovered'); eq(g.bl[1].d, 1, 'the real one');
});
test('in a draw, the win that slipped counts half', () => {
  const ws = [50, 50, 80, 80, 85, 85, 85, 85, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
  const g = withMistakes(game('white', ws, { res: 'draw' }), [{ p: 8, wb: 85, wa: 50 }]);
  ctx.markDecisive(g);
  eq(g.bl[0].d, 0.5, 'decided');
});
test('nothing decides a won game', () => {
  const g = withMistakes(game('white', [50, 50, 80, 80, 40, 40, 90, 90, 95, 95, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99], { res: 'win' }), [{ p: 4, wb: 80, wa: 40 }]);
  ctx.markDecisive(g);
  eq(g.bl[0].d, 0, 'decided');
});

test('in a loss, the biggest drop after which the player never got back to even is the one', () => {
  const ws = [50, 50, 48, 48, 45, 45, 45, 45, 44, 44, 20, 20, 20, 20, 15, 15, 10, 10, 5, 5, 5, 5];
  const g = withMistakes(game('white', ws), [{ p: 4, wb: 48, wa: 45 }, { p: 10, wb: 44, wa: 20 }]);
  ctx.markDecisive(g);
  eq(g.bl[1].d, 1, 'the big drop'); eq(g.bl[0].d, 0, 'the small one'); eq(g.bl[1].dw, 'lost', 'wording');
});
test('a turning point that left the player still close is not called "lost the game"', () => {
  const ws = [50, 50, 60, 60, 60, 60, 42, 42, 42, 42, 40, 40, 38, 38, 30, 30, 20, 20, 10, 10, 5, 5];
  const g = withMistakes(game('white', ws), [{ p: 6, wb: 60, wa: 42 }]);
  ctx.markDecisive(g);
  eq(g.bl[0].d, 1, 'decided'); eq(g.bl[0].dw, 'turn', 'wording');
});
/* ── the significance test behind every slice ───────────────────────────── */
function many(n, color, mistakeEvery) {
  /* games of 40 plies where the player drops 30 points once per game on a fraction of games */
  const out = [];
  for (let i = 0; i < n; i++) {
    const ws = [];
    const bad = (i % mistakeEvery) === 0;
    const at = color === 'white' ? 20 : 21;   /* the drop lands on the player's own move */
    for (let p = 0; p < 40; p++) ws.push(bad && p >= at ? (color === 'white' ? 20 : 80) : 50);
    out.push(game(color, ws));
  }
  return out;
}
test('a doubled mistake rate over enough games is a clear finding', () => {
  const A = many(40, 'black', 1), B = many(40, 'white', 2);
  const c = ctx.compareRates(A, B, ctx.gameMistakeList, 11, ctx.scoredMoves);
  eq(!!c && c.clear, true, 'clear');
});
test('equal rates are never a finding', () => {
  const A = many(40, 'black', 2), B = many(40, 'white', 2);
  const c = ctx.compareRates(A, B, ctx.gameMistakeList, 11, ctx.scoredMoves);
  eq(!!c && c.clear, false, 'clear');
});
test('fewer than 15 games on a side is not enough to say anything', () => {
  const c = ctx.compareRates(many(10, 'black', 1), many(40, 'white', 3), ctx.gameMistakeList, 11, ctx.scoredMoves);
  eq(c, null, 'result');
});
test('the test is repeatable: same data, same answer', () => {
  const A = many(30, 'black', 1), B = many(30, 'white', 3);
  const c1 = ctx.compareRates(A, B, ctx.gameMistakeList, 5, ctx.scoredMoves), c2 = ctx.compareRates(A, B, ctx.gameMistakeList, 5, ctx.scoredMoves);
  eq(c1.lo, c2.lo, 'lower bound');
});

console.log((failed ? 'FAIL ' : 'ok   ') + 'insight statistics: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
process.exit(failed ? 1 : 0);
