import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  DISTRICT_NAME_MAX,
  MAX_FACTION_MEMBERS,
  findOverseerPreset,
  OVERSEER_HOLD_MS,
  type OverseerPreset,
  OVERSEER_PRESETS,
  overseerOffer,
  overseerRemaining,
  CITY_DISTRICTS,
  districtHolder,
  districtIsShut,
  STARTER_DISTRICT_ID,
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
import { sendMessage } from '../social/send.js';
import { tallyOverseerTaken } from '../feats/tally.js';
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
 * The **nearest district nobody lives in and whose gate is not shut**, so the free ground is
 * somewhere a new player can actually work: the closest district overall is often another crew's
 * home, and opening that would hand a beginner a view of somebody's defences and nothing to do
 * with it. Nearest rather than best, because the map's geography should be the thing that decides,
 * and nearest is also the one they would have sent somebody to first.
 *
 * ## Shut ground counts as nowhere to work (maintainer, 2026-09-18)
 *
 * The clause was only "nobody lives there" until new crews were spread across the four residential
 * plots (`quietestDistrict`). A district nobody lives in can still be held end to end by one party,
 * which shuts its gate, and nothing behind a shut gate can be called: the card offers a dead
 * "Behind the gate" button where "Call a fight" would be. A crew planted on the Ashen Terraces was
 * handed `datavault-sigma`, Combine-held from end to end, and opened its first evening with a
 * district it could look at and not touch. Measured across all four homes, that was one in four
 * new players.
 *
 * So the promise in the paragraph above is now actually checked rather than approximated by
 * occupancy, which is the weaker half of it.
 */
function openTheNearestGround(repos: Repositories, base: Base, nowIso: string): void {
  const home = findDistrict(base.districtId);
  if (!home) return;
  const occupied = new Set(repos.bases.listSummaries().map((other) => other.districtId));
  const controls = repos.city.controls();
  const lived = new Set(repos.bases.listSummaries().map((other) => other.districtId));
  const nearest = CITY_DISTRICTS.filter(
    (district) =>
      district.id !== base.districtId &&
      !occupied.has(district.id) &&
      !districtIsShut(districtHolder(district, controls) ?? null, lived.has(district.id)),
  ).sort(
    (a, b) =>
      travelMinutesBetween(home, a) - travelMinutesBetween(home, b) || a.id.localeCompare(b.id),
  )[0];
  if (nearest) repos.city.markScouted(base.id, nearest.id, nowIso);
}

/**
 * Which residential district a new crew moves into (maintainer, 2026-09-17).
 *
 * The one fewest *players* live on, ties going to {@link STARTER_DISTRICT_ID} and then to the id.
 * Every human account used to be created in the starter, which put the whole player base in one
 * district: a crew calling on another player's district was calling on its own and was refused with
 * "That is yours", so the only PvP left was over locations. Three players now fill three of the
 * four, which is what the maintainer asked for.
 *
 * ## Why the seeded rivals are not counted
 *
 * They live in three of the four residential districts, so counting them would put the first three
 * players on top of a bot each and leave the quiet one for the fourth. A bot is somebody to fight,
 * not a neighbour competing for somewhere to live, and the question this answers is where the
 * *players* are.
 *
 * ## Why the starter wins a tie
 *
 * So the first crew in an empty world still lands where the onboarding was written for, and only
 * the second player onwards spreads out. It also keeps every test that plants a second crew on a
 * named neighbour working, which is a fleet of them.
 */
function quietestDistrict(repos: Repositories): string {
  const residential = CITY_DISTRICTS.filter((district) => district.kind === 'residential');
  if (residential.length === 0) return STARTER_DISTRICT_ID;

  const crowding = new Map(residential.map((district) => [district.id, 0]));
  for (const home of repos.bases.listSummaries()) {
    if (home.isBot) continue;
    const had = crowding.get(home.districtId);
    if (had !== undefined) crowding.set(home.districtId, had + 1);
  }

  const rank = (id: string): number => (id === STARTER_DISTRICT_ID ? 0 : 1);
  return [...crowding.entries()].sort(
    (a, b) => a[1] - b[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
  )[0]![0];
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
        districtId: quietestDistrict(app.repos),
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
         */
        const standing = app.repos.bases.findByOwnerId(user.id);
        if (standing === undefined) app.repos.bases.insert(base);
        district = standing ?? base;
        openTheNearestGround(app.repos, district, now);
        /*
         * ...and the feats board's first rung is finished before the player has seen it.
         *
         * `overseer_taken` is what the opening feat measures, and it pays the five Scavengers a
         * new crew needs to send anybody anywhere: the Nexus can train them and nothing else in a
         * fresh district can train anything (`units/catalog.ts`). Counted here rather than at the
         * top of the handler because a tally is keyed by base, and until this transaction the
         * base may not exist.
         */
        tallyOverseerTaken(app.repos, district.id);
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
      const faction = seeded === undefined ? undefined : app.repos.factions.find(seeded);
      if (seeded && faction && app.repos.factions.memberCount(seeded) < MAX_FACTION_MEMBERS) {
        const leader = app.repos.factions
          .members(seeded)
          .find((member) => member.rank === 'leader');
        const inviteId = randomUUID();
        app.repos.factions.invite({
          id: inviteId,
          factionId: seeded,
          invitedUserId: user.id,
          invitedByUserId: leader?.userId ?? user.id,
          sentAt: now,
        });
        /*
         * Delivered as a **message**, the way every other invitation is (`routes/factions.ts`).
         *
         * It used to be a bell entry alone, pointing at `/game/faction`. That screen is behind
         * `RequireUnlock area="faction"`, which is level 10, and this invitation arrives at level
         * one: the first notification a new account ever received was a door it could not open,
         * for an offer it had no way to answer. The mailbox is not gated, and a message carrying
         * `invite` is what makes `InviteCard` draw an Accept button, so this is the only delivery
         * that is actually actionable on the day it is sent. `FoundFaction`'s own copy already
         * told the player their invitation would be "in your messages, with a button on it".
         *
         * The bell still rings `faction_invite` rather than `message_received`, so a player who
         * has muted ordinary mail still hears this one.
         */
        const inviter = leader?.userId ?? user.id;
        sendMessage(app.repos, {
          sender: { id: inviter, username: faction.name },
          senderFaction: faction.name,
          recipients: [user.id],
          audience: 'player',
          addressedTo: user.username,
          subject: `An invitation to ${faction.name}`,
          body:
            `${faction.name} has asked you to join them.\n\n` +
            `${faction.blurb || 'They have not written down what they are for.'}\n\n` +
            'Accepting puts your district at their table: your army shows up on their roster, ' +
            'their fights show up on yours, and either of you can send help to the other.',
          sentAt: new Date(now),
          invite: { inviteId, factionId: faction.id },
          notification: {
            kind: 'faction_invite',
            title: `${faction.name} has asked you to join`,
            body: 'There is a table with a seat open.',
            link: '/game/messages',
          },
          keepSentCopy: false,
        });
      }

      const opened =
        district === undefined ? base : (app.repos.bases.findById(district.id) ?? district);
      reply.code(201);
      return { user: { ...user, overseerId: overseer.id }, overseer, base: opened };
    },
  );
}
