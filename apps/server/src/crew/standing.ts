import {
  CITY_LOCATIONS,
  combineEffects,
  crewEffects,
  noCrewEffects,
  territoryEffectsFor,
  type CrewMember,
  type Base,
  type CrewEffects,
  fleetTravelSpeedPercent,
  sacrificeEffect,
  techEffects,
  ATTRIBUTES_BY_GROUP,
  clampAttribute,
  type AttributeGroup,
  type Attributes,
  type TerritoryEffects,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { overseerMember, seatedMember } from '../roles/duties.js';

/**
 * Everything a crew currently has going for it: the ground it holds plus the people it has.
 *
 * One function, called everywhere `territoryEffectsFor` used to be called directly. That is the
 * point — territory effects were already threaded into the battle engine, the roster, the travel
 * clock and the city view, and routing the crew's attributes through the same struct wires them
 * into all four without a new parameter anywhere. A separate "attribute bonus" argument would have
 * had to be added to each of those call chains by hand, and the one somebody forgot is the one
 * where a player's Cryptography quietly does nothing.
 *
 * Bot bases have no Overseer and usually no officers; they get their territory and nothing else,
 * which is correct rather than a gap. An AI rival is the ground it stands on.
 */
export function standingEffectsFor(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): CrewEffects {
  const territory = territoryEffectsFor(base.id, CITY_LOCATIONS, repos.city.controls());
  const total = combineEffects(territory, crewEffects(crewSheetsFor(repos, base)));
  // The Garage. Motorcycles and rotorcraft take time off the road, and the road is the one cost
  // nothing else in the game touches — so the yard lands on the same lever the map already reads
  // rather than on a parallel one nobody would remember to thread through.
  total.travelSpeedPercent += fleetTravelSpeedPercent(base.fleet);
  // The Lab's finished programmes. Sparse, and folded rather than assigned, so a technology adds
  // to whatever the ground and the people were already worth on the same channel.
  for (const [channel, amount] of Object.entries(techEffects(base.research.technologies))) {
    total[channel as keyof typeof total] =
      (total[channel as keyof typeof total] as number) + (amount ?? 0);
  }
  // §D7 — a name burned for an advantage. Lands on the same channels as everything else, so a
  // sacrifice needs no wiring of its own and expires simply by stopping being counted.
  const burning = sacrificeEffect(base.economy.sacrifice, now);
  if (burning) total[burning.channel] += burning.magnitude;
  return total;
}

/** Just the people — the same fold without the ground, for anything that is not about territory. */
export function crewEffectsFor(repos: Repositories, base: Base): CrewEffects {
  const sheets = crewSheetsFor(repos, base);
  const people = sheets.length === 0 ? noCrewEffects() : crewEffects(sheets);
  // Production, storage and costs are read through *this* fold rather than the territory one, so
  // the Lab has to land here too or half its tech tree would do nothing at all.
  for (const [channel, amount] of Object.entries(techEffects(base.research.technologies))) {
    people[channel as keyof typeof people] =
      (people[channel as keyof typeof people] as number) + (amount ?? 0);
  }
  return people;
}

/**
 * Every sheet in the room: the Overseer's, then each officer's.
 *
 * The Overseer is looked up through the owning user rather than stored on the base, because that
 * is where the link lives. A base whose owner has not chosen one yet — which is a real state
 * between registration and character select — contributes officers only.
 */
/**
 * §A4 — flat points the ground adds to every officer, by attribute group.
 *
 * The Chapel (mental fortitude) and the Broadcast Station (talking to people). Applied to the
 * *officers' sheets* before best-of rather than to the crew's channels afterwards, and the
 * difference matters: it means the boost is worth more to a crew whose best person in that group
 * is the one it lifts, and it means an officer sat in a seat that does not use the attribute still
 * only contributes the off-duty share of the raised figure. Both are the behaviour a player would
 * predict from "the chapel makes your people steadier".
 *
 * Not applied to the Overseer: they are the player, they train on the Training tab, and a building
 * that quietly moved the number on their own sheet would make that screen a liar.
 */
function liftedByGround(
  attributes: Attributes,
  byGroup: TerritoryEffects['officerGroupFlat'],
): Attributes {
  const groups = Object.entries(byGroup).filter(([, flat]) => (flat ?? 0) > 0);
  if (groups.length === 0) return attributes;

  const lifted = { ...attributes };
  for (const [group, flat] of groups) {
    for (const name of ATTRIBUTES_BY_GROUP[group as AttributeGroup]) {
      lifted[name] = clampAttribute(lifted[name] + (flat ?? 0));
    }
  }
  return lifted;
}

export function crewSheetsFor(repos: Repositories, base: Base): CrewMember[] {
  // The role travels with the sheet now (§C2). `crewSheet` pays a person their full rating only in
  // the attributes their seat actually uses, so dropping the role here would silently discount
  // every officer in the game to the off-duty share.
  // The ground only, deliberately — a crew's sheet is what we are *building*, so reading the
  // combined fold here would be circular.
  const byGroup = territoryEffectsFor(
    base.id,
    CITY_LOCATIONS,
    repos.city.controls(),
  ).officerGroupFlat;
  const officers: CrewMember[] = base.commanders.map((officer) =>
    seatedMember(liftedByGround(officer.attributes, byGroup), officer.role),
  );
  const owner = repos.users.findById(base.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  // The Overseer is the player, not an employee: no seat, and no discount anywhere.
  return overseer ? [overseerMember(overseer.attributes), ...officers] : officers;
}
