"""Release 2 slice B's forms, read on the boards they are said on (python-chess for board facts, the
checkout's Stockfish for engine facts), each placed before the older forms it could be mistaken for:
- B6, a wrong try's row 2: what follows a take-back ("After the trade, Qxc3+ forks.", "After the trade,
  you lose your bishop."), a take-back the line avoids and why it fails ("Bxc3+, and bxc3 Qxc3+ forks.",
  "Taking back loses your knight.", tier 1 "If you take back, their queen forks."), two pieces taken
  ("Rxd2 takes your bishop and pawn."), a fork at once ("Qxc3+ forks rook and bishop."), what the reply
  attacks or threatens ("Then Nf5 attacks your queen.", "Then they threaten mate."), tier 1's band
  ("Now White is ahead.") and tier 1's mate in words ("Queen takes on g7 is checkmate.");
- B7 and B2, the answer's reason: "Rxf5 avoids the mate Be3 allowed." (tier 1 "Rook takes on f5 avoids
  their mate."), "You still lose ♗ for ♙.", the band of a long mate at tier 1 ("Rook to g1 keeps you
  winning."), the only move ("Only move: Qe6 48%.", tier 1 "Queen to e6 was the only good move.").
The reason a take-back fails is read after the try, their capture and the take-back (the cheapest piece
that may take back on that square, as the app picks it), by Stockfish's line from there."""
import re
import chess
import chk
import sf
from claims import *
from handlers import PIECE, piece_val_words
import handlers_v2 as HV2
import handlers_v1 as HV1

WORD_SIDE = r'(White|Black)'


def line_plies(R):
    """See it's line after the try, as (board before, move) pairs, with the board after the try"""
    c = HV2.try_line(R)
    if not c:
        return None, None
    b0 = after(c[0], c[1])
    plies, _ = HV2.walk(b0.fen(), c[2])
    return b0, plies


def trade_at(plies):
    """where the line's first trade starts: their capture, then the player's take-back on its square at
    equal value (as B6 says "the trade"); its index, or None"""
    for i in range(0, len(plies) - 1):
        (b0, x0), (b1, x1) = plies[i], plies[i + 1]
        if b0.piece_at(x0.from_square).color == b0.turn and b0.turn != b1.turn and b0.is_capture(x0) and b1.is_capture(x1) and x1.to_square == x0.to_square:
            v0 = b0.piece_at(x0.to_square) or chess.Piece(chess.PAWN, not b0.turn)
            v1 = b1.piece_at(x1.to_square)
            if v0.color != b0.turn and v1 and VAL[v0.piece_type] == VAL[v1.piece_type]:
                return i
    return None


def is_trade(plies):
    return trade_at(plies) is not None


def h_trade_fork(R, m, text):
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    t0 = trade_at(plies)
    if t0 is None or len(plies) < t0 + 3:
        return F('no trade then a move of theirs on the line See it plays')
    b, x = plies[t0 + 2]
    if m.group(1):
        y = HV2.words_move(b, m.group(1))
        if not y or y != x:
            return F('%s is not their move after the trade (%s)' % (m.group(1), x.uci()))
    elif b.piece_at(x.from_square).piece_type != NAME[m.group(2)]:
        return F('their move after the trade is by a %s' % PNAME[b.piece_at(x.from_square).piece_type])
    return HV2.fork_check(R, b, x, t0 + 2, [])


def h_trade_mate(R, m, text):
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    t0 = trade_at(plies)
    if t0 is None:
        return F('no trade on the line See it plays')
    if m.lastindex and m.group(1):
        if len(plies) < t0 + 3:
            return F('the line ends at the trade')
        b, x = plies[t0 + 2]
        y = HV2.words_move(b, m.group(1))
        if not y or y != x:
            return F('%s is not their move after the trade' % m.group(1))
        z = b.copy(stack=False)
        z.push(x)
        return (T if z.is_checkmate() else F)('%s %s' % (x.uci(), 'mates' if z.is_checkmate() else 'does not mate'))
    z = plies[t0 + 1][0].copy(stack=False)
    z.push(plies[t0 + 1][1])
    e = ev(z.fen(), not R.color, DEEP)
    note = 'after the trade their best: mate %s (%s)' % (e['mate'], ' '.join(e['pv'][:6]))
    return T(note) if (e['mate'] or 0) > 0 or chk.mates_in_one(z) else F(note)


def h_trade_takes(R, m, text):
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    t0 = trade_at(plies)
    if t0 is None:
        return F('no trade on the line See it plays')
    word = m.group(2)
    for i in range(t0 + 2, len(plies)):
        b, x = plies[i]
        mover = b.piece_at(x.from_square)
        v = b.piece_at(x.to_square) or (chess.Piece(chess.PAWN, R.color) if b.is_en_passant(x) else None)
        if not mover or mover.color == R.color or not v or v.color != R.color or v.piece_type != NAME[word]:
            continue
        if m.group(1):
            y = HV2.words_move(b, m.group(1))
            if not y or y != x:
                continue
        line = R.tried.get('line') or []
        return HV2.loss_after(R, line[:i + 1], min(VAL[NAME[word]], 3) if word != 'pawn' else 1)
    return F('no capture of your %s after the trade on the line See it plays' % word)


def takes_two(R, then, san, by, w1, w2):
    """"Rxd2 takes your bishop and pawn." (the reply, or "Then" a later move of theirs): the piece named
    takes the first, and on their next move takes the second, not taken back before"""
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    for i in range(0, len(plies) - 2):
        b, x = plies[i]
        mover = b.piece_at(x.from_square)
        v = b.piece_at(x.to_square)
        if not mover or mover.color == R.color or not v or v.color != R.color or v.piece_type != NAME[w1]:
            continue
        if (i == 0) == bool(then):
            continue
        if san:
            y = HV2.words_move(b, san)
            if not y or y != x:
                continue
        elif mover.piece_type != NAME[by]:
            continue
        b2, x2 = plies[i + 2]
        v2 = b2.piece_at(x2.to_square)
        if x2.from_square != x.to_square or not v2 or v2.color != R.color or v2.piece_type != NAME[w2]:
            return F('%s does not take your %s next' % (x.uci(), w2))
        line = R.tried.get('line') or []
        need = max(min(VAL[NAME[w1]], 3), min(VAL[NAME[w2]], 3))
        return HV2.loss_after(R, line[:i + 3], need)
    return F('no such capture on the line See it plays')


def h_takes_two_san(R, m, text):
    return takes_two(R, m.group(1), m.group(2), None, m.group(3), m.group(4))


def h_takes_two_words(R, m, text):
    return takes_two(R, m.group(1), None, m.group(2), m.group(3), m.group(4))


def h_fork_now(R, m, text):
    """"Qxc3+ forks rook and bishop." / "Their queen forks rook and bishop.": the reply itself forks"""
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    if not plies:
        return F('no reply')
    b, x = plies[0]
    if m.group(1):
        y = HV2.words_move(b, m.group(1))
        if not y or y != x:
            return F('%s is not their reply (%s)' % (m.group(1), x.uci()))
    elif b.piece_at(x.from_square).piece_type != NAME[m.group(2)]:
        return F('their reply is by a %s' % PNAME[b.piece_at(x.from_square).piece_type])
    return HV2.fork_check(R, b, x, 0, HV2.fork_names(m.group(3)))


def h_mate_words(R, m, text):
    """tier 1's "Queen takes on g7 is checkmate.": their reply, said in words, mates"""
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    if not plies:
        return F('no reply')
    b, x = plies[0]
    y = HV2.words_move(b, m.group(1))
    if not y:
        return F('%s is not a move of theirs after the try' % m.group(1))
    if y != x:
        return F('%s is not their reply (%s)' % (m.group(1), x.uci()))
    z = b.copy(stack=False)
    z.push(x)
    return (T if z.is_checkmate() else F)('')


def then_attacks(R, san, by, word):
    """"Then Nf5 attacks your queen." / "Then their knight attacks your queen.": their reply's piece
    attacks a piece of that kind of the player's once it is played"""
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    if not plies:
        return F('no reply')
    b, x = plies[0]
    if san:
        y = HV2.words_move(b, san)
        if not y or y != x:
            return F('%s is not their reply (%s)' % (san, x.uci()))
    elif b.piece_at(x.from_square).piece_type != NAME[by]:
        return F('their reply is by a %s' % PNAME[b.piece_at(x.from_square).piece_type])
    z = b.copy(stack=False)
    z.push(x)
    hit = [q for q in z.attacks(x.to_square) if z.piece_at(q) and z.piece_at(q).color == R.color and z.piece_at(q).piece_type == NAME[word]]
    return (T if hit else F)('%s attacks %s' % (x.uci(), [chess.square_name(q) for q in hit]))


def h_then_attacks_san(R, m, text):
    return then_attacks(R, m.group(1), None, m.group(2))


def h_then_attacks_words(R, m, text):
    return then_attacks(R, None, m.group(1), m.group(2))


def h_threat_mate_after(R, m, text):
    """"Then Qh5 threatens mate." / "Then they threaten mate.": after their reply, a mate in one were it
    their move again"""
    b0, plies = line_plies(R)
    if plies is None:
        return U('no try')
    if not plies:
        return F('no reply')
    b, x = plies[0]
    if m.lastindex and m.group(1):
        y = HV2.words_move(b, m.group(1))
        if not y or y != x:
            return F('%s is not their reply (%s)' % (m.group(1), x.uci()))
    z = b.copy(stack=False)
    z.push(x)
    ms = chk.mates_in_one(chk.null(z)) if not z.is_check() else []
    return (T if ms else F)('their mates in one after %s: %s' % (x.uci(), [y.uci() for y in ms]))


def h_now_ahead(R, m, text):
    """tier 1's band: "Now White is ahead." after the try"""
    c = HV2.try_line(R)
    if not c:
        return U('no try')
    e = ev(after(c[0], c[1]).fen(), R.color, DEEP)
    w = e['win'] if e['mate'] is None else (100 if e['mate'] > 0 else 0)
    note = 'player %.0f%% after the try' % w
    if m.group(1) == R.me:
        return T(note) if w >= 60 - TOL else ('noise', note) if w >= 50 else F(note)
    return T(note) if w <= 40 + TOL else ('noise', note) if w <= 50 else F(note)


# ── B6 (c): the take-back the line avoids, and why it fails ─────────────────
def take_back(R):
    """after the try and their capture (the line's first move), the take-back on its square by the
    cheapest piece: (board before it, the take-back, the capture) or None"""
    b0, plies = line_plies(R)
    if not plies:
        return None
    b, x = plies[0]
    if not b.is_capture(x):
        return None
    z = b.copy(stack=False)
    z.push(x)
    sq = x.to_square
    re_ = [y for y in z.legal_moves if y.to_square == sq and z.is_capture(y)]
    if not re_:
        return None
    re_.sort(key=lambda y: VAL[z.piece_at(y.from_square).piece_type])
    return z, re_[0], x


def refused_head(R, m):
    """the head "Bxc3+, and bxc3 ...": the capture is the line's first move and the take-back a legal
    one on its square; (board after the take-back, note) or (None, verdict)"""
    tb = take_back(R)
    if not tb:
        return None, F('no capture of theirs that can be taken back on the line See it plays')
    z, y, x = tb
    if m is not None and m.group(1):
        b0, plies = line_plies(R)
        if HV2.words_move(plies[0][0], m.group(1)) != x:
            return None, F('%s is not their capture (%s)' % (m.group(1), x.uci()))
        y2 = HV2.words_move(z, m.group(2))
        if not y2 or y2.to_square != x.to_square or not z.is_capture(y2):
            return None, F('%s does not take back on %s' % (m.group(2), chess.square_name(x.to_square)))
        y = y2
    w = z.copy(stack=False)
    w.push(y)
    return w, 'after %s %s' % (x.uci(), y.uci())


def h_refused_mate(R, m, text):
    w, note = refused_head(R, m if m.lastindex and m.lastindex >= 2 else None)
    if w is None:
        return note
    if m.lastindex and m.lastindex >= 3 and m.group(3):
        z = HV2.words_move(w, m.group(3))
        if not z:
            return F('%s is not their move %s' % (m.group(3), note))
        y = w.copy(stack=False)
        y.push(z)
        return (T if y.is_checkmate() else F)('%s: %s %s' % (note, z.uci(), 'mates' if y.is_checkmate() else 'does not mate'))
    e = ev(w.fen(), not R.color, DEEP)
    note += ': their best mate %s (%s)' % (e['mate'], ' '.join(e['pv'][:6]))
    return T(note) if (e['mate'] or 0) > 0 or chk.mates_in_one(w) else ('noise', note) if e['win'] >= 90 else F(note)


def h_refused_fork(R, m, text):
    w, note = refused_head(R, m if m.lastindex and m.lastindex >= 2 and m.group(2) else None)
    if w is None:
        return note
    e = ev(w.fen(), not R.color, DEEP)
    first = (e['pv'] or [None])[0]
    if not first:
        return F(note + ': no move for them')
    x = chess.Move.from_uci(first)
    if m.lastindex and m.lastindex >= 3 and m.group(3):
        z = HV2.words_move(w, m.group(3))
        if not z:
            return F('%s is not their move %s' % (m.group(3), note))
        x = z
    elif m.lastindex and m.lastindex >= 4 and m.group(4):
        if w.piece_at(x.from_square).piece_type != NAME[m.group(4)]:
            return M('%s: their best %s is by a %s' % (note, first, PNAME[w.piece_at(x.from_square).piece_type]))
    tg = fork_of(w, x, w.turn)
    if len(tg) < 2:
        return F('%s: %s hits %d pieces' % (note, x.uci(), len(tg)))
    s = chk.settled_delta(w.fen(), w.turn, [x.uci()], DEEP)
    note += ': %s forks %s; their line nets %s (%s)' % (x.uci(), [chess.square_name(t) for t in tg], s['delta'], ' '.join(s['pv'][:6]))
    return T(note) if s['delta'] >= 1 else M(note)


def h_refused_loss(R, m, text):
    head = m if m.lastindex and m.lastindex >= 3 else None
    w, note = refused_head(R, head)
    if w is None:
        return note
    w0 = m.group(m.lastindex).strip()
    v = piece_val_words('the ' + w0 if re.match(r'^(pawn|knight|bishop|rook|queen)$', w0) else w0)
    if v is None:
        return U('loss words not read: ' + w0)
    tb = take_back(R)
    z, y, x = tb
    if head is not None:
        y = HV2.words_move(z, m.group(2)) or y
    r = loss_check(z.fen(), R.color, [y.uci()], v)
    return (r[0], note + '; ' + r[1])


# ── B7 and B2: the answer's reason ───────────────────────────────────────────
def mates_against(fen, color):
    e = chk.eval_side(fen, DEEP, color)
    return (e['mate'] or 0) < 0, e


def h_avoids(R, m, text):
    """"Rxf5 avoids the mate Be3 allowed." (and "Be3 missed it."; tier 1 "Rook takes on f5 avoids their
    mate."): after the move no forced mate of theirs, after the game move one"""
    b = chess.Board(R.pre)
    x = HV2.words_move(b, m.group(1))
    if not x:
        return F('%s is not legal on the card\'s board' % m.group(1))
    if m.lastindex >= 2 and m.group(2):
        g = HV2.words_move(b, m.group(2))
        if not g or g.uci() != R.played:
            return F('%s is not the game move' % m.group(2))
    a1 = b.copy(stack=False)
    a1.push(x)
    a2 = b.copy(stack=False)
    a2.push(chess.Move.from_uci(R.played))
    k1, e1 = mates_against(a1.fen(), R.color)
    k2, e2 = mates_against(a2.fen(), R.color)
    note = 'after %s: mate %s; after the game move %s: mate %s' % (x.uci(), e1['mate'], R.played, e2['mate'])
    if k1:
        return F(note)
    return T(note) if k2 or a2.is_checkmate() or chk.mates_in_one(a2) else F(note)


def h_still_lose(R, m, text):
    """Details' "You still lose ♗ for ♙." beside the answer that avoids the mate: its own line's loss"""
    v = piece_val_words(m.group(1))
    if v is None:
        return U('loss words not read')
    return loss_check(R.pre, R.color, [R.best], v)


def h_keeps_winning(R, m, text):
    """tier 1's band for a long mate: "Rook to g1 keeps you winning.": winning after the move"""
    b = chess.Board(R.pre)
    x = HV2.words_move(b, m.group(1))
    if not x:
        return F('%s is not legal on the card\'s board' % m.group(1))
    e = chk.eval_side(b.fen(), DEEP, R.color, searchmoves=[x.uci()])
    note = '%s: %s' % (x.uci(), ('mate %s' % e['mate']) if e['mate'] is not None else '%.0f%%' % e['win'])
    if e['mate'] is not None:
        return (T if e['mate'] > 0 else F)(note)
    return T(note) if e['win'] >= 80 - TOL else ('noise', note) if e['win'] >= 70 else F(note)


def only_gap(R, u):
    """the move u against the next best on the card's board: (its win, the next best's, the next move)"""
    r = sf.go(R.pre, DEEP, 2, None)
    ls = [l for l in r.get('lines') or [] if l.get('pv')]
    bd = chess.Board(R.pre)
    flip = R.color != bd.turn
    wu = chk.eval_side(R.pre, DEEP, R.color, searchmoves=[u])['win']
    other = [l for l in ls if l['pv'][0] != u]
    if not other:
        return wu, None, None
    wo = chk.win_pct(chk.line_score(other[0], flip))
    return wu, wo, other[0]['pv'][0]


def h_only_move_fig(R, m, text):
    """tier 3's "Only move: Qe6 48%.": the answer, its figure, and no other move within 10 points"""
    b = chess.Board(R.pre)
    x = HV2.words_move(b, m.group(1))
    if not x:
        return F('%s is not legal on the card\'s board' % m.group(1))
    wu, wo, nb = only_gap(R, x.uci())
    note = '%s %.0f%%, next best %s %s' % (x.uci(), wu, nb, '%.0f%%' % wo if wo is not None else '-')
    if wo is not None and wo > wu + 4:
        return F(note + ': not the best')
    d = abs(wu - int(m.group(2)))
    if d > 10:
        return F(note + ': the figure is off')
    if wo is not None and wu - wo < 5:
        return F(note + ': another move holds as well')
    return T(note) if (wo is None or wu - wo >= 10) and d <= TOL else ('noise', note)


def h_only_good(R, m, text):
    """tier 1's "Queen to e6 was the only good move." (and t2's "Qe6 is the only move that holds.")"""
    b = chess.Board(R.pre)
    x = HV2.words_move(b, m.group(1))
    if not x:
        return F('%s is not legal on the card\'s board' % m.group(1))
    wu, wo, nb = only_gap(R, x.uci())
    note = '%s %.0f%%, next best %s %s' % (x.uci(), wu, nb, '%.0f%%' % wo if wo is not None else '-')
    if wo is None or wu - wo >= 10:
        return T(note)
    return ('noise', note) if wu - wo >= 5 else F(note)


SUBJ = HV2.SUBJ
REASON = [
    (r'^After the trade, (\S+) forks\.$()', h_trade_fork),
    (r'^After the trade, ()their ' + PIECE + r' forks\.$', h_trade_fork),
    (r'^After the trade, (\S+) is mate\.$', h_trade_mate),
    (r'^After the trade, they can checkmate\.$()', h_trade_mate),
    (r'^After the trade, (\S+) takes your ' + PIECE + r'\.$', h_trade_takes),
    (r'^After the trade, ()you lose your ' + PIECE + r'\.$', h_trade_takes),
    (r'^(Then )?(\S+) takes your ' + PIECE + r' and ' + PIECE + r'\.$', h_takes_two_san),
    (r'^(Then )?[Tt]heir ' + PIECE + r' takes your ' + PIECE + r' and ' + PIECE + r'\.$', h_takes_two_words),
    (r'^(\S+) forks ()(both \w+s|\w+ and \w+)\.$', h_fork_now),
    (r'^Their ()' + PIECE + r' forks (both \w+s|\w+ and \w+)\.$', h_fork_now),
    (r'^Then (\S+) attacks your ' + PIECE + r'\.$', h_then_attacks_san),
    (r'^Then their ' + PIECE + r' attacks your ' + PIECE + r'\.$', h_then_attacks_words),
    (r'^Then (\S+) threatens mate\.$', h_threat_mate_after),
    (r'^Then they threaten mate\.$()', h_threat_mate_after),
    (r'^Now ' + WORD_SIDE + r' is ahead\.$', h_now_ahead),
    (r'^(\S+), and (\S+) allows (\S+) mate\.$', h_refused_mate),
    (r'^(\S+), and (\S+) allows mate\.$', h_refused_mate),
    (r'^Taking back allows (?:mate|checkmate)\.$()', h_refused_mate),
    (r'^If you take back, they can checkmate\.$()', h_refused_mate),
    (r'^(\S+), and (\S+) (\S+) forks\.$', h_refused_fork),
    (r'^Taking back allows a fork\.$()', h_refused_fork),
    (r'^If you take back, ()()()their ' + PIECE + r' forks\.$', h_refused_fork),
    (r'^(\S+), and (\S+) loses (?:your )?(.+)\.$', h_refused_loss),
    (r'^Taking back loses (?:your )?(.+)\.$', h_refused_loss),
    (r'^If you take back, you lose (?:your )?(.+)\.$', h_refused_loss),
    (r'^((?:King|Queen|Rook|Bishop|Knight|Pawn)(?: from [a-h][1-8])? takes on [a-h][1-8]) is checkmate\.$', h_mate_words),
]
SETTLED = [
    (r'^' + SUBJ + r' avoids the mate (\S+) allowed\.$', h_avoids),
    (r'^' + SUBJ + r' avoids their mate\.$()', h_avoids),
    (r'^' + SUBJ + r' keeps you winning\.$', h_keeps_winning),
    (r'^Only move: (\S+) (\d+)%\.$', h_only_move_fig),
    (r'^' + SUBJ + r' was the only good move\.$', h_only_good),
    (r'^' + SUBJ + r' is the only move that holds\.$', h_only_good),
]
def h_threaten(R, m, text):
    """B4's "They threaten Bxg7+." (game mode's Hint 2 as See why's danger frame): their move on the board
    shown, them to move, by B5's rule"""
    import handlers_gate as HG
    b = chess.Board(R.shown or R.pre)
    x = chk.null(b) if b.turn == R.color else b
    y = chk.parse_move(x, m.group(1))
    if not y:
        return F('%s is no move of theirs on the board shown' % m.group(1))
    return HG.threat_b5(b.fen() if b.turn == R.color else chk.null(b).fen(), R.color, y)


HINT = [(r'^They threaten (\S+)\.$', h_threaten)]
DETAILS = [
    (r'^The main move was (.+)\.$', HV1.h_main_move),
    (r'^' + SUBJ + r' avoids the mate (\S+) allowed\.(?: \S+ missed it\.)?$', h_avoids),
    (r'^' + SUBJ + r' avoids their mate\.$()', h_avoids),
    (r'^You still lose (.+)\.$', h_still_lose),
    (r'^' + SUBJ + r' keeps you winning\.$', h_keeps_winning),
]
