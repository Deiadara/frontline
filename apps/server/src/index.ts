import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, runMigrations } from './db/index.js';
import { seedMvpWorld } from './seed/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const applied = runMigrations(db);

  const app = await buildApp({ config, db });
  if (applied.length > 0) {
    app.log.info({ applied }, 'applied database migrations');
  }

  // Deliberately outside buildApp: tests need to build an unseeded app.
  const seeded = await seedMvpWorld({ db, repos: app.repos });
  app.log.info(seeded, 'seeded MVP world');

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
