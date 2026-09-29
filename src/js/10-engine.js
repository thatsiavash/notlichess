var SF = { workers: [], state: 'idle', loading: null, queue: [], code: null, respawns: 0, crashes: [] };
/* crashes are forgiven over time: six in ten minutes means this browser
   cannot run the engine; six across a long evening do not */
function canRespawn() {
  var now = Date.now();
  SF.crashes = SF.crashes.filter(function (t) { return now - t < 10 * 60 * 1000; });
  return SF.crashes.length < 6;
}
/* the pool refills itself behind the first analyst */
function topUpPool() {
  var want = poolSize() - SF.workers.length - (SF.booting || 0);
  for (var i = 0; i < want; i++) {
    SF.booting = (SF.booting || 0) + 1;
    bootWorker(SF.code).then(function (w2) {
      SF.booting--;
      SF.workers.push({ w: w2 });
      enginePump();
    }, function () { SF.booting--; });
  }
}
function poolSize() {
  /* a fixed pool size, for testing several tabs on one machine */
  var fixed = +store.get('nl:poolSize', 0);
  if (fixed >= 1) return Math.min(8, fixed);
  var hc = navigator.hardwareConcurrency || 2;
  /* phones: two analysts at most, for the battery and the heat */
  var touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return Math.max(1, Math.min(touch ? 2 : 6, hc - 2));
}
function engineFailAll(e) {
  SF.state = 'failed';
  SF.loading = null;
  /* jobs already queued must settle, or every caller waits forever */
  SF.queue.splice(0).forEach(function (j) { j.reject(e); });
}
function engineLoad() {
  if (SF.workers.length) return Promise.resolve(SF.workers[0].w);
  if (SF.loading) return SF.loading;
  if (SF.code) {
    /* the pool emptied after crashes: boot a fresh analyst from the code
       already in hand, a bounded number of times */
    if (!canRespawn()) {
      var dead = new Error('engine keeps crashing');
      engineFailAll(dead);
      return Promise.reject(dead);
    }
    SF.respawns++;
    SF.loading = bootWorker(SF.code).then(function (w) {
      SF.workers.push({ w: w });
      SF.loading = null;
      SF.state = 'ready';
      topUpPool();
      return w;
    }, function (e) { engineFailAll(e); throw e; });
    return SF.loading;
  }
  SF.state = 'loading';
  /* Stockfish 17.1 with its neural network, served from this site (sf/).
     There is no fallback: every game is judged by the same engine, and a
     browser that cannot run it says so */
  SF.loading = bootWorker({ url: 'sf/stockfish.js' }).then(function (w) { SF.code = { url: 'sf/stockfish.js' }; SF.build = 'sf17.1'; return w; })
    .then(function (w) {
      SF.workers.push({ w: w });
      SF.state = 'ready';
      SF.loading = null;
      topUpPool();
      renderEngineState();
      return w;
    })
    .catch(function (e) { engineFailAll(e); renderEngineState(); throw e; });
  return SF.loading;
}
function bootWorker(code) {
  return new Promise(function (resolve, reject) {
    var w;
    try {
      w = code && code.url ? new Worker(code.url)
        : new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    } catch (e0) { reject(e0); return; }
    /* the clock starts at the worker's first word: the first visit downloads
       about 7 MB before the engine can speak, and a slow connection must not
       look like a failure (ten minutes of silence is the only give-up) */
    var fail = function (why) { return function () { reject(new Error(why)); w.terminate(); }; };
    var t = setTimeout(fail('engine never answered'), 600000), heard = false;
    w.onmessage = function (e) {
      if (!heard) { heard = true; clearTimeout(t); t = setTimeout(fail('engine boot timeout'), 45000); }
      if (String(e.data) === 'uciok') { clearTimeout(t); resolve(w); }
    };
    w.onerror = function (e) { clearTimeout(t); reject(e); };
    w.postMessage('uci');
  });
}

/* engineEval(fen, budget, priority, opts): budget is {nodes: N} (the same
   quality on any device) or a number of milliseconds. opts.multipv asks for
   several lines, opts.searchmoves restricts the search to given moves (how
   a tried move is graded on equal terms with the best one). Resolves to
   {cp, mate, bestUci, pv[], lines[{cp, mate, pv}]}, scores from WHITE's
   point of view, cp clamped to +-1500 (a mate reads as +-1500). */
function engineEval(fen, movetime, priority, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var job = { fen: fen, movetime: movetime || 80, resolve: resolve, reject: reject,
                mpv: opts.multipv || 1, moves: opts.searchmoves || null, prio: !!priority, tag: opts.tag || null,
                onInfo: opts.onInfo || null, lanes: opts.lanes || null, hash: opts.hash || 0, xp: opts.xp || null };
    /* a player is waiting on priority jobs; the scan can wait */
    if (priority) {
      var at = 0;
      while (at < SF.queue.length && SF.queue[at].prio) at++;
      SF.queue.splice(at, 0, job);
    } else SF.queue.push(job);
    enginePump();
  });
}
/* jobs queued in the background for a card the player just reached move
   to the front, with the player's own questions */
function promoteTag(tag) {
  var mine = SF.queue.filter(function (j) { return j.tag === tag && !j.prio; });
  if (!mine.length) return;
  SF.queue = SF.queue.filter(function (j) { return mine.indexOf(j) === -1; });
  var at = 0;
  while (at < SF.queue.length && SF.queue[at].prio) at++;
  mine.forEach(function (j) { j.prio = true; });
  SF.queue.splice.apply(SF.queue, [at, 0].concat(mine));
  enginePump();
}
/* a question nobody is waiting for any more: a queued one is dropped, a
   running one is told to stop, and answers with what it has so far (stop is
   the one command Stockfish reads safely mid-search) */
function engineStop(tag) {
  if (!tag) return;
  /* a tag, or a test for the jobs to stop */
  var hit = typeof tag === 'function' ? tag : function (j) { return j.tag === tag; };
  SF.queue = SF.queue.filter(function (j) {
    if (!hit(j)) return true;
    j.reject({ stopped: true });
    return false;
  });
  SF.workers.forEach(function (slot) {
    var j = slot.pending && slot.pending[0];
    if (j && hit(j) && !j.stopping) { j.stopping = true; slot.w.postMessage('stop'); }
  });
}
/* the same question asked twice (the eval bar revisiting a position) is
   answered once */
var evalCache = {}, evalCacheOrder = [];
function engineEvalCached(fen, movetime, priority, opts) {
  var k = fen + '|' + JSON.stringify(movetime) + '|' + JSON.stringify(opts || {});
  if (evalCache[k]) return evalCache[k];
  var p = engineEval(fen, movetime, priority, opts);
  evalCache[k] = p;
  evalCacheOrder.push(k);
  if (evalCacheOrder.length > 600) delete evalCache[evalCacheOrder.shift()];
  /* a search cut short never answers a later full question */
  p.then(function (r) { if (r && r.stopped && evalCache[k] === p) delete evalCache[k]; }, function () { delete evalCache[k]; });
  return p;
}
function parseInfo(line) {
  var out = { cp: 0, mate: null, pv: [] };
  var sc = line.match(/score (cp|mate) (-?\d+)/);
  if (sc) {
    if (sc[1] === 'mate') { out.mate = parseInt(sc[2], 10); out.cp = out.mate > 0 ? 1500 : -1500; }
    else out.cp = Math.max(-1500, Math.min(1500, parseInt(sc[2], 10)));
  }
  var pv = line.match(/ pv (.+)$/);
  if (pv) out.pv = pv[1].split(' ').slice(0, 12);
  return out;
}
/* several lines: a search stopped mid-depth leaves some lines from the last
   depth and some from the one before, which can repeat a move. The lines are
   taken from the deepest depth that reported them all, after the newest best
   line, and a first move is never listed twice. Scores from White's side */
function linesOf(infos, byDepth, fen) {
  var flip = fen.split(' ')[1] !== 'w';
  var want = Object.keys(infos).length, full = null, depth = 0;
  Object.keys(byDepth).map(Number).sort(function (a, b) { return b - a; }).some(function (d2) {
    if (Object.keys(byDepth[d2]).length >= want) { full = byDepth[d2]; depth = d2; return true; }
    return false;
  });
  var blk = full || infos, raw = infos[1] ? [infos[1]] : [];
  Object.keys(blk).sort(function (a, b) { return a - b; }).forEach(function (k2) { raw.push(blk[k2]); });
  var seen = {};
  var lines = raw.map(function (txt) {
    var r = parseInfo(txt);
    if (flip) { r.cp = -r.cp; if (r.mate != null) r.mate = -r.mate; }
    if (r.mate === 0) r.mate = null;   /* already mated: the +-1500 says who */
    return r;
  }).filter(function (r) {
    var f = r.pv[0] || '';
    if (seen[f]) return false;
    seen[f] = 1;
    return true;
  });
  var d1 = infos[1] && infos[1].match(/ depth (\d+)/);
  return { lines: lines, depth: d1 ? +d1[1] : depth };
}
/* One search per worker at a time. Stockfish 17 in WebAssembly reads new
   commands while it searches, and a position sent mid-search corrupts it
   (a RuntimeError, then a dead worker), so the next job is sent only after
   the previous bestmove. The round trip costs well under a millisecond. */
function slotKill(slot, why) {
  /* a worker that stalled or crashed cannot be trusted again: its late
     bestmoves would pair with the wrong queued jobs */
  var at = SF.workers.indexOf(slot);
  if (at !== -1) SF.workers.splice(at, 1);
  if (slot.guardTimer) clearInterval(slot.guardTimer);
  try { slot.w.terminate(); } catch (e2) {}
  SF.crashes.push(Date.now());
  (slot.pending || []).splice(0).forEach(function (j) { j.reject(new Error(why)); });
  if (SF.code && SF.workers.length > 0 && canRespawn()) { SF.respawns++; topUpPool(); }
  enginePump();
}
function slotWire(slot) {
  if (slot.wired) return;
  slot.wired = true;
  slot.pending = [];
  slot.infos = {};
  slot.byDepth = {};
  slot.mpv = 1;
  slot.w.onerror = function () { slotKill(slot, 'engine crashed'); };
  slot.w.onmessage = function (e) {
    var m = String(e.data);
    /* a search that keeps talking is alive, however long it runs */
    if (m.indexOf('info ') === 0) slot.guardAt = Date.now();
    /* every scored line marks the depth reached, a bound one included, so a
       reprint from a shallower depth is always recognised */
    var bd = m.indexOf('info ') === 0 && m.indexOf(' score ') > 0 && m.match(/ depth (\d+)/);
    var reprint = !!(bd && +bd[1] < (slot.maxD || 0));
    if (bd) slot.maxD = Math.max(slot.maxD || 0, +bd[1]);
    if (m.indexOf('info ') === 0 && m.indexOf(' score ') > 0 && m.indexOf('bound') === -1
        && (m.indexOf(' pv ') > 0 || m.indexOf('score mate 0') > 0)) {
      var k = m.match(/ multipv (\d+)/), dm = m.match(/ depth (\d+)/), d = dm ? +dm[1] : 0, kk = k ? +k[1] : 1;
      slot.infos[kk] = m;
      /* a search cut mid-depth reprints unsearched lines at the depth before:
         those reprints never overwrite that depth's real lines */
      if (!reprint) (slot.byDepth[d] = slot.byDepth[d] || {})[kk] = m;
      /* a listener hears each finished set of lines, as the search deepens */
      var cur = slot.pending[0];
      if (cur && cur.onInfo && kk >= Math.min(cur.mpv, Object.keys(slot.infos).length)) {
        var part = linesOf(slot.infos, slot.byDepth, cur.fen);
        try { cur.onInfo({ lines: part.lines, depth: part.depth }); } catch (e3) {}
      }
    }
    if (m.indexOf('bestmove') === 0) {
      var job = slot.pending.shift();
      slot.guardAt = Date.now();
      var infos = slot.infos, byDepth = slot.byDepth;
      slot.infos = {}; slot.byDepth = {}; slot.maxD = 0;
      if (!job) return;
      var got = linesOf(infos, byDepth, job.fen), lines = got.lines;
      var best = m.split(' ')[1];
      /* a search stopped mid-way can name a new best move whose line was
         never printed: its own line moves to the top if it has one, and the
         first line always starts with the move it explains */
      if (best && best !== '(none)' && lines.length && lines[0].pv[0] !== best) {
        var bi = -1;
        lines.forEach(function (l, i) { if (bi === -1 && l.pv[0] === best) bi = i; });
        if (bi > 0) lines.unshift(lines.splice(bi, 1)[0]);
        else lines[0] = { cp: lines[0].cp, mate: lines[0].mate, pv: [best] };
      }
      var top = lines[0] || { cp: 0, mate: null, pv: [] };
      job.resolve({ cp: top.cp, mate: top.mate, bestUci: best && best !== '(none)' ? best : null,
                    pv: top.pv, lines: lines, depth: got.depth, stopped: !!job.stopping });
      enginePump();
    }
  };
  /* one inactivity guard per worker: if a pipeline stalls, fail it out
     rather than hanging every queued eval behind it */
  slot.guardAt = Date.now();
  slot.tick = Date.now();
  slot.guardTimer = setInterval(function () {
    /* a hidden tab's timers are delayed or frozen; a late tick says so, and
       the time it lost is not the engine's fault */
    var now = Date.now(), late = now - slot.tick > 12000;
    slot.tick = now;
    if (!slot.pending.length || late || document.hidden) { slot.guardAt = now; return; }
    if (now - slot.guardAt > 20000) slotKill(slot, 'engine timeout');
  }, 5000);
}
/* the kept analyst's limit for background work: a few milliseconds, whatever
   depth the reading setting asks of the scan */
var RESERVE_NODES = 18000;
function enginePump() {
  if (!SF.queue.length) return;
  if (!SF.workers.length) {
    if (SF.state === 'failed') { engineFailAll(new Error('engine unavailable')); return; }
    engineLoad().then(enginePump, function () {});
    return;
  }
  /* while a card is open, the first analyst waits for the player's own
     questions, so a checked move never queues behind background work */
  var reserve = !!(ui.session && (ui.session.active || ui.session.loadingKey)) && SF.workers.length > 1;
  /* exploring on a small pool (phones, small laptops): the background
     reading waits, so the explored position gets the engine and the device
     stays cool */
  var hold = SF.workers.length <= 2 && typeof xpActive === 'function' && xpActive();
  for (var wi = 0; wi < SF.workers.length && SF.queue.length; wi++) {
    var slot = SF.workers[wi];
    slotWire(slot);
    if (slot.pending.length) continue;
    /* the first queued job this analyst may run: a job with lanes runs only
       on those analysts; the kept analyst still takes a short scan job (18k
       nodes is a few milliseconds, never long enough to delay a checked move) */
    var qi = -1;
    for (var q = 0; q < SF.queue.length; q++) {
      var cand = SF.queue[q];
      if (cand.lanes && cand.lanes.indexOf(wi) === -1) continue;
      if (hold && !cand.prio) continue;
      if (reserve && wi === 0 && !cand.prio && !(cand.movetime && cand.movetime.nodes <= RESERVE_NODES)) continue;
      qi = q;
      break;
    }
    if (qi >= 0) {
      var job = SF.queue.splice(qi, 1)[0];
      slot.pending.push(job);
      if (slot.mpv !== job.mpv) {
        slot.w.postMessage('setoption name MultiPV value ' + job.mpv);
        slot.mpv = job.mpv;
      }
      /* sent only between searches, like MultiPV */
      if (job.hash && slot.hash !== job.hash) {
        slot.w.postMessage('setoption name Hash value ' + job.hash);
        slot.hash = job.hash;
      }
      var nodes = job.movetime && job.movetime.nodes;
      slot.w.postMessage('position fen ' + job.fen);
      slot.w.postMessage((nodes ? 'go nodes ' + nodes : 'go movetime ' + job.movetime)
        + (job.moves && job.moves.length ? ' searchmoves ' + job.moves.join(' ') : ''));
    }
  }
}
window.__engineStat = function () {
  return JSON.stringify({
    q: SF.queue.length, state: SF.state, respawns: SF.respawns,
    backoffMs: Math.max(0, backoffUntil - Date.now()),
    slots: SF.workers.map(function (sl) { return sl.pending ? sl.pending.length : -1; }),
    build: SF.build, scan: { running: scanState.running, pending: scanState.pending, done: scanState.done,
            enriched: enrichState.done, enriching: enrichState.running }
  });
};

