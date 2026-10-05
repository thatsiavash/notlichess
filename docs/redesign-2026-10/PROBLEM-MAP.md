# Problem map: game-review cards (2026-10-03)

**What this is.** It links the founder's five complaints to their root causes in the live build. It also ranks what else is broken, picks the research patterns that fix each problem, and lists what a redesign must not break. It feeds the redesign; nothing here is a design yet.

**Sources** (all in this folder):
- `walk-desktop.md`: 1600 blitz persona, 1280x900, 10 cards.
- `walk-phone.md`: the founder-like 1800 persona, 390x844, 9 cards.
- `walk-beginner.md`: 700 persona, 390x844, 11 showings.
- `code-map.md`: live build at commit 34439f2, with file:line references.
- `research-r-principles.md`, `research-r-trainers.md`, `research-r-lichess-chesscom.md`.

Screenshot paths are relative to this folder. File shorthand follows the code map:

| Short name | File |
|---|---|
| `card` | `src/js/13-card.js` |
| `render` | `src/js/14-render.js` |
| `shell` | `src/js/15-shell.js` |
| `board` | `src/js/02-legacy-2.js` |
| `session` | `src/js/12-session.js` |
| `explore` | `src/js/13x-explore.js` |
| `css` | `src/app.css` |

**Severity scale (for a first-time user):**
- **Critical:** hits most first-session cards and makes the product look broken or misleading. Likely exit.
- **High:** hurts understanding or trust on many cards.
- **Medium:** noticeable friction on some cards.
- **Low:** polish.

---

## The short version

- **All five bullets showed up in all three walks.** None is a matter of taste. Each one has a cause in the code.
- **Biggest cause: the first session is almost all "move their piece" cards, and your own pieces do nothing when touched.** For the beginner, 5 of 5 first-session cards were this type; on desktop, 6 of 8 first-time cards. The ordering in `session:63-66` plus `session:146` causes it.
- **Second cause: every answer changes everything at once, then the app plays moves by itself.** The board, the text and the buttons all repaint in one call (`render:506-516`). Then the app plays 3 to 8 moves on its own, one every 700 ms (`card:631-654`). Text never waits for motion, and motion never waits for the user.
- **Third cause: the board has almost no way to mark anything.**
  - It draws one arrow at a time, on the first frame only.
  - There are no ✓/✗ marks on squares, no threat lines and no mark on captured pieces (`board:114-241`, `render:440-446`).
  - So the "why" lives in 33 to 70 words of text. On phone, the line explaining why the better move works is hidden (`css:516`).
- **Several replays contradict the text.** Causes: the 3-move cap (`card:631`), punishment replays that end on your own good move, and a false "You are in check" hint (`card:542-543`). A new user reads this as "the app is wrong", not "this is hard".
- **The research agrees on the fix:**
  - Show right/wrong on the square first.
  - Change one thing at a time.
  - Let the user step through lines.
  - Draw the threat instead of quizzing it.
  - Show 15 words or fewer before any tap.

---

## 1. The founder's five bullets

### Bullet 1. "When pieces move around it's super hard to tell what you're trying to show me... a new block of text and fast moving animation of the pieces all at once."

**Verdict:** confirmed in all three walks. **Severity: Critical.** It hits the first answer of the first session, and every session after.

| # | Root cause | Evidence |
|---|---|---|
| 1.1 | **The board, the text and the buttons repaint in one call.** `renderCard` writes `#ctop`, the board and `#cpanel` back to back (`render:506`, `render:509`, `render:516`). So every result arrives as one frame with many changes. | Beginner card 1: 5 changes within 173 ms (board jumps back a move, red arrow, new top line, 65-word panel, new buttons), `shots-beginner/04-answer-moment-170ms-five-changes.png`. Phone card 1: 6 changes in one frame at 1881 ms, `shots-phone/03-check-correct-board-rewinds.png`. Desktop card 1: 4 changes in the frame where the piece is dropped, plus a 70-word panel, `shots-desktop/04-c1-correct-board-jumps-back-move-erased.png`. |
| 1.2 | **Lines play by themselves, one move every 700 ms, without being asked.** After a solve, the best line starts at 900 ms (`card:632`, `card:654`) and steps every 700 ms (`card:649`). After a miss or a reveal, the refutation plays, then the best line (`card:631`). For comparison, lichess's fastest autoplay speed is 1000 ms per move. | Phone card 3: 9 board changes in 6.6 s under one sentence that never changed, `shots-phone/07-check-wrong-sequence-sheet.png`, `shots-phone/08-check-wrong-result.png`. Desktop card 4: about 11 board and panel events in 6.5 s, `shots-desktop/13-c4-wrong-check-result-no-x.png` then `shots-desktop/14-c4-after-6s-double-autoplay.png`. Beginner card 2: 8 moves autoplay from 1870 to 6792 ms, `shots-beginner/09-eight-move-green-autoplay-end.png`. |
| 1.3 | **The wrong-try replay shows the same lesson three ways at once.** `playPunish` (`card:476-510`): (1) shows the verdict in the same frame it starts (`card:472-473`, `card:508`); (2) plays the tried move a second time 250 ms later (`card:509`); (3) plays 2 replies; (4) jumps back without animation 900 ms after the last move (`card:495-506`). | Code-map timeline: verdict at 602 ms, tried move slides again at 882, capture at 1361, your forced reply at 2082, jump back at 3681 (`shots-codemap/desktop-06-guess-try1-*.png`). Phone card 4: while the sentence arrives, the knight goes to e5, back to d3, then to e5 again in about 0.4 s, `shots-phone/11-wrong-try-punish-sheet.png`. A 12-word verdict takes about 3.0 s to read (238 words per minute), inside a 3.05 s animation (`research-r-principles.md` §2). |
| 1.4 | **The text is gone before the board stops.** On a second miss, the automatic hint replaces the verdict the moment the board resets (`card:504`). So the verdict is never readable next to a still board. | `walk-phone.md` cards 4 and 9. |
| 1.5 | **Text changes while pieces move, and the new text is wrong.** `hintText` says "You are in check..." when any king is in check (`card:542-543`). That includes the opponent's king after your own checking move. | Desktop: the false hint showed 2 of 2 times inside forcing lines, and in 2 of 2 replays that gave check. Mid-replay, the hint flipped at 1.76 s and flipped back at 3.23 s: 3 text changes in one replay, `shots-desktop/10-c2-false-you-are-in-check-hint.png`. |
| 1.6 | **A pop-up tip lands in the middle of the animation.** On touch screens, a one-time tip ("Tip: tap a piece whose turn it is to test an idea.") fires at 1200 ms (`render:521-524`). | Beginner: at 1366 ms, covering the panel for about 3 s, `shots-beginner/05-toast-lands-mid-animation.png`. Phone: at +1.2 s, over the habit line, `shots-phone/04-check-correct-autoplay-plus-toast.png`. |
| 1.7 | **Nothing says which line or which move is playing.** The prompt and the panel stay the same while 3 to 8 moves play. Only the moving piece slides; captured pieces just vanish (`board:147-153`, `css:268`). | `walk-desktop.md` card 1: "Three moves in 1.2 s, with no text saying what this line is". `walk-beginner.md` card 1: "The panel text never changes while 7 moves play". |
| 1.8 | **The reduced-motion setting is only half honoured.** `autoplayLine` stops under reduced motion (`card:645`), but the wrong-try replay and the forcing-line reply do not (`card:476-510`, `card:307`). Under reduced motion their pieces jump instead of slide. | `code-map.md` §3, "Reduced motion". |

**Why it matters:** the user is still asking "was I right?" (the founder's "hmm I hope that's right"). Then the board jumps to a different position and new words arrive. The research has names for this: split attention and change blindness. Its rule is one change at a time, with text only after the piece lands (`research-r-principles.md` P2, P4).

### Bullet 2. "It's hard to know what's expected of a user... my instinct as a user is to just solve a puzzle in front of me and when I click my pieces they don't do anything."

**Verdict:** confirmed in all three walks, and exactly as described. It was the worst issue in each walk. **Severity: Critical.** It is what every new user meets on day one.

| # | Root cause | Evidence |
|---|---|---|
| 2.1 | **The "blunder check" card asks you to play the opponent's move.** It appears the first time you see a mistake that left a piece unsafe or exposed your king, when the punishing reply is a capture or a check. The user must then play the other side's reply (`card:114-134`). 28 of the 91 test-set cards (31%) qualify, which is 62% of the piece-safety and king-safety cards (`code-map.md` §6). | All three walks. |
| 2.2 | **The first session is almost all this card type.** `cardEaseOf` marks exactly these cards as "easiest" (ease 3, `session:63-66`). The first-time plan then sorts by ease, easiest first (`session:146`). | Beginner: 5 of 5 first-session cards, 8 of 11 overall. Desktop: 6 of 8 first-time cards. Phone: 3 of the first 5. Code-map browser run: 5 of 5. |
| 2.3 | **Tapping or dragging your own piece does nothing at all.** A tap only selects pieces of the side to move (`card:200-205`) and otherwise exits silently (`card:207`). A drag only lifts pieces of the side to move (`shell:673-683`). | Zero page changes over 5 own-piece taps (`walk-beginner.md` card 1). `shots-codemap/desktop-02-check-after-own-taps.png` is identical to `desktop-01`. Also `shots-desktop/02-c1-own-piece-drag-does-nothing.png`, `shots-phone/02-check-own-piece-tap-does-nothing.png`, `shots-beginner/02-own-piece-tap-does-nothing.png`. Desktop: no response on 6 of 6 own-piece tries across 4 cards. |
| 2.4 | **The second tap makes it worse.** After a dead tap on your own piece, you tap the square you wanted to capture. That selects the opponent's piece there and offers to capture your own piece. | `shots-phone/06-check-own-queen-tap-selects-their-queen.png` (capture ring on your own queen). `shots-beginner/03-tap-target-selects-opponent-rook.png`. |
| 2.5 | **The board gives no sign that it is the other side's turn.** The board stays from your side, so the pieces to move sit at the far edge. There is no turn marker and no arrow (the red arrow is only drawn on "find a better move" cards, `render:458`). The only mark is the tint on your own last move (`card:130`). | `shots-codemap/phone-01-check-start.png`, `shots-phone/01-check-card-open.png`, `shots-beginner/01-check-task-card1.png`. |
| 2.6 | **The instructions are upside down, and on phone the clear one is hidden.** On desktop the big 27 px line is a question ("You played b4. What can White do now?"). The actual instruction is a small 14.5 px grey line under it (`render:671-679`). On phone that panel text is only read by screen readers (`css:512`). What is left is one 15 px line ending "Move their piece.", and "their" is ambiguous. | `shots-desktop/01-c1-blunder-check-task.png`. `walk-beginner.md` #1. |
| 2.7 | **The "how to move" tip never shows where it is needed.** On a check card, the panel code exits before reaching the tip (`render:671-679` vs `render:691-692`). On phone the tip is hidden anyway (`css:512`). | `walk-desktop.md` #1: the first card was a check card, so the tip never appeared. |
| 2.8 | **One confused tap ends the card.** A check card takes one answer. A wrong answer or "Show me" is graded as a fail (`card:260-288`) and is never brought back later in the session (`card:592`). Nothing warns that "Show me" counts as a fail. | `walk-beginner.md` card 3, `walk-desktop.md` card 5, `walk-phone.md` card 5. |
| 2.9 | **The puzzle instinct is refused, then praised.** Afterwards, the result names the move the board would not let you play as "the better move" (`render:721`). | Desktop practice card 1: Nxf6 was refused silently, then the result said "The better move was Nxf6. You will find it yourself next time." (`shots-desktop/17-p1-check-their-queen-hangs.png`, `shots-desktop/18-p1-better-move-is-the-one-refused.png`). Phone card 1: tapping the queen to play Qc7, which was the better move, did nothing. |
| 2.10 | **Hint is greyed out at first, with no reason given.** For players at the strongest level (tier 3), Hint is off until the first miss (`render:705`, `card:533`), and tapping it does nothing. | `walk-phone.md` card 7. |

**Why it matters:** every puzzle app the user has used teaches one rule: your pieces are at the bottom, and you move them. Neither lichess nor chess.com ever asks you to move the opponent's pieces (`research-r-lichess-chesscom.md` §0, point 2). Breaking that rule on card 1, with no feedback, reads as "broken". The beginner walk's estimate: by card 3, a real 700 player decides the board is broken.

### Bullet 3. "I was hoping for better lines drawn of what my mistake was... I don't feel as guided as I could be in understanding on the board itself what went wrong."

**Verdict:** confirmed. **Severity: High.** The board is where the teaching should happen. Without it, users think the answers are random.

| # | Root cause | Evidence |
|---|---|---|
| 3.1 | **The board can only draw three kinds of arrow, and the app shows one at a time on purpose.** The board code supports one red, one green and one gold arrow (`board:181-202`). The app never shows two together (`render:440-446`). Missing entirely: marks on squares, a mark for captured pieces, threat lines, move labels and a turn marker (`code-map.md` §4). Two browser tests require the one-arrow rule (`e2e-browser.js:88` and `:99`). | `code-map.md` §4. |
| 3.2 | **The threat is never drawn.** There is no arrow from the punishing piece to what it wins, before or after the answer. On check cards there is no arrow at all before you answer. | Beginner cards 3, 4 and 5: the attacking lines (a7 to g1, g2 to a8, d6 to g3) were never drawn, `shots-beginner/10-red-line-stops-black-wins-knight.png`. Desktop card 1: axb6 taking the pawn is never shown as an arrow. |
| 3.3 | **Arrows only appear on the first frame, then vanish.** The green arrow shows for 0.9 to 1.5 s before the autoplay replaces it (`card:654`). During the wrong-try replay the red arrow disappears (`render:458` only draws it while you are solving). | `walk-desktop.md` #8. `shots-codemap/desktop-06-guess-try1-1500ms.png`. |
| 3.4 | **The mistake arrow is often too short to see.** A one-square move draws a one-square arrow, mostly hidden under the piece. | `shots-desktop/07-c2-standard-task-short-red-arrow.png` (c2 to c3). `shots-phone/09-normal-card-open.png`. `walk-beginner.md` card 8: the green arrow h2 to g2 is hidden under the king. |
| 3.5 | **Replays stop before the point, or show the wrong picture.** The automatic refutation stops after 3 moves (`card:631`), often before the material is actually lost. Wrong-try replays end on your own next move. | Beginner card 3: the text says "You lose a rook and a pawn for a knight", but the replay ends with Black winning a knight (`shots-beginner/10-red-line-stops-black-wins-knight.png`). Card 6: it stops one move before the queen falls (`shots-beginner/12-red-line-stops-before-queen-loss.png`). Card 4: it ends on White's recapture (`shots-beginner/11-red-line-ends-on-recapture.png`). Desktop: the replay ends on your own check while the text says "you are losing" (`shots-desktop/11-c3-punish-replay-ends-on-my-own-check.png`). Phone card 9: the text says "Kh6 lets your bishop get trapped" while the replay shows the bishop escaping. |
| 3.6 | **Your own answer is never drawn.** After any check-card answer, the board resets to the position before your mistake (`card:282`). The capture you found, even a checkmate, never appears. | `shots-desktop/19-p2-mate-found-never-shown.png` (the mate Qg2# is never shown), `shots-beginner/08-correct-capture-never-drawn.png`, `shots-phone/03-check-correct-board-rewinds.png`. |
| 3.7 | **The "better" line sometimes contains the same blow, so nothing visibly changes.** | Beginner card 6: the better line Qg5 Nxd3+ Kf1 has the same knight check as the mistake line (`shots-beginner/13-better-line-has-same-check.png`). |
| 3.8 | **Hint 1 is text only.** The gold ring from Hint 2 is the only guidance drawn on the board in the whole flow. On phone, its note "The piece to move is circled" is hidden (`css:512`). | `shots-beginner/15-hint2-gold-ring.png`, `shots-phone/16-second-hint-ring.png`. All three walks named the ring as the clearest moment. |
| 3.9 | **After a correct answer, the mistake is not drawn unless you click the red row.** Clicking it replays 4 moves with no marks. | `shots-desktop/05-c1-red-line-start.png`, `shots-desktop/06-c1-red-line-end-no-labels.png`. |

**Why it matters:** the founder asked for "lines drawn", and the research is unusually consistent on this. Marks on the picture make people remember more (effect size g = 0.53 in Schneider et al. 2018, a summary of 103 studies). The picture should carry the why, and the text should only name what the picture shows. See Into the Breach, and lichess Learn's red threat arrow next to a green escape arrow.

### Bullet 4. "The big block of text comes under the board after I do a puzzle and unless I take a minute to try to understand it, I don't even know if I got it right or wrong or what mistake I made."

**Verdict:**
- **Phone: confirmed.** The panel sits under the board there (`code-map.md` §5).
- **Desktop: partly.** The panel is beside the board. Right answers are clear in about 1 s; wrong ones are not.

**Severity:** Critical on phone, High on desktop.

| # | Root cause | Evidence |
|---|---|---|
| 4.1 | **There is no right/wrong mark on the board at all.** The board code has no layer for marks on squares (`code-map.md` §4). The only signal is a ✓ or ✗ character in the text. | All walks: "Board-level right/wrong signal: none". |
| 4.2 | **On desktop, wrong and revealed results carry no "wrong" signal.** The result box gets a green tint and a ✓ only on a first-try solve (`css:438`, `render:719`). A wrong check answer just reads "They had Rxb7.", and a reveal reads "The answer is Qxg5+.", with no ✗ and no red. | `shots-desktop/13-c4-wrong-check-result-no-x.png`, `shots-desktop/15-c7-reveal-midline-answer-already-played.png`. The persona needed 3 to 5 s of reading to know they were wrong. |
| 4.3 | **On phone, a success looks like any other sentence.** The success colour is overridden back to the normal off-white text colour, rgb(222,219,210) (`css:419` overrides `css:414`). The result headline and the ✓ circle are hidden (`css:516`). | `shots-codemap/phone-09-done-settled.png`. `walk-phone.md` #5. |
| 4.4 | **Too many words, all of the same weight.** 33 to 69 words per answered card (`code-map.md` §5), in 6 items of similar size: the mistake line, the explore invite, what the opponent did, the game details, the pattern tag with the review date, and the habit tip. Measured on screen: 46 to 70 words on desktop, 54 to 67 on phone. The research ceiling is 15 words before any tap. | `shots-beginner/04-answer-moment-170ms-five-changes.png`, `shots-phone/05-check-correct-sequence-sheet.png`. |
| 4.5 | **On phone, "why the better move is better" is hidden, and its space goes to an invite about a move not yet played.** The green explanation line is screen-reader-only (`css:516`). The short version of the red sentence can cut the threat itself ("Rxd3 ignores Black's threat."). The explore invite names a move from the middle of an autoplay that has not happened yet (`explore:20-30`): "Why Bf5?" shows at 170 ms, but Bf5 only plays at 6 s. | `walk-beginner.md` #5 and card 4. `walk-phone.md` #6. `shots-phone/18-check-correct-better-g4-sheet.png` ("Better: g4." with no reason). |
| 4.6 | **On check cards, the board rewinds right after a correct answer.** It reads as "that didn't work" (`card:282`). | `shots-phone/03-check-correct-board-rewinds.png`. |
| 4.7 | **The text and the board disagree after the answer.** | Phone: "The answer is Nxc1" stays on screen while the board plays Rxd6, exd6, Ne5 for 4 s (`shots-phone/14-reveal-plays-game-line-first-sheet.png`). Phone: the red line plays Black taking White's queen under "✓ Qxc5... It wins the queen." (`shots-phone/15-red-line-replay-text-mismatch.png`). Desktop: after a reveal in the middle of a line, the headline names a move the user had already played, and both of their correct moves are wiped from the board (`shots-desktop/15-c7-reveal-midline-answer-already-played.png`). |
| 4.8 | **Some sentences are thin or wrong, so reading does not pay off.** | "Rd1 keeps the game balanced." (`shots-desktop/13-c4-wrong-check-result-no-x.png`). "Qxh3 wins the pawn." when the point was stopping the mate Qg2# (`shots-desktop/19-p2-mate-found-never-shown.png`). "Pin" for what is actually a fork (`shots-beginner/12-red-line-stops-before-queen-loss.png`). "About level" for a stalemate (`shots-beginner/17-stalemate-called-about-level.png`). |

**Why it matters:** in the founder's words, "when I can't get the info I need without reading, it's not fun". lichess and chess.com both show right/wrong on the square within 40 to 120 ms, with zero words. The words beside the board come after the board has already told you (`research-r-lichess-chesscom.md` §0, point 1).

### Bullet 5. "Overall this product needs to be intuitive. Right now the learning curve is way too high."

**Verdict:** confirmed. It is the sum of bullets 1 to 4 plus the items below. **Severity: Critical.**

| # | Root cause | Evidence |
|---|---|---|
| 5.1 | **Four ways to interact, told apart only by a sentence.** Find your better move; move their piece; finish a forcing line; explore. None of them has an introduction. | `walk-phone.md` bullet 5, `walk-desktop.md` bullet 5. |
| 5.2 | **Day one starts with the most unusual card type (see 2.2).** That goes against the product's own "warm-up first" rule: start with an early, easy win (`learning-design.md`). | `session:63-66`, `session:146`. |
| 5.3 | **The forcing-line card is alarming without explanation.** It says "Move 1 of 4: now finish it.", then the opponent takes your queen 0.75 s later (`card:307-318`). Elsewhere it says "now finish it" after the material is already won. | `shots-desktop/09-c2-queen-taken-now-finish-it.png` ("I just lost my queen and it says finish it?"). `shots-phone/12-forcing-line-finish-it.png`. |
| 5.4 | **Engine words a new player cannot use.** "About level", "you are worse", "something stronger", "forced mate", "passed pawn", "discovered attack". | `walk-beginner.md` #8. |
| 5.5 | **The rules change between card types without notice.** Check cards allow one try; "find a better move" cards allow three. A move can get a ✗ next to "does not lose anything". | `shots-desktop/12-c3-kg7-red-x-does-not-lose-anything.png`. |
| 5.6 | **Key guidance is invisible on phone.** Hidden: the first-run tip, the "piece is circled" note and the stakes line (`css:512`). The repeat card has no label: "didn't I just do this? Is it stuck?" (`walk-phone.md` card 6, `shots-phone/13-relearn-card-no-label.png`). The green line can only be reached by tapping the top sentence, which does not look tappable (`render:562`, `shell:486`). | `walk-phone.md` #8. |
| 5.7 | **The moments that felt good were the plain ones:** a "find a better move" card solved first try, with a result that fits in one line. | `walk-desktop.md` card 6: "the best moment of the run". `walk-phone.md` card 2: "the best card of the session". `walk-beginner.md` card 7: mate glow, nothing autoplayed (`shots-beginner/16-mate-found-calm.png`). |

**Takeaway:** the product already has a calm, intuitive mode (5.7). The redesign mostly has to make every card behave like that.

---

## 2. Problems the founder did not name, ranked

Ranked by harm to a first-time user: how often it happens times how badly it misleads.

| Rank | Problem | Evidence | Severity |
|---|---|---|---|
| U1 | **A wrong-try replay can play the answer.** The replay shows [your move, their reply, your best next move], and your best next move can be the solution itself (`card:476-510`). That breaks the "never show the answer before the user tries" rule. Tests guard that rule for text (`session.test.js:300`, `:316`), but nothing guards it on the board. | `walk-phone.md` card 4: the replay after a wrong Rxd6 played Ne2+, which was the solution. | High |
| U2 | **The board contradicts the text, so the app looks wrong, not just hard.** Causes: the 3-move cap (`card:631`), replays ending on your own good move, verdicts the replay disproves, and a rook loss named from deep in a line when the board shows a bishop lost. | `shots-beginner/10-red-line-stops-black-wins-knight.png`, `shots-beginner/11-red-line-ends-on-recapture.png`, `shots-beginner/12-red-line-stops-before-queen-loss.png`, `shots-desktop/11-c3-punish-replay-ends-on-my-own-check.png`, `shots-phone/18-check-correct-better-g4-sheet.png`, `walk-phone.md` card 9. | High |
| U3 | **False "You are in check" hint.** `card:542-543` checks whether any king is in check, not whether yours is. It is a plain bug, and it shows on every forcing line that gives check. | `shots-desktop/10-c2-false-you-are-in-check-hint.png`. | High |
| U4 | **Tactic names that do not match the board.** "Walked into a pin" for a knight fork. "About level" for a stalemate. "Takes your pawn" on a card tagged "This move lost the game". A habit tip to "trade pieces" with nothing left to trade. | `shots-beginner/12-red-line-stops-before-queen-loss.png`, `shots-beginner/17-stalemate-called-about-level.png`, `walk-beginner.md` #8 and card 8. | High |
| U5 | **Explore starts from the wrong position and talks about the wrong side.** It opens at the end of the autoplayed line, not at the card's position. It lists the opponent's best moves. It invites a Black player to "Try another white move", and offers to test ideas after checkmate. A test requires explore to start from whatever frame is on screen (`explore.test.js:81`), which causes this. | `shots-desktop/20-p1-explore-starts-at-line-end.png`, `shots-beginner/18-explore-black-best-moves.png`, `shots-phone/17-explore-mode.png`. | Medium |
| U6 | **Grading that feels unfair.** A red ✗ next to "does not lose anything". "Show me" quietly fails the card. The end-of-session summary labels every wrong answer "Shown" (`render:389`), even when the user never pressed a reveal button. | `shots-desktop/12-c3-kg7-red-x-does-not-lose-anything.png`, `shots-desktop/16-recap-3-of-5-after-7-cards.png`, `shots-beginner/19-recap-2-of-5.png`. | Medium |
| U7 | **Counts and promises that do not add up.** The progress bar grows from 5 to 6 to 7 segments mid-session with no explanation, then the summary says "3 of 5 solved." The Today screen promised "First, the move that lost the game vs ansh175" (`render:233`), but the session skips that card when it is not rated easy enough (ease below 2, `session:149-152`). | `walk-desktop.md` #10, `shots-desktop/16-recap-3-of-5-after-7-cards.png`. | Medium |
| U8 | **Phone-only dead ends.** Hint greyed out with no reason; the green line only reachable by tapping an unmarked sentence; the repeat card unlabelled. | `walk-phone.md` #8. | Medium |
| U9 | **Tiny or hidden marks.** One-square arrows hidden under the piece. An illegal drag snaps back with no message. On phone the evaluation bar is 6 px wide and stays grey until you answer. | `shots-desktop/07-c2-standard-task-short-red-arrow.png`, `walk-desktop.md` card 3, `walk-phone.md` measurements. | Low |
| U10 | **Layout shift.** The whole card moved about 7 px left partway through a card and stayed there. | `walk-desktop.md` card 5. | Low |

---

## 3. Research patterns to use (20), each tied to the problem it solves

The "Solves" column points back to the tables above: [2.3] means bullet 2, cause 3; [U1] means unnamed problem U1.

| # | Pattern | What it means on our board | Solves | Source |
|---|---|---|---|---|
| 1 | **Show right/wrong on the square, before any words** | A ✓ or ✗ circle on the top-right corner of the square the piece landed on, 40% of the square wide. Green #22ac38 or red #df5353. It fades in over 150 ms, within 100 ms of the answer. | [4.1] [4.2] [4.3] [1.1] | https://github.com/lichess-org/chessground/blob/master/src/glyph.ts ; https://github.com/lichess-org/lila/blob/master/ui/puzzle/src/autoShape.ts ; https://www.chess.com/daily-chess-puzzle |
| 2 | **A coloured result band of 1 to 3 words, plus a sound** | The top line (phone) or the top of the panel (desktop) turns green or red and says "Found it" or "Not this one", at 20 px or more, with the existing right/wrong sound. Nothing else changes in that frame. | [4.2] [4.3] [4.4] | https://duolingo-papers.s3.amazonaws.com/reports/Duolingo_whitepaper_duolingo_method_2023.pdf ; https://github.com/lichess-org/lila/blob/master/ui/learn/src/levelCtrl.ts |
| 3 | **One change per frame: board first, text after the piece lands** | Order: result, then motion, then a caption 150 ms after the piece stops. No text changes anywhere while a piece moves. | [1.1] [1.3] [1.5] [1.6] [4.7] | https://www.nngroup.com/articles/change-blindness-definition/ ; https://m1.material.io/motion/choreography.html ; https://developer.apple.com/design/human-interface-guidelines/motion |
| 4 | **The user steps through lines; they do not autoplay** | One move per tap, on a big "Next move" button or on the board. If anything does play by itself: at least 1000 ms per quiet move, 2000 ms on a capture or check, and a tap skips any motion. | [1.2] [1.7] [3.3] | https://eric.ed.gov/?id=EJ638751 ; https://github.com/lichess-org/lila/blob/master/ui/analyse/src/autoplay.ts ; https://support.chessable.com/en/articles/9043704-can-i-use-movetrainer-at-a-slower-pace |
| 5 | **A wrong try freezes and waits** | The tried move stays on the board with both squares tinted red, a ✗ mark and one "Try again" button. The board never resets by itself. | [1.3] [1.4] [U1] | https://www.chess.com/daily-chess-puzzle ; https://github.com/lichess-org/lila/blob/master/ui/puzzle/src/ctrl.ts |
| 6 | **Mark the attacker, let it strike once, then hold** | On a miss: a red ring or "!" on the opponent piece that punishes, and a red arrow to its target. After 600 ms it plays that one capture or check, then holds still. The replay never includes the user's next move. | [3.2] [3.5] [U1] [U2] | https://github.com/lichess-org/lila/blob/master/ui/learn/src/levelCtrl.ts |
| 7 | **Hide the refutation behind a button that names what happens** | "See how you lose the rook" or "Show the fork", stepped one move per tap, instead of an unasked replay. The label tells the user what to look for before anything moves. | [1.2] [3.5] [4.7] | https://support.chess.com/en/articles/8584089-how-does-game-review-work |
| 8 | **You only move your own pieces; the threat is drawn, not quizzed** | The opponent's punishing reply appears as a red threat arrow on the board. The task stays "find a better move". | [2.1] [2.3] [2.5] [5.1] | https://github.com/lichess-org/lila/blob/master/ui/analyse/src/autoShape.ts ; https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i- |
| 9 | **If the user must play the other side, the board must say so** | Flip the board to that side and show "Black to move" with a black king icon. Only that side's pieces lift, and a tap on your own piece gets a short message explaining why. | [2.3] [2.4] [2.5] | https://www.chess.com/blog/Sawbonez/meet-dr-wolf-1 ; https://chesstempo.com/manual/en/manual.html |
| 10 | **A two-word task, starting with the action, plus a side icon** | "Your turn" (20 px bold) over one 6-word line ("Find a better move for Black."), next to a king icon in the solver's colour. The big line is the action, never a question. | [2.6] [5.1] | https://github.com/lichess-org/lila/blob/master/ui/puzzle/src/view/feedback.ts ; https://blunders.ai/ |
| 11 | **Fixed colour meanings, at most two arrows and one ring per frame** | Red = your mistake or their threat. Green = the better move. Red ring = the piece that is lost or hanging. Red glow = king in check. The meanings never change between screens. | [3.1] [3.3] | https://github.com/lichess-org/lila/blob/master/ui/learn/src/stage/capture.ts ; https://support.chess.com/en/articles/10319151-what-do-the-colored-arrows-and-circles-mean-in-movetrainer ; https://decodechess.com/chess-threat-analysis/ |
| 12 | **Red on what you did, green on what you should have done, on one board** | A "??" mark on the piece that blundered, plus a green arrow for the better move, drawn together on the position where you went wrong. | [3.1] [3.9] [4.6] | https://github.com/lichess-org/lila/blob/master/ui/analyse/src/autoShape.ts |
| 13 | **Mark the reason on the board** | A mark on the undefended or pinned piece. A faded ghost of the captured piece left on its square for one frame. | [3.2] [1.7] [3.6] | https://github.com/lichess-org/chessground/blob/master/src/glyph.ts |
| 14 | **Words sit on the board, or light it up** | Short labels attached to the arrow or square ("free bishop"). Tapping a move name in a sentence draws that move. Research: text placed next to the picture, and shown at the same moment, helps (effect sizes d = 0.72 and 0.87). | [3.1] [4.4] [4.5] | https://www.chess.com/news/view/chesscom-launches-game-review-v2 ; https://www.researchgate.net/publication/248498142_Integrating_information_A_meta-analysis_of_the_spatial_contiguity_and_temporal_contiguity_effects |
| 15 | **Reveal in layers: result, one line, "Why?", Next** | At most 15 words before any tap. Everything else moves behind "Why?" or to the end-of-session summary: what the opponent did, the pattern tag, the review date, the habit tip and explore. The result card is about four short lines, like Backrank's: "Correct!" / "Nf7#" / "+M1" / "Next review in 3 days". | [4.4] [4.5] [1.1] | https://www.nngroup.com/articles/progressive-disclosure/ ; https://blog.duolingo.com/explain-my-answer-now-free ; https://backrank.io/ |
| 16 | **Show a worked example first, then remove the help** | The first time a pattern appears (especially for beginners, tier 1): draw the threat in red and the fix in green, and ask the user to play the green arrow. Later sightings drop the arrows. | [2.1] [5.1] [5.2] | https://github.com/lichess-org/lila/blob/master/ui/learn/src/stage/protection.ts ; http://www.cee.uma.pt/ron/Salden%20et%20al.%20-%20The%20Expertise%20Reversal%20Effect%20and%20Worked%20Examples.pdf |
| 17 | **Hints drawn on the board, in steps** | Hint 1 highlights the piece to move (today's Hint 2 ring). Hint 2 draws the arrow. The user still plays the move. | [3.8] [2.10] | https://support.chess.com/en/articles/8708990-how-does-the-daily-puzzle-work ; https://github.com/lichess-org/lila/blob/master/ui/puzzle/src/ctrl.ts |
| 18 | **A one-time label bubble on the board** | On the first card, a small bubble at the red arrow: "Your move in the game". On the first result, one at the green arrow. Whether it was seen is stored in the browser, so it never repeats. | [5.1] [5.6] [2.7] | https://github.com/ArneVogel/listudy/blob/master/assets/js/modules/overlays.js |
| 19 | **A soft fail for a good move that is not the best** | "Good move. There is a stronger one." No ✗, no punishment replay, and a free retry. | [5.5] [U6] | https://support.chessable.com/en/articles/9043806-what-are-soft-fail-moves ; https://chesstempo.com/manual/en/manual.html |
| 20 | **After a miss, the main button is "Try again" or "See why", never "Next"** | After a miss, Next is a small secondary button and nothing moves on by itself. A first-try success may move on by itself after about 1.2 s unless "Why?" is tapped. | [2.8] [5.5] | https://chesstempo.com/manual/en/manual.html ; https://apps.apple.com/us/app/aimchess-learn-chess-online/id1524941307 |

**Left out on purpose:**
- **chess.com's hearts** (a visible budget of allowed mistakes). They conflict with the standing rule in `learning-design.md`: no XP, no badges, no leagues.
- **Aimchess's two-arrow choice** ("which of these two moves loses?"). It stays an option under Decision 1, not a default.

---

## 4. Hard constraints for the redesign

### 4.1 Already there and cheap to change

**Board drawing:**
- **Arrows already take any colour** (`arrow(from, to, color, key, cls)`, `board:181-196`). Showing several at once needs an `opts.arrows` list with a unique key per arrow, because each arrowhead's id is built from that key (`'ah' + key + uid`). Small job.
- **Marks on squares:** about 25 lines in `board` (reusing the board-flip handling of the hint ring, `board:206-208`) and about 10 in `render` (`code-map.md` §4). Small.
- **Ghost of a captured piece:** the board code only draws the current position, so the captured piece has to be passed in (as `opts.ghostPiece`). The data is already known (`L.states[idx-1]`, `played.states[i-1]` at `card:480`). Small.
- **Threat lines:** the tactic detector already holds the attacker and target (`a.cls.gameLine.nodes[k].move`, `a.cls.allowed.fork / pin / discoveredAttack`, used by `hintText` at `card:558-574`). Small to medium.
- **Turn marker:** whose turn it is (`st.w`) is known. A small badge in the top bar (`#ctop`) needs no board change. Small.

**Timing and motion:**
- **Every timing value is a plain timer constant** (`code-map.md` §3: `card:307`, `492`, `495-506`, `509`, `631`, `632`, `649`, `654`; `render:521-524`). Retiming is trivial. Removing autoplay is a small code change, but it breaks `e2e-browser.js:84`.
- **Piece slides are pure CSS, 220 ms** (`css:268`). Keep them.

**Existing assets and structure:**
- The right/wrong sounds exist (`board:247-271`). So does the hint ring (`board:205-215`) and the reduced-motion handling (`css:394-397`, `card:645`).
- The result panel is built by one function (the answered-card part of `panelHtml`, `render:714-770`). Reordering its items, or moving them behind a tap, is cheap.

**Worth keeping as they are:**
- The Hint 2 gold ring.
- The red glow on a mated king.
- The calm result on a repeat card solved first try.
- The legal-move dots.
- The 220 ms slide.
- One-line results that fit the phone's top line.

### 4.2 Structural or expensive

- **One repaint does everything.** `renderCard` writes the top bar, the board and the panel in one go (`render:506-516`). Staging "result, then motion, then caption" needs a small sequencer, or a way to hold text back until motion ends. Medium effort, and it touches every phase of the card.
- **The board is rebuilt from scratch on every repaint** (`render:467`). Any CSS animation (a fading mark, a pulse) restarts every time `renderCard` runs, which is on each tap and each autoplay step. Animations must be keyed so they do not replay, or limited to a few cycles. Medium.
- **The phone prompt line is a fixed box.** It is 56 px tall, 2 lines of 15 px text, capped at 80 characters by `fitLine` (`card:64-69`). A coloured band or a second line means changing that box and the test that reads it (`session.test.js:331` checks the `.card-task` markup with a regex).
- **The check card is wired into scheduling and the summary.**
  - Its grading works without the engine (`card:260-288`).
  - Its first/fail results feed the review schedule (`srs.test.js`).
  - It feeds the summary line "Today you spotted their reply on N of M" (`render:404`, `card:265-271`).
  - A test requires at least 50% of piece-safety and king-safety cards to qualify (`session.test.js:259`).

  Removing or reshaping it is a product decision (section 5), not a styling change.
- **Explanation wording is snapshot-tested.** Changing any explanation sentence means rerunning `npm run explain` and bumping `CLASSIFY_V` (`test/run.js:55-60`). Short sentences must stay at 84 characters or fewer (`run.js:46-54`).
- **The engine check takes real time,** up to a 9000 ms timeout (`card:370-379`). The "move received" state must appear instantly and stay neutral. The right/wrong result comes when the engine answers.

### 4.3 Tests that lock in today's behaviour

**Tests that must change if the redesign follows the research:**
- `e2e-browser.js:84`: "the answer line moves forward by itself within 3.2 s" (locks in autoplay).
- `e2e-browser.js:88` and `:99`: a single red arrow at the start of the refutation line, and at most one arrow while exploring (lock in one arrow at a time).
- `e2e-browser.js:53`, `:56`, `:57`: text patterns "What can (White|Black) do now", "You saw it", "better move was" (lock in the check-card wording).
- `e2e-browser.js:80`: both the red and green explanation lines contain text (locks in the panel lines).
- `e2e-browser.js:87`: clicking the red line switches the board to the refutation.
- `session.test.js:259`: the rules for which cards become check cards.
- `session.test.js:331`: the 80-character phone line, read with a regex.
- `explore.test.js:71`, `:81`, `:89`, `:97`: the invite wording; explore starts from the frame on screen (the cause of U5); explore starts at the first move of the best line; the wording of the line that names Stockfish's pick.
- `e2e-browser.js:125` ("Show me" counts as a fail), `:150` (a hint note appears after the 2nd miss), `:160` ("answer is" appears after a reveal).
- These CSS names are used by the input code (`shell:413`, `shell:619-622`, `shell:691-694`) and by `e2e-browser.js:70-99`: `.bad-arrow`, `.good-arrow`, `.ghost-arrow`, `#bwrap.static`, `rect[data-sq]`, `use[data-sq]`. Keep them, or update both places.
- Scripted clicks wait 500 ms because of a 450 ms guard against accidental double taps (`card:530`, `e2e-browser.js:122`).

**Already compatible:** `session.test.js:276` requires that a tap on your own piece keeps a check card in its "check" phase. A message is allowed; a grade is not. So answering that tap with a short message passes as is.

**Tests that must keep passing** (the first two protect the no-spoiler rule):
- `session.test.js:300`: the verdict on a replayed game move never names the answer.
- `session.test.js:316`: hints never name the answer on missed-chance cards.
- `session.test.js:248`: an engine failure never counts as a miss.
- `npm run lint`, and `build.py`'s refusal of em dashes (`build.py:26-28`).

### 4.4 Product constraints

- **Free and fully client-side.** Stockfish runs in the browser. There is no server and no LLM. Every new mark or sentence must come from data the page already computes: the tactic detector, the stored refutation, the local engine.
- **Mobile first.** Design at 390x844 first. The board is 384 px; above it is a 56 px prompt box; below it is a fixed 64 px action bar plus the safe area. The whole page is only 844 to 859 px tall. New information goes on the board or in the top line, not into a longer panel. Input is tap-tap and drag. Vibration only works on Android (`navigator.vibrate`).
- **No em dashes in any copy.** `build.py` enforces it.
- **Spoiler-safe.**
  - Never print or draw the answer before the user tries. This now covers the board too: no wrong-try replay may contain the solution move [U1], and no green arrow appears before the answer.
  - Drawing the opponent's threat is a hint, not the answer. But it makes the card easier, so it must be tied to the hint steps or to the worked-example level.
- **The trainer must still teach WHY.**
  - Right/wrong alone is what lichess puzzles do. Lichess users complain about exactly that: "You can't learn from a mistake unless you know why you made it".
  - Every card must still show (a) what the mistake allowed and (b) what the better move does.
  - What changes is where and when: by default, one still picture on the board plus 10 words or fewer, with the full line one tap away.
- **No XP, badges, leagues or hearts.** This is a standing rule in `learning-design.md`. Progress stays counted in chess terms.
- **Honour reduced motion everywhere,** including the wrong-try replay and forcing-line replies. Today both ignore it (`card:476-510`, `card:307`).
- **Accessibility.** A coloured result must also carry a shape (✓ or ✗) for colour-blind users. The screen-reader announcement that mirrors the prompt line (`render:538-541`) must keep reading out the result.

---

## 5. Open product decisions for the founder (3)

### Decision 1. What happens to the blunder check ("move their piece")?

Context:
- It was the one new feature of the 28 Sept build (`mistakes-pivot-spec.md` §13).
- It trains a real habit: what does their move threaten?
- It is the main source of bullet 2.

Options:
- **A. Keep the quiz, but make it honest.** Flip the board to the opponent's side and show "Black to move" with a black king icon. Answer own-piece taps with a short message, and allow a second try. This keeps the active recall, but day one still has a mode switch.
- **B. Change the action to a tap or a choice.** "Tap the piece that punishes Rg1", or Aimchess-style: two plain arrows and "Which move loses material?". This keeps the skill without moving the other side's pieces, but needs new grading code.
- **C. Stop quizzing it; draw it.** On the board after the mistake, ring the opponent's punishing piece and draw a red arrow to what it wins. Play that one move on tap, then ask the normal "find a better move". You only ever move your own pieces.

**Recommendation: C as the default, with never more than one "their turn" moment in a first session.**
- It is what lichess and chess.com do.
- It removes the dead-tap problem entirely.
- It is cheap: an arrow, a ring and one move.
- It still teaches the threat, because the user sees it strike on the board before solving.

If the founder wants threat-spotting to stay a scored skill (the summary's "spotted their reply on N of M"), keep option A for stronger players (tier 2 and up), from the second sighting, never on day one. Either way, change the first-session order (`session:63-66`, `session:146`) so card 1 is a plain "find a better move".

### Decision 2. How much should play by itself?

Options:
- **A. Nothing plays unless asked.** Every line is stepped one move per tap ("Next move"), started by a button that says what it shows.
- **B. Keep autoplay, but slower:** 1000 ms per quiet move, 2000 ms on captures and checks, a caption on each key move, and a tap to skip.
- **C. One key moment plays and holds; the rest is stepped.** After a miss, the one punishing move plays and the board holds on the capture, marked in red. After a solve, the board holds on the user's move with a ✓. "See the line" steps through the rest.

**Recommendation: C.**
- It keeps a "show me" feel, so the 1600 and 1800 personas do not have to tap through everything.
- It also follows the research: short user-paced segments, and nothing important vanishing before it is read.
- It answers the founder's "I'm still thinking" point.
- It requires rewriting `e2e-browser.js:84`.

### Decision 3. How much "why" is shown by default, and how much sits behind a tap?

Options:
- **A. Keep the full panel, just quieter:** smaller and reordered.
- **B. Layered.** By default the card shows:
  - the coloured result band;
  - the board picture (Decision 2's held moment, with its marks);
  - one sentence of 10 words or fewer naming the reason.

  "Why?" opens the stepped line with one caption per move. What the opponent did, the game details, the pattern tag, the review date and the habit tip move behind "Why?" or to the end-of-session summary. Explore moves behind "Why?" too.
- **C. Result only; the why only on request,** as in pure puzzle apps.

**Recommendation: B.**
- It meets "intuitive without reading" (15 words or fewer before any tap).
- It still teaches why on every card, through the picture.
- C would break the teach-why constraint, and A does not fix bullet 4.
