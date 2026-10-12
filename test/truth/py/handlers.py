"""The claim handlers, by the strings' own forms (see claims.py for the verdicts)."""
import re
import chess
import chk
import sf
from chk import VAL, NAME, PNAME, parse_move, after, win_pct
from claims import *

PIECE = r'(pawn|knight|bishop|rook|queen|king)'
SIDE = r'(White|Black)'
MOVE = r'(.+?)'
# practice position id -> its skill, from the page's own PRAC_DATA (pdata.json, written by screens.js)
PRAC_SKILL = {}


def piece_val_words(s):
    v, exact = chk.ledger_value(s)
    return v


# ── the try's reason (M3, practice reasons) ────────────────────────────────
def try_ctx(R):
    t = R.tried
    if not t or not t.get('uci'):
        return None
    return R.st, t['uci'], t.get('reply')


def h_then_mate(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    x = mv(b, m.group(1))
    if not x:
        return F('%s is not a legal move after the try' % m.group(1))
    b.push(x)
    if not b.is_checkmate():
        return F('%s is not checkmate' % m.group(1))
    if c[2] and x.uci() != c[2]:
        return T('mate, but See it plays %s' % c[2])
    return T('mate in one')


def h_could_mate(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    if m.group(1) != R.opp:
        return F('names the wrong side')
    if chk.mates_in_one(b):
        return T('mate in one')
    e = ev(b.fen(), not R.color, DEEP)
    if e['mate'] is not None and e['mate'] > 0:
        return T('forced mate in %s for them' % e['mate'])
    if e['win'] >= 90:
        return M('no forced mate found at 2M nodes, but they are winning (%.0f%%)' % e['win'])
    return F('no mate: their win chance %.0f%% (%s)' % (e['win'], ' '.join(e['pv'][:8])))


def capture_reason(R, by_word, of_word, san=None):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    reply = c[2]
    rm = chess.Move.from_uci(reply) if reply else None
    if san:
        x = mv(b, san)
        if not x:
            return F('%s is not legal after the try' % san)
        if rm and x != rm:
            return M('names %s, See it plays %s' % (san, reply))
        rm = x
    if not rm or rm not in b.legal_moves:
        caps = legal_capture(b, pt(by_word) if by_word else None, pt(of_word), R.color)
        if not caps:
            return F('no %s can take a %s after the try' % (by_word or 'piece', of_word))
        rm = caps[0]
    mover, victim = b.piece_at(rm.from_square), b.piece_at(rm.to_square)
    if b.is_en_passant(rm):
        victim = chess.Piece(chess.PAWN, R.color)
    if not victim or victim.color != R.color or victim.piece_type != pt(of_word):
        return F('the reply %s takes %s, not your %s' % (rm.uci(), victim and PNAME[victim.piece_type], of_word))
    if by_word and mover.piece_type != pt(by_word):
        return F('the reply is by a %s, not a %s' % (PNAME[mover.piece_type], by_word))
    # does it really cost the player that piece (net of what comes back)?
    s = chk.settled_delta(c[0], R.color, [c[1], rm.uci()], DEEP)
    loss = -s['delta']
    note = 'after the try and %s, deep line %s, net %s' % (rm.uci(), ' '.join(s['pv'][:8]), -loss)
    if loss >= min(VAL[pt(of_word)], 3) - 1:
        # the real refutation: Stockfish's own answer to the try, against the capture named
        e = ev(b.fen(), R.color, DEEP)
        if e['pv'] and e['pv'][0] != rm.uci():
            e2 = ev(after(c[0], c[1], rm.uci()).fen(), R.color, DEEP)
            if e2['win'] - e['win'] >= 25 and e['win'] < 30:
                return M('names %s, but their best answer %s is much worse for you (%.0f%% against %.0f%% after the capture): ' % (rm.uci(), e['pv'][0], e['win'], e2['win']) + note)
        return T(note)
    # against the answer's own line: where the answer wins material, the capture may be exactly what the try
    # costs (a free piece still taken later, a pawn less than the answer gets)
    due = R.due()
    if due and due != c[1]:
        sb = chk.settled_delta(c[0], R.color, [due], DEEP)
        rel = sb['delta'] - s['delta']
        note += "; the answer's line nets %s (%s)" % (sb['delta'], ' '.join(sb['pv'][:6]))
        if rel >= min(VAL[pt(of_word)], 3) - 1:
            return T('against the answer, the try costs %s: ' % rel + note)
    if loss <= 0:
        return M('the capture is legal, but the player gets it back: ' + note)
    return ('noise', 'the capture is legal, and costs some material, less than a %s: ' % of_word + note)


def h_their_takes(R, m, text):
    return capture_reason(R, m.group(1), m.group(2))


def h_san_takes(R, m, text):
    return capture_reason(R, None, m.group(2), san=m.group(1))


def h_lose(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    claimed = piece_val_words(m.group(m.lastindex))
    if m.lastindex >= 2 and m.group(1):
        b = after(c[0], c[1])
        x = mv(b, m.group(1))
        if not x:
            return F('%s is not legal after the try' % m.group(1))
        if c[2] and x.uci() != c[2]:
            return M('names %s as their reply; See it plays %s' % (m.group(1), c[2]))
        # "After X, you'd lose Y": the loss read after the try and X, the reply it names
        v = loss_check(c[0], R.color, [c[1], x.uci()], claimed)
        return (v[0], v[1] + ' [after the try and %s]' % x.uci())
    return loss_check(c[0], R.color, [c[1]], claimed)


def h_after_band(R, m, text):
    """After X, the game is even / White is better / winning"""
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    x = mv(b, m.group(1))
    if not x:
        return F('%s is not legal after the try' % m.group(1))
    band = band_word(m.group(2), R.opp)
    e = ev(b.fen(), R.color, DEEP)
    note = 'after the try: player %.0f%% (%s); %s is %s' % (e['win'], ' '.join(e['pv'][:6]), m.group(1), 'their best' if e['pv'] and e['pv'][0] == x.uci() else 'not their best (%s)' % (e['pv'][0] if e['pv'] else '?'))
    v = band_verdict(e['win'], band, note)
    # v2 slice 2: as "After X, you'd lose Y" (h_lose), the band is read after the try and the reply it
    # names; where it holds there but their best reply leaves the player worse: misleading
    if v[0] == 'false' and e['pv'] and e['pv'][0] != x.uci():
        b2 = b.copy(stack=False)
        b2.push(x)
        e2 = ev(b2.fen(), R.color, DEEP)
        v2 = band_verdict(e2['win'], band, 'after the try and %s: player %.0f%%' % (x.uci(), e2['win']))
        if v2[0] == 'true':
            return M('the band holds after the reply named, not after their best reply: ' + v2[1] + ' || ' + v[1])
    return v


def h_now_band(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    e = ev(b.fen(), R.color, DEEP)
    t = text
    band = 'even' if 'even' in t else 'opp winning' if 'winning' in t else 'opp better'
    if (' %s ' % R.me) in (' ' + t + ' '):
        return F('names the player as the side on top')
    return band_verdict(e['win'], band, 'player %.0f%% after the try' % e['win'])


def h_still_better(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    wt, wb = two(c[0], c[1], R.due() if R.due() != c[1] else c[1], R.color)
    note = 'try %.0f%%, best %.0f%%' % (wt, wb)
    if 'Most of your advantage' in text:
        if wt < 60 - TOL:
            return F('not still better: ' + note)
        adv_b, adv_t = wb - 50, wt - 50
        if adv_b <= 0 or (adv_b - adv_t) < adv_b / 2 - 3:
            return M('less than half the advantage is gone: ' + note)
        return T(note)
    if wt < 60 - TOL or wt >= wb:
        return F(note)
    return T(note)


def h_still_attacked(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    word = m.group(m.lastindex)
    b0 = chess.Board(c[0])
    b = after(c[0], c[1])
    if m.lastindex >= 2 and m.group(1):
        x = mv(b, m.group(1))
        if not x:
            return F('%s is not legal after the try' % m.group(1))
        b.push(x)
    elif c[2]:
        b.push(chess.Move.from_uci(c[2]))
    found, past = [], []
    for s in pieces_of(b, R.color, pt(word)):
        if b0.piece_at(s) != b.piece_at(s):
            continue
        if chk.attackers_legal(b, s):
            found.append(chess.square_name(s))
        elif chk.attacked_past_check(b, s):
            # the try gave check: they cannot take it this move, and it stays attacked whatever they answer
            past.append(chess.square_name(s))
    if not found and not past:
        return F('no %s of yours stands attacked on the same square' % word)
    if not found:
        return T('attacked on %s after any answer to the check' % ','.join(past))
    danger = [s for s in found if chk.in_danger(b, chess.parse_square(s))]
    return T('attacked on %s%s' % (','.join(found), '' if danger else ' (taking it would not pay for them)'))


def h_nothing_lost(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    s = chk.settled_delta(c[0], R.color, [c[1]], DEEP)
    wt, wb = two(c[0], c[1], R.due(), R.color)
    note = 'net %s, try %.0f%% best %.0f%%' % (s['delta'], wt, wb)
    if s['delta'] <= -1:
        return F(note)
    return T(note) if wb - wt > 2 else M('the try is as good: ' + note)


def h_stronger_here(R, m, text):
    wt, wb = two(R.st, R.played, R.due(), R.color)
    return (T if wb - wt > 3 else F)('game move %.0f%%, best %.0f%%' % (wt, wb))


def h_helps(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    if m.group(1) != R.opp:
        return F('names the wrong side')
    wt, wb = two(c[0], c[1], R.due(), R.color, MID)
    return (T if wb - wt > 3 else F)('try %.0f%%, best %.0f%%' % (wt, wb))


# practice-only reasons
def h_not_mate(R, m, text):
    c = try_ctx(R)
    b = after(c[0], c[1])
    b0 = chess.Board(c[0])
    if b.is_checkmate():
        return F('it is mate')
    return T('not mate; a mate in one existed' if chk.mates_in_one(b0) else 'not mate (no mate in one existed here)')


def h_was_free(R, m, text):
    c = try_ctx(R)
    b0 = chess.Board(c[0])
    free = []
    for mm in b0.legal_moves:
        v = b0.piece_at(mm.to_square)
        if v and v.color != b0.turn and v.piece_type != chess.PAWN and chk.see_capture(b0, mm) >= VAL[v.piece_type]:
            free.append(mm.uci())
    if not free:
        return F('no piece of theirs could be taken for free')
    if c[1] in free:
        return F('the try took the free piece')
    return T('free: ' + ','.join(free))


def h_safe_to_take(R, m, text):
    c = try_ctx(R)
    b0 = chess.Board(c[0])
    good = [mm.uci() for mm in b0.legal_moves if b0.is_capture(mm) and chk.see_capture(b0, mm) >= 0]
    bad = [mm.uci() for mm in b0.legal_moves if b0.is_capture(mm) and chk.see_capture(b0, mm) < 0]
    if not good:
        return F('no capture was safe')
    return T('safe: %s; unsafe: %s' % (','.join(good), ','.join(bad)))


def h_pawn_queen(R, m, text):
    c = try_ctx(R)
    b = after(c[0], c[1])
    pr = [x for x in b.legal_moves if x.promotion]
    if not pr:
        return F('no pawn of theirs can promote after the try')
    safe = []
    for x in pr:
        y = b.copy(stack=False)
        y.push(x)
        if not any(z.to_square == x.to_square for z in y.legal_moves):
            safe.append(x.uci())
    if not safe:
        return M('it can promote, but the new piece is taken at once (%s)' % ','.join(z.uci() for z in pr))
    return T('promotes: ' + ','.join(safe))


# V3.2's practice reasons (added for the v2 slice 3 rerun)
def h_guarded(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b0 = chess.Board(c[0])
    x = chess.Move.from_uci(c[1])
    v = b0.piece_at(x.to_square)
    if not v or v.color == b0.turn:
        return F('the try takes nothing')
    g = chk.guards(b0, x.to_square)
    if not g:
        return F('the piece on %s has no guard' % chess.square_name(x.to_square))
    see = chk.see_capture(b0, x)
    return (T if see < 0 else M)('guards %s; the exchange nets %s' % ([chess.square_name(q) for q in g], see))


def h_mate_two(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    if chk.mates_in_one(b):
        return M('they mate in one')
    e = ev(b.fen(), not R.color, DEEP)
    if e['mate'] is not None and e['mate'] == 2:
        return T('mate in two: %s' % ' '.join(e['pv'][:3]))
    if e['mate'] is not None and e['mate'] > 2:
        return M('a forced mate in %d, not two' % e['mate'])
    return F('no mate in two: %s, they have %.0f%%' % (' '.join(e['pv'][:4]), e['win']))


def h_force_mate(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    if chk.mates_in_one(b):
        return T('mate in one')
    e = ev(b.fen(), not R.color, DEEP)
    if e['mate'] is not None and e['mate'] > 0:
        return T('forced mate in %d' % e['mate'])
    if e['win'] >= 90:
        return M('no forced mate found, but they are winning (%.0f%%)' % e['win'])
    return F('no forced mate: they have %.0f%%' % e['win'])


def h_san_forces(R, m, text):
    c = try_ctx(R)
    if not c:
        return U('no try')
    b = after(c[0], c[1])
    x = mv(b, m.group(1))
    if not x:
        return F('%s is not legal after the try' % m.group(1))
    b.push(x)
    if b.is_checkmate():
        return T('mate')
    e = ev(b.fen(), not R.color, DEEP)
    if e['mate'] is not None and e['mate'] > 0:
        return T('after %s, a forced mate in %d' % (m.group(1), e['mate']))
    return F('after %s no forced mate: they have %.0f%%' % (m.group(1), e['win']))


def h_only_one(R, m, text):
    due = R.due()
    b = chess.Board(R.st)
    f = chess.parse_square(due[:2])
    p = b.piece_at(f)
    if not p or PNAME[p.piece_type] != m.group(1):
        return F('the circled piece is no %s' % m.group(1))
    moves = [x.uci() for x in b.legal_moves if x.from_square == f]
    r = sf.go(R.st, DEEP, len(moves), moves)
    ws = sorted([(chk.win_pct(chk.line_score(l)), l['pv'][0]) for l in r['lines'] if l['pv']], reverse=True)
    if not ws:
        return U('no lines')
    if ws[0][1] != due:
        return M('the best %s move is %s, not the answer %s' % (m.group(1), ws[0][1], due))
    gap = ws[0][0] - ws[1][0] if len(ws) > 1 else 100
    note = '%s moves: %s' % (m.group(1), ws[:3])
    if gap >= 10 - TOL:
        return T(note)
    return ('noise', note) if gap >= 4 else M(note)


REASON = [
    (r'^Then (.+) is checkmate\.$', h_then_mate),
    (r'^' + SIDE + r' could checkmate you\.$', h_could_mate),
    (r'^Their ' + PIECE + r' takes your ' + PIECE + r'\.$', h_their_takes),
    (r'^(\S+) takes your ' + PIECE + r'\.$', h_san_takes),
    (r'^After (.+), you\'d lose (.+)\.$', h_lose),
    (r'^You\'d lose ()(.+)\.$', h_lose),
    (r'^After (.+), (the game is even|White is better|Black is better|White is winning|Black is winning)\.$', h_after_band),
    (r'^Now (the game is even|White is better|Black is better|White is winning|Black is winning)\.$', h_now_band),
    (r'^(Most of your advantage is gone|You are still better, but less so)\.$', h_still_better),
    (r'^(.+), and your ' + PIECE + r' is still attacked\.$', h_still_attacked),
    (r'^()Your ' + PIECE + r' is still attacked\.$', h_still_attacked),
    (r'^Nothing lost, but there\'s a better move\.$', h_nothing_lost),
    (r'^There\'s a stronger move here\.$', h_stronger_here),
    (r'^That helps ' + SIDE + r'\.$', h_helps),
    (r'^That is not mate\.$', h_not_mate),
    (r'^A piece of theirs was free\.$', h_was_free),
    (r'^One of them was safe to take\.$', h_safe_to_take),
    (r'^Then their pawn can become a queen\.$', h_pawn_queen),
    (r'^That piece is guarded\.$', h_guarded),
    (r'^Then they mate in two\.$', h_mate_two),
    (r'^Then they can force checkmate\.$', h_force_mate),
    (r'^Then (\S+) forces mate\.$', h_san_forces),
]


# ── verdict words (row 1) ─────────────────────────────────────────────────
def h_verdict(R, m, text):
    t = R.tried
    fen = R.st
    if text in ('Not this one',):
        if not t.get('uci'):
            return U('no try')
        pid = (R.key or '')[3:] if (R.key or '').startswith('pk:') else None
        sk = (PRAC_SKILL.get(pid) or pid.split('-')[0]) if pid else ''
        if sk in ('mate1', 'backrank'):
            # the task is "Find mate in one." / "Find the back-rank mate.": the verdict says the try is not
            # the mate (the skill read from the practice data, so the real-game positions count too)
            x = chess.Board(fen)
            x.push(chess.Move.from_uci(t['uci']))
            return F('the try is checkmate too') if x.is_checkmate() else T('mate task: the try is not mate')
        wt, wb = two(fen, t['uci'], R.due(), R.color)
        if wb - wt <= 0.5:
            return F('the try is as good as the answer: try %.0f%%, best %.0f%%' % (wt, wb))
        if wb - wt <= 4:
            return ('noise', 'within the solve tolerance at 2M nodes: try %.0f%%, best %.0f%%' % (wt, wb))
        if wt >= 70 and wb >= 70 and wb - wt <= 10:
            return M('the try keeps a winning position: try %.0f%%, best %.0f%%' % (wt, wb))
        return T('try %.0f%%, best %.0f%%' % (wt, wb))
    if text == 'Good move':
        if not t.get('uci'):
            return U('no try')
        wt, wb = two(fen, t['uci'], R.due(), R.color)
        gap = wb - wt
        if gap > 18 and wt < 70:
            return M('called a good move, but it loses %.0f points: try %.0f%%, best %.0f%%' % (gap, wt, wb))
        if gap > 13 and wt < 70:
            return ('noise', 'a good move %.0f points below the best: try %.0f%%, best %.0f%%' % (gap, wt, wb))
        return T('try %.0f%%, best %.0f%%' % (wt, wb))
    if text == "There's a stronger one.":
        if not t.get('uci'):
            return U('no try')
        wt, wb = two(fen, t['uci'], R.due(), R.color)
        if wb - wt <= 0:
            return M('the try is as good as the best at 1M nodes: try %.0f%%, best %.0f%%' % (wt, wb))
        return (T if wb - wt > 1.5 else lambda n: ('noise', n))('try %.0f%%, best %.0f%%' % (wt, wb))
    if text == 'That works too':
        y = R.ctx.get('yours') or []
        if not y:
            return U('no move of yours kept')
        at = 0
        sol = R.ctx.get('sol') or []
        u = y[0]
        for i, mm in enumerate(y):
            if i < len(sol) and sol[i] == mm:
                continue
            u, at = mm, i
            break
        base = after(R.pre, *y[:at]).fen()
        due = sol[at] if sol and at < len(sol) else R.best
        wt, wb = two(base, u, due, R.color)
        # v1: a safe win's 70% edge with the methodology's band-edge noise (TOL)
        if wb - wt <= 6 or (wt >= 70 - TOL and wb >= 70 - TOL):
            return T('%s %.0f%%, the answer %.0f%%' % (u, wt, wb))
        if wb - wt <= 10.5:
            return ('noise', '%s %.0f%%, the answer %.0f%%' % (u, wt, wb))
        return M('%s is %.0f points worse than the answer (%.0f%% to %.0f%%)' % (u, wb - wt, wt, wb))
    return N()


VERDICT = [(r'^(Not this one|Good move|That works too)$', h_verdict), (r"^There's a stronger one\.$", h_verdict)]


# ── hints ───────────────────────────────────────────────────────────────────
def named_square(R, ptype, kind='attacked'):
    sq = [x['sq'] for x in rings(R, kind) if x.get('sq')]
    b = chess.Board(R.st)
    out = [chess.parse_square(s) for s in sq if b.piece_at(chess.parse_square(s)) and b.piece_at(chess.parse_square(s)).piece_type == ptype and b.piece_at(chess.parse_square(s)).color == R.color]
    if not out:
        out = pieces_of(b, R.color, ptype)
    return b, out


def h_attacked_n(R, m, text):
    p, n = m.group(1), times(m.group(2))
    b, sqs = named_square(R, pt(p))
    counts = {chess.square_name(s): attacked_count(b, s) for s in sqs}
    if any(v == n for v in counts.values()):
        return T('attackers: %s' % counts)
    return F('your %s is attacked %s times, not %s' % (p, counts, n))


def h_their_attacks(R, m, text):
    a, p = m.group(1), m.group(2)
    b, sqs = named_square(R, pt(p))
    for s in sqs:
        for f in chk.attackers_legal(b, s):
            if b.piece_at(f).piece_type == pt(a):
                return T('%s on %s attacks %s' % (a, chess.square_name(f), chess.square_name(s)))
    return F('no %s of theirs attacks your %s' % (a, p))


def h_two_attacked(R, m, text):
    p = m.group(1)
    b = chess.Board(R.st)
    att = [s for s in pieces_of(b, R.color, pt(p)) if chk.attackers_legal(b, s)]
    return (T if len(att) >= 2 else F)('%s attacked: %s' % (p, [chess.square_name(s) for s in att]))


def h_pair_attacked(R, m, text):
    b = chess.Board(R.st)
    ok = []
    for w in (m.group(1), m.group(2)):
        att = [s for s in pieces_of(b, R.color, pt(w)) if chk.attackers_legal(b, s)]
        ok.append(bool(att))
    return (T if all(ok) else F)('%s %s' % (m.group(1), m.group(2)))


def h_one_attacked(R, m, text):
    b = chess.Board(R.st)
    att = [s for s in pieces_of(b, R.color, pt(m.group(1))) if chk.attackers_legal(b, s)]
    return (T if att else F)('attacked: %s' % [chess.square_name(s) for s in att])


def h_in_check(R, m, text):
    b = chess.Board(R.st)
    return (T if b.is_check() and b.turn == R.color else F)('player in check: %s' % b.is_check())


def h_threaten_mate(R, m, text):
    b = chk.null(chess.Board(R.st if not R.frame.startswith('best story') else R.pre))
    x = mv(b, m.group(1))
    if not x:
        return F('%s is not legal for them' % m.group(1))
    b.push(x)
    return (T if b.is_checkmate() else F)('%s mates: %s' % (m.group(1), b.is_checkmate()))


def h_mate_on(R, m, text):
    fen = R.pre if 'story' in R.frame else R.st
    b = chk.null(chess.Board(fen))
    sq = chess.parse_square(m.group(1))
    ms = [x for x in chk.mates_in_one(b) if x.to_square == sq]
    return (T if ms else F)('their mates on %s: %s' % (m.group(1), [x.uci() for x in ms]))


def h_watch(R, m, text):
    p = pt(m.group(1))
    b = chess.Board(R.st)
    if p == chess.KING:
        ab = after(R.st, R.played) if R.played else b
        e = ev(ab.fen(), not R.color, DEEP)
        return (T if (e['mate'] or 0) > 0 or chk.mates_in_one(ab) else M)('their mate after the game move: %s' % e['mate'])
    danger = [s for s in pieces_of(b, R.color, p) if chk.in_danger(b, s)]
    if danger:
        return T('in danger now on %s' % [chess.square_name(s) for s in danger])
    if R.played:
        s = chk.settled_delta(R.st, R.color, [R.played], DEEP)
        lost = lost_types(R.st, [R.played] + s['pv'][:(s.get('at') or 10)], R.color)
        return (T if p in lost else M)('the game move line loses %s' % [PNAME[t] for t in lost])
    return M('your %s is not in danger here' % m.group(1))


def lost_types(fen, ucis, color):
    b = chess.Board(fen)
    lost, won = [], []
    for u in ucis:
        try:
            x = chess.Move.from_uci(u)
        except Exception:
            break
        if x not in b.legal_moves:
            break
        v = b.piece_at(x.to_square)
        if b.is_en_passant(x):
            v = chess.Piece(chess.PAWN, not b.turn)
        if v:
            (lost if v.color == color else won).append(v.piece_type)
        b.push(x)
    for w in list(won):
        if w in lost:
            lost.remove(w)
            won.remove(w)
    return lost


def h_no_danger(R, m, text):
    b = chess.Board(R.st)
    danger = [chess.square_name(s) for s, p in b.piece_map().items() if p.color == R.color and p.piece_type != chess.KING and chk.in_danger(b, s)]
    mates = chk.mates_in_one(chk.null(b))
    if danger or mates:
        return F('in danger: %s, their mates: %s' % (danger, [x.uci() for x in mates]))
    # a null-move search: what would they win were it their move?
    e0 = ev(b.fen(), R.color, MID)
    e1 = ev(chk.null(b).fen(), R.color, MID)
    if e0['cp'] - e1['cp'] >= 250 and e1['win'] < e0['win'] - 15:
        return M('no piece hangs, but were it their move they would gain %.1f pawns (%s)' % ((e0['cp'] - e1['cp']) / 100, ' '.join(e1['pv'][:5])))
    return T('nothing in danger; null move %.0f%% vs %.0f%%' % (e1['win'], e0['win']))


def h_stops_mate(R, m, text):
    b0 = chess.Board(R.pre)
    before = chk.mates_in_one(chk.null(b0))
    a = after(R.pre, R.played)
    aft = chk.mates_in_one(a)
    if not before:
        return F('they had no mate in one before the game move')
    if aft:
        return F('the game move does not stop mate')
    if ', allows ' in text:
        x = mv(a, m.group(2))
        if not x:
            return F('%s is not legal after the game move' % m.group(2))
        if not a.is_capture(x):
            return M('%s takes nothing' % m.group(2))
    else:
        p = chk.NAME[m.group(2)]
        if p != chess.KING and not legal_capture(a, None, p, R.color):
            return M('after the game move nothing can take your %s' % m.group(2))
    return T('their mate %s stopped' % [x.uci() for x in before])


def h_lets_win(R, m, text):
    p = pt(m.group(m.lastindex))
    s = chk.settled_delta(R.pre, R.color, [R.played], DEEP)
    lost = lost_types(R.pre, [R.played] + s['pv'][:(s.get('at') or 10) + 2], R.color)
    if p in lost:
        return T('line loses %s (%s)' % ([PNAME[t] for t in lost], ' '.join(s['pv'][:8])))
    return F('the deep line after the game move does not win your %s: loses %s, net %s (%s)' % (m.group(m.lastindex), [PNAME[t] for t in lost], s['delta'], ' '.join(s['pv'][:8])))


def h_mate_one_mine(R, m, text):
    return (T if chk.mates_in_one(chess.Board(R.st)) else F)('')


def h_no_guard(R, m, text):
    fen = R.pre if ('story' in R.frame or 'lesson' in R.frame) else R.st
    if 'lesson' in R.frame:
        fen = R.shown
    b = chess.Board(fen)
    p = pt(m.group(1))
    if m.lastindex >= 2 and m.group(2):
        s = chess.parse_square(m.group(2))
        x = b.piece_at(s)
        if not x or x.piece_type != p or x.color == R.color:
            return F('no %s of theirs on %s' % (m.group(1), m.group(2)))
        g = chk.guards(b, s)
        return (T if not g else F)('guards: %s' % [chess.square_name(q) for q in g])
    cands = [s for s in pieces_of(b, not R.color, p) if not chk.guards(b, s)]
    return (T if cands else F)('unguarded: %s' % [chess.square_name(q) for q in cands])


def h_lets_mate(R, m, text):
    a = after(R.pre, R.played)
    if chk.mates_in_one(a):
        return T('mate in one after the game move')
    e = ev(a.fen(), not R.color, DEEP)
    return (T if (e['mate'] or 0) > 0 else F)('their mate: %s' % e['mate'])


def h_lets_take(R, m, text):
    p = pt(m.group(m.lastindex))
    a = after(R.pre, R.played)
    sqs = [s for s in pieces_of(a, R.color, p) if chk.in_danger(a, s)]
    if sqs:
        return T('in danger after the game move: %s' % [chess.square_name(s) for s in sqs])
    caps = legal_capture(a, None, p, R.color)
    return (M if caps else F)('can be taken (%s) but taking does not pay' % [x.uci() for x in caps] if caps else 'cannot be taken after the game move')


def both_tries(R):
    mm = re.match(r'^two tries: (\S+)', R.frame)
    return [R.played, mm.group(1)] if mm else None


def h_both(R, m, text):
    tr = both_tries(R)
    if not tr:
        return U('tries not known')
    if 'mate' in text:
        res = []
        for t in tr:
            a = after(R.st, t)
            res.append(bool(chk.mates_in_one(a)))
        return (T if all(res) else F)('mate in one after each try: %s' % res)
    p = pt(m.group(m.lastindex))
    res = []
    for t in tr:
        a = after(R.st, t)
        caps = legal_capture(a, None, p, R.color)
        good = [x for x in caps if chk.see_capture(a, x) > 0]
        res.append((t, [x.uci() for x in caps], [x.uci() for x in good]))
    if all(r[1] for r in res):
        if 'lost' in text or 'gave away' in text:
            losses = [chk.settled_delta(R.st, R.color, [t], DEEP)['delta'] for t in tr]
            if not all(d <= -(min(3, VAL[p]) - 1) for d in losses):
                return M('both tries let it be taken, but deep lines net %s' % losses)
        return T(str(res))
    return F(str(res))


def h_runs_into(R, m, text):
    a = after(R.pre, R.played)
    e = ev(a.fen(), not R.color, DEEP)
    r1 = e['pv'][0] if e['pv'] else None
    x = chess.Move.from_uci(r1) if r1 else None
    forcing = x and (a.is_capture(x) or a.gives_check(x))
    wt, wb = two(R.pre, R.played, R.best, R.color)
    if not forcing:
        return M('their best reply %s is no capture or check' % r1)
    return (T if wb - wt >= 8 else M)('reply %s; game move %.0f%%, best %.0f%%' % (r1, wt, wb))


def h_can_win(R, m, text):
    w = m.group(1)
    claimed = piece_val_words(w) if w != 'material' else 1
    return gain_check(R.st, R.color, [], claimed)


def h_checkmate_here(R, m, text):
    e = ev(R.st, R.color, DEEP)
    return (T if (e['mate'] or 0) > 0 else F)('mate: %s (%s)' % (e['mate'], ' '.join(e['pv'][:6])))


def h_two_targets(R, m, text):
    b = chess.Board(R.st)
    e = ev(R.st, R.color, DEEP)
    for i, u in enumerate(e['pv'][:3:2]):
        x = chess.Move.from_uci(u)
        if len(fork_of(b, x, R.color)) >= 2:
            return T('fork with %s' % u)
        b.push(x)
        if i == 0 and len(e['pv']) > 1:
            b.push(chess.Move.from_uci(e['pv'][1]))
    return M('no fork in the best line (%s)' % ' '.join(e['pv'][:6]))


def h_circled(R, m, text):
    due = R.due()
    hs = [x['sq'] for x in rings(R, 'hint')]
    if not due:
        return U('no answer known')
    return (T if due[:2] in hs else F)('ring %s, answer %s' % (hs, due))


def h_safe_square(R, m, text):
    due = R.due()
    b = chess.Board(R.st)
    f = chess.parse_square(due[:2])
    if not chk.in_danger(b, f):
        return M('the circled piece on %s is not in danger' % due[:2])
    a = after(R.st, due)
    t = chess.parse_square(due[2:4])
    return (T if not chk.in_danger(a, t) else F)('after %s the piece is %s' % (due, 'safe' if not chk.in_danger(a, t) else 'in danger'))


def h_red_squares(R, m, text):
    reds = [x['sq'] for x in R.marks.get('tints') or [] if x.get('kind') == 'lose']
    due = R.due()
    if not reds:
        return U('no red squares drawn')
    b = chess.Board(R.st)
    f = chess.parse_square(due[:2])
    p = b.piece_at(f)
    bad = []
    for s in reds:
        t = chess.parse_square(s)
        moves = [x for x in b.legal_moves if x.from_square == f and x.to_square == t]
        if not moves:
            bad.append(s + ' (no legal move)')
            continue
        ok = False
        for x in moves:
            y = b.copy(stack=False)
            took = VAL[y.piece_at(t).piece_type] if y.piece_at(t) else 0
            y.push(x)
            lose = any(chk.see_capture(y, z) > took for z in y.legal_moves if z.to_square == t)
            mate = bool(chk.mates_in_one(y))
            if 'lose your' in text and lose:
                ok = True
            elif 'allow mate' in text and mate:
                ok = True
            elif 'Avoid' in text and (lose or mate):
                ok = True
        if not ok:
            bad.append(s)
    if bad:
        return F('red squares that do not %s: %s' % ('lose the piece' if 'lose' in text else 'allow mate', bad))
    if due[2:4] in reds:
        return F('the answer square is red')
    return T('%d red squares all hold' % len(reds))


def h_forcing_too(R, m, text):
    due = R.due()
    b = chess.Board(R.st)
    x = chess.Move.from_uci(due)
    if b.is_capture(x) or b.gives_check(x):
        return T('the next move %s takes or checks' % due)
    return M('the next move %s neither takes nor checks' % due)


def h_king_in_check(R, m, text):
    b = chess.Board(R.st)
    return (T if b.is_check() and b.turn == R.color else F)('')


def h_ahead(R, m, text):
    e = ev(R.st, R.color, MID)
    return (T if e['win'] >= 60 - TOL else M)('player %.0f%% (the line presumes you are ahead)' % e['win'])


def h_advice(R, m, text):
    return N('advice or a question')


HINT = [
    (r'^Your ' + PIECE + r' is attacked (twice|three times|four times|five times)\.$', h_attacked_n),
    (r'^Their ' + PIECE + r' attacks your ' + PIECE + r'\.$', h_their_attacks),
    (r'^Two of your ' + PIECE + r's are attacked\.$', h_two_attacked),
    (r'^Your ' + PIECE + r's are attacked\.$', h_two_attacked),
    (r'^Your ' + PIECE + r' and ' + PIECE + r' are attacked\.$', h_pair_attacked),
    (r'^Your ' + PIECE + r' is attacked\.$', h_one_attacked),
    (r'^(In check: move, block or take\?|You are in check\.)$', h_in_check),
    (r'^They threaten mate: (.+)\.$', h_threaten_mate),
    (r'^They can mate you on ([a-h][1-8])\.$', h_mate_on),
    (r'^Watch your ' + PIECE + r'\.$', h_watch),
    (r'^No danger here\.$', h_no_danger),
    (r'^(.+) stops mate, allows (.+)\.$', h_stops_mate),
    (r'^(.+) stops mate\. Watch your ' + PIECE + r'\.$', h_stops_mate),
    (r'^(.+) lets them win your ' + PIECE + r'\.$', h_lets_win),
    (r'^(You have a mate in one|You can mate in one)\.$', h_mate_one_mine),
    (r'^Their ' + PIECE + r' on ([a-h][1-8]) has no guard\.$', h_no_guard),
    (r'^Nothing guards their ' + PIECE + r' on ([a-h][1-8])\.$', h_no_guard),
    (r'^Their ' + PIECE + r'() has no guard\.$', h_no_guard),
    (r'^(.+) lets them mate you\.$', h_lets_mate),
    (r'^(.+) lets them take your ' + PIECE + r'\.$', h_lets_take),
    (r'^Both tries (let them take|gave away|lost) your ' + PIECE + r'\.$', h_both),
    (r'^Both tries (allowed|let them mate on) .+\.$', h_both),
    (r'^See what (.+) runs into\.$', h_runs_into),
    (r'^You can win (.+) here\.$', h_can_win),
    (r'^There is a checkmate here\.$', h_checkmate_here),
    (r'^One piece can hit two targets\.$', h_two_targets),
    (r'^Move the circled piece\.$', h_circled),
    (r'^Find a safe square\.$', h_safe_square),
    (r'^Only one ' + PIECE + r' move (holds|is best)\.$', h_only_one),
    (r'^(Red squares lose your ' + PIECE + r'|Red squares allow mate|Avoid the red squares)\.$', h_red_squares),
    (r'^The next move is forcing too\.$', h_forcing_too),
    (r'^Your king is in check\.$', h_king_in_check),
    (r'^Ahead\? .+$', h_ahead),
    (r'^(Their move: .+|Your chances: .+|Before you move: .+|What can they take\?|Can you take or check\?|Improve your worst piece\.|Nothing (forcing|happening|to take)\? .+|Look for checks and captures\.)$', h_advice),
]
