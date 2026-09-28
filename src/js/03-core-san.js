/* ── Proper SAN, FEN parsing, material ─────────────────────────────────────
   Standard algebraic notation with every detail a reader expects: capture
   marks, file for pawn captures, disambiguation, promotion, check and mate. */
function sqName(sq) { return String.fromCharCode(97 + sq % 8) + (1 + (sq >> 3)); }
function sqIndex(name) { return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97); }
function moveUci(m) { return sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : ''); }
function sanOf(st, m) {
  var p = st.b[m.from];
  if (!p) return '?';
  var u = p.toUpperCase(), s;
  if (m.castle) s = m.castle;
  else {
    var capture = m.ep >= 0 || st.b[m.to] != null;
    if (u === 'P') {
      s = (capture ? String.fromCharCode(97 + m.from % 8) + 'x' : '') + sqName(m.to)
        + (m.promo ? '=' + m.promo : '');
    } else {
      var rivals = legalMoves(st).filter(function (o) {
        return o.to === m.to && o.from !== m.from && st.b[o.from] === p;
      });
      var dis = '';
      if (rivals.length) {
        var sameFile = rivals.some(function (o) { return o.from % 8 === m.from % 8; });
        var sameRank = rivals.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
        if (!sameFile) dis = String.fromCharCode(97 + m.from % 8);
        else if (!sameRank) dis = String(1 + (m.from >> 3));
        else dis = sqName(m.from);
      }
      s = u + dis + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  var after = cloneState(st);
  applyMove(after, m);
  if (checkedKingSq(after) != null) s += legalMoves(after).length ? '+' : '#';
  return s;
}
function stateFromFen(fen) {
  var parts = String(fen).trim().split(/\s+/);
  var b = new Array(64).fill(null);
  var rows = parts[0].split('/');
  if (rows.length !== 8) return null;
  for (var r = 0; r < 8; r++) {
    var f = 0, row = rows[r];
    for (var i = 0; i < row.length; i++) {
      var c = row[i];
      if (c >= '1' && c <= '8') f += +c;
      else { if (f > 7) return null; b[(7 - r) * 8 + f] = c; f++; }
    }
  }
  return {
    b: b, w: parts[1] !== 'b', cast: parts[2] && parts[2] !== '-' ? parts[2] : '',
    ep: parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1,
    half: +(parts[4] || 0), full: +(parts[5] || 1)
  };
}
/* play a UCI line from a state: SAN labels, states after each move, the moves */
function playUci(st0, ucis) {
  var st = cloneState(st0), out = { san: [], states: [], moves: [], uci: [] };
  for (var i = 0; i < (ucis || []).length; i++) {
    var m = uciToMove(st, ucis[i]);
    if (!m) break;
    out.san.push(sanOf(st, m));
    applyMove(st, m);
    out.states.push(cloneState(st));
    out.moves.push(m);
    out.uci.push(ucis[i]);
  }
  return out;
}
/* material in pawns, from White's side (+ = White ahead) */
function materialDiff(b) {
  var d = 0;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (!p) continue;
    var v = PIECE_VAL[p.toUpperCase()];
    if (v === 99) continue;
    d += isW(p) ? v : -v;
  }
  return d;
}

