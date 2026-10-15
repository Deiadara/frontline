import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { findUnit, UNIT_RULES } from '@frontline/shared';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { UnitCard } from './UnitCard';
import { catalogueOption } from './UnitWindow';

function draw(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const snipers = findUnit('snipers')!;
const safeDistance = { id: 'safe_distance', ...UNIT_RULES.safe_distance };

/**
 * A tag a location's level grants (maintainer, 2026-10-09): greyed out with a cross until the
 * crew has it, saying what it does and how to get it, and an ordinary rule once it does.
 */
describe('a level tag on the unit card', () => {
  it('draws greyed out with a cross, and says how to unlock it on hover', () => {
    draw(<UnitCard unit={catalogueOption(snipers)} garrisoned={0} abroad={0} />);
    const marks = screen.getByTestId('marks-snipers');
    const chip = within(marks).getByText('Safe Distance').closest('[data-locked]');
    expect(chip?.getAttribute('data-locked')).toBe('yes');
    expect(chip?.querySelector('svg')).not.toBeNull();
    fireEvent.mouseEnter(within(marks).getByText('Safe Distance'));
    expect(screen.getByText(/Hold Box Nine at level 5/)).toBeTruthy();
    expect(
      screen.getByText(new RegExp(UNIT_RULES.safe_distance.description.slice(0, 30))),
    ).toBeTruthy();
  });

  it('draws as an ordinary rule once the crew has it, and never twice', () => {
    draw(<UnitCard unit={catalogueOption(snipers, [safeDistance])} garrisoned={0} abroad={0} />);
    const marks = screen.getByTestId('marks-snipers');
    expect(within(marks).getAllByText('Safe Distance')).toHaveLength(1);
    expect(marks.querySelector('[data-locked]')).toBeNull();
  });

  it('greys the second rung of AD HOC ARMY until the ring is at 5', () => {
    const geppetto = findUnit('the_geppetto')!;
    const { unmount } = draw(
      <UnitCard unit={catalogueOption(geppetto)} garrisoned={0} abroad={0} />,
    );
    const locked = within(screen.getByTestId('marks-the_geppetto'))
      .getByText('Ad Hoc Army II')
      .closest('[data-locked]');
    expect(locked).not.toBeNull();
    unmount();
    const fifth = catalogueOption(geppetto);
    draw(
      <UnitCard
        unit={{
          ...fifth,
          rules: fifth.rules.map((rule) =>
            rule.id === 'ad_hoc_army' ? { ...rule, label: 'Ad Hoc Army II', level: 5 } : rule,
          ),
        }}
        garrisoned={0}
        abroad={0}
      />,
    );
    expect(screen.getByTestId('marks-the_geppetto').querySelector('[data-locked]')).toBeNull();
  });
});

/**
 * A door's rules are tags too (2026-10-14): the Dancer's PAPERCUT was run by the engine off the
 * Stage's ladder and drawn nowhere, locked or held.
 */
describe("a door's rule on the unit card", () => {
  const dancer = findUnit('the_crimson_dancer')!;

  it('greys the rules the door pays until the crew holds it at that level', () => {
    draw(<UnitCard unit={catalogueOption(dancer)} garrisoned={0} abroad={0} />);
    const marks = screen.getByTestId('marks-the_crimson_dancer');
    for (const label of ['Spectacle', 'Papercut']) {
      const chip = within(marks).getByText(label).closest('[data-locked]');
      expect(chip?.getAttribute('data-locked'), label).toBe('yes');
    }
    fireEvent.mouseEnter(within(marks).getByText('Papercut'));
    expect(screen.getByText(/Hold The Crimson Stage at level 5/)).toBeTruthy();
  });

  it('draws them as ordinary rules once the roster carries them', () => {
    const held = [
      { id: 'spectacle', ...UNIT_RULES.spectacle },
      { id: 'papercut', ...UNIT_RULES.papercut },
    ];
    draw(<UnitCard unit={catalogueOption(dancer, held)} garrisoned={0} abroad={0} />);
    const marks = screen.getByTestId('marks-the_crimson_dancer');
    expect(marks.querySelector('[data-locked]')).toBeNull();
    expect(within(marks).getAllByText('Papercut')).toHaveLength(1);
  });
});
