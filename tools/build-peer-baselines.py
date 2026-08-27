#!/usr/bin/env python3
"""
Build peer baselines from the Lichess open database (CC0).

Reads a decompressed PGN stream on stdin and aggregates, per (speed, rating
band), the handful of numbers the launcher needs to say "against players at
your rating" instead of "against your own other formats".

Every observation is player-centric: each game contributes two rows, one per
side, banded by that player's own Elo. That is what makes the output answer
"what does a 1700 do" rather than "what happens in 1700 games".

Usage:  curl … | zstd -dc | python3 baselines.py OUT.json [MAX_GAMES]
"""
import sys, json, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else 'baselines.json'
MAX_GAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 0

SPEEDS = ('Bullet', 'Blitz', 'Rapid', 'Classical')
BAND_LO, BAND_HI, BAND_W = 800, 2400, 100


def band(elo):
    if elo < BAND_LO:
        return BAND_LO
    if elo >= BAND_HI:
        return BAND_HI
    return (elo // BAND_W) * BAND_W


def new_cell():
    return {
        'n': 0, 'win': 0, 'loss': 0, 'draw': 0,
        'flag': 0,              # lost on time
        'resign': 0,            # lost by resignation
        'clk_n': 0, 'clk_sum': 0.0,   # % of own clock left when losing
        'ply_n': 0, 'ply_sum': 0,
        'ev_n': 0, 'acpl_sum': 0.0,   # from the analysed subset only
        'conv_chance': 0, 'conv_won': 0,     # reached +2 → won
        'res_chance': 0, 'res_saved': 0,     # fell to -2 → did not lose
        # colour split — White scores better everywhere, so a colour finding
        # needs a colour-specific baseline or it flags Black by construction
        'w_n': 0, 'w_win': 0, 'b_n': 0, 'b_win': 0,
        # centipawn loss by stage of the game, bucketed by move number
        'o_n': 0, 'o_sum': 0.0, 'm_n': 0, 'm_sum': 0.0, 'e_n': 0, 'e_sum': 0.0,
        'opp_sum': 0,                 # opponent rating minus own
        'analysed': 0,                # games this player had computer-analysed
        # Tutor-grade additions
        'acc_n': 0, 'acc_sum': 0.0,          # Lichess accuracy%, game means
        'ta_n': 0, 'ta_sum': 0.0,            # accuracy on the move after an opp mistake
        'po_n': 0, 'po_sum': 0.0,            # phase accuracy%: opening
        'pm_n': 0, 'pm_sum': 0.0,            #                  middlegame
        'pe_n': 0, 'pe_sum': 0.0,            #                  endgame
        'spd_n': 0, 'spd_sum': 0.0,          # mean % clock remaining across moves
        'pc': {},                            # per-piece: {P:[drop_sum,n],...}
    }


cells = collections.defaultdict(new_cell)
openings = collections.defaultdict(lambda: {'wn': 0, 'ww': 0, 'bn': 0, 'bw': 0})


def oband(elo):
    """Coarse bands for openings: four buckets hold far more games each and
    opening results move slowly with rating."""
    if elo < 1200: return 1000
    if elo < 1600: return 1400
    if elo < 2000: return 1800
    return 2200

hdr = {}
games = 0
skipped = 0


def clk_seconds(s):
    # "0:05:00" or "1:02:03.5"
    try:
        parts = s.split(':')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except Exception:
        return None


def last_two_clocks(mt):
    """Final clock reading for each side, without walking the whole movetext."""
    i = mt.rfind('[%clk ')
    if i < 0:
        return None, None
    a = clk_seconds(mt[i + 6:mt.find(']', i)])
    j = mt.rfind('[%clk ', 0, i)
    b = clk_seconds(mt[j + 6:mt.find(']', j)]) if j >= 0 else None
    return a, b


def eval_series(mt):
    """Centipawns from White's point of view, one per ply, capped."""
    out = []
    pos = mt.find('[%eval ')
    while pos >= 0:
        end = mt.find(']', pos)
        tok = mt[pos + 7:end].strip()
        if tok.startswith('#'):
            try:
                cp = 1500 if int(tok[1:]) > 0 else -1500
            except ValueError:
                cp = 0
        else:
            try:
                cp = int(float(tok) * 100)
            except ValueError:
                cp = 0
        out.append(max(-1500, min(1500, cp)))
        pos = mt.find('[%eval ', end)
    return out


import math
def winp(cp):
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)
def move_acc(wb, wa):
    if wa >= wb: return 100.0
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * (wb - wa)) - 3.1669))

def record(sp, elo, opp_elo, res_for_me, term, my_last_clk, initial, plies,
           evals, my_colour, mt=None, clks=None):
    c = cells[(sp, band(elo))]
    c['n'] += 1
    if res_for_me == 1:
        c['win'] += 1
    elif res_for_me == 0:
        c['loss'] += 1
    else:
        c['draw'] += 1

    if res_for_me == 0:
        if term == 'Time forfeit':
            c['flag'] += 1
        elif term == 'Normal':
            c['resign'] += 1
        if my_last_clk is not None and initial:
            c['clk_n'] += 1
            c['clk_sum'] += max(0.0, min(1.0, my_last_clk / initial)) * 100.0

    c['ply_n'] += 1
    c['ply_sum'] += plies
    if clks is not None and initial:
        mine_c = [clks[i] for i in range(16, len(clks)) if (i % 2 == 0) == (my_colour == 'w')]
        if len(mine_c) >= 5:
            c['spd_n'] += 1
            c['spd_sum'] += sum(max(0.0, min(1.0, x / initial)) for x in mine_c) / len(mine_c) * 100
    c['opp_sum'] += (opp_elo - elo)
    if my_colour == 'w':
        c['w_n'] += 1
        c['w_win'] += 1 if res_for_me == 1 else 0
    else:
        c['b_n'] += 1
        c['b_win'] += 1 if res_for_me == 1 else 0
    if evals:
        c['analysed'] += 1

    if evals:
        sign = 1 if my_colour == 'w' else -1
        loss_sum, loss_n = 0.0, 0
        stage = []
        prev = 20
        best, worst = -10000, 10000
        for i, cp in enumerate(evals):
            mover_white = (i % 2 == 0)
            if mover_white == (my_colour == 'w'):
                d = (prev - cp) if my_colour == 'w' else (cp - prev)
                d = max(0, min(1000, d))
                loss_sum += d
                loss_n += 1
                stage.append((i, d))
            mine = cp * sign
            best = max(best, mine)
            worst = min(worst, mine)
            prev = cp
        if loss_n >= 5:
            c['ev_n'] += 1
            c['acpl_sum'] += loss_sum / loss_n
            # Lichess-accuracy per move, aggregated as a game mean + phases + TA
            accs, ph_acc = [], {'o': [], 'm': [], 'e': []}
            ta = []
            prev_cp = 20
            prev_opp_drop = False
            my_white = my_colour == 'w'
            for i, cp in enumerate(evals):
                mover_white = (i % 2 == 0)
                wb = winp(prev_cp if my_white else -prev_cp)
                wa = winp(cp if my_white else -cp)
                if mover_white == my_white:
                    a = move_acc(wb, wa)
                    accs.append(a)
                    ph_acc['o' if i < 30 else ('m' if i < 60 else 'e')].append(a)
                    if prev_opp_drop:
                        ta.append(a)
                else:
                    # did the opponent just blunder? (their move cost them >= 10 winP)
                    owb = winp(-prev_cp if my_white else prev_cp)
                    owa = winp(-cp if my_white else cp)
                    prev_opp_drop = (owb - owa) >= 10
                prev_cp = cp
            if accs:
                c['acc_n'] += 1
                c['acc_sum'] += sum(accs) / len(accs)
            for key2, lst in (('po', ph_acc['o']), ('pm', ph_acc['m']), ('pe', ph_acc['e'])):
                if len(lst) >= 3:
                    c[key2 + '_n'] += 1
                    c[key2 + '_sum'] += sum(lst) / len(lst)
            if len(ta) >= 2:
                c['ta_n'] += 1
                c['ta_sum'] += sum(ta) / len(ta)
            # per-piece mean winP drop (my moves), from the SAN tokens
            if mt is not None:
                toks = mt
                prev_cp2 = 20
                for i, cp in enumerate(evals):
                    if i >= len(toks): break
                    if (i % 2 == 0) == my_white:
                        wb2 = winp(prev_cp2 if my_white else -prev_cp2)
                        wa2 = winp(cp if my_white else -cp)
                        t0 = toks[i][0]
                        piece = t0 if t0 in 'NBRQK' else ('K' if t0 == 'O' else 'P')
                        d2 = max(0.0, wb2 - wa2)
                        pc = c['pc'].setdefault(piece, [0.0, 0])
                        pc[0] += d2; pc[1] += 1
                    prev_cp2 = cp
            for key, (lo, hi) in (('o', (0, 30)), ('m', (30, 60)), ('e', (60, 10000))):
                sub = [x for x in stage if lo <= x[0] < hi]
                if len(sub) >= 3:
                    c[key + '_n'] += 1
                    c[key + '_sum'] += sum(x[1] for x in sub) / len(sub)
            if best >= 200:
                c['conv_chance'] += 1
                if res_for_me == 1:
                    c['conv_won'] += 1
            if worst <= -200:
                c['res_chance'] += 1
                if res_for_me != 0:
                    c['res_saved'] += 1


for line in sys.stdin:
    if line.startswith('['):
        # [Key "Value"]
        sp = line.find(' ')
        key = line[1:sp]
        val = line[sp + 2:line.rfind('"')]
        hdr[key] = val
        continue
    if not line.strip():
        continue
    # movetext line — one game complete
    mt = line
    try:
        ev = hdr.get('Event', '')
        speed = None
        for s in SPEEDS:
            if s in ev:
                speed = s
                break
        if speed is None:
            raise ValueError('speed')
        we = int(hdr.get('WhiteElo', '?'))
        be = int(hdr.get('BlackElo', '?'))
        result = hdr.get('Result', '*')
        if result not in ('1-0', '0-1', '1/2-1/2'):
            raise ValueError('result')
        tc = hdr.get('TimeControl', '-')
        initial = int(tc.split('+')[0]) if '+' in tc else None
        term = hdr.get('Termination', 'Normal')
        plies = mt.count('[%clk ')
        if plies == 0:
            plies = mt.count('.') - 1
        if plies < 6:
            raise ValueError('short')

        a, b = last_two_clocks(mt)
        if plies % 2 == 0:            # last mover was Black
            last_black, last_white = a, b
        else:
            last_white, last_black = a, b

        evals = eval_series(mt) if '[%eval ' in mt else None

        w_res = 1 if result == '1-0' else (0 if result == '0-1' else 2)
        b_res = 1 if result == '0-1' else (0 if result == '1-0' else 2)

        toks = None
        clks_list = None
        if evals is not None:
            toks = [t for t in mt.split() if t and t[0] not in '0123456789{[%'
                    and not t.endswith('.') and t not in ('1-0','0-1','1/2-1/2')]
        if '[%clk ' in mt:
            clks_list = []
            pos2 = mt.find('[%clk ')
            while pos2 >= 0:
                end2 = mt.find(']', pos2)
                v = clk_seconds(mt[pos2 + 6:end2])
                clks_list.append(v if v is not None else 0)
                pos2 = mt.find('[%clk ', end2)
        record(speed, we, be, w_res, term, last_white, initial, plies, evals, 'w', toks, clks_list)
        record(speed, be, we, b_res, term, last_black, initial, plies, evals, 'b', toks, clks_list)

        op = hdr.get('Opening', '')
        if op and op != '?':
            fam = op.split(':')[0].strip()
            ow = openings[(oband(we), fam)]
            ow['wn'] += 1
            if w_res == 1:
                ow['ww'] += 1
            ob = openings[(oband(be), fam)]
            ob['bn'] += 1
            if b_res == 1:
                ob['bw'] += 1

        games += 1
        if MAX_GAMES and games >= MAX_GAMES:
            break
        if games % 250000 == 0:
            sys.stderr.write('%d games\n' % games)
            sys.stderr.flush()
    except Exception:
        skipped += 1
    finally:
        hdr = {}

# ── Emit a compact, roundable structure ──────────────────────────────────
out = {'source': 'lichess_db_standard_rated_2026-07', 'games': games, 'cells': {}}
MIN_N = 400

for (sp, bd), c in sorted(cells.items()):
    if c['n'] < MIN_N:
        continue
    dec = c['win'] + c['loss']
    row = {
        'n': c['n'],
        'win': round(c['win'] * 100.0 / c['n'], 1),
        'draw': round(c['draw'] * 100.0 / c['n'], 1),
    }
    if c['loss']:
        row['flag'] = round(c['flag'] * 100.0 / c['loss'], 1)
        row['resign'] = round(c['resign'] * 100.0 / c['loss'], 1)
    if c['clk_n'] >= 100:
        row['clkleft'] = round(c['clk_sum'] / c['clk_n'], 1)
    if c['ply_n']:
        row['plies'] = round(c['ply_sum'] / c['ply_n'], 1)
        row['oppdelta'] = round(c['opp_sum'] / c['ply_n'], 1)
        row['analysed'] = round(c['analysed'] * 100.0 / c['ply_n'], 1)
    if c['w_n'] >= 200 and c['b_n'] >= 200:
        row['wwin'] = round(c['w_win'] * 100.0 / c['w_n'], 1)
        row['bwin'] = round(c['b_win'] * 100.0 / c['b_n'], 1)
    if c['ev_n'] >= 100:
        row['acpl'] = round(c['acpl_sum'] / c['ev_n'], 1)
        row['evn'] = c['ev_n']
        if c['acc_n'] >= 100: row['acc'] = round(c['acc_sum'] / c['acc_n'], 1)
        if c['ta_n'] >= 60: row['ta'] = round(c['ta_sum'] / c['ta_n'], 1)
        if c['po_n'] >= 80: row['acc_open'] = round(c['po_sum'] / c['po_n'], 1)
        if c['pm_n'] >= 80: row['acc_mid'] = round(c['pm_sum'] / c['pm_n'], 1)
        if c['pe_n'] >= 60: row['acc_end'] = round(c['pe_sum'] / c['pe_n'], 1)
        pcs = {}
        for k2, v2 in c['pc'].items():
            if v2[1] >= 400: pcs[k2] = round(v2[0] / v2[1], 2)
        if pcs: row['pieces'] = pcs
    if c['spd_n'] >= 100:
        row['spd'] = round(c['spd_sum'] / c['spd_n'], 1)
        if c['conv_chance'] >= 50:
            row['conv'] = round(c['conv_won'] * 100.0 / c['conv_chance'], 1)
        if c['res_chance'] >= 50:
            row['resource'] = round(c['res_saved'] * 100.0 / c['res_chance'], 1)
        for key, name in (('o', 'acpl_open'), ('m', 'acpl_mid'), ('e', 'acpl_end')):
            if c[key + '_n'] >= 100:
                row[name] = round(c[key + '_sum'] / c[key + '_n'], 1)
    out['cells']['%s|%d' % (sp.lower(), bd)] = row

# Openings: keep the families that actually recur, per band.
op_out = {}
for (bd, fam), o in openings.items():
    if o['wn'] < 500 or o['bn'] < 500:
        continue
    op_out.setdefault(str(bd), {})[fam] = [
        round(o['ww'] * 100.0 / o['wn'], 1),
        round(o['bw'] * 100.0 / o['bn'], 1),
        o['wn'] + o['bn']
    ]
for bd in op_out:
    top = sorted(op_out[bd].items(), key=lambda kv: -kv[1][2])[:45]
    op_out[bd] = dict(top)
out['openings'] = op_out

with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))

sys.stderr.write('done: %d games, %d skipped, %d cells, %d opening bands\n'
                 % (games, skipped, len(out['cells']), len(op_out)))
