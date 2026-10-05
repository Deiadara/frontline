import { describe, expect, it } from 'vitest';
import { roadMinutes } from '../time/speed.js';
import { RESEARCH_ITEMS, describeResearchPayout } from '../research/tracks.js';
import { ATTRIBUTE_NAMES } from '../attributes.js';
import { SPY_DEFENCE_ATTRIBUTES } from '../spying/spying.js';
import {
  CHANNEL_LABELS,
  CONDITIONAL_CHANNEL_LABELS,
  attributeUse,
  seatsWeighing,
} from './effects.js';
import { OFFICER_ROLE_LABELS } from '../roles.js';
import { PERK_CATALOG, describePerkBonus } from './perks.js';

/**
 * A channel's name has to read the right way round beside the `+` the crew screen prints
 * (wiring audit, 2026-10-01).
 *
 * `ChannelCard` and the drill dialog both print `+{amount}%` and then the label. For a channel that
 * is taken off a price or a clock, the label is what makes the plus mean less, so "Time on the
 * road +9%" told a player their Navigation made the road longer.
 */
describe('the channels that take something off', () => {
  it('says the road is shorter, and the road really is shorter', () => {
    expect(roadMinutes(60, 0, 9)).toBeLessThan(60);
    expect(CHANNEL_LABELS.travelSpeedPercent.label).toMatch(/^Off /);
    expect(CONDITIONAL_CHANNEL_LABELS.leadArrivalPercent.label).toMatch(/^Off /);
  });

  it.each(['musterCostPercent', 'buildCostPercent', 'wageDiscountPercent'] as const)(
    '%s reads as a saving',
    (channel) => {
      // A joined channel prints as points since 2026-10-02 (P7-A), and still reads as a saving.
      expect(CHANNEL_LABELS[channel].label).toMatch(/^(Off|Points off) /);
    },
  );
});

/**
 * Intimidation is spent in one place, the engine's opening (`intimidate` in `battle/engine.ts`):
 * the other side's shakiest units freeze and do not fire. Nothing surrenders ground or hands over a
 * haul, and the label and the summary both said that it did.
 */
describe('what intimidation says it does', () => {
  it('describes the freeze, and promises nothing is handed over', () => {
    expect(CHANNEL_LABELS.intimidationFlat.label).not.toMatch(/hand/i);
  });
});

/**
 * A wage discount is a negotiation at signing, never a re-price of the running book (maintainer,
 * 2026-10-01). `committedWage` takes it off a contract once, so every card that pays one says so:
 * the perks, the Lab's rungs, and the channel the crew screen and the drill dialog print.
 */
describe('what a wage discount says it does', () => {
  const perks = PERK_CATALOG.filter((entry) => entry.bonus.kind === 'wage_discount');
  const rungs = RESEARCH_ITEMS.filter((item) => item.payout.bonus?.kind === 'wage_discount');

  it('has cards of both kinds to check', () => {
    expect(perks.length).toBeGreaterThan(0);
    expect(rungs.length).toBeGreaterThan(0);
  });

  it.each(perks.map((entry) => [entry.id, entry] as const))('%s', (_, perk) => {
    expect(describePerkBonus(perk.bonus)).toMatch(/agreed at signing while they are working$/);
  });

  it.each(rungs.map((item) => [item.id, item] as const))('%s', (_, item) => {
    expect(describeResearchPayout(item)).toContain('agreed at signing');
  });

  it('names the channel for when it pays', () => {
    expect(CHANNEL_LABELS.wageDiscountPercent.label).toContain('at signing');
  });
});

/**
 * The spy channels by name (maintainer, 2026-10-01): only perks and held ground pay them now, and
 * both are printed as points ("+9 spy points", "+15 spy points against enemy spies"), so the labels
 * say points too. "What your spies bring back" read as a share of a report.
 */
describe('the spy channels', () => {
  it('are named as the points the perk cards print', () => {
    expect(CHANNEL_LABELS.intelYieldPercent).toEqual({
      label: 'Spy points on every job',
      unit: 'flat',
    });
    expect(CHANNEL_LABELS.intelResistancePercent).toEqual({
      label: 'Points against their spies',
      unit: 'flat',
    });
  });
});

/**
 * The hover on every attribute (maintainer, 2026-10-01): "say in high level what they are useful
 * for ... not too specific, just a general nudge towards what they do". One line per attribute,
 * from what it feeds, the same on every screen.
 */
describe('what an attribute is good for', () => {
  // Since 2026-10-04 a skill reaches the crew through the seats that grade it, so the line names
  // them; Signals and Cryptography also guard the crew against spies on anybody in the room.
  it('has one sentence or two for every attribute, with no figure in it', () => {
    for (const name of ATTRIBUTE_NAMES) {
      const line = attributeUse(name);
      expect(line.length, name).toBeGreaterThan(10);
      expect(line, name).toMatch(/^[A-Z].*\.$/);
      expect(line, name).not.toMatch(/\d|%/);
    }
  });

  it('names every seat that grades the attribute, the most demanding first', () => {
    expect(attributeUse('analysis')).toBe(
      'Grades the Researcher, the Engineer, the Fixer, the Cartographer, the Trader and the Professor.',
    );
    expect(attributeUse('authority')).toBe(
      'Grades the Right Hand, the Overseer and the Field Commander.',
    );
    for (const name of ATTRIBUTE_NAMES) {
      for (const seat of seatsWeighing(name)) {
        const label = seat === 'overseer' ? 'the Overseer' : `the ${OFFICER_ROLE_LABELS[seat]}`;
        expect(attributeUse(name), name).toContain(label);
      }
    }
  });

  it('says Signals and Cryptography guard the crew against spies', () => {
    for (const name of SPY_DEFENCE_ATTRIBUTES) {
      expect(attributeUse(name)).toMatch(/^Guards your crew against spies\. /);
    }
    expect(attributeUse('strength')).not.toContain('spies');
  });
});
