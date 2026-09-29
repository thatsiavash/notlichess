/* ── Sessions: Today, drills, and the focus ─────────────────────────────────
   One container for every kind of practice. Today = reviews that are due
   plus a few new mistakes, sized to what the day can hold. A drill = up to
   8 positions of one pattern or one slice, blocked together. Either counts
   toward the day. A session survives a reload. */

function sessionSize() { return store.get('nl:sessionSize', 10); }
/* how deeply games are read: 'std' (the default) or 'thorough' */
function scanDepth() { return store.get('nl:scanDepth', 'std') === 'thorough' ? 'thorough' : 'std'; }
/* the scan's search per move: Thorough reads deeper once the first three
   positions are ready, so the first visit stays quick */
function scanNodes() {
  if (scanDepth() !== 'thorough') return TRIAGE_NODES;
  var ready = 0;
  try { ready = allMistakes().filter(trainable).length; } catch (e) { ready = 0; }
  return ready >= 3 ? 50000 : TRIAGE_NODES;
}
function sessKey() { return 'nl:sess:' + playerId(); }
function saveSession() {
  var ss = ui.session;
  if (!ss) { store.del(sessKey()); return; }
  store.set(sessKey(), { date: dayStamp(), mode: ss.mode, label: ss.label, keys: ss.keys, idx: ss.idx,
                         results: ss.results, relearn: ss.relearn || [], relearnOf: ss.relearnOf || {}, spec: ss.spec || null,
                         progress: ss.progress || {}, attempted: ss.attempted || 0, carried: ss.carried || 0, checks: ss.checks || 0, checksFound: ss.checksFound || 0, notes: ss.notes || {} });
}
/* a paused session that is dropped or replaced: a card left after a miss
   is graded a fail, and its tries still count toward the day */
function settleSaved(s) {
  if (!s) return;
  var m = model(), open = 0;
  Object.keys(s.progress || {}).forEach(function (k) {
    var p = s.progress[k], it = m.byKey[k];
    if (!it || !p || s.results[k] || (s.relearnOf && s.relearnOf[k])) return;
    if (p.a > 0) open++;
    if (p.m) srsRecord(it, 'fail', { attempted: p.a > 0, gameMove: !!p.g });
  });
  /* its tries wait for the next session the player finishes today */
  var d = dayLoad();
  d.carry = (d.carry || 0) + (s.attempted || 0) + (s.carried || 0) + open;
  daySave(d);
}
function savedSession() {
  var s = store.get(sessKey(), null);
  if (!s || s.date !== dayStamp() || !s.keys || s.idx >= s.keys.length) return null;
  return s;
}

/* how easy a card is to meet: a free capture or a mate in one is gentler
   than a quiet positional move (for the first session and for beginners) */
var easeMemo = {};
function cardEase(it) {
  var mk = it.key + '|' + (it.b.cv || 0) + '|' + (it.b.ru || '');
  if (easeMemo[mk] == null) easeMemo[mk] = cardEaseOf(it);
  return easeMemo[mk];
}
function cardEaseOf(it) {
  var t = patternOf(it.b), fam = familyOf(t).key;
  var bu = it.b.bu, pre = null, capture = false;
  if (bu) { pre = stateAtPly(it.g.mv, it.b.p); var m = pre && uciToMove(pre, bu); capture = !!(m && (pre.b[m.to] || m.ep >= 0)); }
  if (t === 'mateMissed' && it.b.mb === 1) return 3;
  if (t === 'missedMaterial' || (fam === 'safety' && t === 'hung')) return capture ? 3 : 2;
  /* "what can they take now?" is as easy to see as a free piece of theirs */
  if (fam === 'safety' && pre) {
    var post = cloneState(pre), pm = uciToMove(pre, uciOfSan(it.g.mv, it.b.p)), r0 = unpackUci(it.b.ru)[0];
    if (pm) { applyMove(post, pm); var rm = r0 && uciToMove(post, r0); if (rm && (post.b[rm.to] || rm.ep >= 0)) return 3; }
  }
  if (fam === 'chances' || fam === 'safety' || fam === 'king') return 2;
  return 1;
}
/* how much a card can teach: a named idea, not played in a scramble, in a
   position that was still alive, with a line that settles */
function teachability(it) {
  var b = it.b, t = patternOf(b), fam = familyOf(t).key, s = 1;
  if (fam === 'quiet') s *= playerTier() >= 3 ? 0.8 : 0.45;
  if (fam === 'conversion') s *= 0.8;
  if (timeTrouble(it)) s *= 0.6;
  if (b.wb > 92 || b.wb < 22) s *= 0.7;
  return s;
}
function newCardScore(it, since) {
  var s = teachability(it);
  if (it.b.d) s *= 1.7;                                   /* the move that lost the game */
  /* newer players: ideas one move deep first (a free capture, a cheaper
     piece taking a dearer one, mate in one) */
  if (playerTier() === 1 && cardEase(it) >= 3) s *= 1.8;
  if (since && it.g.ts > since) s *= 1.4;                 /* played since the last visit */
  var ageDays = (Date.now() - it.g.ts) / DAY;
  s *= 0.5 + Math.exp(-ageDays / 45);
  s *= 0.3 + Math.min(1, (it.b.wb - it.b.wa) / 60);
  return s;
}
/* candidates never seen before, best first */
function buildCandidates(n, spec) {
  var srs = srsLoad(), focus = currentFocus(), since = data.prevSeenFor === cfg.user ? data.prevSeen : 0;
  var filter = spec ? specFilter(spec) : null;
  /* Today deals positions with one idea: a quiet card where a second move is
     as good as the best stays for drills */
  var twoAnswers = function (it) { return !spec && it.b.g2 != null && it.b.g2 <= SOLVE_TOL && familyOf(patternOf(it.b)).key === 'quiet'; };
  var list = allMistakes().filter(function (it) {
    return trainable(it) && !srs[it.key] && (!filter || filter(it)) && !twoAnswers(it);
  });
  /* each score once: the ease check replays the game */
  var score = {};
  list.forEach(function (it) { score[it.key] = newCardScore(it, since); });
  list.sort(function (x, y) { return score[y.key] - score[x.key]; });
  if (spec || !focus) return list.slice(0, n);
  /* the focus family takes turns with the rest, never more than half: a
     mix trains the question "which danger is live now?" */
  var inF = function (it) { return familyOf(patternOf(it.b)).key === focus.fam; };
  var mine = list.filter(inF), rest = list.filter(function (it) { return !inF(it); }), out = [];
  var capF = Math.ceil(n / 2), fi = 0, ri = 0, takeF = mine.length && (!rest.length || newCardScore(mine[0], since) >= newCardScore(rest[0], since));
  while (out.length < n && (ri < rest.length || (fi < mine.length && fi < capF))) {
    if (takeF && fi < mine.length && fi < capF) out.push(mine[fi++]);
    else if (ri < rest.length) out.push(rest[ri++]);
    else if (fi < mine.length && fi < capF) out.push(mine[fi++]);
    takeF = !takeF;
  }
  return out;
}
function dueCards(spec) {
  var srs = srsLoad(), end = Date.now() + 12 * 3600 * 1000;
  var filter = spec ? specFilter(spec) : null;
  return allMistakes().filter(function (it) {
    var r = srs[it.key];
    return r && !r.hidden && r.due != null && r.due <= end && trainable(it) && (!filter || filter(it));
  }).sort(function (x, y) {
    /* most costly first, then the most overdue */
    var cx = (x.b.d ? 2 : 1) * teachability(x), cy = (y.b.d ? 2 : 1) * teachability(y);
    return cy - cx || srs[x.key].due - srs[y.key].due;
  });
}
function todayPlan() {
  var size = sessionSize(), day = dayLoad();
  var due = dueCards(), cap = size;
  /* new positions join a few at a time, in proportion to the session, so
     the reviews they create stay within what a day can hold */
  var perSession = Math.max(2, Math.round(size * 0.4)), dayCap = Math.max(8, Math.round(size * 0.8));
  var freshAllowed = Math.max(0, Math.min(dayCap - (day.fresh || 0), Math.max(1, Math.min(perSession, cap - due.length))));
  var total = 0;
  Object.keys(srsLoad()).forEach(function () { total++; });
  var firstTime = total < 3;
  if (firstTime) freshAllowed = Math.min(size, 5);
  var fresh = buildCandidates(freshAllowed + 6);
  if (firstTime) {
    fresh = fresh.concat(buildCandidates(60).filter(function (x) { return fresh.indexOf(x) === -1; }));
    fresh.sort(function (x, y) { return cardEase(y) - cardEase(x) || (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || y.g.ts - x.g.ts; });
    /* the first card of all is the move that lost the latest game, when it
       is not a quiet one */
    var lostLast = fresh.filter(function (it) { return it.b.d && it.g.res === 'loss'; })
      .sort(function (x, y) { return y.g.ts - x.g.ts; })[0];
    /* a hard one there: the easiest card leads instead, not an older loss */
    if (lostLast && cardEase(lostLast) >= 2) fresh = [lostLast].concat(fresh.filter(function (x) { return x !== lostLast; }));
  }
  /* a reserved slot: the best new mistake from games since the last visit */
  var since = data.prevSeenFor === cfg.user ? data.prevSeen : 0;
  if (since && !firstTime && freshAllowed > 0) {
    var newest = fresh.concat(buildCandidates(40)).filter(function (it) { return it.g.ts > since; })[0];
    if (newest) fresh = [newest].concat(fresh.filter(function (x) { return x !== newest; }));
  }
  fresh = fresh.slice(0, freshAllowed);
  var dueTake = due.slice(0, Math.max(0, size - fresh.length));
  /* the warm-up: the most familiar due card, or the gentlest new one */
  var keys = [];
  if (dueTake.length) {
    var srs = srsLoad();
    var warm = dueTake.slice().sort(function (x, y) { return (srs[y.key].streak || 0) - (srs[x.key].streak || 0); })[0];
    keys.push(warm.key);
    dueTake = dueTake.filter(function (x) { return x !== warm; });
  }
  /* interleave the rest */
  var di = 0, fi = 0;
  while (di < dueTake.length || fi < fresh.length) {
    if (fi < fresh.length && (keys.length % 3 === 1 || di >= dueTake.length)) keys.push(fresh[fi++].key);
    else if (di < dueTake.length) keys.push(dueTake[di++].key);
  }
  var decisiveNew = fresh.filter(function (x) { return x.b.d; }).length;
  return { keys: keys, due: due.length, dueTaken: dueTake.length + (keys.length > fresh.length + dueTake.length ? 1 : 0),
           fresh: fresh.length, decisive: decisiveNew, firstTime: firstTime };
}
function startSession(mode, keys, label, spec) {
  if (!keys.length) return false;
  var prev = savedSession();
  if (prev) {
    settleSaved(prev);
    if (sessionDoneCount(prev) > 0) notice('Your paused session is closed. Its answers are kept and its tries count toward today.');
  }
  var d0 = dayLoad(), carried = d0.carry || 0;
  if (carried) { d0.carry = 0; daySave(d0); }
  ui.session = { mode: mode, label: label, keys: keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, spec: spec || null, carried: carried };
  data.freshOnboard = false;
  saveSession();
  setView('train', false);
  pushSessionState();
  loadCard();
  track('session_start_' + mode);
  return true;
}
/* a session is a place in the history: Back ends it (and keeps every
   answer) instead of leaving the site */
function pushSessionState() {
  try { if (!(history.state && history.state.nlSession)) history.pushState({ nlSession: 1 }, '', location.pathname + '#train'); } catch (e) {}
}
function startToday() {
  var plan = todayPlan();
  if (!plan.keys.length) { notice('Nothing to practise yet. Your mistakes are still being found.'); return; }
  startSession('today', plan.keys, 'Today');
}
/* more practice: due reviews first, then new positions within the day's
   cap, so extra taps never pile up future reviews */
function morePracticeKeys() {
  var keys = dueCards().map(function (x) { return x.key; });
  var dayCap = Math.max(8, Math.round(sessionSize() * 0.8)), room = Math.max(0, dayCap - (dayLoad().fresh || 0));
  buildCandidates(Math.min(room, Math.max(0, 5 - keys.length))).forEach(function (x) { keys.push(x.key); });
  return keys;
}
function keepGoing() {
  var keys = morePracticeKeys();
  if (!keys.length) { notice('That is all for today. New positions join a few at a time, so tomorrow brings more.'); return; }
  startSession('more', keys.slice(0, 5), 'More practice');
}
function resumeSession() {
  var s = savedSession();
  if (!s) return false;
  ui.session = { mode: s.mode, label: s.label, keys: s.keys, idx: s.idx, results: s.results || {},
                 relearn: s.relearn || [], relearnOf: s.relearnOf || {}, spec: s.spec, progress: s.progress || {},
                 attempted: s.attempted || 0, carried: s.carried || 0, checks: s.checks || 0, checksFound: s.checksFound || 0, notes: s.notes || {} };
  setView('train', false);
  pushSessionState();
  /* a card answered before the reload is not asked again */
  var ss = ui.session, k = ss.keys[ss.idx];
  var again = ss.relearnOf[k] && ss.keys.indexOf(k) !== ss.idx;
  if (again ? ss.results[k + '#r'] : ss.results[k]) { nextCard(); return true; }
  loadCard();
  return true;
}
/* positions done and positions in all, one more try included, so the
   counts match the dots */
function sessionDoneCount(s) { return Object.keys(s.results || {}).length; }
function sessionTotal(s) { return s.keys.length + (s.relearn || []).length; }
function specFilter(spec) {
  return function (it) {
    var t = patternOf(it.b);
    switch (spec.type) {
      case 'family': return familyOf(t).key === spec.fam;
      case 'pattern': return t === spec.key;
      case 'colour': return it.g.color === spec.colour;
      case 'phase': {
        var mv = Math.floor(it.b.p / 2) + 1;
        return spec.phase === 'open' ? mv <= 12 : (spec.phase === 'mid' ? mv > 12 && mv <= 35 : mv > 35);
      }
      case 'clock': return timeTrouble(it);
      case 'opening': return it.g.color === spec.colour && openingFamily(it.g) === spec.family && it.b.p < 30;
      case 'game': return it.g.id === spec.id;
      case 'one': return it.key === spec.key;
      default: return true;
    }
  };
}
function drillItems(spec, n) {
  var srs = srsLoad(), now = Date.now(), f = specFilter(spec);
  var list = allMistakes().filter(function (it) { return trainable(it) && f(it) && !(srs[it.key] && srs[it.key].hidden); });
  var band = function (it) {
    var r = srs[it.key];
    if (!r) return 1;
    if (r.due == null || r.due <= now) return 0;
    return isLearned(r) ? 3 : 2;
  };
  if (spec.type === 'game') {
    /* the move that decided the game first, then the rest in the order played */
    list.sort(function (x, y) { return (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || x.b.p - y.b.p; });
    return list.slice(0, n || 8);
  }
  list.sort(function (x, y) {
    return band(x) - band(y) || (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || teachability(y) - teachability(x) || y.g.ts - x.g.ts;
  });
  return list.slice(0, n || 8);
}
function startDrill(spec) {
  var items = drillItems(spec, 8);
  if (items.length < 1) {
    notice('No positions for this yet. More are found as Stockfish reads your games.');
    return;
  }
  closeSheet();
  startSession('drill', items.map(function (x) { return x.key; }), spec.label || 'Drill', spec);
}
function finishSession() {
  var ss = ui.session;
  if (!ss) return;
  ss.finished = true;
  ss.active = null;
  /* the day counts on real tries only (DAY_RULE) */
  var day = dayLoad(), tried = ss.attempted || 0, n = 0, seen = {};
  ss.keys.forEach(function (k) { if (!seen[k]) { seen[k] = 1; n++; } });
  /* this session's own tries, or with a closed session's, at least 3 */
  if ((tried >= 1 && tried >= Math.min(3, n)) || tried + (ss.carried || 0) >= 3) day.sessions = (day.sessions || 0) + 1;
  else day.short = 1;
  daySave(day);
  if (weekDays() >= goalThisWeek() && store.get('nl:goalSent:' + playerId(), 0) !== weeksAtGoal()) {
    store.set('nl:goalSent:' + playerId(), weeksAtGoal());
    track('week_goal_met');
  }
  store.del(sessKey());
  /* progress now matters: ask the browser not to clear this site's storage */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  snd('set');
  track('session_done_' + ss.mode);
  renderHeader();
  renderViews();
  renderTrain();
  window.scrollTo(0, 0);
  var rh = el('recap-h');
  if (rh) rh.focus({ preventScroll: true });
}
/* ending a session midway pauses it: every answer is kept, and Today
   offers to resume where it stopped */
function endSession(fromPop) {
  var ss = ui.session;
  if (!ss) return;
  if (ss.active && ss.active.explore) exploreExit('silent');
  var open = ss.active, done = sessionDoneCount(ss), total = sessionTotal(ss);
  /* a move still being checked counts as a try that did not land */
  if (open && open.phase === 'checking') { open.checkTok = ++checkSeq; open.phase = 'guess'; open.attempts = Math.max(open.attempts || 0, 1); }
  if (!ss.finished && open && open.phase !== 'done' && (open.misses || open.hints || open.attempts)) keepProgress(open);
  var keep = !ss.finished && (done > 0 || (open && (open.misses || open.hints || open.attempts)));
  if (keep) saveSession(); else store.del(sessKey());
  ui.session = null;
  if (!fromPop && history.state && history.state.nlSession) { try { history.replaceState(null, '', location.pathname + '#train'); } catch (e) {} }
  renderViews();
  renderTrain();
  window.scrollTo(0, 0);
  if (keep) notice('Session paused. ' + done + ' of ' + total + ' done.', { act: 'resume', label: 'Resume' });
  makeFocusable(el('trainbox'));
  var st = document.querySelector('#trainbox .hero .btn-big, #trainbox .hero [data-act]');
  if (st) st.focus({ preventScroll: true });
}

/* ── the focus: one family at a time, held for at least a week ──────────── */
/* The focus is a function, never a record: the family that decided the most
   games, shown only on good evidence, 60 games of the window read (or all
   of them) and a lead over the second family that is not noise
   (L - R >= 1.645 sqrt(L + R), games decided, draws half). Today and
   Insights both ask this one function. */
function currentFocus() {
  var fams = insightFamiliesQuick().filter(function (x) { return x.count - x.learned >= 3; });
  if (!fams.length) return null;
  var lead = fams[0], L = lead.cost, R = fams[1] ? fams[1].cost : 0;
  var n = analysisNumbers();
  var readDone = n.total > 0 && n.covered >= n.total && !n.working;
  if (!(readDone || n.covered >= 60)) return null;
  if (!(L >= 5 && L - R >= 1.645 * Math.sqrt(L + R))) return null;
  return { fam: lead.fam.key };
}
function insightFamiliesQuick() {
  var stats = patternStats();
  return FAMILIES.map(function (f) {
    var ps = stats.filter(function (s) { return f.types.indexOf(s.key) !== -1; });
    var agg = { fam: f, count: 0, cost: 0, pts: 0, learned: 0 };
    ps.forEach(function (s) { agg.count += s.count; agg.cost += s.cost; agg.pts += s.pts; agg.learned += s.fixed; });
    return agg;
  }).filter(function (a) { return a.count > 0; }).sort(function (a, b) { return b.cost - a.cost || b.pts - a.pts; });
}

