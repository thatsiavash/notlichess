// Copy lint: every word the fixture's cards put on screen (band rows, chips, captions, buttons, the strip,
// board labels, Details, the ••• menu), and Today, the summary and Insights through the stubbed DOM, at
// tiers 1, 2 and 3 (exploring's rows need the engine's lines and are not read here),
// checked against each tier's banned words, the card's caps and one check line per card. Run from
// labels.test.js on its realm: copyLint(A, OPEN, FRAMES) walks every frame of every card (labels.test.js's
// eachFrame) and returns { found, fresh, gone, t1card, habit, routine, habits, strings, frames }.
//   Banned at every tier: session, solved, leak, engine, on top (content's review of slice 1), "!" and
//   the em dash.
//   Banned at tier 1: material, balanced, level, advantage, slip, percentages; and in band rows
//   and captions only (names such as "Other tactics" elsewhere stay): tactic, decided and notation
//   (a SAN move; a square alone, "on f2", is no notation).
//   Caps: row 1 26 characters; row 2 40 characters and 7 words; a caption 60 and 8; a chip 14 and 3; at
//   most 15 words in a still frame (rows, chip, tag row, caption, strip, buttons, board label). A move in words
//   counts as one word; a piece of the ledger ("lost ♕♗ for ♜") no word, and two characters.
//   One check line per card (F2.3): Details says the line the summary shows for it, and no screen holds
//   an old habit sentence (the 22 habit lines and the hint fallbacks they replaced: `habit`, never on the
//   baseline); tier 1 never shows the routine line (`routine`).
// A violation is kept as "tier|rule|where|template" (moves, pieces, squares, numbers and opponents made
// generic), against the baseline in data/copylint-baseline.json: today's violations, so a new one fails
// and one that went away must leave the baseline too (it only shrinks; the card strings and Insights
// are clear: `t1card`, `ins`). NL_LINT_WRITE=1 node test/labels.test.js writes the baseline afresh.
// Insights is read with how we count and, after every frame, since you started in both its states (with
// how we count's line on the start day's threshold).
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, 'data', 'copylint-baseline.json');

const EVERY = [['session', /\bsessions?\b/i], ['solved', /\bsolved\b/i], ['leak', /\bleaks?\b/i], ['engine', /\bengines?\b/i], ['on top', /\bon top\b/i], ['exclamation', /!/], ['em dash', /\u2014/]];
const T1 = [['material', /\bmaterial\b/i], ['balanced', /\bbalanced\b/i], ['level', /\blevel\b/i],
  ['advantage', /\badvantages?\b/i], ['slip', /\bslip(s|ped|ping)?\b/i], ['percentage', /\d\s?%/]];
/* SAN with a piece letter, a pawn's capture, a promotion or castling */
const SAN = /(?:\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\b[a-h][18]=[QRBN]|\bO-O(?:-O)?)[+#]?/;
const T1_BAND = [['tactic', /\btactic(s|al)?\b/i], ['decided', /\bdecided\b/i], ['notation', SAN]];
const BAND = { row1: 1, row2: 1, chip: 1, tag: 1, cap: 1 };
const MOVE_WORDS = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling\b/gi;
const words = (s) => String(s || '').replace(MOVE_WORDS, 'Mv').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
/* a row's length, each of the piece ledger's symbols (F1.2, F1.4) taking two characters */
const len = (s) => String(s).length + (String(s).match(/[\u2654-\u265f]/g) || []).length;
/* the tag row's context line has its own cap, 22 characters (F4.2) */
const CAPS = { row1: [26, 99], row2: [40, 7], cap: [60, 8], chip: [14, 3], tag: [22, 3] };
/* the habit sentences F2.3's check lines replaced (17 patterns', 5 families'), and the hint fallbacks
   that said a habit: none may come back on any screen */
const OLD_HABITS = ['Before every move, look at every check your opponent could give.', 'When their king is short of squares, look at every check you have.',
  'After every opponent move, ask: did they leave anything undefended?', 'Checks, captures, threats: look at your own forcing moves first.',
  'Look for squares where one enemy piece could hit two of yours.', 'Pieces lined up with your king or queen are targets. Take them off the line.',
  'Watch enemy pieces standing in front of their rooks, bishops and queen.', 'Every turn, ask first: what does their last move threaten?',
  'Before you capture, count attackers and defenders on that square.', 'Before you let go of a piece: what does this move leave undefended?',
  'A passed pawn is a runaway. Put a piece in front of it early.', 'Before you move, look at every capture your opponent will have next.',
  'The pawns in front of your castled king do not move without a concrete reason.', 'When you are winning: trade pieces, keep your king safe, take no risks.',
  'In the opening: develop a new piece each move, castle, and don\'t move a piece twice.', 'When nothing is happening, ask: which of my pieces is doing nothing?',
  'In the endgame, bring your king into the game. It is a strong piece now.', 'Before every move, look at what your opponent can capture next.',
  'After every opponent move, look for your own checks, captures and threats.', 'When nothing is happening, find your worst piece and improve it.',
  'Keep your king out of the open while the queens are on the board.', 'In the endgame, check every pawn race before you move your king.',
  'Keep it simple and safe.', 'Find your worst piece and improve it.', 'Look for checks and captures.', 'Look at your king\'s safety.'];
const OLD_ASK = /^(?:What does (?:White|Black) threaten\?|Ask what .+ allows\.)$/;
const ROUTINE = 'Every move: their move, your chances, safety check.';
const generic = (s) => String(s).replace(/\bopponent\d+\b/g, 'O').replace(MOVE_WORDS, 'M').replace(new RegExp(SAN.source, 'g'), 'M')
  .replace(/\b(?:king|queen|rook|bishop|knight|pawn)s?\b/gi, 'P').replace(/\b[a-h][1-8]\b/g, 'S').replace(/\d+/g, 'N');

/* every frame and every screen, read in the realm: frames [tier, key, what, row1, row2, cap, chip,
   buttons, strip, label, tag], screens [tier, where, text], habits [tier, key, details, summary] */
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
        frames.push([tier, it.key, what, d.row1, d.row2, d.cap, d.chip, d.buttons.map(function (b) { return b.label; }), bits(d.strip).join(' '), lb ? lb.text : '', d.tag]);
        /* the ••• menu, before and after an answer */
        if (what === 'open' || what === 'S0 settled') screen(tier, 'menu', menuHtml(a));
        if (what === 'S0 settled') {
          var dh = detailsHtml();
          screen(tier, 'details', dh);
          var hm = /<p class="habit">([^<]*)<\\/p>/.exec(dh);
          /* the line the summary of a set of this card alone shows for it: on its tile (tier 3's
             computed fact), else under "Keep in mind" */
          var e = ui.session.sum && ui.session.sum[it.key], one = { mode: 't', label: 't', keys: [it.key], idx: 1, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true };
          one.results[it.key] = ui.session.results[it.key] || 'first';
          if (e) one.sum[it.key] = e;
          var d1 = doneHtml(one), tc = /<span class="tile-check">([^<]*)</.exec(d1), km = /class="(?:plan )?keep-line">([^<]*)</.exec(d1);
          habits.push([tier, it.key, hm ? txt(hm[1]).trim() : '', tc ? txt(tc[1]).trim() : km ? txt(km[1]).trim() : '']);
        }
      });
    });
    ui.session = null;
    screen(tier, 'today', heroHtml() + whyTheseHtml(todayPlan()) + cleanLineHtml() + focusHtml() + latestGamesHtml() + nextDueHtml());
    var ks = allMistakes().filter(trainable).slice(0, 5).map(function (x) { return x.key; });
    var res = ['first', 'retry', 'hint', 'fail', 'skip'], ss = { mode: 'today', label: 'Today', keys: ks, idx: ks.length, results: {}, notes: {}, relearn: [], relearnOf: {}, finished: true };
    ks.forEach(function (k, i) { ss.results[k] = res[i]; });
    ss.notes[ks[3]] = 'shown';
    /* with the first diagnosis in full and the reminder's question (F5.2, F5.4); then the diagnosis's
       other states, the backup prompt and the reminder in Settings */
    screen(tier, 'summary', doneHtml(ss));
    screen(tier, 'summary', diagHtml({ dx: { k: 'line' } }, tier) + diagHtml({ dx: { k: 'card', full: false, cov: { losses: 9, decided: 7, covered: 12, total: 40 } } }, tier)
      + diagHtml({ dx: { k: 'card', full: false, cov: { losses: 2, decided: 1, covered: 12, total: 40 } } }, tier) + cueCardHtml({ cue: 'backup' }));
    ui.cueSlot = 'evening'; screen(tier, 'settings', cueBody('settings')); ui.cueSlot = null;
    ui.view = 'insights'; box.innerHTML = '';
    renderInsights();
    screen(tier, 'insights', box.innerHTML);
    screen(tier, 'insights', sheetHtml('count'));
    ui.view = 'train';
  });
  /* since you started (F6.2), after every frame is read (what it sets up is put back): its waiting
     state, a verdict with a practised skill and stronger opponents, every verdict's words, and
     Today's line from 10 games since */
  var keep = data.games.slice(), srs0 = JSON.stringify(store.get(srsKey(), {})), start0 = store.get(startKey(), null);
  store.del(startKey());
  var srsNow = srsLoad(), now = Date.now();
  allMistakes().filter(function (it) { return trainable(it) && familyOf(patternOf(it.b)).key === 'safety'; }).slice(0, 6)
    .forEach(function (it) { srsNow[it.key] = { box: 2, streak: 1, due: now + 3 * DAY, last: now, lapses: 0 }; });
  srsSave(srsNow);
  noteStart(now - 3600e3);
  var since = function (spec, then) {
    data.games = keep.slice(); modelDirty();
    window.__nlTest.seedAfterGames(spec);
    if (then) then();
    [1, 2, 3].forEach(function (tier) {
      playerTier = function () { return tier; };
      ui.view = 'insights'; box.innerHTML = '';
      renderInsights();
      screen(tier, 'insights', box.innerHTML);
      screen(tier, 'insights', sheetHtml('count'));
      screen(tier, 'insights', Object.keys(SINCE_SAY).map(function (k) { return '<p>' + SINCE_SAY[k] + '</p>'; }).join(''));
      screen(tier, 'today', sinceVisitWords(data.games.filter(function (g) { return g.syn; }).slice(0, 3)));
      ui.view = 'train';
    });
  };
  since({ n: 4 });
  since({ n: 24, halved: true }, function () { data.games.forEach(function (g) { if (g.syn && g.oppR) g.oppR += 150; }); });
  data.games = keep; modelDirty();
  if (start0) store.set(startKey(), start0); else store.del(startKey());
  store.set(srsKey(), JSON.parse(srs0)); srsMem = null; srsRevision++;
  el = el0;
  return JSON.stringify({ frames: frames, screens: screens, habits: habits });
})()`;

module.exports = function copyLint(A, OPEN, FRAMES) {
  const r = JSON.parse(A.ev(COLLECT(OPEN, FRAMES)));
  const found = new Set(), habit = new Set(), routine = new Set();
  const add = (tier, rule, where, s) => found.add(tier + '|' + rule + '|' + where + '|' + generic(s));
  const check = (tier, where, s) => {
    if (OLD_HABITS.some((h) => s.indexOf(h) >= 0) || OLD_ASK.test(s)) habit.add(tier + '|' + where + '|' + s);
    if (tier === 1 && s.indexOf(ROUTINE) >= 0) routine.add(where + '|' + s);
    EVERY.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
    if (tier !== 1) return;
    T1.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
    if (BAND[where]) T1_BAND.forEach(([n, re]) => { if (re.test(s)) add(tier, n, where, s); });
  };
  let strings = 0;
  r.frames.forEach(([tier, key, what, row1, row2, cap, chip, buttons, strip, label, tag]) => {
    const parts = { row1, row2, cap, chip, tag, strip, label };
    buttons.forEach((b) => check(tier, 'button', b));
    Object.keys(parts).forEach((w) => {
      if (!parts[w]) return;
      strings++;
      check(tier, w, parts[w]);
      const cap = CAPS[w];
      if (cap && (len(parts[w]) > cap[0] || words(parts[w]) > cap[1])) add(tier, 'caps', w, parts[w]);
    });
    const n = [row1, row2, cap, chip, tag, strip, label].concat(buttons).reduce((x, s) => x + words(s), 0);
    if (n > 15) add(tier, 'over 15 words', what.replace(/\d+/g, 'N'), [row1, row2, cap, chip, tag, strip, label].concat(buttons).filter(Boolean).join(' / '));
  });
  r.screens.forEach(([tier, where, s]) => { strings++; check(tier, where, s); });
  r.habits.forEach(([tier, key, d, s]) => { if (!d || !s || d !== s) add(tier, 'two check lines', 'details/summary', d + ' | ' + s); });
  if (process.env.NL_LINT_WRITE) {
    fs.writeFileSync(BASE, JSON.stringify({ note: 'Copy lint baseline (test/copylint.js): violations still on screen, tier|rule|where|template. It only shrinks.', known: [...found].sort() }, null, 1) + '\n');
  }
  const base = fs.existsSync(BASE) ? new Set(JSON.parse(fs.readFileSync(BASE, 'utf8')).known) : new Set();
  const fresh = [...found].filter((v) => !base.has(v)).sort(), gone = [...base].filter((v) => !found.has(v)).sort();
  /* F1.6: the card's own strings at tier 1 (its rows, chip, caption, strip, buttons and board label) */
  const CARD = { row1: 1, row2: 1, chip: 1, tag: 1, cap: 1, strip: 1, label: 1, button: 1 };
  const t1card = [...found].filter((v) => { const f = v.split('|'); return f[0] === '1' && f[1] !== 'caps' && f[1] !== 'over 15 words' && CARD[f[2]]; }).sort();
  /* F6.1: Insights (with how we count and since you started) at every tier */
  const ins = [...found].filter((v) => v.split('|')[2] === 'insights').sort();
  return { found: found.size, fresh, gone, t1card, ins, habit: [...habit].sort(), routine: [...routine].sort(), habits: r.habits.length, strings, frames: r.frames.length };
};
