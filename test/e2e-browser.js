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
    ok('engine is Stockfish 17 and ready', stats.engine === 'sf17' && stats.state === 'ready', stats.engine + '/' + stats.state);
    ok('account has at least 12 trainable mistakes', stats.trainable >= 12, 'trainable ' + stats.trainable);
    /* Today offers a start, or says the day is done (the daily cap on new positions) */
    ok('Today offers a start or a finished day', !!($('[data-act=startToday]') || $('[data-act=keepGoing]') || /Done for today|Nothing due/.test(text('#trainbox'))), text('#trainbox').slice(0, 120));
    ok('the header is the mark and the gear only', !!$('#bar .brand-name') && !!$('#bar [data-act=settings]') && !/▼|▲/.test(text('#bar')), text('#bar'));
    ok('Today shows the latest games rail', !!$('#latest .lg-row'));
    ok('no em dash anywhere on Today', text('#main').indexOf('—') === -1);

    /* ── a session: solve the first card ─────────────────────────────── */
    click('[data-act=startToday]') || click('[data-act=keepGoing]')
      || T.ev("startDrill({ type: 'family', fam: familyOf(patternOf(allMistakes().filter(trainable)[0].b)).key, label: 'e2e' }); 'ok'");
    let c = await until(() => { const x = T.card(); return x.phase === 'guess' || x.phase === 'check' ? x : null; }, 30000);
    ok('first card opens', !!c);
    if (!c) throw new Error('no card');
    if (c.phase === 'check') {
      /* the blunder check: play what the game move allowed, then the card */
      ok('the blunder check asks what the opponent can do', /What can (White|Black) do now/.test(text('#cpanel')));
      T.play(c.check1);
      c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 8000);
      ok('after the blunder check, the card asks for a better move', !!c && /better move/i.test(text('#cpanel')));
      if (!c) throw new Error('no step 2');
    }
    ok('session mode hides the site chrome', document.body.classList.contains('in-session'));
    ok('the session bar has an end button and progress', !!$('.sb-end') && !!$('.dots'));
    ok('the card shows a board, a task and the game context', !!$('#bwrap svg') && /to move|better move/i.test(text('#main')) && !!$('.ctx'));
    ok('the move played in the game is marked', !!$('#bwrap svg') && !!c.played);
    const want = c.sol ? c.sol : [c.best];
    for (let i = 0; i < want.length; i += 2) {
      T.play(want[i]);
      await until(() => ['done', 'guess'].indexOf(T.card().phase) !== -1 && (T.card().phase === 'done' || T.card().solIdx > i), 6000);
    }
    c = await until(() => { const x = T.card(); return x.phase === 'done' ? x : null; }, 15000);
    ok('playing the answer solves the card', !!c && (c.result === 'first' || c.result === 'hint'), c && c.result);
    ok('the solved card shows the best line', !!c && !!c.lines && c.lines.best.length >= 1);
    ok('both halves of the lesson are on screen', /\S/.test(text('.tline.tl-bad')) && /\S/.test(text('.tline.tl-good')), text('.result'));
    ok('no pawn number on the board', !/[+-]\d+\.\d/.test(text('#ebar-lab')));
    const idx0 = c.view.idx;
    await sleep(3200);
    ok('the answer line plays forward by itself', T.card().view.idx > idx0 || T.card().view.line !== 'best', 'idx ' + idx0 + ' -> ' + T.card().view.idx);
    click('.tline.tl-bad');
    await sleep(200);
    ok('tapping the red line plays your game move', T.card().view.line === 'refute');
    ok('the red arrow shows alone at the start of its line', !!$('#bwrap .bad-arrow') && !$('#bwrap .good-arrow'));

    /* ── the next card: the game move again, then misses and escalation ─ */
    click('[data-act=next]');
    c = await until(() => { const x = T.card(); return (x.phase === 'guess' || x.phase === 'check') && x.idx === 1 ? x : null; }, 30000);
    ok('Next opens the second card', !!c);
    if (c && c.phase === 'check') {
      click('[data-act=checkShow]');
      c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 8000);
      ok('Show me plays the reply and moves on', !!c);
    }
    if (c) {
      T.play(c.played);
      await until(() => T.card().misses === 1, 4000);
      ok('replaying the game move is explained as the game move', /game move again/i.test(text('#cpanel')), text('.verdict'));
      ok('the game-move message never names the answer', text('.verdict').indexOf(T.ev('sanOf(ui.session.active.pre, ui.session.active.best)')) === -1, text('.verdict'));
      await until(() => T.card().phase === 'guess', 8000);
      const others = legalOther(c);
      ok('there are other legal moves to try', others.length >= 2, String(others.length));
      T.play(others[0]);
      await until(() => T.card().misses === 2 || T.card().phase === 'done', 15000);
      const c2 = T.card();
      if (c2.phase !== 'done') {
        ok('the second miss brings a hint', c2.hints >= 1 && !!$('.hint-note'), 'hints ' + c2.hints);
        await until(() => T.card().phase === 'guess', 8000);
        const more = legalOther(c).filter((u) => u !== others[0]);
        T.play(more[0]);
        const c3 = await until(() => { const x = T.card(); return x.phase === 'done' ? x : null; }, 20000);
        ok('the third miss shows the answer', !!c3 && c3.result === 'fail', c3 && c3.result);
        ok('a revealed card says what the answer is', /answer is/i.test(text('#cpanel')));
      } else ok('a close alternative was accepted as solved', c2.result !== 'fail');
      click('[data-act=next]');
    }

    /* ── skip, reload-resume and the recap ───────────────────────────── */
    c = await until(() => { const x = T.card(); return x.phase === 'guess' || x.phase === 'check' ? x : null; }, 30000);
    if (c) {
      const before = c.idx;
      click('[data-act=menu]');
      await sleep(150);
      click('[data-act=skip]');
      c = await until(() => { const x = T.card(); return (x.phase === 'guess' || x.phase === 'check') && x.idx === before + 1 ? x : (x.finished ? x : null); }, 30000);
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
    c = await until(() => { const x = T.card(); return x.phase === 'guess' || x.phase === 'check' ? x : null; }, 30000);
    ok('resume reopens an unanswered card', !!c && c.result === null);
    /* finish quickly: reveal the rest */
    for (let guard = 0; guard < 40; guard++) {
      const x = T.card();
      if (x.finished || !x.key && x.session === false) break;
      if (x.phase === 'check') click('[data-act=checkShow]');
      else if (x.phase === 'guess') click('[data-act=reveal]');
      else if (x.phase === 'done') click('[data-act=next]');
      await sleep(900);
      if (T.card().finished) break;
    }
    await until(() => T.card().finished || !!$('.recap-item'), 20000);
    ok('the session ends in a recap', !!$('.recap-item') || /solved/i.test(text('#trainbox')), text('#trainbox').slice(0, 80));
    ok('the recap offers to play a game', !!$('.recap-acts .btn-big'));
    ok('reveal-only cards do not earn the day on their own', T.ev('(ui.session && ui.session.attempted || 0) >= 3') || T.ev('dayLoad().sessions || 0') === sessionsBefore);
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
    c = await until(() => { const x = T.card(); return x.phase === 'guess' || x.phase === 'check' ? x : null; }, 30000);
    if (c && c.phase === 'check') { T.play(c.check1); c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 8000); }
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
