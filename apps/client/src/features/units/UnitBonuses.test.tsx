import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { UnitBonuses } from './UnitBonuses';

/**
 * A unit's own Bonuses page on the supplies line (2026-10-01).
 *
 * The supplies-only points taper in the room the cost cut leaves on the line, so a unit whose own
 * ground raises its cost cut gets a little less from them. The server sends that as one line on
 * the unit (`homeBonus.supplies`), and the page has to add it to the crew's lines or its total is
 * not the unit's bill.
 */
describe("a unit's supplies section", () => {
  const crew = {
    cost: [{ source: 'Unit Costing', note: 'The Lab', percent: 8 }],
    supplies: [
      { source: 'The Greenhouse', note: 'Level 10', percent: 5 },
      { source: 'Tapering', note: 'Toward 70% off, with the cost cut', percent: -0.5 },
    ],
    speed: [],
  };
  const unit = F.unitsResponse.units[0]!;

  it("adds the unit's own supplies line to the crew's", () => {
    render(
      <UnitBonuses
        unit={{
          ...unit,
          homeBonus: {
            cost: [{ source: 'The Doghouse', note: 'Level 6', percent: 10 }],
            speed: [],
            supplies: [{ source: 'Its own ground', note: 'Less room', percent: -0.3 }],
          },
        }}
        crew={crew}
      />,
    );
    expect(screen.getByTestId('unit-bonuses-total-supplies')).toHaveTextContent('4.2%');
    expect(screen.getByText('Its own ground')).toBeInTheDocument();
  });

  it("is the crew's figure for a unit with no ground of its own", () => {
    const { homeBonus: _none, ...plain } = unit;
    render(<UnitBonuses unit={plain} crew={crew} />);
    expect(screen.getByTestId('unit-bonuses-total-supplies')).toHaveTextContent('4.5%');
  });
});
