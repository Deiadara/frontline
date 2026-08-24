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
      <aside className="glass w-full rounded-sm border border-surface-600/80 p-4 shadow-panel">
        <p className="font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
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
      className="glass flex w-full flex-col gap-4 rounded-sm border border-surface-600/80 p-4 shadow-panel"
      data-testid="district-panel"
    >
      <div>
        <p className="font-display text-[11px] uppercase tracking-[0.22em] text-brass-300">
          {district.nickname ?? (district.kind === 'residential' ? 'Residential' : 'Contested')}
        </p>
        <h2 className="mt-1 font-display text-lg font-bold tracking-[0.05em] text-ink-100">
          {district.name}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag label={`Difficulty ${district.difficulty}`} />
          <Tag label={`${travelMinutes} min away`} />
          {isHome && <Tag label="Home" tone="mine" />}
          {district.seatOfPower && <Tag label="Seat of power" tone="hostile" />}
        </div>
      </div>

      <p className="font-body text-xs leading-relaxed text-ink-300">{district.blurb}</p>

      {!scouted ? (
        <div className="flex flex-col gap-3 border-t border-surface-700 pt-3">
          <p className="font-body text-xs leading-relaxed text-ink-300">
            Nobody from this crew has been here. You do not know what is inside, who is holding it,
            or how hard it would be to take.
          </p>
          <Button size="sm" disabled={pending} onClick={() => onScout(district.id)}>
            {pending ? 'Working…' : 'Send scouts'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-surface-700 pt-3">
          {district.kind === 'contested' ? (
            <>
              <Row label="Locations held">
                <span
                  data-testid="locations-held"
                  className={cn(
                    'font-display text-sm font-semibold tabular-nums',
                    mine ? 'text-brass-300' : 'text-ink-100',
                  )}
                >
                  {held?.mine ?? 0} / {held?.total ?? 0}
                </span>
              </Row>
              <Row label="District held by">
                <span className="font-display text-xs tracking-[0.1em] text-ink-200">
                  {holder === null
                    ? 'Nobody. It is split'
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
                <span className="font-display text-xs tracking-[0.1em] text-ink-200">
                  {base?.name ?? 'Nobody lives here'}
                </span>
              </Row>
              <p className="font-body text-xs leading-relaxed text-ink-300">
                {isHome
                  ? 'Your own ground. Nobody can take it off you. They can still rob it.'
                  : 'A crew lives here. Home ground can never be captured, only raided.'}
              </p>
              {raidable && (
                <Button size="sm" variant="danger" onClick={() => onRaid(district.id)}>
                  Plan a raid
                </Button>
              )}
            </>
          )}
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
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
      <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
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
        'border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
        tone === 'mine' && 'border-brass-300/50 text-brass-300',
        tone === 'hostile' && 'border-oxblood-500/50 text-oxblood-300',
        tone === 'plain' && 'border-surface-600 text-ink-300',
      )}
    >
      {label}
    </span>
  );
}
