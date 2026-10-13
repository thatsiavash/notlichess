"""Explore's words (release 2's C5 (f)): the sentence under the board after a move played in "Try your
own moves" and the three rows Stockfish gives at the position on screen, each read on the boards the
dump kept (xp: the position before the move, the move, the position after it). The sentence is said of
the move played against the best move there (B), from the side that played it; tier 1's sentence is the
tier 2 sentence in words and takes its verdict (final.py). The rows say where each of the three moves
leaves the player ("Your winning chances 47%.", "You mate in 3.", tier 1 "wins a knight", "allows a
fork", "you are better"). None of it is the card's own claim: the card's answer and game move are read
on the card's frames."""
import copy, re
import chess
import chk
import sf
from chk import parse_move, after
from claims import *
from handlers import PIECE, piece_val_words
import handlers3 as H3

SIDE_W = r'(?: for (?:White|Black))?'


def rec_for(R, fen, played, best):
    """the record seen from the side that played: the board before the move, the move, the best there"""
    x = copy.copy(R)
    c = dict(R.ctx)
    c.update({'pre': fen, 'st': fen, 'played': played, 'best': best, 'white': chess.Board(fen).turn == chess.WHITE, 'tried': None, 'sol': None, 'solIdx': 0})
    x.ctx = c
    x.white = c['white']
    x.color = chess.WHITE if x.white else chess.BLACK
    x.opp = 'Black' if x.white else 'White'
    x.me = 'White' if x.white else 'Black'
    x.step = None
    return x


def xp_of(R):
    return R.r.get('xp') or {}


def best_at(xp):
    pl = xp.get('parentLines') or []
    return pl[0]['pv'][0] if pl and pl[0] and pl[0].get('pv') else None


def wins(fen, a, b):
    """two moves side by side for the side to move: (win of a, win of b, mate of a, mate of b)"""
    bd = chess.Board(fen)
    x, y = pair(fen, a, b, bd.turn)
    return x['win'], y['win'], x['mate'], y['mate']


def gap_note(fen, x, b):
    bd = chess.Board(fen)
    wx, wb, mx, mb = wins(fen, x, b)
    return wx, wb, '%s %s, the best %s %s' % (bd.san(chess.Move.from_uci(x)), ('mate %d' % mx) if mx is not None else '%.0f%%' % wx,
                                           bd.san(chess.Move.from_uci(b)), ('mate %d' % mb) if mb is not None else '%.0f%%' % wb)


def sentences(t):
    return [s.strip() for s in re.findall(r'[^.!?…]+[.!?…]+', t)] or [t]


def h_xp_say(R, m, text):
    xp = xp_of(R)
    fen, x = xp.get('parent'), xp.get('move')
    if xp.get('spoil') or not fen or not x:
        return N('no sentence')
    if R.tier == 1:
        # tier 1's sentence is tier 2's in words: it takes that sentence's verdict (final.py)
        return U('tier 1 words of the tier 2 sentence')
    b = best_at(xp)
    if not b:
        return U('no best kept')
    bd = chess.Board(fen)
    mv = chess.Move.from_uci(x)
    after_b = after(fen, x)
    t = text.strip()
    if re.match(r'^Checkmate\. ', t):
        return (T if after_b.is_checkmate() else F)('')
    if re.match(r'^Stalemate\. ', t):
        return (T if after_b.is_stalemate() else F)('')
    notes, worst = [], T('')
    order = {'false': 0, 'misleading': 1, 'untestable': 2, 'noise': 3, 'true': 4}

    def take(v):
        nonlocal worst
        notes.append(v[1])
        if order.get(v[0], 4) < order.get(worst[0], 4):
            worst = v

    S = sentences(t)
    for i, s in enumerate(S):
        if re.match(r'^\S+ is (?:Stockfish|the computer)\'s pick\.$', s):
            if x == b:
                take(T('the best'))
            else:
                wx, wb, n = gap_note(fen, x, b)
                take(T(n) if wb - wx <= 4 else ('noise', n) if wb - wx <= 4 + TOL else F('not the pick: ' + n))
            continue
        mm = re.match(r'^It mates in (\d+)\.$', s)
        if mm:
            e = chk.eval_side(after_b.fen(), DEEP, bd.turn)
            take((T if (e['mate'] or 0) > 0 or after_b.is_checkmate() else F)('mate after it: %s' % e['mate']))
            continue
        mm = re.match(r'^It allows mate in (\d+)\.$', s)
        if mm:
            e = chk.eval_side(after_b.fen(), DEEP, bd.turn)
            take((T if (e['mate'] or 0) < 0 else F)('mate after it: %s' % e['mate']))
            continue
        mm = re.match(r'^It (wins|gives up) (.+)\.$', s)
        if mm and i > 0 and re.match(r'^\S+ is (?:Stockfish|the computer)\'s pick\.$', S[0]):
            v = piece_val_words(mm.group(2))
            take(gain_check(fen, bd.turn, [x], v) if mm.group(1) == 'wins' else loss_check(fen, bd.turn, [x], v))
            continue
        mm = re.match(r'^\S+ is about as good' + SIDE_W + r' as \S+\.$', s)
        if mm:
            wx, wb, n = gap_note(fen, x, b)
            take(T(n) if abs(wb - wx) <= 4 else ('noise', n) if abs(wb - wx) <= 4 + TOL else F(n))
            continue
        mm = re.match(r'^\S+ keeps most of (?:your|White\'s|Black\'s) advantage\.$', s)
        if mm:
            wx, wb, n = gap_note(fen, x, b)
            take(T(n) if wx >= 70 - TOL and wb >= wx else F(n))
            continue
        mm = re.match(r'^(\S+) (keeps more|loses less)\.$', s)
        if mm:
            wx, wb, n = gap_note(fen, x, b)
            take(T(n) if wb > wx else ('noise', n) if wb >= wx - TOL else F(n))
            continue
        mm = re.match(r'^\S+ is a little worse' + SIDE_W + r' than \S+\.$', s)
        if mm:
            wx, wb, n = gap_note(fen, x, b)
            d = wb - wx
            take(T(n) if 4 - TOL < d <= 10 + TOL else ('noise', n) if d <= 15 else F(n))
            continue
        mm = re.match(r'^\S+ is worse' + SIDE_W + r' than \S+\.$', s)
        if mm:
            wx, wb, n = gap_note(fen, x, b)
            take(T(n) if wb - wx > 4 - TOL else F(n))
            continue
        mm = re.match(r'^Best reply: (\S+), the gold arrow\.$', s)
        if mm:
            y = parse_move(after_b, mm.group(1))
            if not y:
                take(F('%s is not their move after %s' % (mm.group(1), x)))
            else:
                e = chk.eval_side(after_b.fen(), DEEP, after_b.turn)
                bb = (e['pv'] or [None])[0]
                if bb == y.uci():
                    take(T('their best'))
                else:
                    wy, wq, n = gap_note(after_b.fen(), y.uci(), bb)
                    take(T(n) if wq - wy <= 4 else ('noise', n) if wq - wy <= 4 + TOL else M('not their best reply: ' + n))
            continue
        mm = re.match(r'^Best was (\S+)\.$', s)
        if mm:
            y = parse_move(bd, mm.group(1))
            if not y:
                take(F('%s is not legal' % mm.group(1)))
            elif y.uci() == b:
                take(T('the best'))
            else:
                e = chk.eval_side(fen, DEEP, bd.turn)
                wy, wq, n = gap_note(fen, y.uci(), (e['pv'] or [b])[0])
                take(T(n) if wq - wy <= 4 else F(n))
            continue
        mm = re.match(r'^(It|\S+) sets up (\S+), which forks the (\w+) and (\w+)\.$', s)
        if mm:
            take(sets_up(fen, b, mm))
            continue
        mm = re.match(r'^(It|\S+) forces mate in (\d+)\.$', s)
        if mm:
            e = sf.go(fen, DEEP, 1, [b])
            l0 = (e.get('lines') or [{}])[0]
            take((T if (l0.get('mate') or 0) > 0 else F)('the best %s: mate %s' % (b, l0.get('mate'))))
            continue
        mm = re.match(r'^(It|\S+) wins (.+?)( on ([a-h][1-8]))?\.$', s)
        if mm:
            v = piece_val_words(mm.group(2))
            take(gain_check(fen, bd.turn, [b], v) if v else U('"wins %s" not read' % mm.group(2)))
            continue
        mm = re.match(r'^(?:You|White|Black|\S+) loses? (.+?)\.$', s)
        if mm and ':' not in s:
            v = piece_val_words(mm.group(1))
            take(loss_check(fen, bd.turn, [x], v) if v else U('"loses %s" not read' % mm.group(1)))
            continue
        mm = re.match(r'^\S+ loses the (\w+): (.+)\.$', s)
        if mm:
            v = piece_val_words('the ' + mm.group(1))
            take(loss_check(fen, bd.turn, [x], v) if v else U('form'))
            continue
        mm = re.match(r'^(\S+) puts your (\w+) where (\S+) takes it\.$', s)
        if mm and mm.group(2) in NAME:
            y = parse_move(after_b, mm.group(3))
            if not y or not after_b.is_capture(y) or (after_b.piece_at(y.to_square) or chess.Piece(chess.PAWN, True)).piece_type != NAME[mm.group(2)]:
                take(F('%s does not take your %s after %s' % (mm.group(3), mm.group(2), x)))
            else:
                take(loss_check(fen, bd.turn, [x], VAL[NAME[mm.group(2)]] - 0.5))
            continue
        # "It stops Bxe4.": Explore says "It" for the best move where its sentence already named it
        if s.startswith('It ') and b != x:
            s = bd.san(chess.Move.from_uci(b)) + s[2:]
        # the classifier's sentence about the move played (its counts taken out), read as Details reads
        # the game move's: on the board before it, from the side that played it
        if s.split(' ')[0] == bd.san(mv) or s.startswith(bd.san(mv) + ' '):
            v = H3.h_classifier(rec_for(R, fen, x, b), None, s)
            take(v)
            continue
        # the best move's sentence ("g6 moves the pawn out of danger.", "Qd2 keeps everything safe."), as
        # Details reads the better move's
        if s.split(' ')[0] == bd.san(chess.Move.from_uci(b)):
            take(H3.h_best_sentence(rec_for(R, fen, x, b), None, s))
            continue
        mm = re.match(r'^(\S+) stops (\S+)\.$', s)
        if mm:
            take(H3.h_stops(rec_for(R, fen, x, b), mm, s))
            continue
        take(U('Explore sentence not read: ' + s))
    if worst[0] == 'true':
        return T('; '.join(n for n in notes if n))
    return (worst[0], '; '.join(n for n in notes if n))


def sets_up(fen, b, mm):
    """"It sets up Y, which forks the A and B.": after the best move B and their best reply, Y is a
    move of B's side and forks those two pieces (exp2250-r2 5.6: Qd5+ that neither side could play)"""
    bd = chess.Board(fen)
    mover = bd.turn
    y = bd.copy(stack=False)
    y.push(chess.Move.from_uci(b))
    if y.is_game_over():
        return F('the game ends after %s' % b)
    e = chk.eval_side(y.fen(), DEEP, y.turn)
    rp = (e['pv'] or [None])[0]
    if not rp:
        return U('no reply')
    y.push(chess.Move.from_uci(rp))
    z = parse_move(y, mm.group(2))
    if not z:
        nb = chk.null(y)
        other = parse_move(nb, mm.group(2))
        return F('%s is not a move of %s after %s %s%s' % (mm.group(2), 'White' if mover else 'Black', b, rp, ' (only of the other side)' if other else ' (nor of the other side)'))
    fk = fork_of(y, z, mover)
    w = y.copy(stack=False)
    w.push(z)
    names = sorted(PNAME[w.piece_at(q).piece_type] for q in fk)
    ok = mm.group(3) in names and mm.group(4) in names
    return (T if ok else F)('after %s %s, %s hits %s' % (b, rp, mm.group(2), names))


X3 = {'you are winning': (80, 101), 'you are better': (60, 80), 'even game': (40, 60)}


def h_xp_row(R, m, text):
    """a row: its move at the position on screen (xp.fen) and where it leaves the player"""
    xp = xp_of(R)
    rows = xp.get('rows') or []
    row = next((w for w in rows if (w.get('label') or '') == text or (w.get('words') and text.endswith(w['words'] + '.'))), None)
    if not row:
        return U('row not kept')
    fen = xp.get('fen')
    if not fen:
        return U('no board')
    bd = chess.Board(fen)
    u = row['uci']
    mv = chess.Move.from_uci(u)
    if mv not in bd.legal_moves:
        return F('%s is not legal on the board shown' % u)
    me = R.color
    a = after(fen, u)
    if a.is_game_over():
        res = a.is_checkmate()
        return T('the game ends: %s' % ('mate' if res else 'draw'))
    e = chk.eval_side(a.fen(), DEEP, me)
    sc = ('mate %d' % e['mate']) if e['mate'] is not None else '%.0f%%' % e['win']
    w = row.get('words') or ''
    lab = text
    # release 1's label ends on its figure ("Bxg7+, then Kg8 Bh8. Your winning chances 24%."); slice A's
    # starts with it ("You 24%, 25.Bxg7+, then Kg8 26.Bh8.", WCAG 2.5.3)
    mm = re.search(r'Your winning chances (\d+)%\.$', lab) or re.match(r'^You (\d+)%, ', lab)
    if mm:
        # the row's figure is its line's in Stockfish's three lines at the position shown: read the same
        # way, deeper (the line's own search where the deep three lines leave it out)
        r3 = sf.go(fen, DEEP, 3, None)
        l3 = next((l for l in r3.get('lines') or [] if l.get('pv') and l['pv'][0] == u), None)
        if l3 is not None:
            flip = me != bd.turn
            w3, m3 = chk.win_pct(chk.line_score(l3, flip)), l3.get('mate')
            sc = ('mate %d' % ((-m3 if flip else m3))) if m3 is not None else '%.0f%%' % w3
            wd = w3 if m3 is None else None
        else:
            wd = e['win'] if e['mate'] is None else None
        if wd is None:
            return F('"%s%%": %s for you' % (mm.group(1), sc))
        d = abs(wd - int(mm.group(1)))
        return T('deep %s' % sc) if d <= 8 else ('noise', 'deep %s' % sc) if d <= 13 else M('"%s%%": deep %s' % (mm.group(1), sc))
    mm = re.search(r'You mate in (\d+)\.$', lab) or re.match(r'^You mate in (\d+), ', lab) or (re.match(r'^mates in (\d+)$', w) if bd.turn == me else None)
    if mm:
        return (T if (e['mate'] or 0) > 0 else F)('deep %s' % sc)
    mm = re.search(r'They mate in (\d+)\.$', lab) or re.match(r'^They mate in (\d+), ', lab) or (re.match(r'^mates in (\d+)$', w) if bd.turn != me else None)
    if mm:
        return (T if (e['mate'] or 0) < 0 else F)('deep %s' % sc)
    mm = re.match(r'^allows mate in (\d+)$', w)
    if mm:
        e2 = chk.eval_side(a.fen(), DEEP, bd.turn)
        return (T if (e2['mate'] or 0) < 0 else F)('after it, mate for them: %s' % e2['mate'])
    if re.search(r'A draw\.$', lab) or lab.startswith('A draw, ') or w == 'a draw':
        return (T if e['mate'] is None and abs(e['cp']) <= 60 else F)('deep %s' % sc)
    mm = re.match(r'^(wins|gives up) (.+)$', w)
    if mm:
        v = piece_val_words(mm.group(2))
        return (gain_check(fen, bd.turn, [u], v) if mm.group(1) == 'wins' else loss_check(fen, bd.turn, [u], v)) if v else U('form')
    mm = re.match(r'^loses (the \w+)(?: to (\S+))?$', w)
    if mm:
        return loss_check(fen, bd.turn, [u], piece_val_words(mm.group(1)))
    mm = re.match(r'^allows a fork(?:: (\S+))?$', w)
    if mm:
        e2 = chk.eval_side(a.fen(), DEEP, a.turn)
        rp = (e2['pv'] or [None])[0]
        if not rp:
            return U('no reply')
        z = chess.Move.from_uci(rp)
        fk = fork_of(a, z, a.turn)
        return (T if len(fk) >= 2 else M)('their best reply %s hits %d pieces' % (rp, len(fk)))
    if w == 'walks into a pin':
        e2 = chk.eval_side(a.fen(), DEEP, a.turn)
        y = a.copy(stack=False)
        for r in (e2['pv'] or [])[:2]:
            y.push(chess.Move.from_uci(r))
        pins = [q for q, p in y.piece_map().items() if p.color == bd.turn and p.piece_type not in (chess.KING, chess.PAWN) and pinned_relative(y, q)]
        return (T if pins else M)('pinned after their best line: %s' % [chess.square_name(q) for q in pins])
    if w == 'allows a hidden attack':
        return H3.h_classifier(rec_for(R, fen, u, u), None, bd.san(mv) + ' allows a discovered attack.')
    mm = re.match(r'^misses (\S+|a stronger move)$', w)
    if mm:
        e2 = chk.eval_side(fen, DEEP, bd.turn)
        bb = (e2['pv'] or [None])[0]
        if not bb or bb == u:
            return F('%s is the best there' % u)
        wx, wb, n = gap_note(fen, u, bb)
        return T(n) if wb - wx > 4 else ('noise', n) if wb - wx > 4 - TOL else F(n)
    if w in X3 or re.match(r'^(White|Black) is (better|winning)$', w):
        lo, hi = X3.get(w) or ((0, 20) if w.endswith('winning') else (20, 40))
        if e['mate'] is not None:
            ok = (e['mate'] > 0) == (lo >= 60)
            return (T if ok else F)('deep %s' % sc)
        off = 0 if lo <= e['win'] < hi else (lo - e['win'] if e['win'] < lo else e['win'] - hi)
        return T('deep %s' % sc) if off <= TOL else ('noise', 'deep %s' % sc) if off <= 10 else F('deep %s' % sc)
    return U('Explore row not read: ' + (w or lab))


SAY = [(r'^.+$', h_xp_say)]
ROW = [(r'^.+$', h_xp_row)]
