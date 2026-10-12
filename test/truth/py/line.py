"""Stockfish on a position, for a repro: White's win chance on the app's curve and the line in SAN.
python3 test/truth/py/line.py --out DIR <fen> [moves uci,...] [nodes, default 4000000] [lines, default 1]"""
import os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess, cfg, chk, sf

p = cfg.parser('Stockfish on a position')
p.add_argument('fen')
p.add_argument('moves', nargs='?', default='')
p.add_argument('nodes', nargs='?', type=int, default=4000000)
p.add_argument('lines', nargs='?', type=int, default=1)
a = cfg.setup(p.parse_args())
b = chess.Board(a.fen)
pre = []
for m in [x for x in a.moves.split(',') if x]:
    pre.append(b.san(chess.Move.from_uci(m)))
    b.push(chess.Move.from_uci(m))
r = sf.go(b.fen(), a.nodes, a.lines)
print('after', ' '.join(pre) or '(start)', '|', b.fen())
for l in r['lines']:
    x = b.copy()
    s = []
    for m in l['pv'][:14]:
        mm = chess.Move.from_uci(m)
        s.append(x.san(mm))
        x.push(mm)
    w = chk.win_pct(chk.line_score(l, b.turn == chess.BLACK))
    print('  White %.1f%% (cp %s, mate %s, depth %s): %s' % (w, l['cp'], l['mate'], l.get('depth'), ' '.join(s)))
