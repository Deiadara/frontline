import { OFFICER_ROLE_LABELS, type OfficerRole } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * The mark a research track is known by (§C4b).
 *
 * Nineteen tracks is too many to tell apart by a heading, and the game already has one visual
 * language for "somebody pressed this into the paper": the officer mark stamp. So a track gets a
 * sigil in the same hand. A roundel that does not quite close, a glyph inside it drawn in one
 * weight, and the whole thing pushed through the same turbulence the stamp uses, so it reads as
 * ink on a card rather than as an interface icon.
 *
 * Drawn here rather than fetched: procedural art is the default source for every asset key (art
 * policy, 2026-08-13), and nineteen small line drawings are exactly the thing code does well. The
 * board's masters, if they ever land, replace this file and nothing else.
 *
 * One glyph per role, each picked for the trade rather than for the word: the Cartographer gets a
 * compass rose, the Chief Medic a cross, the Salvager a grab. A player learns them the way they
 * learn a road sign, which is why they are simple and why none of them carries a letter.
 */

/** Every glyph is drawn stroked, in a 24 by 24 box, so they share one weight and one optical size. */
const GLYPHS: Readonly<Record<OfficerRole, string[]>> = {
  head_spy: ['M2 12c4-5 6-5 10-5s6 0 10 5c-4 5-6 5-10 5s-6 0-10-5z', 'M12 9.5v5'],
  lead_engineer: ['M4 19h16L4 5z', 'M8 19v-5'],
  finance_officer: [
    'M5 8c0-1.6 3.1-3 7-3s7 1.4 7 3-3.1 3-7 3-7-1.4-7-3z',
    'M5 8v8c0 1.7 3.1 3 7 3s7-1.3 7-3V8',
    'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  ],
  head_of_growth: [
    'M12 21V9',
    'M12 13C9 13 6 11 6 6c4.5 0 6 3 6 7z',
    'M12 15c3 0 6-2 6-6.5-4.5 0-6 3-6 6.5z',
  ],
  field_commander: ['M4 14l8-7 8 7', 'M4 20l8-7 8 7'],
  head_of_research: [
    'M9 3h6',
    'M10.5 3v6l-5 10a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3l-5-10V3',
    'M8 16h8',
  ],
  wetware_chief: ['M12 3a7 7 0 0 0-5 12v4h10v-4a7 7 0 0 0-5-12z', 'M15 9h5', 'M17.5 6.5v5'],
  fabricator: ['M3 21l7-7', 'M12 4l7 7-3 3-7-7z', 'M9 10l-2 2'],
  salvager: ['M6 4v6l6 5 6-5V4', 'M12 15v6', 'M8 21h8'],
  right_hand: [
    'M8 21v-6l-2-3a1.6 1.6 0 0 1 2.6-1.8L10 12V5a1.5 1.5 0 0 1 3 0v5',
    'M13 10V4a1.5 1.5 0 0 1 3 0v7',
    'M16 11V7a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6H8',
  ],
  cartographer: ['M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z', 'M12 9.5v5'],
  trader: [
    'M12 3v18',
    'M6 21h12',
    'M5 9l14-3',
    'M2 14a3 3 0 0 0 6 0l-3-5z',
    'M16 12a3 3 0 0 0 6 0l-3-5z',
  ],
  security_officer: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M8 12h8'],
  chief_medic: ['M12 3a9 9 0 1 0 .1 0z', 'M12 7v10', 'M7 12h10'],
  instructor_of_the_young: [
    'M12 6C9.5 4 6.5 4 4 5v14c2.5-1 5.5-1 8 1 2.5-2 5.5-2 8-1V5c-2.5-1-5.5-1-8 1z',
    'M12 6v14',
  ],
  raid_boss: [
    'M12 3a8 8 0 0 0-6 13.3V20h12v-3.7A8 8 0 0 0 12 3z',
    'M9.5 11h.01',
    'M14.5 11h.01',
    'M10 20v-2',
    'M14 20v-2',
  ],
  scout: ['M7 9a4 4 0 1 0 .1 0z', 'M17 9a4 4 0 1 0 .1 0z', 'M9 7l1-4h4l1 4', 'M11 13h2'],
  consigliere: ['M3 6h18v12H3z', 'M3 6l9 7 9-7', 'M18 17a2.5 2.5 0 1 0 .1 0z'],
  professor: [
    'M6.5 13a3.5 3.5 0 1 0 .1 0z',
    'M17.5 13a3.5 3.5 0 1 0 .1 0z',
    'M10 13h4',
    'M3 13V8a2 2 0 0 1 2-2h2',
    'M21 13V8a2 2 0 0 0-2-2h-2',
  ],
};

export function TrackSigil({
  role,
  className,
  ringed = true,
}: {
  role: OfficerRole;
  className?: string;
  /** The roundel around the glyph. Dropped where the tile already draws a frame of its own. */
  ringed?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`${OFFICER_ROLE_LABELS[role]} track`}
    >
      <defs>
        {/* The same pad-and-paper roughening the officer mark uses, so the two read as one hand. */}
        <filter id="track-ink" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="11" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g
        filter="url(#track-ink)"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ringed && (
          /* Open at the lower left, where a hand comes off the page. */
          <path
            d="M50 6 A44 44 0 1 1 49.6 6 M14 74 A44 44 0 0 0 86 74"
            strokeWidth="3.5"
            opacity="0.75"
          />
        )}
        <g transform="translate(26 26) scale(2)" strokeWidth={ringed ? 2 : 1.8}>
          {GLYPHS[role].map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
