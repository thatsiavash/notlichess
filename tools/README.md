# Peer baselines

`build-peer-baselines.py` turns the Lichess open database (CC0) into the small
JSON blob embedded in `outputs/lichess-launcher/index.html` as `var PEER = …`.

It is what lets the page say "players at your rating" instead of "your other
formats". Lichess's own peer numbers, the ones Tutor uses, are a private
aggregation and are not exposed to anyone; these are ours, computed from public
data, and the page says so under "where these come from".

## Rebuilding

Monthly dumps appear at <https://database.lichess.org/standard/list.txt>. The
prefix below is about 2.2GB of a ~29GB file, which is roughly 6.7M games and
takes about five minutes end to end:

```bash
curl -s -r 0-2200000000 \
  "https://database.lichess.org/standard/lichess_db_standard_rated_2026-07.pgn.zst" \
  | zstd -dc | python3 build-peer-baselines.py peer-baselines.json
```

Then replace the `var PEER = {...};` line in `index.html` with the new blob.

The sample is the first N games of the month, so it covers a day or two rather
than the whole month. For rating-band aggregates that is immaterial; if it ever
matters, take a larger prefix.

## What comes out

Per `speed|rating-band` (100-point bands, 800 to 2400):

| key | meaning |
|---|---|
| `win`, `draw` | result rates |
| `wwin`, `bwin` | win rate by colour — White scores better everywhere, so a colour comparison needs this |
| `flag`, `resign` | share of *losses* ending on time / by resignation |
| `clkleft` | mean % of own clock left when losing |
| `acpl` | mean centipawn loss, from the analysed subset |
| `acpl_open`, `acpl_mid`, `acpl_end` | the same by ply bucket (0-30, 30-60, 60+) |
| `conv` | share of games won after reaching +2 |
| `resource` | share not lost after falling to −2 |
| `analysed` | share of games with computer analysis |
| `oppdelta` | mean opponent rating minus own |

Plus `openings`, keyed by four coarse bands, giving White and Black win rates
per opening family.

## The one rule

`evalMetrics()` in `index.html` must stay identical to `record()` here: same
1500cp clamp, same 1000cp cap per move, same 0-30 / 30-60 / 60+ buckets, same
±200 thresholds. If they drift, every peer comparison silently becomes a
comparison of two different measurements.

## v2 metrics (pass 17, Tutor parity)

The aggregator now also emits, per cell: `acc` (mean Lichess-accuracy%),
`acc_open`/`acc_mid`/`acc_end` (the same by phase), `ta` (tactical awareness:
accuracy of the move right after an opponent mistake ≥10 win-chance points),
`spd` (mean % of clock remaining across moves from ply 16), and `pieces`
(mean win-chance cost per move, by piece letter). The page's `evalMetrics()`
and `moveAcc()` mirror these definitions exactly — same 0.00368208 win-chance
curve, same 103.1668/−0.04354 accuracy constants, same thresholds.
