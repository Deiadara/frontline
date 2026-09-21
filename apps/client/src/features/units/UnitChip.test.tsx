import {
  ENV_LABEL_CATALOG,
  UNIT_MODIFIERS,
  findUnit,
  type EnvLabelId,
  type UnitSpec,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UnitChip } from './UnitChip';
import { unitAffinities } from './UnitSheet';

/**
 * A chip is the only place most of the catalogue is ever drawn, and for the Combine's units it is
 * the *only* place: `PLAYER_UNITS` is what the roster is projected from, so a Suppressor has no
 * card, no page and no sheet anywhere else in the client. What the chip opens has to carry the
 * tactical half of its sheet or the counterplay the catalogue encodes is unreadable.
 *
 * Asserted against the catalogue rather than against pasted numbers: the sign is the claim
 * ("bring the fight into the fog"), and a test that hard-codes `-9%` goes quiet the day somebody
 * retunes the sheet, which is precisely the day it should speak up.
 */

/**
 * The card the chip opens, once it has been pointed at.
 *
 * Under a `QueryClientProvider` since 2026-09-20: the card is the roster's own now, and it asks
 * `/units` for this crew's fitted row before falling back to the catalogue. No fetch is stubbed,
 * so the query stays idle and the fallback is what every case below reads, which is the right
 * answer for a Combine sheet and the same numbers for a player's own.
 */
function openCard(unitId: string): HTMLElement {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <UnitChip unitId={unitId} count={3} data-testid={`force-${unitId}`} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.focus(screen.getByRole('button'));
  return screen.getByRole('tooltip');
}

/** One label this unit is measurably better on, and one it is worse on. */
function bothWays(sheet: UnitSpec) {
  const rows = unitAffinities(sheet);
  const helped = rows.find((row) => row.good);
  const hurt = rows.find((row) => !row.good);
  if (!helped || !hurt) throw new Error(`${sheet.id} needs a sheet cutting both ways`);
  return { helped, hurt };
}

/** This sheet's row for one named label, which is how a claim about fog stays a claim about fog. */
function rowFor(sheet: UnitSpec, id: EnvLabelId) {
  const row = unitAffinities(sheet).find((candidate) => candidate.id === id);
  if (!row) throw new Error(`${sheet.id} says nothing about ${id}`);
  return row;
}

describe('the sheet behind a unit chip', () => {
  it('keeps the chip and its handle untouched until it is pointed at', () => {
    render(<UnitChip unitId="suppressor" count={7} data-testid="force-suppressor" />);

    const chip = screen.getByTestId('force-suppressor');
    expect(chip).toHaveTextContent('Suppressor');
    expect(chip).toHaveTextContent('7');
    expect(screen.queryByRole('tooltip'), 'nothing opens on its own').toBeNull();
  });

  it("opens a Combine unit's sheet, its modifiers, and which ground cuts which way", () => {
    const sheet = findUnit('suppressor')!;
    const card = openCard('suppressor');

    expect(card).toHaveTextContent('Suppressor');
    expect(card).toHaveTextContent('The Combine');
    for (const id of sheet.modifiers) {
      expect(card, `the ${id} modifier`).toHaveTextContent(UNIT_MODIFIERS[id].label);
    }

    /*
     * The whole point: open ground is where this one wants to be and fog is where it comes apart.
     *
     * Read off the roster card's own marks band (`marks-<id>`) since 2026-09-20, because that is
     * the card a chip opens now. The rate moved with it: on this template a characteristic is a
     * chip and the `+9% per tier` is on the chip's own hover, which is the same place the roster
     * has always kept it.
     */
    const rows = within(card).getByTestId('marks-suppressor');
    const helped = rowFor(sheet, 'open');
    const hurt = rowFor(sheet, 'foggy');
    expect(helped.good, 'open ground is a Suppressor strength').toBe(true);
    expect(hurt.good, 'fog is what beats one').toBe(false);
    expect(rows).toHaveTextContent(ENV_LABEL_CATALOG.open.name);
    expect(rows).toHaveTextContent(ENV_LABEL_CATALOG.foggy.name);
  });

  it("reads a player's own unit the same way", () => {
    const sheet = findUnit('snipers')!;
    const card = openCard('snipers');

    expect(card).toHaveTextContent('Snipers');
    for (const id of sheet.modifiers) {
      expect(card, `the ${id} modifier`).toHaveTextContent(UNIT_MODIFIERS[id].label);
    }

    const { helped, hurt } = bothWays(sheet);
    const rows = within(card).getByTestId('marks-snipers');
    expect(rows).toHaveTextContent(helped.label);
    expect(rows).toHaveTextContent(hurt.label);
    expect(helped.note.startsWith('+'), `${helped.label} helps, so it is signed`).toBe(true);
    expect(hurt.note.startsWith('-'), `${hurt.label} hurts, so it is signed`).toBe(true);
    // ...and each chip is a control that says which way it cuts, which is what the press is for.
    fireEvent.focus(within(rows).getByRole('button', { name: `${helped.label}: ${helped.note}` }));
    expect(screen.getAllByRole('tooltip').at(-1)).toHaveTextContent('fight better');
  });

  /**
   * The press, which is the half a hover cannot do (maintainer, 2026-09-20).
   *
   * "Make it everywhere clickable and have it open up a tab of the unit if you click and you have
   * an X on the top to close it and be where you were." A `HoverCard`'s card is portalled
   * `pointer-events-none`, so every chip on the sheet it opens was a word nothing could reach. The
   * dialog is the same card somewhere a pointer can go.
   */
  it('opens the same card as a window on a press, and closes on the cross', () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <UnitChip unitId="snipers" count={3} data-testid="force-snipers" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('unit-window'), 'nothing opens on its own').toBeNull();

    fireEvent.click(screen.getByRole('button'));
    const window_ = screen.getByTestId('unit-window');
    // The same template the roster draws, by its own id, not a second layout that resembles it.
    expect(within(window_).getByTestId('unit-snipers')).toBeInTheDocument();

    // ...and the chips inside it answer, which is the whole reason the window exists.
    const mark = within(window_).getByTestId('marks-snipers');
    const chip = within(mark).getAllByRole('button')[0]!;
    fireEvent.focus(chip);
    expect(screen.getAllByRole('tooltip').length).toBeGreaterThan(0);

    fireEvent.click(within(window_).getByTestId('modal-close'));
    expect(screen.queryByTestId('unit-window'), 'the cross did not shut it').toBeNull();
  });

  it('draws no trigger for an id the catalogue has never heard of', () => {
    render(<UnitChip unitId="not_a_unit" count={1} data-testid="force-ghost" />);

    expect(screen.getByTestId('force-ghost')).toHaveTextContent('not_a_unit');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the card the caller passes instead, where the screen knows more than the sheet', () => {
    render(
      <UnitChip
        unitId="suppressor"
        count={2}
        card={<p>On this ground</p>}
        data-testid="force-suppressor"
      />,
    );
    fireEvent.focus(screen.getByRole('button'));

    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('On this ground');
    expect(screen.queryByTestId('unit-affinities-suppressor')).toBeNull();
  });
});
