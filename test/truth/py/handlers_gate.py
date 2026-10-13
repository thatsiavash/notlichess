"""The gate's own handlers for forms no earlier copy read (release gate 1 on the final build): row 1's
verdict words ("Found it", "Your game move again", "As in your game", "Right"), tier 1's task line
("Find a better move."), and any string that shows a program value ("b3null.", "undefined"), which is
no true statement on any board."""
import re
import chess
import chk
from chk import parse_move, after
from claims import *
import handlers as H1
import handlers_v1 as HV

# a program value glued into the words: "b3null." has no word boundary before "null", nor would
# "e8=Qnull" or "O-Onull"; only a lowercase letter on either side makes it part of a word ("annulled")
BROKEN = re.compile(r'(?<![a-z])(?:null|undefined|NaN)(?![a-z])|\[object ')


def h_broken(R, m, text):
    return F('the string shows a program value (%s): a word of it is missing' % BROKEN.search(text).group(0))


def found_move(R):
    """the move "Found it" is said of and the board it was played on: (board fen, move, the move due there)"""
    if (R.key or '').startswith('pk:'):
        # a practice try names its move; a lesson's own position is played with its answer
        u = R.x.get('u') or (R.best if R.frame.startswith('lesson try') else None)
        return R.pre, u, R.best
    if (R.key or '').startswith('foil:') and 'game move' in R.frame:
        return R.pre, R.played, R.best
    yo = HV.yours_move(R)
    if yo:
        return yo
    return R.pre, R.x.get('u') or R.best, R.best


def h_found(R, m, text):
    base, u, due = found_move(R)
    if not u or not due:
        return U('no move kept')
    b = chess.Board(base)
    sk = H1.PRAC_SKILL.get((R.key or '')[3:]) if (R.key or '').startswith('pk:') else None
    if sk in ('mate1', 'backrank'):
        x = b.copy()
        x.push(chess.Move.from_uci(u))
        return (T if x.is_checkmate() else F)('mate task: %s %s' % (u, 'mates' if x.is_checkmate() else 'does not mate'))
    if u == due:
        return T('the answer itself (%s)' % u)
    wt, wb = two(base, u, due, R.color)
    note = '%s %.0f%%, the answer %s %.0f%%' % (u, wt, due, wb)
    if wb - wt <= 4 + TOL:
        return T(note)
    return ('noise', note) if wb - wt <= 10 else F(note)


def h_game_move_again(R, m, text):
    t = (R.tried or {}).get('uci') or R.x.get('u')
    return (T if t and t == R.played else F)('the try %s, the game move %s' % (t, R.played))


def h_right(R, m, text):
    """a forcing line's "Right": the board shows the line's own moves up to its step (the last move on it is
    the line's move there: the player's, or their reply that followed it)"""
    lm = R.ctx.get('lastMove') or []
    sol = R.ctx.get('sol') or []
    i = (R.ctx.get('solIdx') or 0) - 1
    ok = len(lm) == 2 and 0 <= i < len(sol) and sol[i][:4] == lm[0] + lm[1]
    return (T if ok else F)('the last move %s, the line %s at step %d' % (''.join(lm), ' '.join(sol), i))


def h_task_t1(R, m, text):
    """tier 1's "Find a better move.": the premise alone (the game move is not the best), as the task
    line's own check reads it"""
    wt, wb = two(R.pre, R.played, R.best, R.color)
    note = 'premise: game move %.0f%%, best %.0f%% (gap %.0f)' % (wt, wb, wb - wt)
    if wb - wt >= 8:
        return T(note)
    return ('noise', note) if wb - wt >= 3 else M(note)


VERDICT_WORDS = [
    (r'^Found it$', h_found),
    (r'^(Your game move again|As in your game)$', h_game_move_again),
    (r'^Right$', h_right),
]
TASK_T1 = [(r'^Find a better move\.$', h_task_t1)]


# ── release 2's C5: the rules that catch what exp2250-r2 found ─────────────────────────────────────
# (a) lives in claims.ranks_above, read by "works too", "also holds", "The main move was X" and
# "as good as"; here (b) See why's band words against the deep score's sign, (c) material words that
# understate, (d) "Now X", "lets X", "allows X" for what was possible before the move, (e) a threat
# only where a search finds it (B5's rule), and (g) one frame's surfaces against each other.
import handlers_v2 as HV2
from handlers import PIECE

MOVE = r'(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?[+#]?)'
WORDS = r'(?:(?:Pawn|Knight|Bishop|Rook|Queen|King) (?:to|takes on) [a-h][1-8]|That|' + MOVE + ')'


def them_board(fen):
    """the board with the other side to move (a null move): what they could do there"""
    return chk.null(chess.Board(fen))


def winning_capture(nb, mv, nodes=None):
    """their capture mv on board nb wins material, by a search (static exchange alone never decides):
    the exchange gains and the settled line nets them a pawn or more"""
    if not nb.is_capture(mv) or chk.see_capture(nb, mv) <= 0:
        return False, 'the exchange does not pay'
    s = chk.settled_delta(nb.fen(), nb.turn, [mv.uci()], nodes or DEEP)
    return s['delta'] >= 1, 'they net %s (%s)' % (s['delta'], ' '.join(s['pv'][:6]))


def newness(R, typ, field, text):
    """(d): "Now X is check", "Now X hits two pieces", "Now White can checkmate", "M lets them take your
    queen", "M lets them mate you", "M allows X, forking ...", "M allows A B, and then C forks ...", "M
    allows mate in N", "M allows a discovered check": false where X was possible before the move M (on
    the board before it, with them to move). None where the form is not one of these or X was new."""
    t = text.strip()
    if typ == 'see why' and R.step and R.step.get('before') and R.step.get('move'):
        before = R.step['before']
        nb = them_board(before)
        m = re.match(r'^(\S+)\. Now (' + MOVE + r') is check\.$', t)
        if m:
            x = parse_move(nb, m.group(2))
            if x and nb.gives_check(x):
                return F('"Now %s is check": %s gave check before %s too' % (m.group(2), m.group(2), m.group(1)))
            return None
        m = re.match(r'^(\S+)\. Now (' + MOVE + r') hits two pieces\.$', t)
        if m:
            x = parse_move(nb, m.group(2))
            if x and len(fork_of(nb, x, nb.turn)) >= 2:
                return F('"Now %s hits two pieces": it hit two before %s too' % (m.group(2), m.group(1)))
            return None
        m = re.match(r'^(\S+)\. Now (White|Black) can checkmate\.$', t)
        if m:
            ms = chk.mates_in_one(nb)
            if ms:
                return F('"Now %s can checkmate": %s mated in one before %s too' % (m.group(2), ms[0].uci(), m.group(1)))
            return None
        return None
    if typ in ('hint 1', 'hint 2', 'game hint 1', 'game hint 2', 'details', 'reason', 'settled', 'check line') and R.pre and R.played:
        nb = them_board(R.pre)
        gm = chess.Move.from_uci(R.played)
        m = re.match(r'^' + WORDS + r' lets them mate you\.$', t)
        if m:
            ms = chk.mates_in_one(nb)
            if ms:
                return F('"lets them mate you": they mated in one before the game move too (%s)' % ms[0].uci())
            return None
        m = re.match(r'^' + WORDS + r' lets them (take|win) your ' + PIECE + r'\.$', t)
        if m:
            want = NAME[m.group(2)]
            b0 = chess.Board(R.pre)
            p = b0.piece_at(gm.from_square)
            # the piece the move put in danger: the one it moved, else every one of that kind
            sqs = [gm.from_square] if p and p.piece_type == want else [q for q in pieces_of(b0, R.color, want)]
            for q in sqs:
                for c in [y for y in nb.legal_moves if y.to_square == q]:
                    ok, note = winning_capture(nb, c)
                    if ok:
                        return F('"lets them %s your %s": %s did before the game move too (%s)' % (m.group(1), m.group(2), nb.san(c), note))
            return None
        m = re.match(r'^(\S+) allows (' + MOVE + r'), forking your (\w+) and (\w+)', t)
        if m:
            x = parse_move(nb, m.group(2))
            if x:
                y = nb.copy(stack=False)
                y.push(x)
                names = sorted(PNAME[y.piece_at(q).piece_type] for q in fork_of(nb, x, nb.turn))
                if m.group(3) in names and m.group(4) in names:
                    return F('"allows %s": it forked your %s and %s before %s too' % (m.group(2), m.group(3), m.group(4), m.group(1)))
            return None
        m = re.match(r'^(\S+) allows ((?:\S+ )*\S+), and then (\S+) forks (?:your (\w+) and (\w+)|both your (\w+)s)\b', t)
        if m:
            y = nb.copy(stack=False)
            for san in m.group(2).split() + [m.group(3)]:
                z = parse_move(y, san)
                if not z:
                    return None
                last = (y.copy(stack=False), z)
                y.push(z)
            names = sorted(PNAME[y.piece_at(q).piece_type] for q in fork_of(last[0], last[1], last[0].turn))
            hit = (names.count(m.group(6)) >= 2) if m.group(6) else (m.group(4) in names and m.group(5) in names)
            if hit:
                return F('"allows %s, and then %s forks": the same line forked before %s too' % (m.group(2), m.group(3), m.group(1)))
            return None
        m = re.match(r'^(\S+) allows mate in (\d+)', t)
        if m:
            e = chk.eval_side(nb.fen(), DEEP, nb.turn)
            if (e['mate'] or 0) > 0:
                return F('"allows mate": they had a forced mate before %s too (mate in %d)' % (m.group(1), e['mate']))
            return None
        m = re.match(r'^(\S+) allows a discovered check', t)
        if m:
            for y in nb.legal_moves:
                z = nb.copy(stack=False)
                z.push(y)
                k = z.king(not nb.turn)
                if k is not None and any(q != y.to_square for q in z.attackers(nb.turn, k)):
                    return F('"allows a discovered check": %s was one before %s too' % (nb.san(y), m.group(1)))
            return None
    return None


def threat_b5(pre, color, mv, nodes=None):
    """(e), B5's rule for a threat their move mv makes on the board before the player's move (mv a move
    on the null-move board, them to move): within 5 points of their best line there, and gaining them 10
    or more over the position as it stands (the player to move). (verdict, note)"""
    nodes = nodes or DEEP
    nb = them_board(pre)
    them = nb.turn
    z = nb.copy(stack=False)
    z.push(mv)
    if z.is_checkmate():
        return T('%s mates' % nb.san(mv))
    wt = chk.eval_side(nb.fen(), nodes, them, searchmoves=[mv.uci()])['win']
    e = chk.eval_side(nb.fen(), nodes, them)
    wbest = e['win']
    base = 100 - chk.eval_side(pre, nodes, color)['win']
    gain, below = wt - base, wbest - wt
    note = '%s gives them %.0f%% (their best there %s %.0f%%; as it stands %.0f%%): gains %.0f, %.0f below their best' % (
        nb.san(mv), wt, (e['pv'] or ['?'])[0], wbest, base, gain, below)
    if gain <= 0 or below > 15:
        return F('no threat: ' + note)
    if gain < 5 or below > 10:
        return M('a threat worth little: ' + note)
    if gain < 10 or below > 5:
        return ('noise', note)
    return T(note)


def named_threats(R, text):
    """the threats a string names, as moves on the null-move board of the card's position: [(name, move)],
    [] for a named threat that is no move of theirs (the base check says so), None for no threat form"""
    t = text.strip()
    nb = them_board(R.pre)
    out = []

    def add(name):
        x = HV2.words_move(nb, re.sub(r' mate$', '', name.strip()))
        if x:
            out.append((name, x))

    m = re.match(r'^Their threats: (\S+(?: mate)?), (\S+)\.', t)
    if m:
        add(m.group(1)); add(m.group(2))
        return out
    m = re.match(r'^Their threat: (' + MOVE + r') (?:takes your \w+|is checkmate|wins material|wins your \w+)\.$', t)
    if m:
        add(m.group(1))
        return out
    m = re.match(r'^Their threat: (.+?), with (?:check)?mate to follow\.$', t)
    if m:
        add(m.group(1))
        return out
    m = re.match(r'^Two threats: (' + MOVE + r') mate and (' + MOVE + r')\.$', t)
    if m:
        add(m.group(1)); add(m.group(2))
        return out
    m = re.match(r"^(?:\S+|.+?) ignores (?:White|Black)'s threat: (" + MOVE + r') takes your \w+', t)
    if m:
        add(m.group(1))
        return out
    m = re.match(r"^(?:\S+|.+?) ignores their threat: their (\w+) takes your (\w+)", t)
    m2 = re.match(r'^Their threat: their (\w+) takes your (\w+)\.$', t)
    mm = m or m2
    if mm and mm.group(1) in NAME and mm.group(2) in NAME:
        caps = [y for y in nb.legal_moves if nb.piece_at(y.from_square) and nb.piece_at(y.from_square).piece_type == NAME[mm.group(1)]
                and nb.piece_at(y.to_square) and nb.piece_at(y.to_square).piece_type == NAME[mm.group(2)] and nb.piece_at(y.to_square).color == R.color]
        if caps:
            # the one they would choose: the best of them by the exchange, then searched
            caps.sort(key=lambda y: -chk.see_capture(nb, y))
            out.append(('their %s takes your %s' % (mm.group(1), mm.group(2)), caps[0]))
        return out
    return None


def guarded_threats(R, text):
    """"X guards your knight" (a reason, the settled row, See why's Better line, Details): a threat on
    each piece it names must be real, the best capture of it by them on the null-move board: [(name,
    move)], [] when no capture of it exists, None for no guards form"""
    m = re.search(r'\bguards ((?:[a-h][1-8]|your \w+)(?:(?:, | and )(?:[a-h][1-8]|your \w+|\w+))*)', text)
    if not m:
        return None
    nb = them_board(R.pre)
    out = []
    for it in re.split(r', | and ', m.group(1).replace('your ', '')):
        it = it.strip().rstrip('.')
        if it in NAME:
            caps = [y for y in nb.legal_moves if nb.piece_at(y.to_square) and nb.piece_at(y.to_square).color == R.color and nb.piece_at(y.to_square).piece_type == NAME[it]]
            if not caps:
                return []
            caps.sort(key=lambda y: -chk.see_capture(nb, y))
            out.append(('a capture of your ' + it, caps[0]))
    return out


THREAT_TYPES = ('details', 'check line', 'hint 1', 'hint 2', 'game hint 1', 'game hint 2', 'settled', 'see why', 'reason', 'foil hint', 'summary')


def post_threats(R, typ, field, text, v):
    """(e) on a verdict the base check gave: a named threat, or a guard of a piece, holds only where B5's
    rule finds the threat; the worst of the threats named stands"""
    if typ not in THREAT_TYPES or not R.pre or v[0] not in ('true', 'noise'):
        return v
    ths = named_threats(R, text)
    kind = 'threat'
    if ths is None:
        ths = guarded_threats(R, text)
        kind = 'guard'
    if not ths:
        return v
    order = {'false': 0, 'misleading': 1, 'noise': 2, 'true': 3}
    worst = v
    for name, mv in ths:
        w = threat_b5(R.pre, R.color, mv)
        if order.get(w[0], 3) < order.get(worst[0], 3):
            worst = (w[0], ('B5: "%s" ' % name if kind == 'threat' else 'B5: the guard needs a threat; %s: ' % name) + w[1])
    if kind == 'guard' and worst[0] == 'false':
        worst = ('misleading', worst[1])
    return worst


# (c): words that name material, and the move they are about
LOSS = [r'^(?:Then )?[Tt]heir \w+ takes your (?P<w>\w+)\.$', r'^(?:Then )?(?P<m>' + MOVE + r') takes your (?P<w>\w+)\.$',
        r'^After (?P<m2>\S+), you\'d lose (?P<w>.+)\.$', r'^You\'d lose (?P<w>.+)\.$',
        r'(?P<m>' + MOVE + r') could take your (?P<w>\w+)(?: with check)?\.$', r'could lose (?P<w>.+?)(?: after \S+)?\.$',
        r'\bYou (?:could )?lose (?P<w>.+?)\.$', r'\bloses (?P<w>(?:a|an|the|two|\w+ for) .+?)\.$']
SAVE = [r'^(?P<m>\S+) (?:saves|keeps) your (?P<w>\w+)\.', r'^Better: (?P<m>\S+)\. It (?:saves|keeps) your (?P<w>\w+)\.$',
        r'^(?P<m>.+?) (?:saves|keeps) your (?P<w>\w+)\.']
WIN = [r'^(?P<m>\S+) wins (?P<w>(?:a|an|the|two) \w+|[♔-♟]+(?: for [♔-♟]+)?)\.', r'\bYou win (?P<w>.+?)\.$', r'\bIt wins (?P<w>.+?)(?: on [a-h][1-8])?\.$',
       r"\bmisses (?:White|Black)'s undefended (?P<w>\w+) on [a-h][1-8]\.$"]
MAT_TYPES = ('reason', 'details', 'settled', 'see why', 'check line', 'hint 1', 'hint 2', 'practice reason', 'foil line', 'summary', 'explore')


def named_value(w):
    w = w.strip()
    if w in NAME:
        return VAL[NAME[w]]
    v = H1.piece_val_words(w) if w not in ('material', 'a lot of material') else None
    if v is None and re.match(r'^(the|a|an) (\w+)$', w) and w.split()[1] in NAME:
        v = VAL[NAME[w.split()[1]]]
    return v


def material_words(text):
    """(kind, value in pawns) for a string naming material lost, saved or won (its first sentence that
    does); None for none"""
    t = text.strip()
    if re.search(r'\b(mate|checkmate)\b', t):
        return None
    for sent in re.findall(r'[^.!?]+[.!?]+', t) or [t]:
        sent = sent.strip()
        for kind, rxs in (('loss', LOSS), ('save', SAVE), ('win', WIN)):
            for rx in rxs:
                m = re.search(rx, sent)
                if m:
                    v = named_value(m.group('w'))
                    if v:
                        return kind, v
    return None


def mates_in(fen, color, nodes, plies=12):
    """a forced mate within plies, either way, on fen: the mating side (color or not) or None"""
    e = chk.eval_side(fen, nodes, color)
    if e['mate'] is not None and abs(e['mate']) * 2 - 1 <= plies:
        return e['mate'] > 0
    return None


def subject(R, typ, kind):
    """the moves a material string compares: (board, the move it is about, the move it is set against).
    A loss: the try (or the game move) against the move due; a save or a win: the answer (or a try) against
    the game move"""
    if typ == 'explore':
        # Explore: the move played against the best there, on the board before it
        xp = R.r.get('xp') or {}
        pl = xp.get('parentLines') or []
        b = pl[0]['pv'][0] if pl and pl[0] and pl[0].get('pv') else None
        return (xp.get('parent'), xp.get('move'), b) if kind == 'loss' else (xp.get('parent'), b, xp.get('move'))
    if typ in ('reason', 'practice reason') and R.tried.get('uci'):
        if kind == 'loss':
            return R.st, R.tried['uci'], R.due()
        # a try's own save or win, against the game move on the card's first board (none mid-line)
        return (R.st, R.tried['uci'], R.played) if R.st == R.pre else (None, None, None)
    if kind == 'loss':
        return R.pre, R.played, R.best
    return R.pre, R.best, R.played


def post_material(R, typ, field, text, v):
    """(c): a material claim the base check called true understates when the line mates within 12 plies
    and the string does not say so, or the deep swing is more than the material named plus 2 pawns. A save
    ("g6 saves your pawn") and any claim that sets two moves side by side ("Better: Rd7. It wins ...", "Nxc2
    wins a bishop. Ne2 missed it.", "Rb1+ misses White's undefended pawn on a7.") is worth the swing between
    the two moves (exp2250-r2 5.3 and 5.7). Any other loss or win names what the move's own line does, read
    as B4 reads a settle point against its line's score: the move's deep score against the material the
    words leave (the material as it stands, or the best line's score where that is lower, less the loss;
    plus the win). So "Their king takes your bishop." after a try stands where the try's line loses that
    bishop, however much more the answer would have won."""
    if typ not in MAT_TYPES or v[0] not in ('true', 'noise') or (R.key or '').startswith(('pk:', 'ls:')):
        return v
    mw = material_words(text)
    if not mw:
        return v
    kind, val = mw
    # a claim that sets two moves side by side (a save; "Better: X. It wins ..."; "X wins a bishop. Y missed
    # it."; "Y misses White's undefended pawn") is worth the swing between them; any other names what the
    # move's own line does
    cmp = kind == 'save' or bool(re.search(r"^Better: |\bmisses (?:White|Black)'s undefended |\bmissed it\.$", text.strip()))
    color = R.color
    if typ == 'see why' and R.step:
        # See why: a step of the game line is about the game move against the answer; a step of the better
        # line about the better move against the game move where it saves or wins, and else only by the
        # mate clause, read on the step's own board
        seg = R.step.get('seg')
        if seg != 'game' and kind == 'loss':
            fen = R.step.get('after')
            mt = None if not fen or chess.Board(fen).is_game_over() else mates_in(fen, color, DEEP)
            if mt is not None:
                return M('understates: the line mates within 12 plies after this step (%s mates) and the words do not say so' % ('you' if mt else 'they'))
            return v
        if seg != 'game':
            yo = (R.ctx.get('yours') or [None])[0] if R.ctx.get('alt') else None
            base, u, other = R.pre, yo or R.best, R.played
        else:
            base, u, other = (R.pre, R.played, R.best) if kind == 'loss' else (R.pre, R.best, R.played)
    else:
        base, u, other = subject(R, typ, kind)
    if not base or not u or not other or u == other:
        return v
    if typ == 'explore':
        color = chess.Board(base).turn
    x, y = pair(base, u, other, color)
    sx = ('mate %d' % x['mate']) if x['mate'] is not None else '%+.2f' % (x['cp'] / 100.0)
    sy = ('mate %d' % y['mate']) if y['mate'] is not None else '%+.2f' % (y['cp'] / 100.0)
    # the line after the move the words are about: a mate within 12 plies either way
    a = after(base, u)
    mt = None if a.is_game_over() else mates_in(a.fen(), color, DEEP)
    if mt is not None:
        return M('understates: the line after %s mates within 12 plies (%s mates) and the words do not say so (%s %s, %s %s; the words name %s)' % (u, 'you' if mt else 'they', u, sx, other, sy, val))
    if cmp:
        cx = 1500 if (x['mate'] or 0) > 0 else -1500 if (x['mate'] or 0) < 0 else x['cp']
        cy = 1500 if (y['mate'] or 0) > 0 else -1500 if (y['mate'] or 0) < 0 else y['cp']
        gap = abs(cy - cx) / 100.0 - val
        note = 'the deep swing %s against %s is %.1f pawns (%s, %s); the words name %s' % (u, other, abs(cy - cx) / 100.0, sx, sy, val)
    else:
        if x['mate'] is not None or y['mate'] is not None:
            # a mate beyond 12 plies is no material: the mate clause reads mates
            return v
        mat0 = chk.mat_diff(chess.Board(base), color)
        if kind == 'loss':
            left = min(mat0, y['cp'] / 100.0) - val
            gap = left - x['cp'] / 100.0
        else:
            left = mat0 + val
            gap = x['cp'] / 100.0 - left
        # a decided position, the score past the words the same way, is no understatement of the outcome
        if (left >= 0 and x['cp'] >= 500) or (left <= -5 and x['cp'] <= -500):
            gap = 0
        note = 'the line after %s scores %s where the words leave %+.1f (material %+d as it stands, %s %s; the words name %s)' % (u, sx, left, mat0, other, sy, val)
    if gap > 3:
        return M('understates: ' + note)
    if gap > 2:
        # within a pawn of the rule's edge: the engine's noise at depth
        return ('noise', 'at the edge of understating: ' + note) if v[0] == 'true' else v
    return v


# (b): See why's band words, against the sign of the deep score on the step's board
LOSING = re.compile(r'\b(You lose less|you lose less|You still lose|limits the damage)\b')
WINNING = re.compile(r'\b(keeps you better|keeps you winning|You are better|you are still better)\b')


def post_band_sign(R, typ, field, text, v):
    if typ != 'see why' or not R.step or v[0] not in ('true', 'noise'):
        return v
    lo, hi = LOSING.search(text), WINNING.search(text)
    if not lo and not hi:
        return v
    fen = R.step.get('after') or R.step.get('before')
    if not fen:
        return v
    b = chess.Board(fen)
    if b.is_game_over():
        return v
    e = chk.eval_side(fen, DEEP, R.color)
    sc = 'mate %d' % e['mate'] if e['mate'] is not None else '%+.2f' % (e['cp'] / 100.0)
    if lo and ((e['mate'] or 0) > 0 or e['cp'] >= 100):
        return F('"%s" where the deep score is yours: %s for you after %s' % (lo.group(1), sc, R.step.get('move')))
    if hi and ((e['mate'] or 0) < 0 or e['cp'] <= -100):
        return F('"%s" where the deep score is theirs: %s for you after %s' % (hi.group(1), sc, R.step.get('move')))
    return v


def post_ranking(R, typ, field, text, v):
    """(a) on any surface (row 2, Details, See why): "X is as good as Y", "X also holds", "Your X works too"
    and "The main move was Y" are false where X forces mate and Y does not (or mates later), or scores 4
    or more above Y, side by side on the board they are said on"""
    if v[0] not in ('true', 'noise') or not R.pre or typ in ('practice details', 'practice settled', 'practice reason'):
        return v
    t = text.strip()
    yo = HV.yours_move(R)
    base = R.step['before'] if typ == 'see why' and R.step and R.step.get('before') else (yo[0] if yo else R.pre)
    due = (R.ctx.get('sol') or [None])[R.step['from'] - 1] if typ == 'see why' and R.step and R.step.get('from', 0) > 1 and R.ctx.get('sol') else (yo[2] if yo else R.best)
    b = chess.Board(base)
    pairs = []
    m = re.match(r'^(\S+) is as good as (\S+)\.$', t)
    if m:
        pairs.append((m.group(1), m.group(2)))
    m = re.match(r'^(\S+) also holds\.$', t) or re.match(r'^Your (\S+) works too\.$', t)
    if m and due:
        pairs.append((m.group(1), b.san(chess.Move.from_uci(due)) if chess.Move.from_uci(due) in b.legal_moves else None))
    m = re.match(r'^The main move was (\S+)\.$', t)
    if m and yo:
        pairs.append((b.san(chess.Move.from_uci(yo[1])) if chess.Move.from_uci(yo[1]) in b.legal_moves else None, m.group(1)))
    for xs, ys in pairs:
        x, y = (parse_move(b, xs) if xs else None), (parse_move(b, ys) if ys else None)
        if not x or not y or x == y:
            continue
        up, why = ranks_above(base, x.uci(), y.uci(), R.color)
        if up:
            return F('C5 (a): %s ranks above %s: %s' % (xs, ys, why))
    return v


def post_check(R, typ, field, text, v):
    for f in (post_ranking, post_band_sign, post_threats, post_material):
        v = f(R, typ, field, text, v)
    return v


# (g): one frame's strings about one move or one threat, against each other
def norm_move(b, text):
    x = HV2.words_move(b, re.sub(r' mate$', '', text.strip().rstrip('.')))
    return x.uci() if x else None


def surfaces(R, r):
    """[(text, verdict)] for the frame's pairs of strings that speak of the same moves: "X is as good as
    Y" (or "X also holds") beside "Y was the better move"; a single threat ("Their threat: T ...", the
    classifier's "ignores Black's threat: T ...") beside a list of threats it is not in, or beside
    another single threat"""
    if not R.pre:
        return []
    texts = []
    for f in ('row2', 'cap'):
        if r.get(f):
            texts.append((f, r[f]))
    texts += [('details', d) for d in r.get('details') or []]
    texts += [('summary', k) for k in (r.get('keep') or []) + ([r['tile']] if r.get('tile') else [])]
    b = chess.Board(R.pre)
    yours = (R.ctx.get('yours') or [None])
    equal, better, singles, sets = [], [], [], []
    for f, t in texts:
        m = re.match(r'^(\S+) is as good as (\S+)\.$', t)
        if m:
            equal.append(({norm_move(b, m.group(1)), norm_move(b, m.group(2))} - {None}, '%s "%s"' % (f, t)))
        m = re.match(r'^(\S+) also holds\.$', t)
        if m:
            equal.append(({norm_move(b, m.group(1)), R.best} - {None}, '%s "%s"' % (f, t)))
        if t == 'Just as good as the main answer.' and yours[0]:
            equal.append(({yours[0], R.best} - {None}, '%s "%s"' % (f, t)))
        m = re.match(r'^(.+) was the better move\.$', t)
        if m:
            u = norm_move(b, m.group(1))
            if u:
                better.append((u, '%s "%s"' % (f, t)))
        if f in ('details', 'summary', 'row2'):
            th = named_threats(R, t)
            if th:
                ms = {x.uci() for _, x in th}
                (sets if re.match(r'^(Their threats|Two threats): ', t) else singles).append((ms, '%s "%s"' % (f, t)))
    out = []
    for es, s1 in equal:
        for u, s2 in better:
            if u in es and len(es) == 2:
                out.append((s1 + ' | ' + s2, F('one frame calls the two moves equal and one of them the better move')))
    for ms, s1 in singles:
        for ss, s2 in sets:
            if ms <= ss:
                out.append((s1 + ' | ' + s2, T('the threat named is among the threats listed')))
            else:
                out.append((s1 + ' | ' + s2, F('"their threat" names %s, the threats listed are %s' % (sorted(ms), sorted(ss)))))
    for i, (m1, s1) in enumerate(singles):
        for m2, s2 in singles[i + 1:]:
            if m1 != m2 and not sets:
                out.append((s1 + ' | ' + s2, F('two strings each name "their threat", and not the same move: %s, %s' % (sorted(m1), sorted(m2)))))
    return out


def h_surface(R, m, text):
    return m
