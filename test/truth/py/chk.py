"""Independent chess checks for the truth audit (python-chess, not the app's code): material, attackers
that may legally take, guards, a static exchange played out with legal captures, mates, forks, pins,
a move in words or SAN, and Stockfish-backed figures (win chances on the app's own curve, the material a
deep line settles on)."""
import math, re
import chess
import sf

VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
NAME = {'pawn': chess.PAWN, 'knight': chess.KNIGHT, 'bishop': chess.BISHOP, 'rook': chess.ROOK, 'queen': chess.QUEEN, 'king': chess.KING}
PNAME = {v: k for k, v in NAME.items()}
GLYPH = {'♔': (chess.WHITE, chess.KING), '♕': (chess.WHITE, chess.QUEEN), '♖': (chess.WHITE, chess.ROOK), '♗': (chess.WHITE, chess.BISHOP), '♘': (chess.WHITE, chess.KNIGHT), '♙': (chess.WHITE, chess.PAWN),
         '♚': (chess.BLACK, chess.KING), '♛': (chess.BLACK, chess.QUEEN), '♜': (chess.BLACK, chess.ROOK), '♝': (chess.BLACK, chess.BISHOP), '♞': (chess.BLACK, chess.KNIGHT), '♟': (chess.BLACK, chess.PAWN)}


def win_pct(cp):
    """the app's (lichess's) curve, from the side's centipawns"""
    cp = max(-1500, min(1500, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def board(fen):
    return chess.Board(fen)


def material(b, color):
    return sum(VAL[p.piece_type] for p in b.piece_map().values() if p.color == color)


def mat_diff(b, color):
    return material(b, color) - material(b, not color)


def null(b):
    n = b.copy(stack=False)
    n.turn = not n.turn
    n.ep_square = None
    return n


def legal_captures_of(b, sq):
    """the moves that may legally take the piece on sq, made by its opponent (them to move: a null move
    when it is not their turn)"""
    p = b.piece_at(sq)
    if not p:
        return []
    x = b if b.turn != p.color else null(b)
    return [m for m in x.legal_moves if m.to_square == sq]


def attackers_legal(b, sq):
    return sorted(set(m.from_square for m in legal_captures_of(b, sq)))


def guards(b, sq):
    """pieces of the same side that attack (defend) the square, the king included"""
    p = b.piece_at(sq)
    if not p:
        return []
    return list(b.attackers(p.color, sq))


def see_capture(b, move):
    """static exchange of a capture, played out with legal captures on that square, cheapest first,
    each side free to stop: what the side making `move` nets in pawns"""
    to = move.to_square
    cap = b.piece_at(to)
    gain = VAL[cap.piece_type] if cap else (1 if b.is_en_passant(move) else 0)
    if cap and cap.piece_type == chess.KING:
        return 99
    x = b.copy(stack=False)
    x.push(move)
    return gain - max(0, see_square(x, to))


def see_square(b, sq):
    """what the side to move nets taking on sq (0 when it does not pay)"""
    caps = [m for m in b.legal_moves if m.to_square == sq and (b.piece_at(sq) is not None)]
    if not caps:
        return 0
    caps.sort(key=lambda m: VAL[b.piece_at(m.from_square).piece_type] if b.piece_at(m.from_square).piece_type != chess.KING else 100)
    return max(0, see_capture(b, caps[0]))


def in_danger(b, sq):
    """the piece on sq can be won: its opponent, to move, nets something taking it"""
    p = b.piece_at(sq)
    if not p:
        return False
    x = b if b.turn != p.color else null(b)
    return see_square(x, sq) > 0


def mates_in_one(b):
    out = []
    for m in b.legal_moves:
        b.push(m)
        if b.is_checkmate():
            out.append(m)
        b.pop()
    return out


AMBIG = []


def parse_move(b, text):
    """a move as the card writes it, SAN (with or without its check sign) or in words ("queen to f7",
    "knight from d7 takes on c5", "castling", "pawn to e8 to make a queen"); None when not legal here"""
    t = text.strip().rstrip('.').strip()
    try:
        return b.parse_san(t)
    except Exception:
        pass
    m = re.match(r'^(king|queen|rook|bishop|knight|pawn)(?: from ([a-h][1-8]))? (to|takes on) ([a-h][1-8])(?: to make a (queen|rook|bishop|knight))?$', t, re.I)
    if t.lower() == 'castling':
        c = [x for x in b.legal_moves if b.is_castling(x)]
        if len(c) > 1:
            AMBIG.append(t)
        return c[0] if len(c) == 1 else (c or [None])[0]
    if not m:
        return None
    pt, fr, how, to, pr = NAME[m.group(1).lower()], m.group(2), m.group(3), chess.parse_square(m.group(4)), m.group(5)
    c = [x for x in b.legal_moves if b.piece_at(x.from_square).piece_type == pt and x.to_square == to and (not fr or x.from_square == chess.parse_square(fr))
         and (not pr or x.promotion == NAME[pr]) and (bool(pr) or x.promotion in (None, chess.QUEEN))]
    if how == 'takes on':
        c = [x for x in c if b.is_capture(x)]
    else:
        c = [x for x in c if not b.is_capture(x)]
    return c[0] if c else None


def after(fen, *ucis):
    b = chess.Board(fen)
    for u in ucis:
        if u:
            b.push(chess.Move.from_uci(u))
    return b


def eval_side(fen, nodes=1000000, color=None, searchmoves=None, multipv=1):
    """Stockfish's score for `color` (default: the side to move) as centipawns (a mate as +-1500) and
    its win chance, with the line"""
    r = sf.go(fen, nodes, multipv, searchmoves)
    b = chess.Board(fen)
    l = r['lines'][0] if r['lines'] else {'cp': 0, 'mate': None, 'pv': []}
    cp = l['cp'] if l['mate'] is None else (1500 if l['mate'] > 0 else -1500)
    if color is not None and color != b.turn:
        cp = -cp
    return {'cp': cp, 'win': win_pct(cp), 'mate': l['mate'] if color is None or color == b.turn else (-l['mate'] if l['mate'] is not None else None), 'pv': l['pv'], 'lines': r['lines'], 'depth': r['depth']}


def line_score(l, flip=False):
    cp = l['cp'] if l['mate'] is None else (1500 if l['mate'] > 0 else -1500)
    return -cp if flip else cp


def quiet_after(b, pv, i):
    """the position after pv[:i] is settled: the side to move not in check and neither of the next two
    plies takes or promotes"""
    x = b.copy(stack=False)
    for u in pv[:i]:
        x.push(chess.Move.from_uci(u))
    if x.is_check():
        return False
    y = x.copy(stack=False)
    for u in pv[i:i + 2]:
        mv = chess.Move.from_uci(u)
        if mv not in y.legal_moves:
            return True
        if y.is_capture(mv) or mv.promotion:
            return False
        y.push(mv)
    return True


def settled_delta(fen0, color, prefix, nodes=1000000, maxply=10):
    """the material `color` has gained (+) or lost (-) from position fen0, after the moves `prefix` and
    Stockfish's line from there, read at the last settled point (quiet_after) within maxply plies of
    the line (the first one too: 'first'); with the line and its score for `color`"""
    b0 = chess.Board(fen0)
    base = mat_diff(b0, color)
    b = b0.copy(stack=False)
    for u in prefix:
        b.push(chess.Move.from_uci(u))
    if b.is_game_over():
        return {'delta': mat_diff(b, color) - base, 'first': mat_diff(b, color) - base, 'pv': [], 'cp': None, 'mate': None, 'over': b.result(), 'at': 0}
    e = eval_side(b.fen(), nodes, color)
    pv = e['pv']
    pts = []
    x = b.copy(stack=False)
    for i in range(0, min(len(pv), maxply) + 1):
        if quiet_after(b, pv, i) and (i >= 1 or not prefix or True):
            pts.append((i, mat_diff(x, color) - base))
        if i < len(pv):
            mv = chess.Move.from_uci(pv[i])
            if mv not in x.legal_moves:
                break
            x.push(mv)
    if not pts:
        pts = [(min(len(pv), maxply), mat_diff(x, color) - base)]
    firsts = [p for p in pts if p[0] >= 1] or pts
    return {'delta': pts[-1][1], 'first': firsts[0][1], 'pv': pv, 'at': pts[-1][0], 'cp': e['cp'], 'mate': e['mate'], 'win': e['win']}


def ledger_value(s):
    """'♜ for ♘♙' (a trade in the board's pieces) or words ('a knight for a pawn', 'the queen',
    'two pawns', 'a lot of material', 'material'): (net value, exact) from the losing side"""
    s = s.strip()
    if re.search(r'[♔-♟]', s):
        parts = s.split(' for ')
        g = sum(VAL[GLYPH[c][1]] for c in parts[0] if c in GLYPH)
        l = sum(VAL[GLYPH[c][1]] for c in parts[1] if c in GLYPH) if len(parts) > 1 else 0
        return g - l, True
    words = {'a': 1, 'an': 1, 'the': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5}
    def val(phrase):
        tot = 0
        for chunk in re.split(r',| and ', phrase):
            chunk = chunk.strip()
            m = re.match(r'^(a|an|the|one|two|three|four|five)\s+(pawn|knight|bishop|rook|queen)s?$', chunk)
            if not m:
                return None
            tot += words[m.group(1)] * VAL[NAME[m.group(2)]]
        return tot
    if s in ('material',):
        return 1, False
    if s == 'a lot of material':
        return 6, False
    if ' for ' in s:
        a, c = s.split(' for ', 1)
        va, vc = val(a), val(c)
        if va is None or vc is None:
            return None, False
        return va - vc, True
    v = val(s)
    return v, v is not None
