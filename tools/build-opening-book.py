#!/usr/bin/env python3
"""
Build the embedded opening reply-book from the Lichess open database (CC0).

For each of four coarse rating bands, a map from opening-line prefix (space-
joined SAN, up to BOOK_DEPTH plies) to the replies actually played there by
players in that band: move, count, and White-perspective score%.

This is what lets the openings trainer answer "what will people at YOUR
rating play here, and how does it go for them" with zero network — the
Lichess opening explorer becomes an enhancement, not a dependency.

Bands use the game's average Elo (a 1500-vs-1520 game describes what happens
in 1500 chess). Prefixes are move sequences, not FENs — the page's own chess
engine converts prefixes to FEN keys at load time and merges transpositions
there, where only a few thousand nodes exist instead of millions.

Usage:  curl … | zstd -dc | python3 build-opening-book.py OUT.json [MAX_GAMES]
"""
import sys, json, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else 'opening-book.json'
MAX_GAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 0

BOOK_DEPTH = 12          # plies of theory the book holds
PRUNE_EVERY = 250000     # games between memory prunes
PRUNE_MIN = 8            # a line this rare mid-stream will never make the cut
EMIT_MIN_POS = 900       # a prefix needs this many games in a band to emit
EMIT_MIN_MOVE = 60       # a reply needs this many plays to be listed
EMIT_TOP = 6             # replies listed per position

SPEEDS = ('Bullet', 'Blitz', 'Rapid', 'Classical')


def gband(avg):
    if avg < 1200: return '1000'
    if avg < 1600: return '1400'
    if avg < 2000: return '1800'
    return '2200'


# book[band][prefix][san] = [n, white_wins, draws]
book = {b: collections.defaultdict(dict) for b in ('1000', '1400', '1800', '2200')}

hdr = {}
games = 0
skipped = 0


def head_moves(mt):
    """First BOOK_DEPTH SAN tokens, reading only the head of the movetext."""
    out = []
    for t in mt[:1400].split():
        c = t[0]
        if c in '0123456789{[%$' or t.endswith('.') or c == '}':
            # '1-0' style results start with a digit and are caught here too
            continue
        if t in ('1-0', '0-1', '1/2-1/2', '*'):
            break
        out.append(t.rstrip('?!'))
        if len(out) >= BOOK_DEPTH:
            break
    return out


def prune():
    for b in book:
        bb = book[b]
        for pfx in list(bb.keys()):
            moves = bb[pfx]
            if sum(v[0] for v in moves.values()) < PRUNE_MIN:
                del bb[pfx]


for line in sys.stdin:
    if line.startswith('['):
        sp = line.find(' ')
        hdr[line[1:sp]] = line[sp + 2:line.rfind('"')]
        continue
    if not line.strip():
        continue
    mt = line
    try:
        ev = hdr.get('Event', '')
        if not any(s in ev for s in SPEEDS):
            raise ValueError('speed')
        we = int(hdr.get('WhiteElo', '?'))
        be = int(hdr.get('BlackElo', '?'))
        result = hdr.get('Result', '*')
        if result not in ('1-0', '0-1', '1/2-1/2'):
            raise ValueError('result')
        toks = head_moves(mt)
        if len(toks) < 6:
            raise ValueError('short')
        b = book[gband((we + be) // 2)]
        ww = 1 if result == '1-0' else 0
        dr = 1 if result == '1/2-1/2' else 0
        for i in range(min(len(toks), BOOK_DEPTH)):
            pfx = ' '.join(toks[:i])
            rec = b[pfx].get(toks[i])
            if rec is None:
                b[pfx][toks[i]] = [1, ww, dr]
            else:
                rec[0] += 1; rec[1] += ww; rec[2] += dr
        games += 1
        if games % PRUNE_EVERY == 0:
            prune()
            sys.stderr.write('%d games (book pruned)\n' % games)
            sys.stderr.flush()
        if MAX_GAMES and games >= MAX_GAMES:
            break
    except Exception:
        skipped += 1
    finally:
        hdr = {}

# ── Emit ─────────────────────────────────────────────────────────────────
out = {'source': 'lichess_db_standard_rated_2026-07', 'games': games,
       'depth': BOOK_DEPTH, 'bands': {}}
positions = 0
for b, bb in book.items():
    ob = {}
    emit_min = max(EMIT_MIN_POS, games // 4000)   # scale with sample size
    for pfx, moves in bb.items():
        total = sum(v[0] for v in moves.values())
        if total < emit_min:
            continue
        top = sorted(moves.items(), key=lambda kv: -kv[1][0])[:EMIT_TOP]
        parts = []
        for san, (n, w, d) in top:
            if n < EMIT_MIN_MOVE:
                continue
            score = (w + d * 0.5) * 100.0 / n     # White-perspective
            parts.append('%s:%d:%.1f' % (san, n, score))
        if parts:
            ob[pfx] = '|'.join(parts)
    out['bands'][b] = ob
    positions += len(ob)

with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
sys.stderr.write('done: %d games, %d skipped, %d positions, %d bytes\n'
                 % (games, skipped, positions, len(json.dumps(out, separators=(',', ':')))))
