import {
  RaiseGateRequestSchema,
  UpgradeLocationRequestSchema,
  cityOfDistrict,
  districtsOfCity,
  findDistrict,
  findLocation,
  type Base,
  type CityMutationResponse,
  type CityResponse,
  type DistrictDetailResponse,
  CancelLocationWorkRequestSchema,
  RecallSpyRequestSchema,
  SpyRequestSchema,
  type SpyRefusal,
  CancelGateRaiseRequestSchema,
  PlantSleepersRequestSchema,
  RecallSleepersRequestSchema,
  SLEEPER_REFUSAL_TEXT,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { plantSleepers, recallSleepers } from '../city/sleepers.js';
import { projectCity, projectDistrict } from '../city/view.js';
import {
  UPGRADE_REFUSALS,
  cancelUpgrade,
  startUpgrade,
  type UpgradeRefusal,
} from '../city/upgrade.js';
import { settleBase } from '../district/settle.js';
import { AppError, cityQuery, parseBody, type ErrorCode } from '../errors.js';
import { recallSpy, sendSpy } from '../spying/spying.js';
import { cancelGateRaise, raiseCapturedGate } from '../city/gates.js';
import { settleWorld } from '../world/settle.js';

/**
 * The city (GDD §A4): the map, what is inside a district, and what you can do about it.
 *
 * Everything settles first: the crew's own district and payroll, then any location upgrade whose
 * clock ran out while nobody was looking. A location that finished its level five minutes ago has
 * to be worth that level *before* somebody looks at it.
 */

/** Why a spy job was refused, in the player's words (2026-09-22). */
const SPY_REFUSAL_ERRORS: Record<SpyRefusal, { code: ErrorCode; message: string }> = {
  no_whispers: {
    code: 'NO_FORCE',
    message: 'Nobody is in the Master of Whispers chair. Spying is their work',
  },
  no_road: { code: 'VALIDATION_ERROR', message: 'There is no road to that' },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the caps' },
  already_out: {
    code: 'VALIDATION_ERROR',
    message: 'Every party of runners you have is already out on a job',
  },
  tier_locked: {
    code: 'VALIDATION_ERROR',
    message: 'Your Master of Whispers has not opened that tier yet',
  },
  nothing_there: {
    code: 'INVALID_TARGET',
    message: 'Nobody is holding that. There is nothing to read',
  },
  own_ground: { code: 'VALIDATION_ERROR', message: 'That is yours. You can count it yourself' },
  not_the_gate: {
    code: 'INVALID_TARGET',
    message: 'That district is shut. From outside, the gate is the only thing to read',
  },
  city_closed: { code: 'INVALID_TARGET', message: 'That city is not open yet. Nobody gets in' },
};

const WORK_CANCEL_ERRORS: Record<
  'not_yours' | 'nothing_running' | 'window_closed',
  { code: ErrorCode; message: string }
> = {
  not_yours: { code: 'PLACE_UNAVAILABLE', message: 'You do not hold that' },
  nothing_running: { code: 'NOT_FOUND', message: 'Nothing is under way there' },
  window_closed: {
    code: 'PLACE_UNAVAILABLE',
    message: 'The work has gone too far to stop. It finishes now',
  },
};
const SPY_RECALL_ERRORS: Record<
  'nobody_out' | 'window_closed',
  { code: ErrorCode; message: string }
> = {
  nobody_out: { code: 'NOT_FOUND', message: 'Nobody of yours is out' },
  window_closed: {
    code: 'PLACE_UNAVAILABLE',
    message: 'They are too far down the road to call back. They will be home when they are home',
  },
};
const GATE_CANCEL_ERRORS: Record<
  'not_held' | 'nothing_running' | 'window_closed',
  { code: ErrorCode; message: string }
> = {
  not_held: { code: 'FORBIDDEN', message: 'You do not hold all of that district' },
  nothing_running: { code: 'NOT_FOUND', message: 'Nothing is being raised there' },
  window_closed: {
    code: 'PLACE_UNAVAILABLE',
    message: 'The work has gone too far to stop. It finishes now',
  },
};

export function registerCityRoutes(app: FastifyInstance): void {
  /** The caller's own crew, with everything that settles on a clock already settled. */
  function settled(app: FastifyInstance, ownerId: string, now: Date): Base {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    // Every clock the shared world runs on, in the one order there is (`world/settle.ts`). A
    // declared fight whose mark has passed runs here too (§A4): a battle that went off an hour ago
    // may have changed who holds half this map, and a city read showing the old answer would be a
    // screen the rules disagree with. This path used to settle gates but *not*
    // movements, so which screen a player happened to open first decided whether a column that
    // arrived before the mark was in the fight.
    settleWorld(app.repos, app.skirmishEngine, now, undefined, app.config.admin);
    const fresh = app.repos.bases.findByOwnerId(ownerId) ?? owned;
    return settleBase(app.repos, fresh, now).base;
  }

  /**
   * The map, of the crew's own city or of one they asked for by name (2026-09-24).
   *
   * Takes `?city=` the way the Bar, the market, the back room and the mission board do, and
   * **deliberately not their door**. Those run on `cityAsked` (`city/stakes.ts`), which wants
   * ground already held in the city: a room is somewhere you walk into, and a crew with no stake
   * has no business at the bar. A map is the opposite thing. Looking at a city is how a player
   * decides to take something in it, so a door that wanted a holding first would be a door that
   * can only be opened from the inside, and the world screen would offer five cities that answer
   * nothing until you are already there.
   *
   * So looking is free, and the whole city is visible (maintainer, 2026-09-29) whether or not the
   * crew has ever been there. What the map does need is ground drawn for it. Redline and Deepcut are a name and a blurb with no districts behind them
   * (`city/cities.ts`), and there is no map of a place nobody has drawn.
   */
  function mapCity(base: Base, asked: string | undefined): string {
    const wanted = asked ?? cityOfDistrict(base.districtId);
    if (districtsOfCity(wanted).length === 0) {
      throw new AppError('NOT_FOUND', 'Nobody has drawn a map of that place');
    }
    return wanted;
  }

  app.get('/city', { preHandler: app.authenticate }, (request): CityResponse => {
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);
    const asked = cityQuery(request.query);
    return projectCity(app.repos, base, now, mapCity(base, asked));
  });

  app.get<{ Params: { id: string } }>(
    '/city/:id',
    { preHandler: app.authenticate },
    (request): DistrictDetailResponse => {
      const now = new Date();
      const base = settled(app, request.currentUser.id, now);
      const district = findDistrict(request.params.id);
      if (!district) throw new AppError('NOT_FOUND', 'No such district');
      return projectDistrict(app.repos, base, district, now, app.config.admin);
    },
  );

  /**
   * §B7: raise the gate on a district this crew has taken whole (maintainer request).
   *
   * A separate route rather than a `buildQueue` entry, because a captured gate is not one of this
   * district's structures: it stands somewhere else, it has no Nexus over it, and it is inherited
   * by whoever takes the ground rather than owned by whoever built it. Its clock is a timestamp on
   * the gate, settled by the read above and by the world tick, which is how every other clock in
   * this server works.
   *
   * Paid at the order, like a queued build. A wall somebody is standing in front of is not
   * refundable.
   */
  app.post('/city/gate', { preHandler: app.authenticate }, (request): CityResponse => {
    const { districtId } = parseBody(RaiseGateRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const outcome = app.db.transaction(() =>
      raiseCapturedGate(app.repos, base, districtId, now, app.config.admin),
    )();
    if (outcome.kind === 'refused') {
      const message: Record<typeof outcome.reason, string> = {
        not_held: 'You do not hold all of that district',
        already_working: 'Work on that gate is already under way',
        at_ceiling: 'That gate will not go any higher',
        cannot_afford: 'You cannot pay for that',
      };
      // Work already under way and a gate at its ceiling are the place being unavailable, the
      // code `/city/upgrade` answers for the same two; only a short purse is a resource refusal.
      const code =
        outcome.reason === 'not_held'
          ? 'FORBIDDEN'
          : outcome.reason === 'cannot_afford'
            ? 'INSUFFICIENT_RESOURCES'
            : 'PLACE_UNAVAILABLE';
      throw new AppError(code, message[outcome.reason]);
    }
    return projectCity(app.repos, outcome.base, now);
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
   * `district` target (migration 0087): a home district still cannot be taken, only broken into and
   * emptied.
   */

  /** §A4: leave units on a location you hold, or bring them home. */
  /**
   * Calling work off (maintainer request, 2026-09-12; `time/cancel.ts`). Four of them here, one shape:
   * inside the first tenth, ninety percent back, and the district read back the way every other
   * city write answers.
   */
  app.post(
    '/city/cancel-upgrade',
    { preHandler: app.authenticate },
    (request): CityMutationResponse => {
      const { locationId, acceptWaste } = parseBody(CancelLocationWorkRequestSchema, request.body);
      const now = new Date();
      const base = settled(app, request.currentUser.id, now);
      const location = findLocation(locationId);
      const district = location ? findDistrict(location.districtId) : undefined;
      const control = app.repos.city.control(locationId);
      if (!location || !district || !control) throw new AppError('NOT_FOUND', 'No such location');

      const outcome = app.db.transaction(() =>
        cancelUpgrade(app.repos, {
          base,
          location,
          control,
          now,
          acceptWaste,
          admin: app.config.admin,
        }),
      )();
      if (outcome.kind === 'refused') {
        const { code, message } = WORK_CANCEL_ERRORS[outcome.reason];
        throw new AppError(code, message);
      }
      return {
        district: projectDistrict(app.repos, outcome.base, district, now, app.config.admin),
        base: outcome.base,
      };
    },
  );

  /**
   * Spying (maintainer, 2026-09-22): send the runners to look at one place, at one tier.
   *
   * Answers with the district the place is in, like every other city write: what it will show is
   * the job on the clock, and the report lands on the battle board when the runners are back.
   */
  app.post('/city/spy', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const body = parseBody(SpyRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);
    const districtId =
      body.target.kind === 'gate'
        ? body.target.districtId
        : (findLocation(body.target.locationId)?.districtId ?? '');
    const district = findDistrict(districtId);
    if (!district) throw new AppError('NOT_FOUND', 'No such place');

    const outcome = app.db.transaction(() =>
      sendSpy(app.repos, {
        base,
        target: body.target,
        tier: body.tier,
        now,
        admin: app.config.admin,
      }),
    )();
    if (outcome.kind === 'refused') {
      const { code, message } = SPY_REFUSAL_ERRORS[outcome.reason];
      throw new AppError(code, message);
    }
    return {
      district: projectDistrict(app.repos, outcome.base, district, now, app.config.admin),
      base: outcome.base,
    };
  });

  app.post(
    '/city/spy/recall',
    { preHandler: app.authenticate },
    (request): CityMutationResponse => {
      const { runId } = parseBody(RecallSpyRequestSchema, request.body ?? {});
      const now = new Date();
      const base = settled(app, request.currentUser.id, now);
      const outcome = app.db.transaction(() => recallSpy(app.repos, base, now, runId))();
      if (outcome.kind === 'refused') {
        const { code, message } = SPY_RECALL_ERRORS[outcome.reason];
        throw new AppError(code, message);
      }
      const districtId =
        outcome.run.target.kind === 'gate'
          ? outcome.run.target.districtId
          : (findLocation(outcome.run.target.locationId)?.districtId ?? '');
      const district = findDistrict(districtId);
      if (!district) throw new AppError('NOT_FOUND', 'No such place');
      return { district: projectDistrict(app.repos, base, district, now, app.config.admin), base };
    },
  );

  app.post('/city/gate/cancel', { preHandler: app.authenticate }, (request): CityResponse => {
    const { districtId, acceptWaste } = parseBody(CancelGateRaiseRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);
    const outcome = app.db.transaction(() =>
      cancelGateRaise(app.repos, base, districtId, now, acceptWaste, app.config.admin),
    )();
    if (outcome.kind === 'refused') {
      const { code, message } = GATE_CANCEL_ERRORS[outcome.reason];
      throw new AppError(code, message);
    }
    return projectCity(app.repos, outcome.base, now);
  });

  /*
   * `POST /city/garrison` was here. It stood units on held ground, or brought them home, in the
   * same instant (maintainer, 2026-09-28: "Nothing sends units immediately, you need to move
   * them"). The Garrison button opens the Move dialog now, and the column walks
   * (`POST /actions/move`).
   */

  /**
   * §A4: plant a cell of Sleepers on ground this crew does not hold.
   *
   * The one door in the game that puts units somewhere without a fight or a job to send them to.
   * See `city/sleepers.ts`; the refusals are its own, because none of `CityRefusal`'s fit.
   */
  app.post('/city/sleepers', { preHandler: app.authenticate }, (request): CityMutationResponse => {
    const { locationId, army } = parseBody(PlantSleepersRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);

    const location = findLocation(locationId);
    const district = location ? findDistrict(location.districtId) : undefined;
    if (!location || !district) throw new AppError('NOT_FOUND', 'No such location');

    const outcome = app.db.transaction(() =>
      plantSleepers(app.repos, { base, locationId, army, now }),
    )();
    if (outcome.kind === 'refused') {
      throw new AppError('PLACE_UNAVAILABLE', SLEEPER_REFUSAL_TEXT[outcome.reason]);
    }
    return {
      district: projectDistrict(app.repos, outcome.base, district, now, app.config.admin),
      base: outcome.base,
    };
  });

  /** ...and pull one back out. They walk home the leg they walked out. */
  app.post('/city/sleepers/recall', { preHandler: app.authenticate }, (request): { ok: true } => {
    const { cellId } = parseBody(RecallSleepersRequestSchema, request.body);
    const now = new Date();
    const base = settled(app, request.currentUser.id, now);
    const recalled = app.db.transaction(() => recallSleepers(app.repos, base, cellId, now))();
    if (recalled.kind === 'refused' && recalled.reason === 'locked') {
      throw new AppError(
        'PLACE_UNAVAILABLE',
        'A fight lands there within the hour. Nobody leaves the ground now',
      );
    }
    if (recalled.kind === 'refused')
      throw new AppError('NOT_FOUND', 'No cell of yours is out there');
    return { ok: true };
  });

  /**
   * §A4: work a location up one level.
   *
   * Charged up front, a clock on the row, banked by the settler on the next read. A level makes a
   * location *worth more*, and a banked level survives a capture (§A4); work still running is lost.
   * Making a location *harder to take* is the gate's job alone since dug-in fortification left the
   * game (maintainer, 2026-09-26).
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
      startUpgrade(app.repos, { base, location, control, now, admin: app.config.admin }),
    )();
    if (outcome.kind === 'refused') {
      throw new AppError(UPGRADE_ERROR_CODES[outcome.reason], UPGRADE_REFUSALS[outcome.reason]);
    }

    return {
      district: projectDistrict(app.repos, outcome.base, district, now, app.config.admin),
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
