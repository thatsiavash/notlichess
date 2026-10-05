// The card flow, run on the built page in Node (test/app-realm.js) with the fixture games: what each
// frame of a card draws, checked as data (boardOptsFor) against the spoiler rule of the redesign spec
// (projects/lichess-launcher/ux-2026-10-03/FINAL-SPEC.md, 2.3). Node has no engine, so a try is answered
// by a stub with the card's stored refutation; timers run on the realm's fake clock (setNow, flush).
// Each slice of the redesign adds the frames it builds to these loops. node test/cardflow.test.js
const fs = require('fs'), path = require('path');
const makeApp = require('./app-realm');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const base = () => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': FIX });
const boot = (o) => { const A = makeApp(Object.assign({ now: T0, storage: base() }, o || {})); A.ev(ENGINE); return A; };
const tick = () => new Promise((r) => setImmediate(r));
/* the fake clock: move the realm's time on, then run what its timers queued */
const later = (A, ms, rounds) => { A.setNow(A.getNow() + ms); A.flush(rounds || 1); };

let failed = 0, passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; results.push('FAIL ' + name + ': ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(c, what) { if (!c) throw new Error(what || 'condition failed'); }

/* the engine, for tries: the tried move is answered with the card's stored
   refutation (the reply that punished the game move, when it is legal after
   the try, else the first legal reply), scored as the game move was; the
   expected move is scored as the best. Searches without searchmoves wait in
   window.__evals for a test to answer them. Answers come on the next tick.
   Every job keeps its opts (the tag among them), and every engineStop call
   is kept in window.__stops. The real engine fails to load in Node a few
   ticks after boot (SF.state 'failed', where a try is never checked):
   readyEngine() says it is up */
const ENGINE = `(function () {
  window.__evals = [];
  window.__stops = [];
  var realStop = engineStop;
  engineStop = function (tag) { window.__stops.push(tag); return realStop.apply(this, arguments); };
  engineEval = function (fen, mt, prio, opts) {
    opts = opts || {};
    var job = { fen: fen, nodes: mt && mt.nodes, opts: opts };
    window.__evals.push(job);
    var a = ui.session && ui.session.active, sm = opts.searchmoves;
    if (!a || !sm) return new Promise(function (res, rej) { job.res = res; job.rej = rej; });
    var b = a.it.b, st = stateFromFen(fen), sign = myPov(a.it) ? 1 : -1;
    var u = sm[0], expect = sm[1], tried = uciToMove(st, u);
    var after = cloneState(st);
    if (tried) applyMove(after, tried);
    var ru = unpackUci(b.ru), stored = !!(ru.length && tried && playUci(after, ru).uci.length === ru.length);
    var reply = stored ? ru : (legalMoves(after)[0] ? [moveUci(legalMoves(after)[0])] : []);
    var gameCp = b.ea != null ? b.ea : (b.ma != null ? (b.ma > 0 ? 1500 : -1500) : cpFromWin(b.wa));
    var lines = [{ cp: gameCp * sign, mate: stored && b.ma != null ? b.ma * sign : null, pv: [u].concat(reply) }];
    if (expect) lines.push({ cp: b.eb * sign, mate: b.mb != null ? b.mb * sign : null, pv: [expect] });
    var r = { cp: lines[0].cp, mate: lines[0].mate, bestUci: u, pv: lines[0].pv, lines: lines, depth: 18, stopped: false };
    job.answer = r;
    return Promise.resolve(r);
  };
  window.readyEngine = function () { SF.state = 'ready'; return 1; };
  return 1;
})()`;
/* one card as the active card of a one-card session (every card opens in guess) */
const OPEN = `function openCard(it) {
  ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
  var a = cardFor(it);
  if (!a) return null;
  ui.session.active = a;
  return a;
}`;
/* the spoiler rule (FINAL-SPEC 2.3), on the frame the user sees. Before an
   answer (guess, checking, tried, reply) a frame may not show a green arrow,
   a gold arrow, a gold hint ring other than hint 2's on the answer's
   from-square, a hint's prize ring on that square, any ring, arrow end,
   token, guard line, tried cross, badge or tint on the answer's to-square,
   a slide of the solver's own piece while guessing, a bar that is not
   waiting, or a board name that says the answer. Exempt: the red game-move
   arrow, last-move tints, selection and legal dots, the nope outline, the
   player's own drawn shapes, the badge and tints of the move just played,
   threat marks on the answer's from-square, the forcing reply's own arrow,
   ring and token, and the slide of the player's own try (or of the move
   just played in a forcing line). Inside a forcing line the answer is the
   move due now. Marks are read from both forms boardSvg takes: the older
   single names (bad, good, ghost, hint) and the lists (arrows, rings,
   tokens, guards, tried, badges, tints). Returns the faults, [] when clean */
const SPOILER = `function spoilerFaults(a, f) {
  f = f || boardOptsFor(a);
  var o = f.opts, out = [];
  if (['guess', 'checking', 'tried', 'reply'].indexOf(a.phase) < 0) return out;
  var due = a.sol && a.solIdx > 0 ? uciToMove(a.st, a.sol[a.solIdx]) : a.best;
  var own = a.phase === 'tried' ? [a.tried.from, a.tried.to] : a.phase === 'checking' ? a.ghostMove : a.phase === 'reply' ? a.lastMove : null;
  var onTo = function (what, sqs) { if (sqs.indexOf(due.to) >= 0) out.push(what + ' on the answer square ' + sqName(due.to)); };
  var arrows = [], rings = (o.hint != null ? [{ sq: o.hint, kind: 'hint' }] : []).concat(o.rings || []);
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better' });
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  arrows.concat(o.arrows || []).forEach(function (m) {
    if (m.kind === 'game' || m.kind === 'reply') return;
    var what = m.kind === 'better' ? 'green arrow' : m.kind === 'explore' ? 'gold arrow' : m.kind + ' arrow';
    if (m.kind === 'better' || m.kind === 'explore') out.push(what + ' on ' + sqName(m.from) + '-' + sqName(m.to));
    onTo(what, [m.from, m.to]);
  });
  rings.forEach(function (m) {
    if (m.kind === 'nope' || m.kind === 'reply') return;
    if (m.kind === 'hint' && !(a.hints >= 2 && m.sq === due.from)) out.push('gold ring on ' + sqName(m.sq));
    if (m.kind === 'target' && m.sq === due.from) out.push('prize ring on the answer piece ' + sqName(m.sq));
    onTo((m.kind === 'hint' ? 'gold' : m.kind) + ' ring', [m.sq]);
  });
  (o.tokens || []).forEach(function (m) { if (a.phase !== 'reply') onTo('token', [m.sq]); });
  (o.guards || []).forEach(function (m) { onTo('guard line', [m.from, m.to]); });
  (o.tried || []).forEach(function (m) { onTo('tried cross', [m.sq != null ? m.sq : m.to]); });
  (o.badges || []).concat(o.tints || []).forEach(function (m) { if (!own || own.indexOf(m.sq) < 0) onTo(m.kind + ' badge or tint', [m.sq]); });
  var mover = o.anim && f.st.b[o.anim[1]];
  if (mover && isW(mover) === myPov(a.it) && !sameMove(own, o.anim)) out.push('replays a move of yours, ' + o.anim.map(sqName).join('-'));
  if (!f.pending) out.push('the bar shows the score');
  if (String(o.label || '').split(/[\\s.]+/).indexOf(sanOf(a.st, due)) >= 0) out.push('the board name says ' + sanOf(a.st, due));
  return out;
}`;
/* the frames after a miss: the try on the board, their reply once See it
   plays it, and the card again after Try again (the automatic hint by tier) */
const AFTER = `function afterMiss(a, check, what) {
  if (a.phase !== 'tried' || !a.tried) return check(what + ', not on the board but ' + a.phase, true);
  check(what + ', on the board');
  if (a.tried.reply) { seeIt(); check(what + ', See it'); }
  tryAgain(); check(what + ', after Try again');
}
function offBook(a) {
  return legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0] || null;
}`;

(async () => {
  await test('the spoiler rule holds on every card before an answer, tiers 1 to 3 (open, hints 0 to 2, after a miss)', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER} ${AFTER}
      var out = [], cards = 0, frames = 0, its = allMistakes().filter(trainable);
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        its.forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          cards++;
          var check = function (what, fault) {
            frames++;
            if (fault) out.push('tier ' + tier + ' ' + it.key + ' ' + what);
            else spoilerFaults(a).forEach(function (x) { out.push('tier ' + tier + ' ' + it.key + ' ' + what + ': ' + x); });
          };
          [0, 1, 2].forEach(function (h) { a.hints = h; check('hints ' + h); });
          /* the game move again, tapped: it stays on the board */
          a = openCard(it);
          a.tapped = true;
          gradeMove(uciToMove(a.st, a.playedUci));
          afterMiss(a, check, 'game move again');
        });
      });
      return JSON.stringify({ out: out, cards: cards, frames: frames, trainable: its.length }); })()`));
    ok(r.trainable >= 90 && r.cards === 3 * r.trainable, r.cards + ' cards of ' + r.trainable);
    ok(r.frames >= 5 * r.cards, 'frames ' + r.frames);
    eq(r.out.length, 0, r.out.length + ' spoilers, first: ' + r.out.slice(0, 3).join(' | '));
    /* a try off the card's lines, tapped: the checking frame, then the
       engine's miss (the stub answers on the next tick) */
    A.ev(`(function () { ${OPEN} ${SPOILER} ${AFTER}
      window.__t = { open: openCard, faults: spoilerFaults, after: afterMiss, offBook: offBook, out: [], frames: 0, misses: 0 };
      window.__t.check = function (a, what, fault) {
        window.__t.frames++;
        if (fault) window.__t.out.push(what);
        else spoilerFaults(a).forEach(function (x) { window.__t.out.push(what + ': ' + x); });
      };
      return 1; })()`);
    const n = A.ev('allMistakes().filter(trainable).length');
    for (const tier of [1, 2, 3]) {
      A.ev(`(playerTier = function () { return ${tier}; }, 1)`);
      for (let i = 0; i < n; i++) {
        const waiting = A.ev(`(function () { var T = window.__t, it = allMistakes().filter(trainable)[${i}], a = T.open(it);
          var m = a && T.offBook(a);
          if (!m) return false;
          a.tapped = true;
          window.readyEngine();
          gradeMove(m);
          T.check(a, 'tier ${tier} ' + it.key + ' checking');
          return a.phase === 'checking'; })()`);
        if (!waiting) continue;
        await tick(); await tick();
        A.ev(`(function () { var T = window.__t, a = ui.session.active, at = 'tier ${tier} ' + a.key + ' a miss';
          if (a.phase === 'checking') T.check(a, at + ': still checking', true);
          if (a.phase !== 'tried' || a.tried.kind !== 'miss') return 0;
          T.misses++;
          T.after(a, function (what, fault) { T.check(a, what, fault); }, at);
          return 1; })()`);
      }
    }
    const t = JSON.parse(A.ev('JSON.stringify({ out: window.__t.out, frames: window.__t.frames, misses: window.__t.misses })'));
    ok(t.misses >= 2 * n, 'engine misses ' + t.misses);
    eq(t.out.length, 0, t.out.length + ' spoilers after an engine miss, first: ' + t.out.slice(0, 3).join(' | '));
  });

  await test('the spoiler check sees an answer drawn on the board', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER}
      var a = openCard(allMistakes().filter(trainable)[0]), f = boardOptsFor(a), b = a.best;
      var doctor = function (fn) { var g = JSON.parse(JSON.stringify(f)); g.st = f.st; fn(g); return spoilerFaults(a, g).length; };
      a.hints = 1;
      return JSON.stringify({
        clean: spoilerFaults(a, f).length,
        green: doctor(function (g) { g.opts.good = [b.from, b.to]; }),
        gold: doctor(function (g) { g.opts.ghost = [b.from, b.to]; }),
        ringEarly: doctor(function (g) { g.opts.hint = b.from; }),
        ringOnTo: (a.hints = 2, doctor(function (g) { g.opts.hint = b.to; })),
        slide: (a.hints = 0, doctor(function (g) { g.opts.anim = [a.played.from, a.played.from]; g.st = cloneState(a.pre); })),
        bar: doctor(function (g) { g.pending = false; }),
        label: doctor(function (g) { g.opts.label = 'Play ' + sanOf(a.st, b) + '.'; }),
        /* the same marks in the lists boardSvg also takes, and the new ones */
        greenList: doctor(function (g) { g.opts.arrows = [{ from: b.from, to: b.to, kind: 'better' }]; }),
        goldList: doctor(function (g) { g.opts.arrows = [{ from: b.from, to: b.to, kind: 'explore' }]; }),
        ringList: doctor(function (g) { g.opts.rings = [{ sq: b.from, kind: 'hint' }]; }),
        threatOnTo: doctor(function (g) { g.opts.arrows = [{ from: a.played.from, to: b.to, kind: 'threat' }]; }),
        prizeOnFrom: doctor(function (g) { g.opts.rings = [{ sq: b.from, kind: 'target' }]; }),
        ringOnToList: doctor(function (g) { g.opts.rings = [{ sq: b.to, kind: 'threat' }]; }),
        token: doctor(function (g) { g.opts.tokens = [{ sq: b.to, p: 'q', kind: 'won' }]; }),
        guard: doctor(function (g) { g.opts.guards = [{ from: a.played.from, to: b.to }]; }),
        tried: doctor(function (g) { g.opts.tried = [{ from: a.played.from, to: b.to }]; }),
        badge: doctor(function (g) { g.opts.badges = [{ sq: b.to, kind: 'good' }]; }),
        tint: doctor(function (g) { g.opts.tints = [{ sq: b.to, kind: 'good' }]; }),
        /* allowed: threat marks on the answer's piece, the game arrow, a nope
           outline, the forcing reply's own marks, a tried cross off the square */
        allowed: doctor(function (g) {
          g.opts.rings = [{ sq: b.from, kind: 'threat' }, { sq: b.to, kind: 'nope' }, { sq: b.to, kind: 'reply' }];
          g.opts.arrows = [{ from: a.played.from, to: b.to, kind: 'game' }, { from: a.played.from, to: b.to, kind: 'reply' }];
          g.opts.tried = [{ sq: a.played.from }];
        })
      }); })()`));
    eq(r.clean, 0, 'the real frame');
    eq(r.allowed, 0, 'marks the rule allows');
    ['green', 'gold', 'ringEarly', 'ringOnTo', 'slide', 'bar', 'label', 'greenList', 'goldList', 'ringList', 'threatOnTo', 'prizeOnFrom',
      'ringOnToList', 'token', 'guard', 'tried', 'badge', 'tint'].forEach((k) => ok(r[k] > 0, k + ' not caught'));
  });

  await test('boardOptsFor writes nothing: the same card gives the same frame twice', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.lu).length >= 2; })[0];
      var snap = function (a) { return JSON.stringify(a, function (k, v) { return k === 'preKey' ? undefined : v; }); };
      var same = function (what, a) {
        var s0 = snap(a), f1 = JSON.stringify(boardOptsFor(a)), s1 = snap(a), f2 = JSON.stringify(boardOptsFor(a));
        if (s0 !== s1) out.push(what + ': the card changed');
        if (f1 !== f2) out.push(what + ': the frame changed');
        if (snap(a) !== s1) out.push(what + ': the card changed on the second call');
      };
      var a = openCard(it);
      same('open', a);
      a.sel = a.played.from; same('a piece selected', a); a.sel = -1;
      a.hints = 2; same('hint 2', a); a.hints = 0;
      var other = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
      gradeMove(other); same('checking a try', a);
      a = openCard(it); reveal();
      same('answered', a);
      a.lastView = { line: 'best', idx: -1 }; a.view = { line: 'best', idx: 0 }; same('a line stepped forward', a);
      startExplore({}); same('exploring', a);
      explorePlay(legalMoves(a.explore.st)[0], false); same('exploring, a move sliding', a);
      return JSON.stringify(out); })()`));
    eq(r.length, 0, r.join(' | '));
  });

  await test('the engine stub answers a try with the stored refutation, and the try is a miss', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var pick = null;
      allMistakes().filter(trainable).some(function (it) {
        var a = openCard(it), ru = unpackUci(it.b.ru);
        if (!a || a.sol || !ru.length) return false;
        var m = legalMoves(a.st).filter(function (x) {
          var u = moveUci(x);
          if (u === a.bestUci || u === a.playedUci) return false;
          var after = cloneState(a.st); applyMove(after, x);
          return playUci(after, ru).uci.length === ru.length;
        })[0];
        if (m) pick = { a: a, m: m, ru: ru };
        return !!m;
      });
      gradeMove(pick.m);
      window.__try = { u: moveUci(pick.m), ru: pick.ru, best: pick.a.bestUci };
      return JSON.stringify({ phase: pick.a.phase, u: window.__try.u }); })()`));
    eq(r.phase, 'checking', 'waiting on the engine');
    for (let i = 0; i < 4; i++) await tick();
    later(A, 10000, 8);
    const s = JSON.parse(A.ev(`JSON.stringify({ misses: ui.session.active.misses, phase: ui.session.active.phase,
      sm: window.__evals[0].opts.searchmoves, pv: window.__evals[0].answer.pv, t: window.__try })`));
    eq(JSON.stringify(s.sm), JSON.stringify([s.t.u, s.t.best]), 'the try and the answer, side by side');
    eq(JSON.stringify(s.pv), JSON.stringify([s.t.u].concat(s.t.ru)), 'the stored refutation');
    eq(s.misses, 1, 'misses');
    ok(s.phase !== 'checking' && s.phase !== 'done', s.phase);
  });

  await test('after a miss, flushing every timer moves no piece', async () => {
    const A = boot();
    /* the frame on screen: the position drawn, its last move and any slide,
       and the card's own state */
    const FRAME = `JSON.stringify((function (a) { var f = boardOptsFor(a);
      return { phase: a.phase, shown: stateFen(f.st), last: f.last, anim: f.opts.anim || null, st: stateFen(a.st),
               tried: a.tried, misses: a.misses, hints: a.hints, result: a.result || null, view: a.view }; })(ui.session.active))`;
    const still = (what) => {
      const f0 = A.ev(FRAME);
      later(A, 60000, 30);
      eq(A.timers.length, 0, what + ': timers left');
      eq(A.ev(FRAME), f0, what + ': the frame after every timer ran');
      return JSON.parse(f0);
    };
    /* an engine miss: a try off the card's lines, tapped */
    A.ev(`(function () { ${OPEN} ${AFTER}
      allMistakes().filter(trainable).some(function (it) {
        var a = openCard(it), m = a && !a.sol && unpackUci(it.b.ru).length && offBook(a);
        if (!m) return false;
        a.tapped = true;
        window.readyEngine();
        gradeMove(m);
        return true;
      });
      return 1; })()`);
    for (let i = 0; i < 4; i++) await tick();
    let f = still('an engine miss');
    eq(f.phase, 'tried', 'the try stays'); eq(f.misses, 1, 'misses'); ok(f.tried && f.tried.kind === 'miss' && f.tried.reply, 'a miss with a reply');
    ok(f.shown !== f.st, 'the try is drawn over the position before it');
    /* See it plays their one reply, on the tap; then nothing more */
    A.ev('seeIt()');
    f = still('their reply, seen');
    ok(f.tried.seen && !(f.last[0] === f.tried.from && f.last[1] === f.tried.to), 'the reply is the last move');
    /* the game move again: no engine, the same rule */
    A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[3], a = openCard(it);
      a.tapped = true;
      gradeMove(uciToMove(a.st, a.playedUci));
      return 1; })()`);
    f = still('the game move again');
    eq(f.phase, 'tried', 'the game move stays'); eq(f.misses, 1, 'misses');
    A.ev('seeIt()');
    still('the game move again, their reply seen');
    /* a third miss shows nothing by itself: the answer waits for a tap */
    A.ev(`(function () { var a = ui.session.active; tryAgain(); a.misses = 2; a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`);
    f = still('a third miss');
    eq(f.misses, 3, 'misses'); eq(f.phase, 'tried', 'phase'); eq(f.result, null, 'no result');
    /* after an answer nothing moves either: a solve on a one-move card, the
       answer shown, and the answer shown while a try was on the board */
    const ONE = `${OPEN} var it = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && unpackUci(x.b.ru).length; })[0], a = openCard(it);`;
    A.ev(`(function () { ${ONE} a.tapped = true; window.__nlTest.play(a.bestUci); return 1; })()`);
    f = still('a solve');
    eq(f.phase, 'done', 'solved'); eq(f.result, 'first', 'result');
    A.ev(`(function () { ${ONE} reveal(); return 1; })()`);
    f = still('the answer shown');
    eq(f.phase, 'done', 'revealed'); eq(f.result, 'fail', 'result');
    A.ev(`(function () { ${ONE} a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); reveal(); return 1; })()`);
    f = still('the answer shown over a try');
    eq(f.phase, 'done', 'revealed over a try'); eq(f.tried, null, 'the try is gone'); eq(f.result, 'fail', 'result');
  });

  await test('a reveal or hint click within 450 ms of Try again or See it does nothing', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const S = () => JSON.parse(A.ev(`JSON.stringify((function (a) { return { phase: a.phase, result: a.result || null, hints: a.hints,
      misses: a.misses, seen: !!(a.tried && a.tried.seen) }; })(ui.session.active))`));
    const wait = (ms) => A.setNow(A.getNow() + ms);
    /* card n, after its game move again with this many misses before it */
    const gameMove = (n, before) => A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[${n}], a = openCard(it);
      a.misses = ${before}; gradeMove(uciToMove(a.st, a.playedUci)); return a.phase; })()`);
    /* Try again at miss 1: the bar becomes [Hint] [Show the answer] under the thumb */
    eq(gameMove(0, 0), 'tried', 'the game move stays');
    wait(1000);
    A.click('tryAgain');
    eq(S().phase, 'guess', 'Try again takes the try back');
    wait(150);
    A.click('reveal'); A.click('hint');
    let s = S();
    eq(s.result, null, 'a reveal 150 ms after Try again'); eq(s.hints, 0, 'a hint 150 ms after Try again'); eq(s.phase, 'guess', 'phase');
    wait(400);
    A.click('hint');
    eq(S().hints, 1, 'a hint 550 ms after Try again');
    wait(150);
    A.click('reveal');
    eq(S().result, null, 'a reveal 150 ms after a hint');
    wait(500);
    A.click('reveal');
    s = S();
    eq(s.phase, 'done', 'a reveal later shows the answer'); eq(s.result, 'fail', 'result');
    /* See it at miss 1: the left button becomes Hint */
    gameMove(1, 0);
    wait(1000);
    A.click('seeIt');
    ok(S().seen, 'See it plays their reply');
    wait(150);
    A.click('hint'); A.click('reveal');
    s = S();
    eq(s.phase, 'tried', 'the try stays'); eq(s.hints, 0, 'a hint 150 ms after See it'); eq(s.result, null, 'a reveal 150 ms after See it');
    wait(500);
    A.click('hint');
    s = S();
    eq(s.phase, 'guess', 'a hint later takes the try back'); eq(s.hints, 1, 'and gives hint 1');
    /* See it at miss 3: the left button becomes Show the answer */
    gameMove(2, 2);
    wait(1000);
    A.click('seeIt');
    wait(150);
    A.click('reveal');
    s = S();
    eq(s.misses, 3, 'misses'); eq(s.phase, 'tried', 'miss 3, the try stays'); eq(s.result, null, 'a reveal 150 ms after See it at miss 3');
    /* Keep looking after a close move, and Try again after a move that was not checked */
    A.ev(`(function () { ${OPEN} ${AFTER}
      var a = openCard(allMistakes().filter(trainable)[3]); a.attempts++; showTry(a, offBook(a), 'close', null); return 1; })()`);
    wait(1000);
    A.click('dismissStronger');
    eq(S().phase, 'guess', 'Keep looking takes the try back');
    wait(150);
    A.click('hint'); A.click('reveal');
    s = S();
    eq(s.hints, 0, 'a hint 150 ms after Keep looking'); eq(s.result, null, 'a reveal 150 ms after Keep looking');
    A.ev(`(function () { ${OPEN} ${AFTER}
      var a = openCard(allMistakes().filter(trainable)[4]); SF.state = 'failed'; gradeMove(offBook(a)); return a.tried && a.tried.kind; })()`);
    wait(1000);
    A.click('tryAgain');
    wait(150);
    A.click('reveal');
    s = S();
    eq(s.phase, 'guess', 'Try again after a move not checked'); eq(s.result, null, 'a reveal 150 ms after it');
  });

  await test('a tap on any of your pieces takes a try back, the castled rook included', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      allMistakes().filter(trainable).forEach(function (it) {
        var a0 = openCard(it);
        if (!a0) return;
        legalMoves(a0.st).filter(function (m) { return m.castle && moveUci(m) !== a0.bestUci; }).forEach(function (m) {
          /* the king lands on m.to, the rook beside it, and each is picked up from where it came */
          var short_ = m.castle === 'O-O', rookTo = m.to + (short_ ? -1 : 1), rookFrom = m.to + (short_ ? 1 : -2);
          [[m.to, m.from], [rookTo, rookFrom]].forEach(function (p) {
            var a = openCard(it);
            showTry(a, uciToMove(a.st, moveUci(m)), 'miss', null);
            sessionClick(p[0]);
            n++;
            if (a.phase !== 'guess' || a.sel !== p[1]) out.push(it.key + ' ' + m.castle + ', a tap on ' + sqName(p[0]) + ': phase ' + a.phase + ', selected ' + (a.sel >= 0 ? sqName(a.sel) : 'none'));
          });
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n >= 8, 'castling tries ' + r.n);
    eq(r.out.length, 0, r.out.join(' | '));
  });

  await test('the automatic first hint comes at miss 1 at tier 1, at miss 2 at tier 2, never at tier 3', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = {}, its = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; });
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        out[tier] = its.slice(0, 5).map(function (it) {
          var a = openCard(it), seen = [];
          for (var i = 0; i < 3; i++) {
            if (a.phase === 'tried') tryAgain();
            gradeMove(uciToMove(a.st, a.playedUci));
            seen.push(a.phase === 'tried' && a.misses === i + 1 ? a.hints : 'phase ' + a.phase + ', misses ' + a.misses);
          }
          return seen.join(',');
        });
      });
      return JSON.stringify(out); })()`));
    const want = { 1: '1,1,1', 2: '0,1,1', 3: '0,0,0' };
    [1, 2, 3].forEach((t) => r[t].forEach((x, i) => eq(x, want[t], 'tier ' + t + ' card ' + i + ', hints after misses 1 to 3')));
  });

  await test('a try is searched with the check tag; Try again, Show the answer, Next and ending the session stop it', async () => {
    const A = boot();
    const stops = (code) => JSON.parse(A.ev(`(function () { window.__stops = []; ${code}; return JSON.stringify(window.__stops); })()`));
    const has = (list, what) => ok(list.indexOf('check') >= 0, what + ' stops the check search: ' + JSON.stringify(list));
    A.ev(`(function () { ${OPEN} ${AFTER}
      window.__t = { open: openCard, offBook: offBook };
      var a = openCard(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0]);
      window.readyEngine(); window.__evals = [];
      gradeMove(offBook(a));
      return 1; })()`);
    eq(A.ev('window.__evals.length'), 1, 'one search for the try');
    eq(A.ev('window.__evals[0].opts.tag'), 'check', 'its tag');
    await tick(); await tick();
    eq(A.ev('ui.session.active.tried && ui.session.active.tried.kind'), 'miss', 'the miss is on the board');
    has(stops('tryAgain()'), 'Try again');
    /* Show the answer while a check is still running */
    eq(A.ev('(function () { window.readyEngine(); gradeMove(window.__t.offBook(ui.session.active)); return ui.session.active.phase; })()'), 'checking', 'a second try');
    has(stops('reveal()'), 'Show the answer');
    has(stops('nextCard()'), 'Next');
    A.ev('(function () { window.__t.open(allMistakes().filter(trainable)[1]); return 1; })()');
    has(stops('endSession()'), 'Ending the session');
  });

  /* the board primitives (FINAL-SPEC 2.1), drawn by boardSvg as markup and
     read back here: SHOW draws every kind of mark at once on a card's own
     position, older single names and lists alike */
  const SHOW = `function showcase(a, flip) {
    var st = a.st, mine = [], theirs = [], empty = [];
    for (var s = 0; s < 64; s++) { var p = st.b[s]; if (!p) empty.push(s); else if (isW(p) === myPov(a.it)) mine.push(s); else theirs.push(s); }
    var o = { flip: flip, label: 'x', mark: [a.played.from], bad: [a.played.from, a.played.to], good: [a.best.from, a.best.to],
      ghost: [mine[1], empty[0]], hint: mine[2], shapes: [{ at: mine[0] }, { from: mine[0], to: empty[1] }],
      tints: [{ sq: a.played.from, kind: 'bad' }, { sq: empty[2], kind: 'close' }],
      ghosts: [{ sq: empty[3], p: 'B' }, { sq: theirs[0], p: 'n' }],
      guards: [{ from: mine[0], to: mine[1] }],
      arrows: [{ from: theirs[0], to: mine[0], kind: 'threat', key: 'x' }, { from: theirs[1], to: mine[1], kind: 'threat', key: 'x' },
               { from: theirs[1], to: empty[4], kind: 'reply', key: 'r', solid: true }, { from: mine[1], to: empty[5], kind: 'game' }],
      tried: [{ from: mine[2], to: empty[6] }, { sq: mine[3] }],
      rings: [{ sq: theirs[0], kind: 'threat' }, { sq: theirs[1], kind: 'reply' }, { sq: theirs[2] || theirs[0], kind: 'target' }, { sq: mine[0], kind: 'nope' }],
      tokens: [{ sq: empty[7], p: 'r', kind: 'lost' }, { sq: empty[8], p: 'N', kind: 'won', fx: 7 }],
      badges: [{ sq: a.played.to, kind: 'bad', fx: 7 }, { sq: empty[9], kind: 'good' }, { sq: empty[10], kind: 'close' }, { sq: empty[11], kind: 'checking' },
               { sq: empty[12], kind: 'unchecked' }, { sq: empty[13], kind: 'info' }] };
    return { o: o, svg: boardSvg(st, o), pieces: mine.length + theirs.length };
  }`;
  const CARDS = `${OPEN} var its = allMistakes().filter(trainable).slice(0, 12).map(function (it) { return openCard(it); }).filter(Boolean);`;
  /* the board svg and the marks svg, each with its own markup */
  const split = (html) => { const i = html.indexOf('</svg>') + 6; return { board: html.slice(0, i), marks: html.slice(i) }; };

  await test('board primitives: distinct marker ids', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${CARDS} ${SHOW}
      return JSON.stringify(its.map(function (a) { return [showcase(a, false).svg, showcase(a, true).svg]; })); })()`));
    r.forEach((pair, n) => {
      const ids = pair.map((h) => (h.match(/ id="[^"]+"/g) || []).map((x) => x.slice(5, -1)));
      ids.forEach((list, k) => {
        eq(new Set(list).size, list.length, 'card ' + n + ' board ' + k + ': ids ' + list.join(' '));
        /* seven arrows (three by the older names, two threats with one key, a
           reply, a game move) and the drawn shape's head: each its own id */
        eq(list.filter((x) => /^ah/.test(x)).length, 8, 'card ' + n + ' board ' + k + ': arrowheads');
        const refs = (pair[k].match(/url\(#[^)]+\)/g) || []).map((x) => x.slice(5, -1));
        refs.forEach((x) => ok(list.indexOf(x) >= 0, 'card ' + n + ': ' + x + ' points at no element'));
        const heads = [...pair[k].matchAll(/<line class="[a-z-]+-arrow"[^>]*marker-end="url\(#([^)]+)\)"/g)].map((x) => x[1]);
        eq(new Set(heads).size, 7, 'card ' + n + ': seven arrows, seven heads');
        ok(split(pair[k]).board.indexOf('<marker') < 0 && split(pair[k]).marks.indexOf('bad-arrow') > 0, 'card ' + n + ': the arrows live in the marks svg');
      });
      eq(ids[0].filter((x) => ids[1].indexOf(x) >= 0).length, 0, 'card ' + n + ': two boards on one page share no id');
    });
    ok(r.length >= 10, 'cards ' + r.length);
  });

  await test('board primitives: no data-sq on a ghost', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${CARDS} ${SHOW}
      return JSON.stringify(its.map(function (a) { var s = showcase(a, a.it.g.color === 'black'); return { svg: s.svg, pieces: s.pieces, ghostOn: s.o.ghosts[0].sq }; })); })()`));
    r.forEach((c, n) => {
      const ghosts = c.svg.match(/<use class="ghost-piece"[^>]*>/g) || [];
      /* the ghost on an empty square is drawn; on an occupied one, its cross alone */
      eq(ghosts.length, 1, 'card ' + n + ': ghost pieces');
      ok(!/data-sq/.test(ghosts[0]) && /opacity="\.34"/.test(ghosts[0]), 'card ' + n + ': ' + ghosts[0]);
      /* only the 64 squares and the real pieces answer a tap */
      const tagged = c.svg.match(/<(\w+)[^>]* data-sq="\d+"/g) || [];
      eq(tagged.filter((t) => /^<rect/.test(t)).length, 64, 'card ' + n + ': squares');
      eq(tagged.filter((t) => /^<use/.test(t)).length, c.pieces, 'card ' + n + ': pieces');
      eq(tagged.length, 64 + c.pieces, 'card ' + n + ': nothing else carries data-sq');
      ok(split(c.svg).marks.indexOf('data-sq') < 0, 'card ' + n + ': the marks svg has no data-sq');
    });
  });

  await test('board primitives: a badge lands on its own square on a flipped board, and pops once', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${CARDS}
      var a = its[0], out = [];
      [false, true].forEach(function (flip) {
        for (var sq = 0; sq < 64; sq++) out.push({ flip: flip, sq: sq, svg: boardSvg(a.st, { flip: flip, badges: [{ sq: sq, kind: 'bad' }], tokens: [{ sq: sq, p: 'q', kind: 'won' }] }) });
      });
      /* an effect id pops on its first paint only */
      var b1 = { flip: false, fx: 'k1', badges: [{ sq: 9, kind: 'good', fx: 'k1' }, { sq: 10, kind: 'bad', fx: 'k0' }] };
      var pops = [boardSvg(a.st, b1), boardSvg(a.st, b1), boardSvg(a.st, { flip: false, fx: 'k2', badges: [{ sq: 9, kind: 'good', fx: 'k1' }, { sq: 11, kind: 'close', fx: 'k2' }] })];
      return JSON.stringify({ out: out, pops: pops }); })()`));
    r.out.forEach((c) => {
      const name = (c.flip ? 'flipped ' : '') + 'sq ' + c.sq;
      const sq = c.svg.match(new RegExp('<rect data-sq="' + c.sq + '" x="([\\d.]+)" y="([\\d.]+)"'));
      const bd = c.svg.match(/<g class="badge badge-bad" transform="translate\(([\d.]+) ([\d.]+)\)"/);
      const tk = c.svg.match(/<g class="token token-won">(?:<g>)?<circle cx="([\d.]+)" cy="([\d.]+)"/);
      ok(sq && bd && tk, name + ': drawn');
      const x = +sq[1], y = +sq[2];
      /* the square drawn where the file and rank say, white at the bottom unless flipped */
      eq(x, (c.flip ? 7 - c.sq % 8 : c.sq % 8) * 45, name + ': square x');
      eq(y, (c.flip ? c.sq >> 3 : 7 - (c.sq >> 3)) * 45, name + ': square y');
      eq(+bd[1], x + 36, name + ': badge x'); eq(+bd[2], y + 9, name + ': badge y');
      eq(+tk[1], x + 12.5, name + ': token x'); eq(+tk[2], y + 32.5, name + ': token y');
    });
    const fx = r.pops.map((h) => (h.match(/class="mk-pop( fx-in)?" data-fx="(\w+)"/g) || []).join(' '));
    eq(fx[0], 'class="mk-pop fx-in" data-fx="k1" class="mk-pop" data-fx="k0"', 'first paint of k1: the k1 badge pops, the older one does not');
    eq(fx[1], 'class="mk-pop" data-fx="k1" class="mk-pop" data-fx="k0"', 'a repaint of k1 pops nothing');
    eq(fx[2], 'class="mk-pop" data-fx="k1" class="mk-pop fx-in" data-fx="k2"', 'the next effect id pops only its own badge');
  });

  await test('board primitives: a one-square arrow keeps the 4.2 head and stops 0.22 of a square short', () => {
    const A = boot();
    const sq = (s) => (s.charCodeAt(0) - 97) + (parseInt(s[1], 10) - 1) * 8;
    const cases = [['e4', 'e5', 0.22], ['e4', 'f5', 0.22], ['e4', 'd3', 0.22], ['e4', 'e6', 0.34], ['e4', 'f6', 0.34], ['a1', 'h8', 0.34]];
    const r = JSON.parse(A.ev(`(function () { var st = stateFromFen('8/8/8/8/4K3/8/8/k7 w - - 0 1'), out = [];
      ${JSON.stringify(cases.map((c) => [sq(c[0]), sq(c[1])]))}.forEach(function (c) {
        [false, true].forEach(function (flip) {
          ['game', 'threat', 'reply', 'better', 'explore'].forEach(function (kind) { out.push(boardSvg(st, { flip: flip, arrows: [{ from: c[0], to: c[1], kind: kind }] })); });
          out.push(boardSvg(st, { flip: flip, bad: c }));
        });
      });
      return JSON.stringify(out); })()`));
    let i = 0;
    cases.forEach((c) => [false, true].forEach((flip) => ['game', 'threat', 'reply', 'better', 'explore', 'bad (older name)'].forEach((kind) => {
      const h = r[i++], name = c[0] + '-' + c[1] + (flip ? ' flipped ' : ' ') + kind;
      const mk = h.match(/<marker [^>]*markerWidth="([\d.]+)" markerHeight="([\d.]+)"/);
      ok(mk && mk[1] === '4.2' && mk[2] === '4.2', name + ': head ' + (mk && mk[1]));
      const ln = h.match(/<line class="[a-z-]+-arrow"[^>]* x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/);
      const ctr = (s) => { const n = sq(s), col = flip ? 7 - n % 8 : n % 8, row = flip ? n >> 3 : 7 - (n >> 3); return [col * 45 + 22.5, row * 45 + 22.5]; };
      const f = ctr(c[0]), t = ctr(c[1]);
      ok(Math.abs(+ln[1] - f[0]) < 1e-6 && Math.abs(+ln[2] - f[1]) < 1e-6, name + ': starts at the centre of ' + c[0]);
      const short = Math.hypot(t[0] - +ln[3], t[1] - +ln[4]);
      ok(Math.abs(short - c[2] * 45) < 1e-6, name + ': stops ' + (short / 45).toFixed(3) + ' of a square short, not ' + c[2]);
    })));
  });

  await test('the board svg is #bwrap\'s first child, the marks svg over it', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var stub = function () { return { innerHTML: '', textContent: '', style: {}, classList: { toggle: function () {} }, querySelectorAll: function () { return []; } }; };
      var els = { bwrap: stub(), ebar: stub(), 'ebar-fill': stub(), 'ebar-lab': stub() }, get0 = document.getElementById;
      document.getElementById = function (id) { return els[id] || get0(id); };
      var out = [], its = allMistakes().filter(trainable).slice(0, 8);
      its.forEach(function (it) {
        var a = openCard(it);
        renderCardBoard(a); out.push({ what: 'open', html: els.bwrap.innerHTML });
        a.hints = 2; renderCardBoard(a); out.push({ what: 'hint 2', html: els.bwrap.innerHTML }); a.hints = 0;
        a.pendingPromo = { from: 0, to: 0 }; renderCardBoard(a); out.push({ what: 'promotion', html: els.bwrap.innerHTML }); a.pendingPromo = null;
        reveal(); renderCardBoard(a); out.push({ what: 'answered', html: els.bwrap.innerHTML });
      });
      document.getElementById = get0;
      return JSON.stringify(out); })()`));
    ok(r.length >= 32, 'frames ' + r.length);
    r.forEach((f, n) => {
      const p = split(f.html), name = 'frame ' + n + ' (' + f.what + ')';
      ok(/^<svg class="board" /.test(p.board), name + ': the board svg comes first');
      ok(/^<svg class="marks" viewBox="0 0 360 360" aria-hidden="true" style="pointer-events:none">/.test(p.marks), name + ': the marks svg comes next, ' + p.marks.slice(0, 60));
      ok(/<use [^>]*data-sq=/.test(p.board) && !/<line|<marker/.test(p.board), name + ': pieces in the board, no arrows');
      if (f.what === 'promotion') ok(p.marks.indexOf('</svg><div class="promo-card">') > 0, name + ': the promotion card after both');
      if (f.what === 'hint 2') ok(/class="hint-ring"/.test(p.marks), name + ': the hint ring in the marks');
    });
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'card flow: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
