import {
  garrisonOf,
  isContested,
  sameHolder,
  startingHolder,
  type District,
  type LocationHolder,
  type LocationView,
} from '@frontline/shared';

/**
 * Who holds a piece of ground, as a colour (maintainer, 2026-09-20).
 *
 * "Make it more obvious who is holding something: if it's occupied by Looters make the tag be
 * yellow, if it's Combine make it be orange and if it's another player make it be red."
 *
 * The signs on a district painting used to answer one question, *is this mine*, in two colours:
 * green for yours and brass for everything else. So a player scanning a district could not tell
 * the looters' pawn shop from the Combine's armoury from a rival crew's yard, which is the one
 * thing that decides whether a fight is worth calling and what it will cost. Five holders, five
 * colours, and one table so the sign on the painting and the plate on the sheet can never disagree
 * about who is standing on a plot.
 *
 * The four accents are already in the palette and already mean these things elsewhere: verdigris
 * is "yours" everywhere in the game, oxblood is a fight, ember is the sodium-lamp warning colour,
 * and tangerine is the one reserved for the state. Nothing new was mixed for this.
 */
export type HolderTone = 'mine' | 'crew' | 'looters' | 'government' | 'unoccupied';

/** Which of the five this plot is, for a viewer holding `baseId`. */
export function holderToneOf(holder: LocationHolder, baseId: string | null): HolderTone {
  if (holder.kind === 'crew') return holder.baseId === baseId ? 'mine' : 'crew';
  return holder.kind;
}

/** The plate on the location sheet: the same five, as a frame, a label ink and a name ink. */
export const HOLDER_PLATE: Record<HolderTone, { frame: string; plate: string; name: string }> = {
  mine: {
    frame: 'border-verdigris-300/60 bg-verdigris-500/10',
    plate: 'text-verdigris-100',
    name: 'text-verdigris-100',
  },
  crew: {
    frame: 'border-oxblood-500/60 bg-oxblood-500/10',
    plate: 'text-oxblood-300',
    name: 'text-ink-100',
  },
  looters: {
    frame: 'border-ember-300/50 bg-ember-300/10',
    plate: 'text-ember-100',
    name: 'text-ink-100',
  },
  government: {
    frame: 'border-tangerine-300/60 bg-tangerine-300/10',
    plate: 'text-tangerine-300',
    name: 'text-ink-100',
  },
  unoccupied: {
    frame: 'border-surface-500/70 bg-surface-950/40',
    plate: 'text-ink-300',
    name: 'text-ink-200',
  },
};

/**
 * Who holds the district now, in a sentence, for the Garrison row (maintainer, 2026-09-29).
 *
 * The row used to print `garrisonOf` off the district's allegiance whatever had happened to the
 * ground, so the Docks held end to end by a crew still promised a thin line of Civic Levy. That
 * sentence is what the catalogue authored, and it stays only while every location is still with
 * its authored holder. Once anything has changed hands the row says who is standing there.
 *
 * Only the Combine's ground has an authored sentence. Open ground was promised "whoever holds the
 * ground and has decided to keep it" until the maintainer struck it (2026-09-30), so it goes
 * straight to the count, which names the looters and the empty plots. A residential plot has no
 * locations and no Garrison row.
 */
export function districtHoldLine(
  district: District,
  locations: readonly Pick<LocationView, 'location' | 'holder' | 'holderName'>[],
): string {
  const asAuthored = locations.every((view) =>
    sameHolder(view.holder, startingHolder(view.location, district)),
  );
  const authored = asAuthored && isContested(district) ? garrisonOf(district) : null;
  if (authored !== null) return `Expect ${authored}.`;

  const total = locations.length;
  const crews = new Map<string, { name: string; count: number }>();
  let government = 0;
  let looters = 0;
  let empty = 0;
  for (const view of locations) {
    if (view.holder.kind === 'crew') {
      const crew = crews.get(view.holder.baseId) ?? { name: view.holderName, count: 0 };
      crews.set(view.holder.baseId, { ...crew, count: crew.count + 1 });
    } else if (view.holder.kind === 'government') government += 1;
    else if (view.holder.kind === 'looters') looters += 1;
    else empty += 1;
  }

  const [only] = crews.values();
  if (crews.size === 1 && only && only.count === total) return `Held by ${only.name}.`;

  const of = (count: number) => `${count} of ${total} locations`;
  const crewCount = [...crews.values()].reduce((sum, crew) => sum + crew.count, 0);
  return [
    government > 0 && `The Combine holds ${of(government)}.`,
    looters > 0 && `The looters hold ${of(looters)}.`,
    crews.size === 1 && only && `${only.name} holds ${of(only.count)}.`,
    crews.size > 1 && `${crews.size} crews hold ${of(crewCount)}.`,
    empty > 0 && `${empty} ${empty === 1 ? 'stands' : 'stand'} empty.`,
  ]
    .filter(Boolean)
    .join(' ');
}
