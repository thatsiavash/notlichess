// Design system v2, Night (F3.1): the checks behind "a new look everywhere". Run from labels.test.js:
// require('./design')(A) returns the failures (an empty list when all hold), A being a booted app realm.
//   Type: Nunito from this site (V5.4: fonts/, one variable woff2 beside the OFL, 500 to 900, display optional,
//   preloaded; Google's font hosts named nowhere), the seven size tokens
//   with the design lead's values on phones and from 861 px, and every font-size in app.css one of them; the
//   body at 500, the small size never 800, and 12 px only for kickers, tags, pills, the key line, the menu's
//   keys, the eval bar and board labels (the design lead's review of slice 3).
//   Colour: the palette's values; every pair in use passes contrast (text 4.5:1; borders, glyphs and bold
//   board coordinates 3:1), tints counted over the surface they sit on; no colour outside the tokens.
//   Buttons, icons, glyphs: the honey primary with its lip, the filled secondary, the honey tertiary, the
//   2 px press; an icon for every bar action that names one; the seven result glyphs, one for each of the
//   summary's categories; the found and shown badges told apart by shape.
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');

const PALETTE = { '--bg': '#141310', '--surface-1': '#1F1D19', '--surface-2': '#2A2722', '--border': '#7A7364', '--text-1': '#F4F0E8', '--text-2': '#CFC8BA', '--text-3': '#A39C8E',
  '--honey': '#F2B544', '--on-honey': '#241800', '--honey-lip': '#B9852A', '--leaf': '#5BC98C', '--leaf-lip': '#3A9A66', '--coral': '#FF7B66', '--coral-lip': '#C9503F', '--slate': '#8EA7C7', '--lip-2': '#7A7364' };
/* size/line-height, phone then desktop (861 px and up) */
const TYPE = { score: [44, 48, 56, 60], title: [28, 32, 32, 38], verdict: [22, 28, 24, 30], heading: [18, 24, 20, 26], body: [16, 24, 17, 26], small: [14, 20, 14, 20], tag: [12, 16, 12, 16] };

const rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const parseColor = (v) => { v = v.trim(); if (v[0] === '#') return { c: rgb(v), a: 1 }; const m = /^rgba?\(([^)]+)\)$/.exec(v); if (!m) return null; const p = m[1].split(',').map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const over = (fg, bg) => fg.c.map((v, i) => Math.round(v * fg.a + bg[i] * (1 - fg.a)));

/* the custom properties of the first :root block, and of the :root inside @media (min-width:861px) */
function tokens(css) {
  const out = { phone: {}, desk: {} };
  const read = (block, into) => block.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { into[k] = v.trim(); return m; });
  const first = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (first) read(first[1], out.phone);
  const desk = /@media \(min-width:861px\)\{\s*:root\{([\s\S]*?)\}\s*\}/.exec(css);
  if (desk) read(desk[1], out.desk);
  return out;
}

module.exports = function designChecks(A) {
  const fails = [];
  const no = (what) => fails.push(what);
  const css = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8'), page = fs.readFileSync(path.join(SRC, 'page.html'), 'utf8');
  const T = tokens(css), P = T.phone;
  /* outside :root: the rules the page draws with (comments dropped) */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[^}]*\}/g, '');

  /* ── type ── */
  /* Nunito from this site (V5.4): nothing from Google's font hosts, no stylesheet link; one @font-face, the
     weights in use (500 to 900), display optional, its woff2 in fonts/ with the OFL beside it, and the page
     preloads that very file */
  if (/fonts\.(googleapis|gstatic)\.com/.test(page + css)) no('fonts: Google\'s font hosts are still named');
  const sheets = page.match(/<link rel="stylesheet"[^>]*>/g) || [];
  if (sheets.length) no('fonts: a stylesheet link: ' + sheets.join(' '));
  const faces = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/@font-face\{[^}]*\}/g) || [], face = faces[0] || '';
  const woff = /src:url\((fonts\/[\w.-]+\.woff2)\) format\("woff2"\)/.exec(face);
  if (faces.length !== 1 || !/font-family:"Nunito"/.test(face) || !/font-weight:500 900/.test(face) || !/font-display:optional/.test(face) || !woff) no('fonts: one @font-face, Nunito 500 to 900 from fonts/, display optional: ' + faces.join(' '));
  const ROOT = path.join(SRC, '..'), bytes = woff && fs.existsSync(path.join(ROOT, woff[1])) ? fs.readFileSync(path.join(ROOT, woff[1])) : null;
  if (woff && (!bytes || bytes.slice(0, 4).toString('latin1') !== 'wOF2')) no('fonts: ' + woff[1] + ' is not a woff2 file in the repo');
  const ofl = path.join(ROOT, 'fonts', 'OFL.txt');
  if (!fs.existsSync(ofl) || !/^Copyright .*Nunito Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/.test(fs.readFileSync(ofl, 'utf8'))) no('fonts: the licence beside the font (fonts/OFL.txt: the copyright notice and the OFL 1.1)');
  const pre = page.match(/<link rel="preload"[^>]*>/g) || [];
  if (pre.length !== 1 || !woff || pre[0] !== '<link rel="preload" href="' + woff[1] + '" as="font" type="font/woff2" crossorigin>') no('fonts: one preload, of the file app.css declares: ' + pre.join(' '));
  if (/Cormorant|Lora|Georgia/.test(page + css)) no('fonts: an old family is still named');
  if (!/^"Nunito",/.test(P['--font'] || '') || !/sans-serif$/.test(P['--font'] || '')) no('fonts: the stack starts with Nunito and ends on sans-serif: ' + P['--font']);
  Object.keys(TYPE).forEach((k) => {
    const v = TYPE[k], fsP = P['--fs-' + k], lhP = P['--lh-' + k], fsD = T.desk['--fs-' + k] || fsP, lhD = T.desk['--lh-' + k] || lhP;
    if (fsP !== v[0] + 'px' || lhP !== v[1] + 'px' || fsD !== v[2] + 'px' || lhD !== v[3] + 'px') no('type: ' + k + ' is ' + [fsP, lhP, fsD, lhD].join('/') + ', not ' + v.join('/'));
  });
  if (Object.keys(P).filter((k) => /^--fs-/.test(k)).length !== 7) no('type: seven size tokens, found ' + Object.keys(P).filter((k) => /^--fs-/.test(k)).join(' '));
  const sizes = [];
  rules.replace(/font-size\s*:\s*([^;}]+)/g, (m, v) => { sizes.push(v.trim()); return m; });
  const off = sizes.filter((v) => !/^var\(--fs-(score|title|verdict|heading|body|small|tag)\)$/.test(v));
  if (!sizes.length || off.length) no('type: every font-size is a token, ' + off.length + ' are not: ' + off.slice(0, 5).join(', '));
  if (/[^-]font\s*:\s*(?!inherit)[^;}]*\d/.test(rules)) no('type: a font shorthand sets a size outside the tokens');
  /* the weights (review of slice 3): body 500; small text 600 or 700 (700 for emphasis and controls), never 800
     (a game's result letter in its disc is a glyph, not text) */
  if (!/(^|[}\s])body\{[^}]*font-weight:500[;}]/.test(rules)) no('type: the body is not 500');
  const heavySmall = [];
  rules.replace(/([^{}]+)\{([^}]*font-size\s*:\s*var\(--fs-small\)[^}]*)\}/g, (m, sel, body) => { if (/font-weight\s*:\s*(800|900)/.test(body) && sel.trim() !== '.lg-res') heavySmall.push(sel.trim()); return m; });
  if (heavySmall.length) no('type: small text at 800 or more: ' + heavySmall.slice(0, 5).join(', '));
  /* 12 px only where the words are not meant to be read as text: kickers, tags and pills, the key line, the
     menu's keys, the eval bar's label, board labels */
  const TAG_OK = /^(\.kicker|\.pill|\.tag|\.keyline|\.menu-keys|\.evalbar-label|\.blabel|\.proof figcaption|\.xp-label)$/;
  const tiny = [];
  rules.replace(/([^{}]+)\{([^}]*font-size\s*:\s*var\(--fs-tag\)[^}]*)\}/g, (m, sel, body) => { sel.split(',').map((x) => x.trim().replace(/^@media[^{]*\{\s*/, '')).forEach((x) => { if (!TAG_OK.test(x)) tiny.push(x); }); return m; });
  if (tiny.length) no('type: meaningful text at 12 px: ' + tiny.slice(0, 5).join(', '));
  /* the page's own markup and scripts set no size of their own (the board's coordinates are board units) */
  const js = fs.readdirSync(path.join(SRC, 'js')).filter((f) => /\.js$/.test(f)).map((f) => fs.readFileSync(path.join(SRC, 'js', f), 'utf8')).join('\n');
  if (/font-size\s*:/.test(js) || /font-size\s*:/.test(page.replace(/<style>[\s\S]*<\/style>/, ''))) no('type: a font-size set outside app.css');

  /* ── colour ── */
  Object.keys(PALETTE).forEach((k) => { if ((P[k] || '').toUpperCase() !== PALETTE[k]) no('colour: ' + k + ' is ' + P[k] + ', not ' + PALETTE[k]); });
  const C = (k) => { const v = P['--' + k]; const p = v && parseColor(v); if (!p) throw new Error('no colour token --' + k); return p; };
  const solid = (k) => C(k).c, tint = (k, on) => over(C(k), solid(on));
  const pair = (fg, bg, min, what) => { const r = ratio(fg, bg); if (r < min) no('contrast: ' + what + ' ' + r.toFixed(2) + ':1, under ' + min + ':1'); };
  const SURF = ['bg', 'surface-1', 'surface-2'];
  ['text-1', 'text-2', 'text-3', 'honey', 'leaf', 'coral', 'slate'].forEach((t) => SURF.forEach((s) => pair(solid(t), solid(s), 4.5, t + ' on ' + s)));
  pair(solid('on-honey'), solid('honey'), 4.5, 'a primary label on honey');
  pair(solid('on-honey'), solid('honey-hover'), 4.5, 'a primary label on honey, hovered');
  ['leaf', 'coral', 'slate'].forEach((g) => pair(solid('ink'), solid(g), 4.5, 'dark ink on a ' + g + ' glyph'));
  SURF.forEach((s) => pair(solid('border'), solid(s), 3, 'the border on ' + s));
  ['leaf', 'coral', 'slate', 'honey', 'text-3'].forEach((g) => ['bg', 'surface-1'].forEach((s) => pair(solid(g), solid(s), 3, 'a ' + g + ' glyph on ' + s)));
  /* a tag's words on its own 14% fill; a state's words on its 10% tint (the band) */
  ['honey', 'leaf', 'coral', 'slate'].forEach((t) => SURF.forEach((s) => pair(solid(t), tint(t + '-14', s), 4.5, t + ' words on its 14% fill over ' + s)));
  ['honey', 'leaf', 'coral', 'slate'].forEach((t) => ['bg', 'surface-1'].forEach((s) => ['text-1', 'text-2', 'honey'].forEach((w) => pair(solid(w), tint(t + '-10', s), 4.5, w + ' on the ' + t + ' 10% tint over ' + s))));
  /* a board label: its mark's colour on the dark pill, over the lightest square */
  ['coral', 'leaf', 'slate', 'honey'].forEach((t) => pair(solid(t), over(C('pill-bg'), [240, 217, 181]), 4.5, 'a ' + t + ' board label'));
  /* no colour of its own outside the tokens: hex only in :root, rgba only as black for shadows */
  const hex = rules.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgbas = (rules.match(/rgba?\([^)]*\)/g) || []).filter((v) => !/^rgba\(0,\s*0,\s*0,\s*[\d.]+\)$/.test(v));
  if (hex.length || rgbas.length) no('colour: literals outside the tokens: ' + hex.concat(rgbas).slice(0, 5).join(' '));

  /* ── buttons ── */
  const has = (re, what) => { if (!re.test(rules)) no('buttons: ' + what); };
  has(/\.btn-big\{background:var\(--honey\);color:var\(--on-honey\);border:0;box-shadow:0 4px 0 var\(--honey-lip\)/, 'the primary is honey with a 4 px lip');
  has(/\.btn-line\{background:var\(--surface-2\);color:var\(--text-1\);border:2px solid var\(--border\);box-shadow:0 4px 0 var\(--lip-2\)/, 'the secondary is filled, with a 2 px border and its lip');
  has(/\.btn-quiet\{[^}]*background:none;border:0;[^}]*color:var\(--honey\)/, 'the tertiary is honey words, no fill');
  has(/\.btn-big:active,\.btn-line:active\{transform:translateY\(2px\);transition-duration:60ms\}/, 'a press sinks 2 px in 60 ms');
  has(/border-radius:var\(--r-btn\)/, 'buttons are rounded 14 px');
  if (P['--r-btn'] !== '14px') no('buttons: radius 14, found ' + P['--r-btn']);
  if (!/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*\.btn-big:active,\.btn-line:active,\.nav-btn:active\{transform:none\}\s*\.btn-big:active\{background:var\(--honey-lip\)\}/.test(rules)) no('buttons: under reduced motion a press changes colour instead');
  /* V5.3: a honey button's label stays dark in every state. The link hover lives inside @media (hover:hover)
     and only for a plain link (a:not([class])), so no tap leaves it on a button; and no rule gives a .btn-big
     a text colour other than --on-honey */
  const hov = /@media \(hover:hover\)\{\n([\s\S]*?)\n\}/.exec(rules);
  if (!hov || !/(^|\s)a:not\(\[class\]\):hover\{color:var\(--honey-hover\)\}/.test(hov[1])) no('buttons: the link hover is a:not([class]):hover, inside @media (hover:hover)');
  const outside = rules.replace(/@media \(hover:hover\)\{[^{}]*\{[^}]*\}\}/g, '').replace(/@media \(hover:hover\)\{\n[\s\S]*?\n\}/g, '');
  if (/(^|[{};,])\s*a(:not\([^)]*\))?:hover\s*[{,]/.test(outside)) no('buttons: a link hover outside @media (hover:hover) sticks after a tap, over the honey label');
  const btnInk = [];
  rules.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (/\.btn-big\b/.test(sel) && /(^|;)color:/.test(body) && !/(^|;)color:var\(--on-honey\)/.test(body)) btnInk.push(sel.trim()); return m; });
  if (btnInk.length) no('buttons: a honey button\'s label in another colour: ' + btnInk.join(' | '));

  /* ── icons and glyphs ── */
  const icons = JSON.parse(A.ev('JSON.stringify(BAR_ICON)'));
  ['hint', 'reveal', 'tryAgain', 'seeIt', 'seeWhy', 'next'].forEach((act) => { if (!icons[act]) no('icons: no icon for ' + act); });
  const named = new Set(Object.values(icons).concat(['info', 'search', 'back', 'fwd']));
  named.forEach((n) => { if (!new RegExp('\\[data-icon=' + n + '\\]\\{--ic:var\\(--ic-' + n + '\\)\\}').test(rules) || !/^url\("data:image\/svg\+xml,/.test(P['--ic-' + n] || '')) no('icons: ' + n + ' is not drawn'); });
  const bar = A.ev(`barHtml([{ act: 'hint', label: 'Hint', cls: 'btn-line', off: true }, { act: 'reveal', label: 'Show the answer', cls: 'btn-line' }, { act: 'storyBack', label: '‹', cls: 'nav-btn' }])`);
  /* a lone chevron is drawn as its own icon, its glyph kept as the button's text (review of slice 3) */
  if (!/data-icon="bulb"[^>]*>Hint</.test(bar) || !/data-icon="eye" data-act="reveal">Show the answer</.test(bar) || !/class="nav-btn nav-ic" data-slot="2" data-icon="back" data-act="storyBack">‹</.test(bar)) no('icons: the bar names its icons, on or off, and only for actions that have one, a lone chevron its own: ' + bar);
  ['first', 'good', 'hint', 'miss', 'shown', 'skip', 'learned'].forEach((g) => { if (!new RegExp('\\.rg-' + g + '\\{').test(rules)) no('glyphs: no ' + g + ' glyph'); });
  /* every category of the summary (its tile's word) has its glyph, and a position learned its seal */
  const WANT = { 'First try': 'first', 'Works too': 'first', 'After a good move': 'good', 'With a hint': 'hint', 'First look': 'hint', 'After a miss': 'miss', 'Shown': 'shown', 'Missed': 'skip', 'Skipped': 'skip', 'Learned': 'learned' };
  const cats = JSON.parse(A.ev(`JSON.stringify(Object.keys(CAT_WORD).map(function (c) { return [CAT_WORD[c], resultGlyph(c)]; }).concat([['Learned', resultGlyph('learned')]]))`));
  if (cats.map((x) => x[0]).sort().join('|') !== Object.keys(WANT).sort().join('|')) no('glyphs: the summary\'s words are ' + cats.map((x) => x[0]).join(', '));
  cats.forEach((x) => { if (x[1] !== '<span class="rg rg-' + WANT[x[0]] + '" aria-hidden="true"></span>') no('glyphs: "' + x[0] + '" is drawn as ' + (x[1] || 'nothing')); });
  const badge = JSON.parse(A.ev('JSON.stringify({ g: BADGE_GLYPH, c: MARK_BADGE })'));
  if (badge.g.info === badge.g.good || badge.g.info === 'M0 -4.1 h.01 M0 -1 V4.3' || badge.c.info === badge.c.unchecked) no('glyphs: the shown badge is an eye of its own, not the old grey i');
  /* the board's coordinates: dark brown on light squares (4.5:1), white bold on dark (3:1, bold) */
  const svg = A.ev('boardSvg(stateFromFen("8/8/8/8/8/8/8/8 w - - 0 1"), {})');
  const coords = [];
  svg.replace(/<text [^>]*font-weight="(\d+)"[^>]*fill="([^"]+)"[^>]*>([a-h1-8])<\/text>/g, (m, w, f, t) => { coords.push({ w: +w, f: f, t: t }); return m; });
  const SQ = JSON.parse(A.ev('JSON.stringify([SQ_LIGHT, SQ_DARK])'));
  if (coords.length !== 16) no('board: 16 coordinates, found ' + coords.length);
  const light = coords.filter((k) => k.f.toLowerCase() !== '#ffffff'), dark = coords.filter((k) => k.f.toLowerCase() === '#ffffff');
  if (light.length !== 8 || dark.length !== 8) no('board: half the coordinates on light squares, half on dark: ' + light.length + '/' + dark.length);
  light.forEach((k) => pair(rgb(k.f), rgb(SQ[0]), 4.5, 'a coordinate on a light square'));
  dark.forEach((k) => { pair(rgb(k.f), rgb(SQ[1]), 3, 'a coordinate on a dark square'); if (k.w < 700) no('board: a white coordinate is not bold'); });
  return fails;
};
