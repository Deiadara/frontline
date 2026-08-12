import { describe, expect, it } from 'vitest';
import { STARTING_INFAMY } from './meters.js';
import {
  FEARED_INFAMY,
  LIVE_REPUTATION_LABELS,
  RECKLESS_LOSSES,
  REPUTATION_LABELS,
  REPUTATION_LABEL_SPECS,
  RESPECTED_WINS,
  TALLY_HALF_LIFE_MS,
  decayTally,
  deriveReputation,
  recordRaidOutcome,
  startingTally,
  type ReputationTally,
} from './reputation.js';

const NOW = new Date('2026-08-13T09:30:00.000Z');
const tallyOf = (raidsWon: number, raidsLost: number): ReputationTally => ({
  updatedAt: NOW.toISOString(),
  raidsWon,
  raidsLost,
});

describe('the label set (§D8, §D8a)', () => {
  it('carries every label the board named, and nothing invented', () => {
    expect([...REPUTATION_LABELS]).toEqual([
      'Revolutionary',
      'Anti-systemic',
      'Hostile',
      'Cautious',
      'Opportunist',
      'Honorable',
      'Treacherous',
      'Collaborator',
      'Reckless',
      'Feared',
      'Respected',
    ]);
  });

  it('gives every label with no mechanic yet an explicit TODO-LATER naming what will drive it', () => {
    for (const label of REPUTATION_LABELS) {
      const { todo } = REPUTATION_LABEL_SPECS[label];
      if (todo === null) continue;
      expect(todo, label).toMatch(/^TODO-LATER: .+ — .+/);
    }
  });

  /*
   * The honesty check on §D8a: a `todo: null` claims a live mechanic can produce that label, so
   * the derivation must actually be able to return it — and a label still carrying a TODO-LATER
   * must not be reachable, or the marker is stale.
   */
  it('reaches exactly the labels it claims are live', () => {
    expect([...LIVE_REPUTATION_LABELS]).toEqual(['Cautious', 'Reckless', 'Feared', 'Respected']);

    const reachable = new Set([
      deriveReputation({ infamy: STARTING_INFAMY, tally: tallyOf(0, 0) }, NOW),
      deriveReputation({ infamy: FEARED_INFAMY, tally: tallyOf(0, 0) }, NOW),
      deriveReputation({ infamy: 0, tally: tallyOf(0, RECKLESS_LOSSES) }, NOW),
      deriveReputation({ infamy: 0, tally: tallyOf(RESPECTED_WINS, 0) }, NOW),
    ]);
    expect([...reachable].sort()).toEqual([...LIVE_REPUTATION_LABELS].sort());
  });
});

describe('deriveReputation', () => {
  it('calls an untested crew Cautious', () => {
    expect(
      deriveReputation({ infamy: STARTING_INFAMY, tally: startingTally(NOW.toISOString()) }, NOW),
    ).toBe('Cautious');
  });

  it('calls a winning crew Respected', () => {
    expect(deriveReputation({ infamy: 0, tally: tallyOf(RESPECTED_WINS, 0) }, NOW)).toBe(
      'Respected',
    );
  });

  it('calls a crew that loses more than it wins Reckless', () => {
    expect(deriveReputation({ infamy: 0, tally: tallyOf(1, RECKLESS_LOSSES) }, NOW)).toBe(
      'Reckless',
    );
  });

  it('does not call a crew Reckless while it is still winning more than it loses', () => {
    expect(deriveReputation({ infamy: 0, tally: tallyOf(20, RECKLESS_LOSSES) }, NOW)).toBe(
      'Respected',
    );
  });

  it('lets infamy outrank the raid record', () => {
    expect(
      deriveReputation({ infamy: FEARED_INFAMY, tally: tallyOf(RESPECTED_WINS, 0) }, NOW),
    ).toBe('Feared');
  });
});

describe('the §D8 drift', () => {
  it('halves the tally over one half-life', () => {
    const later = new Date(NOW.getTime() + TALLY_HALF_LIFE_MS);
    const decayed = decayTally(tallyOf(8, 4), later);

    expect(decayed.raidsWon).toBeCloseTo(4);
    expect(decayed.raidsLost).toBeCloseTo(2);
    expect(decayed.updatedAt).toBe(later.toISOString());
  });

  it('drops a Respected crew back to Cautious once it stops acting', () => {
    const tally = tallyOf(RESPECTED_WINS, 0);
    expect(deriveReputation({ infamy: 0, tally }, NOW)).toBe('Respected');

    const muchLater = new Date(NOW.getTime() + 4 * TALLY_HALF_LIFE_MS);
    expect(deriveReputation({ infamy: 0, tally }, muchLater)).toBe('Cautious');
  });

  it('never inflates the tally when the clock jumps backwards', () => {
    const earlier = new Date(NOW.getTime() - TALLY_HALF_LIFE_MS);
    expect(decayTally(tallyOf(8, 4), earlier)).toMatchObject({ raidsWon: 8, raidsLost: 4 });
  });
});

describe('recordRaidOutcome', () => {
  it('counts a win and a loss on the right side of the ledger', () => {
    const start = startingTally(NOW.toISOString());
    expect(recordRaidOutcome(start, 'attacker', NOW)).toMatchObject({ raidsWon: 1, raidsLost: 0 });
    expect(recordRaidOutcome(start, 'defender', NOW)).toMatchObject({ raidsWon: 0, raidsLost: 1 });
  });

  it('decays what is already on the books before adding to it', () => {
    const later = new Date(NOW.getTime() + TALLY_HALF_LIFE_MS);
    const recorded = recordRaidOutcome(tallyOf(4, 0), 'attacker', later);

    expect(recorded.raidsWon).toBeCloseTo(3);
    expect(recorded.updatedAt).toBe(later.toISOString());
  });
});
