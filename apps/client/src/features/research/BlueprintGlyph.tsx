import {
  mulberry32,
  seedFrom,
  type BlueprintCategory,
  type BlueprintSpec,
} from '@frontline/shared';
import type { JSX } from 'react';
import { cn } from '../../lib/cn';

/**
 * The picture on a blueprint (§D8).
 *
 * Every document carries the same thing a player would recognise across the game: a folded sheet
 * with a drawing on it. What differs is the drawing, and it comes from two places.
 *
 * The **category mark** says what class of thing this teaches, so a Colossus and a Rotorcraft read
 * as the same kind of document at a glance. The **drafting marks** are seeded off the blueprint's
 * own id, which gives each of the thirty-nine a mark nobody drew by hand and which is identical
 * every time it is rendered, on every screen, for every player. A seeded pattern is the honest way
 * to get thirty-nine distinct graphics out of code: the alternative is thirty-nine hand-drawn
 * files, and the board draws the art (see the art policy).
 *
 * Deterministic, so this is the graphic for that blueprint rather than a graphic for it. If the
 * board later hands over masters, this component is where they land: same call site, same size.
 */

/** The mark in the middle of the sheet: what class of thing is on it. */
const CATEGORY_MARKS: Record<BlueprintCategory, JSX.Element> = {
  // A body and shoulders inside a frame: something that walks or rolls out of the yard.
  unit: (
    <>
      <circle cx="24" cy="20" r="4.2" strokeWidth="1.6" />
      <path d="M15.5 33c0-4.8 3.8-7.6 8.5-7.6s8.5 2.8 8.5 7.6" strokeWidth="1.6" />
    </>
  ),
  // A bracket and a bolt: a part fitted to something that already exists.
  upgrade: (
    <>
      <path d="M16 17.5h11a5 5 0 0 1 0 10H16" strokeWidth="1.6" />
      <circle cx="31.5" cy="32" r="3.4" strokeWidth="1.6" />
    </>
  ),
  // A flask: made for one night.
  consumable: (
    <>
      <path
        d="M21 15v6.5L15.8 32a2.2 2.2 0 0 0 2 3.2h12.4a2.2 2.2 0 0 0 2-3.2L27 21.5V15"
        strokeWidth="1.6"
      />
      <path d="M19.5 15h9" strokeWidth="1.6" />
    </>
  ),
};

const CATEGORY_TINT: Record<BlueprintCategory, string> = {
  unit: 'text-brass-300',
  upgrade: 'text-verdigris-100',
  consumable: 'text-iris-100',
};

/**
 * The pencil marks around the drawing.
 *
 * Four ticks and two dimension lines, placed by the blueprint's own seed inside the margins of the
 * sheet. Kept off the middle band so they never cross the category mark, which is the one part of
 * the picture that has to stay readable at 28px.
 */
function draftingMarks(id: string): JSX.Element[] {
  const random = mulberry32(seedFrom(id));
  const marks: JSX.Element[] = [];
  for (let index = 0; index < 4; index += 1) {
    const left = index % 2 === 0;
    const x = left ? 11 + random() * 3 : 34 + random() * 3;
    const y = 14 + random() * 22;
    const length = 3 + random() * 3.5;
    marks.push(
      <path key={`tick-${index}`} d={`M${x} ${y}h${length}`} strokeWidth="1" opacity="0.55" />,
    );
  }
  for (let index = 0; index < 2; index += 1) {
    const y = index === 0 ? 10.5 : 39.5;
    const x = 13 + random() * 6;
    const width = 9 + random() * 9;
    marks.push(
      <path
        key={`dim-${index}`}
        d={`M${x} ${y}h${width}M${x} ${y - 1.6}v3.2M${x + width} ${y - 1.6}v3.2`}
        strokeWidth="0.9"
        opacity="0.45"
      />,
    );
  }
  return marks;
}

export function BlueprintGlyph({
  blueprint,
  className,
}: {
  blueprint: BlueprintSpec;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(CATEGORY_TINT[blueprint.category], className)}
    >
      {/* The sheet, with the corner turned. Same silhouette on all thirty-nine. */}
      <path d="M7.5 5.5h25L40.5 13v29.5h-33z" strokeWidth="1.7" />
      <path d="M32.2 5.7v7.4h7.4" strokeWidth="1.3" />
      {draftingMarks(blueprint.id)}
      {CATEGORY_MARKS[blueprint.category]}
    </svg>
  );
}
