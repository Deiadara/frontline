import { z } from 'zod';

/**
 * A faction's badge: the thing it is recognised by.
 *
 * Every game with teams in it has one of these, and they all work the same way because the shape
 * of the problem is the same: a player has to be able to make something that is theirs, in under a
 * minute, with no drawing ability, and it has to stay legible at 20px in a message header as well
 * as at 200px in the builder. That rules out freehand and it rules out uploads. What is left is a
 * small set of decisions with no wrong answers, which is what this is: an outline, a ground, a
 * pattern over the ground, an emblem, and a colour for the emblem.
 *
 * 6 x 12 x 10 x 18 x 12 is over one hundred and fifty thousand badges, which is enough that two
 * factions choosing the same one is a coincidence rather than an inevitability.
 *
 * ## Ids, not pixels
 *
 * The badge is stored as five identifiers and drawn from them. Nothing here knows what a shield
 * looks like: the geometry lives in the client (`FactionBadge`), and this module is the vocabulary
 * both ends agree on. That is what lets the badge be redrawn, restyled or animated later without a
 * migration, and it is why a badge costs ~60 bytes in a row rather than an image.
 *
 * ## Why the colours are here and not in the theme
 *
 * These twelve are a *stored* choice. A player picks `oxblood` and that is what their badge is, so
 * the value has to mean the same thing next year as it does today: if it read from the interface's
 * palette, a theme change would silently repaint every badge in the game. Related to the chrome
 * palette by eye, pinned by hand.
 */

export const BADGE_SHAPES = ['shield', 'roundel', 'banner', 'lozenge', 'tower', 'wedge'] as const;
export const BadgeShapeSchema = z.enum(BADGE_SHAPES);
export type BadgeShape = z.infer<typeof BadgeShapeSchema>;

export const BADGE_SHAPE_LABELS: Record<BadgeShape, string> = {
  shield: 'Shield',
  roundel: 'Roundel',
  banner: 'Banner',
  lozenge: 'Lozenge',
  tower: 'Tower',
  wedge: 'Wedge',
};

/**
 * The pattern laid over the ground, in the second colour.
 *
 * Heraldry calls these divisions of the field and they are the cheapest way to make two badges
 * with the same shape and emblem read as different factions: a diagonal band changes the silhouette
 * of the colour without touching either decision on either side of it.
 *
 * Four of the ten are deliberately the plainest thing that is still a pattern: a bar across the
 * foot, a bar across the head, a rule round the edge, a cross. Somebody who wants two colours and
 * no fuss should not have to take a chevron to get them.
 */
export const BADGE_FIELDS = [
  'plain',
  'bend',
  'chevron',
  'quarters',
  'pale',
  'fess',
  'base',
  'chief',
  'border',
  'saltire',
] as const;
export const BadgeFieldSchema = z.enum(BADGE_FIELDS);
export type BadgeField = z.infer<typeof BadgeFieldSchema>;

export const BADGE_FIELD_LABELS: Record<BadgeField, string> = {
  plain: 'Plain',
  bend: 'Diagonal',
  chevron: 'Chevron',
  quarters: 'Quarters',
  pale: 'Vertical',
  fess: 'Horizontal',
  base: 'Foot',
  chief: 'Head',
  border: 'Edge',
  saltire: 'Cross',
};

/**
 * The emblem in the middle. `blank` is one of them on purpose.
 *
 * Drawn from what this city actually has in it rather than from a generic clip-art set: the game's
 * resources are scrap, oil, planks and high-quality metal, its people are chemists and razors, and
 * a badge reading `cog` or `syringe` says something about a faction that `star` does not.
 */
export const BADGE_PROPS = [
  'blank',
  'skull',
  'cog',
  'bolt',
  'star',
  'crown',
  'fist',
  'wolf',
  'eye',
  'anvil',
  'flame',
  'key',
  'antenna',
  'syringe',
  'crosshair',
  'moth',
  'drop',
  'spade',
] as const;
export const BadgePropSchema = z.enum(BADGE_PROPS);
export type BadgeProp = z.infer<typeof BadgePropSchema>;

export const BADGE_PROP_LABELS: Record<BadgeProp, string> = {
  blank: 'Nothing',
  skull: 'Skull',
  cog: 'Cog',
  bolt: 'Bolt',
  star: 'Star',
  crown: 'Crown',
  fist: 'Fist',
  wolf: 'Wolf',
  eye: 'Eye',
  anvil: 'Anvil',
  flame: 'Flame',
  key: 'Key',
  antenna: 'Antenna',
  syringe: 'Syringe',
  crosshair: 'Crosshair',
  moth: 'Moth',
  drop: 'Drop',
  spade: 'Spade',
};

export const BADGE_COLORS = [
  'brass',
  'oxblood',
  'verdigris',
  'iris',
  'bone',
  'soot',
  'plum',
  'rust',
  'moss',
  'steel',
  'sulphur',
  'ash',
] as const;
export const BadgeColorSchema = z.enum(BADGE_COLORS);
export type BadgeColor = z.infer<typeof BadgeColorSchema>;

/** What each colour is called and what it paints. Pinned hex: see the note at the top. */
export const BADGE_COLOR_VALUES: Record<BadgeColor, { label: string; hex: string }> = {
  brass: { label: 'Brass', hex: '#f0ad4c' },
  oxblood: { label: 'Oxblood', hex: '#9c362a' },
  verdigris: { label: 'Verdigris', hex: '#38847c' },
  iris: { label: 'Iris', hex: '#7a6cc8' },
  bone: { label: 'Bone', hex: '#e2d9c8' },
  soot: { label: 'Soot', hex: '#1a1622' },
  plum: { label: 'Plum', hex: '#5d1c4a' },
  rust: { label: 'Rust', hex: '#b4531f' },
  moss: { label: 'Moss', hex: '#4a6b28' },
  steel: { label: 'Steel', hex: '#5a6980' },
  sulphur: { label: 'Sulphur', hex: '#d8c33a' },
  ash: { label: 'Ash', hex: '#8b8494' },
};

export const BadgeSchema = z.object({
  shape: BadgeShapeSchema,
  /** The colour the shape is filled with. */
  ground: BadgeColorSchema,
  field: BadgeFieldSchema,
  /** The pattern's colour. Ignored when the field is `plain`, and kept so toggling is lossless. */
  fieldColor: BadgeColorSchema,
  prop: BadgePropSchema,
  /** The emblem's colour. */
  ink: BadgeColorSchema,
});
export type FactionBadge = z.infer<typeof BadgeSchema>;

/** What the builder opens on: legible, on-brand, and obviously not finished. */
export const DEFAULT_BADGE: FactionBadge = {
  shape: 'shield',
  ground: 'soot',
  field: 'plain',
  fieldColor: 'brass',
  prop: 'skull',
  ink: 'brass',
};

/**
 * Whether an emblem can be seen against what is behind it.
 *
 * Not enforced anywhere: it is their badge, and an emblem hidden in its own ground is a thing
 * somebody may well want. What it is for is `randomBadge`, which must not hand a badge nobody chose
 * to a player who pressed "roll one" and cannot see what they got.
 */
export function badgeIsLegible(badge: FactionBadge): boolean {
  if (badge.prop === 'blank') return true;
  const behind = badge.field === 'plain' ? [badge.ground] : [badge.ground, badge.fieldColor];
  return !behind.includes(badge.ink);
}

/**
 * A badge from a seed, for the "surprise me" control and for fixtures.
 *
 * Rejects illegible combinations by re-rolling the ink rather than by picking again: with 12
 * colours the chance of a clash is high enough that a plain retry loop would be the common path.
 */
export function randomBadge(seed: number): FactionBadge {
  // xorshift, so the same seed is the same badge on both ends and in every test run.
  let state = seed || 1;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state);
  };
  const pick = <T>(list: readonly T[]): T => list[next() % list.length] as T;

  const ground = pick(BADGE_COLORS);
  const fieldColor = pick(BADGE_COLORS);
  const field = pick(BADGE_FIELDS);
  const behind = field === 'plain' ? [ground] : [ground, fieldColor];
  const inks = BADGE_COLORS.filter((color) => !behind.includes(color));
  return {
    shape: pick(BADGE_SHAPES),
    ground,
    field,
    fieldColor,
    prop: pick(BADGE_PROPS),
    ink: pick(inks),
  };
}
