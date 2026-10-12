// The truth audit's realm: a checkout's built page (its index.html, through its own test/app-realm.js)
// booted in Node with the fixture player, the clock at the fixture's day, and the checkout's Stockfish
// 17.1 behind the app's own engineEval (sf.js: a UCI pool with a cache, and appFormat, the app's result
// format), so every search the app asks for runs at its own budget (nodes, lines, searchmoves).
//   const R = require('./boot'); const A = await R.boot({ root, out, workers: 2, storage }); ... R.quit();
// The engine's cache is kept in the output folder per engine build (cache/js-<hash>.jsonl).
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const tick = () => new Promise((r) => setImmediate(r));

function engineHash(root) {
  const h = crypto.createHash('sha1');
  ['stockfish.js', 'stockfish.wasm'].forEach((f) => h.update(fs.readFileSync(path.join(root, 'sf', f))));
  return h.digest('hex').slice(0, 12);
}

/* the checkout's own pool when it has one (its engine), else this harness's */
function sfModule(root) {
  const own = path.join(root, 'test', 'truth', 'sf.js');
  return require(fs.existsSync(own) ? own : './sf');
}

/* --root and --out (and the rest) from argv: { root, out, flags..., _: [positional] } */
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
    } else o._.push(a);
  }
  o.root = path.resolve(o.root || path.join(__dirname, '..', '..'));
  if (o.out) o.out = path.resolve(o.out);
  return o;
}

let pool = null;
const jobs = [];
async function boot(o) {
  const root = path.resolve(o.root);
  /* the realm reads the checkout's own index.html */
  process.env.NL_HTML = path.join(root, 'index.html');
  const makeApp = require(path.join(root, 'test', 'app-realm'));
  const SF = sfModule(root);
  if (!pool && o.workers) {
    fs.mkdirSync(path.join(o.out, 'cache'), { recursive: true });
    pool = SF.makePool(o.workers, path.join(o.out, 'cache', 'js-' + engineHash(root) + '.jsonl'));
  }
  globalThis.__sfEval = function (fen, mt, opts) {
    opts = opts || {};
    const q = { multipv: opts.multipv || 1, searchmoves: opts.searchmoves || null };
    if (mt && typeof mt === 'object' && mt.nodes) q.nodes = mt.nodes; else q.movetime = +mt || 80;
    jobs.push({ fen, nodes: q.nodes, mpv: q.multipv, sm: q.searchmoves, tag: opts.tag || null });
    if (!pool) return new Promise(() => {});
    return pool.go(fen, q).then((r) => SF.appFormat(fen, r));
  };
  const storage = Object.assign({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom') }, o.storage || {});
  const A = makeApp({ now: o.now || T0, storage });
  /* the page's own engine fails to load in Node a few ticks after boot */
  for (let i = 0; i < 20; i++) await tick();
  if (o.engine === false) return A;
  /* the app's own engineEval, answered by the real engine; stop is a no-op (every search runs to its budget) */
  A.ev(`(function () {
    engineEval = function (fen, mt, prio, opts) { return __sfEval(fen, mt, opts || {}); };
    window.__stops = [];
    engineStop = function (tag) { window.__stops.push(tag); };
    SF.state = 'ready'; SF.build = 'sf17.1';
    return 1;
  })()`);
  return A;
}

function quit() { if (pool) pool.quit(); }

module.exports = { boot, args, T0, tick, jobs, pool: () => pool, quit, engineHash };
