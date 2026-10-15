import type { LocationView } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { PressError } from '../../components/ui/PressError';
import { cn } from '../../lib/cn';
import { useThrowLamps } from '../../lib/queries';
import { formatRemaining } from '../base/format';

/*
 * Lampman's Row (maintainer, 2026-10-09): the holder lights the lamps or puts them out, on the
 * row's own sheet, the way the Tolling Tower's switch is thrown. Refused on the button first
 * (greyed, the wait on hover); what slips past is a `PressError` beside it, so nothing moves.
 */

const HEADING = 'font-display text-[11px] uppercase tracking-[0.16em] text-brass-300';
const NOTE = 'font-body text-[12px] leading-relaxed text-ink-200';

export function LampsSwitch({
  lamps,
  now,
  baseId,
  districtId,
  locationId,
}: {
  lamps: NonNullable<LocationView['lamps']>;
  now: Date;
  baseId: string | undefined;
  districtId: string;
  locationId: string;
}) {
  const throwLamps = useThrowLamps(baseId, districtId);
  const waitMs = lamps.changesAt === null ? 0 : Date.parse(lamps.changesAt) - now.getTime();
  const refusal =
    waitMs > 0 ? `Changed recently, ${formatRemaining(waitMs)} before they change again` : null;
  const where = lamps.wholeCity ? 'every location in the city' : 'every location in the district';
  const tiers = `${lamps.tiers} tier${lamps.tiers === 1 ? '' : 's'}`;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5"
      data-testid={`lamps-${locationId}`}
    >
      <span className={HEADING} data-testid={`lamps-state-${locationId}`}>
        {lamps.lit ? 'The lamps are lit' : 'The lamps are out'}
      </span>
      <p className={cn(NOTE, 'min-w-0 flex-1')}>
        {lamps.lit
          ? `Dark and Foggy are ${tiers} lighter on ${where}. Put them out and they are ${tiers} heavier.`
          : `Dark and Foggy are ${tiers} heavier on ${where}. Light them and they are ${tiers} lighter.`}
      </p>
      <Button
        size="sm"
        refusal={refusal}
        disabled={throwLamps.isPending}
        data-testid={`lamps-throw-${locationId}`}
        onClick={() => throwLamps.mutate({ locationId, lit: !lamps.lit })}
      >
        {throwLamps.isPending ? 'Changing…' : lamps.lit ? 'Put them out' : 'Light them'}
      </Button>
      {throwLamps.error && (
        <PressError onDismiss={throwLamps.reset}>{throwLamps.error.message}</PressError>
      )}
    </div>
  );
}
