import {
  mulberry32,
  pageRarity,
  seedFrom,
  type BlueprintPage,
  type BlueprintSpec,
  type BlueprintTargetKind,
  type ItemRarity,
} from '@frontline/shared';
import type { JSX } from 'react';
import { cn } from '../../lib/cn';
import { RARITY_INK } from '../../lib/rarity';

/**
 * The drawing on a blueprint, and the drawing on each of its pages (§D8).
 *
 * There are forty-one documents and a hundred and sixty pages, and until now every one of them
 * drew the same folded sheet. A player holding four pages of the Colossus and two of the Garage
 * retrofit saw six copies of one picture, which is the same as seeing no picture: the sheet said
 * "this is paper" and nothing else, and the name underneath was doing all of the work.
 *
 * ## What a glyph is made of
 *
 * Three layers, and each one answers a different question a player has.
 *
 * 1. **The paper.** A page is a loose sheet with a torn left edge and a turned top corner; a
 *    document is a bound cover with a spine, stitches and the fore-edge of the pages inside it.
 *    That difference is in silhouette rather than in colour, so a page and the document it belongs
 *    to are still one glance apart for somebody who cannot separate the palette.
 * 2. **The drawing.** One primary motif that comes from what the document builds (a body for a
 *    unit, a chassis for a machine that drives, a rotor for one that flies, an elevation for a
 *    building, a gear for a fitted upgrade, a drum for a mixture, a bolted plate for a trap), plus
 *    a secondary and a tertiary motif drawn small in the margins, picked by the page's own id.
 *    Pages of one document therefore share a family and none of them share a picture.
 * 3. **The hand.** Drafting ticks, dimension runs and, at the largest size, a couple of pencilled
 *    note lines, all placed off the same seed. This is what stops the drawing reading as an icon.
 *
 * ## Why it is seeded rather than drawn
 *
 * A hundred and sixty hand-drawn sheets is the board's time, and the board draws the art (see the
 * art policy in CLAUDE.md). A seed is the honest way to get a hundred and sixty distinct pictures
 * out of code, and it is deterministic: the same id draws the same sheet on every screen, for
 * every player, in every render. `BlueprintGlyph.test.tsx` pins both halves of that.
 *
 * ## Size
 *
 * A glyph is asked for at 16px in a cost row, at 36px in a page row, and at 72px in a card head,
 * and eleven strokes inside a 16px box is a smudge. So detail is a prop: `sm` draws the paper and
 * the subject, `md` adds the second drawing along the foot, `lg` adds the pencilled note in the
 * corner and the drafting ticks. Nothing moves between the three, so a glyph does not change
 * identity when it changes size.
 *
 * If the board later hands over masters, this component is where they land: same call sites, same
 * sizes, same rarity ink around them.
 */

export type GlyphSize = 'sm' | 'md' | 'lg';

/** How many of the three motifs a size draws. */
const MOTIF_COUNT: Readonly<Record<GlyphSize, number>> = { sm: 1, md: 2, lg: 3 };

/**
 * The eleven things that can be on a sheet.
 *
 * Each is drawn inside a 12 by 12 box centred on the origin and placed by a transform, which is
 * what lets the same gear be the subject of one page and a margin note on another.
 *
 * Every motif takes a `pen` rather than writing its stroke widths out, and that is the whole of
 * how the line weight stays consistent. A margin mark is placed with `scale(0.68)`, and a plain
 * `strokeWidth="1.5"` inside it renders at 1.02, so the second drawing on a sheet came out visibly
 * thinner than the first and vanished at 36px. `pen` divides by the mark's own scale, so a 1.5 is
 * 1.5 on the paper wherever it is drawn and whatever it is drawn at.
 *
 * The three weights are a hierarchy and stay one: 1.5 is the subject's own line, 1.15 is the
 * detail inside it, 0.9 is annotation on it. The drafting ticks and pencil notes further down sit
 * at 0.85 and below, so a motif is always the heavier mark.
 */
type Pen = (weight: number) => number;

const MOTIFS = {
  // A boxed elevation with a centre line and a corner of section hatching: a building, or any
  // drawing whose subject is a space rather than a machine.
  schematic: (pen: Pen) => (
    <>
      <path d="M-5.4-4.6h10.8v9.2h-10.8z" strokeWidth={pen(1.5)} />
      <path d="M-5.4-1.3h10.8M-1.3-4.6v9.2" strokeWidth={pen(1.15)} opacity="0.75" />
      <path d="M1.6 4.2l3.4-3.4M-0.6 4.4l5.6-5.6" strokeWidth={pen(0.9)} opacity="0.6" />
    </>
  ),
  // A dimension run with its witness lines: the drawing that says how big.
  dimension: (pen: Pen) => (
    <>
      <path d="M-5.6 3.2h11.2M-5.6 1.7v3M5.6 1.7v3" strokeWidth={pen(1.5)} />
      <path d="M-5.6-4.4v6.2M5.6-4.4v6.2" strokeWidth={pen(1.15)} opacity="0.7" />
      <path d="M-2.2-1.4h4.4" strokeWidth={pen(0.9)} opacity="0.6" />
    </>
  ),
  // A gear: a part fitted to something that already turns.
  gear: (pen: Pen) => (
    <>
      <circle r="3.9" strokeWidth={pen(1.5)} />
      <circle r="1.4" strokeWidth={pen(1.15)} />
      <path
        d="M3.9 0h1.5M2.76 2.76l1.06 1.06M0 3.9v1.5M-2.76 2.76l-1.06 1.06M-3.9 0h-1.5M-2.76-2.76l-1.06-1.06M0-3.9v-1.5M2.76-2.76l1.06-1.06"
        strokeWidth={pen(1.5)}
      />
    </>
  ),
  // A chassis curve over two wheels: anything that drives.
  hull: (pen: Pen) => (
    <>
      <path d="M-5.8 1.8c1.4-4.2 3.4-5.6 5.8-5.6s4.4 1.4 5.8 5.6" strokeWidth={pen(1.5)} />
      <path d="M-5.8 1.8h11.6" strokeWidth={pen(1.15)} />
      <circle cx="-3.2" cy="3.2" r="1.6" strokeWidth={pen(1.15)} />
      <circle cx="3.2" cy="3.2" r="1.6" strokeWidth={pen(1.15)} />
      <path d="M-2.4-2.4h4.8" strokeWidth={pen(0.9)} opacity="0.65" />
    </>
  ),
  // A hub, three blades and the swash ring under them: anything that flies.
  rotor: (pen: Pen) => (
    <>
      <circle r="1.5" strokeWidth={pen(1.5)} />
      <path d="M0 0l5.6-2M0 0l-5.6-2M0 0v5.8" strokeWidth={pen(1.5)} />
      <path d="M-2.8 4.6h5.6" strokeWidth={pen(1.15)} opacity="0.7" />
      <circle r="3.4" strokeWidth={pen(0.9)} opacity="0.5" />
    </>
  ),
  // A trace running between two pads: wiring, and everything that goes in at the skull.
  circuit: (pen: Pen) => (
    <>
      <path d="M-5.6 4h3.4v-4h4.2v-4.2h3.6" strokeWidth={pen(1.5)} />
      <circle cx="-5.6" cy="4" r="1.05" strokeWidth={pen(1.15)} />
      <circle cx="5.6" cy="-4.2" r="1.05" strokeWidth={pen(1.15)} />
      <path d="M-2.2 1.8h-2.6M2-2.2v-2" strokeWidth={pen(0.9)} opacity="0.65" />
    </>
  ),
  // A plate and its bolt pattern: armour, and anything laid on the ground and fixed down.
  bolts: (pen: Pen) => (
    <>
      <path d="M-4.8-4.8h9.6v9.6h-9.6z" strokeWidth={pen(1.5)} />
      <circle cx="-2.9" cy="-2.9" r="0.95" strokeWidth={pen(1.15)} />
      <circle cx="2.9" cy="-2.9" r="0.95" strokeWidth={pen(1.15)} />
      <circle cx="-2.9" cy="2.9" r="0.95" strokeWidth={pen(1.15)} />
      <circle cx="2.9" cy="2.9" r="0.95" strokeWidth={pen(1.15)} />
      <path d="M-1.4 0h2.8M0-1.4v2.8" strokeWidth={pen(0.9)} opacity="0.7" />
    </>
  ),
  // An approval stamp, slightly askew because nobody ever lines one up.
  stamp: (pen: Pen) => (
    <g transform="rotate(-9)">
      <path d="M-5.6-3.4h11.2v6.8h-11.2z" strokeWidth={pen(1.5)} />
      <path d="M-3.6-1.2h7.2M-3.6 1.2h4.4" strokeWidth={pen(1.15)} />
      <path d="M-5.6-3.4l11.2 6.8" strokeWidth={pen(0.9)} opacity="0.45" />
    </g>
  ),
  // Three arcs of a ring somebody left a cup on. The only mark here nobody meant to make.
  coffee: (pen: Pen) => (
    <>
      <path d="M-4.8 1.1a4.9 4.9 0 0 1 3.1-5.6" strokeWidth={pen(1.5)} opacity="0.6" />
      <path d="M1.2-4.6a4.9 4.9 0 0 1 3.5 4" strokeWidth={pen(1.5)} opacity="0.6" />
      <path d="M4.4 0.8a4.9 4.9 0 0 1-7.4 3.4" strokeWidth={pen(1.5)} opacity="0.6" />
    </>
  ),
  // A body in elevation on a ground line: whatever walks out of the yard.
  figure: (pen: Pen) => (
    <>
      <circle cy="-3.2" r="1.9" strokeWidth={pen(1.5)} />
      <path d="M-4.2 4.4c0-3 1.9-4.7 4.2-4.7s4.2 1.7 4.2 4.7" strokeWidth={pen(1.5)} />
      <path d="M-4.2 4.4h8.4" strokeWidth={pen(1.15)} opacity="0.8" />
      <path d="M0-5.6v-1.2M-5.4 5.2h10.8" strokeWidth={pen(0.9)} opacity="0.6" />
    </>
  ),
  // A drum with a level line and a tap: anything mixed, cracked or carried in a container.
  vessel: (pen: Pen) => (
    <>
      <path d="M-3.8-4.2h7.6v6.9a3.8 3.8 0 0 1-7.6 0z" strokeWidth={pen(1.5)} />
      <path d="M-5-4.2h10" strokeWidth={pen(1.15)} />
      <path d="M-3.8-1.1h7.6" strokeWidth={pen(0.9)} opacity="0.7" />
      <path d="M2.6 3.4h2.2v2" strokeWidth={pen(1.15)} />
    </>
  ),
} as const satisfies Record<string, (pen: Pen) => JSX.Element>;

type Motif = keyof typeof MOTIFS;

const MOTIF_KEYS = Object.keys(MOTIFS) as readonly Motif[];

/** What the subject of the drawing is, from what the document builds. */
const FAMILY: Readonly<Record<BlueprintTargetKind, Motif>> = {
  unit: 'figure',
  vehicle: 'hull',
  unit_upgrade: 'gear',
  building: 'schematic',
  battle_boost: 'vessel',
  trap: 'bolts',
};

/**
 * The seven targets whose family motif would say the wrong thing.
 *
 * A Rotorcraft is a vehicle and drawing it as a chassis on two wheels is a lie about the machine
 * at the end of the document, which is the one thing this glyph is for.
 */
const BY_TARGET: Readonly<Record<string, Motif>> = {
  rotorcraft: 'rotor',
  heli_porter: 'rotor',
  gas_balloon: 'vessel',
  armour_2: 'bolts',
  armour_3: 'bolts',
  cybernetics_2: 'circuit',
  cybernetics_3: 'circuit',
};

function primaryMotif(blueprint: BlueprintSpec): Motif {
  const target = blueprint.targets[0];
  if (target === undefined) return 'schematic';
  return BY_TARGET[target.id] ?? FAMILY[target.kind];
}

/**
 * Where the drawing sits on the paper.
 *
 * Three zones rather than a centre and four corners, and the reason is 36px. With the subject in
 * the middle the second motif could only go in a corner, at about a fifth of the sheet, which at
 * 36px was a speck: eight pages of one document came out as eight copies of the subject with a
 * smudge in a different corner. So the subject sits high, the second drawing gets the whole foot
 * of the sheet at nearly the same size, and the third is a note in a top corner that only the
 * 64px glyph draws at all. Two drawings of comparable weight is what makes two pages of one
 * document different from across a room.
 */
interface Spot {
  x: number;
  y: number;
}

interface Plate {
  /** The subject: high on the sheet, upright, and the part that must survive 16px. */
  subject: Spot;
  /** Where the second drawing goes, along the foot. Picked by seed. */
  band: readonly Spot[];
  /** Where the pencilled third goes, at 64px only. */
  notes: readonly Spot[];
}

const PAGE_PLATE: Plate = {
  subject: { x: 25.5, y: 19 },
  band: [
    { x: 19, y: 33.5 },
    { x: 25.5, y: 34 },
    { x: 31.5, y: 33 },
  ],
  notes: [
    { x: 17, y: 12 },
    { x: 34, y: 26 },
  ],
};

const COVER_PLATE: Plate = {
  subject: { x: 27, y: 18.5 },
  band: [
    { x: 21.5, y: 29.5 },
    { x: 27.5, y: 30 },
    { x: 33, y: 29.5 },
  ],
  notes: [
    { x: 19.5, y: 10.5 },
    { x: 34, y: 10.5 },
  ],
};

interface Mark {
  motif: Motif;
  x: number;
  y: number;
  scale: number;
  angle: number;
  opacity: number;
}

/** Two decimals is past what a 48-unit box can show, and it keeps the markup comparable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pick<T>(items: readonly T[], random: () => number, fallback: T): T {
  return items[Math.floor(random() * items.length)] ?? fallback;
}

/**
 * The three motifs and where they go.
 *
 * The subject is upright and never moves, because a drawing whose main shape wanders is a
 * different drawing rather than the same one at another size. The second is turned a few degrees
 * and lands in one of three places along the foot; the third is a pencilled note in a corner. Both
 * come from the pool the subject is not in, so no sheet ever draws one shape twice.
 */
function composition(seed: string, primary: Motif, plate: Plate, subjectScale: number): Mark[] {
  const random = mulberry32(seedFrom(seed));
  const pool = MOTIF_KEYS.filter((motif) => motif !== primary);
  const second = pick(pool, random, 'dimension');
  const third = pick(
    pool.filter((motif) => motif !== second),
    random,
    'coffee',
  );
  const band = pick(plate.band, random, { x: 25, y: 33 });
  const note = pick(plate.notes, random, { x: 17, y: 12 });
  return [
    {
      motif: primary,
      x: plate.subject.x,
      y: plate.subject.y,
      scale: subjectScale,
      angle: 0,
      opacity: 1,
    },
    {
      motif: second,
      x: band.x,
      y: band.y,
      scale: round(0.82 + random() * 0.14),
      angle: round(random() * 18 - 9),
      opacity: 0.92,
    },
    {
      motif: third,
      x: note.x,
      y: note.y,
      scale: round(0.42 + random() * 0.1),
      angle: round(random() * 26 - 13),
      opacity: 0.6,
    },
  ];
}

function Marks({ marks }: { marks: readonly Mark[] }) {
  return (
    <>
      {marks.map((mark) => (
        <g
          key={`${mark.motif}-${mark.x}-${mark.y}`}
          data-motif={mark.motif}
          transform={`translate(${mark.x} ${mark.y}) rotate(${mark.angle}) scale(${mark.scale})`}
          opacity={mark.opacity}
        >
          {MOTIFS[mark.motif]((weight) => round(weight / mark.scale))}
        </g>
      ))}
    </>
  );
}

/**
 * The ticks and dimension runs in the margins.
 *
 * Its own seed stream, so adding a motif later does not move every tick on every sheet. Kept out
 * of the middle band, which is where the subject lives and the one part that must stay readable.
 */
function draftingMarks(seed: string, left: number, right: number): JSX.Element[] {
  const random = mulberry32(seedFrom(`${seed}:marks`));
  const marks: JSX.Element[] = [];
  for (let index = 0; index < 4; index += 1) {
    const near = index % 2 === 0;
    const x = round(near ? left + random() * 2.4 : right - 3 - random() * 2.4);
    const y = round(13 + random() * 22);
    marks.push(
      <path
        key={`tick-${index}`}
        d={`M${x} ${y}h${round(2.6 + random() * 3)}`}
        strokeWidth="0.9"
        opacity="0.5"
      />,
    );
  }
  const x = round(left + 1 + random() * 3);
  const width = round(8 + random() * 6);
  marks.push(
    <path
      key="dim"
      d={`M${x} 8.4h${width}M${x} 7.2v2.4M${x + width} 7.2v2.4`}
      strokeWidth="0.8"
      opacity="0.45"
    />,
  );
  return marks;
}

/**
 * A torn or ragged edge, as an absolute polyline.
 *
 * Absolute rather than relative segments so the run ends exactly where the outline expects it,
 * however the seed jitters the middle. A relative version drifts by up to three units over twelve
 * steps, which detaches the tear from the corner it is supposed to start at.
 */
function raggedEdge(seed: string, x: number, top: number, bottom: number, out: number): string {
  const random = mulberry32(seedFrom(`${seed}:edge`));
  const steps = 8;
  const step = (bottom - top) / steps;
  let d = `M${x} ${bottom}`;
  for (let index = 1; index <= steps; index += 1) {
    const y = round(bottom - step * index);
    const at = index === steps || index % 2 === 0 ? x : round(x + out * (0.45 + random() * 0.55));
    d += `L${at} ${y}`;
  }
  return d;
}

interface GlyphProps {
  size?: GlyphSize | undefined;
  className?: string | undefined;
}

function Sheet({
  rarity,
  size,
  className,
  children,
}: GlyphProps & {
  rarity: ItemRarity;
  children: JSX.Element;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-size={size}
      data-rarity={rarity}
      /*
       * The glyph brings its own plate.
       *
       * A stroked mark needs a value under it, and on the pale lilac `.icon-tile` the rarity ink
       * washed out: brass on lavender at 44px was a smudge with a colour. `.icon-plate` is the
       * ground index.css already keeps for drawn marks rather than painted ones, and it is on the
       * svg itself rather than on the callers because the satchel row, the barrow card and the
       * item window all hand this component a box they own and none of them can be edited from
       * here. The one it costs is a thin lilac frame where a caller still wraps it in a tile.
       */
      className={cn('icon-plate rounded-[3px]', RARITY_INK[rarity], className)}
    >
      {children}
    </svg>
  );
}

/**
 * One page: a loose sheet, torn down the left where it came out of the document.
 *
 * The tear is the whole silhouette argument. A page and its document are the same object at two
 * stages and a player has to tell them apart in a satchel row at 36px, so one of them is bound and
 * the other one is not.
 */
export function PageGlyph({
  page,
  blueprint,
  size = 'md',
  className,
}: GlyphProps & { page: BlueprintPage; blueprint: BlueprintSpec }) {
  const detail = MOTIF_COUNT[size];
  const marks = composition(page.id, primaryMotif(blueprint), PAGE_PLATE, 1.05).slice(0, detail);
  return (
    <Sheet rarity={pageRarity(blueprint, page)} size={size} className={className}>
      <>
        {/* The paper itself: a wash of the sheet's own ink, so a drawing on a dark plate still
            reads as ink on paper rather than as a wireframe floating in a box. */}
        <path
          d="M13 42.5V5.5h19L38 11.5V42.5z"
          fill="currentColor"
          fillOpacity="0.13"
          strokeWidth="1.8"
        />
        <path d={raggedEdge(page.id, 13, 5.5, 42.5, -1.5)} strokeWidth="1.4" />
        <path d="M32 5.5v6h6" strokeWidth="1.2" />
        {size === 'lg' && draftingMarks(page.id, 14.5, 37)}
        <Marks marks={marks} />
      </>
    </Sheet>
  );
}

/**
 * One document: a bound cover, with the fore-edge of the pages showing on the right.
 *
 * Same motif family as its pages, drawn a shade larger, and seeded off the document's own id so
 * the cover is not a copy of any page inside it.
 */
export function BlueprintGlyph({
  blueprint,
  size = 'md',
  className,
}: GlyphProps & { blueprint: BlueprintSpec }) {
  const detail = MOTIF_COUNT[size];
  const marks = composition(blueprint.id, primaryMotif(blueprint), COVER_PLATE, 1.2).slice(
    0,
    detail,
  );
  return (
    <Sheet rarity={blueprint.rarity} size={size} className={className}>
      <>
        <path d="M9.5 5h28.5v38H9.5z" fill="currentColor" fillOpacity="0.13" strokeWidth="1.8" />
        <path d="M14.5 5v38" strokeWidth="1.3" />
        {/* The pages inside, ragged where they have been thumbed through. */}
        <path d={raggedEdge(blueprint.id, 38, 7.5, 40.5, 2)} strokeWidth="1.2" opacity="0.85" />
        <path d="M38 7.5h1.6M38 40.5h1.6" strokeWidth="1.1" opacity="0.85" />
        {size !== 'sm' && (
          <>
            {/* Two stitches through the spine, and the title block at the foot of the cover. */}
            <path d="M12 14.5h1M12 33.5h1" strokeWidth="1.3" opacity="0.8" />
            <path d="M19 34.5h15v5.5H19z" strokeWidth="1" opacity="0.65" />
          </>
        )}
        {size === 'lg' && (
          <>
            <path d="M20.5 36.4h9M20.5 38.4h11.5" strokeWidth="0.85" opacity="0.55" />
            {draftingMarks(blueprint.id, 16, 36.5)}
          </>
        )}
        <Marks marks={marks} />
      </>
    </Sheet>
  );
}
