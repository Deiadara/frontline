import { ASSIGNEE_BONUS_PERCENT } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { percent } from './AssigneesPage';

/**
 * §G7's table is the only place in the game with a fractional percentage, so the readout has to
 * cope with both shapes: `14.5%` must keep its half, and `19%` must not grow a `.0`.
 */
describe('percent', () => {
  it('keeps a half and never pads a whole number', () => {
    expect(percent(14.5)).toBe('14.5%');
    expect(percent(19)).toBe('19%');
    expect(percent(0)).toBe('0%');
    expect(percent(50)).toBe('50%');
  });

  it('renders every row of the §G7 table without a trailing zero', () => {
    for (const value of ASSIGNEE_BONUS_PERCENT) {
      expect(percent(value)).not.toMatch(/\.0%$/);
      expect(percent(value)).toBe(`${value}%`);
    }
  });
});
