"""Handlers for the forms v2 slice 1 adds (checked facts and fair grading): the found band ("Kb7 is as
good as Rxa7.", t1 "Just as good as the main answer."), works too's "The main move was Rxa7.", a forced
mate ("Kb2 forces mate.", "Only move: Kb2 forces mate.", t1 "King to b2 forces checkmate."), a forcing
line's later miss ("Nxc7+ found. Nxa8 missed later.", t1 "First move found, a later one missed."), the
saving move at More help ("That saves your queen. Look for more.") and the guess's "Close. Their best
was Rf7+." Each is checked on the board it is said on, with python-chess and Stockfish at 1M nodes."""
import re
import chess
import chk
import sf
from chk import NAME, PNAME, parse_move, after
from claims import *
from handlers import PIECE


def yours_move(R):
    """the board the player's own move was played on, that move, and the main move there"""
    y = R.ctx.get('yours') or []
    sol = R.ctx.get('sol') or []
    at = R.ctx.get('yoursAt')
    if at is None:
        at = 0
        for i, mm in enumerate(y):
            if i < len(sol) and sol[i] == mm:
                continue
            at = i
            break
    if not y or at >= len(y):
        return None
    base = after(R.pre, *y[:at]).fen()
    due = sol[at] if sol and at < len(sol) else R.best
    return base, y[at], due


def h_as_good(R, m, text):
    yo = yours_move(R)
    if not yo:
        return U('no move of yours kept')
    base, u, due = yo
    b = chess.Board(base)
    if not text.startswith('Just as good'):
        x, z = parse_move(b, m.group(1)), parse_move(b, m.group(2))
        if not x or x.uci() != u:
            return F('"%s" is not your move %s' % (m.group(1), u))
        if not z or z.uci() != due:
            return F('"%s" is not the main move %s' % (m.group(2), due))
    if u == due:
        return F('your move is the main move itself')
    # release 2's C5 (a): "as good as" understates a move that forces mate or scores 4 or more above
    up, why = ranks_above(base, u, due, R.color)
    if up:
        return F('"as good as" for a move that ranks above the main move: ' + why)
    wt, wb = two(base, u, due, R.color, DEEP)
    note = '%s %.0f%%, the main move %s %.0f%%' % (u, wt, due, wb)
    if wb - wt <= 4:
        return T(note)
    if wb - wt <= 4 + TOL:
        return ('noise', note)
    return F(note)


def h_main_move(R, m, text):
    yo = yours_move(R)
    base, u, due = yo if yo else (R.pre, None, R.best)
    b = chess.Board(base)
    z = parse_move(b, m.group(1))
    if not z:
        return F('"%s" is not a legal move here' % m.group(1))
    if z.uci() != due:
        return F('"%s" is %s, the main move is %s' % (m.group(1), z.uci(), due))
    if u and u != due:
        # release 2's C5 (a): false when your move forces mate or scores 4 or more above it
        up, why = ranks_above(base, u, due, R.color)
        if up:
            return F('"The main move was %s" under a move that ranks above it: %s' % (m.group(1), why))
        wt, wb = two(base, u, due, R.color, DEEP)
        note = 'the main move %s %.0f%%, yours %s %.0f%%' % (due, wb, u, wt)
        return T(note) if wb >= wt - 4 else M('your move is better than the main move: ' + note)
    return T('the main move %s' % due)


def mate_lines(fen, nodes=DEEP):
    r = sf.go(fen, nodes, 2, None)
    return r.get('lines') or []


def h_forces_mate(R, m, text):
    only = text.startswith('Only move: ')
    b = chess.Board(R.pre)
    x = parse_move(b, m.group(2))
    if not x or x.uci() != R.best:
        return F('"%s" is not the answer %s' % (m.group(2), R.best))
    e = sf.go(R.pre, DEEP, 1, [x.uci()])
    l0 = (e.get('lines') or [{}])[0]
    if l0.get('mate') is None or l0['mate'] <= 0:
        return F('%s does not force mate at 1M nodes (%s)' % (x.uci(), l0.get('cp')))
    note = '%s mates in %d' % (x.uci(), l0['mate'])
    if only:
        others = [l for l in mate_lines(R.pre, DEEP) if l.get('pv') and l['pv'][0] != x.uci()]
        if others and others[0].get('mate') is not None and others[0]['mate'] > 0:
            return M('"Only move": %s mates too (in %d); ' % (others[0]['pv'][0], others[0]['mate']) + note)
    return T(note)


def h_line_held(R, m, text):
    sol = R.ctx.get('sol') or []
    if len(sol) < 3:
        return U('no forcing line')
    if text.startswith('First move found'):
        return T('the line\'s first move, then a later one missed (the session\'s own record)')
    b0 = chess.Board(R.pre)
    f = parse_move(b0, m.group(1))
    if not f or f.uci() != sol[0]:
        return F('"%s" is not the line\'s first move %s' % (m.group(1), sol[0]))
    for i in range(2, len(sol), 2):
        bi = after(R.pre, *sol[:i])
        z = parse_move(bi, m.group(2))
        if z and z.uci() == sol[i]:
            return T('%s is the line\'s move %d' % (sol[i], i // 2 + 1))
    return F('"%s" is not a later move of the line' % m.group(2))


def survives(fen, sq, pv, n=12):
    """the piece on sq (after the try) is still on the board along the line, followed as it moves, to
    where the line first settles (two quiet plies) and to n plies: (first, full)"""
    b = chess.Board(fen)
    col = b.piece_at(sq).color if b.piece_at(sq) else None
    first = None
    quiet = 0
    for i, u in enumerate(pv[:n]):
        mv = chess.Move.from_uci(u)
        if mv not in b.legal_moves:
            break
        cap = b.is_capture(mv)
        tsq = mv.to_square
        if b.is_en_passant(mv):
            tsq = mv.to_square + (-8 if b.turn == chess.WHITE else 8)
        if b.turn == col and mv.from_square == sq:
            sq = mv.to_square
        elif b.turn != col and tsq == sq:
            if first is None:
                first = False
            return first, False
        chkd = b.gives_check(mv)
        b.push(mv)
        quiet = quiet + 1 if not cap and not chkd and not mv.promotion else 0
        if quiet >= 2 and first is None:
            first = True
    return (True if first is None else first), True


def h_saves_more(R, m, text):
    t = R.tried
    if not t.get('uci'):
        return U('no try')
    b = chess.Board(R.pre)
    u = chess.Move.from_uci(t['uci'])
    p = b.piece_at(u.from_square)
    want = NAME[m.group(1)]
    if not p or p.piece_type != want:
        return F('the try moves the %s' % (PNAME[p.piece_type] if p else 'nothing'))
    # in danger before the try: their capture of it wins material (on the null-move board)
    nb = chk.null(b)
    danger = any(nb.is_capture(c) and c.to_square == u.from_square and chk.see_capture(nb, c) > 0 for c in nb.legal_moves)
    a = after(R.pre, t['uci'])
    e = ev(a.fen(), not R.color, DEEP)
    first, full = survives(a.fen(), u.to_square, e['pv'] or [])
    wt, wb = two(R.pre, t['uci'], R.best, R.color, DEEP)
    note = 'try %.0f%%, best %.0f%%; the %s %s' % (wt, wb, m.group(1), 'survives' if full else 'survives to where it settles' if first else 'is lost')
    if not (first or full):
        return F(note)
    if not danger:
        return M('the %s was not in danger: ' % m.group(1) + note)
    if wb - wt <= 4:
        return M('"Look for more": the try is as good as the best: ' + note)
    return T(note)


def h_close_guess(R, m, text):
    sol = R.ctx.get('sol') or []
    if len(sol) < 2:
        return U('no line')
    b = after(R.pre, sol[0])
    y = sol[1]
    z = parse_move(b, m.group(1))
    if not z or z.uci() != y:
        return F('"%s" is not their reply %s' % (m.group(1), y))
    g = (R.ctx.get('guess') or {}).get('uci')
    if not g:
        return U('no guess kept')
    if g == y:
        return F('the guess was their reply itself')
    wg, wy = two(b.fen(), g, y, not R.color, DEEP)
    note = 'their %s %.0f%%, %s %.0f%% (from their side)' % (g, wg, y, wy)
    if wg >= wy - 4 - 2:
        return T(note)
    return ('noise', note) if wg >= wy - 10 else F(note)


def h_forces_mate_d(R, m, text):
    """Details' "Rg1+ forces mate." (V1.4), read as the settled row's form"""
    mm = re.match(r'^()(\S+) forces mate\.$', text)
    return h_forces_mate(R, mm, text)


def h_threat_mate(R, m, text):
    """tier 1's "Their threat: pawn to f4, with checkmate to follow." (V1.5's threat with a forced mate
    in more than one): were it their move, that move leads to a forced mate"""
    nb = chk.null(chess.Board(R.pre))
    x = parse_move(nb, m.group(1))
    if not x:
        return F('"%s" is not a move of theirs here' % m.group(1))
    a = nb.copy()
    a.push(x)
    e = sf.go(a.fen(), DEEP, 1, None)
    l0 = (e.get('lines') or [{}])[0]
    # the player is to move after their threat: mated means a negative mate for the side to move
    if l0.get('mate') is not None and l0['mate'] < 0:
        return T('after %s they mate in %d' % (x.uci(), -l0['mate']))
    return F('after %s no forced mate (%s)' % (x.uci(), l0.get('cp')))


DETAILS = [(r'^(\S+) forces mate\.$', h_forces_mate_d), (r'^Their threat: (.+), with (?:checkmate|mate) to follow\.$', h_threat_mate)]


SETTLED = [
    (r'^(\S+) is as good as (\S+)\.$', h_as_good),
    (r'^Just as good as the main answer\.$', h_as_good),
    (r'^The main move was (.+)\.$', h_main_move),
    (r'^(Only move: )?(\S+) forces mate\.$', h_forces_mate),
    (r'^()(.+) forces checkmate\.$', h_forces_mate),
    (r'^(\S+) found\. (\S+) missed later\.$', h_line_held),
    (r'^First move found, a later one missed\.$', h_line_held),
]
def h_good_save(R, m, text):
    """V1.9: at More help a saving move is "Good move" when it scores 10 points or more above the game
    move (its row 2, "That saves your queen. Look for more.", is checked on its own)"""
    import handlers as H1
    row2 = R.r.get('row2') or ''
    t = R.tried
    if not re.match(r'^That saves your \w+\. Look for more\.$', row2) or not t.get('uci') or not R.played:
        return H1.h_verdict(R, m, text)
    wt, wg = two(R.st, t['uci'], R.played, R.color, DEEP)
    note = 'a saving move: try %.0f%%, the game move %.0f%%' % (wt, wg)
    if wt - wg >= 10 - TOL:
        return T(note)
    return ('noise', note) if wt - wg >= 0 else F(note)


VERDICT = [(r'^That saves your ' + PIECE + r'\. Look for more\.$', h_saves_more), (r'^Good move$', h_good_save)]
FORCING = [(r'^Close\. Their best was (\S+)\.$', h_close_guess)]
