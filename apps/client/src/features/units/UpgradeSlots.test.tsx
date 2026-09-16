import {
  MODIFICATION_RARITY_LABELS,
  findUnit,
  findUnitModification,
  modificationsForUnit,
  type BuiltUpgrade,
  type UnitModificationSpec,
  type UnitOption,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The brackets on the roster card, against the rules that live in `@frontline/shared`.
 *
 * Fill-from-left (`firstFreeIndex`, and the `skipped_slot` refusal the server answers with), who
 * may take what (`modificationFitsUnit`, carried on the wire as `UnitOption.eligible`), and the
 * legendary rule (an empty `eligible`) are all proved where they live. What only a rendered screen
 * can prove is that the buttons agree with them: that pressing the *third* bracket sends the card
 * to the *second*, that a card the unit cannot take is on the menu but dead with a reason, and
 * that a legendary is told it takes nothing rather than offered three dashed brackets to a menu
 * the server would refuse.
 */
const fit = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock('../../lib/queries', () => ({
  useFitSlot: () => fit,
  useBurnUpgrade: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { UpgradeSlots } = await import('./UpgradeSlots');

const ironsides = findUnit('ironsides')!;
/** Two open BASIC cards anybody can take. */
const vest = findUnitModification('scrap_vest')!;
const grips = findUnitModification('taped_grips')!;
/** An INTRICATE card written for the rifle units: Ironsides are not on its `fits` list. */
const optics = findUnitModification('hardened_optics')!;
/** A MASTERPIECE card, universal, for the picker's ordering. */
const exoframe = findUnitModification('hardshell_exoframe')!;

/**
 * A card's effect as the wire carries it: numbers only.
 *
 * `UnitModificationSpec.effect` is `Partial<UnitStats>`, which admits `damageType` and
 * `resistances`; the payload's `effect` is `Record<string, number>`, because a bracket only ever
 * prints figures. Dropping the non-numeric keys here is what the server's projection does too.
 */
function figures(effect: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(effect).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}

/** One roster row for `unitId`, with the given cards in its first brackets and the rest empty. */
function option(unitId: string, fitted: readonly UnitModificationSpec[] = []): UnitOption {
  const spec = findUnit(unitId)!;
  return {
    id: spec.id,
    name: spec.name,
    tier: spec.tier,
    blurb: spec.blurb,
    trainedAt: spec.trainedAt,
    unique: spec.unique,
    stats: spec.stats,
    modifiers: [],
    rules: [],
    affinities: [],
    cost: spec.cost,
    trainSeconds: spec.trainSeconds,
    unitSlots: spec.unitSlots,
    homeCostReduction: 0,
    homeSpeedBonus: 0,
    unlocked: true,
    missing: [],
    owned: 4,
    slots: [0, 1, 2].map((index) => {
      const card = fitted[index];
      return card
        ? { upgradeId: card.id, name: card.name, rarity: card.rarity, effect: figures(card.effect) }
        : { upgradeId: null, name: `Slot ${index + 1}`, rarity: null, effect: {} };
    }),
    // The same rule the server reads. Empty for a legendary, and that is what the last test wants.
    eligible: modificationsForUnit(unitId).map((card) => card.id),
  };
}

/** One line of the crew's stock: on the shelf, or bolted to `wearer`. */
function built(card: UnitModificationSpec, wearer?: UnitOption): BuiltUpgrade {
  return {
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    description: card.description,
    effect: figures(card.effect),
    fittedTo: wearer?.id ?? null,
    fittedToName: wearer?.name ?? '',
  };
}

function openPicker(unit: UnitOption, stock: BuiltUpgrade[], bracket: number) {
  fit.mutate.mockClear();
  render(<UpgradeSlots unit={unit} built={stock} />);
  fireEvent.click(screen.getByTestId(`slot-${bracket}`));
  return screen.getByRole('dialog');
}

describe('the brackets fill from the left', () => {
  it('sends a card pressed into the third bracket to the second, the first empty one', () => {
    // Open the picker from the last bracket, the one furthest from where the card belongs.
    const picker = openPicker(option('ironsides', [vest]), [built(grips)], 2);
    fireEvent.click(within(picker).getByRole('button', { name: new RegExp(grips.name) }));

    expect(fit.mutate).toHaveBeenCalledTimes(1);
    expect(fit.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: ironsides.id, upgradeId: grips.id, slot: 1 }),
      expect.anything(),
    );
  });
});

describe('who may take what', () => {
  it('draws no brackets on a legendary, and says so in one line', () => {
    const legendary = option('the_specter');
    expect(legendary.eligible, 'the fixture must be a unit that takes nothing').toEqual([]);

    render(<UpgradeSlots unit={legendary} built={[built(grips)]} />);

    expect(screen.queryByTestId('slot-0')).toBeNull();
    expect(screen.getByTestId('slots-the_specter')).toHaveTextContent(/takes no modifications/i);
  });

  it('draws brackets on a carrier like anyone else', () => {
    render(<UpgradeSlots unit={option('scavengers')} built={[]} />);
    expect(screen.getByTestId('slot-0')).toBeVisible();
    expect(screen.getByTestId('slot-2')).toBeVisible();
  });

  it('shows a card the unit cannot take, greyed, with the reason, and refuses the press', () => {
    const unit = option('ironsides');
    expect(unit.eligible, 'the fixture card must not fit the fixture unit').not.toContain(
      optics.id,
    );

    const picker = openPicker(unit, [built(optics), built(grips)], 0);
    const dead = within(picker).getByTestId(`slot-option-${optics.id}`);
    expect(dead).toBeDisabled();
    expect(dead.className).toContain('opacity-45');
    expect(within(picker).getByTestId(`slot-option-note-${optics.id}`)).toHaveTextContent(
      `Not made for ${ironsides.name}`,
    );
    fireEvent.click(dead);
    expect(fit.mutate).not.toHaveBeenCalled();

    // The control: a card that does fit, on the same menu, is live and carries its own blurb.
    const live = within(picker).getByTestId(`slot-option-${grips.id}`);
    expect(live).toBeEnabled();
    expect(within(picker).getByTestId(`slot-option-note-${grips.id}`)).toHaveTextContent(
      grips.description,
    );
  });
});

/**
 * Every row the server would refuse, or could do nothing with, is dead on the menu with its reason.
 *
 * Two rows used to be live and lead nowhere. The card sitting in the bracket the picker was opened
 * from was highlighted and still a button, and pressing it sent the same card at the first empty
 * bracket, which the server refused as `already_slotted`. And with all three brackets full, a card
 * on the shelf was live and the press returned early with nothing sent, a click the screen ate.
 */
describe('a row that cannot be pressed says why', () => {
  /** A BASIC card anybody can take, with drawings, so the shelf has something universal on it. */
  const wraps = findUnitModification('rag_wraps')!;

  it('greys the card already in the opened bracket, and refuses the press', () => {
    const unit = option('ironsides', [vest]);
    const picker = openPicker(unit, [built(vest, unit), built(grips)], 0);

    const here = within(picker).getByTestId(`slot-option-${vest.id}`);
    expect(here).toBeDisabled();
    expect(within(picker).getByTestId(`slot-option-note-${vest.id}`)).toHaveTextContent(
      /in this bracket/i,
    );
    fireEvent.click(here);
    expect(fit.mutate).not.toHaveBeenCalled();

    // The control: the card on the shelf is live on the same menu and goes to bracket 2.
    fireEvent.click(within(picker).getByTestId(`slot-option-${grips.id}`));
    expect(fit.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: unit.id, upgradeId: grips.id, slot: 1 }),
      expect.anything(),
    );
  });

  it('greys a shelf card when every bracket is full, and says to burn one', () => {
    expect(option('ironsides').eligible, 'the fixture card must fit the fixture unit').toContain(
      wraps.id,
    );
    const full = option('ironsides', [vest, grips, exoframe]);
    const stock = [built(vest, full), built(grips, full), built(exoframe, full), built(wraps)];
    const picker = openPicker(full, stock, 0);

    const shelved = within(picker).getByTestId(`slot-option-${wraps.id}`);
    expect(shelved).toBeDisabled();
    expect(within(picker).getByTestId(`slot-option-note-${wraps.id}`)).toHaveTextContent(
      `Every bracket on your ${ironsides.name} is full`,
    );
    fireEvent.click(shelved);
    expect(fit.mutate).not.toHaveBeenCalled();
  });

  it('is only the full roster that greys a shelf card: with a bracket free it is live', () => {
    const room = option('ironsides', [vest, grips]);
    const picker = openPicker(room, [built(vest, room), built(grips, room), built(wraps)], 0);

    const shelved = within(picker).getByTestId(`slot-option-${wraps.id}`);
    expect(shelved).toBeEnabled();
    expect(within(picker).getByTestId(`slot-option-note-${wraps.id}`)).toHaveTextContent(
      wraps.description,
    );
    fireEvent.click(shelved);
    expect(fit.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: room.id, upgradeId: wraps.id, slot: 2 }),
      expect.anything(),
    );
  });
});

describe('the picker reads like the bench', () => {
  it('groups the stock by rarity in the order the yard sells it, each card under its tag', () => {
    // Handed in out of order on purpose: the grouping is the component's, not the array's.
    const picker = openPicker(
      option('ironsides'),
      [built(exoframe), built(grips), built(optics)],
      0,
    );

    const headings = within(picker)
      .getAllByTestId(/^slot-options-ironsides-/)
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      MODIFICATION_RARITY_LABELS.basic,
      MODIFICATION_RARITY_LABELS.intricate,
      MODIFICATION_RARITY_LABELS.masterpiece,
    ]);

    // The rows follow their headings: every card after BASIC and before INTRICATE is basic.
    const rows = [...within(picker).getByTestId('slot-options-ironsides').children].map(
      (row) => row.getAttribute('data-testid') ?? row.querySelector('button')?.dataset.testid,
    );
    expect(rows).toEqual([
      'slot-options-ironsides-basic',
      `slot-option-${grips.id}`,
      'slot-options-ironsides-intricate',
      `slot-option-${optics.id}`,
      'slot-options-ironsides-masterpiece',
      `slot-option-${exoframe.id}`,
    ]);

    for (const card of [grips, optics, exoframe]) {
      expect(
        within(within(picker).getByTestId(`slot-option-${card.id}`)).getByTestId(
          `rarity-${card.rarity}`,
        ),
      ).toHaveTextContent(MODIFICATION_RARITY_LABELS[card.rarity]);
    }
  });

  it('stamps a filled bracket with the rarity of the card in it', () => {
    render(<UpgradeSlots unit={option('ironsides', [vest, exoframe])} built={[]} />);
    expect(screen.getByTestId('slot-rarity-0')).toHaveTextContent(
      MODIFICATION_RARITY_LABELS[vest.rarity],
    );
    expect(screen.getByTestId('slot-rarity-1')).toHaveTextContent(
      MODIFICATION_RARITY_LABELS[exoframe.rarity],
    );
    expect(screen.queryByTestId('slot-rarity-2')).toBeNull();
  });
});
