/* ── Landing, identity, boot ────────────────────────────────────────────── */

function renderFirstVisit(prefill) {
  var cc = isCC();
  el('main').innerHTML = '<div class="first">'
    + '<div class="kicker" style="margin-bottom:14px">A free trainer for lichess and chess.com players</div>'
    + '<h1>Stop making the same mistakes.</h1>'
    + '<p class="lede">notlichess finds the moves that cost you games, in your own games, and trains you on them until you stop making them. '
    + 'You see why each move failed, what you should have played, and which kinds of mistakes lose you the most games.</p>'
    + '<div class="src-pick">'
      + '<button class="src-btn' + (!cc ? ' src-on' : '') + '" data-act="srcPick" data-k="lichess">I play on lichess<small>lichess.org</small></button>'
      + '<button class="src-btn' + (cc ? ' src-on' : '') + '" data-act="srcPick" data-k="chesscom">I play on chess.com<small>chess.com</small></button>'
    + '</div>'
    + '<div class="first-form">'
      + '<input class="input" id="firstUser" placeholder="Your ' + (cc ? 'chess.com' : 'lichess') + ' username" autocomplete="off" '
      + 'autocapitalize="off" spellcheck="false" value="' + esc(prefill || '') + '">'
      + '<button class="btn-big" data-act="setUser">Find my mistakes</button>'
    + '</div>'
    + '<div class="value">'
      + valueItem('Your own mistakes', 'Stockfish reads your games and pulls out the exact positions where they went wrong.')
      + valueItem('The why, not just the what', 'See what your move allowed, the better move, and what really happened next.')
      + valueItem('What costs you games', 'Hanging pieces, missed forks, slipped wins: ranked by the games they lost you.')
      + valueItem('Free, no account', 'Open source. Your games and progress stay in this browser, on this device.')
    + '</div>'
    + '<p class="first-foot">Rated live games, bullet to classical. Stockfish runs on your own computer, and your games and progress are stored in this browser. The site uses Microsoft Clarity to see how it is used.</p>'
    + '</div>';
  var input = el('firstUser');
  if (input) {
    input.focus();
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') setUser(input.value); });
    /* the engine downloads while the name is typed */
    input.addEventListener('focus', function () { engineLoad().catch(function () {}); }, { once: true });
    engineLoad().catch(function () {});
  }
}
function valueItem(title, body) {
  return '<div class="value-item"><b>' + esc(title) + '</b><span>' + esc(body) + '</span></div>';
}
function renderNoAccount() {
  var site = isCC() ? 'chess.com' : 'lichess';
  /* a name that does not exist is not remembered: the next visit starts fresh */
  if (store.get('nl:user', '') === cfg.user) store.del('nl:user');
  el('main').innerHTML = '<div class="first"><div class="kicker">not found</div>'
    + '<h1>' + site + ' has no account called ' + esc(cfg.user) + '.</h1>'
    + '<p class="lede">Check the spelling, or switch site.</p>'
    + '<div class="src-pick">'
      + '<button class="src-btn' + (!isCC() ? ' src-on' : '') + '" data-act="srcPick" data-k="lichess">lichess</button>'
      + '<button class="src-btn' + (isCC() ? ' src-on' : '') + '" data-act="srcPick" data-k="chesscom">chess.com</button></div>'
    + '<div class="first-form"><input class="input" id="firstUser" value="' + esc(cfg.user) + '" autocomplete="off" spellcheck="false">'
    + '<button class="btn-big" data-act="setUser">Try again</button></div></div>';
  var input = el('firstUser');
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') setUser(input.value); });
}
function setUser(name) {
  name = String(name || '').trim();
  if (!name) return;
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
    notice('That is not a ' + (isCC() ? 'chess.com' : 'lichess') + ' username: letters, numbers, underscore and hyphen only.');
    return;
  }
  cfg.user = name;
  saveCfg('user');
  ui.view = 'train';
  store.set('nl:view', 'train');
  try { history.replaceState(null, '', location.pathname + '#train'); } catch (e) {}
  track('login_' + cfg.src);
  boot();
}
/* the formats to learn from, picked from the profile: the ones played
   most, bullet only when it is what the player mostly plays */
function autoPerfs(u) {
  var counts = [];
  ['rapid', 'blitz', 'bullet', 'classical'].forEach(function (p) {
    var pf = u && u.perfs && u.perfs[p];
    if (pf && pf.games) counts.push([p, pf.games]);
  });
  if (!counts.length) return ['rapid', 'blitz'];
  var total = counts.reduce(function (a, c) { return a + c[1]; }, 0);
  counts.sort(function (a, b) { return b[1] - a[1]; });
  var pick = counts.filter(function (c) {
    if (c[0] === 'bullet' && counts[0][0] !== 'bullet') return false;
    return c[1] >= 20 && c[1] / total >= 0.1;
  }).map(function (c) { return c[0]; }).slice(0, 2);
  return pick.length ? pick : [counts[0][0]];
}

var NARR_WISDOM = [
  'This takes about a minute, once. After today the page opens instantly.',
  'Stockfish checks every move you made, right here in your browser.',
  'Most players replay their wins. The rating lives in the losses.',
  'A mistake you retry from the exact position is worth ten you read about.',
  'Each position comes back just before you would forget it.',
  'Ten minutes on your own mistakes beats ten more blitz games.',
  'The mistakes that cost you games come first.'
];
/* how many games the first read can reach: the quota, or fewer when the
   profile says the player has fewer rated games in a format */
function readTarget() {
  var u = data.user, total = 0;
  trackedPerfs().forEach(function (p) {
    var gm = u && u.perfs && u.perfs[p] && u.perfs[p].games;
    total += gm > 0 ? Math.min(cfg.perFormat, gm) : cfg.perFormat;
  });
  return total || windowCap();
}
function identityHtml() {
  var u = data.user;
  if (!u) return '';
  var perfs = trackedPerfs().map(function (p) {
    var pf = u.perfs && u.perfs[p];
    return pf && pf.rating ? perfLabel(p).toLowerCase() + ' ' + pf.rating : null;
  }).filter(Boolean).join(' · ');
  var games = trackedPerfs().reduce(function (a, p) { return a + ((u.perfs && u.perfs[p] && u.perfs[p].games) || 0); }, 0);
  return '<div class="confirm">' + (u.avatar ? '<img src="' + esc(u.avatar) + '" alt="">' : '')
    + '<div class="who"><b>' + esc(u.username || cfg.user) + '</b><span>' + perfs + (games ? ' · ' + games + ' rated games' : '')
    + '<br>Learning from your ' + trackedPerfs().map(function (p) { return perfLabel(p).toLowerCase(); }).join(' and ') + ' games. '
    + '<a data-act="settings">Change</a></span></div>'
    + '<a class="btn-quiet" data-act="logout">Not you?</a></div>';
}
function renderNarration() {
  el('main').innerHTML = '<div class="first" style="max-width:none">'
    + '<div style="max-width:720px;margin:0 auto">'
    + '<div class="kicker" style="margin-bottom:18px">finding your mistakes</div>'
    + '<h1>Reading ' + esc(cfg.user) + "'s games.</h1>"
    + '<div id="identity">' + identityHtml() + '</div>'
    + '<div id="narr" class="narr" aria-live="polite"></div>'
    + '</div>'
    + '<div id="narr-stage">' + narrBoards() + '</div>'
    + '<div style="max-width:720px;margin:0 auto"><p id="narr-wisdom" class="narr-wisdom"></p></div></div>';
  (data.narrLog || []).forEach(function (l) { narrLine(l[0], l[1]); });
  narrAnimate();
}
function finishNarration() {
  if (!data.narrate) return;
  var n = allMistakes().filter(trainable).length;
  narrLine('done', n ? 'Found your first ' + n + ' mistake' + (n === 1 ? '' : 's') + '. Stockfish keeps reading the rest while you train.'
    : (data.games.length ? 'Games are in. Stockfish is now reading them for mistakes.' : 'No rated live games found on this account.'));
  setTimeout(function () {
    data.narrate = false;
    data.freshOnboard = true;
    renderShell();
    renderAll();
  }, 900);
}

function greetingLine(lastSeen) {
  if (!lastSeen) return '';
  var fresh = data.games.filter(function (g) { return g.ts > lastSeen; });
  if (!fresh.length || fresh.length > 60) return '';
  var w = fresh.filter(function (g) { return g.res === 'win'; }).length;
  var l = fresh.filter(function (g) { return g.res === 'loss'; }).length;
  var ms = 0, lost = null;
  fresh.forEach(function (g) {
    (g.bl || []).forEach(function (b) { if (!b.x) { ms++; if (b.d && !lost) lost = g; } });
  });
  var line = 'Since your last visit: ' + fresh.length + ' game' + (fresh.length === 1 ? '' : 's') + ' (' + w + ' won, ' + l + ' lost)';
  if (ms) line += ' · ' + ms + ' new mistake' + (ms === 1 ? '' : 's') + (lost ? ', including the one that ' + decisiveWords(lost) + ' vs ' + esc(lost.opp) : '');
  else line += ' · Stockfish is reading them now';
  return line + '.';
}
/* the previous visit is read once per page load: a refresh or an hourly
   check for new games must not move it */
function computeGreeting() {
  var key = 'nl:lastSeen:' + String(cfg.user).toLowerCase();
  if (data.prevSeenFor !== cfg.user) {
    data.prevSeen = store.get(key, 0);
    data.prevSeenFor = cfg.user;
    store.set(key, Date.now());
  }
  data.greeting = greetingLine(data.prevSeen);
}

/* old keys from the retired features, and the one-time "what changed" */
function migrateStorage() {
  if (store.get('nl:migrated', 0) >= 2) return;
  var hadV1 = false;
  try {
    var dead = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      /* regenerable caches and old screen flags go; progress in the retired
         trainers (puzzles, opening lines) stays, in case they come back */
      if (k === 'nl:cache:tours' || /^nl:cache:prep:/.test(k)
          || k === 'nl:setSize' || k === 'nl:obDone' || k === 'nl:tcs_edit') dead.push(k);
      if (/^nl:srs:/.test(k)) hadV1 = true;
    }
    dead.forEach(function (k2) { localStorage.removeItem(k2); });
  } catch (e) {}
  if (hadV1) store.set('nl:whatsNew', 1);
  store.set('nl:migrated', 2);
}

function boot() {
  gen++;
  var myGen = gen;
  applyLinkTarget();
  migrateStorage();
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) notice('You are offline. Showing what was saved last time.');
  if (!cfg.user) { renderHeader(); renderFirstVisit(); renderFoot(); return; }
  /* a link that names a player opens that player, and keeps them after a reload */
  if (urlUser && /^[a-zA-Z0-9_-]{2,30}$/.test(urlUser) && store.get('nl:user', '') !== cfg.user) {
    saveCfg('user');
    saveCfg('src');
  }
  document.title = 'notlichess.org · ' + cfg.user;
  engineLoad().catch(function () {});           /* in parallel with everything else */
  ui.session = null;
  var cached = loadCachedGames();
  data.games = cached.games;
  data.sections = { user: 'loading', games: 'loading' };
  data.series = {}; data.deltas = {}; data.peaks = {}; data.user = data.user && data.user.id === String(cfg.user).toLowerCase() ? data.user : null;
  data.narrLog = []; data.greeting = '';
  srsMem = null;
  modelDirty();
  buildSeries();
  data.narrate = !data.games.length;
  data.narrPreview = null; data.narrStart = null;
  if (data.narrate) { renderHeader(); renderNarration(); }
  else {
    renderShell();
    renderAll();
    if (store.get('nl:whatsNew', 0)) { store.del('nl:whatsNew'); openSheet('whatsnew'); }
  }
  var previewEarly = loadNarrPreview();
  loadUser()
    .then(function () {
      if (stale(myGen)) throw { stop: 'stale' };
      if (data.sections.user === 'fail' && data.userErr === 404) throw { stop: 'none' };
      /* first login: the formats come from the profile, no questions asked */
      if (!store.get('nl:perfs', null) && data.user) {
        setPerfs(autoPerfs(data.user));
        if (el('identity')) el('identity').innerHTML = identityHtml();
      }
    })
    .then(function () { return previewEarly; })
    .then(loadGames)
    .then(function () {
      if (stale(myGen)) return;
      finishNarration();
      renderAll();
      setTimeout(autoScan, 600);
      setTimeout(autoEnrich, 2500);
      setTimeout(reingestLichess, 8000);
    })
    .catch(function (err) {
      if (err && err.stop === 'none') renderNoAccount();
      else if (!(err && err.stop === 'stale')) renderAll();
    });
}

/* lichess games analysed before the rebuild lost their evaluations when
   they were first stored; they come back once, in bulk, so every old
   mistake gets exact numbers and a full win-chance series */
var reingestState = { busy: false, done: false };
function reingestLichess() {
  if (isCC() || reingestState.busy || reingestState.done || !cfg.user) return;
  var myGen = gen;
  var ids = data.games.filter(function (g) { return g.analysed && !g.wp; }).map(function (g) { return g.id; });
  if (!ids.length) { reingestState.done = true; return; }
  reingestState.busy = true;
  var meId = String(cfg.user).toLowerCase(), byId = {};
  data.games.forEach(function (g) { byId[g.id] = g; });
  var batches = [];
  for (var i = 0; i < ids.length; i += 300) batches.push(ids.slice(i, i + 300));
  var chain = Promise.resolve();
  batches.forEach(function (batch) {
    chain = chain.then(function () {
      if (stale(myGen)) return;
      return request('/api/games/export/_ids?' + GAME_PARAMS, { method: 'POST', body: batch.join(','), accept: 'application/x-ndjson', quiet: true })
        .then(function (res) { return res.text(); })
        .then(function (text) {
          if (stale(myGen)) return;
          text.split('\n').forEach(function (line) {
            if (!line.trim()) return;
            try {
              var raw = JSON.parse(line), old = byId[raw.id], fresh = compact(raw, meId);
              if (!old || !fresh) return;
              adoptFresh(old, fresh);
            } catch (e) {}
          });
          modelDirty();
          scheduleSave();
        });
    });
  });
  chain.then(function () { reingestState.busy = false; reingestState.done = true; flushSave(); renderAll(); },
             function () { reingestState.busy = false; });
}
/* a refetched record replaces the old one's analysis, but the practice
   keys (gameId:ply) and anything the player marked survive */
function adoptFresh(old, fresh) {
  var oldBy = {};
  (old.bl || []).forEach(function (b) { oldBy[b.p] = b; });
  (fresh.bl || []).forEach(function (b) {
    var o = oldBy[b.p];
    if (o && o.x && /^user/.test(o.x)) b.x = o.x;
    if (o && (o.v || 0) >= 2 && o.ru) { b.ru = o.ru; b.ma = o.ma; b.v = o.v; }
  });
  ['bl', 'mv', 'wp', 'ev', 'acc2', 'pcs', 'opening', 'analysed'].forEach(function (k) { if (fresh[k] != null) old[k] = fresh[k]; });
  delete old.mig;
}

/* ── progress between devices, as a file ────────────────────────────────── */
function exportProgress() {
  var u = String(cfg.user).toLowerCase(), out = { v: 1, user: cfg.user, src: cfg.src, at: Date.now(), keys: {} };
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      if (k === 'nl:srs:' + u || k.indexOf('nl:day:' + u + ':') === 0 || k === 'nl:bestStreak:' + u || k === 'nl:focus2:' + u)
        out.keys[k] = JSON.parse(localStorage.getItem(k));
    }
  } catch (e) {}
  var blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notlichess-progress-' + u + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function importProgress() {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    f.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || !d.keys) throw new Error('bad file');
      if (String(d.user).toLowerCase() !== String(cfg.user).toLowerCase()) {
        notice('That file belongs to ' + d.user + '. Log in as them to load it.');
        return;
      }
      Object.keys(d.keys).forEach(function (k) {
        if (k.indexOf('nl:srs:') === 0) {
          /* merge by position: keep whichever record was practised last */
          var mine = store.get(k, {}), theirs = d.keys[k];
          Object.keys(theirs).forEach(function (p) {
            if (!mine[p] || (theirs[p].last || 0) > (mine[p].last || 0)) mine[p] = theirs[p];
          });
          store.set(k, mine);
        } else if (!store.get(k, null)) store.set(k, d.keys[k]);
      });
      srsMem = null;
      srsRevision++;
      modelDirty();
      notice('Progress loaded.');
      renderAll();
    }).catch(function () { notice('That file could not be read.'); });
  };
  inp.click();
}

/* ── actions ─────────────────────────────────────────────────────────────── */
function parseSpec(t) {
  try { return JSON.parse(t.getAttribute('data-spec')); } catch (e) { return null; }
}
document.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('[data-act]') : null;
  if (e.target.closest && e.target.closest('#bwrap [data-sq]')) {
    if (pointerState.suppressClick) { pointerState.suppressClick = false; return; }
    var sqEl = e.target.closest('[data-sq]');
    sessionClick(parseInt(sqEl.getAttribute('data-sq'), 10));
    return;
  }
  if (!t) {
    var a0 = ui.session && ui.session.active;
    if (a0 && a0.menuOpen && !(e.target.closest && e.target.closest('.card-menu'))) { a0.menuOpen = false; renderCard(); }
    return;
  }
  var act = t.getAttribute('data-act'), k = t.getAttribute('data-k');
  if (t.tagName === 'INPUT') return;
  if (act !== 'closeSheet' || e.target === t) e.preventDefault();
  var a = ui.session && ui.session.active;
  switch (act) {
    case 'view': closeSheet(); if (ui.session && ui.session.finished && k === 'train') endSession(); setView(k); break;
    case 'home': closeSheet(); if (cfg.user) setView('train'); break;
    case 'srcPick': {
      cfg.src = k === 'chesscom' ? 'chesscom' : 'lichess';
      saveCfg('src');
      var typed = el('firstUser') ? el('firstUser').value : '';
      renderFirstVisit(typed);
      break;
    }
    case 'setUser': setUser(el('firstUser') ? el('firstUser').value : ''); break;
    case 'logout': {
      if (k === 'confirm' && !ui.logoutArmed) {
        ui.logoutArmed = true;
        t.textContent = 'tap again to switch';
        setTimeout(function () { ui.logoutArmed = false; renderHeader(); }, 3000);
        break;
      }
      ui.logoutArmed = false;
      flushSave();
      gen++;
      document.title = 'notlichess.org';
      cfg.user = ''; store.del('nl:user');
      cfg.perfs = null; store.del('nl:perfs');
      ui.settingsOpen = false; ui.session = null; data.narrate = false; data.user = null;
      closeSheet();
      renderHeader(); renderFirstVisit(); renderFoot();
      break;
    }
    case 'settings':
      ui.settingsOpen = !ui.settingsOpen; ui.wipeArmed = false; ui.resetArmed = false;
      if (data.narrate && ui.settingsOpen) { data.narrate = false; renderShell(); renderAll(); }
      renderSettings();
      if (ui.settingsOpen) {
        var sb = el('settings'), bar0 = el('bar');
        if (sb) window.scrollTo({ top: sb.getBoundingClientRect().top + window.scrollY - (bar0 ? bar0.offsetHeight : 0) - 8, behavior: 'smooth' });
      }
      break;
    case 'startToday': startToday(); break;
    case 'resume': resumeSession(); break;
    case 'dropSession': store.del(sessKey()); renderTrain(); break;
    case 'keepGoing': keepGoing(); break;
    case 'endSession': endSession(); break;
    case 'drill': { var sp = parseSpec(t); if (sp) startDrill(sp); break; }
    case 'setFocus': setFocus(k); break;
    case 'sheet': openSheet(k); break;
    case 'closeSheet': if (e.target === t) closeSheet(); break;
    case 'hint': giveHint(); break;
    case 'reveal': reveal(); break;
    case 'skip': skipCard(); break;
    case 'next': nextCard(); break;
    case 'dismissStronger': if (a) { a.strongerOffer = false; a.verdict = null; renderCard(); } break;
    case 'promo': promoChoose(k); break;
    case 'menu': if (a) { a.menuOpen = !a.menuOpen; renderCard(); } break;
    case 'dispute': disputeCard(k); break;
    case 'marksSeen': store.set('nl:marksSeen', true); renderCard(); break;
    case 'lineTab': if (a && a.lines) { stopAuto(a); a.explore = null; a.view = { line: k, idx: 0 }; renderCard(); } break;
    case 'lineTo': if (a && a.lines) { stopAuto(a); a.explore = null; a.view.idx = parseInt(t.getAttribute('data-n'), 10); renderCard(); } break;
    case 'lineBack': stepView(-1); break;
    case 'lineFwd': stepView(1); break;
    case 'explore': stopAuto(a); startExplore(); break;
    case 'exploreOff': if (a) { a.explore = null; renderCard(); } break;
    case 'perf': {
      var cur = trackedPerfs().slice(), at = cur.indexOf(k);
      if (at === -1) cur.push(k); else if (cur.length > 1) cur.splice(at, 1);
      setPerfs(cur);
      renderSettings();
      perfsChanged();
      break;
    }
    case 'limit': setLimit(parseInt(k, 10)); break;
    case 'size': store.set('nl:sessionSize', parseInt(k, 10)); renderSettings(); renderTrain(); break;
    case 'weekGoal': store.set('nl:weekGoal', parseInt(k, 10)); renderSettings(); renderTrain(); break;
    case 'help': store.set('nl:help', k); renderSettings(); break;
    case 'reload': checkForGames(); break;
    case 'exportProgress': exportProgress(); break;
    case 'importProgress': importProgress(); break;
    case 'engineRetry': SF.state = 'idle'; SF.crashes = []; engineLoad().then(function () { autoScan(); }, function () {}); renderAll(); break;
    case 'resetProgress': {
      if (!ui.resetArmed) { ui.resetArmed = true; renderSettings(); break; }
      var u = String(cfg.user).toLowerCase();
      try {
        var del = [];
        for (var i = 0; i < localStorage.length; i++) {
          var kk = localStorage.key(i);
          if (kk && (kk.indexOf('nl:day:' + u + ':') === 0 || kk === 'nl:bestStreak:' + u || kk === 'nl:focus2:' + u || kk === sessKey())) del.push(kk);
        }
        del.forEach(function (x) { localStorage.removeItem(x); });
        /* the mistakes' records go; the retired trainer's lines stay */
        var keptLines = splitSrs(store.get('nl:srs:' + u, {})).kept;
        if (Object.keys(keptLines).length) store.set('nl:srs:' + u, keptLines); else store.del('nl:srs:' + u);
      } catch (e2) {}
      srsMem = null; srsRevision++; ui.session = null; ui.resetArmed = false; modelDirty();
      notice('Practice history reset. Your games and analysis are kept.');
      renderAll();
      break;
    }
    case 'wipe': {
      if (!ui.wipeArmed) { ui.wipeArmed = true; renderSettings(); break; }
      try {
        var all = [];
        for (var j = 0; j < localStorage.length; j++) { var kj = localStorage.key(j); if (kj && kj.indexOf('nl:') === 0) all.push(kj); }
        all.forEach(function (x) { localStorage.removeItem(x); });
      } catch (e3) {}
      location.href = location.pathname;
      break;
    }
    case 'coffee': notice('Thank you! A tip jar is coming soon.'); break;
  }
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (!t || !t.getAttribute) return;
  var act = t.getAttribute('data-act');
  if (act === 'sound') { cfg.sound = !!t.checked; saveCfg('sound'); }
  if (act === 'evalbarToggle') { store.set('nl:evalbar', !!t.checked); renderCard(); }
});
document.addEventListener('keydown', function (e) {
  if (e.target && e.target.id === 'kbmove' && e.key === 'Enter') { e.preventDefault(); typedMove(e.target.value); return; }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Tab' && ui.sheet) {
    /* focus stays inside the open sheet */
    var sh = document.querySelector('#overlay .sheet');
    var f = sh ? [].slice.call(sh.querySelectorAll('[data-act][tabindex], a[href], button, input')) : [];
    if (f.length) {
      var at = f.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (at === -1 || at === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
    return;
  }
  if (e.key === 'Escape') {
    if (ui.sheet) { closeSheet(); return; }
    if (ui.settingsOpen) { ui.settingsOpen = false; renderSettings(); return; }
  }
  var a = ui.session && ui.session.active;
  if (!a || ui.sheet) return;
  if (a.phase === 'done') {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepView(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepView(1); }
    else if (e.key === 'Enter' || e.key === ' ') { if (!(e.target && e.target.closest && e.target.closest('[data-act]'))) { e.preventDefault(); nextCard(); } }
  } else if (a.phase === 'guess') {
    if (e.key === 'h' || e.key === 'H') giveHint();
  }
});
function reducedMotion() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
/* a move typed as SAN (Nf3, exd5, O-O, e8=Q) or as squares (g1f3) */
function typedMove(txt) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'guess') return;
  var t = String(txt || '').trim().replace(/0/g, 'O');
  var m = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(t) ? uciToMove(a.st, t.toLowerCase()) : null;
  if (!m && t) { var probe = cloneState(a.st), sm = sanApply(probe, t); if (sm) m = legalMoves(a.st).filter(function (x) { return x.from === sm.from && x.to === sm.to && (!x.promo || x.promo === sm.promo); })[0] || null; }
  if (!m) { notice('That move is not legal here. Try a move like Nf3, exd5, O-O or g1f3.'); return; }
  gradeMove(m);
}
/* Enter and Space on focusable actions; the view tabs keep their own role */
function makeFocusable(root) {
  var list = (root || document).querySelectorAll('[data-act]:not([href]):not(button):not(input):not(.scrim):not([tabindex])');
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === 'astat-ic' && !list[i].textContent) continue;
    list[i].setAttribute('tabindex', '0');
    if (!list[i].getAttribute('role')) list[i].setAttribute('role', 'button');
  }
}
new MutationObserver(function () { makeFocusable(document); }).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-act][tabindex]:not(input)')) {
    e.preventDefault();
    e.target.click();
  }
});

/* ── board input: tap-tap and drag, on the card's own board only ─────────── */
var pointerState = { dragFrom: -1, rightFrom: -1, moved: false, suppressClick: false };
function sqFromEvent(e) {
  var el2 = document.elementFromPoint(e.clientX, e.clientY);
  var sqEl = el2 && el2.closest ? el2.closest('#bwrap [data-sq]') : null;
  return sqEl ? parseInt(sqEl.getAttribute('data-sq'), 10) : -1;
}
document.addEventListener('contextmenu', function (e) {
  if (e.target.closest && e.target.closest('#bwrap')) e.preventDefault();
});
var dragGhost = null;
function killGhost() {
  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  document.querySelectorAll('#bwrap use.drag-src').forEach(function (u) { u.classList.remove('drag-src'); });
}
function spawnGhost(pieceChar, x, y, size) {
  killGhost();
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.style.width = dragGhost.style.height = size + 'px';
  dragGhost.innerHTML = '<svg viewBox="0 0 45 45"><use href="#pc-' + PIECE_ID[pieceChar] + '"/></svg>';
  document.body.appendChild(dragGhost);
  moveGhost(x, y);
}
function moveGhost(x, y) {
  if (dragGhost) dragGhost.style.transform = 'translate(' + (x - dragGhost.offsetWidth / 2) + 'px,' + (y - dragGhost.offsetHeight / 2) + 'px)';
}
function boardState(a) {
  if (a.phase === 'done' && a.explore) return { st: a.explore.st, live: true, explore: true };
  if (a.phase === 'guess') return { st: a.st, live: true };
  return { st: a.st, live: false };
}
document.addEventListener('pointerdown', function (e) {
  var a = ui.session && ui.session.active;
  if (!a || !e.target.closest || !e.target.closest('#bwrap')) return;
  var sq = sqFromEvent(e);
  if (sq < 0) return;
  if (e.button === 2) { pointerState.rightFrom = sq; return; }
  var bs = boardState(a);
  if (e.button !== 0 || !bs.live || a.pendingPromo) return;
  pointerState.suppressClick = false;
  if (!bs.explore && a.shapes.length) { a.shapes = []; renderCard(); }
  var p = bs.st.b[sq];
  if (p && isW(p) === bs.st.w) {
    pointerState.dragFrom = sq;
    pointerState.dragPiece = p;
    pointerState.moved = false;
    pointerState.startX = e.clientX;
    pointerState.startY = e.clientY;
    var cur = bs.explore ? a.explore.sel : a.sel;
    pointerState.justSelected = cur !== sq;
    if (cur !== sq) { if (bs.explore) a.explore.sel = sq; else a.sel = sq; renderCard(); }
  }
});
document.addEventListener('pointermove', function (e) {
  if (pointerState.dragFrom < 0) return;
  if (!pointerState.moved) {
    var jdx = e.clientX - pointerState.startX, jdy = e.clientY - pointerState.startY;
    if (jdx * jdx + jdy * jdy < 64) return;
    pointerState.moved = true;
    var rect0 = document.querySelector('#bwrap .board rect[data-sq]');
    var size = rect0 ? rect0.getBoundingClientRect().width : 45;
    spawnGhost(pointerState.dragPiece, e.clientX, e.clientY, size);
    var src = document.querySelector('#bwrap .board use[data-sq="' + pointerState.dragFrom + '"]');
    if (src) src.classList.add('drag-src');
  }
  moveGhost(e.clientX, e.clientY);
});
function pointerFinish(e, cancelled) {
  var a = ui.session && ui.session.active;
  if (!a) { pointerState.dragFrom = -1; pointerState.rightFrom = -1; killGhost(); return; }
  var sq = cancelled ? -1 : sqFromEvent(e);
  if (e.button === 2 && pointerState.rightFrom >= 0) {
    if (sq >= 0 && a.phase === 'guess') {
      if (sq === pointerState.rightFrom) a.shapes.push({ at: sq }); else a.shapes.push({ from: pointerState.rightFrom, to: sq });
      renderCard();
    }
    pointerState.rightFrom = -1;
    return;
  }
  if (pointerState.dragFrom >= 0) {
    var from = pointerState.dragFrom;
    pointerState.dragFrom = -1;
    killGhost();
    var bs = boardState(a);
    if (pointerState.moved && sq >= 0 && sq !== from && bs.live) {
      if (bs.explore) a.explore.sel = from; else a.sel = from;
      pointerState.suppressClick = true;
      sessionClick(sq);
    } else if (!pointerState.moved && pointerState.justSelected) {
      pointerState.suppressClick = true;
    }
    pointerState.justSelected = false;
  }
}
document.addEventListener('pointerup', function (e) { pointerFinish(e, false); });
document.addEventListener('pointercancel', function (e) { pointerFinish(e, true); });

/* ── games: checking for new ones, formats, limits ───────────────────────── */
function checkForGames() {
  if (data.sections.games === 'loading') return;
  notice('Checking for new games…');
  loadGames().then(function () { setTimeout(autoScan, 500); });
}
var perfFetchTimer = null;
function perfsChanged() {
  modelDirty();
  clearTimeout(perfFetchTimer);
  /* a new format's history is fetched without discarding anything */
  perfFetchTimer = setTimeout(function () { data.needFull = true; loadGames().then(function () { setTimeout(autoScan, 500); }); }, 1500);
}
function setLimit(n) {
  if (!n || isNaN(n)) return;
  n = Math.max(100, Math.min(500, Math.round(n)));
  var grew = n > cfg.perFormat;
  cfg.perFormat = n;
  saveCfg('perFormat');
  renderSettings();
  if (grew) { data.needFull = true; loadGames(); }
  else { data.games = trimGames(data.games); modelDirty(); flushSave(); renderAll(); }
}

/* a small window for automated tests: read the card, play a move */
window.__nlTest = {
  card: function () {
    var ss = ui.session, a = ss && ss.active;
    if (!a) return { session: !!ss, finished: !!(ss && ss.finished), idx: ss ? ss.idx : null, n: ss ? ss.keys.length : null };
    return { idx: ss.idx, n: ss.keys.length, key: a.key, phase: a.phase, best: a.bestUci, played: a.playedUci,
             sol: a.sol || null, solIdx: a.solIdx, turn: a.st.w ? 'w' : 'b', fen: stateFen(a.st), misses: a.misses,
             hints: a.hints, result: a.result || null, pattern: patternOf(a.it.b), view: a.view,
             lines: a.lines ? { best: a.lines.best.san, refute: a.lines.refute.san, game: a.lines.game.san } : null,
             sentences: a.cls ? a.cls.sentences : null, sel: a.sel, b: a.it.b };
  },
  play: function (uci) {
    var a = ui.session && ui.session.active;
    if (!a) return 'no card';
    var st = a.phase === 'done' && a.explore ? a.explore.st : a.st;
    var m = uciToMove(st, uci);
    if (!m) return 'illegal';
    if (a.phase === 'guess') { gradeMove(m); return 'graded'; }
    return 'not guessing';
  },
  stats: function () {
    var items = allMistakes();
    var byT = {};
    items.forEach(function (it) { var t = patternOf(it.b); byT[t] = (byT[t] || 0) + 1; });
    return { games: data.games.length, mistakes: items.length, trainable: items.filter(trainable).length, byPattern: byT,
             due: dueCards().length, engine: SF.build, state: SF.state };
  }
};
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__nlTest.ev = function (code) { return eval(code); };
