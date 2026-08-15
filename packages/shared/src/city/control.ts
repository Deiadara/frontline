import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { fortifyBonusPercent } from './fortification.js';
import { findDistrict, unifiedBonusFor, type District } from './districts.js';
import {
  PLACE_KIND_CATALOG,
  applyHoldBonus,
  noTerritoryEffects,
  type Place,
  type TerritoryEffects,
} from './places.js';

/**
 * Who holds what, and what that is worth (GDD §A4).
 *
 * Control is **world state, not player state**: a place is held by exactly one party and every
 * player sees the same answer. That is why it lives in its own table rather than inside a base —
 * two crews reading their own copy of who holds the Bonefield is how a shared map stops being
 * shared.
 */

/**
 * The parties that can hold ground.
 *
 * `unoccupied` is a real state, not the absence of one: an empty place still has to be walked into
 * and can still be taken off you afterwards, and saying so explicitly means no caller has to treat
 * `null` as a fifth case.
 */
export const PLACE_HOLDER_KINDS = ['unoccupied', 'government', 'looters', 'faction'] as const;
export const PlaceHolderKindSchema = z.enum(PLACE_HOLDER_KINDS);
export type PlaceHolderKind = z.infer<typeof PlaceHolderKindSchema>;

export const PlaceHolderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unoccupied') }),
  z.object({ kind: z.literal('government') }),
  z.object({ kind: z.literal('looters') }),
  /** A crew — the base that holds it, which is also who its garrison answers to. */
  z.object({ kind: z.literal('faction'), baseId: IdSchema }),
]);
export type PlaceHolder = z.infer<typeof PlaceHolderSchema>;

export const HOLDER_LABELS: Record<PlaceHolderKind, string> = {
  unoccupied: 'Unoccupied',
  government: 'The Combine',
  looters: 'Looters',
  faction: 'Another crew',
};

/** One place's world state. */
export const PlaceControlSchema = z.object({
  placeId: z.string().min(1),
  holder: PlaceHolderSchema,
  /** 0..`FORTIFY_MAX_LEVEL`. Reset to 0 whenever the place changes hands. */
  fortification: z.number().int().min(0),
  /** Set while a fortification level is being dug in; null when nothing is under way. */
  fortifyingUntil: IsoDateTimeSchema.nullable(),
  /** Units standing here, keyed by unit id. Belongs to whoever `holder` is. */
  garrison: z.record(z.string(), z.number().int().nonnegative()),
});
export type PlaceControl = z.infer<typeof PlaceControlSchema>;

export function isHeldBy(control: PlaceControl, baseId: string): boolean {
  return control.holder.kind === 'faction' && control.holder.baseId === baseId;
}

/** Two holders being the same party — the question "did this actually change hands?" asks. */
export function sameHolder(a: PlaceHolder, b: PlaceHolder): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'faction' && b.kind === 'faction') return a.baseId === b.baseId;
  return true;
}

/** How many units are standing on a place, whoever they belong to. */
export function garrisonSize(control: PlaceControl): number {
  return Object.values(control.garrison).reduce((total, count) => total + count, 0);
}

/**
 * What a raider has to beat to take this place.
 *
 * Three terms, and each is something somebody chose: the ground itself (the catalogue's
 * `baseDefense`), how deeply the holder has dug in (fortification), and how many of them are
 * standing on it. Held by nobody, it is the ground alone — which is why an unoccupied place is
 * worth walking into early.
 */
export const DEFENSE_PER_GARRISON_UNIT = 0.4;

export function placeDefense(place: Place, control: PlaceControl): number {
  const ground = PLACE_KIND_CATALOG[place.kind].baseDefense;
  const dug = fortifyBonusPercent(place.fortifyDifficulty, control.fortification);
  const standing = garrisonSize(control) * DEFENSE_PER_GARRISON_UNIT;
  return Math.round((ground + standing) * (1 + dug / 100) * 10) / 10;
}

/**
 * Who holds *all* of a district, or `null` when nobody does.
 *
 * The §A4 unified bonus turns on this and nothing else: a district split between two crews pays
 * neither of them, which is what makes finishing one worth more than farming the best place in it.
 */
export function districtHolder(
  district: District,
  controls: ReadonlyMap<string, PlaceControl>,
): PlaceHolder | null {
  if (district.places.length === 0) return null;

  const first = controls.get(district.places[0]!.id);
  if (!first || first.holder.kind === 'unoccupied') return null;

  for (const place of district.places) {
    const control = controls.get(place.id);
    if (!control || !sameHolder(control.holder, first.holder)) return null;
  }
  return first.holder;
}

/** Every district this crew has taken outright. */
export function districtsHeldBy(
  baseId: string,
  districts: readonly District[],
  controls: ReadonlyMap<string, PlaceControl>,
): District[] {
  return districts.filter((district) => {
    const holder = districtHolder(district, controls);
    return holder?.kind === 'faction' && holder.baseId === baseId;
  });
}

/**
 * Everything this crew's territory is currently worth, in one pass.
 *
 * Each place it holds contributes its own hold bonus, and each district it holds *outright*
 * contributes the unified bonus on top. Nothing here is stored — territory value is derived from
 * the control table every time it is asked, so a place changing hands takes effect immediately and
 * there is no second copy to keep in step.
 */
export function territoryEffectsFor(
  baseId: string,
  places: readonly Place[],
  controls: ReadonlyMap<string, PlaceControl>,
): TerritoryEffects {
  const effects = noTerritoryEffects();

  const held = new Set<string>();
  for (const place of places) {
    const control = controls.get(place.id);
    if (!control || !isHeldBy(control, baseId)) continue;
    held.add(place.districtId);
    applyHoldBonus(effects, PLACE_KIND_CATALOG[place.kind].bonus);
  }

  for (const districtId of held) {
    const district = findDistrict(districtId);
    if (!district) continue;
    const holder = districtHolder(district, controls);
    if (holder?.kind !== 'faction' || holder.baseId !== baseId) continue;
    const unified = unifiedBonusFor(districtId);
    if (unified) applyHoldBonus(effects, unified.bonus);
  }

  return effects;
}

/**
 * Who is actually standing on an NPC place, and how many.
 *
 * Every place used to start with `garrison: {}` — held on paper by the Combine or the looters, and
 * defended by nobody at all. So every place on the map could be taken by one Razor, for free, and
 * the entire city layer was a formality. The fiction had said so all along: "the Rustyard being
 * full of looters is what gives a new crew something to fight that will lose."
 *
 * Derived, not authored: the size comes off the district's own difficulty and the place's
 * `baseDefense`, so a place added to the catalogue tomorrow is garrisoned without anybody
 * remembering to garrison it. Deterministic, so the world is the same for every player and a test
 * can state what is on a place rather than sample it.
 *
 * The Combine fields regulars and the looters field rabble, which is most of what makes Combine
 * ground worth being frightened of (§A3).
 */
// Tuned against the opening move, not in the abstract: a new crew fields four Razors and can train
// more for nothing, so the easiest place in the city has to be takeable by a first-session force
// that has made a little effort. At 1.2/0.9 the Rustyard's press holds four and the Combine's hard
// ground holds fifteen, which is the spread the difficulty numbers were written for.
export const GARRISON_PER_DIFFICULTY = 1.2;
export const GARRISON_PER_BASE_DEFENSE = 0.9;

// Typed off the row rather than as an `Army`: `units/` imports `city/`, so naming the unit type
// here would close a cycle. The ids are still unit ids and `city.test.ts` pins that they resolve.
export function startingGarrison(place: Place, district: District): PlaceControl['garrison'] {
  const holder = startingHolder(district);
  if (holder.kind === 'unoccupied' || holder.kind === 'faction') return {};

  const strength = Math.max(
    2,
    Math.round(
      district.difficulty * GARRISON_PER_DIFFICULTY +
        PLACE_KIND_CATALOG[place.kind].baseDefense * GARRISON_PER_BASE_DEFENSE,
    ),
  );

  if (holder.kind === 'government') {
    // Combine ground: a line, not a mob. Two thirds shields, one third guns.
    const wardens = Math.max(1, Math.round(strength * 0.65));
    return { wardens, snipers: Math.max(1, strength - wardens) };
  }
  // Looters: numbers and knives.
  const razors = Math.max(1, Math.round(strength * 0.7));
  return { razors, scrapers: Math.max(1, strength - razors) };
}

/** A fresh, untouched place: whoever nominally garrisons the district, and who they left on it. */
export function startingControl(place: Place, district: District): PlaceControl {
  return {
    placeId: place.id,
    holder: startingHolder(district),
    fortification: 0,
    fortifyingUntil: null,
    garrison: startingGarrison(place, district),
  };
}

/**
 * Who is standing on a place before anybody has been to it.
 *
 * Combine ground is garrisoned by the Combine (§A3). Independent ground is *looted* rather than
 * empty, because a city with free real estate lying around has no opening move worth making —
 * the Rustyard being full of looters is what gives a new crew something to fight that will lose.
 */
export function startingHolder(district: District): PlaceHolder {
  return district.faction === 'government' ? { kind: 'government' } : { kind: 'looters' };
}
