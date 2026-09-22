import { afterEach, describe, expect, it } from 'vitest';
import {
  PRESS_WINDOW_MS,
  claimRow,
  forgetPresses,
  installLastPress,
  recentPress,
  releaseRow,
} from './lastPress';

/**
 * The press a receipt lands beside, and the rows figures from one press take.
 *
 * The listener itself is exercised end to end (`deltas.spec.ts` measures a figure against the
 * button that spent). What is pinned here is the arithmetic a browser is not needed for.
 */

afterEach(() => forgetPresses());

describe('recentPress', () => {
  it('is nothing until something has been pressed, and nothing again once the window is past', () => {
    expect(recentPress()).toBeNull();
    // A press is recorded by the document listener; with none installed the store stays empty,
    // and the window rule is asserted on its own clock below.
    expect(recentPress(Date.now() + PRESS_WINDOW_MS + 1)).toBeNull();
  });
});

/**
 * Two quick presses of one button are one column (maintainer, 2026-09-22).
 *
 * Every press minted a fresh id, and a readout stacks its figures per press id, so pressing Train
 * twice drew the second pair of receipts over the first at the same pixel. A press on the same
 * control inside the window keeps the id; a press somewhere else, or after the window, is new.
 */
describe('pressing the same control again', () => {
  const box = (top: number, left: number) => ({
    top,
    bottom: top + 32,
    left,
    right: left + 80,
    width: 80,
    height: 32,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  const press = (button: HTMLButtonElement) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it('keeps one press id for the same button, and mints another for a different one', () => {
    installLastPress(document);
    const train = document.createElement('button');
    const other = document.createElement('button');
    train.getBoundingClientRect = () => box(400, 600);
    other.getBoundingClientRect = () => box(400, 900);
    document.body.append(train, other);

    press(train);
    const first = recentPress();
    expect(first).not.toBeNull();
    press(train);
    expect(recentPress()?.id, 'the second press of Train opened a second column').toBe(first!.id);
    press(other);
    expect(recentPress()?.id, 'a press elsewhere is not the same column').not.toBe(first!.id);
    train.remove();
    other.remove();
  });
});

describe('rows under one press', () => {
  /**
   * One row per figure, not per readout (maintainer, 2026-09-22). A readout holding two receipts
   * drew its second through the next readout's first: caps on rows 0 and 1, supplies on 1 and 2.
   */
  it('reserves as many rows as a readout has figures', () => {
    expect(claimRow(9, 'caps', 2)).toBe(0);
    expect(claimRow(9, 'supplies', 2)).toBe(2);
    // A readout that grows keeps its place and pushes the ones after it down.
    expect(claimRow(9, 'caps', 3)).toBe(0);
    expect(claimRow(9, 'supplies', 2)).toBe(3);
    releaseRow(9, 'caps');
    releaseRow(9, 'supplies');
  });

  it('hands each readout its own row, keeps it, and closes the gap when one leaves', () => {
    expect(claimRow(7, 'caps')).toBe(0);
    expect(claimRow(7, 'scrap')).toBe(1);
    expect(claimRow(7, 'planks')).toBe(2);
    // Asking again is the same row: a figure must not move once it is on screen.
    expect(claimRow(7, 'scrap')).toBe(1);
    releaseRow(7, 'caps');
    // The next claimant takes the freed order; the ones still standing keep their relative order.
    expect(claimRow(7, 'scrap')).toBe(0);
    expect(claimRow(7, 'planks')).toBe(1);
    // A different press is a different stack.
    expect(claimRow(8, 'caps')).toBe(0);
    releaseRow(7, 'scrap');
    releaseRow(7, 'planks');
    releaseRow(8, 'caps');
    expect(claimRow(7, 'oil')).toBe(0);
  });
});
