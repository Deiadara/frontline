import type { FactionMember } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { MemberFace } from './MemberFace';
import { Roster } from './Roster';

/**
 * Whose face is on a faction member (maintainer request, 2026-09-13).
 *
 * The roster drew the seat's card and the member window drew `MemberSigil`, a drawing of a
 * stranger in goggles hashed off the account id, while the crew's file one click away showed the
 * painting of the same person. `FactionMemberSchema` carries `portraitId` now and both sites draw
 * it.
 *
 * The fallback is tested as hard as the swap, because it is the branch nobody will look at: an
 * account with no Overseer has no portrait, and a roster that throws on that row takes the table
 * down for the other four.
 */

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

const SEATED = F.factionScreen.members[0];
if (!SEATED) throw new Error('the faction fixture seats nobody');

/**
 * A seated member with a known portrait.
 *
 * Built here rather than taken from the shared e2e fixture: that fixture belongs to another
 * screen's owner and its members may or may not carry the new field yet, and a test of *this*
 * swap must not pass or fail on that.
 */
const withPortrait = (portraitId: string | null): FactionMember => ({
  ...SEATED,
  portraitId,
  overseerName: portraitId === null ? null : 'Marcus "Bulwark" Kane',
});

const paintedImages = () =>
  [...document.querySelectorAll('img')].filter(
    (el) => el.getAttribute('src') === '/assets/portrait-overseer-2.webp',
  );

beforeEach(() => {
  deliveredUrl.mockClear().mockReturnValue('/assets/portrait-overseer-2.webp');
});

describe('MemberFace', () => {
  it('draws their Overseer, addressed by the id the row carries', () => {
    render(<MemberFace member={withPortrait('overseer-2')} size="lg" />);
    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'portrait', portraitId: 'overseer-2' });
    expect(paintedImages()).toHaveLength(1);
    expect(screen.queryByRole('img', { name: `${SEATED.username}, drawn` })).toBeNull();
  });

  it('falls back to the drawing for an account that never chose an Overseer', () => {
    render(<MemberFace member={withPortrait(null)} size="lg" />);
    expect(paintedImages()).toHaveLength(0);
    expect(screen.getByRole('img', { name: `${SEATED.username}, drawn` })).toBeInTheDocument();
    expect(deliveredUrl, 'a null id must never reach the art loader').not.toHaveBeenCalled();
  });

  it('frames the big one and plates the small one', () => {
    const big = render(<MemberFace member={withPortrait('overseer-2')} size="lg" />);
    expect(big.container.querySelector('[data-testid="portrait-frame"]')).not.toBeNull();
    big.unmount();

    const small = render(<MemberFace member={withPortrait('overseer-2')} size="sm" />);
    expect(small.container.querySelector('[data-testid="portrait-frame"]')).toBeNull();
  });

  /**
   * A roster row is a `HoverCard` trigger, which is a real `<button>`, and a button may hold
   * phrasing content only. A `<div>` anywhere under it is markup no validator accepts and the
   * browser silently repairs, which is exactly the kind of thing that renders fine and is still
   * wrong. So the small face is spans and images all the way down.
   */
  it('puts no block element inside the roster row, which is a button', () => {
    const { container } = render(
      <Roster
        members={[withPortrait('overseer-2')]}
        myUserId="somebody-else"
        onOpenMember={vi.fn()}
      />,
    );
    const trigger = container.querySelector('button');
    expect(trigger, 'the roster row is not a button any more').not.toBeNull();
    expect([...(trigger?.querySelectorAll('div') ?? [])]).toEqual([]);
    expect(paintedImages()).toHaveLength(1);
  });
});
