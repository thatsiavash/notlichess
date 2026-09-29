
/* ══════════════════════════════════════════════════════════════════════════
   notlichess.org
   ─────────────────────────────────────────────────────────────────────────
   Reference: projects/lichess-launcher/engineering-handoff.md (API, deep
   links, what is impossible) and design-handoff.md (visual language).

   The mistakes trainer: your own games, analysed in your browser, retrained
   until the mistakes stop. No backend; everything stays on this device.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── 1. Storage, tolerant of file:// and private windows ─────────────── */

var mem = {};
var store = {
  get: function (k, fallback) {
    try {
      var v = localStorage.getItem(k);
      if (v === null) return k in mem ? mem[k] : fallback;
      return JSON.parse(v);
    } catch (e) { return k in mem ? mem[k] : fallback; }
  },
  set: function (k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  },
  del: function (k) {
    delete mem[k];
    try { localStorage.removeItem(k); } catch (e) {}
  }
};

/* ── 2. Configuration ────────────────────────────────────────────────── */

/* Pools that lichess.org/#pool/ actually accepts. Anything else is silently
   ignored by the lobby, so those fall back to the pre-filled setup modal. */
var POOL_TC = ['1+0','2+1','3+0','3+2','5+0','5+3','10+0','10+5','15+10','30+0','30+20'];
var MAX_TC = 6;
var DEFAULT_TC = ['10+0','5+0','3+0'];
var FIRST_PAINT = 200;      /* render as soon as this many are in */
/* aggregate ceiling for progress display: quota x tracked formats */
function windowCap() { return cfg.perFormat * Math.max(1, trackedPerfs().length); }
var RETAIN_PER_FORMAT = 100; /* newest unanalysed games per format that keep
                                their movetext for the fetch-free scan batch */   /* every tracked format keeps at least this
                               many recent games, a 1000-game window of
                               mostly blitz must not starve the rapid coach */

/* a ?u= link was moved into this tab's sessionStorage by the head script,
   before any third party saw the address */
var params = new URLSearchParams(location.search);
var linkStore = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } } };
var urlUser = (linkStore.get('nl:linkUser') || params.get('u') || params.get('user') || '').trim();
var urlSrc = (linkStore.get('nl:linkSrc') || params.get('src') || '').trim();
/* the link is read once: a reload opens the saved player (or the landing),
   and while it is open nothing about the linked player is saved */
var linkVisit = !!urlUser, linkTracked = false;
try { sessionStorage.removeItem('nl:linkUser'); sessionStorage.removeItem('nl:linkSrc'); } catch (e) {}

/* Defaults per format lean no-increment: the most-played pools, and a
   clean three-tile Play stage for a fresh account. Increments stay one tap
   away in the edit panel. */
var PERF_TCS = { bullet: ['1+0'], blitz: ['5+0','3+0'],
                 rapid: ['10+0'], classical: ['30+0'] };
var PERF_HINT = { bullet: '1–2 min games', blitz: '3–5 min',
                  rapid: '10–15 min', classical: '30+ min' };
var cfg = {
  user: urlUser || store.get('nl:user', ''),
  tcs: linkVisit ? DEFAULT_TC.slice() : store.get('nl:tcs', DEFAULT_TC.slice()),
  sound: store.get('nl:sound', true),
  perfs: linkVisit ? null : store.get('nl:perfs', null),   /* the formats being trained; null = derive from tcs */
  hidden: store.get('nl:hidden', {}),
  findingsOff: store.get('nl:findingsOff', {}),
  perFormat: store.get('nl:perFormat', 500),  /* rated games kept per tracked format */
  reviewTcs: store.get('nl:reviewTcs', null),
  fromDate: store.get('nl:fromDate', null),
  newTab: store.get('nl:newTab', true),
  src: (urlSrc === 'chesscom' || urlSrc === 'lichess') ? urlSrc : store.get('nl:src', 'lichess')
};
function isCC() { return cfg.src === 'chesscom'; }
var CC = 'https://api.chess.com/pub';
function applyLinkTarget() {
  var b = document.getElementById('basetag');
  if (b) b.target = cfg.newTab ? '_blank' : '_self';
}
/* ?u=name wins for this visit but is not persisted, a shared link should not
   rewrite whoever's launcher this browser normally opens. Settings does that. */
function saveCfg(k) { store.set('nl:' + k, cfg[k]); }

/* Ephemeral view state, not persisted. */
var ui = {
  view: (function () {
    var h = (location.hash || '').replace('#', '');
    if (h === 'coach') h = 'insights';
    if (h === 'insights' || h === 'train') return h;
    return store.get('nl:view', 'train') === 'insights' ? 'insights' : 'train';
  })(),
  open: {},            /* which cards have their "+ n more" list open */
  openSkill: null,     /* which profile row is showing its evidence */
  editing: false,      /* Play card edit mode */
  settingsOpen: false
};

/* ── 3. Time control helpers ─────────────────────────────────────────── */

function tcParts(tc) {
  var p = String(tc).split('+');
  return { min: parseInt(p[0], 10) || 0, inc: parseInt(p[1], 10) || 0 };
}
function tcSeconds(tc) { var p = tcParts(tc); return p.min * 60 + 40 * p.inc; }
function tcPerf(tc) {
  var s = tcSeconds(tc);
  if (s < 30) return 'ultraBullet';
  if (s < 180) return 'bullet';
  if (s < 480) return 'blitz';
  if (s < 1500) return 'rapid';
  return 'classical';
}
function trackedPerfs() {
  /* The formats the user said they are training. Everything downstream -
     the export, the profile, the coach, the sessions, keys off this. */
  if (cfg.perfs && cfg.perfs.length) return cfg.perfs.slice();
  var seen = {}, out = [];
  cfg.tcs.forEach(function (tc) {
    var p = tcPerf(tc);
    if (!seen[p]) { seen[p] = 1; out.push(p); }
  });
  return out;
}

function setPerfs(perfs) {
  cfg.perfs = perfs;
  if (!linkVisit) { saveCfg('perfs'); store.set('nl:perfsFor', playerId()); }
  /* Time controls follow the formats so Play and the filters agree. */
  var tcs = [];
  perfs.forEach(function (p) { (PERF_TCS[p] || []).forEach(function (tc) { if (tcs.length < MAX_TC) tcs.push(tc); }); });
  if (tcs.length) { cfg.tcs = tcs; if (!linkVisit) saveCfg('tcs'); }
}

/* ── 4. Deep links (handoff §4) ──────────────────────────────────────── */

var L = 'https://lichess.org';
function playHref(tc) {
  if (isCC()) return 'https://www.chess.com/play/online';
  if (POOL_TC.indexOf(tc) !== -1) return L + '/#pool/' + tc;
  var p = tcParts(tc);
  return L + '/?time=realTime&minutesPerSide=' + p.min + '&increment=' + p.inc + '&gameMode=rated#hook';
}
function gameHref(id, color, ply) {
  if (isCC()) return 'https://www.chess.com/game/live/' + id;
  return L + '/' + id + (color ? '/' + color : '') + (ply ? '#' + ply : '');
}

/* ── 5. API layer ────────────────────────────────────────────────────── */
/* Lichess policy is one request at a time, and 429 carries no Retry-After,
   so we serialise every call and back off blind for 60s. */

var chain = Promise.resolve();
var backoffUntil = 0;
var lastLimitNotice = 0;

function queued(fn) {
  var run = function () {
    var wait = Math.max(0, backoffUntil - Date.now());
    return new Promise(function (r) { setTimeout(r, wait); }).then(fn);
  };
  var p = chain.then(run, run);
  chain = p.then(function () {}, function () {});
  return p;
}

function request(path, opts) {
  opts = opts || {};
  var headers = { Accept: opts.accept || 'application/json' };
  return queued(function () {
    return fetch(opts.abs ? path : L + path, {
      method: opts.method || 'GET',
      body: opts.body || undefined,
      headers: headers,
      redirect: opts.manualRedirect ? 'manual' : 'follow'
    }).then(function (res) {
      if (res.status === 429) {
        backoffUntil = Date.now() + 60000;
        /* background jobs (the scan, feed refreshes) ride the backoff
           silently; only work the user is waiting on gets a notice, and
           at most one every five minutes */
        if (!opts.quiet && Date.now() - lastLimitNotice > 300000) {
          lastLimitNotice = Date.now();
          notice((/chess\.com/.test(String(res.url || '')) ? 'chess.com' : 'lichess') + ' asked us to slow down. Picking the work back up in a minute.');
        }
        var err = new Error('rate-limited'); err.code = 429; throw err;
      }
      return res;
    });
  });
}

function getJSON(path, opts) {
  return request(path, opts).then(function (res) {
    if (res.status === 404) { var e = new Error('not found'); e.code = 404; throw e; }
    if (!res.ok) { var e2 = new Error('http ' + res.status); e2.code = res.status; throw e2; }
    return res.json();
  });
}

/* ndjson, streamed. onLine is called per record as it arrives. */
function getND(path, onLine, opts) {
  opts = opts || {};
  return request(path, { accept: 'application/x-ndjson', manualRedirect: opts.manualRedirect, quiet: opts.quiet })
    .then(function (res) {
      /* Handoff §3: /api/puzzle/* answers 303 to an HTML login page when the
         token is missing or lacks the scope. With redirect:'manual' that
         surfaces as an opaque redirect rather than silently becoming HTML. */
      if (res.type === 'opaqueredirect' || res.status === 303) {
        var e = new Error('auth required'); e.code = 401; throw e;
      }
      if (!res.ok) { var e2 = new Error('http ' + res.status); e2.code = res.status; throw e2; }
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (t) { splitND(t, onLine); });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      return (function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { if (buf.trim()) safeLine(buf, onLine); return; }
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(function (l) { safeLine(l, onLine); });
          return pump();
        });
      })();
    });
}
function safeLine(l, onLine) {
  l = l.trim();
  if (!l) return;
  try { onLine(JSON.parse(l)); } catch (e) {}
}
function splitND(text, onLine) {
  text.split('\n').forEach(function (l) { safeLine(l, onLine); });
}

/* ── 6. Game cache and normalisation ─────────────────────────────────── */



/* ── chess.com adapter ───────────────────────────────────────────────────
   Emits Lichess-SHAPED game objects, so compact() and everything above it
  , the scan pipeline, the sets, the coach, the openings, never know
   which site the games came from. Public API, no auth, CORS-open, and
   past-month archives never change.                                       */

function ccParsePgn(pgn) {
  var cut = pgn.lastIndexOf('\n\n');
  var body = cut >= 0 ? pgn.slice(cut + 2) : pgn;
  var moves = [], clocks = [];
  var re = /\{[^}]*\}|\S+/g, m2, tok;
  while ((m2 = re.exec(body))) {
    tok = m2[0];
    if (tok[0] === '{') {
      var ck = tok.match(/%clk (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (ck && moves.length) {
        clocks[moves.length - 1] = Math.round(
          ((+ck[1]) * 3600 + (+ck[2]) * 60 + parseFloat(ck[3])) * 100);
      }
      continue;
    }
    if (/^\d+\.+$/.test(tok)) continue;
    if (tok === '1-0' || tok === '0-1' || tok === '1/2-1/2' || tok === '*') break;
    moves.push(tok.replace(/[?!]+$/, ''));
  }
  for (var ci = 0; ci < moves.length; ci++) if (clocks[ci] == null) clocks[ci] = 0;
  return { moves: moves.join(' '), clocks: clocks.some(function (c) { return c > 0; }) ? clocks : null };
}

function ccOpeningName(pgn) {
  var m3 = pgn.match(/ECOUrl "[^"]*\/openings\/([^"]+)"/);
  if (!m3) return null;
  var slug = m3[1].replace(/(\.{3}|-\d+\.).*$/, '');
  var words = slug.split('-').filter(Boolean);
  if (!words.length) return null;
  var name = words.join(' ');
  /* synthesize the Family: Variation shape the rest of the app groups by */
  if (words.length > 2) return words.slice(0, 2).join(' ') + ': ' + words.slice(2).join(' ');
  return name;
}

var CC_STATUS = { checkmated: 'mate', timeout: 'outoftime', resigned: 'resign',
                  abandoned: 'resign', win: '', stalemate: 'stalemate',
                  agreed: 'draw', repetition: 'draw', insufficient: 'draw',
                  '50move': 'draw', timevsinsufficient: 'draw' };

function ccShape(g) {
  if (g.rules !== 'chess' || g.rated !== true) return null;
  if (['bullet', 'blitz', 'rapid'].indexOf(g.time_class) === -1) return null;
  var tcBits = String(g.time_control).split('+');
  var initial = parseInt(tcBits[0], 10);
  if (!isFinite(initial) || initial <= 0) return null;
  var parsed = ccParsePgn(g.pgn || '');
  if (!parsed.moves) return null;
  var wRes = g.white.result, bRes = g.black.result;
  var winner = wRes === 'win' ? 'white' : (bRes === 'win' ? 'black' : null);
  var loserRes = winner === 'white' ? bRes : (winner === 'black' ? wRes : wRes);
  return {
    id: (g.url || '').split('/').pop() || g.uuid,
    ccUrl: g.url || null,
    rated: true, variant: 'standard',
    speed: g.time_class, perf: g.time_class,
    createdAt: ccStartMs(g) || (g.end_time || 0) * 1000,
    lastMoveAt: (g.end_time || 0) * 1000,
    status: CC_STATUS[loserRes] || 'draw',
    winner: winner,
    players: {
      white: { user: { name: g.white.username, id: String(g.white.username).toLowerCase() },
               rating: g.white.rating },
      black: { user: { name: g.black.username, id: String(g.black.username).toLowerCase() },
               rating: g.black.rating }
    },
    opening: { name: ccOpeningName(g.pgn || '') },
    moves: parsed.moves,
    clocks: parsed.clocks,
    clock: { initial: initial, increment: parseInt(tcBits[1], 10) || 0 }
  };
}

function ccJSON(path, opts) {
  opts = opts || {};
  opts.abs = true;
  return request(CC + path, opts).then(function (res) {
    if (res.status === 404) { var e = new Error('404'); e.code = 404; throw e; }
    if (!res.ok) throw new Error('cc ' + res.status);
    return res.json();
  });
}

/* the walker: newest months first, until the window and every tracked
   format's floor are satisfied (or history runs out) */
function ccFetchGames(meId, onProgress, onFirstPaint) {
  var cached = liveCache();
  var since = cached.ts || 0;
  /* hd=1 on the cache means a prior walk reached the end of this account's
     history, so months older than the cache hold nothing new */
  var histDone = cached.hd === 1;
  data.ccHistDone = histDone;
  var monthFail = false;
  data.progressTarget = readTarget();   /* the foreground walk's real goal */
  var got = [], painted = false, n = 0;
  var mergeAll = function () {
    return merge(got.filter(Boolean), cached.games.filter(Boolean));
  };
  /* every tracked format gets its own quota, a dominant format can no
     longer squeeze the others out of a shared window */
  var Q = cfg.perFormat;
  /* chess.com serves only these three; a tracked format outside them
     (classical) must not make the quota unsatisfiable */
  var ccPerfs = trackedPerfs().filter(function (pf) {
    return ['bullet', 'blitz', 'rapid'].indexOf(pf) !== -1;
  });
  if (!ccPerfs.length) ccPerfs = ['rapid', 'blitz'];
  var countsOf = function (list) {
    var c = {};
    list.forEach(function (g) { c[g.perf] = (c[g.perf] || 0) + 1; });
    return c;
  };
  var quotasMet = function (list) {
    var c = countsOf(list);
    return ccPerfs.every(function (pf) { return (c[pf] || 0) >= Q; });
  };
  return ccJSON('/player/' + encodeURIComponent(cfg.user) + '/games/archives', { quiet: true })
    .then(function (a) {
      var months = (a.archives || []).slice().reverse();   /* newest first */
      var idx = 0;
      var fruitful = 0;      /* months that yielded games we KEPT, a month
                                of daily-only correspondence must not burn
                                the budget, or a returning player's old
                                blitz/rapid era is never reached */
      var MAX_FRUITFUL = 24; /* two years of tracked PLAYING is enough */
      var MAX_WALK = 120;    /* absolute bound: ten years of months, so an
                                account with no tracked games ever still
                                terminates */
      function step() {
        if (idx >= months.length || idx >= MAX_WALK || fruitful >= MAX_FRUITFUL) return null;
        var merged = mergeAll();
        /* a fresh walk hands off to the background hunt once one quota's
           worth of games is in, onboarding starts on a solid base while
           the rest streams in. Incremental runs keep walking even when
           full: new months must still land, and the cache-boundary check
           after each month ends the walk once nothing newer remains. */
        if (!since && (quotasMet(merged) || merged.length >= Q)) return null;
        var url = months[idx].replace(CC, '');
        idx++;
        return ccJSON(url, { quiet: idx > 2 }).then(function (mo) {
          var counts = {};
          mergeAll().forEach(function (g5) { counts[g5.perf] = (counts[g5.perf] || 0) + 1; });
          var kept = 0;
          (mo.games || []).slice().reverse().forEach(function (raw) {
            /* formats the user does not track must not squat in the
               window, lichess filters server-side via perfType, chess.com
               archives arrive unfiltered */
            if (trackedPerfs().indexOf(raw.time_class) === -1) return;
            var fresh = since && ((raw.end_time || 0) * 1000) > since;
            /* once the window is full, only formats still under their floor
               are worth keeping, no hoarding 18,000 blitz games while
               hunting two-year-old rapid. Games newer than the cache always
               enter: the save-time trim drops the oldest, never the newest. */
            if (!fresh && (counts[raw.time_class] || 0) >= Q) return;
            var shaped = ccShape(raw);
            if (!shaped) return;
            /* cached months are skipped only when history is known complete -
               a truncated cache (interrupted or buggy first walk) back-fills
               right here, the id-dedup absorbing the overlap */
            if (since && histDone && shaped.createdAt <= since) return;
            var c = compact(shaped, meId);
            if (!c) return;
            c.u = shaped.ccUrl;
            got.push(c);
            counts[c.perf] = (counts[c.perf] || 0) + 1;
            kept++;
            n++;
            if (onProgress) onProgress(Math.min(n, windowCap()));
          });
          if (!painted && mergeAll().length >= FIRST_PAINT && onFirstPaint) {
            painted = true;
            onFirstPaint(mergeAll());
          }
          if (kept) fruitful++;
          /* nothing found yet: let the narration say how deep we are
             instead of sitting on a frozen zero */
          if (!n && onProgress) onProgress(0, idx);
          /* crossing the cache boundary ends the incremental walk, unless
             the cached history is incomplete and the window still has room,
             in which case older months keep back-filling */
          if (since && mo.games && mo.games.length
              && (mo.games[0].end_time || 0) * 1000 <= since
              && (histDone || quotasMet(mergeAll()))) return null;
          return step();
        }).catch(function () { monthFail = true; return step(); });
      }
      return Promise.resolve(step()).then(function () {
        var merged = mergeAll();
        if (idx >= months.length && !monthFail) histDone = true;
        data.ccHistDone = histDone;
        /* floors unmet and history remains: keep walking quietly */
        if (!quotasMet(merged) && !histDone && idx < months.length && idx < MAX_WALK && fruitful < MAX_FRUITFUL) {
          var bgGen = gen;
          setTimeout(function bg() {
            if (stale(bgGen)) return;
            var listNow = data.games;
            var counts = {};
            listNow.forEach(function (g6) { counts[g6.perf] = (counts[g6.perf] || 0) + 1; });
            var done = ccPerfs.every(function (pf) { return (counts[pf] || 0) >= Q; });
            if (idx >= months.length) data.ccHistDone = true;
            if (done || idx >= months.length || idx >= MAX_WALK || fruitful >= MAX_FRUITFUL) return;
            var url2 = months[idx].replace(CC, '');
            idx++;
            ccJSON(url2, { quiet: true }).then(function (mo2) {
              if (stale(bgGen)) return;
              var byId = {};
              data.games.forEach(function (g7) { byId[g7.id] = 1; });
              var added = 0;
              (mo2.games || []).slice().reverse().forEach(function (raw2) {
                if (trackedPerfs().indexOf(raw2.time_class) === -1) return;
                if ((counts[raw2.time_class] || 0) >= Q) return;
                var shaped2 = ccShape(raw2);
                if (!shaped2 || byId[shaped2.id]) return;
                var c2 = compact(shaped2, meId);
                if (!c2) return;
                c2.u = shaped2.ccUrl;
                data.games.push(c2);
                counts[c2.perf] = (counts[c2.perf] || 0) + 1;
                added++;
              });
              if (added) {
                fruitful++;
                data.games.sort(function (a2, b2) { return b2.ts - a2.ts; });
                retainMovetext();
                saveGames(data.games);
                modelDirty();
                renderAll();
              }
              setTimeout(bg, 900);
            }).catch(function () { setTimeout(bg, 5000); });
          }, 1500);
        }
        return { games: merged, count: merged.length, all: histDone };
      });
    });
}

function compact(g, meId) {
  var w = g.players && g.players.white, b = g.players && g.players.black;
  if (!w || !b) return null;
  var meIsWhite = !!(w.user && w.user.id === meId);
  var meIsBlack = !!(b.user && b.user.id === meId);
  if (!meIsWhite && !meIsBlack) return null;
  var me = meIsWhite ? w : b, opp = meIsWhite ? b : w;
  var myColor = meIsWhite ? 'white' : 'black';

  var result = g.winner ? (g.winner === myColor ? 'win' : 'loss') : 'draw';

  var bl = blunderLedger(g, meIsWhite, { myR: me.rating, perf: g.perf || g.speed, res: result, color: myColor });
  return {
    id: g.id,
    ts: g.createdAt,
    perf: g.perf || g.speed,
    color: myColor,
    opp: (opp.user && (opp.user.name || opp.user.id)) || (opp.aiLevel ? 'Stockfish ' + opp.aiLevel : 'Anonymous'),
    oppR: opp.rating || null,
    myR: me.rating || null,
    rd: me.ratingDiff != null ? me.ratingDiff : null,
    res: result,
    status: g.status || '',
    opening: (g.opening && g.opening.name) || null,
    plies: (g.moves ? g.moves.split(' ').length : (g.analysis ? g.analysis.length : 0)),
    tc: g.clock ? (Math.round(g.clock.initial / 60) + '+' + g.clock.increment) : null,
    analysed: !!(g.analysis && g.analysis.length),
    /* in-memory only: unanalysed games carry their movetext up to the
       retention step, so the first scan batch needs zero extra fetches */
    mvTmp: !(g.analysis && g.analysis.length) && g.moves
      && (!g.variant || g.variant === 'standard') ? g.moves : null,
    ckTmp: !(g.analysis && g.analysis.length) && g.clocks
      && (!g.variant || g.variant === 'standard') ? g.clocks : null,
    wp: g.analysis && g.analysis.length ? analysisSeries(g) : null,
    /* moves are kept only when there are mistakes to replay from them;
       the opening prefix is kept for every game, it feeds the book */
    bl: bl,
    mv: bl ? g.moves : null,
    op16: g.moves && (!g.variant || g.variant === 'standard')
      ? g.moves.split(' ').slice(0, 16).join(' ') : null
  };
}

var CACHE_VERSION = 11;  /* bump whenever the compact record shape changes */
function cacheKey() {
  /* lichess keeps its historical key; chess.com namespaces to avoid a
     same-name collision across sites */
  return 'nl:games:' + (isCC() ? 'cc:' : '') + String(cfg.user).toLowerCase();
}

function loadCachedGames() {
  var c = store.get(cacheKey(), null);
  if (!c || !c.games) return { games: [], ts: 0, perfs: '' };
  if (c.v !== CACHE_VERSION) return { games: [], ts: 0, perfs: '' };
  /* a cache built for other formats keeps its games (and their analysis);
     it only asks for a full fetch so the new format's history arrives */
  if (c.perfs !== trackedPerfs().sort().join(',')) return { games: c.games, ts: 0, perfs: c.perfs, hd: 0, fetchedAt: c.fetchedAt };
  return c;
}

function trimGames(games) {
  /* newest quota per tracked format; untracked formats take no space */
  var Q = cfg.perFormat, per = {}, out = [], ids = {}, tp = trackedPerfs();
  for (var i = 0; i < games.length; i++) {
    var p = games[i].perf;
    if (tp.indexOf(p) === -1 || ids[games[i].id]) continue;
    ids[games[i].id] = 1;
    if ((per[p] || 0) >= Q) continue;
    per[p] = (per[p] || 0) + 1;
    out.push(games[i]);
  }
  return out;
}

function saveGames(games) {
  if (!cfg.user) return { games: games };
  var live = trimGames(games);
  var copy = function (g, lean) {
    var c = {}, k;
    for (k in g) {
      if (!g.hasOwnProperty(k) || k === 'mvTmp' || k === 'ckTmp' || k === 'dk') continue;
      /* lean: movetext kept only for a later scan can be fetched again */
      if (lean && (k === 'mv' || k === 'ck') && !g.bl) continue;
      c[k] = g[k];
    }
    return c;
  };
  var head = {
    v: CACHE_VERSION,
    ts: live.length ? live[0].ts : 0,
    hd: data.ccHistDone ? 1 : 0,
    at: Date.now(),
    fetchedAt: data.fetchedAt || (loadCachedGames().fetchedAt || 0),
    perfs: trackedPerfs().sort().join(',')
  };
  var write = function (list, lean) {
    var p = {}, k;
    for (k in head) p[k] = head[k];
    p.games = list.map(function (g) { return copy(g, lean); });
    return store.set(cacheKey(), p);
  };
  var out = function (list) { var p = {}, k; for (k in head) p[k] = head[k]; p.games = list; return p; };
  if (!data.leanSave && write(live, false)) return out(live);
  /* out of room, cheapest losses first: retained movetext, then other
     accounts' game caches (their practice history stays), then old games
     that hold no cards; games with cards are the last to go */
  data.leanSave = true;
  if (write(live, true)) return out(live);
  try {
    var mine = cacheKey(), drop = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf('nl:games:') === 0 && key !== mine) drop.push(key);
    }
    drop.forEach(function (x) { localStorage.removeItem(x); });
    if (drop.length) notice('This browser ran out of room, so the saved games of the other player' + (drop.length > 1 ? 's' : '')
      + ' here were cleared. Their practice history is kept, and their games come back on their next visit.');
  } catch (e) {}
  if (write(live, true)) return out(live);
  var keep = live.slice();
  for (var cut = 0; cut < 6; cut++) {
    var plain = keep.filter(function (g) { return !g.bl; });
    if (!plain.length) break;
    var gone = plain.slice(Math.floor(plain.length / 2));
    keep = keep.filter(function (g) { return gone.indexOf(g) === -1; });
    if (write(keep, true)) { storageNotice(keep.length); return out(keep); }
  }
  keep = keep.slice(0, Math.ceil(keep.length / 2));
  if (write(keep, true)) storageNotice(keep.length);
  return out(keep);
}
function storageNotice(n) {
  if (data.storageWarned) return;
  data.storageWarned = true;
  notice('This browser is short on storage, so ' + n + ' games are kept, including every game you practise from.');
}

/* evals=true AND division=true together are what make
   players.X.analysis.phases appear, Lichess's own per-phase accuracy, which
   beats anything we could reconstruct. Neither flag alone produces it. */
var GAME_PARAMS = 'rated=true&evals=true&accuracy=true&opening=true&clocks=true&division=true&sort=dateDesc';

function fetchGames(meId, onProgress, onFirstPaint) {
  if (isCC()) return ccFetchGames(meId, onProgress, onFirstPaint);
  var cached = liveCache();
  var incremental = cached.games.length && cached.ts && !data.needFull;
  data.ccHistDone = cached.hd === 1;
  data.progressTarget = null;
  var fresh = [], painted = false, rawN = 0;
  var collect = function (g) {
    rawN++;
    var c = compact(g, meId);
    if (!c) return;
    fresh.push(c);
    if (onProgress) onProgress(fresh.length, c);
    /* First useful picture well before the tail arrives. */
    if (!painted && !incremental && fresh.length >= FIRST_PAINT) {
      painted = true;
      if (onFirstPaint) onFirstPaint(merge(fresh, cached.games));
    }
  };
  var work;
  if (incremental) {
    /* only ask for what happened since the newest cached game */
    work = getND('/api/games/user/' + encodeURIComponent(cfg.user)
      + '?perfType=' + trackedPerfs().join(',') + '&' + GAME_PARAMS
      + '&since=' + (cached.ts - 12 * 3600 * 1000) + '&max=' + windowCap(), collect);
  } else {
    /* one stream per tracked format, so each fills its own quota instead
       of sharing a window the dominant format would hog */
    var allShort = true;
    work = Promise.resolve();
    trackedPerfs().forEach(function (p) {
      work = work.then(function () {
        var before = rawN;
        return getND('/api/games/user/' + encodeURIComponent(cfg.user)
          + '?perfType=' + p + '&' + GAME_PARAMS + '&max=' + cfg.perFormat, collect
        ).then(function () {
          if (rawN - before >= cfg.perFormat) allShort = false;
        });
      });
    });
    /* every stream came back short: we now hold every rated game they have */
    work = work.then(function () { data.ccHistDone = allShort; });
  }
  return work.then(function () {
    data.fetchedAt = Date.now();
    data.needFull = false;
    var pay = saveGames(merge(fresh, cached.games));
    pay.all = data.ccHistDone;
    return pay;
  }).catch(function (err) {
    if (cached.games.length) { cached.all = false; return cached; }
    throw err;
  });
}

function merge(fresh, old) {
  var oldBy = {};
  old.forEach(function (g) { oldBy[g.id] = g; });
  var seen = {};
  var all = fresh.concat(old).filter(function (g) {
    if (seen[g.id]) return false;
    seen[g.id] = 1;
    return true;
  });
  /* a refetched game keeps what the engine and the player already did */
  all.forEach(function (g) {
    var o = oldBy[g.id];
    if (!o || o === g) return;
    if (!g.analysed && (o.scanned || o.bl)) {
      ['bl', 'mv', 'scanned', 'wp', 'eng'].forEach(function (k) { if (o[k] != null) g[k] = o[k]; });
    } else if (g.analysed && o.bl) {
      adoptFresh(o, g);
      ['bl', 'mv', 'wp', 'eng'].forEach(function (k) { if (o[k] != null) g[k] = o[k]; });
    }
  });
  all.sort(function (a, b) { return b.ts - a.ts; });
  return all;
}

/* ── 6c. Blunder taxonomy ────────────────────────────────────────────────
   A mistake with a name teaches more than a bare eval swing. Heuristics
   only, no engine needed at classification time, so they are chosen to be
   right when they speak and silent when unsure.                            */

var PIECE_VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 99 };

/* ── 6b. SAN replay ──────────────────────────────────────────────────────
   Just enough chess to turn a Lichess movetext into the FEN at any ply, so
   a mistake can be reopened on the analysis board at the exact position.
   Legality (does this move leave my king attacked?) is required because SAN
   disambiguation depends on it: with two knights able to reach d2, "Nd2" is
   only unambiguous when one of them is pinned.                             */

var KNIGHT_D = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
var BISHOP_D = [[1,1],[1,-1],[-1,1],[-1,-1]];
var ROOK_D   = [[0,1],[0,-1],[1,0],[-1,0]];

function chessStart() {
  var b = new Array(64).fill(null);
  var back = 'RNBQKBNR';
  for (var f = 0; f < 8; f++) {
    b[f] = back[f]; b[8 + f] = 'P';
    b[48 + f] = 'p'; b[56 + f] = back[f].toLowerCase();
  }
  return { b: b, w: true, cast: 'KQkq', ep: -1, half: 0, full: 1 };
}
function sqOk(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
function isW(p) { return p >= 'A' && p <= 'Z'; }

function squareAttacked(b, sq, byWhite) {
  var f = sq % 8, r = sq >> 3, i, d, tf, tr, p;
  for (i = 0; i < 8; i++) {
    d = KNIGHT_D[i]; tf = f + d[0]; tr = r + d[1];
    if (sqOk(tf, tr)) {
      p = b[tr * 8 + tf];
      if (p && isW(p) === byWhite && p.toUpperCase() === 'N') return true;
    }
  }
  var rays = BISHOP_D.concat(ROOK_D);
  for (i = 0; i < 8; i++) {
    d = rays[i]; tf = f + d[0]; tr = r + d[1];
    var step = 1;
    while (sqOk(tf, tr)) {
      p = b[tr * 8 + tf];
      if (p) {
        if (isW(p) === byWhite) {
          var u = p.toUpperCase();
          var diag = d[0] !== 0 && d[1] !== 0;
          if (u === 'Q' || (diag ? u === 'B' : u === 'R')) return true;
          if (step === 1 && u === 'K') return true;
          if (step === 1 && u === 'P' && diag) {
            /* a pawn on this adjacent diagonal attacks sq if sq is in front
               of it: white pawns attack upward, so they sit one rank below */
            if (byWhite ? d[1] === -1 : d[1] === 1) return true;
          }
        }
        break;
      }
      tf += d[0]; tr += d[1]; step++;
    }
  }
  return false;
}
function kingSq(b, white) {
  var k = white ? 'K' : 'k';
  for (var i = 0; i < 64; i++) if (b[i] === k) return i;
  return -1;
}
function leavesCheck(st, from, to, epCapture, promo) {
  var b = st.b.slice();
  var p = b[from];
  b[to] = promo ? (st.w ? promo : promo.toLowerCase()) : p;
  b[from] = null;
  if (epCapture >= 0) b[epCapture] = null;
  return squareAttacked(b, kingSq(b, st.w), !st.w);
}
function pseudoReaches(b, from, to, piece) {
  var ff = from % 8, fr = from >> 3, tf = to % 8, tr = to >> 3;
  var df = tf - ff, dr = tr - fr;
  switch (piece) {
    case 'N': return (df*df + dr*dr) === 5;
    case 'K': return Math.max(Math.abs(df), Math.abs(dr)) === 1;
    case 'B': if (Math.abs(df) !== Math.abs(dr) || !df) return false; break;
    case 'R': if (df && dr) return false; break;
    case 'Q': if (df && dr && Math.abs(df) !== Math.abs(dr)) return false;
              if (!df && !dr) return false; break;
    default: return false;
  }
  var sf = df ? (df > 0 ? 1 : -1) : 0, sr = dr ? (dr > 0 ? 1 : -1) : 0;
  var f = ff + sf, r = fr + sr;
  while (f !== tf || r !== tr) {
    if (b[r * 8 + f]) return false;
    f += sf; r += sr;
  }
  return true;
}

/* Applies one SAN token in place. Returns false only on a token it cannot
   read, which callers treat as "stop replaying this game". */
/* a SAN token as a legal move of this position, or null; an explicit
   promotion piece is honoured, otherwise the first (queen) is taken */
function sanToMove(st, tok) {
  var m = sanApply(cloneState(st), tok);
  if (!m) return null;
  var want = (/=([QRBN])/.exec(String(tok)) || [])[1] || m.promo;
  return legalMoves(st).filter(function (x) { return x.from === m.from && x.to === m.to && (!x.promo || !want || x.promo === want); })[0] || null;
}
function sanApply(st, san) {
  var tok = san.replace(/[+#?!]+$/, '');
  var me = st.w, b = st.b;
  var moved = false, from = -1, to = -1, promo = null, ep = -1, capture = false;

  if (tok === 'O-O' || tok === 'O-O-O' || tok === '0-0' || tok === '0-0-0') {
    var r = me ? 0 : 56;
    var short_ = tok.length < 4;
    var kf = r + 4, kt = r + (short_ ? 6 : 2), rf = r + (short_ ? 7 : 0), rt = r + (short_ ? 5 : 3);
    b[kt] = b[kf]; b[kf] = null; b[rt] = b[rf]; b[rf] = null;
    from = kf; to = kt; moved = true;
  } else if (tok[0] >= 'a' && tok[0] <= 'h') {
    /* pawn: e4, exd5, e8=Q, exd8=Q */
    var mEq = tok.indexOf('=');
    if (mEq >= 0) { promo = tok[mEq + 1]; tok = tok.slice(0, mEq); }
    capture = tok.indexOf('x') >= 0;
    var dest = tok.slice(-2);
    to = (dest.charCodeAt(1) - 49) * 8 + (dest.charCodeAt(0) - 97);
    var dir = me ? 8 : -8;
    if (capture) {
      var fromFile = tok.charCodeAt(0) - 97;
      from = to - dir - (to % 8 - fromFile);
      if (!b[to] && to === st.ep) ep = to - dir;           /* en passant */
    } else {
      from = to - dir;
      if (!b[from]) from = to - 2 * dir;                   /* double push */
    }
    if (from < 0 || from > 63 || !b[from] || b[from].toUpperCase() !== 'P') return false;
    if (leavesCheck(st, from, to, ep, promo)) return false;
    if (ep >= 0) b[ep] = null;
    b[to] = promo ? (me ? promo : promo.toLowerCase()) : b[from];
    b[from] = null;
    moved = true;
  } else {
    /* piece: Nf3, Nbd2, N1d2, Nbxd4, Qh4xe1 */
    var piece = tok[0];
    var body = tok.slice(1).replace('x', '');
    capture = tok.indexOf('x') >= 0;
    var dest2 = body.slice(-2);
    var dis = body.slice(0, -2);
    to = (dest2.charCodeAt(1) - 49) * 8 + (dest2.charCodeAt(0) - 97);
    var disF = -1, disR = -1;
    for (var di = 0; di < dis.length; di++) {
      var c = dis[di];
      if (c >= 'a' && c <= 'h') disF = c.charCodeAt(0) - 97;
      else if (c >= '1' && c <= '8') disR = c.charCodeAt(0) - 49;
    }
    var want = me ? piece : piece.toLowerCase();
    for (var i = 0; i < 64; i++) {
      if (b[i] !== want) continue;
      if (disF >= 0 && i % 8 !== disF) continue;
      if (disR >= 0 && (i >> 3) !== disR) continue;
      if (!pseudoReaches(b, i, to, piece)) continue;
      if (leavesCheck(st, i, to, -1, null)) continue;
      from = i;
      break;
    }
    if (from < 0) return false;
    b[to] = b[from]; b[from] = null;
    moved = true;
  }
  if (!moved) return false;

  /* State bookkeeping: rights, en passant, clocks of the FEN kind. */
  var pc = b[to].toUpperCase();
  if (pc === 'K') st.cast = st.cast.replace(me ? /[KQ]/g : /[kq]/g, '');
  [[0,'Q'],[7,'K'],[56,'q'],[63,'k']].forEach(function (cr) {
    if (from === cr[0] || to === cr[0]) st.cast = st.cast.replace(cr[1], '');
  });
  st.ep = (pc === 'P' && Math.abs(to - from) === 16) ? (from + to) / 2 : -1;
  st.half = (pc === 'P' || capture || ep >= 0) ? 0 : st.half + 1;
  if (!me) st.full++;
  st.w = !me;
  return { from: from, to: to, promo: promo ? promo.toUpperCase() : null };
}

function checkedKingSq(st) {
  var k = kingSq(st.b, st.w);
  return k >= 0 && squareAttacked(st.b, k, !st.w) ? k : null;
}

function stateFen(st) {
  var rows = [];
  for (var r = 7; r >= 0; r--) {
    var row = '', run = 0;
    for (var f = 0; f < 8; f++) {
      var p = st.b[r * 8 + f];
      if (p) { if (run) { row += run; run = 0; } row += p; }
      else run++;
    }
    if (run) row += run;
    rows.push(row);
  }
  var ep = st.ep >= 0
    ? String.fromCharCode(97 + st.ep % 8) + (1 + (st.ep >> 3)) : '-';
  return rows.join('/') + ' ' + (st.w ? 'w' : 'b') + ' ' + (st.cast || '-')
    + ' ' + ep + ' ' + st.half + ' ' + st.full;
}

function cloneState(st) {
  return { b: st.b.slice(), w: st.w, cast: st.cast, ep: st.ep, half: st.half, full: st.full };
}

/* Every legal move for the side to play, as {from, to, promo}. The trainer
   needs this twice over: to know what a clicked piece may do, and to apply
   the user's answer with the same bookkeeping the replay uses. */
function legalMoves(st) {
  var out = [], b = st.b, me = st.w;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (!p || isW(p) !== me) continue;
    var u = p.toUpperCase(), f = i % 8, r = i >> 3;
    if (u === 'P') {
      var dir = me ? 8 : -8, startR = me ? 1 : 6, lastR = me ? 7 : 0;
      var one = i + dir;
      var push = function (to, viaEp) {
        if (leavesCheck(st, i, to, viaEp != null ? viaEp : -1, null)) return;
        if ((to >> 3) === lastR) ['Q','R','B','N'].forEach(function (pr) {
          out.push({ from: i, to: to, promo: pr, ep: viaEp != null ? viaEp : -1 });
        });
        else out.push({ from: i, to: to, promo: null, ep: viaEp != null ? viaEp : -1 });
      };
      if (one >= 0 && one < 64 && !b[one]) {
        push(one);
        var two = i + 2 * dir;
        if (r === startR && !b[two]) push(two);
      }
      [-1, 1].forEach(function (df) {
        var tf = f + df;
        if (tf < 0 || tf > 7) return;
        var to = one + df;
        if (to < 0 || to > 63) return;
        if (b[to] && isW(b[to]) !== me) push(to);
        else if (!b[to] && to === st.ep) push(to, to - dir);
      });
    } else {
      for (var t = 0; t < 64; t++) {
        if (b[t] && isW(b[t]) === me) continue;
        if (!pseudoReaches(b, i, t, u)) continue;
        if (leavesCheck(st, i, t, -1, null)) continue;
        out.push({ from: i, to: t, promo: null, ep: -1 });
      }
    }
  }
  /* Castling: rights intact, path empty, king never crossing an attacked
     square. sanApply's O-O path does the same board surgery. */
  var base = me ? 0 : 56, kf = base + 4;
  var rights = me ? ['K', 'Q'] : ['k', 'q'];
  if (b[kf] && b[kf].toUpperCase() === 'K' && !squareAttacked(b, kf, !me)) {
    if (st.cast.indexOf(rights[0]) >= 0 && !b[base + 5] && !b[base + 6]
        && b[base + 7] && b[base + 7].toUpperCase() === 'R'
        && !squareAttacked(b, base + 5, !me) && !squareAttacked(b, base + 6, !me))
      out.push({ from: kf, to: base + 6, promo: null, ep: -1, castle: 'O-O' });
    if (st.cast.indexOf(rights[1]) >= 0 && !b[base + 3] && !b[base + 2] && !b[base + 1]
        && b[base] && b[base].toUpperCase() === 'R'
        && !squareAttacked(b, base + 3, !me) && !squareAttacked(b, base + 2, !me))
      out.push({ from: kf, to: base + 2, promo: null, ep: -1, castle: 'O-O-O' });
  }
  return out;
}

/* Apply a generated move (not SAN) with the same state bookkeeping. */
function applyMove(st, m) {
  var b = st.b, me = st.w;
  var wasCapture = m.ep >= 0 || b[m.to] != null;   /* read before the surgery */
  if (m.castle) {
    var base2 = me ? 0 : 56, short_ = m.castle === 'O-O';
    b[m.to] = b[m.from]; b[m.from] = null;
    var rf = base2 + (short_ ? 7 : 0), rt = base2 + (short_ ? 5 : 3);
    b[rt] = b[rf]; b[rf] = null;
  } else {
    if (m.ep >= 0) b[m.ep] = null;
    b[m.to] = m.promo ? (me ? m.promo : m.promo.toLowerCase()) : b[m.from];
    b[m.from] = null;
  }
  var pc = b[m.to].toUpperCase();
  if (pc === 'K') st.cast = st.cast.replace(me ? /[KQ]/g : /[kq]/g, '');
  [[0,'Q'],[7,'K'],[56,'q'],[63,'k']].forEach(function (cr) {
    if (m.from === cr[0] || m.to === cr[0]) st.cast = st.cast.replace(cr[1], '');
  });
  st.ep = (pc === 'P' && Math.abs(m.to - m.from) === 16) ? (m.from + m.to) / 2 : -1;
  st.half = (pc === 'P' || wasCapture) ? 0 : st.half + 1;
  if (!me) st.full++;
  st.w = !me;
}

/* The state (not just the FEN) after `plies` half-moves, the trainer
   continues from it. */
function stateAtPly(moves, plies) {
  var st = chessStart();
  var toks = moves.split(' ');
  if (plies > toks.length) return null;
  for (var i = 0; i < plies; i++) {
    if (!sanApply(st, toks[i])) return null;
  }
  return st;
}

function analysisHref(fen, color) {
  if (isCC()) {
    return 'https://www.chess.com/analysis?fen=' + encodeURIComponent(fen)
      + (color === 'black' ? '&flip=true' : '');
  }
  return L + '/analysis/standard/' + fen.replace(/ /g, '_')
    + (color === 'black' ? '?color=black' : '');
}

/* Lichess's own centipawn-to-win-chance curve, so "blunder" here means what
   it means in their annotations. */
function winPct(cp) {
  return Math.round(10 * (50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1))) / 10;
}

/* ── 7. Small formatters ─────────────────────────────────────────────── */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function ago(ms) {
  var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  var m = Math.round(s / 60);
  if (m < 60) return m + 'm';
  var h = Math.round(m / 60);
  if (h < 36) return h + 'h';
  var d = Math.round(h / 24);
  if (d < 14) return d + 'd';
  return monthYear(ms);
}
function monthYear(ms) {
  var d = new Date(ms);
  var now = new Date();
  var m = d.toLocaleDateString('en-GB', { month: 'long' });
  return d.getFullYear() === now.getFullYear() ? m : m + ' ' + d.getFullYear();
}

/* ── 8. Application data ─────────────────────────────────────────────── */

/* Every boot bumps this. Async work checks it before touching state, so a
   slow load for the previous username cannot land on the new one. */
var gen = 0;
function stale(myGen) { return myGen !== gen; }

var data = {
  user: null, history: null, games: [], gamesErr: null,
  playing: null, tv: null, broadcast: null, tours: null, studies: null,
  sections: {}   /* per-section load state: 'loading' | 'ok' | 'fail' */
};



