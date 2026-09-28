import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { refuseWaste } from './stores.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

/**
 * One door into the stores (maintainer ruling, 2026-09-28).
 *
 * The ceiling is only a ceiling if nothing walks round it, and the ways round it were ordinary
 * adders: `addResources` in the mission settle, the raid, five refunds and the feats, and the
 * market's own `creditResources` in six places. Each was a credit past the Apothecary that nobody
 * had decided to allow. They go through `district/stores.ts` now, and this keeps it that way: a new
 * credit written with one of the plain adders fails here, by file, before it can overflow a save.
 */
describe('the stores have one door', () => {
  it('lets no server source credit a stockpile except through district/stores.ts', () => {
    const door = path.join(SRC, 'district', 'stores.ts');
    const adders = /\b(addResources|creditResources|creditStores)\(/;
    const offenders = sources(SRC)
      .filter((file) => file !== door)
      .filter((file) => adders.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});

describe('the warning', () => {
  const credit = (wasted: Record<string, number> | undefined) => ({
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    landed: {},
    wasted,
  });

  it('refuses a credit that would waste, with the figure, until the player agrees', () => {
    let thrown: unknown;
    try {
      refuseWaste(credit({ scrap: 120 }), undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('WOULD_WASTE');
    expect((thrown as AppError).statusCode).toBe(409);
    expect((thrown as AppError).waste).toEqual({ scrap: 120 });

    expect(() => refuseWaste(credit({ scrap: 120 }), true)).not.toThrow();
    expect(() => refuseWaste(credit(undefined), undefined)).not.toThrow();
  });
});
