// The fact sheets of the fixture's cards (V1.1), made by the app's own code (ensureFacts in
// 11-enrich.js) in the Node realm, with the repo's Stockfish 17.1 answering its searches at their own
// budgets (1,000,000 nodes, 120,000 for a line's extension, 250,000 for Hint 2's moves). Writes
// test/data/facts-fixture.json: { v: FACTS_V, nodes, cards: { key: b.k } } for every card the fixture
// holds (a key with x is one the deeper look does not confirm). Tests read the file to run on checked
// facts (test/cardflow.test.js); slice 2 of v2 builds its words on it.
//   node test/truth/facts.js [workers] [key ...]     (about 10 minutes on 3 workers)
//   NL_SF_CACHE=<file> keeps the engine's answers between runs
const fs = require('fs'), path = require('path');
const makeApp = require('../app-realm');
const { makePool, appFormat } = require('./sf');
const FIX = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixture-games.json'), 'utf8');
const OUT = path.join(__dirname, '..', 'data', 'facts-fixture.json');
const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  const args = process.argv.slice(2), workers = /^\d+$/.test(args[0] || '') ? +args.shift() : 3, only = args;
  const pool = makePool(workers, process.env.NL_SF_CACHE || null);
  const A = makeApp({ now: T0, storage: { 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': FIX } });
  /* the page's own engine fails to load in Node a few ticks after boot */
  for (let i = 0; i < 20; i++) await tick();
  globalThis.__sfEval = (fen, mt, opts) => {
    opts = opts || {};
    const o = { multipv: opts.multipv || 1, searchmoves: opts.searchmoves || null };
    if (mt && typeof mt === 'object' && mt.nodes) o.nodes = mt.nodes; else o.movetime = +mt || 80;
    return pool.go(fen, o).then((r) => appFormat(fen, r));
  };
  A.ev(`(function () { engineEval = function (fen, mt, prio, opts) { return __sfEval(fen, mt, opts || {}); }; SF.state = 'ready'; SF.build = 'sf17.1'; return 1; })()`);
  let keys = JSON.parse(A.ev('JSON.stringify(allMistakes().filter(function (it) { return it.g.mv && it.b.bu; }).map(function (it) { return it.key; }))'));
  if (only.length) keys = keys.filter((k) => only.indexOf(k) >= 0);
  console.log('cards', keys.length, 'workers', workers);
  const t0 = Date.now(), queue = keys.slice();
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) {
      const k = queue.shift(), v = 'window.__f_' + k.replace(/\W/g, '_');
      A.ev(v + ' = ensureFacts(itemOf(' + JSON.stringify(k) + '), false)');
      await A.ev(v);
      done++;
      if (done % 10 === 0) console.log(done, Math.round((Date.now() - t0) / 1000) + ' s', JSON.stringify(pool.stats()));
    }
  }));
  /* read from the games themselves: a card its key sets aside leaves the model */
  const cards = JSON.parse(A.ev(`JSON.stringify((function () { var out = {}, want = ${JSON.stringify(keys)};
    data.games.forEach(function (g) { (g.bl || []).forEach(function (b) { var k = g.id + ':' + b.p; if (b.k && want.indexOf(k) >= 0) out[k] = b.k; }); });
    return out; })())`));
  const prev = only.length && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).cards : {};
  const all = Object.assign({}, prev, cards), sorted = {};
  Object.keys(all).sort().forEach((k) => { sorted[k] = all[k]; });
  fs.writeFileSync(OUT, JSON.stringify({ v: A.ev('FACTS_V'), nodes: A.ev('FACTS_NODES'), cards: sorted }) + '\n');
  const n = Object.keys(cards).length, x = Object.keys(cards).filter((k) => cards[k].x);
  console.log('keys', n, 'of', keys.length, 'not confirmed', x.length, x.map((k) => k + ':' + cards[k].x).join(' '), 'in', Math.round((Date.now() - t0) / 1000) + ' s', JSON.stringify(pool.stats()));
  pool.quit();
  setTimeout(() => process.exit(0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
