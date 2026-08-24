import {
  AdminKnobsRequestSchema,
  BUILDING_KINDS,
  RESOURCE_KEYS,
  buildingLevel,
  startingProgression,
  type AdminMutationResponse,
  type AdminSnapshot,
  type Base,
  type Building,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { ADMIN_ACTION_SECONDS } from '../admin/mode.js';
import { listBackups } from '../db/backup.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The bench: knobs that put the game at a chosen stage, in one click.
 *
 * The board's problem is that judging a design means seeing it at level 3, level 10 and level 20,
 * and reaching any of those honestly takes days. `UNLOCKED` answered "show me the end", which is
 * one of the three. This answers all of them: set the structures to a level, set the player level,
 * set the stockpile, set the infamy, clear the queues, look.
 *
 * **Every route here is refused outright when admin mode is off.** Not hidden, not unauthorised —
 * `NOT_FOUND`, so a production build behaves as though the bench does not exist rather than
 * advertising a door somebody could try to open. The client asks `GET /admin` first and simply does
 * not draw the screen when the answer is a 404.
 *
 * Nothing here fabricates a state the rules could not produce, for the same reason the sandbox does
 * not: a reviewer looking at a district built by a knob should be looking at the real thing. The
 * levels are levels the game reaches, the resources are inside the storage the district actually
 * has, and research is left alone because facts are *discovered* and writing them in would be
 * inventing a state the mechanic does not have.
 */

function requireAdmin(app: FastifyInstance): void {
  if (!app.config.admin) {
    throw new AppError('NOT_FOUND', 'Route GET /api/admin not found');
  }
}

function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

function snapshot(app: FastifyInstance, base: Base): AdminSnapshot {
  return {
    state: {
      enabled: app.config.admin,
      actionSeconds: ADMIN_ACTION_SECONDS,
      chargesResources: !app.config.admin,
    },
    baseId: base.id,
    playerLevel: base.level,
    infamy: base.economy.infamy,
    buildings: BUILDING_KINDS.map((kind) => ({
      kind,
      level: buildingLevel(base.buildings, kind),
    })),
    backups: listBackups(app.config.backupDir).slice(0, 12),
  };
}

/**
 * The structures a knob leaves standing.
 *
 * A level of zero is "not built", which is how the bench walks a district *backwards* — the state
 * before a structure exists is one of the stages a reviewer needs to see, and it is the one an
 * unlock-everything switch can never show. Existing ids are kept where the structure survives, so
 * modifications fitted to it are not orphaned by a level change.
 */
function buildingsAt(
  current: readonly Building[],
  level: number,
  only: string | undefined,
): Building[] {
  return BUILDING_KINDS.flatMap((kind) => {
    const standing = current.find((building) => building.kind === kind);
    const target = only === undefined || only === kind ? level : (standing?.level ?? 0);
    if (target <= 0) return [];
    return [
      {
        id: standing?.id ?? `admin-${kind}`,
        kind,
        level: target,
        modifications: standing?.modifications ?? [],
        // Carried through rather than reset: a knob that moves a level should not also repair the
        // siege damage or dismiss the garrison a reviewer is standing there to look at.
        damage: standing?.damage ?? 0,
        garrisons: standing?.garrisons ?? 0,
      },
    ];
  });
}

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/admin', { preHandler: app.authenticate }, (request): AdminSnapshot => {
    requireAdmin(app);
    return snapshot(app, ownBase(app, request.currentUser.id));
  });

  app.post('/admin/knobs', { preHandler: app.authenticate }, (request): AdminMutationResponse => {
    requireAdmin(app);
    const body = parseBody(AdminKnobsRequestSchema, request.body);

    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      let next: Base = base;

      if (body.buildingLevel !== undefined) {
        const buildings = buildingsAt(base.buildings, body.buildingLevel, body.structure);
        next = { ...next, buildings };
        app.repos.bases.updateDistrict(next.id, buildings, body.clearQueues ? [] : next.buildQueue);
        if (body.clearQueues) next = { ...next, buildQueue: [] };
      } else if (body.clearQueues) {
        app.repos.bases.updateDistrict(next.id, next.buildings, []);
        next = { ...next, buildQueue: [] };
      }

      if (body.clearQueues) {
        app.repos.bases.updateArmy(next.id, next.army, []);
        app.repos.bases.updateResearch(next.id, { ...next.research, active: null });
        next = {
          ...next,
          trainingQueue: [],
          research: { ...next.research, active: null },
        };
      }

      if (body.resources !== undefined) {
        // Absent keys keep what is there. A knob that sets food should not silently zero the oil.
        const resources: Resources = RESOURCE_KEYS.reduce(
          (into, key) => ({ ...into, [key]: body.resources?.[key] ?? into[key] }),
          next.resources,
        );
        next = { ...next, resources };
        app.repos.bases.updateResources(next.id, resources);
      }

      if (body.playerLevel !== undefined) {
        // The XP bank is reset with the level rather than carried: banked progress belongs to the
        // level it was earned under, and keeping it would leave a crew sitting above its own
        // threshold and level up again on the next read.
        const progression = startingProgression();
        next = { ...next, level: body.playerLevel, progression };
        app.repos.bases.updateProgression(next.id, body.playerLevel, progression);
      }

      if (body.infamy !== undefined) {
        const economy = { ...next.economy, infamy: body.infamy };
        next = { ...next, economy };
        app.repos.bases.updateEconomy(next.id, economy);
      }

      app.repos.history.record({
        actorId: request.currentUser.id,
        baseId: next.id,
        kind: 'admin.knobs',
        payload: body,
      });
      return { admin: snapshot(app, next) };
    })();
  });
}
