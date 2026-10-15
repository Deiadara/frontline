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

  /*
   * The medic card prints every point a win is recovered on and the share the fight spends
   * (maintainer, 2026-10-15): the people's 12 and a level 10 Infirmary's 40 are 52 points.
   */
  it('prints the combined medic points and the share they walk home', () => {
    render(
      <ul>
        <ChannelCard
          channel="casualtyRecoveryPercent"
          amount={12}
          spent={{ medicPoints: 52 }}
          medicSharePercent={32.3}
        />
      </ul>,
    );
    const card = screen.getByTestId('channel-casualtyRecoveryPercent');
    expect(card).toHaveTextContent('+52');
    expect(screen.getByTestId('channel-medic-share')).toHaveTextContent(
      '32.3% of the dead walk home after a win',
    );
  });
});
