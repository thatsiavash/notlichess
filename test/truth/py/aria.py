"""The board's name (its aria-label, read out by a screen reader): every sentence that says something
about the board, read on the board it names (python-chess, no engine). Writes aria-<pass>.json (counts
by verdict) and aria-<pass>.jsonl (each false, misleading or untestable sentence, once per board).
python3 test/truth/py/aria.py --out DIR --pass live|stored|practice [--root DIR] [--keys k1,k2]"""
import json, os, re, sys, collections
sys.dont_write_bytecode = True  # keep the checkout clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess, chk, cfg

PW = r'(pawn|knight|bishop|rook|queen|king|piece)'
SQ = r'([a-h][1-8])'


def piece_is(b, sq, word):
    p = b.piece_at(chess.parse_square(sq))
    return p is not None and (word == 'piece' or chk.PNAME[p.piece_type] == word)


def _mates(b, y):
    x = b.copy()
    x.push(y)
    return x.is_checkmate()


def check_sentence(s, b, r):
    c = r.get('ctx') or {}
    white = c.get('white')
    me = chess.WHITE if white else chess.BLACK
    m = re.match(r'^(White|Black) to move\.$', s)
    if m:
        return 'true' if (b.turn == chess.WHITE) == (m.group(1) == 'White') else 'false', ''
    m = re.match(r'^Red arrow: your game move, ' + PW + ' ' + SQ + ' to ' + SQ + r'\.$', s)
    if m:
        ok = c.get('played', '')[:4] == m.group(2) + m.group(3)
        return ('true' if ok else 'false'), 'game move %s' % c.get('played')
    m = re.match(r'^Dashed red arrow: (after your game move, )?the ' + PW + ' on ' + SQ + ' (can|could) (take on|give check on|go to) ' + SQ + r'\.$', s)
    if m:
        x = chess.Board(c['pre']) if m.group(1) else b.copy()
        if m.group(1):
            x.push(chess.Move.from_uci(c['played']))
        f, t = chess.parse_square(m.group(3)), chess.parse_square(m.group(6))
        p = x.piece_at(f)
        if not p or (m.group(2) != 'piece' and chk.PNAME[p.piece_type] != m.group(2)):
            return 'false', 'no %s on %s' % (m.group(2), m.group(3))
        if x.turn != p.color:
            # the arrow's piece moves next: a null move (an en passant square stands only for the side to move)
            x.turn = p.color
            x.ep_square = None
        mv = [y for y in x.legal_moves if y.from_square == f and y.to_square == t]
        if not mv:
            return 'false', '%s%s is not legal for it' % (m.group(3), m.group(6))
        if m.group(5) == 'take on' and not x.is_capture(mv[0]):
            return 'false', 'takes nothing'
        if m.group(5) == 'give check on' and not x.gives_check(mv[0]):
            return 'false', 'no check'
        return 'true', ''
    m = re.match(r'^Dashed red arrow: after both your tries, the ' + PW + ' on ' + SQ + ' could (give checkmate on|take on|go to) ' + SQ + r'\.$', s)
    if m:
        # the two tries of one showing: the game move, then the try the frame names ("two tries: <uci>")
        tw = re.match(r'^two tries: (\S+)', r.get('frame') or '')
        if not tw or not c.get('played') or not c.get('st'):
            return 'untestable', 'both tries'
        f, t = chess.parse_square(m.group(2)), chess.parse_square(m.group(4))
        res = []
        for u in (c['played'], tw.group(1)):
            x = chess.Board(c['st'])
            x.push(chess.Move.from_uci(u))
            p = x.piece_at(f)
            mv = [y for y in x.legal_moves if y.from_square == f and y.to_square == t] if p and p.color == x.turn else []
            ok = bool(mv) and (m.group(3) == 'go to' or (m.group(3) == 'take on' and x.is_capture(mv[0])) or (m.group(3) == 'give checkmate on' and any(_mates(x, y) for y in mv)))
            res.append((u, ok))
        return ('true' if all(ok for u, ok in res) else 'false'), 'after each try: %s' % res
    m = re.match(r'^Red ring: your ' + PW + ' on ' + SQ + r' is in danger\.$', s)
    if m:
        if not piece_is(b, m.group(2), m.group(1)):
            return 'false', 'no %s on %s' % (m.group(1), m.group(2))
        sq = chess.parse_square(m.group(2))
        if chk.in_danger(b, sq):
            return 'true', ''
        return ('misleading' if chk.attackers_legal(b, sq) else 'false'), 'attacked: %s, but taking it does not pay' % bool(chk.attackers_legal(b, sq))
    m = re.match(r'^Red ring: they could checkmate on ' + SQ + r'\.$', s)
    if m:
        x = chk.null(b) if b.turn == me else b
        ms = [y for y in chk.mates_in_one(x) if chess.square_name(y.to_square) == m.group(1)]
        if ms:
            return 'true', 'their mates there now: %s' % [y.uci() for y in ms]
        # the danger the card is about: their mate there after the game move (as finding 16's red ring)
        if c.get('pre') and c.get('played'):
            y = chess.Board(c['pre'])
            y.push(chess.Move.from_uci(c['played']))
            mg = [z for z in chk.mates_in_one(y) if chess.square_name(z.to_square) == m.group(1)]
            if mg:
                return 'misleading', 'no mate there on the board shown; only after the game move (%s), which the sentence does not say' % [z.uci() for z in mg]
        return 'untestable', 'no mate there now, nor after the game move'
    m = re.match(r'^Gold ring: your ' + PW + ' on ' + SQ + r' blocks their mate\.$', s)
    if m:
        x = chk.null(b) if b.turn == me else b.copy()
        x.remove_piece_at(chess.parse_square(m.group(2)))
        return ('true' if chk.mates_in_one(x) else 'false'), ''
    m = re.match(r'^Dashed gold ring: the ' + PW + ' on ' + SQ + r' is there to win\.$', s)
    if m:
        p = b.piece_at(chess.parse_square(m.group(2)))
        return ('true' if p and p.color != me else 'false'), '(the win itself is the settled line\'s claim)'
    m = re.match(r'^Red squares: (.+)\. A move there loses\.$', s)
    if m:
        return 'see-hint3', ''
    m = re.match(r'^Your ' + PW + ' was taken on ' + SQ + r'\.$', s)
    if m:
        return 'token', ''
    m = re.match(r'^Green dots: the ' + PW + ' on ' + SQ + ' guards ' + SQ + r'\.$', s)
    if m:
        g, t = chess.parse_square(m.group(2)), chess.parse_square(m.group(3))
        p = b.piece_at(g)
        return ('true' if p and g in b.attackers(p.color, t) else 'false'), ''
    m = re.match(r'^The (white|black) king is in check\.$', s)
    if m:
        return ('true' if b.is_check() and (b.turn == chess.WHITE) == (m.group(1) == 'white') else 'false'), ''
    m = re.match(r'^Gold ring: move the ' + PW + ' on ' + SQ + r'\.$', s)
    if m:
        due = c.get('best') or c.get('lessonMove')
        sol, i = c.get('sol') or [], c.get('solIdx') or 0
        if sol and 0 < i < len(sol):
            due = sol[i]
        return ('true' if due and due[:2] == m.group(2) else 'false'), 'answer %s' % due
    return None, ''


def main():
    p = cfg.parser('The board descriptions\' check')
    p.add_argument('--pass', dest='pas', required=True, choices=cfg.PASSES)
    p.add_argument('--keys', default='')
    a = cfg.setup(p.parse_args())
    keys = set(x for x in a.keys.split(',') if x) or None
    out = open(cfg.out('aria-%s.jsonl' % a.pas), 'w')
    seen = set()
    cnt = collections.Counter()
    for which in cfg.DUMPS[a.pas]:
        with open(cfg.out('dump-%s.jsonl' % which)) as f:
            for line in f:
                r = json.loads(line)
                aria = r.get('aria') or ''
                if not aria or not r.get('shown') or (keys and r.get('key') not in keys):
                    continue
                b = chess.Board(r['shown'])
                for s in re.split(r'(?<=\.) (?=[A-Z])', aria):
                    k = (which, r.get('tier'), r.get('key'), s, r['shown'])
                    if k in seen:
                        continue
                    seen.add(k)
                    try:
                        v, note = check_sentence(s, b, r)
                    except Exception as e:
                        v, note = 'error', str(e)
                    if v is None:
                        continue
                    cnt[v] += 1
                    if v in ('false', 'misleading', 'error', 'untestable'):
                        out.write(json.dumps({'pass': r.get('pass'), 'tier': r.get('tier'), 'key': r.get('key'), 'frame': r.get('frame'), 'field': 'aria', 'text': s, 'verdict': v, 'note': note, 'shown': r['shown'], 'ctx': cfg.ctx_hash(r, 'aria', s)}) + '\n')
    out.close()
    with open(cfg.out('aria-%s.json' % a.pas), 'w') as f:
        json.dump(dict(cnt), f)
    print('%s board descriptions: %s' % (a.pas, dict(cnt)), file=sys.stderr)


if __name__ == '__main__':
    main()
