/* notlichess.org service worker (F11.1): the app on the home screen, and a
   visit with no network. Registered by the page (src/js/15i-install.js).

   One cache per version holds the page, the manifest, the icons, the font
   and Stockfish, and nothing else, ever:
   - The page and the manifest come from the network first, revalidated (never
     a stale copy out of the browser's own cache), so a new deploy shows on
     the next visit online. The copy kept is the last one that came whole: it
     opens the app when the network is down, answers with an error, or takes
     longer than NET_WAIT to answer (the network's answer is still kept for
     the next visit).
   - Stockfish, the icons and the font (Nunito, fonts/) come from the cache
     first, so the installed app keeps its type offline. VERSION carries a
     hash of these files (test/sw.js checks it), so a deploy that changes one
     is a new version: the new worker fetches every file again into a cache
     of its own, takes over only once that cache is whole, then deletes the
     old one.
     A page open meanwhile keeps working: it was loaded whole, and Stockfish's
     two files always come from one cache (see hold).
   - Everything else goes to the network untouched: chess.com and lichess (the
     app keeps its games in localStorage itself), Clarity (only after the
     player's yes), any other site. The off switch, for an emergency, is in
     README.md (Deploy) and test/sw-off.js. */
'use strict';

/* "<layout>-<hash>": the layout is raised by hand when what the cache holds
   changes shape; the hash is the first 10 hex digits of the sha-256 of FILES
   (each path, a newline, its bytes), which test/sw.js recomputes */
var VERSION = '1-c6b014d2f5';
var PREFIX = 'notlichess-';
var CACHE = PREFIX + VERSION;
/* paths from the worker's scope, the site's root: '' is the page itself */
var PAGE = '';
var META = 'manifest.json';
var FILES = ['sf/stockfish.js', 'sf/stockfish.wasm', 'icons/favicon-32.png', 'icons/apple-touch-icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'fonts/nunito-latin-wght-normal.woff2'];
/* Stockfish: the .js, run as a worker, loads the .wasm beside it */
var PAIR = ['sf/stockfish.js', 'sf/stockfish.wasm'];
/* how long a page waits for the network before the kept copy opens it */
var NET_WAIT = 4000;
/* how long an answered .js waits for its .wasm to be asked for */
var HOLD = 20000;

function noop() {}
function at(p) { return new URL(p, self.registration.scope).href; }
/* a URL's path from the scope ('' for the scope itself), or null outside it
   (another site or another folder); the query and the fragment do not count */
function pathOf(href) {
  var u = new URL(href), s = new URL(self.registration.scope);
  if (u.origin !== s.origin || u.pathname.indexOf(s.pathname) !== 0) return null;
  return u.pathname.slice(s.pathname.length);
}
/* what a request is to this worker: 'page' (the app opened: index.html at
   the root), 'meta' (the manifest), 'file' (Stockfish, an icon or the
   font), or ''
   (not ours: it goes to the network as if there were no worker) */
function routeOf(req) {
  if (req.method !== 'GET') return '';
  var p = pathOf(req.url);
  if (p == null) return '';
  if (req.mode === 'navigate') return p === PAGE || p === 'index.html' ? 'page' : '';
  if (p === META) return 'meta';
  return FILES.indexOf(p) >= 0 ? 'file' : '';
}
/* only a whole answer from this site is kept: a 200, not opaque, not
   redirected (a redirected copy cannot answer a page's own request) */
function keepable(res) { return !!res && res.status === 200 && res.type === 'basic' && !res.redirected; }
function stale(name) { return name.indexOf(PREFIX) === 0 && name !== CACHE; }

/* a new version: every file into its own cache, all or none (addAll), each
   revalidated with the site (a file the browser already holds costs a 304),
   then it takes over as soon as the old worker has nothing in flight */
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll([PAGE, META].concat(FILES).map(function (p) { return new Request(at(p), { cache: 'no-cache' }); }));
  }).then(function () { return self.skipWaiting(); }));
});
/* in charge: the older versions' caches go (another site's caches, if this
   origin ever has any, are left alone) and the open pages are taken over */
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(stale).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request, kind = routeOf(req);
  if (!kind) return;
  if (kind !== 'file') { netFirst(event, kind); return; }
  var p = pathOf(req.url);
  if (p === PAIR[0]) event.waitUntil(hold());
  if (p === PAIR[1]) release();
  event.respondWith(cacheFirst(p));
});

/* the page or the manifest: the network's answer when it is good and in
   time, else the kept copy; a good answer replaces the copy, even one that
   came too late to be shown */
function netFirst(event, kind) {
  var page = kind === 'page', key = at(page ? PAGE : META), put = null;
  var net = fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: page ? 'manual' : 'follow' }).then(function (res) {
    if (keepable(res)) {
      var copy = res.clone();
      put = caches.open(CACHE).then(function (c) { return c.put(key, copy); });
    }
    return res;
  });
  event.waitUntil(net.then(function () { return put; }).catch(noop));
  event.respondWith(caches.open(CACHE).then(function (c) { return c.match(key); }).then(function (kept) {
    /* nothing kept yet: the network, whatever it says */
    if (!kept) return net;
    kept = plain(kept);
    var good = net.then(function (res) { return res.ok || res.type === 'opaqueredirect' ? res : kept; }, function () { return kept; });
    if (!page) return good;
    return Promise.race([good, new Promise(function (r) { setTimeout(function () { r(kept); }, NET_WAIT); })]);
  }));
}
/* a kept page answers the page's own request as a plain response (a copy
   from a redirect would be refused there) */
function plain(res) {
  return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

/* Stockfish, an icon or the font: the kept copy, else the network (kept for
   next time) */
function cacheFirst(p) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(at(p)).then(function (hit) { return hit || refill(cache, p); });
  });
}
/* a file the cache lacks (its storage cleared under a live worker): fetched
   and kept, Stockfish's two files together or not at all, so the cache never
   holds a .js and a .wasm from two deploys. One fetch for any number of
   asks; each ask then reads its own copy from the cache, or from the network
   when it could not be kept */
var filling = {};
function refill(cache, p) {
  var set = PAIR.indexOf(p) >= 0 ? PAIR : [p], id = set.join(' ');
  if (!filling[id]) {
    filling[id] = Promise.all(set.map(function (q) { return fetch(at(q), { cache: 'no-cache', credentials: 'same-origin' }); })).then(function (all) {
      if (!all.every(keepable)) return;
      return Promise.all(all.map(function (res, i) { return cache.put(at(set[i]), res); }));
    }).catch(noop).then(function () { delete filling[id]; });
  }
  return filling[id].then(function () { return cache.match(at(p)); }).then(function (hit) { return hit || fetch(at(p)); });
}

/* Stockfish starts with two asks: the .js, then the .wasm it loads. The
   event that answered the .js stays open until a .wasm is asked for (or HOLD
   passes), and a waiting version takes over only when this worker has no
   event open: an engine that started loading under one version loads its
   .wasm from that version's cache, never from the next one's. Several
   engines starting at once each hold their own, released in order */
var held = [];
function hold() {
  return new Promise(function (resolve) {
    var done = function () { var i = held.indexOf(done); if (i >= 0) held.splice(i, 1); resolve(); };
    held.push(done);
    setTimeout(done, HOLD);
  });
}
function release() { if (held.length) held[0](); }
