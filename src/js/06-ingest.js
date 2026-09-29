/* ── Mistakes at ingest and scan ────────────────────────────────────────────
   Two sources feed g.bl: lichess's own server analysis (at ingest) and our
   in-browser Stockfish scan. Both now keep what the trainer needs to
   explain a mistake, not just to name it: the best move and line, the
   opponent's refutation, mate distances, the clock and the time spent,
   and a compact win-chance series for the whole game. */

/* the swing that counts as a mistake scales with the player: at 1800+
   games are lost through smaller errors than at 900 */
function mistakeMinFor(g) {
  var r = g.myR ? bandEquivRating(g.perf, g.myR) : 1500;
  return r < 1200 ? 20 : (r < 1800 ? 15 : 12);
}
var MISTAKES_PER_GAME = 6;

/* one character per ply after that ply: White's win chance 0-100 on the
   64 characters of base64url, '.' where nothing was evaluated (no JSON
   escaping, no invented values) */
var WP_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function wpChar(whiteWin) { return WP_ABC.charAt(Math.max(0, Math.min(63, Math.round(whiteWin * 0.63)))); }
function wpSeries(cps) {
  var out = '';
  for (var i = 0; i < cps.length; i++) out += cps[i] == null ? '.' : wpChar(winPct(cps[i]));
  return out;
}
/* UCI lines are stored without spaces: e2e4e7e5g1f3 */
function packUci(list) { return (list || []).join(''); }
/* a promotion letter counts only when a whole move (or the end) follows it:
   in "f5g6b1d2" the b starts the next move, it does not promote */
function unpackUci(s) { return s ? (String(s).match(/[a-h][1-8][a-h][1-8](?:[qrbn](?=[a-h][1-8]|$))?/g) || []) : []; }

function evalCp(a) {
  if (!a) return 0;
  if (a.mate != null) return a.mate > 0 ? 1500 : -1500;
  return Math.max(-1500, Math.min(1500, a.eval || 0));
}
/* think time in seconds for the move at ply i: my clock two plies earlier,
   minus my clock after the move, plus the increment */
function thinkTime(clocks, i, incSecs) {
  if (!clocks || i < 2 || clocks[i] == null || clocks[i - 2] == null) return null;
  var t = (clocks[i - 2] - clocks[i]) / 100 + (incSecs || 0);
  return t >= 0 ? Math.round(t * 10) / 10 : null;
}

/* lichess server analysis: analysis[i] is the evaluation after ply i, and
   a judged ply carries `best` (UCI) and `variation` (SAN, starting with the
   best move) for the position before it */
function blunderLedger(g, meIsWhite, gRec) {
  if (!g.analysis || !g.moves) return null;
  if (g.variant && g.variant !== 'standard') return null;
  var toks = g.moves.split(' ');
  var min = mistakeMinFor(gRec);
  var inc = g.clock ? g.clock.increment : 0;
  var out = [], prev = { eval: 20 };
  var entry = function (i, a, prev, wb, wa) {
    if (!a.best || a.best === uciOfSan(g.moves, i)) return null;
    var pre = stateAtPly(g.moves, i);
    if (!pre) return null;
    var sign = meIsWhite ? 1 : -1;
    var vari = a.variation ? a.variation.split(' ').slice(0, 8) : [];
    var lu = sanLineToUci(pre, vari);
    return {
      p: i, wb: wb, wa: wa,
      c: (g.clocks && g.clocks[i] != null) ? Math.round(g.clocks[i] / 100) : null,
      tt: thinkTime(g.clocks, i, inc),
      bu: a.best, lu: packUci(lu.length ? lu : [a.best]),
      /* until a deeper look, the game's own continuation stands in for
         the refutation when the opponent's next moves were not errors */
      ru: packUci(refutationOf(g, pre, i)),
      mb: prev.mate != null ? prev.mate * sign : null,
      ma: a.mate != null ? a.mate * sign : null,
      eb: evalCp(prev) * sign,
      j: 'l'
    };
  };
  for (var i = 0; i < g.analysis.length && i < toks.length; i++) {
    var a = g.analysis[i];
    if ((i % 2 === 0) === meIsWhite) {
      var pc = evalCp(prev), cp = evalCp(a);
      var wb = winPct(meIsWhite ? pc : -pc);
      var wa = winPct(meIsWhite ? cp : -cp);
      if (wb - wa >= min) {
        var e = entry(i, a, prev, wb, wa);
        if (e) out.push(e);
      }
    }
    prev = a;
  }
  if (!out.length) return null;
  return keepMistakes(out, gRec, g.moves, analysisSeries(g));
}
/* White-view series from lichess analysis */
function analysisSeries(g) {
  if (!g.analysis) return null;
  return wpSeries(g.analysis.map(function (a) { return a ? evalCp(a) : null; }));
}
/* the stored cards of a game: the decisive mistake always, then the
   biggest swings up to the cap; time-scramble moves (under 5 seconds on the
   clock) count in the rates but are trained only when they decided the
   game */
function keepMistakes(list, gRec, moves, wp) {
  /* one idea, one card: when the opponent left a mistake unpunished and I
     repeated it on my next move (same refutation, or same missed move),
     only the first stays */
  list = list.slice().sort(function (x, y) { return x.p - y.p; }).filter(function (b, i, all) {
    var prev = all[i - 1];
    if (!prev || prev.p !== b.p - 2) return true;
    var r0 = unpackUci(prev.ru)[0], r1 = unpackUci(b.ru)[0];
    return !((r0 && r0 === r1) || prev.bu === b.bu);
  });
  var probe = { res: gRec.res, color: gRec.color, wp: wp, bl: list };
  markDecisive(probe);
  list.forEach(function (b) { if (b.c != null && b.c < 5 && !b.d) b.sc = 1; });
  var ranked = list.slice().sort(function (x, y) {
    return (y.d ? 1 : 0) - (x.d ? 1 : 0) || (x.sc ? 1 : 0) - (y.sc ? 1 : 0) || (y.wb - y.wa) - (x.wb - x.wa);
  });
  var kept = ranked.slice(0, MISTAKES_PER_GAME).sort(function (x, y) { return x.p - y.p; });
  kept.forEach(function (b) { classifyEntry(b, moves); });
  kept = kept.filter(function (b) { return !b.x; });
  return kept.length ? kept : null;
}
/* the next few real moves after mine, as long as the opponent played well */
/* what the game move allowed: when the opponent's reply was itself judged
   an error, lichess's own best line for that reply is the refutation (it
   starts from the position after the game move); otherwise the game's own
   continuation, until the opponent errs */
function refutationOf(g, pre, i) {
  var next = g.analysis[i + 1];
  if (next && next.judgment && next.variation) {
    var post = cloneState(pre), toks = g.moves.split(' ');
    if (sanApply(post, toks[i])) {
      var line = sanLineToUci(post, next.variation.split(' ').slice(0, 8));
      if (line.length) return line;
    }
  }
  return gameContinuation(g, pre, i);
}
function gameContinuation(g, pre, i) {
  var toks = g.moves.split(' '), st = cloneState(pre), out = [];
  for (var k = i; k < Math.min(toks.length, i + 7); k++) {
    if (k > i && (k - i) % 2 === 1) {
      var ja = g.analysis[k];
      if (ja && ja.judgment) break;                 /* they erred: no longer the refutation */
    }
    var mv = sanToMove(st, toks[k]);
    if (!mv) break;
    if (k > i) out.push(moveUci(mv));
    applyMove(st, mv);
  }
  return out;
}
function uciOfSan(moves, i) {
  var st = stateAtPly(moves, i);
  if (!st) return null;
  var mv = sanToMove(st, moves.split(' ')[i]);
  return mv ? moveUci(mv) : null;
}
function sanLineToUci(st0, sans) {
  var st = cloneState(st0), out = [];
  for (var i = 0; i < sans.length; i++) {
    var mv = sanToMove(st, sans[i]);
    if (!mv) break;
    out.push(moveUci(mv));
    applyMove(st, mv);
  }
  return out;
}

/* name the mistake from what the lines show; cheap (a few ms), so it runs
   at ingest, at scan and again after every deeper look */
/* raise when the classifier changes: stored mistakes are re-labelled on load */
var CLASSIFY_V = 4;        /* bump whenever test/explanations.txt changes (CI checks) */
function classifyEntry(b, moves) {
  var pre = stateAtPly(moves, b.p);
  if (!pre) return;
  var played = uciOfSan(moves, b.p);
  var best = { pv: unpackUci(b.lu), mate: b.mb != null ? b.mb : null };
  if (!best.pv.length && b.bu) best.pv = [b.bu];
  var after = { pv: unpackUci(b.ru), mate: b.ma };
  if (!played || !best.pv.length) return;
  if (best.pv[0] === played) { b.x = 'same'; return; }       /* not a mistake at all */
  var c = classifyMistake(pre, played, best, after, b.wb, b.wa, b.p);
  b.t = c.t;
  b.ph = phaseOf(pre, b.p);
  b.v = Math.max(b.v || 0, 1);
  b.cv = CLASSIFY_V;
}

/* ── the in-browser scan ────────────────────────────────────────────────── */
var TRIAGE_NODES = 18000; /* fixed node budget: big swings are visible well
                             below this, and a deeper look re-checks every
                             card before it teaches */
function scanGame(g) {
  /* Retained movetext scans fetch nothing; only games outside the retained
     batch still cost one export call. */
  var myGen = gen;
  var src = g.mv && !g.bl
    ? Promise.resolve({ moves: g.mv, clocks: g.ck || null })
    : getJSON('/game/export/' + g.id + '?moves=true&clocks=true', { quiet: true })
        .catch(function () { return null; });
  return src
    .then(function (full) {
      if (stale(myGen)) return;
      if (!full || !full.moves) {
        /* a failed fetch is not a game with nothing to teach: count the
           miss and let a later pass retry; never persist it as scanned */
        scanMiss(g);
        return;
      }
      var toks = full.moves.split(' ');
      var meWhite = g.color === 'white';
      var st = chessStart();
      var evals = [];             /* engine result after each ply, White's view */
      var fens = [], walkOk = true, LAST = 200;
      toks.forEach(function (tok, i) {
        if (!walkOk) { fens[i] = null; return; }
        if (!sanApply(st, tok)) { walkOk = false; fens[i] = null; return; }
        fens[i] = i >= LAST ? null : stateFen(st);
      });
      var CUTOFF = 64, failed = 0, scanN = scanNodes();
      function dispatch(from, to) {
        var jobs = [];
        fens.forEach(function (fen, i) {
          if (!fen || i < from || i >= to) return;
          jobs.push(engineEval(fen, { nodes: scanN }).then(function (r) {
            if (stale(myGen)) return;
            evals[i] = r;
          }).catch(function () { evals[i] = null; failed++; }));
        });
        return Promise.all(jobs);
      }
      var chain = dispatch(0, CUTOFF).then(function () {
        if (stale(myGen) || toks.length <= CUTOFF) return;
        /* a decided game stops costing at the crush, but only when the
           result agrees: a won position that was later lost is exactly the
           mistake worth finding */
        var tail = [];
        for (var ti = CUTOFF - 1; ti >= 8 && tail.length < 4; ti--) {
          if (evals[ti]) tail.push(winPct(meWhite ? evals[ti].cp : -evals[ti].cp));
        }
        var crushing = tail.length >= 3 && tail.every(function (w) { return w > 96; });
        var crushed = tail.length >= 3 && tail.every(function (w) { return w < 4; });
        if ((crushing && g.res === 'win') || (crushed && g.res === 'loss')) return;
        return dispatch(CUTOFF, LAST);
      });
      return chain.then(function () {
        if (stale(myGen)) return;
        var got = 0;
        evals.forEach(function (r) { if (r) got++; });
        /* a scan with holes is not a scan: a later pass does it again */
        if (!got || failed) { scanMiss(g); return; }
        var min = mistakeMinFor(g), inc = 0;
        var tcb = String(g.tc || '').split('+');
        if (tcb[1]) inc = +tcb[1] || 0;
        var bl = [], sign = meWhite ? 1 : -1;
        var entry = function (i, wb, wa) {
          var pre = stateAtPly(full.moves, i);
          if (!pre) return null;
          var bestUci = evals[i - 1].bestUci;   /* best from the position before */
          var bm = bestUci ? uciToMove(pre, bestUci) : null;
          if (!bm || bestUci === uciOfSan(full.moves, i)) return null;
          var pv0 = evals[i - 1].pv || [];
          var lu = [bestUci].concat(pv0[0] === bestUci ? pv0.slice(1, 8) : []);
          return {
            p: i, wb: wb, wa: wa,
            c: (full.clocks && full.clocks[i] != null) ? Math.round(full.clocks[i] / 100) : null,
            tt: thinkTime(full.clocks, i, inc),
            bu: bestUci, lu: packUci(lu),
            ru: packUci((evals[i].pv || []).slice(0, 8)),
            mb: evals[i - 1].mate != null ? evals[i - 1].mate * sign : null,
            ma: evals[i].mate != null ? evals[i].mate * sign : null,
            eb: evals[i - 1].cp * sign,
            j: 's'
          };
        };
        for (var i = 1; i < toks.length; i++) {
          if (!evals[i] || !evals[i - 1]) continue;
          if ((i % 2 === 0) !== meWhite) continue;
          var wb = winPct(sign * evals[i - 1].cp);
          var wa = winPct(sign * evals[i].cp);
          if (wb - wa < min) continue;
          var e = entry(i, wb, wa);
          if (e) bl.push(e);
        }
        var cps = [];
        for (var k = 0; k < toks.length && k < LAST; k++) cps.push(evals[k] ? evals[k].cp : null);
        g.wp = wpSeries(cps);
        g.bl = bl.length ? keepMistakes(bl, g, full.moves, g.wp) : null;
        g.mv = g.bl ? full.moves : null;   /* movetext stays only where cards live */
        delete g.ck;                        /* the clocks did their job */
        g.scanned = 1;
        g.eng = SF.build || 'sf17.1';       /* which engine judged this game */
        if (scanN !== TRIAGE_NODES) g.scanN = scanN; else delete g.scanN;
        scanState.dirty = (scanState.dirty || 0) + 1;
        modelDirty();
      });
    });
}

