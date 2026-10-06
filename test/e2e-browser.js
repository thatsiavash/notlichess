// End-to-end check of the trainer in a real browser tab.
// Run it on a local copy (localhost or 127.0.0.1) where an account is already loaded and at least ~12 mistakes
// are ready: paste the whole file into the browser's JavaScript console (or an automation tool's evaluate) and
// await the returned promise. It drives the app through its own buttons and the window.__nlTest hooks, and
// resolves to { passed, failed, log }. It changes that account's practice history, so use a test account.
(async function e2e() {
  const log = [], errors = [];
  let passed = 0, failed = 0;
  const T = window.__nlTest;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const text = (s) => ($(s) ? $(s).innerText : '');
  const ok = (name, cond, detail) => {
    if (cond) { passed++; log.push('ok   ' + name); } else { failed++; log.push('FAIL ' + name + (detail ? ': ' + detail : '')); }
    return cond;
  };
  const until = async (fn, ms, step) => {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(step || 150); }
    return null;
  };
  const click = (sel) => { const e = $(sel); if (e) e.click(); return !!e; };
  const onErr = (e) => errors.push(String(e.message || e.reason || e));
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);
  /* a square tapped as a finger taps it: a click on the board's own square, so a tapped move slides */
  const tapSq = (sq) => { const r = $('#bwrap .board rect[data-sq="' + sq + '"]'); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!r; };
  const sqOf = (s) => (s.charCodeAt(0) - 97) + (parseInt(s[1], 10) - 1) * 8;
  const tapMove = async (uci) => { tapSq(sqOf(uci.slice(0, 2))); await sleep(120); tapSq(sqOf(uci.slice(2, 4))); };
  /* the board by hand, through the page's pointer handlers: a square's centre on screen, one event
     there (on whatever is drawn on top, as the browser picks it), a full tap (press, lift, click) and a
     mouse drag (press, moves, lift, then the click a mouse sends to the board round both squares) */
  const ptOf = (sq) => { const r = $('#bwrap .board rect[data-sq="' + sq + '"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const fire = (type, p, Ctor) => {
    const el = document.elementFromPoint(p[0], p[1]) || document.body;
    el.dispatchEvent(new (Ctor || PointerEvent)(type, { bubbles: true, cancelable: true, clientX: p[0], clientY: p[1], button: 0, buttons: /down|move/.test(type) ? 1 : 0, pointerId: 7, pointerType: 'mouse', isPrimary: true }));
  };
  const fingerTap = (sq) => { const p = ptOf(sq); fire('pointerdown', p); fire('pointerup', p); fire('click', p, MouseEvent); };
  const dragMove = (uci) => {
    const a = ptOf(sqOf(uci.slice(0, 2))), b = ptOf(sqOf(uci.slice(2, 4)));
    fire('pointerdown', a); fire('pointermove', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); fire('pointermove', b); fire('pointerup', b);
    const bd = $('#bwrap .board');
    if (bd) bd.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: b[0], clientY: b[1] }));
  };
  /* text never changes while a piece moves: every write to the band, the action bar, the strip, the
     session bar or the live region is timed, and so is every slide of a piece (transitionrun to
     transitionend) */
  const W = { writes: [], slides: [], fit: [] };
  const onMut = (l) => { const t = performance.now(); l.forEach((m) => {
    const n = m.target.nodeType === 1 ? m.target : m.target.parentNode;
    const host = n && n.closest && n.closest('#cband, #cbar, #cstrip, #ctop, #sr-live');
    if (host) W.writes.push([t, host.id]); }); };
  const mo = new MutationObserver(onMut);
  const onRun = (e) => { if (e.target.classList && e.target.classList.contains('anim-piece')) W.slides.push([performance.now(), null]); };
  const onEnd = (e) => { if (e.target.classList && e.target.classList.contains('anim-piece')) { const x = W.slides[W.slides.length - 1]; if (x && x[1] == null) x[1] = performance.now(); } };
  /* the recorder runs on the lesson only: exploring moves both sides and repaints board and words
     together by design (S14), so it is switched off while exploring */
  const recOn = () => {
    const o = { childList: true, subtree: true, characterData: true };
    mo.observe($('#trainbox'), o);
    if ($('#sr-live')) mo.observe($('#sr-live'), o);
    document.addEventListener('transitionrun', onRun, true);
    document.addEventListener('transitionend', onEnd, true);
  };
  const recOff = () => {
    onMut(mo.takeRecords());
    mo.disconnect();
    document.removeEventListener('transitionrun', onRun, true);
    document.removeEventListener('transitionend', onEnd, true);
  };
  /* a button pressed as a finger or a mouse presses it: it takes focus, then the click */
  const press = (sel) => { const e = $(sel); if (e) { e.focus(); e.click(); } return !!e; };
  /* focus stays on the action bar after its buttons change, never in the typed-move field (which
     would open a phone's keyboard, and take Enter) */
  const focusInBar = () => { const e = document.activeElement; return !!e && !!e.closest && !!e.closest('#cbar') && e.id !== 'kbmove'; };
  const focusName = () => { const e = document.activeElement; return !e ? 'none' : e.id ? '#' + e.id : e.tagName + '[' + (e.getAttribute('data-act') || '') + '] ' + (e.textContent || '').trim(); };
  /* the band's words fit its box: no row cut short, nothing below the box (the phone check runs at 360 x 640),
     and the box keeps the height it had when the card opened, so nothing below it moves */
  const bandFits = (what) => {
    const bx = $('#cband .card-task'), rows = document.querySelectorAll('#cband .bd-r1, #cband .bd-r2, #cband .bd-cap');
    const cut = !bx || bx.scrollHeight > bx.clientHeight || [].some.call(rows, (r) => r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1);
    if (cut) W.fit.push(what + ': ' + (bx ? bx.innerText.replace(/\n+/g, ' / ') : 'no band'));
    if (bx && W.h0 == null) W.h0 = bx.offsetHeight;
    else if (bx && bx.offsetHeight !== W.h0) W.fit.push(what + ': the band is ' + bx.offsetHeight + ' px tall, not ' + W.h0);
  };
  const legalOther = (c) => {
    /* a legal move that is neither the answer nor the game move */
    return T.ev(`(function () { var a = ui.session.active, ms = legalMoves(a.st).map(moveUci);
      return ms.filter(function (u) { return u !== a.bestUci && u !== a.playedUci && !(a.sol && a.sol.indexOf(u) !== -1); }); })()`);
  };

  try {
    /* ── Today ───────────────────────────────────────────────────────── */
    T.ev("ui.session = null; store.del(sessKey()); setView('train', false); renderTrain(); 'ok'");
    await sleep(300);
    const stats = T.stats();
    ok('engine is Stockfish 17.1 and ready', stats.engine === 'sf17.1' && stats.state === 'ready', stats.engine + '/' + stats.state);
    ok('account has at least 12 trainable mistakes', stats.trainable >= 12, 'trainable ' + stats.trainable);
    /* Today offers a start, or says the day is done (the daily cap on new positions) */
    ok('Today offers a start or a finished day', !!($('[data-act=startToday]') || $('[data-act=keepGoing]') || /Done for today|Nothing due/.test(text('#trainbox'))), text('#trainbox').slice(0, 120));
    ok('the header is the mark and the gear only', !!$('#bar .brand-name') && !!$('#bar [data-act=settings]') && !/▼|▲/.test(text('#bar')), text('#bar'));
    ok('Today shows the latest games rail', !!$('#latest .lg-row'));
    ok('no em dash anywhere on Today', text('#main').indexOf('—') === -1);

    /* ── a session: solve the first card ─────────────────────────────── */
    click('[data-act=startToday]') || click('[data-act=keepGoing]')
      || T.ev("startDrill({ type: 'family', fam: familyOf(patternOf(allMistakes().filter(trainable)[0].b)).key, label: 'e2e' }); 'ok'");
    let c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 30000);
    ok('first card opens', !!c);
    if (!c) throw new Error('no card');
    ok('the first card asks for a better move, with your side to move', /Find a better move/.test(text('#main')) && T.ev('myPov(ui.session.active.it) === !!ui.session.active.st.w'), text('.card-task'));
    const san0 = T.ev('sanOf(ui.session.active.pre, ui.session.active.played)');
    ok('the band reads Your turn / Find a better move than the game move', text('#cband .bd-r1') === 'Your turn' && text('#cband .bd-r2') === 'Find a better move than ' + san0 + '.', text('#cband'));
    bandFits('the card opens');
    recOn();
    ok('session mode hides the site chrome', document.body.classList.contains('in-session'));
    ok('the session bar has an end button and progress', !!$('.sb-end') && !!$('.dots'));
    ok('the card shows a board and a task', !!$('#bwrap svg') && /to move|better move/i.test(text('#main')));
    /* the strip is empty before an answer: the game's context waits in Details (the typed-move field is off screen) */
    ok('the strip says nothing before an answer', !$('#cstrip .ctx') && !/\S/.test([].map.call(document.querySelectorAll('#cstrip > :not(.kb-move)'), (e) => e.innerText).join('')), text('#cstrip'));
    ok('the move played in the game is marked', !!$('#bwrap svg') && !!c.played);
    const bwk = $('#bwrap').children, bwr = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); };
    ok('the board svg is #bwrap\'s first child, the marks svg over it', bwk[0].matches('svg.board') && !!bwk[1] && bwk[1].matches('svg.marks')
      && bwr(bwk[0]) === bwr(bwk[1]) && !!$('#bwrap .marks .bad-arrow') && getComputedStyle(bwk[1]).pointerEvents === 'none', bwk[1] && bwr(bwk[0]) + ' / ' + bwr(bwk[1]));
    /* a ghost on one of your pieces: a tap on its cross (top-right) still reaches that square; the board is put back after */
    const gx = T.ev(`(function () { var a = ui.session.active, f = boardOptsFor(a), w = document.getElementById('bwrap'), keep = w.innerHTML, sq = -1;
      for (var s = 0; s < 64; s++) if (f.st.b[s] && isW(f.st.b[s]) === myPov(a.it)) { sq = s; break; }
      w.innerHTML = boardSvg(f.st, Object.assign({}, f.opts, { ghosts: [{ sq: sq, p: f.st.b[sq] }] }));
      var r = w.querySelector('.board rect[data-sq="' + sq + '"]').getBoundingClientRect(), k = r.width / 45, e = document.elementFromPoint(r.left + 37.5 * k, r.top + 7.5 * k);
      var on = e && e.closest ? e.closest('#bwrap [data-sq]') : null, out = { sq: sq, hit: on ? +on.getAttribute('data-sq') : -1, tag: e ? e.tagName : '' };
      w.innerHTML = keep; return out; })()`);
    ok('a tap on a ghost\'s cross reaches the piece under it', gx.sq >= 0 && gx.hit === gx.sq, JSON.stringify(gx));
    const want = c.sol ? c.sol : [c.best];
    for (let i = 0; i < want.length; i += 2) {
      await until(() => T.card().phase === 'guess', 6000);
      await tapMove(want[i]);
      await until(() => ['done', 'guess'].indexOf(T.card().phase) !== -1 && (T.card().phase === 'done' || T.card().solIdx > i), 6000);
    }
    c = await until(() => { const x = T.card(); return x.phase === 'done' ? x : null; }, 15000);
    ok('playing the answer solves the card', !!c && (c.result === 'first' || c.result === 'hint'), c && c.result);
    await sleep(600);
    bandFits('the card solved');
    ok('the solved card shows the best line', !!c && !!c.lines && c.lines.best.length >= 1);
    /* S0: the verdict, then the game move's ghost, then R4 and Details; See why and Continue */
    ok('the solve lands as a tick on the square, with the band saying so', !!$('#bwrap .marks .badge-good') && /^(Found it|You got there|That works too)$/.test(text('#cband .bd-r1')), text('#cband'));
    await until(() => T.card().settle === 2, 3000);
    await sleep(300);
    ok('the settled result: the game move\'s ghost where it went', !!$('#bwrap .board .ghost-piece') === (T.ev('s0Marks(ui.session.active, ui.session.active.st).ghosts.length') > 0)
      && !!$('#bwrap .marks .badge-good'), T.ev('JSON.stringify(s0Marks(ui.session.active, ui.session.active.st))'));
    ok('the settled band reads the result over R4', /^(Found it|You got there|That works too)$/.test(text('#cband .bd-r1')) && /\S/.test(text('#cband .bd-r2')) && !!$('#cstrip [data-act=details]')
      && /^See why ›\s*(Continue|Finish)$/.test(text('#cbar').replace(/\n/g, ' ').trim()), text('#cband') + ' | ' + text('#cstrip') + ' | ' + text('#cbar'));
    bandFits('the card settled');
    ok('no pawn number on the board', !/[+-]\d+\.\d/.test(text('#ebar-lab')));
    /* the Details sheet: both long sentences, the game, the pattern, the way to explore */
    click('#cstrip [data-act=details]');
    await until(() => $('#overlay .sheet'), 3000);
    const sn = T.card().sentences;
    ok('the Details sheet holds both sentences', !!sn && text('#overlay .sheet').indexOf(sn.best) !== -1 && text('#overlay .sheet').indexOf(sn.game.replace(/ \(\d+% to \d+%\)/g, '')) !== -1 && !!$('#overlay .sheet .ctx'),
      text('#overlay .sheet').slice(0, 200));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    ok('Escape closes Details', !$('#overlay .sheet'));
    /* nothing moves on its own: after the solving move lands, the board and the band stay */
    await sleep(600);
    const frame = () => ($('#bwrap') ? $('#bwrap').innerHTML : '') + '|' + text('.card-task') + '|' + JSON.stringify(T.card().view);
    const f0 = frame();
    await sleep(5000);
    ok('board and band unchanged 5 s after an answer', frame() === f0, JSON.stringify(c.view) + ' -> ' + JSON.stringify(T.card().view));
    click('#cbar [data-act=seeWhy]');
    await sleep(400);
    ok('See why opens your game line at its start', T.card().view.line === 'refute' && T.card().view.idx === -1, JSON.stringify(T.card().view));
    ok('the red arrow shows alone at the start of its line', !!$('#bwrap .bad-arrow') && !$('#bwrap .good-arrow'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    ok('Esc goes back to the settled result', T.card().view.mode === 's0' && !!$('#cstrip [data-act=details]'), JSON.stringify(T.card().view));

    /* ── exploring: from Details, three rows, one arrow, a sentence, the way back ─ */
    click('#cstrip [data-act=details]');
    await until(() => $('#overlay .sheet'), 3000);
    const inv = $('#overlay [data-act=explore]');
    ok('Details offers to try your own moves', !!inv && inv.textContent.trim() === 'Try your own moves with Stockfish ›', inv && inv.textContent);
    ok('the answered board is still static before exploring', $('#bwrap').classList.contains('static'));
    if (inv) { recOff(); inv.click(); }
    const xr = await until(() => { const x = T.explore(); return x && x.lines && x.lines.length ? x : null; }, 10000);
    ok('exploring shows Stockfish\'s best moves', !!xr && document.querySelectorAll('#xp .xp-row:not(.skel)').length >= 2);
    ok('exploring makes the board live', !$('#bwrap').classList.contains('static'));
    ok('rows say your winning chances or words, never a pawn number', !/[+-]\d+\.\d/.test(text('#xp')) && (T.ev('ui.session.active.tier') === 1 || /You \d{1,2}%|mate in \d/.test(text('#xp .xp-rows'))), text('#xp .xp-rows'));
    ok('one arrow at a time while exploring', document.querySelectorAll('#bwrap .ghost-arrow, #bwrap .good-arrow, #bwrap .bad-arrow').length <= 1);
    if (xr) {
      const legal = T.ev(`(function () { var ex = ui.session.active.explore; return legalMoves(ex.st).map(moveUci); })()`);
      const tryU = legal.filter((u) => xr.lines.map((l) => l.pv[0]).indexOf(u) === -1)[0] || legal[0];
      /* not in the same frame as the result that just arrived */
      await sleep(300);
      T.play(tryU);
      const said = await until(() => { const x = T.explore(); return x && x.at === 1 && !/thinking/.test(x.say) ? x.say : null; }, 15000);
      ok('a tried move gets one sentence', !!said && said.length <= 80 && !/\u2014/.test(said), said);
      await sleep(3000);
      ok('the sentence does not change once written', T.explore() && T.explore().say === said, T.explore() && T.explore().say);
      click('[data-act=lineBack]');
      await sleep(200);
      ok('‹ steps back inside the exploration', T.explore() && T.explore().at === 0);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);
      ok('Esc returns to the lesson', !T.explore() && T.card().view.mode === 's0' && !!$('#cstrip [data-act=details]'), JSON.stringify(T.card().view));
    }
    if (inv) { await sleep(300); recOn(); }

    /* ── the next card: the game move again, then misses and escalation ─ */
    const at = T.card().idx;
    click('[data-act=next]');
    c = await until(() => { const x = T.card(); return x.phase === 'guess' && x.idx === at + 1 ? x : null; }, 30000);
    ok('Next opens the second card', !!c);
    if (c) {
      await sleep(500);
      /* a tap on one of their pieces: outlined, the band says which side you are, nothing graded; then the task is back */
      const opp = T.ev('(function (a) { for (var q = 0; q < 64; q++) if (a.st.b[q] && isW(a.st.b[q]) !== !!a.st.w) return q; return -1; })(ui.session.active)');
      tapSq(opp);
      await sleep(300);
      const t4 = T.ev('CARD_COPY.T4(ui.session.active)');
      ok('a tap on their piece says which side you are, and grades nothing', text('#cband .bd-r2') === t4 && !!$('#bwrap .marks .nope-box') && T.card().phase === 'guess' && T.card().misses === 0,
        text('#cband') + ' / ' + T.card().phase + ' ' + T.card().misses);
      bandFits('T4');
      await sleep(2600);
      ok('the task is back after it, and the outline gone', /^Find a better move/.test(text('#cband .bd-r2')) && !$('#bwrap .marks .nope-box'), text('#cband'));
      await tapMove(c.played);
      await until(() => T.card().misses === 1, 4000);
      await sleep(500);
      ok('replaying the game move is explained as the game move', text('#cband .bd-r1') === 'Your game move again', text('#cband'));
      ok('the verdict lands on the square: a cross on where the move went, red tints', !!$('#bwrap .marks .badge-bad') && !!$('#bwrap .board .tint-bad'));
      ok('the verdict hands the keyboard to Try again', !!document.activeElement && document.activeElement.getAttribute('data-act') === 'tryAgain', focusName());
      ok('the game-move message never names the answer', text('#cband').indexOf(T.ev('sanOf(ui.session.active.pre, ui.session.active.best)')) === -1, text('#cband'));
      bandFits('the game move again');
      /* its reason comes after the verdict, in two beats: the piece that punishes it ringed with a dashed arrow
         to what it takes (when that move captures or checks and the try loses something), then the words */
      ok('a miss says its verdict alone first', !text('#cband .bd-r2') && T.card().reason === 0, text('#cband') + ' / reason ' + T.card().reason);
      const rs = await until(() => (T.card().reason === 2 ? T.card() : null), 3000);
      await sleep(250);
      const due = T.ev('(function (a) { var d = dueMove(a); return [d.from, d.to]; })(ui.session.active)'), th = rs && rs.tried && rs.tried.threat;
      ok('a miss gives its reason after the verdict, in words that never name the answer', !!rs && /\S/.test(text('#cband .bd-r2'))
        && text('#cband').indexOf(T.ev('sanOf(ui.session.active.pre, ui.session.active.best)')) === -1, text('#cband'));
      ok('the reason on the board: the punishing piece ringed, a dashed arrow to what it takes', !th || th.from === due[1]
        || (!!$('#bwrap .marks .ring-threat') && (th.to === due[1] || !!$('#bwrap .marks .threat-arrow'))), JSON.stringify(th));
      bandFits('the game move again, its reason');
      /* the try stays on the board until Try again (a button ignores taps in
         a card's first 450 ms and for 450 ms after the bar changes) */
      if (press('#cbar [data-act=seeIt]')) {
        /* See it: their reply slides, then the left button changes under the focus */
        await until(() => !$('#cbar [data-act=seeIt]'), 3000);
        await sleep(300);
        ok('after See it the focus stays on the action bar, not the typed-move field', focusInBar(), focusName());
        const lost = T.card().tried && T.card().tried.lost;
        ok('after See it the reason marks are gone, and what their reply took shows as a token', !$('#bwrap .marks .ring-threat')
          && (!lost || lost.sq === due[1] ? !$('#bwrap .marks .token-lost') : !!$('#bwrap .marks .token-lost')), JSON.stringify(lost));
        await sleep(300);
      }
      press('#cbar [data-act=tryAgain]');
      await until(() => T.card().phase === 'guess', 3000);
      await sleep(400);
      ok('after Try again the focus stays on the action bar, not the typed-move field', focusInBar(), focusName());
      const others = legalOther(c);
      ok('there are other legal moves to try', others.length >= 2, String(others.length));
      /* a try that is nearly as good counts as close, not as a miss: try another */
      const tried = [];
      for (let oi = 0; oi < Math.min(4, others.length); oi++) {
        await until(() => T.card().phase === 'guess' || T.card().phase === 'tried', 8000);
        if (T.card().misses >= 2) break;
        tried.push(others[oi]);
        T.play(others[oi]);
        await until(() => T.card().misses === 2 || T.card().phase === 'done' || (T.card().tried && T.card().tried.kind !== 'miss'), 15000);
        if (T.card().misses === 2 || T.card().phase === 'done') break;
      }
      await until(() => T.card().misses === 2 || T.card().phase === 'done', 6000);
      const c2 = T.card();
      if (c2.phase !== 'done') {
        /* the automatic first hint shows on Try again: after miss 2 at tier 2, miss 1 at tier 1, never at tier 3
           (the verdict's bar can land up to 300 ms after the miss, when the try before it was taken back by a
           crossfade, and then ignores taps for 450 ms) */
        await sleep(900);
        click('[data-act=tryAgain]');
        await until(() => T.card().phase === 'guess', 3000);
        /* the words come back once the crossfade to the card is over (300 ms) */
        await sleep(400);
        ok('the move just tried stays on the card, faint', !!$('#bwrap .marks .tried'));
        const tier = T.ev('ui.session.active.tier'), c2b = T.card();
        ok('tier 2: hint 1 is on after the second Try again', tier === 3 ? c2b.hints === 0 : c2b.hints >= 1 && /^Hint 1 of 2/.test(text('#cband .bd-r1')), 'tier ' + tier + ', hints ' + c2b.hints + ', ' + text('#cband'));
        bandFits('a hint');
        const more = legalOther(c).filter((u) => tried.indexOf(u) === -1);
        let c3 = null;
        for (let mi = 0; mi < Math.min(4, more.length) && !c3; mi++) {
          await until(() => ['guess', 'tried', 'done'].indexOf(T.card().phase) !== -1, 8000);
          if (T.card().phase === 'done') { c3 = T.card(); break; }
          T.play(more[mi]);
          c3 = await until(() => { const x = T.card(); return x.misses >= 3 || x.phase === 'done' ? x : null; }, 12000);
        }
        /* miss 3 reveals nothing: See it, then the left button offers the answer */
        if (c3 && c3.phase === 'tried') await sleep(900);
        const offered = !!c3 && c3.phase === 'tried' && click('[data-act=seeIt]') && !!(await until(() => $('#cpanel [data-act=reveal]'), 3000));
        ok('miss 3 offers Show the answer; result still null', offered && T.card().result === null, c3 && (c3.phase + ' ' + c3.result));
        if (offered) {
          /* a second tap within 450 ms of See it lands on Show the answer and is ignored */
          click('#cpanel [data-act=reveal]');
          ok('a tap on Show the answer right after See it is ignored', T.card().result === null && T.card().phase === 'tried', T.card().phase + ' ' + T.card().result);
          await sleep(500);
        }
        click('#cpanel [data-act=reveal]');
        await until(() => T.card().phase === 'done', 3000);
        await sleep(300);
        ok('a revealed card says what the answer is', /^The answer: \S+/.test(text('#cband .bd-r1')) && text('#cband .bd-r2') === 'Play the green arrow.' && !!$('#bwrap .marks .good-arrow') && !$('#bwrap .marks .bad-arrow'), text('#cband'));
        bandFits('the answer shown');
        /* Play it: the answer slides and lands with the grey i, then the card settles under the answer */
        await sleep(300);
        const v1 = text('#cband .bd-r1');
        press('#cbar [data-act=playIt]');
        await until(() => T.card().settle === 2 || T.card().showWait, 3000);
        if (T.card().showWait || (T.card().view && T.card().view.mode === 'show')) {
          /* a forcing line: each reply plays, then Play it again */
          for (let g = 0; g < 8 && T.card().view.mode === 'show'; g++) { await until(() => !T.card().showWait && !!$('#cbar [data-act=playIt]'), 4000); await sleep(500); click('#cbar [data-act=playIt]'); await sleep(300); }
        }
        await until(() => T.card().settle === 2, 4000);
        await sleep(300);
        ok('Play it plays the answer: the grey i, then R4 under the answer, and See why', !!$('#bwrap .marks .badge-info') && /^The answer: \S+/.test(text('#cband .bd-r1')) && /\S/.test(text('#cband .bd-r2'))
          && text('#cband .bd-r2') !== 'Play the green arrow.' && !!$('#cbar [data-act=seeWhy]'), v1 + ' -> ' + text('#cband') + ' | ' + text('#cbar'));
        bandFits('the answer played');
      } else ok('a close alternative was accepted as solved', c2.result !== 'fail');
      /* Next ignores taps for 450 ms after the bar changed to it (the reveal above), which left the
         skip and drag lines below waiting 30 s for a card that never came */
      await sleep(500);
      click('[data-act=next]');
    }

    /* the slides so far: the answer tapped, the game move tapped, See it */
    await sleep(600);
    recOff();
    const inSlide = [];
    /* a slide starts two frames after its board is drawn: words written with that board count too */
    W.writes.forEach((w) => W.slides.forEach((x) => { if (w[0] > x[0] - 60 && w[0] < (x[1] == null ? x[0] + 400 : x[1])) inSlide.push(w[1] + ' at ' + Math.round(w[0] - x[0]) + ' ms'); }));
    ok('no text is written while a piece slides', W.slides.length >= 2 && inSlide.length === 0, W.slides.length + ' slides, ' + inSlide.length + ' writes inside one: ' + inSlide.slice(0, 4).join(', '));
    ok('the band\'s words fit its box', W.fit.length === 0, W.fit.slice(0, 3).join(' | '));

    /* ── skip, reload-resume and the recap ───────────────────────────── */
    c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 30000);
    if (c) {
      /* the game move dragged with the mouse, then one tap on their piece: it answers at once (T4,
         full or short), since a drop's flag is only for the click its own gesture makes */
      await sleep(600);
      dragMove(c.played);
      await until(() => T.card().phase === 'tried', 4000);
      await sleep(500);
      const opp2 = T.ev('(function (a) { var st = triedFrame(a).st; for (var q = 0; q < 64; q++) if (st.b[q] && isW(st.b[q]) !== !!a.st.w) return q; return -1; })(ui.session.active)');
      fingerTap(opp2);
      await sleep(300);
      ok('after a dragged move, the first tap on their piece says which side you are', T.ev('NOTE_COPY.T4(ui.session.active)').indexOf(text('#cband .bd-r2')) !== -1 && !!$('#bwrap .marks .nope-box') && T.card().phase === 'tried',
        T.card().phase + ': ' + text('#cband'));
      await sleep(400);
      press('#cbar [data-act=tryAgain]');
      await until(() => T.card().phase === 'guess', 3000);
      await sleep(400);
    }
    if (c) {
      const before = c.idx;
      click('[data-act=menu]');
      await sleep(150);
      click('[data-act=skip]');
      c = await until(() => { const x = T.card(); return x.phase === 'guess' && x.idx === before + 1 ? x : (x.finished ? x : null); }, 30000);
      ok('Skip moves on', !!c);
    }
    const saved = T.ev("JSON.stringify(savedSession() && { idx: savedSession().idx, n: savedSession().keys.length })");
    ok('the session is saved for a reload', saved !== 'null' && saved !== 'false', saved);
    const sessionsBefore = T.ev('dayLoad().sessions || 0');
    history.back();
    await until(() => !document.body.classList.contains('in-session'), 3000);
    ok('Back pauses the session instead of leaving', !T.ev('!!ui.session') && /paused/i.test(text('#overlay')), text('#overlay'));
    ok('Today offers to resume', !!$('[data-act=resume]'));
    click('[data-act=resume]');
    c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 30000);
    ok('resume reopens an unanswered card', !!c && c.result === null);
    if (c) {
      /* the answer dragged, then one tap on a piece: N1 at once */
      const want2 = c.sol ? c.sol : [c.best];
      await sleep(600);
      for (let i = 0; i < want2.length; i += 2) {
        /* the forcing reply has landed (a press while it slides is dropped, S10) */
        await until(() => T.card().phase === 'guess' && !T.ev('motionHold') && T.ev('motionUntil') <= Date.now(), 8000);
        await sleep(100);
        dragMove(want2[i]);
        await until(() => T.card().phase === 'done' || T.card().solIdx > i, 6000);
        if (T.card().phase !== 'done' && T.card().solIdx <= i) break;
      }
      const dn = await until(() => T.card().phase === 'done', 8000);
      await until(() => T.card().settle === 2, 3000);
      await sleep(300);
      const any = dn ? T.ev('(function (a) { var st = lineView(a).st; for (var q = 0; q < 64; q++) if (st.b[q]) return q; return -1; })(ui.session.active)') : -1;
      if (any >= 0) fingerTap(any);
      await sleep(300);
      ok('after a dragged solve, the first tap on a piece says where to try moves', !!dn && text('#cband .bd-r2') === T.ev('CARD_COPY.N1(ui.session.active)') && !!$('#bwrap .marks .nope-box'),
        T.card().phase + ': ' + text('#cband'));
      /* and Details is there, and opens */
      const dl = $('#cstrip [data-act=details]');
      if (dl) dl.click();
      await until(() => $('#overlay .sheet'), 2000);
      ok('the Details that N1 names is in the strip, and opens', !!dl && !!$('#overlay .sheet .dt-lines'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(2600);
    }
    /* finish quickly: reveal the rest */
    for (let guard = 0; guard < 40; guard++) {
      const x = T.card();
      if (x.finished || !x.key && x.session === false) break;
      if (x.phase === 'guess') click('[data-act=reveal]');
      else if (x.phase === 'tried') click('[data-act=tryAgain]');
      else if (x.phase === 'done') click('[data-act=next]');
      await sleep(900);
      if (T.card().finished) break;
    }
    await until(() => T.card().finished || !!$('.recap-item'), 20000);
    ok('the session ends in a recap', !!$('.recap-item') || /solved/i.test(text('#trainbox')), text('#trainbox').slice(0, 80));
    ok('the recap offers to play a game', !!$('.recap-acts .btn-big'));
    ok('reveal-only cards do not earn the day on their own', T.ev('ui.session ? (ui.session.attempted || 0) + (ui.session.carried || 0) >= 3 : false') || T.ev('dayLoad().sessions || 0') === sessionsBefore);
    click('[data-act=endSession]');
    await sleep(300);

    /* ── Insights, a sheet, settings ─────────────────────────────────── */
    T.ev("setView('insights'); 'ok'");
    await until(() => $('#insightsbox .fam-row'), 8000);
    ok('Insights ranks the mistake families', !!$('#insightsbox .fam-row'));
    ok('no NaN, undefined or em dash in Insights', !/NaN|undefined|—/.test(text('#insightsbox')));
    click('#insightsbox [data-act=sheet]');
    await until(() => $('#overlay .sheet'), 3000);
    ok('a family sheet opens with its drill under the habit', !!$('#overlay .sheet .sheet-acts'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    ok('Escape closes the sheet', !$('#overlay .sheet'));
    T.ev("setView('train'); 'ok'");
    click('#bar [data-act=settings]');
    await until(() => $('#overlay .sheet .switch-row'), 3000);
    ok('Settings open in a sheet', !!$('#overlay .sheet .switch-row'));
    const sizeBefore = T.ev("sessionSize()");
    click('#overlay [data-act=size][data-k="5"]');
    ok('session size can be changed', T.ev("sessionSize()") === 5);
    T.ev("store.set('nl:sessionSize', " + sizeBefore + "); closeSheet(); 'ok'");

    /* ── typed moves ─────────────────────────────────────────────────── */
    T.ev("startDrill({ type: 'family', fam: familyOf(patternOf(allMistakes().filter(trainable)[0].b)).key, label: 'e2e' }); 'ok'");
    c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 30000);
    if (c) {
      const inp = $('#kbmove');
      ok('the typed-move box exists', !!inp);
      const san = T.ev("sanOf(ui.session.active.st, ui.session.active.best)");
      inp.value = san;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const d = await until(() => { const x = T.card(); return x.phase === 'done' || x.phase === 'reply' || x.solIdx > 0 ? x : null; }, 15000);
      ok('typing the answer in algebraic notation plays it', !!d, san);
      click('[data-act=endSession]') || T.ev("endSession(); 'ok'");
    }
  } catch (e) {
    failed++; log.push('FAIL aborted: ' + (e && e.message));
  }
  window.removeEventListener('error', onErr);
  window.removeEventListener('unhandledrejection', onErr);
  ok('no uncaught errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  return { passed, failed, log };
})();
