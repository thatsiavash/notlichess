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
  if (cfg.user && data.games.length && !data.wiped) saveGames(data.games);
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
  /* Back closes a sheet first, then ends a session */
  if (ui.sheet) { closeSheet(true); return; }
  var am = ui.session && ui.session.active;
  if (am && am.menuOpen) { am.menuOpen = false; renderCard(); try { history.pushState({ nlSession: 1 }, '', location.href); } catch (e) {} return; }
  /* then leaves an exploration, back to the lesson */
  if (am && am.explore) { exploreExit('pop'); try { history.pushState({ nlSession: 1 }, '', location.href); } catch (e) {} return; }
  if (ui.session) { endSession(true); return; }
  var h = (location.hash || '').replace('#', '');
  if (h === 'coach' || h === 'insights') h = 'insights'; else h = 'train';
  if (h !== ui.view) setView(h, true);
});
function renderViews() {
  var nav = el('views');
  if (!nav) return;
  /* a quiet dot while today's session is not done: never a count */
  var pending = cfg.user && !(dayLoad().sessions > 0) && (dueCards().length > 0 || todayPlan().keys.length > 0);
  nav.innerHTML = VIEWS.map(function (v) {
    return '<a class="view-tab' + (ui.view === v[0] ? ' view-on' : '') + '" data-act="view" data-k="' + v[0] + '" role="tab" aria-selected="' + (ui.view === v[0]) + '">'
      + v[1] + (v[0] === 'train' && pending && !(ui.session && ui.session.active) ? '<span class="tab-dot" aria-label="practice waiting"></span>' : '') + '</a>';
  }).join('');
  el('view-train').hidden = ui.view !== 'train';
  el('view-insights').hidden = ui.view !== 'insights';
  /* session mode: the board and nothing else */
  document.body.classList.toggle('in-session', !!ui.session && ui.view === 'train');
}
function renderShell() {
  if (location.search) {
    try { history.replaceState(null, '', location.pathname + (location.hash || '#train')); } catch (e) {}
  }
  el('main').innerHTML = '<div class="page">'
    + '<nav id="views" class="views" role="tablist"></nav>'
    + '<div id="view-train" class="view"><section id="trainbox"></section></div>'
    + '<div id="view-insights" class="view" hidden><section id="insightsbox"></section></div>'
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
  bar.innerHTML = '<div class="brand"><a class="brand-name" data-act="home">' + KNIGHT_MARK + '<span>notlichess</span></a></div>'
    + '<div class="bar-right">'
      + (cfg.user ? '<a class="icon-btn" data-act="settings" aria-label="Settings" title="Settings">' + ICON_GEAR + '</a>' : '')
    + '</div><span class="read-line" id="read-line" aria-hidden="true"><i></i></span>';
  renderAnalysisStatus();
}
/* icons: one style, 1.5 px strokes in the text colour (gear and refresh
   after Feather, MIT) */
var KNIGHT_MARK = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 21h11v-2.2c0-3.2-1.2-5.6-2.4-7.4-.8-1.2-.6-2.4.4-3.2l-1.6-1c.3-1.4-.3-2.8-1.6-3.6l-.6 1.6c-2.8.2-5 2-6 4.6L4 13.2c-.4.9.1 1.9 1 2.1l1.2.3c.8.2 1.7-.2 2.1-.9l.9-1.4c.8.4 1.6.3 2.2-.2-.2 1.8-1.6 3.1-3.2 4.2C7.4 18.3 7 19.6 7 21z"/></svg>';
var ICON_GEAR = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
var ICON_REFRESH = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

/* the engine at work: one small status that never re-renders anything else */
function analysisNumbers() {
  var c = scanCoverage();
  var ready = allMistakes().filter(trainable).length;
  return { covered: c.covered, total: c.total, ready: ready,
           working: SF.state !== 'failed' && (scanState.running || scanState.pending || enrichState.running) };
}
var lastReadyShown = -1, lastTodaySig = '', lastSigCheck = 0;
/* what Today says depends on the plan and the focus: both move while reading */
function todaySig(fh) { return todayPlan().keys.join(',') + '|' + (fh == null ? focusHtml() : fh); }
function renderAnalysisStatus() {
  var n = analysisNumbers();
  /* while Stockfish reads, a thin line on the header's bottom edge */
  var rl = el('read-line');
  if (rl) {
    var reading = n.working && n.total && n.covered < n.total;
    rl.hidden = !reading;
    if (reading) rl.firstChild.style.width = Math.round(n.covered * 100 / n.total) + '%';
  }
  var line = el('astat');
  if (line) line.innerHTML = analysisLine(n);
  var rp = el('rp-n');
  if (rp && n.total) { rp.textContent = n.covered + ' of ' + n.total + ' games'; rp.previousSibling.firstChild.style.width = Math.round(n.covered * 100 / n.total) + '%'; }
  /* the Today view changes shape when the first mistakes arrive */
  if (ui.view === 'train' && !ui.session) {
    var bucket = n.ready >= 3 ? 3 : n.ready;
    var hero = el('hero-n'), want = hero ? +hero.getAttribute('data-n') : 0;
    if (bucket !== lastReadyShown) { lastReadyShown = bucket; renderTrain(); }
    else if (hero && want < 5 && n.ready > want && todayPlan().keys.length > want) renderTrain();
    else if (n.ready >= 3 && Date.now() - lastSigCheck > 3000 && (lastSigCheck = Date.now()) && todaySig() !== lastTodaySig) renderTrain();
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
  /* nothing to say once every game is read; while reading, one line */
  if (n.covered >= n.total) return '';
  return '<span>Stockfish is still reading your games: ' + n.covered + ' of ' + n.total + '.</span>';
}
function renderEngineState() { renderAnalysisStatus(); }

/* ── Today ───────────────────────────────────────────────────────────────── */
function renderTrain() {
  var box = el('trainbox');
  if (!box || !cfg.user) return;
  var ss = ui.session;
  if (ss && ss.finished) { box.dataset.card = ''; box.innerHTML = doneHtml(ss); return; }
  if (ss) { renderCard(); return; }
  box.dataset.card = '';
  var n = analysisNumbers();
  var gamesLoading = data.sections.games === 'loading';
  if (!data.games.length) {
    var site = isCC() ? 'chess.com' : 'lichess';
    box.innerHTML = '<div class="today">' + (gamesLoading
      ? stateCard('Reading your games', 'Fetching your rated games from ' + site + '.', '')
      : (data.sections.games === 'fail'
        ? stateCard(site + ' did not answer.', 'Your saved games and progress are all here. Check your connection and try again.', '<a class="btn-big" data-act="reload">Try again</a>')
        : stateCard('No rated games yet.', 'notlichess reads rated live games on ' + site + ': bullet, blitz, rapid' + (isCC() ? '' : ' and classical') + '. '
          + (isCC() ? 'Daily games are not read yet.' : 'Correspondence games are not read yet.') + ' Play a few rated games, then come back. Your mistakes will be waiting.',
          '<a class="btn-big" href="' + playHref(cfg.tcs[0]) + '">Play a game ↗</a>')))
      + '</div>';
    return;
  }
  var since = sinceHtml();
  if (n.ready < 3) { box.innerHTML = '<div class="today">' + since + findingHtml(n) + '</div>'; return; }
  var saved = savedSession();
  var day = dayLoad();
  /* the day has a finish line: the chosen session done means done for today */
  var doneToday = (day.sessions || 0) > 0 || (!saved && !todayPlan().keys.length);
  var fh = focusHtml();
  lastTodaySig = todaySig(fh);
  box.innerHTML = '<div class="today today-grid"><div class="today-main">' + since
    + (saved ? resumeHtml(saved) : (doneToday ? doneTodayHtml() : heroHtml()))
    + fh
    + '<p class="status" id="astat">' + analysisLine(n) + '</p>'
    + '</div>' + latestGamesHtml() + '</div>';
}
/* the latest games, each one a way into its own mistakes */
function latestGamesHtml() {
  var games = scopedGames().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 6);
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
    else if (!e) right = g.res === 'loss' ? '<span class="lg-state dim">No single big mistake</span>' : '<span class="lg-state ok">✓ Clean game</span>';
    else right = '<span class="lg-state">' + e.n + (e.n === 1 ? ' mistake' : ' mistakes')
      + (e.lost ? '<i>' + (g.res === 'draw' ? 'one cost the win' : 'one cost the game') + '</i>' : '') + '</span>';
    /* a game with cards opens its drill; one without opens on its own site */
    var attrs = e ? ' data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'game', id: g.id, label: 'Game vs ' + g.opp })) + '" role="button"' : '';
    var tag = e ? 'div' : 'a';
    if (!e) attrs = ' href="' + gameHref(g.id, g.color, 0) + '"';
    return '<' + tag + ' class="lg-row is-open"' + attrs + '>'
      + '<span class="lg-res lg-' + res + '" title="' + esc(g.res) + '">' + res + '</span>'
      + '<span class="lg-who">vs ' + esc(g.opp) + (g.oppR ? ' <span class="dim">' + g.oppR + '</span>' : '')
      + '<small>' + esc(g.perf || '') + ' · ' + agoWords(g.ts) + ' · as ' + g.color + '</small></span>'
      + right + '</' + tag + '>';
  }).join('');
  return '<aside class="latest" id="latest"><div class="latest-head"><div class="kicker">Your latest games</div>'
    + '<a class="icon-btn" data-act="reload" aria-label="Check for new games" title="Check for new games">' + ICON_REFRESH + '</a></div>' + rows
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
/* the weekly goal as its own shape: one segment per day of the goal */
function weekHtml() {
  var goal = goalThisWeek(), done = Math.min(weekDays(), goal), today = dayCounts(dayRecOf(new Date())), segs = '';
  for (var i = 0; i < goal; i++) segs += '<span class="wseg' + (i < done ? ' on' : (i === done && !today ? ' wseg-now' : '')) + '"></span>';
  var weeks = weeksAtGoal();
  return '<div class="week"><div class="wsegs" aria-hidden="true">' + segs + '</div>'
    + '<span>' + Math.min(weekDays(), 7) + ' of ' + goal + ' days this week.' + (weeks >= 2 ? ' ' + weeks + ' weeks in a row at your goal.' : '') + '</span></div>';
}
function heroHtml() {
  var plan = todayPlan();
  var mins = Math.max(1, Math.round(plan.keys.length * 0.8));
  var why;
  var first0 = model().byKey[plan.keys[0]];
  if (plan.firstTime) why = first0 && first0.b.d
    ? 'First, the move that ' + decisiveWords(first0.g, first0.b) + ' vs ' + esc(first0.g.opp) + '.'
      + (plan.keys.slice(1).some(function (k) { var x = model().byKey[k]; return x && cardEase(x) > cardEase(first0); }) ? ' Then easier ones.' : '')
    : 'We\'ll start with the easier ones.';
  else {
    /* the reason to start now: the newest game one of these positions decided */
    var m = model(), dec = plan.keys.map(function (k) { return m.byKey[k]; })
      .filter(function (it) { return it && it.b.d; }).sort(function (x, y) { return y.g.ts - x.g.ts; })[0];
    var reviews = plan.keys.length - plan.fresh;
    if (dec) why = 'Includes the move that ' + decisiveWords(dec.g, dec.b) + ' vs ' + esc(dec.g.opp) + ', ' + agoWords(dec.g.ts) + '.';
    else why = (reviews ? plur(reviews, 'review') + (plan.fresh ? ' and ' + plan.fresh + ' new from your games.' : '.') : plan.fresh + ' new from your games.');
  }
  /* a session finished today without enough tries: say what counts */
  var dl = dayLoad();
  var need = Math.min(3, plan.keys.length);
  if (dl.short && !dl.sessions) why += need > 1 ? ' Try ' + need + ' positions to count today.' : ' Try it to count today.';
  return '<div class="hero">'
    + '<h2 id="hero-n" data-n="' + plan.keys.length + '">' + plur(plan.keys.length, 'position') + ', about ' + plur(mins, 'minute') + '</h2>'
    + '<p class="why">' + why + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" data-act="startToday">Start</a></div></div>';
}
function resumeHtml(s) {
  return '<div class="hero">'
    + '<h2>Pick up where you left off.</h2><p class="why">' + Math.min(sessionDoneCount(s), sessionTotal(s)) + ' of ' + sessionTotal(s) + ' done.'
    + (sessionDoneCount(s) >= sessionTotal(s) ? ' Resume to finish it.' : ' The rest are waiting where you stopped.') + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" data-act="resume">Resume</a><a class="btn-quiet" data-act="dropSession">Start over</a></div></div>';
}
/* the next time something is due back, and how much */
function nextDueHtml() {
  var srs = srsLoad(), next = null;
  Object.keys(srs).forEach(function (k) { var r = srs[k]; if (r.due && !r.hidden && r.due > Date.now() && (!next || r.due < next)) next = r.due; });
  if (!next) return 'Nothing is due back yet.';
  var d0 = new Date(next); d0.setHours(0, 0, 0, 0);
  var d1 = new Date(d0); d1.setDate(d0.getDate() + 1);
  var n = Object.keys(srs).filter(function (k) { var r = srs[k]; return r.due && !r.hidden && r.due >= d0.getTime() && r.due < d1.getTime(); }).length;
  var w = dueWhen(next);
  n = Math.min(n, sessionSize());
  return (w === 'tomorrow' ? 'Tomorrow' : w === 'later today' ? 'Later today' : w.charAt(0).toUpperCase() + w.slice(1)) + ': ' + plur(n, 'review') + ', about ' + Math.max(1, Math.round(n * 0.8)) + (Math.round(n * 0.8) > 1 ? ' minutes.' : ' minute.');
}
function doneTodayHtml() {
  var more = morePracticeKeys().length;
  return '<div class="hero">'
    + '<h2>' + ((dayLoad().sessions || 0) > 0 ? 'Done for today.' : 'Nothing due right now.') + '</h2><p class="why">' + nextDueHtml() + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" href="' + playHref(cfg.tcs[0]) + '">Play a game ↗</a>'
    + (more ? '<a class="btn-quiet" data-act="keepGoing">Practise 5 more</a>' : '') + '</div></div>';
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
/* the first minute: every state takes the Today card's place, one shape */
function stateCard(title, body, action, extra) {
  return '<div class="hero state"><h2>' + title + '</h2>' + (body ? '<p class="why">' + body + '</p>' : '') + (extra || '')
    + (action ? '<div class="acts">' + action + '</div>' : '') + '</div>';
}
function readBar(n) {
  if (!n.total) return '';
  return '<div class="read-prog"><span class="rp-bar"><i style="width:' + Math.round(n.covered * 100 / Math.max(1, n.total)) + '%"></i></span>'
    + '<span class="rp-n tnum" id="rp-n">' + n.covered + ' of ' + n.total + ' games</span></div>';
}
function findingHtml(n) {
  var play = '<a class="btn-big" href="' + playHref(cfg.tcs[0]) + '">Play a game ↗</a>';
  if (SF.state === 'failed' && !n.ready) {
    return stateCard('Stockfish could not start in this browser.',
      'It runs on your device, and something blocked it: a content blocker, or an old browser.' + (isCC() ? '' : ' Games that lichess already analysed still work.'),
      '<a class="btn-big" data-act="engineRetry">Try again</a>');
  }
  var done = n.total && n.covered >= n.total && !n.working;
  if (done && !n.ready) {
    return n.total < 10
      ? stateCard('Only ' + plur(n.total, 'game') + ' so far.', 'Not enough to find much yet. Play a few more rated games and come back.', play)
      : stateCard('Clean games.', 'Stockfish found no big mistakes in your ' + n.total + ' games. That is rare. New games are checked when you come back.', play);
  }
  var can = n.ready ? todayPlan().keys.length : 0;
  if (done) {
    return stateCard(n.ready === 1 ? 'One mistake to learn from.' : n.ready + ' mistakes to learn from.',
      'Play a few more rated games and more will turn up.', (can ? '<a class="btn-big" data-act="startToday">Start with ' + can + '</a>' : '') + play.replace('btn-big', 'btn-quiet'));
  }
  if (n.ready) {
    return stateCard(n.ready + ' found so far', 'Start with ' + (n.ready === 1 ? 'this one' : 'these') + ' now, or wait a minute for more.',
      can ? '<a class="btn-big" data-act="startToday">Start with ' + can + '</a>' : '',
      '<div class="finds" id="finds">' + recentFindsHtml() + '</div>' + readBar(n));
  }
  return stateCard('Reading your games',
    'Stockfish checks your moves on your device, newest games first. Your first positions show up here as they are found.', '', readBar(n));
}
function focusHtml() {
  var f = currentFocus();
  if (!f) return '';
  var fam = FAMILIES.filter(function (x) { return x.key === f.fam; })[0];
  var agg = insightFamiliesQuick().filter(function (x) { return x.fam.key === f.fam; })[0];
  if (!fam || !agg) return '';
  /* the personal part is one level down: the family's top patterns */
  var top = patternStats().filter(function (s) { return fam.types.indexOf(s.key) !== -1 && s.count; })
    .sort(function (x, y) { return y.cost - x.cost || y.count - x.count; }).slice(0, 2)
    .map(function (s) { return patternInfo(s.key).plural.toLowerCase(); });
  var cost = agg.cost >= 1 ? 'Decided ' + fmtGames(agg.cost) + ' of yours' : plur(agg.count, 'position') + ' in your games';
  return '<div class="focus"><a class="focus-more" data-act="sheet" data-k="family:' + fam.key + '">Details ›</a>'
    + '<div class="kicker">Your focus</div>'
    + '<div class="focus-name">' + esc(fam.name) + '</div>'
    + '<p class="sec">' + cost + (top.length ? ', mostly ' + esc(top.join(' and ')) : '') + '.</p>'
    + '<div class="plan">' + esc(fam.habit) + '</div></div>';
}
/* a date outside the current year carries its year */
function gameDateLine(g) {
  try {
    var d = new Date(g.ts), o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-GB', o);
  } catch (e) { return ''; }
}
/* the ladder moving: how many positions went up, and when they come back */
function ladderHtml(ss, keys) {
  var srs = srsLoad(), now = Date.now(), days = [];
  keys.forEach(function (k) {
    var r = srs[k];
    if (ss.results[k] === 'first' && r && r.due) days.push(Math.max(1, Math.round((r.due - now) / DAY)));
  });
  if (!days.length) return '';
  var lo = Math.min.apply(null, days), hi = Math.max.apply(null, days);
  return '<p class="recap-ladder">' + (days.length === 1 ? 'One position' : days.length + ' positions') + ' moved up. Next in '
    + (lo === hi ? plur(lo, 'day') : lo + ' to ' + hi + ' days') + '.</p>';
}
/* one habit per screen: the drill's own family, the habit of the move that
   decided a drilled game, or the focus after a Today session */
function recapHabit(ss) {
  var sp = ss.spec || {}, fam = null;
  if (sp.type === 'family') fam = FAMILIES.filter(function (x) { return x.key === sp.fam; })[0];
  else if (sp.type === 'pattern') return patternInfo(sp.key).habit;
  else if (sp.type === 'game' || sp.type === 'one') {
    var m = model(), its = ss.keys.map(function (k) { return m.byKey[k]; }).filter(Boolean);
    var d = its.filter(function (it) { return it.b.d; })[0] || its[0];
    if (d) fam = familyOf(patternOf(d.b));
  }
  if (!fam) { var f = currentFocus(); fam = f && FAMILIES.filter(function (x) { return x.key === f.fam; })[0]; }
  return fam ? fam.habit : '';
}
function doneHtml(ss) {
  var solved = 0, answered = 0;
  var uniq = [];
  ss.keys.forEach(function (k) { if (uniq.indexOf(k) === -1) uniq.push(k); });
  var recap = uniq.map(function (k) {
    var it = model().byKey[k], r = ss.results[k], note = (ss.notes || {})[k];
    if (!it || !r || r === 'skip') return '';
    if (note !== 'left') { answered++; if (r !== 'fail') solved++; }
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    /* the result in words, never in colour alone */
    /* a close move then the answer shown: graded hint, noted shown */
    var word = note === 'left' ? 'Skipped' : note === 'close' || (note === 'shown' && r === 'hint') ? '◐ close' : r === 'first' ? '✓ first try' : r === 'retry' ? '✓ on the retry' : r === 'fail' ? 'Shown' : '✓ with help';
    var pm = uciToMove(pre, uciOfSan(it.g.mv, it.b.p));
    return '<div class="recap-item" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: k, label: 'One position' })) + '">'
      + boardSvg(pre, { flip: it.g.color === 'black', bad: pm ? [pm.from, pm.to] : null, decor: true }) + '<span>' + esc(patternInfo(patternOf(it.b)).name) + '</span>'
      + '<span class="res' + (r === 'fail' ? ' shown' : '') + '">' + word + '</span></div>';
  }).join('');
  var habit = recapHabit(ss);
  var more = morePracticeKeys().length;
  return '<div class="card-top recap-top">' + sessionBarHtml(ss, null) + '</div>'
    + '<div class="today recap-page">'
    + '<h2 class="done-big" id="recap-h" tabindex="-1">' + (answered ? solved + ' of ' + answered + ' solved.' : 'Done.') + '</h2>'
    + ladderHtml(ss, uniq)
    + '<div class="recap-week"><div class="kicker">This week</div>' + weekHtml() + '</div>'
    + '<p class="recap-next">' + nextDueHtml() + '</p>'
    + (habit ? '<div class="focus recap-habit"><div class="kicker">For your next game</div><div class="plan">' + esc(habit) + '</div></div>' : '')
    + (recap ? '<div class="recap">' + recap + '</div>' : '')
    + '<div class="acts-row recap-acts">'
      + '<a class="btn-big" href="' + playHref(cfg.tcs[0]) + '">Play a game ↗</a>'
      + (more ? '<a class="btn-line" data-act="keepGoing">Practise 5 more</a>' : '')
      + '<a class="btn-quiet" data-act="endSession">Back to Today</a>'
    + '</div></div>';
}

/* ── the card ────────────────────────────────────────────────────────────── */
/* the card's board as data: the position drawn (st), its last move, the
   bar's value from the player's side (ev), the marks for boardSvg (opts),
   whether the board takes moves (live), whether the bar waits (pending:
   grey and still on the card, live only while exploring), how long this
   frame's slide takes (slideMs: 220 for a move you made, 320 for one the
   app shows you, 0 when nothing slides), whether it is a jump to another
   position (fadeMs: a 150 ms crossfade) and whether something lands once
   the slide ends (land: a verdict's badge and tints, held back while the
   piece moves). It reads the card and writes nothing, so a test can check
   every frame (the spoiler rule) without a page; what drawing a frame
   remembers is kept by paintBoard */
function boardOptsFor(a) {
  var it = a.it, flip = it.g.color === 'black';
  var view, opts = { flip: flip }, evLive = false, slideMs = 0, land = false;
  if (a.phase === 'done' && a.explore) {
    var ex = a.explore, xn = xpCur(ex), xr = ex.res[xn.key], quiet = xpSpoil(xn);
    /* the bar follows the explored position, from the learner's side; it
       keeps its last value while Stockfish thinks */
    var ev = ex.lastEv;
    if (xr && xr.lines[0] && !quiet) { ev = myPov(it) ? xr.lines[0].cp : -xr.lines[0].cp; evLive = true; }
    view = { st: ex.st, last: ex.last, ev: ev != null ? ev : frameView(a).ev };
    opts.sel = ex.sel;
    /* one arrow: Stockfish's move, or the row under the pointer */
    var xs = xpShown(ex, xn), hl = xs && !quiet && xs[ex.hot || 0] ? uciToMove(ex.st, xs[ex.hot || 0].pv[0]) : null;
    if (hl) opts.ghost = [hl.from, hl.to];
    if (ex.anim) { opts.anim = ex.anim; slideMs = 220; }
    if (ex.sel >= 0) opts.dots = legalMoves(ex.st).filter(function (m) { return m.from === ex.sel; }).map(function (m) { return m.to; });
  } else if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    /* a story step (S12): its ply slides in as a move the app shows (320
       ms) and what it brings lands with it (storyMarks). A segment's first
       step keeps its arrow as the trail: the red game move on G1, the green
       better move on B1; while it crossfades in (pre) the arrow is drawn on
       the position the segment starts from */
    view = frameView(a);
    var S = buildStory(a), sp = S.steps[a.view.i], sn = sp.line.nodes[sp.k];
    if (sp.k === (sp.seg === 'game' ? 0 : sp.from)) {
      if (sp.seg === 'game') opts.bad = [sn.move.from, sn.move.to];
      else opts.arrows = [{ from: sn.move.from, to: sn.move.to, kind: 'better', key: 'better' }];
    }
    if (!a.view.pre) {
      if (sameMove(a.animMove, view.last)) { opts.anim = a.animMove; slideMs = 320; }
      var sm = storyMarks(a, S, a.view.i);
      if (Object.keys(sm).length) {
        if (opts.anim) land = true;
        else { opts.fx = a.key + ':st' + a.view.i; for (var smk in sm) opts[smk] = (opts[smk] || []).concat(sm[smk]); }
      }
    }
  } else if (a.phase === 'done' && a.view && a.view.mode) {
    /* S0 and the answer shown (S6, S7): the card's own board as play left
       it. The move just made slides in (220 ms as you made it; 320 when Play
       it shows it; a forcing reply as it does in the line) and its verdict
       lands with it: a filled tick for a solve, the grey i for an answer
       played. The answer shown is its green arrow until it is played; in a
       forcing line the next one lands with their reply. Once settled, S0's
       marks (s0Marks) */
    view = frameView(a);
    if (sameMove(a.animMove, view.last)) { opts.anim = a.animMove; slideMs = a.animShown ? 320 : 220; }
    var mm = a.markMove, sdue = showDue(a), sl = {}, sfx = null;
    if (mm && sameMove([mm.from, mm.to], view.last)) {
      sfx = a.key + ':' + (a.fxn || 0) + mm.kind;
      sl.tints = [{ sq: mm.from, kind: mm.kind }, { sq: mm.to, kind: mm.kind }];
      sl.badges = [{ sq: mm.to, kind: mm.kind, fx: sfx }];
    }
    if (sdue) sl.arrows = [{ from: sdue.from, to: sdue.to, kind: 'better', key: 'answer' }];
    if (sl.tints || sl.arrows) {
      if (opts.anim) land = true;
      else { opts.fx = sfx; for (var sk in sl) opts[sk] = sl[sk]; }
    }
    if (sdue) {
      opts.sel = a.sel;
      if (a.sel === sdue.from) opts.dots = [sdue.to];
    }
    if (a.view.mode === 's0' && a.settle >= 1 && !opts.anim) {
      /* the ghost and the tokens fade in once, as this beat's effect */
      var s0 = s0Marks(a, view.st);
      ['ghosts', 'rings', 'arrows', 'tokens'].forEach(function (k) { if (s0[k].length) opts[k] = (opts[k] || []).concat(s0[k]); });
      if (s0.ghosts.length || s0.tokens.length) opts.fx = a.key + ':s0';
      /* the threat arrow into the square of the tick: the badge yields its corner */
      var s0t = s0.arrows[0];
      if (s0t && opts.badges && s0t.to === opts.badges[0].sq) {
        var s0c = badgeCorner(s0t.from, s0t.to, flip);
        if (s0c[0] !== 36 || s0c[1] !== 9) opts.badges = [{ sq: opts.badges[0].sq, kind: opts.badges[0].kind, fx: opts.badges[0].fx, at: s0c }];
      }
    }
  } else if (a.phase === 'done') {
    /* an answered card always shows one of the frames above; a line view
       only stands while exploring starts from it */
    view = frameView(a);
  } else {
    var st = a.st, last = a.phase === 'checking' ? a.ghostMove : a.lastMove;
    if (a.phase === 'checking' && a.ghostMove) st = checkingFrame(a);
    else if (a.phase === 'tried') {
      /* the try stays drawn over the position before it */
      var tf = triedFrame(a);
      st = tf.st; last = tf.last;
    }
    view = { st: st, last: last, ev: it.b.eb };
    opts.sel = a.sel;
    if (a.phase === 'guess' && a.sel >= 0) opts.dots = legalMoves(a.st).filter(function (m) { return m.from === a.sel; }).map(function (m) { return m.to; });
    opts.shapes = a.shapes;
    if (a.phase === 'guess' && a.solIdx === 0 && !a.explore) opts.bad = [a.played.from, a.played.to];
    /* your move slides as you make it; their reply, once See it plays it,
       slides as a move the app shows */
    if (sameMove(a.animMove, view.last)) { opts.anim = a.animMove; slideMs = a.phase === 'tried' && a.tried.seen ? 320 : 220; }
    /* the move just made, on its squares: checking (a grey dots badge), a
       miss (a red cross), a good move that is not the best (a hollow ring
       with a tick) or one not checked (a question mark); once See it plays
       their reply, the piece it took, as a token where it landed (never on
       the answer's square, 2.3). It lands with the piece: a frame that
       slides it draws it once the slide ends */
    var t = a.tried, due = dueMove(a), vk = null, vm = null, fx = null, lands = null;
    if (a.phase === 'checking' && a.ghostMove) { vk = 'checking'; vm = a.ghostMove; }
    else if (a.phase === 'tried' && !t.seen) { vk = t.kind === 'miss' ? 'bad' : t.kind; vm = [t.from, t.to]; }
    if (vk) {
      fx = a.key + ':' + (a.fxn || 0) + vk;
      lands = { tints: [{ sq: vm[0], kind: vk }, { sq: vm[1], kind: vk }], badges: [{ sq: vm[1], kind: vk, fx: fx }] };
      /* the reason's arrow will point at the piece just moved (their reply
         takes it): the badge yields its corner when the arrow's head would
         run under it, from the start, so it never hops (2.1) */
      var tt = vk === 'bad' ? t.threat : null;
      if (tt && tt.to === vm[1] && tt.from !== due.to && tt.to !== due.to) {
        var at = badgeCorner(tt.from, tt.to, flip);
        if (at[0] !== 36 || at[1] !== 9) lands.badges[0].at = at;
      }
    } else if (a.phase === 'tried' && t.seen && t.lost && t.lost.sq !== due.to) {
      fx = a.key + ':' + (a.fxn || 0) + 'lost';
      lands = { tokens: [{ sq: t.lost.sq, p: t.lost.p, kind: 'lost', fx: fx }] };
    }
    if (lands && opts.anim) land = true;
    else if (lands) { opts.fx = fx; for (var lk in lands) opts[lk] = lands[lk]; }
    /* a miss explains itself (S4), once its verdict has been read
       (a.reason): the piece that punishes it ringed, a dashed arrow to what
       it takes; when See it plays that move they stay while it slides and
       go as it lands (marks wait for the piece), if they were drawn before
       See it was pressed (t.ringed): marks never first appear on a slide.
       Never on the answer's square (2.3): an attacker standing there draws
       nothing, a target there keeps the ring alone */
    var th = a.phase === 'tried' && a.reason >= 1 && (!t.seen || (opts.anim && t.ringed)) ? t.threat : null;
    if (th && th.from !== due.to) {
      opts.rings = [{ sq: th.from, kind: 'threat' }];
      if (th.to !== due.to) opts.arrows = [{ from: th.from, to: th.to, kind: 'threat', key: 'threat' }];
      if (t.seen) land = true;
    }
    /* the card asking again: the wrong move tried last at this step, faint,
       once the crossfade back has ended (clearTry) */
    var tm = a.phase === 'guess' && !a.triedHold ? triedMark(a) : null;
    if (tm) { opts.tried = [tm]; opts.fx = tm.fx; }
    /* a hint's marks (S8), while the card asks; after Try again they land
       with the tried line, once the crossfade is over */
    if (a.phase === 'guess' && !a.triedHold) {
      var hm = hintMarks(a);
      if (hm.rings.length) opts.rings = (opts.rings || []).concat(hm.rings);
      if (hm.arrows.length) opts.arrows = (opts.arrows || []).concat(hm.arrows);
    }
  }
  /* "not a move here": the grey outline on a square just tapped */
  if (a.nope && a.nope.key === cardStateKey(a)) opts.rings = (opts.rings || []).concat([{ sq: a.nope.sq, kind: 'nope' }]);
  if (slideMs === 320) opts.animMs = 320;
  /* the last-move tint marks a move that has landed: a piece sliding in
     with a verdict to come gets no tint until the verdict's own, so its
     squares change colour once */
  opts.mark = land ? null : view.last;
  /* the board's name says what it draws: the game move only with its red
     arrow (mid-line its name can be the answer due now) */
  opts.label = (view.st.w ? 'White' : 'Black') + ' to move.' + (opts.bad ? ' You played ' + sanOf(a.pre, a.played) + ' in the game.' : '');
  /* a check given by a piece still sliding glows once it lands, with the
     rest of what lands */
  var ck = checkedKingSq(view.st);
  if (ck != null && !land) opts.check = ck;
  return {
    st: view.st, last: view.last, ev: view.ev, evLive: evLive, opts: opts, slideMs: slideMs, land: land,
    fadeMs: a.jump && !slideMs ? XFADE : 0,
    live: a.phase === 'guess' || a.phase === 'tried' || !!(a.phase === 'done' && (a.explore || (!a.showWait && showDue(a)))),
    /* the bar fills only while exploring: a tall bar during the guess would
       say "you are winning, find it", and a moving one is motion nobody
       asked for */
    pending: !(a.phase === 'done' && a.explore) || !!xpSpoil(xpCur(a.explore))
  };
}
/* the corner of square to that the verdict badge takes, as [x, y] from
   the square's corner: the top-right (36, 9) of 2.1, unless an arrow from
   square from would run its head under the disc there, then the first
   corner clear of it (top-left, bottom-right, bottom-left). The head as
   markArrow draws it: its tip 6.3 units past the line's end (inset 0.34 of
   a square, 0.22 under 1.6 squares), 21 long and 21 wide at its base, then
   the shaft with its halo (7.4 wide) */
function badgeCorner(from, to, flip) {
  var xy = function (sq) { return [(flip ? 7 - sq % 8 : sq % 8) * 45 + 22.5, (flip ? sq >> 3 : 7 - (sq >> 3)) * 45 + 22.5]; };
  var p = xy(from), q = xy(to), dx = p[0] - q[0], dy = p[1] - q[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / len, uy = dy / len, tip = 45 * (len < 45 * 1.6 ? 0.22 : 0.34) - 6.3;
  var spots = [[36, 9], [9, 9], [36, 36], [9, 36]];
  for (var i = 0; i < spots.length; i++) {
    var bx = spots[i][0] - 22.5, by = spots[i][1] - 22.5, clear = true;
    for (var s = 0; s <= 40 && clear; s++) {
      var px = ux * (tip + s) - bx, py = uy * (tip + s) - by, half = s < 21 ? 10.5 * s / 21 : 3.7;
      if (Math.sqrt(px * px + py * py) < 8.6 + half) clear = false;
    }
    if (clear) return spots[i];
  }
  return spots[0];
}
/* S0's marks (S6, V+700) on the settled board st: the game move's ghost
   with its cross, where it went (on a forcing line only when that square is
   empty, and never on the square of the tick, whose badge it would meet);
   the threat it ran into, the game line's first reply ringed with its dashed
   arrow, when that reply captures or checks, its piece still stands there
   and the card is not a missed chance; after a forcing line, green tokens on
   what you won (at most two) */
function s0Marks(a, st) {
  var out = { ghosts: [], rings: [], arrows: [], tokens: [] }, c = a.cls, pl = a.played, mm = a.markMove;
  var line = !!(a.sol && a.solIdx > 1);
  if (pl && !(mm && mm.to === pl.to) && (!line || !st.b[pl.to]))
    out.ghosts.push({ sq: pl.to, p: a.pre.b[pl.from], fx: a.key + ':s0' });
  var th = familyOf(patternOf(a.it.b)).key !== 'chances' ? threatOf(c.gameLine, 1) : null;
  if (th && st.b[th.from] && st.b[th.from] === c.gameLine.nodes[1].before.b[th.from]) {
    out.rings.push({ sq: th.from, kind: 'threat' });
    out.arrows.push({ from: th.from, to: th.to, kind: 'threat', key: 'threat' });
  }
  if (line) (a.won || []).slice(-2).forEach(function (w) { out.tokens.push({ sq: w.sq, p: w.p, kind: 'won', fx: a.key + ':s0' }); });
  return out;
}
/* what lands with a story step (S12, 2.1): a capture's token, red when it
   took a piece of yours, green when yours took one; on G1 the reply it
   allows (S.threat), ringed with its dashed arrow; on B1 the better move's
   badge and tints (the tick; the grey i when the answer was shown, since
   the tick says you found it), then the guard dots when the guard rule
   holds, else the game move's ghost with its cross, never both */
function storyMarks(a, S, i) {
  var s = S.steps[i], n = s.line.nodes[s.k], out = {}, fx = a.key + ':st' + i;
  /* on the square the piece was taken from (en passant: beside the arrival) */
  if (n.captured) out.tokens = [{ sq: n.move.ep >= 0 ? n.move.ep : n.move.to, p: n.captured, kind: colorW(n.captured) === myPov(a.it) ? 'lost' : 'won', fx: fx }];
  if (s.seg === 'game' && s.k === 0 && S.threat) {
    out.rings = [{ sq: S.threat.from, kind: 'threat' }];
    out.arrows = [{ from: S.threat.from, to: S.threat.to, kind: 'threat', key: 'threat' }];
  }
  if (s.seg === 'better' && s.k === s.from) {
    var bk = a.revealed ? 'info' : 'good';
    out.tints = [{ sq: n.move.from, kind: bk }, { sq: n.move.to, kind: bk }];
    out.badges = [{ sq: n.move.to, kind: bk, fx: fx }];
    if (S.guard) out.guards = [{ from: S.guard.from, to: S.guard.to }];
    else if (s.from === 1 && a.played.to !== n.move.to) out.ghosts = [{ sq: a.played.to, p: a.pre.b[a.played.from], fx: fx }];
  }
  return out;
}
/* the board beat: the board svg and the marks over it, and the bar beside
   them. A frame that slides a piece sets motionUntil, so nothing else is
   written until the piece lands, and holds back what lands with it (the
   land beat draws it); a jump to another position crossfades and sets
   motionUntil too. instant (an input flushed the beat) draws the frame as
   it ends: no slide, no crossfade, the verdict on its square */
function paintBoard(a, instant) {
  var it = a.it, bw = el('bwrap');
  if (!bw) return;
  /* under reduced motion every slide and fade takes 0 ms: the piece is
     drawn where it lands */
  var still = instant || reducedMotion();
  if (still) a.animMove = null;
  var f = boardOptsFor(a);
  if (still) { f.opts.anim = null; f.slideMs = 0; f.fadeMs = 0; }
  /* a new board ends the forcing reply's hold (flushStage) */
  motionHold = false;
  /* what drawing this frame remembers: the bar's last live value and a
     slide already shown while exploring, the line frame on screen after */
  if (a.phase === 'done' && a.explore) {
    if (f.evLive) a.explore.lastEv = f.ev;
    a.explore.anim = null;
  } else if (a.phase === 'done') a.lastView = { line: a.view.line, idx: a.view.idx, mode: a.view.mode };
  var fade = f.fadeMs ? xfadeHtml(bw.innerHTML) : '';
  /* the position this card last drew, to tell a board change from a
     repaint of the same position (a selection, a mark, a verdict on a move
     already drawn); a card's first board is no change */
  var pos = stateFen(f.st), moved = a.drawnPos != null && a.drawnPos !== pos;
  a.drawnPos = pos;
  bw.innerHTML = boardSvg(f.st, f.opts) + (a.pendingPromo ? promoHtml(f.st) : '') + fade;
  bw.classList.toggle('static', !f.live);
  var ms = f.slideMs || 0;
  releaseAnims(bw, ms);
  a.animMove = null;
  a.jump = false;
  /* the badge and tints wait for the piece (the land beat), and the
     verdict's sound comes with them; a move the app shows sounds as it
     starts */
  a.landing = !!(ms && f.land);
  if (!ms && a.cue) { snd(a.cue); a.cue = null; }
  if (a.moveCue) { snd('move'); a.moveCue = false; }
  /* a jump: the old words fade out with the old board (text out, 2.2), and
     the new ones come with the text beat */
  if (fade) fadeOut(a);
  /* the bar: the player's view of the position, with no pawn number; still
     while it waits */
  var eb = el('ebar'), fill = el('ebar-fill');
  if (eb) eb.classList.toggle('pending', f.pending);
  if (fill && !f.pending) fill.style.height = winPct(evalWhite(it, f.ev != null ? f.ev : it.b.eb)) + '%';
  /* the slide starts two frames from now (releaseAnims), and ends ms later;
     the old board's fade-out starts now */
  if (ms) motionUntil = Date.now() + SLIDE_LEAD + ms;
  else if (fade) {
    motionUntil = Date.now() + f.fadeMs;
    var xf = bw.querySelector('.xfade');
    if (xf) setTimeout(function () { if (xf.parentNode) xf.parentNode.removeChild(xf); }, f.fadeMs + 50);
  } else if (moved && !(a.phase === 'done' && a.explore)) {
    /* a move drawn where it landed (dragged, or under reduced motion) is a
       board change too: the words follow 150 ms after it, never with it
       (principles 1 and 2). Exploring repaints both together (S14) */
    motionUntil = Math.max(motionUntil, Date.now());
  }
  /* the forcing reply's slide (stepLine marks it): input never cuts it
     short, it is swallowed until the piece lands (S10) */
  if (a.replySlide) { motionHold = !!ms; a.replySlide = false; }
}
/* a jump to another position (Try again, Take back, Keep looking) lays the
   old board over the new one and fades it out in 150 ms, so the change
   reads as one. The copy is a picture: no square or piece in it answers a
   query or a tap, and none of its pieces slides */
var XFADE = 150;
function xfadeHtml(html) {
  var i = html.indexOf('</svg>'), j = i < 0 ? -1 : html.indexOf('</svg>', i + 6);
  if (j < 0) return '';
  var old = html.slice(0, j + 6).replace(/ data-sq="\d+"/g, '').replace(/ class="anim-piece"/g, '')
    .replace('<svg class="board"', '<svg class="xf-board"').replace('<svg class="marks"', '<svg class="xf-marks"').replace(/ role="img" aria-label="[^"]*"/, '');
  return '<div class="xfade" aria-hidden="true">' + old + '</div>';
}
/* text out (2.2): the words about to change fade out in 100 ms, before a
   move the app shows (the fade beat) or with a jump's crossfade: the band
   when its words change, and each bar button whose label or action
   changes (the whole bar when its slots change in number). Words that
   stay, stay. Faded buttons take no tap; the text beat writes the new
   words and takes the fade off */
function fadeOut(a) {
  var d = displayFor(a), band = el('cband'), bar = el('cbar'), strip = el('cstrip'), n = 0;
  if (band && band.nlHtml != null && band.nlHtml !== bandHtml(a, d)) band.classList.add('stale');
  /* the strip too when its words change (S0's Details giving way to the
     story's names); the story's dots and count follow the step quietly */
  if (strip && strip.nlHtml != null && stripWordsOf(strip.nlHtml) !== stripWordsOf(d.strip)) strip.classList.add('stale');
  if (!bar || bar.nlHtml == null) return;
  for (var i = 0; i < slotSig.length; i++) if (slotSig[i] != null) n++;
  if (n !== d.buttons.length) { bar.classList.add('stale'); for (var h = 0; h < Math.max(n, d.buttons.length); h++) hideSlot(h); return; }
  d.buttons.forEach(function (s, j) {
    var b = slotSigOf(s) !== slotSig[j] ? bar.querySelector('[data-slot="' + j + '"]') : null;
    if (b) { b.classList.add('stale'); hideSlot(j); }
  });
}
function stripWordsOf(h) { return String(h || '').replace(/<i class="st-dot[^"]*"><\/i>|<span class="st-count">[^<]*<\/span>/g, '').replace(/ on"/g, '"'); }
/* the marks beat: only the marks svg is rewritten, so no piece is touched */
function paintMarks(a) {
  var bw = el('bwrap'), old = bw && bw.querySelector('.marks');
  if (!old) return;
  var f = boardOptsFor(a);
  f.opts.anim = null;
  var html = boardSvg(f.st, f.opts);
  old.outerHTML = html.slice(html.indexOf('</svg>') + 6);
}
/* the board alone, staged: a selection, a drawn shape, a row pointed at
   while exploring. The words stay as they are */
function renderCardBoard() { stage(['board']); }
/* the card: its frame once, then the board and the words as staged beats
   (14s-stage.js), the words after any slide; beats, when a change needs
   its own order (See it fades its words out before the reply slides) */
function renderCard(beats) {
  var box = el('trainbox'), ss = ui.session;
  if (!box || !ss) return;
  if (ss.finished) { stageReset(); renderTrain(); return; }
  var a = ss.active;
  if (!a) {
    stageReset();
    box.dataset.card = '';
    box.innerHTML = '<div class="card"><div class="card-top">' + sessionBarHtml(ss, null) + '</div>'
      + '<div class="panel"><div class="checking"><span class="meter"><i></i></span>Taking a closer look at this position…</div></div></div>';
    return;
  }
  var flip = a.it.g.color === 'black';
  if (box.dataset.card !== a.key) {
    stageReset();
    box.dataset.card = a.key;
    box.innerHTML = '<div class="card">'
      + '<div class="card-top" id="ctop"></div>'
      + '<div class="band-slot" id="cband"></div>'
      + '<div class="board-col"><div class="board-row">'
        + '<div class="evalbar pending' + (flip ? ' flip' : '') + '" id="ebar"><i class="evalbar-fill" id="ebar-fill"></i><span class="evalbar-label" id="ebar-lab"></span></div>'
        + '<div class="board-wrap" id="bwrap"></div>'
      + '</div></div>'
      + '<div class="panel" id="cpanel"><div class="strip" id="cstrip"></div><div class="acts-row sticky-acts" id="cbar"></div></div>'
      + '</div>';
  }
  stage(beats || ['board', 'land', 'text']);
}
/* what the card says and offers, as data: the band (bandFor: disc, kind,
   row1, row2, chip, cap), forcing pips (a later slice), the action bar as
   slots, the strip's markup and the live region's words */
function displayFor(a) {
  var b = bandFor(a), ss = ui.session;
  return { disc: b.disc || null, kind: b.kind || 'neutral', row1: b.row1 || '', row2: b.row2 || '', cap: b.cap || '', chip: b.chip || '', sweep: !!b.sweep, pips: null,
           buttons: barSlots(a, ss), strip: stripHtml(a, ss), live: liveWords(a, b) };
}
/* a node's markup, written only when it changed, so a repaint that changes
   nothing writes nothing (and keeps focus and a running fade) */
function setHtml(node, html) {
  if (!node || node.nlHtml === html) return false;
  node.innerHTML = html;
  node.nlHtml = html;
  return true;
}
/* the text beat: the session bar, the band, the action bar, the strip and
   the live region, with keyboard focus kept on the same control */
function paintText(a) {
  var ss = ui.session, band = el('cband');
  if (!band) return;
  var d = displayFor(a), newCard = !a.shown;
  a.shown = true;
  var foc = document.activeElement, fp = el('cpanel'), bar = el('cbar');
  var inCard = foc && ((fp && fp.contains(foc)) || band.contains(foc));
  var focKey = inCard ? (foc.id || ((foc.getAttribute('data-act') || '') + '|' + (foc.getAttribute('data-k') || ''))) : null;
  /* a button of the bar is kept by its place: the bar repaints under it */
  var focSlot = inCard && bar && bar.contains(foc) ? foc.getAttribute('data-slot') : null;
  /* an answered card's bar changing under a focus in it (or on nothing):
     the slot's meaning changed, so the keyboard goes where Enter goes */
  var sig = d.buttons.map(slotSigOf).join('/'), barMoved = a.phase === 'done' && a.barSig != null && a.barSig !== sig;
  a.barSig = a.phase === 'done' ? sig : null;
  var lost = !foc || foc === document.body || focSlot != null;
  paintTop(a, ss);
  paintBand(a, d);
  paintBar(d);
  paintStrip(d);
  /* the new words are in: whatever faded out for them (fadeOut) is back */
  if (band.classList) band.classList.remove('stale');
  var sp = el('cstrip');
  if (sp && sp.classList) sp.classList.remove('stale');
  if (bar && bar.classList) { bar.classList.remove('stale'); [].forEach.call(bar.querySelectorAll('.stale'), function (b) { b.classList.remove('stale'); }); }
  var box = el('trainbox'), cardEl = box && box.querySelector('.card'), xe = a.phase === 'done' && a.explore;
  if (cardEl) cardEl.classList.toggle('xp-card', !!xe);
  if (xe) fitRows();
  makeFocusable(fp);
  if (newCard) { var th = el('task-h'); if (th) th.focus({ preventScroll: true }); }
  else if (a.phase === 'done' && !a.focusedResult) {
    /* an answer hands the keyboard to the right-hand button (S6, S20):
       Continue once solved, Play it when the answer is shown */
    a.focusedResult = true;
    var rh = barButton(rightSlot()) || el('result-h');
    if (rh) rh.focus({ preventScroll: true });
  }
  else if (barMoved && !xe && lost && doneFocus(a)) doneFocus(a).focus({ preventScroll: true });
  else if (a.focusRight && a.phase === 'tried' && barButton(rightSlot())) { a.focusRight = false; barButton(rightSlot()).focus({ preventScroll: true }); }
  else if (focKey && fp) {
    /* a bar button: the one now in its slot, or the right-hand one (S20)
       when that slot is off or gone */
    var back = focSlot != null ? barButton(focSlot) || barButton(rightSlot())
      : focKey.indexOf('|') < 0 ? el(focKey) : fp.querySelector('[data-act="' + focKey.split('|')[0] + '"]' + (focKey.split('|')[1] ? '[data-k="' + focKey.split('|')[1] + '"]' : ''));
    /* the band's head is the task before an answer and the result after */
    if (!back && /^(task|result)-h$/.test(focKey)) back = el('task-h') || el('result-h');
    if (!back && /^xpRow\|/.test(focKey)) { var rws = fp.querySelectorAll('#xp [data-act="xpRow"]'); back = rws[rws.length - 1] || null; }
    if (xe && xe.wantRow != null && (!back || back.id === 'xp' || back.classList.contains('xp-mv'))) {
      var wr = fp.querySelector('#xp [data-act="xpRow"][data-k="' + xe.wantRow + '"]');
      if (wr) { back = wr; xe.wantRow = null; }
    }
    /* never the typed-move box, which would pop up a phone's keyboard: a
       control that went falls back to the bar's right-hand button */
    (back || (xe ? (fp.querySelector('#xp .xp-mv.on') || el('xp')) : barButton(rightSlot()) || (bar && bar.querySelector('[data-act]'))) || el('task-h') || el('result-h') || fp).focus({ preventScroll: true });
  }
  paintLive(d);
  /* a miss's verdict is on screen now: its reason's beats run from here;
     so do a settled result's (S0) */
  if (a.reasonFor && a.reasonFor === a.tried && a.phase === 'tried') missReason(a);
  if (a.settleFor && a.phase === 'done' && a.view && a.view.mode === 's0') settleBeats(a);
}
/* where the keyboard goes when an answered card's bar changes (S7, S15,
   S20): the right-hand button, the one Enter presses (Play it while the
   answer is shown, Continue once settled), and while it is switched off
   (Play it, while their reply plays) that slot itself, so focus never falls
   to the page or to a slot whose meaning changes under it; the story keeps
   it on Next move › until the last step, then on Continue */
function doneFocus(a) {
  var bar = el('cbar');
  if (!bar) return null;
  var fwd = a.view.mode === 'story' && barButton(1);
  if (fwd && fwd.getAttribute('data-act') === 'storyFwd') return fwd;
  return barButton(rightSlot()) || bar.querySelector('[data-slot="' + rightSlot() + '"]');
}
/* the bar's button in slot i, if it holds an action now (an off slot has none) */
function barButton(i) {
  var bar = el('cbar');
  return bar && i != null && i >= 0 ? bar.querySelector('[data-slot="' + i + '"][data-act]') : null;
}
/* the session bar: a focused control in it keeps focus across the repaint */
function paintTop(a, ss) {
  var ct = el('ctop');
  if (!ct) return;
  var html = sessionBarHtml(ss, a);
  if (ct.nlHtml === html) return;
  var tIdx = [].indexOf.call(ct.querySelectorAll('[data-act], a[href]'), document.activeElement);
  setHtml(ct, html);
  makeFocusable(ct);
  if (tIdx !== -1) { var tb = ct.querySelectorAll('[data-act], a[href]')[tIdx]; if (tb) tb.focus({ preventScroll: true }); }
}
/* the band, the strip: each written only when its words changed */
function paintBand(a, d) { setHtml(el('cband'), bandHtml(a, d)); }
function paintStrip(d) {
  ui.repainting = true;
  try { setHtml(el('cstrip'), d.strip); } finally { ui.repainting = false; }
}
/* the action bar: its slots, noted for the double-tap guard as painted */
function paintBar(d) {
  var bar = el('cbar');
  if (!bar) return;
  noteSlots(d.buttons);
  var cls = 'acts-row sticky-acts ' + (d.buttons.length === 3 ? 'done-acts' : 'guess-acts');
  if (bar.className !== cls) bar.className = cls;
  ui.repainting = true;
  try { setHtml(bar, barHtml(d.buttons)); } finally { ui.repainting = false; }
}
/* the live region repeats the band for screen readers, once per change */
function paintLive(d) {
  var live = el('sr-live');
  if (!live) { live = document.createElement('div'); live.id = 'sr-live'; live.className = 'sr-live'; live.setAttribute('aria-live', 'polite'); live.setAttribute('data-clarity-mask', 'true'); document.body.appendChild(live); }
  if (live.textContent !== d.live) live.textContent = d.live;
}
/* the band (FINAL-SPEC 2.0): the fixed box above the board. A disc, then
   row 1 (the heading the card focuses: the task before an answer, the
   result after) with the relearn chip at its right, then row 2; or one
   caption while exploring */
function bandHtml(a, d) {
  /* a story step keeps the card's verdict disc beside its caption; the
     explorer's sentence stands alone (the live region says it) */
  if (d.cap && d.disc) return '<div class="card-task k-' + d.kind + ' cap">' + discHtml(a, d.disc) + '<p class="bd-cap">' + esc(d.cap) + '</p></div>';
  if (d.cap) return '<div class="card-task k-' + d.kind + ' cap" aria-hidden="true"><p class="bd-cap">' + esc(d.cap) + '</p></div>';
  return '<div class="card-task k-' + d.kind + (d.sweep ? ' sweep' : '') + '">' + discHtml(a, d.disc)
    + '<div class="bd-rows"><div class="bd-top"><h2 class="bd-r1" id="' + (a.phase === 'done' ? 'result-h' : 'task-h') + '" tabindex="-1">' + esc(d.row1) + '</h2>'
    + (d.chip ? '<span class="bd-chip">' + esc(d.chip) + '</span>' : '') + '</div>'
    + '<p class="bd-r2">' + esc(d.row2) + '</p></div></div>';
}
/* the band's disc: a king in the solver's colour while it is your move,
   else the verdict's glyph, drawn as the board's badges are (the close
   one hollow) */
function discHtml(a, kind) {
  if (!kind) return '';
  if (kind === 'king') return '<span class="bd-disc d-king" aria-hidden="true"><svg viewBox="0 0 45 45"><use href="#pc-' + (myPov(a.it) ? 'wK' : 'bK') + '"/></svg></span>';
  var col = MARK_BADGE[kind] || MARK_BADGE.info, hollow = kind === 'close';
  return '<span class="bd-disc d-' + kind + '" aria-hidden="true"><svg viewBox="-10 -10 20 20">'
    + '<circle r="' + (hollow ? 8.9 : 10) + '" fill="' + (hollow ? '#161512' : col) + '"' + (hollow ? ' stroke="' + col + '" stroke-width="2.2"' : '') + '/>'
    + '<path d="' + (BADGE_GLYPH[kind] || BADGE_GLYPH.info) + '" fill="none" stroke="' + (hollow ? col : '#fff') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
}
/* what the live region says: the band, led by its verdict in words, or the
   exploration's own line */
function liveWords(a, b) {
  if (a.phase === 'done' && a.explore) return xpLive(a, a.explore, a.explore.at);
  /* a story step says where it is first (S20): "Step 2 of 3, your game." */
  if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    var S = buildStory(a), i = a.view.i;
    return 'Step ' + (i + 1) + ' of ' + S.steps.length + ', ' + (i < S.g ? 'your game.' : S.alt ? 'your move.' : 'the better move.') + ' ' + b.cap;
  }
  return [LIVE_PREFIX[b.disc] || '', b.row1 || '', b.row2 || ''].filter(Boolean).join(' ');
}
/* the action bar as slots, left to right: {act, k, label, cls, off, aria}.
   Answered: See why and Continue (S0), Continue and Play it (the answer
   shown), back, forward and Continue (See why's lines, exploring); a try
   on the board: help, Try again;
   guessing: Hint, Show the answer, both outlined, and Hint for everyone
   until it has nothing left to give; a move being checked: Take back and
   the answer switched off; a reply playing: Hint and the answer switched
   off, so the bar keeps its place */
function barSlots(a, ss) {
  if (a.phase === 'done') {
    var last = ss.idx + 1 >= ss.keys.length && !(ss.relearn && ss.relearn.length);
    var cont = { act: 'next', label: last ? 'Finish' : 'Continue', cls: 'btn-big' };
    /* exploring: back, forward along its trail (exploreStep), Continue */
    if (a.explore) {
      var xe = a.explore, xn = xpCur(xe), xr = xe.res[xn.key];
      var fwdOff = !(xe.at < xe.nodes.length - 1 || (xr && xr.lines[0] && !xpSpoil(xn) && !xpGameOver(xn.st)));
      return [{ act: 'xpBack', label: '‹', cls: 'nav-btn', aria: xe.at === 0 ? 'Back to the lesson' : 'Back one move' },
              { act: 'xpFwd', label: '›', cls: 'nav-btn' + (fwdOff ? ' nav-off' : ''), aria: xe.at >= xe.nodes.length - 1 ? 'Play Stockfish\'s pick' : 'Forward one move' }, cont];
    }
    /* the story (S12): ‹, Next move › in gold until the last step, where it
       is switched off (outlined, greyed) and Continue turns gold */
    if (a.view.mode === 'story') {
      var sn = buildStory(a).steps.length, si = a.view.i, end = si >= sn - 1;
      return [{ act: 'storyBack', label: '‹', cls: 'nav-btn', aria: 'Previous move' },
              { act: 'storyFwd', label: 'Next move ›', cls: end ? 'btn-line' : 'btn-big', off: end, aria: end ? null : 'Next move, step ' + (si + 2) + ' of ' + sn },
              { act: 'next', label: cont.label, cls: end ? 'btn-big' : 'btn-line' }];
    }
    /* the answer shown (S7): Continue, and Play it in gold; switched off
       while their reply plays, and once played until the card settles */
    if (a.view.mode === 'show' || (a.revealed && a.settle < 2))
      return [{ act: 'next', label: cont.label, cls: 'btn-line' }, { act: 'playIt', label: 'Play it ›', cls: 'btn-big', off: a.showWait || !showDue(a) }];
    /* settled (S0): the story, and Continue in gold */
    return [{ act: 'seeWhy', label: 'See why ›', cls: 'btn-line' }, cont];
  }
  if (a.phase === 'tried') return triedSlots(a);
  /* a move being checked keeps the guess bar until the band says so (K1,
     300 ms after it lands), so a quick answer changes the bar once: Hint
     and Show the answer do nothing meanwhile, Esc or a tap on the moved
     piece still takes it back */
  if (a.phase === 'guess' || (a.phase === 'checking' && !a.checkSaid)) {
    /* Hint is named by the hint it gives next, and switched off when it
       has nothing left to give */
    return [{ act: 'hint', label: a.hints >= 2 ? 'No more hints' : (a.hints ? 'Hint 2' : 'Hint'), cls: 'btn-line', off: a.hints >= 2 },
            { act: 'reveal', label: 'Show the answer', cls: 'btn-line' }];
  }
  if (a.phase === 'checking') return [{ act: 'takeBack', label: 'Take back', cls: 'btn-line' }, { act: 'reveal', label: 'Show the answer', cls: 'btn-line', off: true }];
  return [{ act: 'hint', label: 'Hint', cls: 'btn-line', off: true }, { act: 'reveal', label: 'Show the answer', cls: 'btn-line', off: true }];
}
/* the bar while a try is on the board: the gold right-hand button takes it
   back (Try again; Keep looking after a good move that is not the best). On
   the left, See it plays their reply to a miss, then help is offered (the
   next hint, or from the third miss the answer); a good move or one the
   engine could not check offers the answer. seen: the bar as it is before
   (false) or after (true) See it, for a word count */
function triedSlots(a, seen) {
  var t = a.tried, left;
  if (seen == null) seen = t.seen;
  if (t.kind === 'close') return [{ act: 'reveal', label: 'Show the answer', cls: 'btn-line' }, { act: 'dismissStronger', label: 'Keep looking', cls: 'btn-big' }];
  if (t.kind === 'miss' && t.reply && !seen) left = { act: 'seeIt', label: 'See it ›', cls: 'btn-line' };
  else if (t.kind === 'unchecked' || a.misses >= 3) left = { act: 'reveal', label: 'Show the answer', cls: 'btn-line' };
  else if (a.hints >= 2) left = { act: 'hint', label: 'No more hints', cls: 'btn-line', off: true };
  else left = { act: 'hint', label: a.hints ? 'Hint 2' : 'Hint', cls: 'btn-line' };
  return [left, { act: 'tryAgain', label: 'Try again', cls: 'btn-big' }];
}
/* a slot as a button: its place (data-slot) for the double-tap guard; a
   switched-off one has no action */
function barHtml(slots) {
  return slots.map(function (s, i) {
    return '<a class="' + s.cls + (s.off ? ' btn-off' : '') + '" data-slot="' + i + '"'
      + (s.off ? ' aria-disabled="true" tabindex="-1"' : ' data-act="' + s.act + '"' + (s.k != null ? ' data-k="' + esc(s.k) + '"' : ''))
      + (s.aria ? ' aria-label="' + esc(s.aria) + '"' : '') + '>' + esc(s.label) + '</a>';
  }).join('');
}
/* a slide only for the move the board shows as its last one */
function sameMove(x, y) { return !!(x && y && x[0] === y[0] && x[1] === y[1]); }
/* a sliding piece is drawn where it came from and let go two frames later,
   so its transition runs; motionUntil then runs from that moment (ms, the
   slide's length), in case those frames took longer than SLIDE_LEAD */
var SLIDE_LEAD = 50;
function releaseAnims(root, ms) {
  var ps = root.querySelectorAll('.anim-piece');
  if (!ps.length) return;
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    for (var i = 0; i < ps.length; i++) ps[i].style.transform = 'translate(0px,0px)';
    /* only for a slide still on screen: one an input already ended
       (flushStage) leaves the clock alone */
    if (ms && ps[0].isConnected && ps[0].style.transition !== 'none') motionUntil = Math.max(motionUntil, Date.now() + ms);
  }); });
}
function promoHtml(st) {
  var w = st.w;
  return '<div class="promo-card"><div class="promo-in">' + ['Q', 'R', 'B', 'N'].map(function (p) {
    return '<a class="promo-opt" data-act="promo" data-k="' + p + '"><svg viewBox="0 0 45 45"><use href="#pc-' + (w ? 'w' : 'b') + p + '"/></svg></a>';
  }).join('') + '</div></div>';
}
/* an alternative that also works is named at the step where it left the
   engine's line, against the engine's move at that same step */
function altNames(a) {
  var at = (a.yours && a.yours.at) || 0;
  var mine = a.lines.yours && a.lines.yours.san[at], theirs = a.lines.best.san[at] || a.lines.best.san[0];
  return { mine: mine || 'Your move', theirs: theirs || '' };
}
/* the session bar: end, progress, more */
function sessionBarHtml(ss, a) {
  var n = Math.min(ss.idx + 1, ss.keys.length);
  return '<a class="sb-end" data-act="endSession" aria-label="End the session">×</a>' + dotsHtml(ss)
    + '<span class="sr-only">Position ' + n + ' of ' + ss.keys.length + '</span>'
    + (a ? '<span class="card-menu"><a data-act="menu" aria-label="More" aria-expanded="' + !!a.menuOpen + '">•••</a>' + (a.menuOpen ? menuHtml(a) : '') + '</span>' : '');
}
function dotsHtml(ss) {
  var seen = {}, out = '';
  ss.keys.forEach(function (k, i) {
    var relearn = ss.relearnOf && ss.relearnOf[k] && seen[k];
    seen[k] = 1;
    var r = relearn ? ss.results[k + '#r'] : ss.results[k];
    /* progress only: results are said in words on the recap */
    var cls = i === ss.idx && !ss.finished ? 'on' : (r ? 'done' : '');
    out += '<span class="dot ' + cls + '"></span>';
  });
  /* one more try still to come: its place is shown already */
  (ss.relearn || []).forEach(function () { out += '<span class="dot"></span>'; });
  return '<div class="dots" aria-hidden="true">' + out + '</div>';
}
function menuHtml(a) {
  var g = a.it.g;
  return '<div class="menu-pop">'
    + '<a href="' + gameHref(g.id, g.color, a.it.b.p) + '">Open the game ↗</a>'
    + '<a href="' + analysisHref(a.explore ? xpCur(a.explore).fen : stateFen(a.pre), g.color) + '">Analyse on ' + (isCC() ? 'chess.com' : 'lichess') + ' ↗</a>'
    + '<span class="sep"></span>'
    + '<a data-act="dispute" data-k="misclick">Not a real mistake: a misclick or premove</a>'
    + '<a data-act="dispute" data-k="decided">Not a real mistake: the game was already decided</a>'
    + '<a data-act="dispute" data-k="engine">Not a real mistake: I think the engine is wrong</a>'
    + '<span class="sep"></span>'
    + (a.phase !== 'done' ? '<a data-act="skip">Skip this one</a>' : '<a data-act="details">Details</a>')
    + '<span class="menu-keys">Enter: the right-hand button · ?: hint · ← →: step · Esc: back to the lesson</span>'
    + '</div>';
}
function ctxHtml(a) {
  var g = a.it.g, b = a.it.b;
  var bits = ['vs <b>' + esc(g.opp) + '</b>' + (g.oppR ? ' (' + g.oppR + ')' : ''), gameDateLine(g), perfLabel(g.perf).toLowerCase(), 'move ' + (Math.floor(b.p / 2) + 1)];
  if (b.c != null) bits.push(clockWords(b.c) + ' left');
  /* a game drill keeps its game one tap away */
  var ss0 = ui.session;
  var drill = ss0 && ss0.spec && ss0.spec.type === 'game';
  if (drill) bits.splice(1, 2);
  var h = '<p class="ctx">' + bits.join(' · ') + '</p>';
  /* its own line, so a narrow screen never clips it */
  if (drill) h += '<p class="ctx ctx-link"><a href="' + gameHref(g.id, g.color, b.p) + '">Open the game ↗</a></p>';
  return h;
}
function ss_relearn(a) { var ss = ui.session; return !!(ss && ss.relearnOf && ss.relearnOf[a.key] && ss.keys.indexOf(a.key) !== ss.idx); }
function clockWords(s) {
  if (s >= 3600) return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60);
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
/* the strip, under the board (2.0): nothing while you solve (the typed-
   move field waits there, off screen); once settled, the Details link (the
   rest of the lesson is in its sheet); the two lines' names under See why;
   the exploration. The result itself is the band's */
function stripHtml(a, ss) {
  if (a.phase !== 'done') {
    /* empty before an answer (2.0): the game's context is in Details. The
       typed-move field sits here, off screen until it has the keyboard; a
       move typed over a try takes the try back first */
    if (a.phase === 'guess' || a.phase === 'tried')
      return '<label class="kb-move">Type your move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. ' + (a.lines && a.lines.best.san[0] === 'Nf3' ? 'Bc4 or f1c4' : 'Nf3 or g1f3') + '" aria-label="Type your move"></label>';
    return '';
  }
  if (a.explore) return xpHtml(a);
  if (a.view.mode === 'story') return storyStripHtml(a);
  /* settled (S0): one link to everything else (S13) */
  return a.view.mode === 's0' && a.settle >= 2 ? '<p class="details-row"><a class="btn-quiet details-link" data-act="details">Details</a></p>' : '';
}
/* the story's strip (S12): "Game ●●● Better ●", a dot per step, the one on
   screen larger with a ring; each name opens its segment's first step. Over
   9 dots it folds to "Game 2/5 · Better". An alternative's segment is
   "Yours" (B1 says "Your X works too."). A tap on a piece puts N1 here for
   a while (S2), in place of the dots */
function storyStripHtml(a) {
  if (a.note && a.note.key === cardStateKey(a)) return '<p class="story-note">' + esc(CARD_COPY.N1(a)) + '</p>';
  var S = buildStory(a), i = a.view.i, n = S.steps.length, inGame = i < S.g;
  var seg = function (key, label, at, len, on) {
    var dots = '';
    if (n > 9) dots = on ? '<span class="st-count">' + (i - at + 1) + '/' + len + '</span>' : '';
    else for (var k = 0; k < len; k++) dots += '<i class="st-dot' + (at + k === i ? ' on' : '') + '"></i>';
    return '<button type="button" class="st-seg st-' + key + (on ? ' on' : '') + '" data-act="storyJump" data-k="' + key + '" aria-label="' + (key === 'game' ? 'Your game' : S.alt ? 'Your move' : 'The better move') + ', from its first move">'
      + '<span class="st-name">' + label + '</span>' + (dots ? '<span class="st-dots" aria-hidden="true">' + dots + '</span>' : '') + '</button>';
  };
  return '<div class="story-strip' + (n > 9 ? ' folded' : '') + '">' + seg('game', 'Game', 0, S.g, inGame)
    + (n > 9 ? '<span class="st-sep" aria-hidden="true">·</span>' : '') + seg('better', S.alt ? 'Yours' : 'Better', S.g, n - S.g, !inGame) + '</div>';
}
/* the Details sheet (S13): what the answered card no longer says on its
   face. The game's context, the decisive line, both long sentences (and an
   alternative's), what the opponent did, the pattern and the schedule, the
   habit, and the way into exploring */
function detailsHtml() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || !a.lines) return '';
  var it = a.it, b = it.b, s = a.cls.sentences, best = a.lines.best.san[0] || '', t = patternOf(b), info = patternInfo(t);
  var row = function (cls, text) { return '<p class="dt-line ' + cls + '"><span class="tl-dot" aria-hidden="true"></span><span>' + text + '</span></p>'; };
  /* the pattern is named once, by its chip (S13) */
  var h = '<div class="kicker">Details</div>' + ctxHtml(a);
  if (b.d) h += '<p class="stakes-tag"><span class="dot-bad" aria-hidden="true"></span>This move ' + decisiveWords(it.g, b) + '.</p>';
  h += '<div class="dt-lines">' + row('tl-bad', esc(a.tier === 1 ? s.game.replace(/ \(\d+% to \d+%\)/g, '') : s.game))
    + (a.alt && a.lines.yours ? row('tl-alt', esc(altNames(a).mine) + ' also holds.') : '')
    + row('tl-good', esc(s.best || best + ' keeps your position together.'));
  var opp = opponentLine(a);
  if (opp) h += row('tl-opp', opp);
  h += '</div><div class="tag-row"><a class="pchip" data-act="sheet" data-k="pattern:' + t + '">' + esc(info.name) + ' ›</a>'
    + '<span class="when">' + scheduleWords(a.rec || srsRec(it), a) + '</span></div>'
    + '<p class="habit">' + esc(habitFor(a, t, info)) + '</p>';
  /* no engine, no exploring */
  if (SF.state !== 'failed') h += '<div class="acts-row sheet-acts"><a class="btn-line" data-act="explore">Try your own moves with Stockfish ›</a></div>';
  return h;
}
/* the exploration: the trail and Stockfish's three best moves (its
   sentence is the band's caption) */
function xpHtml(a) {
  var ex = a.explore, n = xpCur(ex), res = ex.res[n.key], rows = xpRows(a, ex), tier = a.tier || 2;
  var quiet = xpSpoil(n) || xpGameOver(n.st) || n.down;
  var P = ex.at > 0 ? ex.nodes[ex.at - 1] : null, pr = P && ex.res[P.key];
  var busy = !quiet && (!res || res.step < 2 || !!(P && !xpSpoil(P) && !xpGameOver(P.st) && !(pr && pr.step >= 2)));
  var trail = '';
  var from = Math.max(1, ex.nodes.length - 6);
  for (var i = from; i < ex.nodes.length; i++) {
    var mv = ex.nodes[i].mv;
    trail += '<button type="button" class="xp-mv' + (mv.pick ? ' xp-sf' : '') + (i === ex.at ? ' on' : '') + '" data-act="xpGo" data-k="' + i + '">'
      + esc(xpNum(ex.nodes[i - 1].st, 0) + mv.san) + '</button>';
  }
  if (!trail) trail = '<span class="xp-label">Your analysis</span>';
  var h = '<div class="xp" id="xp" role="region" aria-label="Your analysis" tabindex="-1">'
    + '<span class="xp-meter' + (busy ? ' run' : '') + '" aria-hidden="true"><i></i></span>'
    + '<div class="xp-head"><div class="xp-trail">' + trail + '</div><a class="xp-back" data-act="exploreOff">Back to the lesson</a></div>';
  if (!quiet) {
    var mine = n.st.w === myPov(a.it), who = mine ? 'Your best moves' : sideName(n.st.w) + '\'s best moves';
    h += '<p class="xp-cap">' + who + (tier === 1 ? '' : ' · your winning chances') + '</p>'
      + '<div class="xp-rows k' + (ex.k || 3) + '">';
    if (rows) h += rows.map(function (r) {
      return '<button type="button" class="xp-row' + (r.li === (ex.hot || 0) ? ' on' : '') + (tier === 1 ? ' t1' : '') + '" data-act="xpRow" data-k="' + r.li + '" aria-label="' + esc(r.label) + '">'
        + (r.chip ? '<span class="xp-chip">' + esc(r.chip) + '</span>' : '')
        + '<span class="xp-first">' + esc(tier === 1 ? r.first : r.num + r.first) + '</span>'
        + '<span class="xp-cont' + (tier === 1 ? ' t1' : '') + '">' + esc(tier === 1 ? '· ' + r.words : r.cont) + '</span></button>';
    }).join('');
    else for (var s2 = 0; s2 < (tier === 1 ? 2 : 3); s2++) h += '<div class="xp-row skel" aria-hidden="true">' + (tier === 1 ? '' : '<span class="xp-chip">You 00%</span>') + '<span class="xp-first">00.Nxd3</span><span class="xp-cont">00.Ke2 Rd5</span></div>';
    h += '</div>';
  }
  h += '<label class="kb-move xp-kb">Type a move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type a move"></label>'
    + '<a class="xp-back-ph" data-act="exploreOff">Back to the lesson</a></div>';
  return h;
}
/* the engine in words, for Settings */
function engineLine() {
  var name = { 'sf17.1': 'Stockfish 17.1' }[SF.build] || 'Stockfish';
  return name + ' runs in this tab, on your device.';
}
/* rows that fit: never a half row above the phone bar or below the board */
function fitRows() {
  var a = ui.session && ui.session.active, ex = a && a.explore, rowsEl = document.querySelector('#xp .xp-rows');
  if (!ex || !rowsEl) return;
  var bar = document.querySelector('.done-acts'), board = document.querySelector('#bwrap .board');
  if (!bar || !board) return;
  var br = board.getBoundingClientRect(), k = 3, cap = document.querySelector('#xp .xp-cap');
  if (window.innerWidth <= 860) {
    var room = bar.getBoundingClientRect().top - br.bottom - 4;
    k = Math.max(1, Math.min(3, Math.floor(room / 44)));
    if (cap) cap.style.display = room - 44 * k >= 18 ? '' : 'none';
  } else {
    if (cap) cap.style.display = '';
    rowsEl.className = 'xp-rows k3';
    while (k > 1 && bar.getBoundingClientRect().bottom > br.bottom + 1) { k--; rowsEl.className = 'xp-rows k' + k; }
  }
  ex.k = k;
  rowsEl.className = 'xp-rows k' + k;
}
/* what the opponent did with it, only when that adds something */
function opponentLine(a) {
  var it = a.it, ru = unpackUci(it.b.ru), gm = a.lines.game.uci;
  var r1 = ru[0], real = gm[1];
  if (!real || !r1) return '';
  var after = wpAt(it.g, it.b.p + 1);
  if (real !== r1 && after != null && after >= it.b.wa + 10)
    return 'Your opponent missed it. They played ' + esc(a.lines.game.san[1] || '') + ' and you were back in the game.';
  if (real === r1) return 'Your opponent found ' + esc(a.lines.game.san[1] || '') + ' right away.';
  return '';
}
/* the habit fits the move that was played: a king walk is not a pawn
   shield problem, a finished opening is not a development problem, and an
   endgame king move does not need "bring your king in" */
function habitFor(a, t, info) {
  var c = a.cls, pre = a.pre, mover = pType(pre.b[a.played.from]);
  if (t === 'kingSafety' && c.kingMoved) return 'Keep your king out of the open while the queens are on the board.';
  if (t === 'openingSlip') {
    var home = pre.w ? 0 : 7, left = 0;
    for (var sq = home * 8; sq < home * 8 + 8; sq++) { var p = pre.b[sq]; if (p && colorW(p) === pre.w && (pType(p) === 'N' || pType(p) === 'B')) left++; }
    if (left === 0) return PATTERN.drift.habit;
  }
  if (t === 'endgame' && mover === 'K') return 'In the endgame, check every pawn race before you move your king.';
  return info.habit;
}
/* winning chances in words, for newer players */
function standingWords(w) {
  return w >= 80 ? 'you are winning' : w >= 60 ? 'you are better' : w >= 40 ? 'about level' : w >= 20 ? 'you are worse' : 'you are losing';
}
/* when the card comes back, in a few words */
function scheduleWords(rec, a) {
  if (!rec) return '';
  if (isLearned(rec)) return 'Learned. A check-in ' + dueWhen(rec.due);
  if (a.relearnQueued) return 'Back later in this session';
  var w = dueWhen(rec.due);
  return 'Back ' + (w === 'later today' ? 'later today' : w);
}
function scrollTrainerTop() {
  if (window.innerWidth > 860) return;
  var t = el('trainbox');
  if (!t) return;
  var y = t.getBoundingClientRect().top + window.pageYOffset - ((el('bar') || {}).offsetHeight || 52) - 6;
  try { window.scrollTo({ top: y, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, y); }
}

/* ── Insights ────────────────────────────────────────────────────────────── */
function renderInsights() {
  var box = el('insightsbox');
  if (!box || !cfg.user) return;
  if (ui.view !== 'insights' && box.innerHTML) return;       /* rendered on demand */
  var r = insightReport(), n = analysisNumbers();
  if (!data.games.length) {
    box.innerHTML = '<div class="ins">' + (data.sections.games === 'loading' ? '<p class="loading">Reading your games…</p>'
      : '<p class="sec">Insights appear once there are rated games to read. See Today for what to do next.</p>') + '</div>';
    return;
  }
  var partial = n.covered < n.total;
  /* the window is named once, here */
  /* the window's span, not the part read so far */
  var cg = (partial ? scopedGames() : coveredGames()).map(function (g) { return g.ts; });
  var mY = function (t) { return new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); };
  var span = cg.length ? ', ' + mY(Math.min.apply(null, cg)) + ' to ' + mY(Math.max.apply(null, cg)) : '';
  var h = '<div class="ins"><div class="kicker">Based on ' + (partial ? r.games + ' of ' + n.total + ' games so far' : plur(r.games, 'game')) + span + '</div>';
  if (!r.families.length) {
    h += '<h2>Your report appears as Stockfish reads your games.</h2><p class="lead">' + n.covered + ' of ' + n.total + ' games checked. The first patterns show up after a handful of games; the full picture at about ' + INSIGHT_MIN_GAMES + '.</p></div>';
    box.innerHTML = h;
    return;
  }
  var cov = r.coverage, top = r.families[0];
  var head, lead = '';
  if (cov.losses >= 5) {
    head = cov.decided + ' of your ' + cov.losses + ' losses came down to one big mistake.';
    if (top.cost >= 1) lead = 'The biggest leak is ' + esc(top.fam.name.toLowerCase()) + '. It decided ' + fmtGames(top.cost) + '.';
  } else head = 'Your mistakes, grouped by the habit that would prevent them.';
  h += '<h2>' + head + '</h2>' + (lead ? '<p class="lead">' + lead + '</p>' : '');
  /* one ranked list: the bar is games decided, against the top family */
  var focus = currentFocus(), maxCost = Math.max.apply(null, r.families.map(function (a) { return a.cost; }).concat([1]));
  h += '<h3 class="ins-h">What decided your games</h3><div class="fam-list">';
  r.families.forEach(function (a) {
    var pats = a.patterns.slice().sort(function (x, y) { return y.cost - x.cost || y.count - x.count; });
    var sub = pats.length > 1 ? pats.slice(0, 3).map(function (s) { return esc(s.info.plural); }).join(', ') : '';
    var isFocus = focus && focus.fam === a.fam.key;
    h += '<a class="fam-row' + (isFocus ? ' is-focus' : '') + '" data-act="sheet" data-k="family:' + a.fam.key + '">'
      + '<span class="fr-name">' + esc(a.fam.name) + (isFocus ? ' <span class="pill">Focus</span>' : '')
        + (sub ? '<small>' + sub + '</small>' : '') + (a.learned ? '<small>' + a.learned + ' learned so far</small>' : '') + '</span>'
      + '<span class="fr-bar"><i style="width:' + Math.max(3, Math.round(a.cost * 100 / maxCost)) + '%"></i></span>'
      + '<span class="fr-n">' + (a.cost >= 1 ? fmtGames(a.cost) : plur(a.count, 'position')) + '</span><span class="fr-go" aria-hidden="true">›</span></a>';
  });
  h += '</div>';
  if (r.ready) {
    h += '<h3 class="ins-h">Where it happens</h3>';
    if (r.slices.length) {
      r.slices.forEach(function (s) {
        h += '<div class="slice"><p>' + esc(s.text) + '</p><a data-act="drill" data-spec="' + esc(JSON.stringify(s.spec)) + '">Drill these ›</a></div>';
      });
    } else h += '<p class="sec">No clear pattern yet by colour or opening. This sharpens as more games are checked; for now the list above is where the points are.</p>';
  } else {
    h += '<p class="sec" style="margin-top:20px">After ' + INSIGHT_MIN_GAMES + ' checked games you will also see where your mistakes happen: as White or Black, and in which openings.</p>';
  }
  h += '</div>';
  box.innerHTML = h;
}
/* ── sheets ──────────────────────────────────────────────────────────────── */
/* back: where focus returns on closing, as a selector, when the control
   that opened it may be gone by then (the ••• menu's item) */
function openSheet(kind, back) {
  var was = ui.sheet;
  ui.sheet = kind;
  var ov = el('overlay');
  var body = sheetHtml(kind);
  if (!body) { ui.sheet = was; return; }
  /* the phone's Back gesture closes the sheet, not the page */
  if (!was) { try { history.pushState({ nlSheet: 1, nlSession: history.state && history.state.nlSession }, '', location.href); } catch (e) {} }
  if (!ui.sheetReturn) { ui.sheetReturn = document.activeElement; ui.sheetBack = back || null; }
  ov.innerHTML = '<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Details" tabindex="-1">'
    + '<a class="close" data-act="closeSheet" aria-label="Close">×</a>' + body + '</div></div>';
  document.documentElement.style.overflow = 'hidden';
  var sh = ov.querySelector('.sheet'), h3 = sh && sh.querySelector('h3');
  if (h3) { h3.id = 'sheet-title'; sh.removeAttribute('aria-label'); sh.setAttribute('aria-labelledby', 'sheet-title'); }
  if (sh) sh.focus({ preventScroll: true });
}
function closeSheet(fromPop) {
  if (!ui.sheet) return;
  ui.sheet = null;
  /* closed by hand: the sheet's history entry stops meaning a sheet (going
     back through history here would race any navigation that follows) */
  if (fromPop !== true && history.state && history.state.nlSheet) { try { history.replaceState({ nlSession: history.state.nlSession }, '', location.href); } catch (e) {} }
  var ov = el('overlay');
  if (ov) ov.innerHTML = '';
  document.documentElement.style.overflow = '';
  var back = ui.sheetReturn, sel = ui.sheetBack;
  ui.sheetReturn = null; ui.sheetBack = null;
  /* the opener, found again: it may have been repainted, or never had
     focus (a tap on a phone), and focus never ends on the page itself */
  var opener = sel && document.querySelector(sel);
  if (opener) back = opener;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}
function sheetHtml(kind) {
  var parts = String(kind).split(':'), k = parts[1];
  if (parts[0] === 'settings') return settingsHtml();
  if (parts[0] === 'details') return detailsHtml();
  if (parts[0] === 'family') {
    var fam = FAMILIES.filter(function (f) { return f.key === k; })[0];
    var agg = insightReport().families.filter(function (a) { return a.fam.key === k; })[0];
    if (!fam || !agg) return '';
    var focus = currentFocus(), nDrill = drillItems({ type: 'family', fam: k }, 8).length;
    var rows = agg.patterns.slice().sort(function (x, y) { return y.cost - x.cost || y.count - x.count; }).map(function (s) {
      return '<a class="pat-row" data-act="sheet" data-k="pattern:' + s.key + '"><span>' + esc(s.info.plural) + '</span><span class="dim">' + s.count
        + (s.cost >= 1 ? ' · decided ' + fmtGames(s.cost) : '') + '</span><span class="fr-go" aria-hidden="true">›</span></a>';
    }).join('');
    return '<div class="kicker">Mistake family</div><h3>' + esc(fam.name) + '</h3>'
      + '<p class="sheet-sum">' + (agg.cost >= 1 ? 'Decided ' + fmtGames(agg.cost) + ' of yours. ' : '') + plur(agg.count, 'position') + ' from your games.'
        + (agg.learned ? ' ' + agg.learned + ' learned.' : '') + '</p>'
      + '<div class="habit-block"><div class="kicker">The habit that fixes it</div><div class="plan">' + esc(fam.habit) + '</div></div>'
      + '<div class="acts-row sheet-acts">' + (nDrill ? '<a class="btn-big" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'family', fam: k, label: fam.name })) + '">Drill ' + plur(nDrill, 'position') + '</a>' : '')
      + (focus && focus.fam === k ? '<span class="pill">Focus</span>' : '') + '</div>'
      + (rows ? '<div class="pat-list">' + rows + '</div>' : '')
      + examplesHtml({ type: 'family', fam: k });
  }
  if (parts[0] === 'pattern') {
    var info = PATTERN[k];
    var s = patternStats().filter(function (x) { return x.key === k; })[0];
    if (!info) return '';
    var fk = familyOf(k);
    return '<a class="sheet-back" data-act="sheet" data-k="family:' + fk.key + '">‹ ' + esc(fk.name) + '</a><h3>' + esc(info.plural) + '</h3>'
      + '<p class="sheet-sum">' + (s ? plur(s.count, 'position') + ' from your games' + (s.cost >= 1 ? ', which decided ' + fmtGames(s.cost) : '') + '.' + (s.fixed ? ' ' + s.fixed + ' learned.' : '') : 'None in your games yet.') + '</p>'
      + '<div class="habit-block"><div class="kicker">The habit</div><div class="plan">' + esc(info.habit) + '</div></div>'
      + (s ? '<div class="acts-row sheet-acts"><a class="btn-big" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'pattern', key: k, label: info.plural })) + '">Drill ' + plur(Math.min(8, s.count), 'position') + '</a></div>' : '')
      + examplesHtml({ type: 'pattern', key: k });
  }
  return '';
}
/* a decisive mistake loses a game, or turns a win into a draw */
/* how a decisive mistake is named: said no stronger than the evidence */
function decisiveWords(g, b) {
  if (b && b.dw === 'slip') return 'let the win slip';
  if (b && b.dw === 'turn') return 'was where the game turned';
  return g.res === 'draw' ? 'cost you the win' : 'lost the game';
}
function examplesHtml(spec) {
  var items = drillItems(spec, 4);
  if (!items.length) return '';
  return '<div class="kicker" style="margin-top:24px">From your games</div><div class="ex-list">' + items.map(function (it) {
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    return '<div class="ex" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: it.key, label: 'One position' })) + '">'
      + boardSvg(pre, { flip: it.g.color === 'black', decor: true, bad: [uciToMove(pre, uciOfSan(it.g.mv, it.b.p)) || { from: 0, to: 0 }].map(function (m) { return m.from; }).concat([(uciToMove(pre, uciOfSan(it.g.mv, it.b.p)) || { to: 0 }).to]) })
      + '<span>vs ' + esc(it.g.opp) + ' · ' + gameDateLine(it.g) + (it.b.d ? '<br><span class="dot-bad" aria-hidden="true"></span> ' + decisiveWords(it.g, it.b) : '') + '</span></div>';
  }).join('') + '</div>';
}

/* ── settings ────────────────────────────────────────────────────────────── */
/* settings live in a sheet: opened by the gear, closed back to where you were */
function renderSettings() {
  if (ui.sheet !== 'settings') return;
  var sh = document.querySelector('#overlay .sheet');
  if (!sh) return;
  var y = sh.scrollTop, foc = document.activeElement, fk = foc && sh.contains(foc) ? (foc.getAttribute('data-act') || '') + '|' + (foc.getAttribute('data-k') || '') : null;
  sh.innerHTML = '<a class="close" data-act="closeSheet" aria-label="Close">×</a>' + settingsHtml();
  sh.scrollTop = y;
  if (fk) {
    var p = fk.split('|'), back = sh.querySelector('[data-act="' + p[0] + '"]' + (p[1] ? '[data-k="' + p[1] + '"]' : ''));
    if (back) { makeFocusable(sh); back.focus({ preventScroll: true }); }
  }
}
function settingsHtml() {
  var perfs = trackedPerfs();
  var chip = function (act, k, label, on) {
    return '<a class="chip' + (on ? ' chip-on' : '') + '" data-act="' + act + '" data-k="' + k + '" aria-pressed="' + !!on + '">' + (on ? '✓ ' : '') + label + '</a>';
  };
  var sw = function (act, label, on) {
    return '<label class="switch-row"><span>' + label + '</span><input type="checkbox" data-act="' + act + '"' + (on ? ' checked' : '') + '><i aria-hidden="true"></i></label>';
  };
  return '<h3>Settings</h3>'
    + '<div class="set-block"><span class="kicker">Player</span><p class="set-who">' + esc(cfg.user) + ' on ' + (isCC() ? 'chess.com' : 'lichess') + '</p>'
      + '<a class="btn-line" data-act="logout" data-k="confirm">' + (ui.logoutArmed ? 'Tap again to switch' : 'Switch player') + '</a></div>'
    + '<div class="set-block"><span class="kicker">Games to learn from</span><p>Which of your rated games to read. Most players pick the one or two they play most.</p><div class="chips">'
      + ['rapid', 'blitz', 'bullet', 'classical'].filter(function (p) { return !isCC() || p !== 'classical'; }).map(function (p) {
        return chip('perf', p, perfLabel(p) + ' <span class="dim">' + PERF_HINT[p] + '</span>', perfs.indexOf(p) !== -1);
      }).join('') + '</div></div>'
    + '<div class="set-block"><span class="kicker">Practice</span><p>Positions in a day\'s session. New positions join a few at a time.</p><div class="chips">'
      + [[5, 'Short · 5'], [10, 'Normal · 10'], [20, 'Long · 20']].map(function (o) { return chip('size', o[0], o[1], sessionSize() === o[0]); }).join('')
      + '</div><p>Weekly goal, in days:</p><div class="chips">'
      + [3, 4, 5, 7].map(function (n) { return chip('weekGoal', n, n, weekGoal() === n); }).join('')
      + '</div>' + (goalThisWeek() !== weekGoal() ? '<p>The new goal starts on Monday. This week stays at ' + goalThisWeek() + '.</p>' : '')
      + '<p>' + DAY_RULE + '</p></div>'
    + '<div class="set-block"><span class="kicker">Board</span>'
      + sw('sound', 'Sounds', cfg.sound) + '</div>'
    + '<div class="set-block"><span class="kicker">Analysis</span><p>Reading your games</p><div class="chips">'
      + [['std', 'Standard'], ['thorough', 'Thorough']].map(function (o) { return chip('scanDepth', o[0], o[1], scanDepth() === o[0]); }).join('')
      + '</div><p>Thorough reads new games more deeply and finds a few more mistakes. It takes about twice as long, so leave this tab open while it reads.</p>'
      + (scanDepth() === 'thorough' ? (function () { var rc = recheckCount(); return rc.n ? '<p class="dim" id="recheck-line">' + recheckText(rc) + '</p>' : ''; })() : '')
      + '<p class="dim">' + engineLine() + '</p></div>'
    + '<div class="set-block"><span class="kicker">Your data</span>'
      + '<div class="chips"><a class="chip" data-act="exportProgress">Save progress to a file</a><a class="chip" data-act="importProgress">Load progress from a file</a></div>'
      + '<p class="dim">' + gamesLine() + '</p>'
      + '<p>Your games and progress are saved in this browser, not on our servers. Microsoft Clarity records clicks and the screen, with all text hidden, to show how the site is used.</p></div>'
    + '<div class="set-block"><span class="kicker">Start over</span>'
      + '<a data-act="resetProgress" class="danger-row' + (ui.resetArmed ? ' armed' : '') + '">' + (ui.resetArmed ? 'Tap again to reset your practice history' : 'Reset practice history') + '</a>'
      + '<a data-act="wipe" class="danger-row' + (ui.wipeArmed ? ' armed' : '') + '">' + (ui.wipeArmed ? 'Tap again to erase everything' : 'Erase everything') + '</a></div>';
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
  f.innerHTML = '<span class="foot-line">Free and open source. Your games and progress are saved in this browser, not on our servers. Microsoft Clarity records clicks and the screen, with all text hidden, to show how the site is used.</span>'
    + '<span class="foot-links"><a data-act="coffee">Support the developer</a>'
    + (isCC() ? '' : '<a href="https://lichess.org/patron">Donate to lichess</a>')
    + '<a href="https://github.com/thatsiavash/notlichess">Source</a></span>';
}

