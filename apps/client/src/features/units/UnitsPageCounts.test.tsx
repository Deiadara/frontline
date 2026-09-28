import {
  findUnit,
  modificationsForUnit,
  type UnitOption,
  type UnitsResponse,
} from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const useUnits = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useUnits,
  useMe: () => ({ data: { base: { id: 'base-1' } } }),
  useTrainUnits: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRefreshCrew: () => vi.fn(),
  useCancelTraining: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useBurnUpgrade: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const NOW = '2026-09-28T12:00:00.000Z';
vi.mock('../missions/useServerClock', () => ({ useServerClock: () => new Date(NOW) }));

const { UnitsPage } = await import('./UnitsPage');

/** The Scavengers' row, on the tab the roster opens on. Only what the card reads is filled. */
function scavengers(owned: number): UnitOption {
  const spec = findUnit('scavengers')!;
  return {
    id: spec.id,
    name: spec.name,
    tier: spec.tier,
    blurb: spec.blurb,
    trainedAt: spec.trainedAt,
    unique: spec.unique,
    stats: spec.stats,
    modifiers: [],
    rules: [],
    affinities: [],
    cost: spec.cost,
    trainSeconds: spec.trainSeconds,
    unitSlots: spec.unitSlots,
    unlocked: true,
    missing: [],
    owned,
    slots: [],
    eligible: modificationsForUnit(spec.id).map((card) => card.id),
  };
}

function roster(
  gateArmy: Record<string, number>,
  garrisoned: Record<string, number> = {},
  abroad: Record<string, number> = {},
): UnitsResponse {
  return {
    serverNow: NOW,
    units: [scavengers(2)],
    army: { scavengers: 2 },
    garrisoned,
    abroad,
    unitSlotsUsed: 0,
    unitSlotsCap: 100,
    gateArmy,
    moveDestinations: [],
    standingAt: {},
    fleet: {},
    queue: [],
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    trainingCostReduction: 0,
    trainingSpeedBonus: 0,
    built: [],
  };
}

/**
 * The gate garrison (2026-09-22) is the crew's own people at its own door, and it is in none of
 * `army`, `garrisoned` or `abroad`. The card added those three, so a crew that walked four
 * Scavengers to the gate watched the roster lose four with nothing on the screen to say where.
 */
describe('the roster count', () => {
  it('counts the people standing at the gate', () => {
    useUnits.mockReturnValue({
      data: roster({ scavengers: 4 }),
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    // In the total only: the door is inside the home district, and the brass slice is what
    // stands outside it (maintainer, 2026-09-28).
    expect(screen.getByTestId('unit-count-scavengers').textContent).toBe('6');
  });

  it('slices out the people on held ground with the rest away, after a slash', () => {
    useUnits.mockReturnValue({
      data: roster({}, { scavengers: 3 }, { scavengers: 1 }),
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('unit-count-scavengers').textContent).toBe('6 / 4');
  });
});
