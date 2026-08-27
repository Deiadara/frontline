import { z } from 'zod';
import { CHANNEL_LABELS, type EffectChannel } from '../crew/effects.js';
import type { ItemId } from '../items/catalog.js';
import type { ItemCost } from '../items/inventory.js';
import type { PartialResources } from '../resources.js';

/**
 * The Lab's standing programmes (§B9, lab extension).
 *
 * Research already had *investigations*: one-off projects that turn up a fact about a role and
 * then end. This is the other half of a laboratory: work whose result is a permanent change to how
 * the district runs. An investigation tells you something; a technology *does* something, forever,
 * to every clock and every fight afterwards.
 *
 * ## Four tracks, and why they are not one list
 *
 * A flat list of twenty upgrades is a menu, and a player reads a menu once and then buys the
 * cheapest thing on it. Four tracks with three rungs each is a *choice*: the industry track is
 * about how fast the district runs, signals is about what the two of you know about each other,
 * medicine is about how many people come back, and materials is about what things cost. Nobody
 * finishes all four quickly, and which one a crew climbs first says something about how they play.
 *
 * ## The gates
 *
 * Every rung wants the Lab at a level, and everything past the first rung of a track wants that
 * track's blueprint. The blueprints come from the Runner, which is what ties the Lab to the market:
 * a crew that never trades tops out at four first rungs and stops.
 *
 * ## The effect
 *
 * Each technology writes into a {@link EffectChannel}: the same struct territory, crew attributes
 * and the Garage's fleet all write into. So a finished programme is wired into every consumer that
 * already reads those effects, with no new parameter threaded anywhere, and a player can see what
 * it bought them on the same profile page that explains everything else.
 */

export const TECH_TRACKS = ['industry', 'signals', 'medicine', 'materials', 'ordnance'] as const;
export const TechTrackSchema = z.enum(TECH_TRACKS);
export type TechTrack = z.infer<typeof TechTrackSchema>;

export const TECH_TRACK_LABELS: Readonly<Record<TechTrack, string>> = {
  industry: 'Industry',
  signals: 'Signals',
  medicine: 'Medicine',
  materials: 'Materials',
  ordnance: 'Ordnance',
};

export const TECH_TRACK_BLURBS: Readonly<Record<TechTrack, string>> = {
  industry: 'How fast the district runs, and how much comes out of the same hour.',
  signals: 'What a rival learns about you, and what you learn about them.',
  medicine: 'How many of the people you send out come back.',
  materials: 'What everything costs, and how much of it you can keep.',
  ordnance: 'What you leave behind for the people who come looking for you.',
};

/** The blueprint each track needs past its first rung. `null` where the track is open. */
export const TECH_TRACK_BLUEPRINT: Readonly<Record<TechTrack, ItemId>> = {
  industry: 'blueprint_munitions',
  signals: 'blueprint_signal_theory',
  medicine: 'blueprint_field_medicine',
  materials: 'blueprint_composite_armour',
  ordnance: 'blueprint_munitions',
};

export interface TechSpec {
  id: string;
  track: TechTrack;
  tier: number;
  name: string;
  description: string;
  /** The Lab has to be standing at this level. */
  requiresLabLevel: number;
  cost: PartialResources;
  parts: ItemCost;
  /** Where it lands, and how much. One channel each, like an attribute. */
  channel: EffectChannel;
  magnitude: number;
}

const SPECS: readonly TechSpec[] = [
  // Industry: the district's own tempo.
  {
    id: 'tech_shift_rotation',
    track: 'industry',
    tier: 1,
    name: 'Shift Rotation',
    description: 'Three watches instead of two. Nothing stands idle between them.',
    requiresLabLevel: 2,
    cost: { caps: 1200, scrap: 800 },
    parts: {},
    channel: 'productionPercent',
    magnitude: 8,
  },
  {
    id: 'tech_line_balancing',
    track: 'industry',
    tier: 2,
    name: 'Line Balancing',
    description: 'Somebody finally timed every station and moved the slow one.',
    requiresLabLevel: 7,
    cost: { caps: 3600, scrap: 2800, highQualityMetal: 140 },
    parts: { scrap_servo: 4 },
    channel: 'productionPercent',
    magnitude: 14,
  },
  {
    id: 'tech_critical_path',
    track: 'industry',
    tier: 3,
    name: 'Critical Path',
    description: 'Every build is planned backwards from the day it has to be standing.',
    requiresLabLevel: 13,
    cost: { caps: 8200, scrap: 6400, highQualityMetal: 520 },
    parts: { optic_cluster: 3 },
    channel: 'buildSpeedPercent',
    magnitude: 18,
  },

  // Signals: the quiet war.
  {
    id: 'tech_traffic_analysis',
    track: 'signals',
    tier: 1,
    name: 'Traffic Analysis',
    description: 'You do not need to read it. You need to know who is talking to whom.',
    requiresLabLevel: 3,
    cost: { caps: 1400, scrap: 600 },
    parts: {},
    channel: 'intelYieldPercent',
    magnitude: 12,
  },
  {
    id: 'tech_one_time_pads',
    track: 'signals',
    tier: 2,
    name: 'One-Time Pads',
    description: 'Slow, unbreakable, and everybody hates carrying the books.',
    requiresLabLevel: 8,
    cost: { caps: 3800, scrap: 2400, highQualityMetal: 160 },
    parts: { optic_cluster: 2 },
    channel: 'intelResistancePercent',
    magnitude: 18,
  },
  {
    id: 'tech_false_traffic',
    track: 'signals',
    tier: 3,
    name: 'False Traffic',
    description: 'A whole second district that does not exist, chattering away all night.',
    requiresLabLevel: 14,
    cost: { caps: 9000, scrap: 5200, highQualityMetal: 600 },
    parts: { targeting_core: 1, optic_cluster: 3 },
    channel: 'intelResistancePercent',
    magnitude: 26,
  },

  // Medicine: how many come back.
  {
    id: 'tech_field_triage',
    track: 'medicine',
    tier: 1,
    name: 'Field Triage',
    description: 'Deciding fast who can wait is most of the job.',
    requiresLabLevel: 2,
    cost: { caps: 1100, scrap: 500, supplies: 400 },
    parts: {},
    channel: 'casualtyRecoveryPercent',
    magnitude: 10,
  },
  {
    id: 'tech_blood_bank',
    track: 'medicine',
    tier: 2,
    name: 'Blood Bank',
    description: 'Cold storage, cross-matched, and everybody on the books is typed.',
    requiresLabLevel: 7,
    cost: { caps: 3400, scrap: 1800, highQualityMetal: 120 },
    parts: { coolant_cell: 1 },
    channel: 'casualtyRecoveryPercent',
    magnitude: 16,
  },
  {
    id: 'tech_trauma_theatre',
    track: 'medicine',
    tier: 3,
    name: 'Trauma Theatre',
    description: 'A room in the Infirmary that nobody is allowed to use for anything else.',
    requiresLabLevel: 12,
    cost: { caps: 7600, scrap: 4200, highQualityMetal: 480 },
    parts: { neural_shunt: 2, ceramic_plate: 3 },
    channel: 'unitVitalityPercent',
    magnitude: 12,
  },

  // Materials: what things cost, and what you can keep.
  {
    id: 'tech_sorted_salvage',
    track: 'materials',
    tier: 1,
    name: 'Sorted Salvage',
    description: 'Two extra bins and a rule about which one things go in.',
    requiresLabLevel: 2,
    cost: { caps: 900, scrap: 900 },
    parts: {},
    channel: 'storageCapacityPercent',
    magnitude: 12,
  },
  {
    id: 'tech_alloy_reclamation',
    track: 'materials',
    tier: 2,
    name: 'Alloy Reclamation',
    description: 'The good metal is in there. It is just mixed with everything else.',
    requiresLabLevel: 8,
    cost: { caps: 4200, scrap: 3400, highQualityMetal: 180 },
    parts: { ceramic_plate: 3 },
    channel: 'buildCostPercent',
    magnitude: 12,
  },
  {
    id: 'tech_standard_parts',
    track: 'materials',
    tier: 3,
    name: 'Standard Parts',
    description: 'One thread, one gauge, one size of bolt. It took two years to agree on.',
    requiresLabLevel: 13,
    cost: { caps: 8800, scrap: 7000, highQualityMetal: 560 },
    parts: { scrap_servo: 8, gyro_assembly: 2 },
    channel: 'trainingCostPercent',
    magnitude: 15,
  },

  // Ordnance: the ground itself, made hostile. Each rung both hardens the district and unlocks a
  // trap (`battle/traps.ts`); the channel is what it is worth passively, the trap is what it is
  // worth to somebody who walks into it.
  {
    id: 'tech_pressure_plates',
    track: 'ordnance',
    tier: 1,
    name: 'Pressure Plates',
    description: 'Two boards, a hinge, and a rule about which stairwell nobody uses.',
    requiresLabLevel: 3,
    cost: { caps: 1000, scrap: 1100 },
    parts: {},
    channel: 'defensePercent',
    magnitude: 6,
  },
  {
    id: 'tech_shaped_charges',
    track: 'ordnance',
    tier: 2,
    name: 'Shaped Charges',
    description:
      'The same explosive, pointed. It is entirely a question of what shape the hole is.',
    requiresLabLevel: 8,
    cost: { caps: 3600, scrap: 3000, oil: 400 },
    parts: { scrap_servo: 3 },
    channel: 'defensePercent',
    magnitude: 10,
  },
  {
    id: 'tech_demolition_doctrine',
    track: 'ordnance',
    tier: 3,
    name: 'Demolition Doctrine',
    description: 'Every approach surveyed, cut and re-cut, on the assumption it will be needed.',
    requiresLabLevel: 14,
    cost: { caps: 8600, scrap: 6800, highQualityMetal: 540 },
    parts: { targeting_core: 1, ceramic_plate: 4 },
    channel: 'defensePercent',
    magnitude: 16,
  },
];

export const TECHNOLOGIES: readonly TechSpec[] = SPECS;

const BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

export function findTech(id: string): TechSpec | undefined {
  return BY_ID.get(id);
}

export function techInTrack(track: TechTrack): TechSpec[] {
  return SPECS.filter((spec) => spec.track === track).sort((a, b) => a.tier - b.tier);
}

export type TechRefusal =
  | 'unknown_tech'
  | 'already_known'
  | 'needs_previous_tier'
  | 'needs_blueprint'
  | 'lab_too_low'
  | 'cannot_afford'
  | 'missing_parts';

/** The same order the workshop uses: what you can go and *do* comes before what you can wait for. */
export function techRefusal(
  id: string,
  known: readonly string[],
  labLevel: number,
  hasBlueprint: (item: ItemId) => boolean,
  affordable: (cost: PartialResources) => boolean,
  hasParts: (parts: ItemCost) => boolean,
): TechRefusal | null {
  const spec = findTech(id);
  if (!spec) return 'unknown_tech';
  if (known.includes(id)) return 'already_known';

  const previous = techInTrack(spec.track).find((other) => other.tier === spec.tier - 1);
  if (previous && !known.includes(previous.id)) return 'needs_previous_tier';
  if (spec.tier > 1 && !hasBlueprint(TECH_TRACK_BLUEPRINT[spec.track])) return 'needs_blueprint';
  if (labLevel < spec.requiresLabLevel) return 'lab_too_low';
  if (!affordable(spec.cost)) return 'cannot_afford';
  if (!hasParts(spec.parts)) return 'missing_parts';
  return null;
}

/**
 * What one programme does, in the words a player reads.
 *
 * Here rather than at the route, because it was written twice: the route folded the channel
 * through `CHANNEL_LABELS` and the e2e fixture printed the raw key, so every screenshot of the Lab
 * said `+8% PRODUCTIONPERCENT` while the running game said `+8% production speed`. A fixture that
 * disagrees with the server is a fixture that certifies the wrong screen, and a format string is
 * exactly the kind of thing nobody notices two copies of.
 *
 * `Flat` channels are points rather than percentages: the suffix is what says which.
 */
export function describeTechEffect(spec: TechSpec): string {
  const unit = spec.channel.endsWith('Flat') ? '' : '%';
  return `+${spec.magnitude}${unit} ${CHANNEL_LABELS[spec.channel].label.toLowerCase()}`;
}

/**
 * What the finished programmes are worth, as effect channels.
 *
 * Returned sparse and folded by the caller into the same struct everything else lands in, so a
 * technology needs no wiring of its own: whatever already reads `buildSpeedPercent` gets the Lab's
 * contribution to it for free.
 */
export function techEffects(known: readonly string[]): Partial<Record<EffectChannel, number>> {
  const total: Partial<Record<EffectChannel, number>> = {};
  for (const id of known) {
    const spec = findTech(id);
    if (!spec) continue;
    total[spec.channel] = (total[spec.channel] ?? 0) + spec.magnitude;
  }
  return total;
}
