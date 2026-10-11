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
/* a tag on this visit's recording (Clarity's set): coarse words only,
   never a name, a rating or a position */
function measureTag(key, value) {
  try { if (window.clarity) window.clarity('set', key, String(value)); } catch (e) {}
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
  /* a measure: Insights opened */
  if (v === 'insights' && ui.view !== 'insights') track('insights_open');
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
  if (am && am.menuOpen) { setMenu(am, false); try { history.pushState({ nlSession: 1 }, '', location.href); } catch (e) {} return; }
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
  var pending = tabDot();
  nav.innerHTML = VIEWS.map(function (v) {
    return '<a class="view-tab' + (ui.view === v[0] ? ' view-on' : '') + '" data-act="view" data-k="' + v[0] + '" role="tab" aria-selected="' + (ui.view === v[0]) + '">'
      + v[1] + (v[0] === 'train' && pending && !(ui.session && ui.session.active) ? '<span class="tab-dot" aria-label="practice waiting"></span>' : '') + '</a>';
  }).join('');
  el('view-train').hidden = ui.view !== 'train';
  el('view-insights').hidden = ui.view !== 'insights';
  /* session mode: the board and nothing else */
  document.body.classList.toggle('in-session', !!ui.session && ui.view === 'train');
}
function tabDot() { return !!(cfg.user && !(dayLoad().sessions > 0) && (dueCards().length > 0 || todayPlan().keys.length > 0)); }
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
var lastReadyShown = -1, lastTodaySig = '', lastSigCheck = 0, lastDotKey = '', lastReadOver = null;
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
  /* what waits for the read shows the moment it ends, not at the next
     repaint: the focus (Today) and the tab's dot; the dot also follows the
     positions as they arrive */
  var over = readOver(n), dk = n.ready + '|' + over;
  if (lastReadOver === false && over && ui.view === 'train' && !ui.session) renderTrain();
  lastReadOver = over;
  if (dk !== lastDotKey) { lastDotKey = dk; renderViews(); }
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
  if (ss && ss.finished) { box.dataset.card = ''; box.innerHTML = doneHtml(ss); summaryMoments(ss); return; }
  if (ss) { renderCard(); return; }
  box.dataset.card = '';
  var n = analysisNumbers();
  var gamesLoading = data.sections.games === 'loading';
  if (!data.games.length) {
    var site = isCC() ? 'chess.com' : 'lichess';
    box.innerHTML = '<div class="today">' + (gamesLoading
      ? stateCard('Reading your games', 'Fetching your rated games from ' + site + '.', '')
      : (data.sections.games === 'fail'
        ? stateCard(site + ' did not answer.', 'Your saved games and progress are all here. Check your connection and try again.', '<a class="btn-big" data-icon="rotate" data-act="reload">Try again</a>')
        : stateCard('No rated games yet.', 'notlichess reads rated live games on ' + site + ': bullet, blitz, rapid' + (isCC() ? '' : ' and classical') + '. '
          + (isCC() ? 'Daily games are not read yet.' : 'Correspondence games are not read yet.') + ' Play a few rated games, then come back. Your mistakes will be waiting.',
          '<a class="btn-big" href="' + playHref(cfg.tcs[0]) + '">Play a game ↗</a>')))
      + '</div>';
    return;
  }
  var since = sinceHtml();
  if (n.ready < 3) { box.innerHTML = '<div class="today">' + since + findingHtml(n) + '</div>'; return; }
  /* the day's first opening: the extra-set rule, once a day (F7.1) */
  absorbOpen();
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
    + '<p class="lg-foot dim">' + tapWord() + ' a game to go through its mistakes in order.</p></aside>';
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
/* the weekly goal as its own shape: one segment per day of the goal; on
   the summary of the set that met it, its medal leads (lead) and its line
   says so (line, F4.4) */
function weekHtml(lead, line) {
  var goal = goalThisWeek(), done = Math.min(weekDays(), goal), today = dayCounts(dayRecOf(new Date())), segs = '';
  for (var i = 0; i < goal; i++) segs += '<span class="wseg' + (i < done ? ' on' : (i === done && !today ? ' wseg-now' : '')) + '"></span>';
  var weeks = weeksAtGoal();
  return '<div class="week">' + (lead || '') + '<div class="wsegs" aria-hidden="true">' + segs + '</div>'
    + '<span>' + (line || Math.min(weekDays(), 7) + ' of ' + goal + ' days this week.') + (weeks >= 2 ? ' ' + weeks + ' weeks in a row at your goal.' : '') + '</span></div>';
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
    else why = (reviews ? plur(reviews, 'position') + ' back for another look' + (plan.fresh ? ', and ' + plan.fresh + ' new from your games.' : '.') : plan.fresh + ' new from your games.');
  }
  /* a session finished today without enough tries: say what counts */
  var dl = dayLoad();
  var need = Math.min(3, plan.keys.length);
  if (dl.short && !dayCounts(dl)) why += need > 1 ? ' Try ' + need + ' positions to count today.' : ' Try it to count today.';
  /* the title names one set; the rest, when there is more, in line 2 (F7.2) */
  var ab = absorbToday(), dueN = dueCards().length, more = [];
  if (ab && ab.sp) more.push(ab.sp + ' more spread over the next 3 weeks.');
  if (dueN > sessionSize()) more.push(dueN + ' due in all. Each set takes the most important first.');
  return '<div class="hero">'
    + '<h2 id="hero-n" data-n="' + plan.keys.length + '">' + plur(plan.keys.length, 'position') + ', about ' + plur(mins, 'minute') + '</h2>'
    + (more.length ? '<p class="why hero-more">' + more.join(' ') + '</p>' : '')
    + '<p class="why">' + why + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" data-icon="play" data-act="startToday">Start</a></div></div>';
}
function resumeHtml(s) {
  return '<div class="hero">'
    + '<h2>Pick up where you left off.</h2><p class="why">' + countsWords(s)
    + (sessionDoneCount(s) >= sessionTotal(s) ? ' Resume to finish it.' : ' The rest are waiting where you stopped.') + '</p>' + weekHtml()
    + '<div class="acts"><a class="btn-big" data-icon="play" data-act="resume">Resume</a><a class="btn-quiet" data-act="dropSession">End this set</a></div></div>';
}
/* the next time something is due back, as one set (F2.6, F7.2, calm):
   "Tomorrow: a set of 10, about 8 minutes." (fewer: "Tomorrow: 3
   positions, about 2 minutes."); when more than a set comes due by then,
   what that day's first opening will do (absorbPlan): "... 13 more over
   the next 3 weeks." where it spreads them, "... 23 due in all." where
   there is no room. While more are due today: "13 more due today; any
   left spread over the next 3 weeks." Counted: every position due by the
   end of that day, those due now included */
var SPREAD_SAY = 'over the next 3 weeks';
function nextDueHtml() {
  var srs = srsLoad(), m = model(), now = Date.now(), next = null, size = sessionSize();
  var mins = function (x) { return plur(Math.max(1, Math.round(x * 0.8)), 'minute'); };
  var setOf = function (n) { return n >= size ? 'a set of ' + size + ', about ' + mins(size) : plur(n, 'position') + ', about ' + mins(n); };
  var dayWord = function (d) { return d <= 0 ? 'Later today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days'; };
  /* the first opening d days on (as at noon): what it keeps due, spreads
     and leaves due for want of room */
  var opening = function (d) { return absorbPlan(dayStart(now, d) + 12 * 3600 * 1000); };
  var plan = function (d, p) {
    var kept = p.keep.length + p.left.length;
    return dayWord(d) + ': ' + setOf(kept) + '.' + (p.spread.length ? ' ' + p.spread.length + ' more ' + SPREAD_SAY + '.' : '') + (p.left.length ? ' ' + kept + ' due in all.' : '');
  };
  var left = dueCards().length;
  if (left) {
    var pt = opening(1);
    if (pt.spread.length) return left + ' more due today; any left spread ' + SPREAD_SAY + '.';
    return left + ' more due today. ' + (pt.left.length ? 'Each set takes the most important first.' : plan(1, pt));
  }
  var live = function (k) { var r = srs[k], it = m.byKey[k]; return r && r.due && !r.hidden && it && trainable(it); };
  Object.keys(srs).forEach(function (k) { if (live(k) && srs[k].due > now && (!next || srs[k].due < next)) next = srs[k].due; });
  if (!next) return 'Nothing is due back yet.';
  var d = daysFrom(now, next), end = dayStart(next, 1);
  var n = Object.keys(srs).filter(function (k) { return live(k) && srs[k].due < end; }).length;
  if (n <= size) return dayWord(d) + ': ' + setOf(n) + '.';
  return d >= 1 ? plan(d, opening(d)) : dayWord(d) + ': ' + setOf(n) + '. ' + n + ' due in all.';
}
/* the button for the next set, its size in words */
function nextSetWords(n) { return n === 1 ? 'One more position' : 'Next set of ' + n; }
/* a set done is never the end of the day: the next one is the main action */
function doneTodayHtml() {
  var more = morePracticeKeys().length;
  return '<div class="hero">'
    + '<h2>' + ((dayLoad().sessions || 0) > 0 ? 'Today\'s set is done.' : 'Nothing due right now.') + '</h2><p class="why">' + nextDueHtml() + '</p>' + weekHtml()
    + (more ? '<div class="acts"><a class="btn-big" data-icon="arrow" data-act="keepGoing">' + nextSetWords(more) + '</a></div>'
      : '<p class="why">You have practised every position from your games so far.</p>') + '</div>';
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
      '<a class="btn-big" data-icon="rotate" data-act="engineRetry">Try again</a>');
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
      'Play a few more rated games and more will turn up.', (can ? '<a class="btn-big" data-icon="play" data-act="startToday">Start with ' + can + '</a>' : '') + play.replace('btn-big', 'btn-quiet'));
  }
  if (n.ready) {
    return stateCard(n.ready + ' found so far', 'Start with ' + (n.ready === 1 ? 'this one' : 'these') + ' now, or wait a minute for more.',
      can ? '<a class="btn-big" data-icon="play" data-act="startToday">Start with ' + can + '</a>' : '',
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
    + '<div class="plan">' + esc(lineOfStep(familyStep(fam.key), playerTier())) + '</div></div>';
}
/* a date outside the current year carries its year */
function gameDateLine(g) {
  try {
    var d = new Date(g.ts), o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-GB', o);
  } catch (e) { return ''; }
}
/* the ladder moving, in plain words: the positions found first try wait
   longer before they come back, and when that is */
function ladderHtml(ss, keys) {
  var srs = srsLoad(), now = Date.now(), days = [];
  keys.forEach(function (k) {
    var r = srs[k], e = sumOf(ss, k);
    if (e && e.c === 'first' && r && r.due) days.push(Math.max(1, Math.round((r.due - now) / DAY)));
  });
  if (!days.length) return '';
  var lo = Math.min.apply(null, days), hi = Math.max.apply(null, days);
  return '<p class="recap-ladder">' + (days.length === 1 ? 'The position you found comes' : 'The ' + days.length + ' positions you found come') + ' back in '
    + (lo === hi ? plur(lo, 'day') : lo + ' to ' + hi + ' days') + '.</p>';
}
/* the check line above one card (F2.3): a drill's family or pattern, the
   family of the move that decided a drilled game, or the focus after a
   Today set, as its step's line (tier 2's question at tier 3) */
function recapHabit(ss) {
  var sp = ss.spec || {}, t = playerTier(), fam = null;
  if (sp.type === 'family') fam = sp.fam;
  else if (sp.type === 'pattern') return lineOfStep(patternStep(sp.key), t);
  else if (sp.type === 'game' || sp.type === 'one') {
    var m = model(), its = ss.keys.map(function (k) { return m.byKey[k]; }).filter(Boolean);
    var d = its.filter(function (it) { return it.b.d; })[0] || its[0];
    if (d) fam = familyOf(patternOf(d.b)).key;
  }
  if (!fam) { var f = currentFocus(); fam = f && f.fam; }
  return fam ? lineOfStep(familyStep(fam), t) : '';
}
/* "Tap" on a touch screen, "Click" where a mouse points (pointer: fine) */
function tapWord() { return window.matchMedia && window.matchMedia('(pointer: fine)').matches ? 'Click' : 'Tap'; }
/* a touch screen: the main pointer is a finger (pointer: coarse) */
function touchScreen() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
/* ── the summary (F2.1 to F2.4) ──────────────────────────────────────────
   The honest score: each position by the worst event of its showing (C10),
   "2 of 5 found first try." (tier 1: stars), the others in one line, what
   moved on the ladders, the check lines in "Keep in mind", the tiles.
   CAT_WORD: a tile's word; CAT_THEN: the second line's; CAT_AGAIN: a one
   more try's, after the first showing's ("After a miss, then found") */
var CAT_WORD = { first: 'First try', alt: 'Works too', good: 'After a good move', hint: 'With a hint', look: 'First look', miss: 'After a miss', shown: 'Shown', left: 'Missed', skip: 'Skipped' };
var CAT_THEN = { miss: 'after a miss', hint: 'with a hint', look: 'first look', good: 'after a good move', alt: 'works too', shown: 'shown', left: 'missed' };
var CAT_ORDER = ['miss', 'hint', 'look', 'good', 'alt', 'shown', 'left'];
var CAT_AGAIN = { first: 'then found', alt: 'then found', good: 'then found', hint: 'then found with a hint', look: 'then found with a hint', miss: 'then found after a miss', shown: 'then shown again', left: 'then missed again' };
/* a showing's entry (noteResult); for a set kept before this build, read
   from its result and note */
function sumOf(ss, k) {
  var e = ss.sum && ss.sum[k];
  if (e) return e;
  var r = ss.results[k], n = (ss.notes || {})[k];
  if (!r) return null;
  var c = n === 'shown' ? 'shown' : n === 'leftMiss' ? 'left' : n === 'left' ? 'skip' : n === 'firstlook' ? 'look'
    : ({ first: 'first', hint: 'hint', retry: 'miss', fail: 'shown' })[r] || 'skip';
  return { c: c, s: { first: 3, look: 3, hint: 2, miss: 1 }[c] || 0 };
}
/* the headline and its second line: "2 of 5 found first try." / "Then 2
   after a miss, 1 after a good move." (tier 1 "11 of 15 stars"); counted:
   every position answered (a skip is not) */
function recapScore(ss, keys, tier) {
  var n = 0, first = 0, stars = 0, by = {};
  keys.forEach(function (k) {
    var e = sumOf(ss, k);
    if (!e || e.c === 'skip') return;
    n++; stars += e.s || 0;
    if (e.c === 'first') first++; else by[e.c] = (by[e.c] || 0) + 1;
  });
  if (!n) return { head: 'Done.', then: '' };
  var parts = CAT_ORDER.filter(function (c) { return by[c]; }).map(function (c) { return by[c] + ' ' + CAT_THEN[c]; });
  return { head: tier === 1 ? stars + ' of ' + n * 3 + ' stars' : first + ' of ' + n + ' found first try.', then: parts.length ? 'Then ' + parts.join(', ') + '.' : '' };
}
/* what moved (F2.2): "2 moved up, 1 held, 1 back to the start.", the parts
   that are not zero, a position learned first */
function movedWords(ss, keys) {
  var n = { learned: 0, up: 0, held: 0, start: 0 };
  keys.forEach(function (k) { var e = ss.sum && ss.sum[k]; if (e && n[e.m] != null) n[e.m]++; });
  var parts = [];
  if (n.learned) parts.push(n.learned + ' learned');
  if (n.up) parts.push(n.up + ' moved up');
  if (n.held) parts.push(n.held + ' held');
  if (n.start) parts.push(n.start + ' back to the start');
  return parts.length ? parts.join(', ') + '.' : '';
}
/* the step most wrong tries of the set failed, two or more (F2.4): "3 of
   your 4 wrong tries failed the safety check." (step 1 "...missed their
   threat.", 2 "...missed your chance."; tier 1 in its own words), with that
   step's line under it. {line, step} or null */
var FAILED_SAY = { 1: 'missed their threat.', 2: 'missed your chance.', 3: 'failed the safety check.' };
var FAILED_SAY_T1 = { 1: 'missed what their move attacked.', 2: 'missed a capture or check you had.', 3: 'missed what they could take.' };
function failedCheck(ss, tier) {
  var n = { 1: 0, 2: 0, 3: 0 }, all = 0;
  Object.keys(ss.sum || {}).forEach(function (k) { String(ss.sum[k].fc || '').split('').forEach(function (d) { all++; if (n[d] != null) n[d]++; }); });
  var best = [1, 2, 3].filter(function (d) { return n[d] >= 2; }).sort(function (x, y) { return n[y] - n[x] || x - y; })[0];
  if (!best) return null;
  var k = n[best], lead = k < all ? k + ' of your ' + all + ' wrong tries ' : all === 2 ? 'Both your wrong tries ' : 'All ' + all + ' of your wrong tries ';
  return { line: lead + (tier === 1 ? FAILED_SAY_T1 : FAILED_SAY)[best], step: best };
}
/* "Keep in mind": the failed check and its step's line first, then each
   position's check line once, in the order met (a position left untouched
   taught nothing). At tier 3 a computed fact sits on its tile, and the
   card here says its step's line */
function keepLines(ss, keys, tier) {
  var out = [], add = function (x) { if (x && out.indexOf(x) < 0) out.push(x); };
  var fc = failedCheck(ss, tier);
  if (fc) { add(fc.line); add(lineOfStep(fc.step, tier)); }
  keys.forEach(function (k) {
    var e = ss.sum && ss.sum[k];
    if (e && e.c !== 'skip' && e.l && model().byKey[k]) add(e.f ? lineOfStep(e.st, tier) : e.l);
  });
  if (!out.length) add(recapHabit(ss));
  return out;
}
/* a position's rungs on its tile at tiers 2 and 3 (F2.2: three pips, the
   third gold, lit when learned), its stars at tier 1 */
function rungHtml(p) {
  var h = '';
  for (var i = 0; i < 3; i++) h += '<i' + (i < p ? ' class="on' + (i === 2 ? ' gold' : '') + '"' : '') + '></i>';
  return '<span class="rungs" role="img" aria-label="' + (p === 3 ? 'Learned' : p + ' of 3 steps to learned') + '">' + h + '</span>';
}
function starsHtml(n) {
  var h = '';
  for (var i = 0; i < 3; i++) h += '<i' + (i < n ? ' class="on"' : '') + '>★</i>';
  return '<span class="stars" role="img" aria-label="' + n + ' of 3 stars">' + h + '</span>';
}
/* a position just learned leads the tiles (F2.2): "Learned: Rg1, from
   your loss to opponent1. Found 3 times over 23 days." (tier 1 the move in
   words), with the learned glyph, its honey seal (F3.1) */
function learnedHtml(it, e, tier, fx) {
  var pre = stateAtPly(it.g.mv, it.b.p), pm = pre && uciToMove(pre, uciOfSan(it.g.mv, it.b.p));
  if (!pre || !pm) return '';
  var g = it.g, mv = tier === 1 ? moveWords(pre, pm) : sanOf(pre, pm).replace(/[+#]$/, '');
  var from = g.res === 'loss' ? 'loss to ' : g.res === 'draw' ? 'draw with ' : 'win against ';
  /* fx: its seal stamps once, as the summary first paints (F4.4) */
  return '<div class="recap-item recap-learned"' + (fx ? ' data-fx="seal"' : '') + ' data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: it.key, label: 'One position' })) + '">'
    + boardSvg(pre, { flip: g.color === 'black', bad: [pm.from, pm.to], decor: true }) + resultGlyph('learned')
    + '<span class="learned-say"><b>Learned: ' + esc(mv) + ', from your ' + from + esc(g.opp) + '.</b> '
    + (e.d != null ? 'Found ' + plur(e.n, 'time') + ' over ' + plur(e.d, 'day') + '.' : 'Found ' + plur(e.n, 'time') + ' in a row.') + '</span>'
    + rungHtml(3) + '</div>';
}
/* a result's glyph (F3.1), by its category (sumOf's c): a leaf disc with
   a tick first try or for another move that works, a leaf ring with a tick
   after a good move, a honey bulb with a hint or a first look, a honey
   rotate after a miss, a slate eye shown, a dash for one missed or skipped,
   a honey seal for a position learned; drawn by the stylesheet (.rg) */
var RESULT_GLYPH = { first: 'first', alt: 'first', good: 'good', hint: 'hint', look: 'hint', miss: 'miss', shown: 'shown', left: 'skip', skip: 'skip', learned: 'learned' };
function resultGlyph(c) {
  var g = RESULT_GLYPH[c];
  return g ? '<span class="rg rg-' + g + '" aria-hidden="true"></span>' : '';
}
/* the summary (F4.5): the result row (one glyph per position, in the
   set's order), the headline and its second line, what moved, the week
   (once the goal is met, its medal and "Goal met: 4 days this week."), when
   positions come back, the tiles (two columns on a phone, 160 px tiles in an
   880 px column on a wide screen, a position just learned leading them
   across both), the habit card, and a sticky bar with the next set. Its
   moments (F4.4) run on its first paint only (ss.fxShown, set by
   summaryMoments): a position learned stamps its seal, else a goal met
   settles its medal; with both, the seal moves and the medal shows as it
   ends */
function doneHtml(ss) {
  var tier = playerTier(), uniq = [], fx = !ss.fxShown, row = '';
  ss.keys.forEach(function (k) { if (uniq.indexOf(k) === -1) uniq.push(k); });
  var learned = '', recap = uniq.map(function (k) {
    var it = model().byKey[k], e = sumOf(ss, k);
    /* a card taken out as not a real mistake has left the model: gone from the summary too */
    if (!it || !e || !ss.results[k]) return '';
    row += resultGlyph(e.c);
    if (e.m === 'learned' && !learned) { learned = learnedHtml(it, e, tier, fx); if (learned) return ''; }
    /* a card that came back for one more try says how that went too (a
       try left untouched adds nothing) */
    var e2 = ss.results[k + '#r'] ? sumOf(ss, k + '#r') : null, word = CAT_WORD[e.c] + (e2 && CAT_AGAIN[e2.c] ? ', ' + CAT_AGAIN[e2.c] : '');
    var pre = stateAtPly(it.g.mv, it.b.p);
    if (!pre) return '';
    var pm = uciToMove(pre, uciOfSan(it.g.mv, it.b.p)), done = e.c !== 'skip' && e.c !== 'shown' && e.c !== 'left';
    /* the result in words and as its glyph, never in colour alone; tier 3's
       computed check line on its tile (F2.3) */
    return '<div class="recap-item" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'one', key: k, label: 'One position' })) + '">'
      + boardSvg(pre, { flip: it.g.color === 'black', bad: pm ? [pm.from, pm.to] : null, decor: true }) + '<span>' + esc(patternInfo(patternOf(it.b)).name) + '</span>'
      + resultGlyph(e.c) + '<span class="res' + (done ? '' : ' shown') + '">' + word + '</span>'
      + (e.c === 'skip' ? '' : tier === 1 ? starsHtml(e.s || 0) : e.p != null ? rungHtml(e.p) : '')
      + (e.f && e.l ? '<span class="tile-check">' + esc(e.l) + '</span>' : '') + '</div>';
  }).join('');
  var sc = recapScore(ss, uniq, tier), moved = movedWords(ss, uniq), keep = keepLines(ss, uniq, tier), more = morePracticeKeys().length;
  var gm = ss.goalMet, week = gm ? weekHtml('<span class="medal"' + (fx && !learned ? ' data-fx="medal"' : '') + ' aria-hidden="true"></span>', 'Goal met: ' + plur(gm.days, 'day') + ' this week.') : weekHtml();
  return '<div class="card-top recap-top">' + sessionBarHtml(ss, null) + '</div>'
    + '<div class="today recap-page">'
    + (row ? '<div class="result-row" aria-hidden="true">' + row + '</div>' : '')
    + '<h2 class="done-big" id="recap-h" tabindex="-1">' + sc.head + '</h2>'
    + (sc.then ? '<p class="recap-then">' + sc.then + '</p>' : '')
    + (moved ? '<p class="recap-moved">' + moved + '</p>' : '')
    + ladderHtml(ss, uniq)
    + '<div class="recap-week' + (gm ? ' met' : '') + '"><div class="kicker">This week</div>' + week + '</div>'
    + '<p class="recap-next">' + nextDueHtml() + '</p>'
    + (learned || recap ? '<div class="recap">' + learned + recap + '</div>' : '')
    + (keep.length || ss.routine ? '<div class="focus recap-habit">' + (ss.routine && tier >= 2 ? '<p class="plan routine">' + ROUTINE_LINE + '</p>' : '')
      + (keep.length === 1 ? '<p class="plan">Keep in mind: ' + esc(keep[0]) + '</p>'
        : keep.length ? '<p class="plan">Keep in mind:</p><ul class="plans">' + keep.map(function (h) { return '<li class="plan">' + esc(h) + '</li>'; }).join('') + '</ul>' : '')
    + '</div>' : '')
    /* the next set is the main way on: a bar that stays at the foot of the
       screen, the next set twice as wide as the way back */
    + '<div class="acts-row recap-acts">'
      + (more ? '<a class="btn-big" data-icon="arrow" data-act="keepGoing">' + nextSetWords(more) + '</a>' : '')
      + '<a class="' + (more ? 'btn-line' : 'btn-big') + '" data-act="endSession">Back to Today</a>'
    + '</div>'
    + '</div>';
}
/* the summary's moments (F4.4), once, after its first paint: a position
   learned dings, a goal met plays its four notes (both: the ding, then the
   notes), and a set with neither its own three; under reduced motion the
   stylesheet draws the seal and the medal as they end, and the sound stays.
   Sound off silences them all (snd) */
var NOTES_AFTER_DING = 450;
function summaryMoments(ss) {
  if (!ss || ss.fxShown) return;
  ss.fxShown = true;
  var learned = Object.keys(ss.sum || {}).some(function (k) { return ss.sum[k].m === 'learned' && !!model().byKey[k]; });
  if (learned) { reward('learned'); snd('learned'); }
  if (ss.goalMet) { reward('goal'); if (learned) setTimeout(function () { snd('goal'); }, NOTES_AFTER_DING); else snd('goal'); }
  if (!learned && !ss.goalMet) snd('set');
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
    view = { st: ex.st, last: ex.last, ev: ev != null ? ev : it.b.eb };
    opts.sel = ex.sel;
    /* one arrow, gold and named Stockfish's pick: the top line's move only
       (a row under the pointer or the keyboard is lit in the list, never on
       the board, where the label would call another move the pick) */
    var xs = xpShown(ex, xn), hl = xs && !quiet && xs[0] ? uciToMove(ex.st, xs[0].pv[0]) : null;
    if (hl) opts.ghost = [hl.from, hl.to];
    if (ex.anim) { opts.anim = ex.anim; slideMs = 220; }
    if (ex.sel >= 0) opts.dots = legalMoves(ex.st).filter(function (m) { return m.from === ex.sel; }).map(function (m) { return m.to; });
  } else if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    /* a story step (S12): its ply slides in as a move the app shows (320
       ms) and what it brings lands with it (storyMarks). A segment's first
       step keeps its arrow as the trail: the red game move on G1, the green
       better move on B1; while it crossfades in (pre) the arrow is drawn on
       the position the segment starts from */
    view = storyView(a);
    var S = buildStory(a), sp = S.steps[a.view.i], sn = sp.line.nodes[sp.k];
    /* the danger frame (F1.5) draws no move, only its own marks (storyMarks) */
    if (!sp.df && sp.k === (sp.seg === 'game' ? 0 : sp.from)) {
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
    view = { st: a.st, last: a.lastMove, ev: it.b.eb };
    if (sameMove(a.animMove, view.last)) { opts.anim = a.animMove; slideMs = a.animSlow ? 400 : a.animShown ? 320 : 220; }
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
    /* their reply after Play it, on S10's timeline (addReplyMarks); landed,
       its arrow and token give way to the next answer's green arrow, which
       lands with it */
    if (addReplyMarks(a, view, opts, !!sdue)) land = true;
    if (sdue) {
      opts.sel = a.sel;
      if (a.sel === sdue.from) opts.dots = [sdue.to];
    }
    if (a.view.mode === 's0' && a.settle >= 1 && !opts.anim) {
      /* the ghost and the tokens fade in once, as this beat's effect */
      var s0 = s0Marks(a, view.st);
      ['ghosts', 'rings', 'arrows', 'tokens'].forEach(function (k) { if (s0[k].length) opts[k] = (opts[k] || []).concat(s0[k]); });
      if (s0.lineTakes) opts.lineTakes = s0.lineTakes;
      if (s0.ghosts.length || s0.tokens.length) opts.fx = a.key + ':s0';
      /* the threat arrow into the square of the tick: the badge yields its corner */
      var s0t = s0.arrows[0];
      if (s0t && opts.badges && s0t.to === opts.badges[0].sq) {
        var s0c = badgeCorner(s0t.from, s0t.to, flip);
        if (s0c[0] !== 36 || s0c[1] !== 9) opts.badges = [{ sq: opts.badges[0].sq, kind: opts.badges[0].kind, fx: opts.badges[0].fx, at: s0c }];
      }
    }
  } else if (a.phase === 'done') {
    /* an answered card always shows one of the frames above */
    view = { st: a.st, last: a.lastMove, ev: it.b.eb };
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
    /* a piece tapped during the forcing reply is picked up as it lands */
    if ((a.phase === 'guess' || (a.phase === 'reply' && a.reply && a.reply.played)) && a.sel >= 0) opts.dots = legalMoves(a.st).filter(function (m) { return m.from === a.sel; }).map(function (m) { return m.to; });
    opts.shapes = a.shapes;
    if (a.phase === 'guess' && a.solIdx === 0 && !a.explore) opts.bad = [a.played.from, a.played.to];
    /* your move slides as you make it; their reply, once See it plays it,
       slides as a move the app shows */
    if (sameMove(a.animMove, view.last)) { opts.anim = a.animMove; slideMs = a.animSlow ? 400 : a.phase === 'tried' && a.tried.seen ? 320 : 220; }
    /* the move just made, on its squares: checking (a grey dots badge), a
       miss (a red cross), a good move that is not the best (a hollow ring
       with a tick) or one not checked (a question mark); once See it plays
       their reply, the piece it took, as a token where it landed (never on
       the answer's square, 2.3). It lands with the piece: a frame that
       slides it draws it once the slide ends */
    var t = a.tried, due = dueMove(a), vk = null, vm = null, fx = null, lands = null;
    if (a.phase === 'checking' && a.ghostMove) { vk = 'checking'; vm = a.ghostMove; }
    else if (a.phase === 'tried' && !t.seen) { vk = t.kind === 'miss' ? 'bad' : t.kind; vm = [t.from, t.to]; }
    /* a move of a forcing line found (S10): the filled tick, until their reply moves */
    else if (a.phase === 'reply' && a.reply && !a.reply.played && a.lastMove) { vk = 'good'; vm = a.lastMove; }
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
    /* the forcing reply (S10): its telegraph, its slide, where it landed */
    if ((a.phase === 'reply' || a.phase === 'guess') && addReplyMarks(a, view, opts)) land = true;
    /* a hint's marks (S8), while the card asks; after Try again they land
       with the tried line, once the crossfade is over */
    if (a.phase === 'guess' && !a.triedHold) {
      var hm = hintMarks(a);
      if (hm.rings.length) opts.rings = (opts.rings || []).concat(hm.rings);
      if (hm.arrows.length) opts.arrows = (opts.arrows || []).concat(hm.arrows);
    }
  }
  /* "not a move here": the grey outline on a square just tapped. Before an
     answer a ring already drawn (a hint's, a miss's reason) keeps the frame
     to one ring (2.1) and the band's T4 says it alone; after an answer the
     outline is the tap's answer (principle 6) */
  if (a.nope && a.nope.key === cardStateKey(a) && (a.phase === 'done' || !(opts.rings || []).length)) opts.rings = (opts.rings || []).concat([{ sq: a.nope.sq, kind: 'nope' }]);
  if (slideMs === 320 || slideMs === 400) opts.animMs = slideMs;
  /* the last-move tint marks a move that has landed: a piece sliding in
     with a verdict to come gets no tint until the verdict's own, so its
     squares change colour once */
  opts.mark = land ? null : view.last;
  /* a check given by a piece still sliding glows once it lands, with the
     rest of what lands */
  var ck = checkedKingSq(view.st);
  if (ck != null && !land) opts.check = ck;
  tokenSpots(opts);
  /* the board's name says what it draws (S20), mark by mark */
  opts.label = boardAria(a, view.st, opts);
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
/* the forcing reply's marks (S10, 2.1) on the frame view: from 600 ms its
   telegraph, the piece ringed and a blue-grey dashed arrow to where it
   goes; both ride its slide; as it lands the ring goes, the arrow turns
   solid and what it took shows as a token. The landed marks stay until
   your next move (a.replyMark), as the move's own marks (2.3 exempts
   them), unless noLanded (a line shown: the next answer's green arrow
   takes the board as it lands). Added to opts; true when they ride a
   slide (they go as it lands) */
function addReplyMarks(a, view, opts, noLanded) {
  var rp = a.reply, rk = a.replyMark, o = null, sliding = false;
  if (rp && !rp.played) {
    if (rp.tele && a.sol && a.sol[a.solIdx] === rp.uci) o = { rings: [{ sq: rp.from, kind: 'reply' }], arrows: [{ from: rp.from, to: rp.to, kind: 'reply', key: 'reply' }] };
  } else if (rk && sameMove(view.last, [rk.from, rk.to])) {
    sliding = sameMove(opts.anim, view.last);
    if (sliding) o = { rings: [{ sq: rk.from, kind: 'reply' }], arrows: [{ from: rk.from, to: rk.to, kind: 'reply', key: 'reply' }] };
    else if (!noLanded) {
      o = { arrows: [{ from: rk.from, to: rk.to, kind: 'reply', key: 'reply', solid: true }] };
      if (rk.token) { o.tokens = [{ sq: rk.token.sq, p: rk.token.p, kind: colorW(rk.token.p) === myPov(a.it) ? 'lost' : 'won', fx: rk.fx }]; if (!opts.fx) opts.fx = rk.fx; }
    }
  }
  if (!o) return false;
  for (var k in o) opts[k] = (opts[k] || []).concat(o[k]);
  return sliding;
}
/* the board's aria-label (S20), built from the marks of the frame as
   drawn: who is to move, then each mark in words ("Red arrow: your game
   move, bishop c1 to f4. Dashed red arrow: the pawn on e5 can take on
   f4."). It names only what is on the board, so before an answer it never
   names the answer (2.3 keeps every mark but the game arrow and the move
   just played off its square, and a verdict badge is named without its
   square). The forcing reply is named once it has landed (its solid
   arrow), not while it is telegraphed or slides. Selection, legal dots
   and the grey outline of a tap are left out */
var ARIA_BADGE = { good: 'Green tick: your move.', bad: 'Red cross: your move is not it.', close: 'Ring with a tick: a good move, not the best.',
  checking: 'Grey dots: your move is being checked.', unchecked: 'Question mark: your move could not be checked.', info: 'Grey i: the answer, played.' };
function boardAria(a, st, o) {
  var side = function (w) { return w ? 'White' : 'Black'; }, b = st.b;
  var pw = function (sq, alt) { var p = b[sq] || (alt != null ? b[alt] : null); return p ? PIECE_WORD[pType(p)] : 'piece'; };
  var mv = function (m) { return pw(m.from, m.to) + ' ' + sqName(m.from) + ' to ' + sqName(m.to); };
  var out = [side(st.w) + ' to move.'], arrows = [];
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better' });
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  arrows = arrows.concat(o.arrows || []);
  var ringed = {};
  arrows.forEach(function (m) {
    if (m.kind === 'game') out.push('Red arrow: your game move, ' + mv(m) + '.');
    else if (m.kind === 'threat') {
      ringed[m.from] = 1;
      /* read on the board as drawn, its piece to move; hint 1's danger is
         the reply your game move allowed, so it is read on the card's
         position after that move (S0's pair holds on its own board) */
      var hint = m.key === 'hint';
      /* both tries' danger (F1.3): what their reply did after each try */
      if (m.key === 'tries') {
        var tp = st.b[m.from], tq = cloneState(st), td = null;
        if (tp) { tq.w = colorW(tp); tq.ep = -1; td = moveDoes(tq, m.from, m.to); }
        out.push('Dashed red arrow: after both your tries, the ' + (tp ? PIECE_WORD[pType(tp)] : 'piece') + ' on ' + sqName(m.from) + ' could ' + (td && td.mate ? 'give checkmate on ' : st.b[m.to] ? 'take on ' : 'go to ') + sqName(m.to) + '.');
        return;
      }
      var pos = cloneState(hint ? a.pre : st), gm = hint ? uciToMove(pos, a.playedUci) : null;
      if (gm) applyMove(pos, gm);
      var ap = pos.b[m.from], d = null;
      if (ap) { pos.w = colorW(ap); pos.ep = -1; d = moveDoes(pos, m.from, m.to); }
      var verb = d && d.took ? 'take on ' : d && d.check ? 'give check on ' : 'go to ';
      out.push('Dashed red arrow: ' + (hint ? 'after your game move, ' : '') + 'the ' + (ap ? PIECE_WORD[pType(ap)] : 'piece') + ' on ' + sqName(m.from) + (hint ? ' could ' : ' can ') + verb + sqName(m.to) + '.');
    }
    else if (m.kind === 'reply' && m.solid) out.push('Blue arrow: ' + side(!myPov(a.it)) + '\'s reply, ' + mv(m) + '.');
    else if (m.kind === 'better') out.push('Green arrow: ' + (m.key === 'answer' ? 'the answer, ' : 'the better move, ') + mv(m) + '.');
    else if (m.kind === 'explore') out.push('Gold arrow: ' + (a.tier === 1 ? 'the computer\'s pick, ' : 'Stockfish\'s pick, ') + mv(m) + '.');
  });
  (o.hint != null ? [{ sq: o.hint, kind: 'hint' }] : []).concat(o.rings || []).forEach(function (r) {
    if (r.kind === 'threat' && !ringed[r.sq]) out.push('Red ring: the ' + pw(r.sq) + ' on ' + sqName(r.sq) + ' punishes it.');
    else if (r.kind === 'attacked') out.push(r.mate ? 'Red ring: they could checkmate on ' + sqName(r.sq) + '.' : b[r.sq] && isW(b[r.sq]) === myPov(a.it) ? 'Red ring: your ' + pw(r.sq) + ' on ' + sqName(r.sq) + ' is in danger.' : 'Red ring: ' + sqName(r.sq) + ', where your piece would be in danger.');
    else if (r.kind === 'hint') out.push('Gold ring: move the ' + pw(r.sq) + ' on ' + sqName(r.sq) + '.');
    else if (r.kind === 'block') out.push('Gold ring: your ' + pw(r.sq) + ' on ' + sqName(r.sq) + ' blocks their mate.');
    else if (r.kind === 'target') out.push('Dashed gold ring: the ' + pw(r.sq) + ' on ' + sqName(r.sq) + ' is there to win.');
  });
  /* after a forcing line, S0's tokens stand for what the line changed: it
     is read whole, what you took and what they took (final fixes 3) */
  var took = function (xs, w) { return xs.map(function (x) { return w + PIECE_WORD[pType(x.p)] + ' on ' + sqName(x.sq); }); };
  var and = function (xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  if (o.lineTakes) {
    var lt = o.lineTakes;
    out.push('Along the line you took ' + and(took(lt.won, 'a ')) + (lt.lost.length ? '; they took ' + and(took(lt.lost, 'your ')) : '') + '.');
  }
  (o.tokens || []).forEach(function (t) {
    if (o.lineTakes && t.s0) return;
    out.push(t.could ? 'They could have taken your ' + PIECE_WORD[pType(t.p)] + ' on ' + sqName(t.sq) + '.'
      : t.kind === 'lost' ? 'Your ' + PIECE_WORD[pType(t.p)] + ' was taken on ' + sqName(t.sq) + '.' : 'You won a ' + PIECE_WORD[pType(t.p)] + ' on ' + sqName(t.sq) + '.');
  });
  (o.ghosts || []).forEach(function (g, i, gs) {
    if (g.rook) return;
    /* castling: the rook that went with the king, where it is drawn */
    var rk = gs[i + 1] && gs[i + 1].rook && !b[gs[i + 1].sq] ? gs[i + 1] : null;
    out.push((b[g.sq] ? 'Red cross on ' : 'Faded ' + PIECE_WORD[pType(g.p)] + ' on ') + sqName(g.sq) + (rk ? ' and faded rook on ' + sqName(rk.sq) : '') + ': where your game move went.');
  });
  (o.guards || []).forEach(function (g) { out.push('Green dots: the ' + pw(g.from) + ' on ' + sqName(g.from) + ' guards ' + sqName(g.to) + '.'); });
  /* a move tried already: its line, or (when it went to the answer's
     square) only the cross on the square it left, never naming where it went */
  (o.tried || []).forEach(function (t) {
    if (t.sq != null) out.push('Red cross: a move of the ' + pw(t.sq) + ' on ' + sqName(t.sq) + ' was tried already.');
    else out.push('Faint red line: you tried ' + mv(t) + ' already.');
  });
  (o.badges || []).forEach(function (g) { if (ARIA_BADGE[g.kind]) out.push(ARIA_BADGE[g.kind]); });
  if (o.check != null) out.push('The ' + (isW(b[o.check]) ? 'white' : 'black') + ' king is in check.');
  return out.join(' ');
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
    /* where the badge really sits there (pulled in on an edge square, badgeXY) */
    var c0 = [q[0] - 22.5, q[1] - 22.5], at = badgeXY(c0, spots[i]), bx = at[0] - q[0], by = at[1] - q[1], clear = true;
    for (var s = 0; s <= 40 && clear; s++) {
      var px = ux * (tip + s) - bx, py = uy * (tip + s) - by, half = s < 21 ? 10.5 * s / 21 : 3.7;
      if (Math.sqrt(px * px + py * py) < 8.6 + half) clear = false;
    }
    if (clear) return spots[i];
  }
  return spots[0];
}
/* a token sits at its square's bottom-left (2.1) unless an arrow's head
   comes into that square there, or the square's badge sits beside it: then
   in the first corner clear of both (bottom-right, top-left, top-right),
   smaller and tucked into that corner, so token, tick and arrow head never
   pile up on the piece that took, and that piece stays in view. Sets t.at,
   [x, y, radius] from the square's corner, when it moves */
var TOKEN_AT = [[12.5, 32.5, 12.5], [35, 35, 10], [10, 10, 10], [35, 10, 10]];
function tokenSpots(opts) {
  if (!opts.tokens || !opts.tokens.length) return;
  var flip = !!opts.flip, arrows = [];
  if (opts.ghost) arrows.push({ from: opts.ghost[0], to: opts.ghost[1] });
  if (opts.good) arrows.push({ from: opts.good[0], to: opts.good[1] });
  if (opts.bad) arrows.push({ from: opts.bad[0], to: opts.bad[1] });
  arrows = arrows.concat(opts.arrows || []);
  opts.tokens.forEach(function (t) {
    var heads = arrows.filter(function (ar) { return ar.to === t.sq && ar.from !== ar.to; });
    var bd = (opts.badges || []).filter(function (b) { return b.sq === t.sq; })[0], bat = bd ? bd.at || [36, 9] : null;
    if (!heads.length && !bat) return;
    for (var i = 0; i < TOKEN_AT.length; i++) {
      var at = TOKEN_AT[i];
      /* the token's disc and the badge's halo (9.8) apart */
      if (bat && Math.sqrt(Math.pow(at[0] - bat[0], 2) + Math.pow(at[1] - bat[1], 2)) < at[2] + BADGE_HALO) continue;
      if (heads.every(function (ar) { return headClear(ar.from, ar.to, flip, at, at[2]); })) { if (i) t.at = at; return; }
    }
  });
}
/* a disc of radius r at `at` (from the corner of the arrow's last square)
   stays clear of the arrow's head and the end of its shaft, as markArrow
   draws them (the same reading badgeCorner makes for a badge) */
function headClear(from, to, flip, at, r) {
  var xy = function (sq) { return [(flip ? 7 - sq % 8 : sq % 8) * 45 + 22.5, (flip ? sq >> 3 : 7 - (sq >> 3)) * 45 + 22.5]; };
  var p = xy(from), q = xy(to), dx = p[0] - q[0], dy = p[1] - q[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / len, uy = dy / len, tip = 45 * (len < 45 * 1.6 ? 0.22 : 0.34) - 6.3, bx = at[0] - 22.5, by = at[1] - 22.5;
  for (var s = 0; s <= 40; s++) {
    var px = ux * (tip + s) - bx, py = uy * (tip + s) - by, half = s < 21 ? 10.5 * s / 21 : 3.7;
    if (Math.sqrt(px * px + py * py) < r + half) return false;
  }
  return true;
}
/* ── labels: one pill a frame, beside the mark it names ───────────────────
   The pill's size: its words measured in the font the page draws them in
   (the tag size, 12 px 800, on a board under 500 px; the small size, 14 px
   700, above: Nunito or whatever stands in for it), plus 14 px of padding,
   the 1 px border and 2 px to spare, 18 or 20 px tall. Measured once per
   text and size, again when a font arrives; where nothing can measure (no
   canvas), a table wide enough for Georgia's bold: 7.4 px a character and
   4 to spare at 12 px, 8.7 and 5 at 14 */
var labelW = {}, labelCtx = null;
function labelMeasure(text, fs) {
  var k = fs + '|' + text;
  if (k in labelW) return labelW[k];
  var w = null;
  try {
    if (labelCtx == null) {
      var cv = document.createElement('canvas');
      labelCtx = (cv && cv.getContext && cv.getContext('2d')) || false;
      if (labelCtx && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { labelW = {}; });
    }
    if (labelCtx) {
      var fam = window.getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'Georgia, serif';
      labelCtx.font = (fs < 14 ? '800 ' : '700 ') + fs + 'px ' + fam;
      w = labelCtx.measureText(text).width;
    }
  } catch (e) { w = null; }
  if (!(w > 0)) w = null;
  return (labelW[k] = w);
}
function labelBox(text, desk) {
  var t = String(text || ''), n = t.length, fs = desk ? 14 : 12, m = labelMeasure(t, fs);
  var w = m != null ? m + 18 : desk ? n * 8.7 + 21 : n * 7.4 + 20;
  return { w: Math.ceil(w), h: desk ? 20 : 18 };
}
/* what a label must keep clear of, in px on a board px wide, as drawn
   (flipped or not): the squares holding pieces (and ghosts), each flagged
   when an arrow starts or ends there; badges, tokens, rings, crosses and
   legal dots as boxes; arrow shafts and heads, guard dots, tried lines and
   drawn shapes as thick segments (their stroke and halo, plus 4 px each
   side); avoid, squares no label may touch (the answer's square before an
   answer, 2.3). head, tail: the cells (column, row on screen) the label
   sits beside; soft: pieces it may cover (a first-sight label, one) */
function labelGeom(f, px, c, avoid) {
  var o = f.opts, flip = !!o.flip, s = px / 360, Q = 45 * s;
  var cell = function (sq) { return [flip ? 7 - sq % 8 : sq % 8, flip ? sq >> 3 : 7 - (sq >> 3)]; };
  var ctr = function (sq) { var k = cell(sq); return [(k[0] + 0.5) * Q, (k[1] + 0.5) * Q]; };
  var sqBox = function (sq) { var k = cell(sq); return { x: k[0] * Q, y: k[1] * Q, w: Q, h: Q }; };
  var disc = function (cx, cy, r) { return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }; };
  var g = { size: px, sq: Q, boxes: [], segs: [], pieces: [], head: cell(c.head), tail: c.tail != null ? cell(c.tail) : null, soft: c.tip ? 1 : 0 };
  var arrows = [];
  if (o.ghost) arrows.push({ from: o.ghost[0], to: o.ghost[1], kind: 'explore' });
  if (o.good) arrows.push({ from: o.good[0], to: o.good[1], kind: 'better' });
  if (o.bad) arrows.push({ from: o.bad[0], to: o.bad[1], kind: 'game' });
  arrows = arrows.concat(o.arrows || []);
  var ends = {}, heads = {};
  arrows.forEach(function (ar) { ends[ar.from] = ends[ar.to] = 1; });
  for (var sq = 0; sq < 64; sq++) if (f.st.b[sq]) { var pb = sqBox(sq); pb.end = !!ends[sq]; g.pieces.push(pb); }
  /* arrows as markArrow draws them: the shaft to its inset end, the head
     4.2 strokes long and wide around that end (a shy one stops short) */
  arrows.forEach(function (ar) {
    var w = (MARK_ARROW[ar.kind] || MARK_ARROW.game).w, a0 = ctr(ar.from), b0 = ctr(ar.to);
    var dx = b0[0] - a0[0], dy = b0[1] - a0[1], len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
    var inset = Q * (heads[ar.to] ? 0.58 : len < Q * 1.6 ? 0.22 : 0.34), ex = b0[0] - ux * inset, ey = b0[1] - uy * inset;
    heads[ar.to] = 1;
    g.segs.push({ x1: a0[0], y1: a0[1], x2: ex, y2: ey, r: (w + 2.4) / 2 * s + 4 });
    g.segs.push({ x1: ex - ux * 2.94 * w * s, y1: ey - uy * 2.94 * w * s, x2: ex + ux * 1.26 * w * s, y2: ey + uy * 1.26 * w * s, r: 2.1 * w * s + 4 });
  });
  (o.ghosts || []).forEach(function (gh) { var k = cell(gh.sq); g.pieces.push(sqBox(gh.sq)); if (!gh.rook) g.boxes.push(disc((k[0] * 45 + 37.5) * s, (k[1] * 45 + 7.5) * s, 7 * s)); });
  (o.badges || []).forEach(function (bd) { var k = cell(bd.sq), xy = badgeXY([k[0] * 45, k[1] * 45], bd.at); g.boxes.push(disc(xy[0] * s, xy[1] * s, BADGE_HALO * s)); });
  (o.tokens || []).forEach(function (tk) { var k = cell(tk.sq), at = tk.at || TOKEN_AT[0]; g.boxes.push(disc((k[0] * 45 + at[0]) * s, (k[1] * 45 + at[1]) * s, (at[2] + 1.2) * s)); });
  (o.hint != null ? [{ sq: o.hint }] : []).concat(o.rings || []).forEach(function (rg) { var m = ctr(rg.sq); g.boxes.push(disc(m[0], m[1], 23.25 * s)); });
  (o.guards || []).forEach(function (gd) { var a0 = ctr(gd.from), b0 = ctr(gd.to); g.segs.push({ x1: a0[0], y1: a0[1], x2: b0[0], y2: b0[1], r: 3.5 * s + 4 }); });
  (o.tried || []).forEach(function (t) {
    var b0 = ctr(t.sq != null ? t.sq : t.to);
    if (t.sq == null) { var a0 = ctr(t.from); g.segs.push({ x1: a0[0], y1: a0[1], x2: b0[0], y2: b0[1], r: s + 4 }); }
    g.boxes.push(disc(b0[0], b0[1], 7 * s));
  });
  (o.dots || []).forEach(function (d) { var m = ctr(d); g.boxes.push(f.st.b[d] ? sqBox(d) : disc(m[0], m[1], 5.5 * s)); });
  (o.shapes || []).forEach(function (sh) {
    if (sh.at != null) g.boxes.push(sqBox(sh.at));
    else { var a0 = ctr(sh.from), b0 = ctr(sh.to); g.segs.push({ x1: a0[0], y1: a0[1], x2: b0[0], y2: b0[1], r: 3.5 * s + 4 + 6 * s }); }
  });
  (avoid || []).forEach(function (q) { g.boxes.push(sqBox(q)); });
  return g;
}
/* where a w x h label goes (pure): beside the arrow's
   head (or the marked square), its 8 neighbours nearest first, then the 8
   of the tail; in each neighbour centred on it, then flush with its left
   edge, then its right (a pill is often wider than a square). The first
   place that stays on the board and clear of every piece, badge, token,
   ring and shaft wins. A first-sight label may cover one piece that no
   arrow starts or ends on, but only where no place is clear of them all;
   {x, y} in px, or null: no room, no label */
var LABEL_NEAR = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
function placeLabel(geom, w, h) {
  /* a touch of half a board unit is no overlap, at any board size */
  var S = geom.size, Q = geom.sq, E = 0.5 * Math.min(1, S / 360);
  var hit = function (r, b) { return r.x < b.x + b.w - E && b.x < r.x + r.w - E && r.y < b.y + b.h - E && b.y < r.y + r.h - E; };
  var clear = function (r, soft) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > S || r.y + r.h > S) return false;
    var i, n = 0;
    for (i = 0; i < geom.boxes.length; i++) if (hit(r, geom.boxes[i])) return false;
    for (i = 0; i < geom.segs.length; i++) if (segRectDist(geom.segs[i], r) < geom.segs[i].r) return false;
    for (i = 0; i < geom.pieces.length; i++) if (hit(r, geom.pieces[i]) && (geom.pieces[i].end || ++n > soft)) return false;
    return true;
  };
  var at = [geom.head, geom.tail], passes = geom.soft ? [0, geom.soft] : [0];
  for (var p = 0; p < passes.length; p++)
    for (var j = 0; j < at.length; j++) {
      if (!at[j]) continue;
      for (var k = 0; k < LABEL_NEAR.length; k++) {
        var cx = at[j][0] + LABEL_NEAR[k][0], cy = at[j][1] + LABEL_NEAR[k][1];
        if (cx < 0 || cx > 7 || cy < 0 || cy > 7) continue;
        var xs = [(cx + 0.5) * Q - w / 2, cx * Q, (cx + 1) * Q - w];
        for (var x = 0; x < xs.length; x++) {
          var r = { x: xs[x], y: (cy + 0.5) * Q - h / 2, w: w, h: h };
          if (clear(r, passes[p])) return { x: r.x, y: r.y };
        }
      }
    }
  return null;
}
/* the distance from a segment to a rectangle (0 when they meet) */
function segRectDist(sg, r) {
  var x1 = sg.x1, y1 = sg.y1, x2 = sg.x2, y2 = sg.y2;
  var inR = function (x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; };
  if (inR(x1, y1) || inR(x2, y2)) return 0;
  var ptSeg = function (px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  };
  var cross = function (ax, ay, bx, by, cx, cy, dx, dy) {
    var d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (!d) return false;
    var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  var c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], best = Infinity;
  for (var i = 0; i < 4; i++) {
    var p = c[i], q = c[(i + 1) % 4];
    if (cross(x1, y1, x2, y2, p[0], p[1], q[0], q[1])) return 0;
    best = Math.min(best, ptSeg(p[0], p[1], x1, y1, x2, y2), ptSeg(x1, y1, p[0], p[1], q[0], q[1]), ptSeg(x2, y2, p[0], p[1], q[0], q[1]));
  }
  return best;
}
/* the label a frame shows on a board px wide, or null: the first of
   labelCands that fits the words left (labelRoom) and finds a place; before
   an answer never on the answer's square (2.3; labelCands names the green
   arrow only once answered). seen(kind): that kind has taught itself already (tipSeen by
   default). {text, role, tip, mark, x, y, w, h} */
function frameLabel(a, f, px, desk, seen) {
  var cands = labelCands(a, f, seen || tipSeen(a));
  if (!cands.length) return null;
  var room = labelRoom(a), pre = ['guess', 'checking', 'tried', 'reply'].indexOf(a.phase) >= 0, due = pre ? dueMove(a) : null;
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i], texts = c.alt ? [c.text, c.alt] : [c.text];
    for (var j = 0; j < texts.length; j++) {
      if (wordsIn(texts[j]) > room) continue;
      var sz = labelBox(texts[j], desk), at = placeLabel(labelGeom(f, px, c, due ? [due.to] : []), sz.w, sz.h);
      if (at) return { text: texts[j], role: c.role, tip: c.tip, mark: c.mark, x: at.x, y: at.y, w: sz.w, h: sz.h };
    }
  }
  return null;
}
/* first sight (2.1): a kind is seen once its label has shown, kept as
   nl:tip:<kind> (in memory only, so once a page load, when storage is
   off). Within the state it first showed in, it still counts as unseen, so
   a repaint there (a selection, the words' beat) keeps the same label */
var tipHeld = {};
function tipKey(a) { return a.key + '|' + cardStateKey(a); }
function tipSeen(a) {
  var k = tipKey(a);
  return function (kind) { return tipHeld[kind] !== k && !!store.get('nl:tip:' + kind, 0); };
}
/* the label as markup in .blabels (aria-hidden: the band says it), and a
   first-sight label noted seen once it is on screen */
function labelHtml(lb, fresh) {
  return lb ? '<span class="blabel bl-' + lb.role + (fresh ? ' fx-in' : '') + '" style="left:' + Math.round(lb.x) + 'px;top:' + Math.round(lb.y) + 'px;width:' + lb.w + 'px;height:' + lb.h + 'px">' + esc(lb.text) + '</span>' : '';
}
/* a label fades in when it first shows, never again on a repaint of the
   same label (a selection, the words' beat) */
function labelFresh(a, lb) {
  var sig = lb ? lb.text + '|' + lb.mark.kind + '|' + (lb.mark.sq != null ? lb.mark.sq : lb.mark.from + '-' + lb.mark.to) : '';
  var fresh = !!lb && a.labelSig !== sig;
  a.labelSig = sig;
  return fresh;
}
function labelShown(a, lb) {
  if (!lb || !lb.tip || tipHeld[lb.tip] === tipKey(a)) return;
  tipHeld[lb.tip] = tipKey(a);
  store.set('nl:tip:' + lb.tip, 1);
}
function boardPx(bw) { return (bw && bw.clientWidth) || 360; }
/* the larger label on a board of 500 px or more (the stylesheet's
   container query on #bwrap says the same) */
function deskLabels(bw) { return boardPx(bw) >= 500; }
/* the label over the board as it is now: after a resize, or when the words
   beside it change (a word for a tap takes the label's room for a while) */
function paintLabels(a, f) {
  var bw = el('bwrap'), box = bw && bw.querySelector('.blabels');
  if (!box || !a) return;
  var lb = frameLabel(a, f || boardOptsFor(a), boardPx(bw), deskLabels(bw)), fresh = labelFresh(a, lb), was = box.nlHtml;
  if (!fresh && was != null && lb && was.replace(' fx-in', '') === labelHtml(lb)) { labelShown(a, lb); return; }
  setHtml(box, labelHtml(lb, fresh));
  labelShown(a, lb);
}
/* S0's marks (S6, V+700) on the settled board st: the game move's ghost
   with its cross, where it went (on a forcing line only when that square is
   empty, and never on the square of the tick, whose badge it would meet);
   the threat it ran into, the game line's first reply ringed with its dashed
   arrow, when that reply captures or checks, its piece still stands there,
   the card is not a missed chance and the threat still holds on this board
   (s0ThreatHolds); after a forcing line, green tokens on what you won (at
   most two) */
function s0Marks(a, st) {
  var out = { ghosts: [], rings: [], arrows: [], tokens: [] }, c = a.cls, pl = a.played, mm = a.markMove;
  var line = !!(a.sol && a.solIdx > 1);
  if (pl && !(mm && mm.to === pl.to) && (!line || !st.b[pl.to])) out.ghosts = gameGhosts(a, a.key + ':s0');
  var th = familyOf(patternOf(a.it.b)).key !== 'chances' ? threatOf(c.gameLine, 1) : null;
  if (th && st.b[th.from] && st.b[th.from] === c.gameLine.nodes[1].before.b[th.from] && s0ThreatHolds(a, st, th)) {
    out.rings.push({ sq: th.from, kind: 'threat' });
    out.arrows.push({ from: th.from, to: th.to, kind: 'threat', key: 'threat' });
  }
  /* never over a piece of theirs that took back on that square: the token
     would seem to name that piece (the band and the board's name say the
     whole line) */
  if (line) (a.won || []).filter(function (w) { return !(st.b[w.sq] && colorW(st.b[w.sq]) !== myPov(a.it)); }).slice(-2).forEach(function (w) {
    out.tokens.push({ sq: w.sq, p: w.p, kind: 'won', fx: a.key + ':s0', s0: true });
  });
  if (line && out.tokens.length) out.lineTakes = lineTakes(a);
  return out;
}
/* the game move's ghost: its piece where it went, with the cross; a
   castling game move shows the rook it moved too, where it went, with no
   cross of its own (C10) */
function gameGhosts(a, fx) {
  var pl = a.played, out = [{ sq: pl.to, p: a.pre.b[pl.from], fx: fx }];
  if (pl.castle) {
    var base = pl.to < 8 ? 0 : 56, short_ = pl.castle === 'O-O';
    out.push({ sq: base + (short_ ? 5 : 3), p: a.pre.b[base + (short_ ? 7 : 0)], fx: fx, rook: true });
  }
  return out;
}
/* what a forcing line changed hands up to the board on screen: {won,
   lost}, each [{sq, p}] in the line's order (noteWon, and their replies) */
function lineTakes(a) { return { won: a.won || [], lost: a.lineLost || [] }; }
/* the game line's threat still holds on S0's board (fresh-eyes T1), or it
   is not drawn there: a beginner reads it as "my right move still loses".
   It holds when it is their move, the move is legal on this board and it
   takes a piece of yours (or mates), and it wins material there: where the
   line that led to this board goes on (the best line, or your own move's),
   its next move is this one and that line loses material from here (or
   mates); on a board no line reaches, what it takes is unguarded or worth
   more than the piece taking it */
function s0ThreatHolds(a, st, th) {
  /* moveDoes finds their move only with them to move, and what it takes is yours */
  var d = moveDoes(st, th.from, th.to);
  if (!d || !(d.mate || d.took)) return false;
  var on = s0Line(a, st);
  if (on) return !!on.next && on.next.slice(0, 4) === sqName(th.from) + sqName(th.to) && (d.mate || bestLossFrom(a, on.j, on.line, on.settle) >= 1);
  return d.mate || d.free || MOTIF_VAL[pType(st.b[th.from])] < MOTIF_VAL[pType(d.took)];
}
/* the engine's line through board st: your own move's line when it worked
   too, else the card's best line, as {line, j (its node that ends on st),
   settle, next (its move from st, UCI, or null at its end)}; null when st
   is on neither */
function s0Line(a, st) {
  var own = !!(a.alt && a.yours), ucis = own ? a.yours.uci : unpackUci(a.it.b.lu), key = posKey(st);
  var line = own ? buildLine(a.pre, '0000', ucis, myPov(a.it)) : a.cls.bestLine;
  if (!line) return null;
  for (var j = 0; j < line.nodes.length; j++) {
    if (posKey(line.nodes[j].after) === key) return { line: line, j: j, settle: own ? settleIndex(line) : a.cls.bSettle, next: ucis[j] || null };
  }
  return null;
}
/* what lands with a story step (S12, 2.1): a capture's token, red when it
   took a piece of yours, green when yours took one; on G1 the reply it
   allows (S.threat), ringed with its dashed arrow; on B1 the better move's
   badge and tints (the tick; the grey i when the answer was shown, since
   the tick says you found it), then the guard dots when the guard rule
   holds, else the game move's ghost with its cross, never both */
function storyMarks(a, S, i) {
  var s = S.steps[i], n = s.line.nodes[s.k], out = {}, fx = a.key + ':st' + i;
  /* the danger frame (F1.5): its dashed red arrows and its rings */
  if (s.df) {
    if (s.df.rings.length) out.rings = s.df.rings.slice();
    if (s.df.arrows.length) out.arrows = s.df.arrows.slice();
    return out;
  }
  /* on the square the piece was taken from (en passant: beside the arrival) */
  if (n.captured) out.tokens = [{ sq: n.move.ep >= 0 ? n.move.ep : n.move.to, p: n.captured, kind: colorW(n.captured) === myPov(a.it) ? 'lost' : 'won', fx: fx }];
  /* the move they could have played took nothing in your game: read as such */
  if (out.tokens && S.could && s.seg === 'game' && s.k === 1) out.tokens[0].could = true;
  if (s.seg === 'game' && s.k === 0 && S.threat) {
    out.rings = [{ sq: S.threat.from, kind: 'threat' }];
    out.arrows = [{ from: S.threat.from, to: S.threat.to, kind: 'threat', key: 'threat' }];
  }
  if (s.seg === 'better' && s.k === s.from) {
    var bk = a.revealed ? 'info' : 'good';
    out.tints = [{ sq: n.move.from, kind: bk }, { sq: n.move.to, kind: bk }];
    out.badges = [{ sq: n.move.to, kind: bk, fx: fx }];
    if (S.guard) out.guards = [{ from: S.guard.from, to: S.guard.to }];
    else if (s.from === 1 && a.played.to !== n.move.to) out.ghosts = gameGhosts(a, fx);
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
  }
  var fade = f.fadeMs ? xfadeHtml(bw.innerHTML) : '';
  /* the position this card last drew, to tell a board change from a
     repaint of the same position (a selection, a mark, a verdict on a move
     already drawn); a card's first board is no change */
  var pos = stateFen(f.st), moved = a.drawnPos != null && a.drawnPos !== pos;
  a.drawnPos = pos;
  /* the label (2.1) after the marks svg, placed on the board as drawn */
  var lb = frameLabel(a, f, boardPx(bw), deskLabels(bw)), lh = labelHtml(lb, labelFresh(a, lb));
  bw.innerHTML = boardSvg(f.st, f.opts) + '<div class="blabels" aria-hidden="true">' + lh + '</div>' + (a.pendingPromo ? promoHtml(f.st) : '') + fade;
  var lbox = bw.querySelector && bw.querySelector('.blabels');
  if (lbox) lbox.nlHtml = lh;
  labelShown(a, lb);
  bw.classList.toggle('static', !f.live);
  var ms = f.slideMs || 0;
  /* a move the app shows sounds as its piece is let go (releaseAnims), or
     at once when it lands where it is drawn */
  releaseAnims(bw, ms, a.moveCue ? 'move' : null);
  a.moveCue = false;
  a.animMove = null;
  a.animSlow = false;
  a.jump = false;
  /* the badge and tints wait for the piece (the land beat), and the
     verdict's sound comes with them */
  a.landing = !!(ms && f.land);
  if (!ms && a.cue) { snd(a.cue); a.cue = null; }
  /* a jump: the old words fade out with the old board (text out, 2.2), and
     the new ones come with the text beat */
  if (fade) fadeOut(a);
  /* the bar: the player's view of the position, with no pawn number; still
     while it waits */
  var eb = el('ebar'), fill = el('ebar-fill'), fillH = el('ebar-fillh');
  if (eb) eb.classList.toggle('pending', f.pending);
  var evPct = f.pending ? null : winPct(evalWhite(it, f.ev != null ? f.ev : it.b.eb)) + '%';
  if (fill && evPct) fill.style.height = evPct;
  /* a phone draws it across, under the board (F4.1) */
  if (fillH && evPct) fillH.style.width = evPct;
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
  var old = html.slice(0, j + 6).replace(/ data-sq="\d+"/g, '').replace(/ class="anim-piece[^"]*"/g, '')
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
  /* the board's name follows its marks (S20) */
  var bsv = bw.querySelector('svg.board');
  if (bsv && bsv.getAttribute('aria-label') !== f.opts.label) bsv.setAttribute('aria-label', f.opts.label);
  paintLabels(a, f);
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
    /* the Coach Panel (F4.1): the board first, then one panel under it (beside
       it on a wide screen) with the band's words at its top and the strip at
       its foot, then the bar. The eval bar shows only while exploring: beside
       the board on a wide screen, under it on a phone (its own fill there) */
    box.innerHTML = '<div class="card">'
      + '<div class="card-top" id="ctop"></div>'
      + '<div class="board-col"><div class="board-row">'
        + '<div class="evalbar pending' + (flip ? ' flip' : '') + '" id="ebar"><i class="evalbar-fill" id="ebar-fill"></i><i class="evalbar-fill-h" id="ebar-fillh"></i><span class="evalbar-label" id="ebar-lab"></span></div>'
        + '<div class="board-wrap" id="bwrap"></div>'
      + '</div></div>'
      + '<div class="panel" id="cpanel"><div class="coach k-neutral" id="ccoach"><div class="band-slot" id="cband"></div><div class="strip" id="cstrip"></div></div>'
        + '<div class="acts-row sticky-acts" id="cbar"></div><p class="keyline" id="ckeys"></p></div>'
      + '</div>';
    watchBoardSize();
  }
  stage(beats || ['board', 'land', 'text']);
}
/* the label follows the board's size (a phone turned, a window resized):
   placed again in px, never while a piece slides (the next beat does it) */
var boardObs = null;
function watchBoardSize() {
  if (typeof ResizeObserver === 'undefined') return;
  if (boardObs) boardObs.disconnect();
  boardObs = new ResizeObserver(function () {
    var a = ui.session && ui.session.active;
    if (a && Date.now() >= motionUntil) paintLabels(a);
  });
  var bw = el('bwrap');
  if (bw) boardObs.observe(bw);
}
/* what the card says and offers, as data: the band (bandFor: disc, kind,
   row1, row2, chip, cap, and inside a forcing line its pips), the action
   bar as slots, the strip's markup and the live region's words */
function displayFor(a) {
  var b = bandFor(a), ss = ui.session, buttons = barSlots(a, ss);
  return { disc: b.disc || null, kind: b.kind || 'neutral', row1: b.row1 || '', row2: b.row2 || '', cap: b.cap || '', chip: b.chip || '', tag: b.tag || '', sweep: !!b.sweep, pips: b.pips || null,
           buttons: buttons, strip: stripHtml(a, ss), live: liveWords(a, b), keys: keyLine(a, buttons) };
}
/* the desktop key line under the panel (2.0): only the keys that do
   something in this state, as the keydown handler (15-shell.js) reads
   them. Enter presses the bar's or the strip's control that has the
   keyboard (foc: its label, reached by Tab or handed to it by the card), so
   the line names that one; with no control focused (a pointer's click
   hands focus back to the band, 15-shell.js) it is the honey button alone
   (F4.1), when there is one and it is on: none on a fresh card, so Enter
   there does nothing and never shows the answer; none while a move is
   checked, nor during a forcing reply but for its own button; any other
   control focused (foc.other): Enter presses that, so the line names no
   Enter. ? while a hint is left to give (over a try too: the try goes
   first); → plays See it on a wrong try, and opens See why from the
   settled result; ← → step the story (and
   Space steps it forward) or the exploration, where ← on its first move
   goes back to the lesson, as Esc does; Esc takes back a move being checked */
function keyLine(a, slots, foc) {
  var k = [], honey = honeyOf(slots), has = function (act) { return slots.filter(function (s) { return s.act === act && !s.off && !/nav-off/.test(s.cls || ''); })[0]; };
  if (foc && foc.label && (a.phase !== 'reply' || foc.act === 'theirReply')) k.push('Enter: ' + foc.label.replace(/ ›$/, ''));
  else if (!foc && honey && a.phase !== 'checking' && (a.phase !== 'reply' || honey.act === 'theirReply')) k.push('Enter: ' + honey.label.replace(/ ›$/, ''));
  if (a.phase === 'done' && a.explore) {
    if (a.explore.at === 0) { if (has('xpFwd')) k.push('→ step'); k.push('← or Esc: back to the lesson'); }
    else { k.push(has('xpFwd') ? '← → step' : '← step'); k.push('Esc: back to the lesson'); }
  } else if (a.phase === 'done' && a.view && a.view.mode === 'story') {
    k.push(has('storyFwd') ? '← → step · Space: next' : '← step');
    k.push('Esc: back');
  } else if (a.phase === 'done') {
    if (has('seeWhy')) k.push('→ see why');
  } else {
    if (a.phase === 'tried' && has('seeIt')) k.push('→ see it');
    if ((a.phase === 'guess' || a.phase === 'tried' || (a.phase === 'checking' && !a.checkSaid)) && a.hints < 2) k.push('? hint');
  }
  if (a.phase === 'checking') k.push('Esc: take back');
  return k.join(' · ');
}
/* the control that has the keyboard, as the key line reads it: a bar or
   strip control Enter would press ({act, label}), any other control
   ({other}), or null (nothing focused, the band's heading, a switched-off
   slot: Enter is the honey button, if the bar has one) */
function keyFocus() {
  var f = document.activeElement, act = f && f.getAttribute && f.getAttribute('data-act');
  if (!act || f.tagName === 'INPUT' || !f.closest) return null;
  if (f.closest('#cbar') || f.closest('#cstrip')) {
    /* its visible words; a lone arrow (‹) by its spoken name */
    var lab = String(f.textContent || '').replace(/\s+/g, ' ').trim();
    if (lab.replace(/[‹›\s]/g, '').length < 2) lab = f.getAttribute('aria-label') || lab;
    return lab && lab.length <= 24 ? { act: act, label: lab } : { other: true };
  }
  return { other: true };
}
/* the key line, painted with the words (the text beat) and again whenever
   the keyboard moves; between a change and the words that go with it the
   line is blank (keysStale), never the last state's keys (blankKeys) */
var keysStale = false;
function paintKeys(a) {
  var kl = el('ckeys');
  if (!kl || !a || keysStale) return;
  setHtml(kl, esc(keyLine(a, barSlots(a, ui.session), keyFocus())));
}
function blankKeys() {
  keysStale = true;
  setHtml(el('ckeys'), '');
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
  else if (a.focusRight && (a.phase === 'tried' || a.phase === 'reply') && barButton(rightSlot())) { a.focusRight = false; barButton(rightSlot()).focus({ preventScroll: true }); }
  /* a forcing reply's words: the keyboard on the bar goes to the band's
     "Your move", never to the button that took its slot */
  else if (a.focusTask && a.phase === 'guess' && lost && el('task-h')) el('task-h').focus({ preventScroll: true });
  /* exploring opens with the keyboard on its band's heading (S20): Enter
     is the honey button, Space plays nothing, a row takes a key only
     once Tab or a tap has put the focus there */
  else if (xe && xe.focusHead && el('result-h')) { xe.focusHead = false; el('result-h').focus({ preventScroll: true }); }
  else if (focKey && fp) {
    /* a bar button: the one now in its slot, or the honey one (S20, F4.1)
       when that slot is off or gone; never Show the answer taking the place
       of another button under the keyboard (Try again turning into it), so
       Enter never shows the answer unless the player went there */
    var slotNow = focSlot != null ? barButton(focSlot) : null;
    if (slotNow && slotNow.getAttribute('data-act') === 'reveal' && focKey.split('|')[0] !== 'reveal') slotNow = null;
    var back = focSlot != null ? slotNow || barButton(honeySlot()) || el('task-h')
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
    (back || (xe ? (fp.querySelector('#xp .xp-mv.on') || el('xp')) : barButton(honeySlot())) || el('task-h') || el('result-h') || fp).focus({ preventScroll: true });
  }
  a.focusTask = false;
  /* the keys once the keyboard has settled (2.0) */
  keysStale = false;
  paintKeys(a);
  paintLive(d);
  /* the label beside the new words: it goes first when they take its room,
     and a frame whose piece slid in gets its label now */
  paintLabels(a);
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
/* the band, the strip: each written only when its words changed. The
   Coach Panel around them takes the band's state (its 4 px edge and 10%
   tint, F4.1), with the words; a found verdict's first words bring the
   found pop (F4.4), once a card */
function paintBand(a, d) {
  var band = el('cband'), fresh = setHtml(band, bandHtml(a, d)), co = el('ccoach');
  var cls = 'coach k-' + d.kind + (d.cap ? ' cap' : '') + (a.phase === 'done' && a.explore ? ' exploring' : '');
  if (co && co.className !== cls) co.className = cls;
  if (fresh && foundMoment(a, d)) {
    a.rewarded = true;
    var disc = band.querySelector && band.querySelector('.bd-disc');
    if (disc && disc.classList) disc.classList.add(a.tier >= 3 ? 'fx-found3' : 'fx-found');
    reward('found', a);
  }
}
/* the found moment (F4.4): the verdict of a card found (first try, after
   help, or a move that works too), its first words on a board that is
   still (the text beat runs after the piece lands), once a card; never an
   answer shown, a hint, a wrong try, a forcing line's step or See why */
function foundMoment(a, d) {
  return !a.rewarded && a.phase === 'done' && !a.revealed && !a.explore && !!a.view && a.view.mode === 's0' && d.disc === 'good' && !d.cap;
}
/* the rewards given (F4.4), in order: { kind: found, learned or goal, key,
   at }. A test reads them: none during a hint, a wrong try or See why */
var rewardLog = [];
function reward(kind, a) {
  rewardLog.push({ kind: kind, key: a ? a.key : null, at: Date.now() });
  if (rewardLog.length > 50) rewardLog.shift();
}
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
/* a session over: its last words leave the live region, so the next
   session never starts with them (C11) */
function clearLive() {
  var live = el('sr-live');
  if (live && live.textContent) live.textContent = '';
}
/* the live region repeats the band for screen readers, once per change */
function paintLive(d) {
  var live = el('sr-live');
  if (!live) { live = document.createElement('div'); live.id = 'sr-live'; live.className = 'sr-live'; live.setAttribute('aria-live', 'polite'); live.setAttribute('data-clarity-mask', 'true'); document.body.appendChild(live); }
  if (live.textContent !== d.live) live.textContent = d.live;
}
/* the band: the words at the Coach Panel's top (F4.1). A 32 px disc, then
   row 1 (the heading the card focuses: the task before an answer, the
   result after) with a forcing line's pips at its right, row 2, and the
   tag row; or one caption (a story step) over the tag row's place */
function bandHtml(a, d) {
  /* a story step keeps the card's verdict disc beside its caption; the
     explorer's sentence stands alone (the live region says it) */
  /* a trade in the board's own pieces (ledgerHtml), its words for a screen reader */
  if (d.cap) return '<div class="card-task k-' + d.kind + ' cap"' + (d.disc ? '' : ' aria-hidden="true"') + '>' + discHtml(a, d.disc)
    + '<div class="bd-rows"><p class="bd-cap">' + ledgerHtml(d.cap) + '</p>' + tagRowHtml(d) + '</div></div>';
  return '<div class="card-task k-' + d.kind + (d.sweep ? ' sweep' : '') + '">' + discHtml(a, d.disc)
    + '<div class="bd-rows"><div class="bd-top"><h2 class="bd-r1" id="' + (a.phase === 'done' ? 'result-h' : 'task-h') + '" tabindex="-1">' + esc(d.row1) + '</h2>'
    + (d.pips ? pipsHtml(d.pips) : '') + '</div>'
    + '<p class="bd-r2">' + ledgerHtml(d.row2) + '</p>' + tagRowHtml(d) + '</div></div>';
}
/* the tag row (F4.2): one 24 px pill at most, in a place of its own that
   never moves: the band's chip (the relearn chip "One more try" in honey,
   a wrong try's check step in slate) or the context line on a decisive
   first sight ("Lost vs opponent1", neutral, never coral) */
function tagRowHtml(d) {
  var t = d.chip || d.tag, cls = !t ? '' : d.chip ? (d.chip === CARD_COPY.T3() ? 'tag-honey' : 'tag-slate') : 'tag-ctx';
  return '<div class="bd-tags">' + (t ? '<span class="tag ' + cls + '">' + esc(t) + '</span>' : '') + '</div>';
}
/* the forcing pips (2.0): a 7 px dot per move of yours, filled for each
   one found, ringed for the one due now; they repeat nothing the band does
   not say, so a screen reader skips them */
function pipsHtml(p) {
  var h = '<span class="bd-pips" aria-hidden="true">';
  for (var i = 0; i < p.n; i++) h += '<i class="pip' + (i < p.done ? ' done' : '') + (i === p.cur ? ' cur' : '') + '"></i>';
  return h + '</span>';
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
    /* the move they could have played is not your game (S.could) */
    return 'Step ' + (i + 1) + ' of ' + S.steps.length + ', ' + (S.steps[i].df ? 'before your game move.' : i < S.g ? (S.could && i === S.g - 1 ? 'what they could have played.' : 'your game.') : S.alt ? 'your move.' : 'the better move.') + ' ' + ledgerSay(b.cap);
  }
  return [LIVE_PREFIX[b.disc] || '', b.row1 || '', ledgerSay(b.row2 || '')].filter(Boolean).join(' ');
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
      /* at the trail's end › plays Stockfish's pick, and says so (S14; at
         tier 1 the computer's, as the band and sentence say), in the body
         size (the design lead's review of slice 3) */
      var xEnd = xe.at >= xe.nodes.length - 1;
      return [{ act: 'xpBack', label: '‹', cls: 'nav-btn', aria: xe.at === 0 ? 'Back to the lesson' : 'Back one move' },
              { act: 'xpFwd', label: xEnd ? (a.tier === 1 ? 'Computer\'s pick' : 'Stockfish\'s pick') : '›', cls: 'btn-line xp-fwd' + (fwdOff ? ' nav-off' : ''), aria: xEnd ? null : 'Forward one move' }, cont];
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
      return [{ act: 'next', label: cont.label, cls: 'btn-line' }, replyButton(a) || { act: 'playIt', label: 'Play it', cls: 'btn-big', off: a.showWait || !showDue(a) }];
    /* settled (S0): the story, and Continue in gold */
    return [{ act: 'seeWhy', label: 'See why', cls: 'btn-line' }, cont];
  }
  if (a.phase === 'tried') return triedSlots(a);
  /* a move being checked keeps the guess bar until the band says so (K1,
     300 ms after it lands), so a quick answer changes the bar once: Hint
     and Show the answer do nothing meanwhile, Esc or a tap on the moved
     piece still takes it back */
  if (a.phase === 'guess' || (a.phase === 'checking' && !a.checkSaid)) {
    /* Hint is named by the hint it gives next, and switched off when it
       has nothing left to give */
    return [{ act: 'hint', label: hintLabel(a), cls: 'btn-line', off: a.hints >= 2 },
            { act: 'reveal', label: 'Show the answer', cls: 'btn-line' }];
  }
  if (a.phase === 'checking') return [{ act: 'takeBack', label: 'Take back', cls: 'btn-line' }, { act: 'reveal', label: 'Show the answer', cls: 'btn-line', off: true }];
  /* their reply on its way (S10): the guess bar, switched off; under
     reduced motion the reply waits for its button, alone on the right */
  if (replyButton(a)) return [{ label: '', cls: 'slot-empty', off: true, empty: true }, replyButton(a)];
  return [{ act: 'hint', label: hintLabel(a), cls: 'btn-line', off: true }, { act: 'reveal', label: 'Show the answer', cls: 'btn-line', off: true }];
}
/* the honey button among the slots, the one Enter presses (F4.1): on, with
   an action; null when the bar has none (a fresh card) */
function honeyOf(slots) {
  return (slots || []).filter(function (s) { return !s.empty && !s.off && s.act && /\bbtn-big\b/.test(s.cls || '') && !/nav-off/.test(s.cls || ''); })[0] || null;
}
/* Hint is named by the hint it gives next: the worked example (S9), whose
   band says "Hint 1 of 2" from the start, reads "Hint 2" too */
function hintLabel(a) { return a.hints >= 2 ? 'No more hints' : a.hints ? 'Hint 2' : 'Hint'; }
/* "Their reply" (S10, S19): under reduced motion no timer moves a piece,
   so the forcing reply waits for this gold button; null when no reply waits */
function replyButton(a) {
  var rp = a.reply;
  return rp && !rp.played && reducedMotion() && a.sol && a.sol[a.solIdx] === rp.uci ? { act: 'theirReply', label: 'Their reply', cls: 'btn-big' } : null;
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
  if (t.kind === 'miss' && t.reply && !seen) left = { act: 'seeIt', label: 'See it', cls: 'btn-line' };
  else if (t.kind === 'unchecked' || a.misses >= 3) left = { act: 'reveal', label: 'Show the answer', cls: 'btn-line' };
  else if (a.hints >= 2) left = { act: 'hint', label: 'No more hints', cls: 'btn-line', off: true };
  else left = { act: 'hint', label: hintLabel(a), cls: 'btn-line' };
  return [left, { act: 'tryAgain', label: 'Try again', cls: 'btn-big' }];
}
/* a slot as a button: its place (data-slot) for the double-tap guard; a
   switched-off one has no action; an empty one keeps its place. Its icon
   (F3.1) is named by its action, on or off, and drawn by the stylesheet */
var BAR_ICON = { hint: 'bulb', reveal: 'eye', tryAgain: 'rotate', seeIt: 'play', seeWhy: 'play', playIt: 'play', theirReply: 'play', next: 'arrow' };
/* a lone chevron (‹ back, › forward) is drawn as its Lucide chevron, 22
   px; the glyph stays as the button's text, unseen, so it reads as before */
var NAV_ICON = { '‹': 'back', '›': 'fwd' };
function barHtml(slots) {
  return slots.map(function (s, i) {
    if (s.empty) return '<span class="slot-empty" data-slot="' + i + '" aria-hidden="true"></span>';
    var ic = NAV_ICON[s.label] || BAR_ICON[s.act];
    return '<a class="' + s.cls + (NAV_ICON[s.label] ? ' nav-ic' : '') + (s.off ? ' btn-off' : '') + '" data-slot="' + i + '"' + (ic ? ' data-icon="' + ic + '"' : '')
      + (s.off ? ' aria-disabled="true" tabindex="-1"' : ' data-act="' + s.act + '"' + (s.k != null ? ' data-k="' + esc(s.k) + '"' : ''))
      + (s.aria ? ' aria-label="' + esc(s.aria) + '"' : '') + '>' + esc(s.label) + '</a>';
  }).join('');
}
/* a slide only for the move the board shows as its last one */
function sameMove(x, y) { return !!(x && y && x[0] === y[0] && x[1] === y[1]); }
/* a sliding piece is drawn where it came from and let go two frames later,
   so its transition runs; motionUntil then runs from that moment (ms, the
   slide's length), in case those frames took longer than SLIDE_LEAD. A
   sound for the move (sound) plays as the piece is let go: at once when
   none slides, never for a board already gone */
var SLIDE_LEAD = 50;
function releaseAnims(root, ms, sound) {
  var ps = root.querySelectorAll('.anim-piece');
  if (!ps.length) { if (sound) snd(sound); return; }
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    for (var i = 0; i < ps.length; i++) ps[i].style.transform = 'translate(0px,0px)';
    if (sound && ps[0].isConnected) snd(sound);
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
    + '<span class="sr-only">Position ' + n + ' of ' + ss.keys.length + relearnWords(ss) + '</span>'
    + (a ? '<span class="card-menu"><a data-act="menu" aria-label="More" aria-expanded="' + !!a.menuOpen + '">•••</a>' + (a.menuOpen ? menuHtml(a) : '') + '</span>' : '');
}
/* the cards queued to come back, for the screen reader (once they come,
   they are counted in the positions) */
function relearnWords(ss) {
  var back = (ss.relearn || []).length;
  return back ? ', and ' + (back === 1 ? 'one position' : back + ' positions') + ' to try again' : '';
}
function dotsHtml(ss) {
  var seen = {}, out = '';
  ss.keys.forEach(function (k, i) {
    var relearn = ss.relearnOf && ss.relearnOf[k] && seen[k];
    seen[k] = 1;
    var r = relearn ? ss.results[k + '#r'] : ss.results[k];
    /* progress only: results are said in words on the recap */
    var cls = i === ss.idx && !ss.finished ? 'on' : (r ? 'done' : '');
    out += '<span class="dot ' + cls + (relearn ? ' relearn' : '') + '"></span>';
  });
  /* one more try still to come: its segment joins the bar as the card is
     queued, marked as a card coming back (S16, U7), so the bar growing
     says why */
  (ss.relearn || []).forEach(function () { out += '<span class="dot relearn"></span>'; });
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
    + '<a data-act="dispute" data-k="engine">Not a real mistake: I think ' + (a.tier === 1 ? 'the computer' : 'Stockfish') + ' is wrong</a>'
    + '<span class="sep"></span>'
    + (a.phase !== 'done' ? '<a data-act="skip">Skip this one</a>' : '<a data-act="details">Details</a>')
    /* exploring, on an answered card while the engine works (S14, S11);
       not while a shown line's reply is on its way, when a tap is input to
       the reply (S10) */
    + (xpOpen(a) && !a.reply ? '<a data-act="explore" data-k="menu">Try your own moves</a>' : '')
    /* the keys only where there is a keyboard to press them: never on a
       touch screen */
    + (!touchScreen() ? '<span class="menu-keys">↑ ↓: this menu · Enter: the main button · ?: hint · ← →: step · Esc: back to the lesson</span>' : '')
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
    if (a.phase === 'guess' || a.phase === 'tried') {
      var ex = typedExample(a.st, cardAvoid(a));
      return '<label class="kb-move">Type your move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false"' + (ex ? ' placeholder="e.g. ' + esc(ex) + '"' : '') + ' aria-label="Type your move"></label>';
    }
    return '';
  }
  if (a.explore) return xpHtml(a);
  if (a.view.mode === 'story') return storyStripHtml(a);
  /* the first card ever queued to come back says so, once (C1) */
  var tip = retryTipOn(a) ? '<p class="story-note retry-tip">' + RETRY_TIP + '</p>' : '';
  /* settled (S0): one link to everything else (S13), a 40 px chip */
  return tip + (a.view.mode === 's0' && a.settle >= 2 ? '<p class="details-row"><a class="strip-chip details-link" data-icon="info" data-act="details">Details</a></p>' : '');
}
/* the bar grows by a segment when a card is queued to come back (S16):
   on the first card ever queued (nl:tip:retry, on this device) the strip
   says why, on its answer shown and its settled result, where the words on
   screen leave it room (read on the settled frame, so it never comes and
   goes within one); it gives way to the band's own words, and is not said
   again on a later card */
var RETRY_TIP = 'This one comes back later.';
function retryTipOn(a) {
  if (!a.retryTip || a.phase !== 'done' || a.explore || !a.view || (a.view.mode !== 's0' && a.view.mode !== 'show')) return false;
  var v = Object.create(a), ss = ui.session;
  if (a.view.mode === 's0') v.settle = 2;
  return bandWords(bandFor(v), ss ? barSlots(v, ss) : []) + stripWords(v) + wordsIn(RETRY_TIP) <= WORD_BUDGET;
}
/* an example for the typed-move field (I5): a legal move of the position
   in both forms ("Nc3 or b1c3"), never one in avoid (the answer due, the
   game move: 2.3), a quiet piece move where there is one, else any legal
   move; '' with none */
function typedExample(st, avoid) {
  var rank = function (m) {
    var t = pType(st.b[m.from]), loud = st.b[m.to] || m.ep >= 0 || m.promo || m.castle;
    return (loud ? 10 : 0) + ({ N: 0, B: 1, R: 2, Q: 3, P: 4, K: 5 }[t] || 6);
  };
  var ms = legalMoves(st).filter(function (m) { return (avoid || []).indexOf(moveUci(m)) < 0; });
  ms.sort(function (x, y) { return rank(x) - rank(y) || x.from - y.from || x.to - y.to; });
  return ms[0] ? sanOf(st, ms[0]).replace(/[+#]$/, '') + ' or ' + moveUci(ms[0]) : '';
}
/* the moves an example must never be on a card still asking: the answer
   due (every move of a forcing line), the best move and the game move */
function cardAvoid(a) { return [a.bestUci, a.playedUci].concat(a.sol || []).filter(Boolean); }
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
/* Details says what the card face says, in longer words. The
   classifier's sentences name the pattern (the threat ignored, the fork
   allowed, the reply that takes), but count material by their own reckoning;
   every count here follows the card face's rules instead, and the
   classifier is left as it is.
   The mistake: each material loss the classifier states goes, and the card
   face's own claim (buildCompare, the lossClaim rule: standing there, in
   line with the score, more than the best line loses) is said in its words,
   "You could lose" when the opponent did not play into it. A sentence that
   is nothing but a count (the material pattern, a trapped piece) and whose
   claim does not stand says where the game went, as R4 does. A missed
   chance is about what the better move wins (its face never says what the
   game move lost) */
var LOSS_SAID = [/ You lose [^.]*\./, /: you lose [^.]*(?=\.$)/, /, and the pinned \w+ is lost(?=\.$)/];
function detailsGame(a) {
  var c = a.cls, b = a.it.b, s = c.sentences.game || '', cmp = buildCompare(a), g = c.gameLine;
  var w = familyOf(patternOf(b)).key === 'chances' ? '' : cmp.w;
  var played = sanOf(a.pre, a.played), loss = w ? (cmp.found ? 'You lose ' : 'You could lose ') + w + '.' : '';
  var trapped = c.t === 'hung' && / get trapped\.$/.test(s);
  if (c.t === 'material' || trapped) {
    if (!w) return 'After ' + played + ', ' + (b.wa >= 60 ? 'you are still better' : b.wa >= 40 ? 'the game is even' : sidesOf(a).opp + (b.wa >= 20 ? ' is better' : ' is winning'))
      + ' (' + Math.round(b.wb) + '% to ' + Math.round(b.wa) + '%).';
    if (trapped) return s + (w === 'the ' + /your (\w+) get trapped/.exec(s)[1] ? '' : ' ' + loss);
    /* the line to where the claim is counted, as the classifier shows one */
    var last = 0;
    for (var i = 1; i <= cmp.k && i < g.nodes.length; i++) if (g.nodes[i].captured) last = i;
    var shown = Math.min(Math.max(last, 1), 4);
    return played + (cmp.found ? ' loses ' : ' could lose ') + w + (g.nodes[1] ? ' after ' + lineSans(g, shown).join(' ') + (last > shown ? ' and more' : '') : '') + '.';
  }
  /* a capture the classifier says as "is lost" is the reply that takes */
  s = s.replace(/, but the (\w+) is lost to (\S+)\.$/, ', but $2 takes your $1.');
  LOSS_SAID.forEach(function (re) { s = s.replace(re, ''); });
  /* the claim, unless the sentence already says that one piece is taken */
  var one = /^the (\w+)$/.exec(w || '');
  return s + (loss && !(one && new RegExp('your ' + one[1] + '\\b').test(s)) ? ' ' + loss : '');
}
/* the better move: its gain in the card face's words (the best line's own
   captures where it settles, as R4 and B1 say it), with the square when it
   is one piece; a safety claim ("keeps everything safe", "out of danger")
   only where the best line loses nothing itself (bestLossFrom), else only
   that it was the better move (184455333378:68: Qe6 still loses the
   bishop). Sentences about the game's balance or what a move stops stay */
var SAFE_CLAIM = /\bsafe\b|out of danger|keeps your position together/;
function detailsBest(a, s, best) {
  var c = a.cls, say = s.best || best + ' keeps your position together.', bl = c && c.bestLine;
  if (SAFE_CLAIM.test(say) && bl && !c.mateFor && bestLossFrom(a, 0) >= 1) return best + ' was the better move.';
  if (bl && / wins [^.]+\.$/.test(say)) {
    var won = c.matBest >= 1 ? plainCapture(bl, c.bSettle) || oneWord(null, c.matBest) : '', sq = wonSquare(bl, 1, c.bSettle, won);
    if (!won) return best + ' was the better move.';
    say = say.replace(/ (pins and )?wins [^.]+\.$/, function (x, pins) {
      return (pins && won !== 'the ' + PIECE_WORD[c.missed.pin.piece] ? ' pins the ' + PIECE_WORD[c.missed.pin.piece] + ' and' : pins ? ' pins and' : '') + ' wins ' + won + (sq ? ' on ' + sq : '') + '.';
    });
  }
  return say;
}
function detailsHtml() {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || !a.lines) return '';
  var it = a.it, b = it.b, s = a.cls.sentences, best = a.lines.best.san[0] || '', t = patternOf(b), info = patternInfo(t);
  var row = function (cls, text) { return '<p class="dt-line ' + cls + '"><span class="tl-dot" aria-hidden="true"></span><span>' + text + '</span></p>'; };
  /* the pattern is named once, by its chip (S13) */
  var h = '<div class="kicker">Details</div>' + ctxHtml(a);
  if (b.d) h += '<p class="stakes-tag"><span class="dot-bad" aria-hidden="true"></span>This move ' + decisiveWords(it.g, b) + '.</p>';
  var why = detailsGame(a);
  h += '<div class="dt-lines">' + row('tl-bad', esc(a.tier === 1 ? why.replace(/ \(\d+% to \d+%\)/g, '') : why))
    + (a.alt && a.lines.yours ? row('tl-alt', esc(altNames(a).mine) + ' also holds.') : '')
    + row('tl-good', esc(detailsBest(a, s, best)));
  var opp = opponentLine(a);
  if (opp) h += row('tl-opp', opp);
  /* their threat (F0.1's, as kept) and the clock (F2.5); where the check
     line is itself their threat (tier 3), it alone says it */
  var cl = checkLine(a), th = /^Their threat: /.test(cl) ? '' : threatLine(a), ck = clockLine(a);
  h += '</div>' + (th ? '<p class="dt-more">' + esc(th) + '</p>' : '') + (ck ? '<p class="dt-more dt-clock">' + esc(ck) + '</p>' : '')
    + '<div class="tag-row"><a class="pchip" data-act="sheet" data-k="pattern:' + t + '">' + esc(info.name) + ' ›</a>'
    + '<span class="when">' + scheduleWords(a.rec || srsRec(it), a) + '</span></div>'
    + '<p class="habit">' + esc(cl) + '</p>';
  /* no engine, no exploring */
  if (SF.state !== 'failed') h += '<div class="acts-row sheet-acts"><a class="btn-line" data-act="explore">Try your own moves with Stockfish ›</a></div>';
  return h;
}
/* the exploration (S14): the trail with the way back, Stockfish's
   sentence, and its three best moves at the position on screen */
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
    + '<div class="xp-head"><div class="xp-trail">' + trail + '</div><a class="xp-back" data-act="exploreOff">Back to the lesson</a></div>'
    + '<p class="xp-say">' + esc(sayAt(a, ex, ex.at)) + '</p>';
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
    else for (var s2 = 0; s2 < 3; s2++) h += '<div class="xp-row skel" aria-hidden="true">' + (tier === 1 ? '' : '<span class="xp-chip">You 00%</span>') + '<span class="xp-first">00.Nxd3</span><span class="xp-cont">00.Ke2 Rd5</span></div>';
    h += '</div>';
  }
  h += '<label class="kb-move xp-kb">Type a move <input id="kbmove" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type a move"></label></div>';
  return h;
}
/* the engine in words, for Settings */
function engineLine() {
  var name = { 'sf17.1': 'Stockfish 17.1' }[SF.build] || 'Stockfish';
  return name + ' runs in this tab, on your device.';
}
/* rows that fit: never a half row above the phone bar or below the board */
var XP_ROW = 44, XP_ROW_MAX = 60;
function fitRows() {
  var a = ui.session && ui.session.active, ex = a && a.explore, rowsEl = document.querySelector('#xp .xp-rows');
  if (!ex || !rowsEl) return;
  var bar = document.querySelector('.done-acts'), board = document.querySelector('#bwrap .board');
  if (!bar || !board) return;
  var br = board.getBoundingClientRect(), k = 3, cap = document.querySelector('#xp .xp-cap'), rh = '';
  if (window.innerWidth <= 860) {
    /* on a phone the analysis fills the Coach Panel from under the band to
       the panel's foot (S14, F4.1): under the trail and the sentence, as
       many whole rows as fit (on a short phone the head tightens so one
       does; none if even that is too short, and the bar's Stockfish's pick
       still plays the gold arrow), the caption only when a row does not
       need its place, and what is left shared out among the rows, up to 60
       px each, so the rows end at the panel's foot */
    if (cap) cap.style.display = 'none';
    rowsEl.style.display = '';
    var xpEl = el('xp'), co = el('ccoach'), cr = co && co.getBoundingClientRect(), capH = 24;
    var barTop = cr && cr.height ? cr.bottom - 8 : bar.getBoundingClientRect().top;
    var roomOf = function () { return barTop - rowsEl.getBoundingClientRect().top; };
    xpEl.classList.remove('tight');
    var room = roomOf();
    /* no room for a row: the head gives up 16 px and the sentence its 4,
       kept where that makes a row fit, or where the sentence would
       otherwise run past the panel's foot */
    if (room < XP_ROW) {
      xpEl.classList.add('tight');
      var tightRoom = roomOf();
      if (tightRoom < XP_ROW && room >= 0) xpEl.classList.remove('tight'); else room = tightRoom;
    }
    k = Math.max(0, Math.min(3, Math.floor(room / XP_ROW)));
    var withCap = k > 0 && room - XP_ROW * k >= capH;
    if (withCap) room -= capH;
    if (cap) cap.style.display = withCap ? '' : 'none';
    rowsEl.style.display = k ? '' : 'none';
    if (k) rh = Math.min(XP_ROW_MAX, Math.floor(room / k)) + 'px';
  } else {
    if (cap) cap.style.display = '';
    rowsEl.style.display = '';
    el('xp').classList.remove('tight');
    /* tier 1 keeps its two rows beside the board */
    k = a.tier === 1 ? 2 : 3;
    rowsEl.className = 'xp-rows k' + k;
    while (k > 1 && bar.getBoundingClientRect().bottom > br.bottom + 1) { k--; rowsEl.className = 'xp-rows k' + k; }
  }
  ex.k = k;
  rowsEl.className = 'xp-rows k' + k;
  if (rowsEl.style.getPropertyValue('--xp-row') !== rh) { if (rh) rowsEl.style.setProperty('--xp-row', rh); else rowsEl.style.removeProperty('--xp-row'); }
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
/* Details' clock (F2.5): time, never haste; no clocks, no line. Tier 1
   "You took 20 seconds. You had 20 minutes left."; tier 2 "Rg1 took 20 s,
   with 20:15 left."; tier 3 adds the pace before this move, "Your pace:
   17 s a move.": (base + increment x (n - 1) - the clock before it) / (n -
   1), from the stored clock after the move (b.c) and its time (b.tt) */
function clockLine(a) {
  var b = a.it.b, g = a.it.g, tier = a.tier || 2;
  if (b.c == null || b.tt == null) return '';
  var took = Math.round(b.tt), left = Math.round(b.c), secs = function (x) { return x < 60 ? x + ' s' : clockWords(x); };
  if (tier === 1) return 'You took ' + spanWords(took) + '. You had ' + leftWords(left) + ' left.';
  var s = capSan(a.pre, a.played) + ' took ' + secs(took) + ', with ' + clockWords(left) + ' left.';
  var base = tcInitialSecs(g.tc), inc = parseFloat(String(g.tc || '').split('+')[1]) || 0, n = Math.floor(b.p / 2) + 1;
  if (tier >= 3 && base && n >= 2) {
    var pace = Math.round((base + inc * (n - 1) - (b.c + b.tt - inc)) / (n - 1));
    if (pace >= 1) s += ' Your pace: ' + secs(pace) + ' a move.';
  }
  return s;
}
/* a span of time in words at tier 1: "20 seconds", "1 minute 35 seconds" */
function spanWords(x) {
  if (x < 60) return plur(x, 'second');
  var m = Math.floor(x / 60), r = x % 60;
  return plur(m, 'minute') + (r && m < 10 ? ' ' + plur(r, 'second') : '');
}
/* the clock left in words at tier 1: "20 minutes", "45 seconds" */
function leftWords(x) {
  if (x < 60) return plur(x, 'second');
  if (x < 3600) return plur(Math.floor(x / 60), 'minute');
  var h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60);
  return plur(h, 'hour') + (m ? ' ' + plur(m, 'minute') : '');
}
/* their threat in Details (F2.5), only one the game move left standing (a
   threat it stopped is no danger): on a "their move" card the one tier 3's
   check line names (standingThreat); on another the threat the danger facts
   kept, while it stands, and beside a mate the game move allows only that
   mate. "Their threat: Rxf5 takes your queen." (tier 1 "Their threat: their
   rook takes your queen.") */
function threatLine(a) {
  var v = dangerView(a), th = v && v.searched ? v.threat : null, t = null;
  if (!v) return '';
  if (v.step === 1) t = standingThreat(a);
  else if (th && th.stands && (th.mate || !a.cls.mateAgainst)) {
    var nst = dzNullState(a.pre), m = uciToMove(nst, th.uci);
    if (m) t = { st: nst, m: m, took: th.took, mate: th.mate };
  }
  return t ? threatWords(t, a.tier || 2) : '';
}
/* the ladder in words, after the answer (F4.3): where the position stands
   and when it comes back, always the real interval to its due date: "Step
   2 of 3 · back in 16 days" (its run of clean finds, rungsOf), "Back to the
   start · back in 3 days" after a miss or the answer shown ("back
   tomorrow" for one day), "Learned · one last check in 87 days"; a
   position not yet on a step that fell nowhere is "Starting out" */
function scheduleWords(rec, a) {
  if (!rec) return '';
  if (isLearned(rec)) return rec.retired || rec.due == null ? 'Learned for good' : 'Learned · one last check ' + dueWhen(rec.due);
  var rung = rungsOf(rec), fell = !!a && (a.result === 'retry' || a.result === 'fail' || a.misses > 0 || !!a.revealed || (rec.lapses || 0) > 0);
  var head = rung > 0 ? 'Step ' + rung + ' of 3' : fell ? 'Back to the start' : 'Starting out';
  return rec.due == null ? head : head + ' · back ' + dueWhen(rec.due);
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
  /* the routine, at tiers 2 and 3 (F2.3) */
  if (playerTier() >= 2) h += '<p class="routine">' + ROUTINE_LINE + '</p>';
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
  /* a card's Details on a phone (F4.1): its top at the board's foot, so the
     board stays in view above it, unshaded (with 160 px or more under the
     board: an iPhone SE in Safari has 172; less, and it is the usual sheet);
     on a phone held sideways it takes the column beside the board */
  var bw = kind === 'details' && window.innerWidth <= 860 && el('bwrap'), br = bw && bw.getBoundingClientRect ? bw.getBoundingClientRect() : null;
  var side = !!br && window.innerWidth > window.innerHeight && window.innerHeight < 600;
  var atBoard = !!br && !side && br.bottom > 0 && window.innerHeight - br.bottom >= 160, atSide = side && br.right > 0 && window.innerWidth - br.right >= 280;
  ov.innerHTML = '<div class="scrim' + (atBoard ? ' at-board' : atSide ? ' at-side' : '') + '" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Details" tabindex="-1"'
    + (atBoard ? ' style="height:' + Math.floor(window.innerHeight - br.bottom) + 'px"' : atSide ? ' style="width:' + Math.floor(window.innerWidth - br.right - 8) + 'px"' : '') + '>'
    + '<a class="close" data-act="closeSheet" aria-label="Close">×</a>' + body + '</div></div>';
  document.documentElement.style.overflow = 'hidden';
  var sh = ov.querySelector('.sheet'), h3 = sh && sh.querySelector('h3');
  if (h3) { h3.id = 'sheet-title'; sh.removeAttribute('aria-label'); sh.setAttribute('aria-labelledby', 'sheet-title'); }
  if (sh) sh.focus({ preventScroll: true });
  if (sh && sh.addEventListener) swipeToClose(sh);
}
/* a sheet on a phone closes with a swipe down from its top (F4.1): it
   follows the finger while the sheet is scrolled to its top, and a pull of
   80 px or more closes it; less, and it settles back */
var SWIPE_CLOSE = 80;
function swipeToClose(sh) {
  var y0 = null, dy = 0;
  sh.addEventListener('touchstart', function (e) {
    y0 = sh.scrollTop > 0 || !e.touches || e.touches.length !== 1 ? null : e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sh.addEventListener('touchmove', function (e) {
    if (y0 == null || !e.touches) return;
    dy = sh.scrollTop > 0 ? 0 : Math.max(0, e.touches[0].clientY - y0);
    sh.style.transform = dy > 6 ? 'translateY(' + dy + 'px)' : '';
  }, { passive: true });
  var end = function () {
    if (y0 == null) return;
    y0 = null;
    if (dy >= SWIPE_CLOSE) { closeSheet(); return; }
    sh.style.transform = '';
  };
  sh.addEventListener('touchend', end);
  sh.addEventListener('touchcancel', end);
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
      + '<div class="habit-block"><div class="kicker">The check</div><div class="plan">' + esc(lineOfStep(familyStep(k), playerTier())) + '</div></div>'
      + '<div class="acts-row sheet-acts">' + (nDrill ? '<a class="btn-big" data-icon="play" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'family', fam: k, label: fam.name })) + '">Drill ' + plur(nDrill, 'position') + '</a>' : '')
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
      + '<div class="habit-block"><div class="kicker">The check</div><div class="plan">' + esc(lineOfStep(patternStep(k), playerTier())) + '</div></div>'
      + (s ? '<div class="acts-row sheet-acts"><a class="btn-big" data-icon="play" data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'pattern', key: k, label: info.plural })) + '">Drill ' + plur(Math.min(8, s.count), 'position') + '</a></div>' : '')
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
        /* one text: a chip is a flex box, and the space before a span would go */
        return chip('perf', p, upFirst(perfLabel(p)) + ' · ' + PERF_HINT[p], perfs.indexOf(p) !== -1);
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
      + '<p>' + gamesLine() + '</p>'
      + '<p>None of it is kept on our servers. Microsoft Clarity records clicks and the screen, with all text hidden, to show how the site is used.</p></div>'
    + '<div class="set-block"><span class="kicker">Reset</span>'
      + '<a data-act="resetProgress" class="danger-row' + (ui.resetArmed ? ' armed' : '') + '">' + (ui.resetArmed ? 'Tap again to reset your practice history' : 'Reset practice history') + '</a>'
      + '<a data-act="wipe" class="danger-row' + (ui.wipeArmed ? ' armed' : '') + '">' + (ui.wipeArmed ? 'Tap again to erase everything' : 'Erase everything') + '</a></div>';
}
/* what this browser holds, and what clearing it costs */
function gamesLine() {
  if (data.sections.games === 'loading') return 'Reading games…';
  var c = loadCachedGames();
  var a = c.fetchedAt ? ago(c.fetchedAt) : '', when = a === 'just now' ? a : /^\d+[mhd]$/.test(a) ? a + ' ago' : 'in ' + a;
  return 'Saved in this browser: ' + plur(data.games.length, 'game') + ' and your practice. Clearing browser data erases them.'
    + (a ? ' <span class="dim">Games checked ' + when + '.</span>' : '');
}

/* ── footer ──────────────────────────────────────────────────────────────── */
function renderFoot() {
  var f = el('foot');
  if (!f) return;
  f.innerHTML = '<span class="foot-line">Free and open source. Your games and progress are saved in this browser, not on our servers. Microsoft Clarity records clicks and the screen, with all text hidden, to show how the site is used.</span>'
    + '<span class="foot-links"><a data-act="coffee">Support the developer</a>'
    /* for lichess players only: a first visit plays nowhere yet */
    + (cfg.user && !isCC() ? '<a href="https://lichess.org/patron">Donate to lichess</a>' : '')
    + '<a href="https://github.com/thatsiavash/notlichess">Source</a></span>';
}

