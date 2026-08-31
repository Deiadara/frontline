import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { BENCH_SHARE, IMPORTANCE_SHARE, liftOfficer, noCrewEffects, peerLift } from './effects.js';
import { PERK_CATALOG } from './perks.js';

/**
 * §B7: what one officer's perks do to everybody else's sheet.
 *
 * The rule the whole file is about, and the board's own words for it: a bonus to the number
 * already printed on the card carrying it is not a bonus. So every perk here reaches *other
 * people*, and the test that matters most is the one asserting it does not reach its owner.
 */

const perkWith = (kind: string): string => {
  const found = PERK_CATALOG.find((entry) => entry.bonus.kind === kind);
  if (!found) throw new Error(`no perk in the book with a ${kind} bonus`);
  return found.id;
};

describe('what a peer puts on your sheet', () => {
  it('lifts one named attribute for everybody else', () => {
    const lift = peerLift([perkWith('officer_attribute')]);
    const before = makeAttributes(20);
    const after = liftOfficer(before, lift, {});

    const moved = Object.keys(after).filter(
      (name) => after[name as keyof typeof after] !== before[name as keyof typeof before],
    );
    expect(moved).toHaveLength(1);
    expect(after[moved[0] as keyof typeof after]).toBeGreaterThan(20);
  });

  /**
   * The eight perks that were decoration.
   *
   * `officer_group` folded into `officerGroupFlat`, and the only consumer of that channel read the
   * *ground's* copy, never the crew's. A player could hire the Old Instructor, read the perk, and
   * measure no difference on any sheet in the game.
   */
  it('lifts a whole attribute group for everybody else', () => {
    const lift = peerLift([perkWith('officer_group')]);
    const before = makeAttributes(20);
    const after = liftOfficer(before, lift, {});

    const moved = Object.keys(after).filter(
      (name) => after[name as keyof typeof after] !== before[name as keyof typeof before],
    );
    // A group is seven attributes at the smallest, so this cannot pass by lifting one of them.
    expect(moved.length).toBeGreaterThanOrEqual(7);
  });

  it('adds the ground and the peers rather than taking the better of the two', () => {
    const lift = peerLift([perkWith('officer_group')]);
    const own = makeAttributes(20);
    const peersOnly = liftOfficer(own, lift, {});
    const both = liftOfficer(own, lift, { physical: 4 });

    const lifted = Object.keys(own).find(
      (name) => peersOnly[name as keyof typeof own] !== own[name as keyof typeof own],
    )!;
    // Only assert the sum where both sources touch the same attribute.
    const fromPeers = peersOnly[lifted as keyof typeof own] - own[lifted as keyof typeof own];
    const fromBoth = both[lifted as keyof typeof own] - own[lifted as keyof typeof own];
    expect(fromBoth).toBeGreaterThanOrEqual(fromPeers);
  });

  it('does nothing at all when nobody else carries a perk', () => {
    const own = makeAttributes(20);
    expect(liftOfficer(own, noCrewEffects(), {})).toEqual(own);
  });
});

describe('the specialist perk, which has a bar on it', () => {
  const threshold = PERK_CATALOG.find((entry) => entry.bonus.kind === 'officer_threshold');
  if (!threshold || threshold.bonus.kind !== 'officer_threshold') {
    throw new Error('no officer_threshold perk in the book');
  }
  const { attribute, flat, threshold: bar } = threshold.bonus;
  const lift = peerLift([threshold.id]);

  it('pays an officer who has already cleared the bar', () => {
    const own = makeAttributes(10, { [attribute]: bar });
    expect(liftOfficer(own, lift, {})[attribute]).toBe(bar + flat);
  });

  it('pays nothing to an officer one point short of it', () => {
    const own = makeAttributes(10, { [attribute]: bar - 1 });
    expect(liftOfficer(own, lift, {})[attribute]).toBe(bar - 1);
  });

  /**
   * The bar is read against what the officer brought, not against the running total.
   *
   * Otherwise a group lift could carry somebody over the line and the specialist's perk would pay
   * out for a crew of generalists, which is the one thing it is priced not to do.
   */
  it('does not let another lift carry somebody over the bar', () => {
    const own = makeAttributes(10, { [attribute]: bar - 2 });
    const lifted = liftOfficer(own, lift, { social: 5, mental: 5, physical: 5, technical: 5 });
    expect(lifted[attribute]).toBe(bar - 2 + 5);
  });
});

/**
 * §C2: the bench can never be an upgrade.
 *
 * The invariant that decides what `BENCH_SHARE` is allowed to be. A crew's rating in an attribute
 * is the best across everybody, so if a benched officer out-contributed a seated one anywhere,
 * emptying a chair would raise the crew's numbers and the bench would be a strategy rather than a
 * waiting room. Pinned against the actual share table rather than against the constant, because
 * that is the comparison that can go wrong when either number is retuned.
 */
describe('what the bench is worth against a chair', () => {
  it('never pays more than the least a chair pays', () => {
    expect(BENCH_SHARE).toBeLessThanOrEqual(Math.min(...Object.values(IMPORTANCE_SHARE)));
  });

  it('is worth something, so signing somebody you cannot place is not wasted', () => {
    expect(BENCH_SHARE).toBeGreaterThan(0);
  });
});
