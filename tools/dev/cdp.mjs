// Minimal headless-Chrome driver over CDP (Node 22+ built-in WebSocket). One fresh profile per call.
// import { launch } from './cdp.mjs'; const b = await launch({ width: 1280, height: 900, mobile: false });
// await b.goto(url); await b.eval('js expr'); await b.shot('/abs/out.png'); await b.click(x, y); await b.key('Escape'); await b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
// CHROME_PATH wins; otherwise the first browser found (macOS Chrome, then common Linux paths).
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p)) || 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function launch(o = {}) {
  const W = o.width || 1280, H = o.height || 900, mobile = !!o.mobile;
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = mkdtempSync(join(process.env.CDP_TMP || tmpdir(), 'prof-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', '--no-sandbox', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ws) throw new Error('chrome did not start');
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), logs = [], subs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.j(new Error(JSON.stringify(d.error))) : p.r(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    else if (d.method && subs.length) subs.forEach((f) => f(d.method, d.params));
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: o.dpr || (mobile ? 2 : 1), mobile });
  if (mobile) { await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' }); }
  const api = {
    send, logs, on(f) { subs.push(f); },
    async goto(url, wait = 1500) { await send('Page.navigate', { url }); await sleep(wait); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    async shot(path, clip) { const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')); return path; },
    async click(x, y) { if (mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      else { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); } },
    async drag(x1, y1, x2, y2, steps = 8) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, button: 'left' });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 }); },
    async key(k) { const codes = { Escape: 27, Enter: 13, ArrowLeft: 37, ArrowRight: 39, Tab: 9 }; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: codes[k] || 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: codes[k] || 0 }); },
    async type(t) { await send('Input.insertText', { text: t }); },
    sleep,
    async close() { try { ws.close(); } catch (e) {} proc.kill('SIGKILL'); },
  };
  return api;
}
