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
