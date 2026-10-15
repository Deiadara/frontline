import type { LocationView } from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { PressError } from '../../components/ui/PressError';
import { cn } from '../../lib/cn';
import { useChooseReactor } from '../../lib/queries';
import { formatRemaining } from '../base/format';

/*
 * The Reactor Shed (maintainer, 2026-10-14): the holder names one unit type to carry RADIOACTIVE,
 * and the choice is locked for 12 hours once made. Refused on the button first (greyed, the reason
 * on hover); what slips past is a `PressError` beside it, so nothing on the sheet moves.
 */

const HEADING = 'font-display text-[11px] uppercase tracking-[0.16em] text-brass-300';
const NOTE = 'font-body text-[12px] leading-relaxed text-ink-200';

export function ReactorPicker({
  reactor,
  mine,
  now,
  baseId,
  districtId,
  locationId,
}: {
  reactor: NonNullable<LocationView['reactor']>;
  mine: boolean;
  now: Date;
  baseId: string | undefined;
  districtId: string;
  locationId: string;
}) {
  const choose = useChooseReactor(baseId, districtId);
  const [picked, setPicked] = useState<string | null>(null);
  const current = reactor.options.find((option) => option.id === reactor.unitId)?.name;
  const waitMs = reactor.changesAt === null ? 0 : Date.parse(reactor.changesAt) - now.getTime();
  const refusal =
    picked === null
      ? 'Choose a unit first'
      : picked === reactor.unitId
        ? 'They are already Radioactive'
        : waitMs > 0
          ? `Locked, ${formatRemaining(waitMs)} before it can change`
          : null;
  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5"
      data-testid={`reactor-${locationId}`}
    >
      <span className={HEADING} data-testid={`reactor-state-${locationId}`}>
        {reactor.unitId === null
          ? 'Nobody is Radioactive yet'
          : `Radioactive: ${current ?? reactor.unitId}`}
      </span>
      <p className={NOTE}>
        Whenever one of them dies, it deals its vitality as damage to the stack that killed it,
        spread over the next 5 rounds. Once chosen, the choice is locked for 12 hours.
      </p>
      {mine && (
        <div className={cn('flex flex-wrap items-center gap-3')}>
          <Dropdown
            label="Radioactive unit"
            value={picked ?? ''}
            onChange={setPicked}
            data-testid={`reactor-unit-${locationId}`}
            options={reactor.options.map((option) => ({ value: option.id, label: option.name }))}
          />
          <Button
            size="sm"
            refusal={refusal}
            disabled={choose.isPending}
            data-testid={`reactor-choose-${locationId}`}
            onClick={() => {
              if (picked !== null) choose.mutate({ locationId, unitId: picked });
            }}
          >
            {choose.isPending ? 'Choosing…' : 'Make them Radioactive'}
          </Button>
          {choose.error && <PressError onDismiss={choose.reset}>{choose.error.message}</PressError>}
        </div>
      )}
    </div>
  );
}
