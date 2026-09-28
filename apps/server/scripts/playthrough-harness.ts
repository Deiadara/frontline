/**
 * The playthrough's harness: one real server on port 4030, a checked HTTP client, the coverage
 * table and the list of everything that went wrong.
 *
 * The server runs **in this process** so the clock (`playthrough-clock.ts`) reaches it and so the
 * bench can set a crew up the way the server's own tests do (`app.repos`), but every action a
 * player takes goes through `fetch` against the listening port, the same door the client uses.
 *
 * Imported only after the clock is installed: see `playthrough.ts`.
 */
import { ApiErrorSchema, type SkirmishEngine } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../src/db/index.js';
import type { Repositories } from '../src/db/repos/index.js';
import { seedMvpWorld } from '../src/seed/index.js';
import { backfillPortraits } from '../src/crew/faces.js';
import { tickWorld } from '../src/live/clock.js';
import { reportTickFailuresTo, type TickFailure } from '../src/world/guard.js';
import { ruleFor } from '../src/limits/rules.js';
import { settleBase } from '../src/district/settle.js';
import { settleTraining } from '../src/units/training.js';
import { settleTrainingFor } from '../src/crew/training.js';
import { resolveDueMissions } from '../src/missions/resolve.js';
import { sweepExpiredOffers } from '../src/market/board.js';
import { advanceClock, nowMs, setClock } from './playthrough-clock.js';
import { RESPONSE_SCHEMAS, STREAM } from './playthrough-schemas.js';

export const PORT = 4030;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'playthrough-secret';

/** A world tick every five virtual minutes while the clock is wound forward. */
const TICK_STEP_MS = 5 * 60_000;

export interface Player {
  /** Short label for the report: A, B, C... */
  label: string;
  username: string;
  password: string;
  token: string;
  userId: string;
  baseId: string;
  /** The address this player's requests come from (`X-Forwarded-For`, `TRUST_PROXY=1`). */
  ip: string;
}

export type Method = 'GET' | 'POST' | 'PATCH';

export interface CallOptions {
  as: Player | null;
  method: Method;
  /** The route pattern as the server registered it, e.g. `/api/base/:id`. */
  route: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** A JSON body. Omitted means no body at all. */
  body?: unknown;
  /** A raw body, sent as `application/json` verbatim (malformed JSON on purpose). */
  rawBody?: string;
  /** The status this call must answer with, or `any` for a race where either answer is fair. */
  expect: number | 'any';
  /** For a refusal: the error code it must carry. */
  code?: string;
  /** A token other than the player's current one (an old or forged one). */
  token?: string;
}

export interface Reply<T> {
  status: number;
  body: T;
  headers: Headers;
  passed: boolean;
}

export interface Failure {
  step: string;
  request: string;
  response: string;
  why: string;
}

interface RouteTally {
  calls: number;
  failed: number;
}

interface Bucket {
  remaining: number;
  resetAt: number;
}

/** Tables a refused request may add rows to: they are filled lazily by reads. */
const LAZY_TABLES = new Set(['location_control', 'overseer_holds', 'garrison_regrowth']);
/** Tables a refusal check does not look at: bookkeeping that is not game state. */
const IGNORED_TABLES = new Set(['schema_migrations', 'sqlite_sequence', 'game_events']);

type Snapshot = Map<string, Map<string, string>>;

export interface Server {
  app: FastifyInstance;
  db: AppDatabase;
  repos: Repositories;
  engine: SkirmishEngine;
  /** Everything the server logged at error level: a 500's cause lands here. */
  errors: string[];
  close: () => Promise<void>;
}

/**
 * Boots the real app on a file, the way `src/index.ts` does: migrate, build, seed, listen. The
 * world clock's timer is not started; the harness ticks the world itself whenever it winds the
 * clock, which is what the timer would have done every second in between.
 */
export async function startServer(options: {
  databasePath: string;
  admin: boolean;
  seed: boolean;
}): Promise<Server> {
  const config = loadConfig({
    DATABASE_PATH: options.databasePath,
    JWT_SECRET,
    ADMIN: options.admin ? 'true' : 'false',
    TRUST_PROXY: '1',
    BACKUPS: 'false',
    NODE_ENV: 'development',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const errors: string[] = [];
  /*
   * With `logger: false` Fastify's request logger is one shared no-op object whose `child()`
   * returns itself, so replacing its `error` catches what the error handler logs for a 500.
   */
  const log = app.log as unknown as { error: (...args: unknown[]) => void };
  log.error = (...args: unknown[]) => {
    errors.push(
      args
        .map((one) =>
          one instanceof Error ? (one.stack ?? one.message) : JSON.stringify(one, errorFields),
        )
        .join(' '),
    );
  };
  if (options.seed) {
    await seedMvpWorld({ db, repos: app.repos });
    backfillPortraits(app.repos);
  }
  await app.listen({ port: PORT, host: '127.0.0.1' });
  return {
    app,
    db,
    repos: app.repos,
    engine: app.skirmishEngine,
    errors,
    close: async () => {
      app.server.closeAllConnections();
      await app.close();
      db.close();
    },
  };
}

function errorFields(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return value;
}

/**
 * The playthrough's state across both server phases: coverage, failures, players, the clock.
 */
export class Harness {
  server: Server;
  readonly routes: string[];
  readonly coverage = new Map<string, RouteTally>();
  readonly failures: Failure[] = [];
  readonly tickFailures: TickFailure[] = [];
  readonly players: Player[] = [];
  private readonly buckets = new Map<string, Bucket>();
  /** The highest level announced to each account so far (a `levelUp` on any answer). */
  readonly announced = new Map<string, number>();
  private step = 'boot';
  private restoreSink: () => void;
  private serverErrorsSeen = 0;

  constructor(server: Server) {
    this.server = server;
    this.routes = routesOf(server.app);
    for (const route of this.routes) this.coverage.set(route, { calls: 0, failed: 0 });
    this.restoreSink = reportTickFailuresTo((failure) => this.tickFailures.push(failure));
  }

  get repos(): Repositories {
    return this.server.repos;
  }

  get db(): AppDatabase {
    return this.server.db;
  }

  /** Swaps in a new server (the admin phase) on the same database file. */
  swapServer(server: Server): void {
    this.server = server;
    this.serverErrorsSeen = 0;
    for (const route of routesOf(server.app)) {
      if (!this.coverage.has(route)) {
        this.coverage.set(route, { calls: 0, failed: 0 });
        this.routes.push(route);
      }
    }
  }

  dispose(): void {
    this.restoreSink();
  }

  /** Names the step the next calls belong to, for the report. */
  at(step: string): void {
    this.step = step;
  }

  get currentStep(): string {
    return this.step;
  }

  now(): Date {
    return new Date(nowMs());
  }

  // ---------------------------------------------------------------------------------------------
  // Time

  /** Winds the clock forward, ticking the world every five virtual minutes on the way. */
  advance(ms: number): void {
    const target = nowMs() + ms;
    while (nowMs() < target) {
      setClock(Math.min(target, nowMs() + TICK_STEP_MS));
      this.tick();
    }
  }

  /** Winds the clock to an absolute instant, ticking on the way. */
  advanceTo(at: Date | number): void {
    const target = typeof at === 'number' ? at : at.getTime();
    if (target > nowMs()) this.advance(target - nowMs());
  }

  /** One world tick at the current instant, as the server's one-second timer would run it. */
  tick(): void {
    const failuresBefore = this.tickFailures.length;
    try {
      tickWorld(this.repos, this.server.engine, this.now(), this.server.app.config.admin);
    } catch (error) {
      this.fail('world tick', '', `the world tick threw: ${describe(error)}`);
    }
    for (const failure of this.tickFailures.slice(failuresBefore)) {
      this.fail(
        'world tick',
        '',
        `tick stage "${failure.stage}"${failure.item ? ` on ${failure.item}` : ''} failed: ${describe(failure.error)}`,
      );
    }
  }

  /**
   * Runs every lazy settle a read would run, for every player, so the database is at rest.
   *
   * A refusal check compares the database before and after the refused call, and a refused call
   * still settles on its way in. Settling first is what makes any difference the refusal's own.
   */
  settleAll(): void {
    const now = this.now();
    this.tick();
    sweepExpiredOffers(this.repos, now);
    for (const player of this.players) {
      const base = this.repos.bases.findById(player.baseId);
      if (!base) continue;
      this.repos.tx(() => resolveDueMissions(this.repos, base, now));
      const settled = settleBase(this.repos, this.repos.bases.findById(base.id) ?? base, now).base;
      const trained = settleTraining(this.repos, settled, now).base;
      this.db.transaction(() => settleTrainingFor(this.repos, trained, now.toISOString()))();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Requests

  /** One request, checked: status, error code, and the body against the route's shared schema. */
  async call<T = unknown>(options: CallOptions): Promise<Reply<T>> {
    this.makeHeadroom(options, 1);
    const url = urlFor(options);
    const key = `${options.method} ${options.route}`;
    const tally = this.coverage.get(key);
    const headers: Record<string, string> = {
      'x-forwarded-for': options.as?.ip ?? '10.99.0.1',
    };
    const token = options.token ?? options.as?.token;
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (options.rawBody !== undefined) payload = options.rawBody;
    else if (options.body !== undefined) payload = JSON.stringify(options.body);
    if (payload !== undefined) headers['content-type'] = 'application/json';

    const described = `${options.method} ${url} as ${options.as?.label ?? 'anonymous'}${
      payload === undefined ? '' : ` body ${truncate(payload, 400)}`
    }`;
    let status = 0;
    let text = '';
    let responseHeaders = new Headers();
    try {
      const init: RequestInit = { method: options.method, headers };
      if (payload !== undefined) init.body = payload;
      const res = await fetch(`${BASE_URL}${url}`, init).catch(async (error: unknown) => {
        // A pooled keep-alive socket to a server that has since been swapped out: try once more.
        if (error instanceof TypeError) return fetch(`${BASE_URL}${url}`, init);
        throw error;
      });
      status = res.status;
      responseHeaders = res.headers;
      text = await res.text();
    } catch (error) {
      this.fail(this.step, described, `the request did not complete: ${describe(error)}`);
      if (tally) {
        tally.calls += 1;
        tally.failed += 1;
      }
      return { status, body: undefined as T, headers: responseHeaders, passed: false };
    }
    this.noteBucket(options, responseHeaders);
    this.adoptRenewedToken(options, responseHeaders);

    let body: unknown = undefined;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = text;
    }
    this.noteLevelUp(options, body, described);
    const why = this.judge(options, key, status, body);
    const passed = why === null;
    if (!tally) {
      this.fail(this.step, described, `route ${key} is not one the server registered`);
    } else {
      tally.calls += 1;
      if (!passed) tally.failed += 1;
    }
    if (!passed) {
      this.fail(this.step, described, why, `${status} ${truncate(text, 700)}`);
    }
    return { status, body: body as T, headers: responseHeaders, passed };
  }

  /** A call that must succeed with 200 (or `expect`), returning its body. */
  async ok<T = unknown>(options: Omit<CallOptions, 'expect'> & { expect?: number }): Promise<T> {
    const reply = await this.call<T>({ ...options, expect: options.expect ?? 200 });
    return reply.body;
  }

  /**
   * A request that must be refused, and must leave the world exactly as it found it.
   *
   * Settles everything first so the only writes left are the ones the refusal makes, snapshots the
   * database, sends the request, and diffs. A lazily created row (a location read for the first
   * time) is allowed; any other insert, update or delete is a failure.
   */
  async refuse(options: CallOptions & { code: string }): Promise<Reply<unknown>> {
    return this.unchanged(options);
  }

  /**
   * A request that must leave the world exactly as it found it, whatever it answers: a refusal,
   * or an idempotent write naming something that is not the caller's to change.
   */
  async unchanged(options: CallOptions): Promise<Reply<unknown>> {
    this.makeHeadroom(options, 2);
    this.settleAll();
    const before = this.snapshot();
    const reply = await this.call(options);
    const after = this.snapshot();
    const changes = diffSnapshots(before, after);
    if (changes.length > 0) {
      this.fail(
        this.step,
        `${options.method} ${urlFor(options)} as ${options.as?.label ?? 'anonymous'} body ${truncate(
          JSON.stringify(options.body ?? options.rawBody ?? null),
          300,
        )}`,
        `a request that must change nothing changed the world: ${changes.slice(0, 6).join('; ')}${
          changes.length > 6 ? ` (and ${changes.length - 6} more)` : ''
        }`,
        `${reply.status} ${truncate(JSON.stringify(reply.body), 300)}`,
      );
    }
    return reply;
  }

  /** The standard malformed-body probes for a write route: no body, wrong types, garbage JSON. */
  async refuseMalformed(
    player: Player,
    route: string,
    wrongTypes: unknown,
    method: Method = 'POST',
  ): Promise<void> {
    await this.refuse({
      as: player,
      method,
      route,
      rawBody: '{"broken":',
      expect: 400,
      code: 'VALIDATION_ERROR',
    });
    await this.refuse({
      as: player,
      method,
      route,
      body: wrongTypes,
      expect: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  /** Records a failed assertion that is not about a single response. */
  check(condition: boolean, why: string, context = ''): boolean {
    if (!condition) this.fail(this.step, context, why);
    return condition;
  }

  fail(step: string, request: string, why: string, response = ''): void {
    this.failures.push({ step, request, response, why });
  }

  /** Any 500 the server logged since the last look, attached to the current step. */
  collectServerErrors(): void {
    const errors = this.server.errors.slice(this.serverErrorsSeen);
    this.serverErrorsSeen = this.server.errors.length;
    for (const error of errors)
      this.fail(this.step, '', `the server logged an error: ${truncate(error, 1500)}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private judge(options: CallOptions, key: string, status: number, body: unknown): string | null {
    if (options.expect !== 'any' && status !== options.expect) {
      return `expected ${options.expect}${options.code ? ` ${options.code}` : ''}, got ${status}`;
    }
    if (status >= 500) return `the server answered ${status}`;
    if (status >= 400) {
      const parsed = ApiErrorSchema.safeParse(body);
      if (!parsed.success) return `the refusal is not the {error:{code,message}} envelope`;
      if (options.code && parsed.data.error.code !== options.code) {
        return `expected error code ${options.code}, got ${parsed.data.error.code}`;
      }
      return null;
    }
    const shape = RESPONSE_SCHEMAS[key];
    if (shape === undefined) return `no response schema is known for ${key}`;
    if (shape === STREAM) return null;
    const parsed = shape.safeParse(body);
    if (!parsed.success) {
      return `the body does not parse with the route's shared schema: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`;
    }
    return null;
  }

  private bucketKey(options: CallOptions): { key: string; windowMs: number; quota: number } {
    const path = urlFor(options).split('?')[0] ?? options.route;
    const { rule, scope } = ruleFor(options.method, path);
    const token = options.token ?? options.as?.token;
    const who =
      token && options.as ? `user:${options.as.userId}` : `ip:${options.as?.ip ?? '10.99.0.1'}`;
    return { key: `${scope}:${who}`, windowMs: rule.windowMs, quota: rule.quota };
  }

  /** Winds past a rate-limit window when this caller is about to run out of it. */
  private makeHeadroom(options: CallOptions, needed: number): void {
    const { key } = this.bucketKey(options);
    const bucket = this.buckets.get(key);
    if (!bucket || nowMs() >= bucket.resetAt) return;
    if (bucket.remaining >= needed + 1) return;
    this.advanceTo(bucket.resetAt + 1_000);
    this.buckets.delete(key);
  }

  private noteBucket(options: CallOptions, headers: Headers): void {
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    if (!Number.isFinite(remaining)) return;
    const { key, windowMs, quota } = this.bucketKey(options);
    const known = this.buckets.get(key);
    const fresh = !known || nowMs() >= known.resetAt || remaining === quota - 1;
    this.buckets.set(key, {
      remaining,
      resetAt: fresh ? nowMs() + windowMs : known.resetAt,
    });
  }

  /**
   * A level is announced once. `levelUp` rides on whichever answer banked it (a refusal included)
   * and on the next `/me` otherwise, and a second announcement of a level already told is the
   * durable marker being drawn twice.
   */
  private noteLevelUp(options: CallOptions, body: unknown, described: string): void {
    if (!options.as || typeof body !== 'object' || body === null || !('levelUp' in body)) return;
    const levelUp = (body as { levelUp?: { level?: unknown } }).levelUp;
    if (!levelUp || typeof levelUp.level !== 'number') return;
    const last = this.announced.get(options.as.userId) ?? 1;
    if (levelUp.level <= last) {
      this.fail(
        this.step,
        described,
        `level ${levelUp.level} was announced again (level ${last} was already told)`,
      );
    }
    this.announced.set(options.as.userId, Math.max(last, levelUp.level));
  }

  /** The bench moved a crew's level: that level counts as told. */
  setAnnounced(player: Player, level: number): void {
    this.announced.set(player.userId, level);
  }

  /** The client swaps in a renewed token from `x-session-token`, and so does the playthrough. */
  private adoptRenewedToken(options: CallOptions, headers: Headers): void {
    const renewed = headers.get('x-session-token');
    if (renewed && options.as && options.token === undefined) options.as.token = renewed;
  }

  private snapshot(): Snapshot {
    const tables = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[];
    const out: Snapshot = new Map();
    for (const { name } of tables) {
      if (IGNORED_TABLES.has(name)) continue;
      const rows = new Map<string, string>();
      let read: Record<string, unknown>[];
      try {
        read = this.db.prepare(`SELECT rowid AS __rowid, * FROM "${name}"`).all() as Record<
          string,
          unknown
        >[];
      } catch {
        read = (this.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]).map(
          (row) => ({ __rowid: JSON.stringify(row), ...row }),
        );
      }
      for (const row of read) {
        const id = String(row.__rowid);
        const { __rowid: _drop, ...rest } = row;
        rows.set(id, JSON.stringify(rest));
      }
      out.set(name, rows);
    }
    return out;
  }
}

function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changes: string[] = [];
  for (const [table, rows] of after) {
    const was = before.get(table) ?? new Map<string, string>();
    for (const [id, row] of rows) {
      const old = was.get(id);
      if (old === undefined) {
        if (!LAZY_TABLES.has(table)) changes.push(`${table}: row inserted ${truncate(row, 200)}`);
      } else if (old !== row) {
        changes.push(`${table}: row ${id} changed ${changedColumns(old, row)}`);
      }
    }
    for (const id of was.keys()) {
      if (!rows.has(id)) changes.push(`${table}: row ${id} deleted`);
    }
  }
  return changes;
}

function changedColumns(before: string, after: string): string {
  const a = JSON.parse(before) as Record<string, unknown>;
  const b = JSON.parse(after) as Record<string, unknown>;
  return Object.keys(b)
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => `${key}: ${truncate(String(a[key]), 120)} -> ${truncate(String(b[key]), 120)}`)
    .join(', ');
}

/** The routes the server registered, off Fastify's printed tree (as `robustness/fuzz.test.ts`). */
export function routesOf(app: FastifyInstance): string[] {
  const lines = app.printRoutes({ commonPrefix: false }).split('\n').filter(Boolean);
  const stack: string[] = [];
  const routes: string[] = [];
  for (const line of lines) {
    const marker = line.search(/[├└]── /);
    if (marker === -1) continue;
    const depth = marker / 4;
    const rest = line.slice(marker + 4);
    const match = /^(.*?)(?: \(([^)]*)\))?$/.exec(rest);
    const segment = match?.[1] ?? rest;
    stack.length = depth;
    stack.push(segment);
    const methods = (match?.[2] ?? '')
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '' && one !== 'HEAD' && one !== 'OPTIONS');
    for (const method of methods) routes.push(`${method} ${stack.join('')}`);
  }
  return routes;
}

export function urlFor(options: Pick<CallOptions, 'route' | 'params' | 'query'>): string {
  const path = options.route.replace(/:([A-Za-z]+)/g, (_whole, name: string) => {
    const value = options.params?.[name];
    if (value === undefined) throw new Error(`no value for :${name} in ${options.route}`);
    return encodeURIComponent(value);
  });
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
  return `${path}${query}`;
}

export function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length)}...`;
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export { advanceClock };
