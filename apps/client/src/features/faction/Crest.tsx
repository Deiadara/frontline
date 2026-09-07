import { BADGE_COLOR_VALUES, FACTION_RANK_LABELS, type FactionResponse } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { OnArt } from '../game/PlateRoom';
import { FactionBadge, PropGlyph } from './FactionBadge';
import { seatTicks } from './geometry';

/**
 * What is pinned to the wall: the badge, the name, the motto, and your own rank at this table.
 *
 * Top left of the room, over the pinboard of photographs and string the painting has there, which
 * is the one stretch of wall in the picture with nobody in front of it. Narrow on purpose: the
 * banner hangs at a third of the way across and the man standing at the table is just right of
 * that, so the crest stops short of both at every width.
 */

/** The seal the badge is pressed into: two open rings and a ring of ticks between them. */
function Seal() {
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      <g className="text-brass-500" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M50 3 A47 47 0 1 1 49.5 3" strokeWidth="2" opacity="0.8" />
        <path d="M50 10 A40 40 0 1 1 49.6 10" strokeWidth="1.1" opacity="0.4" />
        {seatTicks(16, 46, 5).map((tick, index) => (
          <path key={index} d={tick} strokeWidth="1.6" opacity="0.5" />
        ))}
      </g>
    </svg>
  );
}

export function Crest({
  faction,
  rank,
}: {
  faction: NonNullable<FactionResponse['faction']>;
  rank: FactionResponse['rank'];
}) {
  const badge = faction.badge;

  return (
    <OnArt className="pointer-events-auto w-[18rem] overflow-hidden px-3 py-2.5 xl:w-[20rem]">
      <div data-testid="faction-identity">
        {/* The emblem again at the weight of a watermark on headed paper. */}
        {badge.prop !== 'blank' && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-[4%] top-1/2 -translate-y-1/2 opacity-[0.05]"
          >
            <PropGlyph prop={badge.prop} color={BADGE_COLOR_VALUES[badge.ink].hex} size={96} />
          </span>
        )}

        <div className="relative z-[1] flex min-w-0 items-center gap-3">
          <span className="relative flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center">
            <Seal />
            <FactionBadge badge={badge} size={32} title={`${faction.name}'s badge`} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="min-w-0 truncate font-stamp text-[19px] leading-tight text-ink-100 xl:text-[21px]">
              {faction.name}
            </h1>
            <span className="font-display text-[9.5px] uppercase tracking-[0.16em] text-brass-300">
              {rank ? FACTION_RANK_LABELS[rank] : 'Guest'} · since {faction.foundedAt.slice(0, 10)}
            </span>
          </div>
        </div>
        <p className="relative z-[1] mt-1.5 line-clamp-2 font-body text-[11.5px] italic leading-snug text-ink-300">
          <Icon name="edit" aria-hidden className="mr-1 inline h-3 w-3 text-brass-300" />
          {faction.blurb || 'Nothing written down about what this table is for.'}
        </p>
      </div>
    </OnArt>
  );
}
