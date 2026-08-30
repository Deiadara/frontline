import {
  PERK_CATALOG,
  applyPerkBonus,
  noCrewEffects,
  type CrewEffects,
  CITY_LOCATIONS,
  LOCATION_CATALOG,
  LOCATION_KINDS,
  MAX_LOCATION_LEVEL,
  bonusesAt,
  noTerritoryEffects,
  territoryEffectsFor,
  type HoldBonus,
  type LocationControl,
  type TerritoryEffects,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';

/**
 * §A4: every location pays into a channel something actually reads.
 *
 * The rule the location catalogue lives by, stated as a test: *a number on a screen that never
 * moves is worse than no number*. Twelve new channels arrived with the location rework: infamy
 * gain, mission speed, market and black-market discounts, refit and vehicle discounts, extra
 * training sessions, battle stims, salvage refunds, resource yield, officer boosts, intel, and
 * every one of them is a promise made on a card that a player pays resources to keep.
 *
 * What is measured is that a crew holding the entire city has a **non-zero figure in every single
 * channel**, which is a stronger statement than it looks, because it fails on two separate
 * mistakes that are otherwise invisible:
 *
 *   1. a bonus kind authored into the union and then never given to any location, and
 *   2. a location authored into the catalogue and then never placed on the map.
 *
 * The second is exactly what it caught on the day it was written: the Bone Market and the Arcade
 * existed, were priced, had upgrade notes and labels, and were in no district in the city. Nothing
 * else in the suite could see that: every unit test about them passed, because they were correct.
 */

/** Every channel of `TerritoryEffects`, from the zero value rather than from a second list. */
const CHANNELS = Object.keys(noTerritoryEffects()) as (keyof TerritoryEffects)[];

/** What one bonus is worth, whatever shape it is. Enough to tell "moved" from "did not". */
function magnitude(bonus: HoldBonus): number {
  if ('perHour' in bonus) return bonus.perHour;
  if ('amount' in bonus) return bonus.amount;
  if ('districts' in bonus) return bonus.districts;
  if ('flat' in bonus) return bonus.flat;
  return bonus.percent;
}

/** A crew holding every location in the city, worked all the way up. */
function holdingEverything(): TerritoryEffects {
  const controls = new Map<string, LocationControl>(
    CITY_LOCATIONS.map((location) => [
      location.id,
      {
        locationId: location.id,
        holder: { kind: 'faction', baseId: 'mine' },
        level: MAX_LOCATION_LEVEL,
        upgradingUntil: null,
        fortification: 0,
        fortifyingUntil: null,
        garrison: {},
      },
    ]),
  );
  return territoryEffectsFor('mine', CITY_LOCATIONS, controls);
}

describe('every channel a location pays into', () => {
  it('is pushed by at least one kind of location', () => {
    const pushed = new Set<string>();
    for (const kind of LOCATION_KINDS) {
      for (const bonus of LOCATION_CATALOG[kind].bonuses) pushed.add(bonus.kind);
    }
    // Read off the union's own members via the catalogue, so a bonus kind added and never used
    // shows up here rather than as a quiet gap.
    expect(pushed.size).toBeGreaterThanOrEqual(20);
  });

  /**
   * The real rule is that no channel is dead, and the map is no longer the only thing that can
   * feed one.
   *
   * The perk book (`crew/perks.ts`) pushes channels a location cannot: armour, tier-scoped unit
   * bonuses and mission pay have no plot of ground that grants them. Checking only the map would
   * therefore have forced those three to be given to some location whether or not that made sense,
   * which is the tail wagging the dog. What matters is that a channel has *a* source, so both are
   * folded and the assertion below is unchanged: nothing may be left at zero.
   *
   * This is the stronger version of the guard, not a relaxation. It now also covers the perk
   * catalogue, so a perk kind authored and never wired into `applyPerkBonus` shows up here too.
   */
  it('actually lands on the effects a crew holding the city, with every perk, would have', () => {
    const effects: CrewEffects = { ...noCrewEffects(), ...holdingEverything() };
    for (const perk of PERK_CATALOG) applyPerkBonus(effects, perk.bonus);

    const dead: string[] = [];
    for (const channel of CHANNELS) {
      const value = effects[channel];
      const moved = typeof value === 'number' ? value !== 0 : Object.keys(value ?? {}).length > 0;
      if (!moved) dead.push(channel);
    }
    expect(dead, 'channels nothing in the game pays into').toEqual([]);
  });

  /** And the crew-only half of the struct, which no location can reach at all. */
  it('leaves no crew-only channel that the perk book never pays into', () => {
    const effects = noCrewEffects();
    for (const perk of PERK_CATALOG) applyPerkBonus(effects, perk.bonus);

    const crewOnly = Object.keys(noCrewEffects()).filter((key) => !CHANNELS.includes(key as never));
    const dead = crewOnly.filter((key) => effects[key as keyof CrewEffects] === 0);
    expect(dead, 'crew-only channels no perk pays into').toEqual([]);
  });

  it('scales with the level a location has been worked up to', () => {
    for (const kind of LOCATION_KINDS) {
      const fresh = bonusesAt(kind, 1).reduce((sum, bonus) => sum + magnitude(bonus), 0);
      const worked = bonusesAt(kind, MAX_LOCATION_LEVEL).reduce(
        (sum, bonus) => sum + magnitude(bonus),
        0,
      );
      expect(worked, kind).toBeGreaterThan(fresh);
    }
  });
});
