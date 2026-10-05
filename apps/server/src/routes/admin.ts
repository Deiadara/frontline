import {
  ARMY_COUNT_MAX,
  ATTRIBUTE_NAMES,
  OFFICER_ROLES,
  createCommander,
  type Attributes,
  AdminGrantRequestSchema,
  BLUEPRINTS,
  BLUEPRINT_PAGE_IDS,
  CITIES,
  combineLeaderAt,
  cityOfDistrict,
  districtsOfCity,
  findLocation,
  ITEM_CATALOG,
  BLACK_MARKET_GOODS,
  CONSUMABLE_ITEM_IDS,
  ITEM_IDS,
  findBlueprint,
  findUnit,
  RESEARCH_ITEMS,
  findDistrict,
  AdminKnobsRequestSchema,
  AdminResetRequestSchema,
  BUILDING_KINDS,
  RESOURCE_KEYS,
  addItems,
  buildingLevel,
  cancelDrill,
  levelCeilingFor,
  sessionFor,
  startingProgression,
  type ItemCost,
  type ItemId,
  type AdminGrantRequest,
  type Army,
  type AdminMutationResponse,
  type AdminSnapshot,
  type Base,
  type Building,
  type Commander,
  type Resources,
  declarationWindow,
  type BattleTarget,
  type ScheduledBattle,
  seedFrom,
  LEADER_HOLD_LABELS,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { offerOpeningInvitationAt } from '../factions/opening.js';
import { leaveFaction } from '../factions/leave.js';
import { startingBase } from '../crew/starting.js';
import { ADMIN_ACTION_SECONDS } from '../admin/mode.js';
import { listBackups } from '../db/backup.js';
import { AppError, parseBody } from '../errors.js';
import { declareBattle } from '../battle/declare.js';
import { callOff } from '../battle/resolve.js';
import { crewsInFight, defendingBaseOf } from '../battle/ground.js';
import { notifyBase } from '../social/notify.js';
import { forfeitOffers } from '../market/board.js';
import { storeCeilingsOf } from '../district/stores.js';
import { ownBase } from './own-base.js';
import { rollName } from '../bar/names.js';
import { createRng } from '../characters/rng.js';
import { legendaryRoom } from '../units/muster.js';
import { officerDuty } from '../crew/duty.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The bench: knobs that put the game at a chosen stage, in one click.
 *
 * The board's problem is that judging a design means seeing it at level 3, level 10 and level 20,
 * and reaching any of those honestly takes days. `UNLOCKED` answered "show me the end", which is
 * one of the three. This answers all of them: set the structures to a level, set the player level,
 * set the stockpile, set the infamy, clear the queues, look.
 *
 * **No route here exists when admin mode is off.** Not hidden, not unauthorised: never registered,
 * so a production build answers exactly as it does for any path it never had, rather than
 * advertising a door somebody could try to open. The client asks `GET /admin` first and simply does
 * not draw the screen when the answer is a 404.
 *
 * Nothing here fabricates a state the rules could not produce, for the same reason the sandbox does
 * not: a reviewer looking at a district built by a knob should be looking at the real thing. The
 * levels are levels the game reaches, the resources are inside the storage the district actually
 * has, and research is left alone because a programme is worked through on the Lab's bench and
 * granting the rungs outright would be inventing a state the mechanic does not have.
 */

/**
 * Takes the old life's people off the map, for Clean slate (bug pass, 2026-09-29).
 *
 * The reset drops the garrisons on the ground it releases, and these are the same people standing
 * somewhere else: units posted on an ally's ground, Sleeper cells, and columns between the crew's
 * places. None of them is on the base row, so none of them went with it. Every one still drew beds
 * off the fresh crew (`unitsAbroad`), so an old army abroad could leave eight Scavengers with no
 * free bed for the Bar or the muster bench, and a column bound for a location the reset had just
 * released claimed it again the moment it arrived. The standing orders go too: they name the old crew's officers and parties.
 */
function withdrawFromTheMap(repos: Repositories, baseId: string, now: string): void {
  for (const posted of repos.alliedGarrisons.forBase(baseId)) {
    repos.alliedGarrisons.set(posted.locationId, baseId, {});
  }
  for (const cell of repos.sleepers.forBase(baseId)) repos.sleepers.remove(cell.id);
  for (const move of repos.moves.activeFor(baseId)) repos.moves.markSettled(move.id, now);
  for (const slot of repos.automations.forBase(baseId)) repos.automations.remove(baseId, slot.slot);
}

/**
 * Calls off every fight the old life called or is defending, for Clean slate (bug pass,
 * 2026-09-29).
 *
 * The reset gave the ground back and left the fights on it standing, so a fight called on the old
 * crew's location landed on the fresh one: it was entered in the fresh crew's reports as a fight
 * it defended and won, and it paid the feats for it (`battles_won`, `battles_defended_won`) and
 * the player XP, on a ledger the reset had just emptied. Both sides are sent home with what they
 * brought, through the same `callOff` a fight that cannot run goes through, and the other crews in
 * it are told why their fight is gone from the board. A fight the crew only joined as somebody's
 * ally is not the old life's to call off, so {@link leaveTheOldAlliedFights} takes it out of those.
 */
function callOffTheOldFights(repos: Repositories, crew: Base, now: Date): void {
  for (const battle of repos.sieges.pending()) {
    /*
     * Defending by the settler's own reading (`defendingBaseOf`), not by the row's defender plate:
     * a raid or a gate call names no crew there, so a raid on the old crew's home was left
     * standing and landed on the fresh one.
     */
    const defending = defendingBaseOf(repos, battle)?.id === crew.id;
    if (battle.attackerBaseId !== crew.id && !defending) continue;
    const others = crewsInFight(repos, battle);
    others.delete(crew.id);
    callOff(repos, battle, now);
    const place = findDistrict(battle.target.districtId)?.name ?? battle.target.districtId;
    for (const other of others) {
      notifyBase(repos, other, {
        kind: 'battle_report',
        title: 'The fight was called off',
        // By name: "the crew at" the place was the defender's own address when the caller reset.
        body: `${crew.name} started over from nothing, so the fight at ${place} is off. Everybody came home.`,
        link: '/game/battles',
        at: now,
      });
    }
  }
}

/**
 * Takes the old life out of the fights it joined as somebody's ally, for Clean slate (maintainer
 * ruling, 2026-09-29: forfeit everything).
 *
 * The fight is the ally's and runs without them. The old life's people, standing on a side or
 * still walking to it, are forfeit: coming home after the mark, they joined the fresh crew's
 * roster with the feats and the XP of a fight it never saw. The crews still in it are told why a
 * side got thinner.
 */
function leaveTheOldAlliedFights(repos: Repositories, crew: Base, now: Date): void {
  for (const column of repos.movements.forBase(crew.id)) repos.movements.remove(column.id);
  for (const deployment of repos.sieges.deploymentsFor(crew.id)) {
    repos.sieges.removeDeployment(deployment.battleId, deployment.side, crew.id);
    const battle = repos.sieges.find(deployment.battleId);
    if (!battle) continue;
    const place = findDistrict(battle.target.districtId)?.name ?? battle.target.districtId;
    for (const other of crewsInFight(repos, battle)) {
      if (other === crew.id) continue;
      notifyBase(repos, other, {
        kind: 'battle_report',
        title: 'An ally left the fight',
        body: `${crew.name} started over from nothing, and the people it sent to the fight at ${place} went with it.`,
        link: '/game/battles',
        at: now,
      });
    }
  }
}

/**
 * Forfeits every mission and spy job the old life had out, for Clean slate (maintainer ruling,
 * 2026-09-29). Nothing found, nothing paid, no report: the rows go, history and all, the way the
 * feats ledger does, because a run still out came home into the fresh crew with its haul, its
 * people and its report, and the old reports were readable to a crew that never sent anybody.
 */
function forgetTheOldRuns(repos: Repositories, baseId: string): void {
  repos.missions.forget(baseId);
  repos.spying.forget(baseId);
}

/**
 * Walks the old life out of its faction, for Clean slate (maintainer ruling, 2026-09-29).
 *
 * The seat was the old crew's: a fresh level-1 crew stayed at the table, as its leader if the old
 * one led it. Through {@link leaveFaction}, the same path `POST /factions/leave` takes, so the
 * table is told, posted units walk home, and a leader leaving disbands it as the board's rule says,
 * or hands it to the successor they named (maintainer, 2026-09-30).
 */
function leaveTheOldFaction(
  repos: Repositories,
  user: { id: string; username: string },
  now: Date,
  successorId: string | undefined,
) {
  const held = repos.factions.membershipOf(user.id);
  if (held) leaveFaction(repos, held, user.username, now, successorId);
}

function snapshot(app: FastifyInstance, base: Base): AdminSnapshot {
  return {
    state: {
      enabled: app.config.admin,
      actionSeconds: ADMIN_ACTION_SECONDS,
      chargesResources: !app.config.admin,
    },
    baseId: base.id,
    playerLevel: base.level,
    infamy: base.economy.infamy,
    buildings: BUILDING_KINDS.map((kind) => ({
      kind,
      level: buildingLevel(base.buildings, kind),
    })),
    backups: listBackups(app.config.backupDir).slice(0, 12),
  };
}

/**
 * The structures a knob leaves standing.
 *
 * A level of zero is "not built", which is how the bench walks a district *backwards*: the state
 * before a structure exists is one of the stages a reviewer needs to see, and it is the one an
 * unlock-everything switch can never show. Existing ids are kept where the structure survives, so
 * modifications fitted to it are not orphaned by a level change.
 */
function buildingsAt(
  current: readonly Building[],
  level: number,
  only: string | undefined,
): Building[] {
  return BUILDING_KINDS.flatMap((kind) => {
    const standing = current.find((building) => building.kind === kind);
    const wanted = only === undefined || only === kind ? level : (standing?.level ?? 0);
    // Clamped to what the structure can actually reach. The knob is one number for eleven
    // structures and two of them stop at 10, so an unclamped 20 writes a Garage level no build
    // queue could produce and every ceiling readout on the client then disagrees with the plot.
    const target = Math.min(wanted, levelCeilingFor(kind));
    if (target <= 0) return [];
    return [
      {
        id: standing?.id ?? `admin-${kind}`,
        kind,
        level: target,
        modifications: standing?.modifications ?? [],
      },
    ];
  });
}

/**
 * A fight called on the reviewer, by whoever else is in the city (maintainer request, 2026-09-08).
 *
 * Through the real declaration and nothing else: the same gates, the same bell, the same mark on
 * the bottom bar, the same settle at the mark. What the console adds is only the two things a
 * reviewer's fresh crew lacks. Somebody to call it: the seeded rival if there is one, otherwise
 * any other crew, and nobody at all is a refusal rather than an invented account. And ground to
 * be called on: a residential district has no gate and no locations, so a crew that holds nothing
 * cannot be fought (`docs/PLAN` Q, still true), and the console hands them one unheld location in
 * a contested district first, which is what a reviewer would have done by hand.
 *
 * Everything after that is `declareBattle`'s own answer.
 */
function mockBattleOn(app: FastifyInstance, base: Base, now: Date): ScheduledBattle {
  const rival = app.repos.bases
    .listSummaries()
    .filter((summary) => summary.id !== base.id)
    .sort((a, b) => Number(b.isBot) - Number(a.isBot))[0];
  const attacker = rival ? app.repos.bases.findById(rival.id) : undefined;
  if (!attacker) throw new AppError('PLACE_UNAVAILABLE', 'Nobody else is in the city to call it');

  const held = [...app.repos.city.controls().values()].filter(
    (control) => control.holder.kind === 'crew' && control.holder.baseId === base.id,
  );
  const candidates: BattleTarget[] = [];
  if (held.length === 0) {
    // In the operator's own city, so the ground handed out is somewhere they can actually march to.
    const spare = districtsOfCity(cityOfDistrict(base.districtId)).flatMap((district) =>
      district.locations
        .filter((location) => {
          const control = app.repos.city.control(location.id);
          return !control || control.holder.kind !== 'crew';
        })
        .map((location) => ({ districtId: district.id, locationId: location.id })),
    )[0];
    if (!spare) throw new AppError('PLACE_UNAVAILABLE', 'No ground left in the city to hand you');
    const control = app.repos.city.control(spare.locationId);
    if (!control) throw new AppError('PLACE_UNAVAILABLE', 'No ground left in the city to hand you');
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });
    candidates.push({ kind: 'location', ...spare });
  }
  for (const control of held) {
    // Any city: the Console lists what this crew holds, and it may hold ground abroad.
    const district = findLocationDistrict(control.locationId);
    if (!district) continue;
    candidates.push({ kind: 'location', districtId: district.id, locationId: control.locationId });
    candidates.push({ kind: 'gate', districtId: district.id });
  }

  let refusal = 'nothing to call';
  for (const target of candidates) {
    if (!findDistrict(target.districtId)) continue;
    const result = declareBattle(app.repos, {
      base: attacker,
      target,
      scheduledFor: declarationWindow(now).earliest,
      now,
      // This route only exists while admin mode is on, and admin mode waives the
      // call's infamy price: a bot that has never fought has no name to spend.
      admin: app.config.admin,
    });
    if (result.kind === 'ok') return result.battle;
    refusal = result.reason;
  }
  throw new AppError(
    'PLACE_UNAVAILABLE',
    `Nothing of yours can be called on right now (${refusal})`,
  );
}

/**
 * What one grant puts in the inventory (maintainer request, 2026-09-11).
 *
 * Documents rather than pages for `blueprints`, because the point is to open the yard's benches
 * and a document is what opens them; `pages` is the other screen's fixture. Both go through
 * `addItems`, the same door a mission haul uses, so a granted document is exactly what an
 * assembled one is.
 */
function grantedItems(body: AdminGrantRequest): ItemCost {
  const items: ItemCost = {};
  if (body.blueprints !== undefined) {
    const wanted =
      body.blueprints === 'all'
        ? BLUEPRINTS
        : Array.isArray(body.blueprints)
          ? BLUEPRINTS.filter((spec) => body.blueprints!.includes(spec.id))
          : BLUEPRINTS.filter((spec) => spec.category === body.blueprints);
    for (const spec of wanted) items[spec.id as ItemId] = 1;
  }
  if (body.pages === 'all') {
    for (const pageId of BLUEPRINT_PAGE_IDS) items[pageId as ItemId] = 1;
  }
  if (body.parts !== undefined) {
    for (const id of ITEM_IDS) {
      if (ITEM_CATALOG[id].kind === 'component') items[id] = body.parts;
    }
  }
  /*
   * The traps, off `CONSUMABLE_ITEM_IDS` rather than off a `kind` scan of `ITEM_IDS`.
   *
   * A trap is deliberately kept out of `ITEM_IDS` so the Runner's barrow and the salvage table
   * cannot deal in one, which means the loop above cannot see them however it is spelled. This is
   * the same array the battles Inventory walks, and it is the only list of them there is.
   */
  if (body.consumables !== undefined) {
    for (const id of CONSUMABLE_ITEM_IDS) items[id] = body.consumables;
  }
  return items;
}

/**
 * The roster after a unit grant, inside the two limits a roster has (bug pass, 2026-09-29).
 *
 * `mergeArmies` alone let two grants of ten million Razors write twenty million, past
 * `ARMY_COUNT_MAX`, and from then on the crew failed to parse on every read: every screen and
 * every later Console call answered 500, so the bench could not even undo it. It also handed out a
 * second and a fifth Colossus, which is the one rule the maintainer asked the console by name to
 * keep (2026-09-19, `units/legendaries.ts`). A grant tops a roster up to either limit and stops.
 */
function grantedArmy(repos: Repositories, base: Base, granted: Army): Army {
  const army: Army = { ...base.army };
  for (const [unitId, count] of Object.entries(granted)) {
    const unit = findUnit(unitId);
    if (!unit || !count) continue;
    const held = army[unitId] ?? 0;
    const room = unit.unique ? legendaryRoom(repos, base, unit) : ARMY_COUNT_MAX - held;
    const added = Math.min(count, room);
    if (added > 0) army[unitId] = held + added;
  }
  return army;
}

/**
 * The crew with `seated` in its chairs and everybody else struck off the books (bug pass,
 * 2026-09-29).
 *
 * The officers knob replaces the whole roster, and a bare replace left behind what an officer
 * leaves when `releaseOfficer` lets them go: a drill still standing on the floor under their id,
 * and their fee still counted in the payroll book. The drill was the one that showed, because
 * `trainingBlocker` counts sessions against the places in the queue, so a knob pressed while an
 * officer was drilling held one of them for the rest of the hour, with nobody on the screen to
 * cancel. The same two lines are cleared here, the same way.
 */
/**
 * Refuses the officers knob while somebody it would strike off is out leading a run or a fight
 * (maintainer ruling, 2026-09-29: protect busy officers). The knob replaced the whole roster, so a
 * run landed with nobody on the books at its head, against the rule that every run has a leader.
 * The same refusal `releaseOfficer` gives, in the same words. Laid up is fine: a bed is not a job.
 */
function refuseUnseatingBusyOfficers(
  repos: Repositories,
  base: Base,
  seated: readonly Commander[],
  now: Date,
): void {
  const kept = new Set(seated.map((officer) => officer.id));
  for (const officer of base.commanders) {
    if (kept.has(officer.id)) continue;
    const duty = officerDuty(repos, base, officer, now);
    if (duty?.held === 'run' || duty?.held === 'fight') {
      throw new AppError(
        'STALE_STATE',
        `${officer.name} is ${LEADER_HOLD_LABELS[duty.held]}. Let them come back first, or ask for enough officers to keep their chair.`,
      );
    }
  }
}

function unseatedFor(base: Base, seated: Commander[], now: string): Base {
  const kept = new Set(seated.map((officer) => officer.id));
  const commitments = { ...base.economy.payroll.commitments };
  let training = base.training;
  for (const officer of base.commanders) {
    if (kept.has(officer.id)) continue;
    delete commitments[officer.id];
    const drill = sessionFor(training, officer.id);
    if (drill !== undefined) training = cancelDrill(training, drill.id, now);
  }
  return {
    ...base,
    commanders: seated,
    training,
    economy: { ...base.economy, payroll: { ...base.economy.payroll, commitments } },
  };
}

/** The rungs one grant finishes: a whole track, everything, or everything up to a depth. */
function grantedRungs(body: AdminGrantRequest): string[] {
  return RESEARCH_ITEMS.filter((spec) => {
    const byTrack =
      body.technologies !== undefined &&
      (body.technologies === 'all' || spec.track === body.technologies);
    const byDepth = body.researchDepth !== undefined && spec.step <= body.researchDepth;
    return byTrack || byDepth;
  }).map((spec) => spec.id);
}

export function registerAdminRoutes(app: FastifyInstance): void {
  /*
   * Not registered at all, rather than registered and refused in each handler (bug pass,
   * 2026-09-29). The handler's refusal ran after `app.authenticate`, so a caller with no token got
   * a 401 from every console path and a 404 from every path that really does not exist: the
   * difference told a stranger exactly where the console lives. The refusal also named
   * `GET /api/admin` whatever path and method had been asked for.
   */
  if (!app.config.admin) return;

  app.post('/admin/grant', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    const body = parseBody(AdminGrantRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      let next: Base = base;

      const items = grantedItems(body);
      if (Object.keys(items).length > 0) {
        // Added, never set: a grant on top of an inventory is an inventory with more in it. A document
        // the crew already holds is not doubled, since holding it is a yes or no.
        //
        // The clamp walks the **granted** documents rather than every document in the catalogue.
        // Walking all of them was a no-op today, because nothing else can put a second copy of one
        // in an inventory, but it would have silently destroyed a spare the day something could.
        const inventory = addItems(next.inventory, items);
        for (const id of Object.keys(items) as ItemId[]) {
          if (findBlueprint(id) !== undefined) inventory[id] = 1;
        }
        next = { ...next, inventory };
        app.repos.bases.updateHoldings(next.id, next.resources, inventory);
      }

      /*
       * Bodies on the roster, added rather than set: see `AdminGrantRequestSchema.units`. The
       * muster queue is handed back untouched, because a grant is a gift and not an order. No bed
       * is asked for, because admin mode waives `no_unit_slots` at every other door too.
       */
      if (body.units !== undefined) {
        const army = grantedArmy(app.repos, next, body.units);
        next = { ...next, army };
        app.repos.bases.updateArmy(next.id, army, next.musterQueue);
      }

      if (body.footholds === 'every-city') grantFootholds(app, next.id);

      if (body.technologies !== undefined || body.researchDepth !== undefined) {
        const technologies = [...new Set([...next.research.technologies, ...grantedRungs(body)])];
        const research = { ...next.research, technologies };
        next = { ...next, research };
        app.repos.bases.updateResearch(next.id, research);
      }

      /*
       * The back room's shelf, which is not in the inventory and so not in `grantedItems`.
       *
       * A boost lives in its own table keyed by crew (`black_market_stash`), because it is a favour
       * owed rather than a thing carried. Added to whatever is already there, for the same reason
       * the inventory is: a grant tops a crew up, it does not replace them.
       */
      if (body.boosts !== undefined) {
        let stash = app.repos.blackMarket.stashFor(next.id);
        for (const good of Object.values(BLACK_MARKET_GOODS).filter(
          (one) => one.kind === 'battle_boost',
        )) {
          stash = { ...stash, [good.id]: (stash[good.id] ?? 0) + body.boosts };
        }
        app.repos.blackMarket.writeStash(next.id, stash);
      }

      app.repos.history.record({
        actorId: request.currentUser.id,
        baseId: next.id,
        kind: 'admin.grant',
        payload: body,
      });
      return { admin: snapshot(app, next) };
    })();
  });

  /**
   * Clean slate: this crew, back to its first second (maintainer request, 2026-09-14).
   *
   * The other three presets move a crew *along* the game. This one puts it back at the start,
   * including the character: the overseer is cleared, so the next screen the player sees is the
   * one where they pick an archetype, and `POST /overseer` re-attaches a new one to the base this
   * route has just emptied.
   *
   * ## Why it rewrites rather than deletes
   *
   * A base cannot be deleted while the crew has done anything. `battles`, `scheduled_battles`,
   * `market_supply_runs` and `troop_movements` all reference `bases(id)` without `ON DELETE
   * CASCADE`, so the delete is refused by the first of them holding a row, and a crew that has
   * called one fight would get an error instead of a fresh start. Rewriting every column keeps the
   * id, which is also what keeps `location_control.holder_base_id` honest: that column has no
   * foreign key at all, so a deleted base would leave ground held by a crew that no longer exists.
   *
   * The ground is therefore released **explicitly**, before the rewrite, and so is everything
   * else keyed on the id that is not derived from the row: the feats ledger and its counters, and
   * the crew's standing listings. "Everything else cascades" was the first cut's claim and it was
   * false in exactly the way a rewrite makes it false: a cascade fires on a delete, and nothing
   * here is deleted, so a fresh crew opened its feats screen on the old life's lifetime counts and
   * had its old escrow posted back to it.
   *
   * Everything the old life had in flight is forfeit (maintainer ruling, 2026-09-29): its fights
   * are called off, its people leave the fights it joined, its missions and spy jobs are forgotten
   * with nothing found, and it walks out of its faction. What still survives is bids at the Bar
   * and on the barrow, which the next close settles against the fresh crew.
   */
  app.post('/admin/reset', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    const { successorId } = parseBody(AdminResetRequestSchema, request.body ?? {});
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);

      // The fights first, while the ground they are about is still this crew's.
      const now = new Date();
      callOffTheOldFights(app.repos, base, now);
      leaveTheOldAlliedFights(app.repos, base, now);
      leaveTheOldFaction(app.repos, request.currentUser, now, successorId);

      // Then the ground, while the id still means something.
      for (const control of app.repos.city.controls().values()) {
        if (control.holder.kind !== 'crew' || control.holder.baseId !== base.id) continue;
        app.repos.city.put({
          ...control,
          holder: { kind: 'unoccupied' },
          garrison: {},
          // Level 1, not 0: `LocationControlSchema.level` has a floor of 1, and a row written
          // under it made every read of the control table throw, so the world clock failed on
          // every tick after a Clean slate and the game never came back (maintainer, 2026-09-22).
          level: 1,
          upgradingUntil: null,
        });
      }

      const fresh = startingBase({
        id: base.id,
        ownerId: base.ownerId,
        // The district keeps its name. It is the one thing on the screen the player wrote
        // themselves, and a reset that renames it reads as a different account rather than a
        // fresh start on this one.
        name: base.name,
        /*
         * ...and its address (bug pass, 2026-09-24).
         *
         * `startingBase` defaults `districtId` to `STARTER_DISTRICT_ID`, and this passed none, so
         * Clean slate moved every crew in the world onto Kettle Row. A player who picked Terminus
         * at the character screen lost the city with the crew, and if somebody already lived on
         * Kettle Row the two ended up on one plot, where `residentOf` answers for one of them and
         * the other's home can neither be called on nor defended. `POST /overseer` already says
         * what this should do: "a reset crew keeps its old address", because the plot it is
         * standing on is still its own and nothing else has been allowed to take it.
         */
        districtId: base.districtId,
        now: new Date().toISOString(),
      });
      app.repos.bases.replace(fresh);
      withdrawFromTheMap(app.repos, base.id, fresh.createdAt);
      forgetTheOldRuns(app.repos, base.id);
      app.repos.blackMarket.writeStash(base.id, {});
      app.repos.feats.forget(base.id);
      forfeitOffers(app.repos, base.id);

      /*
       * Last, because everything above reads the base and this is what sends the player away from
       * it: `/me` answers with no overseer, and the shell routes to the picker.
       *
       * The row goes as well as the pointer. `idx_overseers_user` is unique (migration 0074), so a
       * cleared `users.overseer_id` with the old character still in `overseers` lets the player
       * reach the picker and then fails their next pick on the index. That is exactly what the
       * first cut of this did.
       */
      app.repos.users.clearOverseerId(request.currentUser.id);
      app.repos.overseers.removeForUser(request.currentUser.id);

      app.repos.history.record({
        actorId: request.currentUser.id,
        baseId: base.id,
        kind: 'admin.reset',
        payload: {},
      });
      return { admin: snapshot(app, fresh) };
    })();
  });

  app.get('/admin', { preHandler: app.authenticate }, (request): AdminSnapshot => {
    return snapshot(app, ownBase(app, request.currentUser.id));
  });

  app.post(
    '/admin/mock-battle',
    { preHandler: app.authenticate },
    (request): AdminMutationResponse => {
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        mockBattleOn(app, base, new Date());
        return { admin: snapshot(app, base) };
      })();
    },
  );

  app.post('/admin/knobs', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    const body = parseBody(AdminKnobsRequestSchema, request.body);

    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      let next: Base = base;

      if (body.buildingLevel !== undefined) {
        const buildings = buildingsAt(base.buildings, body.buildingLevel, body.structure);
        next = { ...next, buildings };
        app.repos.bases.updateDistrict(next.id, buildings, body.clearQueues ? [] : next.buildQueue);
        if (body.clearQueues) next = { ...next, buildQueue: [] };
      } else if (body.clearQueues) {
        app.repos.bases.updateDistrict(next.id, next.buildings, []);
        next = { ...next, buildQueue: [] };
      }

      if (body.clearQueues) {
        app.repos.bases.updateArmy(next.id, next.army, []);
        app.repos.bases.updateResearch(next.id, { ...next.research, active: null });
        next = {
          ...next,
          musterQueue: [],
          research: { ...next.research, active: null },
        };
      }

      if (body.resources !== undefined) {
        // Absent keys keep what is there. A knob that sets supplies should not silently zero the oil.
        // A set figure stops at the store's ceiling like every credit (maintainer ruling,
        // 2026-09-28): "Fill the stockpile" fills it, and a save the game could never reach
        // would be testing a state no player can be in.
        const ceilings = storeCeilingsOf(app.repos, next, new Date());
        const resources: Resources = RESOURCE_KEYS.reduce(
          (into, key) => ({
            ...into,
            [key]: Math.min(body.resources?.[key] ?? into[key], Math.max(into[key], ceilings[key])),
          }),
          next.resources,
        );
        next = { ...next, resources };
        app.repos.bases.updateResources(next.id, resources);
      }

      if (body.officers !== undefined) {
        /*
         * §C2: a crew with people in chairs, without waiting for a night at the Bar.
         *
         * Hiring is an auction that settles at midnight, so a fresh world has nobody in any chair
         * and every system that reads the crew's sheet is unreachable: no spying, no officer in a
         * fight, no role fit, no attribute channel. Seating them here is the same shape as the
         * building and research knobs above, and for the same reason.
         *
         * One per role, in the catalogue's order, at a flat rating. Flat because a bench that
         * rolled a sheet would make every measurement taken against it a measurement of the draw.
         *
         * **Named like people, not like slots** (maintainer, 2026-09-22). They used to be called
         * `Bench 1` through `Bench 19`, and every screen that prints the person under the chair
         * then read as a contradiction: the research rail said `Master of Whispers` on one line
         * and `Bench 1` on the next, which is a crew that is somehow seated and benched at once.
         * Nobody here is on the bench. They are in chairs, and the word was only ever the id of
         * the fixture that made them.
         *
         * The name is rolled off the Bar's own list, seeded on the role, so the Console still
         * produces the same crew every time it is pressed: a screenshot taken against this preset
         * is stable, which is most of what it is for. Only the *name* is drawn; the sheet stays
         * flat, so no measurement taken here is a measurement of a roll.
         */
        const seated = OFFICER_ROLES.slice(0, body.officers.count).map((role) =>
          createCommander(
            `bench-${role}`,
            rollName(createRng(seedFrom(`console-officer:${role}`))),
            role,
            Object.fromEntries(
              ATTRIBUTE_NAMES.map((name) => [name, body.officers!.rating]),
            ) as Attributes,
          ),
        );
        refuseUnseatingBusyOfficers(app.repos, next, seated, new Date());
        next = unseatedFor(next, seated, new Date().toISOString());
        app.repos.bases.updateEconomy(next.id, next.economy);
        // Writes the roster as well as the floor, in one row update.
        app.repos.bases.updateTraining(next.id, next.training, next.commanders);
      }

      if (body.automationsRested) {
        for (const slot of app.repos.automations.forBase(next.id)) {
          /*
           * The landed party goes too. A slot still pointing at a mission that has come home is
           * re-stamped by the next tick from that mission's `resolvedAt` (the rule that stops a
           * toggle skipping the gap), which would put back the very rest this knob just cleared.
           * A party still out is left alone: clearing that would send a second one.
           */
          const running =
            slot.missionId === null ? null : app.repos.missions.findById(slot.missionId);
          const stillOut = running?.mission.status === 'active';
          app.repos.automations.put({
            ...slot,
            restingSince: null,
            missionId: stillOut ? slot.missionId : null,
          });
        }
      }

      if (body.playerLevel !== undefined) {
        // The XP bank is reset with the level rather than carried: banked progress belongs to the
        // level it was earned under, and keeping it would leave a crew sitting above its own
        // threshold and level up again on the next read.
        const progression = startingProgression();
        next = { ...next, level: body.playerLevel, progression };
        app.repos.bases.updateProgression(next.id, body.playerLevel, progression);
        offerOpeningInvitationAt(
          app.repos,
          next.ownerId,
          body.playerLevel,
          new Date().toISOString(),
        );
      }

      if (body.notoriety !== undefined) {
        // §D7: a rank is bought and kept, so the bench sets it directly. Before the infamy knob, so
        // setting both in one call leaves the wallet at the figure that was asked for.
        const economy = { ...next.economy, notoriety: body.notoriety };
        next = { ...next, economy };
        app.repos.bases.updateEconomy(next.id, economy);
      }

      if (body.infamy !== undefined) {
        const economy = { ...next.economy, infamy: body.infamy };
        next = { ...next, economy };
        app.repos.bases.updateEconomy(next.id, economy);
      }

      app.repos.history.record({
        actorId: request.currentUser.id,
        baseId: next.id,
        kind: 'admin.knobs',
        payload: body,
      });
      return { admin: snapshot(app, next) };
    })();
  });
}

/** The district a location sits in, anywhere in the world, or nothing for an id nobody authored. */
function findLocationDistrict(locationId: string) {
  const location = findLocation(locationId);
  return location ? findDistrict(location.districtId) : undefined;
}

/**
 * One location in every open city, for the Console (`AdminGrantRequest.footholds`).
 *
 * Empty ground first, then ground the looters or the regime stand on; never another crew's, never
 * a Combine leader's own plot, and never the last open plot of a district, which would shut it.
 * Held with a small garrison so it reads as ground somebody is standing on.
 */
function grantFootholds(app: FastifyInstance, baseId: string): void {
  const controls = app.repos.city.controls();
  for (const city of CITIES.filter((one) => one.open)) {
    const districts = districtsOfCity(city.id);
    const holdsHere = districts.some((district) =>
      district.locations.some((location) => {
        const holder = controls.get(location.id)?.holder;
        return holder?.kind === 'crew' && holder.baseId === baseId;
      }),
    );
    if (holdsHere) continue;
    const candidates = districts.flatMap((district) => {
      const open = district.locations.filter(
        (location) => controls.get(location.id)?.holder.kind === 'unoccupied',
      );
      return district.locations
        .filter((location) => {
          const holder = controls.get(location.id)?.holder;
          if (!holder || holder.kind === 'crew') return false;
          if (combineLeaderAt(location.id)) return false;
          // Taking the only empty plot of a district would shut it behind a gate.
          return !(holder.kind === 'unoccupied' && open.length <= 1);
        })
        .map((location) => ({
          location,
          district,
          empty: controls.get(location.id)?.holder.kind === 'unoccupied',
        }));
    });
    const pick = candidates.find((one) => one.empty) ?? candidates[0];
    if (!pick) continue;
    const control = controls.get(pick.location.id)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId },
      upgradingUntil: null,
      garrison: { razors: 10 },
    });
  }
}
