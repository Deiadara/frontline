/**
 * What the playthrough prints at the end, and the exit code it ends with.
 */
import type { Harness } from './playthrough-harness.js';
import { benchLog } from './playthrough-bench.js';

/** Prints the route table, the routes never called and every failure. Returns the exit code. */
export function printReport(h: Harness, wallMsTaken: number): number {
  const routes = [...h.coverage.entries()].sort(([a], [b]) => a.localeCompare(b));
  const called = routes.filter(([, tally]) => tally.calls > 0);
  const uncalled = routes.filter(([, tally]) => tally.calls === 0).map(([route]) => route);
  const failingRoutes = routes.filter(([, tally]) => tally.failed > 0);

  const out: string[] = [];
  out.push('');
  out.push('=== Frontline playthrough ===');
  out.push(
    `${h.players.length} players, ${routes.length} routes registered, ${called.length} called, ` +
      `${uncalled.length} never called, ${failingRoutes.length} with a failed call; ` +
      `${(wallMsTaken / 1000).toFixed(1)}s`,
  );
  out.push('');
  out.push(`${'route'.padEnd(44)}${'calls'.padStart(6)}  result`);
  for (const [route, tally] of routes) {
    const result =
      tally.calls === 0 ? 'NEVER CALLED' : tally.failed > 0 ? `FAIL (${tally.failed})` : 'pass';
    out.push(`${route.padEnd(44)}${String(tally.calls).padStart(6)}  ${result}`);
  }

  if (uncalled.length > 0) {
    out.push('');
    out.push(`Routes the playthrough never called (${uncalled.length}):`);
    for (const route of uncalled) out.push(`  ${route}`);
  }

  out.push('');
  out.push(
    `Set up outside the API by the bench (${benchLog.length} writes, see playthrough-bench.ts):`,
  );
  for (const line of benchLog) out.push(`  ${line}`);

  out.push('');
  if (h.failures.length === 0) {
    out.push('No failed assertions.');
  } else {
    out.push(`Failed assertions (${h.failures.length}):`);
    h.failures.forEach((failure, index) => {
      out.push('');
      out.push(`${index + 1}. [${failure.step}] ${failure.why}`);
      if (failure.request) out.push(`   request:  ${failure.request}`);
      if (failure.response) out.push(`   response: ${failure.response}`);
    });
  }
  out.push('');
  const failed = h.failures.length > 0 || uncalled.length > 0;
  out.push(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  console.log(out.join('\n'));
  return failed ? 1 : 0;
}
