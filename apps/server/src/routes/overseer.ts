import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  FACTION_NAME_MAX,
  STARTER_DISTRICT_ID,
  STARTING_RESOURCES,
  findOverseerPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type CreateOverseerResponse,
  startingTraining,
  overseerFromPreset,
  isReservedFactionName,
  sameFactionName,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { applyUnlockedSandbox } from '../seed/sandbox.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The name a faction carries until its player picks one.
 *
 * Truncated to `FACTION_NAME_MAX` here rather than left to fail validation on the way into the
 * database: usernames can be longer than a faction name may be, and a registration that succeeded
 * and then could not create a base would be an unrecoverable account.
 */
function defaultFactionName(username: string): string {
  return `${username}'s Crew`.slice(0, FACTION_NAME_MAX);
}

/**
 * The first name in this city nobody else is using, starting from what the username suggests.
 *
 * Usernames are unique, so the derived name almost always is too. Almost: `FACTION_NAME_MAX`
 * truncates, so two long usernames sharing a prefix derive the same crew name, and any player may
 * simply have *renamed* themselves to the name a later registration is about to derive.
 *
 * It disambiguates rather than refusing, deliberately. The note on `defaultFactionName` above is
 * the reason: a registration that succeeds and then cannot create a base is an unrecoverable
 * account, and a collision on a name the player never chose is not something to hand them as an
 * error. They can rename to whatever they like the moment they are in.
 */
function freeFactionName(app: FastifyInstance, username: string): string {
  const taken = app.repos.bases.listSummaries();
  const isFree = (candidate: string): boolean =>
    !isReservedFactionName(candidate) &&
    !taken.some((summary) => sameFactionName(summary.name, candidate));

  const wanted = defaultFactionName(username);
  if (isFree(wanted)) return wanted;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${wanted.slice(0, FACTION_NAME_MAX - suffix.length)}${suffix}`;
    if (isFree(candidate)) return candidate;
  }
  // A thousand crews with one name is not a state this game reaches; the id keeps them apart.
  return `${wanted.slice(0, FACTION_NAME_MAX - 9)} ${randomUUID().slice(0, 8)}`;
}

export function registerOverseerRoutes(app: FastifyInstance): void {
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

      const now = new Date().toISOString();
      const overseer = overseerFromPreset(preset, randomUUID());
      const base: Base = {
        id: randomUUID(),
        ownerId: user.id,
        // §A1: a faction has a name from the first second, because the HUD shows one from the
        // first second. This is a placeholder the player is expected to replace, not a decision
        // made for them: `POST /base/faction` is on the district page.
        name: freeFactionName(app, user.username),
        districtId: STARTER_DISTRICT_ID,
        level: 1,
        isBot: false,
        resources: STARTING_RESOURCES,
        economy: startingEconomy(now),
        progression: startingProgression(),
        research: startingResearch(),
        /**
         * What a new district starts standing (§A1).
         *
         * The Nexus, because it is what authorises everything else and a district without one
         * caps every other plot at zero. The Generator, because every other structure draws on
         * the grid and a district that browns out on its first build would read as broken rather
         * than as a decision. Everything else is the player's to lay.
         */
        buildings: [
          {
            id: randomUUID(),
            kind: 'nexus',
            level: 1,
            modifications: [],
            damage: 0,
            fortification: 0,
          },
          {
            id: randomUUID(),
            kind: 'generator',
            level: 1,
            modifications: [],
            damage: 0,
            fortification: 0,
          },
        ],
        buildQueue: [],
        /**
         * §A5: enough Razors to walk into Steelbelt on day one and win.
         *
         * An empty army plus a Gauntlet they have not built yet is a first session with no move,
         * and so, it turned out, was four: NPC places are garrisoned now, Steelbelt's easiest
         * holds four, and a defender at parity wins every time. Measured: eight takes it, four
         * loses forty out of forty. The number has to be the one that makes the opening move
         * *available*, not the one that sounds modest.
         */
        army: { razors: 8 },
        trainingQueue: [],
        training: startingTraining(now),
        inventory: {},
        fittedUpgrades: [],
        unitLoadouts: {},
        fleet: {},
        commanders: [],
        createdAt: now,
      };

      app.db.transaction(() => {
        app.repos.overseers.insert({
          overseer,
          userId: user.id,
          presetId: preset.presetId,
          createdAt: now,
        });
        app.repos.users.setOverseerId(user.id, overseer.id);
        app.repos.bases.insert(base);
      })();

      // The sandbox switch also runs at boot, but a base does not exist until this moment: on a
      // fresh database the flag would silently do nothing until the next restart, which is exactly
      // the kind of "did I set it wrong?" that makes a dev switch useless.
      if (app.config.unlocked) {
        applyUnlockedSandbox(app.repos, user.username);
        app.log.warn({ baseId: base.id }, 'UNLOCKED=true: new district opened at the end-game');
      }

      const opened = app.repos.bases.findById(base.id) ?? base;
      reply.code(201);
      return { user: { ...user, overseerId: overseer.id }, overseer, base: opened };
    },
  );
}
