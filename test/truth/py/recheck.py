"""The deep recheck: every claim of a pass that the latest stage still flags (false, misleading, noise or
error: the first pass's results-<pass>.jsonl, then each recheck below --nodes) checked again with every
node budget at --nodes and no cap; writes deep-<pass>-<nodes>.jsonl (one row per claim rechecked, by
its id). The gate runs it at 4,000,000 and then at 8,000,000 nodes.
python3 test/truth/py/recheck.py --out DIR --pass live|stored|practice --nodes 4000000 [--root DIR]
       [--threads 2] [--keys k1,k2]"""
import glob, json, os, re, sys, threading
from concurrent.futures import ThreadPoolExecutor
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cfg, sf, verify

FLAGS = ('false', 'misleading', 'noise', 'error')


def stages(pas, below=None):
    """the recheck stages of a pass on disk, shallowest first: [(nodes, rows by id)]"""
    out = []
    for fn in glob.glob(cfg.out('deep-%s-*.jsonl' % pas)):
        m = re.search(r'-(\d+)\.jsonl$', fn)
        n = int(m.group(1))
        if below is None or n < below:
            out.append((n, {r['id']: r for r in cfg.jsonl(os.path.basename(fn))}))
    return sorted(out, key=lambda x: x[0])


def current(pas, below=None):
    """each claim's latest verdict: the first pass, overwritten by every recheck stage in turn"""
    cur = {r['id']: r for r in cfg.jsonl('results-%s.jsonl' % pas)}
    for n, rows in stages(pas, below):
        for i, r in rows.items():
            if i in cur:
                cur[i] = dict(cur[i], verdict=r['verdict'], note=r['note'], nodes=n)
    return cur


def main():
    p = cfg.parser('The truth audit\'s deep recheck')
    p.add_argument('--pass', dest='pas', required=True, choices=cfg.PASSES)
    p.add_argument('--nodes', type=int, required=True)
    p.add_argument('--threads', type=int, default=2, help='Stockfish processes (default 2)')
    p.add_argument('--keys', default='', help='only these card keys (comma separated)')
    a = cfg.setup(p.parse_args())
    cfg.budget(a.nodes)
    verify.load_pdata()
    keys = set(x for x in a.keys.split(',') if x) or None
    cur = current(a.pas, a.nodes)
    flagged = set(i for i, r in cur.items() if r['verdict'] in FLAGS and (not keys or r['key'] in keys))
    items, _ = verify.items_of(a.pas, keys)
    todo = [(it, k) for it, k in items if verify.claim_id(k) in flagged]
    print('%s: %d flagged, %d found in the dumps, rechecked at %d nodes' % (a.pas, len(flagged), len(todo), a.nodes), file=sys.stderr)
    out = open(cfg.out('deep-%s-%d.jsonl' % (a.pas, a.nodes)), 'w')
    lock = threading.Lock()
    done = [0]

    def work(x):
        it, k = x
        i = verify.claim_id(k)
        v = verify.run_one(it)
        with lock:
            out.write(json.dumps({'id': i, 'key': it[0].key, 'tier': it[0].tier, 'text': it[2], 'was': cur[i]['verdict'], 'verdict': v[0], 'note': v[1]}) + '\n')
            out.flush()
            done[0] += 1
            if done[0] % 50 == 0:
                print('  %d of %d %s' % (done[0], len(todo), sf.stats), file=sys.stderr)
    with ThreadPoolExecutor(a.threads) as ex:
        list(ex.map(work, todo))
    out.close()
    print('%s: recheck at %d done %s' % (a.pas, a.nodes, sf.stats), file=sys.stderr)


if __name__ == '__main__':
    main()
