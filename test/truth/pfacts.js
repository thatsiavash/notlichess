// node test/truth/pfacts.js [--write] [--only id,id] [--workers 2] [--nodes 8000000] [--try-nodes 1000000] [--cache file]
//
// The practice facts (V3.1), computed once and shipped in src/js/12p-pdata.js, so that no practice claim
// reads a live search. For every practice position, with the repo's own Stockfish 17.1 under Node
// (sf/stockfish.js, one thread a worker) and the app's own chess code (the built page in the Node realm,
// test/app-realm.js: run python3 build.py first):
//   1. the best move at 8,000,000 nodes (8 lines), and the moves within 4 points of it (accepted) and
//      within 10 (close), as win chances on the app's curve, each move near it graded as a try is: side by
//      side with the best (2 lines, searchmoves; each alone when a line is left out) at 1,000,000 nodes,
//      again at 8,000,000 from 2.5 to 11.5 points below (to 25 when the best mates); a mate in one or a
//      back-rank mate accepts exactly its mates;
//   2. each miss's settled line (Stockfish's line after the try, extended as extendLine does, read by
//      settleLine, a copy of V1.1's contract until the merge) and its event: the capture reasons whose
//      loss stands where the line settles and still stands where it ends are kept (row 8);
//   3. the defender's mates in two after a miss, each checked move by move on the app's move generator
//      (row 9);
//   4. Hint 2's case for the circled piece when Hint 1 rings it as attacked: every safe square of it an
//      accepted move, one or several (S: "Find a safe square.", the orchestrator's call after slice 3, so a
//      hint never invites a rejected move); else V2.3's ladder, one move of it that holds (O) (row 10).
// Decisions within a point of their line are searched again at 8,000,000 nodes. Without --write it
// prints what would change. Every search is cached (--cache, by default in the system's temp folder), so
// a rerun searches only what changed.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'src', 'js', '12p-pdata.js');
const ENGINE = path.join(ROOT, 'sf', 'stockfish.js');

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]);
  if (!m) continue;
  opt[m[1]] = m[2] != null ? m[2] : argv[i + 1] && !/^--/.test(argv[i + 1]) ? argv[++i] : true;
}
const NODES = +opt.nodes || 8000000, TRY_NODES = +opt['try-nodes'] || 1000000, EXT_NODES = 120000;
const WORKERS = +opt.workers || 2, CACHE = opt.cache || path.join(os.tmpdir(), 'nl-pfacts-cache.jsonl');
const ONLY = opt.only ? String(opt.only).split(',') : null;

/* ── the engine: a pool of Stockfish workers with a disk cache ──
   go(fen, nodes, multipv, searchmoves) -> { lines: [{ cp, mate, pv }] } from the side to move, best
   first, each line from the deepest depth that reported every line (bounds skipped), as the app reads
   them; every search starts with ucinewgame, so the same question always gets the same answer */
const cache = {};
if (fs.existsSync(CACHE)) fs.readFileSync(CACHE, 'utf8').split('\n').forEach((l) => { try { const x = JSON.parse(l); cache[x.k] = x.v; } catch (e) { /* a torn line */ } });
const cacheOut = fs.createWriteStream(CACHE, { flags: 'a' });
function worker() {
  const p = spawn(process.execPath, [ENGINE], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', on = null;
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (on) on(l); }
  });
  p.stderr.on('data', () => {});
  const send = (s) => p.stdin.write(s + '\n');
  const until = (pred, each) => new Promise((res) => { on = (l) => { if (each) each(l); if (pred(l)) { on = null; res(l); } }; });
  let mpv = 1;
  const ready = (async () => {
    const w = until((l) => l === 'uciok'); send('uci'); await w;
    send('setoption name Threads value 1'); send('setoption name Hash value 64');
    const r = until((l) => l === 'readyok'); send('isready'); await r;
  })();
  return {
    async go(fen, nodes, multipv, sm) {
      await ready;
      if (multipv !== mpv) { mpv = multipv; send('setoption name MultiPV value ' + mpv); }
      send('ucinewgame');
      const r = until((l) => l === 'readyok'); send('isready'); await r;
      send('position fen ' + fen);
      const byDepth = {}, latest = {};
      const done = until((l) => /^bestmove/.test(l), (l) => {
        if (l.indexOf('info ') !== 0 || l.indexOf(' score ') < 0 || / (lowerbound|upperbound) /.test(l)) return;
        if (l.indexOf(' pv ') < 0) return;
        const k = +((/ multipv (\d+)/.exec(l) || [0, 1])[1]), d = +((/ depth (\d+)/.exec(l) || [0, 0])[1]);
        const sc = / score (cp|mate) (-?\d+)/.exec(l), pv = / pv (.+)$/.exec(l);
        const x = { cp: sc[1] === 'cp' ? +sc[2] : null, mate: sc[1] === 'mate' ? +sc[2] : null, pv: pv[1].trim().split(/\s+/), depth: d };
        latest[k] = x;
        (byDepth[d] = byDepth[d] || {})[k] = x;
      });
      send('go nodes ' + nodes + (sm && sm.length ? ' searchmoves ' + sm.join(' ') : ''));
      await done;
      const want = Object.keys(latest).length;
      let blk = latest;
      Object.keys(byDepth).map(Number).sort((a, b) => b - a).some((d) => { if (Object.keys(byDepth[d]).length >= want) { blk = byDepth[d]; return true; } return false; });
      const seen = {}, lines = Object.keys(blk).sort((a, b) => a - b).map((k) => blk[k]).filter((x) => { if (seen[x.pv[0]]) return false; seen[x.pv[0]] = 1; return true; });
      return { lines };
    },
    quit() { try { send('quit'); } catch (e) { /* gone */ } setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, 200); },
  };
}
const pool = [], queue = [];
let searched = 0, hits = 0;
function pump() {
  pool.forEach((w) => {
    if (w.busy || !queue.length) return;
    const job = queue.shift();
    w.busy = true;
    w.e.go(job.fen, job.nodes, job.mpv, job.sm).then((r) => {
      w.busy = false;
      cache[job.k] = r;
      cacheOut.write(JSON.stringify({ k: job.k, v: r }) + '\n');
      searched++;
      job.res(r);
      pump();
    });
  });
}
function go(fen, nodes, mpv, sm) {
  const k = [fen, nodes, mpv || 1, (sm || []).join(',')].join('|');
  if (cache[k]) { hits++; return Promise.resolve(cache[k]); }
  return new Promise((res) => { queue.push({ fen, nodes, mpv: mpv || 1, sm, k, res }); pump(); });
}

/* ── the app's own chess code, from the built page ── */
const makeApp = require(path.join(ROOT, 'test', 'app-realm.js'));
const A = makeApp({ now: Date.UTC(2026, 8, 28, 14, 0, 0), storage: { 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom') } });
A.ev(`(function () {
  var PF = window.PF = {};
  var st = function (fen) { return stateFromFen(fen); };
  var after = function (s, u) { var x = cloneState(s), m = uciToMove(x, u); if (!m) return null; applyMove(x, m); return x; };
  PF.legal = function (fen) { return legalMoves(st(fen)).map(moveUci); };
  PF.mates = function (fen) { var s = st(fen); return legalMoves(s).filter(function (m) { var x = cloneState(s); applyMove(x, m); return isMate(x); }).map(moveUci); };
  PF.play = function (fen, ucis) { var s = st(fen); for (var i = 0; i < ucis.length; i++) { var x = after(s, ucis[i]); if (!x) return null; s = x; } return stateFen(s); };
  PF.over = function (fen) { return !legalMoves(st(fen)).length; };
  PF.win = function (cp) { return winPct(cp); };
  PF.step = function (w) { return scaleStep(w); };
  PF.san = function (fen, u) { var s = st(fen), m = uciToMove(s, u); return m ? sanOf(s, m) : u; };
  PF.claim = function (fen, u, sk) { var s = st(fen); return pracClaim(s, uciToMove(s, u), sk); };
  /* the capture the app names after a try (pracCapture, the same as pracWhy): uci and the piece it takes */
  PF.pick = function (fen, u) { var s = st(fen), x = after(s, u); if (!x) return null; var r = pracCapture(x, !!s.w); return r ? { u: moveUci(r), v: MOTIF_VAL[pType(x.b[r.to])] } : null; };
  /* the value of the piece of the player's (me) a reply takes, en passant too; 0 for none */
  PF.takes = function (fen, r, me) { var s = st(fen), m = uciToMove(s, r); if (!m) return 0; var t = m.ep >= 0 ? s.b[m.ep] : s.b[m.to]; return t && colorW(t) === me && pType(t) !== 'K' ? MOTIF_VAL[pType(t)] : 0; };
  /* after their move d, every reply of the side to move lets them mate in one: a mate in two */
  PF.mate2 = function (fen, d) {
    var s = after(st(fen), d);
    if (!s) return false;
    var rs = legalMoves(s);
    if (!rs.length) return false;
    return rs.every(function (r) { var x = cloneState(s); applyMove(x, r); return legalMoves(x).some(function (m) { var y = cloneState(x); applyMove(y, m); return isMate(y); }); });
  };
  /* settleLine(state, moves): V1.1's contract (slice 1 owns the shared one; this is a copy until the
     merge): play the line until material is unchanged for two plies (the app's settle rule: two plies
     with no capture, promotion or check, and nothing left en prise), or mate, at most 12 plies. It
     returns the settle ply, the net material for each side (its change since the start), and the first
     decisive event, in this order: mate, promotion, a fork or pin the motif code finds by that ply, a
     capture after the first, net material. Here also: the player's net at each settled point, and
     whether the line settled before its end */
  PF.settleLine = function (fen, moves, me) {
    var s0 = st(fen), line = buildLine(s0, moves[0], moves.slice(1, 12), !me);
    if (!line) return null;
    var n = line.nodes, k = settleIndex(line), mat = function (b, w) { return sideMaterial(b, w); };
    var net = function (i) { var b = n[i].after.b; return { w: mat(b, true) - mat(s0.b, true), b: mat(b, false) - mat(s0.b, false) }; };
    var mine = function (i) { var x = net(i); return me ? x.w - x.b : x.b - x.w; };
    var ev = null, mateAt = -1;
    n.forEach(function (x, i) { if (mateAt < 0 && isMate(x.after)) mateAt = i; });
    if (mateAt >= 0) { ev = { kind: 'mate', ply: mateAt + 1, by: n[mateAt].byWhite === me ? 'me' : 'them' }; k = mateAt; }
    for (var i = 0; !ev && i <= k; i++) if (n[i].move && n[i].move.promo) ev = { kind: 'promo', ply: i + 1, by: n[i].byWhite === me ? 'me' : 'them' };
    if (!ev) { var f = mFork(line), p = mPin(line); if (f && f.ply <= k) ev = { kind: 'fork', ply: f.ply + 1 }; else if (p && p.ply <= k) ev = { kind: 'pin', ply: p.ply + 1 }; }
    if (!ev) for (var j = 2; !ev && j <= k; j++) if (n[j].captured && n[j].byWhite !== me) ev = { kind: 'capture', ply: j + 1 };
    if (!ev) ev = { kind: 'net', me: mine(k) };
    /* every settled point: the side to move not in check, and the next two plies of the line take nothing
       and promote nothing (as far as the line goes) */
    var pts = [];
    for (var q = 0; q < n.length; q++) {
      if (checkersOf(n[q].after).length) continue;
      var quiet = true;
      for (var z = q + 1; z <= q + 2 && z < n.length; z++) if (n[z].captured || n[z].move.promo) quiet = false;
      if (quiet) pts.push([q + 1, mine(q)]);
    }
    return { ply: k + 1, net: net(k), me: mine(k), event: ev, settled: !line.unsettled, plies: n.length, pts: pts, last: pts.length ? pts[pts.length - 1][1] : mine(n.length - 1) };
  };
  /* Hint 2's piece (the answer's), whether Hint 1 rings it as attacked, and the squares it can go to that lose it by the
     static exchange or let them mate in one (loseSquares, F9.2) */
  PF.circled = function (fen, ans, skill) {
    var s = st(fen), m = uciToMove(s, ans), me = !!s.w;
    if (!m) return null;
    /* V2.3 reads Hint 1's piece: on a practice card, the piece its danger hint rings as attacked
       (pracDanger, Piece safety and Stop the mate), here the circled one */
    var pd = pracDanger({ pre: s, best: m, it: { skill: skill, g: { color: me ? 'white' : 'black' } } });
    var at = !!pd && pd.kind === 'attacked' && pd.rings.some(function (r) { return r.sq === m.from && r.kind === 'attacked'; }), ls = loseSquares(s, m.from);
    var moves = legalMoves(s).filter(function (x) { return x.from === m.from; }).map(function (x) { return { u: moveUci(x), red: ls.red.indexOf(x.to) >= 0, to: x.to }; });
    return { attacked: at, from: m.from, piece: pType(s.b[m.from]), moves: moves };
  };
  /* the piece the line's first move moves is still on the board by ply k (followed as it moves on) */
  PF.survives = function (fen, moves, k) {
    var s = st(fen), m = uciToMove(s, moves[0]);
    if (!m) return false;
    var sq = m.to;
    applyMove(s, m);
    for (var i = 1; i < Math.min(k, moves.length); i++) {
      var x = uciToMove(s, moves[i]);
      if (!x) break;
      if (x.to === sq && x.from !== sq) return false;
      if (x.from === sq) sq = x.to;
      applyMove(s, x);
    }
    return true;
  };
  /* the rung the app's own pracWhy reaches for try u with no facts: task, guarded, mate and promo are
     read on the board and need none */
  PF.rung = function (fen, skill, ans, u) {
    var s = st(fen), it = { skill: skill, caps: {}, mates: {}, g: { color: s.w ? 'white' : 'black' } };
    var a = { it: it, pre: s, best: uciToMove(s, ans), tier: 2 };
    return pracWhy(a, uciToMove(s, u)).kind;
  };
  return 1;
})()`);
const R = (fn, ...a) => JSON.parse(A.ev('JSON.stringify(window.PF.' + fn + '(' + a.map((x) => JSON.stringify(x)).join(', ') + '))'));

/* ── the rows of 12p-pdata.js ── */
const src = fs.readFileSync(DATA, 'utf8');
const rows = [];
src.replace(/^ '([^']+)'/mg, (all, row) => {
  const f = row.split('|');
  rows.push({ row, id: f[0], skill: f[1], src: f[2], band: f[3], fen: f[4], ok: f[5] ? f[5].split(',') : [], cl: f[6] ? f[6].split(',') : [] });
  return all;
});
const MATE_SKILL = { mate1: 1, backrank: 1 };

/* win chance of a line for the side to move (a mate: 100 or 0) */
const win = (l) => (l.mate != null ? (l.mate > 0 ? 100 : 0) : R('win', l.cp));
/* a line too short to settle goes on from its end, 120,000 nodes a search (extendLine), to 12 plies */
async function extend(fen, moves) {
  let out = moves.slice(0, 12);
  for (let guard = 0; guard < 3 && out.length < 12; guard++) {
    const end = R('play', fen, out);
    if (!end || R('over', end)) break;
    const r = await go(end, EXT_NODES, 1);
    const pv = (r.lines[0] || {}).pv || [];
    if (!pv.length) break;
    out = out.concat(pv).slice(0, 12);
  }
  return out;
}

/* one try's facts: the defender's forced mate, and whether a capture reason holds (the capture Stockfish
   plays, else the one the app names; the loss of at least the piece's worth less one, a pawn's whole, at
   the line's settle ply and at its last settled point; a capture other than Stockfish's own reply only
   within 10 points of it) */
async function tryFacts(p, t, me, nodes) {
  const fenT = R('play', p.fen, [t]);
  if (!fenT || R('over', fenT)) return { t };
  const r = await go(fenT, nodes, 1), l = r.lines[0];
  if (!l) return { t };
  const out = { t, r0: l.pv[0], wT: 100 - win(l) };
  /* their mate in two (V3.2 names that; a mate in one the board gives, a longer one no claim reads) */
  if (l.mate === 2) {
    out.mate = l.mate;
    out.mfirst = l.pv[0];
    if (l.mate === 2 && !R('mate2', fenT, l.pv[0])) {
      /* Stockfish's first move is not a forced mate in two by the move generator: any that is */
      out.mfirst = R('legal', fenT).filter((d) => R('mate2', fenT, d))[0] || null;
    }
  }
  const pick = R('pick', p.fen, t), v0 = R('takes', fenT, l.pv[0], me);
  const named = v0 ? l.pv[0] : pick ? pick.u : null;
  if (!named) return out;
  const v = v0 || pick.v;
  let moves = [t].concat(l.pv), wN = out.wT;
  if (named !== l.pv[0]) {
    const fenN = R('play', fenT, [named]);
    if (!fenN) return out;
    if (R('over', fenN)) moves = [t, named];
    else { const rn = await go(fenN, nodes, 1); wN = win(rn.lines[0]); moves = [t, named].concat(rn.lines[0].pv); }
  }
  moves = await extend(p.fen, moves);
  const s = R('settleLine', p.fen, moves, me);
  const need = v === 1 ? 1 : 2, loss = Math.min(-s.me, -s.last);
  out.cap = { named, pick: pick ? pick.u : null, v, need, loss, atSettle: -s.me, atLast: -s.last, event: s.event, settled: s.settled, wN, wT: out.wT };
  out.cap.holds = loss >= need && (named === l.pv[0] || wN - out.wT <= 10);
  /* a reason kept at its line's edge (the loss just enough, the line unsettled, another capture than
     Stockfish's more than 5 points weaker) is decided again at the deeper search */
  out.cap.edge = out.cap.holds && (loss === need || !s.settled || (named !== l.pv[0] && wN - out.wT > 5));
  return out;
}

async function factsOf(p) {
  const legal = R('legal', p.fen), me = p.fen.split(' ')[1] === 'w', rep = [];
  let ok = p.ok.slice(), cl = p.cl.slice(), ansLine = null, own = {};
  /* a move whose reason the board gives (a guarded piece taken, their mate in one, a pawn let through)
     needs no facts, and is no candidate for accepted or close */
  const onBoard = (u, ans) => ['guarded', 'mate', 'promo', 'task'].indexOf(R('rung', p.fen, p.skill, ans, u)) >= 0;
  if (MATE_SKILL[p.skill]) { ok = R('mates', p.fen); cl = []; }
  else {
    /* the best move and the lines near it (8 lines, every legal move when all 8 sit within 10 points) */
    const k = Math.min(legal.length, 8);
    let r = await go(p.fen, NODES, k);
    if (r.lines.length === k && legal.length > k && win(r.lines[0]) - win(r.lines[k - 1]) <= 10) r = await go(p.fen, NODES, legal.length);
    const best = r.lines[0].pv[0], wb = win(r.lines[0]), mpv = {};
    r.lines.forEach((l) => { mpv[l.pv[0]] = wb - win(l); });
    ansLine = r.lines[0];
    p.lines = r.lines.map((l) => [l.pv[0], l.cp, l.mate, Math.round(win(l) * 10) / 10]);
    /* every other move's own line (Stockfish after it, 1,000,000 nodes: what a miss's facts read) */
    const others = legal.filter((u) => u !== best && !onBoard(u, best));
    (await Promise.all(others.map((u) => tryFacts(p, u, me, TRY_NODES)))).forEach((f) => { own[f.t] = f; });
    /* a move near the best by either search is graded as a try is: side by side with the best (2 lines,
       searchmoves, 1,000,000 nodes; from 2.5 to 11.5 points below, or to 25 when the best mates, again at
       8,000,000), since a line far down a MultiPV search is searched less and can be left out of it */
    const bestMates = r.lines[0].mate != null && r.lines[0].mate > 0;
    const pair = async (u, nodes) => {
      const x = await go(p.fen, nodes, 2, [u, best]);
      let lu = x.lines.filter((l) => l.pv[0] === u)[0], lb = x.lines.filter((l) => l.pv[0] === best)[0];
      /* a line the search left out: each move searched alone, at the same budget */
      if (!lu || !lb) { lu = (await go(p.fen, nodes, 1, [u])).lines[0]; lb = (await go(p.fen, nodes, 1, [best])).lines[0]; }
      return lu && lb ? { g: win(lb) - win(lu), mate: bestMates || (lb.mate != null && lb.mate > 0) } : null;
    };
    const gap = {};
    await Promise.all(others.filter((u) => (mpv[u] != null && mpv[u] <= 30) || (own[u] && own[u].wT != null && own[u].wT >= wb - 30)).map(async (u) => {
      let x = await pair(u, TRY_NODES);
      if (x && NODES > TRY_NODES && ((x.g >= 2.5 && x.g <= 11.5) || (x.mate && x.g > 0 && x.g <= 25))) x = await pair(u, NODES);
      if (x) gap[u] = x.g;
      else rep.push(u + ' (' + R('san', p.fen, u) + ') could not be graded side by side');
    }));
    const near = Object.keys(gap).sort((x, y) => gap[x] - gap[y]);
    near.filter((u) => gap[u] < -4).forEach((u) => rep.push(u + ' (' + R('san', p.fen, u) + ') is ' + (-gap[u]).toFixed(1) + ' points better than the best ' + best));
    ok = [best].concat(near.filter((u) => gap[u] <= 4));
    cl = near.filter((u) => gap[u] > 4 && gap[u] <= 10);
    p.gaps = gap;
    /* the answer stays the one the row had while it is still accepted */
    if (ok.indexOf(p.ok[0]) > 0) ok = [p.ok[0]].concat(ok.filter((u) => u !== p.ok[0]));
  }
  /* every accepted move holds the skill's claim, and a real position keeps its stored answer */
  ok.forEach((u) => { if (!R('claim', p.fen, u, p.skill)) rep.push('claim fails for ' + u + ' (' + R('san', p.fen, u) + ')'); });
  if (p.src === 'R' && ok.indexOf(p.ok[0]) < 0) rep.push('the stored answer ' + p.ok[0] + ' is no longer accepted');
  /* the misses: their mates and their capture reasons (none on a mate task, which says "That is not mate.") */
  const caps = [], mates = [], detail = [];
  if (!MATE_SKILL[p.skill] && ok.length) {
    const misses = legal.filter((u) => ok.indexOf(u) < 0 && cl.indexOf(u) < 0 && !onBoard(u, ok[0]));
    const first = await Promise.all(misses.map((t) => own[t] || tryFacts(p, t, me, TRY_NODES)));
    const facts = await Promise.all(first.map((f) => (f.cap && f.cap.edge && NODES > TRY_NODES ? tryFacts(p, f.t, me, NODES).then((g) => Object.assign(g, { deep: true })) : f)));
    facts.forEach((f) => {
      detail.push(f);
      if (f.mate && f.mfirst) mates.push(f.t + '>' + f.mfirst + ':' + f.mate);
      if (f.mate === 2 && !f.mfirst) rep.push('mate in two after ' + f.t + ' not confirmed by the move generator');
      if (f.cap && f.cap.holds) caps.push(f.cap.named === f.cap.pick ? f.t : f.t + '>' + f.cap.named);
    });
  }
  /* Hint 2 (V2.3), on the circled piece when Hint 1 rings it as attacked */
  let h2 = '';
  const c = ok.length ? R('circled', p.fen, ok[0], p.skill) : null;
  if (c && c.attacked && !MATE_SKILL[p.skill]) {
    const r = await go(p.fen, TRY_NODES, c.moves.length, c.moves.map((x) => x.u));
    const w = {};
    let safe = [];
    for (const l of r.lines) {
      w[l.pv[0]] = win(l);
      const mv = c.moves.filter((x) => x.u === l.pv[0])[0];
      const line = await extend(p.fen, l.pv);
      const s = R('settleLine', p.fen, line, me);
      if (!mv.red && (R('survives', p.fen, line, s.ply) || s.me >= 0)) safe.push(l.pv[0]);
    }
    /* moves past the search's lines were worse than its last: not counted as safe, but a plain square the
       search left out and no accepted move is not known to lose the piece, so "Find a safe square." cannot
       rest on it */
    const mine = c.moves.map((x) => x.u), best = r.lines[0] ? r.lines[0].pv[0] : null;
    const held = mine.filter((u) => ok.indexOf(u) >= 0), near = mine.filter((u) => cl.indexOf(u) >= 0);
    const next = r.lines.slice(1).map((l) => win(l))[0];
    const unseen = c.moves.filter((x) => !x.red && ok.indexOf(x.u) < 0 && !r.lines.some((l) => l.pv[0] === x.u)).map((x) => x.u);
    /* "Find a safe square." when every safe square is an accepted move (one, or several and all accepted):
       it then invites nothing rejected; else V2.3's ladder */
    if (safe.length && !unseen.length && safe.every((u) => ok.indexOf(u) >= 0)) h2 = 'S';
    else if (safe.length >= 2 && held.length === 1 && held[0] === ok[0] && best === ok[0] && !near.length && (next == null || (w[best] - next >= 10 && R('step', next) < R('step', w[best])))) h2 = 'O';
    p.h2info = { safe, held, near, unseen, w };
  }
  return { ok, cl, caps, mates, h2, rep, detail, ansLine };
}

(async () => {
  for (let i = 0; i < WORKERS; i++) pool.push({ e: worker(), busy: false });
  const todo = rows.filter((p) => !ONLY || ONLY.indexOf(p.id) >= 0);
  const t0 = Date.now();
  let done = 0;
  const res = await Promise.all(todo.map((p) => factsOf(p).then((f) => {
    done++;
    process.stderr.write(`\r${done}/${todo.length} positions, ${searched} searched, ${hits} cached, ${Math.round((Date.now() - t0) / 1000)} s   `);
    return [p, f];
  })));
  process.stderr.write('\n');
  const changed = [];
  let bytes = 0;
  const out = {};
  res.forEach(([p, f]) => {
    const fields = [p.id, p.skill, p.src, p.band, p.fen, f.ok.join(','), f.cl.join(','), f.caps.join(','), f.mates.join(','), f.h2];
    while (fields.length > 7 && !fields[fields.length - 1]) fields.pop();
    const row = fields.join('|');
    bytes += f.caps.join(',').length + f.mates.join(',').length + f.h2.length;
    const was = { ok: p.ok.join(','), cl: p.cl.join(',') };
    if (was.ok !== f.ok.join(',') || was.cl !== f.cl.join(',')) changed.push(p.id + ': accepted ' + was.ok + ' -> ' + f.ok.join(',') + ' | close ' + was.cl + ' -> ' + f.cl.join(','));
    f.rep.forEach((x) => console.log('REPORT ' + p.id + ': ' + x));
    out[p.id] = f.rep.length ? null : row;
    if (opt.verbose) {
      console.log(p.id, p.skill, 'lines', JSON.stringify(p.lines || []), 'gaps', JSON.stringify(p.gaps || {}), 'h2', f.h2, JSON.stringify(p.h2info || {}));
      f.detail.forEach((d) => { if (d.cap || d.mate) console.log('   ', d.t, d.mate ? 'mate ' + d.mate + ' ' + d.mfirst : '', d.cap ? JSON.stringify(d.cap) : '', d.deep ? 'deep' : ''); });
    }
  });
  console.log(changed.length + ' positions change their accepted or close moves:');
  changed.forEach((x) => console.log('  ' + x));
  const all = res.map((x) => x[1]);
  console.log('capture reasons kept: ' + all.reduce((s, f) => s + f.caps.length, 0) + ', mates after a miss: ' + all.reduce((s, f) => s + f.mates.length, 0)
    + ' (in two: ' + all.reduce((s, f) => s + f.mates.filter((m) => /:2$/.test(m)).length, 0) + '), Hint 2: ' + all.filter((f) => f.h2 === 'S').length + ' S, ' + all.filter((f) => f.h2 === 'O').length + ' O; facts ' + bytes + ' bytes');
  console.log('captures named but not kept: ' + all.reduce((s, f) => s + f.detail.filter((d) => d.cap && !d.cap.holds).length, 0) + ', decided again deeper: ' + all.reduce((s, f) => s + f.detail.filter((d) => d.deep).length, 0));
  if (opt.write) {
    let text = src;
    rows.forEach((p) => { if (out[p.id]) text = text.replace(" '" + p.row + "'", " '" + out[p.id] + "'"); });
    fs.writeFileSync(DATA, text);
    console.log('wrote ' + DATA + (Object.keys(out).some((k) => out[k] === null) ? ' (positions with a report kept as they were)' : ''));
  }
  pool.forEach((w) => w.e.quit());
  cacheOut.end();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error(e); process.exit(1); });
