import { describe, expect, it } from 'vitest';
import { FEATS } from './catalog.js';
import {
  canClaimFeat,
  evaluateFeats,
  featState,
  mergeFeatRewards,
  readyCount,
  type FeatSpec,
} from './feats.js';
import { featMeasureKey } from './measures.js';
import { featRewardValue } from './rewards.js';

/**
 * The evaluator, which is the piece a wrong answer in is worst.
 *
 * Everything else about feats is data or plumbing. This decides whether somebody has done a thing
 * and whether they may be paid for it, so it is tested on hand-built ladders rather than on the
 * live catalogue: a rule that only holds for the feats that happen to exist today is not a rule.
 */

const step = (over: Partial<FeatSpec> & Pick<FeatSpec, 'id' | 'target'>): FeatSpec => ({
  name: over.id,
  blurb: `do ${over.target}`,
  era: 'early',
  size: 'small',
  chain: null,
  after: null,
  measure: 'missions_done',
  reward: { xp: 100 },
  ...over,
});

/** Three rungs of one ladder, the shape the maintainer asked for. */
const LADDER: FeatSpec[] = [
  step({ id: 'a', target: 10, chain: 'c', after: null }),
  step({ id: 'b', target: 50, chain: 'c', after: 'a' }),
  step({ id: 'c3', target: 200, chain: 'c', after: 'b' }),
];

const at = (missions: number) => ({ [featMeasureKey('missions_done')]: missions });

describe('where one feat stands', () => {
  const solo = step({ id: 'solo', target: 10 });

  it('counts up to the target and stops there', () => {
    const open = featState(solo, at(4), new Set(), () => true);
    expect(open.state).toBe('open');
    expect(open.value).toBe(4);
    expect(open.progress).toBeCloseTo(0.4);

    // Past the target the bar does not overfill and the figure does not overstate.
    const over = featState(solo, at(99), new Set(), () => true);
    expect(over.state).toBe('ready');
    expect(over.value).toBe(10);
    expect(over.progress).toBe(1);
  });

  it('is ready the moment the number is reached, exactly', () => {
    expect(featState(solo, at(9), new Set(), () => true).state).toBe('open');
    expect(featState(solo, at(10), new Set(), () => true).state).toBe('ready');
  });

  it('reads as claimed once collected, whatever the number does afterwards', () => {
    const claimed = new Set(['solo']);
    // The measure falling back below the target must not un-claim it: half the measures are
    // current-value and an army dies.
    const after = featState(solo, at(0), claimed, () => true);
    expect(after.state).toBe('claimed');
    expect(after.progress).toBe(1);
  });

  /**
   * A collected rung is clamped like every other one.
   *
   * The measure keeps moving after the button is pressed, and the claimed branch was handing back
   * the raw figure while `open` and `ready` clamped: a crew that collected "write one letter" and
   * then wrote three hundred read `300 / 1 letters` on the rung, which `FeatLadder` draws straight
   * out of `value` and `target`. The doc on `FeatProgress.value` says clamped, and this is the
   * branch that was not.
   */
  it('clamps a collected rung to its target, however far past it the crew goes', () => {
    const after = featState(solo, at(300), new Set(['solo']), () => true);
    expect(after.state).toBe('claimed');
    expect(after.value).toBe(10);
    expect(after.progress).toBe(1);
  });

  it('reports nothing at all while locked', () => {
    const locked = step({ id: 'locked', target: 10, chain: 'c', after: 'a' });
    const progress = featState(locked, at(500), new Set(), () => false);
    expect(progress.state).toBe('locked');
    // Not 500, and not a full bar. A locked row showing complete reads as a broken button.
    expect(progress.value).toBe(0);
    expect(progress.progress).toBe(0);
  });

  it('treats a missing number as zero rather than failing', () => {
    expect(featState(solo, {}, new Set(), () => true).value).toBe(0);
  });
});

describe('a ladder', () => {
  it('opens one rung at a time', () => {
    const [a, b, c] = evaluateFeats(LADDER, at(12), new Set());
    expect(a?.state).toBe('ready');
    expect(b?.state).toBe('open');
    expect(b?.value).toBe(12);
    expect(c?.state).toBe('locked');
  });

  it('keeps every rung shut until the first is done', () => {
    const [a, b, c] = evaluateFeats(LADDER, at(3), new Set());
    expect(a?.state).toBe('open');
    expect(b?.state).toBe('locked');
    expect(c?.state).toBe('locked');
  });

  /**
   * The case that decides the rule, and the maintainer's own example.
   *
   * A crew arriving at the screen already past every rung should be handed the whole ladder at
   * once. The alternative, unlocking on *claiming*, would make somebody press a button, wait for a
   * poll, press the next one, four times over, for work they had already done.
   */
  it('hands over the whole ladder to a crew that is already past it', () => {
    const progress = evaluateFeats(LADDER, at(500), new Set());
    expect(progress.map((one) => one.state)).toEqual(['ready', 'ready', 'ready']);
    expect(readyCount(progress)).toBe(3);
  });

  it('does not stall when a finished rung is left uncollected', () => {
    // `a` is done and not claimed. `b` must still open: the ladder follows the work, not the button.
    const progress = evaluateFeats(LADDER, at(60), new Set());
    expect(progress[0]?.state).toBe('ready');
    expect(progress[1]?.state).toBe('ready');
    expect(progress[2]?.state).toBe('open');
  });

  it('keeps the ladder open once a rung is collected', () => {
    const progress = evaluateFeats(LADDER, at(60), new Set(['a']));
    expect(progress[0]?.state).toBe('claimed');
    expect(progress[1]?.state).toBe('ready');
    expect(progress[2]?.state).toBe('open');
  });

  it('counts only what is waiting', () => {
    expect(readyCount(evaluateFeats(LADDER, at(60), new Set(['a', 'b'])))).toBe(0);
    expect(readyCount(evaluateFeats(LADDER, at(0), new Set()))).toBe(0);
  });
});

describe('claiming', () => {
  it('allows it only for a feat that is finished and uncollected', () => {
    const progress = evaluateFeats(LADDER, at(12), new Set());
    expect(canClaimFeat(progress[0])).toBe(true); // ready
    expect(canClaimFeat(progress[1])).toBe(false); // open
    expect(canClaimFeat(progress[2])).toBe(false); // locked
    expect(canClaimFeat(evaluateFeats(LADDER, at(12), new Set(['a']))[0])).toBe(false); // claimed
    expect(canClaimFeat(undefined)).toBe(false); // not a feat at all
  });
});

describe('adding rewards together', () => {
  it('folds every channel and drops the empty ones', () => {
    const merged = mergeFeatRewards([
      { resources: { caps: 100, scrap: 5 }, xp: 10 },
      { resources: { caps: 50 }, infamy: 3, boosts: ['combat_stims'] },
      { units: { razors: 2 }, items: { scrap_servo: 1 }, xp: 90 },
    ]);
    expect(merged.resources).toEqual({ caps: 150, scrap: 5 });
    expect(merged.units).toEqual({ razors: 2 });
    expect(merged.items).toEqual({ scrap_servo: 1 });
    expect(merged.xp).toBe(100);
    expect(merged.infamy).toBe(3);
    expect(merged.boosts).toEqual(['combat_stims']);
  });

  it('keeps duplicate boosts, because two of a thing is two of a thing', () => {
    const merged = mergeFeatRewards([{ boosts: ['combat_stims'] }, { boosts: ['combat_stims'] }]);
    expect(merged.boosts).toEqual(['combat_stims', 'combat_stims']);
  });

  it('is worth exactly the sum of its parts', () => {
    const rewards = FEATS.slice(0, 20).map((feat) => feat.reward);
    const apart = rewards.reduce((total, reward) => total + featRewardValue(reward), 0);
    expect(featRewardValue(mergeFeatRewards(rewards))).toBeCloseTo(apart, 6);
  });

  it('adds nothing to nothing', () => {
    expect(mergeFeatRewards([])).toEqual({});
  });
});

describe('the live catalogue, through the evaluator', () => {
  it('opens nothing but ladder heads and standalone feats to a brand new crew', () => {
    const progress = evaluateFeats(FEATS, {}, new Set());
    for (const [index, one] of progress.entries()) {
      const spec = FEATS[index]!;
      // A new crew is at zero on everything, so nothing can be ready, and the only rows they may
      // look at are the ones with nothing in front of them.
      expect(one.state, spec.id).toBe(spec.after === null ? 'open' : 'locked');
    }
    expect(readyCount(progress)).toBe(0);
  });

  it('never reports progress past one, whatever the numbers say', () => {
    const huge = Object.fromEntries(
      FEATS.map((feat) => [featMeasureKey(feat.measure, feat.scope), Number.MAX_SAFE_INTEGER]),
    );
    for (const one of evaluateFeats(FEATS, huge, new Set())) {
      expect(one.progress).toBeLessThanOrEqual(1);
      expect(one.value).toBeLessThanOrEqual(one.target);
    }
    // And the same sweep with every one collected. The unclaimed half held while the claimed half
    // did not, which is the shape of a test that pins only the direction its author was thinking
    // about: one line here is the mirror of the four above it.
    const all = new Set(FEATS.map((feat) => feat.id));
    for (const one of evaluateFeats(FEATS, huge, all)) {
      expect(one.value, one.id).toBeLessThanOrEqual(one.target);
    }
  });

  it('hands a finished crew every feat exactly once', () => {
    const huge = Object.fromEntries(
      FEATS.map((feat) => [featMeasureKey(feat.measure, feat.scope), Number.MAX_SAFE_INTEGER]),
    );
    expect(readyCount(evaluateFeats(FEATS, huge, new Set()))).toBe(FEATS.length);
    const all = new Set(FEATS.map((feat) => feat.id));
    expect(readyCount(evaluateFeats(FEATS, huge, all))).toBe(0);
  });
});
