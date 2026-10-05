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
  useMusterUnits: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRefreshCrew: () => vi.fn(),
  useCancelMuster: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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
    musteredAt: spec.musteredAt,
    unique: spec.unique,
    stats: spec.stats,
    modifiers: [],
    rules: [],
    affinities: [],
    cost: spec.cost,
    musterSeconds: spec.musterSeconds,
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
    musterCostReduction: 0,
    musterSpeedBonus: 0,
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

  /**
   * The speed chip is a speed, and `musterSecondsFor` divides the clock by it (bug pass,
   * 2026-10-01). It printed "-60% training time" over a clock that took 38% off. The same day the
   * stop at 60 became a taper, which makes 60 of it 59.5 and the clock 37% shorter.
   */
  it('prints the time a muster speed takes off the clock, not the speed', () => {
    useUnits.mockReturnValue({
      data: { ...roster({}), musterSpeedBonus: 60 },
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('-37% muster time')).toBeTruthy();
    expect(screen.queryByText('-60% muster time')).toBeNull();
    expect(screen.queryByText('-38% muster time'), 'the chip skipped the taper').toBeNull();
  });

  /**
   * The supplies line takes the cost cut and the supplies-only points on one taper toward 70
   * (maintainer, 2026-10-01). The chip prints what the supplies-only points add over the cost chip,
   * so the two chips add up to the line: 13 and 30 points are 36.3 off, 23 of it the supplies chip.
   */
  it('prints the supplies cut the bill takes on top of the cost cut', () => {
    useUnits.mockReturnValue({
      data: { ...roster({}), musterCostReduction: 13, musterSuppliesReduction: 30 },
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('-13% cost')).toBeTruthy();
    expect(screen.getByText('-23% supplies')).toBeTruthy();
    expect(screen.queryByText('-30% supplies'), 'the chip printed the raw sum').toBeNull();
  });

  // Bug pass, 2026-10-02: the Chemistry share tapers, so the cut arrives fractional.
  it('prints the cost cut as a whole percent', () => {
    useUnits.mockReturnValue({
      data: { ...roster({}), musterCostReduction: 14.900425863264273 },
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('-15% cost')).toBeTruthy();
    expect(screen.queryByText(/-14\.9\d*% cost/), 'the chip printed the raw sum').toBeNull();
  });

  // The chair rework (maintainer, 2026-10-04): the Veteran's passive is its own cut on the bill.
  it("prints the Veteran's muster cut as a whole percent, and nothing without one", () => {
    useUnits.mockReturnValue({
      data: { ...roster({}), musterVeteranReduction: 7.6 },
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    const { unmount } = render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    const chip = screen.getByTestId('muster-bonus-veteran');
    expect(chip).toHaveTextContent('-8% cost (Veteran)');
    expect(chip.getAttribute('data-tip')).toContain('after the other cuts');
    unmount();

    useUnits.mockReturnValue({
      data: { ...roster({}), musterVeteranReduction: 0 },
      dataUpdatedAt: Date.parse(NOW),
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <UnitsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('muster-bonus-veteran')).toBeNull();
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
