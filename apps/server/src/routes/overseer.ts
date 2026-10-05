import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  DISTRICT_NAME_MAX,
  findOverseerPreset,
  OVERSEER_HOLD_MS,
  type OverseerPreset,
  OVERSEER_PRESETS,
  overseerOffer,
  overseerRemaining,
  cityHomeOffer,
  cityHomeOffers,
  DEFAULT_CITY_ID,
  findCity,
  homePlots,
  freeHomePlots,
  pickHomePlot,
  STARTER_DISTRICT_ID,
  type Base,
  type CreateOverseerResponse,
  type OverseerChoicesResponse,
  overseerFromPreset,
  isReservedDistrictName,
  sameDistrictName,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { applyUnlockedSandbox } from '../seed/sandbox.js';
import { startingBase } from '../crew/starting.js';
import { MVP_PLAYER } from '../seed/constants.js';
import { offerOpeningInvitationAt } from '../factions/opening.js';
import { tallyOverseerTaken } from '../feats/tally.js';
import { AppError, parseBody } from '../errors.js';
import { takenHomes } from '../city/homes.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The name a allegiance carries until its player picks one.
 *
 * Truncated to `DISTRICT_NAME_MAX` here rather than left to fail validation on the way into the
 * database: usernames can be longer than a allegiance name may be, and a registration that succeeded
 * and then could not create a base would be an unrecoverable account.
 */
function defaultFactionName(username: string): string {
  return `${username}'s Crew`.slice(0, DISTRICT_NAME_MAX);
}

/**
 * The first name in this city nobody else is using, starting from what the username suggests.
 *
 * Usernames are unique, so the derived name almost always is too. Almost: `DISTRICT_NAME_MAX`
 * truncates, so two long usernames sharing a prefix derive the same crew name, and any player may
 * simply have *renamed* themselves to the name a later registration is about to derive.
 *
 * It disambiguates rather than refusing, deliberately. The note on `defaultFactionName` above is
 * the reason: a registration that succeeds and then cannot create a base is an unrecoverable
 * account, and a collision on a name the player never chose is not something to hand them as an
 * error. They can rename to whatever they like the moment they are in.
 */
function freeDistrictName(app: FastifyInstance, username: string): string {
  const taken = app.repos.bases.listSummaries();
  const isFree = (candidate: string): boolean =>
    !isReservedDistrictName(candidate) &&
    !taken.some((summary) => sameDistrictName(summary.name, candidate));

  const wanted = defaultFactionName(username);
  if (isFree(wanted)) return wanted;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${wanted.slice(0, DISTRICT_NAME_MAX - suffix.length)}${suffix}`;
    if (isFree(candidate)) return candidate;
  }
  // A thousand crews with one name is not a state this game reaches; the id keeps them apart.
  return `${wanted.slice(0, DISTRICT_NAME_MAX - 9)} ${randomUUID().slice(0, 8)}`;
}

/**
 * Which plot a new crew moves onto (maintainer, 2026-09-24).
 *
 * The player picks a city on the screen after the character, and a free plot in it is drawn at
 * random. Four plots a city, one resident player crew each, and a city whose four are taken is
 * refused rather than shared: `homes.ts` holds both rules and the choose screen reads them off
 * `GET /overseer/choices`.
 *
 * ## This replaces the quietest-plot rule, and the ruling under it
 *
 * Placement used to be "the residential district of Ashfall that the fewest players live on", and
 * the doc here argued at length that Terminus's four plots were deliberately not on offer because
 * a crew earns its foothold in the second city by marching across and taking ground. That was the
 * call on 2026-09-24 and the maintainer replaced it the same day: a new player now picks which of
 * the playable cities to start in, so both maps are on offer from the first minute.
 *
 * ## When nobody picked
 *
 * `cityId` is optional on the wire (see `CreateOverseerRequestSchema`), and an account that sends
 * none still has to be seated somewhere. It gets {@link STARTER_DISTRICT_ID} while that is free,
 * because it is the plot the opening was written around, and otherwise the first city with room.
 * That keeps a client which has not been redeployed, and the server's own test helper, on exactly
 * the ground they have always been given.
 *
 * Throws rather than returning null, because every refusal here is one the player has to be told
 * apart: a city with no map was never on offer and a full city is the honest race, which is the
 * same pair of refusals `UNKNOWN_PRESET` and `PRESET_TAKEN` are for a character.
 */
function newHome(repos: Repositories, cityId: string | undefined, seed: string): string {
  const taken = takenHomes(repos);

  if (cityId !== undefined) {
    const offer = cityHomeOffer(cityId, taken);
    if (offer.refusal === 'unbuilt') {
      throw new AppError(
        'CITY_UNBUILT',
        `${findCity(cityId)?.name ?? cityId} is not somewhere you can play yet.`,
      );
    }
    const plot = pickHomePlot(cityId, taken, seed);
    if (plot === null) {
      throw new AppError(
        'CITY_FULL',
        `${findCity(cityId)?.name ?? cityId} is full. ${homePlots(cityId).length} crews already live there, so pick somewhere else.`,
      );
    }
    return plot;
  }

  if (freeHomePlots(DEFAULT_CITY_ID, taken).includes(STARTER_DISTRICT_ID)) {
    return STARTER_DISTRICT_ID;
  }
  const room = cityHomeOffers(taken).find((offer) => offer.available);
  const anywhere = room === undefined ? null : pickHomePlot(room.cityId, taken, seed);
  if (anywhere === null) {
    throw new AppError(
      'CITY_FULL',
      'Every city in the world is full. There is nowhere to move in.',
    );
  }
  return anywhere;
}

/**
 * The batch this account is holding, drawing and holding a fresh one if it has none (§F6).
 *
 * The offer *is* the hold now. It used to be a pure function of the account id, recomputed on every
 * read and reserving nothing, so four players could be looking at the same character and three of
 * them were pressing a button that could not work: measured on a live server, three of five
 * accounts registering together collided on their first pick.
 *
 * Three things follow from making it a reservation:
 *
 *  - **The draw skips what others are holding**, not only what is claimed, so two live batches
 *    never overlap and the collision is gone rather than reported better.
 *  - **The batch is stored**, so a refresh inside the window shows the same four people. A
 *    deterministic hash used to do that job; it cannot any more, because the pool it draws from
 *    changes as other people's holds come and go.
 *  - **It lapses.** {@link OVERSEER_HOLD_MS} later the rows are swept and the next read draws
 *    somebody new, which is what stops a closed tab holding four of thirty for ever.
 *
 * Seeded on a fresh id rather than on the account, so a lapsed batch is replaced by a *different*
 * four. Hashing the account would have redrawn the same people every time, which is not a new
 * offer, it is the old one with a new expiry.
 */
function offerFor(
  repos: Repositories,
  accountId: string,
  now: Date,
): { choices: readonly OverseerPreset[]; expiresAt: string | null } {
  repos.overseers.sweepHolds(now);

  const standing = repos.overseers.holdsFor(accountId, now);
  if (standing.presetIds.length > 0) {
    const held = standing.presetIds
      .map((presetId) => findOverseerPreset(presetId))
      .filter((preset): preset is OverseerPreset => preset !== undefined);
    if (held.length > 0) return { choices: held, expiresAt: standing.expiresAt };
  }

  const claimed = repos.overseers.claimedPresetIds();
  const heldByAnyone = repos.overseers.heldPresetIds(now);
  const blocked = new Set([...claimed, ...heldByAnyone]);
  const choices = overseerOffer(blocked, randomUUID());
  if (choices.length === 0) return { choices, expiresAt: null };

  const expiresAt = new Date(now.getTime() + OVERSEER_HOLD_MS);
  repos.overseers.hold(
    accountId,
    choices.map((preset) => preset.presetId),
    expiresAt,
  );
  return { choices, expiresAt: expiresAt.toISOString() };
}

/** Whether this account is actually holding the character it is trying to take. */
function holding(repos: Repositories, accountId: string, presetId: string, now: Date): boolean {
  return repos.overseers.holdsFor(accountId, now).presetIds.includes(presetId);
}

export function registerOverseerRoutes(app: FastifyInstance): void {
  /**
   * The four characters this account may pick from (§F6, maintainer request 2026-09-15).
   *
   * Behind `authenticate` because the offer is *this account's*: it is a hash of the caller's id,
   * so an anonymous reader has nothing to be offered. The claimed set is read fresh on every call
   * rather than cached, which is the whole point of a shared pool: a character somebody took two
   * seconds ago is gone from the next reader's four.
   */
  app.get(
    '/overseer/choices',
    { preHandler: app.authenticate },
    (request): OverseerChoicesResponse => {
      /*
       * A crew that already has somebody is not offered four more (maintainer, 2026-09-18).
       *
       * `POST /overseer` has always refused them, but this read did not, and since an offer became
       * a **hold** it stopped being free to ask: a settled account calling this took four of the
       * thirty characters out of the world for ten minutes and could never take one, because the
       * write would refuse it. Nothing released them either, so a client that polled this endpoint
       * after choosing held four hostage indefinitely, and a handful of such callers would empty
       * the pool for everybody actually trying to start.
       *
       * Refused with the same code the write uses, because it is the same fact about the caller.
       */
      if (request.currentUser.overseerId !== null) {
        throw new AppError('OVERSEER_ALREADY_CHOSEN', 'You have already chosen an overseer');
      }
      const now = new Date();
      const claimed = app.repos.overseers.claimedPresetIds();
      const offer = app.db.transaction(() => offerFor(app.repos, request.currentUser.id, now))();
      return {
        choices: [...offer.choices],
        expiresAt: offer.expiresAt,
        serverNow: now.toISOString(),
        // Counted off the pool rather than as `total - claimed.size`: the claimed set is raw
        // `preset_id` values, and migration 0095 leaves a spent `enforcer:<uuid>` claim behind for
        // every duplicate a legacy save carried. Those are not characters, so subtracting them
        // understated the count, and a save with more overseer rows than there are characters
        // printed a negative one.
        remaining: overseerRemaining(claimed),
        total: OVERSEER_PRESETS.length,
        /*
         * Where they may live, read fresh on every call for the same reason the claimed set is: a
         * plot somebody took two seconds ago is gone from the next reader's offer. Sent from here
         * because a browser cannot see who lives where, and computed outside the transaction
         * above because it decides nothing. `POST /overseer` is where it decides.
         */
        cities: cityHomeOffers(takenHomes(app.repos)),
      };
    },
  );

  app.post(
    '/overseer',
    { preHandler: app.authenticate },
    (request, reply): CreateOverseerResponse => {
      const { presetId, cityId } = parseBody(CreateOverseerRequestSchema, request.body);
      const user = request.currentUser;

      if (user.overseerId !== null) {
        throw new AppError('OVERSEER_ALREADY_CHOSEN', 'You have already chosen an overseer');
      }
      const preset = findOverseerPreset(presetId);
      if (!preset) {
        throw new AppError('UNKNOWN_PRESET', `Unknown overseer preset: ${presetId}`);
      }
      /*
       * §F6: it has to be one of *this* account's four, and still unclaimed.
       *
       * Both halves matter and they fail for different reasons. A character outside the offer is a
       * client asking for somebody it was never shown, which is the whole pool defeated by a
       * hand-written request; one inside the offer but already taken is the honest race, two
       * players on the last copy of the same person. The read is repeated inside the transaction
       * below, where it is the one that actually decides.
       */
      /*
       * §F6: it has to be a character this account is *holding*, and the hold has to be live.
       *
       * A take outside the hold is one of two things and the message has to tell them apart. A
       * character that was never offered is a hand-written request going round the pool. A
       * character that *was* offered, on a batch that has since lapsed, is an ordinary player who
       * left the tab open over lunch: they have done nothing wrong and what they need is to be
       * told the offer moved on, not that somebody beat them to it.
       */
      const takenAt = new Date();
      if (!holding(app.repos, user.id, presetId, takenAt)) {
        const lapsed = app.repos.overseers.holdsFor(user.id, takenAt).presetIds.length === 0;
        throw lapsed
          ? new AppError(
              'OFFER_EXPIRED',
              'That offer has run out. Refresh for four new people to choose from.',
            )
          : new AppError('PRESET_TAKEN', 'Somebody else is already that person');
      }

      const now = takenAt.toISOString();
      const overseer = overseerFromPreset(preset, randomUUID());
      /*
       * The crew, and the plot it is put on, decided **inside** the transaction below.
       *
       * Both halves have to be, and for the same reason the character claim is: a city has four
       * plots and two accounts can want the last one in the same second. Reading who lives where
       * out here and inserting in there is exactly the gap that seats two crews on one plot, so
       * the free list is read and spent in one transaction and the loser is refused `CITY_FULL`.
       *
       * The transaction answers with the crew rather than writing to a `let`, so nothing after it
       * has to reason about whether it ran. An account that has been through the Console's Clean
       * slate already has a base, and it keeps the district it is standing on: the response has to
       * report that one, because reading the new base's id back finds nothing.
       */
      const district = app.db.transaction((): Base => {
        /*
         * Re-read inside the transaction, the way every other once-per-account rule in this server
         * is.
         *
         * The check at the top of the handler is against `request.currentUser`, which the
         * `authenticate` preHandler filled in *before* an await, so it is a snapshot from outside
         * this transaction. `/factions` re-reads its membership inside its own transaction and says
         * why; this route did not. Migration 0074 puts a unique index behind both columns as well,
         * because a rule that lives only in a `!==` is a rule with nothing durable underneath it.
         */
        if (app.repos.users.findById(user.id)?.overseerId != null) {
          throw new AppError('OVERSEER_ALREADY_CHOSEN', 'You have already chosen an overseer');
        }
        // ...and the same for the pool, for the same reason: the check above this transaction is a
        // snapshot from outside it. Migration 0095 puts a unique index under this as well, so the
        // worst a lost race can do is fail the insert rather than seat two accounts on one person.
        if (app.repos.overseers.claimedPresetIds().has(presetId)) {
          throw new AppError('PRESET_TAKEN', 'Somebody else is already that person');
        }
        app.repos.overseers.insert({
          overseer,
          userId: user.id,
          presetId: preset.presetId,
          createdAt: now,
        });
        app.repos.users.setOverseerId(user.id, overseer.id);
        /*
         * §F6: the other three go straight back in the pool.
         *
         * A batch is held so one account can decide between four people; the moment it has decided,
         * the three it walked past are somebody else's to be offered. Leaving them held would have
         * kept three of thirty characters out of the world for the rest of the ten minutes, for an
         * account that is already playing and will never look at them again. Caught by
         * `overseer-holds.test.ts` rather than by reading, which is why it counts the rows.
         */
        app.repos.overseers.releaseHolds(user.id);
        /*
         * Reuse the district if this account already has one.
         *
         * The Console's Clean slate empties a crew's base in place and clears the overseer, so a
         * player arrives back at the picker with a base row still under them. Inserting here would
         * mint a second one and trip migration 0074's unique index on `owner_id`, which is the
         * rule working: one base per account. Re-attaching the new character to the district that
         * is already theirs is what that rule wants.
         *
         * A base that has just been reset is already at the shape `startingBase` returns, so
         * nothing needs writing to it. The ground is opened either way, because the reset released
         * every location this crew held.
         *
         * A reset crew keeps its old address rather than moving to the city it just picked. The
         * plot it is standing on is still its own and nothing else has been allowed to take it,
         * so moving would mean vacating one city and racing for a plot in another to return to
         * the same starting state. Clean slate is a bench tool and this is the cheap answer;
         * the day it is wrong, the fix is a move, not a second insert.
         */
        const standing = app.repos.bases.findByOwnerId(user.id);
        const home =
          standing ??
          startingBase({
            ownerId: user.id,
            name: freeDistrictName(app, user.username),
            now,
            districtId: newHome(app.repos, cityId, randomUUID()),
          });
        if (standing === undefined) app.repos.bases.insert(home);
        /*
         * ...and the feats board's first rung is finished before the player has seen it.
         *
         * `overseer_taken` is what the opening feat measures, and it pays the five Scavengers a
         * new crew needs to send anybody anywhere: the Nexus can muster them and nothing else in a
         * fresh district can muster anything (`units/catalog.ts`). Counted here rather than at the
         * top of the handler because a tally is keyed by base, and until this transaction the
         * base may not exist.
         */
        tallyOverseerTaken(app.repos, home.id);
        return home;
      })();

      // The sandbox switch also runs at boot, but a base does not exist until this moment: on a
      // fresh database the flag would silently do nothing until the next restart, which is exactly
      // the kind of "did I set it wrong?" that makes a dev switch useless.
      //
      // The seeded dev account and nobody else. `applyUnlockedSandbox` raises whichever username
      // it is handed, and this used to hand it the caller's, so on a server with the flag on every
      // account that picked a character opened at level 20: the sandbox's own doc says "it only
      // ever touches the seeded dev account", and the boot-time call keeps that promise by name.
      if (app.config.unlocked && user.username === MVP_PLAYER.username) {
        applyUnlockedSandbox(app.repos, MVP_PLAYER.username);
        app.log.warn({ baseId: district.id }, 'UNLOCKED=true: new district opened at the end-game');
      }

      // The seeded faction's invitation waits for the level the Faction door opens at (2026-09-28);
      // a crew that starts there (the dev sandbox) is asked now.
      offerOpeningInvitationAt(app.repos, user.id, district.level, now);

      const opened = app.repos.bases.findById(district.id) ?? district;
      reply.code(201);
      return { user: { ...user, overseerId: overseer.id }, overseer, base: opened };
    },
  );
}
