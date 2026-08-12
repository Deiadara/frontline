import { randomUUID } from 'node:crypto';
import {
  CreateOverseerRequestSchema,
  STARTER_DISTRICT_ID,
  STARTING_RESOURCES,
  findOverseerPreset,
  type Base,
  type CreateOverseerResponse,
  type Overseer,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';

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
        name: `${user.username}'s Foothold`,
        districtId: STARTER_DISTRICT_ID,
        level: 1,
        isBot: false,
        resources: STARTING_RESOURCES,
        buildings: [
          { id: randomUUID(), kind: 'command_center', level: 1 },
          { id: randomUUID(), kind: 'reactor', level: 1 },
        ],
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
