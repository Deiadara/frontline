/**
 * Small reads and comparisons the scenes share.
 */
import {
  RESOURCE_KEYS,
  type Base,
  type MeResponse,
  type PartialResources,
  type Resources,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { ledgerDrift, unitLedger } from './playthrough-invariants.js';

/** The crew as the shell sees it, off `GET /me` (which settles it). */
export async function me(h: Harness, player: Player): Promise<MeResponse> {
  return h.ok<MeResponse>({ as: player, method: 'GET', route: '/api/me' });
}

/** The crew's base off `GET /me`, failing the step when there is none. */
export async function baseOf(h: Harness, player: Player): Promise<Base> {
  const read = await me(h, player);
  if (!read?.base) throw new Error(`${player.label} has no base on /me`);
  return read.base;
}

/** `after - before`, per resource, leaving out the ones that did not move. */
export function resourceDelta(before: Resources, after: Resources): PartialResources {
  const delta: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const moved = after[key] - before[key];
    if (moved !== 0) delta[key] = moved;
  }
  return delta;
}

/** Negates a bundle: a cost is a negative delta. */
export function negate(bundle: PartialResources): PartialResources {
  const out: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = bundle[key];
    if (amount !== undefined && amount !== 0) out[key] = -amount;
  }
  return out;
}

/** Checks a stockpile moved by exactly `expected` (every resource not named must not move). */
export function expectDelta(
  h: Harness,
  before: Resources,
  after: Resources,
  expected: PartialResources,
  what: string,
): void {
  const actual = resourceDelta(before, after);
  const wrong = RESOURCE_KEYS.filter((key) => (actual[key] ?? 0) !== (expected[key] ?? 0));
  h.check(
    wrong.length === 0,
    `${what}: the stockpile moved by ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

/**
 * Runs `act` and checks the crew's units were only moved, never made or lost: the ledger over
 * every place a unit can be is the same after as before.
 */
export async function conservingUnits<T>(
  h: Harness,
  player: Player,
  what: string,
  act: () => Promise<T>,
): Promise<T> {
  h.settleAll();
  const before = unitLedger(h, player.baseId);
  const result = await act();
  const after = unitLedger(h, player.baseId);
  const drift = ledgerDrift(before, after);
  h.check(
    drift.length === 0,
    `${player.label}: ${what} made or lost units instead of moving them (${drift.join(', ')})`,
  );
  return result;
}

/** The first entry of a list, or a thrown error naming what was missing. */
export function first<T>(list: readonly T[] | undefined, what: string): T {
  const found = list?.[0];
  if (found === undefined) throw new Error(`no ${what} to work with`);
  return found;
}

export const HOUR = 60 * 60_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;
