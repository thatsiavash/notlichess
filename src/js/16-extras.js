
/* chess.com games carry their start time in the PGN headers */
function ccStartMs(g) {
  var pgn = g.pgn || '';
  var d = /\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]/.exec(pgn), t = /\[UTCTime "(\d{2}):(\d{2}):(\d{2})"\]/.exec(pgn);
  if (!d || !t) return null;
  var ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]);
  return isFinite(ms) && ms > 0 && (!g.end_time || ms <= g.end_time * 1000) ? ms : null;
}
function narrAnimate() {
  var stageTimer = setInterval(function () {
    if (!data.narrate || !el('narr-stage')) { clearInterval(stageTimer); return; }
    var stage = el('narr-stage');
    if (!stage.querySelector('.narr-track')) {
      stage.innerHTML = narrBoards();
      return;
    }
    var live = data.narrLive || [];
    var cards = stage.querySelectorAll('.narr-card');
    if (!live.length || !cards.length) return;
    var now = Date.now();
    var n = live.length;
    var pool = (data.narrPreview && data.narrPreview.length >= 3)
      ? data.narrPreview
      : data.games.filter(function (g) { return g.op16; });
    live.forEach(function (b, i) {
      var pair = [cards[i], cards[i + n]];
      if (b.phase === 'fading') {
        if (now < b.until) return;
        /* the analyzed game leaves; the next one takes its seat */
        data.narrNext = (data.narrNext == null ? live.length : data.narrNext);
        var g2 = pool[data.narrNext % pool.length];
        data.narrNext++;
        if (g2) {
          b.toks = (g2.mv40 || g2.op16).split(' ');
          b.opp = g2.opp;
          b.flip = g2.color === 'black';
        }
        b.st = chessStart(); b.ply = 0;
        b.phase = 'live';
        b.nextAt = now + 350 + Math.random() * 250;
        var freshHtml = boardSvg(b.st, { flip: b.flip, decor: true });
        pair.forEach(function (c) {
          if (!c) return;
          var old = c.querySelector('svg');
          if (old) old.outerHTML = freshHtml;
          var cap = c.querySelector('.narr-card-cap');
          if (cap && b.opp) cap.textContent = cfg.user + ' vs ' + b.opp;
          c.classList.remove('narr-fade');
        });
        return;
      }
      if (now < b.nextAt || reducedMotion()) return;
      b.nextAt = b.nextAt + 250;              /* steady beat, per-board phase */
      if (now - b.nextAt > 1000) b.nextAt = now + 250;   /* tab was hidden */
      var mv = b.ply < b.toks.length ? sanApply(b.st, b.toks[b.ply]) : null;
      if (!mv) {
        b.phase = 'fading';
        b.until = now + 480;
        pair.forEach(function (c) { if (c) c.classList.add('narr-fade'); });
        return;
      }
      b.ply++;
      var html = boardSvg(b.st, { flip: b.flip, anim: [mv.from, mv.to], decor: true });
      pair.forEach(function (c) {
        if (!c) return;
        var old = c.querySelector('svg');
        if (old) old.outerHTML = html;
      });
      releaseAnims(stage);
    });
  }, 90);
  var i = 0;
  function tick() {
    var box = el('narr-wisdom');
    if (!box || !data.narrate) return;
    box.style.opacity = 0;
    setTimeout(function () {
      if (!el('narr-wisdom') || !data.narrate) return;
      box.textContent = NARR_WISDOM[i % NARR_WISDOM.length];
      box.style.opacity = 1;
      i++;
    }, 300);
    setTimeout(tick, 4600);
  }
  tick();
}

/* new games are picked up about once an hour while the page is open */
setInterval(function () {
  if (!cfg.user || data.narrate || data.sections.games === 'loading') return;
  var c = loadCachedGames();
  if (Date.now() - (c.fetchedAt || c.at || 0) > 3600 * 1000) loadGames().then(function () { setTimeout(autoScan, 800); });
}, 10 * 60 * 1000);
/* coming back to the tab after a game: a finished recap closes, and new
   games are fetched straight away (never in the middle of a position, and
   at most every two minutes) */
var hiddenAt = 0;
function onReturn() {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!cfg.user || data.narrate || data.sections.games === 'loading') return;
  /* a recap left behind for a game (a minute or more away) closes to Today */
  var away = hiddenAt && Date.now() - hiddenAt > 60 * 1000;
  hiddenAt = 0;
  if (ui.session && ui.session.finished && away) endSession();
  if (ui.session) return;
  var c = loadCachedGames();
  if (Date.now() - (c.fetchedAt || c.at || 0) > 2 * 60 * 1000) loadGames().then(function () { computeGreeting(); renderTrain(); setTimeout(autoScan, 800); });
}
document.addEventListener('visibilitychange', onReturn);
window.addEventListener('focus', onReturn);
window.addEventListener('online', function () { notice('Back online.'); if (cfg.user && !data.narrate) checkForGames(); });
window.addEventListener('offline', function () { notice('You are offline. Your practice keeps working.'); });

