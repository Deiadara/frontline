import {
  MODIFICATION_RARITY_LABELS,
  describeAddonEffect,
  findUnitModification,
  type FittedSlot,
  type UnitOption,
} from '@frontline/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Confirm } from '../../components/ui/Confirm';
import { cn } from '../../lib/cn';
import { useBurnUpgrade } from '../../lib/queries';
import { RARITY_BRACKET, RARITY_TEXT } from '../scrapyard/rarity';
import { YardGlyph } from '../scrapyard/YardGlyph';

/**
 * Three brackets on every unit, each one a door to the Scrapyard (GDD §A5, yard rework 2026-09-16).
 *
 * The yard used to build a card onto a shelf and this screen bolted it to somebody. It does not:
 * a card is cut for a named unit and bolted on in the same press, so `POST /units/loadout` and the
 * picker that called it are gone. An empty bracket is the way *to* that press, carrying the unit
 * with it, and what is left here is the half the bench cannot do: say what is bolted on, and burn
 * it off again.
 *
 * Drawn as brackets rather than as a list of names, so an empty one reads as room rather than as
 * an absence: the card should invite the player to fill it before they know what any of it does.
 *
 * ## What a bracket says about the card in it
 *
 * The grade, in the grade's colour (`scrapyard/rarity.tsx`), and the grade's mark. The card's name
 * and what it does are on the hover, read off the catalogue rather than off the payload so the
 * sentence here and the sentence on the bench cannot drift apart. At the width a bracket has, a
 * name is a cut name.
 *
 * ## Who takes nothing
 *
 * A legendary unit takes no modifications at all. That is the maintainer's rule and it lives in
 * `modificationFitsUnit`, which is also what fills `UnitOption.eligible`: a legendary arrives with
 * an empty list, and the card draws one quiet line in place of the brackets rather than three
 * dashed invitations to a bench that would refuse it. Carriers draw brackets like everyone else,
 * now that the catalogue has cards written for them (Hook and Line, Rescue Rig).
 */
export function UpgradeSlots({ unit }: { unit: UnitOption }) {
  const navigate = useNavigate();
  const burn = useBurnUpgrade();
  /** Which bracket is being burned out, and has not been confirmed. Destroying one is one-way. */
  const [burning, setBurning] = useState<number | null>(null);

  /*
   * A legendary takes nothing, and is told so rather than offered three brackets.
   *
   * The strip is the same height as the row it replaces, because the card promises a fixed height
   * and the price box under it must not move between one unit and the next.
   */
  if (unit.eligible.length === 0) {
    return (
      <p
        data-testid={`slots-${unit.id}`}
        className="flex h-6 items-center justify-center rounded-sm border border-dashed border-surface-700 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300"
      >
        Takes no modifications
      </p>
    );
  }

  const burningId = burning === null ? null : (unit.slots[burning]?.upgradeId ?? null);
  const burningCard = burningId === null ? undefined : findUnitModification(burningId);

  return (
    <>
      <ul className="flex items-stretch gap-1" data-testid={`slots-${unit.id}`}>
        {unit.slots.map((slot, index) => (
          <li key={index} className="min-w-0 flex-1">
            <SlotBracket
              slot={slot}
              index={index}
              unitName={unit.name}
              disabled={!unit.unlocked || burn.isPending}
              onOpen={() =>
                slot.upgradeId === null
                  ? // The bench is a per-unit screen now, so the door carries the unit with it: a
                    // player who pressed a bracket on the Razors should not have to find them again
                    // in a list of thirty.
                    void navigate(`/game/scrapyard?view=refits&unit=${unit.id}`)
                  : setBurning(index)
              }
            />
          </li>
        ))}
      </ul>

      {/*
       * §D5c: the only way one ever comes off, and it destroys the thing.
       *
       * This was "Empty it", which handed the modification back and made the whole decision free:
       * a crew could walk one plate around the roster to suit whatever they were about to field.
       * Burning it costs the plate, so choosing where it goes is worth thinking about. Through
       * `Confirm` rather than a dialog of its own, which is that component's stated rule and the
       * same door the structure brackets ask through.
       */}
      {burning !== null && burningId !== null && (
        <Confirm
          title="Dismantle it?"
          body={`${burningCard?.name ?? 'That card'} comes off your ${unit.name} and is scrap. Nothing is refunded, and the Scrapyard has to cut another one from parts.`}
          confirm="Dismantle it"
          testId={`slot-burn-${unit.id}`}
          onCancel={() => setBurning(null)}
          onConfirm={() =>
            burn.mutate({ upgradeId: burningId }, { onSuccess: () => setBurning(null) })
          }
        />
      )}

      {burn.isError && (
        <p className="mt-1 font-body text-[12px] text-oxblood-300">{burn.error.message}</p>
      )}
    </>
  );
}

/** One bracket: what is bolted in, or the fact that there is room. */
function SlotBracket({
  slot,
  index,
  unitName,
  disabled,
  onOpen,
}: {
  slot: FittedSlot;
  index: number;
  unitName: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const card = slot.upgradeId === null ? undefined : findUnitModification(slot.upgradeId);
  const filled = slot.upgradeId !== null && slot.rarity !== null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid={`slot-${index}`}
      data-sound="click"
      /*
       * The name and what it does live on the hover, not in the bracket: at the width a bracket
       * has it can hold the grade's mark and the grade's word and nothing else, and a truncated
       * `Composite Cara…` is the cut label the maintainer's bar forbids outright.
       *
       * Read off the catalogue (`findUnitModification`, `describeAddonEffect`) rather than off the
       * roster payload, so this sentence and the one the bench prints on the same card are the
       * same sentence.
       */
      data-tip={
        filled && card
          ? `${card.name} · ${MODIFICATION_RARITY_LABELS[card.rarity]} · ${describeAddonEffect(card)} · press to burn it off`
          : `Bracket ${index + 1} · empty · cut one for the ${unitName} in the Scrapyard`
      }
      className={cn(
        'flex h-6 w-full items-center justify-center gap-1 rounded-sm border transition-colors',
        filled
          ? cn('bg-surface-950/50', RARITY_BRACKET[slot.rarity!])
          : 'border-dashed border-surface-600/70 text-ink-300 hover:border-brass-300/60 hover:text-brass-300',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      {filled ? (
        <>
          <YardGlyph
            mark={{ kind: 'rarity', rarity: slot.rarity! }}
            className={cn('h-3.5 w-3.5', RARITY_TEXT[slot.rarity!])}
          />
          <span
            className="whitespace-nowrap font-display text-[9px] font-bold uppercase leading-none tracking-[0.08em]"
            data-testid={`slot-rarity-${index}`}
          >
            {MODIFICATION_RARITY_LABELS[slot.rarity!]}
          </span>
        </>
      ) : (
        <span className="font-display text-[13px] font-bold leading-none">+</span>
      )}
    </button>
  );
}
