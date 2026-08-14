import { describe, expect, it } from 'vitest';
import { STARTING_INFAMY } from './meters.js';
import { PAY_WEEK_MS } from './payroll.js';
import {
  ANTI_SYSTEMIC_ACTIONS,
  COLLABORATOR_CONTRACTS,
  FEARED_INFAMY,
  HONORABLE_PAYDAYS,
  LIVE_REPUTATION_LABELS,
  OPPORTUNIST_JOBS_EACH_WAY,
  RECKLESS_LOSSES,
  REPUTATION_LABELS,
  REPUTATION_LABEL_SPECS,
  RESPECTED_WINS,
  REVOLUTIONARY_SEATS,
  TREACHEROUS_MISSED_PAYDAYS,
  ReputationTallySchema,
  TALLY_COUNTERS,
  TALLY_HALF_LIFE_MS,
  decayTally,
  deriveReputation,
  recordMissionOutcome,
  recordPayrollOutcome,
  recordRaidOutcome,
  startingTally,
  type RaidTarget,
  type ReputationTally,
} from './reputation.js';

const NOW = new Date('2026-08-13T09:30:00.000Z');

/** A tally with only the raid record on it — the pre-W10 shape, spelled out. */
const tallyOf = (raidsWon: number, raidsLost: number): ReputationTally => ({
  ...startingTally(NOW.toISOString()),
  raidsWon,
  raidsLost,
});

/** A tally with only the §D8 government stance counters on it. */
const stanceOf = (parts: Partial<ReputationTally>): ReputationTally => ({
  ...startingTally(NOW.toISOString()),
  ...parts,
});

const COMBINE_OUTPOST: RaidTarget = { faction: 'government', isSeatOfPower: false };
const COMBINE_SEAT: RaidTarget = { faction: 'government', isSeatOfPower: true };
const STREET_TARGET: RaidTarget = { faction: 'independent', isSeatOfPower: false };

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
    expect([...LIVE_REPUTATION_LABELS]).toEqual([
      'Revolutionary',
      'Anti-systemic',
      'Cautious',
      'Opportunist',
      'Honorable',
      'Treacherous',
      'Collaborator',
      'Reckless',
      'Feared',
      'Respected',
    ]);

    const reachable = new Set([
      deriveReputation({ infamy: STARTING_INFAMY, tally: tallyOf(0, 0) }, NOW),
      deriveReputation({ infamy: FEARED_INFAMY, tally: tallyOf(0, 0) }, NOW),
      deriveReputation({ infamy: 0, tally: tallyOf(0, RECKLESS_LOSSES) }, NOW),
      deriveReputation({ infamy: 0, tally: tallyOf(RESPECTED_WINS, 0) }, NOW),
      deriveReputation(
        {
          infamy: 0,
          tally: stanceOf({
            governmentSitesTaken: REVOLUTIONARY_SEATS,
            governmentSeatsTaken: REVOLUTIONARY_SEATS,
          }),
        },
        NOW,
      ),
      deriveReputation(
        { infamy: 0, tally: stanceOf({ governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS }) },
        NOW,
      ),
      deriveReputation(
        { infamy: 0, tally: stanceOf({ governmentContracts: COLLABORATOR_CONTRACTS }) },
        NOW,
      ),
      deriveReputation(
        {
          infamy: 0,
          tally: stanceOf({
            governmentSitesTaken: OPPORTUNIST_JOBS_EACH_WAY,
            governmentContracts: OPPORTUNIST_JOBS_EACH_WAY,
          }),
        },
        NOW,
      ),
      deriveReputation({ infamy: 0, tally: stanceOf({ paydaysHonoured: HONORABLE_PAYDAYS }) }, NOW),
      deriveReputation(
        { infamy: 0, tally: stanceOf({ paydaysMissed: TREACHEROUS_MISSED_PAYDAYS }) },
        NOW,
      ),
    ]);
    expect([...reachable].sort()).toEqual([...LIVE_REPUTATION_LABELS].sort());
  });

  /*
   * The counters the labels above are read off must all be *reachable from a live writer* too,
   * not merely present on the schema. `recordRaidOutcome`, `recordMissionOutcome` and
   * `recordPayrollOutcome` are the only writers in the system, so every counter has to be moved
   * by one of them.
   */
  it('has a live writer for every counter on the tally', () => {
    const start = startingTally(NOW.toISOString());
    const written = [
      recordRaidOutcome(start, { winner: 'attacker', target: STREET_TARGET }, NOW),
      recordRaidOutcome(start, { winner: 'defender', target: STREET_TARGET }, NOW),
      recordRaidOutcome(start, { winner: 'attacker', target: COMBINE_SEAT }, NOW),
      recordMissionOutcome(start, 'for_government', 'success', NOW),
      recordPayrollOutcome(start, { honoured: 1, missed: 0 }, NOW),
      recordPayrollOutcome(start, { honoured: 0, missed: 1 }, NOW),
    ];

    for (const counter of TALLY_COUNTERS) {
      expect(
        written.some((tally) => tally[counter] > start[counter]),
        `nothing in the game can increment ${counter}`,
      ).toBe(true);
    }
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

  it('earns Respected on the RESPECTED_WINS-th win, not on the one after it', () => {
    // Same rule as the seat raids: the count a constant names is the count that has to be enough.
    let tally = startingTally(NOW.toISOString());
    let at = NOW;
    for (let i = 0; i < RESPECTED_WINS; i++) {
      at = new Date(at.getTime() + 60_000);
      tally = recordRaidOutcome(tally, { winner: 'attacker', target: STREET_TARGET }, at);
    }

    expect(deriveReputation({ infamy: 0, tally }, at)).toBe('Respected');
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

describe('where the crew stands on the Combine (§A3, §D8)', () => {
  const derive = (tally: ReputationTally, infamy = 0) => deriveReputation({ infamy, tally }, NOW);

  it('calls sustained anti-government action Anti-systemic', () => {
    expect(derive(stanceOf({ governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS }))).toBe('Anti-systemic');
  });

  it('does not call one raid on the state a movement', () => {
    expect(derive(stanceOf({ governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS - 1 }))).toBe('Cautious');
  });

  it('calls a crew that has taken the seats of power Revolutionary', () => {
    expect(
      derive(
        stanceOf({
          governmentSitesTaken: REVOLUTIONARY_SEATS,
          governmentSeatsTaken: REVOLUTIONARY_SEATS,
        }),
      ),
    ).toBe('Revolutionary');
  });

  /*
   * Every tally above is hand-built at `updatedAt = NOW`, which is the one instant the counters
   * hold whole numbers. Real play arrives through `recordRaidOutcome`, which decays *before* it
   * increments, so a raid taken later is worth slightly under 1 — and a `>= N` threshold quietly
   * costs N+1 raids. Driving the label through the writer with time between the raids is what
   * catches that; taking both seats on the map has to be enough, at any spacing.
   */
  const driveSeatRaids = (raids: number, gapMs: number) => {
    let tally = startingTally(NOW.toISOString());
    let at = NOW;
    for (let i = 0; i < raids; i++) {
      at = new Date(at.getTime() + gapMs);
      tally = recordRaidOutcome(tally, { winner: 'attacker', target: COMBINE_SEAT }, at);
    }
    return { tally, at };
  };

  it.each([1_000, 60_000, 24 * 60 * 60 * 1000])(
    'calls a crew Revolutionary on the last seat raid, %i ms apart',
    (gapMs) => {
      const oneShort = driveSeatRaids(REVOLUTIONARY_SEATS - 1, gapMs);
      expect(deriveReputation({ infamy: 0, tally: oneShort.tally }, oneShort.at)).not.toBe(
        'Revolutionary',
      );

      const bothSeats = driveSeatRaids(REVOLUTIONARY_SEATS, gapMs);
      expect(deriveReputation({ infamy: 0, tally: bothSeats.tally }, bothSeats.at)).toBe(
        'Revolutionary',
      );
    },
  );

  it('reads one seat as anti-government action, not yet as a revolution', () => {
    // Seats are a subset of sites, so this crew is short of both thresholds.
    expect(derive(stanceOf({ governmentSitesTaken: 1, governmentSeatsTaken: 1 }))).toBe('Cautious');
    expect(
      derive(stanceOf({ governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS, governmentSeatsTaken: 1 })),
    ).toBe('Anti-systemic');
  });

  it('calls a crew on the state payroll a Collaborator', () => {
    expect(derive(stanceOf({ governmentContracts: COLLABORATOR_CONTRACTS }))).toBe('Collaborator');
  });

  it('calls a crew playing both sides evenly an Opportunist, over its raid record', () => {
    // Neither ledger dominates, so no side can be named — but working both of them is itself the
    // answer to "whose side are they on?", and it outranks how loud the crew has been.
    const bothSides = stanceOf({
      governmentSitesTaken: COLLABORATOR_CONTRACTS,
      governmentContracts: COLLABORATOR_CONTRACTS,
      raidsWon: RESPECTED_WINS,
    });
    expect(derive(bothSides)).toBe('Opportunist');
  });

  it('does not call a crew that has barely touched either side an Opportunist', () => {
    const dabbled = stanceOf({
      governmentSitesTaken: OPPORTUNIST_JOBS_EACH_WAY - 1,
      governmentContracts: OPPORTUNIST_JOBS_EACH_WAY - 1,
    });
    expect(derive(dabbled)).toBe('Cautious');
  });

  it('needs both ledgers worked, not just one', () => {
    expect(derive(stanceOf({ governmentSitesTaken: OPPORTUNIST_JOBS_EACH_WAY }))).toBe('Cautious');
    expect(derive(stanceOf({ governmentContracts: OPPORTUNIST_JOBS_EACH_WAY }))).toBe('Cautious');
  });

  it('still lets a committed side outrank working both', () => {
    // Enough anti-government action to be a movement, plus some Combine work on the side.
    expect(
      derive(
        stanceOf({
          governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS,
          governmentContracts: OPPORTUNIST_JOBS_EACH_WAY,
        }),
      ),
    ).toBe('Anti-systemic');
  });

  it('lets the dominant ledger decide when a crew plays both sides unevenly', () => {
    const mostlyAgainst = stanceOf({
      governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS,
      governmentContracts: ANTI_SYSTEMIC_ACTIONS - 1,
    });
    expect(derive(mostlyAgainst)).toBe('Anti-systemic');

    const mostlyFor = stanceOf({
      governmentSitesTaken: COLLABORATOR_CONTRACTS - 1,
      governmentContracts: COLLABORATOR_CONTRACTS,
    });
    expect(derive(mostlyFor)).toBe('Collaborator');
  });

  /*
   * The precedence decision, pinned rather than left to the happy path: a stance on the state is a
   * claim about what a crew is *for*, so it outranks how loud (`Feared`) or how successful
   * (`Respected`) it has been, and the narrower `Revolutionary` is tested before the broader
   * `Anti-systemic` whose signal contains it.
   */
  it('puts the government stance above infamy and the raid record', () => {
    const loudAndPolitical = stanceOf({
      governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS,
      raidsWon: RESPECTED_WINS,
      raidsLost: RECKLESS_LOSSES,
    });
    expect(derive(loudAndPolitical, 100)).toBe('Anti-systemic');
    expect(derive({ ...loudAndPolitical, governmentSeatsTaken: REVOLUTIONARY_SEATS }, 100)).toBe(
      'Revolutionary',
    );
    expect(
      derive(
        stanceOf({ governmentContracts: COLLABORATOR_CONTRACTS, raidsWon: RESPECTED_WINS }),
        100,
      ),
    ).toBe('Collaborator');
  });

  it('drops the stance labels once the crew stops, like every other word', () => {
    const tally = stanceOf({
      governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS,
      governmentSeatsTaken: REVOLUTIONARY_SEATS,
    });
    expect(deriveReputation({ infamy: 0, tally }, NOW)).toBe('Revolutionary');

    const muchLater = new Date(NOW.getTime() + 4 * TALLY_HALF_LIFE_MS);
    expect(deriveReputation({ infamy: 0, tally }, muchLater)).toBe('Cautious');
  });
});

describe('the tally a pre-W10 base is holding', () => {
  /*
   * W10 adds three counters to a tally that is already persisted as JSON in `bases.economy_json`.
   * They default to `0` instead of arriving by migration, and this is the claim that rests on:
   * a row written before W10 has to keep parsing, and read back as a crew that has simply never
   * met the Combine. If this fails, the change needs a migration number from the CTO (INTERFACES
   * R8) rather than a schema default.
   */
  const legacyRow = { updatedAt: NOW.toISOString(), raidsWon: 3, raidsLost: 1 };

  it('parses, and reads as a crew that has never touched the government', () => {
    const parsed = ReputationTallySchema.parse(legacyRow);

    expect(parsed).toMatchObject({ raidsWon: 3, raidsLost: 1 });
    for (const counter of TALLY_COUNTERS.filter((c) => !(c in legacyRow))) {
      expect(parsed[counter], counter).toBe(0);
    }
    expect(deriveReputation({ infamy: 0, tally: parsed }, NOW)).toBe('Cautious');
  });

  it('still rejects a counter that is present but nonsense', () => {
    // The default must not soften the schema: a negative counter is still a corrupt row.
    expect(
      ReputationTallySchema.safeParse({ ...legacyRow, governmentSitesTaken: -1 }).success,
    ).toBe(false);
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

  it('halves every counter, not just the ones a test happened to name', () => {
    // A counter left out of `decayTally` would give its label a score no crew could ever drift out
    // of. Driven off `TALLY_COUNTERS`, so a counter added later is covered on the day it lands.
    const loaded = Object.fromEntries(
      TALLY_COUNTERS.map((counter) => [counter, 8]),
    ) as unknown as ReputationTally;
    const later = new Date(NOW.getTime() + TALLY_HALF_LIFE_MS);
    const decayed = decayTally({ ...loaded, updatedAt: NOW.toISOString() }, later);

    expect(TALLY_COUNTERS.length).toBeGreaterThan(0);
    for (const counter of TALLY_COUNTERS) {
      expect(decayed[counter], counter).toBeCloseTo(4);
    }
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
  const start = startingTally(NOW.toISOString());

  it('counts a win and a loss on the right side of the ledger', () => {
    expect(
      recordRaidOutcome(start, { winner: 'attacker', target: STREET_TARGET }, NOW),
    ).toMatchObject({ raidsWon: 1, raidsLost: 0 });
    expect(
      recordRaidOutcome(start, { winner: 'defender', target: STREET_TARGET }, NOW),
    ).toMatchObject({ raidsWon: 0, raidsLost: 1 });
  });

  it('decays what is already on the books before adding to it', () => {
    const later = new Date(NOW.getTime() + TALLY_HALF_LIFE_MS);
    const recorded = recordRaidOutcome(
      tallyOf(4, 0),
      { winner: 'attacker', target: STREET_TARGET },
      later,
    );

    expect(recorded.raidsWon).toBeCloseTo(3);
    expect(recorded.updatedAt).toBe(later.toISOString());
  });

  it('books a won raid on Combine ground on both ledgers (§A3)', () => {
    expect(
      recordRaidOutcome(start, { winner: 'attacker', target: COMBINE_OUTPOST }, NOW),
    ).toMatchObject({ raidsWon: 1, governmentSitesTaken: 1, governmentSeatsTaken: 0 });
  });

  it('counts a seat of power as a site as well as a seat', () => {
    expect(
      recordRaidOutcome(start, { winner: 'attacker', target: COMBINE_SEAT }, NOW),
    ).toMatchObject({
      governmentSitesTaken: 1,
      governmentSeatsTaken: 1,
    });
  });

  it('leaves the stance counters alone for a raid on another crew', () => {
    expect(
      recordRaidOutcome(start, { winner: 'attacker', target: STREET_TARGET }, NOW),
    ).toMatchObject({ governmentSitesTaken: 0, governmentSeatsTaken: 0 });
  });

  it('credits nothing to a crew the Combine turned back', () => {
    // A failed attempt is priced in `raidsLost` and in morale. Counting it as anti-government
    // action too would let one raid record produce both `Reckless` and `Anti-systemic`.
    expect(
      recordRaidOutcome(start, { winner: 'defender', target: COMBINE_SEAT }, NOW),
    ).toMatchObject({
      raidsLost: 1,
      governmentSitesTaken: 0,
      governmentSeatsTaken: 0,
    });
  });
});

describe('recordMissionOutcome (§A3, §D8)', () => {
  const start = startingTally(NOW.toISOString());

  it('books a successful anti-government run as action against the state', () => {
    expect(recordMissionOutcome(start, 'against_government', 'success', NOW)).toMatchObject({
      governmentSitesTaken: 1,
      governmentContracts: 0,
    });
  });

  it('books a successful Combine contract as collaboration', () => {
    expect(recordMissionOutcome(start, 'for_government', 'success', NOW)).toMatchObject({
      governmentSitesTaken: 0,
      governmentContracts: 1,
    });
  });

  it('never lets a mission take a seat of power — only a raid can (§A3)', () => {
    for (const stance of ['against_government', 'for_government', 'unaligned'] as const) {
      expect(recordMissionOutcome(start, stance, 'success', NOW).governmentSeatsTaken).toBe(0);
    }
  });

  it('says nothing about the state for unaligned work or for a failed run', () => {
    expect(recordMissionOutcome(start, 'unaligned', 'success', NOW)).toMatchObject({
      governmentSitesTaken: 0,
      governmentContracts: 0,
    });
    for (const stance of ['against_government', 'for_government'] as const) {
      expect(recordMissionOutcome(start, stance, 'failure', NOW)).toMatchObject({
        governmentSitesTaken: 0,
        governmentContracts: 0,
      });
    }
  });

  it('still applies the §D8 drift on a run that moves nothing', () => {
    // The drift is continuous, so a settlement must advance the clock whatever the run was.
    const later = new Date(NOW.getTime() + TALLY_HALF_LIFE_MS);
    const recorded = recordMissionOutcome(tallyOf(4, 0), 'unaligned', 'success', later);

    expect(recorded.raidsWon).toBeCloseTo(2);
    expect(recorded.updatedAt).toBe(later.toISOString());
  });
});

describe('whether the crew’s word holds (§D8a)', () => {
  const derive = (tally: ReputationTally, infamy = 0) => deriveReputation({ infamy, tally }, NOW);

  it('calls a crew that keeps meeting payroll Honorable', () => {
    expect(derive(stanceOf({ paydaysHonoured: HONORABLE_PAYDAYS }))).toBe('Honorable');
  });

  it('does not hand out the word for a single met payday', () => {
    expect(derive(stanceOf({ paydaysHonoured: HONORABLE_PAYDAYS - 1 }))).toBe('Cautious');
  });

  it('calls a crew that keeps stiffing its people Treacherous', () => {
    expect(derive(stanceOf({ paydaysMissed: TREACHEROUS_MISSED_PAYDAYS }))).toBe('Treacherous');
  });

  it('needs a dominant side — a crew that pays half the time is neither', () => {
    const evens = stanceOf({
      paydaysHonoured: HONORABLE_PAYDAYS,
      paydaysMissed: HONORABLE_PAYDAYS,
    });

    expect(derive(evens)).toBe('Cautious');
  });

  it('lets a bad run outweigh an earlier good one', () => {
    expect(
      derive(
        stanceOf({ paydaysHonoured: HONORABLE_PAYDAYS, paydaysMissed: HONORABLE_PAYDAYS + 1 }),
      ),
    ).toBe('Treacherous');
  });

  it('needs the leading counter to reach its own threshold, not merely to lead', () => {
    // Honoured leads, and nothing was missed often enough to be treacherous — but the crew has
    // not met enough paydays yet to have earned a word either.
    expect(
      derive(
        stanceOf({ paydaysHonoured: HONORABLE_PAYDAYS - 1, paydaysMissed: HONORABLE_PAYDAYS - 2 }),
      ),
    ).toBe('Cautious');
  });

  it('outranks the volume labels but not where the crew stands on the Combine', () => {
    const honorable = { paydaysHonoured: HONORABLE_PAYDAYS };

    // A loud, winning crew that also pays on time is read by its word first.
    expect(derive(stanceOf({ ...honorable, raidsWon: RESPECTED_WINS }), FEARED_INFAMY)).toBe(
      'Honorable',
    );
    // But the politics is still the more specific fact.
    expect(derive(stanceOf({ ...honorable, governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS }))).toBe(
      'Anti-systemic',
    );
  });

  /**
   * The constants claim to mean weeks, so this drives the real writer on the real weekly clock —
   * the only cadence the game can produce paydays at. Both thresholds are pinned from *below* as
   * well, because the §D8 drift runs before every write: a counter fed once per week decays faster
   * than it fills, and a threshold set one too high would be a word no crew could ever earn.
   */
  const afterWeeklyPaydays = (count: number, met: boolean) => {
    let tally = startingTally(NOW.toISOString());
    let at = NOW;
    for (let i = 0; i < count; i++) {
      at = new Date(at.getTime() + PAY_WEEK_MS);
      tally = recordPayrollOutcome(
        tally,
        met ? { honoured: 1, missed: 0 } : { honoured: 0, missed: 1 },
        at,
      );
    }
    return deriveReputation({ infamy: 0, tally }, at);
  };

  it('earns Honorable on the HONORABLE_PAYDAYS-th weekly payday, and not before', () => {
    expect(afterWeeklyPaydays(HONORABLE_PAYDAYS - 1, true)).toBe('Cautious');
    expect(afterWeeklyPaydays(HONORABLE_PAYDAYS, true)).toBe('Honorable');
  });

  it('earns Treacherous on the TREACHEROUS_MISSED_PAYDAYS-th missed one, and not before', () => {
    expect(afterWeeklyPaydays(TREACHEROUS_MISSED_PAYDAYS - 1, false)).toBe('Cautious');
    expect(afterWeeklyPaydays(TREACHEROUS_MISSED_PAYDAYS, false)).toBe('Treacherous');
  });

  it('keeps both thresholds under the ceiling a weekly counter can actually reach', () => {
    // 1 / (1 - 0.5^(7/14)) ≈ 3.41 — the most a once-a-week counter can ever hold. `tallyReaches`
    // asks for `> N - 1`, so any constant above this + 1 names a label that can never be returned.
    const ceiling = 1 / (1 - Math.pow(0.5, PAY_WEEK_MS / TALLY_HALF_LIFE_MS));

    expect(HONORABLE_PAYDAYS - 1).toBeLessThan(ceiling);
    expect(TREACHEROUS_MISSED_PAYDAYS - 1).toBeLessThan(ceiling);
  });

  it('drifts back out of the word once the crew stops having a payroll at all', () => {
    const tally = recordPayrollOutcome(
      startingTally(NOW.toISOString()),
      { honoured: HONORABLE_PAYDAYS, missed: 0 },
      NOW,
    );
    const muchLater = new Date(NOW.getTime() + 8 * TALLY_HALF_LIFE_MS);

    expect(deriveReputation({ infamy: 0, tally }, NOW)).toBe('Honorable');
    expect(deriveReputation({ infamy: 0, tally }, muchLater)).toBe('Cautious');
  });

  it('books both sides of a mixed settle in one write', () => {
    const tally = recordPayrollOutcome(
      startingTally(NOW.toISOString()),
      { honoured: 3, missed: 1 },
      NOW,
    );

    expect(tally.paydaysHonoured).toBe(3);
    expect(tally.paydaysMissed).toBe(1);
  });
});
