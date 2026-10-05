/**
 * A load test against a real server process (hardening pass, 2026-09-26).
 *
 *   pnpm --filter @frontline/server exec tsx scripts/load.ts 20 50 100
 *
 * Each argument is a player count. For each, a fresh server is started on its own port and its own
 * throwaway database, that many accounts are registered and given a character, and every one of
 * them then behaves like an open browser tab for `SECONDS`: the shell polls (`/me`, the city,
 * notifications, messages) every five seconds, one page's own query on the same beat, a live
 * stream held open, and a write every fifteen seconds. That is the client's cadence
 * (`apps/client/src/lib/queries.ts`, `SHELL_POLL_MS` and `DISTRICT_POLL_MS`).
 *
 * What it prints is what decides whether the server copes: latency percentiles per route, every
 * non-2xx status by route, the server's CPU and memory, and the latency of `/health` sampled ten
 * times a second, which on a single-threaded server is the event-loop lag every player feels.
 *
 * Each player gets its own `X-Forwarded-For` address and the server is started with
 * `TRUST_PROXY=1`, because the unauthenticated limiter is per address and a hundred registrations
 * from one address are, correctly, refused.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4031;
const BASE = `http://127.0.0.1:${PORT}`;
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60);
const POLL_MS = Number(process.env.LOAD_POLL_MS ?? 5_000);
const WRITE_MS = 15_000;

const PAGES = [
  '/api/units',
  '/api/battles',
  '/api/missions',
  '/api/actions',
  '/api/research',
  '/api/feats',
  '/api/bar',
  '/api/market',
  '/api/training',
  '/api/automations',
];

interface Sample {
  route: string;
  ms: number;
  status: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function routeKey(url: string): string {
  return url.replace(/\/[0-9a-f-]{16,}/g, '/:id').replace(/\?.*$/, '');
}

async function call(
  samples: Sample[],
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const started = performance.now();
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetch(
      `${BASE}${url}`,
      body === undefined
        ? { method, headers }
        : {
            method,
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    status = res.status;
    json = await res.json().catch(() => null);
  } catch {
    status = -1;
  }
  samples.push({ route: `${method} ${routeKey(url)}`, ms: performance.now() - started, status });
  return { status, json };
}

async function startServer(dbDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(dbDir, 'load.sqlite'),
      BACKUP_DIR: path.join(dbDir, 'backups'),
      BACKUPS: process.env.LOAD_BACKUPS ?? 'false',
      TRUST_PROXY: '1',
      JWT_SECRET: 'load-test-secret',
      ADMIN: process.env.LOAD_ADMIN ?? 'false',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  for (let tries = 0; tries < 200; tries += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  child.kill('SIGKILL');
  throw new Error('server did not come up');
}

interface Player {
  index: number;
  headers: Record<string, string>;
  baseId: string | null;
}

async function join(samples: Sample[], index: number, runId: string): Promise<Player | string> {
  const ip = `10.${(index >> 8) & 255}.${index & 255}.7`;
  const anon = { 'x-forwarded-for': ip };
  const reg = await call(samples, 'POST', '/api/auth/register', anon, {
    username: `load${runId}${index}`,
    password: 'hunter2pass',
  });
  if (reg.status !== 201) return `register ${reg.status} ${JSON.stringify(reg.json)}`;
  const token = (reg.json as { token: string }).token;
  const headers = { ...anon, authorization: `Bearer ${token}` };
  const choices = await call(samples, 'GET', '/api/overseer/choices', headers);
  const first = (choices.json as { choices?: { presetId: string }[] } | null)?.choices?.[0];
  if (!first) return `no overseer offered: ${JSON.stringify(choices.json).slice(0, 200)}`;
  const chosen = await call(samples, 'POST', '/api/overseer', headers, {
    presetId: first.presetId,
  });
  if (chosen.status !== 201) {
    return `overseer ${chosen.status} ${JSON.stringify(chosen.json).slice(0, 200)}`;
  }
  const baseId = (chosen.json as { base?: { id: string } }).base?.id ?? null;
  return { index, headers, baseId };
}

/** Holds a live stream open for the whole run, as an open tab does. */
function openStream(player: Player, until: number): Promise<void> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), Math.max(0, until - Date.now())).unref();
  return fetch(`${BASE}/api/events`, { headers: player.headers, signal: controller.signal })
    .then(async (res) => {
      const reader = res.body?.getReader();
      while (reader) {
        const { done } = await reader.read();
        if (done) break;
      }
    })
    .catch(() => undefined);
}

async function play(samples: Sample[], player: Player, until: number): Promise<void> {
  await sleep(Math.random() * POLL_MS);
  let tick = 0;
  let nextWrite = Date.now() + Math.random() * WRITE_MS;
  while (Date.now() < until) {
    const beat = Date.now();
    const page = PAGES[(player.index + tick) % PAGES.length]!;
    const reads = [
      call(samples, 'GET', '/api/me', player.headers),
      call(samples, 'GET', '/api/city', player.headers),
      call(samples, 'GET', '/api/notifications', player.headers),
      call(samples, 'GET', '/api/messages', player.headers),
      call(samples, 'GET', page, player.headers),
    ];
    if (player.baseId)
      reads.push(call(samples, 'GET', `/api/base/${player.baseId}`, player.headers));
    await Promise.all(reads);
    if (Date.now() >= nextWrite) {
      nextWrite += WRITE_MS;
      await (tick % 2 === 0
        ? call(samples, 'POST', '/api/units/muster', player.headers, { unitId: 'razors', count: 1 })
        : call(samples, 'POST', '/api/base/build', player.headers, { kind: 'generator' }));
    }
    tick += 1;
    await sleep(Math.max(0, POLL_MS - (Date.now() - beat)));
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function processStats(pid: number): { cpu: number; rssMb: number } {
  try {
    const out = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(pid)])
      .toString()
      .trim();
    const [cpu, rss] = out.split(/\s+/).map(Number);
    return { cpu: cpu ?? 0, rssMb: Math.round((rss ?? 0) / 1024) };
  } catch {
    return { cpu: 0, rssMb: 0 };
  }
}

async function run(count: number): Promise<void> {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'frontline-load-'));
  const server = await startServer(dbDir);
  const samples: Sample[] = [];
  const runId = Date.now().toString(36).slice(-4);
  try {
    const joined = await Promise.all(
      Array.from({ length: count }, (_, index) => join(samples, index, runId)),
    );
    const players = joined.filter((entry): entry is Player => typeof entry !== 'string');
    const refused = joined.filter((entry): entry is string => typeof entry === 'string');

    const until = Date.now() + SECONDS * 1000;
    const lag: number[] = [];
    const cpu: number[] = [];
    let rssMb = 0;
    const probe = (async () => {
      while (Date.now() < until) {
        const started = performance.now();
        await fetch(`${BASE}/health`).catch(() => undefined);
        lag.push(performance.now() - started);
        await sleep(100);
      }
    })();
    const stats = setInterval(() => {
      const now = processStats(server.pid ?? 0);
      cpu.push(now.cpu);
      rssMb = Math.max(rssMb, now.rssMb);
    }, 2_000);

    const playing = samples.length;
    await Promise.all([
      ...players.map((player) => openStream(player, until)),
      ...players.map((player) => play(samples, player, until)),
      probe,
    ]);
    clearInterval(stats);

    const byRoute = new Map<string, Sample[]>();
    for (const sample of samples.slice(playing)) {
      const list = byRoute.get(sample.route) ?? [];
      list.push(sample);
      byRoute.set(sample.route, list);
    }
    const total = samples.length - playing;
    console.log(`\n=== ${count} players (${players.length} joined, ${refused.length} refused) ===`);
    for (const reason of new Set(refused)) console.log(`  refused: ${reason}`);
    console.log(
      `  ${total} requests in ${SECONDS}s (${(total / SECONDS).toFixed(1)}/s), ` +
        `cpu avg ${(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)).toFixed(0)}% ` +
        `max ${Math.max(0, ...cpu).toFixed(0)}%, rss max ${rssMb} MB`,
    );
    const sortedLag = [...lag].sort((a, b) => a - b);
    console.log(
      `  /health lag  p50 ${percentile(sortedLag, 50).toFixed(1)}  p99 ${percentile(sortedLag, 99).toFixed(1)}  max ${Math.max(0, ...lag).toFixed(1)} ms`,
    );
    console.log(
      '  route                                   n     p50     p95     p99     max  non-2xx',
    );
    for (const [route, list] of [...byRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ms = list.map((sample) => sample.ms).sort((a, b) => a - b);
      const bad = new Map<number, number>();
      for (const sample of list) {
        if (sample.status < 200 || sample.status >= 300) {
          bad.set(sample.status, (bad.get(sample.status) ?? 0) + 1);
        }
      }
      const badText = [...bad].map(([status, n]) => `${status}x${n}`).join(' ');
      console.log(
        `  ${route.padEnd(38)}${String(list.length).padStart(5)}${percentile(ms, 50).toFixed(1).padStart(8)}${percentile(ms, 95).toFixed(1).padStart(8)}${percentile(ms, 99).toFixed(1).padStart(8)}${ms[ms.length - 1]!.toFixed(1).padStart(8)}  ${badText}`,
      );
    }
  } finally {
    server.kill('SIGTERM');
    await sleep(500);
    server.kill('SIGKILL');
    rmSync(dbDir, { recursive: true, force: true });
  }
}

const counts = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0);
for (const count of counts.length > 0 ? counts : [20]) {
  await run(count);
}
