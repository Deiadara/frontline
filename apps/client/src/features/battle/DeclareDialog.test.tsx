import type { BattleTarget } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeclareDialog } from './DeclareDialog';

/**
 * The mark a declaration posts has to be one the board still offers.
 *
 * `slots` is re-read every few seconds and the first mark drops off the list the minute it passes.
 * The chosen mark was seeded once from `slots[0]` and never reconciled, so a dialog left open across
 * that minute highlighted nothing and still posted the mark that had just expired.
 */
const target: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};
const EARLY = '2026-08-13T22:30:00.000Z';
const LATE = '2026-08-14T06:30:00.000Z';

function open(slots: readonly string[]) {
  const onConfirm = vi.fn();
  const view = render(
    <DeclareDialog
      target={target}
      targetName="Kessler Press"
      slots={slots}
      pending={false}
      error={null}
      onClose={() => undefined}
      onConfirm={onConfirm}
    />,
  );
  const rerender = (next: readonly string[]) =>
    view.rerender(
      <DeclareDialog
        target={target}
        targetName="Kessler Press"
        slots={next}
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );
  return { onConfirm, rerender };
}

describe('which mark is called', () => {
  it('follows the board when the mark it opened on expires', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    rerender([LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE, false);
  });

  it('lets go of a mark the player picked once the board no longer offers it', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    fireEvent.click(screen.getByTestId(`slot-${EARLY}`));
    rerender([LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE, false);
  });

  it('keeps a mark the player picked for as long as the board offers it', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    fireEvent.click(screen.getByTestId(`slot-${LATE}`));
    rerender([EARLY, LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE, false);
  });
});
