import { AREA_REQUIREMENTS, noUnlocks, notorietyTier } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LockedDoor } from './LockedDoor';

/**
 * A shut door says what opens it and where you stand, and both halves name the same ladder.
 *
 * The maintainer's rule on 2026-09-22 was that a rank is a **name**, not an index: "rank 3" is a
 * number off a ladder nobody has the shape of, and the standing bar's chip says the name. That
 * landed on the line that says what opens the door and not on the line directly under it, so the
 * black market read `Opens at Back-Alley Rumored` over `You are at rank 0`: one ladder named two
 * ways, one of which is not a ladder the player has ever seen.
 */
function draw(area: Parameters<typeof LockedDoor>[0]['area'], notoriety: number) {
  render(
    <MemoryRouter>
      <LockedDoor area={area} facts={{ ...noUnlocks(), notoriety }} />
    </MemoryRouter>,
  );
}

describe('a locked door', () => {
  /** The black market is the one area gated on a rank, which is what makes it the case here. */
  const AREA = 'black_market';

  it('is a precondition that this door is gated on a rank at all', () => {
    expect(AREA_REQUIREMENTS[AREA].kind).toBe('notoriety');
  });

  it('names the rank that opens it and the rank you are on, never an index', () => {
    draw(AREA, 0);
    const sign = screen.getByTestId('locked-door');
    const wanted = AREA_REQUIREMENTS[AREA];
    if (wanted.kind !== 'notoriety') throw new Error('fixture: not a rank door');

    // Both names present...
    expect(sign).toHaveTextContent(notorietyTier(wanted.rank));
    expect(sign).toHaveTextContent(notorietyTier(0));
    // ...and no bare index anywhere on the sign. `rank 0` and `rank 3` are the two shapes the
    // regression produced; neither may come back.
    expect(sign.textContent ?? '').not.toMatch(/rank \d/i);
  });

  it('says the door should be open once the rank is held, rather than naming a distance', () => {
    const wanted = AREA_REQUIREMENTS[AREA];
    if (wanted.kind !== 'notoriety') throw new Error('fixture: not a rank door');
    draw(AREA, wanted.rank);
    expect(screen.getByTestId('locked-door-standing')).toHaveTextContent(/reload/i);
  });
});
