// A browser's engine worker, for the app's own engine code (10-engine.js) in the Node realm: the
// checkout's sf/stockfish.js as a UCI process that hears exactly what the page posts (no ucinewgame,
// Hash or Threads unless the page sends them) and posts back every line it prints, one message each,
// as the Web Worker does in a browser. So a search here runs as it runs in a player's browser, on a
// worker that keeps what earlier searches left in its hash.
//   const W = require('./worker'); const w = await W.browserWorker(root);  // after its uci handshake
//   A.ev('SF.workers = [{ w: <w> }]; ...') hands it to the page (keys.js); w.log: what the page posted
const { spawn } = require('child_process');
const path = require('path');

function browserWorker(root) {
  const p = spawn(process.execPath, [path.join(root, 'sf', 'stockfish.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const w = {
    onmessage: null, onerror: null, log: [],
    postMessage(s) { w.log.push(String(s)); p.stdin.write(String(s) + '\n'); },
    terminate() { try { p.stdin.write('quit\n'); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 300); },
  };
  p.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (l && w.onmessage) w.onmessage({ data: l });
    }
  });
  p.stderr.on('data', () => {});
  p.on('error', (e) => { if (w.onerror) w.onerror(e); });
  /* the page's bootWorker posts "uci" and waits for "uciok"; done here, before the page gets it */
  return new Promise((res) => {
    w.onmessage = (e) => { if (e.data === 'uciok') { w.onmessage = null; w.log = []; res(w); } };
    w.postMessage('uci');
  });
}

module.exports = { browserWorker };
