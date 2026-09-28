/* ── 15b. Narration, the first load, watched ────────────────────────────
   A first-time user should see their program being built, not a skeleton
   with spinners. Lines appear as the data lands; the page reveals when the
   profile is computable. Only runs when there is no cached history.        */

/* The loading theater: the user's own games replay on a slow-drifting strip
   of boards while the count climbs, the wait shows the work. */
function narrBoards() {
  var src = (data.narrPreview && data.narrPreview.length >= 3)
    ? data.narrPreview
    : data.games;
  var gs = src.slice(0, 10).filter(function (g) { return g.op16; });
  if (gs.length < 3) return '';
  /* each board keeps its own live cursor: position, next token, next beat */
  data.narrLive = gs.map(function (g, i) {
    return { toks: (g.mv40 || g.op16).split(' '), st: chessStart(), ply: 0,
             flip: g.color === 'black',
             nextAt: Date.now() + Math.random() * 250 };
  });
  var cards = gs.map(function (g, i) {
    return '<div class="narr-card">'
      + boardSvg(data.narrLive[i].st, { flip: data.narrLive[i].flip, decor: true })
      + '<span class="narr-card-cap">' + esc(cfg.user) + ' vs ' + esc(g.opp) + '</span></div>';
  }).join('');
  return '<div class="narr-strip"><div class="narr-track">' + cards + cards + '</div></div>';
}
function narrLine(id, html) {
  data.narrLog = (data.narrLog || []).filter(function (l) { return l[0] !== id; });
  data.narrLog.push([id, html]);
  var box = el('narr');
  if (!box) return;
  var row = box.querySelector('[data-n="' + id + '"]');
  if (!row) {
    row = document.createElement('div');
    row.className = 'narr-line';
    row.setAttribute('data-n', id);
    box.appendChild(row);
  }
  row.innerHTML = html;
}

boot();

})();
