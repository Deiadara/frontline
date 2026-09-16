import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findUnitModification, type UnitLoadouts } from '@frontline/shared';
import { ForcePicker } from './ForcePicker';

/**
 * Units left on a location have to be able to come home.
 *
 * `POST /city/garrison` takes signed deltas and the server's withdrawal branch has always been
 * live, but the only control that called it counted from zero over the *home* roster: no row could
 * go below nothing, and a unit posted to a location came back only if the location fell. Given
 * who is already standing there, a row goes down to minus that many, and a negative number is the
 * order to bring them back.
 */
const picker = (army: Record<string, number>, standing: Record<string, number>) => {
  const onConfirm = vi.fn();
  render(
    <ForcePicker
      title="Garrison the Press"
      blurb="Who stands here."
      army={army}
      standing={standing}
      pending={false}
      error={null}
      confirmLabel="Leave them"
      onClose={() => undefined}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
};

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
        standing={{}}
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

describe('bringing a garrison home', () => {
  it('offers a row for a unit the crew has none of at home but three of on the ground', () => {
    const onConfirm = picker({}, { razors: 3 });
    const field = screen.getByLabelText('How many Razors');
    expect(field).toHaveAttribute('min', '-3');
    expect(field).toHaveAttribute('max', '0');

    fireEvent.change(field, { target: { value: '-2' } });
    expect(screen.getByText('Bringing back')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(onConfirm).toHaveBeenCalledWith({ razors: -2 });
  });

  it('will not bring back more than are there, and still sends from home in the same order', () => {
    const onConfirm = picker({ razors: 4 }, { razors: 1 });
    const field = screen.getByLabelText('How many Razors');
    fireEvent.change(field, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(onConfirm).toHaveBeenLastCalledWith({ razors: -1 });

    fireEvent.change(field, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(onConfirm).toHaveBeenLastCalledWith({ razors: 3 });
  });

  it('has nothing to confirm with nobody chosen either way', () => {
    picker({ razors: 4 }, { razors: 1 });
    expect(screen.getByRole('button', { name: 'Leave them' })).toBeDisabled();
  });
});
