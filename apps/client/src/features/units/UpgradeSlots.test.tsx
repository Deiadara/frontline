import {
  MODIFICATION_RARITY_LABELS,
  describeAddonEffect,
  findUnit,
  findUnitModification,
  modificationsForUnit,
  type UnitModificationSpec,
  type UnitOption,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/**
 * The brackets on the roster card, against the rules that live in `@frontline/shared`.
 *
 * A bracket stopped being a picker on 2026-09-16: the yard cuts a card for a named unit and bolts
 * it on in one press, so `POST /units/loadout` and the menu that called it are gone. What a
 * rendered screen can still prove is that the three controls agree with the rules around them:
 * that an empty bracket is a door to that unit's bench, that a filled one says what is in it in
 * the catalogue's words, that burning one asks first, and that a legendary is told it takes
 * nothing rather than offered three dashed brackets to a bench that would refuse it.
 */
const burn = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isError: false }));
vi.mock('../../lib/queries', () => ({ useBurnUpgrade: () => burn }));

const { UpgradeSlots } = await import('./UpgradeSlots');

const vest = findUnitModification('scrap_vest')!;
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

/** Where a door led, printed, so a navigation is an assertion rather than a mock. */
function Landed() {
  return <p data-testid="landed">{useLocation().search}</p>;
}

function renderAt(unit: UnitOption) {
  render(
    <MemoryRouter initialEntries={['/game/units']}>
      <Routes>
        <Route path="/game/units" element={<UpgradeSlots unit={unit} />} />
        <Route path="/game/scrapyard" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * A bracket is a door to the yard, not a picker (2026-09-16).
 *
 * The yard cuts a card for a named unit and bolts it on in one press, so there is no shelf to
 * choose from here any more: an empty bracket sends the player to the unit bench with this unit
 * already chosen. What stays on this screen is the half the yard cannot do: reading what is bolted
 * on, and burning it.
 */
describe('a bracket is a door to the yard', () => {
  it('sends an empty bracket to the unit bench with this unit chosen', () => {
    renderAt(option('ironsides'));
    fireEvent.click(screen.getByTestId('slot-1'));
    expect(screen.getByTestId('landed')).toHaveTextContent('?view=refits&unit=ironsides');
  });

  it('says what is bolted in on the hover, in the catalogue’s own words', () => {
    renderAt(option('ironsides', [vest]));
    const tip = screen.getByTestId('slot-0').getAttribute('data-tip') ?? '';
    expect(tip).toContain(vest.name);
    expect(tip).toContain(describeAddonEffect(vest));
  });

  it('dismantles a filled bracket through a confirm, and burns the card', () => {
    burn.mutate.mockClear();
    renderAt(option('ironsides', [vest]));
    fireEvent.click(screen.getByTestId('slot-0'));
    // The press asks first: burning destroys the card and refunds nothing.
    expect(screen.getByTestId('slot-burn-ironsides')).toBeInTheDocument();
    expect(burn.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('slot-burn-ironsides-yes'));
    expect(burn.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeId: vest.id }),
      expect.anything(),
    );
  });

  /** A filled bracket never leaves the roster: burning is a dialog, not a trip to the yard. */
  it('does not walk away from the roster when a filled bracket is pressed', () => {
    renderAt(option('ironsides', [vest]));
    fireEvent.click(screen.getByTestId('slot-0'));
    expect(screen.queryByTestId('landed')).toBeNull();
  });
});

describe('who may take what', () => {
  it('draws no brackets on a legendary, and says so in one line', () => {
    const legendary = option('the_specter');
    expect(legendary.eligible, 'the fixture must be a unit that takes nothing').toEqual([]);

    renderAt(legendary);

    expect(screen.queryByTestId('slot-0')).toBeNull();
    expect(screen.getByTestId('slots-the_specter')).toHaveTextContent(/takes no modifications/i);
  });

  it('draws brackets on a carrier like anyone else', () => {
    renderAt(option('scavengers'));
    expect(screen.getByTestId('slot-0')).toBeVisible();
    expect(screen.getByTestId('slot-2')).toBeVisible();
  });

  it('stamps a filled bracket with the rarity of the card in it', () => {
    renderAt(option('ironsides', [vest, exoframe]));
    expect(screen.getByTestId('slot-rarity-0')).toHaveTextContent(
      MODIFICATION_RARITY_LABELS[vest.rarity],
    );
    expect(screen.getByTestId('slot-rarity-1')).toHaveTextContent(
      MODIFICATION_RARITY_LABELS[exoframe.rarity],
    );
    expect(screen.queryByTestId('slot-rarity-2')).toBeNull();
  });
});
