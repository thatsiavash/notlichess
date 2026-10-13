// Release 2, B1 on the real engine (by hand, not in `npm test`: about a minute of one Stockfish process):
// the page's own engine code (10-engine.js: enginePump, its fresh jobs) drives the repo's Stockfish 17.1,
// sf/stockfish.js run under Node as the page's one worker (nl:poolSize 1, a Worker class of the test's own:
// app-realm's opts.Worker). The mate card's key (184364964898:69) is made by the page's ensureFacts after 20
// other searches on that same worker (other positions, MultiPV 1 to 3, no fresh start), then again after 20
// more: both keys have Rg1+ with a mate in 11, as the fixture's key (made by the truth harness, a clean
// engine for every search) has it, and the two keys are the same.
//   node test/keys-real.js
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const makeApp = require('./app-realm');
const ROOT = path.join(__dirname, '..');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8'));
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'facts-fixture.json'), 'utf8'));
const MATE = '184364964898:69';

/* the page's worker: each message a UCI command to the process, each line it prints a message back */
class NodeWorker {
  constructor(url) {
    this.p = spawn(process.execPath, [path.join(ROOT, url)], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    this.p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line && this.onmessage) this.onmessage({ data: line });
      }
    });
    this.p.on('error', (e) => { if (this.onerror) this.onerror(e); });
  }
  postMessage(s) { this.p.stdin.write(s + '\n'); }
  terminate() { this.p.kill(); }
}

let failed = 0;
const ok = (c, what) => { console.log((c ? 'ok   ' : 'FAIL ') + what); if (!c) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* every card keyed but the mate card, so nothing else waits for a key */
  FIX.games.forEach((g) => (g.bl || []).forEach((b) => { const k = g.id + ':' + b.p; if (FACTS.cards[k] && k !== MATE) b.k = FACTS.cards[k]; }));
  const A = makeApp({ Worker: NodeWorker, keysOnly: true, storage: { 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'),
    'nl:games:cc:tester': JSON.stringify(FIX), 'nl:poolSize': '1' } });
  A.ev('(engineLoad(), 1)');
  for (let i = 0; i < 300 && A.ev('SF.state') !== 'ready'; i++) await wait(100);
  ok(A.ev('SF.state') === 'ready' && A.ev('SF.workers.length') === 1, 'the engine is up, one worker');
  /* other questions on the same worker: the other cards' positions, as a session's scan and tries ask them */
  const others = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(function (it) { return it.key !== '${MATE}' && it.g.mv && it.b.bu; }).map(function (it) { return stateFen(stateAtPly(it.g.mv, it.b.p)); }))`));
  let at = 0;
  const dirty = async () => {
    for (let n = 0; n < 20; n++, at++) {
      A.ev(`(window.__o = engineEval('${others[at % others.length]}', { nodes: ${60000 + (at % 5) * 20000} }, false, { multipv: ${1 + (at % 3)}, tag: 'other' }), 1)`);
      await A.ev('window.__o');
    }
  };
  const key = async () => {
    A.ev(`(function () { var it = itemOf('${MATE}'); delete it.b.k; delete it.b.kp; window.__k = ensureFacts(it, true); return 1; })()`);
    await A.ev('window.__k');
    return JSON.parse(A.ev(`JSON.stringify(itemOf('${MATE}').b.k || null)`));
  };
  const t0 = Date.now();
  await dirty();
  const k1 = await key();
  await dirty();
  const k2 = await key();
  const want = FACTS.cards[MATE];
  const sum = (k) => k ? JSON.stringify([k.a, k.l.map((l) => l.slice(0, 3)), k.fm]) : 'none';
  ok(!!k1 && k1.a === 'f1g1' && k1.l[0][2] === 11 && k1.fm === 11, 'after 20 other searches: Rg1+, mate in 11 (' + sum(k1) + ')');
  ok(sum(k1) === sum(want), 'the key\'s answer and lines are the fixture\'s, made on a clean engine each search (' + sum(want) + ')');
  ok(!!k2 && JSON.stringify(k2) === JSON.stringify(k1), 'the same card twice, 20 more searches between: the same key');
  console.log('in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  A.ev('(SF.workers.forEach(function (s) { s.w.terminate(); }), 1)');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
