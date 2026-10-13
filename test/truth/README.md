# The truth audit (release gate 1)

notlichess's hard rule: every chess claim on screen is true on the board shown. This folder checks it the
way the independent truth audit did, on any checkout, from one command.

## What it checks

Every string on every frame a player can reach with the fixture player (`test/data/fixture-games.json`,
its fact sheets `test/data/facts-fixture.json` applied as the page applies a stored key), at help levels
1, 2 and 3, in three passes:

- **live, the engine up** (what nearly every player sees): each card's frames (the open card, Hints 1 to
  3, the worked example, the game move tried with its reason and See it, the answer found and shown with
  its settled line, Details and every See why step), natural wrong tries (the moves a 3,000-node search
  likes, never the answer or the game move: up to five per card, until three misses, each graded by the
  app with the real engine, with their reasons and See it), two misses on one showing, a wrong try inside
  a forcing line, the forcing line's frames and, at tier 3, their reply list and three guesses, game-mode
  reviews at tiers 2 and 3, and the foils at tiers 2 and 3 (looked at by the app with the real engine).
  Release 2's C5 widens it: every legal check and capture of the player's is tried too, each on a fresh
  card; See why is walked after every try found, that works too, or read "Good move" (Show the answer,
  then its See why), and after the answer shown; "Try your own moves" (Explore) is opened after the
  answer, and the key's three moves, the game move and every check and capture are played there, the
  sentence and the three rows read once the searches are in; and what the summary says of each showing
  (its tile's computed fact at tier 3, its "Keep in mind" lines) is read as Details' lines are.
  `dump.js live-seeds` walks exp2250-r2's seven cases (`seeds.json`, below).
- **stored, the engine down** (`SF.state` failed, what a player sees when Stockfish cannot load): the
  same frames with no try graded.
- **practice**: every lesson (its three frames and its own position) and every practice position with
  every legal move (verdict, reason, See it, the found and shown words, Details).

Each claim is matched to one of about 230 forms (`py/handlers*.py`: the audit's, v2 slice 1's
`handlers_v1.py`, slice 2's `handlers_v2.py` for the words from the facts, `handlers_gate.py` for row 1's
verdict words, tier 1's task line, any string that shows a program value and release 2's rules below,
and `handlers_xp.py` for Explore's sentence and rows) and checked on the board
it is said on, never by the app's own claim code: board facts with python-chess (legal moves, attackers that can
legally take, guards, a static exchange played out with legal captures, mates, forks, pins), engine facts
with the checkout's own Stockfish 17.1 in separate processes (moves compared side by side with
`searchmoves` and turned into win chances on the app's own curve; material read where the line settles).
Tier 1's Details lines are tier 2's in words: one no handler reads takes the final verdict of the tier 2
line it was made from (`py/t1words.py`: same card and frame, the same sentence and squares). "After X,
..." is read after the try and the reply it names (where it holds only there, not after their best
reply: misleading). Instructions and questions are no claim.

Release 2's C5 rules (the gate catches what exp2250-r2 found) run across the forms, in `handlers_gate.py`
and `verify.run_one` (before the form's check, or on the verdict it gives):

- **(a)** "That works too", "X also holds", "X is as good as Y" and "The main move was X" are false where
  the move tried forces mate and the main move does not (or mates later), or scores 4 or more win points
  above it, side by side at depth (`claims.ranks_above`).
- **(b)** See why's band words ("You lose less.", "limits the damage", "keeps you better") are false
  against the sign of the deep score on the step's board (a pawn either way, or a mate).
- **(c)** a material claim is misleading where the line after the move mates within 12 plies and the
  words do not say so, or where the words understate by more than 2 pawns (within a pawn of that edge:
  noise). A save ("g6 saves your pawn.") is worth the deep swing between the answer and the game move; a
  loss or a win ("Their bishop takes your knight.", "could lose the pawn", "wins a knight") is read on
  the move's own line, its deep score against the material the words leave (as it stands, or the best
  line's score where that is lower), as B4 reads a settle point against its line's score.
- **(d)** "Now X is check", "Now X hits two pieces", "Now White can checkmate", "M lets them take your
  queen", "M lets them mate you", "M allows X, forking ...", "M allows mate in N" and "M allows a
  discovered check" are false where X was possible before the move M (on the board before it, with them
  to move).
- **(e)** a threat (the threats line, the bulb's "Their threat: ...", Hint 2's "Two threats: ...", the
  classifier's "ignores Black's threat: ...") holds only by B5's rule: on the board with them to move,
  within 5 points of their best line and gaining them 10 or more over the position as it stands (none, or
  a loss: false; under 5: misleading; 5 to 10: noise); "guards your knight" needs such a threat on it. A
  line settles only where the material it leaves agrees with its score within 2 pawns (else it is read
  on to 12 plies), and static exchange never decides alone: a piece "in danger" (a reason's premise, the
  board description's red ring) needs a capture that nets them material at depth.
- **(g)** one frame's strings about one move or threat agree: "X is as good as Y" never beside "Y was the
  better move", and a single "their threat" never beside a list of threats it is not in, nor beside
  another single threat (claims of type `surfaces`).

Beside the claims:

- the board's description (its `aria-label`, read out by a screen reader), sentence by sentence
  (`py/aria.py`, python-chess only; "after both your tries" is read against the two tries of that showing);
- the practice data's accepted moves, each against the best (`py/pracworks.py`);
- the summary, Today and Insights numbers, recounted from the fixture's own series and records
  (`py/screens.py`) and set beside every line of those screens with a number in it, read by eye.

## The gate's rule

Run the 1,000,000-node pass first; recheck only what it flags (false, misleading, noise or error) at
4,000,000 and then what is still flagged at 8,000,000 nodes. Then:

- **0 false claims** (cards, practice and board descriptions);
- **misleading under 0.2%** of the chess claims, **none on Today's first set** (the cards the planner deals
  the fixture player first, computed by `prep.js`), and **each one listed** in `test/truth/accepted.md`
  **with the seat that accepts it** (a row whose seat reads "to confirm" is listed, not yet accepted);
- **every string on screen read by a checker**, or one of the UI words below (a new form that no handler
  routes fails the gate until a handler reads it or it is justified here and in `cfg.UI_WORDS`);
- **no claim unchecked** (a form no handler reads, or a handler that cannot decide, is `untestable`: check
  it by hand and adjudicate it) and **no check that failed** (`error`);
- a full run of the checkout's current build: every pass, every card dealt, foil and practice position
  walked at every tier (a card the walk cannot open would otherwise leave no claim and no trace), and
  what the first pass flags rechecked at 4,000,000 nodes or more;
- **every key a browser builds holds** (C5 (h)): `keys.js` builds each fixture card's fact sheet through
  the checkout's own `factsCompute` and the page's own engine code (`engineEval`, `enginePump`), on a
  browser worker (`worker.js`: `sf/stockfish.js` hearing exactly what the page posts, no `ucinewgame`,
  Hash or Threads unless the page sends them) that has run other searches first, as a player's browser
  does; `py/keys.py` checks each against an 8,000,000-node 3-line search on the harness's clean engine.
  A forced mate the key's answer does not play, or an answer more than 4 points below the deep best,
  fails. Whatever the checkout's key code sends (release 2's B1 adds `ucinewgame`, Hash 32 and Threads
  1), the worker passes on.

`summary.py` prints each check and `GATE 1: PASS` or `FAIL`; `gate.js` exits 0 only on a pass.

## Requirements

- Node 22 (the repo's) and Python 3 with python-chess 1.10 (`pip install chess==1.10.0`).
- The checkout's own Stockfish 17.1, `sf/stockfish.js` run under Node (one thread and 32 MB of hash per
  process, each search after `ucinewgame`, so the same question always gets the same answer).
- The checkout's `index.html` built from its `src/` (`python3 build.py`), and its fact sheets current
  (`prep.js` stops on a stale one: after a `FACTS_V` change run `node test/truth/facts.js`).
- About 150 MB free for the output folder. It must be outside the repo (`gate.js` refuses one inside):
  the dumps are tens of MB and are never committed.

## Commands

Run from the checkout to audit (or point `--root` at one); `DIR` is any folder outside the repo.

```
node test/truth/gate.js --out DIR                     # the gate: all three passes, then the summary
node test/truth/gate.js --out DIR --pass live         # engine up
node test/truth/gate.js --out DIR --pass stored       # engine down
node test/truth/gate.js --out DIR --pass practice     # practice and lessons
node test/truth/gate.js --out DIR --summary           # the summary again (after an adjudication, say)
```

Options: `--root DIR` (the checkout audited; default the one `gate.js` is in), `--workers N` (Stockfish
processes, default 2, both for the app's searches and for the checks), `--keys k1,k2` (only these cards,
`foil:<key>` foils and `pk:<id>` positions: a partial run, never a gate verdict), `--reviewed DIR` (where
`adjudications.json` and `accepted.md` are read; default the checkout's `test/truth`, else this
harness's: point it at the harness when it audits another checkout), `--nodes N` (the first
pass, default 1000000), `--recheck N,M` (default 4000000,8000000), `--from prep|dump|verify|recheck` (reuse
what `DIR` holds before that step), `--until dump|verify|recheck` (stop after it), `--fresh` (forget the
engine caches in `DIR`). Passes can run one at a time into the same `DIR`; a new build there (another
`index.html`) clears the last build's dumps and results first.

Each step can also be run alone (every script takes `--out DIR` and `--root DIR`): `prep.js`, `keys.js`
then `py/keys.py` (keys as browsers make them), `dump.js live|live-game|live-seeds|stored|stored-game`,
`screens.js`, then `py/aria.py`, `py/verify.py`, `py/recheck.py --nodes N`, `py/pracworks.py`,
`py/screens.py`, `py/final.py`, `py/summary.py`.

## How long it takes

Measured on a shared 4-core machine with 2 Stockfish processes (each about 0.7 to 1.5 million nodes a
second), from an empty cache, on the fixture at eb3476e:

| Pass | Dumps | First pass (1M) | Rechecks (4M, then 8M) | All |
|---|---|---|---|---|
| live | 7 min (700 app searches) | 17 min (19,651 claims, 1,541 searches) | 2.5 min (168), 3 min (106) | 30 min |
| stored | 20 s | seconds after the live pass (its searches are a subset of the live pass's; alone, an estimated 10 min) | seconds | 1 min |
| practice | 20 s | 51 min (39,467 claims, 5,217 searches) | 20 s (12), 3 s (3); accepted moves 3 min | 55 min |

The full gate took about 1.5 hours before C5 (about 3 with it, below), more if the build's words add
flagged claims (each recheck costs a few seconds to a minute a claim). Every search is cached in `DIR/cache` per engine build (the answers are
deterministic), so a rerun on the same build takes minutes and a new build only searches what changed:
the release gate on the v2 final build (7575c1a), with the eb3476e run's `cache` copied into `DIR`,
took 11 minutes, and a rerun 3 minutes.

Release 2's C5 adds the keys and a much larger live walk. On release 1 (f7e4c20), from the live pass's
cold cache: `keys.js` 7 min (91 keys on 2 browser workers), `py/keys.py` 12 min (8,000,000-node
searches), the live dump 19 min, the seeds 1.5 min, the first pass 47 min (32,622 claims, 3,172
searches) and the recheck at 4,000,000 25 min (1,314 flagged, 495 searches); a build before release 2
flags far more than one after it, and each flagged claim costs its recheck. On that cache a rerun of
every pass from the first pass took 4 minutes.

## Reading the output

`DIR/summary.txt` (also printed):

1. The checkout, its commit, the build's and the engine's hashes, the budgets, the fixture (fact sheets,
   cards, foils, Today's first set) and the reviewed files read.
2. For each pass, the chess claims checked by type and tier, with the final verdicts: `false`,
   `misleading` (true words that lead a player wrong: a band one milder, material that comes straight
   back, the right move for the wrong reason), `noise` (within the engine's noise at depth: 5 to 10 win
   points at a band's edge; not a finding), `unchecked` (untestable), `error`, and how many were
   adjudicated; then how many the first pass flagged and each recheck still flags, and the board
   descriptions' counts.
3. The gate's checks and `GATE 1: PASS` or `FAIL`.
4. Every false and misleading claim with its repro: pass, tier, card, frame (the state: `hint 2`,
   `try h8c8 miss, reason said`, `best S0 settled, Details`...), field, type, the exact string, the board
   shown, the try and its reply, each stage's verdict and the check's note (the line and the figures), and
   `python3 test/truth/py/claim.py --out DIR --id ID`, which shows that frame again and reruns its check
   at 8,000,000 nodes (where the harness audited another checkout, the line names this harness's
   `claim.py` and `--root`). A misleading claim says whether it is on Today's first set and listed in
   `accepted.md`.
5. Every unchecked claim and every error; the claims cleared only by a deeper recheck (false or
   misleading at a shallower stage: read them, a borderline claim can turn on depth); adjudications that
   no longer match their claim (stale); flagged claims with an adjudication written for another frame or
   board (re-review); the practice accepted moves more than 6 points below the best; where the summary and
   Insights recount is.
6. The strings on screen no checker reads, by form (moves, pieces, squares and numbers replaced by `M`,
   `P`, `S`, `N`): UI words and verdict words such as "Found it" or "Your turn", and any new form a
   handler should read; then the strings a checker read and judged no claim (instructions, questions,
   advice), by form, where a claim wrongly read as advice would hide.

Other files in `DIR`: `dump-*.jsonl` (every frame as data), `results-<pass>.jsonl` (the first pass, one
row per distinct claim), `deep-<pass>-<nodes>.jsonl` (each recheck), `final-<pass>.jsonl` (the final
verdicts, with `stages` and `note`), `aria-<pass>.json[l]`, `pracworks.json`, `screens-recount.txt`,
`unread-<pass>.json`, `prep.json`, `run.json` (each step's time).

More tools: `py/cardinfo.py --out DIR <dump> <key> [text]` (a card's board and where a string shows),
`py/inspect_try.py --out DIR <dump> <key> <uci> [nodes]` (a try against the answer and the replies to it),
`py/line.py --out DIR <fen> [uci,...] [nodes] [lines]` (Stockfish's line in SAN).

## Adjudications (`adjudications.json`)

Some claims need a person: a form no handler reads, a figure on a band's edge, a reading the checks get
wrong. A reviewed verdict goes in `adjudications.json` with `py/adjudicate.py`:

```
python3 test/truth/py/adjudicate.py --out DIR --pass live --key 184205946040:38 \
  --text "The next move is forcing too." --verdict true --why "8M: the next move Bb4 attacks the bishop on c5"
```

It writes one entry for every claim in `DIR`'s dumps with that card and that exact text (narrow it with
`--tier`, `--frame`, `--try`), keyed by pass, tier, card, frame, field, exact text and `ctx`, the hash of
everything the claim is read against (the boards shown and dealt, the game move, the answer and its line,
the try, their reply, the guess, the See why step). An entry applies only to that exact claim: a new
board, line, try, frame or word leaves the claim to its check, and the summary lists the entry as stale
(prune with `--prune`). So an adjudication can never hide a new false claim. `why` says what the deeper
look found, with its node count. `--aria` adjudicates a sentence of a board's description the same way.
The checkout's own file is read (else this harness's).

## What no handler reads, and what is no claim

Every string on screen goes to a checker, except these UI words (`cfg.UI_WORDS`; the summary marks any
other unread form NOT READ and the gate fails on it):

| Form | Why it carries no chess claim of its own |
|---|---|
| row 1 "Hint 1 of 3" | the hint counter |
| row 1 "Your turn" | the prompt on an open card |
| row 1 "Your move" | game mode's prompt (row 2 there, the move and the clock, is checked) |
| row 1 "Here is the answer" | the label of the answer shown (its row "The answer: X" is checked) |
| row 2 "Play the green arrow." | an instruction (the arrow is the answer, checked as "The answer: X") |
| tag "Review", "Practice", "Lesson" | the card's kind |

Explore's quiet lines are no claim: "This is one of your own positions. Stockfish stays quiet so it can
test you." (another card's position) and tier 1's "Rook to a1 is played. The computer rates each move."
(the sentence left out where its words would need notation).

Strings a checker reads and calls no claim (the summary lists them by form): questions and advice ("What
can they take?", "Their move: what does it attack?", "Improve your worst piece.", "Nothing forcing? Ask
what they want.", "Your chances: checks, captures, threats?", "Before you move: ..."), instructions
("Find the next move.", "Now find it in your games.", a practice task's "Find the fork."), the hint toast
"Hint 2 added.", the "Your chances" chip (the label of the figures beside it) and a lesson's own words.
Row 1's verdict words are claims and are checked: "Found it" (the move is the answer or within the found
band; a practice move against the best, a mate task's mate), "Your game move again" and "As in your game"
(the try is the game move), "Right" (the board shows the line's own move), as are tier 1's "Find a better
move." (the game move is not the best), a foil's "Any good move passes here." (no only move) and its game
row ("Move 31 · 21:12 on your clock"). A string that shows a program value ("b3null.", "undefined") is
false on any board.

## `accepted.md`

Each misleading claim the release keeps is listed in `test/truth/accepted.md` with the seat that accepts
it. The summary counts a claim as listed when one line of the file holds both its card key and its exact
text (a table row such as `| 184205946040:62 | t2 | Your opponent missed it. ... | why it stands | seat |`),
and as accepted when that row's last cell names a seat (not empty, not "to confirm").

## Seeded cases (`seeds.json`)

exp2250-r2's seven false or misleading cases (round 6: the tester's 5.1 to 5.7) are walked as the tester
walked them (C5 (i)): the card, the tries and each frame they lead to (verdict, reason, See it, the
settled frames, Details, See why), and Explore's moves. A seed with a `warm` list plays on the key the
tester's browser made: `keys.js` builds it with the checkout's own `factsCompute` on a fresh browser
worker that first builds the keys of the cards in `warm` (a fixed order, so the same key every run). On
release 1 these recipes give the tester's keys: the mate card's main move Rxf3+ with Rg1+ left out (5.1,
5.2), the back rank's threats Rxg4 and Qxa6 (5.4), and Rc7 over Bf5 (one of 5.7's). The summary lists each
case's false and misleading claims: on release 1 each case has one; after release 2 none may.

## What it can miss

- **Only the fixture player is walked**: 77 cards, 31 foils and 167 practice positions, by the walks above.
  A claim form that only shows on another player's games, or on a path the walk never takes (a slip then
  Show the answer inside a forcing line, a third miss, a quiet try outside the natural tries, an Explore
  move beyond the listed ones or a second move deep in Explore), is not checked here.
- **Keys as browsers make them are built in one order**: each worker warms up on one card and builds its
  share in fixture order. A browser's other orders can make other keys; the check catches what this
  order shows (on release 1, 8 of the 91 keys differ from the fixture's: 6 answers, 2 cards set aside),
  not every key any browser could make. After B1 (`ucinewgame` before each key search) the order no
  longer matters.
- **The UI words above are not checked**: a claim slipped into one of those exact forms would pass; any
  other string the walk sees is read or fails the gate.
- **The handlers decide by the audit's own rules**: a claim judged by a rule that is too loose (a band's
  5-point edge, "most of the count stands", a material claim true at any of four read points) passes, and
  a claim 5 to 10 win points off at depth is `noise`, not a finding. A borderline claim can turn on depth:
  the summary lists every claim cleared only by a deeper recheck.
- **Strings judged no claim are not checked**: a handler that reads a form as advice or a question
  ("Their move: ...", "Your chances: ...") would also swallow a claim written in that form; the summary
  lists those forms.
- **The engine is the same Stockfish 17.1 as the app's**, deeper (1,000,000 to 8,000,000 nodes against the
  app's 250,000 to 1,000,000). A mistake both make at those depths is not seen.
- **The fact sheets are the committed fixture's** (`facts-fixture.json`): the audit checks the claims built
  on them; whether the app computes the same sheets in a browser (threads, hash) is `facts.js`'s question.
- **The live region** (`aria-live`) repeats rows 1 and 2 with a verdict word and is not read on its own;
  clock lines are checked for consistency with the fixture's records only.
