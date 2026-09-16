import { emptyDeployment, type BattleDeployment } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { combinedSide, splitSurvivors } from './side.js';

/**
 * A side of a fight is several crews now (`battle/side.ts`).
 *
 * Two properties carry the whole feature, and both are the kind that fail quietly:
 *
 *   1. **The engine sees everybody.** A fold that read one row would march the declarer in alone
 *      while their reinforcements sat in the database, and the only symptom would be a fight that
 *      went worse than the screen said it would.
 *   2. **Everybody gets their own units back.** The engine answers for the side as a whole, and
 *      those survivors belong to different people. Handing them all to the declarer would transfer
 *      an ally's army to whoever called the fight, one battle at a time.
 */

const AT = '2026-08-30T12:00:00.000Z';

function row(
  baseId: string | null,
  army: Record<string, number>,
  perimeter = {},
): BattleDeployment {
  return { ...emptyDeployment('b1', baseId, 'attacker', AT), army, perimeter };
}

describe('a side with more than one crew on it', () => {
  it('adds every contributor into one force', () => {
    const folded = combinedSide(
      [row('a', { razors: 10, wardens: 2 }), row('b', { razors: 5 }), row('c', { snipers: 3 })],
      'b1',
      'attacker',
      AT,
    );
    expect(folded.army).toEqual({ razors: 15, wardens: 2, snipers: 3 });
  });

  it('adds the rings too, which stand outside the fight but still belong to somebody', () => {
    const folded = combinedSide(
      [row('a', {}, { razors: 4 }), row('b', {}, { razors: 6, ghosts: 1 })],
      'b1',
      'attacker',
      AT,
    );
    expect(folded.perimeter).toEqual({ razors: 10, ghosts: 1 });
  });

  /**
   * Every name the side burned, in order, with no duplicates.
   *
   * A crew may burn more than one since the maintainer's 2026-09-12 call (`battleBoostSlots`), and the
   * cap is per *crew*: this fold is what carries an ally's name onto the side as well, and what
   * stops the same name counting twice when two crews both burned it.
   */
  it('carries every name the side burned, and counts a shared one once', () => {
    const first = { ...row('a', {}), boostIds: [] };
    const second = { ...row('b', {}), boostIds: ['contraband'] };
    const third = { ...row('c', {}), boostIds: ['stims', 'contraband'] };
    expect(combinedSide([first, second, third], 'b1', 'attacker', AT).boostIds).toEqual([
      'contraband',
      'stims',
    ]);
  });

  it('is an empty force when nobody has committed anything', () => {
    const folded = combinedSide([], 'b1', 'attacker', AT);
    expect(folded.army).toEqual({});
    expect(folded.baseId).toBeNull();
  });
});

describe('splitting the survivors back', () => {
  const pick = (entry: BattleDeployment) => entry.army;

  it('gives each crew back its own share, and hands back exactly what survived', () => {
    const rows = [row('a', { razors: 30 }), row('b', { razors: 10 })];
    const shares = splitSurvivors(rows, { razors: 20 }, pick);
    expect(shares.get('a')).toEqual({ razors: 15 });
    expect(shares.get('b')).toEqual({ razors: 5 });
  });

  /**
   * The rounding property, which is the reason this is largest-remainder rather than a floor.
   *
   * `floor` loses a unit on almost every split with more than one contributor, and those losses
   * land on whoever contributed least. Over a war that is an ally quietly paying for the maths.
   */
  it('never loses a unit to rounding, however awkward the split', () => {
    const rows = [row('a', { razors: 1 }), row('b', { razors: 1 }), row('c', { razors: 1 })];
    for (let survived = 0; survived <= 3; survived += 1) {
      const shares = splitSurvivors(rows, { razors: survived }, pick);
      const handed = [...shares.values()].reduce((total, army) => total + (army.razors ?? 0), 0);
      expect(handed, `${survived} survivors`).toBe(survived);
    }
  });

  it('hands nothing to a crew that sent nothing of that unit', () => {
    const rows = [row('a', { razors: 10 }), row('b', { snipers: 4 })];
    const shares = splitSurvivors(rows, { razors: 6, snipers: 2 }, pick);
    expect(shares.get('a')).toEqual({ razors: 6 });
    expect(shares.get('b')).toEqual({ snipers: 2 });
  });

  it('is exact across a hundred random splits, which is the only way to trust the remainder walk', () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 100; trial += 1) {
      const sent = [1, 2, 3].map(() => 1 + Math.floor(next() * 40));
      const rows = sent.map((count, index) => row(`crew-${index}`, { razors: count }));
      const committed = sent.reduce((total, count) => total + count, 0);
      const survived = Math.floor(next() * (committed + 1));

      const shares = splitSurvivors(rows, { razors: survived }, pick);
      const handed = [...shares.values()].reduce((total, army) => total + (army.razors ?? 0), 0);
      expect(handed, `trial ${trial}`).toBe(survived);
      // And nobody gets back more than they sent, which a naive rounding-up would allow.
      for (const [index, count] of sent.entries()) {
        expect(shares.get(`crew-${index}`)?.razors ?? 0).toBeLessThanOrEqual(count);
      }
    }
  });
});
