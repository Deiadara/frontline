import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  DISTRICT_NAME_MAX,
  MAX_FACTION_MEMBERS,
  findOverseerPreset,
  OVERSEER_PRESETS,
  overseerOffer,
  overseerRemaining,
  CITY_DISTRICTS,
  findDistrict,
  travelMinutesBetween,
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
import { seededFactionId } from '../seed/index.js';
import { notify } from '../social/notify.js';
import { AppError, parseBody } from '../errors.js';
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
 * §A4: one district open from the first minute (maintainer request).
 *
 * Scouting is a journey now, and a new crew has nobody worth sending and nothing to do while they
 * walk. Starting wholly fogged in meant a first session that opens with a four-hour wait before
 * the first mission board can be read, which is the worst possible first five minutes.
 *
 * The **nearest district nobody lives in**, so the free ground is somewhere a new player can
 * actually work: the closest district overall is often another crew's home, and opening that would
 * hand a beginner a view of somebody's defences and nothing to do with it. Nearest rather than
 * best, because the map's geography should be the thing that decides, and nearest is also the one
 * they would have sent somebody to first.
 */
function openTheNearestGround(repos: Repositories, base: Base, nowIso: string): void {
  const home = findDistrict(base.districtId);
  if (!home) return;
  const occupied = new Set(repos.bases.listSummaries().map((other) => other.districtId));
  const nearest = CITY_DISTRICTS.filter(
    (district) => district.id !== base.districtId && !occupied.has(district.id),
  ).sort(
    (a, b) =>
      travelMinutesBetween(home, a) - travelMinutesBetween(home, b) || a.id.localeCompare(b.id),
  )[0];
  if (nearest) repos.city.markScouted(base.id, nearest.id, nowIso);
}

/** Whether a character is in this account's own four, and therefore pickable by them. */
function offered(repos: Repositories, accountId: string, presetId: string): boolean {
  return overseerOffer(repos.overseers.claimedPresetIds(), accountId).some(
    (preset) => preset.presetId === presetId,
  );
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
      const claimed = app.repos.overseers.claimedPresetIds();
      return {
        choices: [...overseerOffer(claimed, request.currentUser.id)],
        // Counted off the pool rather than as `total - claimed.size`: the claimed set is raw
        // `preset_id` values, and migration 0095 leaves a spent `enforcer:<uuid>` claim behind for
        // every duplicate a legacy save carried. Those are not characters, so subtracting them
        // understated the count, and a save with more overseer rows than there are characters
        // printed a negative one.
        remaining: overseerRemaining(claimed),
        total: OVERSEER_PRESETS.length,
      };
    },
  );

  app.post(
    '/overseer',
    { preHandler: app.authenticate },
    (request, reply): CreateOverseerResponse => {
      const { presetId } = parseBody(CreateOverseerRequestSchema, request.body);
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
      if (!offered(app.repos, user.id, presetId)) {
        throw new AppError('PRESET_TAKEN', 'Somebody else is already that person');
      }

      const now = new Date().toISOString();
      const overseer = overseerFromPreset(preset, randomUUID());
      /*
       * Which district this character ends up on, decided inside the transaction below.
       *
       * The `base` built here is the one a *new* account gets. An account that has been through
       * the Console's Clean slate already has a district, and reuses it; `district` is what the
       * response then has to report, because reading the new `base.id` back finds nothing and
       * falls through to an object that was never saved. That was the first cut of this, and it
       * answered with a second crew that did not exist.
       */
      let district: Base | undefined;
      const base = startingBase({
        ownerId: user.id,
        name: freeDistrictName(app, user.username),
        now,
      });

      app.db.transaction(() => {
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
         */
        const standing = app.repos.bases.findByOwnerId(user.id);
        if (standing === undefined) app.repos.bases.insert(base);
        district = standing ?? base;
        openTheNearestGround(app.repos, district, now);
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
        app.log.warn(
          { baseId: district?.id ?? base.id },
          'UNLOCKED=true: new district opened at the end-game',
        );
      }

      /*
       * An invitation from the seeded faction, if there is room at it.
       *
       * A new account meets factions through the real door rather than by being quietly enrolled:
       * they get an invitation in their notifications and on the faction screen, and accepting it
       * runs the same `POST /factions/answer` anybody else's invitation does. Silently adding them
       * to a table they never agreed to join would have been the shorter route and the wrong one.
       */
      const seeded = seededFactionId(app.repos);
      if (seeded && app.repos.factions.memberCount(seeded) < MAX_FACTION_MEMBERS) {
        const leader = app.repos.factions
          .members(seeded)
          .find((member) => member.rank === 'leader');
        app.repos.factions.invite({
          id: randomUUID(),
          factionId: seeded,
          invitedUserId: user.id,
          invitedByUserId: leader?.userId ?? user.id,
          sentAt: now,
        });
        notify(app.repos, {
          userId: user.id,
          kind: 'faction_invite',
          title: 'A faction has asked you to join',
          body: 'There is a table with a seat open.',
          link: '/game/faction',
          now: new Date(now),
        });
      }

      const opened =
        district === undefined ? base : (app.repos.bases.findById(district.id) ?? district);
      reply.code(201);
      return { user: { ...user, overseerId: overseer.id }, overseer, base: opened };
    },
  );
}
