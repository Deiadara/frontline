import {
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  UNIT_MODIFIERS,
  COMBAT_CONTEXT_LABELS,
  findUnit,
  unitRules,
  type UnitOption,
  type UnitSpec,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { UnitCard } from './UnitCard';
import { ruleTone, walksAlways } from './rules';

/**
 * The marks band, and the one thing about it a class list cannot prove (board request, 2026-09-08).
 *
 * Two claims, and they failed in different ways during the work:
 *
 * 1. **Every mark is on the card.** The band printed two and counted the rest into a `+N`, which
 *    hid exactly what a player opens a roster to compare.
 * 2. **A rule that takes something away is red.** This one shipped green in the browser with the
 *    chip's class list perfectly correct: `UnitOptionSchema.rules` is `{ id, label, description }`,
 *    so zod strips `tone` on the way in and `ruleTone` was reading a field that never arrived.
 *
 * The second is why the fixture below is built the way the *wire* builds it, `tone` stripped, and
 * why the assertion is on the painted colour rather than on the props: a card handed a tone it
 * would never receive in the game proves nothing about the game.
 */

/** One roster row, exactly as `api.ts` shapes it: no `tone`, because the schema does not carry one. */
function optionFor(spec: UnitSpec): UnitOption {
  return {
    id: spec.id,
    name: spec.name,
    tier: spec.tier,
    blurb: spec.blurb,
    trainedAt: spec.trainedAt,
    unique: spec.unique,
    stats: spec.stats,
    modifiers: spec.modifiers.map((id) => ({
      label: UNIT_MODIFIERS[id].label,
      description: UNIT_MODIFIERS[id].description,
      when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
    })),
    rules: unitRules(spec).map((rule) => ({
      id: rule.id,
      label: rule.label,
      description: rule.description,
    })),
    affinities: ENV_LABEL_IDS.flatMap((id) => {
      const immune = spec.immuneTo?.includes(id) ?? false;
      const per = spec.affinities?.[id] ?? 0;
      if (!immune && per === 0) return [];
      return [
        {
          id,
          label: ENV_LABEL_CATALOG[id].name,
          note: immune && per === 0 ? 'Immune' : `${per > 0 ? '+' : ''}${per}% per tier`,
          good: immune || per > 0,
        },
      ];
    }),
    cost: spec.cost,
    trainSeconds: spec.trainSeconds,
    supply: spec.supply,
    unlocked: true,
    missing: [],
    owned: 0,
    slots: [0, 1, 2].map((tier) => ({
      upgradeId: null,
      name: `Slot ${tier + 1}`,
      line: null,
      tier,
      effect: {},
    })),
  };
}

/** `UpgradeSlots` inside the card opens a mutation, so the card needs a client to render at all. */
function draw(node: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}

const colossus = findUnit('the_colossus');
const ironsides = findUnit('ironsides');

describe('the marks band', () => {
  it('prints every rule, modifier and characteristic, and never a "+N"', () => {
    expect(colossus, 'the catalogue must still ship a Colossus').toBeDefined();
    const option = optionFor(colossus as UnitSpec);
    const total = option.rules.length + option.modifiers.length + option.affinities.length;
    // The precondition: a unit with two marks would pass this against the old two-and-a-chip band.
    expect(total, 'the widest unit must carry more marks than the old band showed').toBeGreaterThan(
      2,
    );

    draw(<UnitCard unit={option} built={[]} garrisoned={0} abroad={0} />);
    const band = screen.getByTestId(`marks-${option.id}`);
    expect(within(band).getAllByRole('listitem')).toHaveLength(total);
    expect(band.textContent).not.toMatch(/\+\d/);

    for (const rule of option.rules) expect(within(band).getByText(rule.label)).toBeInTheDocument();
    for (const modifier of option.modifiers) {
      expect(within(band).getByText(modifier.label)).toBeInTheDocument();
    }
    for (const affinity of option.affinities) {
      expect(within(band).getByText(affinity.label)).toBeInTheDocument();
    }
  });

  it('draws a rule that takes something away in oxblood, and one that gives in brass', () => {
    const walker = optionFor(colossus as UnitSpec);
    const shield = optionFor(ironsides as UnitSpec);
    const negative = walker.rules.find((rule) => ruleTone(rule) === 'negative');
    const positive = shield.rules.find((rule) => ruleTone(rule) === 'positive');
    expect(negative, 'the Colossus must carry a rule it cannot do').toBeDefined();
    expect(positive, 'the Ironsides must carry a rule they can').toBeDefined();

    const { unmount } = draw(<UnitCard unit={walker} built={[]} garrisoned={0} abroad={0} />);
    const red = screen.getByText((negative as { label: string }).label);
    expect(red.className).toContain('oxblood');
    expect(red.className).not.toContain('brass');
    unmount();

    draw(<UnitCard unit={shield} built={[]} garrisoned={0} abroad={0} />);
    const brass = screen.getByText((positive as { label: string }).label);
    expect(brass.className).toContain('brass');
    expect(brass.className).not.toContain('oxblood');
  });
});

describe('walksAlways', () => {
  it('is true for the one sheet no vehicle takes, and false for a body that fits', () => {
    expect(walksAlways('the_colossus')).toBe(true);
    expect(walksAlways('razors')).toBe(false);
    // A unit id the catalogue has never heard of is a body with legs, not a refusal.
    expect(walksAlways('nobody')).toBe(false);
  });
});

/**
 * The locked box on the face of the card (board pass, 2026-09-09).
 *
 * It joined every clause into one string and cut it at two lines, which is a cut that lands
 * wherever the line happens to end: the Abomination read `hold the Mad Scientist'…` and the
 * Colossus the same. Two clauses and a count of the rest is the same height, says how much is
 * hidden, and cannot cut a word in half. The whole list is still on the hover.
 */
describe('a locked unit on the roster', () => {
  const training = {
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    spare: 10,
    discountPercent: 0,
    suppliesPercent: 0,
    pending: false,
    onTrain: () => {},
  };

  const shut = (missing: readonly string[]): UnitOption => ({
    ...optionFor(colossus as UnitSpec),
    unlocked: false,
    missing: [...missing],
  });

  it('names two clauses and counts the rest, rather than cutting the list mid-word', () => {
    const clauses = [
      'The Abomination Blueprint',
      'The Lab at level 16',
      'The Infirmary at level 12',
      "hold the Mad Scientist's Notes",
    ];
    draw(
      <UnitCard unit={shut(clauses)} built={[]} garrisoned={0} abroad={0} training={training} />,
    );

    const box = screen.getByTestId(`action-${(colossus as UnitSpec).id}`);
    expect(box.textContent).toContain(clauses[0]);
    expect(box.textContent).toContain(clauses[1]);
    expect(box.textContent).toContain('2 more');
    // The clauses that are only on the hover are not half-printed on the card.
    expect(box.textContent).not.toContain(clauses[2]);
    expect(box.textContent).not.toContain('Mad Scientist');
  });

  it('prints both clauses plainly when there is nothing left to count', () => {
    draw(
      <UnitCard
        unit={shut(['The Lab at level 4', 'The Nexus at level 6'])}
        built={[]}
        garrisoned={0}
        abroad={0}
        training={training}
      />,
    );

    const box = screen.getByTestId(`action-${(colossus as UnitSpec).id}`);
    expect(box.textContent).toContain('The Lab at level 4 · The Nexus at level 6');
    expect(box.textContent).not.toMatch(/\d+ more/);
  });
});
