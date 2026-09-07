import { cn } from '../../lib/cn';
import { sigilOf } from './sigil';

/**
 * A person at the table, drawn.
 *
 * A roster of names and numbers is a spreadsheet; a roster of faces is a crew. The payload carries
 * no portrait for a faction member and the board makes the real art, so this is the third option
 * the art policy leaves open: code-generated line work, in the same hand as `TrackSigil` and
 * `MarkStamp`, assembled from parts and picked by a hash of the account id (`sigil.ts`).
 *
 * Stroked rather than filled, on a 100 by 100 box, pushed through the same turbulence the officer
 * marks use. What that buys is a portrait that reads as a pen drawing at 64px on a card and does not
 * turn to mud: a filled silhouette at this size is a blob, and a shaded one is a smudge.
 *
 * Nobody here is meant to be recognisable. These are the goggles, respirators and welding hoods of
 * a city that lost the war, and the point of the set is that five people at a table look like five
 * different people.
 */

/** The head outline. Four skulls, so a table of five is never two of the same drawing twice over. */
const SKULLS: readonly string[] = [
  'M24 39 C24 21 35 12 50 12 C65 12 76 21 76 39 C76 55 66 66 50 66 C34 66 24 55 24 39 Z',
  'M28 37 C28 18 37 9 50 9 C63 9 72 18 72 37 C72 57 64 68 50 68 C36 68 28 57 28 37 Z',
  'M25 33 C25 19 34 13 50 13 C66 13 75 19 75 33 L75 49 C75 60 64 67 50 67 C36 67 25 60 25 49 Z',
  'M21 39 C21 21 33 13 50 13 C67 13 79 21 79 39 C79 54 68 65 50 65 C32 65 21 54 21 39 Z',
];

/** What is on the face. Every one of them sits inside the narrowest of the four skulls. */
const FACES: readonly (readonly string[])[] = [
  ['M35 39 h9', 'M56 39 h9', 'M43 54 h14'],
  ['M29 34 H71 V45 H29 Z', 'M43 56 h14'],
  [
    'M38 40 a7 7 0 1 1 -0.1 0',
    'M62 40 a7 7 0 1 1 -0.1 0',
    'M45 40 h10',
    'M31 37 L27 34',
    'M69 37 L73 34',
    'M43 55 h14',
  ],
  ['M35 34 h10', 'M55 34 h10', 'M35 45 H65 L61 61 H39 Z', 'M40 51 h20', 'M41 56 h18'],
  ['M31 33 L47 39 L47 46 L31 46 Z', 'M56 39 h9', 'M43 54 h13'],
];

/** What is on the head. `none` is one of them, so the set does not read as a hat shop. */
const HATS: readonly (readonly string[])[] = [
  [],
  ['M21 30 C25 16 36 8 50 8 C64 8 75 16 79 30 Z', 'M17 31 H83'],
  ['M16 58 C11 28 28 5 50 5 C72 5 89 28 84 58'],
  ['M50 3 L50 15', 'M41 6 L44 16', 'M59 6 L56 16', 'M33 19 C40 11 60 11 67 19'],
];

/** Neck and shoulders, the same on everybody: the variation is above the collar. */
const BODY: readonly string[] = [
  'M43 60 L43 72',
  'M57 60 L57 72',
  'M5 100 C9 79 26 71 50 71 C74 71 91 79 95 100',
  'M37 74 L50 84 L63 74',
];

export function MemberSigil({
  seed,
  name,
  className,
}: {
  /** The account id. Anything stable does: the same string is always the same face. */
  seed: string;
  /** Whose face it is, for anyone who cannot see it. */
  name: string;
  className?: string;
}) {
  const { skull, face, hat } = sigilOf(seed);
  const strokes = [
    ...BODY,
    SKULLS[skull] ?? SKULLS[0] ?? '',
    ...(FACES[face] ?? []),
    ...(HATS[hat] ?? []),
  ];

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={name}
    >
      <defs>
        {/* The same pad-and-paper roughening the officer mark and the track sigils use, so every
            drawn thing in this game reads as one hand. */}
        <filter id="member-ink" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="17" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g
        filter="url(#member-ink)"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {strokes.map((path, index) => (
          <path key={index} d={path} />
        ))}
      </g>
    </svg>
  );
}
