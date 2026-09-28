// node test/explain.js > test/explanations.txt
// The pattern and both sentences for every sample mistake. Commit the output: after a change to the
// classifier, `git diff test/explanations.txt` shows exactly which explanations changed.
const fs = require('fs'), path = require('path');
const C = require('./chess');
fs.readFileSync(path.join(__dirname, 'data', 'mistakes.ndjson'), 'utf8').trim().split('\n').map(JSON.parse).forEach((r, i) => {
  const c = C.classifyMistake(C.stateFromFen(r.fen), r.played, { pv: r.best.pv, mate: r.best.mate },
    r.refutation ? { pv: r.refutation.pv, mate: r.refutation.mate == null ? null : -r.refutation.mate } : { pv: [], mate: null },
    r.wb, r.wa, r.ply);
  console.log(`#${i} ${c.t}\n  your move: ${c.sentences.game}\n  best move: ${c.sentences.best}`);
});
