"""Release 3 (See why shows both sides): the forms the answer's line says at every help level, read on the
See why step they are said on. Their reply: "Kf3 is their only move." (their only legal move there) and "They
play Kf3 out of check." (a quiet move out of a check); the line's end restating the answer's reason ("Rook
to g1 keeps you winning.", "Rg1+ forces mate.": the settled row's forms, read on the card's board). "Your
queen is safe." at the line's end is read by handlers2's h_story (no piece of that kind can be won there)."""
import re
import chess
from claims import *
import handlers_v1 as HV1
import handlers_v2 as HV2
import handlers_b as HB
from handlers2 import step_boards


def _their_step(R, text, named):
    b, x, a = step_boards(R)
    if not b or not x:
        return None, U('no step')
    y = HV2.words_move(b, named)
    if not y or y != x:
        return None, F('"%s" is not the move shown (%s)' % (named, x.uci()))
    if b.piece_at(x.from_square).color == R.color:
        return None, F('the move shown is yours')
    return b, None


def h_only_move(R, m, text):
    b, bad = _their_step(R, text, m.group(1))
    if bad:
        return bad
    n = b.legal_moves.count()
    return (T if n == 1 else F)('%d legal moves for them' % n)


def h_out_of_check(R, m, text):
    b, bad = _their_step(R, text, m.group(1))
    if bad:
        return bad
    x = chess.Move.from_uci(R.step['move'])
    if b.is_capture(x):
        return F('a capture, not a quiet move')
    return (T if b.is_check() else F)('in check before it: %s' % b.is_check())


STORY = [
    (r'^(.+) is their only move\.$', h_only_move),
    (r'^They play (.+) out of check\.$', h_out_of_check),
    (r'^' + HV2.SUBJ + r' keeps you winning\.$', HB.h_keeps_winning),
    (r'^(Only move: )?(\S+) forces mate\.$', HV1.h_forces_mate),
]


def story_r3(R, m, text):
    s = R.step or {}
    if s.get('seg') != 'better':
        return None
    for pat, fn in STORY:
        mm = re.match(pat, text)
        if mm:
            return fn(R, mm, text)
    return None
