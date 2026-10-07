/* ── Landing, identity, boot ────────────────────────────────────────────── */

/* the example on the landing: a real club-level slip (5...Nxd5 in the Two
   Knights walks into Nxf7, forking queen and rook) */
var LANDING_FEN = 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
function renderFirstVisit(prefill) {
  var ex = stateFromFen(LANDING_FEN);
  el('main').innerHTML = '<div class="first landing">'
    + '<div class="landing-copy">'
    + '<div class="kicker">For chess.com and lichess players</div>'
    + '<h1>Stop making the same mistakes.</h1>'
    + '<p class="lede">Type your username. In a few seconds you see which mistakes decided your losses. Then you practise those exact positions, a few minutes a day, until you stop making them.</p>'
    /* an iPhone home-screen app keeps its storage apart from Safari */
    + (navigator.standalone === true ? '<p class="handoff">Used notlichess in Safari? Export your progress there in Settings, then import it here. '
      + '<a class="btn-line" data-act="importProgress">Import progress</a></p>' : '')
    /* one box: the name is looked up on both sites */
    + '<div class="first-form">'
      + '<input class="input" id="firstUser" placeholder="Your chess.com or lichess username" autocomplete="off" '
      + 'autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Your chess.com or lichess username" value="' + esc(prefill || '') + '">'
      + '<button class="btn-big" data-act="findUser" id="findBtn">Find my mistakes</button>'
    + '</div>'
    + '<div id="whichSite" aria-live="polite"></div>'
    + '<p class="first-foot">Free, with no account. Your games and progress are saved in this browser, not on our servers. Microsoft Clarity records clicks and the screen, with all text hidden, to show how the site is used.</p>'
    + '<figure class="proof"><figcaption>What a 1350 rapid player saw</figcaption>'
      + '<blockquote>169 of your 237 losses came down to one big mistake. The biggest leak is giving away material. It decided 107 games.</blockquote></figure>'
    + '</div>'
    + (ex ? '<div class="landing-ex" aria-hidden="true"><div class="kicker">Example</div>'
      + boardSvg(ex, { flip: true, bad: [45, 35], mark: [28, 35], decor: true })
      + '<p class="ex-task">Find a better move.</p><p class="ex-sub">You played Nxd5. It walked into a fork.</p></div>' : '')
    + '<div class="value">'
      + valueItem('Every game, not one at a time', 'Your last year of rated games in the format you play most. Your first position is ready in seconds.')
      + valueItem('Ranked by what it cost you', 'Hanging pieces, forks, missed mates: sorted by how many games each one decided.')
      + valueItem('A few minutes a day', 'Five of your own positions. Each comes back just before you would forget it.')
      + valueItem('Free, no account', 'Nothing to buy. Open source.')
    + '</div>'
    + '<p class="first-foot small">Rated live games, bullet to classical. Stockfish runs on your device.</p>'
    + '</div>';
  var input = el('firstUser');
  if (input) {
    input.focus();
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') findUser(input.value); });
    /* the engine downloads while the name is typed, not for every visitor */
    input.addEventListener('input', function () { engineLoad().catch(function () {}); }, { once: true });
  }
}
/* the name on both sites at once: one found, go; both, ask which; neither,
   say so. A site that does not answer counts as not found there */
var findSeq = 0;
function findUser(name) {
  name = String(name || '').trim();
  if (!name) return;
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) { notice('That is not a chess.com or lichess username: letters, numbers, underscore and hyphen only.'); return; }
  /* only the latest lookup acts: an earlier one answering late is ignored */
  var seq = ++findSeq;
  var btn = el('findBtn'), box = el('whichSite');
  if (btn) { btn.textContent = 'Looking…'; btn.classList.add('btn-off'); }
  if (box) box.innerHTML = '';
  /* only a real 404 means "no account there"; anything else is "no answer" */
  var failed = function (e) { return e && e.code === 404 ? null : { err: true }; };
  var li = getJSON('/api/user/' + encodeURIComponent(name), { quiet: true }).then(function (u) {
    if (!u || u.disabled || u.closed) return null;
    var best = null;
    ['rapid', 'blitz', 'bullet', 'classical'].forEach(function (p) { var pf = u.perfs && u.perfs[p]; if (pf && pf.games && (!best || pf.games > best.games)) best = { p: p, games: pf.games, r: pf.rating }; });
    return { site: 'lichess', name: u.username || name, best: best };
  }, failed);
  var cc = ccJSON('/player/' + encodeURIComponent(name), { quiet: true }).then(function (p) {
    if (!p) return null;
    return ccJSON('/player/' + encodeURIComponent(name) + '/stats', { quiet: true }).then(function (st) {
      var best = null;
      [['chess_rapid', 'rapid'], ['chess_blitz', 'blitz'], ['chess_bullet', 'bullet']].forEach(function (k) {
        var v = st && st[k[0]], n = v && v.record ? (v.record.win || 0) + (v.record.loss || 0) + (v.record.draw || 0) : 0;
        if (n && (!best || n > best.games)) best = { p: k[1], games: n, r: v.last && v.last.rating };
      });
      return { site: 'chesscom', name: p.username || name, best: best };
    }, function () { return { site: 'chesscom', name: p.username || name, best: null }; });
  }, failed);
  Promise.all([cc, li]).then(function (res) {
    if (seq !== findSeq) return;
    box = el('whichSite'); btn = el('findBtn');
    if (btn) { btn.textContent = 'Find my mistakes'; btn.classList.remove('btn-off'); }
    if (!box) return;
    var found = res.filter(function (f) { return f && !f.err; }), silent = res.some(function (f) { return f && f.err; });
    /* one site has it and the other surely does not, or only one of the
       two accounts has rated games: go */
    var played = found.filter(function (f) { return f.best; });
    if (found.length === 2 && played.length === 1 && !silent) found = played;
    if (found.length === 1 && !silent) { cfg.src = found[0].site; saveCfg('src'); setUser(name); return; }
    if (!found.length && !silent) {
      box.innerHTML = '<p class="which-none">Neither chess.com nor lichess has an account called ' + esc(name) + '. Check the spelling.</p>';
      return;
    }
    if (!found.length) {
      var down = res.filter(function (f) { return f && f.err; }).length === 2 ? 'chess.com or lichess' : (res[0] && res[0].err ? 'chess.com' : 'lichess');
      box.innerHTML = '<p class="which-none">Could not reach ' + down + '. Check your connection and try again.</p>';
      return;
    }
    /* both, or one while the other did not answer: ask */
    var offer = found.concat(silent && found.length === 1 ? [{ site: found[0].site === 'chesscom' ? 'lichess' : 'chesscom', best: null }] : []);
    box.innerHTML = '<p class="which-q">Which one is you?</p><div class="which-row">' + offer.map(function (f) {
      return '<button class="btn-line" data-act="pickSite" data-k="' + f.site + '" data-n="' + esc(name) + '">' + (f.site === 'chesscom' ? 'chess.com' : 'lichess')
        + (f.best && f.best.r ? ' · ' + f.best.p + ' ' + f.best.r : (!f.best && !silent ? ' · no rated games' : '')) + '</button>';
    }).join('') + '</div>';
  });
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
    + '<button class="btn-big" data-act="setUser">Try again</button></div><div id="other-site"></div></div>';
  var input = el('firstUser');
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') setUser(input.value); });
  /* the name may simply be on the other site: look, and offer it in one tap */
  var name = cfg.user, other = isCC() ? 'lichess' : 'chesscom';
  (isCC() ? getJSON('/api/user/' + encodeURIComponent(name), { quiet: true }) : ccJSON('/player/' + encodeURIComponent(name), { quiet: true }))
    .then(function (p) {
      var box = el('other-site');
      if (!box || !p || cfg.user !== name) return;
      box.innerHTML = '<div class="hero state other-site"><h2>Found ' + esc(p.username || name) + ' on ' + (other === 'chesscom' ? 'chess.com' : 'lichess') + '. Is that you?</h2>'
        + '<div class="acts"><a class="btn-big" data-act="useOtherSite" data-k="' + other + '">Use that</a></div></div>';
    }, function () {});
}
/* coarse return measures for the founder: which visit this is, never who
   (no names, ratings or mistake rates), at most one per day */
function returnEvents() {
  try {
    var k = 'nl:firstSeen:' + playerId(), first = store.get(k, 0), now = Date.now();
    if (linkVisit) { if (!linkTracked) { linkTracked = true; track('open_link'); } return; }
    var utm = linkStore.get('nl:utm');
    if (utm && window.clarity) window.clarity('set', 'utm_source', utm.slice(0, 40));
    var sent = 'nl:retDay:' + playerId();
    if (!first) { store.set(k, now); store.set(sent, dayStamp()); track('first_visit'); return; }
    if (store.get(sent, '') === dayStamp()) return;
    store.set(sent, dayStamp());
    var days = (now - first) / DAY;
    track(days < 2 ? 'return_d1' : (days < 8 ? 'return_d2_7' : (days < 29 ? 'return_w2_4' : 'return_m2')));
    /* how many of the last 28 days counted, as a bucket */
    var act = 0;
    for (var i = 0; i < 28; i++) { var d = new Date(now - i * DAY); if (dayCounts(dayRecOf(d))) act++; }
    if (window.clarity) window.clarity('set', 'active_days', act === 0 ? '0' : act === 1 ? '1' : act <= 3 ? '2-3' : act <= 7 ? '4-7' : act <= 14 ? '8-14' : '15+');
  } catch (e) {}
}
function forgetLink() { linkVisit = false; }
/* the saved formats are this player's (older saves carry no owner: theirs) */
function perfsMine() { var pf = store.get('nl:perfsFor', ''); return !!store.get('nl:perfs', null) && (!pf || pf === playerId()); }
function setUser(name) {
  name = String(name || '').trim();
  if (!name) return;
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
    notice('That is not a ' + (isCC() ? 'chess.com' : 'lichess') + ' username: letters, numbers, underscore and hyphen only.');
    return;
  }
  cfg.user = name;
  saveCfg('user');
  forgetLink();
  ui.view = 'train';
  store.set('nl:view', 'train');
  try { history.replaceState(null, '', location.pathname + '#train'); } catch (e) {}
  track('login_' + cfg.src);
  boot();
}
/* one format by default, the rating the player is trying to raise: among
   the formats played in the last 90 days (where the site says when, as
   chess.com does), the one with the most games. More are a choice in
   Settings. */
function autoPerfs(u) {
  var counts = [];
  ['rapid', 'blitz', 'bullet', 'classical'].forEach(function (p) {
    var pf = u && u.perfs && u.perfs[p];
    if (pf && pf.games) counts.push([p, pf.games, pf.last || null]);
  });
  var recent = counts.filter(function (c) { return c[2] && Date.now() - c[2] < 90 * DAY; });
  if (recent.length) counts = recent;
  if (!counts.length) return ['rapid'];
  counts.sort(function (a, b) { return b[1] - a[1]; });
  return [counts[0][0]];
}

var NARR_WISDOM = [
  'The first read takes a minute or two. Your first positions are ready before that.',
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
    + '<br>Training on your ' + trackedPerfs().map(function (p) { return perfLabel(p).toLowerCase(); }).join(' and ') + ' games. '
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
  var line = 'Since your last visit: ' + fresh.length + ' game' + (fresh.length === 1 ? '' : 's') + ' (' + w + ' won, ' + l + ' lost).';
  /* the game that lost is the way back in */
  if (lost) {
    var dec = (lost.bl || []).filter(function (b) { return b.d && !b.x; })[0];
    line += ' You ' + (lost.res === 'draw' ? 'drew with ' : 'lost to ') + esc(lost.opp) + '. The move that ' + decisiveWords(lost, dec) + ' is ready. '
      + '<a data-act="drill" data-spec="' + esc(JSON.stringify({ type: 'game', id: lost.id, label: 'Game vs ' + lost.opp })) + '">Go through it ›</a>';
  } else if (ms) line += ' ' + ms + ' new mistake' + (ms === 1 ? '' : 's') + ' to learn from.';
  else line += ' Stockfish is reading them now.';
  return line;
}
/* the previous visit is read once per page load: a refresh or an hourly
   check for new games must not move it */
function computeGreeting() {
  var key = 'nl:lastSeen:' + playerId();
  if (data.prevSeenFor !== cfg.user) {
    data.prevSeen = store.get(key, 0);
    data.prevSeenFor = cfg.user;
    store.set(key, Date.now());
  }
  data.greeting = greetingLine(data.prevSeen);
}

function boot() {
  gen++;
  var myGen = gen;
  /* the saved formats belong to one player: another player starts from
     their own profile */
  if (!linkVisit && cfg.user && !perfsMine()) { cfg.perfs = null; cfg.tcs = DEFAULT_TC.slice(); }
  applyLinkTarget();
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) notice('You are offline. Showing what was saved last time.');
  if (!cfg.user) { renderHeader(); renderFirstVisit(); renderFoot(); return; }
  /* a link that names a player opens that player; it is remembered only
     when this browser has no player of its own yet */
  /* a link's player lives in this tab only (sessionStorage), and the page
     title never names anyone */
  document.title = 'notlichess.org';
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
  }
  var previewEarly = loadNarrPreview();
  loadUser()
    .then(function () {
      if (stale(myGen)) throw { stop: 'stale' };
      if (data.sections.user === 'fail' && data.userErr === 404) throw { stop: 'none' };
      returnEvents();
      /* first login: the formats come from the profile, no questions asked;
         a linked player always gets their own, in memory only */
      if ((linkVisit || !perfsMine()) && data.user) {
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
    })
    .catch(function (err) {
      if (err && err.stop === 'none') renderNoAccount();
      else if (!(err && err.stop === 'stale')) renderAll();
    });
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
  ['bl', 'mv', 'wp', 'opening', 'analysed'].forEach(function (k) { if (fresh[k] != null) old[k] = fresh[k]; });
}

/* ── progress between devices, as a file ────────────────────────────────── */
function exportProgress() {
  var u = playerId(), out = { v: 1, user: cfg.user, src: cfg.src, at: Date.now(), keys: {} };
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      if (k === 'nl:srs:' + u || k.indexOf('nl:day:' + u + ':') === 0)
        out.keys[k] = JSON.parse(localStorage.getItem(k));
    }
  } catch (e) {}
  var blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notlichess-progress-' + u.replace(':', '-') + '.json';
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
      /* on a first run (an iPhone home-screen app), the file says who you are */
      var fresh = !cfg.user && /^[a-zA-Z0-9_-]{2,30}$/.test(String(d.user || ''));
      if (fresh) { cfg.user = d.user; cfg.src = d.src === 'chesscom' ? 'chesscom' : 'lichess'; saveCfg('user'); saveCfg('src'); }
      if (String(d.user).toLowerCase() !== String(cfg.user).toLowerCase() || (d.src || 'lichess') !== cfg.src) {
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
      if (fresh) boot(); else renderAll();
    }).catch(function () { notice('That file could not be read.'); });
  };
  inp.click();
}

/* ── actions ─────────────────────────────────────────────────────────────── */
/* while the forcing reply is on its way (S10) a tap is input to it (it
   starts the reply, or is dropped), except these, which are neither board
   nor flow: Continue in a line shown (S7: it ends the card at any point),
   × and the menu's ways off the card (the reply is simply left behind),
   ••• and Details (the reply runs on underneath), and the Undo of a card
   just removed (it brings that card back) */
var REPLY_FREE = /^(next|endSession|skip|dispute|undoDispute|menu|details)$/;
/* the ••• menu opens or closes. During the forcing reply it is words like
   any other: drawn at once, or 150 ms after a piece that is moving lands,
   and the board is left alone */
function setMenu(a, open) {
  a.menuOpen = open;
  if (a.reply) stage(['text']); else renderCard();
}
function parseSpec(t) {
  try { return JSON.parse(t.getAttribute('data-spec')); } catch (e) { return null; }
}
document.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('[data-act]') : null;
  if (e.target.closest && e.target.closest('#bwrap [data-sq]')) {
    /* the press of this tap came while the forcing reply slid: dropped */
    if (pointerState.held) { pointerState.held = false; return; }
    if (pointerState.suppressClick) { pointerState.suppressClick = false; return; }
    var sqEl = e.target.closest('[data-sq]');
    sessionClick(parseInt(sqEl.getAttribute('data-sq'), 10));
    return;
  }
  if (!t) {
    var a0 = ui.session && ui.session.active;
    if (a0 && a0.menuOpen && !(e.target.closest && e.target.closest('.card-menu'))) setMenu(a0, false);
    return;
  }
  var act = t.getAttribute('data-act'), k = t.getAttribute('data-k');
  if (t.tagName === 'INPUT') return;
  if (act !== 'closeSheet' || e.target === t) e.preventDefault();
  /* input first: a running slide ends and whatever was staged catches up
     (while the forcing reply slides, the tap is dropped); then a bar slot
     that just changed ignores the tap (a double tap's second half) */
  var a1 = ui.session && ui.session.active;
  if (!(a1 && a1.reply && REPLY_FREE.test(act)) && flushStage()) return;
  var slot = t.getAttribute('data-slot');
  if (slot != null && slotGuarded(parseInt(slot, 10))) return;
  if (slot != null) pressSlot(parseInt(slot, 10));
  var a = ui.session && ui.session.active;
  /* a real click (a mouse or a finger: detail 1 and up) on the bar or the
     strip, not a key's (Enter clicks with detail 0) */
  var byPointer = e.detail > 0 && !!(t.closest && (t.closest('#cbar') || t.closest('#cstrip')) && !t.closest('#xp'));
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
    case 'findUser': findUser(el('firstUser') ? el('firstUser').value : ''); break;
    case 'pickSite': { var nm2 = t.getAttribute('data-n') || (el('firstUser') ? el('firstUser').value : ''); cfg.src = k === 'chesscom' ? 'chesscom' : 'lichess'; saveCfg('src'); setUser(nm2); break; }
    case 'useOtherSite': { var nm = cfg.user; cfg.src = k === 'chesscom' ? 'chesscom' : 'lichess'; saveCfg('src'); setUser(nm); break; }
    case 'logout': {
      if (k === 'confirm' && !ui.logoutArmed) {
        ui.logoutArmed = true;
        t.textContent = 'Tap again to switch';
        setTimeout(function () { ui.logoutArmed = false; renderSettings(); }, 4000);
        break;
      }
      ui.logoutArmed = false;
      flushSave();
      gen++;
      document.title = 'notlichess.org';
      /* switching away from a linked player keeps this browser's own player */
      if (!linkVisit) { store.del('nl:user'); store.del('nl:perfs'); store.del('nl:perfsFor'); cfg.perfs = null; }
      else { cfg.perfs = store.get('nl:perfs', null); cfg.tcs = store.get('nl:tcs', DEFAULT_TC.slice()); cfg.src = store.get('nl:src', 'lichess'); }
      forgetLink();
      cfg.user = '';
      ui.settingsOpen = false; ui.session = null; data.narrate = false; data.user = null;
      closeSheet();
      renderHeader(); renderFirstVisit(); renderFoot();
      break;
    }
    case 'settings':
      ui.wipeArmed = false; ui.resetArmed = false; ui.logoutArmed = false;
      if (ui.sheet === 'settings') closeSheet(); else openSheet('settings');
      break;
    case 'startToday': startToday(); break;
    case 'resume': resumeSession(); break;
    case 'dropSession': settleSaved(savedSession()); store.del(sessKey()); renderViews(); renderTrain(); break;
    case 'keepGoing': keepGoing(); break;
    case 'endSession': endSession(); break;
    case 'drill': { var sp = parseSpec(t); if (sp) startDrill(sp); break; }
    case 'sheet': openSheet(k); break;
    case 'closeSheet': if (e.target === t) closeSheet(); break;
    case 'hint': if (!tooSoon(a)) giveHint(); break;
    case 'reveal': if (!tooSoon(a)) reveal(); break;
    case 'skip': skipCard(); break;
    case 'next': nextCard(); break;
    case 'playIt': playIt(false); break;
    /* reduced motion: the forcing reply plays on this tap alone (S10, S19) */
    case 'theirReply': if (a) theirReply(a, true); break;
    case 'seeWhy': seeWhy(); break;
    /* closing it gives focus back to what opened it: the strip's link, or
       the ••• button whose menu offered it */
    case 'details': if (a && a.phase === 'done') {
      var fromMenu = !!a.menuOpen;
      if (fromMenu) setMenu(a, false);
      openSheet('details', fromMenu ? '#ctop [data-act="menu"]' : '#cstrip [data-act="details"]');
    } break;
    /* these wait out a card's first half second (tooSoon); a slot that
       just changed is ignored above (slotGuarded) */
    case 'dismissStronger': if (!tooSoon(a)) tryAgain(); break;
    case 'tryAgain': if (!tooSoon(a)) tryAgain(); break;
    case 'takeBack': if (!tooSoon(a)) takeBack(); break;
    case 'seeIt': if (!tooSoon(a)) seeIt(); break;
    case 'promo': promoChoose(k); break;
    case 'menu': if (a) { setMenu(a, !a.menuOpen); var mb0 = document.querySelector('#ctop [data-act="menu"]'); if (mb0) mb0.focus({ preventScroll: true }); } break;
    case 'dispute': disputeCard(k); break;
    case 'undoDispute': { var nt = t.closest && t.closest('.notice'); if (nt) nt.remove(); undoDispute(); break; }
    /* the story (S12): one ply per tap; its strip's names open a segment */
    case 'storyBack': storyStep(-1); break;
    case 'storyFwd': storyStep(1); break;
    case 'storyJump': storyJump(k); break;
    case 'xpBack': exploreStep(-1); break;
    case 'xpFwd': exploreStep(1); break;
    /* from the Details row, or the ••• item (S14) */
    case 'explore': if (a) { closeSheet(); startExplore({ via: k === 'menu' ? 'menu' : 'details' }); } break;
    case 'exploreOff': exploreExit('link'); break;
    case 'xpGo': if (a && a.explore) exploreGo(parseInt(k, 10)); break;
    case 'xpRow': if (a && a.explore) {
      var xn = xpCur(a.explore), xs = xpShown(a.explore, xn), xl = xs && xs[parseInt(k, 10)];
      var xm = xl && uciToMove(xn.st, xl.pv[0]);
      if (xm) { track(parseInt(k, 10) === 0 ? 'explore_pick' : 'explore_row'); a.explore.wantRow = 0; explorePlay(xm, false); }
    } break;
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
    case 'scanDepth': store.set('nl:scanDepth', k === 'thorough' ? 'thorough' : 'std'); track('scan_' + (k === 'thorough' ? 'thorough_on' : 'standard')); renderSettings(); autoScan(); setTimeout(autoEnrich, 500); break;
    case 'weekGoal': setWeekGoal(parseInt(k, 10)); renderSettings(); renderTrain(); break;
    case 'reload': checkForGames(); break;
    case 'exportProgress': exportProgress(); break;
    case 'importProgress': importProgress(); break;
    case 'engineRetry': SF.state = 'idle'; SF.crashes = []; engineLoad().then(function () { autoScan(); }, function () {}); renderAll(); break;
    case 'resetProgress': {
      if (!ui.resetArmed) { ui.resetArmed = true; renderSettings(); clearTimeout(ui.resetTimer); ui.resetTimer = setTimeout(function () { ui.resetArmed = false; renderSettings(); }, 4000); break; }
      var u = playerId();
      try {
        var del = [];
        var keys = Object.keys(mem);
        try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e4) {}
        keys.forEach(function (kk) { if (kk && (kk.indexOf('nl:day:' + u + ':') === 0 || kk === sessKey()) && del.indexOf(kk) === -1) del.push(kk); });
        del.forEach(function (x) { store.del(x); });
        store.del('nl:srs:' + u);
      } catch (e2) {}
      srsMem = null; srsRevision++; ui.session = null; ui.resetArmed = false; modelDirty();
      notice('Practice history reset. Your games and analysis are kept.');
      renderAll();
      break;
    }
    case 'wipe': {
      if (!ui.wipeArmed) { ui.wipeArmed = true; renderSettings(); clearTimeout(ui.wipeTimer); ui.wipeTimer = setTimeout(function () { ui.wipeArmed = false; renderSettings(); }, 4000); break; }
      try {
        var all = [];
        for (var j = 0; j < localStorage.length; j++) { var kj = localStorage.key(j); if (kj && kj.indexOf('nl:') === 0) all.push(kj); }
        /* nothing in memory may write itself back on the way out */
        data.wiped = true;
        cfg.user = '';
        data.games = [];
        all.forEach(function (x) { localStorage.removeItem(x); });
      } catch (e3) {}
      location.href = location.pathname;
      break;
    }
    case 'coffee': notice('Thank you. A tip jar is coming soon.'); break;
  }
  if (byPointer) pointerFocusBack(t);
});
/* a pointer's click on the bar or the strip leaves no focus on that control
   (I2): the keyboard goes back to the band's heading (or nowhere, where the
   band has none), so Enter is the right-hand button, as the key line says,
   never the control just clicked again. A control reached by Tab keeps it,
   and the key line names it (keyLine). Focus already moved by the action (a
   sheet, a verdict's right-hand button) stays where it went */
function pointerFocusBack(t) {
  var f = document.activeElement, bar = el('cbar'), sp = el('cstrip');
  if (!f || !((bar && bar.contains(f)) || (sp && sp.contains(f)) || f === t)) return;
  var h = el('task-h') || el('result-h');
  if (h) h.focus({ preventScroll: true });
  else if (f.blur) f.blur();
}
document.addEventListener('change', function (e) {
  var t = e.target;
  if (!t || !t.getAttribute) return;
  var act = t.getAttribute('data-act');
  if (act === 'sound') { cfg.sound = !!t.checked; saveCfg('sound'); }
});
document.addEventListener('keydown', function (e) {
  /* a held Enter sends the typed move once (its auto-repeat would send it
     again, or an empty box, as soon as the board takes moves again) */
  if (e.target && e.target.id === 'kbmove' && e.key === 'Enter') { e.preventDefault(); if (!e.repeat) typedMove(e.target.value); return; }
  /* typing belongs to the field, but Esc from the move field leaves exploring */
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && !(e.target.id === 'kbmove' && e.key === 'Escape')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  /* a held key acts once: the keyboard's auto-repeat never reaches the
     button that took the pressed one's place (a held Enter would go through
     Next and show the next card's answer, a held ? would give hint 2).
     Arrows keep repeating, to step through a line. Space repeats freely off
     a card, where it scrolls the page */
  if (e.repeat && (/^(Enter|\?|Escape)$/.test(e.key) || (e.key === ' ' && ui.session && ui.session.active))) { e.preventDefault(); return; }
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
    var ae = ui.session && ui.session.active;
    /* the menu closes first; during the forcing reply it is no input to it */
    if (!(ae && ae.menuOpen && ae.reply) && flushStage()) return;
    if (ae && ae.menuOpen) { setMenu(ae, false); var mb1 = document.querySelector('#ctop [data-act="menu"]'); if (mb1) mb1.focus({ preventScroll: true }); return; }
    if (ae && ae.explore) { e.preventDefault(); exploreExit('esc'); return; }
    /* the story: Esc goes back to the settled result */
    if (ae && ae.phase === 'done' && ae.view && ae.view.mode === 'story') { e.preventDefault(); backToSettled(); return; }
    /* a move still being checked: Esc takes it back (S3) */
    if (ae && ae.phase === 'checking') { e.preventDefault(); takeBack(); return; }
  }
  var a = ui.session && ui.session.active;
  if (!a || ui.sheet) return;
  /* the menu open: ↑ ↓ walk its items (the board is not touched) */
  if (a.menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); menuArrow(e.key === 'ArrowDown' ? 1 : -1); return; }
  /* a handled key is input: whatever was staged catches up first (while
     the forcing reply slides, the key is dropped) */
  if (/^(ArrowLeft|ArrowRight|Enter| |\?)$/.test(e.key) && flushStage()) { e.preventDefault(); return; }
  var onAct = !!(e.target && e.target.closest && e.target.closest('[data-act]'));
  if (a.phase === 'done') {
    /* ← → step the story (→ from S0 opens it), or the exploration's trail */
    var step = a.explore ? exploreStep : storyStep, inStory = !a.explore && a.view && a.view.mode === 'story';
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (!(a.explore && !xpArrow(a.explore, -1, e.repeat))) step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!(a.explore && !xpArrow(a.explore, 1, e.repeat))) step(1); }
    /* Enter is the right-hand button. Space steps the story forward (from
       the page or the bar, never in place of a strip name); elsewhere on an
       answered card it does nothing (S12) */
    else if (e.key === 'Enter' && !onAct) { e.preventDefault(); pressRight(); }
    else if (e.key === ' ' && inStory && (!onAct || e.target.closest('#cbar'))) { e.preventDefault(); storyStep(1); }
    else if (e.key === ' ' && !onAct) e.preventDefault();
  } else if (a.phase === 'guess' || a.phase === 'tried') {
    /* never a letter: letters start moves in the typed-move field. ? asks
       for a hint, Enter presses the right-hand button; both wait out the
       guard of the slot they stand for */
    if (e.key === '?') { e.preventDefault(); if (!slotGuarded(slotOfAct('hint'))) giveHint(); }
    else if (e.key === 'Enter' && !onAct) { e.preventDefault(); pressRight(); }
    /* → plays their reply to a wrong try (See it), as its button does */
    else if (e.key === 'ArrowRight' && a.phase === 'tried') { e.preventDefault(); pressAct('seeIt'); }
  } else if (a.phase === 'reply' && e.key === 'Enter' && !onAct) {
    /* under reduced motion the forcing reply waits for its button, the
       right-hand one (otherwise the key started the reply and was dropped) */
    e.preventDefault(); pressRight();
  } else if (a.phase === 'checking' && e.key === '?') {
    /* a move being checked keeps the guess bar until K1: ? does what its
       Hint button does, while that button is on */
    e.preventDefault();
    if (!a.checkSaid && slotOfAct('hint') >= 0 && !slotGuarded(slotOfAct('hint'))) giveHint();
  }
});
/* the right-hand button, pressed from the keyboard: a click on it, so the
   double-tap guard and the action are the button's own */
function pressRight() {
  var bar = el('cbar'), b = bar && bar.querySelector('[data-slot="' + rightSlot() + '"][data-act]');
  if (b) b.click();
}
/* a bar button pressed by its key (→ for See it), the same way */
function pressAct(act) {
  var i = slotOfAct(act), bar = el('cbar'), b = i >= 0 && bar && bar.querySelector('[data-slot="' + i + '"][data-act="' + act + '"]');
  if (b) b.click();
}
/* ↑ ↓ move through the open ••• menu's items, round from either end */
function menuArrow(d) {
  var items = [].slice.call(document.querySelectorAll('#ctop .menu-pop a'));
  if (!items.length) return false;
  var at = items.indexOf(document.activeElement);
  var to = at < 0 ? (d > 0 ? 0 : items.length - 1) : (at + d + items.length) % items.length;
  items[to].focus({ preventScroll: true });
  return true;
}
/* reduced motion: every slide, fade and crossfade takes 0 ms (in Node
   tests, ui.reducedTest says so) */
function reducedMotion() { return !!(ui.reducedTest || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)); }
/* a move typed as SAN (Nf3, exd5, O-O, e8=Q) or as squares (g1f3) */
function typedMove(txt) {
  if (flushStage()) return;
  var a = ui.session && ui.session.active;
  var xp = a && a.phase === 'done' && a.explore;
  if (!a || (a.phase !== 'guess' && a.phase !== 'tried' && !xp)) return;
  var st = xp ? a.explore.st : a.st;
  var t = String(txt || '').trim().replace(/0/g, 'O');
  var m = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(t) ? uciToMove(st, t.toLowerCase()) : null;
  /* a piece letter typed small ("qf3", "o-o") is read capitalised (I5): a
     small b is a bishop before a file letter ("bc4"), else first a pawn on
     the b-file ("b3", "bxc3") and then a bishop */
  var big = /^[kqrbno]/.test(t) ? (/^o-o/i.test(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)) : null;
  if (!m && big && !/^b([1-8]|x)/.test(t)) m = sanToMove(st, big);
  if (!m && t) m = sanToMove(st, t);
  if (!m && big) m = sanToMove(st, big);
  if (!m) { var eg = typedExample(st, xp ? [] : cardAvoid(a)); notice('That move is not legal here.' + (eg ? ' Try one like ' + eg + '.' : '')); return; }
  if (xp) { explorePlay(m, false); var kb = el('kbmove'); if (kb) { kb.value = ''; kb.focus(); } }
  else { if (a.phase === 'tried') clearTry(a); gradeMove(m); }
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
/* the bar's buttons keep the keyboard (a verdict hands it to the right-hand
   one); after a tap or a click that focus shows no ring, which is for
   someone who steers with keys */
document.addEventListener('pointerdown', function () { document.documentElement.classList.add('by-pointer'); }, true);
/* the sound context is unlocked by the player's own gestures (pointerup
   and keydown count as one everywhere; a touch's pointerdown does not) */
document.addEventListener('pointerup', sndWarm, true);
document.addEventListener('keydown', sndWarm, true);
document.addEventListener('keydown', function () { document.documentElement.classList.remove('by-pointer'); }, true);
document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-act][tabindex]:not(input)')) {
    e.preventDefault();
    /* Space presses nothing on an answered card's bar (S12): it is never
       Continue or See why, only Enter is the right-hand button (in the
       story the page's own handler takes Space as a step forward) */
    var sa = ui.session && ui.session.active;
    if (e.key === ' ' && sa && sa.phase === 'done' && !sa.explore && e.target.closest && e.target.closest('#cbar')) return;
    /* once per press: focus keeps its slot, so a repeat would press the
       button that just took this one's place */
    if (!e.repeat) e.target.click();
  }
});

/* ── board input: tap-tap and drag, on the card's own board only ─────────── */
var pointerState = { dragFrom: -1, rightFrom: -1, moved: false, suppressClick: false, swipe: null, held: false };
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
  /* the answer shown takes that one move by hand (S7) */
  var due = a.phase === 'done' && !a.showWait ? showDue(a) : null;
  if (due) return { st: a.st, live: true, show: due };
  if (a.phase === 'guess') return { st: a.st, live: true };
  if (a.phase === 'tried') return { st: triedFrame(a).st, live: true, tried: true };
  if (a.phase === 'checking') return { st: checkingFrame(a), live: false, checking: true };
  return { st: a.st, live: false };
}
document.addEventListener('pointerdown', function (e) {
  var a = ui.session && ui.session.active;
  pointerState.held = false;
  if (!a || !e.target.closest || !e.target.closest('#bwrap')) return;
  var sq = sqFromEvent(e);
  if (sq < 0) return;
  /* a drop's flag is for the click its own gesture makes; a touch drag (or a
     mouse drag that ends on another square) makes none on a square, so the
     flag would eat this press's click. Cleared before every early return */
  pointerState.suppressClick = false;
  /* input first: a running slide ends and the board catches up. While the
     forcing reply is on its way the press moves nothing (one on a piece of
     yours is kept for its landing, replyTap), and the click it makes is
     dropped too */
  if (flushStage(true)) { replyTap(a, sq); pointerState.held = true; return; }
  if (e.button === 2) { pointerState.rightFrom = sq; return; }
  var bs = boardState(a), took = false;
  /* a move on the board, being checked or tried: a press on the moved piece
     takes it back at once with nothing picked up, and the click this press
     makes is not a tap on the card's position (I1, and S3 alike); on a try
     a press on another piece of yours takes it back with that piece picked
     up, and the press (a tap or a drag) goes on from the real position.
     Anything else is answered by the click this press makes (sessionClick) */
  if (e.button === 0 && !a.pendingPromo && (bs.checking || bs.tried)) {
    var pick = bs.checking ? checkingPick(a, sq) : triedPick(a, sq);
    if (pick === TRY_ONLY || (bs.checking && pick >= 0)) { if (bs.checking) takeBack(); else tryAgain(); pointerState.held = true; return; }
    if (pick < 0) return;
    tryAgain(pick);
    bs = boardState(a);
    sq = pick;
    took = true;
  }
  /* a board that takes no moves (the answered card): a sideways swipe
     steps the story, so its start is kept when it is
     clear of both screen edges (iOS Back ends the session). A press on a
     piece there is answered by its click (N1) */
  if (e.button === 0 && !bs.live && !a.pendingPromo) {
    var W = window.innerWidth || 0;
    pointerState.swipe = e.clientX >= 24 && e.clientX <= W - 24 ? { x: e.clientX, y: e.clientY } : null;
    return;
  }
  if (e.button !== 0 || !bs.live || a.pendingPromo) return;
  /* the answer shown: only its own piece picks up; any other press is
     answered by its click (N1) */
  if (bs.show && sq !== bs.show.from) return;
  if (!bs.explore && !bs.show && a.shapes.length) { a.shapes = []; renderCardBoard(); }
  var p = bs.st.b[sq];
  if (p && isW(p) === bs.st.w) {
    pointerState.dragFrom = sq;
    pointerState.dragPiece = p;
    pointerState.moved = false;
    pointerState.startX = e.clientX;
    pointerState.startY = e.clientY;
    var cur = bs.explore ? a.explore.sel : a.sel;
    /* a piece just picked up: the click this press makes must not put it down */
    pointerState.justSelected = took || cur !== sq;
    /* a selection changes the board alone (exploring repaints its words too);
       a press that took a move back drew its selection with that board */
    if (!took && cur !== sq) { if (bs.explore) { a.explore.sel = sq; renderCard(); } else { a.sel = sq; snd('tap'); renderCardBoard(); } }
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
  var a = ui.session && ui.session.active, sw = pointerState.swipe;
  pointerState.swipe = null;
  if (!a) { pointerState.dragFrom = -1; pointerState.rightFrom = -1; killGhost(); return; }
  /* a swipe: at least 48 px across, twice as far across as down */
  if (sw && !cancelled) {
    var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > 2 * Math.abs(dy)) storySwipe(dx < 0 ? 1 : -1);
  }
  var sq = cancelled ? -1 : sqFromEvent(e);
  if (e.button === 2 && pointerState.rightFrom >= 0) {
    if (sq >= 0 && a.phase === 'guess') {
      if (sq === pointerState.rightFrom) a.shapes.push({ at: sq }); else a.shapes.push({ from: pointerState.rightFrom, to: sq });
      renderCardBoard();
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
    /* a result that arrived mid-drag is drawn now */
    if (a.explore && a.explore.dirty) { a.explore.dirty = false; renderCard(); }
  }
}
document.addEventListener('pointerup', function (e) { pointerFinish(e, false); });
/* a swipe on the answered board (S0, the story): forward (1, leftwards)
   or back (-1) through the story, as › and ‹ step it; from S0 forward opens
   it. Input first (2.2); the click a mouse swipe may send is not a tap */
function storySwipe(d) {
  var a = ui.session && ui.session.active;
  if (!a || a.phase !== 'done' || a.explore || a.pendingPromo || !a.view || (a.view.mode !== 's0' && a.view.mode !== 'story')) return false;
  pointerState.suppressClick = true;
  if (flushStage()) return true;
  storyStep(d);
  return true;
}
/* desktop: pointing at one of Stockfish's rows moves the one arrow to it */
function xpHover(k, byFocus) {
  var a = ui.session && ui.session.active, ex = a && a.explore;
  if (!ex || (!byFocus && !(window.matchMedia && window.matchMedia('(hover: hover)').matches))) return;
  var want = k == null ? 0 : k;
  ex.hover = k;
  if (ex.hot !== want) {
    ex.hot = want;
    renderCardBoard(a);
    var rows = document.querySelectorAll('#xp .xp-row[data-act="xpRow"]');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('on', parseInt(rows[i].getAttribute('data-k'), 10) === want);
  }
  /* rows held while pointed at: the latest lines show once the pointer leaves */
  if (k == null && xpThaw(ex)) renderCard();
}
/* the key line names what Enter presses: it follows the keyboard (2.0) */
document.addEventListener('focusin', function () { if (ui.session && ui.session.active) paintKeys(ui.session.active); });
document.addEventListener('focusout', function () { if (ui.session && ui.session.active) setTimeout(function () { if (ui.session && ui.session.active) paintKeys(ui.session.active); }, 0); });
document.addEventListener('focusin', function (e) {
  var r = e.target.closest && e.target.closest('#xp .xp-row[data-act="xpRow"]');
  if (r) xpHover(parseInt(r.getAttribute('data-k'), 10), true);
});
document.addEventListener('focusout', function (e) {
  if (ui.repainting) return;
  var r = e.target.closest && e.target.closest('#xp .xp-row[data-act="xpRow"]');
  if (r && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#xp .xp-row[data-act="xpRow"]'))) xpHover(null, true);
});
document.addEventListener('mouseover', function (e) {
  var r = e.target.closest && e.target.closest('#xp .xp-row[data-act="xpRow"]');
  if (r) xpHover(parseInt(r.getAttribute('data-k'), 10));
});
document.addEventListener('mouseout', function (e) {
  var r = e.target.closest && e.target.closest('#xp .xp-rows');
  if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) xpHover(null);
});
window.addEventListener('resize', function () { if (xpActive()) fitRows(); });
document.addEventListener('pointercancel', function (e) { pointerFinish(e, true); });

/* ── games: checking for new ones, formats, limits ───────────────────────── */
function checkForGames() {
  if (data.sections.games === 'loading') return;
  notice('Checking for new games…');
  loadGames().then(function () { setTimeout(autoScan, 500); });
}
var perfFetchTimer = null;
function perfsChanged() {
  /* a late fetch for the old formats must not land over the new ones */
  gen++;
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
             hints: a.hints, predraw: !!a.predraw, result: a.result || null, pattern: patternOf(a.it.b), view: a.view, tried: a.tried || null, reason: a.reason || 0, settle: a.settle || 0, showWait: !!a.showWait,
             reply: a.reply ? { uci: a.reply.uci, tele: !!a.reply.tele, played: !!a.reply.played, show: !!a.reply.show } : null,
             story: a.phase === 'done' && a.view && a.view.mode === 'story' ? (function (S) { return { i: a.view.i, n: S.steps.length, g: S.g, cap: S.steps[a.view.i].cap, pre: !!a.view.pre }; })(buildStory(a)) : null,
             lines: a.lines ? { best: a.lines.best.san, refute: a.lines.refute.san, game: a.lines.game.san } : null,
             sentences: a.cls ? a.cls.sentences : null, sel: a.sel, b: a.it.b, note: a.note && a.note.key === cardStateKey(a) ? a.note.id : null,
             verdict: a.verdict ? { kind: a.verdict.kind, row1: a.verdict.row1, row2: a.verdict.row2 } : null };
  },
  play: function (uci) {
    var a = ui.session && ui.session.active;
    if (!a) return 'no card';
    var st = a.phase === 'done' && a.explore ? a.explore.st : a.st;
    var m = uciToMove(st, uci);
    if (!m) return 'illegal';
    /* a try on the board is taken back first, as a tap on a piece does */
    if (a.phase === 'tried') tryAgain();
    /* the answer shown: its move is played (Play it) */
    var due = a.phase === 'done' && !a.explore && !a.showWait ? showDue(a) : null;
    if (due) { if (moveUci(due) !== uci) return 'not the answer'; playIt(false); return 'played'; }
    if (a.phase === 'guess') { gradeMove(m); return 'graded'; }
    if (a.phase === 'done' && a.explore) { explorePlay(m, false); return 'explored'; }
    return 'not guessing';
  },
  explore: function () {
    var a = ui.session && ui.session.active, ex = a && a.explore;
    if (!ex) return null;
    var n = xpCur(ex), r = ex.res[n.key];
    return { at: ex.at, n: ex.nodes.length, fens: ex.nodes.map(function (x) { return x.fen; }), key: n.key,
             lines: r ? r.lines.map(function (l) { return { pv: l.pv, cp: l.cp, mate: l.mate }; }) : null, step: r ? r.step : 0,
             say: sayAt(a, ex, ex.at), k: ex.k, spoil: xpSpoil(n) };
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
