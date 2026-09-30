import type { LevelUp, PartialResources } from '@frontline/shared';
import { z } from 'zod';

/** Domain error codes from docs/SPEC-server.md: always SCREAMING_SNAKE. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'FACTION_REFUSED'
  /** A feat cannot be collected: unfinished, locked, or already in the bank. */
  | 'FEAT_REFUSED'
  | 'MESSAGE_REFUSED'
  | 'NOT_FOUND'
  /** The screen that pressed was showing a state the row has since left: press again from the new one. */
  | 'STALE_STATE'
  | 'USERNAME_TAKEN'
  /** A rename onto a name the game keeps for itself (`isReservedName`). Sign-up refuses it at the schema. */
  | 'USERNAME_RESERVED'
  /** Another account already goes by that name, as its username or its display name. */
  | 'DISPLAY_NAME_TAKEN'
  | 'DISTRICT_NAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'OVERSEER_ALREADY_CHOSEN'
  | 'UNKNOWN_PRESET'
  | 'PRESET_TAKEN'
  | 'OFFER_EXPIRED'
  | 'NO_BASE'
  | 'INVALID_TARGET'
  | 'MISSIONS_AT_CAPACITY'
  // the Bar (GDD §H)
  | 'RECRUIT_UNAVAILABLE'
  | 'NO_RECRUIT_SLOTS'
  | 'ROLE_TAKEN'
  | 'INSUFFICIENT_CAPS'
  /** §H7a: the table will not take that bid. The message carries the number that would. */
  | 'BID_REFUSED'
  /** §H7a: the crew is already sitting at as many tables as its level allows. */
  | 'TOO_MANY_AUCTIONS'
  | 'NO_PAYROLL'
  /** §H7: the payroll ladder is bought out. There is no further step to sell. */
  | 'PAYROLL_AT_MAX'
  | 'AREA_LOCKED'
  /**
   * The door on a city's rooms, shut (maintainer, 2026-09-17).
   *
   * A crew may use a city's bar and its market while they hold ground in it, so this is the refusal
   * for a read that named a city they hold nothing in. `FORBIDDEN` would have done for the status
   * and not for the screen: a player whose last location changed hands wants to be told what the
   * door now costs, and a code of its own is what lets the client say it.
   */
  | 'CITY_SHUT'
  /**
   * The city a new player asked to live in has no map behind it (maintainer, 2026-09-24).
   *
   * The choose-a-city screen draws every city and only offers the ones with a map, a seeded world
   * and a mission board, so this is a request for something that was never on the menu: the same
   * shape of mistake as `UNKNOWN_PRESET`, and it wears the same status.
   */
  | 'CITY_UNBUILT'
  /**
   * Four crews already live there (maintainer, 2026-09-24).
   *
   * A city has four residential plots and one resident player crew each. This is the honest race,
   * two accounts on the last plot in the same second, so it is `PRESET_TAKEN`'s sibling and not a
   * bad request: the screen that showed it was right when it drew it.
   */
  | 'CITY_FULL'
  /**
   * No city has a free plot, so a new account could never play (bug pass, 2026-09-29). Refused at
   * sign-up, before an account exists to hold four overseers out of the pool while it waits.
   */
  | 'WORLD_FULL'
  // research (GDD §C)
  | 'RESEARCH_BUSY'
  | 'RESEARCH_OPTION_LOCKED'
  | 'RESEARCH_EXHAUSTED'
  | 'TRAINING_REFUSED'
  | 'MARKET_REFUSED'
  | 'BLACK_MARKET_REFUSED'
  | 'MISSION_REFUSED'
  | 'WORKSHOP_REFUSED'
  /** A blueprint could not be unlocked: unknown, already held, or short of pages (D10). */
  | 'BLUEPRINT_REFUSED'
  | 'REIMAGINING_REFUSED'
  | 'MISSION_NEEDS_OFFICER'
  // the district (GDD §A1, §D3)
  | 'INSUFFICIENT_RESOURCES'
  | 'STRUCTURE_AT_MAX_LEVEL'
  | 'STRUCTURE_LOCKED'
  | 'NEXUS_CAP'
  | 'BOOST_REFUSED'
  | 'SLOT_REFUSED'
  | 'SCRAPYARD_REFUSED'
  | 'BUILD_QUEUE_FULL'
  | 'MISSING_PARTS'
  | 'NO_HOUSING'
  // the city and its units (GDD §A4, §A5)
  | 'NO_FORCE'
  | 'PLACE_UNAVAILABLE'
  | 'UNIT_LOCKED'
  | 'TRAINING_QUEUE_FULL'
  | 'NO_UNIT_SLOTS'
  // declared battles and the §D7 sinks
  | 'BATTLE_REFUSED'
  /**
   * The database was busy and the write did not happen. Nothing was half-written: press again.
   *
   * Surfaced by a soak against a hosted server on 2026-09-17, where a second process writing to
   * the same file (a backup, an admin script, a migration, a second instance) made an ordinary
   * `POST /units/train` answer `500 INTERNAL`. SQLite allows one writer at a time, and a
   * transaction that has already read cannot then wait for the write lock without risking a
   * deadlock, so it is refused immediately whatever `busy_timeout` says. That is a transient
   * refusal and it has a shape: the request is safe to repeat.
   */
  | 'DATABASE_BUSY'
  /** The process is at a capacity it holds on purpose (live streams). Try again shortly. */
  | 'SERVER_BUSY'
  | 'NOT_ENOUGH_INFAMY'
  /**
   * The request would credit more than the stores hold, and the player has not agreed to lose the
   * difference (maintainer ruling, 2026-09-28). Carries the figure; the same request with
   * `acceptWaste` goes through and throws the excess away.
   */
  | 'WOULD_WASTE'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  FACTION_REFUSED: 409,
  FEAT_REFUSED: 409,
  MESSAGE_REFUSED: 409,
  NOT_FOUND: 404,
  STALE_STATE: 409,
  USERNAME_TAKEN: 409,
  USERNAME_RESERVED: 409,
  DISPLAY_NAME_TAKEN: 409,
  DISTRICT_NAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  OVERSEER_ALREADY_CHOSEN: 409,
  UNKNOWN_PRESET: 400,
  PRESET_TAKEN: 409,
  /*
   * §F6: the ten minutes ran out while the tab was open.
   *
   * 410 rather than 409, and the difference is what the client does next. A 409 is "somebody beat
   * you to that one, pick another of your four"; this is "the four are gone, ask for four more",
   * which is a reload of the choices rather than a second press.
   */
  OFFER_EXPIRED: 410,
  NO_BASE: 409,
  // Not 404: the city is there and the crew is not welcome in it, which is what 403 says.
  CITY_SHUT: 403,
  CITY_UNBUILT: 400,
  CITY_FULL: 409,
  WORLD_FULL: 409,
  TRAINING_REFUSED: 409,
  MARKET_REFUSED: 409,
  BLACK_MARKET_REFUSED: 409,
  MISSION_REFUSED: 409,
  ROLE_TAKEN: 409,
  NO_PAYROLL: 409,
  PAYROLL_AT_MAX: 409,
  WORKSHOP_REFUSED: 409,
  BLUEPRINT_REFUSED: 409,
  REIMAGINING_REFUSED: 409,
  INVALID_TARGET: 400,
  MISSIONS_AT_CAPACITY: 409,
  RECRUIT_UNAVAILABLE: 409,
  NO_RECRUIT_SLOTS: 409,
  INSUFFICIENT_CAPS: 409,
  BID_REFUSED: 409,
  TOO_MANY_AUCTIONS: 409,
  // 403 rather than 404: the screen exists, this crew is not senior enough to be in it, and the
  // message says which level opens it. A 404 would teach a player that the feature is not built.
  AREA_LOCKED: 403,
  RESEARCH_BUSY: 409,
  RESEARCH_OPTION_LOCKED: 409,
  RESEARCH_EXHAUSTED: 409,
  MISSION_NEEDS_OFFICER: 409,
  INSUFFICIENT_RESOURCES: 409,
  STRUCTURE_AT_MAX_LEVEL: 409,
  STRUCTURE_LOCKED: 409,
  NEXUS_CAP: 409,
  BOOST_REFUSED: 409,
  SLOT_REFUSED: 409,
  SCRAPYARD_REFUSED: 409,
  BUILD_QUEUE_FULL: 409,
  MISSING_PARTS: 409,
  NO_HOUSING: 409,
  NO_FORCE: 409,
  PLACE_UNAVAILABLE: 409,
  UNIT_LOCKED: 409,
  TRAINING_QUEUE_FULL: 409,
  NO_UNIT_SLOTS: 409,
  BATTLE_REFUSED: 409,
  // 503, not 500: nothing is wrong with the request or with the server, the moment was wrong.
  DATABASE_BUSY: 503,
  SERVER_BUSY: 503,
  NOT_ENOUGH_INFAMY: 409,
  WOULD_WASTE: 409,
  INTERNAL: 500,
};

/** A thrown domain error the central error handler maps to the `{error:{code,message}}` envelope. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /**
   * A level-up this request banked *before* it decided to refuse (MOU-280).
   *
   * The write routes settle lazily, so a refusal can sit downstream of a settlement that already
   * crossed a threshold and was written to the database. That write is not rolled back and no
   * later read re-resolves it, so a thrower that reached this state must hand the announcement to
   * the envelope or it is lost outright rather than deferred.
   */
  readonly levelUp: LevelUp | undefined;
  /** `WOULD_WASTE`: what the request would have thrown away, for the dialog that asks first. */
  readonly waste: PartialResources | undefined;

  constructor(code: ErrorCode, message: string, levelUp?: LevelUp, waste?: PartialResources) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.levelUp = levelUp;
    this.waste = waste;
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }
}

/** Parse a request body with a shared Zod schema; a failure becomes a 400 VALIDATION_ERROR. */
export function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', z.prettifyError(result.error));
  }
  return result.data;
}

const CityQuerySchema = z.object({ city: z.string().min(1).max(64).optional() });

/**
 * The `?city=` a room read may carry, or undefined for the crew's own.
 *
 * Parsed rather than cast: a repeated `?city=a&city=b` arrives as an array, and a cast lets it
 * through as a string it is not. A malformed one is refused like any other bad input.
 */
export function cityQuery(query: unknown): string | undefined {
  return parseBody(CityQuerySchema, query ?? {}).city;
}
