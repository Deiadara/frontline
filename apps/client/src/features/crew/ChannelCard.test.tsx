import { MAX_WAGE_DISCOUNT } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelCard } from './ChannelCard';

describe('a channel card', () => {
  /*
   * Attributes stopped feeding the crew's channels on 2026-10-04, so a chip naming a skill on this
   * card would point at something that moves nothing here.
   */
  it('names no attribute behind the figure', () => {
    render(
      <ul>
        <ChannelCard channel="unitMoraleFlat" amount={30} />
      </ul>,
    );
    const card = screen.getByTestId('channel-unitMoraleFlat');
    expect(card).toHaveTextContent('+30');
    expect(card).not.toHaveTextContent(/Composure/i);
    expect(card.querySelectorAll('[data-tip]')).toHaveLength(1);
  });

  it('prints the wage discount the contract actually takes, never past its ceiling', () => {
    render(
      <ul>
        <ChannelCard channel="wageDiscountPercent" amount={119} />
      </ul>,
    );
    expect(screen.getByTestId('channel-wageDiscountPercent')).toHaveTextContent(
      `+${MAX_WAGE_DISCOUNT}%`,
    );
  });
});
