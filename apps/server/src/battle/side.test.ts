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
 *   2. **Everybody gets their own bodies back.** The engine answers for the side as a whole, and
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

  it('takes one boost for the side rather than one per crew', () => {
    const first = { ...row('a', {}), boostId: null };
    const second = { ...row('b', {}), boostId: 'contraband' };
    const third = { ...row('c', {}), boostId: 'stims' };
    // A boost is bought for a fight and a side gets one. Reinforcements bringing their own would
    // multiply an effect the design hands out once.
    expect(combinedSide([first, second, third], 'b1', 'attacker', AT).boostId).toBe('contraband');
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
   * `floor` loses a body on almost every split with more than one contributor, and those losses
   * land on whoever contributed least. Over a war that is an ally quietly paying for the maths.
   */
  it('never loses a body to rounding, however awkward the split', () => {
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
