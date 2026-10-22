"""Release 4 (credit for every right answer; the verdict is binary): a try in the near band (within 10 points
of the best and in its band of the game, above the game move) is found: "Found it", with the best named under
it where it is really better at depth ("Rxa7 was a little better.", tier 1 "Rook takes on a7 was a little
better."); a foil passed is a find ("Found it", "Qxa2 was good in your game too."); V1.9's saving move at More
help is a wrong try, its reason "Safe, but ..." as at the other levels."""
import re
import chess
from claims import *
import handlers_v1 as HV
import handlers_v2 as HV2
import handlers_gate as HG
import handlers3 as H3
from handlers import PIECE


def _band(w):
    return 2 if w >= 70 else 1 if w >= 40 else 0


def _same_band(wt, wb):
    """the same band of the game, within the engine's noise at a band's edge"""
    if _band(wt) == _band(wb):
        return True
    return any(abs(wt - e) < TOL or abs(wb - e) < TOL for e in (40, 70) if min(wt, wb) < e <= max(wt, wb))


def h_found(R, m, text):
    """"Found it" (after a miss "You got there", after a hint "Found with a hint"): the answer, a move within 4
    points of it, or (release 4) a move of the near band"""
    base, u, due = HG.found_move(R)
    if not u or not due:
        return U('no move kept')
    b = chess.Board(base)
    sk = HG.H1.PRAC_SKILL.get((R.key or '')[3:]) if (R.key or '').startswith('pk:') else None
    if sk in ('mate1', 'backrank') or u == due:
        return HG.h_found(R, m, text)
    wt, wb = two(base, u, due, R.color)
    note = '%s %.0f%%, the answer %s %.0f%%' % (u, wt, due, wb)
    if wb - wt <= 4 + TOL:
        return T(note)
    if wb - wt <= 10 + TOL and _same_band(wt, wb):
        return T('the near band: ' + note)
    return ('noise', note) if wb - wt <= 18 else F(note)


def h_little_better(R, m, text):
    """"Rxa7 was a little better.": named the main move there, and it is better than the move played by more
    than the engine's noise, and not by much (10 points or so: more is misleading)"""
    yo = HV.yours_move(R)
    if not yo:
        return U('no move of yours kept')
    base, u, due = yo
    b = chess.Board(base)
    g = m.group(1)
    x = HV2.words_move(b, g) or (HV2.words_move(b, g[0].lower() + g[1:]) if g[:1].isupper() and ' ' in g else None)
    z = x.uci() if x else None
    if not z:
        return F('"%s" is not a legal move here' % m.group(1))
    if z != due:
        return F('"%s" is %s, the main move is %s' % (m.group(1), z, due))
    if u == due:
        return F('your move is the main move')
    up, why = ranks_above(base, u, due, R.color)
    if up:
        return F('"a little better" than a move that ranks above it: ' + why)
    wt, wb = two(base, u, due, R.color, DEEP)
    note = 'the main move %s %.0f%%, yours %s %.0f%%' % (due, wb, u, wt)
    if wb - wt <= 0:
        return F('not better: ' + note)
    if wb - wt < 1.5:
        return ('noise', note)
    if wb - wt > 10 + TOL:
        return M('more than a little: ' + note)
    return T(note)


def h_good_in_game(R, m, text):
    """a foil's "Qxa2 was good in your game too.": the game move, within 4 points of the best (noise to 10)"""
    wg, wb, best = H3.foil_gap(R, R.played)
    b = chess.Board(R.pre)
    z = parse_move(b, m.group(1))
    if not z or z.uci() != R.played:
        return F('"%s" is not the game move %s' % (m.group(1), R.played))
    gap = wb - wg
    note = 'game move %s %.0f%%, best %s %.0f%%' % (R.played, wg, best, wb)
    if gap <= 4 + TOL:
        return T(note)
    return ('noise', note) if gap <= 10 else M(note)


SETTLED = [(r'^(.+) was a little better\.$', h_little_better)]
FOIL = [(r'^(\S+) was good in your game too\.$', h_good_in_game)]
REASON = [(r'^That saves your ' + PIECE + r'\. Look for more\.$', HV.h_saves_more)]
VERDICT_WORDS = [(r'^(Found it|You got there|Found with a hint)$', h_found)]
STORY = SETTLED
