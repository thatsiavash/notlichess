// The service worker (sw.js at the root, F11.1), run in Node: its file is loaded into a vm with a fake
// CacheStorage, a fake network and fake timers, and its install, activate and fetch handlers are driven
// with fake events. Run from session.test.js: await require('./sw')() returns the failures (none when
// all hold).
//   The version: VERSION carries the sha-256 of the files kept cache-first, so changing Stockfish, an
//   icon or the font without a new VERSION fails here (with the value to set); the files exist and cover
//   what the manifest, the page and app.css name (the icons, Nunito's woff2); sw.js lints clean.
//   The cache: one per version ("notlichess-" + VERSION), filled all or nothing at install, each file
//   revalidated; a new version deletes the older ones and leaves other caches alone.
//   The rules: the page and the manifest network first (a fresh deploy shown and kept, the kept copy
//   when offline, on an error or after NET_WAIT, nothing kept from a bad answer); Stockfish and the
//   icons and the font cache first, Stockfish refilled as a pair; the .js's event held open until its
//   .wasm is asked for (or HOLD); chess.com, lichess, Clarity, other sites and the rest of the site never
//   answered or kept.
//   The off switch (test/sw-off.js, V5.6): deployed as sw.js in an emergency, it takes over at once,
//   deletes the notlichess- caches and no other, then unregisters, and answers no request; README.md
//   gives it word for word, beside the Render headers and the two checks after a deploy.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
/* NL_SW: another copy of sw.js to check (to prove a check can fail) */
const SW_FILE = process.env.NL_SW || path.join(ROOT, 'sw.js');
const SCOPE = 'https://notlichess.org/';
const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await tick(); };

/* the files' hash, as VERSION carries it: each path, a newline, its bytes */
function hashOf(files) {
  const h = crypto.createHash('sha256');
  files.forEach((f) => { h.update(f + '\n'); h.update(fs.readFileSync(path.join(ROOT, f))); });
  return h.digest('hex').slice(0, 10);
}

class FakeResponse {
  constructor(body, init) {
    init = init || {};
    this._body = body == null ? '' : String(body);
    this.status = init.status == null ? 200 : init.status;
    this.statusText = init.statusText || '';
    this.headers = init.headers || {};
    this.type = init.type || 'basic';
    this.redirected = !!init.redirected;
    this.used = false;
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  get body() { return this._body; }
  clone() { if (this.used) throw new TypeError('clone of a used body'); return new FakeResponse(this._body, this); }
  text() { if (this.used) return Promise.reject(new TypeError('body used twice')); this.used = true; return Promise.resolve(this._body); }
}
class FakeRequest {
  constructor(url, init) {
    init = init || {};
    this.url = typeof url === 'string' ? url : url.url;
    this.method = init.method || 'GET';
    this.mode = init.mode || 'cors';
    this.cache = init.cache || 'default';
    this.credentials = init.credentials || 'same-origin';
    this.redirect = init.redirect || 'follow';
  }
}

/* one world: the caches (shared by every worker loaded into it), the network, the timers */
function world() {
  const W = { log: [], online: true, files: {}, hung: [], hang: false, timers: [] };
  /* the site as deployed: path -> { body, status, type, redirected }; the root and /index.html are one
     file, as a static host serves them */
  W.deploy = (o) => { W.files = Object.assign({}, W.files, o); if (o['']) W.files['index.html'] = o['']; };
  W.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const o = Object.assign({}, typeof input === 'string' ? {} : { cache: input.cache, redirect: input.redirect }, init || {});
    W.log.push({ url, cache: o.cache || 'default', redirect: o.redirect || 'follow' });
    if (!W.online) return Promise.reject(new TypeError('Failed to fetch'));
    const answer = () => {
      const u = new URL(url), f = u.origin + '/' === SCOPE ? W.files[u.pathname.slice(1)] : null;
      if (!f) return new FakeResponse('not found', { status: 404 });
      return new FakeResponse(f.body, { status: f.status || 200, type: f.type || 'basic', redirected: !!f.redirected });
    };
    if (W.hang) return new Promise((r) => W.hung.push(() => r(answer())));
    return Promise.resolve(answer());
  };
  W.unhang = () => { W.hang = false; W.hung.splice(0).forEach((f) => f()); };
  /* the cache API, as far as sw.js uses it; a stored answer is read whole */
  const stores = new Map();
  class FakeCache {
    constructor() { this.m = new Map(); }
    key(r) { return (typeof r === 'string' ? r : r.url).split('#')[0]; }
    match(r) { const e = this.m.get(this.key(r)); return Promise.resolve(e ? e.clone() : undefined); }
    put(r, res) {
      const k = this.key(r);
      return res.text().then((b) => { this.m.set(k, new FakeResponse(b, { status: res.status, type: res.type, redirected: res.redirected })); });
    }
    addAll(reqs) {
      return Promise.all(reqs.map((r) => W.fetch(r))).then((all) => {
        if (!all.every((x) => x.ok)) throw new TypeError('addAll: a response was not ok');
        return Promise.all(all.map((x, i) => this.put(reqs[i], x)));
      }).then(() => undefined);
    }
  }
  W.caches = {
    open: (n) => { if (!stores.has(n)) stores.set(n, new FakeCache()); return Promise.resolve(stores.get(n)); },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (n) => Promise.resolve(stores.delete(n)),
  };
  W.stores = stores;
  /* what a cache holds: { path or url: body } */
  W.held = (name) => { const c = stores.get(name); const o = {}; if (c) c.m.forEach((v, k) => { o[k.indexOf(SCOPE) === 0 ? k.slice(SCOPE.length) : k] = v._body; }); return o; };
  W.setTimeout = (fn, ms) => { W.timers.push({ fn, ms }); return W.timers.length; };
  W.runTimers = () => { W.timers.splice(0).forEach((t) => t.fn()); };
  return W;
}
/* sw.js (or src, a changed copy of it) loaded as a worker in world W: its handlers and its globals */
function worker(W, src) {
  const handlers = {}, state = { skipped: 0, claimed: 0, unregistered: 0, cachesAtUnregister: null };
  const ctx = {
    self: {
      registration: { scope: SCOPE, unregister: () => { state.unregistered++; state.cachesAtUnregister = [...W.stores.keys()].sort(); return Promise.resolve(true); } },
      addEventListener: (t, f) => { handlers[t] = f; },
      skipWaiting: () => { state.skipped++; return Promise.resolve(); },
      clients: { claim: () => { state.claimed++; return Promise.resolve(); } },
    },
    caches: W.caches, fetch: W.fetch, Request: FakeRequest, Response: FakeResponse, URL, Promise, setTimeout: W.setTimeout, console,
  };
  vm.createContext(ctx);
  vm.runInContext(src || fs.readFileSync(SW_FILE, 'utf8'), ctx, { filename: 'sw.js' });
  const ext = () => ({ waits: [], waitUntil(p) { this.waits.push(Promise.resolve(p)); } });
  return {
    ctx, state, handlers,
    install: async () => { const e = ext(); handlers.install(e); return within(Promise.all(e.waits)); },
    activate: async () => { const e = ext(); handlers.activate(e); return within(Promise.all(e.waits)); },
    /* a request seen by the worker: e.responded is null when it is left to the network */
    fetch: (url, o) => {
      const e = ext();
      e.request = { url: url.indexOf('://') > 0 ? url : SCOPE + url, method: (o && o.method) || 'GET', mode: (o && o.mode) || 'no-cors' };
      e.responded = null;
      e.respondWith = (p) => { e.responded = Promise.resolve(p); };
      handlers.fetch(e);
      return e;
    },
  };
}
/* a wait that never ends is a failure, not a quiet exit of the test run: each is cut at 2 s of real time */
const within = (p) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r('HUNG'), 2000); })]).finally(() => clearTimeout(t)); };
/* the body an event answered with ('ERROR' for a network error, 'HUNG' for none), and its open work done */
const bodyOf = (e) => within(e.responded.then((r) => (r ? r.text() : 'NONE'), () => 'ERROR'));
const waited = (e) => within(Promise.all(e.waits));

module.exports = async function swChecks() {
  const fails = [];
  const no = (what) => fails.push(what);
  const src = fs.readFileSync(SW_FILE, 'utf8');

  /* ── the version and the files ── */
  const W0 = world(), S0 = worker(W0);
  const C = S0.ctx, FILES = C.FILES, PAIR = C.PAIR;
  const m = /^(\d+)-([0-9a-f]{10})$/.exec(C.VERSION || '');
  const want = hashOf(FILES);
  if (!m || m[2] !== want) no('version: the files sw.js keeps cache-first changed; set VERSION to \'' + (m ? m[1] : '1') + '-' + want + '\' (it is \'' + C.VERSION + '\'), so installed apps fetch them again');
  if (C.CACHE !== 'notlichess-' + C.VERSION || C.PREFIX !== 'notlichess-') no('version: the cache is named "notlichess-" and its version: ' + C.CACHE);
  FILES.forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) no('files: ' + f + ' does not exist'); });
  if (PAIR.length !== 2 || PAIR.some((f) => FILES.indexOf(f) < 0) || PAIR[1] !== PAIR[0].replace(/\.js$/, '.wasm')) no('files: Stockfish\'s .js and its .wasm are a pair in FILES: ' + PAIR);
  const engine = fs.readFileSync(path.join(ROOT, 'src', 'js', '10-engine.js'), 'utf8');
  if (engine.indexOf("{ url: '" + PAIR[0] + "' }") < 0) no('files: the page starts Stockfish from ' + PAIR[0]);
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  man.icons.forEach((ic) => { if (FILES.indexOf(ic.src.replace(/^\//, '')) < 0) no('files: the manifest\'s icon ' + ic.src + ' is not kept'); });
  const page = fs.readFileSync(path.join(ROOT, 'src', 'page.html'), 'utf8');
  (page.match(/href="\/icons\/[^"]+"/g) || []).forEach((h) => { const f = h.slice(7, -1); if (FILES.indexOf(f) < 0) no('files: the page\'s ' + f + ' is not kept'); });
  /* the font (V5.4): every woff2 app.css declares or the page preloads is kept, and FILES keeps no other */
  const css = fs.readFileSync(path.join(ROOT, 'src', 'app.css'), 'utf8');
  const fonts = (css + page).match(/fonts\/[\w.-]+\.woff2/g) || [], kept = FILES.filter((f) => /^fonts\//.test(f));
  if (!fonts.length) no('files: the page names no font of its own');
  fonts.forEach((f) => { if (FILES.indexOf(f) < 0) no('files: the font ' + f + ' is not kept'); });
  kept.forEach((f) => { if (fonts.indexOf(f) < 0) no('files: ' + f + ' is kept but the page never names it'); });
  if (C.META !== 'manifest.json' || C.PAGE !== '') no('files: the page is the scope itself and the manifest is manifest.json');
  if (/\u2014/.test(src)) no('house style: an em dash in sw.js');
  /* lint: no undefined names, nothing unused */
  const { Linter } = require('eslint'), globals = require('globals');
  const msgs = new Linter({ configType: 'flat' }).verify(src, [{
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: Object.assign({}, globals.serviceworker) },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }], 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'no-unreachable': 'error' },
  }]);
  msgs.forEach((x) => no('lint: sw.js ' + x.line + ' ' + x.ruleId + ' ' + x.message));

  /* the site as deployed: page A, Stockfish, the icons */
  const deployA = () => { const o = { '': { body: 'page A' }, 'index.html': { body: 'page A' }, 'manifest.json': { body: 'manifest A' } }; FILES.forEach((f) => { o[f] = { body: f + ' A' }; }); return o; };

  /* ── install: every file into this version's cache, revalidated, all or none ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install();
    const held = W.held(C.CACHE), keys = Object.keys(held).sort();
    const wantKeys = ['', 'manifest.json'].concat(FILES).sort();
    if (keys.join('|') !== wantKeys.join('|')) no('install: keeps ' + keys.join(', ') + ', not ' + wantKeys.join(', '));
    if (held[''] !== 'page A' || held['sf/stockfish.wasm'] !== 'sf/stockfish.wasm A') no('install: the kept page and engine are the deploy\'s: ' + JSON.stringify(held).slice(0, 120));
    if (W.log.some((x) => x.cache !== 'no-cache')) no('install: every file revalidated with the site (cache no-cache): ' + W.log.filter((x) => x.cache !== 'no-cache').map((x) => x.url).join(', '));
    if (S.state.skipped !== 1) no('install: the new version takes over once its cache is whole (skipWaiting), called ' + S.state.skipped);
    if ((await W.caches.keys()).join() !== C.CACHE) no('install: one cache, named for the version: ' + (await W.caches.keys()).join());
  }
  {
    const W = world(); W.deploy(deployA()); W.deploy({ 'sf/stockfish.wasm': { body: 'gone', status: 404 } });
    const S = worker(W);
    let threw = false;
    await S.install().catch(() => { threw = true; });
    if (!threw) no('install: a missing file fails the install (the old version keeps serving)');
    if (Object.keys(W.held(C.CACHE)).length) no('install: a failed install keeps nothing: ' + Object.keys(W.held(C.CACHE)).join(', '));
    if (S.state.skipped) no('install: a failed install never takes over');
  }

  /* ── activate: the older versions' caches go, others stay, the pages are taken over ── */
  {
    const W = world(); W.deploy(deployA());
    await W.caches.open('notlichess-1-0123456789'); await W.caches.open('notlichess-0-aaaaaaaaaa'); await W.caches.open('another-app');
    const S = worker(W);
    await S.install(); await S.activate();
    const names = (await W.caches.keys()).sort();
    if (names.join('|') !== ['another-app', C.CACHE].sort().join('|')) no('activate: leaves ' + names.join(', ') + ', not this version and another-app');
    if (S.state.claimed !== 1) no('activate: the open pages are taken over (clients.claim), called ' + S.state.claimed);
  }

  /* ── an update: version B replaces version A's cache, with the newest page ── */
  {
    const W = world(); W.deploy(deployA());
    const A = worker(W);
    await A.install(); await A.activate();
    W.deploy({ '': { body: 'page B' }, 'sf/stockfish.js': { body: 'js B' }, 'sf/stockfish.wasm': { body: 'wasm B' } });
    const B = worker(W, src.replace(/var VERSION = '[^']+'/, "var VERSION = '1-bbbbbbbbbb'"));
    /* until B has taken over, A answers from its own cache: the engine pair stays A's */
    const e0 = A.fetch('sf/stockfish.wasm');
    await B.install();
    if (await bodyOf(e0) !== 'sf/stockfish.wasm A') no('update: the version in charge keeps its own engine while the next installs');
    if ((await W.caches.keys()).length !== 2) no('update: the next version fills a cache of its own beside the old one: ' + (await W.caches.keys()).join());
    await B.activate();
    const names = await W.caches.keys(), held = W.held('notlichess-1-bbbbbbbbbb');
    if (names.join() !== 'notlichess-1-bbbbbbbbbb') no('update: only the new version\'s cache is left: ' + names.join());
    if (held[''] !== 'page B' || held['sf/stockfish.js'] !== 'js B' || held['sf/stockfish.wasm'] !== 'wasm B') no('update: the new cache holds the new deploy, the engine pair together: ' + JSON.stringify(held).slice(0, 160));
    W.online = false;
    const e1 = B.fetch('', { mode: 'navigate' });
    if (await bodyOf(e1) !== 'page B') no('update: offline after the update, the new page opens');
  }

  /* ── the page: network first ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install(); await S.activate();
    W.deploy({ '': { body: 'page B' } });
    W.log = [];
    let e = S.fetch('', { mode: 'navigate' });
    if (await bodyOf(e) !== 'page B') no('page: online, a new deploy shows at once');
    await waited(e);
    if (W.held(C.CACHE)[''] !== 'page B') no('page: the fresh page is kept for the next visit with no network');
    if (!W.log.length || W.log[0].cache !== 'no-cache' || W.log[0].redirect !== 'manual') no('page: asked of the site revalidated (no-cache) and with its redirects left to the browser: ' + JSON.stringify(W.log[0]));
    /* the page by any of its addresses: kept once, under the root */
    W.deploy({ '': { body: 'page C' } });
    e = S.fetch('?u=someone&src=lichess', { mode: 'navigate' });
    if (await bodyOf(e) !== 'page C') no('page: a link with a query opens the page');
    await waited(e);
    const keys = Object.keys(W.held(C.CACHE));
    if (keys.some((k) => /\?/.test(k)) || W.held(C.CACHE)[''] !== 'page C') no('page: kept once, under the root, whatever its query: ' + keys.join(', '));
    e = S.fetch('index.html', { mode: 'navigate' });
    if (!e.responded) no('page: /index.html is the page too');
    await bodyOf(e);
    /* no network: the kept copy */
    W.online = false;
    e = S.fetch('', { mode: 'navigate' });
    if (await bodyOf(e) !== 'page C') no('page: offline, the kept page opens the app');
    W.online = true;
    /* the site answers with an error: the kept copy, which the error never replaces */
    W.deploy({ '': { body: 'Service unavailable', status: 503 } });
    e = S.fetch('', { mode: 'navigate' });
    if (await bodyOf(e) !== 'page C') no('page: a 503 from the site opens the kept page');
    await waited(e);
    W.deploy({ '': { body: 'Not found', status: 404 } });
    e = S.fetch('', { mode: 'navigate' });
    await bodyOf(e); await waited(e);
    if (W.held(C.CACHE)[''] !== 'page C') no('page: an error never replaces the kept page');
    /* a redirect: handed to the browser to follow, never kept */
    W.deploy({ '': { body: '', status: 0, type: 'opaqueredirect' } });
    e = S.fetch('', { mode: 'navigate' });
    const rd = await e.responded;
    if (!rd || rd.type !== 'opaqueredirect') no('page: a redirect from the site goes to the browser to follow');
    await waited(e);
    W.deploy({ '': { body: 'elsewhere', redirected: true } });
    e = S.fetch('', { mode: 'navigate' });
    await bodyOf(e); await waited(e);
    if (W.held(C.CACHE)[''] !== 'page C') no('page: a redirected answer is never kept');
    /* a network that hangs: the kept copy after NET_WAIT, and the late answer kept for next time */
    W.deploy({ '': { body: 'page D' } });
    W.hang = true; W.timers = [];
    e = S.fetch('', { mode: 'navigate' });
    await settle();
    if (!W.timers.some((t) => t.ms === C.NET_WAIT) || C.NET_WAIT > 5000) no('page: waits at most NET_WAIT (5 s or less) for the network: ' + C.NET_WAIT);
    W.runTimers();
    if (await bodyOf(e) !== 'page C') no('page: a hanging network opens the kept page after NET_WAIT');
    W.unhang();
    await waited(e);
    if (W.held(C.CACHE)[''] !== 'page D') no('page: the answer that came too late is kept for the next visit');
    /* other pages of the site are not the app: left to the network */
    ['robots.txt', 'sitemap.xml', 'sf/README.md', 'icons/og-image.png', 'sw.js', 'some/path'].forEach((p) => {
      if (S.fetch(p, { mode: 'navigate' }).responded) no('page: a visit to /' + p + ' is not the app\'s page and is left to the network');
    });
  }
  {
    /* a first visit with no network and nothing kept: the browser's own error, never a made-up page */
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    W.online = false;
    const e = S.fetch('', { mode: 'navigate' });
    if (await bodyOf(e) !== 'ERROR') no('page: with nothing kept and no network, a network error');
  }

  /* ── the manifest: network first, the kept copy offline ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install(); await S.activate();
    W.deploy({ 'manifest.json': { body: 'manifest B' } });
    let e = S.fetch('manifest.json', { mode: 'cors' });
    if (await bodyOf(e) !== 'manifest B') no('manifest: online, the deployed manifest');
    await waited(e);
    W.online = false;
    e = S.fetch('manifest.json', { mode: 'cors' });
    if (await bodyOf(e) !== 'manifest B') no('manifest: offline, the kept copy');
  }

  /* ── Stockfish and the icons: cache first, refilled as a pair ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install(); await S.activate();
    W.deploy({ 'sf/stockfish.js': { body: 'js B' }, 'sf/stockfish.wasm': { body: 'wasm B' }, 'icons/icon-192.png': { body: 'icon B' } });
    W.log = [];
    const got = [await bodyOf(S.fetch('sf/stockfish.js')), await bodyOf(S.fetch('sf/stockfish.wasm')), await bodyOf(S.fetch('icons/icon-192.png')), await bodyOf(S.fetch('sf/stockfish.wasm?x=1'))];
    if (got.join('|') !== 'sf/stockfish.js A|sf/stockfish.wasm A|icons/icon-192.png A|sf/stockfish.wasm A') no('files: served from this version\'s cache, never mixed with a newer deploy: ' + got.join(' | '));
    if (W.log.length) no('files: the cache answers without the network: ' + W.log.map((x) => x.url).join(', '));
    /* the font, as the page asks for it (a CORS request): from the cache, so the installed app has Nunito offline */
    const font = FILES.filter((f) => /^fonts\//.test(f))[0];
    W.online = false;
    if (!font || await bodyOf(S.fetch(font, { mode: 'cors' })) !== font + ' A') no('files: the font comes from the cache, offline too');
    W.online = true;
    /* the cache cleared under a live worker: both engine files fetched once, kept together, each ask its own copy */
    W.stores.delete(C.CACHE);
    W.log = [];
    const a = S.fetch('sf/stockfish.wasm'), b = S.fetch('sf/stockfish.wasm'), c = S.fetch('sf/stockfish.js');
    const three = [await bodyOf(a), await bodyOf(b), await bodyOf(c)];
    if (three.join('|') !== 'wasm B|wasm B|js B') no('files: a refill answers every ask from one deploy: ' + three.join(' | '));
    const fetched = W.log.map((x) => x.url.slice(SCOPE.length)).sort();
    if (fetched.join('|') !== 'sf/stockfish.js|sf/stockfish.wasm') no('files: a refill fetches each engine file once: ' + fetched.join(', '));
    const kept = W.held(C.CACHE);
    if (kept['sf/stockfish.js'] !== 'js B' || kept['sf/stockfish.wasm'] !== 'wasm B') no('files: the refilled pair is kept together');
    /* a refill where one file fails keeps neither */
    W.stores.delete(C.CACHE);
    W.deploy({ 'sf/stockfish.js': { body: 'busy', status: 503 } });
    const d = S.fetch('sf/stockfish.wasm');
    if (await bodyOf(d) !== 'wasm B') no('files: the ask still gets the network\'s answer');
    if (Object.keys(W.held(C.CACHE)).length) no('files: half a pair is never kept: ' + Object.keys(W.held(C.CACHE)).join(', '));
  }

  /* ── the hold: an engine that starts under a version gets its .wasm from that version ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install(); await S.activate();
    W.timers = [];
    const js = S.fetch('sf/stockfish.js');
    let open = true;
    Promise.all(js.waits).then(() => { open = false; });
    await bodyOf(js); await settle();
    if (!js.waits.length || !open) no('hold: the .js\'s event stays open after its answer');
    const wasm = S.fetch('sf/stockfish.wasm');
    await bodyOf(wasm); await settle();
    if (open) no('hold: the .wasm asked for closes the .js\'s event');
    /* a .js whose .wasm never comes: closed after HOLD */
    const js2 = S.fetch('sf/stockfish.js');
    let open2 = true;
    Promise.all(js2.waits).then(() => { open2 = false; });
    await bodyOf(js2); await settle();
    if (!W.timers.some((t) => t.ms === C.HOLD) || C.HOLD > 60000) no('hold: at most HOLD (60 s or less): ' + C.HOLD);
    W.runTimers(); await settle();
    if (open2) no('hold: a .js whose .wasm never comes is let go after HOLD');
    /* two engines starting at once: each .wasm lets one .js go, in order */
    W.timers = [];
    const j1 = S.fetch('sf/stockfish.js'), j2 = S.fetch('sf/stockfish.js');
    const st = [true, true];
    Promise.all(j1.waits).then(() => { st[0] = false; }); Promise.all(j2.waits).then(() => { st[1] = false; });
    await settle();
    await bodyOf(S.fetch('sf/stockfish.wasm')); await settle();
    if (st[0] || !st[1]) no('hold: the first .wasm lets the first .js go, and only it: ' + st);
    await bodyOf(S.fetch('sf/stockfish.wasm')); await settle();
    if (st[1]) no('hold: the second .wasm lets the second .js go');
  }

  /* ── never ours: other sites, other methods, the rest of the site ── */
  {
    const W = world(); W.deploy(deployA());
    const S = worker(W);
    await S.install(); await S.activate();
    const before = JSON.stringify(W.held(C.CACHE));
    ['https://api.chess.com/pub/player/tester/games/2026/10', 'https://lichess.org/api/games/user/tester', 'https://explorer.lichess.ovh/lichess',
      'https://www.clarity.ms/tag/y95daq5rao', 'https://c.clarity.ms/collect', 'https://fonts.googleapis.com/css2?family=Nunito', 'https://fonts.gstatic.com/s/nunito/v32/x.woff2',
      'https://notlichess.org.evil.example/sf/stockfish.wasm', 'robots.txt', 'sitemap.xml', 'icons/og-image.png', 'sf/README.md', 'sw.js'].forEach((u) => {
      if (S.fetch(u).responded) no('never ours: ' + u + ' is answered by the worker');
    });
    if (S.fetch('https://api.chess.com/pub/player/tester', { mode: 'navigate' }).responded) no('never ours: a visit to another site');
    if (S.fetch('', { mode: 'navigate', method: 'POST' }).responded || S.fetch('sf/stockfish.wasm', { method: 'HEAD' }).responded) no('never ours: a request that is not a GET');
    await settle();
    if (JSON.stringify(W.held(C.CACHE)) !== before || (await W.caches.keys()).length !== 1) no('never ours: nothing else is ever kept');
  }

  /* ── the off switch (test/sw-off.js): what README.md says to deploy as sw.js in an emergency ── */
  {
    const off = fs.readFileSync(path.join(ROOT, 'test', 'sw-off.js'), 'utf8');
    const W = world(); W.deploy(deployA());
    /* a normal worker in charge, its cache full; an older one's cache left over; another app's caches */
    const A = worker(W);
    await A.install(); await A.activate();
    await W.caches.open('notlichess-0-aaaaaaaaaa'); await W.caches.open('another-app'); await W.caches.open('my-notlichess-copy');
    const S = worker(W, off);
    if (S.handlers.fetch) no('off switch: it answers no request (no fetch handler), so every one goes to the network');
    await S.install();
    if (S.state.skipped !== 1) no('off switch: it takes over at once (skipWaiting), called ' + S.state.skipped);
    if ((await S.activate()) === 'HUNG') no('off switch: activate never settles');
    const names = (await W.caches.keys()).sort();
    if (names.join('|') !== 'another-app|my-notlichess-copy') no('off switch: deletes every notlichess- cache and no other, leaves ' + names.join(', '));
    if (S.state.unregistered !== 1) no('off switch: unregisters itself, called ' + S.state.unregistered);
    else if (S.state.cachesAtUnregister.some((n) => n.indexOf('notlichess-') === 0)) no('off switch: unregisters once the caches are gone, not before: ' + S.state.cachesAtUnregister.join(', '));
    if (/\u2014/.test(off)) no('house style: an em dash in test/sw-off.js');
    const { Linter } = require('eslint'), globals = require('globals');
    new Linter({ configType: 'flat' }).verify(off, [{
      languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: Object.assign({}, globals.serviceworker) },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }], 'no-unreachable': 'error' },
    }]).forEach((x) => no('lint: test/sw-off.js ' + x.line + ' ' + x.ruleId + ' ' + x.message));
    /* README.md's Deploy section: the off switch word for word, the Render headers and the two checks */
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    if (readme.indexOf('```js\n' + off.trim() + '\n```') < 0) no('README: the off switch is not test/sw-off.js word for word, in a js block');
    ['/sw.js', 'Cache-Control', 'no-cache', '/index.html', 'Vary: *', 'application/wasm', 'curl -sI https://notlichess.org/sw.js', 'curl -sI https://notlichess.org/', 'ETag', 'Chromium']
      .forEach((w) => { if (readme.indexOf(w) < 0) no('README: the Deploy section says nothing of ' + w); });
  }
  return fails;
};
