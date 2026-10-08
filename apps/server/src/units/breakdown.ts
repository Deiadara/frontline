import {
  BUILDING_CATALOG,
  EVERY_LOCATION,
  FACTION_CARD_SPECS,
  MAX_EFFECT_REDUCTION,
  MAX_GAUNTLET_MUSTER_BONUS,
  MAX_MUSTER_DISCOUNT,
  SET_BONUSES,
  SUPPLIES_LINE_CEILING,
  MUSTER_SPEED_KNEE,
  MUSTER_SUPPLIES_PER_GREENHOUSE_LEVEL,
  MUSTER_TIME_PER_GAUNTLET_LEVEL,
  bonusesAt,
  buildingLevel,
  cardBonusPercent,
  clampLevel,
  completedSet,
  fittedIn,
  fittedMagnitude,
  findDistrict,
  findResearchItem,
  isHeldBy,
  notorietyEffects,
  notorietyTier,
  perksOf,
  suppliesOnlyCut,
  musterSpeedAfterTaper,
  unifiedBonusFor,
  type Base,
  type BonusLine,
  type Building,
  type ModificationEffect,
  type MusterBreakdown,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewRoomFor } from '../crew/standing.js';
import { cardsAtTable } from '../factions/cards.js';
import { holdsDistrictWhole } from '../city/holding.js';

/**
 * Where the roster's three muster figures come from, line by line (maintainer, 2026-09-17).
 *
 * "In units where it says -24% cost, -70% training time etc, when you hover over these make a page
 * come up that breaks down where they are from (e.g. 20% from X officer, 10% from Gauntlet)."
 *
 * ## Why this is a second walk and what stops it drifting
 *
 * The totals come out of `musterRatesFor`, which reads `standingEffectsFor`: one fold that adds
 * the ground, the people, the Lab, the faction's table and the crew's rank into a struct of bare
 * numbers. By the time a percentage is in that struct there is nothing left to say who paid it, and
 * threading a name through the fold would mean changing the shape every consumer in the game reads,
 * for one hover card's sake.
 *
 * So this walks the same contributors again and keeps the names. That is a second place that has to
 * agree with the first, which is exactly the failure this repo has been bitten by, so it is held by
 * a test rather than by care: `breakdown.test.ts` sums each list and refuses a sum that is not the
 * figure the roster ships. A contributor added to the fold and not to this file fails there.
 */
export function musterBreakdownFor(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): MusterBreakdown {
  const cost = withBenchLine(crewAndGroundLines(repos, base, now, 'cost'), 'cost');
  return {
    cost,
    speed: withBenchLine(
      [
        ...crewAndGroundLines(repos, base, now, 'speed'),
        ...structureLines(base.buildings, 'speed'),
      ],
      'speed',
    ),
    // §B5 is structures and nothing else: no officer, no block of ground and no rung pays supplies.
    // What they come to on the line depends on the cost cut beside them, so it is read off the
    // cost page's own total, which is the figure the roster ships.
    supplies: withSuppliesTaper(structureLines(base.buildings, 'supplies'), sumOf(cost)),
  };
}

/**
 * What the bench does with the cost and the speed sums, and from where it starts to bite.
 *
 * The cost cut stops at `MAX_MUSTER_DISCOUNT`, a price floor: half price is as cheap as a unit
 * gets. The speed tapers past a knee instead (maintainer, 2026-10-01), so every card on it still
 * pays a little (`musterSpeedAfterTaper`). The supplies page is {@link withSuppliesTaper}.
 *
 * The roster shipped the raw sums (bug pass, 2026-10-01), so a crew holding an Armory worked to
 * level 10 read "-66% cost" over a bill that was half price. Each page now carries a line taking
 * its sum to what the bench makes of it.
 */
const BENCH = {
  cost: {
    curve: (percent: number) => Math.min(MAX_MUSTER_DISCOUNT, percent),
    from: MAX_MUSTER_DISCOUNT,
    line: { source: 'Past what the bench takes', note: `Stops at ${MAX_MUSTER_DISCOUNT}%` },
  },
  speed: {
    curve: musterSpeedAfterTaper,
    from: MUSTER_SPEED_KNEE,
    line: { source: 'Tapering', note: `Each point past ${MUSTER_SPEED_KNEE} pays less` },
  },
} as const;

type BenchChannel = keyof typeof BENCH;

/**
 * The crew-wide cost cut as the bench charges it, which is what the roster ships.
 *
 * The top only. The floor stays with `musterCost`, which floors the crew's figure and a unit's
 * own ground *together*, so a crew figure below zero still nets against the ground here the way the
 * route nets them. The speed and the supplies cut are shipped raw: `musterSecondsFor` and
 * `musterCost` taper the sum of the crew's figure and a unit's own ground (and the supplies line
 * with the cost cut beside it), and a curve cannot be applied to the parts apart and added.
 */
export function benchFigure(channel: 'cost', percent: number): number {
  return BENCH[channel].curve(percent);
}

/**
 * The line that takes a figure going from `before` to `after` to what the bench makes of that
 * step, or nothing while the bench takes it whole.
 */
function benchLine(channel: BenchChannel, before: number, after: number): BonusLine[] {
  const { curve, from, line } = BENCH[channel];
  if (after <= from) return [];
  const percent = curve(after) - curve(before) - (after - before);
  return percent === 0 ? [] : [{ ...line, percent }];
}

const sumOf = (lines: readonly BonusLine[]): number =>
  lines.reduce((sum, line) => sum + line.percent, 0);

function withBenchLine(lines: BonusLine[], channel: BenchChannel): BonusLine[] {
  return [...lines, ...benchLine(channel, 0, sumOf(lines))];
}

/**
 * The supplies page's last line: what the supplies line's taper takes off the supplies-only points
 * (maintainer, 2026-10-01).
 *
 * `musterCost` cuts the supplies line by the general cut and the supplies-only points on one
 * taper toward `SUPPLIES_LINE_CEILING`, with the general cut as its knee (`suppliesLineCut`). So
 * what the Greenhouse and the cards are worth depends on the cost cut beside them, and the page
 * adds up to `suppliesOnlyCut`: the chip's figure, and the cost chip plus this one is the line.
 */
function suppliesTaperLine(general: number, before: number, after: number): BonusLine[] {
  const percent =
    suppliesOnlyCut(general, after) - suppliesOnlyCut(general, before) - (after - before);
  return Math.abs(percent) < 1e-9
    ? []
    : [
        {
          source: 'Tapering',
          note: `Toward ${SUPPLIES_LINE_CEILING}% off, with the cost cut`,
          percent,
        },
      ];
}

function withSuppliesTaper(lines: BonusLine[], general: number): BonusLine[] {
  return [...lines, ...suppliesTaperLine(general, 0, sumOf(lines))];
}

/**
 * The supplies line as a unit with its own ground sees it, against the crew's page.
 *
 * A unit's own ground raises its cost cut (`homeOnTopOf`), and the supplies-only points taper in
 * the room the cost cut leaves, so they are worth a little less to that unit. One line says how
 * much, so this unit's Bonuses page still adds up to its own bill.
 */
export function homeSuppliesLines(
  crewCost: number,
  homeCost: number,
  supplies: number,
): BonusLine[] {
  const percent =
    suppliesOnlyCut(crewCost + homeCost, supplies) - suppliesOnlyCut(crewCost, supplies);
  return Math.abs(percent) < 1e-9
    ? []
    : [{ source: 'Its own ground', note: 'Less room left on the supplies line', percent }];
}

/**
 * What a unit's own ground adds on top of the crew's shipped figure, and the lines that say so.
 *
 * On the cost cut, only the room the crew has left under the floor price: Cyberhounds bred at a
 * level-6 Doghouse cost no less than any other unit once the crew is at half price, and the page
 * adds the Doghouse and then takes it back rather than quoting it on top. On the speed the ground
 * ships whole, and the line takes it to what the taper makes of it on top of the crew's figure.
 */
export function homeOnTopOf(
  channel: 'cost' | 'speed',
  crewFigure: number,
  home: BonusLine,
): { percent: number; lines: BonusLine[] } {
  const percent =
    channel === 'cost'
      ? Math.min(home.percent, Math.max(0, MAX_MUSTER_DISCOUNT - crewFigure))
      : home.percent;
  return {
    percent,
    lines: [home, ...benchLine(channel, crewFigure, crewFigure + home.percent)],
  };
}

/** What a hold bonus and a perk call the channel. `supplies` is paid by structures alone. */
const HOLD_KIND = { cost: 'muster_cost', speed: 'muster_speed' } as const;
/** What the crew's effect struct calls it. */
const EFFECT_CHANNEL = {
  cost: 'musterCostPercent',
  speed: 'musterSpeedPercent',
} as const;
/** What a fitted modification calls it. */
const MODIFICATION_EFFECT: Record<'speed' | 'supplies', ModificationEffect> = {
  speed: 'muster_time_reduction',
  supplies: 'muster_supplies_reduction',
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
  // Officers pay into these channels through their perks alone since 2026-10-04: a skill reaches
  // the crew through its chair's passive, and the Veteran's comes off the bill on its own
  // (`musterCost`), outside these sums.
  const room = crewRoomFor(repos, base, now);

  // Perks sum, so every copy in the room is its own line.
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
    if (item?.payout.bonus?.kind !== HOLD_KIND[channel]) continue;
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
    lines.push({ source: 'Your name', note: notorietyTier(base.economy.notoriety), percent: rank });
  }

  return lines;
}

/** The blocks this crew holds, each at the level it has been worked up to (§A4). */
function groundLines(repos: Repositories, base: Base, channel: 'cost' | 'speed'): BonusLine[] {
  const controls = repos.city.controls();
  const lines: BonusLine[] = [];
  const held = new Set<string>();
  for (const location of EVERY_LOCATION) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    held.add(location.districtId);
    for (const bonus of bonusesAt(location, control.level)) {
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
   * for any one of them. Same condition as `territoryEffectsFor`, which since 2026-10-07 means the
   * crew's **table**: the members between them hold every plot and every one of them is paid. Read
   * through `holdsDistrictWhole` rather than re-implemented here, because this panel's job is to
   * explain a number the fold produced, and a second copy of the rule is a second answer. It was
   * `districtHolder` (one crew, all of it) until the ruling, so a member holding four plots of
   * seven was paid its faction's bonus and shown no line for it.
   */
  for (const districtId of held) {
    const district = findDistrict(districtId);
    if (!district) continue;
    if (!holdsDistrictWhole(repos, base.id, districtId)) continue;
    const unified = unifiedBonusFor(districtId);
    if (unified?.bonus.kind !== HOLD_KIND[channel]) continue;
    lines.push({ source: unified.title, note: district.name, percent: unified.bonus.percent });
  }
  return lines;
}

/**
 * The Gauntlet, the Greenhouse, and every card fitted in the district (§B5, §B6).
 *
 * Kept apart from the fold above because that is how the game charges them: `musterRatesFor`
 * reads `musterTimeReduction` and `musterSuppliesReduction` straight off the buildings, and
 * neither goes near `standingEffectsFor`. The cards on both stop at `MAX_EFFECT_REDUCTION`, and the
 * Gauntlet's own 2 a level at 40, and each is printed as its own line when it bites, because a
 * player whose eight cards add up to eighty and whose bill moved by seventy has been given the
 * wrong page otherwise.
 */
function structureLines(
  buildings: readonly Building[],
  channel: 'speed' | 'supplies',
): BonusLine[] {
  const lines: BonusLine[] = [];

  const per =
    channel === 'speed' ? MUSTER_TIME_PER_GAUNTLET_LEVEL : MUSTER_SUPPLIES_PER_GREENHOUSE_LEVEL;
  // The Gauntlet's own 40 is level 20 exactly; the Greenhouse has no ceiling of its own any more.
  const ceiling = channel === 'speed' ? MAX_GAUNTLET_MUSTER_BONUS : Number.POSITIVE_INFINITY;
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
   * applied to `cards` alone: `musterTimeReduction` adds a capped Gauntlet to an already-capped
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
