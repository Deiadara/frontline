import {
  CITY_LOCATIONS,
  combineEffects,
  crewEffects,
  noCrewEffects,
  notorietyEffects,
  territoryEffectsFor,
  type CrewMember,
  type Base,
  type CrewEffects,
  researchEffects,
  mergeCrewEffects,
  gateDefensePercent,
  gateIntelResistancePercent,
  raidLootBonus,
  liftedSheet,
  peerLift,
  officerIsInjured,
  FACTION_CARD_SPECS,
  cardBonusPercent,
  disrupted,
  disruptionPercentAt,
  type AttributeLift,
  type Attributes,
  type Commander,
  type LiftSource,
  markFromPoints,
  type NumericEffectChannel,
  type OfficerMark,
  type OfficerRole,
  type TerritoryEffects,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { cardsAtTable } from '../factions/cards.js';
import { benchedMember, overseerMember, seatedMember } from '../roles/duties.js';
import { roleFit } from '../roles/requirements.js';

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
 *
 * §A4: **the fold is the last thing a raid takes off you.** Both folds end in `disrupted`, so for
 * the hours a raid's disruption lasts every positive percentage this crew holds is worth a quarter
 * less, whatever paid it: the ground, the people, the Lab, the table, the Gate. Applied here rather
 * than at each consumer for the reason everything else is folded here: a consumer that read the raw
 * fold would be a system a raid quietly did not reach, and there are two dozen of them.
 * `productionPercent` is the one channel the cut skips, because the walk has already charged for it
 * once as hours off the window: see `DISRUPTION_EXEMPT_CHANNELS` for why cutting it here as well
 * would bill a raided crew twice for one raid.
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
  /*
   * §D7: what the crew's rank is worth, folded where everything else is.
   *
   * Notoriety was a gate and ran out of things to gate at rank 5, so the eight ranks above it
   * changed no number in the game (`economy/renown.ts` says what each one pays now). Folded here
   * rather than spent at a consumer for the reason the Gate and the raid cards are: a bonus read
   * in one place is a bonus the other two dozen consumers do not see.
   */
  Object.assign(total, combineEffects(notorietyEffects(base.economy.notoriety), total));
  return disrupted(total, disruptionPercentAt(base.economy.disruption, now));
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
  const total = mergeCrewEffects(people, researchEffects(base.research.technologies));
  // §D7: a rank is a fact about the crew, not about the ground, so it belongs in this fold too.
  const withRank = combineEffects(notorietyEffects(base.economy.notoriety), total);
  return disrupted(withRank, disruptionPercentAt(base.economy.disruption, now));
}

/**
 * One officer's sheet as the crew fields it, with a receipt naming every point that is not theirs.
 *
 * Split out of `crewSheetsFor` because two callers need it and they need different halves: the
 * effects fold wants the attributes, and the crew screen wants the receipt, so that a player
 * looking at a 22 where they hired a 20 can be told which of their people put the 2 there.
 *
 * The sources are passed as a labelled list rather than merged, which is the whole reason a
 * breakdown is possible: a merged fold knows the total and not whose it was. Ground first, then
 * the Overseer, then the officers, then the Lab: at the cap (`MAX_OFFICER_LIFT`) that order
 * decides who gets the last point, and putting the ground and the Overseer first means the scarce
 * room goes to the things a player chose deliberately rather than to whoever happened to be hired.
 */
/**
 * The room, read once: everything an officer can be lifted by that is not the officer.
 *
 * Built here rather than inside `liftedOfficerSheet` because it is the same for every officer on
 * the books and it costs three reads (the city's control rows, the owner and their character):
 * building it per officer would make opening the crew screen nineteen times the work.
 */
export function officerLiftRoom(repos: Repositories, base: Base, now: Date = new Date()): LiftRoom {
  const owner = repos.users.findById(base.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  return {
    fit: base.commanders.filter(
      (officer: Commander) => !officerIsInjured(officer.injuredUntil, now),
    ),
    byGroup: territoryEffectsFor(base.id, CITY_LOCATIONS, repos.city.controls()).officerGroupFlat,
    fromTheLab: researchEffects(base.research.technologies),
    fromTheOverseer: overseer?.perks ?? [],
    overseerName: overseer?.name ?? 'your Overseer',
  };
}

/** Everything that lifts an officer, other than the officer. See {@link officerLiftRoom}. */
export interface LiftRoom {
  /** Everybody on the books and out of bed. Each officer is filtered out of their own lift. */
  fit: readonly Commander[];
  byGroup: TerritoryEffects['officerGroupFlat'];
  fromTheLab: CrewEffects;
  fromTheOverseer: readonly string[];
  overseerName: string;
}

export function liftedOfficerSheet(
  officer: Commander,
  room: LiftRoom,
): { attributes: Attributes; lift: AttributeLift[] } {
  const sources: LiftSource[] = [{ from: 'the ground you hold', groupFlat: room.byGroup }];

  const overseer = peerLift(room.fromTheOverseer);
  sources.push({
    from: room.overseerName,
    groupFlat: overseer.officerGroupFlat,
    attributeFlat: overseer.officerAttributeFlat,
    attributeAtLeast: overseer.officerAttributeAtLeast,
  });

  // Per teacher rather than per crew, so the receipt names the person. It costs one `peerLift` per
  // peer instead of one for the room, which is a handful of table lookups over a list that is
  // capped at nineteen.
  for (const peer of room.fit) {
    if (peer.id === officer.id) continue;
    const taught = peerLift(peer.perks);
    sources.push({
      from: peer.name,
      groupFlat: taught.officerGroupFlat,
      attributeFlat: taught.officerAttributeFlat,
      attributeAtLeast: taught.officerAttributeAtLeast,
    });
  }

  sources.push({
    from: 'the Lab',
    groupFlat: room.fromTheLab.officerGroupFlat,
    attributeFlat: room.fromTheLab.officerAttributeFlat,
    attributeAtLeast: room.fromTheLab.officerAttributeAtLeast,
  });

  return liftedSheet(officer.attributes, sources);
}

/**
 * How good an officer is in a chair, measured on the sheet they actually have (§B8, §C1b).
 *
 * One reader, because the game had two answers to one question. `roleFit` takes an `Attributes`
 * and every caller but one handed it `officer.attributes`, the **printed** sheet: the number on
 * the card before the Overseer, the teaching perks, the ground and the Lab have lifted it. The
 * Scrapyard was the exception and read the lifted sheet, so the same officer was a C+ at the bench
 * and a C on the crew screen, the Lab gated a rung on the lower of the two, and the officer whose
 * mark the yard had just accepted could not start the research their chair is named after.
 *
 * The lift is not a rounding error. `MAX_OFFICER_LIFT` is ten points, `roleFit` is a weighted mean
 * over five attributes and a mark band is 4.29 points wide, so a fully taught officer moves more
 * than two whole marks. That is the whole of what the Overseer's teaching perks and the Chapel
 * were bought for, and until now none of it reached a gate.
 *
 * Built once per request off {@link officerLiftRoom}, which costs three reads, and then answers
 * every chair from memory: `labResearchItems` asks nineteen times for one page.
 */
export interface OfficerFitReader {
  /** The mark held by whoever is sitting in `role`, or null when the chair is empty. */
  markFor: (role: OfficerRole) => OfficerMark | null;
  /** The fit points `officer` would be marked on in `role`, off their lifted sheet. */
  pointsFor: (officer: Commander, role: OfficerRole) => number;
}

export function officerFitReader(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): OfficerFitReader {
  const room = officerLiftRoom(repos, base, now);
  // One lifted sheet per officer, not per question: `liftedOfficerSheet` folds every peer's perks
  // and the answer does not change between two chairs.
  const sheets = new Map<string, Attributes>();
  const sheetFor = (officer: Commander): Attributes => {
    const held = sheets.get(officer.id);
    if (held !== undefined) return held;
    const { attributes } = liftedOfficerSheet(officer, room);
    sheets.set(officer.id, attributes);
    return attributes;
  };

  return {
    pointsFor: (officer, role) => roleFit(sheetFor(officer), role),
    markFor: (role) => {
      const officer = base.commanders.find((one) => one.role === role);
      return officer ? markFromPoints(roleFit(sheetFor(officer), role)) : null;
    },
  };
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
  return crewRoomFor(repos, base, now).sheets;
}

/** Every sheet in the room, and the name of the person each one belongs to, in the same order. */
export interface CrewRoom {
  sheets: CrewMember[];
  /** `sheets[i]` belongs to `names[i]`. The Overseer is named, like everybody else in the room. */
  names: string[];
}

/**
 * The room, with the names kept.
 *
 * `crewSheetsFor` is this without them, and it is the older of the two. A `CrewMember` is
 * attributes, perks and a chair with nobody's name on it, which is right for the arithmetic and
 * useless for the roster's new question: which officer is the twenty percent coming from
 * (maintainer, 2026-09-17). Built here rather than by a second walk beside it, so the name and the
 * sheet cannot end up belonging to two different people.
 */
export function crewRoomFor(repos: Repositories, base: Base, now: Date = new Date()): CrewRoom {
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
   * Every officer is lifted by everybody *except themselves*, which is the maintainer's rule and also
   * the only reading that makes sense. A perk that raised the number printed beside it on the same
   * card is not a bonus, it is a different number.
   *
   * The Lab is the third source, and it was the one doing nothing. Nine rungs pay `officer_group`
   * or `officer_attribute` (Compartmentation, The Archive, Field Promotions, The Reading Year among
   * them), `researchEffects` folded them into `standingEffectsFor`, and this function never read
   * that fold: it took the ground's channel straight off `territoryEffectsFor` and the perks'
   * straight off `peerLift`, so a finished rung raised a number nothing looked at. A programme is
   * not a person, so it lifts everybody including whoever ran it, and it is folded here, on the
   * lift, rather than into the sheets afterwards, for the same reason the ground is: the boost is
   * worth more to the crew whose specialist it raises.
   */
  const room = officerLiftRoom(repos, base, now);

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
  const fit = room.fit;
  const owner = repos.users.findById(base.ownerId);
  const overseer = owner?.overseerId ? repos.overseers.findById(owner.overseerId) : undefined;
  /*
   * The Overseer teaches too, and their perk is the largest one in the book that does.
   *
   * `sig_drillmaster` is +5 social to every officer on the books, roughly double an ordinary
   * teaching perk because there is one Overseer and they carry it for the whole run. It folded
   * into `officerGroupFlat` and stopped there: this lift was built out of `base.commanders`, the
   * Overseer is prepended to the sheets below, and the two never met. The character-select card
   * and the profile screen both printed the +5 while no sheet in the game moved.
   *
   * Never-lift-yourself is untouched by this. The Overseer is not an officer, so they are not in
   * `fit` and nothing here lifts their own sheet: they teach the room and take nothing back.
   */
  const officers: CrewMember[] = fit.map((officer) => {
    const { attributes } = liftedOfficerSheet(officer, room);
    // §C2: somebody on the bench is on the books and in no chair, which is a different thing from
    // the Overseer being in no chair. `benchedMember` pays the off-duty share of everything.
    return officer.role === null
      ? benchedMember(attributes, officer.perks)
      : seatedMember(attributes, officer.role, officer.perks);
  });
  const names = fit.map((officer) => officer.name);
  // The Overseer is the player, not an employee: no seat, and no discount anywhere.
  return overseer
    ? {
        sheets: [overseerMember(overseer.attributes, overseer.perks), ...officers],
        names: [overseer.name, ...names],
      }
    : { sheets: officers, names };
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
