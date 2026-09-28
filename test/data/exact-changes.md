# Graded-exact names that changed, with a human verdict

`node test/audit.js --assert` fails if a card graded "exact" gets a new name that is not listed here. Each line is
`FEN | played | old name -> new name | verdict`. Verdicts: **better** (the new name is more exact), **defensible**
(both names are fair), **re-grade** (plausible, needs a person with Stockfish at 2M nodes before the launch gate).

- 7K/8/8/8/8/2Q4R/8/1k6 w - - 1 55 | h3h2 | mateMissed -> slipped | better: the move is stalemate and now says so
- 3R3N/8/Q1p5/2k5/5P2/4K3/8/8 w - - 3 44 | d8d4 | mateMissed -> slipped | better: the move is stalemate and now says so
- 2k3r1/p1p5/Ppb5/8/3P2pB/8/1PP1r1P1/2R2RK1 w - - 3 29 | g2g3 | kingSafety -> mateAllowed | better: the refutation is a forced mate, now named as one
- r1bq1bnr/pppp1kp1/7p/4N3/3nP3/7P/PPPP1PP1/RNBQK2R b KQ - 0 6 | f7e8 | kingSafety -> mateAllowed | better: mate in 7 is within the new limit of 10
- r1b1k1nr/pppp1Npp/5q2/b2Qn3/2B1P3/2P5/P4PPP/RNB1K2R b KQkq - 0 9 | f6f7 | hung -> forkAllowed | better: Qxe5+ forks king and bishop, as the grader noted
- 3b4/8/p1p5/1p1pPK1k/1P1P2p1/P1P3P1/8/8 b - - 3 48 | d8h4 | promotion -> hung | defensible: the bishop is lost to gxh4 before any pawn runs
- r3k2r/2p2ppp/pp6/3Pq3/1PQbP1n1/2N3P1/P4P1P/1RR3K1 b kq - 1 19 | b6b5 | kingSafety -> slipped | defensible: Qc6+ starts a run of checks and the line ends near a draw
- r3kb1N/ppp3pp/8/4p3/2q1n1b1/5P2/PPPPn1PP/RNBQ1R1K w q - 1 12 | d1e1 | forkAllowed -> discoveredAllowed | defensible: the discovered attack comes first, the fork follows it
- r1bqkbnr/pppp2pp/2n5/4pp2/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq f6 0 4 | b1c3 | openingSlip -> threat | re-grade: fxe4 wins the pawn only because Nxe4 d5 forks after it; "threat" is less exact than it reads
- 6rr/P3qp2/Qnkbb3/1p5p/4B2p/1P2P1P1/2P2P2/R4RK1 b - - 0 24 | c6c7 | promotion -> pinAllowed | re-grade: the stored line loses the queen to a pin, but the grader noted the best line loses material too
