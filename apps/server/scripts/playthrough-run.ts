/**
 * The run: boot, the scenes in order, the admin phase, the report.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { MeResponse } from '@frontline/shared';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Harness, describe, startServer, type Server } from './playthrough-harness.js';
import { checkInvariants } from './playthrough-invariants.js';
import { printReport } from './playthrough-report.js';
import { newCast, type Cast } from './playthrough-cast.js';
import { SCENES, ADMIN_SCENES } from './playthrough-scenes.js';
import { wallMs } from './playthrough-clock.js';

export interface Scene {
  name: string;
  run: (h: Harness, cast: Cast) => Promise<void>;
}

export async function main(): Promise<number> {
  const started = wallMs();
  const dir = mkdtempSync(path.join(tmpdir(), 'frontline-playthrough-'));
  const databasePath = path.join(dir, 'playthrough.sqlite');
  let server: Server | null = null;

  const cleanUp = async (): Promise<void> => {
    const running = server;
    server = null;
    if (running) await running.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
  // Ctrl+C: close the port and the database, remove the temp directory, and go. A second Ctrl+C
  // while that is in flight falls through to Node's default and ends the process outright.
  process.once('SIGINT', () => {
    console.error('\nplaythrough interrupted: stopping the server');
    void cleanUp().finally(() => process.exit(130));
  });

  // The world a launch opens on: no seeded crews (maintainer, 2026-09-28). The dev bots sit on
  // home plots, and plots are one crew each, so with them seeded Ashfall has room for one player.
  server = await startServer({ databasePath, admin: false, seed: false });
  const h = new Harness(server);
  const cast = newCast();
  try {
    await playScenes(h, cast, SCENES);

    // The admin bench only exists while admin mode is on: a second server on the same file.
    h.at('admin phase: restart with ADMIN=true');
    await server.close();
    server = null;
    server = await startServer({ databasePath, admin: true, seed: false });
    h.swapServer(server);
    await playScenes(h, cast, ADMIN_SCENES);
  } catch (error) {
    h.fail(h.currentStep, '', `the run stopped early: ${describe(error)}`);
  } finally {
    h.dispose();
    await cleanUp();
  }
  return printReport(h, wallMs() - started);
}

/** After `/me` (the backstop that drains every pending announcement), every level has been told. */
async function everyLevelTold(h: Harness): Promise<void> {
  for (const player of h.players) {
    const me = await h.ok<MeResponse>({ as: player, method: 'GET', route: '/api/me' });
    const level = me?.base?.level;
    if (level === undefined) continue;
    const told = h.announced.get(player.userId) ?? 1;
    h.check(
      told >= level,
      `${player.label} is at level ${level} and was only ever told of level ${told}`,
    );
  }
}

async function playScenes(h: Harness, cast: Cast, scenes: readonly Scene[]): Promise<void> {
  for (const scene of scenes) {
    h.at(scene.name);
    console.log(`- ${scene.name}`);
    try {
      await scene.run(h, cast);
    } catch (error) {
      h.fail(h.currentStep, '', `the scene stopped early: ${describe(error)}`);
    }
    h.collectServerErrors();
    h.at(`${scene.name}: invariants`);
    await everyLevelTold(h);
    checkInvariants(h, cast);
  }
}
