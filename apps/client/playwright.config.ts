import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { E2E_ISOLATED } from './vite.config';

/*
 * The e2e stack runs on its own ports and its own throwaway database so it never
 * collides with, or corrupts, a dev stack the developer already has running.
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

/**
 * A second real server, in admin mode, for the specs that need every clock at five seconds.
 *
 * The first server is pinned to `ADMIN=false` and `live.spec.ts` depends on that: it asserts a
 * build actually charges oil. The Right Hand's standing orders cannot be watched on that server,
 * because a party would be out for real minutes and rest for real minutes between. So the live
 * automations spec talks to this one, on its own port and its own database, by rewriting the
 * browser's `/api` traffic to it (`live-automations.spec.ts`). Same lifecycle and orphan guard.
 */
export const ADMIN_API_PORT = 4011;
const adminScratchDb = path.join(scratchDir, 'frontline-admin.sqlite');
export const adminApiUrl = `http://localhost:${ADMIN_API_PORT}`;

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
      //
      // `exec node --import tsx`, and not `pnpm ... exec tsx`: Playwright kills the process it
      // spawned and nothing below it. The old command was a shell over pnpm over tsx over node,
      // and a Ctrl+C on a run left the node at the bottom alive, reparented to launchd and holding
      // port 4010 until somebody found it. With the shell replaced by the server itself there is
      // nothing under the process Playwright kills.
      command: `rm -f "${scratchDb}" "${scratchDb}-wal" "${scratchDb}-shm" && mkdir -p "${scratchDir}" && exec node --import tsx src/index.ts`,
      cwd: '../server',
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_PATH: scratchDb,
        JWT_SECRET: 'e2e-secret',
        CORS_ORIGIN: clientUrl,
        // Pinned off, not merely absent. `dotenv` loads the developer's own `apps/server/.env`,
        // so a local `UNLOCKED=true` would hand every spec a level-20 account with a full roster
        // and the whole suite would quietly stop testing the game it ships: the first symptom
        // being the live flow asserting a starting stockpile it no longer has.
        // Ctrl+C on a run does not reach a detached `webServer`, and killing it is a teardown an
        // interrupt skips, so the server stops itself when Playwright is gone (`server/orphan.ts`).
        // Set here and nowhere else: a developer's backgrounded server is the same shape and must
        // not be caught by it.
        EXIT_WITH_PARENT: 'true',
        UNLOCKED: 'false',
        // Same argument, and it caught the same test. Admin mode ships *on* by default so the
        // board can walk the game without grinding, and one of the things it does is waive every
        // resource cost while still quoting the real price on screen. Left on here, `live.spec.ts`
        // would order the Quarters, be charged nothing, and assert a stockpile that never moved:
        // a green suite proving the economy works when it had simply been switched off.
        ADMIN: 'false',
      },
    },
    {
      // The admin-mode twin. See `ADMIN_API_PORT` above for why it exists.
      command: `rm -f "${adminScratchDb}" "${adminScratchDb}-wal" "${adminScratchDb}-shm" && mkdir -p "${scratchDir}" && exec node --import tsx src/index.ts`,
      cwd: '../server',
      url: `${adminApiUrl}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(ADMIN_API_PORT),
        HOST: '127.0.0.1',
        DATABASE_PATH: adminScratchDb,
        JWT_SECRET: 'e2e-secret',
        CORS_ORIGIN: clientUrl,
        EXIT_WITH_PARENT: 'true',
        UNLOCKED: 'false',
        ADMIN: 'true',
      },
    },
    {
      /*
       * Through `e2e/vite-orphan-guard.mjs`, for the reason that file sets out: Playwright starts
       * a `webServer` detached, so Ctrl+C reaches Playwright and nothing under it, and the
       * teardown that would kill this is the one an interrupt skips. Measured on 2026-09-20:
       * interrupting a run left Vite holding 5175, and the next run refused to start.
       *
       * `pnpm dev` before this, which added a shell and pnpm above Vite as well. The API server
       * next door answers the same problem inside itself (`apps/server/src/orphan.ts`), which is
       * the better place when the process is ours; Vite is not, so it gets a parent whose whole
       * job is to notice and to take it with it.
       */
      command: 'node e2e/vite-orphan-guard.mjs',
      url: clientUrl,
      reuseExistingServer: false,
      env: {
        CLIENT_PORT: String(CLIENT_PORT),
        API_PROXY_TARGET: apiUrl,
        // Hot reload off for the duration of the run: the whole argument is on `E2E_ISOLATED` in
        // `vite.config.ts`. Short version: a peer rebuilding `packages/shared` mid-run remounts the
        // game shell about twice a second, which stops every countdown and every poll on the page.
        [E2E_ISOLATED]: '1',
      },
    },
  ],
});
