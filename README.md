# notlichess.org

Not lichess — a free chess trainer built on your own lichess games.

It reads your games, finds the exact positions where you lose points, and
retrains them — spaced out, until they stay fixed. It mines the opening book
you actually play, teaches upgrades move by move, and drills your lines
against the replies people at your rating actually make (computed from the
[Lichess open database](https://database.lichess.org/), 6.7M games, CC0).

One static HTML file. No server, no account, no ads, no tracking. Everything
runs in your browser; every action lands on lichess.org signed in as you.

## Run it

Open `index.html`. That's the whole deployment.

## Credits

- Chess pieces: “cburnett” by Colin M.L. Burnett, CC-BY-SA 3.0, via lichess-org/lila
- Analysis: [Stockfish](https://stockfishchess.org/) (GPL), loaded at runtime, runs in your browser
- Peer + opening data: the Lichess open database (CC0) — aggregators in `tools/`
- Built on the [lichess.org API](https://lichess.org/api). Not affiliated with lichess.

MIT licensed.
