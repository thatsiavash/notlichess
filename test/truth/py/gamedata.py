"""The fixture's games, by card key (gameId:ply), as the verifier reads them: moves, colour, result, the
win-chance series (decoded independently of the app), the clock fields and the record (the keyed fixture
as the page stores it, enriched.json in the output folder, written by prep.js; both card passes read it)."""
import json, os
import chess
import cfg

WP_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'


def load(which):
    with open(cfg.out('enriched.json')) as f:
        d = json.load(f)
    games = d['games'] if isinstance(d, dict) else d
    return {g['id']: g for g in games}


def wp_at(g, ply):
    """the player's win chance after ply `ply` (0-based), None when not scored"""
    s = g.get('wp') or ''
    if ply < 0 or ply >= len(s) or s[ply] == '.':
        return None
    ch = s[ply]
    legacy = any(c in s for c in ':;<=>?@[]^`') and 48 <= ord(ch) <= 111
    w = ((ord(ch) - 48) if legacy else WP_ABC.index(ch)) / 0.63
    return w if g['color'] == 'white' else 100 - w


def positions(g):
    """boards before each ply, and the moves (python-chess), as far as the SAN parses"""
    b = chess.Board()
    out, mvs = [b.fen()], []
    for san in (g.get('mv') or '').split():
        try:
            m = b.parse_san(san)
        except Exception:
            break
        mvs.append(m)
        b.push(m)
        out.append(b.fen())
    return out, mvs


class Games:
    def __init__(self, which):
        self.which = which
        self.games = load(which)
        self._pos = {}

    def game(self, key):
        gid = key.split(':')[0] if key and not key.startswith(('foil:', 'pk:', 'ls:')) else (key.split(':')[1] if key and key.startswith('foil:') else None)
        return self.games.get(gid)

    def record(self, key):
        g = self.game(key)
        if not g or key.startswith(('foil:', 'pk:', 'ls:')):
            return None
        p = int(key.split(':')[1])
        for b in g.get('bl') or []:
            if b['p'] == p:
                return b
        return None

    def ply(self, key):
        return int(key.split(':')[-1])

    def pos(self, key):
        g = self.game(key)
        if g['id'] not in self._pos:
            self._pos[g['id']] = positions(g)
        return self._pos[g['id']]

    def move_at(self, key, ply):
        """the game's own move at ply `ply` (python-chess Move) or None"""
        fens, mvs = self.pos(key)
        return mvs[ply] if 0 <= ply < len(mvs) else None

    def fen_at(self, key, ply):
        fens, mvs = self.pos(key)
        return fens[ply] if 0 <= ply < len(fens) else None
