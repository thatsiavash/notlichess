// The truth audit's fixture: the checkout's fixture player (test/data/fixture-games.json) with every
// card's fact sheet (test/data/facts-fixture.json, made by test/truth/facts.js) applied as the page
// applies a stored key, saved as the page stores it to <out>/enriched.json (both card passes read it:
// with the engine down only keyed cards are dealt). Writes <out>/prep.json: the keys applied, any key
// the build no longer reads (a FACTS_V change: rerun node test/truth/facts.js), the cards set aside,
// and Today's first set (the cards the summary must find no misleading claim on).
//   node test/truth/prep.js --out DIR [--root DIR]
const fs = require('fs'), path = require('path');
const R = require('./boot');

(async () => {
  const o = R.args(process.argv.slice(2));
  if (!o.out) throw new Error('--out DIR is required');
  const FIX = JSON.parse(fs.readFileSync(path.join(o.root, 'test', 'data', 'fixture-games.json'), 'utf8'));
  const ff = path.join(o.root, 'test', 'data', 'facts-fixture.json');
  if (!fs.existsSync(ff)) throw new Error('no ' + ff + ': the card passes need the fixture\'s fact sheets (node test/truth/facts.js)');
  const F = JSON.parse(fs.readFileSync(ff, 'utf8'));
  let n = 0;
  FIX.games.forEach((g) => (g.bl || []).forEach((b) => { const k = F.cards[g.id + ':' + b.p]; if (k) { b.k = k; n++; } }));
  const A = await R.boot({ root: o.root, out: o.out, workers: 0, engine: false, storage: { 'nl:games:cc:tester': JSON.stringify(FIX) } });
  A.ev('model(); flushSave(); 1');
  fs.writeFileSync(path.join(o.out, 'enriched.json'), A.storage['nl:games:cc:tester']);
  const info = JSON.parse(A.ev(`JSON.stringify({
    factsV: typeof FACTS_V === 'undefined' ? null : FACTS_V,
    cards: allMistakes().length,
    trainable: allMistakes().filter(trainable).map(function (it) { return it.key; }),
    stale: allMistakes().filter(function (it) { return it.b.k && !factsOf(it.b); }).map(function (it) { return it.key; }),
    unkeyed: allMistakes().filter(function (it) { return trainable(it) && !it.b.k; }).map(function (it) { return it.key; }),
    x: [].concat.apply([], data.games.map(function (g) { return (g.bl || []).filter(function (b) { return b.x; }).map(function (b) { return g.id + ':' + b.p + ':' + b.x; }); })),
    foils: foilPool().map(function (f) { return f.key; })
  })`));
  /* Today's first set: the planner's own answer for the fixture player's first visit, engine up and down */
  A.ev("window.__sf0 = SF.state; SF.state = 'ready'; 1");
  const today = new Set(JSON.parse(A.ev('JSON.stringify(todayPlan().keys)')));
  A.ev("SF.state = 'failed'; if (window.__dealable) dealable = window.__dealable; 1");
  JSON.parse(A.ev('JSON.stringify(todayPlan().keys)')).forEach((k) => today.add(k));
  info.today = [...today];
  info.keys = n;
  fs.writeFileSync(path.join(o.out, 'prep.json'), JSON.stringify(info, null, 1) + '\n');
  console.log('keys applied', n, 'cards', info.cards, 'trainable', info.trainable.length, 'set aside', info.x.length,
    'stale keys', info.stale.length, 'unkeyed', info.unkeyed.length, 'foils', info.foils.length, 'Today', info.today.join(' '));
  if (info.stale.length) { console.error('stale fact sheets (FACTS_V ' + info.factsV + '): rerun node test/truth/facts.js in the checkout'); process.exit(2); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
