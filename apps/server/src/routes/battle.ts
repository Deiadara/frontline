import { randomUUID } from 'node:crypto';
import {
  BattleRequestSchema,
  addResources,
  findDistrict,
  type BattleResponse,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';

export function registerBattleRoutes(app: FastifyInstance): void {
  app.post('/battle', { preHandler: app.authenticate }, (request): BattleResponse => {
    const { targetDistrictId } = parseBody(BattleRequestSchema, request.body);

    const base = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!base) {
      throw new AppError('NO_BASE', 'You must establish a base before launching an attack');
    }

    const district = findDistrict(targetDistrictId);
    if (!district || (district.kind !== 'raid' && district.kind !== 'npc_stronghold')) {
      throw new AppError('INVALID_TARGET', 'That district cannot be attacked');
    }

    const result = app.battleEngine.simulate({
      attackerBaseId: base.id,
      targetDistrictId: district.id,
    });

    const resources = app.db.transaction((): Resources => {
      app.repos.battles.insert({
        id: randomUUID(),
        attackerBaseId: base.id,
        targetDistrictId: district.id,
        winner: result.winner,
        log: result.log,
        rewards: result.rewards,
        createdAt: new Date().toISOString(),
      });
      if (result.winner === 'attacker') {
        const updated = addResources(base.resources, result.rewards);
        app.repos.bases.updateResources(base.id, updated);
        return updated;
      }
      return base.resources;
    })();

    return { result, resources };
  });
}
