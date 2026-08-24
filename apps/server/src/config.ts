import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./frontline.sqlite'),
  JWT_SECRET: z.string().min(1).default('dev-secret-change-me'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /**
   * Sandbox switch — raises the seeded dev account to the end-game state on every boot.
   *
   * Anything but a literal `true` leaves it off, including `1` and `yes`. A flag that turns a
   * feature on for several spellings is a flag that turns on by accident.
   */
  UNLOCKED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  /**
   * Admin / testing mode — every clock flattened to five seconds, nothing charged.
   *
   * **Default on**, which is the opposite spelling of `UNLOCKED` above and deliberately so. This is
   * the build the board runs, and a testing mode you have to remember to switch on is a testing
   * mode nobody is in. Turning it off is the explicit act: `ADMIN=false`, and nothing else counts.
   *
   * What it does not do is hide itself. The HUD carries a badge whenever it is on, and every price
   * on every screen is still the real one — see `admin/mode.ts`.
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
 * A test that wants either mode says so — `admin.test.ts` builds both — and this only decides what
 * silence means.
 */
export function adminDefault(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'test';
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
    backupDir: parsed.BACKUP_DIR,
    backupsEnabled: parsed.BACKUPS,
  };
}
