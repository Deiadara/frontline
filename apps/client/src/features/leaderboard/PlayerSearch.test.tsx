import type { PlayerStanding } from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PlayerSearch } from './PlayerSearch';

/**
 * The keyboard on the standings search, against a board that moves underneath it.
 *
 * The page's own tests cover the wiring with one fixed board. What is checked here is the case
 * that fixture cannot reach: the rows change while the list is open. The standings refetch on
 * window focus after thirty seconds (`main.tsx`), so a reader who arrowed into the list, looked
 * away while somebody else fought, and looked back is reading a shorter list than the one they
 * were pointing into.
 */

const row = (username: string, rank: number): PlayerStanding => ({
  rank,
  userId: `user-${username}`,
  username,
  districtId: 'rustyard',
  cityId: 'ashfall',
  districtName: 'The Scrap Line',
  level: 4,
  infamy: 100,
  totalInfamy: 100,
  notoriety: 0,
  factionId: null,
  factionName: null,
  factionBadge: null,
  isBot: false,
});

/** Five crews whose names all answer to `n`, which is what fills the list to its limit of five. */
const FULL = ['Nine', 'Nolan', 'Nurse', 'Nadir', 'Nomad'].map((name, index) =>
  row(name, index + 1),
);
/** The same board after two of them are gone, which is what a refetch can hand back. */
const SHORT = [FULL[0]!, FULL[1]!];

function open(entries: readonly PlayerStanding[]) {
  const view = render(
    <MemoryRouter>
      <PlayerSearch entries={entries} query="n" onQuery={() => undefined} />
    </MemoryRouter>,
  );
  const rerender = (next: readonly PlayerStanding[]) =>
    view.rerender(
      <MemoryRouter>
        <PlayerSearch entries={next} query="n" onQuery={() => undefined} />
      </MemoryRouter>,
    );
  return { rerender };
}

/** Which suggestion is highlighted, by name, read off the ARIA the screen reader is given. */
function highlighted(): string {
  const picked = within(screen.getByTestId('standings-suggestions'))
    .getAllByRole('option')
    .find((option) => option.getAttribute('aria-selected') === 'true');
  return picked?.textContent ?? '(none)';
}

const press = (key: string) => fireEvent.keyDown(screen.getByTestId('standings-search'), { key });

describe('walking a list that changed underneath the reader', () => {
  /*
   * The arrows used to step from `active`, the unclamped index, rather than from `at`, the one
   * actually drawn. Once the list got shorter than `active` the two came apart and the modulo
   * landed back where it started: with `active` 4 on a list of 2, down is `(4 + 1 + 2) % 2 = 1`
   * and up is `(4 - 1 + 2) % 2 = 1`, so *both* arrows left the highlight on the last row. The
   * keyboard was dead until the reader typed another letter.
   */
  it('keeps stepping after the board shrinks under an open list', () => {
    const { rerender } = open(FULL);
    for (let step = 0; step < 4; step++) press('ArrowDown');
    expect(highlighted()).toContain('Nomad');

    rerender(SHORT);
    // The highlight falls back to the last row there is, which is what the clamp is for.
    expect(highlighted()).toContain('Nolan');

    press('ArrowDown');
    expect(highlighted()).toContain('Nine');
    press('ArrowUp');
    expect(highlighted()).toContain('Nolan');
  });

  /** And enter opens whoever is highlighted now, not a row that is no longer on the board. */
  it('leaves the highlight on a row that is still there', () => {
    const { rerender } = open(FULL);
    press('ArrowDown');
    press('ArrowDown');
    expect(highlighted()).toContain('Nurse');

    rerender(SHORT);
    expect(screen.queryByTestId('standings-suggestion-Nurse')).toBeNull();
    expect(highlighted()).toContain('Nolan');
  });
});
