import { describe, expect, it } from 'vitest';
import {
  BADGE_COLORS,
  BADGE_COLOR_VALUES,
  BADGE_FIELDS,
  BADGE_FIELD_LABELS,
  BADGE_PROPS,
  BADGE_PROP_LABELS,
  BADGE_SHAPES,
  BADGE_SHAPE_LABELS,
  BadgeSchema,
  DEFAULT_BADGE,
  badgeIsLegible,
  randomBadge,
  type FactionBadge,
} from './badge.js';

describe('the badge vocabulary', () => {
  /**
   * Every choice the builder offers has a label, and every label belongs to a choice.
   *
   * Asserted in both directions because the failure modes differ and both have shipped in other
   * screens of this game: a value with no label draws a raw identifier at the player, and a label
   * with no value is a dead entry somebody keeps trying to fix.
   */
  it.each([
    ['shapes', BADGE_SHAPES as readonly string[], BADGE_SHAPE_LABELS as Record<string, string>],
    ['fields', BADGE_FIELDS as readonly string[], BADGE_FIELD_LABELS as Record<string, string>],
    ['props', BADGE_PROPS as readonly string[], BADGE_PROP_LABELS as Record<string, string>],
  ])('labels every one of the %s and nothing else', (_name, values, labels) => {
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
    for (const value of values) expect(labels[value]).toBeTruthy();
  });

  it('gives every colour a name and a real hex value', () => {
    expect(Object.keys(BADGE_COLOR_VALUES).sort()).toEqual([...BADGE_COLORS].sort());
    for (const color of BADGE_COLORS) {
      expect(BADGE_COLOR_VALUES[color].label).toBeTruthy();
      expect(BADGE_COLOR_VALUES[color].hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  /**
   * Two colours painting the same pixels would make two different choices indistinguishable in the
   * builder, which reads as the control being broken rather than as a subtle palette.
   */
  it('has twelve colours that are actually twelve colours', () => {
    const hexes = BADGE_COLORS.map((color) => BADGE_COLOR_VALUES[color].hex.toLowerCase());
    expect(new Set(hexes).size).toBe(BADGE_COLORS.length);
  });

  it('offers enough combinations that a collision is a coincidence', () => {
    const total =
      BADGE_SHAPES.length *
      BADGE_COLORS.length *
      BADGE_FIELDS.length *
      BADGE_PROPS.length *
      BADGE_COLORS.length;
    expect(total).toBeGreaterThan(50_000);
  });

  it('accepts the badge the builder opens on', () => {
    expect(BadgeSchema.parse(DEFAULT_BADGE)).toEqual(DEFAULT_BADGE);
    expect(badgeIsLegible(DEFAULT_BADGE)).toBe(true);
  });

  it('refuses a badge naming a shape or a colour that does not exist', () => {
    expect(BadgeSchema.safeParse({ ...DEFAULT_BADGE, shape: 'hexagon' }).success).toBe(false);
    expect(BadgeSchema.safeParse({ ...DEFAULT_BADGE, ground: 'chartreuse' }).success).toBe(false);
    expect(BadgeSchema.safeParse({ ...DEFAULT_BADGE, prop: 'dragon' }).success).toBe(false);
  });
});

describe('legibility', () => {
  it('calls an emblem painted the colour of its ground illegible', () => {
    expect(badgeIsLegible({ ...DEFAULT_BADGE, ground: 'brass', ink: 'brass' })).toBe(false);
  });

  /** A patterned field is behind the emblem too, so it counts. */
  it('counts the pattern as something the emblem sits on', () => {
    const patterned: FactionBadge = {
      ...DEFAULT_BADGE,
      field: 'bend',
      ground: 'soot',
      fieldColor: 'brass',
    };
    expect(badgeIsLegible({ ...patterned, ink: 'brass' })).toBe(false);
    expect(badgeIsLegible({ ...patterned, ink: 'bone' })).toBe(true);
  });

  /** ...and it does not count when there is no pattern to collide with. */
  it('ignores the pattern colour on a plain field', () => {
    expect(
      badgeIsLegible({ ...DEFAULT_BADGE, field: 'plain', fieldColor: 'bone', ink: 'bone' }),
    ).toBe(true);
  });

  it('lets an empty badge be any colours at all', () => {
    expect(badgeIsLegible({ ...DEFAULT_BADGE, prop: 'blank', ground: 'iris', ink: 'iris' })).toBe(
      true,
    );
  });
});

describe('rolling one', () => {
  it('gives the same badge for the same seed', () => {
    expect(randomBadge(42)).toEqual(randomBadge(42));
  });

  it('gives different badges for different seeds', () => {
    const rolled = new Set(
      Array.from({ length: 50 }, (_, index) => JSON.stringify(randomBadge(index + 1))),
    );
    expect(rolled.size).toBeGreaterThan(20);
  });

  /**
   * The reason `randomBadge` filters the ink rather than retrying: a roll that can produce an
   * unreadable badge would put one in front of a player who pressed "surprise me" and had no part
   * in the choice.
   */
  it('never rolls an emblem you cannot see', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const badge = randomBadge(seed);
      expect(badgeIsLegible(badge), `seed ${seed} rolled an illegible badge`).toBe(true);
      expect(BadgeSchema.safeParse(badge).success).toBe(true);
    }
  });
});
