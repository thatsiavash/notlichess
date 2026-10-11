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
                         progress: ss.progress || {}, attempted: ss.attempted || 0, carried: ss.carried || 0, notes: ss.notes || {}, sum: ss.sum || {}, firstTime: !!ss.firstTime, goalMet: ss.goalMet || null,
                         /* what a pack did to its skill (F9.4), for its end after a reload */
                         packUp: !!ss.packUp, packDown: !!ss.packDown, packMastered: ss.packMastered || null,
                         /* the positions that were reviews when the set began (V4.4's recall) */
                         rev: ss.rev || null });
}
/* a paused session that is dropped or replaced: a card left after a miss
   is graded a fail, and its tries still count toward the day */
function settleSaved(s) {
  if (!s) return;
  var open = 0;
  Object.keys(s.progress || {}).forEach(function (k) {
    var p = s.progress[k], it = itemOf(k);
    if (!it || !p || s.results[k] || (s.relearnOf && s.relearnOf[k])) return;
    if (p.a > 0) open++;
    /* a foil is never scheduled (F8.2), nor a practice position (F9.4):
       its tries count, nothing is graded */
    if (p.m && !it.foil && !it.prac) srsRecord(it, 'fail', { attempted: p.a > 0, gameMove: !!p.g });
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
/* a card that will ask for a forcing line (several moves in a row): the
   rule cardFor uses, read from the stored line without the classifier, so
   it may say yes to cards that turn out to ask for one move (about one
   for each card that really does), never no to one that asks for a line.
   Once per card and line, as the ease check: it replays the game, and the
   Today screen plans on many of its repaints */
var forcingMemo = {};
function looksForcing(it) {
  var mk = it.key + '|' + (it.b.lu || '') + '|' + it.b.mb + '|' + playerTier();
  if (forcingMemo[mk] == null) forcingMemo[mk] = looksForcingOf(it);
  return forcingMemo[mk];
}
function looksForcingOf(it) {
  var b = it.b, lu = unpackUci(b.lu);
  if (playerTier() < 2 || lu.length < 3) return false;
  if (b.mb != null && b.mb > 0) return true;
  var pre = stateAtPly(it.g.mv, b.p), m = pre && uciToMove(pre, lu[0]);
  if (!m) return false;
  var after = cloneState(pre);
  applyMove(after, m);
  return pre.b[m.to] != null || m.ep >= 0 || checkedKingSq(after) != null;
}
/* whether a card really asks for a forcing line: cardFor's own rule (the
   card built), asked only of cards looksForcing flags, and once per card
   and line */
var asksMemo = {};
function asksForcing(it) {
  if (!looksForcing(it)) return false;
  var mk = it.key + '|' + (it.b.lu || '') + '|' + (it.b.bu || '') + '|' + it.b.mb + '|' + playerTier();
  if (asksMemo[mk] == null) { var a = null; try { a = cardFor(it); } catch (e) {} asksMemo[mk] = !!(a && a.sol); }
  return asksMemo[mk];
}
/* a first session's head (section 4): card 1 asks for one move, and at
   most one of the first three asks for a forcing line. Reorders list (of
   cards or keys, isF telling a forcing one) from index from on, the ones
   before it already shown; looks at each candidate only until one fits */
function firstThree(list, isF, from) {
  from = from || 0;
  var head = list.slice(0, from), rest = list.slice(from);
  while (head.length < 3 && rest.length) {
    var oneIn = head.some(isF), pick = null;
    for (var i = 0; i < rest.length && !pick; i++) if (!((!head.length || oneIn) && isF(rest[i]))) pick = rest[i];
    pick = pick || rest[0];
    head.push(pick);
    rest.splice(rest.indexOf(pick), 1);
  }
  return head.concat(rest);
}
/* the same rule kept when a first session's card is taken out before it
   was shown (loadCard: the deeper look found no real mistake), since every
   later card then moves up a place */
function keepFirstThree(ss) {
  if (!ss || !ss.firstTime || ss.idx >= 3) return;
  ss.keys = firstThree(ss.keys, function (k) { var it = itemOf(k); return !!it && !it.foil && !it.prac && !it.lesson && asksForcing(it); }, ss.idx);
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
/* candidates never seen before, best first; fill: an extra set past the
   focus family's half when nothing else new is left (F7.1: practice only
   once no new own position remains); o: the planner's context on another
   day (todayPlan) */
function buildCandidates(n, spec, fill, o) {
  var srs = (o && o.srs) || srsLoad(), focus = currentFocus(), since = data.prevSeenFor === cfg.user ? data.prevSeen : 0;
  var filter = spec ? specFilter(spec) : null;
  /* Today deals positions with one idea: a quiet card where a second move is
     as good as the best stays for drills */
  var twoAnswers = function (it) { return !spec && it.b.g2 != null && it.b.g2 <= SOLVE_TOL && familyOf(patternOf(it.b)).key === 'quiet'; };
  /* never seen, or back in the queue (F7.1): those count as new */
  var list = allMistakes().filter(function (it) {
    var r = srs[it.key];
    return dealable(it) && (!r || (r.q && !r.hidden)) && (!filter || filter(it)) && !twoAnswers(it);
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
  while (fill && out.length < n && fi < mine.length) out.push(mine[fi++]);
  return out;
}
/* the positions due, the most valuable first: by the end of the next 12
   hours, now or, with o (todayPlan's context), at o.at in records o.srs */
function dueCards(spec, o) {
  var srs = (o && o.srs) || srsLoad(), end = ((o && o.at) || Date.now()) + 12 * 3600 * 1000;
  var filter = spec ? specFilter(spec) : null;
  return allMistakes().filter(function (it) {
    var r = srs[it.key];
    return r && !r.hidden && r.due != null && r.due <= end && dealable(it) && (!filter || filter(it));
  }).sort(valueOrder(srs));
}
/* the most valuable first (F7.1): a move that decided a game, then the
   focus family, then the longest wait */
function valueOrder(srs) {
  var f = currentFocus(), fam = f && f.fam;
  var inF = function (it) { return fam && familyOf(patternOf(it.b)).key === fam ? 1 : 0; };
  return function (x, y) { return (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || inF(y) - inF(x) || idealDue(srs[x.key]) - idealDue(srs[y.key]); };
}
/* a record's interval on the ladder, in days */
function ladderDays(r) { return r.learned ? SRS_DAYS[SRS_DAYS.length - 1] : SRS_DAYS[r.box || 0]; }
/* when a position was meant to come back: its due date, or, once spread
   to a later day, its last answer plus its interval, so a spread position
   keeps the wait it had */
function idealDue(r) { return r.sp && r.last ? r.last + ladderDays(r) * DAY : r.due; }
/* positions spread to a later day (F7.1), not yet answered: an extra set
   takes them after the due ones, graded as due */
function spreadCards() {
  var srs = srsLoad();
  return allMistakes().filter(function (it) {
    var r = srs[it.key];
    return r && r.sp && !r.hidden && r.due != null && dealable(it);
  }).sort(valueOrder(srs));
}

/* ── the extra-set rule (F7.1) ────────────────────────────────────────────
   Extra sets bring new positions with no daily limit, and the schedule
   absorbs the reviews they create. At the day's first opening, when more
   than one set is due: positions that decided no game, are not in the
   focus family and are overdue by more than twice their interval go back
   to the queue (no date, their history kept: they return as new when
   there is room); of the rest, the most valuable set's worth stays due and
   the others spread over the next 21 days, each onto the first day with
   room, no day above one set. Due here: by the end of the day, or within
   the 12 hours a set looks ahead, whichever is later */
var SPREAD_DAYS = 21;
/* local midnight of the day ms falls on, k days later (DST-safe) */
function dayStart(ms, k) { var d = new Date(ms); d.setHours(0, 0, 0, 0); if (k) d.setDate(d.getDate() + k); return d.getTime(); }
/* whole calendar days from the day of a to the day of b */
function daysFrom(a, b) { return Math.round((dayStart(b) - dayStart(a)) / DAY); }
/* what the day's first opening at time at would do, without doing it:
   { due, keep, queue, spread [{ it, day }], left (due for want of room) };
   srs0: the records to read (a copy, for a later day's set: planOn). A
   paused set keeps its positions out only today: it is gone by tomorrow */
function absorbPlan(at, srs0) {
  var srs = srs0 || srsLoad(), m = model(), size = sessionSize(), f = currentFocus(), fam = f && f.fam;
  var horizon = Math.max(dayStart(at, 1), at + 12 * 3600 * 1000), due = [], perDay = {};
  var paused = dayStamp(new Date(at)) === dayStamp() ? savedSession() : null, skip = {};
  if (paused) paused.keys.forEach(function (k) { skip[k] = 1; });
  Object.keys(srs).forEach(function (k) {
    var r = srs[k], it = m.byKey[k];
    if (!r || r.hidden || r.due == null || !it || !trainable(it)) return;
    if (r.due <= horizon) { if (!skip[k]) due.push(it); return; }
    var d = daysFrom(at, r.due);
    if (d <= SPREAD_DAYS) perDay[d] = (perDay[d] || 0) + 1;
  });
  var out = { due: due.length, keep: due, queue: [], spread: [], left: [] };
  if (due.length <= size) return out;
  var rest = [];
  due.sort(valueOrder(srs)).forEach(function (it) {
    var r = srs[it.key], low = !it.b.d && !(fam && familyOf(patternOf(it.b)).key === fam);
    if (low && daysFrom(idealDue(r), at) > 2 * ladderDays(r)) out.queue.push(it); else rest.push(it);
  });
  out.keep = rest.slice(0, size);
  rest.slice(size).forEach(function (it) {
    for (var d = 1; d <= SPREAD_DAYS; d++) {
      if ((perDay[d] || 0) < size) { perDay[d] = (perDay[d] || 0) + 1; out.spread.push({ it: it, day: d }); return; }
    }
    out.left.push(it);
  });
  return out;
}
function absorbKey() { return 'nl:absorb:' + playerId(); }
/* what today's first opening did: { d, due, sp, q, left }, or null */
function absorbToday() { var s = store.get(absorbKey(), null); return s && s.d === dayStamp() ? s : null; }
/* the day's first opening (Today drawn, a set started): the rule applied
   once a day, the opening logged and measured, and what it did said once
   (absorbWords) */
function absorbOpen() {
  if (!cfg.user || absorbToday()) return null;
  var now = Date.now(), od = overdueCount(), p = absorbPlan(now), srs = srsLoad(), prev = store.get(absorbKey(), null);
  p.queue.forEach(function (it) { var r = srs[it.key]; r.q = now; r.due = null; delete r.sp; });
  /* a spread position comes due at noon of its day: all that day */
  p.spread.forEach(function (x) { var r = srs[x.it.key]; r.sp = now; r.due = dayStart(now, x.day) + 12 * 3600 * 1000; });
  if (p.queue.length || p.spread.length) srsSave(srs);
  var s = { d: dayStamp(), due: p.due, sp: p.spread.length, q: p.queue.length, left: p.left.length };
  store.set(absorbKey(), s);
  logAdd({ e: 'o', due: s.due, kept: p.keep.length, sp: s.sp, q: s.q, left: s.left, od: od });
  /* measures (F0.7): how far behind the opening was, and a queue used */
  track('overdue_' + (od === 0 ? '0' : od < 10 ? '1_9' : od < 30 ? '10_29' : '30_plus'));
  if (s.q) track('queued');
  var say = absorbWords(s, !prev || daysFrom(stampTime(prev.d), now) >= 2);
  if (say) notice(say, null, 9000);
  return s;
}
/* "2026-10-9" (dayStamp) as noon of that day */
function stampTime(s) { var m = /^(\d+)-(\d+)-(\d+)$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0; }
/* the one-time notices (F7.2), each the first time it happens and on a
   return after a break (no opening the day before), never daily: line 2
   on Today says the day's spread: "13 reviews spread over the next 3
   weeks, so today stays at one set." and "8 older positions went back to
   your queue, to return later." */
function absorbWords(s, back) {
  var out = [], say = function (tip) { if (!back && store.get('nl:tip:' + tip, 0)) return false; store.set('nl:tip:' + tip, 1); return true; };
  if (s.sp && say('spread')) out.push(plur(s.sp, 'review') + ' spread over the next 3 weeks' + (s.left ? '.' : ', so today stays at one set.'));
  if (s.q && say('queue')) out.push(plur(s.q, 'older position') + ' went back to your queue, to return later.');
  return out.join(' ');
}
/* the day's own set: now, or as the planner will deal it on another day
   (o: { at, srs, day }: the time it is asked at, the records as they will
   stand then, that day's record), so a forecast is the set Today will deal
   (V4.1, planOn) */
function todayPlan(o) {
  o = o || {};
  var size = sessionSize(), day = o.day || dayLoad(), srs = o.srs || srsLoad();
  var due = dueCards(null, o), cap = size;
  /* new positions join a few at a time, in proportion to the session, so
     the reviews they create stay within what a day can hold; the slot kept
     for a new one only while fewer than a set's worth are due, so every due
     position that fits one set is in it (V4.1) */
  var perSession = Math.max(2, Math.round(size * 0.4)), dayCap = Math.max(8, Math.round(size * 0.8));
  var freshAllowed = due.length >= cap ? 0 : Math.max(0, Math.min(dayCap - (day.fresh || 0), Math.max(1, Math.min(perSession, cap - due.length))));
  var total = Object.keys(srs).length;
  var firstTime = total < 3;
  if (firstTime) freshAllowed = Math.min(size, 5);
  var fresh = buildCandidates(freshAllowed + 6, null, false, o);
  if (firstTime) {
    fresh = fresh.concat(buildCandidates(60, null, false, o).filter(function (x) { return fresh.indexOf(x) === -1; }));
    /* a first card asks for one move: forcing lines wait (each looked at once) */
    var forcing = {};
    fresh.forEach(function (it) { forcing[it.key] = looksForcing(it) ? 1 : 0; });
    fresh.sort(function (x, y) { return cardEase(y) - cardEase(x) || forcing[x.key] - forcing[y.key] || (y.b.d ? 1 : 0) - (x.b.d ? 1 : 0) || y.g.ts - x.g.ts; });
    /* the first card of all is the move that lost the latest game, when it
       is not a quiet one and asks for one move */
    var lostLast = fresh.filter(function (it) { return it.b.d && it.g.res === 'loss'; })
      .sort(function (x, y) { return y.g.ts - x.g.ts; })[0];
    /* a hard one there: the easiest card leads instead, not an older loss */
    if (lostLast && cardEase(lostLast) >= 2 && !forcing[lostLast.key]) fresh = [lostLast].concat(fresh.filter(function (x) { return x !== lostLast; }));
    /* card 1 is never a forcing line, and at most one of the first three
       is, by the card's own rule (a flagged card often asks for one move) */
    fresh = firstThree(fresh, asksForcing);
  }
  /* a reserved slot: the best new mistake from games since the last visit */
  var since = data.prevSeenFor === cfg.user ? data.prevSeen : 0;
  if (since && !firstTime && freshAllowed > 0) {
    var newest = fresh.concat(buildCandidates(40, null, false, o)).filter(function (it) { return it.g.ts > since; })[0];
    if (newest) fresh = [newest].concat(fresh.filter(function (x) { return x !== newest; }));
  }
  fresh = fresh.slice(0, freshAllowed);
  var dueTake = due.slice(0, Math.max(0, size - fresh.length));
  /* the warm-up: the most familiar due card, or the gentlest new one */
  var keys = [];
  if (dueTake.length) {
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
/* the set Today will deal d days on, as at noon that day, after that day's
   first opening (absorbPlan, its queue and spread applied to a copy of the
   records): the planner's own answer, so the summary's "Tomorrow" is the
   set the next day deals (V4.1); absorb: what that opening does */
function planOn(d) {
  var at = dayStart(Date.now(), d) + 12 * 3600 * 1000, srs = JSON.parse(JSON.stringify(srsLoad())), p = absorbPlan(at, srs);
  p.queue.forEach(function (it) { var r = srs[it.key]; r.q = at; r.due = null; delete r.sp; });
  p.spread.forEach(function (x) { var r = srs[x.it.key]; r.sp = at; r.due = dayStart(at, x.day) + 12 * 3600 * 1000; });
  var plan = todayPlan({ at: at, srs: srs, day: {} });
  plan.absorb = p;
  return plan;
}
/* opts.firstTime: a first session, whose head rule (section 4) the first
   card loaded already keeps */
function startSession(mode, keys, label, spec, opts) {
  if (!keys.length) return false;
  var prev = savedSession();
  if (prev) {
    settleSaved(prev);
    if (sessionDoneCount(prev) > 0) notice('Your paused set is closed. Its answers are kept and its tries count toward today.');
  }
  var d0 = dayLoad(), carried = d0.carry || 0;
  if (carried) { d0.carry = 0; daySave(d0); }
  /* one position opened from a summary goes back to that summary (I8) */
  var from = spec && spec.type === 'one' && ui.session && ui.session.finished ? ui.session : null;
  /* the sets of a day keep the size of the one played (a lesson is no
     position, F9.3) */
  if (mode === 'today' || mode === 'more') store.set('nl:setSize', keys.filter(function (k) { return !isLessonKey(k); }).length);
  ui.session = { mode: mode, label: label, keys: keys.slice(), idx: 0, results: {}, relearn: [], relearnOf: {}, spec: spec || null, carried: carried, rev: reviewKeys(keys) };
  if (from) ui.session.from = from;
  if (opts && opts.firstTime) ui.session.firstTime = true;
  data.freshOnboard = false;
  logSet(mode, keys);
  saveSession();
  setView('train', false);
  pushSessionState();
  loadCard();
  track('session_start_' + mode);
  return true;
}
/* the positions of a set that are reviews as it begins (V4.4: the recall
   after a break counts them): answered before and not back in the queue */
function reviewKeys(keys) {
  var srs = srsLoad(), out = {};
  keys.forEach(function (k) { var r = srs[k]; if (r && !r.q && !r.hidden && (r.n || 0) > 0) out[k] = 1; });
  return out;
}
/* one set started, in the practice log: what it holds (due; new, q of
   them back from the queue; spread, graded as due; practice, positions
   not due, whose dates never move later: F7.1; fo, foils: F8.2; pk,
   practice positions and lessons: F9.3, F9.4), how many positions are
   overdue and whether the day's load is healthy */
function logSet(mode, keys) {
  var srs = srsLoad(), end = Date.now() + 12 * 3600 * 1000, due = 0, fresh = 0, q = 0, sp = 0, fo = 0, pk = 0, seen = {}, n = 0;
  keys.forEach(function (k) {
    if (seen[k]) return;
    seen[k] = 1; n++;
    var r = srs[k];
    if (isPracKey(k) || isLessonKey(k)) pk++;
    else if (isFoilKey(k)) fo++;
    else if (!r || r.q) { fresh++; if (r) q++; }
    else if (r.sp) sp++;
    else if (r.due != null && r.due <= end) due++;
  });
  logAdd({ e: 's', mo: mode, n: n, due: due, new: fresh, q: q, sp: sp, fo: fo, pk: pk, pr: n - due - fresh - sp - fo - pk, od: overdueCount(), hl: healthyLoad() ? 1 : 0 });
}
/* the trainable positions whose day to come back was before today */
function overdueCount() {
  var srs = srsLoad(), m = model(), d0 = new Date(), n = 0;
  d0.setHours(0, 0, 0, 0);
  Object.keys(srs).forEach(function (k) {
    var r = srs[k], it = m.byKey[k];
    if (r && !r.hidden && r.due != null && r.due < d0.getTime() && it && trainable(it)) n++;
  });
  return n;
}
/* the day's load, healthy when today's new positions stay under
   max(8, 0.8 x set size), those due by the end of tomorrow under one set,
   those due in the next 14 days at most 0.8 x 14 x set size: a flag in
   the log only (extra sets never stop at it; the day's first opening
   absorbs the load, absorbOpen) */
function healthyLoad() {
  var size = sessionSize(), srs = srsLoad(), m = model(), now = Date.now(), d = new Date(), tom = 0, two = 0;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 2);
  Object.keys(srs).forEach(function (k) {
    var r = srs[k], it = m.byKey[k];
    if (!r || r.hidden || r.due == null || !it || !trainable(it)) return;
    if (r.due < d.getTime()) tom++;
    if (r.due <= now + 14 * DAY) two++;
  });
  return (dayLoad().fresh || 0) < Math.max(8, 0.8 * size) && tom < size && two <= 0.8 * 14 * size;
}
/* a session is a place in the history: Back ends it (and keeps every
   answer) instead of leaving the site */
function pushSessionState() {
  try { if (!(history.state && history.state.nlSession)) history.pushState({ nlSession: 1 }, '', location.pathname + '#train'); } catch (e) {}
}
function startToday() {
  absorbOpen();
  var plan = todayPlan();
  if (!plan.keys.length) { notice('Nothing to practise yet. Your mistakes are still being found.'); return; }
  /* its head rule is kept if a card drops out before it is shown, from the
     first card on; game-mode reviews bring their foils (F8.2); at More help
     a lesson and a mixed review join (F9.3, F9.4) */
  startSession('today', withPractice(withFoils(plan.keys, 'today'), 'today'), 'Today', null, { firstTime: !!plan.firstTime });
}
/* the next set: as big as the set just played (at least 5, at most the
   size chosen in Settings), as often as wanted (F7.1): positions due back
   first, the most valuable first; then those spread to a later day,
   graded as due; then new ones from the games, with no daily limit (the
   schedule absorbs them, absorbOpen); then, when none is left, practice
   that never moves a date (positions not due, the soonest first: a miss
   brings one back tomorrow, a clean find changes nothing). A position
   answered in the last few hours waits, so a set never repeats the one
   before it */
function nextSetSize() {
  var max = sessionSize();
  return Math.max(Math.min(5, max), Math.min(max, store.get('nl:setSize', max)));
}
function morePracticeKeys() {
  var size = nextSetSize(), srs = srsLoad(), now = Date.now(), recent = 3 * 3600 * 1000, keys = [];
  var add = function (it) { if (keys.length < size && keys.indexOf(it.key) < 0) keys.push(it.key); };
  dueCards().forEach(add);
  if (keys.length < size) spreadCards().forEach(add);
  if (keys.length < size) buildCandidates(size - keys.length, null, true).forEach(add);
  if (keys.length < size) {
    allMistakes().filter(function (it) {
      var r = srs[it.key];
      return r && !r.hidden && !r.q && dealable(it) && keys.indexOf(it.key) === -1 && !(r.last && now - r.last < recent);
    }).sort(function (x, y) {
      var dx = srs[x.key].due, dy = srs[y.key].due;
      return (dx == null ? Infinity : dx) - (dy == null ? Infinity : dy);
    }).forEach(add);
  }
  return keys;
}
function keepGoing() {
  absorbOpen();
  var keys = morePracticeKeys();
  if (!keys.length) { notice('You have practised every position from your games so far.'); return; }
  startSession('more', withPractice(withFoils(keys, 'more'), 'more'), 'Next set');
}
function resumeSession() {
  var s = savedSession();
  if (!s) return false;
  ui.session = { mode: s.mode, label: s.label, keys: s.keys, idx: s.idx, results: s.results || {},
                 relearn: s.relearn || [], relearnOf: s.relearnOf || {}, spec: s.spec, progress: s.progress || {},
                 attempted: s.attempted || 0, carried: s.carried || 0, notes: s.notes || {}, sum: s.sum || {}, firstTime: !!s.firstTime, goalMet: s.goalMet || null,
                 packUp: !!s.packUp, packDown: !!s.packDown, packMastered: s.packMastered || null, rev: s.rev || null };
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
/* where a set stands, counted on its own positions (V4.2: a set keeps its
   size, "3 of 5", never "of 8"): n, the place of the position on screen
   among them (every one, once the retries begin); all, the set's size (a
   lesson is no position, F9.3); retry, the place of the one more try on
   screen among the retries (0 within the set); retries, those come back or
   queued to */
function setPlace(s) {
  var seen = {}, all = 0, n = 0, r = 0, rn = 0, cur = s.finished ? -1 : s.idx;
  s.keys.forEach(function (k, i) {
    if (isLessonKey(k)) return;
    var again = !!seen[k] && !!(s.relearnOf && s.relearnOf[k]);
    seen[k] = 1;
    if (again) { rn++; if (i === cur) r = rn; }
    else { all++; if (i <= cur) n = all; }
  });
  return { n: r || s.finished ? all : n, all: all, retry: r, retries: rn + (s.relearn || []).length };
}
/* the same counts in words (C1): the positions the session started with,
   and apart from them the ones coming back for another try, so the count
   never seems to grow: "3 of 5 done, 2 to try again." */
function countsWords(s) {
  var seen = {}, first = 0, again = (s.relearn || []).length, done = 0, againDone = 0;
  /* a lesson is no position (F9.3) */
  s.keys.forEach(function (k) { if (isLessonKey(k)) return; if (seen[k]) again++; else { seen[k] = 1; first++; } });
  Object.keys(s.results || {}).forEach(function (k) { if (isLessonKey(k)) return; if (/#r$/.test(k)) againDone++; else done++; });
  var left = Math.max(0, again - againDone);
  return Math.min(done, first) + ' of ' + first + ' done' + (left ? ', ' + left + ' to try again' : '') + '.';
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
      /* how your games are decided (F10.3): after +2 in a game not won, after -2 in a game lost */
      case 'convert': case 'save': return decidedPosition(it, spec.type);
      case 'opening': return it.g.color === spec.colour && openingFamily(it.g) === spec.family && it.b.p < 30;
      case 'game': return it.g.id === spec.id;
      case 'one': return it.key === spec.key;
      default: return true;
    }
  };
}
function drillItems(spec, n) {
  var srs = srsLoad(), now = Date.now(), f = specFilter(spec);
  var list = allMistakes().filter(function (it) { return dealable(it) && f(it) && !(srs[it.key] && srs[it.key].hidden); });
  var band = function (it) {
    var r = srs[it.key];
    if (!r || r.q) return 1;
    if (r.due == null || r.due <= now) return 0;
    return isLearned(r) ? 3 : 2;
  };
  if (spec.type === 'game') {
    /* a game's walk-through: its positions in the order played (V4.7) */
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
/* enough tried for the day (DAY_RULE): this set's own tries (extra: the
   card on screen, tried and not yet answered), at least 3, or all of a
   shorter set; or with a closed set's carried over, 3 */
function triedEnough(ss, extra) {
  var tried = (ss.attempted || 0) + (extra || 0), n = 0, seen = {};
  /* (a lesson is no position to try, F9.3) */
  ss.keys.forEach(function (k) { if (!seen[k] && !isLessonKey(k)) { seen[k] = 1; n++; } });
  return (tried >= 1 && tried >= Math.min(3, n)) || tried + (ss.carried || 0) >= 3;
}
/* the day counts once 3 positions are tried, or all of a shorter set,
   finished or paused (F2.6, D5): asked as each card is answered or left
   and as a set is paused. Once a day: the measure, then the week's goal */
function countDay(ss, extra) {
  if (!ss || !triedEnough(ss, extra)) return;
  var day = dayLoad();
  if (dayCounts(day)) return;
  day.counted = 1;
  daySave(day);
  track('day_counted');
  goalCheck(ss);
}
/* the week's goal met, once a week: the measure, and the summary of the
   set that met it shows its medal (F4.4, ss.goalMet; cut: a short week's
   reason, V4.4). Stamped with the week's Monday, so a week met after a week
   missed counts again (the run of weeks at the goal starts again at 1
   there) */
function goalCheck(ss) {
  var wk = mondayOf(new Date()), wg = weekGoalInfo(Date.now());
  if (weekDays() >= wg.goal && store.get('nl:goalSent:' + playerId(), 0) !== wk) {
    store.set('nl:goalSent:' + playerId(), wk);
    track('week_goal_met');
    if (ss) ss.goalMet = { days: weekDays(), goal: wg.goal, cut: wg.cut };
  }
}
/* the days away before today: from the last practice day before today to
   today, 0 under 7 (V4.4, V4.5: a return after a break) */
function daysAway() {
  var today = dayStart(Date.now()), prev = countedDays().filter(function (t) { return t < today; }).pop();
  var d = prev == null ? 0 : daysFrom(prev, Date.now());
  return d >= 7 ? d : 0;
}
function finishSession() {
  var ss = ui.session;
  if (!ss) return;
  ss.finished = true;
  ss.active = null;
  clearLive();
  /* a set finished: on real tries only (DAY_RULE), the day counted then at
     the latest */
  var day = dayLoad(), pack = !!(ss.spec && ss.spec.type === 'pack');
  /* a pack (F9.4) counts the day as practice does, but it is no set of the
     player's own positions: Today's set and "since you started" wait */
  if (triedEnough(ss, 0)) { countDay(ss, 0); day = dayLoad(); if (!pack) day.sessions = (day.sessions || 0) + 1; }
  else if (!pack) day.short = 1;
  daySave(day);
  /* the day's first set after 7 or more days away: its summary says what was
     remembered (V4.4) and may ask for a backup (V4.5) */
  if (!pack && day.sessions === 1) ss.away = daysAway();
  /* the first finished set starts "since you started" (F6.2) */
  if (day.sessions) noteStart();
  /* the routine line, once, on a first summary at tiers 2 and 3 (F2.3) */
  if (playerTier() >= 2 && !store.get('nl:tip:routine', 0)) { ss.routine = true; store.set('nl:tip:routine', 1); }
  store.del(sessKey());
  /* one position opened from a summary: back to that summary */
  if (ss.from) ui.session = ss.from;
  /* progress now matters: ask the browser not to clear this site's storage */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  /* its sound comes with the summary's moments (summaryMoments, F4.4) */
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
  var open = ss.active, done = sessionDoneCount(ss);
  /* a move still being checked counts as a try that did not land */
  if (open && open.phase === 'checking') { open.checkTok = ++checkSeq; open.phase = 'guess'; open.attempts = Math.max(open.attempts || 0, 1); }
  engineStop('check');
  stageReset();
  clearLive();
  /* one position opened from a summary: × goes back to that summary, the
     position graded as a card left is (a miss counts), never paused */
  if (ss.from && !ss.finished) {
    if (open && open.phase !== 'done' && (open.misses || open.hints || open.attempts)) settleLeft(open);
    store.del(sessKey());
    ui.session = ss.from;
    pushSessionState();
    renderViews();
    renderTrain();
    window.scrollTo(0, 0);
    var rh0 = el('recap-h');
    if (rh0) rh0.focus({ preventScroll: true });
    return;
  }
  if (!ss.finished && open && open.phase !== 'done' && (open.misses || open.hints || open.attempts)) keepProgress(open);
  /* a set paused with 3 tried counts the day (F2.6) */
  if (!ss.finished) countDay(ss, open && open.phase !== 'done' && open.attempts > 0 ? 1 : 0);
  var keep = !ss.finished && (done > 0 || (open && (open.misses || open.hints || open.attempts)));
  if (keep) saveSession(); else store.del(sessKey());
  ui.session = null;
  if (!fromPop && history.state && history.state.nlSession) { try { history.replaceState(null, '', location.pathname + '#train'); } catch (e) {} }
  renderViews();
  renderTrain();
  window.scrollTo(0, 0);
  if (keep) notice('Set paused. ' + countsWords(ss), { act: 'resume', label: 'Resume' });
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
  if (!(readOver(n) || n.covered >= 60)) return null;
  if (!(L >= 5 && L - R >= 1.645 * Math.sqrt(L + R))) return null;
  return { fam: lead.fam.key };
}
/* every game read: the scan is done. The deeper look that goes on in the
   background is not reading, and never hides what waited for the read */
function readOver(n) {
  n = n || analysisNumbers();
  return n.total > 0 && n.covered >= n.total && !(SF.state !== 'failed' && (scanState.running || scanState.pending));
}
function insightFamiliesQuick() {
  var stats = patternStats();
  return FAMILIES.map(function (f) {
    var ps = stats.filter(function (s) { return f.types.indexOf(s.key) !== -1; });
    var agg = { fam: f, count: 0, cost: 0, lost: 0, pts: 0, learned: 0 };
    ps.forEach(function (s) { agg.count += s.count; agg.cost += s.cost; agg.lost += lostOf(s.items); agg.pts += s.pts; agg.learned += s.fixed; });
    return agg;
  }).filter(function (a) { return a.count > 0; }).sort(function (a, b) { return b.cost - a.cost || b.pts - a.pts; });
}

