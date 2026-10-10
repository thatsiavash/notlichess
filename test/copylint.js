// Copy lint: every word the fixture's cards put on screen (band rows, chips, captions, buttons, the strip,
// board labels, Details, the ••• menu), and Today, the summary and Insights through the stubbed DOM, at
// tiers 1, 2 and 3 (exploring's rows need the engine's lines and are not read here),
// checked against each tier's banned words, the card's caps and one check line per card. Run from
// labels.test.js on its realm: copyLint(A, OPEN, FRAMES) walks every frame of every card (labels.test.js's
// eachFrame) and returns { found, fresh, gone, t1card, strings, frames }.
//   Banned at every tier: session, solved, leak, engine, "!" and the em dash.
//   Banned at tier 1: material, on top, balanced, level, advantage, slip, percentages; and in band rows
//   and captions only (names such as "Other tactics" elsewhere stay): tactic, decided and notation
//   (a SAN move; a square alone, "on f2", is no notation).
//   Caps: row 1 26 characters; row 2 40 characters and 7 words; a caption 60 and 8; a chip 14 and 3; at
//   most 15 words in a still frame (rows, chip, caption, strip, buttons, board label). A move in words
//   counts as one word; a piece of the ledger ("lost ♕♗ for ♜") no word, and two characters.
//   One check line per card: Details and the summary say the same habit for it.
// A violation is kept as "tier|rule|where|template" (moves, pieces, squares, numbers and opponents made
// generic), against the baseline in data/copylint-baseline.json: today's violations, so a new one fails
// and one that went away must leave the baseline too (it only shrinks, until the card strings and
// Insights are clear). NL_LINT_WRITE=1 node test/labels.test.js writes the baseline afresh.
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, 'data', 'copylint-baseline.json');

const EVERY = [['session', /\bsessions?\b/i], ['solved', /\bsolved\b/i], ['leak', /\bleaks?\b/i], ['engine', /\bengines?\b/i], ['exclamation', /!/], ['em dash', /\u2014/]];
const T1 = [['material', /\bmaterial\b/i], ['on top', /\bon top\b/i], ['balanced', /\bbalanced\b/i], ['level', /\blevel\b/i],
  ['advantage', /\badvantages?\b/i], ['slip', /\bslip(s|ped|ping)?\b/i], ['percentage', /\d\s?%/]];
/* SAN with a piece letter, a pawn's capture, a promotion or castling */
const SAN = /(?:\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\b[a-h][18]=[QRBN]|\bO-O(?:-O)?)[+#]?/;
const T1_BAND = [['tactic', /\btactic(s|al)?\b/i], ['decided', /\bdecided\b/i], ['notation', SAN]];
const BAND = { row1: 1, row2: 1, chip: 1, cap: 1 };
const MOVE_WORDS = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling\b/gi;
const words = (s) => String(s || '').replace(MOVE_WORDS, 'Mv').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
/* a row's length, each of the piece ledger's symbols (F1.2, F1.4) taking two characters */
const len = (s) => String(s).length + (String(s).match(/[\u2654-\u265f]/g) || []).length;
const CAPS = { row1: [26, 99], row2: [40, 7], cap: [60, 8], chip: [14, 3] };
const generic = (s) => String(s).replace(/\bopponent\d+\b/g, 'O').replace(MOVE_WORDS, 'M').replace(new RegExp(SAN.source, 'g'), 'M')
  .replace(/\b(?:king|queen|rook|bishop|knight|pawn)s?\b/gi, 'P').replace(/\b[a-h][1-8]\b/g, 'S').replace(/\d+/g, 'N');

/* every frame and every screen, read in the realm: frames [tier, key, what, row1, row2, cap, chip,
   buttons, strip, label], screens [tier, where, text], habits [tier, key, details, summary] */
const COLLECT = (OPEN, FRAMES) => `(function () { ${OPEN} ${FRAMES}
  var frames = [], screens = [], habits = [], seen = {};
  /* the typed-move field is off screen (the keyboard's way in), so not counted */
  var txt = function (h) { return String(h || '').replace(/<label class="kb-move[^"]*">[\\s\\S]*?<\\/label>/g, ' ').replace(/<input[^>]*>/g, ' ').replace(/<[^>]+>/g, '\\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); };
  var bits = function (h) { return txt(h).split('\\n').map(function (x) { return x.replace(/\\s+/g, ' ').trim(); }).filter(Boolean); };
  var screen = function (tier, where, h) { bits(h).forEach(function (b) { var k = tier + '|' + where + '|' + b; if (!seen[k]) { seen[k] = 1; screens.push([tier, where, b]); } }); };
  var box = { innerHTML: '', dataset: {}, style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
  var el0 = el;
  el = function (id) { return id === 'insightsbox' ? box : el0(id); };
  [1, 2, 3].forEach(function (tier) {
    playerTier = function () { return tier; };
    allMistakes().filter(trainable).forEach(function (it) {
      eachFrame(it, function (what, a) {
        var d = displayFor(a), lb = null;
        try { lb = frameLabel(a, boardOptsFor(a), 360, false); } catch (e) {}
        frames.push([tier, it.key, what, d.row1, d.row2, d.cap, d.chip, d.buttons.map(function (b) { return b.label; }), bits(d.strip).join(' '), lb ? lb.text : '']);
        /* the ••• menu, before and after an answer */
        if (what === 'open' || what === 'S0 settled') screen(tier, 'menu', menuHtml(a));
        if (what === 'S0 settled') {
          var dh = detailsHtml();
          screen(tier, 'details', dh);
          var hm = /<p class="habit">([^<]*)<\\/p>/.exec(dh);
          habits.push([tier, it.key, hm ? txt(hm[1]).trim() : '', recapHabit({ spec: { type: 'one', key: it.key }, keys: [it.key] })]);
        }
      });
    });
    ui.session = null;
    screen(tier, 'today', heroHtml() + focusHtml() + latestGamesHtml() + nextDueHtml());
    var ks = allMistakes().filter(trainable).slice(0, 5).map(function (x) { return x.key; });
    var res = ['first', 'retry', 'hint', 'fail', 'skip'], ss = { mode: 'today', label: 'Today', keys: ks, idx: ks.length, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true };
    ks.forEach(function (k, i) { ss.results[k] = res[i]; });
    ss.notes[ks[3]] = 'shown';
    screen(tier, 'summary', doneHtml(ss));
    ui.view = 'insights'; box.innerHTML = '';
    renderInsights();
    screen(tier, 'insights', box.innerHTML);
    ui.view = 'train';
  });
  el = el0;
  return JSON.stringify({ frames: frames, screens: screens, habits: habits });
})()`;

module.exports = function copyLint(A, OPEN, FRAMES) {
  const r = JSON.parse(A.ev(COLLECT(OPEN, FRAMES)));
  const found = new Set();
  const add = (tier, rule, where, s) => found.add(tier + '|' + rule + '|' + where + '|' + generic(s));
  const check = (tier, where, s) => {
    EVERY.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
    if (tier !== 1) return;
    T1.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
    if (BAND[where]) T1_BAND.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
  };
  let strings = 0;
  r.frames.forEach(([tier, key, what, row1, row2, cap, chip, buttons, strip, label]) => {
    const parts = { row1, row2, cap, chip, strip, label };
    buttons.forEach((b) => check(tier, 'button', b));
    Object.keys(parts).forEach((w) => {
      if (!parts[w]) return;
      strings++;
      check(tier, w, parts[w]);
      const cap = CAPS[w];
      if (cap && (len(parts[w]) > cap[0] || words(parts[w]) > cap[1])) add(tier, 'caps', w, parts[w]);
    });
    const n = [row1, row2, cap, chip, strip, label].concat(buttons).reduce((x, s) => x + words(s), 0);
    if (n > 15) add(tier, 'over 15 words', what.replace(/\d+/g, 'N'), [row1, row2, cap, chip, strip, label].concat(buttons).filter(Boolean).join(' / '));
  });
  r.screens.forEach(([tier, where, s]) => { strings++; check(tier, where, s); });
  r.habits.forEach(([tier, key, d, s]) => { if (d && s && d !== s) add(tier, 'two check lines', 'details/summary', d + ' | ' + s); });
  if (process.env.NL_LINT_WRITE) {
    fs.writeFileSync(BASE, JSON.stringify({ note: 'Copy lint baseline (test/copylint.js): violations still on screen, tier|rule|where|template. It only shrinks.', known: [...found].sort() }, null, 1) + '\n');
  }
  const base = fs.existsSync(BASE) ? new Set(JSON.parse(fs.readFileSync(BASE, 'utf8')).known) : new Set();
  const fresh = [...found].filter((v) => !base.has(v)).sort(), gone = [...base].filter((v) => !found.has(v)).sort();
  /* F1.6: the card's own strings at tier 1 (its rows, chip, caption, strip, buttons and board label) */
  const CARD = { row1: 1, row2: 1, chip: 1, cap: 1, strip: 1, label: 1, button: 1 };
  const t1card = [...found].filter((v) => { const f = v.split('|'); return f[0] === '1' && f[1] !== 'caps' && f[1] !== 'over 15 words' && CARD[f[2]]; }).sort();
  return { found: found.size, fresh, gone, t1card, strings, frames: r.frames.length };
};
