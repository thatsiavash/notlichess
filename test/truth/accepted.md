# Accepted misleading claims

The truth audit's gate counts a misleading claim as accepted when one line of this file holds both its card
key and its exact text. Each row gives the card, the help levels (t1 700, t2 1600, t3 2000) it shows at, the
exact string, why it stands, and the seat that accepts it. Figures are Stockfish 17.1 at 4,000,000 nodes
(the audit's recheck), the player's winning chances.

Audit of v2 slice 2 ("Words from the facts"), engine up and engine down, tiers 1 to 3: 28,290 chess claims,
0 false, 5 misleading (0.02%), none on Today's first set. The last two rows are noise at 4,000,000 nodes and
misleading at another depth: listed so a borderline depth cannot fail the gate unseen.

| Card | Tier | Claim | Why it stands | Seat |
|---|---|---|---|---|
| 184434540700:103 | t1, t2, t3 | Not this one | Ra1 keeps a win (89% against the answer's 98%) but is no better than the game move the card is about (84%), so V1.2 grades it a miss (slice 1's by-design verdict). | seat: to confirm |
| 184359604942:24 | t2, t3 | Not this one | gxf3 inside the knight line keeps 75% against the line's 81%; V1.6 makes a step 7 points below the line a miss (slice 1's by-design verdict). | seat: to confirm |
| 184205946040:38 | t2, t3 | Not this one | Mid-line Be6+ keeps 84% against the line's 88% at 4,000,000 nodes (noise, slice 1's adjudication) and 85% against 91% at 8,000,000 (the harness's reading): V1.6's step rule. | seat: to confirm |
| foil:184364964898:45 | t2, t3 | After Nxe2, the game is even. | After the try Ne5, Nxe2 does leave the game even (56%), but White's best reply is f3 (30%): the try's two-move 250,000-node search under-reads its second line. Noise at 4,000,000 nodes (10 points outside the band), 11 points outside at 1,000,000. | seat: to confirm |
