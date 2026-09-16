import {
  MODIFICATION_RARITIES,
  MODIFICATION_RARITY_LABELS,
  UNIT_STAT_LABELS,
  type BuiltUpgrade,
  firstFreeIndex,
  type FittedSlot,
  type StatKey,
  type UnitOption,
} from '@frontline/shared';
import { Fragment, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { useBurnUpgrade, useFitSlot } from '../../lib/queries';
import { RARITY_BRACKET, RARITY_TEXT, RarityTag } from '../scrapyard/rarity';
import { YardGlyph } from '../scrapyard/YardGlyph';

/**
 * Three brackets on every unit, and the menu that fills one (GDD §A5, Scrapyard extension).
 *
 * The Scrapyard *builds* a modification; this is where it gets bolted to somebody. Three is the
 * whole design: a crew that has built all thirty still has to say what the Razors are for, and the
 * same Hardshell Exoframe cannot be on two units at once (§D5c).
 *
 * Drawn as brackets rather than as a list of names, so an empty one reads as room rather than as
 * an absence: the card should invite the player to fill it before they know what any of it does.
 *
 * ## What a bracket says about the card in it
 *
 * The grade, in the grade's colour (`scrapyard/rarity.tsx`), and the grade's mark. The card's name
 * and its deltas are on the hover: at the width a bracket has, a name is a cut name. The refit
 * lines that used to colour a bracket (armour, weapons, cybernetics, discipline) went with the
 * refits on 2026-09-15; the rarity is the one axis the thirty cards share.
 *
 * ## Who takes nothing
 *
 * A legendary unit takes no modifications at all. That is the maintainer's rule and it lives in
 * `modificationFitsUnit`, which is also what fills `UnitOption.eligible`: a legendary arrives with
 * an empty list, and the card draws one quiet line in place of the brackets rather than three
 * dashed invitations to a menu the server would refuse. Carriers draw brackets like everyone
 * else, now that the catalogue has cards written for them (Hook and Line, Rescue Rig).
 */

/** `+6 vitality · -2 speed`, in the sheet's own words. */
function describeEffect(effect: Record<string, number>): string {
  return Object.entries(effect)
    .map(([key, delta]) => {
      const label = UNIT_STAT_LABELS[key as StatKey] ?? key;
      return `${delta > 0 ? '+' : ''}${delta} ${label.toLowerCase()}`;
    })
    .join(' · ');
}

export function UpgradeSlots({ unit, built }: { unit: UnitOption; built: BuiltUpgrade[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const fit = useFitSlot();
  const burn = useBurnUpgrade();

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

  /**
   * The picker's rows, grouped by grade in the order the yard sells them, so the menu here reads
   * the way the bench does. A grade the crew has built nothing of is not drawn.
   */
  const groups = MODIFICATION_RARITIES.map((rarity) => ({
    rarity,
    cards: built.filter((upgrade) => upgrade.rarity === rarity),
  })).filter((group) => group.cards.length > 0);

  /*
   * Where a press would land, worked out once for the whole menu: the first empty bracket, or
   * nothing when all three are full. Null is a state the menu has to say out loud, because the
   * picker opens from a full bracket as well (that is how a card gets burned), and a card on the
   * shelf then has nowhere to go.
   */
  const target = firstFreeIndex(unit.slots.map((slot) => slot.upgradeId));

  return (
    <>
      <ul className="flex items-stretch gap-1" data-testid={`slots-${unit.id}`}>
        {unit.slots.map((slot, index) => (
          <li key={index} className="min-w-0 flex-1">
            <SlotBracket
              slot={slot}
              index={index}
              disabled={!unit.unlocked || fit.isPending}
              onOpen={() => setOpen(index)}
            />
          </li>
        ))}
      </ul>

      {open !== null && (
        <Modal onClose={() => setOpen(null)} labelledBy={`slot-picker-${unit.id}`}>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <h2
                id={`slot-picker-${unit.id}`}
                className="font-display text-[15px] font-bold uppercase tracking-[0.16em] text-brass-300"
              >
                {unit.name} · bracket {open + 1}
              </h2>
              <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-200">
                You have one of each, and bolting it on is permanent: every one of these already
                trained gets it, and so does every one after. It does not come off. It can be
                burned, and then built again for somebody else.
              </p>
            </div>

            {built.length === 0 ? (
              <p className="rounded-sm border border-surface-600/70 bg-surface-950/40 px-3 py-4 text-center font-body text-[13px] text-ink-300">
                The Scrapyard has not built anything yet.
              </p>
            ) : (
              <ul
                className="flex max-h-[22rem] flex-col gap-1.5 overflow-y-auto"
                data-testid={`slot-options-${unit.id}`}
              >
                {groups.map((group) => (
                  <Fragment key={group.rarity}>
                    <li
                      className={cn(
                        'font-display text-[10px] font-bold uppercase tracking-[0.18em] [&:not(:first-child)]:mt-2',
                        RARITY_TEXT[group.rarity],
                      )}
                      data-testid={`slot-options-${unit.id}-${group.rarity}`}
                    >
                      {MODIFICATION_RARITY_LABELS[group.rarity]}
                    </li>
                    {group.cards.map((upgrade) => {
                      const here = unit.slots[open]?.upgradeId === upgrade.id;
                      /*
                       * §D5c: fitted anywhere at all, this unit's other brackets included.
                       *
                       * One of a thing is one of a thing. The picker used to disable only the brackets
                       * on the unit in front of you, so a plate already bolted to the Breakers looked
                       * available here and the server refused the press. It then left the card in the
                       * bracket the picker was opened from live, highlighted as "here" and still a
                       * button: pressing it sent the same card at the first empty bracket, which the
                       * server refused as `already_slotted`. Fitted anywhere means anywhere.
                       */
                      const fitted = upgrade.fittedTo !== null;
                      /*
                       * A card written for somebody else: shown rather than hidden, for the same
                       * reason as a card bolted on elsewhere. The crew owns it and the menu should say
                       * so; what it says beside it is why this unit cannot have it. The server refuses
                       * the press (`does_not_fit`), and this is the screen agreeing before the press.
                       */
                      const unfit = !unit.eligible.includes(upgrade.id);
                      /*
                       * Nowhere to put it. Every bracket is full and this card is on the shelf, so the
                       * press had nothing to send and used to do nothing at all: a live button that
                       * swallows the click. Burning one is the only way to make room, and the note
                       * says so.
                       */
                      const noRoom = target === null && !fitted;
                      const dead = unfit || fitted || noRoom;
                      return (
                        <li key={upgrade.id}>
                          <button
                            type="button"
                            // A dead row is shown rather than hidden, with the reason on it. A menu
                            // that silently drops an entry the player knows they own reads as a bug,
                            // and "it is bolted to your Breakers" is a thing they can act on.
                            disabled={dead || fit.isPending}
                            data-testid={`slot-option-${upgrade.id}`}
                            aria-disabled={dead}
                            onClick={() => {
                              /*
                               * Into the first empty bracket, whichever one was pressed (maintainer
                               * request, 2026-09-15). Three empty brackets are one decision, and a
                               * card that landed in the third because that was the `+` under the
                               * cursor left two gaps to the left of it. `open` still says which
                               * bracket the picker was opened from, for the "already here" state; it
                               * is not where the card goes. The server refuses anything else
                               * (`skipped_slot`), so this is the screen agreeing with the rule rather
                               * than the rule living in the screen.
                               */
                              if (target === null) return;
                              fit.mutate(
                                { unitId: unit.id, slot: target, upgradeId: upgrade.id },
                                { onSuccess: () => setOpen(null) },
                              );
                            }}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-sm border px-3 py-2 text-left transition-colors',
                              here
                                ? 'border-brass-300/70 bg-brass-300/10'
                                : 'border-surface-600/70 bg-surface-950/40 hover:border-brass-300/60',
                              dead && 'opacity-45',
                            )}
                          >
                            <YardGlyph
                              mark={{ kind: 'rarity', rarity: upgrade.rarity }}
                              className={cn('mt-0.5 h-4 w-4 shrink-0', RARITY_TEXT[upgrade.rarity])}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                                <span className="min-w-0 break-words font-display text-[13px] font-bold text-ink-100">
                                  {upgrade.name}
                                </span>
                                <RarityTag rarity={upgrade.rarity} />
                              </span>
                              <span className="mt-0.5 block font-display text-[12px] tabular-nums text-brass-300">
                                {describeEffect(upgrade.effect)}
                              </span>
                              <span
                                className="mt-0.5 block font-body text-[12px] leading-snug text-ink-300"
                                data-testid={`slot-option-note-${upgrade.id}`}
                              >
                                {unfit
                                  ? `Not made for ${unit.name}. It goes on somebody else.`
                                  : here
                                    ? 'In this bracket. Burn it to take it out.'
                                    : fitted
                                      ? `Bolted to your ${upgrade.fittedToName}. Burn it to free it up.`
                                      : noRoom
                                        ? `Every bracket on your ${unit.name} is full. Burn one to make room.`
                                        : upgrade.description}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </Fragment>
                ))}
              </ul>
            )}

            {fit.isError && (
              <p className="font-body text-[12px] text-oxblood-300">{fit.error.message}</p>
            )}
            {burn.isError && (
              <p className="font-body text-[12px] text-oxblood-300">{burn.error.message}</p>
            )}

            <div className="flex justify-between gap-2">
              {/*
               * §D5c: the only way one ever comes off, and it destroys the thing.
               *
               * This was "Empty it", which handed the modification back and made the whole
               * decision free: a crew could walk one plate around the roster to suit whatever
               * they were about to field. Burning it costs the plate, so choosing where it goes
               * is worth thinking about and changing your mind is worth something.
               */}
              <button
                type="button"
                disabled={unit.slots[open]?.upgradeId === null || burn.isPending}
                data-sound="confirm"
                onClick={() => {
                  const fitted = unit.slots[open]?.upgradeId;
                  if (!fitted) return;
                  burn.mutate({ upgradeId: fitted }, { onSuccess: () => setOpen(null) });
                }}
                data-testid={`burn-${unit.id}`}
                className="brushed relative rounded-sm border border-surface-600/70 px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-300 transition-colors hover:border-oxblood-300/70 hover:text-oxblood-300 disabled:opacity-40"
              >
                {burn.isPending ? 'Burning…' : 'Burn it'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="brushed relative rounded-sm border border-brass-300/60 px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300 transition-colors hover:bg-brass-300/10"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** One bracket: what is bolted in, or the fact that there is room. */
function SlotBracket({
  slot,
  index,
  disabled,
  onOpen,
}: {
  slot: FittedSlot;
  index: number;
  disabled: boolean;
  onOpen: () => void;
}) {
  const filled = slot.upgradeId !== null && slot.rarity !== null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid={`slot-${index}`}
      // The name and what it does live on the hover, not in the bracket: at the width a bracket
      // has it can hold the grade's mark and the grade's word and nothing else, and a truncated
      // `Composite Cara…` is the cut label the maintainer's bar forbids outright.
      data-tip={
        filled
          ? `${slot.name} · ${MODIFICATION_RARITY_LABELS[slot.rarity!]} · ${describeEffect(slot.effect)}`
          : `Bracket ${index + 1} · empty`
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
          <YardGlyph mark={{ kind: 'rarity', rarity: slot.rarity! }} className="h-3.5 w-3.5" />
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
