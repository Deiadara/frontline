import { infirmaryRecoveryPercent, type Building, type BuildingKind } from '@frontline/shared';
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
   * (`gateDefensePercent` into `gatePercent`), and puts the sum with the holder's other defence
   * through the `heldDefense` curve. Since 2026-10-15 (maintainer) a structure line prints its raw
   * points and only the Crew page prints the curved figure the fight spends. Its points against
   * spies are not printed: spy strength is not public (maintainer, 2026-10-01).
   */
  it('quotes its raw points of defence, and no spy figure', () => {
    expect(structureBonus('gate', DISTRICT, 10).value).toBe('+25 points of defence');
    expect(structureBonus('gate', DISTRICT, 7).value).toBe('+17.5 points of defence');
    expect(structureBonus('gate', DISTRICT, 10).value).not.toMatch(/spy|%/i);
  });

  it('adds the armour cards in the district, untapered', () => {
    // Positive control: a card in another structure lands on the Gate's line, as it does in the
    // fight. A Gate at 20 with Interlocking Bulwarks is 76 before the curve, and the line says 76.
    const carded = [...DISTRICT, at('quarters', 10, ['gate_interlocking_bulwarks'])];
    expect(structureBonus('gate', carded, 20).value).toBe('+76 points of defence');
  });
});

describe('the Infirmary line', () => {
  /*
   * The Infirmary pays medic points, four a level. They join the crew's own and the sum goes
   * through `casualtyRecoveryShare`, so the share forty points would walk home alone (28%) is not
   * what a win spends beside the crew's (maintainer, 2026-10-15). The line prints the points; the
   * Crew page's medic card prints the combined points and the share.
   */
  it('quotes its medic points, not a lone share of the curve', () => {
    const projected = districtWith(DISTRICT, 'infirmary', 10);
    expect(infirmaryRecoveryPercent(projected)).toBe(40);
    expect(structureBonus('infirmary', DISTRICT, 10).value).toBe('+40 medic points');
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
