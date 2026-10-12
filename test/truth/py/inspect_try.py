"""A try on a card, looked at closely: the board, the try against the card's answer side by side, and
Stockfish's replies to the try (3 lines) with the material along each.
python3 test/truth/py/inspect_try.py --out DIR <dump> <key> <try uci> [nodes, default 4000000]"""
import json, os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess, cfg, chk, sf

p = cfg.parser('A try, looked at closely')
p.add_argument('dump')
p.add_argument('key')
p.add_argument('u')
p.add_argument('nodes', nargs='?', type=int, default=4000000)
a = cfg.setup(p.parse_args())
rec = None
with open(cfg.out('dump-%s.jsonl' % a.dump)) as f:
    for l in f:
        r = json.loads(l)
        if r.get('key') == a.key and r.get('ctx', {}).get('pre'):
            rec = r
            break
if not rec:
    sys.exit('no frame of %s' % a.key)
c = rec['ctx']
b = chess.Board(c['pre'])
color = chess.WHITE if c['white'] else chess.BLACK
print(b)
print(c['pre'], 'player', 'white' if c['white'] else 'black', 'game move', b.san(chess.Move.from_uci(c['played'])), 'answer', b.san(chess.Move.from_uci(c['best'])))


def show(board, lines):
    for l in lines:
        w = chk.win_pct(chk.line_score(l, color != board.turn))
        x = board.copy()
        sans = []
        for m in l['pv'][:12]:
            mm = chess.Move.from_uci(m)
            sans.append(x.san(mm))
            x.push(mm)
        print('  player %.1f%% (cp %s, mate %s, depth %s): %s   [net material along it %+d]' % (w, l['cp'], l['mate'], l.get('depth'), ' '.join(sans), chk.mat_diff(x, color) - chk.mat_diff(b, color)))


print('the try against the answer:')
show(b, sf.go(c['pre'], a.nodes, 2, [a.u, c['best']] if a.u != c['best'] else [a.u])['lines'])
t = chk.after(c['pre'], a.u)
print('after the try, their replies:')
show(t, sf.go(t.fen(), a.nodes, 3)['lines'])
