import {
  UNIT_CATALOG,
  isCombatUnit,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  UNIT_MODIFIERS,
  COMBAT_CONTEXT_LABELS,
  findUnit,
  modificationsForUnit,
  unitRules,
  type UnitOption,
  type UnitSpec,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { UnitCard } from './UnitCard';
import { splitResistances } from './UnitDamage';
import { ruleTone, walksAlways } from './rules';

/**
 * The marks band, and the one thing about it a class list cannot prove (maintainer request, 2026-09-08).
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
      when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context].when,
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
    unitSlots: spec.unitSlots,
    unlocked: true,
    missing: [],
    owned: 0,
    slots: [0, 1, 2].map((index) => ({
      upgradeId: null,
      name: `Slot ${index + 1}`,
      rarity: null,
      effect: {},
    })),
    eligible: modificationsForUnit(spec.id).map((card) => card.id),
  };
}

/** `UpgradeSlots` inside the card opens a mutation, so the card needs a client to render at all. */
function draw(node: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {/* A card's brackets are doors to the Scrapyard (2026-09-16), so the tree needs a router. */}
      <MemoryRouter>{node}</MemoryRouter>
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

    draw(<UnitCard unit={option} garrisoned={0} abroad={0} />);
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

    const { unmount } = draw(<UnitCard unit={walker} garrisoned={0} abroad={0} />);
    const red = screen.getByText((negative as { label: string }).label);
    expect(red.className).toContain('oxblood');
    expect(red.className).not.toContain('brass');
    unmount();

    draw(<UnitCard unit={shield} garrisoned={0} abroad={0} />);
    const brass = screen.getByText((positive as { label: string }).label);
    expect(brass.className).toContain('brass');
    expect(brass.className).not.toContain('oxblood');
  });
});

describe('walksAlways', () => {
  it('is true for the one sheet no vehicle takes, and false for a unit that fits', () => {
    expect(walksAlways('the_colossus')).toBe(true);
    expect(walksAlways('razors')).toBe(false);
    // A unit id the catalogue has never heard of is a unit with legs, not a refusal.
    expect(walksAlways('nobody')).toBe(false);
  });
});

/**
 * The locked box on the face of the card (maintainer pass, 2026-09-09).
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
    speedPercent: 0,
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
    draw(<UnitCard unit={shut(clauses)} garrisoned={0} abroad={0} training={training} />);

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

/**
 * The count over the picture (maintainer request, 2026-09-15).
 *
 * `12 +6` read as a sum for the player to do rather than as a force split between home and a
 * fight, so the fight count is written after a slash and it is the only orange thing in the badge.
 * The hover is the one place the number says what it is, and it is unchanged.
 */
describe('the count over the picture', () => {
  const shield = ironsides as UnitSpec;

  /*
   * A crew of twelve, however they are spread.
   *
   * `owned` is what is **at home**, because a deployed unit has already left `base.army`, so the
   * fixture works backwards from the roster the badge is supposed to print. The first cut of these
   * tests passed `owned: 12` and expected `12 / 6`, which was really eighteen units and a slash
   * that read as a fraction of a number it was not part of.
   */
  const ROSTER = 12;
  const badgeFor = (abroad: number, garrisoned = 0): HTMLElement => {
    draw(
      <UnitCard
        unit={{ ...optionFor(shield), owned: ROSTER - abroad - garrisoned }}

        garrisoned={garrisoned}
        abroad={abroad}
      />,
    );
    return screen.getByTestId(`unit-count-${shield.id}`);
  };

  it('writes the fight count after a slash, in orange, under the same hover', () => {
    const badge = badgeFor(6);
    // Twelve in the crew, six of them at a fight: the six is a slice of the twelve, not a second
    // number added to it.
    expect(badge.textContent).toBe('12 / 6');

    const away = within(badge).getByText('6');
    expect(away.className).toContain('tangerine');
    // The slash is punctuation between two figures, so the orange is the count and nothing else.
    expect(within(badge).getByText('/').className).not.toContain('tangerine');
    expect(away.closest('[data-tip]')?.getAttribute('data-tip')).toBe('6 at a fight');
  });

  it('prints the one number, with no slash, when nobody is away', () => {
    const badge = badgeFor(0);
    expect(badge.textContent).toBe('12');
    expect(badge.textContent).not.toContain('/');
  });

  it('leaves the held-ground count on its own +, in brass', () => {
    const badge = badgeFor(6, 2);
    expect(badge.textContent).toBe('12 +2 / 6');
    expect(within(badge).getByText('+2').className).toContain('brass');
  });
});

/**
 * The damage line, under the marks (maintainer, 2026-09-18).
 *
 * "Have the damage type be displayed on the unit, and have their weaknesses also be visible in the
 * unit type. So right below the tags make another line on each unit that has their damage type."
 *
 * Both halves were on `UnitStats` and on no screen at all, and the half that matters is the one
 * with a sign in it: `resistances` writes a resistance and a weakness into the same record, so
 * `{ blade: 25, explosive: -20 }` is two opposite facts a player would otherwise have to decode.
 * The tests below are on which side of the line a figure lands on, because getting that backwards
 * is the one defect here that still looks completely correct on screen.
 *
 * **Every sheet here is built, not borrowed.** The first cut of these asserted against whichever
 * unit in the catalogue happened to carry the shape the test wanted, and the catalogue moved under
 * them the same afternoon: the roster now has to give every unit a resistance and a weakness
 * (`battle/matchup.test.ts`), so the empty table this component still has to draw is no longer
 * something any real unit produces. A fixture off the catalogue is a test of the catalogue.
 */
describe('the damage line', () => {
  const base = findUnit('wardens') as UnitSpec;

  /** One card, with the damage table this test is about and nothing the catalogue happens to say. */
  const sheet = (
    resistances: UnitOption['stats']['resistances'],
    damageType: UnitOption['stats']['damageType'] = 'ballistic',
  ): UnitOption => {
    const option = optionFor(base);
    return { ...option, stats: { ...option.stats, damageType, resistances } };
  };

  it('names what the unit hits with, on its own line under the tags', () => {
    draw(<UnitCard unit={sheet({ blade: 25 }, 'explosive')} garrisoned={0} abroad={0} />);

    const line = screen.getByTestId(`damage-line-${base.id}`);
    expect(line.textContent).toContain('Explosive');
    expect(line.textContent).toContain('damage');

    // Under the marks rather than among them, which is the half of the ask a text assertion cannot
    // see: `compareDocumentPosition` answers `DOCUMENT_POSITION_FOLLOWING` (4) for a node drawn
    // after the one it is asked of.
    const marks = screen.getByTestId(`marks-${base.id}`);
    expect(marks.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    );
  });

  it('files the positives under Resistances and the negatives under Weaknesses', () => {
    draw(<UnitCard unit={sheet({ blade: 25, explosive: -20 })} garrisoned={0} abroad={0} />);

    fireEvent.mouseEnter(screen.getByTestId(`resistances-${base.id}`));
    const tough = screen.getByTestId(`resistances-sheet-${base.id}`);
    expect(tough.textContent).toContain('Blade');
    expect(tough.textContent).toContain('25% less');
    // The other half of the table is not on this page, sign stripped and read as a resistance.
    expect(tough.textContent).not.toContain('Explosive');

    fireEvent.mouseEnter(screen.getByTestId(`weaknesses-${base.id}`));
    const soft = screen.getByTestId(`weaknesses-sheet-${base.id}`);
    expect(soft.textContent).toContain('Explosive');
    expect(soft.textContent).toContain('20% more');
    expect(soft.textContent).not.toContain('Blade');
  });

  it('answers the question rather than opening an empty panel when the table is bare', () => {
    draw(<UnitCard unit={sheet({})} garrisoned={0} abroad={0} />);

    fireEvent.mouseEnter(screen.getByTestId(`weaknesses-${base.id}`));
    const soft = screen.getByTestId(`weaknesses-sheet-${base.id}`);
    expect(soft.textContent).toContain('Nothing lands on them harder');
    expect(soft.textContent).not.toMatch(/\d+%/);

    fireEvent.mouseEnter(screen.getByTestId(`resistances-${base.id}`));
    const tough = screen.getByTestId(`resistances-sheet-${base.id}`);
    expect(tough.textContent).toContain('Every type lands in full');
    expect(tough.textContent).not.toMatch(/\d+%/);
  });

  it('colours the word only when there is a table behind it', () => {
    const { unmount } = draw(
      <UnitCard unit={sheet({ explosive: -20 })} garrisoned={0} abroad={0} />,
    );
    const loud = screen.getByTestId(`weaknesses-${base.id}`).firstElementChild as HTMLElement;
    expect(loud.className).toContain('oxblood');
    unmount();

    // Greyed, not coloured: an oxblood **Weaknesses** on a unit nothing is strong against sends a
    // player to a page with nothing on it.
    draw(<UnitCard unit={sheet({})} garrisoned={0} abroad={0} />);
    const quiet = screen.getByTestId(`weaknesses-${base.id}`).firstElementChild as HTMLElement;
    expect(quiet.className).not.toContain('oxblood');
    expect(quiet.className).toContain('ink-400');
  });
});

describe('splitResistances', () => {
  it('reads the sign, and leaves a zero out of both lists', () => {
    // A zero is a type this unit has nothing to say about, not a resistance of nothing.
    const split = splitResistances({ blade: 40, explosive: -15, energy: 0 });
    expect(split.resistance).toEqual([{ type: 'blade', points: 40 }]);
    expect(split.weakness).toEqual([{ type: 'explosive', points: 15 }]);
  });

  it('walks the damage types in catalogue order, whatever order the sheet was written in', () => {
    // `the_loose_end` writes its weakness first; two cards listing the same two types in
    // different orders is a table nobody can compare across a roster.
    const split = splitResistances({ energy: 20, blade: 30 });
    expect(split.resistance.map((line) => line.type)).toEqual(['blade', 'energy']);
  });

  it('prints what the fight will use, not what the sheet was allowed to say', () => {
    // The Abomination is written at `chemical: 100` and the engine gives it 85 (`MAX_RESISTANCE`).
    // A card printing the 100 promises a player a fight that cannot happen.
    const split = splitResistances({ chemical: 100, blade: -80 });
    expect(split.resistance).toEqual([{ type: 'chemical', points: 85 }]);
    // And the floor at the other end: `MIN_RESISTANCE` is -60, so -80 lands as 60% more.
    expect(split.weakness).toEqual([{ type: 'blade', points: 60 }]);
  });
});

/**
 * §E: a carrier has no fighting numbers until the crew has the programme (maintainer,
 * 2026-09-19).
 *
 * "Have a lock on the carriers' vitality and damage, and have it say that you need to research
 * the equivalent programme that makes the fighters carry when you hover over it."
 *
 * The figures are *replaced* rather than greyed, and that is the point rather than a styling
 * choice: a dimmed 60 still reads as "sixty, dimmed", and until `carriers_fight` is finished
 * there is no answer at all. A Scavenger is never put in a line, never draws fire and deals
 * nothing, so printing hit points and damage is the sheet quoting a fight the unit is not
 * allowed in.
 */
describe('the lock on a carrier’s fighting numbers', () => {
  const carrier = UNIT_CATALOG.find((one) => !isCombatUnit(one));
  const fighter = UNIT_CATALOG.find((one) => isCombatUnit(one));

  it('has a carrier and a fighter in the catalogue to compare', () => {
    expect(carrier, 'no non-combat unit to test the lock on').toBeDefined();
    expect(fighter).toBeDefined();
  });

  it('locks both headline figures on a carrier, for a crew without the programme', () => {
    if (!carrier) throw new Error('no carrier');
    draw(<UnitCard unit={optionFor(carrier)} garrisoned={0} abroad={0} carriersFight={false} />);
    // Damage and Hit Points: the two headline figures, both behind the lock.
    expect(screen.getAllByTestId('carrier-combat-locked')).toHaveLength(2);
    expect(screen.queryByText(String(carrier.stats.vitality))).toBeNull();
  });

  it('names the programme that opens them', () => {
    if (!carrier) throw new Error('no carrier');
    draw(<UnitCard unit={optionFor(carrier)} garrisoned={0} abroad={0} carriersFight={false} />);
    // The hover's own label, which is what a reader gets before opening anything.
    expect(
      screen.getAllByLabelText(/Everybody Fights/).length,
      'the lock does not say what would unlock it',
    ).toBeGreaterThan(0);
  });

  it('prints them once the crew has it', () => {
    if (!carrier) throw new Error('no carrier');
    draw(<UnitCard unit={optionFor(carrier)} garrisoned={0} abroad={0} carriersFight />);
    expect(screen.queryByTestId('carrier-combat-locked')).toBeNull();
    expect(screen.getByText(String(carrier.stats.vitality))).toBeInTheDocument();
  });

  it('never locks a unit that fights, whichever way the flag is set', () => {
    if (!fighter) throw new Error('no fighter');
    for (const bought of [false, true]) {
      const view = draw(
        <UnitCard unit={optionFor(fighter)} garrisoned={0} abroad={0} carriersFight={bought} />,
      );
      expect(screen.queryByTestId('carrier-combat-locked'), `carriersFight=${bought}`).toBeNull();
      view.unmount();
    }
  });
});
