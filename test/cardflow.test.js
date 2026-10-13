// The card flow, run on the built page in Node (test/app-realm.js) with the fixture games: what each
// frame of a card draws, checked as data (boardOptsFor) against the spoiler rule (no mark gives the
// answer away before it is found or shown; spoilerFaults below). Node has no engine, so a try is answered
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
/* ONLY=<words> runs the tests whose names hold them */
async function test(name, fn) {
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
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
   solver's side, give the try's reply line (window.__tryPv) and its mate
   (window.__tryMate, in moves, from the solver's side: -1 mated next), or
   hold the try's answer (window.__holdTry: it waits in window.__evals like
   an explore search). The danger facts' null-move
   search (11d-danger.js, opts.dz) is answered at once, with window.__dz when
   a test sets it, else with no threat, and kept in window.__dzJobs */
const ENGINE = `(function () {
  window.__evals = [];
  window.__stops = [];
  window.__dzJobs = [];
  var realStop = engineStop;
  engineStop = function (tag) { window.__stops.push(tag); return realStop.apply(this, arguments); };
  engineEval = function (fen, mt, prio, opts) {
    opts = opts || {};
    var job = { fen: fen, nodes: mt && mt.nodes, opts: opts, prio: prio };
    if (opts.dz) { window.__dzJobs.push(job); return Promise.resolve(window.__dz || { cp: 0, mate: null, pv: [], lines: [], depth: 18, stopped: false }); }
    window.__evals.push(job);
    var a = ui.session && ui.session.active, sm = opts.searchmoves;
    if (!a || !sm) return new Promise(function (res, rej) { job.res = res; job.rej = rej; });
    var b = a.it.b, st = stateFromFen(fen), sign = myPov(a.it) ? 1 : -1;
    var u = sm[0], expect = sm[1], tried = uciToMove(st, u);
    var after = cloneState(st);
    if (tried) applyMove(after, tried);
    var ru = unpackUci(b.ru), stored = !!(ru.length && tried && playUci(after, ru).uci.length === ru.length);
    var reply = window.__tryPv ? window.__tryPv : stored ? ru : (legalMoves(after)[0] ? [moveUci(legalMoves(after)[0])] : []);
    var gameCp = b.ea != null ? b.ea : (b.ma != null ? (b.ma > 0 ? 1500 : -1500) : cpFromWin(b.wa));
    var mine = window.__tryCp != null ? { cp: window.__tryCp, mate: window.__tryMate != null ? window.__tryMate : null } : { cp: gameCp, mate: stored && b.ma != null ? b.ma : null };
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
/* a card opened at a tier, and a try on it answered by the engine stub with
   its reply line, its score and its mate (slice 1's wrong tries); the
   answer comes on the next tick */
const TRY = `function openAt(key, tier) { playerTier = function () { return tier; }; return openCard(model().byKey[key]); }
function tryMove(a, u, pv, cp, mate) {
  window.__tryPv = pv; window.__tryCp = cp; window.__tryMate = mate == null ? null : mate; window.readyEngine();
  a.tapped = true; gradeMove(uciToMove(a.st, u));
  return 1;
}`;
/* the spoiler rule (no mark gives the answer away before it is found or
   shown), on the frame the user sees. Before an
   answer (guess, checking, tried, reply) a frame may not show a green arrow,
   a gold arrow, a gold hint ring other than hint 2's on the answer's
   from-square, a hint's prize ring on that square, a threat arrow end or
   threat ring on that square outside phase tried (only S4 marks may touch
   it; a hint-1 or worked-example mark never does, but for the danger hint's
   red ring on the player's own attacked piece and its attackers' arrows into
   it, F1.1: what is attacked is the lesson, where it goes is the answer),
   any ring, arrow end,
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
   last move) and, once it has landed, in the frame that asks for your next
   move (its last move the line's reply just before it), and the slide of the player's own try (or of the move just
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
  var rm = null, lr = a.sol && a.solIdx > 0 && a.solIdx % 2 === 0 ? a.sol[a.solIdx - 1] : null;
  if (a.phase === 'reply') {
    var next = a.sol && a.sol[a.solIdx] && !!a.st.w !== myPov(a.it) ? uciToMove(a.st, a.sol[a.solIdx]) : null;
    rm = next ? [next.from, next.to] : a.lastMove;
  } else if (a.phase === 'guess' && lr && a.lastMove && lr.slice(0, 4) === sqName(a.lastMove[0]) + sqName(a.lastMove[1])) rm = a.lastMove;
  var arrows = [], rings = (o.hint != null ? [{ sq: o.hint, kind: 'hint' }] : []).concat(o.rings || []);
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better' });
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  /* F10.1: while their best reply is asked for, nothing of that reply shows (its telegraph would be the answer) */
  var asking = a.phase === 'reply' && a.reply && a.reply.ask;
  if (asking) { arrows.concat(o.arrows || []).concat(rings).forEach(function (m) { if (m.kind === 'reply') out.push('their reply marked while its guess is asked'); }); if (/Blue arrow|their reply/.test(String(o.label || ''))) out.push('the board name says their reply while its guess is asked'); }
  arrows.concat(o.arrows || []).forEach(function (m) {
    /* the player's own guess of their reply (F10.1) is input, as their drawn shapes are */
    if (m.kind === 'guess') return;
    if ((m.kind === 'game' && sameMove([a.played.from, a.played.to], [m.from, m.to])) || (m.kind === 'reply' && rm && sameMove(rm, [m.from, m.to]))) return;
    var what = m.kind === 'better' ? 'green arrow' : m.kind === 'explore' ? 'gold arrow' : m.kind + ' arrow';
    if (m.kind === 'better' || m.kind === 'explore') out.push(what + ' on ' + sqName(m.from) + '-' + sqName(m.to));
    /* F1.1: the danger hint's arrows may point at the player's own attacked
       piece (ringed red) even when it is the answer's piece */
    var atk = rings.some(function (r) { return r.kind === 'attacked' && r.sq === m.to && a.st.b[m.to] && isW(a.st.b[m.to]) === myPov(a.it); });
    if (m.kind === 'threat') onFrom(what, atk ? [m.from] : [m.from, m.to]);
    onTo(what, [m.from, m.to]);
  });
  rings.forEach(function (m) {
    if (m.kind === 'nope' || (m.kind === 'reply' && rm && rm.indexOf(m.sq) >= 0)) return;
    /* the danger's red ring: on a piece of yours or the square they mate on, never the answer's square */
    if (m.kind === 'attacked' && m.sq === due.from && !(a.st.b[m.sq] && isW(a.st.b[m.sq]) === myPov(a.it))) out.push('a danger ring on the answer piece ' + sqName(m.sq) + ', not a piece of yours');
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
  /* the board's aria-label (S20) never names the answer: not its move, not
     its square, not "the answer" or "better", outside the sentences of the
     marks 2.3 exempts (the game arrow of the move played, the forcing
     reply's own arrow and token, the move just played's badge, which names
     no square) */
  var lab = String(o.label || ''), gm = 'Red arrow: your game move, ', pw = function (sq) { var p = a.st.b[sq]; return p ? PIECE_WORD[pType(p)] : ''; };
  /* (in game mode the game move's faded piece stands for its red arrow, F8.1, and is exempt as it is; so is the player's own guess of their reply, F10.1) */
  var rest = lab.split(/(?<=[.]) /).filter(function (x) { return x.indexOf(gm) !== 0 && x.indexOf('Blue arrow: your guess') !== 0 && !/: where your game move went[.]$/.test(x) && !(rm && (x.indexOf('Blue arrow: ') === 0 || (/ was taken on | won a /.test(x) && x.indexOf(' ' + sqName(rm[1]) + '.') >= 0))); }).join(' ');
  if (rest.indexOf(pw(due.from) + ' ' + sqName(due.from) + ' to ' + sqName(due.to)) >= 0) out.push('the board name says the answer move: ' + lab);
  if (rest.split(/[^a-h1-8]+/).indexOf(sqName(due.to)) >= 0) out.push('the board name names the answer square ' + sqName(due.to) + ': ' + lab);
  if (/the answer|better move|Green arrow|Gold arrow/.test(lab)) out.push('the board name says ' + lab);
  /* the label (2.1), as a first-sight label and as a short one, on a 384
     px board: never "better" or "the answer", never over the answer's
     square (its rectangle as drawn, flipped or not) */
  var Q = 48, fl = !!o.flip, cx = fl ? 7 - due.to % 8 : due.to % 8, cy = fl ? due.to >> 3 : 7 - (due.to >> 3);
  [function () { return false; }, function () { return true; }].forEach(function (seen) {
    var lb = frameLabel(a, f, 384, false, seen);
    if (!lb) return;
    window.__labelled = (window.__labelled || 0) + 1;
    if (lb.text === 'better' || lb.text === 'the answer') out.push('the label "' + lb.text + '" before an answer');
    if (asking && lb.text === 'their reply') out.push('the label "their reply" while its guess is asked');
    if (lb.x < (cx + 1) * Q - 0.5 && lb.x + lb.w > cx * Q + 0.5 && lb.y < (cy + 1) * Q - 0.5 && lb.y + lb.h > cy * Q + 0.5) out.push('the label "' + lb.text + '" on the answer square ' + sqName(due.to));
  });
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
   the marks the marks they drew, as words (tried, xfade, ring, aring (the
   danger's red ring on a piece of yours), arrow, token, slide) */
const DOM = `(function () {
  var log = window.__writes = [], els = window.__els = {};
  var kind = { bwrap: 'board', ebar: 'board', 'ebar-fill': 'board', marks: 'marks', trainbox: 'frame', ckeys: 'keys' };
  var FLAG = { tried: /class="tried"/, xfade: /class="xfade"/, ring: /class="ring-threat"/, aring: /class="ring-attacked"/, arrow: /class="threat-arrow"/, token: /token-lost/, slide: /anim-piece/,
    target: /class="ring-target"/, hint: /class="hint-ring"/, ghost: /:s0"/, tick: /badge-good/, info: /badge-info/, green: /good-arrow/, won: /token-won/, red: /bad-arrow/, guard: /guard-line/, faded: /ghost-piece/,
    rring: /class="reply-ring"/, rdash: /class="reply-arrow"[^>]*stroke-dasharray/, rsolid: /class="reply-arrow"(?![^>]*stroke-dasharray)/, slow: /anim-slow/, glow: /url\\(#checkglow/,
    guess: /class="guess-arrow"/ };
  var kept = function (id, x) {
    if (id === 'cband' || id === 'cbar' || id === 'ckeys') return x;
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
  ['trainbox', 'ctop', 'cband', 'bwrap', 'ebar', 'ebar-fill', 'ebar-lab', 'cpanel', 'cstrip', 'cbar', 'sr-live', 'marks', 'ckeys'].forEach(function (id) { els[id] = mk(id); });
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
/* the desktop key line is no text beat: it blanks at the change and comes
   back with the words (kind keys, checked by its own test) */
const early = (ws) => ws.filter((w) => w.kind !== 'keys' && (w.kind === 'text' ? w.t < w.mu + 150 : w.t < w.mu));

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
      getAttribute: function (n) { return attrs[n] == null ? null : attrs[n]; }, focus: function () { document.activeElement = this; }, textContent: attrs.text || '',
      closest: function (sel) { return sel === '#' + host || (sel === '[data-act]' && attrs['data-act'] != null) ? this : null; }, blur: function () { if (document.activeElement === this) document.activeElement = null; },
      click: function () { window.__realmClick(attrs['data-act'], attrs['data-k'], attrs['data-slot']); } };
  };
  var kb = node('cstrip', { id: 'kbmove', tag: 'INPUT' }), heads = { 'task-h': node('cband', { id: 'task-h', tag: 'H2' }), 'result-h': node('cband', { id: 'result-h', tag: 'H2' }) };
  var buttons = function () {
    var h = els.cbar.innerHTML;
    if (memo.html !== h) {
      memo = { html: h, list: [] };
      h.replace(/<a ([^>]*)>([^<]*)/g, function (m, at, tx) { var o = { text: tx }; at.replace(/([\\w-]+)="([^"]*)"/g, function (x, k, v) { o[k] = v; return x; }); memo.list.push(node('cbar', o)); return m; });
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
  await test('the spoiler rule holds on every card before an answer, tiers 1 to 3 (open, hints 0 to 2, inside a forcing line, after a miss, a hint pressed over a try), labels included', async () => {
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
          /* the forcing reply (S10), at each move of yours found: the tick
             as your move slides and lands, the telegraph, their reply
             sliding and landed, then the frame asking for your next move */
          if (a.sol) {
            a = openCard(it);
            for (var k = 0; k < a.sol.length - 1; k += 2) {
              var at = 'reply after move ' + (k / 2 + 1);
              a.tapped = true;
              gradeMove(uciToMove(a.st, a.sol[k]));
              if (a.phase !== 'reply' || !a.reply) { check(at + ': no reply but ' + a.phase, true); break; }
              var rp = a.reply;
              check(at + ', your move sliding'); a.animMove = null; check(at + ', your move landed');
              /* F10.1 at tier 3: their reply asked for, a piece of theirs picked up, then a guess
                 (a move of theirs other than the line's), its arrow drawn while the reply comes */
              if (rp.ask) {
                var gm0 = legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.sol[a.solIdx]; })[0] || uciToMove(a.st, a.sol[a.solIdx]);
                a.sel = gm0.from; check(at + ', their piece picked up for a guess'); a.sel = -1;
                makeGuess(a, gm0); check(at + ', guessed');
              }
              rp.tele = true; check(at + ', the telegraph');
              theirReply(a, false); check(at + ', sliding'); a.animMove = null; a.animSlow = false; check(at + ', landed');
              replyDone(a, rp); check(at + ', your move again');
              a.hints = 2; a.hintAfter = true; check(at + ', hint 2'); a.hints = 0; a.hintAfter = false;
            }
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
      return JSON.stringify({ out: out, cards: cards, frames: frames, hinted: hinted, trainable: its.length, labelled: window.__labelled || 0 }); })()`));
    ok(r.trainable >= 90 && r.cards === 3 * r.trainable, r.cards + ' cards of ' + r.trainable);
    ok(r.frames >= 20 * r.cards, 'frames ' + r.frames);
    ok(r.hinted >= 3 * r.cards, 'frames with hint marks ' + r.hinted);
    ok(r.labelled >= r.cards, 'frames with a label ' + r.labelled);
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
        /* the aria-label in the board's words (S20): the answer's move, its square, the green words */
        ariaMove: doctor(function (g) { g.opts.label = 'White to move. Move the ' + PIECE_WORD[pType(a.st.b[b.from])] + ' ' + sqName(b.from) + ' to ' + sqName(b.to) + '.'; }),
        ariaSquare: doctor(function (g) { g.opts.label = 'White to move. Dashed red arrow: the pawn on a1 can take on ' + sqName(b.to) + '.'; }),
        ariaGreen: doctor(function (g) { g.opts.label = 'White to move. Green arrow: here.'; }),
        ariaGame: doctor(function (g) { g.opts.label = 'White to move. Red arrow: your game move, piece ' + sqName(a.played.from) + ' to ' + sqName(b.to) + '.'; }),
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
        gameItself: doctor(function (g) { g.opts.arrows = [{ from: a.played.from, to: a.played.to, kind: 'game' }]; }),
        /* a label: the green words, or any label over the answer's square */
        labelAnswer: (function () { var fl = frameLabel; frameLabel = function () { return { text: 'the answer', x: 0, y: 0, w: 10, h: 10 }; };
          try { return doctor(function () {}); } finally { frameLabel = fl; } })(),
        labelOnTo: (function () { var fl = frameLabel, Q = 48, fp = !!f.opts.flip, cx = fp ? 7 - b.to % 8 : b.to % 8, cy = fp ? b.to >> 3 : 7 - (b.to >> 3);
          frameLabel = function () { return { text: 'takes', x: cx * Q + 40, y: cy * Q + 10, w: 50, h: 18 }; };
          try { return doctor(function () {}); } finally { frameLabel = fl; } })()
      }); })()`));
    eq(r.clean, 0, 'the real frame');
    eq(r.allowed, 0, 'marks the rule allows after a miss');
    eq(r.threatInTried, 0, 'S4 marks on the answer piece after a miss');
    eq(r.gameItself, 0, 'the red arrow of the game move, as a list arrow');
    eq(r.ariaGame, 0, 'the game arrow\'s words, whatever square they name');
    ['green', 'gold', 'ringEarly', 'ringOnTo', 'slide', 'bar', 'label', 'ariaMove', 'ariaSquare', 'ariaGreen', 'greenList', 'goldList', 'ringList', 'threatOnTo', 'prizeOnFrom',
      'ringOnToList', 'token', 'guard', 'tried', 'badge', 'tint', 'threatFromOnFrom', 'threatToOnFrom', 'threatRingOnFrom', 'replyArrowOnTo',
      'replyRingOnTo', 'threatOnToInTried', 'gameElsewhere', 'labelAnswer', 'labelOnTo'].forEach((k) => ok(r[k] > 0, k + ' not caught'));
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
      /* the frame asking for your next move (phase guess): the landed
         reply's own marks stay allowed, anything else on the answer is not;
         and once another move is the last one, its marks are marks like any */
      a.phase = 'guess';
      res.landedAsking = doctor(function (g) { g.opts.arrows = [{ from: rp.from, to: rp.to, kind: 'reply', solid: true }]; g.opts.tokens = [{ sq: rp.to, p: 'q', kind: 'lost' }]; });
      res.askingReplyOnAnswer = doctor(function (g) { g.opts.arrows = [{ from: rp.to, to: due.to, kind: 'reply' }]; });
      res.askingTokenOnAnswer = doctor(function (g) { g.opts.tokens = [{ sq: due.to, p: 'q', kind: 'lost' }]; });
      a.lastMove = [mine.from, mine.to];
      res.notLastReply = doctor(function (g) { g.opts.arrows = [{ from: rp.from, to: due.to, kind: 'reply' }]; });
      return JSON.stringify(res); })()`));
    ok(q, 'a forcing card of three moves or more at tier 3');
    eq(q.telegraph.length, 0, 'the telegraph: ' + q.telegraph.join(' | '));
    eq(q.landing.length, 0, 'the landing: ' + q.landing.join(' | '));
    eq(q.landedAsking.length, 0, 'the landed reply in the frame asking for your next move: ' + q.landedAsking.join(' | '));
    ['threatOnReply', 'replyOnAnswer', 'replyRingOnAnswer', 'tokenOnAnswer', 'askingReplyOnAnswer', 'askingTokenOnAnswer', 'notLastReply'].forEach((k) => ok(q[k].length > 0, k + ' not caught'));
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
        /* tier 1 names the game move in words, or no move where they do not fit (F1.6); a decisive first
           sight from the player's fourth card on names its game in the tag row (F4.2) */
        ok(/Your turn Find a better move( than (\S+|[a-z ]+ [a-h][1-8]|castling))?\.( (Lost|Drew) (vs \S+|the game))?$/.test(band()), at + ': the open band reads ' + band());
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
        eq(A.ev('(function () { var a = ui.session.active; sessionClick(a.played.to); return a.phase + " " + a.sel; })()'), 'guess -1', at + ': a tap on the tried piece takes the try back, nothing picked up');
        eq(lastBoard(), tap, at + ': the board after a tap mid-slide');
        run(1000);
        eq(soon(tap), '', at + ': words after a tap mid-slide');
        A.ev(`(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
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
        const other = A.ev('(function (a) { for (var i = 0; i < 64; i++) if (a.st.b[i] && isW(a.st.b[i]) === a.st.w && i !== a.played.from) return i; return -1; })(ui.session.active)');
        A.ev(`(function () { var a = ui.session.active; flushStage(); tryAgain(triedPick(a, ${other})); return 1; })()`);
        const atTap = JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t === ${tap}; }).map(function (w) { return w.kind + ' ' + w.id + ' ' + w.what; }))`));
        eq(atTap.filter((w) => w === 'board bwrap innerHTML').length, 1, at + ': the try-back and the selection drawn at the press, ' + atTap.join(', '));
        ok(A.ev(`(function (a) { return a.phase === 'guess' && a.sel === ${other} && window.__els.bwrap.innerHTML.indexOf('fill="' + HL_SEL + '"') > 0; })(ui.session.active)`), at + ': the piece picked up in that board');
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

  await test('focus stays on the action bar when its buttons change, never in the typed-move box', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const foc = () => A.ev(`(function () { var e = document.activeElement; return !e ? 'none' : e.host + ' ' + (e.id || (e.getAttribute('data-act') + '@' + e.getAttribute('data-slot'))); })()`);
    /* a button reached from the keyboard and pressed there: it has the
       focus, then the click (a key's, detail 0) */
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
    eq(foc(), 'cbar tryAgain@1', 'after See it, whose slot turned into Hint 2, the keyboard is on Try again, where Enter goes');
    /* Try again: both buttons change; Show the answer never takes Try
       again's place under the keyboard (F4.1: Enter never shows the answer),
       so the keyboard goes to the band's task, where Enter does nothing */
    press('tryAgain');
    run(1500);
    eq(A.ev('ui.session.active.phase'), 'guess', 'Try again took the try back');
    eq(foc(), 'cband task-h', 'after Try again, the task, not Show the answer in its slot');
    /* a slot that goes off (No more hints) hands the focus to the honey
       button, and with none (a card asking) to the task */
    press('hint');
    run(1000);
    eq(foc(), 'cbar hint@0', 'after hint 1, Hint 2 keeps the focus');
    press('hint');
    run(1000);
    eq(A.ev('ui.session.active.hints'), 2, 'hint 2 given');
    eq(foc(), 'cband task-h', 'after hint 2 the focus is on the task, never on Show the answer');
    /* Show the answer reached on purpose and pressed: it shows it, never an empty typed move */
    press('reveal');
    run(1000);
    eq(A.ev('ui.session.active.phase'), 'done', 'Show the answer pressed');
    eq(foc(), 'cbar playIt@1', 'the answer shown hands the keyboard to Play it, the right-hand button');
  });

  await test('a pointer\'s click on the bar leaves no focus there, so Enter is the honey button the key line names (none on a card asking: Enter does nothing); a control reached from the keyboard keeps it and the line names it (I2, F4.1)', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const foc = () => A.ev(`(function () { var e = document.activeElement; return !e ? 'none' : e.host + ' ' + (e.id || (e.getAttribute('data-act') + '@' + e.getAttribute('data-slot'))); })()`);
    const keys = () => A.ev('window.__els.ckeys.innerHTML');
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, hints: a.hints, result: a.result || null, view: a.view && a.view.mode, i: a.view && a.view.i }; })(ui.session.active))'));
    /* a finger or a mouse: the button takes focus as it is pressed, then the click (detail 1) */
    const tapBtn = (act) => {
      const slot = A.ev(`(function () { var b = window.__els.cbar.querySelector('[data-act="${act}"]'); if (!b) return -1; b.focus(); return +b.getAttribute('data-slot'); })()`);
      ok(slot >= 0, act + ' is on the bar');
      A.click(act, null, slot, { detail: 1 });
    };
    const show = (n) => A.ev(`(function () { window.__show(allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && unpackUci(x.b.ru).length; })[${n}]); return 1; })()`);
    show(0);
    run(1000);
    tapBtn('hint');
    eq(foc(), 'cband task-h', 'a clicked Hint hands focus back to the band at once');
    run(1000);
    eq(S().hints, 1, 'hint 1 given'); eq(foc(), 'cband task-h', 'and the band keeps it after the words');
    eq(keys(), '? hint', 'the key line names no Enter: the bar has no honey button');
    A.key('Enter');
    let s = S();
    eq(s.hints + ' ' + s.result + ' ' + s.phase, '1 null guess', 'Enter after a clicked Hint does nothing (never Hint 2, never the answer)');
    /* the same card from the keyboard: Hint reached by Tab keeps the focus, and the line names it */
    show(1);
    run(1000);
    A.ev(`(window.__els.cbar.querySelector('[data-act="hint"]').focus(), 1)`);
    A.fire('focusin');
    eq(keys(), 'Enter: Hint · ? hint', 'Hint focused: the line says Enter presses it');
    A.key('Enter', false, { act: 'hint', slot: 0 });
    run(1000);
    eq(S().hints, 1, 'Enter on the focused Hint gives hint 1');
    eq(foc(), 'cbar hint@0', 'the focus keeps its slot');
    eq(keys(), 'Enter: Hint 2 · ? hint', 'and the line names what is there now');
    A.ev('(document.activeElement = null, 1)');
    A.fire('focusin');
    eq(keys(), '? hint', 'focus gone: no Enter again');
    /* a miss, See it clicked: the focus goes back to the band; Enter is Try again */
    show(2);
    run(1000);
    A.ev('(function () { var a = ui.session.active; gradeMove(uciToMove(a.st, a.playedUci)); return a.phase; })()');
    run(1500);
    eq(foc(), 'cbar tryAgain@1', 'a miss hands the keyboard to Try again (S20)');
    if (A.ev('!!ui.session.active.tried.reply')) {
      tapBtn('seeIt');
      run(1500);
      /* V2.2: See it's slot turns into Next move › while their line has more
         to play: a click leaves the keyboard on the band, Enter is still the
         honey Try again; at the line's end the slot turns into Hint 2 */
      const more = A.ev('seeMore(ui.session.active.tried)');
      eq(foc(), more ? 'cband task-h' : 'cbar tryAgain@1', 'a clicked See it: the keyboard on ' + (more ? 'the band' : 'Try again') + ', Enter goes to Try again');
      eq(keys(), more ? 'Enter: Try again · → next move · ? hint' : 'Enter: Try again · ? hint', 'the line names Try again');
      A.key('Enter');
      eq(S().phase, 'guess', 'Enter takes the try back');
    }
    /* the story, clicked into: the band there has no heading, so the
       focus falls back to the honey button (Next move, F4.1), and the line
       names it; from the keyboard too (S20) */
    A.ev('(function () { var a = ui.session.active; sessionClick(a.best.from); sessionClick(a.best.to); return 1; })()');
    run(2500);
    tapBtn('seeWhy');
    run(1500);
    s = S();
    eq(s.view, 'story', 'See why clicked');
    eq(foc(), 'cbar storyFwd@1', 'in the story clicked into, the keyboard is on the honey button');
    ok(/^Enter: Next move · ← → step · Space: next · Esc: back$/.test(keys()), 'the line names it: ' + keys());
    A.ev(`(window.__els.cbar.querySelector('[data-act="storyFwd"]').focus(), 1)`);
    A.fire('focusin');
    ok(/^Enter: Next move · ← → step · Space: next · Esc: back$/.test(keys()), 'Next move focused, the line names it: ' + keys());
    A.key('Enter', false, { act: 'storyFwd', slot: 1 });
    run(1500);
    eq(S().i, s.i + 1, 'Enter steps, as the line says');
  });

  await test('the story\'s disc: your king on your game\'s steps, the card\'s verdict on the better ones, so a green tick never sits beside a bad move (C4)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], game = 0, better = 0;
      allMistakes().filter(trainable).slice(0, 30).forEach(function (it) {
        ['solved', 'shown'].forEach(function (how) {
          var a = openCard(it);
          if (!a) return;
          if (how === 'shown') reveal(); else { if (a.sol) return; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); }
          var S = buildStory(a);
          for (var i = 0; i < S.steps.length; i++) {
            a.view = { mode: 'story', i: i };
            var b = bandFor(a), html = discHtml(a, b.disc), g = i < S.g;
            if (g) game++; else better++;
            var want = g ? 'king' : how === 'shown' ? 'info' : 'good';
            if (b.disc !== want) out.push(it.key + ' ' + how + ' step ' + i + ': ' + b.disc);
            if (g && /d-good/.test(html)) out.push(it.key + ' a tick on a game step');
          }
        });
      });
      return JSON.stringify({ out: out, game: game, better: better }); })()`));
    ok(r.game > 30 && r.better > 30, 'steps ' + r.game + ' / ' + r.better);
    eq(r.out.length, 0, r.out.slice(0, 5).join(' | '));
  });

  await test('Details claims material only as the card face does: the game move\'s loss as its claim (buildCompare: standing, in line with the score, more than the best line loses; "could" when not played), the better move\'s gain as B1 says it (its square only where it took that one piece), safety only where the best line loses nothing; every card and tier (184455333378:68, 184205946040:62)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { cards: 0, loss: 0, could: 0, gain: 0, sq: 0, safe: 0, swapped: 0 }, rows = {};
      var text = function (h, cls) { var m = new RegExp('dt-line ' + cls + '"><span class="tl-dot" aria-hidden="true"></span><span>([^<]*)<').exec(h); return m ? m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&') : ''; };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          reveal();
          n.cards++;
          var c = a.cls, cmp = buildCompare(a), h = detailsHtml(), game = text(h, 'tl-bad'), best = text(h, 'tl-good'), at = 'tier ' + tier + ' ' + it.key;
          var w = familyOf(patternOf(it.b)).key === 'chances' ? '' : cmp.w, m, re = /\\b(You could lose|You lose|could lose|loses) ([^.]+?)(?= after |\\.)/g, said = 0;
          if (tier === 2) rows[it.key] = game + ' / ' + best;
          /* the mistake: each loss is the card face's claim, "could" exactly when the opponent did not play into it */
          while ((m = re.exec(game))) {
            said++; n.loss++;
            if (m[2] !== w) out.push(at + ': says it loses "' + m[2] + '" where the card claims "' + w + '": ' + game);
            if (/could/.test(m[1]) === cmp.found) out.push(at + ': "' + m[1] + '" where the opponent ' + (cmp.found ? 'played' : 'did not play') + ' into it');
            if (/could/.test(m[1])) n.could++;
          }
          if (/\\bis lost\\b|get trapped|\\bwins\\b/.test(game) && !w) out.push(at + ': a loss said another way, with no claim: ' + game);
          /* and a claim the card makes is said, or named as the one piece taken */
          var one = /^the (\\w+)$/.exec(w);
          if (w && !said && !(one && new RegExp('your ' + one[1] + '\\\\b').test(game))) out.push(at + ': the card claims ' + w + ', Details does not: ' + game);
          /* the better move: its gain as B1 says it, the square a capture of that piece of theirs */
          var gw = c.matBest >= 1 && c.bestLine ? plainCapture(c.bestLine, c.bSettle) || oneWord(null, c.matBest) : '';
          if ((m = /\\bwins (.+?)(?: on ([a-h][1-8]))?\\.$/.exec(best))) {
            n.gain++;
            if (m[1] !== gw) out.push(at + ': the better move wins "' + m[1] + '" where B1 says "' + gw + '": ' + best);
            if (m[2]) {
              n.sq++;
              var took = c.bestLine.nodes.filter(function (x, k) { return k >= 1 && k <= c.bSettle && x.pov && x.captured && 'the ' + PIECE_WORD[pType(x.captured)] === m[1]; });
              if (took.length !== 1 || sqName(took[0].move.ep >= 0 ? took[0].move.ep : took[0].move.to) !== m[2]) out.push(at + ': the square ' + m[2] + ' is not where that one piece was taken');
            }
          }
          if (/\\bsafe\\b|out of danger/.test(best)) { n.safe++; if (!c.mateFor && bestLossFrom(a, 0) >= 1) out.push(at + ': a safety claim where the best line loses material: ' + best); }
          if (best === a.lines.best.san[0] + ' was the better move.') n.swapped++;
        });
      });
      return JSON.stringify({ out: out, n: n, rows: rows }); })()`));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
    /* (V2.1, V2.4: "wins" only where it leaves the player better and the score shows it, else "was the better move") */
    ok(r.n.cards > 250 && r.n.loss > 60 && r.n.could > 20 && r.n.gain > 15 && r.n.sq >= 5 && r.n.safe > 30 && r.n.swapped >= 3, JSON.stringify(r.n));
    /* the two cards the fresh eyes read: the claim in full ("for a rook"), and "could" for a blow they missed */
    ok(r.rows['184455333378:68'].indexOf('You lose a queen and a bishop for a rook. / Qe6 was the better move.') > 0, r.rows['184455333378:68']);
    ok(r.rows['184205946040:62'].indexOf('You could lose a queen and a pawn.') > 0, r.rows['184205946040:62']);
  });

  await test('a typed move with its piece letter small ("qf3", "o-o") is read as the move; a small b stays a pawn on the b-file where that move exists (I5)', () => {
    const A = boot();
    A.ev(DOM);
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0, pawnB = 0, said = [], realNotice = notice;
      notice = function (t) { said.push(t); };
      window.readyEngine(); window.__holdTry = true;
      allMistakes().filter(trainable).slice(0, 40).forEach(function (it) {
        var a0 = openCard(it);
        if (!a0) return;
        legalMoves(a0.st).forEach(function (m) {
          var san = sanOf(a0.st, m).replace(/[+#]$/, ''), small = san === 'O-O' || san === 'O-O-O' ? san.toLowerCase() : /^[KQRBN]/.test(san) ? san[0].toLowerCase() + san.slice(1) : null;
          if (!small && !/^b/.test(san)) return;
          var a = window.__show(it); said = [];
          typedMove(small || san);
          var u = moveUci(m), got = a.phase === 'done' ? a.yours && a.yours.uci && a.yours.uci[0] : a.ghostMove ? sqName(a.ghostMove[0]) + sqName(a.ghostMove[1]) : a.tried ? a.tried.uci : a.lastMove ? sqName(a.lastMove[0]) + sqName(a.lastMove[1]) : null;
          if (small) n++; else pawnB++;
          if (said.length || a.attempts < 1 && a.phase === 'guess') out.push(it.key + ' ' + (small || san) + ': ' + (said[0] || 'nothing'));
          else if (got && got.slice(0, 4) !== u.slice(0, 4)) out.push(it.key + ' ' + (small || san) + ' played ' + got);
        });
      });
      notice = realNotice; window.__holdTry = false;
      return JSON.stringify({ out: out, n: n, pawnB: pawnB }); })()`));
    ok(r.n > 100, 'small piece letters typed ' + r.n); ok(r.pawnB > 3, 'b-pawn moves typed ' + r.pawnB);
    eq(r.out.length, 0, r.out.slice(0, 5).join(' | '));
  });

  await test('Enter presses the honey button alone (F4.1): nothing on a card asking, never the answer; Try again in tried, Keep looking on a close move, each waiting out its slot', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, result: a.result || null, misses: a.misses, hints: a.hints }; })(ui.session.active))'));
    const show = (n) => A.ev(`(function () { window.__show(allMistakes().filter(trainable).filter(function (x) { return unpackUci(x.b.ru).length; })[${n}]); return 1; })()`);
    const barAt = () => A.ev('(window.__writes.filter(function (w) { return w.id === "cbar" && w.what === "innerHTML"; }).pop() || {}).t');
    /* guess: [Hint] [Show the answer], no honey button: Enter does nothing */
    show(0);
    A.advance(1000);
    A.key('Enter');
    let s = S();
    eq(s.phase + ' ' + s.result + ' ' + s.hints, 'guess null 0', 'Enter in guess does nothing: no answer, no hint');
    /* tried, the game move again: [See it] [Try again]; Enter takes the try back */
    show(1);
    A.advance(1000);
    A.ev('(function () { var a = ui.session.active; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()');
    A.advance(1000);
    eq(S().phase, 'tried', 'the game move stays');
    A.key('Enter');
    s = S();
    eq(s.phase, 'guess', 'Enter in tried takes the try back'); eq(s.result, null, 'and shows no answer');
    /* back on the card asking: Enter does nothing, whenever it comes */
    A.advance(400);
    A.key('Enter');
    A.advance(1000);
    A.key('Enter');
    s = S();
    eq(s.phase + ' ' + s.result, 'guess null', 'Enter after Try again never shows the answer');
    /* the guard: the game move again turns [Hint] [Show the answer] into
       [See it] [Try again]; Enter 100 ms after that bar is painted is
       ignored, 500 ms after it takes the try back */
    const tg = A.getNow();
    A.ev('(function () { var a = ui.session.active; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()');
    for (let t = 0; t < 1500 && !(barAt() > tg); t += 10) A.advance(10);
    const t0 = barAt();
    ok(t0 > tg && S().phase === 'tried', 'the miss\'s bar painted');
    A.advance(t0 + 100 - A.getNow());
    A.key('Enter');
    eq(S().phase, 'tried', 'Enter 100 ms after the bar changed is ignored');
    A.advance(400);
    A.key('Enter');
    eq(S().phase, 'guess', 'Enter 500 ms after the bar changed takes the try back');
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

  await test('the desktop key line lists exactly the keys that do something in each state (Enter by the button it presses, ?, ← →, Esc)', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    A.ev(BAR);
    /* each state from scratch on one card with a stored reply */
    const SET = `${AFTER} var c1 = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && unpackUci(x.b.ru).length; })[0];
      var settled = function () { var a = window.__show(c1); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); return a; };
      var SETUPS = {
        open: function () { window.__show(c1); },
        hint2: function () { var a = window.__show(c1); a.hints = 2; renderCard(); },
        miss: function () { var a = window.__show(c1); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); },
        close: function () { var a = window.__show(c1); a.attempts++; showTry(a, offBook(a), 'close', null); },
        checking: function () { window.readyEngine(); window.__holdTry = true; var a = window.__show(c1); a.tapped = true; gradeMove(offBook(a)); },
        settled: settled,
        story: function () { settled(); ui.session.active.settle = 2; seeWhy(); },
        storyEnd: function () { var a = settled(); a.settle = 2; seeWhy(); a.view = { mode: 'story', i: buildStory(a).steps.length - 1 }; renderCard(); },
        shown: function () { window.__show(c1); reveal(); },
        exploring: function () { window.readyEngine(); settled(); startExplore({}); }
      };`;
    const SIG = 'JSON.stringify((function (a) { return a ? [a.key, a.phase, a.view && a.view.mode, a.view && a.view.i, a.explore ? a.explore.at : -1, a.hints, a.result || null, a.tried && a.tried.kind, a.tried && a.tried.seen, a.sel] : null; })(ui.session && ui.session.active))';
    const keyOf = { Enter: /^Enter: /, '?': /(^| )\? hint/, ArrowRight: /→/, ArrowLeft: /←/, Escape: /Esc/, ' ': /Space/ };
    const out = [], lines = {};
    for (const st of ['open', 'hint2', 'miss', 'close', 'checkingEarly', 'checking', 'settled', 'story', 'storyEnd', 'shown', 'exploring']) {
      for (const k of Object.keys(keyOf)) {
        if (st === 'checkingEarly') {
          /* a move being checked before K1: the guess bar is still up, but Enter does nothing */
          A.ev(`(function () { ${SET} window.__holdTry = false; window.__show(c1); return 1; })()`);
          A.advance(1000);
          A.ev(`(function () { ${SET} window.readyEngine(); window.__holdTry = true; var a = ui.session.active; a.tapped = true; gradeMove(offBook(a)); return 1; })()`);
          A.advance(100);
        } else {
          A.ev(`(function () { ${SET} window.__holdTry = false; SETUPS['${st}'](); return 1; })()`);
          A.advance(3000);
          await tick(); await tick();
          A.advance(600);
        }
        const line = A.ev('displayFor(ui.session.active).keys');
        lines[st] = line;
        const before = A.ev(SIG);
        A.key(k);
        A.advance(600);
        const changed = A.ev(SIG) !== before;
        if (changed !== keyOf[k].test(line)) out.push(st + ' "' + line + '": ' + k + (changed ? ' works but is not listed' : ' is listed but does nothing'));
      }
    }
    A.ev('(window.__holdTry = false, 1)');
    eq(out.length, 0, out.join(' | '));
    eq(lines.open, '? hint', 'the card asking: no honey button, so no Enter (F4.1)');
    eq(lines.hint2, '', 'no hint left, and no Enter');
    eq(lines.miss, 'Enter: Try again · → see it · ? hint', 'a miss: → plays See it (round D)');
    eq(lines.close, 'Enter: Keep looking · ? hint', 'a close move');
    eq(lines.checking, 'Esc: take back', 'a move being checked');
    eq(lines.checkingEarly, '? hint · Esc: take back', 'a move being checked, before the band says so');
    eq(lines.settled, 'Enter: Finish · → see why', 'the settled result (the last card)');
    eq(lines.story, 'Enter: Next move · ← → step · Space: next · Esc: back', 'the story: Enter is the honey Next move');
    eq(lines.storyEnd, 'Enter: Finish · ← step · Esc: back', 'the story\'s last step');
    eq(lines.shown, 'Enter: Play it', 'the answer shown');
    /* exploring opens on its first move, where ← goes back to the lesson as Esc does */
    ok(/^Enter: Finish · (→ step · )?← or Esc: back to the lesson$/.test(lines.exploring), 'exploring: ' + lines.exploring);
    /* one move on: ← steps back along the trail */
    A.ev(`(function () { var a = ui.session.active, ex = a.explore; var m = legalMoves(ex.st)[0]; explorePlay(m, false); return 1; })()`);
    A.advance(1500);
    ok(/^Enter: Finish · ← (→ )?step · Esc: back to the lesson$/.test(A.ev('displayFor(ui.session.active).keys')), 'exploring a move on: ' + A.ev('displayFor(ui.session.active).keys'));
    /* the control that has the keyboard is what Enter presses: the line names
       it (a bar or strip control), or names no Enter (any other control) */
    eq(A.ev(`(function () { ${SET} window.__show(c1); return keyLine(ui.session.active, barSlots(ui.session.active, ui.session), { act: 'hint', label: 'Hint' }); })()`), 'Enter: Hint · ? hint', 'the Hint button focused');
    eq(A.ev(`keyLine(ui.session.active, barSlots(ui.session.active, ui.session), { other: true })`), '? hint', 'another control focused');
    eq(A.ev(`keyLine(ui.session.active, barSlots(ui.session.active, ui.session), null)`), '? hint', 'nothing focused: no honey button, no Enter');
    /* keyFocus reads the focused element: a bar button by its words, the band's heading as nothing */
    const kf = (o) => A.ev(`(function () { var o = ${JSON.stringify(o)}; document.activeElement = { tagName: 'BUTTON', textContent: o.text, getAttribute: function (n) { return n === 'data-act' ? o.act : null; }, closest: function (sel) { return sel === o.in ? this : null; } };
      var r = JSON.stringify(keyFocus()); document.activeElement = null; return r; })()`);
    eq(kf({ act: 'hint', text: ' Hint 2 ', in: '#cbar' }), '{"act":"hint","label":"Hint 2"}', 'a bar button');
    eq(kf({ act: 'storyJump', text: 'Better', in: '#cstrip' }), '{"act":"storyJump","label":"Better"}', 'a strip name');
    eq(kf({ act: 'menu', text: '•••', in: '#ctop' }), '{"other":true}', 'the menu button');
    eq(kf({ act: null, text: 'Your turn', in: '#cband' }), 'null', 'the band heading');
  });

  await test('the key line never lags the state: blank from a change until its words, then the state\'s own keys (slice 14 #3)', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const bad = [];
    let samples = 0, shown = 0, blank = 0;
    /* every 10 ms: the line on screen is blank or exactly the keys of the state as it is now */
    const run = (ms, at) => {
      for (let t = 0; t < ms; t += 10) {
        A.advance(10);
        const r = JSON.parse(A.ev('JSON.stringify((function (a) { return { on: window.__els.ckeys.innerHTML, now: a ? esc(displayFor(a).keys) : "" }; })(ui.session.active))'));
        samples++;
        if (!r.on) { blank++; continue; }
        shown++;
        if (r.on !== r.now) bad.push(at + ' +' + t + ': shows "' + r.on + '" for "' + r.now + '"');
      }
    };
    const key = A.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && unpackUci(x.b.ru).length; })[0]; return it.key; })()`);
    A.ev(`(function () { ${AFTER} window.readyEngine(); window.__holdTry = false; window.__show(model().byKey['${key}']); return 1; })()`);
    run(1000, 'open');
    A.key('?'); run(800, 'hint 1');
    /* a move off the card's book, checked by the engine stub */
    A.ev(`(function () { ${AFTER} var a = ui.session.active, m = offBook(a); sessionClick(m.from); sessionClick(m.to); return 1; })()`);
    run(60, 'checking');
    eq(A.ev('window.__els.ckeys.innerHTML'), '', 'blank while the move is checked and its words wait');
    await tick(); await tick();
    run(2500, 'checked');
    A.ev('(function () { var a = ui.session.active; if (a.phase === "tried" && a.tried.reply) seeIt(); return 1; })()');
    run(1500, 'see it');
    A.key('Enter'); run(1000, 'try again');
    A.ev('(function () { var a = ui.session.active; sessionClick(a.best.from); sessionClick(a.best.to); return 1; })()');
    run(2500, 'solved');
    A.key('ArrowRight'); run(1500, 'story');
    A.key('ArrowRight'); run(1500, 'story 2');
    A.key('Escape'); run(1500, 'back');
    ok(samples > 1000 && shown > 500 && blank > 10, 'samples ' + samples + ', shown ' + shown + ', blank ' + blank);
    eq(bad.length, 0, bad.slice(0, 5).join(' | '));
    A.ev('(window.__holdTry = false, 1)');
  });

  await test('? with no hint left does nothing: a try on the board stays (slice 14 #2)', () => {
    const A = boot();
    A.ev(DOM);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol; }).slice(0, 4).map(function (x) { return x.key; }))`));
    for (const key of keys) {
      A.ev(`(function () { ${AFTER} var a = window.__show(model().byKey['${key}']); return 1; })()`);
      run(1000);
      A.key('?'); run(800); A.key('?'); run(800);
      eq(A.ev('ui.session.active.hints'), 2, key + ': two hints');
      A.ev('(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()');
      run(1500);
      const before = A.ev('JSON.stringify((function (a) { return [a.phase, a.tried && a.tried.uci, a.hints, a.misses]; })(ui.session.active))');
      ok(/"tried"/.test(before), key + ': a try on the board ' + before);
      A.key('?'); run(800);
      eq(A.ev('JSON.stringify((function (a) { return [a.phase, a.tried && a.tried.uci, a.hints, a.misses]; })(ui.session.active))'), before, key + ': ? changed nothing');
      A.ev('(giveHint(), 1)'); run(800);
      eq(A.ev('JSON.stringify((function (a) { return [a.phase, a.tried && a.tried.uci, a.hints, a.misses]; })(ui.session.active))'), before, key + ': nor did giveHint');
    }
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
    /* V2.2: while their line has more to play, Next move › holds slot 0, and
       the held key never stepped it; at the line's end Show the answer */
    if (A.ev('seeMore(ui.session.active.tried)')) {
      eq(JSON.stringify(inSlot(0)), JSON.stringify({ act: 'seeIt', slot: 0 }), 'Next move › in slot 0');
      eq(A.ev('ui.session.active.tried.step'), 1, 'the held Enter played their reply alone');
      A.ev('(function () { var g = 0; while (seeMore(ui.session.active.tried) && g++ < 12) seeIt(); return 1; })()');
      A.advance(1000);
    }
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
    /* V2.2: Next move › holds the slot while their line has more to play
       (guarded as any changed slot: a click 80 ms after it is nothing), then
       the help */
    if (A.ev('seeMore(ui.session.active.tried)')) {
      ok(/^Next move › \| Try again$/.test(S().bar), 'the bar after their reply: ' + S().bar);
      A.click('seeIt', null, 0);
      eq(A.ev('ui.session.active.tried.step'), 1, 'Next move 80 ms after its slot changed: nothing');
      /* each press one move (the slot keeps its name, so no guard between) */
      for (let g = 0; g < 12 && A.ev('seeMore(ui.session.active.tried)'); g++) {
        const st = A.ev('ui.session.active.tried.step');
        wait(500);
        A.click('seeIt', null, 0);
        eq(A.ev('ui.session.active.tried.step'), st + 1, 'Next move plays one move');
      }
      wait(700);
    }
    ok(/^Hint \| Try again$/.test(S().bar), 'the bar after their line: ' + S().bar);
    eq(A.ev('slotAct.slice(0, 2).join(" ")'), 'hint tryAgain', 'the bar painted after their line');
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
    for (let g = 0; g < 12 && A.ev('seeMore(ui.session.active.tried)'); g++) { wait(500); A.click('seeIt', null, 0); }
    if (A.ev('ui.session.active.tried.step') > 1) wait(700);
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

  await test('a tap on any of your pieces takes a try back; the tried piece, the castled rook included, is not picked up (I1)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      allMistakes().filter(trainable).forEach(function (it) {
        var a0 = openCard(it);
        if (!a0) return;
        legalMoves(a0.st).filter(function (m) { return m.castle && moveUci(m) !== a0.bestUci; }).forEach(function (m) {
          /* the king lands on m.to, the rook beside it: a tap on either takes
             the try back and picks nothing up (it would play from a square
             the board no longer shows it on) */
          var short_ = m.castle === 'O-O', rookTo = m.to + (short_ ? -1 : 1);
          [[m.to, -1], [rookTo, -1]].forEach(function (p) {
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
       the rook takes it back with nothing picked up (round D, as I1) */
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
            if (a.phase !== 'guess' || a.sel !== -1 || a.attempts !== 0) out.push(it.key + ' ' + m.castle + ' being checked, a tap on ' + sqName(p[0]) + ': phase ' + a.phase + ', selected ' + (a.sel >= 0 ? sqName(a.sel) : 'none') + ', attempts ' + a.attempts);
          });
        });
      });
      window.__holdTry = false;
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(c.n >= 4, 'castling moves checked ' + c.n);
    eq(c.out.length, 0, c.out.join(' | '));
  });

  await test('after See it, a press on the tried piece only takes the try back: nothing picked up, and the next tap plays nothing from the old square (I1)', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 3; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, sel: a.sel, attempts: a.attempts, misses: a.misses, result: a.result || null, seen: !!(a.tried && a.tried.seen) }; })(ui.session.active))'));
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 6).map(function (it) { return it.key; }))`));
    ok(cards.length >= 4, 'cards ' + cards.length);
    let n = 0;
    for (const key of cards) for (const how of ['pointer', 'click']) {
      const at = key + ' ' + how;
      A.ev(`(function () { ${AFTER} var a = window.__show(model().byKey['${key}']); return 1; })()`);
      run(1000);
      /* the game move again: a miss with its stored reply, then See it */
      const g = JSON.parse(A.ev('JSON.stringify((function (a) { return { from: a.played.from, to: a.played.to }; })(ui.session.active))'));
      A.tap(g.from); A.tap(g.to);
      run(1500);
      let s = S();
      if (s.phase !== 'tried') { ok(false, at + ': the game move is a try, not ' + s.phase); continue; }
      if (!A.ev('!!ui.session.active.tried.reply')) continue;
      A.click('seeIt', null, 0);
      run(1500);
      eq(S().seen, true, at + ': See it played the reply');
      const before = S();
      /* a press on the tried piece where it now stands */
      if (how === 'pointer') A.tap(g.to); else A.ev('(sessionClick(' + g.to + '), 1)');
      s = S();
      eq(s.phase + ' ' + s.sel, 'guess -1', at + ': the try goes and nothing is picked up');
      /* the click that press made is no tap on the card's position (on a capture, their piece stood there: no T4) */
      eq(A.ev('ui.session.active.note ? ui.session.active.note.id : null'), null, at + ': no word for the click of that press');
      eq(s.attempts + ' ' + s.misses + ' ' + s.result, before.attempts + ' ' + before.misses + ' null', at + ': nothing graded');
      run(1000);
      /* the next tap, on the square the piece was seen on, plays nothing */
      A.tap(g.to);
      s = S();
      ok(s.phase === 'guess' && s.attempts === before.attempts, at + ': the next tap plays nothing, ' + JSON.stringify(s));
      n++;
      /* a piece of yours that stands where it stood is picked up there */
      A.ev(`(function () { var a = ui.session.active; a.sel = -1; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()`);
      run(1500);
      if (S().phase !== 'tried') continue;
      const other = A.ev('(function (a) { var f = triedFrame(a).st; for (var i = 0; i < 64; i++) if (i !== a.tried.to && f.b[i] && f.b[i] === a.st.b[i] && isW(a.st.b[i]) === a.st.w) return i; return -1; })(ui.session.active)');
      if (how === 'pointer') A.pointer('pointerdown', other); else A.ev('(sessionClick(' + other + '), 1)');
      s = S();
      eq(s.phase + ' ' + s.sel, 'guess ' + other, at + ': another piece of yours is picked up on its square');
    }
    ok(n >= 6, 'tried pieces pressed after See it: ' + n);
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
            /* V2.3: the automatic hint is due at the miss and counts when it
               shows (Try again): the due one counted here */
            seen.push(a.phase === 'tried' && a.misses === i + 1 ? a.hints + (a.autoDue ? 1 : 0) : 'phase ' + a.phase + ', misses ' + a.misses);
          }
          return seen.join(',');
        });
        /* tier 1: shown at Try again, never at the miss */
        if (tier === 1) { var b = openCard(its[0]); gradeMove(uciToMove(b.st, b.playedUci)); var at = b.hints + ' ' + b.autoDue; tryAgain(); out.shown = at + ' / ' + b.hints + ' ' + b.autoDue; }
      });
      return JSON.stringify(out); })()`));
    const want = { 1: '1,1,1', 2: '0,1,1', 3: '0,0,0' };
    [1, 2, 3].forEach((t) => r[t].forEach((x, i) => eq(x, want[t], 'tier ' + t + ' card ' + i + ', hints after misses 1 to 3')));
    eq(r.shown, '0 1 / 1 0', 'tier 1: the hint due at the miss counts when Try again shows it (V2.3)');
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

  /* slice 6, the verdict states (S2 to S5, S11) */
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
      /* a second close move keeps its row 2 (V2.7) */
      A.ev(`(function (a) { window.readyEngine(); gradeMove(uciToMove(a.st, '${p.m2}')); return 1; })(ui.session.active)`);
      await tick(); await tick();
      r = JSON.parse(A.ev('(function (a) { var d = displayFor(a); return JSON.stringify({ kind: a.tried && a.tried.kind, row1: d.row1, row2: d.row2, misses: a.misses }); })(ui.session.active)'));
      eq(r.kind, 'close', at + ': a second close move'); eq(r.row1 + '|' + r.row2, 'Good move|There\'s a stronger one.', at + ': row 2 kept the second time (V2.7)'); eq(r.misses, 0, at + ': still no miss');
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
      eq(s.sel, -1, at + ': nothing picked up, a tap on the moved piece too (round D, as I1)');
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
          return JSON.stringify({ theirs: theirs, mine: mine, to: to, free: free, mine2: mine2, t2: fitRow([CARD_COPY.T2(a, inWords(a)), CARD_COPY.T2(a)], 'row2', ''), t4: CARD_COPY.T4(a), jobs: window.__evals.length }); })(ui.session.active)`));
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
        ok(/^(Your turn|Hint 1 of [23])/.test(band()) && !/Move a (white|black) piece/.test(band()), at + ': the task (or the hint it brought), not T4, after Try again: ' + band());
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
        ok(/^Checking [^…]+… /.test(band()) && band().slice(-c.t4.length) === c.t4, at + ': T4 under the check\'s row 1: ' + band());
        eq(A.ev('(function (a) { return a.phase + " " + a.attempts + " " + a.misses; })(ui.session.active)'), 'checking ' + ck.s, at + ': T4 during a check graded nothing');
        run(2600);
        ok(/^Checking [^…]+…( Still checking\.)?$/.test(band()), at + ': the check\'s words are back: ' + band());
        A.ev('(window.__holdTry = false, takeBack(), 1)');
        run(1000);
        /* after an answer: any piece answers with N1, and nothing changes (no exploring, no step) */
        A.ev('(function () { var a = ui.session.active; tryAgain(); reveal(); return 1; })()');
        run(1000);
        s = S();
        const any = A.ev('(function (a) { var st = doneBoard(a); for (var q = 0; q < 64; q++) if (st.b[q]) return q; })(ui.session.active)');
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
    /* the tap answered with "not a move here": its outline drawn, or before an answer held back by a ring already drawn (2.1's one ring) */
    const nope = () => A.ev('(function (a) { var r = (boardOptsFor(a).opts.rings || []), n = a.nope && a.nope.key === cardStateKey(a) ? a.nope.sq : -1, drawn = r.filter(function (x) { return x.kind === "nope"; }).map(function (x) { return x.sq; }); return JSON.stringify(n < 0 || (drawn.length ? drawn[0] === n : a.phase !== "done" && r.length > 0) ? (n < 0 ? [] : [n]) : ["outline " + JSON.stringify(r)]); })(ui.session.active)');
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
      q = pick('doneBoard(a)', -1);
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

  await test('r6 design M2 (release 2 slice A): a swipe that starts on a board scrolls the page; only a touch that picks up one of the player\'s pieces while the card asks holds the gesture, and the tap that puts that piece down is played at its lift', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    /* every board lets the page pan; none takes the whole gesture (touch-action: none) */
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.css'), 'utf8');
    ok(/#bwrap \.board\{touch-action:pan-y\}/.test(css) && /\.board\{[^}]*touch-action:manipulation/.test(css) && !/touch-action:\s*none/.test(css), 'boards pan the page');
    const key = A.ev(`allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; })[0].key`);
    A.ev(`(window.__show(model().byKey['${key}']), 1)`);
    run(1000);
    const sq = JSON.parse(A.ev(`(function (a) { var o = { mine: -1, theirs: -1, empty: -1 }, lm = legalMoves(a.st);
      for (var q = 0; q < 64; q++) { var p = a.st.b[q]; if (!p) { if (o.empty < 0 && !lm.some(function (m) { return m.to === q; })) o.empty = q; }
        else if (isW(p) === !!a.st.w) { if (o.mine < 0 && lm.some(function (m) { return m.from === q; })) o.mine = q; } else if (o.theirs < 0 && !lm.some(function (m) { return m.to === q; })) o.theirs = q; }
      return JSON.stringify(o); })(ui.session.active)`));
    ok(sq.mine >= 0 && sq.theirs >= 0 && sq.empty >= 0, 'squares ' + JSON.stringify(sq));
    /* a finger down: the pointer event comes first, then the touch event the page may hold (preventDefault: no scroll, no click) */
    let held = 0;
    const touch = (s) => { held = 0; A.pointer('pointerdown', s); A.pointer('touchstart', s, { preventDefault() { held++; } }); return held; };
    const sel = () => A.ev('ui.session.active.sel');
    eq(touch(sq.mine), 1, 'a touch on one of yours while the card asks is held for its drag');
    A.pointer('pointerup', sq.mine);
    eq(sel(), sq.mine, 'and picks the piece up');
    eq(touch(sq.mine), 1, 'touched again: held');
    A.pointer('pointerup', sq.mine);
    eq(sel(), -1, 'and put down at its lift, as its click would (the held touch sends none)');
    eq(touch(sq.theirs), 0, 'a touch on one of theirs is the page\'s swipe');
    A.pointer('pointerup', sq.theirs); A.pointer('click', sq.theirs); run(3000);
    eq(touch(sq.empty), 0, 'and on an empty square');
    A.pointer('pointerup', sq.empty); A.pointer('click', sq.empty); run(3000);
    eq(A.ev('ui.session.active.phase'), 'guess', 'nothing graded');
    /* a drag still plays: the answer dragged solves the card */
    const c = JSON.parse(A.ev('JSON.stringify((function (a) { return { bf: a.best.from, bt: a.best.to }; })(ui.session.active))'));
    eq(touch(c.bf), 1, 'the answer\'s piece held');
    A.pointer('pointermove', c.bt); A.pointer('pointerup', c.bt);
    eq(A.ev('ui.session.active.phase'), 'done', 'its drag plays it');
    run(1500);
    eq(touch(c.bt), 0, 'on the answered card a touch is never held');
    A.pointer('pointerup', c.bt);
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
              /* V2.2: See it, then Next move › to the line's end (the slot
                 says so while their line has more to play) */
              if (seen) { seeIt(); var g = 0; while (seeMore(a.tried) && g++ < 12) { var bm = bar(a); if (bm[0] !== 'seeIt:Next move ›:btn-line') out.push('tier ' + tier + ' ' + it.key + ': mid-line left slot ' + bm[0]); seeIt(); } }
              var b = bar(a), at = 'tier ' + tier + ' ' + it.key + ' miss ' + i + (seen ? ', See it' : '');
              n++;
              if (b[1] !== 'tryAgain:Try again:btn-big') out.push(at + ': right slot ' + b[1]);
              /* V2.3: the hint a miss brings counts when it shows, so the
                 button names the next hint while it is due, never "No more
                 hints" */
              var hs = a.hints;
              var left = !seen ? 'seeIt:See it:btn-line' : i >= 3 ? 'reveal:Show the answer:btn-line'
                : hs >= hintMax(a) ? 'hint:No more hints:btn-line:off' : hs ? 'hint:Hint ' + (hs + 1) + ':btn-line' : 'hint:Hint:btn-line';
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

  await test('See it adds exactly one opponent ply, and each Next move › one more ply of their line, to its end (V2.2: 8 plies at most from the try)', () => {
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
        /* V2.2: each Next move plays one more ply of the line, to its end,
           then the button goes */
        var g = 0, prev = after;
        while (seeMore(a.tried) && g++ < 12) {
          if (!barSlots(a, ui.session).some(function (s) { return s.act === 'seeIt' && s.label === 'Next move ›'; })) out.push(what + ': Next move not offered mid-line');
          seeIt();
          var nx = triedFrame(a).st, one = legalMoves(prev).filter(function (m) { var x = cloneState(prev); applyMove(x, m); return stateFen(x) === stateFen(nx); });
          if (one.length !== 1) out.push(what + ': a Next move played ' + one.length + ' plies');
          prev = nx;
        }
        if (t.line.length + 1 > 8) out.push(what + ': the line runs past 8 plies');
        if (stateFen(a.st) !== st0) out.push(what + ': the card position moved');
        seeIt();
        if (stateFen(triedFrame(a).st) !== stateFen(prev)) out.push(what + ': a press at the end of the line played more');
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
          /* (V2.2: a piece you take back wears no token; the line's still
             marks land with the piece too) */
          var f = boardOptsFor(a), held = !!(t.lost && t.lost.sq !== due.to && !takenBack(a, t)) || drawn || seeMarks(a).length > 0;
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
          if (t.lost && t.lost.sq !== due.to && !takenBack(a, t)) { if (tk.length !== 1 || tk[0].sq !== t.lost.sq || tk[0].p !== t.lost.p || tk[0].kind !== 'lost') out.push(what + ': the token missing'); else seen.token++; }
          else if (tk.length) out.push(what + ': a token with nothing taken, or taken back');
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
      return { id: w.id, kind: w.kind, dt: w.t - ${t0}, ring: /ring/.test(w.v), arrow: /arrow/.test(w.v), r2: w.id === 'cband' ? (/<p class="bd-r2">([\\s\\S]*?)<\\/p>/.exec(w.v) || [])[1] || '' : null,
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
        ok(said && said.dt === v.dt + WORDS && said.r2 === A.ev('ledgerHtml(ui.session.active.verdict.row2)'), at + ': the words ' + WORDS + ' ms after the verdict, ' + JSON.stringify(said));
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
        /* (V2.2: a capture you take back wears no token: not these cards) */
        t.seen = true; t.step = 1; var tb = !!t.lost && takenBack(a, t); t.seen = false; t.step = 0;
        return t.threat && t.threat.from !== due.to && t.threat.to !== due.to && t.lost && t.lost.sq !== due.to && !tb;
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
        /* (V2.2: Next move › while their line has more to play) */
        const acts = A.ev('seeMore(ui.session.active.tried)') ? 'seeIt tryAgain' : 'hint tryAgain';
        ok(s.acts === acts && !s.s0 && !s.s1 && !s.band, at + ': the new bar, nothing faded: ' + JSON.stringify(s));
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
    const at0 = (t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t} && w.v != null && w.kind !== 'keys'; }).map(function (w) {
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
      const ws = JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t0} && w.kind !== 'keys' && (w.v != null || w.kind === 'text'); }).map(function (w) { return { k: w.kind, dt: w.t - ${t0} }; }))`));
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
    const at0 = (t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t} && w.v != null && w.kind !== 'keys'; }).map(function (w) {
      return w.kind + ' ' + w.id + ' +' + (w.t - ${t}) + (w.kind === 'text' ? (/Hint 1 of [23]/.test(w.v) ? ' H1' : /Hint 2 of [23]/.test(w.v) ? ' H3' : '') : ' ' + w.v);
    }))`));
    /* the marks the card draws now, against the budget (2.1): the game arrow
       and one dashed arrow, one ring (the gold pair aside), one tried line;
       the danger hint (F1.1) up to two rings on your pieces and three dashed
       arrows of theirs */
    const budget = (at) => {
      const b = JSON.parse(A.ev(`JSON.stringify((function (a) { var o = boardOptsFor(a).opts, dz = (hintMarks(a).dz || hintMarks(a).rep) ? 1 : 0;
        return { arrows: (o.arrows || []).length + (o.bad ? 1 : 0), rings: (o.rings || []).filter(function (m) { return m.kind !== 'nope'; }).length + (o.hint != null ? 1 : 0), tried: (o.tried || []).length, dz: dz }; })(ui.session.active))`));
      ok(b.arrows <= (b.dz ? 4 : 2) && b.rings <= (b.dz ? 2 : 1) && b.tried <= 1, at + ': over the budget ' + JSON.stringify(b));
      return b;
    };
    const hinted = (w) => / (ring arrow|target|ring|aring|arrow)/.test(w) && /(ring|target)/.test(w);
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
        /* V2.3: the miss's hint is due, and counts when Try again shows it */
        eq(A.ev('ui.session.active.hints + "+" + (ui.session.active.autoDue || 0)'), how === 'pressed' ? '0+0' : '0+1', at + ': hints before Try again (shown + due)');
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

  await test('? follows the Hint button: while a move is checked it gives the hint until K1 (the move taken back), and does nothing once K1 takes the bar', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev(`(function () { ${AFTER} window.__offBook = offBook; window.__holdTry = true; playerTier = function () { return 3; }; return 1; })()`);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const S = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { phase: a.phase, hints: a.hints, attempts: a.attempts, said: a.checkSaid || 0, acts: slotAct.join(" ") }; })(ui.session.active))'));
    const keys = JSON.parse(A.ev('JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; }).slice(0, 4).map(function (it) { return it.key; }))'));
    let n = 0;
    for (const key of keys) {
      A.ev(`(window.readyEngine(), window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev('(gradeMove(window.__offBook(ui.session.active)), 1)');
      let s = S();
      eq(s.phase + ' ' + s.said, 'checking 0', key + ': a move being checked, before K1');
      ok(/^hint /.test(s.acts), key + ': the guess bar still offers Hint: ' + s.acts);
      A.key('?');
      s = S();
      eq(s.phase + ' ' + s.hints + ' ' + s.attempts, 'guess 1 0', key + ': ? before K1 gives the hint, as the button does, and takes the move back');
      run(1000);
      A.ev('(gradeMove(window.__offBook(ui.session.active)), 1)');
      run(400);
      s = S();
      ok(s.phase === 'checking' && s.said >= 1 && !/hint/.test(s.acts), key + ': K1 took the bar: ' + JSON.stringify(s));
      A.key('?');
      s = S();
      eq(s.phase + ' ' + s.hints, 'checking 1', key + ': ? after K1 does nothing, as there is no Hint button');
      A.ev('(takeBack(), 1)');
      n++;
    }
    A.ev('(window.__holdTry = false, 1)');
    eq(n, 4, 'cards');
  });

  await test('after Try again, band and board agree on the hint: the band says it on the showing it came with and while its marks stand, else T1 and T2', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { fresh: 0, drawn: 0, task: 0 };
      var look = function (what, a, fresh) {
        a.triedHold = false;
        var d = displayFor(a), hm = hintMarks(a), o = boardOptsFor(a).opts;
        var drawn = hm.rings.length + hm.arrows.length > 0, said = /^Hint [12] of [23]$/.test(d.row1);
        var dz = hm.dz || hm.rep;
        var onBoard = (o.rings || []).some(function (m) { return m.kind === 'target' || m.kind === 'hint' || (hm.danger && m.kind === 'threat') || (dz && m.kind === 'attacked'); })
          || (!!dz && (o.arrows || []).some(function (m) { return m.kind === 'threat'; }));
        if (onBoard !== drawn) out.push(what + ': the board draws the hint ' + onBoard + ', hintMarks ' + drawn);
        if (said !== (fresh || drawn)) out.push(what + ': the band reads ' + d.row1 + ' / ' + d.row2 + (fresh ? ' on the hint\\'s own showing' : '') + (drawn ? ' with its marks drawn' : ' with nothing drawn'));
        /* tier 1 names the game move in words, or no move where they do not fit (F1.6) */
        if (!said && (d.row1 !== CARD_COPY.T1(a) || (a.tier === 1 ? [CARD_COPY.T2(a, true), 'Find a better move.'] : [CARD_COPY.T2(a)]).indexOf(d.row2) < 0)) out.push(what + ': the task back reads ' + d.row1 + ' / ' + d.row2);
        if (fresh) n.fresh++; else if (drawn) n.drawn++; else n.task++;
      };
      var miss = function (a) { if (a.phase === 'tried') tryAgain(); gradeMove(uciToMove(a.st, a.playedUci)); return a.phase === 'tried'; };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a || a.sol || !unpackUci(it.b.ru).length) return;
          var at = 'tier ' + tier + ' ' + it.key;
          /* tier 3: Hint pressed on the card, then the game move missed */
          if (tier === 3) { giveHint(); look(at + ' hint pressed', a, true); }
          for (var m = 1; m <= 3; m++) {
            if (!miss(a)) return out.push(at + ': miss ' + m + ' is ' + a.phase);
            tryAgain();
            /* fresh: the automatic hint this Try again brought (tier 1 at miss 1, tier 2 at miss 2) */
            look(at + ' Try again after miss ' + m, a, (tier === 1 && m === 1) || (tier === 2 && m === 2));
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.fresh >= 60 && r.n.drawn >= 60 && r.n.task >= 20, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' disagree, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('one ring a frame before an answer: "not a move here" is drawn only when no other ring is (hint rings); after an answer it is the tap\'s answer', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { alone: 0, held: 0, done: 0 };
      allMistakes().filter(trainable).forEach(function (it) {
        [0, 1, 2].forEach(function (h) {
          var a = openCard(it);
          if (!a) return;
          a.hints = h;
          var theirs = -1;
          for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) !== myPov(a.it)) { theirs = q; break; }
          var before = (boardOptsFor(a).opts.rings || []).slice();
          a.nope = { sq: theirs, key: cardStateKey(a), seq: 1 };
          var rings = boardOptsFor(a).opts.rings || [];
          if (!before.length) { n.alone++; if (JSON.stringify(rings) !== JSON.stringify([{ sq: theirs, kind: 'nope' }])) out.push(it.key + ' hints ' + h + ': the outline alone is ' + JSON.stringify(rings)); }
          else { n.held++; if (JSON.stringify(rings) !== JSON.stringify(before)) out.push(it.key + ' hints ' + h + ': an outline over ' + JSON.stringify(before) + ': ' + JSON.stringify(rings)); }
        });
        /* answered (principle 6): the outline whatever else is drawn */
        var d = openCard(it);
        if (!d) return;
        reveal(); d.view = { mode: 's0' }; d.settle = 2;
        d.nope = { sq: -1, key: cardStateKey(d), seq: 1 };
        for (var q2 = 0; q2 < 64; q2++) if (doneBoard(d).b[q2]) { d.nope.sq = q2; break; }
        n.done++;
        if (!(boardOptsFor(d).opts.rings || []).some(function (m) { return m.kind === 'nope' && m.sq === d.nope.sq; })) out.push(it.key + ': no outline after an answer');
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.alone >= 60 && r.n.held >= 100 && r.n.done >= 40, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('two arrows into one square keep both heads: the second stops near the square\'s edge (the hint\'s danger recapturing on the game move\'s square)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], cards = [];
      var ends = function (svg) {
        var re = /<line class="([a-z-]+-arrow)"[^>]* x1="([\\d.-]+)" y1="([\\d.-]+)" x2="([\\d.-]+)" y2="([\\d.-]+)"/g, m, o = [];
        while ((m = re.exec(svg))) o.push({ cls: m[1], x2: +m[4], y2: +m[5] });
        return o;
      };
      var ctr = function (sq, flip) { var c = flip ? 7 - sq % 8 : sq % 8, rw = flip ? sq >> 3 : 7 - (sq >> 3); return [c * 45 + 22.5, rw * 45 + 22.5]; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        a.hints = 1;
        var f = boardOptsFor(a), o = f.opts, hm = hintMarks(a);
        if (!o.bad || !hm.danger || hm.danger.to !== o.bad[1]) return;
        cards.push(it.key);
        var e = ends(boardSvg(f.st, o)), t = ctr(o.bad[1], o.flip), d = e.map(function (x) { return Math.hypot(x.x2 - t[0], x.y2 - t[1]) / 45; });
        if (e.length !== 2 || e[0].cls !== 'bad-arrow' || e[1].cls !== 'threat-arrow') return out.push(it.key + ': arrows ' + JSON.stringify(e));
        if (d[0] > 0.35) out.push(it.key + ': the game arrow stops ' + d[0].toFixed(2) + ' of a square short');
        if (Math.abs(d[1] - 0.58) > 1e-6) out.push(it.key + ': the danger stops ' + d[1].toFixed(2) + ' short, not 0.58');
      });
      /* one arrow into a square keeps its usual inset */
      var st = stateFromFen('8/8/8/8/4K3/8/8/k7 w - - 0 1'), one = ends(boardSvg(st, { arrows: [{ from: 28, to: 44, kind: 'threat' }, { from: 0, to: 9, kind: 'threat' }] }));
      if (Math.abs(Math.hypot(one[0].x2 - 202.5, one[0].y2 - 112.5) - 0.34 * 45) > 1e-6) out.push('a lone arrow moved its tip: ' + JSON.stringify(one));
      return JSON.stringify({ out: out, cards: cards }); })()`));
    ok(r.cards.length >= 1, 'cards ' + JSON.stringify(r.cards));
    eq(r.out.length, 0, r.out.join(' | '));
  });

  /* the lifted piece (F3.1) scales about its own square: a CSS transform-origin on a <use> placed by
     x and y scaled it about the board's corner in Chromium, so a piece far from it slid down and right */
  await test('a selected piece lifts about its own square, at every square and from both sides', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { var out = [], n = 0;
      var st = stateFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      [false, true].forEach(function (flip) {
        for (var sq = 0; sq < 64; sq++) {
          if (!st.b[sq]) continue;
          var svg = boardSvg(st, { flip: flip, sel: sq }), lifts = (svg.match(/class="lift"/g) || []).length;
          var m = new RegExp('<use[^>]*x="([\\\\d.]+)" y="([\\\\d.]+)" width="([\\\\d.]+)"[^>]*data-sq="' + sq + '" class="lift" transform="translate\\\\(([-\\\\d.]+) ([-\\\\d.]+)\\\\) scale\\\\(1\\\\.07\\\\) translate\\\\(([-\\\\d.]+) ([-\\\\d.]+)\\\\)"').exec(svg);
          n++;
          if (lifts !== 1) out.push((flip ? 'b ' : 'w ') + sq + ': ' + lifts + ' lifted');
          if (!m) { out.push((flip ? 'b ' : 'w ') + sq + ': no lift about a point'); continue; }
          var x = +m[1], y = +m[2], s = +m[3], cx = x + s / 2, cy = y + s * 0.9;
          if (Math.abs(+m[4] - cx) > 1e-6 || Math.abs(+m[5] - (cy - 1.5)) > 1e-6 || Math.abs(+m[6] + cx) > 1e-6 || Math.abs(+m[7] + cy) > 1e-6)
            out.push((flip ? 'b ' : 'w ') + sq + ': pivot ' + m.slice(4).join(' ') + ', not ' + cx + ' ' + cy);
        }
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    eq(r.n, 64, 'every piece of both sides, from both sides of the board');
    eq(r.out.length, 0, r.out.join(' | '));
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

  /* the board primitives, drawn by boardSvg as markup and
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
        r2: w.id === 'cband' ? (/<p class="bd-r2">([\\s\\S]*?)<\\/p>/.exec(v) || [])[1] || '' : null,
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
      var pair = its.filter(function (it) { var a = openCard(it); return familyOf(patternOf(it.b)).key !== 'chances' && threatOf(a.cls.gameLine, 1) && a.best.to !== a.played.to; });
      /* one whose pair still holds once solved (fresh-eyes T1), first */
      var holds = function (it) { var a = openCard(it), t = threatOf(a.cls.gameLine, 1); applyMove(a.st, uciToMove(a.st, a.bestUci)); return a.st.b[t.from] === a.cls.gameLine.nodes[1].before.b[t.from] && s0ThreatHolds(a, a.st, t); };
      pair = pair.filter(holds).slice(0, 1).concat(pair.filter(function (it) { return !holds(it); })).slice(0, 3);
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
      ok(bar && /^See why \| (Continue|Finish)$/.test(bar.bar) && bar.dt === v.dt, at + ': the bar with it, ' + JSON.stringify(bar));
      const gh = ws.filter((w) => w.id === 'bwrap' && /ghost/.test(w.v))[0], chances = A.ev(`familyOf(patternOf(model().byKey['${key}'].b)).key`) === 'chances';
      ok(gh && gh.dt === v.dt + MARKS, at + ': the ghost ' + MARKS + ' ms after the words, ' + JSON.stringify(gh) + ' vs ' + v.dt);
      ok(chances ? !/ring|arrow/.test(gh.v) : (/ring/.test(gh.v) && /arrow/.test(gh.v)) === A.ev('(function (a) { var t = threatOf(a.cls.gameLine, 1); return !!(t && a.st.b[t.from] === a.cls.gameLine.nodes[1].before.b[t.from] && s0ThreatHolds(a, a.st, t)); })(ui.session.active)'),
        at + ': the threat pair with it (none on a missed chance), ' + gh.v);
      ok(/tick/.test(gh.v), at + ': the tick stays');
      const r4 = ws.filter((w) => w.id === 'cband' && w.r2)[0], strip = ws.filter((w) => w.id === 'cstrip' && w.dt > 0).pop();
      ok(r4 && r4.dt === v.dt + WORDS && r4.r1 === 'Found it' && r4.r2 === A.ev('ledgerHtml(displayFor(ui.session.active).row2)'), at + ': R4 ' + WORDS + ' ms after, ' + JSON.stringify(r4));
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
      eq(s.bar.replace('Finish', 'Continue'), 'Continue | Play it', at + ': the bar');
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
      /* V2.7: "Play the green arrow." leaves with the arrow (once played,
         row 2 is empty until R4); nothing else changes before R4 */
      ok(!ws.some((w) => w.id === 'cband' && w.dt < (r4 ? r4.dt : 1e9) && !(w.r2 === '' && /^The answer: /.test(w.r1))), at + ': the band stays until R4, ' + JSON.stringify(ws.filter((w) => w.id === 'cband')));
      const bars = ws.filter((w) => w.id === 'cbar'), gh = ws.filter((w) => w.id === 'bwrap' && /ghost/.test(w.v))[0];
      ok(bars[0] && /^(Continue|Finish) \| Play it$/.test(bars[0].bar) && bars[0].dt === lead + 520, at + ': the bar repainted once played, ' + JSON.stringify(bars));
      ok(gh && gh.dt === lead + 520 + 700 && /info/.test(gh.v), at + ': S0\'s marks 700 ms after, ' + JSON.stringify(gh));
      ok(r4 && r4.dt === lead + 520 + 850 && /^The answer: /.test(r4.r1), at + ': R4 850 ms after, under the answer, ' + JSON.stringify(r4));
      ok(bars[1] && /^See why \| (Continue|Finish)$/.test(bars[1].bar) && bars[1].dt === r4.dt, at + ': and the bar to the story, ' + JSON.stringify(bars));
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
      if (from) { A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); return 1; })(ui.session.active)'); run(2500); }
      const before = JSON.parse(A.ev('JSON.stringify({ fen: stateFen(ui.session.active.st), idx: ui.session.active.solIdx })'));
      eq(before.idx, from, at + ': the line where it stands');
      A.click('reveal', null, 1);
      run(600);
      const s = JSON.parse(A.ev(`JSON.stringify((function (a) { var d = displayFor(a), m = uciToMove(a.st, a.sol[a.solIdx]), f = boardOptsFor(a);
        return { fen: stateFen(a.st), r1: d.row1, want: 'The answer: ' + sanOf(a.st, m), arrows: (f.opts.arrows || []).map(function (x) { return x.from + '-' + x.to; }), due: m.from + '-' + m.to, result: a.result }; })(ui.session.active))`));
      eq(s.fen, before.fen, at + ': the moves found stay on the board (4.7)');
      eq(s.r1, s.want, at + ': the answer named is the move due now');
      eq(JSON.stringify(s.arrows), JSON.stringify([s.due]), at + ': its green arrow');
      /* V1.6: after the line's first move found, the answer shown holds the rung (with a hint) */
      eq(s.result, from ? 'hint' : 'fail', at + ': graded at once');
      /* Play it until the line ends: each reply of theirs plays by itself, held (S10), and the next move of yours lands with its arrow */
      for (let guard = 0; guard < 10 && A.ev('ui.session.active.view.mode') === 'show'; guard++) {
        const idx = A.ev('ui.session.active.solIdx');
        A.click('playIt', null, 1);
        eq(A.ev('ui.session.active.solIdx'), idx + 1, at + ': Play it plays one move');
        /* the last reply's own marks belong to the move it was: gone once another is played */
        eq(A.ev('(boardOptsFor(ui.session.active).opts.arrows || []).filter(function (x) { return x.kind === "reply"; }).length'), 0, at + ': no reply arrow on your move');
        if (A.ev('ui.session.active.view.mode') !== 'show') break;
        /* while their reply is due, Play it is off and the board takes nothing */
        eq(A.ev('!!ui.session.active.showWait'), true, at + ': their reply is due');
        A.ev('(playIt(false), 1)');
        eq(A.ev('ui.session.active.solIdx'), idx + 1, at + ': Play it does nothing meanwhile');
        /* on S10's timeline from Play it's landing (its fade, then 320 ms): the telegraph at 600, the slide's board at 1450, landed at 1900 */
        const lead = A.ev('SLIDE_LEAD'), t1 = A.getNow() + 100 + lead + 320;
        run(2600);
        const ws = JSON.parse(A.ev(`JSON.stringify(window.__sw(${t1}))`));
        const tele = ws.filter((w) => w.id === 'marks' && /rring/.test(w.v))[0];
        ok(tele && tele.dt === 600 && /rdash/.test(tele.v), at + ': the telegraph at 600, ' + JSON.stringify(ws.filter((w) => w.id === 'marks')));
        const reply = ws.filter((w) => w.id === 'bwrap' && /slow/.test(w.v))[0];
        ok(reply && reply.dt === 1500 - lead && !/green/.test(reply.v), at + ': their reply slides from 1500, no arrow yet, ' + JSON.stringify(ws.filter((w) => w.id === 'bwrap')));
        const green = ws.filter((w) => w.id === 'bwrap' && /green/.test(w.v))[0];
        /* landed, the reply's own arrow and token give way to the green arrow (never a token under it) */
        ok(green && green.dt === 1900 && !/rsolid|rring|rdash|token/.test(green.v), at + ': the next arrow lands with it at 1900, alone, ' + JSON.stringify(green));
        /* V2.7: "Play the green arrow." leaves with the arrow played (row 2
           empty before the telegraph), and the words at 2050: Play it back
           on, and the next answer named with its arrow's words */
        const gone = ws.filter((w) => w.id === 'cband' && w.dt > 0 && w.r2 === '');
        ok(gone.every((w) => w.dt < 600 && /^The answer: /.test(w.r1)), at + ': the arrow\'s words leave with it, ' + JSON.stringify(gone));
        const named = ws.filter((w) => w.id === 'cband' && w.dt > 0 && w.r2 !== '')[0], back = ws.filter((w) => w.id === 'cbar' && w.dt > 200)[0];
        ok(back && back.dt === 2050 && /Play it/.test(back.bar) && named && named.dt === 2050 && named.r2 === 'Play the green arrow.', at + ': the words at 2050, ' + JSON.stringify([named, back]));
        eq(A.ev('ui.session.active.solIdx'), idx + 2, at + ': their reply played');
        eq(A.ev('displayFor(ui.session.active).row1'), A.ev('"The answer: " + sanOf(ui.session.active.st, uciToMove(ui.session.active.st, ui.session.active.sol[ui.session.active.solIdx]))'), at + ': the next answer named');
        steps++;
        A.advance(500);
      }
      run(2000);
      const end = JSON.parse(A.ev(`JSON.stringify((function (a) { var d = displayFor(a); return { mode: a.view.mode, settle: a.settle, idx: a.solIdx, n: a.sol.length, bar: d.buttons.map(function (x) { return x.label; }).join(' | '), r1: d.row1, r2: d.row2 }; })(ui.session.active))`));
      eq(end.mode + ' ' + end.settle + ' ' + (end.idx === end.n), 's0 2 true', at + ': the line ends, the card settles');
      /* shown from the first move the card comes back later in the set; held mid-line (V1.6) it does not, so a one-card set finishes */
      eq(end.bar, from ? 'See why | Finish' : 'See why | Continue', at + ': the bar to the story');
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
        run(3000);
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
        /* one check line (F2.3), the card's own */
        if (h.indexOf('<p class="habit">' + esc(checkLine(a)) + '</p>') < 0 || (h.match(/class="habit"/g) || []).length !== 1) out.push(it.key + ': no check line, or more than one');
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
      /* a close move found first, then the answer: graded hint, and the
         summary says what happened last, the answer shown (S17), not solved */
      var a = openCard(one[0]); a.foundGood = { san: 'x', win: 60 }; reveal();
      if (a.result !== 'hint') out.push('after a close move the reveal grades ' + a.result);
      ui.session.finished = true;
      var dh = doneHtml(ui.session);
      if (!/class="res shown">Shown</.test(dh) || /1 of 1 solved/.test(dh) || /With help/.test(dh)) out.push('a close move then the answer shown does not read Shown, unsolved: ' + (dh.match(/class="res[^"]*">[^<]*/g) || []).join(','));
      a = openCard(one[1]); reveal();
      if (a.result !== 'fail' || ui.session.notes[a.key] !== 'shown') out.push('a reveal grades ' + a.result + ', notes ' + ui.session.notes[a.key]);
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
      var out = [], n = { pair: 0, ghost: 0, won: 0, holds: 0, holdsStatic: 0 }, its = allMistakes().filter(trainable);
      its.forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        var th = familyOf(patternOf(it.b)).key !== 'chances' ? threatOf(a.cls.gameLine, 1) : null;
        if (!a.sol && th && a.best.to !== a.played.to) {
          solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
          var st = cloneState(a.st);
          if (st.b[th.from] && st.b[th.from] === a.cls.gameLine.nodes[1].before.b[th.from]) {
            n.pair++;
            /* it still holds (fresh-eyes T1): their move, legal here, taking a piece of yours or mating,
               and winning material: the best line plays it next and loses material from here (settled
               where it is counted), or with no line through this board, a loose piece or a cheaper taker */
            var holds = function (st2, line) {
              var pov = myPov(it), lm = legalMoves(st2).filter(function (m) { return m.from === th.from && m.to === th.to; })[0];
              if (!!st2.w === pov || !lm) return false;
              var aft = cloneState(st2); applyMove(aft, lm);
              var took = st2.b[lm.ep >= 0 ? lm.ep : lm.to], mate = checkersOf(aft).length > 0 && !legalMoves(aft).length;
              if (!mate && !(took && isW(took) === pov)) return false;
              if (!line) return mate || !isDefended(st2.b, lm.ep >= 0 ? lm.ep : lm.to) || MOTIF_VAL[pType(st2.b[th.from])] < MOTIF_VAL[pType(took)];
              var j = -1;
              line.nodes.forEach(function (x, k) { if (j < 0 && posKey(x.after) === posKey(st2)) j = k; });
              if (j < 0) return mate || !isDefended(st2.b, lm.ep >= 0 ? lm.ep : lm.to) || MOTIF_VAL[pType(st2.b[th.from])] < MOTIF_VAL[pType(took)];
              var nx = line.nodes[j + 1];
              if (!nx || nx.move.from !== th.from || nx.move.to !== th.to) return false;
              if (mate) return true;
              var q = function (x) { return !x || (!x.captured && !x.move.promo && !checkersOf(x.after).length); };
              var base = matDiff(line.nodes[j].after.b, pov), worst = 0;
              [a.cls.bSettle, line.nodes.length - 1].forEach(function (k) {
                var still = k === line.nodes.length - 1 ? q(line.nodes[k]) : q(line.nodes[k + 1]) && q(line.nodes[k + 2]);
                if (k > j && still) worst = Math.min(worst, matDiff(line.nodes[k].after.b, pov) - base);
              });
              return worst <= -1;
            };
            var want = holds(st, a.cls.bestLine), drawn = s0Marks(a, st).rings.length > 0;
            if (want) n.holds++;
            if (drawn !== want) out.push(it.key + ': the threat pair ' + (drawn ? 'drawn where it no longer holds' : 'not drawn where it holds'));
            /* doctored: the line plays it and loses nothing by it, so it wins nothing */
            if (want) {
              var blf = bestLossFrom; bestLossFrom = function () { return 0; };
              try { if (s0Marks(a, st).rings.length) out.push(it.key + ': a threat pair the line loses nothing by'); } finally { bestLossFrom = blf; }
            }
            /* no line through the board: the board alone decides */
            var bl0 = a.cls.bestLine; a.cls.bestLine = null;
            try {
              var want0 = holds(st, null), drawn0 = s0Marks(a, st).rings.length > 0;
              if (want0) n.holdsStatic++;
              if (drawn0 !== want0) out.push(it.key + ': with no line, the threat pair ' + (drawn0 ? 'drawn where it wins nothing' : 'not drawn where it wins'));
            } finally { a.cls.bestLine = bl0; }
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
    ok(r.n.pair >= 5 && r.n.holds >= 1 && r.n.holdsStatic >= 1 && r.n.pair > r.n.holds && r.n.ghost >= 4 && r.n.won >= 1, JSON.stringify(r.n));
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
        a.lines = cardLines(a); a.alt = { win: 50, best: 52, mate: null }; a.own = true; a.yours = { uci: a.sol.slice(0, 3), cp: 0, at: 2 }; a.compare = null;
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
      if (i === 3) A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); return 1; })(ui.session.active)'), A.advance(3000);
      A.ev('(window.__rec = [], reveal(), 1)');
      if (i === 3) A.ev('(playIt(false), 1)');
      if (i === 1) A.ev('(window.__nlTest.play(ui.session.active.bestUci), 1)');
      const r0 = A.ev('JSON.stringify(ui.session.results)');
      A.ev(`(${code}, 1)`);
      A.setNow(A.getNow() + 5000); A.flush(5);
      /* V1.6: shown after the line's first move found, the card holds its rung (with a hint, no note) */
      const want = i === 3 ? 'hint' : 'fail';
      eq(A.ev('JSON.stringify(window.__rec)'), JSON.stringify([key + ' ' + want]), at + ': recorded once, by the reveal');
      if (way !== 'dispute') {
        const res = JSON.parse(A.ev(`JSON.stringify(ui.session ? ui.session.results : (savedSession() || {}).results || {})`));
        eq(res[key], want, at + ': the result stays ' + want + ', ' + r0);
        eq(A.ev(`(ui.session ? ui.session.notes : (savedSession() || {}).notes || {})['${key}'] || null`), i === 3 ? null : 'shown', at + ': the note stays');
      }
    }
  });

  /* ── the forcing line (S10) ── */
  const FORCING = `JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && c.sol && c.sol.length >= 3; }).map(function (it) { return it.key; }))`;
  /* the writes since t that keep what they wrote: the band and the bar (their markup), the board and the marks (their marks as words) */
  const WR = (A, t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.t >= ${t} && w.v != null && w.kind !== 'keys'; }).map(function (w) { return { id: w.id, t: w.t, v: w.v }; }))`));
  const R1 = (v) => (/<h2 class="bd-r1"[^>]*>([^<]*)<\/h2>/.exec(v) || [])[1] || '';
  const R2 = (v) => (/<p class="bd-r2">([\s\S]*?)<\/p>/.exec(v) || [])[1] || '';
  /* the reply to come, read before it plays: what it takes, whether it checks, F4 */
  const REPLY_INFO = `JSON.stringify((function (a) { var st = cloneState(a.st), m = uciToMove(st, a.sol[a.solIdx]), took = m.ep >= 0 ? st.b[m.ep] : st.b[m.to];
    var w = replyWords(a, a.st, m, took)[0]; applyMove(st, m); return { took: !!took, check: checkersOf(st).length > 0, want: w, opp: sidesOf(a).opp, from: m.from, to: m.to }; })(ui.session.active))`;
  /* the first move of the line, tapped (it slides 220 ms) or dragged (it lands where dropped) */
  const FIRST = (how) => `(function (a) { var m = uciToMove(a.st, a.sol[0]);
    if ('${how}' === 'drag') { a.sel = m.from; pointerState.suppressClick = true; sessionClick(m.to); pointerState.suppressClick = false; }
    else { sessionClick(m.from); sessionClick(m.to); } return a.phase; })(ui.session.active)`;
  const STATE = `JSON.stringify((function (a) { return { phase: a.phase, sel: a.sel, hints: a.hints, solIdx: a.solIdx, result: a.result || null, mu: motionUntil, hold: motionHold, reply: a.reply ? { played: a.reply.played, tele: a.reply.tele } : null }; })(ui.session.active))`;

  await test('the forcing line opens with no pips or count; the pips come with the first move found (a relearn chip gives way), the move due ringed once their reply lands', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0, steps = 0, relearn = 0;
      [2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a || !a.sol) return;
          n++;
          var at = 'tier ' + tier + ' ' + it.key, d = displayFor(a), html = bandHtml(a, d);
          if (d.pips || /bd-pips|class="pip/.test(html)) out.push(at + ': pips at the open');
          if (d.row1 !== 'Your turn' || [CARD_COPY.T2(a), CARD_COPY.T2(a, true)].indexOf(d.row2) < 0) out.push(at + ': opens as ' + d.row1 + ' / ' + d.row2);
          if (/[0-9]| of /.test(d.row1 + ' ' + d.chip)) out.push(at + ': a count at the open, ' + d.row1 + ' ' + d.chip);
          /* a relearn showing: its chip until the first move is found, then the pips */
          ui.session.keys = [it.key, it.key]; ui.session.idx = 1; ui.session.relearnOf[it.key] = 1;
          if (displayFor(a).chip !== 'One more try' || displayFor(a).pips) out.push(at + ': no relearn chip at the open');
          else relearn++;
          var want = Math.ceil(a.sol.length / 2);
          for (var k = 0; k < a.sol.length - 1; k += 2) {
            gradeMove(uciToMove(a.st, a.sol[k]));
            var rp = a.reply, mv = k / 2 + 1, d1 = displayFor(a), h1 = bandHtml(a, d1);
            if (!rp || a.phase !== 'reply') { out.push(at + ' move ' + mv + ': no reply but ' + a.phase); break; }
            if (!d1.pips || d1.pips.n !== want || d1.pips.done !== mv || d1.pips.cur !== -1) out.push(at + ' move ' + mv + ': pips ' + JSON.stringify(d1.pips));
            if (d1.chip || /bd-chip|class="tag /.test(h1)) out.push(at + ' move ' + mv + ': the chip stays beside the pips (in the tag row since F4.1)');
            if ((h1.match(/class="pip/g) || []).length !== want || (h1.match(/pip done/g) || []).length !== mv || / cur"/.test(h1) || !/aria-hidden="true"/.test(h1.slice(h1.indexOf('bd-pips'))))
              out.push(at + ' move ' + mv + ': drawn as ' + h1.slice(h1.indexOf('bd-pips')));
            theirReply(a, false); replyDone(a, rp);
            var d2 = displayFor(a), h2 = bandHtml(a, d2);
            if (!d2.pips || d2.pips.done !== mv || d2.pips.cur !== mv || (h2.match(/ cur"/g) || []).length !== 1 || d2.chip) out.push(at + ' move ' + mv + ', their reply landed: pips ' + JSON.stringify(d2.pips) + ' chip ' + d2.chip);
            steps++;
          }
          gradeMove(uciToMove(a.st, a.sol[a.sol.length - 1]));
          if (a.phase !== 'done' || displayFor(a).pips) out.push(at + ': the line solved: ' + a.phase + ' ' + JSON.stringify(displayFor(a).pips));
        });
      });
      return JSON.stringify({ out: out, n: n, steps: steps, relearn: relearn }); })()`));
    ok(r.n >= 10 && r.steps >= 20 && r.relearn === r.n, JSON.stringify({ n: r.n, steps: r.steps, relearn: r.relearn }));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 3).join(' | '));
  });

  await test('the forcing reply\'s timeline, exact on the fake clock: the tick as your move lands (0), the telegraph at 600, the slide from 1500 to 1900, the words at 2050', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(window.__snd = [], snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); }, 1)');
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 8);
    ok(keys.length >= 4, 'forcing cards ' + keys.length);
    const lead = A.ev('SLIDE_LEAD');
    let took = 0, checks = 0;
    for (const key of keys) for (const how of ['tap', 'drag']) {
      const at = key + ' ' + how;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      const t = A.getNow();
      A.ev('(window.__snd = [], 1)');
      eq(A.ev(FIRST(how)), 'reply', at + ': the move found, their reply to come');
      const info = JSON.parse(A.ev(REPLY_INFO));
      const t0 = t + (how === 'tap' ? lead + 220 : 0);
      A.advance(t0 + 2040 - A.getNow());
      const s1 = JSON.parse(A.ev(STATE));
      eq(s1.phase, 'reply', at + ': still their reply at 2040');
      eq(A.ev('flushStage()'), true, at + ': input waits at 2040');
      A.advance(20);
      eq(A.ev('ui.session.active.phase'), 'guess', at + ': your move at 2050');
      run(500);
      const ws = WR(A, t), dt = (w) => w.t - t0;
      const boards = ws.filter((w) => w.id === 'bwrap'), marks = ws.filter((w) => w.id === 'marks'), bands = ws.filter((w) => w.id === 'cband'), bars = ws.filter((w) => w.id === 'cbar');
      /* your move: it slides with no tick (tapped), then the tick lands at 0 */
      const mine = boards.filter((w) => /slide/.test(w.v))[0];
      if (how === 'tap') ok(mine && dt(mine) === -(lead + 220) && !/tick|slow/.test(mine.v), at + ': your move slides first, ' + JSON.stringify(boards));
      const tick = boards.filter((w) => /tick/.test(w.v))[0];
      ok(tick && dt(tick) === 0 && !/slide/.test(tick.v), at + ': the tick lands at 0, ' + JSON.stringify(boards.map((w) => [dt(w), w.v])));
      /* the words at 150 (2.2's gap after the landing): Right, F2, the pips; the bar switched off */
      ok(bands[0] && dt(bands[0]) === 150 && R1(bands[0].v) === 'Right' && R2(bands[0].v) === info.opp + ' replies next.', at + ': Right at 150, ' + JSON.stringify(bands[0] && [dt(bands[0]), R1(bands[0].v), R2(bands[0].v)]));
      ok(/bd-pips/.test(bands[0].v) && (bands[0].v.match(/pip done/g) || []).length === 1 && !/ cur"/.test(bands[0].v), at + ': the pips appear, none current');
      ok(bars[0] && dt(bars[0]) === 150 && (bars[0].v.match(/btn-off/g) || []).length === 2 && !/data-act/.test(bars[0].v), at + ': the bar off, ' + JSON.stringify(bars[0]));
      /* nothing written between the words and 2050, but the telegraph and the slide */
      eq(ws.filter((w) => (w.id === 'cband' || w.id === 'cbar') && dt(w) > 150 && dt(w) < 2050).length, 0, at + ': words written while their reply plays');
      eq(boards.filter((w) => dt(w) > 0 && dt(w) < 1450).length, 0, at + ': a board before the slide');
      const tele = marks.filter((w) => /rring/.test(w.v))[0];
      ok(tele && dt(tele) === 600 && /rdash/.test(tele.v) && /tick/.test(tele.v) && !/rsolid/.test(tele.v), at + ': the telegraph at 600, ' + JSON.stringify(marks.map((w) => [dt(w), w.v])));
      /* the slide: drawn at 1450, let go two frames later at 1500, landed at 1900 */
      const slide = boards.filter((w) => /slow/.test(w.v))[0];
      ok(slide && dt(slide) === 1500 - lead && /rring/.test(slide.v) && /rdash/.test(slide.v) && !/tick|glow|token/.test(slide.v), at + ': the slide drawn at 1450, telegraph kept, ' + JSON.stringify(boards.map((w) => [dt(w), w.v])));
      const land = boards.filter((w) => w.t > slide.t)[0];
      ok(land && dt(land) === 1900 && /rsolid/.test(land.v) && !/rring|rdash|slide/.test(land.v), at + ': landed at 1900, the arrow solid, ' + JSON.stringify(land && [dt(land), land.v]));
      eq(/token/.test(land.v), info.took, at + ': a token for what it took');
      eq(/glow/.test(land.v), info.check, at + ': the check glows as it lands');
      took += info.took ? 1 : 0; checks += info.check ? 1 : 0;
      eq(boards.filter((w) => w.t > land.t).length, 0, at + ': the board after the landing');
      /* the words at 2050: Your move, F4, the move due ringed; the bar on */
      const b2 = bands.filter((w) => dt(w) >= 2050)[0], bar2 = bars.filter((w) => dt(w) >= 2050)[0];
      ok(b2 && dt(b2) === 2050 && R1(b2.v) === 'Your move' && R2(b2.v) === info.want, at + ': Your move at 2050, ' + JSON.stringify(b2 && [dt(b2), R1(b2.v), R2(b2.v)]) + ' want ' + info.want);
      ok(/ cur"/.test(b2.v) && /k-neutral/.test(b2.v) && /d-king/.test(b2.v), at + ': the neutral band, king disc, the next pip current');
      /* F4 by what the reply did on the board: what it took first, else the check, else the move */
      ok((info.took ? / took your (pawn|knight|bishop|rook|queen), as expected\.$/ : info.check ? / gives check, as expected\.$/ : / played [^ ]+, as expected\.$/).test(R2(b2.v)) && R2(b2.v).indexOf(info.opp + ' ') === 0, at + ': F4 says what the reply did, ' + R2(b2.v));
      ok(bar2 && dt(bar2) === 2050 && !/btn-off/.test(bar2.v) && /data-act="hint"/.test(bar2.v) && /data-act="reveal"/.test(bar2.v), at + ': the bar on at 2050, ' + JSON.stringify(bar2));
      /* the sounds: good with the tick, move with the slide's board (these stubs have no piece to let go; with
         one it sounds as the piece is let go, "a move the app shows slides 320 ms ...") */
      const snd = JSON.parse(A.ev('JSON.stringify(window.__snd)')).map((x) => x.n + '@' + (x.t - t0));
      ok(snd.indexOf('good@0') >= 0 && snd.indexOf('move@' + (1500 - lead)) >= 0, at + ': sounds ' + snd.join(' '));
    }
    ok(took >= 2 && checks >= 1, 'replies that take ' + took + ', that check ' + checks);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('a tap during the reply never jumps the piece, and no text lands during the slide: before 1500 an input starts it (telegraph kept) and is dropped; during the slide input changes nothing (a tap on a piece of yours is kept for the landing); landed, the board takes input again, the rest waits for the words', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 6);
    const lead = A.ev('SLIDE_LEAD');
    /* every input the page takes, each through its own handler: a finger on one of your pieces, a bar
       button, ?, Enter, an arrow, Esc, a typed move (the next move of the line) */
    const own = () => A.ev(`(function (a) { for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === myPov(a.it)) return s; return -1; })(ui.session.active)`);
    const INPUTS = {
      finger: () => A.tap(own()),
      tap: () => A.ev(`(sessionClick(${own()}), 1)`),
      hint: () => A.click('hint', null, 0),
      reveal: () => A.click('reveal', null, 1),
      q: () => A.key('?'),
      enter: () => A.key('Enter'),
      arrow: () => A.key('ArrowRight'),
      esc: () => A.key('Escape'),
      typed: () => A.ev('(typedMove(ui.session.active.sol[2]), 1)')
    };
    const names = Object.keys(INPUTS);
    let n = 0, nq = 0;
    for (const key of keys) for (const when of [-150, 300, 1000]) {
      const name = names[n++ % names.length], at = key + ' ' + name + ' at ' + when;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      const t0 = A.getNow() + lead + 220;
      A.advance(t0 + when - A.getNow());
      if (when >= 600) ok(A.ev('ui.session.active.reply.tele'), at + ': the telegraph is up');
      const tin = A.getNow();
      INPUTS[name]();
      const s = JSON.parse(A.ev(STATE));
      /* the slide starts at the input, in full, its telegraph riding along */
      ok(s.reply && s.reply.played && s.solIdx === 2 && s.phase === 'reply', at + ': their reply started, ' + JSON.stringify(s));
      eq(s.mu, tin + lead + 400, at + ': it slides 400 ms from the input');
      ok(s.hold, at + ': held');
      eq(s.sel + ' ' + s.hints + ' ' + s.result, '-1 0 null', at + ': the input was passed on');
      const ws = WR(A, tin), lastBoard = ws.filter((w) => w.id === 'bwrap').pop();
      ok(lastBoard && lastBoard.t === tin && /slow/.test(lastBoard.v) && /rring/.test(lastBoard.v) && /rdash/.test(lastBoard.v), at + ': drawn at the input with its telegraph, ' + JSON.stringify(ws));
      /* during the slide: every input changes nothing */
      A.advance(120);
      names.forEach((k) => INPUTS[k]());
      const s2 = JSON.parse(A.ev(STATE));
      eq(JSON.stringify([s2.mu, s2.sel, s2.hints, s2.solIdx, s2.phase, s2.result]), JSON.stringify([s.mu, -1, 0, 2, 'reply', null]), at + ': input during the slide');
      eq(WR(A, tin + 1).filter((w) => w.id === 'bwrap' || w.id === 'marks').length, 0, at + ': the board written during the slide');
      /* a tap on a piece of yours during the reply was kept (round D): it is picked up as the reply
         lands, if it still stands there with a move to make */
      const want = A.ev(`(function (a) { var q = a.replyQ; return q && a.st.b[q.sq] === q.p && legalMoves(a.st).some(function (m) { return m.from === q.sq; }) ? q.sq : -1; })(ui.session.active)`);
      /* landed, before its words: every input but the board's changes nothing */
      A.advance(s.mu + 60 - A.getNow());
      names.filter((k) => k !== 'finger' && k !== 'tap').forEach((k) => INPUTS[k]());
      const s3 = JSON.parse(A.ev(STATE));
      eq(JSON.stringify([s3.sel, s3.hints, s3.solIdx, s3.phase, s3.result]), JSON.stringify([want, 0, 2, 'reply', null]), at + ': input after the landing, before its words');
      if (want >= 0) {
        nq++;
        const lastB = WR(A, s.mu - 1).filter((w) => w.id === 'bwrap').pop();
        ok(lastB && lastB.t === s.mu && A.ev('(boardOptsFor(ui.session.active).opts.dots || []).length') > 0, at + ': the kept piece picked up at the landing, its dots drawn, ' + JSON.stringify(lastB));
      }
      if (n % 2) {
        /* the words 150 ms after the landing, none before them since the input */
        A.advance(s.mu + 200 - A.getNow());
        const words = WR(A, tin).filter((w) => w.id === 'cband');
        ok(words.length >= 1 && words[0].t === s.mu + 150 && R1(words[0].v) === 'Your move', at + ': the words at landing + 150, ' + JSON.stringify(words.map((w) => [w.t - s.mu, R1(w.v)])));
        eq(A.ev('ui.session.active.phase'), 'guess', at + ': then your move');
      } else {
        /* the board takes input again from the landing (round D): a tap picks a piece up at once,
           and the words come 150 ms after it, never with it */
        const tt = A.getNow();
        A.ev(`(function (a) { a.sel = -1; for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) === myPov(a.it) && legalMoves(a.st).some(function (m) { return m.from === q; })) { sessionClick(q); return 1; } return 0; })(ui.session.active)`);
        eq(A.ev('ui.session.active.phase'), 'guess', at + ': a tap after the landing is your move');
        ok(A.ev('ui.session.active.sel') >= 0, at + ': a piece picked up after the landing, before the words');
        A.advance(200);
        const words = WR(A, tin).filter((w) => w.id === 'cband'), b2 = WR(A, tt).filter((w) => w.id === 'bwrap');
        ok(words.length >= 1 && words[0].t === tt + 150 && R1(words[0].v) === 'Your move', at + ': the words 150 ms after the tap, ' + JSON.stringify(words.map((w) => [w.t - tt, R1(w.v)])));
        ok(b2.length && b2.every((w) => w.t < words[0].t), at + ': the board before the words');
      }
      /* and the board takes moves again */
      A.ev('(ui.session.active.sel = -1, 1)');
      INPUTS.tap();
      ok(A.ev('ui.session.active.sel') >= 0, at + ': the board takes input after the words');
      run(600);
    }
    ok(nq >= 2, 'kept pieces picked up at the landing: ' + nq);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('reduced motion: no reply without a tap; "Their reply" plays it at once, its words 300 ms later (a line being solved, and a line shown)', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(playerTier = function () { return 2; }, ui.reducedTest = true, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 5);
    const own = () => A.ev(`(function (a) { for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === myPov(a.it)) return s; return -1; })(ui.session.active)`);
    const theirs = () => A.ev(`(function (a) { for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) !== myPov(a.it)) return s; return -1; })(ui.session.active)`);
    for (const [i, key] of keys.entries()) {
      const at = key;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      const t = A.getNow();
      eq(A.ev(FIRST('tap')), 'reply', at + ': the move found');
      const info = JSON.parse(A.ev(REPLY_INFO));
      run(200);
      let ws = WR(A, t);
      /* the piece picked up, then the move: the tick and the telegraph in one board, at once */
      const b0 = ws.filter((w) => w.id === 'bwrap');
      ok(b0.length === 2 && b0[1].t === t && !/slide/.test(b0[1].v) && /tick/.test(b0[1].v) && /rring/.test(b0[1].v) && /rdash/.test(b0[1].v), at + ': the tick and the telegraph at once, ' + JSON.stringify(b0));
      const bar0 = ws.filter((w) => w.id === 'cbar')[0];
      ok(bar0 && bar0.t === t + 150 && /class="slot-empty" data-slot="0"/.test(bar0.v) && /data-act="theirReply"[^>]*>Their reply</.test(bar0.v) && /btn-big/.test(bar0.v), at + ': the bar, ' + JSON.stringify(bar0));
      eq(R1(ws.filter((w) => w.id === 'cband')[0].v), 'Right', at + ': Right');
      /* a minute: no timer plays it, and no other input does */
      run(3000);
      A.tap(own()); A.ev(`(sessionClick(${theirs()}), 1)`); A.key('?'); A.key('ArrowRight'); A.click('hint', null, 0); A.click('reveal', null, 1);
      A.advance(57000);
      const s = JSON.parse(A.ev(STATE));
      eq(JSON.stringify([s.phase, s.solIdx, s.reply && s.reply.played, s.result, s.hints]), JSON.stringify(['reply', 1, false, null, 0]), at + ': after a minute');
      eq(WR(A, t + 1).filter((w) => w.id === 'bwrap' && /rsolid|slow/.test(w.v)).length, 0, at + ': no board of the reply without its tap');
      /* its button, clicked or by Enter: the reply at once, with no slide; its words 300 ms later */
      const tp = A.getNow();
      if (i % 2) A.click('theirReply', null, 1); else A.key('Enter');
      ws = WR(A, tp);
      const b1 = ws.filter((w) => w.id === 'bwrap').pop();
      ok(b1 && b1.t === tp && !/slide|slow|rring|rdash/.test(b1.v) && /rsolid/.test(b1.v), at + ': the reply landed at the tap, ' + JSON.stringify(b1));
      eq(/token/.test(b1.v), info.took, at + ': its token');
      eq(/glow/.test(b1.v), info.check, at + ': its check');
      eq(A.ev('ui.session.active.solIdx'), 2, at + ': played once');
      A.advance(290);
      eq(WR(A, tp).filter((w) => w.id === 'cband').length, 0, at + ': no words before 300 ms');
      eq(A.ev('ui.session.active.phase'), 'reply', at + ': the board waits for the words');
      A.advance(20);
      const w2 = WR(A, tp).filter((w) => w.id === 'cband')[0];
      ok(w2 && w2.t === tp + 300 && R1(w2.v) === 'Your move' && R2(w2.v) === info.want, at + ': the words 300 ms later, ' + JSON.stringify(w2 && [w2.t - tp, R1(w2.v), R2(w2.v)]));
      eq(A.ev('ui.session.active.phase'), 'guess', at + ': your move');
      ok(/^cband task-h$/.test(A.ev(`(function () { var e = document.activeElement; return e ? e.host + ' ' + e.id : 'none'; })()`)), at + ': the keyboard on "Your move"');
    }
    /* a line shown (S7): Play it, then their reply waits for its button, Continue beside it */
    A.ev(`(window.__show(model().byKey['${keys[0]}']), 1)`);
    run(1000);
    A.click('reveal', null, 1); run(600);
    A.click('playIt', null, 1); run(600);
    const bar = WR(A, A.getNow() - 600).filter((w) => w.id === 'cbar').pop();
    ok(bar && /data-act="next"/.test(bar.v) && /data-act="theirReply"[^>]*>Their reply</.test(bar.v), 'shown: [Continue] [Their reply], ' + JSON.stringify(bar));
    const idx = A.ev('ui.session.active.solIdx');
    A.advance(60000);
    eq(A.ev('ui.session.active.solIdx'), idx, 'shown: no reply without its tap');
    const tp = A.getNow();
    A.click('theirReply', null, 1);
    eq(A.ev('ui.session.active.solIdx'), idx + 1, 'shown: played at the tap');
    A.advance(310);
    const w3 = WR(A, tp).filter((w) => w.id === 'cband')[0], bar3 = WR(A, tp).filter((w) => w.id === 'cbar')[0];
    ok(w3 && w3.t === tp + 300 && /^The answer: /.test(R1(w3.v)), 'shown: the next answer named 300 ms later, ' + JSON.stringify(w3 && [w3.t - tp, R1(w3.v)]));
    ok(bar3 && /data-act="playIt"/.test(bar3.v), 'shown: Play it back, ' + JSON.stringify(bar3));
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  /* a session of two cards: the forcing card key, then a one-move card; the first shown as the page shows it */
  /* (same: the next card is the same one again, as a relearn showing is) */
  const TWO = (key, same) => `(function () { var its = [model().byKey['${key}'], ${same ? `model().byKey['${key}']` : `allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return x.key !== '${key}' && c && !c.sol; })[0]`}];
    its.forEach(function (x) { x.b.v = Math.max(x.b.v || 0, 2); });
    ui.session = { mode: 't', label: 't', keys: its.map(function (x) { return x.key; }), idx: 0, results: {}, relearn: [], relearnOf: ${same ? `{ '${key}': 1 }` : '{}'}, notes: {} };
    loadCard(); return its[1].key; })()`;
  const OWN = `(function (a) { for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === myPov(a.it)) return s; return -1; })(ui.session.active)`;

  await test('a line shown: Continue ends the card at any point of their reply (pending, telegraphed, sliding, landed), and nothing of it reaches the next card', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, notice = function () {}, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 4);
    const lead = A.ev('SLIDE_LEAD');
    let n = 0;
    for (const key of keys) for (const [when, dt, same] of [['pending', 300], ['telegraphed', 1000], ['sliding', 1600], ['landed', 1960], ['sliding, the same card next', 1600, true]]) {
      const at = key + ' ' + when;
      const next = A.ev(TWO(key, same));
      run(1000);
      A.click('reveal', null, 1); run(600);
      /* Play it: the answer slides after its fade (100) in 320 ms; their reply's timeline runs from that landing */
      A.click('playIt', null, 1);
      const t1 = A.getNow() + 100 + lead + 320;
      A.advance(t1 + dt - A.getNow());
      const s = JSON.parse(A.ev(STATE));
      ok(s.reply && s.phase === 'done' && s.reply.played === (dt > 1500) && s.reply.tele === (dt > 600) && s.hold === (dt === 1600), at + ': their reply ' + when + ', ' + JSON.stringify(s));
      const tc = A.getNow();
      A.click('next', null, 0);
      eq(A.ev('ui.session.idx + " " + ui.session.active.key'), '1 ' + next, at + ': Continue ended the card at once');
      const s2 = JSON.parse(A.ev(STATE));
      ok(!s2.reply && !s2.hold && s2.mu <= tc && s2.phase === 'guess' && s2.solIdx === 0, at + ': the next card, nothing held, ' + JSON.stringify(s2));
      const fen = A.ev('stateFen(ui.session.active.st)');
      /* the next card takes a move at once */
      A.ev(`(sessionClick(${OWN}), 1)`);
      ok(A.ev('ui.session.active.sel') >= 0, at + ': a piece picked up on the next card at once');
      A.ev('(ui.session.active.sel = -1, renderCardBoard(), 1)');
      /* no timer of the old reply touches it */
      run(4000);
      eq(A.ev('ui.session.active.key + " " + stateFen(ui.session.active.st) + " " + ui.session.active.phase + " " + !!ui.session.active.reply'), next + ' ' + fen + ' guess false', at + ': the next card as it was, 4 s later');
      const ws = WR(A, tc).filter((w) => (w.id === 'bwrap' || w.id === 'marks') && /slow|rring|rdash|rsolid/.test(w.v));
      eq(ws.length, 0, at + ': the old reply drawn on the next card, ' + JSON.stringify(ws));
      eq(A.ev('motionHold'), false, at + ': no hold left');
      n++;
    }
    ok(n >= 12, 'cases ' + n);
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('× and ••• during their reply (phase reply) work at once: × and the menu\'s Skip leave the reply behind; ••• opens with the reply neither started nor skipped (drawn 150 ms after a moving piece lands), and Esc closes it', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, notice = function () {}, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 4);
    const lead = A.ev('SLIDE_LEAD');
    const TOP = (t) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.id === 'ctop' && w.what === 'innerHTML' && w.t >= ${t}; }).map(function (w) { return w.t; }))`));
    for (const key of keys) for (const [when, dt] of [['pending', 300], ['telegraphed', 1000], ['sliding', 1600], ['landed', 1960]]) {
      for (const way of ['end', 'skip', 'menu']) {
        const at = key + ' ' + way + ' ' + when;
        const next = A.ev(TWO(key));
        run(1000);
        A.ev(FIRST('tap'));
        const t0 = A.getNow() + lead + 220;
        A.advance(t0 + dt - A.getNow());
        const s = JSON.parse(A.ev(STATE));
        ok(s.phase === 'reply' && s.reply && s.reply.played === (dt > 1500) && s.hold === (when === 'sliding'), at + ': their reply ' + when + ', ' + JSON.stringify(s));
        const tc = A.getNow();
        if (way === 'end') {
          A.click('endSession');
          eq(A.ev('ui.session === null'), true, at + ': the session ended at once');
          run(4000);
          eq(WR(A, tc).filter((w) => w.id === 'bwrap' || w.id === 'marks' || w.id === 'cband').length, 0, at + ': nothing of the card drawn after');
          continue;
        }
        if (way === 'skip') {
          A.ev('(ui.session.active.menuOpen = true, 1)');
          A.click('skip');
          eq(A.ev('ui.session.idx + " " + ui.session.active.key + " " + !!ui.session.active.reply'), '1 ' + next + ' false', at + ': Skip left the card at once');
          run(4000);
          eq(WR(A, tc).filter((w) => (w.id === 'bwrap' || w.id === 'marks') && /slow|rring|rdash|rsolid/.test(w.v)).length, 0, at + ': the old reply drawn on the next card');
          continue;
        }
        A.click('menu');
        const s2 = JSON.parse(A.ev(STATE));
        eq(JSON.stringify([s2.phase, s2.solIdx, s2.reply && s2.reply.played, s2.mu, s2.hold]), JSON.stringify([s.phase, s.solIdx, s.reply.played, s.mu, s.hold]), at + ': the menu neither starts nor skips the reply');
        eq(A.ev('ui.session.active.menuOpen'), true, at + ': the menu is open');
        /* drawn at once, unless a piece is moving or just landed: then 150 ms after it lands (with the reply's words) */
        const want = dt > 1500 ? s.mu + 150 : tc;
        A.advance(want + 1 - A.getNow());
        const tops = TOP(tc);
        ok(tops.length >= 1 && tops[0] === want, at + ': the menu drawn at ' + (tops[0] - tc) + ', want ' + (want - tc));
        ok(/menu-pop/.test(A.ev('window.__els.ctop.innerHTML')), at + ': its items on the page');
        /* the reply runs on underneath, on its own timeline */
        A.advance(t0 + 2060 - A.getNow());
        eq(A.ev('ui.session.active.phase + " " + ui.session.active.solIdx'), 'guess 2', at + ': the reply played on its timeline, your move at 2050');
        ok(/menu-pop/.test(A.ev('window.__els.ctop.innerHTML')), at + ': the menu still open');
        /* the menu draws no board: the only boards are the reply's own, its slide and its landing */
        const other = WR(A, tc).filter((w) => w.id === 'bwrap' && w.t !== t0 + 1500 - lead && w.t !== t0 + 1900);
        eq(other.length, 0, at + ': a board drawn for the menu, ' + JSON.stringify(other.map((w) => [w.t - t0, w.v])));
        const bs = WR(A, tc).filter((w) => w.id === 'bwrap' && /slow/.test(w.v));
        if (dt < 1500) ok(bs.length === 1 && bs[0].t === t0 + 1500 - lead, at + ': the slide on time, ' + JSON.stringify(bs.map((w) => w.t - t0)));
        /* Esc closes it (during a reply: the next card's line is not needed, open it again before the reply) */
        A.key('Escape');
        eq(A.ev('!!ui.session.active.menuOpen'), false, at + ': Esc closes the menu');
      }
    }
    /* Esc with the menu open during the reply closes the menu and starts nothing */
    A.ev(TWO(keys[0]));
    run(1000);
    A.ev(FIRST('tap'));
    A.advance(lead + 220 + 1000);
    A.click('menu');
    A.key('Escape');
    const s3 = JSON.parse(A.ev(STATE));
    ok(!A.ev('!!ui.session.active.menuOpen') && s3.reply && !s3.reply.played && s3.solIdx === 1, 'Esc on the menu during the reply: closed, the reply not started, ' + JSON.stringify(s3));
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('a move the app shows slides 320 ms (anim-show; the forcing reply anim-slow, your own move neither), and its move sound plays as the piece is let go, never with a board already gone', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, notice = function () {}, 1)');
    /* the browser's two frames before a piece is let go, SLIDE_LEAD in all; the board's sliding piece as a node */
    A.ev(`(function () { var bw = window.__els.bwrap;
      requestAnimationFrame = function (f) { setTimeout(f, SLIDE_LEAD / 2); };
      bw.querySelectorAll = function (sel) { var h = bw.innerHTML; return sel === '.anim-piece' && /anim-piece/.test(h) ? [{ style: {}, get isConnected() { return bw.innerHTML === h; } }] : []; };
      window.__snd = []; snd = function (n) { window.__snd.push({ n: n, t: Date.now() }); };
      return 1; })()`);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const lead = A.ev('SLIDE_LEAD');
    const SND = (t) => JSON.parse(A.ev(`JSON.stringify(window.__snd.filter(function (x) { return x.t >= ${t} && x.n === 'move'; }).map(function (x) { return x.t - ${t}; }))`));
    const HTML = () => A.ev('window.__els.bwrap.innerHTML');
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 3);
    for (const key of keys) {
      /* the forcing reply: drawn at 1450, let go and sounding at 1500 */
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev('(window.__snd = [], 1)');
      const t = A.getNow();
      A.ev(FIRST('tap'));
      ok(/class="anim-piece"/.test(HTML()), key + ': your own move slides at 220 ms (no class of its own)');
      const t0 = t + lead + 220;
      A.advance(t0 + 1460 - A.getNow());
      ok(/anim-piece anim-slow/.test(HTML()) && !/anim-show/.test(HTML()), key + ': the reply slides slow');
      eq(JSON.stringify(SND(t0)), '[]', key + ': no move sound before the piece is let go');
      A.advance(t0 + 1600 - A.getNow());
      eq(JSON.stringify(SND(t0)), JSON.stringify([1500]), key + ': the move sound as the reply is let go, 1500');
      /* a line shown: Play it slides 320 ms with its sound as it is let go, and so does their reply after it */
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.click('reveal', null, 1); run(600);
      const tp = A.getNow();
      A.click('playIt', null, 1);
      A.advance(100);
      ok(/anim-piece anim-show/.test(HTML()), key + ': Play it slides 320 ms');
      eq(A.ev('motionUntil') - A.getNow(), lead + 320, key + ': motionUntil counts the 320');
      A.advance(lead + 10);
      eq(JSON.stringify(SND(tp)), JSON.stringify([100 + lead]), key + ': its sound as it is let go');
      run(3000);
    }
    /* a one-move card: Play it, then Continue before its piece is let go: no sound */
    const one = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; }).slice(0, 2).map(function (it) { return it.key; }))`));
    A.ev(TWO(one[0]).replace(`var c = cardFor(x); return x.key !== '${one[0]}' && c && !c.sol;`, `return x.key === '${one[1]}';`));
    run(1000);
    A.click('reveal', null, 1); run(600);
    const tq = A.getNow();
    A.click('playIt', null, 1);
    A.advance(100 + lead / 2);
    ok(/anim-show/.test(HTML()), 'one move: Play it drawn');
    A.click('next', null, 0);
    run(500);
    eq(JSON.stringify(SND(tq)), '[]', 'one move: no sound for a board gone before its piece was let go');
    /* the story: each ply slides 320 ms and sounds as it is let go */
    A.ev(`(function () { window.__show(model().byKey['${one[0]}']); ui.session.keys.push('x'); return 1; })()`);
    run(1000);
    A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
    run(2500);
    A.key('ArrowRight'); run(1700);
    const ts = A.getNow();
    A.key('ArrowRight');
    run(1200);
    const sw = SND(ts);
    const story = JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.id === 'bwrap' && w.t >= ${ts} && /slide/.test(w.v); }).map(function (w) { return w.t - ${ts}; }))`));
    ok(story.length >= 1 && A.ev('ui.session.active.view.mode') === 'story', 'the story stepped, slides at ' + JSON.stringify(story));
    eq(JSON.stringify(sw), JSON.stringify(story.map((x) => x + lead)), 'the story\'s move sounds as each piece is let go');
  });

  await test('a tab in the background holds their reply, telegraphed, until it is seen again: then it slides, and its words and pips follow', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 4);
    const lead = A.ev('SLIDE_LEAD');
    for (const key of keys) {
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      const info = JSON.parse(A.ev(REPLY_INFO));
      const t0 = A.getNow() + lead + 220;
      A.advance(t0 + 1000 - A.getNow());
      A.ev('(document.hidden = true, 1)');
      A.fire('visibilitychange');
      A.advance(t0 + 30000 - A.getNow());
      /* an event while still hidden plays nothing */
      A.fire('visibilitychange');
      A.advance(t0 + 60000 - A.getNow());
      const s = JSON.parse(A.ev(STATE));
      eq(JSON.stringify([s.phase, s.solIdx, s.reply && s.reply.played, s.reply && s.reply.tele, s.hold]), JSON.stringify(['reply', 1, false, true, false]), key + ': held while hidden');
      eq(WR(A, t0 + 1).filter((w) => w.id === 'bwrap').length, 0, key + ': no board while hidden (the piece never jumps)');
      eq(WR(A, t0 + 200).filter((w) => w.id === 'cband').length, 0, key + ': no words while hidden');
      A.ev('(document.hidden = false, 1)');
      const tv = A.getNow();
      A.fire('visibilitychange');
      const s2 = JSON.parse(A.ev(STATE));
      ok(s2.reply && s2.reply.played && s2.hold && s2.mu === tv + lead + 400, key + ': seen again, it slides at once, ' + JSON.stringify(s2));
      const b = WR(A, tv).filter((w) => w.id === 'bwrap')[0];
      ok(b && b.t === tv && /slow/.test(b.v) && /rring/.test(b.v), key + ': the slide drawn with its telegraph, ' + JSON.stringify(b));
      A.advance(lead + 400 + 160);
      const w = WR(A, tv).filter((x) => x.id === 'cband')[0];
      ok(w && w.t === tv + lead + 400 + 150 && R1(w.v) === 'Your move' && R2(w.v) === info.want && / cur"/.test(w.v), key + ': the words and the pip 150 ms after it lands, ' + JSON.stringify(w && [w.t - tv, R1(w.v), R2(w.v)]));
      eq(A.ev('ui.session.active.phase'), 'guess', key + ': your move');
      /* hidden and back before it is due: on its own timeline */
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      const t1 = A.getNow() + lead + 220;
      A.advance(700); A.ev('(document.hidden = true, 1)'); A.fire('visibilitychange');
      A.advance(300); A.ev('(document.hidden = false, 1)'); A.fire('visibilitychange');
      A.advance(t1 + 1600 - A.getNow());
      const sl = WR(A, t1).filter((x) => x.id === 'bwrap' && /slow/.test(x.v))[0];
      ok(sl && sl.t === t1 + 1500 - lead, key + ': back before it was due, the slide on time, ' + JSON.stringify(sl && sl.t - t1));
      run(1000);
    }
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('mid-line: a stored move is S10 again; a move as good ends the card as found (V1.6: "Found it", the line graded by its first move); any other is a miss, whose See it plays their best reply and whose Try again comes back to the line', async () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const keys = JSON.parse(A.ev(FORCING));
    /* at the line's second move of yours: the first found, their reply played and its words said */
    const MID = (key) => `(function () { ${OPEN} ${AFTER} var a = openCard(model().byKey['${key}']); gradeMove(uciToMove(a.st, a.sol[0]));
      var rp = a.reply; theirReply(a, false); replyDone(a, rp); a.animMove = null; window.__off = offBook(a); window.__fen0 = stateFen(a.st); window.readyEngine();
      return a.phase + ' ' + a.solIdx; })()`;
    let misses = 0, alts = 0, again = 0;
    for (const key of keys) {
      eq(A.ev(MID(key)), 'guess 2', key + ': at the second move');
      /* a stored move: S10 again */
      A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[2])); return 1; })(ui.session.active)');
      if (A.ev('ui.session.active.sol.length') > 3) {
        eq(A.ev('ui.session.active.phase + " " + displayFor(ui.session.active).row1 + " " + !!ui.session.active.reply'), 'reply Right true', key + ': the next stored move is S10 again');
        again++;
      } else eq(A.ev('ui.session.active.phase'), 'done', key + ': the last stored move solves it');
      /* any other move: a miss (never a close verdict), with the engine's own reply */
      A.ev(MID(key));
      if (!A.ev('window.__off')) continue;
      A.ev('(window.__tryCp = null, window.__bestCp = null, gradeMove(window.__off), 1)');
      await tick(); await tick();
      const m = JSON.parse(A.ev(`JSON.stringify((function (a) { var job = window.__evals[window.__evals.length - 1];
        return { phase: a.phase, kind: a.tried && a.tried.kind, reply: a.tried && a.tried.reply, best: job.answer && job.answer.pv[1], misses: a.misses }; })(ui.session.active))`));
      eq(m.phase + ' ' + m.kind + ' ' + m.misses, 'tried miss 1', key + ': a miss');
      eq(m.reply, m.best, key + ': See it is their best reply');
      const seen = JSON.parse(A.ev(`JSON.stringify((function (a) { var st = stateFromFen(window.__fen0), off = uciToMove(st, a.tried.uci); applyMove(st, off);
        var r = uciToMove(st, a.tried.reply); if (r) applyMove(st, r); seeIt(); a.animMove = null; return { got: stateFen(triedFrame(a).st), want: stateFen(st), last: triedFrame(a).last, r: r ? [r.from, r.to] : null }; })(ui.session.active))`));
      eq(seen.got, seen.want, key + ': See it plays that one reply');
      eq(JSON.stringify(seen.last), JSON.stringify(seen.r), key + ': its last move');
      const back = JSON.parse(A.ev(`JSON.stringify((function (a) { tryAgain(); return { fen: stateFen(a.st), phase: a.phase, solIdx: a.solIdx, pips: displayFor(a).pips, r1: displayFor(a).row1 }; })(ui.session.active))`));
      eq(back.fen, A.ev('window.__fen0'), key + ': Try again comes back to the line');
      eq(back.phase + ' ' + back.solIdx + ' ' + back.r1, 'guess 2 Your move', key + ': asking for the same move');
      ok(back.pips && back.pips.cur === 1, key + ': the same pip current');
      misses++;
      /* the same move scored as good as the line's: the card ends there, found (V1.6) */
      if (A.ev('ui.session.active.it.b.mb != null && ui.session.active.it.b.mb > 0')) continue;
      A.ev(MID(key));
      A.ev('(function (a) { window.__tryCp = a.it.b.eb; window.__bestCp = a.it.b.eb; gradeMove(window.__off); return 1; })(ui.session.active)');
      await tick(); await tick();
      const e = JSON.parse(A.ev(`JSON.stringify((function (a) { var st = stateFromFen(window.__fen0); applyMove(st, window.__off);
        return { phase: a.phase, alt: !!a.alt, near: !!a.near, r1: displayFor(a).row1, at: a.yours && a.yours.at, fen: stateFen(a.st), want: stateFen(st), result: a.result, misses: a.misses }; })(ui.session.active))`));
      A.ev('(window.__tryCp = null, window.__bestCp = null, 1)');
      /* later in the line the step simply counts as found: neither works too nor the first move's found band */
      eq(e.phase + ' ' + e.alt + ' ' + e.near + ' ' + e.r1, 'done false false Found it', key + ': the card ends, found');
      eq(e.at, 2, key + ': your line from where you left it');
      eq(e.fen, e.want, key + ': S0 on your move');
      eq(e.result + ' ' + e.misses, 'first 0', key + ': graded as found');
      alts++;
    }
    ok(again >= 3 && misses >= 6 && alts >= 4, 'S10 again ' + again + ', misses ' + misses + ', as good ' + alts);
  });

  /* ── the story (S12) ── */
  /* the refutation as the story steps it to a mate: the stored line, kept to 21 plies, to its first checkmate */
  const MATE_AT = `function mateIdx(a) {
    var ref = buildLine(a.pre, a.playedUci, unpackUci(a.it.b.ru).slice(0, 20), !myPov(a.it));
    for (var k = 1; k < ref.nodes.length; k++) if (isMate(ref.nodes[k].after)) return { line: ref, k: k };
    return { line: ref, k: ref.nodes.length - 1 };
  }
  /* the game segment as fresh-eyes T4 and final fixes 1 have it: the
     refutation (to the loss, or to the mate) while the game really went
     that way; where they left it and the game's own moves still lost, those
     moves to where that loss stands (no later than the refutation's end);
     else the last move really played, or (their first reply missing a blow)
     one step more, the move they could have played */
  /* V2.2: with no mate, the game's line runs on to where it settles (the
     settle rule, 8 plies at most) when that is past the loss */
  function gameLoss(a) {
    var c = a.cls;
    if (c.mateAgainst) return c.lossAt;
    var s = settleLine(a.pre, [a.playedUci].concat(unpackUci(a.it.b.ru)));
    return Math.max(c.lossAt || 0, Math.min(s.k, 8) - 1);
  }
  /* V2.1: their reply missed a blow only where the game's series after it
     is 8 points or more above the score after the game move */
  function missedBlow(a) {
    var w = wpAt(a.it.g, a.it.b.p + 1);
    return w != null && a.it.b.wa != null && w >= a.it.b.wa + 8;
  }
  function gameEnd(a) {
    var c = a.cls, mi = c.mateAgainst ? mateIdx(a) : null, end = mi && isMate(mi.line.nodes[mi.k].after) ? mi : { line: c.gameLine, k: gameLoss(a) };
    var k0 = Math.min(end.k, end.line.nodes.length - 1), toks = a.it.g.mv.split(' '), st = cloneState(a.pre), real = [];
    for (var i = a.it.b.p; i < toks.length && real.length <= k0 + 2; i++) { var m = sanToMove(st, toks[i]); if (!m) break; real.push(moveUci(m)); applyMove(st, m); }
    for (var k = 1; k <= k0; k++) if (real[k] !== moveUci(end.line.nodes[k].move)) {
      var rl = k % 2 ? buildLine(a.pre, a.playedUci, real.slice(1), !myPov(a.it)) : null, rk = rl ? realLossIdx(a, rl, toks) : -1;
      if (rk >= 1 && rk <= k0) return { line: rl, k: rk, could: false, cut: true, real: real, realSeg: true };
      var could = k === 1 && real.length > 1 && (!!c.mateAgainst || c.lossG >= 1) && missedBlow(a);
      return { line: end.line, k: could ? 1 : k - 1, could: could, cut: true, real: real };
    }
    return { line: end.line, k: k0, could: false, cut: false, real: real };
  }
  /* the test's own reading of where the game's own loss stands: a mate
     against you; a count with no capture or check on it or in the next two
     plies (on the game's last move, none on it), lost by more than the best
     line loses and no more than 3 pawns over the score's drop unless lost
     anyway; or the game's last move, when the game ended on it having lost
     more than the best line. Never past your next flagged mistake */
  function realLossIdx(a, rl, toks) {
    var c = a.cls, it = a.it, pov = myPov(it), N = rl.nodes, last = N.length - 1, ended = it.b.p + last === toks.length - 1;
    var calm = function (x) { return !x || (!x.captured && !x.move.promo && !checkersOf(x.after).length); };
    var base = matDiff(N[0].before.b, pov), bl = bestLossFrom(a, 0), hz = last;
    var after = it.b.ea != null ? it.b.ea : it.b.ma != null ? (it.b.ma > 0 ? 1500 : -1500) : cpFromWin(it.b.wa), drop = (it.b.eb - after) / 100;
    (it.g.bl || []).forEach(function (b) { if (!b.x && b.p > it.b.p) hz = Math.min(hz, b.p - it.b.p - 1); });
    for (var k = 1; k <= hz; k++) {
      if (isMate(N[k].after)) return N[k].byWhite !== pov ? k : -1;
      if (!(c.lossG >= 1 || c.mateAgainst)) continue;
      var n = base - matDiff(N[k].after.b, pov), still = k === last ? calm(N[k]) : calm(N[k + 1]) && calm(N[k + 2]);
      if (n >= 1 && n > bl && still && (after <= -900 || n <= drop + 3)) return k;
      if (k === last && ended && n >= 1 && n > bl) return k;
    }
    return -1;
  }
  /* where a better line's steps end (fresh-eyes T12): never on their
     capture, but on your recapture just after it or before it, unless the
     line mates or its last step is S-same's */
  function trimEnd(a, line, from, end) {
    var pov = myPov(a.it), g1 = a.cls.gameLine.nodes[1], b2 = line.nodes[2];
    if (line === a.cls.bestLine && end === 2 && g1 && b2 && sameMove([b2.move.from, b2.move.to], [g1.move.from, g1.move.to])) return end;
    if (isMate(line.nodes[end].after)) return end;
    for (var g = 0; g < 4 && end > from; g++) {
      var nd = line.nodes[end], nx = line.nodes[end + 1];
      if (!nd.captured || isW(nd.captured) !== pov) break;
      end = nx && nx.captured && isW(nx.captured) !== pov ? end + 1 : end - 1;
    }
    /* nor on a quiet move or check of theirs with nothing to claim
       where the line stands there (a gain, less lost than the game's claimed
       loss, or nothing lost for good after a game move that lost something) */
    var c = a.cls, base = matDiff(line.nodes[from].before.b, pov);
    var says = function (k) {
      if (!settledAt(line, k)) return false;
      var gain = matDiff(line.nodes[k].after.b, pov) - base;
      if (gain !== 0) return gain >= 1 || (!!buildCompare(a).w && -gain < c.lossG);
      return (c.lossG >= 1 || !!c.mateAgainst) && !line.nodes.some(function (y, j) { return j > k && settledAt(line, j) && matDiff(y.after.b, pov) < base; });
    };
    while (end > from && !!line.nodes[end].byWhite !== pov && !line.nodes[end].captured && !isMate(line.nodes[end].after) && !says(end)) end--;
    return end;
  }
  function answered(a, how) {
    if (how === 'shown') { reveal(); a.view = { mode: 's0' }; a.settle = 2; return a; }
    if (a.sol) { while (a.solIdx < a.sol.length) { var m = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, m); a.lastMove = [m.from, m.to]; a.solIdx++; } finishCard('first'); }
    else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
    a.settle = 2;
    return a;
  }`;
  await test('the game segment is the game: G1 is the game move, then the refutation ply by ply to the loss (to the mate when it mates) while the game went that way, never an engine move as the game (fresh-eyes T4)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      var out = [], n = { cards: 0, long: 0, mates: 0, mateLong: 0, cut: 0, could: 0, whole: 0 };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          ['solved', 'shown'].forEach(function (how) {
            var a0 = openCard(it);
            if (!a0) return;
            var a = answered(a0, how), c = a.cls, S = buildStory(a), at = 'tier ' + tier + ' ' + it.key + ' ' + how;
            /* the game's own steps, after the danger frame when there is one (F1.5) */
            var d0 = S.danger ? 1 : 0, G = S.steps.slice(d0, S.g), ng = G.length;
            n.cards++;
            if (S.danger && (S.steps[0].seg !== 'danger' || !S.steps[0].df)) out.push(at + ': the danger frame is not the first step');
            var e = gameEnd(a);
            if (ng >= 3) n.long++;
            if (c.mateAgainst) n.mates++;
            if (e.cut) n.cut++; else n.whole++;
            if (e.could) n.could++;
            if (ng !== e.k + 1) out.push(at + ': ' + ng + ' game steps, the game segment ends at ' + e.k + (e.cut ? ' (cut)' : ''));
            if (!!S.could !== e.could) out.push(at + ': S.could ' + S.could + ', expected ' + e.could);
            var ref = e.realSeg ? e.real : a.lines.refute.uci;
            if (e.realSeg) n.realSeg = (n.realSeg || 0) + 1;
            if (!!S.real !== !!e.realSeg) out.push(at + ': S.real ' + S.real + ', expected ' + !!e.realSeg);
            for (var i = 0; i < ng; i++) {
              var s = G[i], nd = s.line.nodes[s.k], u = moveUci(nd.move);
              if (s.seg !== 'game' || s.k !== i || u !== ref[i]) out.push(at + ': game step ' + i + ' is ' + s.seg + ' node ' + s.k + ' ' + u + ', not ' + ref[i]);
              /* every game step but the one they could have played is the game's own move */
              if (!(e.could && i === 1) && u !== e.real[i]) out.push(at + ': game step ' + i + ' plays ' + u + ', the game ' + e.real[i]);
            }
            var last = S.steps[S.g - 1], ln = last.line.nodes[last.k];
            if (c.mateAgainst && !e.cut && !isMate(ln.after)) out.push(at + ': the mate segment does not end in mate');
            if (!c.mateAgainst && !e.cut && last.k !== Math.min(gameLoss(a), c.gameLine.nodes.length - 1)) out.push(at + ': the game segment ends at ' + last.k + ', not ' + gameLoss(a) + ' (lossAt ' + c.lossAt + ', or where the line settles)');
            if (G[0].line.nodes[0].move.from !== a.played.from || G[0].line.nodes[0].move.to !== a.played.to) out.push(at + ': G1 is not the game move');
            /* the move they could have played says so, and nothing comes after it */
            if (e.could && !/could take|could give|could play|would be checkmate/.test(G[1].cap)) out.push(at + ': the step they could have played reads ' + G[1].cap);
            /* "They missed it." only on the move they could have played (on the game's own moves they replied with the move shown) */
            if (/They missed it/.test(G.map(function (x) { return x.cap; }).join(' ')) !== !!(e.could && /They missed it/.test(G[1].cap))) out.push(at + ': They missed it on a step played');
            /* the last game step's loss claim is the real game's material there (final fixes 1) */
            if (!e.could) {
              /* (a trade, or two kinds of piece, in the board's pieces: the game's own ledger) */
              var lm = /You lose ([a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)[.]$/.exec(last.cap), rg = buildLine(a.pre, a.playedUci, e.real.slice(1, ng), !myPov(a.it));
              var pv = myPov(a.it), net = matDiff(rg.nodes[0].before.b, pv) - matDiff(rg.nodes[ng - 1].after.b, pv), own = plainCapture(rg, ng - 1, 0);
              if (rg.nodes.length !== ng) out.push(at + ': the game segment runs past the game');
              else if (lm) {
                n.claims = (n.claims || 0) + 1;
                if (!(net >= 1 && (lm[1] === own || lm[1] === ledgerIcons(rg, ng - 1, 0, own) || (lm[1] === 'material' && (!own || / for /.test(own))) || (lm[1] === 'a lot of material' && net >= 6)))) out.push(at + ': the last game step claims ' + lm[1] + ', the game lost ' + net + ' (' + own + ')');
              }
            }
            /* a mate is stepped to the mate on the stored refutation, whatever lossAt says (the classifier keeps 8 plies) */
            if (c.mateAgainst && !e.cut && e.k >= 1) {
              var keep = c.lossAt; c.lossAt = 0; a.story = null;
              var S2 = buildStory(a), l2 = S2.steps[S2.g - 1];
              if (!isMate(l2.line.nodes[l2.k].after)) out.push(at + ': with lossAt 0 the mate segment stops at node ' + l2.k);
              c.lossAt = keep; a.story = null; n.mateLong++;
            }
          });
        });
      });
      /* doctored: no drop in the score after the game move, so a count over 3 pawns is out of line with it and only a smaller one (or the game's end) ends the game's own moves */
      playerTier = function () { return 2; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a0 = openCard(it);
        if (!a0) return;
        var a = answered(a0, 'solved');
        if (!gameEnd(a).realSeg) return;
        var keep = it.b.eb, ea = it.b.ea != null ? it.b.ea : it.b.ma != null ? (it.b.ma > 0 ? 1500 : -1500) : cpFromWin(it.b.wa);
        it.b.eb = ea; a.story = null;
        try {
          var S = buildStory(a), e = gameEnd(a);
          n.noDrop = (n.noDrop || 0) + 1;
          if (S.g - (S.danger ? 1 : 0) !== e.k + 1 || !!S.real !== !!e.realSeg) out.push('no drop ' + it.key + ': ' + S.g + ' game steps' + (S.real ? ' (real)' : '') + ', expected ' + (e.k + 1) + (e.realSeg ? ' (real)' : ''));
        } finally { it.b.eb = keep; a.story = null; }
      });
      /* doctored: the game's own moves as the refutation's, the segment runs to the loss */
      playerTier = function () { return 1; };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a || it.b.ma != null) return;
        var keep = it.g.mv, toks = keep.split(' '), ru = unpackUci(it.b.ru), st = cloneState(a.pre), sans = [];
        applyMove(st, a.played);
        for (var k = 0; k < Math.min(ru.length, 8); k++) { var m = uciToMove(st, ru[k]); if (!m) break; sans.push(sanOf(st, m)); applyMove(st, m); }
        it.g.mv = toks.slice(0, it.b.p + 1).concat(sans).join(' ');
        try {
          answered(a, 'solved');
          var S = buildStory(a);
          n.doctored = (n.doctored || 0) + 1;
          if (S.could || S.g - (S.danger ? 1 : 0) !== Math.min(gameLoss(a), a.cls.gameLine.nodes.length - 1, sans.length) + 1) out.push('doctored ' + it.key + ': ' + S.g + ' game steps with the game as the refutation, lossAt ' + a.cls.lossAt);
        } finally { it.g.mv = keep; }
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards > 500 && r.n.long > 80 && r.n.mates > 10 && r.n.mateLong > 5 && r.n.cut > 100 && r.n.could > 50 && r.n.whole > 100 && r.n.doctored > 50 && r.n.realSeg >= 12 && r.n.claims > 50 && r.n.noDrop >= 3, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('final fixes: 184455333378:68 steps the game\'s own moves to the queen it lost (Rg1 cxd3+ cxd3 Rxf5), never the engine\'s Qd2+; the move they could have played is read as one on the board; a forcing line\'s board reads both sides\' captures', () => {
    const A = boot();
    A.ev(DOM);
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      playerTier = function () { return 2; };
      var story = function (key, how) {
        var a = answered(openCard(model().byKey[key]), how), S = buildStory(a);
        /* the game's own steps, after the danger frame (F1.5) */
        var G = S.steps.slice(S.danger ? 1 : 0, S.g);
        return { a: a, S: S, caps: G.map(function (x) { return x.cap; }), moves: G.map(function (x) { return moveUci(x.line.nodes[x.k].move); }), danger: S.danger ? S.steps[0].cap : '' };
      };
      var q = story('184455333378:68', 'solved'), qs = story('184455333378:68', 'shown');
      /* the could step's board (184205946040:62 step 2) */
      var c = story('184205946040:62', 'solved');
      c.a.view = { mode: 'story', i: (c.S.danger ? 1 : 0) + 1 }; c.a.settle = 2;
      var cl = boardOptsFor(c.a).opts.label;
      /* doctored: a best line that loses as much as the game ended having lost, so the game's end claims nothing of its own */
      var blf = bestLossFrom, dq;
      bestLossFrom = function () { return 11; };
      try { dq = story('184455333378:68', 'solved'); } finally { bestLossFrom = blf; }
      return JSON.stringify({ caps: q.caps, moves: q.moves, real: q.S.real, could: q.S.could, shown: qs.caps, ccap: c.caps[1], cl: cl, cs: c.S.could, dq: dq.moves.length + ' ' + !!dq.S.real, danger: q.danger }); })()`));
    eq(r.dq, '3 false', 'with the best line losing as much, the game\'s moves to where it left the line');
    eq(JSON.stringify(r.moves), JSON.stringify(['d1g1', 'c4d3', 'c2d3', 'f8f5']), 'the game\'s own four moves');
    eq(JSON.stringify(r.caps), JSON.stringify(['Rg1. Your queen is still attacked.', 'cxd3 takes your bishop with check.', 'cxd3 takes their pawn.', 'Rxf5 takes your queen.']), 'its captions (G1: the queen Qe6 saves, still attacked after Rg1; the bishop Qe6 loses too: the reviews)');
    eq(JSON.stringify(r.shown), JSON.stringify(r.caps), 'the same when shown');
    /* See why opens on the danger frame (F1.5): their last move made the attacks */
    eq(r.danger, 'After fxg6: queen attacked twice, bishop once.', 'the danger frame before the game\'s moves');
    ok(r.real && !r.could, 'the game\'s own moves, nothing they could have played');
    ok(r.cs && r.ccap === 'Kxa3 could take your pawn. They missed it.', 'the could step: ' + r.ccap);
    ok(r.cl.indexOf('They could have taken your pawn on a3.') >= 0 && r.cl.indexOf(' was taken on ') < 0, 'the could step\'s board: ' + r.cl);
    /* a forcing line played through (184215516284:63: Nxc2 Bxc2 Bxf4): its settled board reads what each side took */
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    A.ev(`(window.__show(model().byKey['184215516284:63']), 1)`);
    run(1000);
    for (let g = 0; g < 6 && A.ev('ui.session.active.phase') !== 'done'; g++) { A.ev('(function (a) { gradeMove(uciToMove(a.st, a.sol[a.solIdx])); return 1; })(ui.session.active)'); run(2500); }
    run(4000);
    const l = A.ev('boardOptsFor(ui.session.active).opts.label');
    ok(l.indexOf('Along the line you took a bishop on c2 and a bishop on f4; they took your knight on c2.') >= 0, 'the line read whole: ' + l);
    ok(l.indexOf('You won a ') < 0, 'its tokens not read as wins alone: ' + l);
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
            } else if (nb !== trimEnd(a, c.bestLine, 1, Math.min(Math.max(1, c.bSettle), c.bestLine.nodes.length - 1))) out.push(at + ': ' + nb + ' better steps, bSettle ' + c.bSettle);
            if (nb !== Math.max(1, c.bSettle)) n.trimmed = (n.trimmed || 0) + 1;
            if (nb > 1) n.multi++;
            /* what lands on B1: the better move's badge and tints, then guard dots or the game move's ghost, never both; on G1 the reply it allows; a capture's token in its owner's colour */
            var b1 = S.steps[S.g], bn = b1.line.nodes[b1.k], m1 = storyMarks(a, S, S.g), bk = a.revealed ? 'info' : 'good';
            if (!m1.badges || m1.badges[0].sq !== bn.move.to || m1.badges[0].kind !== bk || m1.tints.length !== 2) out.push(at + ': B1 badge ' + JSON.stringify(m1.badges));
            if (!!m1.guards !== !!S.guard || (m1.guards && m1.ghosts)) out.push(at + ': B1 guard dots ' + JSON.stringify(m1.guards) + ' with ghost ' + JSON.stringify(m1.ghosts));
            if (!S.guard && (!m1.ghosts !== (a.played.to === bn.move.to))) out.push(at + ': B1 ghost ' + JSON.stringify(m1.ghosts));
            if (m1.ghosts && (m1.ghosts[0].sq !== a.played.to || m1.ghosts[0].p !== a.pre.b[a.played.from])) out.push(at + ': B1 ghost is not the game move');
            if (S.guard) n.guard++; else if (m1.ghosts) n.ghost++;
            /* G1, after the danger frame (F1.5: at most three dashed red arrows and two rings, nothing else) */
            var d0 = S.danger ? 1 : 0, m0 = storyMarks(a, S, d0), th = threatOf(c.gameLine, 1);
            if (d0) {
              var md = storyMarks(a, S, 0);
              n.danger = (n.danger || 0) + 1;
              if ((md.arrows || []).length > 3 || (md.rings || []).length > 2 || Object.keys(md).some(function (k) { return k !== 'arrows' && k !== 'rings'; }) || (md.arrows || []).some(function (x) { return x.kind !== 'threat'; })) out.push(at + ': the danger frame draws ' + JSON.stringify(md));
            }
            if (!!m0.arrows !== !!S.threat || (th && !m0.arrows) || (m0.arrows && (m0.arrows[0].kind !== 'threat' || m0.rings[0].sq !== m0.arrows[0].from || m0.arrows[0].from !== c.gameLine.nodes[1].move.from))) out.push(at + ': G1 marks ' + JSON.stringify(m0));
            S.steps.forEach(function (x, i) {
              if (x.df) return;
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
            var S = buildStory(a), al = buildLine(a.pre, '0000', a.yours.uci, myPov(it)), want = trimEnd(a, al, 1, Math.min(Math.max(1, settleIndex(al)), al.nodes.length - 1)), b1 = S.steps[S.g];
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
            if (posKey(doneBoard(a)) !== posKey(st)) out.push(it.key + ': B1 of an alternative in a line does not start where it was played');
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards > 500 && r.n.multi > 100 && r.n.alts > 50 && r.n.inLine > 5 && r.n.guard >= 6 && r.n.ghost > 300 && r.n.ep >= 2 && r.n.trimmed >= 10 && r.n.danger > 50, JSON.stringify(r.n));
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
          var S = buildStory(a), d0 = S.danger ? 1 : 0;
          if (S.mateG || /checkmate/i.test(S.steps[d0].cap) || S.g - d0 !== gameEnd(a).k + 1) out.push(it.key + ': a mate claimed against with none on screen: ' + S.steps[d0].cap + ', ' + S.g + ' game steps');
          c.mateAgainst = null; c.mateFor = 1; a.story = null;
          S = buildStory(a);
          if (S.mateB || /checkmate/i.test(S.steps[S.g].cap) || S.steps.length - S.g !== trimEnd(a, c.bestLine, 1, Math.min(Math.max(1, c.bSettle), c.bestLine.nodes.length - 1))) out.push(it.key + ': a mate claimed for with none on screen: ' + S.steps[S.g].cap);
          c.mateFor = null; a.story = null; n.mateG++; n.mateB++;
        }
        /* an alternative whose own line cannot be built: told as the better move, never as yours */
        var bestSan = sanOf(a.pre, a.best).replace(/[+#]$/, '');
        a.alt = { uci: 'x' }; a.own = true; a.yours = { uci: [], cp: 0, at: 0 }; a.story = null;
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
        a.alt = null; a.own = false; a.yours = null; a.story = null;
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
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); if (!a || a.sol) return false; /* the game went the refutation's way (fresh-eyes T4) */ var g = realGame(a, a.cls.lossAt + 1).join(' '), ru = [a.playedUci].concat(unpackUci(x.b.ru)).slice(0, a.cls.lossAt + 1).join(' '); return g === ru && !a.cls.mateAgainst && a.cls.lossAt === 1 && a.cls.bSettle === 1; }).slice(0, 6).map(function (x) { return x.key; }))`));
    ok(keys.length >= 4, 'one-move blunders ' + keys.length);
    const st = () => JSON.parse(A.ev('JSON.stringify((function (a) { var v = a.view; return { mode: v.mode, i: v.i, fen: stateFen(doneBoard(a)), off: /btn-off[^>]*>Next move/.test(window.__els.cbar.innerHTML) }; })(ui.session.active))'));
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
    const keys = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); if (!a || a.sol) return false; var g = realGame(a, a.cls.lossAt + 1).join(' '), ru = [a.playedUci].concat(unpackUci(x.b.ru)).slice(0, a.cls.lossAt + 1).join(' '); return g === ru && !a.cls.mateAgainst && a.cls.lossAt + Math.max(1, a.cls.bSettle) >= 4; }).slice(0, 4).map(function (x) { return x.key; }))`));
    const st = () => JSON.parse(A.ev('JSON.stringify((function (a) { return { mode: a.view.mode, i: a.view.i, fen: stateFen(doneBoard(a)), strip: window.__els.cstrip.innerHTML, note: a.note && a.note.key === cardStateKey(a) ? a.note.id : null, nope: !!(a.nope && a.nope.key === cardStateKey(a)) }; })(ui.session.active))'));
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
      /* (or the danger frame before it, F1.5: the card's own position) */
      eq(s.fen, A.ev('(function (a) { var x = buildStory(a).steps[0]; return stateFen(x.df ? a.pre : x.line.nodes[0].after); })(ui.session.active)'), key + ': a tap during the crossfade still lands G1');
      ok(!A.ev('ui.session.active.view.pre'), key + ': G1 landed');
      A.click('storyFwd', null, 1); run(1200);
      s = st(); eq(s.i, 1, key + ': Next move');
      /* every square tapped: never a step, a piece outlined with N1 where the budget allows it */
      const sqs = JSON.parse(A.ev('JSON.stringify((function (st) { var p = [], e = []; for (var q = 0; q < 64; q++) (st.b[q] ? p : e).push(q); return { p: p.slice(0, 6), e: e.slice(0, 3) }; })(doneBoard(ui.session.active)))'));
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
      let n1 = 0;
      for (const key of keys) {
        const at = (reduced ? 'reduced, ' : '') + key;
        A.ev(`(function () { window.__show(model().byKey['${key}']); ui.session.keys.push('x'); return 1; })()`);
        run(1000);
        A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
        run(2500);
        A.ev('window.__writes.length = 0; window.__snd.length = 0; 1');
        let t0 = A.getNow();
        A.click('seeWhy', null, 0);
        run(1500);
        /* the danger frame first (F1.5): a still crossfade to the card's
           position with its marks (no game arrow, nothing slides, no sound),
           its caption once the faded bar takes taps again (450 ms); the next
           tap plays the game move as G1 always did */
        const d0 = A.ev('buildStory(ui.session.active).danger') ? 1 : 0;
        if (d0) {
          const wd = JSON.parse(A.ev('JSON.stringify(window.__writes)')).map((w) => Object.assign(w, { t: w.t - t0 }));
          const bd = wd.filter((w) => w.id === 'bwrap' && w.what === 'innerHTML'), td = wd.filter((w) => w.id === 'cband');
          /* (a game move that unblocked their mate rings the blocker in gold: the coach's review) */
          ok(bd.length === 1 && !/slide|red/.test(bd[0].v) && /aring|arrow|target|hint/.test(bd[0].v) && (reduced || (bd[0].t >= 100 && /xfade/.test(bd[0].v))), at + ': the danger frame, still, with its marks: ' + JSON.stringify(bd));
          ok(td.length && td[0].t >= (reduced ? 0 : 450) && td[0].t >= bd[0].t + (reduced ? 0 : 150), at + ': its caption after its marks: ' + JSON.stringify(td[0]));
          eq(JSON.parse(A.ev('JSON.stringify(window.__snd)')).filter((x) => x.k === 'move').length, 0, at + ': no move sound on the danger frame');
          ok(/^Step 1 of \d+, before your game move\. /.test(A.ev('displayFor(ui.session.active).live')), at + ': the live region says the danger frame');
          n1++;
          A.ev('window.__writes.length = 0; window.__snd.length = 0; 1');
          t0 = A.getNow();
          A.click('storyFwd', null, 1);
          run(1500);
        }
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
        eq(A.ev('ui.session.active.view.i'), d0, at + ': back on G1');
        /* the live region says where the step is */
        ok(new RegExp('^Step ' + (d0 + 1) + ' of \\d+, your game\\. ').test(A.ev('displayFor(ui.session.active).live')), at + ': the live region leads with the step');
        A.click('next', null, 2); run(1000);
      }
      ok(n1 >= 1, 'cards with a danger frame ' + n1);
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

  /* ── fresh-eyes fixes A: truth on the card face ── */
  /* the rules as these tests read them, apart from the app's own: a count
     of material stands at node k when the line does not end there on a
     capture or check left unanswered and has none in the next two plies; a
     loss is claimed only where it stands, in line with the score (no more
     than 3 pawns over the drop, unless the move is lost anyway) and more
     than the card's best line loses from the same position; or at the
     line's end when the solver takes something back there ("X for Y") */
  const FRESH = `
    var qp = function (x) { return !x || !x.move || (!x.captured && !x.move.promo && !checkersOf(x.after).length); };
    function stands(line, k) { var n = line.nodes; if (!n[k]) return false; return k === n.length - 1 ? qp(n[k]) : qp(n[k + 1]) && qp(n[k + 2]); }
    function netLoss(a, line, k) { var pov = myPov(a.it); return matDiff(line.nodes[0].before.b, pov) - matDiff(line.nodes[k].after.b, pov); }
    function bestLoss(a, j) {
      var line = a.cls.bestLine, pov = myPov(a.it), worst = 0;
      if (!line || !line.nodes[j]) return 0;
      var base = matDiff(line.nodes[j].after.b, pov);
      [a.cls.bSettle, line.nodes.length - 1].forEach(function (k) { if (k > j && stands(line, k)) worst = Math.min(worst, matDiff(line.nodes[k].after.b, pov) - base); });
      return -worst;
    }
    function claimAt(a, line, k, cpAfter, j, story) {
      var bl = bestLoss(a, j), eb = a.it.b.eb, last = line.nodes.length - 1, end = line.nodes[last];
      var good = function (kk, st) { var n = netLoss(a, line, kk); return st && n >= 1 && n > bl && (cpAfter <= -900 || n <= (eb - cpAfter) / 100 + 3); };
      if (good(k, stands(line, k))) return k;
      if (!story && last > k && end.captured && isW(end.captured) !== myPov(a.it) && good(last, true)) return last;
      return -1;
    }
    function cpGame(b) { return b.ea != null ? b.ea : b.ma != null ? (b.ma > 0 ? 1500 : -1500) : cpFromWin(b.wa); }
  `;

  await test('S0 draws the game line\'s threat only where it holds on its own board: their move, legal there, taking a piece of yours or mating, and winning material (the engine\'s line plays it next and loses by it); its words and aria-label follow (fresh-eyes T1)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT} ${FRESH}
      var out = [], n = { frames: 0, stands: 0, drawn: 0, gone: 0 };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          a = answered(a, 'solved');
          a.view = { mode: 's0' }; a.settle = 2;
          var at = 'tier ' + tier + ' ' + it.key, f = boardOptsFor(a), o = f.opts, st = f.st, pov = myPov(it);
          n.frames++;
          var th = familyOf(patternOf(it.b)).key !== 'chances' ? threatOf(a.cls.gameLine, 1) : null;
          if (th && st.b[th.from] === a.cls.gameLine.nodes[1].before.b[th.from]) n.stands++;
          var arrows = (o.arrows || []).filter(function (x) { return x.kind === 'threat'; });
          if (th && !arrows.length && st.b[th.from] === a.cls.gameLine.nodes[1].before.b[th.from]) n.gone++;
          arrows.forEach(function (ar) {
            n.drawn++;
            var lm = legalMoves(st).filter(function (m) { return m.from === ar.from && m.to === ar.to; })[0];
            if (!!st.w === pov) out.push(at + ': a threat drawn with you to move');
            if (!lm) { out.push(at + ': an illegal threat ' + sqName(ar.from) + sqName(ar.to)); return; }
            var aft = cloneState(st); applyMove(aft, lm);
            var took = st.b[lm.ep >= 0 ? lm.ep : lm.to], mate = isMate(aft);
            if (!mate && !(took && isW(took) === pov)) out.push(at + ': a threat that takes nothing of yours');
            /* the engine's line through this board plays it next and loses material by it */
            var bl = a.cls.bestLine, j = -1;
            bl.nodes.forEach(function (x, k) { if (j < 0 && posKey(x.after) === posKey(st)) j = k; });
            if (j >= 0) {
              var nx = bl.nodes[j + 1];
              if (!nx || nx.move.from !== ar.from || nx.move.to !== ar.to) out.push(at + ': a threat the engine does not play');
              else if (!mate && bestLoss(a, j) < 1) out.push(at + ': a threat that wins nothing on the best line');
            }
            /* its words, on this board as drawn */
            if (!/Dashed red arrow: the [a-z]+ on [a-h][1-8] can (take|give check) on /.test(o.label) || /after your game move/.test(o.label)) out.push(at + ': the aria-label reads ' + o.label);
            var w = threatSay(a, f, ar);
            if (!w || !w.say) out.push(at + ': no words for the threat drawn');
          });
          /* the three repro boards (fresh-eyes T1) draw nothing */
          if (/^184331579496:34$|^184205946040:62$|^184380745302:11$|^184455333378:68$|^184268949378:16$/.test(it.key) && arrows.length) out.push(at + ': the repro card still draws ' + JSON.stringify(arrows));
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.frames > 250 && r.n.stands > 30 && r.n.drawn >= 2 && r.n.gone > 30, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('no material claim on an unsettled line, out of line with the score, or lost by the best line too: R4, the game move again (M3), a wrong try (M3) and the story\'s last game step (fresh-eyes T5, T8, T2c)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT} ${FRESH} ${MISSES}
      var out = [], n = { r4: 0, r4Claim: 0, r4Back: 0, m2: 0, m2Claim: 0, tries: 0, tryClaim: 0, story: 0, dropped: 0 };
      var lose = function (s) { return /(lost|could lose|you'd lose|You'd lose|You lose) (?!nothing|less)/.test(s); };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          var c = a.cls, at = 'tier ' + tier + ' ' + it.key, fam = familyOf(patternOf(it.b)).key;
          /* the game move again (M2) */
          if (fam !== 'chances') {
            var w2 = gameMoveWhy(a), k2 = c.lossG >= 1 && !c.mateAgainst ? claimAt(a, c.gameLine, c.lossAt, cpGame(it.b), 0) : -1;
            n.m2++;
            /* (V2.2: or as its first decisive event, "Their knight takes your queen.") */
            var said2 = w2.cands.concat([w2.fall]).some(lose);
            if (said2 || /takes your|forks/.test(w2.cands[0] || '')) n.m2Claim++;
            if (said2 && k2 < 0) out.push(at + ' M2: claims ' + w2.cands.join(' | '));
          }
          a = answered(a, 'solved');
          a.view = { mode: 's0' }; a.settle = 2;
          /* R4: the game move's loss, exactly where it holds */
          var cmp = buildCompare(a), r4 = r4Of(a), k4 = c.lossG >= 1 && !c.mateAgainst ? claimAt(a, c.gameLine, c.lossAt, cpGame(it.b), 0) : -1;
          n.r4++;
          if (!!cmp.w !== (k4 >= 0)) out.push(at + ' R4: w "' + cmp.w + '" where the claim ' + (k4 >= 0 ? 'holds at ' + k4 : 'does not hold'));
          if (cmp.w) { n.r4Claim++; if (k4 !== c.lossAt) n.r4Back++; if (cmp.w !== (plainCapture(c.gameLine, k4, 0) || cmp.w)) out.push(at + ' R4: "' + cmp.w + '" is not what the line took to node ' + k4); }
          else if (c.lossG >= 1 && !c.mateAgainst) { n.dropped++; r4.cands.concat([displayFor(a).row2]).forEach(function (x) { if (lose(x)) out.push(at + ' R4 dropped, yet reads ' + x); }); }
          /* the story's last game step */
          var S = buildStory(a), lg = S.steps[S.g - 1], m = /You lose ([a-z ]+|[\\u2654-\\u265f]+(?: for [\\u2654-\\u265f]+)?)\\./.exec(lg.cap);
          if (m) {
            n.story++;
            if (claimAt(a, lg.line, lg.k, cpGame(it.b), 0, true) !== lg.k) out.push(at + ' story: "' + lg.cap + '" where the count does not stand');
            if (S.could && lg.k === 1) out.push(at + ' story: a loss on a move they only could have played');
          }
          /* the last better step's gain, only where its count stands */
          var lb = S.steps[S.steps.length - 1];
          if (/You win /.test(lb.cap)) { n.win = (n.win || 0) + 1; if (!stands(lb.line, lb.k)) out.push(at + ' story: "' + lb.cap + '" where the count does not stand'); }
        });
      });
      /* a wrong try (M3): the stub answers with the stored refutation */
      eachMiss([1, 2], function (a, what) {
        var t = a.tried;
        /* the game move again is M2's, checked above */
        if (!t || t.kind !== 'miss' || t.uci === a.playedUci) return;
        n.tries++;
        var b = a.it.b, m = uciToMove(a.st, t.uci), after = cloneState(a.st); applyMove(after, m);
        var ru = unpackUci(b.ru), reply = ru.length && playUci(after, ru).uci.length === ru.length ? ru : legalMoves(after).slice(0, 1).map(moveUci);
        var c = classifyMistake(a.st, t.uci, { pv: [] }, { pv: reply, mate: reply === ru ? b.ma : null }, winPct(b.eb), b.wa, b.p);
        var k = c.lossG >= 1 && !c.mateAgainst ? claimAt(a, c.gameLine, c.lossAt, cpFromWin(b.wa), a.sol && a.solIdx > 0 ? a.solIdx : 0) : -1;
        /* V2.2: the loss is said as its first decisive event where one comes
           ("Their knight takes your queen.", "Then Rxf5 takes your queen.");
           "You'd lose" only where the count stands, and an event only on a
           line whose count stands or that mates or promotes */
        var said = a.verdict.cands.concat([a.verdict.fall]).some(lose), evClaim = /takes your|forks/.test(a.verdict.cands[0] || '');
        if (said || evClaim) n.tryClaim++;
        if (said && k < 0) out.push(what + ' M3: claims ' + a.verdict.cands.join(' | '));
      });
      /* the settle rule's own steps: a capture two plies on, a capture or check left unanswered at the end */
      var sl = buildLine(stateFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'e2e4', ['d7d5', 'g1f3', 'd5e4'], false);
      if (settledAt(sl, 1)) out.push('a count stands with a capture two plies on');
      if (settledAt(sl, 3) || !settledAt(buildLine(sl.nodes[0].before, 'e2e4', ['d7d5', 'g1f3'], false), 2)) out.push('the end of a line: unanswered capture stands, or a quiet end does not');
      /* the repro cards: an unsettled line (it ends on a check) claims nothing; a rook taken back is said */
      playerTier = function () { return 2; };
      var rp = function (key) { var a = answered(openCard(model().byKey[key]), 'solved'); a.view = { mode: 's0' }; a.settle = 2; return r4Of(a).cands.concat([displayFor(a).row2]); };
      rp('184268949378:16').forEach(function (x) { if (lose(x)) out.push('184268949378:16 R4 still claims: ' + x); });
      rp('184455333378:68').forEach(function (x) { if (/a queen and a bishop\\./.test(x)) out.push('184455333378:68 R4 leaves out the rook taken back: ' + x); });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.r4 > 250 && r.n.r4Claim > 60 && r.n.r4Back >= 3 && r.n.m2Claim > 40 && r.n.tries > 150 && r.n.tryClaim >= 3 && r.n.story > 20 && r.n.dropped > 20 && r.n.win >= 10, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('a wrong move\'s loss is said as See it shows it: "You\'d lose X." only when their one reply takes it, else after that reply; their reply named when it takes a piece not won back at once; the lost token and its label only on a capture (fresh-eyes T3, F1.2)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MISSES}
      var out = [], n = { plain: 0, kept: 0, after: 0, seen: 0, token: 0 };
      eachMiss([1, 2], function (a, what) {
        var t = a.tried;
        if (!t || t.kind !== 'miss') return;
        var b = a.it.b, m = uciToMove(a.st, t.uci), after = cloneState(a.st); applyMove(after, m);
        var ru = unpackUci(b.ru), reply = ru.length && playUci(after, ru).uci.length === ru.length ? ru : legalMoves(after).slice(0, 1).map(moveUci);
        var c = classifyMistake(a.st, t.uci, { pv: [] }, { pv: reply, mate: reply === ru ? b.ma : null }, winPct(b.eb), b.wa, b.p), r1 = c.gameLine.nodes[1];
        var first = a.verdict.cands[0] || '', cap = /^(?:Their (\\w+)|(\\S+)) takes your (\\w+)\\.$/.exec(first);
        /* F1.2: their one reply that takes it, named: "Their knight takes your queen." (tier 3 its SAN),
           where the loss is counted there, or where that reply takes a piece (a knight or more) that is
           not won back at once: 3 or more net of what the try took and what your next move takes */
        var v = function (x) { return x && x.move && x.captured ? MOTIF_VAL[pType(x.captured)] : 0; }, g = c.gameLine.nodes;
        var kept = !!r1 && !!r1.captured && MOTIF_VAL[pType(r1.captured)] >= 3 && v(r1) - v(g[0]) - v(g[2]) >= 3;
        /* V2.2: or (any piece) where that loss stands where the line settles */
        var gl = c.gameLine, ks = -1, pov = myPov(a.it);
        for (var q = 1; q < gl.nodes.length && ks < 0; q++) if (settledAt(gl, q)) ks = q;
        var stood = !!r1 && !!r1.captured && ks >= 1 && matDiff(gl.nodes[0].before.b, pov) - matDiff(gl.nodes[ks].after.b, pov) >= MOTIF_VAL[pType(r1.captured)];
        if (/^You'd lose /.test(first) || cap) {
          n.plain++;
          if (cap && kept && c.lossAt !== 1) n.kept++;
          if (cap && stood && !kept && c.lossAt !== 1) n.stood = (n.stood || 0) + 1;
          if (!r1 || !r1.captured || (c.lossAt !== 1 && !(cap && (kept || stood)))) out.push(what + ': "' + first + '" where their one reply does not take it');
          else if (cap && (PIECE_WORD[pType(r1.captured)] !== cap[3] || (cap[1] ? PIECE_WORD[r1.piece] !== cap[1] : cap[2] !== capSan(r1.before, r1.move)))) out.push(what + ': "' + first + '" is not their reply ' + sanOf(r1.before, r1.move));
        } else if (/^After \\S+, you'd lose /.test(first)) {
          n.after++;
          if (first.indexOf('After ' + sanOf(after, uciToMove(after, t.reply)) + ',') !== 0) out.push(what + ': "' + first + '" names another reply than ' + t.reply);
        }
        /* V2.2: a later capture is named as See it plays it: on the line its
           Next move steps through */
        var lt = /^Then (?:their (\\w+)|(\\S+)) takes your (\\w+)\\.$/.exec(first);
        if (lt) {
          n.later = (n.later || 0) + 1;
          var sans = playUci(after, t.line || []).san.map(function (x) { return x.replace(/[+#]$/, ''); });
          if (lt[2] && sans.indexOf(lt[2].replace(/[+#]$/, '')) < 0) out.push(what + ': "' + first + '" is not on the line See it plays: ' + sans.join(' '));
        }
        if (!t.reply) return;
        a.reason = 2; seeIt(); a.animMove = null;
        n.seen++;
        var o = boardOptsFor(a).opts, tk = (o.tokens || []).filter(function (x) { return x.kind === 'lost'; });
        var rm = uciToMove(after, t.reply), took = rm && (rm.ep >= 0 ? after.b[rm.ep] : after.b[rm.to]);
        if (tk.length) n.token++;
        if (tk.length && !took) out.push(what + ': a lost token with no capture');
        if (tk.length && tk[0].p !== took) out.push(what + ': the token is not the piece taken');
        var lb = labelCands(a, boardOptsFor(a), function () { return true; }).filter(function (x) { return x.text === 'lost'; });
        if (lb.length && !tk.length) out.push(what + ': "lost" with no token');
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.plain >= 10 && r.n.kept >= 3 && r.n.after + r.n.later > 10 && r.n.seen > 150 && r.n.token > 50, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('a better line, or your own, never ends on their capture: it runs on to your recapture or stops before it (a mate, or S-same\'s "still takes", aside) (fresh-eyes T12)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${MATE_AT}
      var out = [], n = { lines: 0, alts: 0, same: 0, trimmed: 0 };
      var check = function (a, what) {
        var S = buildStory(a), s = S.steps[S.steps.length - 1], nd = s.line.nodes[s.k], pov = myPov(a.it);
        n.lines++;
        if (/still (comes|takes)/.test(s.cap)) { n.same++; return; }
        if (S.mateB || isMate(nd.after)) return;
        if (s.k !== s.from && nd.captured && isW(nd.captured) === pov) out.push(what + ': ends on their capture: ' + s.cap);
        var full = a.cls.bestLine;
        if (!S.alt && s.line === full && s.k !== Math.max(1, a.cls.bSettle)) n.trimmed++;
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          ['solved', 'shown'].forEach(function (how) {
            var a = openCard(it);
            if (a) check(answered(a, how), 'tier ' + tier + ' ' + it.key + ' ' + how);
          });
          /* a move that works too, the stored line after it */
          var a = openCard(it);
          if (!a || a.sol) return;
          legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci; }).slice(0, 3).forEach(function (alt) {
            var b = openCard(it), aft = cloneState(b.st); applyMove(aft, alt);
            var rest = legalMoves(aft).filter(function (m) { return aft.b[m.to]; }).slice(0, 1).map(moveUci);
            if (rest.length) { var a2 = cloneState(aft); applyMove(a2, uciToMove(a2, rest[0])); var back = legalMoves(a2).filter(function (m) { return a2.b[m.to]; })[0]; if (back) rest.push(moveUci(back)); }
            b.yours = { uci: [moveUci(alt)].concat(rest), cp: 0, at: 0 };
            solved(alt, moveUci(alt), { win: 50, best: 52, mate: null });
            n.alts++;
            check(b, 'tier ' + tier + ' ' + it.key + ' works too ' + moveUci(alt));
          });
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.lines > 1000 && r.n.alts > 300 && r.n.same >= 4 && r.n.trimmed >= 10, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' | '));
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
      /* (x + 36, y + 9), pulled in to keep its halo on the board on an edge square */
      eq(+bd[1], Math.min(350, Math.max(10, x + 36)), name + ': badge x'); eq(+bd[2], Math.min(350, Math.max(10, y + 9)), name + ': badge y');
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
    /* the answer shown is a filled slate disc with an eye (F3.1): it differs from the close ring by shape */
    const BADGE = { good: '#3d9142', bad: '#d04a3a', checking: '#8f8b83', unchecked: '#6b665d', info: '#7d93ab' };
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
         dashed 6 4, the prize ring dashed 4 3 in the label gold over a dark halo (it reads on dark squares), hint 2's ring gold; the nope outline a square, 2 units in */
      const ring = (kind) => o.rings.filter((x) => x.kind === kind)[0];
      const ringAt = (cls, sq) => { const c = ctrOf(sq, flip); return p.marks.match(new RegExp('<circle class="' + cls + '" cx="' + rx(c[0]) + '" cy="' + rx(c[1]) + '" r="20" fill="none" ([^>]*)/>')); };
      const tc = ctrOf(ring('threat').sq, flip), cc = ' cx="' + tc[0] + '" cy="' + tc[1] + '" r="20" fill="none"';
      let m = ringAt('ring-threat', ring('threat').sq);
      ok(m && m[1] === 'stroke="#e0503e" stroke-width="3.6"' && p.marks.indexOf('<circle' + cc + ' stroke="rgba(0,0,0,.35)" stroke-width="6.5"/><circle class="ring-threat"' + cc) >= 0, name + ': the threat ring, red over its halo, ' + (m && m[1]));
      m = ringAt('reply-ring', ring('reply').sq);
      ok(m && m[1] === 'stroke="rgba(122,150,184,.95)" stroke-width="3" stroke-dasharray="6 4"', name + ': the reply ring, dashed 6 4, ' + (m && m[1]));
      m = ringAt('ring-target', ring('target').sq);
      const gc = ctrOf(ring('target').sq, flip), gcc = ' cx="' + gc[0] + '" cy="' + gc[1] + '" r="20" fill="none"';
      ok(m && m[1] === 'stroke="#e8c27a" stroke-width="3.2" stroke-dasharray="4 3"' && p.marks.indexOf('<circle' + gcc + ' stroke="rgba(20,14,8,.6)" stroke-width="6"/><circle class="ring-target"' + gcc) >= 0, name + ': the prize ring, label gold dashed 4 3 over a dark halo, ' + (m && m[1]));
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

  await test('the board svg is #bwrap\'s first child, the marks svg over it, the labels after them', () => {
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
      /* the labels (2.1) come third, right after the marks svg */
      ok(/<\/svg><div class="blabels" aria-hidden="true">(<span class="blabel [^"]*" style="[^"]*">[^<]*<\/span>)?<\/div>/.test(p.marks), name + ': the labels after the marks svg');
      if (f.what === 'promotion') ok(/<\/svg><div class="blabels"[^>]*>(<span[^>]*>[^<]*<\/span>)?<\/div><div class="promo-card">/.test(p.marks), name + ': the promotion card after all three');
      if (f.what === 'hint 2') ok(/class="hint-ring"/.test(p.marks), name + ': the hint ring in the marks');
    });
  });

  /* exploring on the page as painted (DOM, BAR) with the fake clock: the
     engine's explore searches answered by hand, three legal lines each */
  const XANS = `(window.__xans = function () { var n = 0;
    window.__evals.slice().forEach(function (j) {
      if (!j.res || j.done || j.opts.tag !== 'explore') return;
      j.done = 1; n++;
      var st = stateFromFen(j.fen), lines = legalMoves(st).slice(0, 3).map(function (m, i) { var cp = 50 - 40 * i; return { cp: st.w ? cp : -cp, mate: null, pv: [moveUci(m)] }; });
      j.res({ cp: lines[0].cp, mate: null, bestUci: lines[0].pv[0], pv: lines[0].pv, lines: lines, depth: 18, stopped: false });
    });
    return n; }, 1)`;
  const xpOpenPainted = async (A, tier) => {
    A.ev(DOM); A.ev(BAR); A.ev(XANS);
    A.ev(`(playerTier = function () { return ${tier || 2}; }, window.readyEngine(), 1)`);
    A.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol; })[0]; window.__show(it); return 1; })()`);
    for (let t = 0; t < 1000; t += 10) A.advance(10);
    A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
    for (let t = 0; t < 3000; t += 10) A.advance(10);
    A.click('explore');
  };
  /* answer every search asked for, as many rounds as it takes, then let the paint come */
  const xpSettle = async (A) => {
    for (let i = 0; i < 4; i++) { A.ev('window.__xans()'); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); }
    for (let t = 0; t < 1000; t += 10) A.advance(10);
  };

  await test('exploring opens with the keyboard on its band: Enter is Continue, Space plays nothing, the rows take no focus by themselves', async () => {
    const A = boot();
    await xpOpenPainted(A);
    ok(A.ev('!!ui.session.active.explore'), 'exploring');
    for (let t = 0; t < 600; t += 10) A.advance(10);
    eq(A.ev('document.activeElement && document.activeElement.id'), 'result-h', 'focus at entry');
    await xpSettle(A);
    eq(A.ev('document.activeElement && document.activeElement.id'), 'result-h', 'focus once the rows came');
    eq(A.ev('ui.session.active.explore.wantRow'), null, 'no row asked for the keyboard');
    A.key(' ');
    eq(A.ev('ui.session.active.explore.nodes.length'), 1, 'Space played nothing');
    A.key('Enter');
    eq(A.ev('!!(ui.session.active && ui.session.active.explore)') + ' ' + A.ev('!!ui.session.finished || ui.session.idx > 0'), 'false true', 'Enter is Continue');
  });

  await test("exploring's forward button: dead from the moment it comes to mean a new move until that label has shown 450 ms; live at once after ‹; a held → never plays a pick", async () => {
    const A = boot();
    await xpOpenPainted(A);
    await xpSettle(A);
    const X = () => JSON.parse(A.ev('JSON.stringify({ at: ui.session.active.explore.at, n: ui.session.active.explore.nodes.length })'));
    const fwd = () => ((/data-slot="1"[^>]*>([^<]*)</.exec(A.ev('window.__els.cbar.innerHTML')) || [])[1] || '').replace(/&#39;/g, "'");
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const untilLabel = (want) => { for (let t = 0; t < 2000 && fwd() !== want; t += 10) A.advance(10); eq(fwd(), want, 'the label ' + want); return A.getNow(); };
    /* a trail of two picks, then back to its start */
    eq(fwd(), "Stockfish's pick", 'at the start, the end of an empty trail');
    A.click('xpFwd', null, 1); await xpSettle(A);
    A.click('xpFwd', null, 1); await xpSettle(A);
    eq(JSON.stringify(X()), '{"at":2,"n":3}', 'two picks');
    A.click('xpBack', null, 0); run(600); A.click('xpBack', null, 0); run(600);
    eq(JSON.stringify(X()) + ' ' + fwd(), '{"at":0,"n":3} ›', 'back at the start');
    /* rapid taps on ›: the one that reaches the end changes its meaning;
       the next, while it still reads ›, and for 450 ms once it reads Play
       Stockfish's pick, play nothing */
    A.click('xpFwd', null, 1); run(100);
    A.click('xpFwd', null, 1);
    eq(JSON.stringify(X()), '{"at":2,"n":3}', 'the second tap reaches the end');
    run(50);
    eq(fwd(), '›', 'the button still reads ›');
    A.click('xpFwd', null, 1);
    eq(JSON.stringify(X()), '{"at":2,"n":3}', 'a tap on the old label plays nothing');
    const tp = untilLabel("Stockfish's pick");
    A.setNow(tp + 440); A.click('xpFwd', null, 1);
    eq(JSON.stringify(X()), '{"at":2,"n":3}', 'a tap 440 ms after the new label');
    A.setNow(tp + 460); A.click('xpFwd', null, 1);
    eq(JSON.stringify(X()), '{"at":3,"n":4}', 'a tap 460 ms after it plays the pick');
    await xpSettle(A);
    /* ‹ leaves the end: › means a step again, and takes a tap as soon as it reads › */
    A.click('xpBack', null, 0);
    eq(JSON.stringify(X()), '{"at":2,"n":4}', '‹ leaves the end');
    const tq = untilLabel('›');
    A.setNow(tq + 10); A.click('xpFwd', null, 1);
    eq(JSON.stringify(X()), '{"at":3,"n":4}', '› 10 ms after ‹ left the end');
    run(1000);
    /* a held →: it walks the trail to its end and stops there */
    A.click('xpBack', null, 0); run(600); A.click('xpBack', null, 0); run(600); A.click('xpBack', null, 0); run(600);
    eq(JSON.stringify(X()), '{"at":0,"n":4}', 'the trail\'s start');
    A.key('ArrowRight');
    for (let t = 0; t < 2000; t += 30) { A.key('ArrowRight', true); run(30); }
    eq(JSON.stringify(X()), '{"at":3,"n":4}', 'a held → stops at the end');
    /* a slow key repeat, which lets the label paint and its half second pass, too */
    for (let t = 0; t < 2000; t += 250) { A.key('ArrowRight', true); run(250); }
    eq(JSON.stringify(X()) + ' ' + fwd(), '{"at":3,"n":4} Stockfish\'s pick', 'a slow held → stops at the end');
    /* a fresh → there plays the pick, but only once its label has shown 450 ms */
    A.key('ArrowLeft'); run(1000);
    A.key('ArrowRight');
    eq(JSON.stringify(X()), '{"at":3,"n":4}', '→ to the end');
    run(50); A.key('ArrowRight');
    eq(JSON.stringify(X()), '{"at":3,"n":4}', 'a fresh → before the label shows');
    const tk = untilLabel("Stockfish's pick");
    A.setNow(tk + 440); A.key('ArrowRight');
    eq(JSON.stringify(X()), '{"at":3,"n":4}', 'a fresh → 440 ms after the label');
    A.setNow(tk + 460); A.key('ArrowRight');
    eq(JSON.stringify(X()), '{"at":4,"n":5}', 'a fresh → 460 ms after the label plays the pick');
    run(1000);
    /* a held ← walks back to the start and stays in exploring */
    A.key('ArrowLeft');
    for (let t = 0; t < 2000; t += 30) { A.key('ArrowLeft', true); run(30); }
    eq(A.ev('!!ui.session.active.explore') + ' ' + JSON.stringify(X()), 'true {"at":0,"n":5}', 'a held ← stops at the start');
    A.key('ArrowLeft');
    eq(A.ev('!!ui.session.active.explore'), false, 'a fresh ← there goes back to the lesson');
  });

  await test("a shown line's reply on its way: no ••• item for exploring (a tap then is input to the reply); back once it is said", () => {
    const A = boot();
    A.ev(DOM); A.ev(BAR);
    A.ev('(playerTier = function () { return 2; }, window.readyEngine(), 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const key = JSON.parse(A.ev(FORCING))[0];
    A.ev(`(window.__show(model().byKey['${key}']), 1)`);
    run(1000);
    A.ev('(reveal(), 1)'); run(2500);
    const item = () => A.ev('menuHtml(ui.session.active).indexOf(\'data-act="explore"\') >= 0');
    ok(item(), 'the item with the answer shown');
    A.click('playIt', null, 1);
    let seen = false;
    for (let t = 0; t < 4000; t += 10) {
      A.advance(10);
      if (A.ev('!!ui.session.active.reply')) { seen = true; ok(!item(), 'the item while their reply is on its way, ' + t + ' ms'); }
    }
    ok(seen, 'their reply came');
    ok(item(), 'the item once the reply is said');
  });

  /* ── final build round D ── */
  await test('round D, I4: a tap on a piece of yours while the forcing reply slides is kept and picked up as it lands (never hurrying it); a tap on a square then plays nothing; tapped twice it is let go; a piece the reply took is not picked up', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(FORCING)).slice(0, 6);
    const lead = A.ev('SLIDE_LEAD');
    /* a piece of yours with a move, in the position after their reply (a.st once it plays), and that move's square */
    const MOVER = `JSON.stringify((function (a) { var ms = legalMoves(a.st).filter(function (m) { return a.st.b[m.to] == null; }); return ms.length ? { from: ms[0].from, to: ms[0].to } : null; })(ui.session.active))`;
    let kept = 0, moved = 0;
    for (const [i, key] of keys.entries()) {
      const at = key;
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      const t0 = A.getNow() + lead + 220;
      /* the slide is on (1500 to 1900) */
      A.advance(t0 + 1600 - A.getNow());
      const s0 = JSON.parse(A.ev(STATE));
      ok(s0.hold && s0.reply && s0.reply.played, at + ': their reply slides');
      const mv = JSON.parse(A.ev(MOVER));
      if (!mv) continue;
      const tin = A.getNow();
      A.tap(mv.from);
      if (i % 3 === 2) A.tap(mv.from);
      A.ev(`(sessionClick(${mv.to}), 1)`);
      const s1 = JSON.parse(A.ev(STATE));
      eq(JSON.stringify([s1.mu, s1.sel, s1.phase, s1.solIdx]), JSON.stringify([s0.mu, -1, 'reply', s0.solIdx]), at + ': nothing moves, nothing jumps');
      eq(WR(A, tin).length, 0, at + ': nothing written during the slide');
      /* landed: the piece picked up at once (or let go when tapped twice), the words 150 ms later */
      A.advance(s0.mu - A.getNow());
      const s2 = JSON.parse(A.ev(STATE));
      eq(s2.sel, i % 3 === 2 ? -1 : mv.from, at + ': picked up at the landing');
      eq(s2.phase, 'reply', at + ': before the words');
      eq(WR(A, s0.mu).filter((w) => w.id === 'cband').length, 0, at + ': no words at the landing');
      if (i % 3 === 2) { run(600); continue; }
      kept++;
      ok(A.ev('(boardOptsFor(ui.session.active).opts.dots || []).indexOf(' + mv.to + ') >= 0'), at + ': its squares drawn');
      /* a tap on its square now plays it: the selection was seen */
      A.advance(40);
      const n0 = A.ev('ui.session.active.attempts');
      A.ev(`(sessionClick(${mv.to}), 1)`);
      ok(A.ev('ui.session.active.attempts') === n0 + 1, at + ': the move played from the piece picked up');
      moved++;
      run(1500);
    }
    ok(kept >= 3 && moved >= 3, 'kept ' + kept + ', moved ' + moved);
    /* reduced motion: the reply waits for its button; a piece of yours it takes, tapped before, is not picked up */
    A.ev('(ui.reducedTest = true, 1)');
    const cap = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = cardFor(it); if (!a || !a.sol || a.sol.length < 3) return false;
      var st = cloneState(a.st); applyMove(st, uciToMove(st, a.sol[0])); var r = uciToMove(st, a.sol[1]); return !!(r && st.b[r.to]); }).map(function (it) { return it.key; }).slice(0, 2))`));
    ok(cap.length >= 1, 'cards whose reply takes ' + cap.length);
    for (const key of cap) {
      A.ev(`(window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      run(800);
      const sq = A.ev('uciToMove(ui.session.active.st, ui.session.active.sol[1]).to');
      A.tap(sq);
      eq(A.ev('ui.session.active.replyQ && ui.session.active.replyQ.sq'), sq, key + ': the tap on the piece it will take is kept');
      A.click('theirReply', null, 1);
      run(400);
      eq(A.ev('ui.session.active.sel'), -1, key + ': gone with the reply, not picked up');
      eq(A.ev('ui.session.active.phase'), 'guess', key + ': your move');
    }
    A.ev('(ui.reducedTest = false, 1)');
  });

  await test('round D, S3: a press on a move being checked takes it back with nothing picked up, its click dropped; another piece of yours is then picked up as usual', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol; }).slice(0, 5).map(function (it) { return it.key; }))`));
    for (const key of cards) {
      A.ev(`(function () { ${AFTER} window.readyEngine(); window.__holdTry = true; var a = window.__show(model().byKey['${key}']); window.__m = offBook(a); return 1; })()`);
      run(1000);
      A.ev('(function (m) { sessionClick(m.from); sessionClick(m.to); return 1; })(window.__m)');
      eq(A.ev('ui.session.active.phase'), 'checking', key + ': checked');
      run(100);
      A.tap(A.ev('window.__m.to'));
      eq(A.ev('ui.session.active.phase + " " + ui.session.active.sel + " " + ui.session.active.attempts'), 'guess -1 0', key + ': taken back, nothing picked up');
      run(400);
      const other = A.ev(`(function (a, m) { for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) === a.st.w && q !== m.from) return q; return -1; })(ui.session.active, window.__m)`);
      A.tap(other);
      eq(A.ev('ui.session.active.sel'), other, key + ': another piece picked up after it');
      A.ev('(window.__holdTry = false, 1)');
    }
  });

  await test('round D, I7: → plays See it on a wrong try (after its guard, once), the key line says so only while See it is there; ↑ ↓ walk the ••• menu round from either end', () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(playerTier = function () { return 3; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const cards = JSON.parse(A.ev(`JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && !c.sol && unpackUci(it.b.ru).length; }).slice(0, 4).map(function (it) { return it.key; }))`));
    for (const key of cards) {
      A.ev(`(function () { var a = window.__show(model().byKey['${key}']); return 1; })()`);
      run(1000);
      A.ev('(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)');
      A.key('ArrowRight');
      eq(A.ev('ui.session.active.tried.seen'), false, key + ': → within the slot guard does nothing');
      run(1500);
      ok(/→ see it/.test(A.ev('displayFor(ui.session.active).keys')), key + ': the key line lists → see it');
      A.key('ArrowRight');
      eq(A.ev('ui.session.active.tried.seen'), true, key + ': → played See it');
      run(1500);
      ok(!/→ see it/.test(A.ev('displayFor(ui.session.active).keys')), key + ': and no longer lists it');
      /* V2.2: while the line goes on, → is "Next move ›", one move a press,
         listed only while the button is there */
      for (let g = 0; g < 10 && /→ next move/.test(A.ev('displayFor(ui.session.active).keys')); g++) {
        const st = A.ev('ui.session.active.tried.step');
        A.key('ArrowRight');
        eq(A.ev('ui.session.active.tried.step'), st + 1, key + ': → played the next move');
        run(1500);
      }
      ok(!/→/.test(A.ev('displayFor(ui.session.active).keys')), key + ': at the line\'s end no → listed');
      const st = A.ev('ui.session.active.tried.step');
      A.key('ArrowRight');
      eq(A.ev('ui.session.active.phase') + ' ' + A.ev('ui.session.active.tried.step'), 'tried ' + st, key + ': a last → does nothing');
    }
    /* the menu: ↑ ↓ move the keyboard through its items, round from either end */
    A.ev(`(function () {
      var items = ['open', 'analyse', 'misclick', 'decided', 'engine', 'skip'].map(function (n) { return { n: n, focus: function () { document.activeElement = this; } }; });
      var q0 = document.querySelectorAll;
      document.querySelectorAll = function (sel) { return sel === '#ctop .menu-pop a' ? items : q0.call(document, sel); };
      ui.session.active.menuOpen = true; document.activeElement = null; return 1; })()`);
    const foc = () => A.ev('document.activeElement ? document.activeElement.n : null');
    A.key('ArrowDown'); eq(foc(), 'open', 'the first item');
    A.key('ArrowDown'); eq(foc(), 'analyse', 'the next');
    A.key('ArrowUp'); A.key('ArrowUp'); eq(foc(), 'skip', 'round to the last');
    A.key('ArrowDown'); eq(foc(), 'open', 'round to the first');
    eq(A.ev('ui.session.active.phase'), 'tried', 'the board untouched');
  });

  await test('round D, I5: the typed-move field\'s example is a legal move of the position in both forms, never the answer or the game move; an illegal move is answered with one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0, said = [];
      notice = function (t) { said.push(t); };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          var m = /placeholder="e\\.g\\. ([^ ]+) or ([a-h][1-8][a-h][1-8][qrbn]?)"/.exec(stripHtml(a, ui.session));
          if (!m) { out.push(it.key + ': no example'); return; }
          var bySan = sanToMove(a.st, m[1]), byUci = uciToMove(a.st, m[2]);
          if (!bySan || !byUci || moveUci(bySan) !== m[2]) out.push(it.key + ': not one legal move ' + m[0]);
          if (cardAvoid(a).indexOf(m[2]) >= 0) out.push(it.key + ': the answer or the game move ' + m[0]);
          n++;
        });
      });
      var a = openCard(allMistakes().filter(trainable)[0]);
      typedMove('Zz9');
      var eg = /Try one like ([^ ]+) or ([a-h][1-8][a-h][1-8][qrbn]?)\\./.exec(said[0] || '');
      if (!eg || !uciToMove(a.st, eg[2]) || cardAvoid(a).indexOf(eg[2]) >= 0) out.push('the notice: ' + said[0]);
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n > 200, 'examples ' + r.n);
    eq(r.out.length, 0, r.out.slice(0, 4).join(' | '));
  });

  await test('round D, C10: a castling game move\'s ghost shows the king and the rook, one cross, in S0 and on the story\'s B1', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = 0;
      [1, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a0 = cardFor(it);
          if (!a0 || !a0.played.castle) return;
          var a = openCard(it);
          if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
          else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
          a.animMove = null; a.settle = 2;
          var g = s0Marks(a, a.st).ghosts, short_ = a.played.castle === 'O-O', base = a.played.to < 8 ? 0 : 56;
          var want = [a.played.to, base + (short_ ? 5 : 3)];
          if (g.length !== 2 || g[0].sq !== want[0] || pType(g[0].p) !== 'K' || g[1].sq !== want[1] || pType(g[1].p) !== 'R' || !g[1].rook) out.push(it.key + ': S0 ghosts ' + JSON.stringify(g));
          var f = boardOptsFor(a), svg = boardSvg(f.st, f.opts);
          var faded = (svg.match(/class="ghost-piece"/g) || []).length, empty = want.filter(function (q) { return !f.st.b[q]; }).length;
          if (faded !== empty || (svg.match(/r="6" fill="#d04a3a"/g) || []).length !== 1) out.push(it.key + ': drawn ' + faded + ' ghosts for ' + empty + ' empty squares');
          n++;
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n >= 1, 'castling game moves ' + r.n);
    eq(r.out.length, 0, r.out.join(' | '));
  });

  /* ── groundwork: the shared danger facts (11d-danger.js) ───────────── */
  await test('danger facts: card 1 lists the queen on f5 attacked by g6 and f8 and the bishop on d3 by c4, saves the queen, and is step 1, from one null-move search', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      window.readyEngine();
      var it = model().byKey['184455333378:68'];
      delete it.b.dz;
      /* their best move if it were their turn: gxf5, and the line settles */
      var l = function (pv, cp) { return { cp: cp, mate: null, pv: pv }; };
      window.__dz = { cp: -800, mate: null, pv: ['g6f5', 'e4f5', 'b4c5', 'd1h1'], depth: 18, stopped: false,
        lines: [l(['g6f5', 'e4f5', 'b4c5', 'd1h1'], -800), l(['f8f5', 'e4f5', 'b4c5', 'd1h1'], -780), l(['c4d3', 'c2d3', 'b4c5', 'd1h1'], -500)] };
      window.__p = ensureDanger(it, true);
      return JSON.stringify({ jobs: window.__dzJobs.map(function (j) { return { fen: j.fen, nodes: j.nodes, mpv: j.opts.multipv, tag: j.opts.tag, prio: j.prio }; }) });
    })()`));
    await tick(); await tick();
    const d = JSON.parse(A.ev(`(function () { var it = model().byKey['184455333378:68'], v = dangerView(cardFor(it)), a = dangerCard(it); window.__dz = null;
      return JSON.stringify({ dz: it.b.dz, ready: dangerReady(it.b), v: v, stands: [dzThreatStands(a, ['g6f5', 0, 8]), dzThreatStands(a, ['f8f5', 0, 4])] }); })()`));
    eq(r.jobs.length, 1, 'one search');
    eq(r.jobs[0].fen, '5r2/1p4k1/6p1/p3pQ2/Pqp1Pb2/3B1P2/1PP1KP2/3R4 b - - 0 35', 'the card position with Black to move, no en passant');
    eq(JSON.stringify([r.jobs[0].nodes, r.jobs[0].mpv, r.jobs[0].tag, r.jobs[0].prio]), JSON.stringify([250000, 3, '184455333378:68', true]), 'nodes, lines, tag, the player waiting');
    eq(JSON.stringify(d.dz.at.slice(0, 2)), JSON.stringify([[37, 46, 61], [19, 26]]), 'the queen on f5 by g6 and f8, then the bishop on d3 by c4');
    eq(JSON.stringify([d.v.attacked[0].p, d.v.attacked[1].p]), '["Q","B"]', 'by value');
    eq(d.dz.sv, 'Q', 'the better move saves the queen (not the bishop, which its line loses too)');
    eq(JSON.stringify(d.dz.th), JSON.stringify(['g6f5', 0, 8]), 'their threat: gxf5, a queen for a pawn');
    eq(JSON.stringify([d.v.threat.p, d.v.threat.took, d.v.step]), '["p","Q",1]', 'a pawn takes the queen; step 1');
    eq(d.dz.st, 1, 'step 1: their threat still stands after Rg1');
    eq(JSON.stringify(d.stands), '[false,true]', 'Rg1 pins the g-pawn, so gxf5 is gone; Rxf5 still takes the queen');
    ok(d.ready && d.dz.v === A.ev('DZ_V') && JSON.stringify(d.dz).length <= 120, 'stored, current, small: ' + JSON.stringify(d.dz));
  });

  await test('danger facts on every fixture card: saves names only a piece the game line lost and the best line keeps, attackers may legally take, and a card met again reads nothing again', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var out = [], n = { cards: 0, saves: 0, attacked: 0, steps: {} };
      allMistakes().filter(trainable).forEach(function (it) {
        delete it.b.dz;
        var d = dangerNow(it), a = dangerCard(it);
        if (!d || !a) { out.push(it.key + ': no facts'); return; }
        n.cards++;
        n.steps[d.st] = (n.steps[d.st] || 0) + 1;
        if (d.th !== undefined && !(checkersOf(a.pre).length && d.th === null)) out.push(it.key + ': a threat with no search ' + JSON.stringify(d.th));
        var pov = myPov(it), bl = a.cls.bestLine, gl = a.cls.gameLine;
        (d.sv || '').split('').forEach(function (t) {
          n.saves++;
          for (var i = 1; i < bl.nodes.length; i++) if (bl.nodes[i].captured && colorW(bl.nodes[i].captured) === pov && pType(bl.nodes[i].captured) === t) out.push(it.key + ': saves ' + t + ' but the best line loses one at ' + i);
          var lost = 0;
          gl.nodes.forEach(function (x) { if (x.captured && pType(x.captured) === t && colorW(x.captured) === pov) lost++; });
          if (!lost) out.push(it.key + ': saves ' + t + ' that the game line does not lose');
        });
        var nst = dzNullState(a.pre);
        d.at.forEach(function (x) {
          n.attacked++;
          if (colorW(a.pre.b[x[0]]) !== pov || pType(a.pre.b[x[0]]) === 'K') out.push(it.key + ': attacked ' + x[0] + ' is not a piece of the player');
          x.slice(1).forEach(function (f) { if (!checkersOf(a.pre).length && !uciToMove(nst, sqName(f) + sqName(x[0]))) out.push(it.key + ': ' + sqName(f) + ' cannot take on ' + sqName(x[0])); });
        });
        if (dangerOf(it.b) !== d || dangerNow(it) !== d) out.push(it.key + ': read again');
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards === 91 && r.n.saves >= 20 && r.n.attacked >= 40, JSON.stringify(r.n));
    ok(Object.keys(r.n.steps).length === 5, 'all five steps occur: ' + JSON.stringify(r.n.steps));
    eq(r.out.length, 0, r.out.length + ' faults: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('danger facts: no null-move search with the player in check, and the engine down reads them without one and asks again later', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      window.readyEngine();
      var it = model().byKey['184234373418:63'], a = dangerCard(it);
      delete it.b.dz;
      window.__dzJobs = [];
      ensureDanger(it, true);
      var inCheck = { check: checkersOf(a.pre).length > 0, jobs: window.__dzJobs.length, th: it.b.dz && it.b.dz.th, ready: dangerReady(it.b) };
      /* the engine down: the facts without a search, their threat still to ask */
      var it2 = model().byKey['184455333378:68'];
      delete it2.b.dz;
      SF.state = 'failed';
      ensureDanger(it2, true);
      var down = { jobs: window.__dzJobs.length, has: 'th' in it2.b.dz, ready: dangerReady(it2.b), st: it2.b.dz.st };
      SF.state = 'ready';
      ensureDanger(it2, true);
      return JSON.stringify({ inCheck: inCheck, down: down, jobs: window.__dzJobs.length }); })()`));
    await tick(); await tick();
    eq(JSON.stringify(r.inCheck), JSON.stringify({ check: true, jobs: 0, th: null, ready: true }), 'in check: no search, no threat, ready');
    eq(JSON.stringify(r.down), JSON.stringify({ jobs: 0, has: false, ready: false, st: 1 }), 'engine down: the facts read, no threat asked, step from the refutation');
    eq(r.jobs, 1, 'asked once the engine is up');
    /* V1.5: the stub's answer names no threat, but every capture counts, scored where its line settles: gxf5 wins the queen for a pawn */
    eq(A.ev(`JSON.stringify(model().byKey['184455333378:68'].b.dz.th)`), '["g6f5",0,8]', 'no threat in the stub\'s answer: the capture that wins the queen');
  });

  await test('danger facts: step 1 only for a danger that wins and stood before the game move (a guard taken away is a safety check), and their threat only while the game move left it standing', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var mk = function (fen, played, best, ref) {
        var pre = stateFromFen(fen), cls = classifyMistake(pre, played, { pv: best, mate: null }, { pv: ref, mate: null }, 60, 20, 40);
        return { it: { key: 'x:1', g: { color: pre.w ? 'white' : 'black' }, b: { t: cls.t } }, pre: pre, played: uciToMove(pre, played), best: uciToMove(pre, best[0]), cls: cls };
      };
      /* d5 takes away the knight's guard: Rxe5 was legal before, and losing for them */
      var guard = mk('4r1k1/8/8/4N3/3P4/8/8/6K1 w - - 0 1', 'd4d5', ['e5f3'], ['e8e5', 'g1f2']);
      /* the knight hangs to Rxe5 and Bh6 hangs the bishop too: the threat stands */
      var stands = mk('4r1k1/6p1/8/4N3/8/8/8/2B3K1 w - - 0 1', 'c1h6', ['e5f3'], ['g7h6', 'g1f2']);
      /* Nc6 moves the knight out of the threat and hangs it to bxc6: the threat was met */
      var met = mk('4r1k1/1p6/8/4N3/8/8/8/6K1 w - - 0 1', 'e5c6', ['e5f3'], ['b7c6', 'g1f2']);
      var th = ['e8e5', 0, 3];
      return JSON.stringify({
        guard: [guard.it.b.t, dangerStep(guard, null), dangerStep(guard, undefined)],
        stands: [stands.it.b.t, dangerStep(stands, th), dangerStep(stands, null), dangerStep(stands, undefined)],
        met: [met.it.b.t, dangerStep(met, th), dangerStep(met, undefined)]
      }); })()`));
    eq(JSON.stringify(r.guard.slice(1)), '[3,3]', 'a guard taken away: step 3 with no threat found and with no search (' + r.guard[0] + ')');
    eq(JSON.stringify(r.stands.slice(1)), '[1,3,3]', 'a threat that stands: step 1; none found or no search: 3 (' + r.stands[0] + ')');
    eq(JSON.stringify(r.met.slice(1)), '[3,3]', 'a threat the game move met: step 3 (' + r.met[0] + ')');
    ok(['hung', 'material'].indexOf(r.guard[0]) >= 0 && r.stands[0] === 'hung' && r.met[0] === 'hung', 'safety patterns: ' + JSON.stringify([r.guard[0], r.stands[0], r.met[0]]));
  });

  await test('tokens: the forcing card\'s settled board never sets a won token on a piece of theirs that took back there, and a token takes a corner clear of the arrow head and the tick on its square (every story frame)', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { tokens: 0, moved: 0, frames: 0 }, res = {};
      /* play a card's forcing line through, their replies included */
      var through = function (a) {
        for (var g = 0; g < 12 && a.phase !== 'done'; g++) {
          gradeMove(uciToMove(a.st, a.sol[a.solIdx]));
          var rp = a.reply;
          if (rp) { theirReply(a, false); replyDone(a, rp); }
        }
        a.animMove = null; a.settle = 2;
        return a;
      };
      var clearOf = function (o, t, sp) {
        var arrows = [].concat(o.ghost ? [{ from: o.ghost[0], to: o.ghost[1] }] : [], o.good ? [{ from: o.good[0], to: o.good[1] }] : [], o.bad ? [{ from: o.bad[0], to: o.bad[1] }] : [], o.arrows || []);
        var bd = (o.badges || []).filter(function (b) { return b.sq === t.sq; })[0], bat = bd ? bd.at || [36, 9] : null;
        return arrows.every(function (ar) { return ar.to !== t.sq || ar.from === ar.to || headClear(ar.from, ar.to, !!o.flip, sp, sp[2]); }) && !(bat && Math.hypot(sp[0] - bat[0], sp[1] - bat[1]) < sp[2] + 9.8);
      };
      var check = function (a, at) {
        var o = boardOptsFor(a).opts;
        n.frames++;
        (o.tokens || []).forEach(function (t) {
          n.tokens++;
          if (t.at) n.moved++;
          var any = TOKEN_AT.some(function (sp) { return clearOf(o, t, sp); });
          if (any && !clearOf(o, t, t.at || TOKEN_AT[0])) out.push(at + ': the token on ' + sqName(t.sq) + ' under an arrow head or the tick');
          if (t.at && clearOf(o, t, TOKEN_AT[0])) out.push(at + ': the token on ' + sqName(t.sq) + ' moved off a clear bottom-left');
        });
      };
      playerTier = function () { return 2; };
      var a = through(openCard(model().byKey['184215516284:63']));
      res.won = (a.won || []).map(function (w) { return sqName(w.sq); });
      res.s0 = s0Marks(a, a.st).tokens.map(function (t) { return sqName(t.sq); });
      res.held = a.st.b[sqIndex('c2')];
      seeWhy();
      var S = buildStory(a);
      S.steps.forEach(function (st, i) {
        a.view = { mode: 'story', i: i }; a.animMove = null;
        if (st.seg === 'better' && st.k === st.from) {
          var o = boardOptsFor(a).opts, t = (o.tokens || [])[0], svg = boardSvg(boardOptsFor(a).st, o);
          res.b1 = t ? { sq: sqName(t.sq), at: t.at || null, clear: clearOf(o, t, t.at || TOKEN_AT[0]), drawn: svg.indexOf('cx="' + ((o.flip ? 7 - t.sq % 8 : t.sq % 8) * 45 + (t.at || TOKEN_AT[0])[0]) + '" cy="' + ((o.flip ? t.sq >> 3 : 7 - (t.sq >> 3)) * 45 + (t.at || TOKEN_AT[0])[1]) + '"') >= 0 } : null;
        }
      });
      allMistakes().filter(trainable).forEach(function (it) {
        var a1 = openCard(it);
        if (!a1) return;
        if (a1.sol) through(a1); else { solved(uciToMove(a1.st, a1.bestUci), a1.bestUci, null); a1.animMove = null; a1.settle = 2; }
        check(a1, it.key + ' S0');
        seeWhy();
        var S1 = buildStory(a1);
        for (var i = 0; i < S1.steps.length; i++) { a1.view = { mode: 'story', i: i }; a1.animMove = null; check(a1, it.key + ' story ' + i); }
      });
      res.out = out; res.n = n;
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.won), '["c2","f4"]', 'the line won a bishop on c2 and one on f4');
    eq(r.held, 'Q', 'their queen took back on c2');
    eq(JSON.stringify(r.s0), '["f4"]', 'the settled board draws the f4 token only');
    ok(r.b1 && r.b1.sq === 'c2' && r.b1.at && r.b1.clear && r.b1.drawn, 'B1: the token on c2 in a corner clear of the arrow head and the tick, drawn there: ' + JSON.stringify(r.b1));
    ok(r.n.tokens >= 20 && r.n.moved >= 1, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults: ' + r.out.slice(0, 4).join(' | '));
  });

  /* Expert Suite slice 1, the real danger on every card. Card 1 is
     184455333378:68 (White's Rg1, the answer Qe6), card 2 184380745302:11
     (Black's Nc5, the wrong try Qg5), card 4 184268949378:16 (tries that
     allow Qxf2 mate) */
  await test('F1.1, the danger first: card 1\'s Hint 1 at 700, 1600 and 2000 rings the queen on f5 and the bishop on d3 red, draws the attackers\' dashed arrows from g6 and f8 (c4 third) and says "Your queen is attacked twice.", inside the spoiler rule', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${SPOILER} ${TRY}
      var out = {};
      [1, 2, 3].forEach(function (tier) {
        var a = openAt('184455333378:68', tier);
        giveHint();
        var hm = hintMarks(a), d = displayFor(a), o = boardOptsFor(a).opts;
        out[tier] = { hints: a.hints, rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }), arrows: hm.arrows.map(function (x) { return sqName(x.from) + sqName(x.to) + ' ' + x.kind + ' ' + x.key; }),
          drawn: [(o.rings || []).filter(function (x) { return x.kind === 'attacked'; }).length, (o.arrows || []).filter(function (x) { return x.kind === 'threat'; }).length],
          row1: d.row1, row2: d.row2, faults: spoilerFaults(a) };
      });
      return JSON.stringify(out); })()`));
    [1, 2, 3].forEach((t) => {
      const x = r[t], at = 'tier ' + t;
      eq(x.hints, 1, at + ': hint 1');
      eq(JSON.stringify(x.rings), '["f5 attacked","d3 attacked"]', at + ': the queen and the bishop ringed red');
      eq(JSON.stringify(x.arrows), '["g6f5 threat danger","f8f5 threat danger","c4d3 threat danger"]', at + ': the queen\'s two attackers first, the c4 pawn third');
      eq(JSON.stringify(x.drawn), '[2,3]', at + ': drawn on the board');
      /* (at More help Hint 3 can follow here, F9.2) */
      eq(x.row1 + ' / ' + x.row2, (t === 1 ? 'Hint 1 of 3' : 'Hint 1 of 2') + ' / Your queen is attacked twice.', at + ': the band');
      eq(x.faults.length, 0, at + ': ' + x.faults.join(' | '));
    });
  });

  await test('F1.1: card 2 at 700 opens with its First look hint drawn; after Qg5 misses and Try again, Hint 2 shows, not Hint 1 again; at 1600 a Hint pressed before the second miss is followed by Hint 2', async () => {
    const A = boot();
    A.ev(`(function () { ${OPEN} ${TRY} store.set('nl:tip:game', 1);
      var a = openAt('184380745302:11', 1), we = workedExample(a), hm = hintMarks(a);
      window.__h0 = [we, a.hints, !!a.predraw, hm.rings.length + hm.arrows.length, displayFor(a).row1];
      return tryMove(a, 'd8g5', ['f3g5', 'f8e7', 'g5f3'], -900); })()`);
    await tick(); await tick();
    const AFTER_TRY = `(function (a) { var t = [a.phase, a.tried && a.tried.kind, a.misses].join(' ');
      tryAgain(); a.triedHold = false;
      var d = displayFor(a), hm = hintMarks(a);
      return JSON.stringify({ t: t, hints: a.hints, row1: d.row1, rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }), arrows: hm.arrows.length, due: sqName(a.best.from) }); })(ui.session.active)`;
    const h0 = JSON.parse(A.ev('JSON.stringify(window.__h0)')), r = JSON.parse(A.ev(AFTER_TRY));
    eq(JSON.stringify(h0.slice(0, 3)), '[true,1,true]', 'the First look hint: hint 1, drawn by the app');
    ok(h0[3] > 0 && h0[4] === 'Hint 1 of 2', 'its marks and words: ' + JSON.stringify(h0));
    eq(r.t, 'tried miss 1', 'Qg5 misses');
    eq(r.hints + ' ' + r.row1, '2 Hint 2 of 2', 'the automatic hint after the miss is Hint 2');
    eq(JSON.stringify(r.rings) + ' ' + r.arrows, JSON.stringify([r.due + ' hint']) + ' 0', 'its gold ring on the piece to move, nothing of Hint 1');
    /* 1600: Hint pressed, then two misses: the automatic hint at miss 2 is the next one */
    A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184380745302:11', 2); giveHint(); window.__h1 = a.hints; return tryMove(a, 'd8g5', ['f3g5', 'f8e7', 'g5f3'], -900); })()`);
    await tick(); await tick();
    A.ev(`(function (a) { ${TRY} tryAgain(); a.triedHold = false; window.__h1 = [window.__h1, a.hints, displayFor(a).row1]; return tryMove(a, 'd8h4', ['f3h4'], -900); })(ui.session.active)`);
    await tick(); await tick();
    const r2 = JSON.parse(A.ev(AFTER_TRY)), h1 = JSON.parse(A.ev('JSON.stringify(window.__h1)'));
    eq(JSON.stringify(h1), '[1,1,"Hint 1 of 2"]', 'Hint pressed, and after miss 1 still Hint 1');
    eq(r2.t + ' / ' + r2.hints + ' ' + r2.row1, 'tried miss 2 / 2 Hint 2 of 2', 'miss 2 brings Hint 2');
  });

  await test('F1.2, a wrong try names the capture: card 2\'s Qg5 says "Their knight takes your queen." at 700 and 1600 and "Nxg5 takes your queen." at 2000, the capture See it plays, on Stockfish\'s own line (Black takes back on g5, and the line never settles); the chip "Safety check" at 1600 and 2000; the record gains a 3; Qh4 lost for nothing too; a capture the score says is paid back is not named', async () => {
    const A = boot();
    /* Stockfish 17.1's lines in the browser: Qg5 Nxg5 Nxg5 Bxg5 d5 exd6+ Be6 cxd4 Bxd6, 5.84 down, and
       Qh4 Nxh4 d5 exd6 Bxd6 Qxe4+ Kd8 Kd1 Re8, 6.00 down (a queen for nothing in the score's pawns);
       a line where nothing is taken back; and Qg5's line scored only 2.5 down, as if paid back later */
    const QG5 = ['f3g5', 'e4g5', 'c1g5', 'd7d5', 'e5d6', 'c8e6', 'c3d4', 'f8d6'], QH4 = ['f3h4', 'd7d5', 'e5d6', 'f8d6', 'e2e4', 'e8d8', 'e1d1', 'h8e8'];
    const TK = 'Their knight takes your queen.';
    const CASES = [[1, 'd8g5', QG5, -584, TK], [2, 'd8g5', QG5, -584, TK], [3, 'd8g5', QG5, -584, 'Nxg5 takes your queen.'],
      [2, 'd8g5', ['f3g5', 'f8e7', 'g5f3'], -900, TK], [2, 'd8h4', QH4, -600, TK], [3, 'd8h4', QH4, -600, 'Nxh4 takes your queen.'],
      [2, 'd8g5', QG5, -250, 'After Nxg5, White is better.']];
    for (const [tier, u, line, cp, want] of CASES) {
      A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184380745302:11', ${tier}), rec = srsRec(a.it); window.__fc0 = (rec && rec.fc) || '';
        return tryMove(a, '${u}', ${JSON.stringify(line)}, ${cp}); })()`);
      await tick(); await tick();
      const r = JSON.parse(A.ev(`(function (a) { var t = a.tried, w = a.reason, d0 = displayFor(a); a.reason = 2; var d = displayFor(a);
        var res = { kind: t.kind, early: d0.row2 + '|' + d0.chip, row1: d.row1, row2: d.row2, chip: d.chip, reply: t.reply, lost: t.lost && (sqName(t.lost.sq) + t.lost.p), fc: a.fc };
        seeIt(); a.animMove = null;
        res.seen = boardOptsFor(a).st.b[sqIndex('${u.slice(2)}')];
        tryAgain(); a.triedHold = false;
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        res.rec = srsRec(a.it).fc; res.fc0 = window.__fc0;
        return JSON.stringify(res); })(ui.session.active)`));
      const at = 'tier ' + tier + ', ' + u + ' ' + cp, named = !/^After /.test(want);
      eq(r.kind + ' ' + r.row1, 'miss Not this one', at + ': a miss');
      eq(r.early, '|', at + ': no reason and no chip before the reason\'s beat');
      eq(r.row2, want, at + ': row 2');
      eq(r.chip, tier >= 2 && named ? 'Safety check' : '', at + ': the chip');
      eq(r.reply + ' ' + r.lost, line[0] + ' ' + u.slice(2) + 'q', at + ': See it plays the capture it names');
      eq(r.seen, 'N', at + ': their knight stands there once See it played');
      eq(r.fc, named ? '3' : '0', at + ': the try\'s check step on the card');
      eq(r.rec, r.fc0 + r.fc, at + ': the record gains it when the showing ends');
    }
  });

  await test('F1.2: card 4\'s h3 (their mate there before the try) says "Then Qxf2 is checkmate." with the chip "Their move" at 1600 and 2000, "Then queen takes on f2 is checkmate." at 700; the record gains a 1', async () => {
    const A = boot();
    for (const tier of [1, 2, 3]) {
      A.ev(`(function () { ${OPEN} ${TRY} var a = openAt('184268949378:16', ${tier}), rec = srsRec(a.it); window.__fc0 = (rec && rec.fc) || '';
        return tryMove(a, 'h2h3', ['f6f2'], -1500, -1); })()`);
      await tick(); await tick();
      const r = JSON.parse(A.ev(`(function (a) { a.reason = 2; var d = displayFor(a), res = { kind: a.tried.kind, row2: d.row2, chip: d.chip, reply: a.tried.reply, fc: a.fc };
        tryAgain(); a.triedHold = false; skipCard();
        res.rec = srsRec(a.it) && srsRec(a.it).fc; res.fc0 = window.__fc0;
        return JSON.stringify(res); })(ui.session.active)`));
      const at = 'tier ' + tier;
      eq(r.kind + ' ' + r.reply, 'miss f6f2', at + ': a miss, their queen mates on f2');
      eq(r.row2, tier === 1 ? 'Then queen takes on f2 is checkmate.' : 'Then Qxf2 is checkmate.', at + ': row 2');
      eq(r.chip, tier >= 2 ? 'Their move' : '', at + ': the chip');
      eq(r.fc + ' ' + r.rec, '1 ' + r.fc0 + '1', at + ': a 1 on the card, and on the record once the card is left');
    }
  });

  await test('F1.3: card 4 at 1600, two tries that allow Qxf2 mate: Try again draws that mate (f2 ringed, the queen\'s dashed arrow) with "Both tries allowed Qxf2 mate."; at 700 "Both tries let them mate on f2."; at 2000 no automatic hint', async () => {
    const A = boot();
    const out = {};
    for (const tier of [1, 2, 3]) {
      A.ev(`(function () { ${OPEN} ${TRY} return tryMove(openAt('184268949378:16', ${tier}), 'h2h3', ['f6f2'], -1500, -1); })()`);
      await tick(); await tick();
      A.ev(`(function (a) { ${TRY} tryAgain(); a.triedHold = false; return tryMove(a, 'a2a3', ['f6f2'], -1500, -1); })(ui.session.active)`);
      await tick(); await tick();
      out[tier] = JSON.parse(A.ev(`(function (a) { ${SPOILER} tryAgain(); a.triedHold = false;
        var hm = hintMarks(a), d = displayFor(a);
        return JSON.stringify({ misses: a.misses, hints: a.hints, fc: a.fc, rep: !!hm.rep, rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }),
          arrows: hm.arrows.map(function (x) { return sqName(x.from) + sqName(x.to) + ' ' + x.key; }), row1: d.row1, row2: d.row2, faults: spoilerFaults(a),
          bar: d.buttons.map(function (b) { return b.label || ''; }).join(' '), lab: (frameLabel(a, boardOptsFor(a), 384, false, function () { return true; }) || {}).text || '',
          aria: /after both your tries, the queen on f6 could give checkmate on f2\./.test(boardOptsFor(a).opts.label) }); })(ui.session.active)`));
    }
    const t2 = out[2], t1 = out[1], t3 = out[3];
    eq(t2.misses + ' ' + t2.hints + ' ' + t2.fc, '2 1 11', 'tier 2: two misses, the automatic hint, both tries step 1');
    eq(JSON.stringify([t2.rep, t2.rings, t2.arrows]), JSON.stringify([true, ['f2 attacked'], ['f6f2 tries']]), 'tier 2: the mate drawn');
    eq(t2.row1 + ' / ' + t2.row2, 'Hint 1 of 2 / Both tries allowed Qxf2 mate.', 'tier 2: the band');
    eq(t2.lab + ' ' + t2.aria, 'mate true', 'tier 2: its label and its board name say the mate');
    eq(t2.faults.length, 0, 'tier 2: ' + t2.faults.join(' | '));
    /* tier 1's "Both tries let them mate on f2." is seven words, one more
       than row 1 and the bar leave row 2 of the frame's 15: its shorter form */
    const n = (x) => x.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    ok(n(t1.row1) + n(t1.bar) + 7 > 15, 'tier 1: the long form is over the frame\'s words: ' + t1.row1 + ' / ' + t1.bar);
    eq(JSON.stringify([t1.rep, t1.rings, t1.arrows, t1.row2]), JSON.stringify([true, ['f2 attacked'], ['f6f2 tries'], 'Both tries allowed mate on f2.']), 'tier 1: the hint of miss 1 now draws the mate both tries allowed');
    eq(t1.faults.length, 0, 'tier 1: ' + t1.faults.join(' | '));
    eq(t3.hints + ' ' + t3.row1, '0 Your turn', 'tier 3: no automatic hint');
  });

  await test('F1.4, what the better move saves: card 1 found at 1600 settles on "Qe6 saves your queen. Rg1 lost it.", at 700 on "Queen to e6 saves your queen.", at 2000 on "Only move: Qe6 48%. Next best 33%." from its two-line search (V1.4: 10 points worse, a step lower, at 40% or less), "Best:" when the next best stays above 40% under a best below 80% (as 1600 without one, or with the next best close); the story ends on the same claim', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var it = model().byKey['184455333378:68'], b = it.b, out = {};
      var settled = function (tier, g2) {
        if (g2 === undefined) delete b.g2; else b.g2 = g2;
        var a = openAt(it.key, tier);
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
        var row = displayFor(a).row2, S = (seeWhy(), buildStory(a));
        return [row, S.steps[S.steps.length - 1].cap];
      };
      out.t1 = settled(1); out.t2 = settled(2); out.t3 = settled(3, 15); out.t3only = settled(3, 30); out.t3none = settled(3); out.t3close = settled(3, 6);
      var wb0 = b.wb; b.wb = 65; out.t3best = settled(3, 15); b.wb = 85; out.t3high = settled(3, 15); b.wb = wb0;
      out.wb = b.wb; out.sv = dangerNow(it).sv;
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.t2), JSON.stringify(['Qe6 saves your queen. Rg1 lost it.', 'Better: Qe6 saves your queen.']), 'tier 2');
    eq(JSON.stringify(r.t1), JSON.stringify(['Queen to e6 saves your queen.', 'Better: queen to e6. Your queen is safe there.']), 'tier 1');
    /* V1.4: "Only move" where the next best is 10 or more points worse, a step lower, and at 40% or less (or the best at 80% or more): at 33% it is */
    eq(JSON.stringify(r.t3), JSON.stringify(['Only move: Qe6 48%. Next best 33%.', 'Only move: Qe6 48%. Next best 33%.']), 'tier 3, its gap 15');
    eq(JSON.stringify(r.t3only), JSON.stringify(['Only move: Qe6 48%. Next best 18%.', 'Only move: Qe6 48%. Next best 18%.']), 'tier 3, its gap 30');
    eq(r.t3best[0], 'Best: Qe6 65%. Next best 50%.', 'the next best above 40% under a best below 80%: "Best"');
    eq(r.t3high[0], 'Only move: Qe6 85%. Next best 70%.', 'the best at 80% or more: "Only move"');
    ok(Math.abs(Math.round(r.wb) - 49) <= 2 && Math.abs(Math.round(r.wb) - 15 - 34) <= 2, 'the figures within 2 points of 49 and 34');
    eq(JSON.stringify(r.t3none), JSON.stringify(r.t2), 'tier 3 with no search: as tier 2');
    eq(JSON.stringify(r.t3close), JSON.stringify(r.t2), 'tier 3 with the next best 6 points worse: no only-move line');
    eq(r.sv, 'Q', 'it saves the queen, never the bishop its line loses too');
  });

  await test('F1.4: every "saves" (or "keeps") claim on the 91 cards holds (the settled line and the story\'s end, tiers 1 to 3): the piece is one the better line saves, and the game move lost it', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var out = [], n = { cards: 0, saves: 0, lost: 0, safe: 0, only: 0 };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          var a = openCard(it);
          if (!a) return;
          n.cards++;
          var d = dangerNow(it), sv = (d && d.sv) || '', pw = function (w) { return { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' }[w]; };
          if (a.sol) { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
          else solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
          a.animMove = null; a.settle = 2;
          var row = displayFor(a).row2, S = (seeWhy(), buildStory(a)), cap = S.steps[S.steps.length - 1].cap, game = sanOf(a.pre, a.played);
          [['settled', row], ['story end', cap]].forEach(function (x) {
            var m = / (?:saves|keeps) your (\\w+)\\b|Your (\\w+) is safe/.exec(x[1]);
            if (/Only move: /.test(x[1])) n.only++;
            if (!m) return;
            var t = pw(m[1] || m[2]);
            if (m[2]) n.safe++; else n.saves++;
            if (!t || sv.indexOf(t) < 0) out.push('tier ' + tier + ' ' + it.key + ' ' + x[0] + ': "' + x[1] + '" but it saves "' + sv + '"');
            if (x[1].indexOf(game + ' lost it.') >= 0 || x[1].indexOf(moveWords(a.pre, a.played) + ' lost it.') >= 0) n.lost++;
          });
          if (/ lost it\\./.test(row) && !/ (?:saves|keeps) your /.test(row)) out.push('tier ' + tier + ' ' + it.key + ': "lost it" with nothing saved: ' + row);
          /* "saves" only for a piece in danger on the card's position, else "keeps" (the coach's review) */
          var sm = / (saves|keeps) your (\\w+)\\b/.exec(row);
          if (sm) {
            var was = dangerView(a).attacked.some(function (q) { return pType(q.p) === sv.charAt(0); });
            if ((sm[1] === 'saves') !== was) out.push('tier ' + tier + ' ' + it.key + ': "' + sm[1] + '" where the piece was ' + (was ? '' : 'not ') + 'in danger: ' + row);
            n[sm[1]] = (n[sm[1]] || 0) + 1;
          }
        });
      });
      return JSON.stringify({ out: out, n: n }); })()`));
    ok(r.n.cards === 273 && r.n.saves >= 30 && r.n.safe >= 5 && r.n.lost >= 8 && r.n.keeps >= 5, JSON.stringify(r.n));
    eq(r.out.length, 0, r.out.length + ' faults: ' + r.out.slice(0, 4).join(' | '));
  });

  await test('F1.5, the danger frame opens See why: card 1 answered at 1600 shows a still frame 0 (the three dashed arrows, f5 and d3 ringed, fxg6 tinted) with "After fxg6: queen attacked twice, bishop once."; the next tap plays Rg1; at 700 "Their last move attacks your queen twice."', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var out = {};
      [1, 2].forEach(function (tier) {
        var a = openAt('184455333378:68', tier);
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
        seeWhy();
        var f = boardOptsFor(a), o = f.opts, d = displayFor(a), S = buildStory(a);
        var x = { i: a.view.i, seg: S.steps[0].seg, df: !!S.steps[0].df, anim: o.anim || null, mark: (o.mark || []).map(sqName).join(''), cap: d.cap,
          arrows: (o.arrows || []).map(function (m) { return sqName(m.from) + sqName(m.to) + ' ' + m.kind; }), rings: (o.rings || []).map(function (m) { return sqName(m.sq) + ' ' + m.kind; }),
          fen: stateFen(f.st) === stateFen(a.pre), bad: o.bad || null, g: S.g };
        storyStep(1);
        var s1 = S.steps[a.view.i], n1 = s1.line.nodes[s1.k];
        x.next = [a.view.i, s1.seg, n1.move ? sanOf(n1.before, n1.move) : ''];
        out[tier] = x;
      });
      return JSON.stringify(out); })()`));
    const t2 = r[2];
    eq(JSON.stringify([t2.i, t2.seg, t2.df, t2.anim, t2.bad, t2.fen]), JSON.stringify([0, 'danger', true, null, null, true]), 'frame 0: the card\'s own position, nothing moving, no game arrow yet');
    eq(JSON.stringify(t2.arrows), JSON.stringify(['g6f5 threat', 'f8f5 threat', 'c4d3 threat']), 'the three dashed arrows');
    eq(JSON.stringify(t2.rings), JSON.stringify(['f5 attacked', 'd3 attacked']), 'the two rings');
    eq(t2.mark, 'f7g6', 'their last move fxg6 tinted');
    eq(t2.cap, 'After fxg6: queen attacked twice, bishop once.', 'the caption');
    eq(JSON.stringify(t2.next), JSON.stringify([1, 'game', 'Rg1']), 'the next tap plays Rg1');
    eq(r[1].cap, 'Their last move attacks your queen twice.', 'tier 1 (the coach\'s review)');
  });

  await test('F1.4\'s figures: a tier-3 card with no gap on its record asks one background two-line search as it opens, and keeps the gap against its own best move only; none at tier 2', async () => {
    const A = boot();
    A.ev(`(function () { window.readyEngine(); var it = model().byKey['184455333378:68']; delete it.b.g2; ensureDanger(it, true); return 1; })()`);
    await tick(); await tick();
    const open = (tier) => JSON.parse(A.ev(`(function () { playerTier = function () { return ${tier}; }; window.__evals = []; window.readyEngine();
      ui.session = { mode: 't', label: 't', keys: ['184455333378:68'], idx: 0, results: {}, relearn: [], relearnOf: {} };
      loadCard();
      var a = ui.session.active, jobs = window.__evals.filter(function (j) { return j.opts.multipv === 2; });
      window.__job = jobs[0];
      return JSON.stringify({ shown: !!a && a.phase, n: jobs.length, fen: jobs[0] && jobs[0].fen, prio: jobs[0] && jobs[0].prio }); })()`));
    eq(JSON.stringify(open(2)), JSON.stringify({ shown: 'guess', n: 0 }), 'tier 2: no search');
    const t3 = open(3);
    eq(JSON.stringify([t3.shown, t3.n, t3.prio]), JSON.stringify(['guess', 1, false]), 'tier 3: the card shown at once, one search in the background');
    eq(t3.fen, '5r2/1p4k1/6p1/p3pQ2/Pqp1Pb2/3B1P2/1PP1KP2/3R4 w - - 0 35', 'on the card\'s position');
    eq(A.ev('(ensureGap(model().byKey["184455333378:68"]), window.__evals.filter(function (j) { return j.opts.multipv === 2; }).length)'), 1, 'asked once while it runs');
    A.ev(`(window.__job.res({ cp: -26, mate: null, pv: ['f5e6'], lines: [{ cp: -26, mate: null, pv: ['f5e6'] }, { cp: -150, mate: null, pv: ['f5f6'] }], depth: 18, stopped: false }), 1)`);
    await tick(); await tick();
    eq(A.ev('model().byKey["184455333378:68"].b.g2'), A.ev('Math.round(winPct(-26) - winPct(-150))'), 'the gap kept');
    /* lines without the card's best move keep nothing */
    A.ev(`(function () { var it = model().byKey['184455333378:68']; delete it.b.g2; window.__evals = []; ensureGap(it);
      window.__evals[0].res({ cp: 30, mate: null, pv: ['f5f6'], lines: [{ cp: 30, mate: null, pv: ['f5f6'] }, { cp: -150, mate: null, pv: ['f5g5'] }], depth: 18, stopped: false }); return 1; })()`);
    await tick(); await tick();
    eq(A.ev('String(model().byKey["184455333378:68"].b.g2)'), 'undefined', 'no gap from lines that miss the card\'s best move');
  });

  await test('the piece ledger (F1.2, F1.4): a trade in the board\'s own pieces, black ones haloed, two characters and no words each, said in words for a screen reader', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      var s = 'Rg1 lost \\u2655\\u2657 for \\u265c.', h = ledgerHtml(s), found = null;
      [2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          if (found) return;
          var a = openCard(it);
          if (!a || a.sol) return;
          solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
          var d = displayFor(a);
          if (/[\\u2654-\\u265f]/.test(d.row2)) found = { key: it.key, row2: d.row2, html: bandHtml(a, d), live: d.live };
        });
      });
      return JSON.stringify({ say: ledgerSay(s), icons: (h.match(/class="pc-ico/g) || []).length, black: (h.match(/pc-ico pc-b/g) || []).length, sr: /<span class="sr-only">Rg1 lost a queen and a bishop for a rook\\.<\\/span>/.test(h),
        len: rowLen(s), fits: fitsRow(s, 'row2'), found: found }); })()`));
    eq(r.say, 'Rg1 lost a queen and a bishop for a rook.', 'the words');
    eq(r.icons + ' ' + r.black + ' ' + r.sr, '3 1 true', 'three board pieces, the black rook haloed, the words for a screen reader');
    eq(r.len, 21, 'each piece two characters');
    ok(r.fits, 'it fits row 2');
    ok(r.found && /class="pc-ico/.test(r.found.html) && !/[♔-♟]/.test(r.found.live), 'a fixture card says a trade in pieces, its live words in words: ' + JSON.stringify(r.found));
  });

  /* ── the review of slice 1: four hints that taught the wrong danger (the coach), and the words ── */
  await test('review of slice 1, the danger: a piece its king guards against a lone queen is not in danger; card 7 (Bf3) is a safety check whose hint and frame say the mate it allows, never the pawn their queen eyes; card 3 (O-O) stops their mate and allows Bxc3, its hint the two threats (V2.3), with both threats on frame 0 and what Qf3 guards; card 12 (Rxf3) names the bishop it loses, never the plan line; card 5, in check, says the check', async () => {
    const A = boot();
    /* the static exchange: g7 guarded by its king against a lone queen, then attacked twice */
    const see = JSON.parse(A.ev(`JSON.stringify([dangerAttacked(stateFromFen('6k1/6p1/8/8/8/8/1Q6/6K1 b - - 0 1'), false), dangerAttacked(stateFromFen('6k1/6p1/7B/8/8/8/1Q6/6K1 b - - 0 1'), false)])`));
    eq(JSON.stringify(see), JSON.stringify([[], [[54, 47, 9]]]), 'a pawn its king guards is safe from a lone queen; with a bishop beside her it is not');
    /* their searches: card 7, Qxa6 winning a pawn; card 3, Qxf2 mate and Bxc3 winning */
    A.ev(`(function () { window.readyEngine();
      var l = function (pv, cp, mate) { return { cp: cp, mate: mate == null ? null : mate, pv: pv }; }, go = function (k, r) { var it = model().byKey[k]; delete it.b.dz; window.__dz = r; ensureDanger(it, true); };
      go('184435538450:67', { cp: 150, mate: null, pv: ['b7a6'], depth: 18, stopped: false, lines: [l(['b7a6', 'e8e6', 'a6b5', 'd8d6', 'b5c4', 'h7h6'], 150)] });
      return 1; })()`);
    await tick(); await tick();
    A.ev(`(function () { window.readyEngine(); var it = model().byKey['184268949378:16']; delete it.b.dz;
      window.__dz = { cp: 0, mate: -1, pv: ['f6f2'], depth: 18, stopped: false, lines: [{ cp: 0, mate: -1, pv: ['f6f2'] }, { cp: -500, mate: null, pv: ['d4c3', 'b2c3', 'f6c3', 'e1f1', 'c3a1', 'h2h3', 'd7d6'] }] };
      ensureDanger(it, true); return 1; })()`);
    await tick(); await tick();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${SPOILER} window.__dz = null;
      var hint = function (k, tier) { var a = openAt(k, tier); a.hints = 1; a.hintAfter = true; var hm = hintMarks(a), d = displayFor(a);
        return { row2: d.row2, kind: hm.dz && hm.dz.kind, rings: hm.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind + (x.mate ? ' mate' : ''); }), arrows: hm.arrows.map(function (x) { return sqName(x.from) + sqName(x.to) + ' ' + x.key; }), step: dangerView(a).step, faults: spoilerFaults(a) }; };
      var settled = function (k, tier) { var a = openAt(k, tier); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
        var S = buildStory(a), f0 = S.steps[0];
        return { row2: displayFor(a).row2, frame: f0.df ? f0.cap : '', rings: f0.df ? f0.df.rings.map(function (x) { return sqName(x.sq) + ' ' + x.kind; }) : [], arrows: f0.df ? f0.df.arrows.map(function (x) { return sqName(x.from) + sqName(x.to); }) : [], check: checkLine(a) }; };
      var out = {};
      out.at7 = dangerNow(model().byKey['184435538450:67']).at.map(function (x) { return sqName(x[0]); });
      out.c7 = [hint('184435538450:67', 1), hint('184435538450:67', 2)]; out.s7 = [settled('184435538450:67', 1), settled('184435538450:67', 2)];
      out.c3 = [hint('184268949378:16', 1), hint('184268949378:16', 2)]; out.s3 = [settled('184268949378:16', 1), settled('184268949378:16', 2), settled('184268949378:16', 3)];
      out.c12 = [hint('184212737262:56', 1), hint('184212737262:56', 2)]; out.s12 = settled('184212737262:56', 2);
      out.c5 = [1, 2, 3].map(function (t) { return hint('184234373418:63', t); });
      return JSON.stringify(out); })()`));
    /* card 7 */
    ok(r.at7.indexOf('g7') < 0, 'card 7: g7 (its king guards it, the bishop blocks the file) is not in danger: ' + r.at7.join(','));
    eq(JSON.stringify(r.c7.map((x) => [x.step, x.kind, x.row2])), JSON.stringify([[3, 'madeMate', 'Bishop to f3 lets them mate you.'], [3, 'madeMate', 'Bf3 lets them mate you.']]), 'card 7: a safety check, the mate Bf3 allows');
    eq(JSON.stringify([r.c7[1].rings, r.c7[1].arrows]), JSON.stringify([['g7 attacked mate'], ['b7g7 hint']]), 'card 7: the mating square and the queen\'s arrow, never the a6 pawn as in danger');
    ok(r.c7.every((x) => !x.faults.length), 'card 7: spoiler clean');
    eq(JSON.stringify(r.s7.map((x) => [x.frame, x.rings])), JSON.stringify([['Your bishop on g4 blocks their mate.', ['g4 block']], ['Your bishop on g4 blocks their mate.', ['g4 block']]]), 'card 7: See why opens on what the bishop blocked');
    /* card 3 */
    /* V2.3: two threats, never praise for the game move ("Castling stops
       mate." is gone); the hint frame leaves row 2 six words, so the spec's
       seven-word forms give way to their six-word rungs */
    eq(JSON.stringify(r.c3.map((x) => [x.step, x.kind, x.row2])), JSON.stringify([[1, 'two', 'Stop the mate, guard your knight.'], [1, 'two', 'Two threats: Qxf2 mate and Bxc3+.']]), 'card 3: the two threats');
    eq(JSON.stringify([r.c3[1].rings, r.c3[1].arrows]), JSON.stringify([['f2 attacked mate', 'c3 attacked'], ['f6f2 danger', 'd4c3 danger']]), 'card 3: both threats drawn');
    eq(JSON.stringify(r.s3.map((x) => [x.frame, x.row2])), JSON.stringify([['Two threats: mate on f2 and your knight.', 'Queen to f3 guards f2 and your knight.'], ['Two threats: Qxf2 mate and Bxc3+.', 'Qf3 guards f2 and your knight.'], ['Two threats: Qxf2 mate and Bxc3+.', 'Qf3 guards f2 and your knight.']]), 'card 3: frame 0 and the settled line');
    eq(JSON.stringify([r.s3[1].rings, r.s3[1].arrows]), JSON.stringify([['f2 attacked', 'c3 attacked'], ['f6f2', 'd4c3']]), 'card 3: both threats drawn on frame 0');
    eq(JSON.stringify([r.s3[1].check, r.s3[2].check]), JSON.stringify(['Their move: what does it attack?', 'Their threat: Bxc3+ takes your knight.']), 'card 3: its check line, tier 3\'s the threat that stood (V2.5: with its sign)');
    /* card 12 */
    eq(JSON.stringify(r.c12.map((x) => [x.step, x.kind, x.row2, x.rings.length + x.arrows.length])), JSON.stringify([[3, 'lost', 'That lets them win your bishop.', 0], [3, 'lost', 'Rxf3 lets them win your bishop.', 0]]), 'card 12: the bishop it loses, in words');
    eq(r.s12.check, 'Before you move: their checks, captures, threats?', 'card 12: a safety check, never the plan line');
    /* card 5 */
    eq(JSON.stringify(r.c5.map((x) => [x.kind, x.row2, x.rings.length + x.arrows.length])), JSON.stringify([['check', 'In check: move, block or take?', 0], ['check', 'In check: move, block or take?', 0], ['check', 'In check: move, block or take?', 0]]), 'card 5: in check, the check, nothing drawn');
  });

  await test('review of slice 1, the words: a try that leaves the queen attacked says so (step 1); the answer guard compares whole moves (Qxc5 is not c5); "on top" is gone; "keeps" for a piece the game move put in danger; "Move the circled piece." after a ring on the piece where the safe squares are not all good (V2.3); "Both tries gave away your queen."; where your game left it ("In your game, Nc5 left White better."); a move that works too names the main move (V1.2)', async () => {
    const A = boot();
    const tries = [];
    for (const [key, tier, u, pv, cp] of [['184455333378:68', 1, 'd3c4', ['b4c4'], -150], ['184455333378:68', 2, 'd3c4', ['b4c4'], -150], ['184234373418:63', 2, 'd5c5', ['b4c5', 'd7d8'], -900], ['184234373418:63', 3, 'd5c5', ['b4c5', 'd7d8'], -900], ['184380745302:11', 2, 'd8g5', ['f3g5', 'e4g5', 'c1g5', 'd7d5', 'e5d6', 'c8e6', 'c3d4', 'f8d6'], -250]]) {
      A.ev(`(function () { ${OPEN} ${TRY} return tryMove(openAt('${key}', ${tier}), '${u}', ${JSON.stringify(pv)}, ${cp}); })()`);
      await tick(); await tick();
      tries.push(JSON.parse(A.ev(`(function (a) { a.reason = 2; var d = displayFor(a); return JSON.stringify([d.row2, a.fc, a.tried.chip]); })(ui.session.active)`)));
    }
    eq(JSON.stringify(tries[0]), JSON.stringify(['Your queen is still attacked.', '1', '']), 'card 1, tier 1: Bxc4 Qxc4 leaves the queen attacked, their move (1)');
    eq(JSON.stringify(tries[1]), JSON.stringify(['Qxc4, and your queen is still attacked.', '1', 'Their move']), 'card 1, tier 2: the reply named, the step its chip (the frame drops it where it has no room)');
    eq(tries[2][0], 'Their queen takes your queen.', 'card 5, tier 2');
    eq(tries[3][0], 'Qxc5+ takes your queen.', 'card 5, tier 3: Qxc5 is not the answer c5 (V2.5: with its check sign)');
    eq(tries[4][0], 'After Nxg5, White is better.', 'card 2: "better", never "on top"');
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var out = {}, settle = function (k, tier) { var a = openAt(k, tier); solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2; var S = buildStory(a); return [displayFor(a).row2, S.steps[S.steps.length - 1].cap]; };
      out.keep = [settle('184432739572:22', 1), settle('184432739572:22', 2)];
      out.left = [settle('184380745302:11', 1), settle('184380745302:11', 2)];
      out.step2 = dangerView(openAt('184380745302:11', 2)).step;
      var a = openAt('184455333378:68', 2); a.hints = 2; out.safe = displayFor(a).row2;
      a = openAt('184426845252:17', 2); a.hints = 2; out.safe4 = displayFor(a).row2;
      out.both = repeatedWords(openAt('184455333378:68', 2), { mate: false, took: 'Q', lost: false, to: 37, san: '' });
      /* card 12's works too: the main move named (V1.2) */
      out.alt = [1, 2].map(function (tier) { var b = openAt('184212737262:56', tier), m = uciToMove(b.st, 'g2f3'), af = cloneState(b.st); applyMove(af, m); var rp = legalMoves(af)[0];
        b.yours = { uci: ['g2f3'].concat(rp ? [moveUci(rp)] : []), cp: 0, at: 0 }; solved(m, 'g2f3', { win: 50, best: 52, mate: null }); b.animMove = null; b.settle = 2; return displayFor(b).row1 + ' / ' + displayFor(b).row2; });
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.keep), JSON.stringify([['Pawn to f4 keeps your queen.', 'Better: pawn to f4. Your queen is safe.'], ['f4 keeps your queen.', 'Better: f4 keeps your queen.']]), 'card 8: the queen was safe until Qf3, so f4 keeps it');
    eq(JSON.stringify(r.left.map((x) => x[0])), JSON.stringify(['Knight to c5 left White better.', 'In your game, Nc5 left White better.']), 'card 2: said of your game');
    eq(r.step2, 1, 'card 2: the knight their queen attacked, which d5 guards: their move (the coach\'s note for slice 2)');
    /* V2.3: "Find a safe square." only where every safe square of the piece
       holds; with no fact sheet (no checked moves of it) that is known only
       for a piece with one safe square, so these say "Move the circled piece." */
    eq(r.safe + ' / ' + r.safe4, 'Move the circled piece. / Move the circled piece.', 'hint 2 on a piece hint 1 rang (cards 1 and 4)');
    eq(JSON.stringify(r.both), JSON.stringify(['Both tries let them take your queen.', 'Both tries gave away your queen.']), 'both tries\' short form says what');
    eq(JSON.stringify(r.alt), JSON.stringify(['That works too / The main move was bishop to c3.', 'That works too / The main move was Bc3.']), 'card 12, a move that works too: the main move, never "you were better"');
  });

  /* ── slice 2: the honest summary and one routine ── */
  await test('F2.1: the tour\'s set (Rg1 first try; Nc5 after a miss; Be4 a good move, then found; O-O after two misses; bxc5 first try) reads "2 of 5 found first try." then "2 after a miss · 1 after a good move" at 1600, and "You found all 5." then "3 took more than one try." at 700 (V4.3: never "of 15"; card 2\'s First look hint costs no star); each tile shows its result\'s glyph before its word', async () => {
    const run = async (tier) => {
      const A = boot({ storage: Object.assign(base(), { 'nl:tip:game': '1' }) });
      A.ev(`(function () { playerTier = function () { return ${tier}; }; window.readyEngine();
        ui.session = { mode: 'today', label: 'Today', keys: ['184455333378:68', '184380745302:11', '184331579496:34', '184268949378:16', '184205946040:62'], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
        return 1; })()`);
      const open = (i) => A.ev(`(function () { window.readyEngine(); var ss = ui.session; ss.idx = ${i}; var a = cardFor(model().byKey[ss.keys[${i}]]); ss.active = a; if (${tier} === 1 && ${i} === 1) workedExample(a); return 1; })()`);
      const best = () => A.ev('(function (a) { gradeMove(uciToMove(a.st, a.bestUci)); return 1; })(ui.session.active)');
      const game = async () => { A.ev('(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })(ui.session.active)'); await tick(); A.ev('(function (a) { tryAgain(); return 1; })(ui.session.active)'); };
      open(0); best();
      open(1); await game(); best();
      open(2); A.ev(`(function (a) { window.__tryCp = cpFromWin(winPct(a.it.b.eb) - 7); window.__bestCp = a.it.b.eb; window.__tryPv = null; gradeMove(legalMoves(a.st).filter(function (m) { return moveUci(m) !== a.bestUci && moveUci(m) !== a.playedUci; })[0]); return 1; })(ui.session.active)`);
      await tick(); await tick();
      const close = A.ev('ui.session.active.tried && ui.session.active.tried.kind');
      A.ev('(function (a) { window.__tryCp = null; window.__bestCp = null; tryAgain(); return 1; })(ui.session.active)');
      best();
      open(3); await game(); await game(); best();
      open(4); best();
      return JSON.parse(A.ev(`(function () { var ss = ui.session; ss.active = null; ss.finished = true; var h = doneHtml(ss);
        return JSON.stringify({ close: '${close}', head: (/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1], then: (/class="recap-then">([^<]*)</.exec(h) || [])[1], cats: ss.keys.map(function (k) { return ss.sum[k].c; }).join(' '),
          stars: ss.keys.map(function (k) { return ss.sum[k].s; }).join(''), words: (h.match(/class="res[^"]*">[^<]*/g) || []).map(function (x) { return x.replace(/^.*>/, ''); }),
          glyphs: (h.match(/<span class="rg rg-\\w+" aria-hidden="true"><\\/span><span class="res/g) || []).map(function (x) { return /rg-(\\w+)/.exec(x)[1]; }).join(' '),
          row: (((/<div class="result-row" aria-hidden="true">([\\s\\S]*?)<\\/div>/.exec(h) || [])[1] || '').match(/rg-\\w+/g) || []).map(function (x) { return x.slice(3); }).join(' ') }); })()`));
    };
    const t2 = await run(2), t1 = await run(1);
    eq(t2.close, 'close', 'card 3: a good move first');
    eq(t2.cats, 'first miss good miss first', 'the categories, the worst event deciding');
    eq(t2.head + ' / ' + t2.then, '2 of 5 found first try. / 2 after a miss · 1 after a good move', 'tier 2 (V4.3)');
    eq(JSON.stringify(t2.words), JSON.stringify(['First try', 'After a miss', 'After a good move', 'After a miss', 'First try']), 'the tiles\' words');
    eq(t2.glyphs, 'first miss good miss first', 'each tile\'s glyph before its word (F3.1): ticks on cards 1 and 5, a ring tick on card 3, rotates on 2 and 4');
    eq(t2.row, 'first miss good miss first', 'the result row leads the summary, one glyph per position in order (F4.5)');
    eq(t1.head + ' / ' + t1.then, 'You found all 5. / 3 took more than one try.', 'tier 1: what was found, never "of 15" (V4.3)');
    eq(t1.stars, '32213', 'tier 1: card 2\'s First look and its miss with the automatic hint 2 stars; two misses 1');
  });

  await test('F2.3: one check line per card: card 1 at 1600 says "Their move: what does it attack?" in Details and on the summary; at 2000 its computed fact on Details and its tile; the routine line once on the first summary and on Insights at tiers 2 and 3, never at tier 1', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY}
      var out = {}, box = { innerHTML: '', dataset: {}, style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } }, el0 = el;
      [1, 2, 3].forEach(function (tier) {
        var a = openAt('184455333378:68', tier);
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
        var dh = detailsHtml(), ss = ui.session; ss.active = null; ss.finished = true;
        var h = doneHtml(ss);
        out[tier] = { details: (/<p class="habit">([^<]*)</.exec(dh) || [])[1], keep: (/class="(?:plan )?keep-line">([^<]*)</.exec(h) || [])[1] || '', tile: (/class="tile-check">([^<]*)</.exec(h) || [])[1] || '' };
      });
      /* the routine: the first summary at tier 2 once; Insights at 2 and 3 */
      var fin = function (tier) { playerTier = function () { return tier; }; ui.session = { mode: 't', label: 't', keys: [], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} }; finishSession(); return /Every move: their move, your chances, safety check\\./.test(doneHtml(ui.session)); };
      out.routine = [fin(1), fin(2), fin(2), fin(3)];
      el = function (id) { return id === 'insightsbox' ? box : el0(id); };
      out.ins = [1, 2, 3].map(function (tier) { playerTier = function () { return tier; }; ui.view = 'insights'; box.innerHTML = ''; renderInsights(); return /Every move: their move, your chances, safety check\\./.test(box.innerHTML); });
      el = el0; ui.view = 'train';
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r[2]), JSON.stringify({ details: 'Their move: what does it attack?', keep: 'Their move: what does it attack?', tile: '' }), 'tier 2: the same line');
    eq(JSON.stringify(r[1]), JSON.stringify({ details: 'Their move: what does it attack?', keep: 'Their move: what does it attack?', tile: '' }), 'tier 1: the same question');
    eq(JSON.stringify(r[3]), JSON.stringify({ details: 'Their threat: Rxf5 takes your queen.', keep: 'Their move: what does it attack?', tile: 'Their threat: Rxf5 takes your queen.' }), 'tier 3: the computed fact in Details and on its tile, the step\'s question above the set');
    eq(JSON.stringify(r.routine), '[false,true,false,false]', 'the routine line on the first summary at tier 2 only, never at tier 1');
    eq(JSON.stringify(r.ins), '[false,true,true]', 'Insights: at tiers 2 and 3');
  });

  await test('F2.5: Details says the clock and their threat: card 1 "You took 20 seconds. You had 20 minutes left." at 700, "Rg1 took 20 s, with 20:15 left." at 1600, the pace (1800 - 1234.6) / 34 = 16.6 as "17 s" at 2000; their threat, only one Rg1 left standing: the search\'s gxf5 is stopped (Rg1 pins the pawn), so "Their threat: Rxf5 takes your queen.", said once at tier 3; the O-O card names Bxc3, never the mate O-O stopped; card 7 none beside the mate Bf3 allows; no clock, no line', async () => {
    const A = boot();
    A.ev(`(function () { window.readyEngine(); var it = model().byKey['184455333378:68']; delete it.b.dz;
      window.__dz = { cp: -800, mate: null, pv: ['g6f5'], depth: 18, stopped: false, lines: [{ cp: -800, mate: null, pv: ['g6f5', 'e4f5', 'b4c5', 'd1h1'] }, { cp: -780, mate: null, pv: ['f8f5', 'e4f5', 'b4c5', 'd1h1'] }] };
      ensureDanger(it, true); return 1; })()`);
    await tick(); await tick();
    /* the O-O card: Qxf2 mate (which O-O stops) and Bxc3; card 7: Qxa6, beside the mate Bf3 allows */
    for (const [k, dz] of [['184268949378:16', { cp: 0, mate: -1, pv: ['f6f2'], depth: 18, stopped: false, lines: [{ cp: 0, mate: -1, pv: ['f6f2'] }, { cp: -500, mate: null, pv: ['d4c3', 'b2c3', 'f6c3', 'e1f1', 'c3a1', 'h2h3', 'd7d6'] }] }],
      ['184435538450:67', { cp: 150, mate: null, pv: ['b7a6'], depth: 18, stopped: false, lines: [{ cp: 150, mate: null, pv: ['b7a6', 'e8e6', 'a6b5', 'd8d6', 'b5c4', 'h7h6'] }] }]]) {
      A.ev(`(function () { window.readyEngine(); var it = model().byKey['${k}']; delete it.b.dz; window.__dz = ${JSON.stringify(dz)}; ensureDanger(it, true); return 1; })()`);
      await tick(); await tick();
    }
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} window.__dz = null;
      var out = {}, lines = function (k, tier) {
        var a = openAt(k, tier);
        solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null; a.settle = 2;
        var dh = detailsHtml(), more = []; dh.replace(/<p class="dt-more[^"]*">([^<]*)</g, function (m, t) { more.push(t); return m; });
        more.push((/<p class="habit">([^<]*)</.exec(dh) || [])[1]);
        return more;
      };
      [1, 2, 3].forEach(function (tier) { out[tier] = lines('184455333378:68', tier); });
      out.oo = [lines('184268949378:16', 1)[0], lines('184268949378:16', 2)[0], dangerView(openAt('184268949378:16', 2)).threat.mate];
      out.c7 = lines('184435538450:67', 2).filter(function (x) { return /^Their threat/.test(x); });
      var it = model().byKey['184455333378:68'], c = it.b.c;
      delete it.b.c; var a = openAt(it.key, 2); out.none = clockLine(a); it.b.c = c;
      out.data = [it.b.c, it.b.tt, it.g.tc];
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.data), JSON.stringify([1215, 19.6, '30+0']), 'the stored clock: 20:15 after Rg1, 19.6 s on it, a 30-minute game');
    eq(JSON.stringify(r[1]), JSON.stringify(['Their threat: their rook takes your queen.', 'You took 20 seconds. You had 20 minutes left.', 'Their move: what does it attack?']), 'tier 1');
    eq(JSON.stringify(r[2]), JSON.stringify(['Their threat: Rxf5 takes your queen.', 'Rg1 took 20 s, with 20:15 left.', 'Their move: what does it attack?']), 'tier 2');
    /* tier 3: the check line is their threat, one that Rg1 left standing (it pins the g-pawn), said once */
    eq(JSON.stringify(r[3]), JSON.stringify(['Rg1 took 20 s, with 20:15 left. Your pace: 17 s a move.', 'Their threat: Rxf5 takes your queen.']), 'tier 3');
    /* (V2.5: SAN keeps its check sign) */
    eq(JSON.stringify(r.oo), JSON.stringify(['Their threat: their bishop takes your knight.', 'Their threat: Bxc3+ takes your knight.', 1]), 'the O-O card: the search kept their mate, O-O stopped it, so Bxc3');
    eq(JSON.stringify(r.c7), '[]', 'card 7: no other threat beside the mate Bf3 allows');
    eq(r.none, '', 'no clock, no line');
  });

  /* ── slice 4: the Coach Panel card and moments ── */
  await test('F4.2: a decisive first sight on a player\'s fifth card at tier 2 names its game in the tag row ("Lost vs opponent1", a neutral pill) within 15 words; a draw "Drew vs opponent1", a long name "Lost the game"; on the first card the teaching label shows instead; it yields to a word for a tap, and shows on no hint and no review', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      var it = model().byKey['184455333378:68'], srs = srsLoad(), out = {}, x;
      var words = function (d, lb) { return [d.row1, d.row2, d.chip, d.tag, d.cap].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (n, s) { return n + wordsIn(s); }, 0) + (lb ? wordsIn(lb.text) : 0); };
      /* the first card ever: the teaching label, no context line */
      var a = openCard(it), d = displayFor(a), lb = frameLabel(a, boardOptsFor(a), 384, false);
      out.first = { tag: d.tag, label: lb ? lb.text : '' };
      /* four positions practised: this is the player's fifth card */
      allMistakes().filter(trainable).filter(function (y) { return y.key !== it.key; }).slice(0, 4).forEach(function (y) { srs[y.key] = { box: 1, streak: 1, due: Date.now() + 3 * DAY, last: Date.now() - DAY, lapses: 0 }; });
      srsSave(srs);
      a = openCard(it); d = displayFor(a); lb = frameLabel(a, boardOptsFor(a), 384, false);
      out.fifth = { tag: d.tag, words: words(d, lb), label: lb ? lb.text : '', pill: (x = /<div class="bd-tags"><span class="tag tag-ctx">([^<]*)<\\/span><\\/div>/.exec(bandHtml(a, d))) ? x[1] : '' };
      /* a draw, a long name, a win */
      var g = it.g, res = g.res, opp = g.opp;
      g.res = 'draw'; out.draw = displayFor(openCard(it)).tag;
      g.res = 'loss'; g.opp = 'averyverylongname4567'; out.long = displayFor(openCard(it)).tag;
      g.opp = opp; g.res = 'win'; out.win = displayFor(openCard(it)).tag;
      g.res = res;
      /* a word for a tap takes row 2: the context line yields first */
      a = openCard(it); a.note = { id: 'T4', key: cardStateKey(a) }; d = displayFor(a);
      out.note = { tag: d.tag, row2: d.row2 };
      /* not on a hint's frame, nor on a review: a cued one (its run ended by a
         miss) has no tag, a game-mode one (F8.1) its neutral "Review" */
      a = openCard(it); a.hints = 1; out.hint = displayFor(a).tag;
      srs[it.key] = { box: 1, streak: 0, due: Date.now() - 3600e3, last: Date.now() - 3 * DAY, lapses: 1 }; srsSave(srs);
      out.review = displayFor(openCard(it)).tag;
      srs[it.key] = { box: 1, streak: 1, due: Date.now() - 3600e3, last: Date.now() - 3 * DAY, lapses: 0 }; srsSave(srs);
      out.gameReview = displayFor(openCard(it)).tag;
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.first), JSON.stringify({ tag: '', label: 'Your game move' }), 'the first card: the teaching label, the context line yields to it');
    eq(r.fifth.tag, 'Lost vs opponent1', 'the fifth card names its game');
    ok(r.fifth.words <= 15, 'within 15 words, a label yielding to it: ' + r.fifth.words + ' ' + r.fifth.label);
    eq(r.fifth.pill, 'Lost vs opponent1', 'in the tag row, a neutral pill');
    eq(r.draw, 'Drew vs opponent1', 'a draw');
    eq(r.long, 'Lost the game', 'a name over the cap of 22 characters');
    eq(r.win, '', 'a win decided nothing');
    eq(r.note.tag, '', 'a word for a tap: the context line yields');
    ok(/^You are (White|Black)\. Move a (white|black) piece\.$/.test(r.note.row2), 'and the word is whole: ' + r.note.row2);
    eq(r.hint, '', 'not on a hint');
    eq(r.review, '', 'not on a review');
    eq(r.gameReview, 'Review', 'a game-mode review wears "Review", never the context line');
  });

  await test('F4.4: the found moment comes once, with the verdict\'s words, after the board is still; never during a hint, a wrong try, See it, See why or an answer shown', () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const log = () => JSON.parse(A.ev('JSON.stringify(rewardLog.splice(0))'));
    log();
    A.ev(`(function () { window.__show(model().byKey['184455333378:68']); return 1; })()`);
    run(1000);
    A.ev('(giveHint(), 1)');
    run(1500);
    eq(log().length, 0, 'no reward with a hint');
    A.ev('(function () { var a = ui.session.active; sessionClick(a.played.from); sessionClick(a.played.to); return 1; })()');
    run(2500);
    eq(A.ev('ui.session.active.phase'), 'tried', 'a wrong try');
    A.ev('(seeIt(), 1)');
    run(2000);
    eq(log().length, 0, 'no reward on a wrong try or See it');
    A.ev('(tryAgain(), 1)');
    run(1500);
    A.ev('(function () { var a = ui.session.active; sessionClick(a.best.from); sessionClick(a.best.to); return 1; })()');
    const still = A.ev('motionUntil');
    ok(still > A.getNow(), 'the found move slides');
    run(3000);
    const found = log();
    eq(found.map((x) => x.kind).join(' '), 'found', 'one found moment');
    ok(found[0].at >= still + 150, 'with its words, after the board is still: ' + (found[0].at - still) + ' ms after the slide');
    A.ev('(function () { var a = ui.session.active; a.settle = 2; seeWhy(); return 1; })()');
    run(2500);
    A.ev('(storyStep(1), 1)');
    run(1500);
    A.ev('(backToSettled(), 1)');
    run(1500);
    eq(log().length, 0, 'none in See why, nor back on the settled card');
    /* an answer shown and played is no find */
    A.ev(`(function () { window.__show(allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && x.key !== '184455333378:68'; })[0]); return 1; })()`);
    run(1000);
    A.ev('(reveal(), 1)');
    run(1500);
    A.ev('(playIt(), 1)');
    run(3000);
    eq(log().length, 0, 'none for an answer shown and played');
    ok(A.ev('ui.session.active.phase') === 'done' && A.ev('ui.session.active.revealed'), 'the answer was shown');
  });

  /* ── slice 8: game-mode reviews (F8.1 to F8.3) ──
     asReview: a card as a game-mode review, its record a run of clean finds (streak), due; written as
     it is (srsSave keeps a record answered later). gameFaults: game mode's own rule on a frame, beside
     the spoiler rule: before the game move shows no red arrow, no faded game move, nothing that names it
     or says "than"; after, a faded piece only of the game move; a foil's game move never before its card
     ends; hint 1 on the first move names neither the answer nor the game move. frameWords: a still
     frame's words (band, bar, strip, the board label as shown). foilOpen: a foil as its look leaves it
     (look: best, bestCp and gameCp from the player's side, ru the line after the game move) */
  const GAME = `var NO = function () { return false; }, YES = function () { return true; };
  function asReview(it, streak, extra) {
    var m = srsLoad();
    m[it.key] = Object.assign({ box: 2, streak: streak == null ? 1 : streak, due: Date.now() - 3600e3, last: Date.now() - 7 * DAY, ls: Date.now() - 7 * DAY, lapses: 0 }, extra || {});
    store.set(srsKey(), m); srsMem = null; srsRevision++;
    return m[it.key];
  }
  function gameFaults(a, f) {
    f = f || boardOptsFor(a);
    var o = f.opts, out = [];
    if (!a.game || ['guess', 'checking', 'tried', 'reply'].indexOf(a.phase) < 0) return out;
    var shown = ghostOn(a), gs = [sanOf(a.pre, a.played), capSan(a.pre, a.played)], gw = moveWords(a.pre, a.played), d = displayFor(a);
    var names = function (s, sans, w) { var ws = String(s || '').split(/[\\s.,:|]+/); return sans.some(function (x) { return ws.indexOf(x) >= 0; }) || (!!w && String(s || '').toLowerCase().indexOf(w) >= 0); };
    if (o.bad) out.push('a red arrow');
    (o.ghosts || []).forEach(function (g) {
      if (!shown) out.push('the game move faded before it shows');
      else if (!g.rook && g.sq !== a.played.to) out.push('a faded piece that is not the game move');
    });
    var rows = [d.row1, d.row2, d.cap, d.chip, d.tag].join(' | ');
    if (!shown && names(rows, gs, gw)) out.push('the band names the game move: ' + rows);
    if (!shown && / than /.test(rows)) out.push('"than": ' + rows);
    if (!shown && /game move/.test(String(o.label || ''))) out.push('the board name: ' + o.label);
    if (a.hints === 1 && !(a.sol && a.solIdx > 0) && d.row1 === CARD_COPY.H1()) {
      var due = dueMove(a);
      if (names(d.row2, [sanOf(a.st, due), capSan(a.st, due)], moveWords(a.st, due))) out.push('hint 1 names the answer: ' + d.row2);
      if (names(d.row2, gs, gw)) out.push('hint 1 names the game move: ' + d.row2);
    }
    return out;
  }
  function frameWords(a, seen) {
    var d = displayFor(a), lb = frameLabel(a, boardOptsFor(a), 384, false, seen);
    return [d.row1, d.row2, d.chip, d.tag, d.cap].concat(d.buttons.map(function (b) { return b.label; })).reduce(function (n, s) { return n + wordsIn(s); }, 0) + stripWords(a) + (lb ? wordsIn(lb.text) : 0);
  }
  function foilOpen(key, look) {
    var it = itemOf(key), b = it.b, gu = uciOfSan(it.g.mv, b.p);
    look = look || {};
    b.bu = look.best || gu; b.lu = packUci([b.bu]); b.ru = look.ru || ''; b.eb = look.bestCp != null ? look.bestCp : 20; b.ea = look.gameCp != null ? look.gameCp : b.eb;
    b.wb = winPct(b.eb); b.wa = winPct(b.ea); b.fl = Math.round((b.wb - b.wa) * 10) / 10; b.ok = 1; delete b.x;
    return openCard(it);
  }`;

  await test('F8.1: a tier-2 card found first try comes back after its week in game mode: no red arrow, no "than Rg1", "Your move" / "Move 35 · 20:35 on your clock" and the "Review" tag, 13 words; the faded game move, and the task naming it, only after the first graded try (the game move itself, a good move that is not the best) or the answer shown; first sight, tier 1, a run a miss ended, a position back from the queue and one more try stay cued; a showing keeps its mode across a reload', async () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME} ${SPOILER}
      playerTier = function () { return 2; };
      var it = model().byKey['184455333378:68'], out = {}, gh = function (f) { return (f.opts.ghosts || []).map(function (g) { return sqName(g.sq) + (g.ok ? ' ok' : ''); }); };
      var a = openCard(it); out.first = { game: a.game, bad: !!boardOptsFor(a).opts.bad, row2: displayFor(a).row2 };
      a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      out.days = Math.ceil((srsRec(it).due - Date.now()) / DAY);
      shiftDays(out.days);
      a = openCard(it); var d = displayFor(a), f = boardOptsFor(a);
      out.open = { game: a.game, row1: d.row1, row2: d.row2, tag: d.tag, chip: d.chip, bad: !!f.opts.bad, ghosts: gh(f), words: frameWords(a, NO), seenWords: frameWords(a, YES), faults: gameFaults(a, f).concat(spoilerFaults(a, f)),
                   pill: /<div class="bd-tags"><span class="tag tag-slate">Review<\\/span><\\/div>/.test(bandHtml(a, d)), buttons: d.buttons.map(function (b) { return b.label; }).join(' / ') };
      /* the game move itself, its first graded try */
      a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null; a.reason = 2;
      d = displayFor(a); f = boardOptsFor(a);
      out.tried = { phase: a.phase, row1: d.row1, ghosts: gh(f), faults: gameFaults(a, f) };
      tryAgain(); a.triedHold = false; d = displayFor(a); f = boardOptsFor(a);
      out.again = { row1: d.row1, row2: d.row2, tag: d.tag, ghosts: gh(f), bad: !!f.opts.bad, aria: /Faded rook on g1: where your game move went\\./.test(f.opts.label), faults: gameFaults(a, f).concat(spoilerFaults(a, f)) };
      /* the miss ended its run; the showing in progress keeps its mode across a reload, the next one is cued */
      keepProgress(a); out.streak = srsRec(it).streak;
      out.reload = cardFor(it).game;
      ui.session.progress = {};
      out.next = cardFor(it).game;
      /* the answer shown brings the faded game move with the green arrow */
      asReview(it); a = openCard(it); reveal(); a.animMove = null; f = boardOptsFor(a);
      out.shown = { ghosts: gh(f), green: (f.opts.arrows || []).filter(function (x) { return x.kind === 'better'; }).length };
      /* cued: tier 1, a position back from the queue, one more try */
      asReview(it); playerTier = function () { return 1; }; a = openCard(it); out.t1 = { game: a.game, bad: !!boardOptsFor(a).opts.bad };
      playerTier = function () { return 2; };
      asReview(it, 1, { q: Date.now() }); out.queued = cardFor(it).game;
      asReview(it);
      ui.session = { mode: 't', label: 't', keys: [it.key, it.key], idx: 1, results: {}, relearn: [], relearnOf: {} }; ui.session.relearnOf[it.key] = 1;
      out.oneMore = { game: cardFor(it).game, chip: (ui.session.active = cardFor(it), displayFor(ui.session.active).chip) };
      return JSON.stringify(out); })()`));
    eq(JSON.stringify(r.first), JSON.stringify({ game: false, bad: true, row2: 'Find a better move than Rg1.' }), 'first sight: cued, its red arrow and "than Rg1"');
    ok(r.days >= 6 && r.days <= 9, 'back after about a week: ' + r.days);
    eq(r.open.game, true, 'the review is in game mode');
    eq([r.open.row1, r.open.row2, r.open.tag, r.open.chip].join(' | '), 'Your move | Move 35 · 20:35 on your clock | Review | ', 'its band');
    ok(!r.open.bad && !r.open.ghosts.length, 'no red arrow, no faded game move');
    ok(r.open.pill, 'the tag row: "Review" in slate');
    eq(r.open.buttons, 'Hint / Show the answer', 'its bar');
    eq(r.open.words, 13, 'the open frame holds 13 words');
    ok(r.open.seenWords <= 15, 'within 15 words, a label included: ' + r.open.seenWords);
    eq(r.open.faults.length, 0, 'nothing given away: ' + r.open.faults.join(' | '));
    eq(r.tried.phase, 'tried', 'the game move tried');
    eq(r.tried.row1, 'As in your game', 'said so, not "again": it was not shown');
    eq(r.tried.ghosts.length, 0, 'the try on the board, no faded piece beside it');
    eq(r.tried.faults.length, 0, r.tried.faults.join(' | '));
    eq([r.again.row1, r.again.row2, r.again.tag].join(' | '), 'Your move | Find a better move than Rg1. | Review', 'after Try again the task names the game move');
    eq(JSON.stringify(r.again.ghosts), '["g1"]', 'its faded piece, with its cross');
    ok(!r.again.bad && r.again.aria, 'no red arrow; the board name says where the game move went');
    eq(r.again.faults.length, 0, r.again.faults.join(' | '));
    eq(r.streak, 0, 'the miss ended the run');
    eq(r.reload, true, 'the showing keeps game mode across a reload');
    eq(r.next, false, 'the next review is cued');
    eq(JSON.stringify(r.shown), JSON.stringify({ ghosts: ['g1'], green: 1 }), 'the answer shown: the green arrow and the faded game move');
    eq(JSON.stringify(r.t1), JSON.stringify({ game: false, bad: true }), 'tier 1 stays cued');
    eq(r.queued, false, 'a position back from the queue is a first sight: cued');
    eq(JSON.stringify(r.oneMore), JSON.stringify({ game: false, chip: 'One more try' }), 'one more try is cued');
    /* a good move that is not the best is a graded try too */
    A.ev(`(function () { ${OPEN} ${GAME} ${TRY} ${AFTER}
      var it = model().byKey['184455333378:68']; asReview(it);
      var a = openAt(it.key, 2); window.__a = a;
      tryMove(a, moveUci(offBook(a)), null, it.b.eb - 80, null);
      return 1; })()`);
    await tick(); await tick();
    const c = JSON.parse(A.ev(`(function () { ${GAME} var a = window.__a, out = { kind: a.tried && a.tried.kind, row1: displayFor(a).row1 };
      tryAgain(); a.triedHold = false;
      out.ghosts = (boardOptsFor(a).opts.ghosts || []).map(function (g) { return sqName(g.sq); }); out.row2 = displayFor(a).row2; out.faults = gameFaults(a);
      return JSON.stringify(out); })()`));
    eq(c.kind + ' / ' + c.row1, 'close / Good move', 'a good move that is not the best');
    eq(JSON.stringify(c.ghosts) + ' ' + c.row2, '["g1"] Find a better move than Rg1.', 'after Keep looking the game move shows');
    eq(c.faults.length, 0, c.faults.join(' | '));
  });

  await test('F8.1: game mode\'s hints: hint 1 is the step\'s row-2 question, never a computed fact, naming neither the answer nor the game move on any fixture card at tiers 2 and 3; hint 2 the danger on the board as it stands (card 1: "Your queen is attacked twice.", f5 and d3 ringed), never the game move or what it allows before it shows, F1.1\'s own form once it shows (card 7: "Bf3 lets them mate you."); every hint frame says something within 15 words; a hint grades "With a hint"', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME}
      var out = { bad: [], n: 0, kinds: {} };
      [2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          asReview(it);
          var a = openCard(it);
          if (!a || !a.game) return;
          out.n++;
          var at = tier + ' ' + it.key + ' ', check = function (what) {
            var d = displayFor(a);
            if (!d.row2) out.bad.push(at + what + ' says nothing');
            gameFaults(a).forEach(function (x) { out.bad.push(at + what + ': ' + x); });
            [NO, YES].forEach(function (s) { var w = frameWords(a, s); if (w > 15) out.bad.push(at + what + ': ' + w + ' words'); });
            return d;
          };
          a.hints = 1;
          var d1 = check('hint 1');
          if (checkRow(a).indexOf(d1.row2) < 0) out.bad.push(at + 'hint 1 is not its question: ' + d1.row2);
          if (hintMarks(a).rings.length + hintMarks(a).arrows.length) out.bad.push(at + 'hint 1 draws marks');
          a.hints = 2;
          check('hint 2');
          var hm = hintMarks(a);
          out.kinds[hm.dz ? hm.dz.kind : 'circled'] = 1;
          if (hm.arrows.some(function (x) { return x.key === 'hint'; }) || (hm.dz && /^(made|madeMate|lost|parried)$/.test(hm.dz.kind))) out.bad.push(at + 'hint 2 draws what the game move allows');
          a.misses = 1;
          check('hint 2 once the game move shows');
        });
      });
      playerTier = function () { return 2; };
      var c1 = model().byKey['184455333378:68'], c7 = model().byKey['184435538450:67'], a;
      asReview(c1); a = openCard(c1); a.hints = 2;
      out.c1 = displayFor(a).row2 + ' / ' + hintMarks(a).rings.map(function (x) { return sqName(x.sq); }).join(' ');
      asReview(c7); a = openCard(c7); a.hints = 2;
      out.c7 = displayFor(a).row2; a.misses = 1; out.c7after = displayFor(a).row2;
      /* a hint grades "With a hint" */
      asReview(c1); a = openCard(c1); a.shownAt = 0; giveHint(); solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      out.graded = [a.result, ui.session.sum[c1.key].c].join(' ');
      return JSON.stringify(out); })()`));
    ok(r.n >= 150, 'game-mode reviews read: ' + r.n);
    eq(r.bad.length, 0, r.bad.length + ' faults, first: ' + r.bad.slice(0, 4).join(' || '));
    eq(r.c1, 'Your queen is attacked twice. / f5 d3', 'card 1: the danger on the board, ringed');
    ok(r.c7.indexOf('Bf3') < 0, 'card 7 before the game move shows: ' + r.c7);
    eq(r.c7after, 'Bf3 lets them mate you.', 'card 7 once it shows: F1.1\'s form');
    eq(r.graded, 'hint hint', 'with a hint');
    ['attacked', 'watch', 'circled'].forEach((k) => ok(r.kinds[k], 'hint 2 kinds seen: ' + Object.keys(r.kinds).join(', ')));
  });

  await test('F8.1: no game-mode frame gives anything away: every fixture card at tiers 2 and 3 as a game-mode review, in every frame (open, a piece picked up, both hints, the game move tried with its reason, See it and Try again, the hints after it, a forcing line\'s steps with tier 3\'s question and a guess, found and settled, the answer shown), keeps the spoiler rule and game mode\'s own, within 15 words', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME} ${SPOILER}
      var out = [], n = 0, labelled = 0;
      var walk = function (it, cb) {
        asReview(it); var a = openCard(it);
        if (!a || !a.game) return;
        cb('open', a);
        a.sel = legalMoves(a.st)[0].from; cb('selected', a); a.sel = -1;
        a.hints = 1; cb('hint 1', a); a.hints = 2; cb('hint 2', a);
        asReview(it); a = openCard(it); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
        if (a.phase === 'tried') {
          cb('the game move', a); a.reason = 1; cb('its reason drawn', a); a.reason = 2; cb('its reason said', a);
          if (a.tried.reply) { seeIt(); cb('See it, sliding', a); a.animMove = null; cb('See it, landed', a); }
          tryAgain(); cb('Try again, crossfading', a); a.triedHold = false; cb('after Try again', a);
          a.hints = 1; a.hintAt = a.misses; a.hintAfter = true; cb('hint 1 after it', a); a.hints = 2; cb('hint 2 after it', a);
        }
        if (a.sol) {
          asReview(it); a = openCard(it);
          for (var k = 0; k < a.sol.length - 1; k += 2) {
            gradeMove(uciToMove(a.st, a.sol[k]));
            var rp = a.reply;
            if (!rp) break;
            a.animMove = null; cb('forcing ' + k + ', right', a);
            /* at tier 3 the first move asks for their best reply (F10.1), beside the Review tag: a guess */
            if (rp.ask) { makeGuess(a, uciToMove(a.st, a.sol[k + 1])); a.animMove = null; cb('forcing ' + k + ', guessed', a); }
            rp.tele = true; cb('forcing ' + k + ', the telegraph', a);
            theirReply(a, false); a.animMove = null; a.animSlow = false; cb('forcing ' + k + ', landed', a);
            replyDone(a, rp); cb('forcing ' + k + ', your move', a);
          }
        }
        asReview(it); a = openCard(it);
        if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
        else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
        a.animMove = null; cb('found', a); a.settle = 2; cb('settled', a);
        asReview(it); a = openCard(it); reveal(); a.animMove = null; cb('shown', a);
      };
      [2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          walk(it, function (what, a) {
            n++;
            var f = boardOptsFor(a), at = tier + ' ' + it.key + ' ' + what + ': ';
            spoilerFaults(a, f).concat(gameFaults(a, f)).forEach(function (x) { out.push(at + x); });
            [NO, YES].forEach(function (s) { var w = frameWords(a, s); if (w > 15) out.push(at + w + ' words'); if (frameLabel(a, f, 384, false, s)) labelled++; });
          });
        });
      });
      return JSON.stringify({ out: out, n: n, labelled: labelled }); })()`));
    ok(r.n > 2500, 'frames read: ' + r.n);
    eq(r.out.length, 0, r.out.length + ' faults, first: ' + r.out.slice(0, 4).join(' || '));
    ok(r.labelled > 100, 'labels shown in some: ' + r.labelled);
  });

  await test('F8.2: one game-mode position in four is a foil: 8 game-mode reviews in a set make 2 foils (from other games, in spread places, never the first, the set\'s size kept, the reviews they replace still due), each a move of the player\'s that lost under 3 points with its clock known; Today\'s set brings them; a foil shown is not picked within 7 days and may be after; none at tier 1, with the engine down or in a drill; the share left over carries to the next set', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${GAME}
      window.readyEngine(); playerTier = function () { return 2; };
      var out = {}, its = allMistakes().filter(trainable).slice(0, 8), keys = its.map(function (x) { return x.key; });
      its.forEach(function (it) { asReview(it); });
      var set = withFoils(keys, 'today'), foils = set.filter(isFoilKey);
      out.n = set.length; out.foils = foils.length;
      out.places = set.map(function (k, i) { return isFoilKey(k) ? i : -1; }).filter(function (i) { return i >= 0; });
      out.otherGames = foils.every(function (k) { return keys.every(function (x) { return x.split(':')[0] !== k.split(':')[1]; }); }) && foils[0].split(':')[1] !== foils[1].split(':')[1];
      out.dropped = keys.filter(function (k) { return set.indexOf(k) < 0; });
      out.stillDue = out.dropped.every(function (k) { return srsLoad()[k].due <= Date.now(); });
      out.gm = set.filter(function (k) { return isFoilKey(k) || gameModeRec(srsLoad()[k], 2); }).length;
      out.pool = foilPool().length;
      out.poolOk = foilPool().every(function (f) { return wpAt(f.g, f.q - 1) - wpAt(f.g, f.q) < 3 && f.q % 2 === (f.g.color === 'white' ? 0 : 1) && f.clock != null && f.clock === clockKnownAt(f.g, f.q) && !(f.g.bl || []).some(function (b) { return b.p === f.q; }); });
      out.nearFirst = foilPool().filter(function (f) { return f.rank >= 2; }).length;
      /* Today's own set */
      startToday();
      out.today = { n: ui.session.keys.length, foils: ui.session.keys.filter(isFoilKey).length, first: isFoilKey(ui.session.keys[0]) };
      out.logged = (logLoad().filter(function (e) { return e.e === 's'; }).pop() || {}).fo;
      ui.session = null;
      /* shown: not within 7 days, then again */
      var elig = function (k) { var st = foilStore(); return !st.s[k] || Date.now() - st.s[k] >= FOIL_DAYS * DAY; };
      foilShown(foils[0]);
      out.week = [elig(foils[0]), withFoils(keys, 'today').indexOf(foils[0]) < 0];
      shiftDays(6); out.day6 = elig(foils[0]);
      shiftDays(1); out.day7 = elig(foils[0]);
      its.forEach(function (it) { asReview(it); });
      /* none at tier 1, with the engine down, in a drill */
      playerTier = function () { return 1; }; out.t1 = withFoils(keys, 'today').filter(isFoilKey).length;
      playerTier = function () { return 2; }; SF.state = 'failed'; out.down = withFoils(keys, 'today').filter(isFoilKey).length; window.readyEngine();
      out.drill = withFoils(keys, 'drill').filter(isFoilKey).length;
      /* the share carries: three game-mode reviews make none and leave three quarters, three more make one */
      store.del(foilStoreKey());
      var three = keys.slice(0, 3);
      out.carry = [withFoils(three, 'more').filter(isFoilKey).length, foilStore().acc, withFoils(three, 'more').filter(isFoilKey).length, foilStore().acc];
      return JSON.stringify(out); })()`));
    eq(r.n + ' ' + r.foils, '8 2', '8 game-mode reviews: the set keeps its 8 places, 2 of them foils');
    eq(r.gm, 8, '8 game-mode positions in all');
    eq(JSON.stringify(r.places), '[2,5]', 'in spread places, never the first');
    ok(r.otherGames, 'each from another game');
    eq(r.dropped.length, 2, 'two reviews give their places');
    ok(r.stillDue, 'and stay due');
    ok(r.pool >= 20 && r.poolOk, 'the pool: ' + r.pool + ' positions, each a move that lost under 3 points, its clock known');
    ok(r.nearFirst >= 10, 'many a few moves before a mistake: ' + r.nearFirst);
    eq(JSON.stringify(r.today), JSON.stringify({ n: 10, foils: 2, first: false }), 'Today\'s set of 10: two foils');
    eq(r.logged, 2, 'the set log counts them');
    eq(JSON.stringify(r.week), '[false,true]', 'a foil shown: not again within 7 days');
    eq(r.day6 + ' ' + r.day7, 'false true', 'after 7 days it may come again');
    eq([r.t1, r.down, r.drill].join(' '), '0 0 0', 'none at tier 1, with the engine down or in a drill');
    eq(JSON.stringify(r.carry), '[0,0.75,1,0.5]', 'the share carries');
  });

  await test('F8.2: a foil opens after its look (one search; a second scores the game move beside the best when the first missed it) as any game-mode review; its game move passes "Good, nothing to fix" / "You played Rxg6+ in your game too."; a try 8 points down "Playable" / "Rxg6+ in your game kept more."; one at the threshold "Not this one" with its reason, and when the card ends "Your game move Rxg6+ was fine here."; the answer shown "Your game move Rxg6+ was good too." (V2.6); hint 2 on a board with nothing in danger "Any good move passes here." (V2.6); never scheduled, never one more try, logged as a foil; a look that finds the game move lost 3 points or more sets it aside for good', async () => {
    const A = boot();
    const KEY = 'foil:184455333378:66', KEY2 = 'foil:184435538450:49';
    A.ev(`(function () { ${OPEN} ${GAME}
      window.readyEngine(); playerTier = function () { return 2; };
      var it = itemOf('${KEY}');
      window.__gu = uciOfSan(it.g.mv, it.b.p);
      window.__alt = legalMoves(stateAtPly(it.g.mv, it.b.p)).map(moveUci).filter(function (u) { return u !== window.__gu; });
      ui.session = { mode: 'today', label: 'Today', keys: ['${KEY}', '${KEY2}', '184455333378:68'], idx: 0, results: {}, relearn: [], relearnOf: {} };
      loadCard();
      return 1; })()`);
    const pending = (key) => JSON.parse(A.ev(`JSON.stringify(window.__evals.filter(function (j) { return j.opts.tag === '` + key + `' && !j.done; }).map(function (j) { return { mpv: j.opts.multipv || 1, sm: j.opts.searchmoves || null, nodes: j.nodes }; }))`));
    const answer = (key, r) => A.ev(`(function () { var j = window.__evals.filter(function (x) { return x.opts.tag === '` + key + `' && !x.done; })[0]; j.done = 1; j.res(` + r + `); return 1; })()`);
    const s0 = { loading: A.ev('ui.session.loadingKey'), jobs: pending(KEY) };
    /* the best move is another (White +0.30); the three lines miss the game move */
    answer(KEY, `{ cp: 30, mate: null, bestUci: window.__alt[0], pv: [window.__alt[0]], lines: [{ cp: 30, mate: null, pv: [window.__alt[0]] }, { cp: 20, mate: null, pv: [window.__alt[1]] }, { cp: 10, mate: null, pv: [window.__alt[2]] }], depth: 18, stopped: false }`);
    await tick(); await tick();
    const s1 = pending(KEY);
    /* side by side: the game move at +0.20, a point under the best */
    answer(KEY, `{ cp: 20, mate: null, bestUci: window.__gu, pv: [window.__gu, 'c4d3'], lines: [{ cp: 20, mate: null, pv: [window.__gu, 'c4d3'] }, { cp: 30, mate: null, pv: [window.__alt[0]] }], depth: 18, stopped: false }`);
    await tick(); await tick(); await tick();
    const open = JSON.parse(A.ev(`(function () { ${GAME} var a = ui.session.active, d = displayFor(a), f = boardOptsFor(a), b = a.it.b;
      var out = { key: a.key, foil: a.foil, game: a.game, best: a.bestUci === window.__alt[0], b: [b.ok, b.fl, b.ru].join(' '), rows: [d.row1, d.row2, d.tag].join(' | '), bad: !!f.opts.bad, ghosts: (f.opts.ghosts || []).length, words: frameWords(a, NO), faults: gameFaults(a, f),
        shown: !!foilStore().s['${KEY}'], menu: /dispute/.test(menuHtml(a)) };
      a.hints = 1; out.h1 = displayFor(a).row2; a.hints = 2; out.h2 = displayFor(a).row2; a.hints = 0;
      out.ruled = gameFaults(a).length;
      return JSON.stringify(out); })()`));
    eq(s0.loading, KEY, 'the loading frame covers its look');
    eq(JSON.stringify(s0.jobs), JSON.stringify([{ mpv: 3, sm: null, nodes: 250000 }]), 'one search of three lines');
    eq(JSON.stringify(s1.map((j) => j.sm && j.sm.length)), '[2]', 'then the game move and the best side by side');
    eq(open.key + ' ' + open.foil + ' ' + open.game, KEY + ' true true', 'the foil opens in game mode');
    ok(open.best, 'its best move from the look');
    eq(open.b, '1 1 c4d3', 'what the game move lost, and the line after it');
    eq(open.rows, 'Your move | Move 34 · 20:42 on your clock | Review', 'as any game-mode review, the clock it had when the position arose');
    ok(!open.bad && !open.ghosts && open.words === 13 && !open.faults.length, 'no arrow, nothing given away, 13 words');
    ok(open.shown && !open.menu, 'noted as shown; nothing to dispute');
    eq(open.h1, 'Their move: what does it attack?', 'hint 1: the question (something stands in danger here)');
    eq(open.h2, 'Their pawn attacks your bishop.', 'hint 2: what stands in danger');
    /* a foil with nothing in danger on its board */
    const calm = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME}
      var keep = ui.session, f = foilPool().filter(function (x) { return x.key !== '${KEY}' && x.key !== '${KEY2}' && (function () { var a = foilOpen(x.key); return foilDanger(a).kind === 'none'; })(); })[0], a = foilOpen(f.key);
      a.hints = 1; var h1 = displayFor(a).row2; a.hints = 2; var d = displayFor(a), out = { h1: h1, h2: d.row2, marks: hintMarks(a).rings.length + hintMarks(a).arrows.length, tag: d.tag };
      /* the foils read here are forgotten, as unlooked-at */
      Object.keys(foilItems).forEach(function (k) { if (k !== '${KEY}') delete foilItems[k]; });
      ui.session = keep;
      return JSON.stringify(out); })()`));
    /* V2.6: "No danger here." is gone (false on 3 of 8 foils); the tag gives
       way to the hint's five words */
    eq(JSON.stringify(calm), JSON.stringify({ h1: 'What can they take?', h2: 'Any good move passes here.', marks: 0, tag: '' }), 'a foil with nothing in danger: the safety check\'s question, then "Any good move passes here."');
    /* the game move passes */
    const good = JSON.parse(A.ev(`(function () { ${TRY} var a = ui.session.active; a.tapped = true; gradeMove(uciToMove(a.st, window.__gu)); a.settle = 2;
      var d = displayFor(a); return JSON.stringify({ phase: a.phase, result: a.result, rows: [d.row1, d.row2].join(' | '), disc: d.disc, bar: d.buttons.map(function (b) { return b.label || '-'; }).join(' / '),
        srs: !!srsLoad()['${KEY}'], relearn: (ui.session.relearn || []).length, log: logLoad().slice(-1)[0], sum: ui.session.sum['${KEY}'], details: detailsHtml().replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ') }); })()`));
    eq(good.phase + ' ' + good.result, 'done first', 'passed first try');
    eq(good.rows, 'Good, nothing to fix | You played Rxg6+ in your game too.', 'the game move again: good, and said so (with its check, as row 1 and the label write it)');
    eq(good.disc, 'good', 'a filled tick');
    eq(good.bar, '- / Continue', 'no story to tell: Continue alone');
    ok(!good.srs && !good.relearn, 'never scheduled, never one more try');
    eq([good.log.m, good.log.c, good.log.fv, good.log.n].join(' '), 'foil first good ', 'logged as a foil');
    eq(JSON.stringify(good.sum), JSON.stringify({ c: 'first', s: 3, fc: '', foil: 1, fk: 'good' }), 'kept for the summary as a foil');
    ok(/After your game move Rxg6\+ your winning chances were \d+%; after \S+, \d+%\./.test(good.details) && /Not every review hides a mistake/.test(good.details), 'Details: ' + good.details);
    /* a try 8 points down, then one at the threshold */
    const tries = [];
    for (const [cp, what] of [[-68, 'playable'], [-200, 'miss']]) {
      A.ev(`(function () { ${OPEN} ${GAME} ${TRY} var it = itemOf('${KEY}'); var a = openCard(it); window.__a = a; window.__bestCp = it.b.eb; tryMove(a, window.__alt[3], null, ` + cp + `, null); return 1; })()`);
      await tick(); await tick();
      tries.push(JSON.parse(A.ev(`(function () { var a = window.__a; a.reason = 2; a.settle = 2; var d = displayFor(a); return JSON.stringify({ what: '` + what + `', phase: a.phase, rows: [d.row1, d.row2].join(' | '), disc: d.disc, tag: d.tag }); })()`)));
    }
    eq(JSON.stringify(tries[0]), JSON.stringify({ what: 'playable', phase: 'done', rows: 'Playable | Rxg6+ in your game kept more.', disc: 'close', tag: '' }), 'a try 8 points down passes: Playable');
    eq(tries[1].phase + ' ' + tries[1].rows.split(' | ')[0] + ' ' + tries[1].tag, 'tried Not this one Review', 'one at the threshold is a miss');
    ok(tries[1].rows.split(' | ')[1].length > 0, 'with its reason: ' + tries[1].rows);
    const after = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME} var a = window.__a; tryAgain(); a.triedHold = false;
      var f = boardOptsFor(a), out = { again: displayFor(a).row2, ghosts: (f.opts.ghosts || []).length, faults: gameFaults(a, f) };
      a.tapped = true; gradeMove(uciToMove(a.st, window.__gu)); a.settle = 2; out.end = [displayFor(a).row1, displayFor(a).row2].join(' | '); out.result = a.result;
      var b = openCard(itemOf('${KEY}')); reveal(); out.shown = displayFor(b).row2; b.animMove = null; playIt(false); b.settle = 2; out.shownEnd = [displayFor(b).row1, displayFor(b).row2].join(' | ');
      return JSON.stringify(out); })()`));
    eq(after.again, 'Move 34 · 20:42 on your clock', 'after Try again the foil\'s game move stays hidden');
    ok(!after.ghosts && !after.faults.length, 'no faded game move: it is a fine answer');
    eq(after.end, 'Good, nothing to fix | Your game move Rxg6+ was fine here.', 'when the card ends after a miss');
    eq(after.result, 'retry', 'graded after a miss');
    eq(after.shown, 'Play the green arrow.', 'the answer shown');
    /* V2.6: the answer shown on a foil never reads as a contradiction */
    ok(/^The answer: \S+ \| Your game move Rxg6\+ was good too\.$/.test(after.shownEnd), 'and when it settles: ' + after.shownEnd);
    /* the second foil's look finds its game move 5 points down: set aside, the next card comes */
    A.ev(`(function () { ui.session.active = null; ui.session.idx = 1; ui.session.keys = ['${KEY}', '${KEY2}', '184455333378:68']; loadCard(); var it = itemOf('${KEY2}'); window.__gu2 = uciOfSan(it.g.mv, it.b.p); window.__alt2 = legalMoves(stateAtPly(it.g.mv, it.b.p)).map(moveUci).filter(function (u) { return u !== window.__gu2; }); window.__sign2 = it.g.color === 'white' ? 1 : -1; return 1; })()`);
    answer(KEY2, `{ cp: 0, mate: null, bestUci: window.__alt2[0], pv: [window.__alt2[0]], lines: [{ cp: 0, mate: null, pv: [window.__alt2[0]] }, { cp: -60 * window.__sign2, mate: null, pv: [window.__gu2] }], depth: 18, stopped: false }`);
    await tick(); await tick(); await tick();
    const aside = JSON.parse(A.ev(`JSON.stringify({ x: itemOf('${KEY2}').b.x || null, kept: !!foilStore().x['${KEY2}'], keys: ui.session.keys, now: ui.session.active ? ui.session.active.key : ui.session.loadingKey })`));
    eq(aside.x, 'foil', 'its game move lost 3 points or more: set aside');
    ok(aside.kept, 'for good');
    eq(aside.keys.indexOf(KEY2), -1, 'gone from the set');
    eq(aside.now, '184455333378:68', 'the next card comes');
  });

  await test('F8.3: at tier 2 the third clean find 16 days on makes a position learned only in game mode and under 30 s: shown cued it holds; in game mode at 20 s it is learned; at 42 s it holds, Details says "Found first try in 42 s. Under 30 s makes it learned." and what moved "held"; at tier 3 the bar is 60 s; a game-mode miss makes the next review cued', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME}
      var it = model().byKey['184455333378:68'], out = {};
      var best = function (a, ms) { a.attempts = 1; a.t0 = Date.now() - ms; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); return a; };
      var toLearnStep = function (tier) {
        store.del(srsKey()); srsMem = null; playerTier = function () { return tier; };
        best(openCard(it), 5000);
        shiftDays(Math.ceil((srsRec(it).due - Date.now()) / DAY));
        best(openCard(it), 5000);
        shiftDays(Math.max(16, Math.ceil((srsRec(it).due - Date.now()) / DAY)));
        return srsRec(it).streak;
      };
      out.step = toLearnStep(2);
      /* shown cued (the scheduler told so): it holds */
      var info = { ms: 9000, tier: 2, game: false }, rec = srsRecord(it, 'first', info);
      out.cued = [!!rec.learned, info.held, rec.streak].join(' ');
      toLearnStep(2);
      var a = openCard(it); out.mode = a.game; best(a, 20000);
      out.fast = [!!srsRec(it).learned, ui.session.sum[it.key].m].join(' ');
      toLearnStep(2);
      a = best(openCard(it), 42000);
      out.slow = [!!srsRec(it).learned, a.held, ui.session.sum[it.key].m, srsRec(it).streak].join(' ');
      out.details = (/<p class="dt-more dt-held">([^<]*)<\\/p>/.exec(detailsHtml()) || [])[1] || '';
      out.when = (/<span class="when">([^<]*)</.exec(detailsHtml()) || [])[1] || '';
      out.log = logLoad().slice(-1)[0].tb;
      toLearnStep(3);
      a = best(openCard(it), 42000);
      out.t3 = !!srsRec(it).learned;
      toLearnStep(3);
      a = best(openCard(it), 65000);
      out.t3slow = [!!srsRec(it).learned, (/<p class="dt-more dt-held">([^<]*)<\\/p>/.exec(detailsHtml()) || [])[1]].join(' | ');
      /* a game-mode miss: the next review is cued */
      toLearnStep(2);
      a = openCard(it); out.before = a.game;
      a.misses = 1; a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      out.after = [a.result, srsRec(it).streak, cardFor(it).game].join(' ');
      return JSON.stringify(out); })()`));
    eq(r.step, 2, 'two clean finds before the learned step');
    eq(r.cued, 'false cued 2', 'shown cued at tier 2: not learned, held');
    eq(r.mode, true, 'the learned step opens in game mode');
    eq(r.fast, 'true learned', 'in game mode at 20 s: learned');
    eq(r.slow, 'false slow held 2', 'at 42 s: not learned, held, the run kept');
    eq(r.details, 'Found first try in 42 s. Under 30 s makes it learned.', 'and Details says why');
    ok(/^Step 2 of 3 · back in \d+ days$/.test(r.when), 'the same step, back in about 16 days: ' + r.when);
    eq(r.log, 1, 'the log notes it');
    eq(r.t3, true, 'tier 3 at 42 s: learned');
    eq(r.t3slow, 'false | Found first try in 1:05. Under 60 s makes it learned.', 'tier 3 at 65 s: held, said in minutes');
    eq(r.before, true, 'a game-mode review');
    eq(r.after, 'retry 0 false', 'a miss there: the next review is cued');
  });

  await test('F8.1, F8.2: the first game-mode card says once "Reviews now look like your game: no arrow, and not every position hides a mistake."; the practice log notes each card\'s mode (cued, game, foil) and Clarity counts card_result_<tier>_<mode>_<category>, naming no player, rating or position; the summary counts foils apart ("1 had nothing to fix: 1 good move.") with a tile of their own, no rungs, the game move tinted as a move played', async () => {
    const A = boot();
    /* the two cards' deeper look and danger facts read before, so each opens at once */
    A.ev(`(function () { window.readyEngine(); ['184455333378:68', '184380745302:11'].forEach(function (k) { var it = model().byKey[k]; it.b.v = Math.max(it.b.v || 0, 2); ensureDanger(it, true); }); return 1; })()`);
    await tick(); await tick();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME}
      window.readyEngine(); playerTier = function () { return 2; };
      var calls = [], notes = [];
      window.clarity = function () { calls.push([].slice.call(arguments).map(String)); };
      notice = function (m) { notes.push(m); };
      var c1 = model().byKey['184455333378:68'], c2 = model().byKey['184380745302:11'], fk = 'foil:184455333378:66', out = {};
      asReview(c1);
      var f = itemOf(fk), b = f.b, gu = uciOfSan(f.g.mv, b.p);
      b.bu = gu; b.lu = packUci([gu]); b.ru = ''; b.eb = b.ea = 20; b.wb = b.wa = winPct(20); b.fl = 0; b.ok = 1;
      ui.session = { mode: 'today', label: 'Today', keys: [c2.key, c1.key, fk], idx: 0, results: {}, relearn: [], relearnOf: {} };
      loadCard(); var a = ui.session.active; out.cued = a.game; a.attempts = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); nextCard();
      a = ui.session.active; out.game = a.game; out.notes1 = notes.slice(); a.attempts = 1; a.hints = 1; solved(uciToMove(a.st, a.bestUci), a.bestUci, null); nextCard();
      a = ui.session.active; out.foil = a.foil; a.attempts = 1; gradeMove(uciToMove(a.st, gu)); nextCard();
      out.notes = notes;
      out.modes = logLoad().filter(function (e) { return e.e === 'c'; }).map(function (e) { return e.m; });
      out.events = calls.filter(function (c) { return c[0] === 'event' && /^card_result_/.test(c[1]); }).map(function (c) { return c[1]; });
      out.flat = JSON.stringify(calls);
      var ss = ui.session, h = doneHtml(ss);
      out.head = (/<h2 class="done-big"[^>]*>([^<]*)</.exec(h) || [])[1];
      out.then = (/<p class="recap-then">([^<]*)</.exec(h) || [])[1] || '';
      out.foils = (/<p class="recap-then recap-foils">([^<]*)</.exec(h) || [])[1];
      out.row = (/<div class="result-row"[^>]*>(.*?)<\\/div>/.exec(h) || [])[1].match(/rg-\\w+/g);
      var tile = (/<div class="recap-item recap-foil">(.*?)<\\/span><\\/div>/.exec(h) || [])[0] || '';
      out.tile = { name: /<span>Nothing to fix<\\/span>/.test(tile), glyph: /rg rg-first/.test(tile), word: /<span class="res">Good move/.test(tile), rungs: /rungs/.test(tile), act: /data-act/.test(tile), red: /bad-arrow|fill="#d04a3a"/.test(tile), played: (tile.match(/fill="rgba\\(155,199,0,[.]41\\)"/g) || []).length };
      out.moved = (/<span class="recap-moved">([^<]*)</.exec(h) || [])[1] || '';
      /* the summary's text stack (slice 5): the category line, the foils' line right after it, then
         the quiet paragraph (what moved, when they come back), before the week */
      out.stack = (h.slice(h.indexOf('id="recap-h"'), h.indexOf('<div class="recap-week')).match(/<p class="[^"]*"/g) || []).map(function (x) { return x.slice(10, -1); }).join(' / ');
      return JSON.stringify(out); })()`));
    eq(r.cued + ' ' + r.game + ' ' + r.foil, 'false true true', 'a first sight, a review in game mode, a foil');
    eq(JSON.stringify(r.notes1), JSON.stringify(['Reviews now look like your game: no arrow, and not every position hides a mistake.']), 'the first game-mode card says what changed');
    eq(r.notes.length, 1, 'once');
    eq(JSON.stringify(r.modes), JSON.stringify(['cued', 'game', 'foil']), 'the log notes each card\'s mode');
    eq(JSON.stringify(r.events), JSON.stringify(['card_result_2_cued_first', 'card_result_2_game_hint', 'card_result_2_foil_first']), 'Clarity: tier, mode and category');
    ok(!/tester|135\d|\b\d{12}\b|[a-h][1-8][a-h][1-8]/.test(r.flat), 'no name, rating, key or position: ' + r.flat);
    eq(r.head, '1 of 2 found first try.', 'the score counts the two mistakes');
    eq(r.then, '1 with a hint', 'and their second line (V4.3)');
    eq(r.foils, '1 had nothing to fix: 1 good move.', 'the foil apart');
    eq(JSON.stringify(r.row), JSON.stringify(['rg-first', 'rg-hint', 'rg-first']), 'a glyph for each, the foil\'s too');
    eq(JSON.stringify(r.tile), JSON.stringify({ name: true, glyph: true, word: true, rungs: false, act: false, red: false, played: 2 }), 'the foil\'s tile: "Nothing to fix", "Good move", no rungs, nothing to open, its game move tinted as a move played, never red');
    eq(r.moved, 'Back in 7 days: 1. Back in 5 days: 1.', 'when they come back: the mistakes alone (V4.3)');
    eq(r.stack, 'recap-then / recap-then recap-foils / recap-small', 'the foils\' line right after the category line, before the quiet paragraph');
  });

  /* ── slice 8 merged with Today (slice 5) and the installable app (slice 11) ── */
  await test('F8 with F5: Today\'s board is card 1 as the card opens, a game-mode review with no red arrow (at tier 1 cued, its arrow), and Today\'s set starts with it, its foils after; Resume draws the card the set stopped at in the mode it reopens in: a game-mode card missed before the pause, a foil before its look (after a reload); a dropped set\'s foil left after a miss writes no record and its try counts toward the day; the foil store moves with shiftDays beside the reminder\'s times, rides in the progress file (never the reminder or the install note) and goes with Reset', () => {
    const A = boot({ storage: Object.assign(base(), { 'nl:tip:game': '1', 'nl:tip:gamemode': '1' }) });
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${GAME}
      window.readyEngine(); playerTier = function () { return 2; };
      var norm = function (s) { return String(s).replace(/(checkglow|ah)b\\d+/g, '$1B'); };
      var board = function (h, act) { var m = /<a class="hero-board" data-act="(\\w+)"[^>]*>(<svg[\\s\\S]*?<\\/svg>)<\\/a>/.exec(h); return m && m[1] === act ? m[2] : ''; };
      var own = function (a) { var f = boardOptsFor(a); return boardSvg(f.st, Object.assign({}, f.opts, { decor: true, fx: null })); };
      var reds = function (s) { return (String(s).match(/class="bad-arrow"/g) || []).length; };
      var out = {}, its = allMistakes().filter(trainable);
      /* eight reviews due after a clean find: the warm-up, card 1, is the most familiar */
      its.slice(0, 8).forEach(function (it, i) { asReview(it, i === 3 ? 2 : 1); });
      ui.session = null;
      var plan = todayPlan(), it1 = itemOf(plan.keys[0]), h = heroHtml(plan), b1 = board(h, 'startToday');
      out.today = { first: plan.keys[0] === its[3].key, game: cardFor(it1).game, reds: reds(b1), same: !!b1 && norm(b1) === norm(own(cardFor(it1))), ghost: /ghost-piece/.test(b1) };
      playerTier = function () { return 1; };
      out.t1 = reds(board(heroHtml(todayPlan()), 'startToday'));
      playerTier = function () { return 2; };
      startToday();
      out.set = { first: ui.session.keys[0] === plan.keys[0], foils: ui.session.keys.filter(isFoilKey).length, n: ui.session.keys.length };
      /* paused after a miss on card 1 in game mode: its run ended, its showing keeps the mode */
      var ss = ui.session, k1 = ss.keys[0];
      ss.progress = {}; ss.progress[k1] = { m: 1, h: 0, g: 0, f: null, a: 1, p: 0, au: 0, gm: 1, fc: '', tr: [] };
      srsNoteMiss(it1); saveSession(); ui.session = null;
      var hm = resumeHtml(savedSession()), bm = board(hm, 'resume');
      out.missed = { streak: srsRec(it1).streak, reds: reds(bm), svg: !!bm, cued: reds(firstFrameHtml(it1)) };
      /* stopped at a foil, after a reload (its look not read yet) */
      var sv = store.get(sessKey(), null), fi = sv.keys.map(isFoilKey).indexOf(true), fk = sv.keys[fi];
      sv.idx = fi; sv.progress = {}; store.set(sessKey(), sv);
      foilItems = {};
      var hf = resumeHtml(savedSession()), bf = board(hf, 'resume');
      out.foil = { at: fi > 0, svg: !!bf, wait: /hero-board wait/.test(hf), reds: reds(bf), ghost: /ghost-piece/.test(bf), looked: !!itemOf(fk).b.bu };
      out.foilSame = norm(bf) === norm(own(foilOpen(fk)));
      ui.session = null;
      /* the set dropped with the foil left after a miss */
      sv = store.get(sessKey(), null); sv.progress = {}; sv.progress[fk] = { m: 1, h: 0, g: 0, f: null, a: 1, p: 0, au: 0, gm: 1, fc: '', tr: [] };
      sv.attempted = 0; sv.carried = 0; store.set(sessKey(), sv);
      var c0 = dayLoad().carry || 0;
      settleSaved(savedSession());
      out.dropped = { rec: !!srsLoad()[fk], carry: (dayLoad().carry || 0) - c0 };
      /* the foil store beside slice 5's and 11's keys */
      foilShown(fk);
      var t0 = foilStore().s[fk], c = cueLoad(); c.q = Date.now(); cueSave(c); store.set('nl:install', { at: Date.now(), kind: 'prompt' });
      shiftDays(3);
      out.shift = [(t0 - foilStore().s[fk]) / DAY, (Date.now() - cueLoad().q) / DAY];
      document.createElement = function () { return { click: function () {}, remove: function () {}, setAttribute: function () {}, style: {} }; };
      var blob = ''; Blob = function (parts) { blob = parts[0]; };
      exportProgress();
      out.file = Object.keys(JSON.parse(blob).keys).filter(function (k) { return !/^nl:day:/.test(k); }).sort();
      return JSON.stringify(out); })()`));
    A.click('resetProgress'); A.advance(1500); A.click('resetProgress');
    const gone = JSON.parse(A.ev(`JSON.stringify({ foil: store.get(foilStoreKey(), null), srs: store.get(srsKey(), null) })`));
    eq(JSON.stringify(r.today), JSON.stringify({ first: true, game: true, reds: 0, same: true, ghost: false }), 'Today\'s board: card 1, a game-mode review, as the card opens: no red arrow, no faded game move');
    eq(r.t1, 1, 'at tier 1 the same card is cued: its red arrow');
    eq(JSON.stringify(r.set), JSON.stringify({ first: true, foils: 2, n: 10 }), 'Today\'s set starts with card 1, two foils among the rest, its size kept');
    eq(JSON.stringify(r.missed), JSON.stringify({ streak: 0, reds: 0, svg: true, cued: 1 }), 'paused after a game-mode miss: Resume draws it in game mode, as it reopens (by its record alone it would be cued)');
    eq(JSON.stringify(r.foil), JSON.stringify({ at: true, svg: true, wait: false, reds: 0, ghost: false, looked: false }), 'stopped at a foil after a reload: its board, before its look, no arrow');
    ok(r.foilSame, 'the foil\'s own opening frame');
    eq(JSON.stringify(r.dropped), JSON.stringify({ rec: false, carry: 1 }), 'a dropped foil: no record, its try counts toward the day');
    eq(JSON.stringify(r.shift), '[3,3]', 'shiftDays moves when a foil was shown, as it moves the reminder\'s times');
    eq(JSON.stringify(r.file), JSON.stringify(['nl:foil:cc:tester', 'nl:log:cc:tester', 'nl:srs:cc:tester']), 'the progress file carries the foil store, never the reminder or the install note');
    eq(JSON.stringify(gone), JSON.stringify({ foil: null, srs: null }), 'Reset clears it with the practice history');
  });

  /* ── predict their reply (F10.1) ── */
  /* the forcing cards at tier 3 */
  const T3F = `JSON.stringify((function () { playerTier = function () { return 3; }; return allMistakes().filter(trainable).filter(function (it) { var c = cardFor(it); return c && c.sol && c.sol.length >= 3; }).map(function (it) { return it.key; }); })())`;
  /* the guess's list on the card's record, from their side ([uci, cp, mate]), with the
     position's legal replies counted, at the list's budget (V1.7); ALTS: their legal replies other than the line's */
  const SET_RL = (l) => `(function (a) { var st = replyNode(a); a.it.b.rl = { k: dzSig(a.it.b), d: CONFIRM_NODES, n: legalMoves(st).length, l: ${JSON.stringify(l)} }; return 1; })(ui.session.active)`;
  const ALTS = `JSON.stringify((function (a) { return legalMoves(a.st).map(moveUci).filter(function (u) { return u !== a.sol[a.solIdx]; }); })(ui.session.active))`;
  const GUESS = (u) => `(function (a) { var m = uciToMove(a.st, '${u}'); sessionClick(m.from); sessionClick(m.to); return a.guess ? a.guess.v || 'pending' : 'none'; })(ui.session.active)`;

  await test('F10.1: at tier 3 the first move of a forcing line asks for their best reply ("Right" / "Now their best reply?" beside [Their reply], no honey button): nothing moves until a guess or that button (no telegraph, no slide, a minute on), Enter presses nothing, a piece of yours says whose move it is; the list it is judged by is one search of the position after the expected move (1,000,000 nodes, three lines: V1.7, the key\'s budget), kept from their side and asked once', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(window.readyEngine(), 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(T3F)), lead = A.ev('SLIDE_LEAD');
    ok(keys.length >= 8, 'tier 3 forcing cards: ' + keys.length);
    const own = () => A.ev(`(function (a) { for (var s = 0; s < 64; s++) if (a.st.b[s] && isW(a.st.b[s]) === myPov(a.it)) return s; return -1; })(ui.session.active)`);
    for (const key of keys.slice(0, 4)) {
      const at = key;
      A.ev(`(playerTier = function () { return 3; }, window.readyEngine(), window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      const t = A.getNow();
      eq(A.ev(FIRST('tap')), 'reply', at + ': the first move found');
      run(lead + 220 + 200);
      const s0 = JSON.parse(A.ev('JSON.stringify((function (a) { return { ask: !!a.reply.ask, tele: !!a.reply.tele, played: a.reply.played, solIdx: a.solIdx, on: !!a.guessOn, opp: sidesOf(a).opp }; })(ui.session.active))'));
      eq(JSON.stringify([s0.ask, s0.tele, s0.played, s0.solIdx, s0.on]), '[true,false,false,1,true]', at + ': asking, ' + JSON.stringify(s0));
      let ws = WR(A, t), band = ws.filter((w) => w.id === 'cband').pop(), bar = ws.filter((w) => w.id === 'cbar').pop();
      eq(R1(band.v) + ' / ' + R2(band.v), 'Right / Now their best reply?', at + ': the question');
      ok(/class="slot-empty" data-slot="0"/.test(bar.v) && /class="btn-line" data-slot="1" data-icon="play" data-act="theirReply">Their reply</.test(bar.v) && !/btn-big/.test(bar.v), at + ': [Their reply] alone, no honey button, ' + bar.v);
      eq(A.ev('honeySlot()'), -1, at + ': no honey slot');
      /* a minute: nothing moves; Enter presses nothing */
      const tq = A.getNow();
      run(3000); A.advance(57000);
      A.key('Enter');
      ws = WR(A, tq);
      eq(ws.filter((w) => w.id === 'bwrap' || (w.id === 'marks' && /rring|rdash|rsolid/.test(w.v))).length, 0, at + ': nothing drawn while it asks, ' + JSON.stringify(ws));
      eq(A.ev('JSON.stringify([ui.session.active.phase, ui.session.active.solIdx, !!ui.session.active.reply.ask, ui.session.active.reply.played])'), '["reply",1,true,false]', at + ': after a minute and Enter');
      /* the board's name never names their reply while it asks */
      const lab = A.ev('boardOptsFor(ui.session.active).opts.label'), rinfo = JSON.parse(A.ev(REPLY_INFO));
      ok(!/Blue arrow|reply/.test(lab) && lab.indexOf(A.ev(`sqName(${rinfo.to})`) + '.') < 0, at + ': the board name says nothing of their reply: ' + lab);
      /* a piece of yours: whose move it is, for a while */
      const tn = A.getNow();
      A.tap(own());
      run(300);
      const nb = WR(A, tn).filter((w) => w.id === 'cband').pop();
      eq(nb && R2(nb.v), 'Guess their move: a ' + s0.opp.toLowerCase() + ' piece.', at + ': a tap on a piece of yours');
      eq(A.ev('ui.session.active.sel'), -1, at + ': nothing picked up');
      run(3000);
      eq(R2(WR(A, tn).filter((w) => w.id === 'cband').pop().v), 'Now their best reply?', at + ': the question again');
      /* a piece of theirs picks up, with its dots */
      const theirs = rinfo.from;
      A.ev(`(sessionClick(${theirs}), 1)`);
      run(100);
      ok(A.ev('ui.session.active.sel') === theirs && A.ev('(boardOptsFor(ui.session.active).opts.dots || []).length') > 0, at + ': their piece picked up, its moves dotted');
      A.ev(`(sessionClick(${theirs}), 1)`);
      eq(A.ev('ui.session.active.sel'), -1, at + ': and put down');
      /* the list: one search, prioritized, of the position after the expected move */
      const jobs = JSON.parse(A.ev(`JSON.stringify(window.__evals.filter(function (j) { return j.opts.rl && j.opts.tag === '${key}'; }).map(function (j) { return { fen: j.fen, nodes: j.nodes, mpv: j.opts.multipv, prio: j.prio, want: stateFen(replyNode(ui.session.active)) }; }))`));
      eq(jobs.length, 1, at + ': one list search');
      eq(JSON.stringify([jobs[0].nodes, jobs[0].mpv, jobs[0].prio, jobs[0].fen === jobs[0].want]), '[1000000,3,true,true]', at + ': 1,000,000 nodes, three lines, the position after the first move');
      /* answered (scores from White's side): kept on the record from their side, the line's moves only */
      const kept = JSON.parse(A.ev(`JSON.stringify((function (a) {
        var j = window.__evals.filter(function (x) { return x.opts.rl && x.opts.tag === '${key}'; })[0], st = replyNode(a), them = !myPov(a.it), ms = legalMoves(st).map(moveUci);
        var mk = function (u, cpThem, mateThem) { return { cp: them ? cpThem : -cpThem, mate: mateThem == null ? null : them ? mateThem : -mateThem, pv: [u] }; };
        var lines = [mk(a.sol[1], 120), mk(ms.filter(function (u) { return u !== a.sol[1]; })[0], 60), mk(ms.filter(function (u) { return u !== a.sol[1]; })[1] || ms[0], -800, -3)];
        j.res({ cp: lines[0].cp, mate: null, pv: lines[0].pv, lines: lines, depth: 18, stopped: false });
        return { n: ms.length };
      })(ui.session.active))`));
      await tick();
      const rl = JSON.parse(A.ev('JSON.stringify(ui.session.active.it.b.rl)'));
      ok(rl && rl.k === A.ev('dzSig(ui.session.active.it.b)') && rl.n === kept.n && rl.l.length === 3, at + ': kept on the record, ' + JSON.stringify(rl));
      eq(JSON.stringify(rl.l.map((x) => [x[1], x[2]])), JSON.stringify([[120, null], [60, null], [-800, -3]]), at + ': from their side');
      eq(rl.l[0][0], A.ev('ui.session.active.sol[1]'), at + ': their best first');
      /* asked once: the next showing of this card asks no search */
      A.ev(`(playerTier = function () { return 3; }, window.readyEngine(), window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      eq(A.ev(`window.__evals.filter(function (j) { return j.opts.rl && j.opts.tag === '${key}'; }).length`), 1, at + ': no second search');
      ok(A.ev('!!ui.session.active.reply.ask'), at + ': asking again');
    }
  });

  await test('F10.1: a guess plays their reply on its own timeline from the guess and says what it was: the guess arrow at once with "your guess", the bar off 150 ms later, the telegraph at 600 (the guess arrow gone where it is the same move), the slide 1450 to 1900, then "Your move" with "You saw it: X." (their reply), "Close. Their best was X." (within 4 points, V1.7), "Not Y: they had X." (more), "They had X." (off a list whose last line is as good as the best); a wrong guess is no miss; the record and the log keep it', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(window.readyEngine(), window.__clar = [], window.clarity = function (k, n) { window.__clar.push(n); }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(T3F)), lead = A.ev('SLIDE_LEAD');
    const CASES = ['saw', 'good', 'not', 'open'], measures = [];
    let n = 0;
    for (const key of keys) {
      A.ev(`(playerTier = function () { return 3; }, window.readyEngine(), window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      run(lead + 220 + 200);
      const sol1 = A.ev('ui.session.active.sol[1]'), alts = JSON.parse(A.ev(ALTS));
      /* the next case this card can hold (a guess off a list of three needs three other replies) */
      const kind = CASES[n % CASES.length], at = key + ' ' + kind;
      if (kind === 'open' ? alts.length < 3 : kind !== 'saw' && alts.length < 1) continue;
      n++;
      measures.push('guess_' + { saw: 'right', good: 'right', not: 'wrong', open: 'open' }[kind]);
      /* the list (their side): "good" lists the guess 1.5 points under the best, "not" 30 points under, "open" leaves it off a list of three as good as each other */
      const list = kind === 'good' ? [[sol1, 100, null], [alts[0], 60, null]] : kind === 'not' ? [[sol1, 100, null], [alts[0], -300, null]] : kind === 'open' ? [[sol1, 100, null], [alts[1], 90, null], [alts[2] || alts[1], 80, null]] : [[sol1, 100, null]];
      A.ev(SET_RL(list));
      const guess = kind === 'saw' ? sol1 : alts[0];
      /* V1.7: their move and the guess keep their check signs */
      const ysan = A.ev(`(function (a) { return sanOf(a.st, uciToMove(a.st, a.sol[1])); })(ui.session.active)`), gsan = A.ev(`(function (a) { return sanOf(a.st, uciToMove(a.st, '${guess}')); })(ui.session.active)`);
      const tg = A.getNow();
      const v = A.ev(GUESS(guess));
      const want = { saw: 'You saw it: ' + ysan + '.', good: 'Close. Their best was ' + ysan + '.', not: 'Not ' + gsan + ': they had ' + ysan + '.', open: 'They had ' + ysan + '.' }[kind];
      eq(v, kind, at + ': judged at once');
      /* the arrow at once, labelled; nothing slides */
      let ws = WR(A, tg);
      const b0 = ws.filter((w) => w.id === 'bwrap' && w.t === tg).pop();
      ok(b0 && /guess/.test(b0.v) && !/rring|rdash|slide|slow/.test(b0.v), at + ': the guess arrow at once, ' + JSON.stringify(b0));
      eq(A.ev('(function (a) { var l = frameLabel(a, boardOptsFor(a), 384, false); return l ? l.text : ""; })(ui.session.active)'), 'your guess', at + ': its label');
      ok(/Blue arrow: your guess of (White|Black)'s reply, /.test(A.ev('boardOptsFor(ui.session.active).opts.label')), at + ': and its words for a screen reader');
      run(200);
      ws = WR(A, tg);
      const bar1 = ws.filter((w) => w.id === 'cbar')[0], band1 = ws.filter((w) => w.id === 'cband').pop();
      ok(bar1 && bar1.t === tg + 150 && (bar1.v.match(/btn-off/g) || []).length === 2 && !/data-act/.test(bar1.v), at + ': the bar off 150 ms later, ' + JSON.stringify(bar1));
      ok(!band1 || R2(band1.v) === 'Now their best reply?', at + ': the question stays while their reply comes');
      run(2200);
      ws = WR(A, tg);
      const marks = ws.filter((w) => w.id === 'marks'), boards = ws.filter((w) => w.id === 'bwrap');
      const tele = marks.filter((w) => /rring/.test(w.v))[0];
      ok(tele && tele.t === tg + 600 && /rdash/.test(tele.v) && /guess/.test(tele.v) === (kind !== 'saw'), at + ': the telegraph at 600, the guess beside it unless the same move, ' + JSON.stringify(marks));
      const slide = boards.filter((w) => /slow/.test(w.v))[0];
      ok(slide && slide.t === tg + 1500 - lead && /guess/.test(slide.v) === (kind !== 'saw'), at + ': the slide drawn at 1450, ' + JSON.stringify(boards));
      const land = boards.filter((w) => w.t > slide.t)[0];
      ok(land && land.t === tg + 1900 && /rsolid/.test(land.v) && !/guess|rring/.test(land.v), at + ': landed at 1900, the guess gone, ' + JSON.stringify(land));
      const b2 = ws.filter((w) => w.id === 'cband' && w.t >= tg + 2050)[0];
      ok(b2 && b2.t === tg + 2050 && R1(b2.v) === 'Your move' && R2(b2.v) === want, at + ': at 2050 "Your move" / ' + want + ', ' + JSON.stringify(b2 && [b2.t - tg, R1(b2.v), R2(b2.v)]));
      eq(A.ev('JSON.stringify([ui.session.active.phase, ui.session.active.misses, ui.session.active.result || null, ui.session.active.solIdx])'), '["guess",0,null,2]', at + ': no miss, the line goes on');
      /* the line finished: the record keeps a right guess, the log the guess */
      A.ev(`(function (a) { for (var g = 0; g < 10 && a.phase !== 'done'; g++) { var m = uciToMove(a.st, a.sol[a.solIdx]); gradeMove(m); var rp = a.reply; if (rp) { theirReply(a, false); replyDone(a, rp); } } return 1; })(ui.session.active)`);
      const after = JSON.parse(A.ev(`JSON.stringify({ phase: ui.session.active.phase, result: ui.session.active.result, pg: !!srsLoad()['${key}'].pg, gu: logLoad().filter(function (e) { return e.k === '${key}'; }).pop().gu })`));
      eq(JSON.stringify([after.phase, after.result, after.pg, after.gu]), JSON.stringify(['done', 'first', kind === 'saw' || kind === 'good', kind]), at + ': solved first try, the guess kept, ' + JSON.stringify(after));
    }
    ok(n >= 8, 'cases run ' + n);
    const clar = JSON.parse(A.ev('JSON.stringify(window.__clar)')).filter((x) => /^guess_/.test(x));
    eq(JSON.stringify(clar), JSON.stringify(measures), 'the measure, once a showing, as a word');
  });

  await test('F10.1: Their reply skips the guess (the reply at once, its own words after); under reduced motion a guess draws the telegraph at once, the reply 300 ms later and its words 300 ms after that; no question at tier 2, after another first move as good (found, V1.2) or one that works too (the card ends there), inside the line, or with the engine down (the reply on its timeline)', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    A.ev('(window.readyEngine(), 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(T3F)), lead = A.ev('SLIDE_LEAD');
    const show = (key, tier) => { A.ev(`(playerTier = function () { return ${tier}; }, window.readyEngine(), window.__show(model().byKey['${key}']), 1)`); run(1000); };
    /* skipped: [Their reply] plays it at once, F4 after it lands, the guess noted as skipped */
    for (const key of keys.slice(0, 3)) {
      show(key, 3);
      A.ev(FIRST('tap'));
      run(lead + 220 + 600);
      const info = JSON.parse(A.ev(REPLY_INFO)), tp = A.getNow();
      A.click('theirReply', null, 1);
      const s = JSON.parse(A.ev(STATE));
      ok(s.reply && s.reply.played && s.solIdx === 2 && s.mu === tp + lead + 400, key + ': skipped, the reply slides at once, ' + JSON.stringify(s));
      run(lead + 400 + 300);
      const b2 = WR(A, tp).filter((w) => w.id === 'cband').pop();
      eq(R1(b2.v) + ' / ' + R2(b2.v), 'Your move / ' + info.want, key + ': its own words');
      eq(A.ev('JSON.stringify(ui.session.active.guess)'), '{"skip":true}', key + ': noted as skipped');
    }
    /* reduced motion: the guess, the telegraph at once, the reply 300 ms later (no slide), its words 300 ms after */
    A.ev('(ui.reducedTest = true, 1)');
    for (const key of keys.slice(0, 3)) {
      show(key, 3);
      A.ev(FIRST('tap'));
      run(400);
      const bar = WR(A, A.getNow() - 400).filter((w) => w.id === 'cbar').pop();
      ok(bar && /data-act="theirReply"/.test(bar.v) && !/btn-big/.test(bar.v), key + ': reduced motion, the question\'s bar, ' + JSON.stringify(bar));
      ok(!A.ev('ui.session.active.reply.tele'), key + ': no telegraph while it asks');
      const tg = A.getNow();
      A.ev(GUESS(A.ev('ui.session.active.sol[1]')));
      let ws = WR(A, tg), bt = ws.filter((w) => w.id === 'bwrap' && w.t === tg).pop();
      ok(bt && /rring/.test(bt.v) && /rdash/.test(bt.v) && !/guess/.test(bt.v), key + ': the telegraph at once (the guess, the same move, under it), ' + JSON.stringify(ws));
      A.advance(290);
      eq(A.ev('ui.session.active.reply.played'), false, key + ': not yet at 290');
      A.advance(20);
      ws = WR(A, tg + 300);
      ok(ws.filter((w) => w.id === 'bwrap' && /rsolid/.test(w.v) && !/slow|slide/.test(w.v))[0], key + ': the reply at 300, no slide, ' + JSON.stringify(ws));
      A.advance(280);
      eq(A.ev('ui.session.active.phase'), 'reply', key + ': its words wait');
      A.advance(40);
      const b2 = WR(A, tg).filter((w) => w.id === 'cband').pop();
      ok(b2 && b2.t === tg + 600 && R1(b2.v) === 'Your move' && /^You saw it: /.test(R2(b2.v)), key + ': the words at 600, ' + JSON.stringify(b2 && [b2.t - tg, R1(b2.v), R2(b2.v)]));
    }
    A.ev('(ui.reducedTest = false, 1)');
    /* tier 2: the reply on its timeline, no question */
    show(keys[0], 2);
    A.ev(FIRST('tap'));
    eq(A.ev('JSON.stringify([!!ui.session.active.reply.ask, !!ui.session.active.guessOn])'), '[false,false]', 'tier 2 asks nothing');
    run(lead + 220 + 700);
    ok(A.ev('ui.session.active.reply.tele'), 'tier 2: the telegraph at 600');
    /* inside the line: the second move found plays their reply on its timeline */
    const long = keys.filter((k) => A.ev(`model().byKey['${k}'] && (playerTier = function () { return 3; }, cardFor(model().byKey['${k}']).sol.length)`) >= 5)[0];
    ok(long, 'a line with two replies');
    show(long, 3);
    A.ev(FIRST('tap'));
    run(lead + 220 + 600);
    A.click('theirReply', null, 1);
    run(1500);
    eq(A.ev('ui.session.active.phase'), 'guess', long + ': the second move asked');
    A.ev('(function (a) { a.tapped = true; gradeMove(uciToMove(a.st, a.sol[2])); return 1; })(ui.session.active)');
    eq(A.ev('JSON.stringify([ui.session.active.phase, !!ui.session.active.reply.ask])'), '["reply",false]', long + ': no question at its second reply');
    /* another first move as good as the line's (found, V1.2): the card ends, no question */
    show(keys[0], 3);
    A.ev(`(function (a) { var b = a.it.b, alt = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return u !== a.bestUci && u !== a.playedUci && a.sol.indexOf(u) < 0; })[0];
      window.__tryPv = null; window.__tryCp = b.eb; window.__tryMate = null; a.tapped = true; gradeMove(alt); return 1; })(ui.session.active)`);
    await tick(); await tick();
    eq(A.ev('JSON.stringify([ui.session.active.phase, !!(ui.session.active.near || ui.session.active.alt), !!ui.session.active.guess, !!ui.session.active.reply])'), '["done",true,false,false]', 'a move as good ends the card with no question');
    A.ev('(window.__tryCp = null, 1)');
    /* the engine down: no question, the reply on its timeline */
    show(keys[1], 3);
    A.ev('(SF.state = "failed", 1)');
    A.ev(FIRST('tap'));
    eq(A.ev('!!ui.session.active.reply.ask'), false, 'the engine down: no question');
    run(lead + 220 + 700);
    ok(A.ev('ui.session.active.reply.tele'), 'the engine down: the telegraph at 600');
    A.ev('(window.readyEngine(), 1)');
  });

  await test('F10.1: the question by keyboard and by drag: the strip\'s field says "Type their move", its example a legal move of theirs off the line and off the list; their move typed is the guess, anything else is answered as not legal with such an example and guesses nothing; their piece dragged to a square guesses too, and dropped where it cannot go it snaps back with nothing guessed; either way their reply plays from the guess and row 2 says what it was', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(window.readyEngine(), window.__said = [], notice = function (t) { window.__said.push(t); }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const keys = JSON.parse(A.ev(T3F)), lead = A.ev('SLIDE_LEAD');
    let typed = 0, dragged = 0;
    for (const key of keys) {
      if (typed >= 2 && dragged >= 2) break;
      A.ev(`(playerTier = function () { return 3; }, window.readyEngine(), window.__show(model().byKey['${key}']), 1)`);
      run(1000);
      A.ev(FIRST('tap'));
      run(lead + 220 + 200);
      const alts = JSON.parse(A.ev(ALTS)), sol1 = A.ev('ui.session.active.sol[1]');
      if (alts.length < 2 || !A.ev('!!ui.session.active.reply.ask')) continue;
      /* the list: one move as good as their reply, one far worse */
      A.ev(SET_RL([[sol1, 100, null], [alts[0], 90, null], [alts[1], -400, null]]));
      const byKey = typed <= dragged, at = key + (byKey ? ' typed' : ' dragged');
      const ex = JSON.parse(A.ev(`JSON.stringify((function (a) { var h = stripHtml(a, ui.session), m = /placeholder="e\\.g\\. ([^ ]+) or ([a-h][1-8][a-h][1-8][qrbn]?)"/.exec(h);
        return { label: /Type their move <input/.test(h) && /aria-label="Type their move"/.test(h), uci: m && m[2], legal: !!(m && uciToMove(a.st, m[2]) && sanToMove(a.st, m[1])), avoid: cardAvoid(a).concat(replyList(a.it.b).l.map(function (x) { return x[0]; })) }; })(ui.session.active))`));
      ok(ex.label, at + ': "Type their move"');
      ok(ex.legal && ex.avoid.indexOf(ex.uci) < 0, at + ': its example a move of theirs off the line and the list, ' + JSON.stringify(ex));
      /* V1.7: check signs kept */
      const san = (u) => A.ev(`(function (a) { return sanOf(a.st, uciToMove(a.st, '${u}')); })(ui.session.active)`);
      const ysan = san(sol1), guess = byKey ? alts[0] : alts[1], gsan = san(guess);
      let tg;
      if (byKey) {
        A.key('Enter', false, { id: 'kbmove', value: 'Zz9' });
        const said = A.ev('window.__said.pop() || ""'), eg = /Try one like ([^ ]+) or ([a-h][1-8][a-h][1-8][qrbn]?)\./.exec(said);
        ok(eg && ex.avoid.indexOf(eg[2]) < 0 && A.ev(`!!uciToMove(ui.session.active.st, '${eg ? eg[2] : ''}')`), at + ': not legal, with an example off the line and the list: ' + said);
        eq(A.ev('JSON.stringify([!!ui.session.active.reply.ask, ui.session.active.guess || null])'), '[true,null]', at + ': nothing guessed');
        tg = A.getNow();
        A.key('Enter', false, { id: 'kbmove', value: A.ev(`(function (a) { return sanOf(a.st, uciToMove(a.st, '${guess}')); })(ui.session.active)`) });
        typed++;
      } else {
        const m = JSON.parse(A.ev(`JSON.stringify((function (a) { var m = uciToMove(a.st, '${guess}'), to = -1;
          for (var s = 0; s < 64 && to < 0; s++) if (s !== m.from && !legalMoves(a.st).some(function (x) { return x.from === m.from && x.to === s; }) && !(a.st.b[s] && isW(a.st.b[s]) === !!a.st.w)) to = s;
          return { from: m.from, to: m.to, bad: to }; })(ui.session.active))`));
        A.drag(m.from, m.bad);
        eq(A.ev('JSON.stringify([!!ui.session.active.reply.ask, ui.session.active.guess || null, ui.session.active.sel, ui.session.active.note ? ui.session.active.note.id : null])'), '[true,null,-1,"T5"]', at + ': dropped where it cannot go, it snaps back (T5), nothing guessed');
        run(2100);
        tg = A.getNow();
        A.drag(m.from, m.to);
        dragged++;
      }
      eq(A.ev('JSON.stringify(ui.session.active.guess && [ui.session.active.guess.uci, ui.session.active.guess.v])'), JSON.stringify([guess, byKey ? 'good' : 'not']), at + ': the guess, judged');
      ok(A.ev('(boardOptsFor(ui.session.active).opts.arrows || []).some(function (x) { return x.kind === "guess"; })'), at + ': its arrow');
      run(2200);
      const b2 = WR(A, tg).filter((w) => w.id === 'cband').pop();
      const want = byKey ? 'Close. Their best was ' + ysan + '.' : 'Not ' + gsan + ': they had ' + ysan + '.';
      ok(b2 && b2.t === tg + 2050 && R1(b2.v) === 'Your move' && R2(b2.v) === want, at + ': their reply from the guess, then "Your move" / ' + want + ', ' + JSON.stringify(b2 && [b2.t - tg, R1(b2.v), R2(b2.v)]));
    }
    eq(typed + ' ' + dragged, '2 2', 'typed and dragged');
  });

  await test('F10.1: at tier 3 a forcing card is learned only once their best reply was guessed right: the clean find 16 days on that would make it learned holds its step without one (its interval again, "held" in what moved, Details says why), and is learned with one', () => {
    const A = boot();
    A.ev('(window.readyEngine(), 1)');
    const keys = JSON.parse(A.ev(T3F)), key = keys[0], DAYMS = 864e5;
    /* the line played to its end: the first reply skipped or guessed (u), the others on their own */
    const PLAY = (guess) => `(function () {
      playerTier = function () { return 3; }; window.readyEngine();
      var it = model().byKey['${key}'];
      ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
      var a = cardFor(it); ui.session.active = a; a.shownAt = Date.now() - 60000;
      a.it.b.rl = { k: dzSig(a.it.b), d: CONFIRM_NODES, n: 9, l: [[a.sol[1], 100, null]] };
      gradeMove(uciToMove(a.st, a.sol[0]));
      if (!a.reply || !a.reply.ask) return 'no question';
      ${guess ? `makeGuess(a, uciToMove(a.st, a.sol[1]));` : ''}
      for (var g = 0; g < 10 && a.phase !== 'done'; g++) {
        var rp = a.reply;
        if (rp) { theirReply(a, false); replyDone(a, rp); continue; }
        gradeMove(uciToMove(a.st, a.sol[a.solIdx]));
      }
      var rec = srsLoad()[it.key];
      return JSON.stringify({ phase: a.phase, result: a.result, held: a.held, learned: !!rec.learned, box: rec.box, streak: rec.streak, due: Math.round((rec.due - Date.now()) / ${DAYMS}), pg: !!rec.pg,
        moved: ui.session.sum[it.key].m, details: detailsHtml().indexOf(GUESS_HELD) >= 0, hd: logLoad().pop().hd || null });
    })()`;
    const now = A.getNow();
    A.ev(`(function () { var s = srsLoad(); s['${key}'] = { box: 3, streak: 2, due: ${now} - 3600e3, last: ${now} - 17 * ${DAYMS}, ls: ${now} - 17 * ${DAYMS}, lapses: 0, n: 2 }; srsSave(s); return 1; })()`);
    const r1 = JSON.parse(A.ev(PLAY(false)));
    eq(JSON.stringify([r1.phase, r1.result, r1.held, r1.learned, r1.box, r1.streak, r1.pg, r1.moved, r1.details, r1.hd]), JSON.stringify(['done', 'first', 'guess', false, 3, 2, false, 'held', true, 'guess']), 'no right guess: held, ' + JSON.stringify(r1));
    ok(r1.due >= 13 && r1.due <= 19, 'its step\'s interval again: ' + r1.due + ' days');
    eq(A.ev('GUESS_HELD'), 'Found first try. One right guess of their best reply makes it learned.', 'Details says why');
    /* 17 days on, a right guess: learned */
    A.setNow(now + 17 * DAYMS);
    const r2 = JSON.parse(A.ev(PLAY(true)));
    eq(JSON.stringify([r2.result, r2.held || null, r2.learned, r2.pg, r2.moved, r2.details]), JSON.stringify(['first', null, true, true, 'learned', false]), 'a right guess: learned, ' + JSON.stringify(r2));
    /* one right guess is kept for good: a record that had it is learned without guessing again */
    A.ev(`(function () { var s = srsLoad(); s['${key}'] = { box: 3, streak: 2, due: Date.now() - 3600e3, last: Date.now() - 17 * ${DAYMS}, ls: Date.now() - 17 * ${DAYMS}, lapses: 0, n: 5, pg: 1 }; srsSave(s); return 1; })()`);
    const r3 = JSON.parse(A.ev(PLAY(false)));
    eq(JSON.stringify([r3.held || null, r3.learned]), '[null,true]', 'a right guess on record: learned with the guess skipped, ' + JSON.stringify(r3));
  });

  /* ── the engine re-check (F10.4) ── */
  await test('F10.4: at tier 3 a try 1 point inside the band near a verdict line (3 points from the best: solved at first) is searched again at 1,000,000 nodes, and that search decides (here a miss); one inside the close band (9 points) the same; a re-search unanswered 8 s after the try leaves the first verdict, its search stopped, "Checking…" covering the wait; 7 points (within 12 of the good-move line) and tier 2 the same (V1.3: every gap up to the big-mistake line and 12 more, at every tier); far from every line (45 points), one search', async () => {
    const A = boot();
    A.ev('(window.readyEngine(), window.__re = [], 1)');
    /* the 1,000,000-node search of a try: scored with window.__reCp (the solver's side), or held (window.__reHold) */
    A.ev(`(function () { var e0 = engineEval;
      engineEval = function (fen, mt, prio, opts) {
        if (!(opts && opts.tag === 'check' && mt && mt.nodes === CONFIRM_NODES)) return e0.apply(this, arguments);
        var a = ui.session.active, sign = myPov(a.it) ? 1 : -1, u = opts.searchmoves[0], ex = opts.searchmoves[1];
        var job = { fen: fen, opts: opts, prio: prio };
        window.__re.push(job);
        var lines = [{ cp: window.__reCp * sign, mate: null, pv: [u] }].concat(ex ? [{ cp: a.it.b.eb * sign, mate: null, pv: [ex] }] : []);
        var r = { cp: lines[0].cp, mate: null, bestUci: u, pv: lines[0].pv, lines: lines, depth: 22, stopped: false };
        return window.__reHold ? new Promise(function (res) { job.res = res; }) : Promise.resolve(r);
      };
      return 1; })()`);
    /* a one-move card with no safe win and no mate: a try scored from the best by gap points */
    const key = A.ev(`(function () { playerTier = function () { return 3; }; return allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && !c.sol && !(x.b.mb > 0) && winPct(x.b.eb) < 60 && winPct(x.b.eb) > 30 && familyOf(patternOf(x.b)).key !== 'chances'; })[0].key; })()`);
    const tryAt = (tier, gap, reGap, hold) => A.ev(`(function () { ${OPEN} ${TRY} ${AFTER}
      window.__re = []; window.__stops = []; window.__reHold = ${!!hold}; window.__bestCp = null;
      var a = openAt('${key}', ${tier}); a.shownAt = 0;
      var b = a.it.b, off = offBook(a);
      window.__reCp = cpFromWin(winPct(b.eb) - ${reGap});
      window.__t0 = Date.now();
      tryMove(a, moveUci(off), null, cpFromWin(winPct(b.eb) - ${gap}), null);
      return a.phase; })()`);
    const state = () => JSON.parse(A.ev('JSON.stringify({ phase: ui.session.active.phase, kind: ui.session.active.tried ? ui.session.active.tried.kind : null, result: ui.session.active.result || null, re: window.__re.map(function (j) { return j.opts.searchmoves.length + ":" + j.prio; }), said: ui.session.active.checkSaid, rc: ui.session.active.rc || null, stops: window.__stops.filter(function (s) { return s === "check"; }).length })'));
    /* 3 points: solved by the first search, a miss by the second, which decides */
    eq(tryAt(3, 3, 20, false), 'checking', 'the try is checked');
    await tick(); await tick(); await tick();
    let s = state();
    eq(JSON.stringify([s.phase, s.kind, s.re, s.rc && [s.rc.n, s.rc.flip, s.rc.late]]), JSON.stringify(['tried', 'miss', ['2:true'], [1, 1, 0]]), 'a second search at 1,000,000 nodes decides: ' + JSON.stringify(s));
    /* 9 points (the close band): close at first, solved by the second search */
    tryAt(3, 9, 1, false);
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.result, s.re.length]), JSON.stringify(['done', 'first', 1]), 'the close band: the second search decides (found first try), ' + JSON.stringify(s));
    /* held: "Checking…" until 8 s after the try, then the first verdict (solved), the search stopped */
    tryAt(3, 3, 20, true);
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.re.length]), '["checking",1]', 'the second search runs: ' + JSON.stringify(s));
    A.advance(300);
    eq(state().said, 1, 'Checking… at 300 ms');
    A.advance(2800);
    eq(state().said, 2, 'Still checking at 3 s');
    A.advance(4800);
    eq(state().phase, 'checking', 'still checking at 7.9 s');
    A.advance(200);
    s = state();
    eq(JSON.stringify([s.phase, s.result, s.stops, s.rc && [s.rc.n, s.rc.flip, s.rc.late]]), JSON.stringify(['done', 'first', 1, [1, 0, 1]]), 'at 8 s the first verdict stands, the search stopped: ' + JSON.stringify(s));
    /* its late answer changes nothing */
    A.ev('(function () { var j = window.__re[0]; j.res({ cp: 0, mate: null, pv: [], lines: [], stopped: true }); return 1; })()');
    await tick(); await tick();
    eq(state().result, 'first', 'a late answer changes nothing');
    /* V1.3: 7 points and tier 2 searched again too; far from every verdict line, one search */
    tryAt(3, 7, 20, false);
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.kind, s.re.length]), JSON.stringify(['tried', 'miss', 1]), '7 points: close at first, the second search decides, ' + JSON.stringify(s));
    tryAt(2, 3, 20, false);
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.kind, s.re.length]), JSON.stringify(['tried', 'miss', 1]), 'tier 2: the second search decides, ' + JSON.stringify(s));
    tryAt(3, 45, 1, false);
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.kind, s.re.length]), JSON.stringify(['tried', 'miss', 0]), '45 points: one search, ' + JSON.stringify(s));
    /* a first answer that comes after 8 s is the verdict at once */
    A.ev('(function () { window.__holdTry = true; return 1; })()');
    A.ev(`(function () { ${OPEN} ${TRY} ${AFTER} var a = openAt('${key}', 3); a.shownAt = 0; window.__re = []; tryMove(a, moveUci(offBook(a)), null, cpFromWin(winPct(a.it.b.eb) - 3), null); return 1; })()`);
    A.advance(8500);
    A.ev('(function () { var j = window.__evals.filter(function (x) { return x.opts.tag === "check" && x.res; }).pop(); j.res(j.answer); return 1; })()');
    await tick(); await tick(); await tick();
    s = state();
    eq(JSON.stringify([s.phase, s.result, s.re.length]), JSON.stringify(['done', 'first', 0]), 'a first answer after 8 s: no second search, ' + JSON.stringify(s));
    A.ev('(window.__holdTry = false, 1)');
  });

  /* ── slice 10 with game-mode reviews and beginner teaching ── */
  await test('F10.1 with F8.3: at tier 3 the time "Now their best reply?" stands open is no part of the solve time: a forcing review at its learned step (game mode, its Review tag beside the question), its question open 90 s and its moves found in 20 s, is learned with a right guess (the log keeps 20 s, and the 90 apart); with the guess skipped it holds for the guess, never the clock; found in 70 s it holds for F8.3 first ("Found first try in 1:10. Under 60 s makes it learned.", the question\'s 30 s left out), the next quick find holds for the guess, and a right guess makes it learned; a first sight found in 10 s keeps its week though the question stood a minute', () => {
    const A = boot();
    A.ev('(window.readyEngine(), 1)');
    const key = JSON.parse(A.ev(T3F))[0], DAYMS = 864e5;
    /* the card at its learned step: box 3, a run of two, 17 days on (written as it is: srsSave would
       keep the record answered since) */
    const STEP = `(function () { var s = srsLoad(); s['${key}'] = { box: 3, streak: 2, due: Date.now() - 3600e3, last: Date.now() - 17 * ${DAYMS}, ls: Date.now() - 17 * ${DAYMS}, lapses: 0, n: 2 }; store.set(srsKey(), s); srsMem = null; srsRevision++; return 1; })()`;
    /* opened in a set of its own (its list on the record: their reply the best), the first move found
       find1 ms after it shows, the question open for open ms, then right (their reply) or skipped
       (Their reply), the rest of the line found find2 ms after the reply's words */
    const play = (find1, open, right, find2) => {
      A.ev(`(function () {
        playerTier = function () { return 3; }; window.readyEngine();
        var it = model().byKey['${key}'];
        ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
        var a = cardFor(it); ui.session.active = a; a.shownAt = Date.now();
        a.it.b.rl = { k: dzSig(a.it.b), d: CONFIRM_NODES, n: 9, l: [[a.sol[1], 100, null]] };
        window.__a = a; return 1; })()`);
      A.advance(find1);
      const q = JSON.parse(A.ev(`(function (a) { gradeMove(uciToMove(a.st, a.sol[0])); var d = displayFor(a);
        return JSON.stringify({ game: a.game, ask: !!(a.reply && a.reply.ask), band: [d.row1, d.row2, d.tag].join(' | ') }); })(window.__a)`));
      A.advance(open);
      A.ev(`(function (a) { var rp = a.reply; ${right ? 'makeGuess(a, uciToMove(a.st, a.sol[1]));' : ''} theirReply(a, false); replyDone(a, rp); return 1; })(window.__a)`);
      A.advance(find2);
      return Object.assign(q, JSON.parse(A.ev(`(function (a) {
        for (var g = 0; g < 10 && a.phase !== 'done'; g++) {
          var rp = a.reply;
          if (rp) { theirReply(a, false); replyDone(a, rp); continue; }
          gradeMove(uciToMove(a.st, a.sol[a.solIdx]));
        }
        var rec = srsLoad()[a.key], e = logLoad().pop();
        return JSON.stringify({ result: a.result, held: a.held || null, learned: !!rec.learned, box: rec.box, streak: rec.streak, pg: !!rec.pg, ms: a.ms,
          moved: ui.session.sum[a.key].m || '', s: e.s, gt: e.gt || null, tb: e.tb || null, hd: e.hd || null, gu: e.gu || null,
          dt: (/<p class="dt-more dt-held">([^<]*)<\\/p>/.exec(detailsHtml()) || [])[1] || null }); })(window.__a)`)));
    };
    /* a right guess, the question open 90 s, the moves found in 20 s: learned */
    A.ev(STEP);
    let r = play(10000, 90000, true, 10000);
    eq(JSON.stringify([r.game, r.ask, r.band]), JSON.stringify([true, true, 'Right | Now their best reply? | Review']), 'a game-mode review asks, beside its Review tag');
    eq(JSON.stringify([r.result, r.held, r.learned, r.moved, r.ms, r.s, r.gt, r.tb, r.hd, r.gu]), JSON.stringify(['first', null, true, 'learned', 20000, 20000, 90000, null, null, 'saw']),
      'the question\'s 90 s left out: found in 20 s, learned; the log keeps the question apart, ' + JSON.stringify(r));
    /* the guess skipped: held for the guess, not for the clock */
    A.ev(STEP);
    r = play(10000, 90000, false, 10000);
    eq(JSON.stringify([r.result, r.held, r.learned, r.box, r.streak, r.moved, r.ms, r.gt, r.tb, r.hd, r.gu, r.dt]), JSON.stringify(['first', 'guess', false, 3, 2, 'held', 20000, 90000, null, 'guess', 'skip', 'Found first try. One right guess of their best reply makes it learned.']),
      'skipped: held for want of a right guess, never as slow, ' + JSON.stringify(r));
    /* found in 70 s (the question's 30 s apart): F8.3's hold first, its time without the question */
    A.ev(STEP);
    r = play(40000, 30000, false, 30000);
    eq(JSON.stringify([r.result, r.held, r.learned, r.box, r.streak, r.moved, r.ms, r.gt, r.tb, r.hd, r.dt]), JSON.stringify(['first', 'slow', false, 3, 2, 'held', 70000, 30000, 1, 'slow', 'Found first try in 1:10. Under 60 s makes it learned.']),
      'slow and no right guess: F8.3\'s reason, its time without the question, ' + JSON.stringify(r));
    /* its step again: the next quick find, the guess skipped, holds for the guess */
    A.setNow(A.getNow() + 17 * DAYMS);
    r = play(5000, 45000, false, 5000);
    eq(JSON.stringify([r.held, r.learned, r.streak, r.moved, r.hd]), JSON.stringify(['guess', false, 2, 'held', 'guess']), 'then quick, the guess skipped: held for the guess, ' + JSON.stringify(r));
    /* and the next with a right guess: learned */
    A.setNow(A.getNow() + 17 * DAYMS);
    r = play(5000, 45000, true, 5000);
    eq(JSON.stringify([r.held, r.learned, r.pg, r.moved]), JSON.stringify([null, true, true, 'learned']), 'then a right guess: learned, ' + JSON.stringify(r));
    /* a first sight: found in 10 s, the question open a minute, keeps its week (box 2) */
    A.ev(`(srsRestore('${key}', null), 1)`);
    r = play(5000, 60000, true, 5000);
    eq(JSON.stringify([r.game, r.ask, r.result, r.box, r.ms, r.gt]), JSON.stringify([false, true, 'first', 2, 10000, 60000]), 'a first sight (cued) asks too; found in 10 s, its week, ' + JSON.stringify(r));
  });

  await test('F10.1 with F9.3, F9.4: practice packs and lessons never ask for their reply: at tier 3 a lesson\'s frames, its position and a pack of five are played with no question and no reply search; guessable() refuses a practice position or a lesson even handed a forcing line, where an own forcing card after its first move asks', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      playerTier = function () { return 3; }; window.readyEngine(); window.__evals = [];
      var out = { cards: [], asked: 0 };
      var play = function () {
        for (var i = 0; i < 20 && ui.session && !ui.session.finished; i++) {
          var a = ui.session.active;
          if (!a) { loadCard(); a = ui.session.active; if (!a) break; }
          out.cards.push((a.lesson ? 'lesson' : a.prac ? 'practice' : 'own') + (guessable(a) ? ' asks' : ''));
          if (a.phase === 'lesson') { lessonStep(1); continue; }
          gradeMove(uciToMove(a.st, a.bestUci));
          if (a.reply || a.guessOn || a.askAt) out.asked++;
          nextCard();
        }
      };
      startLesson('safety'); play();
      ui.session = null; startPack('fork'); play();
      out.searched = window.__evals.filter(function (j) { return j.opts && j.opts.rl; }).length;
      /* handed a line, still never */
      var line = ['a2a3', 'a7a6', 'b2b3'];
      var p = pracCardFor(pracItem('pk:' + PSKILL_OF.safety.tryId)), l = lessonCardFor(lessonItem('ls:safety'));
      out.handed = [guessable(Object.assign({}, p, { sol: line })), guessable(Object.assign({}, l, { sol: line }))];
      var own = allMistakes().filter(trainable).map(cardFor).filter(function (c) { return c && c.sol; })[0], st = cloneState(own.pre);
      applyMove(st, uciToMove(st, own.sol[0]));
      out.own = guessable(Object.assign({}, own, { st: st }));
      return JSON.stringify(out); })()`));
    eq(r.cards.join(','), 'lesson,lesson,lesson,practice,lesson,lesson,lesson,practice,practice,practice,practice,practice', 'the lessons\' frames and positions, then the pack: none asks');
    eq(r.asked, 0, 'no question on any');
    eq(r.searched, 0, 'no reply list searched');
    eq(JSON.stringify(r.handed), '[false,false]', 'a practice position or a lesson handed a line: no question');
    eq(r.own, true, 'an own forcing card after its first move: the question');
  });

  /* ── v2 slice 5, look and release ── */
  await test('V5.1: Hint 3 draws its red squares at once: card 1 at More help, Hint twice, a wrong queen move (the miss brings Hint 3), Try again: the nine red squares are on the board the moment the crossfade ends (150 ms), with the circled queen not picked up, and stay while the card asks; under reduced motion with the board at once; the safety lesson\'s step 2 draws its red squares', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const lose = () => A.ev('(window.__els.bwrap.innerHTML.match(/class="tint tint-lose"/g) || []).length');
    const boards = (t0) => JSON.parse(A.ev(`JSON.stringify(window.__writes.filter(function (w) { return w.id === 'bwrap' && w.what === 'innerHTML' && w.t >= ${t0}; }).map(function (w) { return w.t - ${t0}; }))`));
    for (const reduced of [false, true]) {
      const at = reduced ? 'reduced motion' : 'motion';
      A.ev(`(ui.reducedTest = ${reduced}, playerTier = function () { return 1; }, 1)`);
      A.ev(`(function () { var a = window.__show(model().byKey['184455333378:68']); ui.session.keys.push(allMistakes().filter(trainable)[1].key); window.readyEngine(); return 1; })()`);
      run(600);
      A.key('?'); run(600); A.key('?'); run(600);
      eq(A.ev('ui.session.active.hints'), 2, at + ': two hints given');
      eq(lose(), 0, at + ': no red square before Hint 3');
      A.ev(`(function () { var a = ui.session.active, m = legalMoves(a.st).filter(function (x) { return x.from === a.best.from && moveUci(x) !== a.bestUci; })[0]; a.tapped = true; gradeMove(m); return 1; })()`);
      await tick(); await tick();
      run(1500);
      eq(A.ev('ui.session.active.phase + " " + ui.session.active.tried.kind'), 'tried miss', at + ': the queen move is a miss');
      /* V2.3: the automatic hint is due at the miss and counts when it shows */
      eq(A.ev('ui.session.active.hints + " " + ui.session.active.autoDue + " " + hintMax(ui.session.active)'), '2 1 3', at + ': the miss brings Hint 3');
      const red = A.ev('hint3Of(ui.session.active).red.length');
      eq(red, 9, at + ': nine red squares for the queen');
      const t0 = A.getNow();
      A.click('tryAgain', null, 1);
      eq(A.ev('ui.session.active.hints'), 3, at + ': Hint 3 counted as it shows');
      run(reduced ? 20 : 140);
      if (!reduced) eq(lose(), 0, 'during the crossfade the board is the one before Hint 3\'s marks');
      run(reduced ? 20 : 20);
      const bs = boards(t0);
      eq(lose(), red, at + ': the red squares drawn with the board (writes at ' + bs.join(', ') + ' ms)');
      ok(reduced ? bs[0] === 0 : bs.indexOf(150) >= 0, at + ': ' + (reduced ? 'at once' : 'when the crossfade ends, 150 ms') + ': ' + bs.join(', '));
      eq(A.ev('ui.session.active.sel'), -1, at + ': the queen is not picked up');
      ok(A.ev('window.__els.bwrap.innerHTML.indexOf(\'fill="\' + HL_SEL + \'"\') < 0'), at + ': no selection drawn');
      /* the words' beat and a tap that is not a move redraw the marks: the red squares stay */
      run(800);
      A.ev('(sessionClick(ui.session.active.best.to === 36 ? 27 : 36), 1)'); run(800);
      eq(lose(), red, at + ': still there while the card asks');
    }
    A.ev('(ui.reducedTest = false, 1)');
    /* the safety lesson: its second frame, "Red squares are attacked too." */
    A.ev(`(window.__show(itemOf('ls:safety')), 1)`); run(800);
    A.ev('(lessonStep(1), 1)'); run(800);
    const want = A.ev('lessonFrame(ui.session.active, 1).reds.length');
    ok(want >= 3, 'the lesson frame names its red squares: ' + want);
    eq(A.ev('ui.session.active.lesson.i'), 1, 'on the lesson\'s second frame');
    eq(lose(), want, 'the lesson\'s red squares on its board');
    const bad = early(JSON.parse(A.ev('JSON.stringify(window.__writes)')));
    eq(bad.length, 0, bad.length + ' writes too early, first: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await test('V5.3: Esc closing a card\'s Details (opened from the strip or from the ••• menu) hands the keyboard to the honey button, so Enter presses Continue and never opens Details again', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev(BAR);
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    const focus = () => A.ev(`(function () { var e = document.activeElement; return e && e.getAttribute ? e.getAttribute('data-act') + '@' + e.getAttribute('data-slot') : 'none'; })()`);
    for (const from of ['strip', 'menu']) {
      A.ev(`(function () { playerTier = function () { return 2; }; var a = window.__show(model().byKey['184455333378:68']); ui.session.keys.push(allMistakes().filter(trainable)[1].key); window.readyEngine(); return 1; })()`);
      run(600);
      A.ev('(gradeMove(uciToMove(ui.session.active.st, ui.session.active.bestUci)), 1)');
      await tick(); await tick();
      run(4000);
      eq(A.ev('ui.session.active.phase'), 'done', from + ': found');
      const honey = A.ev('honeySlot()');
      ok(honey >= 0 && A.ev(`barSlots(ui.session.active, ui.session)[${honey}].label`) === 'Continue', from + ': Continue is the honey button');
      if (from === 'menu') { A.click('menu', null, null, { detail: 1 }); run(300); }
      /* a pointer's click focuses what it clicks: the opener (the strip's link, or the ••• button) has the
         keyboard when the sheet opens, and closing it by hand gives the keyboard back there */
      A.ev(`(function () { var act = '${from === 'menu' ? 'menu' : 'details'}';
        document.activeElement = { isConnected: true, tagName: 'A', getAttribute: function (n) { return n === 'data-act' ? act : null; }, closest: function () { return null; }, focus: function () { document.activeElement = this; } };
        return 1; })()`);
      A.click('details', null, null, { detail: 1 });
      eq(A.ev('ui.sheet'), 'details', from + ': Details open');
      run(500);
      A.key('Escape');
      eq(A.ev('ui.sheet'), null, from + ': Esc closes it');
      eq(focus(), 'next@' + honey, from + ': the keyboard on the honey button, not back on ' + (from === 'menu' ? 'the ••• button' : 'the Details link'));
      eq(A.ev('displayFor(ui.session.active).keys.split(" · ")[0]'), 'Enter: Continue', from + ': as the key line says');
      const [act, slot] = focus().split('@');
      A.key('Enter', false, { act, slot: +slot });
      run(600);
      eq(A.ev('ui.sheet'), null, from + ': Enter does not open Details again');
      eq(A.ev('ui.session.idx'), 1, from + ': Enter pressed Continue');
    }
  });
  /* ── checked facts and fair grading (v2 slice 1, V1.1 to V1.9): its tests in test/facts.js ── */
  for (const t of require('./facts')({ boot, eq, ok, tick, OPEN, TRY, AFTER })) await test(t[0], t[1]);
  /* v2 slice 2, words from the facts (V2.1 to V2.7): test/words.js */
  for (const t of require('./words')({ boot, eq, ok, tick, OPEN, TRY })) await test(t[0], t[1]);

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'card flow: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
