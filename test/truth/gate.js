// Release gate 1 (truth): the truth audit of every chess claim on screen, run on a checkout and checked
// against the gate's rule. For each pass it dumps every frame (the app's own code in the Node realm, the
// checkout's Stockfish answering the app's searches), checks every claim on the board it is said on
// (python-chess and the same Stockfish, 1,000,000 nodes), rechecks only what that flags at 4,000,000 and
// then 8,000,000 nodes, applies the reviewed adjudications and prints the summary (summary.txt).
//   node test/truth/gate.js --out DIR                    every pass: engine up, engine down, practice
//   node test/truth/gate.js --out DIR --pass live        one pass (live, stored or practice; or a list)
//   node test/truth/gate.js --out DIR --summary          the summary again, from what DIR holds
// Options: --root DIR (the checkout audited; default this one), --workers N (Stockfish processes, default
// 2), --keys k1,k2 (only these cards, foil:<key> foils and pk:<id> positions: a partial run, never a gate
// verdict), --nodes N (the first pass, default 1000000), --recheck N,M (default 4000000,8000000), --from
// prep|dump|verify|recheck (reuse what DIR already holds before that step), --until dump|verify|recheck
// (stop after it), --fresh (forget the engine caches in DIR).
// DIR must be outside the repo: the dumps run to tens of MB and are never committed. Exit 0 when the gate
// passes, 1 when it fails or the run is partial. See test/truth/README.md.
const fs = require('fs'), path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const R = require('./boot');

const o = R.args(process.argv.slice(2));
const ROOT = fs.realpathSync(o.root), HERE = __dirname;
const usage = () => { console.error('usage: node test/truth/gate.js --out DIR [--root DIR] [--pass live,stored,practice] [--workers 2] [--keys k1,k2] [--from step] [--until step] [--summary]'); process.exit(2); };
if (!o.out || o.out === true) usage();
const OUT = o.out;
const inside = (a, b) => { const r = path.relative(b, a); return !r.startsWith('..') && !path.isAbsolute(r); };
/* a path's real form, through its nearest existing folder (the output folder may not exist yet) */
const realish = (p) => { let d = path.resolve(p), rest = []; while (!fs.existsSync(d)) { rest.unshift(path.basename(d)); d = path.dirname(d); } return path.join(fs.realpathSync(d), ...rest); };
const OUTR = realish(OUT);
const repoOf = (d) => { try { return execFileSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; } };
[ROOT, repoOf(ROOT), repoOf(HERE)].filter(Boolean).forEach((d) => {
  if (inside(OUTR, fs.realpathSync(d))) { console.error('--out ' + OUTR + ' is inside ' + d + ': put the output outside the repo'); process.exit(2); }
});
fs.mkdirSync(OUT, { recursive: true });

const PASSES = ['live', 'stored', 'practice'];
const passes = !o.pass || o.pass === true || o.pass === 'all' ? PASSES : String(o.pass).split(',');
passes.forEach((p) => { if (PASSES.indexOf(p) < 0) usage(); });
const workers = String(+(o.workers || 2));
const nodes = String(+(o.nodes || 1000000));
const rechecks = String(o.recheck || '4000000,8000000').split(',').filter(Boolean).map((x) => String(+x));
const keys = typeof o.keys === 'string' ? o.keys : '';
/* --keys: card keys (and foil:<key>) for the card passes, pk:<id> for practice */
const keysFor = (p) => keys.split(',').filter((k) => k && (p === 'practice') === /^(pk|ls):/.test(k));
const STEPS = ['prep', 'dump', 'verify', 'recheck', 'summary'];
const from = o.summary ? 'summary' : (o.from || 'prep'), until = o.until || 'summary';
if (STEPS.indexOf(from) < 0 || STEPS.indexOf(until) < 0) usage();
const doStep = (s) => STEPS.indexOf(s) >= STEPS.indexOf(from) && STEPS.indexOf(s) <= STEPS.indexOf(until);

/* the run's record: what was audited and how, each step's time (the summary prints it) */
const RUN = path.join(OUT, 'run.json');
const run = fs.existsSync(RUN) ? JSON.parse(fs.readFileSync(RUN, 'utf8')) : { passes: {}, steps: [] };
const git = (args) => { try { return execFileSync('git', ['-C', ROOT].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; } };
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
const index = sha(path.join(ROOT, 'index.html'));
if (doStep('prep') && run.index && run.index !== index) {
  /* a new build: what DIR holds from the last one no longer applies (the engine caches stay) */
  console.log('a new build (index.html ' + index + ', was ' + run.index + '): the last run\'s dumps and results in ' + OUT + ' are cleared');
  fs.readdirSync(OUT).filter((f) => /^(dump|results|deep|final|aria|unread)-|^(pracworks\.json|screens-recount\.|summary\.txt|enriched\.json|prep\.json|pdata\.json)/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  run.passes = {}; run.steps = [];
}
if (doStep('prep') || !run.root) {
  Object.assign(run, {
    root: ROOT, commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain', '--', 'src', 'test', 'index.html', 'sf']),
    index, engine: R.engineHash(ROOT), harness: HERE, nodes: +nodes,
  });
}
const save = () => fs.writeFileSync(RUN, JSON.stringify(run, null, 1) + '\n');
save();

function step(name, cmd, args) {
  const t0 = Date.now();
  console.log('\n== ' + name + ': ' + [cmd].concat(args).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
  const secs = Math.round((Date.now() - t0) / 1000);
  run.steps.push({ step: name, secs, exit: r.status, at: new Date().toISOString() });
  save();
  console.log('== ' + name + ' took ' + secs + ' s' + (r.status ? ', exit ' + r.status : ''));
  if (r.status) { console.error('step failed: ' + name); process.exit(1); }
}

const node = process.execPath, py = 'python3';
process.env.PYTHONDONTWRITEBYTECODE = '1';
const common = ['--root', ROOT, '--out', OUT];
const keyArg = (p) => (keys ? ['--keys', keysFor(p).join(',') || 'none'] : []);

if (o.fresh) {
  const c = path.join(OUT, 'cache');
  if (fs.existsSync(c)) fs.readdirSync(c).filter((f) => f.indexOf(run.engine) >= 0).forEach((f) => fs.renameSync(path.join(c, f), path.join(c, f + '.' + Date.now() + '.old')));
}
if (doStep('prep')) step('prep', node, [path.join(HERE, 'prep.js')].concat(common));
for (const p of passes) {
  if (doStep('dump')) {
    if (p === 'practice') step('practice dump', node, [path.join(HERE, 'screens.js')].concat(common, keys ? ['--ids', keysFor(p).map((k) => k.replace(/^pk:/, '')).join(',') || 'none'] : []));
    else for (const m of [p, p + '-game']) step(m + ' dump', node, [path.join(HERE, 'dump.js'), m].concat(common, ['--workers', workers], keyArg(p)));
    step(p + ' board descriptions', py, [path.join(HERE, 'py', 'aria.py'), '--pass', p].concat(common, keyArg(p)));
    if (p === 'practice') step('summary and Insights recount', py, [path.join(HERE, 'py', 'screens.py')].concat(common));
  }
  if (doStep('verify')) {
    step(p + ' first pass', py, [path.join(HERE, 'py', 'verify.py'), '--pass', p, '--nodes', nodes, '--threads', workers].concat(common, keyArg(p)));
    run.passes[p] = { nodes: +nodes, rechecks: [], keys: keys ? keysFor(p).join(',') || 'none' : null, at: new Date().toISOString() };
    save();
  }
  if (doStep('recheck')) {
    for (const n of rechecks) {
      step(p + ' recheck at ' + n, py, [path.join(HERE, 'py', 'recheck.py'), '--pass', p, '--nodes', n, '--threads', workers].concat(common, keyArg(p)));
      run.passes[p] = run.passes[p] || { nodes: +nodes, rechecks: [], keys: keys ? keysFor(p).join(',') || 'none' : null };
      if (run.passes[p].rechecks.indexOf(+n) < 0) run.passes[p].rechecks.push(+n);
      save();
    }
    if (p === 'practice' && !keys) step('practice accepted moves', py, [path.join(HERE, 'py', 'pracworks.py'), '--nodes', nodes, '--deep', rechecks[rechecks.length - 1] || '8000000', '--threads', workers].concat(common));
  }
}
if (!doStep('summary')) process.exit(0);
const s = spawnSync(py, [path.join(HERE, 'py', 'summary.py')].concat(common), { stdio: 'inherit', cwd: ROOT });
process.exit(s.status === 0 ? 0 : 1);
