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
 * What it does *not* catch: someone hand-recomputing an equivalent heuristic from scratch under
 * a different name. That is a review question. It does catch every mechanical leak.
 *
 * W5 (the Bar) and W7 (research hints) put role data on the wire for the first time. When they
 * do, extend this with a response-body assertion — hints are allowed, the raw table is not.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Everything that is compiled into, or importable from, the client bundle. */
const CLIENT_REACHABLE_DIRS = ['packages/shared/src', 'apps/client/src', 'apps/client/e2e'];

/**
 * Naming the hidden module or any of its exports. `fit`/`suitability`/`star rating` are in here
 * because B8 bans the *derived* indicator just as firmly as the table itself.
 */
const FORBIDDEN_TOKENS = [
  'ROLE_REQUIREMENTS',
  'RoleRequirement',
  'roleFit',
  'weightedAttributesOf',
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
    const objects = reachableObjects(shared);
    expect(objects.length).toBeGreaterThan(10);

    const secrets = OFFICER_ROLES.map((role) => JSON.stringify(ROLE_REQUIREMENTS[role].weights));
    const wholeTable = JSON.stringify(ROLE_REQUIREMENTS);

    for (const [trail, value] of objects) {
      const serialized = JSON.stringify(value);
      expect(serialized, `${trail} is the requirement table`).not.toBe(wholeTable);
      for (const secret of secrets) {
        expect(serialized, `${trail} is a role's requirement weights`).not.toBe(secret);
      }
    }
  });

  it('leaves nothing role-keyed but plain labels in the shared package', () => {
    const roleIds = new Set<string>(OFFICER_ROLES);
    for (const [trail, value] of reachableObjects(shared)) {
      const keys = Object.keys(value);
      const roleKeyed = keys.length >= roleIds.size && keys.every((key) => roleIds.has(key));
      if (!roleKeyed) continue;
      // Public role metadata (display names) is fine; anything structured is a fit hint.
      for (const entry of Object.values(value)) {
        expect(typeof entry, `${trail} carries structured per-role data`).toBe('string');
      }
    }
  });
});
