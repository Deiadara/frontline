import { buildApp } from './app.js';
import { assertDeployable, loadConfig } from './config.js';
import { BACKUP_INTERVAL_MS, startBackupSchedule, takeBackup } from './db/backup.js';
import { CrashBudget } from './crash-budget.js';
import { resetLoopWindow, vitals, watchEventLoop } from './world/vitals.js';
import { openDatabase, runMigrations } from './db/index.js';
import { describeDrift, schemaDrift } from './db/schema-drift.js';
import { WORLD_TICK_MS, startWorldClock } from './live/clock.js';
import { backfillPortraits } from './crew/faces.js';
import { releaseClosedCityGround } from './city/closed-ground.js';
import { trimLegendaries } from './units/legendaries.js';
import { devOperatorStillOpen, seedMvpWorld } from './seed/index.js';
import { MVP_PLAYER } from './seed/constants.js';
import { applyUnlockedSandbox } from './seed/sandbox.js';
import { watchForOrphaning } from './orphan.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // Before anything is opened or served: a production boot with the repository's own signing key
  // is not a server with a warning on it, it is a server anybody can log into as anybody.
  assertDeployable(config);

  const db = openDatabase(config.databasePath);
  /*
   * A damaged save is refused at the door (hardening pass, 2026-09-27). Serving from one writes
   * new progress on top of the damage, and every snapshot taken afterwards carries it; stopping
   * here leaves the last good snapshot the newest one. `docs/RECOVERY.md` is the way back.
   */
  const integrity = (db.pragma('quick_check') as { quick_check: string }[])
    .map((row) => row.quick_check)
    .join('; ');
  if (integrity !== 'ok') {
    throw new Error(
      `The database failed its integrity check (${integrity}). Restore a snapshot: docs/RECOVERY.md`,
    );
  }
  const applied = runMigrations(db);
  /*
   * The columns this save has against the ones a fresh migration run builds (bug pass, 2026-09-29).
   * A difference is a migration edited after the save applied it. Development warns and serves,
   * so a stale dev save stays playable while it is fixed by hand. Production refuses, for the
   * integrity check's reason: every write served on a schema no test has seen lands on the gap,
   * the first route that touches the missing column answers 500 to players, and every snapshot
   * taken afterwards carries the gap forward.
   */
  const drift = schemaDrift(db);
  if (drift.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(describeDrift(drift));
  }

  const app = await buildApp({ config, db });
  if (drift.length > 0) app.log.warn({ drift }, describeDrift(drift));

  /*
   * The last line: nothing that escapes a callback takes the server down (robustness pass,
   * 2026-09-25).
   *
   * Since Node 15 an unhandled promise rejection ends the process, and so does an exception thrown
   * from a timer or a socket callback, so one forgotten `void` anywhere was an outage for every
   * player at once. Node's advice is to exit on an uncaught exception because state may be half
   * written, and here it is not: every write in this server is a synchronous SQLite transaction
   * that commits whole or rolls back before control returns, so an error escaping afterwards has
   * nothing half done behind it. It is logged loudly and the server keeps serving. A failure while
   * starting is still fatal (`main().catch` below), because a server that cannot start cannot serve.
   */
  // ...within a budget (`crash-budget.ts`): a process out of descriptors or memory, or throwing
  // more than ten times a minute, is broken in a way logging does not fix, and goes, so that the
  // supervisor starts a fresh one (`deploy/frontline.service`).
  const budget = new CrashBudget();
  const escaped = (error: unknown, what: string): void => {
    if (budget.spend(error)) {
      app.log.fatal({ err: error }, `${what}: past the crash budget, exiting for a clean restart`);
      process.exitCode = 1;
      process.kill(process.pid, 'SIGTERM');
      return;
    }
    app.log.error({ err: error }, `${what}: logged, the server keeps running`);
  };
  process.on('unhandledRejection', (reason) => escaped(reason, 'unhandled promise rejection'));
  process.on('uncaughtException', (error) => escaped(error, 'uncaught exception'));

  // The event loop, measured: a stall is every player waiting at once. Warned once a minute when
  // the slowest one percent of waits passed a fifth of a second, and read by `/health`.
  watchEventLoop();
  const loopWatch = setInterval(() => {
    const { loopP99Ms } = vitals();
    if (loopP99Ms !== null && loopP99Ms > 200) {
      app.log.warn({ loopP99Ms }, 'event loop is slow: requests are queueing');
    }
    resetLoopWindow();
  }, 60_000);
  loopWatch.unref();
  if (applied.length > 0) {
    app.log.info({ applied }, 'applied database migrations');
  }

  // Deliberately outside buildApp: tests need to build an unseeded app.
  const production = process.env.NODE_ENV === 'production';
  const seeded = await seedMvpWorld({ db, repos: app.repos, production });
  if (production && (await devOperatorStillOpen(app.repos))) {
    throw new Error(
      `The dev account "${MVP_PLAYER.username}" still has the password committed to this ` +
        'repository, so anybody can sign in to it. Change its password or delete it before ' +
        'serving players.',
    );
  }
  app.log.info(seeded, 'seeded MVP world');

  // Every officer in the city wears a face of their own (maintainer, 2026-09-11). After the seed, so
  // the bots' officers are placed too; idempotent, so a second boot assigns nothing.
  const faced = backfillPortraits(app.repos);
  if (faced > 0)
    app.log.info({ faced }, 'gave a face to officers written before faces were stored');

  // §A5: one of each legendary, on rosters written before the console was capped. Silent on a
  // world that was never raised, which is every real one.
  const trimmed = trimLegendaries(app.repos);
  if (trimmed.removed > 0)
    app.log.warn(trimmed, 'took legendaries over the cap of one off the rosters holding them');

  // Ground claimed in a city that is not open, before its doors were shut, goes back to the atlas
  // (maintainer, 2026-09-29). Idempotent: a save with no such rows changes nothing.
  const released = releaseClosedCityGround(app.repos, new Date());
  if (released.locations > 0)
    app.log.warn(released, 'handed ground in a closed city back to its authored holder');

  // Announced loudly, because a server that has quietly maxed an account is a server whose
  // numbers mean nothing, and the one thing worse than not having a sandbox switch is not
  // knowing you are standing in it.
  if (config.unlocked) {
    const sandbox = applyUnlockedSandbox(app.repos, MVP_PLAYER.username);
    app.log.warn(sandbox, 'UNLOCKED=true: dev account raised to the end-game state');
  }

  if (config.admin) {
    app.log.warn(
      { adminScreen: '/game/admin' },
      'ADMIN mode is on: every clock is 5s and nothing is charged. Set ADMIN=false for real costs.',
    );
  }

  // Started here rather than in `buildApp` for the same reason the seed is: a test builds an app
  // per case, and a timer writing whole database files to disk every ten minutes is not something a
  // test suite should have to remember to turn off.
  let stopBackups: () => Promise<void> = () => Promise.resolve();
  if (config.backupsEnabled) {
    stopBackups = startBackupSchedule({
      db,
      directory: config.backupDir,
      mirror: config.backupMirrorDir,
      onBackup: (file) => {
        app.repos.history.record({
          actorId: null,
          baseId: null,
          kind: 'backup.taken',
          payload: { file },
        });
        app.log.info({ file }, 'database snapshot taken');
      },
      onError: (error) => app.log.error({ error }, 'database snapshot failed'),
    });
    app.log.info(
      { directory: config.backupDir, mirror: config.backupMirrorDir, everyMs: BACKUP_INTERVAL_MS },
      'backup schedule started: see docs/RECOVERY.md to restore one',
    );
  }

  // Started here rather than in `buildApp` for the same reason as the backup schedule above: a
  // test builds an app per case, and a timer that resolves battles underneath a case asserting on
  // an unresolved one would be a fine way to make the suite flaky.
  const stopClock = startWorldClock({
    repos: app.repos,
    engine: app.skirmishEngine,
    admin: config.admin,
    onSettled: (resolved, at) => app.log.info({ resolved, at }, 'world clock settled fights'),
    onError: (error) => app.log.error({ error }, 'world clock tick failed'),
    onFailure: ({ stage, item, error }) =>
      app.log.error({ stage, item, error }, 'world clock: one stage or row failed and was skipped'),
  });
  app.log.info({ everyMs: WORLD_TICK_MS }, 'world clock started: fights land on their mark');

  /*
   * Ctrl+C stops the server, promptly and cleanly.
   *
   * There was no handler, and under `tsx` that is not the same as the default: tsx's preflight
   * puts its own listener on SIGINT and SIGTERM in the child so it can relay them, which means
   * the process no longer dies on the signal by itself. It kept listening until tsx gave up and
   * force-killed it ("Previous process hasn't exited yet"), several seconds after the key was
   * pressed, with the listening socket held the whole time and the database closed by nobody.
   * Once, so a second Ctrl+C while the close is in flight falls through to the default and ends
   * the process outright.
   */
  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, 'shutting down');
    stopClock();
    // Resolves once a snapshot already being written has landed: the last one below waits for it.
    const backupsStopped = stopBackups();
    // The client polls on keep-alive sockets, and a close that waits for those to go idle waits
    // for the browser. Dropped first, so the close is the close of a server with nobody on it.
    app.server.closeAllConnections();
    const closed = app.close().then(
      () => 0,
      (error: unknown) => {
        console.error(error);
        return 1;
      },
    );
    // ...and two seconds is all a close gets. A shutdown that hangs on a plugin is still a
    // shutdown: the process ends, and the database is closed on the way out either way.
    const deadline = new Promise<number>((resolve) => {
      setTimeout(resolve, 2_000, 0).unref();
    });
    void Promise.race([closed, deadline]).then(async (code) => {
      // One last snapshot on the way out, so a clean stop loses nothing a restore would need.
      if (config.backupsEnabled) {
        try {
          await backupsStopped;
          await takeBackup(db, config.backupDir, new Date(), config.backupMirrorDir);
        } catch (error: unknown) {
          console.error(error);
        }
      }
      try {
        db.pragma('optimize');
        db.close();
      } catch (error: unknown) {
        console.error(error);
      }
      process.exit(process.exitCode ?? code);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  /*
   * ...and stop anyway if whoever started this is gone (`orphan.ts`).
   *
   * Ctrl+C on an e2e run does not reach here at all: Playwright starts its `webServer` detached,
   * in a process group of its own, so the signal goes to Playwright and killing this is left to a
   * teardown that an interrupt is exactly the path for skipping. Measured on 2026-09-20 by
   * interrupting a real run: this process outlived it on port 4010 with its parent reassigned to
   * launchd, and the next run then refused to start on a port that was "already used".
   *
   * `SIGTERM` rather than calling `shutdown` directly, so an orphaned stop takes the same route as
   * every other stop: one shutdown path, and the handler above is `once`, so a real signal
   * arriving first leaves this to do nothing.
   */
  const stopOrphanWatch = watchForOrphaning({
    onOrphaned: () => {
      app.log.warn('the process that started this server is gone: shutting down');
      process.kill(process.pid, 'SIGTERM');
    },
  });
  process.once('exit', stopOrphanWatch);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
