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

## One round

Both sides fire from the same snapshot and both take it. Sequential rounds would hand whoever went
first a free volley against a stack that is already dead.

1. **Concentration.** `concentrationFor` gives a side a multiplier for having more units engaged
   than the enemy, weighted by how much of it shoots rather than swings (`rangedShare`). A shield
   wall gets nothing for being twice as many.
2. **Fire.** Each stack splits its damage across the enemy's stacks by `allocate`, which weights by
   `threatWeight` (damage per point of enemy health) times how many of them there are, with a
   taunting stack pulling `TAUNT_PULL` off the top first and an officer drawing
   `OFFICER_TARGET_SHARE` of what an equal threat would.
3. **Medics.** The _receiving_ side's own medics take a share off what is landing, before it lands
   (`mend`), capped at `MAX_MEND_SHARE`.
4. **Damage.** Applied to a health pool; units fall out of the pool. Overkill on a stack is lost
   rather than spilling onto the next one.
5. **Morale.** Every stack tests: see below. Stacks that break stop firing.
6. **Pursuit.** A stack that broke this round is run down for `PURSUIT_LOSS` of itself while it
   disengages.

The loop runs to `MAX_ROUNDS` or until one side has nobody fighting. If both collapse in the same
round it is settled on `residualPower`, which counts broken stacks at `BROKEN_WEIGHT`.

### Before round one

- **Intimidation** (`cow`). Each side's total nerve, which is the morale of every unit in it, is
  compared with the other side's total menace. Where the pressure is greater the excess buys
  silence, cheapest first: the shakiest units do not fire this fight. They still stand in the line
  and still take casualties, so intimidation is not a way of killing anybody.
- **The ambush** (`ambushShare`). Only the attacker can take one, and only with units built for it
  and enough stealth to beat what the enemy can see. Worth a fraction of a round, never a whole one:
  a free round is a coin flip decided before the fight starts.

## Morale

Modelled on Total War's ladder rather than a hit-point bar, because the interesting property is
that morale runs out _faster the lower it already is_ (`fragility`). Four states: steady, shaken,
wavering, broken. Breaking is a one-way door inside a fight.

Each round a stack takes shock from what it lost, what the enemy's intimidation is worth, being
outnumbered, and any ally that broke beside it (`ROUT_CASCADE`, which is what turns a bad round
into a collapse). `WINNING_RELIEF` subtracts most of the enemy's casualties from its own: losing a
tenth while the other side loses a fifth is a victory, and a model that charged morale for it made
every even fight end in mutual collapse.

A round where the stack lost nothing it did not give back, nobody broke beside it, and it was not
outnumbered is a **quiet round**, and it steadies by `MORALE_RECOVERY` less whatever the enemy is
worth in ambient fear. Because `WINNING_RELIEF` already zeroes the casualty term for a stack that is
winning its exchange, the side that is ahead is the side that recovers.

## After the fight

- **The rout** (`rout.ts`). The losing side rolls per unit, not per stack. The base is the board's
  coin flip, tilted by speed against the pursuit, stealth, how early the stack broke, and whose
  ground it is. Clamped at both ends: nobody is certain to get away and nobody is doomed.
- **The ring** (`perimeter.ts`). If the winner set a perimeter, meeting it is a **second battle** on
  the same ground under the same rules, with the runners attacking and the ring defending. Losing
  that one means a second rout roll at `PERIMETER_FLEE_PENALTY`, which is half the ordinary chance.
  A thin ring in front of a mass breakout is ridden through, and it takes casualties doing it.
  Catching people quietly pulled out of a deployment _before_ the fight is a different thing and
  stays a toll (`perimeterToll`): as a battle, a player could withdraw one unit at a time and farm
  the enemy's ring for free.

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
counter-build to make and scouting told them nothing they could act on.

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
- **Morale recovery could not happen.** The recovery branch was `damage > 0 ? -damage :
MORALE_RECOVERY`, and `damage` included the enemy's ambient intimidation, which is present every
  round of every fight. Against an enemy at intimidation 0 every morale level recovered; against one
  at 10, none did, at any level. One unit in the roster sits at zero intimidation, so the constant
  was unreachable and the mechanic did not exist.
