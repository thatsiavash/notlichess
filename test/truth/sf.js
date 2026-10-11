// The repo's own Stockfish 17.1 (sf/stockfish.js, run as a UCI process under Node), as a small pool for
// the truth tools. go(fen, {nodes | movetime, multipv, searchmoves}) resolves to {best, depth, lines:
// [{cp, mate, pv, depth}]} with scores from the side to move, as UCI prints them. Each search starts
// with ucinewgame, so the same question always gets the same answer; an optional cache file (JSON
// lines) keeps the answers between runs. appFormat turns an answer into what the app's engineEval
// resolves to (10-engine.js): scores from White's side, cp clamped to +-1500, a mate as +-1500, pv
// cut at 12 plies, the deepest depth that reported every line.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', 'sf', 'stockfish.js');

function makeWorker() {
  const p = spawn(process.execPath, [ENGINE], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', onLine = null;
  p.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (onLine) onLine(line);
    }
  });
  p.stderr.on('data', () => {});
  const send = (s) => p.stdin.write(s + '\n');
  const until = (pred, each) => new Promise((res) => {
    onLine = (l) => { if (each) each(l); if (pred(l)) { onLine = null; res(l); } };
  });
  const ready = (async () => {
    const w = until((l) => l === 'uciok'); send('uci'); await w;
    send('setoption name Threads value 1'); send('setoption name Hash value 32');
    const r = until((l) => l === 'readyok'); send('isready'); await r;
  })();
  let mpv = 1;
  return {
    busy: false,
    async go(fen, o) {
      await ready;
      if ((o.multipv || 1) !== mpv) { mpv = o.multipv || 1; send('setoption name MultiPV value ' + mpv); }
      send('ucinewgame');
      const r = until((l) => l === 'readyok'); send('isready'); await r;
      send('position fen ' + fen);
      const byDepth = {}, latest = {};
      const done = until((l) => /^bestmove/.test(l), (l) => {
        if (l.indexOf('info ') !== 0 || l.indexOf(' score ') < 0 || / (lowerbound|upperbound) /.test(l)) return;
        if (l.indexOf(' pv ') < 0 && l.indexOf('score mate 0') < 0) return;
        const k = +((/ multipv (\d+)/.exec(l) || [0, 1])[1]), d = +((/ depth (\d+)/.exec(l) || [0, 0])[1]);
        const sc = / score (cp|mate) (-?\d+)/.exec(l), pv = / pv (.+)$/.exec(l);
        const x = { depth: d, cp: sc[1] === 'cp' ? +sc[2] : null, mate: sc[1] === 'mate' ? +sc[2] : null, pv: pv ? pv[1].trim().split(/\s+/) : [] };
        latest[k] = x;
        (byDepth[d] = byDepth[d] || {})[k] = x;
      });
      send((o.nodes ? 'go nodes ' + o.nodes : 'go movetime ' + (o.movetime || 100)) + (o.searchmoves && o.searchmoves.length ? ' searchmoves ' + o.searchmoves.join(' ') : ''));
      const bm = await done;
      const want = Object.keys(latest).length;
      let blk = latest, depth = 0;
      Object.keys(byDepth).map(Number).sort((a, b) => b - a).some((d) => { if (Object.keys(byDepth[d]).length >= want) { blk = byDepth[d]; depth = d; return true; } return false; });
      const raw = latest[1] ? [latest[1]] : [];
      Object.keys(blk).sort((a, b) => a - b).forEach((k) => raw.push(blk[k]));
      const seen = {}, lines = raw.filter((x) => { const f = x.pv[0] || ''; if (seen[f]) return false; seen[f] = 1; return true; });
      return { best: bm.split(' ')[1], depth: latest[1] ? latest[1].depth : depth, lines };
    },
    quit() { try { send('quit'); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 300); },
  };
}

function makePool(n, cacheFile) {
  const workers = [];
  for (let i = 0; i < (n || 2); i++) workers.push(makeWorker());
  const cache = new Map();
  if (cacheFile && fs.existsSync(cacheFile)) fs.readFileSync(cacheFile, 'utf8').split('\n').forEach((l) => { if (!l) return; try { const x = JSON.parse(l); cache.set(x.k, x.v); } catch (e) {} });
  const out = cacheFile ? fs.createWriteStream(cacheFile, { flags: 'a' }) : null;
  const queue = [], inflight = new Map();
  let hits = 0, runs = 0;
  const pump = () => {
    workers.forEach((w) => {
      if (w.busy || !queue.length) return;
      const job = queue.shift();
      w.busy = true;
      w.go(job.fen, job.o).then((r) => {
        w.busy = false; runs++;
        cache.set(job.k, r);
        if (out) out.write(JSON.stringify({ k: job.k, v: r }) + '\n');
        job.res(r); pump();
      }, (e) => { w.busy = false; job.rej(e); pump(); });
    });
  };
  const keyOf = (fen, o) => [fen, o.nodes || ('t' + (o.movetime || 100)), o.multipv || 1, (o.searchmoves || []).join(',')].join('|');
  return {
    go(fen, o) {
      o = o || {};
      const k = keyOf(fen, o);
      if (cache.has(k)) { hits++; return Promise.resolve(cache.get(k)); }
      if (inflight.has(k)) return inflight.get(k);
      const p = new Promise((res, rej) => { queue.push({ fen, o, k, res, rej }); pump(); });
      inflight.set(k, p);
      p.then(() => inflight.delete(k), () => inflight.delete(k));
      return p;
    },
    stats() { return { hits, runs, queued: queue.length }; },
    quit() { workers.forEach((w) => w.quit()); if (out) out.end(); },
  };
}

function appFormat(fen, r) {
  const flip = fen.split(' ')[1] !== 'w';
  const lines = r.lines.map((x) => {
    let cp, mate = x.mate;
    if (mate != null) cp = mate > 0 ? 1500 : -1500; else cp = Math.max(-1500, Math.min(1500, x.cp));
    if (flip) { cp = -cp; if (mate != null) mate = -mate; }
    if (mate === 0) mate = null;
    return { cp, mate, pv: x.pv.slice(0, 12) };
  });
  const best = r.best && r.best !== '(none)' ? r.best : null;
  if (best && lines.length && lines[0].pv[0] !== best) {
    let bi = -1;
    lines.forEach((l, i) => { if (bi === -1 && l.pv[0] === best) bi = i; });
    if (bi > 0) lines.unshift(lines.splice(bi, 1)[0]);
    else lines[0] = { cp: lines[0].cp, mate: lines[0].mate, pv: [best] };
  }
  const top = lines[0] || { cp: 0, mate: null, pv: [] };
  return { cp: top.cp, mate: top.mate, bestUci: best, pv: top.pv, lines, depth: r.depth, stopped: false };
}

module.exports = { makePool, appFormat };
