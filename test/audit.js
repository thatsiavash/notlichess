// node test/audit.js [--list]
// Re-runs the mistake classifier on 301 real cards that a strong player graded against Stockfish 17 at 2M nodes
// (test/data/audited.ndjson: name OK = exact, ACC = defensible, WRONG = wrong, NA = not a mistake). It reports
// how often a name graded exact is kept, and how often a name graded wrong is now different. --list prints each
// changed card with the grader's note, so a person can judge the new wording.
const fs = require('fs'), path = require('path');
const C = require('./chess');
const rows = fs.readFileSync(path.join(__dirname, 'data', 'audited.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
const list = process.argv.indexOf('--list') !== -1;
const plyOf = (fen) => { const f = fen.split(' '); return (parseInt(f[5], 10) - 1) * 2 + (f[1] === 'b' ? 1 : 0); };

const tally = { OK: [0, 0], ACC: [0, 0], WRONG: [0, 0], NA: [0, 0] };
const changes = [];
for (const r of rows) {
  const pre = C.stateFromFen(r.fen);
  const c = C.classifyMistake(pre, r.played, { pv: r.bestLine, mate: r.mb }, { pv: r.refutation, mate: r.ma }, r.wb, r.wa, r.ply != null ? r.ply : plyOf(r.fen));
  const same = c.t === r.shownPattern;
  tally[r.name][0]++;
  if (same) tally[r.name][1]++;
  if (!same || list === 'all') changes.push({ r, c });
}
const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '-';
console.log('graded exact, name kept:      ' + tally.OK[1] + ' of ' + tally.OK[0] + ' (' + pct(tally.OK[1], tally.OK[0]) + ')');
console.log('graded defensible, name kept: ' + tally.ACC[1] + ' of ' + tally.ACC[0] + ' (' + pct(tally.ACC[1], tally.ACC[0]) + ')');
console.log('graded wrong, name changed:   ' + (tally.WRONG[0] - tally.WRONG[1]) + ' of ' + tally.WRONG[0] + ' (' + pct(tally.WRONG[0] - tally.WRONG[1], tally.WRONG[0]) + ')');
/* --assert: a regression guard at today's floors (graded exact kept 183 of 193, defensible kept 52 of 67,
   wrong names changed 14 of 36); raise the floors as the classifier improves, never lower them */
if (process.argv.indexOf('--assert') !== -1) {
  const floors = { OK: 183, ACC: 52, WRONGchanged: 14 };
  const bad = [];
  if (tally.OK[1] < floors.OK) bad.push('exact kept ' + tally.OK[1] + ' < ' + floors.OK);
  if (tally.ACC[1] < floors.ACC) bad.push('defensible kept ' + tally.ACC[1] + ' < ' + floors.ACC);
  if (tally.WRONG[0] - tally.WRONG[1] < floors.WRONGchanged) bad.push('wrong changed ' + (tally.WRONG[0] - tally.WRONG[1]) + ' < ' + floors.WRONGchanged);
  /* every changed name that a person had graded exact carries a verdict */
  const verdicts = fs.readFileSync(path.join(__dirname, 'data', 'exact-changes.md'), 'utf8');
  changes.filter(({ r }) => r.name === 'OK').forEach(({ r, c }) => {
    if (verdicts.indexOf(r.fen + ' | ' + r.played + ' | ' + r.shownPattern + ' -> ' + c.t + ' |') === -1) bad.push('no verdict for ' + r.fen + ' ' + r.played + ' (' + r.shownPattern + ' -> ' + c.t + ')');
  });
  console.log((bad.length ? 'FAIL ' : 'ok   ') + 'graded names: ' + (bad.length ? bad.join(', ') : 'at or above the floors'));
  if (bad.length) process.exit(1);
}
if (list) {
  for (const { r, c } of changes) {
    console.log('\n[' + r.name + '] ' + r.shownPattern + ' -> ' + c.t + '   ' + r.fen + '  played ' + r.playedSan);
    console.log('  grader: ' + r.note);
    console.log('  was:    ' + r.shownGame + ' / ' + r.shownBestS);
    console.log('  now:    ' + c.sentences.game + ' / ' + c.sentences.best);
  }
}
