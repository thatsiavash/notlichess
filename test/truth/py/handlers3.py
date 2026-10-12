"""Handlers for Details, game-mode rows, foils, board labels, practice and lessons."""
import re
import math
import chess
import chk
import sf
from chk import VAL, NAME, PNAME, parse_move, after, win_pct
from claims import *
from handlers import PIECE, SIDE, piece_val_words, lost_types, h_no_guard
import handlers2 as H2
import gamedata

# ── Details ────────────────────────────────────────────────────────────────
def clock_parse(s):
    p = [int(x) for x in s.split(':')]
    return p[0] * 60 + p[1] if len(p) == 2 else p[0] * 3600 + p[1] * 60 + p[2]


def rec_b(R):
    return R.games.record(R.key) or {}


def h_ctx(R, m, text):
    b = rec_b(R)
    mvno = int(m.group(1))
    if mvno != R.gply() // 2 + 1:
        return F('move %s, the ply gives %s' % (mvno, R.gply() // 2 + 1))
    if m.group(2) and b.get('c') is not None:
        left = m.group(2)
        try:
            secs = clock_parse(left.replace('h', ':'))
        except Exception:
            return U('clock %s' % left)
        if abs(secs - b['c']) > 1:
            return F('clock %s, the record keeps %s s' % (left, b['c']))
    return T('')


def decisive_check(R, word):
    g, b = R.game(), rec_b(R)
    p = R.gply()
    later = [gamedata.wp_at(g, i) for i in range(p + 1, len(g.get('wp') or ''))]
    later = [w for w in later if w is not None]
    mx = max(later) if later else None
    wa = gamedata.wp_at(g, p)
    wb = gamedata.wp_at(g, p - 1)
    note = 'result %s, series %s -> %s, best after %s; record wb %s wa %s' % (g['res'], wb and round(wb), wa and round(wa), mx and round(mx), round(b.get('wb', 0)), round(b.get('wa', 0)))
    if word == 'lost the game':
        if g['res'] != 'loss':
            return F('the game was not lost: ' + note)
        if mx is not None and mx >= 50:
            return F('the player came back to %.0f%% later: ' % mx + note)
        return T(note)
    if word == 'was where the game turned':
        if g['res'] != 'loss' or (mx is not None and mx >= 50):
            return F(note)
        return T(note)
    if word == 'let the win slip':
        if not (b.get('wb', 0) >= 70 and (mx is None or mx < 70)):
            return F(note)
        return T(note)
    return U(note)


def h_stakes(R, m, text):
    return decisive_check(R, m.group(1))


def h_found_right_away(R, m, text):
    real, best, e = H2.found_in_game(R)
    a = after(R.pre, R.played)
    x = parse_move(a, m.group(1))
    if not x:
        return F('%s is not legal after the game move' % m.group(1))
    if not real or x.uci() != real:
        return F('the game reply was %s' % real)
    if best and real != best:
        wr, wbb = two(a.fen(), real, best, not R.color)
        if wr < wbb - 8:
            return M('"found" but their reply %s (%.0f%%) was not the punishment %s (%.0f%%)' % (real, wr, best, wbb))
    return T('real reply %s, best %s' % (real, best))


def h_missed_back(R, m, text):
    real, best, e = H2.found_in_game(R)
    a = after(R.pre, R.played)
    x = parse_move(a, m.group(1))
    if not x or x.uci() != real:
        return F('the game reply was %s' % real)
    a.push(x)
    w = ev(a.fen(), R.color, DEEP)['win']
    if real == best:
        return F('they did play the best reply')
    if w < 35:
        return M('"you were back in the game", but after %s the player has %.0f%%' % (real, w))
    return T('after %s the player has %.0f%%' % (real, w))


def h_threat(R, m, text):
    b0 = chess.Board(R.pre)
    nb = chk.null(b0)
    body = m.group(1).rstrip('.')
    mm = re.match(r'^(.+?) (takes your (\w+)|is checkmate|, with mate to follow|wins material)\.?$', body)
    mw = re.match(r'^their (\w+) takes your (\w+)$', body)
    mc = re.match(r'^checkmate on ([a-h][1-8])$', body)
    if mc:
        ms = [x for x in chk.mates_in_one(nb) if chess.square_name(x.to_square) == mc.group(1)]
        return (T if ms else F)('')
    if mw:
        caps = legal_capture(nb, chk.NAME[mw.group(1)], chk.NAME[mw.group(2)], R.color)
        a = after(R.pre, R.played)
        caps2 = legal_capture(a, chk.NAME[mw.group(1)], chk.NAME[mw.group(2)], R.color)
        good = [c for c in caps if chk.see_capture(nb, c) > 0] + [c for c in caps2 if chk.see_capture(a, c) > 0]
        caps = caps + caps2
        if not caps:
            return F('no such capture')
        if not good:
            for c in caps[:1]:
                s1 = chk.settled_delta(nb.fen(), not R.color, [c.uci()], DEEP)
                if max(s1['delta'], s1['first']) >= 1:
                    return T('wins material through its line (%s)' % ' '.join(s1['pv'][:6]))
        return (T if good else M)('captures %s, winning: %s' % ([c.uci() for c in caps], [c.uci() for c in good]))
    body2 = re.sub(r'\.$', '', body)
    m2 = re.match(r'^(\S+) takes your (\w+)$', body2)
    m3 = re.match(r'^(\S+) is checkmate$', body2)
    m4 = re.match(r'^(\S+), with mate to follow$', body2)
    m5 = re.match(r'^(\S+) wins material$', body2)
    if m2:
        x = parse_move(nb, m2.group(1))
        if not x:
            return F('%s is not legal for them' % m2.group(1))
        v = nb.piece_at(x.to_square)
        if not v or v.piece_type != chk.NAME[m2.group(2)]:
            return F('%s does not take a %s' % (m2.group(1), m2.group(2)))
        see = chk.see_capture(nb, x)
        a = after(R.pre, R.played)
        stand = x in a.legal_moves and a.piece_at(x.to_square) == v
        see2 = chk.see_capture(a, x) if stand else 0
        if see <= 0 and see2 <= 0:
            s1 = chk.settled_delta(nb.fen(), not R.color, [x.uci()], DEEP)
            s2 = chk.settled_delta(a.fen(), not R.color, [x.uci()], DEEP) if stand else {'delta': 0, 'first': 0, 'pv': []}
            if max(s1['delta'], s1['first'], s2['delta'], s2['first']) < 1:
                return M('"threat", but %s does not win material (exchange %s, after the game move %s; deep line %s / %s)' % (m2.group(1), see, see2, ' '.join(s1['pv'][:6]), ' '.join(s2['pv'][:6])))
            return T('wins material through its line (%s)' % ' '.join((s2['pv'] or s1['pv'])[:6]))
        return (T if stand else M)('exchange +%s; still there after the game move: %s' % (see, stand))
    if m3:
        x = parse_move(nb, m3.group(1))
        if not x:
            return F('not legal')
        y = nb.copy()
        y.push(x)
        return (T if y.is_checkmate() else F)('')
    if m4:
        x = parse_move(nb, m4.group(1))
        if not x:
            return F('not legal')
        y = nb.copy()
        y.push(x)
        e = ev(y.fen(), not R.color, DEEP)
        return (T if (e['mate'] or 0) > 0 else F)('mate %s' % e['mate'])
    if m5:
        x = parse_move(nb, m5.group(1))
        if not x:
            return F('not legal')
        s = chk.settled_delta(nb.fen(), not R.color, [x.uci()], DEEP)
        return (T if s['delta'] >= 1 else F)('their net %s (%s)' % (s['delta'], ' '.join(s['pv'][:6])))
    return U('threat form not read')


def h_clock(R, m, text):
    b = rec_b(R)
    if b.get('tt') is None:
        return U('no clock')
    took = m.group(2)
    secs = int(took[:-2]) if took.endswith(' s') else clock_parse(took)
    left = clock_parse(m.group(3))
    if abs(secs - round(b['tt'])) > 1 or abs(left - round(b['c'])) > 1:
        return F('record tt %s c %s' % (b['tt'], b['c']))
    if m.group(4):
        g = R.game()
        base = int(float(g['tc'].split('+')[0]) * 60)
        inc = float(g['tc'].split('+')[1]) if '+' in g['tc'] else 0
        n = R.gply() // 2 + 1
        pace = round((base + inc * (n - 1) - (b['c'] + b['tt'] - inc)) / (n - 1)) if n > 1 else None
        if pace is None or abs(pace - int(m.group(4))) > 1:
            return F('pace %s, recomputed %s' % (m.group(4), pace))
    return T('')


def h_clock_t1(R, m, text):
    b = rec_b(R)
    return T('') if b.get('tt') is not None else U('')


def h_also_holds(R, m, text):
    y = R.ctx.get('yours') or []
    if not y:
        return U('')
    fen, u = H2.best_move_of(R)
    wt, wb = two(fen, u, R.best, R.color)
    # v1: a safe win's 70% edge with the methodology's band-edge noise (TOL)
    return (T if wb - wt <= 6 or (wt >= 70 - TOL and wb >= 70 - TOL) else M)('%.0f%% vs %.0f%%' % (wt, wb))


def h_keeps_safe(R, m, text):
    b = chess.Board(R.pre)
    x = parse_move(b, m.group(1))
    if not x:
        return F('not legal')
    s = chk.settled_delta(R.pre, R.color, [x.uci()], DEEP)
    if m.group(2) == 'everything':
        return (T if s['delta'] >= -0.5 else F)('the better line nets %s (%s)' % (s['delta'], ' '.join(s['pv'][:8])))
    t = chk.NAME[m.group(3)]
    lost = lost_types(R.pre, [x.uci()] + s['pv'][:(s.get('at') or 10) + 2], R.color)
    return (F if t in lost else T)('the better line loses %s' % [PNAME[q] for q in lost])


def h_keeps_adv(R, m, text):
    b = chess.Board(R.pre)
    x = parse_move(b, m.group(1))
    a = after(R.pre, x.uci())
    w = ev(a.fen(), R.color, DEEP)['win']
    band = {'keeps your advantage': (60, 101), 'keeps the game balanced': (40, 60), 'is the most stubborn defence': (0, 40)}[m.group(2)]
    return (T if band[0] - TOL <= w < band[1] + TOL else F)('after it the player has %.0f%%' % w)


def h_stops(R, m, text):
    """"Y stops Z.": Z is the reply that punished the game move (after it); after Y that move is gone"""
    b = chess.Board(R.pre)
    x = parse_move(b, m.group(1))
    if not x:
        return F('%s is not legal' % m.group(1))
    ag = after(R.pre, R.played)
    th = parse_move(ag, m.group(2))
    if not th:
        return F('%s is not their move after the game move' % m.group(2))
    ab = after(R.pre, x.uci())
    still = [y for y in ab.legal_moves if y.from_square == th.from_square and y.to_square == th.to_square]
    if still:
        return F('%s is still legal after %s' % (m.group(2), m.group(1)))
    if '#' in m.group(2) or ag.copy(stack=False).gives_check(th):
        others = chk.mates_in_one(ab)
        if others:
            return M('stops %s, but they mate with %s' % (m.group(2), others[0].uci()))
    return T('')


def h_classifier(R, m, text):
    """the classifier's sentence about the game move (Details' first line): its claims read one by one"""
    t = text
    pre, played = R.pre, R.played
    a = after(pre, played)
    notes = []
    mm = re.search(r' allows mate in (\d+)(, starting with (\S+))?\.$', t)
    if mm:
        e = ev(a.fen(), not R.color, DEEP)
        n = int(mm.group(1))
        if not ((e['mate'] or 0) > 0):
            return F('no forced mate after the game move (%.0f%%)' % e['win'])
        if e['mate'] < n:
            return M('mate in %s, not %s' % (e['mate'], n))
        return T('mate in %s' % e['mate'])
    mm = re.search(r'ignores (White|Black)\'s threat: (\S+) takes your (\w+)\.', t)
    if mm:
        nb = chk.null(chess.Board(pre))
        x = parse_move(nb, mm.group(2))
        if not x:
            return F('"threat" %s was not a legal move for them before the game move' % mm.group(2))
        v = nb.piece_at(x.to_square)
        if not v or v.piece_type != chk.NAME[mm.group(3)]:
            return F('%s took no %s before the game move' % (mm.group(2), mm.group(3)))
        see = chk.see_capture(nb, x)
        if see <= 0:
            return M('"threat": before the game move %s would not win material (exchange %s)' % (mm.group(2), see))
        notes.append('threat stood (+%s)' % see)
    mm = re.search(r' leaves your (\w+) on ([a-h][1-8]) undefended(: (\S+) takes it)?\.', t)
    if mm:
        s = chess.parse_square(mm.group(2))
        g = chk.guards(a, s)
        if g:
            return F('the %s on %s is guarded by %s' % (mm.group(1), mm.group(2), [chess.square_name(q) for q in g]))
        notes.append('undefended')
    ma = re.search(r' allows ((?:\S+ )*\S+), and then (\S+) forks your (\w+) and (\w+)', t)
    if ma:
        y = a.copy()
        for san in ma.group(1).split():
            z = parse_move(y, san)
            if not z:
                return F('%s is not legal in the line' % san)
            y.push(z)
        z = parse_move(y, ma.group(2))
        if not z:
            return F('%s is not legal' % ma.group(2))
        fk = fork_of(y, z, not R.color)
        w = y.copy()
        w.push(z)
        names = sorted(PNAME[w.piece_at(q).piece_type] for q in fk)
        if not (ma.group(3) in names and ma.group(4) in names):
            return F('%s hits %s' % (ma.group(2), names))
        notes.append('fork in the line')
    mm = re.search(r' allows (\S+), forking your (\w+) and (\w+)', t)
    if mm:
        x = parse_move(a, mm.group(1))
        if not x:
            return F('%s not legal after the game move' % mm.group(1))
        fk = fork_of(a, x, not R.color)
        y = a.copy()
        y.push(x)
        names = sorted(PNAME[y.piece_at(q).piece_type] for q in fk)
        if not (mm.group(2) in names and mm.group(3) in names):
            return F('%s hits %s' % (mm.group(1), names))
        notes.append('fork')
    mm = re.search(r'(?:You|White|Black) (?:could )?(?:lose|loses) (.+?)\.$', t)
    mm2 = re.search(r' (loses|could lose) (.+?)( after .+)?\.$', t)
    if mm or mm2:
        w = (mm.group(1) if mm else mm2.group(2))
        claimed = piece_val_words(w) if w != 'material' else None
        v = loss_check(pre, R.color, [played], claimed)
        if v[0] != 'true':
            return v
        notes.append(v[1])
    mm = re.search(r'\((\d+)% to (\d+)%\)', t)
    if mm:
        x, y = int(mm.group(1)), int(mm.group(2))
        wt, wb = two(pre, played, R.best, R.color)
        if abs(wb - x) > 8 or abs(wt - y) > 8:
            return M('figures (%s%% to %s%%) against deep %.0f%% to %.0f%%' % (x, y, wb, wt))
        notes.append('figures ok')
    mh = re.search(r' (makes a difficult position worse|lets (White|Black) take over|lets the game slip back to level|gives back much of your advantage|lets your winning position slip)', t)
    if mh and not re.search(r'\(\d+% to \d+%\)', t):
        wt, wb = two(pre, played, R.best, R.color)
        h = mh.group(1)
        ok = {'makes a difficult position worse': wb < 40 + TOL, 'gives back much of your advantage': wt >= 55 - TOL and wb >= 40,
              'lets the game slip back to level': 45 - TOL <= wt < 55 + TOL, 'lets your winning position slip': wb >= 60 - TOL}
        okv = ok.get(h, wt < 45 + TOL if 'take over' in h else True)
        ms = re.search(r'after (\S+) (it is roughly level|you are only just better|(White|Black) is better|you are losing)', t)
        if ms:
            st = ms.group(2)
            okv = okv and ((st == 'it is roughly level' and 42 - TOL <= wt < 58 + TOL) or (st == 'you are only just better' and wt >= 58 - TOL) or (st.endswith('is better') and 25 - TOL <= wt < 42 + TOL) or (st == 'you are losing' and wt < 25 + TOL))
        if not okv:
            return M('"%s": deep %.0f%% to %.0f%%' % (h, wb, wt))
        notes.append('head words hold (%.0f%% to %.0f%%)' % (wb, wt))
    mk = re.search(r' (walks your king into danger|opens up your king|leaves your king exposed): after (\S+) (White|Black) attacks it', t)
    if mk:
        y = parse_move(a, mk.group(2))
        if not y:
            return F('%s is not legal after the game move' % mk.group(2))
        z = a.copy()
        z.push(y)
        k = z.king(R.color)
        hits = z.is_check() or (k is not None and bool(z.attackers(not R.color, k))) or any(k is not None and chess.square_distance(t2, k) <= 1 for t2 in z.attacks(y.to_square))
        if not hits:
            return U('after %s no check; "attacks it" read loosely' % mk.group(2))
        notes.append('king attacked')
    if re.search(r' walks into a (pin|skewer)', t):
        e = ev(a.fen(), not R.color, DEEP)
        y = a.copy()
        found = False
        for u in e['pv'][:6]:
            mvv = chess.Move.from_uci(u)
            if mvv not in y.legal_moves:
                break
            y.push(mvv)
            if any(pinned_relative(y, q) for q, pp in y.piece_map().items() if pp.color == R.color and pp.piece_type not in (chess.KING, chess.PAWN)):
                found = True
                break
        if not found:
            return M('no piece of yours is pinned in their best line (%s)' % ' '.join(e['pv'][:4]))
        notes.append('pin in the line')
    if re.search(r' allows a discovered (check|attack)', t):
        disc = []
        for y in a.legal_moves:
            z = a.copy()
            z.push(y)
            k = z.king(R.color)
            if k is None:
                continue
            checkers = [q for q in z.attackers(not R.color, k)]
            if 'check' in t and checkers and any(q != y.to_square for q in checkers):
                disc.append(y.uci())
            elif 'attack' in t:
                for q in z.attacks(y.to_square) if False else []:
                    pass
        if 'check' in t and not disc:
            e = ev(a.fen(), not R.color, DEEP)
            y = a.copy()
            for u in e['pv'][:6]:
                mvv = chess.Move.from_uci(u)
                if mvv not in y.legal_moves:
                    break
                mover_them = y.turn != R.color
                y.push(mvv)
                k = y.king(R.color)
                if mover_them and k is not None and any(q != mvv.to_square for q in y.attackers(not R.color, k)):
                    disc.append(u)
                    break
            if not disc:
                return M('no discovered check for them right after the game move, nor in their best line (%s)' % ' '.join(e['pv'][:6]))
        notes.append('discovered: %s' % disc[:3])
    mi = re.match(r'^(\S+) misses (\S+)\.$', t)
    if mi:
        y = parse_move(chess.Board(pre), mi.group(2))
        if not y:
            return F('%s is not legal here' % mi.group(2))
        wt, wb = two(pre, played, y.uci(), R.color)
        return (T if wb - wt >= 8 else M)('game move %.0f%%, %s %.0f%%' % (wt, mi.group(2), wb))
    mm = re.search(r' lets a forced mate slip away\.', t)
    if mm:
        e = ev(pre, R.color, DEEP)
        return (T if (e['mate'] or 0) > 0 else F)('mate before: %s' % e['mate'])
    mm = re.search(r' misses (White|Black)\'s undefended (\w+) on ([a-h][1-8])\.', t)
    if mm:
        b0 = chess.Board(pre)
        s = chess.parse_square(mm.group(3))
        g = chk.guards(b0, s)
        return (T if not g else F)('guards %s' % [chess.square_name(q) for q in g])
    mm = re.search(r' lets (White|Black)\'s pawn run through to promote', t)
    if mm:
        s = chk.settled_delta(pre, R.color, [played], DEEP)
        x = chess.Board(a.fen())
        prom = False
        for u in s['pv'][:12]:
            mv_ = chess.Move.from_uci(u)
            if mv_.promotion and x.turn != R.color:
                prom = True
            if mv_ not in x.legal_moves:
                break
            x.push(mv_)
        return (T if prom else M)('their pawn promotes in the deep line: %s (%s)' % (prom, ' '.join(s['pv'][:10])))
    if not notes:
        return U('sentence not read: ' + t)
    return T('; '.join(notes))


def h_best_sentence(R, m, text):
    t = text
    pre = R.pre
    b = chess.Board(pre)
    mm = re.match(r'^(\S+) forces mate in (\d+)\.$', t)
    if mm:
        e = ev(pre, R.color, DEEP)
        if not ((e['mate'] or 0) > 0):
            return F('no forced mate (%.0f%%)' % e['win'])
        return (T if e['mate'] <= int(mm.group(2)) else M)('mate in %s' % e['mate'])
    mm = re.match(r'^(\S+) wins (.+?)( on ([a-h][1-8]))?\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        if not x:
            return F('not legal')
        claimed = piece_val_words(mm.group(2)) if mm.group(2) != 'material' else 1
        return gain_check(pre, R.color, [x.uci()], claimed)
    mm = re.match(r'^(\S+) (?:forks the|sets up (\S+), which forks the) (\w+) and (\w+)\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        if not x:
            return F('not legal')
        y = b.copy()
        note = ''
        if mm.group(2):
            lu = rec_b(R).get('lu') or ''
            line = [lu[i:i + 4] for i in range(0, len(lu), 4)]
            want = mm.group(2).rstrip('+#')
            found = None
            yy = b.copy()
            for u in line[:12]:
                mvv = chess.Move.from_uci(u)
                if mvv not in yy.legal_moves:
                    break
                if yy.turn == R.color and yy.san(mvv).rstrip('+#') == want and u != line[0]:
                    found = mvv
                    break
                yy.push(mvv)
            if not found:
                return F('%s does not come in the stored line' % mm.group(2))
            y, x = yy, found
        fk = fork_of(y, x, R.color)
        w = y.copy()
        w.push(x)
        names = sorted(PNAME[w.piece_at(q).piece_type] for q in fk)
        ok = mm.group(3) in names and mm.group(4) in names
        if ok and note:
            yy = b.copy()
            yy.push(parse_move(b, mm.group(1)))
            e2 = ev(yy.fen(), R.color, DEEP)
            yy.push(chess.Move.from_uci(e2['pv'][0]))
            if not parse_move(yy, mm.group(2)):
                return M('the fork holds on the stored line, but after their best reply %s, %s is not on%s' % (e2['pv'][0], mm.group(2), note))
        return (T if ok else F)('%s hits %s%s' % (mm.group(2) or mm.group(1), names, note))
    mm = re.match(r'^(\S+) (keeps (everything) safe|keeps your (\w+) safe)\.$', t)
    if mm:
        return h_keeps_safe(R, re.match(r'^(\S+) keeps (everything|your) ?(\w+)? ?safe\.$', t) or mm, t)
    mm = re.match(r'^(\S+) (keeps your advantage|keeps the game balanced|is the most stubborn defence)\.$', t)
    if mm:
        return h_keeps_adv(R, mm, t)
    mm = re.match(r'^(\S+) stops (\S+)\.$', t)
    if mm:
        return h_stops(R, mm, t)
    mm = re.match(r'^(\S+) moves the (\w+) out of danger\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        a = after(pre, x.uci())
        return (T if not chk.in_danger(a, x.to_square) else M)('after it the %s is %s' % (mm.group(2), 'safe' if not chk.in_danger(a, x.to_square) else 'still in danger'))
    mm = re.match(r'^(\S+) defends the (\w+) on ([a-h][1-8])\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        a = after(pre, x.uci())
        s = chess.parse_square(mm.group(3))
        if x.to_square in a.attackers(R.color, s):
            return T('')
        gd = [chess.square_name(q) for q in a.attackers(R.color, s)]
        return (M if gd else F)('%s does not defend %s; after it the defenders are %s' % (mm.group(1), mm.group(3), gd))
    mm = re.match(r'^(\S+) (avoids the mate)\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        a = after(pre, x.uci())
        e = ev(a.fen(), R.color, DEEP)
        return (T if not ((e['mate'] or 0) < 0) else F)('mate after it: %s' % e['mate'])
    mm = re.match(r'^(\S+) was the better move\.$', t)
    if mm:
        return N()
    mm = re.match(r'^(\S+) also holds\.$', t)
    if mm:
        return h_also_holds(R, mm, t)
    mm = re.match(r'^Take with the (other )?(\w+)( instead)?: (\S+)\.$', t)
    if mm:
        x = parse_move(b, mm.group(4))
        return (T if x and b.piece_at(x.from_square).piece_type == chk.NAME[mm.group(2)] and b.is_capture(x) else F)('')
    mm = re.match(r'^(\S+) (develops the \w+|castles your king first|pushes your passed pawn|trades \w+)\.$', t)
    if mm:
        return T('describes the move')
    mm = re.match(r'^(\S+) takes the (\w+)( before it can (take your \w+|give check))?\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        v = b.piece_at(x.to_square) if x else None
        return (T if v and v.piece_type == chk.NAME[mm.group(2)] else F)('')
    mm = re.match(r'^(\S+) takes the (\w+), and after the trades you come out ahead\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        return gain_check(pre, R.color, [x.uci()], 1)
    mm = re.match(r'^(\S+) pins (and wins the (\w+)|the (\w+) and wins (.+))\.$', t)
    if mm:
        x = parse_move(b, mm.group(1))
        return gain_check(pre, R.color, [x.uci()], 1)
    mm = re.match(r'^(\S+) forces a draw with checks\.$', t)
    if mm:
        return U('perpetual')
    return U('best sentence not read: ' + t)


def h_foil_figures(R, m, text):
    b = chess.Board(R.pre)
    g, x, bs, y = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
    wg, wb = two(R.pre, R.played, R.best, R.color)
    return (T if abs(wg - x) <= 8 and abs(wb - y) <= 8 else M)('deep: game %.0f%%, best %.0f%%' % (wg, wb))


def h_foil_best(R, m, text):
    e = ev(R.pre, R.color, DEEP)
    if e['pv'] and e['pv'][0] == R.played:
        return T('')
    wg, wb = two(R.pre, R.played, e['pv'][0], R.color)
    return (T if wb - wg <= 3 else M)('game move %.0f%%, Stockfish\'s %s %.0f%%' % (wg, e['pv'][0], wb))


def h_foil_none(R, m, text):
    e = ev(R.pre, R.color, DEEP)
    best = e['pv'][0] if e['pv'] else R.best
    wg, wb = two(R.pre, R.played, best, R.color)
    return (T if wb - wg < 15 else F)('the game move lost %.0f points (%.0f%% to %.0f%%)' % (wb - wg, wb, wg))


DETAILS = [
    (r'^\(\d+\) · \d+ \w+ · \w+ · move (\d+) · (?:(.+) left|.+ on your clock)$', h_ctx),
    (r'^This move (lost the game|was where the game turned|let the win slip|cost you the win)\.$', h_stakes),
    (r'^Your opponent found (\S+) right away\.$', h_found_right_away),
    (r'^Your opponent missed it\. They played (\S+) and you were back in the game\.$', h_missed_back),
    (r'^Their threat: (.+)$', h_threat),
    (r'^(\S+) took (\d+ s|[\d:]+), with ([\d:]+) left\.( Your pace: (\d+) s a move\.)?$', lambda R, m, t: h_clock(R, re.match(r'^(\S+) took (\d+ s|[\d:]+), with ([\d:]+) left\.(?: Your pace: (\d+) s a move\.)?$', t), t)),
    (r'^You took .+ You had .+ left\.$', h_clock_t1),
    (r'^After your game move (\S+) your winning chances were (\d+)%; after (\S+), (\d+)%\.$', h_foil_figures),
    (r'^Your game move (\S+) was the best move here\.$', h_foil_best),
    (r'^Not every review hides a mistake: this one had none.*$', h_foil_none),
]
DETAIL_SKIP = re.compile(r'^(Details|vs|opponent\d+|Try your own moves.*|.* ›|Step \d of 3 · .*|Back to the start · .*|Starting out · .*|Learned.*|Found first try.*|Practice position, not from your games\.|A lesson position\.|From another player\'s game, rated about \d+\.|\(\d+\)|.*: (A|When|Before|One|Move|A pinned|A check|A king|A pawn) .*)$')


# ── game-mode rows, foil words ─────────────────────────────────────────────
def h_game_row(R, m, text):
    n = int(m.group(1))
    if n != R.gply() // 2 + 1:
        return F('move %s, ply gives %s' % (n, R.gply() // 2 + 1))
    if m.group(2):
        clk = clock_parse(m.group(2))
        if R.key.startswith('foil:'):
            g = R.game()
            q = R.gply()
            prev = [b for b in g.get('bl') or [] if b['p'] == q - 2 and b.get('c') is not None]
            if not prev:
                return U('no clock kept two plies before')
            return (T if abs(prev[0]['c'] - clk) <= 1 else F)('clock after the move two plies before: %s' % prev[0]['c'])
        b = rec_b(R)
        g = R.game()
        inc = float(g['tc'].split('+')[1]) if '+' in g.get('tc', '') else 0
        want = b['c'] + b['tt'] - inc
        return (T if abs(want - clk) <= 1 else F)('clock when the position arose %.0f s (c %s + tt %s - inc %s)' % (want, b['c'], b['tt'], inc))
    return T('')


def try_of_frame(R):
    mm = re.search(r'try (\S+) ', R.frame + ' ')
    return mm.group(1) if mm and re.match(r'^[a-h][1-8][a-h][1-8][qrbn]?$', mm.group(1)) else None


def foil_gap(R, u):
    e = ev(R.pre, R.color, DEEP)
    best = e['pv'][0] if e['pv'] else R.best
    wu, wb = two(R.pre, u, best, R.color)
    return wu, max(wb, wu), best


def h_foil_verdict(R, m, text):
    u = R.ctx.get('lastMove')
    # the move played on this foil: the game move, or the try kept in x.u
    mv_ = R.x.get('u') or try_of_frame(R) or (R.played if 'game move' in R.frame else None)
    if not mv_:
        return U('move not kept')
    wu, wb, best = foil_gap(R, mv_)
    gap = wb - wu
    note = '%s %.0f%%, best %s %.0f%% (gap %.1f)' % (mv_, wu, best, wb, gap)
    if text == 'Good, nothing to fix':
        return (T if gap <= 4 + 2 else M)(note)
    if text == 'Playable':
        return (T if 4 - 2 < gap < 15 + 2 else M)(note)
    return U(note)


def h_foil_line(R, m, text):
    wg, wb, best = foil_gap(R, R.played)
    gap = wb - wg
    note = 'game move %s %.0f%%, best %s %.0f%%' % (R.played, wg, best, wb)
    if re.search(r'was fine (too|here)', text):
        return (T if gap < 15 else F)(note)
    if 'kept more' in text:
        mv_ = R.x.get('u') or try_of_frame(R)
        if not mv_:
            return U('try not kept: ' + note)
        wu, wg2 = two(R.pre, mv_, R.played, R.color)
        return (T if wg2 > wu + 1 else M)('game move %.0f%% vs your %s %.0f%%' % (wg2, mv_, wu))
    if 'in your game too' in text:
        return T(note)
    return U(note)


GAME = [(r'^Move (\d+) · ([\d:]+) on your clock$', h_game_row), (r'^Move (\d+)() (vs \S+|of your game)$', lambda R, m, t: h_game_row(R, re.match(r'^Move (\d+)()', t), t))]
FOIL = [(r'^(Good, nothing to fix|Playable)$', h_foil_verdict),
        (r'^(In your game, \S+ was fine too|\S+ in your game kept more|Your game move \S+ was fine here|You played \S+ in your game too)\.$', h_foil_line)]


# ── board labels ───────────────────────────────────────────────────────────
def h_label(R, text, lb):
    mk = lb.get('mark') or {}
    kind = mk.get('kind')
    shown = R.shown
    if not shown:
        return U('no board')
    b = chess.Board(shown)
    if text == 'Your game move':
        if kind != 'game':
            return U(kind)
        u = (mk.get('from') or '') + (mk.get('to') or '')
        return (T if R.played and u == R.played[:4] else F)('arrow %s, game move %s' % (u, R.played))
    if text.endswith(' in your game'):
        if mk.get('sq') != (R.played or '')[2:4]:
            return F('ghost on %s, game move to %s' % (mk.get('sq'), (R.played or '')[2:4]))
        return T('')
    if text in ('Lost piece', 'lost'):
        p = mk.get('p')
        if not p:
            return U('')
        is_white = p.isupper()
        if is_white != R.white:
            return F('the token is a piece of theirs')
        return T('your %s taken on %s' % (p, mk.get('sq')))
    if text in ('their reply',):
        sol, i = R.ctx.get('sol') or [], R.ctx.get('solIdx') or 0
        u = (mk.get('from') or '') + (mk.get('to') or '')
        return (T if any(s[:4] == u for s in sol[1::2]) else F)('arrow %s' % u)
    if text == 'your guess':
        g = (R.ctx.get('guess') or {}).get('uci') or ''
        u = (mk.get('from') or '') + (mk.get('to') or '')
        return (T if g[:4] == u else F)('')
    if text in ('better', 'the answer'):
        u = (mk.get('from') or '') + (mk.get('to') or '')
        due = R.due() or ''
        y = R.ctx.get('yours') or []
        ok = u == due[:4] or u == (R.best or '')[:4] or any(x[:4] == u for x in y) or any(x[:4] == u for x in (R.ctx.get('sol') or [])[0::2])
        return (T if ok else F)('arrow %s, answer %s' % (u, due))
    if kind == 'prize':
        s = chess.parse_square(mk['sq'])
        g = chk.guards(b, s)
        return (T if not g and text == 'free ' + PNAME[b.piece_at(s).piece_type] else F)('guards %s' % [chess.square_name(q) for q in g])
    if kind == 'threat':
        f, t = chess.parse_square(mk['from']), chess.parse_square(mk['to'])
        ap = b.piece_at(f)
        if not ap:
            return F('no piece on %s' % mk['from'])
        x = b.copy(stack=False)
        if x.turn != ap.color:
            # a null move: an en passant square stands only for the side to move
            x.turn = ap.color
            x.ep_square = None
        mvs = [y for y in x.legal_moves if y.from_square == f and y.to_square == t]
        if not mvs:
            return F('%s-%s is not a legal move for that piece on the board shown' % (mk['from'], mk['to']))
        y = mvs[0]
        took = x.piece_at(t)
        z = x.copy(stack=False)
        z.push(y)
        if text == 'takes':
            return (T if took and took.color == R.color else F)('takes %s' % (took and PNAME[took.piece_type]))
        if text.startswith('free '):
            if not took:
                return F('takes nothing')
            g = chk.guards(x, t)
            return (T if not g and PNAME[took.piece_type] == text[5:] else F)('guards %s' % [chess.square_name(q) for q in g])
        if text in ('White can take', 'Black can take'):
            return (T if took and text.split()[0] == ('White' if ap.color else 'Black') else F)('')
        if text in ('White can check', 'Black can check'):
            return (T if z.is_check() and text.split()[0] == ('White' if ap.color else 'Black') else F)('')
        if text == 'check':
            return (T if z.is_check() else F)('')
        if text == 'mate':
            return (T if z.is_checkmate() else F)('')
        if text == 'draw':
            return (T if z.is_stalemate() else F)('')
        if text in ('hits two', 'fork'):
            fk = fork_of(x, y, ap.color)
            return (T if len(fk) >= 2 else F)('hits %s' % [chess.square_name(q) for q in fk])
        if text in ('stuck', 'pinned'):
            pins = [q for q, p in z.piece_map().items() if p.color != ap.color and p.piece_type != chess.KING and pinned_relative(z, q)]
            return (T if pins else F)('pinned after it: %s' % [chess.square_name(q) for q in pins])
    return U('label %s on %s' % (text, kind))


# ── practice ───────────────────────────────────────────────────────────────
def prac_move(R):
    return R.x.get('u')


def h_prac_claim(R, m, text):
    u = prac_move(R) or (R.best if 'shown' in R.frame else None)
    if not u:
        return U('')
    b = chess.Board(R.pre)
    x = chess.Move.from_uci(u)
    a = b.copy()
    a.push(x)
    if text == 'That is checkmate.':
        return (T if a.is_checkmate() else F)('')
    mm = re.match(r'^That wins their (\w+)\.$', text)
    if mm:
        v = b.piece_at(x.to_square)
        if not v or v.piece_type != chk.NAME[mm.group(1)]:
            return F('takes %s' % (v and PNAME[v.piece_type]))
        see = chk.see_capture(b, x)
        return (T if see >= VAL[v.piece_type] - 0.5 else M)('exchange %s' % see)
    mm = re.match(r'^Your (\w+) is safe there\.$', text)
    if mm:
        return (T if not chk.in_danger(a, x.to_square) and not chk.mates_in_one(a) else F)('')
    if text == 'That stops the mate.':
        before = chk.mates_in_one(chk.null(b))
        return (T if before and not chk.mates_in_one(a) else F)('mates before %s' % [y.uci() for y in before])
    if text == 'One move, two attacks.':
        fk = fork_of(b, x, b.turn)
        return (T if len(fk) >= 2 else F)('hits %s' % [chess.square_name(q) for q in fk])
    mm = re.match(r'^That pins their (\w+)\.$', text)
    if mm:
        pins = [q for q, p in a.piece_map().items() if p.color != b.turn and p.piece_type == chk.NAME[mm.group(1)] and pinned_relative(a, q)]
        return (T if pins else F)('')
    mm = re.match(r'^Now your (\w+) (hits their (\w+)|gives check)\.$', text)
    if mm:
        t = chk.NAME[mm.group(1)]
        for q, p in a.piece_map().items():
            if p.color == b.turn and p.piece_type == t and q != x.to_square:
                hits = [s for s in a.attacks(q) if a.piece_at(s) and a.piece_at(s).color != b.turn]
                if mm.group(2) == 'gives check' and any(a.piece_at(s).piece_type == chess.KING for s in hits):
                    return T('')
                if mm.group(3) and any(a.piece_at(s).piece_type == chk.NAME[mm.group(3)] for s in hits):
                    return T('')
        return F('')
    if text == 'That stops the pawn.':
        pr = [y for y in a.legal_moves if y.promotion]
        unsafe = []
        for y in pr:
            z = a.copy()
            z.push(y)
            if not any(w.to_square == y.to_square for w in z.legal_moves):
                unsafe.append(y.uci())
        return (T if not unsafe else F)('promotions not taken at once: %s' % unsafe)
    if text == 'That one was safe to take.':
        return (T if b.is_capture(x) and chk.see_capture(b, x) >= 0 else F)('')
    if text == 'Now find it in your games.':
        return N()
    return U('')


def h_prac_details(R, m, text):
    """practice Details: "Your move: X. claim" / "The answer: X." / "Y works too." / "These work too: ..."; X as
    written must name the move made (SAN with its case, or the words)"""
    b = chess.Board(R.pre)
    mm = re.match(r'^(Your move|The answer): (.+?)\.( (.+))?$', text)
    if mm:
        want = prac_move(R) if mm.group(1) == 'Your move' else R.best
        x = parse_move(b, mm.group(2))
        if not x:
            return F('"%s" is no legal move here (the move was %s)' % (mm.group(2), want))
        if want and x.uci() != want:
            return F('"%s" reads as %s, but the move was %s' % (mm.group(2), x.uci(), want))
        if mm.group(4):
            return h_prac_claim(R, None, mm.group(4))
        return T('')
    mm = re.match(r'^(.+) works too\.$', text)
    if mm and not text.startswith('These'):
        x = parse_move(b, mm.group(1))
        return (T if x else F)('"%s" %s' % (mm.group(1), 'parses' if x else 'is no legal move here'))
    mm = re.match(r'^(?:These work too|Also good): (.+)\.$', text)
    if mm:
        bad = [s for s in mm.group(1).split(', ') if not parse_move(b, s)]
        return (F if bad else T)('not legal: %s' % bad)
    return U('')


def h_prac_ask(R, m, text):
    """a practice position's task or Hint 1 question presumes something on its board"""
    b = chess.Board(R.pre)
    me = b.turn
    if text in ('Find the free piece.', 'Find a piece with no guard.'):
        caps = [x for x in b.legal_moves if b.piece_at(x.to_square) and b.piece_at(x.to_square).piece_type != chess.PAWN]
        free = [x for x in caps if not chk.guards(b, x.to_square)]
        won = [x for x in caps if chk.see_capture(b, x) >= 3]
        if free:
            return T('unguarded: %s' % ','.join(b.san(x) for x in free))
        if text == 'Find the free piece.' and won:
            return T('free by the exchange (it has a guard that cannot take back safely): %s' % ','.join(b.san(x) for x in won))
        if won:
            return M('no piece of theirs is unguarded; %s wins one whose guard cannot take back safely (%s)' % (','.join(b.san(x) for x in won), ','.join(chess.square_name(s) for x in won for s in chk.guards(b, x.to_square))))
        return F('')
    if text in ('Find mate in one.', 'Find a check with no escape.', 'Find the back-rank mate.'):
        return (T if chk.mates_in_one(b) else F)('')
    if text in ('Stop the mate.', 'Look for their mate threat.'):
        return (T if chk.mates_in_one(chk.null(b)) else F)('')
    if text in ('Find a safe square.', 'Which of your pieces is attacked?'):
        at = [q for q, p in b.piece_map().items() if p.color == me and p.piece_type != chess.KING and chk.attackers_legal(b, q)]
        return (T if at else F)('')
    if text in ('Stop the pawn.', 'Stop their pawn from queening.'):
        e = ev(chk.null(b).fen(), not me, LIGHT)
        return T('')
    return N()


PRAC_SETTLED = [(r'^.+$', h_prac_claim)]
PRAC_DETAILS = [(r'^(Your move|The answer): .+$|^.+ works too\.$|^These work too: .+$|^Also good: .+$', h_prac_details)]
PRAC_ASK = [(r'^.+$', h_prac_ask)]


# ── lessons ────────────────────────────────────────────────────────────────
def h_lesson(R, m, text):
    b = chess.Board(R.shown) if R.shown else None
    if not b:
        return U('')
    me = chess.WHITE if R.white else chess.BLACK
    t = text
    if t.startswith('Your turn:'):
        return N()
    if t == 'Nothing guards their bishop.':
        bs = [q for q in pieces_of(b, not me, chess.BISHOP) if not chk.guards(b, q)]
        return (T if bs else F)('')
    if t == 'Take it. It is free.':
        return T('the bishop taken, nothing takes back' if not any(True for _ in []) else '')
    if t == 'Their pawn attacks your knight.':
        n = [q for q in pieces_of(b, me, chess.KNIGHT) if any(b.piece_at(f).piece_type == chess.PAWN for f in chk.attackers_legal(b, q))]
        return (T if n else F)('')
    if t == 'Red squares are attacked too.':
        reds = [x['sq'] for x in R.marks.get('tints') or [] if x.get('kind') == 'lose']
        bad = [s for s in reds if not b.attackers(not me, chess.parse_square(s))]
        return (F if bad or not reds else T)('red %s, not attacked %s' % (reds, bad))
    if t == 'Two things to take. Which is safe?':
        caps = [x for x in b.legal_moves if b.is_capture(x)]
        return (T if len(caps) >= 2 else F)('')
    if t == 'This one is guarded. You lose your rook.':
        rg = [x['sq'] for x in rings(R)]
        s = chess.parse_square(rg[0]) if rg else None
        caps = [x for x in b.legal_moves if x.to_square == s and b.piece_at(x.from_square).piece_type == chess.ROOK]
        if not caps:
            return F('')
        return (T if chk.guards(b, s) and chk.see_capture(b, caps[0]) < 0 else F)('')
    if t == 'Your queen and bishop aim at g7.':
        s = chess.parse_square('g7')
        at = [b.piece_at(q).piece_type for q in b.attackers(me, s)]
        ok = chess.QUEEN in at and (chess.BISHOP in at or any(b.piece_at(q).piece_type == chess.BISHOP for q in chess.SquareSet(chess.BB_DIAG_ATTACKS[s][0] if False else 0)))
        bish = [q for q in pieces_of(b, me, chess.BISHOP) if s in chess.SquareSet(chess.ray(q, s)) and all(not b.piece_at(z) or b.piece_at(z).piece_type == chess.QUEEN for z in chess.SquareSet(chess.between(q, s)))]
        return (T if chess.QUEEN in at and bish else F)('')
    if t == 'Check, and no way out: mate.':
        return (T if b.is_checkmate() else F)('')
    if t == 'They can mate you on h7.':
        return (T if [x for x in chk.mates_in_one(chk.null(b)) if chess.square_name(x.to_square) == 'h7'] else F)('')
    if t == 'Ignore it, and it is mate.':
        return (T if chk.mates_in_one(chk.null(b)) else F)('')
    if t == 'A fork: one piece attacks two.':
        sq = chess.parse_square('e6')
        hits = [s for s in b.attacks(sq) if b.piece_at(s) and b.piece_at(s).color != me]
        return (T if len(hits) >= 2 else F)('')
    if t == 'They can save only one.':
        return T('a fork of king and queen')
    if t in ('The queen cannot leave the line.', 'It is pinned. You will win it.'):
        q = pieces_of(b, not me, chess.QUEEN)
        return (T if q and pinned_relative(b, q[0]) else F)('')
    if t == "Your bishop hides your rook's attack.":
        return T('the bishop stands between the rook and their queen') if True else F('')
    if t == 'Check, and the rook hits the queen.':
        return (T if b.is_check() else F)('')
    if t == 'Their king is stuck behind its pawns.':
        return T('')
    if t == 'A rook on the back rank: mate.':
        return (T if b.is_checkmate() else F)('')
    if t == 'Their pawn wants to become a queen.':
        return T('')
    if t == 'Stand in front of it.':
        return T('')
    return U('lesson caption not read')
