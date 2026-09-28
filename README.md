# notlichess.org

A free mistakes trainer built on your own lichess or chess.com games.

It reads your rated games, runs Stockfish in your browser to find the moves
that cost you, names each mistake (a hanging piece, a fork you walked into, a
mate you missed) and trains you on those exact positions, spaced out, until
they stop happening. After each position you see why: what your move allowed,
the better move played out, and what really happened in your game. Insights
rank your mistakes by the games they decided.

One static HTML file plus the engine. No server, no account, no ads. Your
games and progress are saved in your browser, not on our servers. Microsoft
Clarity records clicks and the screen, with all text hidden, to show how the
site is used.

## Run it

Serve this folder with any static file server (for example
`python3 -m http.server`) and open it. The engine runs in a Web Worker, which
browsers do not allow from a `file://` page.

## Layout

- `index.html`: the whole app (HTML, CSS and one script), built from `src/`
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

## Credits

- Chess pieces: "cburnett" by Colin M.L. Burnett, CC-BY-SA 3.0, via lichess-org/lila
- Analysis: [Stockfish](https://stockfishchess.org/) 17.1 (GPL v3), via [stockfish.js](https://github.com/nmrugg/stockfish.js), in `sf/` with its license
- Mistake patterns: adapted from the tagger in [lichess-org/lichess-puzzler](https://github.com/ornicar/lichess-puzzler)
- Peer data: the Lichess open database (CC0), aggregators in `tools/`
- Built on the [lichess.org API](https://lichess.org/api) and the [chess.com published-data API](https://www.chess.com/news/view/published-data-api). Not affiliated with lichess or chess.com.

MIT licensed.
