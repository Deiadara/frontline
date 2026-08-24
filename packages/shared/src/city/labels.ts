import { z } from 'zod';
import type { UnitStats } from '../units/stats.js';

/**
 * What a piece of ground is *like* (GDD §A4).
 *
 * A location used to be a name, a bonus and a hit-point total. Two crews fighting over a cinema
 * and over a rail yard fought exactly the same fight, which makes a map of forty locations a map
 * of one location drawn forty times. A **label** is the fix: a keyword hung on the ground —
 * `Crammed`, `Dark`, `Noisy`, `Toxic` — that some units are better in and some are worse in.
 *
 * Two things produce labels and they compose:
 *
 *   * the **location itself**, authored in the catalogue — a smuggler's tunnel is Crammed and Dark
 *     whatever the sky is doing;
 *   * the **day**, from the weather roll and the clock (`weather.ts`) — Wet, Cold, Foggy, Hot.
 *
 * ## Tiers
 *
 * Every label carries a tier in Latin numerals, `I`..`IV`. `Toxic II` is worse than `Toxic I` and
 * costs exactly twice as much, because a label's effect is *per tier*: one number in the table
 * below, multiplied by the tier. Two sources of the same label do not stack into a fifth tier —
 * the higher wins ({@link mergeLabels}), so a storm over a flooded yard is Wet III rather than
 * Wet VI.
 *
 * ## Who is good at what, without a table of forty units by thirteen labels
 *
 * A label's effect is read off the *unit's own sheet*, linearly between two authored endpoints.
 * `Hot` is `armor 0 → 0, armor 100 → −10`: heavy armour cooks, a Razor in a vest does not care.
 * `Wet` is `speed 0 → −9, speed 100 → 0`: bad mobility bogs down. That gives every unit in the
 * game — including every unit added after this — a defensible answer to every label without
 * anybody authoring 520 cells.
 *
 * On top of that a unit may carry {@link UnitSpec.affinities}, which *adds* to the baseline, and
 * {@link UnitSpec.immuneTo}, which floors it at whatever the affinity alone says. That is where
 * "the Abomination does not care about toxic" and "Anodics fight better when it is loud" live —
 * the two cases a stat-driven rule genuinely cannot express.
 */

export const ENV_LABEL_IDS = [
  // The shape of the ground.
  'crammed',
  'open',
  'elevated',
  // What it is like to be in.
  'dark',
  'eerie',
  'noisy',
  'toxic',
  // What the sky is doing (`weather.ts`).
  'hot',
  'cold',
  'wet',
  'snowy',
  'foggy',
  'windy',
] as const;
export const EnvLabelIdSchema = z.enum(ENV_LABEL_IDS);
export type EnvLabelId = z.infer<typeof EnvLabelIdSchema>;

/** The strongest a label ever gets. Four is as many Latin numerals as anyone reads at a glance. */
export const MAX_LABEL_TIER = 4;

export const EnvLabelSchema = z.object({
  id: EnvLabelIdSchema,
  tier: z.number().int().min(1).max(MAX_LABEL_TIER),
});
export type EnvLabel = z.infer<typeof EnvLabelSchema>;

/** `I`, `II`, `III`, `IV` — the tier as it is written on the chip. */
export const TIER_NUMERALS = ['I', 'II', 'III', 'IV'] as const;

export function tierNumeral(tier: number): string {
  return TIER_NUMERALS[Math.min(MAX_LABEL_TIER, Math.max(1, Math.trunc(tier))) - 1] as string;
}

/**
 * How a label bites, as a line through two points on one stat.
 *
 * `atLow` is the effect on a unit with 0 in `stat`; `atHigh` on a unit with 100. Both are
 * percentage points **per tier** on the unit's effectiveness, positive for help. A straight line
 * because the alternative — a curve, a threshold, a table — is a thing a player cannot predict,
 * and the whole point of a visible keyword is that it is predictable.
 */
export interface LabelRule {
  stat: 'armor' | 'speed' | 'range' | 'stealth' | 'morale';
  atLow: number;
  atHigh: number;
}

/** How a label is drawn. The client owns the palette; this owns which one each label wears. */
export const LABEL_TONES = [
  'stone',
  'sky',
  'gold',
  'violet',
  'ember',
  'toxic',
  'frost',
  'rust',
] as const;
export type LabelTone = (typeof LABEL_TONES)[number];

export interface EnvLabelSpec {
  id: EnvLabelId;
  name: string;
  /** One line: what the ground is like, in the player's words. */
  description: string;
  /** Who it helps and who it hurts, said out loud so the chip is readable without maths. */
  bites: string;
  tone: LabelTone;
  rule: LabelRule;
}

export const ENV_LABEL_CATALOG: Readonly<Record<EnvLabelId, EnvLabelSpec>> = {
  crammed: {
    id: 'crammed',
    name: 'Crammed',
    description: 'Corridors, stacked crates, doorways. Nobody here is more than a room away.',
    bites: 'Close-in fighters thrive. Anything that wanted to shoot first never gets to.',
    tone: 'rust',
    rule: { stat: 'range', atLow: 8, atHigh: -9 },
  },
  open: {
    id: 'open',
    name: 'Open',
    description: 'Yards, lots and cleared ground, with sightlines all the way across.',
    bites: 'Range decides it. Blades cross forty metres of nothing before they matter.',
    tone: 'sky',
    rule: { stat: 'range', atLow: -9, atHigh: 8 },
  },
  elevated: {
    id: 'elevated',
    name: 'Elevated',
    description: 'Gantries, roofs and spoil heaps — whatever counts as looking down around here.',
    bites: 'Shooters get the angle. Anyone who has to climb to reach anything does not.',
    tone: 'gold',
    rule: { stat: 'range', atLow: -4, atHigh: 7 },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    description: 'No working lights, and nobody has been paying the meter for years.',
    bites: 'People used to moving unseen barely notice. Everyone else is firing at noise.',
    tone: 'violet',
    rule: { stat: 'stealth', atLow: -8, atHigh: 4 },
  },
  eerie: {
    id: 'eerie',
    name: 'Eerie',
    description: 'Something about this ground is wrong, and everybody feels it at the same moment.',
    bites: 'Steady people shrug it off. Anyone already close to breaking breaks here.',
    tone: 'violet',
    rule: { stat: 'morale', atLow: -13, atHigh: 2 },
  },
  noisy: {
    id: 'noisy',
    name: 'Noisy',
    description: 'Presses, turbines, a crowd, a generator nobody has switched off in nine years.',
    bites: 'Nothing quiet stays quiet. Some people fight better with something to shout over.',
    tone: 'ember',
    rule: { stat: 'stealth', atLow: 3, atHigh: -9 },
  },
  toxic: {
    id: 'toxic',
    name: 'Toxic',
    description: 'The air is doing something to you and it started before you noticed.',
    bites: 'Sealed plate holds a while. A vest and a scarf do not.',
    tone: 'toxic',
    rule: { stat: 'armor', atLow: -13, atHigh: -3 },
  },
  hot: {
    id: 'hot',
    name: 'Hot',
    description: 'The kind of heat that comes up off the ground as hard as it comes down.',
    bites: 'Anything heavily armoured is carrying an oven. Light troops barely register it.',
    tone: 'ember',
    rule: { stat: 'armor', atLow: 0, atHigh: -10 },
  },
  cold: {
    id: 'cold',
    name: 'Cold',
    description: 'Cold enough that standing still is its own decision.',
    bites: 'Plate and padding keep it out. Whatever is fighting in a jacket does not.',
    tone: 'frost',
    rule: { stat: 'armor', atLow: -9, atHigh: 0 },
  },
  wet: {
    id: 'wet',
    name: 'Wet',
    description: 'Standing water, running water, and everything underfoot giving way.',
    bites: 'Anything that was slow is slower. Fast units keep most of what they had.',
    tone: 'sky',
    rule: { stat: 'speed', atLow: -9, atHigh: 0 },
  },
  snowy: {
    id: 'snowy',
    name: 'Snowy',
    description: 'Deep enough to hide the ground and everything anyone left on it.',
    bites: 'Every step costs. Nothing crosses this at the speed it was rated for.',
    tone: 'frost',
    rule: { stat: 'speed', atLow: -10, atHigh: -1 },
  },
  foggy: {
    id: 'foggy',
    name: 'Foggy',
    description: 'Visibility to about the end of your own arm, and it is getting worse.',
    bites: 'Long range is worth nothing you cannot see. Knife work is unaffected.',
    tone: 'stone',
    rule: { stat: 'range', atLow: 3, atHigh: -8 },
  },
  windy: {
    id: 'windy',
    name: 'Windy',
    description: 'Crosswind hard enough to lean on, carrying half the street with it.',
    bites: 'Anything thrown or fired at distance goes somewhere else.',
    tone: 'stone',
    rule: { stat: 'range', atLow: 2, atHigh: -6 },
  },
};

/** A label at a tier, as a chip reads: `Toxic II`. */
export function labelText(label: EnvLabel): string {
  return `${ENV_LABEL_CATALOG[label.id].name} ${tierNumeral(label.tier)}`;
}

const clampTier = (tier: number): number => Math.min(MAX_LABEL_TIER, Math.max(1, Math.round(tier)));

/** A label, with its tier brought inside `I..IV`. The only constructor callers should use. */
export function envLabel(id: EnvLabelId, tier: number): EnvLabel {
  return { id, tier: clampTier(tier) };
}

/**
 * Fold several sources of labels into one list — **highest tier wins, never the sum.**
 *
 * A storm over a location that is already Wet is not Wet VI. Summing would let two ordinary
 * sources produce a tier nothing in the catalogue can, and the whole readability argument for a
 * four-step scale would go with it.
 *
 * Ordered by the catalogue rather than by arrival, so the same ground always draws its chips in
 * the same order and a player can find the one they are looking for by position.
 */
export function mergeLabels(...sources: readonly (readonly EnvLabel[])[]): EnvLabel[] {
  const strongest = new Map<EnvLabelId, number>();
  for (const source of sources) {
    for (const label of source) {
      const tier = clampTier(label.tier);
      strongest.set(label.id, Math.max(strongest.get(label.id) ?? 0, tier));
    }
  }
  return ENV_LABEL_IDS.filter((id) => strongest.has(id)).map((id) => ({
    id,
    tier: strongest.get(id) as number,
  }));
}

/** Raise every label in a list by `steps` tiers, clamped. What upgrading a hazard does to it. */
export function amplify(labels: readonly EnvLabel[], steps: number): EnvLabel[] {
  return labels.map((label) => envLabel(label.id, label.tier + steps));
}

/** The tier of one label here, or 0 when it is absent. */
export function tierOf(labels: readonly EnvLabel[], id: EnvLabelId): number {
  return labels.find((label) => label.id === id)?.tier ?? 0;
}

/**
 * What one label is worth to one unit, in percentage points on its effectiveness.
 *
 * The baseline is the catalogue's line through the unit's own stat; the unit's `affinities` add to
 * it; `immuneTo` throws the baseline away and keeps only the affinity, which is how a thing that
 * breathes chlorine ends up at zero rather than at a small negative nobody can explain.
 */
export interface LabelSensitivity {
  affinities?: Partial<Record<EnvLabelId, number>> | undefined;
  immuneTo?: readonly EnvLabelId[] | undefined;
}

export function labelEffectPercent(
  stats: UnitStats,
  sensitivity: LabelSensitivity,
  label: EnvLabel,
): number {
  const spec = ENV_LABEL_CATALOG[label.id];
  const affinity = sensitivity.affinities?.[label.id] ?? 0;
  const immune = sensitivity.immuneTo?.includes(label.id) ?? false;
  const reading = Math.min(100, Math.max(0, stats[spec.rule.stat]));
  const baseline = spec.rule.atLow + ((spec.rule.atHigh - spec.rule.atLow) * reading) / 100;
  const perTier = immune ? affinity : baseline + affinity;
  return perTier * label.tier;
}

/** Every label on this ground, summed, with the ones worth naming in a report. */
export interface LabelVerdict {
  percent: number;
  /** `Noisy II +20%` — one entry per label that moved anything, strongest first. */
  reasons: readonly string[];
}

export function labelVerdict(
  stats: UnitStats,
  sensitivity: LabelSensitivity,
  labels: readonly EnvLabel[],
): LabelVerdict {
  // Filtered on the *rounded* figure, which is the figure the chip shows: a label worth −0.4%
  // would otherwise be listed as `Hot I 0%`, which is a reason printed next to no reason.
  const scored = labels
    .map((label) => ({ label, percent: labelEffectPercent(stats, sensitivity, label) }))
    .filter((entry) => Math.round(entry.percent) !== 0)
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));

  return {
    percent: scored.reduce((total, entry) => total + entry.percent, 0),
    reasons: scored.map(
      (entry) =>
        `${labelText(entry.label)} ${entry.percent >= 0 ? '+' : ''}${Math.round(entry.percent)}%`,
    ),
  };
}

/**
 * How much narrower the ground is than its context alone would say.
 *
 * Combat width is what stops "bring everything" being the whole game, and `Crammed` is the label
 * that most obviously means "you cannot get everyone in here". Reading it into the frontage rather
 * than only into a percentage is what makes a tunnel a *different fight* rather than the same
 * fight at a discount.
 */
export const CRAMMED_FRONTAGE_PER_TIER = 0.13;
export const OPEN_FRONTAGE_PER_TIER = 0.1;
export const MIN_FRONTAGE_FACTOR = 0.4;

export function frontageFactor(labels: readonly EnvLabel[]): number {
  const factor =
    1 -
    tierOf(labels, 'crammed') * CRAMMED_FRONTAGE_PER_TIER +
    tierOf(labels, 'open') * OPEN_FRONTAGE_PER_TIER;
  return Math.max(MIN_FRONTAGE_FACTOR, factor);
}
