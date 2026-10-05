// Load the fixture player into a real tab with no network to chess.com: the games come from
// test/data/fixture-games.json (seeded into localStorage), and api.chess.com answers from here with a
// profile at the rating asked for (700 = tier 1, 1600 = tier 2, 2000 = tier 3). Other outside hosts fail.
// import { launch } from './cdp.mjs'; import { openOffline } from './offline.mjs';
// const b = await launch({ width: 390, height: 844, mobile: true }); await openOffline(b, { rating: 700 });
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = readFileSync(join(HERE, '..', '..', 'test', 'data', 'fixture-games.json'), 'utf8');
export async function openOffline(b, o = {}) {
  const base = o.base || 'http://127.0.0.1:' + (process.env.PORT || 8123) + '/', rating = o.rating || 1600, user = 'tester';
  const prof = { username: user, avatar: null, joined: 1600000000, last_online: 1790577955 };
  const stats = { chess_rapid: { last: { rating, date: 1790577955 }, best: { rating: rating + 50 }, record: { win: 300, loss: 300, draw: 20 } } };
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*://api.chess.com/*' }, { urlPattern: '*://*.lichess.org/*' }, { urlPattern: '*://lichess.org/*' }, { urlPattern: '*://www.clarity.ms/*' }, { urlPattern: '*://fonts.*' }] });
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
  await b.goto(base, 600);
  await b.eval(`localStorage.clear(); localStorage.setItem('nl:user', JSON.stringify('${user}')); localStorage.setItem('nl:src', JSON.stringify('chesscom')); localStorage.setItem('nl:games:cc:${user}', ${JSON.stringify(FIX)}); 1`);
  await b.goto(base + (o.query || ''), o.wait || 3500);
}
