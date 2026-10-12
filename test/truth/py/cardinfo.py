"""A card's board, its moves and where a string shows on it, from a pass's dumps.
python3 test/truth/py/cardinfo.py --out DIR <dump: live, live-game, stored, stored-game, practice> <key> [text substring]"""
import json, os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess, cfg

p = cfg.parser('A card, from the dumps')
p.add_argument('dump')
p.add_argument('key')
p.add_argument('sub', nargs='?', default=None)
a = cfg.setup(p.parse_args())
first, hits = None, {}
with open(cfg.out('dump-%s.jsonl' % a.dump)) as f:
    for l in f:
        r = json.loads(l)
        if r.get('key') != a.key:
            continue
        if first is None and r.get('ctx', {}).get('pre'):
            first = r
        if a.sub:
            for fl in ('row1', 'row2', 'cap', 'chip', 'tag', 'live', 'aria'):
                if a.sub in (r.get(fl) or ''):
                    hits.setdefault((r['tier'], r['frame'][:50], fl), r.get(fl))
            for d in r.get('details') or []:
                if a.sub in d:
                    hits.setdefault((r['tier'], r['frame'][:50], 'details'), d)
if not first:
    sys.exit('no frame of %s in dump-%s.jsonl' % (a.key, a.dump))
c = first['ctx']
b = chess.Board(c['pre'])
san = lambda bd, u: bd.san(chess.Move.from_uci(u)) if u else '-'
print(a.key, 'player', 'White' if c['white'] else 'Black', 'card', c['pre'])
print(b)
print('game move', san(b, c.get('played')), 'answer', san(b, c.get('best')), 'line', c.get('sol'))
for k, v in sorted(hits.items())[:60]:
    print('  t%s | %s | %s | %s' % (k[0], k[1], k[2], v[:200]))
