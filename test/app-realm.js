// Boots the whole built app (index.html's main script) in Node with a small DOM stub, and reaches its
// internals through window.__nlTest.ev (enabled because location.hostname is 'localhost').
// Usage: const A = require('./app-realm')({ now, storage: {...}, session: {...} });
//        A.ev('todayPlan()'); A.setNow(ms); A.storage; A.click('tryAgain') (a button click, through the page's handler)
//        A.key('Enter', repeat, on): a key through the page's keydown handlers (on a focused button when on = { act, k, slot })
//        A.advance(ms): the clock moves on, and each timer runs when it falls due (A.flush runs them all, whatever their delay)
// Nothing reaches the network (fetch never resolves) and no engine runs (Worker throws), so everything
// tested here is the app's own bookkeeping.
const fs = require('fs'), path = require('path');
const FILE = process.env.NL_HTML || path.join(__dirname, '..', 'index.html');

module.exports = function makeApp(opts) {
  opts = opts || {};
  const html = fs.readFileSync(FILE, 'utf8');
  const src = html.split('<script>').slice(1).map((p) => p.split('</script>')[0]).sort((a, b) => b.length - a.length)[0];
  let now = opts.now || Date.now();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const mkStore = (init) => {
    const data = Object.assign({}, init || {});
    return {
      data,
      api: {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        key: (i) => Object.keys(data)[i] || null,
        get length() { return Object.keys(data).length; },
      },
    };
  };
  const local = mkStore(opts.storage), session = mkStore(opts.session);
  const elStub = () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, focus() {}, remove() {}, contains: () => false,
    getBoundingClientRect: () => ({ top: 0, width: 45 }), scrollTop: 0,
  });
  const els = { main: elStub(), overlay: elStub() };
  const timers = [], listeners = {};
  const document = {
    getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, createElement: () => elStub(), body: elStub(), documentElement: elStub(), hidden: false, title: '',
  };
  const window = {
    addEventListener() {}, console, matchMedia: () => ({ matches: false }), scrollTo() {}, innerWidth: 1200,
    pageYOffset: 0, scrollY: 0,
  };
  const loc = { search: opts.search || '', hash: '', pathname: '/', hostname: 'localhost', href: '' };
  const ctx = {
    window, document, localStorage: local.api, sessionStorage: session.api, console, Math, JSON, Date: FakeDate, Promise,
    Object, Array, String, Number, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, URLSearchParams,
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    location: loc, history: { state: null, replaceState() {}, pushState(s) { this.state = s; }, back() {} },
    navigator: { onLine: true, hardwareConcurrency: 4, storage: { persist: () => Promise.resolve(true) } },
    setTimeout: (fn, ms) => { const w = () => fn(); w.due = now + (+ms || 0); timers.push(w); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame() {}, fetch: () => new Promise(() => {}), Worker: function () { throw new Error('no workers in node'); },
    MutationObserver: function () { this.observe = function () {}; }, TextDecoder, KeyboardEvent: function () {},
  };
  window.localStorage = local.api;
  window.document = document;
  const keep = ['Math', 'JSON', 'Promise', 'Object', 'Array', 'String', 'Number', 'RegExp', 'Error', 'isFinite', 'isNaN',
    'parseInt', 'parseFloat', 'console', 'TextDecoder', 'URLSearchParams'];
  const names = Object.keys(ctx).filter((k) => keep.indexOf(k) === -1);
  const fn = new Function(...names, src);
  fn(...names.map((k) => ctx[k]));
  const ev = (code) => window.__nlTest.ev(code);
  /* a button with this data-act (and data-k, and the bar slot it sits in),
     as an event target: focusable, and its click goes to the page's own
     document click handler */
  const button = (act, k, slot) => {
    const t = { tagName: 'A', getAttribute: (n) => (n === 'data-act' ? act : n === 'data-k' ? (k == null ? null : String(k)) : n === 'data-slot' ? (slot == null ? null : String(slot)) : null) };
    t.closest = (sel) => (sel === '[data-act]' ? t : null);
    t.matches = (sel) => /^\[data-act\]/.test(sel);
    t.click = () => click(act, k, slot);
    return t;
  };
  const click = (act, k, slot) => {
    const t = button(act, k, slot);
    (listeners.click || []).forEach((fn) => fn({ target: t, preventDefault() {} }));
  };
  /* stubbed nodes inside the page (a bar button's click()) reach the click handler through this */
  window.__realmClick = click;
  return {
    ev, storage: local.data, session: session.data, timers, loc,
    setNow: (t) => { now = t; }, getNow: () => now,
    /* a click on a button, given to the page's own document click handler */
    click,
    /* a key pressed on the page, given to its keydown handlers: on no
       control, with on = { act, k, slot } on that focused button, or with
       on = { id, value } in that text field; repeat marks the keyboard's
       auto-repeat of a held key */
    key: (key, repeat, on) => {
      const t = !on ? { tagName: 'BODY', closest: () => null, matches: () => false }
        : on.id ? { tagName: 'INPUT', id: on.id, value: on.value || '', closest: () => null, matches: () => false } : button(on.act, on.k, on.slot);
      (listeners.keydown || []).forEach((fn) => fn({ key, repeat: !!repeat, target: t, preventDefault() {} }));
    },
    /* the clock moves on by ms; each timer runs when it falls due, in order,
       with the clock at its due time (a timer it queues runs too, if due) */
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        let i = -1;
        timers.forEach((t, j) => { if ((t.due || 0) <= end && (i < 0 || (t.due || 0) < (timers[i].due || 0))) i = j; });
        if (i < 0) break;
        const t = timers.splice(i, 1)[0];
        if ((t.due || 0) > now) now = t.due;
        try { t(); } catch (e) {}
      }
      now = end;
    },
    /* run queued timers once (not recursively forever) */
    flush: (rounds) => { for (let r = 0; r < (rounds || 1); r++) { const t = timers.splice(0); t.forEach((f) => { try { f(); } catch (e) {} }); } },
  };
};
