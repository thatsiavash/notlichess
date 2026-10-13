// Keys as browsers make them (release 2's C5 (h)): every fixture card's fact sheet built by the
// checkout's own factsCompute, through the page's own engine code (engineEval, enginePump) and a
// browser worker (worker.js) that has run other searches first, as a player's browser builds it. The
// gate's other passes deal the committed fixture's keys (prep.js), made on a clean engine; this pass
// asks whether the key a player's browser makes is the same answer. py/keys.py then checks each key
// against an 8,000,000-node 3-line search (a missing forced mate, or an answer more than 4 points
// below the deep best, fails).
//   node test/truth/keys.js --out DIR [--root DIR] [--workers 2] [--keys k1,k2]
// Each worker is a realm of its own (one browser worker each, so its searches run in a fixed order and
// the run is repeatable); it warms up on one card's key, then builds its share in fixture order.
// Then each seed of seeds.json with a warm list: its card's key built on a fresh browser worker after
// the keys of the cards in warm (dump.js live-seeds deals that key, C5 (i)).
// Writes DIR/keys-built.json. Keys cost about 7 s a card: they are kept in DIR/cache per build
// (index.html), engine and fixture (the main pass in one file, each seed's recipe in its own).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = require('./boot'), W = require('./worker');

const o = R.args(process.argv.slice(2));
if (!o.out) { console.error('usage: node test/truth/keys.js --out DIR [--root DIR] [--workers 2]'); process.exit(2); }
const n = Math.max(1, Math.min(2, +(o.workers || 2)));
const only = typeof o.keys === 'string' ? o.keys.split(',').filter((k) => k && !/^(pk|ls|foil):/.test(k)) : [];
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
/* the order of the main pass: a new order is a new cache */
const ORDER = 'v1: worker i warms up on the card n-1-i of the list, then builds cards i, i+n, ... in fixture order';

(async () => {
  const FIX = fs.readFileSync(path.join(o.root, 'test', 'data', 'fixture-games.json'), 'utf8');
  const index = sha(fs.readFileSync(path.join(o.root, 'index.html'))), engine = R.engineHash(o.root);
  const SEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds.json'), 'utf8')).seeds.filter((s) => s.warm && s.warm.length);
  const base = 'keys-' + index + '-' + engine + '-' + sha(FIX);
  const cacheDir = path.join(o.out, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const mainFile = path.join(cacheDir, base + '-' + sha(ORDER) + '.json');
  const seedFile = (sd) => path.join(cacheDir, base + '-seed-' + sha(JSON.stringify([sd.key, sd.warm])) + '.json');
  const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const realms = [];
  for (let i = 0; i < n; i++) {
    const A = await R.boot({ root: o.root, out: o.out, workers: 0, engine: false, storage: { 'nl:games:cc:tester': FIX, 'nl:poolSize': '1' } });
    realms.push(A);
  }
  const all = JSON.parse(realms[0].ev('JSON.stringify(allMistakes().filter(function (it) { return it.g.mv && it.b.bu; }).map(function (it) { return it.key; }))'));
  const keys = only.length ? all.filter((k) => only.indexOf(k) >= 0) : all;
  const info = (A, k) => JSON.parse(A.ev(`(function () { var it = itemOf(${JSON.stringify(k)}), pre = stateAtPly(it.g.mv, it.b.p);
    return JSON.stringify({ pre: stateFen(pre), white: it.g.color === 'white', played: uciOfSan(it.g.mv, it.b.p) }); })()`));
  /* one realm's browser worker, fresh; build(k) makes card k's key on it */
  const install = async (A, i) => {
    const w = await W.browserWorker(o.root);
    globalThis['__kw' + i] = w;
    A.ev(`(function () { SF.workers = [{ w: __kw${i} }]; SF.queue = []; SF.state = 'ready'; SF.loading = null; SF.code = { url: 'sf/stockfish.js' }; SF.build = 'sf17.1'; return 1; })()`);
    const build = async (k) => {
      const from = w.log.length, t1 = Date.now();
      A.ev(`window.__kp = factsCompute(itemOf(${JSON.stringify(k)}), false).then(function (k) { window.__kr = k; return 1; }, function (e) { window.__kr = { err: String(e && (e.message || JSON.stringify(e))) }; return 0; }); 1`);
      await A.ev('window.__kp');
      const kr = JSON.parse(A.ev('JSON.stringify(window.__kr === undefined ? null : window.__kr)'));
      return { k: kr, secs: Math.round((Date.now() - t1) / 100) / 10, posted: w.log.length - from, first: w.log.slice(from, from + 6) };
    };
    return { w, build };
  };
  const t0 = Date.now();
  let out = read(mainFile);
  if (out && keys.every((k) => out.cards[k])) console.log('keys as browsers make them: from the cache', path.basename(mainFile));
  else {
    out = { root: o.root, index, engine, factsV: realms[0].ev('typeof FACTS_V === "undefined" ? null : FACTS_V'), workers: n, order: ORDER, cards: {}, warm: {} };
    await Promise.all(realms.map(async (A, i) => {
      const { w, build } = await install(A, i);
      /* a worker that has run other searches first: one card's key from the other end of the list */
      const list = only.length ? all : keys, warm = list[list.length - 1 - i];
      out.warm[i] = warm;
      await build(warm);
      for (const k of keys.filter((x, j) => j % n === i)) {
        const r = await build(k);
        out.cards[k] = Object.assign(info(A, k), r, { worker: i });
        console.log('key', k, 'worker', i, r.secs + ' s', r.k && r.k.a, r.k && r.k.x ? 'x:' + r.k.x : '', r.k && r.k.err ? r.k.err : '');
      }
      w.terminate();
    }));
    out.secs = Math.round((Date.now() - t0) / 1000);
    if (!only.length) fs.writeFileSync(mainFile, JSON.stringify(out) + '\n');
  }
  /* the seeds' keys: each on a fresh worker, after its warm list */
  out.seeds = {};
  const todo = SEEDS.filter((sd) => !only.length || only.indexOf(sd.key) >= 0);
  await Promise.all(realms.map(async (A, i) => {
    for (const sd of todo.filter((x, j) => j % n === i)) {
      let got = read(seedFile(sd));
      if (!got) {
        const { w, build } = await install(A, i);
        for (const k of sd.warm) await build(k);
        const r = await build(sd.key);
        w.terminate();
        got = Object.assign(info(A, sd.key), r, { warm: sd.warm, ids: sd.ids });
        fs.writeFileSync(seedFile(sd), JSON.stringify(got) + '\n');
      }
      out.seeds[sd.key] = got;
      console.log('seed', sd.ids.join(','), sd.key, 'after', sd.warm.join(' '), got.k && got.k.a, got.k && got.k.x ? 'x:' + got.k.x : '');
    }
  }));
  fs.writeFileSync(path.join(o.out, 'keys-built.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('keys built', Object.keys(out.cards).length, 'and', Object.keys(out.seeds).length, 'seeds, in', Math.round((Date.now() - t0) / 1000), 's');
  setTimeout(() => process.exit(0), 400);
})().catch((e) => { console.error(e); process.exit(1); });
