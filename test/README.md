# Tests

- `npm test` checks the chess core: SAN for 7,000 moves against python-chess, the tactic tags against
  lichess-puzzler's tagger on 246 real mistakes (0 disagreements expected), and that every mistake is explained.
- `npm run lint` runs ESLint over the built script (undefined names are errors).
- `npm run explain` rewrites `explanations.txt`, the pattern and sentences for every sample mistake. Commit it;
  after a classifier change, `git diff test/explanations.txt` shows exactly what players would now read.
- `node test/perf.mjs` (by hand, not in `npm test`; needs Chromium, `CHROME_PATH` if it is not found) loads the
  fixture player as a phone with the main thread slowed and checks the speed limits: Today ready, the first card,
  a try's verdict, no long main-thread task. It serves the repo itself and needs no network.
- `sw-off.js` is the service worker's off switch (README.md, Deploy); `sw.js` here checks it beside the real one.
- `node test/keys-real.js` (by hand, not in `npm test`; about 40 s of one Stockfish process) runs the page's own
  engine code on the repo's Stockfish as its one worker: the mate card's fact sheet, made after 20 other searches on
  that worker, is the fixture's (Rg1+, mate in 11), and the same twice (release 2, B1).

Data: `data/games.ndjson` (sample games with python-chess SAN), `data/mistakes.ndjson` (real chess.com
mistakes analysed with Stockfish 17), `data/tagger-oracle.ndjson` (cook.py's tags for them).
