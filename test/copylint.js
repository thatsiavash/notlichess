// Copy lint: every word the fixture's cards put on screen (band rows, chips, captions, buttons, the strip,
// board labels, Details, the ••• menu), and Today, the summary and Insights through the stubbed DOM, at
// tiers 1, 2 and 3 (exploring's rows need the engine's lines and are not read here),
// checked against each tier's banned words, the card's caps and one check line per card. Run from
// labels.test.js on its realm: copyLint(A, OPEN, FRAMES) walks every frame of every card (labels.test.js's
// eachFrame) and returns { found, fresh, gone, t1card, habit, routine, habits, strings, frames }.
//   Banned at every tier: session, solved, leak, engine, on top (content's review of slice 1), "!",
//   the em dash, and climbing, held and "to go" (V4.8: progress words nobody misreads). A summary line
//   never starts with "Then" (V4.3: the headline's second line says what happened, not "Then ...").
//   Banned at tier 1: material, balanced, level, advantage, slip, percentages; and in band rows
//   and captions only (names such as "Other tactics" elsewhere stay): tactic, decided and notation
//   (a SAN move; a square alone, "on f2", is no notation).
//   Caps: row 1 26 characters; row 2 40 characters and 7 words; a caption 60 and 8; a chip 14 and 3; at
//   most 15 words in a still frame (rows, chip, tag row, caption, strip, buttons, board label). A move in words
//   counts as one word; a piece of the ledger ("lost ♕♗ for ♜") no word, and two characters.
//   One check line per card (F2.3): Details says the line the summary shows for it, and no screen holds
//   an old habit sentence (the 22 habit lines and the hint fallbacks they replaced: `habit`, never on the
//   baseline); tier 1 never shows the routine line (`routine`).
// No string read carries a program value (`prog`: null, undefined, NaN or "[object", release gate 1's
// "b3null"), never on the baseline: every string above, and for this alone every frame's board
// description and live region and the Details of answered frames the rules do not read.
// A violation is kept as "tier|rule|where|template" (moves, pieces, squares, numbers and opponents made
// generic), against the baseline in data/copylint-baseline.json: today's violations, so a new one fails
// and one that went away must leave the baseline too (it only shrinks; the card strings and Insights
// are clear: `t1card`, `ins`). NL_LINT_WRITE=1 node test/labels.test.js writes the baseline afresh.
// Insights is read with how we count, each skill's sheet (and filtered to each kind) and, after every frame, since you started in both its states (with
// how we count's line on the start day's threshold).
// Beginner teaching (slice 9), at tiers 1 and 2: every lesson's three frames and its own position, every
// practice position's frames (open, hints, a miss and its reason, a close move, found and settled, the
// answer shown), their Details and menu; the pack's end, the skill tiles, each skill's card, the pack
// offer, a Today summary with practice and Settings' Help.
// V4.2 to V4.5 (at every tier): the retry note, the welcome back and the recall line after a break, a
// short week on Today, in the goal met and in Settings, the backup prompt in Safari on an iPhone, the
// last save and the Reset block's second taps. V5.8 and the usage line (at every tier): Settings' Your
// data block, the landing, the footer and the empty name's words. The Games tab (release 2 slice D, at
// every tier): its rows, its filters keeping some and none, a check running and one failed, no games.
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, 'data', 'copylint-baseline.json');

const EVERY = [['session', /\bsessions?\b/i], ['solved', /\bsolved\b/i], ['leak', /\bleaks?\b/i], ['engine', /\bengines?\b/i], ['on top', /\bon top\b/i], ['exclamation', /!/], ['em dash', /\u2014/],
  ['climbing', /\bclimbing\b/i], ['held', /\bheld\b/i], ['to go', /\bto go\b/i]];
const T1 = [['material', /\bmaterial\b/i], ['balanced', /\bbalanced\b/i], ['level', /\blevel\b/i],
  ['advantage', /\badvantages?\b/i], ['slip', /\bslip(s|ped|ping)?\b/i], ['percentage', /\d\s?%/]];
/* SAN with a piece letter, a pawn's capture, a promotion or castling */
const SAN = /(?:\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\b[a-h][18]=[QRBN]|\bO-O(?:-O)?)[+#]?/;
const T1_BAND = [['tactic', /\btactic(s|al)?\b/i], ['decided', /\bdecided\b/i], ['notation', SAN]];
const BAND = { row1: 1, row2: 1, chip: 1, tag: 1, cap: 1 };
const MOVE_WORDS = /\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling(?: on the (?:king|queen)'s side)?/gi;
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
  var frames = [], screens = [], habits = [], seen = {}, progs = [];
  /* read for a program value only (null, undefined, NaN: release gate 1's "b3null"): the board's
     description on every frame, and Details on the answered frames the other rules do not read */
  var prog = function (tier, key, what, s) { if (s) progs.push([tier, key, what, String(s)]); };
  var aria = function (tier, key, what, a) { try { var f = boardOptsFor(a); prog(tier, key, what + ', board description', boardAria(a, f.st, f.opts)); } catch (e) { prog(tier, key, what + ', board description', 'undefined: ' + e.message); } };
  /* a practice position's frames (F9.4) and a lesson's (F9.3), its own position after it */
  var eachPracFrame = function (key, cb) {
    var it = itemOf(key);
    if (!it) return;
    var a = openCard(it);
    cb('prac open', a);
    a.hints = 1; cb('prac hint 1', a); a.hints = 2; cb('prac hint 2', a);
    if (hintMax(a) === 3) { a.hints = 3; cb('prac hint 3', a); }
    a = openCard(it);
    var off = legalMoves(a.st).filter(function (m) { var u = moveUci(m); return it.ok.indexOf(u) < 0 && it.cl.indexOf(u) < 0; });
    if (off.length) {
      a.tapped = true; gradeMove(off[0]); a.animMove = null;
      cb('prac miss', a); a.reason = 2; cb('prac miss, its reason said', a);
      if (a.tried.reply) { seeIt(); a.animMove = null; cb('prac See it, landed', a); }
      tryAgain(); a.triedHold = false; cb('prac after Try again', a);
    }
    if (it.cl.length) { a = openCard(it); a.tapped = true; gradeMove(uciToMove(a.st, it.cl[0])); a.animMove = null; cb('prac close', a); }
    a = openCard(it); a.tapped = true; gradeMove(uciToMove(a.st, it.ok[0])); a.animMove = null;
    cb('prac found', a); a.settle = 2; cb('prac settled', a);
    a = openCard(it); reveal(); a.animMove = null; cb('prac shown', a); playIt(false); a.animMove = null; a.settle = 2; cb('prac shown, settled', a);
  };
  var eachLessonFrame = function (k, cb) {
    var sk = PSKILL_OF[k], keys = ['ls:' + k, 'pk:' + sk.tryId];
    ui.session = { mode: 'pack', label: sk.name, keys: keys, idx: 0, results: {}, relearn: [], relearnOf: {}, spec: { type: 'pack', k: k } };
    var a = cardFor(itemOf(keys[0]));
    ui.session.active = a;
    for (var i = 0; i < 3; i++) { a.lesson.i = i; a.animMove = null; cb('lesson ' + i, a); }
    ui.session.idx = 1;
    var b = cardFor(itemOf(keys[1]));
    b.lessonTry = lessonTryOf(ui.session, keys[1]);
    ui.session.active = b;
    cb('lesson try open', b);
    b.tapped = true; gradeMove(uciToMove(b.st, b.bestUci)); b.animMove = null; b.settle = 2; cb('lesson try settled', b);
  };
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
        aria(tier, it.key, what, a); prog(tier, it.key, what + ', live region', d.live);
        if (/^(shown, played|game shown|found)$/.test(what) && a.phase === 'done') prog(tier, it.key, what + ', Details', bits(detailsHtml()).join(' / '));
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
    /* foils (F8.2), at tiers 2 and 3: every frame of eight of them, their Details and menu */
    var fk = tier >= 2 ? foilPool().slice(0, 8).map(function (f) { return f.key; }) : [];
    fk.forEach(function (key) {
      eachFoilFrame(key, function (what, a) {
        var d = displayFor(a), lb = null;
        try { lb = frameLabel(a, boardOptsFor(a), 360, false); } catch (e) {}
        frames.push([tier, key, what, d.row1, d.row2, d.cap, d.chip, d.buttons.map(function (b) { return b.label; }), bits(d.strip).join(' '), lb ? lb.text : '', d.tag]);
        aria(tier, key, what, a);
        if (what === 'foil open' || what === 'foil settled') screen(tier, 'menu', menuHtml(a));
        if (what === 'foil settled') screen(tier, 'details', detailsHtml());
      });
    });
    /* beginner teaching (slice 9), at tiers 1 and 2; the skill store put back after */
    if (tier <= 2) {
      var sk0 = store.get(skillKey(), null);
      var push = function (key, what, a) {
        var d = displayFor(a), lb = null;
        try { lb = frameLabel(a, boardOptsFor(a), 360, false); } catch (e) {}
        /* (a practice position's source line, beside its tag, is read with the strip's words) */
        frames.push([tier, key, what, d.row1, d.row2, d.cap, d.chip, d.buttons.map(function (b) { return b.label; }), bits(d.strip).concat(d.src ? [d.src] : []).join(' '), lb ? lb.text : '', d.tag]);
      };
      PSKILL.forEach(function (sk) { eachLessonFrame(sk.k, function (what, a) { push('ls:' + sk.k, what, a); }); });
      PRAC_DATA.forEach(function (row) {
        var key = 'pk:' + row.split('|')[0];
        eachPracFrame(key, function (what, a) {
          push(key, what, a);
          if (what === 'prac open') screen(tier, 'menu', menuHtml(a));
          if (what === 'prac settled') { screen(tier, 'details', detailsHtml()); screen(tier, 'menu', menuHtml(a)); }
        });
      });
      var pks = ['pk:free-1', 'pk:free-2', 'pk:m16b', 'pk:free-3', 'pk:free-4'], pr = { mode: 'pack', label: 'Free pieces', keys: pks, idx: 5, results: {}, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true, spec: { type: 'pack', k: 'free' } };
      [['first', 'first'], ['first', 'first'], ['retry', 'miss'], ['hint', 'hint'], ['fail', 'shown']].forEach(function (x, i) { pr.results[pks[i]] = x[0]; pr.sum[pks[i]] = { c: x[1], s: 0, fc: '', prac: 1, sk: 'free' }; });
      screen(tier, 'summary', doneHtml(pr));
      pr.packUp = true; screen(tier, 'summary', doneHtml(pr)); pr.packUp = false; pr.packDown = true; screen(tier, 'summary', doneHtml(pr)); pr.packDown = false; pr.packMastered = 'free'; screen(tier, 'summary', doneHtml(pr));
      screen(tier, 'summary', doneHtml({ mode: 'pack', label: 'Free pieces', keys: ['ls:free', 'pk:free-1'], idx: 2, results: { 'ls:free': 'lesson' }, notes: {}, sum: {}, relearn: [], relearnOf: {}, finished: true, spec: { type: 'pack', k: 'free', lesson: 1 } }));
      screen(tier, 'insights', skillTilesHtml());
      PSKILL.forEach(function (sk) { screen(tier, 'insights', skillSheetHtml(sk.k)); });
      screen(tier, 'today', packOfferHtml());
      var hb = /<div class="set-block"><span class="kicker">Help<\\/span>[\\s\\S]*?<\\/div><div class="set-block">/.exec(settingsHtml());
      screen(tier, 'settings', hb ? hb[0] : 'no Help block');
      if (sk0) store.set(skillKey(), sk0); else store.del(skillKey());
    }
    ui.session = null;
    screen(tier, 'today', heroHtml() + whyTheseHtml(todayPlan()) + focusHtml() + nextDueHtml());
    /* the Games tab (release 2 slice D): its rows (two positions learned or in practice), a filter that
       keeps some, one that keeps none, a check for new games running and one that failed (F10), and a
       player with no games yet; what each set up is put back */
    var srsG = JSON.stringify(store.get(srsKey(), {})), gf0 = ui.gf, gs0 = data.games, sec0 = data.sections.games, re0 = data.refreshErr;
    var two = allMistakes().filter(trainable).slice(0, 2), srsNowG = srsLoad();
    srsNowG[two[0].key] = { box: 5, streak: 3, due: Date.now() + 60 * DAY, last: Date.now(), lapses: 0, learned: true, n: 3 };
    srsNowG[two[1].key] = { box: 1, streak: 1, due: Date.now() + DAY, last: Date.now(), lapses: 0, n: 1 };
    srsSave(srsNowG);
    screen(tier, 'games', gamesHtml());
    gamesFilterSet({ r: 'loss', p: 'cost' }); screen(tier, 'games', gamesHtml());
    gamesFilterSet({ r: 'draw', p: 'clean' }); screen(tier, 'games', gamesHtml());
    gamesFilterSet({}); data.sections.games = 'loading'; screen(tier, 'games', gamesHtml());
    data.sections.games = 'ok'; data.refreshErr = { site: 'chess.com', busy: true }; screen(tier, 'games', gamesHtml());
    data.refreshErr = { site: 'chess.com' }; screen(tier, 'games', gamesHtml());
    data.refreshErr = re0; data.games = []; screen(tier, 'games', gamesHtml());
    data.games = gs0; data.sections.games = sec0; ui.gf = gf0; store.set(srsKey(), JSON.parse(srsG)); srsMem = null; srsRevision++;
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
    /* V4.2 to V4.5: the retry note, the welcome back, the recall line after a break (most found, then
       under half), a short week (Today, the goal met, Settings), the backup prompt in Safari on an
       iPhone, the last save and the Reset block armed */
    screen(tier, 'card', '<p>' + RETRY_NOTE + '</p>');
    screen(tier, 'today', '<p>' + WELCOME + '</p>');
    var rs = { recall: 14, rev: {}, sum: {} };
    ks.forEach(function (k, i) { rs.rev[k] = 1; rs.sum[k] = { c: i < 3 ? 'first' : 'miss' }; });
    screen(tier, 'summary', recallHtml(rs, ks, tier));
    ks.forEach(function (k) { rs.sum[k] = { c: 'shown' }; });
    screen(tier, 'summary', recallHtml(rs, ks, tier));
    var wgi = weekGoalInfo;
    ['first', 'back'].forEach(function (cut) {
      weekGoalInfo = function () { return { goal: 2, cut: cut }; };
      screen(tier, 'today', weekHtml());
      screen(tier, 'summary', '<p>' + goalMetWords({ days: 2, goal: 2, cut: cut }) + '</p>');
      screen(tier, 'settings', weekGoalLine());
    });
    weekGoalInfo = wgi;
    var ua0 = navigator.userAgent;
    navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'; screen(tier, 'summary', cueCardHtml({ cue: 'backup' })); navigator.userAgent = ua0;
    screen(tier, 'settings', '<p>' + lastSavedWords() + '</p>');
    ui.wipeArmed = ui.resetArmed = true;
    var dz = /<div class="set-block"><span class="kicker">Reset<\\/span>[\\s\\S]*$/.exec(settingsHtml());
    screen(tier, 'settings', dz ? dz[0] : 'no Reset block');
    ui.wipeArmed = ui.resetArmed = false;
    /* V5.8 and the usage line (release 2 slice D: Clarity said, never asked): Settings' Your data
       block, the landing (its line under the form), the footer and the empty name's words */
    var yd = /<div class="set-block"><span class="kicker">Your data<\\/span>[\\s\\S]*?(?=<div class="set-block"><span class="kicker">Reset)/.exec(settingsHtml());
    screen(tier, 'settings', yd ? yd[0] : 'no Your data block');
    var nt0 = notice;
    notice = function (s) { screen(tier, 'landing', '<p>' + s + '</p>'); };
    el = function (id) { return id === 'insightsbox' || id === 'main' || id === 'foot' ? box : el0(id); };
    box.innerHTML = ''; renderFirstVisit(); screen(tier, 'landing', box.innerHTML);
    box.innerHTML = ''; renderFoot(); screen(tier, 'foot', box.innerHTML);
    findUser('');
    el = function (id) { return id === 'insightsbox' ? box : el0(id); };
    notice = nt0;
    /* a set with foils: their line and tiles (F8.2) */
    if (fk.length >= 3) {
      var fs = { mode: 'today', label: 'Today', keys: ks.concat(fk.slice(0, 3)), idx: ks.length + 3, results: {}, notes: { }, sum: {}, relearn: [], relearnOf: {}, finished: true };
      ks.forEach(function (k, i) { fs.results[k] = res[i]; });
      fs.notes[ks[3]] = 'shown';
      [['first', { c: 'first', s: 3, fc: '', foil: 1, fk: 'good' }], ['retry', { c: 'miss', s: 1, fc: '3', foil: 1, fk: 'playable' }], ['fail', { c: 'shown', s: 0, fc: '', foil: 1 }]].forEach(function (x, i) { fs.results[fk[i]] = x[0]; fs.sum[fk[i]] = x[1]; });
      screen(tier, 'summary', doneHtml(fs));
    }
    ui.view = 'insights'; box.innerHTML = '';
    renderInsights();
    screen(tier, 'insights', box.innerHTML);
    screen(tier, 'insights', sheetHtml('count'));
    /* each skill's sheet, and filtered to each of its kinds (slice E) */
    insightReport().families.forEach(function (agg) {
      screen(tier, 'insights', sheetHtml('family:' + agg.fam.key));
      kindsOf(agg).forEach(function (s) { screen(tier, 'insights', sheetHtml('family:' + agg.fam.key + ':' + s.key)); });
    });
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
  return JSON.stringify({ frames: frames, screens: screens, habits: habits, progs: progs });
})()`;
/* a program value, as the app's own guard reads one (progVal, 13y-story.js): null, undefined or NaN with no
   lowercase letter on either side ("b3null" is one, "annulled" none), or "[object " */
const PROG = /(^|[^a-z])(null|undefined|NaN)(?![a-z])|\[object /;

/* the banned-word rules one string breaks, by tier and where it shows (V4.3's and V4.8's acceptance
   reads them too): every tier's, a summary line starting "Then", tier 1's, and tier 1's in the band */
function rulesOf(tier, where, s, chip) {
  const out = [];
  EVERY.forEach(([n, re]) => { if (re.test(s)) out.push(n); });
  if (where === 'summary' && /^Then\b/.test(s)) out.push('then');
  /* V2.5: every percentage on a card or in Details is labelled ("Your chances: 49% before, 35%
     after.", or the chip "Your chances" beside a tier 3 frame's figures) */
  if ((BAND[where] || where === 'details') && /\d\s?%/.test(s) && !/chances/i.test(s) && chip !== FIG_CHIP) out.push('unlabelled %');
  if (tier !== 1) return out;
  T1.forEach(([n, re]) => { if (re.test(s)) out.push(n); });
  if (BAND[where]) T1_BAND.forEach(([n, re]) => { if (re.test(s)) out.push(n); });
  /* V2.5: tier 1's Details in words: no notation there either (a square alone is none) */
  if (where === 'details' && SAN.test(s)) out.push('notation');
  return out;
}
const FIG_CHIP = 'Your chances';

module.exports = function copyLint(A, OPEN, FRAMES) {
  const r = JSON.parse(A.ev(COLLECT(OPEN, FRAMES)));
  const found = new Set(), habit = new Set(), routine = new Set();
  /* every string read (the frames' rows, chip, caption, strip, label, tag and buttons, every screen, the
     check lines, and the board descriptions, live regions and Details read for this alone) that carries a
     program value: never on the baseline */
  const prog = new Set();
  let progRead = 0;
  const progOf = (tier, key, where, s) => { progRead++; if (PROG.test(String(s))) prog.add(tier + '|' + key + '|' + where + '|' + s); };
  r.frames.forEach(([tier, key, what, row1, row2, cap, chip, buttons, strip, label, tag]) => {
    [row1, row2, cap, chip, strip, label, tag].concat(buttons).forEach((s) => { if (s) progOf(tier, key, what, s); });
  });
  r.screens.forEach(([tier, where, s]) => progOf(tier, '', where, s));
  r.habits.forEach(([tier, key, d, s]) => { progOf(tier, key, 'details check line', d); progOf(tier, key, 'summary check line', s); });
  r.progs.forEach(([tier, key, what, s]) => progOf(tier, key, what, s));
  const add = (tier, rule, where, s) => found.add(tier + '|' + rule + '|' + where + '|' + generic(s));
  const check = (tier, where, s, chip) => {
    if (OLD_HABITS.some((h) => s.indexOf(h) >= 0) || OLD_ASK.test(s)) habit.add(tier + '|' + where + '|' + s);
    if (tier === 1 && s.indexOf(ROUTINE) >= 0) routine.add(where + '|' + s);
    rulesOf(tier, where, s, chip).forEach((n) => add(tier, n, where, s));
  };
  let strings = 0;
  r.frames.forEach(([tier, key, what, row1, row2, cap, chip, buttons, strip, label, tag]) => {
    const parts = { row1, row2, cap, chip, tag, strip, label };
    buttons.forEach((b) => check(tier, 'button', b));
    Object.keys(parts).forEach((w) => {
      if (!parts[w]) return;
      strings++;
      check(tier, w, parts[w], chip);
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
  return { found: found.size, fresh, gone, t1card, ins, habit: [...habit].sort(), routine: [...routine].sort(), habits: r.habits.length, strings, frames: r.frames.length,
    prog: [...prog].sort(), progRead, arias: r.progs.filter((p) => /board description$/.test(p[2])).length };
};
module.exports.rulesOf = rulesOf;
module.exports.PROG = PROG;
