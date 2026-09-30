import { useId, type ReactNode } from 'react';
import { DrawnGlyph, DrawnRule } from '../../components/ui/DrawnMarks';
import { Modal } from '../../components/ui/Modal';

/**
 * A plot nobody lives on, as a window over the city map (maintainer, 2026-09-30).
 *
 * It was a whole screen: a heading, a row of tags and one panel that said the plot was closed,
 * which is a lot of page for a place with nothing on it and nothing to do. It is a sheet now, the
 * way a location opens off a district painting (`location-window`), and like that window it goes
 * away on a click anywhere outside it or on Escape (`Modal`). The map stays up behind it, so the
 * player is still standing where they clicked.
 *
 * What it says is what is true of empty ground: where it is, what it is like, how far it is from
 * the reader's door, and that it is shut until a crew moves in. No difficulty and no garrison:
 * nothing stands on a plot until somebody builds there (maintainer, 2026-09-30).
 */
export function UnclaimedPlotWindow({
  name,
  blurb,
  travelMinutes,
  onClose,
}: {
  /** What the map calls it: `Player District II`. See `districtDisplayName`. */
  name: string;
  blurb: string;
  travelMinutes: number;
  onClose: () => void;
}) {
  return (
    <Modal
      onClose={onClose}
      labelledBy={TITLE_ID}
      data-testid="unclaimed-plot"
      // Read-only: nothing on it to press, so the cross is the one visible way out besides the
      // backdrop. See `Modal.dismissible`.
      dismissible
    >
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-5 pb-5 pt-4">
        <header className="flex items-start gap-3 pr-7">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-300">
              Residential plot
            </p>
            <h2
              id={TITLE_ID}
              className="break-words font-stamp text-[23px] leading-none text-ink-100"
            >
              {name}
            </h2>
            <span aria-hidden className="mt-1 block h-2 w-36 text-brass-300">
              <DrawnRule />
            </span>
          </div>
          <UnclaimedStamp />
        </header>

        <PlotPlan />

        <p className="font-body text-[13px] leading-relaxed text-ink-200">{blurb}</p>

        <dl className="grid grid-cols-2 gap-2.5">
          <PlotFact label="From your door">
            <DrawnGlyph name="clock" className="h-4 w-4 shrink-0 text-brass-300" />
            <span className="tabular-nums">{travelMinutes} min</span>
          </PlotFact>
          <PlotFact label="Standing on it">
            <DrawnGlyph name="district" className="h-4 w-4 shrink-0 text-brass-300" />
            Nobody yet
          </PlotFact>
        </dl>

        <p
          className="border-t border-surface-700/70 pt-2.5 font-body text-[12px] leading-relaxed text-ink-300"
          data-testid="unclaimed-plot-closed"
        >
          Nobody has claimed this plot. It stays closed to every crew until one moves in.
        </p>
      </div>
    </Modal>
  );
}

const TITLE_ID = 'unclaimed-plot-title';

function PlotFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ink-frame card-paper-lit flex min-w-0 flex-col gap-1 px-2.5 py-1.5">
      <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">{label}</dt>
      <dd className="flex items-center gap-1.5 font-stamp text-[15px] leading-tight text-ink-100">
        {children}
      </dd>
    </div>
  );
}

/**
 * The stamp on the deed: UNCLAIMED, pressed off the square in the red the officer marks and the
 * entry stamp use (`MarkStamp`, `AuthScreen`). A box rather than a ring, because it is a clerk's
 * stamp on a land registry and not a mark on a person.
 */
function UnclaimedStamp() {
  const id = useId();
  return (
    <svg
      viewBox="0 0 128 52"
      className="h-[46px] w-[113px] shrink-0 rotate-[-7deg] text-oxblood-300 opacity-90"
      role="img"
      aria-label="Unclaimed"
      data-testid="unclaimed-stamp"
    >
      <defs>
        <filter id={`stamp-${id}`} x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="19" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="2.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#stamp-${id})`}>
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          {/* Two frames, the outer one lifted early at the bottom right where the pad ran dry. */}
          <path d="M5 5 L123 4 L124 47 L88 47.5 M70 47.6 L4 48 Z" strokeWidth="3" />
          <path d="M11 11 L117 10.5 L117.5 41 L10.5 41.5 Z" strokeWidth="1.2" opacity="0.6" />
        </g>
        <text
          x="64"
          y="32"
          textAnchor="middle"
          fill="currentColor"
          style={{ font: '700 17px "Special Elite", monospace', letterSpacing: '0.12em' }}
        >
          UNCLAIMED
        </text>
      </g>
    </svg>
  );
}

/**
 * The plot, as the survey drew it: a pegged boundary on blueprint paper with nothing inside it but
 * rubble, a dead lamp and the stub of somebody's fence. It is the one picture a plot nobody has
 * built on can honestly have, and it says "empty ground you could take" before a word is read.
 *
 * Inked in the pen every drawn mark in the kit uses (`DrawnMarks`): one displacement filter over
 * the lot, with its id off `useId` for the reason that file gives.
 */
function PlotPlan() {
  const id = useId();
  return (
    <div
      className="drafting-grid relative overflow-hidden rounded-sm border border-brass-500/30"
      data-testid="plot-plan"
    >
      <svg
        viewBox="0 0 320 140"
        className="block h-auto w-full text-brass-300"
        role="img"
        aria-label="The plot as surveyed: an empty lot"
      >
        <defs>
          <filter id={`plan-${id}`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="29" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="1.6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g
          filter={`url(#plan-${id})`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* The boundary, pegged and dashed: the survey's line, not a wall anybody built. */}
          <path
            d="M46 26 L250 18 L270 112 L58 122 Z"
            strokeWidth="1.6"
            strokeDasharray="7 5"
            opacity="0.9"
          />
          {/* A peg at each corner. */}
          <path
            d="M42 22l8 8M50 22l-8 8M246 14l8 8M254 14l-8 8M266 108l8 8M274 108l-8 8M54 118l8 8M62 118l-8 8"
            strokeWidth="1.5"
          />
          {/* Somebody's fence, down the west side, with a gap where it came down. */}
          <path d="M60 36v12M63 58v12M66 92v12" strokeWidth="1.4" opacity="0.8" />
          <path d="M60 40 Q62 50 63 60 M65 92 Q66 98 66 102" strokeWidth="1" opacity="0.6" />
          {/* Rubble: a hatched heap and the loose bits off it. */}
          <path
            d="M96 96 L120 80 M104 100 L130 82 M114 102 L138 86 M126 102 L144 90"
            strokeWidth="1.2"
            opacity="0.75"
          />
          <path d="M92 100 C 104 78, 138 74, 150 100 Z" strokeWidth="1.3" opacity="0.85" />
          <circle cx="160" cy="104" r="2.2" strokeWidth="1.2" />
          <circle cx="170" cy="98" r="1.4" strokeWidth="1.1" />
          <circle cx="84" cy="106" r="1.8" strokeWidth="1.1" />
          {/* The lamp that has not been lit since the Combine stopped paying for it. */}
          <path d="M214 94 V46 Q214 38 222 38 H228" strokeWidth="1.6" />
          <path d="M224 38 L232 38 L230 44 L226 44 Z" strokeWidth="1.2" />
          <path d="M208 94 H220" strokeWidth="1.6" />
          {/* A tuft coming up through the slab. */}
          <path
            d="M244 104 l-3 -8 M247 104 l0 -10 M250 104 l3 -7"
            strokeWidth="1.1"
            opacity="0.8"
          />
          {/* The survey's own marks: a north arrow, and the frontage measured along the bottom. */}
          <path d="M296 40 V16 M290 24 L296 14 L302 24" strokeWidth="1.4" />
          <path d="M58 132 L270 124 M58 128 V136 M270 120 V128" strokeWidth="1" opacity="0.7" />
        </g>
        <g
          fill="currentColor"
          style={{ font: '400 10px "Special Elite", monospace', letterSpacing: '0.14em' }}
        >
          <text x="296" y="52" textAnchor="middle">
            N
          </text>
          <text x="164" y="60" textAnchor="middle" opacity="0.7">
            VACANT LOT
          </text>
        </g>
      </svg>
    </div>
  );
}
