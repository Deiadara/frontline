import {
  capRating,
  effectiveSpeed,
  findUnit,
  fittedFor,
  fleetCapacity,
  ridingUnitSlots,
  upgradedStats,
  unitSlotsUsed,
  deploymentIsOpen,
  emptyDeployment,
  movementForce,
  mulberry32,
  perimeterToll,
  seedFrom,
  unitsBeyondNotoriety,
  type Army,
  bareLineRules,
  type BattleDeployment,
  type BattleSide,
  type Base,
  type Movement,
  type LineRules,
  type ScheduledBattle,
  type DeployQuoteResponse,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { forceSize, isFightingForce, mergeArmies, removeForce } from './forces.js';
import { tallyDeployed } from '../feats/tally.js';
import { defendingBaseOf } from './ground.js';
import { sideForce } from './side.js';
import { columnMinutesTo, railColumnOffer, sendColumn } from './movement.js';
import { standingEffectsFor } from '../crew/standing.js';
import { insideLock, placeLocked } from './lock.js';
import { alignmentReader, fightPlaceFor } from './alignment.js';
import { walkHome } from '../moves/moves.js';

/**
 * Moving people to a fight that has not happened yet (GDD §A4, battle rework).
 *
 * The board's rules, in order:
 *
 * - Anybody in the fight may send units **right up to one second before the mark**. Taking them back
 *   is allowed until the fight's **last hour** (`battle/lock.ts`, maintainer 2026-09-28): after
 *   that nothing leaves the place of the fight, and whoever is standing there at the mark fights.
 * - Units on the ground have **left the roster**. That is what makes the freedom safe: a crew that
 *   promised the same twenty Razors to three fights would be discovering which one they turned up
 *   at, and the answer would be a bug rather than a decision.
 * - Nothing arrives or leaves in an instant. A column walks to the fight (`battle/movement.ts`), and
 *   units taken back **walk home** from the place of the fight (`moves/moves.ts`, `walkHome`).
 * - Pulling people back is **not free** if the other side has a ring out. The maintainer asked for this
 *   explicitly: a perimeter takes anybody "pulled back after it was already deployed but taken out
 *   before combat itself". So a late withdrawal past a well-set ring costs units, and a crew that
 *   commits early is committing for real.
 *
 * The ring's toll on a withdrawal is drawn from a stream seeded on the battle *and the moment of the
 * pull-out*, so it is reproducible from the record and cannot be re-rolled by retrying the call.
 */

export const DEPLOY_REFUSALS = [
  'not_a_participant',
  'deployment_closed',
  'not_enough_units',
  /** §A5: a porter is not a soldier. The support tier may never be deployed to a battle. */
  'not_a_fighting_force',
  'needs_infamy',
  /** §C3: the machines this crew has committed cannot seat what it is trying to send. */
  'no_seats',
  /** The ring is the defender's answer to being chosen; an attacker does not get one. */
  'ring_is_the_defenders',
  /**
   * The last hour before a fight (`battle/lock.ts`): nothing is taken back out of this one, and
   * nothing leaves home while a raid on it is about to land.
   */
  'garrison_locked',
] as const;
export type DeployRefusal = (typeof DEPLOY_REFUSALS)[number];

export interface DeployInput {
  base: Base;
  battle: ScheduledBattle;
  side: BattleSide;
  /** Positive sends units to the ground; negative brings them home. */
  changes: Record<string, number>;
  perimeterChanges: Record<string, number>;
  /**
   * Put the departing column on Terminus's line, when this crew holds a pair of platforms that
   * serves the journey. Optional, and marching is the default: see `DeployRequestSchema.byRail`.
   */
  byRail?: boolean;
  now: Date;
}

/**
 * The two clocks for a column that has not been sent yet.
 *
 * Reads the same fold, the same pace and the same railway the send does, so the quote and the
 * journey cannot come apart. `changes` is the batch about to be sent; only the positive side of it
 * is going anywhere, which is what `departingFrom` picks out.
 */
export function deployQuote(repos: Repositories, input: DeployInput): DeployQuoteResponse {
  const army = departingFrom(input.changes);
  const perimeter = departingFrom(input.perimeterChanges);
  const committed = repos.sieges.deployment(input.battle.id, input.side, input.base.id);
  const riding = {
    army: mergeArmies(army, perimeter),
    vehicles: committed?.vehicles ?? {},
  };
  // The same flag `sendColumn` spends: naming an officer for this fight buys a shorter road, and a
  // quote that does not fold it is a quote the arrival will beat.
  const led = committed?.officerId != null;
  const road = columnMinutesTo(repos, input.base, input.battle.target.districtId, riding, led);
  /*
   * When a column sent now lands, and whether that is in time: the same sum `sendColumn` makes
   * (`now` plus the whole minutes of the road) against the same test `settleMovements` applies
   * (landing after the mark is not being in the fight).
   */
  const mark = Date.parse(input.battle.scheduledFor);
  const landing = (minutes: number) => {
    const at = input.now.getTime() + minutes * 60_000;
    return { arrivesAt: new Date(at).toISOString(), inTime: at <= mark };
  };
  if (road === null) return { minutes: 0, ...landing(0), rail: null };

  const offer = railColumnOffer(
    repos,
    input.base,
    input.battle.target.districtId,
    riding,
    road,
    led,
  );
  return {
    minutes: road,
    ...landing(road),
    rail:
      offer === null
        ? null
        : {
            minutes: offer.minutes,
            boardAt: offer.boardAt.name,
            alightAt: offer.alightAt.name,
            walkMinutes: offer.toPlatform + offer.fromPlatform,
            ...landing(offer.minutes),
          },
  };
}

/** Only what is being *sent*: a negative change is a withdrawal and walks nowhere. */
function departingFrom(changes: Record<string, number>): Army {
  return Object.fromEntries(Object.entries(changes).filter(([, delta]) => delta > 0));
}

export interface DeployOutcome {
  base: Base;
  deployment: BattleDeployment;
  /** Units the enemy's ring took off a withdrawal. Empty in the ordinary case. */
  lostOnTheWayOut: Army;
  /** The column that just set out, or null when this call only brought people home. */
  departed: Movement | null;
}

export type DeployResult =
  { kind: 'refused'; reason: DeployRefusal } | ({ kind: 'ok' } & DeployOutcome);

/**
 * The ring the other side currently has standing outside this fight.
 *
 * The whole other side, allies included: a perimeter is what you would have to get past, and it
 * does not matter to the crew walking into it whose name is on each unit.
 */
function enemyRing(repos: Repositories, battle: ScheduledBattle, side: BattleSide): Army {
  const other = side === 'attacker' ? 'defender' : 'attacker';
  return sideForce(repos, battle.id, other, battle.scheduledFor).perimeter;
}

/**
 * Whether the crew that posted the ring fields its porters (`carriers_fight`).
 *
 * The ring is the defender's by rule, so this is the defending crew's fold. `bareLineRules` when
 * the ground has no crew behind it: the Combine and an unoccupied lot have bought nothing.
 */
function ringOwnerRules(repos: Repositories, battle: ScheduledBattle, now: Date): LineRules {
  const holder = defendingBaseOf(repos, battle);
  return holder === undefined ? bareLineRules() : standingEffectsFor(repos, holder, now);
}

export function adjustDeployment(repos: Repositories, input: DeployInput): DeployResult {
  const { base, battle, side, now } = input;

  if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
    return { kind: 'refused', reason: 'deployment_closed' };
  }

  const at = now.toISOString();
  const existing =
    repos.sieges.deployment(battle.id, side, base.id) ??
    emptyDeployment(battle.id, base.id, side, at);
  if (existing.baseId !== null && existing.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_a_participant' };
  }
  // Only the defender may set a ring (maintainer, 2026-09-23): the attacker chose the ground and
  // the hour, and the ring is what the defender does about having been chosen.
  /*
   * Only the defender may *post* a ring, and either side may take one home (bug pass, 2026-09-23).
   *
   * This refused any change at all, withdrawals included, which stranded units for good on any
   * attacker row that already carried a ring: a row written before the 2026-09-23 rule, or a
   * column dispatched before it and landed after (`battle/movement.ts` merges a column's
   * perimeter into the row for either side). `assemble` reads only the defender's ring, so those
   * units never fight; nothing folds an attacker's ring back into a roster; and this refusal was
   * the last door out. `delta > 0` refuses the posting and allows the retrieval.
   */
  if (side === 'attacker' && Object.values(input.perimeterChanges).some((delta) => delta > 0)) {
    return { kind: 'refused', reason: 'ring_is_the_defenders' };
  }

  // §D7: the heaviest things on the roster will not take a contract from a nobody. Checked across
  // both forces at once so a crew cannot slip a legend onto the ring instead of into the line.
  const sending = [input.changes, input.perimeterChanges].reduce<Army>(
    (total, changes) => ({
      ...total,
      ...Object.fromEntries(
        Object.entries(changes)
          .filter(([, delta]) => delta > 0)
          .map(([unitId, delta]) => [unitId, (total[unitId] ?? 0) + delta]),
      ),
    }),
    {},
  );
  if (unitsBeyondNotoriety(sending, base.economy.notoriety).length > 0) {
    return { kind: 'refused', reason: 'needs_infamy' };
  }

  /*
   * Read once, here, rather than three times further down.
   *
   * The seat check and the ring's toll each opened their own read of the same crew, and the
   * fighting-force gate below needs a third: `carriers_fight` is a crew effect, so whether a
   * porter may be sent at all is a question about this crew and not about the catalogue.
   */
  const effects = standingEffectsFor(repos, base, now);
  const lineRules: LineRules = { carriersFight: effects.carriersFight, unitMarks: {} };

  let army = base.army;
  let onTheGround = { ...existing.army };
  let ring = { ...existing.perimeter };
  const pulled: Army = {};
  /*
   * What is *setting out* rather than what is arriving.
   *
   * A positive delta takes the units off the roster here and puts them in a column
   * (`battle/movement.ts`); they join the deployment when they get there. A negative delta is the
   * old, immediate withdrawal: those units are already standing on the ground.
   */
  const departing = { army: {} as Army, perimeter: {} as Army };

  const move = (
    changes: Record<string, number>,
    force: Army,
    outbound: 'army' | 'perimeter',
  ): Army | DeployRefusal => {
    let next = { ...force };
    for (const [unitId, delta] of Object.entries(changes)) {
      if (delta === 0) continue;
      /*
       * A key that does not name a fighting unit is refused, whichever direction it goes.
       *
       * The check used to sit inside the `delta > 0` branch only, so a *withdrawal* naming
       * `constructor` or `toString` reached `force[unitId]`, which on a plain object is a function
       * rather than `undefined`: `Math.min(-delta, fn)` is `NaN`, the `back === 0` guard does not
       * catch `NaN`, and the roster took a `NaN` count. `DeployRequestSchema` now keys on the unit
       * id so nothing like that arrives, and this is the second lock: a handler that reads a key
       * off an object should be the one deciding which keys it will read.
       *
       * Asked through `isFightingForce` rather than `isCombatUnit` so this door reads the same
       * rule the engine's rounds do: a crew holding `carriers_fight` may send its porters.
       */
      if (!isFightingForce({ [unitId]: 1 }, lineRules)) return 'not_a_fighting_force';
      if (delta > 0) {
        if ((army[unitId] ?? 0) < delta) return 'not_enough_units';
        army = removeForce(army, { [unitId]: delta });
        departing[outbound] = mergeArmies(departing[outbound], { [unitId]: delta });
      } else {
        const back = Math.min(-delta, next[unitId] ?? 0);
        if (back === 0) continue;
        next = removeForce(next, { [unitId]: back });
        pulled[unitId] = (pulled[unitId] ?? 0) + back;
      }
    }
    return next;
  };

  const movedArmy = move(input.changes, onTheGround, 'army');
  if (typeof movedArmy === 'string') return { kind: 'refused', reason: movedArmy };
  onTheGround = movedArmy;

  const movedRing = move(input.perimeterChanges, ring, 'perimeter');
  if (typeof movedRing === 'string') return { kind: 'refused', reason: movedRing };
  ring = movedRing;

  /*
   * The last hour (`battle/lock.ts`, maintainer 2026-09-28), in both of its directions here.
   *
   * Nobody is taken back off this fight once its last hour has begun: whoever is standing on it
   * then is standing on it at the mark. And nobody leaves home for anywhere while a raid through
   * this crew's own breach is inside its last hour, because the district army is the thing that
   * raid meets. Sending people *to* that raid, onto its ring, is not leaving it, which is what
   * `battle.id` is passed for. Arriving is never locked.
   */
  if (forceSize(pulled) > 0 && insideLock(battle, now)) {
    return { kind: 'refused', reason: 'garrison_locked' };
  }
  const sendingNow = forceSize(departing.army) + forceSize(departing.perimeter) > 0;
  if (sendingNow && placeLocked(repos, base, { kind: 'district' }, now, battle.id)) {
    return { kind: 'refused', reason: 'garrison_locked' };
  }

  /*
   * §C3: the seats are the ceiling, and they are the ceiling here rather than only in the browser.
   *
   * The deploy window has capped a batch by unit slots since 2026-09-15 ("once you choose vehicles
   * you're limited up to that much"), and the route took whatever was posted: the rule was a piece
   * of the client, which is to say not a rule. Checked on the whole muster rather than on the
   * batch, because the ceiling is about what will be standing there when the clock runs out, and
   * skipped entirely when nothing is loaded, which is the walk and has no ceiling.
   *
   * Priced through `ridingUnitSlots` and `fleetCapacity`, the same two functions the window and
   * the settler use, so there is one arithmetic and not three that agree by inspection.
   *
   * ## The columns on the road count, because they are coming
   *
   * They were in neither force this read: a column has left the roster and has not joined the row
   * (`battle/movement.ts`), so the same batch posted twice was measured against the same empty
   * ground twice. One motorcycle seats two Razors and two requests put four under it; ten put
   * twenty. Read off the movement table for this crew's own rows on this side, which is exactly
   * what `settleMovements` will fold into the row when they land.
   *
   * Only asked of a request that is actually sending somebody. A pull-out adds nothing to the
   * ground, and refusing one because a column that left yesterday is over the ceiling would strand
   * those units with no door out, which is the shape of the attacker-ring defect next door.
   */
  const seats = fleetCapacity(existing.vehicles);
  if (seats > 0 && sendingNow) {
    const walking = repos.movements
      .forBattle(battle.id)
      .filter((movement) => movement.baseId === base.id && movement.side === side)
      .reduce<Army>((total, movement) => mergeArmies(total, movementForce(movement)), {});
    const aboard = ridingUnitSlots(
      mergeArmies(
        mergeArmies(
          mergeArmies(onTheGround, ring),
          mergeArmies(departing.army, departing.perimeter),
        ),
        walking,
      ),
      effects.anyRide,
    );
    if (aboard > seats) return { kind: 'refused', reason: 'no_seats' };
  }

  // The ring's bite on the way out. Seeded on the battle and the moment of the pull-out so the same
  // withdrawal always costs the same, and a retried request cannot shop for a better roll.
  let lostOnTheWayOut: Army = {};
  /** Whoever got past the ring, who now walk home from the place of the fight. */
  let pulledHome: Army = {};
  if (forceSize(pulled) > 0) {
    const next = mulberry32(seedFrom(`${battle.id}:withdraw:${at}`));
    /*
     * The sheet the crew actually fields, not the catalogue's.
     *
     * Speed and stealth decide who slips a ring, and `rout.ts` reads both off the effective stack
     * while this read the printed spec: a Ghost Wrap bolted on in the yard moved the odds of
     * getting away from a lost fight and nothing at all for the same units walking out of the
     * deployment a day earlier.
     */
    const { caught, escaped } = perimeterToll(
      pulled,
      enemyRing(repos, battle, side),
      next,
      (unitId: string) => {
        const printed = findUnit(unitId)?.stats;
        // Unreachable in practice: `move` refuses anything that is not a combat unit before this
        // runs. Answered rather than asserted because a sheet nobody can find is one nobody can
        // catch either, which is what `catchChance` does with it.
        if (!printed) return { speed: 0, stealth: 0 };
        const fitted = upgradedStats(printed, fittedFor(base.unitLoadouts, unitId));
        return {
          speed: effectiveSpeed(fitted.speed, { percent: effects.unitSpeedPercent }),
          stealth: capRating(Math.round(fitted.stealth * (1 + effects.unitStealthPercent / 100))),
        };
      },
      /*
       * The **ring owner's** rules, not this crew's.
       *
       * Only the defender posts a ring, so the question is whether *they* field their porters:
       * `carriers_fight` is a holding, and a crew that has bought it has a real ring made of them
       * (`perimeter.ts`). This passed nothing, so the toll always read the bare rules and a
       * porter ring caught nobody, while the same ring fought a breakout out of a lost battle.
       *
       * `bareLineRules` for ground with no crew behind it, which is the same reading
       * `resolve.ts` takes for a Combine-held lot: nobody has bought a holding for a lot that has
       * no owner.
       */
      ringOwnerRules(repos, battle, now),
    );
    lostOnTheWayOut = caught;
    pulledHome = escaped;
  }

  // On the road. Nothing joins the deployment on this request: `settleMovements` does that when
  // the column lands, which is what makes sending early a commitment and sending late a gamble.
  const walking =
    forceSize(departing.army) + forceSize(departing.perimeter) > 0
      ? sendColumn(repos, {
          base,
          battleId: battle.id,
          side,
          toDistrictId: battle.target.districtId,
          army: departing.army,
          perimeter: departing.perimeter,
          now,
          // The railway, if this crew asked for it and holds a pair of platforms that serves the
          // journey. Ignored when there is no ride: a stale screen gets the march, not a refusal.
          byRail: input.byRail === true,
        })
      : null;

  const deployment: BattleDeployment = {
    ...existing,
    baseId: base.id,
    army: onTheGround,
    perimeter: ring,
    updatedAt: at,
  };
  repos.sieges.putDeployment(deployment);

  /*
   * Home on foot (maintainer, 2026-09-28: "Nothing sends units immediately"). They used to be back
   * on the roster the moment the request landed, which made a withdrawal from a fight across the
   * city the fastest road in the game. A raid on the crew's own district is the one place that is
   * already home, and `walkHome` puts them straight back there.
   */
  const place = fightPlaceFor(battle, base);
  if (place.kind === 'district') army = mergeArmies(army, pulledHome);
  const next: Base = { ...base, army };
  repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
  if (place.kind !== 'district') walkHome(repos, next, place, pulledHome, {}, now);
  /*
   * Feats: what this crew has ever put on the ground (maintainer request, 2026-09-13).
   *
   * `sending` is the positive half of both change sets, so pulling people back counts for nothing
   * and adding to a muster twice counts twice. Both are right: the ladder asks how much has ever
   * been committed, and a crew that withdrew and re-committed did commit twice.
   *
   * Counted here, at the muster, rather than when the fight resolves. That is when the decision
   * was made, and a fight later called off still cost the crew the days its people spent standing
   * on somebody else's street.
   */
  tallyDeployed(repos, base.id, { units: forceSize(sending), unitSlots: unitSlotsUsed(sending) });
  return { kind: 'ok', base: next, deployment, lostOnTheWayOut, departed: walking };
}

/** Which side of a fight this crew is on, or null when they are watching it. */
export function sideOf(
  repos: Repositories,
  battle: ScheduledBattle,
  baseId: string,
): BattleSide | null {
  if (battle.attackerBaseId === baseId) return 'attacker';
  /*
   * Anybody with a row on a side is on that side, which includes an ally who came to help rather
   * than only the two crews the declaration names.
   *
   * The defending half of this was here; the attacking half was not, and `/factions/reinforce`
   * puts an ally on *either* side. So a crew that sent units to a friend's attack was told "You are
   * not in that fight" by `/battles/deploy` and `/battles/withdraw`, could not take those units
   * back out through the ordinary screen (which is the route the reinforce endpoint's own comment
   * says is the way to do it), and the fight did not appear on their battle board at all.
   */
  /*
   * ...and only while it is still on that side (bug pass, 2026-09-28). A crew that has left the
   * faction it came to help, or joined the other one, keeps its row until the mark moves or parks
   * it (`musterAtTheMark`), but it is not in the fight any more and cannot keep feeding the row.
   */
  const aligned = alignmentReader(repos, battle)(baseId);
  for (const side of ['attacker', 'defender'] as const) {
    if (aligned !== side) continue;
    if (repos.sieges.side(battle.id, side).some((row) => row.baseId === baseId)) return side;
  }
  /*
   * And the crew the call was *on*, which is not always the party on the plate.
   *
   * This read `battle.defender` alone, which for residential ground is `unoccupied`: a home
   * district holds no locations, so nobody "holds" it in the control table however plainly
   * somebody lives there. Meanwhile the settler assembles the defence from `defendingBaseOf`, the
   * red mark counts the same way, and the report names the same crew. So the one crew whose whole
   * roster was about to fight, and be written back over, was told `You are not in this one.` and
   * refused by this module's own deploy route. Asking the same question the settler asks is the
   * whole fix.
   */
  return defendingBaseOf(repos, battle)?.id === baseId ? 'defender' : null;
}
