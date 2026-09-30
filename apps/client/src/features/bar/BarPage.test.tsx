import { describe, expect, it } from 'vitest';
import { resultLine } from './BarPage';

/**
 * The results panel's sentence for a table the crew led and could not take (bug pass, 2026-09-29).
 * With nobody behind them able to take the person either, it printed "so they went to the next bid
 * at ." with no name and no price.
 */
describe('a passed table, in one sentence', () => {
  const base = {
    day: '2026-08-13',
    recruitId: 'bar-2026-08-13-0-0',
    name: 'Zoya Lindqvist',
    outcome: 'passed' as const,
    yourFinal: 83,
  };

  it('says nobody took them when nobody did', () => {
    expect(resultLine({ ...base, price: null, winner: null })).toBe(
      'You were highest at 83 and could not take them. Nobody behind you could either.',
    );
  });

  it('names who took them, and for what, when somebody further down did', () => {
    expect(resultLine({ ...base, price: 75, winner: 'pass_c' })).toBe(
      'You were at 83 and could not take them, so they went to pass_c at 75.',
    );
  });
});
