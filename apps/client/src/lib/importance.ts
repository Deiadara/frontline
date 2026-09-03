import type { AttributeImportance } from '@frontline/shared';

/**
 * What a chair thinks of a skill, drawn as the edge of its row.
 *
 * One table, because two screens draw it: the crew sheet and the training tab. They were written a
 * day apart and a copy each is exactly how the second screen ends up a shade off the first, on the
 * one signal a player is meant to read across both.
 *
 * A border rather than a tint on the bar or a badge beside the name. The bar already carries a
 * meaning (how good they are at it) and a second colour on it would be two scales on one object; a
 * badge costs width the four-column layout does not have, which is what cuts `Communication`. An
 * edge costs nothing and reads at a glance down the column.
 *
 * Gold, silver and blue as the board named them. Insignificant is deliberately *unmarked* rather
 * than given a grey border: a colour for "this does not matter" is still ink asking to be read.
 */
export const IMPORTANCE_EDGE: Record<AttributeImportance, string> = {
  insignificant: 'border-l-2 border-l-transparent',
  useful: 'border-l-2 border-l-ferrite-300/70',
  essential: 'border-l-2 border-l-brass-300',
  irreplaceable: 'border-l-2 border-l-iris-300',
};
