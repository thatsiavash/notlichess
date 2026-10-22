# Accepted misleading claims

The truth audit's gate counts a misleading claim as accepted when one line of this file holds both its card
key and its exact text. Each row gives the card, the help levels (t1 700, t2 1600, t3 2000) it shows at, the
exact string, why it stands, and the seat that accepts it. Figures are Stockfish 17.1 at 4,000,000 nodes
(the audit's recheck), the player's winning chances.

Release 2 (scope-v3, section 4): the four rows that stood after v2 slice 2's audit are gone from the cards.
Ra1 on 184434540700:103, gxf3 inside the knight line (184359604942:24) and mid-line Be6+ on
184205946040:38 read "Good move / There's a stronger one." (B3, at the key's or the re-check's depth), and
foil:184364964898:45's Ne5 is graded and said by the 1,000,000-node re-check, its reply f3 (B9). After
release 2 this file lists only what the rerun of the merged build still finds, each row with its seat
confirmed before the push.

| Card | Tier | Claim | Why it stands | Seat |
|---|---|---|---|---|
| 184364964898:49 | t1, t2, t3 | You'd lose ♞ for ♙. | The try Kf2 loses the knight for a pawn on Stockfish's line at 1,000,000 nodes (the re-check that grades it); at 8,000,000 the line scores -4.08, more than the count says: true as said, short of the whole. Release 2 P2: read such a count against the deepest score. | proposed: content |
| 184364964898:49 | t2, t3 | After Kxf2, you'd lose ♞ for ♙. | As above, after the reply named. | proposed: content |
| 184212737262:58 | t2, t3 | Kxd7 takes your bishop. | The capture is real and stays; at 8,000,000 nodes the try scores -5.09, worse than the bishop: the reason names the first loss, not all of it. P2 as above. | proposed: content |
| 184212737262:58 | t1 | Their king takes your bishop. | As above, in words. | proposed: content |
| 184364964898:59 | t1 | You'd lose ♛♜ for ♗. | The try's 1,000,000-node line loses queen and rook for a bishop; the deeper line gets 4 back (net 7, the claim 11): the loss stands, the count is high. P2. | proposed: content |
| 184257113186:38 | t2, t3 | Ne2 misses Be3. It wins a queen for a knight. | Explore: Be3 does trap and win the queen (deep line +8); Ne2 keeps 86% against Be3's 87%, so "misses" is strong for a one-point gap in a won game. P2: Explore's missed chance by the win-point gap. | proposed: content |
| 184257113186:38 | t3 | Red1 wins the knight. Rd7 missed it. | Red1 (a found-band try) does win the knight; set beside the game move Rd7 the swing is 6.9 pawns, the words name 3. P2: the swing rule for an alternative's own reason. | proposed: content |
| 184430145348:107 | t2, t3 | Rb1+ misses White's undefended pawn on a7. | The pawn on a7 is undefended and Rxa7 takes it; the swing (a draw against a loss, 10.5 pawns) is the pawn's promotion, which the words do not say. The classifier's swing rule reads material, and this line's material shows no promotion within its 8 plies. P2. | proposed: content |
| 184363754280:56 | t2, t3 | They play Qc6, check. You lose ♕ for ♜. | See why's game line: Nb5 Qc6+ wins the queen for a rook, as said; at 8,000,000 nodes the line scores -7.31, more than the count. P2 as above. | proposed: content |
| 184363754280:56 | t1 | They play queen to c6, check. You lose ♕ for ♜. | As above, in words. | proposed: content |
| 184430145348:107 | t1 | Rook to b1 misses their undefended pawn on a7. | Tier 1's words of the row above (Rb1+ and the pawn on a7). | proposed: content |
| 184257113186:38 | t1 | Knight to e2 misses bishop to e3. It wins a queen for a knight. | Tier 1's words of the Explore row above (Ne2 and Be3). | proposed: content |
| 184205946040:38 | t3 | Rxg5 wins the pawn. Be3 missed it. | Release 4: mid-line Be6+ (a near-band step, found) ends the card on the player's own line; tier 3's check line names the answer's own gain, the pawn Rxg5 takes, and the game move set beside it swings 6.3 pawns. P2 as Red1 above: the swing rule for an alternative's own reason. | proposed: content |
| 184359604942:24 | t2, t3 | Nxa8 takes their rook. You win ♜♝ for ♙. | Release 4: gxf3 inside the knight line (a near-band step, found) ends the card on the player's own line; See why's count on that line is real where it is said and the player gives back 2 later on the 8,000,000-node line. P2 as the counts above. | proposed: content |
