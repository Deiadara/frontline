import { describe, expect, it } from 'vitest';
import {
  FLED_INFAMY_SHARE,
  RING_INFAMY_SHARE,
  infamyForKills,
  infamyPointsForFled,
  infamyPointsForRingDead,
  missionInfamyForFled,
  missionInfamyForKills,
} from '../economy/infamy.js';
import { boostBundle, boostCoverage } from './boosts.js';
import { bareLineRules } from './line.js';
import { breakOut, perimeterUnits } from './perimeter.js';
import { findUnit } from '../units/catalog.js';
import { noCrewEffects } from '../crew/effects.js';

/**
 * Four defects found in the 2026-09-23 bug pass, each pinned where it was measured.
 *
 * All four are the same shape: a number computed against one model of the fight and spent against
 * another. A boost priced against a line the engine does not use, a ring counted with units the
 * engine will not field, and two halves of one payment rounded apart.
 */

/** A carrier, which is what `carriers_fight` is about, and a heavy, which is what boosts target. */
const CARRIER = 'scavengers';
const HEAVY = 'ironsides';

describe('a boost is priced against the line the side actually fights with', () => {
  it('is measured against a catalogue where the two units really do differ', () => {
    expect(findUnit(CARRIER)?.tier).toBe('carrier');
    expect(findUnit(HEAVY)).toBeDefined();
    // The porter stands in the line only when the channel is held: the whole premise below.
    expect(perimeterUnits({ [CARRIER]: 10 }, bareLineRules())).toBe(0);
    expect(perimeterUnits({ [CARRIER]: 10 }, { carriersFight: true, unitMarks: {} })).toBe(10);
  });

  it('counts the porters in the denominator when the crew fights with them', () => {
    const force = { [HEAVY]: 10, [CARRIER]: 40 };
    const effect = {
      kind: 'tier',
      tier: findUnit(HEAVY)!.tier,
      stat: 'defense',
      percent: 35,
    } as const;

    const bare = boostCoverage(effect, force, bareLineRules());
    const fighting = boostCoverage(effect, force, { carriersFight: true, unitMarks: {} });

    /*
     * The teeth. With the porters out of the line the heavies are the whole of it, so the boost
     * reads as covering everything; with them in, it covers the share it actually reaches. The
     * settler used to take the first reading and hand the engine the second line, which is a
     * multiple, not a rounding step.
     */
    expect(bare).toBe(1);
    expect(fighting).toBeLessThan(0.5);
    expect(boostBundle(effect, force, { carriersFight: true, unitMarks: {} }).defensePercent).toBe(
      fighting * 35,
    );
  });
});

describe('a ring is made of units the engine would field', () => {
  const fleeing = { razors: 4 };
  // A whole effects struct, because the breakout hands it to the engine as a side's book. Only
  // `carriersFight` differs between the two runs, which is what makes the pair a control.
  const run = (ring: Record<string, number>, carriersFight: boolean) =>
    breakOut(
      {
        fleeing,
        ring,
        seed: 'ring-probe',
        // The runners broke on the last round of a fight they came to: the ordinary case, and the
        // same for both runs, so the only thing that differs between them is `carriersFight`.
        context: { pursuit: 30, lastRound: 3, away: true },
        guards: { territory: { ...noCrewEffects(), carriersFight } },
      },
      () => 0.5,
    );

  it('treats a porter ring as no ring at all, rather than annihilating it in no rounds', () => {
    const out = run({ [CARRIER]: 10 }, false);
    /*
     * It used to pass the "is there a ring" gate, build zero stacks, end in a zero-round fight the
     * runners won by default, and report the whole ring dead: the units were deleted off the row
     * and the attacker was paid for a fight that never happened.
     */
    expect(out.rounds).toBe(0);
    expect(out.brokeThrough).toBe(true);
    expect(out.ringLosses, 'a ring that never fought still lost its whole strength').toEqual({});
    expect(out.escaped).toEqual(fleeing);
  });

  it('...and fights it when the crew really does field its porters', () => {
    const out = run({ [CARRIER]: 10 }, true);
    expect(out.rounds).toBeGreaterThan(0);
  });
});

describe('the two halves of a rout make a whole', () => {
  const kill = (army: Record<string, number>) => infamyForKills(army);

  it('is measured on a unit whose kill is worth a whole point', () => {
    expect(kill({ razors: 1 })).toBeGreaterThan(0);
  });

  it('pays a single caught runner the same as killing it, once the ledger is rounded', () => {
    /*
     * The promise in `docs/BATTLE-ENGINE.md`: "a runner the ring kills paid a half for running and
     * a half for dying". Flooring each half separately paid **nothing** for one, and 2 for three.
     * Exact points here, floored once by the caller, is what keeps the promise.
     */
    for (const bodies of [1, 2, 3, 5, 7]) {
      const caught = { razors: bodies };
      const whole = infamyPointsForFled(caught) + infamyPointsForRingDead(caught);
      expect(Math.floor(whole), `${bodies} caught`).toBe(kill(caught));
    }
  });

  it('keeps the halves exact so a mixed ledger does not lose one', () => {
    expect(infamyPointsForFled({ razors: 1 })).toBe(kill({ razors: 1 }) * FLED_INFAMY_SHARE);
    expect(infamyPointsForRingDead({ razors: 1 })).toBe(kill({ razors: 1 }) * RING_INFAMY_SHARE);
    // One fled home and one caught: 1.5 points, which floors to 1 rather than to 0.
    const mixed = infamyPointsForFled({ razors: 2 }) + infamyPointsForRingDead({ razors: 1 });
    expect(mixed).toBeGreaterThan(1);
    expect(Math.floor(mixed)).toBeGreaterThanOrEqual(1);
  });

  it('never pays a battle job nothing for breaking somebody', () => {
    /*
     * The job's own rate is already a half, so flooring a half of a half paid 0 for one, two and
     * three routed one-slot units while killing a single one paid a point. Rounded up now, to
     * match `missionInfamyForKills` directly above it in the same module.
     */
    for (const bodies of [1, 2, 3, 4]) {
      const routed = { razors: bodies };
      expect(missionInfamyForFled(routed), `${bodies} routed`).toBeGreaterThan(0);
      expect(missionInfamyForFled(routed)).toBeLessThanOrEqual(missionInfamyForKills(routed));
    }
    expect(missionInfamyForFled({})).toBe(0);
  });
});
