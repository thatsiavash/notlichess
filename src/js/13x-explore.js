/* ── Explore: after the answer, test any move ─────────────────────────────
   The board becomes a question box: play the move you doubt, for either
   side, and Stockfish answers with one arrow, three lines and one sentence
   that says why. One straight trail (a new move drops the moves after it),
   stepped with ‹ ›; ‹ at the start returns to the lesson. Nothing here runs
   before the card is answered. */

var XP_NODES = [0, 250000, 1000000];
function xpActive() { return !!(ui.session && ui.session.active && ui.session.active.explore); }
function posKey(st) { return stateFen(st).split(' ').slice(0, 4).join(' '); }
function xpNode(st, last, mv) { return { st: cloneState(st), key: posKey(st), fen: stateFen(st), last: last || null, mv: mv || null }; }
function xpCur(ex) { return ex.nodes[ex.at]; }
/* the board code reads ex.st, ex.last and ex.sel: they follow the trail */
function xpSync(ex) { var n = xpCur(ex); ex.st = n.st; ex.last = n.last; }
function xpTouch() { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; }
function sideName(w) { return w ? 'White' : 'Black'; }
/* who answers, as the band says it (X2): "the computer" at tier 1, in the
   sentence and on the button alike, "Stockfish" above it */
function xpWho(a, cap) { return a.tier === 1 ? (cap ? 'The computer' : 'the computer') : 'Stockfish'; }

/* S14: opened only from an answered card's Details row or its ••• item
   (never by a board tap, never while the engine is down), at the card's
   own position with the solver to move (U5); it keeps the frame it came
   from (S0, the answer shown, a story step) to go back to */
function xpOpen(a) { return !!(a && a.phase === 'done' && !a.explore && !a.pendingPromo && a.lines && SF.state !== 'failed'); }
function startExplore(o) {
  var a = ui.session && ui.session.active;
  if (!xpOpen(a)) return;
  o = o || {};
  a.menuOpen = false;
  /* the frame it came from, to come back to (S14) */
  var from = a.view ? JSON.parse(JSON.stringify(a.view)) : { mode: 's0' };
  /* a story step comes back landed */
  delete from.pre;
  a.xpRes = a.xpRes || {};
  a.explore = { root: from, nodes: [xpNode(a.pre, a.preLast, null)],
                at: 0, sel: -1, res: a.xpRes, hot: 0, k: 3, say: {}, flash: null, wantRow: null, focusHead: true };
  xpSync(a.explore);
  xpSpoilIndex();
  track('explore_start_' + (o.via || 'link'));
  renderCard();
  exploreAnalyse(false);
}
function exploreExit(how) {
  var a = ui.session && ui.session.active;
  if (!a || !a.explore) return;
  var root = a.explore.root;
  engineStop('explore');
  a.explore = null;
  a.view = JSON.parse(JSON.stringify(root));
  track('explore_exit_' + (how || 'link'));
  enginePump();
  if (how === 'silent') return;
  renderCard();
  var inv = document.querySelector('#cpanel [data-act="details"]');
  if (inv && how !== 'pop') inv.focus({ preventScroll: true });
}
/* a move in the exploration, by either side */
function explorePlay(m, dragged) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  var P = xpCur(ex), uci = moveUci(m);
  var pr = ex.res[P.key], pick = !!(pr && pr.lines[0] && pr.lines[0].pv[0] === uci);
  var san = sanOf(P.st, m), st = cloneState(P.st), wasEnd = xpEnd(ex);
  applyMove(st, m);
  ex.nodes = ex.nodes.slice(0, ex.at + 1);
  ex.nodes.push(xpNode(st, [m.from, m.to], { san: san, uci: uci, byYou: P.st.w === myPov(a.it), pick: pick, ply: xpPly(P.st) }));
  ex.at++;
  xpFwdMeaning(ex, wasEnd);
  Object.keys(ex.say).forEach(function (k) { if (+k >= ex.at) delete ex.say[k]; });
  ex.sel = -1; ex.hot = 0; ex.flash = null; ex.hover = null;
  xpThaw(ex);
  xpSync(ex);
  ex.anim = dragged ? null : [m.from, m.to];
  snd('move');
  track(pick ? 'explore_pick' : 'explore_move');
  renderCard();
  exploreAnalyse(true);
}
function xpPly(st) { return (st.full - 1) * 2 + (st.w ? 0 : 1); }
function exploreGo(i) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex || i < 0 || i >= ex.nodes.length || i === ex.at) return;
  var fwd = i === ex.at + 1, wasEnd = xpEnd(ex);
  ex.at = i; ex.sel = -1; ex.hot = 0; ex.flash = null; ex.hover = null;
  xpFwdMeaning(ex, wasEnd);
  xpThaw(ex);
  xpSync(ex);
  var n = xpCur(ex);
  ex.anim = fwd && n.last ? n.last : null;
  if (fwd) snd('move');
  renderCard();
  exploreAnalyse(false);
}
/* at the trail's end the forward button plays Stockfish's pick, inside it
   it steps: when that meaning changes, the button takes nothing until its
   new label is painted, and then waits out the slot guard (2.2) unless the
   change came from the other button (‹ leaving the end) */
function xpEnd(ex) { return ex.at >= ex.nodes.length - 1; }
function xpFwdMeaning(ex, wasEnd) { if (xpEnd(ex) !== wasEnd) pendSlot(slotOfAct('xpFwd')); }
/* ← and → stand for ‹ and ›: a held key steps along the trail but never
   past either end (out of exploring, or into a new move), and → plays the
   pick only as a fresh press once its label has been on screen 450 ms */
function xpArrow(ex, d, repeat) {
  var i = slotOfAct(d < 0 ? 'xpBack' : 'xpFwd');
  if (d < 0 ? ex.at === 0 && repeat : xpEnd(ex) && (repeat || slotGuarded(i))) return false;
  pressSlot(i);
  return true;
}
function exploreStep(d) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  if (d < 0) { if (ex.at === 0) exploreExit('back'); else exploreGo(ex.at - 1); return; }
  if (ex.at < ex.nodes.length - 1) { exploreGo(ex.at + 1); return; }
  /* at the end, › plays Stockfish's pick, the one the arrow shows */
  var n = xpCur(ex), r = { lines: xpShown(ex, n) || [] };
  if (!r || !r.lines[0] || xpSpoil(n) || !legalMoves(n.st).length) return;
  var m = uciToMove(n.st, r.lines[0].pv[0]);
  if (m) explorePlay(m, false);
}
/* a click on the board while exploring: pick up a piece of the side to move,
   or play the picked-up one */
function exploreClick(sq) {
  var a = ui.session.active, ex = a.explore;
  var p = ex.st.b[sq];
  if (p && isW(p) === ex.st.w) { ex.sel = ex.sel === sq ? -1 : sq; ex.flash = null; renderCard(); return; }
  if (ex.sel < 0) {
    if (p) { ex.flash = 'It is ' + sideName(ex.st.w) + '\'s move here. Move a ' + sideName(ex.st.w).toLowerCase() + ' piece.'; renderCard(); }
    return;
  }
  var legal = legalMoves(ex.st).filter(function (m) { return m.from === ex.sel && m.to === sq; });
  if (!legal.length) { ex.sel = -1; renderCard(); return; }
  if (legal.length > 1 && legal[0].promo) { a.pendingPromo = { moves: legal, to: sq, explore: true }; renderCard(); return; }
  explorePlay(legal[0], pointerState.suppressClick);
}

/* ── the analysis loop ───────────────────────────────────────────────────── */
function xpGameOver(st) { return !legalMoves(st).length; }
/* another card's own position: Stockfish stays quiet there, or exploring
   would print the answer to a card still to come */
function xpSpoilIndex() {
  var ss = ui.session;
  if (!ss || ss.xpSpoil) return;
  var idx = {};
  allMistakes().forEach(function (it) {
    if (!trainable(it) || it.b.x) return;
    var st = stateAtPly(it.g.mv, it.b.p);
    if (st) idx[posKey(st)] = it.key;
  });
  ss.xpSpoil = idx;
}
/* another card's position, never the position of the card on screen (a
   twin card from another game at the same position included). It reads
   only: cardFor keys the card's position once */
function xpSpoil(n) {
  var ss = ui.session, a = ss && ss.active;
  if (!ss || !ss.xpSpoil || !ss.xpSpoil[n.key]) return false;
  return !(a && n.key === (a.preKey || posKey(a.pre)));
}
function xpRun(a, ex, n, step) {
  return engineEval(n.fen, { nodes: XP_NODES[step] }, true,
    { multipv: 3, tag: 'explore', lanes: [0, 1], hash: xpTouch() ? 32 : 64, xp: { key: n.key, step: step } })
    .then(function (r) {
      if (!r || r.stopped) return;
      var a2 = ui.session && ui.session.active;
      if (a2 !== a || a2.explore !== ex) return;
      var old = ex.res[n.key];
      if (old && old.step >= step) return;
      /* rows under the pointer or keyboard focus keep what they show for up
         to 3 s: the sentence, meter and bar still update */
      if (n === xpCur(ex) && old && old.lines.length && !ex.frozen && (ex.hover != null || xpRowFocused())) {
        ex.frozen = { key: n.key, lines: old.lines };
        ex.frozenT = setTimeout(function () { var a3 = ui.session && ui.session.active; if (xpThaw(ex) && a3 && a3.explore === ex) renderCard(); }, 3000);
      }
      ex.res[n.key] = { step: step, lines: keepSlots(old && old.lines, r.lines.slice(0, 3)), depth: r.depth };
      xpAfterResult(a, ex, n);
    }, function (err) {
      if (err && err.stopped) return;
      var a2 = ui.session && ui.session.active;
      if (a2 !== a || a2.explore !== ex) return;
      n.fails = (n.fails || 0) + 1;
      if (SF.state === 'failed' || n.fails >= 2) { n.down = true; if (xpCur(ex) === n) renderCard(); }
    });
}
function xpRowFocused() { var f = document.activeElement; return !!(f && f.closest && f.closest('#xp .xp-row[data-act="xpRow"]')); }
/* the lines the rows show: the frozen ones while the rows are held */
function xpShown(ex, n) { return ex.frozen && ex.frozen.key === n.key ? ex.frozen.lines : (ex.res[n.key] ? ex.res[n.key].lines : null); }
function xpThaw(ex) { if (!ex.frozen) return false; ex.frozen = null; clearTimeout(ex.frozenT); return true; }
/* slot 0 is always the new best (the gold arrow is row 1); the other rows
   keep their place while their first move stays in the top three */
function keepSlots(old, fresh) {
  if (!old || !old.length) return fresh;
  var out = [fresh[0]], rest = fresh.slice(1), used = {};
  used[fresh[0].pv[0]] = 1;
  for (var i = 1; i < 3; i++) {
    var prev = old[i] && old[i].pv[0], same = null;
    rest.forEach(function (l) { if (!same && l.pv[0] === prev && !used[prev]) same = l; });
    out[i] = same || null;
    if (same) used[prev] = 1;
  }
  rest.forEach(function (l) { if (used[l.pv[0]]) return; for (var j = 1; j < 3; j++) if (!out[j]) { out[j] = l; used[l.pv[0]] = 1; return; } });
  return out.filter(Boolean);
}
function xpAfterResult(a, ex, n) {
  var cur = xpCur(ex), parent = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  if (n === cur || n === parent) {
    if (pointerState.dragFrom >= 0) ex.dirty = true;
    else renderCard();
  }
  exploreAnalyse(false, true);
}
/* what to search next: the current position to 1M, and the position before
   it to 1M when the sentence still needs it. A new move stops everything but
   the parent's deep search; a step stops everything */
function exploreAnalyse(newMove, cont) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex) return;
  var C = xpCur(ex), P = ex.at > 0 ? ex.nodes[ex.at - 1] : null;
  var pNeeds = !!(P && !xpSpoil(P) && !xpGameOver(P.st) && !(ex.res[P.key] && ex.res[P.key].step >= 2));
  if (!cont) {
    var keepKey = newMove && pNeeds ? P.key : null;
    engineStop(function (j) { return j.tag === 'explore' && !(keepKey && j.xp && j.xp.key === keepKey && j.xp.step === 2); });
  }
  var want = [];
  var cNeeds = !xpSpoil(C) && !xpGameOver(C.st) && !C.down;
  var cStep = ex.res[C.key] ? ex.res[C.key].step : 0;
  if (cNeeds && cStep < 1) want.push([C, 1]);
  if (pNeeds) want.push([P, 2]);
  if (cNeeds && cStep < 2) want.push([C, 2]);
  var busy = {};
  SF.queue.forEach(function (j) { if (j.tag === 'explore' && j.xp) busy[j.xp.key + '|' + j.xp.step] = 1; });
  SF.workers.forEach(function (sl) { var j = sl.pending && sl.pending[0]; if (j && j.tag === 'explore' && j.xp && !j.stopping) busy[j.xp.key + '|' + j.xp.step] = 1; });
  want.forEach(function (w) { if (!busy[w[0].key + '|' + w[1]]) xpRun(a, ex, w[0], w[1]); });
}

/* ── the sentence ────────────────────────────────────────────────────────── */
var XP_TACTIC = ['mateAllowed', 'forkAllowed', 'pinAllowed', 'discoveredAllowed', 'threat', 'badTrade', 'hung', 'promotion', 'material', 'missedMaterial', 'missedTactic', 'mateMissed'];
var XP_MISSED = ['missedMaterial', 'missedTactic', 'mateMissed'];
/* the score of a line for the side `w` (true = White), mates as +-1500 */
function sideCp(line, w) { return w ? line.cp : -line.cp; }
/* what a move wins or gives up, by the card face's own rule (13y-story.js:
   settledAt, EVAL_SLACK, plainCapture): counted where the engine's line
   settles, never on a capture or check it leaves unanswered, in line with
   the engine's score (a count far past it is a line cut short), in the
   captures' own words. st: the position before the move; ucis: the move
   and the engine's line after it; cp: the mover's score after it
   (centipawns, mates as +-1500). {n (pawns, more than 0 when won), w} or
   null when no count stands. B4 (release 2): the fact sheet's material
   rule, the settle point's material in line with the line's score (within
   2 pawns, else read on to 12 plies, else no count), and the count still
   standing where the line ends (a pawn won back later, as in a king and
   pawn race, was never won); a net of a single pawn is no count (B4: the
   new gate found every such count of Explore's turned by a deeper search) */
function xpClaim(st, ucis, cp) {
  var mover = !!st.w, line = ucis && ucis.length ? buildLine(st, '0000', ucis, mover) : null;
  if (!line || line.nodes.length < 2) return null;
  /* V2.1: counted where the line settles by the fact sheet's rule (two
     quiet plies with nothing en prise, settleLine), never on a capture
     still to be answered: card 2's f5 gives up no pawns */
  var sl = settleLine(st, ucis, null, cp == null ? null : mover ? cp : -cp), k = sl.k;
  if (!sl.ok || !sl.agree || k < 1 || k >= line.nodes.length || !settledAt(line, k)) return null;
  for (var i = 1; i <= k; i++) if (line.nodes[i].move.promo) return null;
  var base = matDiff(line.nodes[0].after.b, mover), n = matDiff(line.nodes[k].after.b, mover) - base;
  /* (a pawn either way is no count Explore names: a deeper search often
     finds it back, where a piece's worth stands) */
  if (Math.abs(n) < 2) return null;
  if (cp != null && Math.abs(cp) < 900 && (n > 0 ? n > cp / 100 - base + EVAL_SLACK : -n > base - cp / 100 + EVAL_SLACK)) return null;
  /* where the line ends (12 plies at most), and before a last run of
     captures there, the count runs the same way and as far (a pawn won
     back on the line's last move was never won) */
  var end = Math.min(line.nodes.length - 1, SETTLE_MAX), cut = end;
  while (cut > k && line.nodes[cut].captured) cut--;
  for (var j = k + 1; j <= end; j++) if (line.nodes[j].move.promo) return null;
  var holds = function (x) { var nx = matDiff(line.nodes[x].after.b, mover) - base; return n > 0 ? nx >= n - 0.5 : nx <= n + 0.5; };
  if (!holds(end) || !holds(cut)) return null;
  /* a loss in the words of what the other side took */
  var w = plainCapture(n > 0 ? line : buildLine(st, '0000', ucis, !mover), k, 1);
  return { n: n, w: w || oneWord(null, n) };
}
/* B8: san is a move of the mover's side (st's side to move) once the line's
   first move and their reply to it are played (line from st), as written,
   and it hits the pieces named (names: piece words; a knight or more, or
   the king, as a fork counts them): the move a "sets up" sentence names is
   one that side can play then, and the fork it promises is one */
function setsUpOk(st, san, line, names) {
  var x = cloneState(st), mover = !!st.w, want = String(san).replace(/[+#]$/, '');
  for (var i = 0; i < 2; i++) {
    var m2 = line && line[i] ? uciToMove(x, line[i]) : null;
    if (!m2) return false;
    applyMove(x, m2);
  }
  var y = legalMoves(x).filter(function (m) { return sanOf(x, m).replace(/[+#]$/, '') === want; })[0];
  if (!y || !!x.w !== mover) return false;
  var z = cloneState(x);
  applyMove(z, y);
  var hit = attacksFrom(z.b, y.to).filter(function (q) { return z.b[q] && colorW(z.b[q]) !== mover && pType(z.b[q]) !== 'P'; }).map(function (q) { return PIECE_WORD[pType(z.b[q])]; });
  return (names || []).every(function (w) { var j = hit.indexOf(w); if (j < 0) return false; hit.splice(j, 1); return true; });
}
/* no mate is possible for either side (a dead draw): kings alone, or with
   one knight or bishop, or with bishops all on one colour */
function deadDraw(st) {
  var minors = [];
  for (var sq = 0; sq < 64; sq++) {
    var p = st.b[sq], t = pType(p);
    if (!p || t === 'K') continue;
    if (t !== 'N' && t !== 'B') return false;
    minors.push({ t: t, dark: ((sq >> 3) + (sq & 7)) % 2 === 0 });
  }
  return minors.length <= 1 || minors.every(function (m) { return m.t === 'B' && m.dark === minors[0].dark; });
}
/* a row whose line ends in a dead draw, or that the engine scores 0.00
   while its line repeats a position: a draw, whatever the winning chances
   would say */
function xpDrawn(st, line) {
  if (!line || line.mate != null || Math.abs(line.cp) > 20) return false;
  var all = [st].concat(playUci(st, line.pv || []).states), seen = {};
  if (deadDraw(all[all.length - 1])) return true;
  return line.cp === 0 && all.some(function (x) { var k = posKey(x); if (seen[k]) return true; seen[k] = 1; return false; });
}
/* the biggest piece the move loses once the line settles, and the moves
   that take it: exploring often meets a quiet first capture before the real
   loss ("Qxd5+ Kh8 Rxa4"), and the sentence must name the real loss */
/* the mover's pieces lost once the line settles: a piece taken straight back
   (the move before or after) by one of the same kind is a trade, not a
   loss; a line that promotes is not counted in pieces at all */
function xpLostPieces(c) {
  var g = c.gameLine;
  if (!g) return null;
  var up = Math.min(g.nodes.length - 1, c.gSettle != null ? c.gSettle : g.nodes.length - 1);
  var mine = [], lost = [];
  for (var i = 0; i <= up; i++) {
    var n0 = g.nodes[i];
    if (!n0) continue;
    if (n0.move && n0.move.promo) return null;
    if (!n0.captured) continue;
    (n0.pov ? lost : mine).push({ p: pType(n0.captured), at: i });
  }
  var same = function (a1, b1) { return a1 === b1 || ((a1 === 'N' || a1 === 'B') && (b1 === 'N' || b1 === 'B')); };
  mine.forEach(function (m) {
    var j = -1;
    lost.forEach(function (l, k) { if (j === -1 && Math.abs(l.at - m.at) === 1 && same(l.p, m.p)) j = k; });
    if (j !== -1) lost.splice(j, 1);
  });
  return lost;
}
function xpBigLoss(c) {
  var g = c.gameLine, lost = xpLostPieces(c), big = null;
  if (!g || !lost) return null;
  lost.forEach(function (l) { if (!big || MOTIF_VAL[l.p] > MOTIF_VAL[big.p]) big = l; });
  if (!big || MOTIF_VAL[big.p] < 5 || c.matGame > -3 || -c.matGame < MOTIF_VAL[big.p] - 1) return null;
  var sans = [];
  for (var k = 1; k <= big.at; k++) sans.push(sanOf(g.nodes[k].before, g.nodes[k].move));
  return { word: PIECE_WORD[big.p], line: sans.join(' ') };
}
/* was the reply already a threat before the move? (the other side to move,
   in the position before) */
function xpThreatBefore(P, reply) {
  if (!reply) return false;
  var st = cloneState(P.st);
  st.w = !st.w; st.ep = -1;
  var m = uciToMove(st, reply);
  if (!m) return false;
  var after = cloneState(st);
  applyMove(after, m);
  return !!(st.b[m.to] || checkedKingSq(after) != null);
}
/* the classifier's sentence with every material count it makes taken
   out (as Details does): "You lose X.", ": you lose X", "and the pinned X
   is lost", "but the X is lost to R" said as "but R takes the X"; a
   sentence that is nothing but a count (the material pattern), or a
   trapped piece the count does not bear out, is dropped (null) */
var XP_LOSS = [/ (?:You|White|Black) loses? [^.]*\./, /: (?:you|White|Black) loses? [^.]*(?=\.$)/, /, and the pinned \w+ is lost(?=\.$)/];
function xpBare(s, c, cl) {
  /* (the material pattern's words, which also say a tactic that stood
     before the move: "Bd3 loses a rook after Bxc3+": a count, gone) */
  if (c.t === 'material' || /^\S+ loses /.test(s)) return null;
  var tr = / lets (?:your|\w+'s) (\w+) get trapped\.$/.exec(s);
  if (tr) return cl && cl.n <= -1 && cl.w === 'the ' + tr[1] ? s : null;
  XP_LOSS.forEach(function (re) { s = s.replace(re, ''); });
  s = s.replace(/, but the (\w+) is lost to (\S+)\.$/, ', but $2 takes the $1.').replace(/, but the (\w+) is lost\.$/, '.');
  return s.trim() || null;
}
/* the sentence already names that one piece taken ("takes your bishop"
   beside a loss of the bishop) */
function xpSaysTaken(s, w) {
  var one = /^the (\w+)$/.exec(w || '');
  return !!one && new RegExp('takes (?:your|the|\\w+\'s) ' + one[1] + '\\b').test(s);
}
var XP_VAL = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 };
/* what a classifier sentence says is lost, in pawns: the piece it names
   taken, less what the move took first ("Qxh2 takes a pawn, but Rxh2 takes
   your queen.": 8); 0 where it names none */
function xpNamedLoss(s) {
  var m = /takes a (\w+), but \S+ takes (?:your|the) (\w+)\./.exec(s);
  if (m) return Math.max(0, (XP_VAL[m[2]] || 0) - (XP_VAL[m[1]] || 0));
  m = / puts your (\w+) where \S+ takes it\./.exec(s) || / leaves your (\w+)(?: on \S+)? undefended/.exec(s) || /'s threat: \S+ takes your (\w+)\./.exec(s);
  return m ? XP_VAL[m[1]] || 0 : 0;
}
/* the better move's sentence, for a chance missed: a gain said only as
   the card face counts it (else "Best was B."); a fork, a mate or a pin
   that counts nothing stays as it is */
function xpBestSaid(s, B, bc) {
  if (!/ wins | takes the |come out ahead/.test(s)) return s;
  return bc && bc.n >= 1 ? B + ' wins ' + bc.w + '.' : 'Best was ' + B + '.';
}
function xpVerdict(a, ex, at) {
  if (ex.say[at]) return ex.say[at];
  var C = ex.nodes[at], P = ex.nodes[at - 1];
  if (!P || !C.mv) return null;
  var pr = ex.res[P.key], cr = ex.res[C.key];
  var over = xpGameOver(C.st);
  if (!over && (!pr || pr.step < 2 || !cr || cr.step < 2)) return null;
  if (!pr || pr.step < 2) return null;
  var s = P.st.w, voice = C.mv.byYou ? 'you' : 'them';
  var best = pr.lines[0], X = C.mv.uci, B = sanOf(P.st, uciToMove(P.st, best.pv[0]));
  var row = pr.lines.filter(function (l) { return l.pv[0] === X; })[0];
  var cpBest = sideCp(best, s);
  /* the move's value: its row in the parent's search, or the child's own
     search; when both exist the worse of the two, so a move one search
     finds bad is never called "about as good" */
  var own = cr && cr.lines[0] ? sideCp(cr.lines[0], s) : null;
  var cpX = row ? sideCp(row, s) : (own != null ? own : (checkedKingSq(C.st) != null ? 1500 : 0));
  if (row && own != null && cpX - own >= 100) cpX = own;
  var wBest = winPct(cpBest), wX = winPct(cpX), drop = wBest - wX, gap = cpBest - cpX;
  var R = cr && cr.lines[0] ? cr.lines[0].pv : [];
  var mateOf = function (l, w) { return l && l.mate != null ? (w ? l.mate : -l.mate) : null; };
  var c = classifyMistake(P.st, X, { pv: best.pv, mate: mateOf(best, s) }, { pv: R, mate: cr && cr.lines[0] ? mateOf(cr.lines[0], s) : null },
    wBest, wX, C.mv.ply, voice);
  var text, cat, whose = voice === 'them' ? ' for ' + sideName(s) : '';
  if (X === best.pv[0]) {
    cat = 'best';
    /* what it wins, counted on the engine's line as the card face counts */
    var bc = xpClaim(P.st, R.length ? [X].concat(R) : best.pv, cpBest), mateIn = mateOf(best, s);
    var mw = bc ? (bc.n > 0 ? 'wins ' : 'gives up ') + bc.w : '';
    /* the count the rows show: the child's own search, plus this move */
    var cm = cr && cr.lines[0] ? mateOf(cr.lines[0], s) : null;
    if (cm != null && mateIn != null && (cm > 0) === (mateIn > 0)) mateIn = cm > 0 ? cm + 1 : cm;
    text = fitLine([C.mv.san + ' is ' + xpWho(a) + '\'s pick.' + (mateIn > 0 ? ' It mates in ' + mateIn + '.' : mateIn < 0 ? ' It allows mate in ' + (-mateIn) + '.' : (mw ? ' It ' + mw + '.' : '')),
      C.mv.san + ' is ' + xpWho(a) + '\'s pick.']);
  } else {
    var decided = Math.abs(cpBest) >= 1000 && Math.abs(cpX) >= 1000 && (cpBest > 0) === (cpX > 0);
    var mateBoth = best.mate != null && ((row && row.mate != null) || !!(cr && cr.lines[0] && cr.lines[0].mate != null)) && (cpBest > 0) === (cpX > 0);
    /* (a chance missed by a point or two is no miss: "Ne2 misses Be3" at
       86% against 87%) */
    var missedSmall = XP_MISSED.indexOf(c.t) !== -1 && c.t !== 'mateMissed' && drop <= SOLVE_TOL;
    var concrete = !missedSmall && XP_TACTIC.indexOf(c.t) !== -1 && (c.t === 'mateMissed' || gap >= 100
      || (!mateBoth && ((c.mateAgainst && !c.alreadyLost) || (decided && c.lossG >= 3))));
    /* a move that keeps a clear edge with no tactic against it passes on
       the card too ("That works too", the safe-win rule): a small drop reads
       as small, never as giving the advantage back */
    var keeps = !concrete && wX >= 70 && wBest >= 70;
    /* near 0% or 100% the winning-chance scale is flat: a real difference in
       material is still a difference, unless the game is decided either way */
    if (!keeps && (concrete || drop > STRONGER_TOL || (gap >= 100 && !decided))) {
      cat = concrete ? 'concrete' : 'worse';
      /* the classifier names the pattern; what is lost is said only as the
         card face would say it (xpClaim), the classifier's own counts gone */
      var cl = xpClaim(P.st, [X].concat(R), cpX), who = voice === 'you' ? 'You lose ' : sideName(s) + ' loses ';
      var bare = xpBare(String(c.sentences.short || c.sentences.game).replace(/ \(\d+% to \d+%\)/g, ''), c, cl);
      /* B4: the classifier's sentence only where it holds as said: a piece
         it names taken (a bad trade, a piece put where it is taken) borne
         out by the count; a missed piece no smaller than the swing it costs
         by more than 2 pawns (else "gxf3 misses Nxc7+."); a fork their first
         reply makes, a pin or skewer within their first two moves */
      var nl = bare ? xpNamedLoss(bare, c) : 0, f0 = c.allowed && c.allowed.fork, p0 = c.allowed && (c.allowed.skewer || c.allowed.pin);
      if (nl && !(cl && -cl.n >= nl - 1.5)) bare = null;
      if (bare && c.t === 'forkAllowed' && f0 && f0.ply > 1) bare = null;
      if (bare && c.t === 'pinAllowed' && p0 && p0.ply > 2) bare = null;
      var mm = bare && c.t === 'missedMaterial' ? / misses (?:\w+'s undefended (\w+)|\S+, which takes the (\w+))/.exec(bare) : null;
      if (mm && gap / 100 > XP_VAL[mm[1] || mm[2]] + 2) bare = C.mv.san + ' misses ' + B + '.';
      if (!bare && !cl && XP_MISSED.indexOf(c.t) !== -1 && c.t !== 'mateMissed' && c.sentences.best) bare = C.mv.san + ' misses ' + B + '.';
      var loss = cl && cl.n <= -1 && !(bare && xpSaysTaken(bare, cl.w)) ? who + cl.w + '.' : '';
      var reason = bare ? bare + (loss ? ' ' + loss : '') : cl && cl.n <= -1 ? C.mv.san + ' loses ' + cl.w + '.' : '';
      var big = XP_MISSED.indexOf(c.t) === -1 && c.t !== 'mateAllowed' && cl && cl.n <= -1 ? xpBigLoss(c) : null;
      if (big && cl.w.indexOf(big.word) >= 0 && reason.indexOf(big.word) === -1) reason = C.mv.san + ' loses the ' + big.word + ': ' + big.line + '.';
      var cmp;
      if (XP_MISSED.indexOf(c.t) !== -1 && c.sentences.best) {
        cmp = xpBestSaid(c.sentences.best, B, xpClaim(P.st, best.pv, cpBest));
        /* B8: "B sets up X" names X only where X is a move of B's side once
           B and its line are played (never one the explored move makes
           impossible: 184234373418:63's Qd5+), and keeps B as its subject:
           "It" there would read as the explored move */
        var su = /^\S+ sets up (\S+?), which forks the (\w+) and (\w+)\.$/.exec(cmp) || /^\S+ sets up (\S+?), which/.exec(cmp);
        if (su && !setsUpOk(P.st, su[1], best.pv, su[2] ? [su[2], su[3]] : null)) cmp = 'Best was ' + B + '.';
        else if (cmp.indexOf(B + ' ') === 0 && reason.indexOf(B) !== -1 && !su) cmp = 'It ' + cmp.slice(B.length + 1);
      } else {
        var stop = stopsWhat(c, P.st);
        /* (V2.1: "defends" only by the moved piece) */
        var dfs = stop ? /^(\S+) defends the (\w+) on ([a-h][1-8])\.$/.exec(stop) : null;
        if (dfs) { var bm0 = uciToMove(P.st, best.pv[0]), ax = cloneState(P.st); applyMove(ax, bm0); if (attacksFrom(ax.b, bm0.to).indexOf(sqIndex(dfs[3])) < 0) stop = ''; }
        if (stop && voice === 'them') stop = themVoice(stop, sideName(s), sideName(!s));
        cmp = stop && xpThreatBefore(P, R[0]) ? stop : (B + (wBest < 45 ? ' loses less.' : ' keeps more.'));
      }
      var lean = bare || '';
      text = reason ? fitLine([reason + ' ' + cmp, reason + ' Best was ' + B + '.', reason, lean && lean + ' ' + cmp, lean && lean + ' Best was ' + B + '.',
        firstClause(reason) + ' Best was ' + B + '.', firstClause(reason), C.mv.san + ' is worse' + whose + ' than ' + B + '.'])
        : C.mv.san + ' is worse' + whose + ' than ' + B + '.';
    } else if (drop <= SOLVE_TOL) {
      cat = 'fine';
      text = C.mv.san + ' is about as good' + whose + ' as ' + B + '.';
    } else if (keeps) {
      cat = 'little';
      var edge = voice === 'you' ? 'your' : sideName(s) + '\'s';
      text = fitLine([C.mv.san + ' keeps most of ' + edge + ' advantage. ' + B + ' keeps more.', C.mv.san + ' keeps most of ' + edge + ' advantage.']);
    } else {
      cat = 'little';
      var rep = R[0] ? sanOf(C.st, uciToMove(C.st, R[0])) : '';
      text = fitLine([C.mv.san + ' is a little worse' + whose + ' than ' + B + '.' + (rep ? ' Best reply: ' + rep + ', the gold arrow.' : ''),
        C.mv.san + ' is a little worse' + whose + ' than ' + B + '.']);
    }
  }
  ex.say[at] = { text: text, cat: cat };
  track('explore_say_' + cat);
  return ex.say[at];
}
/* what the prompt line (phone) and the say line (desktop) show at a node:
   the same string, 80 characters at most */
function sayAt(a, ex, at) {
  var s = sayAt0(a, ex, at);
  return a.tier === 1 ? xpWords(a, ex, at, s) : s;
}
/* V2.5: tier 1's sentence in words: each move named in it, read on the
   position it was played from (the move on screen, the moves Stockfish
   gives at the position before and after it); a sentence left with
   notation in it says only where the move stands */
function xpWords(a, ex, at, s) {
  var map = {}, pov = myPov(a.it), add = function (st) {
    if (!st) return;
    legalMoves(st).forEach(function (m) { var sn = sanOf(st, m), x = { w: moveWords(st, m), p: pType(st.b[m.from]), mine: !!st.w === pov }; map[sn] = x; map[sn.replace(/[+#]$/, '')] = x; });
  };
  add(ex.nodes[at] && ex.nodes[at].st);
  if (at > 0) add(ex.nodes[at - 1].st);
  /* as Details says it (wordsWith: "their pawn takes your bishop", "their
     threat"), within the line's 80 characters: the later sentences go
     first, then all but the first clause */
  var o = {}, out = wordsWith(a, s, map, o);
  if (!o.left && out.length > LINE_MAX) {
    var parts = out.match(/[^.!?\u2026]+[.!?\u2026]+(?:\s+|$)/g) || [out];
    while (parts.length > 1 && parts.join('').trim().length > LINE_MAX) parts.pop();
    out = parts.join('').trim();
    if (out.length > LINE_MAX) out = firstClause(out);
  }
  if (o.left || out.length > LINE_MAX) {
    var n = ex.nodes[at], P = at > 0 ? ex.nodes[at - 1] : null, mv = n && n.mv && P ? uciToMove(P.st, n.mv.uci) : null;
    return mv ? upFirst(moveWords(P.st, mv)) + ' is played. ' + xpWho(a, true) + ' rates each move.' : xpWho(a, true) + ' rates each move.';
  }
  return out;
}
function sayAt0(a, ex, at) {
  var n = ex.nodes[at];
  if (ex.flash && !xpGameOver(n.st)) return ex.flash;
  if (xpGameOver(n.st)) {
    if (checkedKingSq(n.st) == null) return 'Stalemate. The game is a draw.';
    var winnerW = !n.st.w;
    return 'Checkmate. ' + (winnerW === myPov(a.it) ? 'You win.' : sideName(winnerW) + ' wins.');
  }
  if (xpSpoil(n)) return 'This is one of your own positions. ' + xpWho(a, true) + ' stays quiet so it can test you.';
  if (n.down) return xpWho(a, true) + ' is not answering right now. Try again, or go back to the lesson.';
  var P = at > 0 ? ex.nodes[at - 1] : null;
  if (at === 0 || (P && xpSpoil(P))) {
    var r = { lines: xpShown(ex, n) || [] }, who = n.st.w === myPov(a.it) ? 'Your move.' : sideName(n.st.w) + ' to move.';
    if (!r.lines[0]) return who + ' ' + xpWho(a, true) + ' is thinking…';
    var pick = sanOf(n.st, uciToMove(n.st, r.lines[0].pv[0]));
    /* the button under it says how to play it (Play Stockfish's pick) */
    return who + ' ' + xpWho(a, true) + '\'s pick is ' + pick + ', the gold arrow.';
  }
  /* always about the move on the board now, Stockfish's pick too (never the
     move before it); until its searches are in, only that it is thinking */
  var v = xpVerdict(a, ex, at), sh = xpShown(ex, n), lv = ex.res[n.key];
  if (v && v.cat === 'little' && sh && sh[0] && lv && lv.lines[0] && sh[0].pv[0] !== lv.lines[0].pv[0])
    return v.text.replace(/ Best reply: [^,]+, the gold arrow\./, '');
  return v ? v.text : n.mv.san + '. ' + xpWho(a, true) + ' is thinking…';
}

/* what a screen reader hears: the move before a kept sentence, and only the
   move while Stockfish thinks */
function xpLive(a, ex, at) {
  var s = sayAt(a, ex, at), n = ex.nodes[at];
  if (/ (Stockfish|The computer) is thinking…$/.test(s)) return s.replace(/ (Stockfish|The computer) is thinking…$/, '');
  if (ex.flash || at === 0 || !n.mv || xpSpoil(n) || s.indexOf(n.mv.san + ' ') === 0) return s;
  return n.mv.san + (checkedKingSq(n.st) != null ? ', check. ' : '. ') + s;
}
/* ── the rows: Stockfish's three best moves at the position on screen ───── */
function xpNum(st, i) {
  /* move number of the i-th move from st: "20." before a white move, "20…" for black */
  var ply = xpPly(st) + i, full = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? full + '.' : full + '…';
}
function xpRowWords(a, n, line, best) {
  var w = n.st.w, m0 = line.pv[0], t1 = a.tier === 1;
  var mateFor = line.mate != null ? (w ? line.mate : -line.mate) : null;
  if (mateFor != null && mateFor > 0) return 'mates in ' + mateFor;
  if (mateFor != null && mateFor < 0) return 'allows mate in ' + (-mateFor);
  /* a dead draw is a draw, whatever the winning chances would say */
  if (xpDrawn(n.st, line)) return 'a draw';
  var cpB = sideCp(best, w), cpL = sideCp(line, w), isBest = line === best || (winPct(cpB) - winPct(cpL) <= SOLVE_TOL && cpB - cpL < 100);
  var c = classifyMistake(n.st, m0, { pv: best.pv, mate: null }, { pv: line.pv.slice(1), mate: null }, winPct(cpB), winPct(cpL), xpPly(n.st));
  /* material as the card face counts it, on this row's own line */
  var cl = xpClaim(n.st, line.pv, cpL);
  /* the card's own answer, at the card's position, is never told as a loss
     (Details calls it the better move): what it wins, else where it stands */
  if (n.key === (a.preKey || posKey(a.pre)) && m0 === a.bestUci) return cl && cl.n > 0 ? 'wins ' + cl.w : CARD_COPY.X3(a, winPct(myPov(a.it) ? line.cp : -line.cp));
  if (isBest) {
    if (cl) return (cl.n > 0 ? 'wins ' : 'gives up ') + cl.w;
  } else {
    var g = c.gameLine, r1 = g && g.nodes[1], rSan = r1 && r1.move ? sanOf(r1.before, r1.move) : '', pn = c.allowed.skewer || c.allowed.pin;
    /* (tier 1 names no move: V2.5). B4: a fork only as their first reply, a
       pin or skewer within their first two moves, a stronger move missed
       only where it is 10 points stronger (a row a deeper search may rank
       first is no miss) */
    if (c.t === 'forkAllowed' && c.allowed.fork && c.allowed.fork.ply === 1) { var fm = g.nodes[c.allowed.fork.ply]; return t1 ? 'allows a fork' : 'allows a fork: ' + sanOf(fm.before, fm.move); }
    if (c.t === 'pinAllowed' && pn && pn.ply <= 2) return 'walks into a pin';
    if (c.t === 'discoveredAllowed') return 'allows a hidden attack';
    if (c.t === 'mateAllowed') return 'allows mate in ' + (c.mateAgainst || 2);
    /* only when what the line loses, counted where it settles, is that piece */
    if (['threat', 'hung', 'badTrade', 'material'].indexOf(c.t) !== -1 && r1 && r1.captured && cl && cl.n <= -1 && cl.w === 'the ' + PIECE_WORD[pType(r1.captured)])
      return t1 ? 'loses ' + cl.w : 'loses ' + cl.w + ' to ' + rSan;
    if (XP_MISSED.indexOf(c.t) !== -1 && winPct(cpB) - winPct(cpL) >= 10) { var bs = sanOf(n.st, uciToMove(n.st, best.pv[0])); return t1 ? 'misses a stronger move' : 'misses ' + bs; }
  }
  return CARD_COPY.X3(a, winPct(myPov(a.it) ? line.cp : -line.cp));
}
function xpRows(a, ex) {
  var n = xpCur(ex), shown = xpShown(ex, n);
  if (!shown || !shown.length || xpSpoil(n) || xpGameOver(n.st)) return null;
  var tier = a.tier || 2, me = myPov(a.it), touch = window.innerWidth <= 860;
  var lines = shown.slice(0, 3), idx = [0, 1, 2].filter(function (i) { return lines[i]; }), ws = null;
  if (tier === 1) {
    /* the best, then the line that teaches something different, a tactic
       before a plain standing, never the same words twice */
    ws = lines.map(function (l) { return xpRowWords(a, n, l, lines[0]); });
    var tac = /^(allows a fork|walks into a pin|allows a hidden attack|allows mate|loses the|misses )/;
    var two = [1, 2].filter(function (i) { return lines[i] && tac.test(ws[i]); })[0];
    if (two == null) two = lines[1] ? 1 : -1;
    if (two > 0 && ws[two] === ws[0]) {
      var alt = [1, 2].filter(function (i) { return lines[i] && i !== two && ws[i] !== ws[0]; })[0];
      if (alt != null) two = alt;
    }
    idx = two > 0 ? [0, two] : [0];
    /* a third, last, where a phone has the room for it (fitRows) */
    [1, 2].forEach(function (i) { if (lines[i] && idx.indexOf(i) < 0) idx.push(i); });
  }
  return idx.map(function (li) {
    var l = lines[li];
    var sans = playUci(n.st, l.pv.slice(0, 8)).san;
    var first = sans[0] || l.pv[0];
    var row = { uci: l.pv[0], first: first, num: xpNum(n.st, 0), li: li };
    if (tier === 1) {
      /* V2.5: tier 1's rows in words, no notation */
      var m0 = uciToMove(n.st, l.pv[0]);
      if (m0) row.first = upFirst(moveWords(n.st, m0));
      row.words = ws[li];
      row.label = row.first + ', ' + row.words + '.';
      return row;
    }
    var myMate = l.mate != null ? (me ? l.mate : -l.mate) : null, drawn = myMate == null && xpDrawn(n.st, l);
    row.chip = myMate != null ? (myMate > 0 ? 'You mate in ' + myMate : 'They mate in ' + (-myMate))
      : drawn ? 'A draw' : 'You ' + Math.max(1, Math.min(99, Math.round(winPct(me ? l.cp : -l.cp)))) + '%';
    var plies = tier === 3 ? (touch ? 4 : 6) : 2, cont = [];
    for (var k = 1; k <= plies && k < sans.length; k++) cont.push(((xpPly(n.st) + k) % 2 === 0 ? xpNum(n.st, k) : '') + sans[k]);
    row.cont = cont.join(' ');
    /* a figure that is no number is left out (progVal) */
    if (progVal(row.chip)) row.chip = '';
    /* its name starts with the words it shows, in their order (WCAG 2.5.3):
       "You 50%, 35.Qe6, then b5 36.b3." */
    row.label = (row.chip ? row.chip + ', ' : '') + row.num + first + (row.cont ? ', then ' + row.cont : '') + '.';
    return row;
  });
}
