import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import {
  UserSchema,
  defaultSkirmishEngine,
  type SkirmishEngine,
  type User,
} from '@frontline/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db/index.js';
import { createRepositories, type Repositories } from './db/repos/index.js';
import { AppError } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCrewRoutes } from './routes/crew.js';
import { registerFactionRoutes } from './routes/factions.js';
import { registerLeaderboardRoutes } from './routes/leaderboard.js';
import { registerCrewProfileRoutes } from './routes/crews.js';
import { registerFactionProfileRoutes } from './routes/faction-profile.js';
import { registerFeatRoutes } from './routes/feats.js';
import { registerSocialRoutes } from './routes/social.js';
import { registerBarRoutes } from './routes/bar.js';
import { registerBaseRoutes } from './routes/base.js';
import { registerCityRoutes } from './routes/city.js';
import { registerBattleRoutes } from './battle/routes.js';
import { registerUnitRoutes } from './routes/units.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMissionRoutes } from './routes/missions.js';
import { registerAutomationRoutes } from './routes/automations.js';
import { registerOverseerRoutes } from './routes/overseer.js';
import { registerResearchRoutes } from './routes/research.js';
import { registerTrainingRoutes } from './routes/training.js';
import { registerMarketRoutes } from './routes/market.js';
import { registerBlackMarketRoutes } from './routes/blackmarket.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerScrapyardRoutes } from './routes/scrapyard.js';
import { registerGarageRoutes } from './garage/routes.js';
import { registerLiveRoutes } from './live/routes.js';
import { registerRateLimits } from './limits/plugin.js';
import type { JwtPayload } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: AppDatabase;
    repos: Repositories;
    skirmishEngine: SkirmishEngine;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** The authenticated user, populated by the `authenticate` preHandler. */
    currentUser: User;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  db: AppDatabase;
  /** Overridable so tests can inject a deterministic engine. */
  skirmishEngine?: SkirmishEngine;
  logger?: boolean;
}

/** Builds a configured Fastify instance. Route registration happens here. */
export async function buildApp({
  config,
  db,
  skirmishEngine = defaultSkirmishEngine,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  // `trustProxy` decides what `request.ip` means, and the unauthenticated rate-limit bucket is
  // keyed on it. Off unless a deployment says which hops are real: see `config.ts`.
  const app = Fastify({ logger, trustProxy: config.trustProxy });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('repos', createRepositories(db, { admin: config.admin }));
  app.decorate('skirmishEngine', skirmishEngine);

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(jwt, { secret: config.jwtSecret });

  // After `jwt`, because the limiter buckets by account where there is one and needs `app.jwt` to
  // read it. Before every route, because the whole value of a limit is refusing work early.
  registerRateLimits(app);

  app.decorate('authenticate', async (request: FastifyRequest): Promise<void> => {
    let payload: JwtPayload;
    try {
      payload = await request.jwtVerify<JwtPayload>();
    } catch {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid authentication token');
    }
    const record = app.repos.users.findById(payload.sub);
    if (!record) {
      throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');
    }
    request.currentUser = UserSchema.parse(record); // strips passwordHash
  });

  app.setErrorHandler((error, request, reply) => {
    /** better-sqlite3 reports a held write lock as `SQLITE_BUSY` on a `SqliteError`. */
    const isBusy = (thrown: unknown): boolean =>
      thrown instanceof Error &&
      'code' in thrown &&
      typeof thrown.code === 'string' &&
      thrown.code.startsWith('SQLITE_BUSY');

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
        // Only when the refusal really banked one: presence is the signal here as everywhere else.
        ...(error.levelUp ? { levelUp: error.levelUp } : {}),
      });
    }
    // Fastify's own client errors (empty/malformed JSON body, unsupported media type, …) carry a
    // 4xx statusCode. Surface them as a clean VALIDATION_ERROR instead of masking them as a 500.
    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply
        .status(statusCode)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } });
    }
    /*
     * A lock, not a fault.
     *
     * SQLite takes one writer at a time. When something else holds the write lock, a transaction
     * that has already read is refused straight away rather than waiting, because waiting for an
     * upgrade is how two connections deadlock. Nothing is half-written when that happens, so the
     * honest answer is "busy, press again" rather than "something broke", which is what a 500
     * tells a player and what an uptime check counts.
     */
    if (isBusy(error)) {
      request.log.warn({ err: error }, 'write refused: the database was busy');
      return reply.status(503).send({
        error: { code: 'DATABASE_BUSY', message: 'The world is busy. Try that again.' },
      });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(
    (api, _opts, done) => {
      registerAuthRoutes(api);
      registerMeRoutes(api);
      registerOverseerRoutes(api);
      registerCityRoutes(api);
      registerBattleRoutes(api);
      registerBaseRoutes(api);
      registerUnitRoutes(api);
      registerMissionRoutes(api);
      registerAutomationRoutes(api);
      registerBarRoutes(api);
      registerResearchRoutes(api);
      registerCrewRoutes(api);
      registerFactionRoutes(api);
      registerSocialRoutes(api);
      registerLiveRoutes(api);
      registerLeaderboardRoutes(api);
      registerCrewProfileRoutes(api);
      registerFactionProfileRoutes(api);
      registerFeatRoutes(api);
      registerTrainingRoutes(api);
      registerMarketRoutes(api);
      registerBlackMarketRoutes(api);
      registerScrapyardRoutes(api);
      registerGarageRoutes(api);
      registerSettingsRoutes(api);
      registerAdminRoutes(api);
      done();
    },
    { prefix: '/api' },
  );

  return app;
}
