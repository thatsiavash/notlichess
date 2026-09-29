// npm run explain   (writes test/explanations.txt and test/data/classify-stamp.json)
// The pattern and both sentences for every sample mistake. Commit the output: after a change to the
// classifier, `git diff test/explanations.txt` shows exactly which explanations changed.
// Stored cards are renamed only when CLASSIFY_V (src/js/06-ingest.js) goes up, so a change to this
// text without a version bump is refused here, and test/run.js fails when the snapshot is stale.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('./chess');
function explanations() {
  return fs.readFileSync(path.join(__dirname, 'data', 'mistakes.ndjson'), 'utf8').trim().split('\n').map(JSON.parse).map((r, i) => {
    const c = C.classifyMistake(C.stateFromFen(r.fen), r.played, { pv: r.best.pv, mate: r.best.mate },
      r.refutation ? { pv: r.refutation.pv, mate: r.refutation.mate == null ? null : -r.refutation.mate } : { pv: [], mate: null },
      r.wb, r.wa, r.ply);
    return `#${i} ${c.t}\n  your move: ${c.sentences.game}\n  best move: ${c.sentences.best}`;
  }).join('\n') + '\n';
}
function classifyVersion() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', '06-ingest.js'), 'utf8');
  return +(/var CLASSIFY_V = (\d+)/.exec(src) || [])[1];
}
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
module.exports = { explanations, classifyVersion, hash };
if (require.main === module) {
  const text = explanations(), v = classifyVersion();
  const stampFile = path.join(__dirname, 'data', 'classify-stamp.json');
  const old = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : null;
  if (old && old.hash !== hash(text) && old.v === v) {
    console.error('The explanations changed but CLASSIFY_V is still ' + v + '. Bump it in src/js/06-ingest.js, then run npm run explain again.');
    process.exit(1);
  }
  fs.writeFileSync(path.join(__dirname, 'explanations.txt'), text);
  fs.writeFileSync(stampFile, JSON.stringify({ v, hash: hash(text) }) + '\n');
  console.log('explanations: ' + text.split('\n#').length + ' written, classifier version ' + v);
}
