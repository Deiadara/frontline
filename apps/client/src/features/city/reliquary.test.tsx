import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { UNIT_CATALOG } from '@frontline/shared';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { LabelChip } from '../../components/ui/LabelChip';
import { SpyPointsLine } from '../../components/SpyPointsLine';
import { structureBonus } from '../base/bonus';
import { AffinityTag, antiCombineRule } from '../units/tags';
import { DoorLadder, PamphletPicker, TollingSwitch, TrophyList } from './ReliquaryControls';
import { SIDE_SIGN, SideMark } from './SideMark';

/*
 * Reliquary's client pieces (2026-10-07), each pinned on the one thing it draws differently from
 * the screen it sits on, beside the control that draws it the old way.
 */

const NOW = new Date('2026-10-07T12:00:00Z');
const later = new Date(NOW.getTime() + 3 * 3600 * 1000).toISOString();
const badge = F.factionProfile.faction.badge;

function withQueries(children: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>);
}

describe('the side mark on a tag', () => {
  it('draws the faction emblem for a crew at a table, and the crew glyph for one at none', () => {
    const { rerender } = render(
      <SideMark side="mine" faction={{ name: 'The Choir', badge }} holder="crew" />,
    );
    expect(screen.getByTestId('side-mark-faction')).toHaveAttribute('title', 'The Choir');
    rerender(<SideMark side="mine" faction={null} holder="crew" />);
    expect(screen.getByTestId('side-mark-crew')).toBeInTheDocument();
  });

  it("draws the looters' and the Combine's own glyph, and nothing on unheld ground", () => {
    const { rerender } = render(<SideMark side="enemy" faction={null} holder="looters" />);
    expect(screen.getByTestId('insignia-looters')).toBeInTheDocument();
    rerender(<SideMark side="enemy" faction={null} holder="government" />);
    expect(screen.getByTestId('insignia-government')).toBeInTheDocument();
    rerender(<SideMark side="unoccupied" faction={null} holder="unoccupied" />);
    expect(screen.queryByTestId('insignia-looters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('side-mark-crew')).not.toBeInTheDocument();
  });

  it('colours yours and your faction green, everybody else red, nobody grey', () => {
    expect(SIDE_SIGN.mine).toBe(SIDE_SIGN.ally);
    expect(SIDE_SIGN.mine).toContain('verdigris');
    expect(SIDE_SIGN.enemy).toContain('oxblood');
    expect(SIDE_SIGN.unoccupied).not.toMatch(/verdigris|oxblood/);
  });
});

describe('the Tolling Tower switch', () => {
  it('is greyed with the time left while the switch cools, and live once it has', () => {
    const { rerender } = withQueries(
      <TollingSwitch
        state={{ on: true, changesAt: later }}
        now={NOW}
        baseId="b1"
        districtId="bellfounders"
        locationId="tolling-tower"
      />,
    );
    const button = screen.getByTestId('switch-throw-tolling-tower');
    expect(button).toBeDisabled();
    expect(button.getAttribute('data-refusal')).toMatch(/3h/);
    expect(button).toHaveTextContent('Switch off');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TollingSwitch
          state={{ on: false, changesAt: null }}
          now={NOW}
          baseId="b1"
          districtId="bellfounders"
          locationId="tolling-tower"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('switch-throw-tolling-tower')).toBeEnabled();
    expect(screen.getByTestId('switch-throw-tolling-tower')).toHaveTextContent('Switch on');
  });
});

describe('the Pamphlet Wall picker', () => {
  const wall = (over: Partial<NonNullable<Parameters<typeof PamphletPicker>[0]['wall']>>) => ({
    pins: ['razors'],
    capacity: 2,
    unlocked: true,
    swapCostCaps: null,
    swapAvailableAt: null,
    ...over,
  });
  const draw = (w: ReturnType<typeof wall>, caps = 0) =>
    withQueries(
      <PamphletPicker
        wall={w}
        caps={caps}
        now={NOW}
        baseId="b1"
        districtId="printworks"
        locationId="wall"
      />,
    );

  it('refuses until every pin has a unit, and refuses outright while locked', () => {
    const { unmount } = draw(wall({}));
    expect(screen.getByTestId('pamphlet-set-wall').getAttribute('data-refusal')).toBe(
      'Choose a unit for every pin',
    );
    unmount();
    draw(wall({ pins: ['razors', 'snipers'], unlocked: false }));
    expect(screen.getByTestId('pamphlet-set-wall').getAttribute('data-refusal')).toMatch(
      /set until the wall/,
    );
  });

  it('offers the paid swap only when the wall says so, greyed without the caps', () => {
    const { unmount } = draw(wall({}));
    expect(screen.queryByTestId('pamphlet-swap-wall')).not.toBeInTheDocument();
    unmount();
    draw(wall({ pins: ['razors', 'snipers'], unlocked: false, swapCostCaps: 5000 }), 100);
    const swap = screen.getByTestId('pamphlet-swap-wall');
    expect(swap).toHaveTextContent('Swap for 5,000 caps');
    expect(swap.getAttribute('data-refusal')).toMatch(/Not enough caps/);
  });
});

describe('the Trophy Hall and a door', () => {
  it('ticks the kinds killed since it was held, out of every unit in the game', () => {
    render(
      <TrophyList
        trophies={{ counted: { razors: 3 }, perDay: { highQualityMetal: 10, caps: 100 } }}
        locationId="hall"
      />,
    );
    expect(screen.getByTestId('trophies-hall')).toHaveTextContent(
      `1 of ${UNIT_CATALOG.length} kinds on the wall`,
    );
    expect(screen.getByTestId('trophy-razors')).toHaveAttribute('data-killed', 'yes');
    expect(screen.getByTestId('trophy-snipers')).not.toHaveAttribute('data-killed');
  });

  it('marks the held level on the ladder', () => {
    render(
      <DoorLadder
        door={{ unitId: 'the_saint', name: 'The Saint', level: 2, steps: ['a', 'b', 'c'] }}
        locationId="shrine"
      />,
    );
    expect(screen.getByTestId('door-step-2-shrine')).toHaveAttribute('data-held', 'yes');
    expect(screen.getByTestId('door-step-2-shrine')).toHaveTextContent('L2 · now');
    expect(screen.getByTestId('door-step-1-shrine')).not.toHaveAttribute('data-held');
  });
});

describe('the Noisy the tower puts down', () => {
  it('outlines the chip and names the tower on hover, and only when told', () => {
    const { rerender } = render(<LabelChip label={{ id: 'noisy', tier: 1 }} fromTower />);
    expect(screen.getByTestId('label-noisy')).toHaveAttribute('data-from-tower', 'yes');
    expect(screen.getByTestId('label-noisy').className).toContain('outline-hextech-300');
    rerender(<LabelChip label={{ id: 'noisy', tier: 1 }} />);
    expect(screen.getByTestId('label-noisy')).not.toHaveAttribute('data-from-tower');
    expect(screen.getByTestId('label-noisy').className).not.toContain('outline-hextech-300');
  });

  it('strikes an ignored weakness through in blue on the unit card', () => {
    const affinity = { id: 'noisy', label: 'Noisy', note: '-5% per tier', good: false };
    const { rerender } = render(<AffinityTag affinity={affinity} unitName="Razors" ignored />);
    const chip = screen.getByText('Noisy');
    expect(chip).toHaveAttribute('data-ignored', 'yes');
    expect(chip.className).toContain('line-through');
    rerender(<AffinityTag affinity={affinity} unitName="Razors" />);
    expect(screen.getByText('Noisy').className).not.toContain('line-through');
  });
});

describe('the rest of the roster and the book', () => {
  it('names the ANTI-COMBINE rung and its percentage', () => {
    expect(antiCombineRule(2).label).toBe('Anti-Combine II');
    expect(antiCombineRule(2).description).toContain('+20% offense and +20% vitality');
  });

  it('prints the spy points both ways', () => {
    render(<SpyPointsLine points={{ offence: 42, defence: 17 }} />);
    expect(screen.getByTestId('spy-points-offence')).toHaveTextContent('42');
    expect(screen.getByTestId('spy-points-defence')).toHaveTextContent('17');
  });

  it("adds the ground's payroll share to the Quarters' line", () => {
    const buildings = F.base.buildings;
    const without = structureBonus('quarters', buildings, 3).value;
    const withGround = structureBonus('quarters', buildings, 3, 0, undefined, 10).value;
    const percent = (line: string) => Number(/\+(\d+)% payroll/.exec(line)?.[1]);
    expect(percent(withGround)).toBe(percent(without) + 10);
  });
});
