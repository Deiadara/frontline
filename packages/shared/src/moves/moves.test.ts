import { describe, expect, it } from 'vitest';
import {
  MOVE_GATE_MINUTES,
  moveRecallWindowMs,
  moveRecallable,
  moveRecalledReturnsAt,
  samePlace,
} from './moves.js';

describe('places', () => {
  it('tells the district, the gate and two locations apart', () => {
    expect(samePlace({ kind: 'district' }, { kind: 'district' })).toBe(true);
    expect(samePlace({ kind: 'district' }, { kind: 'gate' })).toBe(false);
    expect(
      samePlace({ kind: 'location', locationId: 'a' }, { kind: 'location', locationId: 'a' }),
    ).toBe(true);
    expect(
      samePlace({ kind: 'location', locationId: 'a' }, { kind: 'location', locationId: 'b' }),
    ).toBe(false);
  });
});

describe('turning a column round', () => {
  const departedAt = '2026-09-22T10:00:00.000Z';
  const move = { departedAt, travelMinutes: MOVE_GATE_MINUTES, recalledAt: null };

  it('is open for the first tenth of the walk and shut after it', () => {
    const early = new Date('2026-09-22T10:00:30.000Z');
    const late = new Date('2026-09-22T10:01:30.000Z');
    expect(moveRecallable(move, early)).toBe(true);
    expect(moveRecallWindowMs(move, early)).toBe(30_000);
    expect(moveRecallable(move, late)).toBe(false);
    expect(moveRecallWindowMs(move, late)).toBe(0);
  });

  it('is shut once turned, and the walk home is as long as the walk out was', () => {
    const now = new Date('2026-09-22T10:00:40.000Z');
    expect(moveRecallable({ ...move, recalledAt: now.toISOString() }, now)).toBe(false);
    expect(moveRecalledReturnsAt(move, now).toISOString()).toBe('2026-09-22T10:01:20.000Z');
  });
});
