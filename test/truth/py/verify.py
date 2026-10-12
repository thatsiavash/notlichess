"""The truth audit's first pass: reads a pass's dumps, picks each chess claim on screen with the board it
is said on, checks it (handlers*.py: python-chess for board facts, the checkout's Stockfish for engine
facts, at --nodes, 1,000,000 by default) and writes results-<pass>.jsonl, one row per distinct claim
(dups counts the same claim again on the same board), and unread-<pass>.json, the strings on screen that
no checker reads, by template.
python3 test/truth/py/verify.py --out DIR --pass live|stored|practice [--root DIR] [--threads 2]
       [--nodes 1000000] [--keys k1,k2] [--limit N]"""
import collections, hashlib, json, os, re, sys, threading, traceback
from concurrent.futures import ThreadPoolExecutor
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess
import cfg, chk, sf, gamedata
from claims import Rec, T, F, M, U, N
import handlers as H1, handlers2 as H2, handlers3 as H3
import handlers_v1 as HV
# v2 slice 1's forms, read before the older ones
H2.SETTLED[:0] = HV.SETTLED
H1.VERDICT[:0] = HV.VERDICT
H2.FORCING[:0] = HV.FORCING
H3.DETAILS[:0] = HV.DETAILS

_games = []


def games():
    if not _games:
        _games.append(gamedata.Games('live'))
    return _games[0]


def table(tbl, text):
    for rx, fn in tbl:
        m = re.match(rx, text)
        if m:
            return fn, m
    return None, None


def family(frame):
    f = frame
    for a, b in [(r' miss, reason said$', ' miss'), (r' miss, See it landed$', ' miss'), (r' miss$', ' miss'), (r', reason (drawn|said)$', ''), (r', See it landed$', ''), (r' See it landed$', '')]:
        f = re.sub(a, b, f)
    return f


def classify(R, field, text):
    """(type, handler table) for one string on one frame"""
    fr = R.frame
    prac = fr.startswith('prac') or (R.key or '').startswith('pk:')
    foil = (R.key or '').startswith('foil:')
    if field == 'row1':
        if text in ('Not this one', 'Good move', 'That works too'):
            return ('verdict', H1.VERDICT)
        if text in ('Good, nothing to fix', 'Playable'):
            return ('foil verdict', H3.FOIL)
        if text.startswith('The answer: '):
            return ('answer', [(r'^The answer: (.+)$', h_answer)])
        return (None, None)
    if field == 'chip':
        return ('chip', [(r'^(Their move|Safety check|Your chances)$', h_chip)])
    if field == 'tag':
        if re.match(r'^(Lost|Drew) ', text):
            return ('tag', [(r'^(Lost|Drew) (vs \S+|the game)$', h_tag)])
        return (None, None)
    if field == 'cap':
        if fr.startswith('lesson'):
            return ('lesson caption', [(r'^.+$', H3.h_lesson)])
        if R.step:
            return ('see why', H2.STORY)
        return (None, None)
    if field == 'row2':
        if prac:
            if re.search(r'prac (miss|close)', fr):
                return ('practice reason', H1.REASON + H1.VERDICT)
            if 'hint' in fr:
                return ('practice hint', H1.HINT + H3.PRAC_ASK)
            if 'found' in fr or 'shown' in fr or 'settled' in fr:
                return ('practice settled', H3.PRAC_SETTLED)
            if 'open' in fr:
                return ('practice task', H3.PRAC_ASK)
            return (None, None)
        if foil:
            if 'hint' in fr:
                return ('foil hint', H1.HINT)
            if re.search(r'settled|found|game move', fr):
                return ('foil line', H3.FOIL)
            if ' miss' in fr:
                return ('reason', H1.REASON)
            return (None, None)
        if re.search(r'(miss, reason said|miss, See it landed|game move again, reason said|game move again, See it landed|game game move, reason said|game game move, See it landed)$', fr) or re.search(r' miss(, reason said|, See it landed)?$', fr):
            return ('reason', H1.REASON)
        if re.search(r' close$', fr):
            return ('verdict', H1.VERDICT)
        if R.r.get('row1', '').startswith('Hint') or 'worked example' in fr:
            h = R.r.get('row1', '')
            t = 'hint 3' if h.startswith('Hint 3') else 'hint 2' if h.startswith('Hint 2') else 'hint 1'
            return ((('game ' if fr.startswith('game') else '') + t), H1.HINT)
        if fr.startswith('forcing') or fr.startswith('game forcing'):
            return ('forcing line', H2.FORCING)
        if fr == 'game open' or (fr.startswith('game') and re.match(r'^Move \d+', text)):
            return ('game row', H3.GAME)
        if re.search(r'(S0 settled|shown, settled|shown line, settled|game found, settled|game shown, settled)$', fr):
            return ('settled', H2.SETTLED)
        if text.startswith('Find a better move than '):
            return ('task', [(r'^Find a better move than (.+)\.$', h_task)])
        return (None, None)
    return (None, None)


# ── small handlers that need the record wrapper ────────────────────────────
def h_answer(R, m, text):
    """V1: the answer named, read on the board it is said on (settled: the card's own position; before
    that, the position the move is due from), else on the other"""
    settled = R.r.get('phase') == 'done' and (R.ctx.get('view') or {}).get('mode') == 's0' and (R.ctx.get('settle') or 0) >= 2
    boards = [R.pre, R.st] if settled or not (R.ctx.get('sol') and (R.ctx.get('solIdx') or 0) > 0) else [R.st, R.pre]
    due = R.due()
    sol = R.ctx.get('sol') or []
    first = None
    if m.group(1) == 'castling':
        for fen in boards:
            b = chess.Board(fen)
            cs = [y for y in b.legal_moves if b.is_castling(y)]
            if any(y.uci() in (due, R.best) for y in cs):
                return (M('"castling" with both castlings legal; the answer is %s' % due) if len(cs) > 1 else T(''))
    for fen in boards:
        b = chess.Board(fen)
        x = chk.parse_move(b, m.group(1))
        if not x:
            continue
        first = first or (x, b)
        if x.uci() == due or x.uci() == R.best or x.uci() in sol:
            if m.group(1) == 'castling' and len([y for y in b.legal_moves if b.is_castling(y)]) > 1:
                return M('"castling" with both castlings legal; the answer is %s' % x.uci())
            return T('')
    if not first:
        return F('"%s" is not a legal move on the board' % m.group(1))
    return F('"%s" reads as %s; the answer is %s' % (m.group(1), first[0].uci(), due))


def h_task(R, m, text):
    b = chess.Board(R.pre)
    x = chk.parse_move(b, m.group(1))
    if not x or x.uci() != R.played:
        return F('"%s" is not the game move %s' % (m.group(1), R.played))
    wt, wb = H1.two(R.pre, R.played, R.best, R.color)
    note = 'premise: game move %.0f%%, best %.0f%% (gap %.0f)' % (wt, wb, wb - wt)
    if wb - wt >= 8:
        return T(note)
    return ('noise', note) if wb - wt >= 3 else M(note)


def h_tag(R, m, text):
    g = R.game()
    want = {'Lost': 'loss', 'Drew': 'draw'}[m.group(1)]
    return (T if g and g['res'] == want else F)('result %s' % (g and g['res']))


def h_chip(R, m, text):
    t = R.tried
    if not t or not t.get('reply'):
        return U('no reply')
    b0 = chess.Board(R.st)
    nb = chk.null(b0)
    rp = chess.Move.from_uci(t['reply'])
    stood = False
    if rp in nb.legal_moves:
        y = nb.copy()
        y.push(rp)
        if y.is_checkmate() or (nb.is_capture(rp) and chk.see_capture(nb, rp) > 0):
            stood = True
    if text == 'Their move':
        if stood:
            return T('their reply %s already won before the try' % t['reply'])
        return U('their reply %s did not win before the try (the chip may name a danger still standing)' % t['reply'])
    if text == 'Safety check':
        if stood:
            return M('"Safety check": their reply %s already won before the try (their move)' % t['reply'])
        return T('the try let %s in' % t['reply'])
    return N()


def h_label_any(R, field, lb):
    return H3.h_label(R, lb['text'], lb)


def details_handler(R, text):
    fn, m = table(H3.DETAILS, text)
    if fn:
        return 'details', fn, m
    if H3.DETAIL_SKIP.match(text):
        return None, None, None
    pre = chess.Board(R.pre)
    gs = pre.san(chess.Move.from_uci(R.played)) if R.played else None
    bs = pre.san(chess.Move.from_uci(R.best)) if R.best else None
    if re.match(r'^(Their move|Your chances|Before you move|Nothing (forcing|happening|to take)|Ahead\?|Improve)', text):
        fn, m = table(H1.HINT, text)
        return ('check line', fn, m) if fn else (None, None, None)
    if re.match(r'^(Only move|Best): ', text) or re.search(r' missed it\.$', text) or re.search(r' (saves|keeps) your \w+\. .+ (lost|could lose) it\.$', text):
        fn, m = table(H2.SETTLED, text)
        return ('check line', fn, m) if fn else (None, None, None)
    if gs and (text.startswith(gs + ' ') or text.startswith('After ' + gs)):
        if text.startswith('After ' + gs + ', '):
            return 'details', h_details_after, re.match(r'^After (\S+), (.+?)( \((\d+)% to (\d+)%\))?\.$', text)
        return 'details', H3.h_classifier, None
    return 'details', H3.h_best_sentence, None


def h_details_after(R, m, text):
    band = H1.band_word(m.group(2), R.opp) if hasattr(H1, 'band_word') else None
    from claims import band_word, in_band, ev
    band = band_word(m.group(2), R.opp)
    a = chk.after(R.pre, R.played)
    e = ev(a.fen(), R.color, H1.DEEP)
    from claims import band_verdict
    if band:
        return band_verdict(e['win'], band, 'after the game move the player has %.0f%%' % e['win'])
    return T('player %.0f%%' % e['win'])


def claims_of(r, games, unread=None):
    """the claims on one frame: (Rec, field, text, type, handler, match); unread (a list) gets the strings
    no checker reads, as (field, text)"""
    R = Rec(r, games)
    out = []
    for field in ('row1', 'row2', 'cap', 'chip', 'tag'):
        text = r.get(field) or ''
        if not text:
            continue
        typ, tbl = classify(R, field, text)
        if not typ:
            if unread is not None:
                unread.append((field, text))
            continue
        fn, m = table(tbl, text)
        out.append((R, field, text, typ, fn, m))
    for lf in ('label0', 'label1'):
        lb = r.get(lf)
        if lb and lb.get('text'):
            out.append((R, 'label', lb['text'], 'label', ('LABEL', lb), None))
    for d in r.get('details') or []:
        if (R.key or '').startswith('pk:'):
            fn, m = table(H3.PRAC_DETAILS, d)
            if fn:
                out.append((R, 'details', d, 'practice details', fn, m))
            elif unread is not None and not H3.DETAIL_SKIP.match(d):
                unread.append(('details', d))
            continue
        typ, fn, m = details_handler(R, d)
        if typ:
            out.append((R, 'details', d, typ, fn, m))
        elif unread is not None and not H3.DETAIL_SKIP.match(d):
            unread.append(('details', d))
    return out


def sig(R, field, text, typ):
    c = R.ctx
    t = (c.get('tried') or {}).get('uci')
    g = (c.get('guess') or {}).get('uci')
    st = (R.step or {}).get('i')
    lb = ''
    if field == 'label':
        lb = R.shown
    fam = family(R.frame)
    if typ in ('reason', 'practice reason', 'verdict'):
        fam = re.sub(r'^(two tries: |game )', '', fam)
    return (R.r.get('pass'), R.tier, R.key, typ, field, text, t, g, st, c.get('solIdx'), lb, R.x.get('u'), fam if typ in ('settled', 'foil line', 'details', 'hint 1', 'hint 2', 'hint 3', 'game hint 1', 'game hint 2', 'forcing line', 'answer') else '')


def run_one(item):
    R, field, text, typ, fn, m = item
    try:
        if isinstance(fn, tuple) and fn[0] == 'LABEL':
            v = H3.h_label(R, text, fn[1])
        elif fn is None:
            v = U('form not read')
        else:
            v = fn(R, m, text)
    except Exception as e:
        v = ('error', '%s: %s' % (type(e).__name__, traceback.format_exc().splitlines()[-3:]))
    return v


ctx_hash = cfg.ctx_hash


def claim_id(k):
    return hashlib.sha1(json.dumps(k, sort_keys=True, default=str).encode()).hexdigest()[:16]


def items_of(pas, keys=None, only=None, unread=None):
    """the distinct claims of a pass's dumps (sig, as the audit dedupes them), in dump order: ([(item, sig)],
    {sig: how many more times the same claim shows}); unread (a list) gets the strings no checker reads"""
    items, seen, dup = [], {}, collections.Counter()
    G = games()
    for which in cfg.DUMPS[pas]:
        fn = cfg.out('dump-%s.jsonl' % which)
        if not os.path.exists(fn):
            sys.exit('no dump %s (run node test/truth/gate.js --pass %s first)' % (fn, pas))
        with open(fn) as f:
            for line in f:
                r = json.loads(line)
                if r.get('frame', '').startswith('screen'):
                    continue
                if keys and r.get('key') not in keys:
                    continue
                ur = [] if unread is not None else None
                for it in claims_of(r, G, ur):
                    if only and it[3] != only:
                        continue
                    k = sig(it[0], it[1], it[2], it[3])
                    if k in seen:
                        dup[k] += 1
                        continue
                    seen[k] = len(items)
                    items.append(it)
                if ur:
                    for field, text in ur:
                        unread.append((r, field, text))
    return [(it, sig(it[0], it[1], it[2], it[3])) for it in items], dup


def load_pdata():
    fn = cfg.out('pdata.json')
    if os.path.exists(fn):
        with open(fn) as f:
            for pid, row in json.load(f).items():
                H1.PRAC_SKILL[pid] = row['skill']


def row_of(it, k, dups, v):
    R, field, text, typ = it[0], it[1], it[2], it[3]
    c = R.ctx
    return {'id': claim_id(k), 'pass': R.r.get('pass'), 'tier': R.tier, 'key': R.key, 'frame': R.frame, 'field': field, 'type': typ,
            'text': text, 'verdict': v[0], 'note': v[1], 'tried': (c.get('tried') or {}).get('uci'), 'reply': (c.get('tried') or {}).get('reply'),
            'step': (R.step or {}).get('i'), 'u': R.x.get('u'), 'dups': dups, 'shown': R.shown, 'pre': c.get('pre'), 'st': c.get('st'),
            'ctx': ctx_hash(R.r, field, text)}


def main():
    p = cfg.parser('The truth audit\'s first pass')
    p.add_argument('--pass', dest='pas', required=True, choices=cfg.PASSES)
    p.add_argument('--threads', type=int, default=2, help='Stockfish processes (default 2)')
    p.add_argument('--nodes', type=int, default=1000000)
    p.add_argument('--keys', default='', help='only these card keys (comma separated)')
    p.add_argument('--type', default='', help='only claims of this type')
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--coverage', action='store_true', help='only write unread-<pass>.json (no engine)')
    a = cfg.setup(p.parse_args())
    cfg.budget(a.nodes)
    load_pdata()
    keys = set(x for x in a.keys.split(',') if x) or None
    unread = []
    items, dup = items_of(a.pas, keys, a.type or None, unread)
    if a.limit:
        items = items[:a.limit]
    print('%s: %d claims to check at %d nodes' % (a.pas, len(items), a.nodes), file=sys.stderr)
    # the strings no checker reads, by template, for the summary's coverage list (a string read on
    # another frame of the same card, tier and board, as row 2 again under Details, is read)
    read = set((it[0].key, it[0].tier, it[1], it[2], it[0].shown) for it, k in items)
    cov = {}
    for r, field, text in unread:
        if (r.get('key'), r.get('tier'), field, text, r.get('shown')) in read:
            continue
        g = '%s | %s' % (field, cfg.template(text))
        e = cov.setdefault(g, {'n': 0, 'example': text, 'key': r.get('key'), 'tier': r.get('tier'), 'frame': r.get('frame')})
        e['n'] += 1
    with open(cfg.out('unread-%s.json' % a.pas), 'w') as f:
        json.dump(cov, f, indent=0, sort_keys=True)
    if a.coverage:
        return
    # a new first pass: the recheck stages of the last one no longer apply
    for fn in os.listdir(cfg.OUT):
        if re.match(r'^deep-%s-\d+\.jsonl$' % a.pas, fn):
            os.remove(cfg.out(fn))
    out = open(cfg.out('results-%s.jsonl' % a.pas), 'w')
    lock = threading.Lock()
    done = [0]

    def work(x):
        it, k = x
        v = run_one(it)
        with lock:
            out.write(json.dumps(row_of(it, k, dup.get(k, 0), v)) + '\n')
            done[0] += 1
            if done[0] % 500 == 0:
                out.flush()
                print('  %d of %d %s' % (done[0], len(items), sf.stats), file=sys.stderr)
    with ThreadPoolExecutor(a.threads) as ex:
        list(ex.map(work, items))
    out.close()
    print('%s: done %s' % (a.pas, sf.stats), file=sys.stderr)


if __name__ == '__main__':
    main()
