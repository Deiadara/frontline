import {
  EVERY_LOCATION,
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
  gateIsBroken,
  gateIntelResistancePercent,
  raidLootBonus,
  liftedSheet,
  rightHandLift,
  MAX_RIGHT_HAND_LIFT,
  MAX_OVERSEER_LIFT,
  peerLift,
  officerIsWorking,
  FACTION_CARD_SPECS,
  cardBonusPercent,
  type AttributeLift,
  type Attributes,
  type Commander,
  type LiftSource,
  markFromPoints,
  type NumericEffectChannel,
  type OfficerMark,
  type OfficerRole,
  type SeatedOfficer,
  type TerritoryEffects,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { cardsAtTable } from '../factions/cards.js';
import { overseerMember, seatedMember } from '../roles/duties.js';
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
 * §A4: a raid does not reach this fold. Its cut is on what the district's structures make and
 * nothing else (maintainer ruling, 2026-09-29), and the production walk charges it
 * (`district/settle.ts`); the crew's bonuses run whole through a raid.
 */
export function standingEffectsFor(
  repos: Repositories,
  base: Base,
  /** §D4: injured officers are out at this moment. Defaults to now, which is every caller but a test. */
  now: Date = new Date(),
): CrewEffects {
  // Every location in the world, not Ashfall's sixty (2026-09-24). A crew that marched across and
  // took ground in Terminus was paid nothing for it: no unit slots, no travel off the clock, no
  // production, no intel resistance. The ground a crew holds is the ground it holds, wherever it is.
  const territory = territoryEffectsFor(base.id, EVERY_LOCATION, repos.city.controls());
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
   * The defence goes to its own channel and the intel resistance to the one the map and the crew
   * already pay into.
   */
  // Into its own channel, not `defensePercent`: Breaching and a Wall Breaker are both answers to
  // the gate and to nothing else the crew holds (`city/locations.ts`, `gatePercent`).
  // A broken gate gives nothing (maintainer, 2026-09-27): a door off its hinges holds no one out
  // and hides nothing, until the breach closes.
  if (!gateIsBroken(repos.sieges.gate(base.districtId), now)) {
    total.gatePercent += gateDefensePercent(base.buildings);
    total.intelResistancePercent += gateIntelResistancePercent(base.buildings);
  }
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
  const total = mergeCrewEffects(people, researchEffects(base.research.technologies));
  // §D7: a rank is a fact about the crew, not about the ground, so it belongs in this fold too.
  return combineEffects(notorietyEffects(base.economy.notoriety), total);
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
  // Out of bed and in a chair (`officerIsWorking`). The bench lifts nobody and is in no fold.
  const fit = base.commanders.filter((officer) => officerIsWorking(officer, now));
  /*
   * The Right Hand, read once for the room (§C2b).
   *
   * Their fit is measured on their **printed** sheet rather than their lifted one, deliberately:
   * every other officer's lift includes the Right Hand's, so reading theirs after the room was
   * built would make the answer depend on the order the officers were walked in.
   */
  const rightHand = fit.find((officer) => officer.role === 'right_hand') ?? null;
  return {
    fit,
    byGroup: territoryEffectsFor(base.id, EVERY_LOCATION, repos.city.controls()).officerGroupFlat,
    fromTheLab: researchEffects(base.research.technologies),
    fromTheOverseer: overseer?.perks ?? [],
    overseerName: overseer?.name ?? 'your Overseer',
    rightHand: rightHand
      ? {
          id: rightHand.id,
          name: rightHand.name,
          points: roleFit(rightHand.attributes, 'right_hand'),
        }
      : null,
  };
}

/** Everything that lifts an officer, other than the officer. See {@link officerLiftRoom}. */
export interface LiftRoom {
  /**
   * Everybody seated and out of bed. Each officer is filtered out of their own lift.
   *
   * Somebody on the bench is not here and is still lifted by it: the crew screen draws their sheet
   * as the room would hand it to them the moment they are seated.
   */
  fit: readonly SeatedOfficer<Commander>[];
  byGroup: TerritoryEffects['officerGroupFlat'];
  fromTheLab: CrewEffects;
  fromTheOverseer: readonly string[];
  overseerName: string;
  /** The seated Right Hand and their fit, or null with the chair empty. See `rightHandLift`. */
  rightHand: { id: string; name: string; points: number } | null;
}

/**
 * The Overseer's sheet as the crew fields it: their own points plus the Right Hand's, and nothing
 * else (§C2b). Teachers do not reach the player's own character; the second in command does.
 */
export function liftedOverseerSheet(own: Attributes, room: LiftRoom): Attributes {
  if (!room.rightHand) return own;
  const flat = rightHandLift(room.rightHand.points, MAX_OVERSEER_LIFT);
  return liftedSheet(own, [
    {
      from: room.rightHand.name,
      groupFlat: { physical: flat, mental: flat, social: flat, technical: flat },
    },
  ]).attributes;
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

  /*
   * §C2b: the Right Hand lifts everybody but themselves.
   *
   * Between the Overseer and the peers on purpose: at the cap, the order decides who gets the
   * last point, and a lift the player bought by filling one chair well should land before the
   * incidental ones from whoever else happens to be on the books.
   */
  if (room.rightHand && room.rightHand.id !== officer.id) {
    const flat = rightHandLift(room.rightHand.points, MAX_RIGHT_HAND_LIFT);
    sources.push({
      from: room.rightHand.name,
      groupFlat: { physical: flat, mental: flat, social: flat, technical: flat },
    });
  }

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

  sources.push(...chairLessonsFor(officer, room));

  sources.push({
    from: 'the Lab',
    groupFlat: room.fromTheLab.officerGroupFlat,
    attributeFlat: room.fromTheLab.officerAttributeFlat,
    attributeAtLeast: room.fromTheLab.officerAttributeAtLeast,
  });

  return liftedSheet(officer.attributes, sources);
}

/**
 * What a chair's teaching rungs put on this officer (`chair_teaches`: Shared Knowledge, maintainer
 * 2026-09-28): "all other officers", from whoever is working the chair that researched it.
 *
 * Seated and working only, on both ends. A teacher in bed or on the bench teaches nobody, and an
 * officer on the bench is taught nothing: the ruling is about the room, and the bench is not in
 * it. Named for the teacher on the receipt, the way a teaching perk is, because it is that person
 * the lesson comes from and the crew screen should say so.
 */
function chairLessonsFor(officer: Commander, room: LiftRoom): LiftSource[] {
  if (!room.fit.some((working) => working.id === officer.id)) return [];
  return room.fromTheLab.chairTeaches.flatMap((lesson) => {
    const teacher = room.fit.find((working) => working.role === lesson.role);
    if (!teacher || teacher.id === officer.id) return [];
    return [{ from: teacher.name, attributeFlat: lesson.attributes }];
  });
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
  /**
   * Whoever is sitting in `role` **and fit to work**, or nothing.
   *
   * On the reader because the reader is the only thing on this path that holds the request's
   * clock. `workingOfficer(base.commanders, role)` defaults to `new Date()`, so every caller that
   * reached for it inside a request was asking the wall clock whether somebody was hurt while the
   * request beside it was reasoning about `now`. The two agree in production and disagree the
   * moment anything settles against a stated instant, which is how the research chair ended up
   * answering `head: null` on the page and opening the rung underneath it.
   */
  workingIn: (role: OfficerRole) => Commander | undefined;
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
      /*
       * §D4: working, not merely seated (maintainer, 2026-09-23).
       *
       * This is the chair that **vouches**: a research rung is gated on it and so is the trade a
       * Scrapyard card asks for. It read `base.commanders`, so an officer in a hospital bed kept
       * both open while everything else their chair sells had already stopped, and one response
       * contradicted itself: `researchHead` answered null for the same chair this answered a mark
       * for. `room.fit` is the injury-filtered roster the lift is already built from, so the mark
       * and the fold now drop the same person off the same clock.
       */
      const officer = room.fit.find((one) => one.role === role);
      return officer ? markFromPoints(roleFit(sheetFor(officer), role)) : null;
    },
    workingIn(role) {
      return room.fit.find((one) => one.role === role);
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
   * §D4: an officer in a bed is not in the room, and since 2026-09-28 neither is one on the bench.
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
  // Seated officers only: the bench is not in `fit`, so it puts no rating and no perk in the fold
  // (maintainer, 2026-09-28).
  const officers: CrewMember[] = fit.map((officer) =>
    seatedMember(liftedOfficerSheet(officer, room).attributes, officer.role, officer.perks),
  );
  const names = fit.map((officer) => officer.name);
  // The Overseer is the player, not an employee: no seat, and no discount anywhere.
  return overseer
    ? {
        sheets: [
          overseerMember(liftedOverseerSheet(overseer.attributes, room), overseer.perks),
          ...officers,
        ],
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
