import { buildApp } from './app.js';
import { assertDeployable, loadConfig } from './config.js';
import { BACKUP_INTERVAL_MS, startBackupSchedule } from './db/backup.js';
import { openDatabase, runMigrations } from './db/index.js';
import { WORLD_TICK_MS, startWorldClock } from './live/clock.js';
import { seedMvpWorld } from './seed/index.js';
import { MVP_PLAYER } from './seed/constants.js';
import { applyUnlockedSandbox } from './seed/sandbox.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // Before anything is opened or served: a production boot with the repository's own signing key
  // is not a server with a warning on it, it is a server anybody can log into as anybody.
  assertDeployable(config);

  const db = openDatabase(config.databasePath);
  const applied = runMigrations(db);

  const app = await buildApp({ config, db });
  if (applied.length > 0) {
    app.log.info({ applied }, 'applied database migrations');
  }

  // Deliberately outside buildApp: tests need to build an unseeded app.
  const seeded = await seedMvpWorld({ db, repos: app.repos });
  app.log.info(seeded, 'seeded MVP world');

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
  let stopBackups: () => void = () => undefined;
  if (config.backupsEnabled) {
    stopBackups = startBackupSchedule({
      db,
      directory: config.backupDir,
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
      { directory: config.backupDir, everyMs: BACKUP_INTERVAL_MS },
      'backup schedule started: see docs/RECOVERY.md to restore one',
    );
  }

  // Started here rather than in `buildApp` for the same reason as the backup schedule above: a
  // test builds an app per case, and a timer that resolves battles underneath a case asserting on
  // an unresolved one would be a fine way to make the suite flaky.
  const stopClock = startWorldClock({
    repos: app.repos,
    engine: app.skirmishEngine,
    onSettled: (resolved, at) => app.log.info({ resolved, at }, 'world clock settled fights'),
    onError: (error) => app.log.error({ error }, 'world clock tick failed'),
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
    stopBackups();
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
    void Promise.race([closed, deadline]).then((code) => {
      try {
        db.close();
      } catch (error: unknown) {
        console.error(error);
      }
      process.exit(code);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
