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
});
