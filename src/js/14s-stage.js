/* ── The sequencer: one change at a time ────────────────────────────────
   An action changes the card at once (phase, verdict, misses, hints, the
   result) and then stages what the screen shows, as beats that run in order
   on the active card:
     'board'  repaints the board svg and the marks over it once no piece is
              sliding; a frame that slides a piece sets motionUntil to the
              slide's end, and so does a jump to another position (a 150 ms
              crossfade)
     'land'   once the piece has landed, draws what lands with it (a
              verdict's badge and tints, and its sound), if the board beat
              before it held them back for the slide
     'marks'  rewrites only the marks svg, once no piece is sliding
     'fade'   text out (2.2): before a move the app shows, the words about
              to change fade out (100 ms, TEXT_OUT, a wait beat after it)
     'text'   paints the band, the action bar, the strip and the live
              region 150 ms after the last slide ends; a newer text beat
              takes the place of one still waiting (the latest wins)
     {wait}   waits that many ms from when it is reached
     {run}    once no piece is moving, changes the card (run(a)), so the
              board beat after it paints the next frame: the story crossfades
              to where a segment starts, then slides its first ply
   Beats paint the card as it is when they run. Any input calls
   flushStage() first: a running slide jumps to its end, waiting board and
   marks beats apply at once, and waiting text moves to 150 ms from now.
   The one exception is the forcing reply (S10), the only move that plays
   by itself: it is always seen moving, so an input before it starts it at
   once, and while it slides (and until its words come, but for a tap on
   the board once it has landed) flushStage leaves everything as it is and
   says so; the input is dropped (a tap on a piece of yours is kept for
   the landing, replyTap).
   Beats belong to one card and die with it (Next, leaving the card). So do
   timed beats (stageAt): a change due at a set time (K1 at 300 ms, K2 at
   3 s, the end of a word or an outline for a tap that is not a move), which
   changes the card then and stages what it shows; input does not hurry
   them. */
var TEXT_GAP = 150, TEXT_OUT = 100;
/* a change that draws marks on a board that stays (a hint, the answer's
   arrow): the marks, then the words 150 ms after them, never in one frame */
var MARKS_THEN_WORDS = ['board', 'land', TEXT_GAP, 'text'];
var motionUntil = 0, stageQ = [], stageTimer = null, stageCard = null, textNotBefore = 0, stageTimers = [];
/* the forcing reply is sliding (paintBoard sets it, the next board clears it) */
var motionHold = false;

function stage(beats) {
  var a = ui.session && ui.session.active;
  if (!a) return;
  if (stageCard !== a.key) { stageReset(); stageCard = a.key; }
  /* the board alone (a selection, a drawn shape) never waits behind words
     still waiting: it goes before them, and they keep their 150 ms after it */
  var ti = beats.length === 1 && (beats[0] === 'board' || beats[0] === 'marks') ? stageQ.indexOf('text') : -1;
  if (ti >= 0) {
    if (stageQ[ti - 1] !== beats[0]) stageQ.splice(ti, 0, beats[0]);
    textNotBefore = Math.max(textNotBefore, Date.now() + TEXT_GAP);
    stageRun();
    return;
  }
  if (beats.indexOf('text') >= 0) {
    stageQ = stageQ.filter(function (b) { return b !== 'text'; });
    textNotBefore = 0;
    /* the keys of the last state go now; the text beat paints this one's */
    blankKeys();
  }
  beats.forEach(function (b) {
    /* two board beats in a row paint the same card: one is enough */
    if (b === 'board' && stageQ[stageQ.length - 1] === 'board') return;
    stageQ.push(typeof b === 'number' ? { wait: b } : b);
  });
  stageRun();
}
/* run what is due; wait for the rest */
function stageRun() {
  clearTimeout(stageTimer);
  stageTimer = null;
  var a = ui.session && ui.session.active;
  if (!a || a.key !== stageCard) { stageQ = []; return; }
  while (stageQ.length) {
    var b = stageQ[0], now = Date.now(), due = now;
    if (b === 'board' || b === 'land' || b === 'marks' || b === 'fade' || b.run) due = motionUntil;
    else if (b === 'text') due = Math.max(motionUntil + TEXT_GAP, textNotBefore);
    else if (b.wait != null) { if (b.until == null) b.until = now + b.wait; due = b.until; }
    if (due > now) { stageTimer = setTimeout(stageRun, due - now); return; }
    stageQ.shift();
    stageApply(b, a, false);
  }
}
function stageApply(b, a, instant) {
  if (b === 'board') paintBoard(a, instant);
  else if (b === 'land') { if (a.landing) paintBoard(a, true); }
  else if (b === 'marks') paintMarks(a);
  else if (b === 'fade') fadeOut(a);
  else if (b === 'text') paintText(a);
  else if (b.run) b.run(a);
}
/* a timed beat: run(a) at ms from now, on this card only, if it is still
   the one on screen. A flush leaves it alone */
function stageAt(ms, run) {
  var a = ui.session && ui.session.active;
  if (!a) return;
  var t = setTimeout(function () {
    var i = stageTimers.indexOf(t);
    if (i >= 0) stageTimers.splice(i, 1);
    if (ui.session && ui.session.active === a) run(a);
  }, ms);
  stageTimers.push(t);
}
/* input first: the slide ends, the board catches up, the words wait 150 ms.
   Returns true when the input must be dropped: the forcing reply is on its
   way (S10). Before it slides, an input starts it now (its telegraph kept,
   a.reply); while it slides input changes nothing, and once landed until
   its words come (2050) only the board takes input again (board: a tap or
   a press on it), which brings the reply's words 150 ms after it. Under
   reduced motion it waits for its own button, and input goes on as usual */
function flushStage(board) {
  var now = Date.now(), a = ui.session && ui.session.active, moved = false;
  if (motionHold && motionUntil > now) return true;
  motionHold = false;
  var rp = a && a.reply;
  if (rp && rp.played && stageQ.indexOf('board') < 0 && !board) return true;
  if (motionUntil > now) {
    var bw = el('bwrap'), ps = bw ? bw.querySelectorAll('.anim-piece') : [], xf = bw ? bw.querySelectorAll('.xfade') : [];
    for (var i = 0; i < ps.length; i++) { ps[i].style.transition = 'none'; ps[i].style.transform = 'translate(0px,0px)'; }
    /* a crossfade ends too: the old board goes */
    for (var k = 0; k < xf.length; k++) if (xf[k].parentNode) xf[k].parentNode.removeChild(xf[k]);
    motionUntil = now;
    moved = true;
  }
  /* waits and a waiting fade go: the words it would hide stay until the
     text beat, 150 ms from now */
  var q = stageQ, text = false;
  stageQ = [];
  clearTimeout(stageTimer);
  stageTimer = null;
  for (var j = 0; j < q.length && a && a.key === stageCard; j++) {
    var b = q[j];
    /* once the reply slides, the rest waits for it as usual */
    if (motionHold) stageQ.push(b);
    else if (b === 'board' || b === 'land' || b === 'marks') { stageApply(b, a, !(b === 'board' && a.replySlide)); moved = true; }
    else if (b.run) b.run(a);
    else if (b === 'text') text = true;
  }
  if (motionHold) {
    if (text && stageQ.indexOf('text') < 0) stageQ.push('text');
    stageRun();
    return true;
  }
  /* a board that just changed counts as a slide that ended now */
  if (moved) motionUntil = now;
  if (text) { stageQ.push('text'); textNotBefore = now + TEXT_GAP; stageRun(); }
  /* the forcing reply not yet played: the input starts it, and is dropped */
  if (rp && !rp.played && !reducedMotion()) return theirReply(a, true);
  return false;
}
function stageReset() {
  clearTimeout(stageTimer);
  stageTimer = null;
  stageTimers.forEach(function (t) { clearTimeout(t); });
  stageTimers = [];
  stageQ = [];
  stageCard = null;
  motionUntil = 0;
  motionHold = false;
  textNotBefore = 0;
  slotHidAt = [];
  slotPend = [];
  slotPress = null;
}

/* the double-tap guard (2.2): a bar slot whose label or action just changed
   ignores clicks, Enter and ? for 450 ms, so the second tap of a double tap
   never lands on the button that took the first one's place. paintBar
   notes every slot it paints. A slot that faded out for its change (text
   out, fadeOut) could take no tap from then on, so its half second runs
   from the fade, not from the paint: the story's bar, hidden from See why
   until its caption, takes its first visible tap (taps and keys alike).
   A press on a button that stays as it was (‹ stepping back) leaves the
   other slots it changes live: the hand is still on that button, and a tap
   elsewhere is deliberate. A slot whose meaning changed before its new
   label is painted (pendSlot) takes nothing until it is painted */
var SLOT_GUARD = 450;
var slotSig = [], slotAct = [], slotChangedAt = [], slotHidAt = [], slotPend = [], slotPress = null;
function hideSlot(i) { if (slotHidAt[i] == null) slotHidAt[i] = Date.now(); }
function pendSlot(i) { slotPend[i] = true; }
/* a bar slot pressed (a click on it, or the key that stands for it) */
function pressSlot(i) { if (i != null && i >= 0) slotPress = { i: i, sig: slotSig[i], t: Date.now() }; }
/* a slot as the guard sees it: its label, its action (none when off), its key */
function slotSigOf(s) { return (s.label || '') + '|' + (s.off ? '' : s.act || '') + '|' + (s.k == null ? '' : s.k); }
function noteSlots(slots) {
  var now = Date.now(), pr = slotPress;
  /* the pressed button is still there, as it was (this paint is the one
     the press asked for: a press that changed nothing is forgotten) */
  var kept = !!(pr && now - pr.t < 1000 && slots[pr.i] && slotSigOf(slots[pr.i]) === pr.sig);
  slots.forEach(function (s, i) {
    var sig = slotSig[i], nsig = slotSigOf(s);
    if (sig !== nsig) {
      slotSig[i] = nsig;
      slotChangedAt[i] = slotHidAt[i] != null ? slotHidAt[i] : kept && i !== pr.i ? 0 : now;
    }
    slotAct[i] = s.off ? null : s.act || null;
  });
  for (var j = slots.length; j < slotSig.length; j++) { slotSig[j] = null; slotAct[j] = null; slotChangedAt[j] = now; }
  slotHidAt = [];
  slotPend = [];
  slotPress = null;
}
/* a slot faded out and not yet repainted presses nothing either (a key
   would otherwise reach the button it is about to lose) */
function slotGuarded(i) { return i != null && i >= 0 && (slotHidAt[i] != null || !!slotPend[i] || Date.now() - (slotChangedAt[i] || 0) < SLOT_GUARD); }
/* the slot that holds an action now, -1 if none; the right-hand one */
function slotOfAct(act) { return slotAct.indexOf(act); }
function rightSlot() { for (var i = slotSig.length - 1; i >= 0; i--) if (slotSig[i] != null) return i; return -1; }
