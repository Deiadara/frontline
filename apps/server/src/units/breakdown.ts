import {
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_NAMES,
  BUILDING_CATALOG,
  CITY_LOCATIONS,
  FACTION_CARD_SPECS,
  MAX_EFFECT_REDUCTION,
  MAX_GAUNTLET_TRAINING_BONUS,
  MAX_GREENHOUSE_SUPPLIES_DISCOUNT,
  SET_BONUSES,
  TRAINING_SUPPLIES_PER_GREENHOUSE_LEVEL,
  TRAINING_TIME_PER_GAUNTLET_LEVEL,
  bonusesAt,
  buildingLevel,
  cardBonusPercent,
  clampLevel,
  completedSet,
  contributionOf,
  crewSheetSources,
  disruptionPercentAt,
  districtHolder,
  fittedIn,
  fittedMagnitude,
  findDistrict,
  findResearchItem,
  isHeldBy,
  notorietyEffects,
  perksOf,
  unifiedBonusFor,
  type Base,
  type BonusLine,
  type Building,
  type ModificationEffect,
  type TrainingBreakdown,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewRoomFor } from '../crew/standing.js';
import { cardsAtTable } from '../factions/cards.js';

/**
 * Where the roster's three training figures come from, line by line (maintainer, 2026-09-17).
 *
 * "In units where it says -24% cost, -70% training time etc, when you hover over these make a page
 * come up that breaks down where they are from (e.g. 20% from X officer, 10% from Gauntlet)."
 *
 * ## Why this is a second walk and what stops it drifting
 *
 * The totals come out of `trainingRatesFor`, which reads `standingEffectsFor`: one fold that adds
 * the ground, the people, the Lab, the faction's table and the crew's rank into a struct of bare
 * numbers. By the time a percentage is in that struct there is nothing left to say who paid it, and
 * threading a name through the fold would mean changing the shape every consumer in the game reads,
 * for one hover card's sake.
 *
 * So this walks the same contributors again and keeps the names. That is a second place that has to
 * agree with the first, which is exactly the failure this repo has been bitten by, so it is held by
 * a test rather than by care: `breakdown.test.ts` sums each list and refuses a sum that is not the
 * figure the roster ships. A contributor added to the fold and not to this file fails there.
 *
 * ## The one thing that is not a source
 *
 * §A4's raid disruption is a *cut*, not a payer: it takes a quarter off every positive percentage
 * the crew holds while it lasts. It is one line at the bottom rather than a quarter shaved off each
 * line above, because the page is answering "where is this coming from" and a raid is the answer to
 * a different question the player also has ("why did it just drop").
 */
export function trainingBreakdownFor(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): TrainingBreakdown {
  return {
    cost: withDisruption(crewAndGroundLines(repos, base, now, 'cost'), base, now),
    /*
     * Only the crew-and-ground half of the speed figure is disrupted, and that asymmetry is the
     * game's rather than this file's: `trainingRatesFor` adds `trainingTimeReduction(buildings)` to
     * an already-disrupted `trainingSpeedPercent`, so the Gauntlet and its cards keep working
     * through a raid while the drillmaster's contribution does not.
     */
    speed: [
      ...withDisruption(crewAndGroundLines(repos, base, now, 'speed'), base, now),
      ...structureLines(base.buildings, 'speed'),
    ],
    // §B5 is structures and nothing else: no officer, no block of ground and no rung pays supplies.
    supplies: structureLines(base.buildings, 'supplies'),
  };
}

/** What a hold bonus and a perk call the channel. `supplies` is paid by structures alone. */
const HOLD_KIND = { cost: 'training_cost', speed: 'training_speed' } as const;
/** What the crew's effect struct calls it. */
const EFFECT_CHANNEL = {
  cost: 'trainingCostPercent',
  speed: 'trainingSpeedPercent',
} as const;
/** What a fitted modification calls it. */
const MODIFICATION_EFFECT: Record<'speed' | 'supplies', ModificationEffect> = {
  speed: 'training_time_reduction',
  supplies: 'training_supplies_reduction',
};

/**
 * Everything that pays into a channel through `standingEffectsFor`: the people, the ground, the
 * Lab, the table and the rank.
 *
 * In the order a player would read them: the room first, because that is the half they move this
 * week, then the map, then the long-term things.
 */
function crewAndGroundLines(
  repos: Repositories,
  base: Base,
  now: Date,
  channel: 'cost' | 'speed',
): BonusLine[] {
  const lines: BonusLine[] = [];
  const room = crewRoomFor(repos, base, now);
  const sources = crewSheetSources(room.sheets);

  /*
   * The officer carrying the skill, and only that one.
   *
   * Attributes are best-of (`crewSheet`), so the second-best chemist in the crew is worth nothing
   * on this line and printing them would be printing a number the game does not charge. Which is
   * also why the note names the skill: without it "Wenqing, 18%" reads as a mystery, and with it
   * the player knows the move is to sit them where Chemistry is used.
   */
  for (const name of ATTRIBUTE_NAMES) {
    if (ATTRIBUTE_EFFECTS[name].channel !== EFFECT_CHANNEL[channel]) continue;
    const source = sources[name];
    const percent = contributionOf(source.rating);
    if (percent === 0 || source.at === null) continue;
    lines.push({
      source: room.names[source.at] ?? 'Somebody in the room',
      note: `${ATTRIBUTE_LABELS[name]} ${source.rating}`,
      percent,
    });
  }

  // Perks sum rather than best-of, so every copy in the room is its own line.
  for (const [index, member] of room.sheets.entries()) {
    for (const perk of perksOf(member.perks)) {
      if (perk.bonus.kind !== HOLD_KIND[channel]) continue;
      lines.push({
        source: room.names[index] ?? 'Somebody in the room',
        note: perk.name,
        percent: perk.bonus.percent,
      });
    }
  }

  lines.push(...groundLines(repos, base, channel));

  for (const id of base.research.technologies) {
    const item = findResearchItem(id);
    if (item?.payout.bonus.kind !== HOLD_KIND[channel]) continue;
    lines.push({ source: item.name, note: 'The Lab', percent: item.payout.bonus.percent });
  }

  const membership = repos.factions.membershipOf(base.ownerId);
  if (membership) {
    for (const held of cardsAtTable(repos, membership.factionId).values()) {
      const spec = FACTION_CARD_SPECS[held.card];
      if (spec.channel !== EFFECT_CHANNEL[channel]) continue;
      lines.push({ source: spec.name, note: 'Your table', percent: cardBonusPercent(held.mark) });
    }
  }

  const rank = notorietyEffects(base.economy.notoriety)[EFFECT_CHANNEL[channel]];
  if (rank !== 0) {
    lines.push({ source: 'Your name', note: `Rank ${base.economy.notoriety}`, percent: rank });
  }

  return lines;
}

/** The blocks this crew holds, each at the level it has been worked up to (§A4). */
function groundLines(repos: Repositories, base: Base, channel: 'cost' | 'speed'): BonusLine[] {
  const controls = repos.city.controls();
  const lines: BonusLine[] = [];
  const held = new Set<string>();
  for (const location of CITY_LOCATIONS) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    held.add(location.districtId);
    for (const bonus of bonusesAt(location.kind, control.level)) {
      if (bonus.kind !== HOLD_KIND[channel]) continue;
      lines.push({
        source: location.name,
        note: `Level ${clampLevel(control.level)}`,
        percent: bonus.percent,
      });
    }
  }
  /*
   * And the whole-district bonus, which is paid for holding every block in one district rather than
   * for any one of them. Same condition as `territoryEffectsFor`: a district counts only while this
   * crew is the holder of all of it.
   */
  for (const districtId of held) {
    const district = findDistrict(districtId);
    if (!district) continue;
    const holder = districtHolder(district, controls);
    if (holder?.kind !== 'crew' || holder.baseId !== base.id) continue;
    const unified = unifiedBonusFor(districtId);
    if (unified?.bonus.kind !== HOLD_KIND[channel]) continue;
    lines.push({ source: unified.title, note: district.name, percent: unified.bonus.percent });
  }
  return lines;
}

/**
 * The Gauntlet, the Greenhouse, and every card fitted in the district (§B5, §B6).
 *
 * Kept apart from the fold above because that is how the game charges them: `trainingRatesFor`
 * reads `trainingTimeReduction` and `trainingSuppliesReduction` straight off the buildings, and
 * neither goes near `standingEffectsFor`. Both carry two ceilings, and both ceilings are printed as
 * their own line when they bite, because a player whose eight cards add up to eighty and whose bill
 * moved by seventy has been given the wrong page otherwise.
 */
function structureLines(
  buildings: readonly Building[],
  channel: 'speed' | 'supplies',
): BonusLine[] {
  const lines: BonusLine[] = [];

  const per =
    channel === 'speed' ? TRAINING_TIME_PER_GAUNTLET_LEVEL : TRAINING_SUPPLIES_PER_GREENHOUSE_LEVEL;
  const ceiling =
    channel === 'speed' ? MAX_GAUNTLET_TRAINING_BONUS : MAX_GREENHOUSE_SUPPLIES_DISCOUNT;
  const kind = channel === 'speed' ? 'gauntlet' : 'greenhouse';
  const level = buildingLevel(buildings, kind);
  const raw = level * per;
  if (raw > 0) {
    lines.push({
      source: channel === 'speed' ? 'The Gauntlet' : 'The Greenhouse',
      note: raw > ceiling ? `Level ${level}, capped at ${ceiling}%` : `Level ${level}`,
      percent: Math.min(ceiling, raw),
    });
  }

  const effect = MODIFICATION_EFFECT[channel];
  const cards: BonusLine[] = [];
  for (const building of buildings) {
    const fitted = fittedIn(building);
    for (const spec of fitted) {
      if (spec.effect !== effect) continue;
      cards.push({
        // The structure it is bolted into, by the name on the door rather than by its key: the
        // note beside a card is for a player looking for where to go and change it.
        source: spec.name,
        note: BUILDING_CATALOG[building.kind].name,
        percent: fittedMagnitude(spec, fitted),
      });
    }
    const set = completedSet(building);
    if (set === null) continue;
    const bonus = SET_BONUSES[set];
    if (bonus.effect !== effect) continue;
    cards.push({
      source: bonus.title,
      note: `A full set in ${BUILDING_CATALOG[building.kind].name}`,
      percent: bonus.magnitude,
    });
  }
  lines.push(...cards);

  /*
   * The cap `districtEffects` puts on every reduction, as a line of its own.
   *
   * It is on the *modifications* and not on the structure's own contribution, which is why it is
   * applied to `cards` alone: `trainingTimeReduction` adds a capped Gauntlet to an already-capped
   * `districtEffects`, so a maxed Gauntlet carrying a full deck is 40 plus 70, not 70.
   */
  const fromCards = cards.reduce((sum, line) => sum + line.percent, 0);
  if (fromCards > MAX_EFFECT_REDUCTION) {
    lines.push({
      source: 'Past what a district can take',
      note: `Modifications stop at ${MAX_EFFECT_REDUCTION}%`,
      percent: MAX_EFFECT_REDUCTION - fromCards,
    });
  }

  return lines;
}

/** §A4: what a raid is currently taking off the crew's own half of the figure. */
function withDisruption(lines: readonly BonusLine[], base: Base, now: Date): BonusLine[] {
  const off = disruptionPercentAt(base.economy.disruption, now);
  const total = lines.reduce((sum, line) => sum + line.percent, 0);
  if (off <= 0 || total <= 0) return [...lines];
  return [
    ...lines,
    {
      source: 'Raided',
      note: `${Math.round(off)}% off everything your crew holds`,
      percent: -(total * (Math.min(100, off) / 100)),
    },
  ];
}
