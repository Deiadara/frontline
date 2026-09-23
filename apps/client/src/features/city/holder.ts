import type { LocationHolder } from '@frontline/shared';

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

/**
 * The sign on the painting, per holder.
 *
 * Border and ink rather than a filled plate: the signs stand on artwork, and five solid colours
 * over a painting is a chart rather than a city. The ground stays the same near-black on all five
 * so the plates read as one family at a glance and the accent is what separates them.
 */
export const HOLDER_SIGN: Record<HolderTone, string> = {
  mine: 'border-verdigris-300/70 bg-surface-950/85 text-verdigris-100',
  // Red, the colour a called fight already wears everywhere else in the game.
  crew: 'border-oxblood-500/70 bg-surface-950/85 text-oxblood-300',
  // Yellow. `ember.100` rather than `300`, which is the amber a step down the ramp and sits too
  // close to the Combine's orange to be told apart on a plate this size.
  looters: 'border-ember-300/70 bg-surface-950/85 text-ember-100',
  government: 'border-tangerine-300/70 bg-surface-950/85 text-tangerine-300',
  unoccupied: 'border-surface-500/70 bg-surface-950/85 text-ink-200',
};

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
