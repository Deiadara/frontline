import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  FACTION_NAME_MAX,
  STARTER_DISTRICT_ID,
  STARTING_RESOURCES,
  findOverseerPreset,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Base,
  type CreateOverseerResponse,
  type Overseer,
  startingTraining,
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
      const overseer: Overseer = {
        id: randomUUID(),
        name: preset.name,
        archetype: preset.archetype,
        portraitId: preset.portraitId,
        bio: preset.bio,
        attributes: preset.attributes,
        traits: preset.traits,
      };
      const base: Base = {
        id: randomUUID(),
        ownerId: user.id,
        // §A1: a faction has a name from the first second, because the HUD shows one from the
        // first second. This is a placeholder the player is expected to replace, not a decision
        // made for them: `POST /base/faction` is on the district page.
        name: defaultFactionName(user.username),
        districtId: STARTER_DISTRICT_ID,
        level: 1,
        isBot: false,
        resources: STARTING_RESOURCES,
        economy: startingEconomy(now),
        progression: startingProgression(),
        research: startingResearch(),
        assignees: startingAssignees(),
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
         * §A5: enough Razors to walk into the Rustyard on day one and win.
         *
         * An empty army plus a Gauntlet they have not built yet is a first session with no move,
         * and so, it turned out, was four: NPC places are garrisoned now, the Rustyard's easiest
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
