// The card flow, run on the built page in Node (test/app-realm.js) with the fixture games: what each
// frame of a card draws, checked as data (boardOptsFor) against the spoiler rule of the redesign spec
// (projects/lichess-launcher/ux-2026-10-03/FINAL-SPEC.md, 2.3). Node has no engine, so a try is answered
// by a stub with the card's stored refutation; timers run on the realm's fake clock (setNow, flush, or
// advance, which runs each timer when it falls due).
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
   from-square, a hint's prize ring on that square, a threat arrow end or
   threat ring on that square outside phase tried (only S4 marks may touch
   it; a hint-1 or worked-example mark never does), any ring, arrow end,
   token, guard line, tried cross, badge or tint on the answer's to-square,
   a slide of the solver's own piece while guessing, a bar that is not
   waiting, or a board name that says the answer. Exempt: the red game-move
   arrow, last-move tints, selection and legal dots, the nope outline (it
   answers the player's own tap), the player's own drawn shapes, the badge
   and tints of the move just played, threat marks on the answer's
   from-square in phase tried, the forcing reply's own marks in phase reply
   (its arrow, its ring on either of its squares, its token where it lands;
   the reply is the line's next move while the opponent is to move, else the
   last move), and the slide of the player's own try (or of the move just
   played in a forcing line). Inside a forcing line the answer is the move
   due now. Marks are read from both forms boardSvg takes: the older single
   names (bad, good, ghost, hint) and the lists (arrows, rings, tokens,
   guards, tried, badges, tints). Returns the faults, [] when clean */
const SPOILER = `function spoilerFaults(a, f) {
  f = f || boardOptsFor(a);
  var o = f.opts, out = [];
  if (['guess', 'checking', 'tried', 'reply'].indexOf(a.phase) < 0) return out;
  var due = a.sol && a.solIdx > 0 ? uciToMove(a.st, a.sol[a.solIdx]) : a.best;
  var own = a.phase === 'tried' ? [a.tried.from, a.tried.to] : a.phase === 'checking' ? a.ghostMove : a.phase === 'reply' ? a.lastMove : null;
  var onTo = function (what, sqs) { if (sqs.indexOf(due.to) >= 0) out.push(what + ' on the answer square ' + sqName(due.to)); };
  var onFrom = function (what, sqs) { if (a.phase !== 'tried' && sqs.indexOf(due.from) >= 0) out.push(what + ' on the answer piece ' + sqName(due.from)); };
  /* the forcing reply: still to play while the opponent is to move, else just played */
  var rm = null;
  if (a.phase === 'reply') {
    var next = a.sol && a.sol[a.solIdx] && !!a.st.w !== myPov(a.it) ? uciToMove(a.st, a.sol[a.solIdx]) : null;
    rm = next ? [next.from, next.to] : a.lastMove;
  }
  var arrows = [], rings = (o.hint != null ? [{ sq: o.hint, kind: 'hint' }] : []).concat(o.rings || []);
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better' });
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  arrows.concat(o.arrows || []).forEach(function (m) {
    if (m.kind === 'game' || (m.kind === 'reply' && rm && sameMove(rm, [m.from, m.to]))) return;
    var what = m.kind === 'better' ? 'green arrow' : m.kind === 'explore' ? 'gold arrow' : m.kind + ' arrow';
    if (m.kind === 'better' || m.kind === 'explore') out.push(what + ' on ' + sqName(m.from) + '-' + sqName(m.to));
    if (m.kind === 'threat') onFrom(what, [m.from, m.to]);
    onTo(what, [m.from, m.to]);
  });
  rings.forEach(function (m) {
    if (m.kind === 'nope' || (m.kind === 'reply' && rm && rm.indexOf(m.sq) >= 0)) return;
    if (m.kind === 'hint' && !(a.hints >= 2 && m.sq === due.from)) out.push('gold ring on ' + sqName(m.sq));
    if (m.kind === 'target' && m.sq === due.from) out.push('prize ring on the answer piece ' + sqName(m.sq));
    if (m.kind === 'threat') onFrom('threat ring', [m.sq]);
    onTo((m.kind === 'hint' ? 'gold' : m.kind) + ' ring', [m.sq]);
  });
  (o.tokens || []).forEach(function (m) { if (!(rm && m.sq === rm[1])) onTo('token', [m.sq]); });
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
/* the card's page as recording stubs, so renderCard and the staged beats
   (14s-stage.js) really paint: every write is kept in window.__writes with
   the clock and motionUntil at that moment. #bwrap and the bar beside it
   take board writes, the marks svg marks writes, #trainbox the card's
   frame; the session bar, the band, the action bar, the strip and the live
   region take text writes. window.__els holds the nodes */
const DOM = `(function () {
  var log = window.__writes = [], els = window.__els = {};
  var kind = { bwrap: 'board', ebar: 'board', 'ebar-fill': 'board', marks: 'marks', trainbox: 'frame' };
  var note = function (id, what) { log.push({ id: id, what: what, kind: kind[id] || 'text', t: Date.now(), mu: motionUntil }); };
  var mk = function (id) {
    var n = { id: id, dataset: {}, focus: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
      contains: function () { return false; }, appendChild: function () {}, querySelectorAll: function () { return []; },
      querySelector: function (sel) { return id === 'bwrap' && sel === '.marks' ? els.marks : null; },
      classList: { toggle: function (c) { note(id, 'class ' + c); }, add: function () {}, remove: function () {}, contains: function () { return false; } } };
    ['innerHTML', 'textContent', 'className', 'outerHTML'].forEach(function (name) {
      var v = '';
      Object.defineProperty(n, name, { get: function () { return v; }, set: function (x) { v = x; note(id, name); } });
    });
    var h = '';
    n.style = {};
    Object.defineProperty(n.style, 'height', { get: function () { return h; }, set: function (x) { h = x; note(id, 'height'); } });
    return n;
  };
  ['trainbox', 'ctop', 'cband', 'bwrap', 'ebar', 'ebar-fill', 'ebar-lab', 'cpanel', 'cstrip', 'cbar', 'sr-live', 'marks'].forEach(function (id) { els[id] = mk(id); });
  var get0 = document.getElementById;
  document.getElementById = function (id) { return els[id] || get0(id); };
  /* a card opened as the page opens one: shown now, painted through renderCard */
  window.__show = function (it) {
    ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
    var a = cardFor(it);
    ui.session.active = a;
    a.shownAt = Date.now();
    renderCard();
    return a;
  };
  return 1;
})()`;
/* the writes that broke the sequencer's rule: a board, marks or frame
   write while a piece was sliding, or a text write sooner than 150 ms
   after the last slide ended */
const early = (ws) => ws.filter((w) => (w.kind === 'text' ? w.t < w.mu + 150 : w.t < w.mu));

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
        /* threat marks on the answer's piece belong to S4 alone: a hint-1 or
           worked-example mark (phase guess) never touches it */
        threatFromOnFrom: doctor(function (g) { g.opts.arrows = [{ from: b.from, to: a.played.to, kind: 'threat' }]; }),
        threatToOnFrom: doctor(function (g) { g.opts.arrows = [{ from: a.played.to, to: b.from, kind: 'threat' }]; }),
        threatRingOnFrom: doctor(function (g) { g.opts.rings = [{ sq: b.from, kind: 'threat' }]; }),
        /* a reply's marks outside phase reply are marks like any other */
        replyArrowOnTo: doctor(function (g) { g.opts.arrows = [{ from: a.played.from, to: b.to, kind: 'reply' }]; }),
        replyRingOnTo: doctor(function (g) { g.opts.rings = [{ sq: b.to, kind: 'reply' }]; }),
        /* allowed after a miss (phase tried): S4's threat marks on the
           answer's piece, the game arrow, a nope outline, a tried cross off
           the square */
        allowed: (a.phase = 'tried', a.tried = { from: a.played.from, to: a.played.to, kind: 'miss' }, doctor(function (g) {
          g.opts.rings = [{ sq: b.from, kind: 'threat' }, { sq: b.to, kind: 'nope' }];
          g.opts.arrows = [{ from: a.played.to, to: b.from, kind: 'threat' }, { from: a.played.from, to: b.to, kind: 'game' }];
          g.opts.tried = [{ sq: a.played.from }];
        })),
        /* in phase tried, a hint-1 threat arrow from the answer's piece reads
           as an S4 mark: the checker cannot tell them apart (slice 10 checks
           hint marks on their own) */
        threatInTried: doctor(function (g) { g.opts.arrows = [{ from: b.from, to: a.played.to, kind: 'threat' }]; }),
        threatOnToInTried: (a.phase = 'tried', doctor(function (g) { g.opts.arrows = [{ from: a.played.to, to: b.to, kind: 'threat' }]; }))
      }); })()`));
    eq(r.clean, 0, 'the real frame');
    eq(r.allowed, 0, 'marks the rule allows after a miss');
    eq(r.threatInTried, 0, 'S4 marks on the answer piece after a miss');
    ['green', 'gold', 'ringEarly', 'ringOnTo', 'slide', 'bar', 'label', 'greenList', 'goldList', 'ringList', 'threatOnTo', 'prizeOnFrom',
      'ringOnToList', 'token', 'guard', 'tried', 'badge', 'tint', 'threatFromOnFrom', 'threatToOnFrom', 'threatRingOnFrom', 'replyArrowOnTo',
      'replyRingOnTo', 'threatOnToInTried'].forEach((k) => ok(r[k] > 0, k + ' not caught'));
    /* the forcing reply's own marks, in phase reply: allowed on the reply's
       squares (while it is still to play, it is the move due now), and only
       there */
    const q = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER}
      playerTier = function () { return 3; };
      /* a forcing card whose reply does not land on the next answer's square */
      var a = allMistakes().filter(trainable).map(openCard).filter(function (x) {
        return x && x.sol && x.sol.length >= 3 && x.sol[2].slice(2, 4) !== x.sol[1].slice(2, 4);
      })[0];
      if (!a) return JSON.stringify(null);
      ui.session.active = a;
      var f = boardOptsFor(a), mine = uciToMove(a.st, a.sol[0]);
      var doctor = function (fn) { var g = JSON.parse(JSON.stringify(f)); g.st = f.st; fn(g); return spoilerFaults(a, g); };
      applyMove(a.st, mine); a.lastMove = [mine.from, mine.to]; a.solIdx = 1; a.phase = 'reply';
      var rp = uciToMove(a.st, a.sol[1]), other = legalMoves(a.st).filter(function (m) { return m.to !== rp.to && m.from !== rp.from; })[0];
      var res = {
        telegraph: doctor(function (g) { g.opts.arrows = [{ from: rp.from, to: rp.to, kind: 'reply' }]; g.opts.rings = [{ sq: rp.from, kind: 'reply' }]; }),
        threatOnReply: doctor(function (g) { g.opts.arrows = [{ from: other.from, to: rp.to, kind: 'threat' }]; })
      };
      applyMove(a.st, rp); a.lastMove = [rp.from, rp.to]; a.solIdx = 2;
      var due = uciToMove(a.st, a.sol[2]);
      res.landing = doctor(function (g) {
        g.opts.arrows = [{ from: rp.from, to: rp.to, kind: 'reply', solid: true }]; g.opts.rings = [{ sq: rp.to, kind: 'reply' }];
        g.opts.tokens = [{ sq: rp.to, p: 'q', kind: 'lost' }];
      });
      res.replyOnAnswer = doctor(function (g) { g.opts.arrows = [{ from: rp.to, to: due.to, kind: 'reply' }]; });
      res.replyRingOnAnswer = doctor(function (g) { g.opts.rings = [{ sq: due.to, kind: 'reply' }]; });
      res.tokenOnAnswer = doctor(function (g) { g.opts.tokens = [{ sq: due.to, p: 'q', kind: 'lost' }]; });
      return JSON.stringify(res); })()`));
    ok(q, 'a forcing card of three moves or more at tier 3');
    eq(q.telegraph.length, 0, 'the telegraph: ' + q.telegraph.join(' | '));
    eq(q.landing.length, 0, 'the landing: ' + q.landing.join(' | '));
    ['threatOnReply', 'replyOnAnswer', 'replyRingOnAnswer', 'tokenOnAnswer'].forEach((k) => ok(q[k].length > 0, k + ' not caught'));
  });

  await test('boardOptsFor writes nothing: the same card gives the same frame twice', async () => {
    const A = boot();
    A.ev(`(function () {
      var out = window.__same = [], snap = function (a) { return JSON.stringify(a); };
      window.__sameFrame = function (what, a) {
        var s0 = snap(a), f1 = JSON.stringify(boardOptsFor(a)), s1 = snap(a), f2 = JSON.stringify(boardOptsFor(a));
        if (s0 !== s1) out.push(what + ': the card changed');
        if (f1 !== f2) out.push(what + ': the frame changed');
        if (snap(a) !== s1) out.push(what + ': the card changed on the second call');
      };
      return 1; })()`);
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = window.__same, same = window.__sameFrame, it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.lu).length >= 2; })[0];
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
      /* the card's own position, which the spoiler index knows: Stockfish keeps quiet there, and reading that writes nothing */
      exploreExit('silent'); a.view = { line: 'best', idx: -1 }; startExplore({});
      if (!ui.session.xpSpoil[xpCur(a.explore).key]) out.push('the position of the card is not in the spoiler index');
      same('exploring the position of the card', a);
      /* the spoiler check only reads, even with no key kept on the card */
      delete a.preKey; same('exploring the position of the card, no key kept', a); a.preKey = posKey(a.pre);
      exploreExit('silent'); a.view = { line: 'best', idx: 0 }; startExplore({});
      return JSON.stringify(out); })()`));
    eq(r.length, 0, r.join(' | '));
    /* Stockfish answers the explored position: the frame with a fresh
       result (the bar's live value) writes nothing either */
    await tick(); await tick();
    const job = A.ev(`(function () {
      var a = ui.session.active, ex = a.explore, n = xpCur(ex), j = window.__evals.filter(function (x) { return !x.opts.searchmoves && x.res && x.fen === n.fen; }).pop();
      if (!j) return 'no job';
      var st = stateFromFen(j.fen), lines = legalMoves(st).slice(0, 3).map(function (m, i) {
        var after = cloneState(st); applyMove(after, m); var rep = legalMoves(after)[0];
        return { cp: (st.w ? 1 : -1) * (60 - 40 * i), mate: null, pv: [moveUci(m)].concat(rep ? [moveUci(rep)] : []) };
      });
      j.res({ cp: lines[0].cp, mate: null, bestUci: lines[0].pv[0], pv: lines[0].pv, lines: lines, depth: 18, stopped: false });
      return 'answered'; })()`);
    eq(job, 'answered', 'the explore search');
    await tick(); await tick();
    const r2 = JSON.parse(A.ev(`(function () { var a = ui.session.active, ex = a.explore;
      window.__sameFrame('exploring, with a result', a);
      return JSON.stringify({ out: window.__same, live: boardOptsFor(a).evLive, has: !!ex.res[xpCur(ex).key] }); })()`));
    ok(r2.has && r2.live, 'the result is in and the bar is live: ' + JSON.stringify(r2));
    eq(r2.out.length, 0, r2.out.join(' | '));
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

  await test('no board, marks or text write while motionUntil is in the future', () => {
    const A = boot();
    A.ev(DOM);
    /* the clock in 10 ms steps, so every timer runs close to when it falls due */
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const band = () => A.ev('window.__els.cband.innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim()');
    const textWrites = () => A.ev('window.__writes.filter(function (w) { return w.kind === "text"; }).length');
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 10).map(function (it) { return it.key; }))`));
    ok(cards.length === 10, 'cards ' + cards.length);
    let slides = 0, landed = 0;
    for (const tier of [1, 2, 3]) {
      A.ev(`(playerTier = function () { return ${tier}; }, 1)`);
      for (const key of cards) {
        const at = 'tier ' + tier + ' ' + key;
        /* S1: the card opens, board and band at once (nothing slides) */
        A.ev(`(window.__show(model().byKey['${key}']), 1)`);
        ok(/Your turn Find a better move than \S+\.$/.test(band()), at + ': the open band reads ' + band());
        run(1000);
        /* S2: a piece picked up and put down repaints the board alone */
        const t0 = textWrites();
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.from); return 1; })()`);
        eq(textWrites(), t0, at + ': text written for a selection');
        run(200);
        /* the game move again, tapped: it slides 220 ms, then the verdict */
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
        const mu = A.ev('motionUntil - Date.now()');
        if (mu > 0) slides++;
        ok(/Find a better move/.test(band()), at + ': the verdict landed with the slide: ' + band());
        run(1000);
        if (/Your game move again/.test(band())) landed++;
        else ok(false, at + ': no verdict after the slide: ' + band());
        /* See it: their reply slides 320 ms; the bar changes after it */
        A.ev('(seeIt(), 1)');
        if (A.ev('motionUntil - Date.now()') >= 300) slides++;
        run(1000);
        /* a marks beat staged during a slide waits for it */
        A.ev(`(function () { var a = ui.session.active; tryAgain(); return 1; })()`);
        run(1000);
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); stage(['marks', 'text']); return 1; })()`);
        run(100);
        /* input mid-slide: the slide ends, the board catches up, the words wait 150 ms */
        A.click('tryAgain', null, 1);
        run(1000);
        /* input after the slide, while its words still wait: the new board is drawn at once */
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
        run(300);
        const tap = A.getNow();
        A.click('tryAgain', null, 1);
        ok(JSON.parse(A.ev('JSON.stringify(window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).pop())')).t === tap, at + ': the board waited behind words');
        run(1000);
        /* the answered frame: the answer, tapped, slides, then the result */
        A.ev(`(function () { var a = ui.session.active; if (a.phase === 'tried') tryAgain(); sessionClick(a.best.from); sessionClick(a.best.to); return a.phase; })()`);
        if (A.ev('motionUntil - Date.now()') > 0) slides++;
        run(1000);
        ok(/^(Found it|You got there)/.test(band()), at + ': the answered band reads ' + band());
        /* a line stepped forward slides 320 ms */
        A.ev('(stepView(1), 1)');
        run(1000);
      }
    }
    const ws = JSON.parse(A.ev('JSON.stringify(window.__writes)'));
    const bad = early(ws);
    ok(slides >= 60, 'slides ' + slides);
    ok(landed === 30, 'verdicts after their slide ' + landed);
    ok(ws.filter((w) => w.kind === 'marks').length >= 30, 'marks writes ' + ws.filter((w) => w.kind === 'marks').length);
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
    /* the bar beside the board stays grey and still on a card: it fills only while exploring */
    eq(ws.filter((w) => w.id === 'ebar-fill').length, 0, 'the bar moved on a card');
    ok(ws.some((w) => w.id === 'ebar' && w.what === 'class pending'), 'the bar is told it waits');
  });

  await test('a slot ignores clicks for 450 ms after its label changes', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const S = () => JSON.parse(A.ev(`JSON.stringify((function (a, ss) { return { phase: a.phase, result: a.result || null, hints: a.hints,
      misses: a.misses, seen: !!(a.tried && a.tried.seen), idx: ss.idx, bar: displayFor(a).buttons.map(function (b) { return b.label; }).join(' | ') }; })(ui.session.active, ui.session))`));
    const wait = (ms) => A.advance(ms);
    /* card n painted as the page paints it, then its game move again (not
       slid: a pressed button lands at once) with this many misses before it */
    const gameMove = (n, before) => A.ev(`(function () {
      var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[${n}], a = window.__show(it);
      a.misses = ${before}; gradeMove(uciToMove(a.st, a.playedUci)); return a.phase; })()`);
    /* Try again at miss 1: both slots change, [See it] [Try again] becomes [Hint] [Show the answer] */
    eq(gameMove(0, 0), 'tried', 'the game move stays');
    wait(1000);
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again takes the try back');
    wait(150);
    A.click('reveal', null, 1); A.click('hint', null, 0); A.key('?');
    let s = S();
    eq(s.result, null, 'Show the answer 150 ms after Try again'); eq(s.hints, 0, 'Hint and ? 150 ms after Try again'); eq(s.phase, 'guess', 'phase');
    wait(350);
    A.key('?');
    eq(S().hints, 1, '? 500 ms after Try again');
    /* the hint renamed the left slot (Hint 2) and left the right one alone */
    wait(150);
    A.click('hint', null, 0);
    eq(S().hints, 1, 'Hint 2, 150 ms after it took its name');
    A.click('reveal', null, 1);
    s = S();
    eq(s.phase, 'done', 'Show the answer, unchanged by the hint, is taken at once'); eq(s.result, 'fail', 'result');
    /* a double tap on Show the answer: the second half lands on the answered bar and is ignored */
    wait(100);
    A.click('lineFwd', null, 1); A.click('next', null, 2);
    eq(A.ev('ui.session.active.view.idx'), -1, 'the forward button 100 ms after the answered bar appeared');
    eq(A.ev('ui.session.idx'), 0, 'Next 100 ms after the answered bar appeared');
    wait(400);
    A.click('next', null, 2);
    eq(A.ev('ui.session.idx'), 1, 'Next 500 ms after');
    /* See it: only the left slot changes, once their reply has landed; Try
       again is taken all the while */
    gameMove(1, 0);
    wait(1000);
    A.click('seeIt', null, 0);
    ok(S().seen, 'See it plays their reply');
    wait(150);
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again 150 ms after See it is taken');
    gameMove(2, 0);
    wait(1000);
    A.click('seeIt', null, 0);
    wait(600);
    ok(/^Hint \| Try again$/.test(S().bar), 'the bar after their reply: ' + S().bar);
    A.click('hint', null, 0);
    s = S();
    eq(s.phase, 'tried', 'Hint 130 ms after its slot changed'); eq(s.hints, 0, 'no hint');
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again, unchanged, is taken');
    /* See it at miss 3: the left slot becomes Show the answer */
    gameMove(3, 2);
    wait(1000);
    A.click('seeIt', null, 0);
    wait(600);
    A.click('reveal', null, 0);
    s = S();
    eq(s.misses, 3, 'misses'); eq(s.phase, 'tried', 'miss 3, Show the answer 130 ms after it appeared'); eq(s.result, null, 'no result');
    wait(400);
    A.click('reveal', null, 0);
    eq(S().result, 'fail', 'Show the answer later');
    /* Keep looking after a close move, and Try again after a move that was not checked */
    A.ev(`(function () { ${AFTER}
      var a = window.__show(allMistakes().filter(trainable)[3]); a.attempts++; showTry(a, offBook(a), 'close', null); return 1; })()`);
    wait(1000);
    A.click('dismissStronger', null, 0);
    eq(S().phase, 'guess', 'Keep looking takes the try back');
    wait(150);
    A.click('hint', null, 0); A.click('reveal', null, 1);
    s = S();
    eq(s.hints, 0, 'Hint 150 ms after Keep looking'); eq(s.result, null, 'Show the answer 150 ms after Keep looking');
    A.ev(`(function () { ${AFTER}
      var a = window.__show(allMistakes().filter(trainable)[4]); SF.state = 'failed'; gradeMove(offBook(a)); return a.tried && a.tried.kind; })()`);
    wait(1000);
    A.click('tryAgain', null, 1);
    wait(150);
    A.click('reveal', null, 1);
    s = S();
    eq(s.phase, 'guess', 'Try again after a move not checked'); eq(s.result, null, 'Show the answer 150 ms after it');
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
  /* a square's corner and centre as drawn, white at the bottom unless flipped */
  const cornerOf = (sq, flip) => [(flip ? 7 - sq % 8 : sq % 8) * 45, (flip ? sq >> 3 : 7 - (sq >> 3)) * 45];
  const ctrOf = (sq, flip) => cornerOf(sq, flip).map((v) => v + 22.5);
  const at = (got, want) => Math.abs(+got[0] - want[0]) < 1e-6 && Math.abs(+got[1] - want[1]) < 1e-6;
  /* the shapes that would eat a tap: input finds a square with
     elementFromPoint, so every drawn shape that is not a square or a piece
     (data-sq) must let taps through, by pointer-events:none on itself or on
     a group or svg round it. Shapes inside <defs> are never drawn */
  const tapEaters = (html) => {
    const out = [], stack = [];
    for (const m of html.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      if (m[1]) { stack.pop(); continue; }
      const up = stack[stack.length - 1] || {};
      const none = up.none || /pointer-events:\s*none/.test(m[3]), defs = up.defs || m[2] === 'defs';
      if (/^(rect|circle|ellipse|line|polyline|polygon|path|use|text|image)$/.test(m[2]) && !defs && !none && !/ data-sq="/.test(m[3])) out.push(m[0]);
      if (!m[4]) stack.push({ none: none, defs: defs });
    }
    return out;
  };

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
      return JSON.stringify(its.map(function (a) { var s = showcase(a, a.it.g.color === 'black');
        return { svg: s.svg, pieces: s.pieces, ghostOn: s.o.ghosts[0].sq, decor: boardSvg(a.st, Object.assign({}, s.o, { decor: true })) }; })); })()`));
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
      /* and nothing else takes a tap: a tap on a ghost's cross over a piece
         reaches that piece, not a dead shape */
      const eaters = tapEaters(c.svg).concat(tapEaters(c.decor));
      eq(eaters.length, 0, 'card ' + n + ': shapes that take a tap: ' + eaters.slice(0, 2).join(' '));
      ok(/<g style="pointer-events:none"><g><circle cx="[\d.]+" cy="[\d.]+" r="6" fill="#d04a3a"/.test(split(c.svg).board), 'card ' + n + ': the ghost crosses sit in a group that lets taps through');
    });
    /* the check itself sees a shape that takes a tap */
    eq(tapEaters('<svg class="board"><rect data-sq="0"/><g><circle r="6"/></g><g style="pointer-events:none"><path d=""/></g><defs><path d=""/></defs></svg>').length, 1, 'the tap check');
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
      /* ids scoped to their card: a new card's first id pops though another
         card used the same number, and an older id never pops again after a
         newer one */
      var seen = ['cardA:1', 'cardB:1', 'cardA:2', 'cardA:1', 'cardB:1'].map(function (id) {
        return (boardSvg(a.st, { fx: id, badges: [{ sq: 9, kind: 'good', fx: id }], tokens: [{ sq: 10, p: 'q', kind: 'won', fx: id }] }).match(/ fx-in"/g) || []).length;
      });
      return JSON.stringify({ out: out, pops: pops, seen: seen }); })()`));
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
    eq(r.seen.join(' '), '2 2 2 0 0', 'cardA:1, cardB:1, cardA:2 pop their badge and token; cardA:1 and cardB:1 again pop nothing');
  });

  await test('board primitives: each mark keeps the shape that carries its meaning', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${CARDS} ${SHOW}
      var out = [];
      its.forEach(function (a) {
        [false, true].forEach(function (flip) {
          var s = showcase(a, flip), rp = s.o.arrows[2];
          /* the same reply before it lands (dashed), and the last-move tint with no verdict on it */
          s.dashed = boardSvg(a.st, { flip: flip, arrows: [{ from: rp.from, to: rp.to, kind: 'reply' }] });
          s.plain = boardSvg(a.st, { flip: flip, mark: s.o.mark });
          delete s.pieces;
          out.push(s);
        });
      });
      return JSON.stringify(out); })()`));
    ok(r.length >= 20, 'boards ' + r.length);
    const TINT = { bad: 'rgba(214,70,52,.42)', close: 'rgba(125,147,171,.34)' }, HL_MOVE = 'rgba(155,199,0,.41)';
    const BADGE = { good: '#3d9142', bad: '#d04a3a', checking: '#8f8b83', unchecked: '#6b665d', info: '#6b665d' };
    r.forEach((s, n) => {
      const o = s.o, flip = o.flip, name = 'card ' + (n >> 1) + (flip ? ' flipped' : ''), p = split(s.svg);
      /* verdict tints: one per tinted square, in its kind's colour, in place of the last-move tint */
      eq((p.board.match(/<rect class="tint /g) || []).length, o.tints.length, name + ': one tint per tinted square');
      o.tints.forEach((t) => {
        const c = cornerOf(t.sq, flip);
        const got = p.board.match(new RegExp('<rect class="tint tint-' + t.kind + '" x="' + c[0] + '" y="' + c[1] + '" width="45" height="45" fill="([^"]+)"'));
        ok(got && got[1] === TINT[t.kind], name + ': the ' + t.kind + ' tint on ' + t.sq + ', ' + (got && got[1]));
      });
      const lm = cornerOf(o.mark[0], flip), hl = '<rect x="' + lm[0] + '" y="' + lm[1] + '" width="45" height="45" fill="' + HL_MOVE + '"';
      ok(s.plain.indexOf(hl) > 0 && p.board.indexOf(hl) < 0, name + ': the last-move tint shows alone, and gives way to a verdict tint');
      /* badges: filled discs, but the close one is a hollow ring with a blue-grey tick */
      const badges = [...p.marks.matchAll(/<g class="badge badge-(\w+)" transform="[^"]+">(?:<g[^>]*>)?<circle r="9\.8"[^>]*\/><circle r="8\.6" ([^>]*?)\/><path d="[^"]+" fill="none" stroke="([^"]+)"/g)];
      eq(badges.map((b) => b[1]).join(' '), o.badges.map((b) => b.kind).join(' '), name + ': badges');
      badges.forEach((b) => {
        if (b[1] === 'close') eq(b[2], 'fill="#161512" stroke="#7d93ab" stroke-width="2.2"', name + ': the close badge is a hollow ring');
        else eq(b[2], 'fill="' + BADGE[b[1]] + '"', name + ': the ' + b[1] + ' badge is a filled disc');
        eq(b[3], b[1] === 'close' ? '#7d93ab' : '#fff', name + ': the ' + b[1] + ' glyph colour');
      });
      /* arrows: threat and reply dashed with butt caps (halo too), a landed reply solid; game, better and Stockfish solid */
      const arrows = (h, cls) => [...h.matchAll(new RegExp('<line([^>]*)/><line class="' + cls + '"([^>]*)/>', 'g'))];
      const dashed = (m) => [m[1], m[2]].every((x) => /stroke-dasharray="7 5\.5"/.test(x) && /stroke-linecap="butt"/.test(x)) && /stroke-width="5"/.test(m[2]);
      const solid = (m) => [m[1], m[2]].every((x) => !/stroke-dasharray/.test(x) && /stroke-linecap="round"/.test(x));
      const threat = arrows(p.marks, 'threat-arrow'), reply = arrows(p.marks, 'reply-arrow'), before = arrows(s.dashed, 'reply-arrow');
      ok(threat.length === 2 && threat.every(dashed), name + ': threat arrows dashed, ' + (threat[0] && threat[0][2]));
      ok(before.length === 1 && dashed(before[0]), name + ': a reply arrow dashed before it lands');
      ok(reply.length === 1 && solid(reply[0]), name + ': solid on its landing frame');
      ['bad-arrow', 'good-arrow', 'ghost-arrow'].forEach((cls) => {
        const m = arrows(p.marks, cls);
        ok(m.length >= 1 && m.every(solid) && m.every((x) => /stroke-width="6"/.test(x[2])), name + ': ' + cls + ' solid');
      });
      /* tried moves at 55%: a thin line from where it started and a cross where it landed, or the cross alone */
      const tried = [...p.marks.matchAll(/<g class="tried" opacity="([\d.]+)">(?:<line class="tried-line" x1="([\d.-]+)" y1="([\d.-]+)"[^>]* stroke-width="([\d.]+)"[^>]*\/>)?<circle cx="([\d.-]+)" cy="([\d.-]+)" r="6"/g)];
      eq(tried.length, 2, name + ': tried moves');
      ok(tried.every((t) => t[1] === '.55'), name + ': tried moves at 55%');
      ok(at([tried[0][2], tried[0][3]], ctrOf(o.tried[0].from, flip)) && tried[0][4] === '2', name + ': the tried line starts at the centre of its from-square');
      ok(at([tried[0][5], tried[0][6]], ctrOf(o.tried[0].to, flip)), name + ': the tried cross where the move landed');
      ok(tried[1][2] == null && at([tried[1][5], tried[1][6]], ctrOf(o.tried[1].sq, flip)), name + ': {sq} draws the cross alone, on its square');
      /* ghosts: the faded piece on its square, a cross at the top-right of each ghost square */
      const gu = p.board.match(/<use class="ghost-piece" href="[^"]+" x="([\d.]+)" y="([\d.]+)"/);
      ok(gu && at([gu[1], gu[2]], cornerOf(o.ghosts[0].sq, flip)), name + ': the ghost piece on its square');
      const crosses = [...p.board.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="6" fill="#d04a3a"/g)];
      eq(crosses.length, o.ghosts.length, name + ': ghost crosses');
      o.ghosts.forEach((g, i) => { const c = cornerOf(g.sq, flip); ok(at([crosses[i][1], crosses[i][2]], [c[0] + 37.5, c[1] + 7.5]), name + ': ghost cross ' + i + ' at the top-right'); });
    });
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
