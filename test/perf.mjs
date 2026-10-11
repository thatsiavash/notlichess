// Speed on a slowed phone (V5.7). Run by hand, not in npm run check: node test/perf.mjs [port]
// It serves the repo root on a local port (8199 unless one is given), starts headless Chromium (CHROME_PATH,
// else the usual places), and loads the fixture player from test/data/fixture-games.json: chess.com's API is
// answered from here at rating 1600, every other site fails, so no network is needed and the real Stockfish
// in sf/ runs. As a phone at 390 x 844 it measures:
//   1. Today ready (Start or Resume on screen) after a reload, the main thread slowed 6x, three reloads:
//      within 1.2 s (the median; each is printed);
//   2. the first card (its board drawn) after Start, slowed 6x, once after each reload: within 0.5 s;
//   3. a try's verdict on screen (the band's words change once the try is graded), at full speed, Today
//      left open 30 s first so the background check (V1.1) is running where the build has one: the answer
//      on card 1 and the game move on card 2, each within 0.6 s;
//   4. no main-thread task over 200 ms during a set, slowed 4x (long tasks from Start through three tries).
// Prints the numbers and PASS or FAIL for each limit, then the whole as JSON; exits 1 on any FAIL. Run it after
// slices 1, 2 and 5 merge and at the release gate; the numbers go in the build notes. PERF_WAIT=<s> shortens
// step 3's wait (30 s) while trying the probe out.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFile, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.argv[2] || 8199;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const WAIT = (process.env.PERF_WAIT != null ? +process.env.PERF_WAIT : 30) * 1000;
const LIMIT = { today: 1200, card: 500, verdict: 600, task: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* the site as Render serves it: the repo root, by extension, never cached here */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});

/* headless Chromium over the DevTools protocol (Node's own WebSocket), one fresh profile */
const CHROME = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((x) => existsSync(x)) || 'chromium';
async function launch() {
  const port = 9900 + Math.floor(Math.random() * 90), dir = mkdtempSync(join(tmpdir(), 'nl-perf-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 80 && !ws; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch (e) { /* not up yet */ }
    if (!ws) await sleep(250);
  }
  if (!ws) throw new Error('Chromium did not start: ' + CHROME);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map(), subs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); if (d.error) p.j(new Error(JSON.stringify(d.error))); else p.r(d.result); }
    else if (d.method) subs.forEach((f) => f(d.method, d.params));
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  /* Chromium gone, then its profile */
  const close = async () => {
    try { ws.close(); } catch (e) { /* gone */ }
    proc.kill('SIGKILL');
    await new Promise((r) => { if (proc.exitCode != null || proc.signalCode) r(); else { proc.once('exit', r); setTimeout(r, 3000); } });
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* busy */ }
  };
  return { send, ev, on: (f) => subs.push(f), close };
}

/* the fixture player, as a phone: chess.com answered from here, every other site failed */
async function openPlayer(b) {
  const FIX = readFileSync(join(ROOT, 'test', 'data', 'fixture-games.json'), 'utf8');
  const prof = { username: 'tester', avatar: null, joined: 1600000000, last_online: 1790577955 };
  const stats = { chess_rapid: { last: { rating: 1600, date: 1790577955 }, best: { rating: 1650 }, record: { win: 300, loss: 300, draw: 20 } } };
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await b.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  /* every outside site is https: the local server's own requests are never paused */
  await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
  b.on((m, p) => {
    if (m !== 'Fetch.requestPaused') return;
    const u = p.request.url;
    let body = null;
    if (/api\.chess\.com\/pub\/player\/[^/]+\/stats/.test(u)) body = stats;
    else if (/api\.chess\.com\/pub\/player\/[^/]+\/games\/archives/.test(u)) body = { archives: [] };
    else if (/api\.chess\.com\/pub\/player\/[^/]+\/games\//.test(u)) body = { games: [] };
    else if (/api\.chess\.com\/pub\/player\/[^/]+$/.test(u)) body = prof;
    if (body) b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
    else b.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
  });
  /* long tasks, kept from the page's start on every load */
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__lt = []; try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { window.__lt.push(Math.round(e.duration)); }); }).observe({ type: "longtask", buffered: true }); } catch (e) {}' });
  await b.send('Page.navigate', { url: BASE }); await sleep(800);
  await b.ev(`localStorage.clear(); localStorage.setItem('nl:user', '"tester"'); localStorage.setItem('nl:src', '"chesscom"'); localStorage.setItem('nl:games:cc:tester', ${JSON.stringify(FIX)}); 1`);
  await b.send('Page.navigate', { url: BASE }); await sleep(4000);
}

const READY = `(function () { return [].slice.call(document.querySelectorAll('a,button')).some(function (x) { return /^(Start|Resume)$/.test((x.textContent || '').trim()); }); })()`;
const START = `(function () { var a = [].slice.call(document.querySelectorAll('a,button')).filter(function (x) { return /^(Start|Resume)$/.test((x.textContent || '').trim()); })[0]; if (a) a.click(); return !!a; })()`;
const CARD = `(function () { try { return !!(__nlTest.ev('ui.session && ui.session.active') && document.querySelector('#bwrap [data-sq]')); } catch (e) { return false; } })()`;
/* the paused set goes, so the next reload opens on Today's Start */
const UNPAUSE = `(function () { Object.keys(localStorage).filter(function (k) { return /^nl:sess:/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); return 1; })()`;
async function until(b, expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await b.ev(expr).catch(() => false)) return Date.now() - t0; await sleep(10); }
  return null;
}
/* a try on the card shown, timed in the page: from the move to the first change of the band's words once it
   is graded (the verdict on screen); how: 'best' (the answer) or 'game' (the game move) */
const TRY = (how) => `new Promise(function (done) {
  var E = __nlTest.ev, band = document.getElementById('cband'), c = __nlTest.card(), uci = '${how}' === 'best' ? c.best : c.played;
  if (!band || !uci || c.phase !== 'guess') { done({ err: 'not asking: ' + c.phase }); return; }
  var t0 = performance.now(), fin = false;
  var end = function (o) { if (fin) return; fin = true; mo.disconnect(); done(o); };
  var mo = new MutationObserver(function () {
    var ph = E('ui.session.active && ui.session.active.phase');
    if (ph !== 'guess' && ph !== 'checking') end({ ms: Math.round(performance.now() - t0), phase: ph, uci: uci });
  });
  mo.observe(band, { childList: true, subtree: true, characterData: true });
  __nlTest.play(uci);
  setTimeout(function () { end({ err: 'no verdict in 10 s', phase: E('ui.session.active && ui.session.active.phase') }); }, 10000);
})`;
const median = (xs) => { const s = xs.filter((x) => x != null).sort((p, q) => p - q); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const out = { base: BASE, chrome: CHROME, today: [], card: [], verdict: [], tasks: [], pass: {} };
let b = null;
try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  b = await launch();
  await openPlayer(b);
  out.engine = await b.ev(`__nlTest.stats().state`).catch(() => null);
  /* 1 and 2: three reloads at 6x, Today, then the first card */
  await b.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  for (let i = 0; i < 3; i++) {
    await b.ev(UNPAUSE);
    await b.send('Page.reload', { ignoreCache: true });
    out.today.push(await until(b, READY, 15000));
    await sleep(300);
    const t1 = Date.now();
    await b.ev(START);
    out.card.push(await until(b, CARD, 10000) == null ? null : Date.now() - t1);
    await sleep(1500);
  }
  /* 3: full speed, Today open WAIT ms, then the answer on card 1 and the game move on card 2 */
  await b.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await b.ev(UNPAUSE);
  await b.send('Page.reload', { ignoreCache: true });
  await until(b, READY, 15000);
  await sleep(WAIT);
  await b.ev(START);
  await until(b, CARD, 10000);
  await sleep(1200);
  const v1 = await b.ev(TRY('best'));
  out.verdict.push(Object.assign({ card: 1 }, v1));
  await sleep(2500);
  await b.ev(`(function () { var n = [].slice.call(document.querySelectorAll('#cbar [data-act="next"]'))[0]; if (n) n.click(); return !!n; })()`);
  await sleep(1500);
  const v2 = await b.ev(TRY('game'));
  out.verdict.push(Object.assign({ card: 2 }, v2));
  /* 4: 4x, a set from its Start through three tries: no main-thread task over 200 ms */
  await b.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await b.ev(UNPAUSE);
  await b.send('Page.reload', { ignoreCache: true });
  await until(b, READY, 20000);
  await sleep(1500);
  await b.ev('window.__lt = []; 1');
  await b.ev(START);
  await until(b, CARD, 15000);
  for (let k = 0; k < 3; k++) {
    await sleep(1800);
    await b.ev(TRY('best')).catch(() => null);
    await sleep(2500);
    await b.ev(`(function () { var n = [].slice.call(document.querySelectorAll('#cbar [data-act="next"]'))[0]; if (n) n.click(); return !!n; })()`);
  }
  await sleep(1000);
  out.tasks = await b.ev('window.__lt.slice()');
} catch (e) { out.err = String(e && e.stack || e); }
if (b) await b.close();
server.close();

const med = { today: median(out.today), card: median(out.card) };
out.pass.today = med.today != null && med.today <= LIMIT.today;
out.pass.card = med.card != null && med.card <= LIMIT.card;
out.pass.verdict = out.verdict.length === 2 && out.verdict.every((v) => v.ms != null && v.ms <= LIMIT.verdict);
out.pass.tasks = !out.err && Array.isArray(out.tasks) && out.tasks.every((t) => t <= LIMIT.task);
const line = (k, ok, what) => console.log((ok ? 'PASS ' : 'FAIL ') + k + ': ' + what);
line('Today ready after a reload, 6x', out.pass.today, out.today.join(', ') + ' ms (median ' + med.today + ', limit ' + LIMIT.today + ')');
line('first card after Start, 6x', out.pass.card, out.card.join(', ') + ' ms (median ' + med.card + ', limit ' + LIMIT.card + ')');
line('a try\'s verdict on screen, 1x', out.pass.verdict, out.verdict.map((v) => 'card ' + v.card + ' ' + (v.ms != null ? v.ms + ' ms (' + v.phase + ')' : v.err)).join(', ') + ' (limit ' + LIMIT.verdict + ')');
line('main-thread tasks during a set, 4x', out.pass.tasks, (out.tasks.length ? 'longest ' + Math.max.apply(null, out.tasks) + ' ms of ' + out.tasks.length + ' over 50' : 'none over 50 ms') + ' (limit ' + LIMIT.task + ')');
console.log(JSON.stringify(out));
process.exit(Object.values(out.pass).every(Boolean) && !out.err ? 0 : 1);
