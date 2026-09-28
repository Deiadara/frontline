import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findUnitModification, type UnitLoadouts } from '@frontline/shared';
import { ForcePicker } from './ForcePicker';

/**
 * The bag the picker quotes is the bag the raid pays: with the crew's brackets folded in.
 *
 * `lootCapacityOf` took a loadouts argument the day the carry cards landed and the server passes
 * it; the picker went on quoting the bare sheet, so a Hook and Line on the Razors added twelve
 * slots to the pay and nothing to the quote. Five Razors, once bare and once fitted, must differ by
 * exactly five cards' worth.
 */
describe('what the picker says the force can carry', () => {
  const quote = (loadouts: UnitLoadouts | undefined): number => {
    const { unmount } = render(
      <ForcePicker
        title="Raid the Press"
        blurb="Who goes."
        army={{ razors: 5 }}
        {...(loadouts === undefined ? {} : { loadouts })}
        pending={false}
        error={null}
        confirmLabel="Go"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('How many Razors'), { target: { value: '5' } });
    const line = screen.getByText('Can carry').parentElement!.textContent ?? '';
    unmount();
    return Number(/(\d+) loot/.exec(line)?.[1]);
  };

  it('counts the brackets in, as the raid does', () => {
    const bare = quote(undefined);
    const fitted = quote({ razors: ['hook_and_line', null, null] });
    const card = findUnitModification('hook_and_line')!;
    expect(fitted - bare).toBe(5 * (card.effect.lootCapacity ?? 0));
    expect(card.effect.lootCapacity, 'the fixture card must move the bag').toBeGreaterThan(0);
  });
});

/**
 * The odds the picker quotes are the odds of the line the crew actually fields.
 *
 * Same defect as the carry quote above, one panel along, and it reverses the answer rather than
 * shading it: `resolve.ts` hands the engine `attackerUpgrades: attacker.unitLoadouts` and the
 * forecast here passed none, so a crew who had spent the yard's output on their line was shown
 * the odds of the line they did not build. Measured on the shared engine on 2026-09-25: forty
 * Razors against the eighteen Wardens this screen estimates forecast at 0% bare and 77% with three
 * common cards fitted, which is the difference between "this is not a fight, it is a delivery" and
 * "the odds are with you" on the very same plan.
 *
 * Asserted as a difference between two readings rather than against a recomputed number: working
 * the expected band out here with the same function the component calls would pass whether or not
 * the component passed the cards at all.
 */
describe('what the picker says the odds are', () => {
  const band = (loadouts: UnitLoadouts | undefined): string => {
    const { unmount } = render(
      <ForcePicker
        title="Raid the Press"
        blurb="Who goes."
        army={{ razors: 40 }}
        facingSize={18}
        {...(loadouts === undefined ? {} : { loadouts })}
        pending={false}
        error={null}
        confirmLabel="Go"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('How many Razors'), { target: { value: '40' } });
    const said = screen.getByTestId('odds').textContent ?? '';
    unmount();
    return said;
  };

  it('reads better for a crew whose units are wearing their cards', () => {
    // Three cards the Scrapyard cuts early, on the one unit going. Read off the catalogue so a
    // retune moves the fixture with it rather than leaving it pointing at a card that is gone.
    const fitted: UnitLoadouts = {
      razors: ['taped_grips', 'scrap_vest', 'knuckle_guards'].filter(
        (id) => findUnitModification(id) !== undefined,
      ),
    };
    expect(fitted.razors?.length, 'the fixture cards are not in the catalogue any more').toBe(3);

    const bare = band(undefined);
    const wearing = band(fitted);
    expect(bare, 'the picker drew no odds at all').not.toBe('');
    expect(
      wearing,
      'fitting three cards to the whole line moved nothing: the forecast is ignoring them',
    ).not.toBe(bare);
  });
});
