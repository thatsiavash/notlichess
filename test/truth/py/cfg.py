"""What the truth audit's checkers share: the checkout audited (--root, default the one this file is in),
the output folder (--out, outside the repo: dumps, results, the engine's cache), the reviewed files read
from the checkout (adjudications.json, accepted.md), and budget(n), which sets every Stockfish node
budget of the checks to n (the first pass at 1,000,000, the rechecks at 4,000,000 and 8,000,000)."""
import argparse, hashlib, json, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
OWN = os.path.dirname(HERE)  # test/truth of the checkout this harness is in
ROOT = None
OUT = None
PASSES = ('live', 'stored', 'practice')
# the dumps each pass reads (the practice pass's records say pass 'screens', as the audit's did)
DUMPS = {'live': ('live', 'live-game'), 'stored': ('stored', 'stored-game'), 'practice': ('practice',)}


def parser(desc):
    p = argparse.ArgumentParser(description=desc)
    p.add_argument('--root', default=os.path.dirname(os.path.dirname(OWN)), help='the checkout audited (default: this one)')
    p.add_argument('--out', required=True, help='the output folder, outside the repo')
    return p


def setup(a):
    global ROOT, OUT
    ROOT = os.path.realpath(a.root)
    OUT = os.path.realpath(a.out)
    if not os.path.isdir(OUT):
        sys.exit('no output folder %s (run node test/truth/gate.js first)' % OUT)
    import sf
    sf.configure(ROOT, OUT)
    return a


def engine_hash(root):
    """the engine's files, hashed: the caches are kept per engine build"""
    h = hashlib.sha1()
    for f in ('stockfish.js', 'stockfish.wasm'):
        with open(os.path.join(root, 'sf', f), 'rb') as x:
            h.update(x.read())
    return h.hexdigest()[:12]


def reviewed(name):
    """a reviewed file (adjudications.json, accepted.md): the checkout's own, else this harness's"""
    for d in (os.path.join(ROOT, 'test', 'truth'), OWN):
        fn = os.path.join(d, name)
        if os.path.exists(fn):
            return fn
    return None


def out(name):
    return os.path.join(OUT, name)


def jsonl(name):
    fn = out(name)
    if not os.path.exists(fn):
        return []
    with open(fn) as f:
        return [json.loads(l) for l in f if l.strip()]


def budget(n):
    """every node budget of the checks set to n: the modules' DEEP, MID and LIGHT, and the budgets bound
    as default arguments (two(..., nodes=DEEP), eval_side(fen, nodes=1000000), mate_lines(fen, nodes=DEEP))"""
    import chk, claims, handlers, handlers2, handlers3, handlers_v1
    mods = (claims, handlers, handlers2, handlers3, handlers_v1)
    for mod in mods:
        for name in ('DEEP', 'MID', 'LIGHT'):
            if hasattr(mod, name):
                setattr(mod, name, n)
    for mod in mods + (chk,):
        for fn in list(vars(mod).values()):
            if isinstance(fn, types.FunctionType) and fn.__defaults__ and fn.__module__ == mod.__name__:
                fn.__defaults__ = tuple(n if isinstance(d, int) and not isinstance(d, bool) and d >= 100000 else d for d in fn.__defaults__)


SAN = r'(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?'
MW = r'\b(?:king|queen|rook|bishop|knight|pawn)(?: from [a-h][1-8])? (?:to|takes on) [a-h][1-8](?: to make a (?:queen|rook|bishop|knight))?|\bcastling\b'


def template(s):
    """a string's form: moves M (SAN or words MW), pieces P, squares S, piece glyphs L, numbers N, sides C"""
    import re
    s = re.sub(r'\bopponent\d+\b', 'OPP', s)
    s = re.sub(MW, 'MW', s, flags=re.I)
    s = re.sub(r'(?<![A-Za-z])' + SAN + r'(?![A-Za-z0-9])', 'M', s)
    s = re.sub(r'(?<![A-Za-z])[A-H](?:x[a-h])?[1-8][+#]?(?![A-Za-z0-9])', 'M', s)
    s = re.sub(r'\b(?:kings?|queens?|rooks?|bishops?|knights?|pawns?)\b', 'P', s, flags=re.I)
    s = re.sub(r'\b[a-h][1-8]\b', 'S', s)
    s = re.sub(r'[♔-♟]+', 'L', s)
    s = re.sub(r'\d+', 'N', s)
    s = re.sub(r'\b(White|Black)\b', 'C', s)
    return s


def nodes_word(n):
    """4000000 -> '4M', 300000 -> '300k'"""
    return ('%gM' % (n / 1e6)) if n >= 1000000 else ('%gk' % (n / 1e3))


CTX_FIELDS = ('pre', 'st', 'played', 'best', 'sol', 'solIdx', 'yours', 'yoursAt', 'near', 'slips', 'revealed', 'hints', 'misses', 'view', 'settle')


def ctx_hash(r, field, text):
    """everything a claim on this frame is read against: the boards, the moves, the try and its reply,
    the guess, the See why step, the frame. An adjudication holds only while this is unchanged."""
    c = r.get('ctx') or {}
    t = c.get('tried') or {}
    st = r.get('step') or {}
    lb = next((x for x in (r.get('label0'), r.get('label1')) if x and x.get('text') == text), None) if field == 'label' else None
    key = [r.get('pass'), r.get('tier'), r.get('key'), r.get('frame'), field, text, r.get('shown'),
           [c.get(k) for k in CTX_FIELDS], t.get('uci'), t.get('reply'), t.get('kind'), (c.get('guess') or {}).get('uci'),
           st.get('i'), st.get('move'), st.get('before'), (r.get('x') or {}).get('u'), (lb or {}).get('mark')]
    return hashlib.sha1(json.dumps(key, sort_keys=True).encode()).hexdigest()[:16]
