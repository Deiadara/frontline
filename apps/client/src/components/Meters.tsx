import {
  METER_MAX,
  REPUTATION_LABEL_SPECS,
  type EconomyState,
  type Meter,
  type ReputationLabel,
} from '@frontline/shared';
import { cn } from '../lib/cn';

type MeterKind = 'morale' | 'infamy';

/** GDD §D4 morale and §D7 infamy. Infamy is notoriety, not virtue — so it reads hostile. */
const METER_META: Record<MeterKind, { label: string; fill: string; text: string }> = {
  morale: { label: 'Morale', fill: 'bg-bile-300', text: 'text-bile-300' },
  infamy: { label: 'Infamy', fill: 'bg-sear-300', text: 'text-sear-300' },
};

interface MeterChipProps {
  kind: MeterKind;
  value: Meter;
}

/** Compact 0..100 meter for the HUD strip. */
export function MeterChip({ kind, value }: MeterChipProps) {
  const meta = METER_META[kind];
  const pct = Math.max(0, Math.min(100, (value / METER_MAX) * 100));
  return (
    <div className="flex shrink-0 items-center gap-2 border border-steel-700 bg-night px-2.5 py-1.5">
      <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-400">
        {meta.label}
      </span>
      <span className="h-1.5 w-12 shrink-0 bg-steel-800">
        <span className={cn('block h-full', meta.fill)} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn('font-display text-sm font-semibold tabular-nums', meta.text)}>
        {Math.round(value)}
      </span>
    </div>
  );
}

/**
 * §D8 — reputation is a word, not a number. The label is derived from tallied actions, so it is
 * shown as the street's verdict rather than as a score the player can read off a bar.
 */
export function ReputationChip({ label }: { label: ReputationLabel }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border border-neon-cyan/30 bg-night px-2.5 py-1.5">
      <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-400">
        Reputation
      </span>
      <span className="font-display text-xs font-semibold tracking-[0.12em] text-neon-cyan">
        {label}
      </span>
    </div>
  );
}

interface StandingReadoutProps {
  economy: EconomyState;
  reputation: ReputationLabel;
}

/** The full standing block for the base screen: both meters plus the reputation the street uses. */
export function StandingReadout({ economy, reputation }: StandingReadoutProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <MeterChip kind="morale" value={economy.morale} />
        <MeterChip kind="infamy" value={economy.infamy} />
      </div>
      <div className="border border-neon-cyan/20 bg-night p-3">
        <p className="font-display text-[9px] uppercase tracking-[0.25em] text-steel-400">
          They call you
        </p>
        <p className="text-glow-cyan mt-1 font-display text-lg font-bold tracking-[0.12em] text-neon-cyan">
          {reputation}
        </p>
        <p className="mt-1 font-body text-[11px] leading-relaxed text-steel-400">
          {REPUTATION_LABEL_SPECS[reputation].description}
        </p>
      </div>
    </div>
  );
}
