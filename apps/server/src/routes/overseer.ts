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
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
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
        // §A1 — a faction has a name from the first second, because the HUD shows one from the
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
          { id: randomUUID(), kind: 'nexus', level: 1, modifications: [] },
          { id: randomUUID(), kind: 'generator', level: 1, modifications: [] },
        ],
        buildQueue: [],
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

      reply.code(201);
      return { user: { ...user, overseerId: overseer.id }, overseer, base };
    },
  );
}
