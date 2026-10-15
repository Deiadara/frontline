import { FACTION_CARD_SPECS } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { factionScreen } from '../../../e2e/fixtures';
import { MemberWindow } from './MemberWindow';

/** The leader seats the table (maintainer ruling P3-C, 2026-10-02); nobody else can. */
describe('a member’s seat', () => {
  const member = factionScreen.members[1] ?? factionScreen.members[0]!;
  const open = (rank: 'leader' | 'member', onSeat = vi.fn()) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemberWindow
          member={member}
          data={{ ...factionScreen, rank }}
          isSelf={false}
          pending={false}
          onAction={vi.fn()}
          onSeat={onSeat}
          onLeave={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    return onSeat;
  };

  it('lets the leader move them to another card', async () => {
    const onSeat = open('leader');
    fireEvent.click(screen.getByTestId(`seat-${member.username}`));
    const other = member.card === 'joker' ? 'queen_hearts' : 'joker';
    fireEvent.click(
      await screen.findByRole('option', { name: new RegExp(FACTION_CARD_SPECS[other].name) }),
    );
    expect(onSeat).toHaveBeenCalledWith(other);
  });

  it('shows nobody but the leader the seat control', () => {
    open('member');
    expect(screen.queryByTestId('member-seat')).toBeNull();
  });

  /*
   * Onboarding (maintainer, 2026-10-15): a seat whose holder changed in the last twelve hours is
   * locked, greyed with the time left, and a card held by somebody still onboarding is not offered.
   */
  it('locks a seat in Onboarding and says how long is left', () => {
    const until = new Date(Date.now() + 5 * 3_600_000 - 60_000).toISOString();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemberWindow
          member={{ ...member, onboardingUntil: until }}
          data={{ ...factionScreen, rank: 'leader' }}
          isSelf={false}
          pending={false}
          onAction={vi.fn()}
          onSeat={vi.fn()}
          onLeave={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(`seat-reason-${member.username}`)).toHaveTextContent(
      'Onboarding, 5h left: this seat is locked',
    );
    expect(screen.getByTestId(`seat-${member.username}`)).toBeDisabled();
  });
});
