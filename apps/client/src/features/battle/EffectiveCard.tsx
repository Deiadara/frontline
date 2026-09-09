import {
  OUTNUMBERED_RATIO,
  UNIT_STAT_LABELS,
  effectiveStats,
  findUnit,
  noTerritoryEffects,
  type BattleView,
  type Effective,
  type StatKey,
  type UnitStats,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { cn } from '../../lib/cn';
import { UnitPortrait } from '../units/UnitPortrait';

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
 * Two inputs are simply not on `BattleView`. The crew's **territory effects** are a fact about
 * everything it holds, so the card passes `noTerritoryEffects()` and the figures are the ground and
 * the unit alone. The **workshop's refit** is per unit and also absent, so the sheet here is the
 * catalogue's. Both only ever move the effective column, never the sheet, and both are stated on
 * the card rather than left for a player to discover from a report that disagrees with it.
 */

/** The seven the board asked for, in the order a player reads a sheet. */
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

function sideOf(view: BattleView): { defending: boolean; outnumbered: boolean } {
  const mine = view.muster?.size ?? 0;
  const theirs = view.enemySize;
  return {
    defending: view.side === 'defender',
    // Unknown is not outnumbered. A crew that cannot count the other side is told so in `enemyIntel`
    // and must not have a modifier switched on for them off a number nobody has.
    outnumbered: theirs !== null && mine > 0 && theirs >= mine * OUTNUMBERED_RATIO,
  };
}

/** The change, as a whole percent, or null where the sheet is zero and a ratio says nothing. */
function changePercent(sheet: number, effective: number): number | null {
  if (sheet === 0) return null;
  return Math.round(((effective - sheet) / sheet) * 100);
}

export function EffectiveCard({ unitId, view }: { unitId: string; view: BattleView }) {
  const unit = findUnit(unitId);
  if (!unit) return null;

  const side = sideOf(view);
  const effective = effectiveStats(unit, view.battlefield, side, noTerritoryEffects());
  const sheet: UnitStats = unit.stats;

  return (
    <InfoWindow
      eyebrow={`${view.battlefield.locationName} · ${side.defending ? 'holding it' : 'coming for it'}`}
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
        The ground and this unit only. What your holdings and the workshop are worth is not on this
        payload, and both only ever add.
      </p>
    </InfoWindow>
  );
}

/**
 * The trigger. Anywhere a unit is named inside a fight, hovering it opens the card above.
 *
 * A wrapper rather than something built into `UnitChip`, because the chip is also drawn on the
 * Actions screen, where a column on the road has no battlefield to be effective on and a card
 * quoting one would be inventing the fight it is walking to.
 */
export function OnThisGround({
  unitId,
  view,
  children,
  label,
  className = '',
}: {
  unitId: string;
  view: BattleView;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <HoverCard
      label={label}
      size="window"
      className={className}
      card={<EffectiveCard unitId={unitId} view={view} />}
    >
      {children}
    </HoverCard>
  );
}
