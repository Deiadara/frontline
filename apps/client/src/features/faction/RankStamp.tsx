import { FACTION_RANK_LABELS, type FactionRank } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * What rank somebody holds, pressed onto their card.
 *
 * The same grammar as the officer mark: a ring that does not close, struck off the square, in ink
 * that loaded unevenly. A rank is the one thing on a roster card that was *done to* the file after
 * it was filed, which is what a stamp means, and it is also the only way to say it without adding a
 * fourth line of type to a card that is meant to read as a picture.
 *
 * Three colours, in the order of how much a rank carries: oxblood for the one person who can end
 * the faction, brass for the ones who can fill it, and quiet ink for everybody else. A roster of
 * five is then two loud stamps and three soft ones rather than five competing badges.
 */

const TONE: Record<FactionRank, string> = {
  leader: 'text-oxblood-300',
  chief: 'text-brass-300',
  member: 'text-ink-400',
};

export function RankStamp({ rank, className }: { rank: FactionRank; className?: string }) {
  const label = FACTION_RANK_LABELS[rank].toUpperCase();
  return (
    <span className={cn('pointer-events-none select-none', TONE[rank], className)} aria-hidden>
      <svg viewBox="0 0 150 64" className="h-full w-full overflow-visible">
        <defs>
          <filter id="rank-ink" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="5" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g transform="rotate(-8 75 32)" filter="url(#rank-ink)">
          {/* Round once and a bit, and open where the hand came off the paper. */}
          <path
            d="M75 4 A70 27 0 1 1 74.4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.6"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M12 30 A62 21 0 0 1 138 30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.45"
          />
          <text
            x="75"
            y="33"
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            className="font-display font-bold"
            // In user units so the word fills the ring at whatever size the card renders it.
            style={{ fontSize: '25px', letterSpacing: '0.1em' }}
          >
            {label}
          </text>
        </g>
      </svg>
    </span>
  );
}
