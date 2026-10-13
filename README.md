# notlichess.org

A free mistakes trainer built on your own lichess or chess.com games.

It reads your rated games, runs Stockfish in your browser to find the moves
that cost you, names each mistake (a hanging piece, a fork you walked into, a
mate you missed) and trains you on those exact positions, spaced out, until
they stop happening. After each position you see why: what your move allowed,
the better move played out, and what really happened in your game. Insights
rank your mistakes by the games they decided.

One static HTML file plus the engine. No server, no account, no ads. Your
games and progress are saved in this browser, not on our servers.
notlichess uses Microsoft Clarity to see how the site is used: it records
clicks and screens, with all text hidden, and the site says so on the
landing page, in the footer and in Settings. The page never calls Clarity's
consent API: Clarity applies its own consent mode to visitors from the EEA,
the UK and Switzerland (no cookies until a consent signal).

## Run it

Serve this folder with any static file server (for example
`python3 -m http.server`) and open it. The engine runs in a Web Worker, which
browsers do not allow from a `file://` page.

## Layout

- `index.html`: the whole app (HTML, CSS and one script), built from `src/`
- `sw.js`: the service worker, so the app opens offline (it keeps the page, the manifest, the icons, the font and Stockfish)
- `fonts/`: Nunito, the page's font, served from this site (SIL Open Font License, `fonts/OFL.txt`)
- `src/`: the source. `page.html` is the page, `app.css` the styles, and `js/` the script in parts, joined in the order in `js/ORDER`
- `build.py`: joins `src/` into `index.html` (and refuses any em dash)
- `test/`: checks for the chess core, with sample data (see `test/README.md`)
- `sf/`: Stockfish 17.1 lite, compiled to WebAssembly (see `sf/README.md`)
- `tools/`: scripts that built the peer baselines (and the retired opening book) from the Lichess open database

## Making a change

Edit `src/`, then:

```
python3 build.py
npm install        # once, for the linter
npm test
npm run lint
```

Commit `src/` and the rebuilt `index.html` together. If you touched the mistake explanations, run
`npm run explain` and review `git diff test/explanations.txt` before committing.

The earlier version, with the opening trainer, puzzles and Play tab, is kept
in git: tag `v1-full-platform` and branch `archive/full-platform`.

## Deploy

Render serves the repo root as a static site: no build command, the root as
the publish directory, `index.html` as committed. Set these headers in the
static site's settings (Headers):

| Path | Header | Value |
|---|---|---|
| `/sw.js` | `Cache-Control` | `no-cache` |
| `/` | `Cache-Control` | `no-cache` |
| `/index.html` | `Cache-Control` | `no-cache` |

- `/sw.js` is served from the root, as JavaScript, with no redirect (no
  redirect or rewrite rule may catch it): browsers refuse a service worker
  that comes through a redirect, and a copy held by the CDN would keep every
  player on an old version.
- `/` and `/index.html` are revalidated on every visit (the service worker
  asks with `no-cache`, and the ETag makes that a 304), so a deploy shows on
  the next visit.
- No `Vary: *` on any file the service worker keeps (the page, `manifest.json`,
  `icons/`, `fonts/`, `sf/`): the browser's Cache API refuses such a response.
- `.wasm` files as `application/wasm`, the type browsers need to compile
  Stockfish as it downloads.

After each deploy, two checks:

```
curl -sI https://notlichess.org/sw.js
curl -sI https://notlichess.org/
```

The first shows `200`, a JavaScript type (`application/javascript` or
`text/javascript`), `cache-control: no-cache` and no `location`. The second
shows the new `etag` (it changes with each deploy of `index.html`) and
`cache-control: no-cache`.

### The service worker's off switch

A normal deploy needs nothing more: the page comes from the network first on
every visit, and a change to Stockfish, an icon or the font comes with a new
`VERSION` in `sw.js` (`npm test` names the value). The off switch is for an
emergency: players stuck on a broken page or cache that a normal deploy does
not reach, for example after a bug in `sw.js` itself. Deploy this as `/sw.js`
in place of the normal one (the same code is `test/sw-off.js`):

```js
/* notlichess.org: the service worker's off switch. In an emergency, deploy
   this file as /sw.js in place of the normal worker (README.md, Deploy):
   it takes over from the worker in charge at once, deletes every cache
   named notlichess-* (no other) and unregisters itself. It has no fetch
   handler, so every request goes to the network, as if there had never
   been a worker. To return to the normal worker, deploy sw.js from git. */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n.indexOf('notlichess-') === 0; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.registration.unregister(); }));
});
```

Browsers fetch `/sw.js` again on the next visit (the page registers it on
every visit with a player, and an app left open checks hourly). The off
switch takes over at once, deletes every cache named `notlichess-` and
unregisters itself; from then on every request goes to the network, as if
there had never been a worker. Nothing of the players' is lost: their games
and progress live in `localStorage`, not in those caches. While it is
deployed the app does not open offline.

To return to the normal worker, deploy the repo's `sw.js` again: the page
registers it on the next visit, and the app opens offline again.

All of this was checked on Chromium only (headless, against a local
server). Before a release, check by hand on an iPhone (Safari), an Android
phone (Chrome) and desktop Firefox and Safari: a first visit, a reload with
no network, a new deploy picked up on the next visit, and the two checks
above after the deploy.

## Credits

- Chess pieces: "cburnett" by Colin M.L. Burnett, CC-BY-SA 3.0, via lichess-org/lila
- Font: [Nunito](https://github.com/googlefonts/nunito) by The Nunito Project Authors, SIL Open Font License 1.1, in `fonts/` with its licence (the latin subset as Google Fonts serves it, from the `@fontsource-variable/nunito` package)
- Analysis: [Stockfish](https://stockfishchess.org/) 17.1 (GPL v3), via [stockfish.js](https://github.com/nmrugg/stockfish.js), in `sf/` with its license
- Mistake patterns: adapted from the tagger in [lichess-org/lichess-puzzler](https://github.com/ornicar/lichess-puzzler)
- Peer data: the Lichess open database (CC0), aggregators in `tools/`
- Built on the [lichess.org API](https://lichess.org/api) and the [chess.com published-data API](https://www.chess.com/news/view/published-data-api). Not affiliated with lichess or chess.com.

MIT licensed.
