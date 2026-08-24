import {
  FortifyRequestSchema,
  GarrisonRequestSchema,
  ScoutRequestSchema,
  UpgradeLocationRequestSchema,
  findDistrict,
  findLocation,
  type Base,
  type CityMutationResponse,
  type CityResponse,
  type DistrictDetailResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import {
  setGarrison,
  settleFortifications,
  startFortifying,
  type CityRefusal,
} from '../city/actions.js';
import { settleBattles } from '../battle/resolve.js';
import { projectCity, projectDistrict } from '../city/view.js';
import { UPGRADE_REFUSALS, startUpgrade, type UpgradeRefusal } from '../city/upgrade.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';

/**
 * The city (GDD §A4): the map, what is inside a district, and the four things you can do about it.
 *
 * Everything settles first: the crew's own district and payroll, then any fortification whose
 * clock ran out while nobody was looking. A location that finished digging in five minutes ago has to
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
    // Any declared fight whose mark has passed runs here too (§A4). It has to: a battle that went
    // off an hour ago may have changed who holds half this map, and a city read that showed the old
    // answer would be a screen the rules disagree with.
    settleBattles(app.repos, app.skirmishEngine, now);
    const fresh = app.repos.bases.findByOwnerId(ownerId) ?? owned;
    return settleBase(app.repos, fresh, now).base;
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
   * §A4: put eyes on a district.
   *
   * Free, and instant. What it costs is the walk, which the map already shows as travel time and
   * which nothing yet charges: see the TODO on `city/actions.ts`. Scouting is deliberately not
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

  /*
   * The two routes that used to live here, `POST /city/attack` and `POST /city/raid`, are gone
   * (board, battle rework).
   *
   * They resolved a fight the instant somebody pressed a button: pick a force, press Attack, read
   * the log. Everything §A4 was rebuilt for is a reaction to that. A fight is now **declared** in
   * advance, on a mark both sides can read, and the defender has hours to move people up, arm the
   * gate, set a trap or write the night off. Leaving an instant path beside it would not have been
   * a second option, it would have been the *only* option anybody used: no notice to give, no
   * hours to wait, and the whole rework reduced to a screen nobody opens.
   *
   * What replaced them: `POST /battles/declare`, `POST /battles/deploy` and the settler in
   * `battle/resolve.ts`. Robbing a crew's home is the same three calls against a `gate` and then a
   * `building` target: a home district still cannot be taken, only broken into and emptied.
   */

  /** §A4: leave units on a location you hold, or bring them home. */
  app.post('/city/garrison', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { locationId, changes } = parseBody(GarrisonRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const location = findLocation(locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    if (!location || !district) throw new AppError('NOT_FOUND', 'No such location');

    const outcome = app.db.transaction(() => setGarrison(app.repos, { base, location, changes }))();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    return {
      district: projectDistrict(app.repos, outcome.base, district, now),
      base: outcome.base,
    };
  });

  /** §A4: dig in one more level. */
  app.post('/city/fortify', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { locationId } = parseBody(FortifyRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const location = findLocation(locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    if (!location || !district) throw new AppError('NOT_FOUND', 'No such location');

    const outcome = app.db.transaction(() => startFortifying(app.repos, { base, location, now }))();
    if (outcome.kind === 'refused') refuse(outcome.reason);

    return {
      district: projectDistrict(app.repos, outcome.base, district, now),
      base: outcome.base,
    };
  });

  /**
   * §A4: work a location up one level.
   *
   * The other half of holding ground, and deliberately the same shape as fortifying: charged up
   * front, a clock on the row, banked by the settler on the next read. What separates them is what
   * they buy: a fortification makes a location *harder to take*, a level makes it *worth more*,
   * and what happens on capture, which is that a level is lost and a fortification is too.
   */
  app.post('/city/upgrade', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { locationId } = parseBody(UpgradeLocationRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const location = findLocation(locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    if (!location || !district) throw new AppError('NOT_FOUND', 'No such location');

    const control = app.repos.city.control(locationId);
    if (!control) throw new AppError('NOT_FOUND', 'No such location');

    const outcome = app.db.transaction(() =>
      startUpgrade(app.repos, { base, location, control, now }),
    )();
    if (outcome.kind === 'refused') {
      throw new AppError(UPGRADE_ERROR_CODES[outcome.reason], UPGRADE_REFUSALS[outcome.reason]);
    }

    return {
      district: projectDistrict(app.repos, outcome.base, district, now),
      base: outcome.base,
    };
  });
}

/** Which API code each upgrade refusal answers with. Shaped like `REFUSAL_ERRORS` above. */
const UPGRADE_ERROR_CODES: Record<UpgradeRefusal, ErrorCode> = {
  not_yours: 'PLACE_UNAVAILABLE',
  at_ceiling: 'PLACE_UNAVAILABLE',
  already_working: 'PLACE_UNAVAILABLE',
  cannot_afford: 'INSUFFICIENT_RESOURCES',
};
