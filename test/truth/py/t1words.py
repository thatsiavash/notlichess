"""Tier 1's Details lines are tier 2's in words (detailsWords: a move in words, a capturing move as its
piece, "White's" as "their", no figure; v2 slice 2). A tier 1 Details line no checker could read takes
the final verdict of the tier 2 line it was made from: same pass, card and frame, the same sentence once
moves are one token (words and SAN alike), the same squares in the same order; else the same line on any
tier 2 frame of the card, where every such line has one verdict. pair(rows) applies it (final.py)."""
import collections, re

PIECE = r'(?:king|queen|rook|bishop|knight|pawn)'
WORDS = r'\b' + PIECE + r'(?: from ([a-h][1-8]))? (?:to|takes on) ([a-h][1-8])(?: to make a ' + PIECE + r')?|\bcastling(?: on the (?:king|queen)\'s side)?'
SAN = r'(?<![A-Za-z0-9])(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?([a-h][1-8])(?:=[QRBN])?|[a-h]x([a-h][1-8])(?:=[QRBN])?|([a-h][1-8])(?:=[QRBN])?)[+#]?(?![A-Za-z0-9])'


def norm(s):
    s = re.sub(r'\. Your chances: \d+% before, \d+% after\.', '.', s)
    s = re.sub(r' \(\d+% to \d+%\)', '', s)
    s = re.sub(r'\b(White|Black)\'s\b', 'their', s)
    return s


def t1_form(s):
    """(skeleton, squares) of a tier 1 line"""
    s = norm(s)
    sq = []
    keep = []

    def mw(m):
        sq.append(m.group(2) or 'O-O')
        return 'M'
    # squares outside moves first ("the pawn on c3", "the c7 pawn"), in order with the moves
    out, i = [], 0
    for m in re.finditer(WORDS + r'|\bon ([a-h][1-8])\b|\bthe ([a-h][1-8]) pawn\b', s, flags=re.I):
        out.append(s[i:m.start()])
        if m.group(3) or m.group(4):
            q = m.group(3) or m.group(4)
            sq.append(q)
            out.append(m.group(0).replace(q, 'S'))
        else:
            sq.append(m.group(2) or 'O-O')
            out.append('M')
        i = m.end()
    out.append(s[i:])
    s = ''.join(out)
    s = re.sub(r'\b(?:your|their) ' + PIECE + r'(?= (?:takes|is strong|could take|forks))', 'M', s, flags=re.I)
    return tidy(s), sq


def t2_form(s):
    s = norm(s)
    sq = []
    out, i = [], 0
    for m in re.finditer(SAN + r'|\bon ([a-h][1-8])\b|\bthe ([a-h][1-8]) pawn\b', s):
        if m.group(0).startswith('on ') or m.group(0).startswith('the '):
            q = m.group(4) or m.group(5)
            out.append(s[i:m.start()])
            out.append(m.group(0).replace(q, 'S'))
            sq.append(q)
            i = m.end()
            continue
        out.append(s[i:m.start()])
        out.append('M')
        # a capturing move said as its piece at tier 1 ("their knight takes") names no square
        if not re.match(r' (?:takes|is strong|could take|forks)', s[m.end():]):
            sq.append(m.group(1) or m.group(2) or m.group(3) or 'O-O')
        i = m.end()
    out.append(s[i:])
    return tidy(''.join(out)), sq


def tidy(s):
    s = re.sub(r'M(?:,? M)+', 'M+', s)
    s = re.sub(r'^m\b', 'M', s)
    return s[:1].upper() + s[1:]


def pair(rows):
    """rows: one pass's claims with their final check verdicts; each tier 1 Details row left untestable
    takes the verdict of its tier 2 line. Returns (paired, unpaired) counts."""
    t2 = collections.defaultdict(list)
    for r in rows:
        if r['tier'] == 2 and r['field'] == 'details':
            t2[(r['pass'], r['key'], r['frame'])].append(r)
    forms = {}

    def f2(r):
        if r['id'] not in forms:
            forms[r['id']] = t2_form(r['text'])
        return forms[r['id']]
    n = collections.Counter()
    for r in rows:
        if r['tier'] != 1 or r['field'] != 'details' or r['verdict'] != 'untestable':
            continue
        want = t1_form(r['text'])
        hits = [x for x in t2.get((r['pass'], r['key'], r['frame']), []) if f2(x) == want]
        if not hits:
            alls = [x for (p_, k_, f_), xs in t2.items() if p_ == r['pass'] and k_ == r['key'] for x in xs if f2(x) == want]
            if alls and len(set(x['verdict'] for x in alls)) == 1:
                hits = alls[:1]
        if not hits:
            n['unpaired'] += 1
            continue
        x = hits[0]
        r['verdict'], r['note'] = x['verdict'], 'tier 1 words of the tier 2 line "%s" (%s): %s' % (x['text'], x['frame'], x['note'])
        r['t1words'] = x['id']
        n['paired'] += 1
    return n['paired'], n['unpaired']
