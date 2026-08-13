import { randomUUID } from 'node:crypto';
import {
  BuildStructureRequestSchema,
  type BaseDetailResponse,
  type BuildStructureResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { buildStructure, type BuildRefusal } from '../base/build.js';
import { settleBaseEconomy } from '../economy/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { levelUpFrom } from '../progression/award.js';

/**
 * Every refusal is a 409 — none of them is a malformed request, they are all the hideout saying
 * "not yet". The client can pre-empt all three from the base it already holds, so these are the
 * honest last word on a stale tab rather than the primary way a player learns the rules.
 */
const REFUSAL_ERRORS: Record<BuildRefusal, { code: ErrorCode; message: string }> = {
  at_max_level: {
    code: 'STRUCTURE_AT_MAX_LEVEL',
    message: 'That structure is as good as it gets',
  },
  command_center_cap: {
    code: 'COMMAND_CENTER_CAP',
    message: 'Nothing outgrows the Command Center — raise that first',
  },
  cannot_afford: {
    code: 'INSUFFICIENT_RESOURCES',
    message: 'You cannot cover the materials',
  },
};

export function registerBaseRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/base/:id',
    { preHandler: app.authenticate },
    (request): BaseDetailResponse => {
      const base = app.repos.bases.findById(request.params.id);
      if (!base) {
        throw new AppError('NOT_FOUND', 'That base no longer exists');
      }
      if (base.ownerId !== request.currentUser.id) {
        throw new AppError('FORBIDDEN', 'You do not have access to this base');
      }
      return { base: settleBaseEconomy(app.repos, base, new Date()) };
    },
  );

  /**
   * Raise one structure by one level in your own hideout (GDD §A1, §D3).
   *
   * The base comes from the caller's own account rather than the path: a player has exactly one
   * hideout, so an id here would be a second way to say "mine" and a first way to try someone
   * else's. Payroll settles first, because caps that left this morning are not caps you can spend
   * on a wall this afternoon.
   */
  app.post('/base/build', { preHandler: app.authenticate }, (request): BuildStructureResponse => {
    const { kind } = parseBody(BuildStructureRequestSchema, request.body);
    const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

    const base = settleBaseEconomy(app.repos, owned, new Date());
    const result = app.db.transaction(() =>
      buildStructure(app.repos, { base, structure: kind, id: randomUUID() }),
    )();

    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, levelUp: levelUpFrom([result.award]) };
  });
}
