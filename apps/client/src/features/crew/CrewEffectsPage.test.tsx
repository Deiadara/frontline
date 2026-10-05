import { CHANNEL_LABELS } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const standing = vi.hoisted((): { effects: Record<string, number> } => ({ effects: {} }));
vi.mock('../../lib/queries', () => ({
  useCrewStanding: () => ({
    data: {
      overseer: { name: 'Mara Quell' },
      overseerGrade: {
        mark: 'B-',
        passive:
          'Lifts every seated officer by 13 points, shared over their irreplaceable and essential skills.',
      },
      chairs: [
        {
          role: 'researcher',
          officerName: 'Wilhelmina Okonkwo-Restrepo',
          mark: 'A-',
          passive: 'Makes all research 21.4% faster.',
        },
        { role: 'professor', officerName: 'Vela', mark: 'C+', passive: '9% more experience.' },
      ],
      effects: standing.effects,
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { CrewEffectsPage } = await import('./CrewEffectsPage');

const draw = (effects: Record<string, number>) => {
  standing.effects = effects;
  render(
    <MemoryRouter>
      <CrewEffectsPage />
    </MemoryRouter>,
  );
};

/**
 * The spy channels are not public (maintainer, 2026-10-01: "remove the spy points on every job and
 * points against their spies since these are not public values, and remove the nothing there yet
 * section"). Paid or not, neither is drawn, and nothing lists the channels a crew has not opened.
 */
describe('what the crew is buying', () => {
  it('never draws either spy channel, even when a perk pays it', () => {
    draw({ defensePercent: 10, intelYieldPercent: 17, intelResistancePercent: 15 });
    expect(screen.getByTestId('channel-defensePercent')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-intelYieldPercent')).toBeNull();
    expect(screen.queryByTestId('channel-intelResistancePercent')).toBeNull();
    for (const channel of ['intelYieldPercent', 'intelResistancePercent'] as const) {
      expect(screen.queryByText(CHANNEL_LABELS[channel].label)).toBeNull();
    }
  });

  it('has no section for the channels nobody has opened', () => {
    draw({ defensePercent: 10 });
    expect(screen.queryByText(/Nothing there yet/i)).toBeNull();
    expect(screen.queryByText(/Hire for them/)).toBeNull();
    // Every other channel is still drawn when it is paid.
    draw({ unitMoraleFlat: 8, productionPercent: 4 });
    expect(screen.getByTestId('channel-unitMoraleFlat')).toBeInTheDocument();
    expect(screen.getByTestId('channel-productionPercent')).toBeInTheDocument();
  });
});

/**
 * The chair rework (maintainer, 2026-10-04): no best-of sheet, so the right-hand column lists what
 * each chair pays instead, the Overseer's own grade first.
 */
describe('what the chairs give', () => {
  it("lists the Overseer's grade first, then every working chair with its passive", () => {
    draw({ defensePercent: 10 });
    const list = screen.getByTestId('chair-gifts');
    const rows = [...list.querySelectorAll('li')].map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual(['chair-gift-overseer', 'chair-gift-researcher', 'chair-gift-professor']);

    const overseer = screen.getByTestId('chair-gift-overseer');
    expect(overseer).toHaveTextContent('Overseer');
    expect(overseer).toHaveTextContent('Mara Quell');
    expect(overseer).toHaveTextContent('Lifts every seated officer by 13 points');
    expect(overseer.querySelector('[data-testid="mark-stamp-B-"]')).not.toBeNull();

    const researcher = screen.getByTestId('chair-gift-researcher');
    expect(researcher).toHaveTextContent('Researcher');
    expect(researcher).toHaveTextContent('Wilhelmina Okonkwo-Restrepo');
    expect(researcher).toHaveTextContent('Makes all research 21.4% faster.');
    expect(researcher.querySelector('[data-testid="mark-stamp-A-"]')).not.toBeNull();
  });

  it('no longer draws the shape of the crew', () => {
    draw({ defensePercent: 10 });
    expect(screen.queryByText('The shape of the crew')).toBeNull();
  });
});
