import { describe, expect, it } from 'vitest';
import {
  applyCharacterXp,
  characterXpBonus,
  characterXpForActivity,
  type Base,
  type Building,
  type Commander,
} from '@frontline/shared';
import { awardCharacterXp } from './award.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The Gauntlet's training bonus reaching an officer's sheet.
 *
 * `characterXpBonus` was computed by `building/standing.ts` and read by nothing — the same dead
 * wiring the Gate had, found by listing exported functions with no consumers outside their own
 * file. A structure that raises a number nobody reads is a structure that does nothing.
 */

const officer = (id: string): Commander =>
  ({ id, name: id, level: 1, xpIntoLevel: 0, role: 'enforcer' }) as unknown as Commander;

const build = (kind: Building['kind'], level: number): Building => ({
  id: `${kind}-1`,
  kind,
  level,
  modifications: [],
  damage: 0,
  garrisons: 0,
});

function baseWith(buildings: Building[]): Base {
  return { id: 'b1', commanders: [officer('o1')], buildings } as unknown as Base;
}

/** Only the two calls `awardCharacterXp` makes; nothing else is exercised. */
const repos = { bases: { updateCommanders: () => undefined } } as unknown as Repositories;

describe('awardCharacterXp', () => {
  const minutes = 600;

  it('credits the flat rate when the crew has built nothing', () => {
    const after = awardCharacterXp(repos, baseWith([]), [
      { officerId: 'o1', minutesEngaged: minutes },
    ]);
    const earned = applyCharacterXp(officer('o1'), characterXpForActivity(minutes));
    expect(after.commanders[0]?.xpIntoLevel).toBe(earned.xpIntoLevel);
    expect(after.commanders[0]?.level).toBe(earned.level);
  });

  it('credits more once the Gauntlet is up', () => {
    const gauntlet = [build('gauntlet', 12)];
    expect(characterXpBonus(gauntlet)).toBeGreaterThan(0);

    const plain = awardCharacterXp(repos, baseWith([]), [
      { officerId: 'o1', minutesEngaged: minutes },
    ]);
    const trained = awardCharacterXp(repos, baseWith(gauntlet), [
      { officerId: 'o1', minutesEngaged: minutes },
    ]);

    const total = (base: Base) =>
      (base.commanders[0]?.level ?? 0) * 1_000_000 + (base.commanders[0]?.xpIntoLevel ?? 0);
    expect(total(trained)).toBeGreaterThan(total(plain));
  });
});
