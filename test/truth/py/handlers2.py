"""Handlers for the settled line (R4 and F1.4), See why's captions, the forcing line's words, Details,
game-mode rows, foils, labels, practice and lessons."""
import re
import chess
import chk
import sf
from chk import VAL, NAME, PNAME, parse_move, after, win_pct
from claims import *
from handlers import PIECE, SIDE, piece_val_words, lost_types, h_no_guard, h_threaten_mate, h_mate_on

# ── the settled line ─────────────────────────────────────────────────────────
def best_move_of(R):
    """the move the settled line is about: the card's answer, or for a move that works too, yours"""
    y = R.ctx.get('yours')
    if R.ctx.get('alt') and y:
        sol = R.ctx.get('sol') or []
        for i, m in enumerate(y):
            if not (i < len(sol) and sol[i] == m):
                return after(R.pre, *y[:i]).fen(), m
    return R.pre, R.best


def found_in_game(R):
    """the opponent's real reply after the game move, and Stockfish's best reply there"""
    g = R.game()
    p = R.gply()
    real = R.games.move_at(R.key, p + 1)
    a = after(R.pre, R.played)
    e = ev(a.fen(), not R.color, DEEP)
    return (real.uci() if real else None), (e['pv'][0] if e['pv'] else None), e


def real_loss(R, nply=8):
    """the material the player really lost in the game after the game move (to the next ply of theirs
    flagged as a mistake, at most nply plies)"""
    g = R.game()
    p = R.gply()
    fens, mvs = R.games.pos(R.key)
    later = [b['p'] for b in g.get('bl') or [] if b['p'] > p and not b.get('x')]
    end = min([p + nply] + [q for q in later])
    end = min(end, len(fens) - 1)
    b0 = chess.Board(fens[p])
    b1 = chess.Board(fens[end])
    return chk.mat_diff(b1, R.color) - chk.mat_diff(b0, R.color), end - p


def h_saves(R, m, text):
    bfen, bm = best_move_of(R)
    verb, ps = m.group(2), [m.group(3)] + ([m.group(5)] if m.group(5) else [])
    b0 = chess.Board(R.pre)
    notes = []
    for p in ps:
        t = chk.NAME[p]
        if verb == 'saves':
            danger = [s for s in pieces_of(b0, R.color, t) if chk.in_danger(b0, s)]
            if not danger:
                return F('"saves": no %s of yours was in danger on the card\'s position' % p)
        s = chk.settled_delta(bfen, R.color, [bm], DEEP)
        lost = lost_types(bfen, [bm] + s['pv'][:(s.get('at') or 10) + 2], R.color)
        if t in lost:
            return F('the better line loses the %s too (%s)' % (p, ' '.join(s['pv'][:8])))
        notes.append('%s kept' % p)
    if m.group(6):
        how = m.group(8)
        s2 = chk.settled_delta(R.pre, R.color, [R.played], DEEP)
        lost2 = lost_types(R.pre, [R.played] + s2['pv'][:(s2.get('at') or 10) + 2], R.color)
        miss = [p for p in ps if chk.NAME[p] not in lost2]
        if miss:
            return F('the game move line does not lose %s (%s)' % (miss, ' '.join(s2['pv'][:8])))
        if how == 'lost':
            real, sfr, e = found_in_game(R)
            rl, n = real_loss(R)
            if n >= 4 and rl > -min(VAL[chk.NAME[ps[0]]], 3) + 1:
                return M('"lost it": in the game the player was down only %s after %s plies' % (-rl, n))
    return T('; '.join(notes))


def h_lost_mat(R, m, text):
    how, w = m.group(2), m.group(3)
    claimed = piece_val_words(w)
    v = loss_check(R.pre, R.color, [R.played], claimed)
    if v[0] != 'true':
        return v
    if how == 'lost':
        rl, n = real_loss(R)
        if n >= 4 and claimed and -rl < claimed - 1:
            return M('"lost %s": in the game the player was down %s after %s plies (%s)' % (w, -rl, n, v[1]))
    return v


def h_guarded(R, m, text):
    bfen, bm = best_move_of(R)
    a = after(bfen, bm)
    to = chess.Move.from_uci(bm).to_square
    gd = chk.guards(a, to)
    ga = after(R.pre, R.played)
    gt = chess.Move.from_uci(R.played).to_square
    gg = chk.guards(ga, gt)
    if not gd:
        return F('%s is not guarded after it is played' % m.group(1))
    if gg:
        return M('the game move\'s square was guarded too')
    return h_lost_mat(R, re.match(r'^(.+) (lost|could lose) (.+)\.$', m.group(2) + ' ' + m.group(3) + ' ' + m.group(4) + '.'), text)


def h_wins_then(R, m, text):
    bfen, bm = best_move_of(R)
    claimed = piece_val_words(m.group(2)) if m.group(2) != 'material' else 1
    v = gain_check(bfen, R.color, [bm], claimed)
    if v[0] != 'true' or not m.group(3):
        return v
    rest = m.group(3)
    mm = re.match(r'^(.+) (lost|could lose) (.+)\.$', rest)
    if mm:
        return h_lost_mat(R, mm, rest)
    mm = re.match(r'^(.+) missed it\.$', rest)
    if mm:
        g = chk.settled_delta(R.pre, R.color, [R.played], DEEP)
        return (T if g['delta'] < (claimed or 1) - 0.5 else F)('the game move nets %s (%s)' % (g['delta'], v[1]))
    return v


def h_allowed_mate(R, m, text):
    a = after(R.pre, R.played)
    e = ev(a.fen(), not R.color, DEEP)
    if not ((e['mate'] or 0) > 0 or chk.mates_in_one(a)):
        return F('no forced mate after the game move: their win %.0f%%' % e['win'])
    if m.group(2):
        real = R.games.move_at(R.key, R.gply() + 1)
        y = a.copy()
        if real:
            y.push(real)
            if y.is_checkmate():
                return F('they did mate in the game')
            e2 = ev(y.fen(), not R.color, DEEP)
            if (e2['mate'] or 0) > 0:
                return M('"They missed it", but after their real reply %s they still have mate in %s' % (real.uci(), e2['mate']))
        return T('mate %s; they played %s' % (e['mate'], real.uci() if real else '?'))
    return T('mate %s' % e['mate'])


def h_leads_mate(R, m, text):
    bfen, bm = best_move_of(R)
    a = after(bfen, bm)
    if a.is_checkmate():
        return T('mate')
    e = ev(a.fen(), R.color, DEEP)
    return (T if (e['mate'] or 0) > 0 else F)('mate: %s (%s)' % (e['mate'], ' '.join(e['pv'][:6])))


def h_left(R, m, text):
    band = band_word(m.group(2), R.opp)
    a = after(R.pre, R.played)
    e = ev(a.fen(), R.color, DEEP)
    return band_verdict(e['win'], band, 'after the game move the player has %.0f%% (%s)' % (e['win'], band))


def h_mistake(R, m, text):
    wt, wb = two(R.pre, R.played, R.best, R.color)
    return (T if wb - wt >= 8 else M)('game move %.0f%%, best %.0f%%' % (wt, wb))


def h_guards_two(R, m, text):
    bfen, bm = best_move_of(R)
    a = after(bfen, bm)
    to = chess.Move.from_uci(bm).to_square
    hits = a.attacks(to)
    sq = chess.parse_square(m.group(2))
    ps = [s for s in hits if a.piece_at(s) and a.piece_at(s).color == R.color and a.piece_at(s).piece_type == chk.NAME[m.group(3)]]
    return (T if sq in hits and ps else F)('the moved piece covers %s: %s, your %s: %s' % (m.group(2), sq in hits, m.group(3), [chess.square_name(s) for s in ps]))


def h_figures_only(R, m, text):
    kind, mvs, x, y = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
    r = sf.go(R.pre, DEEP, 2)
    b = chess.Board(R.pre)
    flip = R.color != b.turn
    ws = [win_pct(chk.line_score(l, flip)) for l in r['lines']]
    if len(ws) < 2:
        return U('one legal move')
    bm = parse_move(b, mvs)
    best_u = r['lines'][0]['pv'][0]
    note = 'deep: %s %.0f%%, next %s %.0f%%' % (best_u, ws[0], r['lines'][1]['pv'][0], ws[1])
    if bm and bm.uci() != best_u:
        # the card's move is not Stockfish's first: score it apart
        wt, wo = two(R.pre, bm.uci(), best_u, R.color)
        note += '; %s %.0f%%' % (mvs, wt)
        ws = [wt, max(wo, ws[1]) if wo > wt else ws[1]]
    if abs(ws[0] - x) > 8 or abs(ws[1] - y) > 10:
        return M('figures off: ' + note)
    # v2 slice 1 (V1.4): "Only move" when the next best is 10 or more points worse, a step lower on the
    # card's scale (20/40/60/80), and either at 40% or less or the best at 80% or more (the 25% rule
    # went); engine noise allowed at each edge
    step = lambda w: 4 if w >= 80 else 3 if w >= 60 else 2 if w >= 40 else 1 if w >= 20 else 0
    if kind == 'Only move' and not (ws[0] - ws[1] >= 10 - 3 and step(ws[1] - TOL) < step(ws[0] + TOL) and (ws[1] <= 40 + TOL or ws[0] >= 80 - TOL)):
        return F('"Only move" but the next best keeps %.0f%%: %s' % (ws[1], note))
    return T(note)


def h_figures_pair(R, m, text):
    bs, x, gs, y = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
    wt, wb = two(R.pre, R.played, R.best, R.color)
    note = 'deep: best %.0f%%, game move %.0f%%' % (wb, wt)
    if abs(wb - x) > 8 or abs(wt - y) > 8:
        return M('figures off: ' + note)
    return T(note)


SETTLED = [
    (r'^(.+) (saves|keeps) your ' + PIECE + r'( and ' + PIECE + r')?\.( (.+) (lost|could lose) (it|them)\.)?$', h_saves),
    (r'^(.+) is guarded\. (.+) (lost|could lose) (.+)\.$', h_guarded),
    (r'^(.+) wins (.+?)\.(?: (.+))?$', h_wins_then),
    (r'^(.+) allowed checkmate\.( They missed it\.)?$', h_allowed_mate),
    (r'^(.+) leads to checkmate\.$', h_leads_mate),
    (r'^(?:In your game, )?(.+) left (you still better|the game even|White better|Black better|White winning|Black winning)\.$', h_left),
    (r'^(.+) was a mistake\.$', h_mistake),
    (r'^(.+) guards ([a-h][1-8]) and your ' + PIECE + r'\.$', h_guards_two),
    (r'^(Only move|Best): (\S+) (\d+)%\. Next best (\d+)%\.$', h_figures_only),
    (r'^(\S+) (\d+)%\. Your (\S+) (\d+)%\.$', h_figures_pair),
    (r'^(.+) (lost|could lose) (.+)\.$', h_lost_mat),
]


# ── See why's captions ──────────────────────────────────────────────────────
def step_boards(R):
    s = R.step or {}
    return chess.Board(s['before']) if s.get('before') else None, chess.Move.from_uci(s['move']) if s.get('move') and s['move'] != '0000' else None, chess.Board(s['after']) if s.get('after') else None


def line_net(R, upto_k):
    """the material the player gained (+) or lost (-) along the step's own line, from its first node's
    position to after node upto_k"""
    s = R.step
    ln = s['line']
    b = chess.Board(ln['start'])
    base = chk.mat_diff(b, R.color)
    for i, u in enumerate(ln['moves'][:upto_k + 1]):
        if u == '0000':
            b.push(chess.Move.null())
        else:
            b.push(chess.Move.from_uci(u))
    return chk.mat_diff(b, R.color) - base, b


def ply_claim(R, text):
    """a ply's own words, read on its board: takes your X / takes their X / with check / check / mate /
    who plays it"""
    b, x, a = step_boards(R)
    if not x:
        return U('no move')
    mover = b.piece_at(x.from_square)
    victim = b.piece_at(x.to_square) or (chess.Piece(chess.PAWN, not mover.color) if b.is_en_passant(x) else None)
    errs = []
    mt = re.search(r'takes (your|their) ' + PIECE, text)
    if mt:
        want_color = R.color if mt.group(1) == 'your' else (not R.color)
        if not victim or victim.color != want_color or victim.piece_type != chk.NAME[mt.group(2)]:
            errs.append('does not take %s %s (takes %s)' % (mt.group(1), mt.group(2), victim and PNAME[victim.piece_type]))
    if re.search(r'with check|, check\.', text) and not a.is_check():
        errs.append('gives no check')
    if 'Checkmate' in text and not a.is_checkmate():
        errs.append('is not mate')
    mw = re.match(r'^(They|You) play ', text)
    if mw:
        mine = mover.color == R.color
        if (mw.group(1) == 'You') != mine:
            errs.append('says %s play it, but %s moves' % (mw.group(1), 'you' if mine else 'they'))
    mp = re.match(r'^(Their|Your) ' + PIECE + r' takes', text)
    if mp:
        if (mp.group(1) == 'Your') != (mover.color == R.color) or mover.piece_type != chk.NAME[mp.group(2)]:
            errs.append('the mover is not %s %s' % (mp.group(1).lower(), mp.group(2)))
    mp2 = re.match(r'^' + PIECE.replace('(', '(?i:') + r' takes', text)
    return errs


def as_in_game(R):
    s = R.step
    real = R.games.move_at(R.key, R.gply() + s['k'])
    return real and real.uci() == s['move'], real


def h_story(R, m, text):
    s = R.step or {}
    if not s or s.get('err'):
        return U('no step')
    seg, k = s['seg'], s['k']
    notes = []
    b, x, a = step_boards(R)
    # the danger frame (F1.5)
    if seg == 'danger':
        return danger_cap(R, text)
    if seg == 'game' and k == 0:
        return g1_cap(R, text)
    errs = ply_claim(R, text)
    if errs:
        return F('; '.join(errs))
    if re.search(r'[Aa]s in your game', text):
        ok, real = as_in_game(R)
        if not ok:
            return F('"as in your game": the game had %s here' % (real.uci() if real else 'nothing'))
        notes.append('as in the game')
    if 'They missed it' in text or re.search(r'could (take|give)|would be checkmate|They could play', text):
        ok, real = as_in_game(R)
        if ok:
            return F('they did play it')
        if real:
            # was it a real blow? their move against what they played, from their side
            wt, wb = two(s['before'], s['move'], real.uci(), not R.color)
            notes.append('their %s %.0f%% vs real %s %.0f%%' % (s['move'], wt, real.uci(), wb))
            if wt - wb < 5:
                return M('"They missed it", but what they played was about as good: ' + '; '.join(notes))
    ml = re.search(r'You (lose|win) (.+?)\.$', text)
    if ml:
        claimed = piece_val_words(ml.group(2)) if ml.group(2) != 'material' else None
        net, bb = line_net(R, k)
        if s['seg'] == 'better':
            net0, _ = line_net(R, s['from'] - 1) if s['from'] > 1 else (0, None)
            net = net - net0
        got = -net if ml.group(1) == 'lose' else net
        if claimed is not None and abs(got - claimed) > 0.5:
            return F('the line shown nets %s, the caption says %s %s' % (net, ml.group(1), ml.group(2)))
        if claimed is None and got < 1:
            return F('nothing %s on the line shown' % ml.group(1))
        # does it stand? Stockfish from this board
        st = chk.settled_delta(bb.fen(), R.color, [], DEEP)
        if (ml.group(1) == 'lose' and st['delta'] >= 2) or (ml.group(1) == 'win' and st['delta'] <= -2):
            return M('the count does not stand: from here the player %s %s more (%s)' % ('wins back' if ml.group(1) == 'lose' else 'gives back', abs(st['delta']), ' '.join(st['pv'][:6])))
        notes.append('net %s' % net)
    if 'Nothing is lost' in text:
        net, bb = line_net(R, k)
        if s['seg'] == 'better' and s['from'] > 1:
            net -= line_net(R, s['from'] - 1)[0]
        if net < 0:
            return F('the line shown loses %s' % -net)
        st = chk.settled_delta(bb.fen(), R.color, [], DEEP)
        if st['delta'] <= -2:
            return M('nothing lost yet, but from here the player loses %s (%s)' % (-st['delta'], ' '.join(st['pv'][:6])))
        notes.append('net %s' % net)
    if 'You lose less' in text:
        notes.append('(less: not checked)')
    msafe = re.search(r'Your ' + PIECE + r' is safe( there)?\.$', text)
    if msafe:
        t = chk.NAME[msafe.group(1)]
        bad = [chess.square_name(q) for q in pieces_of(a, R.color, t) if chk.in_danger(a, q)]
        if bad and not (a.turn == R.color):
            return F('your %s is in danger on %s' % (msafe.group(1), bad))
        if bad:
            return M('your %s on %s can be taken were it their move' % (msafe.group(1), bad))
        notes.append('safe')
    if re.match(r'^Better: ', text):
        return better_cap(R, text, notes)
    if re.match(r'^Your .+ works too\.$', text):
        return works_too_cap(R, text)
    if re.search(r'still (comes|takes)', text):
        notes.append('(S-same)')
    mo = re.match(r'^(Only move|Best): (\S+) (\d+)%\. Next best (\d+)%\.$', text)
    if mo:
        return h_figures_only(R, mo, text)
    return T('; '.join(notes))


def g1_cap(R, text):
    b, x, a = step_boards(R)       # a: after the game move
    mg = re.match(r'^(.+), your game move\.$', text)
    if mg:
        # the caption names the game move: the move named, on the board before it, is the game move
        y = parse_move(b, mg.group(1)) if b else None
        return (T if y and R.played and y.uci() == R.played else F)('"%s" on the board before it, the game move %s' % (mg.group(1), R.played))
    mm = re.search(r'Nothing guards the ' + PIECE + r' on ([a-h][1-8])\.$', text)
    if mm:
        s = chess.parse_square(mm.group(2))
        p = a.piece_at(s)
        if not p or p.color != R.color or p.piece_type != chk.NAME[mm.group(1)]:
            return F('no %s of yours on %s' % (mm.group(1), mm.group(2)))
        g = chk.guards(a, s)
        return (T if not g else F)('guards of %s: %s' % (mm.group(2), [chess.square_name(q) for q in g]))
    mm = re.search(r'Their ' + PIECE + r' can take your ' + PIECE + r'\.$', text)
    if mm:
        caps = legal_capture(a, chk.NAME[mm.group(1)], chk.NAME[mm.group(2)], R.color)
        return (T if caps else F)('captures: %s' % [c.uci() for c in caps])
    mm = re.search(r'Now (.+) hits two pieces\.$', text)
    if mm:
        y = a.copy()
        z = parse_move(y, mm.group(1))
        if not z:
            return F('%s is not legal there' % mm.group(1))
        fk = fork_of(y, z, not R.color)
        return (T if len(fk) >= 2 else F)('it hits %s' % [chess.square_name(q) for q in fk])
    mm = re.search(r'Now ' + SIDE + r' can checkmate\.$', text)
    if mm:
        if mm.group(1) != R.opp:
            return F('wrong side')
        e = ev(a.fen(), not R.color, DEEP)
        return (T if (e['mate'] or 0) > 0 or chk.mates_in_one(a) else F)('their mate: %s' % e['mate'])
    mm = re.search(r'Now (.+) is check\.$', text)
    if mm:
        y = a.copy()
        z = parse_move(y, mm.group(1))
        if not z:
            return F('%s is not legal there' % mm.group(1))
        return (T if y.gives_check(z) else F)('')
    mm = re.search(r'Your ' + PIECE + r' can\'t move safely\.$', text)
    if mm:
        t = chk.NAME[mm.group(1)]
        pins = [chess.square_name(q) for q in pieces_of(a, R.color, t) if pinned_relative(a, q)]
        return (T if pins else F)('pinned: %s' % pins)
    if 'Moving one piece opens a line' in text:
        return U('a discovered attack: not checked')
    mm = re.search(r'Your ' + PIECE + r' is still attacked( (twice|three times))?\.$', text)
    if mm:
        t = chk.NAME[mm.group(1)]
        b0 = chess.Board(R.pre)
        # a try that gave check: they cannot take it this move, but it stays attacked whatever they answer
        n_of = lambda q: len(chk.attackers_legal(a, q)) or len(a.attackers(not R.color, q))
        hits = [q for q in pieces_of(a, R.color, t) if b0.piece_at(q) == a.piece_at(q) and (chk.attackers_legal(a, q) or chk.attacked_past_check(a, q))]
        if not hits:
            return F('no %s of yours still attacked' % mm.group(1))
        if mm.group(3):
            n = times(mm.group(3))
            if not any(n_of(q) == n for q in hits):
                return F('attacked %s times, not %s' % ([n_of(q) for q in hits], n))
        return T('attacked on %s' % [chess.square_name(q) for q in hits])
    mm = re.search(SIDE + r' has no move: a draw\.$', text)
    if mm:
        return (T if a.is_stalemate() else F)('')
    return U('G1 form not read: ' + text)


def danger_cap(R, text):
    b = chess.Board(R.pre)
    fx = R.r.get('step', {}).get('df')
    mm = re.match(r'^After (\S+): (.+)\.$', text)
    notes = []
    body = text
    if mm:
        g = R.game()
        p = R.gply()
        last = R.games.move_at(R.key, p - 1)
        bb = chess.Board(R.games.fen_at(R.key, p - 1))
        if not last or bb.san(last).rstrip('+#') != mm.group(1):
            return F('their last move was %s, not %s' % (bb.san(last) if last else '?', mm.group(1)))
        body = mm.group(2)
    # "queen attacked twice, bishop once" / "their rook attacks your knight"
    parts = re.findall(PIECE + r' attacked (once|twice|three times|four times)', body)
    if parts:
        rg = [x['sq'] for x in rings(R, 'attacked')]
        for pw, tw in parts:
            n = times(tw)
            sqs = [chess.parse_square(s) for s in rg if b.piece_at(chess.parse_square(s)) and b.piece_at(chess.parse_square(s)).piece_type == chk.NAME[pw]] or pieces_of(b, R.color, chk.NAME[pw])
            if not any(attacked_count(b, q) == n for q in sqs):
                return F('%s attacked %s times, not %s' % (pw, [attacked_count(b, q) for q in sqs], n))
        return T('counts hold')
    mt = re.search(r'(?:[Tt]heir|their) ' + PIECE + r' attacks your ' + PIECE, body)
    if mt:
        for q in pieces_of(b, R.color, chk.NAME[mt.group(2)]):
            for f in chk.attackers_legal(b, q):
                if b.piece_at(f).piece_type == chk.NAME[mt.group(1)]:
                    return T('')
        return F('no %s of theirs attacks your %s' % (mt.group(1), mt.group(2)))
    ml = re.match(r'^Their last move attacks your ' + PIECE + r'( (twice|three times))?\.$', text)
    if ml:
        p = R.gply()
        last = R.games.move_at(R.key, p - 1)
        hits = [q for q in pieces_of(b, R.color, chk.NAME[ml.group(1)]) if chk.attackers_legal(b, q)]
        if not hits:
            return F('your %s is not attacked' % ml.group(1))
        made = [q for q in hits if any(f == last.to_square or (chess.BB_SQUARES[last.from_square] & chess.between(f, q)) for f in chk.attackers_legal(b, q))]
        if not made:
            return F('their last move did not make the attack')
        if ml.group(3) and not any(attacked_count(b, q) == times(ml.group(3)) for q in made):
            return F('count differs')
        return T('')
    mm2 = re.match(r'^Your ' + PIECE + r' is attacked (once|twice|three times), your ' + PIECE + r' (once|twice|three times)\.$', text)
    if mm2:
        for pw, tw in ((mm2.group(1), mm2.group(2)), (mm2.group(3), mm2.group(4))):
            if not any(attacked_count(b, q) == times(tw) for q in pieces_of(b, R.color, chk.NAME[pw])):
                return F('%s not attacked %s' % (pw, tw))
        return T('')
    if re.match(r'^They threaten mate: ', text):
        return h_threaten_mate(R, re.match(r'^They threaten mate: (.+)\.$', text), text)
    if re.match(r'^They can mate you on ', text):
        return h_mate_on(R, re.match(r'^They can mate you on ([a-h][1-8])\.$', text), text)
    mb = re.match(r'^Your ' + PIECE + r' on ([a-h][1-8]) blocks their mate\.$', text)
    if mb:
        s = chess.parse_square(mb.group(2))
        x = chk.null(b)
        if chk.mates_in_one(x):
            return M('they already have a mate in one with it there')
        x.remove_piece_at(s)
        return (T if chk.mates_in_one(x) else F)('with it gone their mates: %s' % [y.uci() for y in chk.mates_in_one(x)])
    mn = re.match(r'^Their ' + PIECE + r' on ([a-h][1-8]) has no guard\.$', text)
    if mn:
        return h_no_guard(R, mn, text)
    m2 = re.match(r'^Two threats: (.+) mate and (.+)\.$', text)
    if m2:
        x = chk.null(b)
        y = parse_move(x, m2.group(1))
        if not y:
            return F('%s not legal' % m2.group(1))
        z = x.copy()
        z.push(y)
        if not z.is_checkmate():
            return F('%s is not mate' % m2.group(1))
        w = parse_move(x, m2.group(2))
        if not w or not x.is_capture(w):
            return F('%s is no capture for them' % m2.group(2))
        return T('')
    m3 = re.match(r'^Two threats: mate on ([a-h][1-8]) and your ' + PIECE + r'\.$', text)
    if m3:
        x = chk.null(b)
        if not [y for y in chk.mates_in_one(x) if chess.square_name(y.to_square) == m3.group(1)]:
            return F('no mate on %s' % m3.group(1))
        return T('')
    if re.match(r'^(Two of your|Your \w+ and \w+ are attacked)', text):
        return T('(pair attack: not counted)')
    return U('danger caption not read: ' + text)


def better_cap(R, text, notes):
    s = R.step
    b, x, a = step_boards(R)
    mg = re.search(r'The ' + PIECE + r' on ([a-h][1-8]) guards it\.$', text)
    if mg:
        q = chess.parse_square(mg.group(2))
        if q not in a.attackers(R.color, x.to_square) or not a.piece_at(q) or a.piece_at(q).piece_type != chk.NAME[mg.group(1)]:
            return F('the %s on %s does not guard %s' % (mg.group(1), mg.group(2), chess.square_name(x.to_square)))
        return T('guarded')
    mw = re.search(r'It wins (.+?)( on ([a-h][1-8]))?\.$', text)
    if mw:
        claimed = piece_val_words(mw.group(1)) if mw.group(1) != 'material' else 1
        v = gain_check(s['before'], R.color, [s['move']], claimed)
        return v
    if 'It leads to checkmate' in text:
        e = ev(a.fen(), R.color, DEEP)
        return (T if a.is_checkmate() or (e['mate'] or 0) > 0 else F)('mate %s' % e['mate'])
    ms = re.search(r'(saves|keeps) your ' + PIECE + r'\.$', text)
    if ms:
        t = chk.NAME[ms.group(2)]
        b0 = chess.Board(R.pre)
        if ms.group(1) == 'saves' and not [q for q in pieces_of(b0, R.color, t) if chk.in_danger(b0, q)]:
            return F('"saves": your %s was not in danger' % ms.group(2))
        st = chk.settled_delta(s['before'], R.color, [s['move']], DEEP)
        lost = lost_types(s['before'], [s['move']] + st['pv'][:(st.get('at') or 10) + 2], R.color)
        return (F if t in lost else T)('better line loses %s' % [PNAME[q] for q in lost])
    return T('; '.join(notes) or 'move only')


def works_too_cap(R, text):
    s = R.step
    y = R.ctx.get('yours') or []
    due = R.best if s['from'] <= 1 else (R.ctx.get('sol') or [R.best])[s['from'] - 1]
    # release 2's C5 (a)
    if s['move'] != due:
        up, why = ranks_above(s['before'], s['move'], due, R.color)
        if up:
            return F('"works too" for a move that ranks above the main move: ' + why)
    wt, wb = two(s['before'], s['move'], due, R.color)
    # v1: a safe win's 70% edge with the methodology's band-edge noise (TOL)
    return (T if wb - wt <= 6 or (wt >= 70 - TOL and wb >= 70 - TOL) else M)('yours %.0f%%, the answer %.0f%%' % (wt, wb))


STORY = [(r'^.+$', h_story)]


# ── forcing line words, guesses ─────────────────────────────────────────────
def reply_ctx(R):
    sol, i = R.ctx.get('sol') or [], R.ctx.get('solIdx') or 0
    if not sol or i < 2:
        return None
    before = after(R.pre, *sol[:i - 1])
    return before, chess.Move.from_uci(sol[i - 1])


def h_reply_words(R, m, text):
    c = reply_ctx(R)
    if not c:
        return U('no reply')
    b, x = c
    if m.group(1) != R.opp:
        return F('wrong side')
    if 'took your' in text:
        v = b.piece_at(x.to_square) or (chess.Piece(chess.PAWN, R.color) if b.is_en_passant(x) else None)
        p = re.search(r'took your ' + PIECE, text).group(1)
        return (T if v and v.color == R.color and v.piece_type == chk.NAME[p] else F)('took %s' % (v and PNAME[v.piece_type]))
    if 'gives check' in text:
        return (T if b.gives_check(x) else F)('')
    mp = re.search(r'played (.+?)(, as expected)?\.$', text)
    if mp:
        y = parse_move(b, mp.group(1))
        return (T if y == x else F)('reply %s' % x.uci())
    return U('')


def h_guess(R, m, text):
    sol = R.ctx.get('sol') or []
    if len(sol) < 2:
        return U('no line')
    b = after(R.pre, sol[0])
    y = sol[1]
    g = (R.ctx.get('guess') or {}).get('uci')
    if text.startswith('You saw it'):
        return (T if g == y else F)('guess %s, reply %s' % (g, y))
    if text.startswith('They had'):
        z = parse_move(b, text[9:-1])
        return (T if z and z.uci() == y else F)('')
    if not g:
        return U('no guess kept')
    r = sf.go(b.fen(), DEEP, 2, [g, y]) if g != y else None
    lg = ly = None
    for l in (r or {}).get('lines', []):
        if l['pv'] and l['pv'][0] == g:
            lg = l
        elif l['pv'] and l['pv'][0] == y:
            ly = l
    if lg and ly and lg['mate'] is not None and ly['mate'] is not None:
        # both lines mate: the longer defence (or the quicker mate of theirs) is the better
        note = 'their %s mate %s, %s mate %s (their side, to move)' % (g, lg['mate'], y, ly['mate'])
        better_y = (ly['mate'] < 0 and lg['mate'] < 0 and ly['mate'] < lg['mate']) or (ly['mate'] > 0 > lg['mate'])
        if ' was as good as ' in text:
            return (F if better_y and abs(ly['mate'] - lg['mate']) >= 1 else T)(note)
        if text.startswith('Not '):
            return (T if better_y or (ly['mate'] > 0 and lg['mate'] > ly['mate']) else M)(note)
    wg, wy = two(b.fen(), g, y, not R.color)
    note = 'their %s %.0f%%, %s %.0f%% (from their side)' % (g, wg, y, wy)
    if ' was as good as ' in text:
        return (T if wg >= wy - 4 - 2 else F)(note)
    if text.startswith('Not '):
        return (T if wg < wy - 4 + 2 else M)(note)
    return U('')


def h_best_reply_q(R, m, text):
    sol = R.ctx.get('sol') or []
    if len(sol) < 2:
        return U('')
    b = after(R.pre, sol[0])
    e = ev(b.fen(), not R.color, DEEP)
    if e['pv'] and e['pv'][0] == sol[1]:
        return T('their best is %s' % sol[1])
    wy, wb = two(b.fen(), sol[1], e['pv'][0], not R.color)
    return (T if wy >= wb - 4 else M)('the line\'s reply %s %.0f%%, their best %s %.0f%%' % (sol[1], wy, e['pv'][0], wb))


FORCING = [
    (r'^' + SIDE + r' (took your \w+|gives check|played .+?)(, as expected)?\.$', h_reply_words),
    (r'^(You saw it: .+|.+ was as good as .+|Not .+: they had .+|They had .+)\.$', h_guess),
    (r'^Now their best reply\?$', h_best_reply_q),
    (r'^(White|Black) replies next\.$', lambda R, m, t: (T if m.group(1) == R.opp else F)('the reply is %s\'s' % R.opp)),
]
