// The board's labels and the worked example (FINAL-SPEC 2.1 labels, copy L, S9, S18), run on the built page
// in Node (test/app-realm.js) with the fixture games: where a label goes (placeLabel, checked against the
// marks as boardSvg draws them, on flipped boards and a 316 px board), what it says (true to the drawn
// geometry), which one shows (first sight, priority, the word budget), what is remembered (nl:tip:<kind>,
// only for a label shown), LABELS_ON, and S9's first card of a family. node test/labels.test.js
const fs = require('fs'), path = require('path');
const makeApp = require('./app-realm');
const FIX = fs.readFileSync(path.join(__dirname, 'data', 'fixture-games.json'), 'utf8');
const T0 = Date.UTC(2026, 8, 28, 14, 0, 0);
const base = () => ({ 'nl:user': JSON.stringify('tester'), 'nl:src': JSON.stringify('chesscom'), 'nl:games:cc:tester': FIX });
const boot = (o) => makeApp(Object.assign({ now: T0, storage: base() }, o || {}));

let failed = 0, passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; results.push('FAIL ' + name + ': ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || 'value') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(c, what) { if (!c) throw new Error(what || 'condition failed'); }

/* one card as the active card of a one-card session */
const OPEN = `function openCard(it) {
  ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
  var a = cardFor(it);
  if (!a) return null;
  ui.session.active = a;
  return a;
}
var NO = function () { return false; }, YES = function () { return true; };`;
/* every kind of frame a card shows, each handed to cb(what, a) with the
   piece landed (labels never show on a slide): the card asking (a
   selection, hints 1 and 2, the worked example), a miss (its verdict, its
   reason, See it landed, after Try again), a forcing line (the telegraph,
   the reply landed, the next move asked), a solve (S0 as it settles), the
   story's steps, the answer shown and played */
const FRAMES = `function eachFrame(it, cb) {
  var a = openCard(it);
  if (!a) return;
  cb('open', a);
  a.sel = legalMoves(a.st)[0].from; cb('selected', a); a.sel = -1;
  a.hints = 1; cb('hint 1', a); a.hints = 2; cb('hint 2', a);
  a = openCard(it);
  if (workedExample(a)) cb('worked example', a);
  a = openCard(it); a.tapped = true;
  gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
  if (a.phase === 'tried') {
    cb('miss', a); a.reason = 1; cb('miss, its reason drawn', a); a.reason = 2; cb('miss, its reason said', a);
    if (a.tried.reply) { seeIt(); a.animMove = null; cb('See it, landed', a); }
    tryAgain(); a.triedHold = false; cb('after Try again', a);
  }
  if (a.sol) {
    a = openCard(it);
    for (var k = 0; k < a.sol.length - 1; k += 2) {
      gradeMove(uciToMove(a.st, a.sol[k]));
      var rp = a.reply;
      if (!rp) break;
      a.animMove = null; cb('forcing ' + k + ', right', a);
      rp.tele = true; cb('forcing ' + k + ', the telegraph', a);
      theirReply(a, false); a.animMove = null; a.animSlow = false; cb('forcing ' + k + ', landed', a);
      replyDone(a, rp); cb('forcing ' + k + ', your move', a);
    }
  }
  a = openCard(it);
  if (!a.sol) solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
  else { while (a.solIdx < a.sol.length) { var lm = uciToMove(a.st, a.sol[a.solIdx]); applyMove(a.st, lm); a.lastMove = [lm.from, lm.to]; a.solIdx++; } finishCard('first'); }
  a.animMove = null; cb('found', a); a.settle = 1; cb('S0 marks', a); a.settle = 2; cb('S0 settled', a);
  seeWhy();
  var S = buildStory(a);
  for (var i = 0; i < S.steps.length; i++) { a.view = { mode: 'story', i: i }; a.animMove = null; cb('story ' + i, a); }
  a = openCard(it); reveal(); a.animMove = null; cb('shown', a);
  if (!a.sol) { playIt(false); a.animMove = null; cb('shown, played', a); }
}`;

/* the card's board as a recording stub: #bwrap takes the board's markup
   with its labels inside, so a paint is read back as the page shows it */
const PAGE = `(function () {
  var els = window.__els = {};
  var mk = function (id) { return { id: id, innerHTML: '', textContent: '', style: {}, dataset: {}, className: '', focus: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    contains: function () { return false; }, appendChild: function () {}, querySelectorAll: function () { return []; }, querySelector: function () { return null; },
    classList: { toggle: function () {}, add: function () {}, remove: function () {}, contains: function () { return false; } } }; };
  ['trainbox', 'ctop', 'cband', 'bwrap', 'ebar', 'ebar-fill', 'ebar-lab', 'cpanel', 'cstrip', 'cbar', 'sr-live'].forEach(function (id) { els[id] = mk(id); });
  /* inside #bwrap: the marks svg and the labels' layer, as the page finds
     them; a board write fills the layer with what it wrote there */
  var lab = els.labels = mk('labels'), marks = mk('marks'), bh = '';
  Object.defineProperty(els.bwrap, 'innerHTML', { get: function () { return bh; }, set: function (x) {
    bh = x; var m = /<div class="blabels" aria-hidden="true">(.*?)<\\/div>/.exec(x); lab.innerHTML = m ? m[1] : ''; } });
  els.bwrap.querySelector = function (sel) { return sel === '.blabels' ? lab : sel === '.marks' ? marks : null; };
  var get0 = document.getElementById;
  document.getElementById = function (id) { return els[id] || get0(id); };
  window.__label = function () { var m = /<span class="blabel[^"]*"[^>]*>([^<]*)<\\/span>/.exec(lab.innerHTML); return m ? m[1] : ''; };
  window.__open = function (it, worked) {
    ui.session = { mode: 't', label: 't', keys: [it.key], idx: 0, results: {}, relearn: [], relearnOf: {} };
    var a = cardFor(it);
    ui.session.active = a;
    if (worked) workedExample(a);
    a.shownAt = Date.now();
    renderCard();
    return a;
  };
  return 1; })()`;
const tips = (A) => Object.keys(A.storage).filter((k) => /^nl:tip:/.test(k)).sort().join(',');

(async () => {
  await test('placeLabel never overlaps a piece, badge, token, ring, cross or arrow shaft, nor leaves the board: every fixture frame, tiers 1 and 3, boards of 316, 384 and 720 px, as drawn and flipped, first sight and short labels', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${FRAMES}
      var out = [], tried = 0, shown = 0, tips = 0, onPiece = 0, flipped = 0, texts = {};
      var num = '(-?[\\\\d.]+)';
      var all = function (re, s) { var m, o = []; re.lastIndex = 0; while ((m = re.exec(s))) o.push(m); return o; };
      var hit = function (r, x, y, w, h) { return r.x < x + w - 0.5 && x < r.x + r.w - 0.5 && r.y < y + h - 0.5 && y < r.y + r.h - 0.5; };
      var circ = function (r, cx, cy, rad) { var nx = Math.max(r.x, Math.min(cx, r.x + r.w)), ny = Math.max(r.y, Math.min(cy, r.y + r.h)); return Math.hypot(nx - cx, ny - cy) < rad - 0.5; };
      var dseg = function (r, x1, y1, x2, y2) {
        var pd = function (px, py, ax, ay, bx, by) { var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(ax + t * dx - px, ay + t * dy - py); };
        var best = Infinity;
        for (var i = 0; i <= 40; i++) { var px = x1 + (x2 - x1) * i / 40, py = y1 + (y2 - y1) * i / 40; var nx = Math.max(r.x, Math.min(px, r.x + r.w)), ny = Math.max(r.y, Math.min(py, r.y + r.h)); best = Math.min(best, Math.hypot(nx - px, ny - py)); }
        var c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
        c.forEach(function (p) { best = Math.min(best, pd(p[0], p[1], x1, y1, x2, y2)); });
        return best;
      };
      /* the label against the frame as boardSvg draws it, in board units */
      var check = function (what, a, f, px, lb) {
        var svg = boardSvg(f.st, f.opts), s = px / 360, R = { x: lb.x / s, y: lb.y / s, w: lb.w / s, h: lb.h / s }, sq = function (x, y) { return Math.floor(x / 45) + ',' + Math.floor(y / 45); };
        var bad = function (x) { out.push(what + ' at ' + px + (f.opts.flip ? ' flipped' : '') + ', "' + lb.text + '": ' + x); };
        if (lb.x < -0.01 || lb.y < -0.01 || lb.x + lb.w > px + 0.01 || lb.y + lb.h > px + 0.01) bad('off the board ' + JSON.stringify([lb.x, lb.y, lb.w, lb.h]));
        var ends = {};
        all(new RegExp('<line class="(bad-arrow|threat-arrow|reply-arrow|good-arrow|ghost-arrow)"[^>]* x1="' + num + '" y1="' + num + '" x2="' + num + '" y2="' + num + '"[^>]* stroke-width="' + num + '"', 'g'), svg).forEach(function (m) {
          var x1 = +m[2], y1 = +m[3], x2 = +m[4], y2 = +m[5], w = +m[6], l = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / l, uy = (y2 - y1) / l;
          ends[sq(x1, y1)] = ends[sq(x2 + ux * 20, y2 + uy * 20)] = 1;
          /* the shaft to the head's tip, its width plus 4 px each side */
          if (dseg(R, x1, y1, x2 + ux * 1.26 * w, y2 + uy * 1.26 * w) < w / 2 + 4 / s - 0.01) bad('on the ' + m[1] + ' shaft');
        });
        var n = 0;
        all(/<use (?:class="ghost-piece" )?href="#pc-\\w+" x="(-?[\\d.]+)" y="(-?[\\d.]+)" width="45"/g, svg).forEach(function (m) {
          if (!hit(R, +m[1], +m[2], 45, 45)) return;
          if (ends[sq(+m[1] + 1, +m[2] + 1)]) bad('on the piece at an arrow end');
          else n++;
        });
        if (n > (lb.tip ? 1 : 0)) bad('on ' + n + ' pieces');
        if (n) onPiece++;
        all(new RegExp('<circle class="(ring-threat|reply-ring|ring-target|hint-ring)" cx="' + num + '" cy="' + num + '" r="20"', 'g'), svg).forEach(function (m) { if (circ(R, +m[2], +m[3], 21.8)) bad('on the ' + m[1]); });
        all(/<rect class="nope-box" x="(-?[\\d.]+)" y="(-?[\\d.]+)"/g, svg).forEach(function (m) { if (hit(R, +m[1], +m[2], 41, 41)) bad('on the nope outline'); });
        all(/class="token[^"]*"><g[^>]*><circle cx="(-?[\\d.]+)" cy="(-?[\\d.]+)" r="12.5"/g, svg).forEach(function (m) { if (circ(R, +m[1], +m[2], 13.7)) bad('on a token'); });
        all(/<g class="badge [^"]*" transform="translate\\((-?[\\d.]+) (-?[\\d.]+)\\)"/g, svg).forEach(function (m) { if (circ(R, +m[1], +m[2], 9.8)) bad('on a badge'); });
        all(/<circle cx="(-?[\\d.]+)" cy="(-?[\\d.]+)" r="6" fill="#d04a3a"/g, svg).forEach(function (m) { if (circ(R, +m[1], +m[2], 6)) bad('on a cross'); });
      };
      [1, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          eachFrame(it, function (what, a) {
            [316, 384, 720].forEach(function (px) {
              [false, true].forEach(function (turn) {
                [NO, YES].forEach(function (seen) {
                  var f = boardOptsFor(a);
                  if (turn) { f.opts.flip = !f.opts.flip; flipped++; }
                  tried++;
                  var lb = frameLabel(a, f, px, px > 600, seen);
                  if (!lb) return;
                  shown++; if (lb.tip) tips++;
                  texts[lb.text.replace(/^(White|Black) /, '{Opp} ').replace(/^\\S+ in your game$/, '{gameSan} in your game').replace(/^free \\w+$/, 'free {piece}')] = 1;
                  check('tier ' + tier + ' ' + it.key + ' ' + what, a, f, px, lb);
                });
              });
            });
          });
        });
      });
      return JSON.stringify({ out: out, tried: tried, shown: shown, tips: tips, onPiece: onPiece, texts: Object.keys(texts).sort() }); })()`));
    eq(r.out.length, 0, r.out.length + ' overlaps, first: ' + r.out.slice(0, 4).join(' | '));
    ok(r.tried > 40000 && r.shown > 8000 && r.tips > 2000 && r.onPiece > 100, JSON.stringify({ tried: r.tried, shown: r.shown, tips: r.tips, onPiece: r.onPiece }));
    ['Your game move', '{Opp} can take', '{Opp} can check', 'Lost piece', '{gameSan} in your game', 'takes', 'free {piece}', 'check', 'mate', 'lost', 'their reply', 'better', 'the answer']
      .forEach((t) => ok(r.texts.indexOf(t) >= 0, 'no "' + t + '" label in any frame (' + r.texts.join(', ') + ')'));
  });

  await test('placeLabel, by itself: the head\'s neighbours nearest first, then the tail\'s; centred, then flush left, then flush right; no room, no label; a first-sight label may cover one piece no arrow starts or ends on', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var g = function (o) { return Object.assign({ size: 360, sq: 45, boxes: [], segs: [], pieces: [], head: [3, 3], tail: null, soft: 0 }, o); };
      var res = {};
      res.free = placeLabel(g({}), 40, 18);
      res.above = placeLabel(g({ boxes: [] }), 60, 18);
      /* above blocked: below */
      res.below = placeLabel(g({ boxes: [{ x: 0, y: 135, w: 360, h: 0.1 }, { x: 0, y: 90, w: 360, h: 45 }] }), 40, 18);
      /* all eight neighbours of the head blocked: the tail's */
      var ring = []; for (var x = 2; x <= 4; x++) for (var y = 2; y <= 4; y++) if (x !== 3 || y !== 3) ring.push({ x: x * 45, y: y * 45, w: 45, h: 45 });
      res.tail = placeLabel(g({ boxes: ring, tail: [6, 6] }), 40, 18);
      res.none = placeLabel(g({ boxes: ring }), 40, 18);
      /* the board's edge: a head in the corner keeps the pill inside */
      res.corner = placeLabel(g({ head: [0, 0] }), 80, 18);
      /* a shaft through the square above */
      res.shaft = placeLabel(g({ segs: [{ x1: 0, y1: 112, x2: 360, y2: 112, r: 4 }] }), 40, 18);
      /* a piece above: flush left or right when the centred pill would touch it */
      res.flush = placeLabel(g({ pieces: [{ x: 90, y: 90, w: 45, h: 45, end: false }, { x: 225, y: 90, w: 45, h: 45, end: false }] }), 70, 18);
      /* pieces all round: a short label finds no room; a first-sight one covers one */
      var pcs = []; for (var x2 = 2; x2 <= 4; x2++) for (var y2 = 2; y2 <= 4; y2++) if (x2 !== 3 || y2 !== 3) pcs.push({ x: x2 * 45, y: y2 * 45, w: 45, h: 45, end: false });
      res.hard = placeLabel(g({ pieces: pcs }), 40, 18);
      res.soft = placeLabel(g({ pieces: pcs, soft: 1 }), 40, 18);
      res.softEnd = placeLabel(g({ pieces: pcs.map(function (p) { return Object.assign({}, p, { end: true }); }), soft: 1 }), 40, 18);
      var two = placeLabel(g({ pieces: pcs, soft: 1 }), 80, 18);
      res.softTwo = two ? pcs.filter(function (p) { return two.x < p.x + p.w - 0.5 && p.x < two.x + 80 - 0.5 && two.y < p.y + p.h - 0.5 && p.y < two.y + 18 - 0.5; }).length : 0;
      /* a row of pieces wider than the pill can find a gap in: none */
      var wall = []; for (var c = 0; c < 8; c++) for (var rr = 1; rr <= 5; rr++) wall.push({ x: c * 45, y: rr * 45, w: 45, h: 45, end: c === 3 && rr === 3 });
      res.softWall = placeLabel(g({ pieces: wall, soft: 1 }), 80, 18);
      return JSON.stringify(res); })()`));
    eq(JSON.stringify(r.free), JSON.stringify({ x: 137.5, y: 103.5 }), 'centred on the square above the head');
    eq(JSON.stringify(r.below), JSON.stringify({ x: 137.5, y: 193.5 }), 'below when above is taken');
    eq(JSON.stringify(r.tail), JSON.stringify({ x: 272.5, y: 238.5 }), 'above the tail when the head is closed in');
    eq(r.none, null, 'no room, no label');
    ok(r.corner && r.corner.x >= 0 && r.corner.y >= 0 && r.corner.x + 80 <= 360, 'inside the board at the corner: ' + JSON.stringify(r.corner));
    ok(r.shaft && r.shaft.y > 130, 'off the shaft: ' + JSON.stringify(r.shaft));
    eq(JSON.stringify(r.flush), JSON.stringify({ x: 135, y: 103.5 }), 'flush with the square\'s left edge, clear of the piece on its left');
    eq(r.hard, null, 'pieces all round: a short label has no room');
    ok(r.soft, 'a first-sight label covers one piece');
    eq(r.softEnd, null, 'never a piece at an arrow end');
    ok(r.softTwo <= 1, 'never two pieces: ' + r.softTwo);
    eq(r.softWall, null, 'a pill that would cover two pieces wherever it goes: none');
  });

  await test('labelGeom keeps clear of every mark, on an empty square too: a ring, a nope outline, a badge, a token, a tried line\'s cross, guard dots, a legal dot, a ghost; and the answer\'s square before an answer', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      /* a bare board: two kings, the game arrow e2-e4 (white at the bottom) */
      var st = stateFromFen('7k/8/8/8/8/8/4P3/K7 w - - 0 1'), a = openCard(allMistakes().filter(trainable).filter(function (x) { return x.g.color === 'white'; })[0]);
      a.phase = 'done'; a.view = { mode: 'story', i: 0 };
      var base = { st: st, opts: { flip: false, arrows: [{ from: 12, to: 28, kind: 'reply', key: 'reply' }] } };
      var spot = function (f) { var lb = frameLabel(a, f, 360, false, YES); return lb ? Math.round(lb.x) + ',' + Math.round(lb.y) : null; };
      var free = spot(base), sqAt = function (xy) { var p = xy.split(','), x = +p[0] + 20, y = +p[1] + 9; return Math.floor(x / 45) + (7 - Math.floor(y / 45)) * 8; };
      var under = sqAt(free), res = { free: free };
      var with1 = function (k, v) { var f = { st: st, opts: JSON.parse(JSON.stringify(base.opts)) }; f.opts[k] = v; return spot(f); };
      res.ring = with1('rings', [{ sq: under, kind: 'target' }]);
      res.nope = with1('rings', [{ sq: under, kind: 'nope' }]);
      res.badge = with1('badges', [{ sq: under, kind: 'good', at: [22, 22] }]);
      res.token = with1('tokens', [{ sq: under, p: 'n', kind: 'won' }]);
      res.tried = with1('tried', [{ sq: under }]);
      res.guard = with1('guards', [{ from: under - 1, to: under + 1 }]);
      res.dots = with1('dots', [under]);
      res.ghost = with1('ghosts', [{ sq: under, p: 'N' }]);
      /* before an answer: never over the square the answer goes to */
      var pre = Object.create(a); pre.phase = 'guess'; pre.sol = null; pre.best = { from: 0, to: under };
      res.answer = (function () { var lb = frameLabel(pre, base, 360, false, YES); return lb ? Math.round(lb.x) + ',' + Math.round(lb.y) : null; })();
      /* and the green arrow is named only once answered */
      var g = { st: st, opts: { flip: false, arrows: [{ from: 12, to: 28, kind: 'better', key: 'answer' }] } };
      res.greenPre = labelCands(pre, g, YES).map(function (c) { return c.text; }).join(',');
      res.greenDone = labelCands(a, g, YES).map(function (c) { return c.text; }).join(',');
      return JSON.stringify(res); })()`));
    ok(r.free, 'a place on the bare board');
    ['ring', 'nope', 'badge', 'token', 'tried', 'guard', 'dots', 'ghost', 'answer'].forEach((k) => ok(r[k] !== r.free, k + ' at the label\'s place, and the label stays there (' + r.free + ')'));
    eq(r.greenPre, '', 'no "better" or "the answer" before an answer');
    eq(r.greenDone, 'the answer', 'the answer shown');
  });

  await test('a label lands with its mark\'s beat and stays through its state: S4\'s with the ring and arrow at V+600, never first with the words at V+750; the same label before and after the reason is said, and before and after R4', () => {
    const A = boot();
    A.ev(PAGE);
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${FRAMES}
      var res = { pairs: 0, diff: [] };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          [NO, YES].forEach(function (seen) {
            var a = openCard(it); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null;
            if (a.phase === 'tried') {
              a.reason = 1; var l1 = frameLabel(a, boardOptsFor(a), 384, false, seen);
              a.reason = 2; var l2 = frameLabel(a, boardOptsFor(a), 384, false, seen);
              res.pairs++; if ((l1 && l1.text) !== (l2 && l2.text)) res.diff.push(it.key + ' S4: ' + (l1 && l1.text) + ' -> ' + (l2 && l2.text));
            }
            a = openCard(it);
            if (a.sol) return;
            solved(uciToMove(a.st, a.bestUci), a.bestUci, null); a.animMove = null;
            a.settle = 1; var s1 = frameLabel(a, boardOptsFor(a), 384, false, seen);
            a.settle = 2; var s2 = frameLabel(a, boardOptsFor(a), 384, false, seen);
            res.pairs++; if ((s1 && s1.text) !== (s2 && s2.text)) res.diff.push(it.key + ' S0: ' + (s1 && s1.text) + ' -> ' + (s2 && s2.text));
          });
        });
      });
      return JSON.stringify(res); })()`));
    ok(r.pairs > 400, 'pairs ' + r.pairs);
    eq(r.diff.length, 0, r.diff.length + ' labels that change within their state, first: ' + r.diff.slice(0, 3).join(' | '));
    /* painted, on the clock: the miss's label is on the board from the marks beat */
    A.storage['nl:tip:game'] = A.storage['nl:tip:threat'] = A.storage['nl:tip:token'] = A.storage['nl:tip:ghost'] = '1';
    const keys = JSON.parse(A.ev(`${OPEN} JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); if (!a || a.sol) return false; a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); a.animMove = null; if (a.phase !== 'tried') return false; a.reason = 2; return !!frameLabel(a, boardOptsFor(a), 360, false, YES); }).map(function (it) { return it.key; }).slice(0, 4))`));
    ok(keys.length >= 2, 'misses with a label ' + keys.length);
    keys.forEach((k) => {
      A.ev(`(function () { var a = window.__open(model().byKey['${k}']); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`);
      let atMarks = null, atWords = null;
      for (let t = 0; t < 3000; t += 10) {
        A.advance(10);
        const st = JSON.parse(A.ev('JSON.stringify({ reason: ui.session.active.reason || 0, label: window.__label() })'));
        if (st.reason === 1 && atMarks == null) atMarks = st.label;
        if (st.reason === 2 && atWords == null) atWords = st.label;
      }
      ok(atMarks && atMarks === atWords, k + ': the label with the marks "' + atMarks + '", with the words "' + atWords + '"');
    });
  });

  await test('L words true to the drawn geometry: "free {piece}" only with that piece there and nothing guarding it, "takes" on a capture, "check" and "mate" as the move does, "fork" and "pinned" only at tier 3 with mFork and mPin, "lost" on See it\'s token, "their reply", "better", "the answer" on their own arrows', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${FRAMES}
      var out = [], n = 0, by = {};
      var arrowOf = function (f, mk) {
        var o = f.opts, list = (o.arrows || []).slice();
        if (o.bad) list.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
        if (o.good) list.push({ from: o.good[0], to: o.good[1], kind: 'better', key: 'good' });
        if (o.ghost) list.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
        return list.filter(function (x) { return x.from === mk.from && x.to === mk.to && x.kind === mk.kind; })[0] || null;
      };
      [1, 2, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          eachFrame(it, function (what, a) {
            [NO, YES].forEach(function (seen) {
              var f = boardOptsFor(a), lb = frameLabel(a, f, 384, false, seen);
              if (!lb) return;
              n++;
              var t = lb.text, mk = lb.mark, at = 'tier ' + tier + ' ' + it.key + ' ' + what + ', "' + t + '"', bad = function (x) { out.push(at + ': ' + x); };
              by[t.replace(/^(White|Black) /, '').replace(/^free \\w+/, 'free').replace(/^\\S+ in your game/, 'ghost')] = 1;
              var opp = myPov(a.it) ? 'Black' : 'White';
              if (/^(takes|free |check|mate|draw|hits two|fork|stuck|pinned)|can (take|check)$/.test(t) && mk.kind !== 'prize') {
                var ar = arrowOf(f, mk);
                if (!ar || ar.kind !== 'threat') return bad('not on a threat arrow drawn');
                /* the position the move is made from: as drawn, or for hint
                   1's danger and S0's pair the one after the game move */
                var s0 = a.phase === 'done' && a.view.mode === 's0', pos = ar.key === 'hint' || s0 ? a.cls.gameLine.nodes[1].before : f.st;
                var m = legalMoves(pos).filter(function (x) { return x.from === ar.from && x.to === ar.to; })[0];
                if (!m) return bad('no such move');
                var aft = cloneState(pos); applyMove(aft, m);
                var tsq = m.ep >= 0 ? m.ep : m.to, took = pos.b[tsq], chk = checkersOf(aft).length > 0, mate = chk && !legalMoves(aft).length;
                if (/can take$/.test(t) && (!took || t !== opp + ' can take')) bad('takes nothing, or not theirs');
                if (/can check$/.test(t) && (took || !chk || t !== opp + ' can check')) bad('no plain check');
                if (t === 'mate' && !mate) bad('no mate');
                if (t === 'check' && (!chk || mate || took)) bad('not a plain check');
                if (t === 'takes' && !took) bad('takes nothing');
                if (t === 'takes' && ar.key !== 'hint' && !isDefended(pos.b, tsq)) bad('"takes" on a piece nothing guards (free)');
                if (/^free /.test(t)) {
                  if (!took || t !== 'free ' + PIECE_WORD[pType(took)] || isDefended(pos.b, tsq)) bad('not that piece, or guarded');
                  /* and that piece is on the board as drawn, or as the ghost there */
                  var gh = (f.opts.ghosts || []).some(function (g) { return g.sq === tsq && g.p === took && !f.st.b[tsq]; });
                  if (f.st.b[tsq] !== took && !gh) bad('the piece is not drawn there');
                }
                if (/^(fork|pinned)$/.test(t) && tier !== 3) bad('a pattern name below tier 3');
                if (/^(hits two|stuck)$/.test(t) && tier === 3) bad('tier 3 says the name');
                if (/^(hits two|fork)$/.test(t) && !mFork({ nodes: [{}, { after: aft, move: m, piece: pType(pos.b[m.from]) }, {}, { piece: 'K' }], povWhite: !!pos.w })) bad('no fork');
                if (/^(stuck|pinned)$/.test(t) && !mPin({ nodes: [{}, { after: aft }], povWhite: !!pos.w })) bad('no pin');
              }
              else if (t === 'Your game move') { if (!arrowOf(f, mk) || mk.kind !== 'game' || mk.from !== a.played.from || mk.to !== a.played.to) bad('not on the game arrow'); }
              else if (t === 'Lost piece' || t === 'lost') {
                var tk = (f.opts.tokens || []).filter(function (x) { return x.sq === mk.sq && x.kind === 'lost'; })[0];
                if (!tk || colorW(tk.p) !== myPov(a.it)) bad('no lost token of yours there');
                if (t === 'lost' && !(a.phase === 'tried' && a.tried.seen)) bad('"lost" off See it');
              }
              else if (/ in your game$/.test(t)) {
                if (t !== sanOf(a.pre, a.played) + ' in your game' || !(f.opts.ghosts || []).some(function (g) { return g.sq === mk.sq && g.sq === a.played.to; })) bad('not the game move\\'s ghost');
              }
              else if (t === 'their reply') { var rr = arrowOf(f, mk); if (!rr || rr.kind !== 'reply') bad('no reply arrow'); }
              else if (t === 'better') { var br = arrowOf(f, mk); if (!br || br.kind !== 'better' || br.key !== 'better' || a.phase !== 'done' || a.view.mode !== 'story') bad('not the story\\'s green arrow'); }
              else if (t === 'the answer') { var an = arrowOf(f, mk); if (!an || an.kind !== 'better' || an.key !== 'answer' || a.phase !== 'done' || a.view.mode !== 'show') bad('not the answer shown'); }
              else if (/^free /.test(t)) {
                var p = f.st.b[mk.sq];
                if (!(f.opts.rings || []).some(function (x) { return x.sq === mk.sq && x.kind === 'target'; }) || !p || colorW(p) === myPov(a.it) || t !== 'free ' + PIECE_WORD[pType(p)] || isDefended(f.st.b, mk.sq)) bad('not an unguarded prize ringed there');
              }
              else bad('a label the copy table does not have');
              if (wordsIn(t) > 2 && !lb.tip) bad('a short label over two words');
            });
          });
        });
      });
      /* doctored, for what the fixture frames may not reach: a fork and a pin
         by a threat arrow, and Stockfish's pick while exploring */
      var dd = function (fen, uci, tier) {
        var st = stateFromFen(fen), m = uciToMove(st, uci), a = { tier: tier, it: { g: { color: st.w ? 'black' : 'white' } }, phase: 'tried', cls: null };
        return threatSay(a, { st: st, opts: {} }, { from: m.from, to: m.to, kind: 'threat', key: 'threat' });
      };
      var nf = [1, 3].map(function (t) { var w = dd('4k3/8/2q1r3/8/8/1N6/8/K7 w - - 0 1', 'b3d4', t); return w && w.say; });
      var ex = (function () { var st = stateFromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), res = {};
        [1, 2].forEach(function (t) { var a = { tier: t, it: { g: { color: 'white' } }, phase: 'done', explore: {}, cls: null }; var c = labelCands(a, { st: st, opts: { ghost: [0, 56] } }, YES); res[t] = c.length ? c[0].text : null; });
        return res; })();
      return JSON.stringify({ out: out, n: n, by: Object.keys(by).sort(), nf: nf, ex: ex }); })()`));
    eq(r.out.length, 0, r.out.length + ' labels untrue to the board, first: ' + r.out.slice(0, 4).join(' | '));
    ok(r.n > 3000, 'labels read ' + r.n);
    ['Your game move', 'can take', 'takes', 'free', 'check', 'mate', 'lost', 'Lost piece', 'ghost', 'their reply', 'better', 'the answer'].forEach((t) => ok(r.by.indexOf(t) >= 0, 'no "' + t + '" (' + r.by.join(', ') + ')'));
    eq(JSON.stringify(r.nf), JSON.stringify(['hits two', 'fork']), 'a knight forking queen and rook: "hits two" below tier 3, "fork" at 3');
    ok(r.ex[1] === 'the computer' && r.ex[2] === 'Stockfish', 'Stockfish\'s pick: ' + JSON.stringify(r.ex));
  });

  await test('first sight: the first card ever shows "Your game move" alone (the worked example\'s threat waits); the game arrow outranks a threat, a threat a lost piece, a lost piece the ghost, and any first-sight label a short one', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 1; };
      var res = { first: [], none: 0 };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a || !workedExample(a)) return;
        var f = boardOptsFor(a), lb = frameLabel(a, f, 384, false, NO), thr = (f.opts.arrows || []).some(function (x) { return x.kind === 'threat'; });
        res.first.push((lb ? lb.text : '-') + (thr ? '+threat' : ''));
        /* the threat alone would teach itself here if the game arrow did not come first */
        var only = frameLabel(a, f, 384, false, function (k) { return k === 'game'; });
        if (thr && only && /can (take|check)$/.test(only.text)) res.threatWaits = (res.threatWaits || 0) + 1;
      });
      /* order among first-sight kinds, on one doctored frame holding them all */
      var it = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && a.cls.gameLine.nodes[1] && threatOf(a.cls.gameLine, 1) && threatOf(a.cls.gameLine, 1).captured; })[0];
      var a = openCard(it), th = threatOf(a.cls.gameLine, 1);
      a.phase = 'done'; a.view = { mode: 'story', i: 0 };
      var st = a.cls.gameLine.nodes[1].before, mine = []; for (var q = 0; q < 64; q++) if (st.b[q] && colorW(st.b[q]) === myPov(a.it)) mine.push(q);
      var fr = { st: st, opts: { flip: false, bad: [a.played.from, a.played.to], arrows: [{ from: th.from, to: th.to, kind: 'threat', key: 'threat' }], tokens: [{ sq: mine[0], p: st.b[mine[0]], kind: 'lost' }], ghosts: [{ sq: a.played.to, p: a.pre.b[a.played.from] }] } };
      res.order = [labelCands(a, fr, NO).map(function (c) { return c.tip || c.text; }).join(','), labelCands(a, fr, function (k) { return k === 'game'; }).map(function (c) { return c.tip || c.text; })[0],
        labelCands(a, fr, function (k) { return k !== 'token' && k !== 'ghost'; }).map(function (c) { return c.tip || c.text; })[0],
        labelCands(a, fr, function (k) { return k !== 'ghost'; }).map(function (c) { return c.tip || c.text; })[0],
        labelCands(a, fr, YES).map(function (c) { return c.tip || c.text; })[0]];
      return JSON.stringify(res); })()`));
    ok(r.first.length >= 5, 'worked examples at tier 1: ' + r.first.length);
    r.first.forEach((x) => ok(/^Your game move/.test(x), 'a first card ever shows ' + x));
    ok(r.threatWaits >= 2, 'cards where the threat would have taught itself: ' + r.threatWaits);
    ok(/^game,threat,token,ghost,/.test(r.order[0]), 'first-sight order: ' + r.order[0]);
    eq(r.order[1], 'threat', 'with the game arrow seen'); eq(r.order[2], 'token', 'with the threat seen'); eq(r.order[3], 'ghost', 'with the token seen');
    ok(r.order[4] && !/^(game|threat|token|ghost)$/.test(r.order[4]), 'all seen: a short label, ' + r.order[4]);
  });


  await test('an unshown label is not marked seen: one that lost on priority, on the word budget or for room, or with LABELS_ON off; the one shown is, once on screen, and stays in its state; with no storage, once a page load', () => {
    const A = boot();
    A.ev(OPEN); A.ev(PAGE);
    A.ev('(playerTier = function () { return 1; }, 1)');
    const key = JSON.parse(A.ev(`${OPEN} JSON.stringify(allMistakes().filter(trainable).filter(function (it) { var a = openCard(it); return a && workedExample(a) && (boardOptsFor(a).opts.arrows || []).some(function (x) { return x.kind === 'threat'; }); }).map(function (it) { return it.key; }))`))[0];
    ok(key, 'a worked example with a drawn threat');
    /* priority: the game arrow's label, the threat's not taken */
    A.ev(`(window.__open(model().byKey['${key}'], true), 1)`); A.advance(1000);
    eq(A.ev('window.__label()'), 'Your game move', 'the first card ever');
    eq(tips(A), 'nl:tip:game', 'only the game arrow is seen');
    /* a selection repaints the board in the same state: the same label */
    A.ev('(ui.session.active.sel = legalMoves(ui.session.active.st)[0].from, renderCardBoard(), 1)'); A.advance(500);
    eq(A.ev('window.__label()'), 'Your game move', 'kept in its state');
    /* the next state: the game arrow taught, so no label of its own; the
       threat's first-sight label now, only where the words leave it room */
    A.ev('(ui.session.active.sel = -1, ui.session.active.hints = 2, renderCard(), 1)'); A.advance(1000);
    eq(A.ev('window.__label()'), '', 'hint 2: the ring has no label, the game arrow is seen');
    eq(tips(A), 'nl:tip:game', 'still only the game arrow');
    /* over budget: a frame whose teaching words do not fit beside the band */
    const over = JSON.parse(A.ev(`${OPEN} (function () { var res = null;
      allMistakes().filter(trainable).some(function (it) {
        var a = openCard(it); if (!a) return false;
        a.hints = 1; var f = boardOptsFor(a);
        var c = labelCands(a, f, function (k) { return k !== 'threat'; })[0];
        if (!c || c.tip !== 'threat' || wordsIn(c.text) <= labelRoom(a)) return false;
        res = it.key; return true; });
      return JSON.stringify(res); })()`));
    ok(over, 'a hint whose threat teaching words are over the budget');
    A.storage['nl:tip:game'] = '1';
    A.ev(`(function () { var a = window.__open(model().byKey['${over}']); a.hints = 1; renderCard(); return 1; })()`); A.advance(1000);
    ok(A.ev('window.__label()') !== A.ev('(function (a) { return labelCands(a, boardOptsFor(a), function (k) { return k !== \'threat\'; })[0].text; })(ui.session.active)'), 'the teaching words are not shown');
    ok(!A.storage['nl:tip:threat'], 'over the budget: the threat is not seen');
    /* no room: nothing placed, nothing seen */
    A.ev('(window.__pl = placeLabel, placeLabel = function () { return null; }, 1)');
    A.ev(`(function () { var a = window.__open(model().byKey['${key}']); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`); A.advance(3000);
    eq(A.ev('window.__label()'), '', 'no room, no label');
    ok(!A.storage['nl:tip:threat'] && !A.storage['nl:tip:token'], 'no room: nothing seen');
    A.ev('(placeLabel = window.__pl, 1)');
    /* LABELS_ON off: nothing at all */
    A.ev('(LABELS_ON = false, 1)');
    A.ev(`(function () { var a = window.__open(model().byKey['${key}']); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`); A.advance(3000);
    A.ev('(seeIt(), 1)'); A.advance(2000);
    eq(A.ev('window.__label()'), '', 'LABELS_ON off');
    eq(tips(A), 'nl:tip:game', 'LABELS_ON off: nothing more seen');
    A.ev('(LABELS_ON = true, 1)');
    /* shown: the threat's words once the miss's reason is drawn, seen then */
    A.ev(`(function () { var a = window.__open(model().byKey['${key}']); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); return 1; })()`); A.advance(3000);
    const shownNow = A.ev('window.__label()');
    eq(!!A.storage['nl:tip:threat'], /can (take|check)$/.test(shownNow), 'the threat is seen exactly when its words showed: ' + shownNow);
    /* no storage at all: in memory, once a page load */
    const B = boot();
    B.ev(OPEN); B.ev(PAGE);
    B.ev('(localStorage.getItem = function () { throw new Error("off"); }, localStorage.setItem = function () { throw new Error("off"); }, playerTier = function () { return 2; }, 1)');
    B.ev(`(window.__open(model().byKey['${key}']), 1)`); B.advance(1000);
    eq(B.ev('window.__label()'), 'Your game move', 'no storage: the first card teaches');
    B.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { return x.key !== '${key}'; })[0]; window.__open(it); return 1; })()`); B.advance(1000);
    eq(B.ev('window.__label()'), '', 'no storage: the next card does not teach it again');
  });

  await test('the worked example (S9): a tier-1 player\'s first card of a family opens with hint 1 drawn, the task in the band and plain Hint in the bar; Hint gives hint 2; a solve records hint, notes a first look and counts the family; never at tiers 2 and 3, on a relearn card, or with storage unreadable', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 1; };
      var res = { open: [], worked: 0, empty: 0, fams: {} };
      allMistakes().filter(trainable).forEach(function (it) {
        var a = openCard(it);
        if (!a) return;
        if (!workedExample(a)) { a.hints = 1; if (!hintMarks(a).rings.length && !hintMarks(a).arrows.length) res.empty++; return; }
        res.worked++;
        var f = boardOptsFor(a), hm = hintMarks(a), d = displayFor(a);
        var drawn = hm.rings.concat(hm.arrows).every(function (m) { return (f.opts.rings || []).concat(f.opts.arrows || []).some(function (x) { return x.kind === m.kind && (x.sq === m.sq || (x.from === m.from && x.to === m.to)); }); });
        res.open.push([a.hints, a.predraw, drawn, d.row1, d.row2 === 'Find a better move than ' + sanOf(a.pre, a.played) + '.', d.buttons.map(function (b) { return b.label; }).join(' | ')].join(' / '));
      });
      /* one card through: Hint, then the solve */
      var it = allMistakes().filter(trainable).filter(function (x) { var a = openCard(x); return a && !a.sol && workedExample(a); })[0], fam = familyOf(patternOf(it.b)).key;
      var a = openCard(it); workedExample(a);
      giveHint();
      res.hint2 = [a.hints, displayFor(a).row1, hintMarks(a).rings.map(function (x) { return x.kind; }).join(',')].join(' / ');
      solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      res.result = ui.session.results[it.key]; res.note = (ui.session.notes || {})[it.key]; res.count = localStorage.getItem('nl:seen:' + fam);
      /* the family is seen: its next card is a card like any other */
      var next = allMistakes().filter(trainable).filter(function (x) { return x.key !== it.key && familyOf(patternOf(x.b)).key === fam; })[0];
      res.next = next ? workedExample(openCard(next)) : null;
      /* a miss before the solve: retry, still a first look; a reveal: Shown */
      var it2 = allMistakes().filter(trainable).filter(function (x) { var b = openCard(x); return b && !b.sol && familyOf(patternOf(x.b)).key !== fam && workedExample(b); })[0], fam2 = familyOf(patternOf(it2.b)).key;
      a = openCard(it2); workedExample(a); reveal();
      res.shown = [ui.session.results[it2.key], ui.session.notes[it2.key], localStorage.getItem('nl:seen:' + fam2)].join(' / ');
      /* a miss, then Try again: the hint's marks stay and the band names them */
      localStorage.removeItem('nl:seen:' + fam2);
      a = openCard(it2); workedExample(a); a.tapped = true; gradeMove(uciToMove(a.st, a.playedUci)); tryAgain(); a.triedHold = false;
      res.afterMiss = [a.hints, displayFor(a).row1, displayFor(a).buttons[0].label].join(' / ');
      solved(uciToMove(a.st, a.bestUci), a.bestUci, null);
      res.afterMissResult = ui.session.results[it2.key] + ' / ' + ui.session.notes[it2.key];
      /* never at tiers 2 and 3, never on a relearn card */
      localStorage.removeItem('nl:seen:' + fam2);
      res.tiers = [2, 3].map(function (t) { playerTier = function () { return t; }; return workedExample(openCard(it2)); });
      playerTier = function () { return 1; };
      var r2 = openCard(it2); ui.session.keys = [it2.key, it2.key]; ui.session.relearnOf = {}; ui.session.relearnOf[it2.key] = 1; ui.session.idx = 1;
      res.relearn = workedExample(r2);
      /* storage that cannot be read counts as seen */
      var gi = localStorage.getItem; localStorage.getItem = function () { throw new Error('off'); };
      res.unreadable = workedExample(openCard(it2));
      localStorage.getItem = gi;
      res.again = workedExample(openCard(it2));
      return JSON.stringify(res); })()`));
    ok(r.worked >= 5, 'worked examples ' + r.worked);
    r.open.forEach((x) => eq(x.replace(/ \/ (Your turn) \/ true \/ /, ' / T1T2 / '), '1 / true / true / T1T2 / Hint | Show the answer', 'the worked example opens'));
    eq(r.hint2, '2 / Hint 2 of 2 / hint', 'Hint gives hint 2');
    eq(r.result, 'hint', 'a solve records hint');
    eq(r.note, 'firstlook', 'the summary\'s note');
    eq(r.count, '1', 'the family counted');
    eq(r.next, false, 'the family\'s next card');
    eq(r.shown, 'fail / shown / 1', 'a worked example revealed: Shown, and counted');
    eq(r.afterMiss, '1 / Hint 1 of 2 / Hint', 'after a miss the band names the drawn hint');
    eq(r.afterMissResult, 'retry / firstlook', 'a solve after a miss');
    eq(JSON.stringify(r.tiers), '[false,false]', 'tiers 2 and 3');
    eq(r.relearn, false, 'a relearn card');
    eq(r.unreadable, false, 'unreadable storage counts as seen');
    eq(r.again, true, 'readable again: the family is still new');
  });

  await test('the worked example comes through the real session start (loadCard) on a fresh profile at tier 1, and is kept across a reload of the session', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 1; };
      SF.state = 'failed';
      var it = allMistakes().filter(trainable).filter(function (x) { var a = openCard(x); return a && workedExample(a); })[0];
      ui.session = null;
      startSession('drill', [it.key], 'x');
      var a = ui.session.active;
      var res = { first: a && [a.key === it.key, a.hints, !!a.predraw].join(' / '), kept: JSON.stringify(ui.session.progress && ui.session.progress[it.key]) };
      var b = cardFor(it);
      res.reload = [b.hints, !!b.predraw, workedExample(b)].join(' / ');
      return JSON.stringify(res); })()`));
    eq(r.first, 'true / 1 / true', 'the card opens as the worked example');
    ok(/"h":1/.test(r.kept) && /"p":1/.test(r.kept), 'kept: ' + r.kept);
    eq(r.reload, '1 / true / false', 'reloaded: the same hint, still the worked example, not made twice');
  });

  await test('LABELS_ON false: no label on any frame, first sight included, and none painted or remembered', () => {
    const A = boot();
    A.ev(OPEN); A.ev(PAGE);
    const r = JSON.parse(A.ev(`${OPEN} (function () { ${FRAMES}
      LABELS_ON = false;
      var n = 0, shown = 0;
      [1, 3].forEach(function (tier) {
        playerTier = function () { return tier; };
        allMistakes().filter(trainable).forEach(function (it) {
          eachFrame(it, function (what, a) { [NO, YES].forEach(function (seen) { n++; if (frameLabel(a, boardOptsFor(a), 384, false, seen)) shown++; }); });
        });
      });
      LABELS_ON = true;
      var on = 0;
      allMistakes().filter(trainable).slice(0, 10).forEach(function (it) { eachFrame(it, function (what, a) { if (frameLabel(a, boardOptsFor(a), 384, false, NO)) on++; }); });
      return JSON.stringify({ n: n, shown: shown, on: on }); })()`));
    ok(r.n > 5000, 'frames ' + r.n);
    eq(r.shown, 0, 'labels with LABELS_ON false');
    ok(r.on > 20, 'and with it on: ' + r.on);
    A.ev('(LABELS_ON = false, playerTier = function () { return 1; }, 1)');
    A.ev('(function () { var it = allMistakes().filter(trainable)[0]; window.__open(it, true); return 1; })()'); A.advance(1000);
    eq(A.ev('window.__label()'), '', 'painted: none');
    ok(/<div class="blabels" aria-hidden="true"><\/div>/.test(A.ev('window.__els.bwrap.innerHTML')), 'the empty layer is still there');
    eq(tips(A), '', 'nothing remembered');
  });

  await test('a label is aria-hidden and in its mark\'s colour, sized from the width table (12 px on a phone, 14 on the desktop), on a frame that slides never', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${OPEN}
      playerTier = function () { return 2; };
      var it = allMistakes().filter(trainable).filter(function (x) { var b = openCard(x); return b && frameLabel(b, boardOptsFor(b), 384, false, NO) && frameLabel(b, boardOptsFor(b), 720, true, NO); })[0], a = openCard(it), f = boardOptsFor(a);
      var ph = frameLabel(a, f, 384, false, NO), dk = frameLabel(a, f, 720, true, NO);
      var html = labelHtml(ph, true);
      a.animMove = [a.played.from, a.played.to]; var sl = boardOptsFor(a); sl.opts.anim = [a.played.from, a.played.to];
      return JSON.stringify({ ph: ph && [ph.w, ph.h, ph.role], dk: dk && [dk.w, dk.h], html: html, slide: frameLabel(a, sl, 384, false, NO), box: [labelBox('takes', false), labelBox('takes', true)] }); })()`));
    eq(JSON.stringify(r.ph), JSON.stringify([Math.ceil(14 * 6.6 + 16), 18, 'red']), 'phone pill');
    eq(JSON.stringify(r.dk), JSON.stringify([Math.ceil(14 * 7.7 + 16), 20]), 'desktop pill');
    ok(/^<span class="blabel bl-red fx-in" style="left:\d+px;top:\d+px;width:\d+px;height:18px">Your game move<\/span>$/.test(r.html), r.html);
    eq(r.slide, null, 'a sliding frame has no label');
    eq(JSON.stringify(r.box), JSON.stringify([{ w: 49, h: 18 }, { w: 55, h: 20 }]), 'the width table');
  });

  results.forEach((l) => console.log(l));
  console.log((failed ? 'FAIL ' : 'ok   ') + 'labels: ' + passed + ' passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
