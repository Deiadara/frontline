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
  'supplies',
  'oil',
  'scrap',
  'metal',
  'power',
  'morale',
  'infamy',
  'unit-slots',
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
  'actions',
  'eye',
  'spark',
  'loot',
  'level',
  'standings',
  'training',
  'workshop',
  'inventory',
  'physical',
  'mental',
  'social',
  'technical',
  'archive',
  'desk',
  'messages',
  'bell',
  'faction',
  'alert',
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

/**
 * The glyphs themselves, on the 24 grid, without the `<svg>` around them.
 *
 * Exported so a caller that needs the drawing inside a frame of its own can have it: the training
 * sheet stamps the four attribute-group glyphs into an inked roundel (`overseer/DrillSigil.tsx`)
 * and would otherwise have to redraw four shapes that are already drawn here, at a second weight,
 * which is the exact thing this file exists to stop. Use {@link Icon} for an icon; reach for this
 * only when the glyph is going somewhere an `<svg>` element cannot.
 */
export const ICON_GLYPHS: Record<IconName, ReactNode> = {
  /**
   * The city: three blocks of different heights, not one house (maintainer request, 2026-09-14).
   *
   * It was a single pitched-roof building with a lean-to, which reads as *a* building rather than
   * the place all of them are in, and at 20px it was hard to tell from the Market's stall. Three
   * masses of unequal height on one ground line is the shape a skyline makes, and the unequal
   * heights are what stop it reading as a fence.
   */
  city: (
    <>
      <path d="M2.5 20.5h19" {...S} />
      <path d="M4 20.5V11.5h5v9" {...S} />
      <path d="M9 20.5V5.5h6v15" {...S} />
      <path d="M15 20.5V9.5h5v11" {...S} />
      <path d="M11 9h.01M13 9h.01M11 12.5h.01M13 12.5h.01M6.2 15h.01M17.5 13h.01" {...S} />
    </>
  ),
  /**
   * The district: the gate into it (maintainer request, 2026-09-14).
   *
   * Two towers with an arch between them was the old mark, and the arch was small enough at 20px
   * that the pair read as two buildings, which is the City's job. A gate is the right idea anyway:
   * the district is the one place in the game with a door that can be shut, and the portcullis
   * bars say *shut* in a way no doorway does.
   */
  district: (
    <>
      <path d="M2.5 20.5h19" {...S} />
      <path d="M5 20.5V11a7 7 0 0 1 14 0v9.5" {...S} />
      <path d="M8.5 20.5v-9.6M12 20.5v-10.4M15.5 20.5v-9.6" {...S} />
      <path d="M6.1 13.9h11.8M5.3 17.2h13.4" {...S} />
    </>
  ),
  /**
   * The roster: the shield with the blades across it, handed over from `battles` (maintainer
   * request, 2026-09-14).
   *
   * It wore a helmet, then a plain shield, and now the mark the fights door used to carry: the
   * roster is the thing you take into a fight, so the arrangement reads correctly on it, and
   * `battles` keeps the blades alone. Nothing is duplicated, because the shield moved rather than
   * being copied.
   */
  units: (
    <>
      <path d="M12 3.2l6.4 2.5v4.8c0 3.6-2.6 6.8-6.4 8-3.8-1.2-6.4-4.4-6.4-8V5.7z" {...S} />
      <path d="M8.4 8.2l7.2 7.2M15.6 8.2l-7.2 7.2" {...S} />
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
      <path d="M3 9.5l2-5h14l2 5z" {...S} />
      <path d="M3 9.5h18" {...S} />
      <path d="M5.5 9.5V20.5h13V9.5" {...S} />
      <path d="M5.5 20.5h13" {...S} />
      <path d="M9.5 20.5v-5h5v5" {...S} />
    </>
  ),
  caps: (
    <>
      <circle cx="12" cy="12" r="7.5" {...S} />
      <circle cx="12" cy="12" r="3" {...S} />
      <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" {...S} />
    </>
  ),
  supplies: (
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
  /*
   * A head and shoulders, drawn (maintainer, 2026-09-22: "a hand drawn icon for it that is used
   * everywhere"). The ring round the head is open at the crown and overshoots itself, the
   * shoulders are one stroke that does not quite meet the ground on either side, and a short
   * second pass sits under the left shoulder: the same pen every drawn mark in the game is held
   * in. Used at 12px on a card's subtitle and at 16px on the district's slot chip, so every line
   * is a full stroke rather than a detail.
   */
  'unit-slots': (
    <>
      <path d="M12.6 4.7 A3.2 3.2 0 1 1 11.9 4.65 A3.2 3.2 0 0 1 13.4 5.2" {...S} />
      <path d="M5.4 20.3 C5.7 16.1 8.5 13.8 12.1 13.7 C15.6 13.7 18.3 16.1 18.6 19.9" {...S} />
      <path d="M5 20.6 L9.4 20.2" {...S} strokeWidth="1" opacity="0.45" />
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
  // A fight called on your ground: the mark on the bottom bar. A triangle and a bar, the road sign.
  alert: (
    <>
      <path d="M12 3.5 21 19.5H3z" {...S} />
      <path d="M12 9.5v4.5" {...S} />
      <path d="M12 16.6v.3" {...S} />
    </>
  ),
  /*
   * A padlock somebody drew rather than a glyph (maintainer, 2026-09-22: "use a hand drawn lock
   * everywhere"). The body is four strokes that do not quite close and are not quite square, the
   * shackle is an arc that lands a hair inside the body on one side and a hair outside on the
   * other, and the pen goes round the bottom edge a second time, short. Every `Icon name="lock"`
   * in the game draws this one, so the nav tiles, the shut doors and the card slots agree.
   */
  lock: (
    <>
      <path d="M5.3 10.8 L18.8 10.4 L19.1 19.6 L5 19.9 L5.2 11.2" {...S} />
      <path d="M8.6 10.7 L8.4 7.7 A3.6 3.6 0 0 1 15.5 7.3 L15.7 10.1" {...S} />
      <path d="M12.1 13.5 L11.9 16.3" {...S} />
      <path d="M5.4 20.2 L10.6 19.9" {...S} strokeWidth="1" opacity="0.45" />
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
  /**
   * A fight: two blades crossed, and nothing under them (maintainer request, 2026-09-14).
   *
   * The shield went to `units`, where a roster belongs, and took the "this is yours to defend"
   * reading with it. What is left is the clash itself, which is what this door is: a fight already
   * declared, not a thing being protected.
   *
   * Two blades, two crossguards, two pommels, and nothing else. The first cut drew the grips as
   * four short strokes below the crossing and they collapsed into clutter at 28px: at this size a
   * sword is a long line with one bar across it, and the bar is the whole reason it is not a
   * multiplication sign.
   */
  battles: (
    <>
      <path d="M4.4 4.4L17 17M19.6 4.4L7 17" {...S} />
      <path d="M13.6 16.4l3.4-3.4M10.4 16.4L7 13" {...S} />
      <path d="M16.2 19.6l2.8-2.8M7.8 19.6L5 16.8" {...S} />
    </>
  ),
  // An envelope. The one shape that has meant "mail" for long enough that nothing else needs to.
  messages: (
    <>
      <rect x="3.2" y="5.6" width="17.6" height="12.8" rx="1.6" {...S} />
      <path d="M3.8 6.6l8.2 6 8.2-6" {...S} />
    </>
  ),
  // A bell, with the clapper. Drawn open at the bottom rather than as a filled dome, so it reads
  // at 22px on a dark plate where a solid shape would just be a blob.
  bell: (
    <>
      <path
        d="M12 3.4a5.4 5.4 0 0 0-5.4 5.4c0 4-1.4 5.4-2.2 6.4h15.2c-.8-1-2.2-2.4-2.2-6.4A5.4 5.4 0 0 0 12 3.4z"
        {...S}
      />
      <path d="M10 18.2a2 2 0 0 0 4 0" {...S} />
    </>
  ),
  /**
   * The table: its badge (maintainer request, 2026-09-14).
   *
   * Three figures shoulder to shoulder was the old mark, and it sat two doors along from `crew`,
   * which is also people: at 20px "one person" and "three people" is a count a player has to stop
   * and make. A faction already *has* a badge in this game, drawn on its file and over its seats,
   * so the door wears the thing the room is full of.
   *
   * A star in a ring with two ribbon tails, rather than the shield `units` now wears: the whole
   * point of the swap was to stop two doors carrying the same silhouette.
   */
  faction: (
    <>
      <path d="M4.5 3.6h15" {...S} />
      <path d="M6.6 3.6v16.8l5.4-3.6 5.4 3.6V3.6" {...S} />
      <path d="M6.6 12.6l10.8-6" {...S} />
    </>
  ),
  /**
   * The Monitor: a screen with a trace running across it (maintainer request, 2026-09-14).
   *
   * The door was called Actions and wore a boot on a road, which is a picture of one column
   * walking. The screen answers what the door is actually for: every force that is out, all at
   * once, ticking. A boot is a thing that is happening; a monitor is where you watch all of them.
   *
   * The trace is a live readout rather than a chart line, so it steps rather than curving, and it
   * runs off both edges of the glass: something that is still going, caught mid-sweep.
   */
  actions: (
    <>
      <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="1.8" {...S} />
      <path d="M5.4 11.4h2.3l1.5-3.1 2 6 1.7-3.9 1.3 2.2h3.4" {...S} />
      <path d="M9.4 20.2h5.2" {...S} />
      <path d="M12 16.8v3.4" {...S} />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" {...S} />
      <circle cx="12" cy="12" r="2.8" {...S} />
    </>
  ),
  /**
   * Training: a weights bench under a loaded bar (maintainer request, 2026-09-14).
   *
   * It was a striking post with a target ring, which at 20px is a circle on a stick and reads like
   * a lamp or a signpost as readily as anything to do with work. A bar with plates on it is the
   * one shape that means *lifting* on sight, and the bench under it says where the work happens.
   *
   * The plates are drawn as short uprights rather than filled discs on purpose: at this weight a
   * filled circle on each end closes up into a blob by about 18px.
   */
  training: (
    <>
      <path d="M3.5 7.5v4M6 6.3v6.4M18 6.3v6.4M20.5 7.5v4" {...S} />
      <path d="M6 9.5h12" {...S} />
      <path d="M5.5 16.5h13" {...S} />
      <path d="M7.5 16.5v4M16.5 16.5v4" {...S} />
    </>
  ),
  /**
   * The Scrapyard: an anvil (maintainer request, 2026-09-14).
   *
   * A spanner said *workshop*, which is the room this one replaced; a heap of scrap said what is
   * lying in the yard but not what anybody does with it, and at 22px a jagged pile is a jagged
   * pile whatever it is made of. An anvil is the one shape in a forge nothing else is mistaken
   * for, and it says the yard is where metal is worked rather than where it is stacked.
   *
   * The waist cut in under the face is what makes it an anvil rather than a block: without it the
   * shape is a plinth. The horn is on the right, where the face steps down to it.
   */
  workshop: (
    <>
      <path d="M3.5 8.2h13.8l2.9-2.4v4.2a3.4 3.4 0 0 1-3.4 3.4h-3.6" {...S} />
      <path d="M3.5 8.2c1.6.6 2.7 1.7 3.1 3.1" {...S} />
      <path d="M13.2 13.4l-1.1 3.4" {...S} />
      <path d="M6.6 11.3l1.2 5.5" {...S} />
      <path d="M5.4 20.4h13.2l-1-3.6H6.4z" {...S} />
    </>
  ),
  /** The inventory: a flapped bag on a strap. It wore the crew's two faces, which is a room of people. */
  inventory: (
    <>
      <rect x="3.5" y="7" width="17" height="12.5" rx="1.6" {...S} />
      <path d="M9.5 7v12.5" {...S} />
      <path d="M14.5 7v12.5" {...S} />
      <path d="M9.5 11.5h5v3.5h-5z" {...S} />
    </>
  ),
  level: (
    <>
      <path d="M4 13.5 12 6l8 7.5" {...S} />
      <path d="M4 18.5 12 11l8 7.5" {...S} />
    </>
  ),
  /* Three steps of a podium, tallest in the middle. Deliberately nothing like `level`, which is a
     pair of chevrons: the standings door and the crew's own level chip sit two inches apart in the
     standing bar and were drawing the same mark. */
  standings: (
    <>
      <path d="M9.5 10.5h5v9.5h-5z" {...S} />
      <path d="M3.5 14h6v6h-6z" {...S} />
      <path d="M14.5 12.5h6v7.5h-6z" {...S} />
      <path
        d="M12 4.2l1.15 2.4 2.6.35-1.9 1.82.46 2.58L12 10.13l-2.31 1.22.46-2.58-1.9-1.82 2.6-.35z"
        {...S}
      />
    </>
  ),
  loot: (
    <>
      <path d="M5 9.5h14l-1.1 9.2a1.6 1.6 0 0 1-1.6 1.4H7.7a1.6 1.6 0 0 1-1.6-1.4z" {...S} />
      <path d="M8.6 9.5V7.2a3.4 3.4 0 0 1 6.8 0v2.3" {...S} />
      <path d="M5 9.5h14" {...S} />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" {...S} />
    </>
  ),
  /*
   * The four attribute groups, for the Training sheet's headers.
   *
   * Each is a *different kind of object* rather than four variations on a person, because the
   * point of them is to tell four columns apart at a glance: a bar, a head, a conversation, a
   * board. They deliberately avoid the marks already spoken for elsewhere in the set: `crew` is
   * two faces, `research` a flask and `workshop` a spanner, so none of those can be reused here
   * without making two doors read the same.
   */
  /** Physical: a loaded bar. */
  physical: (
    <>
      <path d="M3 12h18" {...S} />
      <path d="M6.5 8v8M9 6.5v11M15 6.5v11M17.5 8v8" {...S} />
    </>
  ),
  /** Mental: a head in profile with the works turning inside it. */
  mental: (
    <>
      <path d="M18.5 13.5a6.5 6.5 0 1 0-9.6 5.7V21" {...S} />
      <path d="M18.5 13.5h1.7l-1.7 3h-1.6v2.2a1.8 1.8 0 0 1-1.8 1.8h-2" {...S} />
      <circle cx="12.5" cy="11" r="2.4" {...S} />
      <path d="M12.5 6.8v1.8M12.5 13.4v1.8M8.3 11h1.8M14.9 11h1.8" {...S} />
    </>
  ),
  /** Social: two people talking, drawn as the talk rather than as the faces. */
  social: (
    <>
      <path
        d="M3.5 6.5h10a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3H3.5A1.5 1.5 0 0 1 2 12V8a1.5 1.5 0 0 1 1.5-1.5z"
        {...S}
      />
      <path d="M18 9.5h2.5A1.5 1.5 0 0 1 22 11v4a1.5 1.5 0 0 1-1.5 1.5H20v3l-3.5-3h-3" {...S} />
    </>
  ),
  /** The archive: a card index with one drawer out. What the crew has actually written down. */
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.4" {...S} />
      <path d="M3.5 9.5h17M3.5 14.5h17" {...S} />
      <path d="M10 7h4M10 12h4M10 17h4" {...S} />
    </>
  ),
  /** A desk: a sheet under a pen. Nothing draws it since the Lab's desk was retired (§I1e). */
  desk: (
    <>
      <path d="M5.5 3.5h8.4l4.6 4.5v12h-13z" {...S} />
      <path d="M13.5 3.5V8h5" {...S} />
      <path d="M8 12.5h6M8 16h4" {...S} />
    </>
  ),
  /** Technical: a board with its legs out. */
  technical: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.2" {...S} />
      <path d="M10.5 10.5h3v3h-3z" {...S} />
      <path d="M10 7.5V4.5M14 7.5V4.5M10 19.5v-3M14 19.5v-3" {...S} />
      <path d="M7.5 10H4.5M7.5 14H4.5M19.5 10h-3M19.5 14h-3" {...S} />
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
      {ICON_GLYPHS[name]}
    </svg>
  );
}
