// Realm-side helpers for the truth audit's dump: open a card at a tier, snapshot a frame as data
// (every string on its face, the board it is said on, its marks and the moves it is about).
module.exports = `
window.__out = window.__out || [];
var TA = window.TA = {};
TA.sq = function (s) { return s == null || s < 0 ? null : sqName(s); };
TA.mv = function (m) { return m ? moveUci(m) : null; };
TA.marks = function (o) {
  var out = {}, S = TA.sq;
  if (!o) return out;
  if (o.bad) out.bad = [S(o.bad[0]), S(o.bad[1])];
  if (o.good) out.good = [S(o.good[0]), S(o.good[1])];
  if (o.ghost) out.ghost = [S(o.ghost[0]), S(o.ghost[1])];
  if (o.hint != null) out.hint = S(o.hint);
  ['rings', 'tokens', 'tints', 'badges', 'ghosts', 'tried'].forEach(function (k) {
    if (o[k] && o[k].length) out[k] = o[k].map(function (r) { return { sq: S(r.sq != null ? r.sq : r.to), kind: r.kind || null, p: r.p || null, mate: !!r.mate, ok: !!r.ok, could: !!r.could }; });
  });
  ['arrows', 'guards'].forEach(function (k) {
    if (o[k] && o[k].length) out[k] = o[k].map(function (r) { return { from: S(r.from), to: S(r.to), kind: r.kind || null, key: r.key || null }; });
  });
  return out;
};
TA.lineOf = function (line) {
  if (!line || !line.nodes) return null;
  return { start: stateFen(line.nodes[0].before), moves: line.nodes.map(function (n) { return n.move ? moveUci(n.move) : '0000'; }) };
};
TA.label = function (a, f, seen) {
  var lb = null;
  try { lb = frameLabel(a, f, 384, false, seen ? function () { return true; } : function () { return false; }); } catch (e) { return { err: String(e) }; }
  if (!lb) return null;
  var mk = lb.mark || {};
  return { text: lb.text, role: lb.role, tip: lb.tip || null, mark: { kind: mk.kind, key: mk.key || null, sq: TA.sq(mk.sq), from: TA.sq(mk.from), to: TA.sq(mk.to), p: mk.p || null } };
};
TA.txt = function (h) {
  return String(h || '').replace(/<label class="kb-move[^"]*">[\\s\\S]*?<\\/label>/g, ' ').replace(/<input[^>]*>/g, ' ').replace(/<span class="sr-only">[^<]*<\\/span>/g, '')
    .replace(/<[^>]+>/g, '\\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\\n').map(function (x) { return x.replace(/\\s+/g, ' ').trim(); }).filter(Boolean);
};
/* a lesson frame's next move (the move its gold ring asks for) */
TA.lessonMove = function (a) {
  try { var fr = PSKILL_OF[a.lesson.k].lesson.frames; for (var j = a.lesson.i + 1; j < fr.length; j++) if (fr[j].move) return fr[j].move; } catch (e) {}
  return null;
};
/* one frame of card a, as data */
TA.snap = function (a, frame, extra) {
  var d = null, f = null, err = null;
  try { d = displayFor(a); } catch (e) { err = 'displayFor: ' + e; }
  try { f = boardOptsFor(a); } catch (e) { err = (err || '') + ' boardOptsFor: ' + e; }
  var rec = {
    tier: a.tier, key: a.key, frame: frame, phase: a.phase, err: err,
    row1: d ? d.row1 : '', row2: d ? d.row2 : '', cap: d ? d.cap : '', chip: d ? d.chip : '', tag: d ? d.tag : '', src: d ? d.src : '',
    buttons: d ? d.buttons.map(function (b) { return b.label; }) : [], strip: d ? TA.txt(d.strip).join(' ') : '', live: d ? d.live : '',
    label0: f ? TA.label(a, f, false) : null, label1: f ? TA.label(a, f, true) : null,
    aria: f && f.opts ? f.opts.label || '' : '', shown: f && f.st ? stateFen(f.st) : null, marks: f ? TA.marks(f.opts) : {},
    ctx: {
      pre: a.pre ? stateFen(a.pre) : null, st: a.st ? stateFen(a.st) : null, white: a.it && a.it.g ? a.it.g.color === 'white' : null,
      played: a.playedUci || null, best: a.bestUci || null, sol: a.sol || null, solIdx: a.solIdx || 0,
      hints: a.hints, misses: a.misses, game: !!a.game, foil: !!a.foil, prac: !!a.prac, revealed: !!a.revealed, alt: a.alt ? { win: a.alt.win, best: a.alt.best } : null,
      yours: a.yours ? a.yours.uci : null, yoursAt: a.yours ? a.yours.at || 0 : null, near: a.near ? { win: a.near.win, best: a.near.best, deep: !!a.near.deep } : null, own: !!a.own, slips: a.slips || 0, slipSan: a.slipSan || '',
      view: a.view ? { mode: a.view.mode, i: a.view.i } : null, settle: a.settle || 0,
      tried: a.tried ? { uci: a.tried.uci, kind: a.tried.kind, reply: a.tried.reply, seen: !!a.tried.seen, chip: a.tried.chip || '' } : null,
      guess: a.guess ? { uci: a.guess.uci || null, v: a.guess.v || null, skip: !!a.guess.skip, san: a.guess.san || null } : null,
      lastMove: a.lastMove ? [TA.sq(a.lastMove[0]), TA.sq(a.lastMove[1])] : null,
      lessonMove: TA.lessonMove(a)
    }
  };
  if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    try {
      var S = buildStory(a), s = S.steps[a.view.i], n = s.line.nodes[s.k];
      rec.step = { i: a.view.i, n: S.steps.length, seg: s.seg, k: s.k, from: s.from, df: s.df ? { cap: s.df.cap } : null, could: S.could, real: S.real, mateG: S.mateG, mateB: S.mateB, alt: S.alt, g: S.g,
                   line: TA.lineOf(s.line), before: n.before ? stateFen(n.before) : null, move: n.move ? moveUci(n.move) : null, after: n.after ? stateFen(n.after) : null };
    } catch (e) { rec.step = { err: String(e) }; }
  }
  if (extra) rec.x = extra;
  window.__out.push(rec);
  return rec;
};
/* the card as a one-card set opens it, at a tier (the help level in Settings, as F9.1 sets it) */
TA.setTier = function (tier) { store.set(helpKey(), HELP[tier - 1]); modelDirty(); };
TA.open = function (key) {
  var it = itemOf(key);
  if (!it) return null;
  ui.session = { mode: 't', label: 't', keys: [key], idx: 0, results: {}, relearn: [], relearnOf: {}, notes: {} };
  var a = cardFor(it);
  if (!a) return null;
  ui.session.active = a;
  a.shownAt = Date.now() - 5000;
  return a;
};
/* a game-mode review: its record a run of one clean find, due (as labels.test.js's eachGameFrame) */
TA.gameRec = function (key) {
  var m = srsLoad();
  TA.srs0 = TA.srs0 || {};
  if (!(key in TA.srs0)) TA.srs0[key] = m[key] ? JSON.stringify(m[key]) : null;
  m[key] = { box: 2, streak: 1, due: Date.now() - 3600e3, last: Date.now() - 7 * DAY, ls: Date.now() - 7 * DAY, lapses: 0 };
  store.set(srsKey(), m); srsMem = null; srsRevision++;
};
TA.ungame = function (key) {
  var m = srsLoad(), was = TA.srs0 && TA.srs0[key];
  if (was) m[key] = JSON.parse(was); else delete m[key];
  store.set(srsKey(), m); srsMem = null; srsRevision++;
  if (TA.srs0) delete TA.srs0[key];
};
TA.clearSrs = function () { store.set(srsKey(), {}); srsMem = null; srsRevision++; };
1;
`;
