import {
  type LineRules,
  blueprintGateMet,
  describeBlueprintGate,
  BUILDING_CATALOG,
  CITY_DISTRICTS,
  BATTLE_BOOSTS,
  TRAP_CATALOG,
  declarableSlots,
  districtHolder,
  districtIsShut,
  gateIsBroken,
  deploymentIsOpen,
  deployedSize,
  CITY_LOCATIONS,
  findDistrict,
  findLocation,
  isHeldBy,
  blackMarketEffect,
  boostAvailable,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  findBlackMarketGood,
  findTech,
  stashCount,
  hasInfamy,
  itemCount,
  movementCancellable,
  movementSize,
  reportReaches,
  officerBattleStats,
  type BattleLeader,
  type Army,
  type BattleReportView,
  type BattleSide,
  type BattleView,
  type ActionsResponse,
  type BattlesResponse,
  type CallPrices,
  type Base,
  type BoostStash,
  type DistrictGateView,
  type BattleBoostOption,
  type Fleet,
  type ScheduledBattle,
  type SpyTarget,
  type ItemId,
  type StructureDefence,
  type TrapOption,
  armySize,
  battleBoostSlots,
  gateDefensePercent,
  gateIntelResistancePercent,
} from '@frontline/shared';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { sideForce } from './side.js';
import { cityLevelFor } from '../blackmarket/shelf.js';
import { cityContextFor, scoutingRunView } from '../city/view.js';
import { spyRunView } from '../spying/spying.js';
import { moveViews } from '../moves/moves.js';
import { sideOf } from './deploy.js';
import { callPriceFor } from './declare.js';
import {
  defendingBaseOf,
  districtsLivedIn,
  isInhabited,
  residentOf,
  targetName,
} from './ground.js';
import { assemble, battlefieldOf } from './resolve.js';
import { workingRoles } from '../crew/roster.js';
import { officerDuty } from '../crew/duty.js';
import { officerTravelMinutesTo } from './movement.js';

/**
 * The battle board, as one crew sees it (GDD §A4, battle rework).
 *
 * The fog is enforced **here**, on the way out, the same way the city view enforces it: a caller is
 * told what they can see and nothing else is put on the payload. That matters more on this screen
 * than on any other, because the thing being hidden is the one thing worth hiding: what the other
 * side has moved up. A field that was sometimes null would leak by its own shape, so the enemy's
 * composition is not a nullable field: it does not exist. What exists is a *count*, and only when
 * this crew's intelligence is good enough to have one.
 */

/**
 * How many finished fights a crew is handed: **all of them**.
 *
 * It was twenty, which is an archive that quietly throws away the fight you are trying to look up.
 * A report is the only record of what a force did against a particular kind of ground, and the one
 * a player wants is usually not among the last twenty: it is the disaster from a fortnight ago they
 * are trying not to repeat.
 *
 * A cap rather than no argument at all, because the query is `SELECT ... LIMIT ?` and an unbounded
 * one is a payload that grows without end. This is high enough to be an archive in practice and low
 * enough that the response cannot become a megabyte on a crew that has been at war for a year.
 */
export const REPORT_HISTORY = 2000;

/**
 * What this side has on the ground, allies included.
 *
 * The whole side rather than the reader's own row: the muster is "what is standing here", and a
 * screen that showed a player only their own contribution would tell them they were about to fight
 * alone when three of their allegiance had already arrived.
 */
function musterOf(repos: Repositories, battle: ScheduledBattle, side: BattleSide) {
  const deployment = sideForce(repos, battle.id, side, battle.scheduledFor);
  return {
    army: deployment.army,
    perimeter: deployment.perimeter,
    size: deployedSize(deployment),
  };
}

/**
 * What this crew knows of the other side (maintainer, 2026-09-22): its last spy report on the
 * ground the fight is on, and nothing else.
 *
 * There is no free reading any more. The blur this used to compute (their counter-intel against
 * this crew's intel, coarsened) is gone with the intel channels it read, which are spy points
 * now. An attacker who paid to have the place read sees the bodies the report exposed; one who
 * did not sees nothing. A defender sees nothing either way, because nobody spies a column on the
 * road: the ring is still never in any count, and neither is what marched up last night.
 */
function readEnemy(
  repos: Repositories,
  base: Base,
  battle: ScheduledBattle,
  ownSide: BattleSide,
): { size: number | null; quality: string } {
  if (ownSide === 'defender') return { size: null, quality: 'Nobody reads a column on the road.' };
  const target: SpyTarget =
    battle.target.kind === 'location'
      ? { kind: 'location', locationId: battle.target.locationId }
      : { kind: 'gate', districtId: battle.target.districtId };
  const report = repos.spying.latestFor(base.id, target);
  if (!report || report.failed) {
    return { size: null, quality: 'No spy report on this ground. Send one from the district.' };
  }
  return {
    size: armySize(report.exposed),
    quality: `From your spy report of ${report.writtenAt.slice(0, 10)}.`,
  };
}

function viewOf(repos: Repositories, base: Base, battle: ScheduledBattle, now: Date): BattleView {
  const district = findDistrict(battle.target.districtId);
  const resident = residentOf(repos, battle.target.districtId);
  const side = sideOf(repos, battle, base.id);
  const defenderBase = defendingBaseOf(repos, battle);
  const attackerName = repos.bases.findById(battle.attackerBaseId)?.name ?? 'a crew nobody knows';

  const enemy = side ? readEnemy(repos, base, battle, side) : { size: null, quality: '' };
  const muster = side ? musterOf(repos, battle, side) : null;
  // This crew's own row: the deployment screen edits what *you* have sent, not what your allies have.
  const deployment = side ? repos.sieges.deployment(battle.id, side, base.id) : undefined;

  return {
    battle,
    targetName: targetName(battle.target, resident),
    districtName: district?.name ?? 'somewhere',
    role: side ?? 'bystander',
    side,
    deploymentOpen: deploymentIsOpen(new Date(battle.scheduledFor), now),
    muster,
    enemySize: enemy.size,
    enemyIntel: side ? enemy.quality : 'You are not in this one.',
    opponentName:
      side === 'defender'
        ? attackerName
        : (defenderBase?.name ?? holderLabel(battle.defender.kind)),
    /*
     * The ground, through the *same* function that will decide the fight (`battlefieldOf`).
     *
     * The deployment screen forecasts on it. Not a secret from either side: where the fight is and
     * what that ground is like is the one thing a declaration makes public. Fortification is read
     * live rather than frozen, so digging in between now and the mark shows up on both sides'
     * estimates, which is the honest reading of a fortification that is still being built.
     */
    battlefield: battlefieldOf(
      battle,
      district?.name ?? 'somewhere',
      battle.target.kind === 'location'
        ? (repos.city.control(battle.target.locationId)?.fortification ?? 0)
        : 0,
    ),
    // A bystander is not buying anything for a fight they are not in, and sending them the shelf
    // would be sending them the caller's own research and officer list.
    boosts: side
      ? boostsFor(
          base,
          // The force the settle will price this against, not the one on the deployment rows.
          // `reach` is what the drop-down promises, and for a defender the two are not close: a
          // home raid folds in the whole roster and a location folds in the garrison, so a boost
          // quoted at +35% on the screen landed as +7% in the fight. `assemble` is the settler's
          // own function, so the two cannot drift apart again.
          assemble(repos, battle, defenderBase)[side === 'attacker' ? 'attacking' : 'defending'],
          repos.blackMarket.stashFor(base.id),
          cityLevelFor(repos),
          standingEffectsFor(repos, base),
        )
      : [],
    boostIds: deployment?.boostIds ?? [],
    boostSlots: battleBoostSlots(crewEffectsFor(repos, base).battleBoostsFlat),
    officerId: deployment?.officerId ?? null,
    // §C3: what has been committed, and what is still in the yard to commit. Both, because the
    // picker's question is "how many of these am I taking", and the answer is bounded by the sum.
    vehicles: deployment?.vehicles ?? {},
    yard: side ? base.fleet : {},
    // §D1: who this crew could send. A bystander gets nothing, for the same reason they get no
    // shelf: the list is the caller's own roster and it is not the other side's business.
    leaders: side ? leadersFor(repos, base, battle, now, deployment?.vehicles ?? {}) : [],
    // §I4: a trap goes under ground you are holding, so only the defender gets a list. An attacker
    // and a bystander get an empty one rather than no field, which is the same shape the boosts
    // take and keeps the payload from saying which side the reader is on twice.
    traps: side === 'defender' ? trapsFor(base) : [],
    trapId: deployment?.trapId ?? null,
  };
}

/**
 * The officers a crew could put at the front of a column (§D1).
 *
 * Free ones only, by the same question `/battles/lead` asks before it refuses (`officerDuty`): an
 * officer out leading a run, out scouting, at another fight or laid up is left out rather than
 * listed and greyed. Their clock is on the screen that holds them, which is the one place it
 * belongs, and a second copy of it here is a second place for it to drift. The list used to drop
 * the injured alone, so it offered a name the route then turned away with "is out leading a run".
 * The officer already leading *this* fight stays on it, or the picker would lose its own answer.
 * Their combat sheet rides along so the player can weigh a person against a stack of Razors
 * before deciding, which is the whole decision §D1 adds, and so does the road: a leader has to
 * cross the city like anybody else, and how long *this* one takes depends on their own speed and
 * on what the crew has already loaded onto this fight (`officerTravelMinutesTo`).
 */
function leadersFor(
  repos: Repositories,
  base: Base,
  battle: ScheduledBattle,
  now: Date,
  /** What this crew has committed to this fight, which is what the officer may ride. */
  vehicles: Fleet,
): BattleLeader[] {
  return base.commanders
    .filter((officer) => officerDuty(repos, base, officer, now, battle.id) === null)
    .map((officer) => ({
      officerId: officer.id,
      name: officer.name,
      role: officer.role,
      stats: officerBattleStats(officer.attributes),
      travelMinutes: officerTravelMinutesTo(
        repos,
        base,
        battle.target.districtId,
        officer,
        vehicles,
      ),
    }));
}

function holderLabel(kind: ScheduledBattle['defender']['kind']): string {
  switch (kind) {
    case 'government':
      return 'The Combine';
    case 'looters':
      return 'Looters';
    case 'unoccupied':
      return 'Nobody';
    default:
      return 'Another crew';
  }
}

function reportsFor(repos: Repositories, base: Base): BattleReportView[] {
  return repos.sieges.resolvedFor(base.id, REPORT_HISTORY).map(({ battle, analysis }) => {
    const side = sideOf(repos, battle, base.id) ?? 'attacker';
    const reaches = reportReaches(side, analysis);
    return {
      battleId: battle.id,
      targetName: analysis.locationName,
      resolvedAt: battle.resolvedAt ?? '',
      side,
      won: analysis.winner === side,
      // Withheld outright rather than redacted. A redacted report still leaks the shape of what was
      // kept back, and a perimeter is bought to buy a silence.
      analysis: reaches ? analysis : null,
      redacted: !reaches,
    };
  });
}

/**
 * The crew's own structures, as the defence tab lists them.
 *
 * Level, and nothing to buy: a gate's strength is the level it has been raised to (maintainer
 * request), which is bought in the district's own build queue like every other level. The digging
 * that used to sit here bought defence without buying height and is gone; locations keep theirs,
 * where the ground varies and the choice is real.
 */
function structuresOf(base: Base): StructureDefence[] {
  return base.buildings.map((building) => ({
    buildingId: building.id,
    kind: building.kind,
    label: BUILDING_CATALOG[building.kind].name,
    level: building.level,
    /*
     * What the Gate is worth, on the Gate's own row.
     *
     * Both figures are folded from the *whole* district (a modification on another structure can
     * lift the same channels), which is why they are read off the standing fold rather than
     * multiplied out of the level here: the screen must quote the number the fight will use.
     */
    defensePercent: building.kind === 'gate' ? gateDefensePercent(base.buildings) : null,
    intelResistancePercent:
      building.kind === 'gate' ? gateIntelResistancePercent(base.buildings) : null,
  }));
}

/**
 * §I4: what this crew could set under a fight it is defending.
 *
 * The whole catalogue, held or not, for the reason the boost list gives: a trap a player never
 * sees on this panel is a trap they never go to the yard for. What decides the button is the
 * inventory and only the inventory, because the document and the Lab rung were both answered before
 * the yard would cut one, and repeating either here would be a second copy of the Scrapyard's
 * gate wording free to drift from it.
 */
function trapsFor(base: Base): TrapOption[] {
  return TRAP_CATALOG.map((spec) => {
    const held = itemCount(base.inventory, spec.id as ItemId);
    return {
      trapId: spec.id,
      name: spec.name,
      description: spec.description,
      held,
      available: held > 0,
      blocker: held > 0 ? '' : 'None in the bag. The Scrapyard cuts them',
    };
  });
}

/**
 * §D7: what this crew's name will buy on this particular fight.
 *
 * `reach` is computed against everything that will be standing on the ground at the mark, which is
 * the number that makes the drop-down honest: "+35% defence for your heavy units" on a force with
 * no heavy units in it is worth nothing, and a player should be able to see that before they pay
 * rather than after. The caller reads it off `assemble`, the settler's own function, because the
 * deployment rows are not the force for a defender: a location fight folds in the garrison and a
 * home raid folds in the whole roster.
 */
function boostsFor(
  base: Base,
  force: Army,
  stash: BoostStash,
  cityLevel: number,
  /**
   * What this crew counts as a fighting sheet, for the same reason the settler needs it
   * (bug pass, 2026-09-23): a crew holding `carriers_fight` fights with its porters, so a boost's
   * reach has to be priced against a line that includes them. Quoted off `bareLineRules` here, the
   * drop-down promised one number and the fight paid another.
   */
  rules: LineRules,
): BattleBoostOption[] {
  const crew = {
    technologies: base.research.technologies,
    // Chairs, not headcount: a boost unlocked by having a Raid Boss is not unlocked by having
    // signed one and left them on the bench.
    // Working chairs, not merely filled ones: an injured officer unlocks nothing (2026-09-23).
    roles: workingRoles(base.commanders),
  };
  // §D12e: the four manufactured boosts are behind their blueprint as well as behind whoever
  // proposed them. Bound once here rather than per row: the inventory does not change mid-list.
  const boostGate = (boostId: string): boolean =>
    blueprintGateMet(base.inventory, 'battle_boost', boostId);
  const names = BATTLE_BOOSTS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    effect: describeBoostEffect(spec.effect),
    /*
     * Why it is shut, and the blueprint is the half a player can act on.
     *
     * Without this a manufactured boost reads as unavailable with a line about who proposed it,
     * which is a reason the player has already satisfied. The document line comes first for the
     * same reason it is checked first: it is the gate they are part way through.
     */
    // The blueprint line wins while the drawings are what is missing, because that is the half the
    // player can act on. The `??` is not reachable today (the gate only shuts when a document
    // exists to shut it), and it falls back to the proposer rather than to an empty string so that
    // a future boost gated some other way cannot put a blank line on the card.
    source:
      boostGate(spec.id) === false
        ? (describeBlueprintGate('battle_boost', spec.id) ??
          describeBoostUnlock(spec.unlock, (id) => findTech(id)?.name ?? id))
        : describeBoostUnlock(spec.unlock, (id) => findTech(id)?.name ?? id),
    reach: Math.round(boostCoverage(spec.effect, force, rules) * 100),
    affordable: hasInfamy(base.economy.infamy, spec.cost),
    available: boostAvailable(spec, crew, boostGate),
    held: false,
  }));

  /*
   * The crates the crew is carrying, on the same list.
   *
   * Weighted by the city's average level, exactly as the shelf priced them, so what the option
   * says is what the fight applies. `reach` is 100 because contraband lands on the whole force:
   * there is no weight class on a syringe. `affordable` and `available` are both true because the
   * crate is already paid for and already in the bag: what gates it is having one.
   */
  const crates = Object.keys(stash)
    .filter((goodId) => stashCount(stash, goodId) > 0)
    .map((goodId) => ({ goodId, spec: findBlackMarketGood(goodId) }))
    .filter((entry) => entry.spec?.boost !== undefined)
    .map(({ goodId, spec }) => ({
      id: goodId,
      name: spec!.name,
      description: spec!.description,
      cost: 0,
      effect: blackMarketEffect(spec!, cityLevel),
      source: `${stashCount(stash, goodId)} in the bag`,
      reach: 100,
      affordable: true,
      available: true,
      held: true,
    }));

  // Contraband first: it is the part of the list a player can act on without spending anything.
  return [...crates, ...names];
}

/**
 * The front door of every district this crew can see into.
 *
 * Computed here rather than on the district screen, so the answer to "may I attack a location here or
 * only the gate" comes from the same reading of the control table the declaration rules use.
 */
function gatesFor(
  repos: Repositories,
  visible: ReadonlySet<string>,
  now: Date,
): DistrictGateView[] {
  const controls = repos.city.controls();
  // Read once for the whole city rather than per district: this runs for every district a crew can
  // see on every read of the board, and the lookup behind it is a scan.
  const lived = districtsLivedIn(repos);
  return CITY_DISTRICTS.filter((district) => visible.has(district.id)).map((district) => {
    const gate = repos.sieges.gate(district.id);
    return {
      districtId: district.id,
      name: district.name,
      // The same two facts `districtStandingFor` reads, through the same functions: a home is shut
      // by its resident and contested ground by its holder, and the screen has to be told so or it
      // would offer a fight the declaration rules refuse.
      shut: districtIsShut(districtHolder(district, controls), isInhabited(district, lived)),
      brokenUntil: gate && gateIsBroken(gate, now) ? gate.brokenUntil : null,
    };
  });
}

/**
 * §D7: what calling a fight costs, for every target this crew can see (`CallPrices`).
 *
 * Priced through the same `callPriceFor` the declaration charges with, so the dialog's quote and
 * the route's bill cannot disagree. Only charged ground is written down: the schema reads an
 * absent entry as free, and most of the map is free, so the common case is a short list.
 */
function callPricesFor(repos: Repositories, visible: ReadonlySet<string>): CallPrices {
  const prices: CallPrices = { locations: {}, districts: {} };
  for (const district of CITY_DISTRICTS) {
    if (!visible.has(district.id)) continue;
    for (const location of district.locations) {
      const target = {
        kind: 'location',
        districtId: district.id,
        locationId: location.id,
      } as const;
      const price = callPriceFor(repos, target, district);
      if (price > 0) prices.locations[location.id] = price;
    }
    // A gate and a raid are both a call on the district's own party, so one entry serves both.
    const price = callPriceFor(repos, { kind: 'gate', districtId: district.id }, district);
    if (price > 0) prices.districts[district.id] = price;
  }
  return prices;
}

/**
 * §A4: what this crew has on the road.
 *
 * A screen of its own rather than a section of the board, because it answers a different question:
 * the board is "what is coming and what came back", and this is "where is everybody right now".
 */
export function projectActions(repos: Repositories, base: Base, now: Date): ActionsResponse {
  const named = (districtId: string): string => findDistrict(districtId)?.name ?? districtId;

  return {
    movements: repos.movements.forBase(base.id).map((movement) => {
      const battle = repos.sieges.find(movement.battleId);
      const resident = battle ? residentOf(repos, battle.target.districtId) : undefined;
      return {
        id: movement.id,
        battleId: movement.battleId,
        targetName: battle ? targetName(battle.target, resident) : 'somewhere',
        fromName: named(movement.fromDistrictId),
        toName: named(movement.toDistrictId),
        side: movement.side,
        army: movement.army,
        perimeter: movement.perimeter,
        size: movementSize(movement),
        departedAt: movement.departedAt,
        arrivesAt: movement.arrivesAt,
        // §C3: what it rides in, off this crew's row for the fight (`sendColumn` reads the same).
        vehicles:
          repos.sieges.deployment(movement.battleId, movement.side, base.id)?.vehicles ?? {},
        recallable: movementCancellable(movement, now),
      };
    }),
    scoutingRun: scoutingRunView(repos, base),
    spyRun: spyRunView(repos, base),
    /*
     * §A4: the cells this crew has planted (`city/sleepers.ts`).
     *
     * Named rather than sent as ids: the Monitor is a page a player reads, and "rustyard-press"
     * is not a place anybody has heard of.
     */
    sleepers: repos.sleepers.forBase(base.id).map((cell) => {
      const location = findLocation(cell.locationId);
      return {
        cellId: cell.id,
        locationId: cell.locationId,
        locationName: location?.name ?? cell.locationId,
        districtName: location ? named(location.districtId) : 'somewhere',
        army: cell.army,
        phase: cell.phase,
        arrivesAt: cell.arrivesAt,
      };
    }),
    /*
     * ...and the people posted on ground this crew already holds.
     *
     * They are not *doing* anything, which is exactly why no other screen shows them, and this
     * page's question is "where is everybody right now". A crew with its whole army in garrisons
     * was told nobody was out at all.
     *
     * Empty postings are dropped: a control row keeps its `garrison` key whether or not anybody
     * is standing on it, and a list of empty places is a list of noise.
     */
    moves: moveViews(repos, base),
    stationed: (() => {
      const controls = repos.city.controls();
      // Postings on allies' ground, beside the crew's own garrisons (2026-09-22): the units are
      // this crew's, so "where is everybody" has to list them.
      const posted = new Map(
        repos.alliedGarrisons.forBase(base.id).map((row) => [row.locationId, row.army]),
      );
      return CITY_LOCATIONS.flatMap((location) => {
        const control = controls.get(location.id);
        const army =
          control && isHeldBy(control, base.id) ? control.garrison : posted.get(location.id);
        if (!army || Object.values(army).every((count) => count <= 0)) return [];
        return [
          {
            locationId: location.id,
            locationName: location.name,
            districtName: named(location.districtId),
            army,
          },
        ];
      });
    })(),
    serverNow: now.toISOString(),
  };
}

export function projectBattles(repos: Repositories, base: Base, now: Date): BattlesResponse {
  const visible = cityContextFor(repos, base).visible;

  const coming = repos.sieges
    .pending()
    .filter(
      (battle) => sideOf(repos, battle, base.id) !== null || visible.has(battle.target.districtId),
    )
    .map((battle) => viewOf(repos, base, battle, now));

  return {
    coming,
    reports: reportsFor(repos, base),
    spyReports: repos.spying.reportsFor(base.id, REPORT_HISTORY),
    slots: declarableSlots(now).map((slot) => slot.toISOString()),
    infamy: base.economy.infamy,
    callPrices: callPricesFor(repos, visible),
    gates: gatesFor(repos, visible, now),
    structures: structuresOf(base),
    serverNow: now.toISOString(),
  };
}
