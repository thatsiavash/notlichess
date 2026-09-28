/* ── Sessions: Today, drills, and the focus ─────────────────────────────────
   One container for every kind of practice. Today = reviews that are due
   plus a few new mistakes, sized to what the day can hold. A drill = up to
   8 positions of one pattern or one slice, blocked together. Either counts
   toward the day. A session survives a reload. */

function sessionSize() { return store.get('nl:sessionSize', 10); }
function sessKey() { return 'nl:sess:' + String(cfg.user).toLowerCase(); }
function saveSession() {
  var ss = ui.session;
  if (!ss) { store.del(sessKey()); return; }
  store.set(sessKey(), { date: dayStamp(), mode: ss.mode, label: ss.label, keys: ss.keys, idx: ss.idx,
                         results: ss.results, relearn: ss.relearn || [], relearnOf: ss.relearnOf || {}, spec: ss.spec || null,
                         progress: ss.progress || {} });
}
function savedSession() {
  var s = store.get(sessKey(), null);
  if (!s || s.date !== dayStamp() || !s.keys || s.idx >= s.keys.length) return null;
  return s;
}

/* how easy a card is to meet: a free capture or a mate in one is gentler
   than a quiet positional move (for the first session and for beginners) */
function cardEase(it) {
  var t = patternOf(it.b), fam = familyOf(t).key;
  var bu = it.b.bu, pre = null, capture = false;
  if (bu) { pre = stateAtPly(it.g.mv, it.b.p); var m = pre && uciToMove(pre, bu); capture = !!(m && (pre.b[m.to] || m.ep >= 0)); }
  if (t === 'mateMissed' && it.b.mb === 1) return 3;
  if (t === 'missedMaterial' || (fam === 'safety' && t === 'hung')) return capture ? 3 : 2;
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
function newCardScore(it, focusFam, since) {
  var s = teachability(it);
  if (it.b.d) s *= 1.7;                                   /* the move that lost the game */
  if (focusFam && familyOf(patternOf(it.b)).key === focusFam) s *= 1.5;
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
  var list = allMistakes().filter(function (it) {
    return trainable(it) && !srs[it.key] && (!filter || filter(it));
  });
  list.sort(function (x, y) {
    return newCardScore(y, focus && focus.fam, since) - newCardScore(x, focus && focus.fam, since);
  });
  return list.slice(0, n);
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
  if (firstTime) fresh.sort(function (x, y) { return cardEase(y) - cardEase(x); });
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
  ui.session = { mode: mode, label: label, keys: keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, spec: spec || null };
  data.freshOnboard = false;
  saveSession();
  setView('train', false);
  loadCard();
  track('session_start_' + mode);
  return true;
}
function startToday() {
  var plan = todayPlan();
  if (!plan.keys.length) { notice('Nothing to practise yet. Your mistakes are still being found.'); return; }
  startSession('today', plan.keys, 'Today');
}
function keepGoing() {
  var keys = dueCards().map(function (x) { return x.key; });
  buildCandidates(Math.max(0, 5 - keys.length)).forEach(function (x) { keys.push(x.key); });
  startSession('more', keys.slice(0, 5), 'More practice');
}
function resumeSession() {
  var s = savedSession();
  if (!s) return false;
  ui.session = { mode: s.mode, label: s.label, keys: s.keys, idx: s.idx, results: s.results || {},
                 relearn: s.relearn || [], relearnOf: s.relearnOf || {}, spec: s.spec, progress: s.progress || {} };
  setView('train', false);
  /* a card answered before the reload is not asked again */
  var ss = ui.session, k = ss.keys[ss.idx];
  var again = ss.relearnOf[k] && ss.keys.indexOf(k) !== ss.idx;
  if (again ? ss.results[k + '#r'] : ss.results[k]) { nextCard(); return true; }
  loadCard();
  return true;
}
function sessionDoneCount(s) {
  return Object.keys(s.results || {}).filter(function (k) { return k.indexOf('#r') < 0; }).length;
}
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
    /* one game reads best in the order it was played */
    list.sort(function (x, y) { return x.b.p - y.b.p; });
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
  var day = dayLoad();
  var answered = Object.keys(ss.results).filter(function (k) { return ss.results[k] !== 'skip'; }).length;
  if (answered >= 3) day.sessions = (day.sessions || 0) + 1;
  if (!dueCards().length) day.cleared = 1;
  daySave(day);
  store.del(sessKey());
  snd('set');
  track('session_done_' + ss.mode);
  renderHeader();
  renderTrain();
}
function endSession() {
  ui.session = null;
  store.del(sessKey());
  renderTrain();
}

/* ── the focus: one family at a time, held for at least a week ──────────── */
function focusKey() { return 'nl:focus2:' + String(cfg.user).toLowerCase(); }
function currentFocus() {
  var f = store.get(focusKey(), null), fams = insightFamiliesQuick();
  var valid = function (key) { return fams.some(function (x) { return x.fam.key === key && x.count - x.learned >= 3; }); };
  if (f && valid(f.fam) && (f.user || Date.now() - f.since < 7 * DAY)) return f;
  var pick = fams.filter(function (x) { return x.count - x.learned >= 3; })[0];
  if (!pick) return f && valid(f.fam) ? f : null;
  if (!f || f.fam !== pick.fam.key) {
    f = { fam: pick.fam.key, since: Date.now(), user: false };
    store.set(focusKey(), f);
  }
  return f;
}
function setFocus(fam) {
  store.set(focusKey(), { fam: fam, since: Date.now(), user: true });
  closeSheet();
  renderTrain();
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
/* this family's rate in real games since the focus began, against before */
function focusProgress(f) {
  if (!f) return null;
  var fam = FAMILIES.filter(function (x) { return x.key === f.fam; })[0];
  if (!fam) return null;
  var before = { m: 0, n: 0, g: 0 }, after = { m: 0, n: 0, g: 0 };
  coveredGames().forEach(function (g) {
    var bucket = g.ts >= f.since ? after : before;
    bucket.g++;
    bucket.n += ownMoves(g);
    gameMistakes(g).forEach(function (b) { if (fam.types.indexOf(patternOf(b)) !== -1) bucket.m++; });
  });
  return { before: before, after: after };
}

