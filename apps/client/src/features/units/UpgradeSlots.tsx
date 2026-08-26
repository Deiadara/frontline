import {
  UNIT_STAT_LABELS,
  UPGRADE_LINE_LABELS,
  type BuiltUpgrade,
  type FittedSlot,
  type StatKey,
  type UnitOption,
  type UpgradeLine,
} from '@frontline/shared';
import { useState } from 'react';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { useFitSlot } from '../../lib/queries';

/**
 * Three brackets on every unit, and the menu that fills one (GDD §A5, workshop extension).
 *
 * The workshop *builds* an upgrade; this is where it gets bolted to somebody. Three is the whole
 * design: a crew that has built all nine still has to say what the Razors are for, and the same
 * Hardshell Rig can go on two different units without being bought twice.
 *
 * Drawn as brackets rather than as a list of names, so an empty one reads as room rather than as
 * an absence: the card should invite the player to fill it before they know what any of it does.
 */

const LINE_ICON: Record<UpgradeLine, IconName> = {
  armour: 'shield',
  weapons: 'sword',
  cybernetics: 'spark',
};

/** Each line keeps the colour it has in the workshop, so a bracket is readable without its name. */
const LINE_TONE: Record<UpgradeLine, string> = {
  armour: 'border-hextech-100/50 text-hextech-100',
  weapons: 'border-oxblood-300/60 text-oxblood-300',
  cybernetics: 'border-brass-300/60 text-brass-300',
};

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
                Anything the workshop has built goes here, and it can go on more than one unit. It
                stays yours if you take it out.
              </p>
            </div>

            {built.length === 0 ? (
              <p className="rounded-sm border border-surface-600/70 bg-surface-950/40 px-3 py-4 text-center font-body text-[13px] text-ink-300">
                The workshop has not built anything yet.
              </p>
            ) : (
              <ul className="flex max-h-[22rem] flex-col gap-1.5 overflow-y-auto">
                {built.map((upgrade) => {
                  const here = unit.slots[open]?.upgradeId === upgrade.id;
                  const elsewhere = unit.slots.some(
                    (slot, index) => index !== open && slot.upgradeId === upgrade.id,
                  );
                  return (
                    <li key={upgrade.id}>
                      <button
                        type="button"
                        // Already in another bracket on this unit: shown rather than hidden, with
                        // the reason on it. A menu that silently drops an entry the player knows
                        // they own reads as a bug, and "it is already in bracket 2" is a thing
                        // they can act on.
                        disabled={elsewhere || fit.isPending}
                        onClick={() => {
                          fit.mutate(
                            { unitId: unit.id, slot: open, upgradeId: upgrade.id },
                            { onSuccess: () => setOpen(null) },
                          );
                        }}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-sm border px-3 py-2 text-left transition-colors',
                          here
                            ? 'border-brass-300/70 bg-brass-300/10'
                            : 'border-surface-600/70 bg-surface-950/40 hover:border-brass-300/60',
                          elsewhere && 'opacity-45',
                        )}
                      >
                        <Icon
                          name={LINE_ICON[upgrade.line]}
                          className="mt-0.5 h-4 w-4 shrink-0 text-ink-300"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-display text-[13px] font-bold text-ink-100">
                              {upgrade.name}
                            </span>
                            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                              {UPGRADE_LINE_LABELS[upgrade.line]} {upgrade.tier}
                            </span>
                          </span>
                          <span className="mt-0.5 block font-display text-[12px] tabular-nums text-brass-300">
                            {describeEffect(upgrade.effect)}
                          </span>
                          <span className="mt-0.5 block font-body text-[12px] leading-snug text-ink-300">
                            {elsewhere
                              ? 'Already in another bracket on this unit.'
                              : upgrade.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {fit.isError && (
              <p className="font-body text-[12px] text-oxblood-300">{fit.error.message}</p>
            )}

            <div className="flex justify-between gap-2">
              <button
                type="button"
                disabled={unit.slots[open]?.upgradeId === null || fit.isPending}
                onClick={() => {
                  fit.mutate(
                    { unitId: unit.id, slot: open, upgradeId: null },
                    { onSuccess: () => setOpen(null) },
                  );
                }}
                className="rounded-sm border border-surface-600/70 px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-300 transition-colors hover:border-oxblood-300/70 hover:text-oxblood-300 disabled:opacity-40"
              >
                Empty it
              </button>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-sm border border-brass-300/60 px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300 transition-colors hover:bg-brass-300/10"
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
  const filled = slot.upgradeId !== null && slot.line !== null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid={`slot-${index}`}
      // The name and what it does live on the hover, not in the bracket: at 60px the bracket can
      // hold an icon and a tier and nothing else, and a truncated `Composite Wea…` is the cut
      // label the board's bar forbids outright.
      data-tip={
        filled ? `${slot.name} · ${describeEffect(slot.effect)}` : `Bracket ${index + 1} · empty`
      }
      className={cn(
        'flex h-6 w-full items-center justify-center gap-1 rounded-sm border transition-colors',
        filled
          ? cn('bg-surface-950/50', LINE_TONE[slot.line!])
          : 'border-dashed border-surface-600/70 text-ink-300 hover:border-brass-300/60 hover:text-brass-300',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      {filled ? (
        <>
          <Icon name={LINE_ICON[slot.line!]} className="h-3.5 w-3.5" />
          <span className="font-display text-[11px] font-bold leading-none tabular-nums">
            {slot.tier}
          </span>
        </>
      ) : (
        <span className="font-display text-[13px] font-bold leading-none">+</span>
      )}
    </button>
  );
}
