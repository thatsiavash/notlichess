"""Handlers for the forms v2 slice 2 adds (words from the facts), read before the older ones:
- a wrong try's first decisive event (V2.2): "Then Rxf5 takes your queen.", "Then their rook takes your
  queen.", "Then Rd1+ forces mate.", "Then they can force checkmate.", "Then f1=Q: their pawn becomes a
  queen.", "Their pawn will become a queen.", "After Bxc3+ bxc3, Qxc3+ forks.", "Then Qxc3+ forks king
  and rook.", "Then their queen forks king and rook.", "After Rxd1 Bxd1, Qxg7 is mate.", a mate further
  down See it's line ("Then queen takes on g7 is checkmate."), the saving try's "Safe, but ..." forms,
  "After X, you are still better.";
- Hint 2 from the key's moves ("Only one queen move holds.", "Only one queen move is best."), the missed
  win ("You can win their queen."), the two threats ("Two threats: Qxf2 mate and Bxc3+.", "Stop the
  mate, guard your knight."), the foil's ("Only one move holds here.", "Rg5 would win your queen.",
  "Their threat: Rg5 wins your queen.", "Any good move passes here.") and "Hint N added.";
- the answer's one reason (V2.4) on the settled row, See why's B1 ("Better: f5. It guards your
  knight.") and Details: saves, guards, stops, traps, wins, blocks, attacks, the band ("keeps the game
  level"), with tier 3's figure; See why's fork captions and tier 3's line figure ("Qe6 b5 axb5: 50%.");
- Details: the threats line ("Their threats: Qxf2 mate, Bxc3+. O-O met only the mate."), the
  opponent's line ("Your opponent missed it, but after Qf8 they were still ahead."), "After Bf3, Qxg7 is
  mate.", "After a4, the pawn on c3 stays defended.", what the line attacks ("After d6, White attacks
  your queen and the c7 pawn."), and labelled figures ("Your chances: 36% before, 19% after.");
- the foils' "The only move, as in your game." and "Your game move Ra1 was good too.";
- See it's still marks: the event arrow's label ("takes", "fork", "mate", "queen") and "you take back".
Each is checked on the board it is said on, with python-chess and Stockfish at 1M nodes."""
import re
import chess
import chk
import sf
from chk import VAL, NAME, PNAME, parse_move, after
from claims import *
from handlers import PIECE, SIDE, capture_reason, h_then_mate, h_after_band, h_still_better, h_lose, lost_types
import handlers as H1


def words_move(b, text):
    """a move in SAN or in words, with castling's side ("castling on the queen's side")"""
    t = text.strip().rstrip('.')
    mc = re.match(r"^castling on the (king|queen)'s side$", t, re.I)
    if mc:
        c = [x for x in b.legal_moves if b.is_castling(x) and (chess.square_file(x.to_square) > 4) == (mc.group(1).lower() == 'king')]
        return c[0] if c else None
    return parse_move(b, t)


def try_line(R):
    """the board before the try, the try, and the line See it plays after it (their reply first)"""
    t = R.tried
    if not t or not t.get('uci'):
        return None
    line = t.get('line') or ([t['reply']] if t.get('reply') else [])
    return R.st, t['uci'], list(line)


def walk(fen, ucis):
    """the boards along a line: [(board before, move)], stopping at an illegal move"""
    b = chess.Board(fen)
    out = []
    for u in ucis:
        m = chess.Move.from_uci(u)
        if m not in b.legal_moves:
            break
        out.append((b.copy(stack=False), m))
        b.push(m)
    return out, b


def find_on_line(R, san, want=None):
    """the ply of See it's line (after the try) that the move named is, read on its own board: (index in
    the line, board before it, the move) or None"""
    c = try_line(R)
    if not c:
        return None
    plies, _ = walk(after(c[0], c[1]).fen(), c[2])
    for i, (b, m) in enumerate(plies):
        x = words_move(b, san)
        if x and x == m and (want is None or want(b, m)):
            return i, b, m
    return None


def loss_after(R, prefix, need):
    """the player's loss from the try's board after the try and `prefix` and Stockfish's line, against
    what the answer's own line loses: T where it stands (need or more), else the count"""
    c = try_line(R)
    s = chk.settled_delta(c[0], R.color, [c[1]] + prefix, DEEP)
    loss = -s['delta']
    note = 'after %s: deep line %s, net %s' % (' '.join([c[1]] + prefix), ' '.join(s['pv'][:8]), -loss)
    due = R.due()
    rel = loss
    if due and due != c[1]:
        sb = chk.settled_delta(c[0], R.color, [due], DEEP)
        rel = loss + sb['delta']
        note += "; the answer's line nets %s" % sb['delta']
    if loss >= need - 0.5 or rel >= need - 0.5:
        return T(note)
    if loss <= 0 and rel <= 0:
        return M('the player gets it back: ' + note)
    return ('noise', 'less than the piece: ' + note)


# ── V2.2: a wrong try's first decisive event ───────────────────────────────
def h_later_san(R, m, text):
    san, word = m.group(1), m.group(2)
    f = find_on_line(R, san, want=lambda b, x: b.piece_at(x.from_square).color != R.color)
    if not f:
        return F('%s is not on the line See it plays (%s)' % (san, ' '.join((R.tried or {}).get('line') or [])))
    i, b, x = f
    v = b.piece_at(x.to_square) or (chess.Piece(chess.PAWN, R.color) if b.is_en_passant(x) else None)
    if not v or v.color != R.color or v.piece_type != NAME[word]:
        return F('%s takes %s, not your %s' % (san, v and PNAME[v.piece_type], word))
    line = R.tried.get('line') or []
    return loss_after(R, line[:i + 1], min(VAL[NAME[word]], 3) if word != 'pawn' else 1)


def h_later_words(R, m, text):
    by, word = m.group(1), m.group(2)
    c = try_line(R)
    if not c:
        return U('no try')
    plies, _ = walk(after(c[0], c[1]).fen(), c[2])
    for i, (b, x) in enumerate(plies):
        mover = b.piece_at(x.from_square)
        v = b.piece_at(x.to_square) or (chess.Piece(chess.PAWN, R.color) if b.is_en_passant(x) else None)
        if mover and mover.color != R.color and mover.piece_type == NAME[by] and v and v.color == R.color and v.piece_type == NAME[word] and i >= 1:
            return loss_after(R, c[2][:i + 1], min(VAL[NAME[word]], 3) if word != 'pawn' else 1)
    return F('no %s of theirs takes your %s on the line See it plays' % (by, word))


def h_forces_mate(R, m, text):
    c = try_line(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    if m.lastindex and m.group(1):
        x = words_move(b, m.group(1))
        if not x:
            return F('%s is not legal after the try' % m.group(1))
        if c[2] and x.uci() != c[2][0]:
            return M('names %s, See it plays %s' % (m.group(1), c[2][0]))
    e = ev(b.fen(), not R.color, DEEP)
    if (e['mate'] or 0) > 0 or chk.mates_in_one(b):
        return T('a forced mate for them: %s (%s)' % (e['mate'], ' '.join(e['pv'][:8])))
    if e['win'] >= 90:
        return M('no forced mate found at 1M nodes, but they are winning (%.0f%%)' % e['win'])
    return F('no mate: their win chance %.0f%%' % e['win'])


def promo_stands(R, piece=None):
    """a pawn of theirs promotes along See it's line, the new piece standing to its end, and Stockfish
    after the try agrees they are winning"""
    c = try_line(R)
    if not c:
        return None, 'no try'
    plies, end = walk(after(c[0], c[1]).fen(), c[2])
    for i, (b, x) in enumerate(plies):
        if not x.promotion or b.piece_at(x.from_square).color == R.color:
            continue
        if piece and x.promotion != NAME[piece]:
            continue
        sq, gone = x.to_square, False
        for b2, y in plies[i + 1:]:
            if b2.piece_at(y.from_square).color != R.color and y.from_square == sq:
                sq = y.to_square
            elif b2.piece_at(y.from_square).color == R.color and y.to_square == sq:
                gone = True
        if gone:
            continue
        e = ev(after(c[0], c[1]).fen(), R.color, DEEP)
        note = 'promotes on %s at ply %s; after the try the player has %.0f%% (%s)' % (chess.square_name(x.to_square), i + 1, e['win'], ' '.join(e['pv'][:8]))
        return (e['win'] <= 40 + TOL), note
    return False, 'no promotion of theirs that stands on the line See it plays (%s)' % ' '.join(c[2])


def h_promo(R, m, text):
    piece = m.group(m.lastindex) if m.lastindex else 'queen'
    ok, note = promo_stands(R, piece)
    if ok is None:
        return U(note)
    if ok:
        return T(note)
    return F(note) if 'no promotion' in note else M('it promotes, but the player is not lost: ' + note)


def h_promo_san(R, m, text):
    f = find_on_line(R, m.group(1), want=lambda b, x: b.piece_at(x.from_square).color != R.color)
    if not f or not f[2].promotion:
        return F('%s is no promotion on the line See it plays' % m.group(1))
    return h_promo(R, re.match(r'^(.*)$', m.group(2)), text)


def fork_check(R, b, x, i, names):
    tg = fork_of(b, x, b.piece_at(x.from_square).color)
    y = b.copy(stack=False)
    y.push(x)
    got = sorted(PNAME[y.piece_at(t).piece_type] for t in tg)
    if len(tg) < 2:
        return F('%s attacks %s: no fork' % (x.uci(), got))
    for n in names or []:
        if n not in got:
            return F('%s forks %s, not your %s' % (x.uci(), got, n))
    return loss_after(R, (R.tried.get('line') or [])[:i + 1], 2)


def fork_names(s):
    s = s.strip()
    mb = re.match(r'^both (?:your |their )?(\w+?)s$', s)
    if mb:
        return [mb.group(1), mb.group(1)]
    mp = re.match(r'^(?:your |their )?(\w+) and (\w+)$', s)
    return [mp.group(1), mp.group(2)] if mp else []


def h_back_fork(R, m, text):
    cap, back, fk = m.group(1), m.group(2), m.group(3)
    c = try_line(R)
    if not c:
        return U('no try')
    plies, _ = walk(after(c[0], c[1]).fen(), c[2])
    if len(plies) < 3:
        return F('the line See it plays is shorter than three moves')
    for k, sn in enumerate((cap, back, fk)):
        b, x = plies[k]
        y = words_move(b, sn)
        if not y or y != x:
            return F('%s is not move %s of the line (%s)' % (sn, k + 1, x.uci()))
    b0, x0 = plies[0]
    b1, x1 = plies[1]
    if not b0.is_capture(x0) or not b1.is_capture(x1) or x1.to_square != x0.to_square:
        return F('%s %s is no capture taken back' % (cap, back))
    return fork_check(R, plies[2][0], plies[2][1], 2, [])


def h_then_fork(R, m, text):
    san, names = m.group(1), fork_names(m.group(2))
    f = find_on_line(R, san, want=lambda b, x: b.piece_at(x.from_square).color != R.color)
    if not f:
        return F('%s is not on the line See it plays' % san)
    return fork_check(R, f[1], f[2], f[0], names)


def h_then_fork_words(R, m, text):
    by, names = m.group(1), fork_names(m.group(2))
    c = try_line(R)
    if not c:
        return U('no try')
    plies, _ = walk(after(c[0], c[1]).fen(), c[2])
    for i, (b, x) in enumerate(plies):
        mover = b.piece_at(x.from_square)
        if mover.color != R.color and mover.piece_type == NAME[by] and len(fork_of(b, x, mover.color)) >= 2:
            return fork_check(R, b, x, i, names)
    return F('no fork by their %s on the line See it plays' % by)


def h_back_mate(R, m, text):
    cap, back, mt = m.group(1), m.group(2), m.group(3)
    c = try_line(R)
    if not c:
        return U('no try')
    plies, end = walk(after(c[0], c[1]).fen(), c[2])
    if len(plies) < 3:
        return F('the line is shorter than three moves')
    for k, sn in enumerate((cap, back, mt)):
        b, x = plies[k]
        y = words_move(b, sn)
        if not y or y != x:
            return F('%s is not move %s of the line' % (sn, k + 1))
    y = plies[2][0].copy(stack=False)
    y.push(plies[2][1])
    if not y.is_checkmate():
        return F('%s is not mate' % mt)
    # is the take-back forced? their mate either way: Stockfish after the try and their capture
    e = ev(after(c[0], c[1], plies[0][1].uci()).fen(), not R.color, DEEP)
    note = 'after the capture, their best: mate %s (%s)' % (e['mate'], ' '.join(e['pv'][:6]))
    return T(note) if (e['mate'] or 0) > 0 or e['win'] >= 85 else M('the take-back is not forced: ' + note)


def h_then_mate_line(R, m, text):
    """"Then X is checkmate.": the reply itself, or a mate further down See it's line (after you take back)"""
    v = h_then_mate(R, m, text)
    if v[0] == 'true':
        return v
    f = find_on_line(R, m.group(1), want=lambda b, x: (lambda y: (y.push(x), y.is_checkmate())[1])(b.copy(stack=False)))
    if f:
        e = ev(after(R.st, R.tried['uci'], R.tried['line'][0]).fen(), not R.color, DEEP) if f[0] >= 1 else {'mate': 1, 'win': 100, 'pv': []}
        note = 'mate at ply %s of the line; after their first move their best: mate %s' % (f[0] + 1, e['mate'])
        return T(note) if (e['mate'] or 0) > 0 or e['win'] >= 85 else M('not forced: ' + note)
    return v


def piece_saved(R):
    """V1.9's saving try: the piece it moves is not lost where Stockfish's line from after it settles"""
    c = try_line(R)
    if not c:
        return None, 'no try'
    b0 = chess.Board(c[0])
    x = chess.Move.from_uci(c[1])
    p = b0.piece_at(x.from_square)
    s = chk.settled_delta(c[0], R.color, [c[1]], DEEP)
    ln = [c[1]] + s['pv'][:(s.get('at') or 10) + 2]
    plies, _ = walk(c[0], ln)
    sq, lost = x.to_square, False
    for b, y in plies[1:]:
        if b.piece_at(y.from_square).color == R.color and y.from_square == sq:
            sq = y.to_square
        elif b.piece_at(y.from_square).color != R.color and y.to_square == sq:
            lost = True
            break
    return (not lost), 'the %s moved to %s, %s along %s' % (PNAME[p.piece_type], chess.square_name(x.to_square), 'taken' if lost else 'standing', ' '.join(ln[:10]))


def h_safe_but(R, m, text):
    ok, note = piece_saved(R)
    if ok is None:
        return U(note)
    if not ok:
        return F('"Safe": ' + note)
    rest = m.group(1)
    c = try_line(R)
    mb = re.match(r'^(the game is even|White is better|Black is better|White is winning|Black is winning) now\.$', rest)
    if mb:
        e = ev(after(c[0], c[1]).fen(), R.color, DEEP)
        v = band_verdict(e['win'], band_word(mb.group(1), R.opp), 'player %.0f%% after the try; %s' % (e['win'], note))
        return v
    if rest == "there's a stronger move.":
        wt, wb = two(c[0], c[1], R.due(), R.color)
        return (T if wb - wt > 3 else F)('try %.0f%%, best %.0f%%; %s' % (wt, wb, note))
    # an event: "Safe, but then Rxf5 takes your queen." / "Safe, but their pawn will become a queen."
    ev_text = rest[0].upper() + rest[1:]
    fn, mm = table(REASON, ev_text)
    if fn:
        v = fn(R, mm, ev_text)
        return (v[0], note + '; ' + v[1])
    return U('"Safe, but" form not read: ' + rest)


def h_safe_only(R, m, text):
    ok, note = piece_saved(R)
    if ok is None:
        return U(note)
    if not ok:
        return F('"Safe": ' + note)
    c = try_line(R)
    e = ev(after(c[0], c[1]).fen(), R.color, DEEP)
    n = int(m.group(1))
    d = abs(e['win'] - n)
    note = '%s; the player %.0f%% (the words %s%%)' % (note, e['win'], n)
    if d <= TOL:
        return T(note)
    return ('noise', note) if d <= 10 else F(note)


def table(tbl, text):
    for rx, fn in tbl:
        mm = re.match(rx, text)
        if mm:
            return fn, mm
    return None, None


REASON = [
    (r'^Safe, but only (\d+)% for you\.$', h_safe_only),
    (r'^Safe, but (.+)$', h_safe_but),
    (r'^After (\S+) (\S+), (\S+) forks\.$', h_back_fork),
    (r'^After (\S+) (\S+), (\S+) is mate\.$', h_back_mate),
    (r'^Then (\S+) forks (both \w+s|\w+ and \w+)\.$', h_then_fork),
    (r'^Then their ' + PIECE + r' forks (both \w+s|\w+ and \w+)\.$', h_then_fork_words),
    (r'^Then their ' + PIECE + r' takes your ' + PIECE + r'\.$', h_later_words),
    (r'^Then (\S+) takes your ' + PIECE + r'\.$', h_later_san),
    (r'^Then (\S+) forces mate\.$', h_forces_mate),
    (r'^Then they can force checkmate\.$()', h_forces_mate),
    (r'^Then (\S+): their pawn becomes a (queen|rook|bishop|knight)\.$', h_promo_san),
    (r'^Their pawn will become a (queen|rook|bishop|knight)\.$', h_promo),
    (r'^Then (.+) is checkmate\.$', h_then_mate_line),
    (r'^After (.+), (you are still better)\.$', h_after_band),
]


# ── V2.3: hints ─────────────────────────────────────────────────────────────
def piece_moves_wins(R):
    """the circled piece's legal moves on the card's board, each scored side by side (1M nodes)"""
    due = R.due()
    b = chess.Board(R.st)
    fr = chess.Move.from_uci(due).from_square
    ms = [x.uci() for x in b.legal_moves if x.from_square == fr]
    out = []
    for u in ms:
        e = chk.eval_side(R.st, DEEP, R.color, searchmoves=[u])
        out.append((e['win'], u))
    out.sort(reverse=True)
    return out


def h_only_one(R, m, text):
    word = m.group(1)
    b = chess.Board(R.st)
    due = R.due()
    p = b.piece_at(chess.Move.from_uci(due).from_square)
    if not p or PNAME[p.piece_type] != word:
        return F('the circled piece is a %s' % (p and PNAME[p.piece_type]))
    ws = piece_moves_wins(R)
    if len(ws) < 2:
        return F('the %s has %s legal moves' % (word, len(ws)))
    note = ', '.join('%s %.0f%%' % (u, w) for w, u in ws[:4])
    gap = ws[0][0] - ws[1][0]
    if ws[0][1] != due and abs(ws[0][0] - ws[1][0]) > 2:
        return M('the best %s move is %s, not the answer %s: %s' % (word, ws[0][1], due, note))
    if gap >= 8:
        return T(note)
    if gap >= 4:
        return ('noise', note)
    return M('another %s move holds about as well: %s' % (word, note))


def h_win_their(R, m, text):
    word = m.group(1)
    best = R.best
    b = chess.Board(R.pre)
    s = chk.settled_delta(R.pre, R.color, [best], DEEP)
    ln = [best] + s['pv'][:(s.get('at') or 10) + 2]
    plies, _ = walk(R.pre, ln)
    took = [PNAME[bb.piece_at(x.to_square).piece_type] for bb, x in plies if bb.piece_at(x.from_square).color == R.color and bb.piece_at(x.to_square) and bb.piece_at(x.to_square).color != R.color]
    note = 'the answer %s: deep line %s, net %s, takes %s' % (best, ' '.join(ln[:10]), s['delta'], took)
    need = 1 if word == 'pawn' else 2
    if word in took and s['delta'] >= need - 0.5:
        return T(note)
    e = ev(after(R.pre, best).fen(), R.color, DEEP)
    if word in took and e['win'] >= 75:
        return T(note + ' (winning: %.0f%%)' % e['win'])
    if word in took:
        return M('it takes the %s, but nets %s: ' % (word, s['delta']) + note)
    return F(note)


def two_threats_check(R, mate_sq=None, mate_san=None, cap_san=None, piece=None):
    b = chess.Board(R.pre)
    x = chk.null(b)
    mates = chk.mates_in_one(x)
    if mate_san:
        y = parse_move(x, mate_san)
        if not y or y not in mates:
            return F('%s is no mate for them on the card\'s board' % mate_san)
    elif mate_sq:
        if not [y for y in mates if chess.square_name(y.to_square) == mate_sq]:
            return F('no mate on %s' % mate_sq)
    elif not mates:
        return F('they have no mate in one on the card\'s board')
    caps = []
    for y in x.legal_moves:
        v = x.piece_at(y.to_square)
        if v and v.color == R.color and chk.see_capture(x, y) > 0 and (not piece or v.piece_type == NAME[piece]):
            caps.append(y)
    if cap_san:
        z = parse_move(x, cap_san)
        if not z or not x.is_capture(z):
            return F('%s is no capture for them' % cap_san)
        if chk.see_capture(x, z) <= 0:
            return M('%s takes, but it does not pay for them' % cap_san)
        return T('mate %s and %s' % ([y.uci() for y in mates], z.uci()))
    if not caps:
        return F('no %s of yours to win' % (piece or 'piece'))
    return T('mate %s and %s' % ([y.uci() for y in mates], [y.uci() for y in caps]))


def h_two_threats_san(R, m, text):
    return two_threats_check(R, mate_san=m.group(1), cap_san=m.group(2))


def h_two_threats_sq(R, m, text):
    return two_threats_check(R, mate_sq=m.group(1), cap_san=m.group(2))


def h_stop_guard(R, m, text):
    return two_threats_check(R, piece=m.group(1))


def foil_lines(R):
    e = chk.eval_side(R.pre, DEEP, R.color, multipv=2)
    ls = e['lines']
    flip = chess.Board(R.pre).turn != R.color
    return [(win_pct(chk.line_score(l, flip)), l['pv'][0] if l['pv'] else None) for l in ls]


def h_only_move_here(R, m, text):
    ls = foil_lines(R)
    if len(ls) < 2:
        return T('one legal move')
    note = ', '.join('%s %.0f%%' % (u, w) for w, u in ls)
    gap = ls[0][0] - ls[1][0]
    if gap >= 8:
        return T(note)
    return ('noise', note) if gap >= 4 else M('the next move holds about as well: ' + note)


def h_only_move_game(R, m, text):
    ls = foil_lines(R)
    note = ', '.join('%s %.0f%%' % (u, w) for w, u in ls) + '; game move %s' % R.played
    if ls[0][1] != R.played:
        wt, wb = two(R.pre, R.played, ls[0][1], R.color)
        if wb - wt > 2:
            return F('the game move is not the best: ' + note)
    if len(ls) < 2:
        return T(note)
    gap = ls[0][0] - ls[1][0]
    if gap >= 8:
        return T(note)
    return ('noise', note) if gap >= 4 else M('the next move holds about as well: ' + note)


def null_threat(R, san, word, verb):
    b = chess.Board(R.pre)
    x = chk.null(b)
    y = words_move(x, san)
    if not y:
        return F('%s is not legal for them were it their move' % san)
    s = chk.settled_delta(x.fen(), not R.color, [y.uci()], DEEP)
    ln = [y.uci()] + s['pv'][:(s.get('at') or 10) + 2]
    plies, _ = walk(x.fen(), ln)
    took = [PNAME[bb.piece_at(z.to_square).piece_type] for bb, z in plies if bb.piece_at(z.from_square).color != R.color and bb.piece_at(z.to_square) and bb.piece_at(z.to_square).color == R.color]
    note = 'were it their move, %s: deep line %s, they net %s, take %s' % (y.uci(), ' '.join(ln[:10]), s['delta'], took)
    if word and word not in took:
        return F(note)
    if s['delta'] >= (1 if word in ('pawn', None) else 2) - 0.5:
        return T(note)
    return M('they take it, but net %s: ' % s['delta'] + note)


def h_threat_wins(R, m, text):
    return null_threat(R, m.group(1) or m.group(3), m.group(5), m.group(2) or m.group(4))


def h_hint_added(R, m, text):
    """a toast about the hint count ("Hint 2 added.") or an instruction ("Find the next move."): no chess claim"""
    return N('the hint count, or an instruction')


def h_any_good(R, m, text):
    """a foil's Hint 2 "Any good move passes here." (V2.6, where the foil look finds no only move and no
    threat): more than one move holds, the next best within 10 points of the best (the foil's only-move
    line), side by side at the budget"""
    ls = foil_lines(R)
    if len(ls) < 2:
        return F('one legal move')
    note = ', '.join('%s %.0f%%' % (u, w) for w, u in ls)
    gap = ls[0][0] - ls[1][0]
    if gap < 10:
        return T('the next best within %.0f points: %s' % (gap, note))
    return ('noise', note) if gap < 10 + TOL else F('only one move holds: ' + note)


def h_can_promote(R, m, text):
    """a foil's Hint 2 "Their pawn can promote." / "Their pawn can become a queen.": were it their move, a
    promotion is legal and their line after it wins material (the app's foil threat rule)"""
    x0 = chk.null(chess.Board(R.pre))
    want = NAME[m.group(1)] if m.group(1) else None
    proms = [y for y in x0.legal_moves if y.promotion and (want is None or y.promotion == want)]
    if not proms:
        return F('no promotion for them were it their move')
    notes = []
    for y in proms:
        s = chk.settled_delta(x0.fen(), not R.color, [y.uci()], DEEP)
        notes.append('%s nets them %s (%s)' % (y.uci(), s['delta'], ' '.join(s['pv'][:6])))
        if s['delta'] >= 1 or (s['mate'] or 0) > 0:
            return T('; '.join(notes))
    return M('the pawn can promote, but loses it: ' + '; '.join(notes))


HINT = [
    (r'^Their pawn can (?:promote|become a ' + PIECE + r')\.$', h_can_promote),
    (r'^(?:Only one|One) ' + PIECE + r' move (?:is best|holds)\.$', h_only_one),
    (r'^You can win their ' + PIECE + r'\.$', h_win_their),
    (r'^Two threats: (\S+) mate and (\S+)\.$', h_two_threats_san),
    (r'^Two threats: mate on ([a-h][1-8]) and (\S+)\.$', h_two_threats_sq),
    (r'^Stop the mate(?:,| and) guard your ' + PIECE + r'\.$', h_stop_guard),
    (r'^Only one move holds here\.$', h_only_move_here),
    (r'^(?:Their threat: (\S+) (wins)|(\S+) (would win|would take)) your ' + PIECE + r'\.$', h_threat_wins),
    (r'^Hint \d added\.$', h_hint_added),
    (r'^Find the next move\.$', h_hint_added),
    (r'^Any good move passes here\.$', h_any_good),
]


# ── V2.4: the answer's one reason ──────────────────────────────────────────
def reason_check(R, mv_text, pred, base=None):
    """the reason pred ("saves your queen", "guards f2 and your knight", "stops the mate", "stops their
    pawn", "stops Rh4+", "traps their queen", "wins a rook", "wins ♜♝", "blocks the check", "attacks their
    queen", "forces mate", "keeps the game level: 48%") of the move mv_text, on base (the card's board)"""
    fen = base or R.pre
    b = chess.Board(fen)
    x = words_move(b, mv_text)
    if not x:
        return F('%s is not legal on the card\'s board' % mv_text)
    a = b.copy(stack=False)
    a.push(x)
    p = pred.strip()
    m = re.match(r'^saves your ' + PIECE + r'$', p)
    if m:
        t = NAME[m.group(1)]
        if not [q for q in pieces_of(b, R.color, t) if chk.in_danger(b, q)]:
            return F('"saves": your %s was not in danger' % m.group(1))
        # release 2's C5 (e): the danger confirmed by a search, not the exchange alone
        if not [q for q in pieces_of(b, R.color, t) if chk.in_danger_deep(b, q, DEEP)]:
            return M('"saves": the exchange puts your %s in danger, but no capture of it nets them material at depth' % m.group(1))
        s = chk.settled_delta(fen, R.color, [x.uci()], DEEP)
        lost = lost_types(fen, [x.uci()] + s['pv'][:(s.get('at') or 10) + 2], R.color)
        return (F if t in lost else T)('its line loses %s' % [PNAME[q] for q in lost])
    m = re.match(r'^guards (.+)$', p)
    if m:
        items = re.split(r', | and ', m.group(1).replace('your ', ''))
        errs = []
        for it in items:
            it = it.strip()
            if re.match(r'^[a-h][1-8]$', it):
                q = chess.parse_square(it)
                if x.to_square not in [s for s in [x.to_square]] or q not in a.attacks(x.to_square):
                    errs.append('%s does not cover %s' % (x.uci(), it))
            elif it in NAME:
                qs = [q for q in pieces_of(a, R.color, NAME[it]) if q in a.attacks(x.to_square)]
                if not qs:
                    errs.append('the moved piece guards no %s' % it)
            else:
                errs.append('form: ' + it)
        return F('; '.join(errs)) if errs else T('guards ' + m.group(1))
    # B4: tier 1's words for "g6 stops Bxg7+.": "Pawn to g6 stops their bishop check." (a check by that
    # piece on the board before the move, them to move, that the move takes away)
    mck = re.match(r'^stops their (\w+) check$', p)
    if mck:
        nb0 = chk.null(b)
        before = [y for y in nb0.legal_moves if nb0.gives_check(y) and nb0.is_capture(y) and PNAME[nb0.piece_at(y.from_square).piece_type] == mck.group(1)]
        if not before:
            return F('no %s check of theirs before %s' % (mck.group(1), x.uci()))
        # (the check is the capture the threat names, "Bxg7+": taken away where it no longer takes with check)
        gone = [y for y in before if y not in a.legal_moves or not a.gives_check(y) or not a.is_capture(y)]
        return (T if gone else F)('their %s checks %s; after %s still: %s' % (mck.group(1), [y.uci() for y in before], x.uci(), [y.uci() for y in before if y not in gone]))
    if p == 'stops the mate':
        n0 = chk.mates_in_one(chk.null(b))
        n1 = chk.mates_in_one(a) if a.turn != R.color else []
        if not n0:
            return F('they had no mate in one before it')
        return (T if not n1 else F)('their mates before %s, after %s' % ([y.uci() for y in n0], [y.uci() for y in n1]))
    if p == 'stops their pawn':
        e0 = ev(chk.null(b).fen(), not R.color, DEEP)
        prom0 = any(chess.Move.from_uci(u).promotion for u in e0['pv'][:12])
        e1 = ev(a.fen(), R.color, DEEP)
        prom1 = any(chess.Move.from_uci(u).promotion for u in e1['pv'][:12] if len(u) == 5)
        note = 'were it their move: %s (%s); after it the player %.0f%% (%s)' % ('promotes' if prom0 else 'no promotion', ' '.join(e0['pv'][:8]), e1['win'], ' '.join(e1['pv'][:8]))
        if e1['win'] >= 40 - TOL and not prom1:
            return T(note)
        return M(note)
    m = re.match(r'^stops (their threat|\S+)$', p)
    if m:
        x0 = chk.null(b)
        if m.group(1) == 'their threat':
            before = [y for y in x0.legal_moves if (x0.is_capture(y) and chk.see_capture(x0, y) > 0) or y in chk.mates_in_one(x0)]
            if not before:
                # a threat that wins by a line (Nxd4 exd4, then the knight the pawn guarded): their
                # best line on the null board wins material, and its first move no longer does after
                s0 = chk.settled_delta(x0.fen(), not R.color, [], DEEP)
                if s0['pv'] and (s0['delta'] >= 1 or (s0['mate'] or 0) > 0):
                    y0 = chess.Move.from_uci(s0['pv'][0])
                    note0 = 'their line before it %s wins %s' % (' '.join(s0['pv'][:6]), s0['delta'])
                    if a.turn != R.color and y0 in a.legal_moves:
                        s1 = chk.settled_delta(a.fen(), not R.color, [y0.uci()], DEEP)
                        if s1['delta'] >= 1 or (s1['mate'] or 0) > 0:
                            return F(note0 + '; after it %s still wins %s (%s)' % (y0.uci(), s1['delta'], ' '.join(s1['pv'][:6])))
                        return T(note0 + '; after it %s wins %s (%s)' % (y0.uci(), s1['delta'], ' '.join(s1['pv'][:6])))
                    return T(note0 + '; not legal after it')
                return F('no winning capture, mate or winning line for them before it (%s, %s)' % (' '.join(s0['pv'][:6]), s0['delta']))
            gone = []
            for y in before:
                y1 = chess.Move.from_uci(y.uci())
                if a.turn != R.color and y1 in a.legal_moves:
                    z1 = a.copy(stack=False)
                    z1.push(y1)
                    if z1.is_checkmate() or (a.is_capture(y1) and chk.see_capture(a, y1) > 0):
                        continue
                gone.append(y.uci())
            return (T if gone else F)('their threats before it %s, stopped %s' % ([y.uci() for y in before], gone))
        y = words_move(x0, m.group(1))
        if not y:
            return F('%s is not legal for them before it' % m.group(1))
        z = x0.copy(stack=False)
        z.push(y)
        good0 = z.is_checkmate() or (x0.is_capture(y) and chk.see_capture(x0, y) > 0) or z.is_check()
        if not good0:
            s0 = chk.settled_delta(x0.fen(), not R.color, [y.uci()], DEEP)
            good0 = s0['delta'] >= 1
        if not good0:
            return F('%s won nothing before it' % m.group(1))
        y1 = chess.Move.from_uci(y.uci())
        if a.turn != R.color and y1 in a.legal_moves:
            z1 = a.copy(stack=False)
            z1.push(y1)
            if z1.is_checkmate():
                return F('%s still mates after it' % m.group(1))
            s1 = chk.settled_delta(a.fen(), not R.color, [y1.uci()], DEEP)
            if s1['delta'] >= 1:
                return F('%s still wins %s after it' % (m.group(1), s1['delta']))
        return T('%s worked before it, not after' % m.group(1))
    m = re.match(r'^traps their ' + PIECE + r'$', p)
    if m:
        t = NAME[m.group(1)]
        qs = pieces_of(a, not R.color, t)
        if not qs:
            return F('they have no %s' % m.group(1))
        return gain_check(fen, R.color, [x.uci()], 3 if t != chess.PAWN else 1, 'trap')
    m = re.match(r'^wins (.+)$', p)
    if m:
        claimed = H1.piece_val_words(m.group(1)) if m.group(1) != 'material' else 1
        v = gain_check(fen, R.color, [x.uci()], claimed)
        if v[0] != 'true':
            return v
        e = ev(a.fen(), R.color, DEEP)
        return v if e['win'] >= 60 - TOL else M('it wins %s, but the player is not better (%.0f%%): ' % (m.group(1), e['win']) + v[1])
    if p == 'blocks the check':
        if not b.is_check():
            return F('not in check')
        k = b.king(R.color)
        chks = list(b.checkers())
        return (T if chks and x.to_square in chess.SquareSet(chess.between(chks[0], k)) else F)('')
    m = re.match(r'^attacks their ' + PIECE + r'$', p)
    if m:
        qs = [q for q in a.attacks(x.to_square) if a.piece_at(q) and a.piece_at(q).color != R.color and a.piece_at(q).piece_type == NAME[m.group(1)]]
        return (T if qs else F)('attacks %s' % [chess.square_name(q) for q in qs])
    if p in ('forces mate', 'forces checkmate'):
        e = ev(a.fen(), R.color, DEEP)
        return (T if a.is_checkmate() or (e['mate'] or 0) > 0 else F)('mate %s' % e['mate'])
    m = re.match(r'^(keeps you better|keeps the game level|limits the damage)(?:: (\d+)%)?$', p)
    if m:
        e = ev(a.fen(), R.color, DEEP)
        band = {'keeps you better': 'still better', 'keeps the game level': 'even'}.get(m.group(1))
        note = 'player %.0f%% after it' % e['win']
        if m.group(2) and abs(e['win'] - int(m.group(2))) > TOL:
            return ('noise' if abs(e['win'] - int(m.group(2))) <= 10 else 'false', note + ' (the figure %s%%)' % m.group(2))
        if band:
            return band_verdict(e['win'], band, note)
        return T(note) if e['win'] < 40 + TOL else M(note + ' (no damage to limit)')
    return U('reason not read: ' + p)


REASONS = r'(saves your \w+|guards .+|stops .+|traps their \w+|wins .+|blocks the check|attacks their \w+|forces (?:mate|checkmate)|keeps you better(?:: \d+%)?|keeps the game level(?:: \d+%)?|limits the damage(?:: \d+%)?)'
SUBJ = r"((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?|(?:King|Queen|Rook|Bishop|Knight|Pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a \w+)?|Castling(?: on the (?:king|queen)'s side)?)"



def h_reason_row(R, m, text):
    return reason_check(R, m.group(1), m.group(2))


def h_reason_lost(R, m, text):
    v = reason_check(R, m.group(1), m.group(2))
    return v


def h_reason_missed(R, m, text):
    v = reason_check(R, m.group(1), m.group(2))
    b = chess.Board(R.pre)
    g = words_move(b, m.group(3))
    if not g or g.uci() != R.played:
        return F('%s is not the game move' % m.group(3))
    return v


SETTLED = [
    (r'^' + SUBJ + r' ' + REASONS + r'\.$', h_reason_row),
    (r'^' + SUBJ + r' ' + REASONS + r'\. (\S+) missed it\.$', h_reason_missed),
]


# ── See why: B1's reason, the fork, tier 3's line figure ───────────────────
def story_v2(R, m, text):
    s = R.step or {}
    mb = re.match(r'^Better: ' + SUBJ + r'\. It ' + REASONS + r'\.$', text, re.I)
    if mb:
        return reason_check(R, mb.group(1), mb.group(2), base=s.get('before'))
    mf = re.match(r'^(?:(\S+?)|(Your|Their) (\w+)) forks (?:(your|their) (\w+) and (\w+)|both (your|their) (\w+)s)\.$', text)
    if mf and s.get('before') and s.get('move'):
        b = chess.Board(s['before'])
        x = chess.Move.from_uci(s['move'])
        mover = b.piece_at(x.from_square)
        tg = fork_of(b, x, mover.color)
        y = b.copy(stack=False)
        y.push(x)
        got = sorted(PNAME[y.piece_at(t).piece_type] for t in tg)
        names = [mf.group(5), mf.group(6)] if mf.group(5) else [mf.group(8), mf.group(8)]
        for n in names:
            if n not in got:
                return F('the ply attacks %s, not %s' % (got, names))
        return T('forks %s' % got)
    ml = re.match(r'^((?:\S+ )*\S+): (\d+)%\.$', text)
    if ml and s.get('line'):
        ln = s['line']
        b = chess.Board(ln['start'])
        moves = ln['moves']
        ok = True
        for u in moves:
            if u == '0000':
                b.push(chess.Move.null())
                continue
            mm = chess.Move.from_uci(u)
            if mm not in b.legal_moves:
                ok = False
                break
            b.push(mm)
        e = chk.eval_side(R.pre, DEEP, R.color, searchmoves=[R.best])
        n = int(ml.group(2))
        note = 'the answer %s: %.0f%% (the figure %s%%)' % (R.best, e['win'], n)
        d = abs(e['win'] - n)
        return T(note) if d <= TOL else ('noise', note) if d <= 10 else F(note)
    return None


# ── Details ────────────────────────────────────────────────────────────────
def threat_ok(R, x, san):
    y = words_move(x, san)
    if not y:
        return None, '%s is not legal for them' % san
    z = x.copy(stack=False)
    z.push(y)
    if z.is_checkmate():
        return True, '%s mates' % san
    if x.is_capture(y):
        if chk.see_capture(x, y) > 0:
            return True, '%s wins %s' % (san, chk.see_capture(x, y))
    s = chk.settled_delta(x.fen(), not R.color, [y.uci()], DEEP)
    return s['delta'] >= 1, '%s: they net %s (%s)' % (san, s['delta'], ' '.join(s['pv'][:6]))


def threat_still(R, a, x0, y):
    """after the game move (board a, their move), the threat y (a move on the null position x0) still
    stands, read as a player reads "met": the same move still works; or, for a mate, any mate in one is
    left them; or the game move gave check and the threat's piece and target are where they were; or,
    for a capture, its target still stands in danger (where it was, or where the game move took it)"""
    z = x0.copy(stack=False)
    z.push(y)
    is_mate = z.is_checkmate()
    tgt = x0.piece_at(y.to_square)
    y1 = chess.Move.from_uci(y.uci())
    works = False
    if y1 in a.legal_moves:
        w = a.copy(stack=False)
        w.push(y1)
        if is_mate:
            works = w.is_checkmate()
        elif tgt:
            works = a.piece_at(y.to_square) == tgt and chk.see_capture(a, y1) > 0
    if works:
        return True, '%s still works' % y.uci()
    if is_mate and chk.mates_in_one(a):
        return True, 'a mate in one left them: %s' % [w.uci() for w in chk.mates_in_one(a)]
    if a.is_check() and a.piece_at(y.from_square) == x0.piece_at(y.from_square) and (not tgt or a.piece_at(y.to_square) == tgt):
        return True, 'the game move checks; the threat waits a move'
    if tgt and tgt.color == R.color:
        sq = y.to_square
        gm = chess.Move.from_uci(R.played)
        if gm.from_square == sq:
            sq = gm.to_square
        if a.piece_at(sq) == tgt and chk.in_danger(a, sq):
            return True, 'the %s on %s still in danger' % (PNAME[tgt.piece_type], chess.square_name(sq))
        return False, 'the %s is safe now' % PNAME[tgt.piece_type]
    return False, '%s no longer works' % y.uci()


def h_threats_line(R, m, text):
    t1, t2, met = m.group(1), m.group(2), m.group(3)
    t1 = re.sub(r' mate$', '', t1)
    b = chess.Board(R.pre)
    x = chk.null(b)
    ok1, n1 = threat_ok(R, x, t1)
    ok2, n2 = threat_ok(R, x, t2)
    if not ok1 or not ok2:
        return F('before the game move: %s; %s' % (n1, n2))
    a = after(R.pre, R.played)
    st, notes = [], []
    for t in (t1, t2):
        y = words_move(x, t)
        v, n = threat_still(R, a, x, y)
        st.append(v)
        notes.append(n)
    note = 'before: %s; %s. After the game move: %s (%s)' % (n1, n2, st, '; '.join(notes))
    want = {'neither': [True, True], 'both': [False, False]}.get(met)
    if met.startswith('only '):
        nm = met[5:]
        want = [False, True] if nm in ('the mate', t1, t1 + ' mate') else [True, False] if nm == t2 else None
    if want is None:
        return U('"met %s" not read' % met)
    return T(note) if st == want else F(note)


def h_threats_bare(R, m, text):
    t1, t2 = re.sub(r' mate$', '', m.group(1)), m.group(2)
    x = chk.null(chess.Board(R.pre))
    ok1, n1 = threat_ok(R, x, t1)
    ok2, n2 = threat_ok(R, x, t2)
    return (T if ok1 and ok2 else F)('before the game move: %s; %s' % (n1, n2))


def h_threats_words(R, m, text):
    b = chess.Board(R.pre)
    x = chk.null(b)
    mates = chk.mates_in_one(x)
    mm = re.match(r'^checkmate on ([a-h][1-8])$', m.group(1))
    if mm and not [y for y in mates if chess.square_name(y.to_square) == mm.group(1)]:
        return F('no mate on %s' % mm.group(1))
    return T('mates %s' % [y.uci() for y in mates])


def h_opp_missed(R, m, text):
    g = R.gply()
    word = m.group(m.lastindex)
    fen = R.games.fen_at(R.key, g + 2) if hasattr(R.games, 'fen_at') else None
    if not fen:
        return U('no game')
    e = ev(fen, R.color, DEEP)
    note = 'after their move the player has %.0f%%' % e['win']
    if word == 'ahead':
        return T(note) if e['win'] < 45 + TOL else F(note)
    if word == 'winning':
        return T(note) if e['win'] < 20 + TOL else ('noise', note) if e['win'] < 30 + TOL else F(note)
    return U(note)


def h_after_mate(R, m, text):
    b = chess.Board(R.pre)
    x = words_move(b, m.group(1))
    if not x or x.uci() != R.played:
        return F('%s is not the game move' % m.group(1))
    a = b.copy(stack=False)
    a.push(x)
    y = words_move(a, m.group(2))
    if not y:
        return F('%s is not legal after it' % m.group(2))
    a.push(y)
    return (T if a.is_checkmate() else F)('')


def h_stays_defended(R, m, text):
    b = chess.Board(R.pre)
    x = words_move(b, m.group(1))
    if not x:
        return F('%s not legal' % m.group(1))
    a = b.copy(stack=False)
    a.push(x)
    q = chess.parse_square(m.group(3))
    p = a.piece_at(q)
    if not p or p.color != R.color or PNAME[p.piece_type] != m.group(2):
        return F('no %s of yours on %s' % (m.group(2), m.group(3)))
    g = chk.guards(a, q)
    return (T if g else F)('guarded by %s' % [chess.square_name(s) for s in g])


def h_line_attacks(R, m, text):
    if m.group(4) and m.group(5):
        wt, wb = two(R.pre, R.played, R.best, R.color)
        if abs(wb - int(m.group(4))) > 10 or abs(wt - int(m.group(5))) > 10:
            return M('figures off: deep best %.0f%%, game move %.0f%%' % (wb, wt))
    if m.group(6):
        ml = re.match(r'^You (?:could )?lose (.+)\.$', m.group(6))
        if ml:
            claimed = H1.piece_val_words(ml.group(1)) if ml.group(1) != 'material' else None
            v = loss_check(R.pre, R.color, [R.played], claimed)
            if v[0] != 'true':
                return (v[0], 'the loss: ' + v[1])
    b = chess.Board(R.pre)
    a = b.copy(stack=False)
    a.push(chess.Move.from_uci(R.played))
    y = words_move(a, m.group(1))
    if not y:
        return F('%s is not legal after the game move' % m.group(1))
    a.push(y)
    errs = []
    for part in re.split(r' and ', m.group(3)):
        part = part.strip()
        mp = re.match(r'^your ' + PIECE + r'$', part)
        ms = re.match(r'^the ([a-h][1-8]) ' + PIECE + r'$', part)
        if mp:
            if not [q for q in pieces_of(a, R.color, NAME[mp.group(1)]) if a.attackers(not R.color, q)]:
                errs.append('your %s is not attacked' % mp.group(1))
        elif ms:
            q = chess.parse_square(ms.group(1))
            p = a.piece_at(q)
            if not p or p.color != R.color or PNAME[p.piece_type] != ms.group(2) or not a.attackers(not R.color, q):
                errs.append('the %s %s is not attacked' % (ms.group(1), ms.group(2)))
        else:
            errs.append('form ' + part)
    return F('; '.join(errs)) if errs else T('')


def h_found_it(R, m, text):
    import handlers2 as H2
    real, best, e = H2.found_in_game(R)
    if not real:
        return U('no game reply')
    if best and real != best:
        a = after(R.pre, R.played)
        wr, wbb = two(a.fen(), real, best, not R.color)
        if wr < wbb - 8:
            return M('"found" but their reply %s (%.0f%%) was not the punishment %s (%.0f%%)' % (real, wr, best, wbb))
    return T('real reply %s, best %s' % (real, best))


def h_back_game(R, m, text):
    import handlers2 as H2
    real, best, e = H2.found_in_game(R)
    if not real:
        return U('no game reply')
    if real == best:
        return F('they did play the best reply')
    a = after(R.pre, R.played, real)
    w = ev(a.fen(), R.color, DEEP)['win']
    note = 'after their %s the player has %.0f%%' % (real, w)
    if w >= 40 - TOL:
        return T(note)
    return M('"back in the game", but ' + note)


def h_threat_wins_d(R, m, text):
    word = m.group(2)
    piece = word[5:] if word.startswith('your ') else None
    v = null_threat(R, m.group(1), piece, 'wins')
    if piece is None and v[0] == 'false' and 'take' in v[1]:
        return v
    return v


def h_chances_pair(R, m, text):
    x, y = int(m.group(1)), int(m.group(2))
    wt, wb = two(R.pre, R.played, R.best, R.color)
    note = 'deep: before (the best) %.0f%%, after the game move %.0f%%' % (wb, wt)
    if abs(wb - x) > 10 or abs(wt - y) > 10:
        return M('figures off: ' + note)
    return T(note)


DETAILS = [
    (r'^Their threats: (\S+(?: mate)?), (\S+)\. \S+ met (neither|both|only .+)\.$', h_threats_line),
    (r'^Their threats: (\S+(?: mate)?), (\S+)\.$', h_threats_bare),
    (r'^Their threats: (checkmate on [a-h][1-8]|.+?), and .+\.$', h_threats_words),
    (r'^Your opponent missed it, but (?:after \S+ )?they were still (ahead|winning)\.$', h_opp_missed),
    (r'^After (.+?), (.+?) is mate\.$', h_after_mate),
    (r'^After (.+?), the (pawn|knight|bishop|rook|queen) on ([a-h][1-8]) stays defended\.$', h_stays_defended),
    (r'^After (\S+|.+? (?:to|takes on) [a-h][1-8]), (White|Black) attacks (.+?)(?: \((\d+)% to (\d+)%\))?\.(?: (.+))?$', h_line_attacks),
    (r'^Your opponent found it right away\.$', h_found_it),
    (r'^Your opponent missed it(?:\. They played (\S+) and|, and) you were back in the game\.$', h_back_game),
    (r'^(.+) (saves|keeps) your ' + PIECE + r'( and ' + PIECE + r')?\.( (.+) (lost|could lose) (it|them)\.)?$', lambda R, m, t: __import__('handlers2').h_saves(R, m, t)),
    (r'^' + SUBJ + r' ' + REASONS + r'\. (\S+) missed it\.$', h_reason_missed),
    (r'^Their threat: (\S+|.+? (?:to|takes on) [a-h][1-8]) wins (material|your \w+)\.$', h_threat_wins_d),
    (r'^' + SUBJ + r' ' + REASONS + r'\.$', h_reason_row),
]


# ── foils ──────────────────────────────────────────────────────────────────
def h_good_too(R, m, text):
    b = chess.Board(R.pre)
    x = words_move(b, m.group(1))
    if not x or x.uci() != R.played:
        return F('%s is not the game move' % m.group(1))
    wt, wb = two(R.pre, R.played, R.best, R.color)
    note = 'game move %.0f%%, the answer %.0f%%' % (wt, wb)
    return T(note) if wb - wt <= 8 else ('noise', note) if wb - wt <= 12 else F(note)


FOIL = [
    (r'^The only move, as in your game\.$', h_only_move_game),
    (r'^Your game move (\S+) was good too\.$', h_good_too),
]


# ── See it's still marks ───────────────────────────────────────────────────
def h_event_label(R, text, lb):
    mk = lb.get('mark') or {}
    kind = mk.get('kind')
    t = R.tried or {}
    ev_ = t.get('ev') or {}
    c = try_line(R)
    if not c or not ev_:
        return U('no line')
    plies, _ = walk(after(c[0], c[1]).fen(), c[2])
    if kind == 'back':
        i = (ev_.get('backAt') or 0) - 1
        if i < 0 or i >= len(plies):
            return F('no take-back on the line')
        b, x = plies[i]
        if text != 'you take back' or x.uci() != ev_.get('back') or not b.is_capture(x) or b.piece_at(x.from_square).color != R.color:
            return F('%s is not your take-back' % x.uci())
        return T('you take back with %s' % x.uci())
    i = (ev_.get('at') or 0) - 1
    if i < 0 or i >= len(plies):
        return F('the event is not on the line')
    b, x = plies[i]
    if chess.square_name(x.to_square) != mk.get('to'):
        return F('the arrow ends on %s, the move %s' % (mk.get('to'), x.uci()))
    y = b.copy(stack=False)
    y.push(x)
    if text == 'takes':
        v = b.piece_at(x.to_square)
        return (T if v and v.color == R.color else F)('takes %s' % (v and PNAME[v.piece_type]))
    if text == 'mate':
        return (T if y.is_checkmate() else F)('')
    if text == 'fork':
        return (T if len(fork_of(b, x, b.piece_at(x.from_square).color)) >= 2 else F)('')
    if text in NAME:
        return (T if x.promotion == NAME[text] else F)('promotes to %s' % (x.promotion and PNAME[x.promotion]))
    return U('event label %s' % text)
