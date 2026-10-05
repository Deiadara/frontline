import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/**
 * The standing orders sheet, on the one line it says about who leads a party it fills itself.
 *
 * Every run has a leader (maintainer, 2026-09-28) and the Right Hand only ever sends an officer
 * (`automations/runners.ts`, `leaderFor`). The best-fit choice still promised "the best free
 * officer, or nobody when your research allows it", which was a rung that no longer exists.
 */
const useAutomations = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useAutomations,
  useMe: () => ({ data: { base: { army: { razors: 6 } } } }),
  useSaveAutomation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const { AutomationsPage } = await import('./AutomationsPage');

describe('the best-fit choice', () => {
  it('says the Right Hand sends the best free officer, and never nobody', () => {
    useAutomations.mockReturnValue({
      data: {
        powers: {
          unlocked: true,
          slots: 1,
          cooldownMs: 15 * 60_000,
          bestFit: true,
          optimise: false,
          orders: ['missions'],
        },
        slots: [],
        officers: [],
        serverNow: '2026-09-28T12:00:00.000Z',
      },
    });
    render(
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>,
    );
    const tip = screen.getByTestId('automation-0-bestfit').getAttribute('data-tip') ?? '';
    expect(tip).toContain('best free officer');
    expect(tip).not.toMatch(/nobody/i);
  });
});

// P5-A (2026-10-02): the label follows the mode, at random before Field Promotions.
describe('the chase line', () => {
  const powers = (optimise: boolean) => ({
    unlocked: true,
    slots: 1,
    cooldownMs: 15 * 60_000,
    bestFit: true,
    optimise,
    orders: ['missions'],
  });
  const renderWith = (optimise: boolean) => {
    useAutomations.mockReturnValue({
      data: {
        powers: powers(optimise),
        slots: [],
        officers: [],
        serverNow: '2026-09-28T12:00:00.000Z',
      },
    });
    render(
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>,
    );
  };

  it('says it picks at random before the rung that makes it pick the best', () => {
    renderWith(false);
    expect(screen.getByTestId('automation-0-chase-random')).toHaveTextContent('at random');
    expect(screen.queryByTestId('automation-0-optimise')).toBeNull();
  });

  it('offers the best job overall once that rung is researched', () => {
    renderWith(true);
    expect(screen.queryByTestId('automation-0-chase-random')).toBeNull();
    expect(screen.getByTestId('automation-0-optimise')).toBeInTheDocument();
  });
});
