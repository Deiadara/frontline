import { makeAttributes } from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttributeSheet } from './AttributeSheet';

/**
 * §B7: a figure that is partly somebody else's has to say so on the card.
 *
 * The crew's teaching perks, the ground it holds and the Lab all raise an officer's attributes, and
 * every one of those was folded into the fight and into nothing a player could see: the card printed
 * the number on the contract while the game used a different one. The maintainer's rule (2026-09-16)
 * is that the bar runs to the lifted figure, is cut by a line where the person's own ends, and says
 * on hover where the rest came from.
 */
describe('an officer lifted by the room', () => {
  const own = makeAttributes(20);
  const lifted = makeAttributes(20, { intimidation: 22 });

  const sheet = () =>
    render(
      <AttributeSheet
        attributes={own}
        lifted={lifted}
        lift={[{ attribute: 'intimidation', from: 'your Overseer', amount: 2 }]}
        role="raid_boss"
      />,
    );

  it('prints the figure the crew actually fields, not the one on the contract', () => {
    sheet();
    const row = screen.getByTestId('attr-intimidation');
    expect(within(row).getByText('22')).toBeInTheDocument();
  });

  it('marks where the person ends and the room begins', () => {
    const { container } = sheet();
    const mark = container.querySelector('[data-testid="attr-base-mark-intimidation"]');
    expect(mark, 'the bar runs to 22 with no sign which 2 are not theirs').not.toBeNull();
    // 20 of 100: the seam sits at the person's own share of the track, pulled back by half its
    // own width so the line straddles the boundary rather than starting after it.
    expect(mark).toHaveStyle({ left: 'calc(20% - 1px)' });
  });

  it('says where the difference came from, and what the person brought', () => {
    sheet();
    const tip = screen.getByTestId('attr-intimidation').getAttribute('data-tip') ?? '';
    expect(tip).toContain('20 base');
    expect(tip).toContain('+2 from your Overseer');
  });

  it('leaves an unlifted row alone, which is every row at the Bar', () => {
    const { container } = render(<AttributeSheet attributes={own} role="raid_boss" />);
    expect(container.querySelector('[data-testid^="attr-base-mark-"]')).toBeNull();
    const row = screen.getByTestId('attr-intimidation');
    expect(within(row).getByText('20')).toBeInTheDocument();
    // The chair's own line is still the tip, and it has not grown a stray full stop.
    expect(row.getAttribute('data-tip')).not.toContain('base');
  });
});
