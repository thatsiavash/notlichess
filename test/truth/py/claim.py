"""One claim, looked at again: the frame it is on (the board as the player sees it, the card's position,
the try and its reply in SAN), its verdicts so far (first pass, rechecks, adjudication), and its check
run again at --nodes (default 8,000,000). Pick it by its id (the summary prints it) or by card and text.
python3 test/truth/py/claim.py --out DIR --id ID [--nodes 8000000]
python3 test/truth/py/claim.py --out DIR --pass live --key KEY [--text SUBSTRING] [--tier N] [--frame SUBSTRING]"""
import json, os, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess
import cfg, sf, verify, recheck, final


def san(fen, ucis):
    b, out = chess.Board(fen), []
    for u in ucis:
        try:
            m = chess.Move.from_uci(u)
            out.append(b.san(m))
            b.push(m)
        except Exception:
            out.append(u + '?')
            break
    return ' '.join(out)


def main():
    p = cfg.parser('One claim, checked again')
    p.add_argument('--id', default='')
    p.add_argument('--pass', dest='pas', default='', choices=('',) + cfg.PASSES)
    p.add_argument('--key', default='')
    p.add_argument('--text', default='')
    p.add_argument('--tier', type=int, default=0)
    p.add_argument('--frame', default='')
    p.add_argument('--nodes', type=int, default=8000000)
    a = cfg.setup(p.parse_args())
    if not a.id and not a.key:
        sys.exit('give --id, or --pass and --key')
    passes = [a.pas] if a.pas else [x for x in cfg.PASSES if os.path.exists(cfg.out('results-%s.jsonl' % x))]
    cfg.budget(a.nodes)
    verify.load_pdata()
    adj = final.adj_index(final.adjudications()[0])
    n = 0
    for pas in passes:
        cur = recheck.current(pas)
        if a.id and a.id not in cur:
            continue
        items, _ = verify.items_of(pas, {a.key} if a.key else ({cur[a.id]['key']} if a.id else None))
        for it, k in items:
            i = verify.claim_id(k)
            R, field, text, typ = it[0], it[1], it[2], it[3]
            if a.id and i != a.id:
                continue
            if (a.text and a.text not in text) or (a.tier and R.tier != a.tier) or (a.frame and a.frame not in R.frame):
                continue
            n += 1
            c = R.ctx
            t = c.get('tried') or {}
            print('== %s t%s %s | %s | %s | %s | id %s' % (R.r.get('pass'), R.tier, R.key, R.frame, field, typ, i))
            print('"%s"' % text)
            if R.shown:
                print(chess.Board(R.shown))
            print('shown %s' % R.shown)
            print('card  %s (player %s), game move %s, answer %s%s' % (c.get('pre'), 'White' if c.get('white') else 'Black',
                  san(c['pre'], [c['played']]) if c.get('pre') and c.get('played') else '-', san(c['pre'], [c['best']]) if c.get('pre') and c.get('best') else '-',
                  ', line %s' % san(c['pre'], c['sol']) if c.get('sol') else ''))
            if t.get('uci'):
                print('try   %s from %s%s' % (san(c['st'], [t['uci']]), c.get('st'), ', their reply %s' % san(c['st'], [t['uci'], t['reply']]).split(' ', 1)[-1] if t.get('reply') else ''))
            r0 = cur.get(i)
            if r0:
                print('so far %s: %s' % (r0['verdict'], str(r0['note'])[:400]))
            e = adj.get(tuple((r0 or {}).get(x) for x in final.ADJ_KEY))
            if e:
                print('adjudicated %s: %s' % (e['verdict'], e['why']))
            v = verify.run_one(it)
            print('now at %s: %s: %s' % (cfg.nodes_word(a.nodes), v[0], v[1]))
            print()
    if not n:
        print('no claim matches')
    print(sf.stats, file=sys.stderr)


if __name__ == '__main__':
    main()
