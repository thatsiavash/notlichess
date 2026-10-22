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
  /* the 15-word rule's count (as test/copylint.js counts): a move in words ("rook to g1", tier 1) is one word */
  const MOVE_WORDS = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling\b/gi;
  const countWords = (t) => String(t || '').replace(MOVE_WORDS, 'Mv').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
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
     and the box keeps the height it had when the card opened, so nothing below it moves; no bar button cuts
     its label */
  /* the words' entrance (a fade and a 6 px rise over 150 ms, F4.4) is motion, not layout: it is run to its end
     before the layout is measured */
  const settleWords = () => { try { document.getAnimations().forEach((x) => { const t = x.effect && x.effect.target; if (t && t.closest && t.closest('#cband')) x.finish(); }); } catch (e) {} };
  const bandFits = (what) => {
    settleWords();
    const bx = $('#cband .card-task'), rows = document.querySelectorAll('#cband .bd-r1, #cband .bd-r2, #cband .bd-cap');
    const cut = !bx || bx.scrollHeight > bx.clientHeight || [].some.call(rows, (r) => r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1);
    if (cut) W.fit.push(what + ': ' + (bx ? bx.innerText.replace(/\n+/g, ' / ') : 'no band'));
    /* the board's label (2.1), when there is one: whole, on the board, its words inside its pill */
    const lb = $('#bwrap .blabel'), bd = $('#bwrap .board');
    if (lb && bd) {
      const r = lb.getBoundingClientRect(), q = bd.getBoundingClientRect();
      if (r.left < q.left - 0.5 || r.top < q.top - 0.5 || r.right > q.right + 0.5 || r.bottom > q.bottom + 0.5 || lb.scrollWidth > lb.clientWidth + 1) W.fit.push(what + ': the label "' + lb.textContent + '" is cut or off the board');
    }
    if (bx && W.h0 == null) W.h0 = bx.offsetHeight;
    else if (bx && bx.offsetHeight !== W.h0) W.fit.push(what + ': the band is ' + bx.offsetHeight + ' px tall, not ' + W.h0);
    /* every button of the bar shows its whole label beside its icon (F3.1) */
    [].forEach.call($$('#cbar a'), (b) => { if (b.offsetParent && b.scrollWidth > b.clientWidth + 1) W.fit.push(what + ': the button "' + b.textContent.trim() + '" is cut (' + b.scrollWidth + ' > ' + b.clientWidth + ')'); });
    layoutCheck(what);
  };
  /* the layout at this size, for every state the run reaches: on the phone grid (360 x 640, 390 x 844)
     nothing but the board's own marks and label sits on the board, and the gold button is wholly on
     screen and on top; on the desktop grid (1024 x 768, 1280 x 900) the side column never overlaps the
     board; on every screen nothing scrolls sideways. The Coach Panel (F4.1): on a phone its top 8 to 16
     px under the board (under its material strip, release 3), at 360 x 640 the board 340 px or more and the panel 96 or more; on the desktop
     the panel level with the board's top and the bar's foot with the board's; everywhere the tag row and
     the strip keep their place in every state of a card (exploring aside). Run in each real-page pass,
     not in CI */
  W.lay = [];
  W.pos = {};
  const rectOf = (e) => e.getBoundingClientRect();
  const meets = (r, q) => r.width > 0 && r.height > 0 && r.left < q.right - 1 && q.left < r.right - 1 && r.top < q.bottom - 1 && q.top < r.bottom - 1;
  const phoneGrid = () => matchMedia('(max-width: 860px)').matches;
  const shown = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0; };
  /* the screen's own size: a phone widens innerWidth to fit a page that overflows, the layout viewport
     (clientWidth) keeps the device's width */
  const vw = () => document.documentElement.clientWidth, vh = () => document.documentElement.clientHeight;
  function layoutCheck(what) {
    settleWords();
    const de = document.documentElement;
    if (Math.max(de.scrollWidth, document.body.scrollWidth) > vw() + 1) W.lay.push(what + ': the page scrolls sideways, ' + Math.max(de.scrollWidth, document.body.scrollWidth) + ' px wide');
    const bd = $('#bwrap svg.board');
    if (!bd) return;
    const q = rectOf(bd);
    if (phoneGrid()) {
      ['#ctop', '#cband', '#cstrip', '#cbar', '#ckeys', '#xp', '#ebar', '#overlay .notice'].forEach((sel) => [].forEach.call($$(sel), (e) => {
        if (shown(e) && meets(rectOf(e), q)) W.lay.push(what + ': ' + sel + ' meets the board (' + ['top', 'bottom'].map((k) => Math.round(rectOf(e)[k])).join('-') + ' against ' + Math.round(q.top) + '-' + Math.round(q.bottom) + ')');
      }));
      const pb = $('#cbar .btn-big');
      if (pb && shown(pb)) {
        const r = rectOf(pb), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw() + 0.5 || r.bottom > vh() + 0.5) W.lay.push(what + ': the gold button is not wholly on screen (' + [r.top, r.bottom].map(Math.round).join('-') + ')');
        else if (!hit || !(hit === pb || pb.contains(hit))) W.lay.push(what + ': the gold button is covered by ' + (hit ? hit.className || hit.tagName : 'nothing'));
      }
      const co = $('#ccoach');
      if (co && shown(co)) {
        /* (release 3: under the material strip that hangs under the board) */
        const mb = $('#mbot'), c = rectOf(co), gap = c.top - (mb && shown(mb) && rectOf(mb).height ? rectOf(mb).bottom : q.bottom);
        /* beside the board on a phone held sideways, else under it */
        if (c.left < q.right - 1 && (gap < 7.5 || gap > 16.5)) W.lay.push(what + ': the panel\'s top is ' + Math.round(gap) + ' px under the board');
        if (vw() <= 360 && vh() <= 640 && (q.width < 339.5 || c.height < 95.5)) W.lay.push(what + ': at 360 x 640 the board is ' + Math.round(q.width) + ' px and the panel ' + Math.round(c.height));
        /* a phone held upright: the panel stops at 176 px, or at the room it has where that is less (the
           design lead's review of slice 4); exploring fills to the bar */
        const pn = $('#cpanel');
        if (pn && vh() >= 600 && c.left < q.right - 1 && !$('.card.xp-card')) {
          const ps = getComputedStyle(pn), room = pn.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom), want = Math.max(96, Math.min(176, room));
          if (Math.abs(c.height - want) > 1.5) W.lay.push(what + ': the panel is ' + Math.round(c.height) + ' px tall, not ' + Math.round(want));
        }
      }
    } else {
      ['#ctop', '#cband', '#cpanel'].forEach((sel) => { const e = $(sel); if (e && shown(e) && meets(rectOf(e), q)) W.lay.push(what + ': ' + sel + ' overlaps the board'); });
      const co = $('#ccoach'), bar = $('#cbar');
      if (co && shown(co) && Math.abs(rectOf(co).top - q.top) > 2) W.lay.push(what + ': the panel\'s top is ' + Math.round(rectOf(co).top - q.top) + ' px from the board\'s');
      if (bar && shown(bar) && !$('.card.xp-card') && Math.abs(rectOf(bar).bottom - q.bottom) > 2) W.lay.push(what + ': the bar\'s foot is ' + Math.round(rectOf(bar).bottom - q.bottom) + ' px from the board\'s');
    }
    /* the tag row and the strip keep their place in every state of a card */
    const key = T.card() && T.card().key, tg = $('#cband .bd-tags'), sp = $('#cstrip');
    if (key && tg && sp && shown(tg) && !$('.card.xp-card')) {
      const now = [Math.round(rectOf(tg).top), Math.round(rectOf(sp).top)], was = W.pos[key];
      if (!was) W.pos[key] = now;
      else if (was[0] !== now[0] || was[1] !== now[1]) W.lay.push(what + ': the tag row or the strip moved, ' + was.join('/') + ' to ' + now.join('/'));
    }
  }
  const $$ = (s) => document.querySelectorAll(s);
  /* the story: wait for step i to have landed (its caption painted) */
  const storyLanded = async (i) => {
    await until(() => { const x = T.card().story; return x && x.i === i && !x.pre && T.ev('motionUntil') <= Date.now() && text('#cband .bd-cap') === x.cap; }, 4000);
    await sleep(500);
  };
  /* one story frame as seen: its band fits, and the words on screen (caption, strip, bar labels) are 15 or fewer */
  W.story = [];
  const storyFrame = (what) => {
    bandFits('story ' + what);
    const sc = $('#cstrip').cloneNode(true);
    [].forEach.call(sc.querySelectorAll('.kb-move'), (x) => x.remove());
    const words = countWords;
    const n = words(text('#cband')) + words(sc.textContent) + [].reduce.call($$('#cbar a'), (x, b) => x + words(b.textContent), 0) + words($('#bwrap .blabel') ? $('#bwrap .blabel').textContent : '');
    if (n > 15 || !text('#cband .bd-cap')) W.story.push(what + ': ' + n + ' words, ' + text('#cband') + ' / ' + sc.textContent + ' / ' + text('#cbar'));
  };
  /* a sideways swipe on the board as a finger makes it, from its middle */
  const swipeBoard = (dx) => {
    const r = $('#bwrap').getBoundingClientRect(), p = [r.left + r.width / 2, r.top + r.height / 2];
    fire('pointerdown', p); fire('pointermove', [p[0] + dx / 2, p[1]]); fire('pointerup', [p[0] + dx, p[1]]);
  };
  /* F10.1, tier 3: the first move of a forcing line asks for their best reply. Nothing moves until a guess
     (or Their reply); the guess here is their reply itself, tapped or dragged on their piece and its square:
     its arrow at once with "your guess", then the reply on its own timeline and "You saw it: X." */
  W.asks = 0;
  const answerAsk = async (how) => {
    const x = T.card();
    if (!(x.phase === 'reply' && x.reply && x.reply.ask)) return false;
    W.asks++;
    await sleep(400);
    const b0 = $('#bwrap').innerHTML;
    await sleep(2200);
    ok('F10.1: their best reply asked for: "Right" / "Now their best reply?" beside [Their reply] (no honey button), nothing moving', !!T.card().reply && T.card().reply.ask && !T.card().reply.played && $('#bwrap').innerHTML === b0
      && text('#cband .bd-r1') === 'Right' && text('#cband .bd-r2') === 'Now their best reply?' && /^\s*Their reply\s*$/.test(text('#cbar')) && !$('#cbar .btn-big') && !$('#bwrap .marks .reply-arrow, #bwrap .marks .reply-ring'), text('#cband') + ' | ' + text('#cbar'));
    bandFits('their reply asked for');
    const u = x.reply.uci;
    if (how === 'drag') dragMove(u); else await tapMove(u);
    await sleep(200);
    const gl = $('#bwrap .blabel');
    ok('F10.1: the guess draws its arrow (labelled "your guess" where the frame has room) and nothing slides yet', !!$('#bwrap .marks .guess-arrow') && !!T.card().reply && !T.card().reply.played && (!gl || gl.textContent === 'your guess'), gl && gl.textContent);
    bandFits('their reply guessed');
    const said = await until(() => T.card().phase === 'guess' && /^You saw it: /.test(text('#cband .bd-r2')), 6000);
    ok('F10.1: their reply plays from the guess, then "Your move" / "You saw it: X."', !!said && text('#cband .bd-r1') === 'Your move' && !$('#bwrap .marks .guess-arrow'), text('#cband'));
    return true;
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
    ok('Today offers a start or a finished day', !!($('[data-act=startToday]') || $('[data-act=keepGoing]') || /Today's set is done|Nothing due/.test(text('#trainbox'))), text('#trainbox').slice(0, 120));
    ok('the header is the mark and the gear only', !!$('#bar .brand-name') && !!$('#bar [data-act=settings]') && !/▼|▲/.test(text('#bar')), text('#bar'));
    ok('Today holds the day\'s practice only: no game rows, no games list (slice D)', !$('#trainbox .lg-row') && !$('#latest') && !/Your latest games|Clean game vs/.test(text('#trainbox')), text('#trainbox').slice(0, 120));
    ok('four tabs in order, Today shown: Today, Games, Mistakes, Insights (slice D; release 3 slice G)', [].map.call($$('#views [role=tab]'), (t) => t.textContent.trim()).join('|') === 'Today|Games|Mistakes|Insights' && $('#tab-train').getAttribute('aria-selected') === 'true'
      && [].every.call($$('#views [role=tab]'), (t) => rectOf(t).right <= vw() + 0.5 && rectOf(t).top === rectOf($('#tab-train')).top), [].map.call($$('#views [role=tab]'), (t) => t.textContent.trim() + '@' + Math.round(rectOf(t).left) + '-' + Math.round(rectOf(t).right)).join(' '));
    layoutCheck('Today');
    ok('no em dash anywhere on Today', text('#main').indexOf('—') === -1);
    /* F5.1: card 1 as it opens beside its caption (the red arrow of the game move, never a hint or the answer),
       a tap on it starts; the board, Start and the week above the fold; the focus card within one scroll; no
       zero part; the game rows on two lines at most. F5.4: the tab's title counts the positions due */
    const hb = $('.hero .hero-board svg.board'), hst = $('.hero [data-act=startToday].btn-big'), hwk = $('.hero .week');
    if (hb && hst && hwk) {
      ok('Today shows card 1 as it opens: the red arrow, no hint, no answer, a tap on it starts (F5.1)', $$('.hero-board .bad-arrow').length === 1 && !$('.hero-board .good-arrow, .hero-board .threat-arrow, .hero-board [class*=ring-]')
        && $('.hero-board').getAttribute('data-act') === 'startToday' && /^First: /.test(text('.hero-cap')), text('.hero-cap'));
      ok('the board, Start and the week row above the fold, the focus card within one scroll (F5.1)', rectOf(hb).bottom <= vh() && rectOf(hst).bottom <= vh() && rectOf(hwk).bottom <= vh() && (!$('.focus') || rectOf($('.focus')).top < 2 * vh()),
        [rectOf(hb).bottom, rectOf(hst).bottom, rectOf(hwk).bottom, $('.focus') ? rectOf($('.focus')).top : '-', vh()].map((x) => Math.round(x) || x).join(' / '));
      ok('the week: Monday to Sunday, today ringed, the medal glyph at the goal (F5.1)', $$('.hero .wk-b').length === 7 && $$('.hero .wk-b.now').length === 1 && !!$('.hero .wk-goal, .hero .wk-row .medal')
        && /^\d+ of \d+ days? this week( \((your first week|since you came back)\))?( · \d+ weeks? in a row)?$/.test(text('.hero .wk-say')), text('.hero .wk-say'));
    }
    ok('Today says no zero part ("0 learned")', !/(^|\D)0 (learned|in practice|not started|practice days?|weeks? in a row)\b/.test(text('#trainbox')), text('.focus-prog'));
    /* V4.7: the focus card is one tap target with a chevron (no Practise or Details), Start the only button above the games */
    const fc = $('.focus');
    ok('the focus card is one tap target with a chevron that opens its skill (V4.7)', !fc || (fc.matches('a.focus-go[data-act=sheet]') && !!fc.querySelector('.focus-chev') && !fc.querySelector('.btn-line, .btn-big, [data-act=drill]')), fc ? fc.outerHTML.slice(0, 120) : 'no focus card');
    ok('Start is the only button above the focus card on a phone (V4.7)', innerWidth >= 600 || !fc || [].filter.call($$('#trainbox .btn-big, #trainbox .btn-line, #trainbox .btn-quiet'), (e) => shown(e) && rectOf(e).top < rectOf(fc).top).map((e) => e.getAttribute('data-act')).join(',') === 'startToday',
      [].filter.call($$('#trainbox .btn-big, #trainbox .btn-line, #trainbox .btn-quiet'), (e) => shown(e) && rectOf(e).top < (fc ? rectOf(fc).top : 0)).map((e) => e.getAttribute('data-act')).join(','));
    /* a wide screen: the focus card beside the hero, where the games were (no empty column) */
    if (innerWidth >= 1000 && fc && $('.hero')) ok('a wide Today: the focus card beside the hero, no empty column (slice D)', rectOf(fc).left > rectOf($('.hero')).right && Math.abs(rectOf(fc).top - rectOf($('.hero')).top) < 60, [rectOf($('.hero')).right, rectOf(fc).left, rectOf($('.hero')).top, rectOf(fc).top].map(Math.round).join(' / '));
    ok('the tab\'s title counts the positions due (F5.4)', document.title === (T.stats().due ? '(' + T.stats().due + ') ' : '') + 'notlichess.org', document.title + ' / ' + T.stats().due);

    /* ── the Games tab (slice D) ─────────────────────────────────────── */
    click('#tab-games');
    await until(() => $('#gamesbox .lg-row'), 8000);
    ok('the Games tab opens on its tab: #games, its panel shown and Today\'s hidden, one h1', location.hash === '#games' && $('#tab-games').getAttribute('aria-selected') === 'true' && !$('#view-games').hidden && $('#view-train').hidden
      && $$('h1').length - $$('[hidden] h1').length === 1, location.hash + ' ' + $$('h1').length);
    layoutCheck('Games');
    ok('no em dash, NaN or undefined on the Games tab', !/NaN|undefined|—/.test(text('#gamesbox')));
    const gTotal = T.ev('scopedGames().length'), gRows = $$('#gamesbox .lg-row'), gMore = $('#gamesbox [data-act=gamesMore]');
    ok('the newest 30 rows, newest first, then Show N more (never every game at once)', gRows.length === Math.min(30, gTotal) && (gTotal <= 30 ? !gMore : !!gMore && gMore.textContent === 'Show ' + Math.min(30, gTotal - 30) + ' more')
      && T.ev(`(function () { var ids = [].map.call(document.querySelectorAll('#gamesbox .lg-row'), function (r) { return r.getAttribute('data-g'); }), ts = ids.map(function (id) { return data.games.filter(function (g) { return g.id === id; })[0].ts; }); return ts.every(function (t, i) { return !i || t <= ts[i - 1]; }); })()`),
      gRows.length + ' rows of ' + gTotal + ', ' + (gMore ? gMore.textContent : 'no more'));
    ok('Check for new games at the top, the count beside the filters', !!$('#gamesbox .gl-refresh[data-act=reload]') && rectOf($('#gamesbox .gl-refresh')).bottom <= rectOf(gRows[0]).top && /^\d+ games$/.test(text('#gl-count')), text('#gl-count'));
    /* each row: two lines on a wide screen, one part a line under 640 px, nothing cut, named by its sentence in reading order */
    const rowBad = [].filter.call(gRows, (r) => { const nm = r.querySelector('.lg-name'), mt = r.querySelector('.lg-who small'), st = r.querySelector('.lg-state'), sr = r.querySelector('.sr-only');
      const lines = innerWidth >= 640 ? rectOf(r).height <= 66 : true, meta = innerWidth < 360 || mt.offsetHeight <= 21;
      return !(rectOf(r).height >= 63.5 && nm.offsetHeight <= 41 && meta && lines && st.scrollWidth <= st.clientWidth + 1 && mt.scrollWidth <= mt.clientWidth + 1
        && /^(Won against|Lost to|Drew with) [^,]+( \(\d+\))?, [^.]+\. (Rapid|Blitz|Bullet|Classical), (today|yesterday|\d{1,2} \w+( \d{4})?), (White|Black)(, \d+ moves?)?(, your rating \d+)?\.$/.test(sr.textContent)
        && /^vs .+ \d+ · you \d+$/.test(nm.textContent) && / · (White|Black) · \d+ moves?$/.test(mt.textContent)); });
    ok('each row: result, "vs opponent 1388 · you 1351", "Rapid · 27 Sept · White · 36 moves", what it holds; two lines wide, one part a line on a phone, nothing cut, read as one sentence', rowBad.length === 0,
      rowBad.slice(0, 2).map((r) => Math.round(rectOf(r).height) + ' ' + r.innerText.replace(/\n/g, ' / ')).join(' | '));
    /* a filter: losses only, the count says it; one that keeps nothing says so, and clears */
    const pick = async (k, v) => { const sl = $('#gamesbox select[data-k=' + k + ']'); sl.value = v; sl.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); };
    await pick('r', 'loss');
    ok('the Losses filter keeps the losses, the count says "N of M games"', $$('#gamesbox .lg-row').length > 0 && [].every.call($$('#gamesbox .lg-row'), (r) => !!r.querySelector('.lg-L')) && /^\d+ of \d+ games$/.test(text('#gl-count'))
      && $('#gamesbox select[data-k=r]').parentNode.classList.contains('gf-on'), text('#gl-count'));
    await pick('p', 'clean');
    ok('a filter that keeps nothing says so, with a way to clear it', /^No games match these filters\./.test(text('#gamesbox .gl-none')) && !!$('#gamesbox [data-act=gamesClear]') && /^0 of \d+ games$/.test(text('#gl-count')), text('#gamesbox .gl-none'));
    layoutCheck('Games, no game kept');
    click('#gamesbox [data-act=gamesClear]');
    await sleep(200);
    ok('Clear filters: every game again, the keyboard on the first filter', $$('#gamesbox .lg-row').length === Math.min(30, gTotal) && /^\d+ games$/.test(text('#gl-count')) && document.activeElement === $('#gamesbox select'), text('#gl-count') + ' / ' + focusName());
    T.ev("setView('train'); 'ok'");
    await sleep(300);

    /* ── a session: solve the first card ─────────────────────────────── */
    click('[data-act=startToday]') || click('[data-act=keepGoing]')
      || T.ev("startDrill({ type: 'family', fam: familyOf(patternOf(allMistakes().filter(trainable)[0].b)).key, label: 'e2e' }); 'ok'");
    let c = await until(() => { const x = T.card(); return x.phase === 'guess' ? x : null; }, 30000);
    ok('first card opens', !!c);
    if (!c) throw new Error('no card');
    ok('the first card asks for a better move, with your side to move', /Find a better move/.test(text('#main')) && T.ev('myPov(ui.session.active.it) === !!ui.session.active.st.w'), text('.card-task'));
    const san0 = T.ev('sanOf(ui.session.active.pre, ui.session.active.played)'), tier0 = T.ev('ui.session.active.tier'), r20 = text('#cband .bd-r2');
    ok('the band reads Your turn / Find a better move than the game move (tier 1: in words where they fit, never in notation)', text('#cband .bd-r1') === 'Your turn'
      && (tier0 === 1 ? /^Find a better move/.test(r20) && r20 === T.ev('displayFor(ui.session.active).row2') && r20.indexOf(san0) < 0 : r20 === 'Find a better move than ' + san0 + '.'), text('#cband'));
    bandFits('the card opens');
    /* S18: a fresh profile's first card names the red arrow once ("Your game move"), beside it on the
       board, hidden from screen readers (the band says it), and remembers that it did */
    const lb0 = await until(() => $('#bwrap .blabel'), 3000);
    ok('the first card ever labels the game arrow "Your game move"', !!lb0 && lb0.textContent === 'Your game move' && lb0.parentNode.getAttribute('aria-hidden') === 'true', lb0 && lb0.textContent);
    ok('the label is remembered as seen', localStorage.getItem('nl:tip:game') === '1');
    const wordsOn = () => { const w = countWords; return w(text('#cband')) + [].reduce.call($$('#cbar a'), (x, b) => x + w(b.textContent), 0) + w(lb0 ? lb0.textContent : ''); };
    ok('with the label, at most 15 words on screen', wordsOn() <= 15, wordsOn());
    /* S20: the board's name is built from its marks, and never names the answer before it */
    const al0 = $('#bwrap svg.board').getAttribute('aria-label') || '', best0 = T.ev('sanOf(ui.session.active.st, ui.session.active.best)');
    ok('the board\'s aria-label says who moves and names the red arrow, never the answer', /^(White|Black) to move\. Red arrow: your game move, \w+ [a-h][1-8] to [a-h][1-8]\./.test(al0)
      && al0.split(/[\s.]+/).indexOf(best0) < 0 && !/answer|Green arrow/.test(al0), al0);
    /* the desktop key line: the keys that work now, 12 px; none on a phone */
    const kl = $('#ckeys');
    if (innerWidth > 860) {
      ok('the key line lists the keys that work now, in 12 px: no Enter on a card asking (F4.1)', !!kl && kl.textContent === T.ev('displayFor(ui.session.active).keys') && kl.textContent === '? hint' && getComputedStyle(kl).fontSize === '12px', kl && kl.textContent);
      /* F4.1: Enter on a fresh desktop card does nothing: no answer, no hint */
      await sleep(600);
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(900);
      ok('Enter on a fresh desktop card does nothing', T.card().phase === 'guess' && T.card().hints === 0 && T.card().result === null, T.card().phase + ' ' + T.card().hints + ' ' + T.card().result);
    } else ok('no key line on a phone', !!kl && getComputedStyle(kl).display === 'none');
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
    /* F4.4: the found moment's pop, noted as the verdict's disc takes it: once, with the board still */
    const pops = [], popObs = new MutationObserver(() => {
      const d = $('#cband .bd-disc.fx-found, #cband .bd-disc.fx-found3');
      if (d && !d.dataset.seen) { d.dataset.seen = '1'; pops.push({ still: !T.ev('motionHold') && T.ev('motionUntil') <= Date.now(), late: Date.now() - T.ev('motionUntil') }); }
    });
    popObs.observe($('#cband'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const want = c.sol ? c.sol : [c.best];
    for (let i = 0; i < want.length; i += 2) {
      await until(() => T.card().phase === 'guess', 6000);
      await tapMove(want[i]);
      await until(() => T.card().phase === 'done' || T.card().solIdx > i, 6000);
      await answerAsk('tap');
    }
    c = await until(() => { const x = T.card(); return x.phase === 'done' ? x : null; }, 15000);
    ok('playing the answer solves the card', !!c && (c.result === 'first' || c.result === 'hint'), c && c.result);
    await sleep(600);
    bandFits('the card solved');
    ok('the solved card shows the best line', !!c && !!c.lines && c.lines.best.length >= 1);
    /* S0: the verdict, then the game move's ghost, then R4 and Details; See why and Continue */
    ok('the solve lands as a tick on the square, with the band saying so', !!$('#bwrap .marks .badge-good') && /^(Found it|You got there|Found with a hint)$/.test(text('#cband .bd-r1')), text('#cband'));
    await until(() => T.card().settle === 2, 3000);
    await sleep(300);
    popObs.disconnect();
    ok('the found pop runs once, with the board still (F4.4)', pops.length === 1 && pops[0].still, JSON.stringify(pops));
    ok('the settled result: the game move\'s ghost where it went', !!$('#bwrap .board .ghost-piece') === (T.ev('s0Marks(ui.session.active, ui.session.active.st).ghosts.length') > 0)
      && !!$('#bwrap .marks .badge-good'), T.ev('JSON.stringify(s0Marks(ui.session.active, ui.session.active.st))'));
    ok('the settled band reads the result over R4', /^(Found it|You got there|Found with a hint)$/.test(text('#cband .bd-r1')) && /\S/.test(text('#cband .bd-r2')) && !!$('#cstrip [data-act=details]')
      && /^See why\s*(Continue|Finish)$/.test(text('#cbar').replace(/\n/g, ' ').trim()), text('#cband') + ' | ' + text('#cstrip') + ' | ' + text('#cbar'));
    bandFits('the card settled');
    ok('no pawn number on the board', !/[+-]\d+\.\d/.test(text('#ebar-lab')));
    /* the Details sheet: both long sentences, the game, the pattern, the way to explore; from the strip, or,
       in a panel under 120 px where the strip's link gives way (F4.1), from the ••• menu */
    const viaStrip = !!$('#cstrip [data-act=details]') && $('#cstrip [data-act=details]').offsetParent !== null;
    if (viaStrip) click('#cstrip [data-act=details]');
    else { click('#ctop [data-act=menu]'); await until(() => $('#ctop [data-act=details]'), 3000); click('#ctop [data-act=details]'); }
    await until(() => $('#overlay .sheet'), 3000);
    /* both sentences as Details says them (each material claim the card face's own) */
    /* (V2.5: tier 1 says them in words, with no figure) */
    const sn = T.card().sentences, snBest = sn && T.ev('(function (a) { var s = detailsBest(a, a.cls.sentences, a.lines.best.san[0]); return a.tier === 1 ? detailsWords(a, s) : s; })(ui.session.active)');
    const snGame = sn && T.ev('(function (a) { var s = detailsGame(a); return a.tier === 1 ? detailsWords(a, s.replace(/ \\(\\d+% to \\d+%\\)/g, "")) : s; })(ui.session.active)');
    ok('the Details sheet holds both sentences', !!sn && text('#overlay .sheet').indexOf(snBest) !== -1 && text('#overlay .sheet').indexOf(snGame.replace(/ \(\d+% to \d+%\)/g, '')) !== -1 && !!$('#overlay .sheet .ctx'),
      text('#overlay .sheet').slice(0, 200));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    ok('Escape closes Details', !$('#overlay .sheet'));
    /* Esc hands the keyboard to the honey button, so Enter presses Continue as the key line says (back on the
       strip's link or the ••• button, Enter would open Details again: V5.3); a click outside still gives it back
       to its opener (below) */
    const honeyBtn = $('#cbar .btn-big[data-act]');
    ok('Escape on Details gives the keyboard to the honey button (' + (viaStrip ? 'opened from the strip' : 'opened from the ••• menu, in a panel under 120 px') + ')', !!honeyBtn && document.activeElement === honeyBtn && /^Enter: (Continue|Finish)/.test(text('#ckeys') || 'Enter: ' + honeyBtn.textContent.trim()),
      (document.activeElement && document.activeElement.outerHTML.slice(0, 80)) + ' | ' + text('#ckeys'));
    /* from the ••• menu: the pattern named once (its chip), and the scrim gives focus back to the ••• button */
    click('#ctop [data-act=menu]');
    await until(() => $('#ctop [data-act=details]'), 3000);
    click('#ctop [data-act=details]');
    await until(() => $('#overlay .sheet'), 3000);
    const chip = $('#overlay .sheet .pchip'), pname = chip ? chip.textContent.replace(/ ›$/, '') : '?';
    ok('the Details sheet names the pattern once, by its chip', !!chip && text('#overlay .sheet').split(pname).length === 2 && !$('#overlay .sheet h3'), text('#overlay .sheet').slice(0, 120));
    $('#overlay .scrim').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(200);
    ok('closing Details from the menu gives the keyboard back to the ••• button', !$('#overlay .sheet') && document.activeElement === $('#ctop [data-act=menu]'), document.activeElement && document.activeElement.outerHTML.slice(0, 80));
    /* nothing moves on its own: after the solving move lands, the board and the band stay */
    await sleep(600);
    const frame = () => ($('#bwrap') ? $('#bwrap').innerHTML : '') + '|' + text('.card-task') + '|' + JSON.stringify(T.card().view);
    const f0 = frame();
    await sleep(5000);
    ok('board and band unchanged 5 s after an answer', frame() === f0, JSON.stringify(c.view) + ' -> ' + JSON.stringify(T.card().view));
    /* the story (S12): G1 is the game move with its red arrow as the trail, and the reply it allows; then one ply per tap */
    /* release 3: a card found opens See why on why the move works (B1, the green arrow, the Better segment
       on in the strip, "Why it works" where it has room); the strip's Game is one tap away */
    press('#cbar [data-act=seeWhy]');
    const gB = T.ev('buildStory(ui.session.active).g');
    await storyLanded(gB);
    ok('See why on a card found opens on B1, why the move works: its caption, the Better segment on', T.card().story.i === gB && $('#cband .card-task').classList.contains('k-sbetter') && /^Better: /.test(text('#cband .bd-cap'))
      && !!$('#cstrip .st-better.on') && /^(Why it works|Better)/.test(text('#cstrip .st-better')), JSON.stringify(T.card().story) + ' ' + text('#cband') + ' / ' + text('#cstrip'));
    storyFrame('B1');
    click('#cstrip [data-act=storyJump][data-k=game]');
    await storyLanded(0);
    const sg = T.card().story, g1threat = T.ev('!!buildStory(ui.session.active).threat');
    /* a card with a danger opens on its still danger frame (F1.5): no game arrow yet, the dashed arrows into
       what is attacked and its red rings, its caption; G1 is the next step */
    const dfr = JSON.parse(T.ev('JSON.stringify((function (s) { return s.df ? { arrows: s.df.arrows.length, rings: s.df.rings.filter(function (r) { return r.kind === "attacked"; }).length } : null; })(buildStory(ui.session.active).steps[0]))'));
    if (dfr) {
      ok('See why opens on the danger frame: no game arrow, its dashed arrows and red rings, its caption', sg.i === 0 && !$('#bwrap .bad-arrow') && $$('#bwrap .threat-arrow').length === dfr.arrows
        && $$('#bwrap .ring-attacked').length === dfr.rings && $('#cband .card-task').classList.contains('k-sgame') && text('#cband .bd-cap') === sg.cap, JSON.stringify(sg) + ' ' + JSON.stringify(dfr) + ' ' + text('#cband'));
      storyFrame('the danger frame');
      press('#cbar [data-act=storyFwd]');
      await storyLanded(1);
    }
    const g1 = dfr ? 1 : 0, s1 = T.card().story;
    ok('See why enters the story at G1 (after the danger frame, when there is one), its red arrow kept as the trail, the threat when there is one', !!s1 && s1.i === g1 && $$('#bwrap .bad-arrow').length === 1 && $$('#bwrap .threat-arrow').length === (g1threat ? 1 : 0) && !$('#bwrap .good-arrow')
      && $('#cband .card-task').classList.contains('k-sgame') && text('#cband .bd-cap') === s1.cap, JSON.stringify(s1) + ' ' + text('#cband'));
    ok('the story\'s bar is ‹, Next move ›, Continue, with the keyboard on Next move', /^‹\s*Next move ›\s*(Continue|Finish)$/.test(text('#cbar').replace(/\n/g, ' ').trim()) && document.activeElement === $('#cbar [data-act=storyFwd]'), text('#cbar') + ' / ' + focusName());
    storyFrame('G1');
    /* every step: one ply a tap, a caption that fits, at most 15 words; then Continue in gold, with the keyboard */
    for (let i = g1 + 1; i < sg.n; i++) {
      press('#cbar [data-act=storyFwd]');
      await storyLanded(i);
      storyFrame('step ' + (i + 1));
    }
    /* switched off, Next move is outlined and grey: Continue is the one gold button */
    const offBg = $('#cbar .btn-off') ? getComputedStyle($('#cbar .btn-off')).backgroundColor : '', goldBg = $('#cbar [data-act=next]') ? getComputedStyle($('#cbar [data-act=next]')).backgroundColor : '';
    ok('the last step\'s Next move is outlined, not gold', !!$('#cbar .btn-off.btn-line') && offBg !== goldBg && $$('#cbar .btn-big').length === 1, offBg + ' / ' + goldBg);
    ok('a story step moves one ply a tap, and Next move ends at the last step', T.card().story.i === sg.n - 1 && !!$('#cbar .btn-off') && /Next move/.test($('#cbar .btn-off').textContent)
      && document.activeElement === $('#cbar [data-act=next]') && $('#cbar [data-act=next]').classList.contains('btn-big') && $('#cband .card-task').classList.contains(sg.n - 1 >= sg.g ? 'k-sbetter' : 'k-sgame'), focusName());
    ok('every story frame: a caption that fits its band, at most 15 words on screen', W.story.length === 0, W.story.slice(0, 3).join(' | '));
    /* back: ‹, ← and a right swipe; forward: a left swipe; Esc to the settled result */
    if (sg.n > 2) {
      click('#cbar [data-act=storyBack]');
      await storyLanded(sg.n - 2);
      ok('‹ steps back one ply', T.card().story.i === sg.n - 2, JSON.stringify(T.card().story));
      swipeBoard(-120);
      await storyLanded(sg.n - 1);
      ok('a left swipe steps forward', T.card().story.i === sg.n - 1, JSON.stringify(T.card().story));
      swipeBoard(120);
      await storyLanded(sg.n - 2);
      ok('a right swipe steps back', T.card().story.i === sg.n - 2, JSON.stringify(T.card().story));
    }
    /* a tap on a piece never steps: the outline, and N1 in the strip when the words allow it */
    const sNow = T.card().story.i, pq = T.ev('(function (a) { var st = doneBoard(a); for (var q = 0; q < 64; q++) if (st.b[q]) return q; return -1; })(ui.session.active)');
    fingerTap(pq);
    await sleep(300);
    ok('board taps never change the step', T.card().story.i === sNow && !!$('#bwrap .marks .nope-box'), JSON.stringify(T.card().story));
    await sleep(2600);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    ok('Esc goes back to the settled result', T.card().view.mode === 's0' && !!$('#cstrip [data-act=details]'), JSON.stringify(T.card().view));
    /* Next move takes the first tap it can be seen to take: See why, then a click the moment its bar is on screen */
    await sleep(600);
    const wr = $('#cbar [data-act=seeWhy]') ? $('#cbar [data-act=seeWhy]').getBoundingClientRect() : null;
    click('#cbar [data-act=seeWhy]');
    /* a double tap's second half, 200 ms on, finds the bar faded out: it reaches no button */
    await sleep(200);
    const wh = wr && document.elementFromPoint(wr.x + wr.width / 2, wr.y + wr.height / 2), whAct = wh && wh.closest && wh.closest('#cbar [data-act]');
    ok('a double tap on See why reaches no button with its second tap', !!wr && !whAct && T.card().story && T.card().story.i === gB, whAct ? whAct.getAttribute('data-act') : 'none');
    if (gB < sg.n - 1) {
      await until(() => { const f = $('#cbar [data-act=storyFwd]'); return !!f && !$('#cbar').classList.contains('stale') && !f.classList.contains('stale'); }, 4000, 16);
      click('#cbar [data-act=storyFwd]');
      await storyLanded(gB + 1).catch(() => {});
      ok('the first visible tap on Next move steps', !!T.card().story && T.card().story.i === gB + 1, JSON.stringify(T.card().story));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);

    /* ── exploring (S14): from Details or •••, at the card position with you to move, the way back ─ */
    click('#cstrip [data-act=details]');
    await until(() => $('#overlay .sheet'), 3000);
    const inv = $('#overlay [data-act=explore]');
    ok('Details offers to try your own moves', !!inv && inv.textContent.trim() === 'Try your own moves with Stockfish ›', inv && inv.textContent);
    ok('the answered board is still static before exploring', $('#bwrap').classList.contains('static'));
    if (inv) { recOff(); inv.click(); }
    const xr = await until(() => { const x = T.explore(); return x && x.lines && x.lines.length ? x : null; }, 10000);
    ok('exploring starts at the card position, with you to move', !!xr && xr.at === 0 && xr.fens[0] === T.ev('stateFen(ui.session.active.pre)') && T.ev('ui.session.active.explore.st.w === myPov(ui.session.active.it)'), xr && xr.fens[0]);
    ok('the band reads Try your own moves / Stockfish rates each move.', text('#cband .bd-r1') === 'Try your own moves' && text('#cband .bd-r2') === (T.ev('ui.session.active.tier') === 1 ? 'The computer' : 'Stockfish') + ' rates each move.' && !!$('#cband .d-king'), text('#cband'));
    await sleep(400);
    const pickL = T.ev('ui.session.active.tier') === 1 ? 'Computer\'s pick' : 'Stockfish\'s pick';
    ok('the bar is ‹, ' + pickL + ' at the trail\'s end, Continue', new RegExp('^‹\\s*' + pickL + '\\s*(Continue|Finish)$').test(text('#cbar').replace(/\n/g, ' ').trim()), text('#cbar'));
    const fr = $('#cbar .xp-fwd'), rg = document.createRange();
    if (fr) rg.selectNodeContents(fr);
    ok('its label stays on one line', !!fr && rg.getClientRects().length === 1, fr && rg.getClientRects().length);
    ok('the keyboard starts on the band\'s heading, not on a row', document.activeElement && document.activeElement.id === 'result-h', document.activeElement && (document.activeElement.id || document.activeElement.className));
    ok('exploring shows Stockfish\'s best moves', !!xr && document.querySelectorAll('#xp .xp-row:not(.skel)').length >= 2);
    ok('the panel says Stockfish\'s sentence and keeps Back to the lesson', text('#xp .xp-say') === T.explore().say && !!$('#xp [data-act=exploreOff]'), text('#xp .xp-say'));
    ok('exploring makes the board live', !$('#bwrap').classList.contains('static'));
    layoutCheck('exploring');
    ok('rows say your winning chances or words, never a pawn number', !/[+-]\d+\.\d/.test(text('#xp')) && (T.ev('ui.session.active.tier') === 1 || /You \d{1,2}%|mate in \d/.test(text('#xp .xp-rows'))), text('#xp .xp-rows'));
    ok('one arrow at a time while exploring', document.querySelectorAll('#bwrap .ghost-arrow, #bwrap .good-arrow, #bwrap .bad-arrow').length <= 1);
    if (innerWidth <= 860) {
      /* the analysis fills the Coach Panel under its band, to the panel's foot (F4.1): as many rows as
         fit, one at least whenever the panel has room for one, none past its foot nor under the bar */
      const bb = $('#bwrap .board').getBoundingClientRect(), xb = $('#xp').getBoundingClientRect(), cb = $('#cbar').getBoundingClientRect(), co = $('#ccoach').getBoundingClientRect();
      const rws = [].filter.call($$('#xp .xp-row'), (r) => r.offsetParent !== null), lb = rws.length ? rws[rws.length - 1].getBoundingClientRect().bottom : 0;
      const room = co.bottom - 8 - ($('#xp .xp-say') ? $('#xp .xp-say').getBoundingClientRect().bottom : co.bottom);
      ok('on a phone the analysis fills the panel from under the board to its foot, nothing under the bar', xb.top >= bb.bottom - 1 && (rws.length >= 1 || room < 44) && (!rws.length || (lb <= co.bottom + 0.5 && co.bottom - lb < 62)) && co.bottom <= cb.top + 0.5,
        [bb.bottom, xb.top, lb, co.bottom, cb.top, Math.round(room)].map(Math.round).join(' / '));
      ok('the page does not scroll under the bar', document.documentElement.scrollHeight <= innerHeight + 1, document.documentElement.scrollHeight + ' / ' + innerHeight);
    }
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
      /* at the trail's end, the middle button plays Stockfish's pick */
      const pk = await until(() => { const x = T.explore(); return x && x.at === 1 && x.lines && x.lines.length ? x.lines[0].pv[0] : null; }, 15000);
      await sleep(600);
      click('#cbar [data-act=xpFwd]');
      await sleep(600);
      ok('Play Stockfish\'s pick plays the gold arrow\'s move', T.explore() && T.explore().at === 2 && T.ev('ui.session.active.explore.nodes[2].mv.uci') === pk, pk);
      click('[data-act=xpBack]');
      await sleep(700);
      ok('‹ steps back inside the exploration; › reads ›', T.explore() && T.explore().at === 1 && /^‹\s*›\s*(Continue|Finish)$/.test(text('#cbar').replace(/\n/g, ' ').trim()), text('#cbar'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
      ok('Esc returns to the lesson', !T.explore() && T.card().view.mode === 's0' && !!$('#cstrip [data-act=details]'), JSON.stringify(T.card().view));
      /* from the ••• menu, from a story step: Back to the lesson returns to that step */
      press('#cbar [data-act=seeWhy]');
      /* (the step it opens on: B1 on a card found, release 3) */
      await storyLanded(T.ev('ui.session.active.view.i'));
      const sv = JSON.stringify(T.card().view);
      click('#ctop [data-act=menu]');
      await until(() => $('#ctop [data-act=explore]'), 3000);
      ok('the ••• menu offers Try your own moves', !!$('#ctop [data-act=explore]') && $('#ctop [data-act=explore]').textContent === 'Try your own moves');
      click('#ctop [data-act=explore]');
      await until(() => T.explore(), 3000);
      ok('••• opens exploring at the card position', !!T.explore() && T.explore().fens[0] === T.ev('stateFen(ui.session.active.pre)'));
      click('#xp [data-act=exploreOff]');
      await sleep(300);
      ok('Back to the lesson returns to the story step it came from', !T.explore() && JSON.stringify(T.card().view) === sv, JSON.stringify(T.card().view) + ' vs ' + sv);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(500);
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
      /* at tier 1 the card may open on its First look (hint 1 drawn): the note then takes its short form, and the band goes back to the hint */
      const before4 = text('#cband .bd-r2');
      tapSq(opp);
      await sleep(300);
      const t4 = T.ev('NOTE_COPY.T4(ui.session.active)');
      /* the outline is drawn unless a hint's rings are already on the board (boardOptsFor) */
      ok('a tap on their piece says which side you are, and grades nothing', t4.indexOf(text('#cband .bd-r2')) !== -1 && (!!$('#bwrap .marks .nope-box') || T.card().hints > 0) && T.card().phase === 'guess' && T.card().misses === 0,
        text('#cband') + ' / ' + T.card().phase + ' ' + T.card().misses);
      bandFits('T4');
      await sleep(2600);
      /* (release 2, B8: a First look keeps its task in row 1, the hint's words in row 2) */
      ok('the task (or the First look\'s hint) is back after it, and the outline gone', text('#cband .bd-r2') === before4 && (/^Find a better move/.test(before4) || /^Hint 1 of 2/.test(text('#cband .bd-r1')) || /^Find a better move/.test(text('#cband .bd-r1'))) && !$('#bwrap .marks .nope-box'), text('#cband'));
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
      /* the reason's marks come in their own beat (marks only): the board's name follows them */
      const al1 = $('#bwrap svg.board').getAttribute('aria-label') || '';
      ok('the board\'s aria-label follows the reason\'s marks', /Dashed red arrow: /.test(al1) === !!$('#bwrap .marks .threat-arrow') && /Red cross: your move is not it\./.test(al1), al1);
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
      /* Show the answer never takes Try again's place under the keyboard (F4.1): the keyboard goes to the task */
      ok('after Try again the focus is on the task, never the typed-move field nor Show the answer', !!document.activeElement && document.activeElement.id === 'task-h', focusName());
      /* (V2.3: at tier 1 the automatic hint comes with this Try again, after miss 1, and counts as it shows) */
      if (T.ev('ui.session.active.tier') === 1) {
        const c1b = T.card();
        ok('at tier 1 the automatic hint is on after the Try again it comes with (miss 1), the band saying which', c1b.hints >= 1 && new RegExp('^Hint ' + c1b.hints + ' of [23]').test(text('#cband .bd-r1')), 'hints ' + c1b.hints + ', ' + text('#cband'));
      }
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
        /* the automatic hint is the next one not yet shown (F1.1): Hint 2 after a First look's Hint 1 */
        /* (V2.3: it counts as it shows, here; "of 3" at tier 1, where Hint 3 follows) */
        /* (at tier 1 it came after miss 1: a hint in words only from before the last miss gives the task back, T1) */
        const hm0 = JSON.parse(T.ev('JSON.stringify(hintMarks(ui.session.active))')), words0 = !hm0.rings.length && !hm0.arrows.length;
        ok('the automatic hint is on after the Try again it comes with (tier 1 or 2), the band saying which', tier === 3 ? c2b.hints === 0 : tier === 2 ? c2b.hints >= 1 && new RegExp('^Hint ' + c2b.hints + ' of 2').test(text('#cband .bd-r1'))
          : c2b.hints >= 1 && (new RegExp('^Hint ' + c2b.hints + ' of [23]').test(text('#cband .bd-r1')) || (words0 && text('#cband .bd-r1') === 'Your turn')), 'tier ' + tier + ', hints ' + c2b.hints + ', ' + text('#cband'));
        bandFits('a hint');
        /* the hint draws what hintMarks says (the danger, F1.1 and F1.3: red rings on what is attacked or the
           mating square and dashed arrows into them; else a ring and dashed arrow for the danger the game move
           runs into, a dashed gold ring for a prize, or nothing), never on the answer's to-square, nor on its
           from-square but for the danger's red ring on a piece of yours and the arrows into it */
        const hm = JSON.parse(T.ev('JSON.stringify(hintMarks(ui.session.active))'));
        const n = (s) => document.querySelectorAll('#bwrap .marks ' + s).length;
        const bsq = [sqOf(c.best.slice(0, 2)), sqOf(c.best.slice(2, 4))];
        const mine = (q) => T.ev('(function (a) { var p = a.st.b[' + q + ']; return !!p && isW(p) === myPov(a.it); })(ui.session.active)');
        const att = hm.rings.filter((m) => m.kind === 'attacked');
        const onAnswer = hm.rings.filter((m) => m.kind !== 'hint').some((m) => m.sq === bsq[1] || (m.sq === bsq[0] && !(m.kind === 'attacked' && mine(m.sq))))
          || hm.arrows.some((m) => m.from === bsq[0] || m.from === bsq[1] || m.to === bsq[1] || (m.to === bsq[0] && !att.some((r) => r.sq === m.to && mine(m.to))));
        ok('the hint draws its marks on the board, off the answer\'s squares', n('.ring-threat') === (hm.danger ? 1 : 0) && n('.threat-arrow') === hm.arrows.length && n('.ring-target') === (hm.prize ? 1 : 0)
          && n('.ring-attacked') === att.length && !onAnswer, JSON.stringify(hm) + ' drawn ' + [n('.ring-threat'), n('.threat-arrow'), n('.ring-target'), n('.ring-attacked')].join(','));
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
        /* a second tap on See it's place while the bar changes (faded out, no pointer events) reaches no button;
           Show the answer then takes taps once its half second from the fade is over */
        const sr = $('[data-act=seeIt]') ? $('[data-act=seeIt]').getBoundingClientRect() : null;
        let hitAct = 'none';
        /* (V2.2: Next move steps the rest of their line first, in See it's place; Show the answer comes at its end) */
        const stepLine = async () => { for (let g = 0; g < 10 && !$('#cpanel [data-act=reveal]'); g++) { await sleep(700); if ($('#cbar [data-act=seeIt]')) click('#cbar [data-act=seeIt]'); } return $('#cpanel [data-act=reveal]'); };
        const offered = !!c3 && c3.phase === 'tried' && click('[data-act=seeIt]') && (await sleep(200), true)
          && ((hitAct = (() => { const h = sr && document.elementFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2); const x = h && h.closest && h.closest('#cbar [data-act]'); return x ? x.getAttribute('data-act') : null; })()), true)
          && !!(await stepLine());
        ok('miss 3 offers Show the answer; result still null', offered && T.card().result === null, c3 && (c3.phase + ' ' + c3.result));
        if (offered) {
          ok('a second tap on See it\'s place while the bar changes reaches no button', hitAct === null && T.card().result === null && T.card().phase === 'tried', hitAct + ' ' + T.card().phase + ' ' + T.card().result);
          await sleep(500);
        }
        click('#cpanel [data-act=reveal]');
        await until(() => T.card().phase === 'done', 3000);
        /* from a try the board crossfades back first, and the words come 300 ms after the tap */
        await until(() => /^The answer: /.test(text('#cband .bd-r1')), 3000);
        await sleep(100);
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
      } else {
        ok('a close alternative was accepted as solved', c2.result !== 'fail');
        /* V1.2: a move in the found band ends the card; its bar offers Continue once the card has settled */
        await until(() => !!$('#cbar [data-act=next]'), 6000);
      }
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
    ok('the band\'s words fit its box, and every bar button its label', W.fit.length === 0, W.fit.slice(0, 3).join(' | '));

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
      ok('after a dragged move, the first tap on their piece says which side you are', T.ev('NOTE_COPY.T4(ui.session.active)').indexOf(text('#cband .bd-r2')) !== -1 && (!!$('#bwrap .marks .nope-box') || !!$('#bwrap .marks .ring-threat')) && T.card().phase === 'tried',
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
        await answerAsk('drag');
      }
      const dn = await until(() => T.card().phase === 'done', 8000);
      await until(() => T.card().settle === 2, 3000);
      await sleep(300);
      const any = dn ? T.ev('(function (a) { var st = doneBoard(a); for (var q = 0; q < 64; q++) if (st.b[q]) return q; return -1; })(ui.session.active)') : -1;
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
    /* I2 (desktop): a mouse's click on the bar leaves no focus there, so Enter is the right-hand
       button the key line names; a button reached from the keyboard keeps the focus, and the key
       line names it, so Enter does what the line says either way */
    if (innerWidth > 860) {
      const toGuess = async () => { for (let g = 0; g < 12; g++) { const x = T.card(); if (x.finished || x.phase === 'guess') return x; if (x.phase === 'tried') click('[data-act=tryAgain]'); else if (x.phase === 'done') click('[data-act=next]'); await sleep(1200); } return T.card(); };
      let x = await toGuess();
      if (x.phase === 'guess') {
        await sleep(600);
        const hb = $('#cbar [data-act=hint]');
        if (hb) { hb.focus(); hb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); }
        await sleep(1200);
        ok('I2: a clicked Hint hands the focus back to the band', !!hb && document.activeElement && document.activeElement.id === 'task-h', document.activeElement && (document.activeElement.id || document.activeElement.textContent));
        ok('I2: the key line then names no Enter: a card asking has no honey button (F4.1)', text('#ckeys') === '? hint', text('#ckeys'));
        (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(1200);
        ok('I2: Enter after a clicked Hint does nothing: never hint 2, never the answer', T.card().phase === 'guess' && T.card().hints === 1 && T.card().result === null, T.card().phase + ' ' + T.card().hints);
        /* the answer by its own button, then on to the next card */
        click('#cbar [data-act=reveal]');
        await sleep(1200);
        x = await toGuess();
        /* the new card's words (and its focus on the task) are in before the keyboard moves */
        await until(() => T.card().phase === 'guess' && text('#ckeys') !== '' && document.activeElement && document.activeElement.id === 'task-h', 8000);
        if (x.phase === 'guess') {
          await sleep(600);
          const hb2 = $('#cbar [data-act=hint]');
          document.documentElement.classList.remove('by-pointer');
          /* focus() in a tab without the window's focus sends no focus event: one is sent as Tab would */
          if (hb2) { hb2.focus(); hb2.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); }
          await sleep(100);
          ok('I2: Hint focused from the keyboard: the key line names it', text('#ckeys') === 'Enter: Hint · ? hint', text('#ckeys'));
          if (hb2) hb2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await sleep(1200);
          ok('I2: Enter on it gives the hint, and the line names what its slot holds now', T.card().hints === 1 && text('#ckeys') === 'Enter: Hint 2 · ? hint', T.card().hints + ' ' + text('#ckeys'));
        }
      }
    }
    /* finish: on the desktop from the keyboard alone (F4.1: a set finishes without the mouse), each move
       typed in the field Tab reaches from the task, Enter on the honey button; on a phone, reveal the rest */
    if (innerWidth > 860) {
      let typed = 0, honey = 0;
      for (let guard = 0; guard < 80; guard++) {
        const x = T.card();
        if (x.finished || !x.key && x.session === false) break;
        const still = !T.ev('motionHold') && T.ev('motionUntil') <= Date.now();
        /* at tier 3 the question of their best reply (F10.1) takes their move typed: their reply, the move due */
        if ((x.phase === 'guess' || (x.phase === 'reply' && x.reply && x.reply.ask)) && still && $('#kbmove')) {
          const inp = $('#kbmove');
          inp.focus(); inp.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
          inp.value = T.ev('(function (a) { return sanOf(a.st, dueMove(a)); })(ui.session.active)');
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          typed++;
        } else if ((x.phase === 'tried' || x.phase === 'done') && still) {
          (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          honey++;
        }
        await sleep(1100);
        if (T.card().finished) break;
      }
      ok('the rest of the set finishes from the keyboard alone: moves typed, Enter on the honey button (F4.1)', !!T.card().finished || !!$('.recap-item'), typed + ' typed, ' + honey + ' Enter, ' + T.card().phase);
    } else for (let guard = 0; guard < 40; guard++) {
      const x = T.card();
      if (x.finished || !x.key && x.session === false) break;
      if (x.phase === 'guess') click('[data-act=reveal]');
      else if (x.phase === 'tried') click('[data-act=tryAgain]');
      else if (x.phase === 'done') click('[data-act=next]');
      await sleep(900);
      if (T.card().finished) break;
    }
    await until(() => T.card().finished || !!$('.recap-item'), 20000);
    ok('the session ends in a recap', !!$('.recap-item'), text('#trainbox').slice(0, 80));
    layoutCheck('the summary');
    /* F5.2: the first diagnosis (in full, or how far the read is) above the result row, with its way to the report;
       F5.4: the first summary asks when you will practise, after the habit card, never in the sticky bar */
    const dg = $('.recap-page .diag') || $('.recap-page .diag-line'), rr = $('.recap-page .result-row');
    ok('the summary leads with the diagnosis above the result row, with See your report (F5.2)', !!dg && (!rr || !!(dg.compareDocumentPosition(rr) & Node.DOCUMENT_POSITION_FOLLOWING))
      && (!$('.recap-page .diag') || (!!$('.diag [data-act=reportOpen]') && /^(In \d+ of your \d+ losses, one move (turned the game for good|cost you the game)\.|So far: in \d+ of your \d+ losses|Your report builds as you practise: \d+ of \d+ games read\.|Your mistakes, grouped)/.test(text('.diag .diag-h, .diag .diag-so')))),
      dg ? dg.innerText.replace(/\n+/g, ' / ').slice(0, 120) : 'none');
    const cue = $('#cue'), hab = $('.recap-habit');
    ok('the first summary asks "When will you practise?" after the habit card, never in the bar (F5.4)', !!cue && /When will you practise\?/.test(cue.innerText) && $$('#cue [data-act=cueSlot]').length === 3 && !!$('#cue [data-act=cueNo]')
      && !cue.closest('.recap-acts') && (!hab || !!(hab.compareDocumentPosition(cue) & Node.DOCUMENT_POSITION_FOLLOWING)), cue ? cue.innerText.replace(/\n+/g, ' / ') : 'no cue card');
    /* F2.1: each position by its category (a one more try after it), the honest score from them
       (tier 1 in stars); no "spotted" line; "Keep in mind" once with the check lines (F2.3) */
    const words = [].map.call($$('.recap-item .res'), (e) => e.textContent);
    ok('the recap says each card in words', words.length > 0 && words.every((w) => /^(First try|Works too|After a good move|With a hint|First look|After a miss|Shown|Missed|Skipped)(, then (found|found with a hint|found after a miss|shown again|missed again))?$/.test(w)), words.join(', '));
    /* a card revealed to finish at its first showing reads Shown; one back for one more try, "then shown again"
       (V1.2: a move in the found band can end a card early, so the cards left may all be second showings) */
    ok('the cards revealed to finish read Shown', words.some((w) => /^Shown|, then shown again$/.test(w)), words.join(', '));
    ok('the card skipped after its miss reads Missed', words.indexOf('Missed') >= 0, words.join(', '));
    /* F3.1: each tile shows its result as its glyph, just before its word and in the glyph's own colour
       (a dark tick on the leaf disc, a honey bulb or rotate, a slate eye, a dash), never the words' */
    /* a move that works too holds (V1.2): the ring with a tick, as after a good move */
    const GLYPH = { 'First try': 'first', 'Works too': 'good', 'After a good move': 'good', 'With a hint': 'hint', 'First look': 'hint', 'After a miss': 'miss', 'Shown': 'shown', 'Missed': 'skip', 'Skipped': 'skip' };
    const INK = { first: '--ink', good: '--leaf', hint: '--honey', miss: '--honey', shown: '--slate', skip: '--text-3' };
    const probe = document.createElement('i');
    document.body.appendChild(probe);
    const tokenColour = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
    const offGlyph = [].map.call($$('.recap-item .res'), (r) => {
      const g = r.previousElementSibling, k = g && /\brg-(\w+)/.exec(g.className), want = GLYPH[r.textContent.split(',')[0]];
      if (!k || k[1] !== want) return r.textContent + ': ' + (g ? g.className : 'no glyph');
      return getComputedStyle(g).color !== tokenColour(INK[want]) ? r.textContent + ': its glyph drawn in ' + getComputedStyle(g).color : '';
    }).filter(Boolean);
    probe.remove();
    ok('each tile shows its result as its glyph, before its word and in the glyph\'s own colour', words.length > 0 && offGlyph.length === 0, offGlyph.join(' | '));
    const head = text('#recap-h'), firstN = words.filter((w) => /^First try/.test(w)).length, countedN = words.filter((w) => w !== 'Skipped').length;
    const tier1 = T.ev('playerTier()') === 1, foundN = words.filter((w) => { const [first, last] = w.split(', then '); return !/^(Shown|Missed|Skipped)/.test(first) || /^found/.test(last || ''); }).length /* found on either try counts as found at More help (C3) */, allN = words.length;
    const t1head = foundN === allN ? (allN === 1 ? 'You found it.' : allN === 2 ? 'You found both.' : 'You found all ' + allN + '.') : 'You found ' + foundN + ' of ' + allN + '.';
    ok('the recap counts what it says (V4.3: tier 1 what was found, never "of 15")', !countedN ? head === 'Done.' : tier1 ? head === t1head : head === firstN + ' of ' + countedN + ' found first try.', head + ' / ' + words.join(', '));
    ok('no summary line starts with "Then" or says "held" (V4.3)', ![].some.call($$('.recap-page p, .recap-page h2'), (e) => /^Then\b/.test(e.textContent.trim()) || /\bheld\b/.test(e.textContent)), text('.recap-then') + ' / ' + text('.recap-small'));
    const habits = [].map.call($$('.recap-habit .keep-line'), (e) => e.textContent);
    ok('one check line per step met, said once, under one "Keep in mind" and one bulb', habits.length >= 1 && $$('.recap-habit > .kicker').length === 1 && text('.recap-habit > .kicker') === 'Keep in mind'
      && $$('.recap-habit .plan').length === 1 && new Set(habits).size === habits.length && habits.every((h) => h.length > 10), habits.join(' | '));
    ok('no "spotted" line on the recap', !/spotted/i.test(text('#trainbox')));
    ok('the recap offers to play a game', !!$('.recap-acts .btn-big'));
    /* F4.5: a glyph per position leads the summary; the next set, in the bar at the screen's foot, stays in
       view at the summary's top and at its end, wider than Back to Today */
    ok('the summary leads with a glyph per position (F4.5; tier 1 three stars each, V4.3)', $$(tier1 ? '.result-row .star-grp' : '.result-row .rg').length === $$('.recap-item').length, $$('.result-row .rg, .result-row .star-grp').length + ' glyphs or star groups, ' + $$('.recap-item').length + ' tiles');
    const nextB = $('.recap-acts [data-act=keepGoing]'), backB = $('.recap-acts [data-act=endSession]');
    if (nextB && backB) {
      const inView = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 0.5; };
      window.scrollTo(0, 0); await sleep(150);
      const atTop = inView(nextB);
      window.scrollTo(0, document.documentElement.scrollHeight); await sleep(150);
      const atEnd = inView(nextB);
      window.scrollTo(0, 0);
      const wn = nextB.getBoundingClientRect().width, wb = backB.getBoundingClientRect().width;
      ok('the next set stays in view at the summary\'s top and end, wider than Back to Today (F4.5)', atTop && atEnd && wn > 1.2 * wb, [atTop, atEnd, Math.round(wn), Math.round(wb)].join(' / '));
    }
    ok('reveal-only cards do not earn the day on their own', T.ev('ui.session ? (ui.session.attempted || 0) + (ui.session.carried || 0) >= 3 : false') || T.ev('dayLoad().sessions || 0') === sessionsBefore);
    click('[data-act=endSession]');
    await sleep(300);

    /* ── the Games tab, a game's positions (slice D): after the set, so the first card ever stays the set's ── */
    click('#tab-games');
    await until(() => $('#gamesbox .lg-row'), 8000);
    /* a game opens its positions in move order; × comes back to the Games tab, the keyboard on that game */
    const gRow = $('#gamesbox .lg-row[data-act=drill]'), gId = gRow && gRow.getAttribute('data-g');
    if (gRow) {
      gRow.click();
      await until(() => T.card().phase === 'guess', 30000);
      ok('a game opens its positions in move order (V4.7), from the Games tab', T.ev(`(function () { var ss = ui.session; if (!ss || !ss.spec || ss.spec.type !== 'game' || ss.back !== 'games') return false; var p = ss.keys.map(function (k) { return itemOf(k).b.p; }); return p.every(function (x, i) { return !i || x > p[i - 1]; }); })()`), JSON.stringify(T.ev('ui.session && ui.session.spec')));
      click('.sb-end');
      await sleep(400);
      ok('× goes back to the Games tab, the keyboard on that game', T.ev('ui.view') === 'games' && !T.ev('!!ui.session') && location.hash === '#games' && !!document.activeElement && document.activeElement.getAttribute('data-g') === gId, T.ev('ui.view') + ' ' + location.hash + ' ' + focusName());
    } else ok('a game with positions on the Games tab', false, 'none');

    /* ── Insights, a sheet, settings ─────────────────────────────────── */
    T.ev("setView('insights'); 'ok'");
    await until(() => $('#insightsbox .fam-row'), 8000);
    ok('Insights ranks the mistake families', !!$('#insightsbox .fam-row'));
    layoutCheck('Insights');
    ok('no NaN, undefined or em dash in Insights', !/NaN|undefined|—/.test(text('#insightsbox')));
    /* F6.1: the headline and its lead on the first screen (phones too); every skill a bar of its own
       positions whose words add up to them, no "0 learned"; the set just finished starts "since you
       started" (F6.2), waiting for 10 games; how we count opens */
    window.scrollTo(0, 0);
    await sleep(100);
    const ih = $('#insightsbox h2'), il = $('#insightsbox .lead');
    ok('Insights: the headline and the lead fit the first screen', !!ih && !!il && shown(il) && rectOf(il).bottom <= vh() && rectOf(ih).top >= 0,
      (ih ? Math.round(rectOf(ih).top) : '-') + ' to ' + (il ? Math.round(rectOf(il).bottom) : 'no lead') + ' of ' + vh());
    /* at More help the skill tiles (F9.5) come right under them, their first row (with "Next") on the first screen too */
    if (T.ev('playerTier()') === 1) {
      const sk = $('#insightsbox .sk-tiles'), sk1 = $('#insightsbox .sk-tile'), skn = $('#insightsbox .sk-tile.is-next');
      ok('Insights at More help: the skill tiles right under the headline and lead, their first row and "Next" on the first screen', !!sk && !!sk1 && !!il && rectOf(sk).top >= rectOf(il).bottom
        && rectOf(sk1).bottom <= vh() && (!skn || rectOf(skn).bottom <= vh()), (sk ? Math.round(rectOf(sk).top) : 'no tiles') + ', first row to ' + (sk1 ? Math.round(rectOf(sk1).bottom) : '-') + ', Next to ' + (skn ? Math.round(rectOf(skn).bottom) : 'none') + ' of ' + vh());
    }
    const rows = [].map.call($$('#insightsbox .fam-row'), (r) => {
      const n = +((/(\d+) positions?/.exec(r.querySelector('.fr-n').textContent) || [])[1] || 0);
      const parts = (r.querySelector('.fr-prog').textContent.match(/\d+/g) || []).map(Number), segs = r.querySelectorAll('.fr-bar i');
      return { name: r.querySelector('.fr-name').textContent, n, sum: parts.reduce((a, x) => a + x, 0), segs: segs.length, bar: r.querySelector('.fr-bar') ? rectOf(r.querySelector('.fr-bar')).width : 0 };
    });
    ok('Insights: every skill with positions has a bar of them, said in words that add up', rows.length >= 1 && rows.every((x) => x.n > 0 && x.segs >= 1 && x.bar > 40 && x.sum === x.n), JSON.stringify(rows));
    ok('Insights: never "0 learned" (or any zero part), never "climbing" or "to go" (V4.8)', !/(^|\D)0 (learned|in practice|not started)/.test(text('#insightsbox')) && !/\bclimbing\b|\bto go\b/.test(text('#insightsbox')));
    ok('Insights: the set just finished starts "since you started", waiting for 10 games', /^Since you started, \d+ \w+/.test(text('#insightsbox .since-h')) && /Comparison from 10 games since you started: \d+ of 10 new games so far\./.test(text('#insightsbox .since')), text('#insightsbox .since'));
    click('#insightsbox [data-act=sheet][data-k=count]');
    await until(() => $('#overlay .sheet'), 3000);
    ok('Insights: "How we count" opens', /How we count/.test(text('#overlay .sheet h3')) && $$('#overlay .sheet p').length >= 2, text('#overlay .sheet'));
    layoutCheck('How we count');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    /* (release 3 slice G) a skill row opens the Mistakes tab filtered to it, its row pressed, its breakdown under it */
    const skRow = $('#insightsbox [data-act=mistakes]'), skK = skRow && skRow.getAttribute('data-k');
    click('#insightsbox [data-act=mistakes]');
    await until(() => $('#mistakesbox .mk-row'), 3000);
    ok('a skill row opens Mistakes filtered to it', location.hash === '#mistakes' && !!skK && !!$('#mistakesbox .fam-row[aria-pressed=true][data-k="' + skK.split(':')[1] + '"]') && !!$('#mistakesbox .mk-break') && /^\d+ of \d+ mistakes$/.test(text('#mk-count')) && !$('#overlay .sheet'), location.hash + ' ' + skK + ' ' + text('#mk-count'));
    layoutCheck('Mistakes');
    ok('no em dash anywhere on Mistakes', text('#main').indexOf('\u2014') === -1);
    click('#mistakesbox [data-act=mkClear]');
    T.ev("setView('train'); 'ok'");
    click('#bar [data-act=settings]');
    await until(() => $('#overlay .sheet .switch-row'), 3000);
    ok('Settings open in a sheet', !!$('#overlay .sheet .switch-row'));
    layoutCheck('Settings');
    const sizeBefore = T.ev("sessionSize()");
    click('#overlay [data-act=size][data-k="5"]');
    ok('session size can be changed', T.ev("sessionSize()") === 5);
    T.ev("store.set('nl:sessionSize', " + sizeBefore + "); closeSheet(); 'ok'");

    /* ── the story on a card whose game move allows a capture or a check ─ */
    const tk = T.ev(`(function () { var it = allMistakes().filter(trainable).filter(function (x) { var a = cardFor(x); return a && !a.sol && threatOf(a.cls.gameLine, 1); })[0]; return it ? it.key : null; })()`);
    if (tk) {
      T.ev("startDrill({ type: 'one', key: '" + tk + "', label: 'e2e' }); 'ok'");
      c = await until(() => { const x = T.card(); return x.phase === 'guess' && x.key === tk ? x : null; }, 30000);
      if (c) {
        await sleep(600);
        await tapMove(c.best);
        await until(() => T.card().settle === 2, 6000);
        await sleep(300);
        click('#cbar [data-act=seeWhy]');
        /* (found, it opens on B1, release 3: the strip's Game opens the game segment) */
        await storyLanded(T.ev('buildStory(ui.session.active).g'));
        click('#cstrip [data-act=storyJump][data-k=game]');
        await storyLanded(0);
        /* its danger frame first, when it has one (F1.5), then G1 */
        const tg1 = T.ev('buildStory(ui.session.active).steps[0].df ? 1 : 0');
        if (tg1) { storyFrame('threat card danger frame'); press('#cbar [data-act=storyFwd]'); await storyLanded(1); }
        ok('See why enters the story; G1 shows one .bad-arrow and one .threat-arrow', T.card().story && T.card().story.i === tg1 && $$('#bwrap .bad-arrow').length === 1 && $$('#bwrap .threat-arrow').length === 1 && $$('#bwrap .ring-threat').length === 1,
          $$('#bwrap .bad-arrow').length + ' red, ' + $$('#bwrap .threat-arrow').length + ' threat: ' + text('#cband'));
        storyFrame('threat card G1');
        ok('the threat card\'s story frame fits', W.story.length === 0, W.story.slice(-1).join(''));
        click('[data-act=endSession]') || T.ev("endSession(); 'ok'");
        await sleep(300);
      }
    } else ok('a card whose game move allows a capture or a check', false, 'none found');

    /* ── F10.1 at tier 3: a forcing card's first move, then their best reply guessed ── */
    if (T.ev('playerTier()') >= 3) {
      /* a card forcing by its stored lines may not be once its deeper look has run: the first that still is */
      const fks = T.ev(`allMistakes().filter(trainable).filter(function (x) { var c = cardFor(x); return c && c.sol && c.sol.length >= 3; }).map(function (x) { return x.key; })`);
      ok('F10.1: the fixture has forcing cards at tier 3', fks.length > 0, fks.length);
      let fc = null;
      for (const fk of fks.slice(0, 6)) {
        T.ev(`startDrill({ type: 'one', key: '${fk}', label: 'e2e' }); 'ok'`);
        const x = await until(() => { const y = T.card(); return y.phase === 'guess' && y.key === fk ? y : null; }, 30000);
        if (x && x.sol) { fc = x; break; }
        click('[data-act=endSession]') || T.ev("endSession(); 'ok'");
        await sleep(400);
      }
      ok('F10.1: a card still forcing after its deeper look', !!fc);
      if (fc) {
        await sleep(700);
        await tapMove(fc.sol[0]);
        await until(() => T.card().solIdx > 0, 6000);
        ok('F10.1: a tier 3 forcing card asks for their best reply after its first move', await answerAsk('tap'), JSON.stringify(T.card().reply));
        for (let i = 2; i < fc.sol.length; i += 2) {
          await until(() => T.card().phase === 'guess' && !T.ev('motionHold') && T.ev('motionUntil') <= Date.now(), 8000);
          await sleep(150);
          await tapMove(fc.sol[i]);
          await until(() => T.card().phase === 'done' || T.card().solIdx > i, 6000);
        }
        ok('F10.1: the line found to its end after the guess, first try', !!(await until(() => T.card().phase === 'done' && T.card().result === 'first', 8000)), T.card().phase + ' ' + T.card().result);
        ok('F10.1: the right guess is kept on the record', T.ev(`!!srsLoad()['${fc.key}'].pg`));
        click('[data-act=endSession]') || T.ev("endSession(); 'ok'");
        await sleep(400);
      }
    }

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
  ok('the layout holds at ' + innerWidth + ' x ' + innerHeight + ' (' + (phoneGrid() ? 'phone' : 'desktop') + ' grid) in every state reached', W.lay.length === 0, W.lay.length + ': ' + W.lay.slice(0, 4).join(' | '));
  ok('no uncaught errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  log.push('note their best reply asked for ' + W.asks + ' times (tier 3 forcing lines, F10.1)');
  return { passed, failed, log };
})();
