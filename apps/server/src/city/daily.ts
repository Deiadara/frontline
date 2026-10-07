import {
  BLACK_MARKET_GOODS,
  BLUEPRINTS,
  GAME_TIMEZONE,
  ITEM_CATALOG,
  ITEM_RARITIES,
  RARITY_ODDS_BY_LEVEL,
  TROPHY_PAY,
  TROPHY_PAY_SCALE,
  addItems,
  addToStash,
  blueprintStatus,
  dayInZone,
  drawWeighted,
  findLocation,
  groundStateOf,
  mulberry32,
  pageRarity,
  seedFrom,
  type Base,
  type ItemId,
  type ItemRarity,
  type PartialResources,
  type ResourceKey,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { creditBase } from '../district/stores.js';
import { notifyBase } from '../social/notify.js';
import { settleEach } from '../world/guard.js';

/**
 * What held ground pays once a day (maintainer, 2026-10-06 and 2026-10-07).
 *
 * The Scriptorium's page, the Dispensary's stim, the Chop Shop's components and the Trophy Hall's
 * pay all land on the first world tick of each Athens day that finds the crew holding the ground,
 * the way the courier's report does (`spying/courier.ts`). Nothing is owed for a day the crew did
 * not hold the place at the tick. One claim a crew a day (`daily_grants`), taken before anything is
 * paid, so a restart or two ticks racing each other pay once; one notification a day, listing
 * what came.
 *
 * Every draw is seeded off the crew and the day, so a tick that pays after a crash pays what the
 * tick that crashed would have.
 */

export const STIM_GOOD_ID = 'adrenaline_syringes';

/** What one crew's ground paid on one day, for the notice and the ledger. */
export interface DailyGrant {
  pages: ItemId[];
  stim: boolean;
  components: ItemId[];
  trophyPay: PartialResources;
}

/** The Scriptorium's page: one of a blueprint the crew has not finished, rarity by the hall's level. */
export function drawDailyPage(base: Base, level: number, seed: string): ItemId | null {
  const rarity = drawRarity(level, `${seed}:rarity`);
  const pool = BLUEPRINTS.filter((spec) => blueprintStatus(base.inventory, spec) !== 'unlocked')
    .flatMap((spec) => spec.pages.map((page) => ({ spec, page })))
    .filter(({ spec, page }) => pageRarity(spec, page) === rarity)
    .map(({ page }) => ({ id: page.id, weight: 1 }));
  return drawWeighted(pool, `${seed}:page`);
}

/** The Chop Shop's component: any component in the catalogue of the rarity the level rolled. */
export function drawDailyComponent(level: number, seed: string): ItemId | null {
  const rarity = drawRarity(level, `${seed}:rarity`);
  const pool = Object.values(ITEM_CATALOG)
    .filter((spec) => spec.kind === 'component' && spec.rarity === rarity)
    .map((spec) => ({ id: spec.id, weight: 1 }));
  return drawWeighted(pool, `${seed}:component`);
}

/** One rarity off the level's row of `RARITY_ODDS_BY_LEVEL`, with the odds the row prints. */
export function drawRarity(level: number, seed: string): ItemRarity {
  const row = RARITY_ODDS_BY_LEVEL[Math.min(RARITY_ODDS_BY_LEVEL.length, Math.max(1, level)) - 1]!;
  const pool = ITEM_RARITIES.map((rarity, at) => ({ id: rarity, weight: row[at] ?? 0 })).filter(
    (entry) => entry.weight > 0,
  );
  return drawWeighted(pool, seed) ?? 'basic';
}

/**
 * The Trophy Hall's day: 10 HQ metal and 100 of every other resource for each unit type killed
 * while the crew has held the hall, times the hall's level scale.
 */
export function trophyPayFor(kinds: number, level: number): PartialResources {
  if (kinds <= 0) return {};
  const scale = TROPHY_PAY_SCALE[Math.min(TROPHY_PAY_SCALE.length, Math.max(1, level)) - 1]!;
  const line = (each: number): number => Math.round(each * kinds * scale);
  return {
    caps: line(TROPHY_PAY.each),
    scrap: line(TROPHY_PAY.each),
    planks: line(TROPHY_PAY.each),
    oil: line(TROPHY_PAY.each),
    supplies: line(TROPHY_PAY.each),
    highQualityMetal: line(TROPHY_PAY.highQualityMetal),
  };
}

/**
 * After a fight: the kills a crew made, per unit id, onto the `trophies` of every Trophy Hall it
 * holds (maintainer, 2026-10-06). Only kills made while the hall is held count, and `putControl`
 * clears the tally when the hall changes hands, so a hall taken back starts from nothing.
 */
export function recordTrophyKills(
  repos: Repositories,
  baseId: string,
  killed: Readonly<Record<string, number>>,
  now: Date,
): void {
  const kills = Object.entries(killed).filter(([, count]) => count > 0);
  if (kills.length === 0) return;
  for (const control of repos.city.controls().values()) {
    if (control.holder.kind !== 'crew' || control.holder.baseId !== baseId) continue;
    if (findLocation(control.locationId)?.kind !== 'trophy_hall') continue;
    const ground = groundStateOf(control);
    const trophies = { ...ground.trophies };
    for (const [unitId, count] of kills) trophies[unitId] = (trophies[unitId] ?? 0) + count;
    repos.city.put({
      ...control,
      trophies,
      trophiesSince: ground.trophiesSince ?? now.toISOString(),
    });
  }
}

/** The unit types with a kill on any Trophy Hall this crew holds, and the best hall's level. */
function trophiesHeld(repos: Repositories, baseId: string): { kinds: number; level: number } {
  const killed = new Set<string>();
  let level = 0;
  for (const control of repos.city.controls().values()) {
    if (control.holder.kind !== 'crew' || control.holder.baseId !== baseId) continue;
    if (findLocation(control.locationId)?.kind !== 'trophy_hall') continue;
    level = Math.max(level, control.level);
    for (const [unitId, kills] of Object.entries(groundStateOf(control).trophies)) {
      if (kills > 0) killed.add(unitId);
    }
  }
  return { kinds: killed.size, level };
}

/** Pays one crew's ground for `day`. Null when nothing it holds pays daily. */
export function grantDaily(
  repos: Repositories,
  base: Base,
  day: string,
  now: Date,
): DailyGrant | null {
  const effects = standingEffectsFor(repos, base, now);
  const trophies = trophiesHeld(repos, base.id);
  const owed =
    effects.dailyPages.length > 0 ||
    effects.dailyStimPercent > 0 ||
    effects.dailyComponents.length > 0 ||
    trophies.kinds > 0;
  if (!owed) return null;

  const seed = `daily:${base.id}:${day}`;
  const grant: DailyGrant = { pages: [], stim: false, components: [], trophyPay: {} };
  let inventory = base.inventory;

  effects.dailyPages.forEach((level, at) => {
    const page = drawDailyPage({ ...base, inventory }, level, `${seed}:page:${at}`);
    if (page === null) return;
    inventory = addItems(inventory, { [page]: 1 });
    grant.pages.push(page);
  });
  effects.dailyComponents.forEach(({ count, level }, at) => {
    for (let n = 0; n < count; n += 1) {
      const component = drawDailyComponent(level, `${seed}:component:${at}:${n}`);
      if (component === null) continue;
      inventory = addItems(inventory, { [component]: 1 });
      grant.components.push(component);
    }
  });
  if (effects.dailyStimPercent > 0) {
    const roll = mulberry32(seedFrom(`${seed}:stim`))() * 100;
    grant.stim = roll < effects.dailyStimPercent;
  }
  grant.trophyPay = trophyPayFor(trophies.kinds, trophies.level);

  // Through the ordinary crediting path, so the stores' ceilings apply and the overflow is lost
  // the way any other credit's is.
  const credited = creditBase(repos, base, grant.trophyPay, now);
  repos.bases.updateHoldings(base.id, credited.resources, inventory);
  if (grant.stim) {
    repos.blackMarket.writeStash(
      base.id,
      addToStash(repos.blackMarket.stashFor(base.id), STIM_GOOD_ID),
    );
  }
  repos.history.record({
    actorId: null,
    baseId: base.id,
    kind: 'daily.grant',
    payload: { day, ...grant },
    at: now.toISOString(),
  });
  notifyBase(repos, base.id, {
    kind: 'daily_grant',
    title: 'Your ground paid its daily take',
    body: dailyGrantSummary(grant),
    link: '/game/city',
    subjectId: `${base.id}:${day}`,
    at: now,
  });
  return grant;
}

/** One line naming what came, for the notice. */
export function dailyGrantSummary(grant: DailyGrant): string {
  const lines: string[] = [];
  if (grant.pages.length > 0) {
    lines.push(
      `${grant.pages.map((id) => ITEM_CATALOG[id]?.name ?? id).join(', ')} from the Scriptorium`,
    );
  }
  if (grant.stim) {
    lines.push(`one ${BLACK_MARKET_GOODS[STIM_GOOD_ID]?.name ?? 'stim'} from the Dispensary`);
  }
  if (grant.components.length > 0) {
    lines.push(
      `${grant.components.map((id) => ITEM_CATALOG[id]?.name ?? id).join(', ')} from the Chop Shop`,
    );
  }
  const pay = Object.entries(grant.trophyPay).filter(([, amount]) => (amount ?? 0) > 0);
  if (pay.length > 0) {
    lines.push(
      `${pay.map(([key, amount]) => `${amount} ${RESOURCE_WORDS[key as ResourceKey]}`).join(', ')} from the Trophy Hall`,
    );
  }
  return lines.length > 0 ? `${lines.join('; ')}.` : 'Nothing came in today.';
}

const RESOURCE_WORDS: Readonly<Record<ResourceKey, string>> = {
  caps: 'caps',
  scrap: 'scrap',
  planks: 'planks',
  oil: 'oil',
  supplies: 'supplies',
  highQualityMetal: 'HQ metal',
};

/**
 * Pays every crew whose ground owes it something for today, once. Returns how many were paid.
 *
 * The claim is taken before the pay for every crew that has not got today's row, whether or not
 * anything turns out to be owed: a crew with nothing paying daily costs one row a day and never a
 * second walk of its holdings on the same day.
 */
export function settleDaily(repos: Repositories, now: Date): number {
  const day = dayInZone(now, GAME_TIMEZONE);
  const due = repos.bases
    .listSummaries()
    .map((crew) => crew.id)
    .filter((baseId) => !repos.dailyGrants.claimed(baseId, day));
  let paid = 0;
  settleEach(
    repos,
    'daily grants',
    due,
    (baseId) => baseId,
    (baseId) => {
      const base = repos.bases.findById(baseId);
      if (!base || !repos.dailyGrants.claim(baseId, day, now.toISOString())) return;
      if (grantDaily(repos, base, day, now) !== null) paid += 1;
    },
  );
  return paid;
}
