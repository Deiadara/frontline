# Bugpass log

Thirty-minute passes over a different trio of files each time, reading how they connect. Ignores
balance. Straightforward misapplications are fixed in code and noted here in one line; anything
that needs the maintainer's call is written up with how the mechanic works today, what looks
off, and the choice.

## Pass 1 (2026-10-14): the Stackhouse, then casualty recovery

**Stackhouse** (`market/stackhouse.ts`, `blackmarket/stackhouse.ts`, `Stackhouse.tsx`): clean.
The world tick and both routes settle bets before reading, the bet route re-reads the wallet
inside the transaction after the settle, a called-off or abandoned fight refunds through the
same path as a report with no winner, and the client bounds the stake by both the book's
ceiling and the wallet. Caps have no storage ceiling, so a payout has nothing to overflow.

**Casualty recovery** (`crew/effects.ts`, `battle/resolve.ts`, `base/bonus.ts`): fights and
missions read the same fold and add the Infirmary the same way. One item for you:

### Medic points: neither screen prints what the fight spends

How it works today. When a side wins, the dead it gets back is one share off one sum: the crew's
medic points (perks such as Stretcher Run, the Joker's seat, held ground such as the Infirmary
Cloister) plus the Infirmary structure's four points a level, put through a diminishing curve
that approaches 50% and never reaches it. Twenty points is about 16%, forty about 28%, eighty
about 40%.

What looks off. Two screens print a piece of that and neither prints the whole:

- The Crew page's "Medic points (who walks home)" card prints the crew's raw points, without
  the Infirmary structure and without the share they are worth.
- The Nexus panel's Infirmary line prints the structure's share *alone* through the curve ("28%
  of the fallen back on their feet" at level 10). Because the curve bends, the structure is
  worth less than that on top of any other points: forty Infirmary points alone are 28%, but
  added to forty crew points they move the share from 28% to 40%, so they buy 12, not 28.

The choice.

- **A.** The Crew card prints the combined points and the share the fight spends, the way the
  defence card now prints the held figure (2026-10-13), and the Infirmary line says "+N medic
  points" rather than a lone share. Recommended: it is the same ruling as the defence card.
- **B.** Leave both as they are and accept that neither is the fight's figure.

## Pass 2 (2026-10-14): the Trophy Hall

`city/daily.ts`, `battle/resolve.ts`, `ArcaControls.tsx`. Kills from declared fights and from
jobs reach the wall, robots are off the ledgers before the dead are read, Combine leaders are
catalogue units so they count and print, and the daily pay goes through the ordinary credit
path so the stores' ceilings apply.

**Fixed.** A trap's victims never reached the wall: the settle records each side's trophies off
the fight's dead, and merges the trap's victims into the attacker's fallen only afterwards, so a
defender's own Prepared Collapse put no kind on its hall even though the infamy ledger already
pays those kills to whoever set the trap. The setter's wall now takes them (the defender's own,
or an ally's), with a resolve-level test that fails without the line.

Nothing for you to decide this pass.

## Pass 3 (2026-10-14): officer injuries

`battle/officer.ts`, `crew/duty.ts`, `battle/resolve.ts`. One rule decides who is in the room
(`officerIsWorking`), one decides who can be sent (`officerDuty`), both read the same clock, and
the roster writes in the settle are column by column so a later write cannot drop the injury.
The district settle prices the stretch after an officer comes back at the right instant.

**Fixed (comments only).** Three comments said an officer is out "for a day" against a
twelve-hour constant, and two said a hurt officer takes the side's report with them, which
stopped being true on 2026-09-23 (`reportReaches` ignores the officer). No player-facing copy
said either.

Nothing for you to decide this pass.

## Pass 4 (2026-10-14): columns and machines

`building/vehicles.ts`, `battle/movement.ts`, `features/battle/column.ts` (with the mission
launch and the move quote as the other spenders). Clean: every road, to a fight, to a job and
between the crew's own places, prices the column through one function with the same inputs
(the unit's fitted sheet, the crew's unit pace, the ride waiver, the Hump's seats and the
Coaling Stage's pace), and all three client quotes call that same function with the same
inputs off the roster payload. The machine pace is capped at 100 the way a unit's is.

### The ride waiver and the train

How it works today. "Anything can be put on a machine" (`any_ride`) comes off a research rung,
two district holdings and a perk. With it, the Colossus takes a seat in a truck on every road,
and the deploy window, the fight page and the job board all seat it. The railway is a separate
rule (2026-09-24): a party with any machine or any too-big-to-ride unit cannot board, and both
rail paths (the move quote and the fight column) read the sheet's rule alone, so a crew holding
the waiver is still refused the train for a Colossus.

What looks off. Nothing is inconsistent between the two rail paths. The question is whether
the waiver's sentence covers a train: a truck has a cargo bed and a train has no flat-bed, which
is the reason the rail rule gives for refusing machines.

The choice.

- **A.** Leave it: the waiver is about machines, the train refuses the Colossus regardless.
  The move dialog already shows the march when the train is refused. Recommended, since the
  two rules were written separately and the copy of each still holds.
- **B.** Let the waiver open the train to the Colossus too (one flag through `partyCanRide`
  on both paths), and reword the rail rule.

## Pass 5 (2026-10-14): market claims

`market/board.ts`, `district/stores.ts`, `OffersPage.tsx`. Clean. A listing that is taken,
runs out or is closed by a counter holds its goods on the board with a 24-hour claim; the
world tick and every market read sweep lapsed claims before answering; a press and a lapse pay
through the same function, the press warned about what would not fit and the lapse paying as
it stands; both credit through the one stores door, against the same ceilings (structures plus
the crew's and the ground's storage bonus) that the HUD bar and the ration are quoted off. The
panel's copy prints the same lifetimes the constants hold (48 hours standing, 24 to claim), and
a reset forfeits the old life's claims rather than paying them to the new one.

Nothing for you to decide this pass.

## Pass 6 (2026-10-14): the table's cards

`factions/cards.ts` (shared), `factions/cards.ts` (server), `crew/standing.ts`. Clean on the
wiring: one function deals the cards and marks them, and both the faction screen and the standing
fold read it, so the card on a plate is the card every member is paid on. Each card's channel
reaches its spender: the ace's offense in the fight, the king's defence through the Gate taper,
the queen's speed on both the board's quote and the launch, the jack's infamy on every bank, the
joker's medic points on the recovery curve. The seat route freezes the table before moving the
two people it names.

### The card reads the Overseer's own sheet, the crew screen shows a lifted one

How it works today. A card's mark is the mean of three of its holder's attributes, read off the
Overseer's own sheet. The crew screen's Overseer card prints that sheet lifted by the Right Hand
(up to +3 a skill, with a receipt naming them), which is the only lift that reaches the Overseer.

What looks off. The faction window says "Reads Strength, Strategy and Authority. At their B:
+7%" with no numbers, so a player training to the sheet they can see can sit one band under what
the card pays, and nothing on either screen says which sheet the card reads.

The choice.

- **A.** The card reads the lifted sheet, the one the crew screen prints. The Right Hand then
  lifts the whole table a little, which fits the chair's meaning. One line in
  `cardsAtTable` plus the room the fold already builds.
- **B.** Keep the card on the Overseer's own sheet and say so on the faction window ("off their
  own sheet, before any lift"). Recommended if the Right Hand is meant to stay a crew-only chair.

## Pass 7 (2026-10-14): research price and clock

`research/tracks.ts` (shared), `research/tracks.ts` (server), `research/start.ts`. Clean. One
fit reader gates a rung, prices it and times it, so a rung cannot be refused on one sheet and
charged on another; the page's per-rung cost and minutes come off the same two functions the
start charges and freezes; the three clock cuts (the Lab's cards, the crew's research speed, the
Head's settled passive) are added once and tapered once; the Head's line prints what they add
to the curved sum rather than their raw cut; a Head laid up drops off the fold and the gate
together; the page's duration formatter takes minutes, which is what the row carries; and the
Nexus panel's Lab line prints the same cost cut the price takes.

Nothing for you to decide this pass.

## Pass 8 (2026-10-14): the spy contest

`spying/spying.ts` (shared), `spying/spying.ts` (server), `crew/standing.ts`. Clean. The crew
page's two spy totals come off the same two functions a job is settled on, with the same gate
rule (a broken gate counts nothing, on the quote and on the job alike); the defending counter
reads the people fold, the ground fold and the district's cards separately so the Gate is
counted once, in points, rather than twice through the standing fold; the spying side is frozen
at the send; the Master of Whispers' chair cancels an equal one on the other side; and no rung or
rank pays resistance that the counter leaves out. A spy on a plot a crew holds meets that crew's
home-district counter-intel cards with no gate, which is the authored shape, not a slip.

Nothing for you to decide this pass.

## Pass 9 (2026-10-14): feat claims

`routes/feats.ts`, `feats/room.ts`, `feats/waste.ts`. Clean. The read, the single claim and
Collect All all measure room through one function (the stores' ceilings with the storage bonus,
and the district's spare beds off the same fold mustering reads); a single claim recomputes the
split at the till rather than trusting the quote, refuses without the player's yes, writes the
claim row before paying, and pays every channel through the game's own primitives (the stores'
one door, the roster at home, the stash, the XP writer); Collect All spends the room down across
the backlog and hands back anything that would lose something rather than burning it; the
badge and the screen read one evaluation, and a chain advances on achievement so an unclaimed
rung never stalls it.

Nothing for you to decide this pass.

## Pass 10 (2026-10-14): the Gate

`building/standing.ts`, `battle/resolve.ts`, `city/gates.ts`. Clean on the wiring: a home Gate
stands only in a fight at it, a captured gate only in a fight at that district's gate while the
district is held whole, neither in a location fight or a raid; a breach zeroes both and the
standing fold's share too; a breach that costs the holder a plot sends a captured gate back to
level 1; the Wall Breaker zeroes the gate's share for the fight; the Gatewright's cut pays on a
captured door as on a built one; and the spy contest charges the same ten points a level the
board's intel line holds.

### Two gate panels print the raw figure, one prints the curved one

How it works today. Every point of gate defence is summed with the holder's other defence and
put through the held-ground curve (full to 55, closing on 85, never reached) before the fight
reads it. The Nexus panel's own-Gate line prints its share through that curve on its own. The
fight page's gate section ("Toughness +N%") and the city view's captured-gate card ("+N%
holding it") print the captured gate's raw per-level figure, which at level 7 is a number the
fight never reaches on its own, and which is on a different scale from the home Gate's line two
screens away.

What looks off. Three panels, two scales, and none of them is the figure the fight spends
(the curve of the sum). This is the same shape as the medic-points item in pass 1.

The choice (one convention for every structure line that feeds a curve).

- **A.** Structure lines print their raw points ("+17.5 points of defence") and only the Crew
  page's channel card prints the curved figure the fight spends, as it does since 2026-10-13.
  Recommended: one place prints what is spent, every other place prints what it adds.
- **B.** Every structure line prints its own share through the curve, as the Nexus Gate line does
  now, accepting that two such shares do not add to the fight's figure.

## Pass 11 (2026-10-14): the Bone Market refund

`battle/salvage.ts`, `battle/resolve.ts` (`refundFor`, `refundEachCrew`), `missions/resolve.ts`.
Clean. One function prices the dead on both a declared fight and a job, off what the units cost
this crew to muster (its own cuts and its Veteran's), through one curve that closes on 100% and
never reaches it; a side's dead are refunded crew by crew at each crew's own percent rather than
all to the caller; the raid defender's refund is added to the row as it stands after the break-in
rather than to the settle's opening snapshot; a job pays only when somebody came home and only on
the dead the medics did not walk back; the Cold Sidings' so-much-a-body rides beside it on both
paths; and the location copy says the percent tapers.

Nothing for you to decide this pass.

## Pass 12 (2026-10-14): notoriety

`economy/renown.ts`, `economy/notoriety.ts`, `battle/routes.ts` (the purchase). Clean. The
rank's grants are hold bonuses folded through the same function a held location pays through,
cumulative up the ladder, and they reach every consumer through the standing fold; the ladder
page prices each rung off the same cost function the purchase charges and prints each rung's
grant off the same table the fold sums; the purchase refuses a stale rung so a double press
cannot buy two; the unit gate is derived from one table and read by the muster door and the
unit card alike; and the rank feat reads the row the purchase writes.

Nothing for you to decide this pass.

## Pass 13 (2026-10-14): chair passives

`crew/passives.ts`, `crew/effects.ts` (`chairPoints`, `chairPassiveOf`), `crew/standing.ts`.
Clean. All eleven passives have a consumer: nine through the fold's chair points (payroll, unit
slots, battle infamy, travel time, muster cost, building cost, mission XP, the Trader's rates,
the Raid Boss's multiplier) and two through the fit reader (research speed, Scrapyard cost),
and every one waits on the six-hour settle the same way, since the fold leaves a settling chair's
points unset and the two fit-reader sites ask `chairSettled` first. The Right Hand's lift and the
Master of Whispers' grade wait on it too. An injured officer drops out of both readers together.

Nothing for you to decide this pass.

## Pass 14 (2026-10-14): the build queue

`building/cost.ts`, `district/build.ts`, `district/boost.ts`. Clean. One price function serves
the quote on `/me`, the affordability gate and the charge, with the building credit taken as a
step down the curve first and the tapered discount and the Engineer's passive off the result;
one clock function serves the quote and the frozen entry, the Generator's burn included at order
time; the XP an order pays is priced off the same clock without the burn, as ruled; the burn
re-times the queue once and is refused while one runs, so it cannot compound; and the dialog
reads the server's quote and falls back to the list price only when the payload is missing.

Nothing for you to decide this pass.

## Pass 15 (2026-10-14): training drills

`crew/training.ts` (shared), `crew/training.ts` (server), `routes/training.ts`. Clean. The
day's allowance, the queue's places (two plus the Professor's rung) and each person's own hour
are computed once on the server and handed to the page, which dims a drill with the same
sentences the route refuses with; the queue gate reads the widened slot count and the constant
is only read for the "third in line" feat; a drill's hour is frozen off the lifted sheet and the
ground's cut at the start and every reader of its end reads that; the gain halves past fifty and
the Bunkroom's extra point is rolled once off the session's id; a cancel hands the day's session
back only when it was charged to today and restores the no-repeat memory.

Nothing for you to decide this pass.

## Pass 16 (2026-10-14): the Scrapyard

`building/scrapyard.ts`, `district/scrapyard.ts`, `ScrapyardPage.tsx`. Clean. One price function
serves every bill on the bench (building cards, unit cards, traps): the yard's per-level cut on
every line and the Salvager's on scrap and HQ metal, multiplied rather than summed and floored at
one; the read and the write compute the Salvager's cut the same way (working and settled, off the
lifted sheet) and take the same standing (the Armory's refit cut, the Spoil Heap's XP) from one
place in the route, so the quote and the charge are one number; the plate's hover says exactly
what the two cuts are and that every price shown already counts both; and breaking a component
down credits through the stores' door with the waste warning first.

Nothing for you to decide this pass.

## Pass 17 (2026-10-14): the Garage

`building/vehicles.ts`, `garage/routes.ts`, `units/muster.ts` (`queueVehicle`). Clean. The
page's price, clock and refusal for each machine come off the same three functions the order
charges, freezes and refuses with: the parts cut and the Fuelling Point's scrap cut on the price,
the yard's level on the clock, the batch rule on both; the Gauntlet's muster cut stays off a
machine as ruled; the fleet ceiling counts what is parked, out on the road and on the bench; the
card's build time is printed by the seconds formatter with seconds; and the machine's pace on
the card is the Coaling Stage's figure the road reads. One nit, no decision: the garage vehicle
view carries a `speedPercent` field holding the same figure as `speed`, which nothing on the
client reads.

Nothing for you to decide this pass.

## Pass 18 (2026-10-14): hiring at the Bar

`bar/wage.ts` (shared), `bar/hire.ts`, `bar/auction.ts`. Clean. The asking price is the city's
(no crew's discount on the table, so two crews bid against one floor) and the crew's negotiators
cut the contract instead, through one function the close commits, the hold on tonight's bids
counts, the bid ceiling inverts and the auction window prints; the wire's discount is clamped to
the same half the function clamps to; a signing writes the officer's wage and the book's
commitment as one figure, so the crew card and the ledger agree; a release frees the commitment,
charges ten weeks of it, refuses while the officer leads a run or a fight, and takes their drill
off the floor with them; and nothing but the Bar creates an officer, so no sheet carries a wage
the book does not hold.

Nothing for you to decide this pass.

## Pass 19 (2026-10-14): pamphlets and legend auras

`city/control.ts` (the territory fold), `crew/standing.ts` (the pamphlet fold), `battle/effects.ts`.
Clean. A Pamphlet Wall's pins are read off the walls the crew itself holds, which is the same
own-only rule the territory fold applies to every location's own pay (a mate's ground counts
only towards a district being whole); the pins reach the engine as the *enemy's* territory, so
the pinned unit is the one that fights the pinner at the penalty; the penalty lands on both
damage and vitality, which is what the wall's panel and the districts doc say; and a legend's
aura is a whole-district bonus the table earns, cast by the legend on everybody else in its
force and withdrawn the round the legend goes down.

Nothing for you to decide this pass.

## Pass 20 (2026-10-14): ground labels

`battle/battlefield.ts`, `battle/effects.ts`, `crew/standing.ts` (with `city/view.ts` as the
sheet's reader). Clean on the fight: the location sheet and the fight work a location's ground
out through one function (the authored labels, the sky, the hour, the tower's Noisy, Lampman's
Row), so the chips are the fight's; a home raid fights urban under the sky alone; and a unit
reads the ground off its upgraded sheet with the crew's cancelled labels and its door's.

### Cancelled labels: the card says "your Tolling Tower" for every one, and misses the door's

How it works today. Three things cancel a ground label for a unit in a fight: a Tolling Tower
switched on cancels Noisy for the whole crew; since today (other run, in flight) a held ground
can make the crew immune to a label outright (the Frontier Chapel's Eerie); and a unit's door
can cancel labels for that unit alone (the Crimson Stage at level 4: Crammed and Wet). The
engine reads all three. The unit card gets one crew-wide list of cancelled labels and strikes
the matching red chips through with the hover "Cancelled by your Tolling Tower: ... while the
bells ring".

What looks off. A crew holding the chapel will see its units' Eerie weakness struck through
and credited to a tower it may not hold; and a Dancer at a level-4 Stage shows Crammed and Wet
as plain weaknesses while her fights ignore both.

The choice. The card needs to know *why* a label is cancelled, per unit:

- **A.** Each affinity row on the wire carries `cancelledBy` (the tower, the chapel's name, or
  "the Crimson Stage at level 4"), built on the server beside the rules the same way the door
  rules were on 2026-10-14, and the chip prints that. Recommended; it also covers the chapel
  without a second copy string. Best built after the Frontier Chapel work lands, since it
  touches the same payload.
- **B.** Keep one crew-wide list, reword the hover to "Cancelled by your holdings", and leave
  the door's two labels unstruck.

## Maintainer decisions (2026-10-15)

- **Pass 1, medic points: A.** The Crew card prints the combined medic points and the share the
  fight spends; the Infirmary line says "+N medic points".
- **Pass 4, the ride waiver and the train:** neither option. `any_ride` is removed from the game
  and the Colossus never rides a machine, on a road or on the rail. Its sources are replaced:
  Load Plans gives vehicles 10% faster; the Breaker's Yard and the Motor Pool keep only their
  +10% vitality; the Crane Hand perk gives vehicles 10% more seats.
- **Pass 6, the card's sheet: A.** A table card reads the Overseer's lifted sheet, the one the
  crew screen prints.
- **Pass 10, gate figures: A.** Structure lines print their raw points; only the Crew page's
  channel card prints the curved figure the fight spends.
- **Pass 20, cancelled labels: A.** Each affinity row carries `cancelledBy`, and the chip names
  what cancelled it (the tower, the held ground, or the unit's door).
