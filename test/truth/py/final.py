"""The truth audit's final verdicts for a pass: the first pass (results-<pass>.jsonl) with each recheck
stage's verdict over it (the deepest stands; the chain is kept as `stages`), instructions taken out of
the claims, a band understatement (the right side, one band milder) called misleading rather than false,
and the reviewed adjudications applied (adjudications.json: an entry holds only for the exact claim it
names, by pass, tier, card, frame, field, exact text and the hash of everything the claim is read
against, so it can never cover a claim it was not written for). Writes final-<pass>.jsonl.
python3 test/truth/py/final.py --out DIR [--root DIR] [--pass live|stored|practice]"""
import json, os, re, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cfg, recheck, t1words

INSTR = {'Play the green arrow.', 'Now find it in your games.'}
ADJ_KEY = ('pass', 'tier', 'key', 'frame', 'field', 'text', 'ctx')


def adjudications():
    """(entries, the file read): the reviewed adjudications, the checkout's own file else this harness's"""
    fn = cfg.reviewed('adjudications.json')
    if not fn:
        return [], None
    with open(fn) as f:
        return json.load(f)['adjudications'], fn


def adj_index(entries):
    return {tuple(e[k] for k in ADJ_KEY): e for e in entries}


def finalize(pas, adj=None):
    """the final rows of a pass, and the adjudications that matched nothing it holds"""
    rows = cfg.jsonl('results-%s.jsonl' % pas)
    if not rows:
        return [], []
    stages = recheck.stages(pas)
    if adj is None:
        adj = adjudications()[0]
    idx = adj_index(adj)
    used = set()
    out = []
    staged = []
    for r in rows:
        r = dict(r, first=r['verdict'], stages=[[cfg_nodes(), r['verdict']]])
        for n, st in stages:
            d = st.get(r['id'])
            if d:
                r['note1'] = r.get('note1') or r['note']
                r['verdict'], r['note'] = d['verdict'], '%s: %s' % (cfg.nodes_word(n), d['note'])
                r['stages'].append([n, d['verdict']])
                r['rechecked'] = n
        staged.append(r)
    # tier 1's Details lines no checker reads take their tier 2 line's final verdict (t1words.py)
    t1words.pair(staged)
    for r in staged:
        if r['text'] in INSTR:
            r['verdict'], r['note'] = 'none', 'an instruction, no claim'
        m = re.search(r'player has (\d+)%.*\(opp better\).*\((\d+) points outside the band\)', str(r['note'])) or \
            re.search(r'player (\d+)% \(.*\(1?(\d+) points outside the band\)', str(r['note']))
        if r['verdict'] == 'false' and m and re.search(r'\b(White|Black) (is )?better\b', r['text']) and int(m.group(1)) < 20:
            r['verdict'], r['note'] = 'misleading', r['note'] + ' [understates: by the app\'s own bands the opponent is winning]'
        k = tuple(r.get(x) for x in ADJ_KEY)
        e = idx.get(k)
        if e:
            used.add(k)
            r['checked'] = r['verdict']
            r['verdict'], r['note'] = e['verdict'], 'adjudicated: ' + e['why']
            r['adjudicated'] = True
        out.append(r)
    # an adjudication this pass should have used: its pass, and a card the pass checked
    keys = set(r['key'] for r in out)
    recpass = set(r['pass'] for r in out)
    stale = [e for k, e in idx.items() if k not in used and e['field'] != 'aria' and e['pass'] in recpass and e['key'] in keys]
    return out, stale


def cfg_nodes():
    """the first pass's budget, as the driver recorded it"""
    try:
        with open(cfg.out('run.json')) as f:
            return json.load(f).get('nodes', 1000000)
    except Exception:
        return 1000000


def main():
    p = cfg.parser('The truth audit\'s final verdicts')
    p.add_argument('--pass', dest='pas', default='', help='one pass (default: every pass with results)')
    a = cfg.setup(p.parse_args())
    adj, fn = adjudications()
    for pas in ([a.pas] if a.pas else cfg.PASSES):
        rows, stale = finalize(pas, adj)
        if not rows:
            continue
        with open(cfg.out('final-%s.jsonl' % pas), 'w') as f:
            for r in rows:
                f.write(json.dumps(r) + '\n')
        print('%s: %d claims, %d adjudicated (%s), %d stale adjudications' % (pas, len(rows), sum(1 for r in rows if r.get('adjudicated')), fn, len(stale)), file=sys.stderr)


if __name__ == '__main__':
    main()
