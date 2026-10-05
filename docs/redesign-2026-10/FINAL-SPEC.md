# FINAL SPEC: game-review card flow (notlichess, 2026-10-03)

Buildable spec for the card-flow redesign. Repo: `outputs/lichess-launcher` at 34439f2. Shorthand as in `code-map.md`: `card` = `src/js/13-card.js`, `render` = `14-render.js`, `shell` = `15-shell.js`, `board` = `02-legacy-2.js`, `session` = `12-session.js`, `explore` = `13x-explore.js`, `classify` = `05-core-classify.js`, `motifs` = `04-core-motifs.js`, `engine` = `10-engine.js`, `css` = `src/app.css`, `e2e` = `test/e2e-browser.js`. Revised 2026-10-04 against `spec-critique.md`: each of its 33 findings is resolved in place, and the Review notes at the end map every finding to its fix.

**Binding founder decisions (the founder, 2026-10-03):** (1) no blunder check: every card asks for your better move, and the punishment is drawn and played as explanation; (2) nothing moves on its own: one caption per move, the user taps › or swipes, text never changes while a piece moves, and the only automatic motion is a slow, marked opponent reply inside a forcing line; (3) ship when built and tested.

**Base design: B ("the board tells the story"),** picked by three of four judges, with A's motion discipline (no card-open slide, flush-on-input sequencer, wrong-state input contract, still eval bar) and C's copy and spoiler rules (plain words, blue-grey expected reply, pips after move 1, never mark the answer, three-tap story, honest "as in your game").

| Judges split on | Decision | Why (one line) |
|---|---|---|
| Base: A (189) or B (187, three of four wins) | B | B's board language is the founder's core ask; A grafts on cleanly. |
| Board labels (engineer: veto); C's bubbles | Keep, 1 per frame, dropped first, behind `LABELS_ON`; bubbles become first-sight labels | A name beside a new mark needs no legend; one text primitive; the flag lets the founder cut it. |
| Band height: 68 / 56 / 96 px | 56 px | Board size, layout and the `session.test.js:331` markup stay. |
| Eval bar | 6 px slot kept, grey and still on cards, live in explore | No motion during a verdict, no width jump when explore opens. |
| Game move at card open | Red arrow only, short-arrow fix; no ghost, no ?? | The ghost reads as two bishops; ?? is notation. |
| Close-move glyph | Hollow blue-grey ring with ✓ inside | Differs from "correct" by shape, not only colour (PROBLEM-MAP 4.4). |
| Story bar | Three fixed slots [‹] [Next move ›] [Continue] | Strip links are poor phone targets; fit checked at 360 px. |
| Forcing reply timing | Telegraph 600 ms, slide 1500 to 1900, text 2050; a tap starts the slide early, never skips it | Shorter than A's 2.5 s, and the reply is always seen moving. |
| Automatic hint after misses | Tier 1 after miss 1, tier 2 after miss 2, tier 3 never | Help fades with skill; Hint stays tappable for everyone. |
| Explore | Today's panel; new entry, start, side, bar | Smallest change that fixes U5 and keeps Stockfish's top moves. |

---

## 1. Principles (every screen obeys these)

1. **One change at a time.** Board change, then marks, then words. A verdict and its reason are separate beats at least 600 ms apart (300 ms under reduced motion).
2. **Text never changes while a piece moves.** Every DOM write goes through the sequencer (2.2). Board and marks wait for the slide to end; text waits a further 150 ms and never lands in the same frame as a board change, even when input flushes the queue.
3. **Nothing moves on its own.** Pieces move only on your move, your tap on a labelled control (See it, Next move, Play it, Their reply) or a story swipe or arrow key. The one exception is the opponent's reply inside a forcing line: telegraphed in blue-grey 900 ms ahead, a 400 ms slide.
4. **Right or wrong lands on the square first,** after the piece lands: a badge on the landing square, both squares tinted, the band coloured with 1 to 3 words and the sound, in one beat. Each badge has its own shape: filled green ✓ = you found it; hollow blue-grey ring with ✓ = good, not best; red ✗ = wrong; grey i = answer shown; grey ? = not checked.
5. **At most 15 words on screen before the next tap,** counting the band, board labels, strip and button labels (the session bar and desktop key line are excluded). Every templated row runs the fit ladder (section 3); over budget, the board label drops first. Explore is exempt (S14).
6. **You only move your own pieces, and they always answer.** Every card has one task. While solving, your piece selects. After an answer, a tap on any piece gets a grey outline and "To try moves, open Details." A tap on their piece gets a sentence, never a selection. Explore is exempt.
7. **Fixed meanings on the board.** Solid red arrow = your game move. Dashed red arrow plus red ring = their threat or capture. Blue-grey dashed = their expected reply in a forcing line. Green arrow = the better move. Gold = hints and Stockfish. Badges as in rule 4. No colour or glyph ever takes a second meaning.
8. **Never mark the answer before an answer,** exactly as defined in 2.3.

---

## 2. Every state of a card

### 2.0 Layout

**Phone, 390 x 844.** The board never changes size or position (`css:474`, `css:509` unchanged).

| Block | y (px) | Contents |
|---|---|---|
| Session bar | 0 to 48 | As today: × end, progress segments, ••• menu. |
| Band | 48 to 104 | The fixed 56 px `.card-task` box. |
| Board | 104 to 488 | The 6 px eval bar (grey, still) plus the 384 px board. |
| Strip | 488 to 540 | Before an answer: empty. S0: "Details" link. Story: Game/Better dots. Explore: grows (S14). |
| Action bar | fixed bottom, 64 px + safe area | Buttons 48 px tall, radius 10, gap 10, 16 px gutters. Two slots = two equal columns; three slots = [56 px][1fr][1fr] (126 px each at 360 px; "Next move ›" needs about 90). The bar keeps the class `done-acts` so `fitRows` (`render:816`) still finds it. Within one mode a slot never changes meaning under the thumb. Gold fill = the suggested action. |

**`#bwrap` children, in order:** the board `<svg class="board">` (tints, check glow, ghost, pieces, legal dots), the marks `<svg class="marks">` (same viewBox, `pointer-events:none`, z 8 to 12 below, its own `<defs>` for arrowheads), and `<div class="blabels">` (labels). `paintBoard` writes all three; `paintMarks` rewrites only the last two, so a marks beat never rebuilds a piece. The `#bwrap .bad-arrow` selectors (`e2e:88`, `:99`) and `#bwrap.static` keep working, and the board svg stays the first child for `shell:413`, `shell:619-622`.

**Band anatomy.** Keep the outer `<div class="card-task ...">` (parsed by `session.test.js:331`).
- Left: a 28 px disc. King in the solver's colour (task, "Your move", explore); filled ✓ on green #3d9142; ✗ on red #d04a3a; hollow ring with ✓ in blue-grey #7d93ab (close); … on grey #8f8b83 (checking); ? on grey #6b665d (not checked); i on grey #6b665d (answer shown). In the story the disc keeps the card's verdict glyph.
- Status layout (all but the story): row 1 Lora 600 18/22 px, at most 26 characters; row 2 Lora 15/18 px (14 px below 375 px width), at most 40 characters. Hint text gold #d6a852.
- Caption layout (story): Lora 500 16/20 px, two lines, at most 60 characters.
- Right edge: the chip "One more try" (11.5 px, gold outline) or forcing pips (7 px dots, one per move of yours). A relearn forcing card shows the chip until your first correct move, then the pips.
- Background plus 3 px left border carry the state: neutral (none); good (16% green tint, #8fb573); bad (17% red, #d8826f); close (14% blue-grey, #9db0c6); info (#211f1b, #6b665d). Story: red border on game steps, green on better steps.

**Desktop, 1280 x 900.** The board stays 720 px at x 82 with the eval slot. The 380 px panel holds the band as a block (radius 10, padding 20; row 1 Cormorant Garamond 600 28/32; row 2 Lora 17/25; caption Lora 19/27), the strip contents, the same buttons level with the board's bottom edge, and one 12 px key line: "Enter: main button · → see why · ? hint". Labels 14 px. Same word counts as phone.

### 2.1 Board vocabulary

Board units: viewBox 360, one square = 45. Every new element has `pointer-events:none`. z is the drawing order, bottom to top; z 2 to 6 live in the board svg, z 8 to 12 in the marks svg.

| z | Mark | Meaning | Primitive | Shown | Gone |
|---|---|---|---|---|---|
| 2 | Last-move tint | Previous move | Existing rgba(155,199,0,.41) (`board:135-137`) | Card open (static), each stepped move | Next board change |
| 2 | Verdict tints | Result of the move just made | Fill on from and to: green rgba(61,150,66,.42), red rgba(214,70,52,.42), blue-grey rgba(125,147,171,.34), warm grey rgba(160,150,130,.30) checking, grey rgba(120,114,104,.40) not checked or answer shown | With the verdict | Next board change |
| 3 | Check glow | King in check | Existing (`board:141-144`) | Whenever in check | |
| 4 | Ghost piece | Where your game move went | The piece as `<use>` at opacity .34, class `ghost-piece`, **no `data-sq`**, plus a ✗ disc r 6 at its top-right. Occupied square: the disc only | S0; story B1 when there is no guard | Next frame |
| 5 | Pieces, legal dots | | Existing | | |
| 8 | Guard dots | "This piece guards that square" | Defender centre to square, ends inset 13; #4fae55, stroke 3.6, `dasharray 0.1 7`, round caps, halo 7 rgba(0,0,0,.35); end dot r 3.4; class `guard-line` | Story B1 only, when the guard rule holds | Next frame |
| 9 | Game-move arrow | Your game move | Existing solid red rgba(201,80,60,.9), stroke 6, class `bad-arrow` | Card open, hint frames, story G1 trail | When a move lands; back on Try again |
| 9 | Threat arrow | A capture or check they can play or did | Same red, stroke 5, `dasharray 7 5.5`, butt caps, dashed halo, own marker, class `threat-arrow`. At most 2 | S4 reason, hint 1, S0, G1, worked example | When that move lands or the frame changes |
| 9 | Expected-reply arrow | Their reply in a forcing line | rgba(122,150,184,.95), stroke 5, same dash, class `reply-arrow`; solid on the landing frame | Forcing line only | Next beat |
| 9 | Better arrow | What to play instead | Existing green, class `good-arrow` | B1, S7. Never before an answer | Next frame |
| 9 | Explore arrow | Stockfish's pick | Existing gold, class `ghost-arrow` | Explore only | |
| 9 | Tried line | A move already tried this showing | Red line stroke 2 at 55% from `tried.from` to `tried.to`, ending in a ✗ disc r 6 at 55% on `tried.to`. When `tried.to === best.to`: the disc on `tried.from`, no line | Card position after Try again | New showing |
| 10 | Attacker ring | The piece that punishes | Circle r 20, stroke 3.6 #e0503e, halo 6.5, class `ring-threat`. Static | With its threat arrow | With its arrow |
| 10 | Reply ring | The piece about to reply | r 20, blue-grey, stroke 3, `dasharray 6 4`, class `reply-ring` | Forcing telegraph | Reply lands |
| 10 | Hint target | Hint 1 prize on a missed-chance card | Gold dashed ring r 20, stroke 3, `dasharray 4 3`, class `ring-target` | Hint 1, under 2.3 | Card answered |
| 10 | Hint ring | Hint 2: the piece to move | Existing solid gold ring (`board:205-215`), class `hint-ring` | Hint 2 | Card answered |
| 10 | Nope outline | "Not a move here" | Grey rgba(160,154,144,.9) inset square outline, stroke 2 | 600 ms after a tap on their piece, or on any piece after an answer | Timer |
| 11 | Piece token | A piece captured here | Disc r 12.5 at (x+12.5, y+32.5), fill rgba(244,236,222,.94), ring 2.4 red #d6452f (you lost it) or green #3d9142 (you won it), the piece inside at 21.6 units, opacity .82; lost adds a red slash. At most 2 | When a capture lands | Crossfade to another position |
| 12 | Verdict badge | Rule 4 glyphs | r 8.6 at (x+36, y+9) of the landing square; filled disc for ✓ ✗ … ? i; the close badge is a hollow ring (stroke 2.2, page-ground fill) with a blue-grey ✓. Pops over 120 ms once per effect id | With the verdict | Next board change |
| HTML | Label | Names one mark | Pill in `.blabels`: Lora 600 12 px (14 desktop), padding 1/7 px, radius 5, rgba(22,21,18,.92), 1 px border and text in the role colour (red #f0a493, green #a9d98f, blue-grey #b9c9dc, gold #e8c27a), `aria-hidden` | With its mark | With its mark |

**Short-arrow rule** (`arrow()`, `board:181-196`): under 1.6 squares, head 4.2 (not 3.4) and the tip stops 0.22 of a square short (not 0.34). One-square moves become visible (U9).

**Per-frame budget**, tints excluded: 2 arrows plus 1 guard line or tried line, 1 ring (the two gold hint rings may pair), 2 badges, 2 tokens, 1 ghost, 1 label. No beat adds more than 3 marks.

**Label placement.** `placeLabel(geom, w, h)` is pure: `geom` = squares holding pieces, badges, tokens, rings, arrow shafts (shaft width + 4 px each side), the anchor square and the board size in px; `w` from a width table (12 px Lora about 6.6 px per character plus 14 px padding, 14 px about 7.7), `h` 18 (20 desktop). Candidates: the 8 neighbours of the arrow head (or marked square), nearest first, then the 8 neighbours of the tail. The pill may not overlap a piece, badge, token, ring, shaft or the board edge; first fit wins; no fit, no label (the band says it). Recompute on every paint, flip and resize (`ResizeObserver` on `#bwrap`, guarded by `typeof ResizeObserver`). Words come from geometry, never the pattern tag (copy L).

**First-sight labels.** The first time a mark kind ever shows on this device, its label uses a teaching text: game arrow "Your game move"; threat "{Opp} can take" ("{Opp} can check"); token "Lost piece"; ghost "{gameSan} in your game". Priority when two compete: game arrow, threat, token, ghost, then short labels. A first-sight label may cover one piece square that is not an arrow end. Any label not shown, for budget, priority or room, is not marked seen. Stored as `nl:tip:<kind>` inside try/catch; with no storage, once per page load. If `LABELS_ON` is false, first-sight labels go too and the band carries the meaning.

**Effect ids.** Every beat increments `a.fx`; pops and fades carry `data-fx` and get `fx-in` only on the first paint of that id, so a repaint never replays them.

### 2.2 Motion, timing, input and sound

- **Slides:** your tapped move 220 ms (`css:268`); a dragged move lands with no slide; moves the app shows (story, See it, Play it) 320 ms; the forcing reply 400 ms ease-in-out (new `.anim-slow`); a jump to another position is a 150 ms crossfade. `motionUntil = slide start + duration`.
- **Text:** fades out 100 ms before a motion beat; fades in over 150 ms, starting at `motionUntil + 150`.
- **The sequencer** (`src/js/14s-stage.js`). An action updates the model synchronously as today (phase, verdict, misses, hints, result, `keepProgress`, `srsRecord`), then calls `stage(beats)`. Only DOM writes are staged:
  - `board`: waits until `Date.now() >= motionUntil`, then repaints the board svg (and the overlay); a beat that starts a slide sets `motionUntil`;
  - `marks`: waits the same, then rewrites only the marks svg and labels;
  - `text`: band, bar, strip and live region; waits until `motionUntil + 150`; latest wins (a new text beat replaces a pending one);
  - `wait(ms)`.

  Every timed text change is a staged beat, never a raw `setTimeout`: K1 at 300 ms, K2 at 3 s, the T4, T5 and N1 reverts, the S6 and S4 reason beats. `renderCard` and `renderCardBoard` never run while `motionUntil` is in the future; a repaint asked for then is deferred to it.
- **Flush.** Any input (pointerdown on the board, a `data-act` click, a handled key) calls `flushStage()` first: a running slide jumps to its end (never the forcing reply, S10), pending board and marks beats apply now in order, and pending text is rescheduled to now + 150 ms (and dropped if the input stages new text). Then the input is handled, except in phase `reply` (S10). Beat lists carry `a.key` plus a token and die on Continue or card exit. A selection repaints the board only (`card:204`, `shell:682`).
- **Double-tap guard.** `paintBar` records `slotChangedAt[slot]` whenever a slot's label or action changes. A `data-act` click on that slot, or Enter or `?` mapped to it, is ignored for 450 ms after the change. `tooSoon` (`card:530`) still covers a card's first 450 ms, and `next` (`shell:479`) gets the same guard.
- **Swipes.** A swipe is a pointerup with |dx| ≥ 48 px and |dx| > 2|dy|, starting at least 24 px from both screen edges (so iOS Back never fires, since Back ends the session, `session:198-200`). Only when the board is not live (S0, story), in a new branch before the `bs.live` return (`shell:670`). `#bwrap` gets `touch-action: pan-y` only in S0 and the story.
- **Engine.** `checkMove`'s `engineEval` (`card:383-384`) passes `{tag: 'check'}`; Take back, Try again, Show the answer, Continue and card exit call `engineStop('check')` (`engine:130`), so a stale 250,000-node search (`enrich:9`) never eats the next try's 9 s.
- **Reduced motion:** every slide, fade and crossfade takes 0 ms; beats keep their order; reason beats 300 ms after the verdict; the forcing reply waits for "Their reply ›". In Node tests `reducedMotion()` (`shell:586`) also returns true when `ui.reducedTest` is set.
- **Sounds** (`board:247-271`; the Settings switch mutes all): `good` with a filled ✓; `bad` with ✗; `tap` on a selection and the close verdict; `move` at the start of every slide the app shows; `set` at session end. Nothing on marks, hints or text. Android with sound on: ✓ `vibrate(15)`, ✗ `vibrate([30, 60, 30])`.

### 2.3 The spoiler rule (principle 8)

**Answered** = phase `done` in any view, including the reveal (S7). **Pre-answer** = phases `guess`, `checking`, `tried` and `reply`. Inside a forcing line, "the answer" is the move due now (`a.sol[a.solIdx]`), and `best.from` / `best.to` are its squares.

- **Forbidden in a pre-answer frame:** a green arrow; a "better" or "the answer" label; any gold ring except hint 2's ring on `best.from`; any ring, arrow head or tail, token, guard line, tried disc or label on `best.to`; any replayed move of the solver's side.
- **Exempt:** the red game-move arrow (it starts on `best.from` on 22 of 91 fixture cards and ends on `best.to` on 5); last-move tints (on `best.to` on 5 cards); selection and legal dots; the badge and tints of the move just played; S4 marks on `best.from` (they explain the try, and that piece is already attacked); the forcing reply's own arrow, ring and token (that move plays regardless).
- **S4 marks:** if the refutation's attacker stands on `best.to`, S4 draws no marks and M3 carries it; if its target is `best.to`, the ring only, no arrow; See it never puts a token or label on `best.to`.
- **Hints:** a hint-1 mark never touches `best.from` or `best.to`, both arrow ends checked; dropped marks leave hint 1 as text only. The same applies to the worked example and in-line hints.
- The rule is checked on the frame the user sees: `boardOptsFor(a)` plus the overlay contents.

### 2.4 The states, in order

Phases: `guess`; `checking`; `tried` (a move sits on the board as an overlay, `a.tried = {from, to, uci, san, kind: 'miss' | 'close' | 'unchecked', reply, seen}`); `reply` (forcing reply in flight); `done`, with `a.view` = `{mode: 'show'}` (S7), `{mode: 's0'}` or `{mode: 'story', i}`, and explore as the `a.explore` sub-state. `a.st` is always the position before a try; the tried move uses the checking overlay (`a.ghostMove`, `render:449-454`). `boardState()` (`shell:644-648`) is live in `guess` and `tried`, and in `done` + `show` for the answer move only. Word counts include every visible word.

#### S1. Card opens
- **Board:** the position before your mistake, your side at the bottom. The opponent's previous move as a static last-move tint (the slide at `card:95` is removed). The red game-move arrow. Tried lines from this showing. Worked example (S9): hint 1 marks already drawn.
- **Band:** king disc; row 1 "Your turn" (2); row 2 "Find a better move than {gameSan}." (6). Relearn: chip "One more try" (3). First card ever: label "Your game move" (3).
- **Bar:** [Hint] [Show the answer], outlined, enabled at every tier after 450 ms. **Words:** 12; relearn or first card 15. **Focus:** `#task-h`. No sound.

#### S2. Selecting, moving, and taps that are not moves
- Your piece: selected tint plus legal dots, `tap`, board-only repaint; tap again to deselect. A legal target or drop makes the move (S3, S4, S5, S6, S10).
- Their piece, nothing selected: nope outline 600 ms; row 2 "You are {White}. Move a {white} piece." (7) for 2.5 s, then the task returns. Nothing graded.
- Illegal drop: snap back, then row 2 "That piece can't go there." (5) for 2 s. It fires from `sessionClick` (`card:209`) only after a drag (`pointerState.suppressClick` set), never on a tap that deselects.
- **After an answer** (S0, story, S7 once played): a tap or press on any piece draws the nope outline 600 ms and shows N1 "To try moves, open Details." (5) for 2.5 s: row 2 in S0, the strip in the story. No state change, no step.
- Keys: `?` Hint, Enter = right-hand button, Tab reaches `#kbmove` (kept).

#### S3. Move sent, engine checking
Only for moves not stored on the card; stored moves (best, forcing-line, game move) get their verdict when the piece lands.
- **Landing:** overlay, checking tints, … badge. No text change.
- **300 ms, still waiting:** disc …, row 1 "Checking {san}…" (2), a 1 px text-3 sweep on the band's bottom edge (static under reduced motion). **3 s:** row 2 "Still checking." (2). **9 s, engine error, or `SF.state === 'failed'`:** S11.
- **Bar:** [Take back] [Show the answer (disabled)]. Take back, Esc or a tap on the tried piece: `engineStop('check')`, new `checkTok`, crossfade back, no miss, attempt undone. **Words:** at most 10.

#### S4. Wrong try (miss)

| Beat | Board | Text | Bar |
|---|---|---|---|
| V (engine answer, after your slide) | ✗ badge on the landing square, red tints | Bad band, disc ✗, row 1 "Not this one" (3). `bad`, haptic | [See it ›] [Try again (gold)]; focus Try again |
| V + 600 | Attacker ring on the piece that refutes the try (first move of `info.pv`), dashed threat arrow to its target, label "takes", all under 2.3 | none | |
| V + 750 | | Row 2: M3, e.g. "You'd lose a knight for a pawn." (7) | |

- **Words:** 3 + 7 + 1 + 2 + 2 = 15. The tried move stays; nothing resets by itself.
- **See it ›:** their one reply slides (320 ms, `move`); on landing the token (not on `best.to`), the ring and arrow go, label "lost" if it fits. Then the left slot becomes Hint ("Hint 2" or "No more hints" by `a.hints`) at misses 1 and 2, or "Show the answer" (outlined) from miss 3. **Try again stays the gold right-hand slot at every miss.** See it plays exactly one opponent ply (U1).
- **Try again** (also a tap on any of your pieces or the tried piece, or starting a drag): `engineStop('check')`, text out (100 ms), crossfade to the card position (150 ms), the tried line lands, text back at +300 ms: T1/T2, or H1 plus H2/H3 when an automatic hint is drawn on this Try again (tier 1 after miss 1, tier 2 after miss 2, never tier 3). A tapped piece is selected; a drag continues from the real position.
- **Hint, `?` or Show the answer pressed in `tried`** run the Try again transition first, then the hint (S8) or the reveal (S7).
- **No concrete loss** (the classifier on the try, `card:461`, finds none): no marks; row 2 is M3(d).
- **Your game move again:** row 1 "Your game move again" (4); marks from the stored refutation; row 2 M3 from `a.cls` with the M2 guard.
- **Grading:** as today (`a.misses++`, `srsNoteMiss` on miss 1, `keepProgress`). Miss 3 reveals nothing.

#### S5. Close move (soft fail)
The close rule (`card:400-431`, `STRONGER_TOL`, still `!inLine` at `card:415`) replaces the "does not lose anything" wording (`card:466`).
- **V:** close badge (hollow ring, ✓), blue-grey tints; band disc the same; row 1 "Good move" (2), row 2 "There's a stronger one." (4). `tap`. No ring, arrow or See it.
- **Bar:** [Show the answer] [Keep looking (gold)]. Keep looking or a tap on your piece crossfades back with no miss. A second close move shows row 1 only. **Words:** 11.
- **Grading:** not a miss; `a.foundGood` as today, so a later solve or a reveal scores `hint`.

#### S6. Correct answer and the settled result (S0)

| Beat | Board | Text | Bar |
|---|---|---|---|
| V (on landing) | Filled green ✓, green tints. The board keeps your move | Good band, row 1 "Found it" (clean first try) / "You got there" (after misses, hints or a close) / "That works too" (`a.alt`). `good`, haptic | [See why ›] [Continue (gold)]; focus Continue |
| V + 700 (S0 marks) | Ghost of the game move with its ✗; the dashed threat arrow and ring of the game line's first reply, only when it is a capture or check, its piece still stands there, and the family is not `chances`. One label | none | |
| V + 850 | | Row 2: R4, e.g. "Be3 is guarded. Bf4 lost the bishop." (7). Strip "Details" | |

- Nothing further until a tap; board taps never advance (S2 after-answer rule). **Words:** 2 + 7 + 1 + 1 + 2 + 1 = 14.
- **Missed chance:** ghost and ✗ only; R4 chances caption.
- **After a forcing line:** V on your last move; S0 shows the end of the line, green tokens on what you won, the ghost when its square is empty.
- **Early alternative inside a forcing line** (within `SOLVE_TOL`, `solved(..., inLine)` at `card:406-412`): the card ends; row 1 "That works too"; S0's board is `a.st` after your move; the story's Better segment is your line from `a.yours.at`.

#### S7. Show the answer (reveal)
- `reveal()` grades and calls `finishCard` as today (`card:519-527`), so the phase is `done` and `settleLeft`, `disputeCard` and `endSession` already treat it as answered; it then sets `a.view = {mode: 'show'}` and writes `ss.notes[key] = 'shown'`. Grading: `fail`, or `hint` after a close.
- **Board:** the current position; inside a forcing line `a.st` keeps your correct moves (problem map 4.7). Green arrow with label "the answer"; game arrow hidden.
- **Band:** info, disc i, row 1 "The answer: {bestSan}" (3), row 2 "Play the green arrow." (4). **Bar:** [Continue] [Play it › (gold)]. **Words:** 12.
- Play the move by hand or tap Play it (320 ms). Other moves snap back. On landing: grey i badge, grey tints, `move`; the band stays.
- **Mid-line:** the rest of `a.sol` is stepped: each opponent reply on the S10 timeline, each of your moves shown with the green arrow and Play it ›. At the end of the line (or at once on a one-move card): S0 marks at +700, R4 at +850, bar [See why ›] [Continue (gold)].
- Continue at any point ends the card.

#### S8. Hints
- **Hint 1, danger** (`safety`, `king`, `conversion`, `quiet`): on the card position, the game line's first reply after your game move: attacker ring plus dashed arrow, label "takes". Row 1 "Hint 1 of 2" (4, gold), row 2 "See what {gameSan} runs into." (5). If that reply is not a capture or check: no marks, row 2 from H2.
- **Hint 1, `chances`:** gold dashed ring on the prize piece, label "free {piece}" when undefended, else none; row 2 H2.
- **Hint 2:** the gold ring on `best.from` (or the current forcing step's from-square). Row 1 "Hint 2 of 2", row 2 "Move the circled piece." (4). Never a ring on a target square.
- Both obey 2.3. **Bar:** after hint 1 [Hint 2] [Show the answer]; after hint 2 [No more hints (disabled)] [Show the answer]. **Words:** 15. **Grading:** `hint`.

#### S9. Tier 1 worked example
On a tier-1 player's first card of a pattern family (`nl:seen:<family>` is 0; unreadable storage counts as seen), S1 opens with hint 1's marks drawn. On the first card ever, only the game-arrow label shows; the threat's first-sight label waits for the next frame that draws it. `a.hints = 1`, `a.predraw = true`, so Hint gives hint 2. A solve records `hint`; `finishCard` writes note `'firstlook'` and increments the counter. Never at tier 2 or 3 or on a relearn card.

#### S10. Forcing (multi-move) puzzle
Chosen as today (tier 2 and up, `card:102-112`). It opens exactly like S1: no pips, no count.

| t (ms) | Board | Text | Bar |
|---|---|---|---|
| 0 (your slide ended) | Filled ✓, green tints | Good band, row 1 "Right" (1), row 2 "{Opp} replies next." (3); pips appear (the chip, if any, gives way). `good` | [Hint] [Show the answer], disabled |
| 600 | Telegraph: reply ring plus blue-grey dashed arrow | none | |
| 1500 | The reply slides 400 ms, `move`; `motionUntil` = 1900 | none | |
| 1900 | Landing: arrow solid this frame; token on a capture; check glow | none | |
| 2050 | | Neutral band, king disc, row 1 "Your move" (2), row 2 F4, e.g. "Black took your queen, as expected." (6); next pip current | Enabled |

- **Input in phase `reply`:** before 1500 it starts the slide now (telegraph kept, text at landing + 150); during the slide it is swallowed. The input that triggered the flush is never passed on; board input resumes at the 2050 frame.
- **Reduced motion:** at 0 the right slot shows [Their reply › (gold)] and the left slot is empty; the telegraph is drawn; the reply plays only on that tap (0 ms), then the 2050 text 300 ms later.
- **Mid-line moves:** a stored line move is S10 again; a move within `SOLVE_TOL` ends the card (S6 early alternative); anything else is S4, where See it plays their best reply and Try again returns to the mid-line `a.st`. There is no close verdict mid-line (`!inLine` stays). Mid-line reveal: S7.
- **Final move:** S6. **Words:** at most 13.

#### S11. Engine failure
At 9 s, on an engine error, or at once when `SF.state === 'failed'` and the move is not stored (today `card:358` calls `miss()`).
- **Board:** the overlay stays, grey tints, ? badge. **Band:** info, disc ?, row 1 "Cannot check this move" (4), row 2 "Not counted. Try again." (4).
- **Bar:** [Show the answer] [Try again (gold)]. **Words:** 13. Never a miss; `a.verdict.html` still matches `/cannot check/i` (`session.test.js:248`); stored moves are still graded. While `SF.state === 'failed'`, "Try your own moves" is hidden everywhere.

#### S12. The stepped explanation ("See why")
- **Entry:** See why ›, a left swipe, or → from S0. Built once by `buildStory(a)`.
- **Game segment:** `cls.gameLine` nodes 0 to `cls.lossAt` (`classify:238`, returned at `:314`; `gBlow` is not returned and is not used). For `cls.mateAgainst`, step `a.lines.refute` (kept to 21 plies, `card:35-37`) to the mate, since `cls.gameLine` keeps 8 plies (`classify:216`).
- **Better segment:** `a.lines.best` indices 0 to `cls.bSettle - 1` (`cls.bestLine` node 0 is a null move and `states[0]` is already after the best move, `card:25-28`); the whole of `a.lines.best` for `cls.mateFor`. For `a.alt`: `alt = buildLine(a.pre, '0000', a.yours.uci, myPov(a.it))`, stepped from `a.yours.at` to its own `settleIndex(alt)`, with gains from `captureWord(alt, k)`.
- One ply per tap, so a one-move blunder takes 3 taps.

| Step | Board | Caption |
|---|---|---|
| G1 | Crossfade (150 ms) to the card position; the game move slides (320 ms) along its red arrow, kept as the trail. On landing: ring plus dashed arrow of the next reply when it is a capture, check or the motif's move; one label | S-G1, e.g. "Bf4. Nothing guards the bishop on f4." (7) |
| G2 to Gk | The next ply slides; red token on a capture of yours; check glow | S-ply; the first opponent ply uses S-opp; the last names the net loss |
| B1 | Crossfade to the card position, the green arrow, the better move slides. On landing: filled ✓, plus guard dots when the guard rule holds, otherwise the ghost of the game move with its ✗ (never both, and never the threat pair, which is S0's) | S-B1, e.g. "Better: Be3. The pawn on f2 guards it." (8) |
| B2 to Bm | The next ply; green tokens on gains | S-ply, or S-same when the reply repeats the game's (3.7); the last names the gain |

- **Band:** caption layout, verdict disc kept, red border on game steps, green on better. **Strip:** "Game ●●● Better ●", current dot 1.4x with a ring; tapping "Game" or "Better" jumps to G1 or B1; over 9 dots at 390 px it collapses to "Game 2/5 · Better".
- **Bar:** [‹] [Next move ›] [Continue]. Next move › is gold until the last step, where it is disabled, Continue turns gold and focus moves to Continue. ‹ on G1 returns to S0.
- **Input:** forward = Next move ›, →, Space or a left swipe; back = ‹, ← or a right swipe; Esc = S0. Board taps never step (S2 after-answer rule). In S0, Space does nothing and Enter is Continue (today Space calls `nextCard`, `shell:580`).
- **Words:** 8 + 2 (label, dropped first) + 2 + 3 = 15. `move` sound at each slide.

#### S13. Details sheet
The "Details" link in S0 (and a ••• item after an answer) opens `openSheet` (`render:934`) with a new kind `details` in `sheetHtml` (`render:963`): the context line (`ctxHtml(a, true)`, `render:634`); "This move lost the game." on decisive cards; `s.game` and `s.best`; the opponent line (`opponentLine`, `render:832-841`); the pattern chip; the schedule (`scheduleWords`, `render:861`); the habit (`card:605-607`); and "Try your own moves with Stockfish ›".

#### S14. Explore (tucked away)
- **Entry, only:** the Details row and the ••• item "Try your own moves", on answered cards. Board taps no longer open it (`card:191-195`, `shell:658-668` removed).
- **Start:** `a.pre` with the solver to move (U5), Stockfish's pick as the gold arrow, the eval bar live, today's panel (trail, sentence, 3 rows of the solver's best moves, `render:773-806`). On phone the panel takes the whole area from the board's bottom to the bar.
- **Band:** king disc, row 1 "Try your own moves" (4), row 2 "Stockfish answers each one." (tier 1: "The computer answers each one.").
- **Bar:** [‹] [›] [Continue], wired to `exploreStep` (today's explore branch of `stepView`, `card:718`, behind ← → at `shell:578-579`); › at the end of the trail reads "Play Stockfish's pick". "Back to the lesson" stays in the panel (`render:788`); it and Esc return to the frame explore came from.
- **Exempt** from principles 2, 5 and 6 and from the plain-words test: explore is opt-in behind Details, moves both sides (`explore:68-77`) and repaints board and sentence together. X3 replaces only the tier-1 standing words; tier 2 and 3 rows keep today's numbers.

#### S15. Continue
Continue or Enter (slot guard) calls `nextCard` (`card:664`); "Finish" on the last card. Nothing advances by itself.

#### S16. Relearn card
Chip "One more try" at the right of row 1 on phone and desktop (U8); no tried lines carried over; no worked example; otherwise S1. The relearn segment appears in the session bar when the card is queued.

#### S17. End-of-session summary
- Remove "Today you spotted their reply on N of M" (`render:403-404`), `ss.checks` and `ss.checksFound` (`session:24`, `:226`, `render:395`).
- Notes carry what the result cannot: `reveal()` writes `'shown'`, `finishCard` writes `'firstlook'` when `a.predraw`, `settleLeft` writes `'left'` (no miss) or `'leftMiss'`. `doneHtml` (`render:378-411`) reads the note first: shown "Shown", firstlook "First look", leftMiss "Missed", left "Skipped"; then the result: first "Found", hint "With help", retry "Found after a miss", fail "Missed", skip "Skipped" (today every fail reads "Shown", `render:389`, U6).
- The habit line moves here: one per family seen today ("For your next game: {habit}").

#### S18. First-ever card onboarding
No tour: S1 with the label "Your game move", then each mark teaches itself once (2.1). The touch toast (`render:521-524`, `nl:xpTip`) and the first-run sentence (`render:691-692`, `nl:marksSeen`) are deleted; the how-to-move tip is deferred (section 7). First-session order: section 4.

#### S19. Reduced motion
Every slide, fade and crossfade is instant; beats keep their order; reason beats 300 ms after the verdict; S0 marks 300 ms after the verdict and R4 100 ms later; the forcing reply waits for "Their reply ›". No timer moves a piece (problem map 1.8).

#### S20. Screen reader
- `#sr-live` (`render:538-541`) mirrors the band once per `text` beat, prefixed so meaning never rests on colour: "Correct." / "Wrong." / "Good move, not best." / "Not checked." / "Answer shown.", then rows 1 and 2. Story steps start "Step 2 of 3, your game."
- The board `aria-label` is built from the frame's marks ("White to move. Red arrow: your game move, bishop c1 to f4. Dashed red arrow: the pawn on e5 can take on f4."). The forcing reply is announced after it lands.
- Focus: a new card focuses `#task-h`; a verdict focuses the right-hand button; the story keeps focus on Next move ›, then Continue at the last step. ‹ "Previous move", › "Next move, step 2 of 3". Labels are `aria-hidden`.

---

## 3. Copy table

All card copy lives in `src/js/13y-story.js` (created in slice 5, in `ORDER` after `13x-explore.js`), never in the classifier, so `test/explanations.txt` and `CLASSIFY_V` do not change. `{gameSan}` = `sanOf(a.pre, a.played)`; `{bestSan}` = the answer due now; `{Opp}` / `{White}` from `myPov(a.it)`; `{piece}` = plain name. Caps: row 1 26 characters; row 2 40 characters and 7 words; captions 60 characters and 8 words; labels 2 words.

**Material words.** `plainCapture(line, k, from)` wraps `captureWord` (`classify:114`) and spells "the exchange" as "a rook for a bishop" or "a rook for a knight". Game-line claims use `from = 0`, because node 0 is your own game move and the line's pov is the opponent (`classify:217`, as `classify:443` does). Best and alternative lines use the default `from = 1` (node 0 is a null move).

**Fit ladder** (every templated row): (1) the full text; (2) each material phrase replaced by `materialWord(n)` ("a rook", "the queen"); (3) the first sentence only; (4) the row's static fallback. A fixture test checks every templated string at every tier and in every state against its caps.

**Plain words on the card face** (Details, the pattern sheet and explore are exempt): no percentages, "winning chances", "about level", "edge", "lead", "exchange", "Stockfish" at tier 1, and no pattern names ("pinned" and "fork" only at tier 3). A copy test greps every card-face string at every tier.

| ID | String | Source | Fallback |
|---|---|---|---|
| T1 / T2 | "Your turn" / "Find a better move than {gameSan}." | `a.played` | |
| T3 | "One more try" (chip) | `ss_relearn(a)` | |
| T4 | "You are {White}. Move a {white} piece." | `myPov(a.it)` | |
| T5 | "That piece can't go there." | drag only, `card:209` | |
| N1 | "To try moves, open Details." | piece tap after an answer | |
| K1 / K2 | "Checking {san}…" / "Still checking." | `a.checking`, 3 s beat | |
| M1 / M2 | "Not this one" / "Your game move again" | miss / `sameAsGame` (`card:321`) | |
| M3 | First match: (a) `c.mateAgainst === 1` "Then {replySan} is checkmate."; (b) `> 1` "{Opp} could checkmate you."; (c) `c.lossG >= 1` "You'd lose {plainCapture(c.gameLine, c.lossAt, 0)}."; (d) by the solver's win % after the try: 60+ "Most of your advantage is gone.", 40 to 60 "After {replySan}, the game is even.", under 40 "After {replySan}, {Opp} is on top." Any form containing `{bestSan}` takes the fallback. M2 only: on `chances` cards, "There's a stronger move here." | `c` = `classifyMistake` on the try (`card:461`), `info.pv`, `info.win`; M2 uses `a.cls`, `b.wa` | "You'd lose material." / "That helps {Opp}." |
| C1 / C2 | "Good move" / "There's a stronger one." | close rule | |
| R1 / R2 / R3 | "Found it" / "You got there" / "That works too" | `first` / misses, hints, `a.foundGood` / `a.alt` | |
| R4 | S0 caption. `found` = `lines.game.uci[1] === unpackUci(b.ru)[0]`. **safety, king with `cls.lossG >= 1`:** mistake = found ? "{gameSan} lost {w}." : "{gameSan} could lose {w}." (w = `plainCapture(cls.gameLine, cls.lossAt, 0)`); better = "{bestSan} is guarded." when the guard rule holds, else "{bestSan} wins {w2}." when `cls.matBest >= 1` (w2 = `plainCapture(cls.bestLine, cls.bSettle)`; for `a.alt` from the alt line); print better + mistake, else the ladder. **king, mate:** "{gameSan} allowed checkmate." (+ " They missed it." if not found). **chances:** "{bestSan} wins {w2}. {gameSan} missed it." or "{bestSan} leads to checkmate." **conversion:** stalemate "{gameSan} allowed a draw."; perpetual "{gameSan} allowed endless checks."; else "After {gameSan}, {past}." **quiet:** "After {gameSan}, {past}." ({past} from `b.wa`: 60+ "you were still better", 40 to 60 "the game was even", under 40 "{Opp} was on top") | `a.cls`, `a.lines.game`, `b.ru`, `b.wa` | "{gameSan} was a mistake." |
| V1 / V2 | "The answer: {bestSan}" / "Play the green arrow." | `a.best` or `a.sol[a.solIdx]` | |
| H1 / H3 | "Hint 1 of 2" / "Hint 2 of 2" (gold); "Move the circled piece." | `a.hints` | |
| H2 | danger drawn: "See what {gameSan} runs into."; quiet, no capture or check: "Find your worst piece and improve it."; conversion: "Keep it simple and safe."; chances: "You can win {prize} here." / "There is a checkmate here." / "One piece can hit two targets." / "Look for checks and captures."; forcing line: "The next move is forcing too.", or "Your king is in check." only when the solver's own king is in check (U3). The guard at `card:575-577` still swaps text naming the answer | `a.cls`, family, `a.sol`, `prize` as in `hintText` (`card:550`) | "You can win material here." |
| F1 / F2 / F3 | "Right" / "{Opp} replies next." / "Your move" | forcing step | |
| F4 | "{Opp} took your {piece}, as expected." / "{Opp} gives check, as expected." / "{Opp} played {san}, as expected." | the reply | |
| E1 / E2 | "Cannot check this move" / "Not counted. Try again." | engine failure | |
| S-G1 | By the threat at the next opponent ply (or the motif's ply within `cls.lossAt`): undefended target "{gameSan}. Nothing guards the {piece} on {sq}."; defended, cheaper attacker "{gameSan}. Their {apiece} can take your {piece}."; fork "{gameSan}. Now {replySan} hits two pieces."; mate "{gameSan}. Now {Opp} can checkmate."; check "{gameSan}. Now {replySan} is check."; pin (`mPin` on the ringed piece, not a pawn) "{gameSan}. Your {piece} can't move safely."; discovered "{gameSan}. Moving one piece opens a line."; stalemate "{gameSan}. {Opp} has no move: a draw."; none "{gameSan}, your game move." | `cls.gameLine` nodes, `cls.allowed`, `isDefended`, `attackersOf` (`motifs:47-58`) | "{gameSan}, your game move." |
| S-ply | Their capture "{san} takes your {piece}."; yours "{san} takes their {piece}."; check "{san}, check."; mate "{san}. Checkmate."; quiet "{san}." Last game step adds "You lose {plainCapture(gameLine, k, 0)}."; last better step "You win {plainCapture(line, k)}.", unless the step's capture already names it | node k | "{san}." |
| S-opp | found ? "{san} takes your {piece}, as in your game." : "{san} could take your {piece}. They missed it." | `found` | |
| S-B1 | guard "Better: {bestSan}. The {dpiece} on {dsq} guards it."; gain "Better: {bestSan}. It wins {w2}."; mate "Better: {bestSan}. It leads to checkmate."; alternative "Your {yoursSan} works too." (never reads `cls.matBest`); else "Better: {bestSan}." | guard rule, `cls.matBest`, `cls.mateFor`, `a.alt` | "Better: {bestSan}." |
| S-same | B2 when `cls.bestLine.nodes[2]` repeats `cls.gameLine.nodes[1]` (4 fixture cards): "{san} still comes, but you lose nothing." / "{san} still comes, but you win {w2}." / "{san} still comes. You lose less." from `plainCapture` at `bSettle` | both lines | "{san} still comes." |
| L | undefended capture target "free {piece}"; defended capture "takes"; fork "hits two" ("fork" at tier 3, `mFork` confirmed); pin "stuck" ("pinned" at tier 3, `mPin` confirmed); check "check"; mate "mate"; stalemate "draw"; forcing reply "their reply"; better "better"; reveal "the answer"; See it landing "lost"; hint 1 danger "takes", prize "free {piece}" or none; explore "Stockfish" | drawn geometry | none |
| X3 | Tier-1 explore rows: 80+ "you are winning", 60 to 80 "you are better", 40 to 60 "even game", 20 to 40 "{Opp} is better", under 20 "{Opp} is winning" | `xpRowWords` (`explore:457`) | |
| B | "Hint", "Hint 2", "No more hints", "Show the answer", "Take back", "See it ›", "Try again", "Keep looking", "See why ›", "Continue", "Finish", "‹", "Next move ›", "Play it ›", "Their reply ›", "›", "Play Stockfish's pick", "Details" | state | |
| Q | "Found", "With help", "First look", "Found after a miss", "Shown", "Missed", "Skipped"; "For your next game: {habit}" | `ss.results`, `ss.notes` | |

**Guard rule** (R4, S-B1, guard dots): `isDefended` returns false on an empty square (`motifs:58-60`), so evaluate it on `cls.gameLine.nodes[0].after.b` at the game move's square (false) and on `cls.bestLine.nodes[1].after.b` at the better move's square (true), or the better move defends a piece the game move left hanging.

`a.verdict` becomes `{kind, row1, row2, html}` with `html = row1 + ' ' + row2`, so `session.test.js:248` and `:300` keep reading `a.verdict.html`.

---

## 4. What is removed or moved

**Removed:**
- **The blunder check:** phase `check`, `a.check1` (`card:114-134`), `checkStep` (`card:260-288`) and its branches in `gradeMove` (`card:238`), `sessionClick` (`card:187`), `finishCard` (`card:592`, `:611`), `renderCardBoard` (`render:456`, `:468`), `cardTaskHtml` (`render:574-575`), `panelHtml` (`render:671-679`, `:716-722`); the `checkShow` action (`shell:476`); `check` and `check1` in `boardState` and `__nlTest` (`shell:646`, `:799`, `:807`) and its strings; the recap line and its tallies (S17).
- **Autoplay:** `autoplayLine`, `stopAuto`, `toPayoff` (`card:618-656`) and their callers (`explore:36`, `card:721`, `shell:487`); `playPunish` and its reset (`card:476-510`); the 3-ply cap; the card-open slide (`card:95`); the tappable top sentence (`render:562`) and `lineTab`'s autoplay (`shell:486`).
- **Motion and first-run text:** the toast (`render:521-524`, `nl:xpTip`); the first-run sentence and `nl:marksSeen` (`render:691-692`, `card:232`, `shell:484`); the Hint pulse `.btn-pulse` (`render:706`, `css:111`).
- **Text:** "Move n of N: now finish it." (`card:304`); the stakes line with percentages (`render:659-667`); the close-move percentages (`card:430-432`); the "You are White." prefix; the miss-3 reveal (`card:349`); Hint greyed at tier 3 (`card:533`, `render:705`); board taps that open explore (`card:191-195`, `shell:658-668`); the phone-only hiding (`css:512`, `css:516`) and the success-colour override (`css:419`).

**Moved behind a tap (Details, S13):** the context line, "This move lost the game.", the long red and green sentences, the alternative line, the opponent line (also folded into S-opp), the pattern chip, the schedule, the habit and the explore entry. The answered panel (`render:714-770`) shrinks to band, Details link and bar. **Moved to the summary:** the habit per family and the S17 words.

**First-session order.** With the check gone, the cards `cardEaseOf` ranks easiest (`session:56-70`) are plain cards with one drawable threat, so the ease sort (`session:146`) stays. In `todayPlan` (`session:132-160`), first session only:
1. New `looksForcing(it)` mirrors `card:102-106` without the classifier: tier 2 or 3, at least 3 moves in `unpackUci(b.lu)`, and the first best move captures or checks, or `b.mb != null && b.mb > 0`.
2. `lostLast` (`session:149-152`) is skipped when `looksForcing(lostLast)`; ease ties put non-forcing cards first; at most one forcing card in the first three.

---

## 5. Bugs fixed as part of this work

| # | Bug | Exact fix |
|---|---|---|
| U1 | A wrong-try replay can play the answer | `playPunish` deleted; See it applies one ply, the first move of `info.pv` (`card:437`). |
| U2 | Replays contradict the text | Story cut at `cls.lossAt` and `cls.bSettle - 1`; each caption describes only the ply shown; material from `plainCapture` with the right `from` (section 3). |
| U3 | False "You are in check" hint | `hintText` (`card:542-543`) checks `checkedKingSq(a.st) === kingSq(a.st.b, myPov(a.it))` (`00-legacy.js:780`), phase `guess` only. |
| U4 | Tactic names that do not match the board | Labels from drawn geometry; no pattern names on the card at tiers 1 and 2; fork and pin need `mFork` / `mPin` (`motifs:196`, `:215`). |
| U5 | Explore starts at the line end, wrong side | `startExplore` (`explore:32-51`) starts at `a.pre`, solver to move; `inviteFor`'s frame logic (`explore:20-30`) goes. |
| U6 | Unfair grading | Soft fail replaces the ✗ at `card:466`; recap words from notes (S17). |
| U8, 2.4, 4.6 | Phone dead ends; their piece selectable; board rewinds after a solve | Hint always on, relearn chip, labelled story button, pieces always answer (S2); opponent pieces never select; `solved` keeps your move. |
| U9, U10 | Tiny marks; text-driven layout shift | Short-arrow rule and T5; fixed 56 px band and eval slot. |
| 1.6, 1.8 | Toast mid-animation; reduced motion half honoured | Toast deleted; no timer moves a piece; the reply has a tap-only branch. |
| 3.7 | Better line repeats the same blow | S-same caption on B2. |
| 4.7 | Mid-line reveal names an old move and wipes your moves | `reveal` (`card:519-527`) keeps `a.st` when `a.sol && a.solIdx > 0` (today `card:523` resets it), names `a.sol[a.solIdx]`, then S7's mid-line stepping. |
| Engine | `SF.state === 'failed'` counts a miss (`card:358`); a stale search delays the next check | S11, no miss; `tag: 'check'` plus `engineStop('check')`. |
| Slips | A slipped drag counts as a try | Take back in S3, ungraded. |

---

## 6. Implementation plan: ordered slices

One branch, one commit per slice, in order. **After every slice:** `python3 build.py && npm test && npm run lint`, commit `src/` with the rebuilt `index.html`, and `npm run check` passes. Slice 1 adds `test/cardflow.test.js` to the `test` script: realm from `test/app-realm.js`, fake clock (`setNow`, `flush`), and an `engineEval` stub that returns the stored refutation for a try (as `explore.test.js:23`), since Node has no engine. The spoiler (2.3), fit (section 3) and 15-word loops only cover states already built; each slice adds its own. `e2e` runs by hand in a real tab. Test names follow `PROBLEM-MAP.md` 4.3.

**1. Board options as data; spoiler test.** Build: pure `boardOptsFor(a)` from `renderCardBoard` (`render:415-478`); its side effects (`render:423`, `:429`, `:439`, `:470`) stay in `renderCardBoard`. Tests: the 2.3 rule on 91 cards, tiers 1 to 3, `guess` frames only (open, hints 0 to 2); `check` skipped. Accept: no visible change.

**2. Blunder check out; first-session order.** Build: section 4's check removals; `looksForcing`; the `lostLast` skip. Tests: delete `session.test.js:259`; rewrite `:276` as "an opponent-piece tap never grades and the phase stays guess"; drop `a.check1` from `OPEN` (`:19-26`); delete `e2e:53`, `:56`, `:57`, `:125`; new "no card enters a check phase"; "first-session card 1 is not forcing": `!cardFor(model().byKey[keys[0]]).sol` at tier 2. `srs.test.js` has no check paths and stays. Accept: a fresh profile's first card asks for a better move.

**3. Nothing moves on its own.** Build: delete autoplay with its three `stopAuto` callers in this commit; `lineTab` becomes `a.view = {line: k, idx: -1}; renderCard()`; delete the card-open slide and the toast; phase `tried` (overlay, `tryAgain()`, wrong-state contract); `escalate` (`card:346-352`) loses the miss-3 reveal and gains the auto-hint tier rule; `card:358` goes to S11; `tag: 'check'` and `engineStop('check')`; `__nlTest.play` on `tried` calls `tryAgain()` then grades; the e2e loop (`e2e:188-191`) clicks Try again on `tried`. Interim UI: today's verdict text, [See it ›] [Try again]. Tests: invert `e2e:84` to "board and band unchanged 5 s after an answer"; `e2e:150` "tier 2: hint 1 is on after the second Try again"; `e2e:159` "miss 3 offers Show the answer; result still null"; extend `session.test.js:248` with "SF failed plus an off-book move: no miss, /cannot check/, the stored best still solves"; new "after a miss, flushing every timer moves no piece"; the spoiler loop adds after-a-miss frames. Accept: after any answer nothing moves for 10 s.

**4. Board primitives.** Build: `boardSvg` (`board:114-241`) takes `opts.arrows[] {from, to, kind, key}`, `tints`, `rings`, `badges`, `tokens`, `ghosts` (no `data-sq`), `guards`, `tried`, `fx`; z 8 to 12 render into the marks svg (2.0); `opts.bad`, `good`, `ghost`, `hint` stay as aliases (`shell:413`, `:619-622`, `:691-694`); short-arrow rule. Tests: distinct marker ids; no `data-sq` on a ghost; badge square right on a flipped board; one-square head 4.2; the board svg is `#bwrap`'s first child.

**5. Sequencer and band.** Build: `src/js/14s-stage.js` (after `14-render.js` in `ORDER`): `stage`, `flushStage`, `motionUntil`, beats, slot guard. Create `13y-story.js` with T1 to T5, N1 and the fit ladder. Split `renderCard` (`render:479-542`) into `paintBoard`, `paintMarks`, `paintBand` (`bandHtml` replaces `cardTaskHtml`, `render:553-583`), `paintBar`, `paintStrip`, `paintLive`; `displayFor(a)` returns `{disc, kind, row1, row2, chip, pips, buttons, strip, live}`. `flushStage()` first in `sessionClick` (`card:185`), the pointer handlers (`shell:649-700`), the click and key handlers; the swipe branch before `shell:670` (inert until slice 9); eval bar `.pending` off explore (`render:475`); band CSS (`css:409-420`, `:504-506`). Tests: rewrite `session.test.js:331` as "S1, S2 and the answered frame fit 26 / 40 / 60 characters at every tier" via `displayFor`; fake clock: "no board, marks or text write while `motionUntil` is in the future" (over S1, S2 and the answered frame; `stepLine` joins in slice 11); "a slot ignores clicks for 450 ms after its label changes"; e2e: a MutationObserver plus `transitionrun`/`transitionend` records zero text writes inside a slide, and at 360 x 640 the band's `scrollHeight <= clientHeight`. Accept: the band reads "Your turn / Find a better move than X"; the board never moves at 390 x 844 or 360 x 560.

**6. Verdict states.** Build: S3, the S4 V beat and bar, S5 (one path for `card:400-431` and `:466`), S11, T4 (`card:207`), T5 with the drag guard, N1, the close badge, haptics; `giveHint` loses the tier-3 gate; `.btn-pulse` goes. Tests: `e2e:132-133` read "Your game move again"; "a close move is not a miss"; "Take back records no attempt and no miss and stops the check job"; "T4 never grades"; "Try again is the right slot at miss 3"; fit and budget.

**7. The miss explained.** Build: `threatOf(line, k)`, M3 with the ladder, S4's V+600 and V+750 beats under 2.3, See it, tried lines. Tests: "See it adds exactly one opponent ply"; "no miss caption names the answer" (the `:300` rule on every stored try); "no S4 mark or tried disc on `best.to`"; fit.

**8. Settled result, reveal, Details.** Build: `buildCompare(a)`, R4; `finishCard` (`card:580-634`) sets `{mode: 's0'}`; the done panel (`render:714-770`) becomes band, Details link and bar; sheet kind `details`; `reveal` sets `{mode: 'show'}` and note `'shown'`; `playIt()`; mid-line stepping; the 4.7 fix; `__nlTest.play` on `show` plays the answer; `data-act="next"` keeps its name. Tests: `e2e:70` drops `.ctx`; `e2e:80` "the Details sheet holds both sentences"; `e2e:113` checks the S0 band; `e2e:160` reads "The answer:"; "R4 never uses the found form when `lines.game.uci[1] !== ru[0]`"; "Skip, Back and endSession never regrade a revealed card"; fit.

**9. The story.** Build: `buildStory`, `storyStep`, `storyJump` per S12 (mates, alternatives, S-same), strip, bar, keys (Space), swipes on. `lineView` becomes `frameView` and `stepView`'s explore branch becomes `exploreStep`, both kept until slice 12; `lineTo`, `lineBack`, `lineFwd`, `lineTab` go. Tests: `e2e:87`, `:88` "See why enters the story; G1 shows one `.bad-arrow` and one `.threat-arrow`"; keep `:99`; "honest captions" (U2); "the game segment ends at `lossAt`"; "the better segment has `bSettle` steps"; "a one-move blunder has 3 steps"; "board taps never change the step"; budget.

**10. Drawn hints.** Build: `hintMarks(a)`; `hintText` returns `{row1, row2, marks}`, and every caller changes (`displayFor`, `session.test.js:324`, `:346`); U3. Tests: extend `session.test.js:316` from text to marks on all cards and tiers; the spoiler loop adds both hint levels and hints pressed in `tried`; U3 test.

**11. Forcing line.** Build: `stepLine` (`card:290-318`): the S10 timeline, `.anim-slow`, the reply input rule, chip then pips, `theirReply()`, mid-line miss and early alternative. Tests: "opens with no pips or count"; "reduced motion: no reply without a tap"; fake clock: "a tap during the reply never jumps the piece, and no text lands during the slide"; the spoiler loop adds reply frames.

**12. Explore.** Build: entry only from Details and •••; `startExplore` at `a.pre`; bar [‹] [›] [Continue] on `exploreStep`; the phone panel area; hidden when `SF.state === 'failed'`; X3; `frameView` goes. Tests: `explore.test.js:71` checks the Details row; `:81` "starts at the card position with the solver to move"; delete `:89`; `:83` opens from `{mode: 's0'}`; `:137` calls `startExplore({})`; keep `:97`, `:174`; update `e2e:92-99`.

**13. Labels and worked example.** Build: `.blabels`, pure `placeLabel(geom, w, h)`, priority, `nl:tip:<kind>`, `LABELS_ON`; S9 with `nl:seen:<family>`, `a.predraw`, note `'firstlook'`. Tests: `placeLabel` never overlaps a piece, badge, token, ring or shaft on a flipped board and a 316 px board; first-card priority; "an unshown label is not marked seen"; a worked-example solve records `hint`.

**14. Summary and finish.** Build: S17 notes and words (`render:378-411`, `settleLeft`), habit per family, the relearn segment (`render:606-619`), the desktop key line, the board `aria-label`. Tests: keep `session.test.js:226`; new "left after a miss reads Missed", "a reveal reads Shown"; update `e2e:196-197`. Then the founder tries it live (decision 3).

---

## 7. Out of scope, later

- Classifier sentence fixes and their `CLASSIFY_V` bump; those sentences now live only in Details.
- An explore redesign beyond entry, start, side, bar and tier-1 row words.
- U7 beyond the relearn segment; the 7 px desktop page shift; recap thumbnails.
- Threat-spotting as a scored skill; two-arrow choices; new sounds and iOS haptics.
- **The how-to-move tip (problem map 2.7):** tap-tap and drag both work as in every puzzle app, and T5 and the nope outline answer the two ways a beginner gets stuck. A timed tip is extra text for every player; revisit if the founder's live test shows confusion.
- Turning `LABELS_ON` off, if the founder finds the labels busy.

---

## Review notes (spec-critique.md, 33 findings)

**Resolved in place (finding: where):** 1: 2.2, S10 · 2: 2.0, 2.2 · 3: 2.3, slices 1, 3, 10, 11 · 4, 6, 24: section 3 · 5, 25: S12 · 7, 18: S7 · 8, 19: S4 · 9, 22, 23: 2.2 · 10: S2 · 11: slices 3, 9, 12 · 12: slice 5 · 13: rule 4, 2.1 · 14, 16: 2.1, S9 · 15: 2.3 · 17: S6, S10 · 20: S14 · 21: section 4 · 26: S-same, section 7 · 27: slices 3, 8, 10, 12 · 28: throughout (the card-open slide is `card:95`) · 29: S17 · 30: 2.0, slice 5 · 31: 2.0, S10, S12, S20, guard rule · 32: slices 1, 13 · 33: S12 B1.

**Decided differently from the critique, one line each:**
- 31e: `.blabels` and the marks svg stay inside `#bwrap` after the board svg, not as siblings, so `#bwrap .bad-arrow` (`e2e:88`, `:99`) keeps working; `paintBoard` rewrites them, so `render:467` wiping them is harmless.
- 24b: the pin wording is "can't move safely", not "can't move", because a piece pinned to a queen may legally move.
- 26 (2.7): deferred, not built (section 7).
- 33: the finding's two sentences disagree; B1 shows guard dots or the ghost with its ✗, and the ghost with its threat pair appears only in S0.
- 1c: `motionUntil` has no margin; the 150 ms text gap is the margin, so the S10 times stay 600 / 1500 to 1900 / 2050.
- F4 says "as expected" instead of C's "That was expected." so it fits row 2's 40 characters.
