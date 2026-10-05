import {
  casualtyRecoveryShare,
  infirmaryRecoveryPercent,
  type Building,
  type BuildingKind,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { districtWith, structureBonus } from './bonus';

/**
 * The plot dialog's line against what the engine spends (wiring audit, 2026-10-01).
 *
 * Two structures quoted a figure nothing reads, or read it in the wrong unit.
 */

const at = (kind: BuildingKind, level: number, modifications: string[] = []): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
});

const DISTRICT: Building[] = [at('nexus', 20), at('generator', 4)];

describe('the Gate line', () => {
  /*
   * The engine reads the Gate as 2.5 points of held-ground toughness a level, cards added
   * (`gateDefensePercent` into `gatePercent`, then the `heldDefense` curve). The line quoted
   * `districtDefense`, 6 a level times the cards, which the battle code reads only to ask whether
   * a Gate is standing at all. Its points against spies are not printed: spy strength is not
   * public (maintainer, 2026-10-01).
   */
  it('quotes the defence the fight gets, and no spy figure', () => {
    expect(structureBonus('gate', DISTRICT, 10).value).toBe('+25% defence');
    expect(structureBonus('gate', DISTRICT, 10).value).not.toMatch(/point|spy/i);
  });

  it('adds the armour cards in the district, and tapers past the knee like the fight does', () => {
    // Positive control: a card in another structure lands on the Gate's line, as it does in the
    // fight. A Gate at 20 with Interlocking Bulwarks is 76 before the curve.
    const carded = [...DISTRICT, at('quarters', 10, ['gate_interlocking_bulwarks'])];
    const value = structureBonus('gate', carded, 20).value;
    const shown = Number(/^\+(\d+)% defence/.exec(value)?.[1]);
    expect(shown).toBeGreaterThan(50);
    expect(shown).toBeLessThan(76);
  });
});

describe('the Infirmary line', () => {
  /*
   * The Infirmary pays medic points, four a level, and the share of the dead that walks home is
   * those points through `casualtyRecoveryShare`. The line printed the points with a percent sign,
   * so a level 10 Infirmary promised 40% and delivered 27.5%.
   */
  it('quotes the share of the dead its points walk home, not the points', () => {
    const projected = districtWith(DISTRICT, 'infirmary', 10);
    expect(infirmaryRecoveryPercent(projected)).toBe(40);
    expect(structureBonus('infirmary', DISTRICT, 10).value).toBe(
      `${Math.round(casualtyRecoveryShare(40))}%`,
    );
    expect(structureBonus('infirmary', DISTRICT, 10).value).toBe('28%');
  });
});

describe('the lines a player adds to the crew', () => {
  /*
   * The Lab's and the Generator's points join the crew's own on one sum (maintainer, 2026-10-01:
   * "make them add"), so each line says what it is added to, and quotes the structure's points
   * rather than a finished cut. A Lab 20 carrying 40 points of research cards is 80, past the 70
   * the old line stopped at.
   */
  // The Lab's level cuts the research price since 2026-10-02 (P7-C), 1.5 a level.
  it('quotes the Lab as a cut off the price and the Generator as points added to the crew', () => {
    const lab = structureBonus(
      'lab',
      [...DISTRICT, at('lab', 20, ['lab_quantum_modeling', 'lab_redundant_testing_chambers'])],
      20,
    );
    expect(lab.label).toContain('research price');
    expect(lab.value).toBe('30%');
    expect(structureBonus('generator', DISTRICT, 20).label).toContain('added to your crew');
  });
});
