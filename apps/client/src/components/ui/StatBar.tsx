import { cn } from '../../lib/cn';

type Tone = 'high' | 'mid' | 'low';

interface StatBarProps {
  label: string;
  value: number;
  max?: number;
}

const TONE_FILL: Record<Tone, string> = {
  high: 'bg-neon-cyan',
  mid: 'bg-warning',
  low: 'bg-neon-magenta',
};

/** FM-style rating tiers (out of 20): elite / capable / weak. */
function toneFor(value: number, max: number): Tone {
  const ratio = value / max;
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.4) return 'mid';
  return 'low';
}

/** Labelled 1..max rating bar used for overseer skills. */
export function StatBar({ label, value, max = 20 }: StatBarProps) {
  const tone = toneFor(value, max);
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2 leading-none">
      <span className="w-28 shrink-0 whitespace-nowrap font-display text-[10px] uppercase tracking-[0.15em] text-steel-400">
        {label}
      </span>
      <div className="h-1.5 min-w-0 flex-1 bg-steel-800">
        <div className={cn('h-full', TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-5 shrink-0 text-right font-display text-[11px] font-semibold tabular-nums text-steel-200">
        {value}
      </span>
    </div>
  );
}
