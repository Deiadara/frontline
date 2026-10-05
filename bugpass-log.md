TODO: fill

## Definitive bug pass (maintainer, 2026-10-05)

One section of the game per pass, every thirty minutes. Each confirmed bug is fixed with a test and
a positive control when the fix is plain; anything that needs a design call is listed under the
pass's **Pending decision**. Simulations assert expected numbers rather than only directions.

### Pass 1: the crew and the chairs

Three reviewers, each tracing a mechanic from its number to where it is spent, with simulations
that assert exact figures: chair passives and curves, the Overseer's grade and the lifts, and the
money flows that moved with them (payroll and the Bar, the Stackhouse, building and muster prices).
New regression files: `apps/server/src/crew/chair-passives.test.ts` (every chair at F-, C+, A and
S+ through its real consumer), `apps/server/src/crew/overseer-grade-lift.test.ts`,
`packages/shared/src/crew/seat-tags.test.ts`, `apps/server/src/blackmarket/stackhouse-faction.test.ts`,
`packages/shared/src/building/engineer-price.test.ts`.

**Fixed**

1. **A grade on its own floor read one grade low.** `markFromPoints` divided by a band of 90/21,
   so `FLOOR + i * BAND` landed a float's width under the floor (65.714, the floor of B, read B-).
   Nothing reached those exact figures yet. A hair of tolerance; every floor is pinned.
2. **The Right Hand's line promised a fraction.** It printed "1.3 points" while every sheet takes
   lifts through `clampAttribute`, which rounds, so the sheets moved by 1. The line prints the
   whole points now.
3. **The Researcher and the Salvager ignored the six-hour settle.** Both read the chair through
   `workingIn`, which checks the bed and the bench but not the clock, so a strong officer hopped
   into Researcher started a long programme at half time (the clock freezes at start), and one
   hopped into Salvager halved a yard bill. `OfficerFitReader.chairSettled` gates both; the gates
   (`markFor`, `workingIn`) still open at once.
4. **An injured officer kept the Overseer's grade lift** while the chair lessons skipped them. Both
   now read the room (`room.fit`), which an injured officer is not in.
5. **Losing units could pay more caps than they cost.** The salvage refund was priced off the
   catalogue, so with a perfect Veteran (half off) and the salvage stack at 89%, ten dead units
   refunded about 2,047 caps against 1,150 paid, on a repeatable battle job. `refundFor` prices off
   what this crew's muster bill charges now.
6. **A fight that landed between the read and the click** was refused as "not your fight"; it is
   "closed" now. **The bet route judged the stake on unbanked caps**; it settles the crew first,
   as every other route that spends caps does.
7. **The Professor read the wall clock** on a mission settle rather than the settle's own instant;
   the settle passes it through now. Two doc nits (`crewCounter`'s comment sat over another
   function; the mid-game build cut is 24.55%, not 24.6%).

Each fix has a test that fails with the fix reverted (`crew/chair-passives.test.ts`,
`crew/marks.test.ts`, `crew/passives.test.ts`, `blackmarket/stackhouse.test.ts`).

**Checked and correct**: the 1/2/4 tags on all fourteen seats; the Overseer's rotation at every
grade for every chair; the lift cap with only the grade outside it; nothing past 100; lift order
independent of roster order; the Right Hand sized off the printed sheet and lifting nobody while
settling; one grade per officer on every screen and gate; spy defence (the Master of Whispers is
left out, per the 2026-10-01 ruling); the drill queue and the 100 ceiling; every passive's line
from 0 at the floor to its cap at 100, and each reaching its real consumer; no passive read from
the wrong chair; Trader loops (the supply to broker lap stops at the daily ration); Bar bids
holding wages until midnight and no signing past payroll; the Fixer on the ledger the Bar
charges; building prices (a deep late crew with a perfect Engineer pays 0.303 of the old list);
refunds from what was paid; the Stackhouse paying once, never going negative, and refunding a
fight that never ran.

**Pending decision**

**P1-A. The Stackhouse can be farmed by throwing a fight.** Calling a fight on Combine or looter
ground costs no infamy and commits no units. A crew calls one, bets 5,000 on the defender, sends
nobody and collects 10,000: reproduced through the real routes, +5,000 caps every 8 hours, and every
faction mate can bet the same fight (25,000 for a five-crew faction). Faction mates can also call
fights on each other and stand on both sides. The ruling was "either side, no guard"; this throw
costs nothing at all. Options: (a) only back your own side, and no bets when your faction is on
both; (b) either side, but a win against your own crew or faction refunds the stake rather than
doubling it; (c) refund when the losing side fielded no units.

**P1-B. A captured gate's raise takes neither the Engineer nor the crew's build discount.**
`city/gates.ts` prices it with `buildingCost('gate', level, [])`. Its own comment calls it a
building upgrade. Should the Engineer (and the build-cost cards) reach it?

**P1-C. The Steward multiplies flat slots from research and perks too.** The ruling named
captured locations' flat slots as base and percentage cards as bonus. Open Intake (+20) and the
Bunk Builder and Block Landlord perks are flat too, and an S+ Steward turns Open Intake into +30.
Are research and perk flats base (as now), or bonus?

**P1-D. The Cartographer also shortens the fixed gate leg of a move** (`MOVE_GATE_MINUTES`), not
only roads. Intended?

**P1-E. Salvage refunds can stack past 100%.** The Bone Market at 10 (66%), the two salvage rungs
and the two salvage perks reach 102% of what a unit cost. Priced off what was paid it no longer
mints (supplies and oil are never refunded), but should the sum be bent under a ceiling like the
other stacked bonuses?

### Pass 2: battles, units and locations

Three reviewers: the combat engine and the unit catalogue under seeded simulations (3,000 random
fights for the ledger, 300 to 1,000 seeds a point for rates), the life of a declared fight through
the routes and the world tick with a faked clock, and every location bonus kind held and measured
at its consumer. New regression files: `packages/shared/src/battle/bugpass-1005-engine.test.ts`,
`apps/server/src/battle/fight-life-1005.test.ts`, `packages/shared/src/city/location-ladder.test.ts`,
`apps/server/src/city/location-consumers.test.ts`.

**Fixed**

1. **Taking a player's plot paid the Combine's premium.** `bankOutcome` keyed the 40 for "robbing
   the state" and the 75 for a seat of its power on the district's allegiance, so two accounts
   trading a CCS plot netted 41 infamy a call each (182 with an S+ Field Commander). It now needs
   the Combine to have held the ground (`battle.defender.kind`). The four-crew test had the bug's
   +73 pinned; it is +33.
2. **The salvage refund paid the caller for its allies' dead**, and the allies nothing. Each crew
   is refunded its own share of the side's dead (split as survivors are, by what each sent) at its
   own salvage percent, and allies are credited directly. **It also skipped a unit's home-location
   muster cut**, so it could still pay above what was paid; it prices through `ratesForUnit` now.
3. **A captured gate kept its level when the fight that split its district was settled late.** The
   breach was read at the settle's clock, so a fight marked inside the breach and settled after it
   (a server down over the mark) left a level 9 gate standing. Read at the fight's mark now.
4. **An ally whose posting defended was never told** and never saw the report: a posting has no
   row. It gets the same empty row the principal does.
5. **A column already on the road kept the pace it left with** when its leader changed, so a
   stood-down officer's Short Way kept shortening a road nobody led. Naming or standing down a
   leader re-times the crew's columns.
6. **Copy.** The market discount card printed raw points as a percent off ("-55%" over a till
   charging 28.7% less); it says points into a taper now, on locations, perks and rungs alike. The
   Netrunner's rule said each covers three slots of machine; each slot of jammers covers three, so
   one Netrunner covers nine. SPEC-server's location figures (1% muster cut, the unit slot
   constants, the 10% dearer ladder) and thirteen DISTRICTS.md reward lines match the catalogue.

Each fix has a test that fails with the fix reverted.

**Checked and correct**: the ledger on 3,000 random fights (no NaN, no negative or fractional
units, fled plus killed equals fielded, byte-identical replays); pure unit counts monotone on every
ground; a stronger sheet beats its mirror; Last Stand, outnumbered in slots, the ambush bend, traps
on a column of one, resistances inside 0.15 to 1.6, the jam, the Raid Boss multiplier on his own
stack only, Infirmary recovery, infamy per slot and the Field Commander against crews only; calling
(empty ground, one call per place, prices, the cap, the lead time to the millisecond), withdrawing
to the lock, officers committed once and refused when too far, units conserved per crew in a
four-crew fight, home raids and home gates both ways, the abandon path; all 33 location bonus kinds
reaching their consumers, the level ladder, unified district bonuses, the second city, and every
taper (face value to the knee, monotone, under its ceiling).

**Pending decision**

**P2-A. More units can lose more often.** Adding a few Razors to a mixed line can drop the win rate
sharply: 16 Anodics plus 1 Razor against 52 Razors in a tunnel win 60%, plus 2 win 21%, plus 3 win
34%. The morale shock counts whole bodies only, so a wounded front unit counts for nothing until it
dies, and long fights between high-health sheets become races decided by which round one body
falls. That breaks the 2026-09-29 rule that more units are always a bit better. Counting the front
body's wound fixes the sawtooth (the tunnel row reads 81, 79, 83, 82, 80, 78) and leaves the even
mirror ladder untouched, but it moves narrow-ground balance (the tunnel base goes from 51% to 84%),
so the balance tests and the Combine ladders would be re-measured. Apply it?

**P2-B. Salvage can still pass 100%**, now with numbers: there are two Bone Markets (the Steelbelt's
and Terminus's Rendering Shed), each 66% at level 10, and with the two Lab rungs the sum is 155% of
what the dead cost. Priced off what was paid it still returns more caps than were spent (10 Anodics:
900 paid, 1,188 back at two level 10 markets). This is P1-E, confirmed as a mint: bend the sum under
a ceiling below 100?

**P2-C. The Chapel and the Broadcast Station pay nothing from level 4.** Their officer lift is
capped at 10 points an attribute (`MAX_OFFICER_LIFT`), which a level 3 Chapel already fills, so
seven paid levels buy nothing and a Chapel silences every mental teaching perk and Lab rung behind
it. Stop scaling the group lift, stop it at the cap, or let it sit outside the cap?

**P2-D. Five location channels still stop hard**, so their top levels are dead and the cards
overstate: vehicle parts and refits at 60% (Rail Yard, Armory, levels 6 to 10), the black market at
50% (the Statue), travel speed at 60% (Tram Depot), mission speed at 50% (Smuggler's Tunnel). The
2026-10-01 ruling put market, muster, defence and cohesion on tapers; move these five too?

**P2-E. The Saint's blurb promises an aura** ("presence alone steadies everyone who can see
them"), but its sheet steadies only itself. Change the copy, or build the aura?

### Pass 3: the economy and progression (interrupted)

Stopped part-way on 2026-10-05: the account hit its weekly usage limit while the three reviewers
were working (missions, experience and the Right Hand; research, buildings, the Scrapyard,
production and mustering; feats, the Bar and the markets), and the loop was paused. What they had
written passes and is kept as regression coverage, with no findings reported yet:
`apps/server/src/research/lab-days.test.ts`, `apps/server/src/district/economy-days.test.ts` (two
days of a district banking the same totals settled once, every minute and at odd instants) and
`apps/server/src/feats/feat-sources-1005.test.ts`. The pass is to be run again from the start.

### Decisions taken on passes 1 and 2 (maintainer, 2026-10-05)

- **P1-A, the Stackhouse farm.** A crew cannot bet on a fight it called itself; it may still bet on
  fights its faction mates called, and on fights called on it. After a fight resolves, the crew
  that called it and lost cannot call that location again for 24 hours (others may). A fight is
  cancelled at the lock (one hour before the mark) unless the attacking side, allies included, has
  at least 20 unit slots committed; on that cancel every bet is refunded, deployed units walk home
  whole, and the infamy paid to call it is kept.
  Built: refusal `own_call` and `openFights` leaving the crew's own calls out
  (`blackmarket/stackhouse.ts`); `lost_here` off `lostHereRecently` and `LOST_CALL_COOLDOWN_HOURS`
  (`battle/declare.ts`); the world stage `under-strength calls` (`callOffUnderstrength` under
  `MIN_ATTACK_UNIT_SLOTS`, `battle/understrength.ts`) with a "A fight was called off" notice, and
  the minimum stated in the declare dialog.
- **P1-B, captured gates.** A gate raise takes the crew's build-cost discount and the Engineer's
  cut, like any building, and its price rises about 10%.
  Built: `CAPTURED_GATE_PRICE_RISE` (1.1) and `gatePricingFor`; the charge is stored as
  `upgradePaid` (migration 0146) and a cancel refunds from it.
- **P1-C, the Steward.** Base slots are the buildings' and the ground's only; research and perk
  flat slots add on top, unmultiplied.
  Built: `districtUnitSlotCapacity` takes the ground's share as `groundSlots`.
- **P1-D, the Cartographer.** Roads only: the fixed gate leg of a move is not shortened.
  Built: `moves/moves.ts` times `MOVE_GATE_MINUTES` with no Cartographer cut.
- **P1-E / P2-B, salvage.** The sources add, then bend towards 100% without reaching it.
  Built: `salvageRefundCut`, `softCap` with knee 50 and ceiling 100 (155 points refund about
  93.9%); the location card says it tapers.
- **P2-A, morale.** Count the front unit's wound in the casualty shock, then re-measure the balance
  tests and the Combine ladders and retune whatever moved too far.
  Built: `moralePhase` charges both its own and the enemy's loss as the share of starting health
  gone (`startedHealth`). Retuned with it: see the measurements below.
- **P2-C, the Chapel and the Broadcast Station.** Halved (about +2 at level 1, +6 at level 4, +14 at
  level 10) and moved outside the 10-point lift cap, like the Overseer's grade.
  Built: `GROUND_OFFICER_LIFT_SHARE` (0.5, floored: 2, 4, 5, 6 at levels 1 to 4, 14 at 10) and the
  ground's lift passed `uncapped` to `liftedSheet`.
- **P2-D, the five hard-capped channels** (vehicle parts, refits, black market discount, travel
  speed, mission speed). No hard stop on what extra locations, rungs and perks add; size them so a
  realistic mid-game and end-game crew land near today's bounds for their phase, while a crew that
  specialises (every infamy discount location, rung and perk) can run ahead of that curve and
  will be behind elsewhere.
  Built: `economy/soft-bounds.ts`, knee and ceiling 30/70 vehicle parts, 30/70 refits, 25/65 black
  market, 30/75 travel speed, 25/60 mission speed; `MAX_MISSION_SPEED_BONUS`,
  `MAX_TRAVEL_SPEED_BONUS` and `MAX_BLACK_MARKET_DISCOUNT` removed.
- **P2-E, the Saint.** Build the aura its blurb promises: the Saint's presence steadies the other
  stacks on its side.
  Built: rule `steadies` (Steadying Presence): while the Saint stands unbroken nobody else on its
  side drops below wavering. No location or perk can grant it (`GrantableUnitMark`).
- **Spying, one job per place** (same day). A crew cannot send a second party to a place it already
  has runners on its way to. Built: refusal `watching_here` (`sameSpyTarget`), and the spy panel
  hides the send while one is out there.

All of these were built on 2026-10-05.

Rebalance measured with the morale change: the Raid Boss practice fixture went from 17 to 15
Razors (wound morale made the Razor line steadier; at 15 the Raid Boss wins 180 of 180 against the
Professor's 6); the lifted-leader fixture to 12 Razors at E- and 20 at E+; the difficulty ladder was
re-walked (7: 272, 8: 323, 9: 323, 10: 384 and 457 Razors) with the Combine mix at 9 and 10 moved to
5% Greycoats, 30% Enforcers and 65% Suppressors; the Ironside wall test now asserts `wallFell` above
0.05; the Opening Volley defender test measures wins; and two boosts were repriced, They Came For
This 500 to 330 infamy and The Colossus Walks 550 to 350.
