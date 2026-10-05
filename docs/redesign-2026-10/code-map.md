# notlichess card flow: code map (2026-10-03)

For the redesign of the game-review card after the founder's feedback. Source is `outputs/lichess-launcher/src/` at commit 34439f2 (the live build). Nothing in the repo was edited. Every claim carries a `file:line`, and runtime numbers (font sizes, timings, word counts) were measured, not guessed:

- **Rendering and timing:** a scratch copy of the built page (analytics stripped, chess-site API calls stubbed so the 50 fixture games in `test/data/fixture-games.json` stay put) was driven in headless Chrome at 1280x900 and at 390x844 (phone emulation, touch). A 40 ms sampler recorded every change to phase, board, arrows and text. Screenshots are in `shots-codemap/` next to this file.
- **Copy:** all 91 trainable fixture cards were run at tiers 1, 2 and 3 through the real functions in a Node realm (`test/app-realm.js`).
- **Scripts:** `scratchpad/ux/codemap/` (`drive.mjs`, `measure.js`, `words.js`, `show.js`, `raw-desktop.json`, `raw-phone.json`, `measure.json`).

File shorthand: `card` = `src/js/13-card.js`, `render` = `src/js/14-render.js`, `shell` = `src/js/15-shell.js`, `board` = `src/js/02-legacy-2.js`, `session` = `src/js/12-session.js`, `explore` = `src/js/13x-explore.js`, `css` = `src/app.css`.

---

## 0. The findings that matter most for the feedback

1. **The first session can be all blunder-check cards.** On the fixture, the first-ever Today session was **5 of 5 check cards** in the browser run (tier 2) and 4 of 5 in the Node run. The cause:
   - `cardEaseOf` gives ease 3 to exactly the safety cards whose punishing reply is a capture (`session:63-66`), which is the same condition that turns on the check step (`card:118-127`).
   - The first-time plan sorts by ease, highest first (`session:146`).
   - So the step the founder found confusing is the very first thing a new user meets, card after card.
2. **Tapping your own piece in the check step does nothing at all:** no sound, no repaint, no notice.
   - Code path: `sessionClick` selects only pieces of the side to move (`card:200-205`). In the check step that side is the opponent. Then `if (a.sel < 0) return;` (`card:207`) leaves silently.
   - Measured: two taps on own pieces left `#cpanel`, `#ctop` and `#bwrap` byte-identical (`shots-codemap/desktop-02-check-after-own-taps.png`).
   - `session.test.js:276` pins this (it expects the phase to stay `check`).
3. **In the check step the board gives no cue that you are moving the other side.**
   - There is no arrow (the red arrow is drawn only in `guess`, `render:458`). There is no turn marker. The only mark is the last-move highlight on the user's own mistake (`card:130`, `board:135-137`).
   - The board keeps the user's orientation, so the pieces to move sit at the far edge (`shots-codemap/desktop-01-check-start.png`).
   - On a phone the whole instruction is one 15 px line above the board (`phone-01-check-start.png`).
4. **The text arrives in the same frame as the board change, and then pieces keep moving.**
   - `renderCard` writes the board and the panel in one call (`render:509` and `render:516`).
   - Measured on desktop, solved card: the solving move's 220 ms slide and the full result panel (headline, 3 lines, chip, schedule, invite: 44 words median at tier 2) appear together at t=201 ms.
   - Moves then autoplay at 1.5 s and 2.2 s.
   - After a missed check, the panel appears at once. The board then plays 3 red-line moves and 3 green-line moves between 1.4 s and 7.1 s.
5. **After a check answer the board jumps to a different position.**
   - The answered view starts from the position *before* the mistake (`card:282`), one ply earlier than the position the user was solving.
   - The reply they just played (right or wrong) is never shown (`desktop-03-check-miss-0600ms.png`, `desktop-04-check-found-0150ms.png`).
6. **A wrong try plays the same lesson three ways at once.** The verdict text appears when the replay starts. The tried move slides a second time 250 ms later. Then the punishing reply (500 ms) and the user's own forced reply (700 ms) follow, and the board snaps back with no animation 900 ms later (`card:476-510`). The cycle takes 3.1 s. During the replay:
   - The red arrow disappears (`render:458` only in `guess`).
   - The captured piece simply vanishes, with no marker.
   - The only cues are the green last-move squares and the red check glow (`desktop-06-guess-try1-1500ms.png`).
7. **On a phone, the tips and the explanation of the red arrow never show.** The panel's `.task`, `.stakes`, `.stakes-tag` and `.feedback` are hidden from sight on a phone (`css:512`). The phone prompt line (`render:553-583`) does not carry:
   - the how-to-move tip "Drag a piece, or tap it and tap a square..." (`render:692`);
   - the tier-1 tip (`render:693`);
   - the stakes line;
   - the "circled" note of hint 2.

   For the 71 of 91 non-decisive cards, the phone prompt is just "You are White. Find a better move." with nothing on what the red arrow is.
8. **The how-to-move tip never shows on a check card, on any device.** The check branch of `panelHtml` returns before the tip (`render:671-679` versus `render:691`), and `gradeMove` sets `nl:marksSeen` on the first move of any kind (`card:232`).
9. **Success is barely signalled on a phone.**
   - The ✓ result headline and the green line are hidden on a phone (`css:516`).
   - The prompt line in the `good` state is recoloured from green back to the body off-white (`css:419` overrides `css:414`). Measured colour: rgb(222,219,210).
   - Result: "✓ Qe6. You got there." looks like any other sentence (`phone-09-done-settled.png`).

---

## 1. How the card is drawn

- **Layout:** `renderCard` (`render:479-542`) builds the card shell once per card (`render:491-501`):
  - `#ctop`: the session bar and the phone prompt line;
  - `.board-row`: the eval bar `#ebar` and the board `#bwrap`;
  - `#cpanel`: the panel.
- **Every repaint:** `#ctop.innerHTML` (`render:506`), then `renderCardBoard` (`render:509`), then `#cpanel.innerHTML` (`render:516`), all synchronously. **The board SVG is rebuilt from a string on every repaint** (`render:467`), so any CSS animation on the board restarts on each `renderCard`.
- **Focus:** a new card focuses `#task-h`, and the first answered frame focuses `#result-h` (`render:526-527`). A screen-reader live region mirrors the prompt line (`render:538-541`).
- **Phone (max-width 860 px):** the panel copy is hidden (`css:512`). The one-line prompt `.card-task` carries the task, the verdicts and the result:
  - 15 px Lora, line-height 20 px;
  - a fixed 56 px box clamped to 2 lines (`css:409-415`, `css:504-506`);
  - capped at 80 characters by `fitLine` (`card:64-69`), and `session.test.js:331` enforces the cap.

## 2. The state machine

`a.phase` lives on `ui.session.active` (created by `cardFor`, `card:74-136`). The header comment at `card:1-4` is out of date: it omits `check` and `punish`.

| Phase | Entered from (trigger, file:line) | Leaves to | Board shows (`renderCardBoard`, `render:415-478`) | Desktop text (panel) | Phone text (`.card-task`) | Buttons |
|---|---|---|---|---|---|---|
| loading (`ss.active` null, `ss.loadingKey` set) | `loadCard` when the card has not had its deeper look (`card:169-174`) | `check` or `guess` once `deepEnrich` resolves (`card:156-168`) | none (`render:484-488`) | "Taking a closer look at this position…" 15 px with a sweeping meter (`render:487`, `css:290-295`) | none | session bar only |
| `check` | `cardFor` on a first-sight safety or king card whose first punishing reply captures or checks (`card:117-133`) | `done` via `checkStep` when any opponent move is played (`card:238`, `card:260-288`) or **Show me** (`shell:476`) | position after the user's mistake. Last-move highlight on the mistake (`card:130`). No arrow. Selection dots for the opponent's pieces (`render:456`). Eval bar grey (`render:475`) | `.stakes-tag` (13 px, decisive cards only) "This move lost the game"; `h2.task` (27 px Cormorant) "You played Rg1. What can Black do now?"; `.stakes` (14.5 px) "Move Black's piece: find the reply that punishes it." (`render:671-679`) | "You played Rg1. What can Black do now? Move their piece." (11 words, `render:574-575`) | **Show me** (`render:677`) |
| `guess` | `cardFor` (`card:83`); back from `checking` (close, `card:417-434`), from `punish` (`card:501`), from `reply` (`card:316`) | `checking`, `punish`, `reply`, `done` | pre-mistake position. **Red arrow** of the game move while `solIdx === 0` (`render:458`). Hint ring once hints ≥ 2 (`render:459`). Dots for the selected piece (`render:456`). Right-click shapes (`render:457`, `shell:703-709`). Last move = the opponent's previous move (`card:91-97`) | `.stakes-tag`; `h2.task` "You are White. Find a better move." (`render:683-685`); `.stakes` (tier 2/3: "You played Rg1, the red arrow. Your winning chances fell from 48% to 6%.", 14 words; tier 1: words, `render:659-667`); feedback slot (`render:687-695`) | "You are White. Find a better move." plus "Your Rg1, the red arrow, lost the game." only on decisive cards (`render:578-581`); a verdict or hint replaces it (`render:572-577`) | **Hint** and **Show the answer** (`render:700-709`); after a close try **Keep looking** and **Show the best move** (`render:702`); hidden typed-move field (`render:710`) |
| `checking` | `checkMove` for any move that is not the best, not the forcing step and not the game move (`card:356-364`) | `done` (solved), `guess` (close), `punish` (miss), `guess` with "cannot check" after 9000 ms or on an engine error (`card:370-379`, `card:438-446`) | the tried move applied as a ghost, sliding once (`render:449-454`, `card:363`) | "Checking Ra1…" with a meter (`render:689`) | "Checking Ra1…" (`render:557`) | Hint and Show the answer switched off (`render:696-699`) |
| `punish` | `playPunish` from `escalate` after a miss (`card:351`) or a replay of the game move (`card:335`) | `guess` (`card:495-506`); `escalate` goes straight to `reveal` on the 3rd miss (`card:349`) | the tried move and 2 replies replayed one by one, then a snap back (`card:476-510`). **No arrows** | the verdict stays in `.feedback` (16 px, colour `--loss`) | the verdict (`render:573`), colour #e0968c (`css:413`) | switched off |
| `reply` | `stepLine` after a correct move inside a forcing line (`card:290-305`) | `guess` after 650 ms with the opponent's move auto-played (`card:307-318`), or `done` at the line's end | the user's move, then the reply sliding | "✓ Nf3." (`card:304`) | "✓ Nf3. Move 2 of 3: now finish it." (`card:304`) | switched off |
| `done` | `finishCard(result)` (`card:580-634`) from `solved` (`card:511-518`), `reveal` (`card:519-527`) or `checkStep` (`card:287`) | `explore`; the next card (`card:664-673`) | `lineView(a)` (`card:707-714`): a frame of the refute, best, yours or game line. One arrow only, at idx −1: red for refute or game, green for best or yours (`render:442-446`). Eval bar fills (`render:476`) | the result panel (section 4) | headline-style line (`render:558-571`); tapping it replays the best line (`render:562`, `shell:486`) | ‹ › Next or Finish (`render:766-769`) |
| `explore` (sub-state: `a.explore` set in `done`) | the invite (`shell:490`); a touch tap on a piece of the side to move (`card:191-195`); a mouse press on one (`shell:658-668`) | `done` via Back, Esc, ‹ at the start, or Next (`explore:52-66`) | the explored position, one **gold arrow** (`render:419-430`) | trail, sentence, 3 Stockfish rows (`render:773-806`) | the sentence in the prompt line (`render:556`) | ‹ › Next |
| recap | `finishSession` (`session:287-314`) | Today | thumbnails | "N of M solved." etc. (`render:378-411`) | same | Play a game, Practise 5 more, Back to Today |

**Sub-states inside `guess`:**

| Sub-state | What it does | file:line |
|---|---|---|
| `a.verdict` | the feedback line | |
| `a.hints` / `a.hintAfter` | which hint shows, and where | |
| `a.strongerOffer` | after a close try | |
| `a.pendingPromo` | promotion overlay | `render:593-598` |
| `a.menuOpen` | the ••• menu | `render:620-633` |
| `a.sel` | the selected square | |

**Escalation in `guess` (`card:346-352`):**

- Miss 1: punishment replay.
- Miss 2: the first hint is given automatically, and it takes the prompt line once the replay ends (`card:504`).
- Miss 3: `reveal()`.
- The Hint button is off at tier 3 until a miss (`render:705`, `card:533`).

**Results** (`card:515`, `card:526`, `card:287`): `first`, `hint`, `retry`, `fail`. A check card found counts as `first`; missed or Show me counts as `fail`. A missed or retried card is queued for one more try later in the session, but check cards never are (`card:592`).

## 3. Animations, timers and sound

### Piece slides

- **How:** CSS only. `boardSvg` draws the moved piece already at its destination, with a `translate()` back to the origin square (`board:147-153`). `releaseAnims` zeroes it after two animation frames (`render:586-592`). The transition is `.anim-piece{transition:transform .22s ease}` (`css:268`).
- **Only the moving piece slides.** A captured piece just vanishes, and a castling rook jumps.
- **When a move slides:**
  - a tapped move slides once; a dragged move does not (`card:212`, `card:235`);
  - a line step slides only when `idx` goes up by exactly 1 (`render:436-438`).
- **Eval bar:** height transitions over .45 s (`css:253`). It stays grey (`.pending`) until the answer (`render:475`, `css:705-706`).

### Timers in the card flow (all `setTimeout`)

| Where | Delay | What |
|---|---|---|
| `card:165` | 60 ms | phone: smooth scroll to the card (`render:868-874`) |
| `card:307-318` | 650 ms | forcing line: the opponent's reply is played for you |
| `card:370-379` | 9000 ms | engine timeout: "Stockfish cannot check this move right now. Try again, or show the answer." |
| `card:509` | 250 ms | `playPunish`: delay before the first replayed move |
| `card:492` | 500 ms after replayed move 1, 700 ms after each later move | `playPunish` step |
| `card:495-506` | 900 ms after the last replayed move | `playPunish`: snap back to the start position (no slide) and the phase returns to `guess` |
| `card:632` | 900 ms | after a solve: `toPayoff` starts the best line's autoplay |
| `card:631` | 0 | after a reveal or fail: `autoplayLine('refute', …, 0, 3)` runs, then the best line |
| `card:654` | 900 ms (from the start frame) or 400 ms (from a later frame) | `autoplayLine`: delay before the first step |
| `card:649` | 700 ms | `autoplayLine`: each further step |
| `card:650` | 900 ms | `autoplayLine`: before the `then` callback |
| `card:631` | 300 ms | after the refute line, before `toPayoff` |
| `card:530` | 450 ms | double-tap guard: Hint, Show me and Show the answer are ignored in a card's first 450 ms |
| `render:521-524` | 1200 ms | once ever, on touch: notice "Tip: tap a piece whose turn it is to test an idea." Measured at t=1721 ms, while the red line was animating |
| `board:324` | 5000 ms | notices dismiss themselves (8000 ms with an action) |
| `card:672` | 400 ms | Next: `autoScan` |

### Measured timelines (desktop 1280x900; phone within ±250 ms)

`t` is milliseconds from the sampler start; the user's move lands about 100 to 400 ms after `t=0`.

- **Check card, wrong reply** (`desktop-03-check-miss-*`):
  - 542: `done`; the board jumps one ply back to the pre-mistake position with the red arrow; the whole panel appears.
  - 1446: refute move 1 (the user's own mistake replayed).
  - 2161: move 2 (the punishing capture, with check glow).
  - 2881: move 3.
  - 4480: back to the start, green arrow.
  - 5681 / 6402 / 7081: best-line moves 1 to 3.
- **Check card, reply found** (`desktop-04-check-found-*`):
  - 201: `done` plus panel plus green arrow on the pre-mistake position.
  - 2041 / 2722 / 3442: best-line moves.
- **Guess card, wrong try** (`desktop-06-guess-try1-*`):
  - 160: `checking`; the move slides; "Checking Ra1…".
  - 602: verdict text appears, phase `punish`.
  - 882: the tried move slides again.
  - 1361: cxd3+ (the bishop vanishes).
  - 2082: the user's forced reply Kf1.
  - 3681: snap back; the red arrow returns.
- **Guess card, solved** (`desktop-08-solved-*`):
  - 201: `done`; the solving move slides; the panel appears in the same frame.
  - 1521 / 2241: best-line moves.
  - The autoplay stops at the settle point (`card:626`).

**Does text render at the moment pieces start moving?** Yes, in every case:

- **Verdict and replay:** the verdict is set and painted in the same `renderCard` as the switch to `punish` (`card:472-473`, then `card:508`). The first replayed move follows 250 ms later.
- **Result panel and solving move:** the panel is painted in the same frame as the solving move's slide (`card:513-516`).
- **Result panel and missed check:** the panel is painted in the same frame as the board jump (`card:282-287`).

### Reduced motion

- **CSS:** every animation and transition is set to 0.001 s (`css:394-397`), so slides become instant. The pulse on Hint runs only under `no-preference` (`css:110-113`).
- **`autoplayLine`:** with reduced motion nothing plays by itself (`card:645`). Side effect: after a fail, the `then` callback fires at once, so the red-arrow frame is replaced by the green-arrow frame immediately.
- **Not covered:** `playPunish` (`card:476-510`) and the forcing-line reply (`card:307`) still step on their timers. With reduced motion the pieces jump rather than slide.

### Other motion

- `.disc` ✓ scales in over 200 ms (`css:440-443`).
- The checking meter sweeps every 1 s (`css:294-295`).
- Hint pulses twice over 1.8 s after a miss (`css:111`, `render:706`).
- Dots in the session bar fade over 320 ms (`css:483`).

### Sound

Synthesized tones, no files, switchable in Settings (`board:247-271`):

| Tone | Plays when | Where |
|---|---|---|
| `tap` | a piece is selected; first replayed move | `card:203`, `card:490` |
| `move` | each autoplay or replay step | `card:314`, `card:490`, `card:649`, `card:723` |
| `good` | solved or found | `card:275`, `card:297`, `card:517` |
| `bad` | a miss | `card:278`, `card:326`, `card:454` |
| `set` | the session is finished | `session:306` |

Sounds fire in the same tick as the repaint.

## 4. Board annotations: what exists, what it takes to add more

`boardSvg(st, opts)` (`board:114-241`) is a string-built SVG with a viewBox of 360 (45 units per square). It is drawn in this order:

1. **Squares**, colours #f0d9b5 and #b58863 (`board:108`, `board:133-134`).
2. **`opts.mark`** (an array of squares): last-move tint rgba(155,199,0,.41) (`board:135-137`).
3. **`opts.sel`**: selected-square tint rgba(20,85,30,.5) (`board:138-140`).
4. **`opts.check`**: a red radial glow under the king (`board:141-144`).
5. **Pieces:** cburnett `<use href="#pc-wK">` symbols (`board:154-155`, `PIECE_ID` at `board:110`), with `opts.anim` slide setup (`board:148-153`).
6. **`opts.dots`**: legal-target dots (r 5.5), or a ring on capture squares (`board:157-164`).
7. **Coordinates** inside the edge squares (`board:167-176`).
8. **Arrows,** via `arrow(from, to, color, key, cls)` (`board:181-196`): stroke 6 with an 8.4 dark halo; the head is a `<marker>` whose id is `'ah' + key + uid`. The three in use:
   - `opts.ghost`: gold rgba(182,130,53,.85), class `ghost-arrow`, used in explore (`board:198`);
   - `opts.good`: green rgba(61,139,58,.92), class `good-arrow` (`board:200`);
   - `opts.bad`: red rgba(201,80,60,.9), class `bad-arrow` (`board:202`).
9. **`opts.hint`**: a gold ring with a dark halo around the piece to move. It is static: the class `hint-ring` has no CSS rule (`board:205-215`).
10. **`opts.shapes`**: the user's own right-click circles and arrows in lichess green (`board:217-239`, `shell:703-709`).

**How many at once:**

- One arrow per kind (`opts.bad`, `opts.good` and `opts.ghost` are single pairs), so three at most.
- The app chooses one at a time: "never both" (`render:440-446`, `board:199`); `e2e-browser.js:88,99` assert it.
- Squares can take any number of `mark` tints, but there is only one `sel` and one `check`.

**Missing today:** square badges or icons (✓, ✗, !, ?), a captured-piece marker, threat or attack lines, numbered move labels, arrow sequences, any pulse, and a turn indicator.

### What adding each would take

| Addition | How | Things to watch |
|---|---|---|
| **Square badges** (red ✗ or green ✓ on a square) | Add `opts.badges = [{sq, kind}]`. Use the same flip mapping as the hint (`board:206-208`): `col = flip ? 7 - sq % 8 : sq % 8`, `row = flip ? sq >> 3 : 7 - (sq >> 3)`. Draw after the arrows, as a circle of r ≈ 8 at the square's top-right corner (x + 37, y + 8) plus a path or `<text>` glyph, with `pointer-events:none`. In `renderCardBoard`, set it from state: after a miss, the tried move's `to` square; at `done` on the refute line, the capture square of `L.moves[idx]`. | about 25 lines in `board`; about 10 in `render` |
| **Captured-piece marker** | The capture is known before it happens: `L.states[idx-1].b[L.moves[idx].to]` in `done`, and `played.states[i-1]` in `playPunish` (`card:480`). Draw a faded `<use>` of the captured piece (opacity .35) or a small "x piece" chip on the square for one frame. | `boardSvg` takes only the current state, so the captured piece has to be passed in, e.g. `opts.ghostPiece = {sq, p}` |
| **Threat lines** (from the attacker to what it hits) | `arrow()` can already draw any colour. Add `opts.arrows = [{from, to, color}]` with a distinct `key` per index, because marker ids are `'ah' + key + uid` and repeating a key reuses one marker. A dashed or thin variant needs a `stroke-dasharray` parameter. | **Data:** the attacker and target come from the classifier: `a.cls.gameLine.nodes[k].move` and `a.cls.allowed.fork/pin/discoveredAttack` (used by `hintText`, `card:558-574`). |
| **Pulsing ring** | Add a circle with a class and `@keyframes` (scale via `transform-box:fill-box; transform-origin:center`) under `@media (prefers-reduced-motion:no-preference)`. | Because the board is rebuilt on every `renderCard` (`render:467`), the pulse restarts on each repaint: about every 700 ms during autoplay and on each selection tap. Keep it short or iteration-limited. |
| **Turn indicator** | The board knows `st.w`. A coloured edge, a small "White to move" chip in `#ctop`, or moving the eval bar's role would all work without touching `boardSvg`. | The selected side is already in `opts.label` for screen readers (`render:463`). |

**Test pins on board markup:** the classes `.bad-arrow`, `.good-arrow`, `.ghost-arrow`, `#bwrap.static`, `#bwrap svg` and `rect[data-sq]` / `use[data-sq]` are used by the input code (`shell:413`, `shell:619-622`, `shell:691-694`) and by `e2e-browser.js:70,88,93,97,99`.

## 5. The result panel

Built by `panelHtml` done branch (`render:714-770`). Computed styles from the desktop run:

| # | Element | Shown | Desktop size | Phone | Typical words (tier 2; fixture min/median/max) |
|---|---|---|---|---|---|
| 1 | `.ctx` game context "vs opponent1 (1388) · 27 Sept · rapid · move 35 · 20:15 left" (`render:634-645`) | always | 13 px Lora, #8c8880 | visible, moved below the lines | 14 |
| 2 | `.result` box (`render:743`), green tint only for a first-try solve (`css:438`) | always | box at y 119 to 380 | `display:contents`, unboxed (`css:753`) | |
| 2a | `.disc` ✓ circle (`render:719`, `render:728`, `render:732`) | solved (filled) or with help (outline); none on fail | 28 px | hidden | |
| 2b | `h2.result-h` headline (`render:720-734`): "Qe6. Found it." / "Qe6. You got there." / "The answer is Qe6." / "Nf3 works too." / "cxd4. You saw it." / "They had cxd3+." | always | 28 px Cormorant 500 | **hidden** (`css:516`); the prompt line says it instead | 3 to 4 |
| 2c | `.result-sub` (`render:721`, `render:725-726`, `render:730`) | check cards ("The better move was Qe6. You will find it yourself next time.", 12 words); after a close try; after the 3rd miss; alt | 14 px | **hidden** | 12 |
| 2d | `.tline.tl-bad` red line: the game move's sentence `s.game`, long on desktop, short on phone (`render:746`) | always | 15 px | 14 px, first in order (`css:754`) | 3 / 8 / 16 (long); 3 / 7 / 16 (short) |
| 2e | `.tline.tl-alt` "Nf3 also holds. Here is how it goes on." (`render:747`) | an alternative that also works | 15 px | 14 px | 8 |
| 2f | `.tline.tl-good` green line `s.best` (`render:748`) | always | 15 px | **hidden** (`css:516`) | 3 / 4 / 13 |
| 2g | `.tline.tl-opp` what the opponent did (`render:832-841`) | 77 of 91 cards: they found it at once, or missed it and you recovered by 10 points or more | 13.5 px | 14 px, after the invite | 6 / 6 / 14 |
| 3 | `.pchip` pattern name, opens a sheet (`render:753`) | always | 12.5 px | 12.5 px | 3 / 5 / 6 |
| 3b | `.when` schedule "Back tomorrow" / "Back in 7 days" / "Back later in this session" (`render:861-867`) | always | 13 px | 13 px | 2 to 5 |
| 4 | `.habit` (`render:755`, `render:845-855`) | tier 1 every card; tiers 2 and 3 once a week per pattern (`card:605-607`) | 13.5 px | 13.5 px | 10 / 12 / 16 |
| 5 | `.invite` "Why b5? Try another black move and Stockfish answers." (`render:757`, `explore:20-30`) | always (replaced by the explore block while exploring) | 13.5 px | 13.5 px, second in order (`css:755`) | 9 |
| 6 | `.done-acts`: ‹ › nav (20 px, 48x48) and **Next** or **Finish** (15.5 px, `btn-big`) (`render:766-769`) | always | pinned to the panel bottom (`css:433`) | fixed bar, 64 px plus safe area (`css:324-333`, `css:757`) | |

**Totals per answered card** (headline, lines, chip, schedule, habit and invite): 43 / 57 / 69 words at tier 1, and 33 / 44 / 57 at tiers 2 and 3. The fixture's tier 2 and 3 runs saw no habit lines because tier 1 had just used up the once-a-week allowance, so add 10 to 16 words when a habit shows.

**Layout:**

- **Desktop:** the grid has the board column and a 280 to 380 px panel (`css:491-499`). The board is 720 px (`--board`, `css:473`). At 1280x900 everything fits above the fold; Next sits at y 753.
- **Phone:**
  - the board is `min(100vw - 6px, 100svh - 232px)`, 384 px at 390x844 (`css:474`, `css:509`);
  - the `#ctop` sticky bar (`css:503`) holds the 56 px prompt line;
  - below the board, in this order: red line, invite, opponent line, ctx, chip and schedule, habit;
  - then the fixed action bar (`css:324-333`);
  - the document is 844 to 859 px tall, so about 15 px of scroll.
- **Prompt line on the answered card** (`render:558-571`):
  - "✓ Qe6. Found it. It keeps everything safe.";
  - "The answer is Qe6. It keeps your advantage.";
  - "✓ cxd4. That is what your move allowed. Better: d5.";
  - "✗ Black had cxd3+. Better: Qe6.";
  - median 8 words, 80 characters at most.

## 6. The blunder check (`a.check1`) end to end

**Trigger** (`card:114-134`), all of these at once:

- `a.firstSight`: no SRS record yet (`card:86`);
- `!kept`: not resumed after a reload;
- a stored refutation exists;
- the pattern family is `safety` or `king`;
- the refutation's first move, played after the mistake, is a capture (including en passant) or gives check.

The phase starts as `check`. The board state becomes the post-mistake position (`card:129`) with `lastMove` = the mistake (`card:130`).

**How often:**

- **Of all cards:** on the fixture, 28 of 91 trainable cards (31%) qualify, which is 62% of the 45 safety or king cards; the same at every tier. `session.test.js:259` asserts at least 50% of safety and king cards.
- **First session:** 5 of 5 (browser) or 4 of 5 (Node), for the ease-sorting reason in section 0.
- **Normal sessions:** about 4 of 10 cards are new (`session:137`), so expect 1 or 2 check cards per session. Tier 1 gets more, because ease-3 cards get a 1.8x boost (`session:85`).
- **Never:** on reviews, or on the in-session retry.

**What is on screen:**

- **Board:** the post-mistake position in the user's own orientation; the mistake highlighted; no arrow; no turn cue; eval bar grey.
- **Desktop panel:** 17 to 24 words: stakes tag, h2 27 px, stakes 14.5 px.
- **Phone:** the single prompt line (11 words, 15 px), and **Show me** in the bottom bar.
- See `desktop-01-check-start.png` and `phone-01-check-start.png`.

**Taps on the user's own pieces:**

- **Pointer path:** `pointerdown` does not select them (`shell:673-683`: only `isW(p) === st.w`).
- **Click path:** `sessionClick` falls through `card:201` and returns at `card:207` when nothing is selected. Result: **no feedback of any kind.**
- **If an opponent piece is selected first,** tapping an own piece tries a capture there:
  - if the capture is legal, it is graded (and counts as found when it lands on the reply's square, `card:262`);
  - if not, the selection clears silently (`card:209`).
- **Dragging an own piece:** nothing happens (no ghost, `shell:674`).
- **By contrast,** the answered board does answer a wrong-side tap, with "It is White's move here. Move a white piece." (`card:195`); so does exploring (`explore:120`).

**Grading** (`checkStep`, `card:260-288`):

- No engine. It counts as found if the move is the stored reply, or any capture on the same square when the reply captures (`card:262`).
- The session and day tallies are updated for the recap line "Today you spotted their reply on N of M." (`render:404`, `card:265-271`).
- Verdict strings: "✓ cxd4. That is what your move allowed." or "✗ Black had cxd3+." (`card:274-277`).
- Then: the state resets to the pre-mistake position (`card:282-284`), and `finishCard('first' or 'fail')`.

**How it ends:**

- **One question per showing.** Found = `first`, the full first-try SRS credit.
- **Missed or Show me** = `fail`, never queued for an in-session retry (`card:592`).
- **After a miss:** the view is the refute line, autoplayed, then the best line (`card:610`, `card:631`).
- **After a find:** the view is the best line at idx −1 with the green arrow, autoplayed after 1.8 s (`card:611`, `card:632`).
- **The "find a better move" question is not asked until the card comes back:** "You will find it yourself next time." (`render:721`).

## 7. Tests that pin this behaviour

What a redesign will break, by file:

**`test/session.test.js`** (the real built page in Node):

- `:259`: check eligibility (only safety or king families; only capture or check replies; at least 50% of safety and king cards qualify).
- `:276`: the check is one question, with no engine job:
  - found gives `result` `first` and phase `done`;
  - **an own-piece tap leaves the phase `check`** (an added notice is fine, a grade is not);
  - a wrong move gives `fail`;
  - reviews have no check;
  - `ss.checks` and `ss.checksFound` are counted.
- `:331`: **every phone-line message is 80 characters or fewer at every tier.** It parses `cardTaskHtml` with the regex `/<div class="card-task[^"]*"[^>]*>([\s\S]*?)<\/div>/`, so the markup of `.card-task` must keep that shape or the test must change. It covers the check prompt, the prompt, hints 1 and 2, "game move again", the answered (shown) and answered (found) lines.
- `:248`: an engine failure gives no miss and a verdict matching `/cannot check/i`.
- `:300`: the game-move verdict never names the answer.
- `:316`: hints never name the answer on missed-chance cards.
- `:226`: the recap captions a card left after a hint as Skipped.
- The `OPEN` helper (`:19-26`) relies on `cardFor`, `a.check1`, `a.phase`, `a.st`, `a.pre`, `a.lastMove` and `a.preLast`.

**`test/explore.test.js`:**

- `:64`: nothing is explored before the answer.
- `:71`: the invite matches `^Why \S+\? Try another (white|black) move and Stockfish answers\.$` (or the fallback), is 80 characters or fewer, and is unchanged after the autoplay timers run.
- `:81`: exploring starts from the frame on screen.
- `:89`: the invite starts exploring at the best line's idx 0.
- `:97`: the say line matches `Stockfish's pick is .+, the gold arrow\. › plays it\.$`.
- `:174`: Next stops exploring.
- `ANSWERED` (`:55-60`) uses `reveal()`.

**`test/e2e-browser.js`** (run by hand in a real tab):

- `:53`: `/What can (White|Black) do now/` in `#cpanel`.
- `:56`: `/You saw it/`.
- `:57`: `/better move was/i`.
- `:69`: `.sb-end` and `.dots`.
- `:70`: `/to move|better move/i` in `#main`, plus `.ctx`.
- `:80`: `.tline.tl-bad` and `.tline.tl-good` both carry text.
- `:84`: **the answer line moves forward by itself within 3.2 s.**
- `:87`: clicking `.tline.tl-bad` switches to the refute line.
- `:88`: a lone `.bad-arrow` at the start of the refute line.
- `:92`: the invite text regex.
- `:93`: `#bwrap.static` before exploring.
- `:99`: at most one arrow while exploring.
- `:125`: `[data-act=checkShow]` gives `fail`.
- `:132-133`: `/game move again/i` and `.verdict`.
- `:150`: `.hint-note` after the 2nd miss.
- `:160`: `/answer is/i`.
- `:169-171`: `[data-act=menu]` and `[data-act=skip]`.
- `:180`: `/paused/i` in `#overlay`.
- `:188-191`: `[data-act=reveal]` and `[data-act=next]`.
- `:196-197`: `.recap-item` and `.recap-acts .btn-big`.
- `:227-233`: `#kbmove` takes a typed SAN move.
- Scripted clicks wait 500 ms for the 450 ms double-tap guard (`:122`).

**`test/run.js`:**

- `:46-54`: `sentences.short` is 84 characters or fewer, with no em dash.
- `:55-60`: the explanation snapshot `test/explanations.txt` is current (any classifier wording change needs `npm run explain` plus a `CLASSIFY_V` bump).

**`test/srs.test.js`:** scheduling by result (`first`, `hint`, `retry`, `fail`, `skip`, game move, alt). Changing what a check card reports changes its schedule.

**`npm run lint`** (undefined names fail) and **`build.py`** (refuses any em dash, `build.py:26-28`).

## 8. Copy over 15 words shown during the flow

Word counts are on the rendered text; examples come from the fixture.

| Words | Text | Source | When |
|---|---|---|---|
| 19 | "Drag a piece, or tap it and tap a square. The bar on the left fills in once you answer." | `render:692` | first card of a session, before any move ever; desktop only (hidden on phone, `css:512`); never on a check card |
| 17 to 24 (combined) | stakes tag + "You played Rg1. What can Black do now?" + "Move Black's piece: find the reply that punishes it." | `render:648-649`, `render:674-675` | check step, desktop |
| 16 to 20 (77 of 91 cards over 15) | hint 2: hint text + " The piece to move is circled.", e.g. "Your move allowed Rg5, then Rxf5. Find a move that stops it. The piece to move is circled." | `render:694`, `card:539-579` | after the 2nd hint (desktop panel) |
| up to 18 | hint 1, e.g. "Your move allowed c4, then fxg6. Find a move that stops it." (median 10) | `card:574-578` | Hint, or after the 2nd miss |
| up to 18 | red line, long form, e.g. "Nb6 loses a queen and a pawn for a knight and a bishop after Nxd6+ Qxd6 Qxd6 Nxc4." (4 of 246 sample sentences over 15; fixture max 16) | `render:746`, classifier `s.game` | answered, desktop |
| 15 | "Rg1 ignores Black's threat: cxd3+ takes your bishop. You lose a queen and a bishop." | same | answered, desktop (measured) |
| 15 | "Kc7 lets your winning position slip: after Rd2+ it is roughly level (83% to 46%)." | same | answered, desktop, tiers 2 and 3 |
| 15 to 16 | the phone prompt on decisive cards: "You are White. Find a better move. Your Rg1, the red arrow, lost the game." | `render:580` | guess, phone |
| 14 | the stakes line: "You played Rg1, the red arrow. Your winning chances fell from 48% to 6%." | `render:666` | guess, desktop |
| 14 | the opponent line: "Your opponent missed it. They played Rad8 and you were back in the game." | `render:838` | answered |
| up to 16 | habits, e.g. "In the opening: develop a new piece each move, castle, and don't move a piece twice." and "The pawns in front of your castled king do not move without a concrete reason." | `src/js/05-core-classify.js:37,41`, `render:847-853` | answered (tier 1 always) |
| 15 | "On a deeper look that position was not a real mistake, so it was removed." | `card:150` | notice |
| 15 | "Your paused session is closed. Its answers are kept and its tries count toward today." | `session:185` | notice when starting a session |
| 15 | "This is one of your own positions. Stockfish stays quiet so it can test you." | `explore:417` | explore |
| about 13 + habit | recap: family habit + " Today you spotted their reply on 2 of 4." | `render:403-404` | recap after any check card |
| 13 to 14 | "Stockfish cannot check this move right now. Try again, or show the answer." and "Stockfish is not answering right now. Try again, or go back to the lesson." | `card:376`, `card:444`; `explore:418` | engine trouble |
| 12 | "The better move was Qe6. You will find it yourself next time." | `render:721` | answered check card, desktop |

Every answered card, all on screen at once (see section 5): 33 to 69 words.

## 9. Screenshot index (`shots-codemap/`)

Each step was captured at desktop 1280x900 (`desktop-*`) and phone 390x844 at DPR 2 (`phone-*`). The number in the file name is milliseconds after the move.

| Step | Files |
|---|---|
| Today | `00-today` |
| Check step | `01-check-start`, `02-check-after-own-taps` (identical to 01: no feedback) |
| Check, wrong reply | `03-check-miss-0150` … `7500ms` |
| Check, reply found | `04-check-found-0150` … `5000ms` |
| Recap after 5 check cards | `04b-recap` |
| Guess card | `05-guess-start` |
| Wrong try (checking, verdict, replay, snap back) | `06-guess-try1-0100` … `4500ms` |
| Hint 1 | `07-guess-hint1` |
| Solve and autoplay | `08-solved-0100` … `7000ms` |
| Settled answer | `09-done-settled`, plus `phone-10-done-scrolled` |
