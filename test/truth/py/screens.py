"""The recount for the summary, Today and Insights: the fixture's own series and records (the keyed
fixture, enriched.json), decoded here and not by the app, set beside every line of those screens that
holds a number (the practice pass's dump, at tiers 1 to 3), to be read side by side. Writes
screens-recount.json and screens-recount.txt.
python3 test/truth/py/screens.py --out DIR [--root DIR]"""
import json, os, re, sys, statistics
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cfg
cfg.setup(cfg.parser('The summary and Insights recount').parse_args())
import gamedata
import chk

G = gamedata.Games('live')
games = list(G.games.values())
CONV, RES = chk.win_pct(200), chk.win_pct(-200)


def series(g):
    return [gamedata.wp_at(g, i) for i in range(len(g.get('wp') or ''))]


def mistakes(g, thr=15):
    """big mistakes of the player by the series (a drop of thr points or more on the player's move)"""
    s = series(g)
    mine = 0 if g['color'] == 'white' else 1
    out = []
    for i in range(1, len(s)):
        if i % 2 != mine or s[i - 1] is None or s[i] is None:
            continue
        if s[i - 1] - s[i] >= thr:
            out.append(i)
    return out


def decided(g):
    """one move turned the game for good: a move of the player's after which the series never came
    back to 50, from a position of 40 or more before it (the series at the ply before)"""
    s = series(g)
    mine = 0 if g['color'] == 'white' else 1
    hits = []
    for i in range(1, len(s)):
        if i % 2 != mine or s[i - 1] is None or s[i] is None:
            continue
        rest = [w for w in s[i + 1:] if w is not None]
        if s[i - 1] >= 40 and s[i] < 50 and (not rest or max(rest) < 50) and s[i - 1] - s[i] >= 10:
            hits.append((i, round(s[i - 1]), round(s[i])))
    return hits


def swings(g):
    s = series(g)
    if (g.get('plies') or 0) < 6:
        return None
    mine = 0 if g['color'] == 'white' else 1
    scored = sum(1 for i, w in enumerate(s) if w is not None and i % 2 == mine)
    if scored < 5:
        return None
    reach = next((i for i, w in enumerate(s) if w is not None and w >= CONV), None)
    fell = next((i for i, w in enumerate(s) if w is not None and w <= RES), None)
    return reach, fell


out = {}
losses = [g for g in games if g['res'] == 'loss']
out['losses'] = len(losses)
dec = {g['id']: decided(g) for g in losses}
out['decided_series'] = sum(1 for g in losses if dec[g['id']])
# the app's own flags (d=1 on a record) against the series reading
flag = {g['id']: [b for b in g.get('bl') or [] if b.get('d') == 1 and not b.get('x')] for g in losses}
out['decided_flags'] = sum(1 for g in losses if flag[g['id']])
out['flag_kinds'] = {}
mismatch = []
for g in losses:
    fl = flag[g['id']]
    for b in fl:
        k = b.get('dw') or '?'
        out['flag_kinds'][k] = out['flag_kinds'].get(k, 0) + 1
        s = series(g)
        rest = [w for w in s[b['p'] + 1:] if w is not None]
        mx = max(rest) if rest else None
        mismatch.append({'game': g['id'], 'p': b['p'], 'dw': k, 'wb': round(b['wb']), 'wa': round(b['wa']), 'series_before': s[b['p'] - 1] and round(s[b['p'] - 1]), 'series_after': s[b['p']] and round(s[b['p']]), 'max_after': mx and round(mx)})
out['flagged'] = mismatch
reached = [g for g in games if swings(g) and swings(g)[0] is not None]
fell = [g for g in games if swings(g) and swings(g)[1] is not None]
out['conv'] = (sum(1 for g in reached if g['res'] == 'win'), len(reached))
out['save'] = (sum(1 for g in fell if g['res'] != 'loss'), len(fell))
out['slow'] = (sum(1 for g in losses if not flag[g['id']]), len(losses))
# clean games: no big mistake by the series at the player's threshold
out['clean'] = [g['opp'] for g in games if not mistakes(g)]
# deciding moves under 10 s, and the other big mistakes
recs = [(g, b) for g in games for b in g.get('bl') or [] if not b.get('x') and b.get('tt') is not None]
decs = [(g, b) for g, b in recs if (b.get('d') or 0) > 0]
others = [(g, b) for g, b in recs if not (b.get('d') or 0) > 0]
out['fast'] = (sum(1 for g, b in decs if b['tt'] < 10), len(decs), sum(1 for g, b in others if b['tt'] < 10), len(others))
lost = [(g, b) for g, b in decs if b.get('d') == 1 and g['res'] == 'loss']
out['lost_moves'] = {'n': len(lost), 'took': statistics.median([b['tt'] for g, b in lost]) if lost else None, 'left': statistics.median([b['c'] for g, b in lost]) if lost else None}
def pace(g, b):
    base = float(g['tc'].split('+')[0]) * 60
    inc = float(g['tc'].split('+')[1]) if '+' in g['tc'] else 0
    n = b['p'] // 2 + 1
    if n < 2:
        return None
    p = round((base + inc * (n - 1) - (b['c'] + b['tt'] - inc)) / (n - 1))
    return p if p >= 1 else None
ps = [pace(g, b) for g, b in lost if pace(g, b) is not None]
out['lost_moves']['pace'] = round(statistics.median(ps)) if ps else None
used = []
for g in losses:
    if g.get('clockPct') is None:
        continue
    base = float(g['tc'].split('+')[0]) * 60
    inc = float(g['tc'].split('+')[1]) if '+' in g['tc'] else 0
    n = (g['plies'] + 1) // 2 if g['color'] == 'white' else g['plies'] // 2
    allt = base + inc * n
    used.append(max(0, allt - g['clockPct'] * base / 100))
out['used_min'] = round(statistics.median(used) / 60) if used else None
# Today's rows: mistakes per game and "cost the game"
out['rows'] = {}
for g in games:
    out['rows'][g['opp']] = {'res': g['res'], 'series_mistakes': len(mistakes(g)), 'records': len([b for b in g.get('bl') or [] if not b.get('x')]), 'decided': len(flag.get(g['id'], [])) if g['res'] == 'loss' else len([b for b in g.get('bl') or [] if (b.get('d') or 0) > 0 and not b.get('x')])}
with open(cfg.out('screens-recount.json'), 'w') as f:
    json.dump(out, f, indent=1)
txt = ['recount from the fixture (series decoded here; flags are the records\' own d=1):',
       json.dumps({k: v for k, v in out.items() if k not in ('flagged', 'rows', 'clean')}, indent=1),
       'clean games by the series: %s' % out['clean']]
for x in out['flagged']:
    if x['dw'] == 'slip' or (x['max_after'] or 0) >= 50 or (x['series_before'] or 0) < 40 or x['wa'] >= 40:
        txt.append('flag to look at: %s' % x)
txt.append('')
txt.append('the screens\' lines with a number in them:')
if os.path.exists(cfg.out('dump-practice.jsonl')):
    with open(cfg.out('dump-practice.jsonl')) as f:
        for line in f:
            r = json.loads(line)
            if not r.get('frame', '').startswith('screen') or r['frame'].startswith('screen skill sheet'):
                continue
            for l in r.get('lines') or []:
                if re.search(r'\d', l):
                    txt.append('  t%s %-14s %s' % (r['tier'], r['frame'][7:], l))
with open(cfg.out('screens-recount.txt'), 'w') as f:
    f.write('\n'.join(txt) + '\n')
print('summary and Insights recount: screens-recount.txt (%d lines)' % len(txt), file=sys.stderr)
