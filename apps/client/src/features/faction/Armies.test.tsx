import type { FactionMember } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { Armies } from './Armies';

/**
 * Whose face is on a fielded row (maintainer, 2026-10-15): the Overseer's painting, the same one
 * the members window and the member's file draw, and the drawn sigil only where there is none.
 */

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

const SEATED = F.factionScreen.members[0];
if (!SEATED) throw new Error('the faction fixture seats nobody');

const member = (portraitId: string | null): FactionMember => ({ ...SEATED, portraitId });
const army = {
  memberUserId: SEATED.userId,
  memberName: SEATED.username,
  army: { razors: 3 },
  size: 3,
};

beforeEach(() => {
  deliveredUrl.mockClear().mockReturnValue('/assets/portrait-overseer-2.webp');
});

describe('the fielded window', () => {
  it('draws the member’s own portrait on their row', () => {
    render(
      <Armies armies={[army]} members={[member('overseer-2')]} myUserId="x" onClose={() => {}} />,
    );
    expect(screen.getByTestId(`member-face-${SEATED.username}`).getAttribute('data-face')).toBe(
      'overseer-2',
    );
  });

  it('falls back to the drawn sigil with no portrait, and for a row the table no longer lists', () => {
    const { unmount } = render(
      <Armies armies={[army]} members={[member(null)]} myUserId="x" onClose={() => {}} />,
    );
    expect(screen.getByTestId(`member-face-${SEATED.username}`).getAttribute('data-face')).toBe(
      'none',
    );
    unmount();
    render(<Armies armies={[army]} members={[]} myUserId="x" onClose={() => {}} />);
    expect(screen.getByTestId(`member-face-${SEATED.username}`).getAttribute('data-face')).toBe(
      'none',
    );
  });
});
