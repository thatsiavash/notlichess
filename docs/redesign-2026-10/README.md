# Card-flow redesign: working notes (branch p3)

Temporary folder for the redesign of the game-review cards. **Delete `docs/redesign-2026-10/` and `tools/dev/` in the last commit before this branch is merged to main**: the site is served from the repo root, so anything left here would be published.

- `FINAL-SPEC.md`: the buildable spec. Section 6 lists 14 ordered slices.
- `build-notes.md`: what each slice did, its deviations and its commit.
- `carried-minors.md`: minor issues reviewers left open. Fix those in your slice's area and mark them DONE; a final sweep fixes the rest.
- `PROBLEM-MAP.md`, `code-map.md`: the audit behind the spec (screenshot paths in them point to files that are not in the repo).

Founder decisions that override everything: every card asks for the player's better move (no "move their piece" step); nothing moves on its own except the slow, marked opponent reply inside a forcing line; text never changes while a piece moves; intuitive without reading.

Tools: `node tools/dev/serve.js` (env ROOT, PORT) serves the repo statically; `tools/dev/cdp.mjs` drives headless Chrome over CDP (`launch({width, height, mobile})`, then `goto`, `eval`, `shot`, `click`, `drag`, `key`, `close`). Set CHROME_PATH if Chrome or Chromium is somewhere else.
