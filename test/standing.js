// Where you stand (release 3 slice F), run from cardflow.test.js on the built page in Node (test/app-realm.js):
// require('./standing')(h) returns its tests as [name, fn] pairs, h holding cardflow.test.js's boot (the engine
// stub), eq, ok, OPEN, TRY and DOM.
//   Material, lichess style: each side's lead in pieces from the position on screen, "+N" beside the side ahead,
//   said once in the board's name. The step track (step-tracker.md): two pips and a seal, before an answer the
//   record's rungs and at the last step the pill "Last step" (within the 15 words, else the seal pulses), a find
//   fills the next pip on the text beat after the land, a miss empties it; the learned moment on the find that
//   makes a position learned; Today's count of positions one find from learned; the summary's steps up.
const CARD1 = '184455333378:68';

module.exports = function (h) {
  const { boot, eq, ok, OPEN, TRY, DOM } = h;
  const T = [];
  const test = (name, fn) => T.push([name, fn]);
  /* a record at a rung, due now: rung 1 a week after its first clean find, rung 2 sixteen days and more after
     its second (the find that makes it learned is due) */
  const REC = `function atRung(key, rung) {
    var m = srsLoad(), now = Date.now(), disk = store.get(srsKey(), {});
    /* written as it is: srsSave keeps whichever record changed last */
    delete disk[key]; store.set(srsKey(), disk);
    m[key] = rung === 2 ? { box: 3, streak: 2, due: now - 3600e3, last: now - 17 * DAY, ls: now - 17 * DAY, rs: now - 25 * DAY, lapses: 0, n: 2 }
      : { box: 2, streak: 1, due: now - 3600e3, last: now - 7 * DAY, ls: now - 7 * DAY, rs: now - 7 * DAY, lapses: 0, n: 1 };
    srsSave(m);
  }`;

  test('release 3, F1: material from the position on screen, lichess style: by type the pieces each side took beyond what it lost, in the other side\'s colour, "+N" beside the side ahead, a promotion counted as what stands; the board\'s name says it once, from the solver\'s side', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () {
      var st = stateFromFen('4k3/pppp4/8/8/8/8/PPP5/4K2N w - - 0 1'), m = materialOf(st.b), start = stateFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      var promo = materialOf(stateFromFen('4k3/8/8/8/8/8/1P6/Q2QK3 w - - 0 1').b);
      return JSON.stringify({ score: m.score, w: m.up.w, b: m.up.b, wHtml: matSideHtml(m, true), bHtml: matSideHtml(m, false), sayW: materialSay(st, true), sayB: materialSay(st, false),
        start: matSideHtml(materialOf(start.b), true) + matSideHtml(materialOf(start.b), false), startSay: materialSay(start, true), promo: promo }); })()`));
    eq(r.score, 2, 'a knight against a pawn: 2 points');
    eq(JSON.stringify([r.w, r.b]), JSON.stringify([[{ t: 'N', n: 1 }], [{ t: 'P', n: 1 }]]), 'each side\'s lead by type');
    ok(/#pc-bN/.test(r.wHtml) && /<span class="mat-n">\+2<\/span>/.test(r.wHtml), 'White\'s strip: the black knight taken, then +2: ' + r.wHtml);
    ok(/#pc-wP/.test(r.bHtml) && !/mat-n/.test(r.bHtml), 'Black\'s strip: the white pawn taken, no number: ' + r.bHtml);
    eq(r.sayW, 'Material: you are 2 up.', 'said from the solver\'s side');
    eq(r.sayB, 'Material: they are 2 up.', 'and from the other');
    eq(r.start + '|' + r.startSay, '|', 'level: nothing drawn, nothing said');
    eq(JSON.stringify(r.promo.up.w), JSON.stringify([{ t: 'Q', n: 2 }, { t: 'P', n: 1 }]), 'two queens and a pawn against a bare king: what stands');
    /* the card's board: its name says it once */
    const said = A.ev(`(function () { ${OPEN} var a = openCard(model().byKey['${CARD1}']), f = boardOptsFor(a); return f.opts.label.split('Material:').length - 1 + '|' + materialSay(f.st, myPov(a.it)); })()`);
    ok(/^[01]\|/.test(said) && (said.split('|')[1] === '' ? said[0] === '0' : said[0] === '1'), 'the board\'s name says the material once, when it is not level: ' + said);
  });

  test('release 3, step-tracker.md: the track is two pips and a seal ("Step 2 of 3 to learned", "Learned", "New position"); before an answer a card shows its record\'s rungs, and at the last step, due, the pill "Last step" within the 15 words (else the seal ring pulses once); none on a practice position', () => {
    const A = boot();
    A.ev('(playerTier = function () { return 2; }, 1)');
    const r = JSON.parse(A.ev(`(function () { ${OPEN} ${REC}
      var out = { t2: trackHtml(2), t0: trackHtml(0, { neu: true }), t3: trackHtml(3) }, it = model().byKey['${CARD1}'];
      var d = displayFor(openCard(it));
      out.fresh = { p: d.tk.p, neu: !!d.tk.o.neu, pill: d.pill };
      atRung(it.key, 1); d = displayFor(openCard(it)); out.one = { p: d.tk.p, pill: d.pill };
      atRung(it.key, 2); var a = openCard(it); d = displayFor(a);
      out.two = { p: d.tk.p, pill: d.pill, words: bandWords(d, d.buttons), live: d.live, html: /<span class="bd-step"><span class="tag tag-honey">Last step<\\/span><span class="track"/.test(bandHtml(a, d)) };
      var wb = WORD_BUDGET; WORD_BUDGET = bandWords(d, d.buttons) - 1; d = displayFor(openCard(it)); WORD_BUDGET = wb;
      out.tight = { pill: d.pill, pulse: !!d.tk.o.pulse };
      return JSON.stringify(out); })()`));
    ok(/role="img" aria-label="Step 2 of 3 to learned"><i class="tk-pip on"><\/i><i class="tk-pip on"><\/i><i class="tk-seal"><\/i>/.test(r.t2), 'step 2: two honey pips, the seal a ring: ' + r.t2);
    ok(/aria-label="New position"/.test(r.t0) && !/ on/.test(r.t0), 'a new position: three rings');
    ok(/aria-label="Learned"><i class="tk-pip on"><\/i><i class="tk-pip on"><\/i><i class="tk-seal on"><\/i>/.test(r.t3), 'learned: the seal lit');
    eq(JSON.stringify(r.fresh), JSON.stringify({ p: 0, neu: true, pill: '' }), 'a first sight: a new position, no pill');
    eq(JSON.stringify(r.one), JSON.stringify({ p: 1, pill: '' }), 'step 1: one pip, no pill');
    eq(r.two.pill, 'Last step', 'the last step, due: the pill');
    ok(r.two.html, 'the pill before the track at the tag row\'s right');
    ok(r.two.words <= 15, 'within the 15 words: ' + r.two.words);
    ok(/Last step\.$/.test(r.two.live), 'the live region says it: ' + r.two.live);
    eq(JSON.stringify(r.tight), JSON.stringify({ pill: '', pulse: true }), 'no room for its two words: the pill goes, the seal ring pulses');
  });

  test('release 3, step-tracker.md: a step-1 card\'s due find fills pip 2 on the text beat, within 300 ms of the land beat, and the live region says "Step 2 of 3."; a miss empties the track at once', async () => {
    const A = boot();
    A.ev(DOM);
    A.ev('(playerTier = function () { return 2; }, 1)');
    const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
    A.ev(`(function () { ${REC} atRung('${CARD1}', 1); window.__show(model().byKey['${CARD1}']); return 1; })()`);
    run(1000);
    A.ev('(window.__writes.length = 0, 1)');
    A.ev('(function () { var a = ui.session.active; sessionClick(a.best.from); sessionClick(a.best.to); return 1; })()');
    const land = A.ev('motionUntil');
    run(3000);
    const r = JSON.parse(A.ev(`(function () { var a = ui.session.active, w = window.__writes.filter(function (x) { return x.id === 'cband' && /Step 2 of 3 to learned/.test(x.v || ''); })[0];
      return JSON.stringify({ result: a.result, fx: a.tkFx, at: w ? w.t : null, live: document.getElementById('sr-live').textContent }); })()`));
    eq(r.result, 'first', 'found first try');
    eq(JSON.stringify([r.fx.from, r.fx.to]), '[1,2]', 'the track climbs from step 1 to step 2');
    ok(r.at != null && r.at - land <= 300 && r.at >= land, 'the band with pip 2 is written ' + (r.at - land) + ' ms after the land beat');
    ok(/Step 2 of 3\.$/.test(r.live), 'the live region: ' + r.live);
    /* a miss on a step-1 card: the run breaks at once (srsNoteMiss), the track empties with its fade */
    const m = JSON.parse(A.ev(`(function () { ${OPEN} ${TRY} ${REC} atRung('${CARD1}', 1); var a = openAt('${CARD1}', 2), d0 = displayFor(a).tk.p;
      tryMove(a, a.playedUci, [], -300); window.__a = a; return JSON.stringify({ d0: d0 }); })()`));
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    const m2 = JSON.parse(A.ev(`(function () { var a = window.__a, d = displayFor(a); return JSON.stringify({ phase: a.phase, p: d.tk.p, fx: a.tkFx }); })()`));
    eq(m.d0, 1, 'step 1 before the try');
    eq(JSON.stringify([m2.phase, m2.p, m2.fx.from, m2.fx.to]), JSON.stringify(['tried', 0, 1, 0]), 'a miss empties it, the climbed pip fading');
  });

  test('release 3, F3: the find that makes a position learned is the learned moment: "Learned! This one is yours." (More help "You learned this one!") in row 1, the found reward then the learned one, the chime once, the seal held for the spring; the next tap is never blocked', () => {
    for (const tier of [2, 1]) {
      const A = boot();
      A.ev(DOM);
      A.ev(`(playerTier = function () { return ${tier}; }, 1)`);
      const run = (ms) => { for (let t = 0; t < ms; t += 10) A.advance(10); };
      A.ev(`(function () { ${REC} atRung('${CARD1}', 2); window.__snd = []; snd = function (n) { window.__snd.push(n); }; rewardLog.splice(0); window.__show(model().byKey['${CARD1}']); return 1; })()`);
      run(1000);
      A.ev('(function () { var a = ui.session.active; sessionClick(a.best.from); sessionClick(a.best.to); return 1; })()');
      run(3000);
      const r = JSON.parse(A.ev(`(function () { var a = ui.session.active, d = displayFor(a);
        return JSON.stringify({ learned: srsRec(a.it).learned, m: ui.session.sum[a.key].m, row1: d.row1, rewards: rewardLog.map(function (x) { return x.kind; }), snd: window.__snd.filter(function (x) { return x === 'learned'; }).length,
          fx: a.tkFx && [a.tkFx.from, a.tkFx.to, a.tkFx.learn], p: d.tk.p }); })()`));
      ok(r.learned && r.m === 'learned', 'tier ' + tier + ': learned on this showing');
      eq(r.row1, tier === 1 ? 'You learned this one!' : 'Learned! This one is yours.', 'tier ' + tier + ': row 1');
      eq(r.rewards.join(' '), 'found learned', 'tier ' + tier + ': the found moment, then the learned one');
      eq(r.snd, 1, 'tier ' + tier + ': the chime once');
      eq(JSON.stringify(r.fx), '[2,3,true]', 'tier ' + tier + ': the seal fills with the learned moment');
      /* Continue at once, mid-celebration */
      const idx = A.ev('(nextCard(), ui.session.finished ? "finished" : ui.session.idx)');
      ok(idx === 'finished' || idx === 1, 'tier ' + tier + ': the next tap goes through: ' + idx);
    }
    /* reduced motion: no layer at all (the final state at once), the chime kept */
    const A = boot();
    const rm = A.ev(`(function () { var n = 0; snd = function () { n++; }; var box = { getBoundingClientRect: function () { return { left: 0, top: 0, width: 10, height: 10 }; }, appendChild: function () { throw new Error('drawn'); } };
      ui.reducedTest = true; var r1 = learnedBurst(box, box); return (r1 === null) + '|' + n; })()`);
    eq(rm, 'true|1', 'reduced motion: nothing drawn, the chime once');
  });

  test('release 3, step-tracker.md: Today counts the set\'s positions one find from learned ("2 positions in today\'s set are one find from learned.", More help "...one more find from being yours."), nothing at none; the summary leads with the steps climbed ("3 steps up · 1 learned.", More help "You climbed 3 steps. 1 position is yours now.") and its tiles\' tracks fill the pips climbed in order', () => {
    const A = boot();
    const r = JSON.parse(A.ev(`(function () { ${REC}
      playerTier = function () { return 2; };
      var keys = todayPlan().keys.filter(function (k) { var it = itemOf(k); return it && !it.foil && !it.prac && !it.lesson; }), out = { none: lastStepHtml({ keys: keys }) };
      atRung(keys[0], 2); atRung(keys[1], 2); atRung(keys[2], 1);
      out.n = lastStepCount(keys); out.t2 = lastStepHtml({ keys: keys }).replace(/<[^>]+>/g, '');
      playerTier = function () { return 1; }; out.t1 = lastStepHtml({ keys: keys }).replace(/<[^>]+>/g, '');
      var ss = { mode: 'today', label: 'Today', keys: keys.slice(0, 3), idx: 3, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
      keys.slice(0, 3).forEach(function (k) { ss.results[k] = 'first'; });
      ss.sum[keys[0]] = { c: 'first', s: 3, fc: '', m: 'learned', p: 3, n: 3, d: 25 };
      ss.sum[keys[1]] = { c: 'first', s: 3, fc: '', m: 'up', p: 1 };
      ss.sum[keys[2]] = { c: 'first', s: 3, fc: '', m: 'up', p: 2 };
      out.m1 = movedWords(ss, ss.keys, 1); out.m2 = movedWords(ss, ss.keys, 2);
      playerTier = function () { return 2; };
      var h = doneHtml(ss);
      out.tiles = (h.match(/<span class="track track-sm[^"]*"[^>]*>(<i[^>]*><\\/i>){3}<\\/span>/g) || []).map(function (t) { return ((/aria-label="([^"]*)"/.exec(t) || [])[1]) + ' ' + ((/fx-up" style="--d:(\\d+)ms"/.exec(t) || [])[1]); });
      return JSON.stringify(out); })()`));
    eq(r.none, '', 'none one find from learned: no line');
    eq(r.n, 2, 'the count: the set\'s positions at rung 2');
    eq(r.t2, '2 positions in today\'s set are one find from learned.', 'tier 2');
    eq(r.t1, '2 positions are one more find from being yours.', 'More help');
    ok(/^3 steps up · 1 learned\. Back /.test(r.m2), 'the steps climbed, the seal among them, then when they come back: ' + r.m2);
    ok(/^You climbed 3 steps\. 1 position is yours now\. Back /.test(r.m1), 'More help: ' + r.m1);
    eq(JSON.stringify(r.tiles), JSON.stringify(['Step 1 of 3 to learned 1500', 'Step 2 of 3 to learned 1560']), 'each tile its track, the pips climbed filling in order after the learned moment, 60 ms apart');
  });

  return T;
};
