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
    ok('the card shows a board, a task and the game context', !!$('#bwrap svg') && /to move|better move/i.test(text('#main')) && !!$('.ctx'));
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
    ok('both halves of the lesson are on screen', /\S/.test(text('.tline.tl-bad')) && /\S/.test(text('.tline.tl-good')), text('.result'));
    ok('no pawn number on the board', !/[+-]\d+\.\d/.test(text('#ebar-lab')));
    /* nothing moves on its own: after the solving move lands, the board and the band stay */
    await sleep(600);
    const frame = () => ($('#bwrap') ? $('#bwrap').innerHTML : '') + '|' + text('.card-task') + '|' + JSON.stringify(T.card().view);
    const f0 = frame();
    await sleep(5000);
    ok('board and band unchanged 5 s after an answer', frame() === f0, JSON.stringify(c.view) + ' -> ' + JSON.stringify(T.card().view));
    click('.tline.tl-bad');
    await sleep(200);
    ok('tapping the red line opens your game line at its start', T.card().view.line === 'refute' && T.card().view.idx === -1, JSON.stringify(T.card().view));
    ok('the red arrow shows alone at the start of its line', !!$('#bwrap .bad-arrow') && !$('#bwrap .good-arrow'));

    /* ── exploring: the invite, three rows, one arrow, a sentence, the way back ─ */
    const inv = $('#cpanel [data-act=explore]');
    ok('the answered card invites you to test a move', !!inv && /^(Why .+\? Try another (white|black) move and Stockfish answers\.|Move a piece to test an idea\. Stockfish answers\.)$/.test(inv.textContent.trim()), inv && inv.textContent);
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
      ok('Esc returns to the lesson', !T.explore() && !!$('.tline.tl-good'));
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
      /* the try stays on the board until Try again (a button ignores taps in
         a card's first 450 ms and for 450 ms after the bar changes) */
      await sleep(500);
      if (press('#cbar [data-act=seeIt]')) {
        /* See it: their reply slides, then the left button changes under the focus */
        await until(() => !$('#cbar [data-act=seeIt]'), 3000);
        await sleep(300);
        ok('after See it the focus stays on the action bar, not the typed-move field', focusInBar(), focusName());
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
        ok('a revealed card says what the answer is', /^The answer: \S+/.test(text('#cband .bd-r1')), text('#cband'));
        bandFits('the answer shown');
      } else ok('a close alternative was accepted as solved', c2.result !== 'fail');
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
