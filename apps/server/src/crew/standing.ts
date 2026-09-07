import {
  CITY_LOCATIONS,
  combineEffects,
  crewEffects,
  noCrewEffects,
  territoryEffectsFor,
  type CrewMember,
  type Base,
  type CrewEffects,
  researchEffects,
  mergeCrewEffects,
  gateDefensePercent,
  gateIntelResistancePercent,
  raidLootBonus,
  liftOfficer,
  peerLift,
  officerIsInjured,
  FACTION_CARD_SPECS,
  cardBonusPercent,
  type Commander,
  type NumericEffectChannel,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { cardsAtTable } from '../factions/cards.js';
import { benchedMember, overseerMember, seatedMember } from '../roles/duties.js';

/**
 * Everything a crew currently has going for it: the ground it holds plus the people it has.
 *
 * One function, called everywhere `territoryEffectsFor` used to be called directly. That is the
 * point: territory effects were already threaded into the battle engine, the roster, the travel
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
  /** §D4: injured officers are out at this moment. Defaults to now, which is every caller but a test. */
  now: Date = new Date(),
): CrewEffects {
  const territory = territoryEffectsFor(base.id, CITY_LOCATIONS, repos.city.controls());
  const total = combineEffects(territory, crewEffects(crewSheetsFor(repos, base, now)));
  /*
   * The Garage is deliberately **not** folded in here (§C3).
   *
   * It used to be: every machine in the yard added a flat percentage to this crew's travel speed
   * forever, whether or not anybody ever got on one. That is a building bonus wearing a vehicle's
   * name. A vehicle shortens the road for the force it is *carrying*, which is a fact about a
   * particular column rather than about the crew, so it is applied where a column is put on the
   * road (`battle/movement.ts`) off what that column actually took.
   */
  // The Lab's finished programmes, folded rather than assigned, so a rung adds to whatever the
  // ground and the people were already worth on the same channel, a tier's armour and a chair at
  // the Bar included.
  Object.assign(total, mergeCrewEffects(total, researchEffects(base.research.technologies)));
  /*
   * The table's cards (§L, `factions/cards.ts`). Each seat at the faction's table is a card
   * responsible for one aspect of the faction, read off its holder's own sheet, and every member
   * is paid on it: the leader's ace is what the whole table hits for. Folded here because here is
   * the one place every consumer of a crew's standing reads from, so a card that paid out
   * anywhere else would be a bonus some fights saw and others did not.
   */
  for (const [channel, percent] of factionCardBonuses(repos, base)) total[channel] += percent;
  /*
   * §B7: the Gate, folded here because here is the only way into a fight.
   *
   * `gateDefensePercent` and `gateIntelResistancePercent` are computed off the structure's level
   * and were read by nobody: the percentage existed, had tests, and never reached
   * `battle/effects.ts`, which is the same shape as the eight `officer_group` perks that folded
   * into a channel with no consumer. A number that cannot be measured in a fight is decoration.
   *
   * Added to the same two channels the map and the crew already pay into, so a Gate and a
   * fortified location are one figure on the report rather than two to reconcile.
   */
  total.defensePercent += gateDefensePercent(base.buildings);
  total.intelResistancePercent += gateIntelResistancePercent(base.buildings);
  /*
   * §A1: what the district's own modifications add to a haul.
   *
   * Same shape as the Gate above, and the same bug it fixes. `raid_loot_percent` is authored on
   * three modifications (Salvage Drones, Sally Port, Haulage Rigs at +22), summed by
   * `districtEffects`, and read only by `raidLootBonus`, which nothing called. The raid path sizes
   * its haul from `lootCapacityPercent` on this fold, so the three cards promised a bigger truck
   * and handed the raider the same one. Folded into that channel rather than spent at the raid, so
   * a modification and a hold bonus are one figure on the report rather than two to reconcile.
   */
  total.lootCapacityPercent += raidLootBonus(base.buildings);
  return total;
}

/** Just the people: the same fold without the ground, for anything that is not about territory. */
export function crewEffectsFor(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): CrewEffects {
  const sheets = crewSheetsFor(repos, base, now);
  const people = sheets.length === 0 ? noCrewEffects() : crewEffects(sheets);
  // Production, storage and costs are read through *this* fold rather than the territory one, so
  // the Lab has to land here too or half its tech tree would do nothing at all.
  return mergeCrewEffects(people, researchEffects(base.research.technologies));
}

/**
 * Every sheet in the room: the Overseer's, then each officer's.
 *
 * The Overseer is looked up through the owning user rather than stored on the base, because that
 * is where the link lives. A base whose owner has not chosen one yet, which is a real state
 * between registration and character select: contributes officers only.
 */
export function crewSheetsFor(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): CrewMember[] {
  /*
   * §A4/§B7: what everybody else puts on this officer's sheet, before best-of.
   *
   * Two sources, applied per officer by `liftOfficer`, and both are lifts from *other people*.
   *
   * The ground (the Chapel, the Broadcast Station) lifts a whole attribute group for everybody.
   * Applied to the sheets rather than to the crew's channels afterwards, and the difference
   * matters: the boost is worth more to a crew whose best person in that group is the one it
   * lifts, and an officer sitting in a seat that does not use the attribute still contributes only
   * the off-duty share of the raised figure. Both are what a player would predict from "the chapel
   * makes your people steadier".
   *
   * The other officers' **perks** are the half that was missing. `officer_group` folded into a
   * channel that nothing on either side of the wire ever read, so eight perks in the catalogue
   * were decoration: a player could hire the Hard Trainer and measure no difference anywhere. The
   * fold was skipped here on the grounds that reading the crew's own effects while building the
   * crew's sheet is circular, and it would be. Perks are not: they are static ids on a person, so
   * `peerLift` folds them without needing a single sheet.
   *
   * Every officer is lifted by everybody *except themselves*, which is the board's rule and also
   * the only reading that makes sense. A perk that raised the number printed beside it on the same
   * card is not a bonus, it is a different number.
   */
  const byGroup = territoryEffectsFor(
    base.id,
    CITY_LOCATIONS,
    repos.city.controls(),
  ).officerGroupFlat;

  // The role travels with the sheet now (§C2). `crewSheet` pays a person their full rating only in
  // the attributes their seat actually uses, so dropping the role here would silently discount
  // every officer in the game to the off-duty share.
  /*
   * §D4: an officer in a bed is not in the room.
   *
   * "Services and bonuses inactive" has to mean *every* way an officer is worth something, and an
   * officer is worth three separate things: their own ratings through best-of, their perks through
   * the sum, and the lift their perks put on everybody else's sheet. Dropping them from the list
   * here turns all three off in one place. Filtering them out of `crewEffects` instead would have
   * left the third one running: their peers would still have been reading their teaching perks.
   *
   * Settled lazily off the stored timestamp and never written back. There is nothing to write: a
   * clock in the past reads as fit on every path that asks, so a recovery costs no query and no
   * scheduler.
   */
  const fit = base.commanders.filter(
    (officer: Commander) => !officerIsInjured(officer.injuredUntil, now),
  );
  const officers: CrewMember[] = fit.map((officer) => {
    const peers = fit.filter((other) => other.id !== officer.id);
    const lift = peerLift(peers.flatMap((other) => other.perks));
    const attributes = liftOfficer(officer.attributes, lift, byGroup);
    // §C2: somebody on the bench is on the books and in no chair, which is a different thing from
    // the Overseer being in no chair. `benchedMember` pays the off-duty share of everything.
    return officer.role === null
      ? benchedMember(attributes, officer.perks)
      : seatedMember(attributes, officer.role, officer.perks);
  });
  const owner = repos.users.findById(base.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  // The Overseer is the player, not an employee: no seat, and no discount anywhere.
  return overseer ? [overseerMember(overseer.attributes, overseer.perks), ...officers] : officers;
}

/**
 * What the crew's faction pays it, channel by channel, off the cards at its table.
 *
 * Nothing for a crew at no table. A seat is worth `cardBonusPercent` of its holder's mark on the
 * card's own channel; five seats can push five different channels, or an empty table none.
 */
export function factionCardBonuses(
  repos: Repositories,
  base: Base,
): [NumericEffectChannel, number][] {
  const membership = repos.factions.membershipOf(base.ownerId);
  if (!membership) return [];
  return [...cardsAtTable(repos, membership.factionId).values()].map((held) => [
    FACTION_CARD_SPECS[held.card].channel,
    cardBonusPercent(held.mark),
  ]);
}
