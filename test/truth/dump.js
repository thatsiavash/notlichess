// The truth audit's card passes: every fixture card at tiers 1, 2 and 3 in the Node realm (boot.js), with
// the checkout's Stockfish answering the app's own searches, each frame written as data (walker.js): the
// strings on its face, the board they are said on, its marks and the moves it is about.
//   node test/truth/dump.js live|live-game|stored|stored-game --out DIR [--root DIR] [--workers 2] [--keys k1,k2]
//   live: the engine up (what a player sees): the card's frames (frames.js), natural wrong tries graded by
//     the app (each on a fresh card), two misses on one showing, a wrong try inside a forcing line, the
//     forcing line's guesses at tier 3, game mode at tiers 2 and 3, and the foils at tiers 2 and 3
//   stored: the engine down (SF.state 'failed'): the same frames with no try graded
//   -game: only the game-mode reviews (tiers 2 and 3)
//   live-seeds: only exp2250-r2's seeded cases (seeds.json, release 2's C5 (i))
// Both read the keyed fixture (<out>/enriched.json, prep.js). --keys keeps only those cards and foils
// (foil:<key>). Writes <out>/dump-<mode>.jsonl, and dump-<mode>.walk.json: the cards and foils it walked.
const fs = require('fs'), path = require('path');
const R = require('./boot');
const WALK = require('./walker'), FRAMES = require('./frames');
const o = R.args(process.argv.slice(2));
const mode0 = o._[0] || 'live', gameOnly = /-game$/.test(mode0), seedsOnly = /-seeds$/.test(mode0), mode = mode0.replace(/-(game|seeds)$/, '');
const only = typeof o.keys === 'string' ? o.keys.split(',').filter(Boolean) : [];
const OUT = path.join(o.out, 'dump-' + mode0 + '.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { quit, pool } = R;

(async () => {
  /* v1: both passes on the keyed fixture (prep.js): with the engine down only keyed cards are dealt (V1.1) */
  if (['live', 'stored'].indexOf(mode) < 0 || !o.out || (seedsOnly && mode !== 'live')) throw new Error('usage: node test/truth/dump.js live|live-game|live-seeds|stored|stored-game --out DIR');
  const storage = { 'nl:games:cc:tester': fs.readFileSync(path.join(o.out, 'enriched.json'), 'utf8') };
  /* the seeded cases keep the page's own engineEval: a seed with a warm list runs on a browser worker */
  const A = await R.boot({ root: o.root, out: o.out, workers: mode === 'live' ? +(o.workers || 2) : 0, storage, engine: seedsOnly ? false : undefined });
  A.ev(WALK); A.ev(FRAMES);
  if (seedsOnly) A.ev('window.__ee0 = engineEval; 1');
  const ev0 = A.ev; A.ev = (code) => ev0('var TA = window.TA; ' + code);
  /* three positions practised elsewhere, so no card is among the player's first three (ctxLine) */
  A.ev("(function () { var m = srsLoad(); ['zz:1', 'zz:2', 'zz:3'].forEach(function (k) { m[k] = { box: 1, streak: 0, due: Date.now() + 9e9, last: Date.now() - 9e8, lapses: 0 }; }); store.set(srsKey(), m); srsMem = null; srsRevision++; return 1; })()");
  if (mode === 'stored') A.ev("SF.state = 'failed'; TA.engineDown = true; engineEval = function () { return new Promise(function () {}); }; 1");
  /* TA.open: the card at first sight (its record cleared) */
  A.ev(`TA.open0 = TA.open; TA.open = function (key, keep) { if (!keep) { var m = srsLoad(); if (m[key]) { delete m[key]; store.set(srsKey(), m); srsMem = null; srsRevision++; } } return TA.open0(key); }; 1`);
  const out = fs.createWriteStream(OUT);
  const flushOut = () => { const recs = JSON.parse(A.ev('JSON.stringify(window.__out.splice(0))')); recs.forEach((r) => out.write(JSON.stringify(Object.assign({ pass: mode }, r)) + '\n')); return recs.length; };
  let keys = JSON.parse(A.ev('JSON.stringify(allMistakes().filter(trainable).map(function (it) { return it.key; }))'));
  if (only.length) keys = keys.filter((k) => only.indexOf(k) >= 0);
  console.log(mode, 'cards', keys.length);
  const ev = (code) => A.ev(code);
  const J = (x) => JSON.stringify(x);
  const waitPhase = async (not, max) => {
    for (let i = 0; i < (max || 20000); i++) {
      const ph = ev('ui.session && ui.session.active ? ui.session.active.phase : "none"');
      if (ph !== not) return ph;
      await sleep(i < 50 ? 2 : 20);
    }
    return 'timeout';
  };
  /* natural wrong tries: the moves a shallow search (3,000 nodes, six lines) likes, best first,
     never the answer, the game move or a move of the forcing line */
  const natural = async (fen, avoid, n) => {
    const r = await pool().go(fen, { nodes: 3000, multipv: 8 });
    const seen = {};
    return r.lines.map((l) => l.pv[0]).filter((u) => u && avoid.indexOf(u) < 0 && !seen[u] && (seen[u] = 1)).slice(0, n || 5);
  };
  /* one try on the card on screen, answered by the real engine; its frames (seeAfterClose: after a good
     move, Show the answer and See why, C5 (b)) */
  const doTry = async (tag, u, seeAfterClose) => {
    const ok = ev(`(function () { var a = ui.session.active, m = uciToMove(a.st, ${J(u)}); if (!m) return 0; a.tapped = true; gradeMove(m); return 1; })()`);
    if (!ok) return 'illegal';
    const ph = await waitPhase('checking');
    const res = ev(`(function () { var a = ui.session.active, t = a.tried;
      if (a.phase === 'tried') {
        a.animMove = null;
        TA.snap(a, ${J(tag)} + ' ' + t.kind, { u: ${J(u)} });
        if (t.kind === 'miss') {
          a.reason = 2; TA.snap(a, ${J(tag)} + ' miss, reason said', { u: ${J(u)} });
          if (t.reply) {
            seeIt(); a.animMove = null; TA.snap(a, ${J(tag)} + ' miss, See it landed', { u: ${J(u)} });
            /* v2 slice 2 (V2.2): Next move steps the rest of their line, to where it settles */
            for (var g = 0; g < 10 && typeof seeMore === 'function' && seeMore(t); g++) { seeIt(); a.animMove = null; TA.snap(a, ${J(tag)} + ' miss, See it step ' + t.step, { u: ${J(u)} }); }
          }
        }
        /* release 2's C5 (b): after a good move, Show the answer and its See why */
        if (t.kind === 'close' && ${seeAfterClose ? 'true' : 'false'}) {
          reveal(); a.animMove = null; TA.snap(a, ${J(tag)} + ' close, shown', { u: ${J(u)} });
          if (!a.sol) { playIt(false); a.animMove = null; a.settle = 2; TA.snap(a, ${J(tag)} + ' close, shown, settled', { u: ${J(u)} }); TA.details(a, ${J(tag)} + ' close, shown, settled'); TA.storyFrames(a, ${J(tag)} + ' close, shown'); }
        }
        return 'tried:' + t.kind;
      }
      if (a.phase === 'done') { TA.settledFrames(a, ${J(tag)} + (a.alt ? ' works too' : ' solved')); return 'done:' + (a.alt ? 'alt' : a.result); }
      TA.snap(a, ${J(tag)} + ' phase ' + a.phase, { u: ${J(u)} });
      return a.phase; })()`);
    return res;
  };
  /* Explore (C5 (f)): the card solved with its answer, then each move from its position, played once its
     analysis is in (the sentence and the rows wait on the 1,000,000-node searches) */
  const explore = async (key, info, extra, tag, only) => {
    const st = JSON.parse(ev(`(function () { var a = TA.open(${J(key)}); if (!a) return 'null';
      if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); if (a.solIdx % 2 === 0) noteWon(a, lm); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
      a.lines = a.lines || cardLines(a);
      var k = factsOf(a.it.b);
      return JSON.stringify({ ok: TA.xpStart(), key3: k && k.l ? k.l.map(function (l) { return l[0]; }) : [] }); })()`));
    if (!st || st === 'null' || !st.ok) { const w = 'explore ' + (st && st.ok === 0 ? 'closed' : 'none'); stats.tries[w] = (stats.tries[w] || 0) + 1; return; }
    const moves = only || [...new Set(st.key3.concat([info.played], extra || []))].filter(Boolean);
    for (const u of moves) {
      const r = ev(`TA.xpPlay(${J(u)})`);
      if (r !== 'ok') continue;
      let ready = 'wait';
      for (let i = 0; i < 6000 && ready === 'wait'; i++) { await sleep(i < 50 ? 2 : 10); ready = ev('TA.xpReady()'); }
      ev(`TA.xpSnap(${J(tag + ' ' + u)}, { u: ${J(u)} }); 1`);
      stats.tries['explore ' + ready] = (stats.tries['explore ' + ready] || 0) + 1;
    }
    ev(`(function () { if (ui.session && ui.session.active && ui.session.active.explore) exploreExit('silent'); return 1; })()`);
  };
  const again = (tag) => ev(`(function () { var a = ui.session.active; if (a.phase !== 'tried') return 0; tryAgain(); a.triedHold = false; a.animMove = null; TA.snap(a, ${J(tag)} + ' after Try again'); return 1; })()`);
  const stats = { cards: 0, tries: {}, foils: {} }, walk = { cards: {}, skipped: [], foils: {}, setAside: {} };
  if (seedsOnly) {
    /* release 2's C5 (i): exp2250-r2's cases (seeds.json), each walked as the tester walked it, on the
       key a browser built where the seed has a warm list (keys.js), else the fixture's */
    const SD = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds.json'), 'utf8')).seeds;
    const kb = fs.existsSync(path.join(o.out, 'keys-built.json')) ? JSON.parse(fs.readFileSync(path.join(o.out, 'keys-built.json'), 'utf8')) : {};
    walk.seeds = {};
    const W = require('./worker');
    for (const sd of SD) {
      const tag0 = 'seed ' + sd.ids.join(',');
      let bw = null;
      if (sd.warm && sd.warm.length) {
        /* as the tester's browser: one worker builds the warm cards' keys, then this card's, which the
           card is dealt on; its tries are graded on the same worker */
        bw = await W.browserWorker(o.root);
        globalThis.__sw = bw;
        ev(`(function () { engineEval = window.__ee0; SF.workers = [{ w: __sw }]; SF.queue = []; SF.state = 'ready'; SF.loading = null; SF.code = { url: 'sf/stockfish.js' }; SF.build = 'sf17.1'; return 1; })()`);
        for (const k of sd.warm.concat([sd.key])) {
          /* the card as the games hold it (a warm card may be one the fixture's key sets aside) */
          ev(`(function () { var p = ${J(k)}.split(':'), g = data.games.filter(function (x) { return String(x.id) === p[0]; })[0],
              b = g && (g.bl || []).filter(function (x) { return String(x.p) === p[1]; })[0];
            window.__kp = factsCompute({ g: g, b: b, key: ${J(k)} }, false).then(function (k) { window.__kr = k; return 1; }, function () { window.__kr = null; return 0; }); return 1; })()`);
          await ev('window.__kp');
        }
        const bk = JSON.parse(ev('JSON.stringify(window.__kr || null)'));
        const kk = kb.seeds && kb.seeds[sd.key] && kb.seeds[sd.key].k;
        if (!bk || bk.x) { console.log('seed', sd.ids.join(','), 'no key'); walk.seeds[tag0 + ' ' + sd.key] = 'no key'; bw.terminate(); continue; }
        if (kk && kk.a !== bk.a) console.log('seed', sd.ids.join(','), 'key', bk.a, 'unlike keys.js\'s', kk.a);
        ev(`(function () { var it = itemOf(${J(sd.key)}); it.b.k = window.__kr; delete it.b.kp; factsApply(it); delete it.b.dz; modelDirty(); return 1; })()`);
      } else {
        ev(`(function () { engineEval = function (fen, mt, prio, opts) { return __sfEval(fen, mt, opts || {}); }; SF.workers = []; SF.queue = []; SF.state = 'ready'; SF.build = 'sf17.1'; return 1; })()`);
      }
      for (const tier of sd.tiers) {
        ev(`TA.setTier(${tier}); 1`);
        const info = JSON.parse(ev(`(function () { var a = TA.open(${J(sd.key)}); return JSON.stringify({ pre: stateFen(a.pre), best: a.bestUci, played: a.playedUci, sol: a.sol || [] }); })()`));
        for (const u of sd.tries || []) {
          ev(`TA.open(${J(sd.key)}); 1`);
          const res = await doTry(tag0 + ' try ' + u, u, true);
          if (sd.details) ev(`(function () { var a = ui.session.active; TA.details(a, ${J(tag0 + ' try ' + u + ' ' + res)}); return 1; })()`);
          if (res === 'tried:miss') again(tag0 + ' try ' + u);
          walk.seeds[tag0 + ' ' + sd.key + ' t' + tier + ' ' + u] = res;
        }
        if (sd.solve) { ev(`TA.solve(${J(sd.key)}, ${J(tag0 + ' best')})`); walk.seeds[tag0 + ' ' + sd.key + ' t' + tier + ' best'] = 'solved'; }
        if (sd.explore) await explore(sd.key, info, [], tag0 + ' explore', sd.explore);
        flushOut();
      }
      if (bw) bw.terminate();
      console.log('seed', sd.ids.join(','), sd.key, JSON.stringify(walk.seeds));
    }
  }
  for (const tier of (gameOnly ? [2, 3] : seedsOnly ? [] : [1, 2, 3])) {
    ev(`TA.setTier(${tier}); 1`);
    for (const key of keys) {
      const r = gameOnly ? 'ok' : ev(`TA.cardSync(${J(key)})`);
      if (r !== 'ok') { console.log('skip', key, r); walk.skipped.push(tier + ' ' + key + ' ' + r); continue; }
      stats.cards++;
      (walk.cards[tier] = walk.cards[tier] || []).push(key);
      const info = JSON.parse(ev(`(function () { var a = TA.open(${J(key)}); return JSON.stringify({ pre: stateFen(a.pre), best: a.bestUci, played: a.playedUci, sol: a.sol || [] }); })()`));
      /* the forcing line: at tier 3 its reply list first (the card's own search), and three guesses */
      if (info.sol.length && !gameOnly) {
        let guesses = [];
        if (tier === 3 && mode === 'live') {
          ev(`(function () { var a = TA.open(${J(key)}); ensureReplies(a, true); window.__rp = replyPending[${J(key)}] || null; return 1; })()`);
          if (ev('!!window.__rp')) await ev('window.__rp');
          const rl = JSON.parse(ev(`JSON.stringify(replyList(itemOf(${J(key)}).b))`) || 'null');
          if (rl) {
            const listed = rl.l.map((x) => x[0]).filter((u) => u !== info.sol[1]);
            /* a move off the list: their shallow favourite outside it */
            const st1 = JSON.parse(ev(`(function () { var s = cloneState(stateFromFen(${J(info.pre)})); applyMove(s, uciToMove(s, ${J(info.sol[0])})); return JSON.stringify(stateFen(s)); })()`));
            const off = (await natural(st1, rl.l.map((x) => x[0]), 3))[0];
            guesses = listed.slice(0, 2).concat(off ? [off] : []);
          }
        }
        ev(`TA.forcing(${J(key)}, ${J(guesses)})`);
      }
      if (mode === 'live' && !gameOnly) {
        /* natural wrong tries, each on a fresh card: up to five, until three misses */
        const cands = await natural(info.pre, [info.best, info.played].concat(info.sol.slice(0, 1)), 6);
        let misses = 0, firstMiss = null;
        for (const u of cands) {
          if (misses >= 3) break;
          ev(`TA.open(${J(key)}); 1`);
          const res = await doTry('try ' + u, u, true);
          stats.tries[res] = (stats.tries[res] || 0) + 1;
          if (res === 'tried:miss') { misses++; if (!firstMiss) firstMiss = u; again('try ' + u); }
        }
        /* two misses on one showing: the game move, then the first natural miss (F1.3's repeated
           danger; the automatic hints by tier), then Hint pressed */
        if (firstMiss) {
          ev(`(function () { var a = TA.open(${J(key)}); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); if (a.phase === 'tried') { tryAgain(); a.triedHold = false; } return 1; })()`);
          const res2 = await doTry('two tries: ' + firstMiss, firstMiss);
          if (res2 === 'tried:miss') {
            again('two tries: ' + firstMiss);
            ev(`(function () { var a = ui.session.active; a.shownAt = Date.now() - 5000; if (a.phase === 'guess' && a.hints < hintMax(a)) { giveHint(); a.triedHold = false; TA.snap(a, 'two tries: hint pressed (' + a.hints + ')'); } return 1; })()`);
          }
        }
        /* release 2's C5 (f): every legal check and capture of the player's, beside the natural tries,
           each on a fresh card (a good move then shows the answer and its See why, C5 (b)) */
        const cc = JSON.parse(ev(`TA.checksCaptures(${J(key)})`)).filter((u) => cands.indexOf(u) < 0 && u !== info.best && u !== info.played && u !== info.sol[0]);
        for (const u of cc) {
          ev(`TA.open(${J(key)}); 1`);
          const res = await doTry('try ' + u, u, true);
          stats.tries['cc ' + res] = (stats.tries['cc ' + res] || 0) + 1;
          if (res === 'tried:miss') again('try ' + u);
        }
        /* release 2's C5 (f): Explore after the answer, from the card's position: the key's three moves,
           the game move, and every check and capture */
        await explore(key, info, cc, 'explore');
        /* a wrong try inside the forcing line (its second move of yours) */
        if (info.sol.length >= 3 && tier >= 2) {
          const mid = JSON.parse(ev(`(function () { var a = TA.open(${J(key)}); gradeMove(uciToMove(a.st, a.sol[0])); if (!a.reply) return 'null'; theirReply(a, false); replyDone(a, a.reply); a.animMove = null; return JSON.stringify(stateFen(a.st)); })()`));
          if (mid) {
            const mc = await natural(mid, info.sol.slice(2, 3), 2);
            for (const u of mc.slice(0, 1)) {
              const res = await doTry('mid-line try ' + u, u);
              stats.tries['mid ' + res] = (stats.tries['mid ' + res] || 0) + 1;
            }
          }
        }
        /* game mode: the frames, and one natural try */
        if (tier >= 2) {
          const g = ev(`TA.gameSync(${J(key)})`);
          if (g === 'ok' && cands.length) {
            ev(`TA.gameRec(${J(key)}); TA.open(${J(key)}, true); 1`);
            const res = await doTry('game try ' + cands[0], cands[0]);
            if (res === 'tried:miss') again('game try ' + cands[0]);
            ev(`TA.ungame(${J(key)}); 1`);
          }
        }
      }
      if (gameOnly) {
        const g = ev(`TA.gameSync(${J(key)})`);
        stats.tries['game ' + g] = (stats.tries['game ' + g] || 0) + 1;
        if (g === 'ok' && mode === 'live') {
          const cands = await natural(info.pre, [info.best, info.played].concat(info.sol.slice(0, 1)), 6);
          for (const u of cands.slice(0, 2)) {
            ev(`TA.gameRec(${J(key)}); TA.open(${J(key)}, true); 1`);
            const res = await doTry('game try ' + u, u);
            if (res === 'tried:miss') again('game try ' + u);
            ev(`TA.ungame(${J(key)}); 1`);
          }
        }
      } else if (mode !== 'live' && tier >= 2) ev(`TA.gameSync(${J(key)})`);
      flushOut();
    }
    console.log('tier', tier, 'done', JSON.stringify(stats), pool() ? JSON.stringify(pool().stats()) : '');
    /* foils (F8.2) at tiers 2 and 3: looked at (foilLook, the real engine), then every frame */
    if (tier >= 2 && mode === 'live' && !gameOnly) {
      const fkeys = JSON.parse(ev('JSON.stringify(foilPool().map(function (f) { return f.key; }))')).filter((k) => !only.length || only.indexOf(k) >= 0);
      for (const fk of fkeys) {
        ev(`window.__fp = foilLook(itemOf(${J(fk)}), true); 1`);
        await ev('window.__fp');
        /* v2 slice 2 (V2.6): its threat, searched after the look */
        if (ev(`!!itemOf(${J(fk)}).thP`)) await ev(`itemOf(${J(fk)}).thP`);
        const st = JSON.parse(ev(`JSON.stringify({ ok: !!itemOf(${J(fk)}).b.ok, x: itemOf(${J(fk)}).b.x || null })`));
        stats.foils[st.ok ? 'ok' : 'x:' + st.x] = (stats.foils[st.ok ? 'ok' : 'x:' + st.x] || 0) + 1;
        if (!st.ok) { walk.setAside[fk] = st.x; continue; }
        (walk.foils[tier] = walk.foils[tier] || []).push(fk);
        const fi = JSON.parse(ev(`(function () { var a = TA.open(${J(fk)}, true); if (!a) return 'null';
          TA.snap(a, 'foil open'); a.hints = 1; TA.snap(a, 'foil hint 1'); a.hints = 2; TA.snap(a, 'foil hint 2');
          a = TA.open(${J(fk)}, true); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); TA.settledFrames(a, 'foil game move');
          a = TA.open(${J(fk)}, true); reveal(); a.animMove = null; TA.snap(a, 'foil shown'); playIt(false); a.animMove = null; a.settle = 2; TA.snap(a, 'foil shown, settled'); TA.details(a, 'foil shown, settled');
          return JSON.stringify({ pre: stateFen(a.pre), best: a.bestUci, played: a.playedUci }); })()`));
        if (!fi || fi === 'null') continue;
        const fc = await natural(fi.pre, [fi.best, fi.played], 4);
        let n = 0;
        for (const u of fc) {
          if (n >= 3) break;
          ev(`TA.open(${J(fk)}, true); 1`);
          const res = await doTry('foil try ' + u, u);
          stats.foils[res] = (stats.foils[res] || 0) + 1;
          n++;
          if (res === 'tried:miss') {
            again('foil try ' + u);
            ev(`(function () { var a = ui.session.active; a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); if (a.phase === 'done') { a.animMove = null; a.settle = 2; TA.snap(a, 'foil try ${u} then game move, settled'); } return 1; })()`);
          }
        }
        flushOut();
      }
      console.log('foils tier', tier, JSON.stringify(stats.foils));
    }
  }
  flushOut();
  await new Promise((r) => out.end(r));
  /* what the walk reached, for the summary's check that no card or foil was left out */
  fs.writeFileSync(path.join(o.out, 'dump-' + mode0 + '.walk.json'), JSON.stringify(walk) + '\n');
  console.log('done', JSON.stringify(stats), pool() ? JSON.stringify(pool().stats()) : '');
  await sleep(200);
  quit();
  process.exit(0);
})().catch((e) => { console.error(e); quit(); process.exit(1); });
