import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '@frontline/shared';
import {
  ATTRIBUTE_NAMES,
  OFFICER_ROLES,
  createCommander,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Attributes,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { projectOfficer, projectRecruit } from '../bar/project.js';
import { barDay, barRoster } from '../bar/roster.js';
import { ROLE_REQUIREMENTS, roleFit } from './requirements.js';

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
 *
 * W5/MOU-164 lands that response-body assertion, at the bottom of this file. It is the *first* one
 * here: the MOU-164 brief said W3 had already added one at this site, and it had not — the last
 * commit to touch this file before W5 was `9f4a83c`, which only widened the token list.
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

/**
 * INTERFACES R4 — the response-body half of the guard (W5/MOU-164).
 *
 * The scans above cover `packages/shared/src`, `apps/client/src` and `apps/client/e2e`. A server
 * route is outside all three, so nothing above would notice the Bar's roster shipping the affinity
 * that shaped a roll. These assertions run the real projection and read what actually comes back.
 *
 * The token and value scans are reused rather than reimplemented — same machinery, new root. What
 * they cannot catch on their own is a *derived* leak: a number that happens to track role fit
 * under an innocent name. `permuted` is the answer to that one, and it is the assertion with the
 * teeth: permuting which attribute holds which rating preserves the whole sheet as a multiset and
 * destroys its alignment to every role at once, so anything role-blind is unchanged by it and
 * anything role-derived is not.
 */
describe('the Bar roster response (INTERFACES R4)', () => {
  const NOW = new Date('2026-08-13T09:00:00.000Z');

  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Leak Test Hold',
    districtId: 'neon-docks',
    level: 3,
    isBot: false,
    resources: { caps: 9000, food: 100, oil: 100, scrap: 100, highQualityMetal: 10 },
    economy: { ...startingEconomy(NOW.toISOString()), infamy: 70 },
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    commanders: [
      createCommander(
        'held-1',
        'Held Officer',
        'chief_medic',
        { medicine: 34, composure: 30 },
        [],
        {
          now: NOW.toISOString(),
        },
      ),
    ],
    createdAt: NOW.toISOString(),
  };

  /** Exactly what `GET /api/bar` serialises, minus the clock. */
  const rosterResponse = (on: Base = base) => ({
    recruits: barRoster(barDay(NOW)).map((recruit) => projectRecruit(on, recruit, NOW)),
    officers: on.commanders.map((officer) => projectOfficer(on, officer)),
    filledRoles: on.commanders.map((officer) => officer.role),
  });

  it('is a non-trivial body — the assertions below must have something to read', () => {
    const body = rosterResponse();
    expect(body.recruits.length).toBeGreaterThan(4);
    expect(body.recruits.some((recruit) => recruit.askingWage !== null)).toBe(true);
    expect(body.officers).toHaveLength(1);
  });

  it('names nothing from the hidden module, and never the word "affinity"', () => {
    const serialized = JSON.stringify(rosterResponse());
    for (const token of [...FORBIDDEN_TOKENS, 'affinity', 'fit', 'suitability']) {
      expect(serialized.toLowerCase(), `the Bar response mentions "${token}"`).not.toContain(
        token.toLowerCase(),
      );
    }
  });

  it('carries neither the table by value nor anything else keyed by role', () => {
    expect(valueLeaksIn(rosterResponse())).toEqual([]);
    expect(roleKeyedLeaksIn(rosterResponse())).toEqual([]);
  });

  /**
   * Rotating the sheet: every rating stays, but each lands on a different attribute. No role's
   * template survives that, so any figure still derived from the visible sheet alone is identical
   * and any figure derived from role fit moves.
   */
  function rotateSheet(attributes: Attributes): Attributes {
    const values = ATTRIBUTE_NAMES.map((name) => attributes[name]);
    return Object.fromEntries(
      ATTRIBUTE_NAMES.map((name, index) => [name, values[(index + 1) % values.length] as number]),
    ) as Attributes;
  }

  it('derives every shipped figure from the visible sheet, not from role fit', () => {
    const day = barDay(NOW);
    for (const recruit of barRoster(day)) {
      const straight = projectRecruit(base, recruit, NOW);
      const permuted = projectRecruit(
        base,
        { ...recruit, attributes: rotateSheet(recruit.attributes) },
        NOW,
      );
      expect(permuted.askingWage, `${recruit.id}'s wage moved when only the roles did`).toBe(
        straight.askingWage,
      );
      expect(permuted.assessment).toEqual(straight.assessment);
    }
  });

  it('would fire on a leak — the permutation check is not vacuous', () => {
    // A positive control for the assertion above: `roleFit` is exactly the shape of hint R4 bans,
    // and rotating the sheet has to move it. Without this, a projection that dropped every derived
    // number would pass the permutation test by having nothing left to compare.
    const [recruit] = barRoster(barDay(NOW));
    if (!recruit) throw new Error('empty roster');
    const moved = OFFICER_ROLES.filter(
      (role) =>
        roleFit(rotateSheet(recruit.attributes), role) !== roleFit(recruit.attributes, role),
    );
    expect(moved.length, 'rotating the sheet must move role fit, or the check proves nothing').toBe(
      OFFICER_ROLES.length,
    );

    // ...and the value/token scans have to fire on a planted affinity, too.
    const leaky = { recruits: [{ id: 'x', affinity: OFFICER_ROLES[0] }] };
    expect(JSON.stringify(leaky)).toContain('affinity');
    expect(valueLeaksIn({ hint: { weights: ROLE_REQUIREMENTS.head_spy.weights } })).not.toEqual([]);
  });
});
