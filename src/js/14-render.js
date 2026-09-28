/* ── Rendering ──────────────────────────────────────────────────────────────
   Two views (Today, Insights), a sheet for details, settings at the foot.
   The card is built once per position and then updated in place, so the
   evaluation bar animates and background progress never wipes a message. */

function el(id) { return document.getElementById(id); }
/* "1 game", "3 games" */
function plur(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function track(name) {
  try { if (window.clarity) window.clarity('event', name); } catch (e) {}
}
var saveTimer = null, saveCount = 0;
function scheduleSave() {
  saveCount++;
  if (saveCount >= 10) { flushSave(); return; }
  if (!saveTimer) saveTimer = setTimeout(flushSave, 15000);
}
function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveCount = 0;
  if (cfg.user && data.games.length) saveGames(data.games);
}
window.addEventListener('pagehide', flushSave);

var VIEWS = [['train', 'Today'], ['insights', 'Insights']];
function setView(v, fromPop) {
  if (v !== 'insights') v = 'train';
  ui.view = v;
  store.set('nl:view', v);
  if (!fromPop && location.hash !== '#' + v) {
    try { history.pushState(null, '', location.pathname + '#' + v); } catch (e) {}
  }
  renderViews();
  if (v === 'insights') renderInsights(); else renderTrain();
  if (!fromPop) window.scrollTo(0, 0);
}
window.addEventListener('popstate', function () {
  var h = (location.hash || '').replace('#', '');
  if (h === 'coach' || h === 'insights') h = 'insights'; else h = 'train';
  if (h !== ui.view) setView(h, true);
});
function renderViews() {
  var nav = el('views');
  if (!nav) return;
  var due = cfg.user ? dueCards().length : 0;
  nav.innerHTML = VIEWS.map(function (v) {
    return '<a class="view-tab' + (ui.view === v[0] ? ' view-on' : '') + '" data-act="view" data-k="' + v[0] + '" role="tab" aria-selected="' + (ui.view === v[0]) + '">'
      + v[1] + (v[0] === 'train' && due && !(ui.session && ui.session.active) ? '<span class="badge">' + due + '</span>' : '') + '</a>';
  }).join('');
  el('view-train').hidden = ui.view !== 'train';
  el('view-insights').hidden = ui.view !== 'insights';
}
function renderShell() {
  if (location.search) {
    try { history.replaceState(null, '', location.pathname + (location.hash || '#train')); } catch (e) {}
  }
  el('main').innerHTML = '<div class="page">'
    + '<nav id="views" class="views" role="tablist"></nav>'
    + '<div id="view-train" class="view"><section id="train"></section></div>'
    + '<div id="view-insights" class="view" hidden><section id="insights"></section></div>'
    + '<section id="settings"></section>'
    + '</div>';
}
function renderAll() {
  [renderHeader, renderViews, renderTrain, renderInsights, renderSettings, renderFoot].forEach(function (fn) {
    try { fn(); } catch (e) { if (window.console) console.error(fn.name, e && e.stack); }
  });
}

/* ── header ──────────────────────────────────────────────────────────────── */
function renderHeader() {
  var bar = el('bar');
  if (!bar) return;
  var bits = [];
  if (data.user && data.user.perfs) {
    trackedPerfs().forEach(function (p) {
      var perf = data.user.perfs[p];
      if (!perf || !perf.rating || perf.games === 0) return;
      bits.push('<span>' + perfLabel(p) + ' <b>' + perf.rating + '</b>' + deltaBadge(p) + '</span>');
    });
  }
  var si = cfg.user ? streakInfo() : null;
  bar.innerHTML = '<div class="brand">'
      + '<a class="brand-name" data-act="home">notlichess.org</a>'
      + (cfg.user ? '<span class="brand-user">' + esc(cfg.user) + (isCC() ? ' · chess.com' : '') + '</span>'
        + ' <a class="brand-out" data-act="logout" data-k="confirm">switch</a>' : '')
    + '</div>'
    + (cfg.user ? '<div class="ratings">' + bits.join('') + '</div>' : '')
    + '<div class="bar-right">'
      + (si && si.days ? '<span class="streak-badge" title="Days in a row with practice. Best: ' + si.best + '">'
        + FLAME + '<b class="tnum">' + si.days + '</b></span>' : '')
      + (cfg.user ? '<a id="astat-ic" class="dim" data-act="view" data-k="train" title=""></a><a data-act="settings">settings</a>' : '')
    + '</div>';
  renderAnalysisStatus();
}
function deltaBadge(p) {
  var d = data.deltas && data.deltas[p];
  if (d == null || !isFinite(d) || Math.abs(d) < 1) return '';
  return ' <span class="' + (d > 0 ? 'win' : 'dim') + ' tnum" style="font-size:.82em" title="past 30 days">'
    + (d > 0 ? '▲' : '▼') + Math.abs(Math.round(d)) + '</span>';
}

/* the engine at work: one small status that never re-renders anything else */
function analysisNumbers() {
  var c = scanCoverage();
  var ready = allMistakes().filter(trainable).length;
  return { covered: c.covered, total: c.total, ready: ready,
           working: SF.state !== 'failed' && (scanState.running || scanState.pending || enrichState.running) };
}
var lastReadyShown = -1;
function renderAnalysisStatus() {
  var n = analysisNumbers();
  var ic = el('astat-ic');
  if (ic) {
    ic.textContent = n.working && n.covered < n.total ? 'reading ' + n.covered + '/' + n.total : '';
    ic.title = n.covered + ' of ' + n.total + ' games checked by Stockfish';
  }
  var line = el('astat');
  if (line) line.innerHTML = analysisLine(n);
  /* the Today view changes shape when the first mistakes arrive */
  if (ui.view === 'train' && !ui.session) {
    var bucket = n.ready >= 3 ? 3 : n.ready;
    var hero = el('hero-n'), want = hero ? +hero.getAttribute('data-n') : 0;
    if (bucket !== lastReadyShown) { lastReadyShown = bucket; renderTrain(); }
    else if (hero && want < 5 && n.ready > want && todayPlan().keys.length > want) renderTrain();
    else {
      if (el('finds')) el('finds').innerHTML = recentFindsHtml();
      var lg = el('latest');
      if (lg) lg.outerHTML = latestGamesHtml();
    }
  }
}
function analysisLine(n) {
  if (SF.state === 'failed') return '<span class="loss">Stockfish could not start in this browser.</span> <a data-act="engineRetry">Try again</a>';
  if (!n.total) return '';
  var pctDone = Math.round(n.covered * 100 / Math.max(1, n.total));
  if (n.covered >= n.total) return '<span>' + (n.total === 1 ? 'Your game is checked' : 'All ' + n.total + ' of your games are checked') + ' · ' + plur(n.ready, 'mistake') + ' to learn from</span>';
  return '<span>Stockfish has checked ' + n.covered + ' of ' + n.total + ' games</span>'
    + '<span class="bar-line"><i class="bar-fill" style="width:' + pctDone + '%"></i></span>'
    + '<span>' + plur(n.ready, 'mistake') + ' found</span>';
}
function renderEngineState() { renderAnalysisStatus(); }

/* ── Today ───────────────────────────────────────────────────────────────── */
function renderTrain() {
  var box = el('train');
  if (!box || !cfg.user) return;
  var ss = ui.session;
  if (ss && ss.finished) { box.dataset.card = ''; box.innerHTML = doneHtml(ss); return; }
  if (ss) { renderCard(); return; }
  box.dataset.card = '';
  var n = analysisNumbers();
  var gamesLoading = data.sections.games === 'loading';
  if (!data.games.length) {
    box.innerHTML = '<div class="today">' + (gamesLoading
      ? '<p class="loading">Reading your games…</p>'
      : (data.sections.games === 'fail'
        ? '<div class="finding"><h2>We couldn\'t read your games.</h2><p class="sec">' + esc(data.gamesErr || 'The site may be busy.') + '</p><a class="btn-line" data-act="reload">Try again</a></div>'
        : '<div class="finding"><h2>No rated games found.</h2><p class="sec">notlichess reads rated live games (bullet, blitz, rapid' + (isCC() ? '' : ', classical') + '); ' + (isCC() ? 'daily' : 'correspondence') + ' games are not read yet. Play a few rated games on ' + (isCC() ? 'chess.com' : 'lichess') + ', then come back. Your mistakes will be waiting.</p><a class="btn-gold" href="' + playHref(cfg.tcs[0]) + '">Play a game</a></div>'))
      + '</div>';
    return;
  }
  var since = sinceHtml();
  if (n.ready < 3) { box.innerHTML = '<div class="today">' + since + findingHtml(n) + '</div>'; return; }
  var saved = savedSession();
  var day = dayLoad(), due = dueCards().length;
  var doneToday = ((day.sessions || 0) > 0 && !due) || (!saved && !todayPlan().keys.length);
  box.innerHTML = '<div class="today today-grid"><div class="today-main">' + since
    + (saved ? resumeHtml(saved) : (doneToday ? doneTodayHtml() : heroHtml()))
    + focusHtml()
    + '<p class="status" id="astat">' + analysisLine(n) + '</p>'
    + '</div>' + latestGamesHtml() + '</div>';
}
/* the latest games, each one a way into its own mistakes */
function latestGamesHtml() {
  var games = data.games.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 6);
  if (!games.length) return '';
  var byGame = {};
  allMistakes().forEach(function (it) {
    if (!trainable(it)) return;
    var e = byGame[it.g.id] || (byGame[it.g.id] = { n: 0, lost: false });
    e.n++;
    if (it.b.d) e.lost = true;
  });
  var rows = games.map(function (g) {
    var e = byGame[g.id], res = g.res === 'win' ? 'W' : (g.res === 'loss' ? 'L' : 'D');
    var right;
    if (!covered(g)) right = '<span class="lg-state dim">' + (scannableAny(g) ? 'Not checked yet' : (g.plies < 6 ? 'Too short to check' : 'Could not be read')) + '</span>';
    else if (!e) right = '<span class="lg-state ok">No big mistakes</span>';
    else right = '<span class="lg-state">' + e.n + (e.n === 1 ? ' mistake' : ' mistakes')
      + (e.lost ? '<i>' + (g.res === 'draw' ? 'one cost the win' : 'one cost the game') + '</i>' : '') + '</span>';
    var attrs = e ? ' data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'game', id: g.id, label: 'Game vs ' + g.opp })) + '" role="button"' : '';
    return '<div class="lg-row' + (e ? ' is-open' : '') + '"' + attrs + '>'
      + '<span class="lg-res lg-' + res + '" title="' + esc(g.res) + '">' + res + '</span>'
      + '<span class="lg-who">vs ' + esc(g.opp) + (g.oppR ? ' <span class="dim">' + g.oppR + '</span>' : '')
      + '<small>' + esc(g.perf || '') + ' · ' + agoWords(g.ts) + ' · as ' + g.color + '</small></span>'
      + right + '</div>';
  }).join('');
  return '<aside class="latest" id="latest"><div class="kicker">Your latest games</div>' + rows
    + '<p class="lg-foot dim">Tap a game to go through its mistakes in order.</p></aside>';
}
function agoWords(ts) {
  var d0 = new Date(); d0.setHours(0, 0, 0, 0);
  var days = Math.ceil((d0.getTime() - ts) / DAY);
  if (ts >= d0.getTime()) return 'today';
  if (days <= 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return gameDateLine({ ts: ts });
}
function sinceHtml() { return data.greeting ? '<p class="since">' + data.greeting + '</p>' : ''; }
function weekHtml() {
  var goal = weekGoal(), done = weekDays(), dots = '';
  var dow = (new Date().getDay() + 6) % 7;
  for (var i = 0; i < 7; i++) {
    var d = new Date(); d.setDate(d.getDate() - (dow - i));
    var on = i <= dow && dayCounts(dayRecOf(d));
    dots += '<span class="week-dot' + (on ? ' on' : '') + (i === dow ? ' is-today' : '') + '"></span>';
  }
  return '<div class="week" title="Your weekly goal: ' + goal + ' days"><div class="week-dots">' + dots + '</div>'
    + '<span>' + Math.min(done, 7) + ' of ' + goal + ' days this week</span></div>';
}
function heroHtml() {
  var plan = todayPlan();
  var mins = Math.max(3, Math.round(plan.keys.length * 0.8));
  var reasons = [];
  if (plan.decisive) reasons.push(plan.decisive + (plan.decisive === 1 ? ' move that lost a game' : ' moves that lost games'));
  var reviews = plan.keys.length - plan.fresh;
  if (reviews) reasons.push(reviews + (reviews === 1 ? ' review' : ' reviews'));
  if (plan.fresh - plan.decisive > 0) reasons.push((plan.fresh - plan.decisive) + ' new from your games');
  return '<div class="hero"><div class="hero-top"><div>'
    + '<div class="kicker">Today</div>'
    + '<h2 id="hero-n" data-n="' + plan.keys.length + '">' + plan.keys.length + (plan.keys.length === 1 ? ' position' : ' positions') + ' from your games</h2>'
    + '<p class="why">' + (plan.firstTime ? 'We\'ll start with the easier ones.' : reasons.join(' · ')) + ' · about ' + mins + ' min</p>'
    + '</div>' + weekHtml() + '</div>'
    + '<div class="acts"><a class="btn-big" data-act="startToday">Start</a></div></div>';
}
function resumeHtml(s) {
  return '<div class="hero"><div class="hero-top"><div><div class="kicker">' + esc(s.label) + '</div>'
    + '<h2>Pick up where you left off</h2><p class="why">' + Math.min(sessionDoneCount(s), s.keys.length) + ' of ' + s.keys.length + ' done</p></div>' + weekHtml() + '</div>'
    + '<div class="acts"><a class="btn-big" data-act="resume">Resume</a><a class="btn-quiet" data-act="dropSession">Start over</a></div></div>';
}
function doneTodayHtml() {
  var more = buildCandidates(5).length;
  var srs = srsLoad(), next = null;
  Object.keys(srs).forEach(function (k) { var r = srs[k]; if (r.due && !r.hidden && (!next || r.due < next)) next = r.due; });
  return '<div class="hero"><div class="hero-top"><div><div class="kicker">Today</div>'
    + '<h2>' + ((dayLoad().sessions || 0) > 0 ? 'Done for today.' : 'Nothing due right now.') + '</h2><p class="why">' + (next ? 'Your next reviews are due ' + dueWhen(next) + '.' : 'Nothing is due back yet.') + '</p></div>' + weekHtml() + '</div>'
    + '<div class="acts">' + (more ? '<a class="btn-line" data-act="keepGoing">Practise 5 more</a>' : '')
    + '<a class="btn-quiet" href="' + playHref(cfg.tcs[0]) + '">Play a game</a></div></div>';
}
function dueWhen(ts) {
  var days = Math.round((ts - Date.now()) / DAY);
  if (days <= 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return 'in ' + days + ' days';
}
function recentFindsHtml() {
  var list = allMistakes().filter(trainable).slice(0, 5);
  if (!list.length) return '<p class="find dim">Nothing yet. The newest games are read first.</p>';
  return list.map(function (it) {
    return '<p class="find">' + esc(patternInfo(patternOf(it.b)).name) + ' <span class="dim">vs ' + esc(it.g.opp) + ', ' + gameDateLine(it.g) + '</span></p>';
  }).join('');
}
function findingHtml(n) {
  if (SF.state === 'failed' && !n.ready) {
    return '<div class="finding"><div class="kicker">Finding your mistakes</div><h2>Stockfish could not start in this browser.</h2>'
      + '<p class="sec">It runs inside your browser, and something blocked it (a content blocker, or a very old browser). '
      + (isCC() ? '' : 'Games that lichess has already analysed still work.') + '</p><a class="btn-line" data-act="engineRetry">Try again</a></div>';
  }
  var done = n.total && n.covered >= n.total && !n.working;
  var play = '<a class="btn-line" href="' + playHref(cfg.tcs[0]) + '">Play a game</a>';
  if (done && !n.ready) {
    return n.total < 10
      ? '<div class="finding"><h2>Only ' + plur(n.total, 'game') + ' so far.</h2><p class="sec">Not enough to find much yet. Play a few more rated games and come back.</p>' + play.replace('btn-line', 'btn-gold') + '</div>'
      : '<div class="finding"><h2>Clean games.</h2><p class="sec">Stockfish found no big mistakes in your ' + n.total + ' games. That is rare. New games are checked as you play.</p></div>';
  }
  var can = n.ready ? todayPlan().keys.length : 0;
  if (done) {
    return '<div class="finding"><div class="kicker">' + (n.total === 1 ? 'Your game is checked' : 'All ' + n.total + ' games checked') + '</div>'
      + '<h2>' + (n.ready === 1 ? 'One mistake' : n.ready + ' mistakes') + ' to learn from.</h2>'
      + '<p class="sec">Play a few more rated games and more will turn up. New games are checked when you come back.</p>'
      + '<div class="acts-row">' + (can ? '<a class="btn-gold" data-act="startToday">Practise ' + (can === 1 ? 'it' : 'them') + '</a>' : '') + play + '</div></div>';
  }
  return '<div class="finding"><div class="kicker">Finding your mistakes</div>'
    + '<h2>' + (n.ready ? n.ready + ' found so far' : 'Stockfish is reading your games') + '</h2>'
    + '<p class="sec">It checks your moves, newest games first. Practice opens once three mistakes are found.</p>'
    + '<div class="finds" id="finds">' + recentFindsHtml() + '</div>'
    + '<p class="status" id="astat">' + analysisLine(n) + '</p>'
    + (can ? '<a class="btn-line" data-act="startToday">Start with ' + can + ' now</a>' : '')
    + '</div>';
}
function focusHtml() {
  var f = currentFocus();
  if (!f) return '';
  var fam = FAMILIES.filter(function (x) { return x.key === f.fam; })[0];
  var agg = insightFamiliesQuick().filter(function (x) { return x.fam.key === f.fam; })[0];
  if (!fam || !agg) return '';
  var prog = focusProgress(f), progLine = '';
  if (prog && prog.after.g >= 10 && prog.before.n) {
    var rb = prog.before.m * 100 / prog.before.n, ra = prog.after.m * 100 / Math.max(1, prog.after.n);
    progLine = '<p>In your games since you started: ' + everyMoves(ra).replace('a mistake', 'one') + ' (before: ' + everyMoves(rb).replace('a mistake', 'one') + ').</p>';
  }
  var cost = agg.cost >= 1 ? 'Decided ' + fmtGames(agg.cost) + ' in your recent history.' : plur(agg.count, 'position') + ' in your games.';
  var nDrill = drillItems({ type: 'family', fam: fam.key }, 8).length;
  return '<div class="focus"><div class="kicker">Your focus</div>'
    + '<div class="focus-name">' + esc(fam.name) + '</div>'
    + '<p class="sec">' + cost + '</p>' + progLine
    + '<div class="plan">Next game: ' + esc(fam.habit.charAt(0).toLowerCase() + fam.habit.slice(1)) + '</div>'
    + '<div class="acts"><a class="btn-gold" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'family', fam: fam.key, label: fam.name })) + '">Drill it · ' + plur(nDrill, 'position') + '</a>'
    + '<a class="btn-quiet" data-act="sheet" data-k="family:' + fam.key + '">Details</a>'
    + '<a class="btn-quiet" data-act="view" data-k="insights">Change focus</a></div></div>';
}
function gameDateLine(g) {
  try { return new Date(g.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
}
function doneHtml(ss) {
  var solved = 0, answered = 0;
  var uniq = [];
  ss.keys.forEach(function (k) { if (uniq.indexOf(k) === -1) uniq.push(k); });
  var recap = uniq.map(function (k) {
    var it = model().byKey[k], r = ss.results[k];
    if (!it || !r || r === 'skip') return '';
    answered++;
    if (r !== 'fail') solved++;
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    var word = r === 'first' ? '<span class="win res">✓ first try</span>' : (r === 'fail' ? '<span class="loss res">shown</span>' : '<span class="gold res">✓ with help</span>');
    return '<div class="recap-item" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: k, label: 'One position' })) + '">'
      + boardSvg(pre, { flip: it.g.color === 'black' }) + '<span>' + esc(patternInfo(patternOf(it.b)).name) + '</span>' + word + '</div>';
  }).join('');
  var si = streakInfo(), f = currentFocus();
  var fam = f && FAMILIES.filter(function (x) { return x.key === f.fam; })[0];
  var more = buildCandidates(5).length + dueCards().length;
  return '<div class="today"><div class="kicker">' + esc(ss.label) + '</div>'
    + '<div class="done-big">' + (answered ? solved + ' of ' + answered + ' solved.' : 'Done.') + '</div>'
    + (si.days ? '<p class="sec"><span class="gold">' + FLAME + '</span> ' + si.days + (si.days === 1 ? ' day' : ' days') + ' in a row · '
      + weekDays() + ' of ' + weekGoal() + ' this week</p>' : '')
    + (recap ? '<div class="recap">' + recap + '</div>' : '')
    + (fam ? '<div class="focus"><div class="kicker">For your next game</div><div class="plan">' + esc(fam.habit) + '</div></div>' : '')
    + '<div class="acts-row" style="margin-top:18px">'
      + (more ? '<a class="btn-line" data-act="keepGoing">Practise 5 more</a>' : '')
      + '<a class="btn-gold" href="' + playHref(cfg.tcs[0]) + '">Play a game</a>'
      + '<a class="btn-quiet" data-act="endSession">Back to Today</a>'
    + '</div></div>';
}

/* ── the card ────────────────────────────────────────────────────────────── */
function evalLabel(myCp, mate, it) {
  if (mate != null && mate !== 0) return 'M' + Math.abs(mate);
  var w = evalWhite(it, myCp) / 100;
  return (w > 0 ? '+' : '') + (Math.abs(w) >= 10 ? Math.round(w) : w.toFixed(1));
}
function renderCard() {
  var box = el('train'), ss = ui.session;
  if (!box || !ss) return;
  if (ss.finished) { renderTrain(); return; }
  var a = ss.active;
  if (!a) {
    box.dataset.card = '';
    box.innerHTML = '<div class="card"><div class="card-top">' + dotsHtml(ss) + '</div>'
      + '<div class="panel"><div class="checking"><span class="meter"><i></i></span>Taking a closer look at this position…</div></div></div>';
    return;
  }
  var it = a.it, flip = it.g.color === 'black';
  if (box.dataset.card !== a.key) {
    box.dataset.card = a.key;
    box.innerHTML = '<div class="card">'
      + '<div class="card-top" id="ctop"></div>'
      + '<div class="board-col"><div class="board-row">'
        + '<div class="evalbar' + (flip ? ' flip' : '') + '" id="ebar"><i class="evalbar-fill" id="ebar-fill"></i><span class="evalbar-label" id="ebar-lab"></span></div>'
        + '<div class="board-wrap" id="bwrap"></div>'
      + '</div></div>'
      + '<div class="panel" id="cpanel"></div>'
      + '</div>';
  }
  el('ctop').innerHTML = dotsHtml(ss) + '<span class="card-count tnum">' + Math.min(ss.idx + 1, ss.keys.length) + ' / ' + ss.keys.length + '</span>'
    + '<span class="card-menu"><a data-act="menu">•••</a>' + (a.menuOpen ? menuHtml(a) : '') + '</span>'
    + cardTaskHtml(a);
  /* the board */
  var view, opts = { flip: flip };
  if (a.phase === 'done' && a.explore) {
    view = { st: a.explore.st, last: a.explore.last, ev: a.explore.ev };
    opts.sel = a.explore.sel;
  } else if (a.phase === 'done') {
    view = lineView(a);
  } else {
    var st = a.st;
    if (a.phase === 'checking' && a.ghostMove) {
      st = cloneState(a.st);
      var gm = legalMoves(st).filter(function (m) { return m.from === a.ghostMove[0] && m.to === a.ghostMove[1]; })[0];
      if (gm) applyMove(st, gm);
    }
    view = { st: st, last: a.phase === 'checking' ? a.ghostMove : a.lastMove, ev: it.b.eb };
    opts.sel = a.sel;
    opts.shapes = a.shapes;
    if (a.phase === 'guess' && a.solIdx === 0 && !a.explore) opts.bad = [a.played.from, a.played.to];
    if (a.hints >= 2 && a.phase === 'guess') opts.hint = (a.sol && a.solIdx > 0 ? uciToMove(a.st, a.sol[a.solIdx]) || a.best : a.best).from;
    if (a.animMove) opts.anim = a.animMove;
  }
  opts.mark = view.last;
  var ck = checkedKingSq(view.st);
  if (ck != null) opts.check = ck;
  var bw = el('bwrap');
  bw.innerHTML = boardSvg(view.st, opts) + (a.pendingPromo ? promoHtml(view.st) : '');
  bw.classList.toggle('static', !(a.phase === 'guess' || (a.phase === 'done' && a.explore)));
  releaseAnims(bw);
  a.animMove = null;
  /* the bar: player's view of the position, labelled once answered */
  var myCp = view.ev != null ? view.ev : it.b.eb;
  var wWhite = winPct(evalWhite(it, myCp));
  var fill = el('ebar-fill'), lab = el('ebar-lab');
  if (store.get('nl:evalbar', true)) {
    el('ebar').hidden = false;
    fill.style.height = wWhite + '%';
    var showLab = a.phase === 'done';
    lab.textContent = showLab ? evalLabel(myCp, null, it) : '';
    lab.className = 'evalbar-label ' + ((wWhite >= 50) !== flip ? 'low' : 'high');
  } else el('ebar').hidden = true;
  /* keyboard focus stays on the same control across a repaint, and the
     verdict is read out to screen readers */
  var foc = document.activeElement, fp = el('cpanel');
  var focKey = foc && fp && fp.contains(foc) ? (foc.id || ((foc.getAttribute('data-act') || '') + '|' + (foc.getAttribute('data-k') || ''))) : null;
  fp.innerHTML = panelHtml(a, ss);
  makeFocusable(fp);
  if (focKey) {
    var back = focKey.indexOf('|') < 0 ? el(focKey) : fp.querySelector('[data-act="' + focKey.split('|')[0] + '"]' + (focKey.split('|')[1] ? '[data-k="' + focKey.split('|')[1] + '"]' : ''));
    (back || fp.querySelector(a.phase === 'done' ? '[data-act="next"]' : '#kbmove, [data-act]') || fp).focus({ preventScroll: true });
  }
  var said = (el('ctop').querySelector('.card-task') || {}).textContent || '';
  var live = el('sr-live');
  if (!live) { live = document.createElement('div'); live.id = 'sr-live'; live.className = 'sr-live'; live.setAttribute('aria-live', 'polite'); document.body.appendChild(live); }
  if (live.textContent !== said) live.textContent = said;
}
/* phones: the board fills the screen, so the task and the verdict ride
   above it in one short line (the panel below keeps the full text) */
function cardTaskHtml(a) {
  var side = a.it.g.color === 'white' ? 'White' : 'Black', txt, cls = '';
  var strip = function (h) { return String(h).replace(/<span class="dim">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ''); };
  if (a.phase === 'checking') txt = 'Checking ' + esc(a.checking || 'your move') + '…';
  else if (a.phase === 'done') {
    var best = esc(a.lines.best.san[0] || ''), why = esc(a.cls.sentences.best || '');
    if (a.result === 'fail' || a.revealed) txt = 'The answer: ' + (why || best + '.');
    else if (a.alt) { txt = '<b>✓ Your move works too.</b> The engine prefers ' + best + '.'; cls = ' good'; }
    else { txt = '<b>✓ ' + (a.result === 'first' ? 'Found it.' : 'You got there.') + '</b> ' + (why || best + '.'); cls = ' good'; }
  }
  else if (a.verdict) { txt = strip(a.verdict.html); cls = a.verdict.cls === 'verdict-bad' ? ' bad' : (a.verdict.cls === 'verdict-good' ? ' good' : ''); }
  else txt = side + ' to move. ' + (a.sol && a.solIdx > 0 ? 'Keep going.' : 'Find a better move.');
  return '<div class="card-task' + cls + '">' + txt + '</div>';
}
function releaseAnims(root) {
  var ps = root.querySelectorAll('.anim-piece');
  if (!ps.length) return;
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    for (var i = 0; i < ps.length; i++) ps[i].style.transform = 'translate(0px,0px)';
  }); });
}
function promoHtml(st) {
  var w = st.w;
  return '<div class="promo-card"><div class="promo-in">' + ['Q', 'R', 'B', 'N'].map(function (p) {
    return '<a class="promo-opt" data-act="promo" data-k="' + p + '"><svg viewBox="0 0 45 45"><use href="#pc-' + (w ? 'w' : 'b') + p + '"/></svg></a>';
  }).join('') + '</div></div>';
}
function dotsHtml(ss) {
  var seen = {}, out = '';
  ss.keys.forEach(function (k, i) {
    var relearn = ss.relearnOf && ss.relearnOf[k] && seen[k];
    seen[k] = 1;
    var r = relearn ? ss.results[k + '#r'] : ss.results[k];
    var cls = i === ss.idx ? 'on' : (r === 'first' ? 'ok' : (r === 'fail' ? 'bad' : (r ? 'mid' : '')));
    out += '<span class="dot ' + cls + '"></span>';
  });
  return '<div class="dots">' + out + '</div>';
}
function menuHtml(a) {
  var g = a.it.g;
  return '<div class="menu-pop">'
    + '<a href="' + gameHref(g.id, g.color, a.it.b.p) + '">Open the game ↗</a>'
    + '<a href="' + analysisHref(stateFen(a.pre), g.color) + '">Analyse on ' + (isCC() ? 'chess.com' : 'lichess') + ' ↗</a>'
    + '<span class="sep"></span>'
    + '<a data-act="dispute" data-k="misclick">Not a real mistake: a misclick or premove</a>'
    + '<a data-act="dispute" data-k="decided">Not a real mistake: the game was already decided</a>'
    + '<a data-act="dispute" data-k="engine">Not a real mistake: I think the engine is wrong</a>'
    + '<span class="sep"></span>'
    + '<a data-act="skip">Skip this one</a>'
    + '<a data-act="endSession">End the session</a>'
    + '</div>';
}
function ctxHtml(a) {
  var g = a.it.g, b = a.it.b;
  var tc = g.tc ? g.tc.replace('+', '+') : '';
  var bits = ['vs <b>' + esc(g.opp) + '</b>' + (g.oppR ? ' (' + g.oppR + ')' : ''), gameDateLine(g), (tc ? tc + ' ' : '') + perfLabel(g.perf).toLowerCase(), 'move ' + (Math.floor(b.p / 2) + 1)];
  if (b.c != null) bits.push(clockWords(b.c) + ' left');
  var tags = [];
  if (b.d) tags.push('<span class="tag">this move ' + decisiveWords(g) + '</span>');
  if (ss_relearn(a)) tags.push('<span class="tag">one more try</span>');
  return '<p class="ctx">' + bits.join(' · ') + (tags.length ? '<br>' + tags.join(' · ') : '') + '</p>';
}
function ss_relearn(a) { var ss = ui.session; return !!(ss && ss.relearnOf && ss.relearnOf[a.key] && ss.keys.indexOf(a.key) !== ss.idx); }
function clockWords(s) {
  if (s >= 3600) return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60);
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function panelHtml(a, ss) {
  var it = a.it, b = it.b, side = it.g.color === 'white' ? 'White' : 'Black';
  var h = ctxHtml(a);
  if (a.phase !== 'done') {
    var rec0 = srsRec(it), review = rec0 && rec0.box >= 2 && !a.firstSight;
    h += '<div class="task">' + (a.sol && a.solIdx > 0 ? 'Keep going.' : 'You are ' + side + '. Find a better move.') + '</div>';
    if (!review && a.solIdx === 0) {
      h += '<p class="stakes">The red arrow is the move you played. It took you from '
        + Math.round(b.wb) + '% to ' + Math.round(b.wa) + '% winning chances.</p>';
    }
    if (a.tier === 1 && a.solIdx === 0 && !a.hints) h += '<p class="stakes dim">Look at every check and capture first, for both sides.</p>';
    if (!store.get('nl:marksSeen', false) && ss.idx === 0 && a.firstSight) {
      h += '<div class="coach-mark"><b>How this works</b><ol>'
        + '<li>This position is from your own game. The red arrow is what you played.</li>'
        + '<li>The bar on the left shows who is winning.</li>'
        + '<li>Find a better move: drag a piece, or tap it and tap a square. Stuck? Tap Hint.</li>'
        + '</ol><a data-act="marksSeen">Got it</a></div>';
    }
    if (a.hints >= 1) h += '<p class="hint-note">' + esc(hintText(a)) + (a.hints >= 2 ? ' The piece to move is circled.' : '') + '</p>';
    if (a.phase === 'checking') h += '<div class="checking"><span class="meter"><i></i></span>Checking ' + esc(a.checking || 'your move') + ' with Stockfish…</div>';
    else if (a.verdict) h += '<p class="verdict ' + a.verdict.cls + '">' + a.verdict.html + '</p>';
    if (a.phase === 'guess') {
      var acts = '';
      if (a.strongerOffer) acts += '<a class="btn-line" data-act="dismissStronger">Keep looking</a><a class="btn-gold" data-act="reveal">Show the best move</a>';
      else {
        if (a.hints < 2 && !(a.tier === 3 && !a.misses)) acts += '<a class="btn-line' + (a.misses ? ' btn-pulse' : '') + '" data-act="hint">Hint</a>';
        acts += '<a class="' + (a.misses >= 2 ? 'btn-gold' : 'btn-line') + '" data-act="reveal">Show the answer</a>';
        acts += '<a class="btn-quiet" data-act="skip">Skip</a>';
      }
      h += '<div class="acts-row sticky-acts">' + acts + '</div>';
      h += '<label class="kb-move">Type your move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. Nf3 or g1f3" aria-label="Type your move"></label>';
    }
    return h;
  }
  /* done: the why */
  var best = a.lines.best.san[0] || '';
  var head;
  if (a.result === 'fail' || a.revealed) head = '<p class="verdict verdict-bad">The answer was <b>' + esc(best) + '</b>.'
    + (a.foundGood ? ' <span class="sec">Your ' + esc(a.foundGood.san) + ' was close.</span>' : '') + '</p>';
  else if (a.alt) head = '<p class="verdict verdict-good">✓ ' + esc(a.lines.yours ? a.lines.yours.san[0] : 'Your move') + ' works too. '
    + '<span class="sec">It keeps ' + Math.round(a.alt.win) + '%; the engine\'s pick, ' + esc(best) + ', keeps ' + Math.round(a.alt.best) + '%.</span></p>';
  else head = '<p class="verdict verdict-good">✓ ' + esc(best) + (a.result === 'first' ? '. Found it.' : '. You got there.') + '</p>';
  h += head;
  var tabs = [['best', 'Best move'], ['refute', 'Your game move'], ['game', 'What happened']];
  if (a.lines.yours) tabs.push(['yours', 'Your move']);
  var cur = a.view.line, L = a.lines[cur];
  h += '<div class="lines"><div class="line-tabs">' + tabs.map(function (t) {
    return '<a class="line-tab' + (cur === t[0] ? ' on' : '') + '" data-act="lineTab" data-k="' + t[0] + '">' + t[1] + '</a>';
  }).join('') + '</div>';
  var moves = L.san.map(function (s, i) {
    var ply = L.ply0 + i;
    var label = (ply % 2 === 0 ? (Math.floor(ply / 2) + 1) + '. ' : (i === 0 ? (Math.floor(ply / 2) + 1) + '... ' : '')) + s;
    var bad = (cur === 'refute' || cur === 'game') && i === 0;
    return '<a class="mv' + (a.view.idx === i ? ' mv-on' : '') + (bad ? ' mv-bad' : '') + '" data-act="lineTo" data-n="' + i + '">' + esc(label) + (bad ? '?' : '') + '</a>';
  }).join(' ');
  h += '<div class="line-row"><a class="nav-btn' + (a.view.idx < 0 ? ' nav-off' : '') + '" data-act="lineBack">‹</a>'
    + '<a class="nav-btn' + (a.view.idx >= L.states.length - 1 ? ' nav-off' : '') + '" data-act="lineFwd">›</a>'
    + '<div class="moves">' + (moves || '<span class="dim">no moves</span>') + '</div></div></div>';
  h += '<p class="explain">' + explainFor(a, cur) + '</p>';
  var t = patternOf(b), info = patternInfo(t), fam = familyOf(t);
  h += '<a class="pchip" data-act="sheet" data-k="pattern:' + t + '">' + esc(info.name) + ' ›</a>';
  if (a.showHabit) h += '<p class="habit">' + esc(info.habit) + '</p>';
  h += '<div class="next-row">' + runHtml(a.rec || srsRec(it), a) + '</div>';
  h += '<div class="acts-row sticky-acts"><a class="nav-btn sticky-nav" data-act="lineBack" aria-label="Back one move">‹</a>'
    + '<a class="nav-btn sticky-nav" data-act="lineFwd" aria-label="Forward one move">›</a><a class="btn-big" data-act="next">'
    + (ss.idx + 1 >= ss.keys.length && !(ss.relearn && ss.relearn.length) ? 'Finish' : 'Next') + '</a>'
    + '<a class="btn-quiet" data-act="explore">Try your own moves</a></div>';
  if (a.explore) h += '<p class="dim" style="font-size:13px">Exploring: ' + esc(a.explore.san.join(' ') || 'make a move on the board')
    + (a.explore.ev != null ? ' · ' + evalLabel(a.explore.ev, null, it) : (a.explore.san.length ? ' · thinking…' : '')) + ' · <a data-act="exploreOff">back to the lines</a></p>';
  void fam;
  return h;
}
function explainFor(a, line) {
  var s = a.cls.sentences, it = a.it;
  if (line === 'best') return esc(s.best || 'The best move keeps your position together.');
  if (line === 'refute') return esc(s.game);
  if (line === 'yours') return 'Your move and how the engine expects the game to go.';
  /* what happened: did the opponent find the punishment? */
  var ru = unpackUci(it.b.ru), gm = a.lines.game.uci;
  var r1 = ru[0], real = gm[1];
  var after = wpAt(it.g, it.b.p + 1);
  if (real && r1 && real !== r1 && after != null && after >= it.b.wa + 10) {
    return '<span class="missed-it">Your opponent missed it.</span> They played ' + esc(a.lines.game.san[1] || '') + ' instead, and you were back in the game.';
  }
  if (real && r1 && real === r1) return 'Your opponent found the punishment right away.';
  return 'The moves that were actually played in your game.';
}
function runHtml(rec, a) {
  if (!rec) return '';
  if (isLearned(rec)) return '<span class="run"><span class="run-word">Learned. A spot check comes back ' + dueWhen(rec.due) + '.</span></span>';
  var st = Math.min(3, rec.streak || 0), dots = '';
  for (var i = 0; i < 3; i++) dots += '<span class="run-step' + (i < st ? ' run-won' : '') + '"></span>';
  var word = a.result === 'fail' || a.result === 'retry' ? 'It comes back ' + dueWhen(rec.due) + (a.relearnQueued ? ', and once more at the end of this session.' : '.')
    : 'Next review ' + dueWhen(rec.due) + '.';
  return '<span class="run">' + dots + '<span class="run-word">' + word + '</span></span>';
}
function scrollTrainerTop() {
  if (window.innerWidth > 860) return;
  var t = el('train');
  if (!t) return;
  var y = t.getBoundingClientRect().top + window.pageYOffset - ((el('bar') || {}).offsetHeight || 52) - 6;
  try { window.scrollTo({ top: y, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, y); }
}

/* ── Insights ────────────────────────────────────────────────────────────── */
function renderInsights() {
  var box = el('insights');
  if (!box || !cfg.user) return;
  if (ui.view !== 'insights' && box.innerHTML) return;       /* rendered on demand */
  var r = insightReport(), n = analysisNumbers();
  if (!data.games.length) {
    box.innerHTML = '<div class="ins">' + (data.sections.games === 'loading' ? '<p class="loading">Reading your games…</p>'
      : '<p class="sec">Insights appear once there are rated games to read. See Today for what to do next.</p>') + '</div>';
    return;
  }
  var partial = n.covered < n.total;
  var h = '<div class="ins"><div class="kicker">Insights · based on ' + plur(r.games, 'game') + (partial ? ' so far' : '') + '</div>';
  if (!r.families.length) {
    h += '<h2>Your report appears as Stockfish reads your games.</h2><p class="lead">' + n.covered + ' of ' + n.total + ' games checked. The first patterns show up after a handful of games; the full picture at about ' + INSIGHT_MIN_GAMES + '.</p></div>';
    box.innerHTML = h;
    return;
  }
  var cov = r.coverage, top = r.families[0];
  var lead = '';
  if (cov.losses >= 5) {
    lead = 'Of your last ' + cov.losses + ' losses, ' + cov.decided + ' came down to one big mistake.';
    if (top.cost >= 1) lead += ' The biggest leak: <b>' + esc(top.fam.name.toLowerCase()) + '</b>, which decided ' + fmtGames(top.cost) + '.';
  } else lead = 'Your mistakes, grouped by the habit that would prevent them.';
  h += '<h2>What is costing you games</h2><p class="lead">' + lead + '</p>';
  var focus = currentFocus();
  r.families.forEach(function (a) {
    var types = a.patterns.slice().sort(function (x, y) { return y.count - x.count; }).slice(0, 4).map(function (s) {
      return '<span>' + esc(s.info.plural) + ' <b>' + s.count + '</b></span>';
    }).join('');
    var trend = '';
    if (a.recent >= 10 && a.older >= 10) {
      var up = a.recent > a.older * 1.2, down = a.recent < a.older * 0.8;
      trend = up ? ' · <span class="loss">more often lately</span>' : (down ? ' · <span class="win">less often lately</span>' : '');
    }
    var total = Math.max(1, a.count), lw = a.learned * 100 / total, pw = a.practising * 100 / total;
    h += '<a class="fam" data-act="sheet" data-k="family:' + a.fam.key + '"><div class="fam-top">'
      + '<span class="fam-name">' + esc(a.fam.name) + (focus && focus.fam === a.fam.key ? ' <span class="kicker">focus</span>' : '') + '</span>'
      + '<span class="fam-cost' + (a.cost < 1 ? ' none' : '') + '">' + (a.cost >= 1 ? 'decided ' + fmtGames(a.cost) : plur(a.count, 'position')) + '</span></div>'
      + '<div class="fam-types">' + types + '</div>'
      + '<p class="fam-sub">' + a.learned + ' learned · ' + a.practising + ' in practice' + (a.fresh ? ' · ' + a.fresh + ' waiting' : '') + trend + '</p>'
      + '<div class="meter-row"><i class="m-learned" style="width:' + lw + '%"></i><i class="m-practice" style="width:' + pw + '%"></i></div></a>';
  });
  if (r.ready) {
    h += '<div class="section-h"><span class="kicker">Where your mistakes happen</span><span class="dim" style="font-size:12px">' + plur(r.games, 'game') + '</span></div>';
    if (r.slices.length) {
      r.slices.forEach(function (s) {
        h += '<div class="slice"><p>' + esc(s.text) + '</p><a class="btn-gold" data-act="drill" data-spec="' + esc(JSON.stringify(s.spec)) + '">Drill these</a></div>';
      });
    } else h += '<p class="sec">No clear pattern yet by colour, phase, clock or opening. This sharpens as more games are checked; for now the mistake types above are where the points are.</p>';
    if (r.months && r.months.length >= 2) {
      var max = Math.max.apply(null, r.months.map(function (m) { return m.rate; }));
      h += '<div class="section-h"><span class="kicker">Your mistakes over time</span></div>'
        + r.months.map(function (m, i) {
          var d = new Date(Math.floor(m.k / 12), m.k % 12, 1), y = Math.floor(m.k / 12);
          var showYear = i === 0 || Math.floor(r.months[i - 1].k / 12) !== y;
          return '<div class="mrow"><span class="mrow-l">' + d.toLocaleDateString('en-GB', { month: 'short' }) + (showYear ? ' ’' + String(y).slice(2) : '') + '</span>'
            + '<span class="mrow-bar"><i style="width:' + Math.max(4, Math.round(m.rate * 100 / Math.max(0.1, max))) + '%"></i></span>'
            + '<span class="mrow-v">' + everyMoves(m.rate).replace('a mistake ', '') + '</span></div>';
        }).join('')
        + '<p class="sec" style="font-size:13.5px">How often you made a mistake, month by month. Shorter bars mean fewer mistakes.</p>';
    }
    h += peerHtml();
  } else {
    h += '<p class="sec" style="margin-top:20px">After ' + INSIGHT_MIN_GAMES + ' checked games you will also see where your mistakes happen: as White or Black, in which phase, on the clock and in which openings.</p>';
  }
  h += '</div>';
  box.innerHTML = h;
}
/* context from 6.7 million lichess games at your rating (not shown to
   newer players, where comparison discourages more than it helps) */
function peerHtml() {
  if (playerTier() === 1) return '';
  var perf = trackedPerfs()[0], rating = data.user && data.user.perfs && data.user.perfs[perf] && data.user.perfs[perf].rating;
  var cell = rating ? peerCell(perf, rating) : null;
  if (!cell) return '';
  var gs = data.games.filter(function (g) { return g.perf === perf; });
  var mine = function (fn) { var m = meanOf(gs, fn); return m && m.n >= 15 ? m.v : null; };
  var rows = [];
  var conv = gs.filter(function (g) { return g.ev && g.ev[1] >= 200; });
  if (conv.length >= 15 && cell.conv != null) rows.push(['Winning positions you convert', Math.round(conv.filter(function (g) { return g.res === 'win'; }).length * 100 / conv.length), cell.conv]);
  var res = gs.filter(function (g) { return g.ev && g.ev[2] <= -200; });
  if (res.length >= 15 && cell.resource != null) rows.push(['Lost positions you save', Math.round(res.filter(function (g) { return g.res !== 'loss'; }).length * 100 / res.length), cell.resource]);
  var ae = mine(function (g) { return g.acc2 ? g.acc2[3] : null; });
  if (ae != null && cell.acc_end != null) rows.push(['Endgame accuracy', Math.round(ae), cell.acc_end]);
  if (!rows.length) return '';
  return '<div class="section-h"><span class="kicker">Next to players at your rating</span><span class="dim" style="font-size:12px">' + perfLabel(perf) + (isCC() ? ', your level' : ' ~' + Math.floor(bandEquivRating(perf, rating) / 100) * 100) + '</span></div>'
    + rows.map(function (r) {
      return '<div class="peer-row"><span>' + r[0] + '</span><span><b>' + r[1] + '%</b> <span class="dim">vs ' + Math.round(r[2]) + '%</span></span></div>';
    }).join('');
}

/* ── sheets ──────────────────────────────────────────────────────────────── */
function openSheet(kind) {
  ui.sheet = kind;
  var ov = el('overlay');
  var body = sheetHtml(kind);
  if (!body) return;
  if (!ui.sheetReturn) ui.sheetReturn = document.activeElement;
  ov.innerHTML = '<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Details" tabindex="-1">'
    + '<a class="close" data-act="closeSheet" aria-label="Close">×</a>' + body + '</div></div>';
  document.documentElement.style.overflow = 'hidden';
  var sh = ov.querySelector('.sheet'), h3 = sh && sh.querySelector('h3');
  if (h3) { h3.id = 'sheet-title'; sh.removeAttribute('aria-label'); sh.setAttribute('aria-labelledby', 'sheet-title'); }
  if (sh) sh.focus({ preventScroll: true });
}
function closeSheet() {
  ui.sheet = null;
  var ov = el('overlay');
  if (ov) ov.innerHTML = '';
  document.documentElement.style.overflow = '';
  var back = ui.sheetReturn;
  ui.sheetReturn = null;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}
function sheetHtml(kind) {
  var parts = String(kind).split(':'), k = parts[1];
  if (parts[0] === 'family') {
    var fam = FAMILIES.filter(function (f) { return f.key === k; })[0];
    var agg = insightReport().families.filter(function (a) { return a.fam.key === k; })[0];
    if (!fam || !agg) return '';
    var focus = currentFocus();
    var rows = agg.patterns.slice().sort(function (x, y) { return y.cost - x.cost || y.count - x.count; }).map(function (s) {
      return '<div class="peer-row" data-act="sheet" data-k="pattern:' + s.key + '" style="cursor:pointer"><span>' + esc(s.info.plural) + '</span><span><b>' + s.count + '</b>'
        + (s.cost >= 1 ? ' <span class="loss">· decided ' + fmtGames(s.cost) + '</span>' : '') + ' ›</span></div>';
    }).join('');
    return '<div class="kicker">Mistake family</div><h3>' + esc(fam.name) + '</h3>'
      + '<p>' + (agg.cost >= 1 ? 'These mistakes decided ' + fmtGames(agg.cost).replace(' games', '').replace('one game', 'one') + ' of your recent games. ' : '') + plur(agg.count, 'position') + ' from your games: ' + agg.learned + ' learned, ' + agg.practising + ' in practice.</p>'
      + '<div class="focus"><div class="kicker">The habit that fixes it</div><div class="plan">' + esc(fam.habit) + '</div></div>'
      + '<div style="margin:14px 0 6px">' + rows + '</div>'
      + examplesHtml({ type: 'family', fam: k })
      + '<div class="acts-row" style="margin-top:16px"><a class="btn-big" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'family', fam: k, label: fam.name })) + '">Drill ' + plur(drillItems({ type: 'family', fam: k }, 8).length, 'position') + '</a>'
      + (focus && focus.fam === k ? '<span class="dim">Your current focus</span>' : '<a class="btn-quiet" data-act="setFocus" data-k="' + k + '">Make this my focus</a>') + '</div>';
  }
  if (parts[0] === 'pattern') {
    var info = PATTERN[k];
    var s = patternStats().filter(function (x) { return x.key === k; })[0];
    if (!info) return '';
    return '<div class="kicker">' + esc(familyOf(k).name) + '</div><h3>' + esc(info.plural) + '</h3>'
      + '<p>' + (s ? plur(s.count, 'position') + ' from your games' + (s.cost >= 1 ? ', which decided ' + fmtGames(s.cost) : '') + '. ' + s.fixed + ' learned.' : 'None in your games yet.') + '</p>'
      + '<div class="focus"><div class="kicker">The habit</div><div class="plan">' + esc(info.habit) + '</div></div>'
      + examplesHtml({ type: 'pattern', key: k })
      + (s ? '<div class="acts-row" style="margin-top:16px"><a class="btn-big" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'pattern', key: k, label: info.plural })) + '">Drill ' + plur(Math.min(8, s.count), 'position') + '</a></div>' : '');
  }
  if (parts[0] === 'whatsnew') {
    return '<div class="kicker">What changed</div><h3>notlichess is now one thing: your mistakes.</h3>'
      + '<p>The openings trainer, puzzles and the Play tab are retired. Everything here is now built from the positions where your own games went wrong.</p>'
      + '<p><b>New:</b> after each position you see why: what your game move allowed, the best line, and what actually happened in the game, with an evaluation bar. Mistakes are named (hanging pieces, forks, missed mates and more) and ranked by the games they cost you. Insights now point straight at drills.</p>'
      + '<p class="sec">Your practice history and streak carried over.</p>'
      + '<div class="acts-row"><a class="btn-big" data-act="closeSheet">Got it</a></div>';
  }
  return '';
}
/* a decisive mistake loses a game, or turns a win into a draw */
function decisiveWords(g) { return g.res === 'draw' ? 'cost you the win' : 'lost the game'; }
function examplesHtml(spec) {
  var items = drillItems(spec, 6);
  if (!items.length) return '';
  return '<div class="kicker" style="margin-top:14px">From your games</div><div class="ex-list">' + items.map(function (it) {
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    return '<div class="ex" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: it.key, label: 'One position' })) + '">'
      + boardSvg(pre, { flip: it.g.color === 'black', bad: [uciToMove(pre, uciOfSan(it.g.mv, it.b.p)) || { from: 0, to: 0 }].map(function (m) { return m.from; }).concat([(uciToMove(pre, uciOfSan(it.g.mv, it.b.p)) || { to: 0 }).to]) })
      + '<span>vs ' + esc(it.g.opp) + ' · ' + gameDateLine(it.g) + (it.b.d ? ' · <span class="loss">' + decisiveWords(it.g) + '</span>' : '') + '</span></div>';
  }).join('') + '</div>';
}

/* ── settings ────────────────────────────────────────────────────────────── */
function renderSettings() {
  var box = el('settings');
  if (!box) return;
  if (!ui.settingsOpen) { box.innerHTML = ''; return; }
  var perfs = trackedPerfs();
  var chip = function (act, k, label, on) {
    return '<a class="chip' + (on ? ' chip-on' : '') + '" data-act="' + act + '" data-k="' + k + '">' + (on ? '✓ ' : '') + label + '</a>';
  };
  box.innerHTML = '<div class="settings"><h2>Settings</h2><div class="set-grid">'
    + '<div class="set-block"><span class="kicker">Games to learn from</span><p>Which of your rated games to read. Most players pick the one or two they play most.</p><div class="chips">'
      + ['rapid', 'blitz', 'bullet', 'classical'].filter(function (p) { return !isCC() || p !== 'classical'; }).map(function (p) {
        return chip('perf', p, perfLabel(p) + ' <span class="dim">' + PERF_HINT[p] + '</span>', perfs.indexOf(p) !== -1);
      }).join('') + '</div>'
      + '<p style="margin-top:10px">Games kept per kind:</p><div class="chips">' + LIMIT_CHOICES.map(function (n) {
        return chip('limit', n, n, cfg.perFormat === n);
      }).join('') + '</div></div>'
    + '<div class="set-block"><span class="kicker">Practice</span><p>Positions in a day\'s session. New ones join a few at a time, so your reviews never pile up.</p><div class="chips">'
      + [[5, 'Short · 5'], [10, 'Normal · 10'], [20, 'Long · 20']].map(function (o) { return chip('size', o[0], o[1], sessionSize() === o[0]); }).join('')
      + '</div><p style="margin-top:10px">Weekly goal (days):</p><div class="chips">'
      + [3, 4, 5, 7].map(function (n) { return chip('weekGoal', n, n, weekGoal() === n); }).join('')
      + '</div><p style="margin-top:10px">Help while solving:</p><div class="chips">'
      + [['auto', 'Set by my rating'], ['more', 'More help'], ['less', 'Less help']].map(function (o) { return chip('help', o[0], o[1], store.get('nl:help', 'auto') === o[0]); }).join('')
      + '</div>'
      + '<label class="check" style="margin-top:10px"><input type="checkbox" data-act="evalbarToggle"' + (store.get('nl:evalbar', true) ? ' checked' : '') + '> Evaluation bar beside the board</label>'
      + '<label class="check"><input type="checkbox" data-act="sound"' + (cfg.sound ? ' checked' : '') + '> Sounds</label></div>'
    + '<div class="set-block"><span class="kicker">Your data</span><p>Your games, analysis and progress are stored in this browser, not on a server. The site uses Microsoft Clarity to see how it is used.</p>'
      + '<div class="chips"><a class="chip" data-act="reload">Check for new games</a><a class="chip" data-act="exportProgress">Save progress to a file</a><a class="chip" data-act="importProgress">Load progress from a file</a></div>'
      + '<p style="margin-top:10px" class="dim">' + gamesLine() + '</p>'
      + '<p style="margin-top:10px"><a data-act="resetProgress" class="' + (ui.resetArmed ? 'loss' : '') + '">' + (ui.resetArmed ? 'Tap again to reset your practice history' : 'Reset practice history') + '</a> · '
      + '<a data-act="wipe" class="' + (ui.wipeArmed ? 'loss' : '') + '">' + (ui.wipeArmed ? 'Tap again to erase everything' : 'Erase everything') + '</a></p></div>'
    + '</div><p style="margin-top:18px"><a data-act="settings">Close settings</a></p></div>';
}
function gamesLine() {
  if (data.sections.games === 'loading') return 'Reading games…';
  var c = loadCachedGames();
  return plur(data.games.length, 'game') + (c.fetchedAt ? ' · checked ' + ago(c.fetchedAt) : '');
}

/* ── footer ──────────────────────────────────────────────────────────────── */
function renderFoot() {
  var f = el('foot');
  if (!f) return;
  f.innerHTML = '<span class="foot-line">Free and open source. Your games and progress stay in this browser.</span>'
    + '<span class="foot-links"><a data-act="coffee">☕ Buy the developer a coffee</a>'
    + '<a href="https://lichess.org/patron">♞ Donate to Lichess</a>'
    + '<a href="https://github.com/thatsiavash/notlichess">Source</a></span>';
}

