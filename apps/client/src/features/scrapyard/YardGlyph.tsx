import type { ModificationEffect, ModificationRarity } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * The marks the yard cuts into its plates (maintainer request, 2026-09-10).
 *
 * Sixty-seven entries on one page, in three kinds, and until now every row was a name and a
 * sentence. A player scanning for "the one that shortens builds" had to read. So every entry
 * carries a stencil now: one glyph per **effect channel** for the structure modifications (a cog
 * for output, a stopwatch for build time, a stacked crate for storage), one per **rarity** for the
 * unit modifications, one per **trap**. Thirteen channels rather than seventy-seven bespoke
 * drawings, because the channel is what a player is choosing between: two Quarters bolt-ons that
 * both add beds are the same decision at two prices, and they should look like it.
 *
 * The unit cards used to carry one mark per refit line (armour, weapons, discipline, cybernetics).
 * The lines went with the refits (2026-09-15) and the thirty cards that replaced them have no axis
 * of their own but the rarity, so that is what the mark says: how much engineering went into it.
 * Which of the thirty a card is comes off its name and its row of deltas, and the rarity's colour
 * (`rarity.tsx`) sits on the plate beside the shape.
 *
 * Drawn here rather than fetched: procedural art is the default source for every asset key (art
 * policy, 2026-08-13), and stroked line drawings in one weight are the thing code does well. The
 * hand is the stencil's: every glyph is drawn in a 24 by 24 box with the same round-capped pen, so
 * they share one optical weight on the plate whatever size they are cut at. The board's masters,
 * if they land, replace this file and nothing else.
 *
 * Deliberately **not** the archive's turbulence-inked sigils (`TrackSigil`): that hand is ink on a
 * card, and the yard is metal. These sit flat on a `plate` and read as cut steel.
 */

const EFFECT_GLYPHS: Readonly<Record<ModificationEffect, string[]>> = {
  // A cog: this structure's own output.
  production_percent: [
    'M12 8.5a3.5 3.5 0 1 0 .1 0z',
    'M12 3v2.5',
    'M12 18.5V21',
    'M3 12h2.5',
    'M18.5 12H21',
    'M5.6 5.6l1.8 1.8',
    'M16.6 16.6l1.8 1.8',
    'M18.4 5.6l-1.8 1.8',
    'M7.4 16.6l-1.8 1.8',
  ],
  // A price tag with a line through the figure.
  build_cost_reduction: [
    'M3 12l8.5-8.5H20v8.5L11.5 20.5z',
    'M16.4 6.6a.8.8 0 1 0 .1 0z',
    'M8 14l4-4',
  ],
  // A stopwatch, hand past the mark.
  build_time_reduction: [
    'M12 7a6.5 6.5 0 1 0 .1 0z',
    'M12 10v3.5l2.5 1.5',
    'M10 3.5h4',
    'M12 3.5V7',
    'M17.5 6.5l1.5-1.5',
  ],
  // Crates, stacked.
  storage_percent: ['M4 13h8v8H4z', 'M12 13h8v8h-8z', 'M8 5h8v8H8z', 'M8 9h8'],
  // A shield with a seam down it.
  defense_percent: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M12 6v12'],
  // A banner on its pole.
  faction_xp_percent: ['M6 3v18', 'M6 4h12l-3 4 3 4H6'],
  // A test tube with the level marked.
  research_time_reduction: ['M9 3h6', 'M10 3v13a2 2 0 0 0 4 0V3', 'M10 12h4'],
  // A bunk frame: two rails, two decks, a pillow.
  housing_percent: ['M4 4v17', 'M20 4v17', 'M4 10h16', 'M4 16h16', 'M6.5 7.5h5v2.5'],
  // The wage book.
  payroll_percent: [
    'M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z',
    'M5 19a2 2 0 0 1 2-2h12',
    'M9 8h6',
    'M9 12h6',
  ],
  // A sack, tied at the neck.
  raid_loot_percent: [
    'M9 4h6l-1.5 3h-3z',
    'M10.5 7C6 9 5 13 5 16a7 7 0 0 0 14 0c0-3-1-7-5.5-9',
    'M10 15h4',
  ],
  // A bar with its plates.
  training_time_reduction: ['M3 10v4', 'M6 8v8', 'M18 8v8', 'M21 10v4', 'M6 12h12'],
  // A ration tin.
  training_supplies_reduction: [
    'M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    'M4 8l2-3h12l2 3',
    'M8 13h8',
  ],
};

const RARITY_GLYPHS: Readonly<Record<ModificationRarity, string[]>> = {
  // A nut: one piece of stock, threaded and done.
  basic: ['M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z', 'M12 9a3 3 0 1 0 .1 0z'],
  // Two cogs meshed: somebody who knows which way they turn.
  intricate: [
    'M9 5.5a3.5 3.5 0 1 0 .1 0z',
    'M9 3v1.5',
    'M9 13.5V15',
    'M3 9h1.5',
    'M13.5 9H15',
    'M16.5 13.5a2.5 2.5 0 1 0 .1 0z',
    'M16.5 12v1',
    'M16.5 19v1',
    'M12.5 16h1',
    'M19.5 16h1',
  ],
  // A chip with its legs: engineering, and the bill that comes with it.
  advanced: [
    'M8 8h8v8H8z',
    'M10 8V5',
    'M14 8V5',
    'M10 16v3',
    'M14 16v3',
    'M8 10H5',
    'M8 14H5',
    'M16 10h3',
    'M16 14h3',
  ],
  // A maker's seal: the star inside the ring, the way the people known by name sign their work.
  masterpiece: [
    'M12 4a8 8 0 1 0 .1 0z',
    'M12 7.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1L12 14.6 9.2 16.1l.6-3.1-2.3-2.2 3.1-.4z',
  ],
};

const TRAP_GLYPHS: Readonly<Record<string, string[]>> = {
  // Boards over a stairwell, one of them raised.
  trap_pressure_plates: [
    'M3 12h18',
    'M3 17h18',
    'M6 12v5',
    'M12 12v5',
    'M18 12v5',
    'M8 12V9h8v3',
    'M12 9V6',
    'M10 6h4',
  ],
  // A shell with the gas already leaking under it.
  trap_gas_shell: [
    'M9 4h6v9a3 3 0 0 1-6 0z',
    'M12 4V2',
    'M9 8h6',
    'M5 17c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0',
    'M4 20.5c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0',
  ],
  // A frontage with the crack already in it.
  trap_collapse: ['M4 21h16', 'M6 21V8l7-5 5 5v13', 'M13 3v5l-3 2 3 3-2 4 2 4', 'M9 21v-5'],
  // Two pickets and the tape strung between them, barbs and all.
  trap_razor_wire: [
    'M5 21V9',
    'M19 21V9',
    'M5 12c4-2 6 2 10-1 1.5-1 3-1 4 0',
    'M5 17c4-2 6 2 10-1 1.5-1 3-1 4 0',
    'M9 10.5l1.5-1.5M14 9.5l1.5 1.5M9 15.5l1.5-1.5M14 14.5l1.5 1.5',
  ],
  // A drum tipped into its pit, the charge under it, the flame already out of the mouth.
  trap_fuel_fougasse: [
    'M3 21h18',
    'M6 21v-6l4-3h5l3 3v6',
    'M10 12V8.5a2.5 2.5 0 0 1 5 0V12',
    'M12.5 3c0 2-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-2-2-2-4z',
  ],
  // A cellar in section, the water line across it and the bus bars dropped in.
  trap_flooded_cellar: [
    'M3 4h18',
    'M5 4v16h14V4',
    'M5 13c2-1 4 1 6 0s4-1 6 0 2 0 2 0',
    'M9 8v9M15 8v9',
    'M8 17h2M14 17h2',
  ],
};
const UNKNOWN_TRAP = ['M4 20l16-16', 'M4 4l16 16'];

/** The yard's own mark: a cutting torch, lit. */
const TORCH = [
  'M3 21l6-6',
  'M8 14l3-3 2 2-3 3z',
  'M13 11l3-3',
  'M16 8c0-2.5 1.5-4 3.5-5 .3 2-.3 3.6-1.6 4.7',
  'M17.5 9.5l2 2',
];

export type YardMark =
  | { kind: 'effect'; effect: ModificationEffect }
  | { kind: 'rarity'; rarity: ModificationRarity }
  | { kind: 'trap'; id: string }
  | { kind: 'yard' };

function pathsOf(mark: YardMark): string[] {
  switch (mark.kind) {
    case 'effect':
      return EFFECT_GLYPHS[mark.effect];
    case 'rarity':
      return RARITY_GLYPHS[mark.rarity];
    case 'trap':
      return TRAP_GLYPHS[mark.id] ?? UNKNOWN_TRAP;
    case 'yard':
      return TORCH;
  }
}

/** The glyph on its own, in the current colour. Sized by the caller. */
export function YardGlyph({ mark, className }: { mark: YardMark; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {pathsOf(mark).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The glyph on a steel plate, which is how every entry on the yard's board carries it.
 *
 * `tone` follows the row's state: brass for a thing the yard can cut today, bile for one already
 * built, ink for one that is shut. The plate itself does not change, so a player reads state off
 * the mark's colour and identity off its shape.
 */
export function YardPlate({
  mark,
  tone = 'ink',
  size = 'md',
  count = null,
  className,
}: {
  mark: YardMark;
  tone?: 'brass' | 'bile' | 'ink' | 'oxblood';
  size?: 'sm' | 'md' | 'lg';
  /**
   * How many of this thing the crew holds, stamped on the corner of the plate.
   *
   * A count is a fact about the object the glyph already names, so it rides on the glyph rather
   * than taking a line of its own under it (maintainer request, 2026-09-15). The plate is
   * `aria-hidden`, so a caller that shows one owes a readable copy of the number elsewhere.
   */
  count?: number | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'steel-plate flex shrink-0 items-center justify-center rounded-sm',
        size === 'sm' ? 'h-8 w-8' : size === 'md' ? 'h-11 w-11' : 'h-14 w-14',
        tone === 'brass'
          ? 'text-brass-300'
          : tone === 'bile'
            ? 'text-bile-300'
            : tone === 'oxblood'
              ? 'text-oxblood-300'
              : 'text-ink-300',
        className,
      )}
    >
      <YardGlyph
        mark={mark}
        className={size === 'sm' ? 'h-5 w-5' : size === 'md' ? 'h-7 w-7' : 'h-9 w-9'}
      />
      {count !== null && count > 0 && (
        <span
          className={cn(
            'absolute -bottom-1.5 -right-1.5 rounded-sm border border-bile-300/60 bg-surface-950',
            'px-1 font-display text-[10px] font-bold leading-[1.4] tabular-nums text-bile-300',
          )}
        >
          ×{count}
        </span>
      )}
    </span>
  );
}
