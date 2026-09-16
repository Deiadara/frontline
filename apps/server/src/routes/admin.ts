import {
  AdminFogRequestSchema,
  AdminGrantRequestSchema,
  BLUEPRINTS,
  BLUEPRINT_PAGE_IDS,
  CITY_DISTRICTS,
  ITEM_CATALOG,
  BLACK_MARKET_GOODS,
  CONSUMABLE_ITEM_IDS,
  ITEM_IDS,
  findBlueprint,
  RESEARCH_ITEMS,
  findDistrict,
  AdminKnobsRequestSchema,
  BUILDING_KINDS,
  RESOURCE_KEYS,
  addItems,
  buildingLevel,
  startingProgression,
  type ItemCost,
  type ItemId,
  type AdminGrantRequest,
  type AdminMutationResponse,
  type AdminSnapshot,
  type Base,
  type Building,
  type Resources,
  declarationWindow,
  type BattleTarget,
  type ScheduledBattle,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { startingBase } from '../crew/starting.js';
import { ADMIN_ACTION_SECONDS } from '../admin/mode.js';
import { listBackups } from '../db/backup.js';
import { AppError, parseBody } from '../errors.js';
import { declareBattle } from '../battle/declare.js';
import { forfeitOffers } from '../market/board.js';
import { ownBase } from './own-base.js';

/**
 * The bench: knobs that put the game at a chosen stage, in one click.
 *
 * The board's problem is that judging a design means seeing it at level 3, level 10 and level 20,
 * and reaching any of those honestly takes days. `UNLOCKED` answered "show me the end", which is
 * one of the three. This answers all of them: set the structures to a level, set the player level,
 * set the stockpile, set the infamy, clear the queues, look.
 *
 * **Every route here is refused outright when admin mode is off.** Not hidden, not unauthorised,
 * `NOT_FOUND`, so a production build behaves as though the bench does not exist rather than
 * advertising a door somebody could try to open. The client asks `GET /admin` first and simply does
 * not draw the screen when the answer is a 404.
 *
 * Nothing here fabricates a state the rules could not produce, for the same reason the sandbox does
 * not: a reviewer looking at a district built by a knob should be looking at the real thing. The
 * levels are levels the game reaches, the resources are inside the storage the district actually
 * has, and research is left alone because a programme is worked through on the Lab's bench and
 * granting the rungs outright would be inventing a state the mechanic does not have.
 */

function requireAdmin(app: FastifyInstance): void {
  if (!app.config.admin) {
    throw new AppError('NOT_FOUND', 'Route GET /api/admin not found');
  }
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
    // Effective visibility, through the same seam the city view reads, so a tick here and the map
    // over there can never disagree. Home is listed and always visible: you live there.
    fog: (() => {
      const visible = app.repos.city.visibleDistricts(base.id);
      return CITY_DISTRICTS.map((district) => ({
        districtId: district.id,
        name: district.name,
        visible: district.id === base.districtId || visible.has(district.id),
        home: district.id === base.districtId,
      }));
    })(),
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
    const target = only === undefined || only === kind ? level : (standing?.level ?? 0);
    if (target <= 0) return [];
    return [
      {
        id: standing?.id ?? `admin-${kind}`,
        kind,
        level: target,
        modifications: standing?.modifications ?? [],
        // Carried through rather than reset: a knob that moves a level should not also repair the
        // siege damage or dismiss the garrison a reviewer is standing there to look at.
        damage: standing?.damage ?? 0,
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
 * The caller is marked as having scouted the ground, because the declaration refuses an unscouted
 * district and a bot has scouted nothing. Everything after that is `declareBattle`'s own answer.
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
    const spare = CITY_DISTRICTS.flatMap((district) =>
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
    const district = CITY_DISTRICTS.find((entry) =>
      entry.locations.some((location) => location.id === control.locationId),
    );
    if (!district) continue;
    candidates.push({ kind: 'location', districtId: district.id, locationId: control.locationId });
    candidates.push({ kind: 'gate', districtId: district.id });
  }

  let refusal = 'nothing to call';
  for (const target of candidates) {
    if (!findDistrict(target.districtId)) continue;
    app.repos.city.markScouted(attacker.id, target.districtId, now.toISOString());
    const result = declareBattle(app.repos, {
      base: attacker,
      target,
      scheduledFor: declarationWindow(now).earliest,
      now,
      // This route only exists while admin mode is on (`requireAdmin`), and admin mode waives the
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
  app.post('/admin/grant', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    requireAdmin(app);
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
   * A base cannot be deleted while the crew has done anything. `battles`, `district_intel`,
   * `scheduled_battles`, `market_supply_runs` and `troop_movements` all reference `bases(id)`
   * without `ON DELETE CASCADE`, so the delete is refused by the first of them holding a row, and
   * a crew that has called one fight would get an error instead of a fresh start. Rewriting every
   * column keeps the id, which is also what keeps `location_control.holder_base_id` honest: that
   * column has no foreign key at all, so a deleted base would leave ground held by a crew that no
   * longer exists.
   *
   * The ground is therefore released **explicitly**, before the rewrite, and so is everything
   * else keyed on the id that is not derived from the row: the feats ledger and its counters,
   * the crew's standing listings, and the districts it has scouted. "Everything else cascades"
   * was the first cut's claim and it was false in exactly the way a rewrite makes it false: a
   * cascade fires on a delete, and nothing here is deleted, so a fresh crew opened its feats
   * screen on the old life's lifetime counts and had its old escrow posted back to it.
   *
   * What still survives, and is another module's call: active missions and columns on the road
   * (`missions`, `troop_movements`, `battle_deployments`), which walk home into the fresh base,
   * and bids at the Bar and on the barrow, which the next close settles against it.
   */
  app.post('/admin/reset', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    requireAdmin(app);
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);

      // The ground first, while the id still means something.
      for (const control of app.repos.city.controls().values()) {
        if (control.holder.kind !== 'crew' || control.holder.baseId !== base.id) continue;
        app.repos.city.put({
          ...control,
          holder: { kind: 'unoccupied' },
          garrison: {},
          level: 0,
          fortification: 0,
          fortifyingUntil: null,
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
        now: new Date().toISOString(),
      });
      app.repos.bases.replace(fresh);
      app.repos.blackMarket.writeStash(base.id, {});
      app.repos.feats.forget(base.id);
      forfeitOffers(app.repos, base.id);
      // The map closes again. `POST /overseer` opens the nearest district when the player
      // re-picks, which is the one a first-second crew has.
      app.repos.city.forgetScouted(base.id);

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
    requireAdmin(app);
    return snapshot(app, ownBase(app, request.currentUser.id));
  });

  /**
   * The fog of war knob: show or hide one district for this crew while admin mode is on.
   *
   * Stored as the exception (`admin_fog`), never as scouting intel: hiding a district a scout has
   * genuinely visited leaves that visit on record, and turning admin mode off shows the crew
   * exactly what it has seen and nothing else. Home cannot be hidden; you live there.
   */
  app.post(
    '/admin/mock-battle',
    { preHandler: app.authenticate },
    (request): AdminMutationResponse => {
      requireAdmin(app);
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        mockBattleOn(app, base, new Date());
        return { admin: snapshot(app, base) };
      })();
    },
  );

  app.post('/admin/fog', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    requireAdmin(app);
    const { districtId, visible } = parseBody(AdminFogRequestSchema, request.body);
    if (!findDistrict(districtId)) throw new AppError('NOT_FOUND', 'No such district');
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      if (districtId !== base.districtId) app.repos.city.setAdminFog(base.id, districtId, !visible);
      return { admin: snapshot(app, base) };
    })();
  });

  app.post('/admin/knobs', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    requireAdmin(app);
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
          trainingQueue: [],
          research: { ...next.research, active: null },
        };
      }

      if (body.resources !== undefined) {
        // Absent keys keep what is there. A knob that sets supplies should not silently zero the oil.
        const resources: Resources = RESOURCE_KEYS.reduce(
          (into, key) => ({ ...into, [key]: body.resources?.[key] ?? into[key] }),
          next.resources,
        );
        next = { ...next, resources };
        app.repos.bases.updateResources(next.id, resources);
      }

      if (body.playerLevel !== undefined) {
        // The XP bank is reset with the level rather than carried: banked progress belongs to the
        // level it was earned under, and keeping it would leave a crew sitting above its own
        // threshold and level up again on the next read.
        const progression = startingProgression();
        next = { ...next, level: body.playerLevel, progression };
        app.repos.bases.updateProgression(next.id, body.playerLevel, progression);
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
