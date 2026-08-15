import { HOLDER_LABELS, garrisonOf, type DistrictSummary } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

/**
 * The right-hand panel: whichever district is selected on the map (GDD §A4).
 *
 * It answers three questions and stops: whose is it, how far away is it, and what can I do about
 * it. Anything about the *inside* of a district belongs to the district view — this panel is the
 * map's caption, not a second screen.
 */

interface ContextPanelProps {
  entry: DistrictSummary | null;
  myBaseId: string | null;
  pending: boolean;
  onScout: (districtId: string) => void;
  onEnter: (districtId: string) => void;
  onRaid: (districtId: string) => void;
}

export function ContextPanel({
  entry,
  myBaseId,
  pending,
  onScout,
  onEnter,
  onRaid,
}: ContextPanelProps) {
  if (!entry) {
    return (
      <aside className="w-80 shrink-0 border-l border-neon-cyan/20 bg-night-raised p-4">
        <p className="font-display text-[10px] uppercase tracking-[0.2em] text-steel-500">
          Pick somewhere on the map
        </p>
      </aside>
    );
  }

  const { district, scouted, held, holder, base, isHome, travelMinutes } = entry;
  const mine = holder?.kind === 'faction' && holder.baseId === myBaseId;
  const raidable = base !== null && base.id !== myBaseId && district.kind === 'residential';

  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neon-cyan/20 bg-night-raised p-4"
      data-testid="district-panel"
    >
      <div>
        <p className="font-display text-[10px] uppercase tracking-[0.3em] text-neon-cyan/70">
          {district.nickname ?? (district.kind === 'residential' ? 'Residential' : 'Contested')}
        </p>
        <h2 className="text-glow-cyan mt-1 font-display text-lg font-bold tracking-[0.1em] text-steel-100">
          {district.name}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag label={`Difficulty ${district.difficulty}`} />
          <Tag label={`${travelMinutes} min away`} />
          {isHome && <Tag label="Home" tone="mine" />}
          {district.seatOfPower && <Tag label="Seat of power" tone="hostile" />}
        </div>
      </div>

      <p className="font-body text-xs leading-relaxed text-steel-400">{district.blurb}</p>

      {!scouted ? (
        <div className="flex flex-col gap-3 border-t border-steel-800 pt-3">
          <p className="font-body text-xs leading-relaxed text-steel-500">
            Nobody from this crew has been here. You do not know what is inside, who is holding it,
            or how hard it would be to take.
          </p>
          <Button size="sm" disabled={pending} onClick={() => onScout(district.id)}>
            {pending ? 'Working…' : 'Send scouts'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-steel-800 pt-3">
          {district.kind === 'contested' ? (
            <>
              <Row label="Places held">
                <span
                  data-testid="places-held"
                  className={cn(
                    'font-display text-sm font-semibold tabular-nums',
                    mine ? 'text-neon-cyan' : 'text-steel-100',
                  )}
                >
                  {held?.mine ?? 0} / {held?.total ?? 0}
                </span>
              </Row>
              <Row label="District held by">
                <span className="font-display text-xs tracking-[0.1em] text-steel-300">
                  {holder === null
                    ? 'Nobody — it is split'
                    : holder.kind === 'faction'
                      ? mine
                        ? 'You'
                        : 'Another crew'
                      : HOLDER_LABELS[holder.kind]}
                </span>
              </Row>
              <Button size="sm" onClick={() => onEnter(district.id)}>
                Enter the district
              </Button>
            </>
          ) : (
            <>
              <Row label="Crew">
                <span className="font-display text-xs tracking-[0.1em] text-steel-300">
                  {base?.name ?? 'Nobody lives here'}
                </span>
              </Row>
              <p className="font-body text-xs leading-relaxed text-steel-500">
                {isHome
                  ? 'Your own ground. It cannot be taken off you — but it can be robbed.'
                  : 'A crew lives here. Home ground can never be captured, only raided.'}
              </p>
              {raidable && (
                <Button size="sm" variant="danger" onClick={() => onRaid(district.id)}>
                  Plan a raid
                </Button>
              )}
            </>
          )}
          <p className="font-body text-[11px] leading-relaxed text-steel-600">
            Garrison: {garrisonOf(district)}.
          </p>
        </div>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'mine' | 'hostile' }) {
  return (
    <span
      className={cn(
        'border px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.16em]',
        tone === 'mine' && 'border-neon-cyan/50 text-neon-cyan',
        tone === 'hostile' && 'border-neon-magenta/50 text-neon-magenta',
        tone === 'plain' && 'border-steel-700 text-steel-400',
      )}
    >
      {label}
    </span>
  );
}
