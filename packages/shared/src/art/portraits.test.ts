import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_OFFICER_PORTRAIT_IDS,
  DUPLICATE_OFFICER_PORTRAIT_IDS,
  OFFICER_PORTRAIT_IDS,
  OVERSEER_PORTRAIT_IDS,
} from '../roles.js';
import { findAssetSpec, tryResolveAssetKey } from './manifest.js';
import { OFFICER_SUBJECTS, PORTRAIT_SUBJECTS } from './prompts.js';

/**
 * The two portrait pools, checked end to end: id, subject, manifest entry, delivered file.
 *
 * Each link was already covered somewhere and the chain was not, which is how a face lands as a
 * key with a prompt and no picture. `subjectFor` throws at import for a missing prompt and
 * `validateAssetSpec` refuses a spec that breaks §6, but neither of them opens `assets/`, and the
 * client's fallback for a file that is not there is procedural art on a screen nobody is looking at.
 */

const ASSET_DIR = fileURLToPath(new URL('../../../../assets/', import.meta.url));

const deliveredPath = (file: string): string => `${ASSET_DIR}${file}`;

describe('the officer portrait pool', () => {
  it('describes, specs and delivers every id', () => {
    for (const portraitId of OFFICER_PORTRAIT_IDS) {
      expect(OFFICER_SUBJECTS[portraitId], portraitId).toBeTruthy();
      const key = tryResolveAssetKey({ type: 'officer', portraitId });
      expect(key, portraitId).toBe(`officer-${portraitId}`);
      const spec = findAssetSpec(key ?? '');
      expect(spec, portraitId).toBeDefined();
      expect(statSync(deliveredPath(spec?.file ?? '')).size, spec?.file).toBeGreaterThan(0);
    }
  });

  it('describes nobody it does not also list', () => {
    expect(Object.keys(OFFICER_SUBJECTS).sort()).toEqual([...OFFICER_PORTRAIT_IDS].sort());
  });
});

describe('the overseer portrait pool', () => {
  it('describes, specs and delivers every id', () => {
    for (const portraitId of OVERSEER_PORTRAIT_IDS) {
      expect(PORTRAIT_SUBJECTS[portraitId], portraitId).toBeTruthy();
      const key = tryResolveAssetKey({ type: 'portrait', portraitId });
      expect(key, portraitId).toBe(`portrait-${portraitId}`);
      const spec = findAssetSpec(key ?? '');
      expect(spec, portraitId).toBeDefined();
      expect(statSync(deliveredPath(spec?.file ?? '')).size, spec?.file).toBeGreaterThan(0);
    }
  });

  it('is thirty faces, zero padded, in order', () => {
    expect(OVERSEER_PORTRAIT_IDS).toHaveLength(30);
    expect(OVERSEER_PORTRAIT_IDS[0]).toBe('overseer-01');
    expect(OVERSEER_PORTRAIT_IDS.at(-1)).toBe('overseer-30');
  });

  /**
   * The rule the pool exists for: a face the player wears is never on somebody they hired.
   *
   * Three statements rather than one, because the pools can collide three ways. The ids are
   * disjoint by construction (`'01'` against `'overseer-01'`), the keys are what the client asks
   * for, and the delivered bytes are the only one of the three a reader can see on screen.
   */
  it('shares no id, no key and no picture with the officer pool', () => {
    const officerIds = new Set<string>(OFFICER_PORTRAIT_IDS);
    for (const id of OVERSEER_PORTRAIT_IDS) expect(officerIds.has(id), id).toBe(false);

    const assignable = new Set<string>(ASSIGNABLE_OFFICER_PORTRAIT_IDS);
    for (const id of OVERSEER_PORTRAIT_IDS) expect(assignable.has(id), id).toBe(false);

    const officerKeys = new Set(OFFICER_PORTRAIT_IDS.map((id) => `officer-${id}`));
    for (const id of OVERSEER_PORTRAIT_IDS) {
      expect(officerKeys.has(`portrait-${id}`), id).toBe(false);
    }

    expect(identicalGroups([...OVERSEER_PORTRAIT_IDS.map((id) => `portrait-${id}`)])).toEqual([]);
    const across = identicalGroups([
      ...OVERSEER_PORTRAIT_IDS.map((id) => `portrait-${id}`),
      ...ASSIGNABLE_OFFICER_PORTRAIT_IDS.map((id) => `officer-${id}`),
    ]);
    expect(across).toEqual([]);
  });
});

/**
 * The result of the signature sweep `roles.ts` documents, pinned rather than re-measured.
 *
 * The sweep itself compares every master against every other and against its mirror on a 16x16
 * luminance signature, which means decoding two hundred masters: too slow to run per commit, and
 * it answers a question that only changes when art lands. What is cheap enough to run every time is
 * the strictest half of its finding, that no two delivered files are the same bytes, and the list
 * below is the sweep's whole answer at distance 0. A pair that stops being identical fails here
 * with a name in it, which is the signal to re-run the sweep rather than to edit this list.
 *
 * `officer-43` is not here because it is `officer-33` **mirrored**: different bytes, same person,
 * and only the sweep can see it. It stays in `DUPLICATE_OFFICER_PORTRAIT_IDS` on that evidence.
 */
const IDENTICAL_DELIVERIES: readonly (readonly string[])[] = [['officer-26', 'officer-42']];

describe('duplicate faces', () => {
  it('finds exactly the pairs the signature sweep recorded', () => {
    const pool = [
      ...OFFICER_PORTRAIT_IDS.map((id) => `officer-${id}`),
      ...OVERSEER_PORTRAIT_IDS.map((id) => `portrait-${id}`),
    ];
    expect(identicalGroups(pool)).toEqual(IDENTICAL_DELIVERIES);
  });

  it('withholds every duplicate from the assignable pool', () => {
    expect(DUPLICATE_OFFICER_PORTRAIT_IDS).toEqual(['42', '43']);
    const assignable = new Set<string>(ASSIGNABLE_OFFICER_PORTRAIT_IDS);
    for (const id of DUPLICATE_OFFICER_PORTRAIT_IDS) expect(assignable.has(id), id).toBe(false);
    expect(ASSIGNABLE_OFFICER_PORTRAIT_IDS).toHaveLength(
      OFFICER_PORTRAIT_IDS.length - DUPLICATE_OFFICER_PORTRAIT_IDS.length,
    );
  });
});

/**
 * Keys whose delivered files are byte-identical, grouped, each group in manifest order.
 *
 * Sized first and hashed only within a size, so the common case reads 194 directory entries rather
 * than forty megabytes of WebP. Two different pictures at the same byte length are possible and
 * cost one hash each; two identical ones cannot have different lengths.
 */
function identicalGroups(keys: readonly string[]): string[][] {
  const bySize = new Map<number, string[]>();
  for (const key of keys) {
    const file = findAssetSpec(key)?.file;
    if (file === undefined) throw new Error(`No manifest entry for "${key}"`);
    const { size } = statSync(deliveredPath(file));
    bySize.set(size, [...(bySize.get(size) ?? []), key]);
  }

  const groups: string[][] = [];
  for (const candidates of bySize.values()) {
    if (candidates.length < 2) continue;
    const byHash = new Map<string, string[]>();
    for (const key of candidates) {
      const file = findAssetSpec(key)?.file ?? '';
      const hash = createHash('sha256')
        .update(readFileSync(deliveredPath(file)))
        .digest('hex');
      byHash.set(hash, [...(byHash.get(hash) ?? []), key]);
    }
    for (const group of byHash.values()) if (group.length > 1) groups.push(group);
  }
  return groups;
}
