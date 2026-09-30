# The battle engine

How a fight is resolved, in the order it happens, and what each number in it is for.

The code is `packages/shared/src/battle/`. The engine is pure and seeded: everything it does comes
out of `input.seed`, so a fight replays byte for byte from the string on its battle row. The server
calls it through the `SkirmishEngine` interface and never depends on the model behind it.

## The shape of it

```
declare  ->  deploy  ->  settle
                            |
                            +-- simulate()      the fight itself, in rounds
                            +-- routSurvivors() who gets out of a lost fight
                            +-- breakOut()      the winner's ring, as a second fight
                            +-- analyseBattle() the ledger the player reads
```

`simulate()` decides who holds the ground. Everything after it decides who goes home.

**Who is in the two lines** is settled before the engine sees anything, by the server
(`apps/server/src/battle/alignment.ts`, maintainer 2026-09-28): every unit at the place of the fight
attacks if it is the attacker's or a faction-mate's, defends if it is the defender's or a
faction-mate's, and otherwise is parked, neither counted nor killed. The place is the location, the
gate or the district raided. Columns that land after the mark are not in either line: they walk on
to whatever the fight leaves. The engine only ever receives the two armies that result.
A raid on a home through a broken gate is defended by every unit standing in the district, deployed
or not; units on the road or on a job are elsewhere, and the gate garrison lost at the door
(maintainer, 2026-09-29). What a won raid costs the district afterwards, a share of its stock and a
cut to its structures' output for six hours, is the server's business: `docs/SPEC-server.md`.

## One round

Both sides fire from the same snapshot and both take it. Sequential rounds would hand whoever went
first a free volley against a stack that is already dead.

1. **Concentration.** `concentrationFor` gives a side a multiplier for having more units engaged
   than the enemy, weighted by how much of it shoots rather than swings (`rangedShare`). A shield
   wall gets nothing for being twice as many.
2. **Fire.** Each stack splits its damage across the enemy's stacks by `allocate`, which weights by
   `threatWeight` (damage per point of enemy health) times how many of them there are, with a
   taunting stack pulling its share off the top first (`tauntPull`, below) and an officer drawing
   `OFFICER_TARGET_SHARE` of what an equal threat would.
3. **Medics.** The _receiving_ side's own medics take a share off what is landing, before it lands
   (`mend`), closing on `MAX_MEND_SHARE` without reaching it (see "No hard caps" below).
4. **Damage.** Walked down the stack's bodies, front to back (`takeDamage`). A stack keeps one
   health value per standing body (`Stack.bodies`): the front body is the only one ever part-hurt,
   everything behind it is whole, and `pool` and `alive` are its sum and its length. The front body
   absorbs what it can and dies at zero, the remainder passes to the next, and whatever is left
   when the last body falls is lost rather than spilling onto another stack. The Executioner is a
   line inside this walk: on the Blacksite a body sent against him is finished the moment it is
   brought to `EXECUTIONER_THRESHOLD` of a life, and what it had left below the line is forfeited,
   neither spent on that body nor carried to the next. An officer's body is never on the line
   (§D4).
5. **Morale.** Every stack tests: see below. Stacks that break stop firing. Both sides read the
   other's menace and head count from one snapshot taken before either tests (`moraleOutlook`),
   for the same reason both fire from one.
6. **Pursuit.** Each body of a stack that broke this round is run down with `PURSUIT_LOSS` (20%)
   odds while it disengages, on its own draw from the fight's stream (maintainer, 2026-09-29). It
   was a fifth of the stack, rounded, so a stack of one or two was never caught at all.

The loop runs to `MAX_ROUNDS` or until one side has nobody fighting. If both collapse in the same
round it is settled on `residualPower`, which counts broken stacks at `BROKEN_WEIGHT`.

### No hard caps

The maintainer's rule for unit effects (2026-09-29): more of a unit is always at least slightly
better, and nothing stops paying at a line. The three effects that were `min(1, ...)` now go
through `softCap(x, knee, ceiling)` (`battle/soft-cap.ts`): `x` up to the knee, then an
exponential approach to the ceiling that leaves the knee at the same slope. Each is swept in
`engine.test.ts` for never lowering a side's win rate when more of the unit is added.

- **Taunt.** The taunting stacks take
  `TAUNT_PULL x softCap(taunt slots / (TAUNT_FULL_SHARE x line slots), 1, TAUNT_CEILING)` of each
  enemy stack's fire: 75% once the wall is half its line's unit slots, a little more past that
  towards 82.5%, counted off who is standing now. One Ironside in front of 40 Razors takes about
  a tenth. The knee is left sharp because the ruled anchors need it:
  a p-norm curve that bent early took 22 Razors and 6 Ironsides against 40 from 70% to 39%.
- **Intimidation.** Each unit slot frightens `INTIMIDATION_REACH` (1.5) slots of the enemy line.
  The pressure a line feels is the enemy's mean intimidation times `intimidationReach`, its reach
  over the line's slots, eased past `INTIMIDATION_KNEE` (0.8) towards all of it. A mirror is
  reached in full. Two Juggernauts (12 slots) reach 18 of 40 Razors.
- **Medics.** `MAX_MEND_SHARE` is 0.3, from a hard 0.45, and is the ceiling of
  `softCap(cover, MEND_KNEE, 1)` rather than a cut-off: linear up to 0.7 of full cover, then each
  medic adds less. Six Stitchers behind thirty Razors undo about 24% of a round.

### Before round one

- **Intimidation** (`intimidate`). Each side's total nerve, which is the morale of every unit in it, is
  compared with the other side's total menace. Where the pressure is greater the excess buys
  silence, cheapest first: the shakiest units do not fire this fight. They still stand in the line
  and still take casualties, so intimidation is not a way of killing anybody.
- **The ambush** (`ambushShare`). Only the attacker can take one, and only with enough stealth to
  beat what the enemy can see. Worth a fraction of a round, never a whole one: a free round is a
  coin flip decided before the fight starts. Three terms multiply: how far the side's stealth
  beats the enemy's, how much of the force is actually hidden, and `AMBUSH_ROUND_SHARE`. The
  middle one is where the `ambush` mark is paid for, since a marked body hides whole and an
  unmarked one at `STEALTH_UNTAGGED_SHARE`. It was missing until 2026-09-21, and without it the
  mark was worth exactly nothing: the stealth term is a weighted mean, so for a force whose
  stacks are marked alike the weight cancelled and the mark bought no share at all.

### Traps

A trap goes off before round one and is spent whatever happens next (`battle/traps.ts`,
`springAnyTrap` in the server's settle). A Colossus in the column walks through any of them.

- **A bite** takes `bite x sqrt(attacking units)` off the column, rounded, at least one, spread
  over the stacks in proportion. No ceiling and no share: a bigger column always loses a little
  more and a smaller part of itself (maintainer, 2026-09-29). It used to be a share of the column up
  to a ceiling in units, and at even strength it decided the fight: 40 Razors and 10 Breakers
  against the same won 51.5% of 200 seeds and 3% once Pressure Plates had taken three of them.
  The engine turns on single units near parity (one unit off an even 50-a-side attack took it from
  53% to 30%, at 200 a side to 35% and at 1,000 to 45%, over 150 to 300 seeds), and less so the
  bigger the fight, so the bite grows with the square root.
- **Razor Wire** kills nobody. The attack loses `speedCut` speed and `moraleCut` running morale
  for its first `rounds` rounds, and gets both back after them (`SideSetup.slowed`, `inTheWire`,
  `clearTheWire`). Speed is read as reach and closing, so the wire is worth most in front of a
  line that shoots. The morale is handed back because a cut that lasted the fight decided big even
  ones: 4 points kept took 1,000 a side from 53.5% to 8%, and 4 points for two rounds to 36.5%.

Measured over 300 seeds on 40 Razors and 10 Breakers a side, scaled, and against a rifle line
(24 Razors, 8 Snipers, 6 Breakers). The attack's win rate:

| Trap              | Takes of 50 / 200 / 1,000 | 50 even | 200 even | 1,000 even | vs rifles | Points off per 100 scrap |
| ----------------- | ------------------------- | ------- | -------- | ---------- | --------- | ------------------------ |
| none              |                           | 52.7%   | 54.0%    | 53.3%      | 64.0%     |                          |
| Razor Wire        | nobody, slowed            | 44.3%   | 39.0%    | 46.0%      | 37.0%     | 3.2                      |
| Pressure Plates   | 1 / 2 / 4                 | 31.3%   | 23.0%    | 26.0%      | 59.0%     | 3.0                      |
| Buried Shell      | 1 / 2 / 5                 | 31.3%   | 23.0%    | 21.7%      | 59.0%     | 1.2                      |
| Fuel Fougasse     | 1 / 3 / 6                 | 31.3%   | 13.7%    | 19.0%      | 59.0%     | 1.1                      |
| Prepared Collapse | 2 / 3 / 8                 | 15.3%   | 13.7%    | 12.7%      | 30.0%     | 0.9                      |
| Flooded Cellar    | 2 / 4 / 9                 | 15.3%   | 8.7%     | 11.7%      | 30.0%     | 0.7                      |

The last column is the mean drop over the four fights, per 100 scrap of the trap's price. Against
an attack at 1.3 times the defence every trap leaves it at 100%. `traps-engine.test.ts` holds
Pressure Plates between 25% and 35% on the even 50, every trap at 10% or better, and the wire's
two halves and their hand-back.

## Morale

Modelled on Total War's ladder rather than a hit-point bar, because the interesting property is
that morale runs out _faster the lower it already is_ (`fragility`). Four states: steady, shaken,
wavering, broken. Breaking is a one-way door inside a fight.

Each round a stack takes shock from what it lost, what the enemy's intimidation is worth, being
outnumbered, and how much of the line broke beside it (`ROUT_CASCADE`, which is what turns a bad
round into a collapse). The cascade is charged on the **share of the side's bodies** that ran,
not on the number of stacks: as a count it charged the same ten points whether two men bolted or
half the army did, and that made a force strictly worse for containing anything fragile. Measured
on 2026-09-21, sixty-two Razors beat a Combine line 45% of the time and the same sixty-two with
three Sparks added won none of six hundred; with twenty Sparks they won 86%, so it was a pit and
not a slope. `composition.test.ts` sweeps that shape now. `WINNING_RELIEF` subtracts most of the enemy's casualties from its own: losing a
tenth while the other side loses a fifth is a victory, and a model that charged morale for it made
every even fight end in mutual collapse.

A round where the stack lost nothing it did not give back, nobody broke beside it, and it was not
outnumbered is a **quiet round**, and it steadies by `MORALE_RECOVERY` less whatever the enemy is
worth in ambient fear. Because `WINNING_RELIEF` already zeroes the casualty term for a stack that is
winning its exchange, the side that is ahead is the side that recovers.

Each rung of the ladder costs fire (`moraleFireShare`): a steady stack fires in full, a shaken one
at `SHAKEN_FIRE`, a wavering one at `WAVERING_FIRE`. Until 2026-09-21 the ladder had no consequence
before `routed`, so morale decided how long the losing side lasted and never who lost; see "The
eight ratings" below for why that changed and how the casualty term is netted now.

## The eight ratings

The maintainer's rule (2026-09-21) for the eight bounded ratings on a sheet: speed, stealth,
range, armour, penetration, morale, evasion and intimidation. Damage and vitality are not in it;
they are unbounded and are the dials a unit is finished with after these are set.

**Each rating has its own use, and their overall power sits on a fixed ladder around the average.**
Speed and stealth are a fifth under the average rating, because speed also moves units between
locations and stealth also does the spying. Range is a tenth under. Armour and penetration are the
average. Morale is a tenth over. Evasion and intimidation are a fifth over. The ladder is symmetric,
and it means two sheets with the same total points are not equal: the one that put its points into
evasion rather than range should generally be the stronger unit.

| rating       | target |
| ------------ | ------ |
| speed        | -20%   |
| stealth      | -20%   |
| range        | -10%   |
| armour       | 0      |
| penetration  | 0      |
| morale       | +10%   |
| evasion      | +20%   |
| intimidation | +20%   |

"Power" has a definition, and it is what `ratings.test.ts` measures. A Razors mirror is stood up
with `SideSetup.flat` setting every rating on both sides to 50, except the two offensive ratings,
penetration and intimidation, at 25, which is where the roster sits against armour and morale
(on the kink, where the sums are equal, a rating measures as the whole of its mechanic rather than
the margin). The field is 24 wide so combat width is in play. One rating is then raised by 25 on
the defender and, separately, on the attacker, and two things are read: the extra army the other
side now needs to win half its fights, and how many more of the raised side's bodies come home,
rout included. Power is the average of those four numbers, and the ladder is read relative to
the mean **of the seven that are on rungs**. Stealth is out of the divisor because it is the one
rating the ladder already excuses: leaving it in made every other rung's reading move whenever
stealth did, and a scale whose zero point drifts with a rating nobody is asserting is not a
scale. Measured both ways across the 2026-09-21 ambush change, the seven read identically under
the mean of seven and moved by up to three points under the mean of eight, on absolute powers
that had not moved. A second protocol, everything at 20 and one rating raised to 80, is the extreme case
and is printed for reading rather than pinned, because at 20 morale every line is a round from
breaking and the numbers are about that cliff.

Measured on 2026-09-21 at 60 seeds after the ambush weighting landed, the harness reads speed 24,
stealth 8, range 26, armour 28, penetration 27, morale 30, evasion 32, intimidation 36. Against
the mean of the seven rungs (28.9) that is -16, -9, -2, -8, +3, +10 and +23 per cent, which is
the ladder to within its own noise on all seven. Stealth is the one that cannot get there: its whole combat value is
the rout roll (`STEALTH_ESCAPE_WEIGHT`, clamped at `MAX_FLEE_CHANCE`) and the opening strike
(`AMBUSH_ROUND_SHARE`, now open to unmarked units at `STEALTH_UNTAGGED_SHARE`), and both saturate
before it reaches a fifth under the average. It is pinned as the lowest of the eight rather than
at a number.

What the retune changed, so that each rating has a use of its own:

- **Evasion** scales with the enemy's engagement edges (`exchange`): fire that arrives from reach
  is dodged more (`EVASION_VS_REACH`), an attacker with a closing edge has caught the target and
  is dodged less (`EVASION_VS_CLOSING`), and `MAX_MISS` caps the whole thing. It was a flat miss
  chance that interacted with nothing. `tracking` on the attacker's sheet (Kite Crews and the
  Cartographer) takes half of whatever dodge is left (`evasionCut`), so it counters evasion by cutting the
  miss chance rather than by adding damage.
- **Terror** (`vs_low_morale`, the Hollow Men, the Abomination, the Crimson Dancer, the
  Executioner) pays in two tiers against the target's running morale (maintainer, 2026-09-29):
  `SHAKEN_TERROR_SHARE` (0.4) of the card's 35% below 60, where the report says shaken, and all of
  it below 35, where it says wavering (`terrorShare` in `matchup.ts`, which reads both lines off
  `MORALE_THRESHOLDS`). It was one line at 40, so a target the report called shaken at 45 took
  nothing, and then a full tier at 30, five points inside the wavering band. Measured over 200
  seeds as the defenders it takes to hold the attack half the time, the same seeds for every
  variant: 8 Hollow Men need 43.4 Razors at 35 against 42.8 at 30, 42.8 under the old single line
  and 41.2 with no Terror at all; 19.8 Breakers against 19.7 at 30; the Crimson Dancer 18.4
  Razors either way.
- **Gates** live on their own channel (`gatePercent`), folded into the defender's toughness beside
  `defensePercent`. `breaching` (Breakers, Demolishers) divides that share back out of the hits it
  lands (`Effective.gateToughness`), so for them there is no gate while the rest of their line still
  meets it. A Colossus in the attacking line (`breaksWalls`) zeroes the defender's `gatePercent` for
  the whole fight; the server then spends any trap without kills and lowers the gate it was at
  (`apps/server/src/battle/wall-breaker.ts`). A gate is only in a fight at that gate (maintainer,
  2026-09-28): the server hands the engine a `gatePercent` of zero for a location fight, a raid, or
  a crew whose home Gate is somewhere else.
- **Jamming** (`jammer`, the Netrunners) does two things that stack, each round off the jammers
  still standing. The jam percent (`jamPercent`) weakens every enemy modification by that share of
  what it adds (`Stack.modGain`, `jammedSheet`). It is 17 on nominal ground once jammers are a
  quarter of their own line's unit slots (`JAM_FULL_SHARE`), linear below that, and past it climbs
  slowly towards 18.7 (`JAM_SHARE_CEILING`, a soft cap, never a hard one). It was 40 until the
  maintainer's Netrunner retune of 2026-09-30, which moved their worth from the card jam to the
  Wonder cut and raised their price. The ground can scale it further: exact to 21.25
  (`MAX_JAM_KNEE`), then curving towards 25.5 and never reaching it (`MAX_JAM_CEILING`, `groundedJam`,
  both read off `MAX_JAM`). Jammers and line are both counted in unit slots, not bodies
  (maintainer, 2026-09-30): four 3-slot Netrunners beside 36 Razors are 12 of 48 slots and jam at
  the full 17. And the jammers' unit slots cover Wonders of Engineering, three slots of machine to
  each jammer slot (`WONDER_COVER_PER_SLOT`). A covered machine loses 55% of its damage and armour
  (`WONDER_JAM_STEP`, `WONDER_JAM_KNEE`), and each further jammer's worth of cover cuts deeper by
  less each time, closing on 75% and never reaching it (`WONDER_JAM_NOMINAL_CEILING`: 73.7% at two
  steps). The ground can carry a cut past 75, curving towards 90 (`WONDER_JAM_CEILING`,
  `groundedWonderCut`, `wonderJam`). Machines are covered as many as possible first, smallest
  first, before any cut deepens, and the steps past cover go round them evenly, smallest first. The
  jam reaches every figure a card adds and nothing else (maintainer, 2026-09-29). The ones a round
  reads (`MOD_GAIN_KEYS`: offense, armour, penetration, evasion, range and speed) are jammed each
  round; the ones read once (`FORMATION_GAIN_KEYS`: morale, intimidation, stealth and hit points)
  take the opening jam's share as the lines form, before §D3 and the ambush read them
  (`jamAtFormation`).
- **Range** fires from the second rank (`SECOND_RANK_FIRE`): bodies queued behind the frontage
  still contribute in proportion to their range, so range is worth the most on narrow ground.
  Reach is also a duel now, bounded by the target's range as well as its speed, so two Sniper
  lines no longer both collect it against each other.
- **Morale** has a fire cost on every rung (`moraleFireShare`): steady lines fire in full, shaken
  at nine tenths, wavering at three quarters. Until then the ladder had no consequence before
  `routed`, and since `WINNING_RELIEF` zeroes the casualty shock for whichever side is winning the
  exchange, morale decided how long the loser lasted and never who lost.
- **Intimidation** is mostly its per-round pressure (`INTIMIDATION_PRESSURE`, down from 14 to 6)
  and `CASUALTY_SHOCK` went up from 14 to 35 in the same pass, so a line now breaks mainly from
  what it loses rather than from a clock the enemy's sheet sets. Since 2026-09-29 the pressure is
  scaled by how much of the line the enemy's numbers reach (`intimidationReach`).
- **Stealth** counts towards the opening strike on unmarked units at `STEALTH_UNTAGGED_SHARE`.
- **Casualties** are what a line breaks from. `CASUALTY_SHOCK` went from 14 to 35, and two things
  had to change with it because the retune made them audible. The enemy's loss share is now
  weighted by bodies (`meanLoss`): one Sniper dying beside twenty Razors is a twentieth, not half.
  And the shock is charged on the _increase in a stack's cumulative net deficit_ (its own losses so
  far less `WINNING_RELIEF` of the enemy's, `Stack.charged`) rather than on each round's losses
  netted against each round's. Netted round by round, whether your body fell in the same round as
  theirs was a coin flip worth a full shock, and in a six-body skirmish +15% vitality _lost_
  twelve points of win rate for moving one death from round three to round four. Charged on the
  cumulative deficit, the same skirmish is monotone in every channel.

Tune against the harness, not against a feeling: change a constant, run the test, read the
ladder. The roster's own pins (`balance.test.ts`, the Combine ladders) are a separate question
and are re-statted on top of this, not the other way round.

## After the fight

- **The rout** (`rout.ts`). The losing side rolls per unit, not per stack. The base is the board's
  coin flip, tilted by speed against the pursuit, stealth, how early the stack broke, and whose
  ground it is. Clamped at both ends: nobody is certain to get away and nobody is doomed.
- **The ring** (`perimeter.ts`). Only the **defender** may set one (maintainer, 2026-09-23), and
  it fights only when the defence held: meeting it is a **second battle** on the same ground under
  the same rules, with the attacker's runners attacking and the ring defending. **Nobody flees the
  ring.** Whichever side loses that second fight dies to the last unit, runners or ring: a unit
  that would have fled dies instead, so intimidation, which breaks units rather than killing them,
  kills there. A thin ring in front of a mass breakout is ridden through and dies doing it.
  Catching people quietly pulled out of a deployment _before_ the fight is a different thing and
  stays a toll (`perimeterToll`): as a battle, a player could withdraw one unit at a time and farm
  the ring for free.
- **The ledger** (`economy/infamy.ts`). A kill in the fight pays a slot's worth whole. Making a
  unit run pays **half**, floored on the bulk (`infamyForFled`): three one-slot runners are 1.5,
  paid as 1. A death at the ring pays half too (`infamyForRingDead`), on either side, so a runner
  the ring kills paid a half for running and a half for dying. Battle jobs pay the same halves off
  their own rate (`missionInfamyForFled`).
- **Going home** (the server's `homeFromTheFight`, maintainer 2026-09-28). Whoever is not staying
  on the ground walks home from it on the ordinary clock, with the machines that survived: nobody
  is back on a roster the second a fight ends. A crew that fought in its own district is already
  home, and a gate garrison that held its gate stays on it.
- **The report** (`reportReaches`). A defender is always told: it is their ground, gate or
  district. An attacker is told if they won or if at least one unit got home past the ring. The
  officer counts for nothing towards it.

## Where a bonus comes from

Five sources, all folded onto one set of fields before the engine sees them, so the engine reads one
number per channel and the report can explain itself:

| Source                   | Reaches the fight as                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| Ground the crew holds    | `TerritoryEffects`: offense, vitality, armour, morale, intimidation, speed |
| A bought or looted boost | the same three of those fields (`boostBundle`)                             |
| The officer leading      | a one-unit stack with its own sheet, plus perks (`crew/effects.ts`)        |
| The battlefield's labels | per-unit modifiers via `contexts` (`effects.ts`)                           |
| The crew's co-ordination | `cohesionPercent`, widening the fighting front                             |

`bonuses.test.ts` checks each of these arrives, and each of its assertions fails when that channel
alone is disconnected.

Two of them behave in ways worth knowing:

- **Speed is a difference, not a level.** It reaches the round loop only through `engagementEdge`
  (`reach = range - their speed`, `closing = speed - their speed` weighted by their range), so a
  rebalance that moves every sheet by the same amount moves almost nothing, and a bonus on one side
  moves a lot. `+20% unitSpeedPercent` on 20 Razors against 20 Snipers takes their survivors from
  10.8% to 13.6% over 1500 runs; on the Razors mirror it takes the attacker from 44.4% to 46.9%. It
  is spent again after the fight, on `pursuitSpeed` and `fleeChance`.
- **Cohesion is capped** at `MAX_COHESION_WIDTH`, so 50% and 100% buy the same ground, and on open
  ground (frontage 48) a force of 40 already fits and it buys nothing at all.

## What the numbers actually do

Measured on a 40-v-40 mirror of Razors over 400 seeds each, on open ground:

| Attacker | Wins  | Rounds |
| -------- | ----- | ------ |
| 40 v 40  | 51.7% | 6.8    |
| 41 v 40  | 74.0% | 6.6    |
| 42 v 40  | 88.8% | 6.1    |
| 43 v 40  | 97.5% | 5.7    |
| 45 v 40  | 100%  | 5.0    |

**The contested band is about four units wide out of forty.** One extra unit in forty is worth 22
points of win rate; five make the result certain. A 6% offense edge wins 77% of the time and a 15%
edge wins 95%.

This is Lanchester's square law with a morale cascade on top, and both are deliberate. What is worth
knowing is how little damping there is between them: with `ROUND_LUCK` and `BATTLE_LUCK` set to
zero, 40-v-40 goes to 9% and **41-v-40 goes to 100%**. The day's luck is the only thing that makes
the outcome uncertain at all, and outside a narrow band around parity it does not change who wins.

If a fight should ever be worth taking at a disadvantage, that is the number to move, and it is one
number: `CONCENTRATION_EDGE` damps the feedback and the two luck constants widen the band. At
`ROUND_LUCK` 0.35 the same ladder reads 55%, 63%, 68%, 76%, 86%.

## Depth, and what it costs

Combat width caps what a side can bring to bear; it never charged for exceeding it. Those are two
different mechanics and the engine had only the first.

The rotation the cap's own note promises needed no code and always worked: `frontageShare` is
recomputed every round off who is _still fighting_, so as the front rank falls the queue behind it
becomes the front rank, and a deep side goes on firing at the width of the ground until it is
finally thinner than the ground. Measured on open ground (frontage 48) against 60 defenders, before
any of this changed:

| Attackers | Wins  | Mean survivors |
| --------- | ----- | -------------- |
| 60        | 28/60 | 21.1           |
| 120       | 60/60 | 101.7          |
| 180       | 60/60 | 166.2          |
| 300       | 60/60 | 287.3          |

Depth was never dead weight. It was _free_: the cap held a deep side's output at the width of the
ground while its pool went on growing without limit, so there was no number at which bringing more
stopped being the answer.

Worse, and this is the part that made the mechanic actively wrong: **narrow ground favoured the
bigger force.** Two hundred attackers lost 2.8 men taking a corridor (frontage 10) off forty
defenders, and 20.1 men taking open ground off the same forty. A choke point was doing the attacker
a favour, because the cap silenced both sides equally while only one of them had a deep pool.

`overstackPenalty` is the price, and two decisions in it are worth keeping:

- **It falls on the attacker alone.** The symmetric version was measured first and made narrow
  fights bloodless: both sides are over the width in a corridor, both lose the same share of their
  fire, and the round cap decides a stalemate nobody dies in. A harsher symmetric penalty made this
  _worse_, not better: at a 0.85 ceiling, 200 attackers lost 0.8 men in a corridor.
- **It is on fire, not on toughness.** Crowding makes a force harder to shoot past, not easier to
  kill, and charging toughness would cancel the staying power that is the reason to bring depth in
  the first place. A variant that also raised incoming damage was measured and dropped: it moved
  survivors at 300-v-60 from 287 to 274, which is not worth a second mechanic.

With it, an even fight at a choke goes to whoever is holding it (40 attackers against 40 defenders
in a corridor: 20/60 wins before, 0/60 after) and the way through is the one the game already sells:
at 50% cohesion the same 40 attackers win 51/60, because cohesion widens the frontage this side can
use and is therefore worth exactly as much against the penalty as it is to deployment.

## Every unit answers something

Twenty-one of the thirty-one sheets carried no `resistances` at all, so `damageTypeMultiplier`
returned 1.0 for two thirds of the roster whatever was shooting at it. The axis read as designed on
the ten cards that had one and did nothing anywhere else, which meant the defending player had no
counter-build to make and spying told them nothing they could act on.

Every unit now carries both a resistance and a weakness, and `matchup.test.ts` refuses a new unit
that arrives with an empty sheet. The spine the ten authored sheets already drew, now applied to all
of them: armour answers blade and ballistic and dreads blast; energy is the anti-machine type and
the unaugmented shrug it off; chemical is the anti-organic type and the sealed shrug it off.

The sheet is the same sheet on both sides of the line, and always was: `exchange` reads the sheet of
whichever stack is the _target_ of that exchange, and both sides fire through it. Measured, 40
energy-weak Hollow Men against 40 Netrunners leave 11.7 standing when they attack and 11.4 when they
hold, which is the same fight twice.

One thing to watch when authoring: **blade is dealt by fourteen of the thirty-one units and
explosive by three**, so an answer to blade is worth nearly five times an answer to explosive. A
first pass that spread blade resistance around on flavour alone pushed eight pairs out of the gate
ladder in `balance.test.ts`, all of them blade-dealers gated deep.

## Things that were wrong

Kept because each of them was invisible and each would be easy to reintroduce.

- **Fire was split across the enemy's stack _list_, not its units.** `threatWeight` is per unit and
  `allocate` normalised it per stack, so a one-unit stack drew the same share as a forty-unit one:
  about half the enemy's entire fire, into a pool it could not absorb, with the rest discarded as
  overkill. Any cheap unit was therefore a fire sponge worth most of a free round. It read as
  officers being astonishingly good: attaching one to a mirror took the side from 51.5% to 92.3%
  while the officer dealt 0.1% of the damage, and _removing_ their targeting discount made them
  better still. `allocate` now weights by `enemy.alive`.
- **Officer morale was on the wrong scale.** The board's table gives a 0..100 rating off attributes
  recruited around a mean of 15; roster morale runs 30..100. Spent raw, an ordinary officer started
  at 15, under `MORALE_THRESHOLDS.wavering`, and broke almost at once, cascading onto the crew they
  led. It was hidden by the targeting bug; with that fixed, an average officer took a mirror from
  51.5% to **0%**. `officerMorale` now maps the rating onto the roster's band.
- **The defender's morale test read a thinner attacker.** The two tests ran one after the other,
  and the second (the defender's) read the attacker's head count and mean intimidation after the
  attacker's own breaks that round had been marked, while the attacker's test saw the defender
  whole. Mirrors on bare ground over 3,000 seeds: Juggernauts won 44.8% attacking, Breakers
  46.8%, Razors 48.3%. From one snapshot all three read 50%. Small officer-led fights moved the
  most: a Raid Boss with four Razors on a grade E job went from 48 practice wins in 48 to 13.
- **The forecast's "walk out" figure was the share still standing.** On a lost fight most of
  those are routing bodies the rout then rolls for, so 40 Razors against 60 read 54% and brought
  home 32%. It is now the winner's standing and the loser's expected runners (`escapeChance`),
  counted as the report counts a force.
- **One Ironside screened any line.** The taunt pulled a flat 75% of every enemy stack's fire
  whatever the wall's size, so 36 Razors and 1 Ironside beat 40 Razors in 300 of 300 fights, the
  Ironside never fell, and 200 and 1 beat 203 every time. Scaled by share, 36+1 wins 33% (39 Razors
  win 30%), 30+3 wins 26% and 22+6 wins 70%, over 1,000 seeds.
- **Two Juggernauts routed any number of Razors.** The per-round pressure was the enemy's mean
  intimidation with no term for numbers: 2 Juggernauts beat 40 Razors 100% of the time and 100
  Razors 99%, and 3 beat 200 Razors 88%. With fear reaching 1.5 slots per slot they win 0% against
  40 and against 100, and still 100% against 12, over 300 seeds.
- **Six slots of Stitchers were worth ninety points of win rate.** Under a hard 0.45 ceiling 30
  Razors and 6 Stitchers beat 38 Razors every time and 36 Razors won 10%. With the ceiling at 0.3
  and soft, the medics win 76% and the Razors 9%: still the stronger six slots, no longer a sure
  thing.
- **Morale recovery could not happen.** The recovery branch was `damage > 0 ? -damage :
MORALE_RECOVERY`, and `damage` included the enemy's ambient intimidation, which is present every
  round of every fight. Against an enemy at intimidation 0 every morale level recovered; against one
  at 10, none did, at any level. One unit in the roster sits at zero intimidation, so the constant
  was unreachable and the mechanic did not exist.
