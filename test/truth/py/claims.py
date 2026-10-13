"""Every chess claim the dump holds, checked on the board it is said on. Each handler gets the record
(R), the regex match and the text, and returns (verdict, note): true, false, misleading, untestable,
or none (no chess claim: an instruction, a question, a label of a mark the player made). The checks
use python-chess and the bundled Stockfish, never the app's own claim code."""
import re
import chess
import chk
import sf
from chk import VAL, NAME, PNAME, parse_move, after, board, win_pct

DEEP = 1000000      # move-against-move comparisons and settled lines (flagged claims are re-checked deeper)
MID = 1000000       # evals of a position
LIGHT = 300000      # practice captures
TOL = 5             # win-chance points of engine noise allowed at a band's edge


def T(n=''): return ('true', n)
def F(n=''): return ('false', n)
def M(n=''): return ('misleading', n)
def U(n=''): return ('untestable', n)
def N(n=''): return ('none', n)


class Rec:
    def __init__(self, r, games):
        self.r = r
        self.tier = r.get('tier')
        self.key = r.get('key')
        self.frame = r.get('frame', '')
        c = r.get('ctx') or {}
        self.ctx = c
        self.white = c.get('white')
        self.color = chess.WHITE if self.white else chess.BLACK
        self.opp = 'Black' if self.white else 'White'
        self.me = 'White' if self.white else 'Black'
        self.games = games
        self.marks = r.get('marks') or {}
        self.step = r.get('step')
        self.x = r.get('x') or {}

    @property
    def pre(self): return self.ctx.get('pre')
    @property
    def st(self): return self.ctx.get('st')
    @property
    def shown(self): return self.r.get('shown')
    @property
    def played(self): return self.ctx.get('played')
    @property
    def best(self): return self.ctx.get('best')
    @property
    def tried(self): return self.ctx.get('tried') or {}

    def due(self):
        sol, i = self.ctx.get('sol'), self.ctx.get('solIdx') or 0
        if sol and i > 0 and i < len(sol):
            return sol[i]
        return self.best

    def game(self):
        return self.games.game(self.key) if self.key else None

    def gply(self):
        return self.games.ply(self.key)


# ── shared checks ──────────────────────────────────────────────────────────
def pt(word):
    return NAME[word.lower().rstrip('s')] if word.lower().rstrip('s') in NAME else None


def ev(fen, color=None, nodes=MID):
    return chk.eval_side(fen, nodes, color)


def two(fen, a, b, color, nodes=DEEP):
    """two moves scored side by side from fen (as the app grades a try): win chances for `color`"""
    if a == b:
        e = chk.eval_side(fen, nodes, color, searchmoves=[a])
        return e['win'], e['win']
    r = sf.go(fen, nodes, 2, [a, b])
    bd = chess.Board(fen)
    flip = color != bd.turn
    wa = wb = None
    for l in r['lines']:
        if l['pv'] and l['pv'][0] == a:
            wa = win_pct(chk.line_score(l, flip))
        elif l['pv'] and l['pv'][0] == b:
            wb = win_pct(chk.line_score(l, flip))
    if wa is None:
        wa = chk.eval_side(fen, nodes, color, searchmoves=[a])['win']
    if wb is None:
        wb = chk.eval_side(fen, nodes, color, searchmoves=[b])['win']
    return wa, wb


def pair(fen, a, b, color, nodes=None):
    """two moves side by side from fen (the search two() asks, so one answer serves both): for each,
    {'win', 'mate', 'cp'} for `color` (mate > 0: `color` mates)"""
    nodes = nodes or DEEP
    bd = chess.Board(fen)
    flip = color != bd.turn
    out = {}
    if a != b:
        for l in sf.go(fen, nodes, 2, [a, b])['lines']:
            if l.get('pv') and l['pv'][0] in (a, b) and l['pv'][0] not in out:
                m = l.get('mate')
                out[l['pv'][0]] = {'win': win_pct(chk.line_score(l, flip)), 'mate': (-m if flip else m) if m is not None else None, 'cp': chk.line_score(l, flip)}
    for u in (a, b):
        if u not in out:
            e = chk.eval_side(fen, nodes, color, searchmoves=[u])
            out[u] = {'win': e['win'], 'mate': e['mate'], 'cp': e['cp']}
    return out[a], out[b]


def ranks_above(fen, u, ans, color, nodes=None):
    """release 2's C5 (a): move u ranks above the answer `ans` at depth when it forces mate and the answer
    does not (or mates later), or scores 4 or more win points above it: then "works too", "also holds"
    and "The main move was X" are false. (above, note)"""
    x, y = pair(fen, u, ans, color, nodes)
    note = '%s %s, the answer %s %s' % (u, ('mate %d' % x['mate']) if x['mate'] is not None else '%.0f%%' % x['win'], ans, ('mate %d' % y['mate']) if y['mate'] is not None else '%.0f%%' % y['win'])
    xm = x['mate'] is not None and x['mate'] > 0
    ym = y['mate'] is not None and y['mate'] > 0
    if xm and (not ym or x['mate'] < y['mate']):
        return True, note + ': the try forces mate%s' % ('' if not ym else ' sooner')
    if not xm and not ym and x['win'] - y['win'] >= 4:
        return True, note + ': the try scores %.0f points above it' % (x['win'] - y['win'])
    return False, note


def band_of(w):
    return 'winning' if w < 20 else 'better' if w < 40 else 'even' if w < 60 else 'still better'


def in_band(w, band):
    lo, hi = {'opp winning': (0, 20), 'opp better': (20, 40), 'even': (40, 60), 'still better': (60, 101), 'better': (60, 101)}[band]
    if lo - TOL <= w < hi + TOL:
        return True
    return False


def band_word(phrase, opp):
    p = phrase.strip()
    if p in ('the game is even', 'the game even', 'game even'):
        return 'even'
    if p in ('you still better', 'you are still better'):
        return 'still better'
    if re.match(r'^(White|Black) (is )?winning$', p):
        return 'opp winning' if p.split()[0] == opp else 'still better'
    if re.match(r'^(White|Black) (is )?better$', p):
        return 'opp better' if p.split()[0] == opp else 'still better'
    return None


def band_verdict(w, band, note):
    lo, hi = {'opp winning': (0, 20), 'opp better': (20, 40), 'even': (40, 60), 'still better': (60, 101), 'better': (60, 101)}[band]
    off = 0 if lo <= w < hi else (lo - w if w < lo else w - hi + 0.001)
    if off <= TOL:
        return T(note)
    if off <= 10:
        return ('noise', note + ' (%.0f points outside the band)' % off)
    return F(note + ' (%.0f points outside the band)' % off)


def pv_net(fen, color, pv, n=12):
    """the material `color` nets along the first n plies of a line, and the most it is down on the way"""
    b = chess.Board(fen)
    base = chk.mat_diff(b, color)
    worst, last = 0, 0
    for u in pv[:n]:
        m = chess.Move.from_uci(u)
        if m not in b.legal_moves:
            break
        b.push(m)
        last = chk.mat_diff(b, color) - base
        worst = min(worst, last)
    return last, worst


def loss_check(fen0, color, prefix, claimed, exact=True, label='loss'):
    """the material `color` loses from fen0 after `prefix` and Stockfish's line, against a claimed net
    loss (pawns): (verdict, note). Read where the deep line settles within 10 plies (its first and its
    last settled point), else along its first 12 plies when the score has dropped as much"""
    s = chk.settled_delta(fen0, color, prefix, DEEP)
    deep, first = -s['delta'], -s['first']
    after_fen = chk.after(fen0, *prefix).fen()
    net, worst = pv_net(after_fen, color, s['pv'])
    b0 = chk.after(fen0)
    base_net = chk.mat_diff(chk.after(fen0, *prefix), color) - chk.mat_diff(b0, color)
    full = -(net + base_net)
    e0 = chk.eval_side(fen0, DEEP, color)
    drop = ((e0['cp'] or 0) - (s.get('cp') if s.get('cp') is not None else e0['cp'])) / 100.0
    note = 'claimed %s %s; deep line: last settle %s, first settle %s, 12 plies %s, eval drop %.1f (%s), eval after %s' % (label, claimed, deep, first, full, drop, ' '.join(s['pv'][:10]), s.get('cp'))
    if claimed is None:
        return (T(note) if max(deep, first, full) >= 1 else F(note) if max(deep, first, full) <= 0 else M(note))
    slack = 0.5 if claimed <= 2 else 1
    best = max(deep, first)
    if best >= claimed - slack:
        return T(note)
    if full >= claimed - slack and drop >= claimed - 2.5:
        return T(note + ' [by the line and the score]')
    if max(deep, first, full) <= 0:
        return F(note + ' [no material lost on the deep line]')
    if best >= claimed - 2 and best >= 3:
        return ('noise', note + ' [most of the count stands]')
    if drop >= claimed + 2 and best >= 1:
        return ('noise', note + ' [less material on the deep line, but the score drops more than the claim]')
    if max(deep, first, full) <= claimed / 3.0:
        return F(note + ' [the deep line loses far less]')
    return M(note)


def gain_check(fen0, color, prefix, claimed, label='gain'):
    s = chk.settled_delta(fen0, color, prefix, DEEP)
    deep, first = s['delta'], s['first']
    after_fen = chk.after(fen0, *prefix).fen()
    net, worst = pv_net(after_fen, color, s['pv'])
    base_net = chk.mat_diff(chk.after(fen0, *prefix), color) - chk.mat_diff(chk.after(fen0), color)
    full = net + base_net
    note = 'claimed %s %s; deep line: last settle %s, first settle %s, 12 plies %s (%s), eval %s' % (label, claimed, deep, first, full, ' '.join(s['pv'][:10]), s.get('cp'))
    if claimed is None:
        return T(note) if max(deep, first, full) >= 1 else M(note)
    slack = 0.5 if claimed <= 2 else 1
    if deep >= claimed - slack or first >= claimed - slack:
        return T(note)
    if full >= claimed - slack and (s.get('cp') or 0) >= 100 * (claimed - 2.5):
        return T(note + ' [by the line and the score]')
    if max(deep, first, full) <= 0:
        return F(note)
    if max(deep, first) >= claimed - 2 and max(deep, first) >= 3:
        return ('noise', note + ' [most of the count stands]')
    return M(note)


def legal_capture(b, by_type, of_type, color_of_victim):
    """legal captures (side to move as needed) by a piece of type by_type of a piece of type of_type"""
    x = b if b.turn != color_of_victim else chk.null(b)
    out = []
    for m in x.legal_moves:
        v = x.piece_at(m.to_square)
        if x.is_en_passant(m):
            v = chess.Piece(chess.PAWN, color_of_victim)
        if v and v.color == color_of_victim and (of_type is None or v.piece_type == of_type) and (by_type is None or x.piece_at(m.from_square).piece_type == by_type):
            out.append(m)
    return out


def attacked_count(b, sq):
    return len(chk.attackers_legal(b, sq))


def pieces_of(b, color, ptype):
    return [s for s, p in b.piece_map().items() if p.color == color and p.piece_type == ptype]


def rings(R, kind=None):
    return [x for x in R.marks.get('rings') or [] if kind is None or x.get('kind') == kind]


def times(word):
    return {'once': 1, 'twice': 2, 'three times': 3, 'four times': 4, 'five times': 5, 'six times': 6}.get(word)


def mv(b, text):
    m = parse_move(b, text)
    return m


def fork_of(b, move, color):
    """after `move` (by color), the squares of the enemy pieces (a knight or more, or the king) the moved
    piece attacks"""
    x = b.copy(stack=False)
    x.push(move)
    sq = move.to_square
    out = []
    for t in x.attacks(sq):
        p = x.piece_at(t)
        if p and p.color != color and (p.piece_type != chess.PAWN):
            out.append(t)
    return out


def pinned_relative(b, sq):
    """the piece on sq cannot move off its line without exposing its king or a more valuable piece"""
    p = b.piece_at(sq)
    if not p:
        return False
    if b.is_pinned(p.color, sq):
        return True
    for a in b.attackers(not p.color, sq):
        ap = b.piece_at(a)
        if ap.piece_type not in (chess.BISHOP, chess.ROOK, chess.QUEEN):
            continue
        # what stands behind sq on the line from a
        ray = chess.ray(a, sq)
        if not ray:
            continue
        step_sqs = [s for s in chess.SquareSet(ray) if chess.square_distance(a, s) > chess.square_distance(a, sq)]
        step_sqs.sort(key=lambda s: chess.square_distance(a, s))
        btw = chess.SquareSet(chess.between(a, sq))
        if any(b.piece_at(s) for s in btw):
            continue
        for s in step_sqs:
            q = b.piece_at(s)
            if q:
                if q.color == p.color and VAL[q.piece_type] > VAL[p.piece_type]:
                    return True
                break
    return False
