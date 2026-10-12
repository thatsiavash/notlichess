"""Write a reviewed verdict into adjudications.json, for the exact claims it was decided on: every claim in
the current dumps with this card key and this exact text (narrowed by --tier, --frame, --try) gets an
entry keyed by pass, tier, card, frame, field, exact text and the hash of everything it is read against
(the boards, the moves, the try and its reply, the step), so the verdict can never cover a claim it was
not written for: a new board, line, try or word leaves the claim to its check, and the summary lists the
entry as stale. --why says what the deeper look found (the node count, the line, the figures).
python3 test/truth/py/adjudicate.py --out DIR --pass live --key KEY --text "exact text" --verdict true|false|misleading|noise --why "8M: ..."
       [--tier N] [--frame FRAME] [--try UCI] [--file PATH] [--dry]
       [--aria]   (a sentence of the board's description, as aria.py reads it)
python3 test/truth/py/adjudicate.py --out DIR --prune [--file PATH]   (drop the entries no claim of DIR matches)
The file is --reviewed's adjudications.json, else the checkout's test/truth one, unless --file names another."""
import json, os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cfg, verify, final

VERDICTS = ('true', 'false', 'misleading', 'noise', 'none')


def entry(it, k, verdict, why):
    R, field, text = it[0], it[1], it[2]
    return {'pass': R.r.get('pass'), 'tier': R.tier, 'key': R.key, 'frame': R.frame, 'field': field, 'text': text,
            'ctx': verify.ctx_hash(R.r, field, text), 'board': R.shown, 'tried': (R.ctx.get('tried') or {}).get('uci'),
            'verdict': verdict, 'why': why}


def load(fn):
    if os.path.exists(fn):
        with open(fn) as f:
            return json.load(f)
    return {'about': ABOUT, 'adjudications': []}


def save(fn, d):
    d['adjudications'].sort(key=lambda e: (e['pass'], e['key'], e['tier'], e['frame'], e['field'], e['text']))
    with open(fn, 'w') as f:
        f.write('{\n "about": %s,\n "adjudications": [\n' % json.dumps(d.get('about', ABOUT)))
        f.write(',\n'.join('  ' + json.dumps(e, ensure_ascii=False) for e in d['adjudications']))
        f.write('\n ]\n}\n')


ABOUT = ('Reviewed verdicts for claims the checks cannot settle alone, each for the exact claim it names (pass, tier, card, '
         'frame, field, exact text, ctx: the hash of the boards, moves, try, reply and step it is read against). '
         'Written by test/truth/py/adjudicate.py; see test/truth/README.md.')


def main():
    p = cfg.parser('Write a reviewed verdict')
    p.add_argument('--pass', dest='pas', default='', choices=('',) + cfg.PASSES)
    p.add_argument('--key', default='')
    p.add_argument('--text', default='')
    p.add_argument('--tier', type=int, default=0)
    p.add_argument('--frame', default='')
    p.add_argument('--try', dest='tried', default='')
    p.add_argument('--verdict', default='', choices=('',) + VERDICTS)
    p.add_argument('--why', default='')
    p.add_argument('--file', default='')
    p.add_argument('--dry', action='store_true')
    p.add_argument('--prune', action='store_true')
    p.add_argument('--aria', action='store_true', help='a sentence of the board\'s description')
    a = cfg.setup(p.parse_args())
    fn = a.file or os.path.join(cfg.REVIEWED or os.path.join(cfg.ROOT, 'test', 'truth'), 'adjudications.json')
    d = load(fn)
    if a.prune:
        keep, drop = [], []
        have, ran = {}, set()
        for pas in cfg.PASSES:
            for r in cfg.jsonl('results-%s.jsonl' % pas) + cfg.jsonl('aria-%s.jsonl' % pas):
                have[tuple(r.get(x) for x in final.ADJ_KEY)] = 1
                ran.add((r['pass'], r['key']))
        for e in d['adjudications']:
            # only an entry for a card this run checked can be judged stale
            (keep if tuple(e[x] for x in final.ADJ_KEY) in have or (e['pass'], e['key']) not in ran else drop).append(e)
        for e in drop:
            print('drop %s t%s %s | %s | "%s"' % (e['pass'], e['tier'], e['key'], e['frame'], e['text']))
        d['adjudications'] = keep
        if not a.dry:
            save(fn, d)
        print('%d kept, %d dropped (%s)' % (len(keep), len(drop), fn))
        return
    if not (a.pas and a.key and a.text and a.verdict and a.why):
        sys.exit('give --pass, --key, --text (exact), --verdict and --why')
    verify.load_pdata()
    idx = final.adj_index(d['adjudications'])
    n = 0
    if a.aria:
        # a board description's sentence: the first frame that shows it on each board, as aria.py reads it
        import re
        seen = set()
        for which in cfg.DUMPS[a.pas]:
            with open(cfg.out('dump-%s.jsonl' % which)) as f:
                for line in f:
                    r = json.loads(line)
                    if r.get('key') != a.key or not r.get('aria') or not r.get('shown'):
                        continue
                    for s in re.split(r'(?<=\.) (?=[A-Z])', r['aria']):
                        k = (which, r.get('tier'), r.get('key'), s, r['shown'])
                        if k in seen:
                            continue
                        seen.add(k)
                        if s != a.text or (a.tier and r.get('tier') != a.tier) or (a.frame and r.get('frame') != a.frame):
                            continue
                        e = {'pass': r.get('pass'), 'tier': r.get('tier'), 'key': r.get('key'), 'frame': r.get('frame'), 'field': 'aria', 'text': s,
                             'ctx': cfg.ctx_hash(r, 'aria', s), 'board': r['shown'], 'tried': ((r.get('ctx') or {}).get('tried') or {}).get('uci'), 'verdict': a.verdict, 'why': a.why}
                        idx[tuple(e[x] for x in final.ADJ_KEY)] = e
                        n += 1
                        print('%s t%s %s | %s | aria | "%s" -> %s' % (e['pass'], e['tier'], e['key'], e['frame'], s, a.verdict))
    items = [] if a.aria else verify.items_of(a.pas, {a.key})[0]
    for it, k in items:
        R, field, text = it[0], it[1], it[2]
        if text != a.text or (a.tier and R.tier != a.tier) or (a.frame and R.frame != a.frame) or (a.tried and (R.ctx.get('tried') or {}).get('uci') != a.tried):
            continue
        e = entry(it, k, a.verdict, a.why)
        idx[tuple(e[x] for x in final.ADJ_KEY)] = e
        n += 1
        print('%s t%s %s | %s | %s | "%s" -> %s' % (e['pass'], e['tier'], e['key'], e['frame'], field, text, a.verdict))
    if not n:
        sys.exit('no claim in the dumps matches')
    d['adjudications'] = list(idx.values())
    if not a.dry:
        save(fn, d)
    print('%d entries written to %s' % (n, fn))


if __name__ == '__main__':
    main()
