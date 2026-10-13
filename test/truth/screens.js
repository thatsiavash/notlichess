// The truth audit's practice pass: every lesson (its three frames, then its own position) and every
// practice position with every legal move a player can make there (its verdict, its reason, See it, the
// close move, the found and shown words, Details), at tiers 1 to 3, in the Node realm (boot.js; practice
// claims read stored facts, never a live search, so no engine runs). Also the screens around them as
// lines of text (Today, the summary, Insights with How we count, the skill tiles and sheets) for the
// summary's recount. Writes <out>/dump-practice.jsonl and <out>/pdata.json (each position's skill and
// board, from the page's own PRAC_DATA).
//   node test/truth/screens.js --out DIR [--root DIR] [--ids id1,id2]
const fs = require('fs'), path = require('path');
const R = require('./boot');
const WALK = require('./walker');
const o = R.args(process.argv.slice(2));
const ids0 = typeof o.ids === 'string' ? o.ids.split(',').filter(Boolean) : null;

(async () => {
  if (!o.out) throw new Error('--out DIR is required');
  const A = await R.boot({ root: o.root, out: o.out, workers: 0, storage: { 'nl:games:cc:tester': fs.readFileSync(path.join(o.out, 'enriched.json'), 'utf8') } });
  A.ev(WALK);
  const ev0 = A.ev; A.ev = (code) => ev0('var TA = window.TA; ' + code);
  A.ev("SF.state = 'ready'; 1");
  const out = fs.createWriteStream(path.join(o.out, 'dump-practice.jsonl'));
  const flushOut = () => { const recs = JSON.parse(A.ev('JSON.stringify(window.__out.splice(0))')); recs.forEach((r) => out.write(JSON.stringify(Object.assign({ pass: 'screens' }, r)) + '\n')); return recs.length; };
  const pdata = JSON.parse(A.ev(`JSON.stringify((function () { var o = {}; PRAC_DATA.forEach(function (r) { var f = r.split('|'); o[f[0]] = { skill: f[1], source: f[2], fen: f[4], accepted: f[5] ? f[5].split(',') : [], close: f[6] ? f[6].split(',') : [], row: r }; }); return o; })())`));
  fs.writeFileSync(path.join(o.out, 'pdata.json'), JSON.stringify(pdata) + '\n');
  A.ev(`TA.screen = function (tier, where, h, x) { window.__out.push({ tier: tier, key: null, frame: 'screen ' + where, lines: TA.txt(h), x: x || null }); };
  TA.box = { innerHTML: '', dataset: {}, style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
  TA.el0 = el; el = function (id) { return id === 'insightsbox' ? TA.box : TA.el0(id); }; 1`);
  const walk = { skipped: [] };
  for (const tier of [1, 2, 3]) {
    /* the screens around practice, as text (the summary's recount reads their numbers) */
    if (!ids0) {
      A.ev(`(function () {
        TA.setTier(${tier}); var tier = ${tier};
        ui.session = null;
        TA.screen(tier, 'today', heroHtml() + whyTheseHtml(todayPlan()) + cleanLineHtml() + focusHtml() + nextDueHtml());
        /* (release 2 slice D: the games list left Today for a tab of its own) */
        var ks = allMistakes().filter(trainable).slice(0, 5).map(function (x) { return x.key; });
        var res = ['first', 'retry', 'hint', 'fail', 'skip'], ss = { mode: 'today', label: 'Today', keys: ks, idx: ks.length, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true };
        ks.forEach(function (k, i) { ss.results[k] = res[i]; });
        ss.notes[ks[3]] = 'shown';
        TA.screen(tier, 'summary', doneHtml(ss), { keys: ks });
        TA.screen(tier, 'summary diag', diagHtml({ dx: { k: 'line' } }, tier) + diagHtml({ dx: { k: 'card', full: true, cov: coverage() } }, tier) + diagHtml({ dx: { k: 'card', full: false, cov: coverage() } }, tier), { cov: coverage() });
        ui.view = 'insights'; TA.box.innerHTML = '';
        renderInsights();
        TA.screen(tier, 'insights', TA.box.innerHTML, { decided: tier >= 3 ? decidedReport() : null, cov: coverage() });
        TA.screen(tier, 'how we count', sheetHtml('count'));
        ui.view = 'train';
        if (tier <= 2) {
          TA.screen(tier, 'skill tiles', skillTilesHtml());
          PSKILL.forEach(function (sk) { TA.screen(tier, 'skill sheet ' + sk.k, skillSheetHtml(sk.k)); });
          if (typeof focusSkillHtml === 'function') TA.screen(tier, 'today focus', focusSkillHtml('safety') + focusSkillHtml('king') + focusSkillHtml('chances') + packOfferHtml());
          else TA.screen(tier, 'today focus', packOfferHtml());
        }
        return 1; })()`);
      flushOut();
    }
    A.ev(`(function () { TA.setTier(${tier}); ui.session = null; return 1; })()`);
    /* lessons: three frames each, then its own position */
    A.ev(`(function () {
      PSKILL.forEach(function (sk) {
        var keys = ['ls:' + sk.k, 'pk:' + sk.tryId];
        ui.session = { mode: 'pack', label: sk.name, keys: keys, idx: 0, results: {}, relearn: [], relearnOf: {}, spec: { type: 'pack', k: sk.k } };
        var a = cardFor(itemOf(keys[0]));
        ui.session.active = a;
        for (var i = 0; i < 3; i++) { a.lesson.i = i; a.animMove = null; var r = TA.snap(a, 'lesson ' + sk.k + ' ' + i); r.key = 'ls:' + sk.k; }
        ui.session.idx = 1;
        var b = cardFor(itemOf(keys[1]));
        b.lessonTry = lessonTryOf(ui.session, keys[1]);
        ui.session.active = b;
        TA.snap(b, 'lesson try open');
        b.tapped = true; gradeMove(uciToMove(b.st, b.bestUci)); b.animMove = null; b.settle = 2; TA.snap(b, 'lesson try settled');
      });
      return 1; })()`);
    flushOut();
    /* practice positions: every legal move */
    const ids = Object.keys(pdata).filter((id) => !ids0 || ids0.indexOf(id) >= 0);
    for (const id of ids) {
      const ok = A.ev(`(function () {
        var key = 'pk:' + ${JSON.stringify(id)}, it = itemOf(key);
        if (!it) return 0;
        var a = TA.open(key);
        TA.snap(a, 'prac open');
        a.hints = 1; TA.snap(a, 'prac hint 1'); a.hints = 2; TA.snap(a, 'prac hint 2');
        if (hintMax(a) === 3) { a.hints = 3; TA.snap(a, 'prac hint 3'); }
        legalMoves(stateFromFen(it.fen)).forEach(function (m) {
          var u = moveUci(m);
          a = TA.open(key); a.tapped = true; gradeMove(uciToMove(a.st, u)); a.animMove = null;
          if (a.phase === 'tried') {
            a.reason = 2; TA.snap(a, 'prac ' + a.tried.kind + ' ' + u, { u: u });
            if (a.tried.kind === 'miss' && a.tried.reply) { seeIt(); a.animMove = null; TA.snap(a, 'prac miss See it ' + u, { u: u }); }
          } else if (a.phase === 'done') { a.settle = 2; TA.snap(a, 'prac found ' + u, { u: u }); var r = TA.snap(a, 'prac found Details ' + u, { u: u }); r.details = TA.txt(detailsHtml()); }
        });
        a = TA.open(key); reveal(); a.animMove = null; TA.snap(a, 'prac shown'); playIt(false); a.animMove = null; a.settle = 2; TA.snap(a, 'prac shown, settled');
        return 1; })()`);
      if (ok === 1) (walk[tier] = walk[tier] || []).push(id); else walk.skipped.push(tier + ' ' + id);
      flushOut();
    }
    console.log('tier', tier, 'done', ids.length, 'positions');
  }
  flushOut();
  /* what the walk reached, for the summary's check that no position was left out */
  fs.writeFileSync(path.join(o.out, 'dump-practice.walk.json'), JSON.stringify(walk) + '\n');
  out.end(() => { R.quit(); process.exit(0); });
})().catch((e) => { console.error(e); R.quit(); process.exit(1); });
