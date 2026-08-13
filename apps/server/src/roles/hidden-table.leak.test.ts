import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '@frontline/shared';
import { OFFICER_ROLES } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ROLE_REQUIREMENTS } from './requirements.js';

/**
 * B8/B8a — the role requirement table is server-side only.
 *
 * "Never exposed to players" is not something code review can hold on its own, so this test is
 * the enforcement. It guards the two ways the table could actually reach a player:
 *
 *  1. **By import** — anything under `packages/shared` or `apps/client` naming the hidden module
 *     or one of its exports would be compiled straight into the client bundle.
 *  2. **By value** — the table (or one role's weights) being re-declared or re-exported from
 *     `@frontline/shared`, which the client imports wholesale.
 *
 * What it does *not* catch: a leak that is *derived* rather than copied — an equivalent heuristic
 * recomputed under a different name, or the table being inferable from data the server does ship.
 * Both are review questions, and the second is a live one: recruit sheets currently expose enough
 * of the weight ordering to reconstruct the table (MOU-160 F1). Passing this file means the table
 * was not copied; it does not mean the table is secret.
 *
 * W5 (the Bar) and W7 (research hints) put role data on the wire for the first time. When they
 * do, extend this with a response-body assertion — hints are allowed, the raw table is not.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Everything that is compiled into, or importable from, the client bundle. */
const CLIENT_REACHABLE_DIRS = ['packages/shared/src', 'apps/client/src', 'apps/client/e2e'];

/**
 * Naming the hidden module or any of its exports. `fit`/`suitability`/`star rating` are in here
 * because B8 bans the *derived* indicator just as firmly as the table itself — and so is
 * `rollRecruit`, which lives in the generator but hands back the affinity that shaped a roll,
 * which is the same hint by another name.
 *
 * Every accessor that reaches the weights belongs here. A rename that updates the accessor but
 * not this list fails *open*: the scan stays green while the new name goes uncovered.
 */
const FORBIDDEN_TOKENS = [
  'ROLE_REQUIREMENTS',
  'RoleRequirement',
  'roleFit',
  'weightedAttributesOf',
  'attributeWeightsOf',
  'rollRecruit',
  'roles/requirements',
  'fitScore',
  'roleSuitability',
  'starRating',
  '@frontline/server',
];

function sourceFilesUnder(dir: string): string[] {
  const absolute = path.join(REPO_ROOT, dir);
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    found.push(path.join(entry.parentPath, entry.name));
  }
  return found;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Key-order-independent serialization. Exact `JSON.stringify` equality is trivially defeated by
 * re-ordering the keys or by nesting the table one level down, so leaks are matched on a
 * canonical form and by containment rather than by equality.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Every plain object reachable from the shared package's export surface, with its path. */
function reachableObjects(root: unknown): [string, Record<string, unknown>][] {
  const found: [string, Record<string, unknown>][] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, trail: string): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (isPlainObject(value)) {
      found.push([trail, value]);
      for (const [key, child] of Object.entries(value)) visit(child, `${trail}.${key}`);
      return;
    }
    if (Array.isArray(value)) value.forEach((child, i) => visit(child, `${trail}[${i}]`));
  };
  visit(root, 'shared');
  return found;
}

/** Paths at which the table, or one role's weights, is reachable by value from `root`. */
function valueLeaksIn(root: unknown): string[] {
  const secrets = OFFICER_ROLES.map((role) => canonical(ROLE_REQUIREMENTS[role].weights));
  const wholeTable = canonical(ROLE_REQUIREMENTS);
  return reachableObjects(root)
    .filter(([, value]) => {
      const serialized = canonical(value);
      return serialized.includes(wholeTable) || secrets.some((s) => serialized.includes(s));
    })
    .map(([trail]) => trail);
}

/** Paths at which `root` exposes structured (non-label) data keyed by role id. */
function roleKeyedLeaksIn(root: unknown): string[] {
  const roleIds = new Set<string>(OFFICER_ROLES);
  return reachableObjects(root)
    .filter(([, value]) => {
      const keys = Object.keys(value);
      // Two role ids already make a table. Requiring all 19 (`keys.length >= roleIds.size`) let
      // any partial copy — 18 roles, or one nested a level down — through untouched.
      if (keys.length < 2 || !keys.every((key) => roleIds.has(key))) return false;
      // Public role metadata (display names) is fine; anything structured is a fit hint.
      return Object.values(value).some((entry) => typeof entry !== 'string');
    })
    .map(([trail]) => trail);
}

describe('the hidden role requirement table', () => {
  it('is not named anywhere the client can reach', () => {
    const offenders: string[] = [];
    for (const dir of CLIENT_REACHABLE_DIRS) {
      for (const file of sourceFilesUnder(dir)) {
        const contents = readFileSync(file, 'utf8');
        for (const token of FORBIDDEN_TOKENS) {
          if (contents.includes(token)) {
            offenders.push(`${path.relative(REPO_ROOT, file)} mentions "${token}"`);
          }
        }
      }
    }
    expect(offenders, 'the role requirement table must stay server-side (GDD B8a)').toEqual([]);
  });

  it('scans a non-trivial number of client-reachable files', () => {
    // Guards the guard: a bad path would make the scan above vacuously pass.
    const scanned = CLIENT_REACHABLE_DIRS.flatMap(sourceFilesUnder);
    expect(scanned.length).toBeGreaterThan(20);
  });

  it('does not appear by value anywhere in the shared package', () => {
    expect(reachableObjects(shared).length).toBeGreaterThan(10);
    expect(
      valueLeaksIn(shared),
      'the requirement table is reachable from @frontline/shared',
    ).toEqual([]);
  });

  it('leaves nothing role-keyed but plain labels in the shared package', () => {
    expect(roleKeyedLeaksIn(shared), 'structured per-role data is a fit hint (B8)').toEqual([]);
  });

  // Guards the guards: both scans above only mean something if they fire on a leak that is
  // *not* a byte-identical copy of the table — the shapes the previous exact-equality and
  // all-19-keys checks let through.
  it('catches a partial, re-ordered or nested copy', () => {
    const [first, second] = OFFICER_ROLES;
    if (!first || !second) throw new Error('need two roles to plant a partial copy');

    const reorderedWeights = Object.fromEntries(
      Object.entries(ROLE_REQUIREMENTS[first].weights).reverse(),
    );
    expect(valueLeaksIn({ deep: { down: { weights: reorderedWeights } } })).not.toEqual([]);
    expect(valueLeaksIn({ everything: ROLE_REQUIREMENTS })).not.toEqual([]);

    // Two roles is a partial table, and it is still a fit hint.
    const partial = {
      [first]: ROLE_REQUIREMENTS[first].weights,
      [second]: ROLE_REQUIREMENTS[second].weights,
    };
    expect(roleKeyedLeaksIn({ hint: partial })).not.toEqual([]);

    // ...but public per-role labels stay allowed.
    expect(roleKeyedLeaksIn({ labels: { [first]: 'Scout', [second]: 'Medic' } })).toEqual([]);
  });
});
