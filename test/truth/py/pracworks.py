"""Practice positions' accepted moves ("Found it" on the card, "Also good" in Details): each scored against
Stockfish's best side by side (searchmoves) at --nodes (1,000,000), as the data says it was made (within 4
points; on a mate task, its mates); a move more than 6 points below the best is looked at again at --deep
(8,000,000). Writes pracworks.json: every position with an accepted move still more than 6 points below
the best, for the summary (read by eye: a move that still wins and still does the task holds its words).
python3 test/truth/py/pracworks.py --out DIR [--root DIR] [--threads 2] [--nodes 1000000] [--deep 8000000]"""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess, cfg, chk, sf


def score(fen, u, best, nodes, color):
    r = sf.go(fen, nodes, 2, [u, best])
    wu = wb = None
    for l in r['lines']:
        if l['pv'] and l['pv'][0] == u:
            wu = chk.win_pct(chk.line_score(l, False))
        if l['pv'] and l['pv'][0] == best:
            wb = chk.win_pct(chk.line_score(l, False))
    if wu is None:
        wu = chk.eval_side(fen, nodes, color, searchmoves=[u])['win']
    if wb is None:
        wb = chk.eval_side(fen, nodes, color, searchmoves=[best])['win']
    return wu, wb


def check(pid, row, nodes, deep):
    fen, ok, skill = row['fen'], row['accepted'], row['skill']
    b = chess.Board(fen)
    out = {'id': pid, 'skill': skill, 'ok': ok, 'bad': []}
    if skill in ('mate1', 'backrank'):
        for u in ok:
            x = b.copy()
            x.push(chess.Move.from_uci(u))
            if not x.is_checkmate():
                out['bad'].append((u, 'not mate'))
        return out
    e = chk.eval_side(fen, nodes, b.turn)
    best = e['pv'][0] if e['pv'] else None
    for u in ok:
        if not best or u == best:
            continue
        wu, wb = score(fen, u, best, nodes, b.turn)
        wb = max(wb, e['win'])
        if wb - wu > 6 and not (wu >= 90 and wb >= 90):
            wu, wb = score(fen, u, best, deep, b.turn)
            if wb - wu > 6 and not (wu >= 90 and wb >= 90):
                out['bad'].append((u, '%.0f%% against %s %.0f%% (%s)' % (wu, best, wb, cfg.nodes_word(deep))))
    return out


def main():
    p = cfg.parser('Practice positions\' accepted moves')
    p.add_argument('--threads', type=int, default=2)
    p.add_argument('--nodes', type=int, default=1000000)
    p.add_argument('--deep', type=int, default=8000000)
    a = cfg.setup(p.parse_args())
    with open(cfg.out('pdata.json')) as f:
        pdata = json.load(f)
    with ThreadPoolExecutor(a.threads) as ex:
        res = list(ex.map(lambda kv: check(kv[0], kv[1], a.nodes, a.deep), sorted(pdata.items())))
    bad = [r for r in res if r['bad']]
    with open(cfg.out('pracworks.json'), 'w') as f:
        json.dump({'positions': len(res), 'accepted': sum(len(r['ok']) for r in res), 'below': bad}, f, indent=1)
    print('practice accepted moves: %d positions, %d with an accepted move more than 6 points below the best' % (len(res), len(bad)), file=sys.stderr)


if __name__ == '__main__':
    main()
