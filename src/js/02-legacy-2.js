

/* ── 8b2. The reply book ─────────────────────────────────────────────────
   From the same open database: for ~2,700 opening positions, the moves
   players in each rating band actually answer with, count and White-score.
   This is what lets the openings trainer play the opponent you will really
   face, offline, with no request to anyone. Prefix-keyed in the blob;
   converted to FEN-keyed maps (merging transpositions) lazily below.       */

/* chess.com and Lichess ratings live on different scales. Published
   equivalences put club-level Lichess numbers a few hundred above
   chess.com's, widest in blitz. All peer/book comparisons band on the
   Lichess-equivalent rating; the site's own rating still displays raw. */
var CC_OFFSET = { bullet: 250, blitz: 300, rapid: 150 };
function bandEquivRating(perf, rating) {
  if (rating == null) return null;
  return isCC() ? rating + (CC_OFFSET[perf] != null ? CC_OFFSET[perf] : 200) : rating;
}

   

/* A format has to be a real part of how you play before this page is allowed
   to say anything about it. Three bullet games in a thousand is not a habit,
   it is noise, and noise dressed as a finding is worse than no finding. */
var MIN_FORMAT_GAMES = 40;
var MIN_FORMAT_SHARE = 0.08;

var censusCache = null;
function censusToken() {
  return data.games.length + '|' + (data.games[0] ? data.games[0].id : '') + '|' + cfg.tcs.join(',');
}
function census() {
  var token = censusToken();
  if (censusCache && censusCache.token === token) return censusCache;
  var c = {}, total = 0;
  data.games.forEach(function (g) { c[g.perf] = (c[g.perf] || 0) + 1; total++; });
  c._total = total;
  var eligible = trackedPerfs().filter(function (p) {
    return (c[p] || 0) >= MIN_FORMAT_GAMES && (c[p] || 0) / Math.max(1, total) >= MIN_FORMAT_SHARE;
  });
  var set = {};
  eligible.forEach(function (p) { set[p] = true; });
  censusCache = { token: token, counts: c, eligible: eligible, set: set };
  return censusCache;
}
function isEligible(perf) { return !!census().set[perf]; }
/* The format the page speaks about. Intent first: the time control you put at
   the top is the one you are trying to improve, so it wins whenever it has a
   large enough sample to be honest about. Only if it does not does the page
   fall back to whatever you actually play most. Ranking purely by volume made
   the whole page talk about bullet to someone whose stated focus is rapid. */

function perfLabel(p) { return p === 'ultraBullet' ? 'ultrabullet' : p; }

/* ── 8d. Evidence, what opens when a skill row is clicked ─────────────
   Each panel is the concrete version of the abstract number: the actual
   games, the actual positions, the actual openings. Nothing generic.     */

/* ── 8f. The coach ───────────────────────────────────────────────────────
   The product is for the player who is stuck and annoyed, they do not want
   a dashboard, they want to be told what to do. The read is a paragraph with
   an opinion, and it ends in one directive. The data that justifies it stays
   one click deeper, in the profile rows.                                    */

/* ── 8e. The trainer ─────────────────────────────────────────────────────
   Positions from your own games, retried on a board that lives on the page.
   The answer key is Lichess's own analysis: `best` and `variation` arrive
   with the export, so grading needs no engine and no server. Results feed a
   small spaced-repetition ladder, a failed position returns tomorrow, a
   solved one in 3, then 7, then 21, then 60 days.                          */

/* ── 8g. The repertoire ──────────────────────────────────────────────────
   Mined from the user's own games, never authored on a blank page: every
   position they actually reach gets a keeper move, their habitual choice
   when the book approves of it, the band's better move when it does not.
   Drills replay the line with the opponent answering from the real reply
   distribution at the user's rating. Chessable trains you against a course;
   this trains you against the people you will actually sit across.        */

      
       
  
    

/* ── Lines, not positions ────────────────────────────────────────────────
   The drilled unit is a LINE: a walk through the tree following keeper
   moves, branching where the band's replies branch. A line is what a player
   experiences as "an opening", eight isolated positions that all answer
   Nf3 are one boring fact; the line they belong to is a story.

   Lines the user already plays by habit are born ready to drill. Lines
   holding a 'fix' (a keeper they have never played) must be LEARNED first:
   the learn pass shows each move before asking for it, instruction before
   retrieval, per the charter, then the same line is tested from memory in
   the same session, and only then does the SRS ladder take over.          */

/* ── Adopting a NEW opening ──────────────────────────────────────────────
   Not from your games, from the band book: pick a first move (or a reply),
   and the lines generate themselves by following the best-scoring popular
   move for your side and the most common answers for theirs. Every adopted
   line is born unlearned, so it flows through Learn before it ever tests.  */

/* ── The board ── */
/* Classic colours and the cburnett pieces, the board every Lichess player
   already reads fluently. Squares #f0d9b5/#b58863, last-move green, quiet
   dots for legal targets. Piece art is CC-BY-SA (see the credit in the
   symbol sheet and in settings). */
var SQ_LIGHT = '#f0d9b5', SQ_DARK = '#b58863';
var HL_MOVE = 'rgba(155,199,0,.41)', HL_SEL = 'rgba(20,85,30,.5)';
var PIECE_ID = { K:'wK',Q:'wQ',R:'wR',B:'wB',N:'wN',P:'wP',
                 k:'bK',q:'bQ',r:'bR',b:'bB',n:'bN',p:'bP' };

var boardSeq = 0, boardFxSeen = {};
/* the marks over the board (FINAL-SPEC 2.1): one colour and one shape per
   meaning, never a second one. Arrows by kind: your game move (solid red),
   their threat (dashed red), their expected reply in a forcing line (dashed
   blue-grey), the better move (green), Stockfish's pick (gold) */
var MARK_ARROW = {
  game: { color: 'rgba(201,80,60,.9)', w: 6, cls: 'bad-arrow' },
  better: { color: 'rgba(61,139,58,.92)', w: 6, cls: 'good-arrow' },
  explore: { color: 'rgba(182,130,53,.85)', w: 6, cls: 'ghost-arrow' },
  threat: { color: 'rgba(201,80,60,.9)', w: 5, cls: 'threat-arrow', dash: '7 5.5' },
  reply: { color: 'rgba(122,150,184,.95)', w: 5, cls: 'reply-arrow', dash: '7 5.5' }
};
/* a verdict, by kind: the tint under both squares of the move just made,
   and the badge on its landing square (the close badge is hollow, so it
   differs from the found one by shape and not only by colour) */
var MARK_TINT = {
  good: 'rgba(61,150,66,.42)', bad: 'rgba(214,70,52,.42)', close: 'rgba(125,147,171,.34)',
  checking: 'rgba(160,150,130,.30)', unchecked: 'rgba(120,114,104,.40)', info: 'rgba(120,114,104,.40)'
};
var MARK_BADGE = { good: '#3d9142', bad: '#d04a3a', close: '#7d93ab', checking: '#8f8b83', unchecked: '#6b665d', info: '#6b665d' };
var BADGE_GLYPH = {
  good: 'M-3.7 .3 L-1.2 2.8 L3.9 -2.6', close: 'M-3.7 .3 L-1.2 2.8 L3.9 -2.6',
  bad: 'M-2.9 -2.9 L2.9 2.9 M2.9 -2.9 L-2.9 2.9',
  checking: 'M-3.3 0 h.01 M0 0 h.01 M3.3 0 h.01',
  unchecked: 'M-2.4 -2.4 C-2.4 -5.3 2.6 -5.3 2.6 -2.4 C2.6 -.7 0 -.5 0 1.4 M0 4.3 h.01',
  info: 'M0 -4.1 h.01 M0 -1 V4.3'
};
/* an arrow from square centre to square centre (board units), with a dark
   halo so it reads on light and dark squares alike. Its head is a marker of
   its own (the id is unique on the page). A short arrow, under 1.6 squares,
   stops nearer the centre with the same head, so a one-square move shows */
function markArrow(x1, y1, x2, y2, kind, id, key, solid) {
  var k = MARK_ARROW[kind] || MARK_ARROW.game, dash = solid ? '' : k.dash || '';
  var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
  var inset = 45 * (len < 45 * 1.6 ? 0.22 : 0.34);
  var tx = x2 - dx / len * inset, ty = y2 - dy / len * inset;
  var at = ' x1="' + x1 + '" y1="' + y1 + '" x2="' + tx + '" y2="' + ty + '" stroke-linecap="' + (dash ? 'butt' : 'round') + '"'
    + (dash ? ' stroke-dasharray="' + dash + '"' : '');
  return {
    def: '<marker id="' + id + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto">'
      + '<path d="M0 0 L10 5 L0 10 z" fill="' + k.color + '" stroke="rgba(0,0,0,.28)" stroke-width=".6"/></marker>',
    body: '<line' + at + ' stroke="rgba(0,0,0,.28)" stroke-width="' + (k.w + 2.4) + '"/>'
      + '<line class="' + k.cls + '"' + (key != null ? ' data-key="' + String(key).replace(/"/g, '') + '"' : '') + at
      + ' stroke="' + k.color + '" stroke-width="' + k.w + '" marker-end="url(#' + id + ')"/>'
  };
}
/* a red disc with a white cross: where a move went wrong */
function markCross(cx, cy, r) {
  var c = r * 0.38;
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#d04a3a" stroke="rgba(0,0,0,.28)" stroke-width="1"/>'
    + '<path d="M' + (cx - c) + ' ' + (cy - c) + ' L' + (cx + c) + ' ' + (cy + c) + ' M' + (cx + c) + ' ' + (cy - c) + ' L' + (cx - c) + ' ' + (cy + c)
    + '" stroke="#fff" stroke-width="' + (r * 0.3) + '" stroke-linecap="round"/>';
}
/* a ring round a square (x, y its corner): the piece that punishes (red),
   the piece about to reply (dashed blue-grey), a hint's prize (dashed
   gold), hint 2's piece to move (gold), or "not a move here" (a grey
   outline, the only square one) */
function markRing(x, y, kind) {
  var cx = x + 22.5, cy = y + 22.5, c = ' cx="' + cx + '" cy="' + cy + '" r="20" fill="none"';
  if (kind === 'nope') return '<rect class="nope-box" x="' + (x + 2) + '" y="' + (y + 2) + '" width="41" height="41" fill="none" stroke="rgba(160,154,144,.9)" stroke-width="2"/>';
  if (kind === 'threat') return '<circle' + c + ' stroke="rgba(0,0,0,.35)" stroke-width="6.5"/><circle class="ring-threat"' + c + ' stroke="#e0503e" stroke-width="3.6"/>';
  if (kind === 'reply') return '<circle class="reply-ring"' + c + ' stroke="rgba(122,150,184,.95)" stroke-width="3" stroke-dasharray="6 4"/>';
  if (kind === 'target') return '<circle class="ring-target"' + c + ' stroke="rgba(182,130,53,.95)" stroke-width="3" stroke-dasharray="4 3"/>';
  /* the hint ring paints after pieces and arrows: a hint buried under a red
     arrow is no hint at all */
  return '<circle' + c + ' stroke="rgba(20,14,8,.55)" stroke-width="6"/><circle class="hint-ring"' + c + ' stroke="rgba(182,130,53,.95)" stroke-width="3.5"/>';
}
/* the board: squares, tints and pieces in one svg, and the marks (FINAL-SPEC
   2.1, z 8 to 12) in a second one laid over it, so marks can change without
   touching a piece. Both are drawn bottom to top in the spec's z order.
   opts: flip, mark (last-move squares), tints [{sq, kind}], sel, check,
   ghosts [{sq, p}], anim [from, to], dots, label, decor; marks: guards
   [{from, to}], arrows [{from, to, kind, key, solid}], tried [{from, to}
   or {sq}], rings [{sq, kind}], tokens [{sq, p, kind: 'lost' | 'won'}],
   badges [{sq, kind}], shapes; fx, the effect id of this paint, scoped to
   its card by the caller (a.key + ':' + a.fx), so two cards never share
   one. bad, good, ghost and hint are the older names of the game, better
   and explore arrows and the hint ring. A small board (decor) keeps its
   marks inside its one svg. Only the squares and the pieces (data-sq) take
   a tap: every other shape lets it through */
function boardSvg(st, opts) {
  opts = opts || {};
  var flip = !!opts.flip;
  var SZ = 45, W = SZ * 8;
  /* every board has its own ids: with shared ids, an arrow loses its head
     when the first copy of a marker sits in a hidden view */
  var uid = 'b' + (++boardSeq);
  /* the corner and the centre of a square, as drawn */
  var corner = function (sq) { return [(flip ? 7 - sq % 8 : sq % 8) * SZ, (flip ? sq >> 3 : 7 - (sq >> 3)) * SZ]; };
  var ctr = function (sq) { var c = corner(sq); return [c[0] + SZ / 2, c[1] + SZ / 2]; };
  /* effect ids: a pop or a fade runs on the first paint of its id only, so
     a repaint never replays it, even after a newer id */
  var fresh = opts.fx != null && !boardFxSeen[opts.fx];
  if (opts.fx != null) boardFxSeen[opts.fx] = 1;
  var fxOpen = function (m, cls) {
    if (m.fx == null) return '<g>';
    return '<g class="' + cls + (fresh && m.fx === opts.fx ? ' fx-in' : '') + '" data-fx="' + String(m.fx).replace(/"/g, '') + '">';
  };
  var tintOf = {};
  (opts.tints || []).forEach(function (t) { tintOf[t.sq] = t.kind; });
  /* the card's board names what is on it; small boards are decoration */
  var out = '<svg class="board" viewBox="0 0 ' + W + ' ' + W + '"'
    + (opts.decor ? ' aria-hidden="true"' : ' role="img" aria-label="' + (opts.label || 'chess position').replace(/"/g, '') + '"') + '>'
    + '<defs><radialGradient id="checkglow' + uid + '"><stop offset="0%" stop-color="rgba(230,60,50,.85)"/>'
    + '<stop offset="70%" stop-color="rgba(230,60,50,.35)"/>'
    + '<stop offset="100%" stop-color="rgba(230,60,50,0)"/></radialGradient></defs>';
  /* layers, bottom to top: squares; tints, selection and check glow; ghost
     pieces; pieces (a sliding one last, so it passes over the rest); legal
     dots and coordinates; the crosses on ghosts */
  var sqs = '', tints = '', pcs = '', slide = '', top = '';
  for (var r = 0; r < 8; r++) {
    for (var f = 0; f < 8; f++) {
      var sq = r * 8 + f;
      var col = flip ? 7 - f : f, row = flip ? r : 7 - r;
      var x = col * SZ, y = row * SZ;
      var light = (r + f) % 2 === 1;
      sqs += '<rect data-sq="' + sq + '" x="' + x + '" y="' + y + '" width="' + SZ
        + '" height="' + SZ + '" fill="' + (light ? SQ_LIGHT : SQ_DARK) + '"/>';
      /* a verdict's tint takes the place of the last-move tint on its square */
      if (tintOf[sq])
        tints += '<rect class="tint tint-' + tintOf[sq] + '" x="' + x + '" y="' + y + '" width="' + SZ + '" height="' + SZ
          + '" fill="' + (MARK_TINT[tintOf[sq]] || MARK_TINT.info) + '" style="pointer-events:none"/>';
      else if (opts.mark && opts.mark.indexOf(sq) >= 0)
        tints += '<rect x="' + x + '" y="' + y + '" width="' + SZ + '" height="' + SZ
          + '" fill="' + HL_MOVE + '" style="pointer-events:none"/>';
      if (opts.sel === sq)
        tints += '<rect x="' + x + '" y="' + y + '" width="' + SZ + '" height="' + SZ
          + '" fill="' + HL_SEL + '" style="pointer-events:none"/>';
      if (opts.check === sq) {
        tints += '<circle cx="' + (x + SZ / 2) + '" cy="' + (y + SZ / 2) + '" r="' + (SZ * 0.52)
          + '" fill="url(#checkglow' + uid + ')" style="pointer-events:none"/>';
      }
      var p = st.b[sq];
      if (p) {
        var animAttr = '';
        if (opts.anim && opts.anim[1] === sq) {
          var af = opts.anim[0];
          var acol = flip ? 7 - af % 8 : af % 8, arow = flip ? (af >> 3) : 7 - (af >> 3);
          animAttr = ' class="anim-piece" style="transform:translate('
            + (acol * SZ - x) + 'px,' + (arow * SZ - y) + 'px)"';
        }
        var use = '<use href="#pc-' + PIECE_ID[p] + '" x="' + x + '" y="' + y
          + '" width="' + SZ + '" height="' + SZ + '" data-sq="' + sq + '"' + animAttr + '/>';
        if (animAttr) slide = use; else pcs += use;
      }
      if (opts.dots && opts.dots.indexOf(sq) >= 0) {
        if (p) /* capture: ring around the square, lichess-style */
          top += '<circle cx="' + (x + SZ / 2) + '" cy="' + (y + SZ / 2) + '" r="' + (SZ / 2 - 3)
            + '" fill="none" stroke="' + HL_SEL + '" stroke-width="4" style="pointer-events:none"/>';
        else
          top += '<circle cx="' + (x + SZ / 2) + '" cy="' + (y + SZ / 2) + '" r="5.5"'
            + ' fill="' + HL_SEL + '" style="pointer-events:none"/>';
      }
      /* coordinates live inside the edge squares, tinted with the opposite
         square colour, exactly where a Lichess eye expects them */
      if (row === 7)
        top += '<text x="' + (x + SZ - 3.2) + '" y="' + (y + SZ - 3) + '" text-anchor="end"'
          + ' font-size="7.5" font-weight="600" font-family="sans-serif" fill="'
          + (light ? SQ_DARK : SQ_LIGHT) + '" style="pointer-events:none">'
          + String.fromCharCode(97 + sq % 8) + '</text>';
      if (col === 0)
        top += '<text x="' + (x + 2.8) + '" y="' + (y + 9.5) + '"'
          + ' font-size="7.5" font-weight="600" font-family="sans-serif" fill="'
          + (light ? SQ_DARK : SQ_LIGHT) + '" style="pointer-events:none">'
          + (1 + (sq >> 3)) + '</text>';
    }
  }
  /* where your game move went: the piece faded, with no data-sq so input
     never finds it, and a cross at its top-right; on an occupied square the
     cross alone. Neither takes a tap: a tap on the cross reaches the piece
     under it */
  var ghosts = '', crosses = '';
  (opts.ghosts || []).forEach(function (g) {
    var c = corner(g.sq);
    if (!st.b[g.sq] && PIECE_ID[g.p])
      ghosts += fxOpen(g, 'mk-fade') + '<use class="ghost-piece" href="#pc-' + PIECE_ID[g.p] + '" x="' + c[0] + '" y="' + c[1]
        + '" width="' + SZ + '" height="' + SZ + '" opacity=".34"/></g>';
    crosses += fxOpen(g, 'mk-fade') + markCross(c[0] + 37.5, c[1] + 7.5, 6) + '</g>';
  });
  out += sqs + tints + (ghosts ? '<g style="pointer-events:none">' + ghosts + '</g>' : '') + pcs + slide + top
    + (crosses ? '<g style="pointer-events:none">' + crosses + '</g>' : '') + '</svg>';

  /* the marks, z 8 to 12, then the player's own drawn shapes on top */
  var defs = '', marks = '';
  /* z 8: guard dots, from a defender to the square it guards */
  (opts.guards || []).forEach(function (g) {
    var a = ctr(g.from), b = ctr(g.to), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var x1 = a[0] + dx / len * 13, y1 = a[1] + dy / len * 13, x2 = b[0] - dx / len * 13, y2 = b[1] - dy / len * 13;
    var ln = ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke-dasharray="0.1 7" stroke-linecap="round"';
    marks += '<line' + ln + ' stroke="rgba(0,0,0,.35)" stroke-width="7"/><line class="guard-line"' + ln + ' stroke="#4fae55" stroke-width="3.6"/>'
      + '<circle cx="' + x2 + '" cy="' + y2 + '" r="5.1" fill="rgba(0,0,0,.35)"/><circle cx="' + x2 + '" cy="' + y2 + '" r="3.4" fill="#4fae55"/>';
  });
  /* z 9: arrows, the older single ones first (Stockfish's, the better
     move, the game move: the order they always had) */
  var arrows = [];
  if (opts.ghost) arrows.push({ from: opts.ghost[0], to: opts.ghost[1], kind: 'explore', key: 'gold' });
  if (opts.good) arrows.push({ from: opts.good[0], to: opts.good[1], kind: 'better', key: 'good' });
  if (opts.bad) arrows.push({ from: opts.bad[0], to: opts.bad[1], kind: 'game', key: 'bad' });
  arrows = arrows.concat(opts.arrows || []);
  arrows.forEach(function (ar, i) {
    var a = ctr(ar.from), b = ctr(ar.to), m = markArrow(a[0], a[1], b[0], b[1], ar.kind, 'ah' + uid + '-' + i, ar.key, ar.solid);
    defs += m.def;
    marks += m.body;
  });
  /* z 9: a move already tried, faint: a thin line and a cross where it
     landed, or the cross alone ({sq}) */
  (opts.tried || []).forEach(function (t) {
    var b = ctr(t.sq != null ? t.sq : t.to), line = '';
    if (t.sq == null) {
      var a = ctr(t.from), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      line = '<line class="tried-line" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + (b[0] - dx / len * 6) + '" y2="' + (b[1] - dy / len * 6)
        + '" stroke="#c9503c" stroke-width="2" stroke-linecap="round"/>';
    }
    marks += '<g class="tried" opacity=".55">' + line + markCross(b[0], b[1], 6) + '</g>';
  });
  /* z 10: rings; the older hint ring is hint 2's */
  var rings = (opts.hint != null ? [{ sq: opts.hint, kind: 'hint' }] : []).concat(opts.rings || []);
  rings.forEach(function (rg) { var c = corner(rg.sq); marks += markRing(c[0], c[1], rg.kind); });
  /* z 11: a piece captured here, as a token at the square's bottom-left:
     a red ring and a slash for one you lost, a green ring for one you won */
  (opts.tokens || []).forEach(function (t) {
    var c = corner(t.sq), cx = c[0] + 12.5, cy = c[1] + 32.5, lost = t.kind !== 'won';
    marks += '<g class="token token-' + (lost ? 'lost' : 'won') + '">' + fxOpen(t, 'mk-fade')
      + '<circle cx="' + cx + '" cy="' + cy + '" r="12.5" fill="rgba(244,236,222,.94)" stroke="' + (lost ? '#d6452f' : '#3d9142') + '" stroke-width="2.4"/>'
      + (PIECE_ID[t.p] ? '<use href="#pc-' + PIECE_ID[t.p] + '" x="' + (cx - 10.8) + '" y="' + (cy - 10.8) + '" width="21.6" height="21.6" opacity=".82"/>' : '')
      + (lost ? '<line x1="' + (cx - 8.8) + '" y1="' + (cy + 8.8) + '" x2="' + (cx + 8.8) + '" y2="' + (cy - 8.8) + '" stroke="#d6452f" stroke-width="2.4" stroke-linecap="round"/>' : '')
      + '</g></g>';
  });
  /* z 12: the verdict badge, at the landing square's top-right; it pops
     once per effect id */
  (opts.badges || []).forEach(function (bd) {
    var c = corner(bd.sq), col = MARK_BADGE[bd.kind] || MARK_BADGE.info, hollow = bd.kind === 'close';
    marks += '<g class="badge badge-' + bd.kind + '" transform="translate(' + (c[0] + 36) + ' ' + (c[1] + 9) + ')">' + fxOpen(bd, 'mk-pop')
      + '<circle r="9.8" fill="rgba(0,0,0,.28)"/>'
      + '<circle r="8.6" fill="' + (hollow ? '#161512' : col) + '"' + (hollow ? ' stroke="' + col + '" stroke-width="2.2"' : '') + '/>'
      + '<path d="' + (BADGE_GLYPH[bd.kind] || BADGE_GLYPH.info) + '" fill="none" stroke="' + (hollow ? col : '#fff')
      + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></g>';
  });
  /* drawn shapes: the calculation scaffolding, lichess-green */
  if (opts.shapes && opts.shapes.length) {
    defs += '<marker id="ah' + uid + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto">'
      + '<path d="M0 0 L10 5 L0 10 z" fill="rgba(21,120,27,.8)"/></marker>';
    opts.shapes.forEach(function (sh) {
      if (sh.at != null) {
        var c0 = ctr(sh.at);
        marks += '<circle cx="' + c0[0] + '" cy="' + c0[1] + '" r="' + (SZ / 2 - 2.5)
          + '" fill="none" stroke="rgba(21,120,27,.8)" stroke-width="4"/>';
      } else {
        var f0 = ctr(sh.from), t0 = ctr(sh.to);
        var dx = t0[0] - f0[0], dy = t0[1] - f0[1];
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var tx = t0[0] - dx / len * (SZ * 0.34), ty = t0[1] - dy / len * (SZ * 0.34);
        marks += '<line x1="' + f0[0] + '" y1="' + f0[1] + '" x2="' + tx + '" y2="' + ty
          + '" stroke="rgba(21,120,27,.8)" stroke-width="7" stroke-linecap="round"'
          + ' marker-end="url(#ah' + uid + ')"/>';
      }
    });
  }
  marks = (defs ? '<defs>' + defs + '</defs>' : '') + marks;
  if (opts.decor) return marks ? out.slice(0, -6) + '<g style="pointer-events:none">' + marks + '</g></svg>' : out;
  return out + '<svg class="marks" viewBox="0 0 ' + W + ' ' + W + '" aria-hidden="true" style="pointer-events:none">' + marks + '</svg>';
}

/* ── Sounds, a whisper of feedback, synthesized, no files. Off in
   settings, and respectful of the first-gesture rule (the context is
   created inside a click). ── */
var sndCtx = null;
function snd(name) {
  if (cfg.sound === false) return;
  try {
    if (!sndCtx) sndCtx = new (window.AudioContext || window.webkitAudioContext)();
    /* browsers hand back a suspended context even mid-gesture, resume or
       every tone is silently swallowed */
    if (sndCtx.state === 'suspended') sndCtx.resume();
    var t = sndCtx.currentTime;
    function tone(freq, start, dur, type, gain) {
      var o = sndCtx.createOscillator(), g = sndCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(gain || 0.06, t + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g); g.connect(sndCtx.destination);
      o.start(t + start); o.stop(t + start + dur + 0.02);
    }
    if (name === 'tap') tone(340, 0, 0.04, 'triangle', 0.025);
    else if (name === 'move') tone(220, 0, 0.06, 'triangle', 0.05);
    else if (name === 'good') { tone(660, 0, 0.09); tone(880, 0.09, 0.14); }
    else if (name === 'bad') tone(140, 0, 0.16, 'sawtooth', 0.04);
    else if (name === 'set') { tone(523, 0, 0.1); tone(659, 0.1, 0.1); tone(784, 0.2, 0.22); }
  } catch (e) {}
}

/* ── Trainer state and flow ── */

/* A custom set: the same trainer, fed by a filter, an opponent, an opening,
   a colour. Coach cards deal these directly instead of linking away. */

function uciToMove(st, uci) {
  if (!uci || uci.length < 4) return null;
  var from = (uci.charCodeAt(1) - 49) * 8 + (uci.charCodeAt(0) - 97);
  var to = (uci.charCodeAt(3) - 49) * 8 + (uci.charCodeAt(2) - 97);
  var promo = uci[4] ? uci[4].toUpperCase() : null;
  var out = null;
  legalMoves(st).forEach(function (m) {
    if (out) return;
    if (m.from === from && m.to === to && (!promo || m.promo === promo)) out = m;
  });
  return out;
}

/* ── Missions ────────────────────────────────────────────────────────────
   Every kind of set the app can deal, in one checklist on Today: the daily
   set first, then the book drills, then whatever the coach is prescribing.
   Each is startable in one tap, checkable for the day, and repeatable -
   the check is satisfaction, never a lock.                                 */

/* ── Opponent prep (#8) ──────────────────────────────────────────────────
   Thirty seconds before a match: their book, their colours, their leaks.
   One request, cached per name for the session.                            */

/* ── 12. Notices ─────────────────────────────────────────────────────── */

var noticeTimer = null;
function notice(msg, action) {
  var box = el('overlay');
  var n = document.createElement('div');
  n.className = 'notice';
  n.setAttribute('role', 'status');
  n.setAttribute('aria-live', 'polite');
  n.textContent = msg;
  /* one action at most, such as Resume or Undo */
  if (action) {
    var b = document.createElement('a');
    b.setAttribute('data-act', action.act);
    b.className = 'notice-act';
    b.textContent = action.label;
    n.appendChild(document.createTextNode(' '));
    n.appendChild(b);
  }
  var old = box.querySelector('.notice');
  if (old) old.remove();
  box.appendChild(n);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(function () { n.remove(); }, action ? 8000 : 5000);
}

/* ── 14. Actions ─────────────────────────────────────────────────────── */

          

/* Quiet hourly pickup: the incremental fetch is cheap (it asks only for
   games since the newest cached one), so staying current costs almost
   nothing and the user never has to think about refreshing. */


/* ── 14c. The engine ─────────────────────────────────────────────────────
   Stockfish 16 NNUE, fetched once from a CDN and booted as a blob worker
   (the glue is patched so its .wasm loads cross-origin; jsDelivr sends
   CORS). Falls back to the older asm.js build if WASM is unavailable. Used
   for two things: quietly scanning unanalysed games into training material,
   and judging whether a non-book answer in the trainer was also good.      */

/* ── 14d. The quiet scan ─────────────────────────────────────────────────
   Keeps a buffer of games ready to train: whenever fewer than SCAN_BUFFER
   games hold an unmastered position, the newest unanalysed game is scanned
   in the background, every position evaluated, the win-chance swings
   turned into the same blunder records the Lichess-analysed games carry.
   Results persist in the game cache, so each game is scanned once ever.   */

var SCAN_RECENT = 20;    /* incoming games always jump the queue */
/* up to two games are read at once, so the engines never wait on the slow
   tail of one game; inflight holds their ids */
var scanState = { running: false, current: null, done: 0, inflight: {}, active: 0 };

/* Coverage, not buffering: the newest SCAN_WINDOW games should each have
   analysis from somewhere, Lichess's servers or the engine here. Training
   always has fresh material, and new games go to the front of the line. */
function scanCoverage() {
  var covered = 0, total = 0;
  data.games.forEach(function (g) {
    if (!inScope(g)) return;
    if (g.analysed || g.scanned || g.bl) { covered++; total++; }
    else if (scannableAny(g)) total++;
  });
  return { covered: covered, total: total };
}

function scanMiss(g) {
  scanState.miss = scanState.miss || {};
  scanState.miss[g.id] = (scanState.miss[g.id] || 0) + 1;
}
function scanBlocked(g) {
  return scanState.miss && scanState.miss[g.id] >= 3;
}
function scannable(g) {
  return g && !g.analysed && !g.scanned && !g.bl && !g.mvMiss && !scanBlocked(g)
    && g.plies >= 6 && isEligible(g.perf);
}
/* the last lane ignores the format filter: the fish works until EVERYTHING
   is analysed, untracked formats go last, but they go */
function scannableAny(g) {
  return g && !g.analysed && !g.scanned && !g.bl && !g.mvMiss && !scanBlocked(g)
    && g.plies >= 6;
}

/* The scan never stops while anything is scannable, it rotates in batches
   so every consumer gets fed early and keeps getting fed: fresh games always
   first, then one game per coach custom set in turn, then the general pool,
   round and round until the whole window is covered. */
function nextScanTarget() {
  var i, g, free = function (x) { return !scanState.inflight[x.id]; };
  /* anything new at the top of the list first */
  for (i = 0; i < Math.min(SCAN_RECENT, data.games.length); i++) {
    if (scannable(data.games[i]) && free(data.games[i])) return data.games[i];
  }
  /* then games whose moves are already here, rotating across formats; losses
     first, since only a loss or a draw has a move that decided it */
  var perfs = trackedPerfs();
  var fStart = (scanState.frr || 0) % perfs.length;
  for (var pass = 0; pass < 2; pass++) {
    for (var fs = 0; fs < perfs.length; fs++) {
      var pf = perfs[(fStart + fs) % perfs.length];
      for (i = 0; i < data.games.length; i++) {
        g = data.games[i];
        if (g.perf === pf && g.mv && scannable(g) && free(g) && (pass === 1 || g.res !== 'win')) {
          scanState.frr = (fStart + fs + 1) % perfs.length;
          return g;
        }
      }
    }
  }
  for (i = 0; i < data.games.length; i++) if (scannable(data.games[i]) && free(data.games[i])) return data.games[i];
  for (i = 0; i < data.games.length; i++) if (scannableAny(data.games[i]) && free(data.games[i])) return data.games[i];
  return null;
}

 

/* When the retained pool runs dry, refuel it wholesale: one POST to the
   export-by-ids endpoint brings movetext for up to 150 games, the pool
   keeps eating at 1.2s gaps instead of dropping to one fetch per 20s. */
var bulkState = { at: 0, fails: 0, busy: false };
function bulkAllowed() {
  return !isCC() && !bulkState.busy && bulkState.fails < 3
    && Date.now() - bulkState.at > 120000
    && Date.now() >= backoffUntil;
}
function bulkRetain() {
  /* chess.com games arrive with their movetext in hand, nothing to refuel */
  if (isCC()) return Promise.resolve(0);
  bulkState.busy = true;
  bulkState.at = Date.now();
  var myGen = gen;
  /* newest scannable per format, interleaved, up to 150 ids */
  var perfs = trackedPerfs();
  var byPerf = {};
  perfs.forEach(function (p) { byPerf[p] = []; });
  data.games.forEach(function (g) {
    if (scannable(g) && !g.mv && byPerf[g.perf]) byPerf[g.perf].push(g);
  });
  var ids = [];
  for (var round = 0; ids.length < 150; round++) {
    var got = false;
    for (var pi = 0; pi < perfs.length && ids.length < 150; pi++) {
      var g2 = byPerf[perfs[pi]][round];
      if (g2) { ids.push(g2.id); got = true; }
    }
    if (!got) break;
  }
  if (ids.length < 150) {
    var seenIds = {};
    ids.forEach(function (id) { seenIds[id] = 1; });
    for (var gi = 0; gi < data.games.length && ids.length < 150; gi++) {
      var g4 = data.games[gi];
      if (scannableAny(g4) && !g4.mv && !seenIds[g4.id]) ids.push(g4.id);
    }
  }
  if (!ids.length) { bulkState.busy = false; return Promise.resolve(0); }
  return request('/api/games/export/_ids?moves=true&clocks=true',
      { method: 'POST', body: ids.join(','), accept: 'application/x-ndjson', quiet: true })
    .then(function (res) { return res.text(); })
    .then(function (text) {
      if (stale(myGen)) return 0;
      var byId = {};
      data.games.forEach(function (g) { byId[g.id] = g; });
      var fed = 0;
      text.split('\n').forEach(function (line) {
        if (!line.trim()) return;
        try {
          var full = JSON.parse(line);
          var g3 = byId[full.id];
          if (g3 && full.moves && scannableAny(g3)) {
            g3.mv = full.moves;
            if (full.clocks) g3.ck = full.clocks;
            fed++;
          }
        } catch (e) {}
      });
      if (fed) saveGames(data.games);
      bulkState.busy = false;
      bulkState.fails = 0;
      return fed;
    })
    .catch(function () {
      bulkState.busy = false;
      bulkState.fails++;
      return 0;
    });
}

/* chess.com's refuel: games that lost their movetext get it back by
   refetching their MONTHS (a couple of cheap GETs), since the single-game
   endpoint is lichess's. */
function ccRefuel() {
  bulkState.busy = true;
  bulkState.at = Date.now();
  var myGen = gen;
  var months = {};
  data.games.forEach(function (g) {
    if (!scannableAny(g) || g.mv) return;
    var d = new Date(g.ts);
    var ym = d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
    months[ym] = 1;
  });
  var list = Object.keys(months).sort().reverse().slice(0, 3);
  if (!list.length) { bulkState.busy = false; return Promise.resolve(0); }
  var byId = {};
  data.games.forEach(function (g) { if (!g.mv && scannableAny(g)) byId[g.id] = g; });
  var fed = 0;
  var chain = Promise.resolve();
  list.forEach(function (ym) {
    chain = chain.then(function () {
      if (stale(myGen)) return;
      return ccJSON('/player/' + encodeURIComponent(cfg.user) + '/games/' + ym, { quiet: true })
        .then(function (mo) {
          (mo.games || []).forEach(function (raw) {
            var shaped = ccShape(raw);
            if (!shaped) return;
            var g2 = byId[shaped.id];
            if (g2 && shaped.moves) {
              g2.mv = shaped.moves;
              if (shaped.clocks) g2.ck = shaped.clocks;
              delete g2.mvMiss;
              fed++;
            }
          });
          /* this month has now been read in full: any of its games still
             without movetext truly has no copy to fetch */
          Object.keys(byId).forEach(function (id2) {
            var g6 = byId[id2];
            if (g6.mv) return;
            var d6 = new Date(g6.ts);
            var ym6 = d6.getUTCFullYear() + '/' + String(d6.getUTCMonth() + 1).padStart(2, '0');
            if (ym6 === ym) g6.mvMiss = 1;
          });
        }).catch(function () {});
    });
  });
  return chain.then(function () {
    if (!stale(myGen) && fed) saveGames(data.games);
    bulkState.busy = false;
    return fed;
  });
}

function autoScan() {
  var tr = function () {};
  if (!cfg.user) { scanState.running = false; scanState.pending = false; return; }
  /* a second game joins only when both analysts can be kept busy */
  var lanes = SF.workers.length >= 3 ? 2 : 1;
  if (scanState.active >= lanes || SF.state === 'failed' || scanState.fetching) { tr('busy/failed'); return; }
  /* the scan is the politest customer in the shop: it waits out any backoff
     with room to spare rather than being the thing that causes one */
  if (Date.now() < backoffUntil) {
    tr('backoff');
    setTimeout(autoScan, backoffUntil - Date.now() + 30000);
    return;
  }
  var target = nextScanTarget();
  if (!target) { tr('no-target'); scanState.current = null; scanState.pending = false; renderAnalysisStatus(); return; }
  if (!target.mv && bulkAllowed()) {
    /* refuel first, the same games come back fetchless in a few seconds */
    if (scanState.active) return;
    scanState.fetching = scanState.running = true;
    renderAnalysisStatus();
    bulkRetain().then(function (fed) {
      scanState.fetching = false;
      scanState.running = scanState.active > 0;
      setTimeout(autoScan, fed ? 800 : 1500);
    });
    return;
  }
  if (isCC() && !target.mv) {
    if (!bulkState.busy && bulkState.fails < 3 && Date.now() - bulkState.at > 60000) {
      tr('ccRefuel');
      if (scanState.active) return;
      scanState.fetching = scanState.running = true;
      renderAnalysisStatus();
      ccRefuel().then(function (fed) {
        scanState.fetching = false;
        scanState.running = scanState.active > 0;
        if (fed) bulkState.fails = 0; else bulkState.fails++;
        setTimeout(autoScan, fed ? 300 : 1000);
      });
      return;
    }
    /* refuel is cooling down: wait for its window rather than branding
       the game, only a refetched month that truly lacks the game may
       mark mvMiss (ccRefuel does that precisely) */
    tr('mv-wait');
    setTimeout(autoScan, 8000);
    return;
  }
  tr('scan:' + target.id);
  scanState.running = true;
  scanState.active++;
  scanState.inflight[target.id] = 1;
  scanState.current = target;
  scanState.lastLocal = !!(target.mv && !target.bl);
  renderAnalysisStatus();
  /* the second lane starts at once, if there is room and work */
  if (scanState.active < lanes && scanState.lastLocal) setTimeout(autoScan, 0);
  var local = scanState.lastLocal;
  scanGame(target)
    .catch(function (e) { if (window.console) console.error('scan fail', e && e.message); scanMiss(target); })
    .then(function () {
      scanState.active--;
      delete scanState.inflight[target.id];
      scanState.running = scanState.active > 0;
      /* the fish stays awake through the breather between games, grey means
         genuinely done (or the engine failed), never "between bites" */
      scanState.pending = !!nextScanTarget();
      scanState.done++;
      renderAnalysisStatus();
      /* the expensive work, serializing the cache, re-mining the trainer's
         queues, batches across scans instead of taxing every completion */
      if ((scanState.dirty || 0) >= 5 || !scanState.pending) {
        scanState.dirty = 0;
        flushSave();
        if (ui.view === 'insights' && !ui.session) renderInsights();
        if (!scanState.pending) setTimeout(autoEnrich, 500);
      }
      /* the next local game follows straight on; a fetched one waits politely */
      setTimeout(autoScan, local ? 0 : 20000);
    });
}

/* A player who mostly blitzes still deserves a real rapid read: after the
   main window lands, any tracked format sitting under its floor gets its
   own quiet per-format fetch, merged and deduped in the background. */
function retainMovetext() {
  var kept = {};
  /* count what is already retained so repeat passes respect the cap */
  data.games.forEach(function (g) {
    if (g.mv && !g.bl && !g.scanned && !g.analysed) kept[g.perf] = (kept[g.perf] || 0) + 1;
  });
  data.games.forEach(function (g) {
    if (!g.mvTmp) return;
    if (!g.analysed && !g.scanned && !g.bl && !g.mv && g.plies >= 6
        && (isCC() || (kept[g.perf] || 0) < RETAIN_PER_FORMAT)) {
      g.mv = g.mvTmp;
      if (g.ckTmp) g.ck = g.ckTmp;
      kept[g.perf] = (kept[g.perf] || 0) + 1;
    }
    delete g.mvTmp;
    delete g.ckTmp;
  });
}

function topUpFormats() {
  if (isCC()) return;   /* the archive walker enforces the floors itself */
  if (data.sections.games !== 'ok') return;
  data.topups = data.topups || {};
  var meId = String(cfg.user).toLowerCase();
  var myGen = gen;
  var chain = Promise.resolve();
  trackedPerfs().forEach(function (p) {
    var have = 0;
    data.games.forEach(function (g) { if (g.perf === p) have++; });
    if (have >= cfg.perFormat || data.topups[p]) return;
    data.topups[p] = 1;
    chain = chain.then(function () {
      if (stale(myGen)) return;
      /* a game already held is never pushed twice, even if this read is cut short */
      var held = {};
      data.games.forEach(function (g) { held[g.id] = 1; });
      return getND('/api/games/user/' + encodeURIComponent(cfg.user)
          + '?perfType=' + p + '&' + GAME_PARAMS + '&max=' + cfg.perFormat,
        function (g) {
          if (stale(myGen)) return;
          var c = compact(g, meId);
          if (c && !held[c.id]) { held[c.id] = 1; data.games.push(c); }
        }, { quiet: true }
      ).then(function () {
        if (stale(myGen)) return;
        var seen = {};
        data.games = data.games.filter(function (g) {
          if (seen[g.id]) return false;
          seen[g.id] = 1;
          return true;
        }).sort(function (a, b) { return b.ts - a.ts; });
        retainMovetext();
        saveGames(data.games);
        modelDirty();
        renderAll();
      }).catch(function () {
        /* a rate-limited top-up retries once the backoff clears, a format
           must not stay starved because one fetch hit a 429 */
        setTimeout(function () {
          if (stale(myGen)) return;
          delete data.topups[p];
          topUpFormats();
        }, 90000);
      });
    });
  });
}

/* ── 15. Loading ─────────────────────────────────────────────────────── */
/* Slow-moving data persists across visits: profiles, peaks and tournament
   schedules do not change by the minute, so they should not be fetched by
   the minute. Serve the stored copy inside its TTL and skip the network
   entirely; past the TTL, fetch and re-store. Rated games stay on their own
   incremental path. */
function cachedJSON(key, ttlMs, fetcher) {
  var k = 'nl:cache:' + key;
  var hit = store.get(k, null);
  if (hit && hit.at && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.v);
  return fetcher().then(function (v) {
    store.set(k, { at: Date.now(), v: v });
    return v;
  }).catch(function (err) {
    if (hit) return hit.v;          /* stale beats an error */
    throw err;
  });
}

function loadUser() {
  var myGen = gen;
  data.sections.user = 'loading';
  return cachedJSON('user:' + cfg.src + ':' + String(cfg.user).toLowerCase(), 30 * 60 * 1000, function () {
    if (!isCC()) return getJSON('/api/user/' + encodeURIComponent(cfg.user));
    return ccJSON('/player/' + encodeURIComponent(cfg.user)).then(function (prof) {
      return ccJSON('/player/' + encodeURIComponent(cfg.user) + '/stats').then(function (st) {
        var perfs = {};
        var peaks = {};
        [['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'], ['chess_rapid', 'rapid']]
          .forEach(function (pair) {
            var v = st[pair[0]];
            if (!v || !v.last) return;
            var rec = v.record || {};
            perfs[pair[1]] = {
              rating: v.last.rating,
              games: (rec.win || 0) + (rec.loss || 0) + (rec.draw || 0),
              prog: 0,
              last: v.last.date ? v.last.date * 1000 : null      /* the last game in this format */
            };
            if (v.best) peaks[pair[1]] = { rating: v.best.rating };
          });
        return { id: String(prof.username || cfg.user).toLowerCase(),
                 username: prof.username || cfg.user, avatar: prof.avatar || null,
                 perfs: perfs, ccPeaks: peaks };
      });
    });
  }).then(function (u) {
    if (stale(myGen)) return;
    data.user = u;
    if (data.narrate && u.perfs) {
      var bits = [];
      ['rapid','blitz','bullet'].forEach(function (k) {
        if (u.perfs[k] && u.perfs[k].games) bits.push(k + ' ' + u.perfs[k].rating);
      });
      narrLine('user', 'Found <b>' + esc(u.username || cfg.user) + '</b>'
        + (bits.length ? ': ' + bits.join(', ') : '') + '.');
      if (el('identity')) el('identity').innerHTML = identityHtml();
    }
    data.sections.user = 'ok';
    renderHeader();
  }).catch(function (err) {
    if (stale(myGen)) return;
    data.sections.user = 'fail';
    data.userErr = err && err.code;
    /* only a true 404 means the account is wrong, a rate limit or a bad
       connection must never claim the user does not exist */
    if (err && err.code === 404) notice((isCC() ? 'chess.com' : 'lichess') + ' has no account called ' + cfg.user + '.');
  });
}

/* The rating curve is reconstructed from the games we already hold: the rating
   after a game is the rating it was played at plus its diff. No extra request,
   and it moves with whatever game window is loaded. */
function buildSeries() {
  data.series = {};
  data.deltas = {};
  var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  var cut = Date.now() - 90 * 864e5;

  trackedPerfs().forEach(function (p) {
    var list = data.games.filter(function (g) { return g.perf === p && g.myR; }).slice().reverse();
    if (!list.length) return;
    var rating = function (g) { return g.myR + (g.rd || 0); };
    var recent = list.filter(function (g) { return g.ts >= cut; });
    data.series[p] = {
      points: recent.length >= 2 ? recent.map(rating) : list.slice(-12).map(rating)
    };
    /* the product's one progress window: the past 30 days, same as the
       blunder trend. Baseline = rating after the last game older than 30d,
       or the pre-rating of the oldest in-window game for newer accounts. */
    var monthCut = Date.now() - 30 * 864e5;
    var older = list.filter(function (g) { return g.ts < monthCut; });
    var inWin = list.filter(function (g) { return g.ts >= monthCut; });
    if (inWin.length) {
      var base = older.length ? rating(older[older.length - 1]) : inWin[0].myR;
      var cur = data.user && data.user.perfs && data.user.perfs[p]
        ? data.user.perfs[p].rating : rating(list[list.length - 1]);
      data.deltas[p] = cur - base;
    }
  });
}

/* The annotated 1000-game export takes Lichess several seconds to even
   begin sending. The theater cannot wait for that: a 12-game moves-only
   fetch returns instantly and fills the boards while the big one warms up. */
function loadNarrPreview() {
  /* chess.com has no cheap last-N endpoint, and asking LICHESS for a
     chess.com username can stream a stranger's games onto the boards -
     the archive walker feeds the strip itself, games arrive with month 1 */
  if (isCC()) return Promise.resolve();
  if (!data.narrate || (data.narrPreview && data.narrPreview.length >= 3)) return Promise.resolve();
  var myGen = gen;
  var got = [];
  return getND('/api/games/user/' + encodeURIComponent(cfg.user)
      + '?max=12&moves=true&perfType=' + trackedPerfs().join(','),
    function (g) {
      if (!g.moves || (g.variant && g.variant !== 'standard')) return;
      var w = g.players && g.players.white, b = g.players && g.players.black;
      if (!w || !b) return;
      var meWhite = !!(w.user && w.user.id === String(cfg.user).toLowerCase());
      var opp = meWhite ? b : w;
      got.push({
        op16: g.moves.split(' ').slice(0, 16).join(' '),
        mv40: g.moves.split(' ').slice(0, 40).join(' '),
        color: meWhite ? 'white' : 'black',
        opp: (opp.user && (opp.user.name || opp.user.id)) || 'Anonymous'
      });
    }
  ).then(function () {
    if (stale(myGen) || !data.narrate) return;
    data.narrPreview = (got.concat(data.narrPreview || [])).slice(0, 15);
    var stage0 = el('narr-stage');
    if (stage0 && !stage0.firstChild && data.narrPreview.length >= 3) {
      stage0.innerHTML = narrBoards();
    }
  }).catch(function () {});
}

function loadGames() {
  var myGen = gen;
  data.sections.games = 'loading';
  data.gamesErr = null;
  data.gamesCount = 0;
  renderHeader(); renderFoot();
  var meId = String(cfg.user).toLowerCase();

  return fetchGames(meId, function (n, c2) {
    if (stale(myGen)) return;
    data.gamesCount = n;
    if (data.narrate) {
      if (c2 && c2.op16) {
        data.narrPreview = data.narrPreview || [];
        if (data.narrPreview.length < 15) data.narrPreview.push(c2);
        /* mount the strip THE MOMENT there is enough to show, the polling
           timer gets starved while the stream chews through games, so this
           cannot wait for it */
        if (data.narrPreview.length === 3) {
          var stage0 = el('narr-stage');
          if (stage0 && !stage0.firstChild) stage0.innerHTML = narrBoards();
        }
      }
      if (!data.narrStart) data.narrStart = Date.now();
      /* one DOM write per ~15 games, not per game, the stream must not
         starve the paint */
      if (n % 15 === 0 || n < 5) {
        var limit = data.progressTarget || readTarget();
        var pctDone = Math.min(100, Math.round(n * 100 / limit));
        var eta = '';
        var elapsed = (Date.now() - data.narrStart) / 1000;
        if (n > 50 && elapsed > 2) {
          var rate = n / elapsed;
          var left = Math.max(0, (limit - n) / rate);
          eta = left < 8 ? ' · nearly there' : ' · about ' + (Math.round(left / 5) * 5) + 's left';
        }
        if (!n && typeof c2 === 'number' && c2 > 2) {
          /* a dormant account: months are being walked with nothing kept
             yet, show the depth so the search never looks frozen */
          narrLine('games', 'Searching your archives… <span class="tnum">' + c2
            + '</span> months back<span class="dim"> · looking for your rated games</span>');
        } else {
          narrLine('games', 'Reading your games… <span class="tnum">' + n + ' / ' + limit + '</span>'
            + '<span class="dim">' + eta + '</span>'
            + '<span class="narr-bar"><span class="narr-fill" style="width:' + pctDone + '%"></span></span>');
        }
      }
    }
    /* Cheap: only the two places that show a count. */
    if (n % 25 === 0) { renderFoot(); if (data.games.length) renderHeader(); }
  }, function (partial) {
    if (stale(myGen)) return;
    data.games = partial;
    modelDirty();
    buildSeries();
    renderHeader();
    if (!data.narrate) renderTrain();
  }).then(function (payload) {
    if (stale(myGen)) return;
    data.games = payload.games;
    data.sections.games = 'ok';
    if (data.narrate) {
      var totalRead = payload.games.length;
      var byP = {};
      payload.games.forEach(function (g2) { byP[g2.perf] = (byP[g2.perf] || 0) + 1; });
      var perBits = trackedPerfs().map(function (p2) {
        return perfLabel(p2) + ' <span class="tnum">' + (byP[p2] || 0) + '</span>';
      }).join(' · ');
      narrLine('games', (totalRead < windowCap() && payload.all !== false
        ? 'Read every rated game you have: '
        : 'Read your recent rated games: ') + perBits + '.');
    }
    computeGreeting();
    modelDirty();
    buildSeries();
    retainMovetext();
    saveGames(data.games);
    renderHeader(); renderFoot();
    if (!data.narrate) { renderTrain(); renderInsights(); renderViews(); }
    topUpFormats();
    setTimeout(autoScan, 800);   /* fresh games always wake the engine */
  }).catch(function (err) {
    if (stale(myGen)) return;
    data.sections.games = 'fail';
    data.gamesErr = err && err.code === 429 ? (isCC() ? 'chess.com' : 'lichess') + ' asked us to slow down. Try again in a minute.' : '';
    renderTrain(); renderFoot();
  });
}

