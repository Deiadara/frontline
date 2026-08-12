import { randomUUID } from 'node:crypto';
import {
  BattleRequestSchema,
  addResources,
  findDistrict,
  isDistrictAttackable,
  type Base,
  type BattleResponse,
  type District,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';

/** Reads the district's occupancy out of the database and applies the shared rule. */
function isAttackable(app: FastifyInstance, district: District, attacker: Base): boolean {
  return isDistrictAttackable(district, {
    isOwnBase: attacker.districtId === district.id,
    hasBotBase: app.repos.bases.findBotByDistrictId(district.id) !== undefined,
  });
}

export function registerBattleRoutes(app: FastifyInstance): void {
  app.post('/battle', { preHandler: app.authenticate }, (request): BattleResponse => {
    const { targetDistrictId } = parseBody(BattleRequestSchema, request.body);

    const base = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!base) {
      throw new AppError('NO_BASE', 'You must establish a base before launching an attack');
    }

    const district = findDistrict(targetDistrictId);
    if (!district || !isAttackable(app, district, base)) {
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
