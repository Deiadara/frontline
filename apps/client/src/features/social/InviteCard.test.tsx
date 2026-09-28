import { DEFAULT_BADGE, type MessageInvite } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Joining a faction needs level 10, the level the Faction screen opens at (maintainer,
 * 2026-09-28), and the server refuses below it. The card says so before the button is pressed.
 */
const level = vi.hoisted(() => ({ value: 1 }));
vi.mock('../../lib/queries', () => ({
  useAnswerFactionInvite: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../../lib/unlocks', () => ({
  useUnlockFacts: () => ({
    level: level.value,
    buildings: [],
    officers: [],
    notoriety: 0,
    technologies: [],
  }),
}));

const { InviteCard } = await import('./InviteCard');

const INVITE: MessageInvite = {
  inviteId: 'invite-1',
  factionId: 'faction-1',
  factionName: 'Ash Wardens',
  badge: DEFAULT_BADGE,
  open: true,
};

describe('an invitation below the Faction door', () => {
  it('shuts the Join button under level 10 and says why', () => {
    level.value = 9;
    render(<InviteCard invite={INVITE} />);
    expect(screen.getByTestId('invite-accept')).toBeDisabled();
    expect(screen.getByTestId('invite-locked')).toHaveTextContent('level 10');
    expect(screen.getByTestId('invite-decline')).toBeEnabled();
  });

  it('opens it at level 10', () => {
    level.value = 10;
    render(<InviteCard invite={INVITE} />);
    expect(screen.getByTestId('invite-accept')).toBeEnabled();
    expect(screen.queryByTestId('invite-locked')).toBeNull();
  });
});
