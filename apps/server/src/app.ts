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
import { configurePagePrizeSalt } from './missions/prize-salt.js';
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
import { SESSION_HEADER, renewIfDue, sessionIsCurrent } from './auth/session.js';
import { clockIsStale, vitals } from './world/vitals.js';
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
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    /*
     * How long a client may take to *send* a request (robustness pass, 2026-09-25). Fastify's
     * default is no limit, so a client that trickles its headers in a byte at a time holds a socket
     * for ever, and enough of them hold them all. Thirty seconds is far past any honest request.
     * It does not touch the live channel: that stream is a response held open, not a request.
     */
    requestTimeout: 30_000,
    /*
     * The largest body any route takes is a letter (2,000 characters) or a set of standing orders,
     * a few kilobytes. Fastify's default is a megabyte, which is a megabyte of JSON parsed for
     * every crafted request before a schema has a chance to refuse it (hardening pass, 2026-09-27).
     */
    bodyLimit: 64 * 1024,
    // Every id in a path is a UUID or a slug; two hundred characters is far past either.
    routerOptions: { maxParamLength: 200 },
  });

  // No socket more than this, whatever is on the other end: past it the kernel queue waits.
  app.server.maxConnections = config.maxConnections;

  /*
   * Response headers every answer carries.
   *
   * The API only ever answers JSON to its own client, so each of these closes a door that is open
   * by default and that nothing here uses: sniffing a body into something executable, being framed
   * by another site, leaking the page's address onward, and a shared cache keeping a player's
   * stockpile. HTTPS and HSTS are the proxy's job (`deploy/Caddyfile`).
   */
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('repos', createRepositories(db));
  configurePagePrizeSalt(config.jwtSecret);
  app.decorate('skirmishEngine', skirmishEngine);

  // The renewed token rides a response header, and a browser hides every header CORS does not name.
  await app.register(cors, { origin: config.corsOrigin, exposedHeaders: [SESSION_HEADER] });
  await app.register(jwt, { secret: config.jwtSecret });

  // After `jwt`, because the limiter buckets by account where there is one and needs `app.jwt` to
  // read it. Before every route, because the whole value of a limit is refusing work early.
  registerRateLimits(app);

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
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
      if (!sessionIsCurrent(payload, app.repos.users.sessionVersion(record.id))) {
        throw new AppError('UNAUTHORIZED', 'This session has ended. Sign in again');
      }
      renewIfDue(app, reply, payload);
      request.currentUser = UserSchema.parse(record); // strips passwordHash
    },
  );

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
        ...(error.waste ? { waste: error.waste } : {}),
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

  /*
   * Alive and working, not just alive (hardening pass, 2026-09-27). The database answers a read,
   * and the world clock has ticked recently; either failing is a 503 a monitor can alert on. Not
   * behind a rate limit's bucket of its own: it costs one indexed read.
   */
  app.get('/health', (_request, reply) => {
    let database = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      database = false;
    }
    const measured = vitals();
    const healthy = database && !clockIsStale();
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      database,
      clockAgeMs: measured.clockAgeMs,
      loopP99Ms: measured.loopP99Ms,
    });
  });

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
