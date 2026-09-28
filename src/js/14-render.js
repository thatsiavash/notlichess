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
  if (ui.session) { endSession(true); return; }
  var h = (location.hash || '').replace('#', '');
  if (h === 'coach' || h === 'insights') h = 'insights'; else h = 'train';
  if (h !== ui.view) setView(h, true);
});
function renderViews() {
  var nav = el('views');
  if (!nav) return;
  /* a quiet dot while today's session is not done: never a count */
  var pending = cfg.user && !(dayLoad().sessions > 0) && dueCards().length > 0;
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
var lastReadyShown = -1;
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
  var fmt = '<p class="fmt-line">From your ' + trackedPerfs().map(function (p) { return perfLabel(p).toLowerCase(); }).join(' and ') + ' games · <a data-act="settings">Change</a></p>';
  box.innerHTML = '<div class="today today-grid"><div class="today-main">' + since
    + (saved ? resumeHtml(saved) : (doneToday ? doneTodayHtml() : heroHtml()))
    + focusHtml()
    + '<p class="status" id="astat">' + analysisLine(n) + '</p>' + fmt
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
  return '<aside class="latest" id="latest" data-clarity-mask="true"><div class="latest-head"><div class="kicker">Your latest games</div>'
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
function sinceHtml() { return data.greeting ? '<p class="since" data-clarity-mask="true">' + data.greeting + '</p>' : ''; }
/* the weekly goal as its own shape: one segment per day of the goal */
function weekHtml() {
  var goal = weekGoal(), done = Math.min(weekDays(), goal), today = dayCounts(dayRecOf(new Date())), segs = '';
  for (var i = 0; i < goal; i++) segs += '<span class="wseg' + (i < done ? ' on' : (i === done && !today ? ' wseg-now' : '')) + '"></span>';
  var weeks = weeksAtGoal();
  return '<div class="week"><div class="wsegs" aria-hidden="true">' + segs + '</div>'
    + '<span>' + Math.min(weekDays(), 7) + ' of ' + goal + ' days this week.' + (weeks >= 2 ? ' ' + weeks + ' weeks in a row at your goal.' : '') + '</span></div>';
}
function heroHtml() {
  var plan = todayPlan();
  var mins = Math.max(3, Math.round(plan.keys.length * 0.8));
  var why;
  var first0 = model().byKey[plan.keys[0]];
  if (plan.firstTime) why = first0 && first0.b.d
    ? 'First, the move that ' + decisiveWords(first0.g, first0.b) + ' vs ' + esc(first0.g.opp) + '. Then easier ones.'
    : 'We\'ll start with the easier ones.';
  else {
    /* the reason to start now: the newest game one of these positions decided */
    var m = model(), dec = plan.keys.map(function (k) { return m.byKey[k]; })
      .filter(function (it) { return it && it.b.d; }).sort(function (x, y) { return y.g.ts - x.g.ts; })[0];
    var reviews = plan.keys.length - plan.fresh;
    if (dec) why = 'Includes the move that ' + decisiveWords(dec.g, dec.b) + ' vs ' + esc(dec.g.opp) + ', ' + agoWords(dec.g.ts) + '.';
    else why = (reviews ? plur(reviews, 'review') + (plan.fresh ? ' and ' + plan.fresh + ' new from your games.' : '.') : plan.fresh + ' new from your games.');
  }
  return '<div class="hero">'
    + '<h2 id="hero-n" data-n="' + plan.keys.length + '">' + plur(plan.keys.length, 'position') + ', about ' + mins + ' minutes</h2>'
    + '<p class="why" data-clarity-mask="true">' + why + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" data-act="startToday">Start</a></div></div>';
}
function resumeHtml(s) {
  return '<div class="hero">'
    + '<h2>Pick up where you left off.</h2><p class="why">' + Math.min(sessionDoneCount(s), s.keys.length) + ' of ' + s.keys.length + ' done. The rest are waiting where you stopped.</p>' + weekHtml()
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
    + '<div class="kicker">' + (f.provisional ? 'Leading so far' : 'Your biggest leak') + '</div>'
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
    var it = model().byKey[k], r = ss.results[k];
    if (!it || !r || r === 'skip') return '';
    answered++;
    if (r !== 'fail') solved++;
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    /* the result in words, never in colour alone */
    var word = r === 'first' ? '✓ first try' : r === 'retry' ? '✓ on the retry' : r === 'fail' ? 'Shown' : '✓ with help';
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
function renderCard() {
  var box = el('trainbox'), ss = ui.session;
  if (!box || !ss) return;
  if (ss.finished) { renderTrain(); return; }
  var a = ss.active;
  if (!a) {
    box.dataset.card = '';
    box.innerHTML = '<div class="card"><div class="card-top">' + sessionBarHtml(ss, null) + '</div>'
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
  var newCard = !a.shown;
  a.shown = true;
  el('ctop').innerHTML = sessionBarHtml(ss, a) + cardTaskHtml(a);
  /* the board */
  var view, opts = { flip: flip };
  if (a.phase === 'done' && a.explore) {
    view = { st: a.explore.st, last: a.explore.last, ev: a.explore.ev };
    opts.sel = a.explore.sel;
    /* the engine's answer to your idea, as a quiet arrow */
    var rep = a.explore.reply && a.explore.san.length ? uciToMove(a.explore.st, a.explore.reply) : null;
    if (rep) opts.ghost = [rep.from, rep.to];
    if (a.explore.sel >= 0) opts.dots = legalMoves(a.explore.st).filter(function (m) { return m.from === a.explore.sel; }).map(function (m) { return m.to; });
  } else if (a.phase === 'done') {
    view = lineView(a);
    /* one arrow at a time, on the start position only: red for the move you
       played, green for the better one; never both */
    if (a.view && a.view.idx < 0) {
      var L0 = a.lines[a.view.line];
      if (a.view.line === 'refute' || a.view.line === 'game') opts.bad = [a.played.from, a.played.to];
      else if (L0 && L0.moves.length) opts.good = [L0.moves[0].from, L0.moves[0].to];
    }
  } else {
    var st = a.st;
    if (a.phase === 'checking' && a.ghostMove) {
      st = cloneState(a.st);
      var gm = legalMoves(st).filter(function (m) { return m.from === a.ghostMove[0] && m.to === a.ghostMove[1]; })[0];
      if (gm) applyMove(st, gm);
    }
    view = { st: st, last: a.phase === 'checking' ? a.ghostMove : a.lastMove, ev: it.b.eb };
    opts.sel = a.sel;
    if ((a.phase === 'guess' || a.phase === 'check') && a.sel >= 0) opts.dots = legalMoves(a.st).filter(function (m) { return m.from === a.sel; }).map(function (m) { return m.to; });
    opts.shapes = a.shapes;
    if (a.phase === 'guess' && a.solIdx === 0 && !a.explore) opts.bad = [a.played.from, a.played.to];
    if (a.hints >= 2 && a.phase === 'guess') opts.hint = (a.sol && a.solIdx > 0 ? uciToMove(a.st, a.sol[a.solIdx]) || a.best : a.best).from;
    if (a.animMove) opts.anim = a.animMove;
  }
  opts.mark = view.last;
  opts.label = (view.st.w ? 'White' : 'Black') + ' to move. You played ' + sanOf(a.pre, a.played) + ' in the game.';
  var ck = checkedKingSq(view.st);
  if (ck != null) opts.check = ck;
  var bw = el('bwrap');
  bw.innerHTML = boardSvg(view.st, opts) + (a.pendingPromo ? promoHtml(view.st) : '');
  bw.classList.toggle('static', !(a.phase === 'guess' || a.phase === 'check' || (a.phase === 'done' && a.explore)));
  releaseAnims(bw);
  a.animMove = null;
  /* the bar: player's view of the position, labelled once answered */
  var myCp = view.ev != null ? view.ev : it.b.eb;
  var wWhite = winPct(evalWhite(it, myCp));
  var fill = el('ebar-fill'), lab = el('ebar-lab');
  if (store.get('nl:evalbar', true)) {
    el('ebar').hidden = false;
    fill.style.height = wWhite + '%';
    /* no pawn number: winning chances are the one scale, said in words */
    lab.textContent = '';
  } else el('ebar').hidden = true;
  /* keyboard focus stays on the same control across a repaint, and the
     verdict is read out to screen readers */
  var foc = document.activeElement, fp = el('cpanel');
  var focKey = foc && fp && fp.contains(foc) ? (foc.id || ((foc.getAttribute('data-act') || '') + '|' + (foc.getAttribute('data-k') || ''))) : null;
  fp.innerHTML = panelHtml(a, ss);
  makeFocusable(fp);
  if (newCard) { var th = el('task-h'); if (th) th.focus({ preventScroll: true }); }
  else if (a.phase === 'done' && !a.focusedResult) { a.focusedResult = true; var rh = el('result-h'); if (rh) rh.focus({ preventScroll: true }); }
  else if (focKey) {
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
/* an alternative that also works is named at the step where it left the
   engine's line, against the engine's move at that same step */
function altNames(a) {
  var at = (a.yours && a.yours.at) || 0;
  var mine = a.lines.yours && a.lines.yours.san[at], theirs = a.lines.best.san[at] || a.lines.best.san[0];
  return { mine: mine || 'Your move', theirs: theirs || '' };
}
/* the phone's prompt line: one message at a time, two lines at most */
function cardTaskHtml(a) {
  var side = a.it.g.color === 'white' ? 'White' : 'Black', txt, cls = '', act = '';
  var strip = function (h) { return String(h).replace(/<span class="dim">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ''); };
  if (a.phase === 'checking') txt = 'Checking ' + esc(a.checking || 'your move') + '…';
  else if (a.phase === 'done') {
    var best = esc(a.lines.best.san[0] || ''), why = esc(a.cls.sentences.best || '');
    /* the move is named once: "Qf8+ wins the pawn" becomes "It wins the pawn" */
    if (best && why.indexOf(best + ' ') === 0) why = 'It ' + why.slice(best.length + 1);
    act = ' data-act="lineTab" data-k="best" role="button"';
    if (a.result === 'fail' || a.revealed) txt = 'The answer is ' + best + '. ' + why;
    else if (a.alt) { txt = '<b>✓ ' + esc(altNames(a).mine) + ' works too.</b> The engine prefers ' + esc(altNames(a).theirs) + '.'; cls = ' good'; }
    else { txt = '<b>✓ ' + best + '. ' + (a.result === 'first' ? 'Found it.' : 'You got there.') + '</b> ' + why; cls = ' good'; }
  }
  else if (a.verdict) { txt = strip(a.verdict.html); cls = a.verdict.cls === 'verdict-bad' ? ' bad' : (a.verdict.cls === 'verdict-good' ? ' good' : ''); }
  else if (a.check1 && !a.check1.done) txt = 'You played ' + esc(sanOf(a.pre, a.played)) + '. What can ' + (side === 'White' ? 'Black' : 'White') + ' do now? Move their piece.';
  else if (a.hints >= 1) { txt = esc(hintText(a)); cls = ' hint'; }
  else if (a.sol && a.solIdx > 0) txt = 'Move ' + (a.solIdx / 2 + 1) + ' of ' + Math.ceil(a.sol.length / 2) + ': now finish it.';
  else {
    var san = esc(sanOf(a.pre, a.played));
    txt = 'You are ' + side + '. Find a better move. ' + (a.it.b.d ? 'Your ' + san + ', the red arrow, ' + decisiveWords(a.it.g, a.it.b) + '.' : 'Your ' + san + ' is the red arrow.');
  }
  return '<div class="card-task' + cls + '"' + act + ' aria-hidden="true">' + txt + '</div>';
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
  return '<div class="dots" aria-hidden="true">' + out + '</div>';
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
    + (a.phase !== 'done' ? '<a data-act="skip">Skip this one</a>' : '')
    + '<span class="menu-keys">Enter: next · ?: hint · ← →: step through the line</span>'
    + '</div>';
}
function ctxHtml(a, answered) {
  var g = a.it.g, b = a.it.b;
  var bits = ['vs <b>' + esc(g.opp) + '</b>' + (g.oppR ? ' (' + g.oppR + ')' : ''), gameDateLine(g), perfLabel(g.perf).toLowerCase(), 'move ' + (Math.floor(b.p / 2) + 1)];
  if (b.c != null) bits.push(clockWords(b.c) + ' left');
  var h = '<p class="ctx" data-clarity-mask="true">' + bits.join(' · ') + '</p>';
  if (answered) return h;
  var tags = [], ss = ui.session;
  if (ss && ss.spec && ss.spec.type === 'game' && ss.idx === 0 && b.d && ss.keys.length > 1)
    tags.push(ss.keys.length + ' mistakes in this game. This is the one that ' + decisiveWords(g, b));
  else if (b.d) tags.push('This move ' + decisiveWords(g, b));
  if (ss_relearn(a)) tags.push('One more try');
  return h + (tags.length ? '<p class="stakes-tag"><span class="dot-bad" aria-hidden="true"></span>' + tags.join(' · ') + '</p>' : '');
}
function ss_relearn(a) { var ss = ui.session; return !!(ss && ss.relearnOf && ss.relearnOf[a.key] && ss.keys.indexOf(a.key) !== ss.idx); }
function clockWords(s) {
  if (s >= 3600) return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60);
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
/* the stakes of the position, in numbers for most players and in words for
   newer ones */
function stakesWords(a, san) {
  var b = a.it.b;
  if (a.tier === 1) {
    var before = b.wb >= 60 ? 'You were better. ' : (b.wb >= 40 ? 'The game was even. ' : '');
    var after = b.wa < 30 ? 'After ' + esc(san) + ' you were losing.' : (b.wa < 45 ? 'After ' + esc(san) + ' you were worse.' : esc(san) + ' gave away much of your lead.');
    return before + after;
  }
  return 'You played ' + esc(san) + ', the red arrow. Your winning chances fell from ' + Math.round(b.wb) + '% to ' + Math.round(b.wa) + '%.';
}
function panelHtml(a, ss) {
  var it = a.it, b = it.b, side = it.g.color === 'white' ? 'White' : 'Black';
  var h = ctxHtml(a);
  if (a.check1 && !a.check1.done && a.phase !== 'done') {
    /* step 1: the check the player skipped in the game */
    var them = side === 'White' ? 'Black' : 'White', san1 = sanOf(a.pre, a.played);
    h += '<h2 class="task" id="task-h" tabindex="-1">You played ' + esc(san1) + '. What can ' + them + ' do now?</h2>';
    h += '<p class="stakes">Move ' + them + '\'s piece: find the reply that punishes it. Then you will look for a better move.</p>';
    h += '<div class="feedback" aria-live="polite">' + (a.verdict ? '<p class="verdict ' + a.verdict.cls + '">' + a.verdict.html + '</p>' : '') + '</div>';
    if (a.phase === 'check') h += '<div class="acts-row sticky-acts guess-acts"><a class="btn-line" data-act="checkShow">Show me</a></div>';
    return h;
  }
  if (a.phase !== 'done') {
    var rec0 = srsRec(it), review = rec0 && rec0.box >= 2 && !a.firstSight;
    var san = sanOf(a.pre, a.played);
    h += '<h2 class="task" id="task-h" tabindex="-1">' + (a.sol && a.solIdx > 0
      ? 'Move ' + (a.solIdx / 2 + 1) + ' of ' + Math.ceil(a.sol.length / 2) + ': now finish it.'
      : 'You are ' + side + '. Find a better move.') + '</h2>';
    if (!review && a.solIdx === 0) h += '<p class="stakes">' + stakesWords(a, san) + '</p>';
    /* the feedback slot: one message at a time, in a space kept for it */
    var fb = '';
    if (a.phase === 'checking') fb = '<div class="checking"><span class="meter"><i></i></span>Checking ' + esc(a.checking || 'your move') + '…</div>';
    else if (a.verdict) fb = '<p class="verdict ' + a.verdict.cls + '">' + a.verdict.html + '</p>';
    else if (!store.get('nl:marksSeen', false) && ss.idx === 0 && a.firstSight && !a.attempts)
      fb = '<p class="first-line">Drag a piece, or tap it and tap a square. The bar on the left shows who is winning.</p>';
    else if (a.tier === 1 && a.solIdx === 0 && !a.hints) fb = '<p class="first-line">Look at every check and capture first, for both sides.</p>';
    if (a.hints >= 1) fb += '<p class="hint-note">' + esc(hintText(a)) + (a.hints >= 2 ? ' The piece to move is circled.' : '') + '</p>';
    h += '<div class="feedback" aria-live="polite">' + fb + '</div>';
    if (a.phase === 'guess') {
      var acts = '';
      if (a.strongerOffer) acts += '<a class="btn-line" data-act="dismissStronger">Keep looking</a><a class="btn-line" data-act="reveal">Show the best move</a>';
      else {
        /* fixed slots: Hint stays in place, switched off when it has nothing left to give */
        var hintOff = a.hints >= 2 || (a.tier === 3 && !a.misses);
        acts += '<a class="btn-line' + (hintOff ? ' btn-off' : (a.misses ? ' btn-pulse' : '')) + '" data-act="hint"' + (hintOff ? ' aria-disabled="true"' : '') + '>Hint</a>';
        acts += '<a class="' + (a.misses >= 2 ? 'btn-big' : 'btn-line') + '" data-act="reveal">Show the answer</a>';
      }
      h += '<div class="acts-row sticky-acts guess-acts">' + acts + '</div>';
      h += '<label class="kb-move">Type your move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. Nf3 or g1f3" aria-label="Type your move"></label>';
    }
    return h;
  }
  /* done: the result, then both halves of the lesson, always on screen */
  var best = a.lines.best.san[0] || '', s = a.cls.sentences;
  var disc, head, sub = '';
  if (a.result === 'fail' || a.revealed) {
    disc = '';
    head = 'The answer is ' + esc(best) + '.';
    if (a.foundGood) sub = 'Your ' + esc(a.foundGood.san) + ' was close.';
  } else if (a.alt) {
    disc = '<span class="disc disc-help" aria-hidden="true">✓</span>';
    head = esc(altNames(a).mine) + ' works too.';
    sub = 'The engine prefers ' + esc(altNames(a).theirs) + ', by a little.';
  } else {
    disc = '<span class="disc' + (a.result === 'first' ? '' : ' disc-help') + '" aria-hidden="true">✓</span>';
    head = esc(best) + (a.result === 'first' ? '. Found it.' : '. You got there.');
  }
  var cur = a.explore ? null : a.view.line;
  var tline = function (key, cls, text) {
    var on = cur === key;
    return '<button type="button" class="tline ' + cls + (on ? ' on' : '') + '" data-act="lineTab" data-k="' + key + '" aria-pressed="' + on + '">'
      + '<span class="tl-dot" aria-hidden="true"></span><span class="tl-text">' + text + '</span>'
      + (on ? '' : '<span class="tl-play" aria-hidden="true"></span>') + '</button>';
  };
  h = ctxHtml(a, true);
  h += '<div class="result' + (a.result === 'first' && !a.alt && !a.revealed ? ' first' : '') + '">'
    + '<div class="result-head">' + disc + '<h2 class="result-h" id="result-h" tabindex="-1">' + head + '</h2></div>'
    + (sub ? '<p class="result-sub">' + sub + '</p>' : '')
    + tline('refute', 'tl-bad', esc(s.game))
    + (a.alt && a.lines.yours ? tline('yours', 'tl-alt', esc(altNames(a).mine) + ' also holds. Here is how it goes on.') : '')
    + tline('best', 'tl-good', esc(s.best || best + ' keeps your position together.'));
  var opp = opponentLine(a);
  if (opp) h += tline('game', 'tl-opp', opp);
  h += '</div>';
  var t = patternOf(b), info = patternInfo(t);
  h += '<div class="tag-row"><a class="pchip" data-act="sheet" data-k="pattern:' + t + '">' + esc(info.name) + ' ›</a>'
    + '<span class="when">' + scheduleWords(a.rec || srsRec(it), a) + '</span></div>';
  if (a.showHabit) h += '<p class="habit">' + esc(info.habit) + '</p>';
  var repSan = a.explore && a.explore.reply && a.explore.san.length ? (function () { var m = uciToMove(a.explore.st, a.explore.reply); return m ? sanOf(a.explore.st, m) : ''; })() : '';
  if (a.explore) h += '<p class="explore-line">Your analysis: ' + esc(a.explore.san.join(' ') || 'make a move on the board')
    + (a.explore.ev != null ? ' · ' + Math.round(winPct(a.explore.ev)) + '% winning chances for you' + (repSan ? '. Stockfish would answer ' + esc(repSan) + ' (the gold arrow)' : '') : (a.explore.san.length ? ' · thinking…' : ''))
    + ' · <a data-act="exploreOff">Back to the lines</a></p>';
  else h += '<p class="explore-line"><a class="btn-quiet" data-act="explore">Try your own moves</a></p>';
  var L = a.lines[a.view.line] || a.lines.best;
  h += '<div class="acts-row sticky-acts done-acts">'
    + '<a class="nav-btn' + (a.explore || a.view.idx < 0 ? ' nav-off' : '') + '" data-act="lineBack" aria-label="Back one move">‹</a>'
    + '<a class="nav-btn' + (a.explore || a.view.idx >= L.states.length - 1 ? ' nav-off' : '') + '" data-act="lineFwd" aria-label="Forward one move">›</a>'
    + '<a class="btn-big" data-act="next">' + (ss.idx + 1 >= ss.keys.length && !(ss.relearn && ss.relearn.length) ? 'Finish' : 'Next') + '</a></div>';
  return h;
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
  var h = '<div class="ins"><div class="kicker">Based on ' + (partial ? r.games + ' of ' + n.total + ' games so far' : plur(r.games, 'game')) + '</div>';
  if (!r.families.length) {
    h += '<h2>Your report appears as Stockfish reads your games.</h2><p class="lead">' + n.covered + ' of ' + n.total + ' games checked. The first patterns show up after a handful of games; the full picture at about ' + INSIGHT_MIN_GAMES + '.</p></div>';
    box.innerHTML = h;
    return;
  }
  var cov = r.coverage, top = r.families[0];
  var head, lead = '';
  if (cov.losses >= 5) {
    /* a count names its span */
    var t0 = Math.min.apply(null, coveredGames().map(function (g) { return g.ts; }));
    var since = isFinite(t0) ? ' since ' + new Date(t0).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
    head = cov.decided + ' of your ' + cov.losses + ' losses' + since + ' came down to one big mistake.';
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
function openSheet(kind) {
  var was = ui.sheet;
  ui.sheet = kind;
  var ov = el('overlay');
  var body = sheetHtml(kind);
  if (!body) { ui.sheet = was; return; }
  /* the phone's Back gesture closes the sheet, not the page */
  if (!was) { try { history.pushState({ nlSheet: 1, nlSession: history.state && history.state.nlSession }, '', location.href); } catch (e) {} }
  if (!ui.sheetReturn) ui.sheetReturn = document.activeElement;
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
  var back = ui.sheetReturn;
  ui.sheetReturn = null;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}
function sheetHtml(kind) {
  var parts = String(kind).split(':'), k = parts[1];
  if (parts[0] === 'settings') return settingsHtml();
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
      + (focus && focus.fam === k && !focus.provisional ? '<span class="dim">Your focus</span>' : '<a class="btn-line" data-act="setFocus" data-k="' + k + '">Make this my focus</a>') + '</div>'
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
  return '<div class="kicker" style="margin-top:24px">From your games</div><div class="ex-list" data-clarity-mask="true">' + items.map(function (it) {
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
    + '<div class="set-block"><span class="kicker">Player</span><p class="set-who" data-clarity-mask="true">' + esc(cfg.user) + ' on ' + (isCC() ? 'chess.com' : 'lichess') + '</p>'
      + '<a class="btn-line" data-act="logout" data-k="confirm">' + (ui.logoutArmed ? 'Tap again to switch' : 'Switch player') + '</a></div>'
    + '<div class="set-block"><span class="kicker">Games to learn from</span><p>Which of your rated games to read. Most players pick the one or two they play most.</p><div class="chips">'
      + ['rapid', 'blitz', 'bullet', 'classical'].filter(function (p) { return !isCC() || p !== 'classical'; }).map(function (p) {
        return chip('perf', p, perfLabel(p) + ' <span class="dim">' + PERF_HINT[p] + '</span>', perfs.indexOf(p) !== -1);
      }).join('') + '</div></div>'
    + '<div class="set-block"><span class="kicker">Practice</span><p>Positions in a day\'s session. New positions join a few at a time.</p><div class="chips">'
      + [[5, 'Short · 5'], [10, 'Normal · 10'], [20, 'Long · 20']].map(function (o) { return chip('size', o[0], o[1], sessionSize() === o[0]); }).join('')
      + '</div><p>Weekly goal, in days:</p><div class="chips">'
      + [3, 4, 5, 7].map(function (n) { return chip('weekGoal', n, n, weekGoal() === n); }).join('')
      + '</div><p>Help while solving:</p><div class="chips">'
      + [['auto', 'By my rating'], ['more', 'More'], ['less', 'Less']].map(function (o) { return chip('help', o[0], o[1], store.get('nl:help', 'auto') === o[0]); }).join('')
      + '</div></div>'
    + '<div class="set-block"><span class="kicker">Board</span>'
      + sw('evalbarToggle', 'Evaluation bar', store.get('nl:evalbar', true)) + sw('sound', 'Sounds', cfg.sound) + '</div>'
    + '<div class="set-block"><span class="kicker">Your data</span>'
      + '<div class="chips"><a class="chip" data-act="exportProgress">Save progress to a file</a><a class="chip" data-act="importProgress">Load progress from a file</a></div>'
      + '<p class="dim">' + gamesLine() + '</p>'
      + '<p>Your games and progress are saved in this browser, not on our servers. Microsoft Clarity records clicks and the screen, with player names hidden, to show how the site is used.</p></div>'
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
  f.innerHTML = '<span class="foot-line">Free and open source. Your games and progress stay in this browser.</span>'
    + '<span class="foot-links"><a data-act="coffee">Support the developer</a>'
    + '<a href="https://lichess.org/patron">Donate to lichess</a>'
    + '<a href="https://github.com/thatsiavash/notlichess">Source</a></span>';
}

