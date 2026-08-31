import { randomUUID } from 'node:crypto';
import {
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  BuildStructureRequestSchema,
  MAX_BUILD_QUEUE,
  RenameDistrictRequestSchema,
  type BaseDetailResponse,
  type BuildStructureResponse,
  type RenameDistrictResponse,
  ITEM_CATALOG,
  buildingParts,
  nextQueuedLevel,
  type ItemId,
  describeBuildingRequirement,
  isReservedDistrictName,
  sameDistrictName,
  BUILD_BOOST_HOURS,
  BUILD_BOOST_PERCENT,
  BuyBuildBoostRequestSchema,
  ClearModificationRequestSchema,
  FitModificationRequestSchema,
  buildBoostOilCost,
  describeSlotRefusal,
  nexusLevelForUpgrade,
  nexusShortfall,
  projectedBuildings,
  buildingLevel,
  type BuildBoostRefusal,
  type BuildBoostResponse,
  type ClearSlotRefusal,
  type ModificationSlotResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { nexusGate, queueBuild, type BuildRefusal } from '../district/build.js';
import { buyBuildBoost } from '../district/boost.js';
import { clearSlot, fitIntoSlot } from '../district/modifications.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { levelUpFrom } from '../progression/award.js';

/**
 * Every refusal is a 409: none of them is a malformed request, they are all the district saying
 * "not yet". The client can pre-empt all five from the base it already holds, so these are the
 * honest last word on a stale tab rather than the primary way a player learns the rules.
 *
 * Two of the five are parameterised, because "raise the Nexus first" is only useful advice when it
 * says how far. `nexusGate` supplies both numbers.
 */
const REFUSAL_ERRORS: Record<BuildRefusal, ErrorCode> = {
  locked: 'STRUCTURE_LOCKED',
  at_max_level: 'STRUCTURE_AT_MAX_LEVEL',
  nexus_cap: 'NEXUS_CAP',
  queue_full: 'BUILD_QUEUE_FULL',
  cannot_afford: 'INSUFFICIENT_RESOURCES',
  missing_parts: 'MISSING_PARTS',
};

export function registerBaseRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/base/:id',
    { preHandler: app.authenticate },
    (request): BaseDetailResponse => {
      const base = app.repos.bases.findById(request.params.id);
      if (!base) {
        throw new AppError('NOT_FOUND', 'That base no longer exists');
      }
      if (base.ownerId !== request.currentUser.id) {
        throw new AppError('FORBIDDEN', 'You do not have access to this base');
      }
      return { base: settleBase(app.repos, base, new Date()).base };
    },
  );

  /**
   * Put one structure's next level into the build queue (GDD §A1, §D3).
   *
   * The base comes from the caller's own account rather than the path: a player has exactly one
   * district, so an id here would be a second way to say "mine" and a first way to try someone
   * else's. Everything settles first: caps that left this morning are not caps you can spend on a
   * Gate this afternoon, and an order that finished while the tab was open has to land before the
   * queue is measured against its six-slot limit.
   */
  app.post('/base/build', { preHandler: app.authenticate }, (request): BuildStructureResponse => {
    const { kind } = parseBody(BuildStructureRequestSchema, request.body);
    const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

    const settled = settleBase(app.repos, owned, new Date());
    const result = app.db.transaction(() =>
      queueBuild(app.repos, {
        base: settled.base,
        structure: kind,
        id: randomUUID(),
        now: new Date(),
        admin: app.config.admin,
      }),
    )();

    if (result.kind === 'refused') {
      throw new AppError(
        REFUSAL_ERRORS[result.reason],
        refusalMessage(result.reason, kind, settled.base),
        // A refusal can still have banked a level-up on its way to refusing (MOU-280): the settle
        // above is a write, and no later read re-resolves it.
        levelUpFrom(settled.awards),
      );
    }
    return { base: result.base, levelUp: levelUpFrom(settled.awards) };
  });

  /**
   * §B4: light the Generator's two-hour burn.
   *
   * Settles first like every other write, and for a reason specific to this one: the burn re-times
   * what is in the queue, and re-timing an order whose clock has already run out would hand the
   * player back work they have already finished.
   */
  app.post('/base/boost', { preHandler: app.authenticate }, (request): BuildBoostResponse => {
    parseBody(BuyBuildBoostRequestSchema, request.body);
    const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

    const now = new Date();
    const settled = settleBase(app.repos, owned, now);
    const result = app.db.transaction(() =>
      buyBuildBoost(app.repos, settled.base, now, app.config.admin),
    )();
    if (result.kind === 'refused') {
      throw new AppError('BOOST_REFUSED', boostMessage(result.reason, settled.base));
    }
    return { base: result.base, paid: result.paid };
  });

  /** §E: put one of the crew's built add-ons into a structure's first free slot. */
  app.post(
    '/base/modifications/fit',
    { preHandler: app.authenticate },
    (request): ModificationSlotResponse => {
      const { building, modificationId } = parseBody(FitModificationRequestSchema, request.body);
      return app.db.transaction(() => {
        const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
        if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
        const settled = settleBase(app.repos, owned, new Date());
        const result = fitIntoSlot(app.repos, settled.base, building, modificationId);
        if (result.kind === 'refused') {
          throw new AppError('SLOT_REFUSED', describeSlotRefusal(result.reason, building));
        }
        return { base: result.base };
      })();
    },
  );

  /** §E: and take it out again. It goes back on the shelf rather than being destroyed. */
  app.post(
    '/base/modifications/clear',
    { preHandler: app.authenticate },
    (request): ModificationSlotResponse => {
      const { building, slot } = parseBody(ClearModificationRequestSchema, request.body);
      return app.db.transaction(() => {
        const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
        if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
        const settled = settleBase(app.repos, owned, new Date());
        const result = clearSlot(app.repos, settled.base, building, slot);
        if (result.kind === 'refused') {
          throw new AppError('SLOT_REFUSED', CLEAR_MESSAGES[result.reason]);
        }
        return { base: result.base };
      })();
    },
  );

  /** §A1: name the district. */
  app.post(
    '/base/district-name',
    { preHandler: app.authenticate },
    (request): RenameDistrictResponse => {
      const { name } = parseBody(RenameDistrictRequestSchema, request.body);
      const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
      if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

      /*
       * One crew, one name, per city.
       *
       * The name is the *only* thing that identifies a crew anywhere a player meets one: the tag on
       * the map, the two sides of a battle report, a listing on the trading board. Two crews sharing
       * one does not look like a clash, it looks like the same crew being in two places, and there is
       * no second field a reader could fall back on. Checked here rather than in the schema because
       * it is a fact about the city rather than about the string.
       */
      factionNameMustBeFree(app, name, owned.id);

      app.repos.bases.updateName(owned.id, name);
      return { base: { ...settleBase(app.repos, owned, new Date()).base, name } };
    },
  );
}

/**
 * Refuses a crew name somebody else in the city is already using, or one the map has reserved.
 *
 * `exceptBaseId` is the crew doing the renaming: a crew re-saving its own name unchanged is not a
 * collision, and refusing that would make the field impossible to leave alone.
 */
function factionNameMustBeFree(app: FastifyInstance, name: string, exceptBaseId: string): void {
  if (isReservedDistrictName(name)) {
    throw new AppError(
      'DISTRICT_NAME_TAKEN',
      `The city already calls a district "${name.trim()}". Pick something else.`,
    );
  }
  const clash = app.repos.bases
    .listSummaries()
    .find((summary) => summary.id !== exceptBaseId && sameDistrictName(summary.name, name));
  if (clash) {
    throw new AppError('DISTRICT_NAME_TAKEN', `Another crew in this city is already called that.`);
  }
}

const CLEAR_MESSAGES: Record<ClearSlotRefusal, string> = {
  no_structure: 'There is nothing standing there',
  bad_slot: 'There is no slot there',
  already_empty: 'That slot is already empty',
};

/** §B4: why the burn could not be bought, with the number that makes it actionable. */
function boostMessage(reason: BuildBoostRefusal, base: Parameters<typeof nexusGate>[1]): string {
  switch (reason) {
    case 'no_generator':
      return 'Build the Generator first. It is what sells the burn';
    case 'already_running':
      return `A burn is already running. Buying a second one extends nothing: wait it out`;
    case 'cannot_afford':
      return `${BUILD_BOOST_HOURS} hours at ${BUILD_BOOST_PERCENT}% off costs ${buildBoostOilCost(base.buildings)} oil, and you are short`;
  }
}

/** What to tell the player, with the numbers that make the advice actionable. */
function refusalMessage(
  reason: BuildRefusal,
  kind: Parameters<typeof nexusGate>[0],
  base: Parameters<typeof nexusGate>[1],
): string {
  const spec = BUILDING_CATALOG[kind];
  switch (reason) {
    case 'locked': {
      // Every unmet clause, in the order the catalogue lists them: the Nexus rung first, then the
      // structures, then the crew's own level. One message a player can act on rather than a chain
      // of them each revealing the next.
      const { unmet } = nexusGate(kind, base);
      const wanted = unmet.map(describeBuildingRequirement).join(', ');
      return `${spec.name} needs ${wanted || 'something you do not have yet'}`;
    }
    case 'at_max_level':
      return `${spec.name} is as good as it gets at level ${BUILDING_MAX_LEVEL}`;
    case 'nexus_cap': {
      /*
       * §B1: name the Nexus level this upgrade wants, not the one the district has.
       *
       * The old line said "raise it past level 6", which was true under the rule that everything
       * stopped at the Nexus's own level and is useless under the permission table: the Gate's
       * next rung might be Nexus 5 and the Lab's might be 12, and "past 6" does not distinguish
       * them. The requirement is per building and per level, so the message has to be too.
       */
      const short = nexusShortfall(kind, projectedBuildings(base.buildings, base.buildQueue));
      const { at } = nexusGate(kind, base);
      const needed =
        short?.needed ?? nexusLevelForUpgrade(kind, buildingLevel(base.buildings, kind) + 1);
      return `${spec.name} needs the Nexus at level ${needed}. Yours is at ${short?.at ?? at}`;
    }
    case 'queue_full':
      return `All ${MAX_BUILD_QUEUE} build slots are working`;
    case 'cannot_afford':
      return 'You cannot cover the materials';
    case 'missing_parts': {
      // Named, not counted: the whole point of a part gate is that the answer is a thing you go
      // and find rather than a number you wait for.
      const level = nextQueuedLevel(kind, base.buildings, base.buildQueue) ?? 1;
      const wanted = Object.entries(buildingParts(kind, level))
        .map(([id, count]) => `${count}× ${ITEM_CATALOG[id as ItemId].name}`)
        .join(', ');
      return `Level ${level} needs ${wanted}`;
    }
  }
}
