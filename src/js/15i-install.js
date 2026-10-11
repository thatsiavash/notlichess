/* ── the installable app (F11.1) ───────────────────────────────────────────
   sw.js keeps the page, Stockfish and the icons, so the app opens and
   practises from the saved games with no network. The browser's own
   install offer is held back and made at a calm moment instead: on the
   first summary with the week's goal met (never on the first visit's day),
   and in Settings. An iPhone or iPad has no offer: it gets the how-to, and
   the progress file carries the practice into the home-screen app, which
   starts with storage of its own. */

/* the service worker: registered once a page, once a player is known and
   Stockfish has loaded (or failed), so a first visitor who only looks
   downloads nothing more, and the worker's revalidated copy of Stockfish
   comes out of the browser's own cache. Then checked again on a return to
   the page, at most hourly, so an app left open picks up a new version */
var swState = { asked: false, reg: null, checked: 0 };
var SW_RECHECK = 3600 * 1000;
function swRegister() {
  var sw = null;
  try { sw = navigator.serviceWorker; } catch (e) {}
  if (swState.asked || !cfg.user || !sw || typeof sw.register !== 'function') return;
  swState.asked = true;
  var go = function () {
    try {
      sw.register('sw.js', { updateViaCache: 'none' }).then(function (reg) { swState.reg = reg; swState.checked = Date.now(); }, function () {});
    } catch (e) {}
  };
  (SF.loading || Promise.resolve()).then(go, go);
}
/* this page is kept by the worker: it opens with no network */
function swReady() {
  try { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) { return false; }
}
document.addEventListener('visibilitychange', function () {
  var reg = swState.reg;
  if (document.hidden || !reg || Date.now() - swState.checked < SW_RECHECK) return;
  swState.checked = Date.now();
  try { Promise.resolve(reg.update()).catch(function () {}); } catch (e) {}
});

/* the browser's offer to install (Chrome and Edge on Android and the
   desktop), kept for the moment the app makes it */
var installEvt = null;
function installPromptSeen(e) {
  try { e.preventDefault(); } catch (x) {}
  installEvt = e;
  renderSettings();
}
/* installed, from the offer or the browser's menu: never offered again */
function appInstalled() {
  installEvt = null;
  if (!store.get('nl:install', null)) store.set('nl:install', { at: Date.now(), kind: 'installed' });
  track('app_installed');
  renderSettings();
}
window.addEventListener('beforeinstallprompt', installPromptSeen);
window.addEventListener('appinstalled', appInstalled);
/* an iPhone or an iPad (which calls itself a Mac with a touch screen) */
function iosDevice() {
  var ua = String(navigator.userAgent || '');
  return /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
/* which offer this browser can take: 'prompt' (the browser offered), 'ios'
   (the how-to), '' (the app itself, or a browser with neither) */
function installKind() {
  if (installedApp()) return '';
  if (installEvt) return 'prompt';
  return iosDevice() ? 'ios' : '';
}
/* the summary's offer: once ever (nl:install, this browser's), on a set that
   met the week's goal, never on the player's first day here, and never
   beside the reminder's question or the backup prompt (F5.4, cueOf): one
   ask a summary, so it waits for a later one, nothing noted */
function installOfferDue(ss) {
  if (!ss || !ss.goalMet || store.get('nl:install', null) || cueOf(ss)) return '';
  var first = store.get('nl:firstSeen:' + playerId(), 0);
  if (!first || dayStamp(new Date(first)) === dayStamp()) return '';
  return installKind();
}
/* on a desktop the app is installed, not added to a home screen */
function installWords() {
  return touchScreen() ? { q: 'Add notlichess to your home screen?', why: 'It opens in one tap', add: 'Add', more: 'Add to home screen' }
    : { q: 'Install notlichess as an app?', why: 'It opens in its own window', add: 'Install', more: 'Install' };
}
/* "Tap Share, then Add to Home Screen.", Share drawn as iOS draws it */
var IOS_HOWTO = 'Tap Share<span class="ios-share" aria-hidden="true"></span>, then Add to Home Screen. The app starts empty: save a progress file here, then load it there.';
/* the card after the habit card on the summary, in the reminder's place:
   decided once, on its first paint (it stays while the summary does, and
   is never offered again) */
function installCardHtml(ss) {
  if (ss.install == null) {
    ss.install = installOfferDue(ss);
    if (ss.install) {
      store.set('nl:install', { at: Date.now(), kind: ss.install });
      track(ss.install === 'ios' ? 'install_howto' : 'install_offer');
    }
  }
  if (ss.install === 'ios') {
    return '<div class="focus recap-install"><p class="install-q">Add notlichess to your home screen?</p><p>' + IOS_HOWTO + '</p>'
      + '<div class="acts-row"><a class="btn-line" data-act="exportProgress">Save a progress file</a><a class="btn-quiet" data-act="installLater">Not now</a></div></div>';
  }
  if (ss.install !== 'prompt' || !installEvt) return '';
  var w = installWords();
  return '<div class="focus recap-install"><p class="install-q">' + w.q + '</p>' + (swReady() ? '<p>' + w.why + ', and works offline.</p>' : '')
    + '<div class="acts-row"><a class="btn-line" data-act="installApp">' + w.add + '</a><a class="btn-quiet" data-act="installLater">Not now</a></div></div>';
}
/* Settings: the offer, the how-to, or what the installed app does */
function installSettingsHtml() {
  var kind = installKind(), off = swReady(), w = installWords(), say = '';
  if (kind === 'prompt') say = '<p>' + w.why + (off ? ', and works offline' : '') + '.</p><a class="btn-line" data-act="installApp">' + w.more + '</a>';
  else if (kind === 'ios') say = '<p>' + IOS_HOWTO + '</p>';
  else if (installedApp()) {
    say = '<p>This is the installed app.' + (off ? ' It works offline, from your saved games.' : '') + '</p>'
      + (navigator.standalone === true ? '<p>Used notlichess in Safari? Load the progress file you saved there.</p>' : '');
  }
  return say ? '<div class="set-block set-app"><span class="kicker">App</span>' + say + '</div>' : '';
}
/* Add: the browser's own dialog; whatever the answer, the card goes */
function installApp() {
  var e = installEvt, ss = ui.session;
  installEvt = null;
  if (ss && ss.finished) ss.install = '';
  var after = function (c) {
    if (e) track(c && c.outcome === 'accepted' ? 'install_accepted' : 'install_dismissed');
    renderTrain();
    renderSettings();
  };
  if (!e || typeof e.prompt !== 'function') { after(null); return; }
  track('install_add');
  try {
    e.prompt();
    Promise.resolve(e.userChoice).then(after, function () { after(null); });
  } catch (x) { after(null); }
  renderTrain();
  renderSettings();
}
function installLater() {
  var ss = ui.session;
  if (ss) ss.install = '';
  track('install_later');
  renderTrain();
}
