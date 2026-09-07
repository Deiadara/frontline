import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
