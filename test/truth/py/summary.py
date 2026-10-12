"""The truth audit's summary, and gate 1's verdict: for each pass the claims checked by type and tier with
their final verdicts (final.py: the deepest recheck, then the reviewed adjudications), the board
descriptions, the gate's checks, every false and misleading claim with its repro, every claim left
unchecked or in error, stale adjudications, and the strings on screen no checker reads. Prints it and
writes summary.txt; exits 0 only when the gate passes on a full run.
python3 test/truth/py/summary.py --out DIR [--root DIR]"""
import collections, json, os, re, sys
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cfg, final

SHARE = 0.2   # the gate: misleading under 0.2% of the chess claims
NAMES = {'live': 'engine up', 'stored': 'engine down', 'practice': 'practice and lessons'}
VCOLS = ('false', 'misleading', 'noise', 'untestable', 'error')


def load_json(name, default):
    try:
        with open(cfg.out(name)) as f:
            return json.load(f)
    except Exception:
        return default


def norm(s):
    return re.sub(r'\s+', ' ', s.replace('\\|', '|').replace('`', '')).strip()


def accepted_lines():
    fn = cfg.reviewed('accepted.md')
    if not fn:
        return None, None
    with open(fn) as f:
        return [norm(l) for l in f], fn


def accepted_line(r, lines):
    """the line of accepted.md that lists the claim (its card key and its exact text), or None"""
    t, k = norm(r['text']), r['key'] or ''
    return next((l for l in lines if k in l and t in l), None)


def is_accepted(r, lines):
    return accepted_line(r, lines) is not None


def seat_of(line):
    """the seat that accepts it: the table row's last cell ('' or 'to confirm' when none has yet)"""
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    seat = cells[-1] if len(cells) >= 2 else ''
    return '' if not seat or 'to confirm' in seat.lower() else seat


def main():
    a = cfg.setup(cfg.parser('The truth audit\'s summary').parse_args())
    run, prep = load_json('run.json', {}), load_json('prep.json', {})
    adj, adjfile = final.adjudications()
    acc, accfile = accepted_lines()
    today = set(prep.get('today') or [])
    out = []

    def P(*x):
        out.append(' '.join(str(y) for y in x))

    res, stale = {}, {}
    for pas in cfg.PASSES:
        rows, st = final.finalize(pas, adj)
        if rows:
            res[pas], stale[pas] = rows, st
            with open(cfg.out('final-%s.jsonl' % pas), 'w') as f:
                for r in rows:
                    f.write(json.dumps(r) + '\n')

    P('TRUTH AUDIT SUMMARY (release gate 1)')
    P('checkout  %s, commit %s%s, index.html %s, engine %s' % (run.get('root', cfg.ROOT), (run.get('commit') or '?')[:10], ' (with uncommitted changes)' if run.get('dirty') else '', run.get('index', '?'), run.get('engine', '?')))
    P('budgets   first pass %s nodes; rechecks at %s, each only on what the stage before still flags' % (
        cfg.nodes_word(run.get('nodes', 1000000)), ', '.join(cfg.nodes_word(n) for n in sorted(set(n for p in run.get('passes', {}).values() for n in p.get('rechecks', [])))) or 'none yet'))
    P('fixture   %s fact sheets (FACTS_V %s), %s cards dealt, %s set aside, %s foils; Today\'s first set: %s' % (
        prep.get('keys', '?'), prep.get('factsV', '?'), len(prep.get('trainable') or []), len(prep.get('x') or []), len(prep.get('foils') or []), ' '.join(sorted(today)) or '?'))
    P('reviewed  adjudications %s (%d entries); accepted %s' % (adjfile or 'none', len(adj), accfile or 'none (test/truth/accepted.md)'))
    if run.get('steps'):
        P('steps     ' + ', '.join('%s %s' % (s['step'], dur(s['secs'])) for s in run['steps'][-24:]))

    for pas, rows in res.items():
        claims = [r for r in rows if r['verdict'] != 'none']
        vc = collections.Counter(r['verdict'] for r in rows)
        info = run.get('passes', {}).get(pas, {})
        P('')
        P('== %s (%s): %d chess claims checked, %d strings with no claim%s' % (pas, NAMES[pas], len(claims), vc['none'],
          '; only cards %s' % info['keys'] if info.get('keys') else ''))
        P('%-20s %7s %7s %7s %8s %6s %8s %6s %10s %6s %6s' % ('claim type', 'tier 1', 'tier 2', 'tier 3', 'all', 'false', 'mislead', 'noise', 'unchecked', 'error', 'adjud'))
        by = collections.defaultdict(collections.Counter)
        for r in claims:
            by[r['type']][r['tier']] += 1
            by[r['type']][r['verdict']] += 1
            by[r['type']]['adj'] += 1 if r.get('adjudicated') else 0
        for t in sorted(by, key=lambda t: -sum(by[t][x] for x in (1, 2, 3))):
            c = by[t]
            P('%-20s %7d %7d %7d %8d %6d %8d %6d %10d %6d %6d' % (t[:20], c[1], c[2], c[3], c[1] + c[2] + c[3], c['false'], c['misleading'], c['noise'], c['untestable'], c['error'], c['adj']))
        c = collections.Counter()
        for r in claims:
            c[r['tier']] += 1
        P('%-20s %7d %7d %7d %8d %6d %8d %6d %10d %6d %6d' % ('all', c[1], c[2], c[3], len(claims), vc['false'], vc['misleading'], vc['noise'], vc['untestable'], vc['error'], sum(1 for r in rows if r.get('adjudicated'))))
        flags = ('false', 'misleading', 'noise', 'error')
        first = sum(1 for r in rows if r['stages'] and r['stages'][0][1] in flags)
        deep = collections.defaultdict(collections.Counter)
        for r in rows:
            for n, v in r['stages'][1:]:
                deep[n]['rechecked'] += 1
                deep[n]['flagged'] += 1 if v in flags else 0
        P('rechecks: the first pass flagged %d%s' % (first, ''.join('; at %s, %d rechecked, %d still flagged' % (cfg.nodes_word(n), c['rechecked'], c['flagged']) for n, c in sorted(deep.items()))))
        ar = load_json('aria-%s.json' % pas, None)
        if ar is not None:
            P('board descriptions (aria), sentences once per board: %s' % ', '.join('%s %d' % (k, v) for k, v in sorted(ar.items())))

    # the board descriptions' flagged sentences, with their adjudications (field 'aria')
    aidx, aused, aria_bad, akeys = final.adj_index(adj), set(), {}, set()
    for pas in res:
        rows = cfg.jsonl('aria-%s.jsonl' % pas)
        for r in rows:
            akeys.add((r['pass'], r['key']))
            k = tuple(r.get(x) for x in final.ADJ_KEY)
            if k in aidx:
                aused.add(k)
                r['checked'], r['verdict'], r['note'] = r['verdict'], aidx[k]['verdict'], 'adjudicated: ' + aidx[k]['why']
        aria_bad[pas] = [r for r in rows if r['verdict'] in ('false', 'misleading', 'error', 'untestable')]
    for k, e in aidx.items():
        if e['field'] == 'aria' and k not in aused and (e['pass'], e['key']) in akeys:
            stale.setdefault(pass_of(e), []).append(e)
    allrows = [r for rows in res.values() for r in rows]
    claims = [r for r in allrows if r['verdict'] != 'none']
    false = [r for r in allrows if r['verdict'] == 'false']
    mis = [r for r in allrows if r['verdict'] == 'misleading']
    unchecked = [r for r in allrows if r['verdict'] == 'untestable']
    errors = [r for r in allrows if r['verdict'] == 'error']
    afalse = [r for x in aria_bad.values() for r in x if r['verdict'] in ('false', 'error')]
    amis = [r for x in aria_bad.values() for r in x if r['verdict'] == 'misleading']
    auntest = [r for x in aria_bad.values() for r in x if r['verdict'] == 'untestable']
    share = 100.0 * len(mis) / max(1, len(claims))
    on_today = [r for r in mis + amis if r['key'] in today]
    not_listed = [r for r in mis + amis if acc is None or not is_accepted(r, acc)]
    no_seat = [r for r in mis + amis if acc is not None and is_accepted(r, acc) and not seat_of(accepted_line(r, acc))]
    full = all(p in res for p in cfg.PASSES) and not any(run.get('passes', {}).get(p, {}).get('keys') for p in cfg.PASSES)
    # every card (and foil) the fixture deals walked at every tier: a card the walk could not open would
    # otherwise leave no claim behind and no trace
    walked_ok, walk_notes = True, []
    for pas in ('live', 'stored'):
        if pas not in res:
            continue
        info = run.get('passes', {}).get(pas, {})
        want = set(prep.get('trainable') or [])
        if info.get('keys'):
            want &= set(info['keys'].split(','))
        for dump, tiers in ((pas, (1, 2, 3)), (pas + '-game', (2, 3))):
            w = load_json('dump-%s.walk.json' % dump, None)
            if w is None:
                walked_ok = False
                walk_notes.append('%s: no walk record' % dump)
                continue
            for t in tiers:
                miss = want - set(w['cards'].get(str(t), []))
                if miss:
                    walked_ok = False
                    walk_notes.append('%s tier %d: %d cards not walked (%s)' % (dump, t, len(miss), ' '.join(sorted(miss)[:6])))
            if w.get('skipped'):
                walked_ok = False
                walk_notes.append('%s skipped: %s' % (dump, ' '.join(w['skipped'][:6])))
            if dump == 'live':
                fw = set(prep.get('foils') or [])
                if info.get('keys'):
                    fw &= set(info['keys'].split(','))
                fw -= set(w.get('setAside', {}))
                for t in (2, 3):
                    miss = fw - set(w['foils'].get(str(t), []))
                    if miss:
                        walked_ok = False
                        walk_notes.append('live foils tier %d: %d not walked (%s)' % (t, len(miss), ' '.join(sorted(miss)[:6])))
                if w.get('setAside'):
                    walk_notes.append('foils the app\'s own foil look set aside: %s' % ', '.join('%s (%s)' % kv for kv in sorted(w['setAside'].items())))
    if 'practice' in res:
        w, pd = load_json('dump-practice.walk.json', None), load_json('pdata.json', {})
        info = run.get('passes', {}).get('practice', {})
        want = set(pd)
        if info.get('keys'):
            want &= set(k[3:] for k in info['keys'].split(','))
        if w is None:
            walked_ok = False
            walk_notes.append('practice: no walk record')
        else:
            for t in (1, 2, 3):
                miss = want - set(w.get(str(t), []))
                if miss:
                    walked_ok = False
                    walk_notes.append('practice tier %d: %d positions not walked (%s)' % (t, len(miss), ' '.join(sorted(miss)[:6])))
    unread_bad = sorted(set('%s %s' % (pas, k) for pas in res for k in load_json('unread-%s.json' % pas, {}) if k not in cfg.UI_WORDS))
    import hashlib
    with open(os.path.join(cfg.ROOT, 'index.html'), 'rb') as f:
        built = hashlib.sha1(f.read()).hexdigest()[:12]
    same = built == run.get('index')
    deep = all(max(run.get('passes', {}).get(p, {}).get('rechecks', []) or [0]) >= 4000000 for p in res) and run.get('nodes', 1000000) >= 1000000

    P('')
    P('== gate 1')
    checks = [
        (not false and not afalse, '0 false claims: %d on cards (%s), %d board descriptions (%d more the board check cannot read: "after both your tries", listed below)' % (len(false), ', '.join('%s %d' % (p, sum(1 for r in false if pass_of(r) == p)) for p in res), len(afalse), len(auntest))),
        (share < SHARE, 'misleading under %.1f%% of the chess claims: %.3f%% (%d of %d; board descriptions %d more)' % (SHARE, share, len(mis), len(claims), len(amis))),
        (not on_today, 'no misleading claim on Today\'s first set: %d' % len(on_today)),
        (not not_listed and not no_seat, 'every misleading claim listed in accepted.md with the seat that accepts it: %d not listed, %d listed with no seat yet%s' % (len(not_listed), len(no_seat), '' if acc is not None else ' (no accepted.md)')),
        (not errors, 'no check that failed to run: %d errors' % len(errors)),
        (not unchecked, 'every claim checked (a form no checker reads needs an adjudication): %d unchecked' % len(unchecked)),
        (not unread_bad, 'every string on screen read by a checker or a justified UI word: %d forms not read%s' % (len(unread_bad), (' (' + '; '.join(unread_bad[:4]) + ')') if unread_bad else '')),
        (full, 'a full run: every pass, every card' + ('' if full else ' (partial: not a gate verdict)')),
        (walked_ok, 'every card dealt and every foil walked at every tier%s' % (': ' + '; '.join(walk_notes) if walk_notes else '')),
        (same, 'the run is of the checkout\'s current build (index.html %s; the run read %s)' % (built, run.get('index', '?'))),
        (deep, 'the first pass at 1M or more, and what it flags rechecked at 4M or more on every pass (%s)' % '; '.join('%s %s' % (p, ', '.join(cfg.nodes_word(n) for n in run.get('passes', {}).get(p, {}).get('rechecks', [])) or 'none') for p in res)),
    ]
    for ok, text in checks:
        P('[%s] %s' % ('pass' if ok else 'FAIL', text))
    gate = all(ok for ok, _ in checks)
    P('GATE 1: %s' % ('PASS' if gate else 'FAIL'))

    def show(r, why=''):
        stages = ' > '.join('%s %s' % (cfg.nodes_word(n), v) for n, v in r.get('stages', []))
        P('')
        P('[%s] %s t%s %s | %s | %s | %s%s' % (r['verdict'], r['pass'], r['tier'], r['key'], r['frame'], r['field'], r['type'], why))
        P('  "%s"' % r['text'])
        P('  board %s%s' % (r.get('shown') or r.get('st') or r.get('pre'), ('  try %s, their reply %s' % (r['tried'], r.get('reply'))) if r.get('tried') else ''))
        P('  check %s%s: %s' % (stages, ' then adjudicated (the check said %s)' % r['checked'] if r.get('adjudicated') else '', str(r['note'])[:600]))
        P('  repro ' + cfg.repro(r['id']))

    order = lambda r: (cfg.PASSES.index(pass_of(r)), r['key'] or '', r['tier'], r['frame'])
    if false or afalse:
        P('')
        P('== false claims (%d on cards, %d board descriptions)' % (len(false), len(afalse)))
        for r in sorted(false, key=order):
            show(r)
        for r in afalse:
            P('[%s] board description %s t%s %s | %s: "%s" on %s (%s; ctx %s)' % (r['verdict'], r['pass'], r['tier'], r['key'], r['frame'], r['text'], r['shown'], r['note'], r.get('ctx')))
    if mis or amis:
        P('')
        P('== misleading claims (%d on cards, %d board descriptions)' % (len(mis), len(amis)))
        for r in sorted(mis, key=order):
            al = accepted_line(r, acc) if acc is not None else None
            show(r, (' | TODAY\'S FIRST SET' if r['key'] in today else '') + ((' | accepted.md: %s' % ('seat ' + seat_of(al) if seat_of(al) else 'listed, no seat yet')) if al else ' | not in accepted.md'))
            if al:
                P('  accepted.md: %s' % al[:300])
        for r in amis:
            P('[misleading] board description %s t%s %s | %s: "%s" on %s (%s; ctx %s)%s' % (r['pass'], r['tier'], r['key'], r['frame'], r['text'], r['shown'], r['note'], r.get('ctx'),
              (' | TODAY\'S FIRST SET' if r['key'] in today else '') + (' | listed in accepted.md' if acc is not None and is_accepted(r, acc) else ' | not in accepted.md')))
    if auntest:
        P('')
        P('== board description sentences the board check cannot read alone (%d): "after both your tries" names two tries not kept together' % len(auntest))
        for t, n in collections.Counter(r['text'] for r in auntest).most_common(10):
            P('  %4d  %s' % (n, t))
    for title, rs in (('unchecked claims: check each by hand and adjudicate it (python3 test/truth/py/adjudicate.py)', unchecked), ('check errors', errors)):
        if rs:
            P('')
            P('== %s (%d)' % (title, len(rs)))
            for r in sorted(rs, key=order):
                show(r)
    cleared = [r for r in allrows if r['verdict'] in ('true', 'noise') and not r.get('adjudicated') and any(v in ('false', 'misleading') for n, v in r.get('stages', [])[:-1])]
    if cleared:
        P('')
        P('== cleared only by a deeper recheck (%d): false or misleading at a shallower stage, so read them (a borderline claim can turn on depth)' % len(cleared))
        for r in sorted(cleared, key=order):
            P('  %s t%s %s | %s | "%s": %s' % (r['pass'], r['tier'], r['key'], r['frame'], r['text'], ' > '.join('%s %s' % (cfg.nodes_word(n), v) for n, v in r['stages'])))
    near = collections.defaultdict(list)
    for e in adj:
        near[(e['pass'], e['key'], e['text'])].append(e)
    renew = [r for r in false + mis + unchecked if not r.get('adjudicated') and near.get((r['pass'], r['key'], r['text']))]
    if renew:
        P('')
        P('== flagged claims with an adjudication written for another frame, tier or board (re-review; it does not apply)')
        for r in renew:
            e = near[(r['pass'], r['key'], r['text'])][0]
            P('  %s t%s %s | %s | "%s": adjudicated %s for t%s %s: %s' % (r['pass'], r['tier'], r['key'], r['frame'], r['text'], e['verdict'], e['tier'], e['frame'], e['why'][:200]))
    sl = [e for x in stale.values() for e in x]
    if sl:
        P('')
        P('== stale adjudications: written for a claim this run no longer shows (prune with adjudicate.py --prune)')
        for e in sl:
            P('  %s t%s %s | %s | %s | "%s" (%s)' % (e['pass'], e['tier'], e['key'], e['frame'], e['field'], e['text'], e['verdict']))
    pw = load_json('pracworks.json', None)
    if pw is not None:
        P('')
        P('== practice accepted moves ("Found it", "Also good"): %d positions, %d accepted moves; %d positions with one more than 6 points below the best (read each: a move that still wins and still does the task holds its words)' % (pw['positions'], pw['accepted'], len(pw['below'])))
        for r in pw['below']:
            P('  pk:%s (%s): %s' % (r['id'], r['skill'], '; '.join('%s %s' % (u, n) for u, n in r['bad'])))
    if os.path.exists(cfg.out('screens-recount.txt')):
        P('')
        P('== the summary, Today and Insights: the recount beside the screens\' numbers is in %s (read side by side)' % cfg.out('screens-recount.txt'))
    P('')
    P('== strings on screen no checker reads, by form (pass | field | form: count, one example; a UI word justified in cfg.UI_WORDS and the README, else NOT READ)')
    for pas in res:
        cov = load_json('unread-%s.json' % pas, {})
        items = sorted(cov.items(), key=lambda kv: -kv[1]['n'])
        P('%s: %d forms, %d strings' % (pas, len(items), sum(v['n'] for k, v in items)))
        for k, v in items[:40]:
            P('  %6d  %s   e.g. "%s" (%s t%s, %s): %s' % (v['n'], k[:90], v['example'][:80], v['key'], v['tier'], v['frame'][:40], cfg.UI_WORDS.get(k, 'NOT READ')))
        if len(items) > 40:
            P('  ... %d more forms in unread-%s.json' % (len(items) - 40, pas))
    P('')
    P('== strings a checker read and judged no claim (instructions, questions, advice), by form: a claim wrongly read as advice would hide here')
    for pas, rows in res.items():
        nc = collections.Counter('%s | %s' % (r['field'], cfg.template(r['text'])) for r in rows if r['verdict'] == 'none')
        P('%s: %d forms, %d strings' % (pas, len(nc), sum(nc.values())))
        for k, v in nc.most_common(25):
            P('  %6d  %s' % (v, k[:110]))
        if len(nc) > 25:
            P('  ... %d more forms' % (len(nc) - 25))
    text = '\n'.join(out) + '\n'
    with open(cfg.out('summary.txt'), 'w') as f:
        f.write(text)
    sys.stdout.write(text)
    sys.exit(0 if gate else 1)


def pass_of(r):
    return 'practice' if r['pass'] == 'screens' else r['pass']


def dur(s):
    return '%d s' % s if s < 120 else '%d min' % round(s / 60.0) if s < 7200 else '%.1f h' % (s / 3600.0)


if __name__ == '__main__':
    main()
