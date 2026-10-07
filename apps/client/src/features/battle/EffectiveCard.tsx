import {
  bareLineRules,
  fightingSlots,
  outnumberedWeight,
  UNIT_STAT_LABELS,
  effectiveStats,
  findUnit,
  noTerritoryEffects,
  type BattleView,
  type Effective,
  type StatKey,
  type UnitStats,
  fittedFor,
  type UnitLoadouts,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { cn } from '../../lib/cn';
import { UnitPortrait } from '../units/UnitPortrait';
import { UnitTrigger } from '../units/UnitWindow';
import { sideAtTheMark } from './odds';

/**
 * A unit's sheet against the numbers it will actually fight with here (GDD §A4).
 *
 * The characteristics row two inches above says a place is Noisy III and Crammed II. This is the
 * other half of that sentence: what those two chips are *worth to this unit*, on the ground of this
 * fight, on the side the reader is on. Until now a player could read both halves and had no way to
 * put them together short of doing the arithmetic in `city/labels.ts` by hand, which is exactly the
 * arithmetic the game exists to do for them.
 *
 * `effectiveStats` is the engine's own function, the one `battle/engine.ts` runs when the fight
 * settles, so the figures on this card are the figures the fight uses rather than a second estimate
 * that agrees by inspection. Its `reasons` come out with it and are printed underneath: a number
 * with no reason beside it is a number a player cannot plan against.
 *
 * ## What it cannot see, and does not pretend to
 *
 * One input is simply not on `BattleView`: the crew's **territory effects** are a fact about
 * everything it holds, so the card passes `noTerritoryEffects()` and the figures are the ground, the
 * unit and the cards bolted to it. That only ever moves the effective column, never the sheet, and
 * it is stated on the card rather than left for a player to discover from a report that disagrees.
 */

/** The seven the maintainer asked for, in the order a player reads a sheet. */
type ShownStat = Extract<
  StatKey,
  'offense' | 'vitality' | 'armor' | 'speed' | 'evasion' | 'stealth' | 'morale'
>;

const SHOWN: readonly ShownStat[] = [
  'offense',
  'vitality',
  'armor',
  'speed',
  'evasion',
  'stealth',
  'morale',
];

/** The `Effective` fields that pair with each. Named rather than indexed: the two structs differ. */
const EFFECTIVE_OF: Readonly<Record<ShownStat, keyof Effective>> = {
  offense: 'offense',
  vitality: 'vitality',
  armor: 'armor',
  speed: 'speed',
  evasion: 'evasion',
  stealth: 'stealth',
  morale: 'morale',
};

function sideOf(view: BattleView): { defending: boolean; outnumbered: number } {
  const unknown = { defending: view.side === 'defender', outnumbered: 0 };
  // Unknown is not outnumbered. A crew that cannot count the other side is told so in `enemyIntel`
  // and must not have a modifier switched on for them off a number nobody has.
  if (view.enemySize === null || !view.muster) return unknown;
  /*
   * In unit slots in the line, as the engine weighs Last Stand (`fightingSlots`): by heads, twenty
   * Wardens read as outnumbered two to one by forty Razors of the same weight (bug pass,
   * 2026-10-02). Heads against heads only when the report counted bodies and named none.
   */
  /*
   * The line as the engine weighs it (bug pass, 2026-10-06): the deployment and whoever stands on
   * the ground with it, and not the ring, which fights apart (`battle/resolve.ts`). It counted the
   * ring in and the garrison out, so a defence held by its garrison read badly outnumbered and one
   * with most of its force on the ring read as not outnumbered at all.
   */
  const line = sideAtTheMark(view.muster);
  if (!view.enemyArmy) {
    const heads = Object.values(line).reduce((total, count) => total + count, 0);
    return { ...unknown, outnumbered: outnumberedWeight(view.enemySize, heads) };
  }
  const rules = bareLineRules();
  const mine = fightingSlots(line, rules);
  return { ...unknown, outnumbered: outnumberedWeight(fightingSlots(view.enemyArmy, rules), mine) };
}

/** The change, as a whole percent, or null where the sheet is zero and a ratio says nothing. */
function changePercent(sheet: number, effective: number): number | null {
  if (sheet === 0) return null;
  return Math.round(((effective - sheet) / sheet) * 100);
}

export function EffectiveCard({
  unitId,
  view,
  loadouts = {},
}: {
  unitId: string;
  view: BattleView;
  /** The crew's brackets (`Base.unitLoadouts`); what is bolted to this unit is folded in. */
  loadouts?: UnitLoadouts;
}) {
  const unit = findUnit(unitId);
  if (!unit) return null;

  const side = sideOf(view);
  // With the unit's own cards, which the engine folds in the same way (`battle/resolve.ts` passes
  // the attacker's loadouts). Without them this card showed the catalogue sheet under a footer
  // claiming the workshop could only add, while Scrap Vest costs a point of speed.
  const effective = effectiveStats(
    unit,
    view.battlefield,
    side,
    noTerritoryEffects(),
    fittedFor(loadouts, unitId),
  );
  const sheet: UnitStats = unit.stats;

  return (
    // The eyebrow is the ground and only the ground (maintainer request, 2026-09-15). It read
    // "Neon Docks - coming for it", and which side of a fight you are on is the one fact the
    // screen around this card has already said three times over.
    <InfoWindow
      eyebrow={view.battlefield.locationName}
      title={unit.name}
      plate="none"
      icon={<UnitPortrait unitId={unit.id} tier={unit.tier} fill />}
    >
      <WindowSection label="On this ground">
        <table
          className="w-full border-collapse font-display text-[12px] tabular-nums"
          data-testid={`effective-${unitId}`}
        >
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-ink-300">
              <th className="py-0.5 text-left font-normal">Stat</th>
              <th className="py-0.5 text-right font-normal">Sheet</th>
              <th className="py-0.5 text-right font-normal">Here</th>
              <th className="py-0.5 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {SHOWN.map((key) => {
              const was = sheet[key];
              const now = Math.round(effective[EFFECTIVE_OF[key]] as number);
              const change = changePercent(was, now);
              return (
                <tr
                  key={key}
                  className="border-t border-surface-700/70"
                  data-testid={`effective-${unitId}-${key}`}
                >
                  <td className="py-0.5 pr-2 text-left uppercase tracking-[0.08em] text-ink-300">
                    {UNIT_STAT_LABELS[key]}
                  </td>
                  <td className="py-0.5 text-right text-ink-300">{was}</td>
                  <td className="py-0.5 pl-2 text-right font-bold text-ink-100">{now}</td>
                  <td
                    className={cn(
                      'py-0.5 pl-2 text-right font-bold',
                      change === null || change === 0
                        ? 'text-ink-400'
                        : change > 0
                          ? 'text-verdigris-100'
                          : 'text-oxblood-300',
                    )}
                  >
                    {change === null ? '·' : `${change > 0 ? '+' : ''}${change}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </WindowSection>

      {effective.reasons.length > 0 && (
        <WindowSection label="Why">
          <ul className="flex flex-col">
            {effective.reasons.map((reason) => (
              <li
                key={reason}
                className="font-display text-[12px] uppercase leading-relaxed tracking-[0.1em] text-ink-200"
              >
                {reason}
              </li>
            ))}
          </ul>
        </WindowSection>
      )}

      <p className="font-body text-[11px] leading-snug text-ink-400">
        The ground, the unit and its fittings. Your holdings are not counted here.
      </p>
    </InfoWindow>
  );
}

/**
 * The trigger for anything inside a fight that is *not* a chip: the deploy dialog's "On this
 * ground" link is the caller.
 *
 * A chip carries its own hover now (`UnitChip`, which opens the catalogue sheet), so the battle
 * screen hands that card this one instead of wrapping the chip in a second one: two nested hover
 * cards are two nested `<button>`s. The chip is also drawn on the Actions screen, where a column
 * on the road has no battlefield to be effective on and a card quoting one would be inventing the
 * fight it is walking to, which is why the effective reading stays a card the caller passes in
 * rather than something built into the chip.
 */
export function OnThisGround({
  unitId,
  view,
  loadouts = {},
  children,
  label,
  className = '',
}: {
  unitId: string;
  view: BattleView;
  loadouts?: UnitLoadouts;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    /*
     * Through `UnitTrigger` since 2026-09-20, so this reading is a **press** as well as a hover.
     *
     * The hover stays the effective one, which is the better answer to "what will this do here":
     * it is the engine's own `effectiveStats` against this ground rather than the catalogue's
     * middle of the road. What it could not do is be pointed at, and the marks on a sheet are
     * where the counterplay is written, so the press opens the unit's own card underneath it.
     * Same trigger, same button, one card the whole game agrees on.
     */
    <UnitTrigger
      unitId={unitId}
      label={label}
      className={className}
      size="window"
      card={<EffectiveCard unitId={unitId} view={view} loadouts={loadouts} />}
    >
      {children}
    </UnitTrigger>
  );
}
