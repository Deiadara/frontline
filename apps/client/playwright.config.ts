import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/*
 * The e2e stack runs on its own ports and its own throwaway database so it never
 * collides with — or corrupts — a dev stack the developer already has running.
 *
 * The live spec signs in as the seeded operator and picks an overseer, which is only
 * reproducible while that operator has no overseer yet. So the API server's database is
 * deleted and recreated on every run, and `reuseExistingServer` is off for it.
 */
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const scratchDir = path.join(repoRoot, '.tmp/e2e');
const scratchDb = path.join(scratchDir, 'frontline.sqlite');

const API_PORT = 4010;
const CLIENT_PORT = 5175;
const apiUrl = `http://localhost:${API_PORT}`;
const clientUrl = `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Serialize so a single Vite cold-start warms the server for every test.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: clientUrl,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: [
    {
      // `rm -f` on the sqlite file plus its WAL/SHM sidecars: a stale WAL would resurrect
      // the previous run's rows even after the main file is gone.
      command: `rm -f "${scratchDb}" "${scratchDb}-wal" "${scratchDb}-shm" && mkdir -p "${scratchDir}" && pnpm --filter @frontline/server exec tsx src/index.ts`,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_PATH: scratchDb,
        JWT_SECRET: 'e2e-secret',
        CORS_ORIGIN: clientUrl,
      },
    },
    {
      command: 'pnpm dev',
      url: clientUrl,
      reuseExistingServer: false,
      env: {
        CLIENT_PORT: String(CLIENT_PORT),
        API_PROXY_TARGET: apiUrl,
      },
    },
  ],
});
