import { randomUUID } from 'node:crypto';
import {
  AttackPlaceRequestSchema,
  FortifyRequestSchema,
  GarrisonRequestSchema,
  RaidDistrictRequestSchema,
  ScoutRequestSchema,
  findDistrict,
  findPlace,
  isDistrictRaidable,
  type AttackPlaceResponse,
  type Base,
  type CityMutationResponse,
  type CityResponse,
  type DistrictDetailResponse,
  type RaidDistrictResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import {
  attackPlace,
  raidDistrict,
  setGarrison,
  settleFortifications,
  startFortifying,
  type CityRefusal,
} from '../city/actions.js';
import { cityContextFor, projectCity, projectDistrict } from '../city/view.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { awardPlayerXp, levelUpFrom } from '../progression/award.js';

/**
 * The city (GDD §A4): the map, what is inside a district, and the four things you can do about it.
 *
 * Everything settles first — the crew's own district and payroll, then any fortification whose
 * clock ran out while nobody was looking. A place that finished digging in five minutes ago has to
 * be dug in *before* somebody attacks it.
 */

const REFUSAL_ERRORS: Record<CityRefusal, { code: ErrorCode; message: string }> = {
  unscouted: { code: 'DISTRICT_UNSCOUTED', message: 'You have not had eyes on that ground' },
  no_force: { code: 'NO_FORCE', message: 'Send somebody, or do not send anybody' },
  not_enough_units: { code: 'NO_FORCE', message: 'You do not have those units to send' },
  already_held: { code: 'PLACE_UNAVAILABLE', message: 'You already hold it' },
  not_held: { code: 'PLACE_UNAVAILABLE', message: 'You do not hold that' },
  not_contested: { code: 'INVALID_TARGET', message: 'There is nothing there to take' },
  not_raidable: { code: 'INVALID_TARGET', message: 'That district cannot be raided' },
  at_max_fortification: {
    code: 'PLACE_UNAVAILABLE',
    message: 'It is as dug in as that ground allows',
  },
  already_fortifying: { code: 'PLACE_UNAVAILABLE', message: 'Work is already under way there' },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the materials' },
};

function refuse(reason: CityRefusal): never {
  const { code, message } = REFUSAL_ERRORS[reason];
  throw new AppError(code, message);
}

export function registerCityRoutes(app: FastifyInstance): void {
  /** The caller's own crew, with everything that settles on a clock already settled. */
  function settled(app: FastifyInstance, ownerId: string, now: Date): Base {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    settleFortifications(app.repos, now);
    return settleBase(app.repos, owned, now).base;
  }

  app.get('/city', { preHandler: app.authenticate }, (request): CityResponse => {
    const now = new Date();
    return projectCity(app.repos, settled(app, request.currentUser.id, now), now);
  });

  app.get<{ Params: { id: string } }>(
    '/city/:id',
    { preHandler: app.authenticate },
    (request): DistrictDetailResponse => {
      const now = new Date();
      const base = settled(app, request.currentUser.id, now);
      const district = findDistrict(request.params.id);
      if (!district) throw new AppError('NOT_FOUND', 'No such district');
      return projectDistrict(app.repos, base, district, now);
    },
  );

  /**
   * §A4 — put eyes on a district.
   *
   * Free, and instant. What it costs is the walk, which the map already shows as travel time and
   * which nothing yet charges — see the TODO on `city/actions.ts`. Scouting is deliberately not
   * gated on anything: a map you cannot look at is a map you cannot plan against, and the fog is
   * meant to be an invitation rather than a wall.
   */
  app.post('/city/scout', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { districtId } = parseBody(ScoutRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);
    const district = findDistrict(districtId);
    if (!district) throw new AppError('NOT_FOUND', 'No such district');

    app.repos.city.markScouted(base.id, districtId, now.toISOString());
    return { district: projectDistrict(app.repos, base, district, now), base };
  });

  /** §A4 — take a place off whoever is holding it. */
  app.post('/city/attack', { preHandler: app.authenticate }, (request): AttackPlaceResponse => {
    const { placeId, force } = parseBody(AttackPlaceRequestSchema, request.body);
    const now = new Date();
    const settledCrew = settleBase(app.repos, requireBase(app, request.currentUser.id), now);
    settleFortifications(app.repos, now);

    const place = findPlace(placeId);
    const district = place ? findDistrict(place.districtId) : undefined;
    if (!place || !district) throw new AppError('NOT_FOUND', 'No such place');

    // The same visibility the map computed, uplink range included — a district a crew can *see*
    // into is one it can act in, and deriving that twice from different inputs is how the two
    // quietly disagree.
    const scouted = cityContextFor(app.repos, settledCrew.base).visible.has(district.id);

    const outcome = app.db.transaction(() =>
      attackPlace(app.repos, app.skirmishEngine, {
        base: settledCrew.base,
        place,
        district,
        force,
        scouted,
        now,
      }),
    )();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    // §I1 pays for *fighting*, not for winning — a loss is worth less, not nothing.
    const { award } = awardPlayerXp(
      app.repos,
      outcome.base,
      outcome.result.winner === 'attacker' ? 'raidWon' : 'raidLost',
    );

    app.repos.battles.insert({
      id: randomUUID(),
      attackerBaseId: settledCrew.base.id,
      targetDistrictId: district.id,
      targetPlaceId: place.id,
      winner: outcome.result.winner,
      log: outcome.result.log,
      rewards: outcome.result.rewards,
      seed: randomUUID(),
      createdAt: now.toISOString(),
    });

    return {
      result: outcome.result,
      captured: outcome.captured,
      returned: outcome.returned,
      base: outcome.base,
      levelUp: levelUpFrom([...settledCrew.awards, award]),
    };
  });

  /** §A4 — rob a crew's home district. It cannot be taken, only emptied. */
  app.post('/city/raid', { preHandler: app.authenticate }, (request): RaidDistrictResponse => {
    const { districtId, force } = parseBody(RaidDistrictRequestSchema, request.body);
    const now = new Date();
    const settledCrew = settleBase(app.repos, requireBase(app, request.currentUser.id), now);

    const district = findDistrict(districtId);
    if (!district) throw new AppError('NOT_FOUND', 'No such district');
    if (!isDistrictRaidable(district, district.id === settledCrew.base.districtId)) {
      refuse('not_raidable');
    }

    const target = app.repos.bases
      .listSummaries()
      .find((summary) => summary.districtId === districtId);
    const victim = target ? app.repos.bases.findById(target.id) : undefined;
    if (!victim || victim.id === settledCrew.base.id) refuse('not_raidable');

    const outcome = app.db.transaction(() =>
      raidDistrict(app.repos, app.skirmishEngine, {
        base: settledCrew.base,
        district,
        target: victim,
        force,
        now,
      }),
    )();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    const { award } = awardPlayerXp(
      app.repos,
      outcome.base,
      outcome.result.winner === 'attacker' ? 'raidWon' : 'raidLost',
    );

    app.repos.battles.insert({
      id: randomUUID(),
      attackerBaseId: settledCrew.base.id,
      targetDistrictId: district.id,
      targetPlaceId: null,
      winner: outcome.result.winner,
      log: outcome.result.log,
      rewards: outcome.result.rewards,
      seed: randomUUID(),
      createdAt: now.toISOString(),
    });

    return {
      result: outcome.result,
      returned: outcome.returned,
      carriedKg: outcome.carriedKg,
      base: outcome.base,
      levelUp: levelUpFrom([...settledCrew.awards, award]),
    };
  });

  /** §A4 — leave units on a place you hold, or bring them home. */
  app.post('/city/garrison', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { placeId, changes } = parseBody(GarrisonRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const place = findPlace(placeId);
    const district = place ? findDistrict(place.districtId) : undefined;
    if (!place || !district) throw new AppError('NOT_FOUND', 'No such place');

    const outcome = app.db.transaction(() => setGarrison(app.repos, { base, place, changes }))();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    return {
      district: projectDistrict(app.repos, outcome.base, district, now),
      base: outcome.base,
    };
  });

  /** §A4 — dig in one more level. */
  app.post('/city/fortify', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { placeId } = parseBody(FortifyRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const place = findPlace(placeId);
    const district = place ? findDistrict(place.districtId) : undefined;
    if (!place || !district) throw new AppError('NOT_FOUND', 'No such place');

    const outcome = app.db.transaction(() => startFortifying(app.repos, { base, place, now }))();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    return {
      district: projectDistrict(app.repos, outcome.base, district, now),
      base: outcome.base,
    };
  });
}

function requireBase(app: FastifyInstance, ownerId: string): Base {
  const owned = app.repos.bases.findByOwnerId(ownerId);
  if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
  return owned;
}
