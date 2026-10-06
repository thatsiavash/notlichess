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
   readyEngine() says it is up. A test can score the try (window.__tryCp)
   and the expected move (window.__bestCp) itself, in centipawns from the
   solver's side, or hold the try's answer (window.__holdTry: it waits in
   window.__evals like an explore search) */
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
    var mine = window.__tryCp != null ? { cp: window.__tryCp, mate: null } : { cp: gameCp, mate: stored && b.ma != null ? b.ma : null };
    var best = window.__bestCp != null ? { cp: window.__bestCp, mate: null } : { cp: b.eb, mate: b.mb != null ? b.mb : null };
    var lines = [{ cp: mine.cp * sign, mate: mine.mate != null ? mine.mate * sign : null, pv: [u].concat(reply) }];
    if (expect) lines.push({ cp: best.cp * sign, mate: best.mate != null ? best.mate * sign : null, pv: [expect] });
    var r = { cp: lines[0].cp, mate: lines[0].mate, bestUci: u, pv: lines[0].pv, lines: lines, depth: 18, stopped: false };
    job.answer = r;
    if (window.__holdTry) return new Promise(function (res, rej) { job.res = res; job.rej = rej; });
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
   waiting, or a board name that says the answer. Exempt: the red arrow of
   the move played in the game (any other red game arrow is checked like a
   mark), last-move tints, selection and legal dots, the nope outline (it
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
    if ((m.kind === 'game' && sameMove([a.played.from, a.played.to], [m.from, m.to])) || (m.kind === 'reply' && rm && sameMove(rm, [m.from, m.to]))) return;
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
/* the frames after a miss: the try on the board, then its reason (S4: the
   ring and the arrow, then the words), their reply once See it plays it
   (sliding, then landed with what it took), and the card again after Try
   again (the tried move's faint line once the crossfade is over, the
   automatic hint by tier) */
const AFTER = `function afterMiss(a, check, what) {
  if (a.phase !== 'tried' || !a.tried) return check(what + ', not on the board but ' + a.phase, true);
  check(what + ', on the board');
  a.reason = 1; check(what + ', its reason drawn');
  a.reason = 2; check(what + ', its reason said');
  if (a.tried.reply) { seeIt(); check(what + ', See it'); a.animMove = null; check(what + ', See it, landed'); }
  tryAgain(); check(what + ', after Try again, crossfading');
  a.triedHold = false; check(what + ', after Try again');
}
function offBook(a) {
  return legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0] || null;
}`;
/* the card's page as recording stubs, so renderCard and the staged beats
   (14s-stage.js) really paint: every write is kept in window.__writes with
   the clock and motionUntil at that moment. #bwrap and the bar beside it
   take board writes, the marks svg marks writes, #trainbox the card's
   frame; the session bar, the band, the action bar, the strip and the live
   region take text writes. window.__els holds the nodes. A write keeps
   what it wrote (v): the band's and the bar's markup, and for the board and
   the marks the marks they drew, as words (tried, xfade, ring, arrow,
   token, slide) */
const DOM = `(function () {
  var log = window.__writes = [], els = window.__els = {};
  var kind = { bwrap: 'board', ebar: 'board', 'ebar-fill': 'board', marks: 'marks', trainbox: 'frame' };
  var FLAG = { tried: /class="tried"/, xfade: /class="xfade"/, ring: /class="ring-threat"/, arrow: /class="threat-arrow"/, token: /token-lost/, slide: /anim-piece/,
    target: /class="ring-target"/, hint: /class="hint-ring"/, ghost: /:s0"/, tick: /badge-good/, info: /badge-info/, green: /good-arrow/, won: /token-won/, red: /bad-arrow/, guard: /guard-line/, faded: /ghost-piece/ };
  var kept = function (id, x) {
    if (id === 'cband' || id === 'cbar') return x;
    if (id === 'bwrap' || id === 'marks') return Object.keys(FLAG).filter(function (k) { return FLAG[k].test(x); }).join(' ');
    return null;
  };
  var note = function (id, what, x) { log.push({ id: id, what: what, kind: kind[id] || 'text', t: Date.now(), mu: motionUntil, v: what === 'innerHTML' || what === 'outerHTML' ? kept(id, String(x)) : null }); };
  var mk = function (id) {
    /* a class put on or taken off (the fade of words about to change) is
       kept in n.cls, not written: it hides words, it changes none */
    var cls = {};
    var n = { id: id, dataset: {}, cls: cls, focus: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
      contains: function () { return false; }, appendChild: function () {}, querySelectorAll: function () { return []; },
      querySelector: function (sel) { return id === 'bwrap' && sel === '.marks' ? els.marks : null; },
      classList: { toggle: function (c) { note(id, 'class ' + c); }, add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function () { return false; } } };
    ['innerHTML', 'textContent', 'className', 'outerHTML'].forEach(function (name) {
      var v = '';
      Object.defineProperty(n, name, { get: function () { return v; }, set: function (x) { v = x; note(id, name, x); } });
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

/* the card's bar and focus as the page keeps them, on top of DOM: the
   bar's buttons are read from its markup, the typed-move box sits in the
   strip (before the bar, as on the page) and the band holds the task
   heading; a node that takes focus becomes document.activeElement, and a
   bar button's click() goes to the page's click handler, as a real one
   does (pressRight clicks it) */
const BAR = `(function () {
  var els = window.__els, memo = { html: null, list: [] };
  var node = function (host, attrs) {
    var cls = {};
    return { host: host, id: attrs.id || '', tagName: attrs.tag || 'A', cls: cls,
      classList: { contains: function () { return false; }, toggle: function () {}, add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; } },
      getAttribute: function (n) { return attrs[n] == null ? null : attrs[n]; }, focus: function () { document.activeElement = this; },
      click: function () { window.__realmClick(attrs['data-act'], attrs['data-k'], attrs['data-slot']); } };
  };
  var kb = node('cstrip', { id: 'kbmove', tag: 'INPUT' }), heads = { 'task-h': node('cband', { id: 'task-h', tag: 'H2' }), 'result-h': node('cband', { id: 'result-h', tag: 'H2' }) };
  var buttons = function () {
    var h = els.cbar.innerHTML;
    if (memo.html !== h) {
      memo = { html: h, list: [] };
      h.replace(/<a ([^>]*)>/g, function (m, at) { var o = {}; at.replace(/([\\w-]+)="([^"]*)"/g, function (x, k, v) { o[k] = v; return x; }); memo.list.push(node('cbar', o)); return m; });
    }
    return memo.list;
  };
  var hasKb = function () { return /id="kbmove"/.test(els.cstrip.innerHTML); };
  /* one simple selector: #id or [attr] / [attr="v"] conditions */
  var matches = function (n, sel) {
    sel = sel.trim();
    if (/^#[\\w-]+$/.test(sel)) return n.id === sel.slice(1);
    if (/[\\s>]/.test(sel)) return false;
    var conds = sel.match(/\\[[^\\]]+\\]/g) || [];
    return conds.length > 0 && conds.join('') === sel && conds.every(function (c) {
      var m = /^\\[([\\w-]+)(?:="([^"]*)")?\\]$/.exec(c);
      return m && n.getAttribute(m[1]) != null && (m[2] == null || n.getAttribute(m[1]) === m[2]);
    });
  };
  /* the first node in page order that matches any of the selectors */
  var first = function (list, sel) {
    var alts = sel.split(',');
    for (var i = 0; i < list.length; i++) if (alts.some(function (x) { return matches(list[i], x); })) return list[i];
    return null;
  };
  var inBar = function (n) { return !!n && buttons().indexOf(n) >= 0; };
  els.cbar.querySelector = function (sel) { return first(buttons(), sel); };
  els.cbar.querySelectorAll = function (sel) { return sel === '.stale' ? buttons().filter(function (b) { return b.cls.stale; }) : []; };
  els.cbar.contains = inBar;
  els.cpanel.querySelector = function (sel) { return first((hasKb() ? [kb] : []).concat(buttons()), sel); };
  els.cpanel.querySelectorAll = function () { return []; };
  els.cpanel.contains = function (n) { return inBar(n) || (n === kb && hasKb()); };
  els.cband.contains = function (n) { return !!n && n.host === 'cband'; };
  var get1 = document.getElementById;
  document.getElementById = function (id) {
    if (id === 'kbmove') return hasKb() ? kb : null;
    if (heads[id]) return new RegExp('id="' + id + '"').test(els.cband.innerHTML) ? heads[id] : null;
    return get1(id);
  };
  return 1; })()`;

(async () => {
  await test('the spoiler rule holds on every card before an answer, tiers 1 to 3 (open, hints 0 to 2, inside a forcing line, after a miss, a hint pressed over a try)', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER} ${AFTER}
      var out = [], cards = 0, frames = 0, hinted = 0, its = allMistakes().filter(trainable);
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
            /* a hint's marks on their own, as the card asking would draw
               them, whatever the phase (2.3's hint rule in tried too) */
            if (a.hints >= 1 && a.phase !== 'reply' && a.phase !== 'done') {
              var hm = hintMarks(a), g = Object.create(a);
              g.phase = 'guess';
              if (hm.rings.length || hm.arrows.length) hinted++;
              spoilerFaults(g, { st: a.st, opts: { rings: hm.rings, arrows: hm.arrows }, pending: true }).forEach(function (x) { out.push('tier ' + tier + ' ' + it.key + ' ' + what + ', its hint marks: ' + x); });
            }
          };
          [0, 1, 2].forEach(function (h) { a.hints = h; check('hints ' + h); });
          /* inside a forcing line: each of your later moves, hint 1 and hint
             2 pressed there, and hint 2 kept from an earlier move */
          for (var i = 2; a.sol && i < a.sol.length; i += 2) {
            a = openCard(it);
            for (var j = 0; j < i; j++) { var lm = uciToMove(a.st, a.sol[j]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; }
            a.solIdx = i;
            [1, 2].forEach(function (h) { a.hints = h; a.hintAfter = true; check('move ' + (i / 2 + 1) + ', hint ' + h); });
            a.hintAfter = false; check('move ' + (i / 2 + 1) + ', hint 2 kept');
          }
          /* the game move again, tapped: it stays on the board */
          a = openCard(it);
          a.tapped = true;
          gradeMove(uciToMove(a.st, a.playedUci));
          check('game move again, sliding');
          a.animMove = null;
          afterMiss(a, check, 'game move again');
          /* twice more: the automatic hint after Try again (tier 1 from
             miss 1, tier 2 from miss 2), then Hint pressed over the try
             (the board crossfading back, then its marks), twice */
          gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
          afterMiss(a, check, 'game move again, miss 2');
          for (var hp = 0; hp < 2; hp++) {
            gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
            if (a.phase !== 'tried') { check('game move again, not on the board but ' + a.phase, true); break; }
            giveHint(); check('Hint pressed over the try ' + (hp + 1) + ', crossfading');
            a.triedHold = false; check('Hint pressed over the try ' + (hp + 1));
          }
          /* a good move that is not the best, a move not checked, and the
             outline of a tap on their piece (S2, S5, S11) */
          var off = offBook(a = openCard(it));
          if (off) {
            showTry(a, off, 'close', null); check('a close move');
            a = openCard(it); showTry(a, off, 'unchecked', null); check('a move not checked');
          }
          a = openCard(it);
          for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) !== !!a.st.w) { tapNote(a, 'T4', 2500, q); check('T4 on ' + sqName(q)); }
        });
      });
      return JSON.stringify({ out: out, cards: cards, frames: frames, hinted: hinted, trainable: its.length }); })()`));
    ok(r.trainable >= 90 && r.cards === 3 * r.trainable, r.cards + ' cards of ' + r.trainable);
    ok(r.frames >= 20 * r.cards, 'frames ' + r.frames);
    ok(r.hinted >= 3 * r.cards, 'frames with hint marks ' + r.hinted);
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
          /* landed: the grey dots on the square */
          var am = a.animMove; a.animMove = null;
          T.check(a, 'tier ${tier} ' + it.key + ' checking, landed');
          a.animMove = am;
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

  await test('answered means phase done: the answer is drawn only on answered frames (S0, the answer shown, a mid-line reveal)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER}
      var out = [], frames = 0, shown = 0, mid = 0;
      /* what a frame draws of the answer: a green or gold arrow (hint 2's
         ring on the piece is allowed before an answer, and spoilerFaults
         checks it) */
      var drawn = function (f) {
        var o = f.opts, xs = (o.arrows || []).filter(function (m) { return m.kind === 'better' || m.kind === 'explore'; });
        if (o.good) xs.push({ from: o.good[0], to: o.good[1], kind: 'better' });
        if (o.ghost) xs.push({ kind: 'explore' });
        return xs;
      };
      var check = function (a, what) {
        var f = boardOptsFor(a), xs = drawn(f);
        frames++;
        spoilerFaults(a, f).forEach(function (x) { out.push(what + ': ' + x); });
        if (!xs.length) return;
        if (a.phase !== 'done' || !a.result || !ui.session.results[a.key]) out.push(what + ': the answer drawn before it is graded (' + a.phase + ')');
        /* only the answer shown draws it, and only the move due now, in green */
        var due = showDue(a);
        if (!(a.view && a.view.mode === 'show') || xs.length !== 1 || xs[0].kind !== 'better' || !due || xs[0].from !== due.from || xs[0].to !== due.to)
          out.push(what + ': draws ' + JSON.stringify(xs) + ' in ' + JSON.stringify(a.view));
        else shown++;
      };
      /* the rest of a line shown, its replies played at once */
      var playLine = function (a, what) {
        for (var g = 0; g < 20 && showDue(a); g++) {
          playIt(false); check(a, what + ', played ' + g);
          a.animMove = null; check(a, what + ', played ' + g + ', landed');
          if (!a.showWait) continue;
          var rp = uciToMove(a.st, a.sol[a.solIdx]);
          a.showWait = false; applyMove(a.st, rp); a.lastMove = [rp.from, rp.to]; a.markMove = null; a.solIdx++;
          var nx = showDue(a);
          if (nx) a.answerSan = sanOf(a.st, nx); else settleShown(a);
          check(a, what + ', their reply ' + g);
        }
        [0, 1, 2].forEach(function (k) { a.settle = k; check(a, what + ', settled ' + k); });
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var at = 'tier ' + tier + ' ' + it.key, a = openCard(it);
          if (!a) return;
          reveal(); check(a, at + ' shown'); playLine(a, at + ' shown');
          a = openCard(it); a.hints = 2; check(a, at + ' hint 2'); reveal(); check(a, at + ' shown after hint 2');
          a = openCard(it);
          if (a.sol) {
            /* the first move found (and its reply), then the answer: the move due now */
            applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2; a.lastMove = null;
            check(a, at + ' mid-line'); a.hints = 2; check(a, at + ' mid-line, hint 2');
            reveal(); mid++; check(a, at + ' mid-line shown'); playLine(a, at + ' mid-line shown');
          } else {
            solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
            [0, 1, 2].forEach(function (k) { a.settle = k; check(a, at + ' solved, settled ' + k); });
          }
        });
      });
      return JSON.stringify({ out: out, frames: frames, shown: shown, mid: mid }); })()`));
    ok(r.frames > 2000, 'frames ' + r.frames);
    ok(r.shown > 300 && r.mid >= 20, 'answers shown ' + r.shown + ', mid-line reveals ' + r.mid);
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
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
          g.opts.arrows = [{ from: a.played.to, to: b.from, kind: 'threat' }, { from: a.played.from, to: a.played.to, kind: 'game' }];
          g.opts.tried = [{ sq: a.played.from }];
        })),
        /* in phase tried, a hint-1 threat arrow from the answer's piece reads
           as an S4 mark: the checker cannot tell them apart (slice 10 checks
           hint marks on their own) */
        threatInTried: doctor(function (g) { g.opts.arrows = [{ from: b.from, to: a.played.to, kind: 'threat' }]; }),
        threatOnToInTried: (a.phase = 'tried', doctor(function (g) { g.opts.arrows = [{ from: a.played.to, to: b.to, kind: 'threat' }]; })),
        /* a red game arrow is exempt only as the move played in the game */
        gameElsewhere: (a.phase = 'guess', a.tried = null, doctor(function (g) { g.opts.arrows = [{ from: b.from, to: b.to, kind: 'game' }]; })),
        gameItself: doctor(function (g) { g.opts.arrows = [{ from: a.played.from, to: a.played.to, kind: 'game' }]; })
      }); })()`));
    eq(r.clean, 0, 'the real frame');
    eq(r.allowed, 0, 'marks the rule allows after a miss');
    eq(r.threatInTried, 0, 'S4 marks on the answer piece after a miss');
    eq(r.gameItself, 0, 'the red arrow of the game move, as a list arrow');
    ['green', 'gold', 'ringEarly', 'ringOnTo', 'slide', 'bar', 'label', 'greenList', 'goldList', 'ringList', 'threatOnTo', 'prizeOnFrom',
      'ringOnToList', 'token', 'guard', 'tried', 'badge', 'tint', 'threatFromOnFrom', 'threatToOnFrom', 'threatRingOnFrom', 'replyArrowOnTo',
      'replyRingOnTo', 'threatOnToInTried', 'gameElsewhere'].forEach((k) => ok(r[k] > 0, k + ' not caught'));
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
      a.settle = 2; seeWhy(); same('the story, G1 crossfading in', a);
      delete a.view.pre; a.animMove = boardOptsFor(a).last; same('the story, G1 sliding', a);
      a.animMove = null; same('the story, G1 landed', a);
      a.view = { mode: 'story', i: buildStory(a).g }; same('the story, B1', a);
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
      var f = boardOptsFor(a);
      return JSON.stringify({ out: window.__same, live: f.evLive, pending: f.pending, has: !!ex.res[xpCur(ex).key] }); })()`));
    ok(r2.has && r2.live, 'the result is in and the bar is live: ' + JSON.stringify(r2));
    eq(r2.pending, false, 'while exploring the bar no longer waits');
    eq(r2.out.length, 0, r2.out.join(' | '));
    /* and it waits, grey and still, on every frame of a card: open, tried, answered */
    const r3 = JSON.parse(A.ev(`(function () { ${OPEN}
      var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0], b = openCard(it), wait = [], out = [];
      wait.push(['open', boardOptsFor(b)]);
      gradeMove(uciToMove(b.st, b.playedUci)); wait.push(['tried', boardOptsFor(b)]);
      seeIt(); wait.push(['tried, See it', boardOptsFor(b)]);
      reveal(); wait.push(['answered', boardOptsFor(b)]);
      b.settle = 2; seeWhy(); wait.push(['answered, the story', boardOptsFor(b)]);
      b.view = { mode: 'story', i: buildStory(b).steps.length - 1 }; wait.push(['answered, the story, its last step', boardOptsFor(b)]);
      if (b.phase !== 'done') out.push('the card was not answered');
      wait.forEach(function (w) { if (w[1].pending !== true || w[1].evLive) out.push(w[0] + ': the bar does not wait'); });
      return JSON.stringify(out); })()`));
    eq(r3.length, 0, r3.join(' | '));
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
    /* the latest board write, and the words written less than 150 ms after t */
    const lastBoard = () => A.ev('(window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).pop() || {}).t');
    const soon = (t) => A.ev(`window.__writes.filter(function (w) { return w.kind === "text" && w.t >= ${t} && w.t < ${t} + 150; }).map(function (w) { return w.id + ' +' + (w.t - ${t}); }).join(', ')`);
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
        /* (its button fades out for 100 ms first) */
        run(110);
        if (A.ev('motionUntil - Date.now()') >= 300) slides++;
        run(1000);
        /* a marks beat staged during a slide waits for it */
        A.ev(`(function () { var a = ui.session.active; tryAgain(); return 1; })()`);
        run(1000);
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); stage(['marks', 'text']); return 1; })()`);
        run(100);
        /* input mid-slide, through each handler that takes it (a button, a
           tap on your piece, Enter): the slide ends, the board catches up at
           the tap, the words wait 150 ms */
        let tap = A.getNow();
        ok(A.ev('motionUntil') > tap, at + ': a slide runs before the button');
        A.click('tryAgain', null, 1);
        eq(lastBoard(), tap, at + ': the board after a button mid-slide');
        run(1000);
        eq(soon(tap), '', at + ': words after a button mid-slide');
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
        run(100);
        tap = A.getNow();
        ok(A.ev('motionUntil') > tap, at + ': a slide runs before the tap');
        eq(A.ev('(function () { var a = ui.session.active; sessionClick(a.played.to); return a.phase + " " + a.sel; })()'), 'guess ' + A.ev('ui.session.active.played.from'), at + ': a tap on the tried piece picks it up');
        eq(lastBoard(), tap, at + ': the board after a tap mid-slide');
        run(1000);
        eq(soon(tap), '', at + ': words after a tap mid-slide');
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.to); return 1; })()`);
        run(100);
        tap = A.getNow();
        ok(A.ev('motionUntil') > tap, at + ': a slide runs before Enter');
        A.key('Enter');
        eq(A.ev('motionUntil'), tap, at + ': Enter mid-slide ends the slide');
        run(1000);
        eq(soon(tap), '', at + ': words after Enter mid-slide');
        /* words due in 20 ms when input comes still wait 150 ms from it */
        A.ev('(tryAgain(), 1)');
        run(1000);
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
        run(400);
        tap = A.getNow();
        A.ev('(flushStage(), 1)');
        run(1000);
        eq(soon(tap), '', at + ': words after a flush just before they were due');
        /* a piece picked up 30 ms after a slide ends, while its words wait
           (the press that takes a try back, as pointerdown does it): the
           try-back and the selection drawn at once, in one board, never
           with the words */
        A.ev('(tryAgain(), 1)');
        run(1000);
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
        run(300);
        tap = A.getNow();
        A.ev(`(function () { var a = ui.session.active; flushStage(); tryAgain(triedPick(a, a.played.to)); return 1; })()`);
        const atTap = JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t === ${tap}; }).map(function (w) { return w.kind + ' ' + w.id + ' ' + w.what; }))`));
        eq(atTap.filter((w) => w === 'board bwrap innerHTML').length, 1, at + ': the try-back and the selection drawn at the press, ' + atTap.join(', '));
        ok(A.ev(`(function (a) { return a.phase === 'guess' && a.sel === a.played.from && window.__els.bwrap.innerHTML.indexOf('fill="' + HL_SEL + '"') > 0; })(ui.session.active)`), at + ': the piece picked up in that board');
        eq(atTap.filter((w) => /^text/.test(w)).length, 0, at + ': words written with the selection');
        run(1000);
        eq(soon(tap), '', at + ': words after the selection');
        /* input after the slide, while its words still wait: the new board is drawn at once */
        A.ev(`(function () { var a = ui.session.active; if (a.sel !== a.played.from) sessionClick(a.played.from); sessionClick(a.played.to); return a.phase; })()`);
        run(300);
        tap = A.getNow();
        A.click('tryAgain', null, 1);
        eq(lastBoard(), tap, at + ': the board waited behind words');
        run(1000);
        /* the answered frame: the answer, tapped, slides, then the result */
        A.ev(`(function () { var a = ui.session.active; if (a.phase === 'tried') tryAgain(); sessionClick(a.best.from); sessionClick(a.best.to); return a.phase; })()`);
        if (A.ev('motionUntil - Date.now()') > 0) slides++;
        run(1000);
        ok(/^(Found it|You got there)/.test(band()), at + ': the answered band reads ' + band());
        /* the story: G1 crossfades in and slides 320 ms, then a step forward, then one back (a crossfade) */
        A.ev('(storyStep(1), 1)');
        if (A.ev('motionUntil - Date.now()') > 0) slides++;
        run(1000);
        A.ev('(storyStep(1), 1)');
        run(1000);
        A.ev('(storyStep(-1), 1)');
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

  await test('a board beat never waits behind words, and under reduced motion nothing slides', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const lastBoard = () => JSON.parse(A.ev('JSON.stringify((function (w) { return w ? { t: w.t, slides: /anim-piece/.test(window.__els.bwrap.innerHTML) } : null; })(window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).pop()))'));
    const firstText = (t) => A.ev(`(window.__writes.filter(function (w) { return w.kind === "text" && w.t >= ${t}; })[0] || {}).t`);
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 5).map(function (it) { return it.key; }))`));
    ok(cards.length === 5, 'cards ' + cards.length);
    for (const key of cards) {
      A.ev('(ui.reducedTest = false, 1)');
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      /* the game move tapped: it slides, its words wait for the slide plus 150 ms */
      A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
      const mu = A.ev('motionUntil');
      ok(mu > A.getNow() && lastBoard().slides, key + ': the game move slides');
      /* 30 ms after the slide, while its words wait: a board beat with no
         input before it (a drawn shape, a hover) is drawn at once, and the
         words still come 150 ms after it */
      run(mu - A.getNow() + 30);
      const t = A.getNow();
      ok(A.ev('stageQ.indexOf("text") >= 0'), key + ': the words still wait');
      A.ev('(renderCardBoard(), 1)');
      eq(lastBoard().t, t, key + ': the board waited behind words');
      run(1000);
      ok(firstText(t) >= t + 150, key + ': words ' + (firstText(t) - t) + ' ms after a board change');
      /* reduced motion: the same move is drawn where it lands, and nothing
         waits for a slide; the words still come 150 ms after the board
         changed, never with it (principle 2) */
      A.ev('(tryAgain(), 1)');
      run(1000);
      A.ev('(ui.reducedTest = true, 1)');
      const t2 = A.getNow();
      A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
      const b2 = lastBoard();
      eq(b2.t, t2, key + ': reduced motion, the move drawn at the tap');
      ok(!b2.slides, key + ': reduced motion, a piece drawn sliding');
      eq(A.ev('motionUntil'), t2, key + ': reduced motion, motionUntil in the future');
      run(1000);
      ok(firstText(t2) >= t2 + 150, key + ': reduced motion, words ' + (firstText(t2) - t2) + ' ms after the move');
    }
    A.ev('(ui.reducedTest = false, 1)');
  });

  await test('a dragged move: the board at the drop, its words 150 ms after it, never in the same task', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* the first write of each node at or after t, in ms from t */
    const firsts = (t) => JSON.parse(A.ev(`JSON.stringify((function () { var o = {}; window.__writes.forEach(function (w) {
      if (w.t >= ${t} && o[w.id] == null && (w.id === 'bwrap' || w.id === 'cband' || w.id === 'cbar')) o[w.id] = w.t - ${t}; }); return o; })())`));
    const band = () => A.ev('window.__els.cband.innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim()');
    const drag = (from, to) => A.ev(`(function () { var a = ui.session.active; a.sel = ${from}; pointerState.suppressClick = true; sessionClick(${to}); pointerState.suppressClick = false; return 1; })()`);
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 5).map(function (it) { return it.key; }))`));
    ok(cards.length === 5, 'cards ' + cards.length);
    for (const key of cards) {
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      /* the game move again, dragged: the move and its cross at the drop, the band and the bar 150 ms later */
      const p = JSON.parse(A.ev('JSON.stringify(ui.session.active.played)'));
      let t = A.getNow();
      drag(p.from, p.to);
      let f = firsts(t);
      eq(f.bwrap, 0, key + ': the dragged game move drawn at the drop');
      ok(/badge badge-bad/.test(A.ev('window.__els.bwrap.innerHTML')), key + ': its cross with it');
      ok(f.cband == null && f.cbar == null, key + ': no words with the board: ' + JSON.stringify(f));
      run(1000);
      f = firsts(t);
      ok(f.cband >= 150 && f.cbar >= 150, key + ': the band and the bar 150 ms after the board: ' + JSON.stringify(f));
      ok(/^Your game move again/.test(band()), key + ': the verdict: ' + band());
      /* a move off the card's lines, dragged: the checking frame at the drop; the guess bar stays, and the
         checking bar comes with K1, 300 ms after it */
      A.ev('(tryAgain(), 1)');
      run(1000);
      A.ev(`(function () { ${AFTER} window.readyEngine(); window.__holdTry = true; window.__m = offBook(ui.session.active); return 1; })()`);
      t = A.getNow();
      drag(A.ev('window.__m.from'), A.ev('window.__m.to'));
      f = firsts(t);
      eq(A.ev('ui.session.active.phase'), 'checking', key + ': the move is checked');
      eq(f.bwrap, 0, key + ': the dragged move drawn at the drop');
      ok(f.cbar == null, key + ': no bar with the board: ' + JSON.stringify(f));
      run(1000);
      eq(firsts(t).cbar, 300, key + ': the checking bar with K1, 300 ms after the board: ' + JSON.stringify(firsts(t)));
      A.ev('(window.__holdTry = false, takeBack(), 1)');
      run(1000);
    }
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('the forcing reply is never jumped: input during its slide is dropped', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const boardAt = () => A.ev('(window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).pop() || {}).t');
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && c.sol && c.sol.length >= 3; }).slice(0, 6).map(function (it) { return it.key; }))`));
    ok(cards.length >= 3, 'forcing cards ' + cards.length);
    /* every input the page takes, each through its own handler: a tap on
       one of your pieces, a button (one with no bar slot, so no slot guard
       stands in for the drop), ?, Enter, an arrow, Esc on the open menu, a
       typed move */
    const inputs = (key) => {
      A.ev(`(function () { var a = ui.session.active; for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === !!a.st.w) { sessionClick(s); break; } return 1; })()`);
      A.click('hint', null, 0); A.click('reveal');
      A.key('?'); A.key('Enter'); A.key('ArrowRight');
      A.ev('(ui.session.active.menuOpen = true, 1)');
      A.key('Escape');
      A.ev(`(typedMove(ui.session.active.sol[${key}] || 'a1a2'), 1)`);
    };
    let held = 0;
    for (const key of cards) {
      /* the first move of the line, tapped; their reply slides 650 ms later */
      A.ev(`(function () { var a = window.__show(model().byKey['${key}']); return 1; })()`);
      run(1000);
      A.ev(`(function () { var a = ui.session.active, m = uciToMove(a.st, a.sol[0]); sessionClick(m.from); sessionClick(m.to); return a.phase; })()`);
      let n = 0;
      while (!A.ev('motionHold') && n++ < 200) A.advance(10);
      ok(A.ev('motionHold'), key + ': the reply never slid');
      const t0 = A.getNow(), mu = A.ev('motionUntil'), w0 = boardAt();
      ok(mu > t0, key + ': the reply slide is running');
      eq(A.ev('ui.session.active.phase'), 'guess', key + ': phase');
      A.advance(40);
      inputs(2);
      const s = JSON.parse(A.ev('JSON.stringify({ mu: motionUntil, sel: ui.session.active.sel, hints: ui.session.active.hints, phase: ui.session.active.phase, solIdx: ui.session.active.solIdx, result: ui.session.active.result || null, menu: !!ui.session.active.menuOpen })'));
      ok(s.menu, key + ': Esc closed the menu during the reply');
      A.ev('(ui.session.active.menuOpen = false, 1)');
      eq(s.mu, mu, key + ': motionUntil moved');
      eq(boardAt(), w0, key + ': the board was written during the reply');
      eq(s.sel, -1, key + ': a piece was picked up during the reply'); eq(s.hints, 0, key + ': a hint during the reply');
      eq(s.phase, 'guess', key + ': phase after the inputs'); eq(s.solIdx, 2, key + ': a move was played during the reply'); eq(s.result, null, key + ': answered during the reply');
      /* once it lands, input is taken again */
      A.setNow(mu + 10);
      eq(A.ev('flushStage()'), false, key + ': input after the reply lands');
      A.ev(`(function () { var a = ui.session.active; for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === !!a.st.w) { sessionClick(s); break; } return 1; })()`);
      ok(A.ev('ui.session.active.sel') >= 0, key + ': a piece is picked up after the reply');
      run(1000);
      held++;
    }
    eq(held, cards.length, 'cards held');
    /* a reply still waiting to be drawn (a slow frame kept the clock busy):
       a tap starts its slide, never skips it, and is dropped */
    A.ev(`(function () { var a = window.__show(model().byKey['${cards[0]}']); return 1; })()`);
    run(1000);
    A.ev(`(function () { var a = ui.session.active, m = uciToMove(a.st, a.sol[0]); sessionClick(m.from); sessionClick(m.to); motionUntil = Date.now() + 5000; return 1; })()`);
    run(700);
    ok(A.ev('ui.session.active.replySlide === true && stageQ.indexOf("board") >= 0'), 'the reply waits to be drawn');
    const tap = A.getNow();
    A.key('?');
    eq(boardAt(), tap, 'the reply is drawn at the tap');
    eq(A.ev('motionUntil') - tap, A.ev('SLIDE_LEAD') + 220, 'the reply slides in full');
    ok(A.ev('motionHold'), 'and is held');
    eq(A.ev('ui.session.active.hints'), 0, 'the tap that started it is dropped');
    const mu2 = A.ev('motionUntil');
    A.advance(30);
    A.click('hint', null, 0);
    eq(A.ev('motionUntil'), mu2, 'a second tap leaves the slide alone');
    run(1000);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('focus stays on the action bar when its buttons change, never in the typed-move box', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const foc = () => A.ev(`(function () { var e = document.activeElement; return !e ? 'none' : e.host + ' ' + (e.id || (e.getAttribute('data-act') + '@' + e.getAttribute('data-slot'))); })()`);
    /* a button pressed as a finger presses it: it takes focus, then the click */
    const press = (act) => {
      const slot = A.ev(`(function () { var b = window.__els.cbar.querySelector('[data-act="${act}"]'); if (!b) return -1; b.focus(); return +b.getAttribute('data-slot'); })()`);
      ok(slot >= 0, act + ' is on the bar: ' + foc());
      A.click(act, null, slot);
    };
    A.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0]; window.__show(it); return 1; })()`);
    run(1000);
    eq(foc(), 'cband task-h', 'a new card focuses the task');
    ok(A.ev('!!document.getElementById("kbmove")'), 'the typed-move box is on the card');
    /* the game move again, then See it: the left button changes under the focus */
    A.ev('(function () { var a = ui.session.active; gradeMove(uciToMove(a.st, a.playedUci)); return a.phase; })()');
    run(1000);
    press('seeIt');
    run(1500);
    eq(foc(), 'cbar hint@0', 'after See it, the button now in its slot');
    /* Try again: both buttons change; the focus keeps its slot */
    press('tryAgain');
    run(1500);
    eq(A.ev('ui.session.active.phase'), 'guess', 'Try again took the try back');
    eq(foc(), 'cbar reveal@1', 'after Try again, the button now in its slot');
    /* a slot that goes off (No more hints) hands the focus to the right-hand button */
    press('hint');
    run(1000);
    eq(foc(), 'cbar hint@0', 'after hint 1, Hint 2 keeps the focus');
    press('hint');
    run(1000);
    eq(A.ev('ui.session.active.hints'), 2, 'hint 2 given');
    eq(foc(), 'cbar reveal@1', 'after hint 2 the focus is on the right-hand button');
    /* Enter on the right-hand button now presses it, never an empty typed move */
    press('reveal');
    run(1000);
    eq(A.ev('ui.session.active.phase'), 'done', 'Show the answer pressed');
    eq(foc(), 'cbar playIt@1', 'the answer shown hands the keyboard to Play it, the right-hand button');
  });

  await test('Enter presses the right-hand button in guess and tried, and waits out its slot', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, result: a.result || null, misses: a.misses }; })(ui.session.active))'));
    const show = (n) => A.ev(`(function () { window.__show(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[${n}]); return 1; })()`);
    /* guess: [Hint] [Show the answer]; Enter shows the answer */
    show(0);
    A.advance(1000);
    A.key('Enter');
    eq(S().result, 'fail', 'Enter in guess shows the answer');
    /* tried, the game move again: [See it] [Try again]; Enter takes the try back */
    show(1);
    A.advance(1000);
    A.ev('(function () { var a = ui.session.active; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()');
    A.advance(1000);
    eq(S().phase, 'tried', 'the game move stays');
    A.key('Enter');
    let s = S();
    eq(s.phase, 'guess', 'Enter in tried takes the try back'); eq(s.result, null, 'and shows no answer');
    /* Try again changes both slots once its crossfade is over (the words
       come 300 ms after the tap); they faded out at the tap and took no tap
       since, so their half second runs from it: Enter 400 ms after the tap
       (100 ms after the bar changed) is ignored, 500 ms after shows the
       answer */
    A.advance(300);
    A.advance(100);
    A.key('Enter');
    s = S();
    eq(s.phase, 'guess', 'Enter 100 ms after the bar changed'); eq(s.result, null, 'no answer 100 ms after the bar changed');
    A.advance(100);
    A.key('Enter');
    eq(S().result, 'fail', 'Enter 500 ms after the tap shows the answer');
    /* a good move that is not the best: [Show the answer] [Keep looking];
       Enter keeps looking, as Try again does after a miss, and never shows
       the answer */
    A.ev(`(function () { ${AFTER} var a = window.__show(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[2]);
      a.attempts++; showTry(a, offBook(a), 'close', null); return 1; })()`);
    A.advance(1000);
    eq(S().phase, 'tried', 'the close move stays');
    A.key('Enter');
    s = S();
    eq(s.phase, 'guess', 'Enter on a close move takes it back'); eq(s.result, null, 'and shows no answer'); eq(s.misses, 0, 'and counts no miss');
  });

  await test('a held key presses once: its auto-repeat never reaches the button that took its place', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const S = () => JSON.parse(A.ev(`JSON.stringify((function (ss, a) { return { idx: ss.idx, phase: a && a.phase, result: (a && a.result) || null,
      hints: a && a.hints, misses: a && a.misses, results: Object.keys(ss.results).length }; })(ui.session, ui.session.active))`));
    /* the button in a bar slot now, as focus finds it there */
    const inSlot = (i) => JSON.parse(A.ev(`(function () { var b = window.__els.cbar.querySelector('[data-slot="${i}"][data-act]'); return JSON.stringify(b ? { act: b.getAttribute('data-act'), slot: ${i} } : null); })()`));
    /* a key held after its press: the keyboard's auto-repeat starts after
       a delay (500 ms, or as given) and repeats every 30 ms, for 1.5 s; on()
       gives the focused target at each repeat (none, a button, the
       typed-move box) */
    const hold = (key, on, delay) => { A.advance(delay || 500); for (let t = 0; t < 1500; t += 30) { A.key(key, true, on ? on() : null); A.advance(30); } };
    /* a four-card session, each card already looked at deeply, so Next opens the next one at once */
    A.ev(`(function () { var its = allMistakes().filter(trainable).filter(function (x) { var a0 = cardFor(x); return unpackUci(x.b.ru).length && a0 && !a0.sol; }).slice(0, 4);
      its.forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
      window.__show(its[0]); ui.session.keys = its.map(function (x) { return x.key; }); return 1; })()`);
    A.advance(1000);
    A.click('reveal', null, 1);
    A.advance(1000);
    eq(S().phase, 'done', 'card 1 answered');
    /* the answer shown: Enter plays it (the right-hand button), and the card
       settles with Continue on the right */
    A.key('Enter');
    A.advance(2000);
    eq(A.ev('ui.session.active.view.mode + " " + ui.session.active.settle'), 's0 2', 'Enter played the answer, then the card settled');
    /* Enter goes to the next card; held, it shows nothing there */
    A.key('Enter');
    await tick();
    let s = S();
    eq(s.idx, 1, 'Enter pressed Next'); eq(s.phase, 'guess', 'card 2 open');
    hold('Enter');
    s = S();
    eq(s.idx, 1, 'a held Enter stays on card 2'); eq(s.phase, 'guess', 'card 2 still asks for a move'); eq(s.result, null, 'no answer on card 2');
    eq(s.results, 1, 'nothing recorded for card 2');
    /* a held ?: hint 1, never hint 2 */
    A.advance(500);
    A.key('?');
    eq(S().hints, 1, '? gives hint 1');
    hold('?');
    s = S();
    eq(s.hints, 1, 'a held ? gives no hint 2'); eq(s.result, null, 'and no answer');
    /* Enter held on a focused See it at miss 3: the focus keeps slot 0,
       where Show the answer comes once their reply has landed (a 700 ms
       repeat delay, so it is there before the first repeat) */
    A.ev(`(function () { var ss = ui.session; ss.idx = 2; ss.active = null; loadCard(); var a = ss.active;
      a.misses = 2; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`);
    A.advance(1000);
    s = S();
    eq(s.misses, 3, 'miss 3'); eq(s.phase, 'tried', 'the game move stays');
    eq(JSON.stringify(inSlot(0)), JSON.stringify({ act: 'seeIt', slot: 0 }), 'See it in slot 0');
    A.key('Enter', false, inSlot(0));
    hold('Enter', () => inSlot(0), 700);
    s = S();
    eq(s.phase, 'tried', 'a held Enter on See it shows no answer'); eq(s.result, null, 'no result');
    eq(JSON.stringify(inSlot(0)), JSON.stringify({ act: 'reveal', slot: 0 }), 'Show the answer took slot 0');
    /* a fresh press is a press */
    A.key('Enter', false, inSlot(0));
    eq(S().result, 'fail', 'a new Enter on Show the answer');
    /* Enter held in the typed-move box sends the move once */
    A.ev(`(function () { var ss = ui.session; ss.idx = 3; ss.active = null; loadCard(); return 1; })()`);
    A.advance(1000);
    const san = A.ev('(function (a) { return sanOf(a.st, uciToMove(a.st, a.playedUci)); })(ui.session.active)');
    A.key('Enter', false, { id: 'kbmove', value: san });
    s = S();
    eq(s.phase, 'tried', 'the typed game move is a try'); eq(s.misses, 1, 'one miss');
    hold('Enter', () => ({ id: 'kbmove', value: san }));
    s = S();
    eq(s.misses, 1, 'a held Enter sent the move once'); eq(s.phase, 'tried', 'the try stays');
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
    /* Try again at miss 1: both slots change, [See it] [Try again] becomes
       [Hint] [Show the answer], once its crossfade is over (the words come
       300 ms after the tap) */
    eq(gameMove(0, 0), 'tried', 'the game move stays');
    wait(1000);
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again takes the try back');
    wait(300);
    eq(A.ev('slotAct.join(" ")'), 'hint reveal', 'the new bar 300 ms after Try again');
    wait(150);
    A.click('reveal', null, 1); A.click('hint', null, 0); A.key('?');
    let s = S();
    eq(s.result, null, 'Show the answer 150 ms after the bar changed'); eq(s.hints, 0, 'Hint and ? 150 ms after the bar changed'); eq(s.phase, 'guess', 'phase');
    wait(350);
    A.key('?');
    eq(S().hints, 1, '? 500 ms after the bar changed');
    /* the hint renamed the left slot (Hint 2) and left the right one alone */
    wait(150);
    A.click('hint', null, 0);
    eq(S().hints, 1, 'Hint 2, 150 ms after it took its name');
    A.click('reveal', null, 1);
    s = S();
    eq(s.phase, 'done', 'Show the answer, unchanged by the hint, is taken at once'); eq(s.result, 'fail', 'result');
    /* a double tap on Show the answer: the second half lands on the answered
       bar [Continue] [Play it] and is ignored (the bar comes 150 ms after
       the answer's arrow) */
    wait(250);
    A.click('playIt', null, 1); A.click('next', null, 0);
    eq(A.ev('ui.session.active.view.mode + " " + !!ui.session.active.showDone'), 'show false', 'Play it 100 ms after the answered bar appeared');
    eq(A.ev('ui.session.idx'), 0, 'Continue 100 ms after the answered bar appeared');
    wait(400);
    A.click('next', null, 0);
    eq(A.ev('ui.session.idx'), 1, 'Continue 500 ms after');
    /* See it: only the left slot changes, once their reply has landed; Try
       again is taken all the while */
    gameMove(1, 0);
    wait(1000);
    A.click('seeIt', null, 0);
    ok(S().seen, 'See it plays their reply');
    wait(150);
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again 150 ms after See it is taken');
    /* (the See it button fades out for 100 ms before the reply slides, so
       the new bar is painted 620 ms after the tap) */
    gameMove(2, 0);
    wait(1000);
    A.click('seeIt', null, 0);
    wait(700);
    ok(/^Hint \| Try again$/.test(S().bar), 'the bar after their reply: ' + S().bar);
    eq(A.ev('slotAct.slice(0, 2).join(" ")'), 'hint tryAgain', 'the bar painted after their reply');
    A.click('hint', null, 0);
    s = S();
    eq(s.phase, 'tried', 'Hint 80 ms after its slot changed'); eq(s.hints, 0, 'no hint');
    A.click('tryAgain', null, 1);
    eq(S().phase, 'guess', 'Try again, unchanged, is taken');
    /* See it at miss 3: the left slot becomes Show the answer */
    gameMove(3, 2);
    wait(1000);
    A.click('seeIt', null, 0);
    wait(700);
    A.click('reveal', null, 0);
    s = S();
    eq(s.misses, 3, 'misses'); eq(s.phase, 'tried', 'miss 3, Show the answer 80 ms after it appeared'); eq(s.result, null, 'no result');
    wait(400);
    A.click('reveal', null, 0);
    eq(S().result, 'fail', 'Show the answer later');
    /* Keep looking after a close move (the gold right-hand slot), and Try
       again after a move that was not checked: each slot ignores taps for
       450 ms once the bar has changed */
    A.ev(`(function () { ${AFTER}
      var a = window.__show(allMistakes().filter(trainable)[3]); a.attempts++; showTry(a, offBook(a), 'close', null); return 1; })()`);
    wait(1000);
    A.click('dismissStronger', null, 1);
    eq(S().phase, 'guess', 'Keep looking takes the try back');
    wait(450);
    A.click('hint', null, 0); A.click('reveal', null, 1);
    s = S();
    eq(s.hints, 0, 'Hint 150 ms after the bar changed'); eq(s.result, null, 'Show the answer 150 ms after the bar changed');
    A.ev(`(function () { ${AFTER}
      var a = window.__show(allMistakes().filter(trainable)[4]); SF.state = 'failed'; gradeMove(offBook(a)); return a.tried && a.tried.kind; })()`);
    wait(1000);
    A.click('tryAgain', null, 1);
    wait(450);
    A.click('reveal', null, 1);
    s = S();
    eq(s.phase, 'guess', 'Try again after a move not checked'); eq(s.result, null, 'Show the answer 150 ms after the bar changed');
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
    /* the same while a castling move is being checked: a tap on the king or
       the rook takes it back, that piece picked up from where it came */
    const c = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      window.readyEngine(); window.__holdTry = true;
      allMistakes().filter(trainable).forEach(function (it) {
        var a0 = openCard(it);
        if (!a0) return;
        legalMoves(a0.st).filter(function (m) { var u = moveUci(m); return m.castle && u !== a0.bestUci && u !== a0.playedUci && !(a0.sol && a0.sol.indexOf(u) >= 0); }).forEach(function (m) {
          var short_ = m.castle === 'O-O', rookTo = m.to + (short_ ? -1 : 1), rookFrom = m.to + (short_ ? 1 : -2);
          [[m.to, m.from], [rookTo, rookFrom]].forEach(function (p) {
            var a = openCard(it);
            gradeMove(uciToMove(a.st, moveUci(m)));
            if (a.phase !== 'checking') { out.push(it.key + ' ' + m.castle + ': not checked but ' + a.phase); return; }
            sessionClick(p[0]);
            n++;
            if (a.phase !== 'guess' || a.sel !== p[1] || a.attempts !== 0) out.push(it.key + ' ' + m.castle + ' being checked, a tap on ' + sqName(p[0]) + ': phase ' + a.phase + ', selected ' + (a.sel >= 0 ? sqName(a.sel) : 'none') + ', attempts ' + a.attempts);
          });
        });
      });
      window.__holdTry = false;
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(c.n >= 4, 'castling moves checked ' + c.n);
    eq(c.out.length, 0, c.out.join(' | '));
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
    /* Show the answer is switched off once the band says a move is checked
       (S3, K1): a press there does nothing; Take back stops the search, and
       Show the answer over a try stops it too, and so does Show the answer
       before K1, while the guess bar still offers it (it takes the move back) */
    eq(A.ev('(function () { window.readyEngine(); gradeMove(window.__t.offBook(ui.session.active)); ui.session.active.checkSaid = 1; return ui.session.active.phase; })()'), 'checking', 'a second try');
    eq(stops('reveal()').length, 0, 'Show the answer while a move is checked');
    eq(A.ev('ui.session.active.phase + " " + (ui.session.active.result || null)'), 'checking null', 'Show the answer does nothing while a move is checked');
    has(stops('takeBack()'), 'Take back');
    eq(A.ev('(function () { window.readyEngine(); var a = window.__t.open(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0]); gradeMove(window.__t.offBook(a)); return a.phase; })()'), 'checking', 'a try before K1');
    has(stops('reveal()'), 'Show the answer before K1');
    eq(A.ev('ui.session.active.phase + " " + ui.session.active.result + " " + ui.session.active.attempts'), 'done fail 0', 'Show the answer before K1 takes the move back and shows the answer');
    A.ev('(window.__t.open(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0]), 1)');
    eq(A.ev('(function () { window.readyEngine(); gradeMove(window.__t.offBook(ui.session.active)); return ui.session.active.phase; })()'), 'checking', 'a third try');
    await tick(); await tick();
    eq(A.ev('ui.session.active.phase'), 'tried', 'the third try is on the board');
    has(stops('reveal()'), 'Show the answer over a try');
    eq(A.ev('(function () { window.readyEngine(); var a = window.__t.open(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0]); gradeMove(window.__t.offBook(a)); return a.phase; })()'), 'checking', 'a try on a fresh card');
    has(stops('nextCard()'), 'Next');
    A.ev('(function () { window.__t.open(allMistakes().filter(trainable)[1]); return 1; })()');
    has(stops('endSession()'), 'Ending the session');
  });

  /* slice 6, the verdict states (FINAL-SPEC S2 to S5, S11) */
  await test('a close move is not a miss', async () => {
    const A = boot();
    /* one-move cards, and two off-book tries the stub scores 7 points under
       the best: inside STRONGER_TOL, outside SOLVE_TOL, clearly better than
       the game move, and never a safe win */
    const picks = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [];
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it), b = it.b;
        if (!a || a.sol || (b.mb != null && b.mb > 0)) return;
        var wEb = winPct(b.eb), chances = familyOf(patternOf(b)).key === 'chances';
        if (wEb - 8 < b.wa + 10 || wEb + 8 > 99 || !(chances || wEb - 7 < 70)) return;
        var offs = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci; });
        if (offs.length >= 2) out.push({ key: it.key, wEb: wEb, m1: moveUci(offs[0]), m2: moveUci(offs[1]) });
      });
      return JSON.stringify(out.slice(0, 8)); })()`));
    ok(picks.length >= 4, 'cards ' + picks.length);
    for (const p of picks) {
      const at = p.key;
      A.ev(`(function () { ${OPEN} window.__srs0 = JSON.stringify(srsLoad()); var a = openCard(model().byKey['${p.key}']);
        window.__tryCp = cpFromWin(${p.wEb} - 7); window.__bestCp = null; window.readyEngine(); gradeMove(uciToMove(a.st, '${p.m1}')); return 1; })()`);
      await tick(); await tick();
      let r = JSON.parse(A.ev(`(function (a) { var d = displayFor(a), f = boardOptsFor(a);
        return JSON.stringify({ phase: a.phase, kind: a.tried && a.tried.kind, misses: a.misses, good: a.foundGood && a.foundGood.san, row1: d.row1, row2: d.row2, disc: d.disc, k: d.kind,
          bar: d.buttons.map(function (x) { return x.act + ':' + x.label + ':' + x.cls; }).join(' | '), badges: f.opts.badges, tints: f.opts.tints, to: a.tried && a.tried.to, from: a.tried && a.tried.from,
          cue: a.cue || null, srs: JSON.stringify(srsLoad()) === window.__srs0 }); })(ui.session.active)`));
      eq(r.phase, 'tried', at + ': the close move stays'); eq(r.kind, 'close', at + ': kind'); eq(r.misses, 0, at + ': not a miss');
      ok(!!r.good, at + ': remembered as close');
      eq(r.row1 + ' / ' + r.row2, 'Good move / There\'s a stronger one.', at + ': the band');
      eq(r.disc + ' ' + r.k, 'close close', at + ': disc and band colour');
      eq(r.bar, 'reveal:Show the answer:btn-line | dismissStronger:Keep looking:btn-big', at + ': the bar');
      eq(JSON.stringify(r.badges.map((x) => [x.sq, x.kind])), JSON.stringify([[r.to, 'close']]), at + ': the hollow ring badge on the landing square');
      eq(JSON.stringify(r.tints.map((x) => [x.sq, x.kind])), JSON.stringify([[r.from, 'close'], [r.to, 'close']]), at + ': blue-grey tints');
      eq(r.cue, 'tap', at + ': the tap sound comes with the badge'); ok(r.srs, at + ': the schedule changed');
      /* Keep looking: back to the card, no miss */
      A.ev('(tryAgain(), 1)');
      eq(A.ev('ui.session.active.phase + " " + ui.session.active.misses'), 'guess 0', at + ': Keep looking');
      /* a second close move says row 1 alone */
      A.ev(`(function (a) { window.readyEngine(); gradeMove(uciToMove(a.st, '${p.m2}')); return 1; })(ui.session.active)`);
      await tick(); await tick();
      r = JSON.parse(A.ev('(function (a) { var d = displayFor(a); return JSON.stringify({ kind: a.tried && a.tried.kind, row1: d.row1, row2: d.row2, misses: a.misses }); })(ui.session.active)'));
      eq(r.kind, 'close', at + ': a second close move'); eq(r.row1 + '|' + r.row2, 'Good move|', at + ': row 1 alone the second time'); eq(r.misses, 0, at + ': still no miss');
      /* then the answer: solved, with help */
      A.ev('(function (a) { window.__nlTest.play(a.bestUci); return 1; })(ui.session.active)');
      eq(A.ev('ui.session.active.result'), 'hint', at + ': a solve after a close move counts as help');
      /* one path (S5): a move that loses nothing by the card's own measure
         is close, though this search scores the best move higher */
      A.ev(`(function () { ${OPEN} var a = openCard(model().byKey['${p.key}']); window.__tryCp = cpFromWin(${p.wEb} - 8); window.__bestCp = cpFromWin(${p.wEb} + 8);
        window.readyEngine(); gradeMove(uciToMove(a.st, '${p.m1}')); return 1; })()`);
      await tick(); await tick();
      eq(A.ev('(function (a) { return a.phase + " " + (a.tried && a.tried.kind) + " " + a.misses; })(ui.session.active)'), 'tried close 0', at + ': losing nothing is not a miss');
    }
    /* inside a forcing line there is no close verdict: the same score is a miss, said honestly */
    const f = JSON.parse(A.ev(`(function () { ${OPEN} ${AFTER}
      playerTier = function () { return 2; };
      var a = allMistakes().filter(trainable).map(openCard).filter(function (x) { return x && x.sol && x.sol.length >= 3; })[0];
      ui.session.active = a; ui.session.keys = [a.key];
      var mine = uciToMove(a.st, a.sol[0]); applyMove(a.st, mine); var rp = uciToMove(a.st, a.sol[1]); applyMove(a.st, rp); a.solIdx = 2;
      var off = legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.sol[2]; })[0];
      window.__tryCp = a.it.b.eb; window.__bestCp = null;
      miss(off, moveUci(off), { cp: a.it.b.eb, mate: null, pv: [moveUci(off)], win: winPct(a.it.b.eb) }, true);
      /* the words once the reason's beat has come (S4) */
      a.reason = 2;
      var d = displayFor(a);
      return JSON.stringify({ kind: a.tried.kind, misses: a.misses, row1: d.row1, row2: d.row2 }); })()`));
    eq(f.kind + ' ' + f.misses, 'miss 1', 'mid-line, a move that loses nothing is a miss');
    eq(f.row1 + ' / ' + f.row2, 'Not this one / Nothing lost, but there\'s a better move.', 'said honestly');
    /* and through the page's own path (checkMove): a mid-line move the
       close rule would pass outside a line (6 points under the card's best,
       8 under the line's next move, never a safe win) is a miss */
    const lineCards = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      return JSON.stringify(allMistakes().filter(trainable).filter(function (it) {
        var a = openCard(it), b = it.b, w = winPct(b.eb) - 6;
        return a && a.sol && a.sol.length >= 3 && !(b.mb != null && b.mb > 0) && (w < 70 || w < b.wa + 15 || familyOf(patternOf(b)).key === 'chances');
      }).map(function (it) { return it.key; })); })()`));
    ok(lineCards.length >= 3, 'forcing cards ' + lineCards.length);
    let honest = 0;
    for (const key of lineCards) {
      A.ev(`(function () { ${OPEN} window.__srs0 = JSON.stringify(srsLoad()); var a = openCard(model().byKey['${key}']), b = a.it.b;
        var mine = uciToMove(a.st, a.sol[0]); applyMove(a.st, mine); var rp = uciToMove(a.st, a.sol[1]); applyMove(a.st, rp); a.solIdx = 2;
        var off = legalMoves(a.st).filter(function (m) { var after = cloneState(a.st); applyMove(after, m); return moveUci(m) !== a.sol[2] && !(checkedKingSq(after) != null && !legalMoves(after).length); })[0];
        window.__tryCp = cpFromWin(winPct(b.eb) - 6); window.__bestCp = cpFromWin(winPct(b.eb) + 2);
        window.readyEngine(); gradeMove(off); return 1; })()`);
      await tick(); await tick();
      eq(A.ev('(function (a) { return a.phase + " " + (a.tried && a.tried.kind) + " " + a.misses + " " + displayFor(a).row1; })(ui.session.active)'), 'tried miss 1 Not this one', key + ': mid-line, no close verdict');
      /* the words once the reason's beat has come (S4) */
      const row2 = A.ev('(function (a) { a.reason = 2; return displayFor(a).row2; })(ui.session.active)');
      ok(!/^After /.test(row2), key + ': a mid-line try that loses nothing never gets the standing words: ' + row2);
      if (row2 === 'Nothing lost, but there\'s a better move.') honest++;
    }
    ok(honest >= 5, 'mid-line tries that say they lost nothing ' + honest);
    A.ev('(window.__tryCp = window.__bestCp = null, 1)');
  });

  await test('a try that loses nothing is never a miss outside a forcing line', async () => {
    const A = boot();
    /* the band as it reads once a miss's reason has come (S4) */
    const S = () => JSON.parse(A.ev(`(function (a) { var r0 = a.reason; a.reason = 2; var d = displayFor(a); a.reason = r0;
      return JSON.stringify({ phase: a.phase, kind: a.tried && a.tried.kind, misses: a.misses, row1: d.row1, row2: d.row2, good: !!a.foundGood, srs: JSON.stringify(srsLoad()) === window.__srs0 }); })(ui.session.active)`));
    /* the band the old rule missed: cards whose game move lost under 17
       points, so a try 7 under the best (losing nothing by the card's own
       measure) is not 10 above the game move */
    const band = JSON.parse(A.ev(`(function () { ${OPEN}
      return JSON.stringify(allMistakes().filter(trainable).filter(function (it) {
        var a = openCard(it), b = it.b;
        return a && !a.sol && !(b.mb != null && b.mb > 0) && winPct(b.eb) - b.wa < 17;
      }).map(function (it) { return it.key; })); })()`));
    ok(band.length >= 4 && band.indexOf('184455333378:64') >= 0, 'cards in the band ' + band.length);
    for (const key of band) {
      A.ev(`(function () { ${OPEN} ${AFTER} window.__srs0 = JSON.stringify(srsLoad()); var a = openCard(model().byKey['${key}']);
        window.__tryCp = cpFromWin(winPct(a.it.b.eb) - 7); window.__bestCp = null; window.readyEngine(); gradeMove(offBook(a)); return 1; })()`);
      await tick(); await tick();
      const r = S();
      eq(r.phase + ' ' + r.kind + ' ' + r.misses, 'tried close 0', key + ': a try that loses nothing is close');
      eq(r.row1 + ' / ' + r.row2, 'Good move / There\'s a stronger one.', key + ': the band');
      ok(r.good && r.srs, key + ': remembered as close, the schedule unchanged');
    }
    /* every card, at tiers 1 (no forcing lines) and 2 (one-move cards):
       tries scored from just under the best to below the game move. Within
       STRONGER_TOL of the card's best a try is never a miss; and no miss
       outside a line says it lost nothing */
    let misses = 0, close = 0;
    for (const tier of [1, 2]) {
      const keys = JSON.parse(A.ev(`(function () { ${OPEN} playerTier = function () { return ${tier}; };
        return JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); return a && !a.sol; }).map(function (it) { return it.key; })); })()`));
      for (const key of keys) {
        const ws = JSON.parse(A.ev(`(function (b) { var e = winPct(b.eb); return JSON.stringify([e - 7, e - 9.5, e - 11, e - 16, b.wa + 3, b.wa - 5]); })(model().byKey['${key}'].b)`));
        for (const w of ws) {
          A.ev(`(function () { ${OPEN} ${AFTER} window.__srs0 = JSON.stringify(srsLoad()); var a = openCard(model().byKey['${key}']);
            window.__tryCp = cpFromWin(${w}); window.__bestCp = null; window.readyEngine(); gradeMove(offBook(a)); return 1; })()`);
          await tick(); await tick();
          const r = S(), at = 'tier ' + tier + ' ' + key + ' at ' + Math.round(w);
          const lossless = JSON.parse(A.ev(`(function (b) { return JSON.stringify(!(b.mb != null && b.mb > 0) && winPct(cpFromWin(${w})) >= winPct(b.eb) - STRONGER_TOL); })(model().byKey['${key}'].b)`));
          if (lossless) ok(r.kind !== 'miss' && r.misses === 0, at + ': a try that loses nothing graded ' + r.phase + ' ' + r.kind + ' ' + r.misses);
          if (r.kind === 'miss') { misses++; ok(!/Nothing lost/.test(r.row2), at + ': a miss outside a line reads ' + r.row2); }
          if (r.kind === 'close') close++;
        }
      }
    }
    ok(misses >= 200 && close >= 100, 'misses ' + misses + ', close ' + close);
    A.ev('(window.__tryCp = window.__bestCp = null, 1)');
  });

  await test('Take back records no attempt and no miss and stops the check job', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const S = () => JSON.parse(A.ev(`JSON.stringify((function (a) { return { phase: a.phase, attempts: a.attempts, misses: a.misses, result: a.result || null, tried: a.tried, sel: a.sel,
      progress: JSON.stringify((ui.session.progress || {})[a.key] || null), srs: JSON.stringify(srsLoad()) === window.__srs0, stops: window.__stops.filter(function (x) { return x === 'check'; }).length,
      bar: displayFor(a).buttons.map(function (b) { return b.label + (b.off ? ' (off)' : ''); }).join(' | '), tok: a.checkTok, nope: (boardOptsFor(a).opts.rings || []).filter(function (r) { return r.kind === 'nope'; }).length }; })(ui.session.active))`));
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 4).map(function (it) { return it.key; }))`));
    ok(cards.length === 4, 'cards ' + cards.length);
    /* three ways to take a move back while it is checked: the button, Esc, a tap on the moved piece */
    for (const key of cards) for (const way of ['button', 'escape', 'tap']) {
      const at = key + ' ' + way;
      A.ev(`(function () { ${AFTER} window.__srs0 = JSON.stringify(srsLoad()); window.__stops = []; window.readyEngine(); var a = window.__show(model().byKey['${key}']); window.__m = offBook(a); return 1; })()`);
      run(1000);
      A.ev('(function (m) { sessionClick(m.from); sessionClick(m.to); return 1; })(window.__m)');
      let s = S();
      eq(s.phase, 'checking', at + ': the move is being checked'); eq(s.attempts, 1, at + ': one attempt while it is checked');
      const tok = s.tok;
      /* the guess bar until K1 (300 ms after the move lands), then Take back,
         which ignores taps for 450 ms like any slot that just changed */
      run(1200);
      eq(S().bar, 'Take back | Show the answer (off)', at + ': the bar while checking');
      /* a tap on another piece only outlines it */
      A.ev(`(function (a, m) { for (var q = 0; q < 64; q++) if (a.st.b[q] && q !== m.from) { sessionClick(q); break; } return 1; })(ui.session.active, window.__m)`);
      s = S();
      eq(s.phase, 'checking', at + ': another piece leaves the check alone'); eq(s.nope, 1, at + ': and is outlined');
      const tap = A.getNow();
      if (way === 'button') A.click('takeBack', null, 0);
      else if (way === 'escape') A.key('Escape');
      else A.ev('(sessionClick(window.__m.to), 1)');
      s = S();
      eq(s.phase, 'guess', at + ': taken back'); eq(s.attempts, 0, at + ': no attempt'); eq(s.misses, 0, at + ': no miss'); eq(s.result, null, at + ': no result');
      ok(s.stops >= 1, at + ': the check job is stopped'); ok(s.tok !== tok, at + ': a new token, so its answer is ignored');
      eq(s.sel, way === 'tap' ? A.ev('window.__m.from') : -1, at + ': a tap picks the piece up from where it came');
      /* back by a crossfade: the old board fades over the new one, and the words wait for it */
      ok(/class="xfade"/.test(A.ev('window.__els.bwrap.innerHTML')), at + ': the board crossfades back');
      eq(A.ev('motionUntil') - tap, 150, at + ': the crossfade takes 150 ms');
      /* the engine's answer and the 9 s timer change nothing */
      await tick(); await tick();
      run(10000);
      s = S();
      eq(s.phase, 'guess', at + ': still guessing after the answer came'); eq(s.misses, 0, at + ': no miss after the answer came'); ok(!s.tried, at + ': no try on the board');
      ok(s.srs, at + ': the schedule changed'); eq(s.progress, 'null', at + ': a miss kept for a move taken back');
      const txt = A.ev(`window.__writes.filter(function (w) { return w.kind === 'text' && w.t > ${tap}; }).map(function (w) { return w.t - ${tap}; })[0]`);
      ok(txt >= 300, at + ': words ' + txt + ' ms after the take back');
    }
    /* until K1 (300 ms after the move lands) the guess bar stays, and its
       buttons work: Hint or Show the answer pressed 100 ms after a tapped
       move takes the move back (no attempt, no miss, the check job
       stopped), the board crossfades back, then the hint or the answer, the
       words after the board */
    for (const key of cards) for (const act of ['reveal', 'hint']) {
      const at = key + ' ' + act;
      A.ev(`(function () { ${AFTER} window.readyEngine(); window.__holdTry = true; window.__stops = []; var a = window.__show(model().byKey['${key}']); window.__m = offBook(a); return 1; })()`);
      run(1000);
      A.ev('(function (m) { sessionClick(m.from); sessionClick(m.to); return 1; })(window.__m)');
      run(100);
      ok(/data-act="reveal"/.test(A.ev('window.__els.cbar.innerHTML')) && !/data-act="takeBack"/.test(A.ev('window.__els.cbar.innerHTML')), at + ': the guess bar is still painted');
      const tap = A.getNow();
      A.click(act, null, act === 'reveal' ? 1 : 0);
      const s = S();
      if (act === 'reveal') eq(s.phase + ' ' + s.result, 'done fail', at + ': Show the answer during the check shows it');
      else { eq(s.phase, 'guess', at + ': Hint during the check takes the move back'); eq(A.ev('ui.session.active.hints'), 1, at + ': and gives the hint'); }
      eq(s.attempts, 0, at + ': no attempt'); eq(s.misses, 0, at + ': no miss'); ok(s.stops >= 1, at + ': the check job is stopped');
      ok(/class="xfade"/.test(A.ev('window.__els.bwrap.innerHTML')), at + ': the board crossfades back');
      A.ev('(window.__holdTry = false, 1)');
      run(1000);
      const txt = A.ev(`window.__writes.filter(function (w) { return w.kind === 'text' && w.t >= ${tap}; }).map(function (w) { return w.t - ${tap}; })[0]`);
      ok(txt >= 150, at + ': words ' + txt + ' ms after the press');
    }
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('T4 never grades: a tap on their piece outlines it and says which side you are, for a while (T5, N1 alike)', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const band = () => A.ev('window.__els.cband.innerHTML.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "\'").replace(/\\s+/g, " ").trim()');
    const S = () => JSON.parse(A.ev(`JSON.stringify((function (a) { var f = boardOptsFor(a); return { phase: a.phase, attempts: a.attempts, misses: a.misses, result: a.result || null,
      nope: (f.opts.rings || []).filter(function (r) { return r.kind === 'nope'; }).map(function (r) { return r.sq; }), explore: !!a.explore, view: JSON.stringify(a.view),
      jobs: window.__evals.length, srs: JSON.stringify(srsLoad()) === window.__srs0 }; })(ui.session.active))`));
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 4).map(function (it) { return it.key; }))`));
    let n = 0;
    for (const tier of [1, 2, 3]) {
      A.ev(`(playerTier = function () { return ${tier}; }, 1)`);
      for (const key of cards) {
        const at = 'tier ' + tier + ' ' + key;
        A.ev(`(function () { window.__srs0 = JSON.stringify(srsLoad()); window.__show(model().byKey['${key}']); return 1; })()`);
        run(1000);
        const c = JSON.parse(A.ev(`(function (a) { var theirs = -1, mine = -1, to = -1;
          for (var q = 0; q < 64; q++) { var p = a.st.b[q]; if (p && isW(p) !== !!a.st.w && theirs < 0) theirs = q; }
          /* one of your pieces and an empty square it cannot reach */
          for (var f = 0; f < 64 && to < 0; f++) { var pf = a.st.b[f]; if (!pf || isW(pf) !== !!a.st.w) continue;
            var reach = legalMoves(a.st).filter(function (m) { return m.from === f; }).map(function (m) { return m.to; });
            for (var e = 0; e < 64; e++) if (!a.st.b[e] && reach.indexOf(e) < 0) { mine = f; to = e; break; } }
          /* a piece of theirs that piece cannot take, and another of yours */
          var hits = legalMoves(a.st).filter(function (m) { return m.from === mine; }).map(function (m) { return m.to; }), free = -1, mine2 = -1;
          for (var q2 = 0; q2 < 64; q2++) { var p2 = a.st.b[q2]; if (!p2) continue;
            if (isW(p2) !== !!a.st.w && hits.indexOf(q2) < 0 && free < 0) free = q2;
            if (isW(p2) === !!a.st.w && q2 !== mine && mine2 < 0) mine2 = q2; }
          return JSON.stringify({ theirs: theirs, mine: mine, to: to, free: free, mine2: mine2, t2: CARD_COPY.T2(a), t4: CARD_COPY.T4(a), jobs: window.__evals.length }); })(ui.session.active)`));
        /* their piece, nothing picked up: the outline at once, the words 150 ms later, nothing graded */
        const tap = A.getNow();
        A.ev(`(sessionClick(${c.theirs}), 1)`);
        let s = S();
        eq(s.phase + ' ' + s.attempts + ' ' + s.misses + ' ' + s.result, 'guess 0 0 null', at + ': T4 graded nothing');
        eq(s.jobs, c.jobs, at + ': no engine job'); ok(s.srs, at + ': the schedule changed');
        eq(JSON.stringify(s.nope), JSON.stringify([c.theirs]), at + ': the outline on their piece');
        ok(A.ev(`window.__writes.some(function (w) { return w.id === 'marks' && w.t === ${tap}; })`) && /nope-box/.test(A.ev('window.__els.marks.outerHTML')), at + ': the outline drawn in the marks at the tap');
        ok(band().indexOf(c.t2) >= 0, at + ': the words wait 150 ms: ' + band());
        run(200);
        ok(band().indexOf(c.t4) >= 0 && band().indexOf(c.t2) < 0, at + ': row 2 says which side you are: ' + band());
        run(500);
        eq(S().nope.length, 0, at + ': the outline is gone after 600 ms');
        /* a piece of yours picked up meanwhile leaves the words as they are */
        A.ev(`(sessionClick(${c.mine}), 1)`);
        run(100);
        ok(band().indexOf(c.t4) >= 0, at + ': a selection keeps the words');
        A.ev(`(sessionClick(${c.mine}), 1)`);
        /* T4 stays 2.5 s after its words came (150 ms after the tap), and no longer */
        run(1750);
        ok(band().indexOf(c.t4) >= 0, at + ': T4 still there 100 ms before its 2.5 s: ' + band());
        run(150);
        ok(band().indexOf(c.t2) >= 0, at + ': the task is back after 2.5 s: ' + band());
        /* T5: a piece dragged where it cannot go snaps back and says so; a tap there only puts it down */
        A.ev(`(function () { var a = ui.session.active; a.sel = ${c.mine}; pointerState.suppressClick = true; sessionClick(${c.to}); pointerState.suppressClick = false; return 1; })()`);
        run(200);
        ok(band().indexOf('That piece can\'t go there.') >= 0, at + ': T5 after a drop: ' + band());
        eq(S().phase + ' ' + S().attempts, 'guess 0', at + ': T5 graded nothing');
        run(1850);
        ok(band().indexOf('That piece can\'t go there.') >= 0, at + ': T5 still there 100 ms before its 2 s: ' + band());
        run(150);
        ok(band().indexOf(c.t2) >= 0, at + ': the task is back after 2 s');
        A.ev(`(function () { var a = ui.session.active; a.sel = ${c.mine}; sessionClick(${c.to}); return 1; })()`);
        run(200);
        ok(band().indexOf(c.t2) >= 0 && A.ev('ui.session.active.sel') === -1, at + ': a tap there only puts the piece down');
        /* a piece of theirs tapped while one of yours is picked up (and cannot
           take it): yours is put down, theirs outlined, and T4 says which side you are */
        ok(c.free >= 0 && c.mine2 >= 0, at + ': a piece of theirs out of reach, and another of yours');
        A.ev(`(function () { var a = ui.session.active; a.sel = ${c.mine}; sessionClick(${c.free}); return 1; })()`);
        s = S();
        eq(A.ev('ui.session.active.sel') + ' ' + s.phase + ' ' + s.attempts, '-1 guess 0', at + ': put down, nothing graded');
        eq(JSON.stringify(s.nope), JSON.stringify([c.free]), at + ': their piece outlined with one of yours picked up');
        run(200);
        ok(band().indexOf(c.t4) >= 0, at + ': T4 with one of yours picked up: ' + band());
        run(2600);
        ok(band().indexOf(c.t2) >= 0, at + ': the task is back after it');
        /* a piece dragged onto another of yours snaps back and says so; a tap there picks that one up */
        A.ev(`(function () { var a = ui.session.active; a.sel = ${c.mine}; pointerState.suppressClick = true; sessionClick(${c.mine2}); pointerState.suppressClick = false; return 1; })()`);
        eq(A.ev('ui.session.active.sel'), -1, at + ': a drop on your own piece snaps back');
        run(200);
        ok(band().indexOf('That piece can\'t go there.') >= 0, at + ': T5 after a drop on your own piece: ' + band());
        run(2100);
        ok(band().indexOf(c.t2) >= 0, at + ': the task is back after T5');
        A.ev(`(function () { var a = ui.session.active; a.sel = ${c.mine}; sessionClick(${c.mine2}); return 1; })()`);
        eq(A.ev('ui.session.active.sel'), c.mine2, at + ': a tap on another of yours picks it up');
        A.ev(`(sessionClick(${c.mine2}), 1)`);
        run(200);
        ok(band().indexOf(c.t2) >= 0, at + ': and says nothing');
        /* a word and an outline belong to what the card shows: a move made
           while they show ends both at once */
        A.ev(`(sessionClick(${c.theirs}), 1)`);
        run(200);
        ok(band().indexOf(c.t4) >= 0, at + ': T4 again');
        A.ev('(function (a) { gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)');
        run(300);
        ok(/^Your game move again/.test(band()), at + ': the verdict, not T4, after a move: ' + band());
        eq(S().nope.length, 0, at + ': no outline on the try');
        A.ev('(tryAgain(), 1)');
        run(400);
        ok(/^(Your turn|Hint 1 of 2)/.test(band()) && !/Move a (white|black) piece/.test(band()), at + ': the task (or the hint it brought), not T4, after Try again: ' + band());
        /* a try on the board: their piece says it too, and the verdict comes back */
        A.ev('(function (a) { gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)');
        run(1000);
        const v = band(), m0 = S().misses;
        A.ev(`(function (a) { var st = triedFrame(a).st; for (var q = 0; q < 64; q++) if (st.b[q] && isW(st.b[q]) !== !!a.st.w) { sessionClick(q); break; } return 1; })(ui.session.active)`);
        run(200);
        ok(/Move a (white|black) piece\./.test(band()) && band() !== v, at + ': T4 over a try: ' + band());
        eq(S().phase + ' ' + S().misses, 'tried ' + m0, at + ': T4 over a try graded nothing');
        run(2600);
        eq(band(), v, at + ': the verdict is back');
        /* a move being checked: their piece says it too, under the check's own row 1, and the check goes on */
        A.ev(`(function () { ${AFTER} tryAgain(); window.readyEngine(); window.__holdTry = true; return 1; })()`);
        run(1000);
        A.ev(`(function () { ${AFTER} var a = ui.session.active; window.__m = offBook(a); sessionClick(window.__m.from); sessionClick(window.__m.to); return 1; })()`);
        run(800);
        const ck = JSON.parse(A.ev(`(function (a) { var f = checkingFrame(a); for (var q = 0; q < 64; q++) if (f.b[q] && isW(f.b[q]) !== !!a.st.w) return JSON.stringify({ q: q, s: a.attempts + ' ' + a.misses }); })(ui.session.active)`));
        A.ev(`(sessionClick(${ck.q}), 1)`);
        eq(JSON.stringify(S().nope), JSON.stringify([ck.q]), at + ': their piece outlined during a check');
        run(200);
        ok(/^Checking \S+… /.test(band()) && band().slice(-c.t4.length) === c.t4, at + ': T4 under the check\'s row 1: ' + band());
        eq(A.ev('(function (a) { return a.phase + " " + a.attempts + " " + a.misses; })(ui.session.active)'), 'checking ' + ck.s, at + ': T4 during a check graded nothing');
        run(2600);
        ok(/^Checking \S+…( Still checking\.)?$/.test(band()), at + ': the check\'s words are back: ' + band());
        A.ev('(window.__holdTry = false, takeBack(), 1)');
        run(1000);
        /* after an answer: any piece answers with N1, and nothing changes (no exploring, no step) */
        A.ev('(function () { var a = ui.session.active; tryAgain(); reveal(); return 1; })()');
        run(1000);
        s = S();
        const any = A.ev('(function (a) { var st = frameView(a).st; for (var q = 0; q < 64; q++) if (st.b[q]) return q; })(ui.session.active)');
        A.ev(`(sessionClick(${any}), 1)`);
        run(200);
        const s2 = S();
        ok(band().indexOf('To try moves, open Details.') >= 0, at + ': N1 after an answer: ' + band());
        eq(JSON.stringify(s2.nope), JSON.stringify([any]), at + ': N1 outlines the piece');
        eq(s2.explore, false, at + ': a tap no longer opens exploring'); eq(s2.view, s.view, at + ': nor steps the line'); eq(s2.result, s.result, at + ': nor regrades');
        run(2350);
        ok(band().indexOf('To try moves, open Details.') >= 0, at + ': N1 still there 100 ms before its 2.5 s: ' + band());
        run(150);
        ok(band().indexOf('To try moves') < 0, at + ': N1 goes after 2.5 s');
        n++;
      }
    }
    eq(n, 12, 'cards');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('the first tap after a dragged move answers: a drop never eats the next tap (touch and mouse)', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const band = () => A.ev('window.__els.cband.innerHTML.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "\'").replace(/\\s+/g, " ").trim()');
    const nope = () => JSON.stringify((JSON.parse(A.ev('JSON.stringify(boardOptsFor(ui.session.active).opts.rings || [])'))).filter((r) => r.kind === 'nope').map((r) => r.sq));
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, attempts: a.attempts, misses: a.misses, sel: a.sel, flag: pointerState.suppressClick }; })(ui.session.active))'));
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 4).map(function (it) { return it.key; }))`));
    ok(cards.length === 4, 'cards ' + cards.length);
    /* a square on the board as it is drawn now: one of theirs, one of yours that is not on sq */
    const pick = (frame, notSq) => JSON.parse(A.ev(`(function (a) { var st = ${frame}, theirs = -1, mine = -1;
      for (var q = 0; q < 64; q++) { var p = st.b[q]; if (!p || q === ${notSq}) continue; if (isW(p) !== !!a.st.w) { if (theirs < 0) theirs = q; } else if (mine < 0) mine = q; }
      return JSON.stringify({ theirs: theirs, mine: mine, t4: NOTE_COPY.T4(a) }); })(ui.session.active)`));
    let n = 0;
    for (const key of cards) for (const mouse of [false, true]) {
      const at = key + (mouse ? ' mouse' : ' touch');
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      const c = JSON.parse(A.ev('JSON.stringify((function (a) { return { pf: a.played.from, pt: a.played.to, bf: a.best.from, bt: a.best.to }; })(ui.session.active))'));
      /* the game move dragged: a try, and the drop's flag is still up (no click came on a square) */
      A.drag(c.pf, c.pt, mouse);
      let s = S();
      eq(s.phase + ' ' + s.misses, 'tried 1', at + ': the dragged game move is a try');
      ok(s.flag, at + ': the flag is still up after the drag');
      run(1000);
      /* one tap on their piece: the outline and T4 at once (the words 150 ms later) */
      let q = pick('triedFrame(a).st', c.pt);
      A.tap(q.theirs);
      eq(S().flag, false, at + ': the press cleared the flag');
      eq(nope(), JSON.stringify([q.theirs]), at + ': the first tap after the drag outlines their piece');
      run(200);
      ok(q.t4.some((t) => band().indexOf(t) >= 0), at + ': and T4 says which side you are: ' + band());
      eq(S().phase + ' ' + S().misses, 'tried 1', at + ': graded nothing');
      run(2600);
      /* Try again, then the answer dragged: the card is solved, and the first tap on any piece says N1 */
      A.ev('(tryAgain(), 1)');
      run(1000);
      A.drag(c.bf, c.bt, mouse);
      eq(S().phase, 'done', at + ': the dragged answer solves the card');
      run(1500);
      q = pick('frameView(a).st', -1);
      A.tap(q.mine);
      eq(nope(), JSON.stringify([q.mine]), at + ': the first tap after a dragged solve outlines the piece');
      run(200);
      ok(band().indexOf('To try moves, open Details.') >= 0, at + ': and N1 says where to try moves: ' + band());
      run(2600);
      /* a move off the card's lines dragged, held in the check: a tap on one of yours outlines it, one of theirs says T4 */
      A.ev(`(function () { ${AFTER} window.readyEngine(); window.__holdTry = true; var a = window.__show(model().byKey['${key}']); window.__m = offBook(a); return 1; })()`);
      run(1000);
      const m = JSON.parse(A.ev('JSON.stringify({ f: window.__m.from, t: window.__m.to })'));
      A.drag(m.f, m.t, mouse);
      eq(S().phase, 'checking', at + ': the dragged move is checked');
      run(100);
      q = pick('checkingFrame(a)', m.t);
      if (A.ev(`checkingPick(ui.session.active, ${q.mine})`) < 0) {
        A.tap(q.mine);
        eq(nope(), JSON.stringify([q.mine]), at + ': the first tap after the drag outlines your piece during the check');
        eq(S().phase + ' ' + S().attempts, 'checking 1', at + ': and leaves the check alone');
      }
      A.tap(q.theirs);
      eq(nope(), JSON.stringify([q.theirs]), at + ': their piece outlined during the check');
      run(200);
      ok(q.t4.some((t) => band().indexOf(t) >= 0), at + ': T4 during the check: ' + band());
      eq(S().phase + ' ' + S().attempts + ' ' + S().misses, 'checking 1 0', at + ': graded nothing during the check');
      A.ev('(window.__holdTry = false, takeBack(), 1)');
      run(1000);
      n++;
    }
    eq(n, 8, 'cards');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('Try again is the right slot at miss 3', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${AFTER}
      var out = [], n = 0, its = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && unpackUci(x.b.ru).length; }).slice(0, 8);
      var bar = function (a) { return barSlots(a, ui.session).map(function (s) { return s.act + ':' + s.label + ':' + s.cls + (s.off ? ':off' : ''); }); };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        its.forEach(function (it) {
          var a = openCard(it);
          for (var i = 1; i <= 3; i++) {
            gradeMove(uciToMove(a.st, a.playedUci));
            [false, true].forEach(function (seen) {
              if (seen) seeIt();
              var b = bar(a), at = 'tier ' + tier + ' ' + it.key + ' miss ' + i + (seen ? ', See it' : '');
              n++;
              if (b[1] !== 'tryAgain:Try again:btn-big') out.push(at + ': right slot ' + b[1]);
              var left = !seen ? 'seeIt:See it ›:btn-line' : i >= 3 ? 'reveal:Show the answer:btn-line'
                : a.hints >= 2 ? 'hint:No more hints:btn-line:off' : a.hints ? 'hint:Hint 2:btn-line' : 'hint:Hint:btn-line';
              if (b[0] !== left) out.push(at + ': left slot ' + b[0] + ', not ' + left);
            });
            tryAgain();
          }
          /* a move not checked, and a good move that is not the best */
          a = openCard(it); SF.state = 'failed'; gradeMove(offBook(a)); SF.state = 'ready';
          if (bar(a).join(' | ') !== 'reveal:Show the answer:btn-line | tryAgain:Try again:btn-big') out.push(it.key + ' not checked: ' + bar(a).join(' | '));
          a = openCard(it); showTry(a, offBook(a), 'close', null);
          if (bar(a).join(' | ') !== 'reveal:Show the answer:btn-line | dismissStronger:Keep looking:btn-big') out.push(it.key + ' close: ' + bar(a).join(' | '));
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n >= 100, 'bars ' + r.n);
    eq(r.out.length, 0, r.out.slice(0, 3).join(' | '));
    /* Hint is for everyone, from the first try: no tier keeps it switched off */
    const h = JSON.parse(A.ev(`(function () { ${OPEN} var out = [];
      [1, 2, 3].forEach(function (tier) { playerTier = function () { return tier; };
        var a = openCard(allMistakes().filter(trainable)[0]), b0 = barSlots(a, ui.session)[0];
        giveHint();
        out.push(tier + ':' + (b0.off ? 'off' : b0.label) + ':' + a.hints + ':' + (barSlots(a, ui.session)[0].label)); });
      return JSON.stringify(out); })()`));
    eq(h.join(' '), '1:Hint:1:Hint 2 2:Hint:1:Hint 2 3:Hint:1:Hint 2', 'Hint at every tier before a miss');
    /* the verdict hands the keyboard to that button */
    A.ev(DOM);
    A.ev(BAR);
    A.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[0], a = window.__show(it); return 1; })()`);
    A.advance(1000);
    A.ev('(function (a) { gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)');
    A.advance(1000);
    eq(A.ev(`(function () { var e = document.activeElement; return e ? e.getAttribute('data-act') + '@' + e.getAttribute('data-slot') : 'none'; })()`), 'tryAgain@1', 'a verdict focuses Try again');
  });

  /* the misses slice 7 explains, on every card and tier: the game move
     again, a try off the card's lines answered as the engine stub answers it
     (the stored refutation when it is legal after the try), and on forcing
     cards a wrong move at the line's second step (tier 1 has no forcing
     lines; tier 3 asks the same moves as tier 2). MISSES gives each to a
     callback as (a, what), on the board, phase tried */
  const MISSES = `function eachMiss(tiers, fn) {
    tiers.forEach(function (tier) {
      playerTier = function () { return tier; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        var at = 'tier ' + tier + ' ' + it.key;
        gradeMove(uciToMove(a.st, a.playedUci));
        fn(a, at + ' game move');
        var off = function (a, inLine, what) {
          var m = legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) >= 0); })[0];
          if (!m) return;
          var after = cloneState(a.st), ru = unpackUci(it.b.ru);
          applyMove(after, m);
          var reply = ru.length && playUci(after, ru).uci.length === ru.length ? ru : legalMoves(after).slice(0, 1).map(moveUci);
          miss(m, moveUci(m), { cp: 0, mate: reply === ru ? it.b.ma : null, pv: [moveUci(m)].concat(reply), win: it.b.wa }, inLine);
          fn(a, at + ' ' + what);
        };
        off(openCard(it), false, 'a try');
        a = openCard(it);
        if (a.sol && a.sol.length >= 3) {
          applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2;
          off(a, true, 'mid-line');
        }
      });
    });
  }`;

  await test('See it adds exactly one opponent ply', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MISSES}
      var out = [], n = 0;
      eachMiss([1, 2], function (a, what) {
        var t = a.tried;
        if (!t || a.phase !== 'tried') { out.push(what + ': not on the board'); return; }
        if (!t.reply) return;
        var before = triedFrame(a).st, st0 = stateFen(a.st);
        seeIt();
        var after = triedFrame(a).st;
        n++;
        /* the one ply: theirs, their reply, from the frame before to the frame after */
        var plies = legalMoves(before).filter(function (m) { var x = cloneState(before); applyMove(x, m); return stateFen(x) === stateFen(after); });
        if (!!before.w === myPov(a.it)) out.push(what + ': the solver was to move');
        if (plies.length !== 1 || moveUci(plies[0]) !== t.reply) out.push(what + ': ' + plies.length + ' plies between the frames');
        if (stateFen(a.st) !== st0) out.push(what + ': the card position moved');
        if (!sameMove(boardOptsFor(a).last, [plies[0] ? plies[0].from : -1, plies[0] ? plies[0].to : -1])) out.push(what + ': their reply is not the last move drawn');
        seeIt();
        if (stateFen(triedFrame(a).st) !== stateFen(after)) out.push(what + ': a second See it played more');
        if (barSlots(a, ui.session).some(function (s) { return s.act === 'seeIt'; })) out.push(what + ': See it still offered');
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n >= 300, 'See it ' + r.n);
    eq(r.out.length, 0, r.out.length + ', first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('no S4 mark, token or tried cross on the answer square, and each is drawn where the rule allows it', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MISSES}
      var out = [], seen = { ring: 0, arrow: 0, ringOnly: 0, none: 0, token: 0, tried: 0, triedSq: 0 };
      var sqs = function (o, kind) { return (o.rings || []).filter(function (m) { return m.kind === kind; }).map(function (m) { return m.sq; })
        .concat((o.arrows || []).filter(function (m) { return m.kind === kind; }).reduce(function (x, m) { return x.concat([m.from, m.to]); }, [])); };
      eachMiss([1, 2], function (a, what) {
        var t = a.tried, due = dueMove(a);
        if (!t) return;
        /* before its reason beat: no marks */
        var o = boardOptsFor(a).opts;
        if (sqs(o, 'threat').length) out.push(what + ': S4 marks before their beat');
        /* the reason drawn: never on the answer's square, and drawn whenever allowed */
        a.reason = 1;
        o = boardOptsFor(a).opts;
        var th = t.threat, rings = (o.rings || []).filter(function (m) { return m.kind === 'threat'; }), arrows = (o.arrows || []).filter(function (m) { return m.kind === 'threat'; });
        if (sqs(o, 'threat').indexOf(due.to) >= 0) out.push(what + ': an S4 mark on the answer square');
        if (th && th.from === due.to) { if (rings.length || arrows.length) out.push(what + ': marks from the answer square'); seen.none++; }
        else if (th && th.to === due.to) { if (rings.length !== 1 || arrows.length) out.push(what + ': not the ring alone'); seen.ringOnly++; }
        else if (th) {
          if (rings.length !== 1 || rings[0].sq !== th.from || arrows.length !== 1 || arrows[0].from !== th.from || arrows[0].to !== th.to) out.push(what + ': the ring and arrow missing');
          seen.ring++; seen.arrow++;
        } else if (rings.length || arrows.length) out.push(what + ': marks with no threat');
        /* the threat is their reply, and only a capture or a check */
        if (th && (!(th.check || th.captured) || sqName(th.from) + sqName(th.to) !== t.reply.slice(0, 4))) out.push(what + ': a threat that is not their capturing or checking reply, ' + JSON.stringify(th));
        /* See it: the ring and arrow stay while their move slides and go as
           it lands; what it took lands as a token, never on the answer square */
        a.reason = 2;
        if (t.reply) {
          var drawn = sqs(boardOptsFor(a).opts, 'threat').length > 0;
          seeIt();
          var f = boardOptsFor(a), held = !!(t.lost && t.lost.sq !== due.to) || drawn;
          if ((f.opts.tokens || []).length) out.push(what + ': a token drawn during the slide');
          if ((sqs(f.opts, 'threat').length > 0) !== drawn) out.push(what + ': the reason marks changed as the slide started');
          if (f.land !== held) out.push(what + ': ' + (held ? 'nothing lands with the piece' : 'a landing with nothing to land'));
          if (f.land && f.opts.check != null) out.push(what + ': a check glows before the piece lands');
          a.animMove = null;
          o = boardOptsFor(a).opts;
          if ((checkedKingSq(triedFrame(a).st) != null) !== (o.check != null)) out.push(what + ': no check glow once it has landed');
          var tk = o.tokens || [];
          if (sqs(o, 'threat').length) out.push(what + ': S4 marks after See it');
          if (tk.some(function (m) { return m.sq === due.to; })) out.push(what + ': a token on the answer square');
          if (t.lost && t.lost.sq !== due.to) { if (tk.length !== 1 || tk[0].sq !== t.lost.sq || tk[0].p !== t.lost.p || tk[0].kind !== 'lost') out.push(what + ': the token missing'); else seen.token++; }
          else if (tk.length) out.push(what + ': a token with nothing taken');
        }
        /* Try again: the move tried, faint, once the crossfade is over; never a cross on the answer square */
        var uci = t.uci, wrong = t.uci !== a.playedUci;
        tryAgain();
        if ((boardOptsFor(a).opts.tried || []).length && a.triedHold) out.push(what + ': the tried line drawn under the crossfade');
        a.triedHold = false;
        o = boardOptsFor(a).opts;
        var tr = o.tried || [], u = uciToMove(a.st, uci);
        if (tr.some(function (m) { return (m.sq != null ? m.sq : m.to) === due.to; })) out.push(what + ': a tried cross on the answer square');
        if (!wrong) { if (tr.length) out.push(what + ': a tried line for the game move'); }
        else if (tr.length !== 1) out.push(what + ': ' + tr.length + ' tried lines');
        else if (u.to === due.to) { if (tr[0].sq !== u.from) out.push(what + ': the cross not on the square it left'); else seen.triedSq++; }
        else if (tr[0].from !== u.from || tr[0].to !== u.to) out.push(what + ': the tried line elsewhere'); else seen.tried++;
      });
      /* the rule's cases, forced on one card: an attacker on the answer
         square draws nothing, a target there the ring alone, a token there
         nothing, a tried move onto it the cross on the square it left */
      playerTier = function () { return 2; };
      var a = openCard(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; })[0]), b = a.best;
      gradeMove(uciToMove(a.st, a.playedUci));
      a.reason = 1;
      var other = (b.from + 9) % 64 === b.to ? (b.from + 10) % 64 : (b.from + 9) % 64;
      a.tried.threat = { from: b.to, to: other }; var f1 = boardOptsFor(a).opts;
      a.tried.threat = { from: other, to: b.to }; var f2 = boardOptsFor(a).opts;
      a.tried.seen = true; a.tried.lost = { sq: b.to, p: 'q' }; var f3 = boardOptsFor(a).opts;
      a = openCard(a.it); a.wrong = [{ from: other, to: b.to, uci: 'x', at: 0, fx: 'x' }]; var f4 = boardOptsFor(a).opts;
      var forced = { attackerOnTo: (f1.rings || []).length + (f1.arrows || []).length, targetOnTo: JSON.stringify([(f2.rings || []).map(function (m) { return m.sq; }), (f2.arrows || []).length]),
        tokenOnTo: (f3.tokens || []).length, triedOnTo: JSON.stringify(f4.tried), other: other };
      return JSON.stringify({ out: out, seen: seen, forced: forced }); })()`));
    eq(r.out.length, 0, r.out.length + ', first: ' + r.out.slice(0, 3).join(' | '));
    ok(r.seen.ring >= 60 && r.seen.token >= 60 && r.seen.tried >= 60, 'drawn: ' + JSON.stringify(r.seen));
    eq(r.forced.attackerOnTo, 0, 'an attacker on the answer square draws nothing');
    eq(r.forced.targetOnTo, JSON.stringify([[r.forced.other], 0]), 'a target on the answer square keeps the ring alone');
    eq(r.forced.tokenOnTo, 0, 'no token on the answer square');
    eq(r.forced.triedOnTo, JSON.stringify([{ sq: r.forced.other, fx: 'x' }]), 'a tried move onto the answer square: the cross on the square it left');
  });

  await test('a threat arrow into the square of the move just tried keeps its head clear of the badge, which yields its corner', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MISSES}
      var out = [], seen = { fixture: 0, moved: 0, forced: 0 };
      /* on the drawn marks: the threat line, its head's tip 6.3 units past
         its end, the head 21 long and 21 wide at its base, then the shaft
         and its halo (7.4 wide); the badge's disc, r 8.6, where it is drawn */
      var clear = function (html, what) {
        var ln = /<line class="threat-arrow"[^>]*? x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/.exec(html), bd = /<g class="badge badge-bad" transform="translate\\(([^ ]+) ([^)]+)\\)"/.exec(html);
        if (!ln || !bd) { out.push(what + ': ' + (ln ? 'no badge' : 'no arrow')); return null; }
        var x1 = +ln[1], y1 = +ln[2], x2 = +ln[3], y2 = +ln[4], bx = +bd[1], by = +bd[2], len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        for (var s = 0; s <= 40; s++) {
          var px = x2 + ux * (6.3 - s), py = y2 + uy * (6.3 - s), half = s < 21 ? 10.5 * s / 21 : 3.7;
          if (Math.sqrt((px - bx) * (px - bx) + (py - by) * (py - by)) < 8.6 + half - 0.01) { out.push(what + ': the badge over the arrow ' + s + ' units from its tip'); break; }
        }
        return [bx, by];
      };
      var drawn = function (a) { var f = boardOptsFor(a); return boardSvg(f.st, f.opts); };
      eachMiss([1, 2], function (a, what) {
        var t = a.tried, due = dueMove(a), th = t && t.threat;
        if (!th || th.to !== t.to || th.from === due.to || th.to === due.to) return;
        var b0 = /<g class="badge badge-bad" transform="translate\\(([^ ]+) ([^)]+)\\)"/.exec(drawn(a));
        a.reason = 1;
        var at = clear(drawn(a), what);
        if (at && b0 && (+b0[1] !== at[0] || +b0[2] !== at[1])) out.push(what + ': the badge moved when the arrow came');
        seen.fixture++;
        if (at && boardOptsFor(a).opts.badges[0].at) seen.moved++;
      });
      /* every direction an arrow can come from, on a white and a black card */
      playerTier = function () { return 2; };
      ['white', 'black'].forEach(function (col) {
        var it = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && x.g.color === col; })[0], a = openCard(it);
        gradeMove(uciToMove(a.st, a.playedUci));
        var due = dueMove(a);
        if (a.tried.to === due.to) return;
        a.reason = 1;
        for (var q = 0; q < 64; q++) {
          if (q === a.tried.to || q === due.to) continue;
          a.tried.threat = { from: q, to: a.tried.to, captured: 'P' };
          clear(drawn(a), col + ' card, an arrow from ' + sqName(q) + ' to ' + sqName(a.tried.to));
          seen.forced++;
        }
      });
      return JSON.stringify({ out: out, seen: seen }); })()`));
    eq(r.out.length, 0, r.out.length + ', first: ' + r.out.slice(0, 3).join(' | '));
    ok(r.seen.fixture >= 10 && r.seen.moved >= 1 && r.seen.forced >= 120, 'checked: ' + JSON.stringify(r.seen));
  });

  await test('a miss gives its reason in two beats: the ring and arrow 600 ms after the verdict is read, the words 150 ms later', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* the writes since t0: the marks drawn, the band's row 2 */
    const writes = (t0) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t0} && w.v != null; }).map(function (w) {
      return { id: w.id, kind: w.kind, dt: w.t - ${t0}, ring: /ring/.test(w.v), arrow: /arrow/.test(w.v), r2: w.id === 'cband' ? (/<p class="bd-r2">([^<]*)<\\/p>/.exec(w.v) || [])[1] || '' : null,
        r1: w.id === 'cband' ? (/<h2 class="bd-r1"[^>]*>([^<]*)<\\/h2>/.exec(w.v) || [])[1] || '' : null };
    }))`));
    const keys = JSON.parse(A.ev(`(function () { ${OPEN} playerTier = function () { return 2; };
      return JSON.stringify(allMistakes().filter(trainable).filter(function (it) {
        var a = openCard(it); if (!a || a.sol || !unpackUci(it.b.ru).length) return false;
        gradeMove(uciToMove(a.st, a.playedUci));
        var th = a.tried.threat, due = dueMove(a);
        return th && th.from !== due.to && th.to !== due.to;
      }).slice(0, 4).map(function (it) { return it.key; })); })()`));
    ok(keys.length === 4, 'cards with a drawn threat ' + keys.length);
    let n = 0;
    for (const reduced of [false, true]) {
      A.ev(`(ui.reducedTest = ${reduced}, 1)`);
      const MARK = reduced ? 300 : 600, WORDS = reduced ? 400 : 750;
      for (const key of keys) {
        const at = key + (reduced ? ' (reduced motion)' : '');
        /* the game move again, tapped: it slides, its verdict lands, then the reason */
        A.ev(`(window.__show(model().byKey['${key}']), 1)`);
        run(1000);
        const t0 = A.getNow();
        A.ev(`(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)`);
        run(1600);
        /* the verdict's write, picked by what it wrote */
        const ws = writes(t0), v = ws.filter((w) => w.id === 'cband' && w.r1 === 'Your game move again')[0];
        ok(v && v.r2 === '' && !ws.some((w) => w.id === 'cband' && w.dt < v.dt), at + ': the verdict alone first, ' + JSON.stringify(v));
        const mk = ws.filter((w) => w.id === 'marks' && w.ring)[0], said = ws.filter((w) => w.id === 'cband' && w.r2)[0];
        ok(mk && mk.arrow && mk.dt === v.dt + MARK, at + ': the ring and arrow ' + MARK + ' ms after the verdict, ' + (mk && mk.dt) + ' vs ' + v.dt);
        ok(said && said.dt === v.dt + WORDS && said.r2 === A.ev('esc(ui.session.active.verdict.row2)'), at + ': the words ' + WORDS + ' ms after the verdict, ' + JSON.stringify(said));
        ok(!ws.some((w) => w.kind === 'board' && w.dt > v.dt), at + ': the board stays still while the reason comes');
        eq(A.ev('ui.session.active.reason'), 2, at + ': both beats counted');
        /* the beats run from when the verdict's words really paint: an input
           that ends the slide early (a flush) brings them forward, a board
           beat while they wait puts them back, and the reason keeps its
           600 and 750 ms after them */
        for (const [how, ms, code] of [['a flush mid-slide', reduced ? 50 : 100, 'flushStage()'], ['a board beat while the words wait', reduced ? 100 : 380, "stage(['board'])"]]) {
          A.ev(`(window.__show(model().byKey['${key}']), 1)`);
          run(1000);
          const t2 = A.getNow();
          A.ev(`(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)`);
          run(ms);
          A.ev(`(${code}, 1)`);
          run(1600);
          const w2 = writes(t2), v2 = w2.filter((w) => w.id === 'cband' && w.r1 === 'Your game move again')[0];
          const m2 = w2.filter((w) => w.id === 'marks' && w.ring)[0], s2 = w2.filter((w) => w.id === 'cband' && w.r2)[0];
          ok(v2 && m2 && s2 && m2.dt - v2.dt === MARK && s2.dt - v2.dt === WORDS, at + ', ' + how + ': the reason ' + (v2 && m2 && s2 ? (m2.dt - v2.dt) + ' and ' + (s2.dt - v2.dt) : '?') + ' ms after the verdict, ' + JSON.stringify([v2, m2, s2]));
        }
        /* an engine miss: the verdict when the answer comes, the reason after it */
        A.ev(`(window.__show(model().byKey['${key}']), 1)`);
        run(1000);
        const t1 = A.getNow();
        A.ev(`(function (a) { window.readyEngine(); var m = legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0]; gradeMove(m); return 1; })(ui.session.active)`);
        await tick(); await tick();
        run(1600);
        if (A.ev('ui.session.active.phase') === 'tried' && A.ev('ui.session.active.tried.kind') === 'miss') {
          const w1 = writes(t1), v1 = w1.filter((w) => w.id === 'cband' && w.r1 === 'Not this one')[0];
          const s1 = w1.filter((w) => w.id === 'cband' && w.r1 === 'Not this one' && w.r2)[0];
          ok(v1 && v1.r2 === '' && s1 && s1.dt - v1.dt === WORDS, at + ': an engine miss, its words ' + (s1 && v1 ? s1.dt - v1.dt : '?') + ' ms after the verdict, ' + JSON.stringify([v1, s1]));
          n++;
        }
      }
    }
    A.ev('(ui.reducedTest = false, 1)');
    ok(n >= 4, 'engine misses ' + n);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('See it: its button fades out first, the reply slides along its arrow with its sound, what it took lands with it', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`(function () { ${OPEN} playerTier = function () { return 2; };
      return JSON.stringify(allMistakes().filter(trainable).filter(function (it) {
        var a = openCard(it); if (!a || a.sol || !unpackUci(it.b.ru).length) return false;
        gradeMove(uciToMove(a.st, a.playedUci));
        var t = a.tried, due = dueMove(a);
        return t.threat && t.threat.from !== due.to && t.threat.to !== due.to && t.lost && t.lost.sq !== due.to;
      }).slice(0, 4).map(function (it) { return it.key; })); })()`));
    ok(keys.length === 4, 'cards ' + keys.length);
    /* the marks on screen: those of the latest board or marks write */
    const S = () => JSON.parse(A.ev(`(function (a) { var m = window.__writes.filter(function (w) { return (w.id === 'bwrap' && w.what === 'innerHTML') || w.id === 'marks'; }).pop().v, b0 = barButton(0), b1 = barButton(1);
      return JSON.stringify({ ring: /ring/.test(m), token: /token/.test(m), slide: /slide/.test(m),
        s0: !!(b0 && b0.cls.stale), s1: !!(b1 && b1.cls.stale), band: !!window.__els.cband.cls.stale, acts: slotAct.slice(0, 2).join(' '), mu: motionUntil - Date.now(),
        sounds: window.__snd.map(function (x) { return x.n; }).join(' ') }); })(ui.session.active)`));
    for (const reduced of [false, true]) {
      A.ev(`(ui.reducedTest = ${reduced}, 1)`);
      for (const key of keys) {
        const at = key + (reduced ? ' (reduced motion)' : '');
        A.ev(`(function () { var a = window.__show(model().byKey['${key}']); gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`);
        run(1500);
        let s = S();
        ok(s.ring && s.acts === 'seeIt tryAgain', at + ': the reason drawn, [See it] [Try again]: ' + JSON.stringify(s));
        A.ev('(window.__snd = [], 1)');
        const boards = A.ev('window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).length');
        A.click('seeIt', null, 0);
        s = S();
        if (!reduced) {
          /* text out: the See it button fades, Try again and the band stay; nothing moves yet */
          ok(s.s0 && !s.s1 && !s.band, at + ': See it fades out alone: ' + JSON.stringify(s));
          eq(A.ev('window.__writes.filter(function (w) { return w.id === "bwrap" && w.what === "innerHTML"; }).length'), boards, at + ': no board for 100 ms');
          eq(s.sounds, '', at + ': no sound before the slide');
          run(100);
          s = S();
          ok(s.slide && s.ring && !s.token && s.mu > 300, at + ': at 100 ms the reply slides along its arrow, no token yet: ' + JSON.stringify(s));
          eq(s.sounds, 'move', at + ': the move sound as it starts');
          run(Math.max(0, s.mu));
          s = S();
          ok(s.token && !s.ring, at + ': as it lands the token comes and the ring and arrow go: ' + JSON.stringify(s));
          eq(s.acts, 'seeIt tryAgain', at + ': the bar waits for the words');
          run(200);
        } else {
          ok(!s.slide && s.token && !s.ring && s.sounds === 'move', at + ': under reduced motion the reply lands at once, with its token: ' + JSON.stringify(s));
          run(200);
        }
        s = S();
        ok(/^hint tryAgain$/.test(s.acts) && !s.s0 && !s.s1 && !s.band, at + ': the new bar, nothing faded: ' + JSON.stringify(s));
        /* See it pressed before the reason is drawn (after the slot's 450 ms,
           before V + 600, so the reason's beat comes during the fade or the
           slide): the ring and arrow never first appear on the slide, nor
           after it */
        for (const after of reduced ? [] : [460, 510]) {
          A.ev(`(function () { var a = window.__show(model().byKey['${key}']); gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`);
          const t0 = A.getNow();
          run(10);
          while (!/data-act="seeIt"/.test(A.ev('window.__els.cbar.innerHTML')) && A.getNow() - t0 < 1000) run(10);
          run(after);
          const tap = A.getNow();
          A.click('seeIt', null, 0);
          run(1500);
          const late = A.ev(`window.__writes.filter(function (w) { return w.t >= ${tap} && (w.id === 'marks' || (w.id === 'bwrap' && w.what === 'innerHTML')) && /ring|arrow/.test(w.v); }).length`);
          eq(late, 0, at + ': See it at V + ' + after + ', the reason marks drawn after it ' + late + ' times');
          ok(S().token, at + ': See it at V + ' + after + ', what it took lands');
        }
      }
    }
    A.ev('(ui.reducedTest = false, 1)');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('Try again: the old words fade out with the crossfade, the tried move lands after it, the words 300 ms after the tap', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 5).map(function (it) { return it.key; }))`));
    const at0 = (t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t} && w.v != null; }).map(function (w) {
      return w.kind + ' ' + w.id + ' +' + (w.t - ${t}) + (w.kind !== 'text' && /tried/.test(w.v) ? ' tried' : '') + (w.kind !== 'text' && /xfade/.test(w.v) ? ' xfade' : '');
    }))`));
    let n = 0;
    for (const reduced of [false, true]) {
      A.ev(`(ui.reducedTest = ${reduced}, 1)`);
      for (const key of keys) {
        const at = key + (reduced ? ' (reduced motion)' : '');
        A.ev(`(function () { var a = window.__show(model().byKey['${key}']); window.readyEngine();
          gradeMove(legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0]); return 1; })()`);
        await tick(); await tick();
        run(1500);
        if (A.ev('ui.session.active.phase') !== 'tried' || A.ev('ui.session.active.tried.kind') !== 'miss') continue;
        n++;
        const t0 = A.getNow();
        A.click('tryAgain', null, 1);
        const st = JSON.parse(A.ev(`JSON.stringify({ band: !!window.__els.cband.cls.stale, b: [0, 1].map(function (i) { var b = barButton(i); return !!(b && b.cls.stale); }) })`));
        run(600);
        const ws = at0(t0);
        if (!reduced) {
          ok(st.band && st.b[0] && st.b[1], at + ': the band and both buttons fade out at the tap: ' + JSON.stringify(st));
          ok(/^board bwrap \+0 xfade$/.test(ws[0]), at + ': the crossfade at the tap, without the tried move: ' + ws.join(', '));
          ok(ws.some((w) => w === 'marks marks +150 tried'), at + ': the tried move lands when the crossfade ends: ' + ws.join(', '));
          const tx = ws.filter((w) => /^text/.test(w)).map((w) => +w.split('+')[1]);
          ok(tx.length && Math.min.apply(null, tx) === 300, at + ': the words 300 ms after the tap: ' + ws.join(', '));
        } else {
          ok(/^board bwrap \+0 tried$/.test(ws[0]), at + ': under reduced motion the card and its tried move at once: ' + ws.join(', '));
        }
        eq(A.ev('!!window.__els.cband.cls.stale || [0, 1].some(function (i) { var b = barButton(i); return !!(b && b.cls.stale); })'), false, at + ': nothing faded once the words are back');
      }
    }
    A.ev('(ui.reducedTest = false, 1)');
    ok(n >= 6, 'misses ' + n);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('a hint or the answer from the card: its marks are drawn, then the words 150 ms later, never in one task', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).slice(0, 4).map(function (it) { return it.key; }))`));
    for (const key of keys) for (const reduced of [false, true]) for (const act of ['hint', 'hint 2', 'reveal']) {
      const at = key + ' ' + act + (reduced ? ' (reduced motion)' : '');
      A.ev(`(ui.reducedTest = ${reduced}, window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      if (act === 'hint 2') { A.click('hint', null, 0); run(1000); }
      const t0 = A.getNow();
      A.click(act === 'reveal' ? 'reveal' : 'hint', null, act === 'reveal' ? 1 : 0);
      run(600);
      const ws = JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t0} && (w.v != null || w.kind === 'text'); }).map(function (w) { return { k: w.kind, dt: w.t - ${t0} }; }))`));
      const board = ws.filter((w) => w.k === 'board'), text = ws.filter((w) => w.k === 'text');
      ok(board.length && board[0].dt === 0, at + ': the board at the press: ' + JSON.stringify(ws));
      ok(text.length && Math.min.apply(null, text.map((w) => w.dt)) >= 150, at + ': the words 150 ms after it: ' + JSON.stringify(ws));
    }
    A.ev('(ui.reducedTest = false, 1)');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('a hint is drawn: after Try again the automatic hint (and a hint pressed over a try) lands with the tried line once the crossfade ends, its words 300 ms after the tap; every hint frame keeps the mark budget', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* one-move cards whose hint 1 draws: a danger (ring and arrow) or a prize (dashed gold ring) */
    const keys = JSON.parse(A.ev(`JSON.stringify((function () { var dz = [], pz = [];
      allMistakes().filter(trainable).forEach(function (it) {
        ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
        var a = cardFor(it); if (!a || a.sol) return; a.hints = 1;
        var hm = hintMarks(a); if (hm.danger) dz.push(it.key); else if (hm.prize) pz.push(it.key);
      }); return dz.slice(0, 4).concat(pz.slice(0, 2)); })())`));
    ok(keys.length === 6, 'cards ' + keys.length);
    const at0 = (t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t} && w.v != null; }).map(function (w) {
      return w.kind + ' ' + w.id + ' +' + (w.t - ${t}) + (w.kind === 'text' ? (/Hint 1 of 2/.test(w.v) ? ' H1' : /Hint 2 of 2/.test(w.v) ? ' H3' : '') : ' ' + w.v);
    }))`));
    /* the marks the card draws now, against the budget (2.1): two arrows, one ring (the gold pair aside), one tried line */
    const budget = (at) => {
      const b = JSON.parse(A.ev(`JSON.stringify((function (a) { var o = boardOptsFor(a).opts;
        return { arrows: (o.arrows || []).length + (o.bad ? 1 : 0), rings: (o.rings || []).filter(function (m) { return m.kind !== 'nope'; }).length + (o.hint != null ? 1 : 0), tried: (o.tried || []).length }; })(ui.session.active))`));
      ok(b.arrows <= 2 && b.rings <= 1 && b.tried <= 1, at + ': over the budget ' + JSON.stringify(b));
      return b;
    };
    const hinted = (w) => / (ring arrow|target|ring|arrow)/.test(w) && /(ring|target)/.test(w);
    let n = 0, withTried = 0;
    for (const reduced of [false, true]) {
      A.ev(`(ui.reducedTest = ${reduced}, 1)`);
      for (const key of keys) for (const how of ['auto', 'pressed', 'auto, off-book']) {
        const at = key + ' ' + how + (reduced ? ' (reduced motion)' : '');
        /* tier 1: the first miss brings hint 1; tier 3: none, Hint is pressed over the try */
        A.ev(`(playerTier = function () { return ${how === 'pressed' ? 3 : 1}; }, 1)`);
        A.ev(`(function () { var a = window.__show(model().byKey['${key}']); window.readyEngine();
          var m = '${how}' === 'auto, off-book' ? legalMoves(a.st).filter(function (x) { var u = moveUci(x); return u !== a.bestUci && u !== a.playedUci; })[0] : uciToMove(a.st, a.playedUci);
          gradeMove(m); return 1; })()`);
        await tick(); await tick();
        run(1500);
        if (A.ev('ui.session.active.phase') !== 'tried' || A.ev('ui.session.active.tried.kind') !== 'miss') continue;
        eq(A.ev('ui.session.active.hints'), how === 'pressed' ? 0 : 1, at + ': hints before Try again');
        ok(!at0(0).slice(-6).some((w) => /^(board|marks)/.test(w) && / (target|hint)/.test(w)), at + ': no hint mark over the try');
        n++;
        const t0 = A.getNow();
        if (how === 'pressed') A.key('?'); else A.click('tryAgain', null, 1);
        run(600);
        const ws = at0(t0);
        eq(A.ev('ui.session.active.hints'), 1, at + ': hint 1 after it');
        const text = ws.filter((w) => /^text cband/.test(w));
        if (!reduced) {
          ok(/^board bwrap \+0 /.test(ws[0]) && / xfade/.test(ws[0]) && !hinted(ws[0]), at + ': the crossfade at the tap, without the hint marks: ' + ws.join(', '));
          const mk = ws.filter((w) => /^marks marks \+150 /.test(w));
          ok(mk.length && hinted(mk[0]), at + ': the hint marks land when the crossfade ends: ' + ws.join(', '));
          if (how === 'auto, off-book') { ok(/ tried/.test(mk[0]), at + ': with the tried line: ' + ws.join(', ')); withTried++; }
          ok(text.length && +text[0].split('+')[1].split(' ')[0] === 300 && / H1$/.test(text[0]), at + ': "Hint 1 of 2" 300 ms after the tap: ' + ws.join(', '));
        } else {
          ok(/^board bwrap \+0 /.test(ws[0]) && hinted(ws[0]), at + ': under reduced motion the card and its hint marks at once: ' + ws.join(', '));
          ok(text.length && / H1$/.test(text[0]), at + ': "Hint 1 of 2": ' + ws.join(', '));
        }
        budget(at);
        /* hint 2: the gold ring alone on the piece to move */
        run(500);
        const t1 = A.getNow();
        A.key('?');
        run(400);
        const w2 = at0(t1);
        ok(w2.some((w) => /^board bwrap \+0 /.test(w) && / hint/.test(w) && !/ (ring|arrow|target)/.test(w.replace(/ hint/, ''))), at + ': hint 2 draws its ring alone: ' + w2.join(', '));
        ok(w2.some((w) => /^text cband/.test(w) && / H3$/.test(w)), at + ': "Hint 2 of 2": ' + w2.join(', '));
        budget(at + ', hint 2');
      }
    }
    A.ev('(ui.reducedTest = false, playerTier = function () { return 2; }, 1)');
    ok(n >= 24 && withTried >= 4, 'misses ' + n + ', with a tried line ' + withTried);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('the sound context is made inside the player\'s gesture, never inside a timed beat; a piece picked up taps', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* a Web Audio stand-in that notes when a context is made */
    A.ev(`(function () {
      window.__ctx = []; window.__tones = 0; sndCtx = null; cfg.sound = true;
      var node = function () { return { frequency: {}, gain: { setValueAtTime: function () {}, linearRampToValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
        connect: function () {}, start: function () { window.__tones++; }, stop: function () {} }; };
      window.AudioContext = function () { window.__ctx.push(Date.now()); this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createOscillator = node; this.createGain = node; this.resume = function () {}; };
      var s0 = snd; window.__snd = []; snd = function (n) { window.__snd.push(n); return s0.apply(this, arguments); };
      return 1; })()`);
    const key = A.ev(`allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; })[0].key`);
    A.ev(`(window.__show(model().byKey['${key}']), 1)`);
    run(1000);
    const c = JSON.parse(A.ev('JSON.stringify({ f: ui.session.active.played.from, t: ui.session.active.played.to })'));
    eq(A.ev('window.__ctx.length'), 0, 'no context before the first gesture');
    const t0 = A.getNow();
    /* a lift that plays nothing still makes it, and so does a key */
    A.pointer('pointerup', c.t);
    eq(A.ev('JSON.stringify(window.__ctx) + " " + window.__snd.length'), JSON.stringify([t0]) + ' 0', 'the context is made by the first lift, inside the gesture, with no sound');
    A.ev('(sndCtx = null, 1)');
    A.key('Escape');
    eq(A.ev('window.__ctx.length + " " + window.__snd.length'), '2 0', 'a key makes it too');
    A.pointer('pointerdown', c.f);
    eq(A.ev('window.__snd.join(" ")'), 'tap', 'a piece picked up by a press taps');
    A.pointer('pointerup', c.f); A.pointer('click', c.f);
    A.tap(c.t);
    run(1500);
    eq(A.ev('window.__ctx.length'), 2, 'the verdict plays on the context made in the gesture');
    ok(/bad/.test(A.ev('window.__snd.join(" ")')) && A.ev('window.__tones') > 0, 'the verdict sounds: ' + A.ev('window.__snd.join(" ")'));
    A.ev('(cfg.sound = false, sndCtx = null, window.__ctx = [], 1)');
    A.key('Escape');
    eq(A.ev('window.__ctx.length'), 0, 'with the sound off no context is made');
    A.ev('(cfg.sound = true, 1)');
  });

  await test('a verdict lands on its square once the piece has landed, with its sound; a check speaks after 300 ms', async () => {
    const A = boot();
    /* haptics, with sound on (Android): a short buzz for a found move, a double one for a wrong one */
    const buzz = JSON.parse(A.ev(`(function () { var out = []; navigator.vibrate = function (p) { out.push(JSON.stringify(p)); return true; };
      cfg.sound = true; snd('good'); snd('bad'); snd('tap'); snd('move'); cfg.sound = false; snd('good'); snd('bad'); cfg.sound = true;
      delete navigator.vibrate; snd('bad'); return JSON.stringify(out); })()`));
    eq(buzz.join(' '), '15 [30,60,30]', 'vibrate on good and bad, only with sound on');
    A.ev(DOM);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const band = () => A.ev('window.__els.cband.innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim()');
    const boards = (t0) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.id === 'bwrap' && w.what === 'innerHTML' && w.t >= ${t0}; }).map(function (w) { return w.t - ${t0}; }))`));
    const html = () => A.ev('window.__els.bwrap.innerHTML');
    const sounds = (t0) => JSON.parse(A.ev(`JSON.stringify(window.__snd.filter(function (x) { return x.t >= ${t0}; }).map(function (x) { return x.n + '+' + (x.t - ${t0}); }))`));
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 5).map(function (it) { return it.key; }))`));
    for (const key of cards) {
      /* the game move, tapped: it slides with no badge; the badge, the tints and the sound land together after it */
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev('(function (a) { sessionClick(a.played.from); return 1; })(ui.session.active)');
      run(100);
      let t0 = A.getNow();
      A.ev('(function (a) { sessionClick(a.played.to); return 1; })(ui.session.active)');
      ok(/anim-piece/.test(html()) && !/badge-bad|tint-bad/.test(html()), key + ': the slide carries no verdict');
      /* nor the last-move tint: the squares change colour once, to the verdict's, when it lands */
      ok(html().indexOf('fill="' + A.ev('HL_MOVE') + '"') < 0, key + ': no last-move tint while the try slides');
      eq(sounds(t0).filter((x) => /^bad/.test(x)).length, 0, key + ': no sound while the piece slides');
      const mu = A.ev('motionUntil') - t0;
      run(1000);
      const bw = boards(t0);
      eq(bw.length, 2, key + ': the slide, then the landing: ' + bw.join(','));
      eq(bw[1], mu, key + ': the landing drawn when the slide ends');
      ok(/badge badge-bad/.test(html()) && /tint-bad/.test(html()) && !/anim-piece/.test(html()), key + ': the cross and the red tints on the squares');
      eq(sounds(t0).join(' '), 'bad+' + mu, key + ': the bad sound with the badge');
      ok(/^Your game move again/.test(band()), key + ': the band: ' + band());
      /* a move off the card's lines: it lands with the grey dots; the band
         keeps the task for 300 ms, then says the move is checked, at 3 s that
         it still is, and at 9 s that it cannot be */
      A.ev(`(function () { ${AFTER} var a = ui.session.active; tryAgain(); return 1; })()`);
      run(1000);
      A.ev(`(function () { ${AFTER} var a = ui.session.active; window.readyEngine(); window.__holdTry = true; window.__m = offBook(a); sessionClick(window.__m.from); sessionClick(window.__m.to); return 1; })()`);
      t0 = A.getNow();
      ok(/anim-piece/.test(html()) && html().indexOf('fill="' + A.ev('HL_MOVE') + '"') < 0 && !/tint-checking/.test(html()), key + ': the checked move slides with no tint');
      const land = A.ev('motionUntil') - t0;
      const bar = () => A.ev('window.__els.cbar.innerHTML.match(/data-act="[a-zA-Z]+"/g).join(" ")');
      run(land + 200);
      ok(/badge badge-checking/.test(html()) && /tint-checking/.test(html()), key + ': the move lands with the grey dots');
      ok(/^Your turn Find a better move/.test(band()), key + ': the band keeps the task: ' + band());
      /* the bar too: it changes with K1, in the same text beat, never at the landing */
      eq(bar(), 'data-act="hint" data-act="reveal"', key + ': the guess bar 200 ms after the move landed');
      run(150);
      ok(/^Checking \S+…$/.test(band()) && /card-task k-neutral sweep/.test(A.ev('window.__els.cband.innerHTML')), key + ': K1 with the sweep, 300 ms after the move landed: ' + band());
      eq(bar(), 'data-act="takeBack"', key + ': Take back with K1 (Show the answer switched off)');
      eq(A.ev(`window.__writes.filter(function (w) { return w.id === 'cbar' && w.t > ${t0}; }).map(function (w) { return w.t; }).filter(function (t, i, l) { return l.indexOf(t) === i; }).length`), 1, key + ': the bar written once since the move');
      run(2700);
      ok(/^Checking \S+… Still checking\.$/.test(band()), key + ': K2 at 3 s: ' + band());
      t0 = A.getNow();
      run(6500);
      ok(/^Cannot check this move Not counted\. Try again\.$/.test(band()), key + ': E1 and E2 at 9 s: ' + band());
      ok(/badge badge-unchecked/.test(html()) && /tint-unchecked/.test(html()), key + ': the question mark on the square');
      eq(sounds(t0).length, 0, key + ': no sound for a move not checked');
      eq(A.ev('ui.session.active.misses'), 1, key + ': not counted');
      A.ev('(window.__holdTry = false, 1)');
    }
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
  /* a number as boardSvg prints it, ready for a regular expression */
  const rx = (n) => String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  /* the writes since t0, as the settled-result tests read them: who, when,
     the marks drawn (as words), the band's rows, the bar's labels and the
     strip's Details */
  const SETTLED = `function settledWrites(t0) {
    return window.__writes.filter(function (w) { return w.t >= t0 && (w.v != null || w.id === 'cstrip'); }).map(function (w) {
      var v = w.v || '';
      return { id: w.id, kind: w.kind, dt: w.t - t0, v: w.id === 'bwrap' || w.id === 'marks' ? v : '',
        r1: w.id === 'cband' ? (/<h2 class="bd-r1"[^>]*>([^<]*)<\\/h2>/.exec(v) || [])[1] || '' : null,
        r2: w.id === 'cband' ? (/<p class="bd-r2">([^<]*)<\\/p>/.exec(v) || [])[1] || '' : null,
        bar: w.id === 'cbar' ? v.replace(/<a [^>]*>/g, '').split('</a>').filter(Boolean).join(' | ') : null };
    });
  }`;

  await test('a solve settles in beats: the tick lands with the piece, S0\'s marks 700 ms after its words, R4 and Details 150 ms later', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(`${SETTLED} window.__sw = settledWrites; 1`);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* one-move cards whose game reply captures or checks (S0's threat pair), and a missed chance */
    const keys = JSON.parse(A.ev(`(function () { ${OPEN}
      var its = allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); return a && !a.sol; });
      var pair = its.filter(function (it) { var a = openCard(it); return familyOf(patternOf(it.b)).key !== 'chances' && threatOf(a.cls.gameLine, 1) && a.best.to !== a.played.to; }).slice(0, 3);
      /* a missed chance whose game reply captures or checks, from a piece still standing once solved */
      var ch = its.filter(function (it) { var a = openCard(it), t = threatOf(a.cls.gameLine, 1); if (familyOf(patternOf(it.b)).key !== 'chances' || !t || a.best.to === a.played.to) return false;
        applyMove(a.st, uciToMove(a.st, a.bestUci)); return a.st.b[t.from] === a.cls.gameLine.nodes[1].before.b[t.from]; }).slice(0, 1);
      return JSON.stringify(pair.concat(ch).map(function (it) { return it.key; })); })()`));
    ok(keys.length === 4, 'cards ' + keys.length);
    for (const reduced of [false, true]) for (const key of keys) {
      const at = key + (reduced ? ' (reduced motion)' : ''), MARKS = reduced ? 300 : 700, WORDS = reduced ? 400 : 850;
      A.ev(`(ui.reducedTest = ${reduced}, window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      const t0 = A.getNow();
      A.ev('(window.__snd = [], 1)');
      A.ev(`(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)`);
      run(2000);
      const ws = JSON.parse(A.ev(`JSON.stringify(window.__sw(${t0}))`)), snd = JSON.parse(A.ev('JSON.stringify(window.__snd)'));
      const first = ws.filter((w) => w.id === 'bwrap')[0], tick = ws.filter((w) => /tick/.test(w.v))[0];
      ok(first && first.dt === 0 && (reduced ? /tick/.test(first.v) : /slide/.test(first.v) && !/tick/.test(first.v)), at + ': the move slides with no tick yet, ' + JSON.stringify(first));
      ok(tick && (reduced || tick.dt >= 220), at + ': the tick lands with the piece, ' + JSON.stringify(tick));
      ok(snd.filter((x) => x.n === 'good').length === 1 && snd.filter((x) => x.n === 'good')[0].t - t0 === tick.dt, at + ': its sound with it, ' + JSON.stringify(snd));
      const v = ws.filter((w) => w.id === 'cband' && w.r1 === 'Found it')[0], bar = ws.filter((w) => w.id === 'cbar')[0];
      ok(v && v.r2 === '' && v.dt >= tick.dt + 150, at + ': Found it alone, 150 ms after the tick, ' + JSON.stringify(v));
      ok(bar && /^See why › \| (Continue|Finish)$/.test(bar.bar) && bar.dt === v.dt, at + ': the bar with it, ' + JSON.stringify(bar));
      const gh = ws.filter((w) => w.id === 'bwrap' && /ghost/.test(w.v))[0], chances = A.ev(`familyOf(patternOf(model().byKey['${key}'].b)).key`) === 'chances';
      ok(gh && gh.dt === v.dt + MARKS, at + ': the ghost ' + MARKS + ' ms after the words, ' + JSON.stringify(gh) + ' vs ' + v.dt);
      ok(chances ? !/ring|arrow/.test(gh.v) : /ring/.test(gh.v) && /arrow/.test(gh.v) || !A.ev('(function (a) { var t = threatOf(a.cls.gameLine, 1); return !!(t && a.st.b[t.from] === a.cls.gameLine.nodes[1].before.b[t.from]); })(ui.session.active)'),
        at + ': the threat pair with it (none on a missed chance), ' + gh.v);
      ok(/tick/.test(gh.v), at + ': the tick stays');
      const r4 = ws.filter((w) => w.id === 'cband' && w.r2)[0], strip = ws.filter((w) => w.id === 'cstrip' && w.dt > 0).pop();
      ok(r4 && r4.dt === v.dt + WORDS && r4.r1 === 'Found it' && r4.r2 === A.ev('esc(displayFor(ui.session.active).row2)'), at + ': R4 ' + WORDS + ' ms after, ' + JSON.stringify(r4));
      ok(strip && strip.dt === r4.dt && A.ev('/data-act="details"/.test(window.__els.cstrip.innerHTML)'), at + ': Details with it');
      /* and then nothing, however long */
      const n0 = A.ev('window.__writes.length');
      run(10000);
      eq(A.ev('window.__writes.length'), n0, at + ': nothing more is written');
    }
    A.ev('(ui.reducedTest = false, 1)');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('Show the answer: the green arrow and "The answer:", Play it plays it with the grey i, then the card settles', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev(`${SETTLED} window.__sw = settledWrites; 1`);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`(function () { ${OPEN} return JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); return a && !a.sol; }).slice(0, 4).map(function (it) { return it.key; })); })()`));
    for (const how of ['button', 'by hand', 'test hook']) for (const key of keys) {
      const at = key + ' ' + how;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.click('reveal', null, 1);
      run(600);
      const s = JSON.parse(A.ev(`JSON.stringify((function (a) { var d = displayFor(a), f = boardOptsFor(a), b = uciToMove(a.st, a.bestUci);
        return { phase: a.phase, result: a.result, mode: a.view.mode, r1: d.row1, r2: d.row2, disc: d.disc, bar: d.buttons.map(function (x) { return x.label + (x.off ? ' (off)' : ''); }).join(' | '),
          arrows: (f.opts.arrows || []).map(function (x) { return x.kind + ' ' + x.from + '-' + x.to; }), bad: f.opts.bad || null, want: 'better ' + b.from + '-' + b.to,
          san: sanOf(a.st, b), live: f.live, note: ui.session.notes[a.key], recorded: srsRec(a.it) ? 1 : 0 }; })(ui.session.active))`));
      eq(s.phase + ' ' + s.result + ' ' + s.mode, 'done fail show', at + ': graded and finished, then shown');
      eq(s.note, 'shown', at + ': the summary note');
      eq(s.r1 + ' / ' + s.r2, 'The answer: ' + s.san + ' / Play the green arrow.', at + ': V1 / V2');
      eq(s.disc, 'info', at + ': the i disc');
      eq(s.bar.replace('Finish', 'Continue'), 'Continue | Play it ›', at + ': the bar');
      eq(JSON.stringify(s.arrows), JSON.stringify([s.want]), at + ': the green arrow alone, no game arrow');
      ok(!s.bad && s.live, at + ': the board takes that one move');
      if (how === 'by hand') {
        /* another piece of yours says where to try moves; the answer's piece picks up, its one square dotted */
        const other = A.ev('(function (a) { var b = uciToMove(a.st, a.bestUci); for (var q = 0; q < 64; q++) if (q !== b.from && a.st.b[q] && isW(a.st.b[q]) === !!a.st.w) return q; return -1; })(ui.session.active)');
        A.ev(`(sessionClick(${other}), 1)`);
        eq(A.ev('ui.session.active.note && ui.session.active.note.id'), 'N1', at + ': another piece: N1');
        eq(A.ev('ui.session.active.sel'), -1, at + ': and no selection');
        A.ev(`(function (a) { var b = uciToMove(a.st, a.bestUci); sessionClick(b.from); return 1; })(ui.session.active)`);
        eq(A.ev('JSON.stringify(boardOptsFor(ui.session.active).opts.dots)'), A.ev('JSON.stringify([uciToMove(ui.session.active.st, ui.session.active.bestUci).to])'), at + ': its one square dotted');
        run(3000);
      }
      const t0 = A.getNow();
      A.ev('(window.__snd = [], 1)');
      if (how === 'button') A.click('playIt', null, 1);
      else if (how === 'test hook') eq(A.ev(`window.__nlTest.play(ui.session.active.bestUci)`), 'played', at + ': __nlTest.play plays the answer');
      else A.ev(`(function (a) { var b = uciToMove(a.st, a.bestUci); sessionClick(b.to); return 1; })(ui.session.active)`);
      /* from Play it a move the app shows: Play it, going off, fades out
         first (100 ms, 2.2); by hand the player's own move goes at once */
      const lead = how === 'by hand' ? 0 : 100;
      if (how === 'button') ok(A.ev('!!window.__els.cbar.querySelector(\'[data-slot="1"]\').cls.stale'), at + ': Play it fades out first');
      run(lead);
      const mu = A.ev('motionUntil') - t0;
      eq(A.ev('(function (a) { var f = stateFen(a.st); playIt(false); return stateFen(a.st) === f && window.__nlTest.play(moveUci(legalMoves(a.st)[0])) === "not guessing"; })(ui.session.active)'), true, at + ': played once');
      run(3000);
      const ws = JSON.parse(A.ev(`JSON.stringify(window.__sw(${t0}))`)), snd = JSON.parse(A.ev('JSON.stringify(window.__snd)'));
      const slide = ws.filter((w) => w.id === 'bwrap')[0], info = ws.filter((w) => /info/.test(w.v))[0];
      ok(slide && /slide/.test(slide.v) && !/green/.test(slide.v) && !/info/.test(slide.v), at + ': the answer slides, its arrow gone, ' + JSON.stringify(slide));
      ok(slide.dt === lead && mu === lead + 370, at + ': a 320 ms slide (with its 50 ms lead), ' + lead + ' ms after the press, ' + mu + ' ' + JSON.stringify(slide));
      ok(snd.length === 1 && snd[0].n === 'move' && snd[0].t === t0 + lead, at + ': its sound as it starts, ' + JSON.stringify(snd));
      ok(info && info.dt === lead + 370, at + ': the grey i lands with it, ' + JSON.stringify(info));
      const r4 = ws.filter((w) => w.id === 'cband' && w.r2 && w.r2 !== 'Play the green arrow.')[0];
      ok(!ws.some((w) => w.id === 'cband' && w.dt < (r4 ? r4.dt : 1e9)), at + ': the band stays until R4, ' + JSON.stringify(ws.filter((w) => w.id === 'cband')));
      const bars = ws.filter((w) => w.id === 'cbar'), gh = ws.filter((w) => w.id === 'bwrap' && /ghost/.test(w.v))[0];
      ok(bars[0] && /^(Continue|Finish) \| Play it ›$/.test(bars[0].bar) && bars[0].dt === lead + 520, at + ': the bar repainted once played, ' + JSON.stringify(bars));
      ok(gh && gh.dt === lead + 520 + 700 && /info/.test(gh.v), at + ': S0\'s marks 700 ms after, ' + JSON.stringify(gh));
      ok(r4 && r4.dt === lead + 520 + 850 && /^The answer: /.test(r4.r1), at + ': R4 850 ms after, under the answer, ' + JSON.stringify(r4));
      ok(bars[1] && /^See why › \| (Continue|Finish)$/.test(bars[1].bar) && bars[1].dt === r4.dt, at + ': and the bar to the story, ' + JSON.stringify(bars));
      eq(A.ev('ui.session.active.result + " " + ui.session.notes[ui.session.active.key]'), 'fail shown', at + ': graded once, as shown');
    }
    /* Continue at any point ends the card */
    A.ev(`(window.__show(model().byKey['${keys[0]}']), 1)`);
    run(1000); A.click('reveal', null, 1); run(600);
    A.click('next', null, 0);
    eq(A.ev('ui.session.idx'), 1, 'Continue before Play it ends the card');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('a mid-line reveal keeps the moves found and names the move due now; Play it steps the rest of the line', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(`${SETTLED} window.__sw = settledWrites; 1`);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`(function () { ${OPEN} return JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); return a && a.sol && a.sol.length >= 3; }).map(function (it) { return it.key; })); })()`));
    ok(keys.length >= 4, 'forcing cards ' + keys.length);
    let steps = 0;
    for (const key of keys) for (const from of [0, 2]) {
      const at = key + ' revealed at move ' + from;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      /* the line's first move found (its reply plays), then Show the answer */
      if (from) { A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); return 1; })(ui.session.active)'); run(2000); }
      const before = JSON.parse(A.ev('JSON.stringify({ fen: stateFen(ui.session.active.st), idx: ui.session.active.solIdx })'));
      eq(before.idx, from, at + ': the line where it stands');
      A.click('reveal', null, 1);
      run(600);
      const s = JSON.parse(A.ev(`JSON.stringify((function (a) { var d = displayFor(a), m = uciToMove(a.st, a.sol[a.solIdx]), f = boardOptsFor(a);
        return { fen: stateFen(a.st), r1: d.row1, want: 'The answer: ' + sanOf(a.st, m), arrows: (f.opts.arrows || []).map(function (x) { return x.from + '-' + x.to; }), due: m.from + '-' + m.to, result: a.result }; })(ui.session.active))`));
      eq(s.fen, before.fen, at + ': the moves found stay on the board (4.7)');
      eq(s.r1, s.want, at + ': the answer named is the move due now');
      eq(JSON.stringify(s.arrows), JSON.stringify([s.due]), at + ': its green arrow');
      eq(s.result, 'fail', at + ': graded at once');
      /* Play it until the line ends: each reply of theirs plays by itself, held (S10), and the next move of yours lands with its arrow */
      for (let guard = 0; guard < 10 && A.ev('ui.session.active.view.mode') === 'show'; guard++) {
        const idx = A.ev('ui.session.active.solIdx');
        A.click('playIt', null, 1);
        eq(A.ev('ui.session.active.solIdx'), idx + 1, at + ': Play it plays one move');
        if (A.ev('ui.session.active.view.mode') !== 'show') break;
        /* while their reply is due, Play it is off and the board takes nothing */
        eq(A.ev('!!ui.session.active.showWait'), true, at + ': their reply is due');
        A.click('playIt', null, 1);
        eq(A.ev('ui.session.active.solIdx'), idx + 1, at + ': Play it does nothing meanwhile');
        const t1 = A.getNow();
        run(2000);
        const ws = JSON.parse(A.ev(`JSON.stringify(window.__sw(${t1}))`));
        const reply = ws.filter((w) => w.id === 'bwrap' && /slide/.test(w.v) && w.dt >= 600)[0];
        ok(reply && !/green/.test(reply.v), at + ': their reply slides, no arrow yet, ' + JSON.stringify(ws.filter((w) => w.id === 'bwrap')));
        const green = ws.filter((w) => w.id === 'bwrap' && /green/.test(w.v))[0];
        ok(green && green.dt > reply.dt, at + ': the next arrow lands after it');
        eq(A.ev('ui.session.active.solIdx'), idx + 2, at + ': their reply played');
        eq(A.ev('displayFor(ui.session.active).row1'), A.ev('"The answer: " + sanOf(ui.session.active.st, uciToMove(ui.session.active.st, ui.session.active.sol[ui.session.active.solIdx]))'), at + ': the next answer named');
        steps++;
        A.advance(500);
      }
      run(2000);
      const end = JSON.parse(A.ev(`JSON.stringify((function (a) { var d = displayFor(a); return { mode: a.view.mode, settle: a.settle, idx: a.solIdx, n: a.sol.length, bar: d.buttons.map(function (x) { return x.label; }).join(' | '), r1: d.row1, r2: d.row2 }; })(ui.session.active))`));
      eq(end.mode + ' ' + end.settle + ' ' + (end.idx === end.n), 's0 2 true', at + ': the line ends, the card settles');
      eq(end.bar, 'See why › | Continue', at + ': the bar to the story');
      ok(/^The answer: /.test(end.r1) && end.r2, at + ': R4 under the answer, ' + end.r1 + ' / ' + end.r2);
    }
    ok(steps >= 4, 'replies stepped ' + steps);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('after an answer the keyboard follows the right-hand button: Play it, its slot while off, Continue once settled; Space presses nothing', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const foc = () => A.ev(`(function () { var e = document.activeElement; return !e ? 'none' : e.host + ' ' + (e.id || (e.getAttribute('data-act') + '@' + e.getAttribute('data-slot'))); })()`);
    /* the key goes to what has focus: a bar button as itself, anything else (an off slot, nothing) as the page */
    const on = () => JSON.parse(A.ev(`(function () { var e = document.activeElement; return JSON.stringify(e && e.getAttribute && e.getAttribute('data-act') ? { act: e.getAttribute('data-act'), slot: +e.getAttribute('data-slot') } : null); })()`));
    const S = () => JSON.parse(A.ev('JSON.stringify((function (ss, a) { return !a ? { idx: ss.idx } : { idx: ss.idx, mode: a.view.mode || "line", settle: a.settle, solIdx: a.solIdx }; })(ui.session, ui.session.active))'));
    const keys = JSON.parse(A.ev(`(function () { var its = allMistakes().filter(trainable);
      var one = its.filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 3), line = its.filter(function (x) { var a = cardFor(x); return a && a.sol && a.sol.length >= 5; }).slice(0, 2);
      return JSON.stringify({ one: one.map(function (x) { return x.key; }), line: line.map(function (x) { return x.key; }) }); })()`));
    const show = (key) => { A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`); run(1000); };
    for (const [i, key] of keys.one.entries()) {
      show(key);
      A.click('reveal', null, 1);
      run(600);
      eq(foc(), 'cbar playIt@1', key + ': the answer shown focuses Play it');
      /* Enter plays it (by key, or a tap on the focused button); the slot keeps the focus while it is off */
      if (i === 1) A.click('playIt', null, 1); else A.key('Enter', false, on());
      run(700);
      eq(foc(), 'cbar null@1', key + ': Play it, off, keeps the keyboard in its slot');
      A.key('Enter', false, on());
      eq(S().settle, 0, key + ': Enter on the off slot does nothing');
      run(2000);
      eq(S().mode + ' ' + S().settle, 's0 2', key + ': settled');
      eq(foc(), 'cbar next@1', key + ': settled, the focus is on Continue, never on See why');
      /* Space presses nothing in S0, on the focused Continue or anywhere */
      A.key(' ', false, on());
      A.key(' ', false, null);
      eq(S().idx + ' ' + S().mode, '0 s0', key + ': Space does nothing in S0');
      A.key('Enter', false, i === 2 ? null : on());
      eq(S().idx, 1, key + ': Enter is Continue');
    }
    /* a solve: Continue focused; Space on it does nothing */
    show(keys.one[0]);
    A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
    run(2000);
    eq(foc(), 'cbar next@1', 'a solve focuses Continue');
    A.key(' ', false, on());
    eq(S().idx + ' ' + S().mode, '0 s0', 'Space on Continue after a solve does nothing');
    /* a mid-line reveal: each Enter plays the next move, never ends the card */
    for (const key of keys.line) {
      show(key);
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); return 1; })(ui.session.active)');
      run(2500);
      A.click('reveal', null, 1);
      run(600);
      let n = 0;
      while (S().mode === 'show' && n++ < 10) {
        eq(foc(), 'cbar playIt@1', key + ': Play it has the keyboard at move ' + S().solIdx);
        const s0 = S();
        A.key('Enter', false, on());
        eq(S().solIdx, s0.solIdx + 1, key + ': Enter played the move due');
        eq(S().idx, 0, key + ': and stayed on the card');
        run(2500);
      }
      ok(n >= 2, key + ': moves played ' + n);
      eq(S().mode + ' ' + S().settle, 's0 2', key + ': the line ended, settled');
      eq(foc(), 'cbar next@1', key + ': then Continue');
    }
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('Esc in See why goes back to S0; a held Escape closes a sheet once and stays exploring', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(`(function () { ${OPEN} var it = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; })[0], a = openCard(it);
      solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.settle = 2; seeWhy(); return 1; })()`);
    eq(A.ev('ui.session.active.view.mode'), 'story', 'See why open');
    A.key('Escape');
    eq(A.ev('ui.session.active.view.mode'), 's0', 'Esc: back to S0');
    A.ev(`(function () { startExplore({}); ui.sheet = 'settings'; window.__closed = 0;
      closeSheet = (function (f) { return function () { window.__closed++; ui.sheet = null; }; })(closeSheet); return 1; })()`);
    A.key('Escape');
    A.setNow(A.getNow() + 500);
    for (let t = 0; t < 1500; t += 30) { A.key('Escape', true); A.setNow(A.getNow() + 30); }
    eq(A.ev('window.__closed'), 1, 'the sheet closed once');
    ok(A.ev('!!ui.session.active.explore'), 'a held Escape never leaves exploring');
  });

  await test('the Details sheet and the ••• menu: what the card no longer says on its face', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { cards: 0, decisive: 0 };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        if (menuHtml(a).indexOf('data-act="details"') >= 0 || menuHtml(a).indexOf('data-act="skip"') < 0) out.push(it.key + ': the menu before an answer');
        reveal();
        n.cards++;
        var t = patternOf(it.b), info = patternInfo(t);
        SF.state = 'ready';
        var h = detailsHtml();
        if (menuHtml(a).indexOf('data-act="details"') < 0) out.push(it.key + ': no Details in the menu after an answer');
        if (h.split(esc(info.name)).length !== 2) out.push(it.key + ': the pattern named ' + (h.split(esc(info.name)).length - 1) + ' times');
        if (h.indexOf('class="pchip"') < 0) out.push(it.key + ': no chip');
        if (h.indexOf('<p class="habit">' + esc(habitFor(a, t, info)) + '</p>') < 0) out.push(it.key + ': no habit');
        if (h.indexOf('class="ctx"') < 0) out.push(it.key + ': no context');
        if (!!it.b.d !== (h.indexOf('stakes-tag') >= 0)) out.push(it.key + ': the decisive line ' + (it.b.d ? 'missing' : 'on a card that did not decide'));
        if (it.b.d) n.decisive++;
        if (h.indexOf('data-act="explore"') < 0) out.push(it.key + ': no way to explore');
        SF.state = 'failed';
        if (detailsHtml().indexOf('data-act="explore"') >= 0) out.push(it.key + ': exploring offered with no engine');
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards > 80 && r.n.decisive > 3, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('a reveal: graded hint after a close move, a relearn showing keeps its note, the last move kept mid-line; See why waits for it to settle; a dragged Play it lands still', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], its = allMistakes().filter(trainable), one = its.filter(function (x) { var a = cardFor(x); return a && !a.sol; }), line = its.filter(function (x) { var a = cardFor(x); return a && a.sol && a.sol.length >= 3; });
      /* a close move found first, then the answer: graded hint, and the summary says close */
      var a = openCard(one[0]); a.foundGood = { san: 'x', win: 60 }; reveal();
      if (a.result !== 'hint') out.push('after a close move the reveal grades ' + a.result);
      if (!/◐ close/.test(doneHtml(ui.session))) out.push('the summary does not say close');
      a = openCard(one[1]); reveal();
      if (a.result !== 'fail' || ui.session.notes[a.key] !== 'shown') out.push('a reveal grades ' + a.result + ', notes ' + ui.session.notes[a.key]);
      if (/◐ close/.test(doneHtml(ui.session))) out.push('a plain reveal says close');
      /* a relearn showing: its first note stays */
      a = openCard(one[2]); ui.session.keys = [a.key, a.key]; ui.session.idx = 1; ui.session.relearnOf = {}; ui.session.relearnOf[a.key] = 1; ui.session.notes = {}; ui.session.notes[a.key] = 'leftMiss';
      reveal();
      if (ui.session.notes[a.key] !== 'leftMiss') out.push('a relearn showing wrote its note: ' + ui.session.notes[a.key]);
      /* mid-line (4.7): the position and its last move, their reply, stay */
      line.forEach(function (it) {
        a = openCard(it);
        var m = uciToMove(a.st, a.sol[0]); applyMove(a.st, m); var rp = uciToMove(a.st, a.sol[1]); applyMove(a.st, rp); a.solIdx = 2; a.lastMove = [rp.from, rp.to];
        reveal();
        if (!sameMove(a.lastMove, [rp.from, rp.to])) out.push(it.key + ': mid-line reveal lost the last move, ' + JSON.stringify(a.lastMove));
        /* See why is not there before the card settles */
        a.view = { mode: 's0' }; a.settle = 1; seeWhy();
        if (a.view.mode !== 's0') out.push(it.key + ': See why opened before a revealed card settled');
      });
      /* Play it dragged lands where it was dropped: no slide, no sound */
      a = openCard(one[3]); reveal(); playIt(true);
      var f = boardOptsFor(a);
      if (f.opts.anim || f.slideMs || a.moveCue) out.push('a dragged Play it slides: ' + JSON.stringify(f.opts.anim) + ' ' + a.moveCue);
      a = openCard(one[4]); reveal(); playIt(false);
      if (!boardOptsFor(a).opts.anim || boardOptsFor(a).slideMs !== 320) out.push('Play it does not slide 320');
      return JSON.stringify(out); })()`));
    eq(r.length, 0, r.length + ' faults: ' + r.slice(0, 4).join(' | '));
  });

  await test('S0\'s marks: the threat pair only while its piece stands, no ghost on an occupied square after a line, at most two won tokens, a shown line\'s captures kept', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { pair: 0, ghost: 0, won: 0 }, its = allMistakes().filter(trainable);
      its.forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        var th = familyOf(patternOf(it.b)).key !== 'chances' ? threatOf(a.cls.gameLine, 1) : null;
        if (!a.sol && th && a.best.to !== a.played.to) {
          solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
          var st = cloneState(a.st);
          if (st.b[th.from] && st.b[th.from] === a.cls.gameLine.nodes[1].before.b[th.from]) {
            n.pair++;
            if (!s0Marks(a, st).rings.length) out.push(it.key + ': no threat pair while its piece stands');
            /* taken, or another piece there: no pair */
            st.b[th.from] = null;
            if (s0Marks(a, st).rings.length) out.push(it.key + ': a threat pair from an empty square');
            st.b[th.from] = isW(a.cls.gameLine.nodes[1].before.b[th.from]) ? 'Q' : 'q';
            if (a.cls.gameLine.nodes[1].before.b[th.from].toUpperCase() !== 'Q' && s0Marks(a, st).rings.length) out.push(it.key + ': a threat pair from another piece');
          }
        }
        if (a.sol && a.sol.length >= 3) {
          /* the whole line shown, Play it by Play it: what it took is kept as won */
          a = openCard(it); reveal();
          var took = [];
          for (var g = 0; g < 20 && showDue(a); g++) {
            var dm = showDue(a);
            if (a.st.b[dm.to] || dm.ep >= 0) took.push(dm.to);
            playIt(false);
            if (!a.showWait) continue;
            var rp = uciToMove(a.st, a.sol[a.solIdx]);
            a.showWait = false; applyMove(a.st, rp); a.lastMove = [rp.from, rp.to]; a.markMove = null; a.solIdx++;
            if (showDue(a)) a.answerSan = sanOf(a.st, showDue(a)); else settleShown(a);
          }
          if (JSON.stringify((a.won || []).map(function (w) { return w.sq; })) !== JSON.stringify(took)) out.push(it.key + ': won ' + JSON.stringify(a.won) + ', took on ' + JSON.stringify(took));
          if (took.length) n.won++;
          /* after a line the ghost only on an empty square */
          var pl = a.played, s2 = cloneState(a.st), mm = a.markMove;
          if (!(mm && mm.to === pl.to)) {
            s2.b[pl.to] = null;
            if (!s0Marks(a, s2).ghosts.length) out.push(it.key + ': no ghost on an empty square after a line');
            s2.b[pl.to] = 'p';
            if (s0Marks(a, s2).ghosts.length) out.push(it.key + ': a ghost on an occupied square after a line');
            n.ghost++;
          }
          /* three captures: two tokens */
          a.won = [{ sq: 0, p: 'p' }, { sq: 1, p: 'n' }, { sq: 2, p: 'b' }];
          if (s0Marks(a, a.st).tokens.length !== 2) out.push(it.key + ': ' + s0Marks(a, a.st).tokens.length + ' won tokens');
        }
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.pair >= 5 && r.n.ghost >= 4 && r.n.won >= 1, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('the reply after a mid-line Play it belongs to its card: a new card or exploring never takes it', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () {
      var out = [], its = allMistakes().filter(trainable), line = its.filter(function (x) { var a = cardFor(x); return a && a.sol && a.sol.length >= 5; }).slice(0, 2);
      var a0 = cardFor(line[0]), s0 = cloneState(a0.pre); applyMove(s0, uciToMove(s0, a0.sol[0]));
      var rp = uciToMove(s0, a0.sol[1]);
      /* the next card: a forcing line shown and played too, its own reply due,
         with a piece where the old reply would start (so taking it would show) */
      var next = its.filter(function (x) { var c = cardFor(x); if (!c || !c.sol || c.sol.length < 3 || x.key === line[0].key) return false;
        var s1 = cloneState(c.pre); applyMove(s1, uciToMove(s1, c.sol[0])); return !!s1.b[rp.from]; })[0];
      line.concat(next).forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
      ui.session = { mode: 't', label: 't', keys: [line[0].key, next.key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard();
      var a = ui.session.active; reveal(); playIt(false);
      if (!a.showWait) out.push('no reply due');
      nextCard();
      var b = ui.session.active; reveal(); playIt(false);
      var want = cloneState(b.st); applyMove(want, uciToMove(want, b.sol[1]));
      window.__later = function () { var c = ui.session.active; if (c.key !== next.key || stateFen(c.st) !== stateFen(want) || c.solIdx !== 2) out.push('the next card took the old reply: ' + c.solIdx + ' ' + stateFen(c.st)); return JSON.stringify(out); };
      return 1; })()`));
    eq(r, 1, 'set up');
    A.setNow(A.getNow() + 1000); A.flush(3);
    eq(A.ev('window.__later()'), '[]', 'the next card takes only its own reply');
    eq(A.ev(`(function () { var its = allMistakes().filter(trainable), line = its.filter(function (x) { var a = cardFor(x); return a && a.sol && a.sol.length >= 5; }).slice(0, 2);
      /* exploring while it is due: the reply plays unseen, and exploring comes back to the move after it */
      ui.session = { mode: 't', label: 't', keys: [line[1].key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      loadCard(); var a = ui.session.active; reveal(); playIt(false); startExplore({});
      /* Play it's own slide and sound, as painted (Node draws nothing) */
      a.animMove = null; a.moveCue = false; a.replySlide = false;
      window.__xp = { fen: stateFen(a.explore.st), at: a.solIdx };
      return 1; })()`), 1, 'exploring set up');
    A.setNow(A.getNow() + 1000); A.flush(3);
    const x = JSON.parse(A.ev(`JSON.stringify((function (a) { return { xfen: stateFen(a.explore.st), was: window.__xp.fen, idx: a.solIdx, at: window.__xp.at, wait: !!a.showWait }; })(ui.session.active))`));
    eq(x.xfen, x.was, 'exploring keeps its own board');
    eq(x.idx, x.at + 1, 'the reply played unseen');
    eq(x.wait, false, 'and is no longer due');
    /* nothing of it waits to be drawn on exploring's board: no slide, no hold, no sound */
    eq(A.ev('(function (a) { return !!(a.animMove || a.replySlide || a.moveCue); })(ui.session.active)'), false, 'no slide, hold or sound left for exploring\'s board');
    A.ev("(exploreExit('silent'), 1)");
    eq(A.ev('ui.session.active.view.mode + " " + !!showDue(ui.session.active)'), 'show true', 'back from exploring, the next move to play');
  });

  await test('a move that works too inside a forcing line is credited only with what it wins itself (R4)', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a || !a.sol || a.sol.length < 3) return;
        /* the line's first two moves found, then its third as the alternative (at 2) */
        a.lines = cardLines(a); a.alt = { win: 50, best: 52, mate: null }; a.yours = { uci: a.sol.slice(0, 3), cp: 0, at: 2 }; a.compare = null;
        var pov = myPov(it), line = buildLine(a.pre, '0000', a.yours.uci, pov), settle = Math.max(3, settleIndex(line));
        var gain = matDiff(line.nodes[settle].after.b, pov) - matDiff(line.nodes[3].before.b, pov);
        var want = gain >= 1 ? plainCapture(line, settle, 3) || oneWord(null, gain) : '', cmp = buildCompare(a);
        n++;
        if (cmp.w2 !== want) out.push(it.key + ': w2 ' + JSON.stringify(cmp.w2) + ', its own captures ' + JSON.stringify(want));
        if (cmp.betterSan !== sanOf(line.nodes[3].before, line.nodes[3].move)) out.push(it.key + ': named ' + cmp.betterSan);
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n >= 4, 'cards ' + r.n);
    eq(r.out.length, 0, r.out.length + ' faults: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('Skip, Back and endSession never regrade a revealed card', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev('(notice = function () {}, 1)');
    A.ev(`(window.__rec = [], srsRecord = (function (f) { return function (it, r) { window.__rec.push(it.key + ' ' + r); return f.apply(this, arguments); }; })(srsRecord), 1)`);
    const keys = JSON.parse(A.ev(`JSON.stringify((function () { var its = allMistakes().filter(trainable);
      var one = its.filter(function (it) { var a = cardFor(it); return a && !a.sol; }), line = its.filter(function (it) { var a = cardFor(it); return a && a.sol && a.sol.length >= 3; });
      return [one[0].key, one[1].key, one[2].key, line[0].key]; })())`));
    const ways = { skip: 'skipCard()', endSession: 'endSession()', back: 'endSession(true)', dispute: "disputeCard('engine')" };
    for (const [way, code] of Object.entries(ways)) for (const [i, key] of keys.entries()) {
      const at = key + ' ' + way + (i === 3 ? ' (mid-line, Play it, their reply due)' : '');
      A.ev(`(function () { var its = [model().byKey['${key}'], allMistakes().filter(trainable).filter(function (x) { return x.key !== '${key}'; })[0]];
        its.forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
        ui.session = { mode: 't', label: 't', keys: its.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
        loadCard(); return 1; })()`);
      if (i === 3) A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); return 1; })(ui.session.active)'), A.setNow(A.getNow() + 1000), A.flush(3);
      A.ev('(window.__rec = [], reveal(), 1)');
      if (i === 3) A.ev('(playIt(false), 1)');
      if (i === 1) A.ev('(window.__nlTest.play(ui.session.active.bestUci), 1)');
      const r0 = A.ev('JSON.stringify(ui.session.results)');
      A.ev(`(${code}, 1)`);
      A.setNow(A.getNow() + 5000); A.flush(5);
      eq(A.ev('JSON.stringify(window.__rec)'), JSON.stringify([key + ' fail']), at + ': recorded once, by the reveal');
      if (way !== 'dispute') {
        const res = JSON.parse(A.ev(`JSON.stringify(ui.session ? ui.session.results : (savedSession() || {}).results || {})`));
        eq(res[key], 'fail', at + ': the result stays fail, ' + r0);
        eq(A.ev(`(ui.session ? ui.session.notes : (savedSession() || {}).notes || {})['${key}']`), 'shown', at + ': the note stays shown');
      }
    }
  });

  /* ── the story (S12) ── */
  /* the refutation as the story steps it to a mate: the stored line, kept to 21 plies, to its first checkmate */
  const MATE_AT = `function mateIdx(a) {
    var ref = buildLine(a.pre, a.playedUci, unpackUci(a.it.b.ru).slice(0, 20), !myPov(a.it));
    for (var k = 1; k < ref.nodes.length; k++) if (isMate(ref.nodes[k].after)) return { line: ref, k: k };
    return { line: ref, k: ref.nodes.length - 1 };
  }
  function answered(a, how) {
    if (how === 'shown') { reveal(); a.view = { mode: 's0' }; a.settle = 2; return a; }
    if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
    else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
    a.settle = 2;
    return a;
  }`;
  await test('the game segment ends at lossAt: G1 is the game move, then the refutation ply by ply to the loss (to the mate when it mates)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      var out = [], n = { cards: 0, long: 0, mates: 0, mateLong: 0 };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          ['solved', 'shown'].forEach(function (how) {
            var a0 = openCard(it);
            if (!a0) return;
            var a = answered(a0, how), c = a.cls, S = buildStory(a), at = 'tier ' + tier + ' ' + it.key + ' ' + how;
            n.cards++;
            var end = c.mateAgainst ? mateIdx(a) : { line: c.gameLine, k: c.lossAt };
            if (c.lossAt >= 2) n.long++;
            if (c.mateAgainst) n.mates++;
            if (S.g !== Math.min(end.k, end.line.nodes.length - 1) + 1) out.push(at + ': ' + S.g + ' game steps, lossAt ' + c.lossAt + (c.mateAgainst ? ', mate at ' + end.k : ''));
            var ref = a.lines.refute.uci;
            for (var i = 0; i < S.g; i++) {
              var s = S.steps[i], nd = s.line.nodes[s.k];
              if (s.seg !== 'game' || s.k !== i || moveUci(nd.move) !== ref[i]) out.push(at + ': game step ' + i + ' is ' + s.seg + ' node ' + s.k + ' ' + moveUci(nd.move) + ', not ' + ref[i]);
            }
            var last = S.steps[S.g - 1], ln = last.line.nodes[last.k];
            if (c.mateAgainst && !isMate(ln.after)) out.push(at + ': the mate segment does not end in mate');
            if (!c.mateAgainst && last.k !== c.lossAt) out.push(at + ': the game segment ends at ' + last.k + ', not lossAt ' + c.lossAt);
            if (S.steps[0].line.nodes[0].move.from !== a.played.from || S.steps[0].line.nodes[0].move.to !== a.played.to) out.push(at + ': G1 is not the game move');
            /* a mate is stepped to the mate on the stored refutation, whatever lossAt says (the classifier keeps 8 plies) */
            if (c.mateAgainst && end.k >= 1) {
              var keep = c.lossAt; c.lossAt = 0; a.story = null;
              var S2 = buildStory(a), l2 = S2.steps[S2.g - 1];
              if (!isMate(l2.line.nodes[l2.k].after)) out.push(at + ': with lossAt 0 the mate segment stops at node ' + l2.k);
              c.lossAt = keep; a.story = null; n.mateLong++;
            }
          });
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards > 500 && r.n.long > 100 && r.n.mates > 10 && r.n.mateLong > 5, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('the better segment has bSettle steps: the best line from its first move to where it settles (the whole line to a mate; an alternative\'s own line from its move)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      var out = [], n = { cards: 0, multi: 0, alts: 0, inLine: 0, guard: 0, ghost: 0 };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          ['solved', 'shown'].forEach(function (how) {
            var a0 = openCard(it);
            if (!a0) return;
            var a = answered(a0, how), c = a.cls, S = buildStory(a), at = 'tier ' + tier + ' ' + it.key + ' ' + how, nb = S.steps.length - S.g;
            n.cards++;
            if (c.mateFor) {
              var bs = S.steps[S.steps.length - 1];
              if (!isMate(bs.line.nodes[bs.k].after) && bs.k !== a.lines.best.uci.length) out.push(at + ': the mate line stops short');
            } else if (nb !== Math.max(1, c.bSettle)) out.push(at + ': ' + nb + ' better steps, bSettle ' + c.bSettle);
            if (nb > 1) n.multi++;
            /* what lands on B1: the better move's badge and tints, then guard dots or the game move's ghost, never both; on G1 the reply it allows; a capture's token in its owner's colour */
            var b1 = S.steps[S.g], bn = b1.line.nodes[b1.k], m1 = storyMarks(a, S, S.g), bk = a.revealed ? 'info' : 'good';
            if (!m1.badges || m1.badges[0].sq !== bn.move.to || m1.badges[0].kind !== bk || m1.tints.length !== 2) out.push(at + ': B1 badge ' + JSON.stringify(m1.badges));
            if (!!m1.guards !== !!S.guard || (m1.guards && m1.ghosts)) out.push(at + ': B1 guard dots ' + JSON.stringify(m1.guards) + ' with ghost ' + JSON.stringify(m1.ghosts));
            if (!S.guard && (!m1.ghosts !== (a.played.to === bn.move.to))) out.push(at + ': B1 ghost ' + JSON.stringify(m1.ghosts));
            if (m1.ghosts && (m1.ghosts[0].sq !== a.played.to || m1.ghosts[0].p !== a.pre.b[a.played.from])) out.push(at + ': B1 ghost is not the game move');
            if (S.guard) n.guard++; else if (m1.ghosts) n.ghost++;
            var m0 = storyMarks(a, S, 0), th = threatOf(c.gameLine, 1);
            if (!!m0.arrows !== !!S.threat || (th && !m0.arrows) || (m0.arrows && (m0.arrows[0].kind !== 'threat' || m0.rings[0].sq !== m0.arrows[0].from || m0.arrows[0].from !== c.gameLine.nodes[1].move.from))) out.push(at + ': G1 marks ' + JSON.stringify(m0));
            S.steps.forEach(function (x, i) {
              /* the token stands where the piece was taken: the square it stood on before the ply and left by it (en passant: beside the arrival) */
              var nd = x.line.nodes[x.k], tk = storyMarks(a, S, i).tokens;
              if (tk && nd.move.ep >= 0) n.ep = (n.ep || 0) + 1;
              if (!!tk !== !!nd.captured || (tk && (tk[0].kind !== (isW(nd.captured) === myPov(it) ? 'lost' : 'won') || nd.before.b[tk[0].sq] !== nd.captured || nd.after.b[tk[0].sq] === nd.captured || tk[0].p !== nd.captured))) out.push(at + ': step ' + i + ' token ' + JSON.stringify(tk));
            });
            for (var j = 0; j < nb; j++) {
              var s = S.steps[S.g + j], nd = s.line.nodes[s.k];
              if (s.seg !== 'better' || s.k !== j + 1 || moveUci(nd.move) !== a.lines.best.uci[j]) out.push(at + ': better step ' + j + ' is ' + moveUci(nd.move) + ', not lines.best[' + j + '] ' + a.lines.best.uci[j]);
            }
          });
          /* a move that works too: its own line, from its move to where that line settles */
          var a = openCard(it);
          if (!a) return;
          var alt = a.sol ? null : legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci; })[0];
          if (alt) {
            var after = cloneState(a.st); applyMove(after, alt);
            var rest = playUci(after, unpackUci(it.b.lu).slice(1)).uci;
            a.yours = { uci: [moveUci(alt)].concat(rest), cp: 0, at: 0 };
            solved(alt, moveUci(alt), { win: 50, best: 52, mate: null });
            var S = buildStory(a), al = buildLine(a.pre, '0000', a.yours.uci, myPov(it)), want = Math.max(1, settleIndex(al)), b1 = S.steps[S.g];
            n.alts++;
            if (S.steps.length - S.g !== want || moveUci(b1.line.nodes[b1.k].move) !== moveUci(alt)) out.push(it.key + ': the alternative has ' + (S.steps.length - S.g) + ' steps from ' + moveUci(b1.line.nodes[b1.k].move) + ', not ' + want + ' from ' + moveUci(alt));
          }
          /* inside a forcing line, an early alternative at the third move: its line starts there */
          if (a.sol && a.sol.length >= 3) {
            a = openCard(it);
            var st = cloneState(a.st); applyMove(st, uciToMove(st, a.sol[0])); applyMove(st, uciToMove(st, a.sol[1]));
            var alt2 = legalMoves(st).filter(function (m) { return moveUci(m) !== a.sol[2]; })[0];
            if (!alt2) return;
            a.yours = { uci: a.sol.slice(0, 2).concat([moveUci(alt2)]), cp: 0, at: 2 };
            applyMove(a.st, uciToMove(a.st, a.sol[0])); applyMove(a.st, uciToMove(a.st, a.sol[1])); a.solIdx = 2;
            solved(alt2, moveUci(alt2), { win: 50, best: 52, mate: null }, true);
            var S2 = buildStory(a), f = S2.steps[S2.g];
            n.inLine++;
            if (f.k !== 3 || moveUci(f.line.nodes[f.k].move) !== moveUci(alt2) || stateFen(f.line.nodes[f.k].before) !== stateFen(st).replace(/ \\d+ \\d+$/, '') + stateFen(f.line.nodes[f.k].before).match(/ \\d+ \\d+$/)[0]) out.push(it.key + ': the alternative in a line starts at node ' + f.k);
            a.view = { mode: 'story', i: S2.g, pre: true };
            if (posKey(frameView(a).st) !== posKey(st)) out.push(it.key + ': B1 of an alternative in a line does not start where it was played');
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards > 500 && r.n.multi > 100 && r.n.alts > 50 && r.n.inLine > 5 && r.n.guard >= 6 && r.n.ghost > 300 && r.n.ep >= 2, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('the story claims a mate only when its line mates on screen, and calls only your own move\'s line yours', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      var out = [], n = { mateG: 0, mateB: 0, noLine: 0, alts: 0 };
      var said = function (a, i) { a.view = { mode: 'story', i: i }; return { strip: storyStripHtml(a), live: liveWords(a, { cap: buildStory(a).steps[i].cap }) }; };
      playerTier = function () { return 2; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a || a.sol) return;
        a = answered(a, 'solved');
        var c = a.cls;
        /* a mate the classifier names but the line never reaches: the material form, the loss counted at lossAt */
        if (!c.mateAgainst && !c.mateFor) {
          c.mateAgainst = 1; a.story = null;
          var S = buildStory(a);
          if (S.mateG || /checkmate/i.test(S.steps[0].cap) || S.g !== c.lossAt + 1) out.push(it.key + ': a mate claimed against with none on screen: ' + S.steps[0].cap + ', ' + S.g + ' game steps');
          c.mateAgainst = null; c.mateFor = 1; a.story = null;
          S = buildStory(a);
          if (S.mateB || /checkmate/i.test(S.steps[S.g].cap) || S.steps.length - S.g !== Math.max(1, c.bSettle)) out.push(it.key + ': a mate claimed for with none on screen: ' + S.steps[S.g].cap);
          c.mateFor = null; a.story = null; n.mateG++; n.mateB++;
        }
        /* an alternative whose own line cannot be built: told as the better move, never as yours */
        var bestSan = sanOf(a.pre, a.best).replace(/[+#]$/, '');
        a.alt = { uci: 'x' }; a.yours = { uci: [], cp: 0, at: 0 }; a.story = null;
        var S3 = buildStory(a), w = said(a, S3.g);
        if (S3.alt || /works too/.test(S3.steps[S3.g].cap) || S3.steps[S3.g].cap.indexOf('Better: ' + bestSan) !== 0 || />Yours</.test(w.strip) || !/>Better</.test(w.strip) || !/the better move\\./.test(w.live)) out.push(it.key + ': the best move called yours: ' + S3.steps[S3.g].cap + ' | ' + w.live);
        n.noLine++;
        /* a real alternative: "Yours" in the strip, "your move" for screen readers, "works too" on B1 */
        var alt = legalMoves(a.pre).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci; })[0];
        if (!alt) return;
        a.yours = { uci: [moveUci(alt)], cp: 0, at: 0 }; a.story = null;
        var S4 = buildStory(a), w4 = said(a, S4.g);
        if (!S4.alt || S4.steps[S4.g].cap !== 'Your ' + sanOf(a.pre, alt).replace(/[+#]$/, '') + ' works too.' || !/>Yours</.test(w4.strip) || />Better</.test(w4.strip) || !/aria-label="Your move,/.test(w4.strip) || !/your move\\./.test(w4.live)) out.push(it.key + ': the alternative is not yours: ' + S4.steps[S4.g].cap + ' | ' + w4.strip + ' | ' + w4.live);
        n.alts++;
        a.alt = null; a.yours = null; a.story = null;
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.mateG > 30 && r.n.noLine > 30 && r.n.alts > 30, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('a one-move blunder has 3 steps: See why, then Next move twice, one ply a tap, and Next move off at the last', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && !a.cls.mateAgainst && a.cls.lossAt === 1 && a.cls.bSettle === 1; }).slice(0, 6).map(function (x) { return x.key; }))`));
    ok(keys.length >= 4, 'one-move blunders ' + keys.length);
    const st = () => JSON.parse(A.ev('JSON.stringify((function (a) { var v = a.view; return { mode: v.mode, i: v.i, fen: stateFen(frameView(a).st), off: /btn-off[^>]*>Next move/.test(window.__els.cbar.innerHTML) }; })(ui.session.active))'));
    for (const [k, key] of keys.entries()) {
      A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
      run(1000);
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
      run(2500);
      eq(A.ev('buildStory(ui.session.active).steps.length'), 3, key + ': steps');
      const fens = [];
      /* by the bar, or by the keyboard (→ from S0 opens it) */
      if (k % 2) A.click('seeWhy', null, 0); else A.key('ArrowRight');
      /* the bar comes with the caption, and its new slots wait out the double-tap guard */
      run(1700);
      let s = st(); eq(s.mode + ' ' + s.i, 'story 0', key + ': the first tap opens G1'); fens.push(s.fen);
      for (let t = 1; t < 3; t++) {
        if (k % 2) A.click('storyFwd', null, 1); else A.key('ArrowRight');
        run(1200);
        s = st(); eq(s.i, t, key + ': tap ' + (t + 1) + ' is step ' + (t + 1)); ok(fens.indexOf(s.fen) < 0, key + ': a new position at each tap'); fens.push(s.fen);
      }
      ok(s.off, key + ': Next move is off at the last step');
      if (k % 2) A.click('storyFwd', null, 1); else A.key('ArrowRight');
      run(1200);
      eq(st().i, 2, key + ': nothing past the last step');
    }
  });

  await test('a double tap on See why never steps twice, and Next move takes its first visible tap', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && a.cls.lossAt + Math.max(1, a.cls.bSettle) >= 3; }).slice(0, 4).map(function (x) { return x.key; }))`));
    const st = () => JSON.parse(A.ev('JSON.stringify((function (a) { var bar = window.__els.cbar; return { mode: a.view.mode, i: a.view.i, stale: !!bar.cls.stale, fwd: /data-act="storyFwd"/.test(bar.innerHTML) }; })(ui.session.active))'));
    for (const rm of [false, true]) for (const key of keys) {
      const at = key + (rm ? ' reduced motion' : '');
      A.ev('(ui.reducedTest = ' + rm + ', 1)');
      A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
      run(1000);
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
      run(2500);
      A.click('seeWhy', null, 0);
      const t0 = A.getNow();
      /* until the story's bar paints, the old one is faded out (no pointer
         events on the page), so the second half of a double tap presses
         nothing */
      let s = st(), painted = null;
      for (let t = 0; t < 2000 && painted == null; t += 10) {
        if (!s.stale && !s.fwd) { ok(false, at + ': the old bar takes taps ' + t + ' ms after See why'); break; }
        A.advance(10);
        s = st();
        if (s.fwd) painted = A.getNow() - t0;
      }
      ok(painted != null && !s.stale, at + ': the story bar painted ' + painted);
      eq(s.mode + ' ' + s.i, 'story 0', at + ': See why is G1');
      if (!rm) {
        /* the slots faded out at the tap, so their half second ran from it:
           Next move takes the first tap it can be seen to take */
        ok(painted >= 450, at + ': painted ' + painted + ' ms after See why, after the guard');
        A.click('storyFwd', null, 1);
        run(1200);
        eq(st().i, 1, at + ': the first visible tap on Next move steps');
        /* a key while the bar is faded presses nothing either: Enter 100 ms
           after See why never reaches the Continue it is about to replace */
        A.key('Escape'); run(1000);
        const idx = A.ev('ui.session.idx');
        A.click('seeWhy', null, 0); run(100);
        A.key('Enter'); run(1500);
        s = st();
        eq(s.mode + ' ' + s.i + ' ' + A.ev('ui.session.idx'), 'story 0 ' + idx, at + ': Enter while the bar is faded');
      } else {
        /* under reduced motion the bar paints at once, inside the double
           tap: its new slots wait out the rest of the half second from the
           tap, so a second tap on ‹ (where See why was) or on Next move
           does nothing, and one after it steps */
        ok(painted < 450, at + ': painted ' + painted);
        A.click('storyBack', null, 0); A.click('storyFwd', null, 1);
        s = st();
        eq(s.mode + ' ' + s.i, 'story 0', at + ': a double tap on See why stays at G1');
        A.setNow(t0 + 460);
        A.click('storyFwd', null, 1);
        run(400);
        eq(st().i, 1, at + ': Next move steps once the half second from the tap is over');
      }
    }
    A.ev('(ui.reducedTest = false, 1)');
  });

  await test('board taps never change the step: a piece tap outlines it and says N1 in the strip; swipes, keys and the bar step it, Esc goes back to S0', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && a.cls.lossAt + Math.max(1, a.cls.bSettle) >= 4; }).slice(0, 4).map(function (x) { return x.key; }))`));
    const st = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { mode: a.view.mode, i: a.view.i, fen: stateFen(frameView(a).st), strip: window.__els.cstrip.innerHTML, note: a.note && a.note.key === cardStateKey(a) ? a.note.id : null, nope: !!(a.nope && a.nope.key === cardStateKey(a)) }; })(ui.session.active))'));
    /* a sideways swipe on the board as a finger makes it: from x to x + dx (the realm draws square sq at 200 + file * 45) */
    const sqs0 = () => A.ev('(function (st) { for (var q = 0; q < 64; q++) if (st.b[q]) return q; })(ui.session.active.pre)');
    const swipe = (x, dx, dy) => { A.pointer('pointerdown', 0, { clientX: x, clientY: 400 }); A.pointer('pointerup', 0, { clientX: x + dx, clientY: 400 + (dy || 0) }); };
    for (const key of keys) {
      A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
      run(1000);
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
      run(2500);
      /* a left swipe in S0 opens the story; a tap while it crossfades in ends the crossfade and the slide, never the step */
      swipe(420, -120);
      run(160);
      A.tap(sqs0(key)); run(1700);
      let s = st(); eq(s.mode + ' ' + s.i, 'story 0', key + ': a left swipe in S0 opens G1');
      eq(s.fen, A.ev('(function (a) { var x = buildStory(a).steps[0]; return stateFen(x.line.nodes[0].after); })(ui.session.active)'), key + ': a tap during the crossfade still lands G1');
      ok(!A.ev('ui.session.active.view.pre'), key + ': G1 landed');
      A.click('storyFwd', null, 1); run(1200);
      s = st(); eq(s.i, 1, key + ': Next move');
      /* every square tapped: never a step, a piece outlined with N1 where the budget allows it */
      const sqs = JSON.parse(A.ev('JSON.stringify((function (st) { var p = [], e = []; for (var q = 0; q < 64; q++) (st.b[q] ? p : e).push(q); return { p: p.slice(0, 6), e: e.slice(0, 3) }; })(frameView(ui.session.active).st))'));
      for (const q of sqs.p.concat(sqs.e)) {
        A.tap(q); run(200);
        const t = st();
        eq(t.mode + ' ' + t.i + ' ' + t.fen, s.mode + ' ' + s.i + ' ' + s.fen, key + ': a tap on ' + q + ' changed the step');
        if (sqs.p.indexOf(q) >= 0) {
          ok(t.nope, key + ': a piece tap outlines it');
          const room = A.ev('(function (a) { return wordsIn(buildStory(a).steps[a.view.i].cap) + 5 + 3 <= 15; })(ui.session.active)');
          eq(t.note === 'N1' && /To try moves, open Details\./.test(t.strip), room, key + ': N1 in the strip as the budget allows');
        }
        run(2700);
      }
      ok(/data-act="storyJump"/.test(st().strip), key + ': the strip names come back after N1');
      /* an upward drag (a scroll) never steps either */
      swipe(420, 10, -100); run(400);
      eq(st().i, 1, key + ': an upward drag changed the step');
      /* swipes: left forward, right back; one too short, too steep, or from a screen edge does nothing */
      swipe(420, -120); run(1200); eq(st().i, 2, key + ': a left swipe steps forward');
      swipe(420, 120); run(1200); eq(st().i, 1, key + ': a right swipe steps back');
      swipe(420, -40); run(1200); eq(st().i, 1, key + ': a 40 px swipe does nothing');
      swipe(420, -80, 50); run(1200); eq(st().i, 1, key + ': a steep swipe does nothing');
      /* the realm draws the board at x 200 to 560: a screen 540 wide puts its last file within 24 px of the right edge */
      A.ev('(window.innerWidth = 540, 1)');
      swipe(530, -200); run(1200); eq(st().i, 1, key + ': a swipe from the right edge does nothing');
      swipe(500, -200); run(1200); eq(st().i, 2, key + ': a swipe 40 px from the edge steps');
      A.ev('(window.innerWidth = 1200, 1)');
      A.key('ArrowLeft'); run(1200);
      /* keys: → and Space forward, ← back; the strip's names jump */
      A.key('ArrowRight'); run(1200); eq(st().i, 2, key + ': →');
      A.key('ArrowLeft'); run(1200); eq(st().i, 1, key + ': ←');
      A.key(' ', false, { act: 'storyFwd', slot: 1 }); run(1200); eq(st().i, 2, key + ': Space on Next move');
      A.key(' '); run(1200); eq(st().i, 3, key + ': Space');
      A.click('storyJump', 'game'); run(1200); eq(st().i, 0, key + ': Game opens G1');
      A.click('storyJump', 'better'); run(1200); eq(st().i, A.ev('buildStory(ui.session.active).g'), key + ': Better opens B1');
      A.click('storyJump', 'game'); run(1200);
      /* ‹ on G1, and Esc, go back to S0 */
      A.click('storyBack', null, 0); run(1200); eq(st().mode, 's0', key + ': ‹ on G1 is S0');
      swipe(420, 120); run(1200); eq(st().mode, 's0', key + ': a right swipe in S0 does nothing');
      A.key(' '); run(1200); eq(st().mode, 's0', key + ': Space in S0 does nothing');
      A.key('ArrowRight'); run(1200); A.key('ArrowRight'); run(1200); eq(st().i, 1, key + ': → twice');
      A.key('Escape'); run(1200); eq(st().mode, 's0', key + ': Esc is S0');
    }
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('the story\'s beats: the words fade out, a segment crossfades to its start with its arrow, the ply slides 320 ms with its sound, what it brings lands with it, the caption 150 ms later; back is a crossfade', () => {
    for (const reduced of [false, true]) {
      const A = boot();
      A.ev(DOM);
      A.ev('(playerTier = function () { return 2; }, 1)');
      A.ev(BAR);
      if (reduced) A.ev('(ui.reducedTest = true, 1)');
      A.ev('(function () { window.__snd = []; snd = function (k) { window.__snd.push({ k: k, t: Date.now() }); }; return 1; })()');
      const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
      const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && threatOf(a.cls.gameLine, 1) && a.cls.lossAt >= 1; }).slice(0, 4).map(function (x) { return x.key; }))`));
      for (const key of keys) {
        const at = (reduced ? 'reduced, ' : '') + key;
        A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
        run(1000);
        A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
        run(2500);
        A.ev('window.__writes.length = 0; window.__snd.length = 0; 1');
        const t0 = A.getNow();
        A.click('seeWhy', null, 0);
        run(1500);
        const ws = JSON.parse(A.ev('JSON.stringify(window.__writes)')).map((w) => Object.assign(w, { t: w.t - t0 }));
        const snds = JSON.parse(A.ev('JSON.stringify(window.__snd)')).filter((x) => x.k === 'move').map((x) => x.t - t0);
        const boards = ws.filter((w) => w.id === 'bwrap' && w.what === 'innerHTML'), texts = ws.filter((w) => w.id === 'cband');
        const cls = A.ev('JSON.stringify(window.__els.cband.cls)');
        eq(cls, '{}', at + ': the band is not left faded');
        if (!reduced) {
          ok(boards.length >= 2, at + ': boards ' + JSON.stringify(boards));
          ok(boards[0].t >= 100 && /xfade/.test(boards[0].v) && /red/.test(boards[0].v) && !/slide/.test(boards[0].v), at + ': first the crossfade to the card position, with the red arrow, 100 ms after the tap: ' + JSON.stringify(boards[0]));
          ok(boards[1].t >= boards[0].t + 150 && /slide/.test(boards[1].v) && /red/.test(boards[1].v) && !/arrow|ring/.test(boards[1].v), at + ': then the game move slides along its arrow, the threat not yet drawn: ' + JSON.stringify(boards[1]));
          eq(snds.length, 1, at + ': one move sound');
          eq(snds[0], boards[1].t, at + ': the sound as it slides');
          const landed = boards.filter((w) => w.t > boards[1].t).concat(ws.filter((w) => w.id === 'marks' && w.t > boards[1].t))[0];
          ok(!!landed && landed.t >= boards[1].t + 320 && /arrow/.test(landed.v) && /ring/.test(landed.v), at + ': the threat lands once the piece has: ' + JSON.stringify(landed));
          ok(texts.length && texts[0].t >= landed.t + 150, at + ': the caption 150 ms after: ' + JSON.stringify(texts[0]) + ' vs ' + landed.t);
        } else {
          ok(!boards.some((w) => /xfade|slide/.test(w.v)), at + ': under reduced motion nothing slides or crossfades');
          ok(texts.length && texts[0].t >= 150, at + ': the caption after the board');
        }
        /* forward: one ply slides with its sound; back: a crossfade of 150 ms (carried minor), no sound */
        A.ev('window.__writes.length = 0; window.__snd.length = 0; 1');
        const t1 = A.getNow();
        A.click('storyFwd', null, 1);
        run(1000);
        const w2 = JSON.parse(A.ev('JSON.stringify(window.__writes)')).filter((w) => w.id === 'bwrap' && w.what === 'innerHTML');
        eq(JSON.parse(A.ev('JSON.stringify(window.__snd)')).filter((x) => x.k === 'move').length, 1, at + ': a move sound for the next ply');
        if (!reduced) ok(w2[0] && w2[0].t - t1 >= 100 && /slide/.test(w2[0].v) && !/xfade/.test(w2[0].v), at + ': the next ply slides after the words fade: ' + JSON.stringify(w2));
        A.ev('window.__writes.length = 0; window.__snd.length = 0; 1');
        A.click('storyBack', null, 0);
        const mu = A.ev('motionUntil - Date.now()'), xf = A.ev('/class="xfade"/.test(window.__els.bwrap.innerHTML)');
        if (!reduced) { eq(mu, 150, at + ': back crossfades 150 ms'); ok(xf, at + ': back draws the crossfade'); }
        run(1000);
        eq(JSON.parse(A.ev('JSON.stringify(window.__snd)')).filter((x) => x.k === 'move').length, 0, at + ': no sound going back');
        eq(A.ev('ui.session.active.view.i'), 0, at + ': back on G1');
        /* the live region says where the step is */
        ok(/^Step 1 of \d+, your game\. /.test(A.ev('displayFor(ui.session.active).live')), at + ': the live region leads with the step');
        A.click('next', null, 2); run(1000);
      }
      const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
      eq(bad.length, 0, bad.length + ' writes too early');
    }
  });

  await test('the story keeps the keyboard on Next move ›, then on Continue at the last step; ‹ and › are named for screen readers', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const foc = () => A.ev(`(function () { var e = document.activeElement; return !e ? 'none' : e.host + ' ' + (e.id || (e.getAttribute('data-act') + '@' + e.getAttribute('data-slot'))); })()`);
    const on = () => JSON.parse(A.ev(`(function () { var e = document.activeElement; return JSON.stringify(e && e.getAttribute && e.getAttribute('data-act') ? { act: e.getAttribute('data-act'), slot: +e.getAttribute('data-slot') } : null); })()`));
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; }).slice(0, 3).map(function (x) { return x.key; }))`));
    for (const key of keys) {
      A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
      run(1000);
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
      run(2500);
      eq(foc(), 'cbar next@1', key + ': solved, Continue');
      A.ev('(function () { var b = window.__els.cbar.querySelector(\'[data-act="seeWhy"]\'); b.focus(); b.click(); return 1; })()');
      run(1700);
      const n = A.ev('buildStory(ui.session.active).steps.length');
      for (let i = 0; i < n; i++) {
        eq(foc(), i < n - 1 ? 'cbar storyFwd@1' : 'cbar next@2', key + ': step ' + (i + 1) + ' of ' + n + ' focus');
        const bar = A.ev('window.__els.cbar.innerHTML');
        ok(/data-act="storyBack"[^>]*aria-label="Previous move"/.test(bar), key + ': ‹ is Previous move');
        if (i < n - 1) ok(new RegExp('aria-label="Next move, step ' + (i + 2) + ' of ' + n + '"').test(bar) && /class="btn-big"[^>]*data-act="storyFwd"/.test(bar) && /class="btn-line"[^>]*data-act="next"/.test(bar), key + ': Next move names the step it goes to, gold, Continue outlined: ' + bar);
        else ok(/class="btn-line btn-off"[^>]*>Next move/.test(bar) && /class="btn-big"[^>]*data-act="next"/.test(bar) && (bar.match(/btn-big/g) || []).length === 1, key + ': at the last step Next move is off and outlined, Continue the one gold button: ' + bar);
        if (i < n - 1) { A.key('Enter', false, on()); run(1200); }
      }
      /* Enter at the last step is Continue */
      A.key('Enter', false, on()); run(1000);
      eq(A.ev('ui.session.idx'), 1, key + ': Enter on Continue');
    }
  });

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
      /* rings round their own square's centre, r 20: the threat ring red over a dark halo, the reply ring
         dashed 6 4, the prize ring dashed 4 3, hint 2's ring gold; the nope outline a square, 2 units in */
      const ring = (kind) => o.rings.filter((x) => x.kind === kind)[0];
      const ringAt = (cls, sq) => { const c = ctrOf(sq, flip); return p.marks.match(new RegExp('<circle class="' + cls + '" cx="' + rx(c[0]) + '" cy="' + rx(c[1]) + '" r="20" fill="none" ([^>]*)/>')); };
      const tc = ctrOf(ring('threat').sq, flip), cc = ' cx="' + tc[0] + '" cy="' + tc[1] + '" r="20" fill="none"';
      let m = ringAt('ring-threat', ring('threat').sq);
      ok(m && m[1] === 'stroke="#e0503e" stroke-width="3.6"' && p.marks.indexOf('<circle' + cc + ' stroke="rgba(0,0,0,.35)" stroke-width="6.5"/><circle class="ring-threat"' + cc) >= 0, name + ': the threat ring, red over its halo, ' + (m && m[1]));
      m = ringAt('reply-ring', ring('reply').sq);
      ok(m && m[1] === 'stroke="rgba(122,150,184,.95)" stroke-width="3" stroke-dasharray="6 4"', name + ': the reply ring, dashed 6 4, ' + (m && m[1]));
      m = ringAt('ring-target', ring('target').sq);
      ok(m && m[1] === 'stroke="rgba(182,130,53,.95)" stroke-width="3" stroke-dasharray="4 3"', name + ': the prize ring, dashed 4 3, ' + (m && m[1]));
      m = ringAt('hint-ring', o.hint);
      ok(m && m[1] === 'stroke="rgba(182,130,53,.95)" stroke-width="3.5"', name + ': hint 2\'s ring, gold, ' + (m && m[1]));
      const nc = cornerOf(ring('nope').sq, flip);
      ok(p.marks.indexOf('<rect class="nope-box" x="' + (nc[0] + 2) + '" y="' + (nc[1] + 2) + '" width="41" height="41" fill="none" stroke="rgba(160,154,144,.9)" stroke-width="2"/>') >= 0, name + ': the nope outline on its square');
      /* tokens at the square's bottom-left: a light disc ringed red (lost, with a slash) or green (won), the piece inside */
      const PID = { r: 'bR', n: 'bN', N: 'wN', R: 'wR' };
      o.tokens.forEach((t) => {
        const c = cornerOf(t.sq, flip), cx = c[0] + 12.5, cy = c[1] + 32.5, lost = t.kind === 'lost';
        const tm = p.marks.match(new RegExp('<g class="token token-' + t.kind + '"><g[^>]*><circle cx="' + rx(cx) + '" cy="' + rx(cy) + '" r="12\\.5" fill="rgba\\(244,236,222,\\.94\\)" stroke="' + (lost ? '#d6452f' : '#3d9142')
          + '" stroke-width="2\\.4"/><use href="#pc-' + PID[t.p] + '" x="' + rx(cx - 10.8) + '" y="' + rx(cy - 10.8) + '" width="21\\.6" height="21\\.6" opacity="\\.82"/>(<line [^>]*/>)?</g></g>'));
        ok(tm, name + ': the ' + t.kind + ' token, its ring and its piece');
        ok(tm && (lost ? !!tm[1] && tm[1].indexOf('stroke="#d6452f"') > 0 : !tm[1]), name + ': a slash on the lost token only');
      });
      /* the guard dots: from the defender to the square, both ends 13 units from the centres, the dot at the guarded end */
      const gd = o.guards[0], g0 = ctrOf(gd.from, flip), g1 = ctrOf(gd.to, flip);
      const gl = p.marks.match(/<line class="guard-line" x1="([\d.e-]+)" y1="([\d.e-]+)" x2="([\d.e-]+)" y2="([\d.e-]+)" stroke-dasharray="([^"]+)"/);
      ok(gl && Math.abs(Math.hypot(+gl[1] - g0[0], +gl[2] - g0[1]) - 13) < 1e-6 && Math.abs(Math.hypot(+gl[3] - g1[0], +gl[4] - g1[1]) - 13) < 1e-6 && gl[5] === '0.1 7', name + ': the guard line, inset 13 at both ends, dotted');
      const dot = p.marks.match(/<circle cx="([\d.e-]+)" cy="([\d.e-]+)" r="3\.4" fill="#4fae55"\/>/);
      ok(dot && gl && dot[1] === gl[3] && dot[2] === gl[4], name + ': the end dot on the guarded square');
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
    /* the cutoff itself, 1.6 squares (72 units): 70 units is short, 74 is not */
    const cut = JSON.parse(A.ev(`JSON.stringify([70, 74].map(function (n) { return +/ x2="([\\d.]+)"/.exec(markArrow(0, 0, n, 0, 'game', 'k').body)[1]; }))`));
    ok(Math.abs(cut[0] - (70 - 0.22 * 45)) < 1e-6, '70 units stops 0.22 of a square short: ' + cut[0]);
    ok(Math.abs(cut[1] - (74 - 0.34 * 45)) < 1e-6, '74 units stops 0.34 of a square short: ' + cut[1]);
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
