import 'dotenv/config';
import { z } from 'zod';

/**
 * The signing key a developer gets for free, and the one a production boot refuses.
 *
 * It is in the repository, so it is not a secret: anybody who can read this file can mint a token
 * for any account on any server still using it. That is exactly right for `pnpm dev` and a hole
 * with no bottom anywhere else, and the difference between the two is one forgotten environment
 * variable. {@link assertDeployable} is what makes forgetting it loud instead of silent.
 */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./frontline.sqlite'),
  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /**
   * Sandbox switch: raises the seeded dev account to the end-game state on every boot.
   *
   * Anything but a literal `true` leaves it off, including `1` and `yes`. A flag that turns a
   * feature on for several spellings is a flag that turns on by accident.
   */
  UNLOCKED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  /**
   * Admin / testing mode: every clock flattened to five seconds, nothing charged.
   *
   * **Default on**, which is the opposite spelling of `UNLOCKED` above and deliberately so. This is
   * the build the board runs, and a testing mode you have to remember to switch on is a testing
   * mode nobody is in. Turning it off is the explicit act: `ADMIN=false`, and nothing else counts.
   *
   * What it does not do is hide itself. The HUD carries a badge whenever it is on, and every price
   * on every screen is still the real one: see `admin/mode.ts`.
   */
  ADMIN: z.enum(['true', 'false']).optional(),
  /** Vitest sets this. See {@link adminDefault} for why the config cares. */
  NODE_ENV: z.string().optional(),
  /**
   * Where the ten-minute snapshots go. Relative to the working directory, like `DATABASE_PATH`.
   *
   * A directory beside the database rather than inside it: `VACUUM INTO` writes whole database
   * files, and a backup that lands where the migration runner or a glob might find it is a backup
   * waiting to be mistaken for the live save.
   */
  /**
   * Which forwarding hops to believe when working out where a request came from.
   *
   * Fastify answers `request.ip` with the socket's peer unless it is told otherwise, and the
   * unauthenticated rate-limit bucket is keyed on that address (`limits/plugin.ts`). Behind any
   * reverse proxy that peer is the proxy, so the whole game shares one sign-in bucket and the
   * twenty-first login of the quarter hour is refused for everybody.
   *
   * Unset means unset: a process exposed directly to the internet must not believe a header any
   * caller can write. A hop count (`TRUST_PROXY=1`) or an address list
   * (`TRUST_PROXY=10.0.0.0/8,127.0.0.1`) says exactly how much of `X-Forwarded-For` is real.
   * `true` believes the whole chain, which hands an unauthenticated caller a fresh bucket per
   * request, so {@link assertDeployable} refuses it in production.
   */
  TRUST_PROXY: z.string().default(''),
  BACKUP_DIR: z.string().default('./backups'),
  /**
   * Off in tests and in any run that should not touch the disk on a timer.
   *
   * On everywhere else, because a backup that has to be enabled is a backup that exists in the
   * documentation and not on the disk.
   */
  BACKUPS: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
});

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  jwtSecret: string;
  corsOrigin: string;
  /** See `UNLOCKED` above, and `seed/sandbox.ts` for what it actually does. */
  unlocked: boolean;
  /** See `ADMIN` above, and `admin/mode.ts` for what it actually does. */
  admin: boolean;
  backupDir: string;
  backupsEnabled: boolean;
  /** See `TRUST_PROXY` above. Passed to Fastify verbatim. */
  trustProxy: boolean | number | string;
}

/**
 * `TRUST_PROXY` in the shape Fastify takes.
 *
 * A bare number is a hop count; anything else is handed over as written, which is how Fastify
 * spells an address or subnet list. The two boolean words are recognised because an operator will
 * type them, and `true` is caught at boot rather than silently read as a one-entry address list
 * that never matches anything.
 */
export function trustProxyFrom(raw: string): boolean | number | string {
  if (raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Whether admin mode is on when nobody has said.
 *
 * **On** for a person running the game, which is what the board asked for: the testing build is the
 * one you get by starting the thing, and a mode you have to remember to switch on is a mode nobody
 * is in.
 *
 * **Off under the test runner**, and that exception is not a convenience. Admin mode waives every
 * price and flattens every clock, so a suite running inside it is a suite where no assertion about
 * cost or duration can fail. Defaulting it on broke exactly two of the ~390 server tests, which is
 * the alarming number: the other 388 quietly stopped exercising the economy and would have gone on
 * passing through any pricing bug anybody introduced.
 *
 * A test that wants either mode says so, `admin.test.ts` builds both, and this only decides what
 * silence means.
 */
export function adminDefault(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'test';
}

/**
 * Refuses a configuration that would be unsafe to serve real players.
 *
 * Called at boot rather than folded into the schema, because the schema is also what every test
 * builds a config from: making the default itself illegal would mean threading a secret through a
 * few hundred fixtures to protect a case none of them are in. What matters is the deployed process,
 * and a deployed process says so.
 *
 * Throwing rather than warning. A warning about an authentication key is a line in a log nobody
 * reads on the day it matters, and the failure it precedes is silent: tokens keep working, players
 * keep playing, and the first sign of trouble is somebody else's account.
 */
export function assertDeployable(config: AppConfig, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv !== 'production') return;
  if (config.jwtSecret === DEV_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is still the development default, which is committed to this repository: ' +
        'anyone could sign a token for any account. Set JWT_SECRET to a real secret.',
    );
  }
  if (config.trustProxy === true) {
    throw new Error(
      'TRUST_PROXY=true believes the whole X-Forwarded-For chain, so any caller can write ' +
        'themselves a fresh rate-limit bucket per request. Set it to a hop count (1) or to the ' +
        'addresses of the proxies actually in front of this process.',
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databasePath: parsed.DATABASE_PATH,
    jwtSecret: parsed.JWT_SECRET,
    corsOrigin: parsed.CORS_ORIGIN,
    unlocked: parsed.UNLOCKED,
    admin:
      parsed.ADMIN === undefined
        ? // `process.env` as well as the passed env, and deliberately: every test builds its config
          // from a literal `{ DATABASE_PATH, JWT_SECRET }`, so the runner's own marker is never in
          // the object handed to this function. Reading only `parsed` left the whole suite running
          // in admin mode with nothing charged.
          adminDefault(parsed.NODE_ENV ?? process.env.NODE_ENV)
        : parsed.ADMIN === 'true',
    trustProxy: trustProxyFrom(parsed.TRUST_PROXY),
    backupDir: parsed.BACKUP_DIR,
    backupsEnabled: parsed.BACKUPS,
  };
}
