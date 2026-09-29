// node test/run.js: the chess core against its references. Exits non-zero on any failure.
//   1. SAN: every move of the sample games written the way python-chess writes it
//   2. motifs: the tactic tags agree with lichess-puzzler's tagger (cook.py) on real mistakes
//   3. explanations: every sample mistake gets a pattern and a sentence (see explain.js for the text)
const fs = require('fs'), path = require('path');
const C = require('./chess');
const data = f => fs.readFileSync(path.join(__dirname, 'data', f), 'utf8').trim().split('\n').map(JSON.parse);
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : '')); if (!ok) failed++; };

/* 1. SAN */
let moves = 0, sanBad = [];
for (const g of data('games.ndjson')) {
  let st = C.stateFromFen(g.start);
  for (let i = 0; i < g.uci.length; i++) {
    const m = C.uciToMove(st, g.uci[i]);
    if (!m) { sanBad.push('illegal ' + g.uci[i]); break; }
    const san = C.sanOf(st, m);
    if (san !== g.san[i]) sanBad.push(san + ' vs ' + g.san[i]);
    moves++;
    C.applyMove(st, m);
  }
}
check('SAN', !sanBad.length, moves + ' moves' + (sanBad.length ? ', first mismatch ' + sanBad[0] : ''));

/* 2. motifs vs the lichess tagger */
const fx = data('mistakes.ndjson'), oracle = data('tagger-oracle.ndjson');
const TAGS = ['hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'trappedPiece', 'promotion', 'mate', 'backRankMate', 'advancedPawn', 'capturingDefender'];
const dis = [];
fx.forEach((r, i) => {
  const st = C.stateFromFen(r.fen);
  const sides = [];
  if (r.refutation && r.refutation.pv.length) sides.push(['allowed', C.buildLine(st, r.played, r.refutation.pv.slice(0, 8), !st.w)]);
  if (r.best && r.best.pv.length) sides.push(['missed', C.buildLine(st, '0000', r.best.pv.slice(0, 8), st.w)]);
  sides.forEach(([side, line]) => {
    if (!line) return;
    const mine = C.lineMotifs(line), theirs = new Set(oracle[i][side] || []);
    TAGS.forEach(t => { if (!!mine[t] !== theirs.has(t)) dis.push('#' + i + ' ' + side + ' ' + t); });
  });
});
check('motifs vs lichess tagger', !dis.length, fx.length + ' mistakes' + (dis.length ? ', ' + dis.length + ' disagreements, first ' + dis[0] : ''));

/* 3. every mistake is explained */
let empty = [], long = [];
fx.forEach((r, i) => {
  const c = C.classifyMistake(C.stateFromFen(r.fen), r.played, { pv: r.best.pv, mate: r.best.mate },
    r.refutation ? { pv: r.refutation.pv, mate: r.refutation.mate == null ? null : -r.refutation.mate } : { pv: [], mate: null },
    r.wb, r.wa, r.ply);
  if (!c.t || !c.sentences.game) empty.push('#' + i);
  /* the short form fits a phone's two-line prompt (about 84 characters) */
  if ((c.sentences.short || '').length > 84 || /\u2014/.test(c.sentences.game + c.sentences.best)) long.push('#' + i + ' ' + c.sentences.short);
});
check('explanations', !empty.length, fx.length + ' mistakes' + (empty.length ? ', missing: ' + empty.slice(0, 5).join(' ') : ''));
check('short sentences fit a phone', !long.length, long.length ? long.length + ' too long, first ' + long[0] : 'all 84 characters or fewer');
/* 4. the committed snapshot matches the classifier, and was stamped with its version */
const X = require('./explain');
const snap = fs.readFileSync(path.join(__dirname, 'explanations.txt'), 'utf8'), now = X.explanations();
const stamp = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'classify-stamp.json'), 'utf8'));
check('explanation snapshot is current', snap === now, snap === now ? 'unchanged' : 'run npm run explain (and bump CLASSIFY_V if it refuses)');
check('snapshot stamped with the classifier version', stamp.v === X.classifyVersion() && stamp.hash === X.hash(snap), 'stamp v' + stamp.v + ', code v' + X.classifyVersion());
process.exit(failed ? 1 : 0);
