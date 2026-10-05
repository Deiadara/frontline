import type { FactionMember } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { factionScreen } from '../../e2e/fixtures';
import { LeaveDialog } from './LeaveDialog';

/**
 * Walking out of a faction (maintainer, 2026-09-30): a leader with people at the table is warned
 * and may name who leads after them, and may still disband it instead. The fixture's player leads
 * a table of two.
 */
const self = factionScreen.members.find((member) => member.rank === 'leader')!;
const heir = factionScreen.members.find((member) => member.userId !== self.userId)!;

function open(faction = factionScreen, selfId = self.userId) {
  const onConfirm = vi.fn();
  render(
    <LeaveDialog
      faction={faction}
      selfId={selfId}
      title="This ends the faction"
      body="It is disbanded the moment you go."
      confirm={(picked: FactionMember | null) =>
        picked ? `Leave it to ${picked.username}` : 'Leave and disband it'
      }
      testId="confirm-leave"
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  );
  return onConfirm;
}

describe('the leave dialog', () => {
  it('opens on disbanding, and a leader may still just do that', () => {
    const onConfirm = open();
    expect(screen.getByTestId('confirm-leave-heir-none').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('confirm-leave-yes').textContent).toBe('Leave and disband it');
    fireEvent.click(screen.getByTestId('confirm-leave-yes'));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('hands it to the member picked, and says who leads', () => {
    const onConfirm = open();
    // Everybody else at the table is offered, and the leader is not offered to themselves.
    expect(screen.queryByTestId(`confirm-leave-heir-${self.username}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`confirm-leave-heir-${heir.username}`));
    expect(screen.getByTestId('confirm-leave-outcome').textContent).toContain(
      `${heir.username} leads`,
    );
    expect(screen.getByTestId('confirm-leave-yes').textContent).toBe(
      `Leave it to ${heir.username}`,
    );
    fireEvent.click(screen.getByTestId('confirm-leave-yes'));
    expect(onConfirm).toHaveBeenCalledWith(heir.userId);
  });

  it('asks a chief nothing but whether to go', () => {
    open({ ...factionScreen, rank: 'chief' }, self.userId);
    expect(screen.getByTestId('confirm-leave')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('offers no picker to a leader with nobody else at the table', () => {
    open({ ...factionScreen, members: [self] });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
