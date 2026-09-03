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
  if (config.backupsEnabled) {
    startBackupSchedule({
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
  startWorldClock({
    repos: app.repos,
    engine: app.skirmishEngine,
    onSettled: (resolved, at) => app.log.info({ resolved, at }, 'world clock settled fights'),
    onError: (error) => app.log.error({ error }, 'world clock tick failed'),
  });
  app.log.info({ everyMs: WORLD_TICK_MS }, 'world clock started: fights land on their mark');

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
