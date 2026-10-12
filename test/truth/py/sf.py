"""The checkout's own Stockfish 17.1 (sf/stockfish.js under Node) for the checkers: one engine per thread,
each search after ucinewgame with one thread and 32 MB of hash (so a question always gets the same
answer), and a JSON-lines cache in the output folder kept per engine build (cache/py-<hash>.jsonl).
go(fen, nodes, multipv, searchmoves) -> {'best': uci, 'depth': d, 'lines': [{'cp', 'mate', 'pv', 'depth'}]},
scores from the side to move, as UCI prints them; the lines are the deepest iteration that reported
every line. configure(root, out) first (cfg.setup does it)."""
import json, os, re, subprocess, threading

ENGINE = None
CACHE = None
_lock = threading.Lock()
_cache = None
_out = None
_local = threading.local()
stats = {'hits': 0, 'runs': 0}


def configure(root, out):
    global ENGINE, CACHE, _cache, _out
    import cfg
    ENGINE = ['node', os.path.join(root, 'sf', 'stockfish.js')]
    os.makedirs(os.path.join(out, 'cache'), exist_ok=True)
    CACHE = os.path.join(out, 'cache', 'py-%s.jsonl' % cfg.engine_hash(root))
    _cache, _out = None, None


def _load():
    global _cache, _out
    if _cache is not None:
        return
    _cache = {}
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            for line in f:
                try:
                    x = json.loads(line)
                    _cache[x['k']] = x['v']
                except Exception:
                    pass
    _out = open(CACHE, 'a')


def set_cap(n):
    _local.cap = n


class Engine:
    def __init__(self):
        self.p = subprocess.Popen(ENGINE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.send('uci')
        self.until(lambda l: l == 'uciok')
        self.send('setoption name Threads value 1')
        self.send('setoption name Hash value 32')
        self.mpv = 1
        self.send('isready')
        self.until(lambda l: l == 'readyok')

    def send(self, s):
        self.p.stdin.write(s + '\n')
        self.p.stdin.flush()

    def until(self, pred, each=None):
        while True:
            l = self.p.stdout.readline()
            if not l:
                raise RuntimeError('engine died')
            l = l.strip()
            if each:
                each(l)
            if pred(l):
                return l

    def go(self, fen, nodes, multipv=1, searchmoves=None):
        if multipv != self.mpv:
            self.send('setoption name MultiPV value %d' % multipv)
            self.mpv = multipv
        self.send('ucinewgame')
        self.send('isready')
        self.until(lambda l: l == 'readyok')
        self.send('position fen ' + fen)
        by_depth, latest = {}, {}

        def each(l):
            if not l.startswith('info ') or ' score ' not in l or ' lowerbound' in l or ' upperbound' in l:
                return
            if ' pv ' not in l and 'score mate 0' not in l:
                return
            k = int((re.search(r' multipv (\d+)', l) or [0, 1])[1])
            d = int((re.search(r' depth (\d+)', l) or [0, 0])[1])
            sc = re.search(r' score (cp|mate) (-?\d+)', l)
            pv = re.search(r' pv (.+)$', l)
            x = {'depth': d, 'cp': int(sc.group(2)) if sc.group(1) == 'cp' else None,
                 'mate': int(sc.group(2)) if sc.group(1) == 'mate' else None, 'pv': pv.group(1).split() if pv else []}
            latest[k] = x
            by_depth.setdefault(d, {})[k] = x
        self.send('go nodes %d' % nodes + (' searchmoves ' + ' '.join(searchmoves) if searchmoves else ''))
        bm = self.until(lambda l: l.startswith('bestmove'), each)
        want = len(latest)
        blk = latest
        for d in sorted(by_depth, reverse=True):
            if len(by_depth[d]) >= want:
                blk = by_depth[d]
                break
        lines, seen = [], set()
        for k in sorted(blk):
            x = blk[k]
            f = x['pv'][0] if x['pv'] else ''
            if f in seen:
                continue
            seen.add(f)
            lines.append(x)
        return {'best': bm.split()[1] if len(bm.split()) > 1 else None, 'depth': latest[1]['depth'] if 1 in latest else 0, 'lines': lines}


def go(fen, nodes=1000000, multipv=1, searchmoves=None):
    cap = getattr(_local, 'cap', None)
    if cap:
        nodes = min(nodes, cap)
    key = '|'.join([fen, str(nodes), str(multipv), ','.join(searchmoves or [])])
    with _lock:
        _load()
        if key in _cache:
            stats['hits'] += 1
            return _cache[key]
    eng = getattr(_local, 'eng', None)
    if eng is None:
        eng = _local.eng = Engine()
    r = eng.go(fen, nodes, multipv, searchmoves)
    with _lock:
        _cache[key] = r
        _out.write(json.dumps({'k': key, 'v': r}) + '\n')
        _out.flush()
        stats['runs'] += 1
    return r
