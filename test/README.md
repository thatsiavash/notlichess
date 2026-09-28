# Tests

- `npm test` checks the chess core: SAN for 7,000 moves against python-chess, the tactic tags against
  lichess-puzzler's tagger on 246 real mistakes (0 disagreements expected), and that every mistake is explained.
- `npm run lint` runs ESLint over the built script (undefined names are errors).
- `npm run explain` rewrites `explanations.txt`, the pattern and sentences for every sample mistake. Commit it;
  after a classifier change, `git diff test/explanations.txt` shows exactly what players would now read.

Data: `data/games.ndjson` (sample games with python-chess SAN), `data/mistakes.ndjson` (real chess.com
mistakes analysed with Stockfish 17), `data/tagger-oracle.ndjson` (cook.py's tags for them).
