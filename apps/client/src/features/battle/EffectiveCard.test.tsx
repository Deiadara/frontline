import { battlefieldFor, findUnit, findUnitModification, type BattleView } from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EffectiveCard } from './EffectiveCard';

/**
 * The card folds in what is bolted to the unit.
 *
 * `effectiveStats` has taken the unit's fitted cards since the brackets landed, and the engine
 * passes them; this card passed nothing, so it showed the catalogue sheet under a footer claiming
 * the workshop could only add. A Scrap Vest costs a point of speed and pays four of armour, and a
 * player reading this card before a fight was told neither.
 */
const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

const view: BattleView = {
  battle: {
    id: 'press',
    target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
    attackerBaseId: 'base-1',
    defender: { kind: 'looters' },
    scheduledFor: MARK,
    holdAfterCapture: false,
    wokeSleepers: false,
    declaredAt: NOW,
    resolvedAt: null,
    seed: 'press-seed',
  },
  targetName: 'Kessler Press',
  districtName: 'Steelbelt',
  battlefield: battlefieldFor({
    locationName: 'Kessler Press',
    kind: 'scrap_press',
    fortifyDifficulty: 'medium',
    fortifyLevel: 0,
    at: new Date(MARK),
    weather: 'normal',
  }),
  role: 'attacker',
  side: 'attacker',
  deploymentOpen: true,
  muster: { army: { razors: 3 }, perimeter: {}, size: 3 },
  enemySize: 10,
  enemyIntel: 'A rough count.',
  opponentName: 'Looters',
  boosts: [],
  boostIds: [],
  boostSlots: 1,
  officerId: null,
  vehicles: {},
  yard: {},
  leaders: [],
  traps: [],
  trapId: null,
};

/** The "now" column of one row: the third cell, after the label and the sheet figure. */
function shown(key: string): number {
  const cells = within(screen.getByTestId(`effective-razors-${key}`)).getAllByRole('cell');
  return Number(cells[2]!.textContent);
}

describe('the card on this ground', () => {
  it('counts the unit’s own cards in, as the engine does', () => {
    const vest = findUnitModification('scrap_vest')!;
    expect(vest.effect.armor, 'the fixture card must move armour').toBeGreaterThan(0);
    expect(findUnit('razors')!.stats.armor + vest.effect.armor!).toBeLessThanOrEqual(100);

    const bare = render(<EffectiveCard unitId="razors" view={view} />);
    const before = shown('armor');
    bare.unmount();

    render(
      <EffectiveCard
        unitId="razors"
        view={view}
        loadouts={{ razors: ['scrap_vest', null, null] }}
      />,
    );
    expect(shown('armor')).toBe(before + vest.effect.armor!);
  });
});
