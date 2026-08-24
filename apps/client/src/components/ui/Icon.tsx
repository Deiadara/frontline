import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * One icon set, one stroke language.
 *
 * Before this the interface drew glyphs wherever it needed one: a path inline in the nav, a
 * different path inline in a resource chip, an emoji-ish character in a name plate. They were drawn
 * at different weights on different grids, which is why nothing looked like it came from the same
 * hand. Everything here is on a 24-unit grid at a single stroke weight, with round joins and caps,
 * so a research icon and a nav icon are visibly siblings.
 *
 * Stroked rather than filled on purpose: the artwork is dense and painterly, and a solid glyph on
 * top of it reads as a sticker. An outline reads as something etched into the panel it sits on.
 *
 * Adding one: draw it on the 24 grid, keep it to the shared `S` stroke, and prefer two or three
 * confident shapes over literal detail: at 20px nothing smaller than about 2 units survives.
 */

export const ICON_NAMES = [
  'city',
  'district',
  'units',
  'missions',
  'bar',
  'research',
  'crew',
  'market',
  'caps',
  'food',
  'oil',
  'scrap',
  'metal',
  'power',
  'morale',
  'infamy',
  'population',
  'build',
  'lock',
  'clock',
  'edit',
  'info',
  'chevron-up',
  'chevron-down',
  'check',
  'close',
  'flask',
  'gear',
  'shield',
  'sword',
  'battles',
  'eye',
  'spark',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The shared stroke. Every path in the set uses it and nothing overrides the weight. */
const S = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

const PATHS: Record<IconName, ReactNode> = {
  city: (
    <>
      <path d="M3 21h18" {...S} />
      <path d="M5 21V9l5-3 5 3v12" {...S} />
      <path d="M15 21V13l4-2v10" {...S} />
      <path d="M9 21v-4h2v4" {...S} />
      <path d="M8 12h.01M12 12h.01M8 15h.01M12 15h.01" {...S} />
    </>
  ),
  district: (
    <>
      <path d="M3 20h18" {...S} />
      <path d="M4 20l4-8h8l4 8" {...S} />
      <path d="M8.5 12V7l3.5-3 3.5 3v5" {...S} />
      <path d="M11 20v-3h2v3" {...S} />
    </>
  ),
  units: (
    <>
      <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" {...S} />
      <path d="M12 9v5" {...S} />
      <path d="M9.5 11.5h5" {...S} />
    </>
  ),
  missions: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M12 7v5.5l3.5 2" {...S} />
    </>
  ),
  bar: (
    <>
      <path d="M5 4h14l-6 7.5V19" {...S} />
      <path d="M8.5 19h7" {...S} />
      <path d="M7.5 7.5h9" {...S} />
    </>
  ),
  research: (
    <>
      <path d="M6 3h12" {...S} />
      <path d="M9 3v6.2L5.2 17A2.2 2.2 0 0 0 7.1 20h9.8a2.2 2.2 0 0 0 1.9-3L15 9.2V3" {...S} />
      <path d="M7.6 14h8.8" {...S} />
    </>
  ),
  crew: (
    <>
      <circle cx="9" cy="8" r="3" {...S} />
      <circle cx="16.5" cy="9.5" r="2.2" {...S} />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" {...S} />
      <path d="M16 14c2.5 0 4.5 1.6 4.5 4" {...S} />
    </>
  ),
  market: (
    <>
      <path d="M4 8h16l-1.6 11H5.6z" {...S} />
      <path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" {...S} />
      <path d="M9 12v3M15 12v3" {...S} />
    </>
  ),
  caps: (
    <>
      <circle cx="12" cy="12" r="7.5" {...S} />
      <circle cx="12" cy="12" r="3" {...S} />
      <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" {...S} />
    </>
  ),
  food: (
    <>
      <path d="M12 20c-3.5 0-6-2.8-6-6.5C6 9 9 5 12 3c3 2 6 6 6 10.5 0 3.7-2.5 6.5-6 6.5z" {...S} />
      <path d="M12 20V9" {...S} />
      <path d="M12 13l2.5-2.5M12 16l-2.5-2.5" {...S} />
    </>
  ),
  oil: (
    <>
      <path d="M12 3.5c3.4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.6-6 6-10z" {...S} />
      <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" {...S} />
    </>
  ),
  scrap: (
    <>
      <path d="M4 18l4-8 4 4 3-5 5 9z" {...S} />
      <path d="M8.5 6.5l2-2 2 2-2 2z" {...S} />
    </>
  ),
  metal: (
    <>
      <path d="M5 8.5L12 5l7 3.5-7 3.5z" {...S} />
      <path d="M5 12.5L12 16l7-3.5" {...S} />
      <path d="M5 16L12 19.5 19 16" {...S} />
    </>
  ),
  power: (
    <>
      <path d="M13.5 3L6 13.5h5L10.5 21 18 10.5h-5z" {...S} />
    </>
  ),
  /**
   * Morale is a face, not a heart.
   *
   * A heart is health in every other game a player has touched, and morale is not health. It is
   * how the crew feels about working for you. This is one of them: X for eyes, a mohawk, and a
   * grin, which reads at 20px and says "the people" rather than "hit points".
   */
  morale: (
    <>
      <circle cx="12" cy="13" r="7.5" {...S} />
      {/* The crest. Three spikes, because two reads as ears and four turns to mush at chip size. */}
      <path d="M8 6.6L9.2 3.4 10.6 6M12 5.6V2.4M13.4 6L14.8 3.4 16 6.6" {...S} />
      {/* X eyes. */}
      <path d="M8.4 10.6l2 2M10.4 10.6l-2 2" {...S} />
      <path d="M13.6 10.6l2 2M15.6 10.6l-2 2" {...S} />
      {/* The grin. */}
      <path d="M8.8 15.6a4 4 0 0 0 6.4 0" {...S} />
    </>
  ),
  /**
   * Infamy is the ace of spades: the card you get dealt once and never live down.
   *
   * A star said "rating out of five", which is the opposite of what this meter is: nobody is
   * pleased about your infamy. The spade carries the right connotation without a word on it.
   */
  /**
   * §D7, the ace of spades, and it is a *card* rather than a cartoon.
   *
   * The old mark was a stroked playing-card rectangle with an outlined pip and a stem drawn inside
   * it, at 1.6px on a 24px box: three concentric outlines fighting for the same eleven pixels, so
   * at HUD size it read as a smudge with a bump on it. This is one solid spade, filled, with the
   * card behind it reduced to a thin frame and the two corner pips a real card has. Filled shapes
   * survive being drawn small; outlines do not.
   */
  infamy: (
    <>
      <rect
        x="4"
        y="2.4"
        width="16"
        height="19.2"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.75"
      />
      {/* The pip: a heart rotated onto its point with a stem under it, which is what a spade is. */}
      <path
        d="M12 6.2c-1.1 1.5-2.1 2.4-2.9 3.2-.9.9-1.4 1.7-1.4 2.6a2.35 2.35 0 0 0 3.5 2.05c-.15 1-.6 1.85-1.35 2.55h4.3c-.75-.7-1.2-1.55-1.35-2.55a2.35 2.35 0 0 0 3.5-2.05c0-.9-.5-1.7-1.4-2.6-.8-.8-1.8-1.7-2.9-3.2z"
        fill="currentColor"
      />
      {/* The corner marks. Two tiny solid spades are what makes a rectangle read as a card. */}
      <path
        d="M6.6 4.3c-.5.65-1 .95-1 1.5a.72.72 0 0 0 1 .65.72.72 0 0 0 1-.65c0-.55-.5-.85-1-1.5z"
        fill="currentColor"
      />
      <path
        d="M17.4 19.7c.5-.65 1-.95 1-1.5a.72.72 0 0 0-1-.65.72.72 0 0 0-1 .65c0 .55.5.85 1 1.5z"
        fill="currentColor"
      />
    </>
  ),
  population: (
    <>
      <circle cx="12" cy="8" r="3.2" {...S} />
      <path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" {...S} />
    </>
  ),
  build: (
    <>
      <path
        d="M14.5 3.5a4.5 4.5 0 0 0-5.6 5.6L3.5 14.5V20h5.5l5.4-5.4a4.5 4.5 0 0 0 5.6-5.6l-3 3-2.5-2.5z"
        {...S}
      />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.6" {...S} />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" {...S} />
      <path d="M12 14v2.5" {...S} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M12 7.5V12l3 1.8" {...S} />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" {...S} />
      <path d="M13.5 6.5l4 4" {...S} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M12 11v5.5" {...S} />
      <path d="M12 7.6h.01" {...S} />
    </>
  ),
  'chevron-up': <path d="M6 14.5l6-5.5 6 5.5" {...S} />,
  'chevron-down': <path d="M6 9.5l6 5.5 6-5.5" {...S} />,
  check: <path d="M5 12.5l4.5 4.5L19 7" {...S} />,
  close: <path d="M6 6l12 12M18 6L6 18" {...S} />,
  flask: (
    <>
      <path d="M9 3v6L5.4 16.6A2 2 0 0 0 7.2 19.5h9.6a2 2 0 0 0 1.8-2.9L15 9V3" {...S} />
      <path d="M7.8 3h8.4" {...S} />
      <path d="M8 14h8" {...S} />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" {...S} />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"
        {...S}
      />
    </>
  ),
  shield: <path d="M12 3.5l7 2.8v5.4c0 4-2.9 7.5-7 8.8-4.1-1.3-7-4.8-7-8.8V6.3z" {...S} />,
  sword: (
    <>
      <path d="M19.5 4.5L11 13l-1.5 3.5L6 18l1.5-3.5L16 6z" {...S} />
      <path d="M6.5 15.5L4 18l2 2 2.5-2.5" {...S} />
    </>
  ),
  // Crossed blades over a shield: the one glyph in the set that has to read as "a fight is
  // happening" at 22px in a standing bar, so it is the arrangement every strategy game uses for it
  // rather than a cleverer one nobody would recognise.
  battles: (
    <>
      <path d="M12 3.2l6.4 2.5v4.8c0 3.6-2.6 6.8-6.4 8-3.8-1.2-6.4-4.4-6.4-8V5.7z" {...S} />
      <path d="M8.4 8.2l7.2 7.2M15.6 8.2l-7.2 7.2" {...S} />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" {...S} />
      <circle cx="12" cy="12" r="2.8" {...S} />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" {...S} />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Tailwind size classes. Defaults to `h-5 w-5`. */
  className?: string;
  /**
   * A label makes the icon meaningful on its own; without one it is decoration and is hidden.
   *
   * Most icons in this app sit next to their own words, and announcing both is noise, so the
   * default is `aria-hidden`, and a caller that uses an icon *instead* of a word has to say what it
   * means. That is the way round that fails safely.
   */
  label?: string;
}

export function Icon({ name, className, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-5 w-5 shrink-0', className)}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {PATHS[name]}
    </svg>
  );
}
