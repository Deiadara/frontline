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

1. **Concentration.** `concentrationFor` gives a side a multiplier for having more bodies engaged
   than the enemy, weighted by how much of it shoots rather than swings (`rangedShare`). A shield
   wall gets nothing for being twice as many.
2. **Fire.** Each stack splits its damage across the enemy's stacks by `allocate`, which weights by
   `threatWeight` (damage per point of enemy health) times how many of them there are, with a
   taunting stack pulling `TAUNT_PULL` off the top first and an officer drawing
   `OFFICER_TARGET_SHARE` of what an equal threat would.
3. **Medics.** The _receiving_ side's own medics take a share off what is landing, before it lands
   (`mend`), capped at `MAX_MEND_SHARE`.
4. **Damage.** Applied to a health pool; bodies fall out of the pool. Overkill on a stack is lost
   rather than spilling onto the next one.
5. **Morale.** Every stack tests: see below. Stacks that break stop firing.
6. **Pursuit.** A stack that broke this round is run down for `PURSUIT_LOSS` of itself while it
   disengages.

The loop runs to `MAX_ROUNDS` or until one side has nobody fighting. If both collapse in the same
round it is settled on `residualPower`, which counts broken stacks at `BROKEN_WEIGHT`.

### Before round one

- **Intimidation** (`cow`). Each side's total nerve, which is the morale of every body in it, is
  compared with the other side's total menace. Where the pressure is greater the excess buys
  silence, cheapest first: the shakiest bodies do not fire this fight. They still stand in the line
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

- **The rout** (`rout.ts`). The losing side rolls per body, not per stack. The base is the board's
  coin flip, tilted by speed against the pursuit, stealth, how early the stack broke, and whose
  ground it is. Clamped at both ends: nobody is certain to get away and nobody is doomed.
- **The ring** (`perimeter.ts`). If the winner set a perimeter, meeting it is a **second battle** on
  the same ground under the same rules, with the runners attacking and the ring defending. Losing
  that one means a second rout roll at `PERIMETER_FLEE_PENALTY`, which is half the ordinary chance.
  A thin ring in front of a mass breakout is ridden through, and it takes casualties doing it.
  Catching people quietly pulled out of a deployment _before_ the fight is a different thing and
  stays a toll (`perimeterToll`): as a battle, a player could withdraw one body at a time and farm
  the enemy's ring for free.

## Where a bonus comes from

Five sources, all folded onto one set of fields before the engine sees them, so the engine reads one
number per channel and the report can explain itself:

| Source                   | Reaches the fight as                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| Ground the crew holds    | `TerritoryEffects`: offense, vitality, armour, morale, intimidation, speed |
| A bought or looted boost | the same three of those fields (`boostBundle`)                             |
| The officer leading      | a one-body stack with its own sheet, plus perks (`crew/effects.ts`)        |
| The battlefield's labels | per-unit modifiers via `contexts` (`effects.ts`)                           |
| The crew's co-ordination | `cohesionPercent`, widening the fighting front                             |

`bonuses.test.ts` checks each of these arrives, and each of its assertions fails when that channel
alone is disconnected.

Two of them behave in ways worth knowing:

- **Speed does nothing in the round loop.** It is spent entirely on the withdrawal: `pursuitSpeed`
  and `fleeChance`. "+20% speed changed no outcome" is correct rather than broken.
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

**The contested band is about four bodies wide out of forty.** One extra body in forty is worth 22
points of win rate; five make the result certain. A 6% offense edge wins 77% of the time and a 15%
edge wins 95%.

This is Lanchester's square law with a morale cascade on top, and both are deliberate. What is worth
knowing is how little damping there is between them: with `ROUND_LUCK` and `BATTLE_LUCK` set to
zero, 40-v-40 goes to 9% and **41-v-40 goes to 100%**. The day's luck is the only thing that makes
the outcome uncertain at all, and outside a narrow band around parity it does not change who wins.

If a fight should ever be worth taking at a disadvantage, that is the number to move, and it is one
number: `CONCENTRATION_EDGE` damps the feedback and the two luck constants widen the band. At
`ROUND_LUCK` 0.35 the same ladder reads 55%, 63%, 68%, 76%, 86%.

## Things that were wrong

Kept because each of them was invisible and each would be easy to reintroduce.

- **Fire was split across the enemy's stack _list_, not its bodies.** `threatWeight` is per body and
  `allocate` normalised it per stack, so a one-body stack drew the same share as a forty-body one:
  about half the enemy's entire fire, into a pool it could not absorb, with the rest discarded as
  overkill. Any cheap body was therefore a fire sponge worth most of a free round. It read as
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
