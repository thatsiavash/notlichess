"""Keys as browsers make them (release 2's C5 (h)), checked: each key keys.js built through the page's
own factsCompute, on a browser worker that had run other searches, against an 8,000,000-node 3-line
search of the card's position (the harness's clean engine). A forced mate the key's answer does not
play, or an answer more than 4 points below the deep best (the two side by side at 8,000,000), fails:
a player's browser would teach that answer. A key that sets the card aside deals nothing (counted).
Writes final-keys.jsonl (one row a card, as the other passes' final rows) and keys.json.
python3 test/truth/py/keys.py --out DIR [--root DIR] [--keys k1,k2]"""
import hashlib, json, os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess
import cfg, chk, sf

NODES = 8000000
TOL = 4   # the found band (SOLVE_TOL): an answer more than this below the deep best fails


def side(l, flip):
    """a line's (win, mate) for the side the search is about (flip: the other side than the one to move)"""
    cp = chk.line_score(l, flip)
    m = l.get('mate')
    if m is not None and flip:
        m = -m
    return chk.win_pct(cp), m


def check(card, fixture):
    k = card.get('k') or {}
    pre, white = card['pre'], card['white']
    color = chess.WHITE if white else chess.BLACK
    b = chess.Board(pre)
    row = {'pass': 'keys', 'tier': 0, 'key': None, 'frame': 'key as a browser builds it', 'field': 'key', 'type': 'key',
           'pre': pre, 'st': pre, 'shown': pre, 'worker': card.get('worker'), 'secs': card.get('secs'), 'first': card.get('first')}
    fx = fixture or {}
    if not k or k.get('err'):
        return dict(row, text='no key', verdict='untestable', note='factsCompute gave %s' % (k.get('err') if k else 'nothing'))
    if k.get('x'):
        same = 'as the fixture' if fx.get('x') == k['x'] else 'the fixture %s' % ('sets it aside too (%s)' % fx['x'] if fx.get('x') else 'deals it (answer %s)' % fx.get('a'))
        return dict(row, text='Set aside (%s)' % k['x'], verdict='none', note='a browser sets the card aside: %s' % same)
    a = k.get('a')
    mv = chess.Move.from_uci(a) if a else None
    if not mv or mv not in b.legal_moves:
        return dict(row, text='The answer: %s' % a, verdict='false', note='the key\'s answer is not a legal move')
    san = b.san(mv)
    r = sf.go(pre, NODES, 3, None)
    lines = [l for l in r['lines'] if l.get('pv')]
    deep = [(l['pv'][0],) + side(l, False) for l in lines]
    best = deep[0][0] if deep else None
    note0 = '8M: %s; the key %s%s' % (', '.join('%s %s' % (b.san(chess.Move.from_uci(u)), ('mate %d' % m) if m is not None else '%.0f%%' % w) for u, w, m in deep),
                                     ', '.join('%s %s' % (b.san(chess.Move.from_uci(l[0])), ('mate %d' % l[2]) if l[2] else l[1]) for l in k.get('l') or []),
                                     '' if a == fx.get('a') else '; the fixture\'s answer %s' % fx.get('a'))
    mates = [(u, m) for u, w, m in deep if m is not None and m > 0]
    if mates:
        e = sf.go(pre, NODES, 1, [a])
        l0 = (e.get('lines') or [{}])[0]
        if l0.get('mate') is not None and l0['mate'] > 0:
            return dict(row, text='The answer: %s' % san, verdict='true', note='%s forces mate (mate %d at 8M). %s' % (san, l0['mate'], note0))
        u, m = mates[0]
        return dict(row, text='The answer: %s' % san, verdict='false',
                    note='a forced mate missing: %s mates in %d at 8M, the key\'s answer %s does not (%s). %s' % (b.san(chess.Move.from_uci(u)), m, san, ('cp %s' % l0.get('cp')) if l0 else '?', note0))
    if a == best:
        return dict(row, text='The answer: %s' % san, verdict='true', note='the deep best. ' + note0)
    e = sf.go(pre, NODES, 2, [a, best])
    got = {l['pv'][0]: side(l, False)[0] for l in e['lines'] if l.get('pv')}
    wa, wb = got.get(a), got.get(best)
    if wa is None or wb is None:
        return dict(row, text='The answer: %s' % san, verdict='untestable', note='the side-by-side search kept %s' % list(got))
    gap = wb - wa
    note = '%s %.0f%%, the deep best %s %.0f%% side by side at 8M (%.1f points). %s' % (san, wa, b.san(chess.Move.from_uci(best)), wb, gap, note0)
    return dict(row, text='The answer: %s' % san, verdict='false' if gap > TOL else 'true', note=note)


def main():
    p = cfg.parser('Keys as browsers make them, against 8,000,000 nodes')
    p.add_argument('--keys', default='')
    p.add_argument('--threads', type=int, default=2)
    a = cfg.setup(p.parse_args())
    built = json.load(open(cfg.out('keys-built.json')))
    ff = os.path.join(cfg.ROOT, 'test', 'data', 'facts-fixture.json')
    fixture = json.load(open(ff))['cards'] if os.path.exists(ff) else {}
    only = set(x for x in a.keys.split(',') if x)
    cards = [k for k in built['cards'] if not only or k in only]
    from concurrent.futures import ThreadPoolExecutor

    def one(key):
        r = check(built['cards'][key], fixture.get(key))
        r['key'] = key
        r['stages'] = [[NODES, r['verdict']]] if r['verdict'] != 'none' else []
        r['id'] = hashlib.sha1(json.dumps(['keys', key, r['text']]).encode()).hexdigest()[:16]
        return r

    # the seeds' keys (seeds.json): each card's key as the tester's browser made it, checked the same way
    seeds = [(k, v) for k, v in (built.get('seeds') or {}).items() if not only or k in only]

    def one_seed(kv):
        key, sd = kv
        c = dict(built['cards'].get(key) or {}, k=sd.get('k'))
        if not c.get('pre'):
            return None
        r = check(c, fixture.get(key))
        r['key'] = key
        r['frame'] = 'key as a browser builds it after %s (seed %s)' % (' '.join(sd.get('warm') or []), ','.join(sd.get('ids') or []))
        r['stages'] = [[NODES, r['verdict']]] if r['verdict'] != 'none' else []
        r['id'] = hashlib.sha1(json.dumps(['keys', key, r['frame'], r['text']]).encode()).hexdigest()[:16]
        return r

    with ThreadPoolExecutor(max(1, min(2, a.threads))) as ex:
        rows = list(ex.map(one, cards)) + [r for r in ex.map(one_seed, seeds) if r]
    with open(cfg.out('final-keys.jsonl'), 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    bad = [r for r in rows if r['verdict'] == 'false']
    main = [r for r in rows if r['frame'] == 'key as a browser builds it']
    info = {'cards': len(main), 'seeds': len(rows) - len(main), 'false': len(bad), 'set aside': sum(1 for r in main if r['verdict'] == 'none'),
            'untestable': sum(1 for r in rows if r['verdict'] == 'untestable'), 'differ': sum(1 for r in rows if 'the fixture\'s answer' in str(r.get('note'))),
            'factsV': built.get('factsV'), 'workers': built.get('workers'), 'secs': built.get('secs'), 'warm': built.get('warm')}
    json.dump(info, open(cfg.out('keys.json'), 'w'), indent=1)
    for r in bad:
        print('[false] key %s: %s: %s' % (r['key'], r['text'], r['note']))
    print('keys as browsers make them: %d cards and %d seeds, %d false, %d set aside, %d untestable, %d answers unlike the fixture\'s' % (
        info['cards'], info['seeds'], info['false'], info['set aside'], info['untestable'], info['differ']), file=sys.stderr)


if __name__ == '__main__':
    main()
