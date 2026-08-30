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
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { nexusGate, queueBuild, type BuildRefusal } from '../district/build.js';
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
      const { at } = nexusGate(kind, base);
      return `Nothing outgrows the Nexus. Raise it past level ${at} first`;
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
