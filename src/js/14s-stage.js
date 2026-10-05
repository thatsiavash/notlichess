/* ── The sequencer (FINAL-SPEC 2.2): one change at a time ─────────────────
   An action changes the card at once (phase, verdict, misses, hints, the
   result) and then stages what the screen shows, as beats that run in order
   on the active card:
     'board'  repaints the board svg and the marks over it once no piece is
              sliding; a frame that slides a piece sets motionUntil to the
              slide's end
     'marks'  rewrites only the marks svg, once no piece is sliding
     'text'   paints the band, the action bar, the strip and the live
              region 150 ms after the last slide ends; a newer text beat
              takes the place of one still waiting (the latest wins)
     {wait}   waits that many ms from when it is reached
   Beats paint the card as it is when they run. Any input calls
   flushStage() first: a running slide jumps to its end, waiting board and
   marks beats apply at once, and waiting text moves to 150 ms from now.
   Beats belong to one card and die with it (Next, leaving the card). */
var TEXT_GAP = 150;
var motionUntil = 0, stageQ = [], stageTimer = null, stageCard = null, textNotBefore = 0;

function stage(beats) {
  var a = ui.session && ui.session.active;
  if (!a) return;
  if (stageCard !== a.key) { stageReset(); stageCard = a.key; }
  if (beats.indexOf('text') >= 0) {
    stageQ = stageQ.filter(function (b) { return b !== 'text'; });
    textNotBefore = 0;
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
    if (b === 'board' || b === 'marks') due = motionUntil;
    else if (b === 'text') due = Math.max(motionUntil + TEXT_GAP, textNotBefore);
    else if (b.wait != null) { if (b.until == null) b.until = now + b.wait; due = b.until; }
    if (due > now) { stageTimer = setTimeout(stageRun, due - now); return; }
    stageQ.shift();
    stageApply(b, a, false);
  }
}
function stageApply(b, a, instant) {
  if (b === 'board') paintBoard(a, instant);
  else if (b === 'marks') paintMarks(a);
  else if (b === 'text') paintText(a);
}
/* input first: the slide ends, the board catches up, the words wait 150 ms */
function flushStage() {
  var now = Date.now(), a = ui.session && ui.session.active, moved = false;
  if (motionUntil > now) {
    var bw = el('bwrap'), ps = bw ? bw.querySelectorAll('.anim-piece') : [];
    for (var i = 0; i < ps.length; i++) { ps[i].style.transition = 'none'; ps[i].style.transform = 'translate(0px,0px)'; }
    motionUntil = now;
    moved = true;
  }
  var q = stageQ, text = false;
  stageQ = [];
  clearTimeout(stageTimer);
  stageTimer = null;
  if (a && a.key === stageCard) q.forEach(function (b) {
    if (b === 'board' || b === 'marks') { stageApply(b, a, true); moved = true; }
    else if (b === 'text') text = true;
  });
  /* a board that just changed counts as a slide that ended now */
  if (moved) motionUntil = now;
  if (text) { stageQ.push('text'); textNotBefore = now + TEXT_GAP; stageRun(); }
}
function stageReset() {
  clearTimeout(stageTimer);
  stageTimer = null;
  stageQ = [];
  stageCard = null;
  motionUntil = 0;
  textNotBefore = 0;
}

/* the double-tap guard (2.2): a bar slot whose label or action just changed
   ignores clicks, Enter and ? for 450 ms, so the second tap of a double tap
   never lands on the button that took the first one's place. paintBar
   notes every slot it paints */
var SLOT_GUARD = 450;
var slotSig = [], slotAct = [], slotChangedAt = [];
function noteSlots(slots) {
  var now = Date.now();
  slots.forEach(function (s, i) {
    var sig = (s.label || '') + '|' + (s.off ? '' : s.act || '') + '|' + (s.k == null ? '' : s.k);
    if (slotSig[i] !== sig) { slotSig[i] = sig; slotChangedAt[i] = now; }
    slotAct[i] = s.off ? null : s.act || null;
  });
  for (var j = slots.length; j < slotSig.length; j++) { slotSig[j] = null; slotAct[j] = null; slotChangedAt[j] = now; }
}
function slotGuarded(i) { return i != null && i >= 0 && Date.now() - (slotChangedAt[i] || 0) < SLOT_GUARD; }
/* the slot that holds an action now, -1 if none; the right-hand one */
function slotOfAct(act) { return slotAct.indexOf(act); }
function rightSlot() { for (var i = slotSig.length - 1; i >= 0; i--) if (slotSig[i] != null) return i; return -1; }
