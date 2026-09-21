import {
  COMBAT_CONTEXT_LABELS,
  UNIT_MODIFIERS,
  findUnit,
  isCombineUnit,
  unitRules,
  type UnitOption,
  type UnitSpec,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { useUnits } from '../../lib/queries';
import { UnitCard } from './UnitCard';
import { unitAffinities } from './UnitSheet';

/**
 * One unit card, everywhere a unit is named (maintainer, 2026-09-20).
 *
 * "Unify everywhere in the game the unit templates so that this is what shows up when you hover or
 * click on it, make it everywhere clickable and have it open up a tab of the unit if you click."
 *
 * Before this there were three cards for one subject and they disagreed about what a unit is. The
 * roster drew {@link UnitCard}: portrait, two open figures, eight ratings, a marks band whose chips
 * each explain themselves. A chip anywhere else drew a narrow `InfoWindow` with a blurb and a list.
 * A player comparing a Razor on the roster against the Razors in their column was reading two
 * layouts of the same sheet and doing the conversion themselves.
 *
 * So there is one card, and the hover and the dialog are the same card. The only difference
 * between them is that a hover cannot be pointed at (`HoverCard` portals its card
 * `pointer-events-none`) and a dialog can, which is exactly why the click exists: the marks band
 * is a row of chips that each answer a question, and until a card could be opened those answers
 * were unreachable on every surface but the roster.
 */

/**
 * The roster's own row for this unit, or the catalogue's if the crew has no such row.
 *
 * Two units in three are on `/units` and that is the better answer when it is there: it carries
 * this crew's *fitted* brackets, its granted marks and what it actually owns, none of which the
 * catalogue knows. The fallback is for the two kinds of sheet that can never be on it: a Combine
 * unit, which is met and never held (`units/faction.test.ts`), and any unit at all before the
 * roster query has answered.
 */
export function useUnitOption(unitId: string): UnitOption | null {
  const roster = useUnits();
  const held = roster.data?.units.find((one) => one.id === unitId);
  if (held) return held;
  const spec = findUnit(unitId);
  return spec ? catalogueOption(spec) : null;
}

/**
 * A `UnitOption` built from the catalogue alone.
 *
 * Every field is either off the sheet or an honest empty. The four empties are `cost`,
 * `trainSeconds`, `slots` and `eligible`: a card drawn from this is drawn without a price box, so
 * none of them reaches a screen, and filling them with a guess would put a number on the wire's
 * shape that the wire never said.
 */
export function catalogueOption(spec: UnitSpec, extraRules: UnitOption['rules'] = []): UnitOption {
  return {
    id: spec.id,
    name: spec.name,
    tier: spec.tier,
    blurb: spec.blurb,
    trainedAt: spec.trainedAt,
    unique: spec.unique ?? false,
    stats: spec.stats,
    modifiers: spec.modifiers.map((id) => ({
      label: UNIT_MODIFIERS[id].label,
      description: UNIT_MODIFIERS[id].description,
      // The entry's own override when it has one, and its context's clause otherwise: the same
      // pair the server assembles for a roster row (`units/roster.ts`), so the two never differ.
      when:
        (UNIT_MODIFIERS[id] as { when?: string }).when ??
        COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context].when,
    })),
    rules: [...extraRules, ...unitRules(spec)],
    affinities: unitAffinities(spec),
    cost: {},
    trainSeconds: 0,
    unitSlots: spec.unitSlots,
    unlocked: true,
    missing: [],
    owned: 0,
    slots: [],
    eligible: [],
  };
}

/**
 * The card itself, for a unit id.
 *
 * No price box and no count, whichever row it came from. Both are answers to "shall I train one",
 * which is a question the roster asks and no other surface does: a chip in a column, a face in a
 * garrison and a legendary on a district are each a unit the player is *looking at* rather than
 * shopping for. The roster passes its own `training` to `UnitCard` directly and does not come
 * through here.
 */
export function UnitWindow({ unitId, option }: { unitId: string; option?: UnitOption | null }) {
  const found = useUnitOption(unitId);
  const unit = option ?? found;
  if (!unit) return null;
  const spec = findUnit(unitId);
  return (
    <UnitCard
      unit={unit}
      garrisoned={0}
      abroad={0}
      // A sheet nobody can hold loses the three claims about ownership. See `UnitCardProps.enemy`.
      enemy={spec !== undefined && isCombineUnit(spec)}
    />
  );
}

/**
 * Anything that names a unit: hover for the card, click to open it.
 *
 * One wrapper rather than a `HoverCard` plus a `Modal` written out at each call site, because the
 * two have to agree about what they show and the pair is four lines of state every time. The
 * trigger is a single `<button>` for the reason `HoverCard` documents: a clickable element inside
 * a tooltip trigger is nested interactive content, which the keyboard cannot reach in the order
 * anybody expects.
 *
 * `card` overrides what the *hover* shows and leaves the dialog alone. The battle screen is the
 * one caller that needs it: a unit standing on a battlefield has effective numbers, and
 * `EffectiveCard` runs the engine's own `effectiveStats` against that ground to print them. That
 * is a better answer to "what will this do here" than the catalogue sheet, and the catalogue sheet
 * is still one click away underneath it.
 */
export function UnitTrigger({
  unitId,
  children,
  card,
  windowCard,
  label,
  className,
  size = 'card',
  'data-testid': testId,
}: {
  unitId: string;
  children: ReactNode;
  /** A different card for the hover only. The dialog is the unit's own unless `windowCard` says. */
  card?: ReactNode;
  /**
   * A different body for the **dialog**, where the screen knows more than the catalogue does.
   *
   * The Census is the caller: it holds the crew's real counts at home, on held ground and at a
   * fight, and a window that dropped them to zero would be a worse answer than the hover it was
   * opened from. Left out, the dialog draws {@link UnitWindow}, which is the right default
   * everywhere the surrounding screen knows nothing the roster does not.
   */
  windowCard?: ReactNode;
  label?: string | undefined;
  className?: string | undefined;
  size?: 'window' | 'card';
  'data-testid'?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const unit = findUnit(unitId);
  // An id the catalogue has never heard of has no card to open, so it gets no trigger at all: a
  // button that reveals an empty window is worse than a chip that stays a chip.
  if (!unit) return <>{children}</>;
  return (
    <>
      {/* Spread rather than written out, because `exactOptionalPropertyTypes` makes
          `className={undefined}` a different thing from leaving it off, and a wrapper's job is to
          pass on exactly what it was given. */}
      <HoverCard
        label={label ?? `${unit.name}: the sheet`}
        size={size}
        onActivate={() => setOpen(true)}
        card={card ?? <UnitWindow unitId={unitId} />}
        {...(className === undefined ? {} : { className })}
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        {children}
      </HoverCard>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          // `wide` is 52rem, which is the card's own ceiling below 1440 (`UnitCard`'s frame note).
          // At `broad` the window was 960 and the card inside it 832, so the dialog carried a
          // 112px column of empty plate down its right-hand side at 1024 and at 1280 and was
          // square only at 1440 and up. One width instead, and the card fills it at every size.
          size="wide"
          dismissible
          labelledBy={UNIT_WINDOW_TITLE_ID}
          data-testid="unit-window"
        >
          <div className="p-4">
            {/* The name, for the dialog to be announced by. The card under it prints the name
                again in its own header, so this one is for screen readers rather than for the
                screen: `sr-only` is out (it clips to a 1px box, which every cut-text gate in the
                suite reads as broken text), so it is the card's own heading that is labelled and
                this is a hidden-from-view attribute instead. */}
            <span id={UNIT_WINDOW_TITLE_ID} hidden>
              {unit.name}
            </span>
            {windowCard ?? <UnitWindow unitId={unitId} />}
          </div>
        </Modal>
      )}
    </>
  );
}

/** One unit window is open at a time, so one id. */
const UNIT_WINDOW_TITLE_ID = 'unit-window-title';
